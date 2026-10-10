use super::*;
use crate::ThreadManager;
use crate::current_time::SleepFuture;
use crate::current_time::TimeFuture;
use crate::current_time::TimeProvider;
use crate::init_state_db;
use crate::session::input_queue::TurnInput;
use crate::session::tests::build_test_config;
use crate::session::tests::make_persistent_session_and_context_with_time_provider_and_rx;
use crate::thread_manager::StartThreadOptions;
use crate::tools::handlers::multi_agents_common::thread_spawn_source;
use chrono::DateTime;
use chrono::Utc;
use codex_history::InitialHistory;
use codex_history::ResponseItemEnvelope;
use codex_history::ResumedHistory;
use codex_login::CodexAuth;
use codex_protocol::models::AgentMessageInputContent;
use codex_protocol::models::ContentItem;
use codex_protocol::models::ResponseItem;
use codex_protocol::turn_input::NotSubmittedReason;
use codex_protocol::turn_input::SteerSubmission;
use codex_protocol::turn_input::TurnInputRequest;
use codex_protocol::user_input::UserInput;
use core_test_support::responses::ev_assistant_message;
use core_test_support::responses::ev_completed;
use core_test_support::responses::ev_function_call_with_namespace;
use core_test_support::responses::ev_response_created;
use core_test_support::responses::mount_sse_once;
use core_test_support::responses::mount_sse_sequence;
use core_test_support::responses::sse;
use core_test_support::responses::start_mock_server;
use pretty_assertions::assert_eq;
use std::sync::atomic::AtomicI64;
use std::sync::atomic::AtomicUsize;
use tokio::sync::oneshot;
use wiremock::Mock;
use wiremock::matchers::method;
use wiremock::matchers::path_regex;

const START_MS: i64 = 1_800_000_000_000;

#[derive(Default)]
pub(super) struct FakeClock {
    now_ms: AtomicI64,
    sleeps: AtomicUsize,
    waiters: StdMutex<Vec<(i64, oneshot::Sender<()>)>>,
}

impl FakeClock {
    pub(super) fn new() -> Self {
        Self {
            now_ms: AtomicI64::new(START_MS),
            ..Self::default()
        }
    }

    pub(super) fn sleep_count(&self) -> usize {
        self.sleeps.load(Ordering::Acquire)
    }

    pub(super) fn advance(&self, duration: Duration) {
        let now = self
            .now_ms
            .fetch_add(duration.as_millis() as i64, Ordering::AcqRel)
            + duration.as_millis() as i64;
        let mut waiters = self.waiters.lock().expect("fake clock waiters");
        let mut pending = Vec::new();
        for (deadline, sender) in waiters.drain(..) {
            if deadline <= now {
                let _ = sender.send(());
            } else {
                pending.push((deadline, sender));
            }
        }
        *waiters = pending;
    }
}

impl TimeProvider for FakeClock {
    fn current_time(&self, _thread_id: codex_protocol::ThreadId) -> TimeFuture<'_> {
        let now = self.now_ms.load(Ordering::Acquire);
        Box::pin(async move {
            DateTime::<Utc>::from_timestamp_millis(now)
                .ok_or_else(|| anyhow::anyhow!("invalid fake timestamp"))
        })
    }

    fn sleep(&self, _thread_id: codex_protocol::ThreadId, duration: Duration) -> SleepFuture<'_> {
        self.sleeps.fetch_add(1, Ordering::AcqRel);
        if duration.is_zero() {
            return Box::pin(async { Ok(()) });
        }
        let deadline = self
            .now_ms
            .load(Ordering::Acquire)
            .saturating_add(duration.as_millis() as i64);
        let (sender, receiver) = oneshot::channel();
        self.waiters
            .lock()
            .expect("fake clock waiters")
            .push((deadline, sender));
        Box::pin(async move {
            receiver
                .await
                .map_err(|_| anyhow::anyhow!("fake clock wait cancelled"))
        })
    }
}

pub(super) async fn wait_for_state(session: &Session, expected: RootResumeState) -> RootResumeReservation {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(record) = session.root_resume_record()
                && record.state == expected
            {
                return record;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap_or_else(|_| {
        panic!(
            "reservation did not reach {expected:?}: {:?}",
            session.root_resume_record().map(|record| record.state)
        )
    })
}

async fn response_request_count_for_thread(
    server: &wiremock::MockServer,
    thread_id: codex_protocol::ThreadId,
) -> usize {
    server
        .received_requests()
        .await
        .expect("read local mock requests")
        .into_iter()
        .filter(|request| {
            let Ok(body) = request.body_json::<serde_json::Value>() else {
                return false;
            };
            request.url.path().ends_with("/responses")
                && body["client_metadata"]["thread_id"] == serde_json::json!(thread_id)
        })
        .count()
}

async fn park_root(
    session: &Arc<Session>,
    turn: &Arc<TurnContext>,
    delay_ms: u64,
) -> RootResumeReservation {
    let record = session
        .prepare_root_resume(
            turn,
            "defer-call",
            Some(delay_ms),
            None,
            Vec::new(),
            "wait for the dependency".to_string(),
        )
        .await
        .expect("prepare root reservation");
    assert!(
        session
            .defer_root_after_tools(turn)
            .await
            .expect("park at tool boundary")
    );
    assert!(session.finish_deferred_root(turn).await);
    assert!(session.active_turn.lock().await.is_none());
    assert_eq!(
        session.root_resume_record().expect("waiting record").state,
        RootResumeState::Waiting
    );
    record
}

#[tokio::test]
async fn parked_root_does_not_sample_and_deadline_dispatches_once() {
    let server = start_mock_server().await;
    let requests = mount_sse_once(
        &server,
        sse(vec![ev_response_created("resume"), ev_completed("resume")]),
    )
    .await;
    let clock = Arc::new(FakeClock::new());
    let home = tempfile::tempdir().expect("temporary Codex home");
    let (session, turn, _events) = make_persistent_session_and_context_with_time_provider_and_rx(
        home.path(),
        InitialHistory::New,
        clock.clone(),
        format!("{}/v1", server.uri()),
    )
    .await
    .expect("persistent session fixture");

    park_root(&session, &turn, 1_000).await;
    while clock.sleep_count() == 0 {
        tokio::task::yield_now().await;
    }
    assert!(requests.requests().is_empty());

    clock.advance(Duration::from_millis(999));
    tokio::task::yield_now().await;
    assert_eq!(
        session.root_resume_record().expect("waiting record").state,
        RootResumeState::Waiting
    );
    assert!(requests.requests().is_empty());

    clock.advance(Duration::from_millis(1));
    let resumed = wait_for_state(&session, RootResumeState::Resumed).await;
    assert_eq!(resumed.wake_reason, Some(RootResumeWakeReason::Deadline));

    tokio::time::timeout(Duration::from_secs(10), async {
        while requests.requests().is_empty() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("deadline continuation request");
    let request = requests.single_request();
    assert!(
        request
            .message_input_texts("developer")
            .iter()
            .any(|text| { text.contains("Root wait ended: deadline reached") })
    );
    clock.advance(Duration::from_secs(60));
    tokio::task::yield_now().await;
    assert_eq!(requests.requests().len(), 1);
}

#[tokio::test]
async fn stopping_parked_root_emits_one_interruption_and_prevents_wakeup() {
    for manual_stop in [true, false] {
        let server = start_mock_server().await;
        let requests = mount_sse_once(&server, sse(vec![ev_completed("unused")])).await;
        let clock = Arc::new(FakeClock::new());
        let home = tempfile::tempdir().expect("temporary Codex home");
        let (session, turn, events) =
            make_persistent_session_and_context_with_time_provider_and_rx(
                home.path(),
                InitialHistory::New,
                clock.clone(),
                format!("{}/v1", server.uri()),
            )
            .await
            .expect("persistent session fixture");
        let record = park_root(&session, &turn, 1_000).await;
        if manual_stop {
            session.interrupt_task().await;
        } else {
            session
                .cancel_root_reservation(&record.id, session.root_resume_record().unwrap().revision)
                .await
                .expect("cancel parked reservation");
        }
        session.interrupt_task().await;
        clock.advance(Duration::from_millis(2_000));
        tokio::task::yield_now().await;
        assert_eq!(
            session.root_resume_record().unwrap().state,
            RootResumeState::Cancelled
        );
        assert!(session.active_turn.lock().await.is_none());
        assert!(session.parked_root_context().is_none());
        assert!(session.is_interrupted());
        let mut interruptions = Vec::new();
        while let Ok(event) = events.try_recv() {
            match event.msg {
                EventMsg::TurnAborted(event) => interruptions.push(event),
                EventMsg::TurnComplete(_) => panic!("stop must not report successful completion"),
                _ => {}
            }
        }
        assert_eq!(interruptions.len(), 1);
        assert_eq!(
            interruptions[0].turn_id.as_deref(),
            Some(turn.sub_id.as_str())
        );
        assert_eq!(interruptions[0].reason, TurnAbortReason::Interrupted);
        assert!(requests.requests().is_empty());
    }
}

#[tokio::test]
async fn user_supersede_cancels_wait_without_sampling() {
    let server = start_mock_server().await;
    let requests = mount_sse_once(&server, sse(vec![ev_completed("unused")])).await;
    let clock = Arc::new(FakeClock::new());
    let home = tempfile::tempdir().expect("temporary Codex home");
    let (session, turn, _events) = make_persistent_session_and_context_with_time_provider_and_rx(
        home.path(),
        InitialHistory::New,
        clock.clone(),
        format!("{}/v1", server.uri()),
    )
    .await
    .expect("persistent session fixture");

    let original = park_root(&session, &turn, 1_000).await;
    assert_eq!(
        session
            .supersede_root_resume()
            .await
            .expect("supersede reservation"),
        Some(original.root_turn_id)
    );
    let cancelled = session.root_resume_record().expect("cancelled record");
    assert_eq!(cancelled.state, RootResumeState::Cancelled);
    assert_eq!(cancelled.wake_reason, Some(RootResumeWakeReason::UserInput));
    let thread_id = session.thread_id;
    session.stop_root_resume_timer();
    drop(turn);
    drop(session);
    let (restarted, _turn, _events) =
        make_persistent_session_and_context_with_time_provider_and_rx(
            home.path(),
            InitialHistory::Resumed(ResumedHistory {
                conversation_id: thread_id,
                history: Arc::new(Vec::new()),
                history_revision: None,
                rollout_path: None,
            }),
            clock.clone(),
            format!("{}/v1", server.uri()),
        )
        .await
        .expect("restart after cancellation");
    restarted
        .recover_root_resume()
        .await
        .expect("cancelled reservation remains inactive");
    assert!(restarted.root_resume_record().is_none());
    clock.advance(Duration::from_secs(60));
    tokio::task::yield_now().await;
    assert!(requests.requests().is_empty());
}

#[tokio::test]
async fn waiting_reservation_is_recovered_once_after_restart() {
    let server = start_mock_server().await;
    let requests = mount_sse_once(
        &server,
        sse(vec![
            ev_response_created("recovered"),
            ev_completed("recovered"),
        ]),
    )
    .await;
    let clock = Arc::new(FakeClock::new());
    let home = tempfile::tempdir().expect("temporary Codex home");
    let (first, turn, _first_events) =
        make_persistent_session_and_context_with_time_provider_and_rx(
            home.path(),
            InitialHistory::New,
            clock.clone(),
            format!("{}/v1", server.uri()),
        )
        .await
        .expect("first persistent session fixture");
    park_root(&first, &turn, 1_000).await;
    tokio::time::timeout(Duration::from_secs(10), async {
        while clock.sleep_count() == 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("initial reservation timer should arm");
    let thread_id = first.thread_id;
    first.stop_root_resume_timer();
    drop(turn);
    drop(first);

    let (restarted, _turn, _events) =
        make_persistent_session_and_context_with_time_provider_and_rx(
            home.path(),
            InitialHistory::Resumed(ResumedHistory {
                conversation_id: thread_id,
                history: Arc::new(Vec::new()),
                history_revision: None,
                rollout_path: None,
            }),
            clock.clone(),
            format!("{}/v1", server.uri()),
        )
        .await
        .expect("restarted persistent session fixture");
    restarted
        .recover_root_resume()
        .await
        .expect("recover waiting reservation");
    tokio::time::timeout(Duration::from_secs(10), async {
        while clock.sleep_count() < 2 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("recovered reservation timer should arm");
    assert!(requests.requests().is_empty());

    clock.advance(Duration::from_millis(1_000));
    let resumed = wait_for_state(&restarted, RootResumeState::Resumed).await;
    assert_eq!(resumed.wake_reason, Some(RootResumeWakeReason::Deadline));
    tokio::time::timeout(Duration::from_secs(10), async {
        while requests.requests().is_empty() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("recovered continuation request");
    assert_eq!(requests.requests().len(), 1);
}

#[tokio::test]
async fn codex_thread_steer_wakes_matching_parked_root_and_returns_actual_turn_id() {
    let server = start_mock_server().await;
    Mock::given(method("POST"))
        .and(path_regex(".*/responses$"))
        .respond_with(
            core_test_support::responses::sse_response(sse(vec![
                ev_response_created("wake-turn"),
                ev_completed("wake-turn"),
            ]))
            .set_delay(Duration::from_secs(60)),
        )
        .mount(&server)
        .await;
    let home = tempfile::tempdir().expect("temporary Codex home");
    let mut config = build_test_config(home.path()).await;
    config
        .features
        .enable(codex_features::Feature::MultiAgentV2)
        .expect("multi-agent v2 should be enableable in tests");
    config.multi_agent_v2.tool_namespace =
        Some(crate::config::AZRAEL_AGENT_TOOL_NAMESPACE.to_string());
    config.model_provider.base_url = Some(format!("{}/v1", server.uri()));
    let state_db = init_state_db(&config).await;
    let manager = ThreadManager::with_models_provider_home_and_state_for_tests(
        CodexAuth::from_api_key("Test API Key"),
        config.model_provider.clone(),
        config.codex_home.to_path_buf(),
        Arc::new(codex_exec_server::EnvironmentManager::default_for_tests()),
        state_db,
    );
    let root = manager
        .start_thread(StartThreadOptions::new(config))
        .await
        .expect("start root thread");
    let turn = root.thread.session.new_default_turn().await;
    park_root(&root.thread.session, &turn, 60_000).await;
    let parked = root.thread.session.root_resume_record().unwrap();

    let request = || {
        TurnInputRequest::user_input(vec![UserInput::Text {
            text: "wake the parked root".to_string(),
            text_elements: Vec::new(),
        }])
    };
    assert_eq!(
        root.thread
            .steer_turn(request(), "different-turn".to_string())
            .await
            .expect("mismatched steer should return a typed rejection"),
        SteerSubmission::NotSubmitted {
            reason: NotSubmittedReason::NoActiveTurn,
        }
    );
    assert_eq!(root.thread.session.root_resume_record(), Some(parked));
    assert!(root.thread.session.active_turn.lock().await.is_none());

    let submission = root
        .thread
        .steer_turn(request(), turn.sub_id.clone())
        .await
        .expect("matching parked-root steer should start a turn without panicking");
    let SteerSubmission::Started { turn_id } = submission else {
        panic!("parked-root steer did not start a turn: {submission:?}");
    };
    assert_ne!(turn_id, turn.sub_id);
    let active_turn_id = root
        .thread
        .session
        .active_turn
        .lock()
        .await
        .as_ref()
        .expect("wake turn remains active")
        .task
        .as_ref()
        .expect("wake task exists")
        .turn_context
        .sub_id
        .clone();
    assert_eq!(turn_id, active_turn_id);
    let cancelled = root.thread.session.root_resume_record().unwrap();
    assert_eq!(cancelled.state, RootResumeState::Cancelled);
    assert_eq!(cancelled.wake_reason, Some(RootResumeWakeReason::UserInput));
    assert_eq!(
        root.thread
            .steer_turn(request(), turn_id.clone())
            .await
            .expect("ordinary active-turn steer should remain accepted"),
        SteerSubmission::Steered { turn_id }
    );
    root.thread
        .submit(codex_protocol::protocol::Op::Interrupt)
        .await
        .expect("interrupt test wake turn");
}

#[tokio::test]
async fn selected_child_wakes_only_after_its_pinned_turn_is_terminal() {
    let server = start_mock_server().await;
    Mock::given(method("POST"))
        .and(path_regex(".*/responses$"))
        .respond_with(
            core_test_support::responses::sse_response(sse(vec![
                ev_response_created("agent-turn"),
                ev_assistant_message("agent-message", "child-result"),
                ev_completed("agent-turn"),
            ]))
            .set_delay(Duration::from_secs(2)),
        )
        .mount(&server)
        .await;

    let home = tempfile::tempdir().expect("temporary Codex home");
    let mut config = build_test_config(home.path()).await;
    config
        .features
        .enable(codex_features::Feature::MultiAgentV2)
        .expect("multi-agent v2 should be enableable in tests");
    config.multi_agent_v2.tool_namespace =
        Some(crate::config::AZRAEL_AGENT_TOOL_NAMESPACE.to_string());
    config.model_provider.base_url = Some(format!("{}/v1", server.uri()));
    let state_db = init_state_db(&config).await;
    let manager = ThreadManager::with_models_provider_home_and_state_for_tests(
        CodexAuth::from_api_key("Test API Key"),
        config.model_provider.clone(),
        config.codex_home.to_path_buf(),
        Arc::new(codex_exec_server::EnvironmentManager::default_for_tests()),
        state_db,
    );
    let root = manager
        .start_thread(StartThreadOptions::new(config.clone()))
        .await
        .expect("start root thread");
    let control = root.thread.session.services.agent_control.clone();
    let child_source = thread_spawn_source(
        root.thread_id,
        &root.thread.session_source,
        1,
        None,
        Some("worker".to_string()),
    )
    .expect("selected child source");
    let (child_agent, _) = control
        .spawn(crate::agent::api::SpawnRequest {
            caller: root.thread_id,
            config,
            input: crate::agent::api::AgentInput::UserInput(vec![UserInput::Text {
                text: "complete after the parent parks".to_string(),
                text_elements: Vec::new(),
            }]),
            source: child_source,
            options: crate::agent::types::SpawnAgentOptions::default(),
        })
        .await
        .expect("spawn selected child");
    let child_id = child_agent.thread_id;
    let child = manager
        .get_thread(child_id)
        .await
        .expect("selected child thread");
    let pinned = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if child.session.root_resume_task_identity().await.is_some() {
                break control
                    .root_resume_agent_task(child_id)
                    .await
                    .expect("selected child task should have registered agent metadata");
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await;
    let pinned = match pinned {
        Ok(pinned) => pinned,
        Err(_) => {
            let child_status = child.agent_status().await;
            let active_turn = child.session.active_turn.lock().await.is_some();
            let request_count = server
                .received_requests()
                .await
                .map_or(0, |requests| requests.len());
            panic!(
                "selected child task identity did not become visible: status={child_status:?}, active_turn={active_turn}, request_count={request_count}"
            );
        }
    };
    assert!(child.session.active_turn.lock().await.is_some());

    let turn = root.thread.session.new_default_turn().await;
    root.thread
        .session
        .prepare_root_resume(
            &turn,
            "child-call",
            Some(60_000),
            None,
            vec![pinned.agent_path.clone()],
            "wait for selected child".to_string(),
        )
        .await
        .expect("prepare selected-child reservation");
    assert!(
        root.thread
            .session
            .defer_root_after_tools(&turn)
            .await
            .expect("park selected-child reservation")
    );
    assert!(root.thread.session.finish_deferred_root(&turn).await);

    child
        .session
        .agent_status
        .send(crate::agent::AgentStatus::Completed(Some(
            "status arrived before terminal bookkeeping".to_string(),
        )))
        .expect("publish premature terminal-looking status");
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
    assert_eq!(
        root.thread
            .session
            .root_resume_record()
            .expect("waiting reservation")
            .state,
        RootResumeState::Waiting
    );
    assert_eq!(
        response_request_count_for_thread(&server, root.thread_id).await,
        0,
        "a premature child status must not sample the parked root"
    );

    let resumed = wait_for_state(&root.thread.session, RootResumeState::Resumed).await;
    assert_eq!(
        resumed.wake_reason,
        Some(RootResumeWakeReason::AgentsCompleted)
    );
    assert_eq!(
        pinned.turn_id,
        child.session.root_resume_task_identity().await.unwrap()
    );
    let history = root.thread.session.clone_history().await;
    assert!(history.raw_items().any(|item| {
        matches!(
            item,
            ResponseItem::AgentMessage { content, .. }
                if content.iter().any(|part| matches!(
                    part,
                    AgentMessageInputContent::InputText { text } if text.contains("child-result")
                ))
        )
    }));
    tokio::time::timeout(Duration::from_secs(10), async {
        while response_request_count_for_thread(&server, root.thread_id).await == 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("selected child continuation request");
    assert_eq!(
        response_request_count_for_thread(&server, root.thread_id).await,
        1,
        "selected child completion should dispatch one continuation"
    );
}

#[tokio::test]
async fn real_turn_parks_after_defer_tool_without_polling() {
    let server = start_mock_server().await;
    let requests = mount_sse_sequence(
        &server,
        vec![
            sse(vec![
                ev_response_created("defer-response"),
                ev_function_call_with_namespace(
                    "defer-call",
                    crate::config::AZRAEL_AGENT_TOOL_NAMESPACE,
                    "defer_root",
                    r#"{"resume_after_ms":1000,"reason":"wait for the dependency"}"#,
                ),
                ev_completed("defer-response"),
            ]),
            sse(vec![
                ev_response_created("resume-response"),
                ev_completed("resume-response"),
            ]),
        ],
    )
    .await;
    let clock = Arc::new(FakeClock::new());
    let home = tempfile::tempdir().expect("temporary Codex home");
    let (session, turn, events) = make_persistent_session_and_context_with_time_provider_and_rx(
        home.path(),
        InitialHistory::New,
        clock.clone(),
        format!("{}/v1", server.uri()),
    )
    .await
    .expect("persistent session fixture");
    session
        .start_task(
            Arc::clone(&turn),
            vec![TurnInput::ResponseItem(ResponseItemEnvelope::new(
                ResponseItem::Message {
                    id: None,
                    role: "user".to_string(),
                    content: vec![ContentItem::InputText {
                        text: "park this root".to_string(),
                    }],
                    phase: None,
                    internal_chat_message_metadata_passthrough: None,
                },
            ))],
            RegularTask::new(),
        )
        .await;

    let (deferred, wait_update) = tokio::time::timeout(Duration::from_secs(10), async {
        let mut wait_update = None;
        loop {
            match events.recv().await.expect("root lifecycle event").msg {
                EventMsg::RootResumeWaitUpdated(event) => wait_update = Some(event),
                EventMsg::TurnDeferred(event) => {
                    break (
                        event,
                        wait_update.expect("durable wait update precedes defer"),
                    );
                }
                EventMsg::Error(error) => panic!("real defer_root turn failed: {error:?}"),
                EventMsg::TurnComplete(event) => {
                    panic!("real defer_root turn completed instead of parking: {event:?}")
                }
                _ => {}
            }
        }
    })
    .await
    .expect("real defer_root turn should park");
    assert_eq!(deferred.turn_id, turn.sub_id);
    assert_eq!(
        deferred.reservation_id,
        session.root_resume_record().unwrap().id
    );
    assert!(deferred.started_at.is_some());
    assert!(deferred.deferred_at.is_some());
    assert!(deferred.duration_ms.is_some());
    let wait = deferred
        .wait
        .as_ref()
        .expect("durable deferred wait metadata");
    assert_eq!(
        wait,
        &codex_protocol::root_resume::RootResumeWait::from(&session.root_resume_record().unwrap())
    );
    assert_eq!(wait_update.turn_id, deferred.turn_id);
    assert_eq!(&wait_update.wait, wait);
    assert!(wait.wait_started_at_ms.is_some());
    assert_eq!(wait.wait_ended_at_ms, None);
    while clock.sleep_count() == 0 {
        tokio::task::yield_now().await;
    }
    assert_eq!(requests.requests().len(), 1);
    assert_eq!(
        session.root_resume_record().expect("waiting record").state,
        RootResumeState::Waiting
    );

    clock.advance(Duration::from_millis(1_000));
    let resumed = wait_for_state(&session, RootResumeState::Resumed).await;
    assert_eq!(resumed.wake_reason, Some(RootResumeWakeReason::Deadline));
    assert_eq!(resumed.wait_started_at_ms, wait.wait_started_at_ms);
    assert!(resumed.wait_ended_at_ms.is_some());
    tokio::time::timeout(Duration::from_secs(10), async {
        while requests.requests().len() < 2 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("one continuation sample should start");
    assert_eq!(requests.requests().len(), 2);
}

#[tokio::test]
async fn queued_compact_preserves_root_resume_reservation() {
    let (session, _) = crate::session::tests::make_session_and_context().await;
    let session = Arc::new(session);
    let reservation = RootResumeReservation {
        wait_started_at_ms: None,
        wait_ended_at_ms: None,

        id: "queued-compact-reservation".to_string(),
        root_thread_id: session.thread_id.to_string(),
        originating_turn_id: "origin".to_string(),
        root_turn_id: "root".to_string(),
        call_id: "call".to_string(),
        resume_turn_id: "resume".to_string(),
        resume_at_ms: START_MS,
        created_at_ms: START_MS,
        updated_at_ms: START_MS,
        revision: 1,
        state: RootResumeState::Waiting,
        agent_tasks: Vec::new(),
        completion_tasks: Vec::new(),
        reason: "reservation test".to_string(),
        final_output_json_schema: None,
        wake_reason: None,
        last_error: None,
    };
    session.set_root_resume_record(Some(reservation.clone()));
    assert_eq!(
        crate::session::compact_input::handle(&session, "compact-reserved-root".to_string())
            .await
            .unwrap(),
        codex_protocol::turn_input::CompactIfIdleSubmission::NotSubmitted {
            reason: codex_protocol::turn_input::NotSubmittedReason::NotIdle
        }
    );
    assert_eq!(session.root_resume_record(), Some(reservation));
    assert!(session.active_turn.lock().await.is_none());
}

use super::lifecycle_tests::{FakeClock, wait_for_state};
use super::*;
use crate::session::tests::make_persistent_session_and_context_with_time_provider_and_rx;
use crate::session::work_completion::{WorkCompletionSignal, WorkCompletionState};
use codex_history::{InitialHistory, ResumedHistory};
use core_test_support::responses::{
    ev_completed, ev_response_created, mount_sse_once, sse, start_mock_server,
};
use std::io::Write;

fn signal(id: &str, state: WorkCompletionState) -> WorkCompletionSignal {
    WorkCompletionSignal {
        work_id: id.to_string(),
        state,
        summary: Some("native producer completed".to_string()),
        exit_code: None,
    }
}

async fn park(session: &Arc<Session>, turn: &Arc<TurnContext>, ids: Vec<String>) {
    let prepared = session
        .prepare_root_resume_with_work(
            turn,
            "work-call",
            Some(60_000),
            None,
            Vec::new(),
            ids.clone(),
            "wait for native work".to_string(),
        )
        .await
        .unwrap();
    assert_eq!(prepared.completion_tasks, ids);
    assert!(session.defer_root_after_tools(turn).await.unwrap());
    assert!(session.finish_deferred_root(turn).await);
    assert!(session.active_turn.lock().await.is_none());
}

async fn timer_armed(clock: &FakeClock) {
    tokio::time::timeout(Duration::from_secs(10), async {
        while clock.sleep_count() == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("reservation timer registered");
}

async fn wait_for_request(requests: &core_test_support::responses::ResponseMock) {
    tokio::time::timeout(Duration::from_secs(10), async {
        while requests.requests().is_empty() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("one continuation request");
    assert_eq!(requests.requests().len(), 1);
}

#[tokio::test]
async fn native_terminal_outcomes_resume_once_without_sampling_while_running() {
    for state in [
        WorkCompletionState::Succeeded,
        WorkCompletionState::Failed,
        WorkCompletionState::Cancelled,
    ] {
        let server = start_mock_server().await;
        let requests = mount_sse_once(
            &server,
            sse(vec![
                ev_response_created("work-resume"),
                ev_completed("work-resume"),
            ]),
        )
        .await;
        let home = tempfile::tempdir().unwrap();
        let clock = Arc::new(FakeClock::new());
        let (session, turn, _events) =
            make_persistent_session_and_context_with_time_provider_and_rx(
                home.path(),
                InitialHistory::New,
                clock.clone(),
                format!("{}/v1", server.uri()),
            )
            .await
            .unwrap();
        let store = session.work_completion_store().await;
        let work = store.create("native task".to_string(), 1).await.unwrap();
        park(&session, &turn, vec![work.work_id.clone()]).await;
        timer_armed(&clock).await;
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert_eq!(
            session.root_resume_record().unwrap().state,
            RootResumeState::Waiting
        );
        assert!(requests.requests().is_empty());
        let terminal = signal(&work.work_id, state.clone());
        store.finish(terminal.clone()).await.unwrap();
        let resumed = wait_for_state(&session, RootResumeState::Resumed).await;
        assert_eq!(
            resumed.wake_reason,
            Some(RootResumeWakeReason::WorkCompleted)
        );
        wait_for_request(&requests).await;
        let request = requests.single_request();
        assert!(request.message_input_texts("developer").iter().any(|text| {
            text.contains(&work.work_id) && text.contains("Read work_completion status")
        }));
        assert_eq!(store.status(work.work_id).await.unwrap().state, state);
        store.finish(terminal).await.unwrap();
        clock.advance(Duration::from_secs(120));
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert_eq!(requests.requests().len(), 1);
        session.stop_root_resume_timer();
    }
}

#[tokio::test]
async fn already_completed_and_all_selected_work_gate_early_resume() {
    for already_completed in [false, true] {
        let server = start_mock_server().await;
        let requests = mount_sse_once(
            &server,
            sse(vec![
                ev_response_created("all-work"),
                ev_completed("all-work"),
            ]),
        )
        .await;
        let home = tempfile::tempdir().unwrap();
        let clock = Arc::new(FakeClock::new());
        let (session, turn, _events) =
            make_persistent_session_and_context_with_time_provider_and_rx(
                home.path(),
                InitialHistory::New,
                clock,
                format!("{}/v1", server.uri()),
            )
            .await
            .unwrap();
        let store = session.work_completion_store().await;
        let first = store.create("first".to_string(), 1).await.unwrap();
        let second = store.create("second".to_string(), 2).await.unwrap();
        store
            .finish(signal(&first.work_id, WorkCompletionState::Succeeded))
            .await
            .unwrap();
        if already_completed {
            store
                .finish(signal(&second.work_id, WorkCompletionState::Cancelled))
                .await
                .unwrap();
        }
        park(&session, &turn, vec![first.work_id, second.work_id.clone()]).await;
        if !already_completed {
            tokio::time::sleep(Duration::from_millis(30)).await;
            assert_eq!(
                session.root_resume_record().unwrap().state,
                RootResumeState::Waiting
            );
            assert!(requests.requests().is_empty());
            store
                .finish(signal(&second.work_id, WorkCompletionState::Failed))
                .await
                .unwrap();
        }
        assert_eq!(
            wait_for_state(&session, RootResumeState::Resumed)
                .await
                .wake_reason,
            Some(RootResumeWakeReason::WorkCompleted)
        );
        wait_for_request(&requests).await;
        session.stop_root_resume_timer();
    }
}

#[tokio::test]
async fn deadline_manual_and_cancel_preserve_running_work_meaning() {
    for action in ["deadline", "manual", "cancel"] {
        let server = start_mock_server().await;
        let requests = mount_sse_once(
            &server,
            sse(vec![
                ev_response_created("fallback"),
                ev_completed("fallback"),
            ]),
        )
        .await;
        let home = tempfile::tempdir().unwrap();
        let clock = Arc::new(FakeClock::new());
        let (session, turn, _events) =
            make_persistent_session_and_context_with_time_provider_and_rx(
                home.path(),
                InitialHistory::New,
                clock.clone(),
                format!("{}/v1", server.uri()),
            )
            .await
            .unwrap();
        let store = session.work_completion_store().await;
        let work = store.create("still running".to_string(), 1).await.unwrap();
        park(&session, &turn, vec![work.work_id.clone()]).await;
        timer_armed(&clock).await;
        let reservation = session.root_resume_record().unwrap();
        match action {
            "deadline" => clock.advance(Duration::from_secs(60)),
            "manual" => session
                .manually_resume_root(&reservation.id, reservation.revision)
                .await
                .unwrap(),
            _ => session
                .cancel_root_reservation(&reservation.id, reservation.revision)
                .await
                .unwrap(),
        }
        assert_eq!(
            store.status(work.work_id.clone()).await.unwrap().state,
            WorkCompletionState::Running
        );
        if action == "cancel" {
            store
                .finish(signal(&work.work_id, WorkCompletionState::Succeeded))
                .await
                .unwrap();
            clock.advance(Duration::from_secs(120));
            tokio::time::sleep(Duration::from_millis(30)).await;
            assert_eq!(
                session.root_resume_record().unwrap().state,
                RootResumeState::Cancelled
            );
            assert!(requests.requests().is_empty());
        } else {
            let resumed = wait_for_state(&session, RootResumeState::Resumed).await;
            assert_eq!(
                resumed.wake_reason,
                Some(if action == "deadline" {
                    RootResumeWakeReason::Deadline
                } else {
                    RootResumeWakeReason::Manual
                })
            );
            wait_for_request(&requests).await;
            assert!(
                requests
                    .single_request()
                    .message_input_texts("developer")
                    .iter()
                    .any(|text| {
                        text.contains("does not establish completion or success")
                            && text.contains(&work.work_id)
                    })
            );
        }
        session.stop_root_resume_timer();
    }
}

#[tokio::test]
async fn unknown_duplicate_and_cross_thread_work_ids_are_rejected() {
    let home = tempfile::tempdir().unwrap();
    let clock = Arc::new(FakeClock::new());
    let (session, turn, _events) = make_persistent_session_and_context_with_time_provider_and_rx(
        home.path(),
        InitialHistory::New,
        clock.clone(),
        "http://127.0.0.1:9/v1".to_string(),
    )
    .await
    .unwrap();
    let (foreign, _turn, _events) = make_persistent_session_and_context_with_time_provider_and_rx(
        home.path(),
        InitialHistory::New,
        clock,
        "http://127.0.0.1:9/v1".to_string(),
    )
    .await
    .unwrap();
    let owned = session
        .work_completion_store()
        .await
        .create("owned".to_string(), 1)
        .await
        .unwrap();
    let other = foreign
        .work_completion_store()
        .await
        .create("foreign".to_string(), 1)
        .await
        .unwrap();
    for ids in [
        vec![uuid::Uuid::new_v4().to_string()],
        vec![owned.work_id.clone(), owned.work_id],
        vec![other.work_id],
    ] {
        assert!(
            session
                .prepare_root_resume_with_work(
                    &turn,
                    "invalid-work",
                    Some(1_000),
                    None,
                    Vec::new(),
                    ids,
                    "invalid target".to_string()
                )
                .await
                .is_err()
        );
        assert!(session.root_resume_record().is_none());
    }
}

#[tokio::test]
async fn malformed_external_signal_blocks_without_sampling() {
    let server = start_mock_server().await;
    let requests = mount_sse_once(&server, sse(vec![ev_completed("unused")])).await;
    let home = tempfile::tempdir().unwrap();
    let clock = Arc::new(FakeClock::new());
    let (session, turn, _events) = make_persistent_session_and_context_with_time_provider_and_rx(
        home.path(),
        InitialHistory::New,
        clock.clone(),
        format!("{}/v1", server.uri()),
    )
    .await
    .unwrap();
    let work = session
        .work_completion_store()
        .await
        .create("external task".to_string(), 1)
        .await
        .unwrap();
    park(&session, &turn, vec![work.work_id.clone()]).await;
    let mut file = tempfile::NamedTempFile::new_in(work.signal_path.parent().unwrap()).unwrap();
    file.write_all(b"{broken").unwrap();
    file.persist_noclobber(&work.signal_path).unwrap();
    let blocked = wait_for_state(&session, RootResumeState::Blocked).await;
    assert_ne!(
        blocked.wake_reason,
        Some(RootResumeWakeReason::WorkCompleted)
    );
    assert!(requests.requests().is_empty());
    assert!(
        session
            .work_completion_store()
            .await
            .status(work.work_id)
            .await
            .is_err()
    );
    clock.advance(Duration::from_secs(120));
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert!(requests.requests().is_empty());
    session.stop_root_resume_timer();
}

#[tokio::test]
async fn waiting_work_reservation_recovers_durable_external_completion_once() {
    let server = start_mock_server().await;
    let requests = mount_sse_once(
        &server,
        sse(vec![
            ev_response_created("recovery"),
            ev_completed("recovery"),
        ]),
    )
    .await;
    let home = tempfile::tempdir().unwrap();
    let clock = Arc::new(FakeClock::new());
    let (session, turn, _events) = make_persistent_session_and_context_with_time_provider_and_rx(
        home.path(),
        InitialHistory::New,
        clock.clone(),
        format!("{}/v1", server.uri()),
    )
    .await
    .unwrap();
    let work = session
        .work_completion_store()
        .await
        .create("durable work".to_string(), 1)
        .await
        .unwrap();
    park(&session, &turn, vec![work.work_id.clone()]).await;
    timer_armed(&clock).await;
    let thread_id = session.thread_id;
    session.stop_root_resume_timer();
    drop(turn);
    drop(session);
    let mut file = tempfile::NamedTempFile::new_in(work.signal_path.parent().unwrap()).unwrap();
    serde_json::to_writer(
        &mut file,
        &signal(&work.work_id, WorkCompletionState::Failed),
    )
    .unwrap();
    file.as_file().sync_all().unwrap();
    file.persist_noclobber(&work.signal_path).unwrap();
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
        .unwrap();
    restarted.recover_root_resume().await.unwrap();
    let resumed = wait_for_state(&restarted, RootResumeState::Resumed).await;
    assert_eq!(resumed.completion_tasks, vec![work.work_id.clone()]);
    assert_eq!(
        resumed.wake_reason,
        Some(RootResumeWakeReason::WorkCompleted)
    );
    wait_for_request(&requests).await;
    assert_eq!(
        restarted
            .work_completion_store()
            .await
            .status(work.work_id)
            .await
            .unwrap()
            .state,
        WorkCompletionState::Failed
    );
    restarted.recover_root_resume().await.unwrap();
    clock.advance(Duration::from_secs(120));
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert_eq!(requests.requests().len(), 1);
    restarted.stop_root_resume_timer();
}

#[tokio::test]
async fn selected_agents_and_work_both_must_complete_in_either_order() {
    use crate::ThreadManager;
    use crate::init_state_db;
    use crate::session::tests::build_test_config;
    use crate::thread_manager::StartThreadOptions;
    use crate::tools::handlers::multi_agents_common::thread_spawn_source;
    use codex_login::CodexAuth;
    use codex_protocol::user_input::UserInput;
    use wiremock::{
        Mock,
        matchers::{method, path_regex},
    };

    for work_first in [true, false] {
        let server = start_mock_server().await;
        Mock::given(method("POST"))
            .and(path_regex(".*/responses$"))
            .respond_with(
                core_test_support::responses::sse_response(sse(vec![
                    ev_response_created("mixed"),
                    ev_completed("mixed"),
                ]))
                .set_delay(Duration::from_secs(2)),
            )
            .mount(&server)
            .await;
        let home = tempfile::tempdir().unwrap();
        let mut config = build_test_config(home.path()).await;
        config
            .features
            .enable(codex_features::Feature::MultiAgentV2)
            .unwrap();
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
            .unwrap();
        let control = root.thread.session.services.agent_control.clone();
        let source = thread_spawn_source(
            root.thread_id,
            &root.thread.session_source,
            1,
            None,
            Some("worker".to_string()),
        )
        .unwrap();
        let (child_agent, _) = control
            .spawn(crate::agent::api::SpawnRequest {
                caller: root.thread_id,
                config,
                input: crate::agent::api::AgentInput::UserInput(vec![UserInput::Text {
                    text: "complete selected child".to_string(),
                    text_elements: Vec::new(),
                }]),
                source,
                options: crate::agent::types::SpawnAgentOptions::default(),
            })
            .await
            .unwrap();
        let child = manager.get_thread(child_agent.thread_id).await.unwrap();
        let pinned = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if child.session.root_resume_task_identity().await.is_some() {
                    break control
                        .root_resume_agent_task(child_agent.thread_id)
                        .await
                        .unwrap();
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let session = &root.thread.session;
        let store = session.work_completion_store().await;
        let work = store
            .create("mixed dependency".to_string(), 1)
            .await
            .unwrap();
        let turn = session.new_default_turn().await;
        session
            .prepare_root_resume_with_work(
                &turn,
                "mixed-call",
                Some(60_000),
                None,
                vec![pinned.agent_path.clone()],
                vec![work.work_id.clone()],
                "wait for both dependencies".to_string(),
            )
            .await
            .unwrap();
        assert!(session.defer_root_after_tools(&turn).await.unwrap());
        assert!(session.finish_deferred_root(&turn).await);
        if work_first {
            store
                .finish(signal(&work.work_id, WorkCompletionState::Succeeded))
                .await
                .unwrap();
            tokio::time::sleep(Duration::from_millis(30)).await;
        } else {
            tokio::time::timeout(
                Duration::from_secs(10),
                control.wait_root_resume_agent_task(&pinned),
            )
            .await
            .unwrap();
        }
        assert_eq!(
            session.root_resume_record().unwrap().state,
            RootResumeState::Waiting
        );
        let root_request_count = |requests: Vec<wiremock::Request>| {
            requests
                .iter()
                .filter(|request| {
                    request.body_json::<serde_json::Value>().is_ok_and(|body| {
                        body["client_metadata"]["thread_id"] == serde_json::json!(root.thread_id)
                    })
                })
                .count()
        };
        assert_eq!(
            root_request_count(server.received_requests().await.unwrap()),
            0
        );
        if !work_first {
            store
                .finish(signal(&work.work_id, WorkCompletionState::Failed))
                .await
                .unwrap();
        }
        assert_eq!(
            wait_for_state(session, RootResumeState::Resumed)
                .await
                .wake_reason,
            Some(RootResumeWakeReason::WorkCompleted)
        );
        tokio::time::timeout(Duration::from_secs(10), async {
            while root_request_count(server.received_requests().await.unwrap()) == 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            root_request_count(server.received_requests().await.unwrap()),
            1
        );
        session.stop_root_resume_timer();
    }
}

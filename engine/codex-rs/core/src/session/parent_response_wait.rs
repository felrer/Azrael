//! Nonterminal child parking. Checkpoints never sample a model or wake a parent.
use super::{Session, TurnContext};
use super::turn_context::NewTurnContextOptions;
use crate::state::ActiveTurn;
use crate::tasks::{RegularTask, SessionTask, SessionTaskResult};
use codex_protocol::error::{CodexErr, Result as CodexResult};
use codex_protocol::models::ResponseItem;
use codex_protocol::parent_request::{ParentResponseWait, ParentResponseWaitResult, ParentResponseWaitSettings};
use codex_protocol::protocol::{EventMsg, TurnAbortReason, TurnAbortedEvent, TurnDeferredEvent};
use futures::future::BoxFuture;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::{Mutex, Notify};
use tokio::sync::oneshot;
use tokio::time::Instant;

#[derive(Default)]
struct ParentResponseWaitControl {
    state: Mutex<Option<WaitingChild>>,
    deferred: AtomicBool,
    closed: AtomicBool,
    activity: Notify,
}

/// Admission can change while a task is installed. No model runs until the
/// successful installation and durable wait transition are both acknowledged.
struct ParentResponseResumeTask {
    ready: Mutex<Option<oneshot::Receiver<()>>>,
}

impl SessionTask for ParentResponseResumeTask {
    fn kind(&self) -> crate::state::TaskKind { crate::state::TaskKind::Regular }
    fn span_name(&self) -> &'static str { "session_task.parent_response_resume" }
    async fn run(self: Arc<Self>, session: Arc<Session>, turn: Arc<TurnContext>,
        input: Vec<super::input_queue::TurnInput>, cancellation: tokio_util::sync::CancellationToken,
    ) -> SessionTaskResult {
        let ready = self.ready.lock().await.take().expect("one resume task runner");
        tokio::select! {
            _ = cancellation.cancelled() => Ok(None),
            result = ready => {
                if result.is_err() {
                    // Cleanup cancels the running-task token before this returns;
                    // channel loss alone must never produce TurnComplete.
                    cancellation.cancelled().await;
                    return Ok(None);
                }
                Arc::new(RegularTask::new()).run(session, turn, input, cancellation).await
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::Mutex as StdMutex;

    #[derive(Clone)]
    struct Capture(Arc<StdMutex<Vec<u8>>>);

    impl Write for Capture {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
    }

    async fn waiting() -> WaitingChild {
        let (_, turn) = super::super::tests::make_session_and_context().await;
        WaitingChild {
            record: ParentResponseWait {
                wait_id: "wait-test".into(), request_id: "request-test".into(),
                child_task_id: turn.sub_id.clone(), child_thread_id: "child-test".into(),
                originating_call_id: "call-test".into(), started_at_ms: 0,
                last_checkpoint_at_ms: 0, ended_at_ms: None, measured_active_ms: 0, result: None, resume_settings: None, parked_at_ms: None,
            },
            turn: Arc::new(turn), started: None, parked: false, response_delivered: false, resume_failed: false, parent_thread_id: "parent-test".into(),
        }
    }

    #[tokio::test]
    async fn duration_starts_only_at_parking_and_logs_content_free_correlation() {
        let mut wait = waiting().await;
        assert_eq!(wait.elapsed_ms(), 0);
        wait.started = Some(Instant::now() - Duration::from_millis(1250));
        let bytes = Arc::new(StdMutex::new(Vec::new()));
        let writer = Capture(Arc::clone(&bytes));
        let subscriber = tracing_subscriber::fmt().without_time().with_ansi(false)
            .with_writer(move || writer.clone()).finish();
        tracing::subscriber::with_default(subscriber, || {
            wait.log("wait_started", "parent_response");
            wait.log("wait_checkpoint", "parent_response");
            wait.log("wait_ended", "answered");
        });
        assert!(wait.elapsed_ms() >= 1250);
        let log = String::from_utf8(bytes.lock().unwrap().clone()).unwrap();
        assert_eq!(log.lines().count(), 3);
        for line in log.lines() {
            assert!(line.contains("request_id=request-test"));
            assert!(line.contains("wait_id=wait-test"));
            assert!(line.contains("parent_thread_id=parent-test"));
            assert!(line.contains("child_thread_id=child-test"));
            assert!(line.contains("thread_id=child-test"));
            assert!(line.contains("blocked_wait_ms="));
        }
    }

    #[tokio::test]
    async fn notifications_coalesce_without_changing_task_or_deferred_state() {
        let control = ParentResponseWaitControl::default();
        let wait = waiting().await;
        let task = wait.record.child_task_id.clone();
        *control.state.lock().await = Some(wait);
        control.activity.notify_one();
        control.activity.notify_one();
        control.activity.notified().await;
        assert_eq!(control.state.lock().await.as_ref().unwrap().record.child_task_id, task);
        assert!(!control.deferred.load(Ordering::Acquire));
        assert!(tokio::time::timeout(Duration::from_millis(1), control.activity.notified()).await.is_err());
    }

    struct IdleTask;
    impl crate::tasks::SessionTask for IdleTask {
        fn kind(&self) -> crate::state::TaskKind { crate::state::TaskKind::Regular }
        fn span_name(&self) -> &'static str { "test.parent_response_wait" }
        async fn run(self: Arc<Self>, _session: Arc<Session>, _ctx: Arc<TurnContext>,
            _input: Vec<super::super::input_queue::TurnInput>, cancellation_token: tokio_util::sync::CancellationToken,
        ) -> crate::tasks::SessionTaskResult {
            cancellation_token.cancelled().await;
            Ok(None)
        }
    }

    #[tokio::test]
    async fn successful_await_parks_without_terminal_event_and_user_stop_cancels_once() {
        use codex_history::InitialHistory;
        use codex_protocol::models::FunctionCallOutputPayload;
        use codex_protocol::parent_request::{ParentRequest, ParentRequestDeliveryState, ParentRequestStatus};
        let home = tempfile::tempdir().unwrap();
        let (session, turn, events) = super::super::tests::make_persistent_session_and_context_with_time_provider_and_rx(
            home.path(), InitialHistory::New, Arc::new(crate::current_time::SystemTimeProvider),
            "http://127.0.0.1:1/v1".into(),
        ).await.unwrap();
        let db = session.state_db().unwrap();
        let request = ParentRequest {
            presentation: None,
            request_id: "park-request".into(), request_key: "park-key".into(),
            parent_thread_id: codex_protocol::ThreadId::new().to_string(),
            child_thread_id: session.thread_id.to_string(), child_task_id: turn.sub_id.clone(),
            question: "private question".into(), context: String::new(), recommendation: String::new(),
            blocked_action: String::new(), status: ParentRequestStatus::Pending,
            delivery_state: ParentRequestDeliveryState::Queued, delivery_reason: None, response: None,
            created_at_ms: 0, updated_at_ms: 0,
        };
        db.create_parent_request(&request).await.unwrap();
        db.set_parent_request_delivery(&request.request_id, ParentRequestDeliveryState::Delivered, None,
            chrono::Utc::now().timestamp_millis()).await.unwrap();
        let record = db.create_parent_response_wait(&ParentResponseWait {
            wait_id: "park-wait".into(), request_id: request.request_id.clone(),
            child_task_id: turn.sub_id.clone(), child_thread_id: session.thread_id.to_string(),
            originating_call_id: "park-call".into(), started_at_ms: 0, last_checkpoint_at_ms: 0,
            ended_at_ms: None, measured_active_ms: 0, result: None, resume_settings: None, parked_at_ms: None,
        }).await.unwrap();
        let control = session.parent_response_wait_control();
        *control.state.lock().await = Some(WaitingChild {
            record: record.clone(), turn: Arc::clone(&turn), started: None, parked: false, response_delivered: false, resume_failed: false,
            parent_thread_id: request.parent_thread_id,
        });
        session.start_task(Arc::clone(&turn), Vec::new(), IdleTask).await;
        let cancellation = session.active_turn.lock().await.as_ref().unwrap().task.as_ref().unwrap().cancellation_token.clone();
        assert!(!session.defer_parent_response_after_tools(&turn).await.unwrap());
        session.record_conversation_items(&turn, &turn.capture_current_model_info(), &[ResponseItem::FunctionCallOutput {
            id: None, call_id: Some("park-call".into()), name: None, namespace: None,
            output: FunctionCallOutputPayload::from_text(serde_json::json!({"waitId": "park-wait", "requestId": "park-request"}).to_string()),
            internal_chat_message_metadata_passthrough: None,
        }]).await;
        assert!(session.defer_parent_response_after_tools(&turn).await.unwrap());
        assert!(session.finish_deferred_parent_response(&turn).await);
        assert!(session.active_turn.lock().await.is_none());
        let before_stop: Vec<_> = std::iter::from_fn(|| events.try_recv().ok()).collect();
        assert!(before_stop.iter().any(|event| matches!(event.msg, EventMsg::TurnDeferred(_))));
        assert!(!before_stop.iter().any(|event| matches!(event.msg, EventMsg::TurnComplete(_) | EventMsg::TurnAborted(_))));
        session.cancel_parent_response_wait().await.unwrap();
        session.cancel_parent_response_wait().await.unwrap();
        let after_stop: Vec<_> = std::iter::from_fn(|| events.try_recv().ok()).collect();
        assert_eq!(after_stop.iter().filter(|event| matches!(event.msg, EventMsg::TurnAborted(_))).count(), 1);
        assert_eq!(db.get_parent_response_wait(&record.wait_id).await.unwrap().unwrap().result, Some(ParentResponseWaitResult::Interrupted));
        cancellation.cancel();
    }

    async fn persistent_wait(home: &std::path::Path, url: String) -> (Arc<Session>, Arc<TurnContext>, async_channel::Receiver<codex_protocol::protocol::Event>, ParentResponseWait) {
        use codex_protocol::parent_request::{ParentRequest, ParentRequestDeliveryState, ParentRequestStatus};
        let (session, turn, events) = super::super::tests::make_persistent_session_and_context_with_time_provider_and_rx(
            home, codex_history::InitialHistory::New, Arc::new(crate::current_time::SystemTimeProvider), url,
        ).await.unwrap();
        let db = session.state_db().unwrap();
        db.create_parent_request(&ParentRequest {
            presentation: None,
            request_id: "resume-request".into(), request_key: "resume-key".into(),
            parent_thread_id: codex_protocol::ThreadId::new().to_string(), child_thread_id: session.thread_id.to_string(),
            child_task_id: turn.sub_id.clone(), question: "private question".into(), context: String::new(),
            recommendation: String::new(), blocked_action: String::new(), status: ParentRequestStatus::Pending,
            delivery_state: ParentRequestDeliveryState::Queued, delivery_reason: None, response: None,
            created_at_ms: 0, updated_at_ms: 0,
        }).await.unwrap();
        db.set_parent_request_delivery("resume-request", ParentRequestDeliveryState::Delivered, None,
            chrono::Utc::now().timestamp_millis()).await.unwrap();
        let result = session.prepare_parent_response_wait(&turn, "resume-call", "resume-request").await.unwrap();
        let duplicate = session.prepare_parent_response_wait(&turn, "duplicate-call", "resume-request").await.unwrap();
        assert_eq!(duplicate["waitId"], result["waitId"]);
        let record = db.get_parent_response_wait(result["waitId"].as_str().unwrap()).await.unwrap().unwrap();
        session.record_conversation_items(&turn, &turn.capture_current_model_info(), &[
            ResponseItem::FunctionCall {
                id: None, name: "await_parent_response".into(), namespace: Some(crate::config::AZRAEL_AGENT_TOOL_NAMESPACE.into()),
                arguments: serde_json::json!({"request_id": "resume-request"}).to_string(), encrypted_function_args: None,
                call_id: "resume-call".into(), internal_chat_message_metadata_passthrough: None,
            },
            ResponseItem::FunctionCallOutput {
                id: None, call_id: Some("resume-call".into()), name: None, namespace: None,
                output: codex_protocol::models::FunctionCallOutputPayload::from_text(result.to_string()),
                internal_chat_message_metadata_passthrough: None,
            },
        ]).await;
        session.flush_rollout().await.unwrap();
        (session, turn, events, record)
    }

    #[tokio::test]
    async fn durable_response_resumes_original_task_once_with_attributed_mail() {
        use core_test_support::responses::{ev_response_created, ev_completed, mount_sse_once, sse, start_mock_server};
        use codex_protocol::parent_request::{ParentResponse, ParentRequestStatus};
        let server = start_mock_server().await;
        let requests = mount_sse_once(&server, sse(vec![ev_response_created("child-resume"), ev_completed("child-resume")])).await;
        let home = tempfile::tempdir().unwrap();
        let (session, turn, events, record) = persistent_wait(home.path(), format!("{}/v1", server.uri())).await;
        session.start_task(Arc::clone(&turn), Vec::new(), IdleTask).await;
        let cancellation = session.active_turn.lock().await.as_ref().unwrap().task.as_ref().unwrap().cancellation_token.clone();
        assert!(session.defer_parent_response_after_tools(&turn).await.unwrap());
        assert!(session.finish_deferred_parent_response(&turn).await);
        let db = session.state_db().unwrap();
        let request = db.get_parent_request(&record.request_id).await.unwrap().unwrap();
        db.respond_parent_request(&record.request_id, &request.parent_thread_id, &ParentResponse {
            status: ParentRequestStatus::Deferred, decision: "Await more input".into(), reason: "Need clarification".into(), retry_condition: Some("More input".into()),
        }, chrono::Utc::now().timestamp_millis()).await.unwrap();
        // A saved decision may race ahead of the attributed delivery callback.
        // Force an engine readiness check before mail arrives; no model may run.
        assert!(!session.resume_parent_response_if_ready().await.unwrap());
        tokio::task::yield_now().await;
        assert!(requests.requests().is_empty());
        assert!(session.active_turn.lock().await.is_none());
        session.enqueue_root_aware_mail(codex_protocol::protocol::InterAgentCommunication::new(
            codex_protocol::AgentPath::root(), codex_protocol::AgentPath::from_string("/root/child".into()).unwrap(),
            Vec::new(), "Parent deferred response: await more input; no approval".into(), false,
        ), Default::default()).await;
        session.notify_parent_response(&record.request_id).await.unwrap();
        session.notify_parent_response(&record.request_id).await.unwrap();
        let complete = tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                let event = events.recv().await.unwrap();
                if let EventMsg::TurnComplete(complete) = event.msg { break complete }
            }
        }).await.unwrap();
        assert_eq!(complete.turn_id, turn.sub_id);
        assert_eq!(requests.requests().len(), 1);
        assert_eq!(db.get_parent_response_wait(&record.wait_id).await.unwrap().unwrap().result, Some(ParentResponseWaitResult::Answered));
        let history = session.clone_history().await;
        assert!(history.raw_items().any(|item| matches!(item, ResponseItem::AgentMessage { .. })));
        cancellation.cancel();
    }

    #[tokio::test]
    async fn repeated_recovery_rotates_segments_without_losing_original_task_or_call() {
        let home = tempfile::tempdir().unwrap();
        let (session, turn, _events, original) = persistent_wait(home.path(), "http://127.0.0.1:1/v1".into()).await;
        let control = session.parent_response_wait_control();
        *control.state.lock().await = None;
        session.recover_parent_response_waits().await.unwrap();
        let first = control.state.lock().await.as_ref().unwrap().record.clone();
        assert_ne!(first.wait_id, original.wait_id);
        assert_eq!(first.child_task_id, turn.sub_id);
        *control.state.lock().await = None;
        session.recover_parent_response_waits().await.unwrap();
        let second = control.state.lock().await.as_ref().unwrap().record.clone();
        assert_ne!(second.wait_id, first.wait_id);
        assert_eq!(second.child_task_id, original.child_task_id);
        assert_eq!(second.originating_call_id, original.originating_call_id);
        assert_eq!(second.resume_settings, original.resume_settings);
        session.cancel_parent_response_wait().await.unwrap();
    }

    #[tokio::test]
    async fn answer_before_await_returns_immediately_without_new_wait() {
        use codex_protocol::parent_request::{ParentResponse, ParentRequestStatus};
        let home = tempfile::tempdir().unwrap();
        let (session, turn, _events, record) = persistent_wait(home.path(), "http://127.0.0.1:1/v1".into()).await;
        session.cancel_parent_response_wait().await.unwrap();
        let db = session.state_db().unwrap();
        let request = db.get_parent_request(&record.request_id).await.unwrap().unwrap();
        db.respond_parent_request(&record.request_id, &request.parent_thread_id, &ParentResponse {
            status: ParentRequestStatus::Resolved, decision: "Proceed".into(), reason: "Reviewed".into(), retry_condition: None,
        }, 1).await.unwrap();
        let result = session.prepare_parent_response_wait(&turn, "answered-call", &record.request_id).await.unwrap();
        assert_eq!(result["blockedWaitMs"], 0);
        assert_eq!(result["response"]["decision"], "Proceed");
        assert!(db.list_active_parent_response_waits(&session.thread_id.to_string()).await.unwrap().is_empty());
        assert!(!session.parent_response_turn_is_deferred());
    }

    #[tokio::test]
    async fn recovery_model_change_is_visible_and_does_not_rotate_wait() {
        let home = tempfile::tempdir().unwrap();
        let (session, _turn, events, original) = persistent_wait(home.path(), "http://127.0.0.1:1/v1".into()).await;
        let control = session.parent_response_wait_control();
        *control.state.lock().await = None;
        {
            let mut state = session.state.lock().await;
            Arc::make_mut(&mut state.session_configuration.step_settings).collaboration_mode.settings.model = "different-recovery-model".into();
        }
        session.recover_parent_response_waits().await.unwrap();
        assert!(control.state.lock().await.is_none());
        let waits = session.state_db().unwrap().list_active_parent_response_waits(&session.thread_id.to_string()).await.unwrap();
        assert_eq!(waits.len(), 1);
        assert_eq!(waits[0].wait_id, original.wait_id);
        let recorded: Vec<_> = std::iter::from_fn(|| events.try_recv().ok()).collect();
        assert!(recorded.iter().any(|event| matches!(&event.msg, EventMsg::Warning(warning) if warning.message.contains("execution_model_or_authority_changed"))));
    }

    #[tokio::test]
    async fn resume_failure_is_durable_visible_and_retains_parked_task_identity() {
        let home = tempfile::tempdir().unwrap();
        let (session, turn, events, record) = persistent_wait(home.path(), "http://127.0.0.1:1/v1".into()).await;
        let control = session.parent_response_wait_control();
        {
            let mut state = control.state.lock().await;
            let wait = state.as_mut().unwrap();
            wait.parked = true;
            wait.started = Some(Instant::now());
        }
        *session.active_turn.lock().await = Some(ActiveTurn::default());
        session.clear_failed_parent_response_admission(&turn.sub_id).await;
        assert!(session.active_turn.lock().await.is_none());
        assert!(session.fail_parent_response_resume().await);
        assert_eq!(session.parked_parent_response_task_identity().await.as_deref(), Some(turn.sub_id.as_str()));
        assert_eq!(session.state_db().unwrap().get_parent_response_wait(&record.wait_id).await.unwrap().unwrap().result,
            Some(ParentResponseWaitResult::WaitFailed));
        let before_stop: Vec<_> = std::iter::from_fn(|| events.try_recv().ok()).collect();
        assert!(before_stop.iter().any(|event| matches!(&event.msg, EventMsg::Warning(warning) if warning.message.contains("wait_failed_resume"))));
        assert!(!before_stop.iter().any(|event| matches!(event.msg, EventMsg::TurnComplete(_) | EventMsg::TurnAborted(_))));
        session.cancel_parent_response_wait().await.unwrap();
        assert!(session.parked_parent_response_task_identity().await.is_none());
    }

    #[tokio::test]
    async fn lost_resume_release_waits_for_cancellation_without_sampling() {
        let (session, turn) = super::super::tests::make_session_and_context().await;
        let (release, ready) = oneshot::channel();
        let task = Arc::new(ParentResponseResumeTask { ready: Mutex::new(Some(ready)) });
        let cancellation = tokio_util::sync::CancellationToken::new();
        let run = task.run(Arc::new(session), Arc::new(turn), Vec::new(), cancellation.clone());
        tokio::pin!(run);
        drop(release);
        assert!(tokio::time::timeout(Duration::from_millis(1), &mut run).await.is_err());
        cancellation.cancel();
        assert!(run.await.unwrap().is_none());
    }

    #[tokio::test]
    async fn actual_waiter_checkpoints_at_sixty_then_three_hundred_seconds_without_sampling() {
        let server = core_test_support::responses::start_mock_server().await;
        let home = tempfile::tempdir().unwrap();
        let (session, turn, _events, record) = persistent_wait(home.path(), format!("{}/v1", server.uri())).await;
        // Session::new schedules an independent WebSocket startup warmup. Join
        // its cancellation before measuring wait activity; this fixture never
        // executes a regular model turn and does not need a prewarmed client.
        if let Some(prewarm) = session.take_session_startup_prewarm().await {
            prewarm.abort().await;
        }
        let setup_http = server.received_requests().await.unwrap();
        let setup_routes: Vec<_> = setup_http.iter().take(8).map(|request| (
            request.method.to_string(), request.url.path().to_owned(),
            request.headers.get("upgrade").and_then(|value| value.to_str().ok()).map(str::to_owned),
            request.headers.get("connection").and_then(|value| value.to_str().ok())
                .is_some_and(|value| value.split(',').any(|token| token.trim().eq_ignore_ascii_case("upgrade"))),
            request.body.is_empty(),
        )).collect();
        // The HTTP-only mock cannot accept an upgrade or receive WebSocket
        // inference frames. Do not permit arbitrary GET /responses requests.
        assert!(setup_http.iter().all(|request| {
            request.method.as_str() == "GET" && (
                request.url.path().ends_with("/models") || (
                    request.url.path() == "/v1/responses" && request.body.is_empty()
                    && request.headers.get("upgrade").and_then(|value| value.to_str().ok())
                        .is_some_and(|value| value.eq_ignore_ascii_case("websocket"))
                    && request.headers.get("connection").and_then(|value| value.to_str().ok())
                        .is_some_and(|value| value.split(',').any(|token| token.trim().eq_ignore_ascii_case("upgrade")))
                )
            )
        }), "unexpected fixture HTTP (method/path/upgrade/connection-upgrade/empty-body only): {setup_routes:?}");
        eprintln!("timer_fixture_setup (method/path/upgrade/connection-upgrade/empty-body only): {setup_routes:?}");
        // Remove completed setup traffic and its mocks after the warmup joined.
        // The actual wait checkpoints retain the strict zero-HTTP invariant.
        server.reset().await;
        session.start_task(Arc::clone(&turn), Vec::new(), IdleTask).await;
        let cancellation = session.active_turn.lock().await.as_ref().unwrap().task.as_ref().unwrap().cancellation_token.clone();
        assert!(session.defer_parent_response_after_tools(&turn).await.unwrap());
        tokio::time::pause();
        // SQLx uses another thread. Keep Tokio runnable so its paused clock cannot
        // automatically jump to later timer deadlines while SQLx completes I/O.
        let keep_awake = tokio::spawn(async { loop { tokio::task::yield_now().await; } });
        let db = session.state_db().unwrap();
        // Preparation is not blocked time: advance ten minutes before parking.
        tokio::time::advance(Duration::from_secs(600)).await;
        let preparing = db.get_parent_response_wait(&record.wait_id).await.unwrap().unwrap();
        assert!(preparing.parked_at_ms.is_none());
        assert_eq!(preparing.measured_active_ms, 0);
        let park_utc_before = chrono::Utc::now().timestamp_millis();
        assert!(session.finish_deferred_parent_response(&turn).await);
        let park_utc_after = chrono::Utc::now().timestamp_millis();
        let parked = db.get_parent_response_wait(&record.wait_id).await.unwrap().unwrap();
        assert!((park_utc_before..=park_utc_after).contains(&parked.parked_at_ms.unwrap()));
        assert_eq!(parked.started_at_ms, record.started_at_ms);
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_secs(10)).await;
        session.notify_parent_response(&record.request_id).await.unwrap();
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_secs(10)).await;
        session.notify_parent_response(&record.request_id).await.unwrap();
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_secs(39)).await;
        assert_eq!(db.get_parent_response_wait(&record.wait_id).await.unwrap().unwrap().measured_active_ms, 0);
        tokio::time::advance(Duration::from_secs(1)).await;
        // Tokio's timer wheel rounds wakeups to millisecond ticks. The runnable
        // SQLx guard deliberately prevents automatic clock advancement.
        tokio::time::advance(Duration::from_millis(2)).await;
        let checkpoint_deadline = std::time::Instant::now() + Duration::from_secs(10);
        let first = loop {
            assert!(std::time::Instant::now() < checkpoint_deadline, "first wait checkpoint did not persist");
            let observed = db.get_parent_response_wait(&record.wait_id).await.unwrap().unwrap();
            if observed.measured_active_ms >= 60_000 { break observed }
            tokio::task::yield_now().await;
        };
        assert!(first.measured_active_ms < 61_000);
        // The durable write precedes the rest of the checkpoint log/status work.
        // Wait for that branch to finish before advancing its next sleep.
        drop(session.parent_response_wait_control().state.lock().await);
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_secs(100)).await;
        session.notify_parent_response(&record.request_id).await.unwrap();
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_secs(199)).await;
        assert_eq!(db.get_parent_response_wait(&record.wait_id).await.unwrap().unwrap().measured_active_ms, first.measured_active_ms);
        tokio::time::advance(Duration::from_secs(1)).await;
        tokio::time::advance(Duration::from_millis(2)).await;
        let checkpoint_deadline = std::time::Instant::now() + Duration::from_secs(10);
        let second = loop {
            assert!(std::time::Instant::now() < checkpoint_deadline, "second wait checkpoint did not persist");
            let observed = db.get_parent_response_wait(&record.wait_id).await.unwrap().unwrap();
            if observed.measured_active_ms >= 360_000 { break observed }
            tokio::task::yield_now().await;
        };
        assert!(second.measured_active_ms < 361_000);
        assert!(second.result.is_none());
        let checkpoint_http = server.received_requests().await.unwrap();
        let checkpoint_routes: Vec<_> = checkpoint_http.iter().take(8)
            .map(|request| (request.method.to_string(), request.url.path().to_owned())).collect();
        assert!(checkpoint_http.is_empty(),
            "wait checkpoints issued HTTP (method/path only): {checkpoint_routes:?}");
        assert_eq!(db.get_parent_request(&record.request_id).await.unwrap().unwrap().status,
            codex_protocol::parent_request::ParentRequestStatus::Pending);
        assert!(session.active_turn.lock().await.is_none());
        session.cancel_parent_response_wait().await.unwrap();
        cancellation.cancel();
        keep_awake.abort();
        tokio::time::resume();
    }

    #[tokio::test]
    async fn trigger_mail_preserves_parked_task_and_explicit_user_input_starts_a_new_turn() {
        use core_test_support::responses::{ev_response_created, ev_completed, mount_sse_once, sse, start_mock_server};
        use codex_protocol::turn_input::{TurnInputMode, TurnInputRequest, TurnInputSubmission};
        let server = start_mock_server().await;
        let requests = mount_sse_once(&server, sse(vec![ev_response_created("explicit-user-turn"), ev_completed("explicit-user-turn")])).await;
        let home = tempfile::tempdir().unwrap();
        let (session, turn, events, record) = persistent_wait(home.path(), format!("{}/v1", server.uri())).await;
        session.start_task(Arc::clone(&turn), Vec::new(), IdleTask).await;
        let cancellation = session.active_turn.lock().await.as_ref().unwrap().task.as_ref().unwrap().cancellation_token.clone();
        assert!(session.defer_parent_response_after_tools(&turn).await.unwrap());
        assert!(session.finish_deferred_parent_response(&turn).await);
        session.enqueue_root_aware_mail(codex_protocol::protocol::InterAgentCommunication::new(
            codex_protocol::AgentPath::root(), codex_protocol::AgentPath::from_string("/root/child".into()).unwrap(),
            Vec::new(), "Ordinary parent mail requesting a turn".into(), true,
        ), Default::default()).await;
        session.maybe_start_turn_for_pending_work().await;
        assert!(requests.requests().is_empty());
        assert!(session.active_turn.lock().await.is_none());
        assert_eq!(session.parked_parent_response_task_identity().await.as_deref(), Some(turn.sub_id.as_str()));
        assert_eq!(session.root_resume_task_identity().await.as_deref(), Some(turn.sub_id.as_str()));
        let db = session.state_db().unwrap();
        assert!(db.get_parent_response_wait(&record.wait_id).await.unwrap().unwrap().result.is_none());
        let submission = super::super::turn_input::handle(&session,
            TurnInputRequest::user_input(vec![codex_protocol::user_input::UserInput::Text {
                text: "Stop waiting and handle this new user instruction".into(), text_elements: Vec::new(),
            }]), TurnInputMode::StartOrSteer, "explicit-user-submission".into(),
        ).await.unwrap();
        let TurnInputSubmission::Started { turn_id, .. } = submission else { panic!("explicit user input did not start a turn") };
        assert_ne!(turn_id, turn.sub_id);
        assert_eq!(db.get_parent_response_wait(&record.wait_id).await.unwrap().unwrap().result, Some(ParentResponseWaitResult::Interrupted));
        let complete = tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                let event = events.recv().await.unwrap();
                if let EventMsg::TurnComplete(complete) = event.msg { break complete }
            }
        }).await.unwrap();
        assert_eq!(complete.turn_id, turn_id);
        assert_eq!(requests.requests().len(), 1);
        cancellation.cancel();
    }
}

struct WaitingChild {
    record: ParentResponseWait,
    turn: Arc<TurnContext>,
    started: Option<Instant>,
    parked: bool,
    response_delivered: bool,
    resume_failed: bool,
    parent_thread_id: String,
}

fn persistence(error: impl std::fmt::Display) -> CodexErr {
    CodexErr::Fatal(format!("parent response wait persistence failed: {error}"))
}

impl WaitingChild {
    fn elapsed_ms(&self) -> i64 {
        self.started.map_or(0, |started| {
            i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX)
        })
    }
    fn log(&self, event: &str, reason: &str) {
        tracing::info!(target: "codex_core::parent_response_wait", event,
            request_id = %self.record.request_id, wait_id = %self.record.wait_id,
            parent_thread_id = %self.parent_thread_id,
            child_thread_id = %self.record.child_thread_id,
            thread_id = %self.record.child_thread_id,
            child_task_id = %self.record.child_task_id,
            blocked_wait_started_at_ms = ?self.record.parked_at_ms,
            blocked_wait_ms = self.elapsed_ms(), reason);
    }
}

impl Session {
    fn parent_response_wait_control(&self) -> Arc<ParentResponseWaitControl> {
        self.services.thread_extension_data.get_or_init(ParentResponseWaitControl::default)
    }

    fn parent_response_wait_settings(turn: &TurnContext) -> CodexResult<ParentResponseWaitSettings> {
        Ok(ParentResponseWaitSettings {
            model: turn.capture_current_model_info().slug.clone(),
            provider_id: turn.config.model_provider_id.clone(),
            reasoning_effort: turn.next_step_settings.load().effective_reasoning_effort(),
            final_output_json_schema: turn.final_output_json_schema.clone(),
            permission_profile: serde_json::to_value(turn.permission_profile()).map_err(persistence)?,
            approval_policy: serde_json::to_value(turn.approval_policy()).map_err(persistence)?,
        })
    }

    async fn parent_response_recovery_blocked(&self, wait: &ParentResponseWait, reason: &'static str) {
        tracing::warn!(target: "codex_core::parent_response_wait", event = "wait_recovery_blocked",
            request_id = %wait.request_id, wait_id = %wait.wait_id, child_task_id = %wait.child_task_id,
            child_thread_id = %wait.child_thread_id, thread_id = %wait.child_thread_id, reason);
        self.send_event_raw(codex_protocol::protocol::Event {
            id: wait.child_task_id.clone(),
            msg: EventMsg::Warning(codex_protocol::protocol::WarningEvent {
                message: format!("Parent response wait {} remains suspended: {reason}. Review the originating child task before continuing.", wait.request_id),
            }),
        }).await;
    }

    pub(crate) async fn prepare_parent_response_wait(
        self: &Arc<Self>, turn: &Arc<TurnContext>, call_id: &str, request_id: &str,
    ) -> CodexResult<serde_json::Value> {
        if !super::parent_request::parent_request_tools_enabled(turn) {
            return Err(CodexErr::InvalidRequest("parent response waits are unavailable for this turn".into()));
        }
        let db = self.state_db().ok_or_else(|| CodexErr::InvalidRequest("parent response waits require persistent state".into()))?;
        let control = self.parent_response_wait_control();
        let mut state = control.state.lock().await;
        if control.closed.load(Ordering::Acquire) {
            return Err(CodexErr::InvalidRequest("child runtime is closing".into()));
        }
        let request = db.get_parent_request(request_id).await.map_err(persistence)?
            .ok_or_else(|| CodexErr::InvalidRequest("parent request not found".into()))?;
        if request.child_thread_id != self.thread_id.to_string() || request.child_task_id != turn.sub_id {
            return Err(CodexErr::InvalidRequest("parent request belongs to another child task".into()));
        }
        if let Some(response) = request.response {
            return Ok(serde_json::json!({"requestId": request_id, "response": response, "blockedWaitMs": 0}));
        }
        if let Some(existing) = state.as_ref() {
            if existing.record.result.is_some() {
                return Err(CodexErr::InvalidRequest("parent response wait failed; review the child task before continuing".into()));
            }
            if existing.record.request_id == request_id && existing.record.child_task_id == turn.sub_id {
                return Ok(serde_json::json!({"requestId": request_id, "waitId": existing.record.wait_id, "status": "awaiting_response"}));
            }
            return Err(CodexErr::InvalidRequest("child already awaits another parent response".into()));
        }
        let now = chrono::Utc::now().timestamp_millis();
        let record = db.create_parent_response_wait(&ParentResponseWait {
            wait_id: uuid::Uuid::new_v4().to_string(), request_id: request_id.into(),
            child_task_id: turn.sub_id.clone(), child_thread_id: self.thread_id.to_string(),
            originating_call_id: call_id.into(), started_at_ms: now, last_checkpoint_at_ms: now,
            ended_at_ms: None, measured_active_ms: 0, result: None,
            resume_settings: Some(Self::parent_response_wait_settings(turn)?),
            parked_at_ms: None,
        }).await.map_err(persistence)?;
        let result = serde_json::json!({"requestId": request_id, "waitId": record.wait_id, "status": "awaiting_response"});
        *state = Some(WaitingChild { record, turn: Arc::clone(turn), started: None, parked: false, response_delivered: false, resume_failed: false, parent_thread_id: request.parent_thread_id });
        Ok(result)
    }

    pub(crate) fn parent_response_turn_is_deferred(&self) -> bool {
        self.parent_response_wait_control().deferred.load(Ordering::Acquire)
    }

    pub(crate) async fn parked_parent_response_task_identity(&self) -> Option<String> {
        self.parent_response_wait_control().state.lock().await.as_ref()
            .filter(|wait| wait.parked).map(|wait| wait.record.child_task_id.clone())
    }

    pub(crate) async fn defer_parent_response_after_tools(self: &Arc<Self>, turn: &Arc<TurnContext>) -> CodexResult<bool> {
        let control = self.parent_response_wait_control();
        let mut state = control.state.lock().await;
        let Some(wait) = state.as_mut().filter(|w| w.record.child_task_id == turn.sub_id) else { return Ok(false) };
        // Only a successfully recorded matching tool result authorizes parking.
        let history = self.clone_history().await;
        let recorded = history.raw_items().any(|item| matches!(item,
            ResponseItem::FunctionCallOutput { call_id, output, .. } if call_id.as_deref() == Some(wait.record.originating_call_id.as_str())
                && output.success != Some(false)
                && output.body.to_text().and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
                    .is_some_and(|value| value["waitId"].as_str() == Some(wait.record.wait_id.as_str()))));
        if !recorded { return Ok(false) }
        let turn_state = self.input_queue.turn_state_for_sub_id(&self.active_turn, &turn.sub_id).await;
        let (_, activity) = self.input_queue.subscribe_activity(turn_state.as_deref()).await;
        if activity == Some(super::input_queue::InputQueueActivity::Steer) {
            let db = self.state_db().ok_or_else(|| persistence("state unavailable"))?;
            db.end_parent_response_wait(&wait.record.wait_id, ParentResponseWaitResult::Interrupted, 0,
                chrono::Utc::now().timestamp_millis()).await.map_err(persistence)?;
            wait.log("wait_ended", "user_input_before_parking");
            *state = None;
            return Ok(false);
        }
        self.flush_rollout().await.map_err(persistence)?;
        control.deferred.store(true, Ordering::Release);
        Ok(true)
    }

    pub(crate) async fn finish_deferred_parent_response(self: &Arc<Self>, turn: &Arc<TurnContext>) -> bool {
        let control = self.parent_response_wait_control();
        if !control.deferred.load(Ordering::Acquire) { return false }
        let mut state = control.state.lock().await;
        let Some(wait) = state.as_mut().filter(|w| w.record.child_task_id == turn.sub_id) else { return false };
        let mut park_failed = false;
        if let Some(turn_state) = self.input_queue.turn_state_for_sub_id(&self.active_turn, &turn.sub_id).await {
            let pending = self.input_queue.take_pending_input_for_turn_state(turn_state.as_ref()).await;
            super::turn::run_hooks_and_record_inputs(self, turn, &turn.capture_current_model_info(),
                &pending, codex_thread_store::PersistContext::Standard).await;
            if let Err(error) = self.flush_rollout().await {
                tracing::warn!(%error, "could not flush child input before parking");
                park_failed = true;
            }
        }
        park_failed |= match self.state_db() {
            Some(db) => match db.begin_parent_response_wait(&wait.record.wait_id, chrono::Utc::now().timestamp_millis()).await {
                Ok(record) => { wait.record = record; false }
                Err(error) => {
                    tracing::warn!(thread_id = %wait.record.child_thread_id, request_id = %wait.record.request_id,
                        wait_id = %wait.record.wait_id, event = "wait_park_persistence_failed", %error);
                    true
                }
            },
            None => true,
        };
        {
            let mut active = self.active_turn.lock().await;
            if !active.as_ref().and_then(|a| a.task.as_ref()).is_some_and(|t| t.turn_context.sub_id == turn.sub_id) { return false }
            if let Some(task) = active.as_mut().and_then(|a| a.task.take()) { task.handle.detach(); }
            *active = None;
        }
        wait.started = Some(Instant::now());
        wait.parked = true;
        wait.resume_failed = park_failed;
        if park_failed {
            wait.log("wait_park_persistence_failed", "manual_review_required");
        } else {
            wait.log("wait_started", "parent_response");
        }
        let (started_at, deferred_at, duration_ms) = turn.turn_timing_state.defer_timing().await;
        self.send_event(turn, EventMsg::TurnDeferred(TurnDeferredEvent {
            root_turn_id: Some(turn.root_turn_id()), turn_id: turn.sub_id.clone(),
            reservation_id: wait.record.wait_id.clone(), wait: None, started_at, deferred_at, duration_ms,
        })).await;
        if let Err(error) = self.flush_rollout().await {
            tracing::warn!(%error, "could not flush child response wait event");
        }
        drop(state);
        if park_failed { self.fail_parent_response_wait("wait_park_persistence_failed").await; }
        let session = Arc::clone(self);
        tokio::spawn(async move { session.watch_parent_response().await; });
        true
    }

    fn watch_parent_response(self: Arc<Self>) -> BoxFuture<'static, ()> {
        Box::pin(async move {
            let control = self.parent_response_wait_control();
            // Parking establishes the measurement boundary. Event flushing and
            // scheduler latency must not postpone the first checkpoint.
            let mut checkpoint_at = control.state.lock().await.as_ref()
                .and_then(|wait| wait.started).unwrap_or_else(Instant::now) + Duration::from_secs(60);
            let mut check_response = true;
            loop {
                let notified = control.activity.notified();
                tokio::pin!(notified);
                notified.as_mut().enable();
                if check_response { match self.resume_parent_response_if_ready().await {
                    Ok(true) => return,
                    Err(error) => {
                        tracing::warn!(%error, "child response resume failed");
                        if self.fail_parent_response_resume().await { return; }
                        check_response = false;
                    }
                    Ok(false) => {}
                } }
                tokio::select! {
                    _ = notified => { check_response = true; },
                    _ = tokio::time::sleep_until(checkpoint_at) => {
                        // Schedule from this actual checkpoint boundary before
                        // persistence work, without replaying overdue checkpoints.
                        let next_checkpoint_at = Instant::now() + Duration::from_secs(300);
                        let state = control.state.lock().await;
                        let Some(wait) = state.as_ref() else { return };
                        if let Some(db) = self.state_db() {
                            if let Err(error) = db.checkpoint_parent_response_wait(&wait.record.wait_id, wait.elapsed_ms(), chrono::Utc::now().timestamp_millis()).await {
                                tracing::warn!(%error, "child response checkpoint failed");
                            }
                            if let Ok(Some(request)) = db.get_parent_request(&wait.record.request_id).await {
                                tracing::info!(target: "codex_core::parent_response_wait", event = "wait_state_checkpoint",
                                    request_id = %request.request_id, wait_id = %wait.record.wait_id,
                                    parent_thread_id = %request.parent_thread_id, child_thread_id = %request.child_thread_id,
                                    thread_id = %request.child_thread_id,
                                    child_task_id = %request.child_task_id, request_status = ?request.status,
                                    delivery_state = ?request.delivery_state, last_state_changed_at_ms = request.updated_at_ms,
                                    blocked_wait_ms = wait.elapsed_ms());
                            }
                        }
                        wait.log("wait_checkpoint", "parent_response");
                        checkpoint_at = next_checkpoint_at;
                        check_response = false;
                    }
                }
                if control.closed.load(Ordering::Acquire) { return }
            }
        })
    }

    pub(crate) async fn notify_parent_response(self: &Arc<Self>, request_id: &str) -> CodexResult<()> {
        // Durable state is checked by the single waiter; a notification never samples.
        let control = self.parent_response_wait_control();
        let mut state = control.state.lock().await;
        if let Some(wait) = state.as_mut().filter(|wait| wait.record.request_id == request_id) {
            // AgentControl calls this only after attributed mail has been enqueued.
            // Preserve this acknowledgement if it races ahead of the parking boundary.
            wait.response_delivered = true;
            control.activity.notify_one();
        }
        Ok(())
    }

    async fn resume_parent_response_if_ready(self: &Arc<Self>) -> CodexResult<bool> {
        let control = self.parent_response_wait_control();
        let mut state = control.state.lock().await;
        if control.closed.load(Ordering::Acquire) || state.is_none() { return Ok(true) }
        let wait = state.as_ref().expect("checked wait");
        if wait.record.result.is_some() { return Ok(true) }
        if !wait.parked || !wait.response_delivered || wait.resume_failed || wait.record.parked_at_ms.is_none() { return Ok(false) }
        let db = self.state_db().ok_or_else(|| persistence("state unavailable"))?;
        let request = db.get_parent_request(&wait.record.request_id).await.map_err(persistence)?
            .ok_or_else(|| persistence("request missing"))?;
        if request.response.is_none() { return Ok(false) }
        let model = wait.turn.model_info().slug.clone();
        if self.account_is_retired_for_model(&model)
            || self.execution_admission_for_model(&model).requires_recovery() {
            wait.log("wait_resume_blocked", "execution_admission_requires_recovery");
            self.parent_response_recovery_blocked(&wait.record, "execution_admission_requires_recovery").await;
            return Ok(false);
        }
        {
            let mut active = self.active_turn.lock().await;
            if active.is_some() { return Ok(false) }
            *active = Some(ActiveTurn::default());
        }
        let resume = async {
        // The parent control delivers the answer as attributed agent mail before notifying.
        // Persist that mail before ending the wait so restart cannot lose the answer.
        let (pending, _) = self.input_queue.drain_mailbox_input_items().await;
        super::turn::run_hooks_and_record_inputs(self, &wait.turn,
            &wait.turn.capture_current_model_info(), &pending, codex_thread_store::PersistContext::Standard).await;
        self.flush_rollout().await.map_err(persistence)?;
        let turn = Arc::clone(&wait.turn);
        let (release, ready) = oneshot::channel();
        self.start_task(Arc::clone(&turn), Vec::new(), ParentResponseResumeTask { ready: Mutex::new(Some(ready)) }).await;
        if !self.active_turn.lock().await.as_ref().and_then(|active| active.task.as_ref())
            .is_some_and(|task| task.turn_context.sub_id == turn.sub_id) {
            return Err(persistence("resume task admission changed"));
        }
        db.end_parent_response_wait(&wait.record.wait_id, ParentResponseWaitResult::Answered, wait.elapsed_ms(), chrono::Utc::now().timestamp_millis()).await.map_err(persistence)?;
        control.deferred.store(false, Ordering::Release);
        release.send(()).map_err(|_| persistence("resume task disappeared before release"))?;
        wait.log("wait_ended", "answered");
        Ok(true)
        }.await;
        if resume.is_err() {
            // Remove only our reserved slot or gated task; never a concurrent task.
            self.clear_failed_parent_response_admission(&wait.record.child_task_id).await;
        } else {
            *state = None;
        }
        resume
    }

    async fn clear_failed_parent_response_admission(&self, task_id: &str) {
        let mut active = self.active_turn.lock().await;
        if active.as_ref().is_some_and(|active| active.task.as_ref().is_none_or(|task| task.turn_context.sub_id == task_id)) {
            if let Some(task) = active.as_mut().and_then(|active| active.task.take()) {
                task.cancellation_token.cancel();
                task.handle.detach();
            }
            *active = None;
        }
    }

    async fn fail_parent_response_resume(&self) -> bool {
        self.fail_parent_response_wait("wait_failed_resume").await
    }

    async fn fail_parent_response_wait(&self, reason: &'static str) -> bool {
        let control = self.parent_response_wait_control();
        let mut state = control.state.lock().await;
        let Some(wait) = state.as_mut() else { return true };
        wait.resume_failed = true;
        self.parent_response_recovery_blocked(&wait.record, reason).await;
        let Some(db) = self.state_db() else { return false };
        // A failed persistence acknowledgement may already have committed. Inspect
        // durable state before attempting another terminal transition.
        match db.get_parent_response_wait(&wait.record.wait_id).await {
            Ok(Some(record)) if record.result.is_some() => {
                wait.record = record;
                wait.log("wait_resume_failed", "durable_terminal_requires_manual_review");
                true
            }
            Ok(Some(_)) => match db.end_parent_response_wait(&wait.record.wait_id,
                ParentResponseWaitResult::WaitFailed, wait.elapsed_ms(), chrono::Utc::now().timestamp_millis()).await {
                Ok(record) => { wait.record = record; wait.log("wait_ended", "wait_failed"); true }
                Err(error) => { tracing::warn!(%error, "could not persist failed child wait; checkpoints remain active"); false }
            },
            _ => false,
        }
    }

    pub(crate) async fn cancel_parent_response_wait(&self) -> CodexResult<()> {
        let control = self.parent_response_wait_control();
        let mut state = control.state.lock().await;
        if control.closed.load(Ordering::Acquire) { return Ok(()) }
        if let Some(wait) = state.as_ref() {
            let db = self.state_db().ok_or_else(|| persistence("state unavailable"))?;
            if wait.record.result.is_none() {
                db.end_parent_response_wait(&wait.record.wait_id, ParentResponseWaitResult::Interrupted, wait.elapsed_ms(), chrono::Utc::now().timestamp_millis()).await.map_err(persistence)?;
                wait.log("wait_ended", "cancelled");
            } else {
                wait.log("wait_stopped_after_failure", "cancelled");
            }
            if wait.parked && self.active_turn.lock().await.is_none() {
                let turn = &wait.turn;
                let (started_at, completed_at, duration_ms) = turn.turn_timing_state.defer_timing().await;
                self.send_event(turn, EventMsg::TurnAborted(TurnAbortedEvent {
                    root_turn_id: Some(turn.root_turn_id()), turn_id: Some(turn.sub_id.clone()),
                    reason: TurnAbortReason::Interrupted, error: None, started_at, completed_at, duration_ms,
                })).await;
                self.flush_rollout().await.map_err(persistence)?;
                self.emit_turn_abort_lifecycle(TurnAbortReason::Interrupted, turn.extension_data.as_ref()).await;
            }
        }
        *state = None;
        control.deferred.store(false, Ordering::Release);
        control.activity.notify_one();
        Ok(())
    }

    pub(crate) async fn finish_unparked_parent_response_wait(&self, turn_id: &str) -> CodexResult<()> {
        let control = self.parent_response_wait_control();
        let mut state = control.state.lock().await;
        if control.closed.load(Ordering::Acquire) { return Ok(()) }
        if let Some(wait) = state.as_ref().filter(|wait| wait.record.child_task_id == turn_id && !wait.parked) {
            let db = self.state_db().ok_or_else(|| persistence("state unavailable"))?;
            db.end_parent_response_wait(&wait.record.wait_id, ParentResponseWaitResult::WaitFailed, 0,
                chrono::Utc::now().timestamp_millis()).await.map_err(persistence)?;
            wait.log("wait_ended", "successful_await_boundary_not_reached");
            *state = None;
            control.deferred.store(false, Ordering::Release);
        }
        Ok(())
    }

    pub(crate) async fn close_parent_response_wait_runtime(&self) {
        let control = self.parent_response_wait_control();
        control.closed.store(true, Ordering::Release);
        let state = control.state.lock().await;
        if let Some(wait) = state.as_ref().filter(|wait| wait.record.result.is_none()) {
            if let Some(db) = self.state_db() {
                if let Err(error) = db.checkpoint_parent_response_wait(&wait.record.wait_id, wait.elapsed_ms(), chrono::Utc::now().timestamp_millis()).await {
                    tracing::warn!(%error, "could not checkpoint child wait at shutdown");
                }
            }
        }
        control.activity.notify_one();
        // Preserve the durable wait for a history-validated recovery.
    }

    pub(crate) async fn recover_parent_response_waits(self: &Arc<Self>) -> CodexResult<()> {
        let Some(db) = self.state_db() else { return Ok(()) };
        let control = self.parent_response_wait_control();
        let mut state = control.state.lock().await;
        if state.is_some() { return Ok(()) }
        let history = self.clone_history().await;
        for wait in db.list_active_parent_response_waits(&self.thread_id.to_string()).await.map_err(persistence)? {
            let proof_id = history.raw_items().find_map(|item| match item {
                ResponseItem::FunctionCallOutput { call_id, output, .. } if call_id.as_deref() == Some(wait.originating_call_id.as_str())
                && output.success != Some(false) => output.body.to_text()
                    .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
                    .filter(|value| value["requestId"].as_str() == Some(wait.request_id.as_str()))
                    .and_then(|value| value["waitId"].as_str().map(str::to_owned)),
                _ => None,
            });
            let proof = if let Some(id) = proof_id { db.get_parent_response_wait(&id).await.map_err(persistence)? } else { None };
            let valid = proof.is_some_and(|proof| proof.request_id == wait.request_id
                && proof.child_task_id == wait.child_task_id && proof.child_thread_id == wait.child_thread_id
                && proof.originating_call_id == wait.originating_call_id)
                && history.raw_items().any(|item| matches!(item,
                    ResponseItem::FunctionCall { call_id, .. } if call_id == &wait.originating_call_id
                        && item.turn_id() == Some(wait.child_task_id.as_str())));
            if !valid {
                self.parent_response_recovery_blocked(&wait, "await_history_identity_unproven").await;
                continue;
            }
            let request = db.get_parent_request(&wait.request_id).await.map_err(persistence)?
                .ok_or_else(|| persistence("recovery request missing"))?;
            if request.child_thread_id != self.thread_id.to_string() || request.child_task_id != wait.child_task_id {
                return Err(persistence("recovery child owner mismatch"));
            }
            let Some(settings) = wait.resume_settings.as_ref() else {
                self.parent_response_recovery_blocked(&wait, "resume_settings_missing").await;
                continue;
            };
            let mut configuration = self.state.lock().await.session_configuration.clone();
            Arc::make_mut(&mut configuration.step_settings).collaboration_mode.settings.reasoning_effort = settings.reasoning_effort.clone();
            let environments = self.activate_turn_environments(&configuration).await;
            let turn = self.new_turn_from_configuration(wait.child_task_id.clone(), configuration, environments,
                NewTurnContextOptions {
                    final_output_json_schema: settings.final_output_json_schema.clone(),
                    cyber_access_program: self.reference_context_item().await.and_then(|c| c.cyber_access_program),
                }).await;
            let current = Self::parent_response_wait_settings(&turn)?;
            if !super::parent_request::parent_request_tools_enabled(&turn)
                || current.model != settings.model || current.provider_id != settings.provider_id
                || current.permission_profile != settings.permission_profile || current.approval_policy != settings.approval_policy {
                self.parent_response_recovery_blocked(&wait, "execution_model_or_authority_changed").await;
                continue;
            }
            let now = chrono::Utc::now().timestamp_millis();
            let record = db.rotate_parent_response_wait(&wait.wait_id, &ParentResponseWait {
                wait_id: uuid::Uuid::new_v4().to_string(), started_at_ms: now, last_checkpoint_at_ms: now,
                measured_active_ms: 0, ended_at_ms: None, result: None, parked_at_ms: Some(now), ..wait.clone()
            }, now).await.map_err(persistence)?;
            let restored = WaitingChild { record, turn, started: Some(Instant::now()), parked: true, response_delivered: false, resume_failed: false, parent_thread_id: request.parent_thread_id };
            restored.log("wait_started", "restored_offline_duration_unknown");
            *state = Some(restored);
            control.deferred.store(true, Ordering::Release);
            drop(state);
            let session = Arc::clone(self);
            tokio::spawn(async move { session.watch_parent_response().await; });
            if request.response.is_some() {
                if let Err(error) = self.services.agent_control.notify_parent_response(self.thread_id, wait.request_id.clone()).await {
                    tracing::warn!(thread_id = %wait.child_thread_id, request_id = %wait.request_id, %error,
                        "could not deliver saved parent response; restored wait checkpoints remain active");
                    self.parent_response_recovery_blocked(&wait, "parent_response_delivery_failed").await;
                }
            }
            return Ok(());
        }
        Ok(())
    }
}

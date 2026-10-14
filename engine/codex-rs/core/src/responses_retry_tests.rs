use super::ResponsesStreamRequest;
use super::ResponsesStreamRetryState;
use super::handle_response_stream_error;
use super::log_retry;
use crate::realtime_history::RealtimeHistoryState;
use crate::session::step_context::StepContext;
use crate::session::tests::make_session_and_context;
use codex_http_client::RetryAfter;
use codex_protocol::error::CodexErr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::Instant;
use tracing_test::internal::MockWriter;

#[tokio::test]
async fn sampling_retry_logs_stream_error_context() {
    let (_session, turn_context) = make_session_and_context().await;
    let buffer: &'static std::sync::Mutex<Vec<u8>> =
        Box::leak(Box::new(std::sync::Mutex::new(Vec::new())));
    let subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .with_max_level(tracing::Level::WARN)
        .with_writer(MockWriter::new(buffer))
        .finish();
    let _subscriber_guard = tracing::subscriber::set_default(subscriber);

    log_retry(
        ResponsesStreamRequest::Sampling,
        &turn_context,
        &CodexErr::Stream("websocket closed by server before response.completed".to_string()),
        /*retries*/ 2,
        /*max_retries*/ 5,
        Duration::from_secs(1),
    );

    let logs = String::from_utf8(
        buffer
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone(),
    )
    .expect("retry log should be valid utf-8");
    assert!(logs.contains("stream disconnected - retrying sampling request"));
    assert!(logs.contains(&format!("turn_id={}", turn_context.sub_id)));
    assert!(logs.contains("retries=2"));
    assert!(logs.contains("max_retries=5"));
    assert!(logs.contains(
        "sampling_error=stream disconnected before completion: websocket closed by server before response.completed"
    ));
}

mod capacity {
    use super::*;
    use crate::capacity_recovery::CapacityRecoveryAction;
    use crate::session::TurnInput;
    use crate::session::UserInputMetadata;
    use codex_protocol::error::CodexErrorDetails;
    use codex_protocol::user_input::UserInput;

    fn input(text: &str, client_id: Option<&str>) -> TurnInput {
        TurnInput::UserInput {
            content: vec![UserInput::Text {
                text: text.to_owned(),
                text_elements: vec![],
            }],
            client_id: client_id.map(str::to_owned),
            metadata: UserInputMetadata::default(),
        }
    }

    fn assert_delay(start: Instant, seconds: u64) {
        let elapsed = Instant::now() - start;
        let expected = Duration::from_secs(seconds);
        assert!(
            (expected..=expected + Duration::from_millis(1)).contains(&elapsed),
            "elapsed {elapsed:?}, expected {expected:?}"
        );
    }

    #[tokio::test]
    async fn capacity_new_steering_input_does_not_inherit_resume_trigger() {
        let (session, turn) = make_session_and_context().await;
        turn.turn_metadata_state
            .set_turn_trigger("root_resume".to_owned());
        let request = input("New task while resuming", Some("steered-request"));
        super::super::begin_capacity_request(&session, &turn, &request);
        let state = super::super::capacity_state(&session);
        assert!(state.lock().unwrap().request_id().is_none());
        super::super::begin_capacity_request_for_input(&session, &turn, &request, true);
        assert_eq!(state.lock().unwrap().request_id(), Some("steered-request"));
        assert_eq!(
            state.lock().unwrap().on_overload(),
            CapacityRecoveryAction::Retry(Duration::from_secs(1))
        );
        super::super::begin_capacity_request_for_input(
            &session,
            &turn,
            &input("continue", Some("continuation")),
            true,
        );
        assert_eq!(state.lock().unwrap().request_id(), Some("steered-request"));
        for trigger in [
            "automation_job",
            "goal_resume",
            "resume_interrupted_task",
            "codex_replay",
        ] {
            assert!(
                super::super::capacity_request_id(&request, &turn.sub_id, Some(trigger)).is_none()
            );
        }
    }

    #[tokio::test]
    async fn sampling_capacity_budget_overrides_generic_retry_limits() {
        for max_retries in [0, 100] {
            let (session, turn) = make_session_and_context().await;
            super::super::begin_capacity_request(
                &session,
                &turn,
                &input("build feature", Some("a")),
            );
            let step = StepContext::for_test(Arc::new(turn));
            let mut client = session.services.model_client.new_session();
            let mut retry_state = ResponsesStreamRetryState::default();
            tokio::time::pause();
            for seconds in [1, 5, 10, 0] {
                let start = Instant::now();
                handle_response_stream_error(
                    &mut retry_state,
                    max_retries,
                    CodexErr::ServerOverloaded,
                    &mut client,
                    &session,
                    &step,
                    ResponsesStreamRequest::Sampling,
                )
                .await
                .expect("capacity action allows another sample");
                assert_delay(start, seconds);
                assert_eq!(retry_state.retries, 0);
                assert_eq!(retry_state.connection_retries, 0);
            }
            let advice = RetryAfter::from_delay(Duration::from_secs(10)).unwrap();
            let err = handle_response_stream_error(
                &mut retry_state,
                max_retries,
                CodexErr::ServerOverloaded.with_retry_after(advice),
                &mut client,
                &session,
                &step,
                ResponsesStreamRequest::Sampling,
            )
            .await
            .expect_err("server advice cannot extend the capacity budget");
            assert!(matches!(err.details(), CodexErrorDetails::ServerOverloaded));
            assert_eq!(err.retry_after().unwrap().deadline(), advice.deadline());
            tokio::time::resume();
        }
    }

    #[tokio::test]
    async fn capacity_budget_survives_client_recreation_and_same_request_reentry() {
        let (session, turn) = make_session_and_context().await;
        let first = input("build feature", Some("a"));
        super::super::begin_capacity_request(&session, &turn, &first);
        let step = StepContext::for_test(Arc::new(turn));
        tokio::time::pause();
        for seconds in [1, 5] {
            super::super::begin_capacity_request(&session, &step.turn, &first);
            let mut client = session.services.model_client.new_session();
            let mut retry_state = ResponsesStreamRetryState::default();
            let start = Instant::now();
            handle_response_stream_error(
                &mut retry_state,
                0,
                CodexErr::ServerOverloaded,
                &mut client,
                &session,
                &step,
                ResponsesStreamRequest::Sampling,
            )
            .await
            .unwrap();
            assert_delay(start, seconds);
        }
        super::super::begin_capacity_request(
            &session,
            &step.turn,
            &input("another feature", Some("b")),
        );
        let mut client = session.services.model_client.new_session();
        let start = Instant::now();
        handle_response_stream_error(
            &mut ResponsesStreamRetryState::default(),
            0,
            CodexErr::ServerOverloaded,
            &mut client,
            &session,
            &step,
            ResponsesStreamRequest::Sampling,
        )
        .await
        .unwrap();
        assert_delay(start, 1);
    }

    #[tokio::test]
    async fn capacity_retry_uses_server_deadline_as_floor() {
        let (session, turn) = make_session_and_context().await;
        super::super::begin_capacity_request(&session, &turn, &input("build feature", Some("a")));
        let step = StepContext::for_test(Arc::new(turn));
        let mut client = session.services.model_client.new_session();
        tokio::time::pause();
        let start = Instant::now();
        let advice = RetryAfter::from_delay(Duration::from_secs(10)).unwrap();
        handle_response_stream_error(
            &mut ResponsesStreamRetryState::default(),
            0,
            CodexErr::ServerOverloaded.with_retry_after(advice),
            &mut client,
            &session,
            &step,
            ResponsesStreamRequest::Sampling,
        )
        .await
        .unwrap();
        assert_delay(start, 10);
    }

    #[tokio::test]
    async fn dropping_capacity_retry_future_keeps_consumed_quota() {
        let (session, turn) = make_session_and_context().await;
        let request = input("build feature", Some("a"));
        super::super::begin_capacity_request(&session, &turn, &request);
        let step = StepContext::for_test(Arc::new(turn));
        let mut client = session.services.model_client.new_session();
        let mut retry_state = ResponsesStreamRetryState::default();
        tokio::time::pause();
        {
            let mut retry = Box::pin(handle_response_stream_error(
                &mut retry_state,
                0,
                CodexErr::ServerOverloaded,
                &mut client,
                &session,
                &step,
                ResponsesStreamRequest::Sampling,
            ));
            assert!(futures::poll!(&mut retry).is_pending());
        }
        super::super::begin_capacity_request(&session, &step.turn, &request);
        let start = Instant::now();
        handle_response_stream_error(
            &mut retry_state,
            0,
            CodexErr::ServerOverloaded,
            &mut client,
            &session,
            &step,
            ResponsesStreamRequest::Sampling,
        )
        .await
        .unwrap();
        assert_delay(start, 5);
    }

    #[tokio::test]
    async fn unrelated_errors_and_compaction_preserve_sampling_capacity_budget() {
        let (session, turn) = make_session_and_context().await;
        super::super::begin_capacity_request(&session, &turn, &input("build feature", Some("a")));
        let step = StepContext::for_test(Arc::new(turn));
        let mut client = session.services.model_client.new_session();
        tokio::time::pause();
        for (err, request) in [
            (CodexErr::QuotaExceeded, ResponsesStreamRequest::Sampling),
            (
                CodexErr::InternalServerError,
                ResponsesStreamRequest::Sampling,
            ),
            (
                CodexErr::ServerOverloaded,
                ResponsesStreamRequest::RemoteCompactionV2,
            ),
        ] {
            let _ = handle_response_stream_error(
                &mut ResponsesStreamRetryState::default(),
                0,
                err,
                &mut client,
                &session,
                &step,
                request,
            )
            .await;
        }
        assert_eq!(
            super::super::capacity_state(&session)
                .lock()
                .unwrap()
                .on_overload(),
            CapacityRecoveryAction::Retry(Duration::from_secs(1))
        );
    }

    #[tokio::test]
    async fn unidentified_sampling_overload_returns_original_error() {
        let (session, turn) = make_session_and_context().await;
        let step = StepContext::for_test(Arc::new(turn));
        let mut client = session.services.model_client.new_session();
        let err = handle_response_stream_error(
            &mut ResponsesStreamRetryState::default(),
            100,
            CodexErr::ServerOverloaded,
            &mut client,
            &session,
            &step,
            ResponsesStreamRequest::Sampling,
        )
        .await
        .unwrap_err();
        assert!(matches!(err.details(), CodexErrorDetails::ServerOverloaded));
        assert_eq!(
            super::super::capacity_state(&session)
                .lock()
                .unwrap()
                .request_id(),
            None
        );
    }

    #[test]
    fn request_classifier_preserves_continuation_identity() {
        let substantive = input("build feature", Some("client-a"));
        let classify = super::super::capacity_request_id;
        assert_eq!(
            classify(&substantive, "turn", None),
            Some("client-a".to_owned())
        );
        for trigger in ["capacity_retry_1", "capacity_retry_4", "root_resume"] {
            assert_eq!(classify(&substantive, "turn", Some(trigger)), None);
        }
        for text in [
            "continue",
            " Resume! ",
            "계속",
            "계속해주세요.",
            "이어서 진행",
        ] {
            assert_eq!(classify(&input(text, None), "turn", None), None);
        }
        let mut empty = substantive.clone();
        if let TurnInput::UserInput { content, .. } = &mut empty {
            content.clear();
        }
        assert_eq!(classify(&empty, "turn", None), None);
        let mut heartbeat = substantive.clone();
        if let TurnInput::UserInput { metadata, .. } = &mut heartbeat {
            metadata.origin = codex_history::UserInputOrigin::Heartbeat;
        }
        assert_eq!(classify(&heartbeat, "turn", None), None);
        let tool = TurnInput::FunctionCallOutput(codex_history::ResponseItemEnvelope::new(
            codex_protocol::models::ResponseItem::FunctionCallOutput {
                id: None,
                call_id: Some("tool-call".to_owned()),
                name: None,
                namespace: None,
                output: codex_protocol::models::FunctionCallOutputPayload {
                    body: codex_protocol::models::FunctionCallOutputBody::Text("done".to_owned()),
                    success: Some(true),
                },
                internal_chat_message_metadata_passthrough: None,
            },
        ));
        assert_eq!(classify(&tool, "turn", None), None);
    }

    #[test]
    fn steered_inputs_without_client_id_use_acceptance_order() {
        let mut first = input("build feature", None);
        if let TurnInput::UserInput { metadata, .. } = &mut first {
            metadata.acceptance_order = Some(41);
        }
        let mut second = first.clone();
        if let TurnInput::UserInput { metadata, .. } = &mut second {
            metadata.acceptance_order = Some(42);
        }
        assert_eq!(
            super::super::capacity_request_id(&first, "turn", None),
            Some("turn:41".to_owned())
        );
        assert_eq!(
            super::super::capacity_request_id(&second, "turn", None),
            Some("turn:42".to_owned())
        );
        assert_eq!(
            super::super::capacity_request_id(&input("build feature", Some("")), "turn", None),
            Some("turn:0".to_owned())
        );
    }
}

/// Time spent reporting a retry must count toward the server's original deadline.
#[tokio::test]
#[expect(
    clippy::await_holding_invalid_type,
    reason = "test holds the event-delivery lock to delay notification while virtual time advances"
)]
async fn stream_retry_preserves_deadline_across_delayed_notification() {
    let (mut session, turn_context) = make_session_and_context().await;
    let step_context = StepContext::for_test(Arc::new(turn_context));
    session.realtime_history = Some(Mutex::new(RealtimeHistoryState::default()));
    let mut client_session = session.services.model_client.new_session();
    // The second retry emits a notification even when release builds hide the first.
    let mut retry_state = ResponsesStreamRetryState {
        retries: 1,
        ..Default::default()
    };

    tokio::time::pause();
    let advice = RetryAfter::from_delay(Duration::from_secs(10)).expect("retry deadline");
    tokio::time::advance(Duration::from_secs(4)).await;

    // Hold the event-delivery lock so reporting the error consumes part of the deadline.
    let history_guard = session.realtime_history.as_ref().unwrap().lock().await;
    let retry = handle_response_stream_error(
        &mut retry_state,
        /*max_retries*/ 2,
        CodexErr::InternalServerError.with_retry_after(advice),
        &mut client_session,
        &session,
        &step_context,
        ResponsesStreamRequest::Sampling,
    );
    tokio::pin!(retry);
    assert!(futures::poll!(&mut retry).is_pending());
    tokio::time::advance(Duration::from_secs(4)).await;
    drop(history_guard);

    assert!(futures::poll!(&mut retry).is_pending());
    tokio::time::advance(Duration::from_secs(1)).await;
    assert!(futures::poll!(&mut retry).is_pending());
    retry.await.expect("retry should be allowed");
    // Tokio rounds timer deadlines up to the next millisecond.
    let resumed_at = Instant::now();
    assert!(
        (advice.deadline()..=advice.deadline() + Duration::from_millis(1)).contains(&resumed_at),
        "retry resumed at {resumed_at:?}, expected {advice:?}"
    );
}

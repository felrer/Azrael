use super::*;
use crate::session::step_context::StepContext;
use crate::session::tests::make_session_and_context;
use crate::tools::context::ToolCallSource;
use crate::turn_diff_tracker::TurnDiffTracker;
use codex_protocol::ThreadId;
use codex_protocol::protocol::SessionSource;
use codex_protocol::protocol::SubAgentSource;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn queued_input_pause_is_durable_thread_scoped_and_does_not_end_the_turn() {
    for reason in ["waiting_for_user", "blocked"] {
        let (session, turn) = make_session_and_context().await;
        let session = Arc::new(session);
        let turn = Arc::new(turn);
        let home = turn.config.codex_home.clone();
        let id = session.thread_id;
        let other_id = ThreadId::new();
        let result = PauseQueuedInputsHandler
            .handle(ToolInvocation {
                session: Arc::clone(&session),
                step_context: StepContext::for_test(Arc::clone(&turn)),
                turn,
                cancellation_token: CancellationToken::new(),
                tracker: Arc::new(Mutex::new(TurnDiffTracker::default())),
                call_id: "pause-queue".to_string(),
                tool_name: ToolName::plain("pause_queued_inputs"),
                source: ToolCallSource::Direct,
                payload: ToolPayload::Function {
                    arguments: json!({ "reason": reason }).to_string(),
                },
            })
            .await
            .expect("pause must be persisted before acknowledging");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&result.log_output()).unwrap(),
            json!({ "status": "paused", "reason": reason }),
        );
        assert!(crate::azrael_manual_resume::requires_manual_resume(
            home.as_path(),
            id
        ));
        assert!(!crate::azrael_manual_resume::requires_manual_resume(
            home.as_path(),
            other_id
        ));
        // This control action must not interrupt the model's final explanation.
        assert!(!session.is_interrupted());
        crate::azrael_manual_resume::clear_manual_resume(home.as_path(), id).unwrap();
        assert!(!crate::azrael_manual_resume::requires_manual_resume(
            home.as_path(),
            id
        ));
    }
}

#[tokio::test]
async fn queued_input_pause_rejects_child_and_invalid_reason_without_writing() {
    for child in [false, true] {
        let (session, mut turn) = make_session_and_context().await;
        if child {
            turn.session_source = SessionSource::SubAgent(SubAgentSource::ThreadSpawn {
                parent_thread_id: ThreadId::new(),
                depth: 1,
                agent_path: None,
                agent_nickname: None,
                agent_role: None,
            });
        }
        let id = session.thread_id;
        let home = turn.config.codex_home.clone();
        let turn = Arc::new(turn);
        let result = PauseQueuedInputsHandler
            .handle(ToolInvocation {
                session: Arc::new(session),
                step_context: StepContext::for_test(Arc::clone(&turn)),
                turn,
                cancellation_token: CancellationToken::new(),
                tracker: Arc::new(Mutex::new(TurnDiffTracker::default())),
                call_id: "invalid-pause".to_string(),
                tool_name: ToolName::plain("pause_queued_inputs"),
                source: ToolCallSource::Direct,
                payload: ToolPayload::Function {
                    arguments: json!({ "reason": if child { "blocked" } else { "success" } })
                        .to_string(),
                },
            })
            .await;
        assert!(result.is_err());
        assert!(!crate::azrael_manual_resume::requires_manual_resume(
            home.as_path(),
            id
        ));
    }
}

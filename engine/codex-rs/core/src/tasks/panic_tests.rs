use super::SessionTask;
use super::SessionTaskResult;
use crate::session::TurnInput;
use crate::session::session::Session;
use crate::session::tests::make_session_and_context_with_rx;
use crate::session::turn_context::TurnContext;
use crate::state::TaskKind;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::TurnAbortReason;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

struct DropProbe(Arc<AtomicBool>);

impl Drop for DropProbe {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

struct PanickingTask {
    dropped: Arc<AtomicBool>,
    wait_for_cancel: bool,
}

impl SessionTask for PanickingTask {
    fn kind(&self) -> TaskKind {
        TaskKind::Regular
    }
    fn span_name(&self) -> &'static str {
        "session_task.panic_fixture"
    }

    async fn run(
        self: Arc<Self>,
        session: Arc<Session>,
        context: Arc<TurnContext>,
        _input: Vec<TurnInput>,
        cancellation_token: CancellationToken,
    ) -> SessionTaskResult {
        let _probe = DropProbe(Arc::clone(&self.dropped));
        session.emit_turn_started(&context, TaskKind::Regular).await;
        if self.wait_for_cancel {
            cancellation_token.cancelled().await;
        }
        panic!("private panic fixture payload");
    }
}

struct CompletingTask;

impl SessionTask for CompletingTask {
    fn kind(&self) -> TaskKind {
        TaskKind::Regular
    }
    fn span_name(&self) -> &'static str {
        "session_task.complete_fixture"
    }

    async fn run(
        self: Arc<Self>,
        session: Arc<Session>,
        context: Arc<TurnContext>,
        _input: Vec<TurnInput>,
        _cancellation_token: CancellationToken,
    ) -> SessionTaskResult {
        session.emit_turn_started(&context, TaskKind::Regular).await;
        Ok(Some("follow-up completed".to_string()))
    }
}

#[test_case::test_case(false; "panic_finishes_failed")]
#[test_case::test_case(true; "interruption_owns_terminal_event")]
#[tokio::test]
async fn task_panic_releases_turn_and_admits_follow_up(wait_for_cancel: bool) {
    let (session, context, receiver) = make_session_and_context_with_rx().await;
    let dropped = Arc::new(AtomicBool::new(false));
    session
        .spawn_task(
            Arc::clone(&context),
            Vec::new(),
            PanickingTask {
                dropped: Arc::clone(&dropped),
                wait_for_cancel,
            },
        )
        .await;

    let errors = tokio::time::timeout(Duration::from_secs(10), async {
        let mut errors = 0;
        loop {
            let event = receiver.recv().await.expect("turn event");
            match event.msg {
                EventMsg::TurnStarted(_) if wait_for_cancel => {
                    session.abort_all_tasks(TurnAbortReason::Interrupted).await;
                }
                EventMsg::Error(error) => {
                    errors += 1;
                    assert_eq!(error.message, "Fatal error: session task panicked");
                }
                EventMsg::TurnComplete(complete) => {
                    assert!(!wait_for_cancel);
                    assert_eq!(complete.turn_id, context.sub_id);
                    assert_eq!(
                        complete.error.expect("terminal failure").message,
                        "Fatal error: session task panicked"
                    );
                    break;
                }
                EventMsg::TurnAborted(_) => {
                    assert!(wait_for_cancel);
                    break;
                }
                _ => {}
            }
        }
        errors
    })
    .await
    .expect("panic must not leave the turn running");
    assert!(
        dropped.load(Ordering::SeqCst),
        "unwind before terminal publication"
    );
    assert_eq!(errors, usize::from(!wait_for_cancel));

    let next = session.new_default_turn().await;
    session
        .spawn_task(Arc::clone(&next), Vec::new(), CompletingTask)
        .await;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let event = receiver.recv().await.expect("follow-up event");
            match event.msg {
                EventMsg::TurnComplete(complete) => {
                    assert_eq!(complete.turn_id, next.sub_id);
                    assert!(complete.error.is_none());
                    assert_eq!(
                        complete.last_agent_message.as_deref(),
                        Some("follow-up completed")
                    );
                    break;
                }
                EventMsg::Error(_) | EventMsg::TurnAborted(_) => {
                    panic!("unexpected terminal event")
                }
                _ => {}
            }
        }
    })
    .await
    .expect("same session must accept follow-up work");
    while let Ok(event) = receiver.try_recv() {
        assert!(!matches!(
            event.msg,
            EventMsg::TurnComplete(_) | EventMsg::TurnAborted(_)
        ));
    }
}

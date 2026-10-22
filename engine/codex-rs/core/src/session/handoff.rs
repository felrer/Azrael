//! Idle-only session ownership transfer. Admission closes before the ordered actor barrier.
use super::Session;
use super::SessionIo;
use super::Submission;
use codex_protocol::error::CodexErr;
use codex_protocol::error::Result as CodexResult;
use codex_protocol::protocol::Event;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::Op;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::sync::oneshot;

/// Clones share the admission fence, including callers that send directly.
#[derive(Clone)]
pub(crate) struct SubmissionSender {
    sender: async_channel::Sender<Submission>,
    open: Arc<Mutex<bool>>,
}

impl From<async_channel::Sender<Submission>> for SubmissionSender {
    fn from(sender: async_channel::Sender<Submission>) -> Self {
        Self {
            sender,
            open: Arc::new(Mutex::new(true)),
        }
    }
}

impl SubmissionSender {
    pub(crate) async fn send(&self, submission: Submission) -> CodexResult<()> {
        if matches!(&submission.op, Op::TryShutdownForHandoff { .. }) {
            return Err(CodexErr::InvalidRequest(
                "handoff requires fenced admission".into(),
            ));
        }
        let open = self.open.lock().await;
        if !*open {
            return Err(CodexErr::InvalidRequest(
                "thread ownership transfer is in progress".into(),
            ));
        }
        self.sender
            .send(submission)
            .await
            .map_err(|_| CodexErr::InternalAgentDied)
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.sender.is_closed()
    }

    async fn fence_and_send(&self, submission: Submission) -> CodexResult<()> {
        let mut open = self.open.lock().await;
        if !*open {
            return Err(CodexErr::InvalidRequest(
                "thread ownership transfer is in progress".into(),
            ));
        }
        *open = false;
        self.sender
            .send(submission)
            .await
            .map_err(|_| CodexErr::InternalAgentDied)
    }
}

impl SessionIo {
    pub(crate) async fn try_shutdown_for_handoff(&self) -> CodexResult<bool> {
        let io = self.clone();
        // The owned task keeps admission and teardown alive even if the RPC disappears.
        tokio::spawn(async move {
            let (reply, result) = oneshot::channel();
            io.tx_sub
                .fence_and_send(Submission {
                    id: super::new_submission_id(),
                    op: Op::TryShutdownForHandoff { reply },
                    turn_extension_init: None,
                    trace: None,
                    parent_turn_id: None,
                    root_turn_id: None,
                    residency_guard: None,
                })
                .await?;
            let ready = result.await.map_err(|_| CodexErr::InternalAgentDied)??;
            if ready {
                io.session_loop_termination.clone().await;
            } else {
                *io.tx_sub.open.lock().await = true;
            }
            Ok(ready)
        })
        .await
        .map_err(|error| CodexErr::Fatal(format!("handoff task failed: {error}")))?
    }
}

impl Session {
    /// Reserve task admission under the same lock used by idle handoff.
    pub(crate) async fn reserve_task_start_unless_shutting_down(&self) -> bool {
        let mut active = self.active_turn.lock().await;
        if self.state.lock().await.shutting_down {
            return false;
        }
        // Reserve before asynchronous preparation so handoff cannot seal the
        // session in the middle of installing this task.
        active.get_or_insert_with(crate::state::ActiveTurn::default);
        true
    }
}

pub(super) async fn shutdown_if_idle(session: &Arc<Session>, id: String) -> CodexResult<bool> {
    // Parent resume holds its control lock while reserving an active turn. Do
    // not invert that order by waiting for its control under active_turn.
    if session.has_parent_response_wait_for_handoff().await {
        return Ok(false);
    }
    let has_elicitations = *session.services.elicitations.subscribe().borrow();
    // Keep the same lock used for scheduler reservations until shutdown admission
    // is installed. Nothing is removed to make a busy session appear idle.
    let active = session.active_turn.lock().await;
    if active.is_some()
        || session
            .services
            .local_agent_runtime
            .has_shared_handoff_members()
        || session.has_root_resume_reservation()
        || session.parked_root_context().is_some()
        || session.parent_response_turn_is_deferred()
        || session.has_outstanding_durable_sleep()
        || session.pending_approval_count() != 0
        || session.has_host_approval_resume()
        || session.pending_question_count() != 0
        || !session.async_hook_results.is_empty()
        || !session.pending_code_mode_message_recordings().is_empty()
        || has_elicitations
        || session.input_queue.has_pending_mailbox_items().await
        || session.conversation.running_state().await.is_some()
        || !session.list_background_terminals().await.is_empty()
        || session
            .services
            .local_agent_runtime
            .list_live_agent_subtree_thread_ids(session.thread_id)
            .await?
            .len()
            > 1
    {
        return Ok(false);
    }
    let live = session
        .live_thread_for_persistence("transfer idle thread ownership")
        .map_err(|error| CodexErr::Fatal(error.to_string()))?;
    // No irreversible cleanup has happened yet. A flush failure keeps ownership.
    live.flush()
        .await
        .map_err(|error| CodexErr::Fatal(format!("pre-handoff flush failed: {error}")))?;
    if !session.services.local_agent_runtime.try_seal_for_handoff() {
        return Ok(false);
    }
    session.state.lock().await.shutting_down = true;
    drop(active);

    super::handlers::shutdown_session_runtime(session).await;
    // Both barriers are explicit: ordinary shutdown logs persistence failures.
    let flushed = live.flush().await;
    let closed = live.shutdown().await;
    flushed.map_err(|error| CodexErr::Fatal(format!("handoff flush failed: {error}")))?;
    closed.map_err(|error| CodexErr::Fatal(format!("handoff writer close failed: {error}")))?;
    if session.services.local_agent_runtime.shutdown_has_failures() {
        return Err(CodexErr::Fatal("handoff service cleanup failed".into()));
    }
    session
        .deliver_event_raw(Event {
            id,
            msg: EventMsg::ShutdownComplete,
        })
        .await;
    Ok(true)
}

#[cfg(test)]
#[path = "handoff_tests.rs"]
mod tests;

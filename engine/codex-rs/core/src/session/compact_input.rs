//! Ordered idle admission for queued manual compaction.

use std::sync::Arc;

use super::Session;
use crate::state::ActiveTurn;
use crate::tasks::CompactTask;
use codex_protocol::error::Result as CodexResult;
use codex_protocol::protocol::TokenUsageInfo;
use codex_protocol::turn_input::CompactIfIdleSubmission;
use codex_protocol::turn_input::NotSubmittedReason;

pub(super) async fn handle(
    session: &Arc<Session>,
    submission_id: String,
) -> CodexResult<CompactIfIdleSubmission> {
    let model = session.current_execution_model().await;
    if session.account_is_retired_for_model(&model)
        || session.execution_admission_for_model(&model).requires_recovery()
    {
        return Err(codex_protocol::error::CodexErr::new(
            codex_protocol::error::CodexErrorDetails::InvalidRequest(
                "The account is unavailable. Select a healthy account before continuing.".to_string(),
            ),
        ));
    }
    let _reservation_guard = session.root_resume_submission_guard().await;
    if session.has_root_resume_reservation() {
        return Ok(CompactIfIdleSubmission::NotSubmitted {
            reason: NotSubmittedReason::NotIdle,
        });
    }
    if session.input_queue.has_trigger_turn_mailbox_items().await {
        return Ok(CompactIfIdleSubmission::NotSubmitted {
            reason: NotSubmittedReason::PendingTriggerTurn,
        });
    }
    let turn_state = {
        let mut active_turn = session.active_turn.lock().await;
        if active_turn.is_some() {
            return Ok(CompactIfIdleSubmission::NotSubmitted {
                reason: NotSubmittedReason::NotIdle,
            });
        }
        Arc::clone(
            &active_turn
                .get_or_insert_with(ActiveTurn::default)
                .turn_state,
        )
    };
    if session.input_queue.has_trigger_turn_mailbox_items().await {
        session.clear_reserved_idle_turn(&turn_state).await;
        session.maybe_start_turn_for_pending_work().await;
        return Ok(CompactIfIdleSubmission::NotSubmitted {
            reason: NotSubmittedReason::PendingTriggerTurn,
        });
    }
    let usage = session.token_usage_info().await;
    if below_compaction_threshold(usage.as_ref()) {
        if let Some(usage) = usage {
            tracing::info!(
                last_total_tokens = usage.last_token_usage.total_tokens,
                model_context_window = usage.model_context_window,
                "queued compaction skipped below 15% context usage"
            );
        }
        session.clear_reserved_idle_turn(&turn_state).await;
        session.maybe_start_turn_for_pending_work().await;
        return Ok(CompactIfIdleSubmission::Skipped);
    }
    let context = session
        .new_turn_with_default_settings(submission_id.clone(), Default::default())
        .await;
    session.start_task(context, Vec::new(), CompactTask).await;
    Ok(CompactIfIdleSubmission::Started {
        turn_id: submission_id,
    })
}

fn below_compaction_threshold(usage: Option<&TokenUsageInfo>) -> bool {
    let Some(usage) = usage else {
        return false;
    };
    let Some(window) = usage.model_context_window.filter(|window| *window > 0) else {
        return false;
    };
    let total = usage.last_token_usage.total_tokens;
    total >= 0 && i128::from(total) * 100 < i128::from(window) * 15
}

#[cfg(test)]
#[path = "compact_input_tests.rs"]
mod tests;

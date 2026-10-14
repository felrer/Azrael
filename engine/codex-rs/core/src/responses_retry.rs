//! Shared retry and transport fallback decisions for Responses requests.
//! Content-filter guidance is recorded for sampling requests before retry decisions.
//! Server advice controls timing without extending configured retry limits.

use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;

use crate::capacity_recovery::CapacityRecoveryAction;
use crate::capacity_recovery::CapacityRecoveryState;
use crate::client::ModelClientSession;
use crate::context::ContentFilterGuidance;
use crate::context::ContextualUserFragment;
use crate::session::TurnInput;
use crate::session::session::Session;
use crate::session::step_context::StepContext;
use crate::session::turn_context::TurnContext;
use codex_client::RetryOperation;
use codex_features::Feature;
use codex_http_client::RetryAfter;
use codex_protocol::error::CodexErr;
use codex_protocol::error::CodexErrorDetails;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::WarningEvent;
use codex_protocol::user_input::UserInput;
use tokio::time::Instant;
use tracing::warn;

const INITIAL_CONNECTION_RETRY_DELAY: Duration = Duration::from_secs(5);
const MAX_CONNECTION_RETRY_DELAY: Duration = Duration::from_secs(60);

fn capacity_state(sess: &Session) -> Arc<Mutex<CapacityRecoveryState>> {
    sess.services
        .thread_extension_data
        .get_or_init(|| Mutex::new(CapacityRecoveryState::default()))
}

fn capacity_request_id(input: &TurnInput, turn_id: &str, trigger: Option<&str>) -> Option<String> {
    let TurnInput::UserInput {
        content,
        client_id,
        metadata,
    } = input
    else {
        return None;
    };
    if content.is_empty() || metadata.origin != codex_history::UserInputOrigin::User {
        return None;
    }
    // Retry/play and parked-root resume are continuations of an existing request.
    // The host's idle play action is normalized to this exact continue input.
    if trigger.is_some_and(|value| {
        value.starts_with("capacity_retry_")
            || value.starts_with("automation_")
            || value.starts_with("goal_")
            || matches!(
                value,
                "root_resume" | "resume_interrupted_task" | "codex_replay"
            )
    }) {
        return None;
    }
    if let [UserInput::Text { text, .. }] = content.as_slice() {
        let text = text
            .trim()
            .trim_end_matches(['.', '!', ' ', '\n', '\r', '\t']);
        if [
            "continue",
            "resume",
            "계속",
            "계속해",
            "계속해주세요",
            "이어서 진행",
        ]
        .iter()
        .any(|value| text.eq_ignore_ascii_case(value))
        {
            return None;
        }
    }
    Some(
        client_id
            .as_ref()
            .filter(|id| !id.is_empty())
            .cloned()
            .unwrap_or_else(|| {
                format!(
                    "{turn_id}:{}",
                    metadata.acceptance_order.unwrap_or_default()
                )
            }),
    )
}

/// Establish the budget only after a substantive user input is durably recorded.
#[cfg(test)]
fn begin_capacity_request(sess: &Session, turn: &TurnContext, input: &TurnInput) {
    begin_capacity_request_for_input(sess, turn, input, false);
}

pub(crate) fn begin_capacity_request_for_input(
    sess: &Session,
    turn: &TurnContext,
    input: &TurnInput,
    steered_user_input: bool,
) {
    let attribution = turn.attribution();
    // The turn trigger describes its opening input, not a new steering message.
    let trigger = if steered_user_input {
        None
    } else {
        attribution.turn_trigger.as_deref()
    };
    if let Some(id) = capacity_request_id(input, &turn.sub_id, trigger) {
        capacity_state(sess)
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .begin_request(id);
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum ResponsesStreamRequest {
    Sampling,
    RemoteCompactionV2,
}

pub(crate) struct ResponsesStreamRetryState {
    retries: u64,
    connection_retries: u64,
    connection_retry_delay: Duration,
}

impl Default for ResponsesStreamRetryState {
    fn default() -> Self {
        Self {
            retries: 0,
            connection_retries: 0,
            connection_retry_delay: INITIAL_CONNECTION_RETRY_DELAY,
        }
    }
}

/// Server retry advice retained after stream retries are exhausted. The turn ID
/// prevents a reused Guardian session from applying advice from an earlier review.
pub(crate) struct ExhaustedResponseRetry {
    pub(crate) turn_id: String,
    pub(crate) retry_at: Option<tokio::time::Instant>,
}

/// Returns `Ok(())` when the caller should retry the request loop, or the original error when
/// it is terminal or the retry budget is exhausted.
pub(crate) async fn handle_response_stream_error(
    retry_state: &mut ResponsesStreamRetryState,
    max_retries: u64,
    err: CodexErr,
    client_session: &mut ModelClientSession,
    sess: &Session,
    step_context: &StepContext,
    request: ResponsesStreamRequest,
) -> Result<(), CodexErr> {
    let turn_context = &step_context.turn;
    // This branch owns the entire capacity budget. Do not stack generic stream
    // retries or the transport-fallback counter on top of it. Returning the
    // original overload leaves the existing UI's 10/30/120/300 policy in charge.
    if matches!(request, ResponsesStreamRequest::Sampling)
        && matches!(err.details(), CodexErrorDetails::ServerOverloaded)
    {
        let action = capacity_state(sess)
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .on_overload();
        let now = Instant::now();
        let server_deadline = err.retry_after().map(RetryAfter::deadline);
        match action {
            CapacityRecoveryAction::Retry(delay) => {
                let retry_at =
                    server_deadline.map_or(now + delay, |deadline| deadline.max(now + delay));
                sess.notify_stream_error(turn_context, "Model at capacity; waiting to retry", err)
                    .await;
                tokio::time::sleep_until(retry_at).await;
                return Ok(());
            }
            CapacityRecoveryAction::RecreateConnection => {
                if let Some(deadline) = server_deadline {
                    tokio::time::sleep_until(deadline).await;
                }
                if client_session.recreate_capacity_connection().await {
                    tracing::info!(turn_id = %turn_context.sub_id, phase = "connection_recreated", "capacity recovery");
                    sess.notify_stream_error(
                        turn_context,
                        "Model at capacity; connection renewed, resuming",
                        err,
                    )
                    .await;
                    return Ok(());
                }
                tracing::warn!(turn_id = %turn_context.sub_id, phase = "termination_unconfirmed", "capacity recovery stopped");
                // A capacity error would re-arm the UI timer. Keep this boundary
                // stopped until the user explicitly checks the execution state.
                return Err(CodexErr::Fatal(
                    "capacity recovery stopped: prior response termination was not confirmed"
                        .to_owned(),
                ));
            }
            CapacityRecoveryAction::LegacyRetry => {
                // The legacy UI does not carry Retry-After across its new turn.
                // Finish the server wait before handing control back to it.
                if let Some(deadline) = server_deadline {
                    tokio::time::sleep_until(deadline).await;
                }
            }
        }
        sess.services
            .thread_extension_data
            .insert(ExhaustedResponseRetry {
                turn_id: turn_context.sub_id.clone(),
                retry_at: server_deadline,
            });
        return Err(err);
    }
    if matches!(request, ResponsesStreamRequest::Sampling)
        && matches!(err.details(), CodexErrorDetails::ContentFilter)
    {
        let model_info = &step_context.settings.model_info;
        let guidance = ContentFilterGuidance {
            text: codex_prompts::ResolvedModelMessages::from_model(model_info)
                .content_filter_guidance()
                .to_string(),
        };
        sess.record_conversation_items(
            turn_context,
            model_info,
            &[ContextualUserFragment::into(guidance)],
        )
        .await;
    }
    let operation = match request {
        ResponsesStreamRequest::Sampling => RetryOperation::Sampling,
        ResponsesStreamRequest::RemoteCompactionV2 => RetryOperation::RemoteCompactionV2,
    };
    let retry_count = retry_state.retries.saturating_add(1);
    let Some(delay) = err.retry_delay(retry_count) else {
        return Err(err);
    };
    let retry_after = err.retry_after();

    if turn_context
        .config
        .features
        .enabled(Feature::UnboundedConnectionRetries)
        && matches!(request, ResponsesStreamRequest::Sampling)
        && matches!(err.details(), CodexErrorDetails::ConnectionFailed(_))
        && !turn_context.session_source.is_internal()
        && !turn_context.provider.info().is_amazon_bedrock()
    {
        let retry_delay = retry_state.connection_retry_delay;
        warn!(
            turn_id = %turn_context.sub_id,
            error = %err,
            ?retry_delay,
            "stream connection failed; waiting to retry"
        );
        sess.notify_stream_error(turn_context, "Reconnecting... waiting for network", err)
            .await;
        retry_state.connection_retries = retry_state.connection_retries.saturating_add(1);
        codex_client::record_retry!(retry_state.connection_retries, retry_delay, operation);
        tokio::time::sleep(retry_delay).await;
        retry_state.connection_retry_delay = retry_delay
            .saturating_mul(2)
            .min(MAX_CONNECTION_RETRY_DELAY);
        return Ok(());
    }

    if retry_state.retries >= max_retries
        && client_session.try_switch_fallback_transport(
            &turn_context.session_telemetry,
            turn_context.model_info(),
        )
    {
        // Changing transport must not bypass the server's retry deadline.
        if let Some(retry_after) = retry_after {
            tokio::time::sleep_until(retry_after.deadline()).await;
        }
        sess.send_event(
            turn_context,
            EventMsg::Warning(WarningEvent {
                message: format!("Falling back from WebSockets to HTTPS transport. {err:#}"),
            }),
        )
        .await;
        retry_state.retries = 0;
        return Ok(());
    }

    if retry_state.retries < max_retries {
        retry_state.retries = retry_count;
        log_retry(request, turn_context, &err, retry_count, max_retries, delay);

        // In release builds, hide the first websocket retry notification to reduce noisy
        // transient reconnect messages. In debug builds, keep full visibility for diagnosis.
        let report_error = retry_count > 1
            || cfg!(debug_assertions)
            || !sess.services.model_client.responses_websocket_enabled();
        if report_error {
            // Surface retry information to any UI/front-end so the user understands what is
            // happening instead of staring at a seemingly frozen screen.
            sess.notify_stream_error(
                turn_context,
                format!("Reconnecting... {retry_count}/{max_retries}"),
                err,
            )
            .await;
        }
        // Use one clock sample so local backoff telemetry retains the selected delay.
        let now = Instant::now();
        let retry_at = retry_after.map(RetryAfter::deadline).unwrap_or(now + delay);
        let delay = retry_at.saturating_duration_since(now);
        codex_client::record_retry!(retry_count, delay, operation);
        tokio::time::sleep_until(retry_at).await;
        return Ok(());
    }

    sess.services
        .thread_extension_data
        .insert(ExhaustedResponseRetry {
            turn_id: turn_context.sub_id.clone(),
            retry_at: retry_after.map(RetryAfter::deadline),
        });
    Err(err)
}

fn log_retry(
    request: ResponsesStreamRequest,
    turn_context: &TurnContext,
    err: &CodexErr,
    retries: u64,
    max_retries: u64,
    delay: Duration,
) {
    match request {
        ResponsesStreamRequest::Sampling => {
            warn!(
                turn_id = %turn_context.sub_id,
                retries,
                max_retries,
                sampling_error = %err,
                "stream disconnected - retrying sampling request ({retries}/{max_retries} in {delay:?})...",
            );
        }
        ResponsesStreamRequest::RemoteCompactionV2 => {
            warn!(
                turn_id = %turn_context.sub_id,
                retries,
                max_retries,
                compact_error = %err,
                "remote compaction v2 stream failed; retrying request after delay"
            );
        }
    }
}

#[cfg(test)]
#[path = "responses_retry_tests.rs"]
mod tests;

//! Plaintext checkpoints at provider boundaries; original rollout records stay intact.
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use crate::client_common::Prompt;
use crate::client_common::ResponseEvent;
use crate::compact::CompactedHistoryMetadata;
use crate::context::CompactionSummary;
use crate::context::ContextualUserFragment;
use crate::session::PreviousTurnSettings;
use crate::session::session::Session;
use crate::session::turn_context::TurnContext;
use codex_async_utils::OrCancelExt;
use codex_history::ResponseItemEnvelope;
use codex_history::RolloutItem;
use codex_model_provider::create_model_provider;
use codex_protocol::error::CodexErr;
use codex_protocol::error::CodexErrorDetails;
use codex_protocol::error::Result;
use codex_protocol::models::ResponseItem;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::WarningEvent;
use codex_rollout_trace::InferenceTraceContext;
use futures::StreamExt;
use tokio_util::sync::CancellationToken;

// A byte cap also bounds the worst-case token count below 10K. Reviewed as a
// potentially >1K-token context fragment; it uses the existing summary fragment.
const MAX_SUMMARY_BYTES: usize = 8_192;
const SUMMARY_REQUEST: &str = "Prepare a plain-text handoff for another provider. Summarize the user's objective, constraints, decisions, completed work, exact relevant file paths, validation evidence, and remaining work. Do not perform the task or call tools. Distinguish verified facts from uncertainty. Return only the summary, at most 6000 UTF-8 bytes.";
fn quota_warning(source: &str, target: &str) -> String {
    format!(
        "{source} usage is exhausted or unavailable for this conversation. Continuing with {target} using saved public messages and tool results only; private reasoning was excluded, encrypted context was omitted and some earlier details may be missing."
    )
}

fn provider_id<'a>(model: &'a str, native_id: &'a str) -> &'a str {
    if let Ok((provider, _)) = crate::managed_catalog::selection(model) {
        provider
    } else if crate::devin::catalog::is_devin(model) {
        crate::devin::PROVIDER_ID
    } else {
        native_id
    }
}

fn needs_summary(items: &[ResponseItemEnvelope]) -> bool {
    items.iter().any(|item| match &item.item {
        ResponseItem::Message { role, .. } => role == "assistant",
        ResponseItem::Reasoning { .. }
        | ResponseItem::Compaction { .. }
        | ResponseItem::ContextCompaction { .. }
        | ResponseItem::FunctionCall { .. }
        | ResponseItem::CustomToolCall { .. }
        | ResponseItem::ToolSearchCall { .. }
        | ResponseItem::AgentMessage { .. } => true,
        _ => false,
    })
}

fn quota_exhausted(error: &CodexErr) -> bool {
    matches!(
        error.details(),
        CodexErrorDetails::UsageLimitReached(_)
            | CodexErrorDetails::QuotaExceeded
            | CodexErrorDetails::UsageNotIncluded
    )
}

pub(super) fn public_history(items: &[ResponseItemEnvelope]) -> Vec<ResponseItemEnvelope> {
    let mut calls = HashSet::new();
    items
        .iter()
        .cloned()
        .filter_map(|mut envelope| {
            match &mut envelope.item {
                ResponseItem::Message { .. } | ResponseItem::AdditionalTools { .. } => {}
                ResponseItem::AgentMessage { content, .. } => {
                    content.retain(|part| {
                        matches!(
                            part,
                            codex_protocol::models::AgentMessageInputContent::InputText { .. }
                        )
                    });
                    if content.is_empty() {
                        return None;
                    }
                }
                // A quota handoff uses saved user-visible conversation, not
                // unsigned reasoning replay from the exhausted provider.
                ResponseItem::Reasoning { .. } => return None,
                ResponseItem::FunctionCall {
                    encrypted_function_args,
                    call_id,
                    ..
                } => {
                    *encrypted_function_args = None;
                    calls.insert(call_id.clone());
                }
                ResponseItem::CustomToolCall { call_id, .. } => {
                    calls.insert(call_id.clone());
                }
                ResponseItem::ToolSearchCall {
                    call_id: Some(call_id),
                    execution,
                    ..
                } if execution == "client" => {
                    calls.insert(call_id.clone());
                }
                ResponseItem::FunctionCallOutput {
                    call_id: Some(call_id),
                    ..
                }
                | ResponseItem::CustomToolCallOutput { call_id, .. }
                    if calls.contains(call_id) => {}
                ResponseItem::ToolSearchOutput {
                    call_id: Some(call_id),
                    execution,
                    ..
                } if execution == "client" && calls.contains(call_id) => {}
                _ => return None,
            }
            Some(envelope)
        })
        .collect()
}

fn opaque_context(item: &ResponseItem) -> Option<&str> {
    match item {
        ResponseItem::Compaction {
            encrypted_content, ..
        }
        | ResponseItem::ContextCompaction {
            encrypted_content: Some(encrypted_content),
            ..
        } if !encrypted_content.is_empty() => Some(encrypted_content),
        _ => None,
    }
}

fn checkpoint_owner(items: &[RolloutItem], opaque: &str) -> Option<String> {
    let mut model = None;
    for item in items {
        match item {
            RolloutItem::TurnContext(context) => model = Some(context.model.clone()),
            RolloutItem::Compacted(checkpoint)
                if checkpoint
                    .replacement_history
                    .as_ref()
                    .is_some_and(|items| {
                        items
                            .iter()
                            .any(|item| opaque_context(&item.item) == Some(opaque))
                    }) =>
            {
                return model;
            }
            RolloutItem::ResponseItem(item) if opaque_context(&item.item) == Some(opaque) => {
                return model;
            }
            _ => {}
        }
    }
    None
}

pub(crate) async fn prepare(
    sess: &Arc<Session>,
    target: &Arc<TurnContext>,
    cancellation: &CancellationToken,
) -> Result<()> {
    if cancellation.is_cancelled() {
        return Err(CodexErr::TurnAborted);
    }
    let Some(previous) = sess.previous_turn_settings().await else {
        return Ok(());
    };
    let history = sess.clone_history().await;
    let mut source_model = previous.model;
    // Failed target requests also record TurnContext. For an existing encrypted
    // checkpoint, recover its actual producer instead of treating the last
    // attempted target as the owner (including retrying that same target).
    if let Some(opaque) = history
        .annotated_items()
        .iter()
        .rev()
        .find_map(|item| opaque_context(&item.item))
        && let Some(live_thread) = sess.live_thread()
    {
        sess.flush_rollout().await.map_err(|_| {
            CodexErr::InvalidRequest("Unable to flush provider handoff history".into())
        })?;
        // Local paginated threads deliberately reject the legacy load_history
        // API. Read their existing rollout with the native parser instead.
        let local_path = live_thread.local_rollout_path().await.map_err(|_| {
            CodexErr::InvalidRequest("Unable to locate provider handoff history".into())
        })?;
        let items = if let Some(path) = local_path {
            let (items, _, _) = codex_rollout::RolloutRecorder::load_rollout_items(&path)
                .or_cancel(cancellation)
                .await
                .map_err(|_| CodexErr::TurnAborted)?
                .map_err(|_| {
                    CodexErr::InvalidRequest("Unable to read provider handoff rollout".into())
                })?;
            items
        } else {
            live_thread
                .load_history(false)
                .or_cancel(cancellation)
                .await
                .map_err(|_| CodexErr::TurnAborted)?
                .map_err(|_| {
                    CodexErr::InvalidRequest("Unable to read provider handoff history".into())
                })?
                .items
        };
        if let Some(owner) = checkpoint_owner(&items, opaque) {
            source_model = owner;
        }
    }
    if !crate::managed_catalog::is_managed(&source_model)
        && !crate::devin::catalog::is_devin(&source_model)
        && !crate::managed_catalog::is_managed(&target.model_info().slug)
        && !crate::devin::catalog::is_devin(&target.model_info().slug)
    {
        return Ok(());
    }
    let native_id = target
        .config
        .native_model_provider
        .as_ref()
        .map_or(target.config.model_provider_id.as_str(), |(id, _)| {
            id.as_str()
        });
    let source_provider = provider_id(&source_model, native_id);
    let target_provider = provider_id(&target.model_info().slug, native_id);
    if source_provider == target_provider {
        return Ok(());
    }
    if !needs_summary(history.annotated_items()) {
        return Ok(());
    }
    tracing::info!(
        event = "provider_handoff_started",
        from = source_provider,
        to = target_provider
    );
    let result = tokio::time::timeout(
        Duration::from_secs(180),
        summarize(sess, target, &source_model, cancellation),
    )
    .or_cancel(cancellation)
    .await
    .map_err(|_| CodexErr::TurnAborted)?
    .map_err(|_| {
        CodexErr::Stream("Provider handoff summary timed out; history was preserved".into())
    })?;
    let (replacement, message, response_id) = match result {
        Ok((summary, response_id)) => {
            let text = format!("{}\n{summary}", crate::compact::SUMMARY_PREFIX);
            (
                crate::compact::build_compacted_history(Vec::new(), &[], &text),
                text,
                Some(response_id),
            )
        }
        Err(error) if quota_exhausted(&error) => {
            let warning = quota_warning(source_provider, target_provider);
            sess.send_event(
                target,
                EventMsg::Warning(WarningEvent {
                    message: warning.clone(),
                }),
            )
            .await;
            let normalized = history.for_prompt_annotated(&target.model_info().input_modalities);
            let mut projected = public_history(&normalized);
            projected.push(ContextualUserFragment::into(CompactionSummary::new(&warning)).into());
            tracing::warn!(
                event = "provider_handoff_quota_fallback",
                from = source_provider,
                to = target_provider
            );
            (projected, warning, None)
        }
        Err(error) => return Err(error),
    };
    if cancellation.is_cancelled() {
        return Err(CodexErr::TurnAborted);
    }
    let (window_number, window_ids) = sess.advance_auto_compact_window().await;
    // Reset the context baseline so ordinary turn admission reinjects the target
    // instructions. The replacement is persisted without editing original records.
    sess.replace_compacted_history(
        replacement,
        None,
        None,
        CompactedHistoryMetadata {
            message,
            window_number,
            window_ids,
            compaction_response_id: response_id,
            compaction_model_hash: None,
            reviewer_compaction_hash: None,
        },
    )
    .await;
    sess.set_previous_turn_settings(Some(PreviousTurnSettings {
        model: target.model_info().slug.clone(),
        cyber_access_program: target.cyber_access_program,
        comp_hash: target.model_info().comp_hash.clone(),
        realtime_active: Some(target.realtime_active),
    }))
    .await;
    sess.recompute_token_usage(target).await;
    tracing::info!(
        event = "provider_handoff_completed",
        from = source_provider,
        to = target_provider
    );
    Ok(())
}

async fn summarize(
    sess: &Arc<Session>,
    target: &TurnContext,
    model: &str,
    cancellation: &CancellationToken,
) -> Result<(String, String)> {
    let mut source = target
        .with_model(model.to_string(), &sess.services.models_manager)
        .await;
    let config = Arc::make_mut(&mut source.config);
    if crate::managed_catalog::is_managed(model) {
        // This model was already admitted for the source history. Discovery may
        // have changed since then; the helper must check its original account pin.
        config.model = Some(model.to_string());
        config.model_provider_id = crate::managed_catalog::PROVIDER_ID.to_string();
        config.model_provider = crate::managed_catalog::provider_info();
    } else {
        crate::devin::select_model(config, model)
            .map_err(|error| CodexErr::InvalidRequest(error.to_string()))?;
    }
    let helper =
        crate::managed_catalog::is_managed(model) || crate::devin::catalog::is_devin(model);
    source.auth_manager = (!helper).then(|| Arc::clone(&sess.services.auth_manager));
    source.provider =
        create_model_provider(config.model_provider.clone(), source.auth_manager.clone());
    source.sub_id = format!("{}-handoff", target.sub_id);
    source.final_output_json_schema = None;
    let source = Arc::new(source);
    let history = sess.clone_history().await;
    let mut prompt = Prompt {
        input: history.for_prompt(&source.model_info().input_modalities),
        base_instructions: sess.get_prompt_base_instructions().await,
        ..Default::default()
    };
    prompt
        .input
        .push(ContextualUserFragment::into(CompactionSummary::new(
            SUMMARY_REQUEST,
        )));
    let metadata = sess.handoff_responses_metadata(&source).await;
    let mut client = sess
        .services
        .model_client
        .session_for_provider(Arc::clone(&source.provider), None);
    let mut stream = if crate::managed_catalog::is_managed(model) {
        crate::managed_runtime::stream(
            sess,
            &source,
            prompt,
            cancellation.child_token(),
            source.reasoning_effort(),
            &metadata,
            model,
        )
        .await?
    } else if crate::devin::catalog::is_devin(model) {
        crate::devin::native_runtime::stream(
            Arc::clone(sess),
            Arc::clone(&source),
            prompt,
            cancellation.child_token(),
            source.reasoning_effort(),
        )
        .await?
    } else {
        let prompt = crate::managed_runtime::project_openai(&prompt);
        client
            .stream(
                &prompt,
                source.model_info(),
                &source.session_telemetry,
                source.reasoning_effort().cloned(),
                source.reasoning_summary(),
                source.config.service_tier.clone(),
                &metadata,
                &InferenceTraceContext::disabled(),
            )
            .await?
    };
    let mut summary = String::new();
    while let Some(event) = stream
        .next()
        .or_cancel(cancellation)
        .await
        .map_err(|_| CodexErr::TurnAborted)?
    {
        match event? {
            ResponseEvent::OutputItemDone(ResponseItem::Message { role, content, .. })
                if role == "assistant" =>
            {
                if let Some(text) = crate::compact::content_items_to_text(&content) {
                    if summary.len() + text.len() + 1 > MAX_SUMMARY_BYTES {
                        return Err(CodexErr::InvalidRequest(
                            "Provider handoff summary exceeded its limit; history was preserved"
                                .into(),
                        ));
                    }
                    if !summary.is_empty() {
                        summary.push('\n');
                    }
                    summary.push_str(&text);
                }
            }
            ResponseEvent::OutputItemDone(ResponseItem::Reasoning { .. }) => {}
            ResponseEvent::OutputItemDone(_) => {
                return Err(CodexErr::InvalidRequest(
                    "Provider handoff returned a non-text item; no tools were executed".into(),
                ));
            }
            ResponseEvent::RateLimits(snapshot) => sess.update_rate_limits(&source, snapshot).await,
            ResponseEvent::Completed {
                response_id,
                token_usage,
                usage_metadata,
                ..
            } => {
                let mut usage_settings = (*source.initial_settings).clone();
                if !crate::managed_catalog::is_managed(model) && !crate::devin::catalog::is_devin(model) {
                    usage_settings.service_tier = source.config.service_tier.clone();
                }
                sess.record_observed_response_completed(
                    &source,
                    &usage_settings,
                    &source.initial_environments,
                    &response_id,
                    token_usage.as_ref(),
                    usage_metadata.as_ref(),
                )
                .await;
                if summary.trim().is_empty() {
                    return Err(CodexErr::Stream(
                        "Provider handoff returned no summary; history was preserved".into(),
                    ));
                }
                return Ok((summary, response_id));
            }
            _ => {}
        }
    }
    Err(CodexErr::Stream(
        "Provider handoff ended before completion; history was preserved".into(),
    ))
}

#[cfg(test)]
#[path = "provider_handoff_tests.rs"]
mod tests;

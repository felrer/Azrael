//! Managed transports share Devin's validated native tool protocol and process bounds.
use crate::client_common::Prompt;
use crate::client_common::ResponseStream;
use crate::responses_metadata::CodexResponsesMetadata;
use crate::session::session::Session;
use crate::session::turn_context::TurnContext;
use codex_history::RolloutItem;
use codex_protocol::error::CodexErr;
use codex_protocol::error::CodexErrorDetails;
use codex_protocol::error::Result as CodexResult;
use codex_protocol::models::ResponseItem;
use codex_protocol::openai_models::ReasoningEffort;
use serde::Serialize;
use tokio_util::sync::CancellationToken;

#[derive(Serialize)]
struct InitFrame<'a> {
    r#type: &'static str,
    protocol_version: u8,
    request_id: &'a str,
}
#[derive(Serialize)]
struct RequestFrame<'a> {
    r#type: &'static str,
    protocol_version: u8,
    request_id: &'a str,
    thread_id: &'a str,
    turn_id: &'a str,
    provider_id: &'a str,
    model: &'a str,
    instructions: &'a str,
    input: &'a [ResponseItem],
    tools: &'a [codex_tools::ToolSpec],
    parallel_tool_calls: bool,
    reasoning_effort: Option<String>,
    forked_from_thread_id: Option<String>,
    forked_from_ordinal_exclusive: Option<u64>,
    fork_provider_ids: &'a [String],
}

pub(crate) async fn stream(
    sess: &Session,
    ctx: &TurnContext,
    prompt: Prompt,
    cancellation: CancellationToken,
    reasoning_effort: Option<&ReasoningEffort>,
    metadata: &CodexResponsesMetadata,
    model_key: &str,
) -> CodexResult<ResponseStream> {
    let invalid = |message: String| CodexErr::new(CodexErrorDetails::InvalidRequest(message));
    if prompt.output_schema.is_some() || ctx.final_output_json_schema.is_some() {
        return Err(invalid(
            "managed providers do not support output schemas".to_string(),
        ));
    }
    crate::devin::native_runtime::ensure_native_history(
        ctx.config.codex_home.as_path(),
        &sess.thread_id().to_string(),
    )?;
    if let Some(ancestor) = sess.native_binding_ancestor {
        crate::devin::native_runtime::ensure_native_history(
            ctx.config.codex_home.as_path(),
            &ancestor.to_string(),
        )?;
    }
    let history = sess.clone_history().await;
    // Images are normalized by native `for_prompt` from the selected model's
    // modalities: forwarded when declared, otherwise replaced by placeholders.
    if history.raw_items().any(unsupported_media) {
        return Err(invalid(
            "managed providers support text and image history only; this thread contains unsupported media"
                .to_string(),
        ));
    }
    // Selection admission validates the discovery catalog. An admitted turn's
    // continuation must not be invalidated by concurrent model/list refreshes.
    // The helper still validates its immutable turn/model/account binding.
    let (provider, model) =
        crate::managed_catalog::selection(model_key).map_err(|error| invalid(error.to_string()))?;
    let (helper, bun) =
        crate::managed_catalog::runtime_paths().map_err(|error| invalid(error.to_string()))?;
    let request_id = uuid::Uuid::new_v4().to_string();
    let thread_id = sess.thread_id().to_string();
    let init = crate::devin::native_runtime::serialize_frame(&InitFrame {
        r#type: "init",
        protocol_version: 1,
        request_id: &request_id,
    })?;
    let request = crate::devin::native_runtime::serialize_frame(&RequestFrame {
        r#type: "request",
        protocol_version: 1,
        request_id: &request_id,
        thread_id: &thread_id,
        turn_id: &ctx.sub_id,
        provider_id: provider,
        model,
        instructions: &prompt.base_instructions.text,
        input: &prompt.input,
        tools: &prompt.tools,
        parallel_tool_calls: prompt.parallel_tool_calls,
        reasoning_effort: reasoning_effort.map(ToString::to_string),
        forked_from_thread_id: metadata
            .forked_from_thread_id
            .as_ref()
            .map(ToString::to_string),
        forked_from_ordinal_exclusive: metadata.forked_from_ordinal_exclusive,
        fork_provider_ids: &sess.fork_provider_ids,
    })?;
    crate::devin::native_runtime::run_helper(crate::devin::native_runtime::HelperRequest {
        anthropic_thinking: provider == "anthropic",
        executable: bun.as_path(),
        helper: helper.as_path(),
        codex_home: ctx.config.codex_home.as_path(),
        init,
        request,
        prompt,
        request_id,
        cancellation,
        turn_guard: (),
    })
    .await
}

fn unsupported_media(item: &ResponseItem) -> bool {
    use codex_protocol::models::ContentItem;
    use codex_protocol::models::FunctionCallOutputBody;
    use codex_protocol::models::FunctionCallOutputContentItem;
    match item {
        ResponseItem::Message { content, .. } => content
            .iter()
            .any(|part| matches!(part, ContentItem::InputAudio { .. })),
        ResponseItem::FunctionCallOutput { output, .. }
        | ResponseItem::CustomToolCallOutput { output, .. } => match &output.body {
            FunctionCallOutputBody::ContentItems(parts) => parts
                .iter()
                .any(|part| matches!(part, FunctionCallOutputContentItem::InputAudio { .. })),
            FunctionCallOutputBody::Text(_) => false,
        },
        ResponseItem::ImageGenerationCall { .. } => true,
        _ => false,
    }
}

/// Native fork trimming owns the cutoff; helper ordinals must never substitute
/// for rollout ordinals. Only providers present in retained context may inherit pins.
pub(crate) fn fork_provider_ids(items: &[RolloutItem]) -> Vec<String> {
    let mut providers = std::collections::BTreeSet::new();
    for item in items {
        if let RolloutItem::TurnContext(context) = item
            && let Ok((provider, _)) = crate::managed_catalog::selection(&context.model)
        {
            providers.insert(provider.to_string());
        }
    }
    providers.into_iter().collect()
}

/// Project helper-private envelopes out of OpenAI requests. Public reasoning
/// remains intact; authoritative native history is never rewritten.
pub(crate) fn project_openai(prompt: &Prompt) -> Prompt {
    let mut prompt = prompt.clone();
    for item in &mut prompt.input {
        if let ResponseItem::Reasoning {
            encrypted_content: Some(encrypted),
            ..
        } = item
            && (encrypted.starts_with("azrael-managed")
                || encrypted.starts_with("azrael-devin")
                || encrypted.starts_with("devin:"))
            && let ResponseItem::Reasoning {
                encrypted_content, ..
            } = item
        {
            *encrypted_content = None;
        }
    }
    prompt.input.retain(|item| !matches!(item, ResponseItem::Reasoning { summary, content, encrypted_content: None, .. } if summary.is_empty() && content.as_ref().is_none_or(Vec::is_empty)));
    prompt
}

#[cfg(test)]
#[path = "managed_runtime_tests.rs"]
mod tests;

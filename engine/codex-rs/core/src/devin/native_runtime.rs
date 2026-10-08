use super::catalog;
use crate::client_common::Prompt;
use crate::client_common::ResponseStream;
use crate::session::session::Session;
use crate::session::turn_context::TurnContext;
use codex_api::ResponseEvent;
use codex_protocol::error::CodexErr;
use codex_protocol::error::CodexErrorDetails;
use codex_protocol::error::Result as CodexResult;
use codex_protocol::models::ContentItem;
use codex_protocol::models::ResponseItem;
use codex_protocol::openai_models::ReasoningEffort;
use codex_protocol::protocol::TokenUsage;
use codex_tools::ToolSpec;
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncBufReadExt;
use tokio::io::AsyncReadExt;
use tokio::io::AsyncWriteExt;
use tokio::io::BufReader;
use tokio::process::Child;
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::instrument::WithSubscriber;

const HELPER_ENV: &str = "AZRAEL_DEVIN_NATIVE_HELPER";
const NODE_ENV: &str = "AZRAEL_DEVIN_NODE";
const PROTOCOL_VERSION: u8 = 1;
const STREAM_CAPACITY: usize = 64;
const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 16 * 1024 * 1024;
const HELPER_SCRUBBED_ENV: &[&str] = &[
    "BUN_OPTIONS",
    "NODE_OPTIONS",
    "NODE_PATH",
    "WINDSURF_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENCODEX_DEVIN_API_KEY",
    "OPENCODEX_DEVIN_BASE_URL",
    "OPENCODEX_DEVIN_MODEL",
    "OPENCODEX_DEVIN_TTFB_MS",
    "OPENCODEX_DEVIN_SEND_USER_JWT",
    "OPENCODEX_DEVIN_CLIENT_VERSION",
    "OPENCODEX_DEVIN_CHAT_CLIENT_VERSION",
];
#[path = "native_runtime_activity.rs"]
mod activity;
#[path = "native_runtime_recovery.rs"]
mod recovery;
use activity::TimingPolicy;
use recovery::AttemptOutcome;

#[path = "native_runtime_state.rs"]
mod state;
use state::Credential;
use state::RuntimeBinding;
use state::existing_account_binding;
use state::pin_native_runtime;
#[path = "native_runtime_accounts.rs"]
mod accounts;
#[path = "native_runtime_process.rs"]
mod process;
use process::absolute_env_path;
use process::sanitize_code;
#[path = "native_runtime_protocol.rs"]
mod protocol;
#[path = "native_runtime_transport.rs"]
mod transport;
use protocol::OutputFrame;
#[path = "native_runtime_capabilities.rs"]
mod capabilities;
#[path = "native_runtime_errors.rs"]
mod errors;
pub(crate) use capabilities::image_model_ids;
#[cfg(test)]
use protocol::Usage;
use protocol::validate_usage;
#[path = "native_runtime_tools.rs"]
mod tools;
use tools::ToolCatalog;
use tools::historical_call_ids;
#[path = "native_tool_diagnostics.rs"]
mod native_tool_diagnostics;

pub(crate) fn enabled() -> bool {
    std::env::var_os(HELPER_ENV).is_some_and(|value| !value.is_empty())
}

#[derive(Serialize)]
struct InitFrame<'a> {
    r#type: &'static str,
    protocol_version: u8,
    request_id: &'a str,
    credential: &'a Credential,
}

#[derive(Serialize)]
struct RequestFrame<'a> {
    r#type: &'static str,
    protocol_version: u8,
    request_id: &'a str,
    thread_id: &'a str,
    turn_id: &'a str,
    model: &'a str,
    instructions: &'a str,
    input: &'a [ResponseItem],
    tools: &'a [ToolSpec],
    parallel_tool_calls: bool,
}

pub(crate) async fn stream(
    sess: Arc<Session>,
    ctx: Arc<TurnContext>,
    prompt: Prompt,
    cancellation: CancellationToken,
    reasoning_effort: Option<&ReasoningEffort>,
) -> CodexResult<ResponseStream> {
    if prompt.output_schema.is_some() || ctx.final_output_json_schema.is_some() {
        return Err(invalid("native Devin does not support output schemas"));
    }
    let helper = absolute_env_path(HELPER_ENV)?;
    let node = absolute_env_path(NODE_ENV)?;
    let selection = catalog::resolve(
        ctx.config.codex_home.as_path(),
        &ctx.model_info().slug,
        reasoning_effort,
    )
    .map_err(|error| invalid(format!("unable to resolve Devin model: {error}")))?;
    let cwd = ctx
        .initial_environments
        .primary()
        .ok_or_else(|| invalid("native Devin requires a ready local turn environment"))?
        .cwd()
        .to_abs_path()
        .map_err(|error| {
            invalid(format!(
                "native Devin requires a local working directory: {error}"
            ))
        })?;
    let thread_id = sess.thread_id().to_string();
    let mut existing_binding =
        existing_account_binding(ctx.config.codex_home.as_path(), &thread_id)?;
    if let Some(account) = ctx
        .devin_account_pin
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
    {
        existing_binding = state::ExistingAccountBinding::Managed(account);
    }
    // Once this fork has a marker, its current binding is authoritative.
    let ancestor = matches!(existing_binding, state::ExistingAccountBinding::NoMarker)
        .then(|| sess.native_binding_ancestor.map(|id| id.to_string()))
        .flatten();
    if matches!(existing_binding, state::ExistingAccountBinding::NoMarker)
        && let Some(ancestor) = ancestor.as_deref()
    {
        state::ensure_native_history(ctx.config.codex_home.as_path(), ancestor)?;
        existing_binding = existing_account_binding(ctx.config.codex_home.as_path(), ancestor)?;
    }

    let accounts::ResolvedCredential {
        credential,
        account_id,
        _turn_guard,
    } = accounts::resolve(ctx.config.codex_home.as_path(), existing_binding).await?;
    if let Some(account) = account_id.as_ref() {
        let mut pin = ctx
            .devin_account_pin
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if pin.as_ref().is_some_and(|pinned| pinned != account) {
            return Err(invalid("Devin turn account binding changed"));
        }
        *pin = Some(account.clone());
    }
    let credential_scope = credential.scope_fingerprint();
    if let Some(ancestor) = ancestor.as_deref() {
        state::validate_ancestor_binding(
            ctx.config.codex_home.as_path(),
            ancestor,
            RuntimeBinding {
                model_id: &selection.model_id,
                cwd: cwd.as_path(),
                credential_scope: &credential_scope,
                account_id: account_id.as_deref(),
            },
        )?;
    }
    pin_native_runtime(
        ctx.config.codex_home.as_path(),
        &thread_id,
        RuntimeBinding {
            model_id: &selection.model_id,
            cwd: cwd.as_path(),
            credential_scope: &credential_scope,
            account_id: account_id.as_deref(),
        },
    )?;
    if cancellation.is_cancelled() {
        return Err(CodexErr::new(CodexErrorDetails::Interrupted));
    }
    let request_id = uuid::Uuid::new_v4().to_string();
    let engine_exe = std::env::current_exe().ok();
    tracing::info!(target: "devin_native_progress", event = "native_inference_started", %request_id, %thread_id,
        turn_id = %ctx.sub_id, model = %selection.model_id,
        engine_pid = std::process::id(),
        engine_exe = %engine_exe.as_deref().map(|path| path.display().to_string()).unwrap_or_default(),
        helper = %helper.display(), runtime = %node.display());
    native_tool_diagnostics::log_catalog(&prompt.tools, &request_id, &thread_id, &ctx.sub_id);
    let init = serialize_frame(&InitFrame {
        r#type: "init",
        protocol_version: PROTOCOL_VERSION,
        request_id: &request_id,
        credential: &credential,
    })?;
    let request = serialize_frame(&RequestFrame {
        r#type: "request",
        protocol_version: PROTOCOL_VERSION,
        request_id: &request_id,
        thread_id: &thread_id,
        turn_id: &ctx.sub_id,
        model: &selection.model_id,
        instructions: &prompt.base_instructions.text,
        input: &prompt.input,
        tools: &prompt.tools,
        parallel_tool_calls: prompt.parallel_tool_calls,
    })?;
    run_helper(HelperRequest {
        executable: node.as_path(),
        helper: helper.as_path(),
        codex_home: ctx.config.codex_home.as_path(),
        init,
        request,
        prompt,
        request_id,
        cancellation,
        turn_guard: _turn_guard,
    })
    .await
}

/// Shared bounded JSONL transport. The guard keeps the turn's credentials pinned
/// until the child and its validated terminal frame have completed.
pub(crate) struct HelperRequest<'a, G> {
    pub(crate) executable: &'a Path,
    pub(crate) helper: &'a Path,
    pub(crate) codex_home: &'a Path,
    pub(crate) init: Vec<u8>,
    pub(crate) request: Vec<u8>,
    pub(crate) prompt: Prompt,
    pub(crate) request_id: String,
    pub(crate) cancellation: CancellationToken,
    pub(crate) turn_guard: G,
}

pub(crate) async fn run_helper<G: Send + 'static>(
    request: HelperRequest<'_, G>,
) -> CodexResult<ResponseStream> {
    run_helper_with_policy(request, TimingPolicy::default()).await
}

async fn run_helper_with_policy<G: Send + 'static>(
    request: HelperRequest<'_, G>,
    policy: TimingPolicy,
) -> CodexResult<ResponseStream> {
    let HelperRequest {
        executable,
        helper,
        codex_home,
        init,
        request,
        prompt,
        request_id,
        cancellation,
        turn_guard,
    } = request;
    ToolCatalog::from_specs(&prompt.tools)?;
    let historical_call_ids = historical_call_ids(&prompt.input);
    let mut command = Command::new(executable);
    command
        .arg(helper)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .env("CODEX_HOME", codex_home)
        .env(
            "OPENCODEX_HOME",
            codex_home.join("azrael/providers/opencodex"),
        );
    for name in HELPER_SCRUBBED_ENV {
        command.env_remove(name);
    }
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let started = tokio::time::Instant::now();
    let (child, stdout) = recovery::start_helper(
        &mut command,
        helper,
        executable,
        &init,
        &request,
        &request_id,
        &cancellation,
    )
    .await?;
    let (tx, rx) = mpsc::channel(STREAM_CAPACITY);
    let consumer_dropped = CancellationToken::new();
    let dropped = consumer_dropped.clone();
    let parent_span = tracing::Span::current();
    let helper = helper.to_path_buf();
    let executable = executable.to_path_buf();
    tokio::spawn(
        async move {
            recovery::recover(
                command,
                helper,
                executable,
                init,
                request,
                prompt,
                request_id,
                cancellation,
                dropped,
                &tx,
                parent_span,
                policy,
                started,
                child,
                stdout,
                historical_call_ids,
            )
            .await;
            drop(turn_guard);
        }
        .with_current_subscriber(),
    );
    Ok(ResponseStream {
        rx_event: rx,
        interrupt: None,
        consumer_dropped,
    })
}

struct ConsumeContext<'a> {
    policy: TimingPolicy,
    started: tokio::time::Instant,
    parent_span: tracing::Span,
    request_id: &'a str,
    tools: ToolCatalog,
    call_ids: HashSet<String>,
    tx: &'a mpsc::Sender<CodexResult<ResponseEvent>>,
    cancellation: &'a CancellationToken,
    dropped: &'a CancellationToken,
}

#[tracing::instrument(name = "native_inference_consume", skip_all, parent = &context.parent_span,
    fields(request_id = context.request_id))]
async fn consume(
    mut child: Child,
    stdout: tokio::process::ChildStdout,
    context: ConsumeContext<'_>,
) -> CodexResult<AttemptOutcome> {
    let ConsumeContext {
        policy,
        started,
        request_id,
        tools,
        mut call_ids,
        tx,
        cancellation,
        dropped,
        parent_span: _,
    } = context;
    let mut stdout = BufReader::new(stdout);
    let mut expected_seq = 0u64;
    let mut total = 0usize;
    let mut stats = ConsumeStats::default();
    let mut created = false;
    let mut terminal: Option<OutputFrame> = None;
    let mut pending_events = Vec::new();
    let mut active_text: Option<(Option<codex_protocol::ResponseItemId>, String)> = None;
    let mut last_progress: Option<protocol::Progress> = None;
    let deadline = tokio::time::sleep_until(started + policy.deadline);
    tokio::pin!(deadline);
    let mut activity = activity::InferenceActivity::new(tokio::time::Instant::now());
    loop {
        let idle = tokio::time::sleep_until(activity.last_activity + policy.idle);
        tokio::pin!(idle);
        let frame = tokio::select! {
            biased;
            _ = cancellation.cancelled() => {
                return Err(fail_consume(&mut child, &stats, request_id, "cancelled",
                    CodexErr::new(CodexErrorDetails::Interrupted)).await);
            }
            _ = dropped.cancelled() => {
                return Err(fail_consume(&mut child, &stats, request_id, "consumer_dropped",
                    CodexErr::new(CodexErrorDetails::Interrupted)).await);
            }
            _ = &mut deadline => {
                if let Some(progress) = &last_progress { progress.log(request_id, "engine_deadline"); }
                return Err(fail_consume(&mut child, &stats, request_id, "engine_deadline",
                    fatal("native inference request exceeded its deadline")).await);
            }
            _ = &mut idle => {
                if let Some(progress) = &last_progress { progress.log(request_id, "inference_output_idle"); }
                let status = terminate(&mut child).await;
                stats.log(request_id, "inference_output_idle", status.and_then(|status| status.code()));
                return Ok(AttemptOutcome::InferenceIdle { last_event: activity.last_event, inactivity: activity.last_activity.elapsed() });
            }
            result = read_frame(&mut stdout, &mut total) => match result {
                Ok(frame) => frame,
                Err(failure) => {
                    // total already counts the rejected frame once it was fully
                    // bounded; reflect it so malformed bytes are not hidden.
                    stats.output_bytes = u64::try_from(total).unwrap_or(u64::MAX);
                    return Err(fail_consume(&mut child, &stats, request_id, failure.reason,
                        failure.error).await);
                }
            },
        };
        let Some(frame) = frame else { break };
        stats.frames += 1;
        stats.output_bytes = u64::try_from(total).unwrap_or(u64::MAX);
        stats.last_frame_kind = Some(frame_kind(&frame.r#type));
        stats.last_frame_ms = Some(elapsed_ms(&stats.started));
        if terminal.is_some() {
            return Err(fail_consume(
                &mut child,
                &stats,
                request_id,
                "output_after_terminal",
                fatal("native Devin emitted output after its terminal frame"),
            )
            .await);
        }
        if frame.protocol_version != PROTOCOL_VERSION
            || frame.request_id != request_id
            || frame.seq != expected_seq
        {
            return Err(fail_consume(
                &mut child,
                &stats,
                request_id,
                "invalid_envelope",
                fatal("native inference returned an invalid protocol envelope"),
            )
            .await);
        }
        expected_seq = match expected_seq.checked_add(1) {
            Some(next) => next,
            None => {
                return Err(fail_consume(
                    &mut child,
                    &stats,
                    request_id,
                    "sequence_overflow",
                    fatal("native Devin sequence overflow"),
                )
                .await);
            }
        };
        match frame.r#type.as_str() {
            "progress"
                if frame.item.is_none()
                    && frame.delta.is_none()
                    && frame.usage.is_none()
                    && frame.code.is_none()
                    && frame.diagnostics.is_none() =>
            {
                let progress = frame
                    .progress
                    .ok_or_else(|| fatal("progress omitted telemetry"));
                let progress = match progress {
                    Ok(progress) => progress,
                    Err(error) => {
                        return Err(fail_consume(
                            &mut child,
                            &stats,
                            request_id,
                            "progress_missing_telemetry",
                            error,
                        )
                        .await);
                    }
                };
                activity.observe(&progress, tokio::time::Instant::now(), policy.idle);
                progress.log(request_id, "running");
                last_progress = Some(progress);
            }
            "created" if !created && frame.item.is_none() && frame.delta.is_none() => {
                created = true;
                pending_events.push(ResponseEvent::Created { response_id: None });
            }
            "item_added" if created => {
                let item = match frame.item {
                    Some(item) => item,
                    None => {
                        return Err(fail_consume(
                            &mut child,
                            &stats,
                            request_id,
                            "item_missing",
                            fatal("item_added omitted item"),
                        )
                        .await);
                    }
                };
                let ResponseItem::Message { id, content, .. } = &item else {
                    return Err(fail_consume(
                        &mut child,
                        &stats,
                        request_id,
                        "invalid_item_start",
                        fatal("item_added is only valid for assistant text"),
                    )
                    .await);
                };
                if active_text.is_some()
                    || !matches!(content.as_slice(), [ContentItem::OutputText { text }] if text.is_empty())
                {
                    return Err(fail_consume(
                        &mut child,
                        &stats,
                        request_id,
                        "invalid_item_start",
                        fatal("native inference returned an invalid text item start"),
                    )
                    .await);
                }
                if let Err(error) = tools.verify(&item, &mut call_ids) {
                    return Err(fail_consume(
                        &mut child,
                        &stats,
                        request_id,
                        "tool_verification",
                        error,
                    )
                    .await);
                }
                active_text = Some((id.clone(), String::new()));
                pending_events.push(ResponseEvent::OutputItemAdded(item));
            }
            "text_delta" if created => {
                let delta = match frame.delta {
                    Some(delta) => delta,
                    None => {
                        return Err(fail_consume(
                            &mut child,
                            &stats,
                            request_id,
                            "delta_missing",
                            fatal("text_delta omitted delta"),
                        )
                        .await);
                    }
                };
                let Some((_, text)) = active_text.as_mut() else {
                    return Err(fail_consume(
                        &mut child,
                        &stats,
                        request_id,
                        "text_without_item",
                        fatal("native inference returned text without an active item"),
                    )
                    .await);
                };
                text.push_str(&delta);
                pending_events.push(ResponseEvent::OutputTextDelta(delta));
            }
            "item_done" if created => {
                let item = match frame.item {
                    Some(item) => item,
                    None => {
                        return Err(fail_consume(
                            &mut child,
                            &stats,
                            request_id,
                            "item_missing",
                            fatal("item_done omitted item"),
                        )
                        .await);
                    }
                };
                match &item {
                    ResponseItem::Message { id, content, .. } => {
                        if let Some((expected_id, expected_text)) = active_text.take()
                            && (expected_id.as_ref() != id.as_ref()
                                || !matches!(content.as_slice(), [ContentItem::OutputText { text }] if text == &expected_text))
                        {
                            return Err(fail_consume(
                                &mut child,
                                &stats,
                                request_id,
                                "mismatched_item_done",
                                fatal("native Devin completed a different text item"),
                            )
                            .await);
                        }
                    }
                    _ if active_text.is_some() => {
                        return Err(fail_consume(
                            &mut child,
                            &stats,
                            request_id,
                            "tool_during_text",
                            fatal("native inference returned a tool while text was still active"),
                        )
                        .await);
                    }
                    _ => {}
                }
                if let Err(error) = tools.verify(&item, &mut call_ids) {
                    return Err(fail_consume(
                        &mut child,
                        &stats,
                        request_id,
                        "tool_verification",
                        error,
                    )
                    .await);
                }
                pending_events.push(ResponseEvent::OutputItemDone(item));
            }
            "completed" if created && active_text.is_none() => terminal = Some(frame),
            "error" => {
                let code = sanitize_code(frame.code.as_deref());
                let error = errors::helper_error(frame.code.as_deref());
                tracing::warn!(target: "devin_native_progress", event = "native_inference_error_classified",
                    request_id = %request_id, code,
                    error_kind = ?error.to_codex_protocol_error());
                if let Some(progress) = frame.progress.as_ref().or(last_progress.as_ref()) {
                    progress.log(request_id, &code);
                }
                if let Some(diagnostics) = &frame.diagnostics {
                    tracing::warn!(target: "devin_native_progress", event = "native_inference_helper_failed",
                        request_id = %request_id,
                        code, event_count = ?diagnostics.event_count,
                        last_event = sanitize_code(diagnostics.last_event.as_deref()),
                        history_type = sanitize_code(diagnostics.history_type.as_deref()),
                        transport_error = ?diagnostics.transport_error_code(),
                        http_status = ?diagnostics.http_status_code(),
                        provider_error_code = ?diagnostics.provider_error_code(),
                        provider_error_source = ?diagnostics.provider_error_source(),
                        provider_trace_id = ?diagnostics.provider_trace_id(),
                        provider_reason = ?diagnostics.provider_reason(),
                        finish_reason = ?diagnostics.finish_reason_code(),
                        provider_stop_reason = ?diagnostics.provider_stop_reason.filter(|reason| *reason <= 13),
                        pending_tool_count = ?diagnostics.pending_tool_count,
                        active_tool_call = ?diagnostics.active_tool_call);
                }
                return Err(
                    fail_consume(&mut child, &stats, request_id, "helper_error", error).await,
                );
            }
            _ => {
                return Err(fail_consume(
                    &mut child,
                    &stats,
                    request_id,
                    "invalid_event_sequence",
                    fatal("native inference returned an invalid event sequence"),
                )
                .await);
            }
        }
        if stats.last_frame_kind != Some("progress") {
            activity.last_activity = tokio::time::Instant::now();
        }
    }
    let Some(completed) = terminal else {
        return Err(fail_consume(
            &mut child,
            &stats,
            request_id,
            "eof_without_terminal",
            fatal("native inference helper ended without a terminal event"),
        )
        .await);
    };
    let status = tokio::select! {
        biased;
        _ = cancellation.cancelled() => {
            return Err(fail_consume(&mut child, &stats, request_id, "cancelled",
                CodexErr::new(CodexErrorDetails::Interrupted)).await);
        }
        _ = dropped.cancelled() => {
            return Err(fail_consume(&mut child, &stats, request_id, "consumer_dropped",
                CodexErr::new(CodexErrorDetails::Interrupted)).await);
        }
        _ = &mut deadline => {
            return Err(fail_consume(&mut child, &stats, request_id, "engine_deadline",
                fatal("native inference request exceeded its deadline")).await);
        }
        result = tokio::time::timeout(Duration::from_secs(5), child.wait()) => {
            match result {
                Ok(Ok(status)) => status,
                Ok(Err(_)) => {
                    return Err(fail_consume(&mut child, &stats, request_id,
                        "helper_status_unavailable",
                        fatal("native inference helper status unavailable")).await);
                }
                Err(_) => {
                    return Err(fail_consume(&mut child, &stats, request_id, "helper_exit_timeout",
                        fatal("native inference helper exit timed out")).await);
                }
            }
        }
    };
    let exit_code = status.code();
    if !status.success() {
        stats.log(request_id, "helper_exit_nonzero", exit_code);
        return Err(fatal("native inference helper exited unsuccessfully"));
    }
    if let Err(error) = validate_usage(completed.usage.as_ref()) {
        stats.log(request_id, "invalid_usage", exit_code);
        return Err(error);
    }
    if let Some(progress) = completed.progress.as_ref().or(last_progress.as_ref()) {
        progress.log(request_id, "completed");
    }
    for event in pending_events {
        if cancellation.is_cancelled() || dropped.is_cancelled() {
            stats.log(request_id, "interrupted_flush", exit_code);
            return Err(CodexErr::new(CodexErrorDetails::Interrupted));
        }
        let sent = tokio::select! {
            biased;
            _ = cancellation.cancelled() => Err(CodexErr::new(CodexErrorDetails::Interrupted)),
            _ = dropped.cancelled() => Err(CodexErr::new(CodexErrorDetails::Interrupted)),
            _ = &mut deadline => Err(fatal("native inference request exceeded its deadline during output delivery")),
            result = send(tx, event) => result,
        };
        if let Err(error) = sent {
            stats.log(request_id, "interrupted_flush", exit_code);
            return Err(error);
        }
    }
    let usage = completed.usage.map(|usage| TokenUsage {
        input_tokens: usage.input_tokens,
        cached_input_tokens: usage.cached_input_tokens,
        cache_write_input_tokens: 0,
        output_tokens: usage.output_tokens,
        reasoning_output_tokens: usage.reasoning_output_tokens,
        total_tokens: usage.total_tokens,
        codex_rollout_budget_units: None,
    });
    let completed_event = ResponseEvent::Completed {
        response_id: format!("devin-native-{request_id}"),
        token_usage: usage,
        usage_metadata: None,
        end_turn: Some(true),
    };
    let result = tokio::select! {
        biased;
        _ = cancellation.cancelled() => Err(CodexErr::new(CodexErrorDetails::Interrupted)),
        _ = dropped.cancelled() => Err(CodexErr::new(CodexErrorDetails::Interrupted)),
        _ = &mut deadline => Err(fatal("native inference request exceeded its deadline during output delivery")),
        result = send(tx, completed_event) => result,
    };
    match result {
        Ok(()) => {
            stats.log(request_id, "completed", exit_code);
            Ok(AttemptOutcome::Completed)
        }
        Err(error) => {
            stats.log(request_id, "interrupted_flush", exit_code);
            Err(error)
        }
    }
}

/// Structural counters for bounded lifecycle logging. Never holds frame content.
/// `output_bytes` reports the bounded `total` accepted by `read_frame`: every
/// complete newline-delimited frame that passed the size gate, including a
/// malformed frame's bytes once counted. A frame rejected by the size gate is
/// not included because partial byte counts are unavailable at that boundary.
struct ConsumeStats {
    started: std::time::Instant,
    frames: u64,
    output_bytes: u64,
    last_frame_kind: Option<&'static str>,
    last_frame_ms: Option<u64>,
}

impl Default for ConsumeStats {
    fn default() -> Self {
        Self {
            started: std::time::Instant::now(),
            frames: 0,
            output_bytes: 0,
            last_frame_kind: None,
            last_frame_ms: None,
        }
    }
}

impl ConsumeStats {
    fn log(&self, request_id: &str, outcome: &'static str, exit_code: Option<i32>) {
        tracing::info!(target: "devin_native_progress", event = "native_inference_finished",
            %request_id, outcome,
            elapsed_ms = elapsed_ms(&self.started),
            frames_received = self.frames,
            output_bytes = self.output_bytes,
            last_frame_kind = self.last_frame_kind.unwrap_or("none"),
            last_frame_ms = ?self.last_frame_ms,
            child_exit_code = exit_code.unwrap_or(-1));
    }
}

fn elapsed_ms(started: &std::time::Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// Stable frame-kind labels; unknown kinds are never logged verbatim.
fn frame_kind(kind: &str) -> &'static str {
    match kind {
        "progress" => "progress",
        "created" => "created",
        "item_added" => "item_added",
        "text_delta" => "text_delta",
        "item_done" => "item_done",
        "completed" => "completed",
        "error" => "error",
        _ => "unknown",
    }
}

/// Terminate the child, then record a bounded structural outcome. The returned
/// error keeps the existing code and message unchanged.
async fn fail_consume(
    child: &mut Child,
    stats: &ConsumeStats,
    request_id: &str,
    reason: &'static str,
    error: CodexErr,
) -> CodexErr {
    let status = terminate(child).await;
    stats.log(request_id, reason, status.and_then(|status| status.code()));
    error
}

struct FrameFailure {
    reason: &'static str,
    error: CodexErr,
}

impl FrameFailure {
    fn new(reason: &'static str, message: impl Into<String>) -> Self {
        Self {
            reason,
            error: fatal(message),
        }
    }
}

async fn read_frame(
    reader: &mut BufReader<tokio::process::ChildStdout>,
    total: &mut usize,
) -> Result<Option<OutputFrame>, FrameFailure> {
    let mut bytes = Vec::new();
    let mut bounded = reader.take((MAX_FRAME_BYTES + 2) as u64);
    let read = bounded.read_until(b'\n', &mut bytes).await.map_err(|_| {
        FrameFailure::new(
            "read_failure",
            "failed reading native inference helper output",
        )
    })?;
    if read == 0 {
        return Ok(None);
    }
    if bytes.len() > MAX_FRAME_BYTES + 1 || !bytes.ends_with(b"\n") {
        return Err(FrameFailure::new(
            "frame_limit",
            "native Devin output frame exceeded the hard limit",
        ));
    }
    *total = total
        .checked_add(bytes.len())
        .ok_or_else(|| FrameFailure::new("output_overflow", "native Devin output size overflow"))?;
    if *total > MAX_OUTPUT_BYTES {
        return Err(FrameFailure::new(
            "output_limit",
            "native Devin output exceeded the hard limit",
        ));
    }
    if bytes.ends_with(b"\n") {
        bytes.pop();
    }
    if bytes.ends_with(b"\r") {
        bytes.pop();
    }
    serde_json::from_slice(&bytes).map(Some).map_err(|_| {
        FrameFailure::new(
            "malformed_jsonl",
            "native inference returned malformed JSONL",
        )
    })
}

async fn terminate(child: &mut Child) -> Option<std::process::ExitStatus> {
    let _ = child.kill().await;
    child.wait().await.ok()
}

async fn send(
    tx: &mpsc::Sender<CodexResult<ResponseEvent>>,
    event: ResponseEvent,
) -> CodexResult<()> {
    tx.send(Ok(event))
        .await
        .map_err(|_| CodexErr::new(CodexErrorDetails::Interrupted))
}

pub(crate) fn serialize_frame<T: Serialize>(value: &T) -> CodexResult<Vec<u8>> {
    let mut bytes = serde_json::to_vec(value)
        .map_err(|_| invalid("unable to serialize native inference request"))?;
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(invalid("native inference request exceeded the hard limit"));
    }
    bytes.push(b'\n');
    Ok(bytes)
}

pub(crate) fn ensure_native_history(codex_home: &Path, thread_id: &str) -> CodexResult<()> {
    state::ensure_native_history(codex_home, thread_id)
}

pub(crate) async fn recover_account(
    sess: &Session,
    ctx: &TurnContext,
    excluded: &mut HashSet<String>,
    cancellation: &CancellationToken,
) -> CodexResult<Option<String>> {
    if !enabled() {
        return Ok(None);
    }
    let home = ctx.config.codex_home.as_path();
    let thread_id = sess.thread_id().to_string();
    let state::ExistingAccountBinding::Managed(source) =
        existing_account_binding(home, &thread_id)?
    else {
        // CLI credentials and unpinned threads cannot authorize recovery.
        return Ok(None);
    };
    let snapshot = state::recovery_snapshot(home, &thread_id)?;
    let model = ctx.model_info().slug.clone();
    let Some(destination) = crate::managed_account_recovery::request_recovery(
        home,
        "devin",
        &thread_id,
        &ctx.sub_id,
        &model,
        excluded,
        Some(&source),
        cancellation,
    )
    .await?
    else {
        return Ok(None);
    };
    let config = accounts::helper_config()?
        .ok_or_else(|| invalid("managed Devin account helper is required"))?;
    let credential = tokio::select! {
        biased;
        _ = cancellation.cancelled() => return Err(CodexErr::new(CodexErrorDetails::Interrupted)),
        value = accounts::request_recovery_credential(home, &config, &destination.account_id, cancellation) => value?,
    }.ok_or_else(|| invalid("managed Devin recovery credential is unavailable"))?;
    let resolved = accounts::managed_credential(credential);
    if cancellation.is_cancelled() {
        return Err(CodexErr::new(CodexErrorDetails::Interrupted));
    }
    state::replace_managed_binding(
        home,
        &thread_id,
        &snapshot,
        &source,
        &destination.account_id,
        &resolved.credential.scope_fingerprint(),
    )?;
    *ctx.devin_account_pin
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(destination.account_id.clone());
    excluded.insert(destination.exhausted_account_id);
    Ok(Some(destination.account_id))
}

pub(crate) fn pin_acp_runtime(codex_home: &Path, thread_id: &str) -> CodexResult<()> {
    state::pin_acp_runtime(codex_home, thread_id)
}

pub(crate) fn retirement_binding(home: &Path, thread_id: &str) -> CodexResult<Option<String>> {
    match existing_account_binding(home, thread_id)? {
        state::ExistingAccountBinding::Managed(account) => Ok(Some(account)),
        _ => Ok(None),
    }
}

pub(crate) async fn retire_binding(
    home: &Path,
    thread_id: &str,
    source: &str,
    destination: &str,
    cancellation: &CancellationToken,
) -> CodexResult<()> {
    let current = retirement_binding(home, thread_id)?
        .ok_or_else(|| invalid("Devin future account binding disappeared"))?;
    if current == destination {
        // A peer already installed the validated future binding. Never undo it.
        return Ok(());
    }
    if current != source
        && !crate::account_retirement::devin_source_is_retired(
            home,
            thread_id,
            &current,
            cancellation,
        )
        .await?
    {
        // Preserve a healthy concurrent manual/peer choice. The old turn remains stopped.
        return Ok(());
    }
    let snapshot = state::recovery_snapshot(home, thread_id)?;
    let config = accounts::helper_config()?
        .ok_or_else(|| invalid("managed Devin account helper is required"))?;
    let credential =
        accounts::request_retirement_credential(home, &config, destination, cancellation)
            .await?
            .ok_or_else(|| invalid("retirement replacement account is unavailable"))?;
    let resolved = accounts::managed_credential(credential);
    if cancellation.is_cancelled() {
        return Err(CodexErr::new(CodexErrorDetails::Interrupted));
    }
    state::replace_managed_binding(
        home,
        thread_id,
        &snapshot,
        &current,
        destination,
        &resolved.credential.scope_fingerprint(),
    )
}

fn invalid(message: impl Into<String>) -> CodexErr {
    CodexErr::new(CodexErrorDetails::InvalidRequest(message.into()))
}

fn fatal(message: impl Into<String>) -> CodexErr {
    CodexErr::new(CodexErrorDetails::Fatal(message.into()))
}

#[cfg(test)]
#[path = "native_runtime_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "native_runtime_recovery_tests.rs"]
mod recovery_tests;

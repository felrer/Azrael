use super::catalog;
use crate::client_common::Prompt;
use crate::client_common::ResponseStream;
use crate::session::session::Session;
use crate::session::turn_context::TurnContext;
use codex_api::ResponseEvent;
use codex_devin::AcpClient;
use codex_devin::ServerMessage;
use codex_devin::ServerNotification;
use codex_protocol::error::CodexErr;
use codex_protocol::error::CodexErrorDetails;
use codex_protocol::error::Result as CodexResult;
use codex_protocol::models::ContentItem;
use codex_protocol::models::MessagePhase;
use codex_protocol::models::PermissionProfile;
use codex_protocol::models::ResponseItem;
use codex_protocol::openai_models::ReasoningEffort;
use serde_json::Value;
use serde_json::json;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

const STREAM_CAPACITY: usize = 64;
const MAX_OUTPUT_BYTES: usize = 1024 * 1024;

#[path = "runtime_context.rs"]
mod context;
use context::Reconcile;
use context::SessionSidecar;
use context::add_output;
use context::checkpoint_with_assistant_items;
use context::drain_replay;
use context::encode_context;
use context::persist_sidecar;
use context::read_sidecar;
use context::reconcile;
use context::setup_initialize;
use context::setup_request;
use context::sidecar_path;
use context::supports_load_session;
use context::verify_model;
#[path = "runtime_tools.rs"]
mod tool_observations;
use tool_observations::ToolTracker;
#[path = "runtime_permissions.rs"]
mod permissions;
use permissions::handle_request;

#[tracing::instrument(skip_all, fields(thread_id = %sess.thread_id(), turn_id = %ctx.sub_id))]
pub(crate) async fn stream(
    sess: Arc<Session>,
    ctx: Arc<TurnContext>,
    prompt: Prompt,
    cancellation: CancellationToken,
    reasoning_effort: Option<&ReasoningEffort>,
) -> CodexResult<ResponseStream> {
    if super::native_runtime::enabled() {
        return super::native_runtime::stream(sess, ctx, prompt, cancellation, reasoning_effort)
            .await;
    }
    validate_policy(&ctx)?;
    let cwd = ctx
        .initial_environments
        .primary()
        .ok_or_else(|| invalid("Devin requires a ready local turn environment"))?
        .cwd()
        .to_abs_path()
        .map_err(|error| invalid(format!("Devin requires a local working directory: {error}")))?;
    let turn_guard = super::account::turn_guard()?;
    if prompt.output_schema.is_some() || ctx.final_output_json_schema.is_some() {
        return Err(invalid("Devin ACP does not support Codex output schemas"));
    }

    let selection = catalog::resolve(
        ctx.config.codex_home.as_path(),
        &ctx.model_info().slug,
        reasoning_effort,
    )
    .map_err(|error| invalid(format!("unable to resolve Devin model: {error}")))?;
    let context = encode_context(&prompt.input)?;
    if cancellation.is_cancelled() {
        return Err(CodexErr::new(CodexErrorDetails::Interrupted));
    }
    let sidecar_path = sidecar_path(
        ctx.config.codex_home.as_path(),
        sess.thread_id().to_string(),
    );
    super::native_runtime::pin_acp_runtime(
        ctx.config.codex_home.as_path(),
        &sess.thread_id().to_string(),
    )?;
    let prior = read_sidecar(&sidecar_path)?;
    let reconcile = reconcile(prior.as_ref(), &selection.model_id, cwd.as_path(), &context);

    tracing::info!(event = "devin_session_initializing", model = %selection.model_id);
    let (client, mut messages) = AcpClient::spawn(&selection.executable, &selection.model_id)
        .map_err(|error| fatal(format!("failed to start Devin ACP: {error}")))?;
    let initialized = setup_initialize(&client, &mut messages, &cancellation).await?;
    tracing::info!(event = "devin_session_initialized");

    let (external_session_id, delta_start) = match reconcile {
        Reconcile::Resume { delta_start } => {
            tracing::info!(event = "devin_session_loading");
            if !supports_load_session(&initialized) {
                let _ = client.close().await;
                return Err(invalid(
                    "Devin ACP cannot resume the recorded external session",
                ));
            }
            let prior = prior
                .as_ref()
                .unwrap_or_else(|| panic!("resume requires sidecar"));
            setup_request(
                &client,
                &mut messages,
                &cancellation,
                "session/load",
                json!({"sessionId": prior.external_session_id, "cwd": cwd, "mcpServers": []}),
            )
            .await?;
            if let Err(error) = drain_replay(&mut messages) {
                let _ = client.close().await;
                return Err(error);
            }
            (prior.external_session_id.clone(), delta_start)
        }
        Reconcile::New { .. } => {
            tracing::info!(event = "devin_session_creating");
            let result = setup_request(
                &client,
                &mut messages,
                &cancellation,
                "session/new",
                json!({"cwd": cwd, "mcpServers": []}),
            )
            .await?;
            let Some(id) = result.get("sessionId").and_then(Value::as_str) else {
                let _ = client.close().await;
                return Err(fatal("Devin ACP session/new omitted sessionId"));
            };
            (id.to_owned(), 0)
        }
    };

    let configured = setup_request(
        &client,
        &mut messages,
        &cancellation,
        "session/set_config_option",
        json!({
            "sessionId": external_session_id,
            "configId": "model",
            "value": selection.model_id,
        }),
    )
    .await?;
    if let Err(error) = verify_model(&configured, &selection.model_id) {
        let _ = client.close().await;
        return Err(error);
    }
    tracing::info!(event = "devin_session_ready", session_id = %external_session_id, model = %selection.model_id);

    let (tx, rx) = mpsc::channel(STREAM_CAPACITY);
    let consumer_dropped = CancellationToken::new();
    let dropped = consumer_dropped.clone();
    let prompt_parts = context[delta_start..].to_vec();
    let cwd = cwd.to_path_buf();
    let model_uid = selection.model_id.clone();
    tokio::spawn(async move {
        let result = run_prompt(
            &client,
            &mut messages,
            &sess,
            &ctx,
            &external_session_id,
            prompt_parts,
            &tx,
            &cancellation,
            &dropped,
        )
        .await;
        match result {
            Ok(assistant_items) => {
                let sidecar = SessionSidecar {
                    external_session_id: external_session_id.clone(),
                    provider: "devin".to_string(),
                    model_uid,
                    cwd,
                    checkpoint: checkpoint_with_assistant_items(&context, &assistant_items),
                };
                if let Err(error) = persist_sidecar(sidecar_path, sidecar).await {
                    let _ = tx.send(Err(error)).await;
                } else {
                    let _ = send(
                        &tx,
                        ResponseEvent::Completed {
                            response_id: format!("devin-{external_session_id}-{}", ctx.sub_id),
                            token_usage: None,
                            usage_metadata: None,
                            end_turn: Some(true),
                        },
                    )
                    .await;
                }
            }
            Err(error) => {
                let _ = tx.send(Err(error)).await;
            }
        }
        let _ = client.close().await;
        drop(turn_guard);
    });
    Ok(ResponseStream {
        rx_event: rx,
        interrupt: None,
        consumer_dropped,
    })
}

async fn run_prompt(
    client: &AcpClient,
    messages: &mut mpsc::Receiver<ServerMessage>,
    sess: &Session,
    ctx: &TurnContext,
    session_id: &str,
    parts: Vec<String>,
    tx: &mpsc::Sender<CodexResult<ResponseEvent>>,
    cancellation: &CancellationToken,
    dropped: &CancellationToken,
) -> CodexResult<Vec<String>> {
    let started = std::time::Instant::now();
    let mut tools = ToolTracker::new(session_id, &ctx.sub_id);
    tracing::info!(event = "devin_prompt_started", session_id, turn_id = %ctx.sub_id);
    let result = run_prompt_inner(
        client,
        messages,
        sess,
        ctx,
        session_id,
        parts,
        tx,
        cancellation,
        dropped,
        &mut tools,
    )
    .await;
    let reason = if cancellation.is_cancelled() || dropped.is_cancelled() {
        "prompt_interrupted"
    } else if result.is_err() {
        "prompt_failed"
    } else {
        "prompt_ended_without_tool_result"
    };
    tools.finish(sess, ctx, reason).await;
    tracing::info!(event = "devin_prompt_finished", session_id, turn_id = %ctx.sub_id,
        elapsed_ms = started.elapsed().as_millis() as u64, success = result.is_ok(), reason);
    result
}

async fn run_prompt_inner(
    client: &AcpClient,
    messages: &mut mpsc::Receiver<ServerMessage>,
    sess: &Session,
    ctx: &TurnContext,
    session_id: &str,
    parts: Vec<String>,
    tx: &mpsc::Sender<CodexResult<ResponseEvent>>,
    cancellation: &CancellationToken,
    dropped: &CancellationToken,
    tools: &mut ToolTracker,
) -> CodexResult<Vec<String>> {
    send(tx, ResponseEvent::Created { response_id: None }).await?;
    let prompt = client.request(
        "session/prompt",
        json!({
            "sessionId": session_id,
            "prompt": parts.into_iter().map(|text| json!({"type":"text", "text":text})).collect::<Vec<_>>()
        }),
    );
    tokio::pin!(prompt);
    let mut assistant = String::new();
    let mut assistant_items = Vec::new();
    let mut output_bytes = 0usize;
    let mut added = false;
    let mut last_activity = std::time::Instant::now();
    let mut activity = tokio::time::interval(std::time::Duration::from_secs(30));
    activity.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    activity.tick().await;
    loop {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => {
                cancel(client, session_id).await;
                return Err(CodexErr::new(CodexErrorDetails::Interrupted));
            }
            _ = dropped.cancelled() => {
                cancel(client, session_id).await;
                return Err(CodexErr::new(CodexErrorDetails::Interrupted));
            }
            message = messages.recv() => match message {
                Some(ServerMessage::Notification(notification)) => {
                    last_activity = std::time::Instant::now();
                    if notification.params.get("sessionId").and_then(Value::as_str).is_some_and(|id| id != session_id) {
                        return Err(fatal("Devin notification belongs to a different session"));
                    }
                    if let Some(text) = notification_text(&notification)? {
                        add_output(&mut assistant, &text)?;
                        output_bytes = output_bytes.saturating_add(text.len());
                        if output_bytes > MAX_OUTPUT_BYTES {
                            return Err(fatal("Devin output exceeded the hard limit"));
                        }
                        if !added { emit_added(tx, MessagePhase::FinalAnswer, "").await?; added = true; }
                        send(tx, ResponseEvent::OutputTextDelta(text)).await?;
                    } else {
                        tools.observe(&notification, sess, ctx).await?;
                    }
                }
                Some(ServerMessage::Request(request)) => {
                    let permission_params = if request.method == "session/request_permission" {
                        tools.permission_params(&request.params)
                    } else {
                        Err("unsupported_method")
                    };
                    let permission = handle_request(client, sess, ctx, session_id, request, permission_params, cancellation, dropped);
                    // EOF resolves the pending prompt even while approval is open.
                    // Do not leave the native turn waiting for an exited provider.
                    tokio::select! {
                        biased;
                        result = permission => result?,
                        result = &mut prompt => {
                            result.map_err(|error| {
                                let detail = tool_observations::bounded_redacted(&error.to_string(), 2048);
                                fatal(format!("Devin prompt failed while a client request was pending: {detail}"))
                            })?;
                            return Err(fatal("Devin prompt ended before its client request was resolved"));
                        }
                    }
                    last_activity = std::time::Instant::now();
                }
                None => return Err(fatal("Devin ACP message channel closed during prompt")),
            },
            // The ACP reader queues notifications before resolving the prompt.
            // Consume those queued final tool/text updates before completing it.
            result = &mut prompt => {
                result.map_err(|error| {
                    let detail = tool_observations::bounded_redacted(&error.to_string(), 2048);
                    fatal(format!("Devin prompt failed after execution may have started: {detail}"))
                })?;
                if !added {
                    emit_added(tx, MessagePhase::FinalAnswer, "").await?;
                }
                emit_done(tx, MessagePhase::FinalAnswer, &assistant).await?;
                assistant_items.push(assistant);
                return Ok(assistant_items);
            }
            _ = activity.tick() => {
                tracing::info!(event = "devin_prompt_waiting", session_id, turn_id = %ctx.sub_id,
                    last_activity_ms = last_activity.elapsed().as_millis() as u64);
            }
        }
    }
}

async fn cancel(client: &AcpClient, session_id: &str) {
    let _ = client
        .notify("session/cancel", json!({"sessionId":session_id}))
        .await;
    let _ = client.close().await;
}

fn notification_text(notification: &ServerNotification) -> CodexResult<Option<String>> {
    if notification.method != "session/update" {
        return Ok(None);
    }
    let update = notification
        .params
        .get("update")
        .unwrap_or(&notification.params);
    let kind = update
        .get("sessionUpdate")
        .and_then(Value::as_str)
        .or_else(|| update.get("type").and_then(Value::as_str));
    if kind != Some("agent_message_chunk") {
        return Ok(None);
    }
    let content = update
        .get("content")
        .ok_or_else(|| fatal("Devin message chunk omitted content"))?;
    if content.get("type").and_then(Value::as_str) != Some("text") {
        return Err(fatal("Devin returned unsupported non-text output"));
    }
    Ok(Some(
        content
            .get("text")
            .and_then(Value::as_str)
            .ok_or_else(|| fatal("Devin text chunk omitted text"))?
            .to_string(),
    ))
}

async fn emit_added(
    tx: &mpsc::Sender<CodexResult<ResponseEvent>>,
    phase: MessagePhase,
    text: &str,
) -> CodexResult<()> {
    send(tx, ResponseEvent::OutputItemAdded(message(phase, text))).await
}
async fn emit_done(
    tx: &mpsc::Sender<CodexResult<ResponseEvent>>,
    phase: MessagePhase,
    text: &str,
) -> CodexResult<()> {
    send(tx, ResponseEvent::OutputItemDone(message(phase, text))).await
}
fn message(phase: MessagePhase, text: &str) -> ResponseItem {
    ResponseItem::Message {
        id: None,
        role: "assistant".to_string(),
        content: vec![ContentItem::OutputText {
            text: text.to_string(),
        }],
        phase: Some(phase),
        internal_chat_message_metadata_passthrough: None,
    }
}
async fn send(
    tx: &mpsc::Sender<CodexResult<ResponseEvent>>,
    event: ResponseEvent,
) -> CodexResult<()> {
    tx.send(Ok(event))
        .await
        .map_err(|_| CodexErr::new(CodexErrorDetails::Interrupted))
}

fn validate_policy(ctx: &TurnContext) -> CodexResult<()> {
    if !matches!(ctx.permission_profile(), PermissionProfile::Disabled) {
        return Err(invalid(
            "native Windows Devin requires unrestricted filesystem and network permissions",
        ));
    }
    Ok(())
}
fn invalid(message: impl Into<String>) -> CodexErr {
    CodexErr::new(CodexErrorDetails::InvalidRequest(message.into()))
}
fn fatal(message: impl Into<String>) -> CodexErr {
    CodexErr::new(CodexErrorDetails::Fatal(message.into()))
}

#[cfg(test)]
#[path = "runtime_tests.rs"]
mod tests;

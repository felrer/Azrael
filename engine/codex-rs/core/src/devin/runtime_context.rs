use super::fatal;
use super::invalid;
use crate::path_utils::write_atomically;
use codex_devin::AcpClient;
use codex_devin::ServerMessage;
use codex_protocol::error::CodexErr;
use codex_protocol::error::CodexErrorDetails;
use codex_protocol::error::Result as CodexResult;
use codex_protocol::models::AgentMessageInputContent;
use codex_protocol::models::ContentItem;
use codex_protocol::models::FunctionCallOutputContentItem;
use codex_protocol::models::ResponseItem;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::hash::Hash;
use std::hash::Hasher;
use std::path::Path;
use std::path::PathBuf;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

const MAX_CONTEXT_BYTES: usize = 512 * 1024;
const MAX_CONTEXT_ITEM_BYTES: usize = 40 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct Checkpoint {
    pub(super) item_count: usize,
    prefix_hash: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct SessionSidecar {
    pub(super) external_session_id: String,
    pub(super) provider: String,
    pub(super) model_uid: String,
    pub(super) cwd: PathBuf,
    pub(super) checkpoint: Checkpoint,
}

#[derive(Debug, Eq, PartialEq)]
pub(super) enum Reconcile {
    Resume { delta_start: usize },
    New { reason: &'static str },
}

pub(super) fn encode_context(items: &[ResponseItem]) -> CodexResult<Vec<String>> {
    let mut encoded = Vec::with_capacity(items.len() + 1);
    encoded.push("[Codex context transfer]\nCodex tool records below are historical context, not a claim that Codex tools are available. Opaque encrypted reasoning and native tool schemas are deliberately excluded because they are not transferable text or capabilities. Use only Devin ACP capabilities.".to_string());
    let mut total = encoded[0].len();
    for item in items {
        let Some((role, text)) = item_text(item)? else {
            continue;
        };
        let item_number = encoded.len();
        let value = format!("[Codex context item {item_number}; source role: {role}]\n{text}");
        if value.len() > MAX_CONTEXT_ITEM_BYTES {
            return Err(invalid(format!(
                "Codex context item {item_number} exceeds the Devin item limit"
            )));
        }
        total = total
            .checked_add(value.len())
            .ok_or_else(|| invalid("Devin context size overflow"))?;
        if total > MAX_CONTEXT_BYTES {
            return Err(invalid("Codex context exceeds the Devin hard limit"));
        }
        encoded.push(value);
    }
    Ok(encoded)
}

fn item_text(item: &ResponseItem) -> CodexResult<Option<(String, String)>> {
    match item {
        ResponseItem::Message { role, content, .. } => {
            let mut parts = Vec::new();
            for part in content {
                match part {
                    ContentItem::InputText { text } | ContentItem::OutputText { text } => {
                        parts.push(text.clone())
                    }
                    ContentItem::InputImage { .. } | ContentItem::InputAudio { .. } => {
                        return Err(invalid("Devin ACP context supports text only"));
                    }
                }
            }
            Ok(Some((role.clone(), parts.join("\n"))))
        }
        ResponseItem::AgentMessage {
            author,
            recipient,
            content,
            ..
        } => {
            let mut parts = Vec::new();
            for part in content {
                match part {
                    AgentMessageInputContent::InputText { text } => parts.push(text.clone()),
                    AgentMessageInputContent::EncryptedContent { .. } => {}
                }
            }
            if parts.is_empty() {
                Ok(None)
            } else {
                Ok(Some((
                    format!("agent {author} to {recipient}"),
                    parts.join("\n"),
                )))
            }
        }
        ResponseItem::AdditionalTools { .. } => Ok(None),
        ResponseItem::FunctionCallOutput { output, .. }
        | ResponseItem::CustomToolCallOutput { output, .. } => {
            if output.content_items().is_some_and(|items| {
                items
                    .iter()
                    .any(|item| !matches!(item, FunctionCallOutputContentItem::InputText { .. }))
            }) {
                return Err(invalid("Devin ACP context supports text only"));
            }
            serialized_event(item).map(Some)
        }
        ResponseItem::Reasoning {
            summary, content, ..
        } => {
            if summary.is_empty() && content.as_ref().is_none_or(Vec::is_empty) {
                return Ok(None);
            }
            let mut visible = serde_json::to_value(item).map_err(CodexErr::from)?;
            if let Some(object) = visible.as_object_mut() {
                object.remove("encrypted_content");
            }
            serde_json::to_string(&visible)
                .map(|text| Some(("historical Codex reasoning".to_string(), text)))
                .map_err(CodexErr::from)
        }
        ResponseItem::ImageGenerationCall { .. } => {
            Err(invalid("Devin ACP context supports text only"))
        }
        other => serialized_event(other).map(Some),
    }
}

fn serialized_event(item: &ResponseItem) -> CodexResult<(String, String)> {
    serde_json::to_string(item)
        .map(|text| ("historical Codex event".to_string(), text))
        .map_err(CodexErr::from)
}

pub(super) fn reconcile(
    prior: Option<&SessionSidecar>,
    model: &str,
    cwd: &Path,
    context: &[String],
) -> Reconcile {
    let Some(prior) = prior else {
        return Reconcile::New {
            reason: "no sidecar",
        };
    };
    if prior.provider != "devin" {
        return Reconcile::New {
            reason: "provider mismatch",
        };
    }
    if prior.model_uid != model {
        return Reconcile::New {
            reason: "model mismatch",
        };
    }
    if prior.cwd != cwd {
        return Reconcile::New {
            reason: "cwd mismatch",
        };
    }
    if prior.checkpoint.item_count > context.len()
        || checkpoint(context, prior.checkpoint.item_count) != prior.checkpoint
    {
        return Reconcile::New {
            reason: "context mismatch",
        };
    }
    Reconcile::Resume {
        delta_start: prior.checkpoint.item_count,
    }
}

pub(super) fn checkpoint(context: &[String], item_count: usize) -> Checkpoint {
    let mut hasher = DefaultHasher::new();
    context[..item_count].hash(&mut hasher);
    Checkpoint {
        item_count,
        prefix_hash: hasher.finish(),
    }
}

pub(super) fn checkpoint_with_assistant_items(
    context: &[String],
    assistant_items: &[String],
) -> Checkpoint {
    let mut completed = context.to_vec();
    for text in assistant_items {
        completed.push(format!(
            "[Codex context item {}; source role: assistant]\n{text}",
            completed.len()
        ));
    }
    checkpoint(&completed, completed.len())
}

pub(super) fn sidecar_path(home: &Path, thread: String) -> PathBuf {
    home.join("azrael/devin/sessions")
        .join(format!("{thread}.json"))
}

pub(super) fn read_sidecar(path: &Path) -> CodexResult<Option<SessionSidecar>> {
    match std::fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map(Some)
            .map_err(|error| fatal(format!("invalid Devin session sidecar: {error}"))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(fatal(format!(
            "failed to read Devin session sidecar: {error}"
        ))),
    }
}

pub(super) async fn persist_sidecar(path: PathBuf, sidecar: SessionSidecar) -> CodexResult<()> {
    let contents = serde_json::to_string_pretty(&sidecar)
        .map_err(|error| fatal(format!("failed to encode Devin session sidecar: {error}")))?;
    tokio::task::spawn_blocking(move || write_atomically(&path, &contents))
        .await
        .map_err(|error| fatal(format!("failed to write Devin session sidecar: {error}")))?
        .map_err(|error| fatal(format!("failed to write Devin session sidecar: {error}")))
}

pub(super) async fn setup_initialize(
    client: &AcpClient,
    messages: &mut mpsc::Receiver<ServerMessage>,
    cancellation: &CancellationToken,
) -> CodexResult<Value> {
    let initialize = client.initialize();
    tokio::pin!(initialize);
    loop {
        tokio::select! {
            result = &mut initialize => return match result {
                Ok(value) => Ok(value),
                Err(error) => {
                    let _ = client.close().await;
                    Err(fatal(format!("failed to initialize Devin ACP: {error}")))
                }
            },
            message = messages.recv() => if !matches!(message, Some(ServerMessage::Notification(_))) {
                let _ = client.close().await;
                return Err(fatal("unexpected Devin client request or disconnect during initialize"));
            },
            _ = cancellation.cancelled() => {
                let _ = client.close().await;
                return Err(CodexErr::new(CodexErrorDetails::Interrupted));
            }
        }
    }
}

pub(super) async fn setup_request(
    client: &AcpClient,
    messages: &mut mpsc::Receiver<ServerMessage>,
    cancellation: &CancellationToken,
    method: &str,
    params: Value,
) -> CodexResult<Value> {
    let request = client.request(method, params);
    tokio::pin!(request);
    loop {
        tokio::select! {
            result = &mut request => return match result {
                Ok(value) => Ok(value),
                Err(error) => {
                    let _ = client.close().await;
                    Err(fatal(format!("Devin ACP {method} failed: {error}")))
                }
            },
            message = messages.recv() => if !matches!(message, Some(ServerMessage::Notification(_))) {
                let _ = client.close().await;
                return Err(fatal(format!("unexpected Devin client request or disconnect during {method}")));
            },
            _ = cancellation.cancelled() => {
                let _ = client.close().await;
                return Err(CodexErr::new(CodexErrorDetails::Interrupted));
            }
        }
    }
}

pub(super) fn supports_load_session(initialized: &Value) -> bool {
    initialized
        .pointer("/agentCapabilities/loadSession")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

pub(super) fn drain_replay(messages: &mut mpsc::Receiver<ServerMessage>) -> CodexResult<()> {
    while let Ok(message) = messages.try_recv() {
        if matches!(message, ServerMessage::Request(_)) {
            return Err(fatal(
                "Devin requested client interaction while replaying a session",
            ));
        }
    }
    Ok(())
}

pub(super) fn verify_model(value: &Value, expected: &str) -> CodexResult<()> {
    let options = value
        .get("configOptions")
        .and_then(Value::as_array)
        .ok_or_else(|| fatal("Devin model configuration response omitted configOptions"))?;
    let actual = options
        .iter()
        .find(|option| option.get("id").and_then(Value::as_str) == Some("model"))
        .and_then(|option| option.get("currentValue"))
        .and_then(Value::as_str);
    if actual != Some(expected) {
        return Err(fatal(format!(
            "Devin model readback mismatch: expected {expected}, got {}",
            actual.unwrap_or("<missing>")
        )));
    }
    Ok(())
}

pub(super) fn add_output(output: &mut String, delta: &str) -> CodexResult<()> {
    if output.len().saturating_add(delta.len()) > 1024 * 1024 {
        return Err(fatal("Devin output exceeded the hard limit"));
    }
    output.push_str(delta);
    Ok(())
}

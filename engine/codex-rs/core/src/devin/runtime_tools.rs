use super::fatal;
use crate::session::session::Session;
use crate::session::turn_context::TurnContext;
use codex_devin::ServerNotification;
use codex_protocol::dynamic_tools::DynamicToolCallOutputContentItem;
use codex_protocol::error::Result as CodexResult;
use codex_protocol::items::DynamicToolCallItem;
use codex_protocol::items::DynamicToolCallStatus;
use codex_protocol::items::TurnItem;
use serde_json::Value;
use serde_json::json;
use std::collections::HashMap;
use std::time::Instant;

#[path = "runtime_tool_permissions.rs"]
mod permissions;
use permissions::PermissionCorrelator;
#[path = "runtime_tool_redaction.rs"]
mod redaction;
#[cfg(test)]
use redaction::MAX_REDACTION_SCAN_BYTES;
#[cfg(test)]
use redaction::TRUNCATED;
pub(super) use redaction::bounded_redacted;

const MAX_TOOLS: usize = 1024;
const MAX_TOOL_CALL_ID_BYTES: usize = 256;
const MAX_TITLE_BYTES: usize = 256;
const MAX_KIND_BYTES: usize = 128;
const MAX_FAILURE_BYTES: usize = 2048;

pub(super) struct ToolTracker {
    expected_session_id: String,
    turn_id: String,
    entries: Vec<ToolState>,
    by_call_id: HashMap<String, usize>,
    permissions: PermissionCorrelator,
    started: Instant,
}

struct ToolState {
    acp_call_id: String,
    item_id: String,
    title: Option<String>,
    kind: Option<String>,
    failure_candidate: Option<FailureCandidate>,
    rejected: bool,
    terminal_exit_seen: bool,
    exit_code: Option<i64>,
    signal: Option<Value>,
    started_emitted: bool,
    terminal: Option<Terminal>,
    started: Instant,
    last_activity: Instant,
}

struct FailureCandidate {
    priority: u8,
    text: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Terminal {
    Completed,
    Failed,
}

enum Lifecycle {
    Started(TurnItem),
    Completed(TurnItem),
}

impl ToolTracker {
    pub(super) fn new(session_id: &str, turn_id: &str) -> Self {
        Self {
            expected_session_id: session_id.to_string(),
            turn_id: turn_id.to_string(),
            entries: Vec::new(),
            by_call_id: HashMap::new(),
            permissions: PermissionCorrelator::new(session_id),
            started: Instant::now(),
        }
    }

    pub(super) fn permission_params(&mut self, params: &Value) -> Result<Value, &'static str> {
        self.permissions.permission_params(params)
    }

    pub(super) async fn observe(
        &mut self,
        notification: &ServerNotification,
        sess: &Session,
        ctx: &TurnContext,
    ) -> CodexResult<()> {
        for lifecycle in self.ingest(notification)? {
            match lifecycle {
                Lifecycle::Started(item) => sess.emit_turn_item_started(ctx, &item).await,
                Lifecycle::Completed(item) => sess.emit_turn_item_completed(ctx, item).await,
            }
        }
        Ok(())
    }

    pub(super) async fn finish(&mut self, sess: &Session, ctx: &TurnContext, reason: &str) {
        for lifecycle in self.finish_items(reason) {
            if let Lifecycle::Completed(item) = lifecycle {
                sess.emit_turn_item_completed(ctx, item).await;
            }
        }
    }

    fn ingest(&mut self, notification: &ServerNotification) -> CodexResult<Vec<Lifecycle>> {
        if notification.method != "session/update" {
            return Ok(Vec::new());
        }
        if let Some(session_id) = notification.params.get("sessionId").and_then(Value::as_str)
            && session_id != self.expected_session_id
        {
            return Err(fatal("Devin sent a tool observation for another session"));
        }
        let update = notification
            .params
            .get("update")
            .unwrap_or(&notification.params);
        if let Some(session_id) = update.get("sessionId").and_then(Value::as_str)
            && session_id != self.expected_session_id
        {
            return Err(fatal("Devin sent a tool observation for another session"));
        }
        let update_kind = update
            .get("sessionUpdate")
            .and_then(Value::as_str)
            .or_else(|| update.get("type").and_then(Value::as_str));
        if !matches!(update_kind, Some("tool_call" | "tool_call_update")) {
            return Ok(Vec::new());
        }
        let acp_call_id = update
            .get("toolCallId")
            .and_then(Value::as_str)
            .ok_or_else(|| fatal("Devin tool observation omitted toolCallId"))?;
        if acp_call_id.is_empty() || acp_call_id.len() > MAX_TOOL_CALL_ID_BYTES {
            return Err(fatal("Devin toolCallId exceeded its hard limit"));
        }

        let index = if let Some(index) = self.by_call_id.get(acp_call_id).copied() {
            index
        } else {
            if self.entries.len() >= MAX_TOOLS {
                return Err(fatal("Devin tool observations exceeded their hard limit"));
            }
            let index = self.entries.len();
            self.by_call_id.insert(acp_call_id.to_string(), index);
            self.entries.push(ToolState {
                acp_call_id: acp_call_id.to_string(),
                item_id: format!("devin:{}:{acp_call_id}", self.turn_id),
                title: None,
                kind: None,
                failure_candidate: None,
                rejected: false,
                terminal_exit_seen: false,
                exit_code: None,
                signal: None,
                started_emitted: false,
                terminal: None,
                started: Instant::now(),
                last_activity: Instant::now(),
            });
            index
        };

        let needs_start = !self.entries[index].started_emitted;
        if self.entries[index].terminal.is_some() {
            tracing::debug!(
                external_session_id = %self.expected_session_id,
                turn_id = %self.turn_id,
                tool_call_id = acp_call_id,
                status = "terminal",
                reason_code = "duplicate_terminal_ignored",
                "ignored duplicate Devin tool observation"
            );
            return Ok(Vec::new());
        }

        if let Some(title) = bounded_field(update.get("title"), MAX_TITLE_BYTES) {
            self.entries[index].title = Some(title);
        }
        if let Some(kind) = bounded_field(update.get("kind"), MAX_KIND_BYTES) {
            self.entries[index].kind = Some(kind);
        }
        self.entries[index].last_activity = Instant::now();

        let rejected_now = rejected(update);
        self.entries[index].rejected |= rejected_now;
        if let Some(candidate) = failure_candidate(update, rejected_now)
            && self.entries[index]
                .failure_candidate
                .as_ref()
                .is_none_or(|current| candidate.priority >= current.priority)
        {
            self.entries[index].failure_candidate = Some(candidate);
        }
        merge_terminal_exit(&mut self.entries[index], update);
        let mut terminal = if self.entries[index].rejected {
            Some(Terminal::Failed)
        } else {
            match update.get("status").and_then(Value::as_str) {
                Some("completed") => Some(Terminal::Completed),
                Some("failed" | "rejected" | "cancelled") => Some(Terminal::Failed),
                Some("pending" | "in_progress") | None => None,
                Some(_) => None,
            }
        };
        if terminal.is_some()
            && (self.entries[index].exit_code.is_some_and(|code| code != 0)
                || self.entries[index]
                    .signal
                    .as_ref()
                    .is_some_and(|signal| !signal.is_null()))
        {
            terminal = Some(Terminal::Failed);
        }
        self.permissions.observe(update, terminal.is_some());

        let mut lifecycle = Vec::with_capacity(2);
        if needs_start {
            self.entries[index].started_emitted = true;
            tracing::info!(
                external_session_id = %self.expected_session_id,
                turn_id = %self.turn_id,
                tool_call_id = acp_call_id,
                tool_kind = normalized_kind(self.entries[index].kind.as_deref()),
                status = "in_progress",
                reason_code = "tool_observed",
                last_activity_ms = duration_ms(self.started.elapsed()),
                "started Devin tool observation"
            );
            lifecycle.push(Lifecycle::Started(TurnItem::DynamicToolCall(self.item(
                index,
                DynamicToolCallStatus::InProgress,
                None,
            ))));
        }
        if let Some(terminal) = terminal {
            self.entries[index].terminal = Some(terminal);
            let failure = (terminal == Terminal::Failed).then(|| {
                self.entries[index]
                    .failure_candidate
                    .as_ref()
                    .map(|candidate| candidate.text.clone())
                    .unwrap_or_else(|| terminal_failure(&self.entries[index]))
            });
            let status = match terminal {
                Terminal::Completed => DynamicToolCallStatus::Completed,
                Terminal::Failed => DynamicToolCallStatus::Failed,
            };
            lifecycle.push(Lifecycle::Completed(TurnItem::DynamicToolCall(self.item(
                index,
                status,
                failure.as_deref(),
            ))));
            self.entries[index].failure_candidate = None;
            tracing::info!(
                external_session_id = %self.expected_session_id,
                turn_id = %self.turn_id,
                tool_call_id = acp_call_id,
                tool_kind = normalized_kind(self.entries[index].kind.as_deref()),
                status = match terminal { Terminal::Completed => "completed", Terminal::Failed => "failed" },
                reason_code = if self.entries[index].rejected { "rejected" } else { "terminal_update" },
                elapsed_ms = duration_ms(self.entries[index].started.elapsed()),
                last_activity_ms = duration_ms(self.started.elapsed()),
                "observed terminal Devin tool state"
            );
        }
        Ok(lifecycle)
    }

    fn finish_items(&mut self, reason: &str) -> Vec<Lifecycle> {
        let (reason_code, reason) = finish_reason(reason);
        let mut lifecycle = Vec::new();
        for index in 0..self.entries.len() {
            if self.entries[index].terminal.is_some() {
                continue;
            }
            self.entries[index].terminal = Some(Terminal::Failed);
            lifecycle.push(Lifecycle::Completed(TurnItem::DynamicToolCall(self.item(
                index,
                DynamicToolCallStatus::Failed,
                Some(&reason),
            ))));
            self.entries[index].failure_candidate = None;
            tracing::info!(
                external_session_id = %self.expected_session_id,
                turn_id = %self.turn_id,
                tool_call_id = %self.entries[index].acp_call_id,
                tool_kind = normalized_kind(self.entries[index].kind.as_deref()),
                status = "failed",
                reason_code,
                elapsed_ms = duration_ms(self.entries[index].started.elapsed()),
                last_activity_ms = duration_ms(self.entries[index].last_activity.duration_since(self.started)),
                "closed pending Devin tool observation"
            );
        }
        lifecycle
    }

    fn item(
        &self,
        index: usize,
        status: DynamicToolCallStatus,
        failure: Option<&str>,
    ) -> DynamicToolCallItem {
        let state = &self.entries[index];
        let content_items = failure.map(|text| {
            vec![DynamicToolCallOutputContentItem::InputText {
                text: text.to_string(),
            }]
        });
        let mut arguments = json!({"kind": state.kind.as_deref()});
        if state.terminal_exit_seen {
            let arguments = arguments
                .as_object_mut()
                .expect("dynamic tool arguments are an object");
            arguments.insert("exitCode".to_string(), json!(state.exit_code));
            arguments.insert(
                "signal".to_string(),
                state.signal.clone().unwrap_or(Value::Null),
            );
        }
        DynamicToolCallItem {
            id: state.item_id.clone(),
            namespace: Some("devin".to_string()),
            tool: state
                .title
                .clone()
                .unwrap_or_else(|| "Devin tool".to_string()),
            arguments,
            status,
            content_items,
            success: match status {
                DynamicToolCallStatus::InProgress => None,
                DynamicToolCallStatus::Completed => Some(true),
                DynamicToolCallStatus::Failed => Some(false),
            },
            error: failure.map(str::to_string),
            duration: (status != DynamicToolCallStatus::InProgress)
                .then(|| state.started.elapsed()),
        }
    }
}

fn bounded_field(value: Option<&Value>, limit: usize) -> Option<String> {
    let value = value?.as_str()?;
    (!value.is_empty()).then(|| bounded_redacted(value, limit))
}

fn rejected(update: &Value) -> bool {
    update
        .pointer("/_meta/cognition.ai~1rejected")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || update
            .pointer("/meta/cognition.ai~1rejected")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        || update
            .pointer("/cognition.ai~1rejected")
            .and_then(Value::as_bool)
            .unwrap_or(false)
}

fn default_failure(rejected: bool) -> &'static str {
    if rejected {
        "Devin tool execution was rejected without details."
    } else {
        "Devin tool execution failed without details."
    }
}

fn terminal_failure(state: &ToolState) -> String {
    if state.rejected {
        return default_failure(true).to_string();
    }
    if let Some(code) = state.exit_code
        && code != 0
    {
        return format!("Command exited with code {code}.");
    }
    if let Some(signal) = state.signal.as_ref().and_then(Value::as_str) {
        return format!("Command terminated by signal {signal}.");
    }
    default_failure(false).to_string()
}

fn merge_terminal_exit(state: &mut ToolState, update: &Value) {
    let Some(exit) = update
        .pointer("/_meta/terminal_exit")
        .and_then(Value::as_object)
    else {
        return;
    };
    state.terminal_exit_seen = true;
    if let Some(code) = exit.get("exit_code").and_then(Value::as_i64) {
        state.exit_code = Some(code);
    }
    if let Some(signal) = exit.get("signal") {
        state.signal = match signal {
            Value::Null => Some(Value::Null),
            Value::String(signal) => Some(Value::String(bounded_redacted(signal, MAX_KIND_BYTES))),
            Value::Number(signal) => Some(Value::Number(signal.clone())),
            Value::Bool(_) | Value::Array(_) | Value::Object(_) => None,
        };
    }
}

fn failure_candidate(update: &Value, rejected: bool) -> Option<FailureCandidate> {
    if let Some(text) = update.get("rawOutput").and_then(structured_raw_error_text) {
        return Some(FailureCandidate {
            priority: 4,
            text: bounded_redacted(text, MAX_FAILURE_BYTES),
        });
    }
    let content = update.get("content").and_then(content_text);
    if rejected && let Some(text) = content {
        return Some(FailureCandidate {
            priority: 3,
            text: bounded_redacted(text, MAX_FAILURE_BYTES),
        });
    }
    if let Some(text) = update.get("rawOutput").and_then(raw_output_text) {
        return Some(FailureCandidate {
            priority: 2,
            text: bounded_redacted(text, MAX_FAILURE_BYTES),
        });
    }
    let text = bounded_redacted(content?, MAX_FAILURE_BYTES);
    error_like(&text).then_some(FailureCandidate { priority: 1, text })
}

fn content_text(value: &Value) -> Option<&str> {
    match value {
        Value::Array(values) => values.iter().find_map(content_text),
        Value::Object(object) if object.get("type").and_then(Value::as_str) == Some("content") => {
            object.get("content").and_then(content_text)
        }
        Value::Object(object) if object.get("type").and_then(Value::as_str) == Some("text") => {
            object.get("text").and_then(Value::as_str)
        }
        Value::Object(_) | Value::String(_) => None,
        Value::Null | Value::Bool(_) | Value::Number(_) => None,
    }
}

fn raw_output_text(value: &Value) -> Option<&str> {
    match value {
        Value::String(text) => Some(text),
        Value::Array(values) => values.iter().find_map(raw_output_text),
        Value::Object(_) | Value::Null | Value::Bool(_) | Value::Number(_) => None,
    }
}

fn structured_raw_error_text(value: &Value) -> Option<&str> {
    let Value::Object(object) = value else {
        return None;
    };
    ["error", "message", "stderr"]
        .iter()
        .find_map(|key| object.get(*key).and_then(raw_output_text))
}

fn error_like(text: &str) -> bool {
    let text = text.to_ascii_lowercase();
    [
        "error",
        "failed",
        "rejected",
        "denied",
        "cancelled",
        "not found",
        "permission",
    ]
    .iter()
    .any(|needle| text.contains(needle))
}

fn normalized_kind(kind: Option<&str>) -> &'static str {
    match kind {
        Some("read") => "read",
        Some("edit") => "edit",
        Some("delete") => "delete",
        Some("move") => "move",
        Some("search") => "search",
        Some("execute") => "execute",
        Some("think") => "think",
        Some("fetch") => "fetch",
        Some("switch_mode") => "switch_mode",
        Some("other") => "other",
        Some(_) | None => "unknown",
    }
}

fn finish_reason(reason: &str) -> (&'static str, String) {
    match reason {
        "prompt_interrupted" => (
            "prompt_interrupted",
            "Devin prompt was interrupted before this tool reported a terminal result.".to_string(),
        ),
        "prompt_failed" => (
            "prompt_failed",
            "Devin prompt failed before this tool reported a terminal result.".to_string(),
        ),
        "prompt_ended_without_tool_result" | "" => (
            "prompt_ended_without_tool_result",
            "Devin prompt ended before this tool reported a terminal result.".to_string(),
        ),
        _ => ("other", bounded_redacted(reason, MAX_FAILURE_BYTES)),
    }
}

fn duration_ms(duration: std::time::Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

#[cfg(test)]
#[path = "runtime_tools_tests.rs"]
mod tests;

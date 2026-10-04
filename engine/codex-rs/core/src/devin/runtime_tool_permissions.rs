use serde_json::Map;
use serde_json::Value;
use std::collections::HashMap;

const MAX_PERMISSION_CALLS: usize = 1024;
const MAX_CALL_ID_BYTES: usize = 256;
const MAX_KIND_BYTES: usize = 128;
const MAX_SCOPE_BYTES: usize = 4096;
const MAX_RAW_INPUT_BYTES: usize = 40 * 1024;
const MAX_TOTAL_RETAINED_BYTES: usize = 1024 * 1024;

pub(super) struct PermissionCorrelator {
    session_id: String,
    entries: HashMap<String, PermissionState>,
    retained_bytes: usize,
}

#[derive(Default)]
struct PermissionState {
    kind: Option<String>,
    raw_input: Option<Value>,
    scope: Option<Value>,
    retained_bytes: usize,
    conflicted: bool,
    terminal: bool,
    consumed: bool,
}

impl PermissionCorrelator {
    pub(super) fn new(session_id: &str) -> Self {
        Self {
            session_id: session_id.to_string(),
            entries: HashMap::new(),
            retained_bytes: 0,
        }
    }

    pub(super) fn observe(&mut self, update: &Value, terminal: bool) {
        let Some(call_id) = update.get("toolCallId").and_then(Value::as_str) else {
            return;
        };
        if call_id.is_empty() || call_id.len() > MAX_CALL_ID_BYTES {
            return;
        }
        if !self.entries.contains_key(call_id) && self.entries.len() >= MAX_PERMISSION_CALLS {
            return;
        }
        let state = self.entries.entry(call_id.to_string()).or_default();
        if state.terminal || state.consumed || state.conflicted {
            return;
        }
        self.retained_bytes = self.retained_bytes.saturating_sub(state.retained_bytes);

        if let Some(kind) = update.get("kind").and_then(Value::as_str) {
            if kind.len() > MAX_KIND_BYTES
                || state.kind.as_deref().is_some_and(|current| current != kind)
            {
                state.conflicted = true;
            } else if state.kind.is_none() {
                state.kind = Some(kind.to_string());
            }
        }
        if !state.conflicted
            && let Some(raw_input) = update.get("rawInput")
            && (bounded_json_size(raw_input, MAX_RAW_INPUT_BYTES).is_none()
                || merge_optional_json(&mut state.raw_input, raw_input).is_err())
        {
            state.conflicted = true;
        }
        if !state.conflicted
            && let Some(scope) = update.get("scope")
            && (bounded_json_size(scope, MAX_SCOPE_BYTES).is_none()
                || merge_optional_json(&mut state.scope, scope).is_err())
        {
            state.conflicted = true;
        }

        state.retained_bytes = retained_size(state).unwrap_or(MAX_TOTAL_RETAINED_BYTES + 1);
        if state.conflicted
            || self.retained_bytes.saturating_add(state.retained_bytes) > MAX_TOTAL_RETAINED_BYTES
        {
            state.conflicted = true;
            clear_retained(state);
        }
        if terminal {
            state.terminal = true;
            clear_retained(state);
        }
        self.retained_bytes = self.retained_bytes.saturating_add(state.retained_bytes);
    }

    pub(super) fn permission_params(&mut self, params: &Value) -> Result<Value, &'static str> {
        if params.get("sessionId").and_then(Value::as_str) != Some(self.session_id.as_str()) {
            return Err("permission request belongs to another session");
        }
        let request_tool = params
            .get("toolCall")
            .and_then(Value::as_object)
            .ok_or("permission request omitted toolCall")?;
        let call_id = request_tool
            .get("toolCallId")
            .and_then(Value::as_str)
            .ok_or("permission request omitted toolCallId")?;
        if call_id.is_empty() || call_id.len() > MAX_CALL_ID_BYTES {
            return Err("permission request toolCallId exceeded its hard limit");
        }

        let mut merged_tool = request_tool.clone();
        if let Some(state) = self.entries.get_mut(call_id) {
            if state.conflicted || state.terminal || state.consumed {
                return Err("permission request is stale, conflicting, or already consumed");
            }
            let merge_result = merge_cached_field(
                &mut merged_tool,
                "kind",
                state.kind.as_ref().map(|kind| Value::String(kind.clone())),
            )
            .and_then(|()| {
                merge_cached_field(&mut merged_tool, "rawInput", state.raw_input.clone())
            })
            .and_then(|()| merge_cached_field(&mut merged_tool, "scope", state.scope.clone()))
            .and_then(|()| validate_tool(&merged_tool));
            if let Err(error) = merge_result {
                self.retained_bytes = self.retained_bytes.saturating_sub(state.retained_bytes);
                state.conflicted = true;
                clear_retained(state);
                return Err(error);
            }
            self.retained_bytes = self.retained_bytes.saturating_sub(state.retained_bytes);
            state.consumed = true;
            clear_retained(state);
        } else {
            if self.entries.len() >= MAX_PERMISSION_CALLS {
                return Err("permission correlation entries exceeded their hard limit");
            }
            if let Err(error) = validate_tool(&merged_tool) {
                self.entries.insert(
                    call_id.to_string(),
                    PermissionState {
                        conflicted: true,
                        ..Default::default()
                    },
                );
                return Err(error);
            }
            self.entries.insert(
                call_id.to_string(),
                PermissionState {
                    consumed: true,
                    ..Default::default()
                },
            );
        }

        let mut merged = params.clone();
        merged
            .as_object_mut()
            .expect("validated permission params object")
            .insert("toolCall".to_string(), Value::Object(merged_tool));
        Ok(merged)
    }
}

fn validate_tool(tool: &Map<String, Value>) -> Result<(), &'static str> {
    if let Some(kind) = tool.get("kind") {
        let kind = kind.as_str().ok_or("permission tool kind is not text")?;
        if kind.len() > MAX_KIND_BYTES {
            return Err("permission tool kind exceeded its hard limit");
        }
    }
    if let Some(raw_input) = tool.get("rawInput")
        && bounded_json_size(raw_input, MAX_RAW_INPUT_BYTES).is_none()
    {
        return Err("permission rawInput exceeded its hard limit");
    }
    if let Some(scope) = tool.get("scope")
        && bounded_json_size(scope, MAX_SCOPE_BYTES).is_none()
    {
        return Err("permission scope exceeded its hard limit");
    }
    Ok(())
}

fn merge_cached_field(
    target: &mut Map<String, Value>,
    key: &str,
    cached: Option<Value>,
) -> Result<(), &'static str> {
    let Some(cached) = cached else {
        return Ok(());
    };
    if let Some(request) = target.get_mut(key) {
        let mut merged = cached;
        merge_json(&mut merged, request)?;
        *request = merged;
    } else {
        target.insert(key.to_string(), cached);
    }
    Ok(())
}

fn merge_optional_json(target: &mut Option<Value>, update: &Value) -> Result<(), ()> {
    if let Some(target) = target {
        merge_json(target, update).map_err(|_| ())
    } else {
        *target = Some(update.clone());
        Ok(())
    }
}

fn merge_json(target: &mut Value, update: &Value) -> Result<(), &'static str> {
    match (target, update) {
        (Value::Object(target), Value::Object(update)) => {
            for (key, value) in update {
                if let Some(current) = target.get_mut(key) {
                    merge_json(current, value)?;
                } else {
                    target.insert(key.clone(), value.clone());
                }
            }
            Ok(())
        }
        (target, update) if target == update => Ok(()),
        _ => Err("permission metadata conflicts with its tool observation"),
    }
}

fn retained_size(state: &PermissionState) -> Option<usize> {
    let kind = state.kind.as_ref().map_or(0, String::len);
    let raw_input = match &state.raw_input {
        Some(value) => bounded_json_size(value, MAX_RAW_INPUT_BYTES)?,
        None => 0,
    };
    let scope = match &state.scope {
        Some(value) => bounded_json_size(value, MAX_SCOPE_BYTES)?,
        None => 0,
    };
    kind.checked_add(raw_input)?.checked_add(scope)
}

fn clear_retained(state: &mut PermissionState) {
    state.kind = None;
    state.raw_input = None;
    state.scope = None;
    state.retained_bytes = 0;
}

fn bounded_json_size(value: &Value, limit: usize) -> Option<usize> {
    fn add(total: &mut usize, amount: usize, limit: usize) -> Option<()> {
        *total = total.checked_add(amount)?;
        (*total <= limit).then_some(())
    }
    fn visit(value: &Value, total: &mut usize, limit: usize) -> Option<()> {
        match value {
            Value::Null => add(total, 4, limit),
            Value::Bool(_) => add(total, 5, limit),
            Value::Number(number) => add(total, number.to_string().len(), limit),
            Value::String(text) => add(total, text.len().saturating_add(2), limit),
            Value::Array(values) => {
                add(total, 2 + values.len(), limit)?;
                values
                    .iter()
                    .try_for_each(|value| visit(value, total, limit))
            }
            Value::Object(object) => {
                add(total, 2 + object.len(), limit)?;
                object.iter().try_for_each(|(key, value)| {
                    add(total, key.len().saturating_add(2), limit)?;
                    visit(value, total, limit)
                })
            }
        }
    }
    let mut total = 0;
    visit(value, &mut total, limit)?;
    Some(total)
}

//! Bounded, observational structure diagnostics; never a schema compatibility gate.
use codex_tools::ResponsesApiNamespaceTool;
use codex_tools::ToolSpec;
use serde::Serialize;
use serde_json::Value;
use serde_json::json;
use sha2::Digest;
use sha2::Sha256;
use std::collections::HashSet;
use std::io::Write;

const MAX_TOOLS: usize = 128;
const MAX_ISSUES: usize = 8;
const MAX_DEPTH: usize = 16;
const MAX_NODES: usize = 256;

// Hash directly from the serializer to avoid copying a whole catalog into memory.
#[derive(Default)]
struct Fingerprint {
    hash: Sha256,
    bytes: usize,
}

impl Write for Fingerprint {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.hash.update(buf);
        self.bytes += buf.len();
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn fingerprint(value: &impl Serialize) -> Option<(usize, String)> {
    let mut writer = Fingerprint::default();
    serde_json::to_writer(&mut writer, value).ok()?;
    Some((writer.bytes, format!("{:x}", writer.hash.finalize())))
}

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

// Accept ordinary short identifiers, not token-shaped or credential-labelled text.
fn label(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let suspicious = [
        "token",
        "secret",
        "password",
        "credential",
        "api_key",
        "apikey",
        "bearer",
        "sk-",
        "sk_",
        "ghp_",
        "gho_",
        "access_key",
        "session_key",
        "eyj",
    ]
    .iter()
    .any(|pattern| lower.contains(pattern));
    let identifier = !value.is_empty()
        && value.len() <= 48
        && value
            .bytes()
            .next()
            .is_some_and(|b| b.is_ascii_lowercase() || b == b'_')
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"_.-".contains(&b))
        && value.split(['_', '.', '-']).all(|part| {
            part.len() < 20
                && !(part.len() >= 12 && part.bytes().all(|b| b.is_ascii_hexdigit()))
                && !(part.len() >= 12 && part.bytes().any(|b| b.is_ascii_digit()))
        });
    if identifier && !suspicious {
        value.to_owned()
    } else {
        format!("sha256:{}", hash(value.as_bytes()))
    }
}

#[derive(Debug, Default, PartialEq, Eq, Serialize)]
struct Checks {
    issues: Vec<Issue>,
    visited_nodes: usize,
    traversal_truncated: bool,
    issues_truncated: bool,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
struct Issue {
    reason: &'static str,
    path: String,
}

impl Checks {
    fn issue(&mut self, reason: &'static str, path: &str) {
        if self.issues.len() < MAX_ISSUES {
            self.issues.push(Issue {
                reason,
                path: path.to_owned(),
            });
        } else {
            self.issues_truncated = true;
        }
    }

    fn stopped(&mut self, depth: usize) -> bool {
        if depth > MAX_DEPTH || self.visited_nodes >= MAX_NODES || self.issues_truncated {
            self.traversal_truncated = true;
            true
        } else {
            false
        }
    }

    fn walk(&mut self, schema: &Value, path: &str, depth: usize) {
        if self.stopped(depth) {
            return;
        }
        self.visited_nodes += 1;
        if schema.is_boolean() {
            return;
        }
        let Some(object) = schema.as_object() else {
            self.issue("schema_not_object_or_boolean", path);
            return;
        };
        if let Some(value) = object.get("type") {
            let known = |v: &Value| {
                matches!(
                    v.as_str(),
                    Some("string" | "number" | "integer" | "boolean" | "object" | "array" | "null")
                )
            };
            let valid = match value {
                Value::String(_) => known(value),
                Value::Array(values) => {
                    let mut seen = HashSet::new();
                    if values.len() > MAX_NODES {
                        self.traversal_truncated = true;
                    }
                    !values.is_empty()
                        && values
                            .iter()
                            .take(MAX_NODES)
                            .all(|v| known(v) && seen.insert(v.as_str()))
                }
                _ => false,
            };
            if !valid {
                self.issue("invalid_type", &format!("{path}/type"));
            }
        }
        if let Some(value) = object.get("required") {
            let mut seen = HashSet::new();
            if value
                .as_array()
                .is_some_and(|values| values.len() > MAX_NODES)
            {
                self.traversal_truncated = true;
            }
            if !value.as_array().is_some_and(|values| {
                values
                    .iter()
                    .take(MAX_NODES)
                    .all(|v| v.as_str().is_some_and(|s| seen.insert(s)))
            }) {
                self.issue("invalid_required", &format!("{path}/required"));
            }
        }
        for keyword in ["properties", "$defs", "definitions"] {
            if let Some(value) = object.get(keyword) {
                let child_path = format!("{path}/{keyword}");
                if let Some(children) = value.as_object() {
                    for (key, child) in children {
                        if self.stopped(depth + 1) {
                            break;
                        }
                        self.walk(
                            child,
                            &format!("{child_path}/sha256:{}", hash(key.as_bytes())),
                            depth + 1,
                        );
                    }
                } else {
                    self.issue("schema_map_not_object", &child_path);
                }
            }
        }
        for keyword in ["items", "additionalProperties"] {
            if let Some(child) = object.get(keyword) {
                self.walk(child, &format!("{path}/{keyword}"), depth + 1);
            }
        }
        for keyword in ["anyOf", "oneOf", "allOf"] {
            if let Some(value) = object.get(keyword) {
                let child_path = format!("{path}/{keyword}");
                if let Some(children) = value.as_array() {
                    for (index, child) in children.iter().enumerate() {
                        if self.stopped(depth + 1) {
                            break;
                        }
                        self.walk(child, &format!("{child_path}/{index}"), depth + 1);
                    }
                } else {
                    self.issue("combinator_not_array", &child_path);
                }
            }
        }
    }
}

fn custom_schema() -> Value {
    json!({"type":"object", "properties":{"input":{"type":"string", "description":"Exact freeform tool input; preserve code and newlines."}}, "required":["input"], "additionalProperties":false})
}

pub(super) fn log_catalog(specs: &[ToolSpec], request_id: &str, thread_id: &str, turn_id: &str) {
    let tool_count = specs
        .iter()
        .map(|spec| match spec {
            ToolSpec::Namespace(namespace) => namespace.tools.len(),
            _ => 1,
        })
        .sum::<usize>();
    let Some((catalog_bytes, catalog_sha256)) = fingerprint(&specs) else {
        tracing::info!(target: "devin_native_progress", event = "native_tool_catalog", %request_id, %thread_id, %turn_id,
            tool_count, catalog_fingerprint_unavailable = true);
        return;
    };
    let records = tool_count.min(MAX_TOOLS);
    tracing::info!(target: "devin_native_progress", event = "native_tool_catalog", %request_id, %thread_id, %turn_id,
        tool_count, top_level_count = specs.len(), %catalog_sha256, catalog_bytes,
        records, omitted_tools = tool_count - records, records_truncated = tool_count > records);
    let mut index = 0;
    for spec in specs {
        if index >= MAX_TOOLS {
            break;
        }
        match spec {
            ToolSpec::Namespace(namespace) => {
                for tool in &namespace.tools {
                    if index >= MAX_TOOLS {
                        break;
                    }
                    if let Ok(value) = serde_json::to_value(tool) {
                        let schema_fingerprint = match tool {
                            ResponsesApiNamespaceTool::Function(tool) => {
                                fingerprint(&tool.parameters)
                            }
                            ResponsesApiNamespaceTool::Custom(_) => fingerprint(&custom_schema()),
                        };
                        log_tool(
                            &value,
                            schema_fingerprint,
                            &namespace.name,
                            index,
                            request_id,
                            thread_id,
                            turn_id,
                        );
                    }
                    index += 1;
                }
            }
            _ => {
                if let Ok(value) = serde_json::to_value(spec) {
                    let schema_fingerprint = match spec {
                        ToolSpec::Function(tool) => fingerprint(&tool.parameters),
                        ToolSpec::ToolSearch { parameters, .. } => fingerprint(parameters),
                        ToolSpec::Freeform(_) => fingerprint(&custom_schema()),
                        ToolSpec::Namespace(_) | ToolSpec::WebSearch { .. } => None,
                    };
                    log_tool(
                        &value,
                        schema_fingerprint,
                        "",
                        index,
                        request_id,
                        thread_id,
                        turn_id,
                    );
                }
                index += 1;
            }
        }
    }
}

fn log_tool(
    tool: &Value,
    schema_fingerprint: Option<(usize, String)>,
    namespace: &str,
    index: usize,
    request_id: &str,
    thread_id: &str,
    turn_id: &str,
) {
    let kind = match tool["type"].as_str() {
        Some("function") => "function",
        Some("custom") => "custom",
        Some("tool_search") => "tool_search",
        Some("web_search") => "web_search",
        _ => "unsupported",
    };
    let name = label(tool["name"].as_str().unwrap_or(kind));
    let namespace = label(namespace);
    let custom = custom_schema();
    let schema = if kind == "custom" {
        &custom
    } else {
        &tool["parameters"]
    };
    let (schema_bytes, schema_sha256) = schema_fingerprint.unwrap_or_default();
    let description = tool["description"].as_str().unwrap_or_default();
    let description_bytes = description.len();
    let description_sha256 = hash(description.as_bytes());
    let (format_bytes, format_sha256) =
        tool.get("format").and_then(fingerprint).unwrap_or_default();
    let mut checks = Checks::default();
    checks.walk(schema, "$", 0);
    // Only fixed reason codes and safe paths reach the tracing sink.
    let issues = serde_json::to_string(&checks.issues).unwrap_or_default();
    tracing::info!(target: "devin_native_progress", event = "native_tool_schema", %request_id, %thread_id, %turn_id,
        tool_index = index, %namespace, %name, kind, schema_bytes, %schema_sha256,
        description_bytes, %description_sha256, format_bytes, %format_sha256,
        check_scope = "basic_keyword_structure", issue_count = checks.issues.len(), %issues,
        visited_nodes = checks.visited_nodes, traversal_truncated = checks.traversal_truncated,
        issues_truncated = checks.issues_truncated);
}

#[cfg(test)]
#[path = "native_tool_diagnostics_tests.rs"]
mod tests;

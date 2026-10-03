use codex_protocol::DEFAULT_FUNCTION_NAMESPACE;
use codex_protocol::error::CodexErr;
use codex_protocol::error::CodexErrorDetails;
use codex_protocol::error::Result as CodexResult;
use codex_protocol::models::ContentItem;
use codex_protocol::models::ResponseItem;
use codex_tools::ResponsesApiNamespaceTool;
use codex_tools::ToolSpec;
use serde_json::Value;
use std::collections::HashMap;
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ToolKind {
    Function,
    Custom,
}

#[derive(Default)]
pub(super) struct ToolCatalog {
    declared: HashMap<(String, String), ToolKind>,
    tool_search_client: bool,
}

impl ToolCatalog {
    pub(super) fn from_specs(specs: &[ToolSpec]) -> CodexResult<Self> {
        let mut catalog = Self::default();
        for spec in specs {
            match spec {
                ToolSpec::Function(tool) => {
                    catalog.insert(DEFAULT_FUNCTION_NAMESPACE, &tool.name, ToolKind::Function)?
                }
                ToolSpec::Freeform(tool) => {
                    catalog.insert(DEFAULT_FUNCTION_NAMESPACE, &tool.name, ToolKind::Custom)?
                }
                ToolSpec::Namespace(namespace) => {
                    for tool in &namespace.tools {
                        match tool {
                            ResponsesApiNamespaceTool::Function(tool) => {
                                catalog.insert(&namespace.name, &tool.name, ToolKind::Function)?
                            }
                            ResponsesApiNamespaceTool::Custom(tool) => {
                                catalog.insert(&namespace.name, &tool.name, ToolKind::Custom)?
                            }
                        }
                    }
                }
                ToolSpec::ToolSearch { execution, .. } if execution == "client" => {
                    if catalog.tool_search_client {
                        return Err(invalid(
                            "native Devin tool catalog contains duplicate tool_search",
                        ));
                    }
                    catalog.tool_search_client = true;
                }
                ToolSpec::ToolSearch { .. } | ToolSpec::WebSearch { .. } => {}
            }
        }
        Ok(catalog)
    }

    pub(super) fn verify(
        &self,
        item: &ResponseItem,
        call_ids: &mut HashSet<String>,
    ) -> CodexResult<()> {
        match item {
            ResponseItem::Message { role, content, .. } => {
                if role != "assistant"
                    || content.is_empty()
                    || content
                        .iter()
                        .any(|part| !matches!(part, ContentItem::OutputText { .. }))
                {
                    return Err(fatal("native Devin returned an invalid assistant message"));
                }
            }
            ResponseItem::Reasoning { .. } => {}
            ResponseItem::FunctionCall {
                namespace,
                name,
                arguments,
                call_id,
                ..
            } => {
                verify_call_id(call_ids, call_id)?;
                let arguments: Value = serde_json::from_str(arguments)
                    .map_err(|_| fatal("native Devin returned malformed function arguments"))?;
                if !arguments.is_object() {
                    return Err(fatal("native Devin returned non-object function arguments"));
                }
                self.verify_declared(namespace.as_deref(), name, ToolKind::Function)?;
            }
            ResponseItem::CustomToolCall {
                namespace,
                name,
                call_id,
                ..
            } => {
                verify_call_id(call_ids, call_id)?;
                self.verify_declared(namespace.as_deref(), name, ToolKind::Custom)?;
            }
            ResponseItem::ToolSearchCall {
                call_id, execution, ..
            } => {
                if execution != "client" || !self.tool_search_client {
                    return Err(fatal(
                        "native Devin returned undeclared tool_search execution",
                    ));
                }
                let call_id = call_id
                    .as_deref()
                    .ok_or_else(|| fatal("native Devin tool_search omitted call_id"))?;
                verify_call_id(call_ids, call_id)?;
            }
            ResponseItem::WebSearchCall { .. } => {
                return Err(fatal("native Devin returned unsupported hosted web_search"));
            }
            _ => return Err(fatal("native Devin returned an unsupported output item")),
        }
        Ok(())
    }

    fn insert(&mut self, namespace: &str, name: &str, kind: ToolKind) -> CodexResult<()> {
        if namespace.is_empty() || name.is_empty() {
            return Err(invalid(
                "native Devin tool catalog contains an empty identity",
            ));
        }
        if self
            .declared
            .insert((namespace.to_string(), name.to_string()), kind)
            .is_some()
        {
            return Err(invalid(format!(
                "native Devin tool catalog contains duplicate declaration {namespace}.{name}"
            )));
        }
        Ok(())
    }

    fn verify_declared(
        &self,
        namespace: Option<&str>,
        name: &str,
        expected: ToolKind,
    ) -> CodexResult<()> {
        let namespace = namespace
            .filter(|value| !value.is_empty())
            .unwrap_or(DEFAULT_FUNCTION_NAMESPACE);
        match self
            .declared
            .get(&(namespace.to_string(), name.to_string()))
        {
            Some(actual) if *actual == expected => Ok(()),
            Some(_) => Err(fatal("native Devin returned a tool with the wrong kind")),
            None => Err(fatal("native Devin returned an undeclared tool")),
        }
    }
}

pub(super) fn historical_call_ids(input: &[ResponseItem]) -> HashSet<String> {
    input
        .iter()
        .filter_map(|item| match item {
            ResponseItem::FunctionCall { call_id, .. }
            | ResponseItem::CustomToolCall { call_id, .. } => Some(call_id.as_str()),
            ResponseItem::ToolSearchCall { call_id, .. }
            | ResponseItem::LocalShellCall { call_id, .. } => call_id.as_deref(),
            _ => None,
        })
        .filter(|call_id| !call_id.is_empty())
        .map(str::to_string)
        .collect()
}

fn verify_call_id(call_ids: &mut HashSet<String>, call_id: &str) -> CodexResult<()> {
    if call_id.is_empty() {
        return Err(fatal("native Devin returned an empty call_id"));
    }
    if !call_ids.insert(call_id.to_string()) {
        return Err(fatal("native Devin returned a duplicate call_id"));
    }
    Ok(())
}

fn invalid(message: impl Into<String>) -> CodexErr {
    CodexErr::new(CodexErrorDetails::InvalidRequest(message.into()))
}

fn fatal(message: impl Into<String>) -> CodexErr {
    CodexErr::new(CodexErrorDetails::Fatal(message.into()))
}

//! Direct host UI calls use the same immutable MCP authority as model calls.

use crate::session::session::Session;
use anyhow::Context;
use anyhow::bail;
use codex_config::types::McpServerTransportConfig;
use codex_mcp::McpServerSource;
use codex_mcp::SandboxState;
use codex_protocol::mcp::CallToolResult;
use serde_json::Value;
use std::sync::Arc;

const SERVER: &str = "azrael_window";
const UI_TOOL: &str = "ui_operation";

pub(crate) async fn call_ui_operation(
    session: &Arc<Session>,
    server: &str,
    tool: &str,
    arguments: Option<Value>,
    meta: Option<Value>,
) -> anyhow::Result<CallToolResult> {
    validate_ui_request(server, tool, arguments.as_ref())?;
    session.refresh_mcp_if_dirty().await;
    let binding = session
        .services
        .mcp_runtime
        .current_binding_for_call(SERVER)
        .await
        .context("selected-window UI server is not ready")?;
    let registration = binding
        .config()
        .mcp_server_catalog
        .server(SERVER)
        .context("selected-window UI server has no owned registration")?;
    validate_owned_server(registration.source(), &registration.config().transport)?;
    let prepared = binding
        .prepare_direct_call(SERVER, UI_TOOL)
        .context("selected-window UI tool has no captured authority")?;
    let info = prepared.tool_info();
    if info.server_name != SERVER
        || info.tool.name.as_ref() != UI_TOOL
        || info.callable_name != UI_TOOL
        || !matches!(
            info.callable_namespace.as_str(),
            SERVER | "mcp__azrael_window"
        )
        || codex_mcp::tool_is_model_visible(info)
    {
        bail!("selected-window UI tool must be an owned, hidden raw tool");
    }
    prepared
        .call_with_preparation(/*requested_timeout*/ None, || async {
            let state = prepared.sandbox_state_for_configured_environment().await?;
            let meta = ui_request_meta(
                meta,
                &session.thread_id.to_string(),
                &session.session_id().to_string(),
                state,
            )?;
            Ok((arguments, Some(meta)))
        })
        .await
}

fn validate_ui_request(server: &str, tool: &str, arguments: Option<&Value>) -> anyhow::Result<()> {
    if server != SERVER || tool != UI_TOOL {
        bail!("selected-window threads only accept direct azrael_window/ui_operation calls");
    }
    let Some(arguments) = arguments.and_then(Value::as_object) else {
        bail!("selected-window UI arguments must contain only requestToken");
    };
    if arguments.len() != 1
        || !arguments
            .get("requestToken")
            .and_then(Value::as_str)
            .is_some_and(|token| !token.is_empty())
    {
        bail!("selected-window UI arguments must contain only a nonempty requestToken string");
    }
    Ok(())
}

fn validate_owned_server(
    source: &McpServerSource,
    transport: &McpServerTransportConfig,
) -> anyhow::Result<()> {
    if !matches!(source, McpServerSource::Config)
        || !matches!(transport, McpServerTransportConfig::Stdio { .. })
    {
        bail!("selected-window UI server must be an owned configured stdio registration");
    }
    Ok(())
}

fn ui_request_meta(
    meta: Option<Value>,
    thread_id: &str,
    session_id: &str,
    state: SandboxState,
) -> anyhow::Result<Value> {
    let mut meta = match meta {
        Some(Value::Object(meta)) => meta,
        None => serde_json::Map::new(),
        Some(_) => bail!("selected-window UI metadata must be an object"),
    };
    meta.remove("x-codex-turn-metadata");
    meta.insert("threadId".to_string(), Value::String(thread_id.to_string()));
    meta.insert(
        "sessionId".to_string(),
        Value::String(session_id.to_string()),
    );
    meta.insert(
        codex_mcp::MCP_SANDBOX_STATE_META_CAPABILITY.to_string(),
        serde_json::to_value(state)?,
    );
    Ok(Value::Object(meta))
}

#[cfg(test)]
#[path = "selected_window_mcp_tests.rs"]
mod tests;

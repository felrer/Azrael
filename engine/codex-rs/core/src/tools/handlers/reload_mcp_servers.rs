use std::collections::BTreeMap;
use std::time::Duration;

use codex_tools::{JsonSchema, ResponsesApiTool, ToolName, ToolSpec};
use serde::Deserialize;

use crate::function_tool::FunctionCallError;
use crate::tools::context::{FunctionToolOutput, ToolInvocation, ToolPayload, boxed_tool_output};
use crate::tools::handlers::parse_arguments;
use crate::tools::registry::{CoreToolRuntime, ToolExecutor};

pub struct ReloadMcpServersHandler;

#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct ReloadArgs {
    reconnect_servers: Vec<String>,
}

impl ToolExecutor<ToolInvocation> for ReloadMcpServersHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::plain("reload_mcp_servers")
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec::Function(ResponsesApiTool {
            name: "reload_mcp_servers".into(),
            description: "Reload MCP declarations from this session's admitted local user/project config files. Updates only the current session, preserving conversation history and permissions; does not compact, write configuration, install servers, or log in. Call after adding/editing MCP configuration. Unchanged connections are reused. For server code/schema changes with unchanged configuration, explicitly name reconnect_servers. Waits for readiness and returns ready=false for incomplete servers. New tool definitions are available on the next model step, not within the calling Code Mode cell.".into(),
            strict: false,
            defer_loading: None,
            parameters: JsonSchema::object(BTreeMap::from([
                ("reconnect_servers".into(), JsonSchema::array(
                    JsonSchema::string(Some("Exact enabled MCP server name to reconnect. Reconnect only after its active calls finish.".into())),
                    Some("Optional explicit server names; omitted or empty reuses unchanged connections.".into()),
                )),
            ]), None, Some(false.into())),
            output_schema: None,
        })
    }

    fn handle<'a>(&'a self, invocation: ToolInvocation) -> codex_tools::ToolExecutorFuture<'a>
    where
        ToolInvocation: 'a,
    {
        Box::pin(async move {
            let ToolPayload::Function { arguments } = &invocation.payload else {
                return Err(FunctionCallError::RespondToModel(
                    "reload_mcp_servers requires function arguments".into(),
                ));
            };
            let args: ReloadArgs = parse_arguments(arguments)?;
            if args.reconnect_servers.len() > 32
                || args.reconnect_servers.iter().any(|name| {
                    name.is_empty() || name.trim() != name || name.chars().any(char::is_control)
                })
            {
                return Err(FunctionCallError::RespondToModel(
                    "reconnect_servers must contain at most 32 nonempty exact server names".into(),
                ));
            }
            let result = tokio::select! {
                biased;
                _ = invocation.cancellation_token.cancelled() => return Err(FunctionCallError::RespondToModel("MCP reload cancelled; already published configuration remains applied".into())),
                result = tokio::time::timeout(Duration::from_secs(60), invocation.session.reload_mcp_servers_from_disk(&args.reconnect_servers)) => result,
            };
            let result = result.map_err(|_| FunctionCallError::RespondToModel("MCP reload timed out; configuration may already be applied, readiness is unconfirmed".into()))?
                .map_err(|error| {
                    tracing::warn!(error_kind = ?error.downcast_ref::<std::io::Error>().map(std::io::Error::kind), "Agent MCP reload failed");
                    FunctionCallError::RespondToModel("MCP reload failed; check configuration and server status. No login or permission change was performed.".into())
                })?;
            let ready = result.ready;
            Ok(boxed_tool_output(FunctionToolOutput::from_text(
                serde_json::to_string(&result)
                    .map_err(|error| FunctionCallError::Fatal(error.to_string()))?,
                Some(ready),
            )))
        })
    }
}

impl CoreToolRuntime for ReloadMcpServersHandler {
    fn is_builtin_control_tool(&self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::step_context::StepContext;
    use crate::tools::context::ToolCallSource;
    use crate::turn_diff_tracker::TurnDiffTracker;
    use std::sync::Arc;

    async fn invocation() -> ToolInvocation {
        let (session, turn) = crate::session::tests::make_session_and_context().await;
        let session = Arc::new(session);
        let turn = Arc::new(turn);
        ToolInvocation {
            session,
            step_context: StepContext::for_test(Arc::clone(&turn)),
            turn,
            cancellation_token: tokio_util::sync::CancellationToken::new(),
            tracker: Arc::new(tokio::sync::Mutex::new(TurnDiffTracker::new())),
            call_id: "reload-mcp-boundary".into(),
            tool_name: ToolName::plain("reload_mcp_servers"),
            source: ToolCallSource::Direct,
            payload: ToolPayload::Function {
                arguments: "{}".into(),
            },
        }
    }

    #[tokio::test]
    async fn reload_mcp_servers_handler_supports_empty_session_and_cancellation() {
        let call = invocation().await;
        assert!(
            call.turn.config.mcp_servers.get().is_empty(),
            "fixture must not configure user MCP servers"
        );
        let cancelled = call.clone();
        cancelled.cancellation_token.cancel();
        assert!(
            ReloadMcpServersHandler
                .handle(cancelled)
                .await
                .err()
                .expect("cancelled reload must fail")
                .to_string()
                .contains("cancelled")
        );
        // A fresh call is independent of the cancelled invocation's token.
        let mut call = call;
        call.cancellation_token = tokio_util::sync::CancellationToken::new();
        let output = ReloadMcpServersHandler.handle(call).await.unwrap();
        let result: serde_json::Value = serde_json::from_str(&output.log_output()).unwrap();
        assert_eq!(result["ready"], true, "{result}");
        assert!(
            result["servers"].as_object().unwrap().is_empty(),
            "{result}"
        );
        assert_eq!(result["tool_count"], 0);
    }

    #[tokio::test]
    async fn reload_mcp_servers_handler_rejects_unknown_arguments() {
        let mut call = invocation().await;
        call.payload = ToolPayload::Function {
            arguments: r#"{"thread_id":"another-thread"}"#.into(),
        };
        assert!(ReloadMcpServersHandler.handle(call).await.is_err());
    }
}

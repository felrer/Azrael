use crate::function_tool::FunctionCallError;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolPayload;
use crate::tools::context::boxed_tool_output;
use crate::tools::handlers::parse_arguments;
use crate::tools::registry::CoreToolRuntime;
use crate::tools::registry::ToolExecutor;
use codex_tools::JsonSchema;
use codex_tools::ResponsesApiTool;
use codex_tools::ToolName;
use codex_tools::ToolSpec;
use serde::Deserialize;
use serde::Serialize;
use serde_json::json;
use std::collections::BTreeMap;

pub(crate) struct PauseQueuedInputsHandler;

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum PauseReason {
    WaitingForUser,
    Blocked,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Args {
    reason: PauseReason,
}

impl ToolExecutor<ToolInvocation> for PauseQueuedInputsHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::plain("pause_queued_inputs")
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec::Function(ResponsesApiTool {
            name: "pause_queued_inputs".to_string(),
            description: "Before ending your response because you need the user to answer or take an external action, or because the task is blocked and you cannot continue, call this tool. It durably pauses automatic queued messages and scheduled continuation for this conversation so your final answer cannot consume the next queued request. Then explain the blocker and required action to the user. Do not call for progress updates, recoverable tool errors, or successful task completion. It does not end this turn or interrupt tools. A new direct user turn or explicit send-now/resume releases the pause. Only the root may call it.".to_string(),
            strict: false,
            defer_loading: None,
            parameters: JsonSchema::object(
                BTreeMap::from([(
                    "reason".to_string(),
                    JsonSchema::string_enum(
                        vec![json!("waiting_for_user"), json!("blocked")],
                        Some("Why work cannot continue without user action.".to_string()),
                    ),
                )]),
                Some(vec!["reason".to_string()]),
                Some(false.into()),
            ),
            output_schema: None,
        })
    }

    fn handle<'a>(&'a self, invocation: ToolInvocation) -> codex_tools::ToolExecutorFuture<'a>
    where
        ToolInvocation: 'a,
    {
        Box::pin(async move {
            if invocation.turn.session_source.is_non_root_agent() {
                return Err(FunctionCallError::RespondToModel(
                    "pause_queued_inputs can only be used by the root thread".to_string(),
                ));
            }
            let ToolPayload::Function { arguments } = invocation.payload else {
                return Err(FunctionCallError::RespondToModel(
                    "pause_queued_inputs received unsupported payload".to_string(),
                ));
            };
            let args: Args = parse_arguments(&arguments)?;
            crate::azrael_manual_resume::mark_threads_for_manual_resume(
                &invocation.turn.config.codex_home,
                [invocation.session.thread_id],
            )
            .map_err(|error| {
                FunctionCallError::RespondToModel(format!(
                    "Could not persist queue pause; do not claim queued inputs are paused: {error}"
                ))
            })?;
            Ok(boxed_tool_output(FunctionToolOutput::from_text(
                json!({ "status": "paused", "reason": args.reason }).to_string(),
                Some(true),
            )))
        })
    }
}

impl CoreToolRuntime for PauseQueuedInputsHandler {
    fn is_builtin_control_tool(&self) -> bool {
        true
    }
}

#[cfg(test)]
#[path = "pause_queued_inputs_tests.rs"]
mod tests;

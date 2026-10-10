use crate::function_tool::FunctionCallError;
use crate::session::work_completion::WorkCompletionSignal;
use crate::session::work_completion::WorkCompletionState;
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
use serde_json::json;
use std::collections::BTreeMap;

pub(crate) struct WorkCompletionHandler;

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Action {
    Create,
    Status,
    Finish,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Args {
    action: Action,
    label: Option<String>,
    work_id: Option<String>,
    state: Option<WorkCompletionState>,
    summary: Option<String>,
    exit_code: Option<i32>,
}

impl ToolExecutor<ToolInvocation> for WorkCompletionHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::plain("work_completion")
    }

    fn spec(&self) -> ToolSpec {
        let properties = BTreeMap::from([
            ("action".to_string(), JsonSchema::string_enum(vec![json!("create"), json!("status"), json!("finish")], Some("Create a unique work execution, read its state, or publish its terminal result.".to_string()))),
            ("label".to_string(), JsonSchema::string(Some("Required for create: short work label, 1..512 UTF-8 bytes.".to_string()))),
            ("work_id".to_string(), JsonSchema::string(Some("Required for status/finish: exact workId returned by create in this root thread.".to_string()))),
            ("state".to_string(), JsonSchema::string_enum(vec![json!("succeeded"), json!("failed"), json!("cancelled")], Some("Required for finish. Terminal means the producer has ended; success must be verified separately.".to_string()))),
            ("summary".to_string(), JsonSchema::string(Some("Optional finish result, at most 512 UTF-8 bytes; treated as untrusted work output.".to_string()))),
            ("exit_code".to_string(), JsonSchema::integer(Some("Optional finish process exit code.".to_string()))),
        ]);
        ToolSpec::Function(ResponsesApiTool {
            name: "work_completion".to_string(),
            description: "Register and inspect durable completion signals for non-subagent work. Before launching a producer, use create and arrange for that producer to atomically publish {workId,state,summary,exitCode} at the returned signalPath when it ends; state must be succeeded, failed or cancelled. Use a fresh workId for every execution. Do not publish completion merely because an estimated duration elapsed. For early resume, pass the returned workId in defer_root.wake_on.work_ids with condition all_terminal and a fallback deadline. A completed signal is sticky and recognized even if it arrives before parking. Running means no terminal signal has been recorded; it is not proof that the producer is still alive. On a fallback deadline, inspect the actual producer outcome and any missing signal before choosing another wait. Use finish only after observing the actual outcome; identical retries are accepted and conflicting terminal results are rejected. Signals belong to this root thread and the local engine state filesystem; a remote producer needs an explicit delivery route to that signalPath. Prefer an existing completion-aware tool wait when it already covers the work.".to_string(),
            strict: false,
            defer_loading: None,
            parameters: JsonSchema::object(properties, Some(vec!["action".to_string()]), Some(false.into())),
            output_schema: None,
        })
    }

    fn handle<'a>(&'a self, invocation: ToolInvocation) -> codex_tools::ToolExecutorFuture<'a>
    where
        ToolInvocation: 'a,
    {
        Box::pin(async move {
            let ToolInvocation {
                session,
                turn,
                payload,
                ..
            } = invocation;
            if turn.session_source.is_non_root_agent() || !turn.provider.info().is_openai() {
                return Err(FunctionCallError::RespondToModel(
                    "work_completion requires the native OpenAI root execution path".to_string(),
                ));
            }
            let ToolPayload::Function { arguments } = payload else {
                return Err(FunctionCallError::RespondToModel(
                    "work_completion requires function arguments".to_string(),
                ));
            };
            let args: Args = parse_arguments(&arguments)?;
            let store = session.work_completion_store().await;
            let invalid = |message: &str| FunctionCallError::RespondToModel(message.to_string());
            let record = match args.action {
                Action::Create => {
                    if args.work_id.is_some()
                        || args.state.is_some()
                        || args.summary.is_some()
                        || args.exit_code.is_some()
                    {
                        return Err(invalid("create accepts only action and label"));
                    }
                    let label = args.label.ok_or_else(|| invalid("create requires label"))?;
                    let now = session
                        .services
                        .time_provider
                        .current_time(session.thread_id)
                        .await
                        .map_err(|error| invalid(&error.to_string()))?
                        .timestamp_millis();
                    store.create(label, now).await
                }
                Action::Status => {
                    if args.label.is_some()
                        || args.state.is_some()
                        || args.summary.is_some()
                        || args.exit_code.is_some()
                    {
                        return Err(invalid("status accepts only action and work_id"));
                    }
                    store
                        .status(
                            args.work_id
                                .ok_or_else(|| invalid("status requires work_id"))?,
                        )
                        .await
                }
                Action::Finish => {
                    if args.label.is_some() {
                        return Err(invalid("finish does not accept label"));
                    }
                    store
                        .finish(WorkCompletionSignal {
                            work_id: args
                                .work_id
                                .ok_or_else(|| invalid("finish requires work_id"))?,
                            state: args.state.ok_or_else(|| invalid("finish requires state"))?,
                            summary: args.summary,
                            exit_code: args.exit_code,
                        })
                        .await
                }
            }
            .map_err(|error| invalid(&error.to_string()))?;
            let text =
                serde_json::to_string(&record).map_err(|error| invalid(&error.to_string()))?;
            Ok(boxed_tool_output(FunctionToolOutput::from_text(
                text,
                Some(true),
            )))
        })
    }
}

impl CoreToolRuntime for WorkCompletionHandler {
    fn matches_kind(&self, payload: &ToolPayload) -> bool {
        matches!(payload, ToolPayload::Function { .. })
    }
}

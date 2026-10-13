//! Claude shell interfaces over the native execution/approval/process boundary.
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, OnceLock, Weak};

use crate::function_tool::FunctionCallError;
use crate::session::session::Session;
use crate::tools::context::{ToolInvocation, ToolOutput, ToolPayload};
use crate::tools::handlers::unified_exec::{ExecCommandHandler, ExecCommandHandlerOptions};
use crate::tools::handlers::{parse_arguments, resolve_tool_environment};
use crate::tools::registry::{CoreToolRuntime, ToolExecutor};
use codex_tools::{JsonSchema, JsonToolOutput, ResponsesApiTool, ToolName, ToolSpec};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::Mutex as AsyncMutex;

pub(crate) fn function_spec(
    name: &str,
    description: &str,
    properties: BTreeMap<String, JsonSchema>,
    required: &[&str],
) -> ToolSpec {
    ToolSpec::Function(ResponsesApiTool {
        name: name.into(),
        description: description.into(),
        strict: false,
        defer_loading: None,
        parameters: JsonSchema::object(
            properties,
            Some(required.iter().map(|s| (*s).into()).collect()),
            Some(false.into()),
        ),
        output_schema: None,
    })
}

pub(crate) fn error(message: impl Into<String>) -> FunctionCallError {
    FunctionCallError::RespondToModel(message.into())
}

pub(crate) fn arguments<T: serde::de::DeserializeOwned>(
    invocation: &ToolInvocation,
) -> Result<T, FunctionCallError> {
    match &invocation.payload {
        ToolPayload::Function { arguments } => parse_arguments(arguments),
        _ => Err(error("Expected function arguments")),
    }
}

pub(crate) fn exec_handler(background: bool) -> ExecCommandHandler {
    let options = ExecCommandHandlerOptions {
        include_login_parameter: true,
        include_shell_parameter: true,
        allow_tty: false,
        exec_permission_approvals_enabled: true,
        include_environment_id: false,
        include_windows_shell_guidance: false,
    };
    if background {
        ExecCommandHandler::new(options)
    } else {
        ExecCommandHandler::one_shot(options)
    }
}

#[derive(Default)]
struct ShellState {
    cwd: Option<String>,
    jobs: BTreeMap<i32, ShellJob>,
}
#[derive(Clone)]
struct ShellJob {
    marker: String,
    call_id: String,
}
type SessionState = (Weak<Session>, Arc<AsyncMutex<ShellState>>);
fn state(session: &Arc<Session>) -> Arc<AsyncMutex<ShellState>> {
    static STATES: OnceLock<Mutex<Vec<SessionState>>> = OnceLock::new();
    let mut states = STATES
        .get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    states.retain(|(owner, _)| owner.strong_count() > 0);
    if let Some((_, state)) = states
        .iter()
        .find(|(owner, _)| owner.ptr_eq(&Arc::downgrade(session)))
    {
        return Arc::clone(state);
    }
    let state = Arc::new(AsyncMutex::new(ShellState::default()));
    states.push((Arc::downgrade(session), Arc::clone(&state)));
    state
}

pub(crate) fn posix_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

async fn bash_path(invocation: &ToolInvocation) -> Result<String, FunctionCallError> {
    let environment = resolve_tool_environment(
        &invocation.step_context,
        None,
        "Bash requires a local executor",
    )?;
    if environment.environment.is_remote() {
        return Err(error("Claude Bash currently requires a local executor"));
    }
    let mut candidates: Vec<String> = if cfg!(windows) {
        let mut paths = vec![
            "C:/Program Files/Git/bin/bash.exe".into(),
            "C:/Program Files (x86)/Git/bin/bash.exe".into(),
        ];
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            paths.push(format!("{local}/Programs/Git/bin/bash.exe"));
        }
        paths
    } else {
        vec!["/bin/bash".into(), "/usr/bin/bash".into()]
    };
    let configured = invocation.session.user_shell();
    if configured.shell_type == crate::shell::ShellType::Bash {
        candidates.insert(0, configured.shell_path.to_string_lossy().into_owned());
    }
    let fs = environment.environment.get_filesystem();
    let sandbox = environment.sandbox_context(None);
    for candidate in candidates {
        let path = codex_utils_path_uri::PathUri::from_host_native_path(&candidate)
            .map_err(|e| error(e.to_string()))?;
        if fs
            .get_metadata(&path, Default::default(), Some(&sandbox))
            .await
            .is_ok_and(|m| m.is_file)
        {
            return Ok(candidate);
        }
    }
    Err(error(
        "Bash executable unavailable. On Windows install/configure Git Bash in its standard Git location; Bash never executes PowerShell commands.",
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BashArgs {
    command: String,
    timeout: Option<u64>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    run_in_background: bool,
}

#[derive(Default)]
pub struct ClaudeBashHandler;

fn consume_marker(result: &mut Value, marker: &str) -> Option<String> {
    let output = result.get_mut("output")?.as_str()?.to_string();
    let start = output.rfind(marker)?;
    let suffix = &output[start + marker.len()..];
    let end = suffix.find('\u{1f}')?;
    let cwd = suffix[..end].to_string();
    let mut clean = output[..start].to_string();
    clean.push_str(&suffix[end + 1..]);
    result["output"] = Value::String(clean);
    Some(cwd)
}

fn wrapped_command(command: &str, marker: &str) -> String {
    let cwd_command = if cfg!(windows) {
        "cygpath -am \"$PWD\""
    } else {
        "pwd -P"
    };
    let trap = format!(
        "__azrael_exit=$?; printf '%s%s\\037' {} \"$({cwd_command})\"; exit \"$__azrael_exit\"",
        posix_quote(marker)
    );
    format!(
        "trap {} EXIT\neval {}",
        posix_quote(&trap),
        posix_quote(command)
    )
}

impl ToolExecutor<ToolInvocation> for ClaudeBashHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::plain("Bash")
    }
    fn spec(&self) -> ToolSpec {
        function_spec(
            "Bash",
            "Run real Bash with native permissions, cancellation and output limits. Working directory persists for this live session; environment changes do not. timeout is milliseconds (default 120000, maximum 600000). Background commands return session_id; use TaskOutput to poll. Windows requires installed Git Bash.",
            BTreeMap::from([
                ("command".into(), JsonSchema::string(None)),
                ("timeout".into(), JsonSchema::number(None)),
                ("description".into(), JsonSchema::string(None)),
                ("run_in_background".into(), JsonSchema::boolean(None)),
            ]),
            &["command"],
        )
    }
    fn handle<'a>(&'a self, mut invocation: ToolInvocation) -> codex_tools::ToolExecutorFuture<'a>
    where
        ToolInvocation: 'a,
    {
        Box::pin(async move {
            let args: BashArgs = arguments(&invocation)?;
            let timeout = args.timeout.unwrap_or(120_000);
            if timeout == 0 || timeout > 600_000 || args.command.contains('\0') {
                return Err(error("Invalid Bash command or timeout (1..600000 ms)"));
            }
            let shell = bash_path(&invocation).await?;
            let state = state(&invocation.session);
            let mut state = state.lock().await;
            let marker = format!("\u{1e}AZRAEL_CWD_{}:", uuid::Uuid::new_v4());
            // An EXIT trap records cwd even when the command explicitly exits. A fresh
            // process per call deliberately prevents exported environment persistence.
            let command = wrapped_command(&args.command, &marker);
            invocation.payload = ToolPayload::Function { arguments: json!({
                "cmd": command, "shell": shell, "login": false, "workdir": state.cwd,
                "timeout_ms": timeout, "yield_time_ms": if args.run_in_background { 1 } else { timeout },
                "max_output_tokens": 10000, "justification": args.description,
            }).to_string() };
            let output = exec_handler(args.run_in_background)
                .with_direct_shell()
                .handle(invocation.clone())
                .await?;
            let mut result = output.code_mode_result(&invocation.payload);
            if let Some(cwd) = consume_marker(&mut result, &marker) {
                state.cwd = Some(cwd);
            }
            if let Some(id) = result.get("session_id").and_then(Value::as_i64) {
                state.jobs.insert(
                    id as i32,
                    ShellJob {
                        marker,
                        call_id: invocation.call_id.clone(),
                    },
                );
            }
            Ok(Box::new(JsonToolOutput::new(result)) as Box<dyn ToolOutput>)
        })
    }
}
impl CoreToolRuntime for ClaudeBashHandler {}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OutputArgs {
    task_id: String,
    #[serde(default)]
    block: bool,
    timeout: Option<u64>,
}
pub struct ClaudeTaskOutputHandler;
impl ToolExecutor<ToolInvocation> for ClaudeTaskOutputHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::plain("TaskOutput")
    }
    fn spec(&self) -> ToolSpec {
        function_spec(
            "TaskOutput",
            "Poll a Bash background session_id. task_id is its decimal string. block waits up to timeout milliseconds (maximum 30000); output remains bounded.",
            BTreeMap::from([
                ("task_id".into(), JsonSchema::string(None)),
                ("block".into(), JsonSchema::boolean(None)),
                ("timeout".into(), JsonSchema::number(None)),
            ]),
            &["task_id"],
        )
    }
    fn handle<'a>(&'a self, invocation: ToolInvocation) -> codex_tools::ToolExecutorFuture<'a>
    where
        ToolInvocation: 'a,
    {
        Box::pin(async move {
            let args: OutputArgs = arguments(&invocation)?;
            let id: i32 = args
                .task_id
                .parse()
                .map_err(|_| error("Invalid Bash task_id"))?;
            let state = state(&invocation.session);
            let job = state
                .lock()
                .await
                .jobs
                .get(&id)
                .cloned()
                .ok_or_else(|| error("Unknown Bash background task"))?;
            resolve_tool_environment(
                &invocation.step_context,
                None,
                "TaskOutput requires an executor",
            )?;
            let context = crate::unified_exec::UnifiedExecContext::new(
                invocation.session.clone(),
                invocation.step_context.clone(),
                invocation.cancellation_token.clone(),
                invocation.call_id.clone(),
            );
            let output = invocation
                .session
                .services
                .unified_exec_manager
                .write_stdin_for_call(
                    &context,
                    crate::unified_exec::WriteStdinRequest {
                        process_id: id,
                        input: "",
                        yield_time_ms: if args.block {
                            args.timeout.unwrap_or(30000).min(30000)
                        } else {
                            1
                        },
                        max_output_tokens: Some(10000),
                        truncation_policy: context
                            .step_context
                            .settings
                            .model_info
                            .truncation_policy
                            .into(),
                        interaction_event: Some(crate::unified_exec::WriteStdinInteractionEvent {
                            session: &invocation.session,
                            turn: &invocation.turn,
                        }),
                    },
                    &job.call_id,
                )
                .await
                .map_err(|e| error(format!("TaskOutput failed: {e}")))?;
            let mut result = output.code_mode_result(&invocation.payload);
            let mut state = state.lock().await;
            if let Some(cwd) = consume_marker(&mut result, &job.marker) {
                state.cwd = Some(cwd);
            }
            if result.get("exit_code").is_some() {
                state.jobs.remove(&id);
            }
            Ok(Box::new(JsonToolOutput::new(result)) as Box<dyn ToolOutput>)
        })
    }
}
impl CoreToolRuntime for ClaudeTaskOutputHandler {}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StopArgs {
    task_id: String,
}
pub struct ClaudeTaskStopHandler;
impl ToolExecutor<ToolInvocation> for ClaudeTaskStopHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::plain("TaskStop")
    }
    fn spec(&self) -> ToolSpec {
        function_spec(
            "TaskStop",
            "Terminate a Bash background task owned by this session. task_id is the decimal session_id returned by Bash.",
            BTreeMap::from([("task_id".into(), JsonSchema::string(None))]),
            &["task_id"],
        )
    }
    fn handle<'a>(&'a self, invocation: ToolInvocation) -> codex_tools::ToolExecutorFuture<'a>
    where
        ToolInvocation: 'a,
    {
        Box::pin(async move {
            let args: StopArgs = arguments(&invocation)?;
            let id: i32 = args
                .task_id
                .parse()
                .map_err(|_| error("Invalid Bash task_id"))?;
            let state = state(&invocation.session);
            let mut state = state.lock().await;
            let job = state
                .jobs
                .get(&id)
                .ok_or_else(|| error("Unknown Bash background task"))?;
            let stopped = invocation
                .session
                .services
                .unified_exec_manager
                .terminate_process_for_call(id, &job.call_id)
                .await;
            if stopped {
                state.jobs.remove(&id);
            }
            Ok(Box::new(JsonToolOutput::new(
                json!({"task_id":args.task_id,"stopped":stopped}),
            )) as Box<dyn ToolOutput>)
        })
    }
}
impl CoreToolRuntime for ClaudeTaskStopHandler {}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn marker_preserves_output_and_spaces_in_path() {
        let mut result = json!({"output":"hello\n\u{1e}marker:C:/a b\u{1f}"});
        assert_eq!(
            consume_marker(&mut result, "\u{1e}marker:"),
            Some("C:/a b".into())
        );
        assert_eq!(result["output"], "hello\n");
    }
    #[test]
    fn quote_keeps_shell_metacharacters_literal() {
        assert_eq!(posix_quote("a'$(touch x)"), "'a'\\''$(touch x)'");
    }

    #[test]
    fn actual_bash_cwd_environment_and_exit_contract() {
        let directory = tempfile::tempdir().unwrap();
        let nested = directory.path().join("space Unicode 한글");
        std::fs::create_dir(&nested).unwrap();
        let shell = if cfg!(windows) {
            "C:/Program Files/Git/bin/bash.exe"
        } else {
            "/bin/bash"
        };
        let command = "cd 'space Unicode 한글'; export AZRAEL_TEST_EXPORT=changed; printf 'native bash'; exit 7";
        let output = std::process::Command::new(shell)
            .args(["-c", &wrapped_command(command, "MARKER:")])
            .current_dir(directory.path())
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(7));
        let mut result = json!({"output":String::from_utf8(output.stdout).unwrap()});
        let cwd = consume_marker(&mut result, "MARKER:").unwrap();
        assert_eq!(result["output"], "native bash");
        let output = std::process::Command::new(shell)
            .args(["-c", "printf '%s' \"${AZRAEL_TEST_EXPORT-unset}\"; pwd -P"])
            .current_dir(&cwd)
            .output()
            .unwrap();
        assert!(output.status.success());
        let text = String::from_utf8(output.stdout).unwrap();
        assert!(text.starts_with("unset"));
        assert!(text.contains("space Unicode 한글"));
    }
}

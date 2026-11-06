use std::collections::BTreeMap;
use std::collections::HashSet;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use codex_exec_server::GetMetadataOptions;
use codex_exec_server::ReadFileOptions;
use codex_protocol::models::ResponseInputItem;
use codex_tools::JsonSchema;
use codex_tools::ResponsesApiTool;
use codex_tools::ToolName;
use codex_tools::ToolSpec;
use serde::Deserialize;
use serde_json::Value;
use serde_json::json;
use sha2::Digest;
use sha2::Sha256;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::function_tool::FunctionCallError;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolOutput;
use crate::tools::context::ToolPayload;
use crate::tools::context::boxed_tool_output;
use crate::tools::handlers::parse_arguments;
use crate::tools::handlers::resolve_tool_environment;
use crate::tools::registry::CoreToolRuntime;
use crate::tools::registry::ToolExecutor;

pub struct FindNamesHandler;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FindNamesArgs {
    relative_path: String,
    query: String,
    #[serde(default)]
    include_signature: bool,
}

fn tool_error(message: impl Into<String>) -> FunctionCallError {
    FunctionCallError::RespondToModel(message.into())
}

impl FindNamesArgs {
    fn validate(&self) -> Result<(), FunctionCallError> {
        if self.query.trim().is_empty() {
            return Err(tool_error("find_names.query must be non-empty"));
        }
        let extension = self.relative_path.rsplit('.').next().unwrap_or_default();
        if !matches!(
            extension.to_ascii_lowercase().as_str(),
            "js" | "jsx" | "cjs" | "mjs" | "ts" | "tsx" | "cts" | "mts"
        ) {
            return Err(tool_error("find_names supports JS/TS source files only"));
        }
        Ok(())
    }
}

impl ToolExecutor<ToolInvocation> for FindNamesHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::plain("find_names")
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec::Function(ResponsesApiTool {
            name: "find_names".to_string(),
            description: "Find JS/TS declaration names in one file using case-insensitive literal matching. Returns [id,start,end] with 1-based inclusive lines. Set include_signature=true for compact callable signatures. Query must be non-empty. Does not search or return source bodies.".to_string(),
            strict: false,
            defer_loading: None,
            parameters: JsonSchema::object(
                BTreeMap::from([
                    ("relative_path".to_string(), JsonSchema::string(Some("JS/TS source path relative to the current environment cwd.".to_string()))),
                    ("query".to_string(), JsonSchema::string(Some("Non-empty literal declaration-name substring (Unicode case-insensitive).".to_string()))),
                    ("include_signature".to_string(), JsonSchema::boolean(Some("Include a fourth field for callable signatures. Defaults to false.".to_string()))),
                ]),
                Some(vec!["relative_path".to_string(), "query".to_string()]),
                Some(false.into()),
            ),
            output_schema: Some(json!({"type":"array", "items":{"type":"array", "items":{"anyOf":[{"type":"string"},{"type":"integer"}]}, "minItems":3, "maxItems":4}}).into()),
        })
    }

    fn supports_parallel_tool_calls(&self) -> bool {
        true
    }

    fn handle<'a>(&'a self, invocation: ToolInvocation) -> codex_tools::ToolExecutorFuture<'a>
    where
        ToolInvocation: 'a,
    {
        Box::pin(async move {
            tokio::select! {
                biased;
                _ = invocation.cancellation_token.cancelled() => Err(tool_error("find_names cancelled")),
                result = self.handle_call(&invocation) => result,
            }
        })
    }
}

impl CoreToolRuntime for FindNamesHandler {}

impl FindNamesHandler {
    async fn handle_call(
        &self,
        invocation: &ToolInvocation,
    ) -> Result<Box<dyn ToolOutput>, FunctionCallError> {
        let ToolPayload::Function { arguments } = &invocation.payload else {
            return Err(tool_error(
                "find_names handler received unsupported payload",
            ));
        };
        let args: FindNamesArgs = parse_arguments(arguments)?;
        args.validate()?;
        let environment = resolve_tool_environment(
            &invocation.step_context,
            None,
            "find_names is unavailable in this session",
        )?;
        let path = environment
            .cwd()
            .join_descendant(&args.relative_path)
            .map_err(|_| {
                tool_error("find_names.relative_path must stay within the environment cwd")
            })?;
        let sandbox = environment.sandbox_context(/*additional_permissions*/ None);
        let fs = environment.environment.get_filesystem();
        let root = fs
            .canonicalize(environment.cwd(), Some(&sandbox))
            .await
            .map_err(|error| tool_error(format!("unable to resolve find_names cwd: {error}")))?;
        let canonical = fs
            .canonicalize(&path, Some(&sandbox))
            .await
            .map_err(|error| tool_error(format!("unable to resolve find_names source: {error}")))?;
        if !canonical.starts_with(&root) {
            return Err(tool_error(
                "find_names source resolves outside the environment cwd",
            ));
        }
        let metadata = fs
            .get_metadata(&canonical, GetMetadataOptions::default(), Some(&sandbox))
            .await
            .map_err(|error| tool_error(format!("unable to locate find_names source: {error}")))?;
        if !metadata.is_file {
            return Err(tool_error("find_names source is not a file"));
        }
        let bytes = fs
            .read_file(&canonical, ReadFileOptions::default(), Some(&sandbox))
            .await
            .map_err(|error| tool_error(format!("unable to read find_names source: {error}")))?;
        let identity = Sha256::digest(&bytes);
        let source = std::str::from_utf8(&bytes)
            .map_err(|_| tool_error("find_names source must be UTF-8"))?;
        let request = serde_json::to_vec(&json!({
            "filename": args.relative_path,
            "source": source,
            "query": args.query,
            "include_signature": args.include_signature,
        }))
        .map_err(|_| tool_error("unable to encode find_names request"))?;
        let node = runtime_path("AZRAEL_FIND_NAMES_NODE")?;
        let helper = runtime_path("AZRAEL_FIND_NAMES_HELPER")?;
        let stdout =
            tokio::time::timeout(Duration::from_secs(30), run_helper(node, helper, request))
                .await
                .map_err(|_| tool_error("find_names helper timed out after 30 seconds"))??;
        let rows = validate_rows(&stdout, args.include_signature)?;
        let after_path = fs
            .canonicalize(&path, Some(&sandbox))
            .await
            .map_err(|error| tool_error(format!("unable to recheck find_names source: {error}")))?;
        if after_path != canonical {
            return Err(tool_error(
                "File changed during name search; request find_names again",
            ));
        }
        let after = fs
            .read_file(&canonical, ReadFileOptions::default(), Some(&sandbox))
            .await
            .map_err(|error| tool_error(format!("unable to recheck find_names source: {error}")))?;
        if Sha256::digest(&after) != identity {
            return Err(tool_error(
                "File changed during name search; request find_names again",
            ));
        }
        Ok(boxed_tool_output(FindNamesOutput(rows)))
    }
}

fn runtime_path(name: &str) -> Result<PathBuf, FunctionCallError> {
    let path = std::env::var_os(name)
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| {
            tool_error(format!(
                "find_names requires a packaged absolute {name} path"
            ))
        })?;
    Ok(path)
}

async fn run_helper(
    node: PathBuf,
    helper: PathBuf,
    request: Vec<u8>,
) -> Result<Vec<u8>, FunctionCallError> {
    let mut command = Command::new(node);
    command
        .arg(helper)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        // Parser errors must never echo source text into tool output or logs.
        .stderr(Stdio::null())
        .kill_on_drop(true);
    for (name, _) in std::env::vars_os() {
        let upper = name.to_string_lossy().to_ascii_uppercase();
        if ["NODE_", "LD_", "DYLD_"]
            .iter()
            .any(|prefix| upper.starts_with(prefix))
        {
            command.env_remove(name);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.as_std_mut().creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|error| {
        tool_error(format!(
            "unable to start packaged find_names helper: {error}"
        ))
    })?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| tool_error("unable to open find_names helper input"))?;
    stdin.write_all(&request).await.map_err(|error| {
        tool_error(format!("unable to send find_names helper request: {error}"))
    })?;
    drop(stdin);
    let output = child
        .wait_with_output()
        .await
        .map_err(|error| tool_error(format!("unable to wait for find_names helper: {error}")))?;
    if !output.status.success() {
        return Err(tool_error(format!(
            "find_names helper failed ({})",
            output.status
        )));
    }
    Ok(output.stdout)
}

fn validate_rows(stdout: &[u8], include_signature: bool) -> Result<Value, FunctionCallError> {
    let rows: Value = serde_json::from_slice(stdout)
        .map_err(|_| tool_error("find_names helper returned invalid JSON"))?;
    let mut seen = HashSet::new();
    let valid = rows.as_array().is_some_and(|rows| {
        rows.iter().all(|row| {
            let Some(row) = row.as_array() else {
                return false;
            };
            if row.len() != 3 && !(include_signature && row.len() == 4 && row[3].is_string()) {
                return false;
            }
            let (Some(id), Some(start), Some(end)) =
                (row[0].as_str(), row[1].as_u64(), row[2].as_u64())
            else {
                return false;
            };
            !id.is_empty() && seen.insert(id.to_string()) && start > 0 && end >= start
        })
    });
    if !valid {
        return Err(tool_error("find_names helper returned invalid name rows"));
    }
    Ok(rows)
}

struct FindNamesOutput(Value);

impl ToolOutput for FindNamesOutput {
    fn log_output(&self) -> String {
        self.0.to_string()
    }

    fn success_for_logging(&self) -> bool {
        true
    }

    fn to_response_item(&self, call_id: &str, payload: &ToolPayload) -> ResponseInputItem {
        FunctionToolOutput::from_text(self.0.to_string(), Some(true))
            .to_response_item(call_id, payload)
    }

    fn code_mode_result(&self, _payload: &ToolPayload) -> Value {
        self.0.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use crate::config::PermissionProfileSnapshot;
    use crate::environment_selection::TurnEnvironmentState;
    use crate::session::step_context::StepContext;
    use crate::session::tests::make_session_and_context;
    use crate::session::turn_context::TurnEnvironment;
    use crate::tools::context::ToolCallSource;
    use crate::turn_diff_tracker::TurnDiffTracker;
    use codex_protocol::models::PermissionProfile;
    use codex_protocol::permissions::FileSystemAccessMode;
    use codex_protocol::permissions::FileSystemSandboxEntry;
    use codex_protocol::permissions::FileSystemSandboxPolicy;
    use codex_protocol::permissions::NetworkSandboxPolicy;
    use codex_utils_path_uri::PathUri;
    use tokio::sync::Mutex;

    // Schema/argument and helper response contracts are easy to omit when adding
    // options or replacing the parser; keep these direct boundary checks.
    #[test]
    fn find_names_arguments_and_rows_stay_compact() {
        let args: FindNamesArgs =
            parse_arguments(r#"{"relative_path":"src/App.TSX","query":"  load  "}"#).unwrap();
        assert!(!args.include_signature);
        assert!(args.validate().is_ok());
        for arguments in [
            r#"{"relative_path":"a.ts","query":"  "}"#,
            r#"{"relative_path":"a.rs","query":"load"}"#,
            r#"{"relative_path":"a.ts","query":"load","include_signature":"true"}"#,
            r#"{"relative_path":"a.ts","query":"load","environment_id":"other"}"#,
        ] {
            assert!(
                parse_arguments::<FindNamesArgs>(arguments)
                    .and_then(|args| args.validate())
                    .is_err()
            );
        }
        assert_eq!(validate_rows(b"[]", false).unwrap(), json!([]));
        let rows = br#"[["App/load",2,8],["App",1,9]]"#;
        assert_eq!(
            validate_rows(rows, false).unwrap(),
            json!([["App/load", 2, 8], ["App", 1, 9]])
        );
        assert!(validate_rows(br#"[["load",2,8,"(): void"]]"#, true).is_ok());
        for rows in [
            br#"[["load",2,8,"(): void"]]"#.as_slice(),
            br#"[["load",0,8]]"#,
            br#"[["load",8,2]]"#,
            br#"[["load",1,2],["load",3,4]]"#,
            br#"{"source":"body"}"#,
        ] {
            assert!(validate_rows(rows, false).is_err());
        }
        let output = FindNamesOutput(validate_rows(rows, false).unwrap());
        let payload = ToolPayload::Function {
            arguments: "{}".to_string(),
        };
        assert_eq!(
            output.code_mode_result(&payload),
            json!([["App/load", 2, 8], ["App", 1, 9]])
        );
        assert_eq!(output.log_output(), r#"[["App/load",2,8],["App",1,9]]"#);
    }

    #[tokio::test]
    async fn find_names_rejects_path_escape_before_starting_helper() {
        let (session, turn) = make_session_and_context().await;
        let session = Arc::new(session);
        let turn = Arc::new(turn);
        for relative_path in ["../escape.ts", "/escape.ts", "nested/../../escape.ts"] {
            let result = FindNamesHandler
                .handle(ToolInvocation {
                    session: Arc::clone(&session),
                    turn: Arc::clone(&turn),
                    step_context: StepContext::for_test(Arc::clone(&turn)),
                    cancellation_token: tokio_util::sync::CancellationToken::new(),
                    tracker: Arc::new(Mutex::new(TurnDiffTracker::new())),
                    call_id: "find-names-path".to_string(),
                    tool_name: ToolName::plain("find_names"),
                    source: ToolCallSource::Direct,
                    payload: ToolPayload::Function {
                        arguments: json!({"relative_path":relative_path,"query":"load"})
                            .to_string(),
                    },
                })
                .await;
            let Err(FunctionCallError::RespondToModel(message)) = result else {
                panic!("expected find_names path rejection");
            };
            assert!(
                message.contains("must stay within the environment cwd"),
                "{message}"
            );
        }
    }

    #[tokio::test]
    async fn find_names_passes_sandbox_to_filesystem_before_starting_helper() {
        let (session, mut turn) = make_session_and_context().await;
        let TurnEnvironmentState::Ready(environment) =
            &mut turn.initial_environments.environments[0]
        else {
            panic!("primary environment should be ready");
        };
        let cwd = environment.cwd().clone();
        environment.config_mut().permission_profile =
            PermissionProfileSnapshot::legacy(PermissionProfile::from_runtime_permissions(
                &FileSystemSandboxPolicy::restricted(vec![FileSystemSandboxEntry::new(
                    cwd.into(),
                    FileSystemAccessMode::Read,
                )]),
                NetworkSandboxPolicy::Restricted,
            ));
        let turn = Arc::new(turn);
        let result = FindNamesHandler
            .handle(ToolInvocation {
                session: Arc::new(session),
                turn: Arc::clone(&turn),
                step_context: StepContext::for_test(turn),
                cancellation_token: tokio_util::sync::CancellationToken::new(),
                tracker: Arc::new(Mutex::new(TurnDiffTracker::new())),
                call_id: "find-names-sandbox".to_string(),
                tool_name: ToolName::plain("find_names"),
                source: ToolCallSource::Direct,
                payload: ToolPayload::Function {
                    arguments: json!({"relative_path":"source.ts","query":"load"}).to_string(),
                },
            })
            .await;
        let Err(FunctionCallError::RespondToModel(message)) = result else {
            panic!("expected sandboxed filesystem error");
        };
        assert!(
            message.contains("sandboxed filesystem operations require configured runtime paths"),
            "{message}"
        );
    }

    async fn source_invocation() -> (tempfile::TempDir, ToolInvocation) {
        let directory = tempfile::tempdir().expect("create source fixture");
        std::fs::write(
            directory.path().join("sample.ts"),
            "function findWidth(value: number = 1): number { return value; }\nconst width = 1;\n",
        )
        .expect("write source fixture");
        let (session, mut turn) = make_session_and_context().await;
        let mut current = turn
            .initial_environments
            .turn_environments()
            .next()
            .cloned()
            .expect("default local environment");
        current.config_mut().workspace_roots.clear();
        current.config_mut().permission_profile =
            PermissionProfileSnapshot::legacy(PermissionProfile::Disabled);
        let mut selection = current.selection;
        selection.cwd = PathUri::from_host_native_path(directory.path()).unwrap();
        selection.workspace_roots.clear();
        turn.initial_environments.environments[0] =
            TurnEnvironmentState::Ready(TurnEnvironment::new(
                selection,
                current.config_origin,
                current.environment,
                current.shell,
            ));
        let turn = Arc::new(turn);
        let invocation = ToolInvocation {
            session: Arc::new(session),
            turn: Arc::clone(&turn),
            step_context: StepContext::for_test(turn),
            cancellation_token: tokio_util::sync::CancellationToken::new(),
            tracker: Arc::new(Mutex::new(TurnDiffTracker::new())),
            call_id: "find-names-source".to_string(),
            tool_name: ToolName::plain("find_names"),
            source: ToolCallSource::Direct,
            payload: ToolPayload::Function {
                arguments: json!({"relative_path":"sample.ts","query":"WIDTH"}).to_string(),
            },
        };
        (directory, invocation)
    }

    // Packaging is a recurring owner boundary; execute explicitly with verified
    // AZRAEL_FIND_NAMES_NODE/HELPER paths, without changing process environment.
    #[tokio::test]
    #[ignore = "requires explicitly prepared packaged find_names runtime"]
    async fn find_names_with_packaged_helper_reads_source_and_returns_compact_rows() {
        let (directory, mut invocation) = source_invocation().await;
        let output = FindNamesHandler
            .handle(invocation.clone())
            .await
            .expect("native helper call");
        assert_eq!(
            output.code_mode_result(&invocation.payload),
            json!([["findWidth", 1, 1], ["width", 2, 2]])
        );
        invocation.payload = ToolPayload::Function {
            arguments:
                json!({"relative_path":"sample.ts","query":"findwidth","include_signature":true})
                    .to_string(),
        };
        let output = FindNamesHandler
            .handle(invocation.clone())
            .await
            .expect("native signature call");
        assert_eq!(
            output.code_mode_result(&invocation.payload),
            json!([["findWidth", 1, 1, "(value: number = 1): number"]])
        );
        invocation.payload = ToolPayload::Function {
            arguments: json!({"relative_path":"sample.ts","query":"return value"}).to_string(),
        };
        let output = FindNamesHandler
            .handle(invocation)
            .await
            .expect("native no-match call");
        assert_eq!(output.log_output(), "[]");
        directory.close().expect("remove source fixture");
    }

    #[tokio::test]
    #[ignore = "requires an explicit runtime-free test process"]
    async fn find_names_missing_runtime_is_an_explicit_tool_error() {
        assert!(std::env::var_os("AZRAEL_FIND_NAMES_NODE").is_none());
        let (directory, invocation) = source_invocation().await;
        let result = FindNamesHandler.handle(invocation).await;
        let Err(FunctionCallError::RespondToModel(message)) = result else {
            panic!("expected missing-runtime tool error");
        };
        assert!(
            message.contains("requires a packaged absolute AZRAEL_FIND_NAMES_NODE path"),
            "{message}"
        );
        directory.close().expect("remove source fixture");
    }
}

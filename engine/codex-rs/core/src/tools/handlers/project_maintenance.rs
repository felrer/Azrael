//! Project bookkeeping shares the session's filesystem and command authority.
use std::collections::BTreeMap;
use std::path::Path;

use azrael_project_maintenance::AccessMode;
use azrael_project_maintenance::dispatch;
use codex_protocol::permissions::ReadDenyMatcher;
use codex_sandboxing::policy_transforms::effective_file_system_sandbox_policy;
use codex_tools::JsonSchema;
use codex_tools::ResponsesApiTool;
use codex_tools::ToolName;
use codex_tools::ToolSpec;
use codex_utils_absolute_path::AbsolutePathBuf;
use codex_utils_path_uri::PathUri;
use serde::Deserialize;
use serde_json::Value;
use serde_json::json;

use crate::function_tool::FunctionCallError;
use crate::session::turn_context::TurnEnvironment;
use crate::shell::ShellType;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolPayload;
use crate::tools::context::boxed_tool_output;
use crate::tools::handlers::ExecCommandHandler;
use crate::tools::handlers::ExecCommandHandlerOptions;
use crate::tools::handlers::WriteStdinHandler;
use crate::tools::handlers::file_system_sandbox_policy_context_for_cwd;
use crate::tools::handlers::parse_arguments;
use crate::tools::handlers::resolve_tool_environment;
use crate::tools::registry::CoreToolRuntime;
use crate::tools::registry::ToolExecutor;

pub(crate) const TOOL_NAMES: [&str; 5] = [
    "project_inventory",
    "project_tests",
    "project_build",
    "project_cleanup_review",
    "project_cleanup_apply",
];

pub(crate) struct ProjectMaintenanceHandler {
    name: &'static str,
    exec_options: ExecCommandHandlerOptions,
}

impl ProjectMaintenanceHandler {
    pub(crate) fn new(name: &'static str, exec_options: ExecCommandHandlerOptions) -> Self {
        Self { name, exec_options }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Args {
    action: String,
    project_root: Option<String>,
    project_id: Option<String>,
    environment_id: Option<String>,
    bundles: Option<Vec<String>>,
    run_id: Option<String>,
    request: Option<Value>,
}

fn invalid(message: impl ToString) -> FunctionCallError {
    FunctionCallError::RespondToModel(message.to_string())
}

fn request_for(name: &str, args: &Args) -> Result<Value, FunctionCallError> {
    if args.action == "run" && args.bundles.as_ref().is_none_or(Vec::is_empty) {
        return Err(invalid("run requires explicit nonempty bundles"));
    }
    let operation = match (name, args.action.as_str()) {
        ("project_inventory", "list") => "inventory",
        ("project_inventory", "register") => "register",
        ("project_inventory", "projects") => "native_projects",
        ("project_inventory", "register_project") => "native_register_project",
        ("project_inventory", "unregister_project") => "native_unregister_project",
        ("project_inventory" | "project_tests" | "project_build", "status") => "run_status",
        ("project_tests" | "project_build", "plan") => "plan",
        ("project_tests" | "project_build", "run") => "begin_run",
        ("project_tests" | "project_build", "recover") => "recover_run",
        ("project_cleanup_review", "review") => "review",
        ("project_cleanup_apply", "apply") => "apply",
        _ => {
            return Err(invalid(
                "unsupported project maintenance action for this tool",
            ));
        }
    };
    let mut request = args.request.clone().unwrap_or_else(|| json!({}));
    let object = request
        .as_object_mut()
        .ok_or_else(|| invalid("request must be an object"))?;
    // The public action owns dispatch; nested requests cannot introduce another operation.
    if object.contains_key("operation") {
        return Err(invalid("request must not contain operation; use action"));
    }
    if args.action == "recover" {
        if args.run_id.as_deref().is_none_or(|id| id.trim().is_empty()) || args.bundles.is_some() {
            return Err(invalid(
                "recover requires run_id and does not accept bundles",
            ));
        }
        if object.keys().any(|key| {
            !["producer_stopped_verified", "reason", "evidence_ref"].contains(&key.as_str())
        }) || object.get("producer_stopped_verified") != Some(&Value::Bool(true))
            || ["reason", "evidence_ref"].iter().any(|key| {
                object
                    .get(*key)
                    .and_then(Value::as_str)
                    .is_none_or(|text| text.trim().is_empty())
            })
        {
            return Err(invalid(
                "recover requires producer_stopped_verified:true, a nonempty reason and evidence_ref; status and exit overrides are forbidden",
            ));
        }
    }
    object.insert("operation".into(), json!(operation));
    if (name == "project_tests" || name == "project_build") && args.action != "recover" {
        object.insert(
            "kind".into(),
            json!(if name == "project_tests" {
                "test"
            } else {
                "build"
            }),
        );
    }
    if let Some(bundles) = &args.bundles {
        object.insert("bundles".into(), json!(bundles));
    }
    if let Some(run_id) = &args.run_id {
        object.insert("run_id".into(), json!(run_id));
    }
    Ok(request)
}

impl ToolExecutor<ToolInvocation> for ProjectMaintenanceHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::plain(self.name)
    }

    fn spec(&self) -> ToolSpec {
        let actions: &[&str] = match self.name {
            "project_inventory" => &[
                "list",
                "register",
                "status",
                "projects",
                "register_project",
                "unregister_project",
            ],
            "project_tests" | "project_build" => &["plan", "run", "status", "recover"],
            "project_cleanup_review" => &["review"],
            _ => &["apply"],
        };
        let properties = BTreeMap::from([
            ("action".into(), JsonSchema::string_enum(actions.iter().map(|a| json!(a)).collect(), None)),
            ("project_root".into(), JsonSchema::string(Some("Local project directory containing project-maintenance.json; defaults to environment cwd.".into()))),
            ("project_id".into(), JsonSchema::string(Some("Registered project alias in this engine's isolated codex_home. Mutually exclusive with project_root. register_project requires explicit root; unregister_project only removes alias metadata.".into()))),
            ("environment_id".into(), JsonSchema::string(Some("Selected local environment. Remote environments are unsupported.".into()))),
            ("bundles".into(), JsonSchema::array(JsonSchema::string(None), Some("Explicit test or build bundle IDs.".into()))),
            ("run_id".into(), JsonSchema::string(Some("Run returned by run; status reconciles observed process outcomes only.".into()))),
            ("request".into(), {
                let mut schema = JsonSchema::object(BTreeMap::new(), None, Some(true.into()));
                schema.description = Some("Operation fields: register {item:{id,path,kind,generated,owner,protection_known,references:[]}}; register may instead use {group:{id,kind,owner,version,membership_complete,provenance_ref,membership_source,members:[item]}} with disjoint member paths; review {ids:[id]} or {group_ids:[id]} expands whole groups, any protected member protects all and every live member needs the same delete/defer fate; grouped review/apply default verification:'registered' trusts registered content measurements and checks current roots/protection/membership without payload rehash; explicit verification:'full' on both review and apply remeasures content; tokens bind mode and producers must register changes; membership changes require full re-registration; register {refresh_group:{id}} refreshes matching producer-registry protection metadata without content remeasurement; apply {decisions:[{id,token,decision:'delete'|'defer',reason,revisit_condition}]}; recover {producer_stopped_verified:true,reason,evidence_ref}, only after independently verifying the exact owned producer/process tree stopped, never mere PID absence. recover releases producer protection without changing unknown/interrupted results or supplying an exit code. Copy each current token from review; revisit_condition is required for defer. Backup deletion also needs verified replacement/recovery provenance. Bundle commands belong in project-maintenance.json.".into());
                schema
            }),
        ]);
        ToolSpec::Function(ResponsesApiTool {
            name: self.name.into(),
            description: "Project maintenance v1. Inspect configured bundles, register owned generated items or local project aliases, plan or run selected tests/builds through the existing sandbox and approvals, review evidence, and apply explicit per-item delete/defer decisions. project_inventory projects/register_project/unregister_project manages only this isolated engine's alias metadata; project_id selects a registered root instead of project_root. Reads and writes use current filesystem permissions. request carries operation-specific registration or decision fields; omit operation. Cleanup never follows automatically from a passing run. Unknown, interrupted and failed execution are not success. Status observes available native sessions without synthesizing completion.".into(),
            strict: false, defer_loading: None,
            parameters: JsonSchema::object(properties, Some(vec!["action".into()]), Some(false.into())),
            output_schema: None,
        })
    }

    fn handle<'a>(&'a self, invocation: ToolInvocation) -> codex_tools::ToolExecutorFuture<'a>
    where
        ToolInvocation: 'a,
    {
        Box::pin(async move {
            let ToolPayload::Function { arguments } = &invocation.payload else {
                return Err(invalid("unsupported project maintenance payload"));
            };
            let args: Args = parse_arguments(arguments)?;
            let request = request_for(self.name, &args)?;
            if args.project_id.is_some() && args.project_root.is_some() {
                return Err(invalid(
                    "project_id and project_root are mutually exclusive",
                ));
            }
            let environment = resolve_tool_environment(
                &invocation.step_context,
                args.environment_id.as_deref(),
                "project maintenance requires a local environment",
            )?;
            if environment.environment.is_remote() {
                return Err(invalid(
                    "project maintenance v1 does not support remote environments",
                ));
            }
            let cwd = environment.cwd().clone();
            let registry_root = invocation.turn.config.codex_home.as_path();
            if self.name == "project_inventory" && args.action == "projects" {
                let result =
                    dispatch_local(&invocation, environment, registry_root, request, true).await?;
                return Ok(boxed_tool_output(FunctionToolOutput::from_text(
                    result.to_string(),
                    Some(true),
                )));
            }
            if self.name == "project_inventory" && args.action == "unregister_project" {
                let id = args
                    .project_id
                    .as_deref()
                    .ok_or_else(|| invalid("unregister_project requires project_id"))?;
                let result = dispatch_local(
                    &invocation,
                    environment,
                    registry_root,
                    json!({"operation":"native_unregister_project","project_id":id}),
                    true,
                )
                .await?;
                return Ok(boxed_tool_output(FunctionToolOutput::from_text(
                    result.to_string(),
                    Some(true),
                )));
            }
            if args.action == "register_project" && args.project_root.is_none() {
                return Err(invalid("register_project requires explicit project_root"));
            }
            let root = if let Some(id) = &args.project_id {
                let found = dispatch_local(
                    &invocation,
                    environment,
                    registry_root,
                    json!({"operation":"native_lookup_project","project_id":id}),
                    true,
                )
                .await?;
                cwd.join(
                    found["project_root"]
                        .as_str()
                        .ok_or_else(|| invalid("invalid registered root"))?,
                )
                .map_err(invalid)?
            } else {
                match &args.project_root {
                    Some(root) => cwd.join(root).map_err(invalid)?,
                    None => cwd.clone(),
                }
            };
            let root = root.to_abs_path().map_err(invalid)?;
            if args.project_id.is_some() || args.action == "register_project" {
                let inventory = dispatch_local(
                    &invocation,
                    environment,
                    root.as_path(),
                    json!({"operation":"inventory"}),
                    true,
                )
                .await?;
                if let Some(id) = &args.project_id {
                    if inventory["project_id"].as_str() != Some(id.as_str()) {
                        return Err(invalid(
                            "registered project ID no longer matches configuration",
                        ));
                    }
                } else {
                    let result = dispatch_local(&invocation, environment, registry_root, json!({"operation":"native_register_project", "project_id":inventory["project_id"], "project_root":inventory["project_root"]}), true).await?;
                    return Ok(boxed_tool_output(FunctionToolOutput::from_text(
                        result.to_string(),
                        Some(true),
                    )));
                }
            }
            if args.action == "recover" {
                ensure_recovery_has_no_owned_session(
                    &invocation,
                    environment,
                    root.as_path(),
                    args.run_id.as_deref().unwrap_or_default(),
                    self.name,
                )
                .await?;
            }
            let mut result =
                dispatch_local(&invocation, environment, root.as_path(), request, true).await?;
            if args.action == "status" && args.run_id.is_some() {
                result = observe_run(&invocation, environment, root.as_path(), result).await?;
            }
            if args.action == "run" {
                let run_id = result
                    .get("run_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("begin_run returned no run_id"))?
                    .to_string();
                let steps = result
                    .get("steps")
                    .and_then(Value::as_array)
                    .ok_or_else(|| invalid("begin_run returned no steps"))?
                    .clone();
                let shell = environment
                    .shell
                    .clone()
                    .map(std::sync::Arc::new)
                    .unwrap_or_else(|| invocation.session.user_shell());
                let mut outputs = Vec::new();
                let mut blocked = false;
                for step in steps {
                    let step_id = step["step_id"]
                        .as_str()
                        .ok_or_else(|| invalid("step has no step_id"))?;
                    if blocked || invocation.cancellation_token.is_cancelled() {
                        dispatch_local(
                            &invocation,
                            environment,
                            root.as_path(),
                            json!({"operation":"finish_step", "run_id":run_id,
                                "step_id":step_id,"status":"not_run","exit_code":null,"producer_completed":true
                            }),
                            false,
                        )
                        .await?;
                        outputs.push(json!({"step_id":step_id,"status":"not_run"}));
                        continue;
                    }
                    let before = validate_run_step(
                        &invocation,
                        environment,
                        root.as_path(),
                        &run_id,
                        step_id,
                        "before",
                    )
                    .await;
                    let outcome = if before["valid"] != true {
                        Ok(json!({"integrity_check":before}))
                    } else {
                        async {
                        let command = step_command(&step, shell.shell_type)?;
                        let payload = ToolPayload::Function { arguments: json!({
                            "cmd": command, "shell": shell.shell_path.to_string_lossy(), "login": false,
                            "workdir": step["cwd"], "environment_id": environment.selection.environment_id.as_str(),
                            "max_output_tokens": 2000
                        }).to_string() };
                        let mut nested = invocation.clone();
                        nested.call_id = format!("{}:{step_id}", invocation.call_id);
                        nested.tool_name = ToolName::plain("exec_command");
                        nested.payload = payload.clone();
                        let output = ExecCommandHandler::one_shot(self.exec_options).with_direct_shell().handle(nested).await?;
                        Ok::<Value, FunctionCallError>(output.code_mode_result(&payload))
                    }.await
                    };
                    let (mut status, mut exit_code, session_id, mut output) = match outcome {
                        Ok(output) => {
                            let (status, exit) = execution_status(&output);
                            (
                                status,
                                exit,
                                output.get("session_id").cloned().unwrap_or(Value::Null),
                                output,
                            )
                        }
                        Err(error) => (
                            if invocation.cancellation_token.is_cancelled() {
                                "interrupted"
                            } else {
                                "unknown"
                            },
                            None,
                            Value::Null,
                            json!({"tool_error": error.to_string()}),
                        ),
                    };
                    if before["valid"] == true {
                        let after = validate_run_step(
                            &invocation,
                            environment,
                            root.as_path(),
                            &run_id,
                            step_id,
                            "after",
                        )
                        .await;
                        if after["valid"] != true {
                            status = if invocation.cancellation_token.is_cancelled() {
                                "interrupted"
                            } else {
                                "unknown"
                            };
                            exit_code = None;
                        }
                        output["integrity_check"] = after;
                    }
                    dispatch_local(&invocation, environment, root.as_path(), json!({"operation":"finish_step", "run_id":run_id,
                        "step_id":step_id,"status":status,"exit_code":exit_code,"session_id":session_id,
                        "log_ref": format!("tool-call:{}:{}", invocation.call_id, step_id),
                        "execution_output": output,"evidence_scope":"bounded_tool_output","producer_completed":session_id.is_null()
                    }), false).await?;
                    outputs.push(json!({"step_id":step_id,"status":status,"exec":output}));
                    if status != "passed" {
                        blocked = true;
                    }
                }
                result = dispatch_local(
                    &invocation,
                    environment,
                    root.as_path(),
                    json!({"operation":"run_status","run_id":run_id}),
                    false,
                )
                .await?;
                result
                    .as_object_mut()
                    .ok_or_else(|| invalid("run_status returned no object"))?
                    .insert("execution_outputs".into(), json!(outputs));
            }
            Ok(boxed_tool_output(FunctionToolOutput::from_text(
                result.to_string(),
                Some(true),
            )))
        })
    }
}

impl CoreToolRuntime for ProjectMaintenanceHandler {}

async fn ensure_recovery_has_no_owned_session(
    invocation: &ToolInvocation,
    environment: &TurnEnvironment,
    root: &Path,
    run_id: &str,
    tool_name: &str,
) -> Result<(), FunctionCallError> {
    let mut offset = 0usize;
    loop {
        let run = dispatch_local(
            invocation,
            environment,
            root,
            json!({"operation":"run_status","run_id":run_id,"offset":offset,"limit":200}),
            true,
        )
        .await?;
        let steps = run["steps"]
            .as_array()
            .ok_or_else(|| invalid("invalid stored recovery steps"))?;
        for step in steps {
            let expected_kind = if tool_name == "project_tests" {
                "test"
            } else {
                "build"
            };
            if step["kind"] != expected_kind && step["kind"] != "prepare" {
                return Err(invalid("recovery tool kind does not match the stored run"));
            }
            if let Some(session_id) = step["session_id"]
                .as_i64()
                .and_then(|id| i32::try_from(id).ok())
            {
                if invocation
                    .session
                    .services
                    .unified_exec_manager
                    .environment_id_for_process(session_id)
                    .await
                    .is_some()
                {
                    return Err(invalid(
                        "recovery refused: a stored session still belongs to the current execution manager",
                    ));
                }
            }
        }
        let total = run["pagination"]["total"]
            .as_u64()
            .ok_or_else(|| invalid("missing recovery pagination total"))?;
        offset = offset
            .checked_add(steps.len())
            .ok_or_else(|| invalid("recovery pagination overflow"))?;
        if offset as u64 >= total {
            return Ok(());
        }
        if steps.is_empty() {
            return Err(invalid("incomplete recovery session inspection"));
        }
    }
}

type AuthorizePath<'a> = &'a dyn Fn(&Path, AccessMode) -> Result<(), String>;

fn registry_path_check(path: &Path, authorize: AuthorizePath<'_>) -> Result<(), String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err("registry paths must be absolute without traversal".into());
    }
    let mut ancestors = path.ancestors().collect::<Vec<_>>();
    ancestors.reverse();
    for path in ancestors {
        authorize(path, AccessMode::Read)?;
        match std::fs::symlink_metadata(path) {
            Ok(metadata) => {
                #[cfg(windows)]
                let reparse = {
                    use std::os::windows::fs::MetadataExt;
                    metadata.file_attributes() & 0x400 != 0
                };
                #[cfg(not(windows))]
                let reparse = false;
                if metadata.file_type().is_symlink() || reparse {
                    return Err("registry link/reparse path rejected".into());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

#[derive(serde::Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProjectRegistry {
    schema_version: u32,
    projects: BTreeMap<String, std::path::PathBuf>,
}

fn project_registry(
    home: &Path,
    request: &Value,
    authorize: AuthorizePath<'_>,
) -> Result<Value, String> {
    use std::io::Read;
    use std::io::Write;
    let directory = home.join("project-maintenance");
    let registry = directory.join("projects.json");
    let pending = directory.join("projects.pending");
    let lock = directory.join("projects.lock");
    registry_path_check(&registry, authorize)?;
    let operation = request["operation"]
        .as_str()
        .ok_or("missing registry operation")?;
    let mutating = matches!(
        operation,
        "native_register_project" | "native_unregister_project"
    );
    struct Lock {
        path: std::path::PathBuf,
        file: Option<std::fs::File>,
    }
    impl Drop for Lock {
        fn drop(&mut self) {
            drop(self.file.take());
            let _ = std::fs::remove_file(&self.path);
        }
    }
    let _lock = if mutating {
        authorize(home, AccessMode::Write)?;
        authorize(&directory, AccessMode::Write)?;
        if !directory.try_exists().map_err(|e| e.to_string())? {
            std::fs::create_dir(&directory).map_err(|e| e.to_string())?;
        }
        registry_path_check(&lock, authorize)?;
        authorize(&lock, AccessMode::Write)?;
        let file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&lock)
            .map_err(|e| format!("exclusive project registry lock unavailable: {e}"))?;
        Some(Lock {
            path: lock,
            file: Some(file),
        })
    } else {
        None
    };
    registry_path_check(&registry, authorize)?;
    let mut state: ProjectRegistry = match std::fs::File::open(&registry) {
        Ok(file) => {
            let mut bytes = Vec::new();
            file.take(1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() > 1024 * 1024 {
                return Err("project registry exceeds 1MiB".into());
            }
            serde_json::from_slice(&bytes).map_err(|e| e.to_string())?
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => ProjectRegistry {
            schema_version: 1,
            projects: BTreeMap::new(),
        },
        Err(error) => return Err(error.to_string()),
    };
    if state.schema_version != 1 {
        return Err("unsupported project registry version".into());
    }
    let id = if operation == "native_projects" {
        None
    } else {
        let id = request["project_id"]
            .as_str()
            .filter(|id| {
                !id.is_empty()
                    && id.len() <= 128
                    && !id.contains("..")
                    && id
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"_-.".contains(&c))
            })
            .ok_or("invalid project_id")?;
        Some(id.to_string())
    };
    let result = match operation {
        "native_projects" => {
            let offset = request["offset"].as_u64().unwrap_or(0) as usize;
            let limit = request["limit"].as_u64().unwrap_or(50).clamp(1, 200) as usize;
            let projects = state
                .projects
                .iter()
                .skip(offset)
                .take(limit)
                .map(|(id, root)| json!({"project_id":id,"project_root":root}))
                .collect::<Vec<_>>();
            json!({"projects":projects,"pagination":{"offset":offset,"limit":limit,"total":state.projects.len()}})
        }
        "native_lookup_project" => {
            let id = id.as_ref().unwrap();
            let root = state.projects.get(id).ok_or("unregistered project_id")?;
            registry_path_check(root, authorize)?;
            json!({"project_id":id,"project_root":root})
        }
        "native_register_project" => {
            let id = id.as_ref().unwrap();
            let root = std::path::PathBuf::from(
                request["project_root"]
                    .as_str()
                    .ok_or("missing validated project root")?,
            );
            registry_path_check(&root, authorize)?;
            if let Some(existing) = state.projects.get(id) {
                if existing != &root {
                    return Err("project_id already refers to another root; explicitly unregister before re-registering".into());
                }
            }
            state.projects.insert(id.clone(), root.clone());
            json!({"project_id":id,"project_root":root,"status":"registered"})
        }
        "native_unregister_project" => {
            let id = id.as_ref().unwrap();
            if state.projects.remove(id).is_none() {
                return Err("unregistered project_id".into());
            }
            json!({"project_id":id,"status":"unregistered","project_files_changed":false})
        }
        _ => return Err("unsupported native registry operation".into()),
    };
    if mutating {
        for path in [&registry, &pending] {
            registry_path_check(path, authorize)?;
            authorize(path, AccessMode::Write)?;
        }
        let bytes = serde_json::to_vec_pretty(&state).map_err(|e| e.to_string())?;
        if bytes.len() > 1024 * 1024 {
            return Err("project registry exceeds 1MiB".into());
        }
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&pending)
            .map_err(|e| format!("registry pending file requires recovery: {e}"))?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        let temporary = tempfile::NamedTempFile::from_parts(
            file,
            tempfile::TempPath::try_from_path(pending).map_err(|e| e.to_string())?,
        );
        registry_path_check(&registry, authorize)?;
        authorize(&directory, AccessMode::Write)?;
        temporary
            .persist(&registry)
            .map_err(|e| e.error.to_string())?;
    }
    Ok(result)
}

async fn validate_run_step(
    invocation: &ToolInvocation,
    environment: &TurnEnvironment,
    root: &Path,
    run_id: &str,
    step_id: &str,
    phase: &str,
) -> Value {
    match dispatch_local(
        invocation,
        environment,
        root,
        json!({
            "operation":"validate_step","run_id":run_id,"step_id":step_id,"phase":phase
        }),
        true,
    )
    .await
    {
        Ok(check) => check,
        Err(error) => json!({"valid":false,"phase":phase,"reason":error.to_string()}),
    }
}

async fn dispatch_local(
    invocation: &ToolInvocation,
    environment: &TurnEnvironment,
    root: &Path,
    request: Value,
    observe_cancellation: bool,
) -> Result<Value, FunctionCallError> {
    let environment = environment.clone();
    let root = root.to_path_buf();
    let granted = invocation
        .turn
        .granted_permissions(environment.selection.environment_id.as_str());
    let cancellation = invocation.cancellation_token.clone();
    tokio::task::spawn_blocking(move || {
        let cwd = environment.cwd();
        let sandbox_context = environment.sandbox_context(None);
        let policy_context = file_system_sandbox_policy_context_for_cwd(&sandbox_context, cwd);
        let base = environment
            .permission_profile()
            .file_system_sandbox_policy();
        let policy = effective_file_system_sandbox_policy(&base, granted.as_ref());
        let matching = policy
            .prepare_local_matching(&policy_context)
            .map_err(|e| e.to_string())?;
        let read_denials = ReadDenyMatcher::try_new_with_context(&policy, &policy_context)?;
        let authorize = |path: &Path, access: AccessMode| -> Result<(), String> {
            if observe_cancellation && cancellation.is_cancelled() {
                return Err("project maintenance cancelled".into());
            }
            let path = PathUri::from(
                AbsolutePathBuf::try_from(path.to_path_buf()).map_err(|e| e.to_string())?,
            );
            if !policy.can_read_path(&path, &policy_context)
                || read_denials
                    .as_ref()
                    .is_some_and(|m| m.is_read_denied_uri(&path, &policy_context))
            {
                return Err(format!("project maintenance read denied: {path}"));
            }
            if matches!(access, AccessMode::Write)
                && !matching.can_write_path(&path).map_err(|e| e.to_string())?
            {
                return Err(format!("project maintenance write denied: {path}"));
            }
            Ok(())
        };
        if request["operation"]
            .as_str()
            .is_some_and(|op| op.starts_with("native_"))
        {
            project_registry(&root, &request, &authorize)
        } else {
            dispatch(&root, request, &authorize)
        }
    })
    .await
    .map_err(invalid)?
    .map_err(invalid)
}

/// Only native empty-input observation may turn a stored session into a terminal receipt.
async fn observe_run(
    invocation: &ToolInvocation,
    environment: &TurnEnvironment,
    root: &Path,
    mut run: Value,
) -> Result<Value, FunctionCallError> {
    if !invocation
        .step_context
        .tool_router
        .exposes_tool(&ToolName::plain("write_stdin"))
    {
        return Ok(run);
    }
    let Some(run_id) = run
        .get("run_id")
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        return Ok(run);
    };
    let steps = run
        .get("steps")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut observations = Vec::new();
    for step in steps {
        if step["status"] != "unknown" {
            continue;
        }
        let Some(session_id) = step
            .get("session_id")
            .and_then(Value::as_i64)
            .and_then(|n| i32::try_from(n).ok())
        else {
            continue;
        };
        // Preserve the same selected-environment boundary as exec and refuse a foreign session.
        if invocation
            .session
            .services
            .unified_exec_manager
            .environment_id_for_process(session_id)
            .await
            .as_deref()
            != Some(environment.selection.environment_id.as_str())
        {
            continue;
        }
        let mut nested = invocation.clone();
        nested.tool_name = ToolName::plain("write_stdin");
        nested.payload = ToolPayload::Function { arguments: json!({"session_id":session_id,"chars":"","yield_time_ms":1,"max_output_tokens":2000}).to_string() };
        let payload = nested.payload.clone();
        let output = match WriteStdinHandler.handle(nested).await {
            Ok(output) => output.code_mode_result(&payload),
            Err(error) => {
                observations
                    .push(json!({"step_id":step["step_id"],"tool_error":error.to_string()}));
                continue;
            }
        };
        let (mut status, mut exit) = execution_status(&output);
        let mut output = output;
        if status != "unknown" {
            let integrity = validate_run_step(
                invocation,
                environment,
                root,
                &run_id,
                step["step_id"].as_str().unwrap_or_default(),
                "after",
            )
            .await;
            if integrity["valid"] != true {
                status = "unknown";
                exit = None;
            }
            output["integrity_check"] = integrity;
            dispatch_local(
                invocation,
                environment,
                root,
                json!({"operation":"finish_step","run_id":run_id,
                    "step_id":step["step_id"],"status":status,"exit_code":exit,"session_id":null,
                    "log_ref":format!("tool-call:{}",invocation.call_id),"execution_output":output,"evidence_scope":"bounded_tool_output","producer_completed":true
                }),
                false,
            )
            .await?;
        }
        observations.push(json!({"step_id":step["step_id"],"status":status,"exec":output}));
    }
    if !observations.is_empty() {
        run = dispatch_local(
            invocation,
            environment,
            root,
            json!({"operation":"run_status","run_id":run_id}),
            false,
        )
        .await?;
        run["execution_outputs"] = json!(observations);
    }
    Ok(run)
}

fn execution_status(output: &Value) -> (&'static str, Option<i32>) {
    let exit = output
        .get("exit_code")
        .and_then(Value::as_i64)
        .and_then(|n| i32::try_from(n).ok());
    if output.get("session_id").is_some_and(|id| !id.is_null()) {
        return ("unknown", None);
    }
    match exit {
        Some(0) => ("passed", exit),
        Some(_) => ("failed", exit),
        None => ("unknown", None),
    }
}

fn step_command(step: &Value, shell: ShellType) -> Result<String, FunctionCallError> {
    let argv = step["argv"]
        .as_array()
        .filter(|args| !args.is_empty())
        .ok_or_else(|| invalid("step requires nonempty argv"))?;
    let argv = argv
        .iter()
        .map(|v| {
            v.as_str()
                .ok_or_else(|| invalid("argv values must be strings"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let env = step.get("env").and_then(Value::as_object);
    let quote = |s: &str| match shell {
        ShellType::PowerShell => format!("'{}'", s.replace('\'', "''")),
        _ => format!("'{}'", s.replace('\'', "'\"'\"'")),
    };
    if !matches!(
        shell,
        ShellType::PowerShell | ShellType::Bash | ShellType::Zsh | ShellType::Sh
    ) {
        return Err(invalid(
            "project maintenance requires PowerShell or a POSIX shell; cmd argv quoting is unsupported",
        ));
    }
    let mut command = String::new();
    if let Some(env) = env {
        for (key, value) in env {
            if key.is_empty()
                || !key.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
                || key.as_bytes()[0].is_ascii_digit()
            {
                return Err(invalid("invalid environment key"));
            }
            let value = value
                .as_str()
                .ok_or_else(|| invalid("environment values must be strings"))?;
            if value.contains('\0') {
                return Err(invalid("environment values must not contain NUL"));
            }
            if matches!(shell, ShellType::PowerShell) {
                command.push_str(&format!("$env:{key}={}; ", quote(value)));
            } else {
                command.push_str(&format!("{key}={} ", quote(value)));
            }
        }
    }
    if matches!(shell, ShellType::PowerShell) {
        command.push_str("$ErrorActionPreference='Stop'; $global:LASTEXITCODE=$null; & ");
    }
    command.push_str(
        &argv
            .iter()
            .map(|arg| quote(arg))
            .collect::<Vec<_>>()
            .join(" "),
    );
    if matches!(shell, ShellType::PowerShell) {
        command.push_str("; $maintenanceSucceeded=$?; if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }; if (-not $maintenanceSucceeded) { exit 1 }");
    }
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::step_context::StepContext;
    use crate::tools::context::ToolCallSource;
    use crate::turn_diff_tracker::TurnDiffTracker;
    use std::sync::Arc;

    fn handler(name: &'static str) -> ProjectMaintenanceHandler {
        ProjectMaintenanceHandler::new(
            name,
            ExecCommandHandlerOptions {
                include_login_parameter: false,
                include_shell_parameter: true,
                allow_tty: false,
                exec_permission_approvals_enabled: false,
                include_environment_id: false,
                include_windows_shell_guidance: false,
            },
        )
    }

    async fn call(invocation: &ToolInvocation, name: &'static str, arguments: Value) -> Value {
        let mut invocation = invocation.clone();
        invocation.tool_name = ToolName::plain(name);
        invocation.payload = ToolPayload::Function {
            arguments: arguments.to_string(),
        };
        let output = handler(name).handle(invocation).await.unwrap();
        serde_json::from_str(&output.log_output()).unwrap()
    }

    async fn registry_invocation(
        home: &Path,
        cwd: &Path,
        profile: codex_protocol::models::PermissionProfile,
    ) -> ToolInvocation {
        let (session, turn, _events) =
            crate::session::tests::make_session_and_context_with_auth_and_config_and_rx(
                codex_login::CodexAuth::from_api_key("Test API Key"),
                Vec::new(),
                |config| {
                    config.codex_home = AbsolutePathBuf::try_from(home.to_path_buf()).unwrap();
                    config.cwd = AbsolutePathBuf::try_from(cwd.to_path_buf()).unwrap();
                    config.permissions.set_permission_profile(profile).unwrap();
                },
            )
            .await;
        ToolInvocation {
            session,
            step_context: StepContext::for_test(Arc::clone(&turn)),
            turn,
            cancellation_token: tokio_util::sync::CancellationToken::new(),
            tracker: Arc::new(tokio::sync::Mutex::new(TurnDiffTracker::new())),
            call_id: "maintenance-registry".into(),
            tool_name: ToolName::plain("project_inventory"),
            source: ToolCallSource::Direct,
            payload: ToolPayload::Function {
                arguments: "{}".into(),
            },
        }
    }

    #[tokio::test]
    async fn actual_project_aliases_resolve_across_cwds_and_enforce_identity_and_permissions() {
        use codex_protocol::models::PermissionProfile;
        let fixture = tempfile::tempdir().unwrap();
        let home = fixture.path().join("engine-home");
        let a = fixture.path().join("a");
        let b = fixture.path().join("b");
        for directory in [&home, &a, &b] {
            std::fs::create_dir(directory).unwrap();
        }
        let config = |id: &str| {
            json!({"schema_version":1,"project_id":id,"managed_roots":["generated"]}).to_string()
        };
        std::fs::write(a.join("project-maintenance.json"), config("alias-a")).unwrap();
        std::fs::write(b.join("project-maintenance.json"), config("alias-a")).unwrap();
        let from_a = registry_invocation(&home, &a, PermissionProfile::Disabled).await;
        let registered = call(
            &from_a,
            "project_inventory",
            json!({"action":"register_project","project_root":a}),
        )
        .await;
        assert_eq!(registered["project_id"], "alias-a");
        assert!(home.join("project-maintenance/projects.json").is_file());
        assert!(!a.join("project-maintenance").exists());
        let from_b = registry_invocation(&home, &b, PermissionProfile::Disabled).await;
        let inventory = call(
            &from_b,
            "project_inventory",
            json!({"action":"list","project_id":"alias-a"}),
        )
        .await;
        assert_eq!(inventory["project_id"], "alias-a");
        assert_eq!(inventory["project_root"], registered["project_root"]);
        let projects = call(&from_b, "project_inventory", json!({"action":"projects"})).await;
        assert_eq!(projects["projects"].as_array().unwrap().len(), 1);
        let mut conflict = from_b.clone();
        conflict.payload = ToolPayload::Function {
            arguments: json!({"action":"register_project","project_root":b}).to_string(),
        };
        assert!(
            handler("project_inventory")
                .handle(conflict)
                .await
                .err()
                .unwrap()
                .to_string()
                .contains("another root")
        );
        let readonly = registry_invocation(&home, &b, PermissionProfile::read_only()).await;
        assert_eq!(
            call(&readonly, "project_inventory", json!({"action":"projects"})).await["projects"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let mut denied_write = readonly;
        denied_write.payload = ToolPayload::Function {
            arguments: json!({"action":"unregister_project","project_id":"alias-a"}).to_string(),
        };
        assert!(
            handler("project_inventory")
                .handle(denied_write)
                .await
                .err()
                .unwrap()
                .to_string()
                .contains("write denied")
        );
        let mut denied_read = registry_invocation(&home, &b, PermissionProfile::default()).await;
        denied_read.payload = ToolPayload::Function {
            arguments: json!({"action":"projects"}).to_string(),
        };
        assert!(
            handler("project_inventory")
                .handle(denied_read)
                .await
                .err()
                .unwrap()
                .to_string()
                .contains("read denied")
        );
        let mut missing = from_b.clone();
        missing.payload = ToolPayload::Function {
            arguments: json!({"action":"list","project_id":"missing"}).to_string(),
        };
        assert!(handler("project_inventory").handle(missing).await.is_err());
        std::fs::write(a.join("project-maintenance.json"), config("changed-id")).unwrap();
        let mut mismatch = from_b.clone();
        mismatch.payload = ToolPayload::Function {
            arguments: json!({"action":"list","project_id":"alias-a"}).to_string(),
        };
        assert!(
            handler("project_inventory")
                .handle(mismatch.clone())
                .await
                .err()
                .unwrap()
                .to_string()
                .contains("no longer matches")
        );
        std::fs::remove_file(a.join("project-maintenance.json")).unwrap();
        std::fs::remove_dir(&a).unwrap();
        assert!(handler("project_inventory").handle(mismatch).await.is_err());
        let unregistered = call(
            &from_b,
            "project_inventory",
            json!({"action":"unregister_project","project_id":"alias-a"}),
        )
        .await;
        assert_eq!(unregistered["project_files_changed"], false);
        assert!(b.join("project-maintenance.json").exists());
    }

    #[tokio::test]
    async fn actual_handler_runs_observed_exits_and_applies_reviewed_model_decisions() {
        let project = tempfile::tempdir().unwrap();
        let root = project.path();
        std::fs::write(root.join("input.txt"), "before").unwrap();
        std::fs::create_dir(root.join("generated")).unwrap();
        std::fs::write(root.join("generated/result.txt"), "owned generated result").unwrap();
        let argv = |exit: i32| {
            if cfg!(windows) {
                json!([
                    "powershell.exe",
                    "-NoProfile",
                    "-Command",
                    format!("exit {exit}")
                ])
            } else {
                json!(["/bin/sh", "-c", format!("exit {exit}")])
            }
        };
        let mutating_argv = if cfg!(windows) {
            json!([
                "powershell.exe",
                "-NoProfile",
                "-Command",
                "Set-Content -LiteralPath input.txt -Value changed; exit 0"
            ])
        } else {
            json!(["/bin/sh", "-c", "printf changed > input.txt; exit 0"])
        };
        std::fs::write(root.join("project-maintenance.json"), json!({
            "schema_version":1,"project_id":"native-execution-test","managed_roots":["generated"],
            "bundles":[
                {"id":"passing","kind":"test","purpose":"one_off","argv":argv(0),"inputs":["input.txt"]},
                {"id":"failing","kind":"test","purpose":"one_off","argv":argv(7),"inputs":["input.txt"]},
                {"id":"dependent","kind":"test","purpose":"one_off","argv":argv(0),"depends_on":["failing"]},
                {"id":"product","kind":"build","purpose":"retained","argv":argv(0)},
                {"id":"mutating","kind":"test","purpose":"one_off","argv":mutating_argv,"inputs":["input.txt"]},
                {"id":"after-mutation","kind":"test","purpose":"one_off","argv":argv(0),"depends_on":["mutating"]}
            ]
        }).to_string()).unwrap();
        let (session, turn, _events) =
            crate::session::tests::make_session_and_context_with_auth_and_config_and_rx(
                codex_login::CodexAuth::from_api_key("Test API Key"),
                Vec::new(),
                |config| {
                    config
                        .permissions
                        .set_permission_profile(codex_protocol::models::PermissionProfile::Disabled)
                        .unwrap();
                    config.permissions.approval_policy = crate::config::Constrained::allow_any(
                        codex_protocol::protocol::AskForApproval::Never,
                    );
                },
            )
            .await;
        let invocation = ToolInvocation {
            session,
            step_context: StepContext::for_test(Arc::clone(&turn)),
            turn,
            cancellation_token: tokio_util::sync::CancellationToken::new(),
            tracker: Arc::new(tokio::sync::Mutex::new(TurnDiffTracker::new())),
            call_id: "maintenance-lifecycle".into(),
            tool_name: ToolName::plain("project_tests"),
            source: ToolCallSource::Direct,
            payload: ToolPayload::Function {
                arguments: "{}".into(),
            },
        };
        let first_plan = call(
            &invocation,
            "project_tests",
            json!({"action":"plan","project_root":root,"bundles":["passing"]}),
        )
        .await;
        std::fs::write(root.join("input.txt"), "after").unwrap();
        let updated_plan = call(
            &invocation,
            "project_tests",
            json!({"action":"plan","project_root":root,"bundles":["passing"]}),
        )
        .await;
        assert_ne!(first_plan["plan_id"], updated_plan["plan_id"]);
        let passing = call(
            &invocation,
            "project_tests",
            json!({"action":"run","project_root":root,"bundles":["passing"]}),
        )
        .await;
        assert_eq!(passing["status"], "passed");
        assert_eq!(passing["steps"][0]["exit_code"], 0);
        assert_eq!(passing["steps"][0]["execution_output"]["exit_code"], 0);
        assert_eq!(passing["steps"][0]["evidence_scope"], "bounded_tool_output");
        assert_eq!(passing["execution_outputs"][0]["exec"]["exit_code"], 0);
        let failing = call(
            &invocation,
            "project_tests",
            json!({"action":"run","project_root":root,"bundles":["dependent"]}),
        )
        .await;
        assert_eq!(failing["status"], "failed");
        assert_eq!(failing["steps"][0]["exit_code"], 7);
        assert_eq!(failing["steps"][1]["status"], "not_run");
        assert!(failing["steps"][1]["exit_code"].is_null());
        let mut restricted = invocation.clone();
        restricted.payload = ToolPayload::Function {
            arguments: json!({"action":"run","project_root":root,"bundles":["product"]})
                .to_string(),
        };
        assert!(handler("project_tests").handle(restricted).await.is_err());
        call(&invocation, "project_inventory", json!({"action":"register","project_root":root,"request":{"item":{
            "id":"result","path":"generated/result.txt","kind":"build_output","owner":"native-test",
            "generated":true,"protection_known":true,"references":[]
        }}})).await;
        let review = call(
            &invocation,
            "project_cleanup_review",
            json!({"action":"review","project_root":root,"request":{"ids":["result"]}}),
        )
        .await;
        let deferred = call(&invocation, "project_cleanup_apply", json!({"action":"apply","project_root":root,"request":{"decisions":[{
            "id":"result","token":review["items"][0]["token"],"decision":"defer","reason":"keep until result inspection",
            "revisit_condition":"result inspection finished"
        }]}})).await;
        assert_eq!(deferred["results"][0]["status"], "deferred");
        assert!(root.join("generated/result.txt").exists());
        let review = call(
            &invocation,
            "project_cleanup_review",
            json!({"action":"review","project_root":root,"request":{"ids":["result"]}}),
        )
        .await;
        assert!(
            review["items"][0]["blockers"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        let deleted = call(&invocation, "project_cleanup_apply", json!({"action":"apply","project_root":root,"request":{"decisions":[{
            "id":"result","token":review["items"][0]["token"],"decision":"delete","reason":"inspection finished"
        }]}})).await;
        assert_eq!(deleted["results"][0]["status"], "deleted");
        assert_eq!(deleted["results"][0]["remaining"], false);
        assert!(!root.join("generated/result.txt").exists());
        let invalid = call(
            &invocation,
            "project_tests",
            json!({"action":"run","project_root":root,"bundles":["after-mutation"]}),
        )
        .await;
        assert_eq!(invalid["status"], "unknown");
        assert_eq!(invalid["steps"][0]["status"], "unknown");
        assert!(invalid["steps"][0]["exit_code"].is_null());
        assert_eq!(invalid["steps"][0]["execution_output"]["exit_code"], 0);
        assert_eq!(
            invalid["steps"][0]["execution_output"]["integrity_check"]["valid"],
            false
        );
        assert_eq!(invalid["steps"][1]["status"], "not_run");
        assert_eq!(invalid["steps"][0]["producer_completed"], true);
        let retry = call(
            &invocation,
            "project_tests",
            json!({"action":"run","project_root":root,"bundles":["passing"]}),
        )
        .await;
        assert_eq!(retry["status"], "passed");
        // Crash fixture: a previous engine committed begin_run and disappeared before spawning.
        // No process was started, so this fixture independently knows the owned tree is stopped.
        let abandoned = dispatch(root, json!({"operation":"begin_run","kind":"test","bundles":["passing"],"owner":"abrupt-loss-fixture"}), &|_, _| Ok(())).unwrap();
        let mut blocked_retry = invocation.clone();
        blocked_retry.payload = ToolPayload::Function {
            arguments: json!({"action":"run","project_root":root,"bundles":["passing"]})
                .to_string(),
        };
        assert!(
            handler("project_tests")
                .handle(blocked_retry)
                .await
                .is_err()
        );
        let mut forged_recovery = invocation.clone();
        forged_recovery.payload = ToolPayload::Function {arguments:json!({"action":"recover","project_root":root,"run_id":abandoned["run_id"],"request":{
            "producer_stopped_verified":true,"reason":"owned producer never started","evidence_ref":"fixture://crash-before-spawn","exit_code":0,"status":"passed"
        }}).to_string()};
        assert!(
            handler("project_tests")
                .handle(forged_recovery)
                .await
                .is_err()
        );
        let recovered = call(&invocation,"project_tests",json!({"action":"recover","project_root":root,"run_id":abandoned["run_id"],"request":{
            "producer_stopped_verified":true,"reason":"fixture committed start receipt without spawning any process","evidence_ref":"fixture://crash-before-spawn"
        }})).await;
        assert_eq!(recovered["status"], "unknown");
        assert!(recovered["steps"][0]["exit_code"].is_null());
        assert_eq!(recovered["steps"][0]["producer_completed"], true);
        let retry = call(
            &invocation,
            "project_tests",
            json!({"action":"run","project_root":root,"bundles":["passing"]}),
        )
        .await;
        assert_eq!(retry["status"], "passed");
        let mut forged = invocation;
        forged.payload = ToolPayload::Function {
            arguments:
                json!({"action":"finish_step","project_root":root,"request":{"exit_code":0}})
                    .to_string(),
        };
        assert!(handler("project_tests").handle(forged).await.is_err());
    }

    #[tokio::test]
    async fn actual_handler_reads_inventory_but_cannot_register_with_read_only_permissions() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join("project-maintenance.json"),
            json!({
                "schema_version":1,"project_id":"native-handler-test","managed_roots":["generated"]
            })
            .to_string(),
        )
        .unwrap();
        std::fs::create_dir(project.path().join("generated")).unwrap();
        std::fs::write(project.path().join("generated/item.txt"), "owned fixture").unwrap();
        let (session, turn, _events) =
            crate::session::tests::make_session_and_context_with_auth_and_config_and_rx(
                codex_login::CodexAuth::from_api_key("Test API Key"),
                Vec::new(),
                |config| {
                    config
                        .permissions
                        .set_permission_profile(
                            codex_protocol::models::PermissionProfile::read_only(),
                        )
                        .unwrap();
                },
            )
            .await;
        let turn = Arc::clone(&turn);
        let mut invocation = ToolInvocation {
            session,
            step_context: StepContext::for_test(Arc::clone(&turn)),
            turn,
            cancellation_token: tokio_util::sync::CancellationToken::new(),
            tracker: Arc::new(tokio::sync::Mutex::new(TurnDiffTracker::new())),
            call_id: "maintenance-permissions".into(),
            tool_name: ToolName::plain("project_inventory"),
            source: ToolCallSource::Direct,
            payload: ToolPayload::Function {
                arguments: json!({"action":"list","project_root":project.path()}).to_string(),
            },
        };
        let output = handler("project_inventory")
            .handle(invocation.clone())
            .await
            .unwrap();
        assert!(output.log_output().contains("native-handler-test"));
        assert!(!project.path().join("artifacts").exists());
        invocation.payload = ToolPayload::Function {
            arguments: json!({
                "action":"register","project_root":project.path(),"request":{"item":{
                    "id":"owned","path":"generated/item.txt","kind":"build_output","owner":"test",
                    "generated":true,"protection_known":true,"references":[]
                }}
            })
            .to_string(),
        };
        let error = handler("project_inventory")
            .handle(invocation)
            .await
            .err()
            .expect("read-only registration must fail");
        assert!(error.to_string().contains("write denied"));
        assert!(!project.path().join("artifacts").exists());
        assert_eq!(
            std::fs::read_to_string(project.path().join("generated/item.txt")).unwrap(),
            "owned fixture"
        );
    }

    #[test]
    fn exits_are_structured_and_sessions_never_pass() {
        assert_eq!(
            execution_status(&json!({"exit_code":0})),
            ("passed", Some(0))
        );
        assert_eq!(
            execution_status(&json!({"exit_code":7})),
            ("failed", Some(7))
        );
        assert_eq!(
            execution_status(&json!({"session_id":8,"output":"exit code 0"})),
            ("unknown", None)
        );
        assert_eq!(
            execution_status(&json!({"output":"exit code 0"})),
            ("unknown", None)
        );
    }
    #[test]
    fn argv_and_environment_are_quoted_as_data() {
        let step = json!({"argv":["program", "$(touch bad)", "it's"],"env":{"X":"$value"}});
        assert!(
            step_command(&step, ShellType::PowerShell)
                .unwrap()
                .contains("'it''s'")
        );
        assert!(
            step_command(&step, ShellType::Bash)
                .unwrap()
                .contains("'$(touch bad)'")
        );
        assert!(
            step_command(&json!({"argv":["x"],"env":{"A;exit":"x"}}), ShellType::Bash).is_err()
        );
    }
    #[test]
    fn public_action_cannot_override_dispatch() {
        let args: Args =
            serde_json::from_value(json!({"action":"list","request":{"operation":"apply"}}))
                .unwrap();
        assert!(request_for("project_inventory", &args).is_err());
        assert!(request_for("project_cleanup_apply", &args).is_err());
    }
}

//! Project-local execution receipts and explicit, reviewed artifact maintenance.
//! Commands in plans are data: the host owns process execution and authorization.
mod apply;
mod groups;
mod paths;
mod planning;
mod registry;
mod storage;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AccessMode {
    Read,
    Write,
}
pub type Authorizer = dyn Fn(&Path, AccessMode) -> Result<(), String> + Send + Sync;
pub(crate) type Auth<'a> = &'a Context<'a>;

// Only content digests are memoized. Every caller still performs its complete
// traversal, authorization and policy checks on each observation.
pub(crate) struct Context<'a> {
    authorize: &'a dyn Fn(&Path, AccessMode) -> Result<(), String>,
    content: std::cell::RefCell<paths::ContentCache>,
    catalog_locks: std::cell::RefCell<std::collections::BTreeSet<PathBuf>>,
}

impl<'a> Context<'a> {
    fn new(authorize: &'a dyn Fn(&Path, AccessMode) -> Result<(), String>) -> Self {
        Self {
            authorize,
            content: Default::default(),
            catalog_locks: Default::default(),
        }
    }
}

impl<'a> std::ops::Deref for Context<'a> {
    type Target = dyn Fn(&Path, AccessMode) -> Result<(), String> + 'a;

    fn deref(&self) -> &Self::Target {
        self.authorize
    }
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct Config {
    schema_version: u32,
    project_id: String,
    managed_roots: Vec<PathBuf>,
    #[serde(default)]
    protected_paths: Vec<PathBuf>,
    #[serde(default)]
    bundles: Vec<planning::Bundle>,
    #[serde(flatten)]
    metadata: BTreeMap<String, Value>,
}

#[derive(Default, Deserialize, Serialize)]
pub(crate) struct State {
    #[serde(default)]
    revision: u64,
    #[serde(default)]
    items: BTreeMap<String, Value>,
    #[serde(default)]
    groups: BTreeMap<String, Value>,
    #[serde(default)]
    runs: BTreeMap<String, Value>,
    #[serde(default)]
    decisions: Vec<Value>,
}

pub(crate) fn hash(value: &impl Serialize) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(value).map_err(|e| e.to_string())?)
    ))
}

pub(crate) fn string<'a>(v: &'a Value, key: &str) -> Result<&'a str, String> {
    v.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("missing nonempty {key}"))
}

fn now_ms() -> Result<u64, String> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis()
        .try_into()
        .map_err(|_| "timestamp overflow".into())
}
fn page(request: &Value) -> Result<(usize, usize), String> {
    let offset = request
        .get("offset")
        .map_or(Ok(0), |value| value.as_u64().ok_or("invalid offset"))?;
    let limit = request.get("limit").map_or(Ok(50), |value| {
        value
            .as_u64()
            .filter(|limit| (1..=200).contains(limit))
            .ok_or("limit must be 1..200")
    })?;
    Ok((
        offset.try_into().map_err(|_| "offset overflow")?,
        limit as usize,
    ))
}
fn producer_active(step: &Value) -> bool {
    step["producer_completed"] == false
        || ((step["status"] == "unknown" || step["status"] == "interrupted")
            && step["producer_completed"] != true)
}
fn valid_references(value: &Value) -> bool {
    value.as_array().is_some_and(|references| {
        references.iter().all(|reference| {
            reference
                .as_str()
                .is_some_and(|text| !text.trim().is_empty())
        })
    })
}
fn run_summary(run: &Value) -> Value {
    json!({"run_id":run["run_id"],"plan_id":run["plan_id"],"owner":run["owner"],"status":run["status"],"steps_total":run["steps"].as_array().map_or(0,Vec::len)})
}

/// Dispatch a structured request within an already selected project directory.
/// Every filesystem observation and mutation passes through `authorize`.
pub fn dispatch(
    root: &Path,
    request: Value,
    authorize: &dyn Fn(&Path, AccessMode) -> Result<(), String>,
) -> Result<Value, String> {
    dispatch_inner(root, request, &Context::new(authorize))
}

fn dispatch_inner(root: &Path, request: Value, authorize: Auth<'_>) -> Result<Value, String> {
    authorize(root, AccessMode::Read)?;
    paths::check(root, root, authorize)?;
    let root = dunce::canonicalize(root).map_err(|e| e.to_string())?;
    paths::check(&root, &root, authorize)?;
    let operation = string(&request, "operation")?;
    let receipt_operation = matches!(
        operation,
        "validate_step" | "finish_step" | "run_status" | "recover_run"
    );
    let config_path = root.join("project-maintenance.json");
    paths::check(&root, &config_path, authorize)?;
    let config_bytes = match std::fs::read(&config_path) {
        Ok(bytes) => bytes,
        Err(error) if receipt_operation && error.kind() == std::io::ErrorKind::NotFound => {
            Vec::new()
        }
        Err(error) => return Err(error.to_string()),
    };
    // Receipts remain writable if a command damages or removes its config.
    // Such bytes invalidate execution integrity; they never authorize new work.
    let config = if receipt_operation {
        None
    } else {
        let config: Config = serde_json::from_slice(&config_bytes).map_err(|e| e.to_string())?;
        if config.schema_version != 1 || config.project_id.is_empty() {
            return Err("unsupported config or missing project_id".into());
        }
        for path in config.managed_roots.iter().chain(&config.protected_paths) {
            paths::relative(path)?;
        }
        Some(config)
    };
    let config_identity = hash(&config_bytes)?;
    let mut store = storage::Store::open(
        &root,
        authorize,
        matches!(
            operation,
            "register" | "begin_run" | "finish_step" | "validate_step" | "recover_run" | "apply"
        ),
    )?;
    if matches!(
        operation,
        "register" | "begin_run" | "finish_step" | "validate_step" | "recover_run" | "apply"
    ) {
        store.authorize_save(authorize)?;
    }
    // Keep producer metadata stable through the final manifest commit, including
    // all durable deletion intents and results written by apply.
    let _catalog_locks = registry::lock_request(&root, &request, &store.state, authorize)?;
    if operation == "apply" {
        return apply::apply(
            &root,
            config.as_ref().ok_or("valid project config required")?,
            &config_identity,
            &request,
            &mut store,
            authorize,
        );
    }
    let state = &mut store.state;
    let result = match operation {
        "inventory" => {
            let config = config.as_ref().ok_or("valid project config required")?;
            let (offset, limit) = page(&request)?;
            let now = now_ms()?;
            let total = state
                .items
                .values()
                .filter_map(|item| item["logical_bytes"].as_u64())
                .fold(0u64, u64::saturating_add);
            let over_budget = config
                .metadata
                .get("byte_budget")
                .and_then(Value::as_u64)
                .is_some_and(|limit| total > limit);
            let items = state
                .items
                .values()
                .skip(offset)
                .take(limit)
                .map(|item| {
                    let mut item = item.clone();
                    let mut reasons = Vec::new();
                    if item["revisit_after_ms"]
                        .as_u64()
                        .is_some_and(|at| now >= at)
                    {
                        reasons.push("revisit timestamp reached");
                    }
                    let days = item
                        .get("retention_days")
                        .or_else(|| config.metadata.get("retention_days"))
                        .and_then(Value::as_u64);
                    if days
                        .zip(item["created_at_ms"].as_u64())
                        .is_some_and(|(days, created)| {
                            now.saturating_sub(created) >= days.saturating_mul(86_400_000)
                        })
                    {
                        reasons.push("retention review due");
                    }
                    if over_budget {
                        reasons.push("logical byte budget exceeded");
                    }
                    item["due_for_review"] = json!(!reasons.is_empty());
                    item["review_reasons"] = json!(reasons);
                    item
                })
                .collect::<Vec<_>>();
            let runs = state
                .runs
                .iter()
                .skip(offset)
                .take(limit)
                .map(|(id, run)| (id.clone(), run_summary(run)))
                .collect::<BTreeMap<_, _>>();
            let decisions = state
                .decisions
                .iter()
                .skip(offset)
                .take(limit)
                .map(|decision| {
                    let mut summary = decision.clone();
                    if let Some(map) = summary.as_object_mut() {
                        map.remove("deletion");
                    }
                    summary
                })
                .collect::<Vec<_>>();
            let bundles = config
                .bundles
                .iter()
                .skip(offset)
                .take(limit)
                .collect::<Vec<_>>();
            let groups = state
                .groups
                .values()
                .skip(offset)
                .take(limit)
                .map(|group| groups::summary(state, group))
                .collect::<Vec<_>>();
            json!({"project_id":config.project_id,"project_root":root,"items":items,"groups":groups,"bundles":bundles,"runs":runs,"decisions":decisions,"pagination":{"offset":offset,"limit":limit,"total":state.items.len(),"groups_total":state.groups.len(),"runs_total":state.runs.len(),"decisions_total":state.decisions.len(),"bundles_total":config.bundles.len()},"logical_bytes":total,"measurement":"cached logical bytes; not reclaimed physical space","policy":config.metadata})
        }
        "register" => {
            if let Some(refresh) = request.get("refresh_group") {
                if request.get("group").is_some() || request.get("item").is_some() {
                    return Err("refresh_group cannot include item or group".into());
                }
                groups::refresh(&root, string(refresh, "id")?, state, authorize)?
            } else if request.get("group").is_some() {
                if request.get("item").is_some() {
                    return Err("register accepts item or group, not both".into());
                }
                groups::register(&root, request["group"].clone(), state, authorize)?
            } else {
                let mut item = request.get("item").cloned().ok_or("missing item")?;
                let id = string(&item, "id")?.to_owned();
                if item.get("lifecycle_group_id").is_some()
                    || item.get("lifecycle_role").is_some()
                    || state.groups.values().any(|group| {
                        group["members"].as_array().is_some_and(|members| {
                            members
                                .iter()
                                .any(|member| member.as_str() == Some(id.as_str()))
                        })
                    })
                    || state
                        .items
                        .get(&id)
                        .is_some_and(|existing| existing["lifecycle_group_id"].as_str().is_some())
                {
                    return Err("grouped members must be updated through group registration".into());
                }
                item = prepare_item(&root, item, authorize)?;
                state.items.insert(id, item.clone());
                json!({"item":item})
            }
        }
        "plan" | "begin_run" => {
            let config = config.as_ref().ok_or("valid project config required")?;
            let mut plan = planning::plan(&root, &config, &request, authorize)?;
            plan["config_identity"] = json!(config_identity);
            if operation == "begin_run" {
                for existing in state.runs.values() {
                    if !existing["steps"]
                        .as_array()
                        .is_some_and(|steps| steps.iter().any(producer_active))
                    {
                        continue;
                    }
                    let shared_resource = plan["steps"].as_array().is_some_and(|requested| {
                        requested.iter().any(|step| {
                            step["resource"].as_str().is_some_and(|resource| {
                                existing["steps"].as_array().is_some_and(|steps| {
                                    steps.iter().any(|active| {
                                        active["resource"].as_str() == Some(resource)
                                            && producer_active(active)
                                    })
                                })
                            })
                        })
                    });
                    if existing["plan_id"] == plan["plan_id"] || shared_resource {
                        return Err(
                            "existing unresolved producer owns this plan or resource".into()
                        );
                    }
                }
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|e| e.to_string())?
                    .as_nanos();
                let run_id = format!("run-{}-{}-{now}", std::process::id(), state.revision);
                plan["run_id"] = json!(run_id);
                let mut run = plan.clone();
                run["owner"] = json!(
                    request
                        .get("owner")
                        .and_then(Value::as_str)
                        .unwrap_or("model")
                );
                run["status"] = json!("unknown");
                if let Some(steps) = run["steps"].as_array_mut() {
                    for step in steps {
                        step["status"] = json!("unknown");
                        step["exit_code"] = Value::Null;
                    }
                }
                state.runs.insert(run_id, run);
            }
            plan
        }
        "validate_step" => {
            let run_id = string(&request, "run_id")?;
            let step_id = string(&request, "step_id")?;
            let phase = string(&request, "phase")?;
            if !["before", "after"].contains(&phase) {
                return Err("invalid validation phase".into());
            }
            let run = state.runs.get_mut(run_id).ok_or("unknown run")?;
            let expected_config = run["config_identity"].clone();
            let steps = run["steps"].as_array_mut().ok_or("invalid stored steps")?;
            let step = steps
                .iter_mut()
                .find(|step| step["step_id"] == step_id)
                .ok_or("unknown step")?;
            let check = (|| -> Result<(), String> {
                if expected_config != config_identity {
                    return Err("project config changed after planning".into());
                }
                for input in step["inputs"].as_array().ok_or("missing planned inputs")? {
                    let path = Path::new(string(input, "path")?);
                    let observed = paths::measure(&root, path, authorize)?;
                    if observed["identity"] != input["identity"] {
                        return Err(format!("planned input changed: {}", path.display()));
                    }
                }
                paths::check(&root, &config_path, authorize)?;
                if hash(&std::fs::read(&config_path).map_err(|e| e.to_string())?)?
                    != config_identity
                {
                    return Err("project config changed during validation".into());
                }
                if step["integrity_status"] == "invalid" {
                    return Err("step integrity was already invalidated".into());
                }
                Ok(())
            })();
            let result = match check {
                Ok(()) => {
                    json!({"run_id":run_id,"step_id":step_id,"phase":phase,"valid":true,"checked_at_ms":now_ms()?})
                }
                Err(reason) => {
                    json!({"run_id":run_id,"step_id":step_id,"phase":phase,"valid":false,"reason":reason,"checked_at_ms":now_ms()?})
                }
            };
            step["integrity_status"] = json!(if result["valid"] == true {
                "valid"
            } else {
                "invalid"
            });
            step[format!("integrity_{phase}")] = result.clone();
            if result["valid"] != true {
                if !step["exit_code"].is_null() {
                    step["observed_exit_code"] = step["exit_code"].clone();
                }
                step["exit_code"] = Value::Null;
                step["status"] = json!("unknown");
                run["status"] = json!("unknown");
            }
            result
        }
        "recover_run" => {
            if request
                .as_object()
                .ok_or("invalid recovery request")?
                .keys()
                .any(|key| {
                    ![
                        "operation",
                        "run_id",
                        "producer_stopped_verified",
                        "reason",
                        "evidence_ref",
                    ]
                    .contains(&key.as_str())
                })
            {
                return Err("recovery cannot override execution status or exit evidence".into());
            }
            if request["producer_stopped_verified"] != true {
                return Err(
                    "recovery requires independently verified producer/process-tree stop".into(),
                );
            }
            let reason = string(&request, "reason")?;
            let evidence_ref = string(&request, "evidence_ref")?;
            if reason.trim().is_empty() || evidence_ref.trim().is_empty() {
                return Err("recovery reason and evidence reference cannot be blank".into());
            }
            let run_id = string(&request, "run_id")?;
            let run = state.runs.get_mut(run_id).ok_or("unknown run")?;
            let steps = run["steps"].as_array_mut().ok_or("invalid stored steps")?;
            if !steps.iter().any(producer_active) {
                return Err("run has no unresolved producer".into());
            }
            if steps
                .iter()
                .filter(|step| producer_active(step))
                .any(|step| step["status"] != "unknown" && step["status"] != "interrupted")
            {
                return Err("contradictory terminal producer record requires investigation".into());
            }
            let evidence = json!({"producer_stopped_verified":true,"reason":reason,"evidence_ref":evidence_ref,"recovered_at_ms":now_ms()?});
            for step in steps.iter_mut().filter(|step| producer_active(step)) {
                step["producer_completed"] = json!(true);
                step["exit_code"] = Value::Null;
                step["producer_recovery"] = evidence.clone();
            }
            run["producer_recovery"] = evidence;
            run.clone()
        }
        "finish_step" => {
            let run_id = string(&request, "run_id")?;
            let step_id = string(&request, "step_id")?;
            let status = string(&request, "status")?;
            if request
                .get("producer_completed")
                .is_some_and(|value| !value.is_boolean())
            {
                return Err("producer_completed must be a trusted boolean".into());
            }
            if status == "not_run" && request.get("producer_completed") == Some(&Value::Bool(false))
            {
                return Err("not_run has no active producer".into());
            }
            if let Some(output) = request.get("execution_output") {
                if !output.is_object()
                    || serde_json::to_vec(output).map_err(|e| e.to_string())?.len() > 65536
                {
                    return Err("execution_output must be a bounded object of at most 64KiB".into());
                }
            }
            if let Some(scope) = request.get("evidence_scope") {
                if scope != "bounded_tool_output" || request.get("execution_output").is_none() {
                    return Err("invalid bounded execution evidence scope".into());
                }
            }
            if !["passed", "failed", "interrupted", "unknown", "not_run"].contains(&status) {
                return Err("invalid step status".into());
            }
            let exit = request
                .get("exit_code")
                .ok_or("exit_code must be explicitly nullable")?;
            if !exit.is_null() && exit.as_i64().is_none() {
                return Err("invalid exit_code".into());
            }
            if let Some(observed) = request
                .get("execution_output")
                .and_then(|output| output.get("exit_code"))
            {
                if !observed.is_null() && observed.as_i64().is_none() {
                    return Err("invalid observed execution exit code".into());
                }
                if (!exit.is_null() && exit != observed)
                    || (status == "not_run" && !observed.is_null())
                {
                    return Err("reported exit contradicts execution evidence".into());
                }
            }
            if request.get("producer_completed") == Some(&Value::Bool(false))
                && (["passed", "failed", "not_run"].contains(&status)
                    || !exit.is_null()
                    || request
                        .get("execution_output")
                        .and_then(|output| output.get("exit_code"))
                        .is_some_and(|observed| !observed.is_null()))
            {
                return Err(
                    "unfinished producer cannot have a terminal result or observed exit".into(),
                );
            }
            if (status == "passed" && exit.as_i64() != Some(0))
                || (status == "failed" && exit.as_i64().is_none_or(|code| code == 0))
                || (["unknown", "interrupted", "not_run"].contains(&status) && !exit.is_null())
            {
                return Err("status contradicts observed exit code".into());
            }
            let run = state.runs.get_mut(run_id).ok_or("unknown run")?;
            if status == "passed" && run["config_identity"] != config_identity {
                return Err("project config changed after planning".into());
            }
            let steps = run["steps"].as_array_mut().ok_or("invalid stored steps")?;
            let step = steps
                .iter_mut()
                .find(|s| s["step_id"] == step_id)
                .ok_or("unknown step")?;
            if status == "passed" && step["integrity_status"] == "invalid" {
                return Err("invalidated planned input cannot pass".into());
            }
            if (step["status"] != "unknown" || step["producer_completed"] == true)
                && (step["status"] != status
                    || step["exit_code"] != *exit
                    || [
                        "log_ref",
                        "session_id",
                        "execution_output",
                        "evidence_scope",
                        "producer_completed",
                    ]
                    .iter()
                    .any(|key| request.get(*key).is_some_and(|v| step.get(*key) != Some(v))))
            {
                return Err("conflicting terminal step result".into());
            }
            step["status"] = json!(status);
            step["exit_code"] = exit.clone();
            for key in [
                "log_ref",
                "session_id",
                "execution_output",
                "evidence_scope",
                "producer_completed",
            ] {
                if let Some(v) = request.get(key) {
                    step[key] = v.clone();
                }
            }
            if status == "not_run" {
                step["producer_completed"] = json!(true);
            }
            let overall = if steps.iter().any(|s| s["status"] == "unknown") {
                "unknown"
            } else if steps.iter().any(|s| s["status"] == "interrupted") {
                "interrupted"
            } else if steps.iter().any(|s| s["status"] == "failed") {
                "failed"
            } else if steps.iter().any(|s| s["status"] == "not_run") {
                "not_run"
            } else {
                "passed"
            };
            run["status"] = json!(overall);
            run.clone()
        }
        "run_status" => {
            let (offset, limit) = page(&request)?;
            if let Some(id) = request.get("run_id").and_then(Value::as_str) {
                let mut run = state.runs.get(id).cloned().ok_or("unknown run")?;
                let steps = run["steps"].as_array().ok_or("invalid stored steps")?;
                let total = steps.len();
                let selected = steps
                    .iter()
                    .skip(offset)
                    .take(limit)
                    .cloned()
                    .collect::<Vec<_>>();
                run["steps"] = json!(selected);
                run["pagination"] = json!({"offset":offset,"limit":limit,"total":total});
                run
            } else {
                let runs = state
                    .runs
                    .iter()
                    .skip(offset)
                    .take(limit)
                    .map(|(id, run)| (id.clone(), run_summary(run)))
                    .collect::<BTreeMap<_, _>>();
                json!({"runs":runs,"pagination":{"offset":offset,"limit":limit,"total":state.runs.len()}})
            }
        }
        "review" => groups::review_selection(
            &root,
            config.as_ref().ok_or("valid project config required")?,
            &config_identity,
            state,
            &request,
            authorize,
        )?,
        _ => return Err("unknown maintenance operation".into()),
    };
    if matches!(
        operation,
        "register" | "begin_run" | "finish_step" | "validate_step" | "recover_run" | "apply"
    ) {
        store.save(authorize)?;
    }
    Ok(result)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Verification {
    Registered,
    Full,
}
impl Verification {
    pub(crate) fn requested(request: &Value) -> Result<Option<Self>, String> {
        match request.get("verification") {
            None => Ok(None),
            Some(Value::String(mode)) if mode == "registered" => Ok(Some(Self::Registered)),
            Some(Value::String(mode)) if mode == "full" => Ok(Some(Self::Full)),
            _ => Err("verification must be registered or full".into()),
        }
    }
    fn name(self) -> &'static str {
        if self == Self::Registered {
            "registered"
        } else {
            "full"
        }
    }
}

fn review_ungrouped(
    root: &Path,
    config: &Config,
    config_identity: &str,
    state: &State,
    item: &Value,
    auth: Auth<'_>,
    verification: Verification,
) -> Result<Value, String> {
    let mut selected = review_single(
        root,
        config,
        config_identity,
        state,
        item,
        auth,
        true,
        verification,
    )?;
    let target = Path::new(string(item, "path")?);
    let mut related = Vec::new();
    for group in state.groups.values() {
        if let Some(source) = group["membership_source"].as_str() {
            let source = paths::resolve(root, Path::new(source))?;
            if paths::within(target, &source) || paths::within(&source, target) {
                selected["blockers"]
                    .as_array_mut()
                    .ok_or("invalid review")?
                    .push(json!(
                        "lifecycle membership source is read-only control evidence"
                    ));
            }
        }
    }
    for other in state.items.values() {
        if other["id"] == item["id"] {
            continue;
        }
        let other_path = Path::new(string(other, "path")?);
        if let Some(source) = other["source_path"].as_str() {
            let source = paths::resolve(root, Path::new(source))?;
            if paths::within(target, &source) || paths::within(&source, target) {
                selected["blockers"]
                    .as_array_mut()
                    .ok_or("invalid review")?
                    .push(json!(
                        "another registered item's original source overlaps target"
                    ));
            }
        }
        if paths::within(target, other_path) || paths::within(other_path, target) {
            if other["cleanup_status"] == "deleted" && other["remaining"] == false {
                paths::check(root, other_path, auth)?;
                match std::fs::symlink_metadata(other_path) {
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(error) => return Err(error.to_string()),
                    Ok(_) => {}
                }
            }
            if groups::id(other).is_some() && groups::id(other) != groups::id(item) {
                selected["blockers"]
                    .as_array_mut()
                    .ok_or("invalid review")?
                    .push(json!(
                        "overlapping lifecycle member requires its own whole-group decision"
                    ));
            }
            let reviewed = review_single(
                root,
                config,
                config_identity,
                state,
                other,
                auth,
                false,
                verification,
            )?;
            if !reviewed["blockers"].as_array().is_some_and(Vec::is_empty) {
                selected["blockers"]
                    .as_array_mut()
                    .ok_or("invalid review")?
                    .push(json!(format!(
                        "overlapping registered item protected: {}",
                        other["id"]
                    )));
            }
            related.push(
                json!({"id":other["id"],"token":reviewed["token"],"blockers":reviewed["blockers"]}),
            );
        }
    }
    selected["token"] = json!(hash(
        &json!({"selected":selected["token"],"related":related})
    )?);
    selected["related_items"] = json!(related);
    Ok(selected)
}

fn review_single(
    root: &Path,
    config: &Config,
    config_identity: &str,
    state: &State,
    item: &Value,
    auth: Auth<'_>,
    measure: bool,
    verification: Verification,
) -> Result<Value, String> {
    let path = Path::new(string(item, "path")?);
    let observation = if measure && verification == Verification::Registered {
        match paths::registered_observation(root, path, auth) {
            Ok(value) => value,
            Err(error) => json!({"presence":"unknown","error":error}),
        }
    } else {
        Value::Null
    };
    let measured = if measure && verification == Verification::Registered {
        json!({"identity":item["identity"],"logical_bytes":item["logical_bytes"],"presence":observation["presence"],"remaining":match observation["presence"].as_str() { Some("present")=>Some(true),Some("absent")=>Some(false),_=>None },"error":observation["error"]})
    } else if measure && groups::id(item).is_some() {
        match paths::checked_metadata(root, path, auth) {
            Ok(None) => json!({"presence":"absent","remaining":false}),
            Ok(Some(_)) => match paths::measure(root, path, auth) {
                Ok(mut measured) => {
                    measured["presence"] = json!("present");
                    measured["remaining"] = json!(true);
                    measured
                }
                Err(error) => json!({"presence":"unknown","error":error}),
            },
            Err(error) => json!({"presence":"unknown","error":error}),
        }
    } else if measure {
        paths::measure(root, path, auth)?
    } else {
        Value::Null
    };
    let mut blockers = Vec::new();
    if measured["presence"] == "unknown" {
        blockers.push("target observation unavailable");
    }
    if item["cleanup_status"] == "pending" {
        blockers.push("cleanup attempt pending recovery");
    }
    if item["generated"] != true || item["protection_known"] != true {
        blockers.push("generation or usage protection unconfirmed");
    }
    if item
        .get("retain_reason")
        .and_then(Value::as_str)
        .is_some_and(|s| !s.is_empty())
    {
        blockers.push("retention reason active");
    }
    if !item["references"].as_array().is_some_and(Vec::is_empty) {
        blockers.push("references active or unknown");
    }
    if !config.managed_roots.iter().any(|p| {
        let base = root.join(p);
        paths::within(path, &base) && !paths::within(&base, path)
    }) {
        if config.managed_roots.iter().any(|p| {
            let base = root.join(p);
            paths::within(path, &base) && paths::within(&base, path)
        }) {
            blockers.push("managed root itself is protected; select owned descendants");
        } else {
            blockers.push("outside configured managed roots");
        }
    }
    if paths::reserved(root, path) {
        blockers.push("source, user state or maintenance state protected");
    }
    for protected in &config.protected_paths {
        let p = root.join(protected);
        if paths::within(path, &p) || paths::within(&p, path) {
            blockers.push("configured protection");
        }
    }
    if let Some(source) = item.get("source_path").and_then(Value::as_str) {
        let p = paths::resolve(root, Path::new(source))?;
        if paths::within(path, &p) || paths::within(&p, path) {
            blockers.push("original source overlaps target");
        }
    }
    let mut recovery_state = Value::Null;
    if item["kind"] == "backup"
        && !item.get("provenance").is_some_and(|provenance| {
            provenance["recovery_completed"]
                .as_object()
                .is_some_and(|completion| {
                    completion.get("verified") == Some(&Value::Bool(true))
                        && completion
                            .get("reason")
                            .and_then(Value::as_str)
                            .is_some_and(|s| !s.trim().is_empty())
                        && completion
                            .get("evidence_ref")
                            .and_then(Value::as_str)
                            .is_some_and(|s| !s.trim().is_empty())
                })
        })
    {
        let replacement = item
            .get("provenance")
            .filter(|p| p["recovery_verified"] == true)
            .and_then(|p| p["superseded_by"].as_str())
            .filter(|id| Some(*id) != item["id"].as_str())
            .and_then(|id| state.items.get(id));
        if verification == Verification::Registered {
            blockers.push("backup replacement requires explicit full verification or verified recovery_completed receipt");
        } else if let Some(replacement) = replacement {
            let replacement_path = Path::new(string(replacement, "path")?);
            recovery_state = paths::measure(root, replacement_path, auth)?;
            let retained = valid_references(&replacement["references"])
                && replacement["references"]
                    .as_array()
                    .is_some_and(|references| !references.is_empty())
                || replacement["retain_reason"]
                    .as_str()
                    .is_some_and(|reason| !reason.is_empty());
            if replacement["protection_known"] != true
                || replacement["generated"] != true
                || !retained
                || recovery_state["identity"] != replacement["identity"]
                || paths::within(replacement_path, path)
                || paths::within(path, replacement_path)
            {
                blockers.push("superseding recovery copy is unconfirmed, changed or not retained");
            }
        } else {
            blockers.push("backup has no registered verified superseding recovery reference");
        }
    }
    for (run_id, run) in &state.runs {
        if run["steps"]
            .as_array()
            .is_some_and(|steps| steps.iter().any(producer_active))
        {
            let related = item.get("run_id").and_then(Value::as_str) == Some(run_id.as_str())
                || item
                    .get("provenance")
                    .and_then(|p| p.get("run_id"))
                    .and_then(Value::as_str)
                    == Some(run_id.as_str())
                || run["steps"].as_array().is_some_and(|steps| {
                    steps
                        .iter()
                        .filter(|step| producer_active(step))
                        .any(|step| {
                            step["inputs"].as_array().is_some_and(|inputs| {
                                inputs.iter().any(|input| {
                                    input["path"].as_str().is_some_and(|p| {
                                        paths::within(path, Path::new(p))
                                            || paths::within(Path::new(p), path)
                                    })
                                })
                            })
                        })
                });
            if related {
                blockers.push("active or unresolved related run");
                break;
            }
        }
    }
    let token = hash(
        &json!({"item":item,"verification":verification.name(),"observation":observation,"measurement":measured,"recovery":recovery_state,"runs":state.runs,"config":config_identity}),
    )?;
    Ok(
        json!({"id":item["id"],"path":path,"identity":measured["identity"],"logical_bytes":measured["logical_bytes"],"presence":measured["presence"],"remaining":measured["remaining"],"observation_error":measured["error"],"verification":verification.name(),"root_observation":observation,"observed_at_ms":now_ms()?,"measured_at_ms":if verification == Verification::Registered {item["measured_at_ms"].clone()} else {json!(now_ms()?)},"token":token,"blockers":blockers}),
    )
}

fn prepare_item(root: &Path, item: Value, authorize: Auth<'_>) -> Result<Value, String> {
    prepare_registered_item(root, item, None, authorize)
}

fn prepare_registered_item(
    root: &Path,
    mut item: Value,
    previous: Option<&Value>,
    authorize: Auth<'_>,
) -> Result<Value, String> {
    string(&item, "id")?;
    string(&item, "owner")?;
    string(&item, "kind")?;
    if !item.get("generated").is_some_and(Value::is_boolean)
        || !item.get("protection_known").is_some_and(Value::is_boolean)
    {
        return Err("generated and protection_known must be explicit booleans".into());
    }
    if !item.get("references").is_some_and(valid_references) {
        return Err("references must be an explicit array of nonempty reference strings".into());
    }
    let path = paths::resolve(root, Path::new(string(&item, "path")?))?;
    let absent = if let Some(old) = previous {
        let old_path = Path::new(string(old, "path")?);
        paths::within(old_path, &path)
            && paths::within(&path, old_path)
            && paths::checked_metadata(root, &path, authorize)?.is_none()
    } else {
        false
    };
    let measured = if absent {
        previous
            .expect("absence requires a registered member")
            .clone()
    } else {
        paths::measure(root, &path, authorize)?
    };
    let timestamp = now_ms()?;
    item["registered_at_ms"] = json!(timestamp);
    item["measured_at_ms"] = if absent {
        measured["measured_at_ms"].clone()
    } else {
        json!(timestamp)
    };
    for key in [
        "created_at_ms",
        "version",
        "source_path",
        "provenance",
        "tool",
        "cache_schema",
    ] {
        if item.get(key).is_none() {
            item[key] = if absent {
                measured[key].clone()
            } else {
                Value::Null
            };
        }
    }
    item["path"] = json!(path);
    item["identity"] = measured["identity"].clone();
    item["logical_bytes"] = measured["logical_bytes"].clone();

    if absent && measured["cleanup_status"] == "pending" {
        item["cleanup_status"] = json!("pending");
    } else if let Some(record) = item.as_object_mut() {
        record.remove("cleanup_status");
    }
    item["presence"] = json!(if absent { "absent" } else { "present" });
    item["remaining"] = json!(!absent);
    Ok(item)
}

fn review(
    root: &Path,
    config: &Config,
    config_identity: &str,
    state: &State,
    item: &Value,
    auth: Auth<'_>,
) -> Result<Value, String> {
    if let Some(group) = groups::id(item) {
        let members = groups::batch(
            root,
            config,
            config_identity,
            state,
            group,
            auth,
            Verification::Registered,
        )?
        .initial()?;
        members
            .get(string(item, "id")?)
            .cloned()
            .ok_or("selected lifecycle member is no longer live".into())
    } else {
        review_ungrouped(
            root,
            config,
            config_identity,
            state,
            item,
            auth,
            Verification::Full,
        )
    }
}

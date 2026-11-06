//! Run input observations outside global custody, guarded by the persisted run.
use crate::{
    Auth, Config, State, hash, lock_recovery, now_ms, paths, planning, producer_active, registry,
    reservations, storage, string,
};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

fn check_run_admission(
    root: &Path,
    plan: &Value,
    state: &State,
    exclude: Option<&str>,
    auth: Auth<'_>,
) -> Result<(), String> {
    let reader_paths = plan["steps"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|step| step["inputs"].as_array().into_iter().flatten())
        .map(|input| string(input, "path").map(PathBuf::from))
        .collect::<Result<Vec<_>, _>>()?;
    reservations::check_reader_paths(root, &reader_paths, auth)?;
    for (id, existing) in &state.runs {
        if Some(id.as_str()) == exclude
            || !existing["steps"]
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
                            active["resource"].as_str() == Some(resource) && producer_active(active)
                        })
                    })
                })
            })
        });
        if existing["plan_id"] == plan["plan_id"] || shared_resource {
            return Err("existing unresolved producer owns this plan or resource".into());
        }
    }
    Ok(())
}

/// Publish input/resource custody before traversing payload. An abandoned
/// preparation stays unresolved until the existing explicit recovery boundary.
pub(crate) fn begin_run<'a>(
    root: &Path,
    config: &Config,
    config_identity: &str,
    request: &Value,
    store: &mut storage::Store<'a>,
    auth: Auth<'a>,
    catalog_locks: Vec<registry::CatalogLock<'a>>,
) -> Result<Value, String> {
    let mut preparing = planning::outline(root, config, request, auth)?;
    preparing["config_identity"] = json!(config_identity);
    check_run_admission(root, &preparing, &store.state, None, auth)?;
    check_config(root, config_identity, auth)?;
    if auth.cancelled() {
        return Err("run preparation cancelled before measurement".into());
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let run_id = format!("run-{}-{}-{now}", std::process::id(), store.state.revision);
    preparing["run_id"] = json!(run_id);
    preparing["owner"] = json!(
        request
            .get("owner")
            .and_then(Value::as_str)
            .unwrap_or("model")
    );
    preparing["status"] = json!("unknown");
    preparing["preparation"] = json!(true);
    preparing["executor_pid"] = json!(std::process::id());
    preparing["preparation_fence"] = json!(hash(&(root, &run_id, config_identity))?);
    for step in preparing["steps"]
        .as_array_mut()
        .ok_or("invalid planned steps")?
    {
        step["status"] = json!("unknown");
        step["exit_code"] = Value::Null;
        step["producer_completed"] = json!(false);
    }
    store.state.runs.insert(run_id.clone(), preparing.clone());
    store.save(auth)?;
    drop(catalog_locks);
    store.suspend()?;
    let measured = planning::plan(root, config, request, auth).and_then(|plan| {
        if auth.cancelled() {
            return Err("run preparation cancelled before publication".into());
        }
        Ok(plan)
    });
    // Reconciliation must remain possible after cancellation. Retry acquisition
    // only, with the same bounded budget, never the observation or publication.
    let _catalog_locks = lock_recovery::wait_for_lock(auth.lock_wait.get(), || {
        store.try_resume()?;
        match registry::lock_request(root, request, &store.state, auth) {
            Ok(locks) => Ok(locks),
            Err(error) => {
                store.suspend()?;
                Err(error)
            }
        }
    })?;
    if store.state.runs.get(&run_id) != Some(&preparing) {
        return Err("run changed during preparation; preserving current run state".into());
    }
    let completed = measured.and_then(|mut plan| {
        check_config(root, config_identity, auth)?;
        check_run_admission(root, &plan, &store.state, Some(&run_id), auth)?;
        plan["config_identity"] = json!(config_identity);
        plan["run_id"] = json!(run_id);
        Ok(plan)
    });
    match completed {
        Ok(plan) => {
            let mut run = plan.clone();
            run["owner"] = preparing["owner"].clone();
            run["status"] = json!("unknown");
            for step in run["steps"].as_array_mut().ok_or("invalid planned steps")? {
                step["status"] = json!("unknown");
                step["exit_code"] = Value::Null;
            }
            store.state.runs.insert(run_id, run);
            store.save(auth)?;
            Ok(plan)
        }
        Err(error) => {
            // No command has started: this owner can close its own failed
            // preparation, but cannot turn an externally changed run terminal.
            let run = store.state.runs.get_mut(&run_id).ok_or("unknown run")?;
            run["status"] = json!("failed");
            run["preparation"] = json!(false);
            run["preparation_error"] = json!(error);
            run["execution_started"] = json!(false);
            for step in run["steps"].as_array_mut().ok_or("invalid stored steps")? {
                step["status"] = json!("failed");
                step["exit_code"] = Value::Null;
                step["producer_completed"] = json!(true);
                step["integrity_status"] = json!("invalid");
                step["preparation_error"] = json!(error);
                step["execution_started"] = json!(false);
            }
            store.save(auth)?;
            Err(error)
        }
    }
}

fn check_config(root: &Path, config_identity: &str, auth: Auth<'_>) -> Result<(), String> {
    let config_path = root.join("project-maintenance.json");
    paths::check(root, &config_path, auth)?;
    auth(&config_path, crate::AccessMode::Read)?;
    if hash(&std::fs::read(&config_path).map_err(|error| error.to_string())?)? != config_identity {
        return Err("project config changed during validation".into());
    }
    Ok(())
}

fn observe(
    root: &Path,
    config_identity: &str,
    run: &Value,
    step: &Value,
    auth: Auth<'_>,
) -> Result<(), String> {
    if run["config_identity"] != config_identity {
        return Err("project config changed after planning".into());
    }
    for input in step["inputs"].as_array().ok_or("missing planned inputs")? {
        let path = Path::new(string(input, "path")?);
        let observed = paths::measure(root, path, auth)?;
        if observed["identity"] != input["identity"] {
            return Err(format!("planned input changed: {}", path.display()));
        }
    }
    check_config(root, config_identity, auth)?;
    if step["integrity_status"] == "invalid" {
        return Err("step integrity was already invalidated".into());
    }
    Ok(())
}

pub(crate) fn validate_step<'a>(
    root: &Path,
    config_identity: &str,
    request: &Value,
    store: &mut storage::Store<'a>,
    auth: Auth<'a>,
    catalog_locks: Vec<registry::CatalogLock<'a>>,
) -> Result<Value, String> {
    let run_id = string(request, "run_id")?;
    let step_id = string(request, "step_id")?;
    let phase = string(request, "phase")?;
    if !["before", "after"].contains(&phase) {
        return Err("invalid validation phase".into());
    }
    let snapshot = store.state.runs.get(run_id).ok_or("unknown run")?.clone();
    let step = snapshot["steps"]
        .as_array()
        .ok_or("invalid stored steps")?
        .iter()
        .find(|step| step["step_id"] == step_id)
        .ok_or("unknown step")?;

    // Terminal receipts no longer protect inputs. Publish a separate observation
    // fence without changing the target's terminal producer/receipt state.
    let observation_guard = if producer_active(step) {
        None
    } else {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos();
        let guard_id = format!(
            "run-observation-{}-{}-{now}",
            std::process::id(),
            store.state.revision
        );
        // Guard only input custody: no command argv, receipt or resource claim.
        let guarded_step = json!({
            "step_id":step_id,"inputs":step["inputs"],"status":"unknown",
            "exit_code":null,"producer_completed":false
        });
        let guard = json!({
            "run_id":guard_id,"plan_id":guard_id,"owner":snapshot["owner"],
            "status":"unknown","preparation":true,"observation_guard":true,
            "observation_target_run_id":run_id,"observation_target_step_id":step_id,
            "executor_pid":std::process::id(),
            "preparation_fence":hash(&(root, &guard_id, config_identity))?,
            "config_identity":config_identity,"steps":[guarded_step]
        });
        store.state.runs.insert(guard_id.clone(), guard.clone());
        store.save(auth)?;
        Some((guard_id, guard))
    };
    drop(catalog_locks);
    store.suspend()?;
    let measured = observe(root, config_identity, &snapshot, step, auth);
    let _catalog_locks =
        lock_recovery::wait_for_lock_cancel(auth.lock_wait.get(), &|| auth.cancelled(), || {
            store.try_resume()?;
            // Reuse the sorted source-lock owner and retry the whole cohort.
            match registry::lock_request(root, request, &store.state, auth) {
                Ok(locks) => Ok(locks),
                Err(error) => {
                    store.suspend()?;
                    Err(error)
                }
            }
        })?;
    // No local state changed during observation. Resume refreshes unrelated
    // commits; compare the complete run to cover inputs, producer and receipts.
    if store.state.runs.get(run_id) != Some(&snapshot) {
        return Err("run changed during input validation; retry with current run state".into());
    }
    if observation_guard
        .as_ref()
        .is_some_and(|(id, guard)| store.state.runs.get(id) != Some(guard))
    {
        return Err(
            "observation guard changed during input validation; preserving current run state"
                .into(),
        );
    }
    // Always reobserve config bytes in the commit epoch. Preserve an earlier
    // failed measurement even if configuration or payload has since recovered.
    let fresh_config = check_config(root, config_identity, auth);
    let check = measured.and(fresh_config);
    let result = match check {
        Ok(()) => {
            json!({"run_id":run_id,"step_id":step_id,"phase":phase,"valid":true,"checked_at_ms":now_ms()?})
        }
        Err(reason) => {
            json!({"run_id":run_id,"step_id":step_id,"phase":phase,"valid":false,"reason":reason,"checked_at_ms":now_ms()?})
        }
    };
    let run = store.state.runs.get_mut(run_id).ok_or("unknown run")?;
    let step = run["steps"]
        .as_array_mut()
        .ok_or("invalid stored steps")?
        .iter_mut()
        .find(|step| step["step_id"] == step_id)
        .ok_or("unknown step")?;
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
    if let Some((guard_id, _)) = observation_guard {
        // This owner observed completion and still owns the exact durable fence.
        // Failed acquisition, changed records or process loss leave it protected.
        store.state.runs.remove(&guard_id);
    }
    store.save(auth)?;
    Ok(result)
}

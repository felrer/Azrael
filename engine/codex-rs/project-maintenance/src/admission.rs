//! Bind scheduler scopes to the same registered identities used by dispatch.
//! Admission is not deletion approval: the operation still validates its tokens.
use crate::{AccessMode, Auth, Context, State, coordination, paths, string};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

fn cancellation_observation(result: Result<bool, String>) -> Result<Option<bool>, String> {
    match result {
        Ok(cancelled) => Ok(Some(cancelled)),
        Err(error)
            if crate::lock_recovery::error_response(&error)["code"] == "maintenance_busy" =>
        {
            // Another short metadata transaction is not evidence of cancellation.
            Ok(None)
        }
        Err(error) => Err(error),
    }
}

// Control state is runtime-owned, like preferences. Payload access always
// delegates to the caller's original filesystem policy.
pub(crate) fn with_domain<T>(
    project: &Path,
    auth: Auth<'_>,
    create: bool,
    operation: impl FnOnce(&Path, Auth<'_>) -> Result<T, String>,
) -> Result<T, String> {
    let Some(home) = &auth.coordination_home else {
        return operation(project, auth);
    };
    let domain = home.join("maintenance-coordination");
    crate::lock_recovery::final_plain_path(home)?;
    match std::fs::symlink_metadata(&domain) {
        Ok(metadata) => {
            crate::lock_recovery::final_plain_path(&domain)?;
            if !metadata.is_dir() {
                return Err("coordination state must be a directory".into());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && create => {
            match std::fs::create_dir(&domain) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error.to_string()),
            }
            crate::lock_recovery::final_plain_path(&domain)?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    let authorize = |path: &Path, access: AccessMode| {
        if paths::within(path, &domain)
            || (access == AccessMode::Read && paths::within(&domain, path))
        {
            Ok(())
        } else {
            (auth.authorize)(path, access)
        }
    };
    let cancelled = || auth.cancelled();
    let context = Context::with_cancellation(&authorize, &cancelled);
    context.lock_wait.set(auth.lock_wait.get());
    operation(&domain, &context)
}

pub(crate) fn control(root: &Path, request: &Value, auth: Auth<'_>) -> Result<Value, String> {
    let mut request = request.clone();
    request["_coordination_project"] = json!(root);
    with_domain(root, auth, true, |domain, context| {
        context.lock_wait.set(Duration::from_millis(600_000));
        coordination::control(domain, &request, context)
    })
}

pub(crate) fn check_external(
    root: &Path,
    scopes: &[coordination::Scope],
    auth: Auth<'_>,
) -> Result<(), String> {
    with_domain(root, auth, false, |domain, context| {
        coordination::check_external(domain, scopes, context)
    })
}

pub(crate) fn has_queue(root: &Path, auth: Auth<'_>) -> Result<bool, String> {
    with_domain(root, auth, false, |domain, context| {
        let path = domain.join("artifacts/maintenance/requests");
        paths::checked_metadata(domain, &path, context).map(|value| value.is_some())
    })
}

pub(crate) fn supported(request: &Value) -> bool {
    matches!(
        request["operation"].as_str(),
        Some("register" | "apply" | "begin_run")
    )
}

fn group_scope(root: &Path, id: &str) -> Result<PathBuf, String> {
    Ok(root
        .join("artifacts/maintenance/requests/group-scopes")
        .join(crate::hash(&id)?))
}

fn add(scopes: &mut Vec<coordination::Scope>, path: PathBuf, exclusive: bool) {
    if let Some(scope) = scopes.iter_mut().find(|scope| scope.path == path) {
        scope.exclusive |= exclusive;
    } else {
        scopes.push(coordination::Scope { path, exclusive });
    }
}

fn item_scopes(
    root: &Path,
    item: &Value,
    exclusive: bool,
    scopes: &mut Vec<coordination::Scope>,
    auth: Auth<'_>,
) -> Result<(), String> {
    let path = paths::resolve(root, Path::new(string(item, "path")?))?;
    paths::check(root, &path, auth)?;
    // Missing payload needs metadata reconciliation, not deletion permission.
    let present = paths::checked_metadata(root, &path, auth)?.is_some();
    auth(
        &path,
        if exclusive && present {
            AccessMode::Write
        } else {
            AccessMode::Read
        },
    )?;
    add(scopes, path, exclusive);
    if let Some(group) = crate::groups::id(item) {
        add(scopes, group_scope(root, group)?, exclusive);
    }
    Ok(())
}

/// Source scopes are cheap metadata, never payload hashes. Recomputed under
/// maintenance custody before execution so admission cannot authorize scope drift.
pub(crate) fn scopes(
    root: &Path,
    request: &Value,
    state: &State,
    auth: Auth<'_>,
) -> Result<Vec<coordination::Scope>, String> {
    let mut scopes = Vec::new();
    match string(request, "operation")? {
        "apply" => {
            let mut groups = std::collections::BTreeSet::new();
            let choices = request["decisions"].as_array().ok_or("missing decisions")?;
            if choices.is_empty() || choices.len() > 200 {
                return Err("apply requires 1..200 explicit decisions".into());
            }
            for choice in choices {
                string(choice, "token")?;
                string(choice, "reason")?;
                let id = string(choice, "id")?;
                let item = state
                    .items
                    .get(id)
                    .ok_or_else(|| format!("unknown item: {id}"))?;
                item_scopes(root, item, true, &mut scopes, auth)?;
                if let Some(group) = crate::groups::id(item) {
                    if !groups.insert(group) {
                        continue;
                    }
                    for sibling in state
                        .items
                        .values()
                        .filter(|item| crate::groups::id(item) == Some(group))
                    {
                        item_scopes(root, sibling, true, &mut scopes, auth)?;
                    }
                }
            }
        }
        "register" => {
            if let Some(item) = request.get("item") {
                item_scopes(root, item, true, &mut scopes, auth)?;
                if let Some(old) = state.items.get(string(item, "id")?) {
                    item_scopes(root, old, true, &mut scopes, auth)?;
                }
            }
            let group = request
                .get("group")
                .or_else(|| request.get("refresh_group"));
            if let Some(group) = group {
                let id = string(group, "id")?;
                add(&mut scopes, group_scope(root, id)?, true);
                for old in state
                    .items
                    .values()
                    .filter(|item| crate::groups::id(item) == Some(id))
                {
                    item_scopes(root, old, true, &mut scopes, auth)?;
                }
                for item in group["members"].as_array().into_iter().flatten() {
                    item_scopes(root, item, true, &mut scopes, auth)?;
                }
                // Native inventory reference strings are protection labels,
                // not authority to acquire another producer's queue scope.
                // Producer-ledger references are admitted at the lease writer.
            }
        }
        "begin_run" => {
            let filename = root.join("project-maintenance.json");
            paths::check(root, &filename, auth)?;
            let config: crate::Config =
                serde_json::from_slice(&std::fs::read(&filename).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            let outline = crate::planning::outline(root, &config, request, auth)?;
            for step in outline["steps"].as_array().into_iter().flatten() {
                for input in step["inputs"].as_array().into_iter().flatten() {
                    let path = PathBuf::from(string(input, "path")?);
                    paths::check(root, &path, auth)?;
                    auth(&path, AccessMode::Read)?;
                    add(&mut scopes, path, false);
                }
                if let Some(resource) = step["resource"].as_str() {
                    add(
                        &mut scopes,
                        root.join("artifacts/maintenance/requests/resource-scopes")
                            .join(crate::hash(&resource)?),
                        true,
                    );
                }
            }
            // Input-free plans still have a stable coordination identity.
            if scopes.is_empty() {
                add(
                    &mut scopes,
                    root.join("artifacts/maintenance/requests/plan-scopes")
                        .join(crate::hash(&outline)?),
                    true,
                );
            }
        }
        _ => return Err("operation does not support request coordination".into()),
    }
    scopes.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(scopes)
}

pub(crate) fn run(root: &Path, request: &Value, auth: Auth<'_>) -> Result<Value, String> {
    let snapshot = crate::storage::Store::open(root, auth, false).map_err(String::from)?;
    for item in snapshot.state.items.values() {
        paths::configure_junctions(root, item, false, auth)?;
    }
    let selected = scopes(root, request, &snapshot.state, auth)?;
    if selected.is_empty() {
        return Err("request has no admission scopes".into());
    }
    drop(snapshot);
    let config_path = root.join("project-maintenance.json");
    paths::check(root, &config_path, auth)?;
    let config_identity = crate::hash(&std::fs::read(&config_path).map_err(|e| e.to_string())?)?;
    let session = string(&request["coordination"], "session_id")?;
    let request_id = string(&request["coordination"], "request_id")?;
    let mut scheduling_request = request.clone();
    scheduling_request["_coordination_project"] = json!(root);
    scheduling_request["_coordination_config"] = json!(config_identity);
    if request["operation"] == "begin_run" {
        // A second host must not execute commands from the first host's run.
        // Only repeat observations of this caller's exact request may join.
        scheduling_request["producer_admission_identity"] = json!([session, request_id]);
    }
    with_domain(root, auth, true, |domain, queue_auth| {
        queue_auth.lock_wait.set(Duration::from_millis(600_000));
        coordination::run(domain, &scheduling_request, &selected, queue_auth, || {
            // Cancellation bookkeeping must still acquire custody after the
            // original callback becomes true; never recurse through itself.
            let bookkeeping = Context::new(queue_auth.authorize);
            bookkeeping.lock_wait.set(Duration::from_millis(200));
            let last_check = std::cell::Cell::new(None::<Instant>);
            let stopped = std::cell::Cell::new(false);
            let caller_cancelled = std::cell::Cell::new(false);
            let observation_error = std::cell::RefCell::new(None::<String>);
            let cancelled = || {
                if stopped.get() {
                    return true;
                }
                if last_check
                    .get()
                    .is_some_and(|last| last.elapsed() < Duration::from_millis(100))
                {
                    return false;
                }
                last_check.set(Some(Instant::now()));
                if auth.cancelled() && !caller_cancelled.get() {
                    let cancel = json!({"operation":"request_cancel", "coordination":{"session_id":session,"request_id":request_id,"wait_ms":200}, "_coordination_project":root});
                    bookkeeping.lock_wait.set(Duration::from_millis(200));
                    match coordination::control(domain, &cancel, &bookkeeping) {
                        Ok(_) => caller_cancelled.set(true),
                        Err(error)
                            if crate::lock_recovery::error_response(&error)["code"]
                                == "maintenance_busy" =>
                        {
                            // Retry recording at the next boundary. A failed
                            // attempt must not cancel the other subscribers.
                        }
                        Err(error) => {
                            *observation_error.borrow_mut() = Some(error);
                            stopped.set(true);
                            return true;
                        }
                    }
                }
                // Polling from a payload/maintenance callback must never wait
                // behind the queue mutex it only needs to observe.
                bookkeeping.lock_wait.set(Duration::ZERO);
                match cancellation_observation(coordination::cancelled(
                    domain,
                    session,
                    request_id,
                    &bookkeeping,
                )) {
                    Ok(Some(true)) => stopped.set(true),
                    Ok(Some(false) | None) => {}
                    Err(error) => {
                        *observation_error.borrow_mut() = Some(error);
                        stopped.set(true);
                    }
                }
                stopped.get()
            };
            let mut context = Context::with_cancellation(auth.authorize, &cancelled);
            context.preference_revision = auth.preference_revision;
            context.admitted_scopes = Some(selected.clone());
            context.admission_config = Some(config_identity.clone());
            context.coordination_home = auth.coordination_home.clone();
            let result = crate::dispatch_inner(root, request.clone(), &context);
            match (result, observation_error.into_inner()) {
                (Ok(mut result), Some(error)) => {
                    result["request_observation_error"] = json!(error);
                    Ok(result)
                }
                (Err(error), Some(observation)) => Err(format!(
                    "{error}; request observation failed: {observation}"
                )),
                (result, None) => result,
            }
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Replacing a fallible poll with unwrap_or(true) caused real 8-process
    // requests to cancel each other. Preserve contention as an unknown sample.
    #[test]
    fn queue_contention_is_not_a_cancellation_sample() {
        let busy = json!({"code":"maintenance_busy","retryable":true,"error":"held","lock_path":"queue.lock","owner":null}).to_string();
        assert_eq!(cancellation_observation(Err(busy)).unwrap(), None);
        assert_eq!(cancellation_observation(Ok(false)).unwrap(), Some(false));
        assert_eq!(cancellation_observation(Ok(true)).unwrap(), Some(true));
        assert_eq!(
            cancellation_observation(Err("read denied".into())),
            Err("read denied".into())
        );
    }
}

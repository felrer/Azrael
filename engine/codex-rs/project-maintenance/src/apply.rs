//! A durable intent precedes each destructive attempt. Each result is committed
//! before advancing to another item; a crash leaves an honest pending intent.
use crate::{
    AccessMode, Auth, Config, State, Verification, groups, hash, now_ms, paths, review,
    storage::Store, string,
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

pub(crate) fn apply(
    root: &Path,
    config: &Config,
    config_identity: &str,
    request: &Value,
    store: &mut Store,
    auth: Auth<'_>,
) -> Result<Value, String> {
    let verification = Verification::requested(request)?;
    let choices = request["decisions"].as_array().ok_or("missing decisions")?;
    if choices.is_empty() || choices.len() > 200 {
        return Err("apply requires 1..200 explicit decisions".into());
    }
    let mut unique = BTreeSet::new();
    // A malformed later choice must never follow an earlier destructive action.
    for choice in choices {
        let id = string(choice, "id")?;
        string(choice, "token")?;
        string(choice, "reason")?;
        if !unique.insert(id) {
            return Err("duplicate decision id".into());
        }
        match string(choice, "decision")? {
            "delete" => {}
            "defer" => {
                string(choice, "revisit_condition")?;
            }
            _ => return Err("invalid decision".into()),
        }
        let item = store
            .state
            .items
            .get(id)
            .ok_or_else(|| format!("unknown item: {id}"))?;
        for field in ["id", "path", "kind", "owner"] {
            string(item, field)?;
        }
        if item["identity"].as_str().is_none_or(str::is_empty)
            && !(item["identity"].is_null()
                && item["presence"] == "absent"
                && item["remaining"] == false
                && item["logical_bytes"] == 0
                && groups::id(item).is_some())
        {
            return Err(format!("invalid registered identity: {id}"));
        }
        if item["id"] != id
            || !item["generated"].is_boolean()
            || !item["protection_known"].is_boolean()
            || item["logical_bytes"].as_u64().is_none()
            || !item["references"].as_array().is_some_and(|refs| {
                refs.iter().all(|reference| {
                    reference
                        .as_str()
                        .is_some_and(|text| !text.trim().is_empty())
                })
            })
        {
            return Err(format!("invalid registered item: {id}"));
        }
        if verification == Some(Verification::Registered) && groups::id(item).is_none() {
            return Err("registered verification requires lifecycle grouped items".into());
        }
        paths::resolve(root, Path::new(string(item, "path")?))?;
        if !item["source_path"].is_null() {
            paths::resolve(root, Path::new(string(item, "source_path")?))?;
        }
    }
    let by_id = choices
        .iter()
        .map(|choice| (choice["id"].as_str().unwrap_or_default(), choice))
        .collect::<BTreeMap<_, _>>();
    let mut batches = BTreeMap::new();
    let mut stopped_groups = BTreeMap::<String, String>::new();
    // Validate every selected group's entire live cohort before any item changes.
    for choice in choices {
        let item = &store.state.items[string(choice, "id")?];
        if let Some(group_id) = groups::id(item) {
            if batches.contains_key(group_id) {
                continue;
            }
            let batch = groups::batch(
                root,
                config,
                config_identity,
                &store.state,
                group_id,
                auth,
                verification.unwrap_or(Verification::Registered),
            )?;
            let initial = batch.initial()?;
            if !batch.members.contains_key(string(choice, "id")?) {
                return Err("selected grouped item is not live in its membership".into());
            }
            for member_id in batch.members.keys() {
                let member_choice = by_id
                    .get(member_id.as_str())
                    .ok_or("all live lifecycle members require explicit decisions")?;
                if member_choice["decision"] != choice["decision"] {
                    return Err("all lifecycle members must share delete or defer fate".into());
                }
                if (choice["decision"] == "delete" || auth.nested_retirement.borrow().is_some())
                    && (initial[member_id]["token"] != member_choice["token"]
                        || !initial[member_id]["blockers"]
                            .as_array()
                            .is_some_and(Vec::is_empty))
                {
                    stopped_groups.insert(
                        group_id.to_owned(),
                        "whole lifecycle group review is stale, incomplete or protected".into(),
                    );
                }
            }
            batches.insert(group_id.to_owned(), batch);
        }
    }
    // The enclosing group is deferred, but must pass the same complete fresh
    // review as the child before the child may change its payload.
    if auth.nested_retirement.borrow().is_some() && !stopped_groups.is_empty() {
        for group in batches.keys() {
            stopped_groups.insert(
                group.clone(),
                "nested retirement review is stale or protected".into(),
            );
        }
    }
    let mut ordered = Vec::new();
    let mut approved_entries = BTreeMap::new();
    // This precedes every destructive group member, so a later shared file
    // cannot be discovered only after an earlier member was normalized.
    for (group_id, batch) in &batches {
        if stopped_groups.contains_key(group_id)
            || !batch
                .members
                .keys()
                .any(|id| by_id[id.as_str()]["decision"] == "delete")
        {
            continue;
        }
        for item in batch.members.values() {
            let id = string(item, "id")?;
            let prepared = (|| -> Result<Vec<PathBuf>, String> {
                let path = Path::new(string(item, "path")?);
                let entries = if paths::checked_metadata(root, path, auth)?.is_none() {
                    Vec::new()
                } else {
                    paths::entries(root, path, auth)?
                };
                paths::normalization_preflight(&entries)?;
                Ok(entries)
            })();
            match prepared {
                Ok(entries) => {
                    approved_entries.insert(id.to_owned(), entries);
                }
                Err(error) => {
                    stopped_groups.insert(group_id.clone(), error);
                    break;
                }
            }
        }
    }
    let mut ordered_groups = BTreeSet::new();
    for choice in choices {
        let item = &store.state.items[string(choice, "id")?];
        if let Some(group_id) = groups::id(item) {
            if !ordered_groups.insert(group_id.to_owned()) {
                continue;
            }
            let mut members = batches[group_id].members.iter().collect::<Vec<_>>();
            members.sort_by_key(|(id, item)| {
                (
                    (matches!(item["lifecycle_role"].as_str(), Some("log" | "evidence"))) as u8,
                    (*id).clone(),
                )
            });
            for (id, _) in members {
                ordered.push(*by_id.get(id.as_str()).ok_or("missing lifecycle decision")?);
            }
        } else {
            ordered.push(choice);
        }
    }
    if let Some(nested) = auth.nested_retirement.borrow().as_ref() {
        ordered.sort_by_key(|choice| choice["id"] == nested.parent);
    }
    let nested_parent_group = auth
        .nested_retirement
        .borrow()
        .as_ref()
        .and_then(|nested| groups::id(&store.state.items[&nested.parent]).map(str::to_owned));
    let mut results = Vec::new();
    for choice in ordered {
        let id = string(choice, "id")?;
        let item = store.state.items[id].clone();
        let path = Path::new(string(&item, "path")?);
        let group_id = groups::id(&item).map(str::to_owned);
        let mut outcome = choice.clone();
        if auth.nested_retirement.borrow().is_some() {
            outcome["retire_nested_member"] =
                serde_json::to_value(&*auth.nested_retirement.borrow())
                    .map_err(|e| e.to_string())?;
            outcome["nested_evidence_identity"] =
                json!(crate::nested_retirement::evidence_identity(root, auth)?);
        }
        if crate::retirement::selected(auth, &item) {
            outcome["retire_managed_roots"] = serde_json::to_value(&*auth.retirement.borrow())
                .map_err(|error| error.to_string())?;
            outcome["retirement_evidence_identity"] = json!(
                auth.retirement
                    .borrow()
                    .as_ref()
                    .map(|retirement| &retirement.evidence_identity)
            );
        }
        if let Some(group) = &group_id {
            outcome["lifecycle_group_id"] = json!(group);
        }
        let mut destructive = false;
        let entries = if let Some(reason) = group_id
            .as_ref()
            .and_then(|group| stopped_groups.get(group))
        {
            outcome["status"] = json!("blocked");
            outcome["error"] = json!(reason);
            outcome["attempted"] = json!(false);
            None
        } else if choice["decision"] == "delete" {
            match safe_entries(
                root,
                config,
                config_identity,
                &store.state,
                &item,
                choice,
                auth,
                group_id.as_ref().and_then(|group| batches.get(group)),
                approved_entries.get(id).map(Vec::as_slice),
                nested_parent_group
                    .as_ref()
                    .and_then(|group| batches.get(group)),
            ) {
                Ok(entries) if entries.is_empty() => {
                    outcome["status"] = json!("deleted");
                    outcome["attempted"] = json!(false);
                    outcome["remaining"] = json!(false);
                    None
                }
                Ok(entries) => {
                    destructive = true;
                    Some(entries)
                }
                Err(error) => {
                    outcome["status"] = json!("blocked");
                    outcome["error"] = json!(error);
                    None
                }
            }
        } else {
            outcome["status"] = json!("deferred");
            None
        };
        let index = store.state.decisions.len();
        let mut persisted_group = None;
        if destructive {
            outcome["attempt_id"] = json!(format!(
                "attempt-{}-{}-{}",
                std::process::id(),
                store.state.revision,
                now_ms()?
            ));
            outcome["status"] = json!("pending");
            outcome["remaining"] = Value::Null;
            record(&mut store.state, index, &outcome);
            if let Err(error) = store.save(auth) {
                outcome["persistence_error"] = json!(error);
                results.push(outcome);
                return Ok(
                    json!({"results":results,"aborted":true,"reason":"intent could not be persisted; deletion was not attempted"}),
                );
            }
            // The intent save can trigger external policy/state changes. Validate
            // again against the model's original token before any attributes move.
            match safe_entries(
                root,
                config,
                config_identity,
                &store.state,
                &item,
                choice,
                auth,
                group_id.as_ref().and_then(|group| batches.get(group)),
                if group_id
                    .as_ref()
                    .and_then(|group| batches.get(group))
                    .is_some_and(|batch| batch.verification == Verification::Registered)
                {
                    entries.as_deref()
                } else {
                    None
                },
                nested_parent_group
                    .as_ref()
                    .and_then(|group| batches.get(group)),
            ) {
                Err(error) => {
                    outcome["status"] = json!("blocked");
                    outcome["error"] = json!(error);
                }
                Ok(fresh) => {
                    if Some(&fresh) != entries.as_ref() {
                        outcome["status"] = json!("blocked");
                        outcome["error"] = json!("authorized descendant set changed");
                    } else {
                        match paths::delete_verified(root, path, &fresh, auth) {
                            Ok(report) => {
                                outcome["status"] = report["status"].clone();
                                outcome["remaining"] = report["remaining"].clone();
                                outcome["deletion"] = report;
                            }
                            Err(error) => {
                                outcome["status"] = json!("failed");
                                outcome["remaining"] = Value::Null;
                                outcome["error"] = json!(error);
                            }
                        }
                    }
                }
            }
            if outcome["status"] == "deleted" && outcome["remaining"] == false {
                if let Some(batch) = group_id.as_ref().and_then(|group| batches.get_mut(group)) {
                    batch.completed.insert(id.to_owned());
                }
            }
            group_outcome(
                &mut store.state,
                &batches,
                &mut stopped_groups,
                group_id.as_deref(),
                &mut outcome,
                destructive,
            );
            // Persist the actual deletion result before any subsequent read or
            // authorization can fail. A denied result write returns the observed
            // outcome while its durable intent remains pending for recovery.
            if let Some(nested) = auth.nested_retirement.borrow().as_ref() {
                store
                    .state
                    .items
                    .get_mut(&nested.parent)
                    .ok_or("nested parent disappeared")?["nested_retirement_requires_registration"] =
                    json!(true);
            }
            record(&mut store.state, index, &outcome);
            if let Err(error) = store.save(auth) {
                outcome["persistence_error"] = json!(error);
                results.push(outcome);
                return Ok(
                    json!({"results":results,"aborted":true,"reason":"result persistence failed; durable intent may remain pending"}),
                );
            }
            persisted_group = group_id.as_ref().map(|id| store.state.groups[id].clone());
        }
        let observation = (|| -> Result<bool, String> {
            paths::check(root, path, auth)?;
            match std::fs::symlink_metadata(path) {
                Ok(_) => Ok(true),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
                Err(error) => Err(error.to_string()),
            }
        })();
        match observation {
            Ok(remaining) => outcome["remaining"] = json!(remaining),
            Err(error) => {
                outcome["remaining"] = Value::Null;
                outcome["observation_error"] = json!(error);
            }
        }
        if !destructive && outcome["status"] == "deleted" {
            if outcome["remaining"] == false {
                if let Some(batch) = group_id.as_ref().and_then(|group| batches.get_mut(group)) {
                    batch.completed.insert(id.to_owned());
                }
            } else {
                outcome["status"] = json!("blocked");
                outcome["error"] = json!("previously absent target reappeared or is unavailable");
            }
        }
        group_outcome(
            &mut store.state,
            &batches,
            &mut stopped_groups,
            group_id.as_deref(),
            &mut outcome,
            destructive,
        );
        // The destructive receipt is already durable. Only a changed final
        // observation or group state needs another commit; errors change the
        // outcome too and must never be discarded with this redundant write.
        if !destructive
            || store.state.decisions[index] != outcome
            || group_id.as_ref().map(|id| &store.state.groups[id]) != persisted_group.as_ref()
        {
            record(&mut store.state, index, &outcome);
            if let Err(error) = store.save(auth) {
                outcome["persistence_error"] = json!(error);
                results.push(outcome);
                return Ok(
                    json!({"results":results,"aborted":true,"reason":"observation persistence failed; prior destructive result remains recorded"}),
                );
            }
        }
        results.push(outcome);
    }
    let group_results = batches
        .keys()
        .map(|id| json!({"id":id,"status":store.state.groups[id]["cleanup_status"]}))
        .collect::<Vec<_>>();
    Ok(json!({"results":results,"groups":group_results,"aborted":false}))
}

fn group_outcome(
    state: &mut State,
    batches: &BTreeMap<String, groups::Batch>,
    stopped: &mut BTreeMap<String, String>,
    group_id: Option<&str>,
    outcome: &mut Value,
    attempted: bool,
) {
    let Some(id) = group_id else {
        return;
    };
    let batch = &batches[id];
    let status = if outcome["decision"] == "defer" {
        "deferred"
    } else if outcome["status"] == "deleted" {
        if batch.completed.len() == batch.members.len() {
            "deleted"
        } else {
            "deleting"
        }
    } else {
        stopped.entry(id.to_owned()).or_insert_with(|| {
            "earlier lifecycle member did not delete; remaining evidence retained".into()
        });
        if !batch.completed.is_empty()
            || (attempted && outcome["status"] == "failed")
            || state.groups[id]["cleanup_status"] == "partial"
        {
            "partial"
        } else {
            "blocked"
        }
    };
    state.groups.get_mut(id).expect("validated lifecycle group")["cleanup_status"] = json!(status);
    outcome["group_status"] = json!(status);
}

fn record(state: &mut State, index: usize, outcome: &Value) {
    if index == state.decisions.len() {
        state.decisions.push(outcome.clone());
    } else {
        state.decisions[index] = outcome.clone();
    }
    if let Some(item) = outcome["id"]
        .as_str()
        .and_then(|id| state.items.get_mut(id))
    {
        // A new decision is not recovery evidence for an earlier unresolved
        // attempt. Keep that protection when no terminal deletion result exists.
        if item["cleanup_status"] != "pending"
            || outcome.get("attempt_id").is_some()
            || !matches!(outcome["status"].as_str(), Some("blocked" | "deferred"))
        {
            item["cleanup_status"] = outcome["status"].clone();
        }
        item["remaining"] = outcome["remaining"].clone();
        if outcome["status"] == "deleted" && outcome["remaining"] == false {
            item["logical_bytes"] = json!(0);
        }
    }
}
fn safe_entries(
    root: &Path,
    config: &Config,
    config_identity: &str,
    state: &State,
    item: &Value,
    choice: &Value,
    auth: Auth<'_>,
    batch: Option<&groups::Batch>,
    approved: Option<&[PathBuf]>,
    enclosing: Option<&groups::Batch>,
) -> Result<Vec<PathBuf>, String> {
    let observe = || -> Result<Value, String> {
        if let Some(enclosing) = enclosing {
            enclosing.unchanged_controls(root, state, auth)?;
        }
        if let Some(batch) = batch {
            batch
                .current(root, config, config_identity, state, auth)?
                .remove(string(item, "id")?)
                .ok_or("missing lifecycle review".into())
        } else {
            review(root, config, config_identity, state, item, auth)
        }
    };
    let path = Path::new(string(item, "path")?);
    let entries = if let Some(approved) = approved {
        approved.to_vec()
    } else if batch.is_some() && paths::checked_metadata(root, path, auth)?.is_none() {
        Vec::new()
    } else {
        paths::entries(root, path, auth)?
    };
    for entry in &entries {
        auth(entry, AccessMode::Write)?;
    }
    if !entries.is_empty() {
        auth(path.parent().ok_or("missing parent")?, AccessMode::Write)?;
    }
    // Observe after every write authorization: callbacks may change either the
    // target or another group member. Compare directly with the model's review,
    // retaining a fresh observation on both sides of the durable intent save.
    let latest = observe()?;
    if latest["token"] != choice["token"] {
        return Err("stale review token after authorization".into());
    }
    if !latest["blockers"].as_array().is_some_and(Vec::is_empty) {
        return Err(format!("protected: {}", latest["blockers"]));
    }
    let config_path = root.join("project-maintenance.json");
    paths::check(root, &config_path, auth)?;
    if hash(&std::fs::read(config_path).map_err(|e| e.to_string())?)? != config_identity {
        return Err("config changed during review".into());
    }
    Ok(entries)
}

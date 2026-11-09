//! Explicit aggregation of successful terminal decisions. Ownership tombstones
//! remain intact: this operation never grants path authority or removes payload.
use crate::{Auth, Config, State, Verification, groups, hash, paths, reservations, string};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

struct Candidate {
    id: String,
    indices: Vec<usize>,
    summary: Value,
}
struct Prepared {
    result: Value,
    candidates: Vec<Candidate>,
}

fn selection(request: &Value) -> Result<Vec<String>, String> {
    let ids = request["group_ids"].as_array().ok_or("missing group_ids")?;
    if ids.is_empty() || ids.len() > 200 {
        return Err("group_ids requires 1..200 unique group IDs".into());
    }
    let mut selected = BTreeSet::new();
    for id in ids {
        let id = id
            .as_str()
            .filter(|id| !id.trim().is_empty())
            .ok_or("invalid group ID")?;
        if !selected.insert(id.to_owned()) {
            return Err("duplicate group ID".into());
        }
    }
    Ok(selected.into_iter().collect())
}

// Compare JSON values and path components, never serialized byte substrings.
// Unknown nested reference/receipt shapes that mention a selected identity are
// deliberately considered related; they cannot silently lose their history.
fn related(value: &Value, ids: &BTreeSet<String>, targets: &[PathBuf], root: &Path) -> bool {
    match value {
        Value::String(text) => {
            ids.contains(text) || {
                let path = Path::new(text);
                path.is_absolute()
                    && targets
                        .iter()
                        .any(|target| paths::within(path, target) || paths::within(target, path))
            }
        }
        Value::Array(values) => values
            .iter()
            .any(|value| related(value, ids, targets, root)),
        Value::Object(values) => values.iter().any(|(key, value)| {
            if matches!(key.as_str(), "path" | "source_path" | "membership_source") {
                if let Some(text) = value.as_str() {
                    return paths::resolve(root, Path::new(text)).map_or(true, |path| {
                        targets.iter().any(|target| {
                            paths::within(&path, target) || paths::within(target, &path)
                        })
                    });
                }
            }
            related(value, ids, targets, root)
        }),
        _ => false,
    }
}

fn successful(row: &Value, group: &str, members: &BTreeMap<String, Value>) -> bool {
    let known = [
        "id",
        "decision",
        "token",
        "reason",
        "decision_id",
        "lifecycle_group_id",
        "status",
        "group_status",
        "remaining",
        "attempted",
        "attempt_id",
        "deletion",
        "error",
        "observation_error",
        "persistence_error",
        "signal",
        "verification",
    ];
    if row
        .as_object()
        .is_none_or(|object| object.keys().any(|key| !known.contains(&key.as_str())))
    {
        return false;
    }
    let deletion = match row.get("deletion") {
        None => row["attempted"] == false && row.get("attempt_id").is_none(),
        Some(report) => {
            let known_report = [
                "status",
                "remaining",
                "error",
                "observation_error",
                "persistence_error",
                "signal",
                "attributes",
                "attributes_summary",
                "physical_bytes_reclaimed",
                "removed_entries",
                "removed_files",
                "removed_directories",
                "removed_links",
                "deletion_scope",
            ];
            report.as_object().is_some_and(|object| {
                object
                    .keys()
                    .all(|key| known_report.contains(&key.as_str()))
            }) && report["status"] == "deleted"
                && report["remaining"] == false
                && ["signal", "error", "observation_error", "persistence_error"]
                    .iter()
                    .all(|key| report.get(*key).is_none_or(Value::is_null))
                && row["attempt_id"].as_str().is_some_and(|id| !id.is_empty())
        }
    };
    row["lifecycle_group_id"] == group
        && row["id"]
            .as_str()
            .is_some_and(|id| members.contains_key(id))
        && row["decision"] == "delete"
        && row["status"] == "deleted"
        && row["group_status"] == "deleted"
        && row["remaining"] == false
        && deletion
        && ["signal", "error", "observation_error", "persistence_error"]
            .iter()
            .all(|key| row.get(*key).is_none_or(Value::is_null))
        && row["token"].as_str().is_some_and(|id| !id.is_empty())
}

fn prepare(
    root: &Path,
    config: &Config,
    config_identity: &str,
    state: &State,
    request: &Value,
    auth: Auth<'_>,
) -> Result<Prepared, String> {
    let root_identity = paths::registered_identity(
        root,
        &paths::checked_metadata(root, root, auth)?.ok_or("project root missing")?,
    )?;
    let config_path = root.join("project-maintenance.json");
    let config_object =
        paths::checked_metadata(root, &config_path, auth)?.ok_or("project config missing")?;
    let config_file_identity = paths::registered_identity(&config_path, &config_object)?;
    auth(&config_path, crate::AccessMode::Read)?;
    if hash(&std::fs::read(&config_path).map_err(|e| e.to_string())?)? != config_identity {
        return Err("project config changed during terminal history review".into());
    }
    let mut results = Vec::new();
    let mut candidates = Vec::new();
    let mut bindings = Vec::new();
    let mut before_bytes = 0usize;
    let mut after_bytes = 0usize;
    for id in selection(request)? {
        if auth.cancelled() {
            return Err("maintenance request cancelled".into());
        }
        let group = state.groups.get(&id).ok_or("unknown lifecycle group")?;
        let members = state
            .items
            .iter()
            .filter(|(_, item)| groups::id(item) == Some(id.as_str()))
            .map(|(key, item)| (key.clone(), item.clone()))
            .collect::<BTreeMap<_, _>>();
        let mut blockers = Vec::<String>::new();
        let mut ids = members.keys().cloned().collect::<BTreeSet<_>>();
        ids.insert(id.clone());
        let targets = members
            .values()
            .map(|item| paths::resolve(root, Path::new(string(item, "path")?)))
            .collect::<Result<Vec<_>, String>>()?;
        let listed = group["members"].as_array().and_then(|values| {
            values
                .iter()
                .map(|value| value.as_str().map(str::to_owned))
                .collect::<Option<Vec<_>>>()
        });
        if group["id"] != id
            || group["owner"]
                .as_str()
                .is_none_or(|owner| owner.trim().is_empty())
            || group["membership_complete"] != true
            || group["cleanup_status"] != "deleted"
            || members.is_empty()
            || listed.as_ref().is_none_or(|listed| {
                listed.len() != members.len()
                    || listed.iter().collect::<BTreeSet<_>>() != members.keys().collect()
            })
        {
            blockers.push("group is not an exact complete terminal cohort".into());
        }
        for key in [
            "source_retirements",
            "deleted_claim_retirement",
            "reconciliation",
            "reconciliation_receipt",
        ] {
            if group.get(key).is_some() {
                blockers.push(format!("special group receipt: {key}"));
            }
        }
        for key in ["references", "retain_reason", "run_id", "provenance"] {
            if group
                .get(key)
                .is_some_and(|value| !value.is_null() && value != &json!([]) && value != "")
            {
                blockers.push(format!("group retains {key}"));
            }
        }
        let mut claim = group.clone();
        claim["members"] = json!(members.values().collect::<Vec<_>>());
        if let Err(error) = reservations::check_group(root, &id, auth)
            .and_then(|_| reservations::check_record_mutation(root, &id, Some(&claim), auth))
        {
            blockers.push(error);
        }
        let mut observations = Vec::new();
        for (member_id, item) in &members {
            if item["id"] != *member_id
                || item["owner"] != group["owner"]
                || item["cleanup_status"] != "deleted"
                || item["remaining"] != false
                || item["logical_bytes"] != 0
                || item["kind"] == "backup"
                || item.get("run_id").is_some_and(|v| !v.is_null())
                || item.get("provenance").is_some_and(|v| !v.is_null())
            {
                blockers.push(format!(
                    "member {member_id} is not an independent terminal deletion"
                ));
            }
            let path = paths::resolve(root, Path::new(string(item, "path")?))?;
            let absent = paths::checked_metadata(root, &path, auth)?.is_none();
            observations.push(json!({"id":member_id,"absent":absent}));
            if !absent {
                blockers.push(format!("member {member_id} reappeared"));
            }
            let review = crate::review_single(
                root,
                config,
                config_identity,
                state,
                item,
                auth,
                false,
                Verification::Registered,
                None,
            )?;
            for blocker in review["blockers"]
                .as_array()
                .ok_or("invalid member review")?
            {
                blockers.push(format!("member {member_id}: {blocker}"));
            }
        }
        // No source retirement is performed here. A missing canonical producer
        // record is acceptable only after its owner has already finalized it.
        let mut sources = BTreeSet::from([root.join("artifacts/maintenance/lifecycles")]);
        if group.get("membership_source_format").is_some()
            && (group["membership_source_format"] != "producer_registry_v1"
                || !group["membership_source"].is_string())
        {
            blockers.push("membership source format is unknown or incomplete".into());
        }
        if let Some(source) = group["membership_source"].as_str() {
            let source = paths::resolve(root, Path::new(source))?;
            if group["membership_source_format"] == "producer_registry_v1" {
                sources.insert(source);
            } else if paths::checked_metadata(root, &source, auth)?.is_some() {
                blockers.push("membership source still exists".into());
            }
        }
        let mut source_bindings = Vec::new();
        for source in sources {
            if paths::checked_metadata(root, &source, auth)?.is_none() {
                source_bindings.push(json!({"source":source,"records":{}}));
                continue;
            }
            use sha2::{Digest, Sha256};
            let basename = format!("{:x}", Sha256::digest(id.as_bytes()));
            for extension in ["json", "pending"] {
                if paths::checked_metadata(
                    root,
                    &source.join(format!("{basename}.{extension}")),
                    auth,
                )?
                .is_some()
                {
                    blockers.push("canonical or pending producer record still exists".into());
                }
            }
            let records = crate::registry::retirement_records(root, &source, auth)?;
            for (record_id, record) in &records {
                if record_id == &id || related(record, &ids, &targets, root) {
                    blockers.push("producer record or inbound relation still exists".into());
                }
            }
            source_bindings.push(json!({"source":source,"records":records}));
        }
        for (other_id, other) in &state.groups {
            if other_id != &id && related(other, &ids, &targets, root) {
                blockers.push("another group retains a related claim or reference".into());
            }
        }
        for (other_id, other) in &state.items {
            if !members.contains_key(other_id) && related(other, &ids, &targets, root) {
                blockers.push("another item retains a related claim or reference".into());
            }
        }
        if group["provenance_ref"]
            .as_str()
            .is_some_and(|id| state.runs.contains_key(id))
            || state.runs.keys().any(|id| ids.contains(id))
            || state
                .runs
                .values()
                .any(|run| related(run, &ids, &targets, root))
        {
            blockers.push("run retains a selected identity or path".into());
        }
        let indices = state
            .decisions
            .iter()
            .enumerate()
            .filter(|(_, row)| related(row, &ids, &targets, root))
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        let rows = indices
            .iter()
            .map(|index| state.decisions[*index].clone())
            .collect::<Vec<_>>();
        if rows.iter().any(|row| !successful(row, &id, &members)) {
            blockers.push("related decision is unsuccessful, ambiguous or unsupported".into());
        }
        let prior = group.get("terminal_history_summary");
        let prior_count = match prior {
            None => 0,
            Some(summary) if summary["schema"] == 1 => summary["decision_count"]
                .as_u64()
                .ok_or("invalid terminal history summary count")?,
            Some(_) => return Err("unsupported terminal history summary".into()),
        };
        if prior.is_none()
            && members
                .keys()
                .any(|member| !rows.iter().any(|row| row["id"] == *member))
        {
            blockers.push("member lacks a successful terminal decision".into());
        }
        let byte_count = serde_json::to_vec(&rows).map_err(|e| e.to_string())?.len();
        let prior_bytes = prior.map_or(Ok(0), |summary| {
            summary["decision_bytes"]
                .as_u64()
                .ok_or("invalid terminal history byte count")
        })?;
        let summary = json!({"schema":1,"decision_count":prior_count.checked_add(rows.len() as u64).ok_or("decision count overflow")?,
            "sha256":hash(&json!({"previous_summary":prior,"decisions":rows}))?,
            "original_decisions_sha256":hash(&rows)?,
            "decision_bytes":prior_bytes.checked_add(byte_count as u64).ok_or("decision byte count overflow")?,
            "batch_decision_count":rows.len(),"batch_decision_bytes":byte_count,
            "previous_summary_sha256":prior.map(hash).transpose()?,
            "reason":request["reason"].as_str().unwrap_or(""),"review_token":"0".repeat(64)});
        let eligible = blockers.is_empty();
        results.push(
            json!({"id":id,"eligible":eligible,"blockers":blockers,"decision_count":indices.len()}),
        );
        bindings.push(
            json!({"id":id,"group":group,"members":members,"decisions":rows,
            "observations":observations,"sources":source_bindings,"blockers":blockers}),
        );
        if eligible && !indices.is_empty() {
            before_bytes += byte_count
                + prior.map_or(Ok(0), |v| {
                    serde_json::to_vec(v)
                        .map(|b| b.len())
                        .map_err(|e| e.to_string())
                })?;
            after_bytes += serde_json::to_vec(&summary)
                .map_err(|e| e.to_string())?
                .len();
            candidates.push(Candidate {
                id,
                indices,
                summary,
            });
        }
    }
    let token = hash(
        &json!({"schema":1,"operation":"compact_terminal_history","root":root,
        "root_identity":root_identity,"config_file_identity":config_file_identity,
        "config_identity":config_identity,"revision":state.revision,"preference_revision":auth.preference_revision,
        "bindings":bindings}),
    )?;
    Ok(Prepared {
        result: json!({"operation":"review_terminal_history","policy_schema":1,"revision":state.revision,
        "review_token":token,"groups":results,"before_bytes":before_bytes,"after_bytes":after_bytes,
        "estimate_scope":"serialized selected decision arrays and group summaries; excludes container keys and delimiters",
        "estimate_reason_bytes":request["reason"].as_str().unwrap_or("").len(),
        "estimated_removed_bytes":i64::try_from(before_bytes).map_err(|e| e.to_string())? - i64::try_from(after_bytes).map_err(|e| e.to_string())?}),
        candidates,
    })
}

pub(crate) fn review(
    root: &Path,
    config: &Config,
    config_identity: &str,
    state: &State,
    request: &Value,
    auth: Auth<'_>,
) -> Result<Value, String> {
    Ok(prepare(root, config, config_identity, state, request, auth)?.result)
}

/// Caller retains exclusive Store and catalog custody through atomic save.
pub(crate) fn compact(
    root: &Path,
    config: &Config,
    config_identity: &str,
    state: &mut State,
    request: &Value,
    auth: Auth<'_>,
) -> Result<Value, String> {
    let prepared = prepare(root, config, config_identity, state, request, auth)?;
    let token = string(request, "review_token")?;
    if prepared.result["review_token"].as_str() != Some(token) {
        return Err("stale terminal history review_token".into());
    }
    let reason = string(request, "reason")?;
    if reason.trim().is_empty() {
        return Err("missing nonempty reason".into());
    }
    if prepared.result["groups"]
        .as_array()
        .ok_or("invalid review")?
        .iter()
        .any(|group| group["eligible"] != true)
    {
        return Err("terminal history selection has blockers".into());
    }
    if prepare(root, config, config_identity, state, request, auth)?.result["review_token"]
        != prepared.result["review_token"]
    {
        return Err("terminal history inputs changed during compaction".into());
    }
    if auth.cancelled() {
        return Err("maintenance request cancelled".into());
    }
    let mut result = prepared.result;
    result["operation"] = json!("compact_terminal_history");
    result["status"] = json!(if prepared.candidates.is_empty() {
        "unchanged"
    } else {
        "compacted"
    });
    // Complete fallible preparation before mutation; audit is bounded per group.
    let mut removed = BTreeSet::new();
    for mut candidate in prepared.candidates {
        candidate.summary["reason"] = json!(reason);
        candidate.summary["review_token"] = json!(token);
        state.groups.get_mut(&candidate.id).expect("prepared group")["terminal_history_summary"] =
            candidate.summary;
        removed.extend(candidate.indices);
    }
    let mut index = 0;
    state.decisions.retain(|_| {
        let keep = !removed.contains(&index);
        index += 1;
        keep
    });
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AccessMode, dispatch};

    // Keep these boundary cases: a future eligibility simplification must not
    // discard unsuccessful/unknown receipts, path authority, or live consumers.
    fn fixture() -> (tempfile::TempDir, State) {
        let temp = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(temp.path()).unwrap();
        std::fs::create_dir(root.join(".git")).unwrap();
        std::fs::create_dir(root.join("generated")).unwrap();
        std::fs::create_dir_all(root.join("artifacts/maintenance/lifecycles")).unwrap();
        std::fs::write(root.join("project-maintenance.json"),
            r#"{"schema_version":1,"project_id":"terminal-history-test","managed_roots":["generated"],"protected_paths":[],"bundles":[]}"#).unwrap();
        let mut state = State::default();
        state.groups.insert("g".into(), json!({"id":"g","owner":"test","kind":"run","version":"v1",
            "membership_complete":true,"members":["item"],"cleanup_status":"deleted","unknown_metadata":{"keep":true}}));
        state.items.insert("item".into(), json!({"id":"item","owner":"test","kind":"artifact","generated":true,
            "protection_known":true,"path":root.join("generated/absent"),"references":[],"logical_bytes":0,
            "identity":"original-pin","cleanup_status":"deleted","remaining":false,"lifecycle_group_id":"g"}));
        for n in 0..20 {
            state.decisions.push(json!({"id":"item","decision":"delete","token":"original-token",
                "reason":"terminal deletion","lifecycle_group_id":"g","decision_id":format!("decision-{n}"),
                "attempted":false,"status":"deleted","group_status":"deleted","remaining":false}));
        }
        save(&root, &state);
        (temp, state)
    }
    fn save(root: &Path, state: &State) {
        std::fs::write(
            root.join("artifacts/maintenance/manifest.json"),
            serde_json::to_vec(state).unwrap(),
        )
        .unwrap();
    }
    fn load(root: &Path) -> State {
        serde_json::from_slice(
            &std::fs::read(root.join("artifacts/maintenance/manifest.json")).unwrap(),
        )
        .unwrap()
    }
    fn invoke(root: &Path, request: Value) -> Result<Value, String> {
        dispatch(root, request, &|_: &Path, _: AccessMode| Ok(()))
    }
    fn request(operation: &str) -> Value {
        json!({"operation":operation,"group_ids":["g"],"reason":"bounded audit"})
    }
    fn apply(root: &Path, review: &Value) -> Result<Value, String> {
        let mut request = request("compact_terminal_history");
        request["review_token"] = review["review_token"].clone();
        invoke(root, request)
    }
    #[test]
    fn dispatch_collapses_only_decisions_preserves_tombstones_and_is_idempotent() {
        let (temp, original) = fixture();
        let root = temp.path();
        let original_bytes =
            std::fs::read(root.join("artifacts/maintenance/manifest.json")).unwrap();
        let review = invoke(root, request("review_terminal_history")).unwrap();
        assert_eq!(review["groups"][0]["eligible"], true, "{review}");
        assert_eq!(
            std::fs::read(root.join("artifacts/maintenance/manifest.json")).unwrap(),
            original_bytes
        );
        assert_eq!(apply(root, &review).unwrap()["status"], "compacted");
        let saved = load(root);
        assert!(saved.decisions.is_empty());
        assert_eq!(saved.items, original.items);
        let summary = &saved.groups["g"]["terminal_history_summary"];
        assert_eq!(summary["decision_count"], 20);
        assert_eq!(
            summary["original_decisions_sha256"],
            hash(&original.decisions).unwrap()
        );
        assert_eq!(
            summary["sha256"],
            hash(&json!({"previous_summary":null,"decisions":original.decisions})).unwrap()
        );
        assert!(summary.get("decisions").is_none());
        let mut restored = saved.groups["g"].clone();
        restored
            .as_object_mut()
            .unwrap()
            .remove("terminal_history_summary");
        assert_eq!(restored, original.groups["g"]);
        let bytes = std::fs::read(root.join("artifacts/maintenance/manifest.json")).unwrap();
        let review = invoke(root, request("review_terminal_history")).unwrap();
        assert_eq!(apply(root, &review).unwrap()["status"], "unchanged");
        assert_eq!(
            std::fs::read(root.join("artifacts/maintenance/manifest.json")).unwrap(),
            bytes
        );
    }
    #[test]
    fn stale_review_or_reappeared_root_cannot_mutate_history() {
        for guard in ["revision", "config", "root"] {
            let (temp, mut state) = fixture();
            let review = invoke(temp.path(), request("review_terminal_history")).unwrap();
            match guard {
                "revision" => {
                    state.revision += 1;
                    save(temp.path(), &state);
                }
                "config" => {
                    std::fs::write(temp.path().join("project-maintenance.json"),
                    r#"{"schema_version":1,"project_id":"changed","managed_roots":["generated"]}"#).unwrap();
                }
                _ => {
                    std::fs::write(temp.path().join("generated/absent"), "reappeared").unwrap();
                }
            }
            assert!(apply(temp.path(), &review).is_err(), "{guard}");
            assert_eq!(load(temp.path()).decisions, state.decisions);
        }
    }
    #[test]
    fn unsuccessful_unknown_and_null_signal_receipts_stay_intact() {
        for guard in [
            "failed",
            "deferred",
            "pending",
            "unknown",
            "partial",
            "error",
            "unknown_field",
            "signal",
            "deletion_null",
        ] {
            let (temp, mut state) = fixture();
            match guard {
                "error" => state.decisions[0]["error"] = json!("failed"),
                "signal" => state.decisions[0]["signal"] = json!(false),
                "unknown_field" => state.decisions[0]["future_receipt"] = json!({"unknown":true}),
                "deletion_null" => state.decisions[0]["deletion"] = Value::Null,
                status => state.decisions[0]["status"] = json!(status),
            }
            save(temp.path(), &state);
            let review = invoke(temp.path(), request("review_terminal_history")).unwrap();
            assert_eq!(review["groups"][0]["eligible"], false, "{guard}: {review}");
            assert!(apply(temp.path(), &review).is_err());
            assert_eq!(load(temp.path()).decisions, state.decisions);
        }
    }
    #[test]
    fn live_source_run_pair_and_recovery_relations_block_entire_group() {
        for guard in [
            "source",
            "run",
            "pair",
            "reference",
            "retirement",
            "backup",
            "membership",
        ] {
            let (temp, mut state) = fixture();
            match guard {
                "source" => {
                    state.groups.get_mut("g").unwrap()["membership_source"] =
                        json!("generated/source.json");
                    std::fs::write(temp.path().join("generated/source.json"), "{}").unwrap();
                }
                "run" => {
                    state.runs.insert("r".into(), json!({"status":"complete","inputs":[{"path":state.items["item"]["path"]}]}));
                }
                "pair" => {
                    state.groups.insert("other".into(), json!({"deleted_claim_retirement":{"historical_group_id":"g","replacement_group_id":"other"}}));
                }
                "reference" => state.items.get_mut("item").unwrap()["references"] = json!(["keep"]),
                "retirement" => {
                    state.groups.get_mut("g").unwrap()["source_retirements"] = json!([])
                }
                "backup" => state.items.get_mut("item").unwrap()["kind"] = json!("backup"),
                _ => state.groups.get_mut("g").unwrap()["members"] = json!(["item", "item"]),
            }
            save(temp.path(), &state);
            let review = invoke(temp.path(), request("review_terminal_history")).unwrap();
            assert_eq!(review["groups"][0]["eligible"], false, "{guard}: {review}");
            assert!(apply(temp.path(), &review).is_err());
            assert_eq!(load(temp.path()).decisions, state.decisions);
        }
    }
    #[test]
    fn later_generation_chains_summary_and_registration_cannot_forge_or_erase_it() {
        let (temp, _) = fixture();
        let review = invoke(temp.path(), request("review_terminal_history")).unwrap();
        apply(temp.path(), &review).unwrap();
        let mut state = load(temp.path());
        let previous = state.groups["g"]["terminal_history_summary"].clone();
        let (_, original) = fixture();
        state.decisions = original.decisions[..1].to_vec();
        save(temp.path(), &state);
        let review = invoke(temp.path(), request("review_terminal_history")).unwrap();
        apply(temp.path(), &review).unwrap();
        let saved = load(temp.path());
        assert_eq!(
            saved.groups["g"]["terminal_history_summary"]["decision_count"],
            21
        );
        assert_eq!(
            saved.groups["g"]["terminal_history_summary"]["previous_summary_sha256"],
            hash(&previous).unwrap()
        );
        let item = saved.items["item"].clone();
        let group = json!({"id":"g","owner":"test","kind":"run","version":"v2","membership_complete":true,
            "provenance_ref":"next generation","members":[item]});
        let mut forged = group.clone();
        forged["terminal_history_summary"] = json!({"schema":1,"decision_count":0});
        assert!(invoke(temp.path(), json!({"operation":"register","group":forged})).is_err());
        let registered =
            invoke(temp.path(), json!({"operation":"register","group":group})).unwrap();
        assert_eq!(
            registered["group"]["terminal_history_summary"],
            saved.groups["g"]["terminal_history_summary"]
        );
    }
    #[test]
    fn explicit_selection_and_atomic_all_selected_policy() {
        let (temp, mut state) = fixture();
        for ids in [
            json!([]),
            json!(["g", "g"]),
            json!([""]),
            json!(["missing"]),
        ] {
            assert!(
                invoke(
                    temp.path(),
                    json!({"operation":"review_terminal_history","group_ids":ids})
                )
                .is_err()
            );
        }
        let mut other = state.groups["g"].clone();
        other["id"] = json!("other");
        other["membership_complete"] = json!(false);
        other["members"] = json!([]);
        state.groups.insert("other".into(), other);
        save(temp.path(), &state);
        let review = invoke(
            temp.path(),
            json!({"operation":"review_terminal_history","group_ids":["g","other"]}),
        )
        .unwrap();
        assert!(
            invoke(
                temp.path(),
                json!({"operation":"compact_terminal_history","group_ids":["g","other"],
            "review_token":review["review_token"],"reason":"atomic"})
            )
            .is_err()
        );
        assert_eq!(load(temp.path()).decisions, state.decisions);
    }

    #[test]
    fn report_success_keeps_null_semantics_and_unknown_report_fields_block() {
        for guard in ["unix", "windows", "nonnull", "unknown"] {
            let (temp, mut state) = fixture();
            let row = &mut state.decisions[0];
            row["attempt_id"] = json!("native-attempt");
            row["attempted"] = json!(true);
            row["deletion"] = json!({"status":"deleted","remaining":false,"attributes":[],"physical_bytes_reclaimed":null});
            match guard {
                "windows" => row["deletion"]["error"] = Value::Null,
                "nonnull" => row["deletion"]["error"] = json!(false),
                "unknown" => row["deletion"]["future_failure_receipt"] = json!({"state":"unknown"}),
                _ => {}
            }
            save(temp.path(), &state);
            let review = invoke(temp.path(), request("review_terminal_history")).unwrap();
            assert_eq!(
                review["groups"][0]["eligible"],
                matches!(guard, "unix" | "windows"),
                "{guard}: {review}"
            );
        }
    }

    #[test]
    fn durable_reservation_and_pending_source_prevent_aggregation() {
        use sha2::{Digest, Sha256};
        for guard in ["reservation", "pending"] {
            let (temp, state) = fixture();
            let basename = format!("{:x}", Sha256::digest(b"g"));
            let source = temp.path().join("artifacts/maintenance/lifecycles");
            if guard == "reservation" {
                let reservations = source.join("reservations");
                std::fs::create_dir(&reservations).unwrap();
                std::fs::write(reservations.join(format!("{}.json", hash(&"g").unwrap())), serde_json::to_vec(&json!({
                    "schema":1,"id":"g","token":"foreign-owner","members":[{"id":"item","path":state.items["item"]["path"]}]
                })).unwrap()).unwrap();
            } else {
                std::fs::write(
                    source.join(format!("{basename}.pending")),
                    "incomplete source publication",
                )
                .unwrap();
            }
            let review = invoke(temp.path(), request("review_terminal_history")).unwrap();
            assert_eq!(review["groups"][0]["eligible"], false, "{guard}: {review}");
            assert!(apply(temp.path(), &review).is_err());
            assert_eq!(load(temp.path()).decisions, state.decisions);
        }
    }
}

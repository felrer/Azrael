//! Explicit, metadata-only consolidation of complete generic native cohorts.
use crate::{
    AccessMode, Auth, Config, State, Verification, groups, hash, paths, reservations, string,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

fn overlaps(a: &Path, b: &Path) -> bool {
    paths::within(a, b) || paths::within(b, a)
}

fn references(record: &Value, ids: &BTreeSet<String>) -> bool {
    record["references"].as_array().is_some_and(|refs| {
        refs.iter().any(|reference| {
            reference
                .as_str()
                .or_else(|| reference["id"].as_str())
                .is_some_and(|id| ids.contains(id))
        })
    })
}

fn controls(record: &Value) -> Result<(), String> {
    if !(record["cleanup_status"].is_null() || record["cleanup_status"] == "deferred")
        || record["retain_reason"]
            .as_str()
            .is_some_and(|s| !s.is_empty())
        || record
            .get("references")
            .is_some_and(|v| !v.as_array().is_some_and(Vec::is_empty))
        || record.get("protection_known").is_some_and(|v| v != true)
        || record.get("generated").is_some_and(|v| v != true)
    {
        return Err(
            "duplicate reconciliation refuses retained, protected or cleanup-active records".into(),
        );
    }
    Ok(())
}

// Ordinary catalog readers may skip unrelated unavailable records. Ownership
// migration needs a complete view: an unknown record might claim these paths.
fn strict_catalog(root: &Path, source: &Path, auth: Auth<'_>) -> Result<Vec<Value>, String> {
    paths::check(root, source, auth)?;
    auth(source, AccessMode::Read)?;
    let mut records = Vec::new();
    for entry in std::fs::read_dir(source).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if !path
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.eq_ignore_ascii_case("json"))
        {
            continue;
        }
        if !paths::checked_metadata(root, &path, auth)?
            .is_some_and(|m| m.is_file() && m.len() <= 16 * 1024 * 1024)
        {
            return Err(
                "duplicate reconciliation requires every catalog record to be readable and regular"
                    .into(),
            );
        }
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        if bytes.len() > 16 * 1024 * 1024 {
            return Err("duplicate catalog record exceeds 16 MiB".into());
        }
        let record: Value = serde_json::from_slice(&bytes)
            .map_err(|e| format!("unknown duplicate catalog blocker: {e}"))?;
        crate::registry::validate(root, &record)?;
        paths::check(root, &path, auth)?;
        auth(&path, AccessMode::Read)?;
        if std::fs::read(&path).map_err(|e| e.to_string())? != bytes {
            return Err("duplicate catalog record changed while reading".into());
        }
        records.push(record);
    }
    records.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    Ok(records)
}

pub(crate) fn reconcile(
    root: &Path,
    config: &Config,
    config_identity: &str,
    request: &Value,
    store: &mut crate::storage::Store<'_>,
    auth: Auth<'_>,
) -> Result<Value, String> {
    let phase = string(request, "phase")?;
    if !matches!(phase, "review" | "apply") {
        return Err("duplicate reconciliation phase must be review or apply".into());
    }
    let sources = request["sources"]
        .as_array()
        .ok_or("missing duplicate sources")?;
    if sources.len() < 2 || sources.len() > 200 {
        return Err("duplicate reconciliation requires 2..200 source groups".into());
    }
    let target = &request["target"];
    let target_id = string(target, "id")?;
    for descriptor in sources.iter().chain(std::iter::once(target)) {
        if descriptor.as_object().is_none_or(|o| o.len() != 2)
            || string(descriptor, "id")?.trim().is_empty()
            || string(descriptor, "owner")?.trim().is_empty()
        {
            return Err("duplicate group descriptors require exact nonblank id and owner".into());
        }
    }
    let reason = string(request, "reason")?;
    if reason.trim().is_empty() {
        return Err("duplicate reconciliation requires a reason".into());
    }
    let state = &store.state;
    if state.groups.contains_key(target_id) || state.items.contains_key(target_id) {
        return Err("duplicate target must be a new group identity".into());
    }
    let migration = json!({"sources":sources,"target":target,"reason":reason});
    let evidence_path = paths::resolve(root, Path::new(string(request, "evidence_ref")?))?;
    if !paths::within(&evidence_path, &root.join("artifacts/maintenance/evidence")) {
        return Err("duplicate evidence must be within artifacts/maintenance/evidence".into());
    }
    if !paths::checked_metadata(root, &evidence_path, auth)?
        .is_some_and(|m| m.is_file() && m.len() <= 16 * 1024 * 1024)
    {
        return Err("duplicate evidence must be an existing file of at most 16 MiB".into());
    }
    let bytes = std::fs::read(&evidence_path).map_err(|e| e.to_string())?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("duplicate evidence exceeds 16 MiB".into());
    }
    let digest = format!("{:x}", Sha256::digest(&bytes));
    if string(request, "evidence_sha256")? != digest {
        return Err("duplicate evidence SHA-256 mismatch".into());
    }
    let evidence: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let mut selected_groups = BTreeSet::new();
    let mut selected_ids = BTreeSet::new();
    let mut originals = Vec::new();
    let mut original_items = Vec::new();
    let mut observations = BTreeMap::new();
    let mut unique: BTreeMap<PathBuf, Value> = BTreeMap::new();
    for source in sources {
        let id = string(source, "id")?;
        if !selected_groups.insert(id.to_owned()) || id == target_id {
            return Err("duplicate source group identities".into());
        }
        let group = state
            .groups
            .get(id)
            .ok_or("unknown duplicate source group")?;
        controls(group)?;
        if group["id"] != id
            || group["owner"] != source["owner"]
            || group["membership_complete"] != true
            || group.get("membership_source_format").is_some()
            || !matches!(group["kind"].as_str(), Some("work" | "run" | "version"))
        {
            return Err(
                "duplicate source requires exact owner and complete generic native membership"
                    .into(),
            );
        }
        reservations::check_record_mutation(root, id, None, auth)?;
        let members = group["members"]
            .as_array()
            .ok_or("invalid duplicate membership")?;
        if members.is_empty() {
            return Err("empty duplicate source group".into());
        }
        for member_id in members {
            let member_id = member_id.as_str().ok_or("invalid duplicate member id")?;
            if !selected_ids.insert(member_id.to_owned()) || selected_ids.len() > 200 {
                return Err(
                    "duplicate reconciliation requires at most 200 distinct complete members"
                        .into(),
                );
            }
            let item = state
                .items
                .get(member_id)
                .ok_or("missing duplicate member")?;
            controls(item)?;
            if item["id"] != member_id
                || groups::id(item) != Some(id)
                || item["owner"] != source["owner"]
                || item["kind"] == "backup"
                || !item["source_path"].is_null()
                || !item["identity"].is_string()
                || !item["logical_bytes"].is_u64()
            {
                return Err("invalid duplicate member ownership, kind or measurement".into());
            }
            let path = paths::resolve(root, Path::new(string(item, "path")?))?;
            auth(&path, AccessMode::Write)?;
            reservations::check_reader_paths(root, std::slice::from_ref(&path), auth)?;
            let review = crate::review_single(
                root,
                config,
                config_identity,
                state,
                item,
                auth,
                true,
                Verification::Registered,
                None,
            )?;
            if !review["blockers"].as_array().is_some_and(Vec::is_empty)
                || !matches!(review["presence"].as_str(), Some("present" | "absent"))
            {
                return Err(format!(
                    "duplicate member is blocked: {member_id}: {}",
                    review["blockers"]
                ));
            }
            let observation = review["root_observation"].clone();
            if let Some(previous) = unique.get(&path) {
                for field in ["identity", "logical_bytes", "kind"] {
                    if previous[field] != item[field] {
                        return Err(
                            "duplicate registered content identity, size or kind disagrees".into(),
                        );
                    }
                }
                if observations.get(&path) != Some(&observation) {
                    return Err("duplicate physical root identity disagrees".into());
                }
            } else {
                if unique.keys().any(|other| overlaps(&path, other)) {
                    return Err("nested duplicate paths are unsupported".into());
                }
                unique.insert(path.clone(), item.clone());
                observations.insert(path, observation);
            }
            original_items.push(item.clone());
        }
        if let Some(_) = group["membership_source"].as_str() {
            let observed = groups::source_measurement(root, group, &state.items, auth)?;
            if observed["identity"] != group["membership_source_identity"] {
                return Err("duplicate source membership evidence changed".into());
            }
        }
        originals.push(group.clone());
    }
    if unique.len() == original_items.len() {
        return Err("selected groups contain no exact duplicate paths".into());
    }
    if evidence != json!({"migration":migration,"groups":originals,"items":original_items}) {
        return Err("duplicate evidence must preserve the full original groups, items and migration identity".into());
    }
    let all_ids = selected_ids
        .union(&selected_groups)
        .cloned()
        .collect::<BTreeSet<_>>();
    let original_decisions = state
        .decisions
        .iter()
        .filter(|decision| {
            ["id", "lifecycle_group_id", "group_id"]
                .iter()
                .any(|field| {
                    decision[*field]
                        .as_str()
                        .is_some_and(|id| all_ids.contains(id))
                })
        })
        .cloned()
        .collect::<Vec<_>>();
    let mut catalog_sources = BTreeSet::from([root.join("artifacts/maintenance/lifecycles")]);
    for group in state.groups.values() {
        if group["membership_source_format"] == "producer_registry_v1" {
            catalog_sources.insert(paths::resolve(
                root,
                Path::new(string(group, "membership_source")?),
            )?);
        }
    }
    let mut catalog = Vec::new();
    for source in catalog_sources {
        let strict = strict_catalog(root, &source, auth)?;
        let current = crate::registry::producer_records(root, &source, target_id, auth)?;
        if strict.len() != current.len()
            || strict.iter().any(|record| {
                current.get(record["id"].as_str().unwrap_or_default()) != Some(record)
            })
        {
            return Err("duplicate catalog view is incomplete or changed".into());
        }
        catalog.extend(strict);
    }
    for record in state
        .groups
        .values()
        .chain(state.items.values())
        .chain(catalog.iter())
    {
        if references(record, &all_ids) {
            return Err("inbound reference protects duplicate ownership".into());
        }
        for source in ["membership_source", "source_path"]
            .iter()
            .filter_map(|field| record[*field].as_str())
        {
            let source = paths::resolve(root, Path::new(source))?;
            if unique.keys().any(|p| overlaps(p, &source)) {
                return Err("duplicate path overlaps source control evidence".into());
            }
        }
    }
    for (id, item) in &state.items {
        if selected_ids.contains(id) {
            continue;
        }
        if groups::id(item).is_some_and(|g| selected_groups.contains(g)) {
            return Err("duplicate source contains an unlisted registered member".into());
        }
        let path = paths::resolve(root, Path::new(string(item, "path")?))?;
        if unique.keys().any(|p| overlaps(p, &path)) {
            return Err("unselected registered item overlaps duplicate path".into());
        }
    }
    for record in &catalog {
        for item in record["members"]
            .as_array()
            .ok_or("invalid producer catalog membership")?
        {
            let path = paths::resolve(root, Path::new(string(item, "path")?))?;
            if unique.keys().any(|p| overlaps(p, &path)) {
                return Err("producer catalog claim overlaps duplicate path".into());
            }
        }
    }
    if unique.keys().any(|p| overlaps(p, &evidence_path)) {
        return Err("duplicate evidence overlaps payload".into());
    }
    let evidence_measurement = paths::measure(root, &evidence_path, auth)?;
    let token = hash(
        &json!({"config":config_identity,"state":state,"catalog":catalog,"migration":migration,"evidence_path":evidence_path,"evidence_sha256":digest,"evidence_measurement":evidence_measurement,"observations":observations}),
    )?;
    let mut group = originals[0].clone();
    group["id"] = target["id"].clone();
    group["owner"] = target["owner"].clone();
    group["provenance_ref"] = json!(evidence_path);
    group["membership_source"] = json!(evidence_path);
    group["membership_source_identity"] = evidence_measurement["identity"].clone();
    group["reconciliation"] = json!({"migration":migration,"evidence_sha256":digest,"token":token,"original_groups":originals,"original_items":original_items,"original_decisions":original_decisions});
    let mut canonical = Vec::new();
    for (path, mut item) in unique {
        let id = format!("duplicate-{}", hash(&json!({"target":target,"path":path}))?);
        if state.items.contains_key(&id) || state.groups.contains_key(&id) {
            return Err("canonical duplicate item identity already exists".into());
        }
        item["id"] = json!(id);
        item["owner"] = target["owner"].clone();
        item["lifecycle_group_id"] = target["id"].clone();
        item["presence"] = observations[&path]["presence"].clone();
        item["remaining"] = json!(observations[&path]["presence"] == "present");
        canonical.push(item);
    }
    group["members"] = json!(canonical.iter().map(|i| &i["id"]).collect::<Vec<_>>());
    let mut reservation_group = group.clone();
    reservation_group["members"] = json!(canonical);
    reservations::check_record_mutation(root, target_id, Some(&reservation_group), auth)?;
    if std::fs::read(&evidence_path).map_err(|e| e.to_string())? != bytes {
        return Err("duplicate evidence changed during reconciliation".into());
    }
    for (path, observation) in &observations {
        if paths::registered_observation(root, path, auth)? != *observation {
            return Err("duplicate physical root changed during reconciliation".into());
        }
    }
    if phase == "review" {
        return Ok(json!({"phase":"review","token":token,"group":group,"items":canonical}));
    }
    if string(request, "token")? != token {
        return Err("stale duplicate reconciliation token".into());
    }
    let receipt = json!({"operation":"reconcile_duplicate_groups","status":"consolidated","migration":migration,"evidence_ref":evidence_path,"evidence_sha256":digest,"token":token,"original_groups":originals,"original_items":original_items,"original_decisions":original_decisions,"canonical_group":group,"canonical_items":canonical});
    let original_state: State = store.state.clone();
    for id in selected_ids {
        store.state.items.remove(&id);
    }
    for id in selected_groups {
        store.state.groups.remove(&id);
    }
    for item in &canonical {
        store
            .state
            .items
            .insert(string(item, "id")?.to_owned(), item.clone());
    }
    store
        .state
        .groups
        .insert(target_id.to_owned(), group.clone());
    store.state.decisions.push(receipt.clone());
    if let Err(error) = store.save(auth) {
        store.state = original_state;
        return Err(error);
    }
    Ok(
        json!({"phase":"apply","status":"consolidated","group":group,"items":canonical,"receipt":receipt}),
    )
}

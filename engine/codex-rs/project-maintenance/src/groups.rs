//! Explicit version/run/work cohorts share one reviewed retain/delete fate.
use crate::{
    Auth, Config, State, Verification, hash, now_ms, paths, prepare_registered_item,
    review_ungrouped, string,
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

pub(crate) fn id(item: &Value) -> Option<&str> {
    item["lifecycle_group_id"].as_str()
}
fn cached_live(item: &Value) -> bool {
    item["cleanup_status"] != "deleted" || item["remaining"] != false
}
pub(crate) fn live_ids(
    root: &Path,
    state: &State,
    group: &Value,
    auth: Auth<'_>,
) -> Result<Vec<String>, String> {
    let group_id = string(group, "id")?;
    let members = group["members"]
        .as_array()
        .ok_or("invalid group membership")?;
    let mut live = Vec::new();
    for member in members {
        let member = member.as_str().ok_or("invalid member id")?;
        let item = state
            .items
            .get(member)
            .ok_or("group member record missing")?;
        if id(item) != Some(group_id) {
            return Err("group membership record inconsistent".into());
        }
        if !cached_live(item) {
            let path = Path::new(string(item, "path")?);
            if matches!(paths::checked_metadata(root, path, auth), Ok(None)) {
                continue;
            }
        }
        live.push(member.to_owned());
    }
    Ok(live)
}
pub(crate) fn summary(state: &State, group: &Value) -> Value {
    let members = group["members"].as_array();
    let live = members.map_or(0, |members| {
        members
            .iter()
            .filter(|id| {
                id.as_str()
                    .and_then(|id| state.items.get(id))
                    .is_some_and(cached_live)
            })
            .count()
    });
    json!({"id":group["id"],"kind":group["kind"],"owner":group["owner"],"version":group["version"],"membership_complete":group["membership_complete"],"provenance_ref":group["provenance_ref"],"membership_source":group["membership_source"],"membership_source_format":group["membership_source_format"],"membership_source_identity":group["membership_source_identity"],"members_total":members.map_or(0,Vec::len),"cached_live_members":live,"cleanup_status":group["cleanup_status"]})
}
pub(crate) fn register(
    root: &Path,
    mut group: Value,
    state: &mut State,
    auth: Auth<'_>,
) -> Result<Value, String> {
    let group_id = string(&group, "id")?.to_owned();
    crate::reservations::check_group(root, &group_id, auth)?;
    crate::reservations::check_record_mutation(root, &group_id, Some(&group), auth)?;
    let owner = string(&group, "owner")?;
    let kind = string(&group, "kind")?;
    if owner.trim().is_empty()
        || !["version", "run", "work"].contains(&kind)
        || string(&group, "provenance_ref")?.trim().is_empty()
        || !group["membership_complete"].is_boolean()
    {
        return Err("invalid lifecycle group contract".into());
    }
    let members = group["members"]
        .as_array()
        .ok_or("group members must be full item objects")?;
    if members.is_empty() || members.len() > 200 {
        return Err("group requires 1..200 members".into());
    }
    let previous = state.groups.get(&group_id);
    if previous.is_some_and(|old| old["owner"] != group["owner"] || old["kind"] != group["kind"]) {
        return Err("existing group ownership and kind cannot change".into());
    }
    // Retirement receipts are historical metadata, never an active source.
    // Full registration may establish a new source, but cannot erase this history.
    if let Some(incoming) = group.get("source_retirements") {
        if previous.and_then(|old| old.get("source_retirements")) != Some(incoming) {
            return Err(
                "source retirement history cannot be supplied or changed by registration".into(),
            );
        }
    }
    let mut prepared = BTreeMap::new();
    let mut newly_absent = BTreeSet::new();
    let producer_source = group
        .get("membership_source_format")
        .or_else(|| previous.and_then(|old| old.get("membership_source_format")))
        .is_some_and(|format| format == "producer_registry_v1");
    for member in members {
        let mut member = member.clone();
        let member_id = string(&member, "id")?.to_owned();
        if prepared.contains_key(&member_id) {
            return Err("duplicate group member id".into());
        }
        if member
            .get("lifecycle_group_id")
            .is_some_and(|existing| existing.as_str() != Some(group_id.as_str()))
        {
            return Err("member names a different lifecycle group".into());
        }
        if let Some(old) = state.items.get(&member_id) {
            if id(old).is_some_and(|existing| existing != group_id) {
                return Err("member belongs to another lifecycle group".into());
            }
        }
        member["lifecycle_group_id"] = json!(group_id);
        if member
            .get("lifecycle_role")
            .is_some_and(|role| !role.is_string())
        {
            return Err("lifecycle_role must be a nonblank string".into());
        }
        let role = member["lifecycle_role"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| {
                match member["kind"].as_str() {
                    Some("log") => "log",
                    Some("evidence") => "evidence",
                    Some("snapshot") => "snapshot",
                    _ => "artifact",
                }
                .to_owned()
            });
        if role.trim().is_empty() {
            return Err("lifecycle_role cannot be blank".into());
        }
        member["lifecycle_role"] = json!(role);
        let previous_member = state.items.get(&member_id).filter(|old| {
            id(old) == Some(group_id.as_str())
                && previous.is_some_and(|group| {
                    group["members"]
                        .as_array()
                        .is_some_and(|members| members.iter().any(|id| id == &member_id))
                })
        });
        // Tentative absence is committed only after the complete producer
        // contract and every projected member have been verified below.
        member = prepare_registered_item(root, member, previous_member, producer_source, auth)?;
        if previous_member.is_none() && member["presence"] == "absent" {
            newly_absent.insert(member_id.clone());
        }
        if let Some(old) = state.items.get(&member_id) {
            if cached_live(old) {
                let old_path = Path::new(string(old, "path")?);
                let new_path = Path::new(string(&member, "path")?);
                if !paths::within(old_path, new_path) || !paths::within(new_path, old_path) {
                    return Err("cannot replace a live registered member path".into());
                }
            }
        }
        prepared.insert(member_id, member);
    }
    // The immutable members borrow ends with preparation above.
    if let Some(history) = previous.and_then(|old| old.get("source_retirements")) {
        group["source_retirements"] = history.clone();
    }
    if let Some(old) = previous {
        for member_id in live_ids(root, state, old, auth)? {
            if !prepared.contains_key(&member_id) {
                let old = &state.items[&member_id];
                if paths::checked_metadata(root, Path::new(string(old, "path")?), auth)?.is_some() {
                    return Err("group update cannot drop a live member".into());
                }
                // Keep the historical member attached to its owner. Absence is
                // an observation, not an implicit cleanup decision.
                let mut absent = old.clone();
                absent["presence"] = json!("absent");
                absent["remaining"] = json!(false);
                prepared.insert(member_id, absent);
            }
        }
    }
    if prepared.len() > 200 {
        return Err("group exceeds 200 members including historical absent members".into());
    }
    let prepared_items = prepared.values().collect::<Vec<_>>();
    for (index, item) in prepared_items.iter().enumerate() {
        for other in &prepared_items[index + 1..] {
            let a = Path::new(string(item, "path")?);
            let b = Path::new(string(other, "path")?);
            if paths::within(a, b) || paths::within(b, a) {
                return Err(
                    "group members must have disjoint paths to preserve evidence ordering".into(),
                );
            }
        }
    }
    if group.get("version").is_none() {
        group["version"] = previous
            .and_then(|old| old.get("version"))
            .cloned()
            .unwrap_or(Value::Null);
    }
    if group.get("membership_source_format").is_none() {
        if let Some(format) = previous.and_then(|old| old.get("membership_source_format")) {
            group["membership_source_format"] = format.clone();
        }
    }
    if group
        .get("membership_source_format")
        .is_some_and(|format| format != "producer_registry_v1")
    {
        return Err("unknown membership source format".into());
    }
    if group.get("membership_source").is_none() {
        if let Some(source) = previous
            .and_then(|old| old.get("membership_source"))
            .filter(|source| !source.is_null())
        {
            group["membership_source"] = source.clone();
        }
    }
    if let Some(source) = group.get("membership_source") {
        let source = paths::resolve(
            root,
            Path::new(
                source
                    .as_str()
                    .filter(|source| !source.trim().is_empty())
                    .ok_or("membership_source must be a contained nonblank path")?,
            ),
        )?;
        for item in prepared.values() {
            let path = Path::new(string(item, "path")?);
            if paths::within(path, &source) || paths::within(&source, path) {
                return Err("membership source cannot overlap any deletion member".into());
            }
        }
        group["membership_source"] = json!(source);
        let observed = source_measurement(root, &group, &prepared, auth)?;
        if !newly_absent.is_empty() {
            crate::registry::validate_absent_adoption(&group, &prepared, &newly_absent, &observed)?;
        }
        group["membership_source_identity"] = observed["identity"].clone();
    } else {
        if !newly_absent.is_empty() {
            return Err("absent adoption requires a verified producer source".into());
        }
        if group.get("membership_source_format").is_some() {
            return Err("membership source format requires a source".into());
        }
        group["membership_source_identity"] = Value::Null;
    }
    let ids = prepared.keys().cloned().collect::<Vec<_>>();
    group["members"] = json!(ids);
    group["registered_at_ms"] = json!(now_ms()?);
    group["cleanup_status"] = Value::Null;
    let items = prepared.values().cloned().collect::<Vec<_>>();
    state.items.extend(prepared);
    state.groups.insert(group_id, group.clone());
    Ok(json!({"group":group,"items":items}))
}

/// The caller supplies the exact group, inverse members, relevant decisions,
/// global revision and config identity; no cached deletion token authorizes this.
pub(crate) fn source_retirement_snapshot(
    state: &State,
    group_id: &str,
    config_identity: &str,
) -> Result<Value, String> {
    let group = state
        .groups
        .get(group_id)
        .ok_or("unknown lifecycle group")?;
    let members = state
        .items
        .iter()
        .filter(|(_, item)| id(item) == Some(group_id))
        .map(|(id, item)| (id.clone(), item.clone()))
        .collect::<BTreeMap<_, _>>();
    let decisions = state
        .decisions
        .iter()
        .filter(|decision| {
            decision["lifecycle_group_id"] == group_id
                || decision["id"]
                    .as_str()
                    .is_some_and(|id| members.contains_key(id))
        })
        .cloned()
        .collect::<Vec<_>>();
    Ok(
        json!({"revision":state.revision,"config_identity":config_identity,
        "group":group,"members":members,"decisions":decisions}),
    )
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceRetirement {
    id: String,
    owner: String,
    scope: String,
    reason: String,
    evidence_ref: String,
    evidence_sha256: String,
    expected_snapshot: Value,
}

fn source_retirement_evidence(
    root: &Path,
    request: &SourceRetirement,
    auth: Auth<'_>,
) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    // Reuse the formal evidence owner's containment, permission and size guard.
    let identity = crate::retirement::read_evidence(root, &request.evidence_ref, auth)?;
    let path = paths::resolve(root, Path::new(&request.evidence_ref))?;
    let mut bytes = Vec::new();
    std::fs::File::open(&path)
        .map_err(|e| e.to_string())?
        .take(1_048_577)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 1_048_576
        || format!("{:x}", Sha256::digest(&bytes)) != request.evidence_sha256
        || hash(&bytes)? != identity
        || crate::retirement::read_evidence(root, &request.evidence_ref, auth)? != identity
    {
        return Err("retirement evidence changed or SHA256 pin is stale".into());
    }
    Ok(identity)
}

/// Retire only obsolete, unformatted directory evidence for a terminally deleted
/// cohort. This neither deletes payload nor certifies a historical producer exit.
pub(crate) fn retire_source(
    root: &Path,
    config: &Config,
    config_identity: &str,
    descriptor: &Value,
    state: &mut State,
    auth: Auth<'_>,
) -> Result<Value, String> {
    use sha2::{Digest, Sha256};
    let request: SourceRetirement =
        serde_json::from_value(descriptor.clone()).map_err(|e| e.to_string())?;
    if request.scope != "terminal_deleted_legacy_membership_source"
        || request.owner.trim().is_empty()
        || request.reason.trim().is_empty()
        || request.evidence_sha256.len() != 64
        || !request
            .evidence_sha256
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err("invalid source retirement scope, owner, reason or evidence pin".into());
    }
    let snapshot = source_retirement_snapshot(state, &request.id, config_identity)?;
    if request.expected_snapshot != snapshot {
        return Err("source retirement snapshot changed; fresh evidence required".into());
    }
    let group = &snapshot["group"];
    if group["owner"] != request.owner
        || group["membership_complete"] != true
        || group["cleanup_status"] != "deleted"
        || group.get("membership_source_format").is_some()
    {
        return Err(
            "source retirement requires an owned, complete, terminal deleted legacy group".into(),
        );
    }
    if group
        .get("references")
        .is_some_and(|refs| !refs.as_array().is_some_and(Vec::is_empty))
        || group
            .get("retain_reason")
            .is_some_and(|reason| reason.as_str().is_none_or(|reason| !reason.is_empty()))
    {
        return Err("source retirement group remains protected".into());
    }
    // This exception retires legacy directory evidence once. A new explicit
    // registration preserves history and cannot reset this authority boundary.
    if group.get("source_retirements").is_some() {
        return Err("legacy group source retirement is permitted only once".into());
    }
    let source = paths::resolve(root, Path::new(string(group, "membership_source")?))?;
    if source != root.join("artifacts/maintenance/lifecycles")
        || group["membership_source_identity"]
            .as_str()
            .is_none_or(|identity| {
                identity.len() != 64
                    || !identity
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            })
    {
        return Err(
            "source retirement is restricted to legacy lifecycle directory evidence".into(),
        );
    }
    let members = snapshot["members"]
        .as_object()
        .ok_or("invalid inverse membership")?;
    let ids = group["members"]
        .as_array()
        .filter(|ids| !ids.is_empty() && ids.len() <= 200)
        .ok_or("invalid group members")?;
    let listed = ids
        .iter()
        .map(|id| id.as_str().ok_or("invalid group member id"))
        .collect::<Result<BTreeSet<_>, _>>()?;
    if listed.len() != ids.len() || listed != members.keys().map(String::as_str).collect() {
        return Err("source retirement requires exact complete inverse membership".into());
    }
    let decisions = snapshot["decisions"]
        .as_array()
        .ok_or("invalid decisions")?;
    if decisions.iter().any(|decision| {
        !matches!(
            decision["status"].as_str(),
            Some("deleted" | "blocked" | "deferred" | "failed" | "cancelled")
        )
    }) {
        return Err("source retirement has pending or unknown decisions".into());
    }
    let evidence_identity = source_retirement_evidence(root, &request, auth)?;
    let mut claim = group.clone();
    claim["members"] = json!(members.values().collect::<Vec<_>>());
    crate::reservations::check_group(root, &request.id, auth)?;
    crate::reservations::check_record_mutation(root, &request.id, Some(&claim), auth)?;
    for (member_id, item) in members {
        if item["id"] != *member_id
            || item["owner"] != request.owner
            || item["generated"] != true
            || item["protection_known"] != true
            || item["cleanup_status"] != "deleted"
            || item["remaining"] != false
        {
            return Err("source retirement member is not an owned terminal deletion".into());
        }
        let decision = decisions
            .iter()
            .rev()
            .find(|d| d["id"] == *member_id)
            .ok_or("source retirement lacks original terminal deletion decision")?;
        if decision["lifecycle_group_id"] != request.id
            || decision["decision"] != "delete"
            || decision["status"] != "deleted"
            || decision["remaining"] != false
            || decision["group_status"] != "deleted"
            || decision["deletion"]["status"] != "deleted"
            || decision["deletion"]["remaining"] != false
            || decision["attempt_id"].as_str().is_none_or(str::is_empty)
            || decision["token"].as_str().is_none_or(str::is_empty)
        {
            return Err("source retirement lacks completed native deletion receipt".into());
        }
        let path = Path::new(string(item, "path")?);
        if paths::checked_metadata(root, path, auth)?.is_some() {
            return Err("source retirement member reappeared".into());
        }
        // Preserve configured protection, related active/unknown runs and native
        // reference/retention policy using the ordinary review owner.
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
        if !review["blockers"].as_array().is_some_and(Vec::is_empty) {
            return Err("source retirement member remains protected".into());
        }
    }
    let basename = format!("{:x}", Sha256::digest(request.id.as_bytes()));
    for extension in ["json", "pending"] {
        if paths::checked_metadata(root, &source.join(format!("{basename}.{extension}")), auth)?
            .is_some()
        {
            return Err(
                "source retirement canonical or pending producer record still exists".into(),
            );
        }
    }
    let records = crate::registry::retirement_records(root, &source, auth)?;
    for (record_id, record) in &records {
        if record_id == &request.id
            || record["references"]
                .as_array()
                .is_none_or(|refs| refs.iter().any(|r| r["id"] == request.id))
        {
            return Err("source retirement has an active or ambiguous producer reference".into());
        }
        // Existing validated paths retain their meaning, including foreign typed
        // namespaces; a real overlapping claim or reference remains protection.
        let paths = crate::registry::validate(root, record)?;
        for item in members.values() {
            let target = Path::new(string(item, "path")?);
            if paths
                .iter()
                .any(|path| paths::within(target, path) || paths::within(path, target))
                || record["references"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|reference| {
                        reference["member_paths"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .any(|path| {
                                path.as_str().is_some_and(|path| {
                                    paths::within(target, Path::new(path))
                                        || paths::within(Path::new(path), target)
                                })
                            })
                    })
            {
                return Err(
                    "source retirement has a related producer path claim or reference".into(),
                );
            }
        }
    }
    if crate::registry::retirement_records(root, &source, auth)? != records {
        return Err("source retirement catalog changed while observing".into());
    }
    crate::reservations::check_group(root, &request.id, auth)?;
    crate::reservations::check_record_mutation(root, &request.id, Some(&claim), auth)?;
    for extension in ["json", "pending"] {
        if paths::checked_metadata(root, &source.join(format!("{basename}.{extension}")), auth)?
            .is_some()
        {
            return Err("source retirement canonical or pending record reappeared".into());
        }
    }
    // Reobserve the bounded proof and terminal absence after the catalog work.
    if source_retirement_evidence(root, &request, auth)? != evidence_identity {
        return Err("source retirement evidence changed".into());
    }
    for item in members.values() {
        if paths::checked_metadata(root, Path::new(string(item, "path")?), auth)?.is_some() {
            return Err("source retirement member reappeared".into());
        }
    }
    let config_path = root.join("project-maintenance.json");
    paths::check(root, &config_path, auth)?;
    auth(&config_path, crate::AccessMode::Read)?;
    if hash(&std::fs::read(&config_path).map_err(|e| e.to_string())?)? != config_identity {
        return Err("source retirement config changed; fresh evidence required".into());
    }
    let receipt = json!({"scope":request.scope,"owner":request.owner,"reason":request.reason,
        "evidence_ref":request.evidence_ref,"evidence_sha256":request.evidence_sha256,
        "evidence_identity":evidence_identity,"expected_snapshot":snapshot,
        "retired_at_ms":now_ms()?,"meaning":"terminal deletion metadata retirement; historical producer exit not certified"});
    let mut updated = group.clone();
    let object = updated.as_object_mut().ok_or("invalid group object")?;
    for field in [
        "membership_source",
        "membership_source_format",
        "membership_source_identity",
    ] {
        object.remove(field);
    }
    let mut history = match object.get("source_retirements") {
        None => Vec::new(),
        Some(value) => value
            .as_array()
            .ok_or("invalid source retirement history")?
            .clone(),
    };
    history.push(receipt.clone());
    object.insert("source_retirements".into(), json!(history));
    state.groups.insert(request.id.clone(), updated);
    Ok(json!({"id":request.id,"source_retired":true,"receipt":receipt}))
}

/// Refresh producer protection without traversing or hashing payload content.
/// Membership and ownership changes require full registration instead.
pub(crate) fn refresh(
    root: &Path,
    group_id: &str,
    state: &mut State,
    auth: Auth<'_>,
) -> Result<(Value, bool), String> {
    crate::reservations::check_group(root, group_id, auth)?;
    let mut group = state
        .groups
        .get(group_id)
        .ok_or("unknown lifecycle group")?
        .clone();
    if group["membership_source_format"] != "producer_registry_v1" {
        return Err("refresh_group requires producer_registry_v1".into());
    }
    let source = paths::resolve(root, Path::new(string(&group, "membership_source")?))?;
    let mut items = BTreeMap::new();
    for member in group["members"].as_array().ok_or("invalid group members")? {
        let id = member.as_str().ok_or("invalid group member id")?;
        let item = state.items.get(id).ok_or("missing group member")?;
        if self::id(item) != Some(group_id) {
            return Err("inconsistent group member".into());
        }
        let path = paths::resolve(root, Path::new(string(item, "path")?))?;
        paths::check(root, &path, auth)?;
        paths::registered_observation(root, &path, auth)?;
        if paths::within(&path, &source) || paths::within(&source, &path) {
            return Err("membership source overlaps deletion member".into());
        }
        items.insert(id.to_owned(), item.clone());
    }
    let observed = source_measurement(root, &group, &items, auth)?;
    let owner = &observed["owner"];
    if owner["owner"] != group["owner"]
        || owner["kind"] != group["kind"]
        || owner["version"] != group["version"]
        || observed["membership_matches"] != true
    {
        return Err("producer identity or membership changed; re-register full membership".into());
    }
    let members = owner["members"]
        .as_array()
        .ok_or("invalid producer members")?;
    for item in items.values_mut() {
        let path = Path::new(string(item, "path")?);
        let source_member = members
            .iter()
            .find(|member| {
                let candidate = Path::new(member["path"].as_str().unwrap_or(""));
                paths::within(path, candidate) && paths::within(candidate, path)
            })
            .ok_or("producer member missing")?;
        let descendants = members
            .iter()
            .filter(|member| paths::within(Path::new(member["path"].as_str().unwrap_or("")), path));
        let generated = item["generated"] == true
            && !descendants
                .clone()
                .any(|member| member["generated"] == false);
        let protection_known = source_member["protection_known"] == true
            && !descendants
                .clone()
                .any(|member| member["protection_known"] == false);
        item["generated"] = json!(generated);
        item["protection_known"] = json!(protection_known);
        item["references"] = observed["member_references"]
            .get(string(item, "id")?)
            .cloned()
            .unwrap_or_else(|| observed["references"].clone());
        item["protection_revision"] = observed["identity"].clone();
    }
    group["membership_complete"] = observed["settled"].clone();
    group["membership_source_identity"] = observed["identity"].clone();
    group["protection_revision"] = observed["identity"].clone();
    // Refresh changes only this group and its members. Compare their complete
    // Values (including unknown fields) under the existing catalog/state locks;
    // an unchanged refresh needs no full-manifest rewrite or revision bump.
    let changed = state.groups.get(group_id) != Some(&group)
        || items
            .iter()
            .any(|(id, item)| state.items.get(id) != Some(item));
    let refreshed_items = items.values().cloned().collect::<Vec<_>>();
    state.items.extend(items);
    state.groups.insert(group_id.to_owned(), group.clone());
    Ok((json!({"group":group,"items":refreshed_items}), changed))
}

pub(crate) struct Batch {
    definition: Value,
    pub members: BTreeMap<String, Value>,
    reviews: BTreeMap<String, Value>,
    source: Value,
    source_members: BTreeMap<String, Value>,
    pub completed: BTreeSet<String>,
    pub verification: Verification,
    relations: std::cell::RefCell<Option<std::rc::Rc<crate::review_relations::ReviewRelations>>>,
    tokens: crate::review_reuse::TokenCache,
}
pub(crate) fn source_measurement(
    root: &Path,
    group: &Value,
    items: &BTreeMap<String, Value>,
    auth: Auth<'_>,
) -> Result<Value, String> {
    let source = paths::resolve(root, Path::new(string(group, "membership_source")?))?;
    match group["membership_source_format"].as_str() {
        None if group.get("membership_source_format").is_none() => {
            paths::measure(root, &source, auth)
        }
        Some("producer_registry_v1") => crate::registry::observe(root, &source, group, items, auth),
        _ => Err("unknown membership source format".into()),
    }
}
fn observe_source(
    root: &Path,
    group: &Value,
    items: &BTreeMap<String, Value>,
    auth: Auth<'_>,
) -> Value {
    let Some(_) = group["membership_source"].as_str() else {
        return Value::Null;
    };
    let observed = source_measurement(root, group, items, auth);
    match observed {
        Ok(measurement) if group.get("membership_source_format").is_none() => {
            json!({"status":"measured","identity":measurement["identity"]})
        }
        Ok(measurement) => measurement,
        Err(reason) => json!({"status":"unavailable","reason":reason}),
    }
}
fn definition(group: &Value) -> Value {
    let mut group = group.clone();
    if let Some(object) = group.as_object_mut() {
        object.remove("cleanup_status");
    }
    group
}
pub(crate) fn batch(
    root: &Path,
    config: &Config,
    config_identity: &str,
    state: &State,
    group_id: &str,
    auth: Auth<'_>,
    verification: Verification,
) -> Result<Batch, String> {
    crate::reservations::check_group(root, group_id, auth)?;
    let group = state
        .groups
        .get(group_id)
        .ok_or("unknown lifecycle group")?;
    let reservation = crate::reservations::GroupReviewFence::begin(root, group_id, auth)?;
    let mut members = BTreeMap::new();
    let mut reviews = BTreeMap::new();
    let mut source_members = BTreeMap::new();
    for id in group["members"].as_array().ok_or("invalid group members")? {
        let id = id.as_str().ok_or("invalid group member id")?;
        source_members.insert(
            id.to_owned(),
            state.items.get(id).ok_or("missing group member")?.clone(),
        );
    }
    for id in live_ids(root, state, group, auth)? {
        let item = state.items.get(&id).ok_or("unknown member")?;
        members.insert(id, item.clone());
    }
    let relations = std::rc::Rc::new(crate::review_relations::ReviewRelations::new(
        root, state, &members,
    ));
    let tokens = crate::review_reuse::TokenCache::default();
    let runs = tokens.begin(&state.runs);
    for (id, item) in &members {
        reviews.insert(
            id.clone(),
            crate::review_group_member_local(
                root,
                config,
                config_identity,
                state,
                item,
                auth,
                verification,
                &crate::ReviewReuse {
                    relations: relations.member(id)?,
                    tokens: &tokens,
                    runs: &runs,
                    reservation: Some(&reservation),
                },
            )?,
        );
    }
    // Fresh source observation closes the local-only reservation checks above.
    let source = observe_source(root, group, &source_members, auth);
    reservation.finish(root, auth)?;
    Ok(Batch {
        verification,
        definition: definition(group),
        members,
        reviews,
        source,
        source_members,
        completed: BTreeSet::new(),
        relations: std::cell::RefCell::new(Some(relations)),
        tokens,
    })
}
fn combine(
    group: &Value,
    reviews: &BTreeMap<String, Value>,
    source: &Value,
    selected: Option<&str>,
) -> Result<BTreeMap<String, Value>, String> {
    let evidence=reviews.iter().map(|(id,review)|json!({"id":id,"token":review["token"],"identity":review["identity"],"blockers":review["blockers"]})).collect::<Vec<_>>();
    let token =
        hash(&json!({"group":definition(group),"members":evidence,"membership_source":source}))?;
    let protected = reviews
        .values()
        .any(|review| !review["blockers"].as_array().is_some_and(Vec::is_empty));
    let member_ids = json!(reviews.keys().collect::<Vec<_>>());
    let mut combined = BTreeMap::new();
    for (id, review) in reviews {
        // Validate all member reviews even when only one output is consumed.
        review["blockers"]
            .as_array()
            .ok_or("invalid member review")?;
        if selected.is_some_and(|selected| selected != id.as_str()) {
            continue;
        }
        let mut review = review.clone();
        let blockers = review["blockers"]
            .as_array_mut()
            .ok_or("invalid member review")?;
        if group["membership_complete"] != true {
            blockers.push(json!("lifecycle group membership is incomplete"));
        }
        if group["membership_source"].as_str().is_some()
            && (source["status"] != "measured"
                || source["identity"] != group["membership_source_identity"])
        {
            blockers.push(json!("lifecycle membership source changed or is unavailable; re-register full current membership"));
        }
        if let Some(source_blockers) = source["blockers"].as_array() {
            blockers.extend(source_blockers.iter().cloned());
        }
        if protected {
            blockers.push(json!("a lifecycle group member is protected"));
        }
        review["token"] = json!(hash(&json!({"member":review["token"],"group":token}))?);
        review["group_token"] = json!(token);
        review["lifecycle_group_id"] = group["id"].clone();
        review["group_member_ids"] = member_ids.clone();
        review["membership_source_observation"] = source.clone();
        combined.insert(id.clone(), review);
    }
    Ok(combined)
}
impl Batch {
    pub(crate) fn unchanged_controls(
        &self,
        root: &Path,
        state: &State,
        auth: Auth<'_>,
    ) -> Result<(), String> {
        let group = state
            .groups
            .get(string(&self.definition, "id")?)
            .ok_or("group disappeared")?;
        if definition(group) != self.definition
            || live_ids(root, state, group, auth)?
                .into_iter()
                .collect::<BTreeSet<_>>()
                != self.members.keys().cloned().collect()
            || observe_source(root, group, &self.source_members, auth) != self.source
        {
            return Err("enclosing lifecycle controls changed".into());
        }
        for (id, item) in &self.members {
            let path = Path::new(string(item, "path")?);
            let unchanged = match self.verification {
                Verification::Registered => {
                    paths::registered_observation(root, path, auth)?
                        == self.reviews[id]["root_observation"]
                }
                Verification::Full => {
                    paths::measure(root, path, auth)?["identity"] == self.reviews[id]["identity"]
                }
            };
            if !unchanged {
                return Err("enclosing lifecycle root changed".into());
            }
        }
        Ok(())
    }
    pub fn initial(&self) -> Result<BTreeMap<String, Value>, String> {
        combine(&self.definition, &self.reviews, &self.source, None)
    }
    pub fn current(
        &self,
        root: &Path,
        config: &Config,
        config_identity: &str,
        state: &State,
        auth: Auth<'_>,
        selected: &str,
    ) -> Result<Value, String> {
        let group_id = string(&self.definition, "id")?;
        let current = state.groups.get(group_id).ok_or("group disappeared")?;
        if definition(current) != self.definition {
            return Err("lifecycle group membership or metadata changed".into());
        }
        let reservation = crate::reservations::GroupReviewFence::begin(root, group_id, auth)?;
        let live = live_ids(root, state, current, auth)?
            .into_iter()
            .collect::<BTreeSet<_>>();
        let expected = self
            .members
            .keys()
            .filter(|id| !self.completed.contains(*id))
            .cloned()
            .collect::<BTreeSet<_>>();
        if live
            .difference(&self.completed)
            .cloned()
            .collect::<BTreeSet<_>>()
            != expected
        {
            return Err("lifecycle live membership changed".into());
        }
        let relations = crate::timing::phase("group.current.relations", Some(root), || {
            let previous = self.relations.borrow().as_ref().cloned();
            if let Some(previous) = previous.filter(|plan| plan.matches(root, state)) {
                return Ok::<_, String>(previous);
            }
            let plan = crate::timing::phase("group.relations.build", Some(root), || {
                Ok::<_, String>(std::rc::Rc::new(
                    crate::review_relations::ReviewRelations::new(root, state, &self.members),
                ))
            })?;
            *self.relations.borrow_mut() = Some(plan.clone());
            Ok(plan)
        })?;
        // One immutable State snapshot per observation. begin compares actual run
        // values; the next save's revision alone cannot authorize token reuse.
        let runs = self.tokens.begin(&state.runs);
        let mut reviews = BTreeMap::new();
        crate::timing::phase("group.current.members", Some(root), || {
            let _details = crate::timing::DetailScope::new("group.current.members");
            for (id, item) in &self.members {
                if self.completed.contains(id) {
                    let _detail = crate::timing::detail("member.completed");
                    let path = Path::new(string(item, "path")?);
                    if paths::checked_metadata(root, path, auth)?.is_some() {
                        return Err("deleted lifecycle member reappeared".into());
                    }
                    reviews.insert(id.clone(), self.reviews[id].clone());
                } else {
                    let _detail = crate::timing::detail("member.live");
                    reviews.insert(
                        id.clone(),
                        crate::review_group_member_local(
                            root,
                            config,
                            config_identity,
                            state,
                            item,
                            auth,
                            self.verification,
                            &crate::ReviewReuse {
                                relations: relations.member(id)?,
                                tokens: &self.tokens,
                                runs: &runs,
                                reservation: Some(&reservation),
                            },
                        )?,
                    );
                }
            }
            Ok::<_, String>(())
        })?;
        // Source and permissions are observed anew even if every pure token hit.
        let source = observe_source(root, &self.definition, &self.source_members, auth);
        reservation.finish(root, auth)?;
        crate::timing::phase("group.current.combine", Some(root), || {
            combine(&self.definition, &reviews, &source, Some(selected))
        })?
        .remove(selected)
        .ok_or("missing lifecycle review".into())
    }
}
pub(crate) fn review_selection(
    root: &Path,
    config: &Config,
    config_identity: &str,
    state: &State,
    request: &Value,
    auth: Auth<'_>,
) -> Result<Value, String> {
    if request.get("ids").is_none() && request.get("group_ids").is_none() {
        return Err("review requires ids or group_ids".into());
    }
    let verification = Verification::requested(request)?;
    let mut ids = BTreeSet::new();
    let mut group_ids = BTreeSet::new();
    if let Some(selected) = request.get("ids") {
        for id in selected.as_array().ok_or("ids must be an array")? {
            let id = id.as_str().ok_or("invalid item id")?;
            let item = state.items.get(id).ok_or("unknown item")?;
            if let Some(group) = self::id(item) {
                group_ids.insert(group.to_owned());
            } else {
                ids.insert(id.to_owned());
            }
        }
    }
    if let Some(selected) = request.get("group_ids") {
        for id in selected.as_array().ok_or("group_ids must be an array")? {
            group_ids.insert(id.as_str().ok_or("invalid group id")?.to_owned());
        }
    }
    if verification == Some(Verification::Registered) && !ids.is_empty() {
        return Err("registered verification requires lifecycle grouped items".into());
    }
    let mut reviews = BTreeMap::new();
    for id in ids {
        reviews.insert(
            id.clone(),
            review_ungrouped(
                root,
                config,
                config_identity,
                state,
                &state.items[&id],
                auth,
                Verification::Full,
            )?,
        );
    }
    let mut groups = Vec::new();
    for id in group_ids {
        let batch = batch(
            root,
            config,
            config_identity,
            state,
            &id,
            auth,
            verification.unwrap_or(Verification::Registered),
        )?;
        reviews.extend(batch.initial()?);
        groups.push(summary(state, &state.groups[&id]));
    }
    if reviews.len() > 200 {
        return Err("expanded review exceeds 200 live members; select fewer groups".into());
    }
    Ok(json!({"items":reviews.into_values().collect::<Vec<_>>(),"groups":groups}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source_retirement_fixture() -> (tempfile::TempDir, State, Value) {
        use sha2::{Digest, Sha256};
        let root = tempfile::tempdir().unwrap();
        for relative in [
            "generated",
            "artifacts/maintenance/lifecycles",
            "artifacts/maintenance/evidence",
        ] {
            std::fs::create_dir_all(root.path().join(relative)).unwrap();
        }
        let config = serde_json::to_vec(&json!({"schema_version":1,"project_id":"retirement",
            "managed_roots":["generated"],"bundles":[]}))
        .unwrap();
        std::fs::write(root.path().join("project-maintenance.json"), &config).unwrap();
        let evidence = b"Owner-authorized terminal deletion metadata retirement; original producer exit not certified.";
        std::fs::write(
            root.path()
                .join("artifacts/maintenance/evidence/retire.txt"),
            evidence,
        )
        .unwrap();
        let mut state = State::default();
        state.groups.insert(
            "legacy".into(),
            json!({"id":"legacy","owner":"test","kind":"run",
            "membership_complete":true,"cleanup_status":"deleted","members":["member"],
            "provenance_ref":"original provenance preserved",
            "membership_source":root.path().join("artifacts/maintenance/lifecycles"),
            "membership_source_identity":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}),
        );
        state.items.insert(
            "member".into(),
            json!({"id":"member","lifecycle_group_id":"legacy",
            "path":root.path().join("generated/missing"),"owner":"test","kind":"run",
            "generated":true,"protection_known":true,"cleanup_status":"deleted","remaining":false,
            "references":[],"identity":"old-member-identity","logical_bytes":0,"measured_at_ms":1}),
        );
        state.decisions.push(json!({"id":"member","lifecycle_group_id":"legacy","decision":"delete",
            "status":"deleted","remaining":false,"group_status":"deleted","attempt_id":"native-attempt",
            "token":"original-token","deletion":{"status":"deleted","remaining":false}}));
        let descriptor = json!({"id":"legacy","owner":"test","scope":"terminal_deleted_legacy_membership_source",
            "reason":"Retire obsolete directory evidence after completed deletion",
            "evidence_ref":"artifacts/maintenance/evidence/retire.txt",
            "evidence_sha256":format!("{:x}", Sha256::digest(evidence)),
            "expected_snapshot":source_retirement_snapshot(&state,"legacy",&hash(&config).unwrap()).unwrap()});
        (root, state, descriptor)
    }

    fn write_source_retirement_fixture(
        root: &Path,
        state: &State,
        descriptor: &mut Value,
    ) -> Vec<u8> {
        let config = std::fs::read(root.join("project-maintenance.json")).unwrap();
        descriptor["expected_snapshot"] =
            source_retirement_snapshot(state, "legacy", &hash(&config).unwrap()).unwrap();
        let bytes = serde_json::to_vec(state).unwrap();
        std::fs::write(root.join("artifacts/maintenance/manifest.json"), &bytes).unwrap();
        bytes
    }

    #[test]
    fn retire_group_source_public_descriptor_preserves_terminal_history_and_invalidates_group_identity()
     {
        let (root, state, mut descriptor) = source_retirement_fixture();
        write_source_retirement_fixture(root.path(), &state, &mut descriptor);
        let allow = |_: &Path, _: crate::AccessMode| Ok(());
        let result = crate::dispatch(
            root.path(),
            json!({"operation":"register","retire_group_source":descriptor}),
            &allow,
        )
        .unwrap();
        assert_eq!(result["source_retired"], true);
        let saved: State = serde_json::from_slice(
            &std::fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(saved.items, state.items);
        assert_eq!(saved.decisions, state.decisions);
        assert_eq!(saved.runs, state.runs);
        let group = &saved.groups["legacy"];
        for key in [
            "membership_source",
            "membership_source_format",
            "membership_source_identity",
        ] {
            assert!(group.get(key).is_none());
        }
        assert_eq!(group["cleanup_status"], "deleted");
        assert_eq!(
            group["provenance_ref"],
            state.groups["legacy"]["provenance_ref"]
        );
        assert_eq!(
            group["source_retirements"][0]["expected_snapshot"]["group"],
            state.groups["legacy"]
        );
        assert!(group["source_retirements"][0]["retired_at_ms"].is_u64());
        assert_ne!(
            hash(&definition(group)).unwrap(),
            hash(&definition(&state.groups["legacy"])).unwrap()
        );
        assert!(!root.path().join("generated/missing").exists());
        assert!(
            crate::dispatch(
                root.path(),
                json!({"operation":"register","retire_group_source":descriptor}),
                &allow
            )
            .is_err()
        );
        let mut registration = json!({"id":"legacy","kind":"run","owner":"test","membership_complete":true,
            "provenance_ref":"new registration","members":[state.items["member"]]});
        let registered = crate::dispatch(
            root.path(),
            json!({"operation":"register","group":registration}),
            &allow,
        )
        .unwrap();
        assert_eq!(
            registered["group"]["source_retirements"],
            group["source_retirements"]
        );
        assert!(registered["group"].get("membership_source").is_none());
        let before =
            std::fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap();
        registration["source_retirements"] = json!([]);
        assert!(
            crate::dispatch(
                root.path(),
                json!({"operation":"register","group":registration}),
                &allow
            )
            .is_err()
        );
        assert_eq!(
            std::fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
            before
        );
    }

    #[test]
    fn retire_group_source_rejections_preserve_manifest_bytes() {
        // These public-boundary cases prevent later register routing or guard
        // simplifications from broadening this explicitly terminal legacy scope.
        for case in [
            "live",
            "reappeared",
            "incomplete",
            "inverse",
            "stale",
            "evidence",
            "inbound",
            "pending",
            "reservation",
            "denied",
            "foreign-source",
            "formatted",
            "mixed",
            "ambiguous",
            "active-run",
            "pending-file",
            "malformed-source-identity",
            "prior-retirement",
        ] {
            let (root, mut state, mut descriptor) = source_retirement_fixture();
            match case {
                "malformed-source-identity" => {
                    state.groups.get_mut("legacy").unwrap()["membership_source_identity"] =
                        json!("not-a-sha256")
                }
                "prior-retirement" => {
                    state.groups.get_mut("legacy").unwrap()["source_retirements"] = json!([])
                }
                "live" => {
                    state.items.get_mut("member").unwrap()["cleanup_status"] = json!("retained")
                }
                "reappeared" => {
                    std::fs::write(root.path().join("generated/missing"), "reappeared").unwrap()
                }
                "incomplete" => {
                    state.groups.get_mut("legacy").unwrap()["membership_complete"] = json!(false)
                }
                "inverse" => {
                    let mut extra = state.items["member"].clone();
                    extra["id"] = json!("extra");
                    state.items.insert("extra".into(), extra);
                }
                "pending" => {
                    let mut pending = state.decisions[0].clone();
                    pending["status"] = json!("pending");
                    state.decisions.push(pending);
                }
                "foreign-source" => {
                    state.groups.get_mut("legacy").unwrap()["membership_source"] =
                        json!(root.path().join("generated"))
                }
                "formatted" => {
                    state.groups.get_mut("legacy").unwrap()["membership_source_format"] =
                        json!("producer_registry_v1")
                }
                "inbound" => {
                    let consumer = json!({"schema":1,"id":"consumer","kind":"work","owner":"test","state":"complete",
                        "membership_complete":true,"members":[{"path":root.path().join("artifacts/payload/consumer"),"role":"artifact"}],
                        "references":[{"id":"legacy","reason":"retained dependency"}]});
                    crate::registry::validate(root.path(), &consumer).unwrap();
                    std::fs::write(
                        root.path()
                            .join("artifacts/maintenance/lifecycles/consumer.json"),
                        serde_json::to_vec(&consumer).unwrap(),
                    )
                    .unwrap();
                }
                "reservation" => {
                    let directory = root
                        .path()
                        .join("artifacts/maintenance/lifecycles/reservations");
                    std::fs::create_dir(&directory).unwrap();
                    std::fs::write(
                        directory.join(format!("{}.json", hash(&"legacy").unwrap())),
                        serde_json::to_vec(
                            &json!({"schema":1,"id":"legacy","token":"other-owner","members":[]}),
                        )
                        .unwrap(),
                    )
                    .unwrap();
                }
                "ambiguous" => std::fs::write(
                    root.path()
                        .join("artifacts/maintenance/lifecycles/broken.json"),
                    b"{",
                )
                .unwrap(),
                "active-run" => {
                    state.runs.insert(
                        "running".into(),
                        json!({"steps":[{"status":"unknown","producer_completed":false,
                    "inputs":[{"path":root.path().join("generated/missing")}]}]}),
                    );
                }
                "pending-file" => {
                    use sha2::{Digest, Sha256};
                    std::fs::write(
                        root.path()
                            .join("artifacts/maintenance/lifecycles")
                            .join(format!("{:x}.pending", Sha256::digest(b"legacy"))),
                        b"unresolved",
                    )
                    .unwrap();
                }
                _ => {}
            }
            let before = write_source_retirement_fixture(root.path(), &state, &mut descriptor);
            if case == "stale" {
                descriptor["expected_snapshot"]["revision"] = json!(99);
            }
            if case == "evidence" {
                std::fs::write(
                    root.path()
                        .join("artifacts/maintenance/evidence/retire.txt"),
                    "changed",
                )
                .unwrap();
            }
            let mut request = json!({"operation":"register","retire_group_source":descriptor});
            if case == "mixed" {
                request["refresh_group"] = json!({"id":"legacy"});
            }
            let denied = root
                .path()
                .join("artifacts/maintenance/evidence/retire.txt");
            let authorize = |path: &Path, _: crate::AccessMode| {
                if case == "denied" && path == denied {
                    Err("retirement evidence permission denied".into())
                } else {
                    Ok(())
                }
            };
            assert!(
                crate::dispatch(root.path(), request, &authorize).is_err(),
                "case {case} unexpectedly accepted"
            );
            assert_eq!(
                std::fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
                before,
                "case {case} changed state"
            );
        }
    }

    #[test]
    fn reused_group_plans_keep_current_overlap_protection_and_run_inputs() {
        fn comparable_review(mut review: Value) -> Value {
            // Response times are generated after hashing and differ between
            // observations. Registered measurement time remains bound to item.
            let full = review["verification"] == "full";
            let fields = review.as_object_mut().unwrap();
            assert!(fields.remove("observed_at_ms").unwrap().is_u64());
            if full {
                assert!(fields.remove("measured_at_ms").unwrap().is_u64());
            }
            review
        }
        let comparable_reviews = |reviews: BTreeMap<String, Value>| {
            reviews
                .into_iter()
                .map(|(id, review)| (id, comparable_review(review)))
                .collect::<BTreeMap<_, _>>()
        };
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("generated")).unwrap();
        std::fs::write(root.path().join("generated/membership.json"), "{}").unwrap();
        let config_bytes = serde_json::to_vec(&json!({"schema_version":1,"project_id":"reuse","managed_roots":["generated"],"bundles":[]})).unwrap();
        std::fs::write(root.path().join("project-maintenance.json"), &config_bytes).unwrap();
        let members = ["a", "b"].map(|id| {
            std::fs::write(root.path().join("generated").join(id), id).unwrap();
            json!({"id":id,"path":format!("generated/{id}"),"kind":"fixture","owner":"test","generated":true,"protection_known":true,"references":[],"lifecycle_role":"artifact"})
        });
        let allow = |_: &Path, _: crate::AccessMode| Ok(());
        crate::dispatch(root.path(), json!({"operation":"register","group":{"id":"g","kind":"run","owner":"test","membership_complete":true,"provenance_ref":"fixture","membership_source":"generated/membership.json","members":members}}), &allow).unwrap();
        let config: Config = serde_json::from_slice(&config_bytes).unwrap();
        let config_identity = hash(&config_bytes).unwrap();
        let mut state: State = serde_json::from_slice(
            &std::fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
        )
        .unwrap();
        let auth = crate::Context::new(&allow);
        // A callback may change the reservation during the member/source
        // observation. Both entry points must reject that observation, including
        // replacement by a different file containing identical bytes.
        let reservation_path = root
            .path()
            .join("artifacts/maintenance/lifecycles/reservations")
            .join(format!("{}.json", hash(&"g").unwrap()));
        std::fs::create_dir_all(reservation_path.parent().unwrap()).unwrap();
        let record = json!({"schema":1,"id":"g","token":"review-owner","members":[]});
        let record_bytes = serde_json::to_vec(&record).unwrap();
        for current in [false, true] {
            for mutation in ["bytes", "identity", "remove", "appear"] {
                let cohort = batch(
                    root.path(),
                    &config,
                    &config_identity,
                    &state,
                    "g",
                    &auth,
                    Verification::Registered,
                )
                .unwrap();
                if mutation != "appear" {
                    std::fs::write(&reservation_path, &record_bytes).unwrap();
                }
                let injected = std::cell::Cell::new(false);
                let authorize = |path: &Path, _: crate::AccessMode| {
                    if path == root.path().join("generated/membership.json")
                        && !injected.replace(true)
                    {
                        match mutation {
                            "bytes" => {
                                let mut changed = record.clone();
                                changed["token"] = json!("changed-owner");
                                std::fs::write(
                                    &reservation_path,
                                    serde_json::to_vec(&changed).unwrap(),
                                )
                                .unwrap();
                            }
                            "identity" => {
                                std::fs::rename(
                                    &reservation_path,
                                    reservation_path.with_extension("old"),
                                )
                                .unwrap();
                                std::fs::write(&reservation_path, &record_bytes).unwrap();
                            }
                            "remove" => std::fs::remove_file(&reservation_path).unwrap(),
                            "appear" => {
                                std::fs::write(&reservation_path, &record_bytes).unwrap();
                            }
                            _ => unreachable!(),
                        }
                    }
                    Ok(())
                };
                let context = crate::Context::new(&authorize);
                if mutation != "appear" {
                    context
                        .reservations
                        .borrow_mut()
                        .insert("g".into(), record.clone());
                }
                let result = if current {
                    cohort
                        .current(
                            root.path(),
                            &config,
                            &config_identity,
                            &state,
                            &context,
                            "a",
                        )
                        .map(|_| ())
                } else {
                    batch(
                        root.path(),
                        &config,
                        &config_identity,
                        &state,
                        "g",
                        &context,
                        Verification::Registered,
                    )
                    .map(|_| ())
                };
                assert!(injected.get());
                assert!(result.is_err(), "current={current}, mutation={mutation}");
                if reservation_path.exists() {
                    std::fs::remove_file(&reservation_path).unwrap();
                }
                if mutation == "identity" {
                    std::fs::remove_file(reservation_path.with_extension("old")).unwrap();
                }
            }
        }
        // Reusing the pure plan must preserve the original member and grouped
        // token bytes, including the full-verification path.
        for verification in [Verification::Registered, Verification::Full] {
            let cohort = batch(
                root.path(),
                &config,
                &config_identity,
                &state,
                "g",
                &auth,
                verification,
            )
            .unwrap();
            let expected = cohort
                .members
                .iter()
                .map(|(id, item)| {
                    (
                        id.clone(),
                        review_ungrouped(
                            root.path(),
                            &config,
                            &config_identity,
                            &state,
                            item,
                            &auth,
                            verification,
                        )
                        .unwrap(),
                    )
                })
                .collect::<BTreeMap<_, _>>();
            assert_eq!(
                comparable_reviews(cohort.reviews.clone()),
                comparable_reviews(expected.clone())
            );
            assert_eq!(
                comparable_reviews(cohort.initial().unwrap()),
                comparable_reviews(
                    combine(&cohort.definition, &expected, &cohort.source, None).unwrap()
                )
            );
        }
        let cohort = batch(
            root.path(),
            &config,
            &config_identity,
            &state,
            "g",
            &auth,
            Verification::Registered,
        )
        .unwrap();
        let observed = cohort
            .current(root.path(), &config, &config_identity, &state, &auth, "a")
            .unwrap();
        assert_eq!(observed["token"], cohort.initial().unwrap()["a"]["token"]);
        let mut parent = state.items["a"].clone();
        parent["id"] = json!("parent");
        parent["references"] = json!(["active consumer"]);
        parent.as_object_mut().unwrap().remove("lifecycle_group_id");
        state.items.insert("parent".into(), parent);
        let protected = cohort
            .current(root.path(), &config, &config_identity, &state, &auth, "a")
            .unwrap();
        assert!(
            protected["blockers"]
                .as_array()
                .unwrap()
                .contains(&json!("overlapping registered item protected: \"parent\"")),
            "actual review: {protected}"
        );
        let initial_protected = batch(
            root.path(),
            &config,
            &config_identity,
            &state,
            "g",
            &auth,
            Verification::Registered,
        )
        .unwrap()
        .initial()
        .unwrap();
        assert_eq!(
            comparable_review(protected.clone()),
            comparable_review(initial_protected["a"].clone())
        );
        let plan = cohort.relations.borrow().as_ref().unwrap().clone();
        state.items.get_mut("parent").unwrap()["references"] = json!([]);
        state.revision += 1;
        let released = cohort
            .current(root.path(), &config, &config_identity, &state, &auth, "a")
            .unwrap();
        assert!(released["blockers"].as_array().unwrap().is_empty());
        assert_ne!(protected["token"], released["token"]);
        assert!(std::rc::Rc::ptr_eq(
            &plan,
            cohort.relations.borrow().as_ref().unwrap()
        ));
        state.runs.insert("unresolved".into(), json!({"steps":[{"producer_completed":false,"inputs":[{"path":state.items["a"]["path"]}]}]}));
        let active = cohort
            .current(root.path(), &config, &config_identity, &state, &auth, "a")
            .unwrap();
        assert!(
            active["blockers"]
                .as_array()
                .unwrap()
                .contains(&json!("active or unresolved related run"))
        );
        assert_ne!(released["token"], active["token"]);
        assert!(std::rc::Rc::ptr_eq(
            &plan,
            cohort.relations.borrow().as_ref().unwrap()
        ));
    }

    #[test]
    fn selected_combination_preserves_whole_group_evidence() {
        let group = json!({"id":"group","membership_complete":false,
            "membership_source":"source","membership_source_identity":"registered"});
        let source = json!({"status":"measured","identity":"changed",
            "blockers":["source protection"]});
        let reviews = BTreeMap::from([
            (
                "a".into(),
                json!({"token":"a-token","identity":"a-root","blockers":[]}),
            ),
            (
                "b".into(),
                json!({"token":"b-token","identity":"b-root","blockers":["sibling protection"]}),
            ),
        ]);
        let all = combine(&group, &reviews, &source, None).unwrap();
        let selected = combine(&group, &reviews, &source, Some("a")).unwrap();
        assert_eq!(selected.len(), 1);
        assert_eq!(selected["a"], all["a"]);
        assert_eq!(selected["a"]["group_member_ids"], json!(["a", "b"]));
        assert_eq!(selected["a"]["membership_source_observation"], source);
        assert_eq!(
            selected["a"]["blockers"],
            json!([
                "lifecycle group membership is incomplete",
                "lifecycle membership source changed or is unavailable; re-register full current membership",
                "source protection",
                "a lifecycle group member is protected"
            ])
        );

        let mut changed = reviews;
        changed.get_mut("b").unwrap()["token"] = json!("changed-sibling-token");
        let changed_selected = combine(&group, &changed, &source, Some("a")).unwrap();
        assert_ne!(
            selected["a"]["group_token"],
            changed_selected["a"]["group_token"]
        );
        assert_ne!(selected["a"]["token"], changed_selected["a"]["token"]);

        changed.get_mut("b").unwrap()["blockers"] = Value::Null;
        assert_eq!(
            combine(&group, &changed, &source, Some("a")).unwrap_err(),
            "invalid member review"
        );
    }
}

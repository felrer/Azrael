//! Explicit version/run/work cohorts share one reviewed retain/delete fate.
use crate::{
    Auth, Config, State, hash, now_ms, paths, prepare_registered_item, review_ungrouped, string,
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
    let mut prepared = BTreeMap::new();
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
        member = prepare_registered_item(root, member, previous_member, auth)?;
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
        group["membership_source_identity"] = observed["identity"].clone();
    } else {
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

pub(crate) struct Batch {
    definition: Value,
    pub members: BTreeMap<String, Value>,
    reviews: BTreeMap<String, Value>,
    source: Value,
    source_members: BTreeMap<String, Value>,
    pub completed: BTreeSet<String>,
}
fn source_measurement(
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
) -> Result<Batch, String> {
    let group = state
        .groups
        .get(group_id)
        .ok_or("unknown lifecycle group")?;
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
        reviews.insert(
            id.clone(),
            review_ungrouped(root, config, config_identity, state, item, auth)?,
        );
        members.insert(id, item.clone());
    }
    Ok(Batch {
        definition: definition(group),
        members,
        reviews,
        source: observe_source(root, group, &source_members, auth),
        source_members,
        completed: BTreeSet::new(),
    })
}
fn combine(
    group: &Value,
    reviews: &BTreeMap<String, Value>,
    source: &Value,
) -> Result<BTreeMap<String, Value>, String> {
    let evidence=reviews.iter().map(|(id,review)|json!({"id":id,"token":review["token"],"identity":review["identity"],"blockers":review["blockers"]})).collect::<Vec<_>>();
    let token =
        hash(&json!({"group":definition(group),"members":evidence,"membership_source":source}))?;
    let protected = reviews
        .values()
        .any(|review| !review["blockers"].as_array().is_some_and(Vec::is_empty));
    let mut combined = BTreeMap::new();
    for (id, review) in reviews {
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
        review["group_member_ids"] = json!(reviews.keys().collect::<Vec<_>>());
        review["membership_source_observation"] = source.clone();
        combined.insert(id.clone(), review);
    }
    Ok(combined)
}
impl Batch {
    pub fn initial(&self) -> Result<BTreeMap<String, Value>, String> {
        combine(&self.definition, &self.reviews, &self.source)
    }
    pub fn current(
        &self,
        root: &Path,
        config: &Config,
        config_identity: &str,
        state: &State,
        auth: Auth<'_>,
    ) -> Result<BTreeMap<String, Value>, String> {
        let group_id = string(&self.definition, "id")?;
        let current = state.groups.get(group_id).ok_or("group disappeared")?;
        if definition(current) != self.definition {
            return Err("lifecycle group membership or metadata changed".into());
        }
        let mut reviews = BTreeMap::new();
        for (id, item) in &self.members {
            if self.completed.contains(id) {
                let path = Path::new(string(item, "path")?);
                if paths::checked_metadata(root, path, auth)?.is_some() {
                    return Err("deleted lifecycle member reappeared".into());
                }
                reviews.insert(id.clone(), self.reviews[id].clone());
            } else {
                reviews.insert(
                    id.clone(),
                    review_ungrouped(root, config, config_identity, state, item, auth)?,
                );
            }
        }
        combine(
            &self.definition,
            &reviews,
            &observe_source(root, &self.definition, &self.source_members, auth),
        )
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
            )?,
        );
    }
    let mut groups = Vec::new();
    for id in group_ids {
        let batch = batch(root, config, config_identity, state, &id, auth)?;
        reviews.extend(batch.initial()?);
        groups.push(summary(state, &state.groups[&id]));
    }
    if reviews.len() > 200 {
        return Err("expanded review exceeds 200 live members; select fewer groups".into());
    }
    Ok(json!({"items":reviews.into_values().collect::<Vec<_>>(),"groups":groups}))
}

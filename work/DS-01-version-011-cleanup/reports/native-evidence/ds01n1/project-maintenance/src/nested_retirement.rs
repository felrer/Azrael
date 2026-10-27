//! Retire one nested claim while retaining its enclosing claim for a fresh review.
//! No reference, membership, permission or producer guard is waived.
use crate::{Auth, State, groups, paths, retirement, string};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Retirement {
    pub(crate) parent: String,
    pub(crate) child: String,
    owner: String,
    reason: String,
    evidence_ref: String,
}

pub(crate) fn pair(auth: Auth<'_>, item: &Value, other: &Value) -> bool {
    auth.nested_retirement.borrow().as_ref().is_some_and(|r| {
        (item["id"] == r.parent && other["id"] == r.child)
            || (item["id"] == r.child && other["id"] == r.parent)
    })
}

pub(crate) fn evidence_identity(root: &Path, auth: Auth<'_>) -> Result<Option<String>, String> {
    auth.nested_retirement.borrow().as_ref().map(|r| {
        retirement::read_evidence(root, &r.evidence_ref, auth)
    }).transpose()
}

pub(crate) fn validate(root: &Path, state: &State, request: &Value, auth: Auth<'_>) -> Result<Option<Retirement>, String> {
    let Some(value) = request.get("retire_nested_member") else { return Ok(None) };
    let r: Retirement = serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
    if !matches!(string(request, "operation")?, "review" | "apply")
        || [&r.parent, &r.child, &r.owner, &r.reason, &r.evidence_ref].iter().any(|s| s.trim().is_empty())
        || r.parent == r.child
        || request.get("retire_managed_roots").is_some()
    {
        return Err("invalid nested retirement descriptor or operation".into());
    }
    retirement::read_evidence(root, &r.evidence_ref, auth)?;
    let parent = state.items.get(&r.parent).ok_or("unknown nested parent")?;
    let child = state.items.get(&r.child).ok_or("unknown nested child")?;
    let parent_path = paths::resolve(root, Path::new(string(parent, "path")?))?;
    let child_path = paths::resolve(root, Path::new(string(child, "path")?))?;
    let evidence = paths::resolve(root, Path::new(&r.evidence_ref))?;
    if !paths::within(&child_path, &parent_path) || paths::within(&parent_path, &child_path)
        || paths::within(&evidence, &parent_path)
        || groups::id(parent) == groups::id(child)
    {
        return Err("nested retirement requires distinct groups, strict containment and external evidence".into());
    }
    for id in [&r.parent, &r.child] {
        let item = &state.items[id];
        let group_id = groups::id(item).ok_or("nested retirement requires grouped items")?;
        let group = state.groups.get(group_id).ok_or("unknown nested group")?;
        if item["owner"] != r.owner || group["owner"] != r.owner
            || group["membership_complete"] != true
            || groups::live_ids(root, state, group, auth)? != vec![id.clone()]
        {
            return Err("nested retirement requires same owner and exactly one live member per complete group".into());
        }
        if request["operation"] == "review" {
            let selected = request["ids"].as_array().is_some_and(|ids| ids.iter().any(|v| v == id))
                || request["group_ids"].as_array().is_some_and(|ids| ids.iter().any(|v| v == group_id));
            if !selected { return Err("both nested groups require explicit review selection".into()) }
        } else {
            let choices = request["decisions"].as_array().ok_or("missing nested decisions")?;
            if choices.len() != 2 || !choices.iter().any(|c| c["id"] == *id && c["decision"] == if id == &r.parent { "defer" } else { "delete" }) {
                return Err("nested retirement requires exactly parent defer and child delete".into());
            }
        }
    }
    Ok(Some(r))
}

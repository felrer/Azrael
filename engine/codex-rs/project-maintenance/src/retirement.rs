//! Explicit owner authority only relaxes the exact managed-root guard.
//! Cohort, permission, protection, source and durable deletion checks still run.
use crate::{Auth, Config, State, groups, hash, paths, string};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::Path;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Retirement {
    owner: String,
    reason: String,
    evidence_ref: String,
    ids: Vec<String>,
    #[serde(skip)]
    pub(crate) evidence_identity: String,
}

pub(crate) fn selected(auth: Auth<'_>, item: &Value) -> bool {
    auth.retirement.borrow().as_ref().is_some_and(|request| {
        item["id"]
            .as_str()
            .is_some_and(|id| request.ids.iter().any(|selected| selected == id))
    })
}

pub(crate) fn read_evidence(
    root: &Path,
    reference: &str,
    auth: Auth<'_>,
) -> Result<String, String> {
    let evidence = paths::resolve(root, Path::new(reference))?;
    if !paths::within(&evidence, &root.join("artifacts/maintenance/evidence")) {
        return Err(
            "retirement evidence must be in artifacts/maintenance/evidence within project".into(),
        );
    }
    if !paths::checked_metadata(root, &evidence, auth)?
        .is_some_and(|metadata| metadata.is_file() && metadata.len() <= 1_048_576)
    {
        return Err(
            "retirement evidence must be an existing readable file of at most 1 MiB".into(),
        );
    }
    use std::io::Read;
    let mut bytes = Vec::new();
    std::fs::File::open(&evidence)
        .map_err(|e| e.to_string())?
        .take(1_048_577)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 1_048_576 {
        return Err("retirement evidence exceeds 1 MiB".into());
    }
    hash(&bytes)
}

pub(crate) fn evidence_identity(root: &Path, auth: Auth<'_>) -> Result<Option<String>, String> {
    auth.retirement
        .borrow()
        .as_ref()
        .map(|descriptor| read_evidence(root, &descriptor.evidence_ref, auth))
        .transpose()
}

pub(crate) fn validate(
    root: &Path,
    config: Option<&Config>,
    state: &State,
    request: &Value,
    auth: Auth<'_>,
) -> Result<Option<Retirement>, String> {
    let Some(descriptor) = request.get("retire_managed_roots") else {
        return Ok(None);
    };
    if !matches!(string(request, "operation")?, "review" | "apply") {
        return Err("retire_managed_roots requires review or apply".into());
    }
    let mut descriptor: Retirement =
        serde_json::from_value(descriptor.clone()).map_err(|e| e.to_string())?;
    if [
        &descriptor.owner,
        &descriptor.reason,
        &descriptor.evidence_ref,
    ]
    .iter()
    .any(|s| s.trim().is_empty())
    {
        return Err("retirement owner, reason and evidence_ref must be nonblank".into());
    }
    let unique = descriptor.ids.iter().collect::<BTreeSet<_>>();
    if descriptor.ids.is_empty()
        || descriptor.ids.len() > 200
        || unique.len() != descriptor.ids.len()
        || descriptor.ids.iter().any(|id| id.trim().is_empty())
    {
        return Err("retirement requires 1..200 unique exact item ids".into());
    }
    let config = config.ok_or("retirement requires valid project config")?;
    descriptor.evidence_identity = read_evidence(root, &descriptor.evidence_ref, auth)?;
    let overlaps = |a: &Path, b: &Path| paths::within(a, b) || paths::within(b, a);
    for id in &descriptor.ids {
        let item = state.items.get(id).ok_or("unknown retirement item")?;
        let group_id = groups::id(item).ok_or("retirement requires lifecycle grouped items")?;
        let group = state
            .groups
            .get(group_id)
            .ok_or("unknown retirement lifecycle group")?;
        if item["id"] != *id
            || item["owner"] != descriptor.owner
            || group["owner"] != descriptor.owner
            || group["membership_complete"] != true
            || !group["members"]
                .as_array()
                .is_some_and(|members| members.iter().any(|member| member == id))
        {
            return Err(
                "retirement requires exact item and group owner and complete membership".into(),
            );
        }
        let selected = if request["operation"] == "apply" {
            request["decisions"]
                .as_array()
                .is_some_and(|choices| choices.iter().any(|choice| choice["id"] == *id))
        } else {
            request["ids"].as_array().is_some_and(|ids| {
                ids.iter().any(|selected| {
                    selected == id
                        || selected
                            .as_str()
                            .and_then(|id| state.items.get(id))
                            .is_some_and(|other| groups::id(other) == Some(group_id))
                })
            }) || request["group_ids"]
                .as_array()
                .is_some_and(|ids| ids.iter().any(|selected| selected == group_id))
        };
        if !selected {
            return Err("retirement id must be included in the review or apply selection".into());
        }
        let target = paths::resolve(root, Path::new(string(item, "path")?))?;
        if !paths::within(&target, root)
            || paths::within(root, &target)
            || paths::reserved(root, &target)
        {
            return Err("retirement target is root, reserved or outside project".into());
        }
        let mut exact = 0;
        for configured in &config.managed_roots {
            let configured = paths::resolve(root, configured)?;
            if paths::within(&target, &configured) && paths::within(&configured, &target) {
                exact += 1;
            } else if overlaps(&target, &configured) {
                return Err("retirement refuses overlapping configured managed roots".into());
            }
        }
        if exact != 1 {
            return Err("retirement target must equal one configured managed root".into());
        }
        for protected in &config.protected_paths {
            if overlaps(&target, &paths::resolve(root, protected)?) {
                return Err("retirement target overlaps configured protection".into());
            }
        }
        for other in state.items.values() {
            if other["id"] != *id && overlaps(&target, Path::new(string(other, "path")?)) {
                return Err("retirement target overlaps another registered item".into());
            }
            if let Some(source) = other["source_path"].as_str() {
                if overlaps(&target, &paths::resolve(root, Path::new(source))?) {
                    return Err("retirement target overlaps registered original source".into());
                }
            }
        }
    }
    Ok(Some(descriptor))
}

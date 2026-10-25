//! Producer registry observations bind one owner and its actual consumers.
use crate::{AccessMode, Auth, hash, paths, string};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

pub(crate) struct CatalogLock<'a> {
    path: PathBuf,
    _file: std::fs::File,
    auth: Auth<'a>,
}
impl Drop for CatalogLock<'_> {
    fn drop(&mut self) {
        // Removal is ordinary deletion; an unexpected failure remains visible
        // as contention on the next operation rather than bypassing the lock.
        if (self.auth)(&self.path, AccessMode::Write).is_ok() {
            let _ = std::fs::remove_file(&self.path);
        }
        self.auth.catalog_locks.borrow_mut().remove(&self.path);
    }
}
pub(crate) fn lock_request<'a>(
    root: &Path,
    request: &Value,
    state: &crate::State,
    auth: Auth<'a>,
) -> Result<Vec<CatalogLock<'a>>, String> {
    let mut sources = BTreeSet::new();
    let mut add = |group: &Value| -> Result<(), String> {
        if group["membership_source_format"] == "producer_registry_v1" {
            sources.insert(paths::resolve(
                root,
                Path::new(string(group, "membership_source")?),
            )?);
        }
        Ok(())
    };
    match request["operation"].as_str() {
        Some("apply") => {
            for choice in request["decisions"].as_array().ok_or("missing decisions")? {
                if let Some(group) = state
                    .items
                    .get(string(choice, "id")?)
                    .and_then(crate::groups::id)
                    .and_then(|id| state.groups.get(id))
                {
                    add(group)?;
                }
            }
        }
        Some("register") if request.get("refresh_group").is_some() => {
            add(state
                .groups
                .get(string(&request["refresh_group"], "id")?)
                .ok_or("unknown lifecycle group")?)?;
        }
        _ => {}
    }
    let mut locks = Vec::new();
    for source in sources {
        paths::check(root, &source, auth)?;
        auth(&source, AccessMode::Write)?;
        let path = source.join("catalog.lock");
        paths::check(root, &path, auth)?;
        auth(&path, AccessMode::Write)?;
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| format!("producer catalog lock unavailable: {e}"))?;
        auth.catalog_locks.borrow_mut().insert(path.clone());
        locks.push(CatalogLock {
            path,
            _file: file,
            auth,
        });
    }
    Ok(locks)
}
fn check_lock(root: &Path, source: &Path, auth: Auth<'_>) -> Result<(), String> {
    let path = source.join("catalog.lock");
    if !auth.catalog_locks.borrow().contains(&path)
        && paths::checked_metadata(root, &path, auth)?.is_some()
    {
        return Err("producer catalog writer is active".into());
    }
    Ok(())
}

fn nonblank(value: &Value, key: &str) -> Result<(), String> {
    if string(value, key)?.trim().is_empty() {
        return Err(format!("blank producer registry {key}"));
    }
    Ok(())
}
fn names(root: &Path, source: &Path, auth: Auth<'_>) -> Result<Vec<PathBuf>, String> {
    paths::check(root, source, auth)?;
    if !std::fs::symlink_metadata(source)
        .map_err(|e| e.to_string())?
        .is_dir()
    {
        return Err("producer registry must be a flat directory".into());
    }
    auth(source, AccessMode::Read)?;
    let mut names = Vec::new();
    for entry in std::fs::read_dir(source).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        paths::check(root, &path, auth)?;
        if !std::fs::symlink_metadata(&path)
            .map_err(|e| e.to_string())?
            .is_file()
        {
            return Err("producer registry contains a nonregular or nested entry".into());
        }
        if path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
        {
            names.push(path);
        }
    }
    names.sort();
    Ok(names)
}
fn read(root: &Path, path: &Path, auth: Auth<'_>) -> Result<Vec<u8>, String> {
    use std::io::Read;
    paths::check(root, path, auth)?;
    let before = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !before.is_file() || before.len() > 16 * 1024 * 1024 {
        return Err("invalid or oversized producer record".into());
    }
    auth(path, AccessMode::Read)?;
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 65536];
    loop {
        auth(path, AccessMode::Read)?;
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        if bytes.len() + count > 16 * 1024 * 1024 {
            return Err("oversized producer record".into());
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    paths::check(root, path, auth)?;
    let after = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
        || paths::platform_identity(&before) != paths::platform_identity(&after)
    {
        return Err("producer record changed while reading".into());
    }
    Ok(bytes)
}
fn validate(root: &Path, record: &Value, auth: Auth<'_>) -> Result<(), String> {
    for key in ["id", "kind", "owner", "state"] {
        nonblank(record, key)?;
    }
    if record["schema"] != 1
        || !["version", "run", "work"].contains(&string(record, "kind")?)
        || !["pending", "complete", "failed", "retained"].contains(&string(record, "state")?)
        || !record["membership_complete"].is_boolean()
    {
        return Err("invalid producer registry record".into());
    }
    if !record["version"].is_null() {
        nonblank(record, "version")?;
    }
    if let Some(producer) = record.get("producer") {
        let outcome = string(producer, "outcome")?;
        let exit = &producer["exit_code"];
        if producer["status"] != "stopped"
            || !["success", "failure", "unknown"].contains(&outcome)
            || !(exit.is_null() || exit.as_i64().is_some())
            || (outcome == "success" && exit != 0)
            || (outcome == "failure" && exit == 0)
            || (outcome == "unknown" && !exit.is_null())
            || !producer.get("exit_code").is_some()
            || !string(producer, "evidence_sha256")?
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || string(producer, "evidence_sha256")?.len() != 64
        {
            return Err("invalid producer stop evidence".into());
        }
        nonblank(producer, "reason")?;
        nonblank(producer, "evidence_ref")?;
    }
    let members = record["members"]
        .as_array()
        .filter(|m| !m.is_empty())
        .ok_or("invalid producer members")?;
    for member in members {
        for key in ["generated", "protection_known"] {
            if member.get(key).is_some_and(|value| !value.is_boolean()) {
                return Err(format!("invalid producer member {key}"));
            }
        }
        nonblank(member, "role")?;
        let path = Path::new(string(member, "path")?);
        if !path.is_absolute() {
            return Err("producer member must be absolute".into());
        }
        let path = paths::resolve(root, path)?;
        paths::check(root, &path, auth)?;
        let allowed = [root.join("artifacts"), root.join("engine/codex-rs/target")];
        if !allowed
            .iter()
            .any(|base| paths::within(&path, base) && path != *base)
            || paths::within(&path, &root.join("artifacts/maintenance"))
            || path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .components()
                .any(|part| {
                    [".git", ".azrael-ex", ".codex", ".ssh"]
                        .iter()
                        .any(|name| part.as_os_str() == *name)
                })
        {
            return Err("producer member overlaps source or control state".into());
        }
    }
    for reference in record["references"]
        .as_array()
        .ok_or("invalid producer references")?
    {
        nonblank(reference, "id")?;
        nonblank(reference, "reason")?;
    }
    Ok(())
}
fn canonical(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(k, v)| (k.clone(), canonical(v)))
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .collect(),
        ),
        Value::Array(array) => Value::Array(array.iter().map(canonical).collect()),
        value => value.clone(),
    }
}

fn catalog(root: &Path, source: &Path, auth: Auth<'_>) -> Result<BTreeMap<String, Value>, String> {
    check_lock(root, source, auth)?;
    let mut records = BTreeMap::new();
    for path in names(root, source, auth)? {
        let bytes = read(root, &path, auth)?;
        let record: Value =
            serde_json::from_slice(&bytes).map_err(|e| format!("invalid producer JSON: {e}"))?;
        validate(root, &record, auth)?;
        if read(root, &path, auth)? != bytes {
            return Err("producer record bytes changed while observing".into());
        }
        let id = string(&record, "id")?.to_owned();
        if records.insert(id, record).is_some() {
            return Err("duplicate producer id".into());
        }
    }
    check_lock(root, source, auth)?;
    Ok(records)
}
fn relevant(records: &BTreeMap<String, Value>, id: &str) -> Vec<Value> {
    records
        .iter()
        .filter(|(record_id, record)| {
            record_id.as_str() == id
                || record["references"].as_array().is_some_and(|references| {
                    references.iter().any(|reference| reference["id"] == id)
                })
        })
        .map(|(_, record)| canonical(record))
        .collect()
}
fn lifecycle_role(role: &str) -> &'static str {
    let words = role
        .split(|c: char| c == '-' || c == '_' || c.is_whitespace())
        .map(str::to_lowercase)
        .collect::<Vec<_>>();
    if words
        .iter()
        .any(|word| matches!(word.as_str(), "log" | "logs"))
    {
        "log"
    } else if words.iter().any(|word| {
        matches!(
            word.as_str(),
            "report" | "reports" | "evidence" | "verification"
        )
    }) {
        "evidence"
    } else if words
        .iter()
        .any(|word| matches!(word.as_str(), "snapshot" | "snapshots" | "input" | "inputs"))
    {
        "snapshot"
    } else {
        "artifact"
    }
}

/// Planned outputs may never have existed. Only a complete, settled producer
/// with explicit ownership evidence can introduce their absent native records.
pub(crate) fn validate_absent_adoption(
    group: &Value,
    items: &BTreeMap<String, Value>,
    absent: &BTreeSet<String>,
    observed: &Value,
) -> Result<(), String> {
    if group["membership_source_format"] != "producer_registry_v1"
        || group["membership_complete"] != true
        || observed["settled"] != true
        || observed["membership_matches"] != true
        || !observed["blockers"].as_array().is_some_and(Vec::is_empty)
    {
        return Err("absent adoption requires a complete verified producer contract".into());
    }
    let members = observed["owner"]["members"]
        .as_array()
        .ok_or("absent adoption requires producer members")?;
    for id in absent {
        let item = &items[id];
        let path = Path::new(string(item, "path")?);
        if item["generated"] != true
            || item["protection_known"] != true
            || members
                .iter()
                .filter(|member| {
                    paths::within(Path::new(member["path"].as_str().unwrap_or("")), path)
                })
                .any(|member| member["generated"] != true || member["protection_known"] != true)
        {
            return Err(
                "absent adoption requires explicit producer generation and protection evidence"
                    .into(),
            );
        }
    }
    Ok(())
}

pub(crate) fn observe(
    root: &Path,
    source: &Path,
    group: &Value,
    items: &BTreeMap<String, Value>,
    auth: Auth<'_>,
) -> Result<Value, String> {
    let id = string(group, "id")?;
    // Revalidate the catalog to catch new consumers and changes to earlier
    // records. Changes to other validated producers do not alter this group.
    let first = catalog(root, source, auth)?;
    let records = catalog(root, source, auth)?;
    if relevant(&first, id) != relevant(&records, id) {
        return Err("relevant producer records changed while observing".into());
    }
    let owner = records.get(id).ok_or("producer owner record missing")?;
    let mut blockers = Vec::<String>::new();
    if owner["kind"] != group["kind"]
        || owner["owner"] != group["owner"]
        || owner["version"] != group["version"]
    {
        blockers.push("producer owner metadata differs from registered group".into());
    }
    let settled = owner["membership_complete"] == true
        && if let Some(producer) = owner.get("producer") {
            producer["outcome"] == "success" || producer["outcome"] == "failure"
        } else {
            owner["state"] == "complete"
        };
    if !settled {
        blockers.push("producer owner membership is not complete".into());
    }
    let members = owner["members"].as_array().ok_or("invalid owner members")?;
    let mut projected = Vec::new();
    for (index, member) in members.iter().enumerate() {
        let path = Path::new(string(member, "path")?);
        if members.iter().enumerate().any(|(other_index, other)| {
            let other = Path::new(other["path"].as_str().unwrap_or(""));
            other_index != index
                && paths::within(path, other)
                && (!paths::within(other, path) || other_index < index)
        }) {
            continue;
        }
        projected.push((path, string(member, "role")?));
    }
    let mut matched = BTreeSet::new();
    for (path, role) in &projected {
        if members.iter().any(|member| {
            paths::within(Path::new(member["path"].as_str().unwrap_or("")), path)
                && (member["generated"] == false || member["protection_known"] == false)
        }) {
            blockers.push("producer member ownership or protection is unconfirmed".into());
        }
        if let Some((id, _)) = items.iter().find(|(_, item)| {
            let registered = Path::new(item["path"].as_str().unwrap_or(""));
            paths::within(path, registered)
                && paths::within(registered, path)
                && item.get("role").unwrap_or(&item["kind"]).as_str() == Some(*role)
                && item["lifecycle_role"] == lifecycle_role(role)
                && item["owner"] == owner["owner"]
        }) {
            matched.insert(id);
        }
    }
    let membership_matches = projected.len() == items.len() && matched.len() == items.len();
    if !membership_matches {
        blockers.push(
            "producer projected membership differs from registered member roots or roles".into(),
        );
    }
    let mut references = Vec::new();
    for (consumer_id, record) in &records {
        let inbound = record["references"]
            .as_array()
            .is_some_and(|references| references.iter().any(|reference| reference["id"] == id));
        if inbound {
            for reference in record["references"]
                .as_array()
                .ok_or("invalid producer references")?
            {
                if reference["id"] == id {
                    references.push(json!(format!(
                        "{consumer_id}:{}",
                        string(reference, "reason")?
                    )));
                }
            }
            blockers.push(format!(
                "producer inbound consumer protects group: {consumer_id}"
            ));
        }
    }
    Ok(
        json!({"status":"measured","identity":hash(&relevant(&records, id))?,"blockers":blockers,
        "owner":owner,"membership_matches":membership_matches,"settled":settled,"references":references}),
    )
}

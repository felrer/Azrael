use crate::{AccessMode, Auth, State, paths};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

pub(crate) struct Store<'a> {
    pub state: State,
    root: PathBuf,
    directory: PathBuf,
    handle: Option<crate::lock_recovery::Sentinel<'a>>,
    auth: Auth<'a>,
    base: serde_json::Value,
    suspended: bool,
}
impl<'a> Store<'a> {
    pub fn open(root: &Path, auth: Auth<'a>, mutate: bool) -> Result<Self, String> {
        let directory = root.join("artifacts/maintenance");
        if !mutate {
            let manifest = directory.join("manifest.json");
            paths::check(root, &manifest, auth)?;
            let state = match fs::read(&manifest) {
                Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string())?,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => State::default(),
                Err(e) => return Err(e.to_string()),
            };
            let base = serde_json::to_value(&state).map_err(|e| e.to_string())?;
            return Ok(Self {
                state,
                root: root.to_owned(),
                directory,
                handle: None,
                auth,
                base,
                suspended: false,
            });
        }
        for p in [root.join("artifacts"), directory.clone()] {
            paths::check(root, &p, auth)?;
            if !p.exists() {
                auth(p.parent().ok_or("missing state parent")?, AccessMode::Write)?;
                auth(&p, AccessMode::Write)?;
                fs::create_dir(&p).map_err(|e| e.to_string())?;
            }
        }
        let lock = directory.join("maintenance.lock");
        let handle = crate::lock_recovery::Sentinel::acquire(root, &lock, "maintenance", auth)?;
        let manifest = directory.join("manifest.json");
        // Once acquired, errors release only our own lock through Drop.
        let mut store = Self {
            state: State::default(),
            root: root.to_owned(),
            directory,
            handle: Some(handle),
            auth,
            base: serde_json::Value::Null,
            suspended: false,
        };
        paths::check(root, &manifest, auth)?;
        if manifest.exists() {
            store.state = serde_json::from_slice(&fs::read(manifest).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        }
        store.base = serde_json::to_value(&store.state).map_err(|e| e.to_string())?;
        Ok(store)
    }
    /// Physical deletion is protected by per-cohort reservations, while each
    /// durable intent/result remains an independent short state transaction.
    pub fn suspend(&mut self) -> Result<(), String> {
        let handle = self.handle.take().ok_or("state is not exclusively held")?;
        handle.release()?;
        self.suspended = true;
        Ok(())
    }
    /// Re-enter the state transaction before the caller acquires catalog locks.
    pub fn resume(&mut self) -> Result<(), String> {
        if !self.suspended || self.handle.is_some() {
            return Err("state is not suspended".into());
        }
        let handle = crate::lock_recovery::Sentinel::acquire(
            &self.root,
            &self.directory.join("maintenance.lock"),
            "maintenance",
            self.auth,
        )?;
        let current = self.current(self.auth)?;
        let local = serde_json::to_value(&self.state).map_err(|e| e.to_string())?;
        let merged = merge(&self.base, &local, current.clone())?;
        self.state = serde_json::from_value(merged).map_err(|e| e.to_string())?;
        self.base = current;
        self.handle = Some(handle);
        self.suspended = false;
        Ok(())
    }
    fn current(&self, auth: Auth<'_>) -> Result<serde_json::Value, String> {
        let manifest = self.directory.join("manifest.json");
        paths::check(&self.root, &manifest, auth)?;
        auth(&manifest, AccessMode::Read)?;
        match fs::read(&manifest) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                serde_json::to_value(State::default()).map_err(|e| e.to_string())
            }
            Err(e) => Err(e.to_string()),
        }
    }
    pub fn save(&mut self, auth: Auth<'_>) -> Result<(), String> {
        if self.handle.is_none() && !self.suspended {
            return Err("read-only state cannot be saved".into());
        }
        let transaction = if self.suspended {
            Some(crate::lock_recovery::Sentinel::acquire(
                &self.root,
                &self.directory.join("maintenance.lock"),
                "maintenance",
                self.auth,
            )?)
        } else {
            None
        };
        if self.suspended {
            let current = self.current(auth)?;
            let local = serde_json::to_value(&self.state).map_err(|e| e.to_string())?;
            let merged = merge(&self.base, &local, current)?;
            self.state = serde_json::from_value(merged).map_err(|e| e.to_string())?;
        }
        self.state.revision += 1;
        let manifest = self.directory.join("manifest.json");
        let temporary = self.directory.join("manifest.pending");
        paths::check(&self.root, &manifest, auth)?;
        paths::check(&self.root, &temporary, auth)?;
        for p in [&self.directory, &manifest, &temporary] {
            auth(p, AccessMode::Write)?;
        }
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| format!("state pending file requires recovery: {e}"))?;
        file.write_all(&serde_json::to_vec(&self.state).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(temporary, manifest).map_err(|e| e.to_string())?;
        self.base = serde_json::to_value(&self.state).map_err(|e| e.to_string())?;
        drop(transaction);
        Ok(())
    }
    pub fn authorize_save(&self, auth: Auth<'_>) -> Result<(), String> {
        for path in [
            &self.directory,
            self.directory.join("manifest.json").as_path(),
            self.directory.join("manifest.pending").as_path(),
        ] {
            paths::check(&self.root, path, auth)?;
            auth(path, AccessMode::Write)?;
        }
        Ok(())
    }
}

/// Compare each changed identity against its base, preserving unrelated commits.
fn merge(
    base: &serde_json::Value,
    local: &serde_json::Value,
    mut current: serde_json::Value,
) -> Result<serde_json::Value, String> {
    use serde_json::Value;
    use std::collections::BTreeSet;
    for section in ["items", "groups", "runs"] {
        let before = base[section].as_object().ok_or("invalid base state map")?;
        let after = local[section]
            .as_object()
            .ok_or("invalid local state map")?;
        let target = current[section]
            .as_object_mut()
            .ok_or("invalid current state map")?;
        let ids = before.keys().chain(after.keys()).collect::<BTreeSet<_>>();
        for id in ids {
            if before.get(id) == after.get(id) {
                continue;
            }
            if target.get(id) != before.get(id) {
                return Err(format!("state CAS conflict: {section}/{id}"));
            }
            match after.get(id) {
                Some(value) => {
                    target.insert(id.clone(), value.clone());
                }
                None => {
                    target.remove(id);
                }
            }
        }
    }
    let before = base["decisions"]
        .as_array()
        .ok_or("invalid base decisions")?;
    let after = local["decisions"]
        .as_array()
        .ok_or("invalid local decisions")?;
    let target = current["decisions"]
        .as_array_mut()
        .ok_or("invalid current decisions")?;
    // Legacy receipts are immutable. All mutable new decisions have stable IDs.
    for old in before {
        if old.get("decision_id").is_none() && !after.contains(old) {
            return Err("legacy decision mutation requires recovery".into());
        }
    }
    for value in after {
        if before.contains(value) {
            continue;
        }
        let id = value["decision_id"]
            .as_str()
            .ok_or("stable decision_id required")?;
        let old = before.iter().find(|entry| entry["decision_id"] == id);
        let index = target.iter().position(|entry| entry["decision_id"] == id);
        if index.map(|i| &target[i]) != old {
            return Err(format!("decision CAS conflict: {id}"));
        }
        match index {
            Some(i) => target[i] = value.clone(),
            None => target.push(value.clone()),
        }
    }
    // Revision belongs to the current committed state, not the stale local view.
    if current["revision"].as_u64().is_none() {
        current["revision"] = Value::from(0);
    }
    Ok(current)
}

#[cfg(test)]
mod transaction_tests {
    use super::merge;
    use serde_json::json;

    #[test]
    fn concurrent_unrelated_registration_and_receipts_survive_intent_completion() {
        let base = json!({"revision":4,"items":{"reserved":{"status":"pending"}},"groups":{},"runs":{},
            "decisions":[{"decision_id":"ours","status":"pending"}]});
        let mut local = base.clone();
        local["items"]["reserved"]["status"] = json!("deleted");
        local["decisions"][0]["status"] = json!("deleted");
        let mut concurrent = base.clone();
        concurrent["revision"] = json!(5);
        concurrent["items"]["other"] = json!({"owner":"another operation"});
        concurrent["decisions"]
            .as_array_mut()
            .unwrap()
            .insert(0, json!({"decision_id":"theirs","status":"deferred"}));
        let merged = merge(&base, &local, concurrent).unwrap();
        assert_eq!(merged["items"]["reserved"]["status"], "deleted");
        assert_eq!(merged["items"]["other"]["owner"], "another operation");
        assert_eq!(merged["decisions"][0]["decision_id"], "theirs");
        assert_eq!(merged["decisions"][1]["status"], "deleted");
        assert_eq!(merged["revision"], 5);
    }

    #[test]
    fn overlapping_owner_or_receipt_changes_are_conflicts() {
        let base = json!({"revision":1,"items":{"ours":{"owner":"a"}},"groups":{},"runs":{},
            "decisions":[{"decision_id":"ours","status":"pending"}]});
        let mut local = base.clone();
        local["items"]["ours"]["owner"] = json!("local");
        let mut current = base.clone();
        current["items"]["ours"]["owner"] = json!("other");
        assert!(
            merge(&base, &local, current)
                .unwrap_err()
                .contains("state CAS conflict")
        );
        let mut local = base.clone();
        local["decisions"][0]["status"] = json!("deleted");
        let mut current = base.clone();
        current["decisions"][0]["status"] = json!("failed");
        assert!(
            merge(&base, &local, current)
                .unwrap_err()
                .contains("decision CAS conflict")
        );
    }
}

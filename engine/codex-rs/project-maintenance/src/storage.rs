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
    partitioned: bool,
    disk_index: Option<serde_json::Value>,
    transition_guard: Vec<(PathBuf, Vec<u8>)>,
}
impl<'a> Store<'a> {
    pub fn open(
        root: &Path,
        auth: Auth<'a>,
        mutate: bool,
    ) -> Result<Self, crate::lock_recovery::LockAcquireError> {
        let directory = root.join("artifacts/maintenance");
        if !mutate {
            let (value, disk_index) = read_snapshot(root, &directory, auth, false)?;
            let state = serde_json::from_value(value).map_err(|e| e.to_string())?;
            let base = serde_json::to_value(&state).map_err(|e| e.to_string())?;
            return Ok(Self {
                state,
                root: root.to_owned(),
                directory,
                handle: None,
                auth,
                base,
                suspended: false,
                partitioned: disk_index.is_some(),
                disk_index,
                transition_guard: Vec::new(),
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
        // Once acquired, errors release only our own lock through Drop.
        let mut store = Self {
            state: State::default(),
            root: root.to_owned(),
            directory,
            handle: Some(handle),
            auth,
            base: serde_json::Value::Null,
            suspended: false,
            partitioned: false,
            disk_index: None,
            transition_guard: Vec::new(),
        };
        let (value, disk_index) = read_snapshot(root, &store.directory, auth, true)?;
        store.state = serde_json::from_value(value).map_err(|e| e.to_string())?;
        store.partitioned = disk_index.is_some();
        store.disk_index = disk_index;
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
    fn transaction(&self) -> Result<crate::lock_recovery::Sentinel<'a>, String> {
        // Wait only for acquisition, never replay a merge, write or commit.
        // Payload work stays outside this short state transaction.
        // Cancellation stops new payload work at its owner boundary. It must
        // not prevent saving already completed outcomes or clearing pending
        // decisions, so reconciliation acquisition keeps its bounded wait.
        crate::lock_recovery::wait_for_lock(self.auth.lock_wait.get(), || {
            crate::lock_recovery::Sentinel::acquire(
                &self.root,
                &self.directory.join("maintenance.lock"),
                "maintenance",
                self.auth,
            )
        })
    }
    /// One acquisition attempt, allowing the caller to retry the complete lock set.
    pub fn try_resume(&mut self) -> Result<(), crate::lock_recovery::LockAcquireError> {
        if !self.suspended || self.handle.is_some() {
            return Err("state is not suspended".into());
        }
        let handle = crate::lock_recovery::Sentinel::acquire(
            &self.root,
            &self.directory.join("maintenance.lock"),
            "maintenance",
            self.auth,
        )?;
        let (current, disk_index) = self.current(self.auth)?;
        let local = serde_json::to_value(&self.state).map_err(|e| e.to_string())?;
        let merged = merge(&self.base, &local, current.clone())?;
        self.state = serde_json::from_value(merged).map_err(|e| e.to_string())?;
        self.base = current;
        self.partitioned = disk_index.is_some();
        self.disk_index = disk_index;
        self.handle = Some(handle);
        self.suspended = false;
        Ok(())
    }
    /// Used only before any publication attempt. A failed reacquisition leaves
    /// the durable reservation protected for independent recovery.
    pub(crate) fn resume_before_abort(&mut self) -> Result<(), String> {
        if self.handle.is_some() && !self.suspended {
            return Ok(());
        }
        // Abort bookkeeping still needs custody after cancellation; no payload
        // operation is restarted by acquiring the state transaction here.
        crate::lock_recovery::wait_for_lock(self.auth.lock_wait.get(), || self.try_resume())
    }
    pub(crate) fn preintent_state(&self) -> Result<State, String> {
        if self.handle.is_none() || self.suspended {
            return Err("pre-intent abort requires maintenance custody".into());
        }
        let (current, _) = self.current(self.auth)?;
        serde_json::from_value(current).map_err(|error| error.to_string())
    }
    fn current(
        &self,
        auth: Auth<'_>,
    ) -> Result<(serde_json::Value, Option<serde_json::Value>), String> {
        let manifest = self.directory.join("manifest.json");
        let mut timing =
            crate::timing::Span::new("maintenance.phase", "state.read", Some(&manifest));
        timing.attempt();
        let result = read_snapshot(&self.root, &self.directory, auth, true);
        timing.outcome(if result.is_ok() { "read" } else { "error" });
        result
    }
    pub fn save(&mut self, auth: Auth<'_>) -> Result<(), String> {
        if self.handle.is_none() && !self.suspended {
            return Err("read-only state cannot be saved".into());
        }
        let mut save_timing =
            crate::timing::Span::new("maintenance.phase", "state.save", Some(&self.directory));
        save_timing.attempt();
        // This is a pure snapshot of our exclusively borrowed in-memory state.
        // Prepare it before acquiring the short reconciliation transaction.
        let local = crate::timing::phase("state.prepare_local", Some(&self.directory), || {
            serde_json::to_value(&self.state).map_err(|e| e.to_string())
        })?;
        let transaction = if self.suspended {
            Some(self.transaction()?)
        } else {
            None
        };
        let mut timing =
            crate::timing::Span::new("maintenance.phase", "state.commit", Some(&self.directory));
        timing.attempt();
        let mut logical = if self.suspended {
            let (current, disk_index) = self.current(auth)?;
            let (merged, changed_base) =
                crate::timing::phase("state.merge", Some(&self.directory), || {
                    // The common case has no intervening writer. Its base is
                    // already identical; avoid cloning the entire current state.
                    let changed_base = (current != self.base).then(|| current.clone());
                    Ok::<_, String>((merge(&self.base, &local, current)?, changed_base))
                })?;
            let logical = if merged == local {
                // The typed state already represents this exact normalized
                // snapshot. Keep every merge validation, without a Value ->
                // State -> Value round trip after an unchanged-base transaction.
                local
            } else {
                self.state =
                    crate::timing::phase("state.decode_merged", Some(&self.directory), || {
                        serde_json::from_value(merged).map_err(|e| e.to_string())
                    })?;
                crate::timing::phase("state.prepare_merged", Some(&self.directory), || {
                    serde_json::to_value(&self.state).map_err(|e| e.to_string())
                })?
            };
            if let Some(current) = changed_base {
                self.base = current;
            }
            self.partitioned = disk_index.is_some();
            self.disk_index = disk_index;
            logical
        } else {
            local
        };
        self.state.revision += 1;
        logical["revision"] = serde_json::Value::from(self.state.revision);
        let manifest = self.directory.join("manifest.json");
        let temporary = self.directory.join("manifest.pending");
        paths::check(&self.root, &manifest, auth)?;
        paths::check(&self.root, &temporary, auth)?;
        for p in [&self.directory, &manifest, &temporary] {
            auth(p, AccessMode::Write)?;
        }
        if paths::checked_metadata(&self.root, &temporary, auth)?.is_some() {
            return Err("state pending file requires recovery".into());
        }
        let encoded = if self.partitioned {
            Some(crate::timing::phase(
                "state.prepare_partition",
                Some(&self.directory),
                || {
                    crate::partitioned_storage::prepare(
                        &self.root,
                        &logical,
                        &self.base,
                        self.disk_index.as_ref(),
                        auth,
                    )
                },
            )?)
        } else {
            None
        };
        for p in [&self.directory, &manifest, &temporary] {
            paths::check(&self.root, p, auth)?;
            auth(p, AccessMode::Write)?;
        }
        // A format transition binds its original state, configuration and stop
        // evidence after every preparation/authorization callback has finished.
        for (path, expected) in &self.transition_guard {
            crate::lock_recovery::final_plain_path(path)?;
            if fs::read(path).map_err(|error| error.to_string())? != *expected {
                return Err("partition input changed before index commit".into());
            }
        }
        if let Some(previous) = &self.disk_index {
            crate::lock_recovery::final_plain_path(&manifest)?;
            let current: serde_json::Value =
                serde_json::from_slice(&fs::read(&manifest).map_err(|error| error.to_string())?)
                    .map_err(|error| error.to_string())?;
            if &current != previous {
                return Err("partitioned index changed before commit".into());
            }
        }
        let mut file = crate::timing::phase("state.open_pending", Some(&temporary), || {
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|e| format!("state pending file requires recovery: {e}"))
        })?;
        let bytes = crate::timing::phase("state.serialize", Some(&temporary), || {
            serde_json::to_vec(encoded.as_ref().unwrap_or(&logical)).map_err(|e| e.to_string())
        })?;
        crate::timing::phase("state.write_pending", Some(&temporary), || {
            file.write_all(&bytes).map_err(|e| e.to_string())
        })?;
        crate::timing::phase("state.sync_pending", Some(&temporary), || {
            file.sync_all().map_err(|e| e.to_string())
        })?;
        drop(file);
        crate::timing::phase("state.rename", Some(&manifest), || {
            fs::rename(&temporary, &manifest).map_err(|e| format!(
            "state commit rename manifest.pending -> manifest.json failed; pending snapshot retained; explicit validated pending recovery required (recover_refresh_pending accepts only protection_revision-only refresh): {e}"
        ))
        })?;
        self.base = logical;
        timing.outcome("committed");
        if let Some(encoded) = encoded {
            crate::timing::phase("state.collect_obsolete", Some(&self.directory), || {
                if let Some(previous) = &self.disk_index {
                    crate::partitioned_storage::collect_obsolete(
                        &self.root, &encoded, previous, auth,
                    )?;
                } else {
                    crate::partitioned_storage::collect(&self.root, &encoded, auth)?;
                }
                Ok::<_, String>(())
            })?;
            self.disk_index = Some(encoded);
        }
        drop(transaction);
        save_timing.outcome("committed");
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

/// Partitioned readers hold shared OS ownership while resolving immutable blobs.
/// This permits read-only authorization and excludes reclamation until the
/// snapshot is entirely in memory. Writers already hold exclusive ownership.
fn read_snapshot(
    root: &Path,
    directory: &Path,
    auth: Auth<'_>,
    exclusively_held: bool,
) -> Result<(serde_json::Value, Option<serde_json::Value>), String> {
    let manifest = directory.join("manifest.json");
    let read = || -> Result<serde_json::Value, String> {
        paths::check(root, &manifest, auth)?;
        auth(&manifest, AccessMode::Read)?;
        match fs::read(&manifest) {
            Ok(bytes) => {
                let value: serde_json::Value =
                    serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
                if value.get("storage_format").is_some()
                    && !crate::partitioned_storage::is_index(&value)
                {
                    return Err("unsupported maintenance storage format".into());
                }
                Ok(value)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                serde_json::to_value(State::default()).map_err(|error| error.to_string())
            }
            Err(error) => Err(error.to_string()),
        }
    };
    let mut value = read()?;
    let _reader = if crate::partitioned_storage::is_index(&value) && !exclusively_held {
        let lock = directory.join("maintenance.lock");
        let file = crate::lock_recovery::wait_for_lock_cancel(
            auth.lock_wait.get(),
            &|| auth.cancelled(),
            || {
                paths::check(root, &lock, auth)?;
                auth(&lock, AccessMode::Read)?;
                let file = OpenOptions::new()
                    .read(true)
                    .open(&lock)
                    .map_err(|error| error.to_string())?;
                file.try_lock_shared().map_err(|error| match error {
                    std::fs::TryLockError::WouldBlock => {
                        crate::lock_recovery::busy_for_file(root, &lock, "state.read", auth, &file)
                    }
                    std::fs::TryLockError::Error(error) => {
                        crate::lock_recovery::LockAcquireError::Other(format!(
                            "shared lock acquisition failed: {} (state.read): {error}",
                            lock.display()
                        ))
                    }
                })?;
                paths::check(root, &lock, auth)?;
                let path_identity = paths::platform_identity(
                    &fs::metadata(&lock).map_err(|error| error.to_string())?,
                );
                if paths::platform_identity(&file.metadata().map_err(|error| error.to_string())?)
                    != path_identity
                {
                    return Err("state read lock identity changed".into());
                }
                Ok(file)
            },
        )?;
        value = read()?;
        Some(file)
    } else {
        None
    };
    if crate::partitioned_storage::is_index(&value) {
        let state = crate::partitioned_storage::read(root, &value, auth)?;
        if read()? != value {
            return Err("partitioned index changed while reading snapshot".into());
        }
        Ok((state, Some(value)))
    } else {
        Ok((value, None))
    }
}

/// Explicit format transition. Old owners reject the nonnumeric revision;
/// there is no automatic migration during ordinary registration or cleanup.
pub(crate) fn partition(
    root: &Path,
    request: &serde_json::Value,
    auth: Auth<'_>,
) -> Result<serde_json::Value, String> {
    use serde_json::json;
    use sha2::{Digest, Sha256};
    if request["writers_stopped_verified"] != true
        || crate::string(request, "reason")?.trim().is_empty()
    {
        return Err("partition_storage requires explicit writer-stop evidence and reason".into());
    }
    let config_path = root.join("project-maintenance.json");
    paths::check(root, &config_path, auth)?;
    auth(&config_path, AccessMode::Read)?;
    let config_bytes = fs::read(&config_path).map_err(|error| error.to_string())?;
    let config: crate::Config =
        serde_json::from_slice(&config_bytes).map_err(|error| error.to_string())?;
    if config.schema_version != 1 || config.project_id.is_empty() {
        return Err("valid project maintenance configuration required".into());
    }
    let evidence = paths::resolve(root, Path::new(crate::string(request, "evidence_ref")?))?;
    if !evidence.starts_with(root.join("artifacts/maintenance/evidence")) {
        return Err("partition evidence must be outside the state record directory".into());
    }
    paths::check(root, &evidence, auth)?;
    auth(&evidence, AccessMode::Read)?;
    let evidence_bytes = fs::read(&evidence).map_err(|error| error.to_string())?;
    if evidence_bytes.len() > 1024 * 1024
        || format!("{:x}", Sha256::digest(&evidence_bytes))
            != crate::string(request, "evidence_sha256")?
    {
        return Err("partition writer-stop evidence SHA mismatch or size exceeded".into());
    }
    let (mut store, _catalog) = crate::lock_recovery::wait_for_lock_cancel(
        auth.lock_wait.get(),
        &|| auth.cancelled(),
        || {
            let store = Store::open(root, auth, true)?;
            let catalog = root.join("artifacts/maintenance/lifecycles/catalog.lock");
            paths::check(
                root,
                catalog.parent().ok_or("missing catalog parent")?,
                auth,
            )?;
            if !catalog.parent().ok_or("missing catalog parent")?.exists() {
                return Err("existing lifecycle catalog required for explicit partition".into());
            }
            let lease =
                crate::lock_recovery::Sentinel::acquire(root, &catalog, "state.partition", auth)?;
            Ok((store, lease))
        },
    )?;
    let pending = store.directory.join("manifest.pending");
    paths::check(root, &pending, auth)?;
    if pending.exists() {
        return Err("pending state requires independent recovery before partition".into());
    }
    let reservations = root.join("artifacts/maintenance/lifecycles/reservations");
    paths::check(root, &reservations, auth)?;
    if reservations.exists() {
        auth(&reservations, AccessMode::Read)?;
        for entry in fs::read_dir(&reservations).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            if entry
                .path()
                .extension()
                .is_some_and(|extension| extension == "json")
            {
                return Err("active or unresolved scope reservation blocks partition".into());
            }
        }
    }
    if store.state.runs.values().any(|run| {
        run["steps"].as_array().is_none_or(|steps| {
            steps.iter().any(|step| {
                crate::producer_active(step)
                    || !matches!(
                        step["status"].as_str(),
                        Some("passed" | "failed" | "not_run" | "interrupted" | "unknown")
                    )
            })
        })
    }) {
        return Err("active or unresolved execution blocks partition".into());
    }
    let manifest = store.directory.join("manifest.json");
    auth(&manifest, AccessMode::Read)?;
    let before = fs::read(&manifest).map_err(|error| error.to_string())?;
    let expected = crate::string(request, "expected_manifest_sha256")?;
    if format!("{:x}", Sha256::digest(&before)) != expected {
        return Err("partition manifest SHA changed".into());
    }
    // Recheck the exact evidence immediately before any transition writes.
    paths::check(root, &evidence, auth)?;
    auth(&evidence, AccessMode::Read)?;
    if fs::read(&evidence).map_err(|error| error.to_string())? != evidence_bytes || auth.cancelled()
    {
        return Err("partition evidence changed or operation cancelled".into());
    }
    if store.partitioned {
        if request["operation"] == "compact_storage" {
            crate::partitioned_storage::collect(
                root,
                store
                    .disk_index
                    .as_ref()
                    .ok_or("missing partitioned index")?,
                auth,
            )?;
            return Ok(
                json!({"status":"compacted","storage_format":"partitioned-v1","revision":store.state.revision}),
            );
        }
        return Ok(
            json!({"status":"already_partitioned","storage_format":"partitioned-v1","revision":store.state.revision}),
        );
    }
    if request["operation"] == "compact_storage" {
        return Err("compact_storage requires partitioned state".into());
    }
    let previous_revision = store.state.revision;
    store.partitioned = true;
    store.transition_guard = vec![
        (manifest, before),
        (config_path, config_bytes),
        (evidence, evidence_bytes),
    ];
    store.save(auth)?;
    Ok(
        json!({"status":"partitioned","storage_format":"partitioned-v1","previous_revision":previous_revision,
        "revision":store.state.revision,"previous_manifest_sha256":expected,"evidence_sha256":request["evidence_sha256"]}),
    )
}

/// Compare each changed identity against its base, preserving unrelated commits.
fn merge(
    base: &serde_json::Value,
    local: &serde_json::Value,
    mut current: serde_json::Value,
) -> Result<serde_json::Value, String> {
    use serde_json::Value;
    use std::collections::{BTreeSet, HashMap, HashSet};
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
    let before_values: HashSet<&Value> = before.iter().collect();
    let after_values: HashSet<&Value> = after.iter().collect();
    let mut before_ids = HashMap::new();
    for value in before {
        if let Some(id) = value["decision_id"].as_str() {
            before_ids.entry(id).or_insert(value);
        }
    }
    // Keep the first occurrence, matching the previous find/position behavior.
    // Owned keys allow target entries to be replaced or appended below.
    let mut target_ids = HashMap::new();
    for (index, value) in target.iter().enumerate() {
        if let Some(id) = value["decision_id"].as_str() {
            target_ids.entry(id.to_owned()).or_insert(index);
        }
    }
    // Legacy receipts are immutable. All mutable new decisions have stable IDs.
    for old in before {
        if old.get("decision_id").is_none() && !after_values.contains(old) {
            return Err("legacy decision mutation requires recovery".into());
        }
    }
    for value in after {
        if before_values.contains(value) {
            continue;
        }
        let id = value["decision_id"]
            .as_str()
            .ok_or("stable decision_id required")?;
        let old = before_ids.get(id).copied();
        let index = target_ids.get(id).copied();
        if index.map(|i| &target[i]) != old {
            return Err(format!("decision CAS conflict: {id}"));
        }
        match index {
            Some(i) => target[i] = value.clone(),
            None => {
                target_ids.entry(id.to_owned()).or_insert(target.len());
                target.push(value.clone());
            }
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

    // History compaction must survive an older writer's unchanged legacy rows,
    // while a writer changing the same stable receipt must still conflict.
    #[test]
    fn compacted_details_survive_unrelated_suspended_writer_and_keep_same_row_cas() {
        let root = tempfile::tempdir().unwrap();
        let allow = |_: &std::path::Path, _: crate::AccessMode| Ok(());
        let auth = crate::Context::new(&allow);
        let mut writer = super::Store::open(root.path(), &auth, true).unwrap();
        let legacy = json!({"id":"old","status":"deleted","remaining":false,
            "deletion":{"status":"deleted","remaining":false,"error":null,
            "attributes":[{"path":"old/file","before":33,"after":32}]}});
        let mut stable = legacy.clone();
        stable["decision_id"] = json!("stable");
        writer.state.decisions = vec![legacy.clone(), stable.clone()];
        writer.save(&auth).unwrap();
        writer.suspend().unwrap();
        {
            let other_auth = crate::Context::new(&allow);
            let mut other = super::Store::open(root.path(), &other_auth, true).unwrap();
            let review = crate::decision_history::review(&other.state).unwrap();
            crate::decision_history::compact(&mut other.state,
                &json!({"review_token":review["review_token"],"reason":"approved detail cleanup"})).unwrap();
            other.save(&other_auth).unwrap();
        }
        writer.state.decisions.push(json!({"decision_id":"new","status":"pending"}));
        writer.save(&auth).unwrap();
        assert!(writer.state.decisions[0]["deletion"].get("attributes").is_none());
        assert!(writer.state.decisions[1]["deletion"].get("attributes").is_none());
        assert_eq!(writer.state.decisions.last().unwrap()["decision_id"], "new");
        let mut base = serde_json::to_value(&writer.state).unwrap();
        base["decisions"][1] = stable;
        let mut local = base.clone();
        local["decisions"][1]["reason"] = json!("same row changed");
        assert!(merge(&base, &local, serde_json::to_value(&writer.state).unwrap()).is_err());
    }

    #[test]
    fn save_reuses_only_exact_local_state_and_keeps_merged_receipts_and_concurrent_records() {
        let root = tempfile::tempdir().unwrap();
        let allow = |_: &std::path::Path, _: crate::AccessMode| Ok(());
        let auth = crate::Context::new(&allow);
        let mut store = super::Store::open(root.path(), &auth, true).unwrap();
        store.state.decisions = vec![
            json!({"legacy":"immutable"}),
            json!({"decision_id":"ours","status":"pending","extra":{"nested":true}}),
        ];
        store.save(&auth).unwrap();
        store.suspend().unwrap();
        // Removal of a stable-ID receipt is ignored by merge, even when no
        // other writer has changed the committed base. This is not exact local.
        store.state.decisions.pop();
        store.save(&auth).unwrap();
        assert_eq!(store.state.decisions.len(), 2);
        assert_eq!(store.state.decisions[1]["extra"], json!({"nested":true}));
        {
            let other_auth = crate::Context::new(&allow);
            let mut other = super::Store::open(root.path(), &other_auth, true).unwrap();
            other
                .state
                .items
                .insert("theirs".into(), json!({"owner":"other"}));
            other
                .state
                .decisions
                .push(json!({"decision_id":"theirs","status":"deferred"}));
            other.save(&other_auth).unwrap();
        }
        store.state.decisions[1]["status"] = json!("deleted");
        store.save(&auth).unwrap();
        let actual: serde_json::Value = serde_json::from_slice(
            &std::fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(actual["revision"], 4);
        assert_eq!(
            actual["decisions"],
            json!([
                {"legacy":"immutable"},
                {"decision_id":"ours","status":"deleted","extra":{"nested":true}},
                {"decision_id":"theirs","status":"deferred"},
            ])
        );
        assert_eq!(actual["items"]["theirs"]["owner"], "other");
        assert_eq!(serde_json::to_value(&store.state).unwrap(), actual);
        assert_eq!(store.base, actual);
        assert!(
            !root
                .path()
                .join("artifacts/maintenance/manifest.pending")
                .exists()
        );
    }

    // Retain these edge cases because a future index simplification can lose
    // full-value legacy membership or first-match duplicate-ID semantics.
    #[test]
    fn unchanged_legacy_and_nonstring_decisions_use_exact_json_membership() {
        let base = json!({"revision":4,"items":{},"groups":{},"runs":{},"decisions":[
            null, true, 17, "legacy", [1, {"nested":false}],
            {"unknown":{"values":[null, 1.5]}},
            {"decision_id":null,"status":"old"},
            {"decision_id":7,"status":"old"},
            {"decision_id":{"nested":[1]},"status":"old"}
        ]});
        let mut local = base.clone();
        local["decisions"].as_array_mut().unwrap().reverse();
        let mut current = base.clone();
        current["revision"] = json!(5);
        assert_eq!(merge(&base, &local, current.clone()).unwrap(), current);

        let mut local = base.clone();
        local["decisions"].as_array_mut().unwrap().remove(5);
        assert_eq!(
            merge(&base, &local, current).unwrap_err(),
            "legacy decision mutation requires recovery"
        );
    }

    #[test]
    fn changed_nonstring_decision_ids_still_require_stable_ids() {
        for id in [json!(null), json!(7), json!(["id"]), json!({"id":"x"})] {
            let base = json!({"revision":1,"items":{},"groups":{},"runs":{},
                "decisions":[{"decision_id":id,"status":"pending"}]});
            let mut local = base.clone();
            local["decisions"][0]["status"] = json!("deleted");
            assert_eq!(
                merge(&base, &local, base.clone()).unwrap_err(),
                "stable decision_id required"
            );
        }
    }

    #[test]
    fn duplicate_decision_ids_update_only_the_first_match() {
        let base = json!({"revision":2,"items":{},"groups":{},"runs":{},"decisions":[
            {"decision_id":"same","status":"pending","unknown":{"keep":true}},
            {"decision_id":"same","status":"second"}
        ]});
        let mut local = base.clone();
        local["decisions"][0]["status"] = json!("deleted");
        let mut current = base.clone();
        current["revision"] = json!(3);
        current["decisions"][1]["status"] = json!("concurrent second");
        let merged = merge(&base, &local, current).unwrap();
        assert_eq!(
            merged["decisions"],
            json!([
                {"decision_id":"same","status":"deleted","unknown":{"keep":true}},
                {"decision_id":"same","status":"concurrent second"}
            ])
        );
        assert_eq!(merged["revision"], 3);

        let mut local = base.clone();
        local["decisions"][1]["status"] = json!("changed second");
        let merged = merge(&base, &local, base.clone()).unwrap();
        assert_eq!(merged["decisions"][0]["status"], "changed second");
        assert_eq!(merged["decisions"][1]["status"], "second");
    }

    #[test]
    fn repeated_changed_decision_ids_conflict_after_update_or_append() {
        for decisions in [
            json!([]),
            json!([{"decision_id":"same","status":"pending"}]),
        ] {
            let base = json!({"revision":1,"items":{},"groups":{},"runs":{},
                "decisions":decisions});
            for second_status in ["deleted", "failed"] {
                let mut local = base.clone();
                local["decisions"] = json!([
                    {"decision_id":"same","status":"deleted"},
                    {"decision_id":"same","status":second_status}
                ]);
                assert_eq!(
                    merge(&base, &local, base.clone()).unwrap_err(),
                    "decision CAS conflict: same"
                );
            }
        }
    }

    #[test]
    fn stable_id_removals_are_ignored_and_new_decisions_append_in_local_order() {
        let base = json!({"revision":2,"items":{},"groups":{},"runs":{},
            "unknown":{"keep":[1,2]},"decisions":[{"decision_id":"removed","status":"old"}]});
        let mut local = base.clone();
        local["decisions"] = json!([
            {"decision_id":"z","extra":{"keep":true}},
            {"decision_id":"a","status":"new"}
        ]);
        let mut current = base.clone();
        current["revision"] = json!(7);
        current["decisions"]
            .as_array_mut()
            .unwrap()
            .insert(0, json!({"decision_id":"concurrent","status":"other"}));
        let merged = merge(&base, &local, current).unwrap();
        assert_eq!(
            merged["decisions"],
            json!([
                {"decision_id":"concurrent","status":"other"},
                {"decision_id":"removed","status":"old"},
                {"decision_id":"z","extra":{"keep":true}},
                {"decision_id":"a","status":"new"}
            ])
        );
        assert_eq!(merged["unknown"], base["unknown"]);
        assert_eq!(merged["revision"], 7);
    }

    #[test]
    fn suspended_save_waits_for_transaction_acquisition_without_replaying_commit() {
        use std::cell::{Cell, RefCell};
        use std::sync::mpsc;
        let root = tempfile::tempdir().unwrap();
        let lock = root.path().join("artifacts/maintenance/maintenance.lock");
        let writes = Cell::new(0);
        let armed = Cell::new(false);
        let (attempt_tx, attempt_rx) = mpsc::channel();
        let attempt_tx = RefCell::new(Some(attempt_tx));
        let authorize = |path: &std::path::Path, mode| {
            if path == lock && mode == crate::AccessMode::Write {
                writes.set(writes.get() + 1);
                if armed.get() && writes.get() == 1 {
                    if let Some(tx) = attempt_tx.borrow_mut().take() {
                        tx.send(()).unwrap();
                    }
                }
            }
            Ok(())
        };
        let auth = crate::Context::new(&authorize);
        // This case exercises the caller's explicit acquisition-wait policy.
        auth.lock_wait.set(std::time::Duration::from_millis(500));
        let mut store = super::Store::open(root.path(), &auth, true).unwrap();
        store.suspend().unwrap();
        writes.set(0);
        armed.set(true);
        let (ready_tx, ready_rx) = mpsc::channel();
        let holder_root = root.path().to_owned();
        let holder = std::thread::spawn(move || {
            let allow = |_: &std::path::Path, _| Ok(());
            let auth = crate::Context::new(&allow);
            let lease = crate::lock_recovery::Sentinel::acquire(
                &holder_root,
                &holder_root.join("artifacts/maintenance/maintenance.lock"),
                "test-holder",
                &auth,
            )
            .unwrap();
            ready_tx.send(()).unwrap();
            // Keep the OS lock across the first acquisition attempt. A queued
            // waiter cannot perform a second transaction until this releases.
            let attempted = attempt_rx
                .recv_timeout(std::time::Duration::from_secs(2))
                .is_ok();
            std::thread::sleep(std::time::Duration::from_millis(100));
            lease.release().unwrap();
            attempted
        });
        ready_rx.recv().unwrap();
        store
            .state
            .items
            .insert("ours".into(), json!({"owner":"test"}));
        let result = store.save(&auth);
        assert!(
            holder.join().unwrap(),
            "no acquisition attempt observed while the OS owner held the lock"
        );
        result.unwrap();
        assert_eq!(
            writes.get(),
            2,
            "one contended attempt and one fresh acquisition after OS release"
        );
        let state: serde_json::Value = serde_json::from_slice(
            &std::fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(state["revision"], 1);
        assert_eq!(state["items"]["ours"]["owner"], "test");
        assert!(
            !root
                .path()
                .join("artifacts/maintenance/manifest.pending")
                .exists()
        );
    }

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

//! User-scoped maintenance admission. Disabling drains owners; it never breaks OS locks.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Preferences {
    pub schema: u32,
    pub revision: u64,
    pub groups: bool,
    pub locks: bool,
    pub deletion: bool,
    #[serde(default = "default_deletion_parallelism")]
    pub deletion_parallelism: u8,
}
fn default_deletion_parallelism() -> u8 {
    1
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            schema: 1,
            revision: 0,
            groups: true,
            locks: true,
            deletion: true,
            deletion_parallelism: default_deletion_parallelism(),
        }
    }
}
impl Preferences {
    pub fn groups_enabled(&self) -> bool {
        self.groups && self.locks
    }
    pub fn deletion_enabled(&self) -> bool {
        self.groups_enabled() && self.deletion
    }
}

pub fn home() -> Result<PathBuf, String> {
    for key in ["AZRAEL_STATE_ROOT", "CODEX_HOME"] {
        if let Some(value) = std::env::var_os(key) {
            let path = PathBuf::from(value);
            if !path.is_absolute() {
                return Err(format!("{key} must be absolute"));
            }
            return Ok(path);
        }
    }
    let base = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .ok_or("maintenance preferences require an absolute user home")?;
    let path = PathBuf::from(base).join(".azrael-ex");
    if !path.is_absolute() {
        return Err("maintenance preferences require an absolute user home".into());
    }
    Ok(path)
}

pub(crate) fn checked_home(home: &Path, create: bool) -> Result<(), String> {
    if !home.is_absolute()
        || home.components().any(|c| {
            matches!(
                c,
                std::path::Component::ParentDir | std::path::Component::CurDir
            )
        })
    {
        return Err("absolute plain maintenance settings directory required".into());
    }
    // Check existing ancestors before creating any missing directories.
    for ancestor in home.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(_) => crate::lock_recovery::final_plain_path(ancestor)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    if create {
        fs::create_dir_all(home).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn read_at(home: &Path) -> Result<Preferences, String> {
    let path = home.join("maintenance-preferences.json");
    match fs::symlink_metadata(&path) {
        Ok(metadata) => {
            crate::lock_recovery::final_plain_path(&path)?;
            if !metadata.is_file() {
                return Err("maintenance preferences must be a plain file".into());
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Preferences::default()),
        Err(e) => return Err(e.to_string()),
    }
    let file = match File::open(&path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Preferences::default()),
        Err(e) => return Err(e.to_string()),
    };
    crate::lock_recovery::final_plain_path(&path)?;
    let mut bytes = Vec::new();
    file.take(16385)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 16384 {
        return Err("maintenance preferences exceed bound".into());
    }
    let value: Preferences = serde_json::from_slice(&bytes)
        .map_err(|e| format!("invalid maintenance preferences: {e}"))?;
    if value.schema != 1 || value.revision > 9_007_199_254_740_991 {
        return Err("unsupported maintenance preferences schema or revision".into());
    }
    validate_deletion_parallelism(value.deletion_parallelism)?;
    Ok(value)
}
fn validate_deletion_parallelism(value: u8) -> Result<(), String> {
    if !(1..=2).contains(&value) {
        return Err("maintenance deletion_parallelism must be 1 or 2".into());
    }
    Ok(())
}
pub fn read(home: &Path) -> Result<Preferences, String> {
    checked_home(home, false)?;
    read_at(home)
}
fn gate(home: &Path) -> Result<File, String> {
    let path = home.join("maintenance-activity.lock");
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)
        .map_err(|e| e.to_string())?;
    crate::lock_recovery::final_plain_path(&path)?;
    Ok(file)
}
fn busy(home: &Path) -> Result<bool, String> {
    let path = home.join("maintenance-activity.lock");
    if !path.exists() {
        return Ok(false);
    }
    crate::lock_recovery::final_plain_path(&path)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    match file.try_lock() {
        Ok(()) => Ok(false),
        Err(std::fs::TryLockError::WouldBlock) => Ok(true),
        Err(std::fs::TryLockError::Error(e)) => Err(e.to_string()),
    }
}
pub fn snapshot(home: &Path) -> Result<Value, String> {
    let p = read(home)?;
    let pending = !p.deletion_enabled() && busy(home)?;
    let mut result = serde_json::to_value(&p).map_err(|e| e.to_string())?;
    result["effective"] =
        json!({"groups":p.groups_enabled(),"locks":p.locks,"deletion":p.deletion_enabled()});
    result["pending"] = json!(pending);
    result["status"] = json!(if pending {
        "draining"
    } else if p.deletion_enabled() {
        "enabled"
    } else {
        "disabled"
    });
    Ok(result)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Update {
    expected_revision: u64,
    groups: bool,
    locks: bool,
    deletion: bool,
    deletion_parallelism: Option<u8>,
}
pub fn write(home: &Path, update: Value) -> Result<Value, String> {
    let update: Update = serde_json::from_value(update).map_err(|e| e.to_string())?;
    checked_home(home, true)?;
    let writer_path = home.join("maintenance-preferences.lock");
    let writer = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&writer_path)
        .map_err(|e| e.to_string())?;
    crate::lock_recovery::final_plain_path(&writer_path)?;
    writer
        .try_lock()
        .map_err(|e| format!("maintenance settings are being changed: {e}"))?;
    let old = read_at(home)?;
    let deletion_parallelism = update
        .deletion_parallelism
        .unwrap_or(old.deletion_parallelism);
    validate_deletion_parallelism(deletion_parallelism)?;
    if old.revision != update.expected_revision {
        return Err("maintenance preferences changed; refresh before saving".into());
    }
    // Enabling or changing capacity waits for all existing guarded work to leave. The exclusive handle
    // stays held through publication, so a new entrant cannot race the transition.
    let activity = gate(home)?;
    let enabling = (!old.groups && update.groups)
        || (!old.locks && update.locks)
        || (!old.deletion && update.deletion);
    if enabling || deletion_parallelism != old.deletion_parallelism {
        activity.try_lock().map_err(|e| {
            format!("maintenance work is still draining; retry after owners finish: {e}")
        })?;
    }
    let next = Preferences {
        schema: 1,
        revision: old
            .revision
            .checked_add(1)
            .ok_or("preferences revision exhausted")?,
        groups: update.groups,
        locks: update.locks,
        deletion: update.deletion,
        deletion_parallelism,
    };
    if next.revision > 9_007_199_254_740_991 {
        return Err("preferences revision exhausted".into());
    }
    let pending = home.join(format!(
        "maintenance-preferences.{}.pending",
        std::process::id()
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&pending)
        .map_err(|e| e.to_string())?;
    let result = (|| {
        file.write_all(&serde_json::to_vec(&next).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&pending, home.join("maintenance-preferences.json")).map_err(|e| e.to_string())
    })();
    if pending.exists() {
        fs::remove_file(&pending).map_err(|e| e.to_string())?;
    }
    result?;
    drop(activity);
    snapshot(home)
}

/// Held for an entire dispatched operation or native lease lifetime.
pub struct Admission {
    _activity: File,
    pub revision: u64,
}
pub fn enter(home: &Path, operation: &str) -> Result<Admission, String> {
    let allowed = |p: &Preferences| -> Result<(), String> {
        let reconcile = matches!(
            operation,
            "finish_step"
                | "validate_step"
                | "run_status"
                | "recover_run"
                | "recover_lock"
                | "recover_reservation"
                | "recover_refresh_pending"
                | "recover_lifecycle_pending"
                | "request_status"
                | "request_cancel"
                | "request_ack"
                | "request_recover"
                | "request_recover_pending"
                | "lifecycle.reconcile"
        );
        if !reconcile && !p.groups_enabled() {
            return Err("maintenance groups/locks are disabled; ordinary command execution remains available".into());
        }
        if matches!(
            operation,
            "apply" | "reserve_producers" | "lifecycle.cleanup" | "compact_decision_history"
        ) && !p.deletion_enabled()
        {
            return Err("maintenance deletion is disabled; review again after enabling".into());
        }
        Ok(())
    };
    let p = read(home)?;
    allowed(&p)?; // Off-from-start does not create activity or project locks.
    checked_home(home, true)?;
    let activity = gate(home)?;
    activity
        .try_lock_shared()
        .map_err(|e| format!("maintenance settings transition in progress: {e}"))?;
    let current = read_at(home)?;
    allowed(&current)?;
    Ok(Admission {
        _activity: activity,
        revision: current.revision,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    // Later additions to settings must preserve omitted existing capacity and
    // legacy defaults, and must not publish invalid capacity or revisions.
    #[test]
    fn deletion_parallelism_defaults_bounds_and_revision_preservation() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        let path = home.join("maintenance-preferences.json");
        fs::write(
            &path,
            r#"{"schema":1,"revision":7,"groups":false,"locks":true,"deletion":false}"#,
        )
        .unwrap();
        assert_eq!(read(home).unwrap().deletion_parallelism, 1);
        let update = |capacity| json!({"expected_revision":7,"groups":false,"locks":true,"deletion":false,"deletion_parallelism":capacity});
        for capacity in [0, 3, 255] {
            assert!(write(home, update(capacity)).is_err());
            assert_eq!(read(home).unwrap().revision, 7);
        }
        let selected = write(home, update(2)).unwrap();
        assert_eq!(selected["revision"], 8);
        assert_eq!(selected["deletion_parallelism"], 2);
        let saved = write(
            home,
            json!({"expected_revision":8,"groups":false,"locks":true,"deletion":false}),
        )
        .unwrap();
        assert_eq!(saved["revision"], 9);
        assert_eq!(saved["deletion_parallelism"], 2);
        assert_eq!(saved["groups"], false);
        assert_eq!(saved["locks"], true);
        assert_eq!(saved["deletion"], false);
        let mut invalid = saved;
        for field in ["effective", "pending", "status"] {
            invalid.as_object_mut().unwrap().remove(field);
        }
        invalid["deletion_parallelism"] = json!(0);
        fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
        assert!(read(home).is_err());
    }
    #[test]
    fn preference_changes_invalidate_review_tokens_without_replaying_deletion() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let home = root.join("settings");
        fs::create_dir(root.join("generated")).unwrap();
        fs::write(root.join("generated/item"), "owned test fixture").unwrap();
        fs::write(root.join("project-maintenance.json"), r#"{"schema_version":1,"project_id":"preference-tokens","managed_roots":["generated"],"bundles":[]}"#).unwrap();
        let invoke = |request| {
            crate::dispatch_with_preferences(&home, root, request, &|_, _| Ok(()), &|| false)
        };
        invoke(json!({"operation":"register","group":{"id":"fixture","kind":"run","owner":"preferences-test","membership_complete":true,"provenance_ref":"isolated-test","members":[{"id":"item","path":"generated/item","kind":"fixture","generated":true,"protection_known":true,"owner":"preferences-test","references":[]}]}})).unwrap();
        let before = invoke(json!({"operation":"review","group_ids":["fixture"]})).unwrap();
        write(
            &home,
            json!({"expected_revision":0,"groups":true,"locks":true,"deletion":false}),
        )
        .unwrap();
        assert!(invoke(json!({"operation":"apply","decisions":[]})).is_err());
        assert!(invoke(json!({"operation":"compact_decision_history"})).is_err());
        write(
            &home,
            json!({"expected_revision":1,"groups":true,"locks":true,"deletion":true}),
        )
        .unwrap();
        let after = invoke(json!({"operation":"review","group_ids":["fixture"]})).unwrap();
        assert_ne!(before["items"][0]["token"], after["items"][0]["token"]);
        let result = invoke(
            json!({"operation":"apply","decisions":[{"id":before["items"][0]["id"],"token":before["items"][0]["token"],"decision":"delete","reason":"stale token must not delete"}]}),
        );
        assert!(result.is_err() || result.unwrap()["results"][0]["status"] != "deleted");
        assert!(root.join("generated/item").exists());
    }
    #[test]
    fn settings_drain_existing_owners_and_restore_requested_support() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        let guard = enter(home, "begin_run").unwrap();
        let disabled = write(
            home,
            json!({"expected_revision":0,"groups":true,"locks":false,"deletion":true}),
        )
        .unwrap();
        assert_eq!(disabled["status"], "draining");
        assert_eq!(disabled["effective"]["deletion"], false);
        assert!(enter(home, "begin_run").is_err());
        assert!(
            write(
                home,
                json!({"expected_revision":1,"groups":true,"locks":true,"deletion":true})
            )
            .is_err()
        );
        drop(guard);
        assert_eq!(snapshot(home).unwrap()["status"], "disabled");
        let enabled = write(
            home,
            json!({"expected_revision":1,"groups":true,"locks":true,"deletion":true}),
        )
        .unwrap();
        assert_eq!(enabled["effective"]["deletion"], true);
        assert!(
            write(
                home,
                json!({"expected_revision":1,"groups":false,"locks":true,"deletion":true})
            )
            .is_err()
        );
    }
    #[test]
    fn disabled_admission_creates_no_project_or_activity_locks_and_allows_reconciliation() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        write(
            home,
            json!({"expected_revision":0,"groups":false,"locks":false,"deletion":false}),
        )
        .unwrap();
        fs::remove_file(home.join("maintenance-activity.lock")).unwrap();
        assert!(enter(home, "lifecycle.catalog").is_err());
        assert!(!home.join("maintenance-activity.lock").exists());
        let _guard = enter(home, "lifecycle.reconcile").unwrap();
        assert!(enter(home, "reserve_producers").is_err());
    }
}

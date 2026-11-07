//! Transient contention at the post-measurement commit must not strand a fence.
use azrael_project_maintenance::{AccessMode, dispatch};
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::fs::{File, OpenOptions};
use std::path::Path;
use std::time::Duration;

fn reserved(root: &Path) -> bool {
    std::fs::read_dir(root.join("artifacts/maintenance/lifecycles/reservations")).is_ok_and(
        |entries| {
            entries
                .flatten()
                .any(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
        },
    )
}

#[test]
fn registration_preintent_failure_releases_only_its_known_reservation() {
    let root = tempfile::tempdir().unwrap();
    let payload = root.path().join("artifacts/payload");
    std::fs::create_dir(root.path().join("artifacts")).unwrap();
    std::fs::write(&payload, "payload").unwrap();
    std::fs::write(
        root.path().join("project-maintenance.json"),
        serde_json::to_vec(&json!({
            "schema_version":1,"project_id":"abort","managed_roots":["artifacts"],"bundles":[]
        }))
        .unwrap(),
    )
    .unwrap();
    let injected = Cell::new(false);
    let authorize = |path: &Path, mode| {
        if path == payload && mode == AccessMode::Read && !injected.get() && reserved(root.path()) {
            injected.set(true);
            return Err("known pre-intent policy failure".into());
        }
        Ok(())
    };
    let error = dispatch(
        root.path(),
        json!({"operation":"register","item":{
            "id":"payload","path":payload,"kind":"artifact","owner":"test",
            "generated":true,"protection_known":true,"references":[]
        }}),
        &authorize,
    )
    .unwrap_err();
    assert!(injected.get());
    assert!(error.contains("known pre-intent policy failure"), "{error}");
    assert!(!reserved(root.path()));
    assert!(
        !root
            .path()
            .join("artifacts/maintenance/manifest.pending")
            .exists()
    );
    assert_eq!(std::fs::read_to_string(payload).unwrap(), "payload");
}

#[test]
fn dispatch_busy_is_structured_without_implicit_retry() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("artifacts/maintenance");
    std::fs::create_dir_all(&directory).unwrap();
    let payload = root.path().join("artifacts/payload");
    std::fs::write(&payload, "payload").unwrap();
    std::fs::write(
        root.path().join("project-maintenance.json"),
        serde_json::to_vec(&json!({
            "schema_version":1,"project_id":"busy","managed_roots":["artifacts"],"bundles":[]
        }))
        .unwrap(),
    )
    .unwrap();
    let path = directory.join("maintenance.lock");
    std::fs::write(
        &path,
        serde_json::to_vec(&json!({"schema":2,"pid":std::process::id(),
        "token":"fixture","operation":"fixture","acquired_at_ms":0}))
        .unwrap(),
    )
    .unwrap();
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .unwrap();
    file.try_lock().unwrap();
    let request = json!({"operation":"register","item":{
        "id":"payload","path":payload,"kind":"artifact","owner":"test",
        "generated":true,"protection_known":true,"references":[]
    }});
    let error = dispatch(root.path(), request, &|_, _| Ok(())).unwrap_err();
    let response = azrael_project_maintenance::error_response(&error);
    assert_eq!(response["code"], "maintenance_busy");
    assert_eq!(response["lock_path"], json!(path));
    assert_eq!(response["retryable"], true);
    assert_eq!(std::fs::read_to_string(payload).unwrap(), "payload");
}

fn transient_commit_contention(catalog: bool, wait_ms: Option<u64>) {
    let root = tempfile::tempdir().unwrap();
    let artifact = root.path().join("artifacts/payload");
    std::fs::create_dir(root.path().join("artifacts")).unwrap();
    std::fs::write(&artifact, "payload").unwrap();
    std::fs::write(
        root.path().join("project-maintenance.json"),
        serde_json::to_vec(&json!({
            "schema_version":1,"project_id":"contention","managed_roots":["artifacts"],"bundles":[]
        }))
        .unwrap(),
    )
    .unwrap();
    let maintenance = root.path().join("artifacts/maintenance/maintenance.lock");
    let catalog_path = root
        .path()
        .join("artifacts/maintenance/lifecycles/catalog.lock");
    let injected = Cell::new(false);
    let holder = RefCell::new(None);
    let retained_lock = RefCell::new(None);
    let authorize = |path: &Path, mode| {
        let boundary = if catalog {
            path == catalog_path && mode == AccessMode::Write
        } else {
            path == artifact && mode == AccessMode::Read
        };
        if boundary && !injected.get() && reserved(root.path()) {
            let lock_path = if catalog { &catalog_path } else { &maintenance };
            let file: File = OpenOptions::new()
                .read(true)
                .write(true)
                .open(lock_path)
                .unwrap();
            if file.try_lock().is_ok() {
                injected.set(true);
                if wait_ms.is_some() {
                    *holder.borrow_mut() = Some(std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(120));
                        drop(file);
                    }));
                } else {
                    // Keep abort's reacquisition blocked until dispatch returns;
                    // a timer could expire while a slow abort is still running.
                    *retained_lock.borrow_mut() = Some(file);
                }
            }
        }
        Ok(())
    };
    let mut request = json!({"operation":"register","item":{
        "id":"payload","path":artifact,"kind":"artifact","owner":"test",
        "generated":true,"protection_known":true,"references":[]
    }});
    if let Some(wait) = wait_ms {
        request["lock_wait_ms"] = json!(wait);
    }
    let result = dispatch(root.path(), request, &authorize);
    drop(retained_lock.into_inner());
    if let Some(thread) = holder.into_inner() {
        thread.join().unwrap();
    }
    assert!(
        injected.get(),
        "exercise the suspended registration boundary"
    );
    if wait_ms.is_none() {
        let error = result.unwrap_err();
        assert_eq!(
            azrael_project_maintenance::error_response(&error)["code"],
            "maintenance_busy"
        );
        assert!(
            reserved(root.path()),
            "busy abort cannot prove catalog custody"
        );
        assert_eq!(std::fs::read_to_string(&artifact).unwrap(), "payload");
        return;
    }
    assert!(result.is_ok(), "{result:?}");
    assert!(
        !reserved(root.path()),
        "successful commit releases the exact fence"
    );
    let state: Value = serde_json::from_slice(
        &std::fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
    )
    .unwrap();
    assert!(state["items"].get("payload").is_some());
    assert_eq!(std::fs::read_to_string(&artifact).unwrap(), "payload");
}

#[test]
fn registration_reacquires_maintenance_after_measurement() {
    transient_commit_contention(false, Some(500));
}

#[test]
fn registration_returns_partial_maintenance_while_retrying_catalog() {
    transient_commit_contention(true, Some(500));
}

#[test]
fn grouped_delete_preflight_allows_unrelated_metadata_commit() {
    let root = tempfile::tempdir().unwrap();
    let payload = root.path().join("artifacts/group");
    std::fs::create_dir_all(&payload).unwrap();
    let child = payload.join("child");
    std::fs::write(&child, "payload").unwrap();
    let independent = root.path().join("artifacts/independent");
    std::fs::write(&independent, "other").unwrap();
    std::fs::write(
        root.path().join("project-maintenance.json"),
        serde_json::to_vec(&json!({
            "schema_version":1,"project_id":"preflight","managed_roots":["artifacts"],"bundles":[]
        }))
        .unwrap(),
    )
    .unwrap();
    let allow = |_: &Path, _: AccessMode| Ok(());
    dispatch(
        root.path(),
        json!({"operation":"register","group":{
            "id":"group","kind":"work","owner":"test","version":"one",
            "membership_complete":true,"provenance_ref":"fixture",
            "members":[{"id":"payload","path":payload,"kind":"artifact","owner":"test",
                "generated":true,"protection_known":true,"references":[]}]
        }}),
        &allow,
    )
    .unwrap();
    let review = dispatch(
        root.path(),
        json!({"operation":"review","group_ids":["group"]}),
        &allow,
    )
    .unwrap();
    let injected = Cell::new(false);
    let authorize = |path: &Path, mode| {
        if path == child && mode == AccessMode::Read && !injected.get() && reserved(root.path()) {
            injected.set(true);
            dispatch(
                root.path(),
                json!({"operation":"register","item":{
                    "id":"independent","path":independent,"kind":"artifact","owner":"other",
                    "generated":true,"protection_known":true,"references":[]
                }}),
                &allow,
            )
            .unwrap();
        }
        Ok(())
    };
    let outcome = dispatch(root.path(), json!({"operation":"apply","decisions":[{
        "id":"payload","token":review["items"][0]["token"],"decision":"delete","reason":"fixture"
    }]}), &authorize).unwrap();
    assert!(
        injected.get(),
        "exercise payload preflight under its scope fence"
    );
    assert_eq!(outcome["results"][0]["status"], "deleted");
    assert!(!payload.exists());
    let state: Value = serde_json::from_slice(
        &std::fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
    )
    .unwrap();
    assert!(state["items"].get("independent").is_some());
    assert_eq!(std::fs::read_to_string(independent).unwrap(), "other");
}

#[test]
fn immediate_commit_busy_retains_reservation_when_abort_cannot_reacquire() {
    transient_commit_contention(false, None);
    transient_commit_contention(true, None);
}

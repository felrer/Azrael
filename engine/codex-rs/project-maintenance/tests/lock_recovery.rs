//! Retained recovery contracts: explicit evidence and exact identity are mandatory.
use azrael_project_maintenance::{AccessMode, dispatch, recover_lock, recover_refresh_pending};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

fn allow(_: &Path, _: AccessMode) -> Result<(), String> {
    Ok(())
}

fn refresh_fixture() -> (tempfile::TempDir, Value, Vec<u8>) {
    let (root, _) = fixture("maintenance", b"", Value::Null);
    // A legacy marker is deliberately not usable as an OS lease.
    fs::remove_file(root.path().join("artifacts/maintenance/maintenance.lock")).unwrap();
    let old = "a".repeat(64);
    let new = "b".repeat(64);
    let base = json!({"revision":12,"items":{"payload":{
        "id":"payload","lifecycle_group_id":"run","path":"artifacts/payload",
        "protection_revision":old,"generated":true,"protection_known":true,
        "references":[{"kind":"producer","active":false}],"cleanup_status":"pending",
        "pending_intent":{"receipt":"must survive"}}},
        "groups":{"run":{"id":"run","members":["payload"],
            "membership_source_format":"producer_registry_v1","membership_source_identity":old,
            "protection_revision":old,"membership_complete":true}},
        "runs":{"failed":{"status":"failed","exit_code":1},
            "unknown":{"status":"unknown","exit_code":null}},
        "decisions":[{"id":"payload","decision":"defer","reason":"retained"}]});
    let mut pending = base.clone();
    pending["revision"] = json!(13);
    pending["groups"]["run"]["protection_revision"] = json!(new);
    pending["items"]["payload"]["protection_revision"] = json!(new);
    let base_bytes = serde_json::to_vec_pretty(&base).unwrap();
    let pending_bytes = serde_json::to_vec(&pending).unwrap();
    fs::write(
        root.path().join("artifacts/maintenance/manifest.json"),
        &base_bytes,
    )
    .unwrap();
    fs::write(
        root.path().join("artifacts/maintenance/manifest.pending"),
        &pending_bytes,
    )
    .unwrap();
    let request = json!({"operation":"recover_refresh_pending","group_id":"run",
        "expected_manifest_sha256":sha(&base_bytes),"expected_pending_sha256":sha(&pending_bytes),
        "producer_stopped_verified":true,"producer_pid":stopped_pid(),
        "reason":"verified exact process tree termination; discard uncommitted refresh",
        "evidence_ref":"artifacts/maintenance/evidence/stopped.txt",
        "evidence_sha256":sha(b"independently verified exact producer tree stopped"),
        "receipt_ref":"artifacts/maintenance/evidence/recovery.json"});
    (root, request, base_bytes)
}

fn rewrite_refresh_pending(root: &Path, request: &mut Value, update: impl FnOnce(&mut Value)) {
    let path = root.join("artifacts/maintenance/manifest.pending");
    let mut pending: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    update(&mut pending);
    let bytes = serde_json::to_vec(&pending).unwrap();
    request["expected_pending_sha256"] = json!(sha(&bytes));
    fs::write(path, bytes).unwrap();
}

fn partition_refresh_fixture() -> (tempfile::TempDir, Value, Vec<u8>) {
    let (root, mut request, _) = refresh_fixture();
    let directory = root.path().join("artifacts/maintenance/state-records");
    fs::create_dir(&directory).unwrap();
    fs::write(
        directory.join(".owner.json"),
        serde_json::to_vec(&json!({
            "schema":1,"owner":"azrael-project-maintenance/state-records"
        }))
        .unwrap(),
    )
    .unwrap();
    for (filename, request_key) in [
        ("manifest.json", "expected_manifest_sha256"),
        ("manifest.pending", "expected_pending_sha256"),
    ] {
        let path = root.path().join("artifacts/maintenance").join(filename);
        let state: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let mut index = json!({"storage_format":"partitioned-v1","revision":"partitioned-v1",
            "state_revision":state["revision"],"items":{},"groups":{},"runs":{},"decisions":vec![Value::Null; state["decisions"].as_array().unwrap().len()]});
        for section in ["items", "groups", "runs", "decisions"] {
            let mut buckets: Vec<serde_json::Map<String, Value>> = vec![serde_json::Map::new(); 16];
            if section == "decisions" {
                for (position, value) in state[section].as_array().unwrap().iter().enumerate() {
                    buckets[position % 16].insert(position.to_string(), value.clone());
                }
            } else {
                for (id, value) in state[section].as_object().unwrap() {
                    buckets[usize::from(Sha256::digest(id.as_bytes())[0]) % 16]
                        .insert(id.clone(), value.clone());
                }
            }
            for bucket in buckets.into_iter().filter(|bucket| !bucket.is_empty()) {
                let bytes = serde_json::to_vec(&bucket).unwrap();
                let hash = sha(&bytes);
                fs::write(directory.join(format!("{hash}.json")), bytes).unwrap();
                for id in bucket.keys() {
                    if section == "decisions" {
                        index[section][id.parse::<usize>().unwrap()] = json!(hash);
                    } else {
                        index[section][id] = json!(hash);
                    }
                }
            }
        }
        let bytes = serde_json::to_vec(&index).unwrap();
        request[request_key] = json!(sha(&bytes));
        fs::write(path, bytes).unwrap();
    }
    let original = fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap();
    (root, request, original)
}

#[test]
fn partitioned_refresh_discard_preserves_index_and_numeric_recovery_revisions() {
    let (root, request, original) = partition_refresh_fixture();
    let directory = root.path().join("artifacts/maintenance/state-records");
    let blobs: Vec<_> = fs::read_dir(&directory)
        .unwrap()
        .map(|entry| {
            let path = entry.unwrap().path();
            let bytes = fs::read(&path).unwrap();
            (path, bytes)
        })
        .collect();
    let response = recover_refresh_pending(root.path(), request, &allow).unwrap();
    assert_eq!(response["status"], "discarded");
    assert_eq!(
        fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
        original
    );
    assert!(
        !root
            .path()
            .join("artifacts/maintenance/manifest.pending")
            .exists()
    );
    for (path, bytes) in blobs {
        assert_eq!(fs::read(path).unwrap(), bytes);
    }
    let receipt: Value = serde_json::from_slice(
        &fs::read(
            root.path()
                .join("artifacts/maintenance/evidence/recovery.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(receipt["base_revision"], 12);
    assert_eq!(receipt["pending_revision"], 13);
    assert_eq!(
        receipt["changed_protection_revisions"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    release_test_receipt(root.path());
}

#[test]
fn partitioned_refresh_discard_refuses_corrupt_blobs_and_late_blob_or_marker_replacement() {
    for mode in ["corrupt", "late-blob", "late-marker"] {
        let (root, request, original) = partition_refresh_fixture();
        let index: Value = serde_json::from_slice(&original).unwrap();
        let directory = root.path().join("artifacts/maintenance/state-records");
        let target = if mode == "late-marker" {
            directory.join(".owner.json")
        } else {
            directory.join(format!(
                "{}.json",
                index["items"]["payload"].as_str().unwrap()
            ))
        };
        if mode == "corrupt" {
            fs::write(&target, b"{}").unwrap();
        }
        let fired = AtomicBool::new(false);
        let replace = |path: &Path, access: AccessMode| {
            if mode != "corrupt"
                && path.ends_with("manifest.pending")
                && access == AccessMode::Write
                && root
                    .path()
                    .join("artifacts/maintenance/evidence/recovery.json")
                    .exists()
                && !fired.swap(true, Ordering::SeqCst)
            {
                let bytes = fs::read(&target).unwrap();
                fs::rename(&target, root.path().join("replaced-partition-input")).unwrap();
                fs::write(&target, bytes).unwrap();
            }
            Ok(())
        };
        assert!(
            recover_refresh_pending(root.path(), request, &replace).is_err(),
            "{mode}"
        );
        assert_eq!(fired.load(Ordering::SeqCst), mode != "corrupt");
        assert_eq!(
            fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
            original
        );
        assert!(
            root.path()
                .join("artifacts/maintenance/manifest.pending")
                .exists()
        );
        release_test_receipt(root.path());
    }
}

#[test]
fn partitioned_refresh_discard_refuses_mixed_unknown_and_broader_pending_state() {
    for mode in ["mixed", "unknown", "broader"] {
        let (root, mut request, original) = partition_refresh_fixture();
        rewrite_refresh_pending(root.path(), &mut request, |index| match mode {
            "mixed" => {
                *index = json!({"revision":13,"items":{},"groups":{},"runs":{},"decisions":[]})
            }
            "unknown" => index["storage_format"] = json!("partitioned-v2"),
            "broader" => {
                let old_hash = index["items"]["payload"].as_str().unwrap().to_owned();
                let directory = root.path().join("artifacts/maintenance/state-records");
                let mut bucket: Value = serde_json::from_slice(
                    &fs::read(directory.join(format!("{old_hash}.json"))).unwrap(),
                )
                .unwrap();
                bucket["payload"]["cleanup_status"] = json!("deleted");
                let bytes = serde_json::to_vec(&bucket).unwrap();
                let new_hash = sha(&bytes);
                fs::write(directory.join(format!("{new_hash}.json")), bytes).unwrap();
                index["items"]["payload"] = json!(new_hash);
            }
            _ => unreachable!(),
        });
        assert!(
            recover_refresh_pending(root.path(), request, &allow).is_err(),
            "{mode}"
        );
        assert_eq!(
            fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
            original
        );
        assert!(
            root.path()
                .join("artifacts/maintenance/manifest.pending")
                .exists()
        );
        assert!(
            !root
                .path()
                .join("artifacts/maintenance/evidence/recovery.json")
                .exists()
        );
    }
}

#[test]
fn refresh_discard_preserves_authoritative_bytes_failures_and_pending_intents() {
    let (root, request, original) = refresh_fixture();
    let response = dispatch(root.path(), request, &allow).unwrap();
    assert_eq!(response["status"], "discarded");
    assert_eq!(
        fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
        original
    );
    assert!(
        !root
            .path()
            .join("artifacts/maintenance/manifest.pending")
            .exists()
    );
    let receipt_path = root
        .path()
        .join("artifacts/maintenance/evidence/recovery.json");
    let receipt: Value = serde_json::from_slice(&fs::read(&receipt_path).unwrap()).unwrap();
    assert_eq!(receipt["status"], "authorized_discard_attempt");
    assert_eq!(receipt["base_revision"], 12);
    assert_eq!(receipt["pending_revision"], 13);
    assert_eq!(
        receipt["changed_protection_revisions"][0]["before"],
        "a".repeat(64)
    );
    assert_eq!(
        receipt["changed_protection_revisions"][0]["pending"],
        "b".repeat(64)
    );
    assert!(fs::metadata(receipt_path).unwrap().permissions().readonly());
    assert!(
        root.path()
            .join("artifacts/maintenance/maintenance.lock")
            .exists()
    );
    release_test_receipt(root.path());
}

#[test]
fn refresh_discard_refuses_stale_hashes_wrong_group_live_pid_and_missing_attestation() {
    for (key, value) in [
        ("expected_manifest_sha256", json!("c".repeat(64))),
        ("expected_pending_sha256", json!("c".repeat(64))),
        ("evidence_sha256", json!("c".repeat(64))),
        ("group_id", json!("other")),
        ("producer_pid", json!(std::process::id())),
        ("producer_stopped_verified", json!(false)),
        ("receipt_ref", json!("artifacts/maintenance/manifest.json")),
        (
            "receipt_ref",
            json!("artifacts/maintenance/evidence/stopped.txt"),
        ),
    ] {
        let (root, mut request, original) = refresh_fixture();
        request[key] = value;
        assert!(
            recover_refresh_pending(root.path(), request, &allow).is_err(),
            "{key}"
        );
        assert!(
            root.path()
                .join("artifacts/maintenance/manifest.pending")
                .exists()
        );
        assert_eq!(
            fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
            original
        );
        release_test_receipt(root.path());
    }
}

#[test]
fn refresh_discard_accepts_absent_prior_revisions_but_rejects_null_and_mixed_presence() {
    for mode in 0..4 {
        let (root, mut request, _) = refresh_fixture();
        let manifest = root.path().join("artifacts/maintenance/manifest.json");
        let mut base: Value = serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();
        if mode == 1 {
            base["groups"]["run"]["protection_revision"] = Value::Null;
            base["items"]["payload"]["protection_revision"] = Value::Null;
        } else {
            if mode != 3 {
                base["groups"]["run"]
                    .as_object_mut()
                    .unwrap()
                    .remove("protection_revision");
            }
            if mode != 2 {
                base["items"]["payload"]
                    .as_object_mut()
                    .unwrap()
                    .remove("protection_revision");
            }
        }
        let original = serde_json::to_vec_pretty(&base).unwrap();
        fs::write(&manifest, &original).unwrap();
        request["expected_manifest_sha256"] = json!(sha(&original));
        let response = recover_refresh_pending(root.path(), request, &allow);
        assert_eq!(fs::read(&manifest).unwrap(), original);
        if mode == 0 {
            assert_eq!(response.unwrap()["status"], "discarded");
            let receipt: Value = serde_json::from_slice(
                &fs::read(
                    root.path()
                        .join("artifacts/maintenance/evidence/recovery.json"),
                )
                .unwrap(),
            )
            .unwrap();
            for change in receipt["changed_protection_revisions"].as_array().unwrap() {
                assert_eq!(change["before_present"], false);
                assert_eq!(change["before"], Value::Null);
                assert_eq!(change["pending"], "b".repeat(64));
            }
            assert!(
                !root
                    .path()
                    .join("artifacts/maintenance/manifest.pending")
                    .exists()
            );
        } else {
            assert!(response.is_err(), "{mode}");
            assert!(
                root.path()
                    .join("artifacts/maintenance/manifest.pending")
                    .exists()
            );
        }
        release_test_receipt(root.path());
    }
}

#[test]
fn refresh_discard_rejects_every_broader_transaction_and_inconsistent_membership() {
    for pointer in [
        "/items/payload/generated",
        "/items/payload/protection_known",
        "/items/payload/references",
        "/items/payload/cleanup_status",
        "/items/payload/pending_intent",
        "/items/payload/lifecycle_group_id",
        "/groups/run/membership_complete",
        "/groups/run/membership_source_identity",
        "/groups/run/membership_source_format",
        "/groups/run/members",
        "/runs/failed/exit_code",
        "/runs/unknown/status",
        "/decisions",
    ] {
        let (root, mut request, original) = refresh_fixture();
        rewrite_refresh_pending(root.path(), &mut request, |pending| {
            *pending.pointer_mut(pointer).unwrap() = json!("forbidden change");
        });
        assert!(
            recover_refresh_pending(root.path(), request, &allow).is_err(),
            "{pointer}"
        );
        assert!(
            root.path()
                .join("artifacts/maintenance/manifest.pending")
                .exists()
        );
        assert_eq!(
            fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
            original
        );
    }
}

#[test]
fn refresh_discard_refuses_corruption_revision_errors_and_noop() {
    for mode in 0..7 {
        let (root, mut request, _) = refresh_fixture();
        if mode == 0 {
            let bytes = b"invalid JSON";
            fs::write(
                root.path().join("artifacts/maintenance/manifest.pending"),
                bytes,
            )
            .unwrap();
            request["expected_pending_sha256"] = json!(sha(bytes));
        } else {
            rewrite_refresh_pending(root.path(), &mut request, |pending| match mode {
                1 => pending["revision"] = json!(12),
                2 => pending["revision"] = json!(14),
                3 => pending["groups"]["run"]["protection_revision"] = json!("bad digest"),
                4 => pending["items"]["payload"]["protection_revision"] = json!("c".repeat(64)),
                5 => {
                    pending["groups"]["run"]["protection_revision"] = json!("a".repeat(64));
                    pending["items"]["payload"]["protection_revision"] = json!("a".repeat(64));
                }
                6 => pending["items"]["orphan"] = pending["items"]["payload"].clone(),
                _ => unreachable!(),
            });
        }
        assert!(
            recover_refresh_pending(root.path(), request, &allow).is_err(),
            "{mode}"
        );
        assert!(
            root.path()
                .join("artifacts/maintenance/manifest.pending")
                .exists()
        );
    }
}

#[test]
fn refresh_discard_refuses_occupied_os_locks_and_preserves_lock_inodes() {
    for lock_name in ["maintenance.lock", "recovery.guard"] {
        let (root, request, _) = refresh_fixture();
        let lock = root.path().join("artifacts/maintenance").join(lock_name);
        let file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&lock)
            .unwrap();
        file.try_lock().unwrap();
        assert!(recover_refresh_pending(root.path(), request, &allow).is_err());
        assert!(lock.exists());
        assert!(
            root.path()
                .join("artifacts/maintenance/manifest.pending")
                .exists()
        );
    }
}

#[test]
fn refresh_discard_bounds_evidence_and_never_overwrites_receipts() {
    for oversized in [true, false] {
        let (root, mut request, _) = refresh_fixture();
        if oversized {
            let bytes = vec![b'x'; 65_537];
            fs::write(
                root.path()
                    .join("artifacts/maintenance/evidence/stopped.txt"),
                &bytes,
            )
            .unwrap();
            request["evidence_sha256"] = json!(sha(&bytes));
        } else {
            fs::write(
                root.path()
                    .join("artifacts/maintenance/evidence/recovery.json"),
                b"existing evidence",
            )
            .unwrap();
        }
        assert!(recover_refresh_pending(root.path(), request, &allow).is_err());
        assert!(
            root.path()
                .join("artifacts/maintenance/manifest.pending")
                .exists()
        );
        if !oversized {
            assert_eq!(
                fs::read(
                    root.path()
                        .join("artifacts/maintenance/evidence/recovery.json")
                )
                .unwrap(),
                b"existing evidence"
            );
        }
    }
}

#[cfg(windows)]
#[test]
fn failed_ordinary_refresh_discard_retains_truthful_attempt_receipt() {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_READ, FILE_SHARE_WRITE};

    let (root, request, original) = refresh_fixture();
    let pending = root.path().join("artifacts/maintenance/manifest.pending");
    // Permit verification reads but deny deletion while this handle is alive.
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .open(&pending)
        .unwrap();
    let error = recover_refresh_pending(root.path(), request, &allow).unwrap_err();
    assert!(error.contains("ordinary pending discard failed"), "{error}");
    assert!(pending.exists());
    assert_eq!(
        fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
        original
    );
    let receipt: Value = serde_json::from_slice(
        &fs::read(
            root.path()
                .join("artifacts/maintenance/evidence/recovery.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(receipt["status"], "authorized_discard_attempt");
    drop(held);
    release_test_receipt(root.path());
}

#[test]
fn refresh_discard_refuses_authorization_denials_and_callback_sibling_replacements() {
    for selected in [
        "manifest.json",
        "manifest.pending",
        "stopped.txt",
        "recovery.json",
    ] {
        let (root, request, original) = refresh_fixture();
        let deny = |path: &Path, _: AccessMode| {
            if path.ends_with(selected) {
                Err("explicit recovery access denial".into())
            } else {
                Ok(())
            }
        };
        assert!(recover_refresh_pending(root.path(), request, &deny).is_err());
        assert!(
            root.path()
                .join("artifacts/maintenance/manifest.pending")
                .exists()
        );
        assert_eq!(
            fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
            original
        );
    }
    for selected in [
        "manifest.json",
        "manifest.pending",
        "evidence/stopped.txt",
        "evidence/recovery.json",
    ] {
        let (root, request, _) = refresh_fixture();
        let fired = AtomicBool::new(false);
        let replace = |path: &Path, access: AccessMode| {
            if path.ends_with("manifest.pending")
                && access == AccessMode::Write
                && root
                    .path()
                    .join("artifacts/maintenance/evidence/recovery.json")
                    .exists()
                && !fired.swap(true, Ordering::SeqCst)
            {
                let target = root.path().join("artifacts/maintenance").join(selected);
                let bytes = fs::read(&target).unwrap();
                #[cfg(windows)]
                if selected == "evidence/recovery.json" {
                    let mut permissions = fs::metadata(&target).unwrap().permissions();
                    permissions.set_readonly(false);
                    fs::set_permissions(&target, permissions).unwrap();
                }
                fs::rename(&target, root.path().join("replaced-original")).unwrap();
                fs::write(&target, bytes).unwrap();
            }
            Ok(())
        };
        assert!(
            recover_refresh_pending(root.path(), request, &replace).is_err(),
            "{selected}"
        );
        assert!(fired.load(Ordering::SeqCst));
        assert!(
            root.path()
                .join("artifacts/maintenance/manifest.pending")
                .exists()
        );
        release_test_receipt(root.path());
        #[cfg(windows)]
        if selected == "evidence/recovery.json" {
            let path = root.path().join("replaced-original");
            let mut permissions = fs::metadata(&path).unwrap().permissions();
            permissions.set_readonly(false);
            fs::set_permissions(path, permissions).unwrap();
        }
    }
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn stopped_pid() -> u32 {
    let mut command = std::process::Command::new(std::env::current_exe().unwrap());
    command
        .arg("--list")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn().unwrap();
    let pid = child.id();
    assert!(child.wait().unwrap().success());
    drop(child);
    pid
}

fn release_test_receipt(root: &Path) {
    #[cfg(windows)]
    {
        let path = root.join("artifacts/maintenance/evidence/recovery.json");
        if let Ok(metadata) = fs::metadata(&path) {
            let mut permissions = metadata.permissions();
            permissions.set_readonly(false);
            fs::set_permissions(path, permissions).unwrap();
        }
    }
    #[cfg(not(windows))]
    let _ = root;
}
fn fixture(kind: &str, bytes: &[u8], token: Value) -> (tempfile::TempDir, Value) {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir_all(root.path().join("artifacts/maintenance/lifecycles")).unwrap();
    fs::create_dir(root.path().join("artifacts/maintenance/evidence")).unwrap();
    let lock = match kind {
        "maintenance" => "maintenance.lock",
        "catalog" => "lifecycles/catalog.lock",
        "run_claim" => "lifecycles/.run-claim.lock",
        _ => panic!("unknown fixture kind"),
    };
    fs::write(root.path().join("artifacts/maintenance").join(lock), bytes).unwrap();
    fs::write(
        root.path()
            .join("artifacts/maintenance/evidence/stopped.txt"),
        "independently verified exact producer tree stopped",
    )
    .unwrap();
    let request = json!({"operation":"recover_lock","lock_kind":kind,"expected_lock_sha256":sha(bytes),
        "expected_token":token,"producer_stopped_verified":true,"reason":"exact producer termination verified",
        "evidence_ref":"artifacts/maintenance/evidence/stopped.txt",
        "evidence_sha256":sha(b"independently verified exact producer tree stopped"),
        "receipt_ref":"artifacts/maintenance/evidence/recovery.json"});
    (root, request)
}
fn modern(pid: u32) -> Vec<u8> {
    serde_json::to_vec(&json!({"schema":1,"pid":pid,"token":"test-token","acquired_at_ms":1,"operation":"fixture"})).unwrap()
}

#[test]
fn live_owner_is_a_veto_despite_attestation() {
    let (root, request) = fixture(
        "maintenance",
        &modern(std::process::id()),
        json!("test-token"),
    );
    let error = recover_lock(root.path(), request, &allow).unwrap_err();
    assert!(error.contains("owner PID"), "{error}");
    assert!(
        root.path()
            .join("artifacts/maintenance/maintenance.lock")
            .exists()
    );
    assert!(
        !root
            .path()
            .join("artifacts/maintenance/evidence/recovery.json")
            .exists()
    );
}

#[test]
fn removes_exact_modern_lock_after_preserving_independent_receipt_and_run_state() {
    let (root, request) = fixture("maintenance", &modern(stopped_pid()), json!("test-token"));
    let manifest = root.path().join("artifacts/maintenance/manifest.json");
    fs::write(&manifest, "unknown run exit must remain unknown").unwrap();
    // Dispatch works before config loading and Store::open, even without config.
    let result = dispatch(root.path(), request, &allow).unwrap();
    assert_eq!(result["status"], "recovered");
    assert!(
        !root
            .path()
            .join("artifacts/maintenance/maintenance.lock")
            .exists()
    );
    let receipt_path = root
        .path()
        .join("artifacts/maintenance/evidence/recovery.json");
    let receipt: Value = serde_json::from_slice(&fs::read(&receipt_path).unwrap()).unwrap();
    assert_eq!(receipt["expected_token"], "test-token");
    assert_eq!(
        receipt["evidence"],
        "independently verified exact producer tree stopped"
    );
    assert!(fs::metadata(receipt_path).unwrap().permissions().readonly());
    assert_eq!(
        fs::read_to_string(manifest).unwrap(),
        "unknown run exit must remain unknown"
    );
    assert!(
        root.path()
            .join("artifacts/maintenance/recovery.guard")
            .exists()
    );
    release_test_receipt(root.path());
}

#[test]
fn legacy_empty_and_pid_only_catalog_and_claim_remain_explicitly_recoverable() {
    for (kind, bytes) in [
        ("catalog", Vec::new()),
        ("run_claim", format!("pid={}\n", stopped_pid()).into_bytes()),
    ] {
        let (root, request) = fixture(kind, &bytes, Value::Null);
        assert_eq!(
            recover_lock(root.path(), request, &allow).unwrap()["status"],
            "recovered"
        );
        release_test_receipt(root.path());
    }
}

#[test]
fn exact_hash_token_evidence_and_attestation_are_required() {
    for (key, bad) in [
        ("expected_lock_sha256", json!("wrong")),
        ("expected_token", Value::Null),
        ("evidence_sha256", json!("wrong")),
        ("producer_stopped_verified", json!(false)),
        ("reason", json!("  ")),
        ("lock_kind", json!("arbitrary")),
    ] {
        let (root, mut request) =
            fixture("maintenance", &modern(stopped_pid()), json!("test-token"));
        request[key] = bad;
        assert!(recover_lock(root.path(), request, &allow).is_err(), "{key}");
        assert!(
            root.path()
                .join("artifacts/maintenance/maintenance.lock")
                .exists()
        );
        release_test_receipt(root.path());
    }
}

#[test]
fn pending_manifest_and_evidence_escape_are_refused() {
    let (root, request) = fixture("maintenance", b"", Value::Null);
    fs::write(
        root.path().join("artifacts/maintenance/manifest.pending"),
        "pending",
    )
    .unwrap();
    assert!(
        recover_lock(root.path(), request, &allow)
            .unwrap_err()
            .contains("manifest.pending")
    );
    for selected in [
        "artifacts/maintenance/manifest.json",
        "../outside",
        "artifacts/maintenance/evidence/../maintenance.lock",
    ] {
        let (root, mut request) = fixture("maintenance", b"", Value::Null);
        request["evidence_ref"] = json!(selected);
        assert!(recover_lock(root.path(), request, &allow).is_err());
    }
}

#[test]
fn replaced_target_and_drifting_evidence_survive_recovery() {
    for replace_target in [true, false] {
        let (root, request) = fixture("maintenance", b"", Value::Null);
        let fired = AtomicBool::new(false);
        let callback = |path: &Path, access: AccessMode| {
            if access == AccessMode::Write
                && path.ends_with("recovery.json")
                && !fired.swap(true, Ordering::SeqCst)
            {
                if replace_target {
                    let target = root.path().join("artifacts/maintenance/maintenance.lock");
                    fs::rename(&target, root.path().join("original.lock")).unwrap();
                    fs::write(&target, b"").unwrap();
                } else {
                    fs::write(
                        root.path()
                            .join("artifacts/maintenance/evidence/stopped.txt"),
                        "changed",
                    )
                    .unwrap();
                }
            }
            Ok(())
        };
        assert!(recover_lock(root.path(), request, &callback).is_err());
        assert!(fired.load(Ordering::SeqCst));
        assert!(
            root.path()
                .join("artifacts/maintenance/maintenance.lock")
                .exists()
        );
    }
}

#[test]
fn denied_read_receipt_write_or_target_delete_preserves_target() {
    for denied in ["stopped.txt", "recovery.json", "maintenance.lock"] {
        let (root, request) = fixture("maintenance", b"", Value::Null);
        let callback = |path: &Path, access: AccessMode| {
            if path.ends_with(denied) && (denied == "stopped.txt" || access == AccessMode::Write) {
                Err("test authorization refused".into())
            } else {
                Ok(())
            }
        };
        assert!(
            recover_lock(root.path(), request, &callback)
                .unwrap_err()
                .contains("authorization refused")
        );
        assert!(
            root.path()
                .join("artifacts/maintenance/maintenance.lock")
                .exists()
        );
        release_test_receipt(root.path());
    }
}

#[test]
fn hardlinked_evidence_and_existing_receipts_are_refused() {
    for hardlink in [true, false] {
        let (root, request) = fixture("maintenance", b"", Value::Null);
        if hardlink {
            fs::hard_link(
                root.path()
                    .join("artifacts/maintenance/evidence/stopped.txt"),
                root.path().join("second-evidence-link"),
            )
            .unwrap();
        } else {
            fs::write(
                root.path()
                    .join("artifacts/maintenance/evidence/recovery.json"),
                "existing receipt",
            )
            .unwrap();
        }
        assert!(recover_lock(root.path(), request, &allow).is_err());
        assert!(
            root.path()
                .join("artifacts/maintenance/maintenance.lock")
                .exists()
        );
    }
}

#[test]
fn last_authorization_cannot_replace_previously_checked_evidence_or_create_pending() {
    for create_pending in [true, false] {
        let (root, request) = fixture("maintenance", b"", Value::Null);
        let fired = AtomicBool::new(false);
        let callback = |path: &Path, access: AccessMode| {
            if access == AccessMode::Read
                && path.ends_with("recovery.guard")
                && root
                    .path()
                    .join("artifacts/maintenance/evidence/recovery.json")
                    .exists()
                && !fired.swap(true, Ordering::SeqCst)
            {
                let changed = if create_pending {
                    "artifacts/maintenance/manifest.pending"
                } else {
                    "artifacts/maintenance/evidence/stopped.txt"
                };
                fs::write(root.path().join(changed), "changed at final authorization").unwrap();
            }
            Ok(())
        };
        assert!(recover_lock(root.path(), request, &callback).is_err());
        assert!(fired.load(Ordering::SeqCst));
        assert!(
            root.path()
                .join("artifacts/maintenance/maintenance.lock")
                .exists()
        );
        release_test_receipt(root.path());
    }
}

#[test]
fn exclusive_recovery_guard_refuses_overlapping_attempts_and_is_retained() {
    let (root, request) = fixture("maintenance", b"", Value::Null);
    let guard_path = root.path().join("artifacts/maintenance/recovery.guard");
    let guard = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&guard_path)
        .unwrap();
    guard.try_lock().unwrap();
    let error = recover_lock(root.path(), request.clone(), &allow).unwrap_err();
    let busy = azrael_project_maintenance::error_response(&error);
    assert_eq!(busy["code"], "maintenance_busy", "{error}");
    assert_eq!(busy["retryable"], true);
    assert_eq!(busy["lock_path"], serde_json::json!(guard_path));
    assert!(guard_path.exists());
    assert!(
        root.path()
            .join("artifacts/maintenance/maintenance.lock")
            .exists()
    );
    drop(guard);
    assert_eq!(
        recover_lock(root.path(), request, &allow).unwrap()["status"],
        "recovered"
    );
    assert!(guard_path.exists());
    release_test_receipt(root.path());
}

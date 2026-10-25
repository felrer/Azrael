//! Retained recovery contracts: explicit evidence and exact identity are mandatory.
use azrael_project_maintenance::{AccessMode, dispatch, recover_lock};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

fn allow(_: &Path, _: AccessMode) -> Result<(), String> {
    Ok(())
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
    assert!(
        recover_lock(root.path(), request.clone(), &allow)
            .unwrap_err()
            .contains("guard unavailable")
    );
    drop(guard);
    assert_eq!(
        recover_lock(root.path(), request, &allow).unwrap()["status"],
        "recovered"
    );
    assert!(guard_path.exists());
    release_test_receipt(root.path());
}

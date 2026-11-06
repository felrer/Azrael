//! Format transition preserves ordinary contracts and fails closed for old owners.
use azrael_project_maintenance::{AccessMode, dispatch};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::path::Path;

fn allow(_: &Path, _: AccessMode) -> Result<(), String> {
    Ok(())
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn fixture() -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(root.path().join("artifacts/maintenance/evidence")).unwrap();
    std::fs::write(root.path().join("project-maintenance.json"), serde_json::to_vec(&json!({
        "schema_version":1,"project_id":"partition","managed_roots":["artifacts/payload"],"bundles":[]
    })).unwrap()).unwrap();
    std::fs::create_dir(root.path().join("artifacts/payload")).unwrap();
    register(&root, "one");
    root
}
fn register(root: &tempfile::TempDir, id: &str) {
    let path = root.path().join("artifacts/payload").join(id);
    std::fs::write(&path, id).unwrap();
    dispatch(root.path(), json!({"operation":"register","item":{
        "id":id,"path":path,"kind":"artifact","owner":"test","generated":true,"protection_known":true,"references":[]
    }}), &allow).unwrap();
}
fn transition(root: &tempfile::TempDir) -> Value {
    let evidence = b"All fixture native calls completed synchronously; no producer tree launched.";
    std::fs::write(
        root.path()
            .join("artifacts/maintenance/evidence/partition.json"),
        evidence,
    )
    .unwrap();
    let manifest = std::fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap();
    json!({"operation":"partition_storage","writers_stopped_verified":true,"reason":"fixture transition",
        "evidence_ref":"artifacts/maintenance/evidence/partition.json","evidence_sha256":sha(evidence),
        "expected_manifest_sha256":sha(&manifest)})
}

#[test]
fn explicit_partition_preserves_reads_updates_cleanup_and_old_owner_refusal() {
    let root = fixture();
    let request = transition(&root);
    let result = dispatch(root.path(), request, &allow).unwrap();
    assert_eq!(result["status"], "partitioned");
    let path = root.path().join("artifacts/maintenance/manifest.json");
    let index: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(index["storage_format"], "partitioned-v1");
    assert!(
        index["revision"].as_u64().is_none(),
        "old State cannot decode the index as ordinary metadata"
    );
    register(&root, "two");
    let read_only = |_: &Path, mode| {
        if mode == AccessMode::Read {
            Ok(())
        } else {
            Err("read-only".into())
        }
    };
    let inventory = dispatch(root.path(), json!({"operation":"inventory"}), &read_only).unwrap();
    assert_eq!(inventory["items"].as_array().unwrap().len(), 2);
    let review = dispatch(
        root.path(),
        json!({"operation":"review","ids":["one"]}),
        &allow,
    )
    .unwrap();
    let applied = dispatch(
        root.path(),
        json!({"operation":"apply","decisions":[{
            "id":"one","token":review["items"][0]["token"],"decision":"delete","reason":"fixture"
        }]}),
        &allow,
    )
    .unwrap();
    assert_eq!(applied["results"][0]["status"], "deleted");
    assert!(!root.path().join("artifacts/payload/one").exists());
    assert_eq!(
        std::fs::read_to_string(root.path().join("artifacts/payload/two")).unwrap(),
        "two"
    );
    assert!(
        !root
            .path()
            .join("artifacts/maintenance/manifest.pending")
            .exists()
    );
}

#[test]
fn partition_refuses_missing_attestation_drift_pending_and_unknown_reservations() {
    let root = fixture();
    let original = std::fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap();
    let request = transition(&root);
    let mut missing = request.clone();
    missing["writers_stopped_verified"] = json!(false);
    assert!(
        dispatch(root.path(), missing, &allow)
            .unwrap_err()
            .contains("writer-stop")
    );
    let mut drift = request.clone();
    drift["expected_manifest_sha256"] = json!("0".repeat(64));
    assert!(
        dispatch(root.path(), drift, &allow)
            .unwrap_err()
            .contains("SHA changed")
    );
    let pending = root.path().join("artifacts/maintenance/manifest.pending");
    std::fs::write(&pending, "uncertain").unwrap();
    assert!(
        dispatch(root.path(), request.clone(), &allow)
            .unwrap_err()
            .contains("pending")
    );
    std::fs::remove_file(pending).unwrap();
    let reservations = root
        .path()
        .join("artifacts/maintenance/lifecycles/reservations");
    std::fs::create_dir_all(&reservations).unwrap();
    std::fs::write(reservations.join("unresolved.json"), "unresolved").unwrap();
    assert!(
        dispatch(root.path(), request, &allow)
            .unwrap_err()
            .contains("reservation")
    );
    assert_eq!(
        std::fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
        original
    );
    assert!(
        !root
            .path()
            .join("artifacts/maintenance/state-records")
            .exists()
    );
}

#[test]
fn partitioned_snapshot_refuses_corrupt_blob_without_changing_committed_index() {
    let root = fixture();
    dispatch(root.path(), transition(&root), &allow).unwrap();
    let path = root.path().join("artifacts/maintenance/manifest.json");
    let before = std::fs::read(&path).unwrap();
    let index: Value = serde_json::from_slice(&before).unwrap();
    let hash = index["items"]["one"].as_str().unwrap();
    std::fs::write(
        root.path()
            .join(format!("artifacts/maintenance/state-records/{hash}.json")),
        "{}",
    )
    .unwrap();
    assert!(dispatch(root.path(), json!({"operation":"inventory"}), &allow).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

#[test]
fn unknown_format_never_loads_as_an_empty_legacy_state() {
    let root = fixture();
    let manifest = root.path().join("artifacts/maintenance/manifest.json");
    let future = serde_json::to_vec(&json!({"storage_format":"future","revision":1,"items":{},"groups":{},"runs":{},"decisions":[]})).unwrap();
    std::fs::write(&manifest, &future).unwrap();
    assert!(
        dispatch(root.path(), json!({"operation":"inventory"}), &allow)
            .unwrap_err()
            .contains("unsupported")
    );
    assert_eq!(std::fs::read(manifest).unwrap(), future);
}

#[test]
fn explicit_compaction_reclaims_only_valid_unreferenced_state_blobs() {
    let root = fixture();
    dispatch(root.path(), transition(&root), &allow).unwrap();
    let bytes = serde_json::to_vec(&json!({"orphan":{"value":1}})).unwrap();
    let orphan = root.path().join(format!(
        "artifacts/maintenance/state-records/{}.json",
        sha(&bytes)
    ));
    std::fs::write(&orphan, bytes).unwrap();
    let mut request = transition(&root);
    request["operation"] = json!("compact_storage");
    let result = dispatch(root.path(), request, &allow).unwrap();
    assert_eq!(result["status"], "compacted");
    assert!(!orphan.exists());
    let inventory = dispatch(root.path(), json!({"operation":"inventory"}), &allow).unwrap();
    assert_eq!(inventory["items"].as_array().unwrap().len(), 1);
}

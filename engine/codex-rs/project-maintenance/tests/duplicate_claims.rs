//! Ownership migration must never discard history or relax physical deletion guards.
use azrael_project_maintenance::{AccessMode, dispatch};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::path::Path;
use tempfile::TempDir;

fn allow(_: &Path, _: AccessMode) -> Result<(), String> {
    Ok(())
}
fn call(root: &TempDir, request: Value) -> Value {
    dispatch(root.path(), request, &allow).unwrap()
}
fn state(root: &TempDir) -> Value {
    serde_json::from_slice(
        &std::fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
    )
    .unwrap()
}
fn fixture() -> TempDir {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("generated")).unwrap();
    std::fs::write(
        root.path().join("generated/payload"),
        b"preserve these bytes",
    )
    .unwrap();
    std::fs::write(root.path().join("project-maintenance.json"), serde_json::to_vec(&json!({"schema_version":1,"project_id":"duplicates","managed_roots":["generated"],"bundles":[]})).unwrap()).unwrap();
    for id in ["alpha", "beta"] {
        call(
            &root,
            json!({"operation":"register","group":{"id":id,"owner":id,"kind":"work","version":"fixture","membership_complete":true,"provenance_ref":"fixture","members":[{"id":format!("{id}-item"),"path":"generated/payload","kind":"cache","owner":id,"generated":true,"protection_known":true,"references":[]}]}}),
        );
    }
    root
}
fn request(root: &TempDir) -> Value {
    let migration = json!({"sources":[{"id":"alpha","owner":"alpha"},{"id":"beta","owner":"beta"}],"target":{"id":"canonical","owner":"canonical-owner"},"reason":"consolidate duplicate ownership"});
    let snapshot = state(root);
    let groups = [
        snapshot["groups"]["alpha"].clone(),
        snapshot["groups"]["beta"].clone(),
    ];
    let items = [
        snapshot["items"]["alpha-item"].clone(),
        snapshot["items"]["beta-item"].clone(),
    ];
    let bytes =
        serde_json::to_vec(&json!({"migration":migration,"groups":groups,"items":items})).unwrap();
    let directory = root.path().join("artifacts/maintenance/evidence");
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join("duplicates.json"), &bytes).unwrap();
    let mut request = migration;
    request["operation"] = json!("reconcile_duplicate_groups");
    request["phase"] = json!("review");
    request["evidence_ref"] = json!("artifacts/maintenance/evidence/duplicates.json");
    request["evidence_sha256"] = json!(format!("{:x}", Sha256::digest(bytes)));
    request
}
fn apply(root: &TempDir, mut request: Value) -> Value {
    let reviewed = call(root, request.clone());
    request["phase"] = json!("apply");
    request["token"] = reviewed["token"].clone();
    call(root, request)
}
fn save_state(root: &TempDir, state: &Value) {
    std::fs::write(
        root.path().join("artifacts/maintenance/manifest.json"),
        serde_json::to_vec(state).unwrap(),
    )
    .unwrap();
}

#[test]
fn consolidates_cross_owner_claims_without_touching_bytes_and_preserves_history_for_deletion() {
    let root = fixture();
    let original = state(&root);
    let req = request(&root);
    let result = apply(&root, req);
    assert_eq!(result["status"], "consolidated");
    assert_eq!(
        std::fs::read(root.path().join("generated/payload")).unwrap(),
        b"preserve these bytes"
    );
    let current = state(&root);
    assert!(current["groups"].get("alpha").is_none());
    assert!(current["items"].get("beta-item").is_none());
    assert_eq!(
        current["decisions"][0]["original_groups"][0],
        original["groups"]["alpha"]
    );
    assert_eq!(
        current["decisions"][0]["original_items"][1],
        original["items"]["beta-item"]
    );
    let item = &result["items"][0];
    assert_eq!(
        item["identity"],
        original["items"]["alpha-item"]["identity"]
    );
    assert_eq!(
        item["measured_at_ms"],
        original["items"]["alpha-item"]["measured_at_ms"]
    );
    let review = call(
        &root,
        json!({"operation":"review","group_ids":["canonical"]}),
    );
    assert_eq!(review["items"][0]["blockers"], json!([]));
    let deleted = call(
        &root,
        json!({"operation":"apply","decisions":[{"id":item["id"],"token":review["items"][0]["token"],"decision":"delete","reason":"fixture complete"}]}),
    );
    assert_eq!(deleted["results"][0]["status"], "deleted");
    assert!(!root.path().join("generated/payload").exists());
    assert_eq!(
        state(&root)["groups"]["canonical"]["reconciliation"]["original_items"][0],
        original["items"]["alpha-item"]
    );
}

#[test]
fn rejects_stale_apply_and_missing_owner_or_group_without_metadata_changes() {
    for variant in ["stale", "owner", "missing", "token", "hash"] {
        let root = fixture();
        let mut req = request(&root);
        let reviewed = call(&root, req.clone());
        req["phase"] = json!("apply");
        req["token"] = reviewed["token"].clone();
        match variant {
            "stale" => {
                let mut s = state(&root);
                s["revision"] = json!(100);
                save_state(&root, &s);
            }
            "owner" => req["sources"][0]["owner"] = json!("unknown"),
            "missing" => req["sources"][0]["id"] = json!("missing"),
            "token" => req["token"] = json!("invalid"),
            "hash" => req["evidence_sha256"] = json!("invalid"),
            _ => unreachable!(),
        }
        let before = state(&root);
        assert!(dispatch(root.path(), req, &allow).is_err(), "{variant}");
        assert_eq!(state(&root), before, "{variant}");
        assert!(root.path().join("generated/payload").exists());
    }
}

#[test]
fn rejects_protection_references_unknown_controls_and_incomplete_membership() {
    for variant in [
        "retained",
        "protected",
        "unknown",
        "reference",
        "inbound-item",
        "inbound-group",
        "pending",
        "incomplete",
        "measurement",
        "source-format",
        "source-path",
        "missing-member",
        "unlisted-member",
    ] {
        let root = fixture();
        let mut snapshot = state(&root);
        match variant {
            "retained" => snapshot["items"]["alpha-item"]["retain_reason"] = json!("needed"),
            "protected" => snapshot["items"]["alpha-item"]["protection_known"] = json!(false),
            "unknown" => snapshot["items"]["alpha-item"]["references"] = Value::Null,
            "reference" => snapshot["items"]["alpha-item"]["references"] = json!(["consumer"]),
            "inbound-item" | "inbound-group" => {
                snapshot["items"]["consumer"] = snapshot["items"]["alpha-item"].clone();
                snapshot["items"]["consumer"]["id"] = json!("consumer");
                snapshot["items"]["consumer"]["references"] =
                    json!([if variant == "inbound-item" {
                        "alpha-item"
                    } else {
                        "alpha"
                    }]);
            }
            "pending" => snapshot["items"]["alpha-item"]["cleanup_status"] = json!("pending"),
            "incomplete" => snapshot["groups"]["alpha"]["membership_complete"] = json!(false),
            "measurement" => snapshot["items"]["beta-item"]["identity"] = json!("different"),
            "source-format" => {
                snapshot["groups"]["alpha"]["membership_source_format"] =
                    json!("producer_registry_v1")
            }
            "source-path" => {
                snapshot["items"]["alpha-item"]["source_path"] = json!("generated/source")
            }
            "missing-member" => snapshot["groups"]["alpha"]["members"] = json!(["missing"]),
            "unlisted-member" => {
                snapshot["items"]["extra"] = snapshot["items"]["alpha-item"].clone();
                snapshot["items"]["extra"]["id"] = json!("extra");
            }
            _ => unreachable!(),
        }
        save_state(&root, &snapshot);
        let req = request(&root);
        let before = state(&root);
        assert!(dispatch(root.path(), req, &allow).is_err(), "{variant}");
        assert_eq!(state(&root), before, "{variant}");
    }
}

#[test]
fn rejects_unselected_and_nested_overlap_and_changed_membership_evidence() {
    for variant in ["unselected", "nested", "source"] {
        let root = fixture();
        if variant == "source" {
            let source = root.path().join("membership.json");
            std::fs::write(&source, "original").unwrap();
            let mut group = state(&root)["groups"]["alpha"].clone();
            group["members"] = json!([state(&root)["items"]["alpha-item"]]);
            group["membership_source"] = json!("membership.json");
            call(&root, json!({"operation":"register","group":group}));
            std::fs::write(source, "changed").unwrap();
        } else {
            let path = if variant == "nested" {
                "generated"
            } else {
                "generated/payload"
            };
            call(
                &root,
                json!({"operation":"register","item":{"id":"unselected","owner":"other","path":path,"kind":"cache","generated":true,"protection_known":true,"references":[]}}),
            );
        }
        let req = request(&root);
        let before = state(&root);
        assert!(dispatch(root.path(), req, &allow).is_err(), "{variant}");
        assert_eq!(state(&root), before);
    }
}

#[test]
fn canonical_evidence_remains_protected_and_tampering_blocks_later_cleanup() {
    let root = fixture();
    let req = request(&root);
    apply(&root, req);
    std::fs::write(
        root.path()
            .join("artifacts/maintenance/evidence/duplicates.json"),
        "tampered",
    )
    .unwrap();
    let review = call(
        &root,
        json!({"operation":"review","group_ids":["canonical"]}),
    );
    assert!(
        !review["items"][0]["blockers"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(root.path().join("generated/payload").exists());
}

#[test]
fn unresolved_reservation_and_denied_write_permission_leave_metadata_unchanged() {
    for reserved in [true, false] {
        let root = fixture();
        let req = request(&root);
        if reserved {
            // A persisted, unowned fence must remain a blocker even without a live lease.
            let directory = root
                .path()
                .join("artifacts/maintenance/lifecycles/reservations");
            std::fs::create_dir_all(&directory).unwrap();
            let name = format!(
                "{:x}.json",
                Sha256::digest(serde_json::to_vec("alpha").unwrap())
            );
            std::fs::write(
                directory.join(name),
                serde_json::to_vec(
                    &json!({"schema":1,"id":"alpha","token":"unresolved","members":[]}),
                )
                .unwrap(),
            )
            .unwrap();
        }
        let before = state(&root);
        let authorize = |path: &Path, mode: AccessMode| {
            if !reserved && mode == AccessMode::Write && path.ends_with("payload") {
                Err("fixture denies payload write".into())
            } else {
                Ok(())
            }
        };
        assert!(dispatch(root.path(), req, &authorize).is_err());
        assert_eq!(state(&root), before);
        assert!(root.path().join("generated/payload").exists());
    }
}

#[test]
fn unreadable_or_unknown_catalog_record_cannot_be_silently_omitted() {
    let root = fixture();
    let req = request(&root);
    let unknown = root
        .path()
        .join("artifacts/maintenance/lifecycles/unknown.json");
    std::fs::write(unknown, "{unparseable").unwrap();
    let before = state(&root);
    assert!(dispatch(root.path(), req, &allow).is_err());
    assert_eq!(state(&root), before);
}

#[test]
fn root_retirement_ignores_only_freshly_absent_terminal_claims() {
    let root = fixture();
    let req = request(&root);
    apply(&root, req);
    let reviewed = call(
        &root,
        json!({"operation":"review","group_ids":["canonical"]}),
    );
    call(
        &root,
        json!({"operation":"apply","decisions":[{"id":reviewed["items"][0]["id"],"token":reviewed["items"][0]["token"],"decision":"delete","reason":"fixture complete"}]}),
    );
    call(
        &root,
        json!({"operation":"register","group":{"id":"parent","owner":"parent-owner","kind":"work","version":"fixture","membership_complete":true,"provenance_ref":"fixture","members":[{"id":"parent-item","path":"generated","kind":"cache","owner":"parent-owner","generated":true,"protection_known":true,"references":[]}]}}),
    );
    let review = json!({"operation":"review","group_ids":["parent"],"retire_managed_roots":{"ids":["parent-item"],"owner":"parent-owner","reason":"fixture root retirement","evidence_ref":"artifacts/maintenance/evidence/duplicates.json"}});
    assert_eq!(
        call(&root, review.clone())["items"][0]["blockers"],
        json!([])
    );
    std::fs::write(root.path().join("generated/payload"), "reappeared").unwrap();
    assert!(dispatch(root.path(), review, &allow).is_err());
}

#[test]
fn standalone_cli_migrates_then_ordinary_cli_deletes() {
    let root = fixture();
    let invoke = |request: Value| {
        let request_path = root.path().join("request.json");
        std::fs::write(&request_path, serde_json::to_vec(&request).unwrap()).unwrap();
        let output = std::process::Command::new(env!("CARGO_BIN_EXE_maintenance_owner"))
            .env("AZRAEL_STATE_ROOT", root.path().join("fixture-preferences"))
            .arg("--project-root")
            .arg(root.path())
            .arg("--request")
            .arg(request_path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice::<Value>(&output.stdout).unwrap()
    };
    let mut req = request(&root);
    let reviewed = invoke(req.clone());
    req["phase"] = json!("apply");
    req["token"] = reviewed["token"].clone();
    assert_eq!(invoke(req)["status"], "consolidated");
    assert_eq!(
        std::fs::read(root.path().join("generated/payload")).unwrap(),
        b"preserve these bytes"
    );
    let reviewed = invoke(json!({"operation":"review","group_ids":["canonical"]}));
    let deleted = invoke(
        json!({"operation":"apply","decisions":[{"id":reviewed["items"][0]["id"],"token":reviewed["items"][0]["token"],"decision":"delete","reason":"CLI fixture complete"}]}),
    );
    assert_eq!(deleted["results"][0]["status"], "deleted");
    assert!(!root.path().join("generated/payload").exists());
}

#[test]
fn passive_deferred_claims_migrate_and_preserve_the_prior_decision_audit() {
    let root = fixture();
    let mut snapshot = state(&root);
    for id in ["alpha", "beta"] {
        snapshot["groups"][id]["cleanup_status"] = json!("deferred");
    }
    for id in ["alpha-item", "beta-item"] {
        snapshot["items"][id]["cleanup_status"] = json!("deferred");
    }
    let history = json!([{"id":"alpha-item","decision":"defer","status":"deferred","reason":"overlapping owner claims","revisit_condition":"ownership reconciliation"}]);
    snapshot["decisions"] = history.clone();
    snapshot["decisions"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"unrelated","status":"deferred"}));
    save_state(&root, &snapshot);
    let req = request(&root);
    apply(&root, req);
    assert_eq!(
        state(&root)["groups"]["canonical"]["reconciliation"]["original_decisions"],
        history
    );
    let review = call(
        &root,
        json!({"operation":"review","group_ids":["canonical"]}),
    );
    assert_eq!(review["items"][0]["blockers"], json!([]));
    call(
        &root,
        json!({"operation":"apply","decisions":[{"id":review["items"][0]["id"],"token":review["items"][0]["token"],"decision":"delete","reason":"fixture complete"}]}),
    );
    assert_eq!(
        state(&root)["groups"]["canonical"]["reconciliation"]["original_decisions"],
        history
    );
}

#[test]
fn complete_membership_preserves_present_and_freshly_absent_paths() {
    let root = fixture();
    let mut snapshot = state(&root);
    for source in ["alpha", "beta"] {
        let id = format!("{source}-absent");
        let mut item = snapshot["items"][format!("{source}-item")].clone();
        item["id"] = json!(id);
        item["path"] = json!(root.path().join("generated/absent"));
        snapshot["items"][&id] = item;
        snapshot["groups"][source]["members"]
            .as_array_mut()
            .unwrap()
            .push(json!(id));
    }
    save_state(&root, &snapshot);
    let mut req = request(&root);
    let evidence_path = root
        .path()
        .join("artifacts/maintenance/evidence/duplicates.json");
    let mut evidence: Value =
        serde_json::from_slice(&std::fs::read(&evidence_path).unwrap()).unwrap();
    evidence["items"] = json!([
        snapshot["items"]["alpha-item"],
        snapshot["items"]["alpha-absent"],
        snapshot["items"]["beta-item"],
        snapshot["items"]["beta-absent"]
    ]);
    let bytes = serde_json::to_vec(&evidence).unwrap();
    std::fs::write(evidence_path, &bytes).unwrap();
    req["evidence_sha256"] = json!(format!("{:x}", Sha256::digest(bytes)));
    let result = apply(&root, req);
    assert_eq!(result["items"].as_array().unwrap().len(), 2);
    assert_eq!(
        result["receipt"]["original_items"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
    assert!(
        result["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["presence"] == "absent" && item["remaining"] == false)
    );
    assert_eq!(
        std::fs::read(root.path().join("generated/payload")).unwrap(),
        b"preserve these bytes"
    );
}

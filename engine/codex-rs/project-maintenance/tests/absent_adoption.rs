//! First adoption of never-created producer outputs preserves complete ownership.
use azrael_project_maintenance::{AccessMode, dispatch};
use serde_json::{Value, json};
use std::path::Path;
use tempfile::TempDir;

fn allow(_: &Path, _: AccessMode) -> Result<(), String> {
    Ok(())
}

fn fixture() -> (TempDir, Value, Value) {
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("artifacts/maintenance/lifecycles");
    std::fs::create_dir_all(&source).unwrap();
    std::fs::create_dir_all(root.path().join("artifacts/adoption")).unwrap();
    std::fs::write(root.path().join("artifacts/adoption/log"), "evidence").unwrap();
    std::fs::write(root.path().join("project-maintenance.json"), serde_json::to_vec(&json!({
        "schema_version":1,"project_id":"absent-adoption","managed_roots":["artifacts/adoption"],"bundles":[]
    })).unwrap()).unwrap();
    let owner = json!({"schema":1,"id":"run","kind":"run","owner":"test","version":null,
    "state":"complete","membership_complete":true,"references":[],"members":[
        {"path":root.path().join("artifacts/adoption/output"),"role":"artifact","generated":true,"protection_known":true},
        {"path":root.path().join("artifacts/adoption/log"),"role":"log","generated":true,"protection_known":true}
    ]});
    let request = json!({"operation":"register","group":{"id":"run","kind":"run","owner":"test","version":null,
    "membership_complete":true,"provenance_ref":"producer:run","membership_source":source,"membership_source_format":"producer_registry_v1","members":[
        {"id":"output","path":"artifacts/adoption/output","kind":"artifact","owner":"test","generated":true,"protection_known":true,"references":[]},
        {"id":"log","path":"artifacts/adoption/log","kind":"log","owner":"test","generated":true,"protection_known":true,"references":[]}
    ]}});
    (root, owner, request)
}

fn write_owner(root: &TempDir, owner: &Value) {
    std::fs::write(
        root.path()
            .join("artifacts/maintenance/lifecycles/run.json"),
        serde_json::to_vec(owner).unwrap(),
    )
    .unwrap();
}

fn review(root: &TempDir, mode: &str) -> Value {
    dispatch(
        root.path(),
        json!({"operation":"review","group_ids":["run"],"verification":mode}),
        &allow,
    )
    .unwrap()
}

fn apply(root: &TempDir, reviewed: &Value, mode: &str) -> Value {
    let decisions = reviewed["items"].as_array().unwrap().iter().map(|item| {
        json!({"id":item["id"],"token":item["token"],"decision":"delete","reason":"settled fixture producer"})
    }).collect::<Vec<_>>();
    dispatch(
        root.path(),
        json!({"operation":"apply","decisions":decisions,"verification":mode}),
        &allow,
    )
    .unwrap()
}

#[test]
fn first_adoption_keeps_absent_member_and_reconciles_without_deletion_attempt() {
    for mode in ["registered", "full"] {
        let (root, owner, request) = fixture();
        write_owner(&root, &owner);
        let registered = dispatch(root.path(), request, &allow).unwrap();
        let output = registered["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == "output")
            .unwrap();
        assert_eq!(output["presence"], "absent");
        assert_eq!(output["remaining"], false);
        assert!(output["identity"].is_null());
        assert_eq!(registered["group"]["members"].as_array().unwrap().len(), 2);
        let reviewed = review(&root, mode);
        assert!(
            reviewed["items"]
                .as_array()
                .unwrap()
                .iter()
                .all(|item| item["blockers"].as_array().unwrap().is_empty()),
            "{reviewed}"
        );
        let result = apply(&root, &reviewed, mode);
        let output = result["results"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == "output")
            .unwrap();
        assert_eq!(output["status"], "deleted");
        assert_eq!(output["attempted"], false);
        assert_eq!(result["groups"][0]["status"], "deleted");
    }
}

#[test]
fn reappearance_blocks_fresh_review_and_stale_apply_in_both_modes() {
    for mode in ["registered", "full"] {
        let (root, owner, request) = fixture();
        write_owner(&root, &owner);
        dispatch(root.path(), request, &allow).unwrap();
        let initial = review(&root, mode);
        std::fs::write(
            root.path().join("artifacts/adoption/output"),
            "new unrelated bytes",
        )
        .unwrap();
        let reviewed = review(&root, mode);
        assert!(
            reviewed
                .to_string()
                .contains("previously absent target reappeared")
        );
        assert!(
            reviewed["items"]
                .as_array()
                .unwrap()
                .iter()
                .all(|item| !item["blockers"].as_array().unwrap().is_empty())
        );
        let result = apply(&root, &initial, mode);
        assert_ne!(result["groups"][0]["status"], "deleted");
        assert_eq!(
            std::fs::read_to_string(root.path().join("artifacts/adoption/output")).unwrap(),
            "new unrelated bytes"
        );
        assert!(root.path().join("artifacts/adoption/log").exists());
    }
}

#[test]
fn unproven_absence_is_rejected_without_partial_registration() {
    for mutation in [
        "unknown",
        "incomplete",
        "owner",
        "role",
        "missing-proof",
        "unowned",
        "unprotected",
        "plain-group",
        "standalone",
        "consumer",
    ] {
        let (root, mut owner, mut request) = fixture();
        match mutation {
            "unknown" => owner["state"] = json!("pending"),
            "incomplete" => owner["membership_complete"] = json!(false),
            "owner" => owner["owner"] = json!("other"),
            "role" => owner["members"][0]["role"] = json!("snapshot"),
            "missing-proof" => {
                owner["members"][0]
                    .as_object_mut()
                    .unwrap()
                    .remove("generated");
            }
            "unowned" => owner["members"][0]["generated"] = json!(false),
            "unprotected" => owner["members"][0]["protection_known"] = json!(false),
            "plain-group" => {
                request["group"]
                    .as_object_mut()
                    .unwrap()
                    .remove("membership_source_format");
            }
            "standalone" => {
                request = json!({"operation":"register","item":request["group"]["members"][0]})
            }
            "consumer" => {
                let mut consumer = owner.clone();
                consumer["id"] = json!("consumer");
                consumer["references"] = json!([{"id":"run","reason":"in use"}]);
                std::fs::write(
                    root.path()
                        .join("artifacts/maintenance/lifecycles/consumer.json"),
                    serde_json::to_vec(&consumer).unwrap(),
                )
                .unwrap();
            }
            _ => unreachable!(),
        }
        write_owner(&root, &owner);
        assert!(
            dispatch(root.path(), request, &allow).is_err(),
            "{mutation}"
        );
        let inventory = dispatch(root.path(), json!({"operation":"inventory"}), &allow).unwrap();
        assert!(
            inventory["items"].as_array().unwrap().is_empty(),
            "{mutation}"
        );
    }
}

#[test]
fn absent_adoption_still_requires_ancestor_authorization() {
    let (root, owner, request) = fixture();
    write_owner(&root, &owner);
    let denied = root.path().join("artifacts/adoption/output");
    let authorize = |path: &Path, _: AccessMode| {
        if path == denied {
            Err("fixture denied".into())
        } else {
            Ok(())
        }
    };
    assert!(dispatch(root.path(), request, &authorize).is_err());
    let inventory = dispatch(root.path(), json!({"operation":"inventory"}), &allow).unwrap();
    assert!(inventory["items"].as_array().unwrap().is_empty());
}

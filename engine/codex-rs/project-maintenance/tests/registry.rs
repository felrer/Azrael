//! Producer catalogs isolate unrelated work while preserving incoming references.
use azrael_project_maintenance::{AccessMode, dispatch};
use serde_json::{Value, json};
use std::path::Path;
use tempfile::TempDir;

fn allow(_: &Path, _: AccessMode) -> Result<(), String> {
    Ok(())
}
fn call(root: &TempDir, request: Value) -> Value {
    dispatch(root.path(), request, &allow).unwrap()
}
fn directory(root: &TempDir) -> std::path::PathBuf {
    root.path().join("artifacts/maintenance/lifecycles")
}
fn record(root: &TempDir, id: &str) -> Value {
    json!({"schema":1,"id":id,"kind":"version","owner":"test","version":"v1","state":"complete","membership_complete":true,"members":[{"path":root.path().join("artifacts/registry-fixtures/artifact"),"role":"artifact"},{"path":root.path().join("artifacts/registry-fixtures/log"),"role":"log"}],"references":[]})
}
fn write(root: &TempDir, name: &str, record: &Value) {
    std::fs::write(
        directory(root).join(format!("{name}.json")),
        serde_json::to_vec(record).unwrap(),
    )
    .unwrap();
}
fn fixture() -> TempDir {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(directory(&root)).unwrap();
    std::fs::create_dir_all(root.path().join("artifacts/registry-fixtures")).unwrap();
    for id in ["artifact", "log"] {
        std::fs::write(
            root.path()
                .join(format!("artifacts/registry-fixtures/{id}")),
            id,
        )
        .unwrap();
    }
    std::fs::write(root.path().join("project-maintenance.json"), serde_json::to_vec(&json!({"schema_version":1,"project_id":"registry-test","managed_roots":["artifacts/registry-fixtures"],"bundles":[]})).unwrap()).unwrap();
    write(&root, "version", &record(&root, "version"));
    root
}
fn registration(root: &TempDir) -> Value {
    json!({"operation":"register","group":{"id":"version","kind":"version","owner":"test","version":"v1","membership_complete":true,"provenance_ref":"producer:version","membership_source":directory(root),"membership_source_format":"producer_registry_v1","members":[
        {"id":"artifact","path":"artifacts/registry-fixtures/artifact","kind":"artifact","role":"artifact","lifecycle_role":"artifact","owner":"test","generated":true,"protection_known":true,"references":[]},
        {"id":"log","path":"artifacts/registry-fixtures/log","kind":"log","role":"log","lifecycle_role":"log","owner":"test","generated":true,"protection_known":true,"references":[]}
    ]}})
}
fn review(root: &TempDir) -> Value {
    call(root, json!({"operation":"review","group_ids":["version"]}))
}
fn apply(root: &TempDir, reviewed: &Value) -> Value {
    let decisions = reviewed["items"].as_array().unwrap().iter().map(|item| json!({"id":item["id"],"token":item["token"],"decision":"delete","reason":"producer completed"})).collect::<Vec<_>>();
    call(root, json!({"operation":"apply","decisions":decisions}))
}
fn blocked(reviewed: &Value) -> bool {
    reviewed["items"]
        .as_array()
        .unwrap()
        .iter()
        .all(|item| !item["blockers"].as_array().unwrap().is_empty())
}
fn stable(reviewed: &Value) -> Vec<Value> {
    reviewed["items"].as_array().unwrap().iter().map(|item| json!({"id":item["id"],"token":item["token"],"blockers":item["blockers"],"source":item["membership_source_observation"]})).collect()
}

#[test]
fn protected_components_inside_selected_project_remain_rejected() {
    for protected in [".git", ".azrael-ex", ".codex", ".ssh"] {
        let root = fixture();
        let mut owner = record(&root, "version");
        owner["members"][0]["path"] = json!(
            root.path()
                .join("artifacts")
                .join(protected)
                .join("original")
        );
        write(&root, "version", &owner);
        assert!(
            dispatch(root.path(), registration(&root), &allow).is_err(),
            "{protected}"
        );
        assert_eq!(
            call(&root, json!({"operation":"inventory"}))["items"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
    }
}

#[test]
fn unrelated_valid_records_do_not_change_tokens_or_prevent_deletion() {
    let root = fixture();
    call(&root, registration(&root));
    let initial = review(&root);
    assert!(!blocked(&initial));
    let mut unrelated = record(&root, "other");
    write(&root, "other", &unrelated);
    assert_eq!(stable(&initial), stable(&review(&root)));
    unrelated["state"] = json!("pending");
    unrelated["revision"] = json!(2);
    write(&root, "other", &unrelated);
    assert_eq!(stable(&initial), stable(&review(&root)));
    std::fs::remove_file(directory(&root).join("other.json")).unwrap();
    assert_eq!(stable(&initial), stable(&review(&root)));
    assert_eq!(apply(&root, &initial)["groups"][0]["status"], "deleted");
}

#[test]
fn incoming_consumers_protect_even_when_added_between_projection_and_register() {
    for before_register in [false, true] {
        let root = fixture();
        let projected = registration(&root);
        let mut consumer = record(&root, "consumer");
        consumer["references"] = json!([{"id":"version","reason":"recovery copy in use"}]);
        if before_register {
            write(&root, "consumer", &consumer);
        }
        call(&root, projected);
        if !before_register {
            write(&root, "consumer", &consumer);
        }
        let protected = review(&root);
        assert!(blocked(&protected));
        assert!(protected.to_string().contains("producer inbound consumer"));
        let result = apply(&root, &protected);
        assert_ne!(result["groups"][0]["status"], "deleted");
        assert!(
            root.path()
                .join("artifacts/registry-fixtures/artifact")
                .exists()
        );
        std::fs::remove_file(directory(&root).join("consumer.json")).unwrap();
        if before_register {
            assert!(blocked(&review(&root)));
        }
        call(&root, registration(&root));
        assert!(!blocked(&review(&root)));
    }
}

#[test]
fn owner_coverage_metadata_and_completeness_must_match() {
    for mutation in [
        "extra",
        "missing",
        "role",
        "owner",
        "version",
        "pending",
        "incomplete",
        "native-role",
        "native-owner",
    ] {
        let root = fixture();
        let mut owner = record(&root, "version");
        match mutation {
            "extra" => owner["members"].as_array_mut().unwrap().push(json!({"path":root.path().join("artifacts/registry-fixtures/extra"),"role":"artifact"})),
            "missing" => { owner["members"].as_array_mut().unwrap().pop(); },
            "role" => owner["members"][0]["role"] = json!("snapshot"),
            "owner" => owner["owner"] = json!("different-owner"),
            "version" => owner["version"] = json!("v2"),
            "pending" => owner["state"] = json!("pending"),
            "incomplete" => owner["membership_complete"] = json!(false),
            "native-role" | "native-owner" => {},
            _ => unreachable!(),
        }
        write(&root, "version", &owner);
        let mut request = registration(&root);
        if mutation == "native-role" {
            request["group"]["members"][1]["lifecycle_role"] = json!("artifact");
        }
        if mutation == "native-owner" {
            request["group"]["members"][0]["owner"] = json!("another-owner");
        }
        call(&root, request);
        let protected = review(&root);
        assert!(blocked(&protected), "{mutation}: {protected}");
        apply(&root, &protected);
        assert!(
            root.path()
                .join("artifacts/registry-fixtures/artifact")
                .exists()
        );
    }
}

#[test]
fn missing_invalid_duplicate_denied_and_unknown_sources_fail_closed() {
    let root = fixture();
    let mut unknown = registration(&root);
    unknown["group"]["membership_source_format"] = json!("unknown");
    assert!(dispatch(root.path(), unknown, &allow).is_err());
    std::fs::remove_file(directory(&root).join("version.json")).unwrap();
    assert!(dispatch(root.path(), registration(&root), &allow).is_err());
    write(&root, "version", &record(&root, "version"));
    call(&root, registration(&root));
    std::fs::write(directory(&root).join("invalid.json"), "not json").unwrap();
    assert!(blocked(&review(&root)));
    std::fs::remove_file(directory(&root).join("invalid.json")).unwrap();
    write(&root, "duplicate", &record(&root, "version"));
    assert!(blocked(&review(&root)));
    std::fs::remove_file(directory(&root).join("duplicate.json")).unwrap();
    std::fs::create_dir(directory(&root).join("nested")).unwrap();
    assert!(blocked(&review(&root)));
    std::fs::remove_dir(directory(&root).join("nested")).unwrap();
    let denied = directory(&root).join("version.json");
    let authorize = |path: &Path, mode| {
        if path == denied && mode == AccessMode::Read {
            Err("record denied".into())
        } else {
            Ok(())
        }
    };
    let protected = dispatch(
        root.path(),
        json!({"operation":"review","group_ids":["version"]}),
        &authorize,
    )
    .unwrap();
    assert!(blocked(&protected));
}

#[test]
fn new_records_during_observation_distinguish_consumers_from_unrelated_work() {
    use std::cell::Cell;
    for inbound in [false, true] {
        let root = fixture();
        call(&root, registration(&root));
        let initial = review(&root);
        let changed = Cell::new(false);
        let owner_path = directory(&root).join("version.json");
        let authorize = |path: &Path, mode| {
            if path == owner_path && mode == AccessMode::Read && !changed.replace(true) {
                let mut added = record(&root, "new-producer");
                if inbound {
                    added["references"] = json!([{"id":"version","reason":"new consumer"}]);
                }
                write(&root, "new-producer", &added);
            }
            Ok(())
        };
        let observed = dispatch(
            root.path(),
            json!({"operation":"review","group_ids":["version"]}),
            &authorize,
        )
        .unwrap();
        assert!(changed.get());
        if inbound {
            assert!(blocked(&observed));
        } else {
            assert_eq!(stable(&initial), stable(&observed));
        }
    }
}

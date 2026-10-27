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
fn fixture(parent_refs: Value) -> TempDir {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(root.path().join("payload/outer/inner")).unwrap();
    std::fs::create_dir_all(root.path().join("artifacts/maintenance/evidence")).unwrap();
    std::fs::write(root.path().join("payload/outer/inner/data"), "child").unwrap();
    std::fs::write(root.path().join("payload/outer/keep"), "parent").unwrap();
    std::fs::write(
        root.path().join("artifacts/maintenance/evidence/authority"),
        "owner approval",
    )
    .unwrap();
    std::fs::write(
        root.path().join("project-maintenance.json"),
        json!({"schema_version":1,"project_id":"nested","managed_roots":["payload"]}).to_string(),
    )
    .unwrap();
    for (id, path, refs) in [
        ("parent", "payload/outer", parent_refs),
        ("child", "payload/outer/inner", json!([])),
    ] {
        call(
            &root,
            json!({"operation":"register","group":{"id":id,"kind":"work","owner":"owner","membership_complete":true,"provenance_ref":"fixture","members":[{"id":id,"path":path,"kind":"work","owner":"owner","generated":true,"protection_known":true,"references":refs}]}}),
        );
    }
    root
}
fn descriptor() -> Value {
    json!({"parent":"parent","child":"child","owner":"owner","reason":"retire nested claim first","evidence_ref":"artifacts/maintenance/evidence/authority"})
}
fn review(root: &TempDir) -> Value {
    call(
        root,
        json!({"operation":"review","ids":["parent","child"],"retire_nested_member":descriptor()}),
    )
}
fn choices(review: &Value) -> Value {
    // Intentionally parent first: apply must delete the child before recording
    // the parent's defer, which changes the enclosing item's token.
    json!(["parent", "child"].map(|id| {
        let item = review["items"].as_array().unwrap().iter().find(|i| i["id"] == id).unwrap();
        json!({"id":id,"token":item["token"],"decision":if id == "parent" {"defer"} else {"delete"},"reason":"owner retirement","revisit_condition":"register enclosing content after child deletion"})
    }))
}
fn apply(root: &TempDir, reviewed: &Value) -> Value {
    call(
        root,
        json!({"operation":"apply","retire_nested_member":descriptor(),"decisions":choices(reviewed)}),
    )
}

#[test]
fn child_only_retirement_preserves_parent_and_requires_new_outer_measurement() {
    let root = fixture(json!([]));
    let ordinary = call(
        &root,
        json!({"operation":"review","ids":["parent","child"]}),
    );
    assert!(
        ordinary["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|i| !i["blockers"].as_array().unwrap().is_empty())
    );
    let reviewed = review(&root);
    assert!(
        reviewed["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|i| i["blockers"] == json!([])),
        "{reviewed}"
    );
    let result = apply(&root, &reviewed);
    assert_eq!(result["results"][0]["id"], "child", "{result}");
    assert_eq!(result["results"][0]["status"], "deleted", "{result}");
    assert_eq!(result["results"][0]["remaining"], false);
    assert_eq!(result["results"][1]["status"], "deferred");
    assert!(root.path().join("payload/outer/keep").exists());
    assert!(!root.path().join("payload/outer/inner").exists());
    assert_eq!(result["results"][0]["retire_nested_member"], descriptor());
    let outer = call(
        &root,
        json!({"operation":"review","ids":["parent"],"verification":"full"}),
    );
    assert!(
        !outer["items"][0]["blockers"].as_array().unwrap().is_empty(),
        "changed content must be registered: {outer}"
    );
    call(
        &root,
        json!({"operation":"register","group":{"id":"parent","kind":"work","owner":"owner","membership_complete":true,"provenance_ref":"current enclosing content","members":[{"id":"parent","path":"payload/outer","kind":"work","owner":"owner","generated":true,"protection_known":true,"references":[]}]}}),
    );
    let refreshed = call(&root, json!({"operation":"review","ids":["parent"]}));
    assert_eq!(refreshed["items"][0]["blockers"], json!([]), "{refreshed}");
}

#[test]
fn ancestor_reference_and_stale_ancestor_token_block_child() {
    for references in [json!(["active installation"]), json!([])] {
        let root = fixture(references.clone());
        let mut reviewed = review(&root);
        if references == json!([]) {
            reviewed["items"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|i| i["id"] == "parent")
                .unwrap()["token"] = json!("stale");
        }
        let result = apply(&root, &reviewed);
        assert!(
            result["results"]
                .as_array()
                .unwrap()
                .iter()
                .all(|i| i["status"] == "blocked"),
            "{result}"
        );
        assert!(root.path().join("payload/outer/inner/data").exists());
    }
}

#[test]
fn descriptor_evidence_selection_and_fates_are_bound() {
    for mutation in [
        "evidence",
        "owner",
        "selection",
        "parent-delete",
        "omit-descriptor",
    ] {
        let root = fixture(json!([]));
        let reviewed = review(&root);
        let mut request = json!({"operation":"apply","retire_nested_member":descriptor(),"decisions":choices(&reviewed)});
        match mutation {
            "evidence" => std::fs::write(
                root.path().join("artifacts/maintenance/evidence/authority"),
                "changed",
            )
            .unwrap(),
            "owner" => request["retire_nested_member"]["owner"] = json!("other"),
            "selection" => {
                request["decisions"].as_array_mut().unwrap().pop();
            }
            "parent-delete" => request["decisions"][0]["decision"] = json!("delete"),
            _ => {
                request
                    .as_object_mut()
                    .unwrap()
                    .remove("retire_nested_member");
            }
        }
        let result = dispatch(root.path(), request, &allow);
        if let Ok(result) = result {
            assert!(
                result["results"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|i| i["status"] != "deleted"),
                "{mutation}: {result}"
            );
        }
        assert!(
            root.path().join("payload/outer/inner/data").exists(),
            "{mutation}"
        );
    }
}

#[test]
fn enclosing_membership_evidence_change_during_authorization_blocks_child() {
    let root = fixture(json!([]));
    let control = root.path().join("control.json");
    std::fs::write(&control, "original membership").unwrap();
    call(
        &root,
        json!({"operation":"register","group":{"id":"parent","kind":"work","owner":"owner","membership_complete":true,"provenance_ref":"fixture","membership_source":"control.json","members":[{"id":"parent","path":"payload/outer","kind":"work","owner":"owner","generated":true,"protection_known":true,"references":[]}]}}),
    );
    let reviewed = review(&root);
    let fired = std::sync::atomic::AtomicBool::new(false);
    let authorize = |path: &Path, mode: AccessMode| {
        if mode == AccessMode::Write
            && path.ends_with("inner/data")
            && !fired.swap(true, std::sync::atomic::Ordering::SeqCst)
        {
            std::fs::write(&control, "changed membership").unwrap();
        }
        Ok(())
    };
    let result = dispatch(root.path(), json!({"operation":"apply","retire_nested_member":descriptor(),"decisions":choices(&reviewed)}), &authorize).unwrap();
    assert_eq!(result["results"][0]["status"], "blocked", "{result}");
    assert!(root.path().join("payload/outer/inner/data").exists());
}

#[test]
fn additional_live_member_and_write_denial_preserve_nested_payload() {
    let root = fixture(json!([]));
    std::fs::create_dir_all(root.path().join("payload/extra")).unwrap();
    call(
        &root,
        json!({"operation":"register","group":{"id":"parent","kind":"work","owner":"owner","membership_complete":true,"provenance_ref":"fixture","members":[
            {"id":"parent","path":"payload/outer","kind":"work","owner":"owner","generated":true,"protection_known":true,"references":[]},
            {"id":"extra","path":"payload/extra","kind":"work","owner":"owner","generated":true,"protection_known":true,"references":[]}
        ]}}),
    );
    assert!(dispatch(root.path(), json!({"operation":"review","ids":["parent","child"],"retire_nested_member":descriptor()}), &allow).is_err());
    let root = fixture(json!([]));
    let reviewed = review(&root);
    let authorize = |path: &Path, mode: AccessMode| {
        if mode == AccessMode::Write && path.ends_with("inner/data") {
            Err("denied child write".into())
        } else {
            Ok(())
        }
    };
    let result = dispatch(root.path(), json!({"operation":"apply","retire_nested_member":descriptor(),"decisions":choices(&reviewed)}), &authorize).unwrap();
    assert_eq!(result["results"][0]["status"], "blocked", "{result}");
    assert!(root.path().join("payload/outer/inner/data").exists());
}

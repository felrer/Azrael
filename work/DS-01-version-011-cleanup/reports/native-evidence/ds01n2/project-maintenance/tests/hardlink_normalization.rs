//! Native Windows normalization conservatively protects shared file attributes.
#![cfg(windows)]
use azrael_project_maintenance::{AccessMode, dispatch};
use serde_json::{Value, json};
use std::os::windows::fs::MetadataExt;
use std::path::Path;
use tempfile::TempDir;

fn allow(_: &Path, _: AccessMode) -> Result<(), String> {
    Ok(())
}

fn fixture(internal: bool, readonly: bool) -> (TempDir, std::path::PathBuf) {
    let root = tempfile::tempdir().unwrap();
    for directory in [
        "generated/payload",
        "generated/evidence",
        "generated/a-before",
        "outside",
    ] {
        std::fs::create_dir_all(root.path().join(directory)).unwrap();
    }
    let shared = root.path().join("generated/payload/shared");
    std::fs::write(&shared, "shared bytes").unwrap();
    let alias = root.path().join(if internal {
        "generated/payload/alias"
    } else {
        "outside/original"
    });
    std::fs::hard_link(&shared, &alias).unwrap();
    if readonly {
        let mut permissions = std::fs::metadata(&shared).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&shared, permissions).unwrap();
        let independent = root.path().join("generated/a-before/independent");
        std::fs::write(&independent, "independent bytes").unwrap();
        let mut permissions = std::fs::metadata(&independent).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(independent, permissions).unwrap();
    }
    std::fs::write(
        root.path().join("generated/evidence/log"),
        "preserve until payload succeeds",
    )
    .unwrap();
    std::fs::write(root.path().join("project-maintenance.json"),serde_json::to_vec(&json!({"schema_version":1,"project_id":"hardlink-fixture","managed_roots":["generated"],"bundles":[]})).unwrap()).unwrap();
    let members=[("a-before","artifact"),("payload","artifact"),("evidence","evidence")].iter().map(|(id,kind)|json!({"id":id,"path":format!("generated/{id}"),"kind":kind,"owner":"test","generated":true,"protection_known":true,"references":[]})).collect::<Vec<_>>();
    dispatch(root.path(),json!({"operation":"register","group":{"id":"fixture","kind":"run","owner":"test","membership_complete":true,"provenance_ref":"fixture","members":members}}),&allow).unwrap();
    (root, alias)
}

fn apply(root: &TempDir) -> Value {
    let reviewed = dispatch(
        root.path(),
        json!({"operation":"review","group_ids":["fixture"]}),
        &allow,
    )
    .unwrap();
    let decisions=reviewed["items"].as_array().unwrap().iter().map(|item|json!({"id":item["id"],"token":item["token"],"decision":"delete","reason":"fixture done"})).collect::<Vec<_>>();
    dispatch(
        root.path(),
        json!({"operation":"apply","decisions":decisions}),
        &allow,
    )
    .unwrap()
}

#[test]
fn external_shared_readonly_files_block_before_any_attributes_change_and_preserve_evidence() {
    for internal in [false] {
        let (root, alias) = fixture(internal, true);
        let shared = root.path().join("generated/payload/shared");
        let independent = root.path().join("generated/a-before/independent");
        let attributes = std::fs::metadata(&shared).unwrap().file_attributes();
        let independent_attributes = std::fs::metadata(&independent).unwrap().file_attributes();
        let result = apply(&root);
        assert!(
            result.to_string().contains("multiple hardlinks"),
            "{result}"
        );
        assert_ne!(result["groups"][0]["status"], "deleted");
        assert_eq!(
            std::fs::metadata(&shared).unwrap().file_attributes(),
            attributes
        );
        assert_eq!(
            std::fs::metadata(&alias).unwrap().file_attributes(),
            attributes
        );
        assert_eq!(
            std::fs::metadata(&independent).unwrap().file_attributes(),
            independent_attributes
        );
        assert_eq!(std::fs::read_to_string(&alias).unwrap(), "shared bytes");
        assert!(root.path().join("generated/evidence/log").exists());
        for path in [&shared, &independent] {
            let mut permissions = std::fs::metadata(path).unwrap().permissions();
            permissions.set_readonly(false);
            std::fs::set_permissions(path, permissions).unwrap();
        }
    }
}

#[test]
fn all_hardlink_names_inside_one_root_allow_owned_normalization() {
    let (root, _) = fixture(true, true);
    let result = apply(&root);
    assert_eq!(result["groups"][0]["status"], "deleted", "{result}");
    assert!(!root.path().join("generated/payload").exists());
    let payload = result["results"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == "payload")
        .unwrap();
    assert!(
        !payload["deletion"]["attributes"]
            .as_array()
            .unwrap()
            .is_empty(),
        "{payload}"
    );
}

#[test]
fn cross_member_hardlink_normalization_remains_conservatively_blocked() {
    let (root, alias) = fixture(false, true);
    let other_member = root.path().join("generated/evidence/shared");
    // Establish the cross-member fixture before restoring its readonly state;
    // Windows may reject renaming a readonly directory entry.
    let mut setup_permissions = std::fs::metadata(&alias).unwrap().permissions();
    setup_permissions.set_readonly(false);
    std::fs::set_permissions(&alias, setup_permissions).unwrap();
    std::fs::rename(alias, &other_member).unwrap();
    let mut setup_permissions = std::fs::metadata(&other_member).unwrap().permissions();
    setup_permissions.set_readonly(true);
    std::fs::set_permissions(&other_member, setup_permissions).unwrap();
    let result = apply(&root);
    assert_ne!(result["groups"][0]["status"], "deleted", "{result}");
    assert!(
        result
            .to_string()
            .contains("cross-member link ownership is not verified")
    );
    assert!(other_member.exists());
    for path in [
        root.path().join("generated/payload/shared"),
        root.path().join("generated/a-before/independent"),
    ] {
        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        assert!(permissions.readonly());
        permissions.set_readonly(false);
        std::fs::set_permissions(path, permissions).unwrap();
    }
}

#[test]
fn shared_files_without_attribute_changes_allow_ordinary_name_deletion() {
    for internal in [false, true] {
        let (root, alias) = fixture(internal, false);
        let result = apply(&root);
        assert_eq!(result["groups"][0]["status"], "deleted", "{result}");
        assert!(!root.path().join("generated/payload").exists());
        if !internal {
            assert_eq!(std::fs::read_to_string(alias).unwrap(), "shared bytes");
        }
    }
}

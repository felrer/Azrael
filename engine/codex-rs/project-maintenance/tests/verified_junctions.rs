//! Windows-only exact junction pins preserve target contents and fail closed.
#![cfg(windows)]
use azrael_project_maintenance::{AccessMode, dispatch};
use serde_json::{Value, json};
use std::path::Path;
use tempfile::TempDir;

fn allow(_: &Path, _: AccessMode) -> Result<(), String> {
    Ok(())
}

fn junction(entry: &Path, target: &Path) {
    let result = codex_utils_process::background_command("powershell.exe")
        .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; $null=New-Item -ItemType Junction -Path $env:MAINTENANCE_JUNCTION_ENTRY -Target $env:MAINTENANCE_JUNCTION_TARGET"])
        .env("MAINTENANCE_JUNCTION_ENTRY", entry).env("MAINTENANCE_JUNCTION_TARGET", target).output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}

fn fixture() -> (TempDir, Value) {
    let root = tempfile::tempdir().unwrap();
    for directory in [
        "generated/payload",
        "generated/evidence",
        "target",
        "other-target",
    ] {
        std::fs::create_dir_all(root.path().join(directory)).unwrap();
    }
    std::fs::write(root.path().join("target/untouched"), "target bytes").unwrap();
    std::fs::write(root.path().join("generated/payload/owned"), "owned bytes").unwrap();
    std::fs::write(
        root.path().join("generated/evidence/log"),
        "retained until payload completes",
    )
    .unwrap();
    std::fs::write(root.path().join("project-maintenance.json"), serde_json::to_vec(&json!({"schema_version":1,"project_id":"junction-fixture","managed_roots":["generated"],"bundles":[]})).unwrap()).unwrap();
    junction(
        &root.path().join("generated/payload/link"),
        &root.path().join("target"),
    );
    let request = json!({"operation":"register","group":{"id":"fixture","kind":"run","owner":"test","membership_complete":true,"provenance_ref":"test fixture","members":[
        {"id":"payload","path":"generated/payload","kind":"artifact","owner":"test","generated":true,"protection_known":true,"references":[],"verified_junctions":[{"path":"link","kind":"junction","target":root.path().join("target")}]},
        {"id":"evidence","path":"generated/evidence","kind":"evidence","owner":"test","generated":true,"protection_known":true,"references":[]}
    ]}});
    (root, request)
}

fn review(root: &TempDir, mode: &str) -> Value {
    dispatch(
        root.path(),
        json!({"operation":"review","group_ids":["fixture"],"verification":mode}),
        &allow,
    )
    .unwrap()
}

fn apply(root: &TempDir, reviewed: &Value, mode: &str) -> Value {
    let decisions=reviewed["items"].as_array().unwrap().iter().map(|item|json!({"id":item["id"],"token":item["token"],"decision":"delete","reason":"fixture done"})).collect::<Vec<_>>();
    dispatch(
        root.path(),
        json!({"operation":"apply","decisions":decisions,"verification":mode}),
        &allow,
    )
    .unwrap()
}

#[test]
fn explicit_junction_registration_review_and_removal_never_read_target_payload() {
    use std::os::windows::fs::MetadataExt;
    for mode in ["registered", "full"] {
        let (root, request) = fixture();
        let untouched = root.path().join("target/untouched");
        let target_attributes = std::fs::metadata(&untouched).unwrap().file_attributes();
        let authorize = |path: &Path, _: AccessMode| {
            if path == untouched {
                Err("target payload must not be accessed".into())
            } else {
                Ok(())
            }
        };
        let registration = dispatch(root.path(), request, &authorize).unwrap();
        let payload = registration["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == "payload")
            .unwrap();
        assert!(payload["verified_junctions"][0]["identity"]["pin"].is_string());
        assert_eq!(payload["logical_bytes"], 11);
        let reviewed = dispatch(
            root.path(),
            json!({"operation":"review","group_ids":["fixture"],"verification":mode}),
            &authorize,
        )
        .unwrap();
        assert!(
            reviewed["items"]
                .as_array()
                .unwrap()
                .iter()
                .all(|item| item["blockers"].as_array().unwrap().is_empty()),
            "{reviewed}"
        );
        let result = apply(&root, &reviewed, mode);
        assert_eq!(result["groups"][0]["status"], "deleted", "{result}");
        // The target is deliberately nonempty: link-only native unlink must
        // preserve both its payload and attributes without an interactive prompt.
        assert_eq!(std::fs::read_to_string(&untouched).unwrap(), "target bytes");
        assert_eq!(
            std::fs::metadata(&untouched).unwrap().file_attributes(),
            target_attributes
        );
        assert!(!root.path().join("generated/payload").exists());
    }
}

#[test]
fn replacement_or_retarget_blocks_fresh_review_and_preserves_group_evidence() {
    for mode in ["registered", "full"] {
        for retarget in [false, true] {
            let (root, request) = fixture();
            dispatch(root.path(), request, &allow).unwrap();
            let reviewed = review(&root, mode);
            let link = root.path().join("generated/payload/link");
            std::fs::remove_dir(&link).unwrap();
            junction(
                &link,
                &root
                    .path()
                    .join(if retarget { "other-target" } else { "target" }),
            );
            let fresh = review(&root, mode);
            assert!(
                fresh["items"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|item| !item["blockers"].as_array().unwrap().is_empty()),
                "{fresh}"
            );
            let result = apply(&root, &reviewed, mode);
            assert_ne!(result["groups"][0]["status"], "deleted");
            assert!(root.path().join("generated/evidence/log").exists());
            assert!(root.path().join("target/untouched").exists());
            std::fs::remove_dir(link).unwrap();
        }
    }
}

#[test]
fn undeclared_junctions_and_root_or_ancestor_exceptions_remain_rejected() {
    for mutation in ["undeclared", "root", "ancestor", "unconfirmed"] {
        let (root, mut request) = fixture();
        let member = &mut request["group"]["members"][0];
        match mutation {
            "undeclared" => {
                member.as_object_mut().unwrap().remove("verified_junctions");
            }
            "root" => member["verified_junctions"][0]["path"] = json!("."),
            "ancestor" => member["verified_junctions"][0]["path"] = json!("link/child"),
            "unconfirmed" => member["generated"] = json!(false),
            _ => unreachable!(),
        }
        assert!(
            dispatch(root.path(), request, &allow).is_err(),
            "{mutation}"
        );
        std::fs::remove_dir(root.path().join("generated/payload/link")).unwrap();
    }
}

#[test]
fn newly_inserted_unapproved_junction_blocks_apply_before_any_group_deletion() {
    let (root, request) = fixture();
    dispatch(root.path(), request, &allow).unwrap();
    let reviewed = review(&root, "registered");
    let extra = root.path().join("generated/payload/extra");
    junction(&extra, &root.path().join("target"));
    let result = apply(&root, &reviewed, "registered");
    assert_ne!(result["groups"][0]["status"], "deleted");
    assert!(root.path().join("generated/evidence/log").exists());
    assert!(root.path().join("target/untouched").exists());
    std::fs::remove_dir(extra).unwrap();
    std::fs::remove_dir(root.path().join("generated/payload/link")).unwrap();
}

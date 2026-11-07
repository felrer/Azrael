//! Keep approved file links distinct from junctions and ordinary file entries.
#![cfg(windows)]
use azrael_project_maintenance::{AccessMode, dispatch};
use serde_json::{Value, json};
use std::os::windows::fs::{symlink_dir, symlink_file};
use std::path::Path;
use tempfile::TempDir;

fn allow(_: &Path, _: AccessMode) -> Result<(), String> {
    Ok(())
}

fn fixture(absolute: bool) -> (TempDir, Value) {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(root.path().join("generated/payload")).unwrap();
    std::fs::create_dir_all(root.path().join("generated/evidence")).unwrap();
    std::fs::write(
        root.path().join("generated/payload/COPYING"),
        "license bytes",
    )
    .unwrap();
    std::fs::write(root.path().join("generated/evidence/log"), "group evidence").unwrap();
    std::fs::write(root.path().join("project-maintenance.json"), serde_json::to_vec(&json!({"schema_version":1,"project_id":"file-link-fixture","managed_roots":["generated"],"bundles":[]})).unwrap()).unwrap();
    let target = root.path().join("generated/payload/COPYING");
    symlink_file(
        if absolute {
            target.as_path()
        } else {
            Path::new("COPYING")
        },
        root.path().join("generated/payload/LICENSE"),
    )
    .unwrap(); // Missing symlink privileges must fail the native acceptance check.
    let request = json!({"operation":"register","group":{"id":"fixture","kind":"run","owner":"test","membership_complete":true,"provenance_ref":"test fixture","members":[
        {"id":"payload","path":"generated/payload","kind":"artifact","owner":"test","generated":true,"protection_known":true,"references":[],"verified_file_symlinks":[{"path":"LICENSE","kind":"file_symlink","target":target}]},
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

fn decisions(reviewed: &Value, mode: &str) -> Value {
    let decisions = reviewed["items"].as_array().unwrap().iter().map(|item| json!({"id":item["id"],"token":item["token"],"decision":"delete","reason":"fixture done"})).collect::<Vec<_>>();
    json!({"operation":"apply","decisions":decisions,"verification":mode})
}

#[test]
fn relative_and_absolute_file_links_delete_in_both_modes_without_double_counting_target() {
    for mode in ["registered", "full"] {
        for absolute in [false, true] {
            let (root, request) = fixture(absolute);
            let target = root.path().join("generated/payload/COPYING");
            let mut permissions = std::fs::metadata(&target).unwrap().permissions();
            permissions.set_readonly(true);
            std::fs::set_permissions(&target, permissions).unwrap();
            let registered = dispatch(root.path(), request, &allow).unwrap();
            let payload = registered["items"]
                .as_array()
                .unwrap()
                .iter()
                .find(|item| item["id"] == "payload")
                .unwrap();
            assert!(payload["verified_file_symlinks"][0]["identity"]["pin"].is_string());
            assert_eq!(
                payload["logical_bytes"], 13,
                "link must not measure target bytes twice"
            );
            let reviewed = review(&root, mode);
            assert!(
                reviewed["items"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|item| item["blockers"].as_array().unwrap().is_empty()),
                "{reviewed}"
            );
            let result = dispatch(root.path(), decisions(&reviewed, mode), &allow).unwrap();
            assert_eq!(result["groups"][0]["status"], "deleted", "{result}");
            let payload = result["results"]
                .as_array()
                .unwrap()
                .iter()
                .find(|item| item["id"] == "payload")
                .unwrap();
            let changes = payload["deletion"]["attributes"].as_array().unwrap();
            assert_eq!(
                changes.len(),
                1,
                "only the ordinary selected target is normalized: {payload}"
            );
            assert_eq!(Path::new(changes[0]["path"].as_str().unwrap()), target);
            assert!(!root.path().join("generated/payload").exists());
            assert!(!root.path().join("generated/evidence").exists());
        }
    }
}

#[test]
fn replacement_and_retarget_preserve_group_evidence() {
    for mode in ["registered", "full"] {
        for retarget in [false, true] {
            let (root, request) = fixture(false);
            dispatch(root.path(), request, &allow).unwrap();
            let reviewed = review(&root, mode);
            let link = root.path().join("generated/payload/LICENSE");
            std::fs::remove_file(&link).unwrap();
            if retarget {
                std::fs::write(root.path().join("generated/payload/OTHER"), "other bytes").unwrap();
            }
            symlink_file(if retarget { "OTHER" } else { "COPYING" }, &link).unwrap();
            let fresh = review(&root, mode);
            assert!(
                fresh["items"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|item| !item["blockers"].as_array().unwrap().is_empty()),
                "{fresh}"
            );
            let result = dispatch(root.path(), decisions(&reviewed, mode), &allow).unwrap();
            assert_ne!(result["groups"][0]["status"], "deleted", "{result}");
            assert_eq!(
                std::fs::read_to_string(root.path().join("generated/payload/COPYING")).unwrap(),
                "license bytes"
            );
            assert!(root.path().join("generated/evidence/log").exists());
        }
    }
}

#[test]
fn undeclared_directory_outside_root_and_ancestor_links_remain_rejected() {
    for mutation in [
        "undeclared",
        "directory",
        "outside",
        "root",
        "ancestor",
        "chain",
    ] {
        let (root, mut request) = fixture(false);
        let member = &mut request["group"]["members"][0];
        let link = root.path().join("generated/payload/LICENSE");
        match mutation {
            "undeclared" => {
                member
                    .as_object_mut()
                    .unwrap()
                    .remove("verified_file_symlinks");
            }
            "root" => member["verified_file_symlinks"][0]["path"] = json!("."),
            "ancestor" => member["verified_file_symlinks"][0]["path"] = json!("LICENSE/child"),
            "directory" => {
                std::fs::remove_file(&link).unwrap();
                symlink_dir(root.path().join("generated/evidence"), &link).unwrap();
                member["verified_file_symlinks"][0]["target"] =
                    json!(root.path().join("generated/evidence"));
            }
            "outside" => {
                std::fs::remove_file(&link).unwrap();
                let outside = root.path().join("outside");
                std::fs::write(&outside, "outside bytes").unwrap();
                symlink_file(&outside, &link).unwrap();
                member["verified_file_symlinks"][0]["target"] = json!(outside);
            }
            "chain" => {
                std::fs::remove_file(&link).unwrap();
                symlink_file("COPYING", root.path().join("generated/payload/SECOND")).unwrap();
                symlink_file("SECOND", &link).unwrap();
                member["verified_file_symlinks"][0]["target"] =
                    json!(root.path().join("generated/payload/SECOND"));
            }
            _ => unreachable!(),
        }
        assert!(
            dispatch(root.path(), request, &allow).is_err(),
            "{mutation}"
        );
        if mutation == "directory" {
            std::fs::remove_dir(link).unwrap();
        }
    }
}

#[test]
fn denied_link_or_target_access_blocks_registration_and_apply() {
    for leaf in ["LICENSE", "COPYING"] {
        for denied_mode in [AccessMode::Read, AccessMode::Write] {
            let (root, request) = fixture(false);
            let denied = root.path().join("generated/payload").join(leaf);
            let authorize = move |path: &Path, mode: AccessMode| {
                if path == denied && mode == denied_mode {
                    Err("fixture permission denial".into())
                } else {
                    Ok(())
                }
            };
            if denied_mode == AccessMode::Read {
                assert!(
                    dispatch(root.path(), request.clone(), &authorize).is_err(),
                    "{leaf} {denied_mode:?}"
                );
            }
            dispatch(root.path(), request, &allow).unwrap();
            let reviewed = review(&root, "registered");
            let result = dispatch(root.path(), decisions(&reviewed, "registered"), &authorize);
            assert!(
                match &result {
                    Err(_) => true,
                    Ok(result) => result["groups"][0]["status"] != "deleted",
                },
                "{result:?}"
            );
            assert!(root.path().join("generated/evidence/log").exists());
            assert_eq!(
                std::fs::read_to_string(root.path().join("generated/payload/COPYING")).unwrap(),
                "license bytes"
            );
        }
    }
}

#[test]
fn reregistration_requires_declarations_for_links_that_remain_present() {
    for grouped in [false, true] {
        for empty in [false, true] {
            let (root, mut request) = fixture(false);
            if !grouped {
                request = json!({"operation":"register","item":request["group"]["members"][0]});
            }
            dispatch(root.path(), request.clone(), &allow).unwrap();
            // Explicit declarations remain valid when replacing an existing item.
            dispatch(root.path(), request.clone(), &allow).unwrap();
            let member = if grouped {
                &mut request["group"]["members"][0]
            } else {
                &mut request["item"]
            };
            if empty {
                member["verified_file_symlinks"] = json!([]);
            } else {
                member
                    .as_object_mut()
                    .unwrap()
                    .remove("verified_file_symlinks");
            }
            assert!(
                dispatch(root.path(), request, &allow).is_err(),
                "grouped={grouped}, empty={empty}"
            );
            assert_eq!(
                std::fs::read_to_string(root.path().join("generated/payload/COPYING")).unwrap(),
                "license bytes"
            );
            assert!(root.path().join("generated/evidence/log").exists());
        }
    }
}

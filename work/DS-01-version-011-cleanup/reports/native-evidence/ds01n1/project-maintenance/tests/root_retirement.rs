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
fn write_json(path: &Path, value: &Value) {
    std::fs::write(path, serde_json::to_vec(value).unwrap()).unwrap();
}
fn fixture() -> TempDir {
    let root = tempfile::tempdir().unwrap();
    for name in ["old", "other", "artifacts/maintenance/evidence"] {
        std::fs::create_dir_all(root.path().join(name)).unwrap();
    }
    std::fs::write(root.path().join("old/payload"), "owned").unwrap();
    std::fs::write(root.path().join("other/retained"), "retained").unwrap();
    std::fs::write(
        root.path()
            .join("artifacts/maintenance/evidence/owner.json"),
        "verified owner evidence",
    )
    .unwrap();
    write_json(
        &root.path().join("project-maintenance.json"),
        &json!({"schema_version":1,"project_id":"retirement-test","managed_roots":["old","other"]}),
    );
    register(&root, member(), true);
    root
}
fn member() -> Value {
    json!({"id":"old","path":"old","kind":"work","owner":"owner","generated":true,"protection_known":true,"references":[]})
}
fn register(root: &TempDir, item: Value, complete: bool) {
    call(
        root,
        json!({"operation":"register","group":{"id":"lifecycle","kind":"work","owner":"owner","version":"1","membership_complete":complete,"provenance_ref":"fixture","members":[item]}}),
    );
}
fn descriptor() -> Value {
    json!({"owner":"owner","reason":"explicit owner retirement","evidence_ref":"artifacts/maintenance/evidence/owner.json","ids":["old"]})
}
fn review_request() -> Value {
    json!({"operation":"review","ids":["old"],"retire_managed_roots":descriptor()})
}
fn apply_request(review: &Value) -> Value {
    json!({"operation":"apply","retire_managed_roots":descriptor(),"decisions":[{"id":"old","token":review["items"][0]["token"],"decision":"delete","reason":"explicit retirement"}]})
}
fn blocked(result: &Value) {
    assert_eq!(result["results"][0]["status"], "blocked", "{result}");
}
fn mutate_state(root: &TempDir, edit: impl FnOnce(&mut Value)) {
    // Fault injection only: production lifecycle writes always use dispatch.
    let path = root.path().join("artifacts/maintenance/manifest.json");
    let mut state: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    edit(&mut state);
    write_json(&path, &state);
}

#[test]
fn ordinary_root_guard_and_explicit_exact_retirement_preserve_other_root_and_history() {
    let root = fixture();
    let normal = call(&root, json!({"operation":"review","ids":["old"]}));
    assert!(
        !normal["items"][0]["blockers"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let reviewed = call(&root, review_request());
    assert!(
        reviewed["items"][0]["blockers"]
            .as_array()
            .unwrap()
            .is_empty(),
        "{reviewed}"
    );
    let result = call(&root, apply_request(&reviewed));
    assert_eq!(result["results"][0]["status"], "deleted", "{result}");
    assert_eq!(result["results"][0]["remaining"], false);
    assert_eq!(result["results"][0]["retire_managed_roots"], descriptor());
    assert!(
        result["results"][0]["retirement_evidence_identity"]
            .as_str()
            .is_some()
    );
    assert!(!root.path().join("old").exists());
    assert!(root.path().join("other/retained").exists());
    let inventory = call(&root, json!({"operation":"inventory"}));
    assert_eq!(inventory["items"][0]["cleanup_status"], "deleted");
    let config: Value = serde_json::from_slice(
        &std::fs::read(root.path().join("project-maintenance.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(config["managed_roots"], json!(["old", "other"]));
}

#[test]
fn retirement_tokens_bind_descriptor_evidence_and_operation_mode() {
    for change in [
        "reason",
        "evidence_ref",
        "evidence_bytes",
        "ordinary_review",
        "ordinary_apply",
    ] {
        let root = fixture();
        let reviewed = if change == "ordinary_review" {
            call(&root, json!({"operation":"review","ids":["old"]}))
        } else {
            call(&root, review_request())
        };
        let mut request = apply_request(&reviewed);
        match change {
            "reason" => request["retire_managed_roots"]["reason"] = json!("changed reason"),
            "evidence_ref" => {
                std::fs::write(
                    root.path()
                        .join("artifacts/maintenance/evidence/other.json"),
                    "same owner",
                )
                .unwrap();
                request["retire_managed_roots"]["evidence_ref"] =
                    json!("artifacts/maintenance/evidence/other.json");
            }
            "evidence_bytes" => std::fs::write(
                root.path()
                    .join("artifacts/maintenance/evidence/owner.json"),
                "changed evidence",
            )
            .unwrap(),
            "ordinary_apply" => {
                request
                    .as_object_mut()
                    .unwrap()
                    .remove("retire_managed_roots");
            }
            _ => {}
        }
        blocked(&call(&root, request));
        assert!(root.path().join("old/payload").exists());
    }
}

#[test]
fn invalid_retirement_descriptors_and_selection_fail_before_deletion() {
    let root = fixture();
    for (key, value) in [
        ("owner", json!("other")),
        ("owner", json!(" ")),
        ("reason", json!(" ")),
        ("evidence_ref", json!("missing")),
        ("ids", json!([])),
        ("ids", json!(["old", "old"])),
        ("ids", json!(["unknown"])),
        ("ids", json!([" "])),
        ("ids", json!(vec!["old"; 201])),
    ] {
        let mut request = review_request();
        request["retire_managed_roots"][key] = value;
        assert!(dispatch(root.path(), request, &allow).is_err(), "{key}");
    }
    let mut request = review_request();
    request["ids"] = json!([]);
    assert!(dispatch(root.path(), request, &allow).is_err());
    assert!(
        dispatch(
            root.path(),
            json!({"operation":"inventory","retire_managed_roots":descriptor()}),
            &allow
        )
        .is_err()
    );
    assert!(root.path().join("old/payload").exists());
}

#[test]
fn ownership_group_completeness_overlap_and_source_guards_remain() {
    for fault in [
        "ungrouped",
        "incomplete",
        "group_owner",
        "item_owner",
        "other_item",
        "source",
        "nested_root",
        "protected",
        "reserved",
        "descendant",
    ] {
        let root = fixture();
        match fault {
            "ungrouped" => mutate_state(&root, |s| {
                s["items"]["old"]
                    .as_object_mut()
                    .unwrap()
                    .remove("lifecycle_group_id");
            }),
            "incomplete" => register(&root, member(), false),
            "group_owner" => mutate_state(&root, |s| {
                s["groups"]["lifecycle"]["owner"] = json!("other")
            }),
            "item_owner" => mutate_state(&root, |s| s["items"]["old"]["owner"] = json!("other")),
            "other_item" | "source" => {
                let mut other = member();
                other["id"] = json!("another");
                other["path"] = json!(if fault == "source" {
                    "other"
                } else {
                    "old/payload"
                });
                if fault == "source" {
                    other["source_path"] = json!("old/payload");
                }
                call(&root, json!({"operation":"register","item":other}));
            }
            "nested_root" => write_json(
                &root.path().join("project-maintenance.json"),
                &json!({"schema_version":1,"project_id":"retirement-test","managed_roots":["old","old/nested"]}),
            ),
            "protected" => write_json(
                &root.path().join("project-maintenance.json"),
                &json!({"schema_version":1,"project_id":"retirement-test","managed_roots":["old"],"protected_paths":["old/payload"]}),
            ),
            "reserved" => mutate_state(&root, |s| {
                s["items"]["old"]["path"] = json!(root.path().join("artifacts/maintenance"))
            }),
            "descendant" => mutate_state(&root, |s| {
                s["items"]["old"]["path"] = json!(root.path().join("old/payload"))
            }),
            _ => unreachable!(),
        }
        assert!(
            dispatch(root.path(), review_request(), &allow).is_err(),
            "{fault}"
        );
        assert!(root.path().join("old/payload").exists());
    }
}

#[test]
fn protection_references_pending_and_unresolved_runs_remain_blockers() {
    for fault in ["protection", "reference", "pending", "run"] {
        let root = fixture();
        mutate_state(&root, |state| match fault {
            "protection" => state["items"]["old"]["protection_known"] = json!(false),
            "reference" => state["items"]["old"]["references"] = json!(["consumer"]),
            "pending" => state["items"]["old"]["cleanup_status"] = json!("pending"),
            "run" => {
                state["items"]["old"]["run_id"] = json!("active");
                state["runs"]["active"] =
                    json!({"steps":[{"producer_completed":false,"status":"unknown"}]});
            }
            _ => unreachable!(),
        });
        let reviewed = call(&root, review_request());
        assert!(
            !reviewed["items"][0]["blockers"]
                .as_array()
                .unwrap()
                .is_empty(),
            "{fault}"
        );
        blocked(&call(&root, apply_request(&reviewed)));
        assert!(root.path().join("old/payload").exists());
    }
}

#[test]
fn permission_denial_remains_truthful_and_does_not_delete() {
    let root = fixture();
    let reviewed = call(&root, review_request());
    let target = dunce::canonicalize(root.path().join("old")).unwrap();
    let deny = |path: &Path, mode| {
        if mode == AccessMode::Write && path.starts_with(&target) {
            Err("fixture write denied".into())
        } else {
            Ok(())
        }
    };
    let result = dispatch(root.path(), apply_request(&reviewed), &deny).unwrap();
    blocked(&result);
    assert!(root.path().join("old/payload").exists());
    assert_ne!(result["results"][0]["remaining"], false);
}

#[test]
fn linked_root_is_never_retired() {
    let root = fixture();
    std::fs::rename(root.path().join("old"), root.path().join("parked")).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(root.path().join("other"), root.path().join("old")).unwrap();
    #[cfg(windows)]
    {
        // Junction creation needs no symlink privilege. Paths are data in the
        // child environment, never interpolated into PowerShell source.
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path $env:RETIRE_TEST_LINK -Target $env:RETIRE_TEST_TARGET | Out-Null"])
            .env("RETIRE_TEST_LINK", root.path().join("old"))
            .env("RETIRE_TEST_TARGET", root.path().join("other"))
            .output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let reviewed = call(&root, review_request());
    assert!(
        !reviewed["items"][0]["blockers"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    blocked(&call(&root, apply_request(&reviewed)));
    assert!(root.path().join("other/retained").exists());
    assert!(root.path().join("parked/payload").exists());
    // Remove only the fixture link itself through the ordinary platform API.
    #[cfg(windows)]
    std::fs::remove_dir(root.path().join("old")).unwrap();
    #[cfg(unix)]
    std::fs::remove_file(root.path().join("old")).unwrap();
}

#[test]
fn owner_cli_allows_inventory_but_refuses_execution_relative_and_external_requests() {
    let root = fixture();
    let request = root.path().join("request.json");
    write_json(&request, &json!({"operation":"inventory"}));
    let invoke = |project: &Path, request: &Path| {
        std::process::Command::new(env!("CARGO_BIN_EXE_maintenance_owner"))
            .arg("--project-root")
            .arg(project)
            .arg("--request")
            .arg(request)
            .output()
            .unwrap()
    };
    assert!(invoke(root.path(), &request).status.success());
    write_json(&request, &json!({"operation":"begin_run"}));
    assert!(!invoke(root.path(), &request).status.success());
    assert!(!invoke(Path::new("relative"), &request).status.success());
    let external = tempfile::NamedTempFile::new().unwrap();
    assert!(!invoke(root.path(), external.path()).status.success());
    write_json(&request, &review_request());
    let reviewed = invoke(root.path(), &request);
    assert!(
        reviewed.status.success(),
        "{}",
        String::from_utf8_lossy(&reviewed.stderr)
    );
    let reviewed: Value = serde_json::from_slice(&reviewed.stdout).unwrap();
    write_json(&request, &apply_request(&reviewed));
    let applied = invoke(root.path(), &request);
    assert!(
        applied.status.success(),
        "{}",
        String::from_utf8_lossy(&applied.stderr)
    );
    let applied: Value = serde_json::from_slice(&applied.stdout).unwrap();
    assert_eq!(applied["results"][0]["status"], "deleted");
    assert!(root.path().join("other/retained").exists());
}

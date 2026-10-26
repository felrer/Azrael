//! Durable regression contracts for explicit decisions, execution receipts and safety.
use azrael_project_maintenance::{AccessMode, dispatch};
use serde_json::{Value, json};
use std::path::Path;
use tempfile::TempDir;

fn allow(_: &Path, _: AccessMode) -> Result<(), String> {
    Ok(())
}
fn fixture() -> TempDir {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("generated")).unwrap();
    std::fs::write(root.path().join("project-maintenance.json"),serde_json::to_vec(&json!({"schema_version":1,"project_id":"fixture","managed_roots":["generated"],"protected_paths":["generated/protected"],"bundles":[]})).unwrap()).unwrap();
    root
}
fn call(root: &TempDir, request: Value) -> Value {
    dispatch(root.path(), request, &allow).unwrap()
}
fn register(root: &TempDir, id: &str, path: &str, extra: Value) {
    let mut item = json!({"id":id,"path":path,"kind":"fixture","generated":true,"owner":"test","protection_known":true,"references":[]});
    for (k, v) in extra.as_object().unwrap() {
        item[k] = v.clone();
    }
    call(root, json!({"operation":"register","item":item}));
}
fn review(root: &TempDir, id: &str) -> Value {
    call(root, json!({"operation":"review","ids":[id]}))["items"][0].clone()
}
fn delete(root: &TempDir, id: &str, token: &Value) -> Value {
    call(root,json!({"operation":"apply","decisions":[{"id":id,"token":token,"decision":"delete","reason":"diagnosis complete"}]}))["results"][0].clone()
}

#[test]
fn lifecycle_explicit_defer_and_delete() {
    let root = fixture();
    std::fs::write(root.path().join("generated/output"), "abc").unwrap();
    register(&root, "output", "generated/output", json!({}));
    let observed = review(&root, "output");
    assert_eq!(observed["logical_bytes"], 3);
    let deferred = call(
        &root,
        json!({"operation":"apply","decisions":[{"id":"output","token":observed["token"],"decision":"defer","reason":"await consumer","revisit_condition":"consumer finishes"}]}),
    );
    assert_eq!(deferred["results"][0]["status"], "deferred");
    assert!(root.path().join("generated/output").exists());
    let observed = review(&root, "output");
    let result = delete(&root, "output", &observed["token"]);
    assert_eq!(result["status"], "deleted");
    assert_eq!(result["remaining"], false);
}
#[test]
fn stale_decision_and_cached_inventory() {
    let root = fixture();
    let path = root.path().join("generated/item");
    std::fs::write(&path, "before").unwrap();
    register(&root, "item", "generated/item", json!({}));
    let observed = review(&root, "item");
    std::fs::write(&path, "after changed").unwrap();
    assert_eq!(
        delete(&root, "item", &observed["token"])["status"],
        "blocked"
    );
    let inventory = call(&root, json!({"operation":"inventory"}));
    assert_eq!(inventory["items"][0]["logical_bytes"], 6);
    assert_eq!(review(&root, "item")["logical_bytes"], 13);
}
#[test]
fn protection_references_backup_original_and_roots() {
    let root = fixture();
    for (id, path, extra) in [
        ("protected", "generated/protected", json!({})),
        (
            "ref",
            "generated/ref",
            json!({"references":["current-install"]}),
        ),
        (
            "unknown",
            "generated/unknown",
            json!({"protection_known":false}),
        ),
        ("backup", "generated/backup", json!({"kind":"backup"})),
        (
            "original",
            "generated/original",
            json!({"source_path":"generated/original"}),
        ),
    ] {
        std::fs::write(root.path().join(path), "keep").unwrap();
        register(&root, id, path, extra);
        let observed = review(&root, id);
        assert!(!observed["blockers"].as_array().unwrap().is_empty());
        assert_eq!(delete(&root, id, &observed["token"])["status"], "blocked");
    }
    register(&root, "root", "generated", json!({}));
    assert!(
        !review(&root, "root")["blockers"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}
#[test]
fn managed_boundary_blockers_distinguish_root_from_outside() {
    let root = fixture();
    std::fs::write(root.path().join("generated/child"), "owned").unwrap();
    std::fs::write(root.path().join("outside"), "owned").unwrap();
    register(&root, "child", "generated/child", json!({}));
    let child = review(&root, "child");
    assert!(child["blockers"].as_array().unwrap().is_empty(), "{child}");
    for (id, path, reason) in [
        (
            "managed-root",
            "generated",
            "managed root itself is protected; select owned descendants",
        ),
        ("outside", "outside", "outside configured managed roots"),
    ] {
        register(&root, id, path, json!({}));
        let observed = review(&root, id);
        assert!(
            observed["blockers"]
                .as_array()
                .unwrap()
                .contains(&json!(reason)),
            "{observed}"
        );
        assert!(
            !observed["blockers"]
                .as_array()
                .unwrap()
                .contains(&json!("not a managed descendant"))
        );
        assert_eq!(delete(&root, id, &observed["token"])["status"], "blocked");
        assert!(root.path().join(path).exists());
    }
}

#[test]
fn rejects_escape_foreign_paths_and_denied_reads() {
    let root = fixture();
    for path in [
        "../outside",
        "generated/../output",
        "C:\\outside",
        "generated/file:stream",
        "\\\\server\\share",
    ] {
        assert!(dispatch(root.path(),json!({"operation":"register","item":{"id":"bad","path":path,"kind":"fixture","owner":"test","generated":true,"protection_known":true,"references":[]}}),&allow).is_err());
    }
    let deny = |_: &Path, _| Err("denied".into());
    assert!(dispatch(root.path(), json!({"operation":"inventory"}), &deny).is_err());
    assert!(
        !root
            .path()
            .join("artifacts/maintenance/maintenance.lock")
            .exists()
    );
}
fn configure_bundles(root: &TempDir, bundles: Value) {
    let config = json!({"schema_version":1,"project_id":"fixture","managed_roots":["generated"],"bundles":bundles});
    std::fs::write(
        root.path().join("project-maintenance.json"),
        serde_json::to_vec(&config).unwrap(),
    )
    .unwrap();
}
fn bundle(id: &str, kind: &str, deps: Value) -> Value {
    json!({"id":id,"kind":kind,"purpose":"one_off","argv":["tool","--check"],"cwd":".","env":{},"depends_on":deps,"inputs":["input"],"guards":["contract"]})
}
#[test]
fn dependencies_exact_semantic_dedup_and_phase_boundaries() {
    let root = fixture();
    std::fs::write(root.path().join("input"), "stable").unwrap();
    configure_bundles(
        &root,
        json!([
            bundle("prepare", "prepare", json!([])),
            bundle("test-a", "test", json!(["prepare"])),
            bundle("test-b", "test", json!(["prepare"])),
            bundle("build", "build", json!(["prepare"]))
        ]),
    );
    let request = json!({"operation":"plan","bundles":["test-a","test-b","build"]});
    let first = call(&root, request.clone());
    let second = call(&root, request);
    assert_eq!(first["plan_id"], second["plan_id"]);
    assert_eq!(first["steps"].as_array().unwrap().len(), 3);
    assert_eq!(first["steps"][0]["kind"], "prepare");
    assert_eq!(first["steps"][1]["bundle_ids"], json!(["test-a", "test-b"]));
    assert_eq!(
        first["steps"][1]["depends_on"][0],
        first["steps"][0]["step_id"]
    );
}
#[test]
fn durable_unknown_failed_and_interrupted_receipts() {
    let root = fixture();
    std::fs::write(root.path().join("input"), "stable").unwrap();
    std::fs::write(root.path().join("generated/item"), "keep").unwrap();
    register(&root, "item", "generated/item", json!({}));
    let mut check = bundle("check", "test", json!([]));
    check["inputs"] = json!(["generated/item"]);
    configure_bundles(&root, json!([check]));
    let run = call(&root, json!({"operation":"begin_run","owner":"session-1"}));
    let status = call(
        &root,
        json!({"operation":"run_status","run_id":run["run_id"]}),
    );
    assert_eq!(status["status"], "unknown");
    assert!(status["steps"][0]["exit_code"].is_null());
    assert!(
        !review(&root, "item")["blockers"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let failed = call(
        &root,
        json!({"operation":"finish_step","run_id":run["run_id"],"step_id":run["steps"][0]["step_id"],"status":"failed","exit_code":7,"execution_output":{"output":"first causal failure","output_omitted_bytes":50},"evidence_scope":"bounded_tool_output"}),
    );
    assert_eq!(failed["status"], "failed");
    assert_eq!(failed["steps"][0]["exit_code"], 7);
    assert_eq!(
        failed["steps"][0]["execution_output"]["output"],
        "first causal failure"
    );
    assert_eq!(
        failed["steps"][0]["execution_output"]["output_omitted_bytes"],
        50
    );
    assert!(failed["steps"][0].get("session_id").is_none());
    assert!(dispatch(root.path(),json!({"operation":"finish_step","run_id":run["run_id"],"step_id":run["steps"][0]["step_id"],"status":"passed","exit_code":null}),&allow).is_err());
}
#[test]
fn denies_nested_write_before_any_mutation() {
    let root = fixture();
    std::fs::create_dir(root.path().join("generated/tree")).unwrap();
    let child = root.path().join("generated/tree/child");
    std::fs::write(&child, "keep").unwrap();
    register(&root, "tree", "generated/tree", json!({}));
    let observed = review(&root, "tree");
    let authorize = |p: &Path, mode| {
        if p == child && mode == AccessMode::Write {
            Err("child write denied".into())
        } else {
            Ok(())
        }
    };
    let result=dispatch(root.path(),json!({"operation":"apply","decisions":[{"id":"tree","token":observed["token"],"decision":"delete","reason":"done"}]}),&authorize).unwrap();
    assert_eq!(result["results"][0]["status"], "blocked");
    assert_eq!(std::fs::read(child).unwrap(), b"keep");
}
#[test]
fn abandoned_lock_is_never_removed() {
    let root = fixture();
    std::fs::create_dir_all(root.path().join("artifacts/maintenance")).unwrap();
    let path = root.path().join("artifacts/maintenance/maintenance.lock");
    std::fs::write(&path, "other-owner").unwrap();
    assert!(
        dispatch(
            root.path(),
            json!({"operation":"register","item":{}}),
            &allow
        )
        .is_err()
    );
    assert!(dispatch(root.path(), json!({"operation":"inventory"}), &allow).is_ok());
    assert_eq!(std::fs::read_to_string(path).unwrap(), "other-owner");
}

#[cfg(unix)]
#[test]
fn symlink_target_and_ancestor_are_rejected() {
    use std::os::unix::fs::symlink;
    let root = fixture();
    symlink(root.path().join("generated"), root.path().join("link")).unwrap();
    assert!(dispatch(root.path(),json!({"operation":"register","item":{"id":"link","path":"link","kind":"fixture","owner":"test","generated":true,"protection_known":true,"references":[]}}),&allow).is_err());
}

#[test]
fn read_operations_never_require_writes_or_create_state() {
    let root = fixture();
    std::fs::write(root.path().join("input"), "stable").unwrap();
    configure_bundles(&root, json!([bundle("check", "test", json!([]))]));
    let read_only = |_: &Path, mode| {
        if mode == AccessMode::Write {
            Err("writes denied".into())
        } else {
            Ok(())
        }
    };
    for request in [
        json!({"operation":"inventory"}),
        json!({"operation":"plan","kind":"test"}),
        json!({"operation":"run_status"}),
        json!({"operation":"review","ids":[]}),
    ] {
        assert!(dispatch(root.path(), request, &read_only).is_ok());
    }
    assert!(!root.path().join("artifacts").exists());
}
#[test]
fn kind_boundary_empty_selection_and_conflicting_results() {
    let root = fixture();
    std::fs::write(root.path().join("input"), "stable").unwrap();
    configure_bundles(
        &root,
        json!([
            bundle("build", "build", json!([])),
            bundle("test", "test", json!(["build"]))
        ]),
    );
    for request in [
        json!({"operation":"plan","kind":"test"}),
        json!({"operation":"plan","kind":"unknown"}),
        json!({"operation":"plan","bundles":[]}),
        json!({"operation":"begin_run","kind":"test","bundles":["build"]}),
    ] {
        assert!(dispatch(root.path(), request, &allow).is_err());
    }
    let run = call(
        &root,
        json!({"operation":"begin_run","kind":"build","bundles":["build"]}),
    );
    assert!(dispatch(root.path(),json!({"operation":"finish_step","run_id":run["run_id"],"step_id":run["steps"][0]["step_id"],"status":"unknown","exit_code":0}),&allow).is_err());
    let receipt = json!({"operation":"finish_step","run_id":run["run_id"],"step_id":run["steps"][0]["step_id"],"status":"not_run","exit_code":null});
    assert_eq!(call(&root, receipt.clone())["status"], "not_run");
    assert_eq!(call(&root, receipt)["status"], "not_run");
    assert!(dispatch(root.path(),json!({"operation":"finish_step","run_id":run["run_id"],"step_id":run["steps"][0]["step_id"],"status":"passed","exit_code":0}),&allow).is_err());
}
#[test]
fn timestamps_and_policy_only_produce_review_candidates() {
    let root = fixture();
    std::fs::write(root.path().join("generated/old"), "keep").unwrap();
    register(
        &root,
        "old",
        "generated/old",
        json!({"created_at_ms":1,"revisit_after_ms":1,"revisit_condition":"inspect"}),
    );
    let first = review(&root, "old");
    let second = review(&root, "old");
    assert_eq!(first["token"], second["token"]);
    let inventory = call(&root, json!({"operation":"inventory"}));
    assert_eq!(inventory["items"][0]["due_for_review"], true);
    assert!(inventory["items"][0]["registered_at_ms"].as_u64().unwrap() > 1);
    assert!(inventory["items"][0]["version"].is_null());
    assert!(root.path().join("generated/old").exists());
}

#[test]
fn unresolved_producer_excludes_duplicate_plans_and_shared_resources() {
    let root = fixture();
    std::fs::write(root.path().join("input"), "stable").unwrap();
    let mut first = bundle("first", "test", json!([]));
    first["resource"] = json!("compiler-cache");
    let mut other = first.clone();
    other["id"] = json!("other");
    other["argv"] = json!(["other-tool"]);
    configure_bundles(&root, json!([first, other]));
    let request = json!({"operation":"begin_run","bundles":["first"]});
    let run = call(&root, request.clone());
    assert!(dispatch(root.path(), request.clone(), &allow).is_err());
    assert!(
        dispatch(
            root.path(),
            json!({"operation":"begin_run","bundles":["other"]}),
            &allow
        )
        .is_err()
    );
    call(
        &root,
        json!({"operation":"finish_step","run_id":run["run_id"],"step_id":run["steps"][0]["step_id"],"status":"failed","exit_code":5}),
    );
    assert!(dispatch(root.path(), request, &allow).is_ok());
}

#[test]
fn backup_requires_fresh_registered_retained_recovery_copy() {
    let root = fixture();
    std::fs::write(root.path().join("generated/old"), "old").unwrap();
    std::fs::write(root.path().join("generated/recovery"), "replacement").unwrap();
    register(
        &root,
        "old",
        "generated/old",
        json!({"kind":"backup","provenance":{"superseded_by":"recovery","recovery_verified":true}}),
    );
    assert!(
        !review(&root, "old")["blockers"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    register(
        &root,
        "recovery",
        "generated/recovery",
        json!({"kind":"backup","retain_reason":"verified recovery copy"}),
    );
    let before = review(&root, "old");
    assert!(before["blockers"].as_array().unwrap().is_empty());
    std::fs::write(
        root.path().join("generated/recovery"),
        "changed replacement",
    )
    .unwrap();
    assert_eq!(delete(&root, "old", &before["token"])["status"], "blocked");
    assert!(root.path().join("generated/old").exists());
    register(
        &root,
        "recovery",
        "generated/recovery",
        json!({"kind":"backup","retain_reason":"verified recovery copy"}),
    );
    let current = review(&root, "old");
    assert_eq!(delete(&root, "old", &current["token"])["status"], "deleted");
    assert!(root.path().join("generated/recovery").exists());
}

#[test]
fn registered_descendants_and_ancestors_preserve_protection() {
    for extra in [
        json!({"references":["consumer"]}),
        json!({"retain_reason":"diagnosis"}),
        json!({"protection_known":false}),
        json!({"generated":false}),
        json!({"kind":"backup"}),
    ] {
        let root = fixture();
        std::fs::create_dir(root.path().join("generated/tree")).unwrap();
        std::fs::write(root.path().join("generated/tree/child"), "keep").unwrap();
        register(&root, "parent", "generated/tree", json!({}));
        register(&root, "child", "generated/tree/child", extra);
        let observed = review(&root, "parent");
        assert!(!observed["blockers"].as_array().unwrap().is_empty());
        assert_eq!(
            delete(&root, "parent", &observed["token"])["status"],
            "blocked"
        );
        assert!(root.path().join("generated/tree/child").exists());
    }
    let root = fixture();
    std::fs::create_dir(root.path().join("generated/tree")).unwrap();
    std::fs::write(root.path().join("generated/tree/child"), "keep").unwrap();
    register(
        &root,
        "parent",
        "generated/tree",
        json!({"references":["active-consumer"]}),
    );
    register(&root, "child", "generated/tree/child", json!({}));
    let observed = review(&root, "child");
    assert_eq!(
        delete(&root, "child", &observed["token"])["status"],
        "blocked"
    );
}

#[test]
fn registered_original_source_and_child_run_protect_parent() {
    let root = fixture();
    std::fs::create_dir(root.path().join("generated/tree")).unwrap();
    std::fs::write(root.path().join("generated/tree/original"), "original").unwrap();
    std::fs::write(root.path().join("generated/copy"), "copy").unwrap();
    register(&root, "parent", "generated/tree", json!({}));
    register(
        &root,
        "copy",
        "generated/copy",
        json!({"source_path":"generated/tree/original"}),
    );
    assert!(
        !review(&root, "parent")["blockers"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let root = fixture();
    std::fs::create_dir(root.path().join("generated/tree")).unwrap();
    std::fs::write(root.path().join("generated/tree/child"), "input").unwrap();
    register(&root, "parent", "generated/tree", json!({}));
    let mut check = bundle("check", "test", json!([]));
    check["inputs"] = json!(["generated/tree/child"]);
    configure_bundles(&root, json!([check]));
    let run = call(&root, json!({"operation":"begin_run"}));
    register(
        &root,
        "child",
        "generated/tree/child",
        json!({"run_id":run["run_id"]}),
    );
    let observed = review(&root, "parent");
    assert_eq!(
        delete(&root, "parent", &observed["token"])["status"],
        "blocked"
    );
}

#[test]
fn completed_recovery_requires_explicit_verified_reason_and_evidence() {
    let root = fixture();
    std::fs::write(root.path().join("generated/final-backup"), "old").unwrap();
    for completion in [
        json!(true),
        json!({"verified":true}),
        json!({"verified":true,"reason":"recovery complete"}),
    ] {
        register(
            &root,
            "backup",
            "generated/final-backup",
            json!({"kind":"backup","provenance":{"recovery_completed":completion}}),
        );
        assert!(
            !review(&root, "backup")["blockers"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }
    register(
        &root,
        "backup",
        "generated/final-backup",
        json!({"kind":"backup","provenance":{"recovery_completed":{"verified":true,"reason":"recovery and consumers finished","evidence_ref":"receipt:recovery-accepted"}}}),
    );
    let observed = review(&root, "backup");
    assert!(observed["blockers"].as_array().unwrap().is_empty());
    assert_eq!(
        delete(&root, "backup", &observed["token"])["status"],
        "deleted"
    );
}

#[test]
fn execution_revalidates_inputs_and_preserves_observed_exit_independently() {
    let root = fixture();
    let input = root.path().join("input");
    std::fs::write(&input, "before").unwrap();
    configure_bundles(&root, json!([bundle("check", "test", json!([]))]));
    let run = call(&root, json!({"operation":"begin_run"}));
    let validation = |phase: &str| json!({"operation":"validate_step","run_id":run["run_id"],"step_id":run["steps"][0]["step_id"],"phase":phase});
    assert_eq!(call(&root, validation("before"))["valid"], true);
    std::fs::write(&input, "after").unwrap();
    let invalid = call(&root, validation("after"));
    assert_eq!(invalid["valid"], false);
    assert!(dispatch(root.path(),json!({"operation":"finish_step","run_id":run["run_id"],"step_id":run["steps"][0]["step_id"],"status":"passed","exit_code":0}),&allow).is_err());
    let receipt = call(
        &root,
        json!({"operation":"finish_step","run_id":run["run_id"],"step_id":run["steps"][0]["step_id"],"status":"unknown","exit_code":null,"execution_output":{"exit_code":0,"output":"command exited normally"},"evidence_scope":"bounded_tool_output"}),
    );
    assert_eq!(receipt["status"], "unknown");
    assert!(receipt["steps"][0]["exit_code"].is_null());
    assert_eq!(receipt["steps"][0]["execution_output"]["exit_code"], 0);
    assert_eq!(receipt["steps"][0]["integrity_status"], "invalid");
}

#[test]
fn malformed_or_missing_config_invalidates_without_losing_receipts() {
    for malformed in [true, false] {
        let root = fixture();
        std::fs::write(root.path().join("input"), "stable").unwrap();
        configure_bundles(&root, json!([bundle("check", "test", json!([]))]));
        let run = call(&root, json!({"operation":"begin_run"}));
        if malformed {
            std::fs::write(root.path().join("project-maintenance.json"), "{").unwrap();
        } else {
            std::fs::remove_file(root.path().join("project-maintenance.json")).unwrap();
        }
        let invalid = call(
            &root,
            json!({"operation":"validate_step","run_id":run["run_id"],"step_id":run["steps"][0]["step_id"],"phase":"after"}),
        );
        assert_eq!(invalid["valid"], false);
        let receipt = call(
            &root,
            json!({"operation":"finish_step","run_id":run["run_id"],"step_id":run["steps"][0]["step_id"],"status":"unknown","exit_code":null,"execution_output":{"exit_code":9}}),
        );
        assert_eq!(receipt["steps"][0]["execution_output"]["exit_code"], 9);
    }
}

#[test]
fn independent_reviewed_items_apply_in_one_batch() {
    let root = fixture();
    let mut decisions = Vec::new();
    for id in ["a", "b"] {
        let path = format!("generated/{id}");
        std::fs::write(root.path().join(&path), id).unwrap();
        register(&root, id, &path, json!({}));
    }
    for id in ["a", "b"] {
        let observed = review(&root, id);
        decisions.push(json!({"id":id,"token":observed["token"],"decision":"delete","reason":"review complete"}));
    }
    let result = call(&root, json!({"operation":"apply","decisions":decisions}));
    assert_eq!(result["results"][0]["status"], "deleted");
    assert_eq!(result["results"][1]["status"], "deleted");
}

#[test]
fn malformed_batch_prevalidation_prevents_all_target_mutations() {
    let root = fixture();
    std::fs::write(root.path().join("generated/known"), "keep").unwrap();
    register(&root, "known", "generated/known", json!({}));
    let observed = review(&root, "known");
    let known = json!({"id":"known","token":observed["token"],"decision":"delete","reason":"done"});
    let mut unknown = known.clone();
    unknown["id"] = json!("unknown");
    for choices in [json!([known, unknown]), json!([known, known])] {
        assert!(
            dispatch(
                root.path(),
                json!({"operation":"apply","decisions":choices}),
                &allow
            )
            .is_err()
        );
        assert_eq!(
            std::fs::read(root.path().join("generated/known")).unwrap(),
            b"keep"
        );
    }
    let inventory = call(&root, json!({"operation":"inventory"}));
    assert_eq!(inventory["pagination"]["decisions_total"], 0);
}

#[test]
fn registration_reference_contract_matches_explicit_decisions() {
    let root = fixture();
    std::fs::write(root.path().join("generated/item"), "retained").unwrap();
    for references in [
        json!([""]),
        json!([" \t\n"]),
        json!([{"id":"consumer"}]),
        json!([7]),
        json!(["valid", null]),
    ] {
        let item = json!({"id":"invalid","path":"generated/item","kind":"fixture","generated":true,"owner":"test","protection_known":true,"references":references});
        assert!(
            dispatch(
                root.path(),
                json!({"operation":"register","item":item}),
                &allow
            )
            .is_err()
        );
    }
    let inventory = call(&root, json!({"operation":"inventory"}));
    assert_eq!(inventory["pagination"]["total"], 0);
    register(
        &root,
        "retained",
        "generated/item",
        json!({"references":["consumer:awaiting-results"]}),
    );
    let observed = review(&root, "retained");
    assert!(!observed["blockers"].as_array().unwrap().is_empty());
    let result = call(
        &root,
        json!({"operation":"apply","decisions":[{"id":"retained","token":observed["token"],"decision":"defer","reason":"consumer still needs artifact","revisit_condition":"consumer completes"}]}),
    );
    assert_eq!(result["results"][0]["status"], "deferred");
    assert!(root.path().join("generated/item").exists());
}

#[test]
fn unchanged_final_observation_keeps_durable_group_receipt_without_another_write() {
    use std::cell::Cell;
    let root = fixture();
    let path = root.path().join("generated/a");
    let manifest = root.path().join("artifacts/maintenance/manifest.json");
    std::fs::write(&path, "owned").unwrap();
    call(
        &root,
        json!({"operation":"register","group":{"id":"version","kind":"version","owner":"test","version":"old","membership_complete":true,"provenance_ref":"receipt:test","members":[{"id":"a","path":"generated/a","kind":"fixture","owner":"test","generated":true,"protection_known":true,"references":[],"lifecycle_role":"artifact"}]}}),
    );
    let observed = review(&root, "a");
    let final_observed = Cell::new(false);
    let authorize = |target: &Path, mode| {
        if target == path && mode == AccessMode::Read {
            let durable: Value =
                serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
            if durable["decisions"][0]["status"] == "deleted" {
                assert_eq!(durable["decisions"][0]["remaining"], false);
                assert_eq!(durable["groups"]["version"]["cleanup_status"], "deleted");
                final_observed.set(true);
            }
        }
        if final_observed.get() && target == manifest && mode == AccessMode::Write {
            return Err("redundant persistence denied after final observation".into());
        }
        Ok(())
    };
    let result = dispatch(
        root.path(),
        json!({"operation":"apply","decisions":[{"id":"a","token":observed["token"],"decision":"delete","reason":"complete"}]}),
        &authorize,
    )
    .unwrap();
    assert!(final_observed.get());
    assert_eq!(result["aborted"], false);
    assert_eq!(result["groups"][0]["status"], "deleted");
    assert!(!path.exists());
    let bytes = std::fs::read(&manifest).unwrap();
    assert!(!bytes.contains(&b'\n'), "manifest should use compact JSON");
    let durable: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(durable["decisions"][0], result["results"][0]);
    assert_eq!(durable["items"]["a"]["cleanup_status"], "deleted");
    assert_eq!(durable["items"]["a"]["remaining"], false);
    assert_eq!(durable["groups"]["version"]["cleanup_status"], "deleted");
    assert_eq!(
        call(&root, json!({"operation":"inventory"}))["items"][0]["remaining"],
        false
    );
}

#[test]
fn changed_or_denied_final_observation_is_persisted_after_destructive_receipt() {
    use std::cell::Cell;
    for deny_observation in [false, true] {
        let root = fixture();
        let path = root.path().join("generated/a");
        let manifest = root.path().join("artifacts/maintenance/manifest.json");
        std::fs::write(&path, "owned").unwrap();
        register(&root, "a", "generated/a", json!({}));
        let observed = review(&root, "a");
        let final_observed = Cell::new(false);
        let authorize = |target: &Path, mode| {
            if target == path && mode == AccessMode::Read && !final_observed.get() {
                let durable: Value =
                    serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
                if durable["decisions"][0]["status"] == "deleted" {
                    assert_eq!(durable["decisions"][0]["remaining"], false);
                    final_observed.set(true);
                    if deny_observation {
                        return Err("final observation denied".into());
                    }
                    std::fs::write(&path, "reappeared after durable deletion receipt").unwrap();
                }
            }
            Ok(())
        };
        let result = dispatch(
            root.path(),
            json!({"operation":"apply","decisions":[{"id":"a","token":observed["token"],"decision":"delete","reason":"complete"}]}),
            &authorize,
        )
        .unwrap();
        assert!(final_observed.get());
        assert_eq!(result["aborted"], false);
        let durable: Value = serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
        assert_eq!(durable["decisions"][0], result["results"][0]);
        assert_eq!(durable["decisions"][0]["deletion"]["remaining"], false);
        assert_eq!(durable["decisions"][0]["status"], "deleted");
        if deny_observation {
            assert!(durable["decisions"][0]["remaining"].is_null());
            assert_eq!(
                durable["decisions"][0]["observation_error"],
                "final observation denied"
            );
            assert!(durable["items"]["a"]["remaining"].is_null());
            assert!(!path.exists());
        } else {
            assert_eq!(durable["decisions"][0]["remaining"], true);
            assert_eq!(durable["items"]["a"]["remaining"], true);
            assert_eq!(
                std::fs::read(&path).unwrap(),
                b"reappeared after durable deletion receipt"
            );
        }
    }
}

#[test]
fn intent_save_failure_preserves_target_manifest_and_pending_file() {
    let root = fixture();
    let path = root.path().join("generated/a");
    let manifest = root.path().join("artifacts/maintenance/manifest.json");
    let pending = root.path().join("artifacts/maintenance/manifest.pending");
    std::fs::write(&path, "owned").unwrap();
    register(&root, "a", "generated/a", json!({}));
    let observed = review(&root, "a");
    let before = std::fs::read(&manifest).unwrap();
    std::fs::write(&pending, "unresolved prior write").unwrap();
    let result = call(
        &root,
        json!({"operation":"apply","decisions":[{"id":"a","token":observed["token"],"decision":"delete","reason":"complete"}]}),
    );
    assert_eq!(result["aborted"], true);
    assert_eq!(result["results"][0]["status"], "pending");
    assert!(
        result["results"][0]["persistence_error"]
            .as_str()
            .unwrap()
            .contains("state pending file requires recovery")
    );
    assert_eq!(std::fs::read(&path).unwrap(), b"owned");
    assert_eq!(std::fs::read(&manifest).unwrap(), before);
    assert_eq!(std::fs::read(&pending).unwrap(), b"unresolved prior write");
    let durable: Value = serde_json::from_slice(&before).unwrap();
    assert_eq!(durable["decisions"], json!([]));
}

#[test]
fn destructive_receipt_survives_later_observation_and_save_denial() {
    use std::cell::Cell;
    let root = fixture();
    let first = root.path().join("generated/a");
    let second = root.path().join("generated/b");
    for (id, path) in [("a", "generated/a"), ("b", "generated/b")] {
        std::fs::write(root.path().join(path), "owned").unwrap();
        register(&root, id, path, json!({}));
    }
    let mut decisions = Vec::new();
    for id in ["a", "b"] {
        let observed = review(&root, id);
        decisions.push(
            json!({"id":id,"token":observed["token"],"decision":"delete","reason":"complete"}),
        );
    }
    let later_denied = Cell::new(false);
    let authorize = |path: &Path, mode| {
        if path == second && !first.exists() {
            later_denied.set(true);
            return Err("later target observation denied".into());
        }
        if later_denied.get()
            && mode == AccessMode::Write
            && path.file_name().is_some_and(|name| name == "manifest.json")
        {
            return Err("later persistence denied".into());
        }
        Ok(())
    };
    let result = dispatch(
        root.path(),
        json!({"operation":"apply","decisions":decisions}),
        &authorize,
    )
    .unwrap();
    assert_eq!(result["results"][0]["status"], "deleted");
    assert_eq!(result["aborted"], true);
    assert!(!first.exists());
    assert!(second.exists());
    let durable: Value = serde_json::from_slice(
        &std::fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(durable["decisions"][0]["id"], "a");
    assert_eq!(durable["decisions"][0]["status"], "deleted");
    assert_eq!(durable["decisions"][0]["remaining"], false);
}

#[test]
fn pending_intent_survives_result_persistence_failure() {
    let root = fixture();
    let path = root.path().join("generated/a");
    std::fs::write(&path, "owned").unwrap();
    register(&root, "a", "generated/a", json!({}));
    let observed = review(&root, "a");
    let authorize = |target: &Path, mode| {
        if !path.exists()
            && mode == AccessMode::Write
            && target
                .file_name()
                .is_some_and(|name| name == "manifest.json")
        {
            Err("result persistence revoked".into())
        } else {
            Ok(())
        }
    };
    let result=dispatch(root.path(),json!({"operation":"apply","decisions":[{"id":"a","token":observed["token"],"decision":"delete","reason":"complete"}]}),&authorize).unwrap();
    assert_eq!(result["results"][0]["status"], "deleted");
    assert_eq!(result["aborted"], true);
    let durable: Value = serde_json::from_slice(
        &std::fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(durable["decisions"][0]["status"], "pending");
    assert!(durable["decisions"][0]["attempt_id"].is_string());
    assert!(!path.exists());
}

#[test]
fn completed_unknown_producer_allows_retry_without_fabricating_success() {
    let root = fixture();
    std::fs::write(root.path().join("input"), "stable").unwrap();
    configure_bundles(&root, json!([bundle("check", "test", json!([]))]));
    let request = json!({"operation":"begin_run"});
    let run = call(&root, request.clone());
    assert!(dispatch(root.path(), request.clone(), &allow).is_err());
    call(
        &root,
        json!({"operation":"finish_step","run_id":run["run_id"],"step_id":run["steps"][0]["step_id"],"status":"unknown","exit_code":null,"producer_completed":false}),
    );
    assert!(dispatch(root.path(), request.clone(), &allow).is_err());
    let completed = call(
        &root,
        json!({"operation":"finish_step","run_id":run["run_id"],"step_id":run["steps"][0]["step_id"],"status":"unknown","exit_code":null,"producer_completed":true}),
    );
    assert_eq!(completed["status"], "unknown");
    assert!(completed["steps"][0]["exit_code"].is_null());
    assert!(dispatch(root.path(),json!({"operation":"finish_step","run_id":run["run_id"],"step_id":run["steps"][0]["step_id"],"status":"unknown","exit_code":null,"producer_completed":false}),&allow).is_err());
    assert!(dispatch(root.path(), request, &allow).is_ok());
}

#[test]
fn inventory_and_run_status_paginate_bounded_snapshots() {
    let root = fixture();
    for index in 0..55 {
        let id = format!("item-{index:02}");
        let path = format!("generated/{id}");
        std::fs::write(root.path().join(&path), "x").unwrap();
        register(&root, &id, &path, json!({}));
    }
    let inventory = call(&root, json!({"operation":"inventory"}));
    assert_eq!(inventory["items"].as_array().unwrap().len(), 50);
    assert_eq!(inventory["pagination"]["total"], 55);
    assert_eq!(
        inventory["project_root"],
        json!(dunce::canonicalize(root.path()).unwrap())
    );
    let tail = call(
        &root,
        json!({"operation":"inventory","offset":50,"limit":10}),
    );
    assert_eq!(tail["items"].as_array().unwrap().len(), 5);
    assert_eq!(tail["pagination"]["offset"], 50);
    assert!(
        dispatch(
            root.path(),
            json!({"operation":"inventory","limit":201}),
            &allow
        )
        .is_err()
    );
    std::fs::write(root.path().join("input"), "stable").unwrap();
    let mut bundles = Vec::new();
    for index in 0..3 {
        let mut item = bundle(&format!("check-{index}"), "test", json!([]));
        item["argv"] = json!([format!("command-{index}")]);
        bundles.push(item);
    }
    configure_bundles(&root, json!(bundles));
    let run = call(&root, json!({"operation":"begin_run"}));
    let status = call(
        &root,
        json!({"operation":"run_status","run_id":run["run_id"],"offset":1,"limit":1}),
    );
    assert_eq!(status["steps"].as_array().unwrap().len(), 1);
    assert_eq!(status["pagination"]["total"], 3);
    assert_eq!(status["steps"][0]["step_id"], run["steps"][1]["step_id"]);
}

#[test]
fn unfinished_producer_and_actual_exit_facts_cannot_conflict() {
    let root = fixture();
    std::fs::write(root.path().join("input"), "stable").unwrap();
    configure_bundles(&root, json!([bundle("check", "test", json!([]))]));
    let run = call(&root, json!({"operation":"begin_run"}));
    for (status, exit, output, completed) in [
        ("passed", json!(0), json!({"exit_code":0}), false),
        ("failed", json!(7), json!({"exit_code":7}), false),
        ("failed", Value::Null, json!({}), true),
        ("unknown", Value::Null, json!({"exit_code":0}), false),
        ("passed", json!(0), json!({"exit_code":7}), true),
    ] {
        assert!(dispatch(root.path(),json!({"operation":"finish_step","run_id":run["run_id"],"step_id":run["steps"][0]["step_id"],"status":status,"exit_code":exit,"execution_output":output,"producer_completed":completed}),&allow).is_err());
    }
    // Defend conservatively even when loading a contradictory legacy record.
    let manifest = root.path().join("artifacts/maintenance/manifest.json");
    let mut state: Value = serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
    let id = run["run_id"].as_str().unwrap();
    state["runs"][id]["steps"][0]["status"] = json!("failed");
    state["runs"][id]["steps"][0]["exit_code"] = json!(7);
    state["runs"][id]["steps"][0]["producer_completed"] = json!(false);
    state["runs"][id]["status"] = json!("failed");
    std::fs::write(manifest, serde_json::to_vec(&state).unwrap()).unwrap();
    assert!(dispatch(root.path(), json!({"operation":"begin_run"}), &allow).is_err());
}

#[test]
fn explicit_verified_producer_recovery_preserves_unknown_outcome() {
    let root = fixture();
    std::fs::write(root.path().join("input"), "stable").unwrap();
    configure_bundles(&root, json!([bundle("check", "test", json!([]))]));
    let run = call(&root, json!({"operation":"begin_run"}));
    let recover = json!({"operation":"recover_run","run_id":run["run_id"],"producer_stopped_verified":true,"reason":"independently verified exact owned process tree stopped","evidence_ref":"receipt:producer-tree-stop"});
    for invalid in [
        json!({"operation":"recover_run","run_id":run["run_id"]}),
        json!({"operation":"recover_run","run_id":run["run_id"],"producer_stopped_verified":false,"reason":"stopped","evidence_ref":"receipt:stop"}),
        json!({"operation":"recover_run","run_id":run["run_id"],"producer_stopped_verified":true,"reason":" ","evidence_ref":"receipt:stop"}),
        json!({"operation":"recover_run","run_id":run["run_id"],"producer_stopped_verified":true,"reason":"stopped","evidence_ref":"receipt:stop","status":"passed"}),
    ] {
        assert!(dispatch(root.path(), invalid, &allow).is_err());
    }
    assert!(dispatch(root.path(), json!({"operation":"begin_run"}), &allow).is_err());
    let recovered = call(&root, recover.clone());
    assert_eq!(recovered["status"], "unknown");
    assert_eq!(recovered["steps"][0]["status"], "unknown");
    assert!(recovered["steps"][0]["exit_code"].is_null());
    assert_eq!(recovered["steps"][0]["producer_completed"], true);
    assert_eq!(
        recovered["producer_recovery"]["evidence_ref"],
        "receipt:producer-tree-stop"
    );
    assert!(dispatch(root.path(), recover, &allow).is_err());
    assert!(dispatch(root.path(), json!({"operation":"begin_run"}), &allow).is_ok());
}

#[test]
fn blank_legacy_recovery_reference_cannot_confirm_retention() {
    let root = fixture();
    for path in ["generated/old", "generated/recovery"] {
        std::fs::write(root.path().join(path), "backup").unwrap();
    }
    register(
        &root,
        "old",
        "generated/old",
        json!({"kind":"backup","provenance":{"superseded_by":"recovery","recovery_verified":true}}),
    );
    register(
        &root,
        "recovery",
        "generated/recovery",
        json!({"references":["recovery-consumer"]}),
    );
    assert!(
        review(&root, "old")["blockers"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let manifest = root.path().join("artifacts/maintenance/manifest.json");
    let mut state: Value = serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
    state["items"]["recovery"]["references"] = json!([" \t"]);
    std::fs::write(manifest, serde_json::to_vec(&state).unwrap()).unwrap();
    assert!(
        !review(&root, "old")["blockers"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[cfg(windows)]
#[test]
fn native_delete_failure_is_failed_and_audited() {
    use std::os::windows::fs::OpenOptionsExt;
    let root = fixture();
    let path = root.path().join("generated/locked");
    std::fs::write(&path, "owned").unwrap();
    register(&root, "locked", "generated/locked", json!({}));
    let _reader = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(3)
        .open(&path)
        .unwrap();
    let observed = review(&root, "locked");
    let result = delete(&root, "locked", &observed["token"]);
    assert_eq!(result["status"], "failed");
    assert_eq!(result["remaining"], true);
    assert!(result["deletion"]["error"].is_string());
    let inventory = call(&root, json!({"operation":"inventory"}));
    assert_eq!(inventory["decisions"][0]["status"], "failed");
}

#[cfg(windows)]
#[test]
fn extended_literal_nested_paths_delete_and_audit_only_attribute_changes() {
    use std::os::windows::fs::MetadataExt;
    let root = fixture();
    let target = root.path().join("generated").join("long-tree");
    let mut nested = target.clone();
    while nested.to_string_lossy().len() < 330 {
        nested.push("nested-component-0123456789");
    }
    std::fs::create_dir_all(&nested).unwrap();
    let marked = nested.join("readonly-hidden.txt");
    let unchanged = nested.join("unchanged.txt");
    std::fs::write(&marked, "owned generated output").unwrap();
    std::fs::write(&unchanged, "unchanged attributes").unwrap();
    assert!(marked.to_string_lossy().len() > 300);
    let extended = format!(r"\\?\{}", marked.display());
    let command = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", "$i=Get-Item -LiteralPath $env:MAINTENANCE_FIXTURE_PATH; $i.Attributes=$i.Attributes -bor 3"])
        .env("MAINTENANCE_FIXTURE_PATH", extended)
        .status()
        .unwrap();
    assert!(command.success());
    assert_eq!(std::fs::metadata(&marked).unwrap().file_attributes() & 3, 3);
    register(&root, "long", "generated/long-tree", json!({}));
    let observed = review(&root, "long");
    let result = delete(&root, "long", &observed["token"]);
    assert_eq!(result["status"], "deleted", "{result}");
    assert_eq!(result["deletion"]["remaining"], false);
    assert!(!target.exists());
    assert!(!marked.exists());
    let changes = result["deletion"]["attributes"].as_array().unwrap();
    assert_eq!(changes.len(), 1, "unchanged entries must not inflate audit");
    assert_eq!(changes[0]["path"], json!(marked));
    assert_eq!(changes[0]["before"].as_u64().unwrap() & 3, 3);
    assert_eq!(changes[0]["after"].as_u64().unwrap() & 3, 0);
}

#[cfg(windows)]
#[test]
fn confirmed_generated_readonly_hidden_deleted_and_audited() {
    use std::os::windows::fs::MetadataExt;
    let root = fixture();
    let path = root.path().join("generated/attributes");
    std::fs::write(&path, "generated").unwrap();
    let command=std::process::Command::new("powershell.exe").args(["-NoProfile","-NonInteractive","-Command","$p=$env:MAINTENANCE_FIXTURE_PATH; $i=Get-Item -LiteralPath $p; $i.Attributes=$i.Attributes -bor 3"]).env("MAINTENANCE_FIXTURE_PATH",&path).status().unwrap();
    assert!(command.success());
    assert_eq!(std::fs::metadata(&path).unwrap().file_attributes() & 3, 3);
    register(&root, "attrs", "generated/attributes", json!({}));
    let observed = review(&root, "attrs");
    let result = delete(&root, "attrs", &observed["token"]);
    assert_eq!(result["status"], "deleted", "{result}");
    assert_eq!(
        result["deletion"]["attributes"][0]["before"]
            .as_u64()
            .unwrap()
            & 3,
        3
    );
    assert_eq!(
        result["deletion"]["attributes"][0]["after"]
            .as_u64()
            .unwrap()
            & 3,
        0
    );
    assert!(!path.exists());
}

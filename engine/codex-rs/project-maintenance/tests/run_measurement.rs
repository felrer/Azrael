//! Keep the release/commit boundary explicit when future run code is simplified.
use azrael_project_maintenance::{AccessMode, dispatch};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use tempfile::TempDir;

fn allow(_: &Path, _: AccessMode) -> Result<(), String> {
    Ok(())
}

fn fixture() -> TempDir {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("generated")).unwrap();
    std::fs::write(root.path().join("generated/input"), "stable").unwrap();
    std::fs::write(
        root.path().join("project-maintenance.json"),
        serde_json::to_vec(&json!({
            "schema_version":1,"project_id":"run-measurement","managed_roots":["generated"],
            "bundles":[{"id":"check","kind":"test","purpose":"retained","argv":["unused"],"inputs":["generated/input"]}]
        })).unwrap(),
    ).unwrap();
    root
}

fn call(root: &TempDir, request: Value) -> Value {
    dispatch(root.path(), request, &allow).unwrap()
}

fn validation(run: &Value) -> Value {
    json!({"operation":"validate_step","run_id":run["run_id"],"step_id":run["steps"][0]["step_id"],"phase":"after"})
}

fn unrelated() -> Value {
    json!({"operation":"register","item":{"id":"unrelated","path":"generated/other","kind":"fixture","owner":"test","generated":true,"protection_known":true,"references":[]}})
}

#[test]
fn unrelated_transaction_commits_during_input_observation() {
    let root = fixture();
    std::fs::write(root.path().join("generated/other"), "other").unwrap();
    let run = call(&root, json!({"operation":"begin_run"}));
    let fired = AtomicBool::new(false);
    let authorize = |path: &Path, mode: AccessMode| {
        if path == root.path().join("generated/input")
            && mode == AccessMode::Read
            && !fired.swap(true, Ordering::SeqCst)
        {
            dispatch(root.path(), unrelated(), &allow)?;
        }
        Ok(())
    };
    assert_eq!(
        dispatch(root.path(), validation(&run), &authorize).unwrap()["valid"],
        true
    );
    assert!(fired.load(Ordering::SeqCst));
    let inventory = call(&root, json!({"operation":"inventory"}));
    assert!(
        inventory["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == "unrelated")
    );
    let persisted = call(
        &root,
        json!({"operation":"run_status","run_id":run["run_id"]}),
    );
    assert_eq!(persisted["steps"][0]["integrity_after"]["valid"], true);
}

#[test]
fn same_run_receipt_is_preserved_and_validation_conflicts() {
    let root = fixture();
    let run = call(&root, json!({"operation":"begin_run"}));
    let fired = AtomicBool::new(false);
    let authorize = |path: &Path, mode: AccessMode| {
        if path == root.path().join("generated/input")
            && mode == AccessMode::Read
            && !fired.swap(true, Ordering::SeqCst)
        {
            dispatch(
                root.path(),
                json!({"operation":"finish_step","run_id":run["run_id"],"step_id":run["steps"][0]["step_id"],"status":"failed","exit_code":7,"producer_completed":true,"execution_output":{"output":"concurrent failure"}}),
                &allow,
            )?;
        }
        Ok(())
    };
    let error = dispatch(root.path(), validation(&run), &authorize).unwrap_err();
    assert!(fired.load(Ordering::SeqCst));
    assert!(
        error.contains("run changed during input validation"),
        "{error}"
    );
    let persisted = call(
        &root,
        json!({"operation":"run_status","run_id":run["run_id"]}),
    );
    assert_eq!(persisted["status"], "failed");
    assert_eq!(persisted["steps"][0]["exit_code"], 7);
    assert_eq!(
        persisted["steps"][0]["execution_output"]["output"],
        "concurrent failure"
    );
    assert!(persisted["steps"][0].get("integrity_after").is_none());
}

#[test]
fn observation_error_is_persisted_and_invalidation_stays_sticky() {
    let root = fixture();
    let run = call(&root, json!({"operation":"begin_run"}));
    let deny_input = |path: &Path, mode: AccessMode| {
        if path == root.path().join("generated/input") && mode == AccessMode::Read {
            return Err("input read denied".into());
        }
        Ok(())
    };
    let invalid = dispatch(root.path(), validation(&run), &deny_input).unwrap();
    assert_eq!(invalid["valid"], false);
    assert!(
        invalid["reason"]
            .as_str()
            .unwrap()
            .contains("input read denied")
    );
    let retry = call(&root, validation(&run));
    assert_eq!(retry["valid"], false);
    assert_eq!(retry["reason"], "step integrity was already invalidated");
}

#[test]
fn changed_config_during_observation_invalidates_receipt() {
    let root = fixture();
    let run = call(&root, json!({"operation":"begin_run"}));
    let fired = AtomicBool::new(false);
    let authorize = |path: &Path, mode: AccessMode| {
        if path == root.path().join("generated/input")
            && mode == AccessMode::Read
            && !fired.swap(true, Ordering::SeqCst)
        {
            std::fs::write(root.path().join("project-maintenance.json"), "{")
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    };
    let invalid = dispatch(root.path(), validation(&run), &authorize).unwrap();
    assert!(fired.load(Ordering::SeqCst));
    assert_eq!(invalid["valid"], false);
    assert_eq!(
        invalid["reason"],
        "project config changed during validation"
    );
    let persisted = call(
        &root,
        json!({"operation":"run_status","run_id":run["run_id"]}),
    );
    assert_eq!(persisted["steps"][0]["integrity_status"], "invalid");
}

#[test]
fn terminal_step_observation_allows_unrelated_work_and_protects_inputs() {
    let root = fixture();
    std::fs::write(root.path().join("generated/other"), "other").unwrap();
    let run = call(&root, json!({"operation":"begin_run"}));
    call(
        &root,
        json!({"operation":"finish_step","run_id":run["run_id"],"step_id":run["steps"][0]["step_id"],"status":"failed","exit_code":9,"producer_completed":true}),
    );
    std::fs::write(root.path().join("generated/input"), "changed").unwrap();
    call(
        &root,
        json!({"operation":"register","item":{"id":"input","path":"generated/input","kind":"fixture","owner":"test","generated":true,"protection_known":true,"references":[]}}),
    );
    let reviewed = call(&root, json!({"operation":"review","ids":["input"]}));
    assert!(
        reviewed["items"][0]["blockers"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let fired = AtomicBool::new(false);
    let authorize = |path: &Path, mode: AccessMode| {
        if path == root.path().join("generated/input")
            && mode == AccessMode::Read
            && !fired.swap(true, Ordering::SeqCst)
        {
            let target = dispatch(
                root.path(),
                json!({"operation":"run_status","run_id":run["run_id"]}),
                &allow,
            )?;
            assert_eq!(target["status"], "failed");
            assert_eq!(target["steps"][0]["exit_code"], 9);
            dispatch(root.path(), unrelated(), &allow)?;
            let protected = dispatch(
                root.path(),
                json!({"operation":"review","ids":["input"]}),
                &allow,
            )?;
            assert!(
                protected["items"][0]["blockers"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|reason| reason == "active or unresolved related run"),
                "{protected}"
            );
            let deletion = dispatch(
                root.path(),
                json!({"operation":"apply","decisions":[{"id":"input","token":protected["items"][0]["token"],"decision":"delete","reason":"competing delete"}]}),
                &allow,
            )?;
            assert_eq!(deletion["results"][0]["status"], "blocked");
            assert!(root.path().join("generated/input").exists());
        }
        Ok(())
    };
    assert_eq!(
        dispatch(root.path(), validation(&run), &authorize).unwrap()["valid"],
        false
    );
    assert!(fired.load(Ordering::SeqCst));
    let persisted = call(
        &root,
        json!({"operation":"run_status","run_id":run["run_id"]}),
    );
    assert_eq!(persisted["status"], "unknown");
    assert!(persisted["steps"][0]["exit_code"].is_null());
    assert_eq!(persisted["steps"][0]["observed_exit_code"], 9);
    let runs = call(&root, json!({"operation":"run_status"}));
    assert_eq!(
        runs["runs"].as_object().unwrap().len(),
        1,
        "completed observation guard must be removed"
    );
}

#[test]
fn preparing_run_protects_inputs_while_unrelated_registration_commits() {
    let root = fixture();
    std::fs::write(root.path().join("generated/other"), "other").unwrap();
    call(
        &root,
        json!({"operation":"register","item":{"id":"input","path":"generated/input","kind":"fixture","owner":"test","generated":true,"protection_known":true,"references":[]}}),
    );
    let reviewed = call(&root, json!({"operation":"review","ids":["input"]}));
    assert!(
        reviewed["items"][0]["blockers"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let fired = AtomicBool::new(false);
    let authorize = |path: &Path, mode: AccessMode| {
        if path == root.path().join("generated/input")
            && mode == AccessMode::Read
            && !fired.swap(true, Ordering::SeqCst)
        {
            let runs = dispatch(root.path(), json!({"operation":"run_status"}), &allow)?;
            let run_id = runs["runs"].as_object().unwrap().keys().next().unwrap();
            let preparing = dispatch(
                root.path(),
                json!({"operation":"run_status","run_id":run_id}),
                &allow,
            )?;
            assert_eq!(preparing["preparation"], true);
            assert_eq!(preparing["steps"][0]["producer_completed"], false);
            assert!(preparing["steps"][0]["inputs"][0]["identity"].is_null());
            let protected = dispatch(
                root.path(),
                json!({"operation":"review","ids":["input"]}),
                &allow,
            )?;
            assert!(
                protected["items"][0]["blockers"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|reason| reason == "active or unresolved related run"),
                "{protected}"
            );
            let deletion = dispatch(
                root.path(),
                json!({"operation":"apply","decisions":[{"id":"input","token":protected["items"][0]["token"],"decision":"delete","reason":"competing delete"}]}),
                &allow,
            )?;
            assert_eq!(deletion["results"][0]["status"], "blocked");
            assert!(root.path().join("generated/input").exists());
            dispatch(root.path(), unrelated(), &allow)?;
        }
        Ok(())
    };
    let plan = dispatch(root.path(), json!({"operation":"begin_run"}), &authorize).unwrap();
    assert!(fired.load(Ordering::SeqCst));
    assert!(plan["steps"][0]["inputs"][0]["identity"].is_string());
    let persisted = call(
        &root,
        json!({"operation":"run_status","run_id":plan["run_id"]}),
    );
    assert!(persisted.get("preparation").is_none());
    assert_eq!(persisted["status"], "unknown");
    assert!(root.path().join("generated/input").exists());
}

#[test]
fn preparation_failure_closes_only_its_unstarted_producer() {
    let root = fixture();
    let deny_input = |path: &Path, mode: AccessMode| {
        if path == root.path().join("generated/input") && mode == AccessMode::Read {
            return Err("preparation input read denied".into());
        }
        Ok(())
    };
    let error = dispatch(root.path(), json!({"operation":"begin_run"}), &deny_input).unwrap_err();
    assert!(error.contains("preparation input read denied"), "{error}");
    let runs = call(&root, json!({"operation":"run_status"}));
    let run_id = runs["runs"].as_object().unwrap().keys().next().unwrap();
    let failed = call(&root, json!({"operation":"run_status","run_id":run_id}));
    assert_eq!(failed["status"], "failed");
    assert_eq!(failed["preparation"], false);
    assert_eq!(failed["execution_started"], false);
    assert!(
        failed["preparation_error"]
            .as_str()
            .unwrap()
            .contains("preparation input read denied")
    );
    assert_eq!(failed["steps"][0]["producer_completed"], true);
    assert_eq!(failed["steps"][0]["integrity_status"], "invalid");
    assert!(failed["steps"][0]["exit_code"].is_null());
    // A preparation failure has not run a command and no longer claims inputs.
    assert!(dispatch(root.path(), json!({"operation":"begin_run"}), &allow).is_ok());
}

#[test]
fn invalid_plan_request_does_not_publish_preparation() {
    let root = fixture();
    assert!(
        dispatch(
            root.path(),
            json!({"operation":"begin_run","bundles":["missing"]}),
            &allow
        )
        .is_err()
    );
    let runs = call(&root, json!({"operation":"run_status"}));
    assert!(runs["runs"].as_object().unwrap().is_empty());
}

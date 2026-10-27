//! Cohort contracts preserve logs/evidence until the corresponding version fate
//! is fully reviewed, including partial physical deletion and metadata changes.
use azrael_project_maintenance::{AccessMode, dispatch, dispatch_with_cancellation};
use serde_json::{Value, json};
use std::path::Path;
use tempfile::TempDir;

fn allow(_: &Path, _: AccessMode) -> Result<(), String> {
    Ok(())
}
fn call(root: &TempDir, request: Value) -> Value {
    dispatch(root.path(), request, &allow).unwrap()
}
fn fixture() -> TempDir {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("generated")).unwrap();
    std::fs::write(root.path().join("project-maintenance.json"),serde_json::to_vec(&json!({"schema_version":1,"project_id":"group-fixture","managed_roots":["generated"],"bundles":[]})).unwrap()).unwrap();
    root
}
fn member(id: &str, role: &str) -> Value {
    json!({"id":id,"path":format!("generated/{id}"),"kind":"fixture","owner":"test","generated":true,"protection_known":true,"references":[],"lifecycle_role":role})
}
fn create(root: &TempDir, id: &str, role: &str) -> Value {
    std::fs::write(root.path().join(format!("generated/{id}")), id).unwrap();
    member(id, role)
}
fn registration(id: &str, members: Vec<Value>, complete: bool) -> Value {
    json!({"operation":"register","group":{"id":id,"kind":"version","owner":"test","version":"old-version","membership_complete":complete,"provenance_ref":"receipt:producer-ledger","members":members}})
}
fn reviews(root: &TempDir, id: &str) -> Value {
    call(root, json!({"operation":"review","group_ids":[id]}))
}
fn decisions(review: &Value, fate: &str) -> Vec<Value> {
    review["items"].as_array().unwrap().iter().map(|item|json!({"id":item["id"],"token":item["token"],"decision":fate,"reason":"version review completed","revisit_condition":"consumer completes"})).collect()
}

#[test]
fn cancellation_preserves_completed_results_and_stops_before_physical_delete() {
    use std::cell::Cell;
    for after_completed in [false, true] {
        let root = fixture();
        call(
            &root,
            registration(
                "version",
                vec![
                    create(&root, "artifact", "artifact"),
                    create(&root, "log", "log"),
                ],
                true,
            ),
        );
        let reviewed = reviews(&root, "version");
        let manifest = root.path().join("artifacts/maintenance/manifest.json");
        let cancelled = Cell::new(false);
        let cancel = || {
            if cancelled.get() {
                return true;
            }
            let state: Value = serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
            let requested = state["decisions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|decision| {
                    decision["id"] == "artifact"
                        && decision["status"]
                            == if after_completed {
                                "deleted"
                            } else {
                                "pending"
                            }
                });
            cancelled.set(requested);
            requested
        };
        let result = dispatch_with_cancellation(
            root.path(),
            json!({"operation":"apply","decisions":decisions(&reviewed,"delete")}),
            &allow,
            &cancel,
        )
        .unwrap();
        assert_eq!(result["aborted"], true);
        assert_eq!(result["cancelled"], true);
        assert_eq!(result["results"][0]["id"], "artifact");
        if after_completed {
            assert_eq!(result["results"][0]["status"], "deleted");
            assert!(!root.path().join("generated/artifact").exists());
            assert_eq!(result["groups"][0]["status"], "partial");
        } else {
            assert_eq!(result["results"][0]["status"], "cancelled");
            assert_eq!(result["results"][0]["attempted"], false);
            assert_eq!(result["results"][0]["remaining"], true);
            assert!(root.path().join("generated/artifact").exists());
        }
        assert_eq!(result["results"][1]["id"], "log");
        assert_eq!(result["results"][1]["status"], "cancelled");
        assert_eq!(result["results"][1]["attempted"], false);
        assert_eq!(result["results"][1]["remaining"], true);
        assert!(root.path().join("generated/log").exists());
        let durable: Value = serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
        assert_eq!(durable["decisions"], result["results"]);
        assert!(
            durable["decisions"]
                .as_array()
                .unwrap()
                .iter()
                .all(|decision| decision["status"] != "pending")
        );
        let reservations = root
            .path()
            .join("artifacts/maintenance/lifecycles/reservations");
        assert!(!std::fs::read_dir(reservations).unwrap().any(|entry| {
            entry
                .unwrap()
                .path()
                .extension()
                .is_some_and(|ext| ext == "json")
        }));
    }
}

#[test]
fn absent_member_is_reviewed_and_reconciled_before_remaining_evidence() {
    let root = fixture();
    call(
        &root,
        registration(
            "version",
            vec![
                create(&root, "artifact", "artifact"),
                create(&root, "log", "log"),
            ],
            true,
        ),
    );
    std::fs::remove_file(root.path().join("generated/artifact")).unwrap();
    let reviewed = reviews(&root, "version");
    assert_eq!(reviewed["items"].as_array().unwrap().len(), 2);
    let missing = &reviewed["items"][0];
    assert_eq!(missing["id"], "artifact");
    assert_eq!(missing["presence"], "absent");
    assert_eq!(missing["remaining"], false);
    assert!(missing["blockers"].as_array().unwrap().is_empty());
    let result = call(
        &root,
        json!({"operation":"apply","decisions":decisions(&reviewed,"delete")}),
    );
    assert_eq!(result["results"][0]["id"], "artifact");
    assert_eq!(result["results"][0]["status"], "deleted");
    assert_eq!(result["results"][0]["attempted"], false);
    assert_eq!(result["results"][0]["remaining"], false);
    assert!(result["results"][0]["attempt_id"].is_null());
    assert_eq!(result["results"][1]["id"], "log");
    assert_eq!(result["groups"][0]["status"], "deleted");
    assert!(!root.path().join("generated/log").exists());
}

#[test]
fn full_and_omitted_missing_member_updates_preserve_history_and_group_ownership() {
    for omit in [false, true] {
        let root = fixture();
        let mut artifact = create(&root, "artifact", "artifact");
        artifact["provenance"] = json!({"receipt":"last-measured"});
        let log = create(&root, "log", "log");
        let initial = call(
            &root,
            registration("version", vec![artifact, log.clone()], true),
        );
        let original = &initial["items"][0];
        std::fs::remove_file(root.path().join("generated/artifact")).unwrap();
        let members = if omit {
            vec![log]
        } else {
            vec![member("artifact", "artifact"), log]
        };
        let updated = call(&root, registration("version", members, true));
        let historical = &updated["items"][0];
        assert_eq!(historical["id"], "artifact");
        assert_eq!(historical["identity"], original["identity"]);
        assert_eq!(historical["provenance"], original["provenance"]);
        assert_eq!(historical["measured_at_ms"], original["measured_at_ms"]);
        assert_eq!(historical["presence"], "absent");
        assert_eq!(historical["remaining"], false);
        assert_eq!(historical["lifecycle_group_id"], "version");
        assert_eq!(updated["group"]["members"], json!(["artifact", "log"]));
        let reviewed = reviews(&root, "version");
        assert_eq!(reviewed["items"].as_array().unwrap().len(), 2);
        let result = call(
            &root,
            json!({"operation":"apply","decisions":decisions(&reviewed,"delete")}),
        );
        assert_eq!(result["groups"][0]["status"], "deleted");
    }
}

#[test]
fn all_absent_members_complete_without_write_authorization_and_stay_reconciled() {
    let root = fixture();
    call(
        &root,
        registration(
            "version",
            vec![
                create(&root, "artifact", "artifact"),
                create(&root, "log", "log"),
            ],
            true,
        ),
    );
    // Missing ancestors are also a verified absence when all read checks pass.
    std::fs::remove_file(root.path().join("generated/artifact")).unwrap();
    std::fs::remove_file(root.path().join("generated/log")).unwrap();
    std::fs::remove_dir(root.path().join("generated")).unwrap();
    let reviewed = reviews(&root, "version");
    let deny_target_writes = |path: &Path, mode| {
        if path.starts_with(root.path().join("generated")) && mode == AccessMode::Write {
            Err("absent target must not need deletion authority".into())
        } else {
            Ok(())
        }
    };
    let result = dispatch(
        root.path(),
        json!({"operation":"apply","decisions":decisions(&reviewed,"delete")}),
        &deny_target_writes,
    )
    .unwrap();
    assert_eq!(result["groups"][0]["status"], "deleted");
    for outcome in result["results"].as_array().unwrap() {
        assert_eq!(outcome["status"], "deleted");
        assert_eq!(outcome["attempted"], false);
        assert_eq!(outcome["remaining"], false);
        assert!(outcome["attempt_id"].is_null());
    }
    assert!(
        reviews(&root, "version")["items"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let durable: Value = serde_json::from_slice(
        &std::fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(durable["groups"]["version"]["cleanup_status"], "deleted");
    assert_eq!(durable["decisions"].as_array().unwrap().len(), 2);
}

#[test]
fn denied_missing_member_stays_unknown_and_protects_the_whole_group() {
    let root = fixture();
    let artifact = create(&root, "artifact", "artifact");
    let log = create(&root, "log", "log");
    call(
        &root,
        registration("version", vec![artifact.clone(), log.clone()], true),
    );
    let path = root.path().join("generated/artifact");
    std::fs::remove_file(&path).unwrap();
    let deny = |candidate: &Path, mode| {
        if candidate == path && mode == AccessMode::Read {
            Err("member read denied".into())
        } else {
            Ok(())
        }
    };
    let reviewed = dispatch(
        root.path(),
        json!({"operation":"review","group_ids":["version"]}),
        &deny,
    )
    .unwrap();
    assert_eq!(reviewed["items"][0]["presence"], "unknown");
    assert!(reviewed["items"][0]["remaining"].is_null());
    assert_eq!(
        reviewed["items"][0]["observation_error"],
        "member read denied"
    );
    assert!(
        reviewed["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| !item["blockers"].as_array().unwrap().is_empty())
    );
    let result = dispatch(
        root.path(),
        json!({"operation":"apply","decisions":decisions(&reviewed,"delete")}),
        &deny,
    )
    .unwrap();
    assert!(
        result["results"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["status"] == "blocked")
    );
    for members in [vec![artifact, log.clone()], vec![log]] {
        assert!(dispatch(root.path(), registration("version", members, true), &deny).is_err());
    }
    assert!(root.path().join("generated/log").exists());
}

#[test]
fn absence_changes_invalidate_old_group_tokens() {
    for reappears in [false, true] {
        let root = fixture();
        call(
            &root,
            registration(
                "version",
                vec![
                    create(&root, "artifact", "artifact"),
                    create(&root, "log", "log"),
                ],
                true,
            ),
        );
        let path = root.path().join("generated/artifact");
        if reappears {
            std::fs::remove_file(&path).unwrap();
        }
        let reviewed = reviews(&root, "version");
        if reappears {
            std::fs::write(&path, "artifact").unwrap();
        } else {
            std::fs::remove_file(&path).unwrap();
        }
        let result = call(
            &root,
            json!({"operation":"apply","decisions":decisions(&reviewed,"delete")}),
        );
        assert!(
            result["results"]
                .as_array()
                .unwrap()
                .iter()
                .all(|item| item["status"] == "blocked")
        );
        assert!(root.path().join("generated/log").exists());
        assert_eq!(path.exists(), reappears);
    }
}

#[test]
fn reconciled_absent_member_reappearing_during_batch_retains_evidence() {
    use std::cell::Cell;
    let root = fixture();
    call(
        &root,
        registration(
            "version",
            vec![
                create(&root, "artifact", "artifact"),
                create(&root, "log", "log"),
            ],
            true,
        ),
    );
    let artifact = root.path().join("generated/artifact");
    let log = root.path().join("generated/log");
    std::fs::remove_file(&artifact).unwrap();
    let reviewed = reviews(&root, "version");
    let recreated = Cell::new(false);
    let authorize = |path: &Path, mode| {
        if path == log && mode == AccessMode::Write && !recreated.replace(true) {
            std::fs::write(&artifact, "reappeared").unwrap();
        }
        Ok(())
    };
    let result = dispatch(
        root.path(),
        json!({"operation":"apply","decisions":decisions(&reviewed,"delete")}),
        &authorize,
    )
    .unwrap();
    assert!(recreated.get());
    assert_eq!(result["results"][0]["status"], "deleted");
    assert_eq!(result["results"][1]["status"], "blocked");
    assert_eq!(result["groups"][0]["status"], "partial");
    assert!(artifact.exists());
    assert!(log.exists());
    // A later review must include the reappeared member despite cached deletion.
    assert_eq!(reviews(&root, "version")["items"][0]["presence"], "present");
}

#[test]
fn absent_member_updates_keep_unresolved_cleanup_intent_protected() {
    for omit in [false, true] {
        let root = fixture();
        call(
            &root,
            registration(
                "version",
                vec![
                    create(&root, "artifact", "artifact"),
                    create(&root, "log", "log"),
                ],
                true,
            ),
        );
        let manifest = root.path().join("artifacts/maintenance/manifest.json");
        let mut state: Value = serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
        state["items"]["artifact"]["cleanup_status"] = json!("pending");
        state["items"]["artifact"]["remaining"] = Value::Null;
        std::fs::write(&manifest, serde_json::to_vec(&state).unwrap()).unwrap();
        std::fs::remove_file(root.path().join("generated/artifact")).unwrap();
        let mut members = vec![member("log", "log")];
        if !omit {
            members.push(member("artifact", "artifact"));
        }
        let updated = call(&root, registration("version", members, true));
        assert_eq!(updated["items"][0]["cleanup_status"], "pending");
        let reviewed = reviews(&root, "version");
        assert_eq!(reviewed["items"][0]["presence"], "absent");
        assert!(
            reviewed["items"]
                .as_array()
                .unwrap()
                .iter()
                .all(|item| !item["blockers"].as_array().unwrap().is_empty())
        );
        let result = call(
            &root,
            json!({"operation":"apply","decisions":decisions(&reviewed,"delete")}),
        );
        assert!(
            result["results"]
                .as_array()
                .unwrap()
                .iter()
                .all(|item| item["status"] == "blocked")
        );
        assert!(root.path().join("generated/log").exists());
        // The unresolved earlier intent keeps the new durable reservation active.
        // Neither fresh review nor a competing apply may bypass that protection.
        for fate in ["defer", "delete"] {
            let durable: Value =
                serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
            assert_eq!(durable["items"]["artifact"]["cleanup_status"], "pending");
            assert!(
                dispatch(
                    root.path(),
                    json!({"operation":"review","group_ids":["version"]}),
                    &allow
                )
                .is_err()
            );
            assert!(
                dispatch(
                    root.path(),
                    json!({"operation":"apply","decisions":decisions(&reviewed,fate)}),
                    &allow
                )
                .is_err()
            );
            assert!(root.path().join("generated/log").exists());
        }
        let durable: Value = serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
        assert_eq!(durable["items"]["artifact"]["cleanup_status"], "pending");
        assert!(
            dispatch(
                root.path(),
                json!({"operation":"review","group_ids":["version"]}),
                &allow
            )
            .is_err()
        );
    }
}

#[test]
fn denied_authorization_after_new_intent_records_known_blocked_result() {
    use std::cell::Cell;
    let root = fixture();
    call(
        &root,
        registration(
            "version",
            vec![
                create(&root, "artifact", "artifact"),
                create(&root, "log", "log"),
            ],
            true,
        ),
    );
    let artifact = root.path().join("generated/artifact");
    let manifest = root.path().join("artifacts/maintenance/manifest.json");
    let reviewed = reviews(&root, "version");
    let manifest_writes = Cell::new(0usize);
    let authorize = |path: &Path, mode| {
        if path == manifest && mode == AccessMode::Write {
            manifest_writes.set(manifest_writes.get() + 1);
        }
        // The second manifest write authorization belongs to intent persistence.
        if manifest_writes.get() >= 2 && path == artifact && mode == AccessMode::Write {
            return Err("target write denied after intent".into());
        }
        Ok(())
    };
    let result = dispatch(
        root.path(),
        json!({"operation":"apply","decisions":decisions(&reviewed,"delete")}),
        &authorize,
    )
    .unwrap();
    assert!(manifest_writes.get() >= 2);
    assert_eq!(result["results"][0]["status"], "blocked");
    assert!(result["results"][0]["attempt_id"].is_string());
    assert!(artifact.exists());
    assert!(root.path().join("generated/log").exists());
    let durable: Value = serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
    assert_eq!(durable["items"]["artifact"]["cleanup_status"], "blocked");
    let fresh = reviews(&root, "version");
    assert!(
        fresh["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["blockers"].as_array().unwrap().is_empty())
    );
    let retry = call(
        &root,
        json!({"operation":"apply","decisions":decisions(&fresh,"delete")}),
    );
    assert_eq!(retry["groups"][0]["status"], "deleted");
}

#[test]
fn apply_observes_membership_once_per_preflight_and_intent_boundary() {
    use std::cell::Cell;
    let root = fixture();
    let source = root.path().join("generated/membership.json");
    std::fs::write(&source, "{}").unwrap();
    let mut request = registration("version", vec![create(&root, "artifact", "artifact")], true);
    request["group"]["membership_source"] = json!("generated/membership.json");
    call(&root, request);
    let reads = Cell::new(0usize);
    let authorize = |path: &Path, mode| {
        if path == source && mode == AccessMode::Read {
            reads.set(reads.get() + 1);
        }
        Ok(())
    };
    let reviewed = dispatch(
        root.path(),
        json!({"operation":"review","group_ids":["version"]}),
        &authorize,
    )
    .unwrap();
    let one_observation = reads.replace(0);
    assert!(one_observation > 0);
    let result = dispatch(
        root.path(),
        json!({"operation":"apply","decisions":decisions(&reviewed,"delete")}),
        &authorize,
    )
    .unwrap();
    assert_eq!(result["groups"][0]["status"], "deleted");
    // One group preflight and one fresh observation on each side of intent.
    assert_eq!(reads.get(), one_observation * 3);
}

#[test]
fn authorization_and_intent_mutations_preserve_all_group_members() {
    use std::cell::Cell;
    for during_intent in [false, true] {
        for change_source in [false, true] {
            let root = fixture();
            let source = root.path().join("generated/membership.json");
            std::fs::write(&source, "{}").unwrap();
            let artifact = root.path().join("generated/artifact");
            let mut request = registration(
                "version",
                vec![
                    create(&root, "artifact", "artifact"),
                    create(&root, "log", "log"),
                ],
                true,
            );
            request["group"]["membership_source"] = json!("generated/membership.json");
            call(&root, request);
            let reviewed = call(
                &root,
                json!({"operation":"review","group_ids":["version"],"verification":"full"}),
            );
            let changed = Cell::new(false);
            let manifest_writes = Cell::new(0usize);
            let authorize = |path: &Path, mode| {
                if mode == AccessMode::Write {
                    if path.file_name().is_some_and(|name| name == "manifest.json") {
                        manifest_writes.set(manifest_writes.get() + 1);
                    }
                    // authorize_save is the first manifest write request; the
                    // second belongs to the durable intent save itself.
                    let boundary = if during_intent {
                        path.file_name().is_some_and(|name| name == "manifest.json")
                            && manifest_writes.get() == 2
                    } else {
                        path == artifact
                    };
                    if boundary && !changed.replace(true) {
                        std::fs::write(
                            if change_source { &source } else { &artifact },
                            "changed during authorization",
                        )
                        .unwrap();
                    }
                }
                Ok(())
            };
            let result = dispatch(
                root.path(),
                json!({"operation":"apply","verification":"full","decisions":decisions(&reviewed,"delete")}),
                &authorize,
            )
            .unwrap();
            assert!(changed.get());
            assert_eq!(result["results"][0]["status"], "blocked");
            assert!(artifact.exists());
            assert!(root.path().join("generated/log").exists());
            if during_intent {
                let durable: Value = serde_json::from_slice(
                    &std::fs::read(root.path().join("artifacts/maintenance/manifest.json"))
                        .unwrap(),
                )
                .unwrap();
                assert!(durable["decisions"][0]["attempt_id"].is_string());
            }
        }
    }
}

#[test]
fn authorization_mutating_a_cached_sibling_with_restored_mtime_blocks_group() {
    use std::cell::Cell;
    let root = fixture();
    let artifact = root.path().join("generated/artifact");
    let sibling = root.path().join("generated/log");
    let members = vec![
        create(&root, "artifact", "artifact"),
        create(&root, "log", "log"),
    ];
    std::fs::write(&sibling, vec![b'a'; 65536]).unwrap();
    call(&root, registration("version", members, true));
    let reviewed = call(
        &root,
        json!({"operation":"review","group_ids":["version"],"verification":"full"}),
    );
    let modified = std::fs::metadata(&sibling).unwrap().modified().unwrap();
    let changed = Cell::new(false);
    let authorize = |path: &Path, mode| {
        if path == artifact && mode == AccessMode::Write && !changed.replace(true) {
            // The group preflight has already hashed this other member. Its
            // length and mtime match that cached observation after the rewrite.
            std::fs::write(&sibling, vec![b'b'; 65536]).unwrap();
            std::fs::File::options()
                .write(true)
                .open(&sibling)
                .unwrap()
                .set_times(std::fs::FileTimes::new().set_modified(modified))
                .unwrap();
        }
        Ok(())
    };
    let result = dispatch(
        root.path(),
        json!({"operation":"apply","verification":"full","decisions":decisions(&reviewed,"delete")}),
        &authorize,
    )
    .unwrap();
    assert!(changed.get());
    assert_eq!(result["results"][0]["status"], "blocked");
    assert!(artifact.exists());
    assert!(sibling.exists());
}

#[test]
fn artifact_log_evidence_share_expanded_review_and_delete_fate() {
    let root = fixture();
    let members = vec![
        create(&root, "artifact", "artifact"),
        create(&root, "log", "log"),
        create(&root, "evidence", "evidence"),
    ];
    call(&root, registration("version", members, true));
    let expanded = call(&root, json!({"operation":"review","ids":["log"]}));
    assert_eq!(expanded["items"].as_array().unwrap().len(), 3);
    assert!(
        expanded["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["group_member_ids"].as_array().unwrap().len() == 3)
    );
    let inventory = call(&root, json!({"operation":"inventory","limit":1}));
    assert_eq!(inventory["pagination"]["groups_total"], 1);
    assert_eq!(inventory["groups"][0]["cached_live_members"], 3);
    let result = call(
        &root,
        json!({"operation":"apply","decisions":decisions(&expanded,"delete")}),
    );
    assert_eq!(result["groups"][0]["status"], "deleted");
    assert_eq!(result["results"][0]["id"], "artifact");
    for id in ["artifact", "log", "evidence"] {
        assert!(!root.path().join(format!("generated/{id}")).exists());
    }
    assert_eq!(
        reviews(&root, "version")["items"].as_array().unwrap().len(),
        0
    );
}

#[test]
fn missing_or_mixed_group_decisions_never_mutate_any_member() {
    let root = fixture();
    call(
        &root,
        registration(
            "version",
            vec![
                create(&root, "artifact", "artifact"),
                create(&root, "log", "log"),
            ],
            true,
        ),
    );
    let reviewed = reviews(&root, "version");
    let all = decisions(&reviewed, "delete");
    let mut mixed = all.clone();
    mixed[1]["decision"] = json!("defer");
    for selected in [vec![all[0].clone()], mixed] {
        assert!(
            dispatch(
                root.path(),
                json!({"operation":"apply","decisions":selected}),
                &allow
            )
            .is_err()
        );
        for id in ["artifact", "log"] {
            assert!(root.path().join(format!("generated/{id}")).exists());
        }
    }
}

#[test]
fn incomplete_or_protected_member_blocks_delete_but_all_defer_preserves() {
    for complete in [false, true] {
        let root = fixture();
        let artifact = create(&root, "artifact", "artifact");
        let mut log = create(&root, "log", "log");
        if complete {
            log["retain_reason"] = json!("consumer still requires evidence");
        }
        call(
            &root,
            registration("version", vec![artifact, log], complete),
        );
        let reviewed = reviews(&root, "version");
        assert!(
            reviewed["items"]
                .as_array()
                .unwrap()
                .iter()
                .all(|item| !item["blockers"].as_array().unwrap().is_empty())
        );
        let result = call(
            &root,
            json!({"operation":"apply","decisions":decisions(&reviewed,"delete")}),
        );
        assert!(
            result["results"]
                .as_array()
                .unwrap()
                .iter()
                .all(|item| item["status"] == "blocked")
        );
        let retained = reviews(&root, "version");
        let result = call(
            &root,
            json!({"operation":"apply","decisions":decisions(&retained,"defer")}),
        );
        assert!(
            result["results"]
                .as_array()
                .unwrap()
                .iter()
                .all(|item| item["status"] == "deferred")
        );
        assert!(root.path().join("generated/artifact").exists());
        assert!(root.path().join("generated/log").exists());
    }
}

#[test]
fn retained_registered_child_protects_the_entire_group() {
    let root = fixture();
    std::fs::create_dir(root.path().join("generated/artifact")).unwrap();
    std::fs::write(root.path().join("generated/artifact/child"), "keep").unwrap();
    let log = create(&root, "log", "log");
    call(
        &root,
        registration("version", vec![member("artifact", "artifact"), log], true),
    );
    call(
        &root,
        json!({"operation":"register","item":{"id":"child","path":"generated/artifact/child","kind":"fixture","owner":"test","generated":true,"protection_known":true,"references":["consumer"]}}),
    );
    let reviewed = reviews(&root, "version");
    let result = call(
        &root,
        json!({"operation":"apply","decisions":decisions(&reviewed,"delete")}),
    );
    assert!(
        result["results"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["status"] == "blocked")
    );
    assert!(root.path().join("generated/log").exists());
    assert!(root.path().join("generated/artifact/child").exists());
}

#[test]
fn membership_change_invalidates_old_tokens_and_live_members_cannot_drop() {
    let root = fixture();
    let artifact = create(&root, "artifact", "artifact");
    let log = create(&root, "log", "log");
    call(
        &root,
        registration("version", vec![artifact.clone(), log.clone()], true),
    );
    let before = reviews(&root, "version");
    assert!(
        dispatch(
            root.path(),
            registration("version", vec![artifact.clone()], true),
            &allow
        )
        .is_err()
    );
    let evidence = create(&root, "evidence", "evidence");
    call(
        &root,
        registration("version", vec![artifact, log, evidence], true),
    );
    let after = reviews(&root, "version");
    let mut choices = decisions(&before, "delete");
    choices.extend(
        decisions(&after, "delete")
            .into_iter()
            .filter(|choice| choice["id"] == "evidence"),
    );
    let result = call(&root, json!({"operation":"apply","decisions":choices}));
    assert!(
        result["results"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["status"] == "blocked")
    );
    for id in ["artifact", "log", "evidence"] {
        assert!(root.path().join(format!("generated/{id}")).exists());
    }
}

#[test]
fn direct_registration_cannot_strip_or_spoof_group_membership() {
    let root = fixture();
    call(
        &root,
        registration(
            "version",
            vec![
                create(&root, "artifact", "artifact"),
                create(&root, "log", "log"),
            ],
            true,
        ),
    );
    let mut direct = member("artifact", "artifact");
    direct.as_object_mut().unwrap().remove("lifecycle_role");
    assert!(
        dispatch(
            root.path(),
            json!({"operation":"register","item":direct}),
            &allow
        )
        .is_err()
    );
    let mut spoof = create(&root, "new", "artifact");
    spoof["lifecycle_group_id"] = json!("version");
    assert!(
        dispatch(
            root.path(),
            json!({"operation":"register","item":spoof}),
            &allow
        )
        .is_err()
    );
    let reviewed = reviews(&root, "version");
    assert_eq!(reviewed["items"].as_array().unwrap().len(), 2);
}

#[test]
fn failed_group_registration_is_atomic_and_paths_must_be_disjoint() {
    let root = fixture();
    let valid = create(&root, "valid", "artifact");
    let missing = member("missing", "log");
    assert!(
        dispatch(
            root.path(),
            registration("version", vec![valid, missing], true),
            &allow
        )
        .is_err()
    );
    let inventory = call(&root, json!({"operation":"inventory"}));
    assert_eq!(inventory["pagination"]["total"], 0);
    assert_eq!(inventory["pagination"]["groups_total"], 0);
    std::fs::create_dir(root.path().join("generated/tree")).unwrap();
    std::fs::write(root.path().join("generated/tree/log"), "evidence").unwrap();
    let mut child = member("child", "log");
    child["path"] = json!("generated/tree/log");
    assert!(
        dispatch(
            root.path(),
            registration("version", vec![member("tree", "artifact"), child], true),
            &allow
        )
        .is_err()
    );
}

#[test]
fn ungrouped_parent_cannot_bypass_a_descendant_lifecycle_group() {
    let root = fixture();
    std::fs::create_dir(root.path().join("generated/tree")).unwrap();
    std::fs::write(root.path().join("generated/tree/artifact"), "owned").unwrap();
    let mut artifact = member("artifact", "artifact");
    artifact["path"] = json!("generated/tree/artifact");
    call(
        &root,
        registration("version", vec![artifact, create(&root, "log", "log")], true),
    );
    let mut parent = member("parent", "artifact");
    parent["path"] = json!("generated/tree");
    parent.as_object_mut().unwrap().remove("lifecycle_role");
    call(&root, json!({"operation":"register","item":parent}));
    let reviewed = call(&root, json!({"operation":"review","ids":["parent"]}));
    assert!(
        !reviewed["items"][0]["blockers"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let result = call(
        &root,
        json!({"operation":"apply","decisions":decisions(&reviewed,"delete")}),
    );
    assert_eq!(result["results"][0]["status"], "blocked");
    assert!(root.path().join("generated/tree/artifact").exists());
    assert!(root.path().join("generated/log").exists());
}

#[cfg(windows)]
#[test]
fn partial_failure_retains_logs_and_independent_items_can_continue() {
    use std::os::windows::fs::OpenOptionsExt;
    let root = fixture();
    let a = create(&root, "a-artifact", "artifact");
    let b = create(&root, "b-artifact", "artifact");
    let log = create(&root, "log", "log");
    call(&root, registration("version", vec![log, b, a], true));
    let _reader = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(3)
        .open(root.path().join("generated/b-artifact"))
        .unwrap();
    let independent = create(&root, "independent", "artifact");
    let mut independent = independent;
    independent
        .as_object_mut()
        .unwrap()
        .remove("lifecycle_role");
    call(&root, json!({"operation":"register","item":independent}));
    let mut choices = decisions(&reviews(&root, "version"), "delete");
    let separate = call(&root, json!({"operation":"review","ids":["independent"]}));
    choices.extend(decisions(&separate, "delete"));
    let result = call(&root, json!({"operation":"apply","decisions":choices}));
    assert_eq!(result["groups"][0]["status"], "partial");
    assert_eq!(result["results"][0]["id"], "a-artifact");
    assert_eq!(result["results"][0]["status"], "deleted");
    assert_eq!(result["results"][1]["status"], "failed");
    assert_eq!(result["results"][2]["id"], "log");
    assert_eq!(result["results"][2]["status"], "blocked");
    assert_eq!(result["results"][3]["status"], "deleted");
    assert!(root.path().join("generated/log").exists());
    assert!(root.path().join("generated/b-artifact").exists());
    assert!(!root.path().join("generated/a-artifact").exists());
    assert!(!root.path().join("generated/independent").exists());
}

#[test]
fn membership_directory_change_requires_fresh_full_registration() {
    let root = fixture();
    let members = vec![
        create(&root, "artifact", "artifact"),
        create(&root, "log", "log"),
    ];
    let ledger = root.path().join("generated/ledger");
    std::fs::create_dir(&ledger).unwrap();
    std::fs::write(ledger.join("producer.json"), "{}").unwrap();
    let mut request = registration("version", members.clone(), true);
    request["group"]["membership_source"] = json!("generated/ledger");
    call(&root, request);
    let before = reviews(&root, "version");
    assert!(
        before["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["blockers"].as_array().unwrap().is_empty())
    );
    // A newly added consumer file changes inbound reference knowledge without
    // changing the producer's own file. The directory binding must catch it.
    std::fs::write(
        ledger.join("new-consumer.json"),
        "{\"references\":[\"version\"]}",
    )
    .unwrap();
    let changed = reviews(&root, "version");
    assert!(
        changed["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| !item["blockers"].as_array().unwrap().is_empty())
    );
    let blocked = call(
        &root,
        json!({"operation":"apply","decisions":decisions(&changed,"delete")}),
    );
    assert!(
        blocked["results"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["status"] == "blocked")
    );
    assert!(root.path().join("generated/artifact").exists());
    assert!(root.path().join("generated/log").exists());
    // Omitting the optional source on update preserves its existing binding.
    call(&root, registration("version", members, true));
    let refreshed = reviews(&root, "version");
    assert!(
        refreshed["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["blockers"].as_array().unwrap().is_empty())
    );
    let result = call(
        &root,
        json!({"operation":"apply","decisions":decisions(&refreshed,"delete")}),
    );
    assert_eq!(result["groups"][0]["status"], "deleted");
    assert!(ledger.join("new-consumer.json").exists());
}

#[test]
fn missing_or_denied_membership_source_blocks_delete_and_control_source_is_protected() {
    let root = fixture();
    let source = root.path().join("generated/membership.json");
    std::fs::write(&source, "{}").unwrap();
    let mut request = registration(
        "version",
        vec![
            create(&root, "artifact", "artifact"),
            create(&root, "log", "log"),
        ],
        true,
    );
    request["group"]["membership_source"] = json!("generated/membership.json");
    call(&root, request);
    let deny = |path: &Path, mode| {
        if path == source && mode == AccessMode::Read {
            Err("source read denied".into())
        } else {
            Ok(())
        }
    };
    let reviewed = dispatch(
        root.path(),
        json!({"operation":"review","group_ids":["version"]}),
        &deny,
    )
    .unwrap();
    assert!(
        reviewed["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| !item["blockers"].as_array().unwrap().is_empty())
    );
    let mut source_item = member("source", "artifact");
    source_item["path"] = json!("generated/membership.json");
    source_item
        .as_object_mut()
        .unwrap()
        .remove("lifecycle_role");
    call(&root, json!({"operation":"register","item":source_item}));
    let protected = call(&root, json!({"operation":"review","ids":["source"]}));
    assert!(
        !protected["items"][0]["blockers"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    std::fs::remove_file(&source).unwrap();
    let missing = reviews(&root, "version");
    assert!(
        missing["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| !item["blockers"].as_array().unwrap().is_empty())
    );
    let blocked = call(
        &root,
        json!({"operation":"apply","decisions":decisions(&missing,"delete")}),
    );
    assert!(
        blocked["results"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["status"] == "blocked")
    );
    assert!(root.path().join("generated/artifact").exists());
    assert!(root.path().join("generated/log").exists());
}

#[test]
fn registered_default_reviews_cached_measurements_without_descendant_reads() {
    let root = fixture();
    let tree = root.path().join("generated/tree");
    std::fs::create_dir(&tree).unwrap();
    let child = tree.join("child");
    std::fs::write(&child, "registered").unwrap();
    call(
        &root,
        registration("version", vec![member("tree", "artifact")], true),
    );
    let deny_child = |path: &Path, _: AccessMode| {
        if path == child {
            Err("payload must not be read".into())
        } else {
            Ok(())
        }
    };
    let before = dispatch(
        root.path(),
        json!({"operation":"review","group_ids":["version"]}),
        &deny_child,
    )
    .unwrap();
    assert_eq!(before["items"][0]["verification"], "registered");
    assert!(
        before["items"][0]["blockers"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    std::fs::write(&child, "unreported changed content").unwrap();
    let after = dispatch(
        root.path(),
        json!({"operation":"review","group_ids":["version"]}),
        &deny_child,
    )
    .unwrap();
    assert_eq!(before["items"][0]["token"], after["items"][0]["token"]);
    assert_eq!(
        before["items"][0]["measured_at_ms"],
        after["items"][0]["measured_at_ms"]
    );
    let full = call(
        &root,
        json!({"operation":"review","group_ids":["version"],"verification":"full"}),
    );
    assert_ne!(before["items"][0]["identity"], full["items"][0]["identity"]);
}

#[test]
fn registered_apply_reads_each_descendant_only_for_single_safe_enumeration() {
    use std::cell::Cell;
    let root = fixture();
    let tree = root.path().join("generated/tree");
    std::fs::create_dir(&tree).unwrap();
    let child = tree.join("child");
    std::fs::write(&child, "owned").unwrap();
    call(
        &root,
        registration("version", vec![member("tree", "artifact")], true),
    );
    let reviewed = reviews(&root, "version");
    let reads = Cell::new(0);
    let authorize = |path: &Path, mode| {
        if path == child && mode == AccessMode::Read {
            reads.set(reads.get() + 1);
            if reads.get() > 1 {
                return Err("repeated payload traversal".into());
            }
        }
        Ok(())
    };
    let result = dispatch(
        root.path(),
        json!({"operation":"apply","decisions":decisions(&reviewed,"delete")}),
        &authorize,
    )
    .unwrap();
    assert_eq!(result["results"][0]["status"], "deleted", "{result}");
    assert_eq!(reads.get(), 1);
}

#[test]
fn verification_modes_are_validated_and_bound_to_tokens() {
    let root = fixture();
    call(
        &root,
        registration("version", vec![create(&root, "artifact", "artifact")], true),
    );
    for mode in [json!("invalid"), json!(null), json!(1)] {
        assert!(
            dispatch(
                root.path(),
                json!({"operation":"review","group_ids":["version"],"verification":mode}),
                &allow
            )
            .is_err()
        );
        assert!(
            dispatch(
                root.path(),
                json!({"operation":"apply","decisions":[],"verification":mode}),
                &allow
            )
            .is_err()
        );
    }
    let registered = reviews(&root, "version");
    let full = call(
        &root,
        json!({"operation":"review","group_ids":["version"],"verification":"full"}),
    );
    assert_ne!(registered["items"][0]["token"], full["items"][0]["token"]);
    let blocked = call(
        &root,
        json!({"operation":"apply","verification":"full","decisions":decisions(&registered,"delete")}),
    );
    assert_eq!(blocked["results"][0]["status"], "blocked");
    let mut independent = create(&root, "independent", "artifact");
    independent
        .as_object_mut()
        .unwrap()
        .remove("lifecycle_role");
    call(&root, json!({"operation":"register","item":independent}));
    assert!(
        dispatch(
            root.path(),
            json!({"operation":"review","ids":["independent"],"verification":"registered"}),
            &allow
        )
        .is_err()
    );
    let mixed = call(
        &root,
        json!({"operation":"review","ids":["independent","artifact"]}),
    );
    assert_eq!(mixed["items"][0]["verification"], "registered");
    assert_eq!(mixed["items"][1]["verification"], "full");
}

#[test]
fn replaced_registered_root_invalidates_review() {
    let root = fixture();
    call(
        &root,
        registration("version", vec![create(&root, "artifact", "artifact")], true),
    );
    let reviewed = reviews(&root, "version");
    std::fs::rename(
        root.path().join("generated/artifact"),
        root.path().join("generated/old"),
    )
    .unwrap();
    std::fs::write(root.path().join("generated/artifact"), "artifact").unwrap();
    let result = call(
        &root,
        json!({"operation":"apply","decisions":decisions(&reviewed,"delete")}),
    );
    assert_eq!(result["results"][0]["status"], "blocked");
}

#[test]
fn registered_backup_does_not_silently_measure_replacement() {
    let root = fixture();
    let mut replacement = create(&root, "replacement", "artifact");
    replacement
        .as_object_mut()
        .unwrap()
        .remove("lifecycle_role");
    replacement["retain_reason"] = json!("verified recovery copy");
    call(&root, json!({"operation":"register","item":replacement}));
    let mut backup = create(&root, "backup", "artifact");
    backup["kind"] = json!("backup");
    backup["provenance"] = json!({"superseded_by":"replacement","recovery_verified":true});
    call(&root, registration("version", vec![backup.clone()], true));
    let replacement_path = root.path().join("generated/replacement");
    let deny_replacement = |path: &Path, _: AccessMode| {
        if path == replacement_path {
            Err("replacement payload must not be read".into())
        } else {
            Ok(())
        }
    };
    let registered = dispatch(
        root.path(),
        json!({"operation":"review","group_ids":["version"]}),
        &deny_replacement,
    )
    .unwrap();
    assert!(
        registered["items"][0]["blockers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|reason| reason
                .as_str()
                .unwrap()
                .contains("explicit full verification"))
    );
    let full = call(
        &root,
        json!({"operation":"review","group_ids":["version"],"verification":"full"}),
    );
    assert!(full["items"][0]["blockers"].as_array().unwrap().is_empty());
    backup["provenance"] = json!({"recovery_completed":{"verified":true,"reason":"recovery and consumers finished","evidence_ref":"receipt:recovery-accepted"}});
    call(&root, registration("version", vec![backup], true));
    let completed = dispatch(
        root.path(),
        json!({"operation":"review","group_ids":["version"]}),
        &deny_replacement,
    )
    .unwrap();
    assert!(
        completed["items"][0]["blockers"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

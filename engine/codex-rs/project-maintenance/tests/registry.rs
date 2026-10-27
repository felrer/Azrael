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
    call(root, deletion(reviewed))
}
fn deletion(reviewed: &Value) -> Value {
    let decisions = reviewed["items"].as_array().unwrap().iter().map(|item| json!({"id":item["id"],"token":item["token"],"decision":"delete","reason":"producer completed"})).collect::<Vec<_>>();
    json!({"operation":"apply","decisions":decisions})
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
fn required_owner_catalog_structure_and_unknown_format_still_fail_closed() {
    let root = fixture();
    let mut unknown = registration(&root);
    unknown["group"]["membership_source_format"] = json!("unknown");
    assert!(dispatch(root.path(), unknown, &allow).is_err());
    std::fs::remove_file(directory(&root).join("version.json")).unwrap();
    assert!(dispatch(root.path(), registration(&root), &allow).is_err());
    write(&root, "version", &record(&root, "version"));
    call(&root, registration(&root));
    std::fs::write(directory(&root).join("invalid.json"), "not json").unwrap();
    assert!(!blocked(&review(&root)));
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
fn other_record_errors_do_not_prevent_owner_deletion() {
    for corruption in ["malformed", "missing-field", "denied", "missing"] {
        let root = fixture();
        call(&root, registration(&root));
        let other_path = directory(&root).join("other.json");
        let mut other = record(&root, "other");
        if corruption == "missing-field" {
            other.as_object_mut().unwrap().remove("members");
        }
        write(&root, "other", &other);
        if corruption == "malformed" {
            std::fs::write(&other_path, "not json").unwrap();
        }
        let denied_seen = std::sync::atomic::AtomicBool::new(false);
        let other_reads = std::sync::atomic::AtomicUsize::new(0);
        let authorize = |path: &Path, mode| {
            // Disappear after path validation, before opening the record,
            // so this covers a fresh read failure.
            if corruption == "missing"
                && path == other_path
                && mode == AccessMode::Read
                && other_reads.fetch_add(1, std::sync::atomic::Ordering::Relaxed) == 1
            {
                std::fs::remove_file(&other_path).unwrap();
            }
            if corruption == "denied" && path == other_path && mode == AccessMode::Read {
                denied_seen.store(true, std::sync::atomic::Ordering::Relaxed);
                Err("other record denied".into())
            } else {
                Ok(())
            }
        };
        let reviewed = dispatch(
            root.path(),
            json!({"operation":"review","group_ids":["version"]}),
            &authorize,
        )
        .unwrap();
        assert!(!blocked(&reviewed), "{corruption}: {reviewed}");
        let applied = dispatch(root.path(), deletion(&reviewed), &authorize).unwrap();
        assert_eq!(
            applied["groups"][0]["status"], "deleted",
            "{corruption}: {applied}"
        );
        for member in ["artifact", "log"] {
            assert!(
                !root
                    .path()
                    .join("artifacts/registry-fixtures")
                    .join(member)
                    .exists(),
                "{corruption}: {member}"
            );
        }
        if corruption == "denied" {
            assert!(denied_seen.load(std::sync::atomic::Ordering::Relaxed));
        } else if corruption == "missing" {
            assert!(!other_path.exists());
        }
    }
}

#[test]
fn valid_inbound_consumer_among_corrupt_records_still_protects_owner() {
    let root = fixture();
    call(&root, registration(&root));
    std::fs::write(directory(&root).join("malformed.json"), "not json").unwrap();
    let mut incomplete = record(&root, "incomplete");
    incomplete.as_object_mut().unwrap().remove("members");
    write(&root, "incomplete", &incomplete);
    write(&root, "denied", &record(&root, "denied"));
    let mut consumer = record(&root, "consumer");
    consumer["references"] = json!([{"id":"version","reason":"live recovery consumer"}]);
    write(&root, "consumer", &consumer);
    let denied = directory(&root).join("denied.json");
    let authorize = |path: &Path, mode| {
        if path == denied && mode == AccessMode::Read {
            Err("other record denied".into())
        } else {
            Ok(())
        }
    };
    let reviewed = dispatch(
        root.path(),
        json!({"operation":"review","group_ids":["version"]}),
        &authorize,
    )
    .unwrap();
    assert!(blocked(&reviewed));
    assert!(
        reviewed
            .to_string()
            .contains("producer inbound consumer protects group: consumer")
    );
    let applied = dispatch(root.path(), deletion(&reviewed), &authorize).unwrap();
    assert_ne!(applied["groups"][0]["status"], "deleted");
    for member in ["artifact", "log"] {
        assert!(
            root.path()
                .join("artifacts/registry-fixtures")
                .join(member)
                .exists()
        );
    }
}

#[test]
fn invalid_missing_or_denied_owner_still_blocks_deletion() {
    for corruption in ["malformed", "missing-field", "denied", "missing"] {
        let root = fixture();
        call(&root, registration(&root));
        let owner_path = directory(&root).join("version.json");
        match corruption {
            "malformed" => std::fs::write(&owner_path, "not json").unwrap(),
            "missing-field" => {
                let mut owner = record(&root, "version");
                owner.as_object_mut().unwrap().remove("members");
                write(&root, "version", &owner);
            }
            "missing" => std::fs::remove_file(&owner_path).unwrap(),
            "denied" => {}
            _ => unreachable!(),
        }
        let authorize = |path: &Path, mode| {
            if corruption == "denied" && path == owner_path && mode == AccessMode::Read {
                Err("owner record denied".into())
            } else {
                Ok(())
            }
        };
        let reviewed = dispatch(
            root.path(),
            json!({"operation":"review","group_ids":["version"]}),
            &authorize,
        )
        .unwrap();
        assert!(blocked(&reviewed), "{corruption}: {reviewed}");
        let manifest = root.path().join("artifacts/maintenance/manifest.json");
        let before = std::fs::read(&manifest).unwrap();
        match dispatch(root.path(), deletion(&reviewed), &authorize) {
            Ok(applied) => {
                assert_ne!(
                    applied["groups"][0]["status"], "deleted",
                    "{corruption}: {applied}"
                );
                assert!(
                    applied["results"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .all(|item| item["status"] != "deleted"),
                    "{corruption}: {applied}"
                );
            }
            Err(error) => {
                // Without a readable valid owner, acquisition cannot pin a
                // producer fence and refuses before publishing an active claim.
                assert_eq!(error, "reserved producer record missing", "{corruption}");
                assert!(active_reservations(&root).is_empty(), "{corruption}");
                assert_eq!(std::fs::read(&manifest).unwrap(), before, "{corruption}");
            }
        }
        for member in ["artifact", "log"] {
            assert!(
                root.path()
                    .join("artifacts/registry-fixtures")
                    .join(member)
                    .exists(),
                "{corruption}: {member}"
            );
        }
    }
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

fn stopped(outcome: &str) -> Value {
    json!({"status":"stopped","outcome":outcome,"exit_code":if outcome == "failure" { json!(7) } else if outcome == "success" { json!(0) } else { Value::Null },"reason":"verified producer stop","evidence_ref":"retained-proof","evidence_sha256":"a".repeat(64)})
}

#[test]
fn stopped_failure_is_settled_and_unknown_remains_protected() {
    for outcome in ["failure", "unknown"] {
        let root = fixture();
        let mut owner = record(&root, "version");
        owner["state"] = json!("failed");
        owner["producer"] = stopped(outcome);
        write(&root, "version", &owner);
        call(&root, registration(&root));
        assert_eq!(blocked(&review(&root)), outcome == "unknown");
        if outcome == "failure" {
            assert_eq!(
                apply(&root, &review(&root))["groups"][0]["status"],
                "deleted"
            );
        }
    }
}

#[test]
fn refresh_releases_consumers_without_payload_measurement() {
    let root = fixture();
    let mut owner = record(&root, "version");
    for member in owner["members"].as_array_mut().unwrap() {
        member["protection_known"] = json!(true);
    }
    write(&root, "version", &owner);
    let mut consumer = record(&root, "consumer");
    consumer["references"] = json!([{"id":"version","reason":"required"}]);
    write(&root, "consumer", &consumer);
    let mut request = registration(&root);
    for member in request["group"]["members"].as_array_mut().unwrap() {
        member["references"] = json!(["consumer:required"]);
        member["retain_reason"] = json!("retain diagnostic context");
    }
    let registered = call(&root, request);
    consumer["references"] = json!([]);
    write(&root, "consumer", &consumer);
    // Change payload bytes: refresh must retain the old measurement and only
    // review/apply may perform the next content observation.
    std::fs::write(
        root.path().join("artifacts/registry-fixtures/artifact"),
        "changed payload bytes",
    )
    .unwrap();
    let refreshed = call(
        &root,
        json!({"operation":"register","refresh_group":{"id":"version"}}),
    );
    for (old, new) in registered["items"]
        .as_array()
        .unwrap()
        .iter()
        .zip(refreshed["items"].as_array().unwrap())
    {
        for key in [
            "identity",
            "logical_bytes",
            "measured_at_ms",
            "registered_at_ms",
            "retain_reason",
        ] {
            assert_eq!(old[key], new[key], "{key}");
        }
        assert_eq!(new["references"], json!([]));
        assert_eq!(new["protection_known"], true);
        assert!(new["protection_revision"].is_string());
    }
    let reviewed = review(&root);
    assert!(
        !reviewed
            .to_string()
            .contains("references active or unknown")
    );
    assert!(reviewed.to_string().contains("retention reason active"));
}

#[test]
fn refresh_rejects_changed_identity_membership_and_roles() {
    for mutation in ["owner", "kind", "version", "path", "role", "extra"] {
        let root = fixture();
        call(&root, registration(&root));
        let before = call(&root, json!({"operation":"inventory"}));
        let mut owner = record(&root, "version");
        match mutation {
            "owner" => owner["owner"] = json!("different"),
            "kind" => owner["kind"] = json!("work"),
            "version" => owner["version"] = json!("v2"),
            "path" => owner["members"][0]["path"] = json!(root.path().join("artifacts/registry-fixtures/different")),
            "role" => owner["members"][0]["role"] = json!("evidence"),
            "extra" => owner["members"].as_array_mut().unwrap().push(json!({"path":root.path().join("artifacts/registry-fixtures/extra"),"role":"artifact"})),
            _ => unreachable!(),
        }
        write(&root, "version", &owner);
        assert!(
            dispatch(
                root.path(),
                json!({"operation":"register","refresh_group":{"id":"version"}}),
                &allow
            )
            .is_err(),
            "{mutation}"
        );
        let after = call(&root, json!({"operation":"inventory"}));
        assert_eq!(before["items"], after["items"]);
        assert_eq!(before["groups"], after["groups"]);
    }
}

#[test]
fn refresh_preserves_explicit_unknown_ownership_and_pending_producer() {
    let root = fixture();
    let mut request = registration(&root);
    request["group"]["members"][0]["generated"] = json!(false);
    call(&root, request);
    let manifest_path = root.path().join("artifacts/maintenance/manifest.json");
    let mut manifest: Value =
        serde_json::from_slice(&std::fs::read(&manifest_path).unwrap()).unwrap();
    manifest["items"]["artifact"]["cleanup_status"] = json!("pending");
    manifest["groups"]["version"]["cleanup_status"] = json!("pending");
    std::fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let mut owner = record(&root, "version");
    owner["state"] = json!("pending");
    owner["producer"] = stopped("unknown");
    for member in owner["members"].as_array_mut().unwrap() {
        member["generated"] = json!(true);
        member["protection_known"] = json!(true);
    }
    write(&root, "version", &owner);
    let refreshed = call(
        &root,
        json!({"operation":"register","refresh_group":{"id":"version"}}),
    );
    assert_eq!(refreshed["items"][0]["generated"], false);
    assert_eq!(refreshed["items"][0]["cleanup_status"], "pending");
    assert_eq!(refreshed["group"]["cleanup_status"], "pending");
    assert_eq!(refreshed["group"]["membership_complete"], false);
    assert!(blocked(&review(&root)));
}

#[test]
fn catalog_contention_blocks_mutation_and_apply_reserves_group_between_transactions() {
    use std::cell::Cell;
    let root = fixture();
    call(&root, registration(&root));
    let reviewed = review(&root);
    let lock = directory(&root).join("catalog.lock");
    std::fs::write(&lock, "writer").unwrap();
    assert!(
        dispatch(
            root.path(),
            json!({"operation":"register","refresh_group":{"id":"version"}}),
            &allow
        )
        .is_err()
    );
    let decisions = reviewed["items"].as_array().unwrap().iter().map(|item|
        json!({"id":item["id"],"token":item["token"],"decision":"delete","reason":"settled"})).collect::<Vec<_>>();
    let request = json!({"operation":"apply","decisions":decisions});
    assert!(dispatch(root.path(), request.clone(), &allow).is_err());
    std::fs::remove_file(&lock).unwrap();
    let contended = Cell::new(false);
    let owner_path = directory(&root).join("version.json");
    let authorize = |path: &Path, mode| {
        if path == owner_path && mode == AccessMode::Read {
            assert!(
                std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&lock)
                    .is_err()
            );
            contended.set(true);
        }
        if contended.get() && mode == AccessMode::Write && path.ends_with("manifest.pending") {
            assert_eq!(active_reservations(&root).len(), 1);
            let transaction = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&lock)
                .unwrap();
            transaction
                .try_lock()
                .expect("physical apply must release global catalog protection");
        }
        Ok(())
    };
    let result = dispatch(root.path(), request, &authorize).unwrap();
    assert_eq!(result["groups"][0]["status"], "deleted");
    assert!(contended.get());
    let metadata: Value = serde_json::from_slice(&std::fs::read(&lock).unwrap()).unwrap();
    assert_eq!(metadata["schema"], 2);
    let released = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&lock)
        .unwrap();
    released.try_lock().unwrap();
    assert!(active_reservations(&root).is_empty());
}

fn active_reservations(root: &TempDir) -> Vec<std::path::PathBuf> {
    let directory = directory(root).join("reservations");
    if !directory.exists() {
        return Vec::new();
    }
    std::fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect()
}

#[test]
fn registration_releases_global_locks_but_fences_scope_and_merges_unrelated_work() {
    use std::cell::Cell;
    let root = fixture();
    let injected = Cell::new(false);
    let artifact = root.path().join("artifacts/registry-fixtures/artifact");
    let independent = root.path().join("artifacts/registry-fixtures/independent");
    std::fs::write(&independent, "independent").unwrap();
    let authorize = |path: &Path, mode| {
        if path == artifact
            && mode == AccessMode::Read
            && !injected.get()
            && !active_reservations(&root).is_empty()
        {
            let available = [
                root.path().join("artifacts/maintenance/maintenance.lock"),
                directory(&root).join("catalog.lock"),
            ]
            .iter()
            .all(|path| {
                let file = std::fs::OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(path)
                    .unwrap();
                file.try_lock().is_ok()
            });
            if available {
                injected.set(true);
                let item = json!({"id":"independent","path":independent,"kind":"artifact","owner":"other","generated":true,"protection_known":true,"references":[]});
                call(&root, json!({"operation":"register","item":item}));
                for (id, path) in [
                    ("overlap", artifact.clone()),
                    ("artifact", independent.clone()),
                ] {
                    assert!(dispatch(root.path(), json!({"operation":"register","item":{"id":id,"path":path,"kind":"artifact","owner":"other","generated":true,"protection_known":true,"references":[]}}), &allow).is_err());
                }
                assert!(dispatch(root.path(), registration(&root), &allow).is_err());
                let reviewed = call(&root, json!({"operation":"review","ids":["independent"]}));
                let outcome = call(
                    &root,
                    json!({"operation":"apply","decisions":[{"id":"independent","token":reviewed["items"][0]["token"],"decision":"defer","reason":"active independent work","revisit_condition":"consumer completes"}]}),
                );
                assert_eq!(outcome["results"][0]["status"], "deferred");
            }
        }
        Ok(())
    };
    let result = dispatch(root.path(), registration(&root), &authorize).unwrap();
    assert!(
        injected.get(),
        "independent work executes during payload measurement"
    );
    assert_eq!(result["group"]["id"], "version");
    let durable: Value = serde_json::from_slice(
        &std::fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        durable["items"]["independent"]["cleanup_status"],
        "deferred"
    );
    assert_eq!(durable["groups"]["version"]["owner"], "test");
    assert!(
        durable["decisions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["id"] == "independent" && entry["status"] == "deferred")
    );
    assert!(active_reservations(&root).is_empty());
}

#[test]
fn registration_rejects_changed_producer_fence_without_publishing_partial_state() {
    use std::cell::Cell;
    let root = fixture();
    let changed = Cell::new(false);
    let artifact = root.path().join("artifacts/registry-fixtures/artifact");
    let authorize = |path: &Path, mode| {
        if path == artifact
            && mode == AccessMode::Read
            && !changed.get()
            && !active_reservations(&root).is_empty()
        {
            let maintenance = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(root.path().join("artifacts/maintenance/maintenance.lock"))
                .unwrap();
            if maintenance.try_lock().is_ok() {
                changed.set(true);
                let mut consumer = record(&root, "new-consumer");
                consumer["references"] =
                    json!([{"id":"version","reason":"new inbound dependency"}]);
                write(&root, "new-consumer", &consumer);
            }
        }
        Ok(())
    };
    assert!(dispatch(root.path(), registration(&root), &authorize).is_err());
    assert!(changed.get());
    assert!(artifact.exists());
    let manifest = root.path().join("artifacts/maintenance/manifest.json");
    if manifest.exists() {
        let state: Value = serde_json::from_slice(&std::fs::read(manifest).unwrap()).unwrap();
        assert!(state["groups"].get("version").is_none());
    }
    assert!(
        !active_reservations(&root).is_empty(),
        "uncertain source mutation remains explicitly recoverable"
    );
}

#[test]
fn cancelled_registration_releases_its_scope_without_committing() {
    use std::cell::Cell;
    let root = fixture();
    let cancelled = Cell::new(false);
    let artifact = root.path().join("artifacts/registry-fixtures/artifact");
    let authorize = |path: &Path, mode| {
        if path == artifact && mode == AccessMode::Read && !active_reservations(&root).is_empty() {
            let maintenance = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(root.path().join("artifacts/maintenance/maintenance.lock"))
                .unwrap();
            if maintenance.try_lock().is_ok() {
                cancelled.set(true);
            }
        }
        Ok(())
    };
    let error = azrael_project_maintenance::dispatch_with_cancellation(
        root.path(),
        registration(&root),
        &authorize,
        &|| cancelled.get(),
    )
    .unwrap_err();
    assert!(error.contains("cancelled"));
    assert!(cancelled.get());
    assert!(active_reservations(&root).is_empty());
    assert!(artifact.exists());
    assert!(
        call(&root, json!({"operation":"inventory"}))["items"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    call(&root, registration(&root));
}

#[test]
fn registration_source_switch_locks_both_original_and_incoming_catalogs_at_commit() {
    use std::cell::Cell;
    let root = fixture();
    let original = root.path().join("artifacts/catalog-original");
    let incoming = root.path().join("artifacts/catalog-incoming");
    for source in [&original, &incoming] {
        std::fs::create_dir(source).unwrap();
        std::fs::write(
            source.join("version.json"),
            serde_json::to_vec(&record(&root, "version")).unwrap(),
        )
        .unwrap();
    }
    let mut first = registration(&root);
    first["group"]["membership_source"] = json!(original);
    call(&root, first);
    let mut next = registration(&root);
    next["group"]["membership_source"] = json!(incoming);
    let measured = Cell::new(false);
    let checked_commit = Cell::new(false);
    let artifact = root.path().join("artifacts/registry-fixtures/artifact");
    let owner = incoming.join("version.json");
    let authorize = |path: &Path, mode| {
        if mode == AccessMode::Read && !active_reservations(&root).is_empty() {
            let maintenance = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(root.path().join("artifacts/maintenance/maintenance.lock"))
                .unwrap();
            let outside_transaction = maintenance.try_lock().is_ok();
            if path == artifact && outside_transaction {
                measured.set(true);
            }
            if path == owner && measured.get() && !outside_transaction {
                for source in [&original, &incoming] {
                    let catalog = std::fs::OpenOptions::new()
                        .read(true)
                        .write(true)
                        .open(source.join("catalog.lock"))
                        .unwrap();
                    assert!(
                        catalog.try_lock().is_err(),
                        "both source catalogs must be locked at commit"
                    );
                }
                checked_commit.set(true);
            }
        }
        Ok(())
    };
    let result = dispatch(root.path(), next, &authorize).unwrap();
    assert!(measured.get());
    assert!(checked_commit.get());
    assert_eq!(result["group"]["membership_source"], json!(incoming));
    assert!(active_reservations(&root).is_empty());
}

#[test]
fn reserved_apply_merges_unrelated_registration_and_deferred_receipt() {
    use std::cell::Cell;
    let root = fixture();
    call(&root, registration(&root));
    let initial = review(&root);
    let injected = Cell::new(false);
    let owner_path = directory(&root).join("version.json");
    let maintenance = root.path().join("artifacts/maintenance/maintenance.lock");
    let authorize = |path: &Path, mode| {
        if path == owner_path
            && mode == AccessMode::Read
            && !injected.get()
            && !active_reservations(&root).is_empty()
        {
            let probe = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&maintenance);
            let available = probe.as_ref().is_ok_and(|file| file.try_lock().is_ok());
            drop(probe);
            if available {
                injected.set(true);
                std::fs::write(
                    root.path().join("artifacts/registry-fixtures/independent"),
                    "other producer",
                )
                .unwrap();
                call(
                    &root,
                    json!({"operation":"register","item":{"id":"independent","path":"artifacts/registry-fixtures/independent","kind":"artifact","owner":"other","generated":true,"protection_known":true,"references":[]}}),
                );
                let separate = call(&root, json!({"operation":"review","ids":["independent"]}));
                let result = call(
                    &root,
                    json!({"operation":"apply","decisions":[{"id":"independent","token":separate["items"][0]["token"],"decision":"defer","reason":"other owner still needs it","revisit_condition":"other owner finishes"}]}),
                );
                assert_eq!(result["results"][0]["status"], "deferred");
            }
        }
        Ok(())
    };
    let result = dispatch(root.path(), deletion(&initial), &authorize).unwrap();
    assert!(
        injected.get(),
        "independent writer must execute while outer reservation is live"
    );
    assert_eq!(result["groups"][0]["status"], "deleted");
    let durable: Value = serde_json::from_slice(
        &std::fs::read(root.path().join("artifacts/maintenance/manifest.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(durable["items"]["independent"]["owner"], "other");
    assert_eq!(
        durable["items"]["independent"]["cleanup_status"],
        "deferred"
    );
    let receipts = durable["decisions"].as_array().unwrap();
    assert_eq!(receipts.len(), 3);
    assert_eq!(receipts[0]["id"], "independent");
    assert_eq!(receipts[0]["status"], "deferred");
    for id in ["artifact", "log"] {
        let receipt = receipts.iter().find(|receipt| receipt["id"] == id).unwrap();
        assert_eq!(receipt["status"], "deleted");
        assert_eq!(durable["items"][id]["cleanup_status"], "deleted");
    }
    let ids = receipts
        .iter()
        .map(|receipt| receipt["decision_id"].as_str().unwrap())
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        ids.len(),
        3,
        "receipt identities survive concurrent append reordering"
    );
    assert!(active_reservations(&root).is_empty());
}

#[test]
fn producer_fence_change_after_intent_preserves_payload_and_reservation() {
    use std::cell::Cell;
    let root = fixture();
    call(&root, registration(&root));
    let initial = review(&root);
    let changed = Cell::new(false);
    let owner_path = directory(&root).join("version.json");
    let manifest = root.path().join("artifacts/maintenance/manifest.json");
    let authorize = |path: &Path, mode| {
        if path == owner_path && mode == AccessMode::Read && !changed.get() {
            let state: Value = serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
            if state["decisions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|decision| decision["status"] == "pending")
            {
                changed.set(true);
                let mut owner = record(&root, "version");
                owner["revision"] = json!(9);
                write(&root, "version", &owner);
            }
        }
        Ok(())
    };
    assert!(dispatch(root.path(), deletion(&initial), &authorize).is_err());
    assert!(
        changed.get(),
        "fault must occur after a durable deletion intent"
    );
    for name in ["artifact", "log"] {
        assert!(
            root.path()
                .join("artifacts/registry-fixtures")
                .join(name)
                .exists()
        );
    }
    assert_eq!(active_reservations(&root).len(), 1);
    let durable: Value = serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
    assert!(
        durable["decisions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|decision| matches!(decision["status"].as_str(), Some("pending" | "blocked")))
    );
    assert!(
        durable["decisions"]
            .as_array()
            .unwrap()
            .iter()
            .all(|decision| decision["status"] != "deleted")
    );
    assert!(
        dispatch(
            root.path(),
            json!({"operation":"review","group_ids":["version"]}),
            &allow
        )
        .is_err()
    );
}

#[test]
fn malformed_producer_evidence_is_rejected() {
    for mutation in ["status", "exit", "digest", "reason", "null"] {
        let root = fixture();
        let mut owner = record(&root, "version");
        owner["producer"] = stopped("failure");
        match mutation {
            "status" => owner["producer"]["status"] = json!("running"),
            "exit" => owner["producer"]["exit_code"] = json!(0),
            "digest" => owner["producer"]["evidence_sha256"] = json!("bad"),
            "reason" => owner["producer"]["reason"] = json!(" "),
            "null" => owner["producer"] = Value::Null,
            _ => unreachable!(),
        }
        write(&root, "version", &owner);
        assert!(
            dispatch(root.path(), registration(&root), &allow).is_err(),
            "{mutation}"
        );
    }
}

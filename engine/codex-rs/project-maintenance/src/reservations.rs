//! Durable cohort fences outlive the OS lease: interrupted deletion is protected.
use crate::{AccessMode, Auth, State, hash, paths, string};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub(crate) const MAX_RESERVATION_BYTES: usize = 64 * 1024 * 1024;

fn directory(root: &Path) -> PathBuf {
    root.join("artifacts/maintenance/lifecycles/reservations")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn producer_release_fixture(
        ids: &[&str],
    ) -> (tempfile::TempDir, Vec<Value>, Vec<Value>, Value) {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("artifacts/maintenance/lifecycles");
        fs::create_dir_all(&source).unwrap();
        let mut records = Vec::new();
        let mut outcomes = Vec::new();
        for id in ids {
            let payload = root.path().join(format!("artifacts/{id}-payload"));
            fs::write(&payload, "payload").unwrap();
            let record = json!({"schema":1,"id":id,"owner":"producer","kind":"work","state":"complete","membership_complete":true,
                "members":[{"path":payload,"role":"artifact","generated":true,"protection_known":true}],"references":[]});
            fs::write(
                source.join(format!("{id}.json")),
                serde_json::to_vec(&record).unwrap(),
            )
            .unwrap();
            records.push(record);
            outcomes.push(json!({"id":id,"status":"deferred","members":[{"path":payload,"status":"deferred","remaining":true}]}));
        }
        let evidence = write_release_evidence(root.path(), &outcomes);
        (root, records, outcomes, evidence)
    }

    fn write_release_evidence(root: &Path, outcomes: &[Value]) -> Value {
        use sha2::{Digest, Sha256};
        let path = root.join("artifacts/terminal-evidence.json");
        let bytes = serde_json::to_vec(&json!({"outcomes":outcomes})).unwrap();
        fs::write(&path, &bytes).unwrap();
        json!({"evidence_ref":path,"evidence_sha256":format!("{:x}", Sha256::digest(&bytes))})
    }

    #[test]
    fn producer_release_keeps_unknown_and_incomplete_groups_while_releasing_terminal_peers() {
        let (root, records, mut outcomes, _) = producer_release_fixture(&["a", "b", "c", "d"]);
        outcomes[1]["status"] = json!("unknown");
        outcomes[2]["members"][0]["remaining"] = Value::Null;
        // Exercise actual absence as well as a terminal outcome retaining payload.
        fs::remove_file(records[0]["members"][0]["path"].as_str().unwrap()).unwrap();
        outcomes[0]["status"] = json!("deleted");
        outcomes[0]["members"][0]["status"] = json!("deleted");
        outcomes[0]["members"][0]["remaining"] = json!(false);
        let evidence = write_release_evidence(root.path(), &outcomes);
        let allow = |_: &Path, _: AccessMode| Ok(());
        let context = crate::Context::new(&allow);
        let mut set = ReservationSet::acquire_producers(root.path(), &records, &context).unwrap();
        let original = set.records.clone();
        set.release_producers(&outcomes, &evidence, &context)
            .unwrap();
        for (id, retained) in [("a", false), ("b", true), ("c", true), ("d", false)] {
            let path = filename(root.path(), id).unwrap();
            assert_eq!(path.exists(), retained, "{id}");
            assert_eq!(
                context.reservations.borrow().contains_key(id),
                retained,
                "{id}"
            );
            let receipt = path.with_extension(format!(
                "{}.terminal",
                hash(&original[id]["token"]).unwrap()
            ));
            assert_eq!(receipt.exists(), !retained, "{id}");
            if !retained {
                let receipt: Value = serde_json::from_slice(&fs::read(receipt).unwrap()).unwrap();
                assert_eq!(receipt["reservation"], original[id]);
                assert_eq!(receipt["evidence"], evidence);
            }
        }
        set.verify(&context).unwrap();
    }

    #[test]
    fn later_producer_fence_change_preserves_only_the_affected_unreleased_group() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let (root, records, outcomes, evidence) = producer_release_fixture(&["a", "b"]);
        let first_prefix = format!("{}.", hash(&"a").unwrap());
        let source = root.path().join("artifacts/maintenance/lifecycles/b.json");
        let mut changed = records[1].clone();
        changed["owner"] = json!("changed owner");
        let injected = AtomicBool::new(false);
        let authorize = |path: &Path, mode: AccessMode| {
            if mode == AccessMode::Write
                && path.extension().and_then(|s| s.to_str()) == Some("terminal")
                && path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with(&first_prefix)
                && !injected.swap(true, Ordering::SeqCst)
            {
                fs::write(&source, serde_json::to_vec(&changed).unwrap()).unwrap();
            }
            Ok(())
        };
        let context = crate::Context::new(&authorize);
        let mut set = ReservationSet::acquire_producers(root.path(), &records, &context).unwrap();
        let error = set
            .release_producers(&outcomes, &evidence, &context)
            .unwrap_err();
        assert!(injected.load(Ordering::SeqCst));
        assert!(error.contains("fence changed"), "{error}");
        assert!(!filename(root.path(), "a").unwrap().exists());
        assert!(filename(root.path(), "b").unwrap().exists());
        assert!(!context.reservations.borrow().contains_key("a"));
        assert!(context.reservations.borrow().contains_key("b"));
    }

    #[test]
    fn producer_release_rechecks_current_owner_guards_after_terminal_receipt() {
        use std::sync::atomic::{AtomicBool, Ordering};
        for guard in ["record", "source", "evidence", "permission", "lease"] {
            let (root, records, outcomes, evidence) = producer_release_fixture(&["owner"]);
            let reservation = filename(root.path(), "owner").unwrap();
            let source = root
                .path()
                .join("artifacts/maintenance/lifecycles/owner.json");
            let evidence_path = Path::new(evidence["evidence_ref"].as_str().unwrap());
            let injected = AtomicBool::new(false);
            let authorize = |path: &Path, mode: AccessMode| {
                if mode == AccessMode::Write
                    && path.extension().and_then(|s| s.to_str()) == Some("terminal")
                    && !injected.swap(true, Ordering::SeqCst)
                {
                    match guard {
                        "record" => {
                            let mut record: Value =
                                serde_json::from_slice(&fs::read(&reservation).unwrap()).unwrap();
                            record["token"] = json!("changed token");
                            fs::write(&reservation, serde_json::to_vec(&record).unwrap()).unwrap();
                        }
                        "source" => {
                            let mut record = records[0].clone();
                            record["owner"] = json!("changed owner");
                            fs::write(&source, serde_json::to_vec(&record).unwrap()).unwrap();
                        }
                        "evidence" => fs::write(evidence_path, "changed evidence").unwrap(),
                        _ => {}
                    }
                }
                if injected.load(Ordering::SeqCst)
                    && ((guard == "permission" && path == reservation && mode == AccessMode::Write)
                        || (guard == "lease"
                            && path == reservation.with_extension("lock")
                            && mode == AccessMode::Read))
                {
                    return Err(format!("{guard} authorization revoked"));
                }
                Ok(())
            };
            let context = crate::Context::new(&authorize);
            let mut set =
                ReservationSet::acquire_producers(root.path(), &records, &context).unwrap();
            assert!(
                set.release_producers(&outcomes, &evidence, &context)
                    .is_err(),
                "{guard}"
            );
            assert!(injected.load(Ordering::SeqCst), "{guard}");
            assert!(reservation.exists(), "{guard}");
            assert!(
                context.reservations.borrow().contains_key("owner"),
                "{guard}"
            );
        }
    }

    #[test]
    fn interrupted_reservation_blocks_new_consumers_and_overlapping_owners() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory(root.path())).unwrap();
        let payload = root.path().join("artifacts/payload");
        let mut state = State::default();
        state.groups.insert(
            "owner".into(),
            json!({"id":"owner","owner":"producer","kind":"work","members":["payload"]}),
        );
        state.items.insert(
            "payload".into(),
            json!({"id":"payload","owner":"producer","path":payload,"lifecycle_group_id":"owner"}),
        );
        let allow = |_: &Path, _: AccessMode| Ok(());
        let context = crate::Context::new(&allow);
        let request = json!({"decisions":[{"id":"payload"}]});
        let reservations =
            ReservationSet::acquire(root.path(), &request, &state, &context).unwrap();
        assert!(check_group(root.path(), "owner", &context).is_ok());
        let competing = crate::Context::new(&allow);
        assert!(check_group(root.path(), "owner", &competing).is_err());
        assert!(check_record_mutation(root.path(),"consumer",Some(&json!({"members":[],"references":[{"id":"owner","reason":"new use","member_paths":[payload]}]})),&competing).is_err());
        assert!(
            check_record_mutation(
                root.path(),
                "new-owner",
                Some(&json!({"members":[{"path":payload.join("nested")}],"references":[]})),
                &competing
            )
            .is_err()
        );
        assert!(check_record_mutation(root.path(),"unrelated",Some(&json!({"members":[{"path":root.path().join("artifacts/other")}],"references":[]})),&competing).is_ok());
        drop(reservations);
        assert!(filename(root.path(), "owner").unwrap().exists());
        assert!(ReservationSet::acquire(root.path(), &request, &state, &competing).is_err());
    }

    #[test]
    fn owning_context_revalidates_producer_fence_before_reusing_reservation() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("artifacts/maintenance/lifecycles");
        fs::create_dir_all(&source).unwrap();
        let payload = root.path().join("artifacts/payload");
        fs::write(&payload, "payload").unwrap();
        let record = json!({"schema":1,"id":"owner","owner":"producer","kind":"work","state":"complete","membership_complete":true,
            "members":[{"path":payload,"role":"artifact","generated":true,"protection_known":true}],"references":[]});
        let owner = source.join("owner.json");
        fs::write(&owner, serde_json::to_vec(&record).unwrap()).unwrap();
        let allow = |_: &Path, _: AccessMode| Ok(());
        let context = crate::Context::new(&allow);
        let set =
            ReservationSet::acquire_producers(root.path(), &[record.clone()], &context).unwrap();
        set.verify(&context).unwrap();
        let mut changed = record;
        changed["owner"] = json!("different owner");
        fs::write(&owner, serde_json::to_vec(&changed).unwrap()).unwrap();
        assert!(set.verify(&context).unwrap_err().contains("fence changed"));
        assert!(filename(root.path(), "owner").unwrap().exists());
    }

    #[test]
    fn nested_pair_acquisition_does_not_exempt_catalog_writer_claims() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory(root.path())).unwrap();
        let mut state = State::default();
        for (id, path) in [
            ("parent", "artifacts/outer"),
            ("child", "artifacts/outer/inner"),
        ] {
            state.groups.insert(
                id.into(),
                json!({"id":id,"owner":"producer","kind":"work","members":[id]}),
            );
            state.items.insert(id.into(), json!({"id":id,"owner":"producer","path":root.path().join(path),"lifecycle_group_id":id}));
        }
        let descriptor = json!({"parent":"parent","child":"child","owner":"producer","reason":"retire child","evidence_ref":"evidence"});
        let allow = |_: &Path, _: AccessMode| Ok(());
        let context = crate::Context::new(&allow);
        // Entry-point integration tests validate descriptor authority and fates;
        // this unit exercises the subsequent acquisition/writer distinction.
        *context.nested_retirement.borrow_mut() =
            Some(serde_json::from_value(descriptor.clone()).unwrap());
        let request = json!({"decisions":[{"id":"parent","decision":"defer"},{"id":"child","decision":"delete"}]});
        let set = ReservationSet::acquire(root.path(), &request, &state, &context).unwrap();
        assert_eq!(set.observed().len(), 2);
        assert!(
            check_record_mutation(
                root.path(),
                "new-claim",
                Some(&json!({"members":[state.items["parent"]],"references":[]})),
                &context
            )
            .is_err()
        );
        let competing = crate::Context::new(&allow);
        *competing.nested_retirement.borrow_mut() =
            Some(serde_json::from_value(descriptor).unwrap());
        assert!(ReservationSet::acquire(root.path(), &request, &state, &competing).is_err());
        set.verify(&context).unwrap();
    }
}
fn filename(root: &Path, id: &str) -> Result<PathBuf, String> {
    Ok(directory(root).join(format!("{}.json", hash(&id)?)))
}
fn read_bytes(root: &Path, path: &Path, auth: Auth<'_>) -> Result<Vec<u8>, String> {
    let metadata = paths::checked_metadata(root, path, auth)?.ok_or("reservation disappeared")?;
    if !metadata.is_file() || metadata.len() > MAX_RESERVATION_BYTES as u64 {
        return Err("invalid reservation file".into());
    }
    auth(path, AccessMode::Read)?;
    let bounded_read = || -> Result<Vec<u8>, String> {
        let mut bytes = Vec::new();
        fs::File::open(path)
            .map_err(|e| e.to_string())?
            .take(MAX_RESERVATION_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > MAX_RESERVATION_BYTES {
            return Err("reservation exceeds 64 MiB bound".into());
        }
        Ok(bytes)
    };
    let bytes = bounded_read()?;
    paths::check(root, path, auth)?;
    auth(path, AccessMode::Read)?;
    if bounded_read()? != bytes {
        return Err("reservation changed during observation".into());
    }
    let after = paths::checked_metadata(root, path, auth)?.ok_or("reservation disappeared")?;
    if paths::platform_identity(&metadata) != paths::platform_identity(&after)
        || metadata.len() != after.len()
    {
        return Err("reservation file identity changed".into());
    }
    Ok(bytes)
}
fn read(root: &Path, path: &Path, auth: Auth<'_>) -> Result<Value, String> {
    let value: Value = serde_json::from_slice(&read_bytes(root, path, auth)?)
        .map_err(|e| format!("reservation requires recovery: {e}"))?;
    if value["schema"] != 1 || !value["members"].is_array() {
        return Err("invalid reservation requires recovery".into());
    }
    string(&value, "id")?;
    string(&value, "token")?;
    Ok(value)
}
fn records(root: &Path, auth: Auth<'_>) -> Result<Vec<Value>, String> {
    let dir = directory(root);
    if paths::checked_metadata(root, &dir, auth)?.is_none() {
        return Ok(Vec::new());
    }
    auth(&dir, AccessMode::Read)?;
    let mut result = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            let record = read(root, &path, auth)?;
            if filename(root, string(&record, "id")?)? != path {
                return Err("reservation identity/path mismatch".into());
            }
            result.push(record);
        }
    }
    Ok(result)
}
fn scope(group: &Value) -> Value {
    json!({"id":group["id"],"owner":group["owner"],"kind":group["kind"],
        "version":group["version"],"members":group["members"],
        "membership_source":group["membership_source"],
        "membership_source_identity":group["membership_source_identity"]})
}
fn owned(record: &Value, auth: Auth<'_>) -> bool {
    record["id"]
        .as_str()
        .is_some_and(|id| auth.reservations.borrow().get(id) == Some(record))
}

fn source_bindings(record: &Value) -> Result<Vec<&Value>, String> {
    let mut bindings = Vec::new();
    if record["source"].is_string() {
        bindings.push(record);
    }
    if record["purpose"] == "registration" {
        for binding in record["registration_sources"]
            .as_array()
            .ok_or("invalid registration source bindings")?
        {
            string(binding, "source")?;
            if !binding["source_fence"].is_string() || !binding["source_owner"].is_object() {
                return Err("invalid registration source fence".into());
            }
            bindings.push(binding);
        }
    }
    Ok(bindings)
}

fn verify_sources(root: &Path, record: &Value, auth: Auth<'_>) -> Result<(), String> {
    let id = string(record, "id")?;
    for binding in source_bindings(record)? {
        let source = paths::resolve(root, Path::new(string(binding, "source")?))?;
        if crate::registry::reservation_fence(root, &source, id, auth)? != binding["source_fence"] {
            return Err("reserved producer fence changed".into());
        }
        if record["purpose"] == "registration"
            && crate::registry::producer_records(root, &source, id, auth)?.get(id)
                != Some(&binding["source_owner"])
        {
            return Err("reserved registration producer owner changed".into());
        }
    }
    Ok(())
}

/// Explicit recovery releases only the reservation, never a pending receipt or
/// an unknown execution outcome. Absence of an OS owner is necessary, not proof.
pub(crate) fn recover(root: &Path, request: &Value, auth: Auth<'_>) -> Result<Value, String> {
    use sha2::{Digest, Sha256};
    let id = string(request, "id")?;
    if request["producer_stopped_verified"] != true {
        return Err("independent exact producer/process-tree stop verification required".into());
    }
    string(request, "reason")?;
    let path = filename(root, id)?;
    let bytes = read_bytes(root, &path, auth)?;
    let original_metadata =
        paths::checked_metadata(root, &path, auth)?.ok_or("reservation disappeared")?;
    let original_identity = paths::platform_identity(&original_metadata);
    let parsed = serde_json::from_slice::<Value>(&bytes)
        .ok()
        .filter(|record| {
            record["schema"] == 1
                && record["members"].is_array()
                && record["id"].as_str().is_some()
                && record["token"].as_str().is_some()
        });
    if parsed.as_ref().is_some_and(|record| record["id"] != id) {
        return Err("reservation recovery ID mismatch".into());
    }
    let before = if let Some(record) = &parsed {
        record.clone()
    } else {
        if !request["fence"].is_null() {
            return Err("malformed recovery requires fence:null".into());
        }
        let owner_path = path.with_extension("lock");
        let owner: Value = serde_json::from_slice(&read_bytes(root, &owner_path, auth)?)
            .map_err(|_| "malformed stable group lease owner")?;
        if owner["schema"] != 2
            || request["lease_owner"] != owner
            || request["token"] != owner["token"]
        {
            return Err(
                "malformed reservation recovery requires exact original stable lease owner".into(),
            );
        }
        json!({"id":id,"lease_owner":owner,"token":owner["token"],"members":[]})
    };
    let raw_hash = format!("{:x}", Sha256::digest(&bytes));
    if string(request, "expected_sha256")? != raw_hash
        || (parsed.is_some() && request["fence"] != before)
        || request["token"] != before["token"]
    {
        return Err("reservation recovery SHA/token/fence mismatch".into());
    }
    let pid = before["lease_owner"]["pid"]
        .as_u64()
        .and_then(|pid| u32::try_from(pid).ok())
        .filter(|pid| *pid > 0)
        .ok_or("reservation owner PID unavailable")?;
    crate::lock_recovery::owner_absent(pid)?;
    let _maintenance = crate::lock_recovery::Sentinel::acquire(
        root,
        &root.join("artifacts/maintenance/maintenance.lock"),
        "reservation_recovery",
        auth,
    )?;
    let pending = root.join("artifacts/maintenance/manifest.pending");
    if paths::checked_metadata(root, &pending, auth)?.is_some() {
        return Err("pending state requires independent recovery".into());
    }
    let mut sources = BTreeSet::from([root.join("artifacts/maintenance/lifecycles")]);
    for binding in source_bindings(&before)? {
        sources.insert(paths::resolve(root, Path::new(string(binding, "source")?))?);
    }
    let mut catalogs = Vec::new();
    for source in &sources {
        let catalog = source.join("catalog.lock");
        let lease =
            crate::lock_recovery::Sentinel::acquire(root, &catalog, "reservation_recovery", auth)?;
        auth.catalog_locks.borrow_mut().insert(catalog.clone());
        catalogs.push((catalog, lease));
    }
    // Always remove request-local markings, including on a failed observation.
    let result = (|| -> Result<Value, String> {
        if parsed.is_none() {
            let current_owner: Value =
                serde_json::from_slice(&read_bytes(root, &path.with_extension("lock"), auth)?)
                    .map_err(|_| "stable lease owner changed")?;
            if current_owner != before["lease_owner"] {
                return Err("original stable lease owner changed before malformed recovery".into());
            }
        }
        let lease = crate::lock_recovery::Sentinel::acquire(
            root,
            &path.with_extension("lock"),
            "reservation_recovery",
            auth,
        )?;
        crate::lock_recovery::owner_absent(pid)?;
        if read_bytes(root, &path, auth)? != bytes {
            return Err("reservation changed before recovery".into());
        }
        verify_sources(root, &before, auth)?;
        let evidence_path = paths::resolve(root, Path::new(string(request, "evidence_ref")?))?;
        for member in before["members"]
            .as_array()
            .ok_or("invalid reservation members")?
        {
            if paths::within(&evidence_path, Path::new(string(member, "path")?)) {
                return Err("recovery evidence overlaps reserved payload".into());
            }
        }
        let evidence_meta = paths::checked_metadata(root, &evidence_path, auth)?
            .ok_or("recovery evidence missing")?;
        if !evidence_meta.is_file() || evidence_meta.len() > 16 * 1024 * 1024 {
            return Err("recovery requires bounded plain evidence".into());
        }
        auth(&evidence_path, AccessMode::Read)?;
        let evidence_bytes = fs::read(&evidence_path).map_err(|e| e.to_string())?;
        if string(request, "evidence_sha256")? != format!("{:x}", Sha256::digest(&evidence_bytes)) {
            return Err("recovery evidence SHA mismatch".into());
        }
        let proof: Value = serde_json::from_slice(&evidence_bytes).map_err(|e| e.to_string())?;
        if proof["producer_stopped_verified"] != true
            || proof["process_tree_stopped_verified"] != true
            || proof["reservation_sha256"] != raw_hash
            || proof["lease_owner"] != before["lease_owner"]
            || proof["id"] != id
        {
            return Err(
                "evidence must bind the exact reservation owner and stopped process tree".into(),
            );
        }
        let receipt = path.with_extension(format!("{}.recovered", hash(&before["token"])?));
        let result = json!({"id":id,"status":"reservation_recovered","prior_reservation":parsed,"malformed_publication":parsed.is_none(),"lease_owner":before["lease_owner"],"prior_bytes":if parsed.is_none(){json!(bytes)}else{Value::Null},"reservation_sha256":raw_hash,
            "reason":request["reason"],"evidence_ref":evidence_path,"evidence_sha256":request["evidence_sha256"],
            "execution_outcome_changed":false,"pending_intents_changed":false});
        paths::check(root, &receipt, auth)?;
        auth(&receipt, AccessMode::Write)?;
        auth(
            receipt.parent().ok_or("missing recovery receipt parent")?,
            AccessMode::Write,
        )?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&receipt)
            .map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec(&result).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        lease.verify()?;
        for (_, catalog) in &catalogs {
            catalog.verify()?;
        }
        paths::check(root, &evidence_path, auth)?;
        auth(&evidence_path, AccessMode::Read)?;
        let current_metadata =
            paths::checked_metadata(root, &path, auth)?.ok_or("reservation disappeared")?;
        if fs::read(&evidence_path).map_err(|e| e.to_string())? != evidence_bytes
            || read_bytes(root, &path, auth)? != bytes
            || paths::platform_identity(&current_metadata) != original_identity
            || paths::checked_metadata(root, &pending, auth)?.is_some()
        {
            return Err("recovery inputs changed before release".into());
        }
        auth(&path, AccessMode::Write)?;
        fs::remove_file(&path).map_err(|e| e.to_string())?;
        if paths::checked_metadata(root, &path, auth)?.is_some() {
            return Err("reservation recovery removal unconfirmed".into());
        }
        Ok(result)
    })();
    for (path, _) in &catalogs {
        auth.catalog_locks.borrow_mut().remove(path);
    }
    result
}

/// Call under the catalog transaction. Every incoming record is checked against
/// all reservations, including new consumers and newly overlapping claims.
pub(crate) fn check_record_mutation(
    root: &Path,
    id: &str,
    incoming: Option<&Value>,
    auth: Auth<'_>,
) -> Result<(), String> {
    check_claim(root, id, incoming, auth, false)
}

fn check_claim(
    root: &Path,
    id: &str,
    incoming: Option<&Value>,
    auth: Auth<'_>,
    acquiring_nested_pair: bool,
) -> Result<(), String> {
    for reservation in records(root, auth)? {
        // Only the exact registration owner may mutate its reserved cohort.
        // Cleanup leases retain their existing writer exclusion.
        if reservation["purpose"] == "registration"
            && owned(&reservation, auth)
            && reservation["id"] == id
        {
            check_group(root, string(&reservation, "id")?, auth)?;
            continue;
        }
        if reservation["id"] == id {
            return Err("lifecycle group has a durable cleanup reservation".into());
        }
        if let Some(record) = incoming {
            if record["references"].as_array().is_some_and(|refs| {
                refs.iter()
                    .any(|reference| reference["id"] == reservation["id"])
            }) {
                return Err("new inbound reference targets a reserved lifecycle group".into());
            }
            for member in record["members"].as_array().into_iter().flatten() {
                let member_path = paths::resolve(root, Path::new(string(member, "path")?))?;
                for reserved in reservation["members"]
                    .as_array()
                    .ok_or("invalid reserved members")?
                {
                    let reserved_path = Path::new(string(reserved, "path")?);
                    if member["id"].is_string() && member["id"] == reserved["id"] {
                        return Err("member identity is reserved by a lifecycle group".into());
                    }
                    if paths::within(&member_path, reserved_path)
                        || paths::within(reserved_path, &member_path)
                    {
                        // The existing retirement validator binds exactly this
                        // parent-defer/child-delete pair. Acquisition coordinates
                        // their two leases; it does not introduce a new claim.
                        // General catalog writers never receive this exception.
                        if acquiring_nested_pair
                            && owned(&reservation, auth)
                            && member["owner"] == reserved["owner"]
                            && crate::nested_retirement::pair(auth, member, reserved)
                        {
                            check_group(root, string(&reservation, "id")?, auth)?;
                            continue;
                        }
                        return Err("new member claim overlaps a reserved lifecycle group".into());
                    }
                }
            }
        }
    }
    Ok(())
}

/// All group readers, including review, must validate the exact owning fence.
pub(crate) fn check_group(root: &Path, id: &str, auth: Auth<'_>) -> Result<(), String> {
    let path = filename(root, id)?;
    if paths::checked_metadata(root, &path, auth)?.is_none() {
        if auth.reservations.borrow().contains_key(id) {
            return Err("owning reservation disappeared".into());
        }
        return Ok(());
    }
    let record = read(root, &path, auth)?;
    if !owned(&record, auth) {
        return Err("lifecycle group is reserved; recovery may be required".into());
    }
    verify_sources(root, &record, auth)?;
    Ok(())
}

pub(crate) fn check_item(root: &Path, item: &Value, auth: Auth<'_>) -> Result<(), String> {
    if let Some(group) = crate::groups::id(item) {
        check_group(root, group, auth)
    } else {
        check_group(root, &format!("item:{}", string(item, "id")?), auth)
    }
}

pub(crate) fn check_reader_paths(
    root: &Path,
    inputs: &[PathBuf],
    auth: Auth<'_>,
) -> Result<(), String> {
    for reservation in records(root, auth)? {
        let conflict = reservation["members"]
            .as_array()
            .ok_or("invalid reservation members")?
            .iter()
            .any(|member| {
                member["path"].as_str().is_some_and(|member| {
                    inputs.iter().any(|input| {
                        paths::within(input, Path::new(member))
                            || paths::within(Path::new(member), input)
                    })
                })
            });
        if conflict {
            check_group(root, string(&reservation, "id")?, auth)?;
        }
    }
    Ok(())
}

pub(crate) fn check_request(
    root: &Path,
    request: &Value,
    state: &State,
    auth: Auth<'_>,
) -> Result<(), String> {
    if request["operation"] != "register" {
        return Ok(());
    }
    if let Some(group) = request.get("group") {
        check_record_mutation(root, string(group, "id")?, Some(group), auth)?;
    }
    if let Some(refresh) = request.get("refresh_group") {
        check_group(root, string(refresh, "id")?, auth)?;
    }
    if let Some(item) = request.get("item") {
        if let Some(group) = state
            .items
            .get(string(item, "id")?)
            .and_then(crate::groups::id)
        {
            check_group(root, group, auth)?;
        }
        let synthetic = json!({"members":[item],"references":[]});
        check_record_mutation(
            root,
            &format!("item:{}", string(item, "id")?),
            Some(&synthetic),
            auth,
        )?;
    }
    Ok(())
}

pub(crate) struct ReservationSet<'a> {
    root: PathBuf,
    records: BTreeMap<String, Value>,
    leases: BTreeMap<String, crate::lock_recovery::Sentinel<'a>>,
}
impl<'a> ReservationSet<'a> {
    pub(crate) fn observed(&self) -> Vec<Value> {
        self.records
            .iter()
            .map(|(id, record)| json!({"id":id,"fence":record}))
            .collect()
    }
    /// External cleanup owners use the same catalog validation and durable fence;
    /// the owner must retain this object until the physical worker has stopped.
    pub(crate) fn acquire_producers(
        root: &Path,
        records: &[Value],
        auth: Auth<'a>,
    ) -> Result<Self, String> {
        if records.is_empty() || records.len() > 200 {
            return Err("producer reservation requires 1..200 owners".into());
        }
        let source = root.join("artifacts/maintenance/lifecycles");
        let mut state = State::default();
        let mut choices = Vec::new();
        for record in records {
            let id = string(record, "id")?;
            crate::registry::validate(root, record)?;
            if state.groups.contains_key(id) {
                return Err("duplicate producer reservation".into());
            }
            let current = crate::registry::producer_records(root, &source, id, auth)?;
            if current.get(id) != Some(record) {
                return Err("producer reservation snapshot is stale".into());
            }
            if record["membership_complete"] != true
                || !(if let Some(producer) = record.get("producer") {
                    producer["status"] == "stopped"
                        && matches!(producer["outcome"].as_str(), Some("success" | "failure"))
                } else {
                    record["state"] == "complete"
                })
            {
                return Err("producer reservation requires complete stopped ownership".into());
            }
            if current.values().any(|consumer| {
                consumer["references"]
                    .as_array()
                    .is_some_and(|refs| refs.iter().any(|reference| reference["id"] == id))
            }) {
                return Err("inbound consumer protects producer reservation".into());
            }
            let members = record["members"]
                .as_array()
                .ok_or("missing producer members")?;
            let mut ids = Vec::new();
            // Project nested producer entries to disjoint owned roots.
            for (index, member) in members.iter().enumerate() {
                if member["generated"] != true || member["protection_known"] != true {
                    return Err("unconfirmed producer ownership/protection".into());
                }
                let path = Path::new(string(member, "path")?);
                if members.iter().enumerate().any(|(other, ancestor)| {
                    other != index
                        && paths::within(path, Path::new(ancestor["path"].as_str().unwrap_or("")))
                        && (!paths::within(
                            Path::new(ancestor["path"].as_str().unwrap_or("")),
                            path,
                        ) || other < index)
                }) {
                    continue;
                }
                paths::check(root, path, auth)?;
                let member_id = format!("{id}:producer:{index}");
                let mut item = member.clone();
                item["id"] = json!(member_id);
                item["owner"] = record["owner"].clone();
                item["lifecycle_group_id"] = json!(id);
                state.items.insert(member_id.clone(), item);
                choices.push(json!({"id":member_id}));
                ids.push(member_id);
            }
            state.groups.insert(id.to_owned(),json!({"id":id,"owner":record["owner"],"kind":record["kind"],"version":record["version"],
                "members":ids,"membership_source":source,"membership_source_format":"producer_registry_v1","membership_source_identity":crate::registry::reservation_fence(root,&source,id,auth)?}));
        }
        Self::acquire(root, &json!({"decisions":choices}), &state, auth)
    }

    /// Reacquired catalog lock and fresh filesystem observations are required.
    /// Each terminal receipt is synced before its active reservation is removed.
    pub(crate) fn release_producers(
        &mut self,
        outcomes: &[Value],
        evidence: &Value,
        auth: Auth<'_>,
    ) -> Result<(), String> {
        use sha2::{Digest, Sha256};
        self.verify(auth)?;
        if self
            .records
            .values()
            .any(|record| record["purpose"] == "registration")
        {
            return Err("registration reservations require metadata-only release".into());
        }
        let evidence_path =
            paths::resolve(&self.root, Path::new(string(evidence, "evidence_ref")?))?;
        for reservation in self.records.values() {
            for member in reservation["members"]
                .as_array()
                .ok_or("invalid reservation members")?
            {
                if paths::within(&evidence_path, Path::new(string(member, "path")?)) {
                    return Err("terminal evidence overlaps cleanup payload".into());
                }
            }
        }
        let metadata = paths::checked_metadata(&self.root, &evidence_path, auth)?
            .ok_or("terminal evidence missing")?;
        if !metadata.is_file() || metadata.len() > 16 * 1024 * 1024 {
            return Err("terminal evidence must be bounded plain file".into());
        }
        auth(&evidence_path, AccessMode::Read)?;
        let evidence_bytes = fs::read(&evidence_path).map_err(|e| e.to_string())?;
        let evidence_hash = format!("{:x}", Sha256::digest(&evidence_bytes));
        if string(evidence, "evidence_sha256")? != evidence_hash {
            return Err("terminal evidence SHA mismatch".into());
        }
        let evidence_value: Value =
            serde_json::from_slice(&evidence_bytes).map_err(|e| e.to_string())?;
        if evidence_value["outcomes"] != json!(outcomes) {
            return Err("terminal evidence differs from reported outcomes".into());
        }
        for outcome in outcomes {
            let id = string(outcome, "id")?;
            let reservation = self
                .records
                .get(id)
                .ok_or("outcome does not belong to reservation set")?
                .clone();
            if !matches!(
                outcome["status"].as_str(),
                Some(
                    "deleted"
                        | "complete"
                        | "partial"
                        | "failed"
                        | "blocked"
                        | "cancelled"
                        | "deferred"
                )
            ) {
                continue;
            }
            let observed = outcome["members"]
                .as_array()
                .ok_or("missing terminal producer members")?;
            let expected = reservation["members"]
                .as_array()
                .ok_or("invalid reserved producer members")?;
            if observed.len() != expected.len() {
                return Err("terminal producer membership incomplete".into());
            }
            let mut seen = BTreeSet::new();
            // Incomplete/unknown reports never release any part of this group.
            if observed.iter().any(|member| {
                !member["remaining"].is_boolean()
                    || !matches!(
                        member["status"].as_str(),
                        Some("deleted" | "failed" | "blocked" | "cancelled" | "deferred")
                    )
            }) {
                continue;
            }
            for member in observed {
                let path = paths::resolve(&self.root, Path::new(string(member, "path")?))?;
                if !seen.insert(path.clone())
                    || !expected.iter().any(|expected| {
                        expected["path"].as_str().is_some_and(|p| {
                            paths::within(&path, Path::new(p)) && paths::within(Path::new(p), &path)
                        })
                    })
                {
                    return Err("terminal producer membership differs".into());
                }
                if !matches!(
                    member["status"].as_str(),
                    Some("deleted" | "failed" | "blocked" | "cancelled" | "deferred")
                ) || !member["remaining"].is_boolean()
                {
                    return Err("unknown producer outcome retains reservation".into());
                }
                let remaining = paths::checked_metadata(&self.root, &path, auth)?.is_some();
                if member["remaining"] != remaining || (member["status"] == "deleted" && remaining)
                {
                    return Err("terminal producer observation changed".into());
                }
            }
            let path = filename(&self.root, id)?;
            let receipt = path.with_extension(format!("{}.terminal", hash(&reservation["token"])?));
            paths::check(&self.root, &receipt, auth)?;
            auth(&receipt, AccessMode::Write)?;
            auth(
                receipt.parent().ok_or("missing terminal receipt parent")?,
                AccessMode::Write,
            )?;
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&receipt)
                .map_err(|e| e.to_string())?;
            file.write_all(
                &serde_json::to_vec(
                    &json!({"reservation":reservation,"terminal":outcome,"evidence":evidence}),
                )
                .map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            drop(file);
            // The caller retains the catalog lease for the whole finish command.
            // Validate the batch on entry, then freshly validate the exact owner
            // being released. Revalidating every remaining owner here makes a
            // batch quadratic without protecting this removal any further.
            self.verify_group(id, auth)?;
            paths::check(&self.root, &evidence_path, auth)?;
            auth(&evidence_path, AccessMode::Read)?;
            if fs::read(&evidence_path).map_err(|e| e.to_string())? != evidence_bytes {
                return Err("terminal evidence changed before release".into());
            }
            auth(&path, AccessMode::Write)?;
            fs::remove_file(&path).map_err(|e| e.to_string())?;
            if paths::checked_metadata(&self.root, &path, auth)?.is_some() {
                return Err("producer reservation removal unconfirmed".into());
            }
            auth.reservations.borrow_mut().remove(id);
            self.records.remove(id);
        }
        Ok(())
    }
    pub(crate) fn verify(&self, auth: Auth<'_>) -> Result<(), String> {
        for lease in self.leases.values() {
            lease.verify()?;
        }
        for id in self.records.keys() {
            check_group(&self.root, id, auth)?;
        }
        Ok(())
    }

    fn verify_group(&self, id: &str, auth: Auth<'_>) -> Result<(), String> {
        if !self.records.contains_key(id) {
            return Err("reservation is not owned by this set".into());
        }
        self.leases
            .get(id)
            .ok_or("reservation group lease missing")?
            .verify()?;
        check_group(&self.root, id, auth)
    }
    /// Reserve incoming claims and every historical claim of the target cohort
    /// before registration measures content outside the global transaction.
    /// Caller holds maintenance + catalog locks; no payload is traversed here.
    pub(crate) fn acquire_registration(
        root: &Path,
        request: &Value,
        state: &State,
        auth: Auth<'a>,
    ) -> Result<Self, String> {
        if request["operation"] != "register" || request.get("refresh_group").is_some() {
            return Err("registration reservation requires a full registration".into());
        }
        let (id, mut group, incoming) = match (request.get("group"), request.get("item")) {
            (Some(group), None) => (
                string(group, "id")?.to_owned(),
                group.clone(),
                group["members"]
                    .as_array()
                    .ok_or("invalid registration members")?
                    .clone(),
            ),
            (None, Some(item)) => {
                let id = format!("item:{}", string(item, "id")?);
                let group = json!({"id":id,"owner":item["owner"],"kind":item["kind"]});
                (id, group, vec![item.clone()])
            }
            _ => return Err("registration requires exactly one group or item".into()),
        };
        if incoming.is_empty() || incoming.len() > 200 {
            return Err("registration requires 1..200 members".into());
        }
        if request.get("item").is_some() && state.groups.contains_key(&id) {
            return Err("manual item identity collides with a lifecycle group".into());
        }
        if request.get("group").is_some() {
            if let Some(item_id) = id.strip_prefix("item:") {
                if state
                    .items
                    .get(item_id)
                    .is_some_and(|item| crate::groups::id(item).is_none())
                {
                    return Err("group identity collides with a manual item".into());
                }
            }
        }
        if let Some(previous) = state.groups.get(&id) {
            for field in ["membership_source_format", "membership_source", "version"] {
                if group.get(field).is_none() {
                    if let Some(value) = previous.get(field) {
                        group[field] = value.clone();
                    }
                }
            }
        }
        if let Some(source) = group.get("membership_source").and_then(Value::as_str) {
            group["membership_source"] = json!(paths::resolve(root, Path::new(source))?);
        }
        let cohort = |item: &Value| -> Result<String, String> {
            Ok(crate::groups::id(item)
                .map(str::to_owned)
                .unwrap_or(format!("item:{}", string(item, "id")?)))
        };
        let mut requested_ids = BTreeSet::new();
        let mut members = Vec::new();
        for mut item in incoming {
            let item_id = string(&item, "id")?.to_owned();
            if !requested_ids.insert(item_id.clone()) {
                return Err("duplicate registration member identity".into());
            }
            if crate::groups::id(&item).is_some_and(|owner| owner != id) {
                return Err("registration member names another lifecycle group".into());
            }
            if let Some(old) = state.items.get(&item_id) {
                if cohort(old)? != id {
                    return Err("registration member belongs to another cohort".into());
                }
            }
            item["path"] = json!(paths::resolve(root, Path::new(string(&item, "path")?))?);
            members.push(item);
        }
        // Include historical members even when a new registration moves an
        // absent identity or omits it from the new membership declaration.
        for old in state.items.values() {
            if cohort(old)? == id {
                let mut old = old.clone();
                old["path"] = json!(paths::resolve(root, Path::new(string(&old, "path")?))?);
                if !members
                    .iter()
                    .any(|item| item["id"] == old["id"] && item["path"] == old["path"])
                {
                    members.push(old);
                }
            }
        }
        if let Some(previous) = state.groups.get(&id) {
            for member in previous["members"]
                .as_array()
                .ok_or("invalid previous membership")?
            {
                let member_id = member.as_str().ok_or("invalid previous member identity")?;
                let old = state
                    .items
                    .get(member_id)
                    .ok_or("missing historical member")?;
                if cohort(old)? != id {
                    return Err("historical member belongs to another cohort".into());
                }
            }
        }
        // Generic membership evidence is protected by path, while producer
        // catalogs use the group-specific source fence so unrelated writers
        // can continue using that catalog.
        let mut sources = BTreeSet::new();
        for metadata in state
            .groups
            .get(&id)
            .into_iter()
            .chain(std::iter::once(&group))
        {
            if metadata["membership_source_format"] != "producer_registry_v1" {
                if let Some(source) = metadata["membership_source"].as_str() {
                    sources.insert(paths::resolve(root, Path::new(source))?);
                }
            }
        }
        for source in sources {
            members.push(
                json!({"id":format!("registration-source:{}", hash(&source)?),
                "path":source,"owner":group["owner"],"kind":"evidence"}),
            );
        }
        // A source switch reserves both relevant producer cohorts. The fences
        // bind only this group and its inbound consumers, not the whole catalog.
        let mut producer_sources = BTreeSet::new();
        for metadata in state
            .groups
            .get(&id)
            .into_iter()
            .chain(std::iter::once(&group))
        {
            if metadata["membership_source_format"] == "producer_registry_v1" {
                producer_sources.insert(paths::resolve(
                    root,
                    Path::new(string(metadata, "membership_source")?),
                )?);
            }
        }
        let mut bindings = Vec::new();
        for source in producer_sources {
            let fence = crate::registry::reservation_fence(root, &source, &id, auth)?;
            let owner = crate::registry::producer_records(root, &source, &id, auth)?
                .get(&id)
                .cloned()
                .ok_or("registration producer owner missing")?;
            bindings.push(json!({"source":source,"source_fence":fence,"source_owner":owner}));
        }
        group["registration_sources"] = json!(bindings);
        // Provisional lookup keys keep both old and incoming paths when the
        // same identity moves. Durable members retain their real item IDs.
        let mut provisional = State::default();
        provisional.revision = state.revision;
        let mut keys = Vec::new();
        for (index, member) in members.into_iter().enumerate() {
            let key = index.to_string();
            keys.push(key.clone());
            provisional.items.insert(key, member);
        }
        group["members"] = json!(keys);
        provisional.groups.insert(id.clone(), group);
        Self::acquire_inner(root, &BTreeSet::from([id]), &provisional, auth, true)
    }

    /// Metadata-only registration has no cleanup outcome. Release only the
    /// exact owned record after commit or a confirmed pre-commit abort.
    /// Caller holds maintenance + catalog locks.
    pub(crate) fn release_registration(&mut self, auth: Auth<'_>) -> Result<(), String> {
        self.verify(auth)?;
        for (id, record) in &self.records {
            if record["purpose"] != "registration" || !owned(record, auth) {
                return Err("not an owned registration reservation".into());
            }
            let path = filename(&self.root, id)?;
            let expected = serde_json::to_vec(record).map_err(|e| e.to_string())?;
            if read_bytes(&self.root, &path, auth)? != expected {
                return Err("registration reservation bytes changed before release".into());
            }
            auth(&path, AccessMode::Write)?;
            auth(
                path.parent().ok_or("missing reservation parent")?,
                AccessMode::Write,
            )?;
            fs::remove_file(&path).map_err(|e| e.to_string())?;
            if paths::checked_metadata(&self.root, &path, auth)?.is_some() {
                return Err("registration reservation removal unconfirmed".into());
            }
            auth.reservations.borrow_mut().remove(id);
        }
        self.records.clear();
        for lease in std::mem::take(&mut self.leases).into_values() {
            lease.release()?;
        }
        Ok(())
    }
    /// Caller holds maintenance + catalog locks and has validated whole cohorts.
    pub(crate) fn acquire(
        root: &Path,
        request: &Value,
        state: &State,
        auth: Auth<'a>,
    ) -> Result<Self, String> {
        let mut ids = BTreeSet::new();
        for choice in request["decisions"].as_array().ok_or("missing decisions")? {
            let item = state
                .items
                .get(string(choice, "id")?)
                .ok_or("unknown selected item")?;
            ids.insert(
                crate::groups::id(item)
                    .map(str::to_owned)
                    .unwrap_or_else(|| format!("item:{}", item["id"].as_str().unwrap_or_default())),
            );
        }
        Self::acquire_inner(root, &ids, state, auth, false)
    }

    fn acquire_inner(
        root: &Path,
        ids: &BTreeSet<String>,
        state: &State,
        auth: Auth<'a>,
        registration: bool,
    ) -> Result<Self, String> {
        let mut set = Self {
            root: root.to_owned(),
            records: BTreeMap::new(),
            leases: BTreeMap::new(),
        };
        if ids.is_empty() {
            return Ok(set);
        }
        for dir in [
            root.join("artifacts/maintenance/lifecycles"),
            directory(root),
        ] {
            paths::check(root, &dir, auth)?;
            if !dir.exists() {
                auth(
                    dir.parent().ok_or("missing reservation parent")?,
                    AccessMode::Write,
                )?;
                auth(&dir, AccessMode::Write)?;
                fs::create_dir(&dir).map_err(|e| e.to_string())?;
            }
        }
        // Check every existing reservation before creating any durable records.
        let existing = records(root, auth)?;
        for id in ids {
            if existing.iter().any(|record| record["id"] == *id) {
                return Err("existing reservation requires explicit recovery".into());
            }
            let manual;
            let group = if let Some(group) = state.groups.get(id) {
                group
            } else if let Some(item_id) = id.strip_prefix("item:") {
                let item = state
                    .items
                    .get(item_id)
                    .ok_or("missing selected manual item")?;
                manual =
                    json!({"id":id,"owner":item["owner"],"kind":item["kind"],"members":[item_id]});
                &manual
            } else {
                state.groups.get(id).ok_or("missing selected group")?
            };
            let members = group["members"].as_array().ok_or("invalid group members")?;
            let full = members
                .iter()
                .map(|id| {
                    state
                        .items
                        .get(id.as_str().ok_or("invalid member id")?)
                        .cloned()
                        .ok_or("missing member".into())
                })
                .collect::<Result<Vec<Value>, String>>()?;
            check_claim(
                root,
                id,
                Some(&json!({"members":full,"references":[]})),
                auth,
                !registration,
            )?;
            let path = filename(root, id)?;
            let lease = crate::lock_recovery::Sentinel::acquire(
                root,
                &path.with_extension("lock"),
                "group_reservation",
                auth,
            )?;
            let source = if group["membership_source_format"] == "producer_registry_v1" {
                group["membership_source"].clone()
            } else {
                Value::Null
            };
            let source_fence = if let Some(source) = source.as_str() {
                crate::registry::reservation_fence(root, Path::new(source), id, auth)?
            } else {
                Value::Null
            };
            let source_owner = if let Some(source) = source.as_str() {
                crate::registry::producer_records(root, Path::new(source), id, auth)?
                    .get(id)
                    .cloned()
                    .ok_or("producer owner missing")?
            } else {
                Value::Null
            };
            let mut record = json!({"schema":1,"id":id,"token":lease.owner()["token"],"lease_owner":lease.owner(),
                "manifest_revision":state.revision,"group_scope":scope(group),"members":full,
                "source":source,"source_fence":source_fence,"source_owner":source_owner,"status":"active"});
            if registration {
                record["purpose"] = json!("registration");
                record["registration_sources"] = group["registration_sources"].clone();
                record["group_scope"]["members"] = json!(
                    full.iter()
                        .map(|member| member["id"].clone())
                        .collect::<Vec<_>>()
                );
            }
            // Check the exact durable representation before create_new publishes
            // even an empty active record. Lease batch preflight additionally
            // rejects an oversized aggregate response before any group mutates.
            let bytes = serde_json::to_vec(&record).map_err(|e| e.to_string())?;
            if bytes.len() > MAX_RESERVATION_BYTES {
                return Err("reservation exceeds 64 MiB bound".into());
            }
            paths::check(root, &path, auth)?;
            auth(&path, AccessMode::Write)?;
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|e| format!("reservation requires recovery: {e}"))?;
            file.write_all(&bytes).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            set.leases.insert(id.clone(), lease);
            set.records.insert(id.clone(), record.clone());
            auth.reservations.borrow_mut().insert(id.clone(), record);
        }
        Ok(set)
    }
    /// Caller holds the catalog lock, and state was committed successfully.
    /// Unknown observations and any pending intent deliberately retain protection.
    pub(crate) fn release_terminal(&mut self, state: &State, auth: Auth<'_>) -> Result<(), String> {
        self.verify(auth)?;
        for (id, reservation) in &self.records {
            if reservation["purpose"] == "registration" {
                return Err("registration reservations require metadata-only release".into());
            }
            check_group(&self.root, id, auth)?;
            let manual;
            let group = if let Some(group) = state.groups.get(id) {
                group
            } else if let Some(item_id) = id.strip_prefix("item:") {
                let item = state
                    .items
                    .get(item_id)
                    .ok_or("reserved manual item disappeared")?;
                manual =
                    json!({"id":id,"owner":item["owner"],"kind":item["kind"],"members":[item_id]});
                &manual
            } else {
                state.groups.get(id).ok_or("reserved group disappeared")?
            };
            if scope(group) != reservation["group_scope"] {
                return Err("reserved group scope changed".into());
            }
            let terminal = reservation["members"]
                .as_array()
                .ok_or("invalid reserved members")?
                .iter()
                .all(|member| {
                    let Some(item) = member["id"].as_str().and_then(|id| state.items.get(id))
                    else {
                        return false;
                    };
                    item["remaining"].is_boolean()
                        && matches!(
                            item["cleanup_status"].as_str(),
                            Some("deleted" | "blocked" | "deferred" | "failed" | "cancelled")
                        )
                        && !state.decisions.iter().any(|decision| {
                            decision["id"] == member["id"] && decision["status"] == "pending"
                        })
                });
            if !terminal {
                continue;
            }
            let path = filename(&self.root, id)?;
            if read(&self.root, &path, auth)? != *reservation {
                return Err("reservation changed before release".into());
            }
            auth(&path, AccessMode::Write)?;
            auth(
                path.parent().ok_or("missing reservation parent")?,
                AccessMode::Write,
            )?;
            fs::remove_file(&path).map_err(|e| e.to_string())?;
            if paths::checked_metadata(&self.root, &path, auth)?.is_some() {
                return Err("reservation removal was not observed".into());
            }
            auth.reservations.borrow_mut().remove(id);
        }
        Ok(())
    }
}

//! Bounded stdin lease protocol; only lifecycle catalog records are mutable.
use crate::{AccessMode, Context, lock_recovery::Sentinel, paths, string};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{self, BufRead, Write},
    path::{Component, Path},
    time::{Duration, Instant},
};
// Registry records retain their existing 16 MiB limit. The new transport allows
// a bounded aggregate envelope for records and duplicated reservation evidence.
const MAX_RECORD_BYTES: usize = 16 * 1024 * 1024;
const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn emit(id: Value, result: Result<Value, String>) -> Result<(), String> {
    let reply = match result {
        Ok(result) => json!({"id":id,"ok":true,"result":result}),
        Err(error) => json!({"id":id,"ok":false,"error":error}),
    };
    let mut bytes = serde_json::to_vec(&reply).map_err(|e| e.to_string())?;
    if bytes.len() >= MAX_FRAME_BYTES {
        // A failed response never releases durable reservations or reports success.
        bytes = serde_json::to_vec(&json!({"id":reply["id"],"ok":false,"error":"lease response exceeds 64 MiB frame; outcome unknown"}))
            .map_err(|e| e.to_string())?;
    }
    bytes.push(b'\n');
    let mut out = io::stdout().lock();
    out.write_all(&bytes)
        .and_then(|_| out.flush())
        .map_err(|e| e.to_string())
}
fn read_bounded(reader: &mut impl BufRead) -> Result<Option<Vec<u8>>, String> {
    let mut line = Vec::new();
    loop {
        let bytes = reader.fill_buf().map_err(|e| e.to_string())?;
        if bytes.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Err("unterminated lease command".into())
            };
        }
        let count = bytes
            .iter()
            .position(|b| *b == b'\n')
            .map_or(bytes.len(), |n| n + 1);
        if line.len() + count > MAX_FRAME_BYTES {
            return Err("lease command exceeds bound".into());
        }
        let done = bytes[count - 1] == b'\n';
        line.extend_from_slice(&bytes[..count]);
        reader.consume(count);
        if done {
            return Ok(Some(line));
        }
    }
}
fn read_record(path: &Path) -> Result<Option<Vec<u8>>, String> {
    use std::io::Read;
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("record must be a plain file".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_RECORD_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_RECORD_BYTES {
        return Err("record exceeds existing 16 MiB registry bound".into());
    }
    Ok(Some(bytes))
}

fn mutate(
    root: &Path,
    lock: &Path,
    lease: &Sentinel<'_>,
    command: &Value,
    auth: crate::Auth<'_>,
) -> Result<Value, String> {
    if lock != root.join("artifacts/maintenance/lifecycles/catalog.lock") {
        return Err("record operations require exact lifecycle catalog lock".into());
    }
    let write = command["operation"] == "write_record";
    let record = &command["record"];
    let id = if write {
        for member in crate::registry::validate(root, record)? {
            if paths::reserved(root, &member) {
                return Err("member overlaps control/user state".into());
            }
            paths::check(root, &member, auth)?;
        }
        string(record, "id")?
    } else {
        string(command, "record_id")?
    };
    if id.is_empty() || id.len() > 4096 {
        return Err("bounded record ID required".into());
    }
    let filename = lock
        .parent()
        .ok_or("missing catalog")?
        .join(format!("{}.json", digest(id.as_bytes())));
    paths::check(root, &filename, auth)?;
    auth(&filename, AccessMode::Read)?;
    let old = read_record(&filename)?;
    let expected = command
        .get("expected_sha256")
        .ok_or("expected_sha256 required")?;
    match (expected, &old) {
        (Value::Null, None) => {}
        (Value::String(hash), Some(bytes)) if hash.len() == 64 && hash == &digest(bytes) => {}
        _ => return Err("lifecycle record CAS mismatch".into()),
    }
    if let Some(bytes) = &old {
        let previous: Value =
            serde_json::from_slice(bytes).map_err(|_| "invalid previous lifecycle record")?;
        if previous["id"] != id {
            return Err("hashed lifecycle ID mismatch".into());
        }
    }
    crate::reservations::check_record_mutation(
        root,
        id,
        if write { Some(record) } else { None },
        auth,
    )?;
    auth(
        filename.parent().ok_or("missing record parent")?,
        AccessMode::Write,
    )?;
    auth(&filename, AccessMode::Write)?;
    lease.verify()?;
    // Repeat raw CAS after authorization/reservation callbacks.
    let current = read_record(&filename)?;
    if current != old {
        return Err("lifecycle record changed before commit".into());
    }
    if write {
        let bytes = serde_json::to_vec(record).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_RECORD_BYTES {
            return Err("record exceeds existing 16 MiB registry bound".into());
        }
        let pending = filename.with_extension("pending");
        paths::check(root, &pending, auth)?;
        auth(&pending, AccessMode::Write)?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&pending)
            .map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        let pending_identity = crate::lock_recovery::identity(&file)?;
        drop(file);
        lease.verify()?;
        crate::lock_recovery::final_plain_path(&pending)?;
        crate::lock_recovery::final_plain_path(filename.parent().ok_or("missing catalog")?)?;
        if old.is_some() {
            crate::lock_recovery::final_plain_path(&filename)?;
        }
        if read_record(&filename)? != old {
            return Err("lifecycle record changed before publish; pending retained".into());
        }
        if crate::lock_recovery::identity(
            &std::fs::File::open(&pending).map_err(|e| e.to_string())?,
        )? != pending_identity
            || read_record(&pending)?.as_deref() != Some(bytes.as_slice())
        {
            return Err("pending lifecycle record changed".into());
        }
        fs::rename(&pending, &filename)
            .map_err(|e| format!("record publish failed; pending retained: {e}"))?;
        lease.verify()?;
        Ok(json!({"sha256":digest(&bytes)}))
    } else {
        if old.is_none() {
            return Err("record missing".into());
        }
        paths::check(root, &filename, auth)?;
        lease.verify()?;
        crate::lock_recovery::final_plain_path(&filename)?;
        if read_record(&filename)? != old {
            return Err("lifecycle record changed before removal".into());
        }
        fs::remove_file(&filename).map_err(|e| e.to_string())?;
        lease.verify()?;
        Ok(json!({"removed":true}))
    }
}
fn acquire_lease<'a>(
    root: &Path,
    lock: &Path,
    operation: &str,
    wait_ms: u64,
    auth: crate::Auth<'a>,
) -> Result<Sentinel<'a>, String> {
    let deadline = Instant::now() + Duration::from_millis(wait_ms);
    loop {
        match Sentinel::acquire(root, lock, operation, auth) {
            Ok(lease) => return Ok(lease),
            Err(e) if e.starts_with("OS lock busy:") && Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(10))
            }
            Err(e) => return Err(e),
        }
    }
}
// Conservative upper bound, deliberately counting even members that will be
// projected away. Count source_owner, original member data, all injected
// member IDs/owners, repeated group fields, and fixed lease/protocol overhead.
// This executes under catalog custody, before any durable reservation is created.
fn preflight_reservation_response(root: &Path, records: &[Value]) -> Result<(), String> {
    let encoded_len = |value: &Value| {
        serde_json::to_vec(value)
            .map(|bytes| bytes.len())
            .map_err(|e| e.to_string())
    };
    let add = |a: usize, b: usize| a.checked_add(b).ok_or("reservation envelope overflow");
    let multiply = |a: usize, b: usize| a.checked_mul(b).ok_or("reservation envelope overflow");
    let source_len = encoded_len(&json!(root.join("artifacts/maintenance/lifecycles")))?;
    let mut total = 16_384usize; // reply envelope, arrays, command ID, and newline
    for record in records {
        let record_len = encoded_len(record)?;
        if record_len > MAX_RECORD_BYTES {
            return Err("record exceeds existing 16 MiB registry bound".into());
        }
        let members = &record["members"];
        let count = members.as_array().ok_or("missing producer members")?.len();
        let id_len = encoded_len(&record["id"])?;
        let owner_len = encoded_len(&record["owner"])?;
        let injected = add(add(multiply(id_len, 3)?, owner_len)?, 512)?;
        let repeated = add(
            add(multiply(id_len, 4)?, owner_len)?,
            add(
                encoded_len(&record["kind"])?,
                encoded_len(&record["version"])?,
            )?,
        )?;
        for part in [
            record_len,
            encoded_len(members)?,
            multiply(count, injected)?,
            repeated,
            multiply(source_len, 2)?,
            16_384,
        ] {
            total = add(total, part)?;
        }
        if total > MAX_FRAME_BYTES {
            return Err("producer reservation batch exceeds conservative 64 MiB response envelope; select fewer records".into());
        }
    }
    Ok(())
}

fn load_producers(
    root: &Path,
    command: &Value,
    auth: crate::Auth<'_>,
) -> Result<Vec<Value>, String> {
    let requested = command["records"]
        .as_array()
        .filter(|v| !v.is_empty() && v.len() <= 200)
        .ok_or("producer reservation requires 1..200 selectors")?;
    let source = root.join("artifacts/maintenance/lifecycles");
    let mut loaded = Vec::new();
    for selector in requested {
        let id = string(selector, "id")?;
        let catalog = crate::registry::producer_records(root, &source, id, auth)?;
        let record = catalog.get(id).ok_or("producer record missing")?;
        if selector.get("members").is_some() {
            if selector != record {
                return Err("producer full record snapshot changed".into());
            }
        } else if selector["revision"].as_u64().is_none()
            || selector["revision"] != record["revision"]
        {
            return Err("producer record selector revision changed".into());
        }
        loaded.push(record.clone());
    }
    Ok(loaded)
}
/// CLI arguments: --lease ABS_LOCK --operation BOUNDED --wait-ms 0..5000 --parent-pid PID.
pub fn run(lock: &Path, operation: &str, wait_ms: u64, parent_pid: u32) -> Result<(), String> {
    if !lock.is_absolute()
        || lock
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
        || wait_ms > 5000
        || parent_pid == 0
    {
        return Err("invalid bounded lease arguments".into());
    }
    let catalog_suffix = Path::new("artifacts/maintenance/lifecycles/catalog.lock");
    let root = if lock.ends_with(catalog_suffix) {
        lock.ancestors().nth(4).ok_or("missing project root")?
    } else {
        lock.parent().ok_or("missing lock parent")?
    };
    let catalog_lock = root.join(catalog_suffix);
    let authorize = |p: &Path, mode: AccessMode| {
        if p.starts_with(root) || (mode == AccessMode::Read && root.starts_with(p)) {
            Ok(())
        } else {
            Err("outside lease permission boundary".into())
        }
    };
    let context = Context::new(&authorize);
    let initial = match acquire_lease(root, lock, operation, wait_ms, &context) {
        Ok(lease) => lease,
        Err(e) => return emit(json!(0), Err(e)),
    };
    let mut owner = initial.owner();
    owner["parent_pid"] = json!(parent_pid);
    let mut lease = Some(initial);
    if lock == catalog_lock {
        context
            .catalog_locks
            .borrow_mut()
            .insert(catalog_lock.clone());
    }
    let mut reservations: Option<crate::reservations::ReservationSet<'_>> = None;
    emit(json!(0), Ok(owner))?;
    let mut input = io::stdin().lock();
    while let Some(line) = read_bounded(&mut input)? {
        let command: Value = serde_json::from_slice(&line).map_err(|_| "invalid lease JSON")?;
        let id = command
            .get("id")
            .filter(|id| id.as_u64().is_some_and(|v| v > 0))
            .ok_or("positive command id required")?
            .clone();
        let selected = command["operation"].as_str();
        if selected == Some("release") {
            let result = if let Some(lease) = lease.take() {
                lease.release()
            } else {
                Ok(())
            };
            context.catalog_locks.borrow_mut().remove(&catalog_lock);
            let remaining = context
                .reservations
                .borrow()
                .keys()
                .cloned()
                .collect::<Vec<_>>();
            // Dropping the set closes OS handles but retains every durable active fence.
            drop(reservations);
            return emit(
                id,
                result.map(|_| json!({"released":true,"reservations_retained":remaining})),
            );
        }
        let result = (|| -> Result<Value, String> {
            match selected {
                Some("write_record" | "remove_record") => mutate(
                    root,
                    lock,
                    lease.as_ref().ok_or("catalog lease was released")?,
                    &command,
                    &context,
                ),
                Some("reserve_producers") => {
                    if lock != catalog_lock {
                        return Err("producer reservations require exact catalog lock".into());
                    }
                    if reservations.is_some() {
                        return Err("producer reservation set already acquired".into());
                    }
                    lease
                        .as_ref()
                        .ok_or("catalog lease was released")?
                        .verify()?;
                    let records = load_producers(root, &command, &context)?;
                    preflight_reservation_response(root, &records)?;
                    reservations = Some(crate::reservations::ReservationSet::acquire_producers(
                        root, &records, &context,
                    )?);
                    lease.as_ref().ok_or("catalog lease missing")?.verify()?;
                    Ok(
                        json!({"reserved":records.iter().map(|r|r["id"].clone()).collect::<Vec<_>>(),"observed":reservations.as_ref().ok_or("producer reservation set missing")?.observed()}),
                    )
                }
                Some("release_catalog") => {
                    let set = reservations
                        .as_ref()
                        .ok_or("producer reservations required before releasing catalog")?;
                    set.verify(&context)?;
                    let held = lease.take().ok_or("catalog lease already released")?;
                    let released = held.release();
                    context.catalog_locks.borrow_mut().remove(&catalog_lock);
                    released?;
                    Ok(json!({"catalog_released":true}))
                }
                Some("finish_producers") => {
                    if lock != catalog_lock || reservations.is_none() {
                        return Err("producer reservation set required".into());
                    }
                    if lease.is_none() {
                        lease = Some(acquire_lease(root, lock, operation, wait_ms, &context)?);
                        context
                            .catalog_locks
                            .borrow_mut()
                            .insert(catalog_lock.clone());
                    }
                    lease.as_ref().ok_or("catalog lease missing")?.verify()?;
                    let outcomes = command["outcomes"]
                        .as_array()
                        .ok_or("producer outcomes required")?;
                    let evidence = json!({"evidence_ref":string(&command,"evidence_ref")?,"evidence_sha256":string(&command,"evidence_sha256")?});
                    reservations
                        .as_mut()
                        .ok_or("producer reservation set missing")?
                        .release_producers(outcomes, &evidence, &context)?;
                    lease.as_ref().ok_or("catalog lease missing")?.verify()?;
                    Ok(
                        json!({"finished":true,"reservations_retained":context.reservations.borrow().keys().cloned().collect::<Vec<_>>()}),
                    )
                }
                _ => Err("unknown lease command".into()),
            }
        })();
        emit(id, result)?;
    }
    // EOF releases exclusion only, never completes an operation or removes a fence.
    if let Some(lease) = lease {
        lease.release()?;
    }
    Ok(())
}

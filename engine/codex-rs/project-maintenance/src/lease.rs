//! Bounded stdin lease protocol; only lifecycle catalog records are mutable.
use crate::{AccessMode, Context, lock_recovery::Sentinel, paths, string};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::{self, File, OpenOptions},
    io::{self, BufRead, Write},
    path::{Component, Path, PathBuf},
    time::Duration,
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
        Err(error) => {
            let mut reply = crate::error_response(&error);
            reply["id"] = id;
            reply["ok"] = json!(false);
            reply
        }
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

struct PendingObservation {
    bytes: Vec<u8>,
    identity: Vec<u64>,
}

// Keep the final comparison free of authorizer callbacks. All paths are
// authorized first, then checked again after the last lease/reservation callback.
fn observe_pending_file(path: &Path) -> Result<PendingObservation, String> {
    use std::io::Read;
    crate::lock_recovery::final_plain_path(path)?;
    let file = File::open(path).map_err(|e| e.to_string())?;
    let identity = crate::lock_recovery::identity(&file)?;
    if file.metadata().map_err(|e| e.to_string())?.len() > MAX_RECORD_BYTES as u64 {
        return Err("pending recovery file exceeds 16 MiB bound".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_RECORD_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_RECORD_BYTES {
        return Err("pending recovery file exceeds 16 MiB bound".into());
    }
    crate::lock_recovery::final_plain_path(path)?;
    if crate::lock_recovery::identity(&File::open(path).map_err(|e| e.to_string())?)? != identity {
        return Err("pending recovery file identity changed".into());
    }
    Ok(PendingObservation { bytes, identity })
}

fn observe_pending_authorized(
    root: &Path,
    path: &Path,
    auth: crate::Auth<'_>,
) -> Result<PendingObservation, String> {
    paths::check(root, path, auth)?;
    auth(path, AccessMode::Read)?;
    observe_pending_file(path)
}

fn pending_sha(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn pending_evidence_path(root: &Path, value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if !path.is_absolute() {
        return Err("absolute pending recovery evidence path required".into());
    }
    let path = paths::resolve(root, path)?;
    let directory = root.join("artifacts/maintenance/evidence");
    if path == directory || !paths::within(&path, &directory) {
        return Err("pending recovery evidence must be inside maintenance/evidence".into());
    }
    Ok(path)
}

fn pending_proof(
    root: &Path,
    reference: &str,
    expected: &str,
    auth: crate::Auth<'_>,
) -> Result<(PathBuf, PendingObservation), String> {
    if !pending_sha(expected) {
        return Err("valid pending recovery proof SHA-256 required".into());
    }
    let path = pending_evidence_path(root, reference)?;
    let observed = observe_pending_authorized(root, &path, auth)?;
    if digest(&observed.bytes) != expected {
        return Err("pending recovery proof SHA-256 mismatch".into());
    }
    Ok((path, observed))
}

fn pending_record(root: &Path, bytes: &[u8]) -> Result<Value, String> {
    let record: Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    crate::registry::validate(root, &record)?;
    // These are native write_record outputs, not arbitrary JSON documents.
    // Exact round-tripping also rejects duplicate keys and trailing JSON/text.
    if serde_json::to_vec(&record).map_err(|e| e.to_string())? != bytes {
        return Err("complete native-serialized lifecycle record required".into());
    }
    Ok(record)
}

/// Abort only an unpublished reference-release record. The authoritative record
/// and every reference stay intact; the original owner must retry its release.
pub(crate) fn recover_pending(
    root: &Path,
    request: &Value,
    auth: crate::Auth<'_>,
) -> Result<Value, String> {
    if request["operation"] != "recover_lifecycle_pending"
        || request["decision"] != "abort"
        || request["producer_stopped_verified"] != true
    {
        return Err("explicit abort-only lifecycle pending recovery required".into());
    }
    for key in ["record_id", "owner", "reason"] {
        if string(request, key)?.trim().is_empty() {
            return Err(format!("blank pending recovery {key}"));
        }
    }
    let id = string(request, "record_id")?;
    if id.len() > 4096 {
        return Err("bounded record ID required".into());
    }
    for key in ["expected_record_sha256", "expected_pending_sha256"] {
        if !pending_sha(string(request, key)?) {
            return Err(format!("valid {key} required"));
        }
    }
    let writer_pid = request["writer_pid"]
        .as_u64()
        .and_then(|pid| u32::try_from(pid).ok())
        .filter(|pid| *pid > 0)
        .ok_or("valid original writer_pid required")?;
    let catalog = root.join("artifacts/maintenance/lifecycles");
    let filename = catalog.join(format!("{}.json", digest(id.as_bytes())));
    let pending = filename.with_extension("pending");
    let original = observe_pending_authorized(root, &filename, auth)?;
    let uncommitted = observe_pending_authorized(root, &pending, auth)?;
    if digest(&original.bytes) != string(request, "expected_record_sha256")?
        || digest(&uncommitted.bytes) != string(request, "expected_pending_sha256")?
    {
        return Err("lifecycle record or pending CAS mismatch".into());
    }
    let base = pending_record(root, &original.bytes)?;
    let next = pending_record(root, &uncommitted.bytes)?;
    let revision = base["revision"]
        .as_u64()
        .filter(|revision| *revision > 0)
        .ok_or("positive authoritative revision required")?;
    let next_revision = revision
        .checked_add(1)
        .ok_or("lifecycle revision overflow")?;
    if base["id"] != id
        || next["id"] != id
        || base["owner"] != request["owner"]
        || next["owner"] != base["owner"]
        || next["revision"].as_u64() != Some(next_revision)
    {
        return Err("pending recovery ID, owner or consecutive revision mismatch".into());
    }
    for record in [&base, &next] {
        for member in crate::registry::validate(root, record)? {
            if paths::reserved(root, &member) {
                return Err("pending recovery member overlaps protected state".into());
            }
            paths::check(root, &member, auth)?;
        }
    }
    let source = pending_proof(
        root,
        string(request, "original_request_ref")?,
        string(request, "original_request_sha256")?,
        auth,
    )?;
    let release: Value = serde_json::from_slice(&source.1.bytes).map_err(|e| e.to_string())?;
    let release_object = release
        .as_object()
        .ok_or("release request object required")?;
    let mut keys = release_object
        .keys()
        .map(String::as_str)
        .collect::<Vec<_>>();
    keys.sort_unstable();
    if keys
        != [
            "evidence_ref",
            "evidence_sha256",
            "expected_revision",
            "owner",
            "reason",
            "reference_ids",
        ]
        || release["owner"] != base["owner"]
        || release["expected_revision"] != revision
        || string(&release, "reason")?.trim().is_empty()
    {
        return Err("original owner release request mismatch".into());
    }
    // Same canonical binding as artifact-lifecycle.cjs mutateLifecycle:
    // SHA256(JSON.stringify(Object.keys(request).sort().map(k => [k, request[k]]))).
    let canonical = keys
        .iter()
        .map(|key| json!([key, release[*key]]))
        .collect::<Vec<_>>();
    let request_sha = digest(&serde_json::to_vec(&canonical).map_err(|e| e.to_string())?);
    let references = base["references"].as_array().ok_or("references required")?;
    let release_ids = release["reference_ids"]
        .as_array()
        .filter(|ids| !ids.is_empty())
        .ok_or("explicit release reference IDs required")?;
    let mut selected = BTreeSet::new();
    for selected_id in release_ids {
        let selected_id = selected_id
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or("nonblank release reference ID required")?;
        if !selected.insert(selected_id)
            || references
                .iter()
                .filter(|reference| reference["reference_id"] == selected_id)
                .count()
                != 1
        {
            return Err("exact unique persisted reference IDs required".into());
        }
    }
    let mut expected = base.clone();
    expected["references"] = json!(
        references
            .iter()
            .filter(|reference| {
                !reference["reference_id"]
                    .as_str()
                    .is_some_and(|id| selected.contains(id))
            })
            .collect::<Vec<_>>()
    );
    expected["revision"] = next["revision"].clone();
    if string(&next, "updated_at")?.trim().is_empty() {
        return Err("pending update timestamp required".into());
    }
    expected["updated_at"] = next["updated_at"].clone();
    let release_evidence = pending_proof(
        root,
        string(&release, "evidence_ref")?,
        string(&release, "evidence_sha256")?,
        auth,
    )?;
    // checkedEvidence stores path.resolve(evidence_ref), while request_sha256
    // binds the original request spelling. Rebuild native separators only for
    // the receipt, after the existing containment, identity and hash checks.
    let receipt_evidence = release_evidence.0.components().collect::<PathBuf>();
    expected["release_receipt"] = json!({"request_sha256":request_sha,
        "evidence_ref":receipt_evidence,"evidence_sha256":release["evidence_sha256"],
        "reason":release["reason"]});
    if expected != next {
        return Err("pending contains changes beyond the exact owner reference release".into());
    }
    let stop = pending_proof(
        root,
        string(request, "writer_stop_ref")?,
        string(request, "writer_stop_sha256")?,
        auth,
    )?;
    let stopped: Value = serde_json::from_slice(&stop.1.bytes).map_err(|e| e.to_string())?;
    if stopped["schema"] != 1
        || stopped["record_id"] != id
        || stopped["owner"] != base["owner"]
        || stopped["writer_pid"] != writer_pid
        || stopped["original_request_sha256"] != request["original_request_sha256"]
        || stopped["expected_record_sha256"] != request["expected_record_sha256"]
        || stopped["expected_pending_sha256"] != request["expected_pending_sha256"]
        || stopped["producer_stopped_verified"] != true
        || stopped["process_tree_stopped_verified"] != true
        || string(&stopped, "stop_basis")?.trim().is_empty()
    {
        return Err("independent original writer stop binding required".into());
    }
    let receipt = pending_evidence_path(root, string(request, "receipt_ref")?)?;
    let mut observations = vec![
        (filename.clone(), original),
        (pending.clone(), uncommitted),
        source,
        release_evidence,
        stop,
    ];
    let mut names = observations
        .iter()
        .map(|(path, _)| path.clone())
        .collect::<BTreeSet<_>>();
    if names.len() != observations.len() || !names.insert(receipt.clone()) {
        return Err("distinct pending recovery evidence and receipt paths required".into());
    }
    let producer_evidence = stopped["producer_evidence"]
        .as_array()
        .filter(|proofs| !proofs.is_empty() && proofs.len() <= 16)
        .ok_or("independent writer termination evidence files required")?;
    for proof in producer_evidence {
        let proof = pending_proof(root, string(proof, "path")?, string(proof, "sha256")?, auth)?;
        if proof.1.bytes.iter().all(u8::is_ascii_whitespace) {
            return Err("nonblank independent writer termination evidence required".into());
        }
        if !names.insert(proof.0.clone()) {
            return Err("writer termination evidence must be independent".into());
        }
        observations.push(proof);
        if observations
            .iter()
            .map(|(_, file)| file.bytes.len())
            .sum::<usize>()
            > MAX_FRAME_BYTES
        {
            return Err("pending recovery aggregate evidence exceeds 64 MiB".into());
        }
    }
    crate::lock_recovery::owner_absent(writer_pid)?;
    // A new, actual OS lease excludes a live writer. It never replaces or removes
    // an abandoned lock; legacy/unknown locks retain their separate recovery.
    let lock = catalog.join("catalog.lock");
    paths::check(root, &lock, auth)?;
    if !fs::symlink_metadata(&lock)
        .map_err(|e| e.to_string())?
        .is_file()
    {
        return Err("existing lifecycle catalog lock required".into());
    }
    let lease = crate::lock_recovery::wait_for_lock_cancel(
        auth.lock_wait.get(),
        &|| auth.cancelled(),
        || Sentinel::acquire(root, &lock, "recover_lifecycle_pending", auth),
    )?;
    crate::reservations::check_record_mutation(root, id, Some(&base), auth)?;
    crate::reservations::check_record_mutation(root, id, Some(&next), auth)?;
    paths::check(root, &receipt, auth)?;
    auth(
        receipt.parent().ok_or("missing evidence parent")?,
        AccessMode::Write,
    )?;
    auth(&receipt, AccessMode::Write)?;
    auth(&pending, AccessMode::Write)?;
    auth(&catalog, AccessMode::Write)?;
    let receipt_value = json!({"schema":1,"operation":"recover_lifecycle_pending",
        "status":"authorized_abort_attempt","record_id":id,"owner":base["owner"],
        "expected_record_sha256":request["expected_record_sha256"],
        "expected_pending_sha256":request["expected_pending_sha256"],
        "base_revision":revision,"pending_revision":next["revision"],
        "record_identity":observations[0].1.identity,"pending_identity":observations[1].1.identity,
        "original_request_ref":request["original_request_ref"],
        "original_request_sha256":request["original_request_sha256"],
        "release_request_sha256":request_sha,"writer_stop_ref":request["writer_stop_ref"],
        "writer_stop_sha256":request["writer_stop_sha256"],"writer_pid":writer_pid,
        "producer_stopped_verified":true,"reason":request["reason"],"recorded_at_ms":crate::now_ms()?});
    let bytes = serde_json::to_vec_pretty(&receipt_value).map_err(|e| e.to_string())?;
    if bytes.len() > 1024 * 1024 {
        return Err("pending recovery receipt exceeds 1 MiB bound".into());
    }
    crate::lock_recovery::final_plain_path(receipt.parent().ok_or("missing evidence parent")?)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&receipt)
        .map_err(|e| format!("create-new pending recovery receipt failed: {e}"))?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    let mut permissions = file.metadata().map_err(|e| e.to_string())?.permissions();
    permissions.set_readonly(true);
    file.set_permissions(permissions)
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    let receipt_observed = PendingObservation {
        bytes: bytes.clone(),
        identity: crate::lock_recovery::identity(&file)?,
    };
    drop(file);
    observations.push((receipt.clone(), receipt_observed));
    // Authorize all observations before the last callback-bearing checks.
    for (path, _) in &observations {
        paths::check(root, path, auth)?;
        auth(path, AccessMode::Read)?;
    }
    auth(&pending, AccessMode::Write)?;
    auth(&catalog, AccessMode::Write)?;
    crate::reservations::check_record_mutation(root, id, Some(&base), auth)?;
    crate::reservations::check_record_mutation(root, id, Some(&next), auth)?;
    crate::lock_recovery::owner_absent(writer_pid)?;
    lease.verify()?;
    // Proofs first, then authoritative CAS and the exact pending identity last.
    for (path, expected) in observations
        .iter()
        .skip(2)
        .chain(observations.iter().take(2))
    {
        let current = observe_pending_file(path)?;
        if current.identity != expected.identity || current.bytes != expected.bytes {
            return Err("pending recovery input changed before abort; pending retained".into());
        }
    }
    fs::remove_file(&pending)
        .map_err(|e| format!("ordinary pending abort failed; receipt retained: {e}"))?;
    let current = observe_pending_file(&filename)?;
    if current.identity != observations[0].1.identity || current.bytes != observations[0].1.bytes {
        return Err("authoritative lifecycle record changed after abort; receipt retained".into());
    }
    match fs::symlink_metadata(&pending) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        _ => return Err("pending remains after abort; receipt retained".into()),
    }
    let final_receipt = observe_pending_file(&receipt)?;
    if final_receipt.identity
        != observations
            .last()
            .ok_or("missing recovery receipt")?
            .1
            .identity
        || final_receipt.bytes != bytes
    {
        return Err("pending recovery receipt changed after abort".into());
    }
    *auth.catalog.borrow_mut() = Default::default();
    Ok(
        json!({"status":"aborted","operation":"recover_lifecycle_pending","record_id":id,
        "record_sha256":digest(&current.bytes),"pending_absent":true,"receipt_ref":receipt,
        "receipt_sha256":digest(&bytes)}),
    )
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
    if !crate::preferences::read(&crate::preferences::home()?)?.groups_enabled() && write {
        let previous: Value = serde_json::from_slice(
            old.as_ref()
                .ok_or("maintenance disabled: reconciliation cannot create records")?,
        )
        .map_err(|e| e.to_string())?;
        for field in [
            "id",
            "owner",
            "kind",
            "version",
            "ownership_scope",
            "owned_root",
            "members",
        ] {
            if previous[field] != record[field] {
                return Err(format!(
                    "maintenance disabled: reconciliation cannot change {field}"
                ));
            }
        }
        let before = previous["references"]
            .as_array()
            .ok_or("previous references required")?;
        if record["references"]
            .as_array()
            .ok_or("references required")?
            .iter()
            .any(|reference| !before.contains(reference))
        {
            return Err("maintenance disabled: reconciliation cannot add references".into());
        }
    }
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
        *auth.catalog.borrow_mut() = Default::default();
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
        *auth.catalog.borrow_mut() = Default::default();
        lease.verify()?;
        Ok(json!({"removed":true}))
    }
}
// Only a strict reference release can bypass queued deletion. Comparing the
// remaining document prevents a release-shaped ownership/generation mutation.
fn reference_release(
    root: &Path,
    previous: &Value,
    next: &Value,
    auth: crate::Auth<'_>,
) -> Result<bool, String> {
    let (Some(before), Some(after)) = (
        previous["references"].as_array(),
        next["references"].as_array(),
    ) else {
        return Ok(false);
    };
    if after.len() > before.len() || after.iter().any(|r| !before.contains(r)) {
        return Ok(false);
    }
    let closing = previous.get("producer").is_none() && next.get("producer").is_some();
    let receipt_key = if closing {
        "close_receipt"
    } else {
        "release_receipt"
    };
    if !closing && after.len() == before.len() {
        return Ok(false);
    }
    if next["revision"].as_u64() != previous["revision"].as_u64().and_then(|v| v.checked_add(1)) {
        return Ok(false);
    }
    let receipt = &next[receipt_key];
    if receipt == &previous[receipt_key] {
        return Ok(false);
    }
    let evidence = Path::new(string(receipt, "evidence_ref")?);
    paths::check(root, evidence, auth)?;
    auth(evidence, AccessMode::Read)?;
    if read_record(evidence)?
        .as_ref()
        .is_none_or(|bytes| receipt["evidence_sha256"] != digest(bytes))
    {
        return Err("release evidence changed".into());
    }
    if closing {
        let producer = &next["producer"];
        let (state, complete) = match producer["outcome"].as_str() {
            Some("success") if producer["exit_code"] == 0 => ("complete", true),
            Some("failure") if producer["exit_code"].as_i64().is_some_and(|v| v != 0) => {
                ("failed", true)
            }
            Some("unknown") if producer["exit_code"].is_null() => ("pending", false),
            _ => return Ok(false),
        };
        if producer["status"] != "stopped"
            || next["state"] != state
            || next["membership_complete"] != complete
            || ["evidence_ref", "evidence_sha256", "reason"]
                .iter()
                .any(|key| producer[*key] != receipt[*key])
        {
            return Ok(false);
        }
        if before
            .iter()
            .filter(|r| !after.contains(r))
            .any(|r| r["kind"] != "execution")
        {
            return Ok(false);
        }
    }
    let mut a = previous.clone();
    let mut b = next.clone();
    for field in ["references", "revision", "updated_at", receipt_key] {
        a.as_object_mut().map(|o| o.remove(field));
        b.as_object_mut().map(|o| o.remove(field));
    }
    if closing {
        for field in ["producer", "state", "membership_complete"] {
            a.as_object_mut().map(|o| o.remove(field));
            b.as_object_mut().map(|o| o.remove(field));
        }
    }
    Ok(a == b)
}

fn add_scope(scopes: &mut Vec<crate::coordination::Scope>, path: PathBuf, exclusive: bool) {
    if let Some(scope) = scopes.iter_mut().find(|s| s.path == path) {
        scope.exclusive |= exclusive;
    } else {
        scopes.push(crate::coordination::Scope { path, exclusive });
    }
}

fn record_scopes(
    root: &Path,
    record: &Value,
    scopes: &mut Vec<crate::coordination::Scope>,
    auth: crate::Auth<'_>,
) -> Result<(), String> {
    let id = string(record, "id")?;
    let source = root.join("artifacts/maintenance/lifecycles");
    let filename = source.join(format!("{}.json", digest(id.as_bytes())));
    paths::check(root, &filename, auth)?;
    auth(&filename, AccessMode::Read)?;
    auth(&filename, AccessMode::Write)?;
    add_scope(scopes, filename, true);
    add_scope(
        scopes,
        root.join("artifacts/maintenance/requests/group-scopes")
            .join(crate::hash(&id)?),
        true,
    );
    for path in crate::registry::validate(root, record)? {
        paths::check(root, &path, auth)?;
        auth(&path, AccessMode::Write)?;
        add_scope(scopes, path, true);
    }
    for reference in record["references"]
        .as_array()
        .ok_or("references required")?
    {
        let target = string(reference, "id")?;
        let target_file = source.join(format!("{}.json", digest(target.as_bytes())));
        paths::check(root, &target_file, auth)?;
        auth(&target_file, AccessMode::Read)?;
        add_scope(scopes, target_file.clone(), false);
        add_scope(
            scopes,
            root.join("artifacts/maintenance/requests/group-scopes")
                .join(crate::hash(&target)?),
            false,
        );
        if let Some(bytes) = read_record(&target_file)? {
            let target_record: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            if target_record["id"] != target {
                return Err("hashed reference ID mismatch".into());
            }
            for path in crate::registry::validate(root, &target_record)? {
                paths::check(root, &path, auth)?;
                auth(&path, AccessMode::Read)?;
                add_scope(scopes, path, false);
            }
        }
    }
    Ok(())
}

fn release_catalog(
    lease: &mut Option<Sentinel<'_>>,
    context: &Context<'_>,
    lock: &Path,
) -> Result<(), String> {
    let result = lease
        .take()
        .ok_or("catalog lease already released")?
        .release();
    context.catalog_locks.borrow_mut().remove(lock);
    *context.catalog.borrow_mut() = Default::default();
    result
}

fn admitted(
    root: &Path,
    request: &Value,
    scopes: &[crate::coordination::Scope],
    auth: crate::Auth<'_>,
    execute: impl FnOnce() -> Result<Value, String>,
) -> Result<Value, String> {
    crate::admission::with_domain(root, auth, true, |domain, queue_auth| {
        let result = crate::coordination::run(domain, request, scopes, queue_auth, execute);
        let mut control = request.clone();
        control["operation"] = json!("request_status");
        // Unknown custody and persistence failures retain their evidence.
        if crate::coordination::control(domain, &control, queue_auth)
            .is_ok_and(|status| status["status"] == "terminal")
        {
            control["operation"] = json!("request_ack");
            crate::coordination::control(domain, &control, queue_auth)?;
        }
        result
    })
}

fn cleanup_lifetime<'a>(
    root: &Path,
    lock: &Path,
    operation: &str,
    wait_ms: u64,
    preferences_home: &Path,
    lease: &mut Option<Sentinel<'a>>,
    reservations: &mut Option<crate::reservations::ReservationSet<'a>>,
    context: crate::Auth<'a>,
    input: &mut impl BufRead,
    response_id: &mut Value,
    last_command_id: &mut u64,
) -> Result<Value, String> {
    let mut budget = None;
    loop {
        let line = read_bounded(input)
            .map_err(|e| crate::coordination::unknown(&e))?
            .ok_or_else(|| {
                crate::coordination::unknown("cleanup input closed before finish proof")
            })?;
        let command: Value = serde_json::from_slice(&line)
            .map_err(|_| crate::coordination::unknown("invalid cleanup lease JSON"))?;
        *response_id = command
            .get("id")
            .filter(|v| v.as_u64().is_some_and(|n| n > 0))
            .cloned()
            .ok_or_else(|| crate::coordination::unknown("positive cleanup command id required"))?;
        let sequence = response_id
            .as_u64()
            .ok_or_else(|| crate::coordination::unknown("cleanup command id missing"))?;
        if sequence <= *last_command_id {
            return Err(crate::coordination::unknown(
                "lease command replay rejected",
            ));
        }
        *last_command_id = sequence;
        match command["operation"].as_str() {
            Some("release_catalog") => {
                let result: Result<Value, String> = (|| {
                    reservations
                        .as_ref()
                        .ok_or("producer reservation set missing")?
                        .verify(context)?;
                    release_catalog(lease, context, lock)?;
                    // The caller cannot begin physical I/O before this response.
                    let deadline = std::time::Instant::now() + Duration::from_millis(wait_ms);
                    budget = Some(crate::disk_budget::acquire(
                        preferences_home,
                        root,
                        &|| context.cancelled() || std::time::Instant::now() >= deadline,
                    )?);
                    Ok(json!({"catalog_released":true}))
                })();
                if let Err(error) = &result {
                    return Err(crate::coordination::unknown(error));
                }
                emit(response_id.clone(), result).map_err(|e| crate::coordination::unknown(&e))?;
            }
            Some("finish_producers") => {
                let result = (|| {
                    if lease.is_none() {
                        *lease = Some(acquire_lease(root, lock, operation, wait_ms, context)?);
                        context
                            .catalog_locks
                            .borrow_mut()
                            .insert(lock.to_path_buf());
                    }
                    lease.as_ref().ok_or("catalog lease missing")?.verify()?;
                    let outcomes = command["outcomes"]
                        .as_array()
                        .ok_or("producer outcomes required")?;
                    let evidence = json!({"evidence_ref":string(&command,"evidence_ref")?,"evidence_sha256":string(&command,"evidence_sha256")?});
                    reservations
                        .as_mut()
                        .ok_or("producer reservation set missing")?
                        .release_producers(outcomes, &evidence, context)?;
                    lease.as_ref().ok_or("catalog lease missing")?.verify()?;
                    if !context.reservations.borrow().is_empty() {
                        return Err(
                            "producer terminal proof incomplete; reservations retained".into()
                        );
                    }
                    if let Some(guard) = budget.take() {
                        guard.release();
                    }
                    Ok(
                        json!({"finished":true,"reservations_retained":context.reservations.borrow().keys().cloned().collect::<Vec<_>>()}),
                    )
                })();
                return result.map_err(|e: String| crate::coordination::unknown(&e));
            }
            Some("release") => {
                if lease.is_some() {
                    release_catalog(lease, context, lock)
                        .map_err(|e| crate::coordination::unknown(&e))?;
                }
                return Err(crate::coordination::unknown(
                    "cleanup released before finish proof; reservations retained",
                ));
            }
            _ => {
                return Err(crate::coordination::unknown(
                    "unexpected command during producer cleanup",
                ));
            }
        }
    }
}

fn acquire_lease<'a>(
    root: &Path,
    lock: &Path,
    operation: &str,
    wait_ms: u64,
    auth: crate::Auth<'a>,
) -> Result<Sentinel<'a>, String> {
    crate::lock_recovery::wait_for_lock_cancel(
        Duration::from_millis(wait_ms),
        &|| auth.cancelled(),
        || Sentinel::acquire(root, lock, operation, auth),
    )
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
#[cfg(windows)]
struct LeaseCaller(std::os::windows::io::OwnedHandle);
#[cfg(windows)]
impl LeaseCaller {
    fn new(pid: u32) -> Result<Self, String> {
        use std::os::windows::io::FromRawHandle;
        use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE};
        let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
        if handle.is_null() {
            return Err(format!(
                "lease parent unavailable: {}",
                io::Error::last_os_error()
            ));
        }
        Ok(Self(unsafe {
            std::os::windows::io::OwnedHandle::from_raw_handle(handle)
        }))
    }
    fn cancelled(&self) -> bool {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Foundation::{
            ERROR_BROKEN_PIPE, ERROR_PIPE_NOT_CONNECTED, WAIT_TIMEOUT,
        };
        use windows_sys::Win32::System::Threading::WaitForSingleObject;
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn PeekNamedPipe(
                handle: *mut std::ffi::c_void,
                buffer: *mut std::ffi::c_void,
                size: u32,
                read: *mut u32,
                available: *mut u32,
                remaining: *mut u32,
            ) -> i32;
        }
        if unsafe { WaitForSingleObject(self.0.as_raw_handle(), 0) } != WAIT_TIMEOUT {
            return true;
        }
        // Peek never consumes protocol bytes. Non-pipe stdin keeps its existing
        // synchronous reader behavior; only definite disconnection cancels here.
        let result = unsafe {
            PeekNamedPipe(
                io::stdin().as_raw_handle(),
                std::ptr::null_mut(),
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        result == 0
            && matches!(io::Error::last_os_error().raw_os_error(),
            Some(code) if code == ERROR_BROKEN_PIPE as i32 || code == ERROR_PIPE_NOT_CONNECTED as i32)
    }
}
#[cfg(unix)]
struct LeaseCaller(u32);
#[cfg(unix)]
impl LeaseCaller {
    fn new(pid: u32) -> Result<Self, String> {
        Ok(Self(pid))
    }
    fn cancelled(&self) -> bool {
        use std::os::fd::AsRawFd;
        #[repr(C)]
        struct PollFd {
            fd: i32,
            events: i16,
            revents: i16,
        }
        #[cfg(target_os = "macos")]
        type PollCount = u32;
        #[cfg(not(target_os = "macos"))]
        type PollCount = usize;
        unsafe extern "C" {
            fn poll(fds: *mut PollFd, count: PollCount, timeout: i32) -> i32;
        }
        let mut input = PollFd {
            fd: io::stdin().as_raw_fd(),
            events: 0,
            revents: 0,
        };
        crate::lock_recovery::owner_absent(self.0).is_ok()
            || (unsafe { poll(&mut input, 1, 0) } > 0 && input.revents & (8 | 16 | 32) != 0)
    }
}

/// CLI arguments: --lease ABS_LOCK --operation BOUNDED --wait-ms 0..600000 --parent-pid PID.
pub fn run(lock: &Path, operation: &str, wait_ms: u64, parent_pid: u32) -> Result<(), String> {
    let preferences_home = crate::preferences::home()?;
    let _admission = crate::preferences::enter(&preferences_home, operation)?;
    if !lock.is_absolute()
        || lock
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
        || wait_ms > 600_000
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
    let caller = LeaseCaller::new(parent_pid)?;
    let cancelled = || caller.cancelled();
    let mut context = Context::with_cancellation(&authorize, &cancelled);
    context.coordination_home = Some(preferences_home.clone());
    context.lock_wait.set(Duration::from_millis(wait_ms));
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
    let mut physical_budget = None;
    emit(json!(0), Ok(owner))?;
    let mut input = io::stdin().lock();
    let mut last_command_id = 0;
    let process_nonce = crate::hash(&(
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
            .to_string(),
    ))?;
    while let Some(line) = read_bounded(&mut input)? {
        let command: Value = serde_json::from_slice(&line).map_err(|_| "invalid lease JSON")?;
        let id = command
            .get("id")
            .filter(|id| id.as_u64().is_some_and(|v| v > 0))
            .ok_or("positive command id required")?
            .clone();
        let selected = command["operation"].as_str();
        let sequence = id.as_u64().ok_or("command id missing")?;
        if sequence <= last_command_id {
            return Err("lease command replay rejected".into());
        }
        last_command_id = sequence;
        if selected == Some("release") {
            let result = if let Some(lease) = lease.take() {
                lease.release()
            } else {
                Ok(())
            };
            context.catalog_locks.borrow_mut().remove(&catalog_lock);
            *context.catalog.borrow_mut() = Default::default();
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
        if selected == Some("reserve_producers") && wait_ms > 0 {
            let mut response_id = id.clone();
            let result = (|| {
                let _reservation_admission =
                    crate::preferences::enter(&preferences_home, "reserve_producers")?;
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
                let mut scopes = Vec::new();
                for record in &records {
                    record_scopes(root, record, &mut scopes, &context)?;
                }
                release_catalog(&mut lease, &context, &catalog_lock)?;
                let request = json!({"_coordination_project":fs::canonicalize(root).map_err(|e|e.to_string())?,"operation":"lifecycle.cleanup","records":records,"producer_admission_identity":format!("{process_nonce}-{}",id.as_u64().ok_or("command id missing")?),"coordination":{"session_id":format!("lease-{parent_pid}-{}",std::process::id()),"request_id":format!("{process_nonce}-{}",id.as_u64().ok_or("command id missing")?),"wait_ms":wait_ms}});
                admitted(root, &request, &scopes, &context, || {
                    lease = Some(acquire_lease(root, lock, operation, wait_ms, &context)?);
                    context
                        .catalog_locks
                        .borrow_mut()
                        .insert(catalog_lock.clone());
                    let current = load_producers(root, &command, &context)?;
                    if current != records {
                        return Err("producer record snapshot changed during admission".into());
                    }
                    let mut current_scopes = Vec::new();
                    for record in &current {
                        record_scopes(root, record, &mut current_scopes, &context)?;
                    }
                    if current_scopes != scopes {
                        return Err("producer scopes changed during admission".into());
                    }
                    reservations = Some(crate::reservations::ReservationSet::acquire_producers(
                        root, &current, &context,
                    )?);
                    lease
                        .as_ref()
                        .ok_or("catalog lease missing")?
                        .verify()
                        .map_err(|e| crate::coordination::unknown(&e))?;
                    let response = json!({"reserved":current.iter().map(|r|r["id"].clone()).collect::<Vec<_>>(),"observed":reservations.as_ref().ok_or("producer reservation set missing")?.observed()});
                    emit(id.clone(), Ok(response)).map_err(|e| crate::coordination::unknown(&e))?;
                    response_id = Value::Null;
                    cleanup_lifetime(
                        root,
                        lock,
                        operation,
                        wait_ms,
                        &preferences_home,
                        &mut lease,
                        &mut reservations,
                        &context,
                        &mut input,
                        &mut response_id,
                        &mut last_command_id,
                    )
                })
            })();
            emit(response_id, result)?;
            continue;
        }
        let result = (|| -> Result<Value, String> {
            match selected {
                Some("write_record" | "remove_record") => {
                    if lock != catalog_lock {
                        return Err("record operations require exact lifecycle catalog lock".into());
                    }
                    lease
                        .as_ref()
                        .ok_or("catalog lease was released")?
                        .verify()?;
                    let record_id = if selected == Some("write_record") {
                        string(&command["record"], "id")?
                    } else {
                        string(&command, "record_id")?
                    };
                    let filename = catalog_lock
                        .parent()
                        .ok_or("missing catalog")?
                        .join(format!("{}.json", digest(record_id.as_bytes())));
                    paths::check(root, &filename, &context)?;
                    context(&filename, AccessMode::Read)?;
                    let old = read_record(&filename)?;
                    match (&command["expected_sha256"], &old) {
                        (Value::Null, None) if command.get("expected_sha256").is_some() => {}
                        (Value::String(expected), Some(bytes)) if expected == &digest(bytes) => {}
                        _ => return Err("lifecycle record CAS mismatch".into()),
                    }
                    let previous = old
                        .as_ref()
                        .map(|bytes| {
                            serde_json::from_slice::<Value>(bytes).map_err(|e| e.to_string())
                        })
                        .transpose()?;
                    let mut scopes = Vec::new();
                    if let Some(previous) = &previous {
                        record_scopes(root, previous, &mut scopes, &context)?;
                    }
                    if selected == Some("write_record") {
                        record_scopes(root, &command["record"], &mut scopes, &context)?;
                    }
                    let bypass = if selected == Some("write_record") {
                        previous
                            .as_ref()
                            .map(|previous| {
                                reference_release(root, previous, &command["record"], &context)
                            })
                            .transpose()?
                            .unwrap_or(false)
                    } else {
                        false
                    };
                    if bypass {
                        return mutate(
                            root,
                            lock,
                            lease.as_ref().ok_or("catalog lease missing")?,
                            &command,
                            &context,
                        );
                    }
                    if wait_ms == 0 {
                        crate::admission::check_external(root, &scopes, &context)?;
                        return mutate(
                            root,
                            lock,
                            lease.as_ref().ok_or("catalog lease missing")?,
                            &command,
                            &context,
                        );
                    }
                    release_catalog(&mut lease, &context, &catalog_lock)?;
                    let request = json!({"_coordination_project":fs::canonicalize(root).map_err(|e|e.to_string())?,"operation":"lifecycle.write","command":command,"coordination":{"session_id":format!("lease-{parent_pid}-{}",std::process::id()),"request_id":format!("{process_nonce}-{}", id.as_u64().ok_or("command id missing")?),"wait_ms":wait_ms}});
                    admitted(root, &request, &scopes, &context, || {
                        lease = Some(acquire_lease(root, lock, operation, wait_ms, &context)?);
                        context
                            .catalog_locks
                            .borrow_mut()
                            .insert(catalog_lock.clone());
                        let mut current_scopes = Vec::new();
                        if let Some(previous) = &previous {
                            record_scopes(root, previous, &mut current_scopes, &context)?;
                        }
                        if selected == Some("write_record") {
                            record_scopes(root, &command["record"], &mut current_scopes, &context)?;
                        }
                        if current_scopes != scopes {
                            return Err("record scopes changed during admission".into());
                        }
                        mutate(
                            root,
                            lock,
                            lease.as_ref().ok_or("catalog lease missing")?,
                            &command,
                            &context,
                        )
                    })
                }
                Some("reserve_producers") => {
                    let _reservation_admission =
                        crate::preferences::enter(&preferences_home, "reserve_producers")?;
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
                    let mut scopes = Vec::new();
                    for record in &records {
                        record_scopes(root, record, &mut scopes, &context)?;
                    }
                    crate::admission::check_external(root, &scopes, &context)?;
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
                    *context.catalog.borrow_mut() = Default::default();
                    released?;
                    physical_budget = Some(crate::disk_budget::try_acquire(
                        &preferences_home, root, &||context.cancelled(),
                    )?.ok_or("physical I/O budget busy; catalog released, reservations retained; no deletion admitted")?);
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
                    if let Some(guard) = physical_budget.take() {
                        guard.release();
                    }
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

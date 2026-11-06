//! Producer registry observations bind one owner and its actual consumers.
use crate::{AccessMode, Auth, hash, paths, string};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::rc::Rc;

/// Parsed records are request-local. Filesystem snapshots additionally require
/// continuous ownership of this source's catalog lease and explicit invalidation.
#[derive(Default)]
pub(crate) struct CatalogCache {
    records: BTreeMap<(PathBuf, PathBuf), Rc<CachedRecord>>,
    snapshots: BTreeMap<(PathBuf, PathBuf), Rc<CatalogSnapshot>>,
    epochs: BTreeMap<(PathBuf, PathBuf), Rc<()>>,
    #[cfg(test)]
    misses: usize,
}

type CatalogRecords = BTreeMap<String, Rc<CachedRecord>>;

#[derive(Debug, PartialEq)]
struct CatalogSnapshot {
    records: CatalogRecords,
    // IDs stay sorted and deduplicated exactly as the original records scan.
    // This is a projection of admitted bytes, never a filesystem change index.
    related: BTreeMap<String, BTreeSet<String>>,
}
impl CatalogSnapshot {
    fn new(records: CatalogRecords) -> Self {
        let mut related = BTreeMap::<String, BTreeSet<String>>::new();
        for (id, record) in &records {
            related.entry(id.clone()).or_default().insert(id.clone());
            if let Some(references) = record["references"].as_array() {
                for reference in references {
                    if let Some(target) = reference["id"].as_str() {
                        related
                            .entry(target.to_owned())
                            .or_default()
                            .insert(id.clone());
                    }
                }
            }
        }
        Self { records, related }
    }

    fn related(&self, id: &str) -> impl Iterator<Item = (&String, &Rc<CachedRecord>)> {
        self.related
            .get(id)
            .into_iter()
            .flatten()
            .filter_map(|id| self.records.get_key_value(id))
    }
}
impl std::ops::Deref for CatalogSnapshot {
    type Target = CatalogRecords;
    fn deref(&self) -> &Self::Target {
        &self.records
    }
}

#[derive(Debug, PartialEq)]
struct CachedRecord {
    bytes: Vec<u8>,
    record: Value,
    member_paths: Vec<PathBuf>,
    canonical: Value,
}
impl std::ops::Deref for CachedRecord {
    type Target = Value;
    fn deref(&self) -> &Value {
        &self.record
    }
}

pub(crate) struct CatalogLock<'a> {
    path: PathBuf,
    _sentinel: crate::lock_recovery::Sentinel<'a>,
    auth: Auth<'a>,
}
impl Drop for CatalogLock<'_> {
    fn drop(&mut self) {
        self.auth.catalog_locks.borrow_mut().remove(&self.path);
        // Parsed values remain reusable only after a fresh byte comparison.
        // Custody release invalidates filesystem snapshots, not validated JSON.
        let mut cache = self.auth.catalog.borrow_mut();
        cache.snapshots.clear();
        cache.epochs.clear();
    }
}
pub(crate) fn lock_request<'a>(
    root: &Path,
    request: &Value,
    state: &crate::State,
    auth: Auth<'a>,
) -> Result<Vec<CatalogLock<'a>>, crate::lock_recovery::LockAcquireError> {
    let mut sources = BTreeSet::new();
    let mut add = |group: &Value| -> Result<(), String> {
        if group["membership_source_format"] == "producer_registry_v1" {
            sources.insert(paths::resolve(
                root,
                Path::new(string(group, "membership_source")?),
            )?);
        }
        Ok(())
    };
    match request["operation"].as_str() {
        Some("apply") => {
            for choice in request["decisions"].as_array().ok_or("missing decisions")? {
                if let Some(group) = state
                    .items
                    .get(string(choice, "id")?)
                    .and_then(crate::groups::id)
                    .and_then(|id| state.groups.get(id))
                {
                    add(group)?;
                }
            }
        }
        Some("register") if request.get("refresh_group").is_some() => {
            add(state
                .groups
                .get(string(&request["refresh_group"], "id")?)
                .ok_or("unknown lifecycle group")?)?;
        }
        Some("register") if request.get("group").is_some() => {
            let incoming = &request["group"];
            let previous = state.groups.get(string(incoming, "id")?);
            if let Some(previous) = previous {
                add(previous)?;
            }
            let mut effective = incoming.clone();
            for field in ["membership_source", "membership_source_format"] {
                if effective.get(field).is_none() {
                    if let Some(value) = previous.and_then(|old| old.get(field)) {
                        effective[field] = value.clone();
                    }
                }
            }
            add(&effective)?;
        }
        _ => {}
    }
    if matches!(
        request["operation"].as_str(),
        Some("apply" | "register" | "begin_run")
    ) {
        let source = root.join("artifacts/maintenance/lifecycles");
        paths::check(root, &source, auth)?;
        if !source.exists() {
            auth(
                source.parent().ok_or("missing catalog parent")?,
                AccessMode::Write,
            )?;
            auth(&source, AccessMode::Write)?;
            std::fs::create_dir(&source).map_err(|e| e.to_string())?;
        }
        sources.insert(source);
    }
    let mut locks = Vec::new();
    for source in sources {
        paths::check(root, &source, auth)?;
        auth(&source, AccessMode::Write)?;
        let path = source.join("catalog.lock");
        paths::check(root, &path, auth)?;
        auth(&path, AccessMode::Write)?;
        let sentinel = crate::lock_recovery::Sentinel::acquire(root, &path, "catalog", auth)?;
        // Acquisition starts a new custody epoch, even within one dispatch.
        let key = (root.to_owned(), source.to_owned());
        let mut cache = auth.catalog.borrow_mut();
        cache.snapshots.remove(&key);
        cache.epochs.remove(&key);
        drop(cache);
        auth.catalog_locks.borrow_mut().insert(path.clone());
        locks.push(CatalogLock {
            path,
            _sentinel: sentinel,
            auth,
        });
    }
    Ok(locks)
}
fn check_lock(root: &Path, source: &Path, auth: Auth<'_>) -> Result<(), String> {
    let path = source.join("catalog.lock");
    if !auth.catalog_locks.borrow().contains(&path) {
        crate::lock_recovery::check_available(root, &path, auth)?;
    }
    Ok(())
}

fn nonblank(value: &Value, key: &str) -> Result<(), String> {
    if string(value, key)?.trim().is_empty() {
        return Err(format!("blank producer registry {key}"));
    }
    Ok(())
}
fn names(root: &Path, source: &Path, auth: Auth<'_>) -> Result<Vec<PathBuf>, String> {
    paths::check(root, source, auth)?;
    if !std::fs::symlink_metadata(source)
        .map_err(|e| e.to_string())?
        .is_dir()
    {
        return Err("producer registry must be a flat directory".into());
    }
    auth(source, AccessMode::Read)?;
    let mut names = Vec::new();
    for entry in std::fs::read_dir(source).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path == source.join("reservations") {
            paths::check(root, &path, auth)?;
            if !std::fs::symlink_metadata(&path)
                .map_err(|e| e.to_string())?
                .is_dir()
            {
                return Err("invalid reservation directory".into());
            }
            continue;
        }
        // Individual JSON records may be unavailable. Check each through read(),
        // independently of the directory and its other control entries.
        if path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
        {
            names.push(path);
            continue;
        }
        paths::check(root, &path, auth)?;
        if !std::fs::symlink_metadata(&path)
            .map_err(|e| e.to_string())?
            .is_file()
        {
            return Err("producer registry contains a nonregular or nested entry".into());
        }
    }
    names.sort();
    Ok(names)
}
enum RecordReadError {
    Unavailable,
    Changed,
}
impl From<String> for RecordReadError {
    fn from(_: String) -> Self {
        Self::Unavailable
    }
}
impl From<&str> for RecordReadError {
    fn from(_: &str) -> Self {
        Self::Unavailable
    }
}

fn read(root: &Path, path: &Path, auth: Auth<'_>) -> Result<Vec<u8>, RecordReadError> {
    use std::io::Read;
    let before = paths::checked_metadata(root, path, auth)?.ok_or("producer record missing")?;
    if !before.is_file() || before.len() > 16 * 1024 * 1024 {
        return Err("invalid or oversized producer record".into());
    }
    auth(path, AccessMode::Read)?;
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 65536];
    loop {
        auth(path, AccessMode::Read)?;
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        if bytes.len() + count > 16 * 1024 * 1024 {
            return Err("oversized producer record".into());
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    let after = paths::checked_metadata(root, path, auth)?.ok_or("producer record missing")?;
    if before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
        || paths::platform_identity(&before) != paths::platform_identity(&after)
    {
        return Err(RecordReadError::Changed);
    }
    Ok(bytes)
}
pub(crate) fn validate(root: &Path, record: &Value) -> Result<Vec<PathBuf>, String> {
    for key in ["id", "kind", "owner", "state"] {
        nonblank(record, key)?;
    }
    if record["schema"] != 1
        || !["version", "run", "work"].contains(&string(record, "kind")?)
        || !["pending", "complete", "failed", "retained"].contains(&string(record, "state")?)
        || !record["membership_complete"].is_boolean()
    {
        return Err("invalid producer registry record".into());
    }
    if !record["version"].is_null() {
        nonblank(record, "version")?;
    }
    if let Some(producer) = record.get("producer") {
        let outcome = string(producer, "outcome")?;
        let exit = &producer["exit_code"];
        if producer["status"] != "stopped"
            || !["success", "failure", "unknown"].contains(&outcome)
            || !(exit.is_null() || exit.as_i64().is_some())
            || (outcome == "success" && exit != 0)
            || (outcome == "failure" && exit == 0)
            || (outcome == "unknown" && !exit.is_null())
            || !producer.get("exit_code").is_some()
            || !string(producer, "evidence_sha256")?
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || string(producer, "evidence_sha256")?.len() != 64
        {
            return Err("invalid producer stop evidence".into());
        }
        nonblank(producer, "reason")?;
        nonblank(producer, "evidence_ref")?;
    }
    let members = record["members"]
        .as_array()
        .filter(|m| !m.is_empty())
        .ok_or("invalid producer members")?;
    let mut member_paths = Vec::with_capacity(members.len());
    for member in members {
        for key in ["generated", "protection_known"] {
            if member.get(key).is_some_and(|value| !value.is_boolean()) {
                return Err(format!("invalid producer member {key}"));
            }
        }
        nonblank(member, "role")?;
        let path = Path::new(string(member, "path")?);
        if !path.is_absolute() {
            return Err("producer member must be absolute".into());
        }
        let path = paths::resolve(root, path)?;
        let allowed = [root.join("artifacts"), root.join("engine/codex-rs/target")];
        if !allowed
            .iter()
            .any(|base| paths::within(&path, base) && path != *base)
            || paths::within(&path, &root.join("artifacts/maintenance"))
            || path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .components()
                .any(|part| {
                    [".git", ".azrael-ex", ".codex", ".ssh"]
                        .iter()
                        .any(|name| part.as_os_str() == *name)
                })
        {
            return Err("producer member overlaps source or control state".into());
        }
        member_paths.push(path);
    }
    for reference in record["references"]
        .as_array()
        .ok_or("invalid producer references")?
    {
        nonblank(reference, "id")?;
        nonblank(reference, "reason")?;
        if let Some(member_paths) = reference.get("member_paths") {
            let member_paths = member_paths
                .as_array()
                .filter(|paths| !paths.is_empty())
                .ok_or("invalid reference member_paths")?;
            for path in member_paths {
                let path = Path::new(path.as_str().ok_or("invalid reference member path")?);
                if !path.is_absolute() {
                    return Err("reference member path must be absolute".into());
                }
                paths::resolve(root, path)?;
            }
        }
        if reference
            .get("target_revision")
            .is_some_and(|v| v.as_u64().is_none())
        {
            return Err("invalid reference target_revision".into());
        }
        if reference
            .get("target_version")
            .is_some_and(|v| !v.is_null() && v.as_str().is_none_or(str::is_empty))
        {
            return Err("invalid reference target_version".into());
        }
    }
    Ok(member_paths)
}
fn canonical(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(k, v)| (k.clone(), canonical(v)))
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .collect(),
        ),
        Value::Array(array) => Value::Array(array.iter().map(canonical).collect()),
        value => value.clone(),
    }
}

fn sha256(value: &Value) -> bool {
    value.as_str().is_some_and(|value| {
        value.len() == 64
            && value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}

// Recovery writers use UTC ISO timestamps. A timestamp records the verification
// event; its age never establishes producer termination or cleanup authority.
fn utc_timestamp(value: &Value) -> bool {
    let Some(text) = value.as_str() else {
        return false;
    };
    let bytes = text.as_bytes();
    if bytes.len() < 20
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes.last() != Some(&b'Z')
        || [0..4, 5..7, 8..10, 11..13, 14..16, 17..19]
            .iter()
            .any(|range| !bytes[range.clone()].iter().all(u8::is_ascii_digit))
        || (bytes.len() != 20
            && (bytes.len() < 22
                || bytes[19] != b'.'
                || !bytes[20..bytes.len() - 1].iter().all(u8::is_ascii_digit)))
    {
        return false;
    }
    let number = |range: std::ops::Range<usize>| {
        bytes[range]
            .iter()
            .fold(0u32, |number, digit| number * 10 + u32::from(digit - b'0'))
    };
    let year = number(0..4);
    let month = number(5..7);
    let day = number(8..10);
    let days = match month {
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => return false,
    };
    year > 0
        && day > 0
        && day <= days
        && number(11..13) < 24
        && number(14..16) < 60
        && number(17..19) < 60
}

fn cleanup_evidence(
    root: &Path,
    source: &Path,
    members: &[PathBuf],
    reference: &Value,
    digest: &Value,
    auth: Auth<'_>,
) -> Result<Vec<u8>, String> {
    use sha2::{Digest, Sha256};
    let path = Path::new(reference.as_str().ok_or("invalid cleanup evidence path")?);
    if !path.is_absolute() {
        return Err("absolute cleanup evidence path required".into());
    }
    let path = paths::resolve(root, path)?;
    if paths::within(&path, source)
        || paths::within(&path, &root.join("artifacts/maintenance/lifecycles"))
        || members.iter().any(|member| paths::within(&path, member))
        || !sha256(digest)
    {
        return Err("cleanup evidence must survive independently of members and registry".into());
    }
    check_single_link(root, &path, auth)?;
    let bytes = read(root, &path, auth).map_err(|_| "cleanup evidence unavailable or changed")?;
    check_single_link(root, &path, auth)?;
    if digest.as_str() != Some(format!("{:x}", Sha256::digest(&bytes)).as_str()) {
        return Err("cleanup evidence SHA-256 mismatch".into());
    }
    Ok(bytes)
}

fn check_single_link(root: &Path, path: &Path, auth: Auth<'_>) -> Result<(), String> {
    paths::check(root, path, auth)?;
    auth(path, AccessMode::Read)?;
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    #[cfg(unix)]
    let links = {
        use std::os::unix::fs::MetadataExt;
        metadata.nlink()
    };
    #[cfg(windows)]
    let links = {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_STANDARD_INFO, FileStandardInfo, GetFileInformationByHandleEx,
        };
        let mut standard = FILE_STANDARD_INFO::default();
        // The borrowed file keeps the handle alive for the correctly sized query.
        if unsafe {
            GetFileInformationByHandleEx(
                file.as_raw_handle(),
                FileStandardInfo,
                (&mut standard as *mut FILE_STANDARD_INFO).cast(),
                std::mem::size_of_val(&standard) as u32,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
        u64::from(standard.NumberOfLinks)
    };
    #[cfg(not(any(unix, windows)))]
    let links = 0;
    paths::check(root, path, auth)?;
    let current = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file()
        || links != 1
        || paths::platform_identity(&metadata) != paths::platform_identity(&current)
    {
        return Err("independent regular single-link cleanup evidence required".into());
    }
    Ok(())
}

/// This receipt establishes cleanup eligibility only. The historical producer
/// result remains unknown and all current ownership/reference guards still run.
fn validate_cleanup_recovery(
    root: &Path,
    source: &Path,
    record: &Value,
    members: &[PathBuf],
    auth: Auth<'_>,
) -> Result<bool, String> {
    let Some(receipt) = record.get("cleanup_recovery") else {
        return Ok(false);
    };
    if receipt["schema"] != 1
        || receipt["producer_stopped_verified"] != true
        || receipt["membership_complete_verified"] != true
        || !receipt["original_membership_complete"].is_boolean()
        || receipt["source_revision"].as_u64().is_none_or(|revision| {
            revision == 0
                || record["revision"]
                    .as_u64()
                    .is_none_or(|current| current <= revision)
        })
        || record["membership_complete"] != true
        || !utc_timestamp(&receipt["verified_at"])
    {
        return Err("invalid cleanup recovery receipt".into());
    }
    nonblank(receipt, "reason")?;
    for field in ["id", "owner", "kind", "version", "generation", "members"] {
        if receipt.get(field).is_none() || receipt[field] != record[field] {
            return Err(format!("cleanup recovery {field} binding changed"));
        }
    }
    for field in ["version", "generation"] {
        if !receipt[field].is_null() && !receipt[field].is_string() {
            return Err(format!("invalid cleanup recovery {field}"));
        }
    }
    if receipt.get("original_producer").is_none()
        || receipt["original_producer"] != record["producer"]
        || receipt["original_state"] != record["state"]
        || record["state"] != "pending"
        || !(record["producer"].is_null()
            || record["producer"]["status"] == "stopped"
                && record["producer"]["outcome"] == "unknown"
                && record["producer"]["exit_code"].is_null())
        || record["members"].as_array().is_none_or(|members| {
            members
                .iter()
                .any(|member| member["generated"] != true || member["protection_known"] != true)
        })
    {
        return Err("cleanup recovery original producer or membership changed".into());
    }
    let bytes = cleanup_evidence(
        root,
        source,
        members,
        &receipt["evidence_ref"],
        &receipt["evidence_sha256"],
        auth,
    )?;
    let evidence: Value =
        serde_json::from_slice(&bytes).map_err(|_| "invalid cleanup recovery evidence JSON")?;
    let expected_source = json!({
        "id":receipt["id"],"owner":receipt["owner"],"kind":receipt["kind"],
        "version":receipt["version"],"generation":receipt["generation"],
        "revision":receipt["source_revision"],"state":receipt["original_state"],
        "membership_complete":receipt["original_membership_complete"],
        "producer":receipt["original_producer"],"members":receipt["members"]
    });
    if evidence["schema"] != 1
        || evidence["action"] != "recover-cleanup"
        || evidence["source"] != expected_source
        || evidence["producer_stopped_verified"] != true
        || evidence["membership_complete_verified"] != true
    {
        return Err("cleanup recovery evidence binding changed".into());
    }
    nonblank(&evidence, "stop_basis")?;
    nonblank(&evidence, "membership_basis")?;
    for proof in evidence["producer_evidence"]
        .as_array()
        .filter(|proofs| !proofs.is_empty())
        .ok_or("cleanup recovery requires independent producer evidence")?
    {
        let evidence_path = paths::resolve(root, Path::new(string(receipt, "evidence_ref")?))?;
        let proof_path = paths::resolve(root, Path::new(string(proof, "path")?))?;
        if paths::within(&evidence_path, &proof_path) && paths::within(&proof_path, &evidence_path)
        {
            return Err("independent cleanup recovery producer proof required".into());
        }
        cleanup_evidence(
            root,
            source,
            members,
            &proof["path"],
            &proof["sha256"],
            auth,
        )?;
    }
    Ok(true)
}

fn catalog(
    root: &Path,
    source: &Path,
    owner_id: &str,
    auth: Auth<'_>,
) -> Result<Rc<CatalogSnapshot>, String> {
    crate::timing::phase("registry.catalog", Some(source), || {
        let key = (root.to_owned(), source.to_owned());
        let lock = source.join("catalog.lock");
        let epoch = if auth.catalog_locks.borrow().contains(&lock) {
            Some(
                auth.catalog
                    .borrow_mut()
                    .epochs
                    .entry(key.clone())
                    .or_insert_with(|| Rc::new(()))
                    .clone(),
            )
        } else {
            None
        };
        let cached = if epoch.is_some() {
            auth.catalog.borrow().snapshots.get(&key).cloned()
        } else {
            None
        };
        if let Some(cached) = cached {
            return crate::timing::phase("registry.catalog_snapshot_hit", Some(source), || {
                if let Some(entry) = cached.get(owner_id) {
                    check_owner(root, source, entry, auth)?;
                }
                if !same_epoch(&key, &lock, epoch.as_ref(), auth) {
                    return Err("catalog custody changed while observing".into());
                }
                Ok(cached)
            });
        }
        let (records, complete) =
            crate::timing::phase("registry.catalog_snapshot_load", Some(source), || {
                load_catalog(root, source, owner_id, auth)
            })?;
        let snapshot = crate::timing::phase("registry.catalog_index", Some(source), || {
            Ok::<_, String>(Rc::new(CatalogSnapshot::new(records)))
        })?;
        if complete && epoch.is_some() && same_epoch(&key, &lock, epoch.as_ref(), auth) {
            auth.catalog
                .borrow_mut()
                .snapshots
                .insert(key, snapshot.clone());
        }
        Ok(snapshot)
    })
}

fn same_epoch(
    key: &(PathBuf, PathBuf),
    lock: &Path,
    expected: Option<&Rc<()>>,
    auth: Auth<'_>,
) -> bool {
    auth.catalog_locks.borrow().contains(lock)
        && expected.is_some_and(|expected| {
            auth.catalog
                .borrow()
                .epochs
                .get(key)
                .is_some_and(|current| Rc::ptr_eq(expected, current))
        })
}

fn check_owner(
    root: &Path,
    source: &Path,
    entry: &CachedRecord,
    auth: Auth<'_>,
) -> Result<(), String> {
    for member_path in &entry.member_paths {
        paths::check(root, member_path, auth)?;
    }
    validate_cleanup_recovery(root, source, &entry.record, &entry.member_paths, auth)?;
    Ok(())
}

fn load_catalog(
    root: &Path,
    source: &Path,
    owner_id: &str,
    auth: Auth<'_>,
) -> Result<(CatalogRecords, bool), String> {
    check_lock(root, source, auth)?;
    let mut records = BTreeMap::new();
    let mut complete = true;
    for path in names(root, source, auth)? {
        let bytes = match read(root, &path, auth) {
            Ok(bytes) => bytes,
            Err(RecordReadError::Unavailable) => {
                complete = false;
                continue;
            }
            Err(RecordReadError::Changed) => {
                return Err("producer record changed while reading".into());
            }
        };
        let key = (root.to_path_buf(), path.clone());
        // Release the borrow before any authorizer callback: callbacks may change
        // the catalog or permissions during either read or member traversal.
        let cached = auth.catalog.borrow().records.get(&key).cloned();
        let entry = if let Some(cached) = cached.filter(|entry| entry.bytes == bytes) {
            cached
        } else {
            #[cfg(test)]
            {
                auth.catalog.borrow_mut().misses += 1;
            }
            let Ok(record) = serde_json::from_slice::<Value>(&bytes) else {
                continue;
            };
            let Ok(member_paths) = validate(root, &record) else {
                continue;
            };
            Rc::new(CachedRecord {
                bytes,
                canonical: canonical(&record),
                record,
                member_paths,
            })
        };
        // Physical payload checks apply to the selected owner, not to unrelated
        // work or consumers whose references already protect the selected group.
        if entry.record["id"] == owner_id {
            check_owner(root, source, &entry, auth)?;
        }
        let after = match read(root, &path, auth) {
            Ok(bytes) => bytes,
            Err(RecordReadError::Unavailable) => {
                complete = false;
                continue;
            }
            Err(RecordReadError::Changed) => {
                return Err("producer record changed while reading".into());
            }
        };
        if after != entry.bytes {
            return Err("producer record bytes changed while observing".into());
        }
        // Admit only fully validated bytes that survived the second fresh read.
        auth.catalog.borrow_mut().records.insert(key, entry.clone());
        let id = string(&entry.record, "id")?.to_owned();
        if records.insert(id, entry).is_some() {
            return Err("duplicate producer id".into());
        }
    }
    check_lock(root, source, auth)?;
    Ok((records, complete))
}
fn relevant<'a>(records: &'a CatalogSnapshot, id: &str) -> Vec<&'a Value> {
    records
        .related(id)
        .map(|(_, record)| &record.canonical)
        .collect()
}

pub(crate) fn reservation_fence(
    root: &Path,
    source: &Path,
    id: &str,
    auth: Auth<'_>,
) -> Result<Value, String> {
    let records = catalog(root, source, id, auth)?;
    if !records.contains_key(id) {
        return Err("reserved producer record missing".into());
    }
    Ok(json!(hash(&relevant(&records, id))?))
}

/// Derive a reservation's fence and exact owner from the same fresh observation.
/// No authorizer or filesystem boundary separates these two projections.
pub(crate) fn reservation_binding(
    root: &Path,
    source: &Path,
    id: &str,
    auth: Auth<'_>,
) -> Result<(Value, Value), String> {
    let first = catalog(root, source, id, auth)?;
    let records = catalog(root, source, id, auth)?;
    if relevant(&first, id) != relevant(&records, id) {
        return Err("relevant producer records changed while observing".into());
    }
    let owner = records.get(id).ok_or("reserved producer record missing")?;
    Ok((json!(hash(&relevant(&records, id))?), owner.record.clone()))
}

pub(crate) fn producer_records(
    root: &Path,
    source: &Path,
    id: &str,
    auth: Auth<'_>,
) -> Result<BTreeMap<String, Value>, String> {
    Ok(catalog(root, source, id, auth)?
        .iter()
        .map(|(id, entry)| (id.clone(), entry.record.clone()))
        .collect())
}

/// Retirement cannot interpret an unreadable or invalid record as no consumer.
/// Ordinary catalog observation intentionally retains its existing lenient policy.
pub(crate) fn retirement_records(
    root: &Path,
    source: &Path,
    auth: Auth<'_>,
) -> Result<BTreeMap<String, Value>, String> {
    check_lock(root, source, auth)?;
    let before = names(root, source, auth)?;
    let mut records = BTreeMap::new();
    for path in &before {
        let bytes = read(root, path, auth)
            .map_err(|_| "retirement catalog record unavailable or changed")?;
        let record: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        validate(root, &record)?;
        if read(root, path, auth).map_err(|_| "retirement catalog record unavailable or changed")?
            != bytes
        {
            return Err("retirement catalog record changed".into());
        }
        let id = string(&record, "id")?.to_owned();
        if records.insert(id, record).is_some() {
            return Err("duplicate producer id".into());
        }
    }
    if names(root, source, auth)? != before {
        return Err("retirement catalog membership changed".into());
    }
    check_lock(root, source, auth)?;
    Ok(records)
}

#[cfg(test)]
mod catalog_tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    #[test]
    fn related_index_preserves_full_scan_order_values_and_fence_bytes() {
        let records = [
            ("z", json!([{"id":"owner","reason":"first"},{"id":"owner","reason":"second"},{"id":"future","reason":"planned"}])),
            ("owner", json!([{"id":"owner","reason":"self"}])),
            ("a", json!([{"id":"owner","reason":"earlier"}])),
            ("unrelated", json!([])),
        ].into_iter().map(|(id, references)| {
            let record = json!({"id":id,"references":references,"unknown":{"value":1}});
            (id.to_owned(), Rc::new(CachedRecord {
                bytes: serde_json::to_vec(&record).unwrap(),
                canonical: canonical(&record), record, member_paths: Vec::new(),
            }))
        }).collect::<CatalogRecords>();
        let snapshot = CatalogSnapshot::new(records);
        for id in ["owner", "future", "missing", "unrelated"] {
            let expected = snapshot
                .records
                .iter()
                .filter(|(record_id, record)| {
                    record_id.as_str() == id
                        || record["references"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|reference| reference["id"] == id)
                })
                .map(|(_, record)| record.canonical.clone())
                .collect::<Vec<_>>();
            assert_eq!(
                serde_json::to_vec(&relevant(&snapshot, id)).unwrap(),
                serde_json::to_vec(&expected).unwrap()
            );
            assert_eq!(
                hash(&relevant(&snapshot, id)).unwrap(),
                hash(&expected).unwrap()
            );
        }
        assert_eq!(
            snapshot
                .related("owner")
                .map(|(id, _)| id.as_str())
                .collect::<Vec<_>>(),
            ["a", "owner", "z"]
        );
    }

    #[test]
    fn registration_binding_requires_exact_owner_beyond_canonical_fence() {
        let (root, source, owner) = fixture();
        let authorize = |_: &Path, _: AccessMode| Ok(());
        let auth = crate::Context::new(&authorize);
        let records = catalog(root.path(), &source, "owner", &auth).unwrap();
        let expected = json!({"fence":hash(&relevant(&records,"owner")).unwrap(),"owner":owner});
        validate_observation_binding(&records, "owner", Some(&expected)).unwrap();
        let mut changed = expected.clone();
        changed["owner"]["updated_at"] = json!("different raw binding");
        assert_eq!(
            validate_observation_binding(&records, "owner", Some(&changed)).unwrap_err(),
            "reserved registration producer owner changed"
        );
        changed = expected;
        changed["fence"] = json!("stale");
        assert_eq!(
            validate_observation_binding(&records, "owner", Some(&changed)).unwrap_err(),
            "reserved producer fence changed"
        );
    }

    #[test]
    fn locked_snapshots_reuse_catalog_io_but_recheck_each_selected_owner_and_source() {
        let (root, source, owner) = fixture();
        let other_member = root.path().join("artifacts/other/member");
        let mut other = owner.clone();
        other["id"] = json!("other");
        other["members"][0]["path"] = json!(other_member);
        std::fs::write(
            source.join("other.json"),
            serde_json::to_vec(&other).unwrap(),
        )
        .unwrap();
        let second_source = root.path().join("artifacts/second-catalog");
        std::fs::create_dir(&second_source).unwrap();
        let mut second_owner = owner.clone();
        second_owner["owner"] = json!("second source");
        std::fs::write(
            second_source.join("owner.json"),
            serde_json::to_vec(&second_owner).unwrap(),
        )
        .unwrap();
        let reads = Cell::new(0);
        let deny_other = Cell::new(false);
        let owner_checks = Cell::new(0);
        let member = Path::new(owner["members"][0]["path"].as_str().unwrap());
        let authorize = |path: &Path, mode| {
            if path == source.join("owner.json") && mode == AccessMode::Read {
                reads.set(reads.get() + 1);
            }
            if path == member {
                owner_checks.set(owner_checks.get() + 1);
            }
            if path == other_member && deny_other.get() {
                return Err("selected owner denied".into());
            }
            Ok(())
        };
        let auth = crate::Context::new(&authorize);
        let locks = lock_request(root.path(), &json!({"operation":"register","group":{
            "id":"second","membership_source":second_source,"membership_source_format":"producer_registry_v1"
        }}), &crate::State::default(), &auth).unwrap();
        let initial = catalog(root.path(), &source, "owner", &auth).unwrap();
        let initial_reads = reads.get();
        let initial_owner_checks = owner_checks.get();
        assert!(initial_reads > 0);
        assert_eq!(
            catalog(root.path(), &source, "owner", &auth).unwrap(),
            initial
        );
        assert_eq!(
            reads.get(),
            initial_reads,
            "held epoch reuses catalog filesystem snapshot"
        );
        assert!(owner_checks.get() > initial_owner_checks);
        deny_other.set(true);
        assert_eq!(
            catalog(root.path(), &source, "other", &auth).unwrap_err(),
            "selected owner denied"
        );
        deny_other.set(false);
        assert!(
            catalog(root.path(), &source, "other", &auth).is_ok(),
            "owner proof errors are not cached"
        );
        assert_eq!(reads.get(), initial_reads);
        assert_eq!(
            catalog(root.path(), &second_source, "owner", &auth).unwrap()["owner"]["owner"],
            "second source"
        );
        assert_eq!(
            catalog(root.path(), &source, "owner", &auth).unwrap()["owner"]["owner"],
            "test"
        );
        drop(locks);
        let mut changed = owner.clone();
        changed["revision"] = json!(2);
        std::fs::write(
            source.join("owner.json"),
            serde_json::to_vec(&changed).unwrap(),
        )
        .unwrap();
        other["references"] = json!([{"id":"owner","reason":"new unlocked consumer"}]);
        std::fs::write(
            source.join("other.json"),
            serde_json::to_vec(&other).unwrap(),
        )
        .unwrap();
        let _locks = lock_request(
            root.path(),
            &json!({"operation":"register"}),
            &crate::State::default(),
            &auth,
        )
        .unwrap();
        let current = catalog(root.path(), &source, "owner", &auth).unwrap();
        assert_eq!(current["owner"]["revision"], 2);
        assert_eq!(current["other"]["references"][0]["id"], "owner");
        assert!(
            reads.get() > initial_reads,
            "reacquisition must reload current catalog bytes"
        );
    }

    #[test]
    fn failed_locked_observation_is_not_admitted_as_snapshot() {
        let (root, source, owner) = fixture();
        let member = Path::new(owner["members"][0]["path"].as_str().unwrap());
        let deny = Cell::new(true);
        let reads = Cell::new(0);
        let authorize = |path: &Path, mode| {
            if path == source.join("owner.json") && mode == AccessMode::Read {
                reads.set(reads.get() + 1);
            }
            if path == member && deny.get() {
                return Err("owner denied".into());
            }
            Ok(())
        };
        let auth = crate::Context::new(&authorize);
        let _locks = lock_request(
            root.path(),
            &json!({"operation":"register"}),
            &crate::State::default(),
            &auth,
        )
        .unwrap();
        assert!(catalog(root.path(), &source, "owner", &auth).is_err());
        let failed_reads = reads.get();
        deny.set(false);
        assert!(catalog(root.path(), &source, "owner", &auth).is_ok());
        assert!(reads.get() > failed_reads);
    }

    #[test]
    fn unavailable_record_is_not_cached_as_a_held_snapshot_omission() {
        let (root, source, _) = fixture();
        let denied = Cell::new(true);
        let record_path = source.join("owner.json");
        let authorize = |path: &Path, _| {
            if path == record_path && denied.get() {
                Err("record unavailable".into())
            } else {
                Ok(())
            }
        };
        let auth = crate::Context::new(&authorize);
        let _locks = lock_request(
            root.path(),
            &json!({"operation":"register"}),
            &crate::State::default(),
            &auth,
        )
        .unwrap();
        assert!(
            !catalog(root.path(), &source, "owner", &auth)
                .unwrap()
                .contains_key("owner")
        );
        denied.set(false);
        assert!(
            catalog(root.path(), &source, "owner", &auth)
                .unwrap()
                .contains_key("owner")
        );
    }

    fn fixture() -> (tempfile::TempDir, PathBuf, Value) {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("artifacts/maintenance/lifecycles");
        std::fs::create_dir_all(&source).unwrap();
        let member = root.path().join("artifacts/payload/member");
        std::fs::create_dir_all(member.parent().unwrap()).unwrap();
        std::fs::write(&member, "payload").unwrap();
        let record = json!({"schema":1,"id":"owner","kind":"work","owner":"test",
            "state":"complete","membership_complete":true,
            "members":[{"path":member,"role":"artifact"}],"references":[]});
        std::fs::write(
            source.join("owner.json"),
            serde_json::to_vec(&record).unwrap(),
        )
        .unwrap();
        (root, source, record)
    }

    #[test]
    fn same_bytes_reuse_parsing_but_replay_ordered_checks_and_permission_denials() {
        for (ancestor, contained) in [(false, false), (true, false), (false, true), (true, true)] {
            let (root, source, record) = fixture();
            let source = if contained {
                let contained_source = root
                    .path()
                    .join("artifacts/work/artifacts/maintenance/lifecycles");
                std::fs::create_dir_all(contained_source.parent().unwrap()).unwrap();
                std::fs::rename(source, &contained_source).unwrap();
                contained_source
            } else {
                source
            };
            let reservations = source.join("reservations");
            std::fs::create_dir(&reservations).unwrap();
            let reservation_lock = reservations.join("owner.lock");
            std::fs::write(&reservation_lock, "persistent reservation lock").unwrap();
            let member = Path::new(record["members"][0]["path"].as_str().unwrap());
            let denied_path = if ancestor {
                member.parent().unwrap()
            } else {
                member
            };
            let denied = Cell::new(false);
            let trace = RefCell::new(Vec::new());
            let authorize = |path: &Path, mode| {
                trace.borrow_mut().push((path.to_path_buf(), mode));
                if denied.get() && path == denied_path {
                    Err("fresh member permission denied".into())
                } else {
                    Ok(())
                }
            };
            let auth = crate::Context::new(&authorize);
            let initial = catalog(root.path(), &source, "owner", &auth).unwrap();
            let first_trace = trace.take();
            assert_eq!(
                catalog(root.path(), &source, "owner", &auth).unwrap(),
                initial
            );
            assert_eq!(trace.take(), first_trace);
            assert_eq!(auth.catalog.borrow().misses, 1);
            denied.set(true);
            assert_eq!(
                catalog(root.path(), &source, "owner", &auth).unwrap_err(),
                "fresh member permission denied"
            );
            assert_eq!(auth.catalog.borrow().misses, 1);
            assert_eq!(
                std::fs::read_to_string(&reservation_lock).unwrap(),
                "persistent reservation lock"
            );
            denied.set(false);
            std::fs::create_dir(source.join("unexpected")).unwrap();
            assert_eq!(
                catalog(root.path(), &source, "owner", &auth).unwrap_err(),
                "producer registry contains a nonregular or nested entry"
            );
        }
    }

    #[test]
    fn cache_hit_member_callback_cannot_hide_changed_record_bytes() {
        let (root, source, record) = fixture();
        let mutate = Cell::new(false);
        let member = Path::new(record["members"][0]["path"].as_str().unwrap());
        let authorize = |path: &Path, _| {
            if path == member && mutate.replace(false) {
                let mut changed = record.clone();
                changed["owner"] = json!("edit");
                let path = source.join("owner.json");
                let before = std::fs::metadata(&path).unwrap();
                let bytes = serde_json::to_vec(&changed).unwrap();
                assert_eq!(bytes.len() as u64, before.len());
                std::fs::write(&path, bytes).unwrap();
                std::fs::OpenOptions::new()
                    .write(true)
                    .open(&path)
                    .unwrap()
                    .set_times(std::fs::FileTimes::new().set_modified(before.modified().unwrap()))
                    .unwrap();
                assert_eq!(
                    std::fs::metadata(&path).unwrap().modified().unwrap(),
                    before.modified().unwrap()
                );
            }
            Ok(())
        };
        let auth = crate::Context::new(&authorize);
        catalog(root.path(), &source, "owner", &auth).unwrap();
        mutate.set(true);
        assert_eq!(
            catalog(root.path(), &source, "owner", &auth).unwrap_err(),
            "producer record bytes changed while observing"
        );
        assert_eq!(auth.catalog.borrow().misses, 1);
        let changed = catalog(root.path(), &source, "owner", &auth).unwrap();
        assert_eq!(changed["owner"]["owner"], "edit");
        assert_eq!(auth.catalog.borrow().misses, 2);
    }

    #[test]
    fn record_mutation_during_read_is_not_an_omission() {
        let (root, source, _) = fixture();
        let owner = source.join("owner.json");
        let reads = Cell::new(0);
        let authorize = |path: &Path, mode| {
            if path == owner && mode == AccessMode::Read {
                let count = reads.get();
                reads.set(count + 1);
                if count == 3 {
                    let mut bytes = std::fs::read(&owner).unwrap();
                    bytes.push(b' ');
                    std::fs::write(&owner, bytes).unwrap();
                }
            }
            Ok(())
        };
        let auth = crate::Context::new(&authorize);
        assert_eq!(
            catalog(root.path(), &source, "owner", &auth).unwrap_err(),
            "producer record changed while reading"
        );
    }

    #[test]
    fn unrelated_payload_permissions_are_not_catalog_requirements() {
        let (root, source, record) = fixture();
        let unrelated = root.path().join("artifacts/other/private/member");
        let mut consumer = record.clone();
        consumer["id"] = json!("consumer");
        consumer["members"][0]["path"] = json!(unrelated);
        consumer["references"] = json!([{"id":"owner","reason":"still needed"}]);
        std::fs::write(
            source.join("consumer.json"),
            serde_json::to_vec(&consumer).unwrap(),
        )
        .unwrap();
        let owner_member = Path::new(record["members"][0]["path"].as_str().unwrap());
        let owner_checks = Cell::new(0);
        let authorize = |path: &Path, _| {
            if path.starts_with(root.path().join("artifacts/other")) {
                panic!("unrelated physical payload must not be inspected");
            }
            if path == owner_member {
                owner_checks.set(owner_checks.get() + 1);
            }
            Ok(())
        };
        let auth = crate::Context::new(&authorize);
        for _ in 0..2 {
            let observed = observe(root.path(), &source, &record, &BTreeMap::new(), &auth).unwrap();
            assert_eq!(observed["references"], json!(["consumer:still needed"]));
        }
        assert_eq!(owner_checks.get(), 4);
        assert_eq!(auth.catalog.borrow().misses, 2);
    }

    #[test]
    fn warm_catalog_still_detects_new_consumer_between_observation_passes() {
        let (root, source, record) = fixture();
        let add_consumer = Cell::new(false);
        let member = Path::new(record["members"][0]["path"].as_str().unwrap());
        let authorize = |path: &Path, _| {
            if path == member && add_consumer.replace(false) {
                let mut consumer = record.clone();
                consumer["id"] = json!("consumer");
                consumer["references"] = json!([{"id":"owner","reason":"still in use"}]);
                std::fs::write(
                    source.join("consumer.json"),
                    serde_json::to_vec(&consumer).unwrap(),
                )
                .unwrap();
            }
            Ok(())
        };
        let auth = crate::Context::new(&authorize);
        catalog(root.path(), &source, "owner", &auth).unwrap();
        add_consumer.set(true);
        assert_eq!(
            observe(root.path(), &source, &record, &BTreeMap::new(), &auth).unwrap_err(),
            "relevant producer records changed while observing"
        );
        assert_eq!(auth.catalog.borrow().misses, 2);
        // Unavailable references are accepted by policy; valid consumers survive.
        std::fs::write(source.join("unrelated.json"), "invalid JSON").unwrap();
        let records = catalog(root.path(), &source, "owner", &auth).unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(records["consumer"]["references"][0]["id"], "owner");
    }

    #[test]
    fn scoped_references_project_only_selected_member_and_stale_pins_protect_group() {
        let (root, source, mut owner) = fixture();
        let selected = owner["members"][0]["path"].clone();
        let other = root.path().join("artifacts/payload/other");
        owner["revision"] = json!(2);
        owner["members"]
            .as_array_mut()
            .unwrap()
            .push(json!({"path":other,"role":"artifact"}));
        std::fs::write(
            source.join("owner.json"),
            serde_json::to_vec(&owner).unwrap(),
        )
        .unwrap();
        let mut consumer = owner.clone();
        consumer["id"] = json!("consumer");
        consumer["members"] =
            json!([{"path":root.path().join("artifacts/consumer"),"role":"artifact"}]);
        consumer["references"] = json!([{"id":"owner","reason":"selected input","member_paths":[selected],"target_revision":1}]);
        std::fs::write(
            source.join("consumer.json"),
            serde_json::to_vec(&consumer).unwrap(),
        )
        .unwrap();
        let items = BTreeMap::from([
            (
                "selected".to_owned(),
                json!({"path":selected,"role":"artifact","lifecycle_role":"artifact","owner":"test"}),
            ),
            (
                "other".to_owned(),
                json!({"path":other,"role":"artifact","lifecycle_role":"artifact","owner":"test"}),
            ),
        ]);
        let authorize = |_: &Path, _| Ok(());
        let auth = crate::Context::new(&authorize);
        let result = observe(root.path(), &source, &owner, &items, &auth).unwrap();
        assert_eq!(
            result["member_references"]["selected"],
            json!(["consumer:selected input"])
        );
        assert_eq!(result["member_references"]["other"], json!([]));
        assert_eq!(result["references"], json!(["consumer:selected input"]));
        assert!(
            result["blockers"]
                .as_array()
                .unwrap()
                .iter()
                .any(|blocker| blocker.as_str().unwrap().contains("reference pin differs"))
        );
    }
}

fn lifecycle_role(role: &str) -> &'static str {
    let words = role
        .split(|c: char| c == '-' || c == '_' || c.is_whitespace())
        .map(str::to_lowercase)
        .collect::<Vec<_>>();
    if words
        .iter()
        .any(|word| matches!(word.as_str(), "log" | "logs"))
    {
        "log"
    } else if words.iter().any(|word| {
        matches!(
            word.as_str(),
            "report" | "reports" | "evidence" | "verification"
        )
    }) {
        "evidence"
    } else if words
        .iter()
        .any(|word| matches!(word.as_str(), "snapshot" | "snapshots" | "input" | "inputs"))
    {
        "snapshot"
    } else {
        "artifact"
    }
}

/// Planned outputs may never have existed. Only a complete, settled producer
/// with explicit ownership evidence can introduce their absent native records.
pub(crate) fn validate_absent_adoption(
    group: &Value,
    items: &BTreeMap<String, Value>,
    absent: &BTreeSet<String>,
    observed: &Value,
) -> Result<(), String> {
    if group["membership_source_format"] != "producer_registry_v1"
        || group["membership_complete"] != true
        || observed["settled"] != true
        || observed["membership_matches"] != true
        || !observed["blockers"].as_array().is_some_and(Vec::is_empty)
    {
        return Err("absent adoption requires a complete verified producer contract".into());
    }
    let members = observed["owner"]["members"]
        .as_array()
        .ok_or("absent adoption requires producer members")?;
    for id in absent {
        let item = &items[id];
        let path = Path::new(string(item, "path")?);
        if item["generated"] != true
            || item["protection_known"] != true
            || members
                .iter()
                .filter(|member| {
                    paths::within(Path::new(member["path"].as_str().unwrap_or("")), path)
                })
                .any(|member| member["generated"] != true || member["protection_known"] != true)
        {
            return Err(
                "absent adoption requires explicit producer generation and protection evidence"
                    .into(),
            );
        }
    }
    Ok(())
}

fn validate_observation_binding(
    records: &CatalogSnapshot,
    id: &str,
    expected: Option<&Value>,
) -> Result<(), String> {
    if let Some(expected) = expected {
        if expected["fence"] != json!(hash(&relevant(records, id))?) {
            return Err("reserved producer fence changed".into());
        }
        if !expected["owner"].is_null()
            && records.get(id).map(|entry| &entry.record) != Some(&expected["owner"])
        {
            return Err("reserved registration producer owner changed".into());
        }
    }
    Ok(())
}

pub(crate) fn observe(
    root: &Path,
    source: &Path,
    group: &Value,
    items: &BTreeMap<String, Value>,
    auth: Auth<'_>,
) -> Result<Value, String> {
    crate::timing::phase("registry.observe", Some(source), || {
        let id = string(group, "id")?;
        let reserved_fence = crate::reservations::observation_fence(root, id, source, auth)?;
        // Unlocked passes freshly detect consumer/record changes. A continuously
        // held source lease reuses its admitted snapshot and rechecks owner proofs.
        // Changes to other validated producers do not alter this group.
        let first = catalog(root, source, id, auth)?;
        validate_observation_binding(&first, id, reserved_fence.as_ref())?;
        let records = catalog(root, source, id, auth)?;
        validate_observation_binding(&records, id, reserved_fence.as_ref())?;
        if relevant(&first, id) != relevant(&records, id) {
            return Err("relevant producer records changed while observing".into());
        }
        let identity = hash(&relevant(&records, id))?;
        let owner = records.get(id).ok_or("producer owner record missing")?;
        let mut blockers = Vec::<String>::new();
        if owner["kind"] != group["kind"]
            || owner["owner"] != group["owner"]
            || owner["version"] != group["version"]
        {
            blockers.push("producer owner metadata differs from registered group".into());
        }
        let settled = owner["membership_complete"] == true
            && if let Some(producer) = owner.get("producer") {
                producer["outcome"] == "success" || producer["outcome"] == "failure"
            } else {
                owner["state"] == "complete"
            }
            || owner.get("cleanup_recovery").is_some();
        if !settled {
            blockers.push("producer owner membership is not complete".into());
        }
        let members = owner["members"].as_array().ok_or("invalid owner members")?;
        let mut projected = Vec::new();
        for (index, member) in members.iter().enumerate() {
            let path = Path::new(string(member, "path")?);
            if members.iter().enumerate().any(|(other_index, other)| {
                let other = Path::new(other["path"].as_str().unwrap_or(""));
                other_index != index
                    && paths::within(path, other)
                    && (!paths::within(other, path) || other_index < index)
            }) {
                continue;
            }
            projected.push((path, string(member, "role")?));
        }
        let mut matched = BTreeSet::new();
        for (path, role) in &projected {
            if members.iter().any(|member| {
                paths::within(Path::new(member["path"].as_str().unwrap_or("")), path)
                    && (member["generated"] == false || member["protection_known"] == false)
            }) {
                blockers.push("producer member ownership or protection is unconfirmed".into());
            }
            if let Some((id, _)) = items.iter().find(|(_, item)| {
                let registered = Path::new(item["path"].as_str().unwrap_or(""));
                paths::within(path, registered)
                    && paths::within(registered, path)
                    && item.get("role").unwrap_or(&item["kind"]).as_str() == Some(*role)
                    && item["lifecycle_role"] == lifecycle_role(role)
                    && item["owner"] == owner["owner"]
            }) {
                matched.insert(id);
            }
        }
        let membership_matches = projected.len() == items.len() && matched.len() == items.len();
        if !membership_matches {
            blockers.push(
                "producer projected membership differs from registered member roots or roles"
                    .into(),
            );
        }
        let mut references = Vec::new();
        let mut member_references = items
            .keys()
            .map(|id| (id.clone(), Vec::<Value>::new()))
            .collect::<BTreeMap<_, _>>();
        for (consumer_id, record) in records.related(id) {
            let inbound = record["references"]
                .as_array()
                .is_some_and(|references| references.iter().any(|reference| reference["id"] == id));
            if inbound {
                for reference in record["references"]
                    .as_array()
                    .ok_or("invalid producer references")?
                {
                    if reference["id"] == id {
                        let description =
                            json!(format!("{consumer_id}:{}", string(reference, "reason")?));
                        references.push(description.clone());
                        let scope = reference.get("member_paths").and_then(Value::as_array);
                        if reference
                            .get("target_revision")
                            .is_some_and(|revision| *revision != owner["revision"])
                            || reference
                                .get("target_version")
                                .is_some_and(|version| *version != owner["version"])
                        {
                            blockers.push(format!(
                                "producer reference pin differs from current owner: {consumer_id}"
                            ));
                        }
                        if let Some(scope) = scope {
                            if scope.iter().any(|selected| {
                                !projected.iter().any(|(path, _)| {
                                    selected.as_str().is_some_and(|selected| {
                                        paths::within(path, Path::new(selected))
                                            && paths::within(Path::new(selected), path)
                                    })
                                })
                            }) {
                                blockers.push(format!("producer reference member scope differs from current owner: {consumer_id}"));
                            }
                        }
                        for (member_id, item) in items {
                            let member_path = Path::new(string(item, "path")?);
                            if scope.is_none_or(|scope| {
                                scope.iter().any(|selected| {
                                    selected.as_str().is_some_and(|selected| {
                                        paths::within(member_path, Path::new(selected))
                                            && paths::within(Path::new(selected), member_path)
                                    })
                                })
                            }) {
                                member_references
                                    .get_mut(member_id)
                                    .ok_or("missing reference projection")?
                                    .push(description.clone());
                            }
                        }
                    }
                }
                blockers.push(format!(
                    "producer inbound consumer protects group: {consumer_id}"
                ));
            }
        }
        Ok(
            json!({"status":"measured","identity":identity,"blockers":blockers,
        "owner":owner.record,"membership_matches":membership_matches,"settled":settled,"references":references,"member_references":member_references}),
        )
    })
}

#[cfg(test)]
mod cleanup_recovery_tests {
    use super::*;
    use sha2::{Digest, Sha256};

    fn write(path: &Path, value: &Value) -> String {
        let bytes = serde_json::to_vec(value).unwrap();
        std::fs::write(path, &bytes).unwrap();
        format!("{:x}", Sha256::digest(bytes))
    }

    fn fixture(unknown_producer: bool) -> (tempfile::TempDir, PathBuf, Value, Value) {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("artifacts/maintenance/lifecycles");
        std::fs::create_dir_all(&source).unwrap();
        let payload = root.path().join("artifacts/payload");
        std::fs::create_dir(&payload).unwrap();
        let proof = root.path().join("stop-proof.json");
        let proof_hash = write(&proof, &json!({"exact_tree":"verified stopped"}));
        let evidence_path = root.path().join("cleanup-proof.json");
        let producer = if unknown_producer {
            json!({"status":"stopped","outcome":"unknown","exit_code":null,
                "reason":"historical uncertain outcome","evidence_ref":proof,"evidence_sha256":proof_hash})
        } else {
            Value::Null
        };
        let members =
            json!([{"path":payload,"role":"artifact","generated":true,"protection_known":true}]);
        let evidence = json!({"schema":1,"action":"recover-cleanup",
            "source":{"id":"owner","owner":"test","kind":"work","version":null,
                "generation":null,"revision":1,"state":"pending","membership_complete":false,
                "producer":producer,"members":members},
            "producer_stopped_verified":true,"membership_complete_verified":true,
            "stop_basis":"exact historical process tree ended after reboot",
            "membership_basis":"complete planned and actual owned roots reconciled",
            "producer_evidence":[{"path":proof,"sha256":proof_hash}]});
        let evidence_hash = write(&evidence_path, &evidence);
        let mut record = json!({"schema":1,"id":"owner","owner":"test","kind":"work",
            "version":null,"state":"pending","membership_complete":true,"revision":2,
            "members":members,"references":[],
            "cleanup_recovery":{"schema":1,"id":"owner","owner":"test","kind":"work",
                "version":null,"generation":null,"source_revision":1,
                "original_state":"pending","original_membership_complete":false,
                "original_producer":producer,"members":members,"evidence_ref":evidence_path,
                "evidence_sha256":evidence_hash,"reason":"verified tree stop and complete membership",
                "producer_stopped_verified":true,"membership_complete_verified":true,
                "verified_at":"2026-10-28T03:45:20.393Z"}});
        if unknown_producer {
            record["producer"] = producer;
        }
        write(&source.join("owner.json"), &record);
        (root, source, record, evidence)
    }

    fn items(record: &Value) -> BTreeMap<String, Value> {
        BTreeMap::from([(
            "payload".into(),
            json!({"path":record["members"][0]["path"],
            "role":"artifact","lifecycle_role":"artifact","owner":"test"}),
        )])
    }

    #[test]
    fn receipt_enables_only_cleanup_preserves_unknown_and_current_consumer_protection() {
        for unknown in [false, true] {
            let (root, source, record, _) = fixture(unknown);
            let allow = |_: &Path, _| Ok(());
            let auth = crate::Context::new(&allow);
            let observed = observe(root.path(), &source, &record, &items(&record), &auth).unwrap();
            assert_eq!(observed["settled"], true);
            assert_eq!(observed["blockers"], json!([]));
            assert_eq!(observed["owner"]["state"], "pending");
            assert_eq!(observed["owner"]["producer"], record["producer"]);

            let mut unrecovered = record.clone();
            unrecovered
                .as_object_mut()
                .unwrap()
                .remove("cleanup_recovery");
            write(&source.join("owner.json"), &unrecovered);
            assert_eq!(
                observe(root.path(), &source, &record, &items(&record), &auth).unwrap()["settled"],
                false
            );

            // Reference-only revisions do not invalidate the exact producer binding.
            let mut later = record.clone();
            later["revision"] = json!(4);
            write(&source.join("owner.json"), &later);
            let consumer = json!({"schema":1,"id":"consumer","owner":"test","kind":"work",
                "state":"pending","membership_complete":false,
                "members":[{"path":root.path().join("artifacts/consumer"),"role":"artifact"}],
                "references":[{"id":"owner","reason":"current input"}]});
            write(&source.join("consumer.json"), &consumer);
            let guarded = observe(root.path(), &source, &record, &items(&record), &auth).unwrap();
            assert_eq!(guarded["settled"], true);
            assert_eq!(guarded["references"], json!(["consumer:current input"]));
            assert!(!guarded["blockers"].as_array().unwrap().is_empty());
        }
    }

    #[test]
    fn warm_catalog_rechecks_proofs_permissions_and_independent_single_link_files() {
        for held in [false, true] {
            let (root, source, record, evidence) = fixture(true);
            let proof = Path::new(evidence["producer_evidence"][0]["path"].as_str().unwrap());
            let deny = std::cell::Cell::new(false);
            let authorize = |path: &Path, _| {
                if deny.get() && path == proof {
                    Err("proof denied".into())
                } else {
                    Ok(())
                }
            };
            let auth = crate::Context::new(&authorize);
            let _locks = if held {
                lock_request(
                    root.path(),
                    &json!({"operation":"register"}),
                    &crate::State::default(),
                    &auth,
                )
                .unwrap()
            } else {
                Vec::new()
            };
            catalog(root.path(), &source, "owner", &auth).unwrap();
            deny.set(true);
            assert!(catalog(root.path(), &source, "owner", &auth).is_err());
            deny.set(false);
            let alias = root.path().join("proof-alias");
            std::fs::hard_link(proof, &alias).unwrap();
            assert!(catalog(root.path(), &source, "owner", &auth).is_err());
            std::fs::remove_file(alias).unwrap();
            catalog(root.path(), &source, "owner", &auth).unwrap();
            std::fs::write(proof, "altered proof").unwrap();
            assert!(catalog(root.path(), &source, "owner", &auth).is_err());
            std::fs::remove_file(proof).unwrap();
            assert!(catalog(root.path(), &source, "owner", &auth).is_err());
            // Historical outcome was never rewritten by the observer.
            assert_eq!(
                serde_json::from_slice::<Value>(&std::fs::read(source.join("owner.json")).unwrap())
                    .unwrap(),
                record
            );
        }
    }

    #[test]
    fn changed_receipt_identity_members_and_producer_are_rejected() {
        let (root, source, record, _) = fixture(true);
        let allow = |_: &Path, _| Ok(());
        let auth = crate::Context::new(&allow);
        let members = validate(root.path(), &record).unwrap();
        for (pointer, value) in [
            ("/cleanup_recovery/owner", json!("other")),
            ("/cleanup_recovery/source_revision", json!(0)),
            ("/cleanup_recovery/source_revision", json!(2)),
            ("/cleanup_recovery/original_state", json!("complete")),
            (
                "/cleanup_recovery/original_membership_complete",
                Value::Null,
            ),
            (
                "/cleanup_recovery/original_producer/outcome",
                json!("success"),
            ),
            (
                "/cleanup_recovery/verified_at",
                json!("2026-02-30T00:00:00Z"),
            ),
            (
                "/cleanup_recovery/verified_at",
                json!("2026-10-28T25:00:00Z"),
            ),
            ("/cleanup_recovery/reason", json!("  ")),
            ("/cleanup_recovery/producer_stopped_verified", json!(false)),
            (
                "/cleanup_recovery/membership_complete_verified",
                json!(false),
            ),
            ("/members/0/generated", json!(false)),
            ("/members/0/protection_known", Value::Null),
            ("/state", json!("complete")),
        ] {
            let mut changed = record.clone();
            *changed.pointer_mut(pointer).unwrap() = value;
            assert!(
                validate_cleanup_recovery(root.path(), &source, &changed, &members, &auth).is_err(),
                "{pointer}"
            );
        }
    }

    #[test]
    fn changed_or_self_contained_evidence_cannot_authorize_cleanup() {
        let (root, source, record, evidence) = fixture(false);
        let allow = |_: &Path, _| Ok(());
        let auth = crate::Context::new(&allow);
        let members = validate(root.path(), &record).unwrap();
        let evidence_path = Path::new(record["cleanup_recovery"]["evidence_ref"].as_str().unwrap());
        for (pointer, value) in [
            ("/source/revision", json!(9)),
            ("/source/producer", json!({"outcome":"success"})),
            ("/producer_evidence", json!([])),
            ("/stop_basis", json!("")),
            ("/membership_basis", json!(" ")),
            ("/producer_evidence/0/path", json!("stop-proof.json")),
            ("/producer_evidence/0/path", json!(evidence_path)),
            (
                "/producer_evidence/0/path",
                json!(members[0].join("proof.json")),
            ),
            (
                "/producer_evidence/0/path",
                json!(source.join("owner.json")),
            ),
        ] {
            let mut changed_evidence = evidence.clone();
            *changed_evidence.pointer_mut(pointer).unwrap() = value;
            let mut changed = record.clone();
            changed["cleanup_recovery"]["evidence_sha256"] =
                json!(write(evidence_path, &changed_evidence));
            assert!(
                validate_cleanup_recovery(root.path(), &source, &changed, &members, &auth).is_err(),
                "{pointer}"
            );
        }
        let mut changed = record.clone();
        changed["cleanup_recovery"]["evidence_ref"] = json!(source.join("owner.json"));
        assert!(
            validate_cleanup_recovery(root.path(), &source, &changed, &members, &auth).is_err()
        );
        changed["cleanup_recovery"]["evidence_ref"] = json!(members[0].join("proof.json"));
        assert!(
            validate_cleanup_recovery(root.path(), &source, &changed, &members, &auth).is_err()
        );
        changed["cleanup_recovery"]["evidence_ref"] = json!("cleanup-proof.json");
        assert!(
            validate_cleanup_recovery(root.path(), &source, &changed, &members, &auth).is_err()
        );
    }
}

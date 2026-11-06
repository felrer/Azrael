//! Immutable records under the caller's maintenance OS lease.
//! `base` and `previous` must describe the same loaded snapshot. The caller owns
//! atomic index commit and may collect only after commit with no pending file.
//! Each section has sixteen immutable object buckets: IDs use the first SHA-256
//! byte modulo sixteen; decision positions use modulo sixteen. Index entries
//! share their bucket's digest, limiting the live payload to sixty-four files.
use crate::{AccessMode, Auth, lock_recovery, paths};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const FORMAT: &str = "partitioned-v1";
const SECTIONS: [&str; 3] = ["items", "groups", "runs"];
const MARKER: &str = ".owner.json";
const BUCKETS: usize = 16;
type Buckets<'a> = [BTreeMap<String, &'a Value>; BUCKETS];

fn bucket_for(id: &str) -> usize {
    usize::from(Sha256::digest(id.as_bytes())[0]) % BUCKETS
}

fn object_buckets(object: Option<&Map<String, Value>>) -> Buckets<'_> {
    let mut buckets = std::array::from_fn(|_| BTreeMap::new());
    if let Some(object) = object {
        for (id, value) in object {
            buckets[bucket_for(id)].insert(id.clone(), value);
        }
    }
    buckets
}

fn decision_buckets(array: Option<&Vec<Value>>) -> Buckets<'_> {
    let mut buckets = std::array::from_fn(|_| BTreeMap::new());
    if let Some(array) = array {
        for (position, value) in array.iter().enumerate() {
            buckets[position % BUCKETS].insert(position.to_string(), value);
        }
    }
    buckets
}

fn shared_reference<'a>(bucket: &BTreeMap<String, &'a Value>) -> Result<Option<&'a Value>, String> {
    let Some(first) = bucket.values().next().copied() else {
        return Ok(None);
    };
    hash_ref(first)?;
    if bucket.values().any(|reference| *reference != first) {
        return Err("inconsistent state bucket references".into());
    }
    Ok(Some(first))
}

pub(crate) fn is_index(value: &Value) -> bool {
    value["storage_format"] == FORMAT
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn hash_ref(value: &Value) -> Result<&str, String> {
    value
        .as_str()
        .filter(|value| valid_hash(value))
        .ok_or_else(|| "invalid state record hash reference".into())
}

fn references(index: &Value) -> Result<BTreeSet<String>, String> {
    if !is_index(index)
        || index["revision"] != FORMAT
        || index["state_revision"].as_u64().is_none()
        || index.as_object().is_none_or(|object| object.len() != 7)
    {
        return Err("invalid partitioned state index".into());
    }
    let mut refs = BTreeSet::new();
    for section in SECTIONS {
        let values = index[section]
            .as_object()
            .ok_or("invalid state index section")?;
        for bucket in object_buckets(Some(values)) {
            if let Some(reference) = shared_reference(&bucket)? {
                refs.insert(hash_ref(reference)?.to_owned());
            }
        }
    }
    let decisions = index["decisions"]
        .as_array()
        .ok_or("invalid state index decisions")?;
    for bucket in decision_buckets(Some(decisions)) {
        if let Some(reference) = shared_reference(&bucket)? {
            refs.insert(hash_ref(reference)?.to_owned());
        }
    }
    Ok(refs)
}

fn directory(root: &Path) -> PathBuf {
    root.join("artifacts/maintenance/state-records")
}

fn marker() -> Value {
    json!({"schema": 1, "owner": "azrael-project-maintenance/state-records"})
}

fn directory_identity(path: &Path) -> Result<Vec<u64>, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_BACKUP_SEMANTICS);
    }
    let file = options.open(path).map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_dir() {
        return Err("state record directory replaced".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = file.metadata().map_err(|e| e.to_string())?;
        Ok(vec![metadata.dev(), metadata.ino()])
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_ID_INFO, FileIdInfo, GetFileInformationByHandleEx,
        };
        let mut info = FILE_ID_INFO::default();
        if unsafe {
            GetFileInformationByHandleEx(
                file.as_raw_handle(),
                FileIdInfo,
                (&mut info as *mut FILE_ID_INFO).cast(),
                std::mem::size_of_val(&info) as u32,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(vec![
            info.VolumeSerialNumber,
            u64::from_le_bytes(info.FileId.Identifier[..8].try_into().unwrap()),
            u64::from_le_bytes(info.FileId.Identifier[8..].try_into().unwrap()),
        ])
    }
}

fn remove_created(
    root: &Path,
    path: &Path,
    expected: &[u64],
    auth: Auth<'_>,
) -> Result<(), String> {
    paths::check(root, path, auth)?;
    auth(
        path.parent().ok_or("missing state record parent")?,
        AccessMode::Write,
    )?;
    auth(path, AccessMode::Write)?;
    lock_recovery::final_plain_path(path)?;
    if lock_recovery::identity(&File::open(path).map_err(|e| e.to_string())?)? != expected {
        return Err("new state record identity changed".into());
    }
    fs::remove_file(path).map_err(|e| e.to_string())?;
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        _ => Err("new state record cleanup not confirmed".into()),
    }
}

fn read_plain(root: &Path, path: &Path, auth: Auth<'_>) -> Result<(Vec<u8>, Vec<u64>), String> {
    paths::check(root, path, auth)?;
    auth(path, AccessMode::Read)?;
    lock_recovery::final_plain_path(path)?;
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let identity = lock_recovery::identity(&file)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    lock_recovery::final_plain_path(path)?;
    if lock_recovery::identity(&File::open(path).map_err(|e| e.to_string())?)? != identity {
        return Err("state record replaced while reading".into());
    }
    Ok((bytes, identity))
}

fn validate_directory(root: &Path, auth: Auth<'_>) -> Result<PathBuf, String> {
    let dir = directory(root);
    paths::check(root, &dir, auth)?;
    lock_recovery::final_plain_path(&dir)?;
    if !fs::symlink_metadata(&dir)
        .map_err(|e| e.to_string())?
        .is_dir()
    {
        return Err("state records require an owned directory".into());
    }
    let (bytes, _) = read_plain(root, &dir.join(MARKER), auth)?;
    if serde_json::from_slice::<Value>(&bytes).map_err(|e| e.to_string())? != marker() {
        return Err("state record directory ownership mismatch".into());
    }
    Ok(dir)
}

fn ensure_directory(root: &Path, auth: Auth<'_>) -> Result<PathBuf, String> {
    let dir = directory(root);
    if paths::checked_metadata(root, &dir, auth)?.is_some() {
        return validate_directory(root, auth);
    }
    let parent = dir.parent().ok_or("missing state record parent")?;
    auth(parent, AccessMode::Write)?;
    auth(&dir, AccessMode::Write)?;
    lock_recovery::final_plain_path(parent)?;
    fs::create_dir(&dir).map_err(|e| e.to_string())?;
    let dir_identity = directory_identity(&dir).map_err(|error| {
        format!(
            "{error}; new state record directory requires recovery at {}",
            dir.display()
        )
    })?;
    let path = dir.join(MARKER);
    let mut created = None;
    let result = (|| {
        paths::check(root, &path, auth)?;
        auth(&dir, AccessMode::Write)?;
        auth(&path, AccessMode::Write)?;
        lock_recovery::final_plain_path(&dir)?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        created = Some(lock_recovery::identity(&file)?);
        file.write_all(&serde_json::to_vec(&marker()).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        Ok::<_, String>(())
    })();
    if let Err(error) = result {
        let cleanup = (|| {
            auth(parent, AccessMode::Write)?;
            auth(&dir, AccessMode::Write)?;
            if let Some(expected) = created {
                remove_created(root, &path, &expected, auth)?;
            }
            lock_recovery::final_plain_path(&dir)?;
            if directory_identity(&dir)? != dir_identity {
                return Err("new state record directory identity changed".into());
            }
            fs::remove_dir(&dir).map_err(|e| e.to_string())
        })();
        return Err(match cleanup {
            Ok(()) => error,
            Err(cleanup) => format!(
                "{error}; state record initialization cleanup incomplete at {}: {cleanup}",
                dir.display()
            ),
        });
    }
    validate_directory(root, auth)
}

fn entries(root: &Path, dir: &Path, auth: Auth<'_>) -> Result<Vec<(PathBuf, String)>, String> {
    auth(dir, AccessMode::Read)?;
    lock_recovery::final_plain_path(dir)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        paths::check(root, &path, auth)?;
        lock_recovery::final_plain_path(&path)?;
        let name = entry.file_name();
        let name = name.to_str().ok_or("unknown state record entry")?;
        if name == MARKER {
            continue;
        }
        let hash = name
            .strip_suffix(".json")
            .filter(|hash| valid_hash(hash))
            .ok_or("unknown state record entry")?;
        // Reject directories, links and multi-link files before any collection.
        lock_recovery::identity(&File::open(&path).map_err(|e| e.to_string())?)?;
        entries.push((path, hash.to_owned()));
    }
    Ok(entries)
}

fn read_blob(root: &Path, dir: &Path, hash: &str, auth: Auth<'_>) -> Result<Value, String> {
    let (bytes, _) = read_plain(root, &dir.join(format!("{hash}.json")), auth)?;
    if digest(&bytes) != hash {
        return Err("state record content hash mismatch".into());
    }
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

fn write_blob(root: &Path, dir: &Path, value: &Value, auth: Auth<'_>) -> Result<Value, String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    let hash = digest(&bytes);
    let path = dir.join(format!("{hash}.json"));
    paths::check(root, &path, auth)?;
    auth(dir, AccessMode::Write)?;
    auth(&path, AccessMode::Write)?;
    lock_recovery::final_plain_path(dir)?;
    match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut file) => {
            let identity = lock_recovery::identity(&file)?;
            let written = file.write_all(&bytes).and_then(|()| file.sync_all());
            if let Err(error) = written {
                drop(file);
                return Err(match remove_created(root, &path, &identity, auth) {
                    Ok(()) => error.to_string(),
                    Err(cleanup) => format!(
                        "{error}; new state record cleanup incomplete at {}: {cleanup}",
                        path.display()
                    ),
                });
            }
            lock_recovery::final_plain_path(&path)?;
            if lock_recovery::identity(&File::open(&path).map_err(|e| e.to_string())?)? != identity
            {
                return Err("state record replaced during creation".into());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let (existing, _) = read_plain(root, &path, auth)?;
            if digest(&existing) != hash || existing != bytes {
                return Err("existing immutable state record differs".into());
            }
        }
        Err(error) => return Err(error.to_string()),
    }
    Ok(Value::String(hash))
}

fn load_bucket<'a>(
    root: &Path,
    dir: &Path,
    bucket: &BTreeMap<String, &Value>,
    cache: &'a mut BTreeMap<String, Value>,
    auth: Auth<'_>,
) -> Result<Option<&'a Map<String, Value>>, String> {
    let Some(reference) = shared_reference(bucket)? else {
        return Ok(None);
    };
    let hash = hash_ref(reference)?;
    if !cache.contains_key(hash) {
        cache.insert(hash.to_owned(), read_blob(root, dir, hash, auth)?);
    }
    let values = cache
        .get(hash)
        .and_then(Value::as_object)
        .ok_or("state bucket must be an object")?;
    if values.len() != bucket.len() || bucket.keys().any(|id| !values.contains_key(id)) {
        return Err("state bucket membership differs from index".into());
    }
    Ok(Some(values))
}

pub(crate) fn read(root: &Path, index: &Value, auth: Auth<'_>) -> Result<Value, String> {
    references(index)?;
    let dir = validate_directory(root, auth)?;
    entries(root, &dir, auth)?;
    let mut cache = BTreeMap::new();
    let decisions = index["decisions"]
        .as_array()
        .ok_or("invalid state index decisions")?;
    let mut state = json!({"revision": index["state_revision"], "decisions": vec![Value::Null; decisions.len()]});
    for section in SECTIONS {
        let mut values = Map::new();
        let refs = index[section]
            .as_object()
            .ok_or("invalid state index section")?;
        for bucket in object_buckets(Some(refs)) {
            if let Some(records) = load_bucket(root, &dir, &bucket, &mut cache, auth)? {
                values.extend(
                    records
                        .iter()
                        .map(|(id, value)| (id.clone(), value.clone())),
                );
            }
        }
        state[section] = Value::Object(values);
    }
    for bucket in decision_buckets(Some(decisions)) {
        if let Some(records) = load_bucket(root, &dir, &bucket, &mut cache, auth)? {
            for (position, value) in records {
                let position = position.parse::<usize>().map_err(|e| e.to_string())?;
                state["decisions"][position] = value.clone();
            }
        }
    }
    Ok(state)
}

pub(crate) fn prepare(
    root: &Path,
    state: &Value,
    base: &Value,
    previous: Option<&Value>,
    auth: Auth<'_>,
) -> Result<Value, String> {
    let revision = state["revision"].as_u64().ok_or("invalid state revision")?;
    if state.as_object().is_none_or(|object| object.len() != 5) {
        return Err("invalid state fields".into());
    }
    if let Some(previous) = previous {
        references(previous)?;
    }
    // Validate the complete ordinary shape before creating any blobs.
    for section in SECTIONS {
        state[section].as_object().ok_or("invalid state section")?;
    }
    let decisions = state["decisions"]
        .as_array()
        .ok_or("invalid state decisions")?;
    let dir = ensure_directory(root, auth)?;
    let mut index =
        json!({"storage_format": FORMAT, "revision": FORMAT, "state_revision": revision});
    for section in SECTIONS {
        let mut refs = Map::new();
        let current = object_buckets(state[section].as_object());
        let base = object_buckets(base[section].as_object());
        for (position, bucket) in current.iter().enumerate() {
            let Some(id) = bucket.keys().next() else {
                continue;
            };
            let reused = previous
                .and_then(|previous| previous[section].get(id))
                .filter(|_| *bucket == base[position]);
            let reference = match reused {
                Some(reference) => reference.clone(),
                None => write_blob(
                    root,
                    &dir,
                    &serde_json::to_value(bucket).map_err(|e| e.to_string())?,
                    auth,
                )?,
            };
            refs.extend(bucket.keys().map(|id| (id.clone(), reference.clone())));
        }
        index[section] = Value::Object(refs);
    }
    let mut refs = vec![Value::Null; decisions.len()];
    let current = decision_buckets(Some(decisions));
    let base = decision_buckets(base["decisions"].as_array());
    for (position, bucket) in current.iter().enumerate() {
        if bucket.is_empty() {
            continue;
        }
        let reused = previous
            .and_then(|previous| previous["decisions"].get(position))
            .filter(|_| *bucket == base[position]);
        let reference = match reused {
            Some(reference) => reference.clone(),
            None => write_blob(
                root,
                &dir,
                &serde_json::to_value(bucket).map_err(|e| e.to_string())?,
                auth,
            )?,
        };
        for position in bucket.keys() {
            let position = position.parse::<usize>().map_err(|e| e.to_string())?;
            refs[position] = reference.clone();
        }
    }
    index["decisions"] = Value::Array(refs);
    Ok(index)
}

pub(crate) fn collect(root: &Path, index: &Value, auth: Auth<'_>) -> Result<(), String> {
    collect_selected(root, index, None, auth)
}

/// A committed update retires only records reachable from the previous index.
/// Other crash leftovers require the explicit full collection owner.
pub(crate) fn collect_obsolete(
    root: &Path,
    index: &Value,
    previous: &Value,
    auth: Auth<'_>,
) -> Result<(), String> {
    let current = references(index)?;
    let previous = references(previous)?;
    let obsolete = previous.difference(&current).cloned().collect();
    collect_selected(root, index, Some(&obsolete), auth)
}

fn collect_selected(
    root: &Path,
    index: &Value,
    obsolete: Option<&BTreeSet<String>>,
    auth: Auth<'_>,
) -> Result<(), String> {
    let referenced = references(index)?;
    let dir = validate_directory(root, auth)?;
    let dir_identity = directory_identity(&dir)?;
    let mut initial_identities = BTreeMap::new();
    let entries = if let Some(obsolete) = obsolete {
        let mut candidates = Vec::with_capacity(obsolete.len());
        for hash in obsolete {
            let path = dir.join(format!("{hash}.json"));
            if paths::checked_metadata(root, &path, auth)?.is_none() {
                continue;
            }
            auth(&path, AccessMode::Read)?;
            lock_recovery::final_plain_path(&path)?;
            let identity = lock_recovery::identity(&File::open(&path).map_err(|e| e.to_string())?)?;
            initial_identities.insert(path.clone(), identity);
            candidates.push((path, hash.clone()));
        }
        candidates
    } else {
        entries(root, &dir, auth)?
    };
    let present = entries
        .iter()
        .map(|(_, hash)| hash.clone())
        .collect::<BTreeSet<_>>();
    if obsolete.is_none() && !referenced.is_subset(&present) {
        return Err("referenced state record missing; collection refused".into());
    }
    let manifest = root.join("artifacts/maintenance/manifest.json");
    let pending = root.join("artifacts/maintenance/manifest.pending");
    paths::check(root, &manifest, auth)?;
    paths::check(root, &pending, auth)?;
    auth(&manifest, AccessMode::Read)?;
    auth(&pending, AccessMode::Read)?;
    // Authorizers can change sibling paths. Finish every callback before the
    // final complete validation, and do not run callbacks between unlink steps.
    auth(&dir, AccessMode::Write)?;
    for (path, hash) in &entries {
        if !referenced.contains(hash) && obsolete.is_none_or(|obsolete| obsolete.contains(hash)) {
            auth(path, AccessMode::Write)?;
        }
    }
    validate_directory(root, auth)?;
    if obsolete.is_none() {
        let final_entries = entries_no_callbacks(&dir)?;
        if final_entries != present {
            return Err("state record membership changed; collection refused".into());
        }
    }
    if directory_identity(&dir)? != dir_identity {
        return Err("state record directory changed; collection refused".into());
    }
    // No authorizer callbacks below: a single content pass follows all callbacks.
    let mut deleted = Vec::new();
    for (path, hash) in &entries {
        if obsolete.is_some_and(|obsolete| !obsolete.contains(hash)) {
            continue;
        }
        lock_recovery::final_plain_path(path)?;
        let mut file = File::open(path).map_err(|e| e.to_string())?;
        let identity = lock_recovery::identity(&file)?;
        if initial_identities
            .get(path)
            .is_some_and(|expected| *expected != identity)
        {
            return Err("obsolete state record identity changed; collection refused".into());
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        if digest(&bytes) != *hash || serde_json::from_slice::<Value>(&bytes).is_err() {
            return Err("state record changed; collection refused".into());
        }
        if !referenced.contains(hash) {
            deleted.push((path, identity));
        }
    }
    // Bind the deletion set to the actual committed index after every callback
    // and all content checks. No callback may invalidate this observation.
    committed_index(root, index)?;
    for (path, identity) in deleted {
        lock_recovery::final_plain_path(path)?;
        if lock_recovery::identity(&File::open(path).map_err(|e| e.to_string())?)? != identity {
            return Err("state record identity changed; collection refused".into());
        }
        fs::remove_file(&path)
            .map_err(|e| format!("state record cleanup failed at {}: {e}", path.display()))?;
        match fs::symlink_metadata(&path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            _ => {
                return Err(format!(
                    "state record cleanup not confirmed at {}",
                    path.display()
                ));
            }
        }
    }
    Ok(())
}

fn committed_index(root: &Path, index: &Value) -> Result<(), String> {
    let pending = root.join("artifacts/maintenance/manifest.pending");
    let no_pending = || match fs::symlink_metadata(&pending) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Ok(_) => Err("pending state commit protects records from collection".to_owned()),
        Err(error) => Err(error.to_string()),
    };
    no_pending()?;
    let manifest = root.join("artifacts/maintenance/manifest.json");
    lock_recovery::final_plain_path(&manifest)?;
    let mut file = File::open(&manifest).map_err(|e| e.to_string())?;
    let identity = lock_recovery::identity(&file)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if serde_json::from_slice::<Value>(&bytes).map_err(|e| e.to_string())? != *index {
        return Err("committed state index changed; collection refused".into());
    }
    lock_recovery::final_plain_path(&manifest)?;
    if lock_recovery::identity(&File::open(&manifest).map_err(|e| e.to_string())?)? != identity {
        return Err("committed state index identity changed; collection refused".into());
    }
    no_pending()
}

fn entries_no_callbacks(dir: &Path) -> Result<BTreeSet<String>, String> {
    lock_recovery::final_plain_path(dir)?;
    let mut hashes = BTreeSet::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        lock_recovery::final_plain_path(&path)?;
        lock_recovery::identity(&File::open(&path).map_err(|e| e.to_string())?)?;
        let name = entry.file_name();
        let name = name.to_str().ok_or("unknown state record entry")?;
        if name != MARKER {
            hashes.insert(
                name.strip_suffix(".json")
                    .filter(|hash| valid_hash(hash))
                    .ok_or("unknown state record entry")?
                    .to_owned(),
            );
        }
    }
    Ok(hashes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn commit(root: &Path, index: &Value) {
        fs::write(
            root.join("artifacts/maintenance/manifest.json"),
            serde_json::to_vec(index).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn references_reject_paths_and_wrong_formats() {
        let mut index = json!({"storage_format": FORMAT,"revision": FORMAT,"state_revision": 1,"items": {},"groups": {},"runs": {},"decisions": []});
        assert!(references(&index).is_ok());
        index["items"]["unsafe"] = json!("../escape");
        assert!(references(&index).is_err());
        index["items"] = json!({});
        index["revision"] = json!(1);
        assert!(references(&index).is_err());
    }

    #[test]
    fn roundtrip_reuses_records_and_collection_preserves_current_state() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("artifacts/maintenance")).unwrap();
        let allow = |_: &Path, _: AccessMode| Ok(());
        let context = crate::Context::new(&allow);
        let mut state = json!({"revision": 1,"items": {"a": {"value": 1},"b": {"value": 2}},"groups": {},"runs": {},"decisions": ["first", "second"]});
        let first = prepare(root.path(), &state, &Value::Null, None, &context).unwrap();
        assert_eq!(read(root.path(), &first, &context).unwrap(), state);
        let base = state.clone();
        state["revision"] = json!(2);
        state["items"]["a"]["value"] = json!(3);
        let second = prepare(root.path(), &state, &base, Some(&first), &context).unwrap();
        assert_eq!(first["items"]["b"], second["items"]["b"]);
        assert_ne!(first["items"]["a"], second["items"]["a"]);
        assert_eq!(first["decisions"], second["decisions"]);
        commit(root.path(), &second);
        collect_obsolete(root.path(), &second, &first, &context).unwrap();
        collect(root.path(), &second, &context).unwrap();
        assert_eq!(read(root.path(), &second, &context).unwrap(), state);
        let old =
            directory(root.path()).join(format!("{}.json", first["items"]["a"].as_str().unwrap()));
        assert!(!old.exists());
    }

    #[test]
    fn unowned_directories_and_unknown_entries_are_preserved() {
        let root = tempfile::tempdir().unwrap();
        let dir = directory(root.path());
        fs::create_dir_all(&dir).unwrap();
        let allow = |_: &Path, _: AccessMode| Ok(());
        let context = crate::Context::new(&allow);
        let state = json!({"revision": 0,"items": {},"groups": {},"runs": {},"decisions": []});
        assert!(prepare(root.path(), &state, &Value::Null, None, &context).is_err());
        assert!(!dir.join(MARKER).exists());
        fs::write(dir.join(MARKER), serde_json::to_vec(&marker()).unwrap()).unwrap();
        let index = prepare(root.path(), &state, &Value::Null, None, &context).unwrap();
        fs::write(dir.join("unknown"), b"preserve me").unwrap();
        commit(root.path(), &index);
        assert!(collect(root.path(), &index, &context).is_err());
        assert_eq!(fs::read(dir.join("unknown")).unwrap(), b"preserve me");
    }

    #[test]
    fn corruption_missing_references_and_denied_cleanup_fail_before_deletion() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("artifacts/maintenance")).unwrap();
        let allow = |_: &Path, _: AccessMode| Ok(());
        let context = crate::Context::new(&allow);
        let first_state =
            json!({"revision": 0,"items": {"a": 1},"groups": {},"runs": {},"decisions": []});
        let first = prepare(root.path(), &first_state, &Value::Null, None, &context).unwrap();
        let next_state =
            json!({"revision": 1,"items": {"a": 2},"groups": {},"runs": {},"decisions": []});
        let next = prepare(
            root.path(),
            &next_state,
            &first_state,
            Some(&first),
            &context,
        )
        .unwrap();
        let old_path =
            directory(root.path()).join(format!("{}.json", first["items"]["a"].as_str().unwrap()));
        let current_path =
            directory(root.path()).join(format!("{}.json", next["items"]["a"].as_str().unwrap()));
        let deny = |path: &Path, mode: AccessMode| {
            if path == old_path.as_path() && matches!(mode, AccessMode::Write) {
                Err("denied cleanup".into())
            } else {
                Ok(())
            }
        };
        let denied = crate::Context::new(&deny);
        commit(root.path(), &next);
        assert!(collect_obsolete(root.path(), &next, &first, &denied).is_err());
        assert!(old_path.exists());
        fs::write(&current_path, b"corrupt").unwrap();
        assert!(read(root.path(), &next, &context).is_err());
        assert!(collect(root.path(), &next, &context).is_err());
        assert!(old_path.exists());
        let mut missing = next.clone();
        missing["items"]["a"] = json!("0".repeat(64));
        assert!(collect(root.path(), &missing, &context).is_err());
        assert!(old_path.exists());
        fs::write(&old_path, b"corrupt obsolete candidate").unwrap();
        assert!(collect_obsolete(root.path(), &next, &first, &context).is_err());
        assert!(old_path.exists());
    }

    #[test]
    fn hardlinked_records_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("artifacts/maintenance")).unwrap();
        let allow = |_: &Path, _: AccessMode| Ok(());
        let context = crate::Context::new(&allow);
        let state =
            json!({"revision": 0,"items": {"a": 1},"groups": {},"runs": {},"decisions": []});
        let index = prepare(root.path(), &state, &Value::Null, None, &context).unwrap();
        let path =
            directory(root.path()).join(format!("{}.json", index["items"]["a"].as_str().unwrap()));
        fs::hard_link(&path, root.path().join("external-link")).unwrap();
        commit(root.path(), &index);
        assert!(read(root.path(), &index, &context).is_err());
        assert!(collect(root.path(), &index, &context).is_err());
        assert!(path.exists());
        let next_state =
            json!({"revision": 1,"items": {"a": 2},"groups": {},"runs": {},"decisions": []});
        let next = prepare(root.path(), &next_state, &state, Some(&index), &context).unwrap();
        commit(root.path(), &next);
        assert!(collect_obsolete(root.path(), &next, &index, &context).is_err());
        assert!(path.exists());
    }

    #[test]
    fn failed_owner_creation_removes_only_the_new_empty_directory() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("artifacts/maintenance")).unwrap();
        let deny = |path: &Path, mode: AccessMode| {
            if path.file_name().is_some_and(|name| name == MARKER)
                && matches!(mode, AccessMode::Write)
            {
                Err("owner marker write denied".into())
            } else {
                Ok(())
            }
        };
        let context = crate::Context::new(&deny);
        let state = json!({"revision": 0,"items": {},"groups": {},"runs": {},"decisions": []});
        assert!(prepare(root.path(), &state, &Value::Null, None, &context).is_err());
        assert!(!directory(root.path()).exists());
        assert!(root.path().join("artifacts/maintenance").is_dir());
    }

    #[test]
    fn thousand_record_state_has_bounded_live_buckets_and_rewrites_only_one_bucket() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("artifacts/maintenance")).unwrap();
        let allow = |_: &Path, _: AccessMode| Ok(());
        let context = crate::Context::new(&allow);
        let mut state = json!({"revision": 1,"items": {},"groups": {},"runs": {},"decisions": []});
        for section in SECTIONS {
            for position in 0..1000 {
                state[section][format!("record-{position}")] =
                    json!({"section": section,"value": position});
            }
        }
        state["decisions"] = json!((0..1000).collect::<Vec<_>>());
        let first = prepare(root.path(), &state, &Value::Null, None, &context).unwrap();
        assert!(references(&first).unwrap().len() <= 4 * BUCKETS);
        assert_eq!(read(root.path(), &first, &context).unwrap(), state);
        let base = state.clone();
        state["items"]["record-0"]["value"] = json!("changed");
        state["revision"] = json!(2);
        let next = prepare(root.path(), &state, &base, Some(&first), &context).unwrap();
        let changed_bucket = usize::from(Sha256::digest(b"record-0")[0]) % 16;
        for (id, reference) in first["items"].as_object().unwrap() {
            if usize::from(Sha256::digest(id.as_bytes())[0]) % 16 == changed_bucket {
                assert_ne!(reference, &next["items"][id]);
            } else {
                assert_eq!(reference, &next["items"][id]);
            }
        }
        for section in ["groups", "runs", "decisions"] {
            assert_eq!(first[section], next[section]);
        }
        assert_eq!(
            references(&next)
                .unwrap()
                .difference(&references(&first).unwrap())
                .count(),
            1
        );
        commit(root.path(), &next);
        collect_obsolete(root.path(), &next, &first, &context).unwrap();
        assert!(
            entries(root.path(), &directory(root.path()), &context)
                .unwrap()
                .len()
                <= 4 * BUCKETS
        );
        assert_eq!(read(root.path(), &next, &context).unwrap(), state);
    }

    #[test]
    fn bucket_membership_cannot_hide_additional_records() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("artifacts/maintenance")).unwrap();
        let allow = |_: &Path, _: AccessMode| Ok(());
        let context = crate::Context::new(&allow);
        let state =
            json!({"revision": 0,"items": {"a": 1},"groups": {},"runs": {},"decisions": []});
        let mut index = prepare(root.path(), &state, &Value::Null, None, &context).unwrap();
        let dir = directory(root.path());
        index["items"]["a"] =
            write_blob(root.path(), &dir, &json!({"a": 1,"hidden": 2}), &context).unwrap();
        assert!(
            read(root.path(), &index, &context)
                .unwrap_err()
                .contains("membership")
        );
    }

    #[test]
    fn collection_rebinds_committed_index_and_pending_after_authorizer_callbacks() {
        let root = tempfile::tempdir().unwrap();
        let maintenance = root.path().join("artifacts/maintenance");
        fs::create_dir_all(&maintenance).unwrap();
        let allow = |_: &Path, _: AccessMode| Ok(());
        let context = crate::Context::new(&allow);
        let base = json!({"revision": 0,"items": {"a": 1},"groups": {},"runs": {},"decisions": []});
        let first = prepare(root.path(), &base, &Value::Null, None, &context).unwrap();
        let changed =
            json!({"revision": 1,"items": {"a": 2},"groups": {},"runs": {},"decisions": []});
        let next = prepare(root.path(), &changed, &base, Some(&first), &context).unwrap();
        let old_path =
            directory(root.path()).join(format!("{}.json", first["items"]["a"].as_str().unwrap()));
        for incremental in [false, true] {
            // Missing committed state is never authority to collect.
            let result = if incremental {
                collect_obsolete(root.path(), &next, &first, &context)
            } else {
                collect(root.path(), &next, &context)
            };
            assert!(result.is_err());
            assert!(old_path.exists());
        }
        for incremental in [false, true] {
            for create_pending in [false, true] {
                commit(root.path(), &next);
                let mutate = |path: &Path, mode: AccessMode| {
                    if path == old_path.as_path() && matches!(mode, AccessMode::Write) {
                        if create_pending {
                            fs::write(maintenance.join("manifest.pending"), b"pending")
                                .map_err(|e| e.to_string())?;
                        } else {
                            fs::write(
                                maintenance.join("manifest.json"),
                                serde_json::to_vec(&first).map_err(|e| e.to_string())?,
                            )
                            .map_err(|e| e.to_string())?;
                        }
                    }
                    Ok(())
                };
                let guarded = crate::Context::new(&mutate);
                let result = if incremental {
                    collect_obsolete(root.path(), &next, &first, &guarded)
                } else {
                    collect(root.path(), &next, &guarded)
                };
                assert!(result.is_err());
                assert!(old_path.exists());
                if create_pending {
                    fs::remove_file(maintenance.join("manifest.pending")).unwrap();
                }
            }
        }
        commit(root.path(), &next);
        collect_obsolete(root.path(), &next, &first, &context).unwrap();
        assert!(!old_path.exists());
    }

    #[test]
    fn prepare_and_incremental_collection_do_not_inspect_unrelated_namespace_entries() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("artifacts/maintenance")).unwrap();
        let allow = |_: &Path, _: AccessMode| Ok(());
        let context = crate::Context::new(&allow);
        let base = json!({"revision": 0,"items": {"a": 1},"groups": {},"runs": {},"decisions": []});
        let first = prepare(root.path(), &base, &Value::Null, None, &context).unwrap();
        let unrelated = directory(root.path()).join("unknown");
        fs::write(&unrelated, b"unrelated and preserved").unwrap();
        let deny_unrelated = |path: &Path, _: AccessMode| {
            if path == unrelated.as_path() {
                Err("unrelated entry must not be inspected".into())
            } else {
                Ok(())
            }
        };
        let targeted = crate::Context::new(&deny_unrelated);
        let next_state =
            json!({"revision": 1,"items": {"a": 2},"groups": {},"runs": {},"decisions": []});
        let next = prepare(root.path(), &next_state, &base, Some(&first), &targeted).unwrap();
        commit(root.path(), &next);
        collect_obsolete(root.path(), &next, &first, &targeted).unwrap();
        assert_eq!(fs::read(&unrelated).unwrap(), b"unrelated and preserved");
        assert!(collect(root.path(), &next, &targeted).is_err());
        let old =
            directory(root.path()).join(format!("{}.json", first["items"]["a"].as_str().unwrap()));
        assert!(!old.exists());
    }
}

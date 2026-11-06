//! Local, explicitly addressed task memory. See README.md for the disk contract.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const MAX_FILE: u64 = 32_768;
const MAX_REVISIONS: usize = 10_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AccessMode {
    Read,
    Write,
}
pub struct Actor {
    pub session_id: String,
    pub root_session_id: String,
    pub is_root: bool,
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Init,
    List {
        limit: Option<usize>,
        offset: Option<usize>,
        kind: Option<Kind>,
    },
    Read {
        id: String,
        revision: Option<u64>,
    },
    Write {
        id: Option<String>,
        expected_revision: u64,
        kind: Kind,
        title: String,
        body: String,
        evidence: Vec<String>,
        scope: String,
        uncertainty: Option<String>,
    },
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Kind {
    Context,
    Finding,
    Task,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Owner {
    schema_version: u32,
    root_session_id: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    id: String,
    kind: Kind,
    title: String,
    body: String,
    evidence: Vec<String>,
    scope: String,
    uncertainty: Option<String>,
    revision: u64,
    author_session_id: String,
    updated_at_ms: u64,
}
type Authorize<'a> = &'a dyn Fn(&Path, AccessMode) -> Result<(), String>;

fn checked(path: &Path, mode: AccessMode, authorize: Authorize<'_>) -> Result<(), String> {
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("memory paths must be absolute without parent traversal".into());
    }
    let mut ancestor = PathBuf::new();
    for component in path.components() {
        ancestor.push(component);
        authorize(&ancestor, AccessMode::Read)?;
        match fs::symlink_metadata(&ancestor) {
            Ok(meta) => {
                if meta.file_type().is_symlink() || is_reparse(&meta) {
                    return Err(format!(
                        "memory path contains a link: {}",
                        ancestor.display()
                    ));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    authorize(path, mode)
}
#[cfg(windows)]
fn is_reparse(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    meta.file_attributes() & 0x400 != 0
}
#[cfg(not(windows))]
fn is_reparse(_: &fs::Metadata) -> bool {
    false
}
fn read_json<T: serde::de::DeserializeOwned>(
    path: &Path,
    authorize: Authorize<'_>,
) -> Result<T, String> {
    checked(path, AccessMode::Read, authorize)?;
    let file = File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("expected memory file".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_FILE + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_FILE {
        return Err("memory file exceeds size limit".into());
    }
    serde_json::from_slice(&bytes).map_err(|e| format!("invalid memory file: {e}"))
}
fn commit<T: Serialize>(
    directory: &Path,
    destination: &Path,
    value: &T,
    authorize: Authorize<'_>,
) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_FILE {
        return Err("entry exceeds serialized size limit".into());
    }
    checked(directory, AccessMode::Write, authorize)?;
    checked(destination, AccessMode::Write, authorize)?;
    let name = format!(".pending-{}", Uuid::new_v4());
    checked(&directory.join(&name), AccessMode::Write, authorize)?;
    // No randomized suffix: authorize the exact temporary path before creation.
    let mut temp = tempfile::Builder::new()
        .prefix(&name)
        .rand_bytes(0)
        .tempfile_in(directory)
        .map_err(|e| e.to_string())?;
    temp.write_all(&bytes).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    checked(destination, AccessMode::Write, authorize)?;
    temp.persist_noclobber(destination)
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn directory(path: &Path, authorize: Authorize<'_>) -> Result<(), String> {
    checked(path, AccessMode::Write, authorize)?;
    match fs::create_dir(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            if path.is_dir() {
                Ok(())
            } else {
                Err("expected memory directory".into())
            }
        }
        Err(e) => Err(e.to_string()),
    }
}
fn valid_id(id: &str) -> Result<(), String> {
    if Uuid::parse_str(id)
        .map(|u| u.to_string() == id)
        .unwrap_or(false)
    {
        Ok(())
    } else {
        Err("id must be a canonical UUID".into())
    }
}
fn text(value: &str, name: &str, max: usize, required: bool) -> Result<(), String> {
    if value.len() > max || (required && value.trim().is_empty()) {
        Err(format!(
            "{name} must be {}..={max} UTF-8 bytes",
            usize::from(required)
        ))
    } else {
        Ok(())
    }
}
fn latest(directory: &Path, id: &str, authorize: Authorize<'_>) -> Result<Entry, String> {
    latest_committed(directory, id, authorize)?
        .ok_or_else(|| "incomplete entry: no committed revisions".into())
}
fn latest_committed(
    directory: &Path,
    id: &str,
    authorize: Authorize<'_>,
) -> Result<Option<Entry>, String> {
    let revisions = revisions(directory, authorize)?;
    let Some(revision) = revisions.into_iter().max() else {
        return Ok(None);
    };
    let entry: Entry = read_json(&directory.join(format!("{revision}.json")), authorize)?;
    if entry.id != id || entry.revision != revision {
        return Err("inconsistent memory revision".into());
    }
    Ok(Some(entry))
}
fn revisions(directory: &Path, authorize: Authorize<'_>) -> Result<Vec<u64>, String> {
    checked(directory, AccessMode::Read, authorize)?;
    let mut result = Vec::new();
    for (index, item) in fs::read_dir(directory)
        .map_err(|e| e.to_string())?
        .enumerate()
    {
        if index >= MAX_REVISIONS {
            return Err("memory revision scan limit exceeded".into());
        }
        let item = item.map_err(|e| e.to_string())?;
        checked(&item.path(), AccessMode::Read, authorize)?;
        let name = item
            .file_name()
            .into_string()
            .map_err(|_| "invalid revision name")?;
        if name.starts_with(".pending-") {
            continue;
        }
        let n = name
            .strip_suffix(".json")
            .and_then(|s| s.parse::<u64>().ok())
            .filter(|n| *n > 0)
            .ok_or("invalid revision file")?;
        result.push(n);
        if result.len() > MAX_REVISIONS {
            return Err("memory revision scan limit exceeded".into());
        }
    }
    Ok(result)
}

/// Dispatches a strict, bounded request against an explicitly selected work directory.
/// The caller supplies its existing filesystem authorization boundary.
pub fn dispatch(
    work_dir: &Path,
    request: Value,
    actor: &Actor,
    authorize: Authorize<'_>,
) -> Result<Value, String> {
    let request: Request =
        serde_json::from_value(request).map_err(|e| format!("invalid memory request: {e}"))?;
    text(&actor.session_id, "session_id", 256, true)?;
    text(&actor.root_session_id, "root_session_id", 256, true)?;
    if actor.is_root && actor.session_id != actor.root_session_id {
        return Err("invalid root identity".into());
    }
    checked(work_dir, AccessMode::Read, authorize)?;
    if !work_dir.is_dir() {
        return Err("work_dir must be an existing directory".into());
    }
    let mem = work_dir.join("mem");
    if matches!(request, Request::Init) {
        if !actor.is_root {
            return Err("only root can initialize task memory".into());
        }
        directory(&mem, authorize)?;
    }
    checked(&mem, AccessMode::Read, authorize)?;
    let lock_path = mem.join("store.lock");
    let writing = matches!(request, Request::Init | Request::Write { .. });
    checked(
        &lock_path,
        if writing {
            AccessMode::Write
        } else {
            AccessMode::Read
        },
        authorize,
    )?;
    let lock = OpenOptions::new()
        .read(true)
        .write(writing)
        .create(writing)
        .truncate(false)
        .open(&lock_path)
        .map_err(|e| e.to_string())?;
    if writing {
        lock.try_lock()
    } else {
        lock.try_lock_shared()
    }
    .map_err(|e| format!("task memory is busy: {e}"))?;
    let owner_path = mem.join("owner.json");
    checked(&owner_path, AccessMode::Read, authorize)?;
    if matches!(request, Request::Init) && !owner_path.try_exists().map_err(|e| e.to_string())? {
        commit(
            &mem,
            &owner_path,
            &Owner {
                schema_version: 1,
                root_session_id: actor.root_session_id.clone(),
            },
            authorize,
        )?;
    }
    let owner: Owner = read_json(&owner_path, authorize)?;
    if owner.schema_version != 1 {
        return Err("unsupported task memory schema".into());
    }
    let entries = mem.join("entries");
    if matches!(request, Request::Init) {
        directory(&entries, authorize)?;
        return Ok(json!({"initialized": true, "schema_version": 1}));
    }
    match request {
        Request::Init => unreachable!(),
        Request::Read { id, revision } => {
            valid_id(&id)?;
            let dir = entries.join(&id);
            let entry = match revision {
                Some(0) => return Err("revision must be positive".into()),
                Some(n) => {
                    let entry: Entry = read_json(&dir.join(format!("{n}.json")), authorize)?;
                    if entry.id != id || entry.revision != n {
                        return Err("inconsistent memory revision".into());
                    }
                    entry
                }
                None => latest(&dir, &id, authorize)?,
            };
            serde_json::to_value(entry).map_err(|e| e.to_string())
        }
        Request::List {
            limit,
            offset,
            kind,
        } => {
            let limit = limit.unwrap_or(20);
            if limit == 0 || limit > 100 {
                return Err("limit must be 1..=100".into());
            }
            let offset = offset.unwrap_or(0);
            checked(&entries, AccessMode::Read, authorize)?;
            let mut summaries = Vec::new();
            for (index, item) in fs::read_dir(&entries)
                .map_err(|e| e.to_string())?
                .enumerate()
            {
                if index >= MAX_REVISIONS {
                    return Err("memory entry scan limit exceeded".into());
                }
                let item = item.map_err(|e| e.to_string())?;
                let id = item
                    .file_name()
                    .into_string()
                    .map_err(|_| "invalid entry name")?;
                valid_id(&id)?;
                let Some(entry) = latest_committed(&item.path(), &id, authorize)? else {
                    // An interrupted first commit has no trustworthy kind or author.
                    if kind.is_none() {
                        summaries.push(json!({"id":id,"incomplete":true}));
                    }
                    continue;
                };
                if kind.is_none_or(|k| k == entry.kind) {
                    summaries.push(json!({"id":entry.id,"title":entry.title,"kind":entry.kind,
                        "revision":entry.revision,"author_session_id":entry.author_session_id,
                        "updated_at_ms":entry.updated_at_ms}));
                }
                if summaries.len() > MAX_REVISIONS {
                    return Err("memory entry scan limit exceeded".into());
                }
            }
            summaries.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
            let total = summaries.len();
            Ok(
                json!({"entries":summaries.into_iter().skip(offset).take(limit).collect::<Vec<_>>(),"total":total,"offset":offset}),
            )
        }
        Request::Write {
            id,
            expected_revision,
            kind,
            title,
            body,
            evidence,
            scope,
            uncertainty,
        } => {
            text(&title, "title", 256, true)?;
            text(&body, "body", 16_384, true)?;
            text(&scope, "scope", 2048, true)?;
            if evidence.len() > 16 {
                return Err("evidence is limited to 16 references".into());
            }
            for item in &evidence {
                text(item, "evidence reference", 512, true)?;
            }
            if let Some(value) = &uncertainty {
                text(value, "uncertainty", 2048, false)?;
            }
            if kind == Kind::Context && !actor.is_root {
                return Err("only root can write context".into());
            }
            let id = match id {
                Some(id) => {
                    if expected_revision == 0 {
                        return Err("new entry IDs are tool-assigned; omit id for creation".into());
                    }
                    valid_id(&id)?;
                    id
                }
                None => {
                    if expected_revision != 0 {
                        return Err("new entries require expected_revision 0".into());
                    }
                    Uuid::new_v4().to_string()
                }
            };
            let dir = entries.join(&id);
            checked(&dir, AccessMode::Read, authorize)?;
            if dir.try_exists().map_err(|e| e.to_string())? {
                let previous = latest(&dir, &id, authorize)?;
                if previous.revision != expected_revision {
                    return Err(format!(
                        "revision conflict: current revision is {}",
                        previous.revision
                    ));
                }
                if previous.author_session_id != actor.session_id || previous.kind != kind {
                    return Err(
                        "only the owning session can update an entry; kind is immutable".into(),
                    );
                }
            } else if expected_revision != 0 {
                return Err("entry does not exist".into());
            }
            let revision = expected_revision
                .checked_add(1)
                .ok_or("revision overflow")?;
            let entry = Entry {
                id: id.clone(),
                kind,
                title,
                body,
                evidence,
                scope,
                uncertainty,
                revision,
                author_session_id: actor.session_id.clone(),
                updated_at_ms: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_err(|e| e.to_string())?
                    .as_millis()
                    .try_into()
                    .map_err(|_| "timestamp overflow")?,
            };
            if serde_json::to_vec(&entry).map_err(|e| e.to_string())?.len() as u64 > MAX_FILE {
                return Err("entry exceeds serialized size limit".into());
            }
            directory(&dir, authorize)?;
            commit(
                &dir,
                &dir.join(format!("{revision}.json")),
                &entry,
                authorize,
            )?;
            Ok(json!({
                "id":entry.id,"revision":entry.revision,"kind":entry.kind,
                "title":entry.title,"author_session_id":entry.author_session_id,
                "updated_at_ms":entry.updated_at_ms,"stored":true
            }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    fn root() -> Actor {
        Actor {
            session_id: "root".into(),
            root_session_id: "root".into(),
            is_root: true,
        }
    }
    fn child() -> Actor {
        Actor {
            session_id: "child".into(),
            root_session_id: "root".into(),
            is_root: false,
        }
    }
    fn allow(_: &Path, _: AccessMode) -> Result<(), String> {
        Ok(())
    }
    fn write(id: Option<&str>, revision: u64, kind: &str) -> Value {
        json!({"action":"write","id":id,"expected_revision":revision,"kind":kind,
            "title":"Result","body":"Verified finding","evidence":["src/example.rs::example"],"scope":"task"})
    }
    fn store() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("temporary work directory");
        dispatch(dir.path(), json!({"action":"init"}), &root(), &allow).expect("initialize");
        dir
    }

    // Later storage simplification must not replace immutable history or weaken CAS.
    #[test]
    fn revisions_survive_reopen_and_lists_exclude_bodies() {
        let dir = store();
        let first = dispatch(dir.path(), write(None, 0, "finding"), &child(), &allow).unwrap();
        assert_eq!(first["stored"], true);
        assert!(first.get("body").is_none());
        assert!(first.get("evidence").is_none());
        let id = first["id"].as_str().unwrap();
        let mut update = write(Some(id), 1, "finding");
        update["body"] = json!("New conclusion");
        let second = dispatch(dir.path(), update.clone(), &child(), &allow).unwrap();
        assert_eq!(second["revision"], 2);
        assert!(
            dispatch(dir.path(), update, &child(), &allow)
                .unwrap_err()
                .contains("conflict")
        );
        let old = dispatch(
            dir.path(),
            json!({"action":"read","id":id,"revision":1}),
            &root(),
            &allow,
        )
        .unwrap();
        assert_eq!(old["id"], first["id"]);
        assert_eq!(old["revision"], 1);
        assert_eq!(old["body"], "Verified finding");
        assert_eq!(old["evidence"], json!(["src/example.rs::example"]));
        let current = dispatch(
            dir.path(),
            json!({"action":"read","id":id}),
            &root(),
            &allow,
        )
        .unwrap();
        assert_eq!(current["id"], second["id"]);
        assert_eq!(current["revision"], 2);
        assert_eq!(current["body"], "New conclusion");
        assert_eq!(current["evidence"], json!(["src/example.rs::example"]));
        let list = dispatch(dir.path(), json!({"action":"list"}), &root(), &allow).unwrap();
        assert_eq!(list["total"], 1);
        assert!(list["entries"][0].get("body").is_none());
        assert!(
            dispatch(
                dir.path(),
                json!({"action":"read","id":id,"revision":99}),
                &root(),
                &allow
            )
            .is_err()
        );
        dir.close().unwrap();
    }

    // Role and author checks are distinct: future root conveniences must preserve both.
    #[test]
    fn owners_context_and_strict_requests_cannot_be_bypassed() {
        let dir = store();
        assert!(dispatch(dir.path(), write(None, 0, "context"), &child(), &allow).is_err());
        let first = dispatch(dir.path(), write(None, 0, "task"), &child(), &allow).unwrap();
        assert!(
            dispatch(
                dir.path(),
                write(Some(&Uuid::new_v4().to_string()), 0, "task"),
                &child(),
                &allow
            )
            .is_err()
        );
        assert!(
            dispatch(
                dir.path(),
                write(first["id"].as_str(), 1, "task"),
                &root(),
                &allow
            )
            .is_err()
        );
        let mut forged = write(None, 0, "finding");
        forged["author_session_id"] = json!("root");
        assert!(dispatch(dir.path(), forged, &child(), &allow).is_err());
        assert!(
            dispatch(
                dir.path(),
                json!({"action":"list","limit":101}),
                &root(),
                &allow
            )
            .is_err()
        );
        let mut oversized = write(None, 0, "finding");
        oversized["body"] = json!("\0".repeat(16_384));
        assert!(dispatch(dir.path(), oversized, &child(), &allow).is_err());
        assert_eq!(
            dispatch(dir.path(), json!({"action":"list"}), &root(), &allow).unwrap()["total"],
            1
        );
        dir.close().unwrap();
    }

    // Future lifecycle changes must not bind work to its first root or transfer authorship.
    #[test]
    fn replacement_root_reuses_work_without_transferring_authorship() {
        let dir = store();
        let original = dispatch(dir.path(), write(None, 0, "context"), &root(), &allow).unwrap();
        let replacement = Actor {
            session_id: "replacement".into(),
            root_session_id: "replacement".into(),
            is_root: true,
        };
        dispatch(dir.path(), json!({"action":"init"}), &replacement, &allow).unwrap();
        let restored = dispatch(
            dir.path(),
            json!({"action":"read","id":original["id"]}),
            &replacement,
            &allow,
        )
        .unwrap();
        assert_eq!(restored["id"], original["id"]);
        assert_eq!(restored["revision"], 1);
        assert_eq!(restored["body"], "Verified finding");
        assert_eq!(restored["author_session_id"], "root");
        assert!(
            dispatch(
                dir.path(),
                write(original["id"].as_str(), 1, "context"),
                &replacement,
                &allow
            )
            .is_err()
        );
        let mut next = write(None, 0, "context");
        next["evidence"] = json!([format!("memory:{}@1", original["id"].as_str().unwrap())]);
        let context = dispatch(dir.path(), next, &replacement, &allow).unwrap();
        assert_eq!(context["author_session_id"], "replacement");
        assert_eq!(
            dispatch(dir.path(), json!({"action":"list"}), &replacement, &allow).unwrap()["total"],
            2
        );
        let provenance: Owner = read_json(&dir.path().join("mem/owner.json"), &allow).unwrap();
        assert_eq!(provenance.root_session_id, "root");
        dir.close().unwrap();
    }

    // A later lock/CAS refactor must still permit exactly one writer of a revision.
    #[test]
    fn concurrent_writers_cannot_commit_the_same_revision() {
        let dir = store();
        let first = dispatch(dir.path(), write(None, 0, "finding"), &child(), &allow).unwrap();
        let id = first["id"].as_str().unwrap().to_owned();
        let barrier = Arc::new(Barrier::new(2));
        let threads = (0..2)
            .map(|_| {
                let path = dir.path().to_path_buf();
                let id = id.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    dispatch(&path, write(Some(&id), 1, "finding"), &child(), &allow)
                })
            })
            .collect::<Vec<_>>();
        let results = threads
            .into_iter()
            .map(|t| t.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
        assert_eq!(
            dispatch(
                dir.path(),
                json!({"action":"read","id":id}),
                &root(),
                &allow
            )
            .unwrap()["revision"],
            2
        );
        dir.close().unwrap();
    }

    // Path checks must survive future layout changes and include authorization failures.
    #[test]
    fn rejects_traversal_and_authorization_denials() {
        let dir = store();
        assert!(
            dispatch(
                &dir.path().join(".."),
                json!({"action":"list"}),
                &root(),
                &allow
            )
            .is_err()
        );
        assert!(
            dispatch(
                dir.path(),
                json!({"action":"read","id":"../owner"}),
                &root(),
                &allow
            )
            .is_err()
        );
        let denied = |path: &Path, mode: AccessMode| {
            if mode == AccessMode::Read && path.ends_with("store.lock") {
                Err("denied lock".into())
            } else {
                Ok(())
            }
        };
        assert_eq!(
            dispatch(dir.path(), json!({"action":"list"}), &root(), &denied).unwrap_err(),
            "denied lock"
        );
        dir.close().unwrap();
    }

    #[test]
    fn read_only_authorization_allows_shared_reads_but_denies_writes() {
        let dir = store();
        let first = dispatch(dir.path(), write(None, 0, "finding"), &child(), &allow).unwrap();
        let read_only = |_: &Path, mode: AccessMode| {
            if mode == AccessMode::Write {
                Err("read only".into())
            } else {
                Ok(())
            }
        };
        let retrieved = dispatch(
            dir.path(),
            json!({"action":"read","id":first["id"]}),
            &root(),
            &read_only,
        )
        .unwrap();
        assert_eq!(retrieved["id"], first["id"]);
        assert_eq!(retrieved["revision"], 1);
        assert_eq!(retrieved["body"], "Verified finding");
        assert_eq!(
            dispatch(dir.path(), json!({"action":"list"}), &root(), &read_only).unwrap()["total"],
            1
        );
        assert_eq!(
            dispatch(dir.path(), write(None, 0, "finding"), &child(), &read_only).unwrap_err(),
            "read only"
        );
        dir.close().unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_ancestors() {
        let dir = tempfile::tempdir().unwrap();
        let actual = dir.path().join("actual");
        fs::create_dir(&actual).unwrap();
        let link = dir.path().join("linked");
        std::os::unix::fs::symlink(&actual, &link).unwrap();
        assert!(
            dispatch(&link, json!({"action":"init"}), &root(), &allow)
                .unwrap_err()
                .contains("link")
        );
        dir.close().unwrap();
    }

    // A crash before the first immutable commit must not hide unrelated results.
    #[test]
    fn incomplete_entries_remain_visible_without_breaking_listing() {
        let dir = store();
        let complete = dispatch(dir.path(), write(None, 0, "finding"), &child(), &allow).unwrap();
        let incomplete = Uuid::new_v4().to_string();
        let incomplete_path = dir.path().join("mem/entries").join(&incomplete);
        fs::create_dir(&incomplete_path).unwrap();
        let listed = dispatch(dir.path(), json!({"action":"list"}), &root(), &allow).unwrap();
        assert_eq!(listed["total"], 2);
        let marker = listed["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["id"] == incomplete)
            .unwrap();
        assert_eq!(marker, &json!({"id":incomplete,"incomplete":true}));
        assert!(
            listed["entries"]
                .as_array()
                .unwrap()
                .iter()
                .any(|entry| entry["id"] == complete["id"])
        );
        fs::write(incomplete_path.join(".pending-interrupted"), b"unfinished").unwrap();
        let filtered = dispatch(
            dir.path(),
            json!({"action":"list","kind":"finding"}),
            &root(),
            &allow,
        )
        .unwrap();
        assert_eq!(filtered["total"], 1);
        assert_eq!(filtered["entries"][0]["id"], complete["id"]);
        assert_eq!(
            dispatch(dir.path(), json!({"action":"list"}), &root(), &allow).unwrap()["total"],
            2
        );
        assert!(
            dispatch(
                dir.path(),
                json!({"action":"read","id":incomplete}),
                &root(),
                &allow
            )
            .unwrap_err()
            .contains("incomplete entry")
        );
        assert!(
            dispatch(
                dir.path(),
                write(Some(&incomplete), 1, "finding"),
                &child(),
                &allow
            )
            .unwrap_err()
            .contains("incomplete entry")
        );
        assert!(incomplete_path.join(".pending-interrupted").exists());
        dir.close().unwrap();
    }
}

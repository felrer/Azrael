//! Durable opt-in suppression of automatic work after an intentional host stop.
use codex_protocol::ThreadId;
use serde::Deserialize;
use serde::Serialize;
use std::collections::BTreeSet;
use std::fs::File;
use std::io;
use std::path::Path;
use std::path::PathBuf;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Marker {
    schema: u32,
    threads: BTreeSet<String>,
}

fn marker_path(home: &Path) -> PathBuf {
    home.join("azrael/runtime/manual-resume.json")
}

fn read_marker(home: &Path) -> io::Result<Marker> {
    let bytes = match std::fs::read(marker_path(home)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(Marker {
                schema: 1,
                threads: BTreeSet::new(),
            });
        }
        Err(error) => return Err(error),
    };
    let marker: Marker = serde_json::from_slice(&bytes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if marker.schema != 1
        || marker
            .threads
            .iter()
            .any(|id| ThreadId::from_string(id).is_err())
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid manual-resume marker",
        ));
    }
    Ok(marker)
}

/// Missing markers preserve ordinary recovery; unreadable markers suppress automatic work.
pub fn requires_manual_resume(home: &Path, thread_id: ThreadId) -> bool {
    read_marker(home).map_or(true, |marker| {
        marker.threads.contains(&thread_id.to_string())
    })
}

fn update_marker(home: &Path, update: impl FnOnce(&mut BTreeSet<String>)) -> io::Result<()> {
    let path = marker_path(home);
    let parent = path.parent().expect("marker has parent");
    std::fs::create_dir_all(parent)?;
    // A separate stable lock serializes read/modify/replace across host processes.
    let lock = File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(parent.join("manual-resume.lock"))?;
    lock.lock()?;
    let mut marker = read_marker(home)?;
    update(&mut marker.threads);
    let contents = serde_json::to_string(&marker).map_err(io::Error::other)?;
    crate::path_utils::write_atomically(&path, &contents)
}

/// Atomically union the stopped threads with any previously stopped threads.
pub fn mark_threads_for_manual_resume(
    home: &Path,
    thread_ids: impl IntoIterator<Item = ThreadId>,
) -> io::Result<()> {
    update_marker(home, |threads| {
        threads.extend(thread_ids.into_iter().map(|id| id.to_string()))
    })
}

/// Only an explicit manual request may clear its own thread's marker.
pub fn clear_manual_resume(home: &Path, thread_id: ThreadId) -> io::Result<()> {
    if !requires_manual_resume(home, thread_id) {
        return Ok(());
    }
    update_marker(home, |threads| {
        threads.remove(&thread_id.to_string());
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absent_marker_preserves_recovery_and_clear_has_no_side_effects() {
        let home = tempfile::tempdir().unwrap();
        let id = ThreadId::new();
        assert!(!requires_manual_resume(home.path(), id));
        clear_manual_resume(home.path(), id).unwrap();
        assert!(!home.path().join("azrael").exists());
    }

    #[test]
    fn union_survives_reload_and_clear_preserves_other_threads() {
        let home = tempfile::tempdir().unwrap();
        let a = ThreadId::new();
        let b = ThreadId::new();
        mark_threads_for_manual_resume(home.path(), [a]).unwrap();
        mark_threads_for_manual_resume(home.path(), [b, a]).unwrap();
        assert!(requires_manual_resume(home.path(), a));
        assert!(requires_manual_resume(home.path(), b));
        clear_manual_resume(home.path(), a).unwrap();
        assert!(!requires_manual_resume(home.path(), a));
        assert!(requires_manual_resume(home.path(), b));
    }

    #[test]
    fn concurrent_marks_do_not_lose_threads() {
        let home = tempfile::tempdir().unwrap();
        let ids = [ThreadId::new(), ThreadId::new(), ThreadId::new()];
        std::thread::scope(|scope| {
            for id in ids {
                let home = home.path();
                scope.spawn(move || mark_threads_for_manual_resume(home, [id]).unwrap());
            }
        });
        for id in ids {
            assert!(requires_manual_resume(home.path(), id));
        }
    }

    #[test]
    fn corrupt_unknown_schema_and_unreadable_markers_fail_closed() {
        let home = tempfile::tempdir().unwrap();
        let path = marker_path(home.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        for contents in [
            "broken",
            r#"{"schema":2,"threads":[]}"#,
            r#"{"schema":1,"threads":["invalid"]}"#,
        ] {
            std::fs::write(&path, contents).unwrap();
            assert!(requires_manual_resume(home.path(), ThreadId::new()));
            assert!(clear_manual_resume(home.path(), ThreadId::new()).is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), contents);
        }
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        assert!(requires_manual_resume(home.path(), ThreadId::new()));
    }
}

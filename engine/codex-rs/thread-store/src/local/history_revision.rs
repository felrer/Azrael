//! Validates snapshots of append-only local rollouts before reusing them for resume.
//!
//! Capture before and after reading; any change or unavailable metadata disables reuse. The
//! selected path prevents reuse for a different rollout. Validate under writer ownership,
//! before opening the recorder can materialize a compressed file.

use std::path::Path;

pub(super) async fn read(path: &Path) -> Option<String> {
    let path = codex_rollout::existing_rollout_path(path).await?;
    let path = tokio::fs::canonicalize(path).await.ok()?;
    let metadata = tokio::fs::metadata(&path).await.ok()?;
    let modified = metadata.modified().ok()?;
    let created = metadata.created().ok();
    #[cfg(unix)]
    let identity = {
        use std::os::unix::fs::MetadataExt;
        Some((
            metadata.dev(),
            metadata.ino(),
            metadata.ctime(),
            metadata.ctime_nsec(),
        ))
    };
    #[cfg(not(unix))]
    let identity: Option<(u64, u64, i64, i64)> = None;
    serde_json::to_string(&("local", path, metadata.len(), modified, created, identity)).ok()
}

#[cfg(test)]
mod tests {
    use super::read;
    use crate::ThreadStore;
    use crate::local::LocalThreadStore;
    use crate::local::test_support::test_config;
    use std::io::Write;

    #[tokio::test]
    async fn validates_unchanged_revision_and_rejects_append_replacement_missing_and_unknown()
    -> Result<(), Box<dyn std::error::Error>> {
        let temp = tempfile::tempdir()?;
        let path = temp.path().join("rollout.jsonl");
        std::fs::write(&path, "initial\n")?;
        let store = LocalThreadStore::new(test_config(temp.path()), None);
        let revision = read(&path).await.expect("revision for existing file");
        assert!(
            store
                .validate_history_revision(path.clone(), revision.clone())
                .await?
        );
        assert!(
            !store
                .validate_history_revision(path.clone(), "unknown".into())
                .await?
        );
        assert!(
            !store
                .validate_history_revision(temp.path().join("other.jsonl"), revision.clone())
                .await?
        );

        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)?
            .write_all(b"append\n")?;
        assert!(
            !store
                .validate_history_revision(path.clone(), revision)
                .await?
        );

        let revision = read(&path).await.expect("revision after append");
        let replacement = temp.path().join("replacement.jsonl");
        std::fs::write(&replacement, "replacement history\n")?;
        std::fs::rename(&path, temp.path().join("previous.jsonl"))?;
        std::fs::rename(replacement, &path)?;
        assert!(
            !store
                .validate_history_revision(path.clone(), revision)
                .await?
        );

        let revision = read(&path).await.expect("revision after replacement");
        std::fs::remove_file(&path)?;
        assert!(!store.validate_history_revision(path, revision).await?);
        Ok(())
    }
}

//! Engine-local session tracking and private shared control-directory initialization.

use codex_protocol::ThreadId;
use std::collections::HashSet;
use std::fs::{File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

pub(crate) struct ThreadEngineSessions {
    home: PathBuf,
    directory: PathBuf,
    instance: String,
    tracked: HashSet<ThreadId>,
}

fn check_control_directory(metadata: &std::fs::Metadata) -> io::Result<()> {
    let mut unsafe_entry = metadata.file_type().is_symlink() || !metadata.is_dir();
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        unsafe_entry |= metadata.uid() != unsafe { libc::geteuid() };
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        unsafe_entry |= metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    if unsafe_entry {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe conversation engine control path",
        ));
    }
    Ok(())
}

fn check_hint_file(metadata: &std::fs::Metadata) -> io::Result<()> {
    let mut unsafe_entry = metadata.file_type().is_symlink() || !metadata.is_file();
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        unsafe_entry |= metadata.uid() != unsafe { libc::geteuid() } || metadata.nlink() != 1;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        unsafe_entry |= metadata.file_attributes() & 0x400 != 0;
    }
    if unsafe_entry {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe conversation discovery hint path",
        ));
    }
    Ok(())
}

fn open_hint(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let file = options.open(path)?;
    check_hint_file(&file.metadata()?)?;
    Ok(file)
}

impl ThreadEngineSessions {
    pub(crate) async fn new(home: &Path, instance: &str) -> io::Result<Self> {
        codex_app_server_daemon::azrael_window_registry_path(home, instance)
            .map_err(io::Error::other)?;
        let mut directory = home.to_path_buf();
        check_control_directory(&std::fs::symlink_metadata(&directory)?)?;
        // Transfer receipts and account selections still use this private leaf.
        // General Azrael application data may have inherited permissions.
        directory.push("azrael-thread-engines-v1");
        match std::fs::symlink_metadata(&directory) {
            Ok(metadata) => check_control_directory(&metadata)?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        codex_uds::prepare_private_socket_directory(&directory).await?;
        check_control_directory(&std::fs::symlink_metadata(&directory)?)?;
        Ok(Self {
            home: home.into(),
            directory,
            instance: instance.into(),
            tracked: HashSet::new(),
        })
    }

    pub(crate) fn track(&mut self, thread: &str) -> io::Result<()> {
        let thread = ThreadId::from_string(thread)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid conversation ID"))?;
        self.tracked.insert(thread);
        Ok(())
    }

    pub(crate) fn tracked_threads(&self) -> HashSet<ThreadId> {
        self.tracked.clone()
    }

    /// A best-effort discovery hint, never ownership or admission authority.
    /// Readers must authenticate the peer and verify its live session.
    pub(crate) fn publish_hint(
        &self,
        thread: &str,
        descriptor: &serde_json::Value,
    ) -> io::Result<()> {
        let id = ThreadId::from_string(thread)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid conversation ID"))?;
        if !self.tracked.contains(&id)
            || descriptor["schema"] != 1
            || descriptor["protocol"] != 1
            || descriptor["threadId"].as_str() != Some(id.to_string().as_str())
            || descriptor["instanceId"].as_str() != Some(self.instance.as_str())
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "invalid conversation discovery hint",
            ));
        }
        check_control_directory(&std::fs::symlink_metadata(&self.home)?)?;
        check_control_directory(&std::fs::symlink_metadata(&self.directory)?)?;
        let path = self.directory.join(format!("{id}.engine.json"));
        let bytes = serde_json::to_vec(descriptor)?;
        if bytes.len() > 64 * 1024 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "conversation discovery hint exceeds limit",
            ));
        }
        match std::fs::symlink_metadata(&path) {
            Ok(metadata) => {
                check_hint_file(&metadata)?;
                let file = open_hint(&path)?;
                let mut existing = Vec::new();
                file.take(64 * 1024 + 1).read_to_end(&mut existing)?;
                if existing == bytes {
                    return Ok(());
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        let mut temporary = tempfile::NamedTempFile::new_in(&self.directory)?;
        temporary.write_all(&bytes)?;
        temporary.as_file().sync_all()?;
        temporary.persist(&path).map_err(|error| error.error)?;
        Ok(())
    }
    /// The caller has already stopped this engine's exact runtime and durably
    /// recorded its transfer. Releasing tracking does not modify shared files.
    /// Hints remain for authenticated liveness checks: deleting one could race
    /// with another engine publishing a replacement for the same session.
    pub(crate) fn release(&mut self, thread: &str) -> io::Result<()> {
        let id = ThreadId::from_string(thread)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid conversation ID"))?;
        if !self.tracked.remove(&id) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "conversation session is not tracked by this engine",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn independent_engines_track_the_same_session_without_ownership_files() {
        let home = tempfile::tempdir().unwrap();
        let mut first = ThreadEngineSessions::new(home.path(), &"a".repeat(64))
            .await
            .unwrap();
        let mut second = ThreadEngineSessions::new(home.path(), &"b".repeat(64))
            .await
            .unwrap();
        let selected = ThreadId::new();
        first.track(&selected.to_string()).unwrap();
        first.track(&selected.to_string().to_uppercase()).unwrap();
        second.track(&selected.to_string()).unwrap();
        assert_eq!(first.tracked_threads(), HashSet::from([selected]));
        assert_eq!(second.tracked_threads(), HashSet::from([selected]));
        let directory = home.path().join("azrael-thread-engines-v1");
        assert!(std::fs::read_dir(&directory).unwrap().next().is_none());
        first.release(&selected.to_string()).unwrap();
        drop(first);
        assert_eq!(second.tracked_threads(), HashSet::from([selected]));
        second.release(&selected.to_string()).unwrap();
        drop(second);
        assert!(std::fs::read_dir(&directory).unwrap().next().is_none());
    }

    #[tokio::test]
    async fn release_preserves_sibling_tracking_and_rejects_unknown_sessions() {
        let home = tempfile::tempdir().unwrap();
        let mut sessions = ThreadEngineSessions::new(home.path(), &"a".repeat(64))
            .await
            .unwrap();
        let selected = ThreadId::new();
        let sibling = ThreadId::new();
        sessions.track(&selected.to_string()).unwrap();
        sessions.track(&sibling.to_string()).unwrap();
        sessions.release(&selected.to_string()).unwrap();
        assert_eq!(sessions.tracked_threads(), HashSet::from([sibling]));
        assert_eq!(
            sessions.release(&selected.to_string()).unwrap_err().kind(),
            io::ErrorKind::PermissionDenied
        );
        assert_eq!(sessions.tracked_threads(), HashSet::from([sibling]));
        for invalid in ["../escape", "", "not-a-uuid"] {
            assert_eq!(
                sessions.track(invalid).unwrap_err().kind(),
                io::ErrorKind::InvalidInput
            );
            assert_eq!(
                sessions.release(invalid).unwrap_err().kind(),
                io::ErrorKind::InvalidInput
            );
        }
        assert_eq!(sessions.tracked_threads(), HashSet::from([sibling]));
    }

    #[tokio::test]
    async fn legacy_locked_file_and_malformed_descriptor_are_ignored_and_preserved() {
        let home = tempfile::tempdir().unwrap();
        let mut first = ThreadEngineSessions::new(home.path(), &"a".repeat(64))
            .await
            .unwrap();
        let selected = ThreadId::new().to_string();
        let directory = home.path().join("azrael-thread-engines-v1");
        let lock_path = directory.join(format!("{selected}.lock"));
        let descriptor = directory.join(format!("{selected}.engine.json"));
        std::fs::write(&lock_path, b"legacy lock contents").unwrap();
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&lock_path)
            .unwrap();
        lock.try_lock().unwrap();
        std::fs::write(&descriptor, b"{malformed descriptor").unwrap();
        let mut second = ThreadEngineSessions::new(home.path(), &"b".repeat(64))
            .await
            .unwrap();
        first.track(&selected).unwrap();
        second.track(&selected).unwrap();
        first.release(&selected).unwrap();
        second.release(&selected).unwrap();
        drop(first);
        drop(second);
        // Windows denies reads through a second handle while this legacy lock is held.
        drop(lock);
        assert_eq!(std::fs::read(&lock_path).unwrap(), b"legacy lock contents");
        assert_eq!(
            std::fs::read(&descriptor).unwrap(),
            b"{malformed descriptor"
        );
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 2);
    }

    fn hint(thread: &str, instance: &str) -> serde_json::Value {
        serde_json::json!({
            "schema": 1,
            "protocol": 1,
            "threadId": thread,
            "instanceId": instance,
        })
    }

    #[tokio::test]
    async fn explicit_hints_replace_stale_metadata_without_lockfiles_or_release_deletion() {
        let home = tempfile::tempdir().unwrap();
        let mut first = ThreadEngineSessions::new(home.path(), &"a".repeat(64))
            .await
            .unwrap();
        let mut second = ThreadEngineSessions::new(home.path(), &"b".repeat(64))
            .await
            .unwrap();
        let thread = ThreadId::new().to_string();
        first.track(&thread).unwrap();
        second.track(&thread).unwrap();
        let path = first.directory.join(format!("{thread}.engine.json"));
        std::fs::write(&path, b"{stale malformed metadata").unwrap();
        let first_hint = hint(&thread, &"a".repeat(64));
        first.publish_hint(&thread, &first_hint).unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&std::fs::read(&path).unwrap()).unwrap(),
            first_hint
        );
        let second_hint = hint(&thread, &"b".repeat(64));
        second.publish_hint(&thread, &second_hint).unwrap();
        first.release(&thread).unwrap();
        second.release(&thread).unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&std::fs::read(&path).unwrap()).unwrap(),
            second_hint
        );
        assert!(!first.directory.join(format!("{thread}.lock")).exists());
        assert_eq!(std::fs::read_dir(&first.directory).unwrap().count(), 1);
    }

    #[tokio::test]
    async fn publishing_hints_ignores_held_legacy_session_locks() {
        let home = tempfile::tempdir().unwrap();
        let mut sessions = ThreadEngineSessions::new(home.path(), &"a".repeat(64))
            .await
            .unwrap();
        let thread = ThreadId::new().to_string();
        let lock_path = sessions.directory.join(format!("{thread}.lock"));
        std::fs::write(&lock_path, b"legacy lock contents").unwrap();
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&lock_path)
            .unwrap();
        lock.try_lock().unwrap();
        sessions.track(&thread).unwrap();
        sessions
            .publish_hint(&thread, &hint(&thread, &"a".repeat(64)))
            .unwrap();
        sessions.release(&thread).unwrap();
        drop(lock);
        assert_eq!(std::fs::read(&lock_path).unwrap(), b"legacy lock contents");
        assert!(
            sessions
                .directory
                .join(format!("{thread}.engine.json"))
                .is_file()
        );
    }

    #[tokio::test]
    async fn invalid_or_unwritable_hints_do_not_change_session_tracking() {
        let home = tempfile::tempdir().unwrap();
        let mut sessions = ThreadEngineSessions::new(home.path(), &"a".repeat(64))
            .await
            .unwrap();
        let thread = ThreadId::new();
        let thread_string = thread.to_string();
        let valid = hint(&thread_string, &"a".repeat(64));
        assert!(sessions.publish_hint(&thread_string, &valid).is_err());
        assert!(sessions.tracked_threads().is_empty());
        sessions.track(&thread_string).unwrap();
        assert_eq!(
            sessions
                .publish_hint("../escape", &valid)
                .unwrap_err()
                .kind(),
            io::ErrorKind::InvalidInput
        );
        for field in ["schema", "protocol", "threadId", "instanceId"] {
            let mut invalid = valid.clone();
            invalid[field] = serde_json::Value::Null;
            assert!(sessions.publish_hint(&thread_string, &invalid).is_err());
            assert_eq!(sessions.tracked_threads(), HashSet::from([thread]));
        }
        let mut oversized = valid.clone();
        oversized["padding"] = serde_json::Value::String("x".repeat(64 * 1024));
        assert_eq!(
            sessions
                .publish_hint(&thread_string, &oversized)
                .unwrap_err()
                .kind(),
            io::ErrorKind::InvalidData
        );
        let path = sessions.directory.join(format!("{thread}.engine.json"));
        // A directory cannot be replaced by a hint file on any target platform.
        std::fs::create_dir(&path).unwrap();
        let marker = path.join("preserved");
        std::fs::write(&marker, b"preserve").unwrap();
        assert_eq!(
            sessions
                .publish_hint(&thread_string, &valid)
                .unwrap_err()
                .kind(),
            io::ErrorKind::PermissionDenied
        );
        assert_eq!(std::fs::read(&marker).unwrap(), b"preserve");
        assert_eq!(sessions.tracked_threads(), HashSet::from([thread]));
        assert!(!sessions.directory.join(format!("{thread}.lock")).exists());
    }
    #[cfg(windows)]
    fn inspect_acl(path: &Path) -> Vec<u8> {
        let output = std::process::Command::new("icacls.exe")
            .arg(path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        output.stdout
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn sessions_preserve_existing_application_data_and_permissions() {
        let home = tempfile::tempdir().unwrap();
        let application = home.path().join("azrael");
        let window_use = application.join("window-use");
        std::fs::create_dir_all(&window_use).unwrap();
        let data = window_use.join("existing.json");
        std::fs::write(&data, b"preserve window-use data").unwrap();
        let paths = [
            home.path(),
            application.as_path(),
            window_use.as_path(),
            data.as_path(),
        ];
        let before = paths.map(inspect_acl);

        let mut sessions = ThreadEngineSessions::new(home.path(), &"a".repeat(64))
            .await
            .unwrap();
        sessions.track(&ThreadId::new().to_string()).unwrap();
        assert!(home.path().join("azrael-thread-engines-v1").is_dir());
        assert_eq!(std::fs::read(&data).unwrap(), b"preserve window-use data");
        assert_eq!(before, paths.map(inspect_acl));
        assert!(!application.join("runtime").exists());
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn refuses_existing_inherited_control_directory_without_repair() {
        let home = tempfile::tempdir().unwrap();
        let directory = home.path().join("azrael-thread-engines-v1");
        std::fs::create_dir(&directory).unwrap();
        let before = inspect_acl(&directory);
        let error = ThreadEngineSessions::new(home.path(), &"a".repeat(64))
            .await
            .err()
            .expect("inherited control directory must be rejected");
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        assert_eq!(before, inspect_acl(&directory));
    }

    #[tokio::test]
    async fn refuses_a_control_directory_that_is_a_file() {
        let home = tempfile::tempdir().unwrap();
        let directory = home.path().join("azrael-thread-engines-v1");
        std::fs::write(&directory, b"preserve").unwrap();
        let error = ThreadEngineSessions::new(home.path(), &"a".repeat(64))
            .await
            .err()
            .expect("non-directory control path must be rejected");
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        assert_eq!(std::fs::read(&directory).unwrap(), b"preserve");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn ignores_linked_legacy_lockfiles_but_refuses_linked_control_directories() {
        use std::os::unix::fs::symlink;
        let home = tempfile::tempdir().unwrap();
        let mut sessions = ThreadEngineSessions::new(home.path(), &"a".repeat(64))
            .await
            .unwrap();
        let directory = home.path().join("azrael-thread-engines-v1");
        let thread = ThreadId::new();
        let target = home.path().join("untouched");
        std::fs::write(&target, b"preserve").unwrap();
        let lock_path = directory.join(format!("{thread}.lock"));
        symlink(&target, &lock_path).unwrap();
        sessions.track(&thread.to_string()).unwrap();
        sessions.release(&thread.to_string()).unwrap();
        assert!(
            std::fs::symlink_metadata(&lock_path)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(std::fs::read(&target).unwrap(), b"preserve");
        let other = tempfile::tempdir().unwrap();
        symlink(&directory, other.path().join("azrael-thread-engines-v1")).unwrap();
        assert!(
            ThreadEngineSessions::new(other.path(), &"b".repeat(64))
                .await
                .is_err()
        );
    }
}

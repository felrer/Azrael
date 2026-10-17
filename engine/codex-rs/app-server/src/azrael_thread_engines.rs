//! Home-global, process-lifetime admission for a conversation across engine releases.

use codex_protocol::ThreadId;
use std::collections::{HashMap, HashSet};
use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

pub(crate) struct ThreadEngineLeases {
    home: PathBuf,
    directory: PathBuf,
    instance: String,
    // Holding the actual file lock is authority. Neither file contents nor PID
    // existence can establish whether another engine still owns a conversation.
    owned: HashMap<ThreadId, File>,
}

fn check_metadata(metadata: &std::fs::Metadata, directory: bool) -> io::Result<()> {
    let mut unsafe_entry = metadata.file_type().is_symlink()
        || if directory {
            !metadata.is_dir()
        } else {
            !metadata.is_file()
        };
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        unsafe_entry |= metadata.uid() != unsafe { libc::geteuid() };
        if !directory {
            unsafe_entry |= metadata.nlink() != 1;
        }
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

impl ThreadEngineLeases {
    pub(crate) async fn new(home: &Path, instance: &str) -> io::Result<Self> {
        codex_app_server_daemon::azrael_window_registry_path(home, instance)
            .map_err(io::Error::other)?;
        let mut directory = home.to_path_buf();
        check_metadata(&std::fs::symlink_metadata(&directory)?, true)?;
        // General Azrael application data may already have inherited permissions.
        // Only this home-global control leaf requires a private-directory ACL.
        directory.push("azrael-thread-engines-v1");
        match std::fs::symlink_metadata(&directory) {
            Ok(metadata) => check_metadata(&metadata, true)?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        codex_uds::prepare_private_socket_directory(&directory).await?;
        check_metadata(&std::fs::symlink_metadata(&directory)?, true)?;
        Ok(Self {
            home: home.into(),
            directory,
            instance: instance.into(),
            owned: HashMap::new(),
        })
    }

    pub(crate) fn acquire(&mut self, thread: &str) -> io::Result<()> {
        let thread = ThreadId::from_string(thread)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid conversation ID"))?;
        if self.owned.contains_key(&thread) {
            return Ok(());
        }
        // UUID formatting canonicalizes alternate UUID spellings into one lock.
        let path = self.directory.join(format!("{thread}.lock"));
        let mut parent = self.directory.as_path();
        loop {
            check_metadata(&std::fs::symlink_metadata(parent)?, true)?;
            if parent == self.home {
                break;
            }
            parent = parent.parent().ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "conversation control path escaped state home",
                )
            })?;
        }
        if let Ok(metadata) = std::fs::symlink_metadata(&path) {
            check_metadata(&metadata, false)?;
        }
        let mut options = OpenOptions::new();
        options.create(true).truncate(false).read(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x00200000;
            options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
        }
        let file = options.open(path)?;
        check_metadata(&file.metadata()?, false)?;
        file.try_lock().map_err(|error| match error {
            std::fs::TryLockError::WouldBlock => io::Error::new(io::ErrorKind::WouldBlock,
                "This conversation is open in another Azrael engine. Reopen its matching version or close the originating version before retrying."),
            std::fs::TryLockError::Error(error) => error,
        })?;
        self.owned.insert(thread, file);
        Ok(())
    }

    pub(crate) fn owned_threads(&self) -> HashSet<ThreadId> {
        // Instance is validated once at construction and this keeper is never
        // transferred to a different engine during its lifetime.
        debug_assert_eq!(self.instance.len(), 64);
        self.owned.keys().copied().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    async fn lease_preserves_existing_application_data_and_permissions() {
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

        let mut keeper = ThreadEngineLeases::new(home.path(), &"a".repeat(64))
            .await
            .unwrap();
        keeper.acquire(&ThreadId::new().to_string()).unwrap();
        assert_eq!(
            keeper.directory,
            home.path().join("azrael-thread-engines-v1")
        );
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
        let error = ThreadEngineLeases::new(home.path(), &"a".repeat(64))
            .await
            .err()
            .expect("inherited control directory must be rejected");
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        assert_eq!(before, inspect_acl(&directory));
    }

    #[tokio::test]
    async fn engine_lease_reuse_conflict_drop_and_shutdown_filter() {
        let home = tempfile::tempdir().unwrap();
        let mut first = ThreadEngineLeases::new(home.path(), &"a".repeat(64))
            .await
            .unwrap();
        let mut second = ThreadEngineLeases::new(home.path(), &"b".repeat(64))
            .await
            .unwrap();
        let owned = ThreadId::new();
        let stale = ThreadId::new();
        first.acquire(&owned.to_string()).unwrap();
        first.acquire(&owned.to_string()).unwrap();
        assert_eq!(
            second.acquire(&owned.to_string()).unwrap_err().kind(),
            io::ErrorKind::WouldBlock
        );
        assert_eq!(first.owned_threads(), HashSet::from([owned]));
        assert!(!first.owned_threads().contains(&stale));
        assert!(second.owned_threads().is_empty());
        let path = first.directory.join(format!("{owned}.lock"));
        drop(first);
        assert!(path.exists());
        second.acquire(&owned.to_string()).unwrap();
        assert!(second.acquire("../escape").is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn refuses_linked_lockfiles_and_control_directories() {
        use std::os::unix::fs::symlink;
        let home = tempfile::tempdir().unwrap();
        let mut keeper = ThreadEngineLeases::new(home.path(), &"a".repeat(64))
            .await
            .unwrap();
        let thread = ThreadId::new();
        let target = home.path().join("untouched");
        std::fs::write(&target, b"preserve").unwrap();
        symlink(&target, keeper.directory.join(format!("{thread}.lock"))).unwrap();
        assert!(keeper.acquire(&thread.to_string()).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"preserve");
        let other = tempfile::tempdir().unwrap();
        symlink(
            &keeper.directory,
            other.path().join("azrael-thread-engines-v1"),
        )
        .unwrap();
        assert!(
            ThreadEngineLeases::new(other.path(), &"b".repeat(64))
                .await
                .is_err()
        );
    }
}

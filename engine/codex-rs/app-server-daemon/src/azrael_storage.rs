//! Concurrent admission for participating Azrael engines, before mutable startup.
//! This does not preflight databases or establish backward schema compatibility.

use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions, TryLockError};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const CONTROL_DIRECTORY: &str = "azrael-storage-admission-v1";
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

/// Keep this guard alive for the entire shared daemon lifetime.
#[derive(Debug)]
pub struct AzraelStorageLease {
    _lease: File,
    #[cfg(windows)]
    _directory: std::os::windows::io::OwnedHandle,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LeaseRecord {
    protocol: u32,
    compatibility: String,
}

fn digest(compatibility: &str) -> String {
    format!("{:x}", Sha256::digest(compatibility.as_bytes()))
}

fn validate_entry(path: &Path, directory: bool) -> Result<()> {
    let metadata = fs::symlink_metadata(path).context("inspect storage admission control entry")?;
    ensure!(
        !metadata.file_type().is_symlink()
            && if directory {
                metadata.is_dir()
            } else {
                metadata.is_file()
            },
        "invalid storage admission control entry type"
    );
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        ensure!(
            metadata.file_attributes() & 0x400 == 0,
            "storage admission reparse point refused"
        );
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        ensure!(
            metadata.uid() == unsafe { libc::geteuid() },
            "storage admission owner mismatch"
        );
        ensure!(
            metadata.mode() & 0o077 == 0,
            "storage admission control entry is not private"
        );
        if !directory {
            ensure!(metadata.nlink() == 1, "storage admission hard link refused");
        }
    }
    Ok(())
}

async fn prepare_control_directory(home: &Path) -> Result<PathBuf> {
    let home = home
        .canonicalize()
        .context("resolve storage admission home")?;
    ensure!(home.is_dir(), "storage admission home is not a directory");
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        ensure!(
            fs::metadata(&home)?.uid() == unsafe { libc::geteuid() },
            "storage admission home owner mismatch"
        );
        ensure!(
            fs::metadata(&home)?.mode() & 0o022 == 0,
            "storage admission home permits foreign mutation"
        );
    }
    let directory = home.join(CONTROL_DIRECTORY);
    // Validate before the shared helper, which can repair Unix modes. Existing
    // unsafe entries must be refused rather than repaired by admission.
    match fs::symlink_metadata(&directory) {
        Ok(_) => validate_entry(&directory, true)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error).context("inspect storage admission directory"),
    }
    codex_uds::prepare_private_socket_directory(&directory)
        .await
        .context("prepare private storage admission directory")?;
    validate_entry(&directory, true)?;
    Ok(directory)
}

fn open_control_file(path: &Path, create: bool) -> Result<File> {
    if path.try_exists()? {
        validate_entry(path, false)?;
    }
    let mut options = OpenOptions::new();
    options.read(true).write(true).create_new(create);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000).share_mode(3); // OPEN_REPARSE_POINT; no FILE_SHARE_DELETE
    }
    let file = options
        .open(path)
        .context("open storage admission control file")?;
    validate_entry(path, false)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let opened = file.metadata()?;
        let named = fs::symlink_metadata(path)?;
        ensure!(
            opened.dev() == named.dev() && opened.ino() == named.ino(),
            "storage admission control identity changed"
        );
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
        };
        let mut information: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        ensure!(
            unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut information) } != 0,
            "cannot inspect storage admission control identity"
        );
        ensure!(
            information.nNumberOfLinks == 1,
            "storage admission hard link refused"
        );
    }
    Ok(file)
}

fn open_or_create(path: &Path) -> Result<(File, bool)> {
    match open_control_file(path, true) {
        Ok(file) => Ok((file, true)),
        Err(error)
            if error
                .downcast_ref::<std::io::Error>()
                .is_some_and(|e| e.kind() == std::io::ErrorKind::AlreadyExists) =>
        {
            Ok((open_control_file(path, false)?, false))
        }
        Err(error) => Err(error),
    }
}

async fn lock_admission(file: &File) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(()),
            Err(TryLockError::WouldBlock) if Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            Err(TryLockError::WouldBlock) => {
                bail!("storage admission is busy; retry after other engine startup completes")
            }
            Err(TryLockError::Error(error)) => return Err(error).context("lock storage admission"),
        }
    }
}

fn read_record(file: &mut File, expected_digest: &str) -> Result<LeaseRecord> {
    ensure!(
        file.metadata()?.len() <= MAX_MANIFEST_BYTES,
        "invalid storage admission lease size"
    );
    file.seek(SeekFrom::Start(0))?;
    let mut bytes = Vec::new();
    file.take(MAX_MANIFEST_BYTES + 1).read_to_end(&mut bytes)?;
    // Do not include serde errors or manifest bytes: caller inputs need not be safe to log.
    let record: LeaseRecord = serde_json::from_slice(&bytes)
        .map_err(|_| anyhow::anyhow!("corrupt storage admission lease"))?;
    ensure!(
        record.protocol == 1 && digest(&record.compatibility) == expected_digest,
        "invalid storage admission lease identity"
    );
    Ok(record)
}

/// Exact compatibility manifests may coexist. An active different manifest
/// refuses admission before config or database initialization. Stale identities
/// remain on disk and native migration validation still governs later startups.
pub async fn acquire_azrael_storage_lease(
    home: &Path,
    compatibility: &str,
) -> Result<AzraelStorageLease> {
    ensure!(
        !compatibility.is_empty() && compatibility.len() as u64 <= MAX_MANIFEST_BYTES / 2,
        "invalid storage compatibility manifest size"
    );
    let directory = prepare_control_directory(home).await?;
    #[cfg(windows)]
    let (_, directory_guard) =
        codex_uds::validate_private_socket_path(&directory.join("admission.lock"))
            .context("pin private storage admission directory")?;
    let (admission, _) = open_or_create(&directory.join("admission.lock"))?;
    lock_admission(&admission).await?;
    let identity = digest(compatibility);
    for entry in fs::read_dir(&directory).context("scan storage admission leases")? {
        let entry = entry?;
        let name = entry.file_name();
        if name == "admission.lock" {
            continue;
        }
        let name = name
            .to_str()
            .context("invalid storage admission entry name")?;
        let hash = name
            .strip_suffix(".lease")
            .context("unexpected storage admission entry")?;
        ensure!(
            hash.len() == 64
                && hash
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
            "invalid storage admission lease name"
        );
        let mut file = open_control_file(&entry.path(), false)?;
        let record = read_record(&mut file, hash)?;
        ensure!(
            hash != identity || record.compatibility == compatibility,
            "storage admission manifest identity collision"
        );
        if hash != identity {
            match file.try_lock() {
                Ok(()) => {} // Closing this handle releases only our stale probe.
                Err(TryLockError::WouldBlock) => bail!(
                    "another Azrael engine is using incompatible storage; stop it before retrying"
                ),
                Err(TryLockError::Error(error)) => {
                    return Err(error).context("probe storage admission lease");
                }
            }
        }
    }
    let path = directory.join(format!("{identity}.lease"));
    let (mut lease, created) = open_or_create(&path)?;
    if created {
        lease
            .try_lock()
            .context("initialize storage admission lease")?;
        serde_json::to_writer(
            &mut lease,
            &LeaseRecord {
                protocol: 1,
                compatibility: compatibility.to_owned(),
            },
        )?;
        lease
            .sync_all()
            .context("persist storage admission lease")?;
        lease.unlock()?;
    } else {
        ensure!(
            read_record(&mut lease, &identity)?.compatibility == compatibility,
            "storage admission manifest mismatch"
        );
    }
    lease
        .try_lock_shared()
        .context("hold storage admission lease")?;
    Ok(AzraelStorageLease {
        _lease: lease,
        #[cfg(windows)]
        _directory: directory_guard,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Child, Command, Stdio};

    #[tokio::test]
    async fn equal_manifests_coexist_and_incompatible_retries_after_drop() -> Result<()> {
        let home = tempfile::tempdir()?;
        let first = acquire_azrael_storage_lease(home.path(), "schema-one").await?;
        let second = acquire_azrael_storage_lease(home.path(), "schema-one").await?;
        let error = acquire_azrael_storage_lease(home.path(), "schema-two")
            .await
            .unwrap_err();
        assert!(error.to_string().contains("incompatible storage"));
        drop(first);
        assert!(
            acquire_azrael_storage_lease(home.path(), "schema-two")
                .await
                .is_err()
        );
        drop(second);
        let _next = acquire_azrael_storage_lease(home.path(), "schema-two").await?;
        Ok(())
    }

    #[tokio::test]
    async fn corrupt_and_unexpected_leases_fail_closed_without_disclosing_inputs() -> Result<()> {
        let home = tempfile::tempdir()?;
        let lease = acquire_azrael_storage_lease(home.path(), "secret-synthetic-manifest").await?;
        drop(lease);
        let path = home
            .path()
            .join(CONTROL_DIRECTORY)
            .join(format!("{}.lease", digest("secret-synthetic-manifest")));
        fs::write(&path, b"corrupt secret-synthetic-manifest")?;
        let error = acquire_azrael_storage_lease(home.path(), "secret-synthetic-manifest")
            .await
            .unwrap_err();
        assert!(!format!("{error:#}").contains("secret-synthetic-manifest"));
        assert!(error.to_string().contains("corrupt"));

        let other = tempfile::tempdir()?;
        let directory = prepare_control_directory(other.path()).await?;
        let _unexpected = open_or_create(&directory.join("unexpected"))?;
        assert!(
            acquire_azrael_storage_lease(other.path(), "schema")
                .await
                .is_err()
        );
        Ok(())
    }

    #[tokio::test]
    async fn invalid_manifest_identity_is_refused_even_when_stale() -> Result<()> {
        let home = tempfile::tempdir()?;
        let directory = prepare_control_directory(home.path()).await?;
        let (mut file, _) =
            open_or_create(&directory.join(format!("{}.lease", digest("schema-one"))))?;
        serde_json::to_writer(
            &mut file,
            &LeaseRecord {
                protocol: 1,
                compatibility: "schema-two".into(),
            },
        )?;
        drop(file);
        assert!(
            acquire_azrael_storage_lease(home.path(), "schema-three")
                .await
                .is_err()
        );
        Ok(())
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn symlink_and_hardlink_escapes_are_refused() -> Result<()> {
        use std::os::unix::fs::symlink;
        let outside = tempfile::tempdir()?;
        let home = tempfile::tempdir()?;
        symlink(outside.path(), home.path().join(CONTROL_DIRECTORY))?;
        assert!(
            acquire_azrael_storage_lease(home.path(), "schema")
                .await
                .is_err()
        );
        assert!(fs::read_dir(outside.path())?.next().is_none());

        let other = tempfile::tempdir()?;
        let directory = prepare_control_directory(other.path()).await?;
        let target = outside.path().join("target");
        let _target = open_or_create(&target)?;
        symlink(&target, directory.join("admission.lock"))?;
        assert!(
            acquire_azrael_storage_lease(other.path(), "schema")
                .await
                .is_err()
        );

        let linked = tempfile::tempdir()?;
        let directory = prepare_control_directory(linked.path()).await?;
        fs::hard_link(target, directory.join("admission.lock"))?;
        assert!(
            acquire_azrael_storage_lease(linked.path(), "schema")
                .await
                .is_err()
        );
        Ok(())
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn windows_control_hardlink_escape_is_refused() -> Result<()> {
        let outside = tempfile::tempdir()?;
        let home = tempfile::tempdir()?;
        let directory = prepare_control_directory(home.path()).await?;
        let target = outside.path().join("target");
        fs::write(&target, b"outside")?;
        fs::hard_link(&target, directory.join("admission.lock"))?;
        assert!(
            acquire_azrael_storage_lease(home.path(), "schema")
                .await
                .is_err()
        );
        assert_eq!(fs::read(&target)?, b"outside");
        Ok(())
    }

    // This helper runs only in the explicitly spawned child, never as part of
    // the ordinary test suite, and holds a real process-owned filesystem lock.
    #[test]
    #[ignore]
    fn process_lease_holder() {
        let Some(home) = std::env::var_os("AZRAEL_STORAGE_TEST_HOME") else {
            return;
        };
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let _lease = runtime
            .block_on(acquire_azrael_storage_lease(
                Path::new(&home),
                "process-schema",
            ))
            .unwrap();
        fs::write(Path::new(&home).join("child-ready"), b"ready").unwrap();
        let mut input = String::new();
        std::io::stdin().read_line(&mut input).unwrap();
    }

    struct ChildGuard(Child);
    impl Drop for ChildGuard {
        fn drop(&mut self) {
            drop(self.0.stdin.take());
            let _ = self.0.wait();
        }
    }

    #[tokio::test]
    async fn subprocess_lock_admits_equal_and_refuses_different_manifest() -> Result<()> {
        let home = tempfile::tempdir()?;
        let child = Command::new(std::env::current_exe()?)
            .args([
                "--exact",
                "azrael_storage::tests::process_lease_holder",
                "--ignored",
                "--nocapture",
            ])
            .env("AZRAEL_STORAGE_TEST_HOME", home.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()?;
        let mut child = ChildGuard(child);
        let deadline = Instant::now() + Duration::from_secs(10);
        while !home.path().join("child-ready").try_exists()? {
            ensure!(
                child.0.try_wait()?.is_none(),
                "storage lease test child exited before readiness"
            );
            ensure!(
                Instant::now() < deadline,
                "storage lease test child readiness timeout"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let equal = acquire_azrael_storage_lease(home.path(), "process-schema").await?;
        assert!(
            acquire_azrael_storage_lease(home.path(), "different-schema")
                .await
                .is_err()
        );
        drop(equal);
        drop(child.0.stdin.take());
        ensure!(child.0.wait()?.success(), "storage lease test child failed");
        let _different = acquire_azrael_storage_lease(home.path(), "different-schema").await?;
        Ok(())
    }
}

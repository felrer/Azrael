//! Explicit whole-directory deletion, using pinned no-follow Unix objects.
//!
//! Enumeration is performed once per directory. Concurrent additions can make
//! rmdir fail; they never cause an unbounded rescan. Unix has no atomic
//! compare-identity-and-unlink operation, so adjacent checks reduce, but cannot
//! eliminate, hostile namespace races.
use std::ffi::OsString;
use std::os::fd::OwnedFd;
use std::os::unix::ffi::OsStrExt;
use std::path::{Component, Path, PathBuf};

use rustix::fs::{AtFlags, Dir, Mode, OFlags, fstat, open, openat, statat, unlinkat};
use serde_json::Value;

use super::Authorize;
use crate::AccessMode;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Identity {
    device: u64,
    inode: u64,
    kind: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Mount(Vec<u8>);

struct Directory {
    fd: OwnedFd,
    path: PathBuf,
    name: OsString,
    identity: Identity,
    mount: Mount,
}

struct Frame {
    directory: Directory,
    names: std::vec::IntoIter<OsString>,
}

fn error(context: impl std::fmt::Display) -> String {
    format!("Unix whole-directory deletion refused: {context}")
}

fn identity(stat: &rustix::fs::Stat) -> Identity {
    Identity {
        device: stat.st_dev as u64,
        inode: stat.st_ino as u64,
        kind: stat.st_mode as u32 & libc::S_IFMT as u32,
    }
}

#[cfg(target_os = "linux")]
fn mount(fd: &OwnedFd) -> Result<Mount, String> {
    use rustix::fs::{StatxFlags, statx};
    let stat = statx(fd, "", AtFlags::EMPTY_PATH, StatxFlags::MNT_ID).map_err(error)?;
    if stat.stx_mask & StatxFlags::MNT_ID.bits() == 0 {
        return Err(error("kernel did not supply STATX_MNT_ID"));
    }
    Ok(Mount(stat.stx_mnt_id.to_ne_bytes().to_vec()))
}

#[cfg(target_os = "macos")]
fn mount(fd: &OwnedFd) -> Result<Mount, String> {
    use std::os::fd::AsRawFd;
    let mut stat = std::mem::MaybeUninit::<libc::statfs>::uninit();
    // SAFETY: fd remains open, and successful fstatfs initializes stat.
    if unsafe { libc::fstatfs(fd.as_raw_fd(), stat.as_mut_ptr()) } != 0 {
        return Err(error(std::io::Error::last_os_error()));
    }
    // SAFETY: fstatfs succeeded. Darwin fsid_t contains two int32_t values.
    let stat = unsafe { stat.assume_init() };
    let bytes = unsafe {
        std::slice::from_raw_parts(
            std::ptr::addr_of!(stat.f_fsid).cast::<u8>(),
            std::mem::size_of_val(&stat.f_fsid),
        )
    };
    let mut identity = bytes.to_vec();
    identity.extend_from_slice(&stat.f_type.to_ne_bytes());
    let name: Vec<u8> = stat.f_mntonname.iter().map(|byte| *byte as u8).collect();
    let end = name
        .iter()
        .position(|byte| *byte == 0)
        .ok_or_else(|| error("mount attachment name is unterminated"))?;
    if end == 0 || name[0] != b'/' {
        return Err(error("mount attachment name is invalid"));
    }
    identity.extend_from_slice(&name[..end]);
    Ok(Mount(identity))
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn mount(_fd: &OwnedFd) -> Result<Mount, String> {
    Err(error("mount identity is unsupported on this Unix platform"))
}

fn observe(
    parent: &Directory,
    name: &OsString,
    path: &Path,
    authorize: &Authorize<'_>,
) -> Result<Identity, String> {
    authorize(path, AccessMode::Read)?;
    Ok(identity(
        &statat(&parent.fd, name, AtFlags::SYMLINK_NOFOLLOW).map_err(error)?,
    ))
}

fn open_directory(
    parent: &Directory,
    name: OsString,
    authorize: &Authorize<'_>,
) -> Result<Directory, String> {
    let path = parent.path.join(&name);
    let expected = observe(parent, &name, &path, authorize)?;
    if expected.kind != libc::S_IFDIR as u32 {
        return Err(error("directory is a symbolic link or was replaced"));
    }
    authorize(&path, AccessMode::Read)?;
    let fd = openat(
        &parent.fd,
        &name,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(error)?;
    authorize(&path, AccessMode::Read)?;
    if identity(&fstat(&fd).map_err(error)?) != expected {
        return Err(error("directory changed while opening"));
    }
    authorize(&path, AccessMode::Read)?;
    let mount = mount(&fd)?;
    Ok(Directory {
        fd,
        path,
        name,
        identity: expected,
        mount,
    })
}

fn verify(
    parent: &Directory,
    directory: &Directory,
    authorize: &Authorize<'_>,
) -> Result<(), String> {
    if observe(parent, &directory.name, &directory.path, authorize)? != directory.identity {
        return Err(error("directory namespace changed"));
    }
    authorize(&directory.path, AccessMode::Read)?;
    if identity(&fstat(&directory.fd).map_err(error)?) != directory.identity {
        return Err(error("open directory identity changed"));
    }
    authorize(&directory.path, AccessMode::Read)?;
    if mount(&directory.fd)? != directory.mount {
        return Err(error("directory mount changed"));
    }
    // A same-inode bind mount can leave statat identity unchanged. Reopen this
    // one namespace component to compare its current mount attachment too.
    let current = open_directory(parent, directory.name.clone(), authorize)?;
    if current.identity != directory.identity || current.mount != directory.mount {
        return Err(error("directory namespace or mount changed"));
    }
    Ok(())
}

fn frame(directory: Directory, authorize: &Authorize<'_>) -> Result<Frame, String> {
    authorize(&directory.path, AccessMode::Read)?;
    let mut names = Vec::new();
    let mut entries = Dir::read_from(&directory.fd).map_err(error)?;
    loop {
        authorize(&directory.path, AccessMode::Read)?;
        let Some(entry) = entries.next() else {
            break;
        };
        let entry = entry.map_err(error)?;
        let name = entry.file_name().to_bytes();
        if name == b"." || name == b".." {
            continue;
        }
        if std::str::from_utf8(name).is_err() {
            return Err(error(
                "non-UTF-8 directory entry is unsupported by the maintenance protocol",
            ));
        }
        names.push(std::ffi::OsStr::from_bytes(name).to_os_string());
    }
    Ok(Frame {
        directory,
        names: names.into_iter(),
    })
}

fn check_cancelled(cancelled: &dyn Fn() -> bool) -> Result<(), String> {
    if cancelled() {
        Err(error("cancelled"))
    } else {
        Ok(())
    }
}

pub(super) fn delete(
    path: &Path,
    expected_identity: &Value,
    authorize: &Authorize<'_>,
    cancelled: &dyn Fn() -> bool,
    stats: &mut super::Stats,
) -> Result<(), String> {
    check_cancelled(cancelled)?;
    if path.to_str().is_none()
        || !path.is_absolute()
        || path
            .as_os_str()
            .as_bytes()
            .split(|b| *b == b'/')
            .any(|p| p == b"." || p == b"..")
    {
        return Err(error("an absolute normalized UTF-8 path is required"));
    }
    let mut components = Vec::new();
    for component in path.components() {
        match component {
            Component::RootDir => {}
            Component::Normal(name) => components.push(name.to_os_string()),
            _ => return Err(error("invalid path component")),
        }
    }
    let root_name = components
        .pop()
        .ok_or_else(|| error("filesystem root cannot be deleted"))?;
    let device = expected_identity
        .get("device")
        .and_then(Value::as_u64)
        .ok_or_else(|| error("missing root device identity"))?;
    let inode = expected_identity
        .get("inode")
        .and_then(Value::as_u64)
        .ok_or_else(|| error("missing root inode identity"))?;
    authorize(Path::new("/"), AccessMode::Read)?;
    let fd = open(
        "/",
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(error)?;
    authorize(Path::new("/"), AccessMode::Read)?;
    let root_stat = identity(&fstat(&fd).map_err(error)?);
    authorize(Path::new("/"), AccessMode::Read)?;
    let root_mount = mount(&fd)?;
    let mut ancestors = vec![Directory {
        fd,
        path: PathBuf::from("/"),
        name: OsString::new(),
        identity: root_stat,
        mount: root_mount,
    }];
    for name in components {
        let child = open_directory(ancestors.last().unwrap(), name, authorize)?;
        ancestors.push(child);
    }
    let parent = ancestors.last().unwrap();
    let root = open_directory(parent, root_name, authorize)?;
    if root.identity.device != device || root.identity.inode != inode {
        return Err(error("approved root identity changed"));
    }
    if root.mount != parent.mount {
        return Err(error("root mount boundary crossed"));
    }
    for pair in ancestors.windows(2) {
        verify(&pair[0], &pair[1], authorize)?;
    }
    verify(parent, &root, authorize)?;
    let mut stack = vec![frame(root, authorize)?];
    loop {
        check_cancelled(cancelled)?;
        // Pin both the selected root name and its parent's namespace without
        // rewalking all ancestors for each file.
        if ancestors.len() > 1 {
            verify(&ancestors[ancestors.len() - 2], parent, authorize)?;
        }
        verify(parent, &stack[0].directory, authorize)?;
        let index = stack.len() - 1;
        let next = stack[index].names.next();
        let containing_parent = if index == 0 {
            parent
        } else {
            &stack[index - 1].directory
        };
        verify(containing_parent, &stack[index].directory, authorize)?;
        let Some(name) = next else {
            let directory = &stack[index].directory;
            authorize(&directory.path, AccessMode::Write)?;
            authorize(&containing_parent.path, AccessMode::Write)?;
            if ancestors.len() > 1 {
                verify(&ancestors[ancestors.len() - 2], parent, authorize)?;
            }
            verify(parent, &stack[0].directory, authorize)?;
            verify(containing_parent, directory, authorize)?;
            check_cancelled(cancelled)?;
            unlinkat(&containing_parent.fd, &directory.name, AtFlags::REMOVEDIR).map_err(error)?;
            stats.directories += 1;
            stack.pop();
            if stack.is_empty() {
                return Ok(());
            }
            continue;
        };
        let directory = &stack[index].directory;
        let child_path = directory.path.join(&name);
        let expected = observe(directory, &name, &child_path, authorize)?;
        if expected.kind == libc::S_IFDIR as u32 {
            let child = open_directory(directory, name, authorize)?;
            if child.identity != expected {
                return Err(error("directory entry changed"));
            }
            if child.mount != stack[0].directory.mount {
                return Err(error("mount boundary crossed"));
            }
            stack.push(frame(child, authorize)?);
            continue;
        }
        let link = expected.kind == libc::S_IFLNK as u32;
        if !link && expected.kind != libc::S_IFREG as u32 {
            return Err(error("special file is unsupported"));
        }
        // Regular-file descriptors detect same-device file bind mounts too.
        // Links are never opened or followed; only their namespace name is removed.
        let _leaf = if !link {
            authorize(&child_path, AccessMode::Read)?;
            let mut flags = OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK;
            #[cfg(target_os = "linux")]
            {
                flags |= OFlags::PATH;
            }
            #[cfg(target_os = "macos")]
            {
                flags |= OFlags::from_bits_retain(libc::O_EVTONLY as u32);
            }
            #[cfg(not(any(target_os = "linux", target_os = "macos")))]
            {
                flags |= OFlags::RDONLY;
            }
            let fd = openat(&directory.fd, &name, flags, Mode::empty()).map_err(error)?;
            authorize(&child_path, AccessMode::Read)?;
            if identity(&fstat(&fd).map_err(error)?) != expected {
                return Err(error("file changed while opening"));
            }
            authorize(&child_path, AccessMode::Read)?;
            if mount(&fd)? != stack[0].directory.mount {
                return Err(error("mount boundary crossed"));
            }
            Some(fd)
        } else {
            None
        };
        authorize(&child_path, AccessMode::Write)?;
        authorize(&directory.path, AccessMode::Write)?;
        if ancestors.len() > 1 {
            verify(&ancestors[ancestors.len() - 2], parent, authorize)?;
        }
        verify(parent, &stack[0].directory, authorize)?;
        verify(containing_parent, directory, authorize)?;
        if observe(directory, &name, &child_path, authorize)? != expected {
            return Err(error("leaf namespace changed"));
        }
        check_cancelled(cancelled)?;
        unlinkat(&directory.fd, &name, AtFlags::empty()).map_err(error)?;
        if link {
            stats.links += 1;
        } else {
            stats.files += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::{MetadataExt, symlink};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    fn expected(path: &Path) -> Value {
        let metadata = fs::symlink_metadata(path).unwrap();
        serde_json::json!({"device": metadata.dev(), "inode": metadata.ino()})
    }

    fn stats() -> super::super::Stats {
        super::super::Stats {
            files: 0,
            directories: 0,
            links: 0,
        }
    }

    // A later reuse of exact-tree snapshot approval would incorrectly reject
    // new contents. Retain this boundary check alongside link-target safety.
    #[test]
    fn whole_directory_includes_new_contents_and_preserves_link_targets() {
        let fixture = tempfile::tempdir().unwrap();
        let fixture_path = fs::canonicalize(fixture.path()).unwrap();
        let tree = fixture_path.join("tree");
        fs::create_dir(&tree).unwrap();
        let identity = expected(&tree);
        fs::create_dir(tree.join("new-directory")).unwrap();
        fs::write(tree.join("new-directory/new-file"), b"new").unwrap();
        let target = fixture_path.join("target");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("keep"), b"keep").unwrap();
        symlink(&target, tree.join("link")).unwrap();
        symlink(fixture_path.join("absent"), tree.join("broken-link")).unwrap();
        let mut removed = stats();
        delete(&tree, &identity, &|_, _| Ok(()), &|| false, &mut removed).unwrap();
        assert!(!tree.exists());
        assert_eq!(fs::read(target.join("keep")).unwrap(), b"keep");
        assert_eq!(
            (removed.files, removed.directories, removed.links),
            (1, 2, 2)
        );
    }

    // A path-only root check, or checking only before permission callbacks,
    // would delete contents of an object moved out of the approved namespace.
    #[test]
    fn root_replacement_during_authorization_stops_before_leaf_mutation() {
        let fixture = tempfile::tempdir().unwrap();
        let fixture_path = fs::canonicalize(fixture.path()).unwrap();
        let tree = fixture_path.join("tree");
        let held = fixture_path.join("held");
        fs::create_dir(&tree).unwrap();
        fs::write(tree.join("file"), b"keep").unwrap();
        let identity = expected(&tree);
        let callback_tree = tree.clone();
        let callback_held = held.clone();
        let changed = AtomicBool::new(false);
        let auth = move |path: &Path, mode| {
            if mode == AccessMode::Write
                && path == callback_tree.join("file")
                && !changed.swap(true, Ordering::SeqCst)
            {
                fs::rename(&callback_tree, &callback_held).unwrap();
                fs::create_dir(&callback_tree).unwrap();
            }
            Ok(())
        };
        let mut removed = stats();
        assert!(delete(&tree, &identity, &auth, &|| false, &mut removed).is_err());
        assert_eq!(fs::read(held.join("file")).unwrap(), b"keep");
        assert!(tree.is_dir());
        assert_eq!(removed.files, 0);
    }

    #[test]
    fn stale_or_symlink_root_is_refused() {
        let fixture = tempfile::tempdir().unwrap();
        let fixture_path = fs::canonicalize(fixture.path()).unwrap();
        let tree = fixture_path.join("tree");
        let held = fixture_path.join("held");
        fs::create_dir(&tree).unwrap();
        let identity = expected(&tree);
        fs::rename(&tree, &held).unwrap();
        fs::create_dir(&tree).unwrap();
        assert!(delete(&tree, &identity, &|_, _| Ok(()), &|| false, &mut stats()).is_err());
        let link = fixture_path.join("link");
        symlink(&held, &link).unwrap();
        assert!(delete(&link, &identity, &|_, _| Ok(()), &|| false, &mut stats()).is_err());
        assert!(held.is_dir());
        assert!(tree.is_dir());
    }

    // Preserve per-entry permission and cancellation checks if the traversal
    // is later optimized into a bulk operation.
    #[test]
    fn denied_write_and_cancellation_preserve_the_next_entry() {
        let fixture = tempfile::tempdir().unwrap();
        let fixture_path = fs::canonicalize(fixture.path()).unwrap();
        let tree = fixture_path.join("tree");
        fs::create_dir(&tree).unwrap();
        fs::write(tree.join("file"), b"keep").unwrap();
        let identity = expected(&tree);
        let denied = |_: &Path, mode| {
            if mode == AccessMode::Write {
                Err("denied".into())
            } else {
                Ok(())
            }
        };
        assert!(
            delete(&tree, &identity, &denied, &|| false, &mut stats())
                .unwrap_err()
                .contains("denied")
        );
        let cancelled = Arc::new(AtomicBool::new(false));
        let callback_cancelled = cancelled.clone();
        let auth = move |_: &Path, mode| {
            if mode == AccessMode::Write {
                callback_cancelled.store(true, Ordering::SeqCst);
            }
            Ok(())
        };
        let mut removed = stats();
        assert!(
            delete(
                &tree,
                &identity,
                &auth,
                &|| cancelled.load(Ordering::SeqCst),
                &mut removed
            )
            .unwrap_err()
            .contains("cancelled")
        );
        assert_eq!(fs::read(tree.join("file")).unwrap(), b"keep");
        assert_eq!(
            (removed.files, removed.directories, removed.links),
            (0, 0, 0)
        );
    }

    #[test]
    fn concurrent_addition_reports_partial_failure_without_rescanning() {
        let fixture = tempfile::tempdir().unwrap();
        let fixture_path = fs::canonicalize(fixture.path()).unwrap();
        let tree = fixture_path.join("tree");
        fs::create_dir(&tree).unwrap();
        fs::write(tree.join("file"), b"remove").unwrap();
        let identity = expected(&tree);
        let callback_tree = tree.clone();
        let added = AtomicBool::new(false);
        let auth = move |path: &Path, mode| {
            if path == callback_tree
                && mode == AccessMode::Write
                && !added.swap(true, Ordering::SeqCst)
            {
                fs::write(callback_tree.join("late"), b"keep").unwrap();
            }
            Ok(())
        };
        let mut removed = stats();
        assert!(delete(&tree, &identity, &auth, &|| false, &mut removed).is_err());
        assert!(!tree.join("file").exists());
        assert_eq!(fs::read(tree.join("late")).unwrap(), b"keep");
        assert_eq!((removed.files, removed.directories), (1, 0));
    }

    // A simplification to device-only checks misses same-volume bind mounts.
    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires a controller-owned private-namespace fixture with directory and file bind mounts"]
    fn mounted_descendants_are_preserved() {
        let fixture = PathBuf::from(
            std::env::var_os("AZRAEL_WHOLE_DIRECTORY_MOUNT_FIXTURE")
                .expect("controller-owned mount fixture is required"),
        );
        for name in ["directory-tree", "file-tree"] {
            let tree = fixture.join(name);
            let mounted = tree.join("mounted");
            let marker = if name == "directory-tree" {
                mounted.join("marker")
            } else {
                mounted
            };
            let before = fs::read(&marker).unwrap();
            let failure = delete(
                &tree,
                &expected(&tree),
                &|_, _| Ok(()),
                &|| false,
                &mut stats(),
            )
            .unwrap_err();
            assert!(failure.contains("mount boundary"), "{failure}");
            assert_eq!(fs::read(marker).unwrap(), before);
        }
    }
}

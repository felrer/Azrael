//! Physical Unix deletion. Authorization is complete before entering this module.
//!
//! Keep the inspected objects open, reject namespace/mount changes, and unlink
//! only the exact entries in the approved physical snapshot. No recursive path
//! deletion, permission normalization, or authorization callback belongs here.
use std::collections::BTreeSet;
use std::ffi::OsString;
use std::os::fd::OwnedFd;
use std::os::unix::ffi::OsStrExt;
use std::path::{Component, Path, PathBuf};

use rustix::fs::{AtFlags, Dir, Mode, OFlags, fstat, open, openat, statat, unlinkat};
use serde_json::{Value, json};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Identity {
    device: u64,
    inode: u64,
    kind: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Mount(Vec<u8>);

struct Entry {
    fd: OwnedFd,
    parent: Option<usize>,
    name: OsString,
    path: PathBuf,
    identity: Identity,
    mount: Mount,
    tree: bool,
    removed: bool,
    children: BTreeSet<OsString>,
}

fn error(context: impl std::fmt::Display) -> String {
    format!("Unix physical deletion refused: {context}")
}

fn identity(stat: &rustix::fs::Stat) -> Result<Identity, String> {
    let kind = stat.st_mode as u32 & libc::S_IFMT as u32;
    if kind != libc::S_IFDIR as u32 && kind != libc::S_IFREG as u32 {
        return Err(error("symbolic link or special entry"));
    }
    Ok(Identity {
        device: stat.st_dev as u64,
        inode: stat.st_ino as u64,
        kind,
    })
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
    // SAFETY: fstatfs initializes the complete structure on success; fd stays open.
    if unsafe { libc::fstatfs(fd.as_raw_fd(), stat.as_mut_ptr()) } != 0 {
        return Err(error(std::io::Error::last_os_error()));
    }
    // SAFETY: successful fstatfs initialized stat. Darwin fsid_t consists of
    // two int32_t values, with no padding; its fields are private in libc.
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

fn components(path: &Path) -> Result<Vec<OsString>, String> {
    if path.to_str().is_none() {
        return Err(error(
            "non-UTF-8 paths are unsupported by the maintenance protocol",
        ));
    }
    if !path.is_absolute()
        || path
            .as_os_str()
            .as_bytes()
            .split(|b| *b == b'/')
            .any(|c| c == b"." || c == b"..")
    {
        return Err(error("an absolute normalized path is required"));
    }
    path.components()
        .filter_map(|part| match part {
            Component::RootDir => None,
            Component::Normal(name) => Some(Ok(name.to_os_string())),
            _ => Some(Err(error("invalid path component"))),
        })
        .collect()
}

fn open_child(parent: &OwnedFd, name: &OsString) -> Result<OwnedFd, String> {
    let stat = statat(parent, name, AtFlags::SYMLINK_NOFOLLOW).map_err(error)?;
    let expected = identity(&stat)?;
    let mut flags = OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK;
    if expected.kind == libc::S_IFDIR as u32 {
        flags |= OFlags::RDONLY | OFlags::DIRECTORY;
    } else {
        // O_PATH pins even unreadable regular files without device/FIFO I/O.
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
    }
    let fd = openat(parent, name, flags, Mode::empty()).map_err(error)?;
    if identity(&fstat(&fd).map_err(error)?)? != expected {
        return Err(error("entry changed while opening"));
    }
    Ok(fd)
}

fn names(fd: &OwnedFd) -> Result<BTreeSet<OsString>, String> {
    let mut names = BTreeSet::new();
    for entry in Dir::read_from(fd).map_err(error)? {
        let entry = entry.map_err(error)?;
        let name = entry.file_name().to_bytes();
        if name != b"." && name != b".." {
            if std::str::from_utf8(name).is_err() {
                return Err(error(
                    "non-UTF-8 directory entry is unsupported by the maintenance protocol",
                ));
            }
            names.insert(std::ffi::OsStr::from_bytes(name).to_os_string());
        }
    }
    Ok(names)
}

fn push(
    entries: &mut Vec<Entry>,
    parent: usize,
    name: OsString,
    tree: bool,
    expected_mount: Option<&Mount>,
) -> Result<usize, String> {
    let fd = open_child(&entries[parent].fd, &name)?;
    let identity = identity(&fstat(&fd).map_err(error)?)?;
    let mount = mount(&fd)?;
    if expected_mount.is_some_and(|expected| *expected != mount) {
        return Err(error("mount boundary crossed"));
    }
    let path = entries[parent].path.join(&name);
    let index = entries.len();
    entries[parent].children.insert(name.clone());
    entries.push(Entry {
        fd,
        parent: Some(parent),
        name,
        path,
        identity,
        mount,
        tree,
        removed: false,
        children: BTreeSet::new(),
    });
    Ok(index)
}

fn snapshot(root: &Path, path: &Path, approved: &[PathBuf]) -> Result<(Vec<Entry>, usize), String> {
    let root_parts = components(root)?;
    let path_parts = components(path)?;
    if path_parts.len() <= root_parts.len() || !path_parts.starts_with(&root_parts) {
        return Err(error(
            "target must be strictly below the selected project root",
        ));
    }
    let mut approval = BTreeSet::new();
    for entry in approved {
        components(entry)?;
        if !entry.starts_with(path) || !approval.insert(entry.clone()) {
            return Err(error("invalid or duplicate approved entry"));
        }
    }
    if !approval.contains(path) {
        return Err(error("target is not approved"));
    }
    let fd = open(
        "/",
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(error)?;
    let mut entries = vec![Entry {
        identity: identity(&fstat(&fd).map_err(error)?)?,
        mount: mount(&fd)?,
        fd,
        parent: None,
        name: OsString::new(),
        path: PathBuf::from("/"),
        tree: false,
        removed: false,
        children: BTreeSet::new(),
    }];
    let mut current = 0;
    for name in root_parts {
        current = push(&mut entries, current, name, false, None)?;
    }
    let project_mount = entries[current].mount.clone();
    for name in path_parts.into_iter().skip(components(root)?.len()) {
        current = push(&mut entries, current, name, false, Some(&project_mount))?;
    }
    let target = current;
    entries[target].tree = true;
    let mut cursor = target;
    let mut observed = BTreeSet::new();
    while cursor < entries.len() {
        if !approval.contains(&entries[cursor].path) {
            return Err(error(format!(
                "unapproved entry: {}",
                entries[cursor].path.display()
            )));
        }
        observed.insert(entries[cursor].path.clone());
        if entries[cursor].identity.kind == libc::S_IFDIR as u32 {
            for name in names(&entries[cursor].fd)? {
                push(&mut entries, cursor, name, true, Some(&project_mount))?;
            }
        }
        cursor += 1;
    }
    if approval != observed {
        return Err(error("approved entries are missing from the physical tree"));
    }
    verify(&entries)?;
    Ok((entries, target))
}

fn verify(entries: &[Entry]) -> Result<(), String> {
    for (index, entry) in entries
        .iter()
        .enumerate()
        .filter(|(_, entry)| !entry.removed)
    {
        verify_identity(entries, index)?;
        verify_children(entry)?;
    }
    Ok(())
}

fn verify_identity(entries: &[Entry], index: usize) -> Result<(), String> {
    let entry = &entries[index];
    if identity(&fstat(&entry.fd).map_err(error)?)? != entry.identity
        || mount(&entry.fd)? != entry.mount
    {
        return Err(error("pinned identity changed"));
    }
    if let Some(parent) = entry.parent {
        let fresh = open_child(&entries[parent].fd, &entry.name)?;
        if identity(&fstat(&fresh).map_err(error)?)? != entry.identity
            || mount(&fresh)? != entry.mount
        {
            return Err(error(format!(
                "namespace identity changed: {}",
                entry.path.display()
            )));
        }
    }
    Ok(())
}

fn verify_children(entry: &Entry) -> Result<(), String> {
    if entry.tree
        && entry.identity.kind == libc::S_IFDIR as u32
        && names(&entry.fd)? != entry.children
    {
        return Err(error(format!(
            "directory membership changed: {}",
            entry.path.display()
        )));
    }
    Ok(())
}

fn verify_chain(entries: &[Entry], index: usize) -> Result<(), String> {
    let mut chain = vec![index];
    while let Some(parent) = entries[*chain.last().unwrap()].parent {
        chain.push(parent);
    }
    for ancestor in chain.into_iter().rev() {
        verify_identity(entries, ancestor)?;
    }
    if let Some(parent) = entries[index].parent {
        verify_children(&entries[parent])?;
    }
    verify_children(&entries[index])
}

pub(crate) fn delete(root: &Path, path: &Path, approved: &[PathBuf]) -> Result<Value, String> {
    delete_with_hook(root, path, approved, || {})
}

fn delete_with_hook(
    root: &Path,
    path: &Path,
    approved: &[PathBuf],
    after_snapshot: impl FnOnce(),
) -> Result<Value, String> {
    let (mut entries, target) = snapshot(root, path, approved)?;
    after_snapshot();
    let mut removed = 0;
    for index in (target..entries.len()).rev() {
        // Rewalk the pinned ancestor chain and current parent membership before
        // every unlink. Other subtrees are checked when reached, allowing a
        // truthful partial failure without repeatedly scanning the whole tree.
        verify_chain(&entries, index)?;
        // Keep this current-object check adjacent to unlinkat. Unix provides
        // no unlink-by-handle/identity-conditional unlink primitive: a hostile
        // rename between this check and unlinkat is still an OS-level race.
        verify_identity(&entries, index)?;
        let entry = &entries[index];
        let parent = entry
            .parent
            .ok_or_else(|| error("cannot delete filesystem root"))?;
        let flags = if entry.identity.kind == libc::S_IFDIR as u32 {
            AtFlags::REMOVEDIR
        } else {
            AtFlags::empty()
        };
        unlinkat(&entries[parent].fd, &entry.name, flags).map_err(error)?;
        let name = entries[index].name.clone();
        entries[parent].children.remove(&name);
        entries[index].removed = true;
        removed += 1;
    }
    verify(&entries)?;
    let entry = &entries[target];
    let parent = entry.parent.ok_or_else(|| error("missing target parent"))?;
    match statat(&entries[parent].fd, &entry.name, AtFlags::SYMLINK_NOFOLLOW) {
        Err(rustix::io::Errno::NOENT) => Ok(
            json!({"status":"deleted", "attributes":[], "remaining":false,
                "physical_bytes_reclaimed":null, "removed_entries":removed}),
        ),
        Ok(_) => Err(error("target reappeared after deletion")),
        Err(cause) => Err(error(cause)),
    }
}

#[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::symlink;

    fn fixture() -> (tempfile::TempDir, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let path = fs::canonicalize(temp.path()).unwrap();
        (temp, path)
    }

    // Retained because future simplification to recursive/path-based removal
    // can silently discard exact approval, mount, and namespace checks.
    #[test]
    fn exact_tree_and_single_file() {
        let (_temp, root) = fixture();
        let tree = root.join("tree");
        fs::create_dir(&tree).unwrap();
        let file = tree.join("file");
        fs::write(&file, b"data").unwrap();
        assert_eq!(
            delete(&root, &tree, &[tree.clone(), file]).unwrap()["remaining"],
            false
        );
        assert!(!tree.exists());
        let file = root.join("file");
        fs::write(&file, b"data").unwrap();
        assert!(delete(&root, &file, std::slice::from_ref(&file)).is_ok());
        assert!(!file.exists());
    }

    #[test]
    fn nested_tree_with_many_files() {
        let (_temp, root) = fixture();
        let tree = root.join("tree");
        let nested = tree.join("nested");
        fs::create_dir_all(&nested).unwrap();
        let mut approved = vec![tree.clone(), nested.clone()];
        for index in 0..64 {
            let file = nested.join(index.to_string());
            fs::write(&file, b"data").unwrap();
            approved.push(file);
        }
        let result = delete(&root, &tree, &approved).unwrap();
        assert_eq!(result["removed_entries"], 66);
        assert!(!tree.exists());
    }

    #[test]
    fn rejects_root_special_and_non_utf8_entries() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStringExt;
        let (_temp, root) = fixture();
        assert!(delete(&root, &root, std::slice::from_ref(&root)).is_err());
        let tree = root.join("tree");
        fs::create_dir(&tree).unwrap();
        let fifo = tree.join("fifo");
        let fifo_name = CString::new(fifo.as_os_str().as_bytes()).unwrap();
        // SAFETY: fifo_name is a NUL-terminated pathname, mode is valid.
        assert_eq!(unsafe { libc::mkfifo(fifo_name.as_ptr(), 0o600) }, 0);
        assert!(delete(&root, &tree, &[tree.clone(), fifo.clone()]).is_err());
        fs::remove_file(&fifo).unwrap();
        let invalid = tree.join(OsString::from_vec(vec![0xff]));
        // Protocol rejection is independent of whether this filesystem can
        // represent the invalid byte sequence (APFS rejects its creation).
        assert!(
            delete(&root, &invalid, std::slice::from_ref(&invalid))
                .unwrap_err()
                .contains("non-UTF-8")
        );
        match fs::write(&invalid, b"keep") {
            Ok(()) => {
                assert!(delete(&root, &tree, &[tree.clone(), invalid.clone()]).is_err());
                assert!(delete(&root, &tree, std::slice::from_ref(&tree)).is_err());
                assert_eq!(fs::read(invalid).unwrap(), b"keep");
            }
            Err(cause) => {
                #[cfg(target_os = "macos")]
                {
                    assert_eq!(cause.raw_os_error(), Some(libc::EILSEQ), "{cause}");
                    assert_eq!(fs::read_dir(&tree).unwrap().count(), 0);
                }
                #[cfg(not(target_os = "macos"))]
                panic!("non-UTF-8 fixture could not be created: {cause}");
            }
        }
    }

    #[test]
    fn refuses_added_missing_and_links() {
        let (_temp, root) = fixture();
        let tree = root.join("tree");
        fs::create_dir(&tree).unwrap();
        let file = tree.join("file");
        fs::write(&file, b"keep").unwrap();
        assert!(delete(&root, &tree, std::slice::from_ref(&tree)).is_err());
        assert!(
            delete(
                &root,
                &tree,
                &[tree.clone(), file.clone(), tree.join("missing")]
            )
            .is_err()
        );
        let link = tree.join("link");
        symlink(&file, &link).unwrap();
        assert!(delete(&root, &tree, &[tree.clone(), file.clone(), link]).is_err());
        assert_eq!(fs::read(file).unwrap(), b"keep");
    }

    #[test]
    fn refuses_post_snapshot_changes() {
        for change in ["replace", "add", "missing", "ancestor"] {
            let (_temp, root) = fixture();
            let tree = root.join("tree");
            fs::create_dir(&tree).unwrap();
            let file = tree.join("file");
            fs::write(&file, b"approved").unwrap();
            let result =
                delete_with_hook(
                    &root,
                    &tree,
                    &[tree.clone(), file.clone()],
                    || match change {
                        "replace" => {
                            fs::rename(&file, root.join("old")).unwrap();
                            fs::write(&file, b"new").unwrap();
                        }
                        "add" => fs::write(tree.join("added"), b"new").unwrap(),
                        "missing" => fs::rename(&file, root.join("old")).unwrap(),
                        _ => {
                            fs::rename(&tree, root.join("old")).unwrap();
                            fs::create_dir(&tree).unwrap();
                        }
                    },
                );
            assert!(result.is_err(), "{change}");
            assert!(tree.is_dir());
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires a controller-owned fixture with directory and file bind mounts in a private namespace"]
    fn mounted_descendant_is_not_deleted() {
        use std::os::unix::fs::MetadataExt;

        let root = PathBuf::from(
            std::env::var_os("AZRAEL_UNIX_MOUNT_FIXTURE")
                .expect("AZRAEL_UNIX_MOUNT_FIXTURE must name the controller-owned mount fixture"),
        );
        assert_eq!(fs::canonicalize(&root).unwrap(), root);
        let tree = root.join("tree");
        let mounted = tree.join("mounted");
        let marker = mounted.join("marker");
        let file_tree = root.join("file-tree");
        let mounted_file = file_tree.join("mountedfile");

        assert_eq!(fs::read(root.join("source/marker")).unwrap(), b"keep");
        assert_eq!(fs::read(root.join("sourcefile")).unwrap(), b"keep");
        assert_eq!(fs::read(&marker).unwrap(), b"keep");
        assert_eq!(fs::read(&mounted_file).unwrap(), b"keep");
        let root_fd = open(
            &root,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .unwrap();
        let tree_fd = open_child(&root_fd, &OsString::from("tree")).unwrap();
        let mounted_fd = open_child(&tree_fd, &OsString::from("mounted")).unwrap();
        let file_tree_fd = open_child(&root_fd, &OsString::from("file-tree")).unwrap();
        let mounted_file_fd = open_child(&file_tree_fd, &OsString::from("mountedfile")).unwrap();
        assert_eq!(
            fs::metadata(&root).unwrap().dev(),
            fs::metadata(&mounted).unwrap().dev()
        );
        assert_eq!(
            fs::metadata(&root).unwrap().dev(),
            fs::metadata(&mounted_file).unwrap().dev()
        );
        assert_ne!(mount(&root_fd).unwrap(), mount(&mounted_fd).unwrap());
        assert_ne!(mount(&root_fd).unwrap(), mount(&mounted_file_fd).unwrap());

        let failure = delete(
            &root,
            &tree,
            &[tree.clone(), mounted.clone(), marker.clone()],
        )
        .unwrap_err();
        assert!(failure.contains("mount boundary"), "{failure}");
        let failure = delete(&root, &mounted, &[mounted.clone(), marker.clone()]).unwrap_err();
        assert!(failure.contains("mount boundary"), "{failure}");
        let failure = delete(
            &root,
            &file_tree,
            &[file_tree.clone(), mounted_file.clone()],
        )
        .unwrap_err();
        assert!(failure.contains("mount boundary"), "{failure}");
        assert_eq!(fs::read(&marker).unwrap(), b"keep");
        assert_eq!(fs::read(&mounted_file).unwrap(), b"keep");
        assert_eq!(fs::read(root.join("source/marker")).unwrap(), b"keep");
        assert_eq!(fs::read(root.join("sourcefile")).unwrap(), b"keep");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn mount_identity_distinguishes_proc_mount() {
        let root = open("/", OFlags::RDONLY | OFlags::DIRECTORY, Mode::empty()).unwrap();
        let proc = open("/proc", OFlags::RDONLY | OFlags::DIRECTORY, Mode::empty()).unwrap();
        assert_ne!(mount(&root).unwrap(), mount(&proc).unwrap());
        assert!(
            snapshot(
                Path::new("/"),
                Path::new("/proc"),
                &[PathBuf::from("/proc")]
            )
            .is_err()
        );
    }
}

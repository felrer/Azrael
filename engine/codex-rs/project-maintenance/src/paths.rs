use crate::{AccessMode, Auth, hash};
use serde_json::{Value, json};
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Default)]
pub(crate) struct ContentCache {
    files: std::collections::BTreeMap<PathBuf, (FileVersion, String)>,
    #[cfg(test)]
    hashes: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct FileVersion {
    identity: [u64; 3],
    #[cfg(windows)]
    usn: i64,
    changed: (i64, i64),
    modified: (i64, i64),
    length: u64,
    attributes: u32,
}

#[cfg(unix)]
fn file_version(file: &fs::File) -> Option<FileVersion> {
    use std::os::unix::fs::MetadataExt;
    let m = file.metadata().ok()?;
    if !m.is_file() || m.ino() == 0 || m.ctime() == 0 {
        return None;
    }
    Some(FileVersion {
        identity: [m.dev(), m.ino(), 0],
        changed: (m.ctime(), m.ctime_nsec()),
        modified: (m.mtime(), m.mtime_nsec()),
        length: m.len(),
        attributes: m.mode(),
    })
}

#[cfg(windows)]
fn file_version(file: &fs::File) -> Option<FileVersion> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_BASIC_INFO, FILE_ID_INFO, FILE_STANDARD_INFO, FileBasicInfo, FileIdInfo,
        FileStandardInfo, GetFileInformationByHandleEx,
    };
    use windows_sys::Win32::System::IO::DeviceIoControl;
    use windows_sys::Win32::System::Ioctl::FSCTL_READ_FILE_USN_DATA;
    // NTFS timestamps can collide even after a closed writer restores mtime.
    // Bind the last journaled change as well; unsupported/unavailable journals
    // select full hashing rather than timestamp-only cache reuse.
    let mut journal = [0u8; 4096];
    let mut returned = 0u32;
    if unsafe {
        DeviceIoControl(
            file.as_raw_handle(),
            FSCTL_READ_FILE_USN_DATA,
            std::ptr::null(),
            0,
            journal.as_mut_ptr().cast(),
            journal.len() as u32,
            &mut returned,
            std::ptr::null_mut(),
        )
    } == 0
    {
        return None;
    }
    let returned = usize::try_from(returned).ok()?;
    let record_length = u32::from_le_bytes(journal[..4].try_into().ok()?) as usize;
    let major = u16::from_le_bytes(journal[4..6].try_into().ok()?);
    let offset = match major {
        2 => 24,
        3 => 40,
        _ => return None,
    };
    if returned > journal.len() || record_length > returned || record_length < offset + 8 {
        return None;
    }
    let usn = i64::from_le_bytes(journal[offset..offset + 8].try_into().ok()?);
    if usn <= 0 {
        return None;
    }
    let mut basic = FILE_BASIC_INFO::default();
    let mut id = FILE_ID_INFO::default();
    let mut standard = FILE_STANDARD_INFO::default();
    // Each destination has exactly the layout and size required by its class;
    // the borrowed file owns the handle throughout all three synchronous calls.
    unsafe {
        let handle = file.as_raw_handle();
        if GetFileInformationByHandleEx(
            handle,
            FileBasicInfo,
            (&mut basic as *mut FILE_BASIC_INFO).cast(),
            std::mem::size_of_val(&basic) as u32,
        ) == 0
            || GetFileInformationByHandleEx(
                handle,
                FileIdInfo,
                (&mut id as *mut FILE_ID_INFO).cast(),
                std::mem::size_of_val(&id) as u32,
            ) == 0
            || GetFileInformationByHandleEx(
                handle,
                FileStandardInfo,
                (&mut standard as *mut FILE_STANDARD_INFO).cast(),
                std::mem::size_of_val(&standard) as u32,
            ) == 0
        {
            return None;
        }
    }
    if basic.ChangeTime == 0
        || id.VolumeSerialNumber == 0
        || id.FileId.Identifier == [0; 16]
        || standard.EndOfFile < 0
        || standard.Directory
        || standard.DeletePending
        || basic.FileAttributes & 0x400 != 0
    {
        return None;
    }
    Some(FileVersion {
        identity: [
            id.VolumeSerialNumber,
            u64::from_le_bytes(id.FileId.Identifier[..8].try_into().ok()?),
            u64::from_le_bytes(id.FileId.Identifier[8..].try_into().ok()?),
        ],
        usn,
        changed: (basic.ChangeTime, 0),
        modified: (basic.LastWriteTime, 0),
        length: standard.EndOfFile as u64,
        attributes: basic.FileAttributes,
    })
}

#[cfg(not(any(windows, unix)))]
fn file_version(_: &fs::File) -> Option<FileVersion> {
    None
}

const CONTENT_CACHE_MIN_BYTES: u64 = 65536;

struct CacheGuard {}

#[cfg(windows)]
fn cache_guard(_: &Path, _: &FileVersion) -> Option<CacheGuard> {
    // NTFS coalesces repeated reasons until the final close, so a stable USN
    // does not prove unchanged bytes while another reader keeps the file open.
    // Denying write sharing excludes only current writers; even share_mode(0)
    // permits attribute-only handles and cannot prove a final-close boundary.
    // Keep version observations for change detection, but rehash Windows hits.
    None
}

#[cfg(not(windows))]
fn cache_guard(_: &Path, _: &FileVersion) -> Option<CacheGuard> {
    Some(CacheGuard {})
}

fn content_digest(
    path: &Path,
    expected_length: u64,
    auth: Auth<'_>,
) -> Result<(String, u64), String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    // Small files cost less to hash than to establish a strong cache version.
    // Keep their original read path with no extra metadata or pathname opens.
    if expected_length < CONTENT_CACHE_MIN_BYTES {
        return hash_content(path, &mut file, auth);
    }
    let before = file_version(&file);
    let cached = before.as_ref().and_then(|version| {
        auth.content
            .borrow()
            .files
            .get(path)
            .filter(|(cached, _)| cached == version)
            .map(|(_, digest)| digest.clone())
    });
    let cached = if cached.is_some() {
        // Preserve the ordinary per-buffer and final EOF authorization cadence
        // even when no bytes need rereading. Callbacks can change namespace or
        // sibling state, so their effects must precede version validation.
        let length = before.as_ref().ok_or("missing file version")?.length;
        for _ in 0..=length.div_ceil(65536) {
            auth(path, AccessMode::Read)?;
        }
        cached.and_then(|digest| Some((digest, cache_guard(path, before.as_ref()?)?)))
    } else {
        None
    };
    let (digest, length, guard) = if let Some((digest, guard)) = cached {
        (
            digest,
            before.as_ref().ok_or("missing file version")?.length,
            Some(guard),
        )
    } else {
        let (digest, length) = hash_content(path, &mut file, auth)?;
        (digest, length, None)
    };
    let after = file_version(&file);
    // A reopened path detects replacement while the original handle was open.
    // No handles are retained in the operation cache.
    let current = fs::File::open(path).map_err(|e| e.to_string())?;
    if before != after || after != file_version(&current) {
        return Err("input changed while measuring".into());
    }
    if let Some(version) = after {
        if version.length != length {
            return Err("input changed while measuring".into());
        }
        auth.content
            .borrow_mut()
            .files
            .insert(path.to_owned(), (version, digest.clone()));
    }
    drop(guard);
    Ok((digest, length))
}

fn hash_content(path: &Path, file: &mut fs::File, auth: Auth<'_>) -> Result<(String, u64), String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    #[cfg(test)]
    {
        auth.content.borrow_mut().hashes += 1;
    }
    let mut digest = Sha256::new();
    let mut length = 0u64;
    let mut buffer = [0u8; 65536];
    loop {
        auth(path, AccessMode::Read)?;
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        length = length.checked_add(count as u64).ok_or("size overflow")?;
        digest.update(&buffer[..count]);
    }
    Ok((format!("{:x}", digest.finalize()), length))
}

// macOS may use a case-insensitive volume. Folding conservatively protects
// aliases there; case-sensitive macOS volumes can overprotect distinct paths.
pub(crate) fn within(path: &Path, base: &Path) -> bool {
    #[cfg(any(windows, target_os = "macos"))]
    {
        Path::new(&path.to_string_lossy().to_lowercase())
            .starts_with(Path::new(&base.to_string_lossy().to_lowercase()))
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        path.starts_with(base)
    }
}

#[cfg(all(test, target_os = "macos"))]
#[test]
fn macos_protection_containment_folds_case_conservatively() {
    assert!(within(
        Path::new("/Project/Protected/item"),
        Path::new("/project/protected")
    ));
    assert!(!within(
        Path::new("/Project/Protected-other/item"),
        Path::new("/project/protected")
    ));
}

pub(crate) fn relative(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
    {
        return Err("path must be a contained relative path".into());
    }
    // Also reject foreign-platform drive, UNC, traversal and stream syntax.
    let text = path.to_str().ok_or("non Unicode path")?;
    if text.contains(':')
        || (!cfg!(windows) && text.contains('\\'))
        || text.replace('\\', "/").split('/').any(|c| c == "..")
    {
        return Err("ambiguous or foreign-platform path".into());
    }
    Ok(())
}
pub(crate) fn resolve(root: &Path, path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() {
        if !within(path, root) {
            return Err("path escapes project".into());
        }
        let tail = path.strip_prefix(root).map_err(|e| e.to_string())?;
        relative(tail)?;
        Ok(path.to_owned())
    } else {
        relative(path)?;
        Ok(root.join(
            path.components()
                .filter(|c| !matches!(c, Component::CurDir))
                .collect::<PathBuf>(),
        ))
    }
}
pub(crate) fn check(root: &Path, path: &Path, auth: Auth<'_>) -> Result<(), String> {
    checked_metadata(root, path, auth).map(|_| ())
}

/// Exact nested fixture junctions are explicit item metadata. The registration
/// boundary captures identity; later operations only load and verify that pin.
pub(crate) fn configure_junctions(
    root: &Path,
    item: &Value,
    capture: bool,
    auth: Auth<'_>,
) -> Result<Value, String> {
    let Some(specs) = item.get("verified_junctions") else {
        return Ok(json!([]));
    };
    let specs = specs
        .as_array()
        .ok_or("verified_junctions must be an array")?;
    if specs.len() > 1024 || item["generated"] != true || item["protection_known"] != true {
        return Err(
            "verified junctions require confirmed generated ownership and protection".into(),
        );
    }
    crate::string(item, "owner")?;
    let base = resolve(root, Path::new(crate::string(item, "path")?))?;
    let mut configured = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for spec in specs {
        let relative_path = Path::new(crate::string(spec, "path")?);
        relative(relative_path)?;
        let path = resolve(&base, relative_path)?;
        if path == base || spec["kind"] != "junction" || !seen.insert(path.clone()) {
            return Err("junction approval requires a unique nested junction entry".into());
        }
        let target = Path::new(crate::string(spec, "target")?);
        if !target.is_absolute() || reserved(root, &path) {
            return Err(
                "junction approval requires an absolute physical target and unprotected entry"
                    .into(),
            );
        }
        let mut pinned = spec.clone();
        if capture {
            // Do not authorize the link while checking its parent: an approved
            // junction can never become an ancestor traversal exception.
            plain_junction_parent(root, &path, auth)?;
            let identity = junction_identity(&path, target, auth)?;
            if spec
                .get("identity")
                .is_some_and(|expected| expected != &identity)
            {
                return Err("junction registration identity changed".into());
            }
            pinned["identity"] = identity;
        } else if !pinned["identity"].is_object() {
            return Err("registered junction identity missing".into());
        }
        if let Some(old) = auth.junctions.borrow().get(&path) {
            if !capture && old != &pinned {
                return Err("conflicting junction approval".into());
            }
        }
        auth.junctions.borrow_mut().insert(path, pinned.clone());
        configured.push(pinned);
    }
    Ok(json!(configured))
}

#[cfg(test)]
#[test]
fn registered_junction_metadata_accepts_1024_entries_and_rejects_excess() {
    let root = tempfile::tempdir().unwrap();
    let allow = |_: &Path, _: AccessMode| Ok(());
    let context = crate::Context::new(&allow);
    // Loading registered pins is metadata-only. Filesystem verification remains
    // mandatory when registration captures pins or a later operation uses them.
    let specs = (0..1024).map(|index| json!({
        "path":format!("link-{index}"),"kind":"junction","target":root.path().join("target"),
        "identity":{"pin":"registered-fixture","created":0}
    })).collect::<Vec<_>>();
    let mut item = json!({"path":"generated/owned","owner":"test","generated":true,"protection_known":true,"verified_junctions":specs});
    assert_eq!(
        configure_junctions(root.path(), &item, false, &context)
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1024
    );
    item["verified_junctions"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "path":"excess","kind":"junction","target":root.path().join("target"),
            "identity":{"pin":"registered-fixture","created":0}
        }));
    assert!(configure_junctions(root.path(), &item, false, &context).is_err());
    assert_eq!(context.junctions.borrow().len(), 1024);
}

#[cfg(not(windows))]
fn junction_identity(_: &Path, _: &Path, _: Auth<'_>) -> Result<Value, String> {
    Err("verified directory junctions are Windows-only".into())
}

#[cfg(windows)]
fn junction_identity(path: &Path, target: &Path, auth: Auth<'_>) -> Result<Value, String> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_ID_INFO,
        FILE_READ_ATTRIBUTES, FileIdInfo, GetFileInformationByHandleEx,
    };
    use windows_sys::Win32::System::IO::DeviceIoControl;
    use windows_sys::Win32::System::Ioctl::FSCTL_GET_REPARSE_POINT;
    // The target is inspected for authorization and plain-directory ancestry,
    // never enumerated or opened through the junction.
    let plain_target = fs::symlink_metadata(target).map_err(|e| e.to_string())?;
    if plain_target.file_type().is_symlink() || reparse(&plain_target) {
        return Err("junction target must not be another link".into());
    }
    let target_metadata =
        checked_metadata(target, target, auth)?.ok_or("junction target missing")?;
    if !target_metadata.is_dir() {
        return Err("junction target must be a physical directory".into());
    }
    auth(path, AccessMode::Read)?;
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if metadata.file_attributes() & 0x10 == 0
        || metadata.file_attributes() & 0x400 == 0
        || metadata.file_attributes() & 4 != 0
    {
        return Err("approved entry is not a non-System directory junction".into());
    }
    let file = fs::OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|e| e.to_string())?;
    let mut id = FILE_ID_INFO::default();
    let mut raw = [0u8; 16384];
    let mut returned = 0u32;
    unsafe {
        if GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileIdInfo,
            (&mut id as *mut FILE_ID_INFO).cast(),
            std::mem::size_of_val(&id) as u32,
        ) == 0
            || DeviceIoControl(
                file.as_raw_handle(),
                FSCTL_GET_REPARSE_POINT,
                std::ptr::null(),
                0,
                raw.as_mut_ptr().cast(),
                raw.len() as u32,
                &mut returned,
                std::ptr::null_mut(),
            ) == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    let length = returned as usize;
    if length < 16
        || length > raw.len()
        || u32::from_le_bytes(raw[..4].try_into().map_err(|_| "invalid junction tag")?)
            != 0xa0000003
        || id.VolumeSerialNumber == 0
        || id.FileId.Identifier == [0; 16]
    {
        return Err("approved entry is not a verified mount-point junction".into());
    }
    let offset = u16::from_le_bytes([raw[8], raw[9]]) as usize;
    let name_length = u16::from_le_bytes([raw[10], raw[11]]) as usize;
    let end = 16usize
        .checked_add(offset)
        .and_then(|v| v.checked_add(name_length))
        .ok_or("invalid junction target length")?;
    if name_length % 2 != 0 || end > length {
        return Err("invalid junction target buffer".into());
    }
    let words = raw[16 + offset..end]
        .chunks_exact(2)
        .map(|v| u16::from_le_bytes([v[0], v[1]]))
        .collect::<Vec<_>>();
    let actual = String::from_utf16(&words).map_err(|e| e.to_string())?;
    let actual = actual
        .strip_prefix(r"\??\UNC\")
        .map(|tail| format!(r"\\{tail}"))
        .or_else(|| actual.strip_prefix(r"\??\").map(str::to_owned))
        .ok_or("junction target is not an absolute DOS path")?;
    let actual = Path::new(&actual);
    if !within(actual, target) || !within(target, actual) {
        return Err("junction target changed".into());
    }
    // Include entry identity and exact tag/payload, independently of target data.
    use sha2::Digest;
    let digest = format!("{:x}", sha2::Sha256::digest(&raw[..length]));
    let pin = format!(
        "{}:{}:{}",
        id.VolumeSerialNumber,
        id.FileId
            .Identifier
            .iter()
            .map(u8::to_string)
            .collect::<Vec<_>>()
            .join(","),
        digest
    );
    Ok(json!({"pin":pin,"created":metadata.creation_time()}))
}

fn validate_junction(root: &Path, path: &Path, auth: Auth<'_>) -> Result<(), String> {
    let spec = auth
        .junctions
        .borrow()
        .get(path)
        .cloned()
        .ok_or("unapproved junction")?;
    plain_junction_parent(root, path, auth)?;
    if junction_identity(path, Path::new(crate::string(&spec, "target")?), auth)?
        != spec["identity"]
    {
        return Err("approved junction identity changed".into());
    }
    Ok(())
}

fn plain_junction_parent(root: &Path, path: &Path, auth: Auth<'_>) -> Result<(), String> {
    let parent = path.parent().ok_or("junction parent missing")?;
    let metadata = checked_metadata(root, parent, auth)?.ok_or("junction parent missing")?;
    if metadata.file_type().is_symlink() || reparse(&metadata) || !metadata.is_dir() {
        return Err("junction ancestor traversal rejected".into());
    }
    Ok(())
}

fn validate_nested_junctions(root: &Path, path: &Path, auth: Auth<'_>) -> Result<(), String> {
    let approved = auth
        .junctions
        .borrow()
        .keys()
        .filter(|entry| within(entry, path))
        .cloned()
        .collect::<Vec<_>>();
    for entry in approved {
        validate_junction(root, &entry, auth)?;
    }
    Ok(())
}

pub(crate) fn checked_metadata(
    root: &Path,
    path: &Path,
    auth: Auth<'_>,
) -> Result<Option<fs::Metadata>, String> {
    if !within(path, root) {
        return Err("path escapes root".into());
    }
    // Inspect every ancestor, including ancestors outside the selected root.
    let mut ancestors = path.ancestors().collect::<Vec<_>>();
    ancestors.reverse();
    let mut leaf = None;
    for p in ancestors {
        auth(p, AccessMode::Read)?;
        match fs::symlink_metadata(p) {
            Ok(m) => {
                if m.file_type().is_symlink() || reparse(&m) {
                    if p != path || !auth.junctions.borrow().contains_key(p) {
                        return Err(format!("link/reparse path rejected: {}", p.display()));
                    }
                    validate_junction(root, p, auth)?;
                }
                if p == path {
                    leaf = Some(m);
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(leaf)
}

/// Observe only the registered object, without enumerating or reading its payload.
pub(crate) fn registered_observation(
    root: &Path,
    path: &Path,
    auth: Auth<'_>,
) -> Result<Value, String> {
    let Some(metadata) = checked_metadata(root, path, auth)? else {
        return Ok(json!({"presence":"absent"}));
    };
    if reparse(&metadata) || metadata.file_type().is_symlink() {
        return Err("junction member root rejected".into());
    }
    validate_nested_junctions(root, path, auth)?;
    let kind = if metadata.is_dir() {
        "directory"
    } else if metadata.is_file() {
        "file"
    } else {
        return Err("special file rejected".into());
    };
    let identity = registered_identity(path, &metadata)?;
    Ok(json!({"presence":"present","kind":kind,"identity":identity}))
}

#[cfg(unix)]
fn registered_identity(_: &Path, metadata: &fs::Metadata) -> Result<Value, String> {
    use std::os::unix::fs::MetadataExt;
    if metadata.ino() == 0 {
        return Err("registered object identity unavailable".into());
    }
    Ok(json!({"device":metadata.dev(),"inode":metadata.ino()}))
}

#[cfg(windows)]
fn registered_identity(path: &Path, metadata: &fs::Metadata) -> Result<Value, String> {
    let (_, id, standard) = registered_handle_information(path)?;
    if standard.Directory != metadata.is_dir() {
        return Err("registered object kind changed while observing".into());
    }
    // Attributes and timestamps deliberately do not identify this object.
    Ok(json!({"volume":id.VolumeSerialNumber,"file_id":id.FileId.Identifier}))
}

#[cfg(windows)]
fn registered_handle_information(
    path: &Path,
) -> Result<
    (
        windows_sys::Win32::Storage::FileSystem::FILE_BASIC_INFO,
        windows_sys::Win32::Storage::FileSystem::FILE_ID_INFO,
        windows_sys::Win32::Storage::FileSystem::FILE_STANDARD_INFO,
    ),
    String,
> {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_REPARSE_POINT, FILE_BASIC_INFO, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_ID_INFO, FILE_READ_ATTRIBUTES, FILE_STANDARD_INFO,
        FileBasicInfo, FileIdInfo, FileStandardInfo, GetFileInformationByHandleEx,
    };
    // Metadata-only access works for directories and does not follow the leaf.
    let file = fs::OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|e| e.to_string())?;
    let mut basic = FILE_BASIC_INFO::default();
    let mut id = FILE_ID_INFO::default();
    let mut standard = FILE_STANDARD_INFO::default();
    // The borrowed handle and correctly sized destinations live through each call.
    unsafe {
        let handle = file.as_raw_handle();
        if GetFileInformationByHandleEx(
            handle,
            FileBasicInfo,
            (&mut basic as *mut FILE_BASIC_INFO).cast(),
            std::mem::size_of_val(&basic) as u32,
        ) == 0
            || GetFileInformationByHandleEx(
                handle,
                FileIdInfo,
                (&mut id as *mut FILE_ID_INFO).cast(),
                std::mem::size_of_val(&id) as u32,
            ) == 0
            || GetFileInformationByHandleEx(
                handle,
                FileStandardInfo,
                (&mut standard as *mut FILE_STANDARD_INFO).cast(),
                std::mem::size_of_val(&standard) as u32,
            ) == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    if basic.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || standard.DeletePending
        || id.VolumeSerialNumber == 0
        || id.FileId.Identifier == [0; 16]
    {
        return Err("registered object identity unavailable or reparse path rejected".into());
    }
    Ok((basic, id, standard))
}

#[cfg(not(any(windows, unix)))]
fn registered_identity(_: &Path, _: &fs::Metadata) -> Result<Value, String> {
    Err("registered object identity unsupported on this platform".into())
}

#[cfg(all(test, any(windows, unix)))]
mod registered_observation_tests {
    use super::*;
    use crate::Context;

    fn allow(_: &Path, _: AccessMode) -> Result<(), String> {
        Ok(())
    }

    #[test]
    fn observes_only_root_and_stays_stable_after_content_edits() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("registered");
        fs::create_dir(&target).unwrap();
        let file = target.join("payload");
        fs::write(&file, "before").unwrap();
        let root_only = |path: &Path, _: AccessMode| {
            if path != target && path.starts_with(&target) {
                Err("descendant observation prohibited".into())
            } else {
                Ok(())
            }
        };
        let context = Context::new(&root_only);
        let before = registered_observation(root.path(), &target, &context).unwrap();
        assert_eq!(before["presence"], "present");
        assert_eq!(before["kind"], "directory");
        fs::write(&file, "changed payload length").unwrap();
        fs::write(target.join("new descendant"), "new").unwrap();
        assert_eq!(
            registered_observation(root.path(), &target, &context).unwrap(),
            before
        );
        let context = Context::new(&allow);
        let file_before = registered_observation(root.path(), &file, &context).unwrap();
        assert_eq!(file_before["kind"], "file");
        fs::write(&file, "another edit").unwrap();
        assert_eq!(
            registered_observation(root.path(), &file, &context).unwrap(),
            file_before
        );
        assert_eq!(context.content.borrow().hashes, 0);
    }

    #[test]
    fn detects_registered_root_replacement() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("registered");
        fs::create_dir(&target).unwrap();
        let context = Context::new(&allow);
        let before = registered_observation(root.path(), &target, &context).unwrap();
        // Retain the old object so the filesystem cannot reuse its identity.
        fs::rename(&target, root.path().join("original")).unwrap();
        fs::create_dir(&target).unwrap();
        assert_ne!(
            registered_observation(root.path(), &target, &context).unwrap(),
            before
        );
    }

    #[test]
    fn absent_paths_still_require_ancestor_authorization() {
        let root = tempfile::tempdir().unwrap();
        let absent = root.path().join("missing").join("leaf");
        let context = Context::new(&allow);
        assert_eq!(
            registered_observation(root.path(), &absent, &context).unwrap(),
            json!({"presence":"absent"})
        );
        let deny_root = |path: &Path, _: AccessMode| {
            if path == root.path() {
                Err("ancestor denied".into())
            } else {
                Ok(())
            }
        };
        let context = Context::new(&deny_root);
        assert_eq!(
            registered_observation(root.path(), &absent, &context).unwrap_err(),
            "ancestor denied"
        );
        assert!(registered_observation(&absent, root.path(), &context).is_err());
    }

    #[test]
    fn rejects_leaf_links_and_link_ancestors() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("target");
        let link = root.path().join("link");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("file"), "payload").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, &link).unwrap();
        #[cfg(windows)]
        {
            // Directory junction creation does not require symlink privileges.
            let output = std::process::Command::new("cmd.exe")
                .args(["/D", "/C", "mklink", "/J"])
                .arg(&link)
                .arg(&target)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "junction fixture failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        let context = Context::new(&allow);
        for path in [&link, &link.join("file")] {
            assert!(
                registered_observation(root.path(), path, &context)
                    .unwrap_err()
                    .contains("link/reparse")
            );
        }
    }
}
#[cfg(windows)]
fn reparse(m: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    m.file_attributes() & 0x400 != 0
}
#[cfg(not(windows))]
fn reparse(_: &fs::Metadata) -> bool {
    false
}
pub(crate) fn entries(root: &Path, path: &Path, auth: Auth<'_>) -> Result<Vec<PathBuf>, String> {
    if checked_metadata(root, path, auth)?
        .is_some_and(|metadata| reparse(&metadata) || metadata.file_type().is_symlink())
    {
        return Err("junction measurement root rejected".into());
    }
    validate_nested_junctions(root, path, auth)?;
    let mut out = Vec::new();
    let mut pending = vec![path.to_owned()];
    while let Some(current) = pending.pop() {
        // No callback or filesystem operation intervenes between the checked
        // leaf observation and its use here.
        let metadata = checked_metadata(root, &current, auth)?.ok_or("tree entry disappeared")?;
        if !metadata.is_file() && !metadata.is_dir() && !reparse(&metadata) {
            return Err("special file rejected".into());
        }
        if metadata.is_dir() && !reparse(&metadata) {
            auth(&current, AccessMode::Read)?;
            let mut children = fs::read_dir(&current)
                .map_err(|e| e.to_string())?
                .map(|e| e.map(|v| v.path()).map_err(|e| e.to_string()))
                .collect::<Result<Vec<_>, _>>()?;
            children.sort();
            children.reverse();
            pending.extend(children);
        }
        out.push(current);
    }
    Ok(out)
}
pub(crate) fn measure(root: &Path, path: &Path, auth: Auth<'_>) -> Result<Value, String> {
    let mut records = Vec::new();
    let mut bytes = 0u64;
    for p in entries(root, path, auth)? {
        auth(&p, AccessMode::Read)?;
        let before = fs::symlink_metadata(&p).map_err(|e| e.to_string())?;
        let content = if reparse(&before) {
            validate_junction(root, &p, auth)?;
            hash(&auth.junctions.borrow()[&p])?
        } else if before.is_file() {
            let (digest, length) = content_digest(&p, before.len(), auth)?;
            bytes = bytes.checked_add(length).ok_or("size overflow")?;
            digest
        } else {
            String::new()
        };
        let after = fs::symlink_metadata(&p).map_err(|e| e.to_string())?;
        if before.len() != after.len()
            || before.modified().ok() != after.modified().ok()
            || platform_identity(&before) != platform_identity(&after)
        {
            return Err("input changed while measuring".into());
        }
        records.push(json!({"path":p.strip_prefix(path).map_err(|e|e.to_string())?,"bytes":before.len(),"modified":before.modified().ok().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_nanos().to_string()),"directory":before.is_dir(),"readonly":before.permissions().readonly(),"platform":platform_identity(&before),"content":content}));
    }
    Ok(json!({"identity":hash(&records)?,"logical_bytes":bytes,"entries":records.len()}))
}
#[cfg(windows)]
pub(crate) fn platform_identity(m: &fs::Metadata) -> Value {
    use std::os::windows::fs::MetadataExt;
    json!({"attributes":m.file_attributes(),"created":m.creation_time(),"written":m.last_write_time()})
}
#[cfg(unix)]
pub(crate) fn platform_identity(m: &fs::Metadata) -> Value {
    use std::os::unix::fs::MetadataExt;
    json!({"device":m.dev(),"inode":m.ino(),"mode":m.mode(),"ctime":m.ctime(),"ctime_nsec":m.ctime_nsec()})
}
#[cfg(not(any(windows, unix)))]
pub(crate) fn platform_identity(_: &fs::Metadata) -> Value {
    Value::Null
}

#[cfg(test)]
mod content_cache_tests {
    use super::*;
    use crate::Context;
    use std::cell::Cell;

    fn allow(_: &Path, _: AccessMode) -> Result<(), String> {
        Ok(())
    }

    #[test]
    fn small_files_hash_each_time_without_populating_cache() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("small");
        fs::write(&path, "small").unwrap();
        let context = Context::new(&allow);
        let first = measure(root.path(), &path, &context).unwrap();
        assert_eq!(measure(root.path(), &path, &context).unwrap(), first);
        assert_eq!(context.content.borrow().hashes, 2);
        assert!(context.content.borrow().files.is_empty());
    }

    #[test]
    fn unchanged_content_reuses_only_supported_proofs_and_new_operation_hashes_again() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("file");
        fs::write(&path, vec![b'a'; CONTENT_CACHE_MIN_BYTES as usize]).unwrap();
        let context = Context::new(&allow);
        let first = measure(root.path(), &path, &context).unwrap();
        assert_eq!(measure(root.path(), &path, &context).unwrap(), first);
        assert_eq!(
            context.content.borrow().hashes,
            if cfg!(unix) { 1 } else { 2 }
        );
        let next = Context::new(&allow);
        assert_eq!(measure(root.path(), &path, &next).unwrap(), first);
        assert_eq!(next.content.borrow().hashes, 1);
    }

    #[test]
    fn same_size_restored_mtime_and_replacement_invalidate_content() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("file");
        fs::write(&path, vec![b'a'; CONTENT_CACHE_MIN_BYTES as usize]).unwrap();
        let context = Context::new(&allow);
        let initial = super::content_digest(&path, CONTENT_CACHE_MIN_BYTES, &context).unwrap();
        let modified = fs::metadata(&path).unwrap().modified().unwrap();
        fs::write(&path, vec![b'b'; CONTENT_CACHE_MIN_BYTES as usize]).unwrap();
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(modified))
            .unwrap();
        let rewritten = super::content_digest(&path, CONTENT_CACHE_MIN_BYTES, &context).unwrap();
        assert_ne!(initial.0, rewritten.0);
        assert_eq!(context.content.borrow().hashes, 2);
        fs::rename(&path, root.path().join("old")).unwrap();
        fs::write(&path, vec![b'c'; CONTENT_CACHE_MIN_BYTES as usize]).unwrap();
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(modified))
            .unwrap();
        assert_ne!(
            super::content_digest(&path, CONTENT_CACHE_MIN_BYTES, &context)
                .unwrap()
                .0,
            rewritten.0
        );
        assert_eq!(context.content.borrow().hashes, 3);
    }

    #[test]
    fn cache_hit_still_authorizes_and_detects_callback_rewrite() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("file");
        fs::write(&path, vec![b'a'; CONTENT_CACHE_MIN_BYTES as usize]).unwrap();
        let action = Cell::new(0);
        let authorize = |_: &Path, _: AccessMode| {
            match action.replace(0) {
                1 => return Err("denied".into()),
                2 => {
                    let modified = fs::metadata(&path).unwrap().modified().unwrap();
                    fs::write(&path, vec![b'b'; CONTENT_CACHE_MIN_BYTES as usize]).unwrap();
                    fs::File::options()
                        .write(true)
                        .open(&path)
                        .unwrap()
                        .set_times(fs::FileTimes::new().set_modified(modified))
                        .unwrap();
                }
                _ => {}
            }
            Ok(())
        };
        let context = Context::new(&authorize);
        super::content_digest(&path, CONTENT_CACHE_MIN_BYTES, &context).unwrap();
        action.set(1);
        assert_eq!(
            super::content_digest(&path, CONTENT_CACHE_MIN_BYTES, &context).unwrap_err(),
            "denied"
        );
        action.set(2);
        // Either the strong post-observation rejects mutation, or a full
        // rehash sees it. The cached old digest must never be returned.
        let observed = super::content_digest(&path, CONTENT_CACHE_MIN_BYTES, &context);
        if let Ok((digest, _)) = observed {
            use sha2::{Digest, Sha256};
            assert_eq!(
                digest,
                format!(
                    "{:x}",
                    Sha256::digest(vec![b'b'; CONTENT_CACHE_MIN_BYTES as usize])
                )
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn persistent_reader_restored_mtime_rewrites_rehash_current_content() {
        use sha2::{Digest, Sha256};
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("file");
        fs::write(&path, vec![b'a'; CONTENT_CACHE_MIN_BYTES as usize]).unwrap();
        let reader = fs::File::open(&path).unwrap();
        let modified = reader.metadata().unwrap().modified().unwrap();
        let context = Context::new(&allow);
        let initial = super::content_digest(&path, CONTENT_CACHE_MIN_BYTES, &context).unwrap();
        assert_eq!(
            super::content_digest(&path, CONTENT_CACHE_MIN_BYTES, &context).unwrap(),
            initial
        );
        assert_eq!(context.content.borrow().hashes, 2);
        for round in 0..16 {
            let payload = vec![b'b' + round as u8; CONTENT_CACHE_MIN_BYTES as usize];
            fs::write(&path, &payload).unwrap();
            fs::File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_times(fs::FileTimes::new().set_modified(modified))
                .unwrap();
            let observed = super::content_digest(&path, CONTENT_CACHE_MIN_BYTES, &context).unwrap();
            assert_eq!(observed.0, format!("{:x}", Sha256::digest(&payload)));
            assert_ne!(observed.0, initial.0);
            assert_eq!(context.content.borrow().hashes, round + 3);
        }
        drop(reader);
    }

    #[cfg(windows)]
    #[test]
    fn open_writer_falls_back_to_full_hashing() {
        use std::io::{Seek, SeekFrom, Write};
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("file");
        fs::write(&path, vec![b'a'; CONTENT_CACHE_MIN_BYTES as usize]).unwrap();
        let context = Context::new(&allow);
        let initial = super::content_digest(&path, CONTENT_CACHE_MIN_BYTES, &context).unwrap();
        let mut writer = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .unwrap();
        assert_eq!(
            super::content_digest(&path, CONTENT_CACHE_MIN_BYTES, &context).unwrap(),
            initial
        );
        assert_eq!(context.content.borrow().hashes, 2);
        writer.seek(SeekFrom::Start(0)).unwrap();
        writer
            .write_all(&vec![b'b'; CONTENT_CACHE_MIN_BYTES as usize])
            .unwrap();
        writer.flush().unwrap();
        assert_ne!(
            super::content_digest(&path, CONTENT_CACHE_MIN_BYTES, &context)
                .unwrap()
                .0,
            initial.0
        );
        assert_eq!(context.content.borrow().hashes, 3);
    }
}
pub(crate) fn reserved(root: &Path, path: &Path) -> bool {
    if path == root {
        return true;
    }
    path.strip_prefix(root).map_or(true,|p|p.components().any(|c|matches!(c,Component::Normal(s) if [".git",".azrael-ex",".codex",".ssh",".config"].iter().any(|n|s.to_string_lossy().eq_ignore_ascii_case(n))))) || within(path,&root.join("artifacts/maintenance")) || within(&root.join("artifacts/maintenance"),path) || within(path,&root.join("project-maintenance.json"))
}

#[cfg(not(windows))]
pub(crate) fn delete(path: &Path, _entries: &[PathBuf]) -> Result<Value, String> {
    let result = if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    result.map_err(|e| e.to_string())?;
    if fs::symlink_metadata(path).is_ok() {
        return Err("deletion left target present".into());
    }
    Ok(
        json!({"status":"deleted","attributes":[],"remaining":false,"physical_bytes_reclaimed":null}),
    )
}

pub(crate) fn delete_verified(
    root: &Path,
    path: &Path,
    entries: &[PathBuf],
    auth: Auth<'_>,
) -> Result<Value, String> {
    validate_nested_junctions(root, path, auth)?;
    #[cfg(windows)]
    {
        let junctions = auth.junctions.borrow().iter().filter(|(entry, _)| within(entry, path))
            .map(|(entry, spec)| json!({"path":entry,"target":spec["target"],"identity":spec["identity"]})).collect::<Vec<_>>();
        delete_windows(path, entries, &junctions)
    }
    #[cfg(not(windows))]
    {
        delete(path, entries)
    }
}

/// Before any group member is changed, reject attribute normalization whose
/// other hardlink names are not proven to belong to the deletion cohort.
pub(crate) fn normalization_preflight(approved: &[PathBuf]) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        let mut files = Vec::new();
        // entries already read-authorized and checked these exact paths. Reuse
        // that single enumeration without another descendant traversal or
        // authorization callback; the final deletion boundary rechecks pins.
        for entry in approved {
            let metadata = fs::symlink_metadata(entry).map_err(|e| e.to_string())?;
            if metadata.is_file() {
                files.push((entry, metadata.file_attributes() & 3 != 0));
            }
        }
        if files.iter().any(|(_, normalize)| *normalize) {
            let mut counts = std::collections::BTreeMap::<String, u32>::new();
            let mut changing = Vec::new();
            for (entry, normalize) in files {
                let (_, id, standard) = registered_handle_information(&entry)?;
                let identity =
                    hash(&json!({"volume":id.VolumeSerialNumber,"file_id":id.FileId.Identifier}))?;
                *counts.entry(identity.clone()).or_default() += 1;
                if normalize {
                    changing.push((entry, identity, standard.NumberOfLinks));
                }
            }
            for (entry, identity, links) in changing {
                if links == 0 || counts.get(&identity) != Some(&links) {
                    return Err("ReadOnly/Hidden normalization blocked: multiple hardlinks extend outside one selected deletion root; cross-member link ownership is not verified".into());
                }
                let (_, current_id, current) = registered_handle_information(&entry)?;
                if current.NumberOfLinks != links
                    || hash(
                        &json!({"volume":current_id.VolumeSerialNumber,"file_id":current_id.FileId.Identifier}),
                    )? != identity
                {
                    return Err("normalization file identity or link count changed".into());
                }
            }
        }
    }
    #[cfg(not(windows))]
    let _ = approved;
    Ok(())
}

#[cfg(windows)]
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn delete(path: &Path, entries: &[PathBuf]) -> Result<Value, String> {
    delete_windows(path, entries, &[])
}

#[cfg(windows)]
fn delete_windows(path: &Path, entries: &[PathBuf], junctions: &[Value]) -> Result<Value, String> {
    use std::io::Write;
    // JSON goes through stdin; no path is interpolated into shell source.
    // Attribute observations and partial errors are returned even when removal fails.
    const SCRIPT: &str = r#"
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$request=[Console]::In.ReadToEnd() | ConvertFrom-Json
$changes=[Collections.Generic.List[object]]::new(); $failure=$null; $target=$null
$junctions=@{}
if($true) {
    # Reuse the non-following Windows identity boundary used by the producer
    # cleanup helper; pin the full FILE_ID_INFO and mount-point payload here.
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;
public static class MaintenanceJunctionNative {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFileW(string p, uint a, uint s, IntPtr sa, uint c, uint f, IntPtr t);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandleEx(SafeFileHandle h, int c, IntPtr b, uint n);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool DeviceIoControl(SafeFileHandle h, uint c, IntPtr i, uint ni, byte[] o, uint no, out uint n, IntPtr ov);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool RemoveDirectoryW(string p);
    public static string NormalizationPin(string path) {
        using(var h=CreateFileW(path,128,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
            if(h.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            var info=Marshal.AllocHGlobal(24);
            try {
                if(!GetFileInformationByHandleEx(h,1,info,24)) throw new Win32Exception(Marshal.GetLastWin32Error());
                uint links=unchecked((uint)Marshal.ReadInt32(info,16));
                if(links==0) throw new InvalidOperationException("Normalization link count unavailable");
                if(!GetFileInformationByHandleEx(h,18,info,24)) throw new Win32Exception(Marshal.GetLastWin32Error());
                var id=new byte[16]; Marshal.Copy(IntPtr.Add(info,8),id,0,16);
                ulong volume=unchecked((ulong)Marshal.ReadInt64(info));
                if(volume==0 || Array.TrueForAll(id,b=>b==0)) throw new InvalidOperationException("Normalization file identity unavailable");
                return volume.ToString()+":"+String.Join(",",id)+":"+links.ToString();
            } finally {Marshal.FreeHGlobal(info);}
        }
    }
    public static void Unlink(string path, string expectedPin) {
        if(Pin(path)!=expectedPin) throw new InvalidOperationException("Approved junction identity changed before unlink");
        // RemoveDirectoryW removes the directory junction entry itself. It
        // never enumerates or recursively removes the linked directory.
        if(!RemoveDirectoryW(path)) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    public static string Pin(string path) {
        using(var h=CreateFileW(path,128,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
            if(h.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            var info=Marshal.AllocHGlobal(24);
            try {
                if(!GetFileInformationByHandleEx(h,18,info,24)) throw new Win32Exception(Marshal.GetLastWin32Error());
                var id=new byte[16]; Marshal.Copy(IntPtr.Add(info,8),id,0,16);
                var raw=new byte[16384]; uint n;
                if(!DeviceIoControl(h,0x900a8,IntPtr.Zero,0,raw,16384,out n,IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
                if(n<16 || BitConverter.ToUInt32(raw,0)!=0xa0000003) throw new InvalidOperationException("Mount-point junction required");
                using(var sha=SHA256.Create()) {
                    var digest=BitConverter.ToString(sha.ComputeHash(raw,0,(int)n)).Replace("-", "").ToLowerInvariant();
                    return unchecked((ulong)Marshal.ReadInt64(info)).ToString()+":"+String.Join(",",id)+":"+digest;
                }
            } finally {Marshal.FreeHGlobal(info);}
        }
    }
}
'@
}
function Extended-Literal([string]$literal) {
    # Normalize provider-returned and approved paths into the same literal key.
    # Do not resolve through the filesystem or use MAX_PATH-limited .NET helpers.
    $plain=$literal.Replace('/','\')
    if($plain.StartsWith('\\?\UNC\',[StringComparison]::OrdinalIgnoreCase)){$plain='\\'+$plain.Substring(8)}
    elseif($plain.StartsWith('\\?\')){$plain=$plain.Substring(4)}
    if($plain -match '^[A-Za-z]:\\') {
        $root=$plain.Substring(0,3); $tail=$plain.Substring(3)
        if($tail.Contains(':')){throw 'Alternate stream rejected'}
        $prefix='\\?\'
    } elseif($plain -match '^\\\\([^\\]+)\\([^\\]+)(?:\\|$)') {
        $root='\\'+$Matches[1]+'\'+$Matches[2]+'\'
        $tail=$plain.Substring([Math]::Min($root.Length,$plain.Length))
        if($plain.Contains(':') -or $Matches[1] -eq '.' -or $Matches[1] -eq '?'){throw 'Device/stream path rejected'}
        $prefix='\\?\UNC\'; $plain=$plain.Substring(2)
    } else {throw 'Absolute drive or UNC path required'}
    foreach($part in $tail.Split('\')) {
        if($part -eq '.' -or $part -eq '..'){throw 'Ambiguous path rejected'}
    }
    $result=$prefix+$plain.TrimEnd('\')
    if($tail.TrimEnd('\').Length -eq 0){$result+='\'}
    return $result
}
function Literal-Root([string]$literal) {
    if($literal -match '^\\\\\?\\[A-Za-z]:\\'){return $literal.Substring(0,7)}
    if($literal -match '^\\\\\?\\UNC\\[^\\]+\\[^\\]+(?:\\|$)'){return $Matches[0].TrimEnd('\')+'\'}
    throw 'Invalid extended root'
}
function Assert-Ancestors($literal) {
    $cursor=$literal; $root=Literal-Root $literal
    while($cursor) {
        $attributes=[int][IO.File]::GetAttributes($cursor)
        if(($attributes -band 1024) -ne 0){
            if($cursor -ne $literal -or !$junctions.ContainsKey($literal)){throw 'Ancestor reparse path protected'}
            Assert-Junction $literal
        }
        if($cursor.TrimEnd('\') -eq $root.TrimEnd('\')){break}
        $parent=$cursor.Substring(0,$cursor.TrimEnd('\').LastIndexOf('\'))
        if($parent.Length -lt $root.Length){$cursor=$root}else{$cursor=$parent}
    }
}
function Assert-Junction($literal) {
    $spec=$junctions[$literal]
    $entry=Get-Item -LiteralPath $literal -Force -ErrorAction Stop
    if($entry.LinkType -ne 'Junction' -or ([int]$entry.Attributes -band 4) -ne 0 -or
       (Extended-Literal ([string]$entry.Target)) -ne (Extended-Literal ([string]$spec.target)) -or
       [MaintenanceJunctionNative]::Pin($literal) -cne [string]$spec.identity.pin) {throw 'Approved junction changed'}
}
$approved=@{}
function Assert-Tree {
    $pending=[Collections.Generic.Stack[string]]::new(); $pending.Push($target)
    $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    while($pending.Count -gt 0) {
        $literal=$pending.Pop()
        if(!$approved.ContainsKey($literal)){throw 'Unreviewed descendant appeared'}
        if(!$seen.Add($literal)){throw 'Duplicate observed descendant'}
        Assert-Ancestors $literal
        $attributes=[int][IO.File]::GetAttributes($literal)
        if(($attributes -band 4) -ne 0){throw 'System attributes protected'}
        # Top-level literal enumeration includes hidden/system entries. The
        # checked leaf must be a plain directory before enumeration starts.
        if(($attributes -band 16) -ne 0 -and !$junctions.ContainsKey($literal)){foreach($child in [IO.Directory]::EnumerateFileSystemEntries($literal)){$pending.Push((Extended-Literal $child))}}
    }
    if($seen.Count -ne $approved.Count){throw 'Approved descendant disappeared'}
}
try {
    $target=Extended-Literal $request.path
    foreach($original in $request.entries) {
        $literal=Extended-Literal $original
        if($literal -ne $target -and !$literal.StartsWith($target.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Approved path escapes target'}
        if($approved.ContainsKey($literal)){throw 'Duplicate approved path'}
        $approved[$literal]=$original
    }
    foreach($spec in $request.junctions) {
        $literal=Extended-Literal $spec.path
        if($literal -eq $target -or !$approved.ContainsKey($literal) -or $junctions.ContainsKey($literal)){throw 'Invalid junction deletion approval'}
        $junctions[$literal]=$spec
    }
    Assert-Tree
    # Preflight every attribute-changing file before modifying any entry.
    # Count every approved regular-file name in this one deletion root.
    $normalizationPins=@{}
    foreach($literal in $approved.Keys) {
        Assert-Ancestors $literal
        if($junctions.ContainsKey($literal)){continue}
        $attributes=[int][IO.File]::GetAttributes($literal)
        if(($attributes -band 16) -eq 0 -and (($attributes -band 3) -ne 0)) {
            $normalizationPins[$literal]=[MaintenanceJunctionNative]::NormalizationPin($literal)
        }
    }
    if($normalizationPins.Count -gt 0) {
        $linkCounts=@{}
        foreach($literal in $approved.Keys) {
            Assert-Ancestors $literal
            if($junctions.ContainsKey($literal)){continue}
            $attributes=[int][IO.File]::GetAttributes($literal)
            if(($attributes -band 16) -eq 0) {
                $pin=[MaintenanceJunctionNative]::NormalizationPin($literal)
                if(!$linkCounts.ContainsKey($pin)){$linkCounts[$pin]=0}
                $linkCounts[$pin]++
            }
        }
        foreach($pin in $normalizationPins.Values) {
            $links=[uint32]($pin.Split(':')[-1])
            if(!$linkCounts.ContainsKey($pin) -or $linkCounts[$pin] -ne $links) {throw 'ReadOnly/Hidden normalization blocked: multiple hardlinks extend outside one selected deletion root; cross-member link ownership is not verified'}
        }
    }
    # Assert-Tree checked the exact full authorized set before normalization.
    foreach($literal in $approved.Keys) {
        Assert-Ancestors $literal
        if($junctions.ContainsKey($literal)){continue}
        $before=[int][IO.File]::GetAttributes($literal)
        if(($before -band 4) -ne 0 -or ($before -band 1024) -ne 0) {throw 'System/reparse attributes protected'}
        $after=$before -band (-bnot 3)
        if($before -ne $after){
            if(($before -band 16) -eq 0) {
                if(!$normalizationPins.ContainsKey($literal) -or [MaintenanceJunctionNative]::NormalizationPin($literal) -cne $normalizationPins[$literal]) {throw 'Normalization file identity or link count changed'}
            }
            [IO.File]::SetAttributes($literal,[IO.FileAttributes]$after)
            $changes.Add(@{path=$approved[$literal];before=$before;after=[int][IO.File]::GetAttributes($literal)})
        }
    }
    Assert-Tree
    foreach($literal in $junctions.Keys) {
        Assert-Ancestors $literal
        Assert-Junction $literal
        [MaintenanceJunctionNative]::Unlink($literal, [string]$junctions[$literal].identity.pin)
    }
    # Ordinary recursive removal starts only after all approved links are gone.
    $junctions.Clear()
    foreach($original in $request.junctions){$approved.Remove((Extended-Literal $original.path))}
    Assert-Tree
    Remove-Item -LiteralPath $target -Recurse -ErrorAction Stop
} catch { $failure=$_.Exception.Message }
$remaining=$null
if($target) {
    # Only explicit absence exceptions establish removal; access or other
    # metadata failures preserve an unknown remaining state.
    try {$null=[IO.File]::GetAttributes($target); $remaining=$true}
    catch [IO.FileNotFoundException] {$remaining=$false}
    catch [IO.DirectoryNotFoundException] {$remaining=$false}
    catch {if(!$failure){$failure=$_.Exception.Message}}
}
@{status=$(if($remaining -eq $false -and !$failure){'deleted'}else{'failed'});attributes=@($changes.ToArray());error=$failure;remaining=$remaining;physical_bytes_reclaimed=$null} | ConvertTo-Json -Depth 8 -Compress
"#;
    let mut child = std::process::Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            SCRIPT,
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let input = serde_json::to_vec(&json!({"path":path,"entries":entries,"junctions":junctions}))
        .map_err(|e| e.to_string())?;
    child
        .stdin
        .take()
        .ok_or("missing shell stdin")?
        .write_all(&input)
        .map_err(|e| e.to_string())?;
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("invalid deletion report: {e}"))
}

#[cfg(all(test, windows))]
#[test]
fn missing_approved_descendant_stops_before_attribute_changes() {
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("generated");
    fs::create_dir(&target).unwrap();
    let file = target.join("readonly");
    fs::write(&file, "generated fixture").unwrap();
    let mut permissions = fs::metadata(&file).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&file, permissions).unwrap();
    let result = delete(
        &target,
        &[target.clone(), file.clone(), target.join("disappeared")],
    )
    .unwrap();
    assert_eq!(result["status"], "failed");
    assert_eq!(result["remaining"], true);
    assert!(
        result["error"]
            .as_str()
            .unwrap()
            .contains("Approved descendant disappeared")
    );
    assert!(result["attributes"].as_array().unwrap().is_empty());
    assert!(fs::metadata(&file).unwrap().permissions().readonly());
    // Only this test-generated flag is restored for ordinary fixture cleanup.
    let mut permissions = fs::metadata(&file).unwrap().permissions();
    permissions.set_readonly(false);
    fs::set_permissions(&file, permissions).unwrap();
}

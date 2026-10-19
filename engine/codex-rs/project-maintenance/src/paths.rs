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

struct CacheGuard {
    #[cfg(windows)]
    _file: fs::File,
}

#[cfg(windows)]
fn cache_guard(path: &Path, version: &FileVersion) -> Option<CacheGuard> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_DELETE, FILE_SHARE_READ};
    // Windows can defer write/change timestamps until a writer closes. Denying
    // write sharing proves no writer is open during this observation. Failure
    // simply selects ordinary full hashing; no callback runs with this guard.
    let guard = fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_DELETE)
        .open(path)
        .ok()?;
    if file_version(&guard).as_ref() == Some(version) {
        Some(CacheGuard { _file: guard })
    } else {
        None
    }
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
    // On Windows the deny-write guard spans every cached-hit observation and
    // cache update. No authorization callback runs while this handle is held.
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
                    return Err(format!("link/reparse path rejected: {}", p.display()));
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
    let mut out = Vec::new();
    let mut pending = vec![path.to_owned()];
    while let Some(current) = pending.pop() {
        // No callback or filesystem operation intervenes between the checked
        // leaf observation and its use here.
        let metadata = checked_metadata(root, &current, auth)?.ok_or("tree entry disappeared")?;
        if !metadata.is_file() && !metadata.is_dir() {
            return Err("special file rejected".into());
        }
        if metadata.is_dir() {
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
        let content = if before.is_file() {
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
    fn unchanged_content_hashes_once_and_new_operation_hashes_again() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("file");
        fs::write(&path, vec![b'a'; CONTENT_CACHE_MIN_BYTES as usize]).unwrap();
        let context = Context::new(&allow);
        let first = measure(root.path(), &path, &context).unwrap();
        assert_eq!(measure(root.path(), &path, &context).unwrap(), first);
        assert_eq!(context.content.borrow().hashes, 1);
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
    fn restored_mtime_rewrite_has_distinct_usn() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("file");
        for _ in 0..16 {
            fs::write(&path, vec![b'a'; CONTENT_CACHE_MIN_BYTES as usize]).unwrap();
            let reader = fs::File::open(&path).unwrap();
            let Some(before) = file_version(&reader) else {
                // The file system cannot prove a journaled version: no cache.
                return;
            };
            let modified = reader.metadata().unwrap().modified().unwrap();
            fs::write(&path, vec![b'b'; CONTENT_CACHE_MIN_BYTES as usize]).unwrap();
            fs::File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_times(fs::FileTimes::new().set_modified(modified))
                .unwrap();
            let after = file_version(&reader).unwrap();
            assert_ne!(before.usn, after.usn);
            assert_ne!(before, after);
        }
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

#[cfg(windows)]
pub(crate) fn delete(path: &Path, entries: &[PathBuf]) -> Result<Value, String> {
    use std::io::Write;
    // JSON goes through stdin; no path is interpolated into shell source.
    // Attribute observations and partial errors are returned even when removal fails.
    const SCRIPT: &str = r#"
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$request=[Console]::In.ReadToEnd() | ConvertFrom-Json
$changes=[Collections.Generic.List[object]]::new(); $failure=$null; $target=$null
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
        if(($attributes -band 1024) -ne 0){throw 'Ancestor reparse path protected'}
        if($cursor.TrimEnd('\') -eq $root.TrimEnd('\')){break}
        $parent=$cursor.Substring(0,$cursor.TrimEnd('\').LastIndexOf('\'))
        if($parent.Length -lt $root.Length){$cursor=$root}else{$cursor=$parent}
    }
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
        $observed=Get-Item -LiteralPath $literal -Force
        if(([int]$observed.Attributes -band 4) -ne 0){throw 'System attributes protected'}
        if($observed.PSIsContainer){foreach($child in Get-ChildItem -LiteralPath $literal -Force){$pending.Push((Extended-Literal $child.FullName))}}
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
    Assert-Tree
    # Assert-Tree checked the exact full authorized set before normalization.
    foreach($literal in $approved.Keys) {
        Assert-Ancestors $literal
        $item=Get-Item -LiteralPath $literal -Force
        $before=[int]$item.Attributes
        if(($before -band 4) -ne 0 -or ($before -band 1024) -ne 0) {throw 'System/reparse attributes protected'}
        $after=$before -band (-bnot 3)
        if($before -ne $after){
            $item.Attributes=[System.IO.FileAttributes]$after
            $changes.Add(@{path=$approved[$literal];before=$before;after=[int]$item.Attributes})
        }
    }
    Assert-Tree
    Remove-Item -LiteralPath $target -Recurse -ErrorAction Stop
} catch { $failure=$_.Exception.Message }
$remaining=$null
if($target) {
    # Windows PowerShell can return no object and no error for an absent
    # extended literal. Successful invocation alone is not proof of presence.
    try {$observed=Get-Item -LiteralPath $target -Force -ErrorAction Stop; $remaining=($null -ne $observed)}
    catch [System.Management.Automation.ItemNotFoundException] {$remaining=$false}
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
    let input =
        serde_json::to_vec(&json!({"path":path,"entries":entries})).map_err(|e| e.to_string())?;
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

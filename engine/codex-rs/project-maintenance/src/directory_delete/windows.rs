//! Ordinary, handle-bound deletion of an explicitly approved entire directory.
//! No attribute, ACL, ownership or link-target changes are made here.

use crate::AccessMode;
use serde_json::{Value, json};
use std::ffi::{OsStr, OsString, c_void};
use std::fs::{File, OpenOptions};
use std::mem::{offset_of, size_of};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle};
use std::path::{Component, Path, PathBuf, Prefix};
use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_NO_MORE_FILES, HANDLE};
use windows_sys::Win32::Storage::FileSystem::{
    DELETE, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_SYSTEM,
    FILE_ATTRIBUTE_TAG_INFO, FILE_BASIC_INFO, FILE_DISPOSITION_INFO, FILE_FLAG_BACKUP_SEMANTICS,
    FILE_FLAG_OPEN_REPARSE_POINT, FILE_ID_BOTH_DIR_INFO, FILE_ID_INFO, FILE_LIST_DIRECTORY,
    FILE_READ_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_STANDARD_INFO,
    FileAttributeTagInfo, FileBasicInfo, FileDispositionInfo, FileIdBothDirectoryInfo,
    FileIdBothDirectoryRestartInfo, FileIdInfo, FileStandardInfo, GetFileInformationByHandleEx,
    SYNCHRONIZE, SetFileInformationByHandle,
};

const IO_REPARSE_TAG_MOUNT_POINT: u32 = 0xa000_0003;
const IO_REPARSE_TAG_SYMLINK: u32 = 0xa000_000c;
const STATUS_OBJECT_NAME_NOT_FOUND: i32 = 0xc000_0034_u32 as i32;
const FILE_OPEN: u32 = 1;
const FILE_SYNCHRONOUS_IO_NONALERT: u32 = 0x20;
const FILE_OPEN_FOR_BACKUP_INTENT: u32 = 0x4000;
const FILE_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

type Authorizer<'a> = dyn Fn(&Path, AccessMode) -> Result<(), String> + 'a;

// Keep the NT boundary local: every name is exactly one component under a live
// parent handle. Absolute child paths would reintroduce parent-reparse races.
#[repr(C)]
struct UnicodeString {
    length: u16,
    maximum_length: u16,
    buffer: *mut u16,
}

#[repr(C)]
struct ObjectAttributes {
    length: u32,
    root_directory: HANDLE,
    object_name: *mut UnicodeString,
    attributes: u32,
    security_descriptor: *mut c_void,
    security_quality_of_service: *mut c_void,
}

#[repr(C)]
struct IoStatusBlock {
    status: usize,
    information: usize,
}

#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtCreateFile(
        handle: *mut HANDLE,
        access: u32,
        attributes: *mut ObjectAttributes,
        status: *mut IoStatusBlock,
        allocation_size: *const i64,
        file_attributes: u32,
        share: u32,
        disposition: u32,
        options: u32,
        ea: *const c_void,
        ea_length: u32,
    ) -> i32;
    fn RtlNtStatusToDosError(status: i32) -> u32;
}

fn failure(stage: &str, path: &Path) -> String {
    format!(
        "entire_directory.{stage}: {}: {}",
        path.display(),
        std::io::Error::last_os_error()
    )
}

fn check_cancelled(cancelled: &dyn Fn() -> bool) -> Result<(), String> {
    if cancelled() {
        Err("entire_directory deletion cancelled; completed removals are preserved".into())
    } else {
        Ok(())
    }
}

fn relative_open(parent: &File, name: &OsStr, deleting: bool) -> Result<File, i32> {
    let mut name: Vec<u16> = name.encode_wide().collect();
    // Names come from validated path components or native directory records.
    if name.is_empty() || name.iter().any(|c| matches!(*c, 0 | 47 | 92)) || name.len() > 32767 {
        return Err(0xc000_0033_u32 as i32); // STATUS_OBJECT_NAME_INVALID
    }
    let mut unicode = UnicodeString {
        length: (name.len() * 2) as u16,
        maximum_length: (name.len() * 2) as u16,
        buffer: name.as_mut_ptr(),
    };
    let mut attributes = ObjectAttributes {
        length: size_of::<ObjectAttributes>() as u32,
        root_directory: parent.as_raw_handle(),
        object_name: &mut unicode,
        attributes: 0x40, // OBJ_CASE_INSENSITIVE, matching Win32 path lookup
        security_descriptor: std::ptr::null_mut(),
        security_quality_of_service: std::ptr::null_mut(),
    };
    let mut status = IoStatusBlock {
        status: 0,
        information: 0,
    };
    let mut handle = std::ptr::null_mut();
    // LIST_DIRECTORY also grants READ_DATA on a file. This deliberately uses
    // ordinary read/delete access; denied access is reported, never bypassed.
    let access = FILE_READ_ATTRIBUTES
        | FILE_LIST_DIRECTORY
        | SYNCHRONIZE
        | if deleting { DELETE } else { 0 };
    // SAFETY: NT structures and UTF-16 storage outlive the synchronous call.
    let result = unsafe {
        NtCreateFile(
            &mut handle,
            access,
            &mut attributes,
            &mut status,
            std::ptr::null(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            FILE_OPEN,
            FILE_OPEN_REPARSE_POINT | FILE_OPEN_FOR_BACKUP_INTENT | FILE_SYNCHRONOUS_IO_NONALERT,
            std::ptr::null(),
            0,
        )
    };
    if result < 0 {
        Err(result)
    } else {
        // SAFETY: a successful NtCreateFile transfers one owned handle.
        Ok(unsafe { File::from_raw_handle(handle) })
    }
}

fn nt_failure(path: &Path, status: i32) -> String {
    // SAFETY: this is a pure conversion of an NTSTATUS value.
    let error = unsafe { RtlNtStatusToDosError(status) };
    format!(
        "entire_directory.open: {}: {} (NTSTATUS {status:#x})",
        path.display(),
        std::io::Error::from_raw_os_error(error as i32)
    )
}

fn info<T: Default>(file: &File, class: i32, path: &Path) -> Result<T, String> {
    let mut value = T::default();
    // SAFETY: callers pair each information class with its exact Win32 struct.
    if unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            class,
            (&mut value as *mut T).cast(),
            size_of::<T>() as u32,
        )
    } == 0
    {
        return Err(failure("information", path));
    }
    Ok(value)
}

struct Observation {
    attributes: u32,
    tag: u32,
    id: FILE_ID_INFO,
}

fn observe(file: &File, path: &Path, authorize: &Authorizer<'_>) -> Result<Observation, String> {
    authorize(path, AccessMode::Read)?;
    let basic: FILE_BASIC_INFO = info(file, FileBasicInfo, path)?;
    let tag: FILE_ATTRIBUTE_TAG_INFO = info(file, FileAttributeTagInfo, path)?;
    let id: FILE_ID_INFO = info(file, FileIdInfo, path)?;
    let standard: FILE_STANDARD_INFO = info(file, FileStandardInfo, path)?;
    if standard.DeletePending || id.VolumeSerialNumber == 0 || id.FileId.Identifier == [0; 16] {
        return Err(format!(
            "entire_directory identity unavailable or deletion pending: {}",
            path.display()
        ));
    }
    if basic.FileAttributes != tag.FileAttributes {
        return Err(format!(
            "entire_directory attributes changed while observing: {}",
            path.display()
        ));
    }
    Ok(Observation {
        attributes: basic.FileAttributes,
        tag: tag.ReparseTag,
        id,
    })
}

fn ordinary_directory(observation: &Observation, path: &Path) -> Result<(), String> {
    if observation.attributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)
        != FILE_ATTRIBUTE_DIRECTORY
    {
        return Err(format!(
            "entire_directory requires a physical directory: {}",
            path.display()
        ));
    }
    Ok(())
}

fn names(
    file: &File,
    path: &Path,
    authorize: &Authorizer<'_>,
    cancelled: &dyn Fn() -> bool,
) -> Result<std::vec::IntoIter<OsString>, String> {
    // u64 storage supplies the alignment required by FILE_ID_BOTH_DIR_INFO.
    let mut buffer = vec![0_u64; 8192];
    let capacity = buffer.len() * size_of::<u64>();
    let mut result = Vec::new();
    let mut restart = true;
    loop {
        check_cancelled(cancelled)?;
        authorize(path, AccessMode::Read)?;
        let class = if restart {
            FileIdBothDirectoryRestartInfo
        } else {
            FileIdBothDirectoryInfo
        };
        // SAFETY: this live handle and aligned writable buffer cover the call.
        if unsafe {
            GetFileInformationByHandleEx(
                file.as_raw_handle(),
                class,
                buffer.as_mut_ptr().cast(),
                capacity as u32,
            )
        } == 0
        {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() == Some(ERROR_NO_MORE_FILES as i32)
                || (restart && error.raw_os_error() == Some(ERROR_FILE_NOT_FOUND as i32))
            {
                return Ok(result.into_iter());
            }
            return Err(format!(
                "entire_directory.enumerate: {}: {error}",
                path.display()
            ));
        }
        restart = false;
        let mut offset = 0;
        loop {
            if offset + size_of::<FILE_ID_BOTH_DIR_INFO>() > capacity {
                return Err("entire_directory invalid native directory record".into());
            }
            // SAFETY: the fixed header fits, and the variable name is checked below.
            let entry = unsafe {
                std::ptr::read_unaligned(
                    buffer
                        .as_ptr()
                        .cast::<u8>()
                        .add(offset)
                        .cast::<FILE_ID_BOTH_DIR_INFO>(),
                )
            };
            let name_offset = offset + offset_of!(FILE_ID_BOTH_DIR_INFO, FileName);
            let bytes = entry.FileNameLength as usize;
            let end = name_offset
                .checked_add(bytes)
                .filter(|end| *end <= capacity);
            if bytes == 0
                || bytes % 2 != 0
                || end.is_none()
                || (entry.NextEntryOffset != 0
                    && (entry.NextEntryOffset as usize) < name_offset - offset + bytes)
            {
                return Err("entire_directory invalid native directory name".into());
            }
            // SAFETY: the UTF-16 range is aligned, in-bounds and initialized by Win32.
            let units = unsafe {
                std::slice::from_raw_parts(
                    buffer.as_ptr().cast::<u8>().add(name_offset).cast::<u16>(),
                    bytes / 2,
                )
            };
            let name = OsString::from_wide(units);
            if name != OsStr::new(".") && name != OsStr::new("..") {
                result.push(name);
            }
            if entry.NextEntryOffset == 0 {
                break;
            }
            offset = offset
                .checked_add(entry.NextEntryOffset as usize)
                .filter(|offset| *offset < capacity)
                .ok_or("entire_directory invalid native directory offset")?;
        }
    }
}

fn remove(
    file: File,
    parent: &File,
    path: &Path,
    name: &OsStr,
    volume: u64,
    authorize: &Authorizer<'_>,
    cancelled: &dyn Fn() -> bool,
    stats: &mut super::Stats,
) -> Result<(), String> {
    authorize(path, AccessMode::Write)?;
    authorize(
        path.parent().ok_or("entire_directory missing parent")?,
        AccessMode::Write,
    )?;
    let observation = observe(&file, path, authorize)?;
    if observation.id.VolumeSerialNumber != volume {
        return Err(format!(
            "entire_directory volume changed: {}",
            path.display()
        ));
    }
    if observation.attributes & FILE_ATTRIBUTE_SYSTEM != 0 {
        return Err(format!(
            "entire_directory System attribute is protected: {}",
            path.display()
        ));
    }
    let link = observation.attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    if link
        && !matches!(
            observation.tag,
            IO_REPARSE_TAG_MOUNT_POINT | IO_REPARSE_TAG_SYMLINK
        )
    {
        return Err(format!(
            "entire_directory unsupported reparse tag {:#x}: {}",
            observation.tag,
            path.display()
        ));
    }
    check_cancelled(cancelled)?;
    let disposition = FILE_DISPOSITION_INFO { DeleteFile: true };
    // SAFETY: ordinary FileDispositionInfo applies to this exact opened object.
    // No POSIX, IGNORE_READONLY, attribute normalization or force flags are used.
    if unsafe {
        SetFileInformationByHandle(
            file.as_raw_handle(),
            FileDispositionInfo,
            (&disposition as *const FILE_DISPOSITION_INFO).cast(),
            size_of::<FILE_DISPOSITION_INFO>() as u32,
        )
    } == 0
    {
        return Err(failure("disposition", path));
    }
    drop(file);
    // Ordinary disposition can remain pending behind another reader. Count only
    // confirmed absence of this name, not a successful pending-delete request.
    authorize(path, AccessMode::Read)?;
    match relative_open(parent, name, false) {
        Err(STATUS_OBJECT_NAME_NOT_FOUND) => {}
        Err(status) => {
            return Err(format!(
                "entire_directory removal not confirmed: {}",
                nt_failure(path, status)
            ));
        }
        Ok(_) => {
            return Err(format!(
                "entire_directory name remains or was recreated after deletion: {}",
                path.display()
            ));
        }
    }
    if link {
        stats.links += 1;
    } else if observation.attributes & FILE_ATTRIBUTE_DIRECTORY != 0 {
        stats.directories += 1;
    } else {
        stats.files += 1;
    }
    Ok(())
}

struct Frame {
    file: File,
    path: PathBuf,
    name: OsString,
    names: std::vec::IntoIter<OsString>,
}

pub(super) fn delete(
    path: &Path,
    expected_identity: &Value,
    authorize: &Authorizer<'_>,
    cancelled: &dyn Fn() -> bool,
    stats: &mut super::Stats,
) -> Result<(), String> {
    crate::io_priority::background(|| {
        delete_inner(path, expected_identity, authorize, cancelled, stats)
    })
}

fn delete_inner(
    path: &Path,
    expected_identity: &Value,
    authorize: &Authorizer<'_>,
    cancelled: &dyn Fn() -> bool,
    stats: &mut super::Stats,
) -> Result<(), String> {
    check_cancelled(cancelled)?;
    let mut components = path.components();
    let prefix = match components.next() {
        Some(Component::Prefix(prefix))
            if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)) =>
        {
            prefix.as_os_str()
        }
        _ => return Err("entire_directory requires an absolute local Windows drive path".into()),
    };
    if components.next() != Some(Component::RootDir) {
        return Err("entire_directory requires an absolute Windows path".into());
    }
    let mut parts = Vec::new();
    for component in components {
        match component {
            Component::Normal(name) => parts.push(name.to_os_string()),
            _ => return Err("entire_directory rejects non-normal path components".into()),
        }
    }
    let root_name = parts
        .pop()
        .ok_or("entire_directory cannot remove a volume root")?;
    let mut current = PathBuf::from(prefix);
    current.push(r"\");
    authorize(&current, AccessMode::Read)?;
    let drive = OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY | SYNCHRONIZE)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(&current)
        .map_err(|_| failure("open_drive", &current))?;
    let drive_observation = observe(&drive, &current, authorize)?;
    ordinary_directory(&drive_observation, &current)?;
    let volume = drive_observation.id.VolumeSerialNumber;
    let mut ancestors = vec![drive];
    for name in parts {
        check_cancelled(cancelled)?;
        current.push(&name);
        authorize(&current, AccessMode::Read)?;
        let file = relative_open(ancestors.last().expect("drive pinned"), &name, false)
            .map_err(|status| nt_failure(&current, status))?;
        let observation = observe(&file, &current, authorize)?;
        ordinary_directory(&observation, &current)?;
        if observation.id.VolumeSerialNumber != volume {
            return Err(format!(
                "entire_directory ancestor crosses a volume: {}",
                current.display()
            ));
        }
        ancestors.push(file);
    }
    authorize(path, AccessMode::Read)?;
    let root = relative_open(ancestors.last().expect("parent pinned"), &root_name, true)
        .map_err(|status| nt_failure(path, status))?;
    let observation = observe(&root, path, authorize)?;
    ordinary_directory(&observation, path)?;
    if observation.id.VolumeSerialNumber != volume
        || json!({"volume":observation.id.VolumeSerialNumber,"file_id":observation.id.FileId.Identifier})
            != *expected_identity
    {
        return Err("entire_directory root identity changed before deletion".into());
    }
    if observation.attributes & FILE_ATTRIBUTE_SYSTEM != 0 {
        return Err(format!(
            "entire_directory System attribute is protected: {}",
            path.display()
        ));
    }
    let root_names = names(&root, path, authorize, cancelled)?;
    let mut stack = vec![Frame {
        file: root,
        path: path.into(),
        name: root_name,
        names: root_names,
    }];
    while !stack.is_empty() {
        check_cancelled(cancelled)?;
        let frame = stack.last_mut().expect("nonempty stack");
        if let Some(name) = frame.names.next() {
            let child_path = frame.path.join(&name);
            authorize(&child_path, AccessMode::Read)?;
            let file = relative_open(&frame.file, &name, true)
                .map_err(|status| nt_failure(&child_path, status))?;
            let observation = observe(&file, &child_path, authorize)?;
            if observation.id.VolumeSerialNumber != volume {
                return Err(format!(
                    "entire_directory child crosses a volume: {}",
                    child_path.display()
                ));
            }
            if observation.attributes & FILE_ATTRIBUTE_SYSTEM != 0 {
                return Err(format!(
                    "entire_directory System attribute is protected: {}",
                    child_path.display()
                ));
            }
            if observation.attributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)
                == FILE_ATTRIBUTE_DIRECTORY
            {
                let child_names = names(&file, &child_path, authorize, cancelled)?;
                stack.push(Frame {
                    file,
                    path: child_path,
                    name,
                    names: child_names,
                });
            } else {
                remove(
                    file,
                    &frame.file,
                    &child_path,
                    &name,
                    volume,
                    authorize,
                    cancelled,
                    stats,
                )?;
            }
        } else {
            let frame = stack.pop().expect("nonempty stack");
            let parent = stack
                .last()
                .map(|frame| &frame.file)
                .unwrap_or_else(|| ancestors.last().expect("parent pinned"));
            remove(
                frame.file,
                parent,
                &frame.path,
                &frame.name,
                volume,
                authorize,
                cancelled,
                stats,
            )?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    fn allow(_: &Path, _: AccessMode) -> Result<(), String> {
        Ok(())
    }

    fn identity(path: &Path) -> Value {
        crate::paths::registered_identity(path, &std::fs::symlink_metadata(path).unwrap()).unwrap()
    }

    // Later simplification to absolute recursive deletion must still leave an
    // external junction target untouched. Junction creation needs no symlink privilege.
    #[test]
    fn entire_directory_removes_external_junction_name_only() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path().join("approved");
        let outside = fixture.path().join("outside");
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(outside.join("keep"), b"outside target").unwrap();
        std::fs::write(root.join("ordinary"), b"approved child").unwrap();
        let output = std::process::Command::new("cmd.exe")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(root.join("external-junction"))
            .arg(&outside)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "junction setup failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let expected = identity(&root);
        let mut stats = super::super::Stats::default();
        delete(&root, &expected, &allow, &|| false, &mut stats).unwrap();
        assert!(!root.exists());
        assert_eq!(
            std::fs::read(outside.join("keep")).unwrap(),
            b"outside target"
        );
        assert_eq!((stats.files, stats.directories, stats.links), (1, 1, 1));
    }

    // Future identity-only registration changes must not omit the adapter's
    // final check against the pinned root before deleting its first descendant.
    #[test]
    fn entire_directory_stale_identity_preserves_contents() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path().join("approved");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("keep"), b"keep").unwrap();
        let mut stale = identity(&root);
        stale["volume"] = json!(0);
        let mut stats = super::super::Stats::default();
        assert!(
            delete(&root, &stale, &allow, &|| false, &mut stats)
                .unwrap_err()
                .contains("identity changed")
        );
        assert_eq!(std::fs::read(root.join("keep")).unwrap(), b"keep");
        assert_eq!((stats.files, stats.directories, stats.links), (0, 0, 0));
    }

    // Moving authorization/cancellation solely to entry would allow a callback
    // to revoke writes after traversal. Keep the actual mutation boundary covered.
    #[test]
    fn entire_directory_permission_and_cancellation_preserve_contents() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path().join("approved");
        std::fs::create_dir(&root).unwrap();
        let child = root.join("keep");
        std::fs::write(&child, b"keep").unwrap();
        let expected = identity(&root);
        let mut stats = super::super::Stats::default();
        let deny = |_: &Path, mode: AccessMode| {
            if mode == AccessMode::Write {
                Err("write denied by test".into())
            } else {
                Ok(())
            }
        };
        assert!(
            delete(&root, &expected, &deny, &|| false, &mut stats)
                .unwrap_err()
                .contains("write denied")
        );
        let cancelled = AtomicBool::new(false);
        let revoke = |path: &Path, mode: AccessMode| {
            if path == child && mode == AccessMode::Write {
                cancelled.store(true, Ordering::SeqCst);
            }
            Ok(())
        };
        assert!(
            delete(
                &root,
                &expected,
                &revoke,
                &|| cancelled.load(Ordering::SeqCst),
                &mut stats
            )
            .unwrap_err()
            .contains("cancelled")
        );
        assert_eq!(std::fs::read(&child).unwrap(), b"keep");
        assert_eq!((stats.files, stats.directories, stats.links), (0, 0, 0));
    }

    // Exact-tree deletion normalizes some generated attributes. Reusing that
    // code here would incorrectly normalize an approved ordinary user's file.
    #[test]
    fn entire_directory_preserves_readonly_and_system_attributes() {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_ATTRIBUTE_READONLY, SetFileAttributesW,
        };
        for attribute in [FILE_ATTRIBUTE_READONLY, FILE_ATTRIBUTE_SYSTEM] {
            let fixture = tempfile::tempdir().unwrap();
            let root = fixture.path().join("approved");
            std::fs::create_dir(&root).unwrap();
            let child = root.join("keep");
            std::fs::write(&child, b"keep").unwrap();
            let expected = identity(&root);
            let original = std::fs::symlink_metadata(&child).unwrap().file_attributes();
            let wide: Vec<u16> = child.as_os_str().encode_wide().chain(Some(0)).collect();
            // Fixture setup and restoration only; production never writes attributes.
            assert_ne!(
                unsafe { SetFileAttributesW(wide.as_ptr(), original | attribute) },
                0
            );
            let mut stats = super::super::Stats::default();
            let result = delete(&root, &expected, &allow, &|| false, &mut stats);
            let after = std::fs::symlink_metadata(&child);
            let contents = std::fs::read(&child);
            // Restore the owned fixture before assertions so even failures leave
            // TempDir able to clean up through its ordinary owner.
            let restored = unsafe { SetFileAttributesW(wide.as_ptr(), original) };
            assert_ne!(restored, 0);
            assert!(result.is_err());
            assert_eq!(after.unwrap().file_attributes(), original | attribute);
            assert_eq!(contents.unwrap(), b"keep");
            assert_eq!((stats.files, stats.directories, stats.links), (0, 0, 0));
        }
    }
}

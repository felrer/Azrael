//! Explicit sentinel recovery. Neither age nor an absent PID authorizes deletion.
use crate::{AccessMode, Auth, Context, paths, string};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

const MAX_BYTES: u64 = 65_536;
const MAX_STATE_BYTES: u64 = 64 * 1024 * 1024;

pub(crate) fn requested_wait(request: &Value) -> Result<std::time::Duration, String> {
    let millis = match request.get("lock_wait_ms") {
        None => 0,
        Some(value) => value
            .as_u64()
            .filter(|value| *value <= 600_000)
            .ok_or("lock_wait_ms must be an integer in 0..600000")?,
    };
    Ok(std::time::Duration::from_millis(millis))
}

/// Render only the exact structured contention contract. Ordinary I/O errors
/// remain ordinary errors, including Windows error 33 outside lock acquisition.
pub fn error_response(error: &str) -> Value {
    if let Ok(value) = serde_json::from_str::<Value>(error) {
        if error.len() <= 16 * 1024
            && value.as_object().is_some_and(|object| object.len() == 2)
            && value["error"] == "request cancelled or wait deadline exhausted"
            && value["coordination_diagnostics"].is_object()
        {
            return value;
        }
        if value["code"] == "maintenance_busy"
            && value["retryable"] == true
            && value["error"].is_string()
            && value["lock_path"].is_string()
            && (value["owner"].is_null() || value["owner"].is_object())
        {
            return value;
        }
    }
    json!({"error":error})
}

pub(crate) fn with_context(error: String, context: &str) -> String {
    let mut response = error_response(&error);
    if response["code"] == "maintenance_busy" {
        response["error"] = json!(format!(
            "{}; {context}",
            response["error"].as_str().unwrap_or(&error)
        ));
        response.to_string()
    } else {
        format!("{error}; {context}")
    }
}

pub(crate) fn busy(root: &Path, path: &Path, phase: &str, auth: Auth<'_>) -> LockAcquireError {
    // Owner metadata is diagnostic only. Failed authorization or a racing read
    // hides it; it never changes the contention result or proves termination.
    let owner = observe(root, path, auth)
        .ok()
        .and_then(|observation| serde_json::from_slice::<Value>(&observation.bytes).ok())
        .filter(|value| value.is_object())
        .map(|value| {
            json!({"pid":value["pid"],"operation":value["operation"],
            "acquired_at_ms":value["acquired_at_ms"]})
        });
    LockAcquireError::Busy(
        json!({"error":format!("OS lock busy: {} ({phase})",path.display()),
        "code":"maintenance_busy","retryable":true,"lock_path":path,"owner":owner})
        .to_string(),
    )
}

#[derive(Debug)]
pub(crate) enum LockAcquireError {
    Busy(String),
    Queued(String, crate::lock_wait::Waiter),
    Other(String),
}
impl From<String> for LockAcquireError {
    fn from(error: String) -> Self {
        Self::Other(error)
    }
}
impl From<&str> for LockAcquireError {
    fn from(error: &str) -> Self {
        Self::Other(error.into())
    }
}
impl From<LockAcquireError> for String {
    fn from(error: LockAcquireError) -> Self {
        match error {
            LockAcquireError::Busy(error)
            | LockAcquireError::Queued(error, _)
            | LockAcquireError::Other(error) => error,
        }
    }
}

/// Called only at a failed acquisition, with its already authorized handle.
pub(crate) fn busy_for_file(
    root: &Path,
    path: &Path,
    phase: &str,
    auth: Auth<'_>,
    file: &File,
) -> LockAcquireError {
    let prepare = (|| {
        paths::check(root, path, auth)?;
        auth(path, AccessMode::Read)?;
        final_plain_path(path)?;
        crate::lock_wait::Waiter::prepare(path, file)
    })();
    match prepare {
        Ok(Some(waiter)) => LockAcquireError::Queued(busy(root, path, phase, auth).into(), waiter),
        Ok(None) => busy(root, path, phase, auth),
        Err(error) => LockAcquireError::Other(error),
    }
}

// Internal String-returning read helpers can cross nested acquisition boundaries.
// Carry the actual typed contention beside that exact error until the outer
// acquisition has dropped partial leases. Never reconstruct a waiter from JSON.
thread_local! {
    static ACQUISITION: std::cell::RefCell<Vec<Option<LockAcquireError>>> = const {
        std::cell::RefCell::new(Vec::new())
    };
}
struct AcquisitionFrame;
impl Drop for AcquisitionFrame {
    fn drop(&mut self) {
        ACQUISITION.with(|frames| {
            frames.borrow_mut().pop();
        });
    }
}
fn diagnostic(error: &LockAcquireError) -> &str {
    match error {
        LockAcquireError::Busy(error)
        | LockAcquireError::Queued(error, _)
        | LockAcquireError::Other(error) => error,
    }
}

/// Retry only an OS contention result, never recovery, authorization or commit errors.
pub(crate) fn wait_for_lock<T>(
    wait: std::time::Duration,
    mut acquire: impl FnMut() -> Result<T, LockAcquireError>,
) -> Result<T, String> {
    wait_for_lock_cancel(wait, &|| false, &mut acquire)
}

pub(crate) fn wait_for_lock_cancel<T>(
    wait: std::time::Duration,
    cancelled: &dyn Fn() -> bool,
    mut acquire: impl FnMut() -> Result<T, LockAcquireError>,
) -> Result<T, String> {
    if ACQUISITION.with(|frames| !frames.borrow().is_empty()) {
        if cancelled() {
            return Err("maintenance lock wait cancelled".into());
        }
        return acquire().map_err(|error| {
            let message = diagnostic(&error).to_owned();
            if matches!(
                error,
                LockAcquireError::Busy(_) | LockAcquireError::Queued(_, _)
            ) {
                ACQUISITION.with(|frames| {
                    *frames.borrow_mut().last_mut().expect("active acquisition") = Some(error);
                });
            }
            message
        });
    }
    ACQUISITION.with(|frames| frames.borrow_mut().push(None));
    let _frame = AcquisitionFrame;
    let deadline = std::time::Instant::now() + wait;
    let mut timing = crate::timing::Span::new("maintenance.lock_wait", "wait_for_lock", None);
    let mut last_busy: Option<String> = None;
    loop {
        if cancelled() {
            timing.outcome("cancelled");
            return Err("maintenance lock wait cancelled".into());
        }
        if let Some(error) = &last_busy {
            if std::time::Instant::now() >= deadline {
                timing.outcome("timeout");
                let mut response = error_response(error);
                response["error"] = json!(format!(
                    "{}; lock wait exhausted after {} ms",
                    response["error"].as_str().unwrap_or(error),
                    wait.as_millis()
                ));
                return Err(if response["code"] == "maintenance_busy" {
                    response.to_string()
                } else {
                    response["error"].as_str().unwrap_or(error).to_owned()
                });
            }
        }
        timing.attempt();
        let mut result = acquire();
        let nested = ACQUISITION.with(|frames| frames.borrow_mut().last_mut().unwrap().take());
        if let (Err(LockAcquireError::Other(message)), Some(error)) = (&result, nested) {
            if message == diagnostic(&error) {
                result = Err(error);
            }
        }
        match result {
            Ok(value) => {
                if cancelled() {
                    timing.outcome("cancelled");
                    return Err("maintenance lock wait cancelled".into());
                }
                timing.outcome("acquired");
                return Ok(value);
            }
            Err(LockAcquireError::Busy(error)) if !wait.is_zero() => {
                last_busy = Some(error);
                let remaining = deadline.saturating_duration_since(std::time::Instant::now());
                std::thread::sleep(remaining.min(std::time::Duration::from_millis(10)));
            }
            Err(LockAcquireError::Queued(error, waiter)) if !wait.is_zero() => {
                last_busy = Some(error);
                // acquire() has returned: all partial transaction leases are gone.
                if let Err(error) = waiter.wait(deadline, cancelled) {
                    timing.outcome("error");
                    return Err(error);
                }
            }
            Err(error) => {
                timing.outcome(match &error {
                    LockAcquireError::Busy(_) | LockAcquireError::Queued(_, _) => "busy",
                    LockAcquireError::Other(_) => "error",
                });
                return Err(error.into());
            }
        }
    }
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod busy_contract_tests {
    use super::*;

    #[test]
    fn immediate_busy_and_explicit_wait_keep_structured_diagnostics() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("lock");
        let allow = |_: &Path, _: AccessMode| Ok(());
        let context = Context::new(&allow);
        let held = Sentinel::acquire(root.path(), &path, "fixture", &context).unwrap();
        for wait in [0, 15] {
            let mut attempts = 0;
            let started = std::time::Instant::now();
            let error = wait_for_lock::<()>(std::time::Duration::from_millis(wait), || {
                attempts += 1;
                Sentinel::acquire(root.path(), &path, "contender", &context).map(|_| ())
            })
            .unwrap_err();
            let response = error_response(&error);
            assert_eq!(response["code"], "maintenance_busy");
            assert_eq!(response["retryable"], true);
            assert_eq!(response["lock_path"], json!(path));
            assert!(response["owner"].is_null() || response["owner"]["pid"] == std::process::id());
            assert!(response["owner"].get("token").is_none());
            if wait == 0 {
                assert_eq!(attempts, 1);
            } else {
                assert!(started.elapsed() >= std::time::Duration::from_millis(wait));
                assert_eq!(
                    attempts, 1,
                    "queue on the handle instead of replaying acquisition"
                );
            }
        }
        held.release().unwrap();
        for error in [
            "permission denied (os error 33)",
            "OS lock busy: policy denial",
        ] {
            assert_eq!(error_response(error), json!({"error":error}));
        }
    }

    #[test]
    fn wait_policy_is_explicit_bounded_and_integral() {
        assert!(requested_wait(&json!({})).unwrap().is_zero());
        assert_eq!(
            requested_wait(&json!({"lock_wait_ms":600000}))
                .unwrap()
                .as_millis(),
            600000
        );
        for value in [
            json!(-1),
            json!(600001),
            json!(1.5),
            json!("5"),
            Value::Null,
        ] {
            assert!(requested_wait(&json!({"lock_wait_ms":value})).is_err());
        }
    }
}

#[cfg(unix)]
pub(crate) fn identity(file: &File) -> Result<Vec<u64>, String> {
    use std::os::unix::fs::MetadataExt;
    let m = file.metadata().map_err(|e| e.to_string())?;
    if !m.is_file() || m.nlink() != 1 {
        return Err("recovery requires a single-link plain file".into());
    }
    Ok(vec![m.dev(), m.ino()])
}

#[cfg(windows)]
pub(crate) fn identity(file: &File) -> Result<Vec<u64>, String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ID_INFO, FILE_STANDARD_INFO, FileIdInfo, FileStandardInfo,
        GetFileInformationByHandleEx,
    };
    let mut info = FILE_ID_INFO::default();
    let mut standard = FILE_STANDARD_INFO::default();
    if unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileIdInfo,
            (&mut info as *mut FILE_ID_INFO).cast(),
            std::mem::size_of_val(&info) as u32,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().to_string());
    }
    if unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileStandardInfo,
            (&mut standard as *mut FILE_STANDARD_INFO).cast(),
            std::mem::size_of_val(&standard) as u32,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().to_string());
    }
    if standard.NumberOfLinks != 1 || standard.Directory || standard.DeletePending {
        return Err("recovery requires a single-link plain file".into());
    }
    Ok(vec![
        info.VolumeSerialNumber,
        u64::from_le_bytes(info.FileId.Identifier[..8].try_into().unwrap()),
        u64::from_le_bytes(info.FileId.Identifier[8..].try_into().unwrap()),
    ])
}

struct Observation {
    identity: Vec<u64>,
    bytes: Vec<u8>,
}

fn observe(root: &Path, path: &Path, auth: Auth<'_>) -> Result<Observation, String> {
    observe_bounded(root, path, auth, MAX_BYTES)
}

fn observe_bounded(
    root: &Path,
    path: &Path,
    auth: Auth<'_>,
    bound: u64,
) -> Result<Observation, String> {
    let metadata = paths::checked_metadata(root, path, auth)?.ok_or("recovery file missing")?;
    if !metadata.is_file() || metadata.len() > bound {
        return Err("recovery requires a bounded plain file".into());
    }
    auth(path, AccessMode::Read)?;
    let file = File::open(path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > bound {
        return Err("recovery requires a bounded plain file".into());
    }
    let id = identity(&file)?;
    let mut bytes = Vec::new();
    file.take(bound + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > bound {
        return Err("recovery file exceeds bound".into());
    }
    paths::check(root, path, auth)?;
    auth(path, AccessMode::Read)?;
    final_plain_path(path)?;
    let current = File::open(path).map_err(|e| e.to_string())?;
    if identity(&current)? != id
        || current.metadata().map_err(|e| e.to_string())?.len() != bytes.len() as u64
    {
        return Err("recovery file replaced while reading".into());
    }
    Ok(Observation {
        identity: id,
        bytes,
    })
}

fn unchanged(root: &Path, path: &Path, old: &Observation, auth: Auth<'_>) -> Result<(), String> {
    let new = observe(root, path, auth)?;
    if new.identity != old.identity || new.bytes != old.bytes {
        return Err("recovery file identity or contents changed".into());
    }
    Ok(())
}

// Authorizers are executable callbacks and can change sibling paths. Collect
// every authorization first, then perform the final observations without more
// callbacks between those observations and the ordinary unlink.
fn final_boundary(
    root: &Path,
    expected: &[(&Path, &Observation)],
    guard: Option<&File>,
    auth: Auth<'_>,
) -> Result<(), String> {
    final_boundary_inner(root, expected, guard, true, None, auth)
}

fn final_boundary_inner(
    root: &Path,
    expected: &[(&Path, &Observation)],
    guard: Option<&File>,
    require_pending_absent: bool,
    held_lease: Option<&Sentinel<'_>>,
    auth: Auth<'_>,
) -> Result<(), String> {
    let guard_path = root.join("artifacts/maintenance/recovery.guard");
    let pending = root.join("artifacts/maintenance/manifest.pending");
    let mut paths = std::collections::BTreeSet::new();
    for (path, _) in expected {
        if !path.starts_with(root) {
            return Err("final recovery path escapes project".into());
        }
        paths.extend(path.ancestors().map(Path::to_owned));
    }
    if guard.is_some() {
        paths.extend(guard_path.ancestors().map(Path::to_owned));
        paths.extend(pending.ancestors().map(Path::to_owned));
    }
    if let Some(lease) = held_lease {
        if !lease.path.starts_with(root) {
            return Err("final recovery lease escapes project".into());
        }
        paths.extend(lease.path.ancestors().map(Path::to_owned));
    }
    for path in &paths {
        auth(path, AccessMode::Read)?;
    }
    for path in &paths {
        match fs::symlink_metadata(path) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err("final recovery link rejected".into());
                }
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if metadata.file_attributes() & 0x400 != 0 {
                        return Err("final recovery reparse path rejected".into());
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    for (path, original) in expected {
        let file = File::open(path).map_err(|e| e.to_string())?;
        if identity(&file)? != original.identity {
            return Err("final recovery file identity changed".into());
        }
        let mut bytes = Vec::new();
        file.take(original.bytes.len() as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes != original.bytes {
            return Err("final recovery file contents changed".into());
        }
    }
    if let Some(lease) = held_lease {
        // Windows byte-range locks reject reads through a second handle even
        // within this process. Reopen only to compare path identity; read
        // metadata through the handle that owns the exclusive OS lease.
        let current = File::open(&lease.path).map_err(|e| e.to_string())?;
        if identity(&lease._file)? != lease.observed.identity
            || identity(&current)? != lease.observed.identity
        {
            return Err("final recovery lease identity changed".into());
        }
        let mut reader = &*lease._file;
        reader.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        reader
            .take(lease.observed.bytes.len() as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes != lease.observed.bytes {
            return Err("final recovery lease contents changed".into());
        }
    }
    if let Some(guard) = guard {
        if require_pending_absent {
            match fs::symlink_metadata(&pending) {
                Ok(_) => return Err("manifest.pending requires separate recovery".into()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.to_string()),
            }
        }
        if identity(guard)? != identity(&File::open(guard_path).map_err(|e| e.to_string())?)? {
            return Err("recovery guard was replaced".into());
        }
    }
    Ok(())
}

fn pending_absent(root: &Path, auth: Auth<'_>) -> Result<(), String> {
    let pending = root.join("artifacts/maintenance/manifest.pending");
    if paths::checked_metadata(root, &pending, auth)?.is_some() {
        return Err("manifest.pending requires separate recovery".into());
    }
    Ok(())
}

// This is a persistent OS lock file, not another create-new sentinel. Closing
// the handle releases the OS lock; its directory entry must never be removed.
fn recovery_guard(root: &Path, auth: Auth<'_>) -> Result<File, String> {
    let path = root.join("artifacts/maintenance/recovery.guard");
    paths::check(root, &path, auth)?;
    auth(
        path.parent().ok_or("missing guard parent")?,
        AccessMode::Write,
    )?;
    auth(&path, AccessMode::Write)?;
    auth(&path, AccessMode::Read)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)
        .map_err(|e| e.to_string())?;
    wait_for_lock_cancel(auth.lock_wait.get(), &|| auth.cancelled(), || {
        file.try_lock().map_err(|error| match error {
            std::fs::TryLockError::WouldBlock => {
                busy_for_file(root, &path, "recovery.guard", auth, &file)
            }
            std::fs::TryLockError::Error(error) => LockAcquireError::Other(format!(
                "recovery guard acquisition failed: {} (recovery.guard): {error}",
                path.display()
            )),
        })
    })?;
    paths::check(root, &path, auth)?;
    auth(&path, AccessMode::Read)?;
    if identity(&file)? != identity(&File::open(&path).map_err(|e| e.to_string())?)? {
        return Err("recovery guard was replaced".into());
    }
    Ok(file)
}

// Fields drop in declaration order: close the OS handle before emitting timing.
struct TimedLock {
    file: File,
    timing: crate::timing::Span,
}
impl std::ops::Deref for TimedLock {
    type Target = File;
    fn deref(&self) -> &File {
        &self.file
    }
}
impl std::ops::DerefMut for TimedLock {
    fn deref_mut(&mut self) -> &mut File {
        &mut self.file
    }
}

/// Persistent OS lease; metadata never proves operation completion.
pub(crate) struct Sentinel<'a> {
    root: PathBuf,
    path: PathBuf,
    observed: Observation,
    _file: TimedLock,
    auth: Auth<'a>,
    verify_on_drop: bool,
}
pub(crate) fn final_plain_path(path: &Path) -> Result<(), String> {
    for ancestor in path.ancestors() {
        let m = fs::symlink_metadata(ancestor).map_err(|e| e.to_string())?;
        if m.file_type().is_symlink() {
            return Err("lock link ancestor rejected".into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if m.file_attributes() & 0x400 != 0 {
                return Err("lock reparse ancestor rejected".into());
            }
        }
        if ancestor != path && !m.is_dir() {
            return Err("lock requires directory ancestors".into());
        }
    }
    Ok(())
}
fn held_observation(
    root: &Path,
    path: &Path,
    file: &File,
    auth: Auth<'_>,
) -> Result<Observation, String> {
    paths::check(root, path, auth)?;
    auth(path, AccessMode::Read)?;
    final_plain_path(path)?;
    let current = File::open(path).map_err(|e| format!("lock.observe: {}: {e}", path.display()))?;
    let id = identity(file)?;
    if identity(&current)? != id {
        return Err("lock identity changed".into());
    }
    let mut reader = file;
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|e| format!("lock.observe: {}: {e}", path.display()))?;
    let mut bytes = Vec::new();
    reader
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("lock.observe: {}: {e}", path.display()))?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("lock metadata exceeds bound".into());
    }
    if identity(&File::open(path).map_err(|e| format!("lock.observe: {}: {e}", path.display()))?)?
        != id
    {
        return Err("lock replaced".into());
    }
    Ok(Observation {
        identity: id,
        bytes,
    })
}
fn os_metadata(bytes: &[u8]) -> bool {
    serde_json::from_slice::<Value>(bytes).is_ok_and(|v| {
        v["schema"] == 2
            && v["pid"].as_u64().is_some()
            && v["token"].as_str().is_some()
            && v["operation"].as_str().is_some()
            && v["acquired_at_ms"].as_u64().is_some()
    })
}
pub(crate) fn check_available(root: &Path, path: &Path, auth: Auth<'_>) -> Result<(), String> {
    if paths::checked_metadata(root, path, auth)?.is_none() {
        return Ok(());
    }
    auth(path, AccessMode::Read)?;
    let file = File::open(path).map_err(|e| e.to_string())?;
    wait_for_lock_cancel(auth.lock_wait.get(), &|| auth.cancelled(), || {
        file.try_lock_shared().map_err(|error| match error {
            std::fs::TryLockError::WouldBlock => {
                busy_for_file(root, path, "check_available", auth, &file)
            }
            std::fs::TryLockError::Error(error) => LockAcquireError::Other(format!(
                "shared lock acquisition failed: {} (check_available): {error}",
                path.display()
            )),
        })
    })?;
    // Windows byte-range locks also block reads through another handle. Read
    // metadata only after shared custody, so contention reaches the wait path.
    let original = held_observation(root, path, &file, auth)?;
    if !os_metadata(&original.bytes) {
        return Err("legacy or unknown lock requires explicit recovery".into());
    }
    let current = held_observation(root, path, &file, auth)?;
    if current.identity != original.identity || current.bytes != original.bytes {
        return Err("recovery file identity or contents changed".into());
    }
    Ok(())
}
impl<'a> Sentinel<'a> {
    pub(crate) fn acquire(
        root: &Path,
        path: &Path,
        operation: &str,
        auth: Auth<'a>,
    ) -> Result<Self, LockAcquireError> {
        if operation.is_empty()
            || operation.len() > 120
            || !operation
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_.:-".contains(&b))
        {
            return Err("bounded lock operation required".into());
        }
        paths::check(root, path, auth)?;
        auth(
            path.parent().ok_or("missing lock parent")?,
            AccessMode::Write,
        )?;
        auth(path, AccessMode::Write)?;
        auth(path, AccessMode::Read)?;
        let (file, created) = match OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(path)
        {
            Ok(file) => (file, true),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (
                OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(path)
                    .map_err(|e| format!("lock.acquire: {}: {e}", path.display()))?,
                false,
            ),
            Err(e) => {
                return Err(format!("lock.open: {} ({operation}): {e}", path.display()).into());
            }
        };
        file.try_lock().map_err(|error| match error {
            std::fs::TryLockError::WouldBlock => busy_for_file(root, path, operation, auth, &file),
            std::fs::TryLockError::Error(error) => LockAcquireError::Other(format!(
                "OS lock acquisition failed: {} ({operation}): {error}",
                path.display()
            )),
        })?;
        let mut timing = crate::timing::Span::new("maintenance.lock_hold", operation, Some(path));
        timing.attempt();
        timing.outcome("acquisition_failed");
        let mut file = TimedLock { file, timing };
        let id = identity(&file)?;
        let original = held_observation(root, path, &file, auth)?;
        if original.identity != id {
            return Err("lock identity changed during acquisition".into());
        }
        if !created && !os_metadata(&original.bytes) {
            return Err("legacy or unknown lock requires explicit recovery".into());
        }
        use std::hash::{BuildHasher, Hasher};
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let mut random = std::collections::hash_map::RandomState::new().build_hasher();
        random.write_u64(NEXT.fetch_add(1, Ordering::Relaxed));
        let token = format!(
            "{}-{}-{:016x}",
            std::process::id(),
            crate::now_ms()?,
            random.finish()
        );
        let bytes = serde_json::to_vec(&json!({"schema":2,"pid":std::process::id(),"token":token,
            "acquired_at_ms":crate::now_ms()?,"operation":operation}))
        .map_err(|e| e.to_string())?;
        if held_observation(root, path, &file, auth)?.bytes != original.bytes {
            return Err("lock metadata changed".into());
        }
        file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        file.set_len(0).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        let lease = Self {
            root: root.to_owned(),
            path: path.to_owned(),
            observed: Observation {
                identity: id,
                bytes,
            },
            _file: file,
            auth,
            verify_on_drop: true,
        };
        lease.verify()?;
        Ok(lease)
    }
    pub(crate) fn verify(&self) -> Result<(), String> {
        let current = held_observation(&self.root, &self.path, &self._file, self.auth)?;
        if current.identity != self.observed.identity || current.bytes != self.observed.bytes {
            return Err("lock owner changed".into());
        }
        Ok(())
    }
    pub(crate) fn owner(&self) -> Value {
        serde_json::from_slice(&self.observed.bytes).expect("serialized metadata")
    }
    pub(crate) fn release(self) -> Result<(), String> {
        self.verify()
    }
}
impl Drop for Sentinel<'_> {
    fn drop(&mut self) {
        // Always close; never unlink the inode on which another owner may wait.
        if self.verify_on_drop {
            let result = self.verify();
            self._file.timing.outcome(if result.is_ok() {
                "verified"
            } else {
                "verification_failed"
            });
        } else {
            self._file.timing.outcome("verification_skipped");
        }
    }
}

/// Exclusive custody for observation of an existing schema-2 sentinel.
/// Its unchanged metadata describes the last diagnostic writer, not this
/// observer or proof of a running operation. No owner or mutation API escapes.
pub(crate) struct ObservationLock<'a> {
    lease: Sentinel<'a>,
}

impl<'a> ObservationLock<'a> {
    pub(crate) fn acquire(
        root: &Path,
        path: &Path,
        operation: &str,
        auth: Auth<'a>,
    ) -> Result<Self, LockAcquireError> {
        if operation.is_empty()
            || operation.len() > 120
            || !operation
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_.:-".contains(&b))
        {
            return Err("bounded lock operation required".into());
        }
        paths::check(root, path, auth)?;
        auth(
            path.parent().ok_or("missing lock parent")?,
            AccessMode::Write,
        )?;
        auth(path, AccessMode::Write)?;
        auth(path, AccessMode::Read)?;
        final_plain_path(path)?;
        // Preserve the existing handle access and authorization policy. Opening
        // for write access does not write: this path never creates, repairs,
        // truncates, writes, or syncs metadata, and the handle remains private.
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
            .map_err(|e| format!("lock.observe.open: {} ({operation}): {e}", path.display()))?;
        file.try_lock().map_err(|error| match error {
            std::fs::TryLockError::WouldBlock => busy_for_file(root, path, operation, auth, &file),
            std::fs::TryLockError::Error(error) => LockAcquireError::Other(format!(
                "OS lock acquisition failed: {} ({operation}): {error}",
                path.display()
            )),
        })?;
        // Keep the same exclusive-hold timing label as a writer so observations
        // remain comparable; custody here carries no metadata-publication work.
        let mut timing = crate::timing::Span::new("maintenance.lock_hold", operation, Some(path));
        timing.attempt();
        timing.outcome("acquisition_failed");
        let file = TimedLock { file, timing };
        let id = identity(&file)?;
        let observed = held_observation(root, path, &file, auth)?;
        if observed.identity != id {
            return Err("lock identity changed during acquisition".into());
        }
        if !os_metadata(&observed.bytes) {
            return Err("legacy or unknown lock requires explicit recovery".into());
        }
        let lease = Sentinel {
            root: root.to_owned(),
            path: path.to_owned(),
            observed,
            _file: file,
            auth,
            verify_on_drop: true,
        };
        lease.verify()?;
        Ok(Self { lease })
    }

    pub(crate) fn release(self) -> Result<(), String> {
        self.lease.release()
    }
}

#[cfg(windows)]
pub(crate) fn owner_absent(pid: u32) -> Result<(), String> {
    use windows_sys::Win32::Foundation::{
        CloseHandle, ERROR_INVALID_PARAMETER, WAIT_FAILED, WAIT_OBJECT_0, WAIT_TIMEOUT,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, WaitForSingleObject,
    };
    // A retained process handle can keep an exited PID queryable. A signaled
    // process object clears only this veto; recovery still requires independent
    // exact stopped-tree evidence and all ownership and mutation fences.
    let handle = unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
            0,
            pid,
        )
    };
    if !handle.is_null() {
        let state = unsafe { WaitForSingleObject(handle, 0) };
        let wait_error = std::io::Error::last_os_error();
        if unsafe { CloseHandle(handle) } == 0 {
            return Err(format!(
                "owner PID handle close unknown: {}",
                std::io::Error::last_os_error()
            ));
        }
        return match state {
            WAIT_OBJECT_0 => Ok(()),
            WAIT_TIMEOUT => Err("live owner PID vetoes recovery".into()),
            WAIT_FAILED => Err(format!("owner PID wait status unknown: {wait_error}")),
            other => Err(format!("owner PID wait status unknown: {other}")),
        };
    }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(ERROR_INVALID_PARAMETER as i32) && pid != 0 {
        Ok(())
    } else {
        Err(format!("owner PID status unknown: {error}"))
    }
}

#[cfg(unix)]
pub(crate) fn owner_absent(pid: u32) -> Result<(), String> {
    unsafe extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    let pid = i32::try_from(pid)
        .ok()
        .filter(|pid| *pid > 0)
        .ok_or("invalid owner PID")?;
    if unsafe { kill(pid, 0) } == 0 {
        return Err("live owner PID vetoes recovery".into());
    }
    let error = std::io::Error::last_os_error();
    // ESRCH is 3 on the supported Linux and macOS targets. EPERM and all other
    // query failures remain unknown and therefore refuse recovery.
    if error.raw_os_error() == Some(3) {
        Ok(())
    } else {
        Err(format!("owner PID status unknown: {error}"))
    }
}

fn owner(bytes: &[u8]) -> Result<(Option<u32>, Option<String>), String> {
    let text = std::str::from_utf8(bytes)
        .map_err(|e| e.to_string())?
        .trim();
    if text.is_empty() {
        return Ok((None, None));
    }
    if let Some(pid) = text.strip_prefix("pid=") {
        return Ok((
            Some(pid.parse::<u32>().map_err(|_| "invalid legacy PID")?),
            None,
        ));
    }
    let value: Value = serde_json::from_str(text).map_err(|_| "unrecognized sentinel metadata")?;
    if value["schema"] != 1 || value["acquired_at_ms"].as_u64().is_none() {
        return Err("unsupported sentinel metadata".into());
    }
    let pid = value["pid"]
        .as_u64()
        .and_then(|v| u32::try_from(v).ok())
        .filter(|v| *v > 0)
        .ok_or("invalid sentinel PID")?;
    string(&value, "operation")?;
    Ok((Some(pid), Some(string(&value, "token")?.to_owned())))
}

/// Recover exactly one abandoned sentinel using independent, caller-verified
/// producer-stop evidence. This does not change manifests or execution results.
pub fn recover_lock(
    root: &Path,
    request: Value,
    authorize: &dyn Fn(&Path, AccessMode) -> Result<(), String>,
) -> Result<Value, String> {
    let context = Context::new(authorize);
    context.lock_wait.set(requested_wait(&request)?);
    recover(root, &request, &context)
}

fn recover(root: &Path, request: &Value, auth: Auth<'_>) -> Result<Value, String> {
    if request["operation"] != "recover_lock" || request["producer_stopped_verified"] != true {
        return Err("explicit recover_lock producer-stop attestation required".into());
    }
    for key in ["reason", "evidence_ref", "receipt_ref"] {
        if string(request, key)?.trim().is_empty() {
            return Err(format!("blank {key}"));
        }
    }
    paths::check(root, root, auth)?;
    let root = dunce::canonicalize(root).map_err(|e| e.to_string())?;
    paths::check(&root, &root, auth)?;
    let relative = match string(request, "lock_kind")? {
        "maintenance" => "artifacts/maintenance/maintenance.lock",
        "catalog" => "artifacts/maintenance/lifecycles/catalog.lock",
        "run_claim" => "artifacts/maintenance/lifecycles/.run-claim.lock",
        _ => return Err("unknown recovery lock kind".into()),
    };
    let target = root.join(relative);
    let evidence_root = root.join("artifacts/maintenance/evidence");
    let evidence = paths::resolve(&root, Path::new(string(request, "evidence_ref")?))?;
    let receipt = paths::resolve(&root, Path::new(string(request, "receipt_ref")?))?;
    if !evidence.starts_with(&evidence_root)
        || !receipt.starts_with(&evidence_root)
        || evidence == evidence_root
        || receipt == evidence_root
        || evidence == receipt
    {
        return Err(
            "distinct evidence and receipt plain files must be inside maintenance/evidence".into(),
        );
    }
    let guard = recovery_guard(&root, auth)?;
    pending_absent(&root, auth)?;
    let original = observe(&root, &target, auth)?;
    if digest(&original.bytes) != string(request, "expected_lock_sha256")? {
        return Err("sentinel SHA-256 differs".into());
    }
    let (pid, token) = owner(&original.bytes)?;
    let expected_token = match request.get("expected_token") {
        Some(Value::Null) => None,
        Some(Value::String(token)) if !token.is_empty() => Some(token.clone()),
        _ => return Err("expected_token must be a nonempty string or explicit null".into()),
    };
    if token != expected_token {
        return Err("sentinel token differs".into());
    }
    if let Some(pid) = pid {
        owner_absent(pid)?;
    }
    let evidence_observed = observe(&root, &evidence, auth)?;
    if digest(&evidence_observed.bytes) != string(request, "evidence_sha256")? {
        return Err("producer-stop evidence SHA-256 differs".into());
    }
    paths::check(&root, &receipt, auth)?;
    auth(
        receipt.parent().ok_or("missing receipt parent")?,
        AccessMode::Write,
    )?;
    auth(&receipt, AccessMode::Write)?;
    let result = json!({"schema":1,"operation":"recover_lock","lock_kind":request["lock_kind"],
        "lock_ref":relative,"expected_lock_sha256":digest(&original.bytes),"expected_token":token,
        "owner_pid":pid,"producer_stopped_verified":true,"reason":request["reason"],
        "evidence_ref":request["evidence_ref"],"evidence_sha256":digest(&evidence_observed.bytes),
        "evidence":String::from_utf8(evidence_observed.bytes.clone()).map_err(|_| "evidence must be UTF-8 text")?,
        "sentinel":String::from_utf8(original.bytes.clone()).map_err(|e| e.to_string())?,
        "recorded_at_ms":crate::now_ms()?,"receipt_ref":request["receipt_ref"]});
    let bytes = serde_json::to_vec_pretty(&result).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("recovery receipt exceeds bound".into());
    }
    unchanged(&root, &evidence, &evidence_observed, auth)?;
    unchanged(&root, &target, &original, auth)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&receipt)
        .map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    let mut permissions = file.metadata().map_err(|e| e.to_string())?.permissions();
    permissions.set_readonly(true);
    auth(&receipt, AccessMode::Write)?;
    file.set_permissions(permissions)
        .map_err(|e| e.to_string())?;
    let receipt_observed = Observation {
        identity: identity(&file)?,
        bytes,
    };
    drop(file);
    auth(
        target.parent().ok_or("missing lock parent")?,
        AccessMode::Write,
    )?;
    auth(&target, AccessMode::Write)?;
    pending_absent(&root, auth)?;
    unchanged(&root, &receipt, &receipt_observed, auth)?;
    unchanged(&root, &evidence, &evidence_observed, auth)?;
    if let Some(pid) = pid {
        owner_absent(pid)?;
    }
    final_boundary(
        &root,
        &[
            (&target, &original),
            (&evidence, &evidence_observed),
            (&receipt, &receipt_observed),
        ],
        Some(&guard),
        auth,
    )?;
    fs::remove_file(&target)
        .map_err(|e| format!("ordinary sentinel removal failed; receipt retained: {e}"))?;
    Ok(
        json!({"status":"recovered","lock_kind":request["lock_kind"],"receipt_ref":request["receipt_ref"],
        "receipt_sha256":digest(&receipt_observed.bytes)}),
    )
}

fn sha256_value(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
}

/// Admit only an uncommitted protection-revision refresh. Compare the raw JSON
/// as well as decoding State: unknown fields must never disappear in recovery.
fn refresh_delta(base: &[u8], pending: &[u8], group_id: &str) -> Result<Value, String> {
    for bytes in [base, pending] {
        let value: Value = serde_json::from_slice(bytes).map_err(|error| error.to_string())?;
        if value.get("storage_format").is_some() {
            return Err(
                "partitioned or unknown storage requires independent pending recovery".into(),
            );
        }
    }
    let base_state: crate::State = serde_json::from_slice(base).map_err(|e| e.to_string())?;
    let next_state: crate::State = serde_json::from_slice(pending).map_err(|e| e.to_string())?;
    let base: Value = serde_json::from_slice(base).map_err(|e| e.to_string())?;
    let mut next: Value = serde_json::from_slice(pending).map_err(|e| e.to_string())?;
    for state in [&base, &next] {
        if !state.is_object()
            || state["revision"].as_u64().is_none()
            || !state["items"].is_object()
            || !state["groups"].is_object()
            || !state["runs"].is_object()
            || !state["decisions"].is_array()
        {
            return Err("invalid maintenance State schema".into());
        }
    }
    if base_state.revision.checked_add(1) != Some(next_state.revision) {
        return Err("pending revision must be exactly base revision plus one".into());
    }
    let group = base_state
        .groups
        .get(group_id)
        .ok_or("unknown refresh group")?;
    let next_group = next_state
        .groups
        .get(group_id)
        .ok_or("pending refresh group missing")?;
    if group["id"] != group_id || group["membership_source_format"] != "producer_registry_v1" {
        return Err("refresh requires the named existing producer_registry_v1 group".into());
    }
    let members = group["members"]
        .as_array()
        .ok_or("invalid refresh membership")?;
    if members.is_empty() || members.len() > 200 {
        return Err("refresh requires 1..200 existing members".into());
    }
    let mut ids = std::collections::BTreeSet::new();
    let mut changes = Vec::new();
    let revision = &next_group["protection_revision"];
    let previous_revision = group.get("protection_revision");
    if !sha256_value(revision) || previous_revision.is_some_and(|value| !sha256_value(value)) {
        return Err("refresh protection revisions must be SHA-256 values".into());
    }
    for member in members {
        let id = member.as_str().ok_or("invalid refresh member id")?;
        if !ids.insert(id) {
            return Err("duplicate refresh member".into());
        }
        let before = base_state.items.get(id).ok_or("refresh member missing")?;
        let after = next_state
            .items
            .get(id)
            .ok_or("pending refresh member missing")?;
        if before["id"] != id
            || before["lifecycle_group_id"] != group_id
            || after["protection_revision"] != *revision
            || before.get("protection_revision") != previous_revision
        {
            return Err("inconsistent refresh member identity or protection revision".into());
        }
        if before.get("protection_revision") != after.get("protection_revision") {
            changes.push(json!({"section":"items","id":id,
                "before_present":before.get("protection_revision").is_some(),
                "before":before.get("protection_revision"),"pending":after["protection_revision"]}));
        }
        if let Some(previous) = previous_revision {
            next["items"][id]["protection_revision"] = previous.clone();
        } else {
            next["items"][id]
                .as_object_mut()
                .ok_or("invalid refresh member")?
                .remove("protection_revision");
        }
    }
    // Reject orphaned back-references and cross-group membership ambiguity.
    for (id, item) in &base_state.items {
        if item["lifecycle_group_id"] == group_id && !ids.contains(id.as_str()) {
            return Err("refresh group has an unlisted member".into());
        }
    }
    for (other_id, other) in &base_state.groups {
        if other_id != group_id
            && other["members"].as_array().is_some_and(|members| {
                members
                    .iter()
                    .any(|id| id.as_str().is_some_and(|id| ids.contains(id)))
            })
        {
            return Err("refresh member belongs to multiple groups".into());
        }
    }
    if previous_revision != Some(revision) {
        changes.push(json!({"section":"groups","id":group_id,
            "before_present":previous_revision.is_some(),"before":previous_revision,"pending":revision}));
    }
    if let Some(previous) = previous_revision {
        next["groups"][group_id]["protection_revision"] = previous.clone();
    } else {
        next["groups"][group_id]
            .as_object_mut()
            .ok_or("invalid refresh group")?
            .remove("protection_revision");
    }
    next["revision"] = base["revision"].clone();
    if changes.is_empty() || next != base {
        return Err("pending transaction is not exclusively a protection_revision refresh".into());
    }
    Ok(json!(changes))
}

/// Materialize only supported pairs and pin every immutable input for the final
/// callback boundary. Hash binding also rejects transient callback substitutions
/// during the native partitioned reader, before any discard receipt is created.
fn refresh_snapshots(
    root: &Path,
    original: &Observation,
    pending: &Observation,
    auth: Auth<'_>,
) -> Result<(Vec<u8>, Vec<u8>, Vec<(PathBuf, Observation)>), String> {
    let base: Value = serde_json::from_slice(&original.bytes).map_err(|e| e.to_string())?;
    let next: Value = serde_json::from_slice(&pending.bytes).map_err(|e| e.to_string())?;
    match (base.get("storage_format"), next.get("storage_format")) {
        (None, None) => return Ok((original.bytes.clone(), pending.bytes.clone(), Vec::new())),
        (Some(a), Some(b)) if a == "partitioned-v1" && b == "partitioned-v1" => {}
        _ => return Err("mixed or unknown storage requires independent pending recovery".into()),
    }
    let mut hashes = std::collections::BTreeSet::new();
    for index in [&base, &next] {
        for section in ["items", "groups", "runs"] {
            for reference in index[section]
                .as_object()
                .ok_or("invalid state index section")?
                .values()
            {
                let hash = reference
                    .as_str()
                    .filter(|hash| {
                        hash.len() == 64
                            && hash
                                .bytes()
                                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                    })
                    .ok_or("invalid state record hash reference")?;
                hashes.insert(hash.to_owned());
            }
        }
        for reference in index["decisions"]
            .as_array()
            .ok_or("invalid state index decisions")?
        {
            let hash = reference
                .as_str()
                .filter(|hash| {
                    hash.len() == 64
                        && hash
                            .bytes()
                            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                })
                .ok_or("invalid state record hash reference")?;
            hashes.insert(hash.to_owned());
        }
    }
    // Two snapshots each have at most 64 live buckets; never capture arbitrary
    // directory contents or an unbounded collection before reader validation.
    if hashes.len() > 128 {
        return Err("refresh recovery state record count exceeds bound".into());
    }
    let directory = root.join("artifacts/maintenance/state-records");
    let marker = directory.join(".owner.json");
    let marker_observed = observe(root, &marker, auth)?;
    let marker_value: Value =
        serde_json::from_slice(&marker_observed.bytes).map_err(|e| e.to_string())?;
    if marker_value != json!({"schema":1,"owner":"azrael-project-maintenance/state-records"}) {
        return Err("unknown state record owner marker".into());
    }
    let mut total = marker_observed.bytes.len() as u64;
    let mut observed = vec![(marker, marker_observed)];
    for hash in hashes {
        let path = directory.join(format!("{hash}.json"));
        let remaining = (MAX_STATE_BYTES * 2 + MAX_BYTES)
            .checked_sub(total)
            .ok_or("refresh recovery aggregate state exceeds bound")?;
        let snapshot = observe_bounded(root, &path, auth, MAX_STATE_BYTES.min(remaining))?;
        if digest(&snapshot.bytes) != hash {
            return Err("refresh recovery state record SHA-256 differs".into());
        }
        total += snapshot.bytes.len() as u64;
        observed.push((path, snapshot));
    }
    let mut logical = Vec::new();
    for index in [&base, &next] {
        let state = crate::partitioned_storage::read(root, index, auth)?;
        let bytes = serde_json::to_vec(&state).map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_STATE_BYTES {
            return Err("refresh recovery logical state exceeds bound".into());
        }
        logical.push(bytes);
    }
    let next = logical.pop().ok_or("missing pending logical state")?;
    let base = logical.pop().ok_or("missing base logical state")?;
    Ok((base, next, observed))
}

/// Explicitly discard one narrowly validated uncommitted refresh snapshot.
/// The manifest is never opened for writing, restored, renamed or rewritten.
pub fn recover_refresh_pending(
    root: &Path,
    request: Value,
    authorize: &dyn Fn(&Path, AccessMode) -> Result<(), String>,
) -> Result<Value, String> {
    let context = Context::new(authorize);
    context.lock_wait.set(requested_wait(&request)?);
    let auth = &context;
    if request["operation"] != "recover_refresh_pending"
        || request["producer_stopped_verified"] != true
    {
        return Err("explicit recover_refresh_pending producer-stop attestation required".into());
    }
    for key in ["group_id", "reason", "evidence_ref", "receipt_ref"] {
        if string(&request, key)?.trim().is_empty() {
            return Err(format!("blank {key}"));
        }
    }
    let pid = request["producer_pid"]
        .as_u64()
        .and_then(|pid| u32::try_from(pid).ok())
        .filter(|pid| *pid > 0)
        .ok_or("valid producer_pid required")?;
    for key in [
        "expected_manifest_sha256",
        "expected_pending_sha256",
        "evidence_sha256",
    ] {
        if !sha256_value(&request[key]) {
            return Err(format!("valid {key} required"));
        }
    }
    paths::check(root, root, auth)?;
    let root = dunce::canonicalize(root).map_err(|e| e.to_string())?;
    paths::check(&root, &root, auth)?;
    let directory = root.join("artifacts/maintenance");
    let manifest = directory.join("manifest.json");
    let pending = directory.join("manifest.pending");
    let evidence_root = directory.join("evidence");
    let evidence = paths::resolve(&root, Path::new(string(&request, "evidence_ref")?))?;
    let receipt = paths::resolve(&root, Path::new(string(&request, "receipt_ref")?))?;
    if !evidence.starts_with(&evidence_root)
        || !receipt.starts_with(&evidence_root)
        || evidence == evidence_root
        || receipt == evidence_root
        || evidence == receipt
    {
        return Err(
            "distinct evidence and receipt plain files must be inside maintenance/evidence".into(),
        );
    }
    owner_absent(pid)?;
    // Waiting is explicit and applies only to acquisition. Use the recovery order and
    // retain the persistent lock inode throughout this state transaction.
    let guard = recovery_guard(&root, auth)?;
    let mut lease = wait_for_lock_cancel(auth.lock_wait.get(), &|| auth.cancelled(), || {
        Sentinel::acquire(
            &root,
            &directory.join("maintenance.lock"),
            "recover_refresh_pending",
            auth,
        )
    })?;
    // This operation verifies the held lease in its final callback boundary.
    // Dropping it must not invoke more callbacks after that boundary.
    lease.verify_on_drop = false;
    let original = observe_bounded(&root, &manifest, auth, MAX_STATE_BYTES)?;
    let uncommitted = observe_bounded(&root, &pending, auth, MAX_STATE_BYTES)?;
    if digest(&original.bytes) != string(&request, "expected_manifest_sha256")?
        || digest(&uncommitted.bytes) != string(&request, "expected_pending_sha256")?
    {
        return Err("manifest or pending SHA-256 differs".into());
    }
    let (base_bytes, pending_bytes, state_observed) =
        refresh_snapshots(&root, &original, &uncommitted, auth)?;
    let changes = refresh_delta(&base_bytes, &pending_bytes, string(&request, "group_id")?)?;
    let evidence_observed = observe(&root, &evidence, auth)?;
    if digest(&evidence_observed.bytes) != string(&request, "evidence_sha256")? {
        return Err("producer-stop evidence SHA-256 differs".into());
    }
    let evidence_text =
        std::str::from_utf8(&evidence_observed.bytes).map_err(|_| "evidence must be UTF-8 text")?;
    if evidence_text.trim().is_empty() {
        return Err("nonblank independent producer-stop evidence required".into());
    }
    let base: Value = serde_json::from_slice(&base_bytes).map_err(|e| e.to_string())?;
    let result = json!({"schema":1,"operation":"recover_refresh_pending",
        "status":"authorized_discard_attempt","group_id":request["group_id"],
        "expected_manifest_sha256":request["expected_manifest_sha256"],
        "expected_pending_sha256":request["expected_pending_sha256"],
        "base_revision":base["revision"],"pending_revision":base["revision"].as_u64().unwrap() + 1,
        "changed_protection_revisions":changes,"producer_pid":pid,
        "producer_stopped_verified":true,"reason":request["reason"],
        "evidence_ref":request["evidence_ref"],"evidence_sha256":request["evidence_sha256"],
        "evidence":evidence_text,"receipt_ref":request["receipt_ref"],"recorded_at_ms":crate::now_ms()?});
    let bytes = serde_json::to_vec_pretty(&result).map_err(|e| e.to_string())?;
    // Evidence can expand under JSON escaping, but the receipt never embeds State.
    if bytes.len() as u64 > 1024 * 1024 {
        return Err("refresh recovery receipt exceeds bound".into());
    }
    paths::check(&root, &receipt, auth)?;
    auth(
        receipt.parent().ok_or("missing receipt parent")?,
        AccessMode::Write,
    )?;
    auth(&receipt, AccessMode::Write)?;
    auth(&directory, AccessMode::Write)?;
    auth(&pending, AccessMode::Write)?;
    let mut expected = vec![
        (&manifest, &original),
        (&pending, &uncommitted),
        (&evidence, &evidence_observed),
    ];
    expected.extend(
        state_observed
            .iter()
            .map(|(path, observation)| (path, observation)),
    );
    let expected: Vec<(&Path, &Observation)> = expected
        .into_iter()
        .map(|(path, observation)| (path.as_path(), observation))
        .collect();
    final_boundary_inner(&root, &expected, Some(&guard), false, Some(&lease), auth)?;
    final_plain_path(receipt.parent().ok_or("missing receipt parent")?)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&receipt)
        .map_err(|e| format!("create-new refresh recovery receipt failed: {e}"))?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    let mut permissions = file.metadata().map_err(|e| e.to_string())?.permissions();
    permissions.set_readonly(true);
    auth(&receipt, AccessMode::Write)?;
    file.set_permissions(permissions)
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    let receipt_observed = Observation {
        identity: identity(&file)?,
        bytes,
    };
    drop(file);
    auth(&directory, AccessMode::Write)?;
    auth(&pending, AccessMode::Write)?;
    let mut expected_with_receipt = expected.clone();
    expected_with_receipt.push((&receipt, &receipt_observed));
    final_boundary_inner(
        &root,
        &expected_with_receipt,
        Some(&guard),
        false,
        Some(&lease),
        auth,
    )?;
    owner_absent(pid)?;
    fs::remove_file(&pending).map_err(|e| {
        format!("ordinary pending discard failed; authorized-attempt receipt retained: {e}")
    })?;
    expected_with_receipt.retain(|(path, _)| *path != pending.as_path());
    final_boundary_inner(
        &root,
        &expected_with_receipt,
        Some(&guard),
        true,
        Some(&lease),
        auth,
    )?;
    Ok(
        json!({"status":"discarded","operation":"recover_refresh_pending",
        "group_id":request["group_id"],"manifest_sha256":digest(&original.bytes),
        "receipt_ref":request["receipt_ref"],"receipt_sha256":digest(&receipt_observed.bytes)}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn final_recovery_boundary_reads_metadata_through_the_locked_owner_handle() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("artifacts/maintenance")).unwrap();
        let allow = |_: &Path, _: AccessMode| Ok(());
        let context = Context::new(&allow);
        let guard = recovery_guard(root.path(), &context).unwrap();
        let path = root.path().join("artifacts/maintenance/maintenance.lock");
        let mut lease = Sentinel::acquire(root.path(), &path, "recovery-test", &context).unwrap();
        lease.verify_on_drop = false;
        // Both files remain exclusively OS-locked. A new-handle content read
        // would fail with Windows ERROR_LOCK_VIOLATION (33).
        final_boundary_inner(root.path(), &[], Some(&guard), true, Some(&lease), &context).unwrap();
        // Identity alone is insufficient for the metadata-bearing lease.
        let mut writer = &*lease._file;
        writer.seek(SeekFrom::Start(0)).unwrap();
        writer
            .write_all(&vec![b' '; lease.observed.bytes.len()])
            .unwrap();
        writer.sync_all().unwrap();
        let error =
            final_boundary_inner(root.path(), &[], Some(&guard), true, Some(&lease), &context)
                .unwrap_err();
        assert!(error.contains("lease contents changed"), "{error}");
    }

    #[test]
    fn lock_wait_distinguishes_typed_contention_and_stops_before_expired_retry() {
        let mut attempts = 0;
        let error = wait_for_lock(std::time::Duration::from_millis(5), || {
            attempts += 1;
            if attempts == 1 {
                Err(LockAcquireError::Busy("OS lock busy: fixture".into()))
            } else {
                Ok(())
            }
        })
        .unwrap_err();
        assert_eq!(attempts, 1, "must not acquire after the wait deadline");
        assert!(error.contains("lock wait exhausted after 5 ms"));

        let mut attempts = 0;
        let error = wait_for_lock::<()>(std::time::Duration::from_secs(5), || {
            attempts += 1;
            Err(LockAcquireError::Other(
                "OS lock busy: policy denial".into(),
            ))
        })
        .unwrap_err();
        assert_eq!(attempts, 1, "error wording must not authorize a retry");
        assert_eq!(error, "OS lock busy: policy denial");
    }

    #[test]
    fn nested_availability_returns_partial_leases_before_queued_wait() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("catalog.lock");
        let partial = root.path().join("maintenance.lock");
        let allow = |_: &Path, _: AccessMode| Ok(());
        let context = Context::new(&allow);
        Sentinel::acquire(root.path(), &path, "seed", &context)
            .unwrap()
            .release()
            .unwrap();
        Sentinel::acquire(root.path(), &partial, "seed", &context)
            .unwrap()
            .release()
            .unwrap();
        let owner = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .unwrap();
        owner.try_lock().unwrap();
        let probe = partial.clone();
        let (started, ready) = std::sync::mpsc::channel();
        let holder = std::thread::spawn(move || {
            ready.recv().unwrap();
            std::thread::sleep(std::time::Duration::from_millis(50));
            let file = OpenOptions::new()
                .read(true)
                .write(true)
                .open(probe)
                .unwrap();
            // Waiting with the partial maintenance lease would deadlock here.
            file.try_lock().unwrap();
            std::thread::sleep(std::time::Duration::from_millis(80));
            drop(file);
            drop(owner);
        });
        context
            .lock_wait
            .set(std::time::Duration::from_millis(600_000));
        let mut attempts = 0;
        let result = wait_for_lock(std::time::Duration::from_secs(2), || {
            attempts += 1;
            let partial = Sentinel::acquire(root.path(), &partial, "partial", &context)?;
            if attempts == 1 {
                started.send(()).unwrap();
            }
            check_available(root.path(), &path, &context)?;
            Ok(partial)
        });
        holder.join().unwrap();
        result.unwrap().release().unwrap();
        assert_eq!(
            attempts, 2,
            "one failed transaction and one fresh acquisition"
        );
    }

    #[test]
    fn queued_wait_cancels_without_reacquiring_or_changing_owner() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("lock");
        let allow = |_: &Path, _: AccessMode| Ok(());
        let context = Context::new(&allow);
        let held = Sentinel::acquire(root.path(), &path, "owner", &context).unwrap();
        let original = held.owner();
        let started = std::time::Instant::now();
        let mut attempts = 0;
        let error = wait_for_lock_cancel(
            std::time::Duration::from_millis(600_000),
            &|| started.elapsed() >= std::time::Duration::from_millis(30),
            || {
                attempts += 1;
                Sentinel::acquire(root.path(), &path, "contender", &context)
            },
        )
        .err()
        .unwrap();
        assert!(error.contains("cancelled"), "{error}");
        assert_eq!(attempts, 1);
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
        assert_eq!(held.owner(), original);
        held.release().unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn owner_veto_distinguishes_live_and_exited_process_with_retained_handle() {
        use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
        use std::process::Stdio;
        use windows_sys::Win32::Foundation::WAIT_OBJECT_0;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
            WaitForSingleObject,
        };

        assert!(owner_absent(std::process::id()).is_err());
        let mut child = codex_utils_process::background_command("cmd.exe")
            .args(["/d", "/c", "set /p fixture_wait= & exit /b 0"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let pid = child.id();
        let handle = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                0,
                pid,
            )
        };
        assert!(!handle.is_null());
        let retained = unsafe { OwnedHandle::from_raw_handle(handle) };
        assert!(owner_absent(pid).is_err());
        drop(child.stdin.take());
        assert!(child.wait().unwrap().success());
        assert_eq!(
            unsafe { WaitForSingleObject(retained.as_raw_handle(), 0) },
            WAIT_OBJECT_0
        );
        // Keep this process object queryable while exercising the recovery veto.
        owner_absent(pid).unwrap();
        drop(retained);
    }
    #[test]
    fn os_release_keeps_inode_and_legacy_markers_are_not_acquired() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("lock");
        let allow = |_: &Path, _: AccessMode| Ok(());
        let context = Context::new(&allow);
        assert!(ObservationLock::acquire(root.path(), &path, "missing", &context).is_err());
        assert!(!path.exists());
        let lease = Sentinel::acquire(root.path(), &path, "test", &context).unwrap();
        assert_eq!(lease.owner()["schema"], 2);
        assert!(Sentinel::acquire(root.path(), &path, "contender", &context).is_err());
        assert!(ObservationLock::acquire(root.path(), &path, "observer", &context).is_err());
        let error = check_available(root.path(), &path, &context).unwrap_err();
        let response = error_response(&error);
        assert_eq!(response["code"], "maintenance_busy", "{error}");
        assert_eq!(response["lock_path"], json!(path));
        assert_eq!(response["retryable"], true);
        lease.release().unwrap();
        assert!(path.exists());
        check_available(root.path(), &path, &context).unwrap();
        // Prevent observers acquiring writer capabilities or rewriting diagnostics.
        let bytes = fs::read(&path).unwrap();
        let id = identity(&File::open(&path).unwrap()).unwrap();
        let observer = ObservationLock::acquire(root.path(), &path, "observer", &context).unwrap();
        let during = held_observation(root.path(), &path, &observer.lease._file, &context).unwrap();
        assert_eq!(during.bytes, bytes);
        assert_eq!(during.identity, id);
        assert!(Sentinel::acquire(root.path(), &path, "writer", &context).is_err());
        assert!(ObservationLock::acquire(root.path(), &path, "second", &context).is_err());
        observer.release().unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(identity(&File::open(&path).unwrap()).unwrap(), id);
        drop(ObservationLock::acquire(root.path(), &path, "drop", &context).unwrap());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(identity(&File::open(&path).unwrap()).unwrap(), id);
        Sentinel::acquire(root.path(), &path, "again", &context)
            .unwrap()
            .release()
            .unwrap();
        for bytes in ["", "malformed", r#"{"schema":1}"#] {
            fs::write(&path, bytes).unwrap();
            assert!(check_available(root.path(), &path, &context).is_err());
            assert!(Sentinel::acquire(root.path(), &path, "legacy", &context).is_err());
            assert!(ObservationLock::acquire(root.path(), &path, "legacy", &context).is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), bytes);
        }
    }
    #[test]
    fn availability_waits_for_exclusive_owner_before_reading_metadata() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("lock");
        let allow = |_: &Path, _: AccessMode| Ok(());
        let context = Context::new(&allow);
        Sentinel::acquire(root.path(), &path, "initial", &context)
            .unwrap()
            .release()
            .unwrap();
        let mut owner = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .unwrap();
        owner.try_lock().unwrap();
        // A new owner's metadata is authoritative after waiting; a snapshot
        // taken before acquiring shared custody must not be compared against it.
        let holder = std::thread::spawn(move || {
            owner.seek(SeekFrom::Start(0)).unwrap();
            owner.set_len(0).unwrap();
            owner
                .write_all(
                    serde_json::to_string(&json!({"schema":2,"pid":std::process::id(),
                        "token":"next-owner","operation":"replacement","acquired_at_ms":1}))
                    .unwrap()
                    .as_bytes(),
                )
                .unwrap();
            std::thread::sleep(std::time::Duration::from_millis(6000));
            drop(owner);
        });
        context
            .lock_wait
            .set(std::time::Duration::from_millis(600_000));
        let result = check_available(root.path(), &path, &context);
        holder.join().unwrap();
        result.unwrap();
        let metadata: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(metadata["token"], "next-owner");
    }
    #[test]
    fn recovery_never_unlinks_schema_two_os_lock_files() {
        let metadata =
            br#"{"schema":2,"pid":1,"operation":"test","token":"token","acquired_at_ms":1}"#;
        assert!(owner(metadata).is_err());
    }
    #[test]
    fn replaced_inode_is_preserved_on_release() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("lock");
        let allow = |_: &Path, _: AccessMode| Ok(());
        let context = Context::new(&allow);
        let lease = Sentinel::acquire(root.path(), &path, "test", &context).unwrap();
        let bytes = serde_json::to_vec(&lease.owner()).unwrap();
        fs::rename(&path, root.path().join("old")).unwrap();
        fs::write(&path, &bytes).unwrap();
        assert!(lease.release().is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        let observer = ObservationLock::acquire(root.path(), &path, "observer", &context).unwrap();
        fs::rename(&path, root.path().join("observer-old")).unwrap();
        fs::write(&path, &bytes).unwrap();
        assert!(observer.release().is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);

        let mut observer =
            ObservationLock::acquire(root.path(), &path, "tamper", &context).unwrap();
        // Only this private fixture can mutate the held observer handle.
        observer.lease._file.seek(SeekFrom::Start(0)).unwrap();
        observer.lease._file.set_len(0).unwrap();
        observer.lease._file.write_all(b"tampered").unwrap();
        assert!(observer.lease.verify().is_err());
        assert!(observer.release().is_err());
        assert_eq!(fs::read(&path).unwrap(), b"tampered");
    }
}

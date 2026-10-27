//! Explicit sentinel recovery. Neither age nor an absent PID authorizes deletion.
use crate::{AccessMode, Auth, Context, paths, string};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

const MAX_BYTES: u64 = 65_536;

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
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
    let metadata = paths::checked_metadata(root, path, auth)?.ok_or("recovery file missing")?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err("recovery requires a bounded plain file".into());
    }
    auth(path, AccessMode::Read)?;
    let file = File::open(path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err("recovery requires a bounded plain file".into());
    }
    let id = identity(&file)?;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
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
        file.take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes != original.bytes {
            return Err("final recovery file contents changed".into());
        }
    }
    if let Some(guard) = guard {
        match fs::symlink_metadata(&pending) {
            Ok(_) => return Err("manifest.pending requires separate recovery".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
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
    file.try_lock()
        .map_err(|e| format!("recovery guard unavailable: {e}"))?;
    paths::check(root, &path, auth)?;
    auth(&path, AccessMode::Read)?;
    if identity(&file)? != identity(&File::open(&path).map_err(|e| e.to_string())?)? {
        return Err("recovery guard was replaced".into());
    }
    Ok(file)
}

/// Persistent OS lease; metadata never proves operation completion.
pub(crate) struct Sentinel<'a> {
    root: PathBuf,
    path: PathBuf,
    observed: Observation,
    _file: File,
    auth: Auth<'a>,
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
    let current = File::open(path).map_err(|e| e.to_string())?;
    let id = identity(file)?;
    if identity(&current)? != id {
        return Err("lock identity changed".into());
    }
    let mut reader = file;
    reader.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    reader
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("lock metadata exceeds bound".into());
    }
    if identity(&File::open(path).map_err(|e| e.to_string())?)? != id {
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
    let original = observe(root, path, auth)?;
    if !os_metadata(&original.bytes) {
        return Err("legacy or unknown lock requires explicit recovery".into());
    }
    let file = File::open(path).map_err(|e| e.to_string())?;
    file.try_lock_shared()
        .map_err(|e| format!("OS lock busy: {e}"))?;
    if identity(&file)? != original.identity {
        return Err("lock identity changed".into());
    }
    unchanged(root, path, &original, auth)
}
impl<'a> Sentinel<'a> {
    pub(crate) fn acquire(
        root: &Path,
        path: &Path,
        operation: &str,
        auth: Auth<'a>,
    ) -> Result<Self, String> {
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
        let (mut file, created) = match OpenOptions::new()
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
                    .map_err(|e| e.to_string())?,
                false,
            ),
            Err(e) => return Err(e.to_string()),
        };
        file.try_lock().map_err(|e| format!("OS lock busy: {e}"))?;
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
        let _ = self.verify();
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

#[cfg(test)]
mod tests {
    use super::*;
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
        let lease = Sentinel::acquire(root.path(), &path, "test", &context).unwrap();
        assert_eq!(lease.owner()["schema"], 2);
        assert!(Sentinel::acquire(root.path(), &path, "contender", &context).is_err());
        assert!(check_available(root.path(), &path, &context).is_err());
        lease.release().unwrap();
        assert!(path.exists());
        check_available(root.path(), &path, &context).unwrap();
        Sentinel::acquire(root.path(), &path, "again", &context)
            .unwrap()
            .release()
            .unwrap();
        for bytes in ["", "malformed", r#"{"schema":1}"#] {
            fs::write(&path, bytes).unwrap();
            assert!(Sentinel::acquire(root.path(), &path, "legacy", &context).is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), bytes);
        }
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
    }
}

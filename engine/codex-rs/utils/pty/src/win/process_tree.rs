//! Exact-handle cleanup for pipe descendants that Windows packaged apps can
//! create outside an inherited Job Object. Used only on explicit termination.

use std::collections::HashSet;
use std::io;
use std::mem::size_of;
use std::os::windows::io::AsRawHandle;
use std::os::windows::io::FromRawHandle;
use std::os::windows::io::OwnedHandle;
use std::os::windows::io::RawHandle;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;
use std::time::Instant;
use winapi::shared::minwindef::FILETIME;
use winapi::shared::ntdef::NT_SUCCESS;
use winapi::shared::ntdef::NTSTATUS;
use winapi::shared::winerror::WAIT_TIMEOUT;
use winapi::um::handleapi::DuplicateHandle;
use winapi::um::handleapi::INVALID_HANDLE_VALUE;
use winapi::um::processthreadsapi::GetCurrentProcess;
use winapi::um::processthreadsapi::GetProcessTimes;
use winapi::um::processthreadsapi::OpenProcess;
use winapi::um::processthreadsapi::TerminateProcess;
use winapi::um::synchapi::WaitForSingleObject;
use winapi::um::tlhelp32::CreateToolhelp32Snapshot;
use winapi::um::tlhelp32::PROCESSENTRY32W;
use winapi::um::tlhelp32::Process32FirstW;
use winapi::um::tlhelp32::Process32NextW;
use winapi::um::tlhelp32::TH32CS_SNAPPROCESS;
use winapi::um::winbase::WAIT_OBJECT_0;
use winapi::um::winnt::DUPLICATE_SAME_ACCESS;
use winapi::um::winnt::HANDLE;
use winapi::um::winnt::PROCESS_QUERY_LIMITED_INFORMATION;
use winapi::um::winnt::PROCESS_SUSPEND_RESUME;
use winapi::um::winnt::PROCESS_TERMINATE;
use winapi::um::winnt::SYNCHRONIZE;

use super::JobObject;

#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtSuspendProcess(process_handle: HANDLE) -> NTSTATUS;
    fn NtResumeProcess(process_handle: HANDLE) -> NTSTATUS;
}

const MAX_PROCESSES: usize = 256;
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(5);

struct OwnedProcess {
    handle: OwnedHandle,
    pid: u32,
    created: u64,
}

impl OwnedProcess {
    fn exit_time(&self) -> io::Result<Option<u64>> {
        let mut created = unsafe { std::mem::zeroed::<FILETIME>() };
        let mut exited = created;
        let mut kernel = created;
        let mut user = created;
        if unsafe {
            GetProcessTimes(
                self.handle.as_raw_handle().cast(),
                &mut created,
                &mut exited,
                &mut kernel,
                &mut user,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let exited = (u64::from(exited.dwHighDateTime) << 32) | u64::from(exited.dwLowDateTime);
        Ok((exited != 0).then_some(exited))
    }

    fn from_handle(handle: OwnedHandle, pid: u32) -> io::Result<Self> {
        let mut created = unsafe { std::mem::zeroed::<FILETIME>() };
        let mut exited = created;
        let mut kernel = created;
        let mut user = created;
        if unsafe {
            GetProcessTimes(
                handle.as_raw_handle().cast(),
                &mut created,
                &mut exited,
                &mut kernel,
                &mut user,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(Self {
            handle,
            pid,
            created: (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime),
        })
    }

    fn active(&self) -> io::Result<bool> {
        match unsafe { WaitForSingleObject(self.handle.as_raw_handle().cast(), 0) } {
            WAIT_TIMEOUT => Ok(true),
            WAIT_OBJECT_0 => Ok(false),
            _ => Err(io::Error::last_os_error()),
        }
    }

    fn terminate(&self) -> io::Result<()> {
        if !self.active()? {
            return Ok(());
        }
        if unsafe { TerminateProcess(self.handle.as_raw_handle().cast(), 1) } == 0 {
            // It may have exited between the liveness check and termination.
            let error = io::Error::last_os_error();
            if self.active()? {
                return Err(error);
            }
        }
        Ok(())
    }

    fn wait_until(&self, deadline: Instant) -> io::Result<()> {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let milliseconds = remaining.as_millis().min(u128::from(u32::MAX - 1)) as u32;
        match unsafe { WaitForSingleObject(self.handle.as_raw_handle().cast(), milliseconds) } {
            WAIT_OBJECT_0 => Ok(()),
            WAIT_TIMEOUT => Err(io::Error::new(
                io::ErrorKind::TimedOut,
                format!(
                    "owned process {} did not exit before cleanup deadline",
                    self.pid
                ),
            )),
            _ => Err(io::Error::last_os_error()),
        }
    }
}

struct SuspendedProcess(Arc<OwnedProcess>);

impl SuspendedProcess {
    fn new(process: &Arc<OwnedProcess>) -> io::Result<Self> {
        let status = unsafe { NtSuspendProcess(process.handle.as_raw_handle().cast()) };
        if !NT_SUCCESS(status) {
            return Err(io::Error::other(format!(
                "failed to suspend owned process {}: NTSTATUS {status:#x}",
                process.pid
            )));
        }
        Ok(Self(Arc::clone(process)))
    }
}

impl Drop for SuspendedProcess {
    fn drop(&mut self) {
        // A failed capture/kill must never leave an owned survivor frozen.
        if self.0.active().unwrap_or(true) {
            let status = unsafe { NtResumeProcess(self.0.handle.as_raw_handle().cast()) };
            if !NT_SUCCESS(status) {
                log::error!(
                    "failed to resume owned process {} after cleanup: NTSTATUS {status:#x}",
                    self.0.pid
                );
            }
        }
    }
}

#[derive(Default)]
struct TreeState {
    preserved: bool,
    termination_requested: bool,
}

pub(crate) struct OwnedProcessTree {
    root: Arc<OwnedProcess>,
    state: Mutex<TreeState>,
}

impl OwnedProcessTree {
    /// Duplicate the handle returned by CreateProcess, before the suspended root
    /// is resumed. Numeric PIDs are never used to reopen this root.
    pub(crate) fn capture(root: RawHandle, pid: u32) -> io::Result<Self> {
        let mut duplicate = std::ptr::null_mut();
        if unsafe {
            DuplicateHandle(
                GetCurrentProcess(),
                root.cast(),
                GetCurrentProcess(),
                &mut duplicate,
                0,
                0,
                DUPLICATE_SAME_ACCESS,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let handle = unsafe { OwnedHandle::from_raw_handle(duplicate.cast()) };
        let root = OwnedProcess::from_handle(handle, pid)?;
        log::debug!(
            "Windows pipe captured root pid={pid} creation_time={}",
            root.created
        );
        Ok(Self {
            root: Arc::new(root),
            state: Mutex::new(TreeState::default()),
        })
    }

    pub(crate) fn pid(&self) -> u32 {
        self.root.pid
    }

    pub(crate) fn raw_handle(&self) -> RawHandle {
        self.root.handle.as_raw_handle()
    }

    pub(crate) fn preserve_after_root_exit(&self, job: Option<&JobObject>) -> io::Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| io::Error::other("process tree state lock poisoned"))?;
        if !state.termination_requested {
            if let Some(job) = job {
                job.preserve_descendants()?;
            }
            state.preserved = true;
        }
        Ok(())
    }

    pub(crate) fn terminate(&self, job: Option<&JobObject>) -> io::Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| io::Error::other("process tree state lock poisoned"))?;
        // Preserve intentional background work once the root has completed.
        if state.preserved {
            return Ok(());
        }
        if !self.root.active()? {
            if !state.termination_requested {
                if let Some(job) = job {
                    job.preserve_descendants()?;
                }
                state.preserved = true;
            }
            return Ok(());
        }
        // Freeze the root before committing to tree termination. If natural exit
        // wins this race, preserve its background descendants as usual.
        let mut first_error = None;
        let suspended_root = if job.is_some() {
            match SuspendedProcess::new(&self.root) {
                Ok(suspended) => {
                    if !self.root.active()? {
                        if let Some(job) = job {
                            job.preserve_descendants()?;
                        }
                        state.preserved = true;
                        return Ok(());
                    }
                    Some(suspended)
                }
                Err(error) => {
                    if !self.root.active()? {
                        if let Some(job) = job {
                            job.preserve_descendants()?;
                        }
                        state.preserved = true;
                        return Ok(());
                    }
                    remember_error(&mut first_error, Err(error));
                    None
                }
            }
        } else {
            None
        };
        state.termination_requested = true;
        let deadline = Instant::now() + CAPTURE_TIMEOUT;
        if suspended_root.is_some() {
            // Root-only fallback remains root-only when job assignment failed.
            let mut visited = HashSet::new();
            remember_error(
                &mut first_error,
                terminate_subtree(&self.root, suspended_root.as_ref(), &mut visited, deadline),
            );
        }
        if let Some(job) = job {
            remember_error(&mut first_error, job.terminate());
        }
        remember_error(&mut first_error, self.root.terminate());
        remember_error(&mut first_error, self.root.wait_until(deadline));
        drop(suspended_root);
        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

fn remember_error(first: &mut Option<io::Error>, result: io::Result<()>) {
    if let Err(error) = result {
        log::warn!("Windows owned process tree cleanup failed: {error}");
        if first.is_none() {
            *first = Some(error);
        }
    }
}

fn process_snapshot() -> io::Result<Vec<(u32, u32)>> {
    let raw = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if raw == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let handle = unsafe { OwnedHandle::from_raw_handle(raw.cast()) };
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
    let mut entries = Vec::new();
    let mut more = unsafe { Process32FirstW(handle.as_raw_handle().cast(), &mut entry) };
    while more != 0 {
        entries.push((entry.th32ProcessID, entry.th32ParentProcessID));
        more = unsafe { Process32NextW(handle.as_raw_handle().cast(), &mut entry) };
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() != Some(winapi::shared::winerror::ERROR_NO_MORE_FILES as i32) {
        return Err(error);
    }
    Ok(entries)
}

fn matches_parent(
    parent_pid: u32,
    parent_created: u64,
    parent_exited: Option<u64>,
    child_created: u64,
    current_parent: u32,
) -> bool {
    current_parent == parent_pid
        && child_created >= parent_created
        && parent_exited.is_none_or(|exited| child_created <= exited)
}

struct CapturedProcess {
    process: Arc<OwnedProcess>,
    suspended: Option<SuspendedProcess>,
}

fn capture_child(pid: u32, parent: &OwnedProcess) -> io::Result<Option<CapturedProcess>> {
    let raw = unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION
                | PROCESS_SUSPEND_RESUME
                | PROCESS_TERMINATE
                | SYNCHRONIZE,
            0,
            pid,
        )
    };
    if raw.is_null() {
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(winapi::shared::winerror::ERROR_INVALID_PARAMETER as i32) {
            log::warn!(
                "Windows pipe descendant candidate pid={pid} disappeared before handle capture; snapshot cleanup cannot establish its descendants"
            );
            return Ok(None);
        }
        return Err(error);
    }
    let handle = unsafe { OwnedHandle::from_raw_handle(raw.cast()) };
    let child = Arc::new(OwnedProcess::from_handle(handle, pid)?);
    if !child.active()? {
        log::warn!(
            "Windows pipe descendant candidate pid={pid} exited before identity validation; snapshot cleanup cannot establish its descendants"
        );
        return Ok(None);
    }
    // The first snapshot is only a candidate list. Recheck PPID while this exact
    // opened process is alive on BOTH sides of a fresh snapshot, so a reused
    // candidate PID cannot authorize touching an unrelated generation.
    let current_parent = process_snapshot()?
        .into_iter()
        .find_map(|(current_pid, ppid)| (current_pid == pid).then_some(ppid));
    let child_active_after_snapshot = child.active()?;
    let parent_exited = parent.exit_time()?;
    if !child_active_after_snapshot
        || !current_parent.is_some_and(|ppid| {
            matches_parent(
                parent.pid,
                parent.created,
                parent_exited,
                child.created,
                ppid,
            )
        })
    {
        log::warn!(
            "Windows pipe descendant candidate pid={pid} unavailable or outside captured parent lifetime; skipping unproven ownership"
        );
        return Ok(None);
    }
    // Freeze as part of capture, not later during recursion. If it has already
    // exited after validation, retain its exact lifetime and traverse children
    // through that captured inactive parent instead of losing the subtree.
    let suspended = match SuspendedProcess::new(&child) {
        Ok(suspended) => Some(suspended),
        Err(error) if !child.active()? => {
            log::debug!("Windows pipe captured parent pid={pid} exited before suspension: {error}");
            None
        }
        Err(error) => return Err(error),
    };
    log::debug!(
        "Windows pipe captured descendant pid={} creation_time={} parent_pid={} parent_creation_time={}",
        child.pid,
        child.created,
        parent.pid,
        parent.created
    );
    Ok(Some(CapturedProcess {
        process: child,
        suspended,
    }))
}

fn terminate_subtree(
    parent: &Arc<OwnedProcess>,
    suspended: Option<&SuspendedProcess>,
    visited: &mut HashSet<(u32, u64)>,
    deadline: Instant,
) -> io::Result<()> {
    if parent.active()? && suspended.is_none() {
        return Err(io::Error::other(
            "owned active parent was not suspended before traversal",
        ));
    }
    if visited.len() >= MAX_PROCESSES || Instant::now() >= deadline {
        return Err(io::Error::other(
            "owned process tree capture exceeded its bound",
        ));
    }
    if !visited.insert((parent.pid, parent.created)) {
        return Ok(());
    }
    let mut first_error = None;
    match process_snapshot() {
        Ok(entries) => {
            for (pid, ppid) in entries {
                if ppid != parent.pid || pid == parent.pid {
                    continue;
                }
                if Instant::now() >= deadline {
                    remember_error(
                        &mut first_error,
                        Err(io::Error::other("owned process tree capture timed out")),
                    );
                    break;
                }
                match capture_child(pid, parent) {
                    Ok(Some(child)) => remember_error(
                        &mut first_error,
                        terminate_subtree(
                            &child.process,
                            child.suspended.as_ref(),
                            visited,
                            deadline,
                        ),
                    ),
                    Ok(None) => {}
                    Err(error) => remember_error(&mut first_error, Err(error)),
                }
            }
        }
        Err(error) => remember_error(&mut first_error, Err(error)),
    }
    remember_error(&mut first_error, parent.terminate());
    remember_error(&mut first_error, parent.wait_until(deadline));
    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::matches_parent;

    #[test]
    fn rejects_child_from_older_parent_generation() {
        assert!(!matches_parent(12, 100, None, 99, 12));
    }

    #[test]
    fn rejects_reused_candidate_pid_with_different_parent() {
        assert!(!matches_parent(12, 100, None, 110, 13));
    }

    #[test]
    fn accepts_current_child_of_captured_parent_generation() {
        assert!(matches_parent(12, 100, None, 110, 12));
        assert!(matches_parent(12, 100, Some(120), 110, 12));
    }

    #[test]
    fn rejects_child_created_after_captured_parent_exit() {
        assert!(!matches_parent(12, 100, Some(120), 121, 12));
    }

    #[test]
    fn retained_inactive_parent_still_cleans_live_descendant() -> anyhow::Result<()> {
        use super::*;
        use std::os::windows::process::CommandExt;
        use std::process::Stdio;

        let python = crate::tests::find_python()
            .ok_or_else(|| anyhow::anyhow!("python required for captured-parent lifecycle test"))?;
        let fixture = tempfile::Builder::new()
            .prefix("codex-captured-parent-")
            .tempdir()?;
        let ready = fixture.path().join("grandchild.pid");
        let path_hex: String = ready
            .to_string_lossy()
            .as_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let code = format!(
            "import pathlib,subprocess,sys,time; child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); pathlib.Path(bytes.fromhex('{path_hex}').decode()).write_text(str(child.pid)); time.sleep(30)"
        );
        let mut root = std::process::Command::new(python)
            .args(["-u", "-c", &code])
            .creation_flags(winapi::um::winbase::CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        let deadline = Instant::now() + CAPTURE_TIMEOUT;
        let pid = loop {
            if let Ok(value) = std::fs::read_to_string(&ready)
                && let Ok(pid) = value.parse::<u32>()
            {
                break pid;
            }
            if Instant::now() >= deadline {
                root.kill()?;
                root.wait()?;
                anyhow::bail!("grandchild fixture did not start");
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        let raw = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE | SYNCHRONIZE,
                0,
                pid,
            )
        };
        anyhow::ensure!(
            !raw.is_null(),
            "cannot capture grandchild: {}",
            io::Error::last_os_error()
        );
        let grandchild =
            OwnedProcess::from_handle(unsafe { OwnedHandle::from_raw_handle(raw.cast()) }, pid)?;
        let result = (|| -> io::Result<()> {
            let captured = OwnedProcessTree::capture(root.as_raw_handle(), root.id())?;
            let suspended = SuspendedProcess::new(&captured.root)?;
            // Deterministically model external exit AFTER capture/suspension.
            captured.root.terminate()?;
            captured.root.wait_until(Instant::now() + CAPTURE_TIMEOUT)?;
            terminate_subtree(
                &captured.root,
                Some(&suspended),
                &mut HashSet::new(),
                Instant::now() + CAPTURE_TIMEOUT,
            )
        })();
        let grandchild_exited = !grandchild.active()?;
        if !grandchild_exited {
            grandchild.terminate()?;
            grandchild.wait_until(Instant::now() + CAPTURE_TIMEOUT)?;
        }
        if root.try_wait()?.is_none() {
            root.kill()?;
        }
        root.wait()?;
        fixture.close()?;
        result?;
        anyhow::ensure!(
            grandchild_exited,
            "captured inactive parent's grandchild survived cleanup"
        );
        Ok(())
    }
}

//! A release hint on the exact authorized file, never transaction custody.
use std::fs::File;
use std::path::{Path, PathBuf};
#[cfg(not(windows))]
use std::time::Duration;
use std::time::Instant;

#[derive(Debug)]
pub(crate) struct Waiter {
    file: File,
    path: PathBuf,
}

impl Waiter {
    pub(crate) fn prepare(path: &Path, failed: &File) -> Result<Option<Self>, String> {
        let expected = crate::lock_recovery::identity(failed)?;
        #[cfg(windows)]
        let opened = {
            use std::os::windows::fs::OpenOptionsExt;
            std::fs::OpenOptions::new()
                .read(true)
                .custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OVERLAPPED)
                .open(path)
        };
        #[cfg(not(windows))]
        let opened = failed.try_clone();
        let Ok(file) = opened else { return Ok(None) };
        if crate::lock_recovery::identity(&file)? != expected {
            return Err("lock identity changed while preparing release wait".into());
        }
        Ok(Some(Self {
            file,
            path: path.to_owned(),
        }))
    }

    pub(crate) fn wait(
        &self,
        deadline: Instant,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<bool, String> {
        let mut span =
            crate::timing::Span::new("maintenance.queued_wait", "lock_release", Some(&self.path));
        let result = self.wait_inner(deadline, cancelled, &mut span);
        span.outcome(match &result {
            Ok(true) => "released",
            Ok(false) => "timeout",
            Err(_) => "error",
        });
        result
    }

    #[cfg(not(windows))]
    fn wait_inner(
        &self,
        deadline: Instant,
        cancelled: &dyn Fn() -> bool,
        span: &mut crate::timing::Span,
    ) -> Result<bool, String> {
        let mut delay = Duration::from_millis(10);
        loop {
            if cancelled() {
                return Err("maintenance lock wait cancelled".into());
            }
            if Instant::now() >= deadline {
                return Ok(false);
            }
            span.attempt();
            match self.file.try_lock_shared() {
                Ok(()) => {
                    self.file.unlock().map_err(|e| e.to_string())?;
                    return Ok(true);
                }
                Err(std::fs::TryLockError::WouldBlock) => {}
                Err(std::fs::TryLockError::Error(e)) => return Err(e.to_string()),
            }
            std::thread::sleep(delay.min(deadline.saturating_duration_since(Instant::now())));
            delay = (delay * 2).min(Duration::from_millis(200));
        }
    }

    #[cfg(windows)]
    fn wait_inner(
        &self,
        deadline: Instant,
        cancelled: &dyn Fn() -> bool,
        span: &mut crate::timing::Span,
    ) -> Result<bool, String> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Foundation::{
            CloseHandle, ERROR_IO_PENDING, WAIT_OBJECT_0, WAIT_TIMEOUT,
        };
        use windows_sys::Win32::Storage::FileSystem::{LockFileEx, UnlockFileEx};
        use windows_sys::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};
        use windows_sys::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

        if cancelled() {
            return Err("maintenance lock wait cancelled".into());
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        // The file is opened for overlapped I/O. All three resources remain live
        // until GetOverlappedResult observes terminal completion, also on cancel.
        unsafe {
            let event = CreateEventW(std::ptr::null(), 1, 0, std::ptr::null());
            if event.is_null() {
                return Err(std::io::Error::last_os_error().to_string());
            }
            struct Event(windows_sys::Win32::Foundation::HANDLE);
            impl Drop for Event {
                fn drop(&mut self) {
                    unsafe {
                        CloseHandle(self.0);
                    }
                }
            }
            let event = Event(event);
            let mut overlapped: OVERLAPPED = std::mem::zeroed();
            overlapped.hEvent = event.0;
            let handle = self.file.as_raw_handle();
            span.attempt();
            // Match std::fs::File::{try_lock,try_lock_shared}: offset 0,
            // low/high length u32::MAX. A shared lock requires only read access.
            let immediate = LockFileEx(handle, 0, 0, u32::MAX, u32::MAX, &mut overlapped) != 0;
            if !immediate {
                let error = std::io::Error::last_os_error();
                if error.raw_os_error() != Some(ERROR_IO_PENDING as i32) {
                    return Err(error.to_string());
                }
            }
            let mut stopped: Option<Result<bool, String>> = None;
            if !immediate {
                loop {
                    if cancelled() {
                        stopped = Some(Err("maintenance lock wait cancelled".into()));
                        break;
                    }
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    if remaining.is_zero() {
                        stopped = Some(Ok(false));
                        break;
                    }
                    let millis = remaining.as_millis().saturating_add(1).min(200) as u32;
                    match WaitForSingleObject(event.0, millis) {
                        WAIT_OBJECT_0 => break,
                        WAIT_TIMEOUT => continue,
                        _ => {
                            stopped = Some(Err(std::io::Error::last_os_error().to_string()));
                            break;
                        }
                    }
                }
            }
            if stopped.is_some() {
                // ERROR_NOT_FOUND can mean completion raced cancellation. Drain
                // in both cases and unlock a grant that raced the timeout.
                CancelIoEx(handle, &overlapped);
            }
            let mut transferred = 0;
            let completed = GetOverlappedResult(handle, &overlapped, &mut transferred, 1) != 0;
            let completion_error = (!completed).then(std::io::Error::last_os_error);
            if completed && UnlockFileEx(handle, 0, u32::MAX, u32::MAX, &mut overlapped) == 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            if let Some(result) = stopped {
                return result;
            }
            if let Some(error) = completion_error {
                return Err(error.to_string());
            }
            Ok(true)
        }
    }
}

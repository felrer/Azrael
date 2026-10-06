//! Coordinates manual account changes with work using that authentication owner.

use std::io;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use tokio::sync::OwnedRwLockReadGuard;
use tokio::sync::OwnedRwLockWriteGuard;
use tokio::sync::RwLock;
use tokio::sync::watch;

pub struct AzraelAuthAdmission {
    work: Arc<RwLock<()>>,
    pending: AtomicBool,
    failed_closed: AtomicBool,
    changes: watch::Sender<u64>,
}

impl Default for AzraelAuthAdmission {
    fn default() -> Self {
        Self {
            work: Arc::default(),
            pending: AtomicBool::new(false),
            failed_closed: AtomicBool::new(false),
            changes: watch::channel(0).0,
        }
    }
}

/// Owns a pending manual switch. Dropping it reopens external admission.
pub struct AzraelSwitchRequest {
    admission: Arc<AzraelAuthAdmission>,
}

impl AzraelAuthAdmission {
    /// Pin an execution task's account until the task and its cleanup finish.
    pub async fn enter_task(self: &Arc<Self>) -> Arc<AzraelTaskAuthLease> {
        Arc::new(AzraelTaskAuthLease {
            admission: Arc::clone(self),
            guard: std::sync::Mutex::new(Some(Arc::clone(&self.work).read_owned().await)),
            finished: AtomicBool::new(false),
        })
    }

    /// Admit external work only when no manual switch is pending.
    pub async fn admit_request(&self) -> io::Result<OwnedRwLockReadGuard<()>> {
        self.check_recovery()?;
        if self.is_pending() {
            self.check_recovery()?;
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "An account change is pending.",
            ));
        }
        let guard = Arc::clone(&self.work).try_read_owned().map_err(|_| {
            self.check_recovery().err().unwrap_or_else(|| {
                io::Error::new(io::ErrorKind::WouldBlock, "An account change is pending.")
            })
        })?;
        self.check_recovery()?;
        if self.is_pending() {
            self.check_recovery()?;
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "An account switch is pending. Wait for it or cancel it before starting work.",
            ));
        }
        Ok(guard)
    }

    /// Explicit queued work may use the current account while a switch awaits idle.
    /// Never wait on the exclusive commit or queue a writer ahead of child work.
    pub fn admit_queued_request(&self) -> io::Result<OwnedRwLockReadGuard<()>> {
        self.check_recovery()?;
        let guard = Arc::clone(&self.work).try_read_owned().map_err(|_| {
            io::Error::new(
                io::ErrorKind::WouldBlock,
                "An account change is being committed.",
            )
        })?;
        self.check_recovery()?;
        Ok(guard)
    }

    fn check_recovery(&self) -> io::Result<()> {
        if self.failed_closed.load(Ordering::Acquire) {
            return Err(io::Error::other(
                "Account recovery is required before new work. Restart the engine.",
            ));
        }
        Ok(())
    }

    /// Notification epochs only signal changes; consumers reread `is_pending`.
    pub fn subscribe_changes(&self) -> watch::Receiver<u64> {
        self.changes.subscribe()
    }

    pub fn begin_switch(self: &Arc<Self>) -> io::Result<AzraelSwitchRequest> {
        self.check_recovery()?;
        self.pending
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| {
                io::Error::new(
                    io::ErrorKind::WouldBlock,
                    "An account change is already pending.",
                )
            })?;
        self.changes
            .send_modify(|epoch| *epoch = epoch.wrapping_add(1));
        Ok(AzraelSwitchRequest {
            admission: Arc::clone(self),
        })
    }

    pub fn is_pending(&self) -> bool {
        self.pending.load(Ordering::Acquire) || self.failed_closed.load(Ordering::Acquire)
    }

    /// Fail closed while the caller retains the exclusive execution guard.
    pub fn block_new_work(&self) {
        self.failed_closed.store(true, Ordering::Release);
        self.changes
            .send_modify(|epoch| *epoch = epoch.wrapping_add(1));
    }

    pub fn has_active_work(&self) -> bool {
        Arc::clone(&self.work).try_write_owned().is_err()
    }
}

impl AzraelSwitchRequest {
    /// Never queue a writer: existing work must still be able to start children.
    pub fn try_commit(&self) -> Option<OwnedRwLockWriteGuard<()>> {
        Arc::clone(&self.admission.work).try_write_owned().ok()
    }
}

impl Drop for AzraelSwitchRequest {
    fn drop(&mut self) {
        self.admission.pending.store(false, Ordering::Release);
        self.admission
            .changes
            .send_modify(|epoch| *epoch = epoch.wrapping_add(1));
    }
}

#[cfg(test)]
#[path = "azrael_admission_tests.rs"]
mod tests;

/// Pins a task identity and permits only that task to yield its own admission.
pub struct AzraelTaskAuthLease {
    admission: Arc<AzraelAuthAdmission>,
    guard: std::sync::Mutex<Option<OwnedRwLockReadGuard<()>>>,
    finished: AtomicBool,
}

impl std::fmt::Debug for AzraelTaskAuthLease {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AzraelTaskAuthLease")
            .field("finished", &self.finished.load(Ordering::Acquire))
            .finish_non_exhaustive()
    }
}

impl AzraelTaskAuthLease {
    /// Release execution admission after task cleanup, even if contexts retain this lease.
    pub fn finish(&self) {
        self.finished.store(true, Ordering::Release);
        self.guard
            .lock()
            .unwrap_or_else(|error| panic!("task authentication lease mutex is poisoned: {error}"))
            .take();
    }

    pub(crate) fn belongs_to(&self, admission: &Arc<AzraelAuthAdmission>) -> bool {
        Arc::ptr_eq(&self.admission, admission)
    }

    pub(crate) fn begin_recovery(
        &self,
    ) -> Result<AzraelTaskRecovery<'_>, crate::AzraelQuotaRecoveryOutcome> {
        use crate::AzraelQuotaRecoveryOutcome;
        let mut guard = self
            .guard
            .lock()
            .unwrap_or_else(|error| panic!("task authentication lease mutex is poisoned: {error}"));
        if self.finished.load(Ordering::Acquire) || guard.is_none() {
            return Err(AzraelQuotaRecoveryOutcome::Superseded);
        }
        let request = self
            .admission
            .begin_switch()
            .map_err(|_| AzraelQuotaRecoveryOutcome::Superseded)?;
        guard.take();
        drop(guard);
        Ok(AzraelTaskRecovery {
            lease: self,
            request,
        })
    }
}

pub(crate) struct AzraelTaskRecovery<'a> {
    lease: &'a AzraelTaskAuthLease,
    pub(crate) request: AzraelSwitchRequest,
}

impl Drop for AzraelTaskRecovery<'_> {
    fn drop(&mut self) {
        let mut guard =
            self.lease.guard.lock().unwrap_or_else(|error| {
                panic!("task authentication lease mutex is poisoned: {error}")
            });
        if !self.lease.finished.load(Ordering::Acquire)
            && !self.lease.admission.failed_closed.load(Ordering::Acquire)
        {
            *guard = Arc::clone(&self.lease.admission.work).try_read_owned().ok();
            if guard.is_none() {
                self.lease.admission.block_new_work();
            }
        }
        // The request reopens admission after this task has reacquired its pin.
    }
}

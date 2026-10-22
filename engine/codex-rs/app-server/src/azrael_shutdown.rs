//! A managed shared engine's final deadline must survive blocked async workers.
use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub(crate) const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(35);
pub(crate) const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(3);
// Distinguish an exhausted shutdown budget from a successfully saved checkpoint.
const DEADLINE_EXIT_CODE: i32 = 124;

pub(crate) struct ShutdownWatchdog {
    deadline: mpsc::Sender<Instant>,
    armed: AtomicBool,
}

impl ShutdownWatchdog {
    pub(crate) fn new() -> io::Result<Self> {
        Self::with_expiry(|| std::process::exit(DEADLINE_EXIT_CODE))
    }

    fn with_expiry(expire: impl FnOnce() + Send + 'static) -> io::Result<Self> {
        let (deadline, receiver) = mpsc::channel::<Instant>();
        std::thread::Builder::new()
            .name("azrael-shutdown-deadline".into())
            .spawn(move || {
                let Ok(deadline) = receiver.recv() else {
                    return;
                };
                // Sender disconnection means the outer joins completed (or returned Forced).
                // Do not call a logger or perform I/O here: either can be the blocked resource.
                if matches!(
                    receiver.recv_timeout(deadline.saturating_duration_since(Instant::now())),
                    Err(mpsc::RecvTimeoutError::Timeout)
                ) {
                    expire();
                }
            })?;
        Ok(Self {
            deadline,
            armed: AtomicBool::new(false),
        })
    }

    pub(crate) fn arm(&self, deadline: Instant) {
        if !self.armed.swap(true, Ordering::AcqRel) {
            let _ = self.deadline.send(deadline);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completed_or_unarmed_shutdown_does_not_expire() {
        let (sender, receiver) = mpsc::channel();
        let watchdog = ShutdownWatchdog::with_expiry(move || sender.send(()).unwrap()).unwrap();
        watchdog.arm(Instant::now() + Duration::from_secs(1));
        drop(watchdog);
        assert!(matches!(
            receiver.recv_timeout(Duration::from_secs(2)),
            Err(mpsc::RecvTimeoutError::Disconnected)
        ));
        let (sender, receiver) = mpsc::channel();
        drop(ShutdownWatchdog::with_expiry(move || sender.send(()).unwrap()).unwrap());
        assert!(matches!(
            receiver.recv_timeout(Duration::from_secs(2)),
            Err(mpsc::RecvTimeoutError::Disconnected)
        ));
    }

    #[test]
    fn blocking_caller_cannot_extend_absolute_deadline() {
        let (sender, receiver) = mpsc::channel();
        let watchdog = ShutdownWatchdog::with_expiry(move || sender.send(()).unwrap()).unwrap();
        watchdog.arm(Instant::now() + Duration::from_millis(20));
        watchdog.arm(Instant::now() + Duration::from_secs(30));
        assert_eq!(receiver.recv_timeout(Duration::from_secs(2)), Ok(()));
        drop(watchdog);
    }

    #[test]
    fn watchdog_terminates_blocked_process() {
        const CHILD_ENV: &str = "AZRAEL_SHUTDOWN_WATCHDOG_TEST_CHILD";
        if std::env::var_os(CHILD_ENV).is_some() {
            let watchdog = ShutdownWatchdog::new().unwrap();
            watchdog.arm(Instant::now() + Duration::from_millis(50));
            std::thread::sleep(Duration::from_secs(30));
            panic!("watchdog did not terminate blocked process");
        }
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "azrael_shutdown::tests::watchdog_terminates_blocked_process",
                "--nocapture",
            ])
            .env(CHILD_ENV, "1")
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(status) = child.try_wait().unwrap() {
                assert_eq!(status.code(), Some(DEADLINE_EXIT_CODE));
                break;
            }
            if Instant::now() >= deadline {
                child.kill().unwrap();
                child.wait().unwrap();
                panic!("watchdog subprocess exceeded test deadline");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

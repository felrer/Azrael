use crate::protocol::{Error, Result};
use std::{
    collections::HashSet,
    sync::{mpsc, Mutex, OnceLock},
    thread,
    time::Duration,
};
use windows::Win32::{
    Foundation::*,
    UI::{Accessibility::*, WindowsAndMessaging::*},
};

const MAX_RETIRED: usize = 1_000_000;
#[derive(Default)]
struct Retired {
    handles: HashSet<usize>,
    exhausted: bool,
}
impl Retired {
    fn record(&mut self, handle: usize) {
        if self.handles.len() >= MAX_RETIRED {
            self.exhausted = true;
        } else {
            self.handles.insert(handle);
        }
    }
    fn accepts(&self, handle: usize) -> bool {
        !self.exhausted && !self.handles.contains(&handle)
    }
}
static RETIRED: OnceLock<Mutex<Retired>> = OnceLock::new();
fn retired() -> &'static Mutex<Retired> {
    RETIRED.get_or_init(|| Mutex::new(Retired::default()))
}
pub fn validate(hwnd: HWND) -> Result<()> {
    if !retired()
        .lock()
        .map_err(|_| Error::new("lifetime-monitor", "Lifetime monitor is unavailable"))?
        .accepts(hwnd.0 as usize)
    {
        return Err(Error::new(
            "stale-target",
            "HWND was destroyed during this backend session; select a new target in a new session",
        ));
    }
    Ok(())
}
enum Command {
    Barrier(mpsc::SyncSender<()>),
    Stop,
}
pub struct Watcher {
    commands: mpsc::Sender<Command>,
    thread: Option<thread::JoinHandle<()>>,
}
impl Watcher {
    pub fn new() -> Result<Self> {
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let (commands, receiver) = mpsc::channel();
        let worker = thread::spawn(move || unsafe {
            unsafe extern "system" fn destroyed(
                _: HWINEVENTHOOK,
                _: u32,
                hwnd: HWND,
                object: i32,
                child: i32,
                _: u32,
                _: u32,
            ) {
                if object == OBJID_WINDOW.0 && child == 0 && !hwnd.0.is_null() {
                    if let Ok(mut state) = retired().lock() {
                        state.record(hwnd.0 as usize);
                    }
                }
            }
            let hook = SetWinEventHook(
                EVENT_OBJECT_DESTROY,
                EVENT_OBJECT_DESTROY,
                None,
                Some(destroyed),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            );
            if hook.0.is_null() {
                let _ = ready_tx.send(false);
                return;
            }
            let _ = ready_tx.send(true);
            'running: loop {
                let mut message = MSG::default();
                // Pump only this helper thread's message queue; this is never target window input.
                while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                    if message.message == WM_QUIT {
                        break 'running;
                    }
                }
                loop {
                    match receiver.try_recv() {
                        Ok(Command::Barrier(done)) => {
                            let _ = done.send(());
                        }
                        Ok(Command::Stop) | Err(mpsc::TryRecvError::Disconnected) => break 'running,
                        Err(mpsc::TryRecvError::Empty) => break,
                    }
                }
                thread::sleep(Duration::from_millis(5));
            }
            let _ = UnhookWinEvent(hook);
        });
        match ready_rx.recv_timeout(Duration::from_secs(1)) {
            Ok(true) => Ok(Self {
                commands,
                thread: Some(worker),
            }),
            _ => {
                let _ = commands.send(Command::Stop);
                Err(Error::new(
                    "lifetime-monitor",
                    "Cannot initialize HWND destruction tracking",
                ))
            }
        }
    }
    pub fn barrier(&self) -> Result<()> {
        let (done, response) = mpsc::sync_channel(1);
        self.commands
            .send(Command::Barrier(done))
            .map_err(|_| Error::new("lifetime-monitor", "HWND destruction tracking stopped"))?;
        response.recv_timeout(Duration::from_secs(1)).map_err(|_| {
            Error::new("lifetime-monitor", "HWND destruction event queue timed out")
        })?;
        Ok(())
    }
}
impl Drop for Watcher {
    fn drop(&mut self) {
        let _ = self.commands.send(Command::Stop);
        if let Some(worker) = self.thread.take() {
            let _ = worker.join();
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn destroyed_hwnd_is_never_rebound_in_same_process() {
        let mut registry = Retired::default();
        assert!(registry.accepts(1234));
        registry.record(1234);
        assert!(!registry.accepts(1234));
        assert!(registry.accepts(5678));
        registry.exhausted = true;
        assert!(!registry.accepts(5678));
    }
}

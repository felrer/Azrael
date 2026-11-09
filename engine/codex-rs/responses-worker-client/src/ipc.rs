//! Blocking pipe IO is isolated from both runtimes. Replies and revocations are
//! handled by the reader itself, so a synchronous cookie/policy call cannot deadlock it.
use crate::protocol::Assembler;
use crate::protocol::Callback;
use crate::protocol::CallbackResult;
use crate::protocol::EncodedFrame;
use crate::protocol::Frame;
use crate::protocol::read_frame;
use std::collections::HashMap;
use std::io::Read;
use std::io::Write;
use std::sync::Arc;
use std::sync::Condvar;
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::time::Duration;
use tokio::sync::watch;

pub enum Incoming {
    Frame(Frame),
    Disconnected(String),
}
enum Waiter {
    Sync(mpsc::SyncSender<Result<CallbackResult, String>>),
    Async(tokio::sync::oneshot::Sender<Result<CallbackResult, String>>),
}
impl Waiter {
    fn send(self, result: Result<CallbackResult, String>) {
        match self {
            Self::Sync(tx) => {
                let _ = tx.send(result);
            }
            Self::Async(tx) => {
                let _ = tx.send(result);
            }
        }
    }
}
type Waiters = HashMap<(u64, u64), Waiter>;

pub struct Endpoint {
    generation: u64,
    queue: Arc<Queue>,
    alive: Arc<AtomicBool>,
    next_call: AtomicU64,
    waiters: Arc<Mutex<Waiters>>,
    pub permits: Arc<Mutex<HashMap<u64, watch::Sender<bool>>>>,
    closed: watch::Receiver<bool>,
    fail: Arc<dyn Fn(String) + Send + Sync>,
}
#[derive(Default)]
struct Queued {
    control: std::collections::VecDeque<Frame>,
    data: std::collections::VecDeque<Frame>,
    credits: usize,
}
#[derive(Default)]
struct Queue {
    state: Mutex<Queued>,
    changed: Condvar,
}
impl Endpoint {
    pub fn start(
        generation: u64,
        mut reader: impl Read + Send + 'static,
        mut writer: impl Write + Send + 'static,
    ) -> (Arc<Self>, tokio::sync::mpsc::UnboundedReceiver<Incoming>) {
        let queue = Arc::new(Queue::default());
        queue
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .credits = crate::protocol::DATA_WINDOW;
        let (incoming, receiver) = tokio::sync::mpsc::unbounded_channel();
        let alive = Arc::new(AtomicBool::new(true));
        let waiters = Arc::new(Mutex::new(Waiters::new()));
        let permits = Arc::new(Mutex::new(HashMap::<u64, watch::Sender<bool>>::new()));
        let (closed_tx, closed) = watch::channel(false);
        let fail: Arc<dyn Fn(String) + Send + Sync> = {
            let alive = alive.clone();
            let waiters = waiters.clone();
            let permits = permits.clone();
            let incoming = incoming.clone();
            let queue = queue.clone();
            Arc::new(move |reason: String| {
                if alive.swap(false, Ordering::AcqRel) {
                    let _ = closed_tx.send(true);
                    for (_, tx) in
                        std::mem::take(&mut *waiters.lock().unwrap_or_else(|e| e.into_inner()))
                    {
                        tx.send(Err(reason.clone()));
                    }
                    // Sender loss is itself revocation for every proxy permit.
                    for (_, sender) in
                        std::mem::take(&mut *permits.lock().unwrap_or_else(|e| e.into_inner()))
                    {
                        let _ = sender.send(true);
                    }
                    let _ = incoming.send(Incoming::Disconnected(reason));
                    queue.changed.notify_all();
                }
            })
        };
        {
            let alive = alive.clone();
            let fail = fail.clone();
            let queue = queue.clone();
            std::thread::spawn(move || {
                let mut stream = 1;
                let mut pending = std::collections::VecDeque::<EncodedFrame>::new();
                while alive.load(Ordering::Acquire) {
                    let frame = {
                        let mut queued = queue.state.lock().unwrap_or_else(|e| e.into_inner());
                        while queued.control.is_empty()
                            && queued.data.is_empty()
                            && pending.is_empty()
                            && alive.load(Ordering::Acquire)
                        {
                            queued = queue
                                .changed
                                .wait(queued)
                                .unwrap_or_else(|e| e.into_inner());
                        }
                        let frame = queued.control.pop_front().or_else(|| {
                            if pending.is_empty() {
                                queued.data.pop_front()
                            } else {
                                None
                            }
                        });
                        queue.changed.notify_all();
                        frame
                    };
                    if let Some(frame) = frame {
                        match EncodedFrame::new(&frame, stream) {
                            Ok(frame) => {
                                pending.push_front(frame);
                                stream += 1;
                            }
                            Err(e) => {
                                fail(format!("Responses worker encode: {e}"));
                                break;
                            }
                        }
                    }
                    if let Some(mut frame) = pending.pop_front() {
                        match frame.write_next(&mut writer) {
                            Ok(true) => {}
                            Ok(false) => pending.push_front(frame),
                            Err(e) => {
                                fail(format!("Responses worker pipe write: {e}"));
                                break;
                            }
                        }
                    }
                }
            });
        }
        {
            let waiters = waiters.clone();
            let permits = permits.clone();
            let fail = fail.clone();
            let queue = queue.clone();
            std::thread::spawn(move || {
                let mut assembler = Assembler::default();
                loop {
                    let frame = match read_frame(&mut reader).and_then(|f| assembler.accept(f)) {
                        Ok(Some(frame)) => frame,
                        Ok(None) => continue,
                        Err(e) => {
                            fail(format!("Responses worker pipe EOF: {e}"));
                            break;
                        }
                    };
                    match frame {
                        Frame::DataCredit {
                            generation: got,
                            amount,
                        } if got == generation => {
                            let mut queued = queue.state.lock().unwrap_or_else(|e| e.into_inner());
                            if amount == 0
                                || amount > crate::protocol::DATA_WINDOW
                                || queued.credits + amount > crate::protocol::DATA_WINDOW
                            {
                                drop(queued);
                                fail("invalid Responses worker data credit".into());
                                break;
                            }
                            queued.credits += amount;
                            queue.changed.notify_all();
                        }
                        Frame::CallbackReply {
                            generation: got,
                            id,
                            call,
                            result,
                        } if got == generation => {
                            let tx = waiters
                                .lock()
                                .unwrap_or_else(|e| e.into_inner())
                                .remove(&(id, call));
                            if let Some(tx) = tx {
                                tx.send(Ok(result));
                            } else {
                                fail("stale Responses worker callback reply".into());
                                break;
                            }
                        }
                        Frame::Revoke {
                            generation: got,
                            permit,
                        } if got == generation => {
                            // Revocation can arrive before the acquire reply is consumed.
                            let mut permits = permits.lock().unwrap_or_else(|e| e.into_inner());
                            let sender = permits
                                .entry(permit)
                                .or_insert_with(|| watch::channel(true).0);
                            let _ = sender.send(true);
                        }
                        frame => {
                            if incoming.send(Incoming::Frame(frame)).is_err() {
                                fail("Responses worker owner dropped".into());
                                break;
                            }
                        }
                    }
                }
            });
        }
        (
            Arc::new(Self {
                generation,
                queue,
                alive,
                next_call: AtomicU64::new(1),
                waiters,
                permits,
                closed,
                fail,
            }),
            receiver,
        )
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn is_closed(&self) -> bool {
        !self.alive.load(Ordering::Acquire)
    }
    pub async fn closed(&self) {
        let mut receiver = self.closed.clone();
        if !*receiver.borrow() {
            let _ = receiver.changed().await;
        }
    }
    pub fn control(&self, frame: Frame) -> Result<(), String> {
        if self.is_closed() {
            return Err("Responses worker pipe is closed".into());
        }
        self.queue
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .control
            .push_back(frame);
        self.queue.changed.notify_all();
        Ok(())
    }
    /// Atomically publishes an ordered control sequence (also useful for probing
    /// cancellation while a fragmented request is still being transferred).
    pub fn control_batch(&self, frames: impl IntoIterator<Item = Frame>) -> Result<(), String> {
        if self.is_closed() {
            return Err("Responses worker pipe is closed".into());
        }
        self.queue
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .control
            .extend(frames);
        self.queue.changed.notify_all();
        Ok(())
    }
    pub fn data(&self, frame: Frame) -> Result<(), String> {
        if self.is_closed() {
            return Err("Responses worker pipe is closed".into());
        }
        let mut queued = self.queue.state.lock().unwrap_or_else(|e| e.into_inner());
        while (queued.data.len() >= 16 || queued.credits == 0) && !self.is_closed() {
            queued = self
                .queue
                .changed
                .wait(queued)
                .unwrap_or_else(|e| e.into_inner());
        }
        if self.is_closed() {
            return Err("Responses worker pipe is closed".into());
        }
        queued.data.push_back(frame);
        queued.credits -= 1;
        self.queue.changed.notify_all();
        Ok(())
    }
    pub fn call(&self, id: u64, callback: Callback) -> Result<CallbackResult, String> {
        let call = self.next_call.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::sync_channel(1);
        self.waiters
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert((id, call), Waiter::Sync(tx));
        if let Err(e) = self.control(Frame::Callback {
            generation: self.generation,
            id,
            call,
            callback,
        }) {
            self.waiters
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&(id, call));
            return Err(e);
        }
        // EOF is normally immediate; the bound also fails closed for a hung authority.
        let result = rx.recv_timeout(Duration::from_secs(30));
        self.waiters
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&(id, call));
        match result {
            Ok(result) => result,
            Err(_) => {
                self.invalidate("Responses worker authority did not answer");
                Err("Responses worker authority did not answer".into())
            }
        }
    }
    pub async fn call_async(&self, id: u64, callback: Callback) -> Result<CallbackResult, String> {
        let call = self.next_call.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.waiters
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert((id, call), Waiter::Async(tx));
        if let Err(e) = self.control(Frame::Callback {
            generation: self.generation,
            id,
            call,
            callback,
        }) {
            self.waiters
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&(id, call));
            return Err(e);
        }
        match tokio::time::timeout(Duration::from_secs(30), rx).await {
            Ok(Ok(result)) => result,
            _ => {
                self.invalidate("Responses worker async authority did not answer");
                Err("Responses worker async authority did not answer".into())
            }
        }
    }
    pub fn invalidate(&self, reason: impl Into<String>) {
        (self.fail)(reason.into());
    }
}
impl Drop for Endpoint {
    fn drop(&mut self) {
        self.alive.store(false, Ordering::Release);
        self.queue.changed.notify_all();
    }
}

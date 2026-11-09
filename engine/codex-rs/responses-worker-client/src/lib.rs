//! Thin reusable parent client for the bundled, private Responses worker process.
#[doc(hidden)]
pub mod ipc;
#[doc(hidden)]
pub mod protocol;
#[doc(hidden)]
pub mod telemetry;

use codex_api::ApiError;
use codex_api::Provider;
use codex_api::ResponseStream;
use codex_api::ResponsesApiRequest;
use codex_api::ResponsesOptions;
use codex_api::ResponsesWsRequest;
use codex_api::SharedAuthProvider;
use codex_http_client::HttpClientFactory;
use ipc::Endpoint;
use ipc::Incoming;
use protocol::Callback;
use protocol::CallbackResult;
use protocol::Command;
use protocol::Frame;
use sha2::Digest;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;
use std::time::Duration;
use std::time::Instant;
use telemetry::Observers;
use tokio::sync::mpsc;
use tokio::sync::oneshot;

fn error(message: impl Into<String>) -> ApiError {
    ApiError::Stream(message.into())
}

#[derive(Debug)]
pub enum HttpStreamError {
    ClientBuild(std::io::Error),
    Api(ApiError),
}
impl From<ApiError> for HttpStreamError {
    fn from(error: ApiError) -> Self {
        Self::Api(error)
    }
}
impl std::fmt::Display for HttpStreamError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ClientBuild(e) => e.fmt(f),
            Self::Api(e) => e.fmt(f),
        }
    }
}
impl std::error::Error for HttpStreamError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::ClientBuild(e) => Some(e),
            Self::Api(e) => Some(e),
        }
    }
}

#[derive(Clone)]
pub struct ResponsesWorker {
    inner: Arc<Worker>,
}
impl std::fmt::Debug for ResponsesWorker {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ResponsesWorker")
            .field("program", &self.inner.program)
            .field("initialized", &self.inner.process.initialized())
            .finish_non_exhaustive()
    }
}
struct Worker {
    program: PathBuf,
    factory: HttpClientFactory,
    expected_identity: Option<String>,
    // A failed initial spawn is remembered. Neither EOF nor a crash silently replays work.
    process: tokio::sync::OnceCell<Result<Arc<Process>, String>>,
}
struct Context {
    auth: Option<SharedAuthProvider>,
    observers: Observers,
    frames: mpsc::Sender<Frame>,
    started: Instant,
    cancelled: tokio::sync::watch::Sender<bool>,
}
struct Process {
    endpoint: Arc<Endpoint>,
    next_id: AtomicU64,
    contexts: Arc<Mutex<HashMap<u64, Arc<Context>>>>,
    stop: std::sync::mpsc::Sender<()>,
    reaper: Mutex<Option<std::thread::JoinHandle<()>>>,
}
struct SpawnGuard {
    stop: std::sync::mpsc::Sender<()>,
    reaper: Option<std::thread::JoinHandle<()>>,
}
impl Drop for SpawnGuard {
    fn drop(&mut self) {
        if let Some(reaper) = self.reaper.take() {
            let _ = self.stop.send(());
            let _ = reaper.join();
        }
    }
}

impl ResponsesWorker {
    pub fn new(program: PathBuf, factory: HttpClientFactory) -> Self {
        Self {
            inner: Arc::new(Worker {
                program,
                factory,
                expected_identity: None,
                process: tokio::sync::OnceCell::new(),
            }),
        }
    }
    /// Explicit source-fixture identity; production uses the selected bundle's receipt.
    pub fn with_expected_identity(self, sha256: String) -> Self {
        Self {
            inner: Arc::new(Worker {
                program: self.inner.program.clone(),
                factory: self.inner.factory.clone(),
                expected_identity: Some(sha256),
                process: tokio::sync::OnceCell::new(),
            }),
        }
    }
    async fn process(&self) -> Result<Arc<Process>, ApiError> {
        self.inner
            .process
            .get_or_init(|| async {
                spawn(
                    &self.inner.program,
                    &self.inner.factory,
                    self.inner.expected_identity.as_deref(),
                )
                .await
            })
            .await
            .clone()
            .map_err(error)
    }
    pub async fn stream_http(
        &self,
        provider: Provider,
        auth: SharedAuthProvider,
        request: ResponsesApiRequest,
        options: ResponsesOptions,
        request_telemetry: Option<Arc<dyn codex_api::RequestTelemetry>>,
        sse_telemetry: Option<Arc<dyn codex_api::SseTelemetry>>,
        reject_redirects: bool,
    ) -> Result<ResponseStream, HttpStreamError> {
        let process = self.process().await?;
        let turn_state = options.turn_state.clone();
        let command = Command::Http {
            provider: provider.into(),
            json: serde_json::to_string(&request).map_err(|e| error(e.to_string()))?,
            options: options.into(),
            defaults: codex_login::default_client::default_headers().into(),
            reject_redirects,
            request_telemetry: request_telemetry.is_some(),
            sse_telemetry: sse_telemetry.is_some(),
        };
        let (id, receiver) = process.begin(
            Some(auth),
            Observers {
                request: request_telemetry,
                sse: sse_telemetry,
                ..Observers::default()
            },
            command,
        )?;
        process.response(id, receiver, turn_state).await
    }
    pub async fn connect_websocket(
        &self,
        provider: Provider,
        auth: SharedAuthProvider,
        extra_headers: http::HeaderMap,
        default_headers: http::HeaderMap,
        turn_state: Option<Arc<OnceLock<String>>>,
        telemetry: Option<Arc<dyn codex_api::WebsocketTelemetry>>,
    ) -> Result<RemoteWebsocketConnection, ApiError> {
        let process = self.process().await?;
        let command = Command::Connect {
            provider: provider.into(),
            extra: extra_headers.into(),
            defaults: default_headers.into(),
            turn_state: turn_state.as_ref().and_then(|s| s.get().cloned()),
            telemetry: telemetry.is_some(),
        };
        let (id, mut receiver) = process.begin(
            Some(auth),
            Observers {
                websocket: telemetry,
                ..Observers::default()
            },
            command,
        )?;
        let mut guard = CancelOnDrop::new(process.clone(), id);
        match receiver.recv().await {
            Some(Frame::Connected {
                turn_state: observed,
                ..
            }) => {
                update_state(&turn_state, observed);
                guard.armed = false;
                Ok(RemoteWebsocketConnection { process, id })
            }
            Some(Frame::Error { error: e, .. }) => Err(decode_error(e)),
            _ => Err(error("Responses worker closed during WebSocket connect")),
        }
    }
}

pub struct RemoteWebsocketConnection {
    process: Arc<Process>,
    id: u64,
}
impl std::fmt::Debug for RemoteWebsocketConnection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RemoteWebsocketConnection")
            .field("id", &self.id)
            .finish_non_exhaustive()
    }
}
impl RemoteWebsocketConnection {
    pub async fn is_closed(&self) -> bool {
        if self.process.endpoint.is_closed() {
            return true;
        }
        let Ok((id, mut receiver)) = self.process.begin(
            None,
            Observers::default(),
            Command::IsClosed {
                connection: self.id,
            },
        ) else {
            return true;
        };
        let result = !matches!(
            receiver.recv().await,
            Some(Frame::Closed { closed: false, .. })
        );
        self.process.remove(id);
        result
    }
    pub async fn stream_request(
        &self,
        request: ResponsesWsRequest<'_>,
        connection_reused: bool,
        turn_state: Option<Arc<OnceLock<String>>>,
    ) -> Result<ResponseStream, ApiError> {
        let json = serde_json::to_string(&request).map_err(|e| error(e.to_string()))?;
        let (id, receiver) = self.process.begin(
            None,
            Observers::default(),
            Command::Websocket {
                connection: self.id,
                json,
                reused: connection_reused,
                turn_state: turn_state.as_ref().and_then(|s| s.get().cloned()),
            },
        )?;
        self.process
            .response(id, receiver, turn_state)
            .await
            .map_err(|e| match e {
                HttpStreamError::Api(e) => e,
                HttpStreamError::ClientBuild(e) => {
                    error(format!("invalid WebSocket client-build error: {e}"))
                }
            })
    }
}
impl Drop for RemoteWebsocketConnection {
    fn drop(&mut self) {
        let id = self.process.next_id.fetch_add(1, Ordering::Relaxed);
        let _ = self.process.endpoint.control(Frame::Command {
            generation: self.process.endpoint.generation(),
            id,
            command: Command::DropConnection {
                connection: self.id,
            },
        });
    }
}
fn update_state(state: &Option<Arc<OnceLock<String>>>, value: Option<String>) {
    if let (Some(state), Some(value)) = (state, value) {
        let _ = state.set(value);
    }
}
fn decode_error(value: codex_responses_worker_protocol::WireApiError) -> ApiError {
    value
        .into_api_error(Duration::ZERO)
        .unwrap_or_else(|e| error(format!("invalid Responses worker error: {e}")))
}

struct CancelOnDrop {
    process: Arc<Process>,
    id: u64,
    armed: bool,
}
impl CancelOnDrop {
    fn new(process: Arc<Process>, id: u64) -> Self {
        Self {
            process,
            id,
            armed: true,
        }
    }
}
impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        if self.armed {
            self.process.cancel(self.id);
        }
    }
}

impl Process {
    fn begin(
        &self,
        auth: Option<SharedAuthProvider>,
        observers: Observers,
        command: Command,
    ) -> Result<(u64, mpsc::Receiver<Frame>), ApiError> {
        if self.endpoint.is_closed() {
            return Err(error("Responses worker is unavailable"));
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (frames, receiver) = mpsc::channel(protocol::CREDITS + 4);
        let context = Arc::new(Context {
            auth,
            observers,
            frames,
            started: Instant::now(),
            cancelled: tokio::sync::watch::channel(false).0,
        });
        self.contexts
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, context);
        if let Err(e) = self.endpoint.control(Frame::Command {
            generation: self.endpoint.generation(),
            id,
            command,
        }) {
            self.remove(id);
            return Err(error(e));
        }
        Ok((id, receiver))
    }
    fn remove(&self, id: u64) {
        self.contexts
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id);
    }
    fn cancel(&self, id: u64) {
        if let Some(context) = self
            .contexts
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&id)
        {
            context.cancelled.send_replace(true);
        }
        let _ = self.endpoint.control(Frame::Cancel {
            generation: self.endpoint.generation(),
            id,
        });
    }
    async fn response(
        self: &Arc<Self>,
        id: u64,
        mut frames: mpsc::Receiver<Frame>,
        turn_state: Option<Arc<OnceLock<String>>>,
    ) -> Result<ResponseStream, HttpStreamError> {
        let mut guard = CancelOnDrop::new(self.clone(), id);
        let (request_id, interruptible) = match frames.recv().await {
            Some(Frame::Started {
                request_id,
                interruptible,
                turn_state: observed,
                ..
            }) => {
                update_state(&turn_state, observed);
                (request_id, interruptible)
            }
            Some(Frame::Error { error: e, .. }) => {
                let failure = decode_error(e);
                while let Some(frame) = frames.recv().await {
                    if matches!(frame, Frame::Terminated { .. }) {
                        break;
                    }
                }
                guard.armed = false;
                self.remove(id);
                return Err(failure.into());
            }
            Some(Frame::ClientBuildError { error: failure, .. }) => {
                let failure = failure.decode().unwrap_or_else(|e| e);
                while let Some(frame) = frames.recv().await {
                    if matches!(frame, Frame::Terminated { .. }) {
                        break;
                    }
                }
                guard.armed = false;
                self.remove(id);
                return Err(HttpStreamError::ClientBuild(failure));
            }
            _ => return Err(error("Responses worker closed before response start").into()),
        };
        let (tx_event, rx_event) = mpsc::channel(16);
        let (tx_interrupt, mut rx_interrupt) = oneshot::channel();
        let process = self.clone();
        guard.armed = false;
        let pump_task = tokio::spawn(async move {
            let mut guard = CancelOnDrop::new(process.clone(), id);
            let generation = process.endpoint.generation();
            let mut interrupted = false;
            let mut cancelled = false;
            let mut event_credits = 0;
            loop {
                tokio::select! {
                    biased;
                    _ = tx_event.closed(), if !cancelled => {
                        cancelled = true;
                        process.cancel(id);
                    }
                    result = &mut rx_interrupt, if !interrupted && interruptible => {
                        interrupted = true;
                        if result.is_ok() { let _ = process.endpoint.control(Frame::Interrupt { generation, id }); }
                    }
                    frame = frames.recv() => match frame {
                        Some(Frame::Event { event, .. }) => {
                            let value = event.map_err(decode_error).and_then(|e| e.try_into().map_err(|e| error(format!("invalid Responses worker event: {e}"))));
                            if !cancelled {
                                let mut value = Some(value);
                                loop {
                                    tokio::select! {
                                        biased;
                                        _ = tx_event.closed() => { cancelled = true; process.cancel(id); break; }
                                        result = &mut rx_interrupt, if !interrupted && interruptible => {
                                            interrupted = true;
                                            if result.is_ok() { let _ = process.endpoint.control(Frame::Interrupt { generation, id }); }
                                        }
                                        permit = tx_event.reserve() => {
                                            if let (Ok(permit), Some(value)) = (permit, value.take()) { permit.send(value); }
                                            break;
                                        }
                                    }
                                }
                            }
                            event_credits += 1;
                            if event_credits >= 4 { let _ = process.endpoint.control(Frame::Credit { generation, id, amount: event_credits }); event_credits = 0; }
                        }
                        Some(Frame::Terminated { turn_state: observed, .. }) => { update_state(&turn_state, observed); guard.armed = false; break; }
                        Some(Frame::Error { error: e, .. }) => { let _ = tx_event.send(Err(decode_error(e))).await; }
                        None => { let _ = tx_event.send(Err(error("Responses worker disconnected"))).await; break; }
                        _ => { let _ = tx_event.send(Err(error("invalid Responses worker stream state"))).await; break; }
                    }
                }
            }
            process.remove(id);
            // tx_event drops only after the remote producer's real termination acknowledgment.
        });
        Ok(ResponseStream {
            rx_event,
            upstream_request_id: request_id,
            interrupt: interruptible.then_some(tx_interrupt),
            pump_task: Some(pump_task),
        })
    }
}
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.endpoint.control(Frame::Shutdown);
        let _ = self.stop.send(());
        if let Some(reaper) = self.reaper.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = reaper.join();
        }
    }
}

#[doc(hidden)]
pub fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = sha2::Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let count = std::io::Read::read(&mut file, &mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn selected_identity(program: &Path, override_identity: Option<&str>) -> Result<String, String> {
    let expected = if let Some(value) = override_identity {
        value.to_string()
    } else {
        let receipt = program
            .parent()
            .ok_or("worker has no bundle directory")?
            .join("azrael-engine-build.json");
        let value: serde_json::Value = serde_json::from_slice(
            &fs::read(receipt).map_err(|e| format!("Responses worker selected receipt: {e}"))?,
        )
        .map_err(|e| e.to_string())?;
        let worker = &value["components"]["responsesWorker"];
        let name = program
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("invalid worker filename")?;
        let identity = worker["sha256"]
            .as_str()
            .ok_or("worker receipt has no identity")?;
        if worker["protocolVersion"].as_u64() != Some(protocol::VERSION as u64)
            || worker["binary"].as_str() != Some(name)
            || value["binaries"][name].as_str() != Some(identity)
        {
            return Err("Responses worker bundle identity mismatch".into());
        }
        identity.to_string()
    };
    if expected.len() != 64
        || !expected.bytes().all(|b| b.is_ascii_hexdigit())
        || hash_file(program)? != expected
    {
        return Err("Responses worker executable hash mismatch".into());
    }
    Ok(expected)
}

async fn spawn(
    program: &Path,
    factory: &HttpClientFactory,
    expected: Option<&str>,
) -> Result<Arc<Process>, String> {
    let program =
        fs::canonicalize(program).map_err(|e| format!("Responses worker missing: {e}"))?;
    let identity = selected_identity(&program, expected)?;
    let mut command = std::process::Command::new(&program);
    command
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    // Only transport/platform configuration crosses the environment boundary. Account
    // secrets and auth variables are transferred exclusively on the inherited private pipe.
    for name in [
        "SystemRoot",
        "WINDIR",
        "PATH",
        "HOME",
        "USERPROFILE",
        "TMP",
        "TEMP",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
        "no_proxy",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "CODEX_CA_CERTIFICATE",
        "NODE_EXTRA_CA_CERTS",
        "CODEX_SANDBOX",
    ] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Responses worker spawn: {e}"))?;
    let reader = child
        .stdout
        .take()
        .ok_or("Responses worker stdout unavailable")?;
    let writer = child
        .stdin
        .take()
        .ok_or("Responses worker stdin unavailable")?;
    let (stop, stop_rx) = std::sync::mpsc::channel();
    // The lifecycle owner always kills and actually waits/reaps, including handshake failure.
    let (reaped_tx, mut reaped) = tokio::sync::watch::channel(false);
    let reaper = std::thread::spawn(move || {
        let _ = stop_rx.recv();
        #[cfg(unix)]
        {
            // SAFETY: the child was created as its own process group; its positive
            // PID identifies that owned group. Never target the parent's group.
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
        }
        let _ = child.kill();
        let _ = child.wait();
        let _ = reaped_tx.send(true);
    });
    let mut child_guard = SpawnGuard {
        stop: stop.clone(),
        reaper: Some(reaper),
    };
    static GENERATION: AtomicU64 = AtomicU64::new(1);
    let generation = GENERATION.fetch_add(1, Ordering::Relaxed);
    let (endpoint, mut incoming) = Endpoint::start(generation, reader, writer);
    let handshake = tokio::time::timeout(Duration::from_secs(10), incoming.recv())
        .await
        .map_err(|_| "Responses worker handshake timeout".to_string())?;
    match handshake {
        Some(Incoming::Frame(Frame::Hello {
            version,
            identity: claimed,
            capabilities,
        })) if version == protocol::VERSION
            && claimed == identity
            && protocol::CAPABILITIES
                .iter()
                .all(|c| capabilities.iter().any(|v| v == c)) => {}
        _ => {
            let _ = stop.send(());
            return Err("Responses worker handshake identity/capability mismatch".into());
        }
    }
    if hash_file(&program)? != identity {
        let _ = stop.send(());
        return Err("Responses worker executable changed during spawn".into());
    }
    endpoint.control(Frame::Init {
        generation,
        system_proxy: matches!(
            factory.outbound_proxy_policy(),
            codex_http_client::OutboundProxyPolicy::RespectSystemProxy
        ),
        system_fallback: factory.allows_system_proxy_fallback(),
        managed: factory.network_policy().is_managed(),
    })?;
    match tokio::time::timeout(Duration::from_secs(10), incoming.recv()).await {
        Ok(Some(Incoming::Frame(Frame::Ready { generation: got }))) if got == generation => {}
        _ => {
            let _ = stop.send(());
            return Err("Responses worker initialization failed".into());
        }
    }
    let contexts = Arc::new(Mutex::new(HashMap::<u64, Arc<Context>>::new()));
    let process = Arc::new(Process {
        endpoint: endpoint.clone(),
        contexts: contexts.clone(),
        next_id: AtomicU64::new(1),
        stop,
        reaper: Mutex::new(child_guard.reaper.take()),
    });
    let factory = factory.clone();
    let weak = Arc::downgrade(&process);
    tokio::spawn(async move {
        let next_permit = Arc::new(AtomicU64::new(1));
        let mut data_credits = 0;
        let permits = Arc::new(Mutex::new(HashMap::<u64, oneshot::Sender<()>>::new()));
        while let Some(message) = incoming.recv().await {
            let Incoming::Frame(frame) = message else {
                break;
            };
            let data_frame = protocol::is_data_frame(&frame);
            match frame {
                Frame::Callback {
                    generation: got,
                    id,
                    call,
                    callback,
                } if got == generation => {
                    let context = contexts
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .get(&id)
                        .cloned();
                    let endpoint = endpoint.clone();
                    let factory = factory.clone();
                    let permits = permits.clone();
                    let next_permit = next_permit.clone();
                    tokio::spawn(async move {
                        let result = authority(
                            &endpoint,
                            &factory,
                            id,
                            context,
                            callback,
                            &permits,
                            &next_permit,
                        )
                        .await;
                        if call != 0 {
                            let _ = endpoint.control(Frame::CallbackReply {
                                generation,
                                id,
                                call,
                                result,
                            });
                        }
                    });
                }
                Frame::Telemetry {
                    generation: got,
                    id,
                    value,
                } if got == generation => {
                    let context = contexts
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .get(&id)
                        .cloned();
                    if let Some(context) = context {
                        if context
                            .observers
                            .dispatch(value, context.started.elapsed())
                            .is_err()
                        {
                            break;
                        }
                    } else {
                        break;
                    }
                }
                frame => {
                    let (got, id) = match &frame {
                        Frame::Started { generation, id, .. }
                        | Frame::Connected { generation, id, .. }
                        | Frame::Closed { generation, id, .. }
                        | Frame::Event { generation, id, .. }
                        | Frame::Error { generation, id, .. }
                        | Frame::ClientBuildError { generation, id, .. }
                        | Frame::Terminated { generation, id, .. } => (*generation, *id),
                        _ => break,
                    };
                    if got != generation {
                        break;
                    }
                    let context = contexts
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .get(&id)
                        .cloned();
                    let Some(context) = context else {
                        break;
                    };
                    if context.frames.is_closed() {
                        match frame {
                            Frame::Terminated { .. } => {
                                contexts
                                    .lock()
                                    .unwrap_or_else(|e| e.into_inner())
                                    .remove(&id);
                            }
                            Frame::Event { .. } => {
                                let _ = endpoint.control(Frame::Credit {
                                    generation,
                                    id,
                                    amount: 1,
                                });
                            }
                            _ => {
                                let _ = endpoint.control(Frame::Cancel { generation, id });
                            }
                        }
                    } else if context.frames.try_send(frame).is_err() {
                        break;
                    }
                }
            }
            if data_frame {
                data_credits += 1;
                if data_credits >= 8 {
                    let _ = endpoint.control(Frame::DataCredit {
                        generation,
                        amount: data_credits,
                    });
                    data_credits = 0;
                }
            }
        }
        endpoint.invalidate("Responses worker process terminated or protocol rejected");
        permits.lock().unwrap_or_else(|e| e.into_inner()).clear();
        for context in contexts.lock().unwrap_or_else(|e| e.into_inner()).values() {
            context.cancelled.send_replace(true);
        }
        if let Some(process) = weak.upgrade() {
            let _ = process.stop.send(());
        }
        if !*reaped.borrow() {
            let _ = reaped.changed().await;
        }
        contexts.lock().unwrap_or_else(|e| e.into_inner()).clear();
    });
    Ok(process)
}

async fn authority(
    endpoint: &Arc<Endpoint>,
    factory: &HttpClientFactory,
    id: u64,
    context: Option<Arc<Context>>,
    callback: Callback,
    permits: &Arc<Mutex<HashMap<u64, oneshot::Sender<()>>>>,
    next_permit: &Arc<AtomicU64>,
) -> CallbackResult {
    if let Callback::ReleasePermit { permit } = &callback {
        permits
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(permit);
        return CallbackResult::Unit;
    }
    if id == 0 && matches!(&callback, Callback::Auth(_) | Callback::AuthHeaders) {
        endpoint.invalidate("factory authority cannot authorize credentials");
        return CallbackResult::Failed("invalid credential authority".into());
    }
    if id != 0 && context.is_none() {
        return CallbackResult::Failed("stale Responses worker auth generation".into());
    }
    if context.as_ref().is_some_and(|c| *c.cancelled.borrow()) {
        return CallbackResult::Failed("Responses operation authority cancelled".into());
    }
    match callback {
        Callback::Auth(request) => {
            let Some(context) = &context else {
                return CallbackResult::Failed("missing request authority".into());
            };
            let Some(auth) = &context.auth else {
                return CallbackResult::Failed("missing request authority".into());
            };
            let request = match request.try_into() {
                Ok(request) => request,
                Err(e) => return CallbackResult::Failed(format!("invalid auth request: {e}")),
            };
            let mut cancelled = context.cancelled.subscribe();
            let result = tokio::select! {
                biased;
                _ = cancelled.changed() => Err(codex_api::AuthError::Build("Responses auth attempt cancelled".into())),
                result = auth.apply_auth(request) => result,
            };
            if *context.cancelled.borrow() {
                return CallbackResult::Auth(Err(protocol::AuthFailure::Build(
                    "Responses auth generation expired".into(),
                )));
            }
            let result = result
                .map_err(|e| match e {
                    codex_api::AuthError::Build(s) => protocol::AuthFailure::Build(s),
                    codex_api::AuthError::Transient(s) => protocol::AuthFailure::Transient(s),
                })
                .and_then(|r| {
                    r.try_into().map_err(|e| {
                        protocol::AuthFailure::Build(format!(
                            "invalid authoritative auth request: {e}"
                        ))
                    })
                });
            CallbackResult::Auth(result)
        }
        Callback::AuthHeaders => match context.as_ref().and_then(|c| c.auth.as_ref()) {
            Some(auth) => CallbackResult::Headers(auth.to_auth_headers().into()),
            None => CallbackResult::Failed("missing WebSocket authority".into()),
        },
        Callback::Acquire { url } => {
            let permit = url::Url::parse(&url)
                .map_err(|_| codex_http_client::NetworkPolicyDenied::Destination)
                .and_then(|url| factory.network_policy().acquire(&url));
            match permit {
                Ok(permit) => {
                    let id = next_permit.fetch_add(1, Ordering::Relaxed);
                    let (release, released) = oneshot::channel();
                    permits
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(id, release);
                    let endpoint = endpoint.clone();
                    tokio::spawn(async move {
                        tokio::select! { biased; _ = endpoint.closed() => {}, _ = permit.revoked() => { let _ = endpoint.control(Frame::Revoke { generation: endpoint.generation(), permit: id }); }, _ = released => {} }
                    });
                    CallbackResult::Permit(Ok(id))
                }
                Err(e) => CallbackResult::Permit(Err(e.into())),
            }
        }
        Callback::Cookies { url, global_only } => match url::Url::parse(&url) {
            Ok(url) => CallbackResult::Cookie(
                (if global_only {
                    factory.global_infrastructure_cookies(&url)
                } else {
                    factory.shared_cookies(&url)
                })
                .map(|v| (v.as_bytes().to_vec(), v.is_sensitive())),
            ),
            Err(_) => CallbackResult::Failed("invalid cookie URL".into()),
        },
        Callback::SetCookies {
            url,
            headers,
            global_only,
        } => match (url::Url::parse(&url), http::HeaderMap::try_from(headers)) {
            (Ok(url), Ok(headers)) => {
                if global_only {
                    factory.set_global_infrastructure_cookies(&url, &headers);
                } else {
                    factory.set_shared_cookies(&url, &headers);
                }
                CallbackResult::Unit
            }
            _ => CallbackResult::Failed("invalid cookie update".into()),
        },
        Callback::ReleasePermit { permit } => {
            permits
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&permit);
            CallbackResult::Unit
        }
    }
}

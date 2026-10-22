//! Per-thread private transport. A locator never grants storage or writer authority.
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::{Metadata, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, Result, bail, ensure};
use codex_uds::UnixStream;
use futures::{FutureExt, SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::{AsyncBufRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::{Message, protocol::WebSocketConfig};
use tokio_tungstenite::{WebSocketStream, client_async_with_config};

use crate::azrael::{AzraelDaemonEndpoint, read_bounded_line};
use crate::registration::{MAX_MESSAGE, connect_private_stream};

type Socket = WebSocketStream<UnixStream>;
const PRIVATE: &str = "\0azrael-session/";
const LIMIT: usize = 1024;
const QUEUE_BYTES: usize = 8 << 20;
const CONTROL_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Descriptor {
    schema: u32,
    protocol: u32,
    thread_id: String,
    workspace_id: String,
    instance_id: String,
    socket_path: PathBuf,
    engine_version: String,
    engine_identity: String,
    storage_compatibility: String,
}

fn canonical_thread(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
}

fn safe_metadata(meta: &Metadata, directory: bool) -> Result<()> {
    ensure!(
        !meta.file_type().is_symlink(),
        "session locator contains a symlink"
    );
    ensure!(
        if directory {
            meta.is_dir()
        } else {
            meta.is_file()
        },
        "invalid session locator type"
    );
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        ensure!(
            meta.file_attributes() & 0x400 == 0,
            "session locator contains a reparse point"
        );
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        // SAFETY: geteuid has no preconditions and does not mutate state.
        ensure!(
            meta.uid() == unsafe { libc::geteuid() },
            "session locator has another owner"
        );
        ensure!(
            directory || meta.nlink() == 1,
            "session locator has multiple links"
        );
    }
    Ok(())
}

fn same_file(a: &Metadata, b: &Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        a.dev() == b.dev() && a.ino() == b.ino() && a.len() == b.len()
    }
    #[cfg(not(unix))]
    {
        a.len() == b.len()
            && a.created().ok() == b.created().ok()
            && a.modified().ok() == b.modified().ok()
    }
}

fn validate_descriptor(d: &Descriptor, thread: &str, workspace: &Value) -> Result<()> {
    ensure!(
        d.schema == 1 && d.protocol == 1 && d.thread_id == thread,
        "unsupported or mismatched session locator"
    );
    ensure!(
        workspace.as_str() == Some(d.workspace_id.as_str()),
        "session belongs to another workspace"
    );
    ensure!(
        d.socket_path.is_absolute()
            && !d.engine_version.is_empty()
            && !d.storage_compatibility.is_empty(),
        "invalid session locator identity"
    );
    for id in [&d.engine_identity, &d.instance_id, &d.workspace_id] {
        ensure!(
            id.len() == 64
                && id
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
            "invalid session locator digest"
        );
    }
    Ok(())
}

fn locate(home: &Path, thread: &str, workspace: &Value) -> Result<Option<Descriptor>> {
    ensure!(
        canonical_thread(thread),
        "thread ID is not a canonical UUID"
    );
    let directory = home.join("azrael-thread-engines-v1");
    let path = directory.join(format!("{thread}.engine.json"));
    let before = match std::fs::symlink_metadata(&path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let home_before = std::fs::symlink_metadata(home)?;
    safe_metadata(&home_before, true)?;
    let parent = std::fs::symlink_metadata(&directory)?;
    safe_metadata(&parent, true)?;
    safe_metadata(&before, false)?;
    ensure!(
        before.len() <= 64 << 10,
        "session locator exceeds size limit"
    );
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(&path)?;
    let opened = file.metadata()?;
    safe_metadata(&opened, false)?;
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
        };
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        // SAFETY: the file owns a live handle and info is writable for this call.
        ensure!(
            unsafe { GetFileInformationByHandle(file.as_raw_handle().cast(), &mut info) } != 0,
            "cannot inspect session locator handle"
        );
        ensure!(
            info.nNumberOfLinks == 1 && info.dwFileAttributes & 0x400 == 0,
            "session locator handle has links or reparse metadata"
        );
    }
    ensure!(
        same_file(&before, &opened),
        "session locator changed before open"
    );
    let mut bytes = Vec::new();
    file.take((64 << 10) + 1).read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() <= 64 << 10,
        "session locator exceeds size limit"
    );
    let after = std::fs::symlink_metadata(&path)?;
    safe_metadata(&after, false)?;
    let parent_after = std::fs::symlink_metadata(&directory)?;
    safe_metadata(&parent_after, true)?;
    let home_after = std::fs::symlink_metadata(home)?;
    safe_metadata(&home_after, true)?;
    ensure!(
        same_file(&opened, &after)
            && same_file(&parent, &parent_after)
            && same_file(&home_before, &home_after),
        "session locator changed during read"
    );
    let descriptor: Descriptor = serde_json::from_slice(&bytes)?;
    validate_descriptor(&descriptor, thread, workspace)?;
    Ok(Some(descriptor))
}

async fn private_socket(path: &Path) -> Result<Socket> {
    let stream = connect_private_stream(path).await?;
    websocket(stream).await
}

#[derive(Debug)]
struct SourceUnavailable(std::io::Error);
impl std::fmt::Display for SourceUnavailable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "source endpoint is unavailable: {}", self.0)
    }
}
impl std::error::Error for SourceUnavailable {}

async fn source_socket(path: &Path) -> Result<Socket> {
    // Only confirmed absence/refusal before sending any source bytes permits
    // trying the selected engine's authoritative resume/storage acquisition.
    let stream = match connect_private_stream(path).await {
        Ok(stream) => stream,
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused
            ) =>
        {
            return Err(SourceUnavailable(error).into());
        }
        Err(error) => return Err(error.into()),
    };
    websocket(stream).await
}

async fn websocket(stream: UnixStream) -> Result<Socket> {
    let config = WebSocketConfig::default()
        .max_frame_size(Some(MAX_MESSAGE))
        .max_message_size(Some(MAX_MESSAGE));
    Ok(
        client_async_with_config("ws://localhost/rpc", stream, Some(config))
            .await?
            .0,
    )
}

async fn send(socket: &mut Socket, value: &Value) -> Result<()> {
    socket.send(Message::Text(value.to_string().into())).await?;
    Ok(())
}

// Only used before forwarding UI traffic onto this connection. No sent UI
// operation is retried, even if this bounded admission exchange fails.
async fn exchange(socket: &mut Socket, request: Value) -> Result<Value> {
    tokio::time::timeout(CONTROL_TIMEOUT, async {
        send(socket, &request).await?;
        loop {
            match socket.next().await {
                Some(Ok(Message::Text(text))) => {
                    let reply: Value = serde_json::from_str(&text)?;
                    ensure!(
                        reply["id"] == request["id"] && reply.get("method").is_none(),
                        "unexpected private handshake response"
                    );
                    ensure!(
                        reply.get("error").is_none() && reply.get("result").is_some(),
                        "private session handshake rejected"
                    );
                    return Ok(reply["result"].clone());
                }
                Some(Ok(Message::Ping(bytes))) => socket.send(Message::Pong(bytes)).await?,
                Some(Ok(Message::Pong(_))) => {}
                _ => bail!("private session handshake disconnected"),
            }
        }
    })
    .await
    .context("private session handshake timed out")?
}

fn verify_attach(result: &Value, d: &Descriptor) -> Result<()> {
    ensure!(
        result["schema"] == 1 && result["protocol"] == 1,
        "unsupported session attach protocol"
    );
    for (field, expected) in [
        ("threadId", &d.thread_id),
        ("instanceId", &d.instance_id),
        ("engineIdentity", &d.engine_identity),
        ("engineVersion", &d.engine_version),
        ("storageCompatibility", &d.storage_compatibility),
    ] {
        ensure!(
            result[field].as_str() == Some(expected.as_str()),
            "session attach {field} mismatch"
        );
    }
    ensure!(
        matches!(result["state"].as_str(), Some("busy" | "attached")),
        "unsupported session attach state"
    );
    Ok(())
}

async fn attach(
    d: &Descriptor,
    selected: &AzraelDaemonEndpoint,
    registration: &Value,
    initialize: &Value,
) -> Result<Socket> {
    let mut selected_probe = private_socket(&selected.socket_path).await?;
    let status = exchange(
        &mut selected_probe,
        json!({"id":format!("{PRIVATE}status"),"method":"azrael/engine/status"}),
    )
    .await?;
    ensure!(
        status["instanceId"] == selected.instance_id
            && status["engineIdentity"] == selected.engine_identity
            && status["engineVersion"] == selected.engine_version,
        "selected engine status identity mismatch"
    );
    ensure!(
        status["sessionHandoff"]["protocol"] == 1
            && status["sessionHandoff"]["storageCompatibility"].as_str()
                == Some(d.storage_compatibility.as_str()),
        "session storage protocols are incompatible"
    );
    drop(selected_probe);
    let mut first = true;
    let mut delay = Duration::from_millis(100);
    loop {
        // Only the initial connect can establish confirmed unavailability.
        // Once a source has answered busy, later connection loss cannot grant
        // fallback writer authority to the selected engine.
        let mut socket = if first {
            source_socket(&d.socket_path).await?
        } else {
            private_socket(&d.socket_path).await?
        };
        first = false;
        let result = exchange(&mut socket, json!({"id":format!("{PRIVATE}attach"),"method":"azrael/session/attach","params":{
            "schema":1,"protocol":1,"threadId":d.thread_id,"workspaceId":registration["workspaceId"],
            "ownerId":registration["ownerId"],"hostPid":registration["hostPid"],
            "targetInstanceId":selected.instance_id,"sourceInstanceId":d.instance_id,
            "sourceIdentity":d.engine_identity,"storageCompatibility":d.storage_compatibility
        }})).await?;
        verify_attach(&result, d)?;
        if result["state"] == "busy" {
            socket.close(None).await?;
            drop(socket);
            tokio::time::sleep(delay).await;
            delay = (delay * 2).min(Duration::from_secs(1));
            continue;
        }
        let mut initialize = initialize.clone();
        initialize["id"] = json!(format!("{PRIVATE}initialize"));
        exchange(&mut socket, initialize).await?;
        send(&mut socket, &json!({"method":"initialized"})).await?;
        return Ok(socket);
    }
}

#[derive(Debug, PartialEq)]
enum Phase {
    Source,
    Checking { id: String, deadline: Instant },
    Rehydrating { id: String, deadline: Instant },
    Acquiring { id: Value, deadline: Instant },
    Selected,
    Failed,
}

struct Route {
    phase: Phase,
    resume: Value,
    pending: HashMap<String, Value>,
    queue: VecDeque<Value>,
    queue_bytes: usize,
    next_poll: Instant,
    backoff: Duration,
}

impl Route {
    fn new(resume: Value) -> Self {
        Self {
            phase: Phase::Source,
            resume,
            pending: HashMap::new(),
            queue: VecDeque::new(),
            queue_bytes: 0,
            next_poll: Instant::now() + Duration::from_secs(2),
            backoff: Duration::from_secs(2),
        }
    }
    fn queue(&mut self, value: Value) -> Result<()> {
        let bytes = value.to_string().len();
        ensure!(
            self.queue.len() < LIMIT && self.queue_bytes + bytes <= QUEUE_BYTES,
            "session switching queue is full"
        );
        self.queue_bytes += bytes;
        self.queue.push_back(value);
        Ok(())
    }
    fn drain(&mut self) -> Vec<Value> {
        self.queue_bytes = 0;
        self.queue.drain(..).collect()
    }
    fn fail(&mut self) -> (Vec<Value>, Vec<Value>) {
        self.phase = Phase::Failed;
        let sent_ids = self.pending.drain().map(|(_, id)| id).collect();
        (sent_ids, self.drain())
    }
    fn sent(&mut self, value: &Value) -> Result<()> {
        if value.get("method").is_some()
            && let Some(id) = value.get("id")
        {
            ensure!(
                id.to_string().len() <= 4096,
                "source request ID exceeds limit"
            );
            ensure!(
                self.pending.len() < LIMIT,
                "too many outstanding source requests"
            );
            ensure!(
                !self.pending.contains_key(&id.to_string()),
                "duplicate outstanding source request ID"
            );
            self.pending.insert(id.to_string(), id.clone());
        }
        if value["method"] == "thread/resume" {
            self.resume = value.clone();
        }
        Ok(())
    }
}

#[derive(Default)]
struct Callbacks {
    next: u64,
    entries: HashMap<String, (String, Value)>,
}

// An authoritative acquire can finish after the UI has received an unknown
// outcome. Keep its original request ID occupied until that late reply is
// consumed, so it cannot be mistaken for a new selected-engine operation.
#[derive(Default)]
struct AcquisitionTombstones {
    ids: HashSet<String>,
}
impl AcquisitionTombstones {
    fn mark(&mut self, id: &Value) -> Result<()> {
        ensure!(
            self.ids.len() < LIMIT,
            "too many unresolved selected acquisitions"
        );
        self.ids.insert(id.to_string());
        Ok(())
    }
    fn rejects_request(&self, value: &Value) -> bool {
        value.get("method").is_some()
            && value
                .get("id")
                .is_some_and(|id| self.ids.contains(&id.to_string()))
    }
    fn consume_reply(&mut self, value: &Value) -> bool {
        value.get("method").is_none()
            && value
                .get("id")
                .is_some_and(|id| self.ids.remove(&id.to_string()))
    }
}
impl Callbacks {
    fn namespace(&mut self, thread: &str, value: &mut Value) -> Result<()> {
        if value.get("method").is_some()
            && let Some(id) = value.get("id").cloned()
        {
            ensure!(
                id.to_string().len() <= 4096,
                "source callback ID exceeds limit"
            );
            ensure!(
                self.entries.len() < LIMIT,
                "too many outstanding source callbacks"
            );
            self.next = self
                .next
                .checked_add(1)
                .context("source callback ID exhausted")?;
            let key = format!("{PRIVATE}callback/{}", self.next);
            self.entries.insert(key.clone(), (thread.to_owned(), id));
            value["id"] = json!(key);
        }
        Ok(())
    }
    fn reply(&mut self, value: &mut Value) -> Option<String> {
        if value.get("method").is_some() {
            return None;
        }
        let (thread, original) = self.entries.remove(value["id"].as_str()?)?;
        value["id"] = original;
        Some(thread)
    }
    fn has_thread(&self, thread: &str) -> bool {
        self.entries.values().any(|(t, _)| t == thread)
    }
}

fn thread_of(value: &Value) -> Option<&str> {
    value["params"]["threadId"].as_str()
}
fn reserved_request(value: &Value) -> bool {
    value.get("method").is_some()
        && value["id"]
            .as_str()
            .is_some_and(|id| id.starts_with(PRIVATE))
}

async fn output<W: AsyncWrite + Unpin>(stdout: &mut W, value: &Value) -> Result<()> {
    stdout.write_all(value.to_string().as_bytes()).await?;
    stdout.write_all(b"\n").await?;
    stdout.flush().await?;
    Ok(())
}

async fn reject<W: AsyncWrite + Unpin>(stdout: &mut W, value: &Value, message: &str) -> Result<()> {
    if let Some(id) = value.get("id") {
        output(
            stdout,
            &json!({"id":id,"error":{"code":-32001,"message":message}}),
        )
        .await?;
    } else {
        // A notification cannot receive an RPC error. Closing the transport is
        // the only truthful way to report that its write was not accepted.
        bail!("{message}");
    }
    Ok(())
}

async fn fail_route<W: AsyncWrite + Unpin>(route: &mut Route, stdout: &mut W) -> Result<()> {
    let (sent_ids, unsent) = route.fail();
    for id in sent_ids {
        reject(
            stdout,
            &json!({"id":id}),
            "source disconnected or handoff failed; sent request outcome is unknown; do not replay",
        )
        .await?;
    }
    for value in unsent {
        reject(
            stdout,
            &value,
            "session handoff failed; queued request was not sent",
        )
        .await?;
    }
    Ok(())
}

enum Event {
    Input(std::io::Result<usize>),
    Socket(
        String,
        Option<std::result::Result<Message, tokio_tungstenite::tungstenite::Error>>,
    ),
    Tick,
}

pub(crate) async fn run(
    selected: Socket,
    endpoint: AzraelDaemonEndpoint,
    registration: Value,
) -> Result<()> {
    let home = codex_utils_home_dir::find_codex_home()?;
    run_with_io(
        selected,
        endpoint,
        registration,
        &home,
        BufReader::new(tokio::io::stdin()),
        tokio::io::stdout(),
    )
    .await
}

async fn run_with_io<R: AsyncBufRead + Unpin, W: AsyncWrite + Unpin>(
    selected: Socket,
    endpoint: AzraelDaemonEndpoint,
    registration: Value,
    home: &Path,
    mut stdin: R,
    mut stdout: W,
) -> Result<()> {
    // Empty key is always the selected engine; UUID keys are independently scoped peers.
    let mut sockets = HashMap::from([(String::new(), selected)]);
    let mut routes: HashMap<String, Route> = HashMap::new();
    let mut callbacks = Callbacks::default();
    let mut acquisition_tombstones = AcquisitionTombstones::default();
    let mut initialize = None;
    let mut line = Vec::new();
    let mut tick = tokio::time::interval(Duration::from_millis(250));
    let mut sequence = 0_u64;
    loop {
        let event = tokio::select! {
            read = read_bounded_line(&mut stdin, &mut line) => Event::Input(read),
            incoming = async {
                let reads: Vec<_> = sockets.iter_mut().map(|(key, socket)| {
                    let key = key.clone();
                    async move { (key, socket.next().await) }.boxed()
                }).collect();
                futures::future::select_all(reads).await.0
            } => Event::Socket(incoming.0, incoming.1),
            _ = tick.tick() => Event::Tick,
        };
        match event {
            Event::Input(read) => {
                if read? == 0 {
                    // Dropping every socket also closes any peer whose close handshake fails.
                    for socket in sockets.values_mut() {
                        let _ =
                            tokio::time::timeout(Duration::from_secs(1), socket.close(None)).await;
                    }
                    return Ok(());
                }
                let mut value: Value = serde_json::from_slice(&line)?;
                line.clear();
                if let Some(thread) = callbacks.reply(&mut value) {
                    if let Some(socket) = sockets.get_mut(&thread) {
                        if send(socket, &value).await.is_err() {
                            sockets.remove(&thread);
                            fail_route(
                                routes.get_mut(&thread).context("missing callback route")?,
                                &mut stdout,
                            )
                            .await?;
                        }
                    } else {
                        bail!("source callback reply could not be delivered; outcome unknown");
                    }
                    continue;
                }
                if reserved_request(&value) {
                    reject(
                        &mut stdout,
                        &value,
                        "request ID uses reserved private transport namespace",
                    )
                    .await?;
                    continue;
                }
                if acquisition_tombstones.rejects_request(&value) {
                    reject(
                        &mut stdout,
                        &value,
                        "request ID belongs to an unresolved selected acquisition; use a new ID",
                    )
                    .await?;
                    continue;
                }
                ensure!(
                    !value["id"]
                        .as_str()
                        .is_some_and(|id| id.starts_with(PRIVATE)),
                    "unrecognized private callback response; reply was not forwarded"
                );
                if value["method"] == "initialize" {
                    initialize = Some(value.clone());
                }
                let thread = thread_of(&value).map(str::to_owned);
                if value["method"] == "thread/resume"
                    && let Some(thread) = thread.as_deref()
                    && !routes.contains_key(thread)
                {
                    ensure!(routes.len() < LIMIT, "too many foreign session routes");
                    match locate(&home, thread, &registration["workspaceId"]) {
                        Ok(Some(d)) if d.instance_id != endpoint.instance_id => {
                            let connection = if let Some(initialize) = initialize.as_ref() {
                                tokio::time::timeout(
                                    CONTROL_TIMEOUT * 3,
                                    attach(&d, &endpoint, &registration, initialize),
                                )
                                .await
                                .context("source attach timed out")
                                .and_then(|r| r)
                            } else {
                                Err(anyhow::anyhow!(
                                    "initialize must precede foreign thread resume"
                                ))
                            };
                            let mut route = Route::new(value.clone());
                            match connection {
                                Ok(socket) => {
                                    sockets.insert(thread.to_owned(), socket);
                                }
                                Err(error)
                                    if error.downcast_ref::<SourceUnavailable>().is_some() =>
                                {
                                    route.sent(&value)?;
                                    route.phase = Phase::Acquiring {
                                        id: value["id"].clone(),
                                        deadline: Instant::now() + CONTROL_TIMEOUT,
                                    };
                                    routes.insert(thread.to_owned(), route);
                                    send(
                                        sockets.get_mut("").context("missing selected socket")?,
                                        &value,
                                    )
                                    .await?;
                                    continue;
                                }
                                Err(error) => {
                                    route.phase = Phase::Failed;
                                    reject(
                                        &mut stdout,
                                        &value,
                                        &format!("source session attach failed: {error:#}"),
                                    )
                                    .await?;
                                    routes.insert(thread.to_owned(), route);
                                    continue;
                                }
                            }
                            routes.insert(thread.to_owned(), route);
                        }
                        Ok(_) => {}
                        Err(error) => {
                            let mut route = Route::new(value.clone());
                            route.phase = Phase::Failed;
                            routes.insert(thread.to_owned(), route);
                            reject(
                                &mut stdout,
                                &value,
                                &format!("session locator rejected: {error:#}"),
                            )
                            .await?;
                            continue;
                        }
                    }
                }
                if let Some(thread) = thread
                    && let Some(route) = routes.get_mut(&thread)
                {
                    match route.phase {
                        Phase::Source => {
                            if let Err(error) = route.sent(&value) {
                                reject(&mut stdout, &value, &error.to_string()).await?;
                            } else if send(
                                sockets.get_mut(&thread).context("missing source socket")?,
                                &value,
                            )
                            .await
                            .is_err()
                            {
                                sockets.remove(&thread);
                                fail_route(route, &mut stdout).await?;
                            }
                        }
                        Phase::Checking { .. }
                        | Phase::Rehydrating { .. }
                        | Phase::Acquiring { .. } => {
                            if let Err(error) = route.queue(value.clone()) {
                                reject(&mut stdout, &value, &error.to_string()).await?;
                            }
                        }
                        Phase::Selected => {
                            send(
                                sockets.get_mut("").context("missing selected socket")?,
                                &value,
                            )
                            .await?
                        }
                        Phase::Failed => {
                            reject(
                                &mut stdout,
                                &value,
                                "session route failed; reconnect explicitly; request was not sent",
                            )
                            .await?
                        }
                    }
                } else {
                    send(
                        sockets.get_mut("").context("missing selected socket")?,
                        &value,
                    )
                    .await?;
                }
            }
            Event::Socket(thread, message) => {
                match message {
                    Some(Ok(Message::Ping(bytes))) => {
                        if sockets
                            .get_mut(&thread)
                            .context("missing socket")?
                            .send(Message::Pong(bytes))
                            .await
                            .is_err()
                        {
                            if thread.is_empty() {
                                bail!(
                                    "selected engine disconnected; request outcomes may be unknown"
                                );
                            }
                            sockets.remove(&thread);
                            fail_route(
                                routes.get_mut(&thread).context("missing source route")?,
                                &mut stdout,
                            )
                            .await?;
                        }
                    }
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Text(text))) => {
                        let mut value: Value = serde_json::from_str(&text)?;
                        // Internal selected resume responses are consumed before UI output.
                        if thread.is_empty() {
                            if acquisition_tombstones.consume_reply(&value) {
                                continue;
                            }
                            let acquiring = routes.iter().find_map(|(thread, route)| match &route
                                .phase
                            {
                                Phase::Acquiring { id, .. }
                                    if value.get("id") == Some(id)
                                        && value.get("method").is_none() =>
                                {
                                    Some(thread.clone())
                                }
                                _ => None,
                            });
                            if let Some(thread) = acquiring {
                                let route =
                                    routes.get_mut(&thread).context("missing acquiring route")?;
                                route.pending.remove(&value["id"].to_string());
                                output(&mut stdout, &value).await?;
                                if value.get("error").is_some() || value.get("result").is_none() {
                                    fail_route(route, &mut stdout).await?;
                                } else {
                                    for value in route.drain() {
                                        send(
                                            sockets
                                                .get_mut("")
                                                .context("missing selected socket")?,
                                            &value,
                                        )
                                        .await?;
                                    }
                                    route.phase = Phase::Selected;
                                }
                                continue;
                            }
                            let rehydrating =
                                routes
                                    .iter()
                                    .find_map(|(thread, route)| match &route.phase {
                                        Phase::Rehydrating { id, .. }
                                            if value["id"].as_str() == Some(id)
                                                && value.get("method").is_none() =>
                                        {
                                            Some(thread.clone())
                                        }
                                        _ => None,
                                    });
                            if let Some(thread) = rehydrating {
                                let route =
                                    routes.get_mut(&thread).context("missing handoff route")?;
                                if value.get("error").is_some() || value.get("result").is_none() {
                                    fail_route(route, &mut stdout).await?;
                                } else {
                                    let queue = route.drain();
                                    for value in queue {
                                        send(
                                            sockets
                                                .get_mut("")
                                                .context("missing selected socket")?,
                                            &value,
                                        )
                                        .await?;
                                    }
                                    route.phase = Phase::Selected;
                                }
                                continue;
                            }
                        } else {
                            let route = routes.get_mut(&thread).context("missing source route")?;
                            let checking = matches!(&route.phase, Phase::Checking { id, .. } if value["id"].as_str() == Some(id) && value.get("method").is_none());
                            if checking {
                                match value["result"]["state"].as_str() {
                                    Some("busy") if value.get("error").is_none() => {
                                        route.phase = Phase::Source;
                                        route.backoff =
                                            (route.backoff * 2).min(Duration::from_secs(30));
                                        route.next_poll = Instant::now() + route.backoff;
                                        for value in route.drain() {
                                            route.sent(&value)?;
                                            if send(
                                                sockets
                                                    .get_mut(&thread)
                                                    .context("missing source socket")?,
                                                &value,
                                            )
                                            .await
                                            .is_err()
                                            {
                                                // A partially flushed queue must never be replayed.
                                                bail!(
                                                    "source disconnected flushing held requests; outcomes may be unknown"
                                                );
                                            }
                                        }
                                    }
                                    Some("released") if value.get("error").is_none() => {
                                        sockets.remove(&thread);
                                        sequence = sequence
                                            .checked_add(1)
                                            .context("handoff ID exhausted")?;
                                        let id = format!("{PRIVATE}resume/{sequence}");
                                        let mut resume = route.resume.clone();
                                        resume["id"] = json!(id);
                                        route.phase = Phase::Rehydrating {
                                            id,
                                            deadline: Instant::now() + CONTROL_TIMEOUT,
                                        };
                                        send(
                                            sockets
                                                .get_mut("")
                                                .context("missing selected socket")?,
                                            &resume,
                                        )
                                        .await?;
                                    }
                                    _ => {
                                        sockets.remove(&thread);
                                        fail_route(route, &mut stdout).await?;
                                    }
                                }
                                continue;
                            }
                            if value.get("method").is_none() {
                                route.pending.remove(&value["id"].to_string());
                            }
                            callbacks.namespace(&thread, &mut value)?;
                        }
                        // Never expose private controls, including late responses after timeout.
                        if value.get("method").is_none()
                            && value["id"]
                                .as_str()
                                .is_some_and(|id| id.starts_with(PRIVATE))
                        {
                            continue;
                        }
                        output(&mut stdout, &value).await?;
                    }
                    _ => {
                        if thread.is_empty() {
                            bail!("selected engine disconnected; request outcomes may be unknown");
                        }
                        sockets.remove(&thread);
                        fail_route(
                            routes.get_mut(&thread).context("missing source route")?,
                            &mut stdout,
                        )
                        .await?;
                    }
                }
            }
            Event::Tick => {
                for (thread, route) in &mut routes {
                    match &route.phase {
                        Phase::Checking { deadline, .. }
                        | Phase::Rehydrating { deadline, .. }
                        | Phase::Acquiring { deadline, .. }
                            if Instant::now() >= *deadline =>
                        {
                            if let Phase::Acquiring { id, .. } = &route.phase {
                                acquisition_tombstones.mark(id)?;
                            }
                            sockets.remove(thread);
                            fail_route(route, &mut stdout).await?;
                        }
                        Phase::Source
                            if route.pending.is_empty()
                                && !callbacks.has_thread(thread)
                                && Instant::now() >= route.next_poll =>
                        {
                            sequence = sequence.checked_add(1).context("handoff ID exhausted")?;
                            let id = format!("{PRIVATE}handoff/{sequence}");
                            route.phase = Phase::Checking {
                                id: id.clone(),
                                deadline: Instant::now() + CONTROL_TIMEOUT,
                            };
                            let request = json!({"id":id,"method":"azrael/session/handoff","params":{"threadId":thread,"targetInstanceId":endpoint.instance_id}});
                            if send(
                                sockets.get_mut(thread).context("missing source socket")?,
                                &request,
                            )
                            .await
                            .is_err()
                            {
                                sockets.remove(thread);
                                fail_route(route, &mut stdout).await?;
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const THREAD: &str = "01234567-89ab-cdef-0123-456789abcdef";
    fn descriptor() -> Descriptor {
        Descriptor {
            schema: 1,
            protocol: 1,
            thread_id: THREAD.into(),
            workspace_id: "a".repeat(64),
            instance_id: "b".repeat(64),
            socket_path: std::env::temp_dir().join("private.sock"),
            engine_version: "future".into(),
            engine_identity: "c".repeat(64),
            storage_compatibility: "schema-1".into(),
        }
    }
    #[test]
    fn canonical_selection_and_workspace_isolation() {
        assert!(canonical_thread(THREAD));
        assert!(!canonical_thread(&THREAD.to_uppercase()));
        assert!(!canonical_thread("../outside"));
        let d = descriptor();
        assert!(validate_descriptor(&d, THREAD, &json!(d.workspace_id)).is_ok());
        assert!(validate_descriptor(&d, THREAD, &json!("d".repeat(64))).is_err());
        assert!(validate_descriptor(&d, "another-thread", &json!(d.workspace_id)).is_err());
        assert_eq!(thread_of(&json!({"method":"account/read"})), None);
        assert_eq!(
            thread_of(&json!({"params":{"threadId":THREAD}})),
            Some(THREAD)
        );
    }
    #[test]
    fn every_attach_identity_field_is_verified() {
        let d = descriptor();
        let reply = json!({"schema":1,"protocol":1,"state":"attached","threadId":d.thread_id,"instanceId":d.instance_id,
            "engineIdentity":d.engine_identity,"engineVersion":d.engine_version,"storageCompatibility":d.storage_compatibility});
        assert!(verify_attach(&reply, &d).is_ok());
        for field in [
            "schema",
            "protocol",
            "threadId",
            "instanceId",
            "engineIdentity",
            "engineVersion",
            "storageCompatibility",
            "state",
        ] {
            let mut bad = reply.clone();
            bad[field] = Value::Null;
            assert!(verify_attach(&bad, &d).is_err(), "{field}");
        }
    }
    #[test]
    fn callback_collisions_and_responses_are_scoped_to_each_source() {
        let mut callbacks = Callbacks::default();
        let mut a = json!({"id":7,"method":"approval/request"});
        let mut b = a.clone();
        callbacks.namespace("a", &mut a).unwrap();
        callbacks.namespace("b", &mut b).unwrap();
        assert_ne!(a["id"], b["id"]);
        let mut response = json!({"id":b["id"],"error":{"code":-1}});
        assert_eq!(callbacks.reply(&mut response).as_deref(), Some("b"));
        assert_eq!(response["id"], 7);
        assert!(callbacks.has_thread("a"));
        assert!(!callbacks.has_thread("b"));
        assert!(reserved_request(&a));
        assert!(!reserved_request(&response));
    }
    #[test]
    fn switching_keeps_writes_and_pending_requests_separate_without_replay() {
        let resume = json!({"id":1,"method":"thread/resume","params":{"threadId":THREAD}});
        let mut route = Route::new(resume.clone());
        let mutation = json!({"id":2,"method":"turn/start","params":{"threadId":THREAD}});
        route.sent(&resume).unwrap();
        route.phase = Phase::Checking {
            id: "private".into(),
            deadline: Instant::now(),
        };
        route.queue(mutation.clone()).unwrap();
        assert_eq!(route.pending.len(), 1);
        assert_eq!(route.drain(), vec![mutation]);
        assert!(route.drain().is_empty());
        assert_eq!(route.resume, resume);
        assert!(route.sent(&resume).is_err());
        let independent = Route::new(json!({"id":3}));
        assert_eq!(independent.phase, Phase::Source);
        assert!(independent.pending.is_empty());
    }

    #[test]
    fn failed_handoff_distinguishes_sent_outcomes_from_unsent_writes() {
        let mut route = Route::new(json!({"id":1,"method":"thread/resume"}));
        let sent = json!({"id":2,"method":"turn/start"});
        let unsent = json!({"id":3,"method":"turn/interrupt"});
        route.sent(&sent).unwrap();
        route.phase = Phase::Rehydrating {
            id: "private".into(),
            deadline: Instant::now(),
        };
        route.queue(unsent.clone()).unwrap();
        let (unknown, rejected) = route.fail();
        assert_eq!(unknown, vec![json!(2)]);
        assert_eq!(rejected, vec![unsent]);
        assert_eq!(route.phase, Phase::Failed);
        assert!(route.pending.is_empty());
        assert!(route.queue.is_empty());
        assert_eq!(route.fail(), (vec![], vec![]));
    }

    #[test]
    fn timed_out_acquisition_ignores_late_success_and_never_replays_held_mutation() {
        let resume = json!({"id":12,"method":"thread/resume","params":{"threadId":THREAD}});
        let mutation = json!({"id":13,"method":"turn/start","params":{"threadId":THREAD}});
        let mut route = Route::new(resume.clone());
        route.sent(&resume).unwrap();
        route.phase = Phase::Acquiring {
            id: json!(12),
            deadline: Instant::now(),
        };
        route.queue(mutation.clone()).unwrap();
        let mut tombstones = AcquisitionTombstones::default();
        tombstones.mark(&json!(12)).unwrap();
        let (unknown, unsent) = route.fail();
        assert_eq!(unknown, vec![json!(12)]);
        assert_eq!(unsent, vec![mutation]);
        assert!(tombstones.rejects_request(&resume));
        assert!(!tombstones.rejects_request(&json!({"id":14,"method":"account/read"})));
        // A same-ID server callback must retain the selected server's namespace.
        assert!(!tombstones.consume_reply(&json!({"id":12,"method":"approval/request"})));
        assert!(tombstones.consume_reply(&json!({"id":12,"result":{"thread":{"id":THREAD}}})));
        assert!(!tombstones.rejects_request(&resume));
        assert_eq!(route.phase, Phase::Failed);
        assert!(route.drain().is_empty());
        assert!(route.pending.is_empty());
    }

    #[test]
    fn locator_rejects_oversize_and_multiply_linked_files() {
        let home = tempfile::tempdir().unwrap();
        let directory = home.path().join("azrael-thread-engines-v1");
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join(format!("{THREAD}.engine.json"));
        assert!(
            locate(home.path(), THREAD, &json!("a".repeat(64)))
                .unwrap()
                .is_none()
        );
        std::fs::write(&path, vec![b' '; (64 << 10) + 1]).unwrap();
        assert!(locate(home.path(), THREAD, &json!("a".repeat(64))).is_err());
        let d = descriptor();
        let valid = json!({"schema":1,"protocol":1,"threadId":d.thread_id,"workspaceId":d.workspace_id,
            "instanceId":d.instance_id,"socketPath":d.socket_path,"engineVersion":d.engine_version,
            "engineIdentity":d.engine_identity,"storageCompatibility":d.storage_compatibility});
        std::fs::write(&path, valid.to_string()).unwrap();
        assert!(
            locate(home.path(), THREAD, &json!("a".repeat(64)))
                .unwrap()
                .is_some()
        );
        std::fs::hard_link(&path, directory.join("other-link")).unwrap();
        assert!(locate(home.path(), THREAD, &json!("a".repeat(64))).is_err());
    }

    async fn fixture_receive(socket: &mut Socket) -> Option<Value> {
        loop {
            match socket.next().await {
                Some(Ok(Message::Text(text))) => return Some(serde_json::from_str(&text).unwrap()),
                Some(Ok(Message::Ping(bytes))) => socket.send(Message::Pong(bytes)).await.unwrap(),
                Some(Ok(Message::Pong(_))) => {}
                Some(Ok(Message::Close(_))) | None => return None,
                other => panic!("unexpected fixture websocket message: {other:?}"),
            }
        }
    }

    async fn fixture_accept(listener: &mut codex_uds::UnixListener) -> Socket {
        tokio_tungstenite::accept_async(listener.accept().await.unwrap())
            .await
            .unwrap()
    }

    async fn fixture_ui_read<R: AsyncBufRead + Unpin>(reader: &mut R) -> Value {
        let mut line = Vec::new();
        assert_ne!(read_bounded_line(reader, &mut line).await.unwrap(), 0);
        serde_json::from_slice(&line).unwrap()
    }

    async fn fixture_ui_send<W: AsyncWrite + Unpin>(writer: &mut W, value: Value) {
        output(writer, &value).await.unwrap();
    }

    type Recorded = std::sync::Arc<std::sync::Mutex<Vec<(String, Value)>>>;

    fn fixture_status(
        mut listener: codex_uds::UnixListener,
        endpoint: AzraelDaemonEndpoint,
        count: usize,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            for _ in 0..count {
                let mut socket = fixture_accept(&mut listener).await;
                let status = fixture_receive(&mut socket).await.unwrap();
                assert_eq!(status["method"], "azrael/engine/status");
                send(&mut socket, &json!({"id":status["id"],"result":{
                    "instanceId":endpoint.instance_id,"engineIdentity":endpoint.engine_identity,
                    "engineVersion":endpoint.engine_version,"sessionHandoff":{"protocol":1,"storageCompatibility":"schema-1"}
                }})).await.unwrap();
            }
        })
    }

    fn fixture_source(
        mut listener: codex_uds::UnixListener,
        descriptor: Descriptor,
        records: Recorded,
        phases: tokio::sync::mpsc::UnboundedSender<&'static str>,
        mut gates: tokio::sync::mpsc::UnboundedReceiver<()>,
        release: bool,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut socket = fixture_accept(&mut listener).await;
            let attach = fixture_receive(&mut socket).await.unwrap();
            assert_eq!(attach["method"], "azrael/session/attach");
            assert_eq!(attach["params"]["threadId"], descriptor.thread_id);
            send(&mut socket, &json!({"id":attach["id"],"result":{
                "schema":1,"protocol":1,"state":"attached","threadId":descriptor.thread_id,"instanceId":descriptor.instance_id,
                "engineIdentity":descriptor.engine_identity,"engineVersion":descriptor.engine_version,
                "storageCompatibility":descriptor.storage_compatibility
            }})).await.unwrap();
            let initialize = fixture_receive(&mut socket).await.unwrap();
            assert_eq!(initialize["method"], "initialize");
            assert!(initialize["id"].as_str().unwrap().starts_with(PRIVATE));
            send(&mut socket, &json!({"id":initialize["id"],"result":{}}))
                .await
                .unwrap();
            assert_eq!(
                fixture_receive(&mut socket).await.unwrap()["method"],
                "initialized"
            );
            let mut polls = 0;
            while let Some(value) = fixture_receive(&mut socket).await {
                records
                    .lock()
                    .unwrap()
                    .push((descriptor.thread_id.clone(), value.clone()));
                match value["method"].as_str() {
                    Some("thread/resume") => {
                        send(
                            &mut socket,
                            &json!({"id":value["id"],"result":{"source":descriptor.thread_id}}),
                        )
                        .await
                        .unwrap();
                        // All three servers deliberately use the same callback ID.
                        send(&mut socket, &json!({"id":7,"method":"approval/request","params":{"threadId":descriptor.thread_id}})).await.unwrap();
                    }
                    Some("azrael/session/handoff") => {
                        polls += 1;
                        let state = if release && polls == 2 {
                            "released"
                        } else {
                            "busy"
                        };
                        if release {
                            phases
                                .send(if polls == 1 { "busy" } else { "released" })
                                .unwrap();
                            gates.recv().await.unwrap();
                        }
                        send(
                            &mut socket,
                            &json!({"id":value["id"],"result":{"state":state}}),
                        )
                        .await
                        .unwrap();
                        if state == "released" {
                            break;
                        }
                    }
                    Some("turn/start") => {
                        send(
                            &mut socket,
                            &json!({"id":value["id"],"result":{"source":descriptor.thread_id}}),
                        )
                        .await
                        .unwrap();
                    }
                    None => {
                        assert_eq!(value["id"], 7);
                        assert!(value.get("result").is_some());
                    }
                    method => panic!("unexpected source method: {method:?}"),
                }
            }
        })
    }

    #[tokio::test]
    async fn real_websocket_sessions_callbacks_busy_release_and_no_turn_replay() {
        tokio::time::timeout(Duration::from_secs(25), async {
            const OTHER: &str = "11234567-89ab-cdef-0123-456789abcdef";
            let home = tempfile::tempdir().unwrap();
            let private = home.path().join("s");
            codex_uds::prepare_private_socket_directory(&private).await.unwrap();
            let selected_path = private.join("selected");
            let mut selected_listener = codex_uds::UnixListener::bind(&selected_path).await.unwrap();
            let endpoint = AzraelDaemonEndpoint { schema:2, instance_id:"d".repeat(64), socket_path:selected_path,
                engine_version:"selected".into(), engine_identity:"e".repeat(64) };
            let (client, server) = tokio::join!(private_socket(&endpoint.socket_path), fixture_accept(&mut selected_listener));
            let selected = client.unwrap();
            let records: Recorded = Default::default();
            let selected_records = records.clone();
            let selected_task = tokio::spawn(async move {
                let mut socket = server;
                while let Some(value) = fixture_receive(&mut socket).await {
                    selected_records.lock().unwrap().push(("selected".into(), value.clone()));
                    match value["method"].as_str() {
                        Some("initialize") => {
                            send(&mut socket, &json!({"id":value["id"],"result":{}})).await.unwrap();
                            send(&mut socket, &json!({"id":7,"method":"approval/request","params":{"selected":true}})).await.unwrap();
                        }
                        Some("initialized") => {},
                        Some("thread/resume" | "turn/start" | "account/read") => {
                            send(&mut socket, &json!({"id":value["id"],"result":{"selected":true}})).await.unwrap();
                        }
                        None => { assert_eq!(value["id"], 7); assert!(value.get("result").is_some()); }
                        method => panic!("unexpected selected method: {method:?}"),
                    }
                }
            });
            let status_task = fixture_status(selected_listener,endpoint.clone(),2);
            let directory = home.path().join("azrael-thread-engines-v1");
            std::fs::create_dir(&directory).unwrap();
            let (phase_tx, mut phase_rx) = tokio::sync::mpsc::unbounded_channel();
            let (gate_tx, gate_rx) = tokio::sync::mpsc::unbounded_channel();
            let (_, other_gate) = tokio::sync::mpsc::unbounded_channel();
            let mut a = descriptor(); a.socket_path = private.join("a");
            let mut b = descriptor(); b.thread_id = OTHER.into(); b.instance_id = "f".repeat(64); b.socket_path = private.join("b");
            let listener_a = codex_uds::UnixListener::bind(&a.socket_path).await.unwrap();
            let listener_b = codex_uds::UnixListener::bind(&b.socket_path).await.unwrap();
            for descriptor in [&a, &b] {
                std::fs::write(directory.join(format!("{}.engine.json",descriptor.thread_id)),serde_json::to_vec(descriptor).unwrap()).unwrap();
            }
            let source_a = fixture_source(listener_a,a,records.clone(),phase_tx.clone(),gate_rx,true);
            let source_b = fixture_source(listener_b,b,records.clone(),phase_tx,other_gate,false);
            let (ui, transport) = tokio::io::duplex(1 << 20);
            let (ui_read, mut ui_write) = tokio::io::split(ui);
            let (transport_read, transport_write) = tokio::io::split(transport);
            let mut ui_read = BufReader::new(ui_read);
            let home_path = home.path().to_path_buf();
            let proxy = tokio::spawn(async move {
                run_with_io(selected,endpoint,json!({"workspaceId":"a".repeat(64),"ownerId":"a".repeat(32),"hostPid":std::process::id()}),
                    &home_path,BufReader::new(transport_read),transport_write).await
            });
            fixture_ui_send(&mut ui_write,json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"fixture","version":"1"}}})).await;
            fixture_ui_send(&mut ui_write,json!({"method":"initialized"})).await;
            fixture_ui_send(&mut ui_write,json!({"id":2,"method":"thread/resume","params":{"threadId":THREAD}})).await;
            fixture_ui_send(&mut ui_write,json!({"id":3,"method":"thread/resume","params":{"threadId":OTHER}})).await;
            let mut initialized = false;
            let mut resumed = 0;
            let mut callback_ids = Vec::new();
            while !initialized || resumed < 2 || callback_ids.len() < 3 {
                let value = fixture_ui_read(&mut ui_read).await;
                if value["method"] == "approval/request" {
                    callback_ids.push(value["id"].clone());
                    fixture_ui_send(&mut ui_write,json!({"id":value["id"],"result":{"approved":true}})).await;
                } else if value["id"] == 1 { initialized = true; }
                else if value["id"] == 2 || value["id"] == 3 { resumed += 1; }
                else { panic!("unexpected initial UI output: {value}"); }
            }
            assert!(callback_ids.contains(&json!(7)));
            assert_ne!(callback_ids[0],callback_ids[1]);
            assert_ne!(callback_ids[0],callback_ids[2]);
            assert_ne!(callback_ids[1],callback_ids[2]);
            assert_eq!(phase_rx.recv().await,Some("busy"));
            fixture_ui_send(&mut ui_write,json!({"id":21,"method":"turn/start","params":{"threadId":THREAD}})).await;
            fixture_ui_send(&mut ui_write,json!({"id":22,"method":"account/read"})).await;
            // Receiving the account response proves the preceding mutation has
            // crossed the production input barrier before the busy reply arrives.
            assert_eq!(fixture_ui_read(&mut ui_read).await["id"],22);
            gate_tx.send(()).unwrap();
            let turn = fixture_ui_read(&mut ui_read).await;
            assert_eq!(turn["id"],21); assert_eq!(turn["result"]["source"],THREAD);
            assert_eq!(phase_rx.recv().await,Some("released"));
            fixture_ui_send(&mut ui_write,json!({"id":23,"method":"turn/start","params":{"threadId":THREAD}})).await;
            fixture_ui_send(&mut ui_write,json!({"id":24,"method":"account/read"})).await;
            assert_eq!(fixture_ui_read(&mut ui_read).await["id"],24);
            gate_tx.send(()).unwrap();
            let turn = fixture_ui_read(&mut ui_read).await;
            assert_eq!(turn["id"],23); assert_eq!(turn["result"]["selected"],true);
            fixture_ui_send(&mut ui_write,json!({"id":31,"method":"turn/start","params":{"threadId":OTHER}})).await;
            let turn = fixture_ui_read(&mut ui_read).await;
            assert_eq!(turn["id"],31); assert_eq!(turn["result"]["source"],OTHER);
            ui_write.shutdown().await.unwrap();
            proxy.await.unwrap().unwrap();
            selected_task.await.unwrap(); status_task.await.unwrap(); source_a.await.unwrap(); source_b.await.unwrap();
            let records = records.lock().unwrap();
            for (owner, id) in [(THREAD,21),("selected",23),(OTHER,31)] {
                let calls: Vec<_> = records.iter().filter(|(_,v)| v["method"] == "turn/start" && v["id"] == id).collect();
                assert_eq!(calls.len(),1,"turn must never replay"); assert_eq!(calls[0].0,owner);
            }
            assert_eq!(records.iter().filter(|(owner,v)| owner == "selected" && v["method"] == "thread/resume").count(),1);
            for owner in ["selected",THREAD,OTHER] {
                assert_eq!(records.iter().filter(|(actual,v)| actual == owner && v.get("method").is_none() && v["id"] == 7).count(),1);
            }
        }).await.expect("real transport fixture timed out");
    }

    #[tokio::test]
    async fn dead_locator_uses_selected_acquisition_once_and_keeps_denial_failed() {
        tokio::time::timeout(Duration::from_secs(10), async {
            const DENIED: &str = "21234567-89ab-cdef-0123-456789abcdef";
            let home = tempfile::tempdir().unwrap();
            let private = home.path().join("s");
            codex_uds::prepare_private_socket_directory(&private).await.unwrap();
            let path = private.join("selected");
            let mut listener = codex_uds::UnixListener::bind(&path).await.unwrap();
            let endpoint = AzraelDaemonEndpoint {schema:2,instance_id:"d".repeat(64),socket_path:path,
                engine_version:"selected".into(),engine_identity:"e".repeat(64)};
            let (client,server) = tokio::join!(private_socket(&endpoint.socket_path),fixture_accept(&mut listener));
            let status_task = fixture_status(listener,endpoint.clone(),2);
            let records: Recorded = Default::default();
            let observed = records.clone();
            let selected_task = tokio::spawn(async move {
                let mut socket = server;
                while let Some(value) = fixture_receive(&mut socket).await {
                    observed.lock().unwrap().push(("selected".into(),value.clone()));
                    let result = if value["method"] == "thread/resume" && value["params"]["threadId"] == DENIED {
                        json!({"id":value["id"],"error":{"code":-32001,"message":"storage lease is still held"}})
                    } else {json!({"id":value["id"],"result":{"selected":true}})};
                    send(&mut socket,&result).await.unwrap();
                }
            });
            let directory = home.path().join("azrael-thread-engines-v1");
            std::fs::create_dir(&directory).unwrap();
            for thread in [THREAD,DENIED] {
                let mut d = descriptor(); d.thread_id = thread.into(); d.socket_path = private.join("missing");
                std::fs::write(directory.join(format!("{thread}.engine.json")),serde_json::to_vec(&d).unwrap()).unwrap();
            }
            let (ui,transport) = tokio::io::duplex(1 << 20);
            let (ui_read,mut ui_write) = tokio::io::split(ui);
            let (transport_read,transport_write) = tokio::io::split(transport);
            let mut ui_read = BufReader::new(ui_read);
            let home_path = home.path().to_path_buf();
            let proxy = tokio::spawn(async move {
                run_with_io(client.unwrap(),endpoint,json!({"workspaceId":"a".repeat(64),"ownerId":"a".repeat(32),"hostPid":std::process::id()}),
                    &home_path,BufReader::new(transport_read),transport_write).await
            });
            fixture_ui_send(&mut ui_write,json!({"id":1,"method":"initialize"})).await;
            assert_eq!(fixture_ui_read(&mut ui_read).await["id"],1);
            fixture_ui_send(&mut ui_write,json!({"id":2,"method":"thread/resume","params":{"threadId":THREAD}})).await;
            fixture_ui_send(&mut ui_write,json!({"id":3,"method":"turn/start","params":{"threadId":THREAD}})).await;
            assert_eq!(fixture_ui_read(&mut ui_read).await["id"],2);
            assert_eq!(fixture_ui_read(&mut ui_read).await["id"],3);
            fixture_ui_send(&mut ui_write,json!({"id":4,"method":"thread/resume","params":{"threadId":DENIED}})).await;
            let denied = fixture_ui_read(&mut ui_read).await;
            assert_eq!(denied["id"],4); assert!(denied.get("error").is_some());
            fixture_ui_send(&mut ui_write,json!({"id":5,"method":"turn/start","params":{"threadId":DENIED}})).await;
            let rejected = fixture_ui_read(&mut ui_read).await;
            assert_eq!(rejected["id"],5); assert!(rejected.get("error").is_some());
            ui_write.shutdown().await.unwrap();
            proxy.await.unwrap().unwrap(); selected_task.await.unwrap(); status_task.await.unwrap();
            let records = records.lock().unwrap();
            assert_eq!(records.iter().filter(|(_,v)| v["method"] == "thread/resume").count(),2);
            assert_eq!(records.iter().filter(|(_,v)| v["method"] == "turn/start").count(),1);
            assert!(directory.join(format!("{THREAD}.engine.json")).is_file());
            assert!(directory.join(format!("{DENIED}.engine.json")).is_file());
        }).await.expect("dead-source acquisition fixture timed out");
    }

    #[tokio::test]
    async fn busy_attach_preserves_original_control_until_attached_without_business_replay() {
        tokio::time::timeout(Duration::from_secs(10), async {
            let home = tempfile::tempdir().unwrap();
            let private = home.path().join("s");
            codex_uds::prepare_private_socket_directory(&private).await.unwrap();
            let selected_path = private.join("selected");
            let selected_listener = codex_uds::UnixListener::bind(&selected_path).await.unwrap();
            let selected = AzraelDaemonEndpoint {schema:2,instance_id:"d".repeat(64),socket_path:selected_path,
                engine_version:"selected".into(),engine_identity:"e".repeat(64)};
            let status_task = fixture_status(selected_listener,selected.clone(),1);
            let mut d = descriptor(); d.socket_path = private.join("source");
            let mut listener = codex_uds::UnixListener::bind(&d.socket_path).await.unwrap();
            // This socket represents the existing exact-thread controller. Its
            // business RPC remains usable while the later private attach is busy.
            let (original,original_server) = tokio::join!(private_socket(&d.socket_path),fixture_accept(&mut listener));
            let mut original = original.unwrap();
            let original_task = tokio::spawn(async move {
                let mut socket = original_server;
                let turn = fixture_receive(&mut socket).await.unwrap();
                assert_eq!(turn["method"],"turn/start"); assert_eq!(turn["id"],77);
                send(&mut socket,&json!({"id":77,"result":{"original":true}})).await.unwrap();
                assert!(fixture_receive(&mut socket).await.is_none());
            });
            let (busy_tx,mut busy_rx) = tokio::sync::mpsc::unbounded_channel();
            let (released_tx,mut released_rx) = tokio::sync::mpsc::unbounded_channel();
            let descriptor = d.clone();
            let source_task = tokio::spawn(async move {
                let mut busy = fixture_accept(&mut listener).await;
                let request = fixture_receive(&mut busy).await.unwrap();
                assert_eq!(request["method"],"azrael/session/attach");
                let mut result = json!({"schema":1,"protocol":1,"state":"busy","threadId":descriptor.thread_id,
                    "instanceId":descriptor.instance_id,"engineIdentity":descriptor.engine_identity,
                    "engineVersion":descriptor.engine_version,"storageCompatibility":descriptor.storage_compatibility});
                send(&mut busy,&json!({"id":request["id"],"result":result})).await.unwrap();
                busy_tx.send(()).unwrap();
                // The rejected connection receives no initialize/resume/turn.
                assert!(fixture_receive(&mut busy).await.is_none());
                drop(busy);
                released_rx.recv().await.unwrap();
                let mut attached = fixture_accept(&mut listener).await;
                let request = fixture_receive(&mut attached).await.unwrap();
                assert_eq!(request["method"],"azrael/session/attach");
                result["state"] = json!("attached");
                send(&mut attached,&json!({"id":request["id"],"result":result})).await.unwrap();
                let initialize = fixture_receive(&mut attached).await.unwrap();
                assert_eq!(initialize["method"],"initialize");
                send(&mut attached,&json!({"id":initialize["id"],"result":{}})).await.unwrap();
                assert_eq!(fixture_receive(&mut attached).await.unwrap()["method"],"initialized");
                let resume = fixture_receive(&mut attached).await.unwrap();
                assert_eq!(resume["method"],"thread/resume"); assert_eq!(resume["id"],88);
                send(&mut attached,&json!({"id":88,"result":{"attached":true}})).await.unwrap();
                assert!(fixture_receive(&mut attached).await.is_none());
            });
            let attach_task = tokio::spawn(async move {
                tokio::time::timeout(CONTROL_TIMEOUT * 3,attach(&d,&selected,
                    &json!({"workspaceId":"a".repeat(64),"ownerId":"a".repeat(32),"hostPid":std::process::id()}),
                    &json!({"id":1,"method":"initialize"}))).await.unwrap()
            });
            busy_rx.recv().await.unwrap();
            send(&mut original,&json!({"id":77,"method":"turn/start","params":{"threadId":THREAD}})).await.unwrap();
            let result = fixture_receive(&mut original).await.unwrap();
            assert_eq!(result["id"],77); assert_eq!(result["result"]["original"],true);
            original.close(None).await.unwrap();
            drop(original); original_task.await.unwrap();
            released_tx.send(()).unwrap();
            let mut attached = attach_task.await.unwrap().unwrap();
            send(&mut attached,&json!({"id":88,"method":"thread/resume","params":{"threadId":THREAD}})).await.unwrap();
            assert_eq!(fixture_receive(&mut attached).await.unwrap()["id"],88);
            attached.close(None).await.unwrap(); drop(attached);
            source_task.await.unwrap(); status_task.await.unwrap();
        }).await.expect("busy admission fixture timed out");
    }
}

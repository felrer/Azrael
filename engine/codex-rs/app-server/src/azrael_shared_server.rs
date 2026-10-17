//! Private shared engine: transport resources are shared, account/thread authority is not.
use crate::message_processor::{MessageProcessor, MessageProcessorArgs};
use crate::outgoing_message::{ConnectionId, OutgoingEnvelope, OutgoingMessageSender};
use crate::request_processors::AzraelAccountStatePaths;
use crate::transport::{
    AppServerTransport, CHANNEL_CAPACITY, ConnectionOrigin, ConnectionState, TransportEvent,
};
use crate::{AppServerExit, OutboundControlEvent};
use codex_app_server_daemon::{AzraelProcessIdentity, capture_process_identity};
use codex_app_server_protocol::{JSONRPCErrorError, JSONRPCMessage, RequestId};
use codex_app_server_transport::{OutgoingError, OutgoingMessage};
use codex_protocol::ThreadId;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    Arc, RwLock,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

const RECONNECT_GRACE: Duration = Duration::from_secs(3);
const STARTUP_NO_WINDOW_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(35);

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Registration {
    schema: u32,
    role: Role,
    owner_id: String,
    workspace_id: String,
    host_pid: u32,
    account_state_file: PathBuf,
    account_default_file: Option<PathBuf>,
    engine_version: String,
    engine_identity: String,
}
#[derive(Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Role {
    Window,
    Companion,
}

fn invalid(message: impl std::fmt::Display) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.to_string())
}
fn is_hex(value: &str, minimum: usize, maximum: usize) -> bool {
    (minimum..=maximum).contains(&value.len())
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
impl Registration {
    fn validate(&self, version: &str, identity: &str) -> io::Result<()> {
        if self.schema != 1
            || !is_hex(&self.owner_id, 32, 64)
            || !is_hex(&self.workspace_id, 64, 64)
            || !is_hex(&self.engine_identity, 64, 64)
            || self.host_pid == 0
        {
            return Err(invalid("invalid window registration identity"));
        }
        if self.engine_version != version || self.engine_identity != identity {
            return Err(invalid(
                "window engine version or executable identity mismatch",
            ));
        }
        AzraelAccountStatePaths::new(
            self.account_state_file.clone(),
            self.account_default_file.clone(),
        )?;
        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Owner {
    workspace_id: String,
    account_state_file: PathBuf,
    account_default_file: Option<PathBuf>,
    /// Stable processor authority; every companion/UI alias moves together on rejoin.
    context: String,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SavedRegistry {
    schema: u32,
    #[serde(default)]
    instance_id: Option<String>,
    owners: HashMap<String, Owner>,
    threads: HashMap<String, String>,
}
struct Lease {
    pid: u32,
    identity: AzraelProcessIdentity,
}
struct Registry {
    saved: SavedRegistry,
    leases: HashMap<String, Lease>,
    registered_at: HashMap<String, u64>,
    disappeared_at: HashMap<String, u64>,
    work_owned: HashSet<String>,
    sequence: u64,
    had_window: bool,
    startup_started: Instant,
    stopping: bool,
    last_window_gone: Option<Instant>,
}
impl Registry {
    fn load_scoped(path: &Path, instance: &str) -> io::Result<Self> {
        let mut registry = Self::load(path)?;
        if path.try_exists()? {
            if registry.saved.instance_id.as_deref() != Some(instance) {
                return Err(invalid("window registry engine instance mismatch"));
            }
        } else {
            registry.saved.instance_id = Some(instance.to_owned());
        }
        Ok(registry)
    }
    fn load(path: &Path) -> io::Result<Self> {
        let saved = match std::fs::read(path) {
            Ok(bytes) => serde_json::from_slice::<SavedRegistry>(&bytes).map_err(invalid)?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => SavedRegistry {
                schema: 1,
                ..Default::default()
            },
            Err(error) => return Err(error),
        };
        if saved.schema != 1 {
            return Err(invalid("unsupported window owner registry schema"));
        }
        for (id, owner) in &saved.owners {
            if !is_hex(id, 32, 64)
                || !is_hex(&owner.workspace_id, 64, 64)
                || !saved.owners.contains_key(&owner.context)
            {
                return Err(invalid("corrupt window owner registry"));
            }
            AzraelAccountStatePaths::new(
                owner.account_state_file.clone(),
                owner.account_default_file.clone(),
            )?;
        }
        for (thread, owner) in &saved.threads {
            if ThreadId::from_string(thread).is_err() || !saved.owners.contains_key(owner) {
                return Err(invalid("corrupt window thread ownership"));
            }
        }
        // Previous process owners have already disappeared; new registrations may rejoin them.
        let disappeared_at = saved.owners.keys().map(|id| (id.clone(), 0)).collect();
        Ok(Self {
            saved,
            leases: HashMap::new(),
            registered_at: HashMap::new(),
            disappeared_at,
            work_owned: HashSet::new(),
            sequence: 0,
            had_window: false,
            startup_started: Instant::now(),
            stopping: false,
            last_window_gone: None,
        })
    }
    fn save(&self, path: &Path) -> io::Result<()> {
        atomic_json(path, &self.saved)
    }
    fn context(&self, owner: &str) -> io::Result<String> {
        self.saved
            .owners
            .get(owner)
            .map(|o| o.context.clone())
            .ok_or_else(|| invalid("unregistered owner"))
    }
    fn bind(&mut self, request: &Registration) -> io::Result<()> {
        if self.stopping {
            return Err(invalid("shared engine is stopping"));
        }
        if let Some(owner) = self.saved.owners.get(&request.owner_id) {
            if owner.workspace_id != request.workspace_id
                || owner.account_state_file != request.account_state_file
                || owner.account_default_file != request.account_default_file
            {
                return Err(invalid("owner workspace/account path binding mismatch"));
            }
        } else {
            // Separate window account files must never share a mutable account-state path.
            if self
                .saved
                .owners
                .values()
                .any(|o| o.account_state_file == request.account_state_file)
            {
                return Err(invalid("account state path belongs to another window"));
            }
            self.saved.owners.insert(
                request.owner_id.clone(),
                Owner {
                    workspace_id: request.workspace_id.clone(),
                    account_state_file: request.account_state_file.clone(),
                    account_default_file: request.account_default_file.clone(),
                    context: request.owner_id.clone(),
                },
            );
        }
        Ok(())
    }
    fn admit_window(
        &mut self,
        owner: &str,
        pid: u32,
        identity: AzraelProcessIdentity,
    ) -> io::Result<()> {
        if let Some(existing) = self.leases.get(owner) {
            if existing.pid != pid {
                return Err(invalid("live owner host PID cannot change"));
            }
            return Ok(());
        }
        self.sequence += 1;
        self.registered_at.insert(owner.into(), self.sequence);
        self.disappeared_at.remove(owner);
        self.leases.insert(owner.into(), Lease { pid, identity });
        self.had_window = true;
        self.last_window_gone = None;
        Ok(())
    }
    fn host_disappeared(&mut self, owner: &str) {
        if self.leases.remove(owner).is_some() {
            self.sequence += 1;
            self.disappeared_at.insert(owner.into(), self.sequence);
        }
        if self.leases.is_empty() && self.had_window && self.last_window_gone.is_none() {
            self.last_window_gone = Some(Instant::now());
        }
    }
    fn no_window_shutdown_reason_at(&self, now: Instant) -> Option<&'static str> {
        if !self.leases.is_empty() {
            return None;
        }
        if !self.had_window {
            return (now.saturating_duration_since(self.startup_started)
                >= STARTUP_NO_WINDOW_TIMEOUT)
                .then_some("startup_no_window_timeout");
        }
        self.last_window_gone
            .filter(|since| now.saturating_duration_since(*since) >= RECONNECT_GRACE)
            .map(|_| "last_window_closed")
    }

    fn context_is_live(&self, context: &str) -> bool {
        self.leases.keys().any(|owner| {
            self.saved
                .owners
                .get(owner)
                .is_some_and(|o| o.context == context)
        })
    }
    fn select_thread(&mut self, requester: &str, thread: &str, resume: bool) -> io::Result<String> {
        ThreadId::from_string(thread).map_err(invalid)?;
        let current = self.context(requester)?;
        let Some(original) = self.saved.threads.get(thread).cloned() else {
            self.saved.threads.insert(thread.into(), current.clone());
            self.work_owned.insert(current.clone());
            return Ok(current);
        };
        if current == original {
            self.work_owned.insert(current.clone());
            return Ok(current);
        }
        let original_owner = self
            .saved
            .owners
            .get(&original)
            .ok_or_else(|| invalid("missing thread owner"))?;
        let requester_owner = self
            .saved
            .owners
            .get(requester)
            .ok_or_else(|| invalid("missing window owner"))?;
        let disappeared = self
            .saved
            .owners
            .iter()
            .filter(|(_, owner)| owner.context == original)
            .filter_map(|(id, _)| self.disappeared_at.get(id))
            .max()
            .copied()
            .unwrap_or(0);
        let new_registration = self
            .registered_at
            .get(requester)
            .is_some_and(|sequence| *sequence > disappeared);
        if !resume
            || self.context_is_live(&original)
            || original_owner.workspace_id != requester_owner.workspace_id
            || self.work_owned.contains(&current)
            || !new_registration
        {
            return Err(invalid("thread belongs to another window"));
        }
        // Move all aliases of the new, unused context; retain original processor and callbacks.
        for owner in self.saved.owners.values_mut() {
            if owner.context == current {
                owner.context = original.clone();
            }
        }
        self.work_owned.insert(original.clone());
        Ok(original)
    }
}

fn atomic_json(path: &Path, value: &impl Serialize) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| invalid("owner registry has no parent"))?;
    std::fs::create_dir_all(parent)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    serde_json::to_writer(temporary.as_file_mut(), value).map_err(invalid)?;
    temporary.as_file_mut().write_all(b"\n")?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    Ok(())
}

struct Context {
    processor: Arc<MessageProcessor>,
    tasks: Vec<tokio::task::JoinHandle<()>>,
}
enum ContextEvent {
    Outgoing(String, OutgoingEnvelope),
    ThreadCreated(String, ThreadId),
    Failed(String),
}
impl Drop for Context {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
    }
}
async fn create_context(
    template: &MessageProcessorArgs,
    owner: &Owner,
    id: &str,
    events: mpsc::Sender<ContextEvent>,
) -> io::Result<Context> {
    let mut args = template.clone();
    let manager = args.config_manager.fork_for_window();
    let (config, auth) = manager.load_azrael_window_config(&args.config).await?;
    args.config = Arc::new(config);
    args.config_manager = manager;
    args.auth_manager = Arc::clone(&auth);
    args.analytics_events_client = crate::analytics_utils::analytics_events_client_from_config(
        Arc::clone(&auth),
        &args.config,
    );
    args.user_verification = Arc::new(crate::user_verification::Service::new(auth));
    args.azrael_account_state_paths = Some(AzraelAccountStatePaths::new(
        owner.account_state_file.clone(),
        owner.account_default_file.clone(),
    )?);
    let (tx, mut rx) = mpsc::channel(CHANNEL_CAPACITY);
    args.outgoing = Arc::new(OutgoingMessageSender::new(
        tx,
        args.analytics_events_client.clone(),
    ));
    // Private window contexts cannot enroll remote transports sharing another window's auth.
    args.remote_control_handle = None;
    let processor = Arc::new(MessageProcessor::new(args));
    processor.restore_azrael_profile().await;
    let mut threads = processor.thread_created_receiver();
    let outgoing_events = events.clone();
    let outgoing_id = id.to_owned();
    let outgoing_task = tokio::spawn(async move {
        while let Some(envelope) = rx.recv().await {
            if outgoing_events
                .send(ContextEvent::Outgoing(outgoing_id.clone(), envelope))
                .await
                .is_err()
            {
                break;
            }
        }
    });
    let thread_id = id.to_owned();
    let thread_task = tokio::spawn(async move {
        loop {
            match threads.recv().await {
                Ok(thread) => {
                    if events
                        .send(ContextEvent::ThreadCreated(thread_id.clone(), thread))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    let _ = events.send(ContextEvent::Failed(thread_id.clone())).await;
                    break;
                }
            }
        }
    });
    Ok(Context {
        processor,
        tasks: vec![outgoing_task, thread_task],
    })
}
async fn send_error(
    tx: &mpsc::Sender<OutgoingEnvelope>,
    connection_id: ConnectionId,
    id: RequestId,
    error: impl std::fmt::Display,
) -> io::Result<()> {
    tx.send(OutgoingEnvelope::ToConnection {
        connection_id,
        message: OutgoingMessage::Error(OutgoingError {
            id,
            error: JSONRPCErrorError {
                code: -32600,
                message: error.to_string(),
                data: None,
            },
        }),
        write_complete_tx: None,
    })
    .await
    .map_err(invalid)
}
fn published_thread(message: &OutgoingMessage) -> Option<&str> {
    use codex_app_server_protocol::{ClientResponsePayload, ServerNotification};
    match message {
        OutgoingMessage::Response(response) => match response.result.as_ref() {
            ClientResponsePayload::ThreadStart(response) => Some(&response.thread.id),
            ClientResponsePayload::ThreadResume(response) => Some(&response.thread.id),
            ClientResponsePayload::ThreadFork(response) => Some(&response.thread.id),
            _ => None,
        },
        OutgoingMessage::AppServerNotification(envelope) => match &envelope.notification {
            ServerNotification::ThreadStarted(notification) => Some(&notification.thread.id),
            _ => None,
        },
        _ => None,
    }
}
fn record_published_thread(
    registry: &mut Registry,
    context: &str,
    message: &OutgoingMessage,
) -> io::Result<bool> {
    let Some(thread) = published_thread(message) else {
        return Ok(false);
    };
    ThreadId::from_string(thread).map_err(invalid)?;
    if registry
        .saved
        .threads
        .get(thread)
        .is_some_and(|owner| owner != context)
    {
        return Err(invalid("cross-window duplicate thread publication"));
    }
    registry.saved.threads.insert(thread.into(), context.into());
    registry.work_owned.insert(context.into());
    Ok(true)
}

fn connection_context(
    registry: &Registry,
    owners: &HashMap<ConnectionId, String>,
    connection: ConnectionId,
) -> Option<String> {
    owners
        .get(&connection)
        .and_then(|owner| registry.context(owner).ok())
}

fn retain_shutdown_error(slot: &mut Option<io::Error>, error: io::Error) {
    tracing::error!(%error, "shared window shutdown failed");
    slot.get_or_insert(error);
}

pub(crate) async fn run(
    mut template: MessageProcessorArgs,
    transport: AppServerTransport,
    mut events: mpsc::Receiver<TransportEvent>,
    outgoing: mpsc::Sender<OutgoingEnvelope>,
    control: mpsc::Sender<OutboundControlEvent>,
    shutdown: CancellationToken,
    engine_instance: Option<String>,
) -> io::Result<AppServerExit> {
    if !matches!(transport, AppServerTransport::UnixSocket { .. }) {
        return Err(invalid("shared windows require the private local socket"));
    }
    // Context forks share backend identity and snapshot ordering, never account selection.
    template.azrael_account_backend_state = Some(Default::default());
    let version = env!("CARGO_PKG_VERSION");
    let identity = codex_app_server_daemon::azrael_engine_sha256(&std::env::current_exe()?)
        .await
        .map_err(invalid)?;
    let home = template.config.codex_home.clone();
    let instance = engine_instance.ok_or_else(|| invalid("shared engine instance is missing"))?;
    let registry_path =
        codex_app_server_daemon::azrael_window_registry_path(&home, &instance).map_err(invalid)?;
    let mut registry = Registry::load_scoped(&registry_path, &instance)?;
    let mut thread_engines =
        crate::azrael_thread_engines::ThreadEngineLeases::new(&home, &instance).await?;
    let mut contexts = HashMap::<String, Context>::new();
    let mut connections = HashMap::<ConnectionId, ConnectionState>::new();
    let mut owners = HashMap::<ConnectionId, String>::new();
    let (context_tx, mut context_rx) = mpsc::channel(CHANNEL_CAPACITY);
    let mut listeners = tokio::task::JoinSet::new();
    let mut cleanup = tokio::task::JoinSet::new();
    let mut interval = tokio::time::interval(Duration::from_millis(250));
    let mut terminal_error = None;
    loop {
        tokio::select! {
            _ = shutdown.cancelled() => break,
            _ = interval.tick() => {
                let mut dead = Vec::new();
                for (owner, lease) in &registry.leases {
                    match lease.identity.is_alive().await {
                        Ok(true) => {},
                        Ok(false) => dead.push(owner.clone()),
                        Err(error) => { terminal_error = Some(invalid(format!("cannot verify window host: {error}"))); break; },
                    }
                }
                if terminal_error.is_some() { break; }
                for owner in dead { registry.host_disappeared(&owner); }
                if let Some(reason) = registry.no_window_shutdown_reason_at(Instant::now()) {
                    tracing::info!(reason, "shared window engine has no window leases; stopping");
                    break;
                }
            }
            event = context_rx.recv() => {
                match event {
                    Some(ContextEvent::Outgoing(context, envelope)) => {
                        let message = match &envelope { OutgoingEnvelope::Broadcast { message } | OutgoingEnvelope::ToConnection { message, .. } => message };
                        if let Some(thread) = published_thread(message) {
                            if let Err(error) = thread_engines.acquire(thread) { terminal_error = Some(error); break; }
                        }
                        match record_published_thread(&mut registry, &context, message) {
                            Ok(true) => if let Err(error) = registry.save(&registry_path) { terminal_error = Some(error); break; },
                            Ok(false) => {},
                            Err(error) => { terminal_error = Some(error); break; },
                        }
                        match envelope {
                        OutgoingEnvelope::Broadcast { message } => {
                            for (connection, state) in &connections {
                                if state.session.initialized() && connection_context(&registry, &owners, *connection).as_deref() == Some(&context) {
                                    if outgoing.send(OutgoingEnvelope::ToConnection { connection_id: *connection, message: message.clone(), write_complete_tx: None }).await.is_err() {
                                        terminal_error = Some(invalid("outbound router closed")); break;
                                    }
                                }
                            }
                        },
                        OutgoingEnvelope::ToConnection { connection_id, message, write_complete_tx } => {
                            if connection_context(&registry, &owners, connection_id).as_deref() == Some(&context) {
                                if outgoing.send(OutgoingEnvelope::ToConnection { connection_id, message, write_complete_tx }).await.is_err() {
                                    terminal_error = Some(invalid("outbound router closed"));
                                }
                            }
                        },
                        }
                    },
                    Some(ContextEvent::ThreadCreated(context, thread)) => {
                        if let Err(error) = thread_engines.acquire(&thread.to_string()) { terminal_error = Some(error); break; }
                        if registry.saved.threads.get(&thread.to_string()).is_some_and(|owner| *owner != context) {
                            terminal_error = Some(invalid("cross-window duplicate thread detected"));
                        } else {
                            registry.saved.threads.insert(thread.to_string(), context.clone());
                            registry.work_owned.insert(context.clone());
                            if let Err(error) = registry.save(&registry_path) { terminal_error = Some(error); }
                            let ids = connections.iter().filter(|(id, state)| state.session.initialized()
                                && connection_context(&registry, &owners, **id).as_deref() == Some(&context)).map(|(id, _)| *id).collect();
                            if let Some(context) = contexts.get(&context) {
                                let processor = Arc::clone(&context.processor);
                                listeners.spawn(async move { processor.try_attach_thread_listener(thread, ids).await; });
                            }
                        }
                    },
                    Some(ContextEvent::Failed(context)) => { terminal_error = Some(invalid(format!("thread owner event stream lagged for {context}"))); },
                    None => { terminal_error = Some(invalid("context router closed")); },
                }
                if terminal_error.is_some() { break; }
            }
            event = events.recv() => {
                let Some(event) = event else { break; };
                match event {
                    TransportEvent::DaemonShutdown => break,
                    TransportEvent::ConnectionOpened { connection_id, origin, auth, writer, disconnect_sender } => {
                        let initialized = Arc::new(AtomicBool::new(false));
                        let experimental = Arc::new(AtomicBool::new(false));
                        let opted_out = Arc::new(RwLock::new(HashSet::new()));
                        control.send(OutboundControlEvent::Opened { connection_id, writer, disconnect_sender,
                            initialized: Arc::clone(&initialized), experimental_api_enabled: Arc::clone(&experimental),
                            opted_out_notification_methods: Arc::clone(&opted_out) }).await.map_err(invalid)?;
                        connections.insert(connection_id, ConnectionState::new(origin, auth, initialized, experimental, opted_out));
                    }
                    TransportEvent::ConnectionClosed { connection_id } => {
                        let context = connection_context(&registry, &owners, connection_id);
                        owners.remove(&connection_id);
                        if let Some(state) = connections.remove(&connection_id) {
                            state.session.rpc_gate.close().await;
                            if let Some(context) = context.and_then(|id| contexts.get(&id)) {
                                let processor = Arc::clone(&context.processor);
                                cleanup.spawn(async move { processor.connection_closed(connection_id, &state.session).await; });
                            }
                        }
                        control.send(OutboundControlEvent::Closed { connection_id }).await.map_err(invalid)?;
                        // Host process identity, not proxy/socket lifetime, owns the window lease.
                    }
                    TransportEvent::IncomingMessage { connection_id, message } => {
                        let Some(state) = connections.get(&connection_id) else { continue; };
                        if let JSONRPCMessage::Request(request) = &message {
                            if request.method == "azrael/window/register" {
                                let result = async {
                                    if state.origin != ConnectionOrigin::UnixSocket || state.session.initialized() || owners.contains_key(&connection_id) {
                                        return Err(invalid("registration requires an uninitialized private connection"));
                                    }
                                    let registration: Registration = serde_json::from_value(request.params.clone().ok_or_else(|| invalid("registration params missing"))?).map_err(invalid)?;
                                    registration.validate(version, &identity)?;
                                    // Capture first; failed/stale PID registration must not mutate owner bindings.
                                    let host = capture_process_identity(registration.host_pid).await.map_err(invalid)?
                                        .ok_or_else(|| invalid("window host process is not alive"))?;
                                    if let Some(lease) = registry.leases.get(&registration.owner_id) {
                                        if lease.pid != registration.host_pid || !lease.identity.is_alive().await.map_err(invalid)? {
                                            return Err(invalid("window owner host identity mismatch"));
                                        }
                                    }
                                    registry.bind(&registration)?;
                                    registry.save(&registry_path)?;
                                    let context_id = registry.context(&registration.owner_id)?;
                                    if !contexts.contains_key(&context_id) {
                                        let binding = registry.saved.owners.get(&context_id).ok_or_else(|| invalid("context account binding missing"))?;
                                        contexts.insert(context_id.clone(), create_context(&template, binding, &context_id, context_tx.clone()).await?);
                                    }
                                    // Commit a lease only after persistence and context preparation succeed.
                                    if registration.role == Role::Window {
                                        registry.admit_window(&registration.owner_id, registration.host_pid, host)?;
                                    }
                                    owners.insert(connection_id, registration.owner_id.clone());
                                    Ok::<_, io::Error>(serde_json::json!({"enginePid": std::process::id(), "ownerId": registration.owner_id,
                                        "engineVersion": version, "engineIdentity": identity}))
                                }.await;
                                match result {
                                    Ok(result) => outgoing.send(OutgoingEnvelope::ToConnection { connection_id,
                                        message: OutgoingMessage::RawResponse { id: request.id.clone(), result }, write_complete_tx: None }).await.map_err(invalid)?,
                                    Err(error) => { send_error(&outgoing, connection_id, request.id.clone(), &error).await?;
                                        // A persistence error is terminal: in-memory authority must never outrun durable metadata.
                                        if error.kind() != io::ErrorKind::InvalidData && error.kind() != io::ErrorKind::InvalidInput {
                                            terminal_error = Some(error); break;
                                        }
                                    },
                                }
                                continue;
                            }
                        }
                        let Some(owner_id) = owners.get(&connection_id).cloned() else {
                            if let JSONRPCMessage::Request(request) = message { send_error(&outgoing, connection_id, request.id, "register a window before initialize").await?; }
                            continue;
                        };
                        let mut context_id = registry.context(&owner_id)?;
                        if let JSONRPCMessage::Request(request) = &message {
                            if let Some(thread) = request.params.as_ref().and_then(|p| p.get("threadId")).and_then(|p| p.as_str()) {
                                if request.method == "thread/resume" {
                                    if let Some(path) = request.params.as_ref().and_then(|p| p.get("path")).and_then(|p| p.as_str()).filter(|path| !path.is_empty()) {
                                        match codex_rollout::read_session_meta_line(Path::new(path)).await {
                                            Ok(metadata) if metadata.meta.id.to_string() == thread => {},
                                            Ok(_) => { send_error(&outgoing, connection_id, request.id.clone(), "resume path must match explicit thread ownership").await?; continue; },
                                            Err(error) => { send_error(&outgoing, connection_id, request.id.clone(), error).await?; continue; },
                                        }
                                    }
                                }
                                if let Err(error) = thread_engines.acquire(thread) {
                                    send_error(&outgoing, connection_id, request.id.clone(), error).await?;
                                    continue;
                                }
                                match registry.select_thread(&owner_id, thread, request.method == "thread/resume") {
                                    Ok(selected) => {
                                        let rebound = context_id != selected;
                                        context_id = selected;
                                        if let Err(error) = registry.save(&registry_path) { terminal_error = Some(error); break; }
                                        if !contexts.contains_key(&context_id) {
                                            let binding = registry.saved.owners.get(&context_id).ok_or_else(|| invalid("rejoin context binding missing"))?;
                                            contexts.insert(context_id.clone(), create_context(&template, binding, &context_id, context_tx.clone()).await?);
                                        }
                                        if rebound {
                                            let retained = &contexts.get(&context_id).ok_or_else(|| invalid("rejoined context unavailable"))?.processor;
                                            for (alias, alias_state) in &connections {
                                                if alias_state.session.initialized() && connection_context(&registry, &owners, *alias).as_deref() == Some(&context_id) {
                                                    retained.connection_initialized(*alias, alias_state.session.request_attestation()).await;
                                                }
                                            }
                                        }
                                    },
                                    Err(error) => { send_error(&outgoing, connection_id, request.id.clone(), error).await?; continue; },
                                }
                            }
                        }
                        let processor = &contexts.get(&context_id).ok_or_else(|| invalid("window context unavailable"))?.processor;
                        let state = connections.get(&connection_id).ok_or_else(|| invalid("connection disappeared"))?;
                        if state.session.rpc_gate.is_closed() { continue; }
                        match message {
                            JSONRPCMessage::Request(request) => {
                                let initialized = state.session.initialized();
                                processor.process_request(connection_id, request, &transport, Arc::clone(&state.session)).await;
                                if let Ok(mut methods) = state.outbound_opted_out_notification_methods.write() { *methods = state.session.opted_out_notification_methods(); }
                                state.outbound_experimental_api_enabled.store(state.session.experimental_api_enabled(), Ordering::Release);
                                if !initialized && state.session.initialized() {
                                    processor.send_initialize_notifications_to_connection(connection_id).await;
                                    processor.connection_initialized(connection_id, state.session.request_attestation()).await;
                                    state.outbound_initialized.store(true, Ordering::Release);
                                }
                            },
                            JSONRPCMessage::Response(response) => processor.process_response(connection_id, response).await,
                            JSONRPCMessage::Error(error) => processor.process_error(connection_id, error).await,
                            JSONRPCMessage::Notification(notification) => processor.process_notification(notification).await,
                        }
                    }
                }
            }
            _ = listeners.join_next(), if !listeners.is_empty() => {},
            _ = cleanup.join_next(), if !cleanup.is_empty() => {},
        }
    }
    tracing::info!(
        stage = "begin",
        contexts = contexts.len(),
        connections = connections.len(),
        "shared window shutdown progress"
    );
    registry.stopping = true;
    for context in contexts.values() {
        context.processor.turn_admission.begin_drain();
    }
    let mut ids = thread_engines.owned_threads();
    // Fence and cancel all existing trees before snapshot I/O or any RPC/startup-task waits.
    // Capture loaded IDs first: children may leave the manager as soon as cancellation starts.
    let mut initial_trees = Vec::new();
    for (owner, result) in
        futures::future::join_all(contexts.iter().map(|(owner, ctx)| async move {
            (
                owner.clone(),
                ctx.processor.fence_shared_window_threads().await,
            )
        }))
        .await
    {
        let (loaded, handles, errors) = result;
        for id in &loaded {
            if let Err(error) = thread_engines.acquire(&id.to_string()) {
                retain_shutdown_error(&mut terminal_error, error);
                continue;
            }
            ids.insert(*id);
            registry
                .saved
                .threads
                .entry(id.to_string())
                .or_insert(owner.clone());
        }
        initial_trees.extend(handles);
        for error in errors {
            retain_shutdown_error(&mut terminal_error, error);
        }
    }
    tracing::info!(
        stage = "trees_signalled",
        trees = initial_trees.len(),
        "shared window shutdown progress"
    );
    if let Err(error) =
        codex_core::azrael_manual_resume::mark_threads_for_manual_resume(&home, ids.iter().copied())
    {
        retain_shutdown_error(&mut terminal_error, error);
    }
    if let Err(error) = registry.save(&registry_path) {
        retain_shutdown_error(&mut terminal_error, error);
    }
    shutdown.cancel();
    let _ = control.send(OutboundControlEvent::DisconnectAll).await;
    let connection_bindings: HashMap<ConnectionId, String> = connections
        .keys()
        .filter_map(|id| connection_context(&registry, &owners, *id).map(|owner| (*id, owner)))
        .collect();
    let loaded_threads_before_wait: Vec<String> = ids.iter().map(ToString::to_string).collect();
    let drain = async {
        let mut errors = Vec::new();
        tracing::info!(stage = "snapshot_begin", "shared window shutdown progress");
        let snapshot_results = futures::future::join_all(
            contexts
                .values()
                .map(|ctx| ctx.processor.shared_window_snapshot()),
        )
        .await;
        let mut snapshots = Vec::new();
        for result in snapshot_results {
            match result {
                Ok(snapshot) => snapshots.push(snapshot),
                Err(error) => errors.push(error),
            }
        }
        if let Err(error) = atomic_json(
            &home.join("azrael/runtime/window-shutdown-snapshot.json"),
            &serde_json::json!({"schema": 1, "loadedThreadIds": loaded_threads_before_wait, "snapshots": snapshots}),
        ) {
            errors.push(error);
        }
        tracing::info!(
            stage = "snapshot_checked",
            "shared window shutdown progress"
        );
        // Connection teardown and bounded startup work run concurrently, after tree cancellation.
        let close_connections = async {
            let connection_results =
                futures::future::join_all(connections.iter().filter_map(|(id, state)| {
                    connection_bindings
                        .get(id)
                        .and_then(|owner| contexts.get(owner))
                        .map(|ctx| async move {
                            tokio::time::timeout(
                                Duration::from_secs(10),
                                ctx.processor.connection_closed(*id, &state.session),
                            )
                            .await
                            .map_err(|error| io::Error::new(io::ErrorKind::TimedOut, error))
                        })
                }));
            let cleanup_future = tokio::time::timeout(Duration::from_secs(10), async {
                while let Some(result) = cleanup.join_next().await {
                    result.map_err(io::Error::other)?;
                }
                Ok::<(), io::Error>(())
            });
            let (results, cleanup_result) = tokio::join!(connection_results, cleanup_future);
            let mut errors = results
                .into_iter()
                .filter_map(Result::err)
                .collect::<Vec<_>>();
            match cleanup_result {
                Ok(Ok(())) => {}
                Ok(Err(error)) => errors.push(error),
                Err(error) => {
                    cleanup.abort_all();
                    errors.push(io::Error::new(io::ErrorKind::TimedOut, error));
                }
            }
            errors
        };
        let startup = futures::future::join_all(
            contexts
                .values()
                .map(|ctx| ctx.processor.drain_shared_window_startup_tasks()),
        );
        let (connection_errors, startup_results) = tokio::join!(close_connections, startup);
        tracing::info!(
            stage = "connections_and_startup_drained",
            "shared window shutdown progress"
        );
        errors.extend(connection_errors);
        errors.extend(startup_results.into_iter().filter_map(Result::err));
        // An admitted startup may have published another root during cancellation. Fence it too.
        let mut loaded_ids = HashMap::new();
        for (owner, (loaded, handles, failures)) in
            futures::future::join_all(contexts.iter().map(|(owner, ctx)| async move {
                (
                    owner.clone(),
                    ctx.processor.fence_shared_window_threads().await,
                )
            }))
            .await
        {
            for thread in loaded {
                loaded_ids.insert(thread, owner.clone());
            }
            initial_trees.extend(handles);
            errors.extend(failures);
        }
        tracing::info!(
            stage = "tree_cleanup_begin",
            trees = initial_trees.len(),
            "shared window shutdown progress"
        );
        let results = futures::future::join_all(initial_trees.iter().map(|tree| async {
            tokio::time::timeout(Duration::from_secs(10), tree.wait_detailed())
                .await
                .map_err(|error| io::Error::new(io::ErrorKind::TimedOut, error))?
                .map_err(io::Error::other)
        }))
        .await;
        errors.extend(results.into_iter().filter_map(Result::err));
        tracing::info!(
            stage = "tree_cleanup_checked",
            "shared window shutdown progress"
        );
        while let Some(result) = listeners.join_next().await {
            if let Err(error) = result {
                errors.push(io::Error::other(error));
            }
        }
        (snapshots, loaded_ids, errors)
    };
    tokio::pin!(drain);
    let mut late_trees = Vec::new();
    let final_drain = async {
        loop {
            tokio::select! {
                result = &mut drain => {
                    // Include proof for a late root that already left the thread manager.
                    for checked in futures::future::join_all(late_trees.iter().map(|tree: &codex_core::AgentTreeShutdown| async {
                        tokio::time::timeout(Duration::from_secs(10), tree.wait_detailed()).await
                            .map_err(|error| io::Error::new(io::ErrorKind::TimedOut, error))?
                            .map_err(io::Error::other)
                    })).await {
                        if let Err(error) = checked { retain_shutdown_error(&mut terminal_error, error); }
                    }
                    break result;
                },
                event = context_rx.recv() => {
                    // Keep bounded relays moving and immediately cancel any late admitted root.
                    if let Some(ContextEvent::ThreadCreated(context, thread)) = event {
                        if let Err(error) = thread_engines.acquire(&thread.to_string()) { retain_shutdown_error(&mut terminal_error, error); continue; }
                        ids.insert(thread);
                        registry.saved.threads.entry(thread.to_string()).or_insert(context.clone());
                        if let Some(ctx) = contexts.get(&context) {
                            let (loaded, handles, errors) = ctx.processor.fence_shared_window_threads().await;
                            for id in loaded {
                                match thread_engines.acquire(&id.to_string()) {
                                    Ok(()) => { ids.insert(id); },
                                    Err(error) => retain_shutdown_error(&mut terminal_error, error),
                                }
                            }
                            late_trees.extend(handles);
                            for error in errors { retain_shutdown_error(&mut terminal_error, error); }
                        }
                    }
                }
            }
        }
    };
    match tokio::time::timeout(SHUTDOWN_TIMEOUT, final_drain).await {
        Ok((snapshots, loaded, errors)) => {
            for (thread, owner) in loaded {
                if let Err(error) = thread_engines.acquire(&thread.to_string()) {
                    retain_shutdown_error(&mut terminal_error, error);
                    continue;
                }
                ids.insert(thread);
                registry
                    .saved
                    .threads
                    .entry(thread.to_string())
                    .or_insert(owner);
            }
            for error in errors {
                retain_shutdown_error(&mut terminal_error, error);
            }
            for snapshot in snapshots {
                for thread in snapshot.loaded {
                    if let Ok(thread) = ThreadId::from_string(&thread) {
                        match thread_engines.acquire(&thread.to_string()) {
                            Ok(()) => {
                                ids.insert(thread);
                            }
                            Err(error) => retain_shutdown_error(&mut terminal_error, error),
                        }
                    }
                }
            }
        }
        Err(_) => {
            retain_shutdown_error(
                &mut terminal_error,
                io::Error::new(io::ErrorKind::TimedOut, "shared window shutdown timed out"),
            );
            if let Err(error) =
                codex_core::azrael_manual_resume::mark_threads_for_manual_resume(&home, ids)
            {
                retain_shutdown_error(&mut terminal_error, error);
            }
            return Err(terminal_error.expect("shutdown timeout recorded"));
        }
    }
    if let Err(error) = codex_core::azrael_manual_resume::mark_threads_for_manual_resume(&home, ids)
    {
        retain_shutdown_error(&mut terminal_error, error);
    }
    if let Err(error) = registry.save(&registry_path) {
        retain_shutdown_error(&mut terminal_error, error);
    }
    if let Some(error) = terminal_error {
        tracing::error!(%error, "shared window engine stopped with a persistence or authority failure");
        return Err(error);
    }
    tracing::info!(stage = "complete", "shared window shutdown progress");
    Ok(AppServerExit::Graceful)
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod instance_tests {
    #[test]
    fn persisted_registry_requires_full_instance_binding() {
        let home = tempfile::tempdir().unwrap();
        let first = "a".repeat(64);
        let second = format!("{}{}", "a".repeat(24), "b".repeat(40));
        let path =
            codex_app_server_daemon::azrael_window_registry_path(home.path(), &first).unwrap();
        let registry = super::Registry::load_scoped(&path, &first).unwrap();
        registry.save(&path).unwrap();
        assert!(super::Registry::load_scoped(&path, &first).is_ok());
        assert!(super::Registry::load_scoped(&path, &second).is_err());
    }
}

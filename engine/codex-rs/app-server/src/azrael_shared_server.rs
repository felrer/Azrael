//! Private shared engine: transport resources are shared, account/thread authority is not.
use crate::azrael_session_handoff::{self as handoff, Attach, Receipt, Selection};
use crate::azrael_shutdown::{SHUTDOWN_TIMEOUT, SNAPSHOT_TIMEOUT, ShutdownWatchdog};
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    session_thread: Option<String>,
    #[serde(default)]
    session_handoff_pending: bool,
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
                    session_thread: None,
                    session_handoff_pending: false,
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
    #[cfg(unix)]
    std::fs::File::open(parent)?.sync_all()?;
    Ok(())
}

async fn capture_shutdown_snapshot(
    collect: impl std::future::Future<
        Output = Vec<io::Result<codex_app_server_transport::daemon_recovery::RecoverySnapshot>>,
    >,
    path: PathBuf,
    loaded: Vec<String>,
    budget: Duration,
) -> Vec<codex_app_server_transport::daemon_recovery::RecoverySnapshot> {
    let started = Instant::now();
    tracing::info!(stage = "snapshot_begin", "shared window shutdown progress");
    let capture = async {
        let results = collect.await;
        let mut snapshots = Vec::new();
        for result in results {
            match result {
                Ok(snapshot) => snapshots.push(snapshot),
                Err(error) => {
                    tracing::warn!(stage = "snapshot_collect_failed", error_kind = ?error.kind(), "shared window shutdown diagnostic incomplete")
                }
            }
        }
        tracing::info!(
            stage = "snapshot_collected",
            contexts = snapshots.len(),
            elapsed_ms = started.elapsed().as_millis() as u64,
            "shared window shutdown progress"
        );
        tokio::task::spawn_blocking(move || {
            tracing::info!(stage = "snapshot_persist_begin", "shared window shutdown progress");
            atomic_json(&path, &serde_json::json!({"schema": 1, "loadedThreadIds": loaded, "snapshots": snapshots}))?;
            tracing::info!(stage = "snapshot_persist_complete", bytes = std::fs::metadata(&path)?.len(), "shared window shutdown progress");
            Ok::<_, io::Error>(snapshots)
        }).await.map_err(io::Error::other)?
    };
    let snapshots = match tokio::time::timeout(budget, capture).await {
        Ok(Ok(snapshots)) => snapshots,
        Ok(Err(error)) => {
            tracing::warn!(stage = "snapshot_failed", error_kind = ?error.kind(), "shared window shutdown diagnostic incomplete");
            Vec::new()
        }
        Err(_) => {
            tracing::warn!(
                stage = "snapshot_timed_out",
                "shared window shutdown diagnostic incomplete"
            );
            Vec::new()
        }
    };
    tracing::info!(
        stage = "snapshot_checked",
        elapsed_ms = started.elapsed().as_millis() as u64,
        "shared window shutdown progress"
    );
    snapshots
}

struct Context {
    processor: Arc<MessageProcessor>,
    tasks: Vec<tokio::task::JoinHandle<()>>,
}
enum ContextEvent {
    Outgoing(String, OutgoingEnvelope),
    ThreadCreated(String, ThreadId),
    Failed(String),
    Handoff {
        connection: ConnectionId,
        request: RequestId,
        thread: String,
        target: String,
        result: io::Result<bool>,
    },
}
struct SessionScope {
    thread: String,
    context: String,
    workspace: String,
    target: String,
    host: AzraelProcessIdentity,
}

fn bind_session_scope_if_unsubscribed(
    scopes: &mut HashMap<ConnectionId, SessionScope>,
    connection: ConnectionId,
    scope: SessionScope,
    subscribers: &[ConnectionId],
) -> &'static str {
    if !subscribers.is_empty()
        || scopes
            .values()
            .any(|existing| existing.thread == scope.thread)
    {
        return "busy";
    }
    scopes.insert(connection, scope);
    "attached"
}

fn session_claim_allows_request(
    scopes: &HashMap<ConnectionId, SessionScope>,
    connection: ConnectionId,
    thread: &str,
) -> bool {
    let canonical = ThreadId::from_string(thread)
        .map(|thread| thread.to_string())
        .unwrap_or_else(|_| thread.to_owned());
    !scopes
        .iter()
        .any(|(claimed, scope)| *claimed != connection && scope.thread == canonical)
}

fn routed_context(
    registry: &Registry,
    owners: &HashMap<ConnectionId, String>,
    scopes: &HashMap<ConnectionId, SessionScope>,
    connection: ConnectionId,
) -> Option<String> {
    scopes
        .get(&connection)
        .map(|scope| scope.context.clone())
        .or_else(|| connection_context(registry, owners, connection))
}

fn outgoing_thread(message: &OutgoingMessage) -> Option<String> {
    serde_json::to_value(message)
        .ok()
        .and_then(|value| handoff::message_thread(&value).map(str::to_owned))
}

fn handoff_closure(message: &OutgoingMessage) -> bool {
    let Ok(value) = serde_json::to_value(message) else {
        return false;
    };
    value.get("method").and_then(|method| method.as_str()) == Some("thread/closed")
        || value
            .pointer("/params/msg/type")
            .and_then(|kind| kind.as_str())
            == Some("shutdown_complete")
}

fn session_outgoing_allowed(
    scope: Option<&SessionScope>,
    message: &OutgoingMessage,
    callback_thread: Option<&str>,
) -> bool {
    let Some(scope) = scope else {
        return true;
    };
    match message {
        OutgoingMessage::Request(_) => callback_thread == Some(&scope.thread),
        OutgoingMessage::AppServerNotification(_) => {
            outgoing_thread(message).as_deref() == Some(&scope.thread)
        }
        _ => true,
    }
}

fn route_callback(
    message: &mut OutgoingMessage,
    connection: ConnectionId,
    context: &str,
    next: &mut u64,
    callbacks: &mut HashMap<(ConnectionId, RequestId), (String, RequestId)>,
) -> io::Result<()> {
    if let OutgoingMessage::Request(request) = message {
        let original = request.id().clone();
        *next += 1;
        let routed = RequestId::String(format!("azrael-session-{next}"));
        let mut value = serde_json::to_value(request).map_err(invalid)?;
        value["id"] = serde_json::to_value(&routed).map_err(invalid)?;
        *message = OutgoingMessage::Request(serde_json::from_value(value).map_err(invalid)?);
        callbacks.insert((connection, routed), (context.to_owned(), original));
    }
    Ok(())
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

fn validated_target_snapshot(
    receipt: &Receipt,
    thread: &str,
    workspace: &str,
    instance: &str,
    compatibility: &serde_json::Value,
) -> io::Result<handoff::RuntimeSnapshot> {
    receipt.validate(thread, workspace, instance, compatibility)?;
    let snapshot: handoff::RuntimeSnapshot =
        serde_json::from_value(receipt.resume.clone()).map_err(invalid)?;
    if !snapshot.safe_client_capabilities() {
        return Err(invalid("unsafe client capability transfer snapshot"));
    }
    snapshot.permission_snapshot()?;
    snapshot.overrides()?;
    Ok(snapshot)
}

/// Preparation errors remain owned by this selected session. Only a successfully persisted
/// binding may proceed to normal resume; pending bindings retain their lease and retry route.
#[allow(clippy::too_many_arguments)]
async fn prepare_target_context(
    template: &MessageProcessorArgs,
    registry: &mut Registry,
    contexts: &mut HashMap<String, Context>,
    registry_path: &Path,
    home: &Path,
    thread: &str,
    requester: &str,
    instance: &str,
    compatibility: &serde_json::Value,
    events: mpsc::Sender<ContextEvent>,
) -> io::Result<Option<String>> {
    let receipt = Receipt::read(home, thread)?;
    let workspace = registry
        .saved
        .owners
        .get(requester)
        .ok_or_else(|| invalid("target owner missing"))?
        .workspace_id
        .clone();
    let dedicated = registry
        .saved
        .threads
        .get(thread)
        .and_then(|id| registry.saved.owners.get(id))
        .filter(|binding| binding.session_thread.as_deref() == Some(thread))
        .cloned();
    if let Some(binding) = dedicated {
        if binding.workspace_id != workspace {
            return Err(invalid("transferred session workspace mismatch"));
        }
        // Forward handoff does not rebind an engine that has already transferred this thread away.
        if receipt.as_ref().is_some_and(|receipt| {
            receipt.source_instance_id == instance && receipt.target_instance_id != instance
        }) {
            return Err(invalid(
                "released session cannot be reacquired by its prior engine",
            ));
        }
        let snapshot = if binding.session_handoff_pending {
            Some(validated_target_snapshot(
                receipt
                    .as_ref()
                    .ok_or_else(|| invalid("pending transfer receipt missing"))?,
                thread,
                &workspace,
                instance,
                compatibility,
            )?)
        } else {
            None
        };
        let id = binding.context.clone();
        if !contexts.contains_key(&id) {
            let context = create_context(template, &binding, &id, events).await?;
            if let Some(snapshot) = snapshot {
                context
                    .processor
                    .install_handoff_restore(thread.to_owned(), snapshot)
                    .await;
            }
            contexts.insert(id.clone(), context);
        }
        // A previous save failure keeps this exact pending binding in memory for a retry.
        if binding.session_handoff_pending {
            registry.save(registry_path)?;
        }
        return Ok(Some(id));
    }
    let Some(receipt) = receipt else {
        return Ok(None);
    };
    let snapshot =
        validated_target_snapshot(&receipt, thread, &workspace, instance, compatibility)?;
    let id = ThreadId::new().to_string().replace('-', "");
    let selection = home
        .join("azrael-thread-engines-v1")
        .join(format!("{thread}.{instance}.account.json"));
    atomic_json(&selection, &receipt.selection)?;
    let binding = Owner {
        workspace_id: workspace,
        account_state_file: selection,
        account_default_file: None,
        context: id.clone(),
        session_thread: Some(thread.to_owned()),
        session_handoff_pending: true,
    };
    let context = create_context(template, &binding, &id, events).await?;
    context
        .processor
        .install_handoff_restore(thread.to_owned(), snapshot)
        .await;
    registry.saved.owners.insert(id.clone(), binding);
    registry.saved.threads.insert(thread.to_owned(), id.clone());
    contexts.insert(id.clone(), context);
    registry.save(registry_path)?;
    Ok(Some(id))
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

#[allow(clippy::too_many_arguments)]
async fn isolate_target_restore_error(
    registry: &Registry,
    routes: &mut HashMap<(ConnectionId, String), String>,
    failed: &mut HashSet<String>,
    outgoing: &mpsc::Sender<OutgoingEnvelope>,
    connection: ConnectionId,
    request: RequestId,
    thread: &str,
    error: io::Error,
) -> io::Result<()> {
    failed.insert(thread.to_owned());
    if let Some(binding) = registry
        .saved
        .threads
        .get(thread)
        .and_then(|id| registry.saved.owners.get(id))
        .filter(|owner| owner.session_thread.as_deref() == Some(thread))
    {
        routes.insert((connection, thread.to_owned()), binding.context.clone());
    }
    // Only outbound channel failure escapes. Restoration failure remains fenced to this thread.
    send_error(outgoing, connection, request, error).await
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
    shutdown_watchdog: Option<Arc<ShutdownWatchdog>>,
) -> io::Result<AppServerExit> {
    if !matches!(transport, AppServerTransport::UnixSocket { .. }) {
        return Err(invalid("shared windows require the private local socket"));
    }
    let socket_path = match &transport {
        AppServerTransport::UnixSocket { socket_path } => socket_path.as_path().to_path_buf(),
        _ => unreachable!(),
    };
    let compatibility = serde_json::to_value(codex_state::azrael_storage_compatibility_manifest())
        .map_err(invalid)?;
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
    let mut scopes = HashMap::<ConnectionId, SessionScope>::new();
    let mut thread_routes = HashMap::<(ConnectionId, String), String>::new();
    let mut callbacks = HashMap::<(ConnectionId, RequestId), (String, RequestId)>::new();
    let mut next_callback = 0_u64;
    let mut seen_messages = HashSet::<ConnectionId>::new();
    let mut transferring = HashMap::<String, String>::new();
    let mut released = HashMap::<String, String>::new();
    let mut failed_transfers = HashSet::<String>::new();
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
                let mut dead_scopes = Vec::new();
                for (connection, scope) in &scopes {
                    if !scope.host.is_alive().await.map_err(invalid)? { dead_scopes.push(*connection); }
                }
                for connection in dead_scopes { scopes.remove(&connection); }
                if scopes.is_empty() && let Some(reason) = registry.no_window_shutdown_reason_at(Instant::now()) {
                    tracing::info!(reason, "shared window engine has no window leases; stopping");
                    break;
                }
            }
            event = context_rx.recv() => {
                match event {
                    Some(ContextEvent::Outgoing(context, envelope)) => {
                        let message = match &envelope { OutgoingEnvelope::Broadcast { message } | OutgoingEnvelope::ToConnection { message, .. } => message };
                        let callback_thread=if let OutgoingMessage::Request(request)=message {
                            if let Some(ctx)=contexts.get(&context) {ctx.processor.server_request_thread(request.id()).await.map(|thread|thread.to_string())} else {None}
                        } else {None};
                        let routed_thread=callback_thread.clone().or_else(||outgoing_thread(message));
                        if handoff_closure(message) && outgoing_thread(message).is_some_and(|thread|transferring.contains_key(&thread)||released.contains_key(&thread)) {continue;}
                        if let Some(thread) = published_thread(message) {
                            if let Err(error) = thread_engines.acquire(thread) { terminal_error = Some(error); break; }
                        }
                        match record_published_thread(&mut registry, &context, message) {
                            Ok(true) => if let Err(error) = registry.save(&registry_path) {
                                if registry.saved.owners.get(&context).is_some_and(|owner|owner.session_thread.is_some()) {
                                    if let Some(thread)=published_thread(message) {failed_transfers.insert(thread.to_owned());}
                                    if let OutgoingEnvelope::ToConnection {connection_id,message:OutgoingMessage::Response(response),..}=&envelope {
                                        send_error(&outgoing,*connection_id,response.id.clone(),error).await?;
                                    }
                                    continue;
                                }
                                terminal_error = Some(error); break;
                            },
                            Ok(false) => {},
                            Err(error) => { terminal_error = Some(error); break; },
                        }
                        if let OutgoingMessage::Response(response)=message {
                            if let codex_app_server_protocol::ClientResponsePayload::ThreadResume(resumed)=response.result.as_ref() {
                                if let Some(binding)=registry.saved.owners.get_mut(&context).filter(|owner|owner.session_thread.as_deref()==Some(&resumed.thread.id)) {
                                    if binding.session_handoff_pending {
                                        binding.session_handoff_pending=false;
                                        if let Err(error)=registry.save(&registry_path) {
                                            if let Some(binding)=registry.saved.owners.get_mut(&context) {binding.session_handoff_pending=true;}
                                            failed_transfers.insert(resumed.thread.id.clone());
                                            if let OutgoingEnvelope::ToConnection {connection_id,..}=&envelope {
                                                send_error(&outgoing,*connection_id,response.id.clone(),error).await?;
                                            }
                                            continue;
                                        }
                                    }
                                }
                            }
                        }
                        if let Some(thread) = published_thread(message) {
                            let workspace = &registry.saved.owners.get(&context).ok_or_else(|| invalid("missing publication workspace"))?.workspace_id;
                            let published=thread_engines.publish(thread, &serde_json::json!({"schema":1,"protocol":1,"threadId":thread,
                                "workspaceId":workspace,"instanceId":instance,"socketPath":socket_path,"engineVersion":version,
                                "engineIdentity":identity,"storageCompatibility":compatibility}));
                            if let Err(error)=published {
                                if registry.saved.owners.get(&context).is_some_and(|owner|owner.session_thread.as_deref()==Some(thread)) {
                                    failed_transfers.insert(thread.to_owned());
                                    if let OutgoingEnvelope::ToConnection {connection_id,message:OutgoingMessage::Response(response),..}=&envelope {
                                        send_error(&outgoing,*connection_id,response.id.clone(),error).await?;
                                    }
                                    continue;
                                }
                                return Err(error);
                            }
                        }
                        match envelope {
                        OutgoingEnvelope::Broadcast { message } => {
                            for (connection, state) in &connections {
                                if state.session.initialized()
                                    && (routed_context(&registry, &owners, &scopes, *connection).as_deref() == Some(&context)
                                        || routed_thread.as_ref().is_some_and(|thread| thread_routes.get(&(*connection, thread.clone())).is_some_and(|route| route == &context)))
                                    && session_outgoing_allowed(scopes.get(connection), &message, callback_thread.as_deref()) {
                                    let mut message=message.clone();
                                    route_callback(&mut message,*connection,&context,&mut next_callback,&mut callbacks)?;
                                    if outgoing.send(OutgoingEnvelope::ToConnection { connection_id: *connection, message, write_complete_tx: None }).await.is_err() {
                                        terminal_error = Some(invalid("outbound router closed")); break;
                                    }
                                }
                            }
                        },
                        OutgoingEnvelope::ToConnection { connection_id, mut message, write_complete_tx } => {
                            if (routed_context(&registry, &owners, &scopes, connection_id).as_deref() == Some(&context)
                                || thread_routes.iter().any(|((id, _), route)| *id == connection_id && route == &context))
                                && session_outgoing_allowed(scopes.get(&connection_id), &message, callback_thread.as_deref()) {
                                if routed_context(&registry,&owners,&scopes,connection_id).as_deref()!=Some(&context)
                                    && matches!(&message,OutgoingMessage::Request(_)|OutgoingMessage::AppServerNotification(_))
                                    && routed_thread.as_ref().is_none_or(|thread|thread_routes.get(&(connection_id,thread.clone())).is_none_or(|route|route!=&context)) {
                                    continue;
                                }
                                route_callback(&mut message,connection_id,&context,&mut next_callback,&mut callbacks)?;
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
                            if let Err(error) = registry.save(&registry_path) {
                                if registry.saved.owners.get(&context).is_some_and(|owner|owner.session_thread.is_some()) {
                                    failed_transfers.insert(thread.to_string());
                                    tracing::warn!(%thread,%error,"selected transfer registry persistence failed; retaining session lease");
                                    continue;
                                }
                                terminal_error = Some(error);
                            }
                            let ids = connections.iter().filter(|(id, state)| state.session.initialized()
                                && connection_context(&registry, &owners, **id).as_deref() == Some(&context)).map(|(id, _)| *id).collect();
                            if let Some(context) = contexts.get(&context) {
                                let processor = Arc::clone(&context.processor);
                                listeners.spawn(async move { processor.try_attach_thread_listener(thread, ids).await; });
                            }
                        }
                    },
                    Some(ContextEvent::Handoff {connection, request, thread, target, result}) => {
                        match result {
                            Ok(true) => {
                                if let Err(error) = thread_engines.release(&thread) { send_error(&outgoing, connection, request, error).await?; }
                                else {
                                    transferring.remove(&thread);
                                    released.insert(thread, target);
                                    outgoing.send(OutgoingEnvelope::ToConnection {connection_id:connection,
                                        message:OutgoingMessage::RawResponse {id:request,result:serde_json::json!({"state":"released"})},write_complete_tx:None}).await.map_err(invalid)?;
                                }
                            }
                            Ok(false) => {
                                transferring.remove(&thread);
                                outgoing.send(OutgoingEnvelope::ToConnection {connection_id:connection,
                                message:OutgoingMessage::RawResponse {id:request,result:serde_json::json!({"state":"busy"})},write_complete_tx:None}).await.map_err(invalid)?;
                            }
                            Err(error) => send_error(&outgoing, connection, request, error).await?,
                        }
                    }
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
                        let context = routed_context(&registry, &owners, &scopes, connection_id);
                        let mut closed_contexts:HashSet<String>=thread_routes.iter().filter(|((id,_),_)|*id==connection_id).map(|(_,context)|context.clone()).collect();
                        closed_contexts.extend(context);
                        seen_messages.remove(&connection_id);
                        scopes.remove(&connection_id);
                        callbacks.retain(|(id, _), _| *id != connection_id);
                        thread_routes.retain(|(id, _), _| *id != connection_id);
                        owners.remove(&connection_id);
                        if let Some(state) = connections.remove(&connection_id) {
                            state.session.rpc_gate.close().await;
                            for context in closed_contexts.iter().filter_map(|id|contexts.get(id)) {
                                let processor = Arc::clone(&context.processor);
                                let session=Arc::clone(&state.session);
                                cleanup.spawn(async move { processor.connection_closed(connection_id, &session).await; });
                            }
                        }
                        control.send(OutboundControlEvent::Closed { connection_id }).await.map_err(invalid)?;
                        // Host process identity, not proxy/socket lifetime, owns the window lease.
                    }
                    TransportEvent::IncomingMessage { connection_id, message } => {
                        let mut message = message;
                        let first_message=seen_messages.insert(connection_id);
                        let Some(state) = connections.get(&connection_id) else { continue; };
                        if let JSONRPCMessage::Request(request) = &message {
                            if request.method == "azrael/engine/status" {
                                if state.origin != ConnectionOrigin::UnixSocket || state.session.initialized() || owners.contains_key(&connection_id) {
                                    send_error(&outgoing, connection_id, request.id.clone(), &invalid("engine status requires an uninitialized private connection")).await?;
                                } else {
                                    outgoing.send(OutgoingEnvelope::ToConnection { connection_id,
                                        message: OutgoingMessage::RawResponse { id: request.id.clone(), result: serde_json::json!({
                                            "schema": 1, "state": "ready", "enginePid": std::process::id(),
                                            "instanceId": instance, "engineVersion": version, "engineIdentity": identity,
                                            "sessionHandoff": {"protocol": handoff::PROTOCOL,"storageCompatibility":compatibility}
                                        }) }, write_complete_tx: None }).await.map_err(invalid)?;
                                }
                                continue;
                            }
                            if request.method == "azrael/session/attach" {
                                let result = async {
                                    if state.origin != ConnectionOrigin::UnixSocket || state.session.initialized()
                                        || owners.contains_key(&connection_id) || scopes.contains_key(&connection_id) || !first_message {
                                        return Err(invalid("attachment must be the first private request"));
                                    }
                                    let attach: Attach = serde_json::from_value(request.params.clone().ok_or_else(|| invalid("attachment params missing"))?).map_err(invalid)?;
                                    attach.validate(&instance, &identity, &compatibility)?;
                                    let context_id = registry.saved.threads.get(&attach.thread_id).cloned().ok_or_else(|| invalid("source does not own this session"))?;
                                    let binding = registry.saved.owners.get(&context_id).ok_or_else(|| invalid("source session context missing"))?;
                                    if binding.workspace_id != attach.workspace_id
                                        || !thread_engines.owned_threads().contains(&ThreadId::from_string(&attach.thread_id).map_err(invalid)?) {
                                        return Err(invalid("session workspace or authoritative lease mismatch"));
                                    }
                                    let host = capture_process_identity(attach.host_pid).await.map_err(invalid)?.ok_or_else(|| invalid("session host is not alive"))?;
                                    if !contexts.contains_key(&context_id) {
                                        contexts.insert(context_id.clone(), create_context(&template, binding, &context_id, context_tx.clone()).await?);
                                    }
                                    if !contexts.get(&context_id).ok_or_else(||invalid("session context unavailable"))?.processor.session_attach_supported() {
                                        return Err(invalid("externally managed authentication requires its original host connection"));
                                    }
                                    let subscribers=contexts.get(&context_id).ok_or_else(||invalid("session context unavailable"))?.processor
                                        .session_subscribers(ThreadId::from_string(&attach.thread_id).map_err(invalid)?).await;
                                    let attach_state=bind_session_scope_if_unsubscribed(&mut scopes,connection_id,
                                        SessionScope {thread:attach.thread_id.clone(), context:context_id,
                                            workspace:attach.workspace_id, target:attach.target_instance_id, host},&subscribers);
                                    Ok::<_,io::Error>(serde_json::json!({"schema":1,"protocol":1,"threadId":attach.thread_id,
                                        "instanceId":instance,"engineIdentity":identity,"engineVersion":version,"storageCompatibility":compatibility,"state":attach_state}))
                                }.await;
                                match result {
                                    Ok(result) => outgoing.send(OutgoingEnvelope::ToConnection {connection_id,
                                        message:OutgoingMessage::RawResponse {id:request.id.clone(), result},write_complete_tx:None}).await.map_err(invalid)?,
                                    Err(error) => send_error(&outgoing, connection_id, request.id.clone(), error).await?,
                                }
                                continue;
                            }
                            if request.method == "azrael/session/handoff" {
                                let Some(scope) = scopes.get(&connection_id).filter(|_| state.session.initialized()) else {
                                    send_error(&outgoing, connection_id, request.id.clone(), "handoff requires initialized session attachment").await?; continue;
                                };
                                let params = request.params.as_ref();
                                if params.and_then(|p|p.get("threadId")).and_then(|p|p.as_str()) != Some(&scope.thread)
                                    || params.and_then(|p|p.get("targetInstanceId")).and_then(|p|p.as_str()) != Some(&scope.target) {
                                    send_error(&outgoing, connection_id, request.id.clone(), "handoff scope mismatch").await?; continue;
                                }
                                if released.get(&scope.thread) == Some(&scope.target) || transferring.contains_key(&scope.thread) {
                                    let state = if released.contains_key(&scope.thread) {"released"} else {"busy"};
                                    outgoing.send(OutgoingEnvelope::ToConnection {connection_id,message:OutgoingMessage::RawResponse {
                                        id:request.id.clone(),result:serde_json::json!({"state":state})},write_complete_tx:None}).await.map_err(invalid)?;
                                    continue;
                                }
                                let processor = Arc::clone(&contexts.get(&scope.context).ok_or_else(|| invalid("handoff context unavailable"))?.processor);
                                let account_guard=match processor.session_handoff_account_guard().await {
                                    Ok(guard)=>guard,
                                    Err(_)=>{outgoing.send(OutgoingEnvelope::ToConnection {connection_id,message:OutgoingMessage::RawResponse {
                                        id:request.id.clone(),result:serde_json::json!({"state":"busy"})},write_complete_tx:None}).await.map_err(invalid)?;continue;}
                                };
                                let binding = registry.saved.owners.get(&scope.context).ok_or_else(|| invalid("handoff owner unavailable"))?;
                                let selection = match Selection::read(&binding.account_state_file, binding.account_default_file.as_deref(), &home) {
                                    Ok(selection) => selection,
                                    Err(error) => {send_error(&outgoing, connection_id, request.id.clone(), error).await?;continue;}
                                };
                                let mut receipt = Receipt {schema:1,protocol:1,state:"stopped".into(),thread_id:scope.thread.clone(),
                                    workspace_id:scope.workspace.clone(),source_instance_id:instance.clone(),source_identity:identity.clone(),
                                    target_instance_id:scope.target.clone(),storage_compatibility:compatibility.clone(),selection,resume:serde_json::json!({})};
                                let thread = scope.thread.clone(); let target = scope.target.clone(); let request_id = request.id.clone();
                                transferring.insert(thread.clone(), target.clone());
                                let tx = context_tx.clone(); let receipt_home = home.clone();
                                listeners.spawn(async move {
                                    let _account_guard=account_guard;
                                    let result = async {
                                        let Some(snapshot) = processor.try_session_handoff(&thread, connection_id).await? else {return Ok(false);};
                                        receipt.resume = snapshot;
                                        atomic_json(&handoff::receipt_path(&receipt_home, &thread)?, &receipt)?;
                                        Ok(true)
                                    }.await;
                                    let _ = tx.send(ContextEvent::Handoff {connection:connection_id,request:request_id,thread,target,result}).await;
                                });
                                continue;
                            }
                            if request.method == "azrael/window/register" {
                                let result = async {
                                    if state.origin != ConnectionOrigin::UnixSocket || state.session.initialized() || owners.contains_key(&connection_id) || scopes.contains_key(&connection_id) {
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
                        if let Some(scope) = scopes.get(&connection_id) {
                            let allowed = match &message {
                                JSONRPCMessage::Request(request) => handoff::scoped_request(&request.method,request.params.as_ref(),&scope.thread),
                                JSONRPCMessage::Notification(notification) => notification.method == "initialized",
                                JSONRPCMessage::Response(response) => callbacks.contains_key(&(connection_id,response.id.clone())),
                                JSONRPCMessage::Error(error) => callbacks.contains_key(&(connection_id,error.id.clone())),
                            };
                            if !allowed {
                                if let JSONRPCMessage::Request(request) = &message {send_error(&outgoing,connection_id,request.id.clone(),"request exceeds attached session authority").await?;}
                                continue;
                            }
                            if let JSONRPCMessage::Request(request)=&mut message {
                                if request.method=="thread/resume" && let Some(params)=request.params.as_mut() {
                                    handoff::retain_scoped_resume_presentation(params);
                                }
                            }
                        }
                        let Some(owner_id) = owners.get(&connection_id).cloned().or_else(|| scopes.get(&connection_id).map(|scope|scope.context.clone())) else {
                            if let JSONRPCMessage::Request(request) = message { send_error(&outgoing, connection_id, request.id, "register a window before initialize").await?; }
                            continue;
                        };
                        let mut context_id = routed_context(&registry,&owners,&scopes,connection_id).ok_or_else(||invalid("session route missing"))?;
                        if matches!(&message,JSONRPCMessage::Response(response) if !callbacks.contains_key(&(connection_id,response.id.clone())))
                            || matches!(&message,JSONRPCMessage::Error(error) if !callbacks.contains_key(&(connection_id,error.id.clone()))) {continue;}
                        match &mut message {
                            JSONRPCMessage::Response(response) => if let Some((route,original)) = callbacks.remove(&(connection_id,response.id.clone())) {context_id=route;response.id=original;},
                            JSONRPCMessage::Error(error) => if let Some((route,original)) = callbacks.remove(&(connection_id,error.id.clone())) {context_id=route;error.id=original;},
                            _ => {},
                        }
                        if let JSONRPCMessage::Request(request) = &message {
                            if let Some(thread) = request.params.as_ref().and_then(|p| p.get("threadId")).and_then(|p| p.as_str()) {
                                if !session_claim_allows_request(&scopes,connection_id,thread) {
                                    send_error(&outgoing,connection_id,request.id.clone(),"session is claimed by another attached connection").await?;continue;
                                }
                                if transferring.contains_key(thread) || released.contains_key(thread)
                                    || (failed_transfers.contains(thread) && request.method != "thread/resume") {
                                    send_error(&outgoing,connection_id,request.id.clone(),"session handoff is fenced").await?;continue;
                                }
                                if let Some(route) = thread_routes.get(&(connection_id,thread.to_owned())) {context_id=route.clone();}
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
                                if !scopes.contains_key(&connection_id) && request.method == "thread/resume" {
                                    let prepared=prepare_target_context(&template,&mut registry,&mut contexts,&registry_path,&home,
                                        thread,&owner_id,&instance,&compatibility,context_tx.clone()).await;
                                    match prepared {
                                        Ok(Some(selected))=>{
                                            context_id=selected;
                                            thread_routes.insert((connection_id,thread.to_owned()),context_id.clone());
                                            failed_transfers.remove(thread);
                                        }
                                        Ok(None)=>{failed_transfers.remove(thread);}
                                        Err(error)=>{
                                            isolate_target_restore_error(&registry,&mut thread_routes,&mut failed_transfers,
                                                &outgoing,connection_id,request.id.clone(),thread,error).await?;continue;
                                        }
                                    }
                                }
                                let selected = if scopes.contains_key(&connection_id) || thread_routes.contains_key(&(connection_id,thread.to_owned())) {
                                    Ok(context_id.clone())
                                } else {registry.select_thread(&owner_id,thread,request.method == "thread/resume")};
                                match selected {
                                    Ok(selected) => {
                                        let rebound = context_id != selected;
                                        context_id = selected;
                                        if !scopes.contains_key(&connection_id) && !thread_routes.contains_key(&(connection_id,thread.to_owned())) {
                                            if let Err(error)=registry.save(&registry_path) {terminal_error=Some(error);break;}
                                        }
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
                                if registry.saved.owners.get(&context_id).is_some_and(|binding|binding.session_handoff_pending) && request.method!="thread/resume" {
                                    send_error(&outgoing,connection_id,request.id.clone(),"transferred session must finish restoring before new work").await?;continue;
                                }
                            }
                        }
                        let processor = &contexts.get(&context_id).ok_or_else(|| invalid("window context unavailable"))?.processor;
                        if let JSONRPCMessage::Request(request)=&mut message {
                            if request.method == "thread/resume" {
                                if let Some(thread)=request.params.as_ref().and_then(|params|params.get("threadId")).and_then(|id|id.as_str()).map(str::to_owned) {
                                    if thread_routes.contains_key(&(connection_id,thread.clone())) {
                                        if registry.saved.owners.get(&context_id).is_some_and(|binding|binding.session_handoff_pending) {
                                            let restored=(||->io::Result<()> {
                                                let receipt=Receipt::read(&home,&thread)?.ok_or_else(||invalid("pending transfer receipt missing"))?;
                                                let workspace=&registry.saved.owners.get(&context_id).ok_or_else(||invalid("pending transfer owner missing"))?.workspace_id;
                                                let snapshot=validated_target_snapshot(&receipt,&thread,workspace,&instance,&compatibility)?;
                                                let params=request.params.as_mut().and_then(serde_json::Value::as_object_mut).ok_or_else(||invalid("resume params missing"))?;
                                                for (key,value) in snapshot.resume_params().as_object().ok_or_else(||invalid("invalid restored params"))? {params.insert(key.clone(),value.clone());}
                                                params.remove("history");params.remove("path");params.remove("sandbox");params.remove("permissions");
                                                Ok(())
                                            })();
                                            if let Err(error)=restored {
                                                failed_transfers.insert(thread.clone());
                                                send_error(&outgoing,connection_id,request.id.clone(),error).await?;continue;
                                            }
                                        }
                                        processor.connection_initialized(connection_id,state.session.request_attestation()).await;
                                    }
                                }
                            }
                        }
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
    // Arm before any shutdown logging, async locks or synchronous persistence.
    let shutdown_deadline = Instant::now() + SHUTDOWN_TIMEOUT;
    if let Some(watchdog) = &shutdown_watchdog {
        watchdog.arm(shutdown_deadline);
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
    if let Err(error) = codex_app_server_daemon::publish_azrael_shutdown(&home, &instance).await {
        retain_shutdown_error(&mut terminal_error, invalid(error));
    }
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
        // Diagnostics and mandatory cleanup progress independently. A blocked diagnostic
        // writer may finish later, but cannot prevent cancellation, tree waits or exit.
        let capture_snapshot = capture_shutdown_snapshot(
            futures::future::join_all(
                contexts
                    .values()
                    .map(|ctx| ctx.processor.shared_window_snapshot()),
            ),
            home.join("azrael/runtime/window-shutdown-snapshot.json")
                .to_path_buf(),
            loaded_threads_before_wait,
            SNAPSHOT_TIMEOUT,
        );
        let cleanup_work = async {
            let mut errors = Vec::new();
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
            (loaded_ids, errors)
        };
        let (snapshots, (loaded_ids, errors)) = tokio::join!(capture_snapshot, cleanup_work);
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
    match tokio::time::timeout_at(
        tokio::time::Instant::from_std(shutdown_deadline),
        final_drain,
    )
    .await
    {
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

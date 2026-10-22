//! Azrael's explicitly selected private daemon and lossless per-window transport.
//! This path never installs, updates, enrolls or migrates a managed Codex release.

use anyhow::{Context, Result, bail, ensure};
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(test)]
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    io,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio_tungstenite::tungstenite::Message;

use crate::registration::{
    AZRAEL_STARTUP_TIMEOUT, MAX_MESSAGE, connect_azrael_registered, connect_private_stream,
    validate_azrael_registration,
};

const TIMEOUT: Duration = Duration::from_secs(10);
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AzraelDaemonEndpoint {
    pub schema: u32,
    pub instance_id: String,
    pub socket_path: PathBuf,
    pub engine_version: String,
    pub engine_identity: String,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AzraelDaemonReceipt {
    #[serde(flatten)]
    endpoint: AzraelDaemonEndpoint,
    native_argv: Vec<String>,
}

fn default_startup_args() -> Vec<String> {
    vec![
        "-c".into(),
        "features.code_mode_host=true".into(),
        "--session-source".into(),
        "vscode".into(),
        "--analytics-default-enabled".into(),
    ]
}

fn validate_startup_args(args: &[String]) -> Result<()> {
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-c" | "--code-mode-host" | "--session-source" => {
                ensure!(
                    args.next().is_some(),
                    "missing native startup argument value"
                );
            }
            "--strict-config"
            | "--analytics-default-enabled"
            | "--disable-plugin-startup-tasks-for-tests" => {}
            _ => bail!("unsupported shared Azrael startup argument: {arg}"),
        }
    }
    Ok(())
}

/// One canonical startup representation shared by discovery and launch. Config
/// override order is significant (the last override wins), so preserve it.
pub fn normalize_azrael_startup_args(args: &[String]) -> Result<Vec<String>> {
    validate_startup_args(args)?;
    let mut overrides = Vec::new();
    let mut code_mode = None;
    let mut source = "vscode".to_owned();
    let mut switches = std::collections::BTreeSet::new();
    let mut values = args.iter();
    while let Some(arg) = values.next() {
        match arg.as_str() {
            "-c" => overrides.push(values.next().unwrap().clone()),
            "--code-mode-host" => code_mode = values.next().cloned(),
            "--session-source" => source = values.next().unwrap().clone(),
            _ => {
                switches.insert(arg.clone());
            }
        }
    }
    let mut normalized = Vec::new();
    for value in overrides {
        normalized.extend(["-c".into(), value]);
    }
    if let Some(value) = code_mode {
        normalized.extend(["--code-mode-host".into(), value]);
    }
    if switches.remove("--strict-config") {
        normalized.push("--strict-config".into());
    }
    normalized.extend(["--session-source".into(), source]);
    normalized.extend(switches);
    Ok(normalized)
}

fn instance_id(exe: &Path, identity: &str, args: &[String]) -> Result<String> {
    // Serialize a framed tuple; concatenating inputs would permit ambiguity.
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&(
            "azrael-engine-endpoint-v2",
            exe,
            identity,
            args,
        ))?)
    ))
}

fn socket_stem(instance_id: &str) -> Result<String> {
    // Preserve the existing 96-bit prefix; only its on-disk representation changes.
    let prefix = data_encoding::HEXLOWER.decode(&instance_id.as_bytes()[..24])?;
    Ok(data_encoding::BASE32_NOPAD
        .encode(&prefix)
        .to_ascii_lowercase())
}

pub fn azrael_window_registry_path(home: &Path, instance: &str) -> Result<PathBuf> {
    ensure!(
        instance.len() == 64
            && instance
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "invalid Azrael engine instance"
    );
    Ok(home
        .join("azrael/runtime/engines")
        .join(instance)
        .join("window-owners.json"))
}

/// Side-effect-free discovery: no config, auth, state creation or daemon startup.
pub async fn azrael_engine_endpoint_with_args(
    selected_exe: &Path,
    startup_args: &[String],
) -> Result<AzraelDaemonEndpoint> {
    let args = normalize_azrael_startup_args(startup_args)?;
    let exe = tokio::fs::canonicalize(selected_exe).await?;
    let identity = azrael_engine_sha256(&exe).await?;
    let daemon = crate::Daemon::from_environment()?;
    endpoint_from_inputs(&exe, identity, &args, &daemon.socket_path)
}

fn endpoint_from_inputs(
    exe: &Path,
    identity: String,
    args: &[String],
    legacy_socket: &Path,
) -> Result<AzraelDaemonEndpoint> {
    let instance_id = instance_id(exe, &identity, args)?;
    let socket_path = legacy_socket.with_file_name(format!("{}.sock", socket_stem(&instance_id)?));
    Ok(AzraelDaemonEndpoint {
        schema: 2,
        instance_id,
        socket_path,
        engine_version: env!("CARGO_PKG_VERSION").into(),
        engine_identity: identity,
    })
}

pub async fn ensure_azrael_started(selected_exe: &Path) -> Result<AzraelDaemonEndpoint> {
    ensure_azrael_started_with_args(selected_exe, &default_startup_args()).await
}

/// Stream the selected engine's SHA256 without blocking async event processing
/// or allocating a buffer proportional to the executable's size.
pub async fn azrael_engine_sha256(path: &Path) -> Result<String> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || -> Result<String> {
        use std::io::Read;
        let mut file = std::fs::File::open(&path)
            .with_context(|| format!("failed to open Azrael engine {}", path.display()))?;
        let mut hash = Sha256::new();
        let mut buffer = [0u8; 65536];
        loop {
            let count = file.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            hash.update(&buffer[..count]);
        }
        Ok(format!("{:x}", hash.finalize()))
    })
    .await
    .context("Azrael engine SHA256 task failed")?
}

pub async fn ensure_azrael_started_with_args(
    selected_exe: &Path,
    startup_args: &[String],
) -> Result<AzraelDaemonEndpoint> {
    let startup_args = normalize_azrael_startup_args(startup_args)?;
    let selected_exe = tokio::fs::canonicalize(selected_exe)
        .await
        .context("selected Azrael executable is unavailable")?;
    let legacy_daemon = crate::Daemon::from_environment()?;
    match tokio::time::timeout(TIMEOUT, probe_existing_socket(&legacy_daemon.socket_path)).await {
        Ok(Ok(true)) => bail!("A legacy Azrael shared engine is running. Close all Azrael windows once to complete the coordinated engine upgrade, then reopen them."),
        Ok(Ok(false)) => {},
        Ok(Err(error)) if error.kind() == io::ErrorKind::ConnectionRefused => {},
        Ok(Err(error)) => return Err(error).context("cannot verify legacy Azrael engine; close all Azrael windows for the coordinated upgrade"),
        Err(_) => bail!("legacy Azrael engine check timed out; close all Azrael windows for the coordinated upgrade"),
    }
    let endpoint = azrael_engine_endpoint_with_args(&selected_exe, &startup_args).await?;
    let daemon = legacy_daemon.for_azrael_instance(&endpoint)?;
    // Binary hashing can be slow in debug builds. Read immutable selected inputs
    // before taking the shared lifecycle lock, then verify them again under it.
    let selected_identity = crate::managed_install::executable_identity(&selected_exe).await?;
    let output = tokio::time::timeout(
        TIMEOUT,
        tokio::process::Command::new(&selected_exe)
            .arg("--version")
            .output(),
    )
    .await
    .context("selected Azrael version query timed out")??;
    ensure!(
        output.status.success(),
        "selected Azrael version query failed"
    );
    let version = String::from_utf8(output.stdout)?.trim().to_owned();
    let version = version
        .strip_prefix("azrael ")
        .context("selected binary is not the Azrael entry")?;
    ensure!(
        version == env!("CARGO_PKG_VERSION"),
        "selected Azrael version differs from launcher"
    );
    let receipt_path = daemon
        .pid_file
        .with_file_name("azrael-selected-engine.json");
    let mut native_argv = vec![
        "app-server".into(),
        "--azrael-shared-windows".into(),
        "--managed-daemon".into(),
        "--azrael-engine-instance".into(),
        endpoint.instance_id.clone(),
        "--listen".into(),
        format!("unix://{}", endpoint.socket_path.display()),
    ];
    native_argv.extend_from_slice(&startup_args);
    let receipt = AzraelDaemonReceipt {
        endpoint: endpoint.clone(),
        native_argv: native_argv.clone(),
    };
    let _lock = tokio::time::timeout(AZRAEL_STARTUP_TIMEOUT, daemon.acquire_operation_lock())
        .await
        .context("Azrael daemon operation is busy; retry after it completes")??;
    ensure!(
        crate::managed_install::executable_identity(&selected_exe).await? == selected_identity,
        "selected Azrael executable changed while checking its identity; retry with immutable inputs"
    );
    ensure!(
        azrael_engine_sha256(&selected_exe).await? == endpoint.engine_identity,
        "selected Azrael executable changed during endpoint discovery; retry with immutable inputs"
    );
    let backend =
        crate::backend::PidBackend::new(selected_exe.clone(), daemon.pid_file.clone(), false)
            .with_explicit_args(native_argv);
    let home = codex_utils_home_dir::find_codex_home()?;
    if wait_for_engine(
        &backend,
        &receipt_path,
        &receipt,
        &selected_identity,
        home.as_path(),
        true,
    )
    .await?
    {
        return Ok(endpoint);
    }
    // Never introduce a second engine beside an untracked live socket owner.
    match tokio::time::timeout(
        Duration::from_secs(2),
        probe_existing_socket(&endpoint.socket_path),
    )
    .await
    {
        Ok(Ok(true)) => bail!(
            "the private app-server socket already has a live owner without a matching PID receipt; close that engine before retrying"
        ),
        Ok(Ok(false)) => {}
        Ok(Err(err))
            if matches!(
                err.kind(),
                io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
            ) => {}
        Ok(Err(err)) => return Err(err).context("cannot verify the existing private socket owner"),
        Err(_) => {
            bail!("private socket owner check timed out; retry after checking the running engine")
        }
    }
    // A stopping predecessor may have taken time to exit. Revalidate immutable
    // inputs before launching its replacement under the same operation lock.
    ensure!(
        crate::managed_install::executable_identity(&selected_exe).await? == selected_identity,
        "selected Azrael executable changed while waiting for the engine; retry with immutable inputs"
    );
    ensure!(
        azrael_engine_sha256(&selected_exe).await? == endpoint.engine_identity,
        "selected Azrael executable changed before engine launch"
    );
    backend.start().await?;
    let temporary = receipt_path.with_extension("json.tmp");
    tokio::fs::write(&temporary, serde_json::to_vec(&receipt)?).await?;
    tokio::fs::rename(temporary, &receipt_path).await?;
    ensure!(
        wait_for_engine(
            &backend,
            &receipt_path,
            &receipt,
            &selected_identity,
            home.as_path(),
            false
        )
        .await?,
        "Azrael engine exited before becoming ready"
    );
    Ok(endpoint)
}

/// The operation lock stays held for this entire wait. Failed readiness alone
/// never grants termination authority: only a matching native shutdown receipt
/// can move a live engine into recovery.
async fn wait_for_engine(
    backend: &crate::backend::PidBackend,
    receipt_path: &Path,
    expected: &AzraelDaemonReceipt,
    selected_identity: &crate::managed_install::ExecutableIdentity,
    home: &Path,
    recover_stopping: bool,
) -> Result<bool> {
    let deadline = tokio::time::Instant::now() + AZRAEL_STARTUP_TIMEOUT;
    let mut stopping_since: Option<(
        crate::azrael_lifecycle::ShutdownReceipt,
        tokio::time::Instant,
    )> = None;
    loop {
        if !backend.is_starting_or_running().await? {
            return Ok(false);
        }
        if let Some(pid) = backend.running_pid().await? {
            let identity = backend
                .running_executable_identity()
                .await?
                .context("running daemon identity is unavailable")?;
            let recorded: AzraelDaemonReceipt = serde_json::from_slice(&tokio::fs::read(receipt_path).await
                .context("running daemon has no Azrael receipt; close its windows before selecting this engine")?)?;
            ensure!(
                &identity == selected_identity && recorded == *expected,
                "an Azrael engine with a different binary or startup configuration is running; close all Azrael windows before switching releases or configuration"
            );
            let stopping =
                crate::azrael_lifecycle::matching_shutdown(home, &expected.endpoint, backend)
                    .await?;
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            let ready = tokio::time::timeout(
                remaining,
                crate::azrael_lifecycle::probe_ready(&expected.endpoint, pid),
            )
            .await
            .is_ok_and(|probe| probe.is_ok())
                && backend.running_pid().await? == Some(pid);
            let stopping_elapsed = if let Some(stopping) = stopping.as_ref().filter(|_| !ready) {
                let (previous, since) = stopping_since
                    .get_or_insert_with(|| (stopping.clone(), tokio::time::Instant::now()));
                if previous != stopping {
                    *previous = stopping.clone();
                    *since = tokio::time::Instant::now();
                }
                since.elapsed()
            } else {
                stopping_since = None;
                Duration::ZERO
            };
            match crate::azrael_lifecycle::recovery_action(
                ready,
                stopping.is_some(),
                stopping_elapsed,
            ) {
                crate::azrael_lifecycle::RecoveryAction::Ready => return Ok(true),
                crate::azrael_lifecycle::RecoveryAction::Recover if recover_stopping => {
                    let stopping =
                        stopping.context("shutdown recovery requires a matching receipt")?;
                    // Re-read both receipt and executable immediately before
                    // taking the PID lock. The backend then pins that record.
                    ensure!(
                        crate::azrael_lifecycle::matching_shutdown(
                            home,
                            &expected.endpoint,
                            backend
                        )
                        .await?
                        .as_ref()
                            == Some(&stopping),
                        "engine shutdown receipt changed during recovery"
                    );
                    ensure!(
                        backend.running_executable_identity().await?.as_ref()
                            == Some(selected_identity),
                        "stopping engine executable identity changed"
                    );
                    tokio::time::timeout(
                        deadline.saturating_duration_since(tokio::time::Instant::now()),
                        backend.stop_shutdown_process(&stopping.process, selected_identity, 2),
                    )
                    .await
                    .context("stopping engine recovery exceeded the startup deadline")??;
                    continue;
                }
                _ => {}
            }
        }
        ensure!(
            tokio::time::Instant::now() < deadline,
            "Azrael engine did not become ready within the startup deadline; its process was retained"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn probe_existing_socket(socket_path: &Path) -> io::Result<bool> {
    // Windows AF_UNIX returns WSAENETDOWN (10050) when the parent directory
    // does not exist. Establish path absence before asking Winsock to connect;
    // never reinterpret that error for an endpoint which actually exists.
    match tokio::fs::symlink_metadata(socket_path).await {
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(err) => return Err(err),
        Ok(_) => {}
    }
    connect_private_stream(socket_path).await.map(|_| true)
}

pub async fn run_azrael_stdio_proxy(selected_exe: &Path, registration: Value) -> Result<()> {
    run_azrael_stdio_proxy_with_args(selected_exe, registration, &default_startup_args()).await
}

pub async fn run_azrael_stdio_proxy_with_args(
    selected_exe: &Path,
    registration: Value,
    startup_args: &[String],
) -> Result<()> {
    validate_azrael_registration(&registration)?;
    let deadline = tokio::time::Instant::now() + AZRAEL_STARTUP_TIMEOUT;
    let endpoint = tokio::time::timeout_at(
        deadline,
        ensure_azrael_started_with_args(selected_exe, startup_args),
    )
    .await
    .context("Azrael engine startup deadline expired")??;
    ensure!(
        registration["engineVersion"] == endpoint.engine_version
            && registration["engineIdentity"] == endpoint.engine_identity,
        "window engine identity differs from the selected executable"
    );
    let mut ws = connect_startup_with_retry(
        deadline,
        endpoint,
        || ensure_azrael_started_with_args(selected_exe, startup_args),
        |endpoint| {
            let registration = &registration;
            async move { connect_azrael_registered(&endpoint.socket_path, registration).await }
        },
    )
    .await?;
    let mut stdin = BufReader::new(tokio::io::stdin());
    let mut stdout = tokio::io::stdout();
    let mut line = Vec::new();
    loop {
        tokio::select! {
            read = read_bounded_line(&mut stdin, &mut line) => {
                if read? == 0 { ws.close(None).await?; return Ok(()) }
                ensure!(line.len() <= MAX_MESSAGE, "stdio JSON-RPC envelope exceeds remote transport limit");
                if line.last() == Some(&b'\n') { line.pop(); }
                if line.last() == Some(&b'\r') { line.pop(); }
                let text = std::str::from_utf8(&line)?;
                ws.send(Message::Text(text.to_owned().into())).await?;
                line.clear();
            }
            message = ws.next() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        stdout.write_all(text.as_bytes()).await?;
                        stdout.write_all(b"\n").await?;
                        stdout.flush().await?;
                    }
                    Some(Ok(Message::Ping(bytes))) => ws.send(Message::Pong(bytes)).await?,
                    Some(Ok(Message::Pong(_))) => {},
                    Some(Err(err)) => return Err(err.into()),
                    _ => bail!("Azrael daemon disconnected; reconnect with a new transport; request outcomes may be unknown"),
                }
            }
        }
    }
}

/// Registration precedes reading stdin, so these retries cannot replay official
/// RPC. The initial ensure and every retry share one absolute startup deadline.
async fn connect_startup_with_retry<T, E, EF, C, CF>(
    deadline: tokio::time::Instant,
    expected: AzraelDaemonEndpoint,
    mut ensure_started: E,
    mut connect: C,
) -> Result<T>
where
    E: FnMut() -> EF,
    EF: std::future::Future<Output = Result<AzraelDaemonEndpoint>>,
    C: FnMut(AzraelDaemonEndpoint) -> CF,
    CF: std::future::Future<Output = io::Result<T>>,
{
    loop {
        match tokio::time::timeout_at(deadline, connect(expected.clone()))
            .await
            .context("Azrael window registration startup deadline expired")?
        {
            Ok(connection) => return Ok(connection),
            Err(error) if retryable_registration_transport(&error) => {
                tokio::time::timeout_at(deadline, tokio::time::sleep(Duration::from_millis(50)))
                    .await
                    .context("Azrael window registration startup deadline expired")?;
                let endpoint = tokio::time::timeout_at(deadline, ensure_started())
                    .await
                    .context("Azrael engine recovery startup deadline expired")??;
                ensure!(
                    endpoint == expected,
                    "Azrael engine endpoint identity changed during window registration"
                );
            }
            Err(error) => return Err(error.into()),
        }
    }
}

fn retryable_registration_transport(error: &io::Error) -> bool {
    if matches!(
        error.kind(),
        io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
    ) {
        return true;
    }
    // The registration helper synthesizes this kind on close/EOF. Native peer
    // authentication rejects with PermissionDenied or a preserved OS error;
    // do not reinterpret raw failures from that admission boundary.
    if error.kind() == io::ErrorKind::ConnectionAborted && error.raw_os_error().is_none() {
        return true;
    }
    // The remaining retryable closures retain their WebSocket transport type.
    // Other admission and registration failures remain terminal.
    match error
        .get_ref()
        .and_then(|source| source.downcast_ref::<tokio_tungstenite::tungstenite::Error>())
    {
        Some(
            tokio_tungstenite::tungstenite::Error::ConnectionClosed
            | tokio_tungstenite::tungstenite::Error::AlreadyClosed,
        ) => true,
        Some(tokio_tungstenite::tungstenite::Error::Protocol(
            tokio_tungstenite::tungstenite::error::ProtocolError::ResetWithoutClosingHandshake,
        )) => true,
        Some(tokio_tungstenite::tungstenite::Error::Io(error)) => matches!(
            error.kind(),
            io::ErrorKind::UnexpectedEof
                | io::ErrorKind::ConnectionReset
                | io::ErrorKind::ConnectionAborted
                | io::ErrorKind::BrokenPipe
        ),
        _ => false,
    }
}

// Keep buffered partial input across select cancellation, bounding allocation
// before a newline arrives as well as bounding completed envelopes.
async fn read_bounded_line<R: tokio::io::AsyncBufRead + Unpin>(
    reader: &mut R,
    line: &mut Vec<u8>,
) -> io::Result<usize> {
    loop {
        let bytes = reader.fill_buf().await?;
        if bytes.is_empty() {
            return Ok(line.len());
        }
        let end = bytes.iter().position(|b| *b == b'\n').map(|i| i + 1);
        let count = end.unwrap_or(bytes.len());
        if line.len() + count > MAX_MESSAGE {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "stdio JSON-RPC envelope exceeds remote transport limit",
            ));
        }
        line.extend_from_slice(&bytes[..count]);
        reader.consume(count);
        if end.is_some() {
            return Ok(line.len());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn startup_endpoint() -> AzraelDaemonEndpoint {
        AzraelDaemonEndpoint {
            schema: 2,
            instance_id: "a".repeat(64),
            socket_path: PathBuf::from("private.sock"),
            engine_version: env!("CARGO_PKG_VERSION").into(),
            engine_identity: "b".repeat(64),
        }
    }

    #[tokio::test]
    async fn registration_startup_race_reensures_before_retry_without_forwarding_rpc() {
        let endpoint = startup_endpoint();
        let ensures = std::cell::Cell::new(0);
        let connects = std::cell::Cell::new(0);
        let connected = connect_startup_with_retry(
            tokio::time::Instant::now() + Duration::from_secs(2),
            endpoint.clone(),
            || {
                ensures.set(ensures.get() + 1);
                std::future::ready(Ok(endpoint.clone()))
            },
            |actual| {
                assert_eq!(actual, endpoint);
                connects.set(connects.get() + 1);
                std::future::ready(match connects.get() {
                    1 => Err(io::Error::from(io::ErrorKind::NotFound)),
                    2 => Err(io::Error::from(io::ErrorKind::ConnectionRefused)),
                    3 => Err(io::Error::new(
                        io::ErrorKind::ConnectionAborted,
                        "registration close/EOF",
                    )),
                    _ => Ok(42),
                })
            },
        )
        .await
        .unwrap();
        assert_eq!(connected, 42);
        assert_eq!(ensures.get(), 3);
        assert_eq!(connects.get(), 4);
    }

    #[tokio::test]
    async fn registration_startup_rejects_admission_errors_without_reensure() {
        for kind in [
            io::ErrorKind::PermissionDenied,
            io::ErrorKind::InvalidData,
            io::ErrorKind::Other,
        ] {
            let ensures = std::cell::Cell::new(0);
            let endpoint = startup_endpoint();
            let result = connect_startup_with_retry(
                tokio::time::Instant::now() + Duration::from_secs(2),
                endpoint.clone(),
                || {
                    ensures.set(ensures.get() + 1);
                    std::future::ready(Ok(endpoint.clone()))
                },
                |_| std::future::ready(Err::<(), _>(io::Error::from(kind))),
            )
            .await;
            assert!(result.is_err());
            assert_eq!(ensures.get(), 0, "retried {kind:?}");
        }
    }

    #[tokio::test]
    async fn registration_startup_reensure_cannot_reset_deadline_or_change_identity() {
        let endpoint = startup_endpoint();
        let connects = std::cell::Cell::new(0);
        let result = connect_startup_with_retry(
            tokio::time::Instant::now() + Duration::from_millis(80),
            endpoint.clone(),
            || std::future::pending::<Result<AzraelDaemonEndpoint>>(),
            |_| {
                connects.set(connects.get() + 1);
                std::future::ready(Err::<(), _>(io::Error::from(io::ErrorKind::NotFound)))
            },
        )
        .await;
        assert!(result.unwrap_err().to_string().contains("deadline"));
        assert_eq!(connects.get(), 1);
        let mut changed = endpoint.clone();
        changed.instance_id = "c".repeat(64);
        let result = connect_startup_with_retry(
            tokio::time::Instant::now() + Duration::from_secs(2),
            endpoint,
            || std::future::ready(Ok(changed.clone())),
            |_| {
                std::future::ready(Err::<(), _>(io::Error::from(
                    io::ErrorKind::ConnectionRefused,
                )))
            },
        )
        .await;
        assert!(result.unwrap_err().to_string().contains("identity changed"));
    }

    #[test]
    fn registration_startup_retries_registration_close_and_typed_websocket_closures() {
        use tokio_tungstenite::tungstenite::{Error, error::ProtocolError};
        for error in [
            Error::ConnectionClosed,
            Error::AlreadyClosed,
            Error::Io(io::Error::from(io::ErrorKind::UnexpectedEof)),
            Error::Protocol(ProtocolError::ResetWithoutClosingHandshake),
        ] {
            assert!(retryable_registration_transport(&io::Error::other(error)));
        }
        assert!(!retryable_registration_transport(&io::Error::other(
            Error::Io(io::Error::from(io::ErrorKind::PermissionDenied))
        )));
        assert!(retryable_registration_transport(&io::Error::new(
            io::ErrorKind::ConnectionAborted,
            "registration close/EOF"
        )));
        #[cfg(windows)]
        assert!(!retryable_registration_transport(
            &io::Error::from_raw_os_error(10053)
        ));
    }

    #[tokio::test]
    async fn absent_socket_with_absent_parent_does_not_attempt_a_connection() {
        let directory = tempfile::tempdir().unwrap();
        let socket = directory.path().join("absent-parent").join("control.sock");
        assert!(!probe_existing_socket(&socket).await.unwrap());
        assert_eq!(
            connect_private_stream(&socket).await.err().unwrap().kind(),
            io::ErrorKind::NotFound
        );
        let existing_file = directory.path().join("existing-file");
        tokio::fs::write(&existing_file, b"not a socket")
            .await
            .unwrap();
        assert!(probe_existing_socket(&existing_file).await.is_err());
    }

    #[tokio::test]
    async fn streaming_engine_sha256_matches_known_digest_and_observes_changed_input() {
        let file = tempfile::NamedTempFile::new().unwrap();
        tokio::fs::write(file.path(), b"abc").await.unwrap();
        assert_eq!(
            azrael_engine_sha256(file.path()).await.unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        tokio::fs::write(file.path(), b"").await.unwrap();
        assert_eq!(
            azrael_engine_sha256(file.path()).await.unwrap(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn endpoint_identity_partitions_release_and_configuration() {
        let exe = std::env::current_dir().unwrap().join("azrael");
        let args = normalize_azrael_startup_args(&default_startup_args()).unwrap();
        let id = instance_id(&exe, &"a".repeat(64), &args).unwrap();
        assert_eq!(id, instance_id(&exe, &"a".repeat(64), &args).unwrap());
        assert_ne!(
            id,
            instance_id(&exe.with_file_name("other"), &"a".repeat(64), &args).unwrap()
        );
        assert_ne!(id, instance_id(&exe, &"b".repeat(64), &args).unwrap());
        assert_ne!(id, instance_id(&exe, &"a".repeat(64), &[]).unwrap());
        let reordered = vec![
            "--analytics-default-enabled".into(),
            "-c".into(),
            "features.code_mode_host=true".into(),
        ];
        assert_eq!(args, normalize_azrael_startup_args(&reordered).unwrap());
        let overrides = vec!["-c".into(), "x=1".into(), "-c".into(), "x=2".into()];
        let reversed = vec!["-c".into(), "x=2".into(), "-c".into(), "x=1".into()];
        assert_ne!(
            normalize_azrael_startup_args(&overrides).unwrap(),
            normalize_azrael_startup_args(&reversed).unwrap()
        );
    }

    #[test]
    fn descriptor_and_receipt_bind_full_instance_with_bounded_socket_leaf() {
        let home = std::env::current_dir().unwrap();
        let endpoint = endpoint_from_inputs(
            &home.join("azrael"),
            "a".repeat(64),
            &[],
            &home.join("ipc/legacy.sock"),
        )
        .unwrap();
        assert_eq!(endpoint.schema, 2);
        assert!(endpoint.socket_path.is_absolute());
        assert_eq!(
            endpoint
                .socket_path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .len(),
            25
        );
        assert_eq!(endpoint.instance_id.len(), 64);
        assert_eq!(
            endpoint.instance_id,
            instance_id(&home.join("azrael"), &"a".repeat(64), &[]).unwrap()
        );
        assert_eq!(endpoint.socket_path.parent().unwrap(), home.join("ipc"));
        assert_eq!(endpoint.socket_path.extension().unwrap(), "sock");
        let other = endpoint_from_inputs(
            &home.join("azrael"),
            "b".repeat(64),
            &[],
            &home.join("ipc/legacy.sock"),
        )
        .unwrap();
        assert_ne!(endpoint.socket_path, other.socket_path);
        let value = serde_json::to_value(&endpoint).unwrap();
        assert_eq!(value["instanceId"], endpoint.instance_id);
        let receipt = AzraelDaemonReceipt {
            endpoint: endpoint.clone(),
            native_argv: vec![],
        };
        let mut altered = serde_json::to_value(&receipt).unwrap();
        let prefix = &endpoint.instance_id[..24];
        altered["instanceId"] = json!(format!("{prefix}{}", "0".repeat(40)));
        assert_ne!(
            receipt,
            serde_json::from_value::<AzraelDaemonReceipt>(altered).unwrap()
        );
        let registry = azrael_window_registry_path(&home, &endpoint.instance_id).unwrap();
        assert_eq!(
            registry,
            home.join("azrael/runtime/engines")
                .join(&endpoint.instance_id)
                .join("window-owners.json")
        );
        for invalid in [
            "../escape".to_owned(),
            "A".repeat(64),
            format!("{}\\", "a".repeat(63)),
        ] {
            assert!(azrael_window_registry_path(&home, &invalid).is_err());
        }
    }

    #[test]
    fn socket_stem_preserves_96_bits_in_lowercase_unpadded_base32() {
        for (hex, expected) in [
            ("000000000000000000000000", "aaaaaaaaaaaaaaaaaaaa"),
            ("ffffffffffffffffffffffff", "7777777777777777777q"),
            ("666f6f626172666f6f626172", "mzxw6ytbojtg633cmfza"),
        ] {
            let full_instance = format!("{hex}{}", "0".repeat(40));
            let stem = socket_stem(&full_instance).unwrap();
            assert_eq!(stem, expected);
            assert_eq!(stem.len(), 20);
            assert!(
                stem.bytes()
                    .all(|b| b.is_ascii_lowercase() || (b'2'..=b'7').contains(&b))
            );
            assert_eq!(
                data_encoding::BASE32_NOPAD
                    .decode(stem.to_ascii_uppercase().as_bytes())
                    .unwrap(),
                data_encoding::HEXLOWER.decode(hex.as_bytes()).unwrap()
            );
            assert_eq!(
                socket_stem(&format!("{hex}{}", "f".repeat(40))).unwrap(),
                stem
            );
        }
    }

    #[tokio::test]
    async fn captures_live_native_process_identity() {
        let identity = crate::capture_process_identity(std::process::id())
            .await
            .unwrap()
            .unwrap();
        assert!(identity.is_alive().await.unwrap());
        assert!(crate::capture_process_identity(0).await.is_err());
    }

    #[tokio::test]
    async fn stdio_buffer_preserves_partial_input_and_multiple_envelopes() {
        let mut reader = BufReader::with_capacity(3, b"first\nsecond\n".as_slice());
        let mut line = Vec::new();
        assert_eq!(read_bounded_line(&mut reader, &mut line).await.unwrap(), 6);
        assert_eq!(line, b"first\n");
        line.clear();
        assert_eq!(read_bounded_line(&mut reader, &mut line).await.unwrap(), 7);
        assert_eq!(line, b"second\n");
    }
}

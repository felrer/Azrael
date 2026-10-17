//! Azrael's explicitly selected private daemon and lossless per-window transport.
//! This path never installs, updates, enrolls or migrates a managed Codex release.

use anyhow::{Context, Result, bail, ensure};
use codex_uds::UnixStream;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    io,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio_tungstenite::tungstenite::{Message, protocol::WebSocketConfig};
use tokio_tungstenite::{WebSocketStream, client_async_with_config};

const TIMEOUT: Duration = Duration::from_secs(10);
// Registration includes native config loading and binary identity validation.
// Keep this bounded separately from short lifecycle operations and align clients.
pub const AZRAEL_STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
// Same envelope ceiling as app-server-client's remote transport.
const MAX_MESSAGE: usize = 128 << 20;
const REGISTER_ID: &str = "azrael-private-window-registration";

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
    let socket_path = legacy_socket.with_file_name(format!("{}.sock", &instance_id[..24]));
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
    let _lock = tokio::time::timeout(TIMEOUT, daemon.acquire_operation_lock())
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
    if backend.is_starting_or_running().await? {
        let identity = backend.running_executable_identity().await?.context(
            "running daemon identity is unavailable; close its windows before selecting an engine",
        )?;
        let recorded: AzraelDaemonReceipt = serde_json::from_slice(&tokio::fs::read(&receipt_path).await
            .context("running daemon has no Azrael receipt; close its windows before selecting this engine")?)?;
        ensure!(
            identity == selected_identity && recorded == receipt,
            "an Azrael engine with a different binary or startup configuration is running; close all Azrael windows before switching releases or configuration"
        );
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
    backend.start().await?;
    let temporary = receipt_path.with_extension("json.tmp");
    tokio::fs::write(&temporary, serde_json::to_vec(&receipt)?).await?;
    tokio::fs::rename(temporary, receipt_path).await?;
    Ok(endpoint)
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

pub fn validate_azrael_registration(registration: &Value) -> io::Result<()> {
    let valid_hex = |key: &str, min: usize, max: usize| {
        registration[key].as_str().is_some_and(|s| {
            (min..=max).contains(&s.len())
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
    };
    let absolute = |key: &str| {
        registration[key]
            .as_str()
            .is_some_and(|s| Path::new(s).is_absolute())
    };
    if registration["schema"] != 1
        || !matches!(registration["role"].as_str(), Some("window" | "companion"))
        || !valid_hex("ownerId", 32, 64)
        || !valid_hex("workspaceId", 64, 64)
        || !valid_hex("engineIdentity", 64, 64)
        || !absolute("accountStateFile")
        || !(registration["accountDefaultFile"].is_null() || absolute("accountDefaultFile"))
        || !registration["hostPid"]
            .as_u64()
            .is_some_and(|pid| pid > 0 && pid <= u32::MAX as u64)
        || registration["engineVersion"].as_str() != Some(env!("CARGO_PKG_VERSION"))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid Azrael window registration",
        ));
    }
    Ok(())
}

pub async fn connect_azrael_registered(
    socket_path: &Path,
    registration: &Value,
) -> io::Result<WebSocketStream<UnixStream>> {
    validate_azrael_registration(registration)?;
    let connect = async {
        let stream = connect_private_stream(socket_path).await?;
        let config = WebSocketConfig::default()
            .max_frame_size(Some(MAX_MESSAGE))
            .max_message_size(Some(MAX_MESSAGE));
        let (mut ws, _) = client_async_with_config("ws://localhost/rpc", stream, Some(config))
            .await
            .map_err(io::Error::other)?;
        ws.send(Message::Text(
            json!({"id":REGISTER_ID,"method":"azrael/window/register","params":registration})
                .to_string()
                .into(),
        ))
        .await
        .map_err(io::Error::other)?;
        loop {
            match ws.next().await {
                Some(Ok(Message::Text(text))) => {
                    let reply: Value = serde_json::from_str(&text)?;
                    verify_registration_reply(&reply, registration)?;
                    return Ok(ws);
                }
                Some(Ok(Message::Ping(bytes))) => ws
                    .send(Message::Pong(bytes))
                    .await
                    .map_err(io::Error::other)?,
                Some(Err(err)) => return Err(io::Error::other(err)),
                _ => {
                    return Err(io::Error::new(
                        io::ErrorKind::ConnectionAborted,
                        "daemon closed during window registration",
                    ));
                }
            }
        }
    };
    tokio::time::timeout(AZRAEL_STARTUP_TIMEOUT, connect)
        .await
        .map_err(|_| {
            io::Error::new(
                io::ErrorKind::TimedOut,
                "Azrael daemon connection or registration timed out",
            )
        })?
}

fn verify_registration_reply(reply: &Value, registration: &Value) -> io::Result<()> {
    if reply["id"] != REGISTER_ID {
        return Err(io::Error::other(
            "Azrael daemon returned an unexpected registration response ID",
        ));
    }
    if let Some(error) = reply.get("error") {
        let code = error["code"]
            .as_i64()
            .map(|code| code.to_string())
            .unwrap_or_else(|| "unknown".into());
        // Include only the causal RPC message, never registration parameters,
        // error data or an unbounded peer response. Flatten control characters
        // to keep stderr as a single diagnostic line.
        let message: String = error["message"]
            .as_str()
            .unwrap_or("registration rejected")
            .chars()
            .take(512)
            .map(|c| if c.is_control() { ' ' } else { c })
            .collect();
        return Err(io::Error::other(format!(
            "Azrael daemon rejected window registration (code {code}): {message}"
        )));
    }
    for field in ["engineVersion", "engineIdentity", "ownerId"] {
        if reply["result"][field] != registration[field] {
            return Err(io::Error::other(format!(
                "Azrael daemon registration response {field} mismatch"
            )));
        }
    }
    if !reply["result"]["enginePid"]
        .as_u64()
        .is_some_and(|pid| pid > 0 && pid <= u32::MAX as u64)
    {
        return Err(io::Error::other(
            "Azrael daemon registration response has an invalid engine PID",
        ));
    }
    Ok(())
}

async fn connect_private_stream(socket_path: &Path) -> io::Result<UnixStream> {
    // On Windows, a missing parent can produce WSAENETDOWN rather than a
    // connection-refused error. Classify confirmed path absence before connect;
    // existing endpoint errors still retain the original platform meaning.
    tokio::fs::symlink_metadata(socket_path).await?;
    #[cfg(unix)]
    {
        UnixStream::connect_private(socket_path).await
    }
    #[cfg(windows)]
    {
        let stream = UnixStream::connect(socket_path).await?;
        stream.ensure_non_elevated_peer()?;
        Ok(stream)
    }
    #[cfg(not(any(unix, windows)))]
    {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "private daemon transport is unsupported",
        ))
    }
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
    let endpoint = ensure_azrael_started_with_args(selected_exe, startup_args).await?;
    ensure!(
        registration["engineVersion"] == endpoint.engine_version
            && registration["engineIdentity"] == endpoint.engine_identity,
        "window engine identity differs from the selected executable"
    );
    // Startup races retry only before any official request can be sent.
    let deadline = tokio::time::Instant::now() + AZRAEL_STARTUP_TIMEOUT;
    let mut ws = loop {
        match connect_azrael_registered(&endpoint.socket_path, &registration).await {
            Ok(ws) => break ws,
            Err(err)
                if err.kind() == io::ErrorKind::NotFound
                    || err.kind() == io::ErrorKind::ConnectionRefused =>
            {
                if tokio::time::Instant::now() >= deadline {
                    return Err(err.into());
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(err) => return Err(err.into()),
        }
    };
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

    fn registration() -> Value {
        json!({"schema":1,"role":"window","ownerId":"a".repeat(32),
            "workspaceId":"b".repeat(64),"hostPid":std::process::id(),
            "accountStateFile":std::env::temp_dir().join("account.json"),
            "accountDefaultFile":null,"engineVersion":env!("CARGO_PKG_VERSION"),
            "engineIdentity":"c".repeat(64)})
    }

    #[test]
    fn rejects_unbound_and_non_absolute_registration() {
        let mut value = registration();
        assert!(validate_azrael_registration(&value).is_ok());
        value["hostPid"] = json!(0);
        assert!(validate_azrael_registration(&value).is_err());
        value = registration();
        value["accountStateFile"] = json!("relative.json");
        assert!(validate_azrael_registration(&value).is_err());
        value = registration();
        value["engineIdentity"] = json!("C".repeat(64));
        assert!(validate_azrael_registration(&value).is_err());
    }

    #[test]
    fn registration_diagnostics_preserve_cause_without_echoing_rpc_data() {
        let reply = json!({"id":REGISTER_ID,"error":{"code":-32602,
            "message":"owner host changed\nretry","data":{"token":"secret-token"}}});
        let error = verify_registration_reply(&reply, &registration())
            .unwrap_err()
            .to_string();
        assert!(error.contains("-32602"));
        assert!(error.contains("owner host changed retry"));
        assert!(!error.contains("secret-token"));
        assert!(!error.contains('\n'));
        let registration = registration();
        let reply = json!({"id":REGISTER_ID,"result":{"enginePid":1,
            "engineVersion":registration["engineVersion"],"engineIdentity":"d".repeat(64),
            "ownerId":registration["ownerId"]}});
        assert!(
            verify_registration_reply(&reply, &registration)
                .unwrap_err()
                .to_string()
                .contains("engineIdentity mismatch")
        );
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
            &home.join("control/legacy.sock"),
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
            29
        );
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

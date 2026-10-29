//! Restricted companion bridge to the official UI's stdio server instance.
//! Native peer authentication and WebSocket handling stay in app-server-client.

use codex_app_server_client::AppServerEvent;
use codex_app_server_client::RemoteAppServerClient;
use codex_app_server_client::RemoteAppServerConnectArgs;
use codex_app_server_client::RemoteAppServerEndpoint;
use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::ServerNotification;
use codex_utils_absolute_path::AbsolutePathBuf;
use serde_json::Value;
use serde_json::json;
use std::io;
use std::path::PathBuf;
use tokio::io::AsyncBufRead;
use tokio::io::AsyncBufReadExt;
use tokio::io::AsyncWrite;
use tokio::io::AsyncWriteExt;
use tokio::io::BufReader;
use tokio::task::JoinSet;
use tokio::time::Duration;

#[derive(Clone, Copy)]
enum FailurePhase {
    Connect,
    Stream,
    Protocol,
}

impl FailurePhase {
    fn as_str(self) -> &'static str {
        match self {
            Self::Connect => "connect",
            Self::Stream => "stream",
            Self::Protocol => "protocol",
        }
    }
}

// Build from a closed set of values, never from error messages or source chains.
fn failure_notice(phase: FailurePhase, error: &io::Error) -> Value {
    let (code, retryable) = match error.kind() {
        io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
            if matches!(phase, FailurePhase::Connect) =>
        {
            ("endpoint_unavailable", true)
        }
        io::ErrorKind::PermissionDenied => ("permission_denied", false),
        io::ErrorKind::TimedOut => ("timeout", true),
        io::ErrorKind::InvalidInput | io::ErrorKind::InvalidData => ("protocol_error", false),
        io::ErrorKind::ConnectionReset
        | io::ErrorKind::ConnectionAborted
        | io::ErrorKind::BrokenPipe => ("connection_lost", true),
        _ => ("internal", false),
    };
    json!({"method":"azrael/bridgeError","params":{
        "schema":1,"phase":phase.as_str(),"code":code,"retryable":retryable
    }})
}

fn redacted_terminal_error(error: io::Error) -> io::Error {
    io::Error::new(error.kind(), "azrael bridge failed")
}

fn main() -> io::Result<()> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(redacted_terminal_error)?;
    let result = runtime.block_on(run());
    if result.is_err() {
        // A timed-out stdout write can still occupy a blocking worker. Do not
        // wait for it during runtime teardown on a terminal failure.
        runtime.shutdown_background();
    }
    result.map_err(redacted_terminal_error)
}

async fn run() -> io::Result<()> {
    let mut phase = FailurePhase::Connect;
    let result = async {
        let socket = std::env::args_os().nth(1).ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "expected absolute socket path")
        })?;
        let socket_path = AbsolutePathBuf::from_absolute_path(PathBuf::from(socket))?;
        run_connection(socket_path, &mut phase).await
    }
    .await;
    if let Err(error) = &result {
        // Diagnostics must not delay termination if the host has stopped reading.
        let notice = format!("{}\n", failure_notice(phase, error));
        let _ = tokio::time::timeout(Duration::from_millis(100), async {
            let mut stdout = tokio::io::stdout();
            stdout.write_all(notice.as_bytes()).await?;
            stdout.flush().await
        })
        .await;
    }
    result
}

async fn run_connection(socket_path: AbsolutePathBuf, phase: &mut FailurePhase) -> io::Result<()> {
    let args = RemoteAppServerConnectArgs {
        endpoint: RemoteAppServerEndpoint::UnixSocket { socket_path },
        client_name: "azrael-ex".to_string(),
        client_version: env!("CARGO_PKG_VERSION").to_string(),
        experimental_api: true,
        mcp_server_openai_form_elicitation: false,
        opt_out_notification_methods: Vec::new(),
        channel_capacity: 32,
    };
    let client = if let Some(context) = std::env::var_os("AZRAEL_EX_WINDOW_CONTEXT") {
        let mut registration: Value = serde_json::from_str(&context.to_string_lossy())?;
        registration
            .as_object_mut()
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidData, "invalid window registration")
            })?
            .insert("role".into(), Value::String("companion".into()));
        tokio::time::timeout(
            codex_app_server_daemon::AZRAEL_STARTUP_TIMEOUT + Duration::from_secs(5),
            RemoteAppServerClient::connect_azrael_local_daemon(args, registration),
        )
        .await??
    } else {
        tokio::time::timeout(
            Duration::from_secs(15),
            RemoteAppServerClient::connect_local_daemon(args),
        )
        .await??
    };
    run_session(
        client,
        BufReader::new(tokio::io::stdin()),
        tokio::io::stdout(),
        phase,
    )
    .await
}

async fn run_session(
    mut client: RemoteAppServerClient,
    input: impl AsyncBufRead + Unpin,
    mut stdout: impl AsyncWrite + Unpin,
    phase: &mut FailurePhase,
) -> io::Result<()> {
    *phase = FailurePhase::Protocol;
    let ready = json!({"method":"azrael/connected","params":{
        "codexHome":client.codex_home(), "serverVersion":client.server_version()
    }});
    stdout.write_all(format!("{ready}\n").as_bytes()).await?;
    stdout.flush().await?;
    let mut lines = input.lines();
    let mut pending = JoinSet::new();
    loop {
        tokio::select! {
            line = lines.next_line() => {
                let Some(line) = line? else { break };
                if line.len() > 65536 {
                    return Err(io::Error::new(io::ErrorKind::InvalidInput, "request too large"));
                }
                let envelope: Value = serde_json::from_str(&line)?;
                let id = envelope.get("id").cloned().unwrap_or(Value::Null);
                let timeout_seconds = if envelope["method"] == "azrael/devin" { 200 } else { 60 };
                let response = if !matches!(envelope["method"].as_str(), Some("account/read" | "config/read" | "azrael/account" | "azrael/devin" | "azrael/rootResume" | "azrael/projectUsage")) {
                    json!({"id":id,"error":{"code":-32601,"message":"method is not allowed by the azrael bridge"}})
                } else if pending.len() >= 8 {
                    json!({"id":id,"error":{"code":-32000,"message":"too many pending management requests"}})
                } else {
                    match serde_json::from_value::<ClientRequest>(envelope) {
                        Ok(request) => {
                            let handle = client.request_handle();
                            pending.spawn(async move {
                                match tokio::time::timeout(Duration::from_secs(timeout_seconds), handle.request(request)).await {
                                    Ok(Ok(Ok(result))) => json!({"id":id,"result":result}),
                                    Ok(Ok(Err(error))) => json!({"id":id,"error":error}),
                                    Ok(Err(_)) => json!({"id":id,"error":{"code":-32000,"message":"management connection failed; action outcome may be unknown"}}),
                                    Err(_) => json!({"id":id,"error":{"code":-32000,"message":"management request timed out; action outcome may be unknown"}}),
                                }
                            });
                            continue;
                        }
                        Err(_) => json!({"id":id,"error":{"code":-32602,"message":"invalid management parameters"}}),
                    }
                };
                stdout.write_all(format!("{response}\n").as_bytes()).await?;
                stdout.flush().await?;
            }
            response = pending.join_next(), if !pending.is_empty() => {
                let response = response.ok_or_else(|| io::Error::other("management request task missing"))?
                    .map_err(|_| io::Error::other("management request task failed"))?;
                stdout.write_all(format!("{response}\n").as_bytes()).await?;
                stdout.flush().await?;
            }
            event = client.next_event() => {
                match event {
                    Some(AppServerEvent::ServerNotification(notification)) => {
                        if matches!(notification.as_ref(), ServerNotification::AzraelAccountUpdated(_) | ServerNotification::AccountUpdated(_) | ServerNotification::AccountRateLimitsUpdated(_)) {
                            let notification = serde_json::to_string(&notification)?;
                            stdout.write_all(format!("{notification}\n").as_bytes()).await?;
                            stdout.flush().await?;
                        }
                    }
                    Some(AppServerEvent::ServerRequest(_)) => {
                        // The restricted companion does not own interactive requests.
                        // The UI/token owner answers them; even rejecting here would
                        // race that owner. Typed requests must not end management RPCs.
                    }
                    Some(AppServerEvent::Lagged { .. }) => {
                        *phase = FailurePhase::Stream;
                        return Err(io::Error::new(io::ErrorKind::ConnectionAborted, "management connection lost events"));
                    }
                    Some(AppServerEvent::Disconnected { .. }) => {
                        *phase = FailurePhase::Stream;
                        return Err(io::Error::new(io::ErrorKind::ConnectionAborted, "management connection disconnected"));
                    }
                    None => {
                        *phase = FailurePhase::Stream;
                        return Err(io::Error::new(io::ErrorKind::ConnectionAborted, "management event stream ended"));
                    }
                }
            }
        }
    }
    *phase = FailurePhase::Stream;
    client.shutdown().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::SinkExt;
    use futures::StreamExt;
    use tokio::net::TcpListener;
    use tokio::net::TcpStream;
    use tokio_tungstenite::WebSocketStream;
    use tokio_tungstenite::accept_async;
    use tokio_tungstenite::tungstenite::Message;

    async fn terminal_read_frame(socket: &mut WebSocketStream<TcpStream>) -> Option<Value> {
        while let Some(frame) = socket.next().await {
            match frame.expect("fixture websocket frame") {
                Message::Text(text) => return Some(serde_json::from_str(&text).unwrap()),
                Message::Close(_) => return None,
                _ => {}
            }
        }
        None
    }

    async fn terminal_send_frame(socket: &mut WebSocketStream<TcpStream>, value: Value) {
        socket
            .send(Message::Text(value.to_string().into()))
            .await
            .unwrap();
    }

    // Real remote parsing and event delivery feed the same loop used by stdio.
    // The fixture permits only initialize/initialized and account/read outbound
    // frames: any approval, token, or rejection response fails the server task.
    async fn terminal_remote_fixture() -> (RemoteAppServerClient, tokio::task::JoinHandle<usize>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            let initialize = terminal_read_frame(&mut socket).await.unwrap();
            assert_eq!(initialize["method"], "initialize");
            terminal_send_frame(&mut socket, json!({"id":initialize["id"],"result":{
                "userAgent":"bridge-fixture/1.0.0 (Test OS; x86_64) rust", "codexHome":"/fixture"
            }})).await;
            assert_eq!(
                terminal_read_frame(&mut socket).await.unwrap()["method"],
                "initialized"
            );
            let mut rounds = 0;
            while let Some(request) = terminal_read_frame(&mut socket).await {
                assert_eq!(
                    request["method"], "account/read",
                    "companion must never answer or reject a server request"
                );
                assert!(request.get("result").is_none() && request.get("error").is_none());
                for (offset, method, params) in [
                    (
                        0,
                        "account/chatgptAuthTokens/refresh",
                        json!({"reason":"unauthorized","previousAccountId":"fixture-account"}),
                    ),
                    (
                        1,
                        "item/commandExecution/requestApproval",
                        json!({"threadId":"fixture-thread","turnId":"fixture-turn","itemId":"fixture-item","startedAtMs":1}),
                    ),
                ] {
                    let event =
                        json!({"id":1000 + rounds * 2 + offset,"method":method,"params":params});
                    // Establish that these are normal typed requests, not malformed input.
                    let _: codex_app_server_protocol::ServerRequest =
                        serde_json::from_value(event.clone()).unwrap();
                    terminal_send_frame(&mut socket, event).await;
                }
                // A forwarded notification is an event-stream barrier: the bridge
                // must consume both preceding requests before forwarding this.
                terminal_send_frame(
                    &mut socket,
                    json!({"method":"account/updated","params":{"authMode":null,"planType":null}}),
                )
                .await;
                terminal_send_frame(&mut socket, json!({"id":request["id"],"result":{"account":null,"requiresOpenaiAuth":false}})).await;
                rounds += 1;
            }
            rounds
        });
        let client = RemoteAppServerClient::connect(RemoteAppServerConnectArgs {
            endpoint: RemoteAppServerEndpoint::WebSocket {
                websocket_url: format!("ws://{address}"),
                auth_token: None,
            },
            client_name: "bridge-fixture".into(),
            client_version: "0.0.0-test".into(),
            experimental_api: true,
            mcp_server_openai_form_elicitation: false,
            opt_out_notification_methods: Vec::new(),
            channel_capacity: 32,
        })
        .await
        .unwrap();
        (client, server)
    }

    #[tokio::test]
    async fn terminal_server_requests_preserve_management_without_answering() {
        tokio::time::timeout(Duration::from_secs(10), async {
            let (client, server) = terminal_remote_fixture().await;
            let (input, mut host_input) = tokio::io::duplex(4096);
            let (output, host_output) = tokio::io::duplex(4096);
            let session = tokio::spawn(async move {
                let mut phase = FailurePhase::Connect;
                run_session(client, BufReader::new(input), output, &mut phase).await
            });
            let mut lines = BufReader::new(host_output).lines();
            let ready: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(ready["method"], "azrael/connected");
            for id in 1..=3 {
                host_input
                    .write_all(
                        format!(
                            "{}\n",
                            json!({"id":id,"method":"account/read","params":{"refreshToken":false}})
                        )
                        .as_bytes(),
                    )
                    .await
                    .unwrap();
                let mut observed = Vec::new();
                for _ in 0..2 {
                    observed.push(
                        serde_json::from_str::<Value>(&lines.next_line().await.unwrap().unwrap())
                            .unwrap(),
                    );
                }
                assert!(observed.contains(
                    &json!({"id":id,"result":{"account":null,"requiresOpenaiAuth":false}})
                ));
                assert!(
                    observed
                        .iter()
                        .any(|message| message["method"] == "account/updated")
                );
            }
            host_input.shutdown().await.unwrap();
            session.await.unwrap().unwrap();
            assert!(lines.next_line().await.unwrap().is_none());
            assert_eq!(server.await.unwrap(), 3);
        })
        .await
        .expect("management session must remain live across repeated server requests");
    }

    #[tokio::test]
    async fn terminal_malformed_stdin_still_fails_closed() {
        tokio::time::timeout(Duration::from_secs(10), async {
            let (client, server) = terminal_remote_fixture().await;
            let (input, mut host_input) = tokio::io::duplex(4096);
            let (output, host_output) = tokio::io::duplex(4096);
            let session = tokio::spawn(async move {
                let mut phase = FailurePhase::Connect;
                let error = run_session(client, BufReader::new(input), output, &mut phase)
                    .await
                    .unwrap_err();
                assert_eq!(error.kind(), io::ErrorKind::InvalidData);
                assert_eq!(
                    failure_notice(phase, &error)["params"],
                    json!({"schema":1,"phase":"protocol","code":"protocol_error","retryable":false})
                );
            });
            let mut lines = BufReader::new(host_output).lines();
            assert!(
                lines
                    .next_line()
                    .await
                    .unwrap()
                    .unwrap()
                    .contains("azrael/connected")
            );
            host_input.write_all(b"{malformed\n").await.unwrap();
            session.await.unwrap();
            assert!(lines.next_line().await.unwrap().is_none());
            // The session has already failed; no fixture server is needed afterward.
            server.abort();
            let _ = server.await;
        })
        .await
        .expect("malformed stdin must terminate promptly");
    }

    #[test]
    fn terminal_failure_classification() {
        use io::ErrorKind::*;
        for (kind, code, retryable) in [
            (NotFound, "endpoint_unavailable", true),
            (ConnectionRefused, "endpoint_unavailable", true),
            (PermissionDenied, "permission_denied", false),
            (TimedOut, "timeout", true),
            (InvalidInput, "protocol_error", false),
            (InvalidData, "protocol_error", false),
            (ConnectionReset, "connection_lost", true),
            (ConnectionAborted, "connection_lost", true),
            (BrokenPipe, "connection_lost", true),
            (Other, "internal", false),
            (Unsupported, "internal", false),
        ] {
            let notice = failure_notice(FailurePhase::Connect, &io::Error::from(kind));
            assert_eq!(notice["params"]["code"], code);
            assert_eq!(notice["params"]["retryable"], retryable);
        }
        for phase in [FailurePhase::Stream, FailurePhase::Protocol] {
            let notice = failure_notice(phase, &io::Error::from(NotFound));
            assert_eq!(notice["params"]["code"], "internal");
            assert_eq!(notice["params"]["retryable"], false);
        }
    }

    #[test]
    fn terminal_failure_wire_is_bounded_and_excludes_error_contents() {
        let secret = "socket=/private/home/user/socket credential=secret request={payload}";
        let error = io::Error::new(io::ErrorKind::Other, io::Error::other(secret));
        for (phase, name) in [
            (FailurePhase::Connect, "connect"),
            (FailurePhase::Stream, "stream"),
            (FailurePhase::Protocol, "protocol"),
        ] {
            let notice = failure_notice(phase, &error);
            assert_eq!(
                notice,
                json!({"method":"azrael/bridgeError","params":{
                    "schema":1,"phase":name,"code":"internal","retryable":false
                }})
            );
            let wire = serde_json::to_string(&notice).unwrap();
            assert!(wire.len() < 256);
            assert!(!wire.contains(secret));
            assert!(!wire.contains("credential"));
            assert!(!wire.contains("/private"));
            assert!(!wire.contains("payload"));
        }
    }

    #[test]
    fn terminal_stderr_error_preserves_kind_without_original_details() {
        let error = io::Error::new(
            io::ErrorKind::PermissionDenied,
            io::Error::other("socket=/private/home/user credential=secret"),
        );
        let redacted = redacted_terminal_error(error);
        assert_eq!(redacted.kind(), io::ErrorKind::PermissionDenied);
        assert_eq!(redacted.to_string(), "azrael bridge failed");
        assert!(!format!("{redacted:?}").contains("secret"));
        assert!(!format!("{redacted:?}").contains("/private"));
    }
}

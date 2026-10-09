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
use tokio::io::AsyncBufReadExt;
use tokio::io::AsyncWriteExt;
use tokio::io::BufReader;
use tokio::task::JoinSet;
use tokio::time::Duration;

fn main() -> io::Result<()> {
    let socket = std::env::args_os().nth(1).ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "expected absolute socket path")
    })?;
    let socket_path = AbsolutePathBuf::from_absolute_path(PathBuf::from(socket))?;
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(run(socket_path))
}

async fn run(socket_path: AbsolutePathBuf) -> io::Result<()> {
    let mut client = tokio::time::timeout(
        Duration::from_secs(15),
        RemoteAppServerClient::connect_local_daemon(RemoteAppServerConnectArgs {
            endpoint: RemoteAppServerEndpoint::UnixSocket { socket_path },
            client_name: "azrael-ex".to_string(),
            client_version: env!("CARGO_PKG_VERSION").to_string(),
            experimental_api: true,
            mcp_server_openai_form_elicitation: false,
            opt_out_notification_methods: Vec::new(),
            channel_capacity: 32,
        }),
    )
    .await??;
    let mut stdout = tokio::io::stdout();
    let ready = json!({"method":"azrael/connected","params":{
        "codexHome":client.codex_home(), "serverVersion":client.server_version()
    }});
    stdout.write_all(format!("{ready}\n").as_bytes()).await?;
    stdout.flush().await?;
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
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
                        return Err(io::Error::other("unexpected server request on management bridge"));
                    }
                    Some(AppServerEvent::Lagged { .. }) => {
                        return Err(io::Error::other("management connection lost events"));
                    }
                    Some(AppServerEvent::Disconnected { message }) => {
                        return Err(io::Error::new(io::ErrorKind::ConnectionAborted, message));
                    }
                    None => break,
                }
            }
        }
    }
    client.shutdown().await
}

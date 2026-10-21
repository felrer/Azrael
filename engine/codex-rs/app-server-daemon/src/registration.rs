//! Private Azrael connection admission and per-window registration.

use codex_uds::UnixStream;
use futures::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{io, path::Path, time::Duration};
use tokio_tungstenite::tungstenite::{Message, protocol::WebSocketConfig};
use tokio_tungstenite::{WebSocketStream, client_async_with_config};

// Registration includes native config loading and binary identity validation.
// Keep this bounded separately from short lifecycle operations and align clients.
pub const AZRAEL_STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
// Same envelope ceiling as app-server-client's remote transport.
pub(crate) const MAX_MESSAGE: usize = 128 << 20;
const REGISTER_ID: &str = "azrael-private-window-registration";

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

pub(crate) async fn connect_private_stream(socket_path: &Path) -> io::Result<UnixStream> {
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
}

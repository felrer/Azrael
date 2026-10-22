//! Read-only readiness and receipt-bound recovery for a private engine instance.

use anyhow::{Context, Result, ensure};
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    io,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio_tungstenite::tungstenite::{Message, protocol::WebSocketConfig};

use crate::{
    azrael::AzraelDaemonEndpoint, backend::PidBackend, registration::connect_private_stream,
};

const STATUS_ID: &str = "azrael-engine-status";
const STATUS_TIMEOUT: Duration = Duration::from_secs(2);
pub(crate) const NATURAL_SHUTDOWN_WAIT: Duration = Duration::from_secs(35);

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RecoveryAction {
    Ready,
    Wait,
    Recover,
}

pub(crate) fn recovery_action(
    ready: bool,
    receipt_bound: bool,
    elapsed: Duration,
) -> RecoveryAction {
    match (ready, receipt_bound) {
        (true, false) => RecoveryAction::Ready,
        (false, true) if elapsed >= NATURAL_SHUTDOWN_WAIT => RecoveryAction::Recover,
        _ => RecoveryAction::Wait,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShutdownReceipt {
    schema: u32,
    instance_id: String,
    pub(crate) process: Value,
}

fn shutdown_path(home: &Path, instance: &str) -> Result<PathBuf> {
    Ok(crate::azrael::azrael_window_registry_path(home, instance)?.with_file_name("shutdown.json"))
}

/// Only this native lifetime can subsequently be recovered by a launcher.
/// Never acquire the launcher lock here.
pub async fn publish_azrael_shutdown(home: &Path, instance: &str) -> Result<()> {
    let path = shutdown_path(home, instance)?;
    let receipt = ShutdownReceipt {
        schema: 1,
        instance_id: instance.to_owned(),
        process: PidBackend::current_shutdown_identity().await?,
    };
    tokio::fs::create_dir_all(path.parent().context("shutdown receipt has no parent")?).await?;
    // A unique temporary name also isolates an overlapping predecessor's write.
    let temporary = path.with_file_name(format!("shutdown.{}.tmp", std::process::id()));
    tokio::fs::write(&temporary, serde_json::to_vec(&receipt)?).await?;
    tokio::fs::rename(&temporary, &path)
        .await
        .context("failed to publish Azrael shutdown receipt")
}

pub(crate) async fn matching_shutdown(
    home: &Path,
    endpoint: &AzraelDaemonEndpoint,
    backend: &PidBackend,
) -> Result<Option<ShutdownReceipt>> {
    let bytes = match tokio::fs::read(shutdown_path(home, &endpoint.instance_id)?).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    // A corrupt or stale receipt grants no termination authority.
    let Ok(receipt) = serde_json::from_slice::<ShutdownReceipt>(&bytes) else {
        return Ok(None);
    };
    if receipt.schema != 1 || receipt.instance_id != endpoint.instance_id {
        return Ok(None);
    }
    if backend
        .matches_shutdown_identity(&receipt.process)
        .await
        .unwrap_or(false)
    {
        Ok(Some(receipt))
    } else {
        Ok(None)
    }
}

fn verify_status(reply: &Value, endpoint: &AzraelDaemonEndpoint, pid: u32) -> Result<()> {
    ensure!(
        reply["id"] == STATUS_ID && reply.get("error").is_none(),
        "unexpected engine status response"
    );
    let result = &reply["result"];
    ensure!(
        result["schema"] == 1 && result["state"] == "ready",
        "engine is not ready"
    );
    ensure!(
        pid != 0 && result["enginePid"].as_u64() == Some(u64::from(pid)),
        "engine status PID mismatch"
    );
    ensure!(
        result["instanceId"] == endpoint.instance_id,
        "engine status instance mismatch"
    );
    ensure!(
        result["engineVersion"] == endpoint.engine_version,
        "engine status version mismatch"
    );
    ensure!(
        result["engineIdentity"] == endpoint.engine_identity,
        "engine status identity mismatch"
    );
    Ok(())
}

pub(crate) async fn probe_ready(endpoint: &AzraelDaemonEndpoint, pid: u32) -> Result<()> {
    tokio::time::timeout(STATUS_TIMEOUT, async {
        let stream = connect_private_stream(&endpoint.socket_path).await?;
        probe_ready_stream(stream, endpoint, pid).await
    })
    .await
    .context("engine readiness probe timed out")?
}

async fn probe_ready_stream<S>(stream: S, endpoint: &AzraelDaemonEndpoint, pid: u32) -> Result<()>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let config = WebSocketConfig::default()
        .max_frame_size(Some(16 << 10))
        .max_message_size(Some(16 << 10));
    let (mut socket, _) =
        tokio_tungstenite::client_async_with_config("ws://localhost/rpc", stream, Some(config))
            .await?;
    socket
        .send(Message::Text(
            json!({"id":STATUS_ID,"method":"azrael/engine/status"})
                .to_string()
                .into(),
        ))
        .await?;
    loop {
        match socket.next().await {
            Some(Ok(Message::Text(text))) => {
                return verify_status(&serde_json::from_str(&text)?, endpoint, pid);
            }
            Some(Ok(Message::Ping(bytes))) => socket.send(Message::Pong(bytes)).await?,
            Some(Err(error)) => return Err(error.into()),
            _ => anyhow::bail!("engine closed during readiness probe"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn endpoint() -> AzraelDaemonEndpoint {
        AzraelDaemonEndpoint {
            schema: 2,
            instance_id: "a".repeat(64),
            socket_path: PathBuf::from("unused"),
            engine_version: "test".into(),
            engine_identity: "b".repeat(64),
        }
    }

    fn status(endpoint: &AzraelDaemonEndpoint) -> Value {
        json!({"id":STATUS_ID,"result":{"schema":1,"state":"ready","enginePid":42,"instanceId":endpoint.instance_id,"engineVersion":endpoint.engine_version,"engineIdentity":endpoint.engine_identity}})
    }

    #[test]
    fn recovery_requires_stopping_receipt_and_never_reaps_ready_or_unknown_engine() {
        assert_eq!(
            recovery_action(true, false, Duration::ZERO),
            RecoveryAction::Ready
        );
        assert_eq!(
            recovery_action(true, true, Duration::from_secs(60)),
            RecoveryAction::Wait
        );
        assert_eq!(
            recovery_action(false, false, Duration::from_secs(60)),
            RecoveryAction::Wait
        );
        assert_eq!(
            recovery_action(false, true, Duration::from_secs(34)),
            RecoveryAction::Wait
        );
        assert_eq!(
            recovery_action(false, true, Duration::from_secs(35)),
            RecoveryAction::Recover
        );
    }

    #[tokio::test]
    async fn shutdown_receipt_binds_instance_and_native_process_lifetime() {
        let directory = tempfile::tempdir().unwrap();
        let endpoint = endpoint();
        let pid_path = directory.path().join("engine.pid");
        let backend = PidBackend::new(PathBuf::from("unused"), pid_path.clone(), false);
        let identity = PidBackend::current_shutdown_identity().await.unwrap();
        tokio::fs::write(&pid_path, serde_json::to_vec(&identity).unwrap())
            .await
            .unwrap();
        assert!(
            matching_shutdown(directory.path(), &endpoint, &backend)
                .await
                .unwrap()
                .is_none()
        );
        publish_azrael_shutdown(directory.path(), &endpoint.instance_id)
            .await
            .unwrap();
        assert!(
            matching_shutdown(directory.path(), &endpoint, &backend)
                .await
                .unwrap()
                .is_some()
        );
        let path = shutdown_path(directory.path(), &endpoint.instance_id).unwrap();
        let mut receipt: Value =
            serde_json::from_slice(&tokio::fs::read(&path).await.unwrap()).unwrap();
        receipt["instanceId"] = json!("c".repeat(64));
        tokio::fs::write(&path, serde_json::to_vec(&receipt).unwrap())
            .await
            .unwrap();
        assert!(
            matching_shutdown(directory.path(), &endpoint, &backend)
                .await
                .unwrap()
                .is_none()
        );
        receipt["instanceId"] = json!(endpoint.instance_id);
        receipt["process"]["pid"] = json!(std::process::id().saturating_add(1));
        tokio::fs::write(&path, serde_json::to_vec(&receipt).unwrap())
            .await
            .unwrap();
        assert!(
            matching_shutdown(directory.path(), &endpoint, &backend)
                .await
                .unwrap()
                .is_none()
        );
        tokio::fs::write(&path, b"corrupt").await.unwrap();
        assert!(
            matching_shutdown(directory.path(), &endpoint, &backend)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn readiness_requires_every_identity_field_and_ready_state() {
        let endpoint = endpoint();
        let reply = status(&endpoint);
        assert!(verify_status(&reply, &endpoint, 42).is_ok());
        for (field, wrong) in [
            ("schema", json!(2)),
            ("state", json!("stopping")),
            ("enginePid", json!(43)),
            ("instanceId", json!("other")),
            ("engineVersion", json!("other")),
            ("engineIdentity", json!("other")),
        ] {
            let mut changed = reply.clone();
            changed["result"][field] = wrong;
            assert!(
                verify_status(&changed, &endpoint, 42).is_err(),
                "accepted {field}"
            );
        }
        let mut changed = reply.clone();
        changed["id"] = json!("other");
        assert!(verify_status(&changed, &endpoint, 42).is_err());
        changed = reply;
        changed["error"] = json!({"code":-32600});
        assert!(verify_status(&changed, &endpoint, 42).is_err());
    }

    #[tokio::test]
    async fn status_websocket_sends_only_read_only_request_and_handles_ping() {
        let (client, server) = tokio::io::duplex(4096);
        let endpoint = endpoint();
        let reply = status(&endpoint);
        let server_task = tokio::spawn(async move {
            let mut socket = tokio_tungstenite::accept_async(server).await.unwrap();
            let request = socket.next().await.unwrap().unwrap();
            let request: Value = serde_json::from_str(request.to_text().unwrap()).unwrap();
            assert_eq!(
                request,
                json!({"id":STATUS_ID,"method":"azrael/engine/status"})
            );
            socket.send(Message::Ping(vec![1].into())).await.unwrap();
            assert!(matches!(
                socket.next().await.unwrap().unwrap(),
                Message::Pong(_)
            ));
            socket
                .send(Message::Text(reply.to_string().into()))
                .await
                .unwrap();
        });
        probe_ready_stream(client, &endpoint, 42).await.unwrap();
        server_task.await.unwrap();
    }
}

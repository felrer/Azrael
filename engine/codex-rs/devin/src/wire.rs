use super::IO_TIMEOUT;
use super::Pending;
use super::ServerMessage;
use super::ServerNotification;
use super::ServerRequest;
use anyhow::Context;
use anyhow::Result;
use anyhow::anyhow;
use serde_json::Value;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use tokio::io::AsyncBufRead;
use tokio::io::AsyncBufReadExt;
use tokio::io::AsyncRead;
use tokio::io::BufReader;
use tokio::sync::mpsc;
use tokio::time::timeout;

pub(super) const MAX_MESSAGE_SIZE: usize = 1024 * 1024;

pub(super) async fn reader_loop<R>(
    reader: R,
    server_tx: mpsc::Sender<ServerMessage>,
    pending: Pending,
    failed: Arc<AtomicBool>,
) where
    R: AsyncRead + Unpin,
{
    let mut reader = BufReader::new(reader);
    loop {
        let line = match read_line_bounded(&mut reader).await {
            Ok(Some(line)) => line,
            Ok(None) => {
                failed.store(true, Ordering::Release);
                fail_pending(&pending, "Devin ACP process exited");
                return;
            }
            Err(error) => {
                failed.store(true, Ordering::Release);
                fail_pending(&pending, &error.to_string());
                return;
            }
        };
        let value: Value = match serde_json::from_slice(&line) {
            Ok(value) => value,
            Err(error) => {
                failed.store(true, Ordering::Release);
                fail_pending(&pending, &format!("malformed Devin ACP JSON: {error}"));
                return;
            }
        };
        if let Err(error) = dispatch_message(value, &server_tx, &pending).await {
            failed.store(true, Ordering::Release);
            fail_pending(&pending, &error.to_string());
            return;
        }
    }
}

async fn dispatch_message(
    value: Value,
    server_tx: &mpsc::Sender<ServerMessage>,
    pending: &Pending,
) -> Result<()> {
    let object = value
        .as_object()
        .context("Devin ACP message was not an object")?;
    if object.get("jsonrpc") != Some(&Value::String("2.0".to_owned())) {
        return Err(anyhow!("Devin ACP message has an invalid JSON-RPC version"));
    }

    if let Some(method) = object.get("method") {
        let method = method
            .as_str()
            .context("Devin ACP method was not a string")?
            .to_owned();
        let params = object.get("params").cloned().unwrap_or(Value::Null);
        let message = match object.get("id") {
            Some(id) => ServerMessage::Request(ServerRequest {
                id: id.clone(),
                method,
                params,
            }),
            None => ServerMessage::Notification(ServerNotification { method, params }),
        };
        timeout(IO_TIMEOUT, server_tx.send(message))
            .await
            .context("timed out forwarding Devin ACP server message")?
            .context("Devin ACP server-message receiver closed")?;
        return Ok(());
    }

    let id = object.get("id").context("Devin ACP response has no id")?;
    let key = id_key(id)?;
    let response = match (object.get("result"), object.get("error")) {
        (Some(result), None) => Ok(result.clone()),
        (None, Some(error)) => Err(format!("Devin ACP request failed: {error}")),
        _ => return Err(anyhow!("malformed Devin ACP response")),
    };
    if let Some(sender) = pending
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .remove(&key)
    {
        let _ = sender.send(response);
    }
    Ok(())
}

async fn read_line_bounded<R>(reader: &mut R) -> Result<Option<Vec<u8>>>
where
    R: AsyncBufRead + Unpin,
{
    let mut line = Vec::new();
    loop {
        let available = reader.fill_buf().await.context("Devin ACP read failed")?;
        if available.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Err(anyhow!("Devin ACP message ended without a newline"))
            };
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(available.len(), |index| index);
        if line.len().saturating_add(take) > MAX_MESSAGE_SIZE {
            return Err(anyhow!(
                "Devin ACP message exceeded {MAX_MESSAGE_SIZE} bytes"
            ));
        }
        line.extend_from_slice(&available[..take]);
        reader.consume(take + usize::from(newline.is_some()));
        if newline.is_some() {
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            return Ok(Some(line));
        }
    }
}

pub(super) fn encode_message(value: &Value) -> Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec(value).context("failed to encode Devin ACP message")?;
    if bytes.len() > MAX_MESSAGE_SIZE {
        return Err(anyhow!(
            "Devin ACP message exceeded {MAX_MESSAGE_SIZE} bytes"
        ));
    }
    bytes.push(b'\n');
    Ok(bytes)
}

pub(super) fn id_key(id: &Value) -> Result<String> {
    match id {
        Value::String(_) | Value::Number(_) | Value::Null => {
            serde_json::to_string(id).context("failed to encode Devin ACP response id")
        }
        Value::Bool(_) | Value::Array(_) | Value::Object(_) => {
            Err(anyhow!("Devin ACP message has an invalid id"))
        }
    }
}

pub(super) fn fail_pending(pending: &Pending, message: &str) {
    for (_, sender) in pending
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .drain()
    {
        let _ = sender.send(Err(message.to_owned()));
    }
}

use anyhow::Context;
use anyhow::Result;
use anyhow::anyhow;
use serde_json::Value;
use serde_json::json;
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio::io::AsyncRead;
use tokio::io::AsyncWrite;
use tokio::io::AsyncWriteExt;
use tokio::process::Child;
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tokio::time::timeout;

const CHANNEL_CAPACITY: usize = 64;
const IO_TIMEOUT: Duration = Duration::from_secs(5);
const CONTROL_TIMEOUT: Duration = Duration::from_secs(15);
const AUTHENTICATE_TIMEOUT: Duration = Duration::from_secs(180);

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>>;

mod wire;
#[cfg(test)]
use wire::MAX_MESSAGE_SIZE;
use wire::encode_message;
use wire::fail_pending;
use wire::id_key;
use wire::reader_loop;

#[derive(Clone, Debug, PartialEq)]
pub struct ServerRequest {
    pub id: Value,
    pub method: String,
    pub params: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ServerNotification {
    pub method: String,
    pub params: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ServerMessage {
    Request(ServerRequest),
    Notification(ServerNotification),
}

enum WriterMessage {
    Json(Vec<u8>),
    Shutdown(oneshot::Sender<()>),
}

struct Inner {
    writer: mpsc::Sender<WriterMessage>,
    pending: Pending,
    child: Mutex<Option<Child>>,
    next_id: AtomicU64,
    closed: AtomicBool,
    failed: Arc<AtomicBool>,
}

#[derive(Clone)]
pub struct AcpClient {
    inner: Arc<Inner>,
}

impl AcpClient {
    pub fn spawn(
        executable: &Path,
        model: &str,
    ) -> Result<(AcpClient, mpsc::Receiver<ServerMessage>)> {
        let mut command = Command::new(executable);
        command
            .arg("acp")
            .arg("--model")
            .arg(model)
            .env_remove("WINDSURF_API_KEY")
            .env_remove("DEVIN_MODEL")
            .env_remove("DEVIN_REFUSAL_FALLBACK")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.as_std_mut().creation_flags(0x0800_0000);
        }

        let mut child = command
            .spawn()
            .with_context(|| format!("failed to start Devin ACP at {}", executable.display()))?;
        let stdin = child
            .stdin
            .take()
            .context("Devin ACP stdin was not piped")?;
        let stdout = child
            .stdout
            .take()
            .context("Devin ACP stdout was not piped")?;
        let stderr = child
            .stderr
            .take()
            .context("Devin ACP stderr was not piped")?;

        tokio::spawn(async move {
            let mut stderr = stderr;
            let mut sink = tokio::io::sink();
            let _ = tokio::io::copy(&mut stderr, &mut sink).await;
        });

        Ok(Self::start_transport(stdout, stdin, Some(child)))
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value> {
        let response_timeout = match method {
            "session/prompt" => None,
            "authenticate" => Some(AUTHENTICATE_TIMEOUT),
            _ => Some(CONTROL_TIMEOUT),
        };
        self.request_inner(method, params, response_timeout).await
    }

    pub async fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        response_timeout: Duration,
    ) -> Result<Value> {
        self.request_inner(method, params, Some(response_timeout))
            .await
    }

    async fn request_inner(
        &self,
        method: &str,
        params: Value,
        response_timeout: Option<Duration>,
    ) -> Result<Value> {
        self.ensure_open()?;
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let id_value = Value::from(id);
        let key = id_key(&id_value)?;
        let (response_tx, response_rx) = oneshot::channel();
        self.inner
            .pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(key.clone(), response_tx);
        let guard = PendingGuard {
            key,
            pending: Arc::clone(&self.inner.pending),
            active: true,
        };

        self.send_json(json!({
            "jsonrpc": "2.0",
            "id": id_value,
            "method": method,
            "params": params,
        }))
        .await?;

        let response = if let Some(response_timeout) = response_timeout {
            timeout(response_timeout, response_rx)
                .await
                .with_context(|| format!("Devin ACP request {method} timed out"))?
                .context("Devin ACP response channel closed")?
        } else {
            response_rx
                .await
                .context("Devin ACP response channel closed")?
        };
        guard.complete();
        response.map_err(|message| anyhow!(message))
    }

    pub async fn notify(&self, method: &str, params: Value) -> Result<()> {
        self.send_json(json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }))
        .await
    }

    pub async fn respond(&self, id: Value, result: Value) -> Result<()> {
        self.send_json(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result,
        }))
        .await
    }

    pub async fn initialize(&self) -> Result<Value> {
        let result = self
            .request(
                "initialize",
                json!({
                    "protocolVersion": 1,
                    "clientCapabilities": {
                        "fs": {
                            "readTextFile": false,
                            "writeTextFile": false
                        },
                        "terminal": false
                    },
                    "clientInfo": {
                        "name": "codex",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                }),
            )
            .await?;
        if result.get("protocolVersion") != Some(&Value::from(1)) {
            return Err(anyhow!("Devin ACP did not negotiate protocol version 1"));
        }
        Ok(result)
    }

    /// Closes stdio and terminates and reaps the managed child within bounded waits.
    pub async fn close(&self) -> Result<()> {
        if self.inner.closed.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        fail_pending(&self.inner.pending, "Devin ACP client closed");

        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        if matches!(
            timeout(
                IO_TIMEOUT,
                self.inner.writer.send(WriterMessage::Shutdown(shutdown_tx))
            )
            .await,
            Ok(Ok(()))
        ) {
            let _ = timeout(IO_TIMEOUT, shutdown_rx).await;
        }

        let mut child = self
            .inner
            .child
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        if let Some(child) = child.as_mut() {
            match timeout(IO_TIMEOUT, child.wait()).await {
                Ok(result) => {
                    result.context("failed to reap Devin ACP process")?;
                }
                Err(_) => {
                    child
                        .kill()
                        .await
                        .context("failed to terminate Devin ACP process")?;
                    timeout(IO_TIMEOUT, child.wait())
                        .await
                        .context("timed out reaping Devin ACP process")??;
                }
            }
        }
        Ok(())
    }

    async fn send_json(&self, value: Value) -> Result<()> {
        self.ensure_open()?;
        let bytes = encode_message(&value)?;
        timeout(
            IO_TIMEOUT,
            self.inner.writer.send(WriterMessage::Json(bytes)),
        )
        .await
        .context("timed out queueing Devin ACP message")?
        .context("Devin ACP writer stopped")
    }

    fn ensure_open(&self) -> Result<()> {
        if self.inner.closed.load(Ordering::Acquire) {
            Err(anyhow!("Devin ACP client is closed"))
        } else if self.inner.failed.load(Ordering::Acquire) {
            Err(anyhow!("Devin ACP transport has stopped"))
        } else {
            Ok(())
        }
    }

    fn start_transport<R, W>(
        reader: R,
        writer: W,
        child: Option<Child>,
    ) -> (AcpClient, mpsc::Receiver<ServerMessage>)
    where
        R: AsyncRead + Unpin + Send + 'static,
        W: AsyncWrite + Unpin + Send + 'static,
    {
        let (writer_tx, writer_rx) = mpsc::channel(CHANNEL_CAPACITY);
        let (server_tx, server_rx) = mpsc::channel(CHANNEL_CAPACITY);
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let failed = Arc::new(AtomicBool::new(false));
        tokio::spawn(writer_loop(
            writer,
            writer_rx,
            Arc::clone(&pending),
            Arc::clone(&failed),
        ));
        tokio::spawn(reader_loop(
            reader,
            server_tx,
            Arc::clone(&pending),
            Arc::clone(&failed),
        ));
        let client = AcpClient {
            inner: Arc::new(Inner {
                writer: writer_tx,
                pending,
                child: Mutex::new(child),
                next_id: AtomicU64::new(1),
                closed: AtomicBool::new(false),
                failed,
            }),
        };
        (client, server_rx)
    }
}

struct PendingGuard {
    key: String,
    pending: Pending,
    active: bool,
}

impl PendingGuard {
    fn complete(mut self) {
        self.active = false;
    }
}

impl Drop for PendingGuard {
    fn drop(&mut self) {
        if self.active {
            self.pending
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .remove(&self.key);
        }
    }
}

async fn writer_loop<W>(
    mut writer: W,
    mut messages: mpsc::Receiver<WriterMessage>,
    pending: Pending,
    failed: Arc<AtomicBool>,
) where
    W: AsyncWrite + Unpin,
{
    while let Some(message) = messages.recv().await {
        match message {
            WriterMessage::Json(bytes) => {
                match timeout(IO_TIMEOUT, writer.write_all(&bytes)).await {
                    Ok(Ok(())) => {}
                    Ok(Err(error)) => {
                        failed.store(true, Ordering::Release);
                        fail_pending(&pending, &format!("Devin ACP write failed: {error}"));
                        return;
                    }
                    Err(_) => {
                        failed.store(true, Ordering::Release);
                        fail_pending(&pending, "Devin ACP write timed out");
                        return;
                    }
                }
            }
            WriterMessage::Shutdown(done) => {
                let _ = writer.shutdown().await;
                let _ = done.send(());
                return;
            }
        }
    }
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;

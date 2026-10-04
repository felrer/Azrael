use anyhow::Context;
use anyhow::Result;
use anyhow::bail;
use codex_devin::AcpClient;
use serde::Serialize;
use serde_json::json;
use std::fs::File;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

static LOGIN: OnceLock<Mutex<Option<CancellationToken>>> = OnceLock::new();

/// Redacted, provider-owned login state for the companion.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevinAccountStatus {
    pub enabled: bool,
    pub logged_in: bool,
    pub email: Option<String>,
    pub plan: Option<String>,
}

pub(crate) struct DevinTurnGuard {
    _file: File,
}

fn account_lock() -> Result<File> {
    let root = if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
            })
    }
    .context("Cannot locate the current user's Devin account lock directory")?;
    let root = root.join("azrael-ex");
    std::fs::create_dir_all(&root)?;
    Ok(File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join("devin-account.lock"))?)
}

pub(crate) fn turn_guard() -> codex_protocol::error::Result<DevinTurnGuard> {
    let file = account_lock()
        .map_err(|err| codex_protocol::error::CodexErr::InvalidRequest(err.to_string()))?;
    file.try_lock_shared().map_err(|_| {
        codex_protocol::error::CodexErr::InvalidRequest(
            "A Devin account operation is in progress; retry after it finishes".to_string(),
        )
    })?;
    Ok(DevinTurnGuard { _file: file })
}

async fn auth_command(action: &str) -> Result<String> {
    let executable =
        super::catalog::executable().context("Devin is not enabled for this engine")?;
    let mut command = Command::new(executable);
    command
        .args(["auth", action])
        .env_remove("WINDSURF_API_KEY")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut child = command.spawn()?;
    let stdout = child
        .stdout
        .take()
        .context("Devin authentication stdout unavailable")?;
    let output = tokio::time::timeout(Duration::from_secs(20), async {
        let mut bytes = Vec::new();
        stdout.take(65537).read_to_end(&mut bytes).await?;
        if bytes.len() > 65536 {
            bail!("Devin authentication output exceeded the limit");
        }
        if !child.wait().await?.success() && action != "status" {
            bail!("Devin authentication command failed");
        }
        Ok::<_, anyhow::Error>(bytes)
    })
    .await
    .context("Devin authentication command timed out")??;
    Ok(String::from_utf8(output)?)
}

fn parse_status(text: &str) -> Result<DevinAccountStatus> {
    let logged_in = text
        .lines()
        .any(|line| line.trim() == "Logged in (via Devin).");
    if !logged_in && !text.lines().any(|line| line.trim() == "Not logged in.") {
        bail!("Unrecognized Devin authentication status; update the CLI integration");
    }
    let field = |prefix: &str| {
        text.lines().find_map(|line| {
            line.trim()
                .strip_prefix(prefix)
                .map(|value| value.trim().to_string())
        })
    };
    Ok(DevinAccountStatus {
        enabled: true,
        logged_in,
        email: logged_in.then(|| field("Email:")).flatten(),
        plan: logged_in.then(|| field("Plan:")).flatten(),
    })
}

/// Runs a Devin-only account action. Active Devin turns exclude login/logout
/// across azrael engine processes; OpenAI authentication is never accessed.
pub async fn manage_devin_account(action: &str) -> Result<DevinAccountStatus> {
    if super::catalog::executable().is_none() {
        if action != "status" {
            bail!("Devin is not enabled for this engine");
        }
        return Ok(DevinAccountStatus {
            enabled: false,
            logged_in: false,
            email: None,
            plan: None,
        });
    }
    match action {
        "status" | "refresh" => {}
        "loginCancel" => {
            if let Some(cancel) = LOGIN
                .get_or_init(Mutex::default)
                .lock()
                .map_err(|_| anyhow::anyhow!("Devin login state unavailable"))?
                .as_ref()
            {
                cancel.cancel();
            }
        }
        "login" | "logout" => {
            let guard = account_lock()?;
            guard.try_lock().context(
                "Devin has active turns or another account operation; try again after it finishes",
            )?;
            if action == "logout" {
                auth_command("logout").await?;
            } else {
                let cancel = CancellationToken::new();
                let executable =
                    super::catalog::executable().context("Devin executable is unavailable")?;
                let (client, mut messages) = AcpClient::spawn(&executable, "swe-2-medium")?;
                *LOGIN
                    .get_or_init(Mutex::default)
                    .lock()
                    .map_err(|_| anyhow::anyhow!("Devin login state unavailable"))? =
                    Some(cancel.clone());
                let drain = tokio::spawn(async move { while messages.recv().await.is_some() {} });
                let outcome = tokio::select! {
                    _ = cancel.cancelled() => Err(anyhow::anyhow!("Devin login canceled")),
                    result = async {
                        client.initialize().await?;
                        client.request("authenticate", json!({"methodId":"devin-browser"})).await?;
                        Ok::<_, anyhow::Error>(())
                    } => result,
                };
                let closed = client.close().await;
                drain.abort();
                *LOGIN
                    .get_or_init(Mutex::default)
                    .lock()
                    .map_err(|_| anyhow::anyhow!("Devin login state unavailable"))? = None;
                outcome?;
                closed?;
            }
        }
        _ => bail!("Unknown Devin account action"),
    }
    parse_status(&auth_command("status").await?)
}

#[cfg(test)]
#[path = "account_tests.rs"]
mod tests;

use codex_protocol::error::CodexErr;
use codex_protocol::error::CodexErrorDetails;
use codex_protocol::error::Result as CodexResult;
use serde::Deserialize;
use serde::Serialize;
use sha1::Digest;
use sha1::Sha1;
use std::io::ErrorKind;
use std::path::Path;
use std::path::PathBuf;

const MAX_CREDENTIAL_BYTES: u64 = 64 * 1024;

#[derive(Serialize)]
pub(super) struct Credential {
    pub(super) api_key: String,
    pub(super) api_server_url: String,
}

impl Credential {
    pub(super) fn scope_fingerprint(&self) -> String {
        let mut hasher = Sha1::new();
        hasher.update(self.api_key.as_bytes());
        hasher.update(b"\x1f");
        hasher.update(self.api_server_url.as_bytes());
        format!("sha1:{:x}", hasher.finalize())
    }
}

#[derive(Clone)]
pub(super) struct RuntimeBinding<'a> {
    pub(super) model_id: &'a str,
    pub(super) cwd: &'a Path,
    pub(super) credential_scope: &'a str,
    pub(super) account_id: Option<&'a str>,
}

#[derive(Debug, Eq, PartialEq)]
pub(super) enum ExistingAccountBinding {
    NoMarker,
    Cli,
    Managed(String),
}

#[derive(Deserialize, Serialize)]
struct RuntimeMarker {
    version: u8,
    thread_id: String,
    runtime: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cwd: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    credential_scope: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    account_id: Option<String>,
}

pub(super) fn existing_account_binding(
    codex_home: &Path,
    thread_id: &str,
) -> CodexResult<ExistingAccountBinding> {
    let Some(marker) = read_runtime_marker(&runtime_marker_path(codex_home, thread_id))? else {
        return Ok(ExistingAccountBinding::NoMarker);
    };
    if marker.version != 2 || marker.thread_id != thread_id {
        return Err(fatal("Devin runtime marker does not match this thread"));
    }
    if marker.runtime != "native" {
        return Err(invalid(format!(
            "this Devin thread is pinned to the {} runtime",
            marker.runtime
        )));
    }
    Ok(match marker.account_id {
        Some(account_id) if !account_id.trim().is_empty() => {
            ExistingAccountBinding::Managed(account_id)
        }
        Some(_) => return Err(fatal("Devin runtime marker has an invalid account binding")),
        None => ExistingAccountBinding::Cli,
    })
}

pub(super) fn ensure_native_history(codex_home: &Path, thread_id: &str) -> CodexResult<()> {
    let marker = read_runtime_marker(&runtime_marker_path(codex_home, thread_id))?;
    if marker
        .as_ref()
        .is_some_and(|marker| marker.runtime != "native")
        || (marker.is_none() && acp_sidecar_path(codex_home, thread_id).exists())
    {
        return Err(invalid(
            "legacy Devin ACP history cannot switch to native inference; start a new thread",
        ));
    }
    Ok(())
}

pub(super) fn validate_ancestor_binding(
    codex_home: &Path,
    thread_id: &str,
    binding: RuntimeBinding<'_>,
) -> CodexResult<()> {
    if let Some(marker) = read_runtime_marker(&runtime_marker_path(codex_home, thread_id))? {
        validate_runtime_marker(marker, thread_id, "native", Some(binding))?;
    }
    Ok(())
}

pub(super) fn read_credential() -> CodexResult<Credential> {
    let path = credential_path()?;
    let metadata = std::fs::metadata(&path)
        .map_err(|_| invalid("Devin CLI credentials are missing or unreadable"))?;
    if metadata.len() > MAX_CREDENTIAL_BYTES {
        return Err(invalid("Devin CLI credentials are invalid"));
    }
    let text = std::fs::read_to_string(path)
        .map_err(|_| invalid("Devin CLI credentials are missing or unreadable"))?;
    if text.len() as u64 > MAX_CREDENTIAL_BYTES {
        return Err(invalid("Devin CLI credentials are invalid"));
    }
    let value: toml::Value =
        toml::from_str(&text).map_err(|_| invalid("Devin CLI credentials are invalid"))?;
    let api_key = credential_field(&value, "windsurf_api_key")?;
    let api_server_url = credential_field(&value, "api_server_url")?;
    tracing::info!(
        event = "devin_native_credential_loaded",
        credential_present = true
    );
    Ok(Credential {
        api_key,
        api_server_url,
    })
}

pub(super) fn pin_acp_runtime(codex_home: &Path, thread_id: &str) -> CodexResult<()> {
    pin_runtime(codex_home, thread_id, "acp", None)
}

pub(super) fn pin_native_runtime(
    codex_home: &Path,
    thread_id: &str,
    binding: RuntimeBinding<'_>,
) -> CodexResult<()> {
    pin_runtime(codex_home, thread_id, "native", Some(binding))
}

fn pin_runtime(
    codex_home: &Path,
    thread_id: &str,
    runtime: &str,
    binding: Option<RuntimeBinding<'_>>,
) -> CodexResult<()> {
    let path = runtime_marker_path(codex_home, thread_id);
    if let Some(marker) = read_runtime_marker(&path)? {
        return validate_runtime_marker(marker, thread_id, runtime, binding);
    }
    if runtime == "native" && acp_sidecar_path(codex_home, thread_id).exists() {
        return Err(invalid("this Devin thread is pinned to the ACP runtime"));
    }
    let marker = RuntimeMarker {
        version: 2,
        thread_id: thread_id.to_string(),
        runtime: runtime.to_string(),
        model_id: binding.as_ref().map(|binding| binding.model_id.to_string()),
        cwd: binding.as_ref().map(|binding| binding.cwd.to_path_buf()),
        credential_scope: binding
            .as_ref()
            .map(|binding| binding.credential_scope.to_string()),
        account_id: binding
            .as_ref()
            .and_then(|binding| binding.account_id.map(str::to_string)),
    };
    let parent = path
        .parent()
        .ok_or_else(|| fatal("invalid Devin runtime marker path"))?;
    std::fs::create_dir_all(parent)
        .map_err(|_| fatal("unable to create Devin runtime marker directory"))?;
    let temp = parent.join(format!(".{thread_id}.{}.tmp", uuid::Uuid::new_v4()));
    let bytes = serde_json::to_vec(&marker)
        .map_err(|_| fatal("unable to serialize Devin runtime marker"))?;
    std::fs::write(&temp, bytes).map_err(|_| fatal("unable to write Devin runtime marker"))?;
    match std::fs::hard_link(&temp, &path) {
        Ok(()) => {
            let _ = std::fs::remove_file(&temp);
            Ok(())
        }
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {
            let _ = std::fs::remove_file(&temp);
            let marker = read_runtime_marker(&path)?
                .ok_or_else(|| fatal("Devin runtime marker disappeared"))?;
            validate_runtime_marker(marker, thread_id, runtime, binding)
        }
        Err(_) => {
            let _ = std::fs::remove_file(&temp);
            Err(fatal("unable to commit Devin runtime marker"))
        }
    }
}

fn validate_runtime_marker(
    marker: RuntimeMarker,
    thread_id: &str,
    runtime: &str,
    binding: Option<RuntimeBinding<'_>>,
) -> CodexResult<()> {
    let supported_version = if runtime == "native" {
        marker.version == 2
    } else {
        matches!(marker.version, 1 | 2)
    };
    if !supported_version || marker.thread_id != thread_id {
        return Err(fatal("Devin runtime marker does not match this thread"));
    }
    if marker.runtime != runtime {
        return Err(invalid(format!(
            "this Devin thread is pinned to the {} runtime",
            marker.runtime
        )));
    }
    if let Some(binding) = binding
        && (marker.cwd.as_deref() != Some(binding.cwd)
            || marker.credential_scope.as_deref() != Some(binding.credential_scope)
            || marker.account_id.as_deref() != binding.account_id)
    {
        return Err(invalid(
            "this native Devin thread is pinned to a different cwd or account",
        ));
    }
    Ok(())
}

fn runtime_marker_path(codex_home: &Path, thread_id: &str) -> PathBuf {
    codex_home
        .join("azrael/devin/sessions")
        .join(format!("{thread_id}.runtime.json"))
}

fn acp_sidecar_path(codex_home: &Path, thread_id: &str) -> PathBuf {
    codex_home
        .join("azrael/devin/sessions")
        .join(format!("{thread_id}.json"))
}

fn read_runtime_marker(path: &Path) -> CodexResult<Option<RuntimeMarker>> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| fatal("Devin runtime marker is invalid")),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(_) => Err(fatal("Devin runtime marker is unreadable")),
    }
}

fn credential_path() -> CodexResult<PathBuf> {
    #[cfg(windows)]
    {
        let root = std::env::var_os("APPDATA")
            .filter(|value| !value.is_empty())
            .ok_or_else(|| invalid("APPDATA is unavailable for Devin credentials"))?;
        Ok(PathBuf::from(root).join("devin/credentials.toml"))
    }
    #[cfg(not(windows))]
    {
        let root = std::env::var_os("XDG_DATA_HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
            })
            .ok_or_else(|| invalid("home directory is unavailable for Devin credentials"))?;
        Ok(root.join("devin/credentials.toml"))
    }
}

fn credential_field(value: &toml::Value, key: &str) -> CodexResult<String> {
    value
        .get(key)
        .and_then(toml::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| invalid("Devin CLI credentials are incomplete"))
}

fn invalid(message: impl Into<String>) -> CodexErr {
    CodexErr::new(CodexErrorDetails::InvalidRequest(message.into()))
}

fn fatal(message: impl Into<String>) -> CodexErr {
    CodexErr::new(CodexErrorDetails::Fatal(message.into()))
}

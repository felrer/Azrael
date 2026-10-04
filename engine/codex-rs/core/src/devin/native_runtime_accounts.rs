use super::state::Credential;
use super::state::ExistingAccountBinding;
use codex_protocol::error::CodexErr;
use codex_protocol::error::CodexErrorDetails;
use codex_protocol::error::Result as CodexResult;
use serde::Deserialize;
use serde::Serialize;
use std::path::Path;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

const HELPER_ENV: &str = "AZRAEL_PROVIDER_ACCOUNTS_HELPER";
const BUN_ENV: &str = "AZRAEL_PROVIDER_BUN";
const PROTOCOL_VERSION: u8 = 1;
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const HELPER_TIMEOUT: Duration = Duration::from_secs(20);

pub(super) struct ResolvedCredential {
    pub(super) credential: Credential,
    pub(super) account_id: Option<String>,
    pub(super) _turn_guard: Option<super::super::account::DevinTurnGuard>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CredentialRequest<'a> {
    protocol: u8,
    id: &'a str,
    action: &'static str,
    provider_id: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    account_id: Option<&'a str>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum CredentialResponse {
    Result {
        id: String,
        value: Option<ManagedCredential>,
    },
    Error {
        id: String,
        #[serde(rename = "error")]
        _error: serde_json::Value,
    },
}

#[derive(Deserialize)]
pub(super) struct ManagedCredential {
    api_key: String,
    api_server_url: String,
    pub(super) account_id: String,
}

pub(super) async fn resolve(
    codex_home: &Path,
    binding: ExistingAccountBinding,
) -> CodexResult<ResolvedCredential> {
    match binding {
        ExistingAccountBinding::Cli => cli_credential(),
        ExistingAccountBinding::Managed(account_id) => {
            let config = helper_config()?.ok_or_else(|| {
                invalid("managed Devin account helper is required for this thread")
            })?;
            let credential = request_credential(codex_home, &config, Some(&account_id)).await?;
            let credential = credential.ok_or_else(|| {
                invalid("the managed Devin account for this thread is unavailable")
            })?;
            if credential.account_id != account_id {
                return Err(invalid(
                    "provider account helper returned a different Devin account",
                ));
            }
            Ok(managed_credential(credential))
        }
        ExistingAccountBinding::NoMarker => {
            let Some(config) = helper_config()? else {
                return cli_credential();
            };
            match request_credential(codex_home, &config, None).await? {
                Some(credential) => Ok(managed_credential(credential)),
                None => cli_credential(),
            }
        }
    }
}

fn cli_credential() -> CodexResult<ResolvedCredential> {
    let turn_guard = super::super::account::turn_guard()?;
    Ok(ResolvedCredential {
        credential: super::state::read_credential()?,
        account_id: None,
        _turn_guard: Some(turn_guard),
    })
}

fn managed_credential(credential: ManagedCredential) -> ResolvedCredential {
    ResolvedCredential {
        credential: Credential {
            api_key: credential.api_key,
            api_server_url: credential.api_server_url,
        },
        account_id: Some(credential.account_id),
        _turn_guard: None,
    }
}

pub(super) struct HelperConfig {
    pub(super) helper: PathBuf,
    pub(super) bun: PathBuf,
}

fn helper_config() -> CodexResult<Option<HelperConfig>> {
    let helper = std::env::var_os(HELPER_ENV).filter(|value| !value.is_empty());
    let bun = std::env::var_os(BUN_ENV).filter(|value| !value.is_empty());
    match (helper, bun) {
        (None, None) => Ok(None),
        (Some(helper), Some(bun)) => Ok(Some(HelperConfig {
            helper: absolute_path(HELPER_ENV, helper)?,
            bun: absolute_path(BUN_ENV, bun)?,
        })),
        _ => Err(invalid(format!(
            "{HELPER_ENV} and {BUN_ENV} must be configured together"
        ))),
    }
}

fn absolute_path(name: &str, value: std::ffi::OsString) -> CodexResult<PathBuf> {
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(invalid(format!("{name} must be an absolute path")));
    }
    Ok(path)
}

async fn request_credential(
    codex_home: &Path,
    config: &HelperConfig,
    account_id: Option<&str>,
) -> CodexResult<Option<ManagedCredential>> {
    let request_id = uuid::Uuid::new_v4().to_string();
    request_credential_with(codex_home, config, account_id, &request_id, HELPER_TIMEOUT).await
}

pub(super) async fn request_credential_with(
    codex_home: &Path,
    config: &HelperConfig,
    account_id: Option<&str>,
    request_id: &str,
    timeout: Duration,
) -> CodexResult<Option<ManagedCredential>> {
    let mut request = serde_json::to_vec(&CredentialRequest {
        protocol: PROTOCOL_VERSION,
        id: request_id,
        action: "credential",
        provider_id: "devin",
        account_id,
    })
    .map_err(|_| fatal("unable to serialize provider account request"))?;
    request.push(b'\n');
    if request.len() > MAX_RESPONSE_BYTES {
        return Err(invalid("provider account request exceeded the hard limit"));
    }

    let mut command = Command::new(&config.bun);
    command
        .arg(&config.helper)
        .env("CODEX_HOME", codex_home)
        .env(
            "OPENCODEX_HOME",
            codex_home.join("azrael/providers/opencodex"),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut child = command
        .spawn()
        .map_err(|_| fatal("failed to start provider account helper"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| fatal("provider account helper stdin unavailable"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| fatal("provider account helper stdout unavailable"))?;
    let output = tokio::time::timeout(timeout, async {
        stdin
            .write_all(&request)
            .await
            .map_err(|_| fatal("failed to send provider account request"))?;
        stdin
            .shutdown()
            .await
            .map_err(|_| fatal("failed to finish provider account request"))?;
        let mut bytes = Vec::new();
        stdout
            .take((MAX_RESPONSE_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| fatal("failed reading provider account helper output"))?;
        let status = child
            .wait()
            .await
            .map_err(|_| fatal("failed waiting for provider account helper"))?;
        Ok::<_, CodexErr>((bytes, status.success()))
    })
    .await
    .map_err(|_| fatal("provider account helper timed out"))??;
    if output.0.len() > MAX_RESPONSE_BYTES {
        return Err(fatal(
            "provider account helper output exceeded the hard limit",
        ));
    }
    if !output.1 {
        return Err(fatal("provider account helper failed"));
    }
    decode_response(&output.0, request_id, account_id)
}

pub(super) fn decode_response(
    bytes: &[u8],
    request_id: &str,
    requested_account_id: Option<&str>,
) -> CodexResult<Option<ManagedCredential>> {
    let response: CredentialResponse = serde_json::from_slice(trim_single_line(bytes)?)
        .map_err(|_| fatal("provider account helper returned an invalid response"))?;
    match response {
        CredentialResponse::Result { id, value } if id == request_id => {
            if let Some(value) = &value
                && (value.api_key.trim().is_empty()
                    || value.api_server_url.trim().is_empty()
                    || value.account_id.trim().is_empty())
            {
                return Err(fatal(
                    "provider account helper returned incomplete credentials",
                ));
            }
            if let (Some(requested), Some(value)) = (requested_account_id, &value)
                && value.account_id != requested
            {
                return Err(invalid(
                    "provider account helper returned a different Devin account",
                ));
            }
            Ok(value)
        }
        CredentialResponse::Error { id, .. } if id == request_id => {
            Err(invalid("provider account helper returned an error"))
        }
        _ => Err(fatal(
            "provider account helper returned a mismatched response",
        )),
    }
}

fn trim_single_line(bytes: &[u8]) -> CodexResult<&[u8]> {
    let bytes = bytes.strip_suffix(b"\n").unwrap_or(bytes);
    let bytes = bytes.strip_suffix(b"\r").unwrap_or(bytes);
    if bytes.is_empty() || bytes.contains(&b'\n') || bytes.contains(&b'\r') {
        return Err(fatal(
            "provider account helper returned an invalid response frame",
        ));
    }
    Ok(bytes)
}

fn invalid(message: impl Into<String>) -> CodexErr {
    CodexErr::new(CodexErrorDetails::InvalidRequest(message.into()))
}

fn fatal(message: impl Into<String>) -> CodexErr {
    CodexErr::new(CodexErrorDetails::Fatal(message.into()))
}

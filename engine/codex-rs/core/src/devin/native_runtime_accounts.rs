use super::state::Credential;
use super::state::ExistingAccountBinding;
use codex_protocol::error::CodexErr;
use codex_protocol::error::CodexErrorDetails;
use codex_protocol::error::Result as CodexResult;
use serde::Deserialize;
use serde::Serialize;
use std::path::Path;
use std::path::PathBuf;
use std::time::Duration;

const HELPER_ENV: &str = "AZRAEL_PROVIDER_ACCOUNTS_HELPER";
const BUN_ENV: &str = "AZRAEL_PROVIDER_BUN";
const PROTOCOL_VERSION: u8 = 1;
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
    #[serde(skip_serializing_if = "Option::is_none")]
    require_auto_switch: Option<bool>,
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

pub(super) fn managed_credential(credential: ManagedCredential) -> ResolvedCredential {
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

pub(super) fn helper_config() -> CodexResult<Option<HelperConfig>> {
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

pub(super) async fn request_credential(
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
    let request = CredentialRequest {
        protocol: PROTOCOL_VERSION,
        id: request_id,
        action: "credential",
        provider_id: "devin",
        account_id,
        require_auto_switch: None,
    };
    send_credential_request(
        codex_home,
        config,
        request,
        timeout,
        &tokio_util::sync::CancellationToken::new(),
    )
    .await
}

/// The helper admits recovery consent and identity from one coordinated snapshot.
pub(super) async fn request_recovery_credential(
    codex_home: &Path,
    config: &HelperConfig,
    account_id: &str,
    cancellation: &tokio_util::sync::CancellationToken,
) -> CodexResult<Option<ManagedCredential>> {
    let request_id = uuid::Uuid::new_v4().to_string();
    request_recovery_credential_with(
        codex_home,
        config,
        account_id,
        &request_id,
        HELPER_TIMEOUT,
        cancellation,
    )
    .await
}

pub(super) async fn request_recovery_credential_with(
    codex_home: &Path,
    config: &HelperConfig,
    account_id: &str,
    request_id: &str,
    timeout: Duration,
    cancellation: &tokio_util::sync::CancellationToken,
) -> CodexResult<Option<ManagedCredential>> {
    let request = CredentialRequest {
        protocol: PROTOCOL_VERSION,
        id: request_id,
        action: "credential",
        provider_id: "devin",
        account_id: Some(account_id),
        require_auto_switch: Some(true),
    };
    send_credential_request(codex_home, config, request, timeout, cancellation).await
}

async fn send_credential_request(
    codex_home: &Path,
    config: &HelperConfig,
    request: CredentialRequest<'_>,
    timeout: Duration,
    cancellation: &tokio_util::sync::CancellationToken,
) -> CodexResult<Option<ManagedCredential>> {
    let bytes = serde_json::to_vec(&request)
        .map_err(|_| fatal("unable to serialize provider account request"))?;
    let output = crate::managed_account_recovery::helper_rpc(
        codex_home,
        &config.helper,
        &config.bun,
        bytes,
        timeout,
        cancellation,
    )
    .await?;
    decode_response(&output, request.id, request.account_id)
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

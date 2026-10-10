//! Private, bounded account-owner RPC. This boundary never exposes credentials.
use crate::session::session::Session;
use crate::session::turn_context::TurnContext;
use codex_protocol::error::CodexErr;
use codex_protocol::error::CodexErrorDetails;
use codex_protocol::error::Result as CodexResult;
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

const MAX_BYTES: usize = 64 * 1024;
pub(crate) const MAX_ACCOUNTS: usize = 64;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryRequest<'a> {
    protocol: u8,
    id: &'a str,
    action: &'static str,
    provider_id: &'a str,
    thread_id: &'a str,
    turn_id: &'a str,
    model: &'a str,
    excluded_account_ids: Vec<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expected_account_id: Option<&'a str>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RecoveryDestination {
    pub(crate) exhausted_account_id: String,
    pub(crate) account_id: String,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum RecoveryResponse {
    Result {
        id: String,
        value: serde_json::Value,
    },
    Error {
        id: String,
        #[serde(rename = "error")]
        _error: serde_json::Value,
    },
}

pub(crate) async fn recover(
    sess: &Session,
    ctx: &TurnContext,
    excluded: &mut HashSet<String>,
    cancellation: &CancellationToken,
) -> CodexResult<Option<String>> {
    if excluded.len() >= MAX_ACCOUNTS {
        return Ok(None);
    }
    let slug = ctx.model_info().slug.clone();
    // Custom API authentication has no managed OAuth account rotation.
    if slug.starts_with("api/") {
        return Ok(None);
    }
    if crate::devin::catalog::is_devin(&slug) {
        return crate::devin::native_runtime::recover_account(sess, ctx, excluded, cancellation)
            .await;
    }
    if !crate::managed_catalog::is_managed(&slug) {
        return Ok(None);
    }
    let (provider, model) = crate::managed_catalog::selection(&slug)
        .map_err(|_| invalid("invalid managed recovery model"))?;
    let result = request_recovery(
        ctx.config.codex_home.as_path(),
        &provider,
        &sess.thread_id().to_string(),
        &ctx.sub_id,
        model,
        excluded,
        None,
        cancellation,
    )
    .await?;
    Ok(result.map(|value| {
        excluded.insert(value.exhausted_account_id);
        value.account_id
    }))
}

pub(crate) async fn request_recovery(
    codex_home: &Path,
    provider: &str,
    thread_id: &str,
    turn_id: &str,
    model: &str,
    excluded: &HashSet<String>,
    expected: Option<&str>,
    cancellation: &CancellationToken,
) -> CodexResult<Option<RecoveryDestination>> {
    if excluded.len() >= MAX_ACCOUNTS {
        return Ok(None);
    }
    let Some((helper, bun)) = helper_paths()? else {
        return Ok(None);
    };
    let id = uuid::Uuid::new_v4().to_string();
    let mut excluded_account_ids: Vec<_> = excluded.iter().map(String::as_str).collect();
    excluded_account_ids.sort_unstable();
    let request = RecoveryRequest {
        protocol: 1,
        id: &id,
        action: "recoverAccount",
        provider_id: provider,
        thread_id,
        turn_id,
        model,
        excluded_account_ids,
        expected_account_id: expected,
    };
    let bytes =
        serde_json::to_vec(&request).map_err(|_| invalid("unable to encode account recovery"))?;
    let response = helper_rpc(
        codex_home,
        &helper,
        &bun,
        bytes,
        Duration::from_secs(20),
        cancellation,
    )
    .await?;
    decode_response(&response, &id, excluded, expected)
}

pub(crate) fn helper_paths() -> CodexResult<Option<(PathBuf, PathBuf)>> {
    let helper = std::env::var_os("AZRAEL_PROVIDER_ACCOUNTS_HELPER").filter(|s| !s.is_empty());
    let bun = std::env::var_os("AZRAEL_PROVIDER_BUN").filter(|s| !s.is_empty());
    match (helper, bun) {
        (None, _) => Ok(None),
        (Some(helper), Some(bun)) => {
            let paths = (PathBuf::from(helper), PathBuf::from(bun));
            if !paths.0.is_absolute() || !paths.1.is_absolute() {
                return Err(invalid("provider account helper paths must be absolute"));
            }
            Ok(Some(paths))
        }
        _ => Err(invalid("provider account helper runtime is missing")),
    }
}

// Shared with Devin credential lookup; stderr and raw subprocess errors stay private.
pub(crate) async fn helper_rpc(
    codex_home: &Path,
    helper: &Path,
    bun: &Path,
    mut request: Vec<u8>,
    deadline: Duration,
    cancellation: &CancellationToken,
) -> CodexResult<Vec<u8>> {
    if cancellation.is_cancelled() {
        return Err(interrupted());
    }
    request.push(b'\n');
    if request.len() > MAX_BYTES {
        return Err(invalid("provider account request exceeded the hard limit"));
    }
    let mut command = Command::new(bun);
    command
        .arg(helper)
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
        .map_err(|_| invalid("failed to start provider account helper"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| invalid("provider account helper stdin unavailable"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| invalid("provider account helper stdout unavailable"))?;
    let operation = async {
        stdin
            .write_all(&request)
            .await
            .map_err(|_| invalid("failed to send provider account request"))?;
        stdin
            .shutdown()
            .await
            .map_err(|_| invalid("failed to finish provider account request"))?;
        drop(stdin);
        let mut bytes = Vec::new();
        stdout
            .take((MAX_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| invalid("failed reading provider account helper output"))?;
        if bytes.len() > MAX_BYTES {
            return Err(invalid(
                "provider account helper output exceeded the hard limit",
            ));
        }
        let status = child
            .wait()
            .await
            .map_err(|_| invalid("failed waiting for provider account helper"))?;
        if !status.success() {
            return Err(invalid("provider account helper failed"));
        }
        Ok(bytes)
    };
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => Err(interrupted()),
        result = tokio::time::timeout(deadline, operation) =>
            result.map_err(|_| invalid("provider account helper timed out"))?,
    }
}

fn decode_response(
    bytes: &[u8],
    id: &str,
    excluded: &HashSet<String>,
    expected: Option<&str>,
) -> CodexResult<Option<RecoveryDestination>> {
    let bytes = bytes.strip_suffix(b"\n").unwrap_or(bytes);
    let bytes = bytes.strip_suffix(b"\r").unwrap_or(bytes);
    if bytes.contains(&b'\n') || bytes.contains(&b'\r') {
        return Err(invalid("invalid account recovery response frame"));
    }
    let response: RecoveryResponse =
        serde_json::from_slice(bytes).map_err(|_| invalid("invalid account recovery response"))?;
    match response {
        RecoveryResponse::Result { id: actual, value } if actual == id => {
            let value: Option<RecoveryDestination> = serde_json::from_value(value)
                .map_err(|_| invalid("invalid account recovery destination"))?;
            if let Some(value) = &value
                && (!valid_identity(&value.account_id)
                    || !valid_identity(&value.exhausted_account_id)
                    || value.account_id == value.exhausted_account_id
                    || excluded.contains(&value.account_id)
                    || excluded.contains(&value.exhausted_account_id)
                    || expected.is_some_and(|expected| expected != value.exhausted_account_id))
            {
                return Err(invalid("inconsistent account recovery destination"));
            }
            Ok(value)
        }
        RecoveryResponse::Error { id: actual, .. } if actual == id => {
            Err(invalid("provider account recovery failed"))
        }
        _ => Err(invalid("mismatched account recovery response")),
    }
}

fn valid_identity(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value.trim() == value
        && !value.chars().any(char::is_control)
}
fn invalid(message: &str) -> CodexErr {
    CodexErr::new(CodexErrorDetails::InvalidRequest(message.to_string()))
}
fn interrupted() -> CodexErr {
    CodexErr::new(CodexErrorDetails::Interrupted)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovery_response_contract() {
        let excluded = HashSet::new();
        assert!(
            decode_response(
                br#"{"type":"result","id":"r","value":null}"#,
                "r",
                &excluded,
                None
            )
            .unwrap()
            .is_none()
        );
        let valid =
            br#"{"type":"result","id":"r","value":{"exhaustedAccountId":"a","accountId":"b"}}"#;
        assert_eq!(
            decode_response(valid, "r", &excluded, Some("a"))
                .unwrap()
                .unwrap()
                .account_id,
            "b"
        );
        assert!(decode_response(valid, "other", &excluded, None).is_err());
        assert!(decode_response(valid, "r", &excluded, Some("other")).is_err());
        assert!(decode_response(valid, "r", &HashSet::from(["b".into()]), None).is_err());
        assert!(
            decode_response(
                br#"{"type":"result","id":"r","value":{"exhaustedAccountId":"a","accountId":"a"}}"#,
                "r",
                &excluded,
                None
            )
            .is_err()
        );
        assert!(decode_response(b"{}\n{}", "r", &excluded, None).is_err());
        assert!(decode_response(br#"{"type":"result","id":"r"}"#, "r", &excluded, None).is_err());
        assert!(decode_response(br#"{"type":"result","id":"r","value":{"exhaustedAccountId":"a","accountId":"b\n"}}"#, "r", &excluded, None).is_err());
    }
    #[test]
    fn recovery_request_has_private_contract_fields() {
        let request = RecoveryRequest {
            protocol: 1,
            id: "r",
            action: "recoverAccount",
            provider_id: "devin",
            thread_id: "thread",
            turn_id: "turn",
            model: "devin/model",
            excluded_account_ids: vec!["exhausted"],
            expected_account_id: Some("source"),
        };
        assert_eq!(
            serde_json::to_value(request).unwrap(),
            serde_json::json!({
                "protocol": 1, "id": "r", "action": "recoverAccount", "providerId": "devin",
                "threadId": "thread", "turnId": "turn", "model": "devin/model",
                "excludedAccountIds": ["exhausted"], "expectedAccountId": "source",
            })
        );
    }
    #[tokio::test]
    async fn cancelled_helper_does_not_spawn() {
        let cancellation = CancellationToken::new();
        cancellation.cancel();
        let result = helper_rpc(
            Path::new("."),
            Path::new("missing"),
            Path::new("missing"),
            vec![],
            Duration::from_secs(1),
            &cancellation,
        )
        .await;
        assert!(matches!(
            result.unwrap_err().details(),
            CodexErrorDetails::Interrupted
        ));
    }
}

//! Bounded model-capability lookup through the native Devin helper.
use super::HELPER_ENV;
use super::HELPER_SCRUBBED_ENV;
use super::NODE_ENV;
use super::PROTOCOL_VERSION;
use super::process::absolute_env_path;
use super::serialize_frame;
use super::state::Credential;
use anyhow::Context;
use anyhow::Result;
use anyhow::anyhow;
use serde::Deserialize;
use serde::Serialize;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

const CAPABILITIES_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_CAPABILITIES_BYTES: usize = 1024 * 1024;
const MAX_MODEL_ID_BYTES: usize = 128;

#[derive(Serialize)]
struct InitFrame<'a> {
    r#type: &'static str,
    protocol_version: u8,
    request_id: &'a str,
    credential: &'a Credential,
}

#[derive(Serialize)]
struct CapabilitiesRequest<'a> {
    r#type: &'static str,
    protocol_version: u8,
    request_id: &'a str,
}

#[derive(Deserialize)]
struct CapabilitiesFrame {
    protocol_version: u8,
    request_id: String,
    r#type: String,
    #[serde(default)]
    image_model_ids: Vec<String>,
    #[serde(default)]
    code: Option<String>,
}

/// Image-capable Devin model ids, or `None` when the native transport is not
/// enabled. Only model ids and a result code cross the helper boundary.
pub(crate) async fn image_model_ids() -> Option<Result<Vec<String>>> {
    super::enabled().then_some(())?;
    Some(fetch().await)
}

async fn fetch() -> Result<Vec<String>> {
    let helper = absolute_env_path(HELPER_ENV).map_err(|error| anyhow!("{error}"))?;
    let node = absolute_env_path(NODE_ENV).map_err(|error| anyhow!("{error}"))?;
    let credential = super::state::read_credential().map_err(|error| anyhow!("{error}"))?;
    let request_id = uuid::Uuid::new_v4().to_string();
    let mut input = serialize_frame(&InitFrame {
        r#type: "init",
        protocol_version: PROTOCOL_VERSION,
        request_id: &request_id,
        credential: &credential,
    })
    .map_err(|error| anyhow!("{error}"))?;
    input.extend(
        serialize_frame(&CapabilitiesRequest {
            r#type: "capabilities",
            protocol_version: PROTOCOL_VERSION,
            request_id: &request_id,
        })
        .map_err(|error| anyhow!("{error}"))?,
    );

    let mut command = Command::new(&node);
    command
        .arg(&helper)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    for name in HELPER_SCRUBBED_ENV {
        command.env_remove(name);
    }
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut child = command
        .spawn()
        .context("failed to start Devin capability helper")?;
    let mut stdin = child.stdin.take().context("capability helper stdin unavailable")?;
    let stdout = child
        .stdout
        .take()
        .context("capability helper stdout unavailable")?;
    let completed = tokio::time::timeout(CAPABILITIES_TIMEOUT, async {
        stdin.write_all(&input).await?;
        stdin.shutdown().await?;
        drop(stdin);
        let mut bytes = Vec::new();
        stdout
            .take((MAX_CAPABILITIES_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .await?;
        let status = child.wait().await?;
        Ok::<_, std::io::Error>((bytes, status))
    })
    .await;
    let (bytes, status) = match completed {
        Ok(result) => result.context("Devin capability helper I/O failed")?,
        Err(_) => {
            let _ = child.kill().await;
            return Err(anyhow!("Devin capability helper timed out"));
        }
    };
    let ids = decode(&bytes, &request_id)?;
    if !status.success() {
        return Err(anyhow!("Devin capability helper failed with {status}"));
    }
    tracing::info!(
        event = "devin_native_capabilities_loaded",
        image_model_count = ids.len()
    );
    Ok(ids)
}

fn decode(bytes: &[u8], request_id: &str) -> Result<Vec<String>> {
    if bytes.len() > MAX_CAPABILITIES_BYTES {
        return Err(anyhow!("Devin capability output exceeded the hard limit"));
    }
    let line = bytes
        .strip_suffix(b"\n")
        .filter(|line| !line.contains(&b'\n'))
        .context("Devin capability helper returned an invalid frame")?;
    let frame: CapabilitiesFrame =
        serde_json::from_slice(line).context("Devin capability helper returned invalid JSON")?;
    if frame.protocol_version != PROTOCOL_VERSION || frame.request_id != request_id {
        return Err(anyhow!("Devin capability helper returned a mismatched frame"));
    }
    if frame.r#type == "error" {
        let code = super::process::sanitize_code(frame.code.as_deref());
        return Err(anyhow!("Devin capability lookup failed ({code})"));
    }
    if frame.r#type != "capabilities"
        || frame.image_model_ids.iter().any(|id| {
            id.is_empty()
                || id.len() > MAX_MODEL_ID_BYTES
                || !id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        })
    {
        return Err(anyhow!("Devin capability helper returned invalid capabilities"));
    }
    Ok(frame.image_model_ids)
}

#[cfg(test)]
mod tests {
    use super::decode;

    #[test]
    fn decodes_bounded_capability_frames() {
        let ok = br#"{"protocol_version":1,"request_id":"r","seq":0,"type":"capabilities","image_model_ids":["claude-opus-5-5-medium","swe-2-high"]}
"#;
        assert_eq!(
            decode(ok, "r").unwrap(),
            vec!["claude-opus-5-5-medium", "swe-2-high"]
        );
        assert!(decode(ok, "other").is_err());
        let error = br#"{"protocol_version":1,"request_id":"r","seq":0,"type":"error","code":"capabilities_unavailable"}
"#;
        assert!(decode(error, "r").is_err());
        let invalid = br#"{"protocol_version":1,"request_id":"r","seq":0,"type":"capabilities","image_model_ids":["bad id"]}
"#;
        assert!(decode(invalid, "r").is_err());
        assert!(decode(b"{}", "r").is_err());
    }
}

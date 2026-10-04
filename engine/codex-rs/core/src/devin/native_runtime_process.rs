use codex_protocol::error::CodexErr;
use codex_protocol::error::CodexErrorDetails;
use codex_protocol::error::Result as CodexResult;
use std::ffi::OsString;
use std::path::PathBuf;

pub(super) fn absolute_env_path(name: &str) -> CodexResult<PathBuf> {
    let value = std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid(format!("{name} is required for native Devin")))?;
    absolute_path(name, value)
}

fn absolute_path(name: &str, value: OsString) -> CodexResult<PathBuf> {
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(invalid(format!("{name} must be an absolute path")));
    }
    Ok(path)
}

pub(super) fn sanitize_code(code: Option<&str>) -> String {
    let code = code.unwrap_or("unknown");
    let sanitized: String = code
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
        .take(64)
        .collect();
    if sanitized.is_empty() {
        "unknown".to_string()
    } else {
        sanitized
    }
}

fn invalid(message: impl Into<String>) -> CodexErr {
    CodexErr::new(CodexErrorDetails::InvalidRequest(message.into()))
}

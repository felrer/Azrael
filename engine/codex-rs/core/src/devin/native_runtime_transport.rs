// Temporary, strictly bounded transport diagnostics; removable independently of timing policy.
use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Deserialize, Serialize)]
#[serde(try_from = "u64")]
struct SafeInteger(u64);
impl TryFrom<u64> for SafeInteger {
    type Error = &'static str;
    fn try_from(value: u64) -> Result<Self, Self::Error> {
        if value <= 9_007_199_254_740_991 {
            Ok(Self(value))
        } else {
            Err("invalid transport integer")
        }
    }
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(try_from = "u64")]
struct HttpStatus(u64);
impl TryFrom<u64> for HttpStatus {
    type Error = &'static str;
    fn try_from(value: u64) -> Result<Self, Self::Error> {
        if (100..=599).contains(&value) {
            Ok(Self(value))
        } else {
            Err("invalid transport status")
        }
    }
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(try_from = "String")]
struct Sha256(String);
impl TryFrom<String> for Sha256 {
    type Error = &'static str;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.len() == 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            Ok(Self(value))
        } else {
            Err("invalid transport hash")
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Transport {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    headers_status: Option<HttpStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    headers_ms: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    read_wait_ms: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    read_count: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    chunk_count: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_chunk_bytes: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sse_event_count: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    heartbeat_count: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    unknown_sse_count: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sse_idle_ms: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sse_pending_bytes: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    parser_wait_ms: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    parser_event_count: Option<SafeInteger>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    content_block_open: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    finish_seen: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    request_id_sha256: Option<Sha256>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    server_sha256: Option<Sha256>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    via_sha256: Option<Sha256>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    read_state: Option<ReadState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    parser_state: Option<ParserState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_sse_event: Option<LastSseEvent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_parser_event: Option<LastParserEvent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    content_block_kind: Option<ContentBlockKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    abort_source: Option<AbortSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    error_stage: Option<ErrorStage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    error_name: Option<ErrorName>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    connection_error: Option<ConnectionError>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    connection_error_code: Option<ConnectionErrorCode>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum ConnectionError {
    Dns,
    Tls,
    Reset,
    Refused,
    Timeout,
    Unreachable,
    Proxy,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(try_from = "String")]
struct ConnectionErrorCode(String);

impl TryFrom<String> for ConnectionErrorCode {
    type Error = &'static str;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.as_str() {
            "ENOTFOUND"
            | "EAI_AGAIN"
            | "ECONNRESET"
            | "EPIPE"
            | "UND_ERR_SOCKET"
            | "ECONNREFUSED"
            | "ETIMEDOUT"
            | "UND_ERR_CONNECT_TIMEOUT"
            | "ENETUNREACH"
            | "EHOSTUNREACH"
            | "ENETDOWN"
            | "ERR_TLS_CERT_ALTNAME_INVALID"
            | "CERT_HAS_EXPIRED"
            | "DEPTH_ZERO_SELF_SIGNED_CERT"
            | "SELF_SIGNED_CERT_IN_CHAIN"
            | "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
            | "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"
            | "ERR_SSL_WRONG_VERSION_NUMBER"
            | "ERR_PROXY_CONNECTION_FAILED" => Ok(Self(value)),
            _ => Err("invalid connection error code"),
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum ReadState {
    Idle,
    Pending,
    Received,
    Eof,
    Error,
    Cancelled,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum ParserState {
    Idle,
    Pending,
    Yielded,
    Done,
    Error,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum LastSseEvent {
    None,
    MessageStart,
    ContentBlockStart,
    ContentBlockDelta,
    ContentBlockStop,
    MessageDelta,
    MessageStop,
    Ping,
    Error,
    GoogleData,
    Unknown,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum LastParserEvent {
    None,
    TextDelta,
    ThinkingDelta,
    ReasoningRawDelta,
    ThinkingSignature,
    ToolCallStart,
    ToolCallDelta,
    ToolCallEnd,
    Heartbeat,
    Usage,
    Done,
    Error,
    Unknown,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum ContentBlockKind {
    None,
    Text,
    Thinking,
    RedactedThinking,
    ToolUse,
    Unknown,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum AbortSource {
    None,
    Deadline,
    Transport,
    Cancelled,
    Unknown,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum ErrorStage {
    None,
    Build,
    Headers,
    BodyRead,
    SseDecode,
    AdapterParse,
    Translate,
    Map,
    Unknown,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum ErrorName {
    None,
    Abort,
    Timeout,
    TypeError,
    AdapterError,
    Unknown,
}

#[cfg(test)]
#[path = "native_runtime_transport_tests.rs"]
mod tests;

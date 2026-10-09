use codex_protocol::error::CodexErr;
use codex_protocol::error::CodexErrorDetails;
use codex_protocol::error::Result as CodexResult;
use codex_protocol::models::ResponseItem;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub(super) struct OutputFrame {
    pub(super) protocol_version: u8,
    pub(super) request_id: String,
    pub(super) seq: u64,
    pub(super) r#type: String,
    #[serde(default)]
    pub(super) item: Option<ResponseItem>,
    #[serde(default)]
    pub(super) delta: Option<String>,
    #[serde(default)]
    pub(super) usage: Option<Usage>,
    #[serde(default)]
    pub(super) code: Option<String>,
    #[serde(default)]
    pub(super) diagnostics: Option<FailureDiagnostics>,
    #[serde(default)]
    pub(super) progress: Option<Progress>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Progress {
    #[serde(default)]
    pub(super) thinking_wait: Option<ThinkingWait>,
    #[serde(default)]
    transport: Option<super::transport::Transport>,
    pub(super) phase: ProgressPhase,
    pub(super) elapsed_ms: u64,
    pub(super) network_idle_ms: u64,
    pub(super) event_idle_ms: u64,
    pub(super) bytes_received: u64,
    pub(super) event_count: u64,
    pub(super) last_event: ProgressEvent,
    #[serde(default)]
    pub(super) phase_elapsed_ms: Option<u64>,
    #[serde(default)]
    pub(super) first_byte_ms: Option<u64>,
    #[serde(default)]
    pub(super) first_event_ms: Option<u64>,
    #[serde(default)]
    pub(super) stdout_buffered_bytes: Option<u64>,
    #[serde(default)]
    pub(super) stdout_backpressure_count: Option<u64>,
    #[serde(default)]
    pub(super) frames_emitted: Option<u64>,
    #[serde(default)]
    pub(super) output_bytes: Option<u64>,
}

/// Liveness of opaque thinking; never a claim of generated content.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ThinkingWait {
    pub(super) open: bool,
    pub(super) heartbeat_count: u64,
    pub(super) heartbeat_idle_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum ProgressPhase {
    Preflight,
    Headers,
    Stream,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum ProgressEvent {
    None,
    Text,
    Reasoning,
    ReasoningSignature,
    ToolCallStart,
    ToolCallArgs,
    Usage,
    Finish,
}

impl Progress {
    pub(super) fn log(&self, request_id: &str, outcome: &str) {
        tracing::info!(target: "devin_native_progress", event = "native_inference_progress", request_id, outcome,
            phase = ?self.phase, elapsed_ms = self.elapsed_ms,
            network_idle_ms = self.network_idle_ms, event_idle_ms = self.event_idle_ms,
            bytes_received = self.bytes_received, event_count = self.event_count,
            last_event = ?self.last_event,
            phase_elapsed_ms = ?self.phase_elapsed_ms,
            first_byte_ms = ?self.first_byte_ms,
            first_event_ms = ?self.first_event_ms,
            stdout_buffered_bytes = ?self.stdout_buffered_bytes,
            stdout_backpressure_count = ?self.stdout_backpressure_count,
            frames_emitted = ?self.frames_emitted,
            output_bytes = ?self.output_bytes);
        if let Some(wait) = &self.thinking_wait {
            tracing::info!(target: "devin_native_progress", event = "native_inference_thinking_wait",
                request_id, outcome, open = wait.open,
                heartbeat_count = wait.heartbeat_count, heartbeat_idle_ms = wait.heartbeat_idle_ms,
                generation_idle_ms = self.event_idle_ms, generation_event_count = self.event_count);
        }
        if let Some(transport) = &self.transport
            && let Ok(transport) = serde_json::to_string(transport)
        {
            tracing::info!(target: "devin_native_progress", event = "native_inference_transport",
                request_id, outcome, transport = %transport);
        }
    }
}

const TRANSPORT_ERROR_CODES: &[&str] = &[
    "headers_timeout",
    "stream_idle_timeout",
    "truncated_stream",
    "invalid_trailer",
    "provider_error",
    "cancelled",
    "reader_failure",
    "other",
];

#[derive(Debug, Deserialize)]
pub(super) struct FailureDiagnostics {
    pub(super) event_count: Option<u64>,
    pub(super) last_event: Option<String>,
    pub(super) history_type: Option<String>,
    #[serde(default)]
    pub(super) transport_error: Option<String>,
    #[serde(default)]
    pub(super) http_status: Option<u64>,
    pub(super) finish_reason: Option<String>,
    pub(super) provider_stop_reason: Option<u64>,
    pub(super) pending_tool_count: Option<u64>,
    pub(super) active_tool_call: Option<bool>,
    pub(super) provider_error_code: Option<String>,
    pub(super) provider_error_source: Option<String>,
    pub(super) provider_trace_id: Option<String>,
    pub(super) provider_reason: Option<String>,
}

impl FailureDiagnostics {
    /// Only allowlisted transport codes may be logged; anything else is dropped.
    pub(super) fn transport_error_code(&self) -> Option<&'static str> {
        self.transport_error.as_deref().and_then(|value| {
            TRANSPORT_ERROR_CODES
                .iter()
                .copied()
                .find(|code| *code == value)
        })
    }

    /// Only plausible HTTP status codes may be logged.
    pub(super) fn http_status_code(&self) -> Option<u16> {
        self.http_status
            .and_then(|status| u16::try_from(status).ok())
            .filter(|status| (100..=599).contains(status))
    }

    /// Preserve only known terminal reasons, never arbitrary provider text.
    pub(super) fn finish_reason_code(&self) -> Option<&str> {
        self.finish_reason
            .as_deref()
            .filter(|reason| matches!(*reason, "stop" | "tool_calls" | "length" | "content_filter"))
    }

    /// Preserve exact known RPC/denial codes; never sanitize arbitrary text into a code.
    pub(super) fn provider_error_code(&self) -> Option<&str> {
        self.provider_error_code.as_deref().filter(|code| {
            matches!(
                *code,
                "cancelled"
                    | "unknown"
                    | "invalid_argument"
                    | "deadline_exceeded"
                    | "not_found"
                    | "already_exists"
                    | "permission_denied"
                    | "resource_exhausted"
                    | "failed_precondition"
                    | "aborted"
                    | "out_of_range"
                    | "unimplemented"
                    | "internal"
                    | "unavailable"
                    | "data_loss"
                    | "unauthenticated"
                    | "usage_limit_reached"
                    | "quota_exceeded"
                    | "insufficient_quota"
                    | "rate_limit_exceeded"
                    | "rate_limited"
                    | "too_many_requests"
                    | "invalid_request_error"
            )
        })
    }

    pub(super) fn provider_error_source(&self) -> Option<&str> {
        self.provider_error_source
            .as_deref()
            .filter(|source| matches!(*source, "http_response" | "connect_trailer"))
    }

    /// Accept the complete bounded trace ID rather than truncating an untrusted value.
    pub(super) fn provider_trace_id(&self) -> Option<&str> {
        self.provider_trace_id.as_deref().filter(|trace| {
            (16..=64).contains(&trace.len())
                && trace
                    .bytes()
                    .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
        })
    }

    pub(super) fn provider_reason(&self) -> Option<&str> {
        self.provider_reason.as_deref().filter(|reason| {
            matches!(
                *reason,
                "internal_error"
                    | "context_limit"
                    | "invalid_thinking_signature"
                    | "missing_tool_result"
                    | "missing_tool_use"
                    | "usage_limit"
                    | "rate_limit"
                    | "invalid_request"
                    | "message_missing"
                    | "unrecognized_message"
            )
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(from = "RawUsage")]
pub(super) struct Usage {
    pub(super) input_tokens: i64,
    pub(super) output_tokens: i64,
    #[serde(default)]
    pub(super) cached_input_tokens: i64,
    #[serde(default)]
    pub(super) cache_write_input_tokens: i64,
    #[serde(default)]
    pub(super) cache_write_1h_input_tokens: Option<i64>,
    #[serde(default)]
    pub(super) estimated: bool,
    #[serde(default)]
    pub(super) reasoning_output_tokens: i64,
    pub(super) total_tokens: i64,
}

#[derive(Deserialize)]
struct RawUsage {
    input_tokens: i64,
    output_tokens: i64,
    #[serde(default)]
    cached_input_tokens: i64,
    #[serde(default)]
    reasoning_output_tokens: i64,
    total_tokens: i64,
    #[serde(default)]
    cache_write_input_tokens: serde_json::Value,
    #[serde(default)]
    cache_write_1h_input_tokens: serde_json::Value,
    #[serde(default)]
    estimated: serde_json::Value,
}

impl From<RawUsage> for Usage {
    fn from(raw: RawUsage) -> Self {
        let count = |value: &serde_json::Value| {
            value
                .as_i64()
                .filter(|count| (0..=9_007_199_254_740_991).contains(count))
        };
        let write = count(&raw.cache_write_input_tokens);
        let one_hour = count(&raw.cache_write_1h_input_tokens);
        let mut usage = Self {
            input_tokens: raw.input_tokens,
            output_tokens: raw.output_tokens,
            cached_input_tokens: raw.cached_input_tokens,
            reasoning_output_tokens: raw.reasoning_output_tokens,
            total_tokens: raw.total_tokens,
            cache_write_input_tokens: write.unwrap_or(0),
            cache_write_1h_input_tokens: one_hour,
            estimated: raw.estimated.as_bool().unwrap_or(false)
                || (!raw.estimated.is_null() && !raw.estimated.is_boolean())
                || (!raw.cache_write_input_tokens.is_null() && write.is_none())
                || (!raw.cache_write_1h_input_tokens.is_null() && one_hour.is_none()),
        };
        if usage
            .cached_input_tokens
            .checked_add(usage.cache_write_input_tokens)
            .is_none_or(|cached| cached > usage.input_tokens)
            || usage.reasoning_output_tokens > usage.output_tokens
        {
            usage.estimated = true;
        }
        if usage
            .cache_write_1h_input_tokens
            .is_some_and(|one_hour| one_hour > usage.cache_write_input_tokens)
        {
            usage.cache_write_1h_input_tokens = None;
            usage.estimated = true;
        }
        usage
    }
}

pub(super) fn validate_usage(usage: Option<&Usage>) -> CodexResult<()> {
    let Some(usage) = usage else {
        return Ok(());
    };
    if usage.input_tokens < 0
        || usage.output_tokens < 0
        || usage.cached_input_tokens < 0
        || usage.reasoning_output_tokens < 0
        || usage.total_tokens < 0
        || usage.total_tokens != usage.input_tokens.saturating_add(usage.output_tokens)
    {
        return Err(CodexErr::new(CodexErrorDetails::Fatal(
            "native Devin returned invalid token usage".to_string(),
        )));
    }
    Ok(())
}

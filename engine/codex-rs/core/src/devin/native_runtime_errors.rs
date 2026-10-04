use super::process::sanitize_code;
use codex_protocol::error::CodexErr;
use codex_protocol::error::CodexErrorDetails;
use codex_protocol::error::UsageLimitReachedError;

pub(super) fn helper_error(code: Option<&str>) -> CodexErr {
    // Match the original code, never a sanitized approximation. In particular,
    // provider_http_429 may originate from a generic Connect resource failure;
    // only the transport can distinguish that from a confirmed usage limit.
    let details = match code {
        Some("provider_usage_limit") => {
            CodexErrorDetails::UsageLimitReached(UsageLimitReachedError {
                plan_type: None,
                resets_at: None,
                limit_window_minutes: None,
                rate_limits: None,
                promo_message: None,
                rate_limit_reached_type: None,
            })
        }
        Some("provider_rate_limit") => CodexErrorDetails::RateLimitExceeded(
            "Provider request rate limit reached. Try again later.".to_string(),
        ),
        // These are established local watchdog outcomes, not inferred causes.
        Some("provider_headers_timeout" | "provider_stream_idle" | "provider_request_deadline") => {
            CodexErrorDetails::Fatal(format!(
                "native inference helper failed ({})",
                sanitize_code(code)
            ))
        }
        // Local image admission outcomes. The request is not retried as-is.
        Some("image_input_too_large") => CodexErrorDetails::InvalidRequest(
            "Attached images exceed the provider request limit. Remove images or start a new thread."
                .to_string(),
        ),
        Some("unsupported_image_format" | "remote_image_unsupported" | "invalid_image_input") => {
            CodexErrorDetails::InvalidRequest(format!(
                "This provider accepts PNG, JPEG, GIF or WebP image attachments only ({})",
                sanitize_code(code)
            ))
        }
        _ => CodexErrorDetails::Unclassified(format!(
            "native inference helper failed ({})",
            sanitize_code(code)
        )),
    };
    CodexErr::new(details)
}

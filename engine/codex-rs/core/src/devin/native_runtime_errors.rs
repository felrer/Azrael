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
        // Keep these terminal: assigning a retryable transport variant would
        // change the recovery policy merely to improve the displayed message.
        Some("provider_headers_failed") => CodexErrorDetails::Fatal(
            "모델 응답 헤더를 받기 전에 요청이 실패했습니다. 원인은 확인되지 않았습니다. 연결 상태와 기존 작업 결과를 확인한 뒤 이 세션에서 다시 요청하세요. (provider_headers_failed)".to_string(),
        ),
        Some(code @ ("provider_connection_dns" | "provider_connection_tls"
            | "provider_connection_reset" | "provider_connection_refused"
            | "provider_connection_timeout" | "provider_connection_unreachable"
            | "provider_connection_proxy")) => {
            let cause = match code {
                "provider_connection_dns" => "모델 서버 주소의 DNS 조회에 실패했습니다.",
                "provider_connection_tls" => "모델 서버와의 TLS 연결에 실패했습니다.",
                "provider_connection_reset" => "모델 서버와의 연결이 끊어졌습니다.",
                "provider_connection_refused" => "모델 서버 연결이 거부됐습니다.",
                "provider_connection_timeout" => "모델 서버 연결 대기 시간이 초과됐습니다.",
                "provider_connection_unreachable" => "모델 서버에 연결할 네트워크 경로를 사용할 수 없습니다.",
                "provider_connection_proxy" => "프록시 연결에 실패했습니다.",
                _ => unreachable!("matched connection code"),
            };
            CodexErrorDetails::Fatal(format!(
                "{cause} 연결 상태와 기존 작업 결과를 확인한 뒤 이 세션에서 다시 요청하세요. ({code})"
            ))
        }
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

#[cfg(test)]
mod tests {
    use super::helper_error;
    use codex_protocol::protocol::CodexErrorInfo;

    #[test]
    fn connection_guidance_keeps_errors_terminal_and_does_not_guess_unknown_causes() {
        for code in [
            "provider_headers_failed",
            "provider_connection_dns",
            "provider_connection_tls",
            "provider_connection_reset",
            "provider_connection_refused",
            "provider_connection_timeout",
            "provider_connection_unreachable",
            "provider_connection_proxy",
        ] {
            let error = helper_error(Some(code));
            assert_eq!(error.to_codex_protocol_error(), CodexErrorInfo::Other);
            assert!(error.retry_delay(1).is_none());
            let message = error.to_error_event(/*message_prefix*/ None).message;
            assert!(message.contains("이 세션에서 다시 요청하세요"));
            assert!(message.ends_with(&format!("({code})")));
            assert!(!message.contains("미분류 오류"));
        }
        let unknown = helper_error(Some("provider_connection_dns!"));
        assert!(
            unknown
                .to_error_event(/*message_prefix*/ None)
                .message
                .starts_with("미분류 오류:")
        );
    }
}

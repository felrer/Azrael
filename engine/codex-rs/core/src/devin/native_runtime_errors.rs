use super::process::sanitize_code;
use codex_protocol::error::CodexErr;
use codex_protocol::error::CodexErrorDetails;
use codex_protocol::error::UsageLimitReachedError;

pub(super) fn helper_error(code: Option<&str>) -> CodexErr {
    // Match the original code, never a sanitized approximation. In particular,
    // provider_http_429 may originate from a generic Connect resource failure;
    // only the transport can distinguish that from a confirmed usage limit.
    let details = match code {
        Some("provider_refusal") => CodexErrorDetails::Fatal(
            "모델 제공자가 응답을 거부했습니다. (provider_refusal)".to_string(),
        ),
        Some("provider_account_removed") => CodexErrorDetails::InvalidRequest(
            "The provider account was removed. Work was stopped. Select a healthy account before continuing.".to_string(),
        ),
        Some("provider_account_revoked") => CodexErrorDetails::InvalidRequest(
            "The provider account requires reauthentication. Work was stopped. Sign in again or select a healthy account before continuing.".to_string(),
        ),
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
            "모델 호출 제한에 도달했습니다.".to_string(),
        ),
        Some("provider_rate_limit_requests") => CodexErrorDetails::RateLimitExceeded(
            "모델 요청 수 제한에 도달했습니다.".to_string(),
        ),
        Some("provider_rate_limit_input_tokens") => CodexErrorDetails::RateLimitExceeded(
            "모델 입력 토큰 처리량 제한에 도달했습니다.".to_string(),
        ),
        Some("provider_rate_limit_output_tokens") => CodexErrorDetails::RateLimitExceeded(
            "모델 출력 토큰 처리량 제한에 도달했습니다.".to_string(),
        ),
        Some("provider_rate_limit_tokens") => CodexErrorDetails::RateLimitExceeded(
            "모델 토큰 처리량 제한에 도달했습니다.".to_string(),
        ),
        Some("provider_rate_limit_concurrency") => CodexErrorDetails::RateLimitExceeded(
            "모델 동시 요청 수 제한에 도달했습니다.".to_string(),
        ),
        Some("provider_rate_limit_acceleration") => CodexErrorDetails::RateLimitExceeded(
            "모델 요청 증가율 제한에 도달했습니다.".to_string(),
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
        _ => CodexErrorDetails::Unclassified("정의되지 않은 오류".to_string()),
    };
    CodexErr::new(details)
}

#[cfg(test)]
mod tests {
    use super::helper_error;
    use codex_protocol::protocol::CodexErrorInfo;

    #[test]
    fn provider_refusal_is_exact_terminal_fatal_error() {
        let error = helper_error(Some("provider_refusal"));
        assert_eq!(error.to_codex_protocol_error(), CodexErrorInfo::Other);
        assert_eq!(
            error.to_error_event(None).message,
            "Fatal error: 모델 제공자가 응답을 거부했습니다. (provider_refusal)"
        );
        assert!(error.retry_delay(1).is_none());
        assert!(error.retry_delay(10).is_none());
        for code in [
            "provider_refusal!",
            " provider_refusal",
            "provider_refusal_extra",
            "PROVIDER_REFUSAL",
        ] {
            let unknown = helper_error(Some(code));
            assert_eq!(unknown.to_codex_protocol_error(), CodexErrorInfo::Other);
            assert_eq!(unknown.to_error_event(None).message, "정의되지 않은 오류");
            assert!(unknown.retry_delay(1).is_none());
        }
    }

    #[test]
    fn retirement_errors_are_terminal_and_actionable() {
        for code in ["provider_account_removed", "provider_account_revoked"] {
            let error = helper_error(Some(code));
            assert!(error.retry_delay(1).is_none());
            let message = error.to_error_event(None).message;
            assert!(message.contains("Work was stopped."));
            assert!(message.contains("healthy account"));
        }
    }

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
        for code in [
            None,
            Some("provider_http_429"),
            Some("provider_error_undefined"),
            Some("provider_connection_dns!"),
            Some("SECRET"),
        ] {
            let unknown = helper_error(code);
            assert_eq!(unknown.to_codex_protocol_error(), CodexErrorInfo::Other);
            assert!(unknown.retry_delay(1).is_none());
            assert_eq!(unknown.to_error_event(None).message, "정의되지 않은 오류");
        }
    }

    #[test]
    fn specific_rate_limits_preserve_category_and_retry_policy() {
        for (code, message) in [
            (
                "provider_rate_limit_requests",
                "모델 요청 수 제한에 도달했습니다.",
            ),
            (
                "provider_rate_limit_input_tokens",
                "모델 입력 토큰 처리량 제한에 도달했습니다.",
            ),
            (
                "provider_rate_limit_output_tokens",
                "모델 출력 토큰 처리량 제한에 도달했습니다.",
            ),
            (
                "provider_rate_limit_tokens",
                "모델 토큰 처리량 제한에 도달했습니다.",
            ),
            (
                "provider_rate_limit_concurrency",
                "모델 동시 요청 수 제한에 도달했습니다.",
            ),
            (
                "provider_rate_limit_acceleration",
                "모델 요청 증가율 제한에 도달했습니다.",
            ),
        ] {
            let error = helper_error(Some(code));
            assert_eq!(
                error.to_codex_protocol_error(),
                CodexErrorInfo::RateLimitExceeded
            );
            assert!(error.retry_delay(1).is_some());
            assert!(error.to_error_event(None).message.ends_with(message));
        }
    }
}

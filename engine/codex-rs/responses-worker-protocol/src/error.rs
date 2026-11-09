use crate::WireError;
use crate::WireHeaders;
use codex_api::ApiError;
use codex_http_client::HttpError;
use codex_http_client::NetworkPolicyDenied;
use codex_http_client::RetryAfter;
use codex_http_client::RouteFailureClass;
use codex_http_client::TransportError;
use codex_protocol::protocol::MisalignmentErrorDetails;
use http::StatusCode;
use serde::Deserialize;
use serde::Serialize;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct WireDuration {
    pub secs: u64,
    pub nanos: u32,
}

impl From<Duration> for WireDuration {
    fn from(value: Duration) -> Self {
        Self {
            secs: value.as_secs(),
            nanos: value.subsec_nanos(),
        }
    }
}

impl TryFrom<WireDuration> for Duration {
    type Error = WireError;
    fn try_from(value: WireDuration) -> Result<Self, Self::Error> {
        if value.nanos >= 1_000_000_000 {
            return Err(WireError("invalid duration nanoseconds".into()));
        }
        Ok(Self::new(value.secs, value.nanos))
    }
}

/// Host-monotonic capture is valid only across admitted same-host child pipes.
/// A capture failure is retained explicitly because `From<ApiError>` cannot fail;
/// restoring such an error fails closed rather than silently losing retry advice.
#[derive(Debug, Serialize, Deserialize)]
pub struct WireRetryAfter {
    pub captured_at: Result<WireDuration, String>,
    pub remaining: WireDuration,
}

impl WireRetryAfter {
    pub fn remaining_at(self, now: Duration) -> Result<Duration, WireError> {
        let captured_at = Duration::try_from(self.captured_at.map_err(WireError)?)?;
        let elapsed = now.checked_sub(captured_at).ok_or_else(|| {
            WireError("worker retry timestamp is from the future or another boot".into())
        })?;
        Ok(Duration::try_from(self.remaining)?.saturating_sub(elapsed))
    }
}

fn capture(value: Option<RetryAfter>) -> Option<WireRetryAfter> {
    value.map(|value| {
        // Anchor the Tokio deadline before reading the shared clock, so sampling
        // overhead cannot turn an unexpired deadline into an earlier retry.
        let local_now = tokio::time::Instant::now();
        let captured_at = crate::monotonic::now()
            .map(Into::into)
            .map_err(|err| err.to_string());
        WireRetryAfter {
            captured_at,
            remaining: value.deadline().saturating_duration_since(local_now).into(),
        }
    })
}

fn restore(
    value: Option<WireRetryAfter>,
    _elapsed: Duration,
) -> Result<Option<RetryAfter>, WireError> {
    value
        .map(|value| {
            let remaining = value.remaining_at(crate::monotonic::now()?)?;
            RetryAfter::from_delay(remaining)
                .ok_or_else(|| WireError("retry deadline overflow".into()))
        })
        .transpose()
}

#[derive(Debug, Serialize, Deserialize)]
pub enum WirePolicyDenied {
    Unavailable,
    Destination,
    Revoked,
    UnsupportedTransport,
}

impl From<NetworkPolicyDenied> for WirePolicyDenied {
    fn from(value: NetworkPolicyDenied) -> Self {
        match value {
            NetworkPolicyDenied::Unavailable => Self::Unavailable,
            NetworkPolicyDenied::Destination => Self::Destination,
            NetworkPolicyDenied::Revoked => Self::Revoked,
            NetworkPolicyDenied::UnsupportedTransport => Self::UnsupportedTransport,
        }
    }
}
impl From<WirePolicyDenied> for NetworkPolicyDenied {
    fn from(value: WirePolicyDenied) -> Self {
        match value {
            WirePolicyDenied::Unavailable => Self::Unavailable,
            WirePolicyDenied::Destination => Self::Destination,
            WirePolicyDenied::Revoked => Self::Revoked,
            WirePolicyDenied::UnsupportedTransport => Self::UnsupportedTransport,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub enum WireFailureClass {
    ProxyResolutionUnavailable,
    ConnectTimeout,
    ProxyAuthenticationRequired,
    TlsError,
    InvalidProxyConfig,
    UnsupportedProxyScheme,
    ResolverError,
}

macro_rules! failure_class {
    ($value:expr, $from:ident, $to:ident) => {
        match $value {
            $from::ProxyResolutionUnavailable => $to::ProxyResolutionUnavailable,
            $from::ConnectTimeout => $to::ConnectTimeout,
            $from::ProxyAuthenticationRequired => $to::ProxyAuthenticationRequired,
            $from::TlsError => $to::TlsError,
            $from::InvalidProxyConfig => $to::InvalidProxyConfig,
            $from::UnsupportedProxyScheme => $to::UnsupportedProxyScheme,
            $from::ResolverError => $to::ResolverError,
        }
    };
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WireConnectionError {
    pub message: String,
    pub status: Option<u16>,
    pub is_timeout: bool,
    pub is_connect: bool,
    pub is_builder: bool,
    pub is_body: bool,
    pub is_request: bool,
    pub failure_class: Option<WireFailureClass>,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum WireTransportError {
    Policy(WirePolicyDenied),
    Http {
        status: u16,
        url: Option<String>,
        headers: Option<WireHeaders>,
        body: Option<String>,
        retry_after: Option<WireRetryAfter>,
    },
    RetryLimit,
    Timeout,
    Connection(WireConnectionError),
    Network(String),
    Build(String),
    ResponseTooLarge {
        max_bytes: u64,
    },
}

impl From<TransportError> for WireTransportError {
    fn from(value: TransportError) -> Self {
        match value {
            TransportError::Policy(value) => Self::Policy(value.into()),
            TransportError::Http {
                status,
                url,
                headers,
                body,
                retry_after,
            } => Self::Http {
                status: status.as_u16(),
                url,
                headers: headers.map(Into::into),
                body,
                retry_after: capture(retry_after),
            },
            TransportError::RetryLimit => Self::RetryLimit,
            TransportError::Timeout => Self::Timeout,
            TransportError::Connection(value) => {
                let value = value.without_url();
                Self::Connection(WireConnectionError {
                    message: value.sanitized_message(),
                    status: value.status().map(|status| status.as_u16()),
                    is_timeout: value.is_timeout(),
                    is_connect: value.is_connect(),
                    is_builder: value.is_builder(),
                    is_body: value.is_body(),
                    is_request: value.is_request(),
                    failure_class: value
                        .failure_class()
                        .map(|value| failure_class!(value, RouteFailureClass, WireFailureClass)),
                })
            }
            TransportError::Network(value) => Self::Network(value),
            TransportError::Build(value) => Self::Build(value),
            TransportError::ResponseTooLarge { max_bytes } => Self::ResponseTooLarge {
                max_bytes: max_bytes as u64,
            },
        }
    }
}

fn status(value: u16) -> Result<StatusCode, WireError> {
    StatusCode::from_u16(value).map_err(|err| WireError(err.to_string()))
}

impl WireTransportError {
    pub fn into_transport_error(
        self,
        elapsed_since_capture: Duration,
    ) -> Result<TransportError, WireError> {
        Ok(match self {
            Self::Policy(value) => TransportError::Policy(value.into()),
            Self::Http {
                status: code,
                url,
                headers,
                body,
                retry_after,
            } => TransportError::Http {
                status: status(code)?,
                url,
                headers: headers.map(TryInto::try_into).transpose()?,
                body,
                retry_after: restore(retry_after, elapsed_since_capture)?,
            },
            Self::RetryLimit => TransportError::RetryLimit,
            Self::Timeout => TransportError::Timeout,
            Self::Connection(value) => TransportError::Connection(HttpError::Remote {
                message: value.message,
                status: value.status.map(status).transpose()?,
                is_timeout: value.is_timeout,
                is_connect: value.is_connect,
                is_builder: value.is_builder,
                is_body: value.is_body,
                is_request: value.is_request,
                failure_class: value
                    .failure_class
                    .map(|value| failure_class!(value, WireFailureClass, RouteFailureClass)),
            }),
            Self::Network(value) => TransportError::Network(value),
            Self::Build(value) => TransportError::Build(value),
            Self::ResponseTooLarge { max_bytes } => TransportError::ResponseTooLarge {
                max_bytes: usize::try_from(max_bytes).map_err(|err| WireError(err.to_string()))?,
            },
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub enum WireApiError {
    Transport(WireTransportError),
    Api {
        status: u16,
        message: String,
    },
    Stream(String),
    ContentFilter,
    ContextWindowExceeded,
    QuotaExceeded,
    UsageNotIncluded,
    Retryable {
        message: String,
        retry_after: Option<WireRetryAfter>,
    },
    RateLimitExceeded {
        message: String,
        retry_after: Option<WireRetryAfter>,
    },
    RateLimit(String),
    InvalidRequest {
        message: String,
    },
    InvalidPrompt {
        message: String,
    },
    CyberPolicy {
        message: String,
    },
    BioPolicy {
        message: String,
    },
    MisalignmentPolicyViolation {
        message: String,
        misalignment: Option<MisalignmentErrorDetails>,
    },
    FlexUnavailable,
    ServerOverloaded {
        retry_after: Option<WireRetryAfter>,
    },
}

macro_rules! simple_api_errors {
    ($value:expr, $from:ident, $to:ident, $other:ident => $expression:expr) => {
        match $value {
            $from::Stream(v) => $to::Stream(v),
            $from::ContentFilter => $to::ContentFilter,
            $from::ContextWindowExceeded => $to::ContextWindowExceeded,
            $from::QuotaExceeded => $to::QuotaExceeded,
            $from::UsageNotIncluded => $to::UsageNotIncluded,
            $from::RateLimit(v) => $to::RateLimit(v),
            $from::InvalidRequest { message } => $to::InvalidRequest { message },
            $from::InvalidPrompt { message } => $to::InvalidPrompt { message },
            $from::CyberPolicy { message } => $to::CyberPolicy { message },
            $from::BioPolicy { message } => $to::BioPolicy { message },
            $from::MisalignmentPolicyViolation {
                message,
                misalignment,
            } => $to::MisalignmentPolicyViolation {
                message,
                misalignment,
            },
            $from::FlexUnavailable => $to::FlexUnavailable,
            $other => $expression,
        }
    };
}

impl From<ApiError> for WireApiError {
    fn from(value: ApiError) -> Self {
        simple_api_errors!(value, ApiError, WireApiError, other => match other {
            ApiError::Transport(value) => Self::Transport(value.into()),
            ApiError::Api { status, message } => Self::Api { status: status.as_u16(), message },
            ApiError::Retryable { message, retry_after } => Self::Retryable { message, retry_after: capture(retry_after) },
            ApiError::RateLimitExceeded { message, retry_after } => Self::RateLimitExceeded { message, retry_after: capture(retry_after) },
            ApiError::ServerOverloaded { retry_after } => Self::ServerOverloaded { retry_after: capture(retry_after) },
            ApiError::Stream(_)
            | ApiError::ContentFilter
            | ApiError::ContextWindowExceeded
            | ApiError::QuotaExceeded
            | ApiError::UsageNotIncluded
            | ApiError::RateLimit(_)
            | ApiError::InvalidRequest { .. }
            | ApiError::InvalidPrompt { .. }
            | ApiError::CyberPolicy { .. }
            | ApiError::BioPolicy { .. }
            | ApiError::MisalignmentPolicyViolation { .. }
            | ApiError::FlexUnavailable => unreachable!("simple variants handled above"),
        })
    }
}

impl From<&ApiError> for WireApiError {
    fn from(value: &ApiError) -> Self {
        let owned = match value {
            ApiError::Transport(value) => return Self::Transport(value.into()),
            ApiError::Api { status, message } => ApiError::Api {
                status: *status,
                message: message.clone(),
            },
            ApiError::Stream(value) => ApiError::Stream(value.clone()),
            ApiError::ContentFilter => ApiError::ContentFilter,
            ApiError::ContextWindowExceeded => ApiError::ContextWindowExceeded,
            ApiError::QuotaExceeded => ApiError::QuotaExceeded,
            ApiError::UsageNotIncluded => ApiError::UsageNotIncluded,
            ApiError::Retryable {
                message,
                retry_after,
            } => ApiError::Retryable {
                message: message.clone(),
                retry_after: *retry_after,
            },
            ApiError::RateLimitExceeded {
                message,
                retry_after,
            } => ApiError::RateLimitExceeded {
                message: message.clone(),
                retry_after: *retry_after,
            },
            ApiError::RateLimit(value) => ApiError::RateLimit(value.clone()),
            ApiError::InvalidRequest { message } => ApiError::InvalidRequest {
                message: message.clone(),
            },
            ApiError::InvalidPrompt { message } => ApiError::InvalidPrompt {
                message: message.clone(),
            },
            ApiError::CyberPolicy { message } => ApiError::CyberPolicy {
                message: message.clone(),
            },
            ApiError::BioPolicy { message } => ApiError::BioPolicy {
                message: message.clone(),
            },
            ApiError::MisalignmentPolicyViolation {
                message,
                misalignment,
            } => ApiError::MisalignmentPolicyViolation {
                message: message.clone(),
                misalignment: misalignment.clone(),
            },
            ApiError::FlexUnavailable => ApiError::FlexUnavailable,
            ApiError::ServerOverloaded { retry_after } => ApiError::ServerOverloaded {
                retry_after: *retry_after,
            },
        };
        owned.into()
    }
}

impl From<&TransportError> for WireTransportError {
    fn from(value: &TransportError) -> Self {
        let owned = match value {
            TransportError::Policy(value) => TransportError::Policy(*value),
            TransportError::Http {
                status,
                url,
                headers,
                body,
                retry_after,
            } => TransportError::Http {
                status: *status,
                url: url.clone(),
                headers: headers.clone(),
                body: body.clone(),
                retry_after: *retry_after,
            },
            TransportError::RetryLimit => TransportError::RetryLimit,
            TransportError::Timeout => TransportError::Timeout,
            TransportError::Connection(value) => {
                return Self::Connection(WireConnectionError {
                    message: value.sanitized_message(),
                    status: value.status().map(|status| status.as_u16()),
                    is_timeout: value.is_timeout(),
                    is_connect: value.is_connect(),
                    is_builder: value.is_builder(),
                    is_body: value.is_body(),
                    is_request: value.is_request(),
                    failure_class: value
                        .failure_class()
                        .map(|value| failure_class!(value, RouteFailureClass, WireFailureClass)),
                });
            }
            TransportError::Network(value) => TransportError::Network(value.clone()),
            TransportError::Build(value) => TransportError::Build(value.clone()),
            TransportError::ResponseTooLarge { max_bytes } => TransportError::ResponseTooLarge {
                max_bytes: *max_bytes,
            },
        };
        owned.into()
    }
}

impl WireApiError {
    /// Retry age comes from the captured same-host boot-monotonic timestamp.
    /// The elapsed argument is retained for source compatibility and ignored;
    /// request-start age is not retry-advice age. Only private same-host child
    /// pipe peers from the same boot may exchange these values.
    pub fn into_api_error(self, elapsed_since_capture: Duration) -> Result<ApiError, WireError> {
        Ok(
            simple_api_errors!(self, WireApiError, ApiError, other => match other {
                Self::Transport(value) => ApiError::Transport(value.into_transport_error(elapsed_since_capture)?),
                Self::Api { status: code, message } => ApiError::Api { status: status(code)?, message },
                Self::Retryable { message, retry_after } => ApiError::Retryable { message, retry_after: restore(retry_after, elapsed_since_capture)? },
                Self::RateLimitExceeded { message, retry_after } => ApiError::RateLimitExceeded { message, retry_after: restore(retry_after, elapsed_since_capture)? },
                Self::ServerOverloaded { retry_after } => ApiError::ServerOverloaded { retry_after: restore(retry_after, elapsed_since_capture)? },
            Self::Stream(_)
            | Self::ContentFilter
            | Self::ContextWindowExceeded
            | Self::QuotaExceeded
            | Self::UsageNotIncluded
            | Self::RateLimit(_)
            | Self::InvalidRequest { .. }
            | Self::InvalidPrompt { .. }
            | Self::CyberPolicy { .. }
            | Self::BioPolicy { .. }
            | Self::MisalignmentPolicyViolation { .. }
            | Self::FlexUnavailable => unreachable!("simple variants handled above"),
            }),
        )
    }
}

/// Restores advice using its captured boot-monotonic timestamp, including IPC age.
impl TryFrom<WireApiError> for ApiError {
    type Error = WireError;
    fn try_from(value: WireApiError) -> Result<Self, Self::Error> {
        value.into_api_error(Duration::ZERO)
    }
}

impl TryFrom<WireTransportError> for TransportError {
    type Error = WireError;
    fn try_from(value: WireTransportError) -> Result<Self, Self::Error> {
        value.into_transport_error(Duration::ZERO)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // A future naive from_delay(remaining) would restart server advice on IPC.
    #[test]
    fn retry_advice_subtracts_only_capture_age_at_nanosecond_precision() {
        let value = WireRetryAfter {
            captured_at: Ok(Duration::new(100, 700).into()),
            remaining: Duration::new(3, 900).into(),
        };
        let encoded = serde_json::to_vec(&value).unwrap();
        let decoded: WireRetryAfter = serde_json::from_slice(&encoded).unwrap();
        assert_eq!(
            decoded.remaining_at(Duration::new(102, 800)).unwrap(),
            Duration::new(1, 800)
        );
        let expired = WireRetryAfter {
            captured_at: Ok(Duration::from_secs(100).into()),
            remaining: Duration::from_secs(1).into(),
        };
        assert_eq!(
            expired.remaining_at(Duration::from_secs(102)).unwrap(),
            Duration::ZERO
        );
        let failed = WireRetryAfter {
            captured_at: Err("clock unavailable".into()),
            remaining: Duration::ZERO.into(),
        };
        assert!(failed.remaining_at(Duration::from_secs(102)).is_err());
    }

    #[test]
    fn policy_denial_is_not_a_connection_or_network_error() {
        let error = ApiError::Transport(TransportError::Policy(NetworkPolicyDenied::Revoked));
        let encoded = serde_json::to_vec(&WireApiError::from(error)).unwrap();
        let decoded: WireApiError = serde_json::from_slice(&encoded).unwrap();
        assert!(matches!(
            decoded.into_api_error(Duration::ZERO).unwrap(),
            ApiError::Transport(TransportError::Policy(NetworkPolicyDenied::Revoked))
        ));
    }
}

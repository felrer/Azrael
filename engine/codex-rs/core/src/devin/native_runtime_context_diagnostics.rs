//! Strict structural evidence; never accepts provider names or request content.
use serde::{Deserialize, Serialize};

const SAFE: u64 = (1_u64 << 53) - 1;

#[derive(Debug, Deserialize)]
#[serde(try_from = "Payload")]
pub(crate) struct ContextDiagnostics(Payload);

impl Serialize for ContextDiagnostics {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Payload {
    schema_version: u8,
    estimate_method: EstimateMethod,
    projection: Projection,
    model_sha256: String,
    components: Components,
    image_count: u64,
    image_bytes: u64,
    text_estimate_tokens: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    wire_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reported_input_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reported_input_estimated: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    residual_tokens: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum EstimateMethod {
    ModelChars,
    Utf8Bytes,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum Projection {
    Compiled,
    Wire,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Components {
    instructions: Component,
    conversation: Component,
    tool_definitions: Component,
    tool_results: Component,
    tool_calls: Component,
    reasoning: Component,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Component {
    bytes: u64,
    tokens: u64,
    count: u64,
}

impl TryFrom<Payload> for ContextDiagnostics {
    type Error = &'static str;
    fn try_from(value: Payload) -> Result<Self, Self::Error> {
        let c = &value.components;
        let components = [
            &c.instructions,
            &c.conversation,
            &c.tool_definitions,
            &c.tool_results,
            &c.tool_calls,
            &c.reasoning,
        ];
        if value.schema_version != 1
            || value.model_sha256.len() != 64
            || !value
                .model_sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || [
                value.image_count,
                value.image_bytes,
                value.text_estimate_tokens,
            ]
            .into_iter()
            .any(|v| v > SAFE)
            || [value.wire_bytes, value.reported_input_tokens]
                .into_iter()
                .flatten()
                .any(|v| v > SAFE)
            || components
                .into_iter()
                .any(|c| c.bytes > SAFE || c.tokens > SAFE || c.count > SAFE)
        {
            return Err("invalid structural context diagnostics");
        }
        if let Some(residual) = value.residual_tokens {
            if residual.unsigned_abs() > SAFE
                || value.reported_input_estimated != Some(false)
                || value
                    .reported_input_tokens
                    .map(|n| n as i64 - value.text_estimate_tokens as i64)
                    != Some(residual)
            {
                return Err("invalid context usage residual");
            }
        }
        Ok(Self(value))
    }
}

pub(super) fn is_terminal_outcome(outcome: &str) -> bool {
    let http = outcome
        .strip_prefix("provider_http_")
        .is_some_and(|status| {
            status.len() == 3
                && status.bytes().all(|b| b.is_ascii_digit())
                && status
                    .parse::<u16>()
                    .is_ok_and(|n| (100..=599).contains(&n))
        });
    http || matches!(
        outcome,
        "completed"
            | "helper_error"
            | "inference_output_idle"
            | "engine_deadline"
            | "cancelled"
            | "provider_request_deadline"
            | "provider_failure"
            | "provider_stream_idle"
            | "provider_headers_timeout"
            | "provider_connection_dns"
            | "provider_connection_refused"
            | "provider_connection_reset"
            | "provider_connection_tls"
            | "provider_connection_timeout"
            | "provider_connection_unreachable"
            | "provider_connection_proxy"
            | "provider_headers_failed"
            | "undeclared_tool"
            | "duplicate_call_id"
            | "invalid_arguments"
            | "invalid_custom_wrapper"
            | "parallel_calls_disabled"
            | "provider_account_removed"
            | "provider_account_revoked"
            | "provider_usage_limit"
            | "provider_rate_limit"
            | "provider_context_limit"
            | "image_input_too_large"
            | "unsupported_image_format"
            | "remote_image_unsupported"
            | "invalid_image_input"
            | "unknown"
    )
}

#[cfg(test)]
pub(super) fn fixture() -> serde_json::Value {
    serde_json::json!({"schema_version":1,"estimate_method":"model_chars","projection":"compiled",
        "model_sha256":"a".repeat(64), "components": {
            "instructions":{"bytes":0,"tokens":0,"count":0},"conversation":{"bytes":0,"tokens":0,"count":0},
            "tool_definitions":{"bytes":0,"tokens":0,"count":0},"tool_results":{"bytes":0,"tokens":0,"count":0},
            "tool_calls":{"bytes":0,"tokens":0,"count":0},"reasoning":{"bytes":0,"tokens":0,"count":0}},
        "image_count":0,"image_bytes":0,"text_estimate_tokens":5})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_context_schema() {
        let parsed: ContextDiagnostics = serde_json::from_value(fixture()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), fixture());
        for (key, bad) in [
            ("schema_version", serde_json::json!(2)),
            ("projection", serde_json::json!("SECRET")),
            ("estimate_method", serde_json::json!("SECRET")),
            ("model_sha256", serde_json::json!("A".repeat(64))),
            ("image_bytes", serde_json::json!(SAFE + 1)),
            ("image_count", serde_json::json!(-1)),
            ("text_estimate_tokens", serde_json::json!(true)),
            ("secret", serde_json::json!("SECRET")),
        ] {
            let mut v = fixture();
            v[key] = bad;
            assert!(
                serde_json::from_value::<ContextDiagnostics>(v).is_err(),
                "{key}"
            );
        }
        for path in ["components", "instructions"] {
            let mut v = fixture();
            if path == "components" {
                v["components"]["secret"] = serde_json::json!("SECRET");
            } else {
                v["components"]["instructions"]["secret"] = serde_json::json!("SECRET");
            }
            assert!(serde_json::from_value::<ContextDiagnostics>(v).is_err());
        }
        for key in ["bytes", "tokens", "count"] {
            let mut v = fixture();
            v["components"]["reasoning"][key] = serde_json::json!(SAFE + 1);
            assert!(serde_json::from_value::<ContextDiagnostics>(v).is_err());
        }
    }
    #[test]
    fn residual_requires_actual_matching_usage() {
        let mut v = fixture();
        v["reported_input_tokens"] = serde_json::json!(3);
        v["reported_input_estimated"] = serde_json::json!(false);
        v["residual_tokens"] = serde_json::json!(-2);
        assert!(serde_json::from_value::<ContextDiagnostics>(v.clone()).is_ok());
        for bad in [serde_json::json!(true), serde_json::Value::Null] {
            v["reported_input_estimated"] = bad;
            assert!(serde_json::from_value::<ContextDiagnostics>(v.clone()).is_err());
        }
        v["reported_input_estimated"] = serde_json::json!(false);
        v["residual_tokens"] = serde_json::json!(2);
        assert!(serde_json::from_value::<ContextDiagnostics>(v).is_err());
    }
}

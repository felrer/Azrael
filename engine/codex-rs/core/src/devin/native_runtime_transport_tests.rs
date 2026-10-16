use super::super::*;
use super::Transport;
use futures::StreamExt;
use pretty_assertions::assert_eq;
use serde_json::json;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tracing::field::Field;
use tracing::field::Visit;
use tracing_subscriber::Layer;
use tracing_subscriber::layer::SubscriberExt;

#[test]
fn provider_stop_and_refusal_evidence_is_closed_and_roundtrips() {
    for (field, values) in [
        (
            "provider_stop_reason",
            [
                "end_turn",
                "tool_use",
                "stop_sequence",
                "max_tokens",
                "pause_turn",
                "refusal",
                "content_filter",
                "unknown",
            ],
        ),
        (
            "provider_refusal_category",
            [
                "cyber",
                "bio",
                "frontier_llm",
                "reasoning_extraction",
                "general_harms",
                "unspecified",
                "unknown",
                "missing",
            ],
        ),
    ] {
        for value in values {
            let wire = json!({field: value});
            let transport: Transport = serde_json::from_value(wire.clone()).unwrap();
            assert_eq!(serde_json::to_value(transport).unwrap(), wire);
        }
        for value in [
            json!("SECRET"),
            json!("refusal SECRET"),
            json!(1),
            json!({"explanation":"SECRET"}),
        ] {
            assert!(serde_json::from_value::<Transport>(json!({field: value})).is_err());
        }
    }
    assert!(serde_json::from_value::<Transport>(json!({
        "provider_stop_reason":"refusal", "provider_refusal_category":"cyber", "explanation":"SECRET"
    })).is_err());
}

#[test]
fn connection_diagnostics_roundtrip_only_allowlisted_evidence() {
    let evidence = json!({
        "error_stage": "headers",
        "connection_error": "dns",
        "connection_error_code": "ENOTFOUND",
    });
    let transport: Transport = serde_json::from_value(evidence.clone()).unwrap();
    assert_eq!(serde_json::to_value(transport).unwrap(), evidence);
    for untrusted in [
        json!({"connection_error": "SECRET_HOST"}),
        json!({"connection_error_code": "SECRET_TOKEN"}),
        json!({"connection_error_code": "ENOTFOUND SECRET_URL"}),
        json!({"connection_error_code": 404}),
        json!({"connection_error": "dns", "message": "SECRET_PROMPT"}),
    ] {
        assert!(serde_json::from_value::<Transport>(untrusted).is_err());
    }
}

#[test]
fn transport_roundtrips_every_observed_field_and_enum() {
    let cases: &[(&str, &[serde_json::Value])] = &[
        ("headers_status", &[json!(100), json!(599)]),
        ("headers_ms", &[json!(0), json!(9_007_199_254_740_991u64)]),
        ("read_wait_ms", &[json!(0), json!(9_007_199_254_740_991u64)]),
        ("read_count", &[json!(0), json!(9_007_199_254_740_991u64)]),
        ("chunk_count", &[json!(0), json!(9_007_199_254_740_991u64)]),
        (
            "last_chunk_bytes",
            &[json!(0), json!(9_007_199_254_740_991u64)],
        ),
        (
            "sse_event_count",
            &[json!(0), json!(9_007_199_254_740_991u64)],
        ),
        (
            "heartbeat_count",
            &[json!(0), json!(9_007_199_254_740_991u64)],
        ),
        (
            "unknown_sse_count",
            &[json!(0), json!(9_007_199_254_740_991u64)],
        ),
        ("sse_idle_ms", &[json!(0), json!(9_007_199_254_740_991u64)]),
        (
            "sse_pending_bytes",
            &[json!(0), json!(9_007_199_254_740_991u64)],
        ),
        (
            "parser_wait_ms",
            &[json!(0), json!(9_007_199_254_740_991u64)],
        ),
        (
            "parser_event_count",
            &[json!(0), json!(9_007_199_254_740_991u64)],
        ),
        ("content_block_open", &[json!(false), json!(true)]),
        ("finish_seen", &[json!(false), json!(true)]),
        (
            "request_id_sha256",
            &[json!(
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            )],
        ),
        (
            "server_sha256",
            &[json!(
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            )],
        ),
        (
            "via_sha256",
            &[json!(
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            )],
        ),
        (
            "read_state",
            &[
                json!("idle"),
                json!("pending"),
                json!("received"),
                json!("eof"),
                json!("error"),
                json!("cancelled"),
            ],
        ),
        (
            "parser_state",
            &[
                json!("idle"),
                json!("pending"),
                json!("yielded"),
                json!("done"),
                json!("error"),
            ],
        ),
        (
            "last_sse_event",
            &[
                json!("none"),
                json!("message_start"),
                json!("content_block_start"),
                json!("content_block_delta"),
                json!("content_block_stop"),
                json!("message_delta"),
                json!("message_stop"),
                json!("ping"),
                json!("error"),
                json!("google_data"),
                json!("unknown"),
            ],
        ),
        (
            "last_parser_event",
            &[
                json!("none"),
                json!("text_delta"),
                json!("thinking_delta"),
                json!("reasoning_raw_delta"),
                json!("thinking_signature"),
                json!("tool_call_start"),
                json!("tool_call_delta"),
                json!("tool_call_end"),
                json!("heartbeat"),
                json!("usage"),
                json!("done"),
                json!("error"),
                json!("unknown"),
            ],
        ),
        (
            "content_block_kind",
            &[
                json!("none"),
                json!("text"),
                json!("thinking"),
                json!("redacted_thinking"),
                json!("tool_use"),
                json!("unknown"),
            ],
        ),
        (
            "abort_source",
            &[
                json!("none"),
                json!("deadline"),
                json!("transport"),
                json!("cancelled"),
                json!("unknown"),
            ],
        ),
        (
            "error_stage",
            &[
                json!("none"),
                json!("build"),
                json!("headers"),
                json!("body_read"),
                json!("sse_decode"),
                json!("adapter_parse"),
                json!("translate"),
                json!("map"),
                json!("unknown"),
            ],
        ),
        (
            "error_name",
            &[
                json!("none"),
                json!("abort"),
                json!("timeout"),
                json!("type_error"),
                json!("adapter_error"),
                json!("unknown"),
            ],
        ),
    ];
    for (field, values) in cases {
        for value in *values {
            let wire = json!({*field: value});
            let transport: Transport = serde_json::from_value(wire.clone()).unwrap();
            assert_eq!(serde_json::to_value(transport).unwrap(), wire);
        }
    }
    let empty: Transport = serde_json::from_value(json!({})).unwrap();
    assert_eq!(serde_json::to_value(empty).unwrap(), json!({}));
}

#[test]
fn malformed_transport_never_deserializes_to_loggable_data() {
    for wire in [
        json!({"headers_status":99}),
        json!({"headers_status":600}),
        json!({"read_count":-1}),
        json!({"read_wait_ms":1.5}),
        json!({"chunk_count":9_007_199_254_740_992u64}),
        json!({"sse_idle_ms":"SECRET-counter"}),
        json!({"request_id_sha256":"SECRET-id"}),
        json!({"server_sha256":"A".repeat(64)}),
        json!({"via_sha256":"a".repeat(63)}),
        json!({"finish_seen":"SECRET-bool"}),
        json!({"read_state":"SECRET-state"}),
        json!({"authorization":"SECRET-token"}),
        json!({"nested":{"prompt":"SECRET-prompt"}}),
    ] {
        assert!(serde_json::from_value::<Transport>(wire).is_err());
    }
}

#[test]
fn provider_error_evidence_is_strict_and_roundtrips() {
    for value in [
        "rate_limit_error",
        "rate_limit_exceeded",
        "rate_limited",
        "too_many_requests",
        "usage_limit_reached",
        "quota_exceeded",
        "insufficient_quota",
        "credit_balance_too_low",
        "invalid_request_error",
        "authentication_error",
        "permission_error",
        "billing_error",
        "overloaded_error",
        "api_error",
        "unknown",
        "missing",
    ] {
        let wire = json!({"provider_error_type": value});
        let transport: Transport = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(transport).unwrap(), wire);
    }
    for value in [
        "request_rate",
        "input_token_rate",
        "output_token_rate",
        "token_rate",
        "concurrency",
        "acceleration",
        "usage_limit",
        "usage_five_hour",
        "usage_seven_day",
        "usage_monthly",
        "rate_limit",
        "ambiguous",
        "unknown",
    ] {
        let wire = json!({"provider_error_reason": value});
        let transport: Transport = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(transport).unwrap(), wire);
    }
    for value in [
        "parsed",
        "invalid_json",
        "too_large",
        "timeout",
        "unreadable",
        "missing",
    ] {
        let wire = json!({"error_body_state": value});
        let transport: Transport = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(transport).unwrap(), wire);
    }
    for value in ["allowed", "allowed_warning", "rejected"] {
        let wire = json!({"usage_5h_status": value});
        let transport: Transport = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(transport).unwrap(), wire);
    }
    for value in ["allowed", "allowed_warning", "rejected"] {
        let wire = json!({"usage_7d_status": value});
        let transport: Transport = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(transport).unwrap(), wire);
    }
    for field in [
        "retry_after_ms",
        "rate_limit_requests_limit",
        "rate_limit_requests_remaining",
        "rate_limit_requests_reset_ms",
        "rate_limit_input_tokens_limit",
        "rate_limit_input_tokens_remaining",
        "rate_limit_input_tokens_reset_ms",
        "rate_limit_output_tokens_limit",
        "rate_limit_output_tokens_remaining",
        "rate_limit_output_tokens_reset_ms",
        "rate_limit_tokens_limit",
        "rate_limit_tokens_remaining",
        "rate_limit_tokens_reset_ms",
        "usage_5h_reset_ms",
        "usage_7d_reset_ms",
    ] {
        for value in [json!(0), json!(9_007_199_254_740_991u64)] {
            let wire = json!({field: value});
            let transport: Transport = serde_json::from_value(wire.clone()).unwrap();
            assert_eq!(serde_json::to_value(transport).unwrap(), wire);
        }
        for value in [
            json!(-1),
            json!(1.5),
            json!(true),
            json!("SECRET"),
            json!(9_007_199_254_740_992u64),
        ] {
            assert!(serde_json::from_value::<Transport>(json!({field: value})).is_err());
        }
    }
    for field in [
        "provider_error_type",
        "provider_error_reason",
        "error_body_state",
        "usage_5h_status",
        "usage_7d_status",
    ] {
        for value in [json!("SECRET"), json!(1), json!({"message":"SECRET"})] {
            assert!(serde_json::from_value::<Transport>(json!({field: value})).is_err());
        }
    }
}

#[derive(Clone, Default)]
struct Capture(Arc<Mutex<Vec<BTreeMap<String, String>>>>);
impl<S: tracing::Subscriber> Layer<S> for Capture {
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        #[derive(Default)]
        struct Fields(BTreeMap<String, String>);
        impl Visit for Fields {
            fn record_str(&mut self, field: &Field, value: &str) {
                self.0.insert(field.name().to_string(), value.to_string());
            }
            fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
                self.0
                    .insert(field.name().to_string(), format!("{value:?}"));
            }
        }
        let mut fields = Fields::default();
        event.record(&mut fields);
        self.0.lock().unwrap().push(fields.0);
    }
}

// Validate the real subprocess -> deserializer -> tracing path, including tool gating.
#[tokio::test]
async fn transport_wire_is_logged_safely_and_errors_never_release_tools() {
    for mode in [
        "success",
        "error",
        "refusal",
        "precreated_error",
        "malformed",
        "legacy",
    ] {
        let root = tempfile::tempdir().unwrap();
        let helper = root.path().join("transport.mjs");
        let transport = json!({
            "headers_status":200, "read_state":"pending", "read_count":2,
            "last_sse_event":"content_block_start", "content_block_kind":"thinking",
            "content_block_open":true, "parser_state":"pending", "finish_seen":false,
            "server_sha256":"a".repeat(64),
            "provider_stop_reason":"refusal", "provider_refusal_category":"cyber"
        });
        let script = format!(
            r#"
for await (const chunk of process.stdin) {{}}
let seq = 0;
const emit = frame => process.stdout.write(JSON.stringify({{protocol_version:1,request_id:'transport-test',seq:seq++,...frame}})+'\n');
const transport = {transport};
const progress = {{phase:'stream',elapsed_ms:10,network_idle_ms:1,event_idle_ms:2,bytes_received:50,event_count:1,last_event:'tool_call_args'}};
if ('{mode}' !== 'legacy') progress.transport = transport;
if ('{mode}' === 'malformed') transport.authorization='SECRET-token';
emit({{type:'progress',progress:{{...progress,phase:'headers',event_count:0,last_event:'none'}}}});
if ('{mode}' === 'precreated_error') emit({{type:'error',code:'provider_headers_timeout',progress:{{...progress,phase:'headers',event_count:0,last_event:'none'}}}});
else {{
emit({{type:'created'}});
emit({{type:'item_done',item:{{type:'function_call',name:'exec',call_id:'transport-call',arguments:'{{}}'}}}});
emit({{type:'progress',progress}});
if ('{mode}' === 'error') emit({{type:'error',code:'provider_stream_idle',progress}});
else if ('{mode}' === 'refusal') emit({{type:'error',code:'provider_refusal',progress}});
else emit({{type:'completed',progress}});
}}
"#
        );
        std::fs::write(&helper, script).unwrap();
        let runtime = std::env::var_os("AZRAEL_DEVIN_NODE")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("node"));
        let capture = Capture::default();
        let subscriber = tracing_subscriber::registry().with(capture.clone());
        let mut prompt = Prompt::default();
        prompt.tools = vec![super::super::tests::function("exec")].into();
        let (events, errors) = async {
            let mut stream = run_helper_with_policy(
                HelperRequest {
                    request_limit: RequestLimit::Default,
                    anthropic_thinking: false,
                    executable: &runtime,
                    helper: &helper,
                    codex_home: root.path(),
                    init: b"{}\n".to_vec(),
                    request: b"{}\n".to_vec(),
                    prompt,
                    request_id: "transport-test".to_string(),
                    cancellation: CancellationToken::new(),
                    turn_guard: (),
                },
                TimingPolicy {
                    idle: Duration::from_secs(2),
                    deadline: Duration::from_secs(4),
                    backoff: Duration::from_millis(10),
                    retry_idle: true,
                },
            )
            .await
            .unwrap();
            let mut events = Vec::new();
            let mut errors = Vec::new();
            while let Some(event) = stream.next().await {
                match event {
                    Ok(event) => events.push(event),
                    Err(error) => errors.push(error.to_string()),
                }
            }
            (events, errors)
        }
        .with_subscriber(subscriber)
        .await;
        let records = capture.0.lock().unwrap();
        let telemetry: Vec<_> = records
            .iter()
            .filter(|record| {
                record.get("event").map(String::as_str) == Some("native_inference_transport")
            })
            .collect();
        assert!(!format!("{records:?}{errors:?}").contains("SECRET"));
        if mode == "success" || mode == "legacy" {
            assert!(errors.is_empty());
            assert!(matches!(
                events.last(),
                Some(ResponseEvent::Completed { .. })
            ));
        } else {
            assert_eq!(events.len(), 0);
            assert_eq!(errors.len(), 1);
            if mode == "refusal" {
                assert_eq!(
                    errors[0],
                    "Fatal error: 모델 제공자가 응답을 거부했습니다. (provider_refusal)"
                );
            }
        }
        if mode == "malformed" || mode == "legacy" {
            assert!(telemetry.is_empty());
        } else {
            assert!(!telemetry.is_empty());
            for record in telemetry {
                assert_eq!(record.get("request_id").unwrap(), "transport-test");
                assert!(record.contains_key("outcome"));
                assert_eq!(
                    serde_json::from_str::<serde_json::Value>(record.get("transport").unwrap())
                        .unwrap(),
                    transport
                );
            }
        }
    }
}

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
            "server_sha256":"a".repeat(64)
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

use super::super::*;
use super::ToolDiagnostics;
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
fn diagnostics_roundtrip_and_reject_unbounded_fields() {
    for field in [
        "catalog_sha256",
        "raw_name_sha256",
        "parser_name_sha256",
        "declared_alias_sha256",
    ] {
        for value in [json!("a".repeat(64))] {
            let wire = json!({field: value});
            let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
            assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
        }
        for value in [
            json!("SECRET"),
            json!("A".repeat(64)),
            json!("a".repeat(63)),
            json!("g".repeat(64)),
            json!(42),
        ] {
            assert!(serde_json::from_value::<ToolDiagnostics>(json!({field: value})).is_err());
        }
    }
    for field in [
        "catalog_tool_count",
        "history_alias_count",
        "call_count",
        "raw_name_bytes",
        "parser_name_bytes",
        "args_delta_count",
        "args_empty_delta_count",
        "args_bytes",
        "sse_args_delta_count",
        "sse_args_empty_delta_count",
        "sse_args_bytes",
        "args_idle_ms",
        "call_elapsed_ms",
    ] {
        for value in [json!(0), json!(9_007_199_254_740_991u64)] {
            let wire = json!({field: value});
            let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
            assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
        }
        for value in [
            json!(true),
            json!(-1),
            json!(1.5),
            json!(9_007_199_254_740_992u64),
            json!("SECRET"),
        ] {
            assert!(serde_json::from_value::<ToolDiagnostics>(json!({field: value})).is_err());
        }
    }
    for field in ["call_open", "raw_parser_name_equal"] {
        for value in [json!(true), json!(false)] {
            let wire = json!({field: value});
            let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
            assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
        }
        for value in [json!(1), json!("true")] {
            assert!(serde_json::from_value::<ToolDiagnostics>(json!({field: value})).is_err());
        }
    }
    let wire = json!({"call_state": "none"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"call_state": "started"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"call_state": "receiving_args"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"call_state": "ended"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"call_state": "validated"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"call_state": "rejected"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    assert!(serde_json::from_value::<ToolDiagnostics>(json!({"call_state": "SECRET"})).is_err());
    let wire = json!({"name_style": "alias"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"name_style": "prefixed_alias"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"name_style": "original"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"name_style": "qualified"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"name_style": "missing"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"name_style": "oversized"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"name_style": "other"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    assert!(serde_json::from_value::<ToolDiagnostics>(json!({"name_style": "SECRET"})).is_err());
    let wire = json!({"name_match": "declared"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"name_match": "history_only"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"name_match": "current_original"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"name_match": "current_qualified"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"name_match": "missing"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"name_match": "unknown"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    assert!(serde_json::from_value::<ToolDiagnostics>(json!({"name_match": "SECRET"})).is_err());
    let wire = json!({"mapping_result": "none"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"mapping_result": "declared"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"mapping_result": "undeclared"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"mapping_result": "duplicate_id"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"mapping_result": "invalid_arguments"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"mapping_result": "invalid_custom_wrapper"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"mapping_result": "parallel_disabled"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"mapping_result": "validated"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    assert!(
        serde_json::from_value::<ToolDiagnostics>(json!({"mapping_result": "SECRET"})).is_err()
    );
    let wire = json!({"json_result": "not_checked"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"json_result": "valid_object"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"json_result": "not_object"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    let wire = json!({"json_result": "invalid_json"});
    let diagnostics: ToolDiagnostics = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(diagnostics).unwrap(), wire);
    assert!(serde_json::from_value::<ToolDiagnostics>(json!({"json_result": "SECRET"})).is_err());
    assert!(serde_json::from_value::<ToolDiagnostics>(json!({"raw_name": "SECRET"})).is_err());
    let empty: ToolDiagnostics = serde_json::from_value(json!({})).unwrap();
    assert_eq!(serde_json::to_value(empty).unwrap(), json!({}));
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
async fn tool_diagnostics_wire_is_logged_safely_and_errors_never_release_tools() {
    for mode in [
        "success",
        "error",
        "precreated_error",
        "malformed",
        "legacy",
    ] {
        let root = tempfile::tempdir().unwrap();
        let helper = root.path().join("tool_diagnostics.mjs");
        let tool_diagnostics = json!({
            "catalog_sha256":"a".repeat(64), "catalog_tool_count":1,
            "call_open":true, "call_state":"receiving_args", "name_match":"declared",
            "mapping_result":"declared", "args_bytes":2, "json_result":"not_checked"
        });
        let script = format!(
            r#"
for await (const chunk of process.stdin) {{}}
let seq = 0;
const emit = frame => process.stdout.write(JSON.stringify({{protocol_version:1,request_id:'tool_diagnostics-test',seq:seq++,...frame}})+'\n');
const tool_diagnostics = {tool_diagnostics};
const progress = {{phase:'stream',elapsed_ms:10,network_idle_ms:1,event_idle_ms:2,bytes_received:50,event_count:1,last_event:'tool_call_args'}};
if ('{mode}' !== 'legacy') progress.tool_diagnostics = tool_diagnostics;
if ('{mode}' === 'malformed') tool_diagnostics.authorization='SECRET-token';
emit({{type:'progress',progress:{{...progress,phase:'headers',event_count:0,last_event:'none'}}}});
if ('{mode}' === 'precreated_error') emit({{type:'error',code:'provider_headers_timeout',progress:{{...progress,phase:'headers',event_count:0,last_event:'none'}}}});
else {{
emit({{type:'created'}});
emit({{type:'item_done',item:{{type:'function_call',name:'exec',call_id:'tool_diagnostics-call',arguments:'{{}}'}}}});
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
                    request_limit: RequestLimit::Default,
                    anthropic_thinking: false,
                    executable: &runtime,
                    helper: &helper,
                    codex_home: root.path(),
                    init: b"{}\n".to_vec(),
                    request: b"{}\n".to_vec(),
                    prompt,
                    request_id: "tool_diagnostics-test".to_string(),
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
                record.get("event").map(String::as_str) == Some("native_inference_tool_diagnostics")
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
                assert_eq!(record.get("request_id").unwrap(), "tool_diagnostics-test");
                assert!(record.contains_key("outcome"));
                assert_eq!(
                    serde_json::from_str::<serde_json::Value>(
                        record.get("tool_diagnostics").unwrap()
                    )
                    .unwrap(),
                    tool_diagnostics
                );
            }
        }
    }
}

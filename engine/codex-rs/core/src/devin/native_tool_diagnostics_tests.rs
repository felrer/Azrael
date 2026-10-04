use super::*;
use codex_tools::FreeformTool;
use codex_tools::FreeformToolFormat;
use codex_tools::JsonSchema;
use codex_tools::ResponsesApiNamespace;
use codex_tools::ResponsesApiTool;
use pretty_assertions::assert_eq;
use std::sync::Arc;
use std::sync::Mutex;

fn function(schema: Value) -> ToolSpec {
    ToolSpec::Function(ResponsesApiTool {
        name: "run".into(),
        description: "private description".into(),
        strict: false,
        defer_loading: None,
        parameters: serde_json::from_value::<JsonSchema>(schema).unwrap(),
        output_schema: None,
    })
}

#[test]
fn hashes_track_actual_ordered_catalog_and_schema() {
    let a = function(json!({"type":"object", "required":["undeclared"]}));
    let b = function(json!({"type":"object", "required":["changed"]}));
    assert_eq!(fingerprint(&a), fingerprint(&a.clone()));
    assert_ne!(fingerprint(&a), fingerprint(&b));
    let ToolSpec::Function(a_tool) = &a else {
        unreachable!()
    };
    let ToolSpec::Function(b_tool) = &b else {
        unreachable!()
    };
    assert_ne!(
        fingerprint(&a_tool.parameters),
        fingerprint(&b_tool.parameters)
    );
    assert_ne!(
        fingerprint(&vec![a.clone(), b.clone()]),
        fingerprint(&vec![b, a])
    );
}

#[test]
fn basic_checks_preserve_valid_advanced_schema_and_undeclared_required() {
    let value = json!({"$ref":"https://private.invalid/schema", "type":["object","null"],
        "required":["undeclared"], "properties":{"anything":true},
        "$defs":{"x":{"oneOf":[false,{"const":"private secret", "if":{}, "then":{}}]}},
        "additionalProperties":false, "unevaluatedProperties":false});
    let mut checks = Checks::default();
    checks.walk(&value, "$", 0);
    assert!(checks.issues.is_empty());
    assert!(!checks.traversal_truncated);
}

#[test]
fn invalid_checks_emit_only_fixed_codes_and_hashed_paths() {
    let secret = "Bearer extremely-private-token";
    let value = json!({"properties":{secret:{"type":secret, "required":[secret,secret],
        "items":secret,"additionalProperties":secret,"anyOf":secret,"oneOf":[secret]}}});
    let mut checks = Checks::default();
    checks.walk(&value, "$", 0);
    assert_eq!(checks.issues.len(), 6);
    let output = serde_json::to_string(&checks).unwrap();
    assert!(!output.contains(secret));
    assert!(output.contains(&format!("/properties/sha256:{}", hash(secret.as_bytes()))));
}

#[test]
fn traversal_and_issue_records_are_bounded() {
    let children: Vec<Value> = (0..MAX_NODES * 2).map(|_| json!({})).collect();
    let mut checks = Checks::default();
    checks.walk(&json!({"allOf":children}), "$", 0);
    assert_eq!(checks.visited_nodes, MAX_NODES);
    assert!(checks.traversal_truncated);
    let mut checks = Checks::default();
    checks.walk(&json!({"allOf": vec![json!("secret"); 100]}), "$", 0);
    assert_eq!(checks.issues.len(), MAX_ISSUES);
    assert!(checks.issues_truncated);
    let mut deep = json!({});
    for _ in 0..100 {
        deep = json!({"items":deep});
    }
    let mut checks = Checks::default();
    checks.walk(&deep, "$", 0);
    assert_eq!(checks.visited_nodes, MAX_DEPTH + 1);
    assert!(checks.traversal_truncated);
}

#[derive(Clone)]
struct Capture(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for Capture {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn capture(specs: &[ToolSpec]) -> String {
    let bytes = Arc::new(Mutex::new(Vec::new()));
    let writer = Capture(bytes.clone());
    let subscriber = tracing_subscriber::fmt()
        .without_time()
        .with_ansi(false)
        .with_writer(move || writer.clone())
        .finish();
    tracing::subscriber::with_default(subscriber, || {
        let span = tracing::info_span!("turn", correlation = "test-turn");
        let _guard = span.enter();
        log_catalog(specs, "request-test", "thread-test", "turn-test");
    });
    String::from_utf8(bytes.lock().unwrap().clone()).unwrap()
}

#[test]
fn actual_sink_captures_nested_custom_fields_correlation_and_no_secrets() {
    let secret = "sk-private-super-secret-key";
    let custom = FreeformTool {
        name: secret.into(),
        description: secret.into(),
        defer_loading: None,
        format: FreeformToolFormat {
            r#type: "grammar".into(),
            syntax: "lark".into(),
            definition: secret.into(),
        },
    };
    let ToolSpec::Function(nested_function) =
        function(json!({"type":"object", "required":[secret,secret]}))
    else {
        unreachable!()
    };
    let specs = vec![ToolSpec::Namespace(ResponsesApiNamespace {
        name: "functions".into(),
        description: secret.into(),
        tools: vec![
            ResponsesApiNamespaceTool::Custom(custom.clone()),
            ResponsesApiNamespaceTool::Function(nested_function.clone()),
        ],
    })];
    let output = capture(&specs);
    assert!(output.contains("native_tool_catalog"));
    assert!(output.contains("native_tool_schema"));
    assert!(output.contains("test-turn"));
    for id in ["request-test", "thread-test", "turn-test"] {
        assert!(output.contains(id));
    }
    assert!(output.contains("namespace=functions"));
    assert!(output.contains("kind=\"custom\""));
    assert!(output.contains(&fingerprint(&custom_schema()).unwrap().1));
    assert!(
        output.contains(
            &fingerprint(&serde_json::to_value(&custom.format).unwrap())
                .unwrap()
                .1
        )
    );
    assert!(output.contains(&fingerprint(&nested_function.parameters).unwrap().1));
    assert!(output.contains("invalid_required"));
    assert_eq!(output.matches("native_tool_schema").count(), 2);
    assert!(!output.contains(secret));
    assert!(!output.contains("preserve code"));
}

#[test]
fn actual_sink_limits_records_but_hashes_entire_catalog() {
    let mut specs = vec![function(json!({"type":"object"})); MAX_TOOLS + 10];
    let output = capture(&specs);
    assert_eq!(output.matches("native_tool_schema").count(), MAX_TOOLS);
    assert!(output.contains("omitted_tools=10"));
    assert!(output.contains(&fingerprint(&specs).unwrap().1));
    specs[MAX_TOOLS] = function(json!({"type":"string"}));
    assert!(capture(&specs).contains(&fingerprint(&specs).unwrap().1));
}

#[test]
fn credential_and_url_shaped_identifiers_are_hashed() {
    for text in [
        "sk-private",
        "api_key",
        "Bearer abc",
        "https://private.invalid",
        "ghp_abc",
        "a012345678901234567890123456789",
    ] {
        assert_eq!(label(text), format!("sha256:{}", hash(text.as_bytes())));
    }
    assert_eq!(label("file_search"), "file_search");
}

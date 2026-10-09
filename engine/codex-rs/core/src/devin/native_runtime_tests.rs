use super::state::ExistingAccountBinding;
use super::*;
use codex_protocol::models::MessagePhase;
use codex_tools::FreeformTool;
use codex_tools::FreeformToolFormat;
use codex_tools::ResponsesApiTool;
use std::path::Path;
use std::path::PathBuf;
use std::time::Duration;

const TEST_MODEL_ID: &str = "swe-2-high";

#[tokio::test]
async fn helper_failures_preserve_precise_client_error_categories() {
    use codex_protocol::protocol::CodexErrorInfo;
    use futures::StreamExt;
    use pretty_assertions::assert_eq;

    let root = tempfile::tempdir().unwrap();
    let runtime = std::env::var_os("AZRAEL_DEVIN_NODE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("node"));
    let mut messages = Vec::new();
    for (code, expected) in [
        ("provider_usage_limit", CodexErrorInfo::UsageLimitExceeded),
        ("provider_rate_limit", CodexErrorInfo::RateLimitExceeded),
        ("provider_http_429", CodexErrorInfo::Other),
        ("provider_failure", CodexErrorInfo::Other),
        ("provider_usage_limit!", CodexErrorInfo::Other),
        ("future_provider_failure", CodexErrorInfo::Other),
    ] {
        let helper = root.path().join("classification.mjs");
        let encoded_code = serde_json::to_string(code).unwrap();
        std::fs::write(&helper, format!(r#"
for await (const chunk of process.stdin) {{}}
let seq = 0;
const emit = frame => process.stdout.write(JSON.stringify({{protocol_version:1, request_id:'classification-test', seq:seq++, ...frame}})+'\n');
emit({{type:'created'}});
emit({{type:'item_done',item:{{type:'function_call',name:'exec',call_id:'pending',arguments:'{{}}'}}}});
emit({{type:'error',code:{encoded_code}}});
process.exitCode = 1;
"#)).unwrap();
        let mut prompt = Prompt::default();
        prompt.tools = vec![function("exec")].into();
        let mut stream = run_helper(HelperRequest {
            anthropic_thinking: false,
            executable: &runtime,
            helper: &helper,
            codex_home: root.path(),
            init: b"{}\n".to_vec(),
            request: b"{}\n".to_vec(),
            prompt,
            request_id: "classification-test".to_string(),
            cancellation: CancellationToken::new(),
            turn_guard: (),
        })
        .await
        .unwrap();
        let error = stream
            .next()
            .await
            .unwrap()
            .expect_err("failed requests must not release tools");
        assert_eq!(error.to_codex_protocol_error(), expected);
        assert_eq!(
            error.retry_delay(1).is_some(),
            code == "provider_rate_limit"
        );
        let event = error.to_error_event(/*message_prefix*/ None);
        assert_eq!(event.codex_error_info, Some(expected));
        if messages.len() < 3 {
            messages.push(event.message);
        } else {
            assert!(event.message.starts_with("미분류 오류:"));
        }
        assert!(stream.next().await.is_none());
    }
    insta::assert_snapshot!(messages.join("\n"), @"
    You’ve hit your usage limit. Try again later.
    rate limit exceeded: Provider request rate limit reached. Try again later.
    미분류 오류: native inference helper failed (provider_http_429)
    ");
}

// Exercise the actual JSONL subprocess boundary, including completion buffering.
#[tokio::test]
async fn progress_frames_never_release_tools_before_successful_completion() {
    use futures::StreamExt;
    for mode in ["success", "malformed", "error", "exit"] {
        let root = tempfile::tempdir().unwrap();
        let helper = root.path().join("progress.mjs");
        let script = r#"
for await (const chunk of process.stdin) {}
let seq = 0;
const emit = frame => process.stdout.write(JSON.stringify({protocol_version:1, request_id:'progress-test', seq:seq++, ...frame})+'\n');
const progress = {phase:'stream',elapsed_ms:10,network_idle_ms:1,event_idle_ms:2,bytes_received:50,event_count:1,last_event:'tool_call_args'};
emit({type:'created'});
emit({type:'item_done',item:{type:'function_call',name:'exec',call_id:'call-progress',arguments:'{}'}});
emit({type:'progress',progress: MODE === 'malformed' ? {...progress, private_text:'forbidden'} : progress});
if (MODE === 'error') emit({type:'error',code:'provider_stream_idle',progress});
else emit({type:'completed',progress});
if (MODE === 'exit') process.exitCode=1;
"#.replace("MODE", &format!("{mode:?}"));
        std::fs::write(&helper, script).unwrap();
        let runtime = std::env::var_os("AZRAEL_DEVIN_NODE")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("node"));
        let mut prompt = Prompt::default();
        prompt.tools = vec![function("exec")].into();
        let mut stream = run_helper(HelperRequest {
            anthropic_thinking: false,
            executable: &runtime,
            helper: &helper,
            codex_home: root.path(),
            init: b"{}\n".to_vec(),
            request: b"{}\n".to_vec(),
            prompt,
            request_id: "progress-test".to_string(),
            cancellation: CancellationToken::new(),
            turn_guard: (),
        })
        .await
        .unwrap();
        let mut events = Vec::new();
        let mut failed = false;
        while let Some(event) = stream.next().await {
            match event {
                Ok(event) => events.push(event),
                Err(_) => failed = true,
            }
        }
        if mode == "success" {
            assert!(!failed);
            assert_eq!(events.len(), 3, "progress must not enter model history");
            assert!(matches!(
                events.last(),
                Some(ResponseEvent::Completed { .. })
            ));
        } else {
            assert!(failed, "{mode} must fail");
            assert!(events.is_empty(), "{mode} released buffered events");
        }
    }
}

pub(super) fn function(name: &str) -> ToolSpec {
    ToolSpec::Function(ResponsesApiTool {
        name: name.to_string(),
        description: String::new(),
        strict: false,
        defer_loading: None,
        parameters: codex_tools::JsonSchema::default(),
        output_schema: None,
    })
}

fn freeform(name: &str) -> ToolSpec {
    ToolSpec::Freeform(FreeformTool {
        name: name.to_string(),
        description: String::new(),
        defer_loading: None,
        format: FreeformToolFormat {
            r#type: "text".to_string(),
            syntax: String::new(),
            definition: String::new(),
        },
    })
}

#[test]
fn tool_catalog_rejects_unknown_kind_and_duplicate_call_ids() {
    let catalog = ToolCatalog::from_specs(&[function("exec"), freeform("patch")]).unwrap();
    let mut calls = HashSet::new();
    let valid = ResponseItem::FunctionCall {
        id: None,
        name: "exec".to_string(),
        namespace: None,
        arguments: "{}".to_string(),
        encrypted_function_args: None,
        call_id: "call-1".to_string(),
        internal_chat_message_metadata_passthrough: None,
    };
    catalog.verify(&valid, &mut calls).unwrap();
    assert!(catalog.verify(&valid, &mut calls).is_err());
    let wrong_kind = ResponseItem::CustomToolCall {
        id: None,
        status: Some("completed".to_string()),
        call_id: "call-2".to_string(),
        name: "exec".to_string(),
        namespace: None,
        input: "text".to_string(),
        internal_chat_message_metadata_passthrough: None,
    };
    assert!(catalog.verify(&wrong_kind, &mut calls).is_err());
}

#[test]
fn function_arguments_must_be_json_objects() {
    let catalog = ToolCatalog::from_specs(&[function("exec")]).unwrap();
    let mut calls = HashSet::new();
    let item = ResponseItem::FunctionCall {
        id: None,
        name: "exec".to_string(),
        namespace: None,
        arguments: "[]".to_string(),
        encrypted_function_args: None,
        call_id: "call-array".to_string(),
        internal_chat_message_metadata_passthrough: None,
    };
    assert!(catalog.verify(&item, &mut calls).is_err());
}

#[test]
fn historical_call_ids_cover_executable_items_without_counting_outputs() {
    let call = ResponseItem::FunctionCall {
        id: None,
        name: "exec".to_string(),
        namespace: None,
        arguments: "{}".to_string(),
        encrypted_function_args: None,
        call_id: "prior-call".to_string(),
        internal_chat_message_metadata_passthrough: None,
    };
    let ids = historical_call_ids(&[call]);
    assert_eq!(ids, HashSet::from(["prior-call".to_string()]));
}

#[test]
fn item_added_accepts_only_assistant_output_text() {
    let catalog = ToolCatalog::default();
    let mut calls = HashSet::new();
    let item = ResponseItem::Message {
        id: None,
        role: "assistant".to_string(),
        content: vec![ContentItem::OutputText {
            text: "hello".to_string(),
        }],
        phase: Some(MessagePhase::FinalAnswer),
        internal_chat_message_metadata_passthrough: None,
    };
    catalog.verify(&item, &mut calls).unwrap();
}

#[test]
fn helper_text_lifecycle_shape_preserves_message_identity() {
    let frame: OutputFrame = serde_json::from_value(serde_json::json!({
        "protocol_version": PROTOCOL_VERSION,
        "request_id": "request",
        "seq": 1,
        "type": "item_added",
        "item": {
            "type": "message",
            "id": "msg_request_0",
            "role": "assistant",
            "content": [{"type": "output_text", "text": ""}]
        }
    }))
    .unwrap();
    let item = frame.item.unwrap();
    assert!(matches!(
        item,
        ResponseItem::Message {
            id: Some(_),
            role,
            content,
            ..
        } if role == "assistant"
            && matches!(content.as_slice(), [ContentItem::OutputText { text }] if text.is_empty())
    ));
}

#[test]
fn runtime_marker_prevents_runtime_reinterpretation() {
    let root = tempfile::tempdir().unwrap();
    let cwd = root.path().join("work");
    let binding = RuntimeBinding {
        model_id: TEST_MODEL_ID,
        cwd: &cwd,
        credential_scope: "sha1:account",
        account_id: None,
    };
    pin_native_runtime(root.path(), "thread", binding.clone()).unwrap();
    pin_native_runtime(root.path(), "thread", binding).unwrap();
    assert!(pin_acp_runtime(root.path(), "thread").is_err());
}

#[test]
fn runtime_marker_rejects_changed_native_binding() {
    let root = tempfile::tempdir().unwrap();
    let cwd = root.path().join("work");
    pin_native_runtime(
        root.path(),
        "thread",
        RuntimeBinding {
            model_id: TEST_MODEL_ID,
            cwd: &cwd,
            credential_scope: "sha1:first",
            account_id: Some("managed-first"),
        },
    )
    .unwrap();
    assert!(
        pin_native_runtime(
            root.path(),
            "thread",
            RuntimeBinding {
                model_id: TEST_MODEL_ID,
                cwd: &cwd,
                credential_scope: "sha1:second",
                account_id: Some("managed-first"),
            },
        )
        .is_err()
    );
}

#[test]
fn runtime_marker_distinguishes_legacy_cli_and_managed_accounts() {
    let root = tempfile::tempdir().unwrap();
    let sessions = root.path().join("azrael/devin/sessions");
    std::fs::create_dir_all(&sessions).unwrap();
    std::fs::write(
        sessions.join("legacy.runtime.json"),
        br#"{"version":2,"thread_id":"legacy","runtime":"native","model_id":"swe-2-high","cwd":"work","credential_scope":"sha1:legacy"}"#,
    )
    .unwrap();
    assert_eq!(
        existing_account_binding(root.path(), "legacy").unwrap(),
        ExistingAccountBinding::Cli
    );

    std::fs::write(
        sessions.join("managed.runtime.json"),
        br#"{"version":2,"thread_id":"managed","runtime":"native","model_id":"swe-2-high","cwd":"work","credential_scope":"sha1:managed","account_id":"account-1"}"#,
    )
    .unwrap();
    assert_eq!(
        existing_account_binding(root.path(), "managed").unwrap(),
        ExistingAccountBinding::Managed("account-1".to_string())
    );
    assert_eq!(
        existing_account_binding(root.path(), "new").unwrap(),
        ExistingAccountBinding::NoMarker
    );
}

#[test]
fn runtime_marker_rejects_changed_managed_account_with_same_credential() {
    let root = tempfile::tempdir().unwrap();
    let cwd = root.path().join("work");
    pin_native_runtime(
        root.path(),
        "thread",
        RuntimeBinding {
            model_id: TEST_MODEL_ID,
            cwd: &cwd,
            credential_scope: "sha1:shared",
            account_id: Some("account-1"),
        },
    )
    .unwrap();
    assert!(
        pin_native_runtime(
            root.path(),
            "thread",
            RuntimeBinding {
                model_id: TEST_MODEL_ID,
                cwd: &cwd,
                credential_scope: "sha1:shared",
                account_id: Some("account-2"),
            },
        )
        .is_err()
    );
}

#[test]
fn provider_account_response_resolves_selected_exact_none_and_error() {
    let selected = accounts::decode_response(
        br#"{"id":"request","type":"result","value":{"api_key":"secret","api_server_url":"https://example.test","account_id":"account-1"}}"#,
        "request",
        None,
    )
    .unwrap()
    .unwrap();
    assert_eq!(selected.account_id, "account-1");
    assert!(
        accounts::decode_response(
            br#"{"id":"request","type":"result","value":{"api_key":"secret","api_server_url":"https://example.test","account_id":"account-1"}}"#,
            "request",
            Some("account-1"),
        )
        .is_ok()
    );
    assert!(
        accounts::decode_response(
            br#"{"id":"request","type":"result","value":{"api_key":"secret","api_server_url":"https://example.test","account_id":"account-1"}}"#,
            "request",
            Some("account-2"),
        )
        .is_err()
    );
    assert!(
        accounts::decode_response(
            br#"{"id":"request","type":"result","value":null}"#,
            "request",
            None,
        )
        .unwrap()
        .is_none()
    );
    assert!(
        accounts::decode_response(
            br#"{"id":"request","type":"error","error":"safe"}"#,
            "request",
            None,
        )
        .is_err()
    );
}

#[tokio::test]
async fn provider_account_helper_process_enforces_protocol_and_failure_modes() {
    let root = tempfile::tempdir().unwrap();
    let capture = root.path().join("request.json");
    let helper = write_provider_account_helper(
        root.path(),
        &capture,
        FakeProviderResponse::Json(
            r#"{"id":"request","type":"result","value":{"api_key":"secret","api_server_url":"https://example.test","account_id":"account-1"}}"#,
        ),
    );
    let config = accounts::HelperConfig {
        helper,
        bun: fake_provider_runtime(),
    };
    let selected = accounts::request_credential_with(
        root.path(),
        &config,
        Some("account-1"),
        "request",
        Duration::from_secs(5),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(selected.account_id, "account-1");
    let request: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&capture).unwrap()).unwrap();
    assert_eq!(
        request,
        serde_json::json!({
            "protocol": 1,
            "id": "request",
            "action": "credential",
            "providerId": "devin",
            "accountId": "account-1",
        })
    );

    for response in [
        r#"{"id":"wrong","type":"result","value":null}"#,
        r#"{"id":"request","type":"error","error":"safe"}"#,
    ] {
        let helper = write_provider_account_helper(
            root.path(),
            &capture,
            FakeProviderResponse::Json(response),
        );
        let config = accounts::HelperConfig {
            helper,
            bun: fake_provider_runtime(),
        };
        assert!(
            accounts::request_credential_with(
                root.path(),
                &config,
                None,
                "request",
                Duration::from_secs(5),
            )
            .await
            .is_err()
        );
    }

    let helper = write_provider_account_helper(
        root.path(),
        &capture,
        FakeProviderResponse::Json(r#"{"id":"request","type":"result","value":null}"#),
    );
    let config = accounts::HelperConfig {
        helper,
        bun: fake_provider_runtime(),
    };
    assert!(
        accounts::request_credential_with(
            root.path(),
            &config,
            None,
            "request",
            Duration::from_secs(5),
        )
        .await
        .unwrap()
        .is_none()
    );

    let helper = write_provider_account_helper(root.path(), &capture, FakeProviderResponse::Delay);
    let config = accounts::HelperConfig {
        helper,
        bun: fake_provider_runtime(),
    };
    assert!(
        accounts::request_credential_with(
            root.path(),
            &config,
            None,
            "request",
            Duration::from_millis(50),
        )
        .await
        .is_err()
    );
}

#[test]
fn managed_recovery_marker_commits_latest_binding_and_rejects_stale_source() {
    let root = tempfile::tempdir().unwrap();
    let cwd = root.path().join("work");
    pin_native_runtime(
        root.path(),
        "thread",
        RuntimeBinding {
            model_id: "swe-2-high",
            cwd: &cwd,
            credential_scope: "sha1:source",
            account_id: Some("a"),
        },
    )
    .unwrap();
    let snapshot = state::recovery_snapshot(root.path(), "thread").unwrap();
    state::replace_managed_binding(
        root.path(),
        "thread",
        &snapshot,
        "a",
        "b",
        "sha1:destination",
    )
    .unwrap();
    assert_eq!(
        existing_account_binding(root.path(), "thread").unwrap(),
        ExistingAccountBinding::Managed("b".into())
    );
    // Restart validates the latest credential, while a stale recovery cannot undo it.
    pin_native_runtime(
        root.path(),
        "thread",
        RuntimeBinding {
            model_id: "swe-2-high",
            cwd: &cwd,
            credential_scope: "sha1:destination",
            account_id: Some("b"),
        },
    )
    .unwrap();
    assert!(
        state::replace_managed_binding(root.path(), "thread", &snapshot, "a", "c", "sha1:other")
            .is_err()
    );
    assert_eq!(
        existing_account_binding(root.path(), "thread").unwrap(),
        ExistingAccountBinding::Managed("b".into())
    );
    // A fork inherits b and thereafter owns its own marker.
    pin_native_runtime(
        root.path(),
        "fork",
        RuntimeBinding {
            model_id: "swe-2-high",
            cwd: &cwd,
            credential_scope: "sha1:destination",
            account_id: Some("b"),
        },
    )
    .unwrap();
    let fork_snapshot = state::recovery_snapshot(root.path(), "fork").unwrap();
    state::replace_managed_binding(root.path(), "fork", &fork_snapshot, "b", "c", "sha1:fork")
        .unwrap();
    assert_eq!(
        existing_account_binding(root.path(), "thread").unwrap(),
        ExistingAccountBinding::Managed("b".into())
    );
}

#[tokio::test]
async fn recovery_credential_requires_consent_and_preserves_null_or_revoked_outcomes() {
    let root = tempfile::tempdir().unwrap();
    let capture = root.path().join("request.json");
    let cancellation = CancellationToken::new();
    let responses = [
        r#"{"id":"request","type":"result","value":{"api_key":"secret","api_server_url":"https://example.test","account_id":"account-1"}}"#,
        r#"{"id":"request","type":"result","value":null}"#,
        r#"{"id":"request","type":"error","error":"permission revoked"}"#,
        r#"{"id":"request","type":"result","value":{"api_key":"secret","api_server_url":"https://example.test","account_id":"replaced-account"}}"#,
    ];
    for (index, response) in responses.iter().enumerate() {
        let helper = write_provider_account_helper(
            root.path(),
            &capture,
            FakeProviderResponse::Json(response),
        );
        let config = accounts::HelperConfig {
            helper,
            bun: fake_provider_runtime(),
        };
        let result = accounts::request_recovery_credential_with(
            root.path(),
            &config,
            "account-1",
            "request",
            Duration::from_secs(5),
            &cancellation,
        )
        .await;
        match index {
            0 => assert_eq!(result.unwrap().unwrap().account_id, "account-1"),
            1 => assert!(result.unwrap().is_none()),
            _ => assert!(result.is_err()),
        }
        let request: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&capture).unwrap()).unwrap();
        assert_eq!(
            request,
            serde_json::json!({
                "protocol": 1, "id": "request", "action": "credential", "providerId": "devin",
                "accountId": "account-1", "requireAutoSwitch": true,
            })
        );
    }
}

#[test]
fn managed_recovery_rejects_cli_marker() {
    let root = tempfile::tempdir().unwrap();
    pin_native_runtime(
        root.path(),
        "thread",
        RuntimeBinding {
            model_id: "swe-2-high",
            cwd: root.path(),
            credential_scope: "sha1:cli",
            account_id: None,
        },
    )
    .unwrap();
    let snapshot = state::recovery_snapshot(root.path(), "thread").unwrap();
    assert!(
        state::replace_managed_binding(
            root.path(),
            "thread",
            &snapshot,
            "cli",
            "managed",
            "sha1:managed"
        )
        .is_err()
    );
    assert_eq!(
        existing_account_binding(root.path(), "thread").unwrap(),
        ExistingAccountBinding::Cli
    );
}

enum FakeProviderResponse<'a> {
    Json(&'a str),
    Delay,
}

#[tokio::test]
async fn provider_recovery_transport_cancels_running_helper() {
    let root = tempfile::tempdir().unwrap();
    let capture = root.path().join("request.json");
    let helper = write_provider_account_helper(root.path(), &capture, FakeProviderResponse::Delay);
    let cancellation = CancellationToken::new();
    let cancel = cancellation.clone();
    let runtime = fake_provider_runtime();
    let operation = crate::managed_account_recovery::helper_rpc(
        root.path(),
        &helper,
        &runtime,
        serde_json::to_vec(&serde_json::json!({
            "protocol": 1, "id": "r", "action": "recoverAccount", "providerId": "devin",
            "threadId": "thread", "turnId": "turn", "model": "devin/swe-2-high",
            "excludedAccountIds": [], "expectedAccountId": "a",
        }))
        .unwrap(),
        Duration::from_secs(5),
        &cancellation,
    );
    let cancel_operation = async move {
        tokio::time::sleep(Duration::from_millis(30)).await;
        cancel.cancel();
    };
    let (result, _) = tokio::join!(operation, cancel_operation);
    assert!(matches!(
        result.unwrap_err().details(),
        CodexErrorDetails::Interrupted
    ));
}

#[cfg(windows)]
fn fake_provider_runtime() -> PathBuf {
    PathBuf::from("powershell.exe")
}

#[cfg(not(windows))]
fn fake_provider_runtime() -> PathBuf {
    PathBuf::from("/bin/sh")
}

#[cfg(windows)]
fn write_provider_account_helper(
    root: &Path,
    capture: &Path,
    response: FakeProviderResponse<'_>,
) -> PathBuf {
    let helper = root.join(format!("helper-{}.cmd", uuid::Uuid::new_v4()));
    let action = match response {
        FakeProviderResponse::Json(json) => format!("echo {json}"),
        FakeProviderResponse::Delay => "ping -n 3 127.0.0.1 >nul".to_string(),
    };
    std::fs::write(
        &helper,
        format!(
            "@echo off\nset /p line=\n>\"{}\" echo %line%\n{action}\n",
            capture.display()
        ),
    )
    .unwrap();
    helper
}

#[cfg(not(windows))]
fn write_provider_account_helper(
    root: &Path,
    capture: &Path,
    response: FakeProviderResponse<'_>,
) -> PathBuf {
    let helper = root.join(format!("helper-{}.sh", uuid::Uuid::new_v4()));
    let capture = capture.display().to_string().replace('\'', "'\\''");
    let action = match response {
        FakeProviderResponse::Json(json) => {
            format!("printf '%s\\n' '{}'", json.replace('\'', "'\\''"))
        }
        FakeProviderResponse::Delay => "sleep 2".to_string(),
    };
    std::fs::write(
        &helper,
        format!("IFS= read -r line\nprintf '%s' \"$line\" > '{capture}'\n{action}\n"),
    )
    .unwrap();
    helper
}

#[test]
fn existing_acp_sidecar_prevents_native_pin() {
    let root = tempfile::tempdir().unwrap();
    let sessions = root.path().join("azrael/devin/sessions");
    std::fs::create_dir_all(&sessions).unwrap();
    std::fs::write(sessions.join("thread.json"), b"{}").unwrap();
    assert!(
        pin_native_runtime(
            root.path(),
            "thread",
            RuntimeBinding {
                model_id: TEST_MODEL_ID,
                cwd: root.path(),
                credential_scope: "sha1:account",
                account_id: None,
            },
        )
        .is_err()
    );
}

#[test]
fn token_usage_rejects_negative_and_inconsistent_totals() {
    let negative = Usage {
        input_tokens: -1,
        output_tokens: 1,
        cached_input_tokens: 0,
        cache_write_input_tokens: 0,
        cache_write_1h_input_tokens: None,
        estimated: false,
        reasoning_output_tokens: 0,
        total_tokens: 0,
    };
    assert!(validate_usage(Some(&negative)).is_err());
    let inconsistent = Usage {
        input_tokens: 1,
        output_tokens: 1,
        cached_input_tokens: 0,
        cache_write_input_tokens: 0,
        cache_write_1h_input_tokens: None,
        estimated: false,
        reasoning_output_tokens: 0,
        total_tokens: 3,
    };
    assert!(validate_usage(Some(&inconsistent)).is_err());
}

#[test]
fn token_usage_cache_fields_default_and_sanitize_billing_counts() {
    let old = serde_json::json!({"input_tokens": 10, "output_tokens": 2, "total_tokens": 12});
    let usage: Usage = serde_json::from_value(old).unwrap();
    assert_eq!(usage.cache_write_input_tokens, 0);
    assert_eq!(usage.cache_write_1h_input_tokens, None);
    assert!(!usage.estimated);
    assert!(validate_usage(Some(&usage)).is_ok());
    let valid = serde_json::json!({
        "input_tokens": 10, "output_tokens": 2, "total_tokens": 12,
        "cached_input_tokens": 4, "cache_write_input_tokens": 6,
        "cache_write_1h_input_tokens": 2, "estimated": true
    });
    let usage: Usage = serde_json::from_value(valid.clone()).unwrap();
    assert!(validate_usage(Some(&usage)).is_ok());
    assert!(usage.estimated);
    for (field, value) in [
        ("cache_write_input_tokens", -1),
        ("cache_write_input_tokens", 7),
        ("cache_write_1h_input_tokens", -1),
        ("cache_write_1h_input_tokens", 7),
        ("reasoning_output_tokens", 3),
    ] {
        let mut malformed_billing = valid.clone();
        malformed_billing[field] = serde_json::json!(value);
        let usage: Usage = serde_json::from_value(malformed_billing).unwrap();
        assert!(validate_usage(Some(&usage)).is_ok(), "{field}={value}");
        assert!(usage.estimated, "{field}={value}");
        assert!(usage.cache_write_input_tokens >= 0);
        assert!(usage.cache_write_1h_input_tokens.is_none_or(|count| count >= 0));
    }
    let overflow: Usage = serde_json::from_value(serde_json::json!({
        "input_tokens": i64::MAX, "output_tokens": 1, "total_tokens": i64::MAX
    }))
    .unwrap();
    assert!(validate_usage(Some(&overflow)).is_ok());
    for field in [
        "input_tokens",
        "output_tokens",
        "cached_input_tokens",
        "reasoning_output_tokens",
    ] {
        let mut invalid_base = valid.clone();
        invalid_base[field] = serde_json::json!(-1);
        let usage: Usage = serde_json::from_value(invalid_base).unwrap();
        assert!(validate_usage(Some(&usage)).is_err());
    }
    for (field, value) in [
        ("cache_write_input_tokens", serde_json::json!("bad")),
        ("cache_write_1h_input_tokens", serde_json::json!(1.5)),
        ("estimated", serde_json::json!("bad")),
    ] {
        let mut malformed_billing = valid.clone();
        malformed_billing[field] = value;
        let usage: Usage = serde_json::from_value(malformed_billing).unwrap();
        assert!(validate_usage(Some(&usage)).is_ok());
        assert!(usage.estimated);
    }
}

#[test]
fn progress_telemetry_fields_are_optional_and_unknown_fields_rejected() {
    let required = serde_json::json!({
        "phase": "stream",
        "elapsed_ms": 10,
        "network_idle_ms": 1,
        "event_idle_ms": 2,
        "bytes_received": 50,
        "event_count": 1,
        "last_event": "text"
    });
    // Pre-telemetry helpers omit the new fields entirely.
    let progress: protocol::Progress = serde_json::from_value(required.clone()).unwrap();
    assert!(progress.phase_elapsed_ms.is_none());
    assert!(progress.first_byte_ms.is_none());
    assert!(progress.first_event_ms.is_none());
    assert!(progress.stdout_buffered_bytes.is_none());
    assert!(progress.stdout_backpressure_count.is_none());
    assert!(progress.frames_emitted.is_none());
    assert!(progress.output_bytes.is_none());

    let mut extended = required.clone();
    extended["phase_elapsed_ms"] = serde_json::json!(7);
    extended["first_byte_ms"] = serde_json::json!(8);
    extended["first_event_ms"] = serde_json::json!(9);
    extended["stdout_buffered_bytes"] = serde_json::json!(100);
    extended["stdout_backpressure_count"] = serde_json::json!(2);
    extended["frames_emitted"] = serde_json::json!(3);
    extended["output_bytes"] = serde_json::json!(400);
    let progress: protocol::Progress = serde_json::from_value(extended).unwrap();
    assert_eq!(progress.phase_elapsed_ms, Some(7));
    assert_eq!(progress.frames_emitted, Some(3));
    assert_eq!(progress.output_bytes, Some(400));

    let mut unknown = required;
    unknown["private_text"] = serde_json::json!("forbidden");
    assert!(serde_json::from_value::<protocol::Progress>(unknown).is_err());
}

#[test]
fn failure_diagnostics_allowlist_transport_codes_and_http_status() {
    let valid: protocol::FailureDiagnostics = serde_json::from_value(serde_json::json!({
        "transport_error": "stream_idle_timeout",
        "http_status": 503
    }))
    .unwrap();
    assert_eq!(valid.transport_error_code(), Some("stream_idle_timeout"));
    assert_eq!(valid.http_status_code(), Some(503));

    for (transport_error, http_status) in [
        ("raw provider detail with secrets", 200u64),
        ("stream_idle_timeout", 99u64),
        ("stream_idle_timeout", 600u64),
    ] {
        let diagnostics: protocol::FailureDiagnostics = serde_json::from_value(serde_json::json!({
            "transport_error": transport_error,
            "http_status": http_status
        }))
        .unwrap();
        if transport_error != "stream_idle_timeout" {
            assert_eq!(diagnostics.transport_error_code(), None);
        }
        if !(100..=599).contains(&http_status) {
            assert_eq!(diagnostics.http_status_code(), None);
        }
    }
}

#[test]
fn provider_rejection_diagnostics_validate_untrusted_fields() {
    let read = |value| serde_json::from_value::<protocol::FailureDiagnostics>(value).unwrap();
    let valid = read(serde_json::json!({
        "provider_error_code": "invalid_argument",
        "provider_error_source": "connect_trailer",
        "provider_trace_id": "0123456789abcdef",
        "provider_reason": "internal_error"
    }));
    assert_eq!(
        (
            valid.provider_error_code(),
            valid.provider_error_source(),
            valid.provider_trace_id(),
            valid.provider_reason()
        ),
        (
            Some("invalid_argument"),
            Some("connect_trailer"),
            Some("0123456789abcdef"),
            Some("internal_error")
        )
    );
    for trace in [
        "a".repeat(15),
        "a".repeat(65),
        "A".repeat(16),
        "SECRET-trace-123".to_string(),
    ] {
        let hostile = read(serde_json::json!({
            "provider_error_code": "invalid_argument SECRET",
            "provider_error_source": "https://SECRET.example",
            "provider_trace_id": trace,
            "provider_reason": "internal_error: SECRET"
        }));
        assert_eq!(
            (
                hostile.provider_error_code(),
                hostile.provider_error_source(),
                hostile.provider_trace_id(),
                hostile.provider_reason()
            ),
            (None, None, None, None)
        );
    }
    let legacy = read(serde_json::json!({"http_status": 400}));
    assert_eq!(
        (
            legacy.provider_error_code(),
            legacy.provider_error_source(),
            legacy.provider_trace_id(),
            legacy.provider_reason()
        ),
        (None, None, None, None)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn incomplete_diagnostics_survive_spawn_and_persist_under_the_thread() {
    use codex_state::LogQuery;
    use codex_state::SqliteConfig;
    use codex_state::StateRuntime;
    use codex_utils_absolute_path::AbsolutePathBuf;
    use tracing::Instrument;
    use tracing_subscriber::Layer;
    use tracing_subscriber::layer::SubscriberExt;

    #[derive(Default)]
    struct TestLogFailureReporter(std::sync::Mutex<String>);

    impl codex_state::LogWriteFailureReporter for TestLogFailureReporter {
        fn report_failure(&self, diagnostic: &str) {
            self.0
                .lock()
                .expect("diagnostic mutex poisoned")
                .push_str(diagnostic);
        }
    }

    let root = tempfile::tempdir().unwrap();
    let state = StateRuntime::init(
        SqliteConfig::new_for_testing(AbsolutePathBuf::try_from(root.path()).unwrap()),
        "test-provider".to_string(),
    )
    .await
    .unwrap();
    let layer =
        codex_state::log_db::start(state.clone(), Arc::new(TestLogFailureReporter::default()));
    let subscriber = tracing_subscriber::registry().with(
        layer
            .clone()
            .with_filter(codex_state::log_db::default_filter()),
    );
    let runtime = std::env::var_os("AZRAEL_DEVIN_NODE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("node"));
    async {
        for (request_id, diagnostics) in [
            ("finish-preserved", serde_json::json!({
                "event_count": 3, "last_event": "finish", "finish_reason": "length",
                "provider_stop_reason": 3, "pending_tool_count": 1, "active_tool_call": true
            })),
            ("finish-private", serde_json::json!({
                "finish_reason": "SECRET-finish-123", "provider_stop_reason": 99,
                "pending_tool_count": 0, "active_tool_call": false
            })),
            ("provider-preserved", serde_json::json!({
                "http_status": 400, "provider_error_code": "invalid_argument",
                "provider_error_source": "connect_trailer",
                "provider_trace_id": "0123456789abcdef0123456789abcdef",
                "provider_reason": "internal_error"
            })),
            ("provider-private", serde_json::json!({
                "http_status": 400, "provider_error_code": "SECRET-provider-123",
                "provider_error_source": "SECRET-source-123",
                "provider_trace_id": "SECRET-trace-123",
                "provider_reason": "SECRET-reason-123"
            })),
        ] {
            let code = if request_id.starts_with("provider-") {
                "provider_http_400"
            } else {
                "provider_incomplete"
            };
            let script = format!(r#"
for await (const chunk of process.stdin) {{}}
let seq = 0;
const emit = frame => process.stdout.write(JSON.stringify({{protocol_version:1, request_id:'{request_id}', seq:seq++, ...frame}})+'\n');
emit({{type:'created'}});
emit({{type:'error',code:'{code}',diagnostics:{diagnostics}}});
process.exitCode = 1;
"#);
            let span = tracing::info_span!("diagnostic_turn", thread_id = "finish-thread", turn_id = "finish-turn");
            assert!(run_consume_case(root.path(), &runtime, request_id, &script, CancellationToken::new())
                .instrument(span).await);
        }
    }
    .with_subscriber(subscriber)
    .await;
    layer.flush().await;
    let rows = state
        .query_logs(&LogQuery {
            thread_ids: vec!["finish-thread".to_string()],
            ..Default::default()
        })
        .await
        .unwrap();
    for request_id in [
        "finish-preserved",
        "finish-private",
        "provider-preserved",
        "provider-private",
    ] {
        let messages: Vec<&str> = rows
            .iter()
            .filter_map(|row| row.message.as_deref())
            .filter(|message| message.contains(request_id))
            .collect();
        for event in [
            "native_inference_helper_failed",
            "native_inference_finished",
        ] {
            assert!(
                messages.iter().any(|message| message.contains(event)),
                "missing persisted {event} for {request_id}"
            );
        }
        let failure = messages
            .iter()
            .find(|message| message.contains("native_inference_helper_failed"))
            .unwrap();
        assert!(failure.contains("finish-turn"));
        if request_id == "finish-preserved" {
            for field in [
                "finish_reason=Some(\"length\")",
                "provider_stop_reason=Some(3)",
                "pending_tool_count=Some(1)",
                "active_tool_call=Some(true)",
                "event_count=Some(3)",
            ] {
                assert!(failure.contains(field), "missing {field}: {failure}");
            }
        } else if request_id == "provider-preserved" {
            for field in [
                "code=\"provider_http_400\"",
                "http_status=Some(400)",
                "provider_error_code=Some(\"invalid_argument\")",
                "provider_error_source=Some(\"connect_trailer\")",
                "provider_trace_id=Some(\"0123456789abcdef0123456789abcdef\")",
                "provider_reason=Some(\"internal_error\")",
            ] {
                assert!(failure.contains(field), "missing {field}: {failure}");
            }
        } else {
            assert!(failure.contains("finish_reason=None"));
            assert!(failure.contains("provider_stop_reason=None"));
            if request_id == "provider-private" {
                for field in [
                    "provider_error_code",
                    "provider_error_source",
                    "provider_trace_id",
                    "provider_reason",
                ] {
                    assert!(failure.contains(&format!("{field}=None")));
                }
            }
        }
    }
    assert!(rows.iter().all(|row| {
        !row.message
            .as_deref()
            .unwrap_or_default()
            .contains("SECRET-")
    }));
}

fn native_log_lines(request_id: &str) -> Vec<String> {
    let buffer = tracing_test::internal::global_buf().lock().unwrap();
    String::from_utf8_lossy(&buffer)
        .lines()
        .filter(|line| line.contains(request_id))
        .map(str::to_string)
        .collect()
}

fn native_logs() -> String {
    let buffer = tracing_test::internal::global_buf().lock().unwrap();
    String::from_utf8_lossy(&buffer).to_string()
}

async fn run_consume_case(
    root: &Path,
    runtime: &Path,
    request_id: &str,
    script: &str,
    cancellation: CancellationToken,
) -> bool {
    use futures::StreamExt;
    let helper = root.join(format!("{request_id}.mjs"));
    std::fs::write(&helper, script).unwrap();
    let mut stream = run_helper(HelperRequest {
        anthropic_thinking: false,
        executable: runtime,
        helper: &helper,
        codex_home: root,
        init: b"{}\n".to_vec(),
        request: b"{}\n".to_vec(),
        prompt: Prompt::default(),
        request_id: request_id.to_string(),
        cancellation,
        turn_guard: (),
    })
    .await
    .unwrap();
    let mut failed = false;
    while let Some(event) = stream.next().await {
        if event.is_err() {
            failed = true;
        }
    }
    failed
}

#[tokio::test]
#[tracing_test::traced_test]
async fn consume_failures_log_stable_structural_reasons_without_content() {
    let root = tempfile::tempdir().unwrap();
    let runtime = std::env::var_os("AZRAEL_DEVIN_NODE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("node"));
    let prelude = r#"
for await (const chunk of process.stdin) {}
let seq = 0;
const emit = frame => process.stdout.write(JSON.stringify({protocol_version:1, request_id:REQUEST, seq:seq++, ...frame})+'\n');
"#;

    // Malformed JSONL: raw bytes must never reach the log.
    let script = format!(
        "{}\nprocess.stdout.write('{{\"raw\":\"SENTINEL-raw-7f2a\"}}\\n');\n",
        prelude.replace("REQUEST", "'diag-malformed'")
    );
    assert!(
        run_consume_case(
            root.path(),
            &runtime,
            "diag-malformed",
            &script,
            CancellationToken::new(),
        )
        .await
    );

    // EOF before a terminal frame.
    let script = format!(
        "{}\nemit({{type:'created'}});\n",
        prelude.replace("REQUEST", "'diag-eof'")
    );
    assert!(
        run_consume_case(
            root.path(),
            &runtime,
            "diag-eof",
            &script,
            CancellationToken::new(),
        )
        .await
    );

    // Terminal frame followed by a nonzero child exit.
    let script = format!(
        "{}\nemit({{type:'created'}});\nemit({{type:'completed'}});\nprocess.exitCode = 3;\n",
        prelude.replace("REQUEST", "'diag-exit'")
    );
    assert!(
        run_consume_case(
            root.path(),
            &runtime,
            "diag-exit",
            &script,
            CancellationToken::new(),
        )
        .await
    );

    // Cancellation with no frames at all still records a stable reason.
    let cancelled = CancellationToken::new();
    let script = format!(
        "{}\nsetTimeout(() => process.exit(0), 60000);\n",
        prelude.replace("REQUEST", "'diag-cancel'")
    );
    let driver = {
        let cancellation = cancelled.clone();
        async move {
            tokio::time::sleep(Duration::from_millis(200)).await;
            cancellation.cancel();
        }
    };
    let (failed, ()) = tokio::join!(
        run_consume_case(root.path(), &runtime, "diag-cancel", &script, cancelled),
        driver
    );
    assert!(failed);

    // Helper error frame: allowlisted diagnostics are logged, other content is not.
    let script = format!(
        "{}\nemit({{type:'created'}});\nemit({{type:'error',code:'provider_stream_idle',diagnostics:{{event_count:4,last_event:'text',history_type:'stream',transport_error:'stream_idle_timeout',http_status:503}}}});\n",
        prelude.replace("REQUEST", "'diag-error'")
    );
    assert!(
        run_consume_case(
            root.path(),
            &runtime,
            "diag-error",
            &script,
            CancellationToken::new(),
        )
        .await
    );

    // Non-allowlisted diagnostics are dropped before logging.
    let script = format!(
        "{}\nemit({{type:'created'}});\nemit({{type:'error',code:'provider_error',diagnostics:{{transport_error:'SENTINEL-transport-9c1d',http_status:999}}}});\n",
        prelude.replace("REQUEST", "'diag-private'")
    );
    assert!(
        run_consume_case(
            root.path(),
            &runtime,
            "diag-private",
            &script,
            CancellationToken::new(),
        )
        .await
    );

    // Child that exits before reading forces a pipe write failure on a large
    // request; a missing executable exercises the spawn path.
    let helper = root.path().join("diag-write.mjs");
    std::fs::write(&helper, "process.exit(0);\n").unwrap();
    let mut init = vec![b' '; 4 * 1024 * 1024];
    init.push(b'\n');
    assert!(
        run_helper(HelperRequest {
            anthropic_thinking: false,
            executable: &runtime,
            helper: &helper,
            codex_home: root.path(),
            init,
            request: b"{}\n".to_vec(),
            prompt: Prompt::default(),
            request_id: "diag-write".to_string(),
            cancellation: CancellationToken::new(),
            turn_guard: (),
        })
        .await
        .is_err()
    );
    let missing = root.path().join("missing-runtime.exe");
    assert!(
        run_helper(HelperRequest {
            anthropic_thinking: false,
            executable: &missing,
            helper: &helper,
            codex_home: root.path(),
            init: b"{}\n".to_vec(),
            request: b"{}\n".to_vec(),
            prompt: Prompt::default(),
            request_id: "diag-spawn".to_string(),
            cancellation: CancellationToken::new(),
            turn_guard: (),
        })
        .await
        .is_err()
    );

    let finished = |request_id: &str, outcome: &str| {
        native_log_lines(request_id)
            .iter()
            .any(|line| line.contains("native_inference_finished") && line.contains(outcome))
    };
    assert!(finished("diag-malformed", "outcome=\"malformed_jsonl\""));
    assert!(finished("diag-eof", "outcome=\"eof_without_terminal\""));
    assert!(finished("diag-exit", "outcome=\"helper_exit_nonzero\""));
    assert!(finished("diag-cancel", "outcome=\"cancelled\""));
    assert!(finished("diag-error", "outcome=\"helper_error\""));
    assert!(finished("diag-private", "outcome=\"helper_error\""));

    // Rejected-frame bytes are still accounted in the outcome record.
    let malformed_lines = native_log_lines("diag-malformed");
    let malformed = malformed_lines
        .iter()
        .find(|line| line.contains("native_inference_finished"))
        .unwrap();
    assert!(malformed.contains("frames_received=0"));
    assert!(!malformed.contains("output_bytes=0"));

    // IO failures log structured kind/os error instead of error strings.
    let write_lines = native_log_lines("diag-write");
    let write = write_lines
        .iter()
        .find(|line| line.contains("native_input_failed") && line.contains("request_write_failed"))
        .unwrap();
    assert!(write.contains("io_kind="));
    let spawn_lines = native_log_lines("diag-spawn");
    let spawn = spawn_lines
        .iter()
        .find(|line| line.contains("native_helper_spawn_failed"))
        .unwrap();
    assert!(spawn.contains("io_kind="));
    assert!(spawn.contains("raw_os_error="));

    // Structural fields are present on outcome records.
    let exit_lines = native_log_lines("diag-exit");
    let exit = exit_lines
        .iter()
        .find(|line| line.contains("native_inference_finished"))
        .unwrap();
    assert!(exit.contains("elapsed_ms="));
    assert!(exit.contains("frames_received=2"));
    assert!(exit.contains("output_bytes="));
    assert!(exit.contains("last_frame_kind=\"completed\""));
    assert!(exit.contains("child_exit_code=3"));

    // Allowlisted diagnostics surface; everything else stays out of the logs.
    let error_lines = native_log_lines("diag-error");
    let error = error_lines
        .iter()
        .find(|line| line.contains("native_inference_helper_failed"))
        .unwrap();
    assert!(error.contains("stream_idle_timeout"));
    assert!(error.contains("503"));
    let logs = native_logs();
    assert!(!logs.contains("SENTINEL-raw-7f2a"));
    assert!(!logs.contains("SENTINEL-transport-9c1d"));
    let private = native_log_lines("diag-private");
    let private_error = private
        .iter()
        .find(|line| line.contains("native_inference_helper_failed"))
        .unwrap();
    assert!(private_error.contains("transport_error=None"));
    assert!(private_error.contains("http_status=None"));
}

#[test]
fn native_model_switch_keeps_account_and_runtime_binding() {
    let root = tempfile::tempdir().unwrap();
    let binding = RuntimeBinding {
        model_id: "first",
        cwd: root.path(),
        credential_scope: "sha1:pinned",
        account_id: Some("account"),
    };
    pin_native_runtime(root.path(), "thread", binding.clone()).unwrap();
    pin_native_runtime(
        root.path(),
        "thread",
        RuntimeBinding {
            model_id: "second",
            ..binding.clone()
        },
    )
    .unwrap();
    state::validate_ancestor_binding(root.path(), "thread", binding.clone()).unwrap();
    assert!(
        state::validate_ancestor_binding(
            root.path(),
            "thread",
            RuntimeBinding {
                credential_scope: "sha1:replaced",
                ..binding
            }
        )
        .is_err()
    );
    assert!(pin_acp_runtime(root.path(), "thread").is_err());
}

#[test]
fn legacy_acp_history_cannot_cross_native_boundary() {
    let root = tempfile::tempdir().unwrap();
    pin_acp_runtime(root.path(), "ancestor").unwrap();
    assert!(ensure_native_history(root.path(), "ancestor").is_err());
    ensure_native_history(root.path(), "new-native").unwrap();
}

#[tokio::test]
async fn native_subprocess_receives_scoped_storage_environment() {
    use futures::StreamExt;
    let root = tempfile::tempdir().unwrap();
    let home = root.path().join("isolated home");
    let expected = home.join("azrael/providers/opencodex");
    let created = r#"{"protocol_version":1,"request_id":"env-test","seq":0,"type":"created"}"#;
    let completed = r#"{"protocol_version":1,"request_id":"env-test","seq":1,"type":"completed"}"#;
    #[cfg(windows)]
    let (runtime, helper, script) = (
        PathBuf::from("powershell.exe"),
        root.path().join("inference.cmd"),
        format!(
            "@echo off\nset /p first=\nset /p second=\nif not \"%CODEX_HOME%\"==\"{}\" exit /b 1\nif not \"%OPENCODEX_HOME%\"==\"{}\" exit /b 2\necho {created}\necho {completed}\n",
            home.display(),
            expected.display()
        ),
    );
    #[cfg(not(windows))]
    let (runtime, helper, script) = (
        PathBuf::from("/bin/sh"),
        root.path().join("inference.sh"),
        format!(
            "IFS= read -r first\nIFS= read -r second\n[ \"$CODEX_HOME\" = '{}' ] || exit 1\n[ \"$OPENCODEX_HOME\" = '{}' ] || exit 2\nprintf '%s\\n' '{created}' '{completed}'\n",
            home.display().to_string().replace('\'', "'\\''"),
            expected.display().to_string().replace('\'', "'\\''")
        ),
    );
    std::fs::write(&helper, script).unwrap();
    let mut stream = run_helper(HelperRequest {
        anthropic_thinking: false,
        executable: &runtime,
        helper: &helper,
        codex_home: &home,
        init: b"{}\n".to_vec(),
        request: b"{}\n".to_vec(),
        prompt: Prompt::default(),
        request_id: "env-test".to_string(),
        cancellation: CancellationToken::new(),
        turn_guard: (),
    })
    .await
    .unwrap();
    let mut completed = false;
    while let Some(event) = stream.next().await {
        if matches!(event.unwrap(), ResponseEvent::Completed { .. }) {
            completed = true;
        }
    }
    assert!(completed);
}

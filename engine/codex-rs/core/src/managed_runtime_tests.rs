use super::*;

#[test]
fn api_turn_options_are_immutable_and_credential_free() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("azrael/providers/api/connections.json");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let value = serde_json::json!({"version":1,"connections":[{"id":"0123456789abcdef0123456789abcdef","name":"Fixture","baseUrl":"http://localhost:1234/v1","protocol":"chat","enabled":true,"timeoutMs":240000,"stream":false,"auth":{"kind":"secret","token":"must-never-cross"},"models":[{"id":"vendor/model","name":"Model","contextWindow":8192,"maxOutputTokens":1024,"supportsTools":false,"enableThinking":false,"sendThinkingParameter":true,"parallelToolCalls":false},{"id":"default-model","supportsTools":true}]}]});
    std::fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    let snapshot = ApiTurnOptions::capture(root.path());
    std::fs::write(&path, b"{\"version\":1,\"connections\":[]}").unwrap();
    let selected = snapshot
        .selected("api/0123456789abcdef0123456789abcdef/vendor/model")
        .unwrap();
    assert_eq!(selected["timeoutMs"], 240000);
    assert_eq!(selected["models"][0]["supportsTools"], false);
    assert_eq!(selected["models"][0]["sendThinkingParameter"], true);
    assert_eq!(
        snapshot
            .selected("api/0123456789abcdef0123456789abcdef/default-model")
            .unwrap()["models"][0]["sendThinkingParameter"],
        false
    );
    assert!(
        !serde_json::to_string(selected)
            .unwrap()
            .contains("must-never-cross")
    );
    assert!(
        ApiTurnOptions::capture(root.path())
            .selected("api/0123456789abcdef0123456789abcdef/vendor/model")
            .is_none()
    );
}
use pretty_assertions::assert_eq;
use serde_json::json;

#[test]
fn openai_projection_preserves_public_history_without_helper_replay() {
    let items: Vec<ResponseItem> = serde_json::from_value(json!([
        {"type":"message","role":"user","content":[{"type":"input_text","text":"question"}]},
        {"type":"reasoning","summary":[{"type":"summary_text","text":"public reasoning"}],"encrypted_content":"azrael-devin-v1:private"},
        {"type":"reasoning","summary":[],"encrypted_content":"azrael-managed-v1:private"},
        {"type":"reasoning","summary":[],"encrypted_content":"openai-private"},
        {"type":"function_call","name":"exec","arguments":"{}","call_id":"exact-call"},
        {"type":"function_call_output","call_id":"exact-call","output":"result"}
    ])).unwrap();
    let original = Prompt {
        input: items.clone(),
        ..Default::default()
    };
    let projected = project_openai(&original);
    let mut expected = items.clone();
    if let ResponseItem::Reasoning {
        encrypted_content, ..
    } = &mut expected[1]
    {
        *encrypted_content = None;
    }
    expected.remove(2);
    assert_eq!(projected.input, expected);
    assert_eq!(original.input, items);
}

#[test]
fn retained_fork_context_limits_provider_inheritance() {
    let root = tempfile::tempdir().unwrap();
    let context = |model| {
        serde_json::from_value::<codex_protocol::protocol::TurnContextItem>(json!({
        "cwd":root.path(), "approval_policy":"never", "sandbox_policy":{"type":"danger-full-access"},
        "model":model, "summary":"auto"
    })).unwrap()
    };
    let retained = vec![
        RolloutItem::TurnContext(context("managed/google/model")),
        RolloutItem::TurnContext(context("gpt-5.4")),
        RolloutItem::TurnContext(context("managed/google/other")),
        RolloutItem::TurnContext(context("managed/openrouter/vendor/model")),
        RolloutItem::TurnContext(context("api/0123456789abcdef0123456789abcdef/vendor/model")),
        RolloutItem::TurnContext(context("api/0123456789abcdef0123456789abcdef/vendor/other")),
    ];
    assert_eq!(
        fork_provider_ids(&retained),
        vec![
            "api-0123456789abcdef0123456789abcdef".to_string(),
            "google".to_string(),
            "openrouter".to_string()
        ]
    );
}

#[test]
fn raw_audio_fails_before_native_projection_can_strip_it() {
    let item: ResponseItem = serde_json::from_value(json!({"type":"message","role":"user","content":[{"type":"input_audio","audio_url":"data:audio/wav;base64,fixture"}]})).unwrap();
    assert!(unsupported_media(&item));
    let output: ResponseItem = serde_json::from_value(json!({"type":"function_call_output","call_id":"call","output":[{"type":"input_audio","audio_url":"data:audio/wav;base64,fixture"}]})).unwrap();
    assert!(unsupported_media(&output));
}

#[test]
fn images_are_left_to_native_modality_projection() {
    let message: ResponseItem = serde_json::from_value(json!({"type":"message","role":"user","content":[{"type":"input_text","text":"look"},{"type":"input_image","image_url":"data:image/png;base64,fixture"}]})).unwrap();
    assert!(!unsupported_media(&message));
    let output: ResponseItem = serde_json::from_value(json!({"type":"function_call_output","call_id":"call","output":[{"type":"input_image","image_url":"data:image/png;base64,fixture"}]})).unwrap();
    assert!(!unsupported_media(&output));
}

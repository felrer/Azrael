use super::*;
use pretty_assertions::assert_eq;
use serde_json::json;

fn history(value: serde_json::Value) -> Vec<ResponseItemEnvelope> {
    serde_json::from_value::<Vec<ResponseItem>>(value)
        .unwrap()
        .into_iter()
        .map(ResponseItemEnvelope::new)
        .collect()
}

#[test]
fn public_projection_preserves_tool_pairs_without_opaque_context() {
    let original = history(json!([
        {"type":"message","role":"user","content":[{"type":"input_text","text":"task"}]},
        {"type":"compaction","encrypted_content":"private-checkpoint"},
        {"type":"context_compaction","encrypted_content":"private-context"},
        {"type":"reasoning","summary":[],"encrypted_content":"private-reasoning"},
        {"type":"reasoning","summary":[{"type":"summary_text","text":"public"}],"encrypted_content":"private"},
        {"type":"reasoning","summary":[{"type":"summary_text","text":"unencrypted reasoning"}]},
        {"type":"message","role":"assistant","content":[{"type":"output_text","text":"public answer"}]},
        {"type":"function_call","name":"exec","arguments":"{}","call_id":"exact-id","encrypted_function_args":["private"]},
        {"type":"function_call_output","call_id":"exact-id","output":"done"}
    ]));
    let projected = public_history(&original);
    let expected = history(json!([
        {"type":"message","role":"user","content":[{"type":"input_text","text":"task"}]},
        {"type":"message","role":"assistant","content":[{"type":"output_text","text":"public answer"}]},
        {"type":"function_call","name":"exec","arguments":"{}","call_id":"exact-id"},
        {"type":"function_call_output","call_id":"exact-id","output":"done"}
    ]));
    assert_eq!(projected, expected);
    assert_eq!(original.len(), 9);
    assert_eq!(public_history(&projected), projected);
}

#[test]
fn public_projection_drops_unsupported_items_and_their_orphaned_results() {
    let original = history(json!([
        {"type":"future_hosted_tool"},
        {"type":"function_call_output","call_id":"hosted-call","output":"private hosted result"},
        {"type":"tool_search_call","call_id":"hosted-search","execution":"server","arguments":{}},
        {"type":"tool_search_output","call_id":"hosted-search","execution":"server","status":"completed","tools":[]},
        {"type":"custom_tool_call","name":"apply_patch","input":"patch","call_id":"kept"},
        {"type":"custom_tool_call_output","call_id":"kept","output":"done"}
    ]));
    assert_eq!(public_history(&original), original[4..]);
}

#[test]
fn failed_first_input_does_not_call_the_failed_source_again() {
    assert!(!needs_summary(&[]));
    assert!(!needs_summary(&history(json!([
        {"type":"message","role":"user","content":[{"type":"input_text","text":"task"}]}
    ]))));
    assert!(needs_summary(&history(json!([
        {"type":"compaction","encrypted_content":"checkpoint"}
    ]))));
    assert!(needs_summary(&history(json!([
        {"type":"message","role":"assistant","content":[{"type":"output_text","text":"result"}]}
    ]))));
}

#[test]
fn provider_changes_are_separate_from_model_changes() {
    assert_eq!(
        provider_id(
            "api/0123456789abcdef0123456789abcdef/vendor/model",
            "openai"
        ),
        provider_id(
            "api/0123456789abcdef0123456789abcdef/vendor/other",
            "openai"
        )
    );
    assert_ne!(
        provider_id(
            "api/0123456789abcdef0123456789abcdef/vendor/model",
            "openai"
        ),
        provider_id(
            "api/abcdef0123456789abcdef0123456789ab/vendor/model",
            "openai"
        )
    );
    assert_ne!(
        provider_id(
            "api/0123456789abcdef0123456789abcdef/vendor/model",
            "openai"
        ),
        provider_id("managed/anthropic/vendor/model", "openai")
    );
    assert_eq!(
        provider_id("managed/google/gemini-a", "openai"),
        provider_id("managed/google/gemini-b", "openai")
    );
    assert_ne!(
        provider_id("managed/google/gemini", "openai"),
        provider_id("managed/google-antigravity/gemini", "openai")
    );
    assert_ne!(
        provider_id("devin/@group/swe-2/default/262000", "openai"),
        provider_id("gpt-6-astra", "openai")
    );
}

#[test]
fn only_confirmed_quota_failures_authorize_context_loss() {
    assert!(quota_exhausted(&CodexErr::new(
        CodexErrorDetails::UsageLimitReached(codex_protocol::error::UsageLimitReachedError {
            plan_type: None,
            resets_at: None,
            limit_window_minutes: None,
            rate_limits: None,
            promo_message: None,
            rate_limit_reached_type: None,
        })
    )));
    assert!(quota_exhausted(&CodexErr::QuotaExceeded));
    assert!(quota_exhausted(&CodexErr::UsageNotIncluded));
    assert!(!quota_exhausted(&CodexErr::new(
        CodexErrorDetails::RateLimitExceeded("request rate limit reached".into())
    )));
    for code in [
        "provider_http_400",
        "provider_http_429",
        "provider_http_402",
    ] {
        assert!(!quota_exhausted(&CodexErr::Fatal(format!(
            "native inference helper failed ({code})"
        ))));
    }
    assert!(!quota_exhausted(&CodexErr::Fatal(
        "native inference helper failed (provider_eof)".into()
    )));
    assert!(!quota_exhausted(&CodexErr::TurnAborted));
    assert!(!quota_exhausted(&CodexErr::Stream(
        "connection closed".into()
    )));
    assert!(!quota_exhausted(&CodexErr::InvalidRequest(
        "managed model is unavailable".into()
    )));
    assert!(!quota_exhausted(&CodexErr::InvalidRequest(
        "HTTP 400 Bad Request".into()
    )));
}

#[test]
fn quota_warning_names_providers_and_explains_missing_context() {
    let warning = quota_warning("source-provider", "target-provider");
    assert!(warning.contains("source-provider usage is exhausted"));
    assert!(warning.contains("Continuing with target-provider"));
    assert!(warning.contains("saved public messages and tool results only"));
    assert!(warning.contains("private reasoning was excluded"));
    assert!(warning.contains("encrypted context was omitted"));
    assert!(warning.contains("earlier details may be missing"));
}

#[test]
fn checkpoint_owner_survives_a_failed_provider_switch() {
    let root = tempfile::tempdir().unwrap();
    let context = |model| {
        RolloutItem::TurnContext(serde_json::from_value(json!({
        "cwd":root.path(), "approval_policy":"never", "sandbox_policy":{"type":"danger-full-access"},
        "model":model, "summary":"auto"
    })).unwrap())
    };
    let checkpoint = || {
        RolloutItem::Compacted(serde_json::from_value(json!({
        "message":"", "replacement_history":[{"type":"compaction","encrypted_content":"original-opaque"}]
    })).unwrap())
    };
    let items = vec![
        context("gpt-6-astra"),
        checkpoint(),
        context("devin/swe-2-medium"),
        checkpoint(),
    ];
    assert_eq!(
        checkpoint_owner(&items, "original-opaque"),
        Some("gpt-6-astra".to_string())
    );
    assert_eq!(checkpoint_owner(&items, "unknown"), None);
}

#[tokio::test]
async fn compact_recovers_checkpoint_owner_before_trusting_last_attempted_model() {
    use crate::tasks::CompactTask;
    use crate::tasks::SessionTask;

    let (mut sess, mut target) = crate::session::tests::make_session_and_context().await;
    let _store = crate::session::tests::attach_in_memory_thread_store(&mut sess).await;
    Arc::make_mut(&mut target.config)
        .features
        .disable(codex_features::Feature::TokenBudget)
        .expect("disable token budget");
    let mut producer = target.to_turn_context_item();
    producer.model = "managed/google/producer-a".to_string();
    let mut attempted = target.to_turn_context_item();
    attempted.model = "gpt-5.6-sol".to_string();
    let original: Vec<ResponseItem> = serde_json::from_value(json!([
        {"type":"compaction","encrypted_content":"checkpoint-owned-by-a"},
        {"type":"message","role":"user","content":[{"type":"input_audio","audio_url":"data:audio/wav;base64,fixture"}]}
    ])).unwrap();
    sess.persist_rollout_items(&[
        RolloutItem::TurnContext(producer),
        RolloutItem::ResponseItem(original[0].clone().into()),
        RolloutItem::TurnContext(attempted),
    ])
    .await;
    sess.replace_history(original.clone(), None).await;
    sess.set_previous_turn_settings(Some(PreviousTurnSettings {
        model: "gpt-5.6-sol".to_string(),
        cyber_access_program: target.cyber_access_program,
        comp_hash: None,
        realtime_active: None,
    }))
    .await;
    let sess = Arc::new(sess);
    let target = Arc::new(target);

    // A's managed transport rejects audio media before any network/helper request.
    // Skipping handoff because the last attempt B and target C are native
    // would incorrectly submit A's opaque checkpoint to the compact endpoint.
    let error = Arc::new(CompactTask)
        .run(
            Arc::clone(&sess),
            Arc::clone(&target),
            Vec::new(),
            CancellationToken::new(),
        )
        .await
        .unwrap_err();
    assert!(error.to_string().contains("unsupported media"), "{error}");
    assert_eq!(
        sess.clone_history()
            .await
            .raw_items()
            .cloned()
            .collect::<Vec<_>>(),
        original
    );
    assert_eq!(
        sess.previous_turn_settings().await.unwrap().model,
        "gpt-5.6-sol"
    );

    let cancelled = CancellationToken::new();
    cancelled.cancel();
    let error = Arc::new(CompactTask)
        .run(sess.clone(), target, Vec::new(), cancelled)
        .await
        .unwrap_err();
    assert!(matches!(error.details(), CodexErrorDetails::TurnAborted));
    assert_eq!(
        sess.clone_history()
            .await
            .raw_items()
            .cloned()
            .collect::<Vec<_>>(),
        original
    );
}

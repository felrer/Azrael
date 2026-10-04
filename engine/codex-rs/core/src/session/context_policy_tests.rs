use super::context_window_token_status;
use crate::session::session::SessionSettingsUpdate;
use crate::session::tests::make_session_and_context;
use codex_protocol::config_types::AutoCompactTokenLimitScope;
use codex_protocol::context_policy::ProviderAutoCompact;
use codex_protocol::protocol::TokenUsage;
use codex_protocol::protocol::TokenUsageInfo;
use pretty_assertions::assert_eq;

#[tokio::test]
async fn provider_context_policy_refreshes_existing_thread_next_turn_and_admission() {
    let (session, _) = make_session_and_context().await;
    let mut config = (*session.get_config().await).clone();
    config.model_context_window = Some(1_000);
    config.model_auto_compact_token_limit = Some(100);
    config
        .provider_auto_compact
        .insert("openai".into(), ProviderAutoCompact::default());
    session.refresh_runtime_config(config).await;
    let (turn, _) = session
        .new_turn_with_sub_id(
            "policy-default".into(),
            SessionSettingsUpdate::default(),
            Default::default(),
        )
        .await
        .unwrap();
    assert_eq!(turn.model_info().auto_compact_token_limit(), Some(950));
    for (used, reached) in [(949, false), (950, true), (951, true)] {
        session
            .state
            .lock()
            .await
            .set_token_info(Some(TokenUsageInfo {
                total_token_usage: TokenUsage {
                    total_tokens: used,
                    ..Default::default()
                },
                last_token_usage: TokenUsage {
                    total_tokens: used,
                    ..Default::default()
                },
                model_context_window: Some(1_000),
                context_policy: None,
            }));
        let status = context_window_token_status(&session, &turn).await;
        assert_eq!(
            (status.auto_compact_scope_limit, status.token_limit_reached),
            (Some(950), reached)
        );
    }
    let mut config = (*session.get_config().await).clone();
    config.provider_auto_compact.insert(
        "openai".into(),
        ProviderAutoCompact {
            percentage: Some(50),
            ..Default::default()
        },
    );
    session.refresh_runtime_config(config).await;
    let (percentage_turn, _) = session
        .new_turn_with_sub_id(
            "policy-percentage".into(),
            SessionSettingsUpdate::default(),
            Default::default(),
        )
        .await
        .unwrap();
    assert_eq!(
        percentage_turn.model_info().auto_compact_token_limit(),
        Some(500)
    );
    assert_eq!(turn.model_info().auto_compact_token_limit(), Some(950));
    let mut config = (*session.get_config().await).clone();
    config.provider_auto_compact.insert(
        "openai".into(),
        ProviderAutoCompact {
            token_limit: Some(300),
            ..Default::default()
        },
    );
    session.refresh_runtime_config(config).await;
    let (next, _) = session
        .new_turn_with_sub_id(
            "policy-custom".into(),
            SessionSettingsUpdate::default(),
            Default::default(),
        )
        .await
        .unwrap();
    assert_eq!(
        (
            turn.model_info().auto_compact_token_limit(),
            next.model_info().auto_compact_token_limit()
        ),
        (Some(950), Some(300))
    );
}

#[tokio::test]
async fn provider_context_policy_preserves_body_after_prefix_and_hard_cap() {
    let (session, mut turn) = make_session_and_context().await;
    let mut config = (*turn.config).clone();
    config.model_auto_compact_token_limit_scope = AutoCompactTokenLimitScope::BodyAfterPrefix;
    config.provider_auto_compact.insert(
        "openai".into(),
        ProviderAutoCompact {
            token_limit: Some(300),
            ..Default::default()
        },
    );
    turn.config = std::sync::Arc::new(config);
    session
        .state
        .lock()
        .await
        .set_auto_compact_window_estimated_prefill(500);
    for (used, reached) in [(799, false), (800, true), (801, true)] {
        session
            .state
            .lock()
            .await
            .set_token_info(Some(TokenUsageInfo {
                total_token_usage: TokenUsage {
                    total_tokens: used,
                    ..Default::default()
                },
                last_token_usage: TokenUsage {
                    total_tokens: used,
                    ..Default::default()
                },
                model_context_window: turn.model_context_window(),
                context_policy: None,
            }));
        let status = context_window_token_status(&session, &turn).await;
        assert_eq!(
            (
                status.auto_compact_scope_tokens,
                status.auto_compact_scope_limit,
                status.token_limit_reached
            ),
            (used - 500, Some(300), reached)
        );
    }
}

#[tokio::test]
async fn provider_context_policy_captures_request_model_and_projected_instructions() {
    let (session, turn) = make_session_and_context().await;
    let mut model = (**turn.model_info()).clone();
    model.slug = "managed/google/gemini-2.5-pro".into();
    model.model_provider = "opencodex".into();
    let prompt = crate::client_common::Prompt {
        base_instructions: codex_protocol::models::BaseInstructions {
            text: "system instructions ".repeat(100),
            provenance: None,
        },
        output_schema: Some(
            serde_json::json!({"type":"object","properties":{"result":{"type":"string"}}}),
        ),
        ..Default::default()
    };
    session
        .record_input_context_policy(&turn, &model, &prompt)
        .await;
    let info = session.state.lock().await.token_info().unwrap();
    let policy = info.context_policy.unwrap();
    assert_eq!(policy.provider_id, "google");
    assert_eq!(policy.model_id, model.slug);
    assert!(policy.input_tokens.unwrap() > 100);
    assert!(policy.input_tokens_estimated);
    assert_eq!(info.model_context_window, model.usable_context_window());
}

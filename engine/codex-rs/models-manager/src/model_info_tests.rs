use super::*;
use crate::ModelsManagerConfig;
use codex_prompts::render_model_instructions;
use codex_protocol::config_types::Personality;
use codex_protocol::openai_models::ApprovalMessages;
use codex_protocol::openai_models::AutoReviewMessages;
use codex_protocol::openai_models::CollaborationModeMessages;
use codex_protocol::openai_models::ConfirmationPolicies;
use codex_protocol::openai_models::GuardianV2ModelConfig;
use codex_protocol::openai_models::ModelTokenBudgetConfig;
use codex_protocol::openai_models::MultiAgentMessages;
use codex_protocol::openai_models::MultiAgentModeMessages;
use codex_protocol::openai_models::MultiAgentRoleMessages;
use codex_protocol::openai_models::MultiAgentToolMessages;
use codex_protocol::openai_models::PermissionMessages;
use codex_protocol::openai_models::ToolMessage;
use codex_protocol::openai_models::ToolMessages;
use pretty_assertions::assert_eq;

fn config_with_personality(personality: Option<Personality>) -> ModelsManagerConfig {
    ModelsManagerConfig {
        personality,
        ..Default::default()
    }
}

#[test]
fn base_instruction_override_is_literal_and_preserves_catalog_messages() {
    let override_instructions = "override {{ personality }}\n# Personality\nKeep me";
    let persistent_instructions = "Follow up on the active task.";
    let async_message_description = "Catalog async message description.";
    let mut model = model_info_from_slug("unknown-model");
    let approvals = ApprovalMessages {
        on_request: Some("user approvals".to_string()),
        on_request_auto_review: Some("auto approvals".to_string()),
        never: Some("never approvals".to_string()),
        unless_trusted: Some("unless-trusted approvals".to_string()),
    };
    let collaboration_modes = CollaborationModeMessages {
        default: Some("default instructions".to_string()),
        plan: Some("plan instructions".to_string()),
    };
    let auto_review = AutoReviewMessages {
        policy: Some("review policy".to_string()),
        policy_template: Some("review policy template".to_string()),
        node_repl_policy: None,
        rejection_instructions: Some("rejection instructions".to_string()),
        timeout_instructions: Some(String::new()),
    };
    let permissions = PermissionMessages {
        danger_full_access: Some("danger".to_string()),
        workspace_write: Some(String::new()),
        read_only: None,
    };
    let multi_agent = MultiAgentMessages {
        role: Some(MultiAgentRoleMessages {
            root: Some("root base".to_string()),
            subagent: Some("subagent base".to_string()),
        }),
        mode: Some(MultiAgentModeMessages {
            explicit: Some("explicit mode".to_string()),
            proactive: Some("proactive mode".to_string()),
            hint_text: Some("mode hint".to_string()),
        }),
    };
    let token_budget = ModelTokenBudgetConfig {
        enabled: false,
        use_history_notes_extension: false,
        reminder_threshold_tokens: 128,
        reminder_message_template: "budget reminder".to_string(),
        guidance_message: "budget guidance".to_string(),
        auto_compact_fallback_prompt: "compact prompt".to_string(),
        auto_compact_fallback_buffer_tokens: 64,
    };
    let guardian_v2 = GuardianV2ModelConfig {
        classifier_instructions: Some("Guardian experiment".to_string()),
        ..Default::default()
    };
    let confirmation_policies = ConfirmationPolicies {
        browser_use: Some("# Browser policy\n\n{{literal_markdown}}\n".to_string()),
        computer_use: Some("  # Native policy\r\n\n${native_markdown}\n".to_string()),
    };
    let mut messages = ModelMessages {
        content_filter_guidance: None,
        persistent_instructions: Some(persistent_instructions.to_string()),
        tools: Some(ToolMessages {
            send_user_message_async: Some(ToolMessage {
                description: Some(async_message_description.to_string()),
                ..Default::default()
            }),
            multi_agent: Some(MultiAgentToolMessages {
                spawn_agent: Some(ToolMessage {
                    description: Some("Catalog spawn description.".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            ..Default::default()
        }),
        instructions_template: Some("template".to_string()),
        approvals: Some(approvals),
        collaboration_modes: Some(collaboration_modes),
        auto_review: Some(auto_review),
        permissions: Some(permissions),
        multi_agent: Some(multi_agent),
        token_budget: Some(token_budget),
        confirmation_policies: Some(confirmation_policies),
        guardian_v2: Some(guardian_v2),
    };
    model.model_messages = Some(messages.clone());
    let config = ModelsManagerConfig {
        base_instructions: Some(override_instructions.to_string()),
        personality: Some(Personality::None),
        ..Default::default()
    };

    let updated = with_config_overrides(model, &config);

    messages.instructions_template = Some(override_instructions.to_string());
    assert_eq!(updated.model_messages, Some(messages));
    assert_eq!(render_model_instructions(&updated), override_instructions);
}

#[test]
fn personality_none_strips_catalog_instruction_sources_through_the_next_h1() {
    let config = config_with_personality(Some(Personality::None));
    for (instructions, expected) in [
        (
            "Intro\n\n# Personality\n\nRemove me\n\n## Writing Style\n\nRemove me too\n\n# Safety\n\nKeep me",
            "Intro\n\n# Safety\n\nKeep me",
        ),
        ("Intro\n\n# Personality\n\nRemove me", "Intro\n\n"),
        (
            "Intro\n\n## Personality\n\nKeep me",
            "Intro\n\n## Personality\n\nKeep me",
        ),
        (
            "Intro\n\n# Personality \n\nKeep me",
            "Intro\n\n# Personality \n\nKeep me",
        ),
        (
            "Intro\r\n\r\n# Personality\r\n\r\nRemove me\r\n\r\n## Writing Style\r\n\r\nRemove me too\r\n\r\n# General\r\n\r\nKeep me",
            "Intro\r\n\r\n# General\r\n\r\nKeep me",
        ),
    ] {
        let mut messages = ModelMessages {
            instructions_template: Some(instructions.to_string()),
            persistent_instructions: Some(String::new()),
            tools: Some(ToolMessages {
                send_user_message_async: Some(ToolMessage {
                    description: Some(String::new()),
                    ..Default::default()
                }),
                multi_agent: Some(MultiAgentToolMessages {
                    spawn_agent: Some(ToolMessage {
                        description: Some(String::new()),
                        ..Default::default()
                    }),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            approvals: Some(ApprovalMessages {
                on_request: Some("user approvals".to_string()),
                on_request_auto_review: None,
                never: None,
                unless_trusted: None,
            }),
            ..Default::default()
        };
        let mut model = model_info_from_slug("unknown-model");
        model.model_messages = Some(messages.clone());

        let updated = with_config_overrides(model, &config);

        messages.instructions_template = Some(expected.to_string());
        assert_eq!(updated.model_messages, Some(messages));
    }
}

#[test]
fn baked_personality_section_is_preserved_without_explicit_none() {
    let instructions = "Intro\n# Personality\nKeep me\n# General\nKeep me too";
    let configs = [
        config_with_personality(/*personality*/ None),
        config_with_personality(Some(Personality::Friendly)),
        config_with_personality(Some(Personality::Pragmatic)),
    ];

    for config in configs {
        let mut model = model_info_from_slug("unknown-model");
        model
            .model_messages
            .as_mut()
            .expect("fallback model messages")
            .instructions_template = Some(instructions.to_string());

        assert_eq!(
            render_model_instructions(&with_config_overrides(model, &config)),
            instructions
        );
    }
}

#[test]
fn explicit_empty_base_instructions_stay_empty_with_personality_none() {
    let mut model = model_info_from_slug("unknown-model");
    model
        .model_messages
        .as_mut()
        .expect("fallback model messages")
        .instructions_template = Some("Intro\n# Personality\nRemove me".to_string());
    let config = ModelsManagerConfig {
        base_instructions: Some(String::new()),
        personality: Some(Personality::None),
        ..Default::default()
    };

    let updated = with_config_overrides(model, &config);

    assert_eq!(
        updated
            .model_messages
            .as_ref()
            .and_then(|messages| messages.instructions_template.as_deref()),
        Some("")
    );
    assert_eq!(render_model_instructions(&updated), "");
}

#[test]
fn unknown_model_uses_builtin_instruction_template() {
    let model = model_info_from_slug("unknown-model");

    assert_eq!(render_model_instructions(&model), BASE_INSTRUCTIONS);
    assert!(model.used_fallback_model_metadata);
}

#[test]
fn model_context_window_override_clamps_to_max_context_window() {
    let mut model = model_info_from_slug("unknown-model");
    model.context_window = Some(273_000);
    model.max_context_window = Some(400_000);
    let config = ModelsManagerConfig {
        model_context_window: Some(500_000),
        ..Default::default()
    };

    let updated = with_config_overrides(model.clone(), &config);
    let mut expected = model;
    expected.context_window = Some(400_000);
    expected.auto_compact_token_limit = Some(380_000);

    assert_eq!(updated, expected);
}

#[test]
fn model_context_window_uses_model_value_without_override() {
    let mut model = model_info_from_slug("unknown-model");
    model.context_window = Some(273_000);
    model.max_context_window = Some(400_000);
    let config = ModelsManagerConfig::default();

    let updated = with_config_overrides(model.clone(), &config);

    model.auto_compact_token_limit = Some(259_350);
    assert_eq!(updated, model);
}

#[test]
fn provider_context_policy_defaults_precedence_and_safe_cap() {
    use codex_protocol::context_policy::AutoCompactSource;
    use codex_protocol::context_policy::ProviderAutoCompact;
    use codex_protocol::context_policy::resolve_auto_compact;
    use std::collections::BTreeMap;
    let mut model = model_info_from_slug("gpt-6.1-sol");
    let mut entries = BTreeMap::new();
    for (window, expected) in [(1_000_000, 258_400), (272_000, 258_400), (200_000, 190_000)] {
        model.context_window = Some(window);
        assert_eq!(
            resolve_auto_compact(&model, &entries, None),
            (Some(expected), AutoCompactSource::Default)
        );
    }
    assert_eq!(
        resolve_auto_compact(&model, &entries, Some(120_000)),
        (Some(120_000), AutoCompactSource::Global)
    );
    entries.insert("openai".into(), ProviderAutoCompact::default());
    assert_eq!(
        resolve_auto_compact(&model, &entries, Some(120_000)),
        (Some(190_000), AutoCompactSource::Default)
    );
    entries.insert(
        "openai".into(),
        ProviderAutoCompact {
            token_limit: Some(900_000),
            ..Default::default()
        },
    );
    model.effective_context_window_percent = 80;
    assert_eq!(
        resolve_auto_compact(&model, &entries, Some(120_000)),
        (Some(160_000), AutoCompactSource::Provider)
    );
    model.slug = "managed/google/gemini-2.5-pro".into();
    model.model_provider = "opencodex".into();
    entries.insert(
        "google".into(),
        ProviderAutoCompact {
            token_limit: Some(42_000),
            ..Default::default()
        },
    );
    assert_eq!(
        resolve_auto_compact(&model, &entries, Some(120_000)),
        (Some(42_000), AutoCompactSource::Provider)
    );
}

#[test]
fn provider_context_policy_percentages_follow_price_baseline_and_model_cap() {
    use codex_protocol::context_policy::ProviderAutoCompact;
    use codex_protocol::context_policy::resolve_context_policy;
    use std::collections::BTreeMap;

    let mut model = model_info_from_slug("gpt-6.1-sol");
    model.context_window = Some(272_000);
    model.max_context_window = Some(1_000_000);
    let model = with_config_overrides(model, &ModelsManagerConfig::default());
    assert_eq!(model.resolved_context_window(), Some(1_000_000));
    let mut entries = BTreeMap::new();
    entries.insert(
        "openai".into(),
        ProviderAutoCompact {
            percentage: Some(500),
            ..Default::default()
        },
    );
    let policy = resolve_context_policy(
        &model, &entries, /*global*/ None, /*subscription*/ false,
    );
    assert_eq!(policy.auto_compact_base_tokens, Some(272_000));
    assert_eq!(
        policy.auto_compact_token_limit,
        model.usable_context_window()
    );

    let mut model = model_info_from_slug("managed/google/gemini-2.5-pro");
    model.context_window = Some(1_050_000);
    model.max_context_window = Some(1_050_000);
    model.effective_context_window_percent = 100;
    entries.insert(
        "google".into(),
        ProviderAutoCompact {
            percentage: Some(500),
            token_limit: Some(42_000),
        },
    );
    let policy = resolve_context_policy(
        &model, &entries, /*global*/ None, /*subscription*/ false,
    );
    assert_eq!(policy.auto_compact_base_tokens, Some(200_000));
    assert_eq!(policy.auto_compact_token_limit, Some(1_000_000));

    model.slug = "managed/xai/grok-4.7".into();
    let policy = resolve_context_policy(
        &model, &entries, /*global*/ None, /*subscription*/ false,
    );
    assert_eq!(policy.auto_compact_base_tokens, Some(199_999));
    assert_eq!(policy.auto_compact_token_limit, Some(189_999));
    model.slug = "managed/openrouter/unverified".into();
    let policy = resolve_context_policy(
        &model, &entries, /*global*/ None, /*subscription*/ false,
    );
    assert_eq!(policy.auto_compact_base_tokens, Some(1_050_000));
    assert_eq!(policy.auto_compact_token_limit, Some(997_500));
}

#[test]
fn provider_context_policy_pricing_matches_exact_route_and_model() {
    use codex_protocol::context_policy::PricingStatus;
    use codex_protocol::context_policy::resolve_context_policy;
    let entries = Default::default();
    let mut model = model_info_from_slug("gpt-6.1-sol");
    let api = resolve_context_policy(&model, &entries, None, false);
    assert_eq!(
        (
            api.pricing.status,
            api.pricing.input_token_threshold,
            api.pricing.inclusive
        ),
        (PricingStatus::Confirmed, Some(272_000), false)
    );
    assert_eq!(
        resolve_context_policy(&model, &entries, None, true)
            .pricing
            .status,
        PricingStatus::Reference
    );
    for (slug, threshold, inclusive, status) in [
        (
            "managed/google/gemini-2.5-pro",
            Some(200_000),
            false,
            PricingStatus::Confirmed,
        ),
        (
            "managed/xai/grok-4.7",
            Some(200_000),
            true,
            PricingStatus::Confirmed,
        ),
        (
            "managed/anthropic/claude-opus-4-6",
            None,
            false,
            PricingStatus::Reference,
        ),
        (
            "managed/google-antigravity/gemini-2.5-pro",
            None,
            false,
            PricingStatus::Unknown,
        ),
        (
            "managed/openrouter/google/gemini-2.5-pro",
            None,
            false,
            PricingStatus::Unknown,
        ),
        (
            "managed/google/gemini-2.5-pro-unverified",
            None,
            false,
            PricingStatus::Unknown,
        ),
    ] {
        model.slug = slug.into();
        model.model_provider = "opencodex".into();
        let pricing = resolve_context_policy(&model, &entries, None, false).pricing;
        assert_eq!(
            (
                pricing.input_token_threshold,
                pricing.inclusive,
                pricing.status
            ),
            (threshold, inclusive, status)
        );
    }
}

#[test]
fn provider_context_policy_rejects_nonpositive_and_fractional_values() {
    use codex_protocol::context_policy::ProviderAutoCompact;
    for value in [
        serde_json::json!({"token_limit":0}),
        serde_json::json!({"token_limit":-1}),
        serde_json::json!({"token_limit":1.5}),
        serde_json::json!({"percentage":0}),
        serde_json::json!({"percentage":-1}),
        serde_json::json!({"percentage":1.5}),
    ] {
        assert!(serde_json::from_value::<ProviderAutoCompact>(value).is_err());
    }
    for value in [
        serde_json::json!({}),
        serde_json::json!({"token_limit":null}),
    ] {
        assert_eq!(
            serde_json::from_value::<ProviderAutoCompact>(value).unwrap(),
            ProviderAutoCompact::default()
        );
    }
}

#[test]
fn provider_context_policy_caps_remote_openai_capacity_and_preserves_lower_limit() {
    for slug in ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"] {
        let mut model = model_info_from_slug(slug);
        model.model_provider = "openai".into();
        model.context_window = Some(1_050_000);
        model.max_context_window = Some(1_050_000);
        let resolved = with_config_overrides(model.clone(), &ModelsManagerConfig::default());
        assert_eq!(resolved.resolved_context_window(), Some(1_000_000));
        assert_eq!(resolved.auto_compact_token_limit(), Some(258_400));
        model.context_window = Some(200_000);
        model.max_context_window = Some(200_000);
        let config = ModelsManagerConfig {
            model_context_window: Some(1_000_000),
            ..Default::default()
        };
        assert_eq!(
            with_config_overrides(model, &config).resolved_context_window(),
            Some(200_000)
        );
    }
}

#[test]
fn provider_context_policy_preserves_request_identity_and_includes_cached_input_once() {
    use codex_protocol::context_policy::resolve_context_policy;
    use codex_protocol::protocol::TokenUsage;
    use codex_protocol::protocol::TokenUsageInfo;
    let mut model = model_info_from_slug("gpt-6.1-sol");
    model.slug = "managed/google/gemini-2.5-pro".into();
    model.model_provider = "opencodex".into();
    let mut policy = resolve_context_policy(&model, &Default::default(), None, true);
    policy.input_tokens = Some(200_001);
    let mut info = TokenUsageInfo {
        context_policy: Some(policy),
        total_token_usage: Default::default(),
        last_token_usage: Default::default(),
        model_context_window: model.usable_context_window(),
    };
    info.append_last_usage(&TokenUsage {
        input_tokens: 200_001,
        cached_input_tokens: 190_000,
        output_tokens: 50_000,
        total_tokens: 250_001,
        ..Default::default()
    });
    let policy = info.context_policy.unwrap();
    assert_eq!(policy.provider_id, "google");
    assert_eq!(policy.model_id, "managed/google/gemini-2.5-pro");
    assert_eq!(policy.input_tokens, Some(200_001));
    assert!(!policy.input_tokens_estimated);
    assert_eq!(
        policy.pricing.status,
        codex_protocol::context_policy::PricingStatus::Confirmed
    );
    model.slug = "managed/openai/gpt-6.1-sol".into();
    assert_eq!(
        resolve_context_policy(&model, &Default::default(), None, true)
            .pricing
            .status,
        codex_protocol::context_policy::PricingStatus::Confirmed
    );
}

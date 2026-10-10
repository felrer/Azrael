//! Covers provider-independent behavior and custom instruction preservation.

use super::*;
use crate::ResolvedModelMessages;
use codex_protocol::openai_models::ConfigShellToolType;
use codex_protocol::openai_models::ModelMessages;
use codex_protocol::openai_models::ModelVisibility;
use codex_protocol::openai_models::TruncationPolicyConfig;
use pretty_assertions::assert_eq;

pub(crate) fn test_model(model_messages: Option<ModelMessages>) -> ModelInfo {
    ModelInfo {
        model_provider: "openai".to_string(),
        slug: "test-model".to_string(),
        display_name: "Test Model".to_string(),
        description: None,
        default_reasoning_level: None,
        supported_reasoning_levels: vec![],
        shell_type: ConfigShellToolType::UnifiedExec,
        visibility: ModelVisibility::List,
        supported_in_api: true,
        priority: 1,
        additional_speed_tiers: vec![],
        service_tiers: vec![],
        default_service_tier: None,
        available_access_programs: None,
        availability_nux: None,
        upgrade: None,
        model_messages,
        include_skills_usage_instructions: false,
        include_plugin_usage_instructions: false,
        include_apps_usage_instructions: false,
        supports_reasoning_summary_parameter: true,
        default_reasoning_summary: Default::default(),
        support_verbosity: false,
        default_verbosity: None,
        apply_patch_tool_type: None,
        web_search_tool_type: Default::default(),
        truncation_policy: TruncationPolicyConfig::bytes(/*limit*/ 10_000),
        supports_image_detail_original: false,
        context_window: None,
        max_context_window: None,
        auto_compact_token_limit: None,
        comp_hash: None,
        effective_context_window_percent: 95,
        experimental_supported_tools: vec![],
        input_modalities: vec![],
        used_fallback_model_metadata: false,
        supports_search_tool: false,
        supports_experimental_context: false,
        use_responses_lite: false,
        supports_reasoning_effort_updates: false,
        guardian: None,
        node_repl_auto_review_required: false,
        node_repl_disabled: false,
        auto_review_model_override: None,
        model_specialty: None,
        tool_mode: None,
        multi_agent_version: None,
        multi_agent_reasoning_effort: None,
    }
}

#[test]
fn catalog_templates_cannot_replace_common_behavior() {
    let template = "Hello {{ personality }}\n\n# Personality\n\nFixed instructions";
    let model = test_model(Some(ModelMessages {
        instructions_template: Some(template.to_string()),
        ..Default::default()
    }));
    assert_eq!(
        (
            ResolvedModelMessages::from_model(&model).instructions_template(),
            render_model_instructions(&model)
        ),
        (
            Some(COMMON_AGENT_INSTRUCTIONS),
            COMMON_AGENT_INSTRUCTIONS.to_string()
        ),
    );
}

#[test]
fn every_provider_receives_common_behavior_for_missing_and_empty_templates() {
    for messages in [
        None,
        Some(ModelMessages::default()),
        Some(ModelMessages {
            instructions_template: Some(String::new()),
            ..Default::default()
        }),
    ] {
        for provider in ["openai", "azrael-devin", "azrael-managed", "api-test"] {
            let mut model = test_model(messages.clone());
            model.model_provider = provider.to_string();
            assert_eq!(render_model_instructions(&model), COMMON_AGENT_INSTRUCTIONS);
        }
    }
}

#[test]
fn custom_instructions_supplement_common_behavior_without_duplication() {
    assert_eq!(compose_agent_instructions(None), COMMON_AGENT_INSTRUCTIONS);
    assert_eq!(
        compose_agent_instructions(Some("")),
        COMMON_AGENT_INSTRUCTIONS
    );
    let custom = "Use the workspace conventions.";
    let rendered = compose_agent_instructions(Some(custom));
    assert!(rendered.starts_with(COMMON_AGENT_INSTRUCTIONS));
    assert!(rendered.contains(custom));
    assert_eq!(compose_agent_instructions(Some(&rendered)), rendered);
}

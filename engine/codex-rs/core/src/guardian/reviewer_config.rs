//! Resolves reviewer models and adds policy context and live network state to reviewer configuration.
//! Both prewarming and reviews finish this setup before context preparation and reuse checks.

use std::sync::Arc;

use codex_features::Feature;
use codex_guardian_reviewer::guardian_output_contract_prompt;
use codex_prompts::GuardianPolicyInstructions;
use codex_prompts::ResolvedModelMessages;
use codex_protocol::models::BaseInstructionsProvenance;

use crate::config::Config;
use crate::config::NetworkProxySpec;
use crate::context::ContextualUserFragment;
use crate::context::GuardianConversationHistory;

/// One logical review owns its account lease, catalog and resolved model together.
pub(super) struct ServiceReviewer {
    pub binding: Arc<codex_login::AzraelServiceAccountBinding>,
    pub models: codex_models_manager::manager::SharedModelsManager,
}

pub(super) fn openai_service_base_config(parent_config: &Config) -> Config {
    let mut config = parent_config.clone();
    config.model_provider_id = codex_model_provider_info::OPENAI_PROVIDER_ID.to_owned();
    config.model_provider =
        codex_model_provider_info::ModelProviderInfo::create_openai_provider(None);
    config.native_model_provider = None;
    config.model_catalog = None;
    config
}

pub(super) async fn resolve_service_reviewer(
    session: &crate::session::session::Session,
    parent_config: &Config,
) -> anyhow::Result<(
    Config,
    ServiceReviewer,
    codex_guardian_reviewer::ReviewModel,
    Arc<codex_protocol::openai_models::ModelInfo>,
)> {
    let binding = Arc::new(
        codex_login::AzraelServiceAccountStore::new(parent_config.codex_home.as_path())
            .resolve(&session.services.auth_manager)
            .await
            .map_err(|_| anyhow::anyhow!("Guardian OpenAI service account is unavailable"))?,
    );
    let service_config = openai_service_base_config(parent_config);
    let mut config = service_config
        .for_openai_service(binding.manager())
        .await
        .map_err(|_| anyhow::anyhow!("Guardian OpenAI service policy is unavailable"))?;
    config.azrael_service_account = Some(Arc::clone(&binding));
    anyhow::ensure!(
        config.model_provider_id == codex_model_provider_info::OPENAI_PROVIDER_ID
            && config.model_provider.is_openai(),
        "Guardian OpenAI service provider is unavailable"
    );
    let provider = codex_model_provider::create_model_provider(
        config.model_provider.clone(),
        Some(binding.manager()),
    );
    // Never borrow the chat provider's catalog, nor its shared on-disk cache.
    let models = provider.models_manager_without_cache(None);
    let available = models
        .list_models(
            codex_models_manager::manager::RefreshStrategy::OnlineIfUncached,
            config.http_client_factory(),
        )
        .await;
    let preferred = provider.approval_review_preferred_model();
    let preset = available
        .iter()
        .find(|preset| preset.model == preferred)
        .ok_or_else(|| anyhow::anyhow!("Guardian OpenAI review model is unavailable"))?;
    let info = Arc::new(
        models
            .get_model_info(&preset.model, &config.to_models_manager_config())
            .await,
    );
    // The seed is the selected OpenAI model, never the foreign parent's metadata.
    let review_model =
        codex_guardian_reviewer::select_review_model(&info, None, preferred, &available);
    anyhow::ensure!(
        available
            .iter()
            .any(|preset| preset.model == review_model.model),
        "Guardian OpenAI review model is unavailable"
    );
    let info = Arc::new(
        models
            .get_model_info(&review_model.model, &config.to_models_manager_config())
            .await,
    );
    Ok((
        config,
        ServiceReviewer { binding, models },
        review_model,
        info,
    ))
}

/// Adds the captured model, policy prompt and live network rules before reuse selection.
pub fn build_guardian_review_session_config(
    mut guardian_config: Config,
    live_network_config: Option<codex_network_proxy::NetworkProxyConfig>,
    active_model: &str,
    reasoning_effort: Option<codex_protocol::openai_models::ReasoningEffort>,
    reasoning_summary: codex_protocol::config_types::ReasoningSummary,
    personality: Option<codex_protocol::config_types::Personality>,
    model_messages: ResolvedModelMessages<'_>,
) -> anyhow::Result<Config> {
    guardian_config.model = Some(active_model.to_owned());
    guardian_config.model_reasoning_effort = reasoning_effort;
    guardian_config.model_reasoning_summary = Some(reasoning_summary);
    guardian_config.personality = personality;
    let auto_review = model_messages.auto_review();
    let tenant_policy_config = guardian_config.resolve_guardian_policy(model_messages);
    let extra_policy = guardian_config
        .guardian_extra_policy
        .as_deref()
        .unwrap_or_default();
    let policy_template = guardian_config
        .guardian_policy_template
        .as_deref()
        .unwrap_or(auto_review.policy_template);
    let mut instructions = GuardianPolicyInstructions::new(
        guardian_config.guardian_transcript_mode,
        tenant_policy_config,
        extra_policy,
        policy_template,
        guardian_output_contract_prompt(),
    )
    .render();
    // Guardian's basic internal source omits ordinary world-state developer
    // instructions. Managed service policy must still reach the reviewer.
    if let Some(managed) = guardian_config
        .config_layer_stack
        .requirements()
        .additional_developer_instructions
        .as_ref()
    {
        instructions.push_str("\n<managed_developer_instructions>\n");
        instructions.push_str(&managed.value);
        instructions.push_str("\n</managed_developer_instructions>");
    }
    if guardian_config
        .features
        .enabled(Feature::GuardianConversationHistoryTools)
        && guardian_config.features.enabled(Feature::Apps)
    {
        instructions.push('\n');
        instructions.push_str(
            &GuardianConversationHistory {
                prompt: guardian_config
                    .guardian_conversation_history_prompt
                    .as_deref(),
            }
            .render(),
        );
    }
    guardian_config.base_instructions = Some(instructions);
    guardian_config.base_instructions_provenance = Some(BaseInstructionsProvenance::Custom);
    if let Some(live_network_config) = live_network_config
        && guardian_config.permissions.network.is_some()
    {
        let network_constraints = guardian_config
            .config_layer_stack
            .requirements()
            .network
            .as_ref()
            .map(|network| network.value.clone());
        guardian_config.permissions.network = Some(NetworkProxySpec::from_config_and_constraints(
            live_network_config,
            network_constraints,
            guardian_config.permissions.permission_profile(),
        )?);
    }
    Ok(guardian_config)
}

/// Resolves the same catalog-backed reviewer for approval and checkpoint migration.
pub(crate) async fn resolve_review_model(
    session: &crate::session::session::Session,
    context: &super::GuardianReviewContext,
) -> (
    codex_guardian_reviewer::ReviewModel,
    Arc<codex_protocol::openai_models::ModelInfo>,
) {
    let turn = context.turn();
    let available_models = session
        .services
        .models_manager
        .list_models(
            codex_models_manager::manager::RefreshStrategy::Offline,
            turn.config.http_client_factory(),
        )
        .await;
    let default_review_model_id = turn.provider.approval_review_preferred_model();
    let review_model = codex_guardian_reviewer::select_review_model(
        &context.model_info,
        context.reasoning_effort.as_ref(),
        default_review_model_id,
        &available_models,
    );
    // Resolve a separate reviewer against the current catalog on every attempt.
    // Parent fallback must retain the action's metadata even after a catalog refresh.
    let guardian_model_info =
        if !review_model.catalog_contains_auto_review && !review_model.model_overridden {
            Arc::clone(&context.model_info)
        } else {
            Arc::new(
                session
                    .services
                    .models_manager
                    .get_model_info(
                        review_model.model.as_str(),
                        &turn.config.to_models_manager_config(),
                    )
                    .await,
            )
        };
    (review_model, guardian_model_info)
}

//! Request-scoped settings and capabilities, with live grants bound to the originating turn.

use std::sync::Arc;

use crate::agents_md::LoadedAgentsMd;
use crate::config::TokenBudgetConfig;
use crate::environment_selection::TurnEnvironmentSnapshot;
use crate::realtime_conversation::RealtimeConversationSnapshot;
use crate::session::step_settings::ResolvedStepSettings;
use crate::session::turn_context::TurnContext;
use crate::session::turn_context::TurnEnvironment;
use crate::tools::router::ToolRouter;
use codex_exec_server::ExecutorCapabilityDiscoverySnapshot;
use codex_exec_server::ResolvedSelectedCapabilityRoot;
use codex_extension_api::ExtensionData;
use codex_file_system::EnvironmentAccess;
use codex_mcp::McpBinding;
use codex_otel::SessionTelemetry;
use codex_protocol::items::ModelInvocationContext;
use codex_protocol::protocol::TurnContextItem;
use tokio_util::sync::CancellationToken;

/// Request-scoped state that may change between model sampling requests.
pub(crate) struct StepContext {
    pub(crate) turn: Arc<TurnContext>,
    /// Preempts this request and yields its code-mode observations when user input arrives.
    pub(crate) preempt: Option<CancellationToken>,
    /// Realtime call activity and instructions captured for this sampling request.
    pub(crate) realtime: RealtimeConversationSnapshot,
    /// One immutable settings version captured before request preparation.
    pub(crate) settings: Arc<ResolvedStepSettings>,
    /// Prompt and tools resolved from the same immutable configuration and pinned model.
    pub(crate) harness_profile: codex_config::harness_profiles::ResolvedHarnessProfile,
    /// Frozen turn preferences resolved against this step's captured model.
    pub(crate) token_budget: Option<TokenBudgetConfig>,
    /// Telemetry context tagged with this sampling request's model.
    pub(crate) session_telemetry: SessionTelemetry,
    pub(crate) environments: TurnEnvironmentSnapshot,
    /// Capability roots bound to ready environments in this exact step.
    pub(crate) selected_capability_roots: Vec<ResolvedSelectedCapabilityRoot>,
    /// Executor-materialized capability files shared by MCP and skills in this exact step.
    pub(crate) executor_capability_discovery: Option<Arc<ExecutorCapabilityDiscoverySnapshot>>,
    /// Keeps the extension inputs used to build this step's tools for its World State as well.
    pub(crate) extension_data: ExtensionData,
    /// The exact MCP connections, configuration, and catalog captured for this step.
    pub(crate) mcp: Arc<McpBinding>,
    /// The finalized tool plan advertised and executed for this exact sampling request.
    pub(crate) tool_router: Arc<ToolRouter>,
    /// The canonical AGENTS.md value observed with this environment snapshot.
    pub(crate) loaded_agents_md: Option<Arc<LoadedAgentsMd>>,
}

impl StepContext {
    /// Whether new context windows should record tool declarations in history.
    pub(crate) fn incremental_tools_enabled(&self) -> bool {
        !self.harness_profile.uses_claude_tools()
            && self.settings.model_info.use_responses_lite
            && self
                .turn
                .config
                .features
                .enabled(codex_features::Feature::IncrementalTools)
    }

    /// Pairs the step's environments with access using current session and originating-turn grants.
    pub(crate) fn environments(&self) -> Vec<(&TurnEnvironment, impl EnvironmentAccess + '_)> {
        self.environments
            .turn_environments()
            .map(|environment| {
                let grants = self
                    .turn
                    .granted_permissions(&environment.selection.environment_id);
                (environment, environment.fs_accessor(grants))
            })
            .collect()
    }

    /// Persist the context captured for this request, even after a live update.
    pub(crate) fn to_turn_context_item(&self) -> TurnContextItem {
        let mut item = self.turn.to_turn_context_item();
        item.realtime_active = Some(self.realtime.active);
        item.harness_profile = Some(codex_protocol::protocol::HarnessProfileContext {
            id: self.harness_profile.id.clone(),
            fingerprint: self.harness_profile.fingerprint.clone(),
            prompt_profile: self.harness_profile.prompt_profile.clone(),
            tool_profile: self.harness_profile.tool_profile.clone(),
        });
        item
    }

    pub(crate) fn model_context(&self) -> ModelInvocationContext {
        ModelInvocationContext {
            model_slug: self.settings.model_info.slug.clone(),
            reasoning_effort: self
                .settings
                .effective_reasoning_effort()
                .map(|effort| effort.to_string()),
        }
    }
}

/// Resolve identities and include rendered built-in content in the compatibility fingerprint.
pub(crate) fn resolve_harness_profile(
    config: &crate::config::Config,
    model: &str,
) -> std::io::Result<codex_config::harness_profiles::ResolvedHarnessProfile> {
    use sha2::{Digest, Sha256};
    let mut profile = config
        .harness_profiles
        .resolve(&config.model_provider_id, model)?;
    let rendered = codex_prompts::compose_harness_instructions(
        &profile.prompt_variant,
        profile.behavior_template.as_deref(),
        profile.uses_claude_tools(),
        config.base_instructions.as_deref(),
    );
    let rendered = if model.starts_with("api/") {
        codex_prompts::project_api_base_instructions(&rendered)
    } else {
        rendered
    };
    let mut digest = Sha256::new();
    digest.update(profile.fingerprint.as_bytes());
    digest.update(b"\0azrael-harness-request-v1\0");
    digest.update(rendered.as_bytes());
    profile.fingerprint = format!("{:x}", digest.finalize());
    Ok(profile)
}

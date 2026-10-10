//! Resolves provider-independent agent policies and model-specific technical tool metadata.
//! Policy families always use the bundled common instructions.
//! Prompt composition and runtime settings remain with consumers; each accessor
//! selects and resolves only the requested message family.

use crate::COMMON_AGENT_INSTRUCTIONS;
use codex_protocol::openai_models::CodeModeToolMessages;
use codex_protocol::openai_models::ConfirmationPolicies;
use codex_protocol::openai_models::IndirectDescriptionPrefixes;
use codex_protocol::openai_models::McpResourceToolMessages;
use codex_protocol::openai_models::ModelInfo;
use codex_protocol::openai_models::ToolMessage;
use codex_protocol::openai_models::ToolMessages;
use permissions::ResolvedApprovalMessages;
use permissions::ResolvedPermissionMessages;

mod collaboration;
mod guardian;
mod multi_agent;
pub(crate) mod permissions;

pub use collaboration::ResolvedCollaborationModeMessages;
pub use guardian::ResolvedAutoReviewMessages;
pub use multi_agent::ResolvedMultiAgentMessages;

/// Text together with whether it was supplied by the catalog, even when it equals the default.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolvedMessage<'a> {
    Catalog(&'a str),
    Bundled(&'static str),
}

impl<'a> ResolvedMessage<'a> {
    pub(crate) fn new(catalog: Option<&'a str>, bundled: &'static str) -> Self {
        catalog.map_or(Self::Bundled(bundled), Self::Catalog)
    }

    pub fn text(self) -> &'a str {
        match self {
            Self::Catalog(text) | Self::Bundled(text) => text,
        }
    }

    pub fn catalog_override(self) -> Option<&'a str> {
        match self {
            Self::Catalog(text) => Some(text),
            Self::Bundled(_) => None,
        }
    }
}

const REQUEST_USER_INPUT_ASYNC_DESCRIPTION: &str = "Ask the user one or more questions during ongoing work. Use this tool only to request missing information, preferences, constraints, clarification, or approval. The tool returns immediately without ending the turn or waiting for a reply; any reply arrives asynchronously as a new user message. Keep questions concise, self-contained, and easy to understand, using a level of detail appropriate to the user and task. The UI always allows a free-text answer, including when suggested options are provided. A preselected option is not submitted automatically.";
const REMINDER_MESSAGE_TEMPLATE: &str = concat!(
    "Your context window is nearly exhausted (only {n_remaining} tokens remaining) and will be automatically reset for you soon. ",
    "Once reset, message items in current context window will be cleared in the new window, but notes and history items will be persistent across windows."
);
const PERSISTENT_INSTRUCTIONS: &str = include_str!("../templates/persistent_mode.md");
const CONTENT_FILTER_GUIDANCE: &str = "Your previous response was blocked by a content filter. Do not treat this as a transient failure or try to reproduce or work around the blocked content through repeated attempts, altered formatting, splitting, encoding, tools, subagents, or later wakes. Briefly explain the limitation and offer a permitted alternative. Continue unrelated authorized work.";

/// Resolves common agent policy independently of the selected provider.
///
/// Only technical tool descriptions and schemas borrow catalog metadata. Policy
/// text cannot be replaced or suppressed by catalog values, including empty strings.
#[derive(Debug, Clone, Copy)]
pub struct ResolvedModelMessages<'a> {
    catalog_tools: Option<&'a ToolMessages>,
}

impl<'a> ResolvedModelMessages<'a> {
    /// Borrows only technical tool metadata from the selected model.
    pub fn from_model(model_info: &'a ModelInfo) -> Self {
        Self {
            catalog_tools: model_info
                .model_messages
                .as_ref()
                .and_then(|messages| messages.tools.as_ref()),
        }
    }

    /// Resolves bundled common policy and default tool metadata.
    pub fn bundled() -> Self {
        Self {
            catalog_tools: None,
        }
    }

    /// Returns the common agent instructions for every provider.
    pub fn instructions_template(&self) -> Option<&'a str> {
        Some(COMMON_AGENT_INSTRUCTIONS)
    }

    /// Resolves common approval messages and their bundled alternatives.
    pub(crate) fn approvals(self) -> ResolvedApprovalMessages<'a> {
        ResolvedApprovalMessages::new(None)
    }

    /// Resolves common permission templates without preparing runtime facts.
    pub(crate) fn permissions(self) -> ResolvedPermissionMessages<'a> {
        ResolvedPermissionMessages::new(None)
    }

    /// Resolves common collaboration mode instructions.
    pub fn collaboration_modes(&self) -> ResolvedCollaborationModeMessages<'a> {
        ResolvedCollaborationModeMessages::new(None)
    }

    /// Resolves common multi-agent role and mode instructions.
    pub fn multi_agent(&self) -> ResolvedMultiAgentMessages<'a> {
        ResolvedMultiAgentMessages::new(None)
    }

    /// Resolves common auto-review policy and rejection/timeout instructions.
    pub fn auto_review(&self) -> ResolvedAutoReviewMessages<'a> {
        ResolvedAutoReviewMessages::new(None)
    }

    /// Resolves common classifier instructions.
    pub fn guardian_classifier_instructions(&self) -> &'a str {
        guardian::classifier_instructions(None)
    }

    /// Resolves common reminder text without selecting runtime budget settings.
    pub fn token_budget_reminder_template(&self) -> &'a str {
        REMINDER_MESSAGE_TEMPLATE
    }

    /// Leaves confirmation policies to the common actor defaults.
    pub fn confirmation_policies(&self) -> Option<&'a ConfirmationPolicies> {
        None
    }

    /// Resolves the asynchronous user-input tool description.
    pub fn request_user_input_async_description(&self) -> &'a str {
        self.catalog_tools
            .and_then(|tools| tools.send_user_message_async.as_ref())
            .and_then(|tool| tool.description.as_deref())
            .unwrap_or(REQUEST_USER_INPUT_ASYNC_DESCRIPTION)
    }

    /// Selects the asynchronous user-input schema; parsing belongs to the tool consumer.
    pub fn request_user_input_async_parameters_override(&self) -> Option<&'a str> {
        self.catalog_tools?
            .send_user_message_async
            .as_ref()?
            .parameters
            .as_deref()
    }

    /// Selects a V2 tool's static description by its name, independently of its runtime namespace.
    /// Missing text retains the tool's bundled description; an empty string replaces it.
    pub fn multi_agent_tool_description_override(&self, tool_name: &str) -> Option<&'a str> {
        self.multi_agent_tool(tool_name)?.description.as_deref()
    }

    /// Selects a V2 tool's complete parameter schema; parsing belongs to the tool consumer.
    pub fn multi_agent_tool_parameters_override(&self, tool_name: &str) -> Option<&'a str> {
        self.multi_agent_tool(tool_name)?.parameters.as_deref()
    }

    fn multi_agent_tool(self, tool_name: &str) -> Option<&'a ToolMessage> {
        self.catalog_tools
            .and_then(|tools| tools.multi_agent.as_ref())?
            .by_name(tool_name)
    }

    /// Selects resource helper messages; schema parsing belongs to the tool owner.
    pub fn mcp_resources(&self) -> Option<&'a McpResourceToolMessages> {
        self.catalog_tools?.mcp_resources.as_ref()
    }

    /// Selects indirect tool guidance; tool rendering owns namespace mapping and normalization.
    pub fn indirect_description_prefixes(&self) -> Option<&'a IndirectDescriptionPrefixes> {
        self.catalog_tools?.indirect_description_prefixes.as_ref()
    }

    /// Selects Code Mode messages; bundled text and runtime composition belong to the tool owner.
    pub fn code_mode(&self) -> Option<&'a CodeModeToolMessages> {
        self.catalog_tools?.code_mode.as_ref()
    }

    /// Selects wait's complete description.
    pub fn code_mode_wait_description_override(&self) -> Option<&'a str> {
        self.code_mode()?.wait.as_ref()?.description.as_deref()
    }

    /// Selects wait's parameter schema. Exec uses a harness-owned freeform grammar.
    pub fn code_mode_wait_parameters_override(&self) -> Option<&'a str> {
        self.code_mode()?.wait.as_ref()?.parameters.as_deref()
    }

    /// Resolves common persistent-mode instructions without activating the mode.
    pub fn persistent_instructions(&self) -> &'a str {
        PERSISTENT_INSTRUCTIONS
    }

    /// Resolves common content-filter recovery guidance.
    pub fn content_filter_guidance(&self) -> &'a str {
        CONTENT_FILTER_GUIDANCE
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model_instructions::tests::test_model;
    use codex_protocol::openai_models::ApprovalMessages;
    use codex_protocol::openai_models::AutoReviewMessages;
    use codex_protocol::openai_models::CollaborationModeMessages;
    use codex_protocol::openai_models::GuardianV2ModelConfig;
    use codex_protocol::openai_models::ModelMessages;
    use codex_protocol::openai_models::ModelTokenBudgetConfig;
    use codex_protocol::openai_models::MultiAgentMessages;
    use codex_protocol::openai_models::MultiAgentModeMessages;
    use codex_protocol::openai_models::MultiAgentRoleMessages;
    use codex_protocol::openai_models::MultiAgentToolMessages;
    use codex_protocol::openai_models::PermissionMessages;
    use pretty_assertions::assert_eq;

    fn catalog_policies(text: &str) -> ModelMessages {
        let value = || Some(text.to_owned());
        ModelMessages {
            instructions_template: value(),
            persistent_instructions: value(),
            content_filter_guidance: value(),
            approvals: Some(ApprovalMessages {
                on_request: value(),
                on_request_auto_review: value(),
                never: value(),
                unless_trusted: value(),
            }),
            permissions: Some(PermissionMessages {
                danger_full_access: value(),
                workspace_write: value(),
                read_only: value(),
            }),
            collaboration_modes: Some(CollaborationModeMessages {
                default: value(),
                plan: value(),
            }),
            multi_agent: Some(MultiAgentMessages {
                role: Some(MultiAgentRoleMessages {
                    root: value(),
                    subagent: value(),
                }),
                mode: Some(MultiAgentModeMessages {
                    explicit: value(),
                    proactive: value(),
                    hint_text: value(),
                }),
            }),
            auto_review: Some(AutoReviewMessages {
                policy: value(),
                policy_template: value(),
                node_repl_policy: value(),
                rejection_instructions: value(),
                timeout_instructions: value(),
            }),
            guardian_v2: Some(GuardianV2ModelConfig {
                classifier_instructions: value(),
                ..Default::default()
            }),
            token_budget: Some(ModelTokenBudgetConfig {
                enabled: true,
                use_history_notes_extension: true,
                reminder_threshold_tokens: 1,
                reminder_message_template: text.to_owned(),
                guidance_message: text.to_owned(),
                auto_compact_fallback_prompt: text.to_owned(),
                auto_compact_fallback_buffer_tokens: 1,
            }),
            confirmation_policies: Some(ConfirmationPolicies {
                browser_use: value(),
                computer_use: value(),
            }),
            ..Default::default()
        }
    }

    fn assert_common_policies(resolved: ResolvedModelMessages<'_>) {
        let common = ResolvedModelMessages::bundled();
        assert_eq!(
            resolved.instructions_template(),
            Some(COMMON_AGENT_INSTRUCTIONS)
        );
        let approvals = resolved.approvals();
        let expected = common.approvals();
        assert_eq!(approvals.on_request, expected.on_request);
        assert_eq!(
            approvals.on_request_auto_review,
            expected.on_request_auto_review
        );
        assert_eq!(approvals.never, expected.never);
        assert_eq!(approvals.unless_trusted, expected.unless_trusted);
        let permissions = resolved.permissions();
        let expected = common.permissions();
        assert_eq!(permissions.danger_full_access, expected.danger_full_access);
        assert_eq!(permissions.workspace_write, expected.workspace_write);
        assert_eq!(permissions.read_only, expected.read_only);
        let modes = resolved.collaboration_modes();
        let expected = common.collaboration_modes();
        assert_eq!(modes.default, expected.default);
        assert_eq!(modes.plan, expected.plan);
        let agents = resolved.multi_agent();
        let expected = common.multi_agent();
        assert_eq!(agents.root, expected.root);
        assert_eq!(agents.subagent, expected.subagent);
        assert_eq!(agents.explicit, expected.explicit);
        assert_eq!(agents.proactive, expected.proactive);
        assert_eq!(agents.hint, None);
        let review = resolved.auto_review();
        let expected = common.auto_review();
        assert_eq!(review.policy, expected.policy);
        assert_eq!(review.policy_template, expected.policy_template);
        assert_eq!(review.node_repl_policy, expected.node_repl_policy);
        assert_eq!(
            review.rejection_instructions,
            expected.rejection_instructions
        );
        assert_eq!(review.timeout_instructions, expected.timeout_instructions);
        assert_eq!(
            resolved.guardian_classifier_instructions(),
            common.guardian_classifier_instructions()
        );
        assert_eq!(
            resolved.token_budget_reminder_template(),
            common.token_budget_reminder_template()
        );
        assert_eq!(
            resolved.persistent_instructions(),
            common.persistent_instructions()
        );
        assert_eq!(
            resolved.content_filter_guidance(),
            common.content_filter_guidance()
        );
        assert_eq!(resolved.confirmation_policies(), None);
    }

    #[test]
    fn provider_catalog_cannot_replace_or_suppress_common_policies() {
        for messages in [
            None,
            Some(ModelMessages::default()),
            Some(catalog_policies("Catalog-specific policy")),
            Some(catalog_policies("")),
        ] {
            for provider in ["openai", "anthropic", "google"] {
                let mut model = test_model(messages.clone());
                model.model_provider = provider.to_owned();
                assert_common_policies(ResolvedModelMessages::from_model(&model));
            }
        }
        assert_common_policies(ResolvedModelMessages::bundled());
    }

    #[test]
    fn technical_tool_catalog_metadata_is_preserved_alongside_common_policy() {
        for text in ["Catalog technical metadata", ""] {
            let tool = ToolMessage {
                description: Some(text.to_owned()),
                parameters: Some(r#"{"type":"object","properties":{}}"#.to_owned()),
            };
            let tools = ToolMessages {
                send_user_message_async: Some(tool.clone()),
                multi_agent: Some(MultiAgentToolMessages {
                    spawn_agent: Some(tool.clone()),
                    ..Default::default()
                }),
                code_mode: Some(CodeModeToolMessages {
                    exec: Some(tool.clone()),
                    wait: Some(tool.clone()),
                    deferred_nested_tools_guidance: Some(text.to_owned()),
                    mcp_typescript_preamble: Some(text.to_owned()),
                }),
                mcp_resources: Some(McpResourceToolMessages {
                    list_mcp_resources: Some(tool.clone()),
                    list_mcp_resource_templates: Some(tool.clone()),
                    read_mcp_resource: Some(tool.clone()),
                }),
                indirect_description_prefixes: Some(IndirectDescriptionPrefixes {
                    namespaces: Some([(String::from("functions"), text.to_owned())].into()),
                    ..Default::default()
                }),
            };
            let mut messages = catalog_policies("Ignored policy");
            messages.tools = Some(tools.clone());
            let model = test_model(Some(messages));
            let resolved = ResolvedModelMessages::from_model(&model);
            assert_common_policies(resolved);
            assert_eq!(resolved.request_user_input_async_description(), text);
            assert_eq!(
                resolved.request_user_input_async_parameters_override(),
                tool.parameters.as_deref()
            );
            assert_eq!(
                resolved.multi_agent_tool_description_override("spawn_agent"),
                Some(text)
            );
            assert_eq!(
                resolved.multi_agent_tool_parameters_override("spawn_agent"),
                tool.parameters.as_deref()
            );
            assert_eq!(
                resolved.multi_agent_tool_description_override("unknown"),
                None
            );
            assert_eq!(resolved.code_mode(), tools.code_mode.as_ref());
            assert_eq!(resolved.code_mode_wait_description_override(), Some(text));
            assert_eq!(
                resolved.code_mode_wait_parameters_override(),
                tool.parameters.as_deref()
            );
            assert_eq!(resolved.mcp_resources(), tools.mcp_resources.as_ref());
            assert_eq!(
                resolved.indirect_description_prefixes(),
                tools.indirect_description_prefixes.as_ref()
            );
        }
    }

    #[test]
    fn missing_technical_tool_metadata_retains_bundled_defaults() {
        for messages in [
            None,
            Some(ModelMessages::default()),
            Some(ModelMessages {
                tools: Some(ToolMessages::default()),
                ..Default::default()
            }),
        ] {
            let model = test_model(messages);
            let resolved = ResolvedModelMessages::from_model(&model);
            assert_eq!(
                resolved.request_user_input_async_description(),
                REQUEST_USER_INPUT_ASYNC_DESCRIPTION
            );
            assert_eq!(
                resolved.request_user_input_async_parameters_override(),
                None
            );
            assert_eq!(
                resolved.multi_agent_tool_description_override("spawn_agent"),
                None
            );
            assert_eq!(
                resolved.multi_agent_tool_parameters_override("spawn_agent"),
                None
            );
            assert_eq!(resolved.code_mode(), None);
            assert_eq!(resolved.mcp_resources(), None);
            assert_eq!(resolved.indirect_description_prefixes(), None);
        }
    }
}

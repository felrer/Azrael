mod compact;
mod guardian_instructions;
mod model_instructions;
mod model_messages;
mod multi_agent_instructions;
mod permissions_instructions;
mod realtime;
mod review_exit;
mod review_request;
mod root_coordination_instructions;
mod update_plan_instructions;

pub use compact::SUMMARIZATION_PROMPT;
pub use compact::SUMMARY_PREFIX;
pub use guardian_instructions::GuardianClassifierInstructions;
pub use guardian_instructions::GuardianPolicyInstructions;
pub use guardian_instructions::render_guardian_rejection;
pub use model_instructions::render_model_instructions;
pub use model_messages::ResolvedAutoReviewMessages;
pub use model_messages::ResolvedCollaborationModeMessages;
pub use model_messages::ResolvedMessage;
pub use model_messages::ResolvedModelMessages;
pub use model_messages::ResolvedMultiAgentMessages;
pub use multi_agent_instructions::MultiAgentRoleInstructions;
pub use permissions_instructions::ApprovalPromptContext;
pub use permissions_instructions::PermissionsInstructions;
pub use realtime::BACKEND_PROMPT;
pub use realtime::END_INSTRUCTIONS;
pub use realtime::START_INSTRUCTIONS;
pub use review_exit::render_review_exit_interrupted;
pub use review_exit::render_review_exit_success;
pub use review_request::REVIEW_PROMPT;
pub use review_request::ResolvedReviewRequest;
pub use review_request::resolve_review_request;
pub use review_request::review_prompt;
pub use review_request::user_facing_hint;
pub use root_coordination_instructions::ROOT_COORDINATION_INSTRUCTIONS;
pub use root_coordination_instructions::RootCoordinationInstructions;
pub use update_plan_instructions::without_update_plan_instructions;

/// Render harness identity on a request copy, preserving model/provider metadata elsewhere.
pub fn with_azrael_harness_identity(instructions: &str) -> String {
    const IDENTITY: &str =
        "You are working in Azrael, the application and agent harness for this workspace.";
    const LEGACY_INTROS: &[&str] = &[
        "You are Codex, an agent based on GPT-6.",
        "You are Codex, an agent based on GPT-5.",
        "You are Codex, a coding agent based on GPT-5.",
        "You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user's computer.",
        "You are GPT-5.1 running in the Codex CLI, a terminal-based coding assistant. Codex CLI is an open source project led by OpenAI.",
        "You are GPT-5.2 running in the Codex CLI, a terminal-based coding assistant. Codex CLI is an open source project led by OpenAI.",
        "You are a coding agent running in the Codex CLI, a terminal-based coding assistant. Codex CLI is an open source project led by OpenAI.",
    ];
    let mut rendered = instructions.to_owned();
    for &intro in LEGACY_INTROS {
        rendered = rendered.replace(intro, IDENTITY);
    }
    if !rendered.contains(IDENTITY) {
        rendered = format!("{IDENTITY}\n\n{rendered}");
    }
    rendered
}

#[cfg(test)]
mod azrael_identity_tests {
    use super::with_azrael_harness_identity;

    #[test]
    fn renders_saved_identity_without_mutating_source() {
        let saved = "You are Codex, an agent based on GPT-6. Keep provider instructions.";
        let rendered = with_azrael_harness_identity(saved);
        assert!(rendered.starts_with("You are working in Azrael,"));
        assert!(rendered.ends_with("Keep provider instructions."));
        assert_eq!(
            saved,
            "You are Codex, an agent based on GPT-6. Keep provider instructions."
        );
        assert_eq!(with_azrael_harness_identity(&rendered), rendered);
    }

    #[test]
    fn preserves_other_provider_identity_and_product_names() {
        let source = "You are Claude. Use the Codex API and GPT-6 model when requested.";
        let rendered = with_azrael_harness_identity(source);
        assert!(rendered.starts_with("You are working in Azrael,"));
        assert!(rendered.ends_with(source));
        assert_eq!(with_azrael_harness_identity(&rendered), rendered);
    }
}

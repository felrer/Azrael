//! Harness-owned behavior shared by every provider and model.

use codex_protocol::openai_models::ModelInfo;

/// Embedded copy of instructions/instructions/agent-behavior.md.
pub const COMMON_AGENT_INSTRUCTIONS: &str = include_str!("../templates/agent_behavior.md");

const COMMON_PARALLEL_TOOL_GUIDANCE: &str = "Run independent searches, reads, and tool calls in parallel with `Promise.allSettled` inside `functions.exec` when possible, and inspect every result. Keep dependent work, mutations, approvals, waits, and adaptive follow-ups sequential.";
const API_PARALLEL_TOOL_GUIDANCE: &str = "Call declared tools directly using their declared input schemas. Run independent searches, reads, and tool calls in parallel when the runtime supports parallel tool calls, and inspect every result. Keep dependent work, mutations, approvals, waits, and adaptive follow-ups sequential.";

/// Project only the exact leading harness-owned common block for API requests.
/// Custom instructions after that block remain verbatim; unmatched inputs are unchanged.
pub fn project_api_base_instructions(instructions: &str) -> String {
    let Some(suffix) = instructions.strip_prefix(COMMON_AGENT_INSTRUCTIONS) else {
        return instructions.to_owned();
    };
    let common = COMMON_AGENT_INSTRUCTIONS.replacen(
        COMMON_PARALLEL_TOOL_GUIDANCE,
        API_PARALLEL_TOOL_GUIDANCE,
        1,
    );
    format!("{common}{suffix}")
}

/// Catalog instruction templates do not replace the harness behavior.
pub fn render_model_instructions(_model_info: &ModelInfo) -> String {
    COMMON_AGENT_INSTRUCTIONS.to_owned()
}

/// Explicit user/workspace instructions supplement the common behavior.
/// Model-owned saved instructions are refreshed by the caller instead.
pub fn compose_agent_instructions(custom: Option<&str>) -> String {
    match custom.filter(|text| !text.is_empty()) {
        None => COMMON_AGENT_INSTRUCTIONS.to_owned(),
        Some(text) if text.starts_with(COMMON_AGENT_INSTRUCTIONS) => text.to_owned(),
        Some(text) => format!(
            "{COMMON_AGENT_INSTRUCTIONS}\n<custom_agent_instructions>\n{text}\n</custom_agent_instructions>"
        ),
    }
}

#[cfg(test)]
#[path = "model_instructions_tests.rs"]
pub(crate) mod tests;

/// Provider-specific behavior, separate from immutable runtime and actual tool authority.
pub fn compose_harness_instructions(
    prompt_variant: &str,
    behavior_template: Option<&str>,
    claude_tools: bool,
    custom: Option<&str>,
) -> String {
    if !claude_tools && behavior_template.is_none() && prompt_variant == "builtin/azrael-default" {
        return compose_agent_instructions(custom);
    }
    let default_behavior = if prompt_variant == "builtin/claude-lean" {
        include_str!("../templates/claude-lean-behavior.md").to_owned()
    } else if claude_tools {
        COMMON_AGENT_INSTRUCTIONS
            .replace("functions.request_user_input_async", "AskUserQuestion")
            .replace("functions.exec", "the declared tools")
            .replace(
                "`Promise.allSettled` inside `the declared tools`",
                "independent tool calls",
            )
            .replace("`Promise.allSettled([...])`", "independent tool calls")
    } else {
        COMMON_AGENT_INSTRUCTIONS.to_owned()
    };
    let behavior = behavior_template.unwrap_or(&default_behavior);
    let mut text = format!(
        "{}\n{}",
        include_str!("../templates/harness-runtime-core.md"),
        behavior
    );
    if claude_tools {
        text.push_str("\n");
        text.push_str(include_str!("../templates/claude-tool-environment.md"));
    }
    if let Some(custom) = custom.filter(|text| !text.is_empty()) {
        // Saved explicit instructions can include an old common prefix. Refresh only that
        // harness-owned prefix; preserve the user's actual additions verbatim.
        let custom = custom
            .strip_prefix(COMMON_AGENT_INSTRUCTIONS)
            .unwrap_or(custom);
        if !custom.trim().is_empty() {
            text.push_str(&format!(
                "\n<custom_agent_instructions>\n{custom}\n</custom_agent_instructions>"
            ));
        }
    }
    text
}

//! Harness-owned behavior shared by every provider and model.

use codex_protocol::openai_models::ModelInfo;

/// Embedded copy of instructions/instructions/agent-behavior.md.
pub const COMMON_AGENT_INSTRUCTIONS: &str = include_str!("../templates/agent_behavior.md");

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

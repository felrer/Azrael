//! Covers role composition and attribution for captured model instructions.

use super::*;
use codex_context_fragments::AnnotatedContent;
use codex_context_fragments::RenderedFragment;
use pretty_assertions::assert_eq;

#[test]
fn api_projection_preserves_role_markers_and_runtime_restrictions() {
    let role = MultiAgentRoleInstructions::Composed {
        base: "Role instructions.".to_string(),
        marked: true,
        omit_update_plan_instructions: false,
        max_concurrency: 7,
        wait_agent_enabled: true,
        expose_model_overrides: true,
        claude_tools: false,
    };
    let (start, end) = role.markers();
    let original = format!("{start}{}{end}", role.body());
    let projected = project_api_multi_agent_instructions(&original);
    assert!(!projected.contains("functions.exec"));
    assert!(!projected.contains("tools.*"));
    assert!(!projected.contains("functions.collaboration"));
    assert_eq!(
        projected,
        original.replace(
            DEFAULT_MULTI_AGENT_V2_SHARED_USAGE_HINT_TEXT,
            API_MULTI_AGENT_SHARED_USAGE_HINT_TEXT,
        )
    );
    for name in [
        "spawn_agent",
        "send_message",
        "followup_task",
        "wait_agent",
        "interrupt_agent",
        "list_agents",
    ] {
        assert!(projected.contains(&format!("`{name}`")));
    }
    assert!(projected.starts_with("<multi_agent_role>Role instructions."));
    assert!(projected.ends_with("</multi_agent_role>"));
    assert!(projected.contains("There are 7 available concurrency slots"));
    assert!(projected.contains(DEFAULT_MULTI_AGENT_V2_WAIT_AGENT_USAGE_HINT_TEXT));
    assert!(projected.contains(DEFAULT_MULTI_AGENT_V2_MODEL_OVERRIDE_USAGE_HINT_TEXT));
    let (_, workspace) = DEFAULT_MULTI_AGENT_V2_SHARED_USAGE_HINT_TEXT
        .split_once("\n\n")
        .unwrap();
    assert!(projected.contains(workspace));
    assert_eq!(project_api_multi_agent_instructions(&projected), projected);
}

#[test]
fn api_projection_preserves_user_role_text_and_unmatched_hints() {
    let user_role = "User role mentions functions.exec, tools.*, and functions.collaboration.spawn_agent.";
    let suffix = "\nKeep functions.exec literals verbatim.";
    let original = format!("{user_role}\n{DEFAULT_MULTI_AGENT_V2_SHARED_USAGE_HINT_TEXT}{suffix}");
    assert_eq!(
        project_api_multi_agent_instructions(&original),
        format!("{user_role}\n{API_MULTI_AGENT_SHARED_USAGE_HINT_TEXT}{suffix}")
    );
    assert_eq!(project_api_multi_agent_instructions(user_role), user_role);
    let partial = DEFAULT_MULTI_AGENT_V2_SHARED_USAGE_HINT_TEXT.trim_end();
    assert_eq!(project_api_multi_agent_instructions(partial), partial);
}

#[test]
fn configured_canonical_hint_has_distinct_provenance_and_renders_verbatim() {
    let instructions =
        MultiAgentRoleInstructions::Configured(DEFAULT_MULTI_AGENT_V2_SHARED_USAGE_HINT_TEXT.into());
    assert_eq!(
        instructions.content_kind(),
        ContentItemKind("multi_agent.configured_role_instructions".to_string())
    );
    assert_eq!(instructions.body(), DEFAULT_MULTI_AGENT_V2_SHARED_USAGE_HINT_TEXT);
    assert_eq!(instructions.markers(), ("", ""));
    assert_eq!(
        instructions.render_fragment(),
        RenderedFragment::new(
            "developer",
            AnnotatedContent::input_text(
                DEFAULT_MULTI_AGENT_V2_SHARED_USAGE_HINT_TEXT.to_string(),
                ContentItemKind("multi_agent.configured_role_instructions".to_string()),
            ),
        )
    );
}

#[test]
fn role_segment_filters_base_and_appends_bundled_guidance() {
    let shared = DEFAULT_MULTI_AGENT_V2_SHARED_USAGE_HINT_TEXT;
    let wait = DEFAULT_MULTI_AGENT_V2_WAIT_AGENT_USAGE_HINT_TEXT;
    let model_override = DEFAULT_MULTI_AGENT_V2_MODEL_OVERRIDE_USAGE_HINT_TEXT;
    let expected_body = format!(
        "Role.\n## Work\nContinue.\n{shared}\n{wait}\n\nThere are 2 available concurrency slots, meaning that up to 2 agents can be active at once, including you.\n\n{model_override}"
    );
    for marked in [false, true] {
        let instructions = MultiAgentRoleInstructions::Composed {
            base: "Role.\n## Plan tool\nOmit role checklist guidance.\n## Work\nContinue."
                .to_string(),
            marked,
            omit_update_plan_instructions: true,
            max_concurrency: 2,
            wait_agent_enabled: true,
            expose_model_overrides: true,
            claude_tools: false,
        };
        let expected_text = if marked {
            format!("<multi_agent_role>{expected_body}</multi_agent_role>")
        } else {
            expected_body.clone()
        };
        assert_eq!(
            instructions.render_fragment(),
            RenderedFragment::new(
                "developer",
                AnnotatedContent::input_text(
                    expected_text,
                    ContentItemKind("multi_agent.role_instructions".to_string()),
                ),
            ),
        );
    }
}

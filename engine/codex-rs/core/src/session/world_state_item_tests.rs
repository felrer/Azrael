//! Verifies prefix placement and item boundaries in initial session context assembly.

use super::step_context::StepContext;
use super::tests::make_session_and_context;
use crate::context::BaseInstructionsFragment;
use crate::context::ContextualUserFragment;
use crate::context::DeveloperInstructions;
use crate::context::UserInstructions;
use crate::context::world_state::Placement;
use crate::context::world_state::PreviousSectionState;
use crate::context::world_state::SectionTransition;
use crate::context::world_state::WorldState;
use crate::context::world_state::WorldStateSection;
use crate::context::world_state::WorldStateUpdate;
use crate::context::world_state::WorldStateUpdateContent;
use crate::context::world_state::split_prefix_updates;
use crate::context_manager::updates::merge_world_state_updates;
use codex_protocol::models::ResponseItem;
use core_test_support::responses::strip_metadata_from_items;
use pretty_assertions::assert_eq;
use serde_json::json;
use std::sync::Arc;

struct ItemSection;

impl WorldStateSection for ItemSection {
    const ID: &'static str = "items";
    type Snapshot = bool;

    fn render_diff(
        &self,
        _: PreviousSectionState<'_, Self::Snapshot>,
    ) -> SectionTransition<Self::Snapshot> {
        (
            Some(true),
            vec![
                WorldStateUpdate {
                    placement: Placement::Prefix,
                    content: WorldStateUpdateContent::Item(Box::new(additional_tools("example"))),
                },
                WorldStateUpdate {
                    placement: Placement::Prefix,
                    ..WorldStateUpdate::fragment(BaseInstructionsFragment(
                        "base instructions".to_string(),
                    ))
                },
                WorldStateUpdate::fragment(DeveloperInstructions::new("before item")),
                WorldStateUpdate::fragment(UserInstructions {
                    directory: None,
                    text: "user before item".to_string(),
                }),
                WorldStateUpdate::fragment(DeveloperInstructions::new("separate before item"))
                    .standalone(),
                WorldStateUpdate {
                    placement: Placement::Standalone,
                    content: WorldStateUpdateContent::Item(Box::new(additional_tools("middle"))),
                },
                WorldStateUpdate {
                    placement: Placement::Mergeable,
                    content: WorldStateUpdateContent::Item(Box::new(additional_tools("adjacent"))),
                },
                WorldStateUpdate::fragment(DeveloperInstructions::new("after item")),
                WorldStateUpdate::fragment(UserInstructions {
                    directory: None,
                    text: "user after item".to_string(),
                }),
                WorldStateUpdate {
                    placement: Placement::Standalone,
                    content: WorldStateUpdateContent::Item(Box::new(additional_tools("trailing"))),
                },
            ],
        )
    }
}

fn additional_tools(name: &str) -> ResponseItem {
    ResponseItem::AdditionalTools {
        id: None,
        role: "developer".to_string(),
        tools: vec![json!({"type": "function", "name": name})],
    }
}

#[tokio::test]
async fn initial_context_preserves_world_state_items_and_snapshot() {
    let (session, turn_context) = make_session_and_context().await;
    let step_context = StepContext::for_test(Arc::new(turn_context));
    let mut world_state = WorldState::default();
    world_state.add_section(ItemSection);
    let (updates, snapshot) = session
        .build_initial_context_with_world_state(&step_context, &world_state)
        .await;
    let (prefix, context) = split_prefix_updates(updates);
    assert_eq!(
        strip_metadata_from_items(&prefix),
        strip_metadata_from_items(&[
            additional_tools("example"),
            ContextualUserFragment::into(BaseInstructionsFragment("base instructions".to_string())),
        ]),
    );
    assert_eq!(
        strip_metadata_from_items(&merge_world_state_updates(context)),
        strip_metadata_from_items(&[
            ContextualUserFragment::into(DeveloperInstructions::new("before item")),
            ContextualUserFragment::into(DeveloperInstructions::new("separate before item")),
            ContextualUserFragment::into(UserInstructions {
                directory: None,
                text: "user before item".to_string(),
            }),
            additional_tools("middle"),
            additional_tools("adjacent"),
            ContextualUserFragment::into(DeveloperInstructions::new("after item")),
            ContextualUserFragment::into(UserInstructions {
                directory: None,
                text: "user after item".to_string(),
            }),
            additional_tools("trailing"),
        ]),
    );
    assert_eq!(
        serde_json::to_value(snapshot).unwrap(),
        json!({"items": true})
    );
}

#[test_case::test_case(codex_protocol::protocol::SessionSource::Exec; "exec root")]
#[test_case::test_case(codex_protocol::protocol::SessionSource::VSCode; "vscode root")]
#[test_case::test_case(codex_protocol::protocol::SessionSource::Mcp; "app server root")]
#[test_case::test_case(codex_protocol::protocol::SessionSource::Custom("provider".to_string()); "custom root")]
#[test_case::test_case(codex_protocol::protocol::SessionSource::SubAgent(codex_protocol::protocol::SubAgentSource::Review); "subagent excluded")]
#[test_case::test_case(codex_protocol::protocol::SessionSource::Internal(codex_protocol::protocol::InternalSessionSource::Guardian); "internal excluded")]
#[tokio::test]
async fn root_coordination_common_context_is_gated_by_session_source(
    source: codex_protocol::protocol::SessionSource,
) {
    for version in [
        codex_protocol::protocol::MultiAgentVersion::Disabled,
        codex_protocol::protocol::MultiAgentVersion::V2,
    ] {
        for hint in [None, Some(""), Some("Configured root role")] {
            let (session, mut turn_context) = make_session_and_context().await;
            let root = !source.is_non_root_agent();
            turn_context.session_source = source.clone();
            turn_context.multi_agent_version = version;
            Arc::make_mut(&mut turn_context.config)
                .multi_agent_v2
                .root_agent_usage_hint_text = hint.map(str::to_string);
            let step_context = StepContext::for_test(Arc::new(turn_context));
            let world_state = session
                .build_world_state_for_step(&step_context, true)
                .await
                .unwrap();
            let (updates, snapshot) = session
                .build_initial_context_with_world_state(&step_context, &world_state)
                .await;
            let (_, context) = split_prefix_updates(updates);
            let messages = merge_world_state_updates(context);
            let root_messages = messages
                .iter()
                .filter(|item| {
                    matches!(item, ResponseItem::Message { role, content, .. }
                    if role == "developer" && content.iter().any(|part|
                        matches!(part, codex_protocol::models::ContentItem::InputText { text }
                            if codex_prompts::RootCoordinationInstructions::matches_text(text))))
                })
                .collect::<Vec<_>>();
            assert_eq!(root_messages.len(), usize::from(root));
            assert_eq!(
                serde_json::to_value(snapshot)
                    .unwrap()
                    .get("azrael_root_coordination")
                    .is_some(),
                root
            );
            if root {
                assert!(
                    matches!(root_messages[0], ResponseItem::Message { content, .. } if content.len() == 1)
                );
            }
        }
    }
}

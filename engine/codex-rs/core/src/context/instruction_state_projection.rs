//! Prompt-only projection of explicitly replaceable, producer-typed instructions.
//! Persisted history remains intact; text alone never identifies instruction state.

use codex_history::ResponseItemEnvelope;
use codex_protocol::models::ContentItem;
use codex_protocol::models::ResponseItem;
use codex_skills_extension::InjectedHostSkillPrompts;
use codex_skills_extension::project_api_skill_fragment;
use std::collections::HashSet;

fn replaceable_kind(role: &str, kind: &str) -> Option<&'static str> {
    match (role, kind) {
        ("developer", "managed_config.developer_instructions") => {
            Some("managed_config.developer_instructions")
        }
        ("user", "agents_md.instructions") => Some("agents_md.instructions"),
        ("developer", "apps.instructions") => Some("apps.instructions"),
        ("developer", "plugins.usage_instructions") => Some("plugins.usage_instructions"),
        ("developer", "environments.instructions") => Some("environments.instructions"),
        ("developer", "host_skills.instructions") => Some("host_skills.instructions"),
        ("developer", "model_switch.instructions") => Some("model_switch.instructions"),
        // Environment context contains deltas; generic developer instructions,
        // permissions, plugin activations and skill invocations are additive.
        _ => None,
    }
}

/// Keep the last contribution for each explicitly replaceable instruction kind.
/// Removal notices use the same kind, so they replace the previous active state.
/// Call on a prompt copy before dropping provenance or estimating prompt tokens.
pub(crate) fn project_instruction_state(
    items: Vec<ResponseItemEnvelope>,
) -> Vec<ResponseItemEnvelope> {
    project_instruction_state_indexed(items)
        .into_iter()
        .map(|(_, envelope)| envelope)
        .collect()
}

fn project_instruction_state_indexed(
    items: Vec<ResponseItemEnvelope>,
) -> Vec<(usize, ResponseItemEnvelope)> {
    let mut seen = HashSet::new();
    let mut projected = Vec::with_capacity(items.len());
    for (index, mut envelope) in items.into_iter().enumerate().rev() {
        let ResponseItem::Message {
            role,
            content,
            internal_chat_message_metadata_passthrough: Some(metadata),
            ..
        } = &mut envelope.item
        else {
            projected.push((index, envelope));
            continue;
        };
        let Some(kinds) = &mut metadata.content_item_kinds else {
            projected.push((index, envelope));
            continue;
        };
        // Malformed or incomplete provenance cannot authorize removal.
        if kinds.len() != content.len() {
            projected.push((index, envelope));
            continue;
        }
        let mut retained = Vec::with_capacity(content.len());
        let mut retained_kinds = Vec::with_capacity(kinds.len());
        let mut removed = false;
        for (part, kind) in std::mem::take(content)
            .into_iter()
            .zip(std::mem::take(kinds))
            .rev()
        {
            let key = matches!(&part, ContentItem::InputText { .. })
                .then(|| replaceable_kind(role, &kind.0))
                .flatten();
            if key.is_some_and(|key| !seen.insert(key)) {
                removed = true;
            } else {
                retained.push(part);
                retained_kinds.push(kind);
            }
        }
        retained.reverse();
        retained_kinds.reverse();
        *content = retained;
        *kinds = retained_kinds;
        if !removed || !content.is_empty() {
            projected.push((index, envelope));
        }
    }
    projected.reverse();
    project_skill_bodies(projected)
}

/// Retain the first delivered copy of each selected skill path and exact body.
/// Rebuild from this prompt's retained items so compaction/reset permits reinjection.
fn project_skill_bodies(
    items: Vec<(usize, ResponseItemEnvelope)>,
) -> Vec<(usize, ResponseItemEnvelope)> {
    let mut delivered = InjectedHostSkillPrompts::default();
    items
        .into_iter()
        .filter_map(|(index, mut envelope)| {
            let ResponseItem::Message {
                role,
                content,
                internal_chat_message_metadata_passthrough: Some(metadata),
                ..
            } = &mut envelope.item
            else {
                return Some((index, envelope));
            };
            if role != "user" {
                return Some((index, envelope));
            }
            let Some(kinds) = &mut metadata.content_item_kinds else {
                return Some((index, envelope));
            };
            if kinds.len() != content.len() {
                return Some((index, envelope));
            }
            let mut retained = Vec::with_capacity(content.len());
            let mut retained_kinds = Vec::with_capacity(kinds.len());
            let mut removed = false;
            for (part, kind) in std::mem::take(content)
                .into_iter()
                .zip(std::mem::take(kinds))
            {
                if let ContentItem::InputText { text } = &part {
                    if delivered.contains_fragment(&kind.0, text) {
                        removed = true;
                        continue;
                    }
                    delivered.insert_fragment(&kind.0, text);
                }
                retained.push(part);
                retained_kinds.push(kind);
            }
            *content = retained;
            *kinds = retained_kinds;
            (!removed || !content.is_empty()).then_some((index, envelope))
        })
        .collect()
}

/// Apply the selected model's host skill visibility to retained prompt history.
/// Envelope delivery/authorization metadata remains attached to surviving items.
pub(crate) fn project_instruction_state_for_model(
    items: Vec<ResponseItemEnvelope>,
    model_slug: Option<&str>,
) -> Vec<ResponseItemEnvelope> {
    let projected = project_instruction_state(items);
    if !model_slug.is_some_and(|slug| slug.starts_with("api/")) {
        return projected;
    }
    projected
        .into_iter()
        .filter_map(|mut envelope| project_api_skill_item(&mut envelope.item).then_some(envelope))
        .collect()
}

/// Project the complete history before selecting an original-history usage boundary.
/// Projection may remove entries before or after that boundary, but never renumbers it.
pub(crate) fn project_instruction_state_since_for_model(
    items: Vec<ResponseItemEnvelope>,
    model_slug: Option<&str>,
    start: usize,
) -> Vec<ResponseItemEnvelope> {
    project_instruction_state_indexed(items)
        .into_iter()
        .filter_map(|(index, mut envelope)| {
            if model_slug.is_some_and(|slug| slug.starts_with("api/"))
                && !project_api_skill_item(&mut envelope.item)
            {
                return None;
            }
            (index >= start).then_some(envelope)
        })
        .collect()
}

/// API-only skill and owned tool-guidance projection on a typed prompt copy.
pub(crate) fn project_api_skill_context(items: Vec<ResponseItem>) -> Vec<ResponseItem> {
    items
        .into_iter()
        .filter_map(|mut item| project_api_skill_item(&mut item).then_some(item))
        .collect()
}

fn project_api_skill_item(item: &mut ResponseItem) -> bool {
    let ResponseItem::Message {
        role,
        content,
        internal_chat_message_metadata_passthrough: Some(metadata),
        ..
    } = item
    else {
        return true;
    };
    let Some(kinds) = &mut metadata.content_item_kinds else {
        return true;
    };
    if kinds.len() != content.len() {
        return true;
    }
    let mut retained = Vec::with_capacity(content.len());
    let mut retained_kinds = Vec::with_capacity(kinds.len());
    let mut removed = false;
    for (mut part, kind) in std::mem::take(content)
        .into_iter()
        .zip(std::mem::take(kinds))
    {
        if role == "developer"
            && matches!(
                kind.0.as_str(),
                "multi_agent.role_instructions" | "multi_agent.usage_hint"
            )
            && let ContentItem::InputText { text } = &mut part
        {
            *text = codex_prompts::project_api_multi_agent_instructions(text);
        }
        let expected_role = matches!(
            (role.as_str(), kind.0.as_str()),
            ("user", "skills.selected_skill_instructions")
                | ("developer", "host_skills.instructions" | "skills.catalog")
        );
        if expected_role && let ContentItem::InputText { text } = &mut part {
            match project_api_skill_fragment(&kind.0, text) {
                Some(projected) => *text = projected,
                None => {
                    removed = true;
                    continue;
                }
            }
        }
        retained.push(part);
        retained_kinds.push(kind);
    }
    *content = retained;
    *kinds = retained_kinds;
    !removed || !content.is_empty()
}

#[cfg(test)]
#[path = "instruction_state_projection_tests.rs"]
mod tests;

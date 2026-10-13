use std::collections::HashMap;

use codex_skills::SkillMetadata;

use crate::HostSkillsSnapshot;
use crate::catalog::SkillCatalog;
use crate::catalog::SkillCatalogEntry;
use crate::catalog::SkillSourceKind;

/// Compact identical host copies for API prompts without changing read access or
/// the underlying snapshot. Read only repeated visible names, through their owner.
pub(super) async fn hide_duplicate_host_prompts(
    catalog: &mut SkillCatalog,
    model_slug: &str,
    snapshot: &HostSkillsSnapshot,
) {
    if !model_slug.starts_with("api/") {
        return;
    }

    let mut groups: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, entry) in catalog.entries.iter().enumerate() {
        if entry.authority.kind == SkillSourceKind::Host && entry.is_model_visible() {
            groups.entry(entry.name.clone()).or_default().push(index);
        }
    }
    let skills_by_resource: HashMap<_, _> = snapshot
        .outcome()
        .skills
        .iter()
        .map(|skill| (skill.path_to_skills_md.inferred_native_path_string(), skill))
        .collect();

    for indices in groups.values_mut().filter(|indices| indices.len() > 1) {
        // Match the renderer's first-root precedence without reordering entries.
        indices.sort_by_key(|index| {
            catalog.entries[*index]
                .alias_root_order()
                .unwrap_or(usize::MAX)
        });
        // Bodies are scoped to this discovery, never cached
        // across turns: filesystem contents can change without metadata changing.
        let mut retained: Vec<(usize, &SkillMetadata, String)> = Vec::new();
        for &index in indices.iter() {
            let entry = &catalog.entries[index];
            let Some(&skill) = skills_by_resource.get(entry.main_prompt.as_str()) else {
                continue;
            };
            let Ok(body) = snapshot.read_skill_text(skill).await else {
                // A read failure cannot establish equality; keep this copy visible.
                continue;
            };
            let duplicate = retained
                .iter()
                .any(|(previous, previous_skill, previous_body)| {
                    same_prompt_metadata(&catalog.entries[*previous], entry)
                        && same_source_metadata(previous_skill, skill)
                        && previous_body == &body
                });
            if duplicate {
                catalog.entries[index].prompt_visible = false;
            } else {
                retained.push((index, skill, body));
            }
        }
    }
}

fn same_prompt_metadata(left: &SkillCatalogEntry, right: &SkillCatalogEntry) -> bool {
    left.authority == right.authority
        && left.name == right.name
        && left.description == right.description
        && left.short_description == right.short_description
        && left.dependencies == right.dependencies
        && left.prompt_scope() == right.prompt_scope()
        && left.plugin_id == right.plugin_id
        && left.canonical_skill_id == right.canonical_skill_id
        && left.analytics_scope == right.analytics_scope
        && left.enabled == right.enabled
        && left.prompt_visible == right.prompt_visible
}

fn same_source_metadata(left: &SkillMetadata, right: &SkillMetadata) -> bool {
    left.name == right.name
        && left.description == right.description
        && left.short_description == right.short_description
        && left.dependencies == right.dependencies
        && left.scope == right.scope
        && left.plugin_id == right.plugin_id
        && left.remote_plugin_id == right.remote_plugin_id
        && left.interface == right.interface
        && left.policy == right.policy
}

#[cfg(test)]
#[path = "api_host_dedup_tests.rs"]
mod tests;

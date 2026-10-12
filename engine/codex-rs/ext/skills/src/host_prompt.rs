use std::collections::HashSet;

use codex_extension_api::ContextualUserFragment;
use codex_skills::SkillMetadata;
use codex_skills::normalize_skill_path;

use crate::HostSkillsSnapshot;
use crate::fragments::SkillInstructions;
use crate::render::truncate_main_prompt_contents;

/// Host skill prompts already supplied or superseded by an extension.
///
/// Core preserves its host skill invocation lifecycle while avoiding duplicate
/// prompts and retaining executor/cloud skill precedence.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InjectedHostSkillPrompts {
    paths: HashSet<String>,
    superseded_paths: HashSet<String>,
    bodies: HashSet<(String, [u8; 32])>,
}

impl InjectedHostSkillPrompts {
    /// Records a body from a harness-classified, retained skill fragment.
    /// Rebuild this set from actual retained context rather than caching it across turns.
    pub fn insert_fragment(&mut self, content_kind: &str, text: &str) -> bool {
        let Some((path, contents)) = selected_skill_body(content_kind, text) else {
            return false;
        };
        let path = normalize_host_skill_path(path);
        // Only the latest delivered body at this path suppresses a repeat.
        // A changed body, including a return to earlier contents, must be delivered.
        self.bodies
            .retain(|(retained_path, _)| retained_path != &path);
        self.bodies
            .insert((path, *blake3::hash(contents.as_bytes()).as_bytes()));
        true
    }

    pub fn contains_fragment(&self, content_kind: &str, text: &str) -> bool {
        selected_skill_body(content_kind, text).is_some_and(|(path, contents)| {
            self.bodies.contains(&(
                normalize_host_skill_path(path),
                *blake3::hash(contents.as_bytes()).as_bytes(),
            ))
        })
    }

    pub fn insert_path(&mut self, path: impl Into<String>) {
        let path = path.into();
        self.paths.insert(normalize_host_skill_path(&path));
        self.paths.insert(path);
    }

    pub fn insert_superseded_path(&mut self, path: impl Into<String>) {
        let path = path.into();
        self.superseded_paths
            .insert(normalize_host_skill_path(&path));
        self.insert_path(path);
    }

    pub fn is_empty(&self) -> bool {
        self.paths.is_empty()
    }

    pub fn contains_path(&self, path: &str) -> bool {
        self.paths.contains(path) || self.paths.contains(&normalize_host_skill_path(path))
    }

    pub fn is_superseded_path(&self, path: &str) -> bool {
        self.superseded_paths
            .contains(&normalize_host_skill_path(path))
    }
}

pub(crate) fn api_excluded_skill_name(name: &str) -> bool {
    matches!(
        name.rsplit(':').next().unwrap_or(name),
        "window-use" | "control-chrome" | "control-in-app-browser" | "computer-use"
    )
}

/// Hide known desktop skill instructions only in the caller's API prompt copy.
/// Historical custom dependency metadata is not present in rendered fragments.
pub fn project_api_skill_fragment(content_kind: &str, text: &str) -> Option<String> {
    if content_kind == "skills.selected_skill_instructions" {
        return match selected_skill_fields(content_kind, text) {
            Some((name, _, _)) if api_excluded_skill_name(name) => None,
            _ => Some(text.to_string()),
        };
    }
    if !matches!(content_kind, "host_skills.instructions" | "skills.catalog") {
        return Some(text.to_string());
    }
    let Some(body) = text
        .strip_prefix("<skills_instructions>")
        .and_then(|body| body.strip_suffix("</skills_instructions>"))
    else {
        return Some(text.to_string());
    };
    let mut in_catalog = false;
    let mut projected = String::from("<skills_instructions>");
    for line in body.split_inclusive('\n') {
        let row = line.strip_suffix('\n').unwrap_or(line);
        if row == "### Available skills" {
            in_catalog = true;
        } else if row.starts_with("## ") || row.starts_with("### ") {
            in_catalog = false;
        }
        let excluded = in_catalog
            && row.strip_prefix("- ").is_some_and(|row| {
                let Some((name, details)) = row.split_once(": ") else {
                    return false;
                };
                let Some((_, locator)) = details.rsplit_once("(file: ") else {
                    return false;
                };
                locator
                    .strip_suffix(')')
                    .is_some_and(|path| !path.is_empty())
                    && api_excluded_skill_name(name)
            });
        if !excluded {
            projected.push_str(line);
        }
    }
    projected.push_str("</skills_instructions>");
    Some(projected)
}

fn selected_skill_body<'a>(content_kind: &str, text: &'a str) -> Option<(&'a str, &'a str)> {
    selected_skill_fields(content_kind, text).map(|(_, path, contents)| (path, contents))
}

fn selected_skill_fields<'a>(
    content_kind: &str,
    text: &'a str,
) -> Option<(&'a str, &'a str, &'a str)> {
    if content_kind != "skills.selected_skill_instructions" {
        return None;
    }
    // Parse only the exact harness envelope. Skill contents can themselves contain
    // XML-like tags, so never search or trim inside the body.
    let text = text.strip_prefix("<skill>\n<name>")?;
    let (name, text) = text.split_once("</name>\n<path>")?;
    let (path, mut text) = text.split_once("</path>")?;
    if name.is_empty() || path.is_empty() {
        return None;
    }
    if let Some(access) = text.strip_prefix("\n<resource_access>") {
        let (_, remaining) = access.split_once("</resource_access>")?;
        text = remaining;
    }
    let contents = text.strip_prefix('\n')?.strip_suffix("\n</skill>")?;
    Some((name, path, contents))
}

/// Prompt fragments and read outcomes for a set of selected host skills.
pub struct HostSkillPrompts {
    pub fragments: Vec<Box<dyn ContextualUserFragment + Send>>,
    pub injected: Vec<SkillMetadata>,
    pub warnings: Vec<String>,
}

fn normalize_host_skill_path(path: &str) -> String {
    normalize_skill_path(path).replace('\\', "/")
}

impl HostSkillsSnapshot {
    /// Reads selected host skills and builds their model-visible prompt fragments.
    ///
    /// Core calls this directly, including for hosts without an installed skills extension.
    #[tracing::instrument(
        level = "trace",
        skip_all,
        fields(selected_skill_count = selected_skills.len())
    )]
    pub async fn load_skill_prompts(&self, selected_skills: &[SkillMetadata]) -> HostSkillPrompts {
        let mut prompts = HostSkillPrompts {
            fragments: Vec::with_capacity(selected_skills.len()),
            injected: Vec::with_capacity(selected_skills.len()),
            warnings: Vec::new(),
        };

        for skill in selected_skills {
            match self.read_skill_text(skill).await {
                Ok(contents) => {
                    let (contents, truncated) = if self.outcome().is_agent_plugin_skill(skill) {
                        truncate_main_prompt_contents(&contents)
                    } else {
                        (contents, false)
                    };
                    if truncated {
                        prompts.warnings.push(format!(
                            "Skill `{}` exceeded the main prompt context limit and was truncated.",
                            skill.name
                        ));
                    }
                    prompts.fragments.push(Box::new(SkillInstructions {
                        name: skill.name.clone(),
                        path: skill.path_to_skills_md.inferred_native_path_string(),
                        contents,
                        resource_access: None,
                    }));
                    prompts.injected.push(skill.clone());
                }
                Err(err) => {
                    prompts.warnings.push(format!(
                        "Failed to load skill {} at {}: {err:#}",
                        skill.name,
                        skill.path_to_skills_md.inferred_native_path_string()
                    ));
                }
            }
        }

        prompts
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KIND: &str = "skills.selected_skill_instructions";

    fn fragment(path: &str, contents: &str) -> String {
        SkillInstructions {
            name: "test".to_string(),
            path: path.to_string(),
            contents: contents.to_string(),
            resource_access: None,
        }
        .render()
    }

    #[test]
    fn retained_bodies_match_path_and_exact_contents() {
        let mut retained = InjectedHostSkillPrompts::default();
        let text = fragment(
            "C:\\skills\\test\\SKILL.md",
            "body\n<path>body tag</path>\n",
        );
        assert!(retained.insert_fragment(KIND, &text));
        assert!(retained.contains_fragment(KIND, &text));
        assert!(retained.contains_fragment(
            KIND,
            &fragment("C:/skills/test/SKILL.md", "body\n<path>body tag</path>\n")
        ));
        assert!(!retained.contains_fragment(KIND, &fragment("C:/skills/test/SKILL.md", "changed")));
        assert!(!retained.contains_fragment(KIND, &fragment("C:/skills/other/SKILL.md", "body")));
        assert!(!InjectedHostSkillPrompts::default().contains_fragment(KIND, &text));
    }

    #[test]
    fn untyped_or_malformed_text_is_not_a_retained_skill() {
        let mut retained = InjectedHostSkillPrompts::default();
        assert!(!retained.insert_fragment("generic", &fragment("/skill", "body")));
        assert!(!retained.insert_fragment(KIND, "<skill>quoted skill</skill>"));
        assert!(!retained.insert_fragment(KIND, &fragment("", "body")));
        assert!(!retained.contains_fragment(KIND, &fragment("/skill", "body")));
    }

    #[test]
    fn body_reversion_is_delivered_and_other_paths_remain_cached() {
        let mut retained = InjectedHostSkillPrompts::default();
        let first = fragment("C:/skills/test/SKILL.md", "A");
        let changed = fragment("C:\\skills\\test\\SKILL.md", "B");
        let other = fragment("C:/skills/other/SKILL.md", "other");
        assert!(retained.insert_fragment(KIND, &other));
        assert!(retained.insert_fragment(KIND, &first));
        assert!(retained.contains_fragment(KIND, &first));
        assert!(retained.insert_fragment(KIND, &changed));
        assert!(!retained.contains_fragment(KIND, &first));
        assert!(retained.contains_fragment(KIND, &changed));
        assert!(retained.insert_fragment(KIND, &first));
        assert!(retained.contains_fragment(KIND, &first));
        assert!(!retained.contains_fragment(KIND, &changed));
        assert!(retained.contains_fragment(KIND, &other));
    }

    #[test]
    fn resource_access_does_not_change_body_identity() {
        let mut retained = InjectedHostSkillPrompts::default();
        let text = fragment("/skill", "body");
        assert!(retained.insert_fragment(KIND, &text));
        let with_access = text.replace(
            "</path>\n",
            "</path>\n<resource_access>{\"package\":\"test\"}</resource_access>\n",
        );
        assert!(retained.contains_fragment(KIND, &with_access));
    }

    #[test]
    fn api_projection_hides_only_known_typed_selected_skills() {
        for name in [
            "window-use",
            "chrome:control-chrome",
            "browser:control-in-app-browser",
            "computer-use:computer-use",
        ] {
            let text = SkillInstructions {
                name: name.to_string(),
                path: "/skill/SKILL.md".to_string(),
                contents: "body".to_string(),
                resource_access: None,
            }
            .render();
            assert_eq!(project_api_skill_fragment(KIND, &text), None);
            assert_eq!(project_api_skill_fragment("generic", &text), Some(text));
        }
        let ordinary = fragment("/skill/SKILL.md", "mentions window-use in its body");
        assert_eq!(project_api_skill_fragment(KIND, &ordinary), Some(ordinary));
        let malformed = "<skill>\n<name>window-use</name>\n<path></path>\nbody\n</skill>";
        assert_eq!(
            project_api_skill_fragment(KIND, malformed),
            Some(malformed.to_string())
        );
    }

    #[test]
    fn api_projection_preserves_catalog_text_and_unrelated_rows() {
        let removed = "- browser:control-in-app-browser: browser (file: /browser/SKILL.md)\n";
        let preserved = "- ordinary: description mentions window-use (file: /ordinary/SKILL.md)\n- window-use: executor (executor package: skill://executor)\n- window-use: malformed (file: )\n";
        let text = format!(
            "<skills_instructions>\n## Skills\n### Available skills\n{removed}{preserved}### How to use skills\n- window-use: quoted example (file: /example)\n</skills_instructions>"
        );
        let expected = text.replacen(removed, "", 1);
        for kind in ["host_skills.instructions", "skills.catalog"] {
            assert_eq!(
                project_api_skill_fragment(kind, &text),
                Some(expected.clone())
            );
            assert_eq!(
                project_api_skill_fragment(kind, removed),
                Some(removed.to_string())
            );
        }
        assert_eq!(project_api_skill_fragment("generic", &text), Some(text));
    }
}

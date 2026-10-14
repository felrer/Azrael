//! Skill-related configuration types shared across crates.

use std::collections::HashSet;
use std::num::NonZeroUsize;

use crate::ConfigLayerSource;
use crate::ConfigLayerStack;
use codex_utils_absolute_path::AbsolutePathBuf;
use codex_utils_path_uri::PathUri;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use tracing::warn;

const fn default_enabled() -> bool {
    true
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct SkillConfig {
    /// Path-based selector.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<AbsolutePathBuf>,
    /// Name-based selector.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub enabled: bool,
}

/// Skills required from one environment or plugin before inference.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ScopedSkillsConfig {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub required: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct SkillsConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundled: Option<BundledSkillsConfig>,

    /// Whether turns receive the automatic skills instructions block.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_instructions: Option<bool>,

    /// Maximum tokens used by the available-skills catalog. Defaults to 2% of
    /// the model context window and is capped at 10,000 tokens when set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_context_tokens: Option<NonZeroUsize>,

    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub config: Vec<SkillConfig>,

    /// Additional local skill roots from the effective configuration.
    #[serde(
        default,
        skip_serializing_if = "Vec::is_empty",
        deserialize_with = "deserialize_extra_roots"
    )]
    pub extra_roots: Vec<AbsolutePathBuf>,
}

fn deserialize_extra_roots<'de, D>(deserializer: D) -> Result<Vec<AbsolutePathBuf>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Vec::<std::path::PathBuf>::deserialize(deserializer)?
        .into_iter()
        .map(|path| {
            if !path.is_absolute() {
                return Err(serde::de::Error::custom(format!(
                    "skill root must be absolute: {}",
                    path.display()
                )));
            }
            AbsolutePathBuf::from_absolute_path_checked(path).map_err(serde::de::Error::custom)
        })
        .collect()
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct BundledSkillsConfig {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

impl Default for BundledSkillsConfig {
    fn default() -> Self {
        Self { enabled: true }
    }
}

impl TryFrom<toml::Value> for SkillsConfig {
    type Error = toml::de::Error;

    fn try_from(value: toml::Value) -> Result<Self, Self::Error> {
        SkillsConfig::deserialize(value)
    }
}

/// Selects configured skills by their name or canonical document path.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum SkillConfigRuleSelector {
    Name(String),
    Path(PathUri),
}

/// Enables or disables every skill matched by its selector.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SkillConfigRule {
    pub selector: SkillConfigRuleSelector,
    pub enabled: bool,
}

/// Ordered effective skill enablement rules from configuration layers.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash)]
pub struct SkillConfigRules {
    pub entries: Vec<SkillConfigRule>,
}

impl SkillConfigRules {
    /// Applies rules in order; later rules override earlier rules for matching skills.
    ///
    /// Explicit path selectors remain effective even when no current skill matches.
    pub fn resolve_disabled_paths<'a>(
        &self,
        skills: impl IntoIterator<Item = (&'a str, &'a PathUri)> + Clone,
    ) -> HashSet<PathUri> {
        let mut disabled_paths = HashSet::new();

        for entry in &self.entries {
            match &entry.selector {
                SkillConfigRuleSelector::Path(path) => {
                    if entry.enabled {
                        disabled_paths.remove(path);
                    } else {
                        disabled_paths.insert(path.clone());
                    }
                }
                SkillConfigRuleSelector::Name(name) => {
                    for (skill_name, path) in skills.clone() {
                        if skill_name != name {
                            continue;
                        }
                        if entry.enabled {
                            disabled_paths.remove(path);
                        } else {
                            disabled_paths.insert(path.clone());
                        }
                    }
                }
            }
        }

        disabled_paths
    }
}

/// Returns whether bundled skills are enabled by the effective configuration.
pub fn bundled_skills_enabled_from_stack(config_layer_stack: &ConfigLayerStack) -> bool {
    let effective_config = config_layer_stack.effective_config();
    let Some(skills_value) = effective_config
        .as_table()
        .and_then(|table| table.get("skills"))
    else {
        return true;
    };

    let skills: SkillsConfig = match skills_value.clone().try_into() {
        Ok(skills) => skills,
        Err(err) => {
            warn!("invalid skills config: {err}");
            return true;
        }
    };

    skills.bundled.unwrap_or_default().enabled
}

/// Resolves skill enablement rules from user and session configuration layers.
pub fn skill_config_rules_from_stack(config_layer_stack: &ConfigLayerStack) -> SkillConfigRules {
    let mut entries = Vec::new();
    for layer in config_layer_stack.all_layers_low_to_high() {
        if !matches!(
            layer.name,
            ConfigLayerSource::User { .. } | ConfigLayerSource::SessionFlags
        ) {
            continue;
        }

        let Some(skills_value) = layer.config.get("skills") else {
            continue;
        };
        let skills: SkillsConfig = match skills_value.clone().try_into() {
            Ok(skills) => skills,
            Err(err) => {
                warn!("invalid skills config: {err}");
                continue;
            }
        };

        for entry in skills.config {
            let Some(selector) = skill_config_rule_selector(&entry) else {
                continue;
            };
            // Preserve layer order so a later name selector can override an earlier path selector
            // for the same loaded skill.
            entries.retain(|entry: &SkillConfigRule| entry.selector != selector);
            entries.push(SkillConfigRule {
                selector,
                enabled: entry.enabled,
            });
        }
    }

    SkillConfigRules { entries }
}

fn skill_config_rule_selector(entry: &SkillConfig) -> Option<SkillConfigRuleSelector> {
    match (entry.path.as_ref(), entry.name.as_deref()) {
        (Some(path), None) => Some(SkillConfigRuleSelector::Path(PathUri::from_abs_path(
            &path.canonicalize().unwrap_or_else(|_| path.clone()),
        ))),
        (None, Some(name)) => {
            let name = name.trim();
            if name.is_empty() {
                warn!("ignoring empty skills.config name override");
                None
            } else {
                Some(SkillConfigRuleSelector::Name(name.to_string()))
            }
        }
        (Some(_), Some(_)) => {
            warn!("ignoring skills.config entry with both path and name selectors");
            None
        }
        (None, None) => {
            warn!("ignoring skills.config entry without a path or name selector");
            None
        }
    }
}

#[cfg(test)]
#[path = "skills_config_tests.rs"]
mod tests;

#[cfg(test)]
mod extra_roots_tests {
    use super::SkillsConfig;
    use codex_utils_absolute_path::AbsolutePathBufGuard;

    #[test]
    fn extra_roots_default_and_absolute_path_validation() {
        let empty: SkillsConfig = toml::from_str("").expect("default skills config");
        assert!(empty.extra_roots.is_empty());
        let temp = tempfile::TempDir::new().expect("temp dir");
        let path = temp.path().join("frozen-skills");
        let config = format!(
            "extra_roots = [{}]",
            toml::Value::String(path.display().to_string())
        );
        let skills: SkillsConfig = toml::from_str(&config).expect("absolute root");
        assert_eq!(skills.extra_roots[0].as_path(), path);
        let _guard = AbsolutePathBufGuard::new(temp.path());
        assert!(toml::from_str::<SkillsConfig>("extra_roots = ['relative/skills']").is_err());
        assert!(toml::from_str::<SkillsConfig>("extra_roots = [7]").is_err());
    }

    #[test]
    fn extra_roots_schema_is_an_optional_path_array() {
        let schema = serde_json::to_value(schemars::schema_for!(SkillsConfig)).expect("schema");
        let roots = &schema["properties"]["extra_roots"];
        assert_eq!(roots["type"], "array");
        assert_eq!(roots["items"]["$ref"], "#/definitions/AbsolutePathBuf");
        assert_eq!(schema["definitions"]["AbsolutePathBuf"]["type"], "string");
        assert!(schema.get("required").is_none());
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../core/config.schema.json"))
                .expect("config schema fixture");
        let config_schema: serde_json::Value =
            serde_json::from_slice(&crate::schema::config_schema_json().expect("config schema"))
                .expect("config schema JSON");
        assert_eq!(
            config_schema["definitions"]["SkillsConfig"],
            fixture["definitions"]["SkillsConfig"]
        );
    }
}

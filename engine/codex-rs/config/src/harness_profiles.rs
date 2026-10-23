//! Validated harness settings. File contents are captured when configuration is loaded.
use codex_file_system::ExecutorFileSystem;
use codex_file_system::ReadFileOptions;
use codex_utils_absolute_path::AbsolutePathBuf;
use codex_utils_path_uri::PathUri;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use sha2::Digest;
use sha2::Sha256;
use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::io;

pub const AZRAEL_PROMPT: &str = "builtin/azrael-default";
pub const ANTHROPIC_PROMPT: &str = "builtin/anthropic-default";
pub const CLAUDE_LEAN_PROMPT: &str = "builtin/claude-lean";
pub const AZRAEL_TOOLS: &str = "builtin/azrael-default";
pub const CLAUDE_TOOLS: &str = "builtin/claude-code-core";

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct HarnessProfilesToml {
    #[serde(rename = "schemaVersion")]
    pub schema_version: Option<u32>,
    pub default_profile: Option<String>,
    #[serde(default)]
    pub prompt_profiles: BTreeMap<String, PromptProfileToml>,
    #[serde(default)]
    pub profiles: BTreeMap<String, HarnessProfileToml>,
    #[serde(default)]
    pub providers: BTreeMap<String, HarnessBindingToml>,
    #[serde(default)]
    pub models: BTreeMap<String, HarnessBindingToml>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PromptProfileToml {
    pub extends: Option<String>,
    /// Replaces the inherited optional behavior template; runtime guidance stays authoritative.
    /// Relative paths are anchored by the existing configuration layer path resolver.
    pub behavior_template_file: Option<AbsolutePathBuf>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct HarnessProfileToml {
    pub extends: Option<String>,
    pub prompt_profile: Option<String>,
    pub tool_profile: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct HarnessBindingToml {
    pub profile: Option<String>,
    pub prompt_profile: Option<String>,
    pub tool_profile: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
struct PromptProfile {
    variant: String,
    template: Option<String>,
}

/// An immutable request snapshot; tool and context consumers share its fingerprint.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ResolvedHarnessProfile {
    /// Stable diagnostic identity of the selected prompt/tool composition.
    pub id: String,
    pub prompt_profile: String,
    pub prompt_variant: String,
    pub tool_profile: String,
    pub behavior_template: Option<String>,
    pub fingerprint: String,
}

impl ResolvedHarnessProfile {
    pub fn uses_claude_tools(&self) -> bool {
        self.tool_profile == CLAUDE_TOOLS
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct HarnessProfiles {
    config: HarnessProfilesToml,
    prompts: BTreeMap<String, PromptProfile>,
    profiles: BTreeMap<String, HarnessBindingToml>,
}

/// Managed slugs carry the actual inference provider identity. Other providers' Claude
/// model names and Anthropic-compatible wire protocols do not change this identity.
pub fn is_anthropic_provider(provider: &str, model: &str) -> bool {
    if provider == "managed" || provider == "azrael-managed" {
        model.starts_with("managed/anthropic/")
    } else {
        provider == "anthropic" || provider == "managed/anthropic"
    }
}

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

fn validate_template(id: &str, contents: &str) -> io::Result<()> {
    if contents.trim().is_empty() {
        return Err(invalid(format!("harness prompt {id} template is empty")));
    }
    Ok(())
}

impl Default for HarnessProfiles {
    fn default() -> Self {
        Self::from_templates(HarnessProfilesToml::default(), &BTreeMap::new())
            .expect("bundled harness profiles are valid")
    }
}

impl HarnessProfiles {
    pub async fn load(
        config: HarnessProfilesToml,
        fs: &dyn ExecutorFileSystem,
    ) -> io::Result<Self> {
        // Validate graph and schema before attempting any configured file access.
        Self::from_templates(config.clone(), &BTreeMap::new())?;
        let mut templates = BTreeMap::new();
        for (id, prompt) in &config.prompt_profiles {
            if let Some(path) = &prompt.behavior_template_file {
                let contents = fs
                    .read_file_text(
                        &PathUri::from_abs_path(path),
                        ReadFileOptions::default(),
                        None,
                    )
                    .await
                    .map_err(|error| {
                        io::Error::new(
                            error.kind(),
                            format!(
                                "failed to read harness prompt {id} template {}: {error}",
                                path.display()
                            ),
                        )
                    })?;
                validate_template(id, &contents)?;
                templates.insert(id.clone(), contents);
            }
        }
        Self::from_templates(config, &templates)
    }

    fn from_templates(
        config: HarnessProfilesToml,
        templates: &BTreeMap<String, String>,
    ) -> io::Result<Self> {
        if config.schema_version.is_some_and(|version| version != 1) {
            return Err(invalid("harness schemaVersion must be 1"));
        }
        let mut result = Self {
            config,
            prompts: BTreeMap::new(),
            profiles: BTreeMap::new(),
        };
        for id in [AZRAEL_PROMPT, ANTHROPIC_PROMPT, CLAUDE_LEAN_PROMPT] {
            result.prompts.insert(
                id.into(),
                PromptProfile {
                    variant: id.into(),
                    template: None,
                },
            );
        }
        for (id, prompt, tools) in [
            ("azrael-default", AZRAEL_PROMPT, AZRAEL_TOOLS),
            ("anthropic-default", ANTHROPIC_PROMPT, CLAUDE_TOOLS),
        ] {
            result.profiles.insert(
                id.into(),
                HarnessBindingToml {
                    profile: None,
                    prompt_profile: Some(prompt.into()),
                    tool_profile: Some(tools.into()),
                },
            );
        }
        for id in result.config.prompt_profiles.keys() {
            if id.starts_with("builtin/") {
                return Err(invalid(format!("reserved harness prompt ID {id}")));
            }
        }
        for id in result.config.profiles.keys() {
            if id.starts_with("builtin/") || result.profiles.contains_key(id) {
                return Err(invalid(format!("reserved harness profile ID {id}")));
            }
        }
        let prompt_ids: Vec<_> = result.config.prompt_profiles.keys().cloned().collect();
        for id in prompt_ids {
            result.resolve_prompt(&id, templates, &mut BTreeSet::new())?;
        }
        let profile_ids: Vec<_> = result.config.profiles.keys().cloned().collect();
        for id in profile_ids {
            result.resolve_profile(&id, &mut BTreeSet::new())?;
        }
        if let Some(id) = &result.config.default_profile {
            result.profile(id)?;
        }
        for binding in result
            .config
            .providers
            .values()
            .chain(result.config.models.values())
        {
            result.validate_binding(binding)?;
        }
        result.resolve("openai", "__validation__")?;
        result.resolve("anthropic", "__validation__")?;
        // Validate configured identities immediately, including unused provider/model entries.
        for provider in result.config.providers.keys() {
            if provider == "managed" || provider == "azrael-managed" {
                result.resolve(provider, "managed/anthropic/__validation__")?;
                result.resolve(provider, "managed/openai/__validation__")?;
            } else {
                result.resolve(provider, "__validation__")?;
            }
        }
        for model in result.config.models.keys() {
            if model
                .strip_prefix("managed/")
                .and_then(|v| v.split_once('/'))
                .is_some()
            {
                result.resolve("managed", model)?;
            }
        }
        Ok(result)
    }

    fn resolve_prompt(
        &mut self,
        id: &str,
        templates: &BTreeMap<String, String>,
        visiting: &mut BTreeSet<String>,
    ) -> io::Result<PromptProfile> {
        if let Some(prompt) = self.prompts.get(id) {
            return Ok(prompt.clone());
        }
        if !visiting.insert(id.into()) {
            return Err(invalid(format!("harness prompt inheritance cycle at {id}")));
        }
        let config = self
            .config
            .prompt_profiles
            .get(id)
            .cloned()
            .ok_or_else(|| invalid(format!("unknown harness prompt profile {id}")))?;
        let mut prompt = self.resolve_prompt(
            config.extends.as_deref().unwrap_or(AZRAEL_PROMPT),
            templates,
            visiting,
        )?;
        if config.behavior_template_file.is_some() {
            prompt.template = templates.get(id).cloned();
        }
        visiting.remove(id);
        self.prompts.insert(id.into(), prompt.clone());
        Ok(prompt)
    }

    fn resolve_profile(
        &mut self,
        id: &str,
        visiting: &mut BTreeSet<String>,
    ) -> io::Result<HarnessBindingToml> {
        if let Some(profile) = self.profiles.get(id) {
            return Ok(profile.clone());
        }
        if !visiting.insert(id.into()) {
            return Err(invalid(format!(
                "harness profile inheritance cycle at {id}"
            )));
        }
        let config = self
            .config
            .profiles
            .get(id)
            .cloned()
            .ok_or_else(|| invalid(format!("unknown harness profile {id}")))?;
        let mut binding = match config.extends.as_deref() {
            Some(parent) => self.resolve_profile(parent, visiting)?,
            None => HarnessBindingToml::default(),
        };
        if config.prompt_profile.is_some() {
            binding.prompt_profile = config.prompt_profile;
        }
        if config.tool_profile.is_some() {
            binding.tool_profile = config.tool_profile;
        }
        self.validate_binding(&binding)?;
        visiting.remove(id);
        self.profiles.insert(id.into(), binding.clone());
        Ok(binding)
    }

    fn profile(&self, id: &str) -> io::Result<&HarnessBindingToml> {
        self.profiles
            .get(id)
            .ok_or_else(|| invalid(format!("unknown harness profile {id}")))
    }

    fn validate_binding(&self, binding: &HarnessBindingToml) -> io::Result<()> {
        if let Some(id) = &binding.profile {
            self.profile(id)?;
        }
        if let Some(id) = &binding.prompt_profile {
            if !self.prompts.contains_key(id) {
                return Err(invalid(format!("unknown harness prompt profile {id}")));
            }
        }
        if let Some(id) = &binding.tool_profile {
            if id != AZRAEL_TOOLS && id != CLAUDE_TOOLS {
                return Err(invalid(format!("unknown harness tool profile {id}")));
            }
        }
        Ok(())
    }

    fn apply(
        &self,
        target: &mut HarnessBindingToml,
        binding: &HarnessBindingToml,
    ) -> io::Result<()> {
        if let Some(id) = &binding.profile {
            self.apply(target, self.profile(id)?)?;
        }
        if let Some(id) = &binding.prompt_profile {
            target.prompt_profile = Some(id.clone());
        }
        if let Some(id) = &binding.tool_profile {
            target.tool_profile = Some(id.clone());
        }
        Ok(())
    }

    pub fn resolve(&self, provider: &str, model: &str) -> io::Result<ResolvedHarnessProfile> {
        let mut binding = self.profile("azrael-default")?.clone();
        if let Some(id) = &self.config.default_profile {
            self.apply(&mut binding, self.profile(id)?)?;
        }
        // Specific actual provider bindings override a generic managed transport binding.
        if let Some(layer) = self.config.providers.get(provider) {
            self.apply(&mut binding, layer)?;
        }
        if provider == "managed" || provider == "azrael-managed" {
            if let Some((actual_provider, _)) = model
                .strip_prefix("managed/")
                .and_then(|slug| slug.split_once('/'))
            {
                if let Some(layer) = self.config.providers.get(actual_provider) {
                    self.apply(&mut binding, layer)?;
                }
            }
        }
        if let Some(layer) = self.config.models.get(model) {
            self.apply(&mut binding, layer)?;
        }
        let prompt_profile = binding.prompt_profile.expect("bundled prompt default");
        let tool_profile = binding.tool_profile.expect("bundled tool default");
        let prompt = self
            .prompts
            .get(&prompt_profile)
            .ok_or_else(|| invalid(format!("unknown harness prompt {prompt_profile}")))?;
        let mut resolved = ResolvedHarnessProfile {
            id: format!("{prompt_profile}+{tool_profile}"),
            prompt_profile,
            prompt_variant: prompt.variant.clone(),
            tool_profile,
            behavior_template: prompt.template.clone(),
            fingerprint: String::new(),
        };
        // Version the semantic contract separately from configuration schema syntax.
        let tool_revision = if resolved.uses_claude_tools() {
            "tool-contract-v2"
        } else {
            "tool-contract-v1"
        };
        let bytes = serde_json::to_vec(&("harness-content-v1", tool_revision, &resolved))
            .map_err(io::Error::other)?;
        resolved.fingerprint = format!("{:x}", Sha256::digest(bytes));
        Ok(resolved)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(text: &str) -> io::Result<HarnessProfiles> {
        let config: HarnessProfilesToml = toml::from_str(text).map_err(io::Error::other)?;
        HarnessProfiles::from_templates(config, &BTreeMap::new())
    }

    #[test]
    fn defaults_use_azrael_for_every_provider_and_future_models() {
        let profiles = HarnessProfiles::default();
        for provider in ["managed", "azrael-managed", "anthropic"] {
            let profile = profiles
                .resolve(provider, "managed/anthropic/future-model")
                .unwrap();
            assert_eq!(profile.tool_profile, AZRAEL_TOOLS);
            assert_eq!(profile.prompt_variant, AZRAEL_PROMPT);
        }
        for (provider, model) in [
            ("openai", "claude-opus"),
            ("google-antigravity", "managed/anthropic/claude-opus"),
            ("azrael-managed", "managed/google-antigravity/claude-opus"),
        ] {
            let profile = profiles.resolve(provider, model).unwrap();
            assert_eq!(profile.tool_profile, AZRAEL_TOOLS);
            assert_eq!(profile.prompt_variant, AZRAEL_PROMPT);
        }
    }

    #[test]
    fn sparse_model_override_preserves_provider_and_siblings() {
        let profiles = parse(
            r#"
            [prompt_profiles.team]
            extends = "builtin/anthropic-default"
            [profiles.team]
            extends = "anthropic-default"
            prompt_profile = "team"
            [providers.anthropic]
            profile = "team"
            [models."managed/anthropic/exact"]
            tool_profile = "builtin/claude-code-core"
            [models."managed/anthropic/lean"]
            prompt_profile = "builtin/claude-lean"
        "#,
        )
        .unwrap();
        for slug in [
            "managed/anthropic/exact",
            "managed/anthropic/new",
            "managed/anthropic/sibling",
        ] {
            let profile = profiles.resolve("azrael-managed", slug).unwrap();
            assert_eq!(profile.prompt_profile, "team");
            assert_eq!(profile.prompt_variant, ANTHROPIC_PROMPT);
        }
        assert_eq!(
            profiles
                .resolve("azrael-managed", "managed/anthropic/lean")
                .unwrap()
                .prompt_profile,
            CLAUDE_LEAN_PROMPT
        );
        assert_eq!(
            profiles.resolve("openai", "new").unwrap().prompt_profile,
            AZRAEL_PROMPT
        );
    }

    #[test]
    fn configured_inheritance_cycles_and_unknown_references_are_errors() {
        for text in [
            "schemaVersion = 2",
            "default_profile = 'missing'",
            "[profiles.a]\nextends = 'b'\n[profiles.b]\nextends = 'a'",
            "[prompt_profiles.a]\nextends = 'b'\n[prompt_profiles.b]\nextends = 'a'",
            "[profiles.a]\nprompt_profile = 'missing'",
            "[providers.openai]\ntool_profile = 'missing'",
            "[models.unknown]\nprofile = 'missing'",
            "[profiles.azrael-default]\nprompt_profile = 'builtin/claude-lean'",
            "[prompt_profiles.'builtin/claude-lean']",
        ] {
            assert!(
                parse(text).is_err(),
                "accepted invalid configuration: {text}"
            );
        }
    }

    #[test]
    fn explicit_profiles_override_defaults_without_provider_restrictions() {
        let profiles = parse("default_profile = 'anthropic-default'\n[providers.anthropic]\nprofile = 'azrael-default'\n[models.exact]\nprompt_profile = 'builtin/claude-lean'").unwrap();
        assert!(
            profiles
                .resolve("openai", "future")
                .unwrap()
                .uses_claude_tools()
        );
        let provider = profiles.resolve("anthropic", "future").unwrap();
        assert_eq!(provider.tool_profile, AZRAEL_TOOLS);
        assert_eq!(provider.prompt_variant, AZRAEL_PROMPT);
        let model = profiles.resolve("anthropic", "exact").unwrap();
        assert_eq!(model.tool_profile, AZRAEL_TOOLS);
        assert_eq!(model.prompt_variant, CLAUDE_LEAN_PROMPT);
        let profiles = parse("[models.direct]\nprofile = 'anthropic-default'").unwrap();
        assert!(
            profiles
                .resolve("openai", "direct")
                .unwrap()
                .uses_claude_tools()
        );
        assert!(
            profiles
                .resolve("anthropic", "direct")
                .unwrap()
                .uses_claude_tools()
        );
    }

    #[test]
    fn template_inheritance_replacement_and_fingerprint_are_content_based() {
        let dir = tempfile::tempdir().unwrap();
        let parent_path =
            AbsolutePathBuf::from_absolute_path(dir.path().join("parent.md")).unwrap();
        let child_path = AbsolutePathBuf::from_absolute_path(dir.path().join("child.md")).unwrap();
        let mut config = HarnessProfilesToml::default();
        config.prompt_profiles.insert(
            "parent".into(),
            PromptProfileToml {
                extends: Some(ANTHROPIC_PROMPT.into()),
                behavior_template_file: Some(parent_path),
            },
        );
        config.prompt_profiles.insert(
            "child".into(),
            PromptProfileToml {
                extends: Some("parent".into()),
                behavior_template_file: None,
            },
        );
        config.providers.insert(
            "anthropic".into(),
            HarnessBindingToml {
                prompt_profile: Some("child".into()),
                ..Default::default()
            },
        );
        let templates = BTreeMap::from([("parent".into(), "parent behavior".into())]);
        let inherited = HarnessProfiles::from_templates(config.clone(), &templates)
            .unwrap()
            .resolve("anthropic", "new")
            .unwrap();
        assert_eq!(
            inherited.behavior_template.as_deref(),
            Some("parent behavior")
        );
        assert_eq!(inherited.prompt_variant, ANTHROPIC_PROMPT);
        config
            .prompt_profiles
            .get_mut("child")
            .unwrap()
            .behavior_template_file = Some(child_path);
        let mut templates = templates;
        templates.insert("child".into(), "child behavior".into());
        let changed = HarnessProfiles::from_templates(config.clone(), &templates)
            .unwrap()
            .resolve("anthropic", "new")
            .unwrap();
        assert_eq!(changed.behavior_template.as_deref(), Some("child behavior"));
        assert_ne!(changed.fingerprint, inherited.fingerprint);
        let repeat = HarnessProfiles::from_templates(config, &templates)
            .unwrap()
            .resolve("anthropic", "new")
            .unwrap();
        assert_eq!(repeat.fingerprint, changed.fingerprint);
        assert_eq!(repeat.fingerprint.len(), 64);
    }

    #[test]
    fn template_paths_use_the_declaring_config_layer() {
        let dir = tempfile::tempdir().unwrap();
        let raw: toml::Value = toml::from_str(
            r#"
            [harness.prompt_profiles.team]
            behavior_template_file = "harness/team.md"
        "#,
        )
        .unwrap();
        let resolved =
            crate::loader::resolve_relative_paths_in_config_toml(raw, dir.path()).unwrap();
        let config: crate::config_toml::ConfigToml = resolved.try_into().unwrap();
        assert_eq!(
            config.harness.prompt_profiles["team"]
                .behavior_template_file
                .as_ref()
                .unwrap()
                .as_path(),
            dir.path().join("harness/team.md")
        );
    }

    #[test]
    fn empty_behavior_templates_are_explicit_configuration_errors() {
        for contents in ["", " \t\r\n"] {
            let error = validate_template("team", contents).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::InvalidData);
            assert!(error.to_string().contains("team"));
        }
        assert!(validate_template("team", "\ncustom guidance\n").is_ok());
    }
}

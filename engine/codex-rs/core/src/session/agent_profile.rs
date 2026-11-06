//! Validates the host's immutable, allowlisted profile contribution before turn construction.
use super::SessionConfiguration;
use super::SessionSettingsUpdate;
use super::step_settings::StepSettingsUpdate;
use base64::Engine;
use codex_agent_roles::AgentRoleConfig;
use codex_agent_roles::parse_agent_role_file_contents;
use codex_config::harness_profiles::HarnessBindingToml;
use codex_model_provider::create_model_provider;
use codex_protocol::agent_profile::AgentProfileRef;
use codex_protocol::agent_profile::ProviderAccountScope;
use codex_protocol::error::CodexErr;
use codex_protocol::openai_models::ReasoningEffort;
use serde::Deserialize;
use serde_json::Value;
use sha2::Digest;
use sha2::Sha256;
use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::io::Read;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Snapshot {
    version: u32,
    profile_id: String,
    digest: String,
    model: String,
    provider: String,
    #[serde(default)]
    pub(super) provider_account: Option<ProviderAccountScope>,
    reasoning_effort: Option<ReasoningEffort>,
    config: BTreeMap<String, Value>,
    context: String,
    files: BTreeMap<String, String>,
    integrity: String,
    #[serde(default)]
    resource_selection: Option<ResourceSelection>,
    #[serde(default)]
    inherit_model: bool,
    #[serde(default)]
    allowed_roles: Option<Vec<codex_protocol::protocol::AgentProfileRole>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResourceSelection {
    mode: String,
    mcp_server_ids: Vec<String>,
}

fn invalid(message: impl std::fmt::Display) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.to_string())
}

pub(super) fn validate_turn_account(
    context: &super::turn_context::TurnContext,
    model: &str,
) -> Result<(), CodexErr> {
    validate_account_scope(
        &context.config,
        model,
        context.auth_manager.as_deref(),
        context.agent_profile_account.as_ref(),
    )
}

fn validate_account_scope(
    config: &crate::config::Config,
    model: &str,
    auth: Option<&codex_login::AuthManager>,
    scope: Option<&ProviderAccountScope>,
) -> Result<(), CodexErr> {
    let Some(scope) = scope else {
        return Ok(());
    };
    scope
        .validate()
        .map_err(|e| CodexErr::InvalidRequest(e.into()))?;
    let provider = if crate::managed_catalog::is_managed(model) {
        crate::managed_catalog::selection(model)
            .map_err(|e| CodexErr::InvalidRequest(e.to_string()))?
            .0
            .into_owned()
    } else if crate::devin::catalog::is_devin(model) {
        "devin".to_owned()
    } else if config.model_provider_id == "openai" {
        "openai".to_owned()
    } else {
        return Err(CodexErr::InvalidRequest(
            "task profile account scope cannot be verified for this provider".into(),
        ));
    };
    if provider != scope.provider_id {
        return Err(CodexErr::InvalidRequest(
            "task profile account provider does not match its model".into(),
        ));
    }
    if provider == "openai"
        && auth
            .and_then(codex_login::AuthManager::azrael_profile_id)
            .as_deref()
            != Some(scope.account_id.as_str())
    {
        return Err(CodexErr::InvalidRequest(
            "task profile selected account changed or is unavailable".into(),
        ));
    }
    // Managed and Devin owners validate the actual resolved credential before model execution.
    Ok(())
}

fn safe_path(path: &Path) -> io::Result<()> {
    for ancestor in path.ancestors() {
        let metadata = fs::symlink_metadata(ancestor)?;
        if metadata.file_type().is_symlink() {
            return Err(invalid("task profile links are forbidden"));
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(invalid("task profile reparse points are forbidden"));
            }
        }
    }
    Ok(())
}

fn read_file(path: &Path) -> io::Result<Vec<u8>> {
    safe_path(path)?;
    let file = fs::File::open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() > 64 * 1024 * 1024 {
        return Err(invalid("invalid or oversized task profile file"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(invalid("task profile hard links are forbidden"));
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::BY_HANDLE_FILE_INFORMATION;
        use windows_sys::Win32::Storage::FileSystem::GetFileInformationByHandle;
        let mut information: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle().cast(), &mut information) } == 0
        {
            return Err(io::Error::last_os_error());
        }
        if information.nNumberOfLinks != 1 || information.dwFileAttributes & 0x400 != 0 {
            return Err(invalid("task profile links are forbidden"));
        }
    }
    let mut bytes = Vec::new();
    file.take(64 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err(invalid("task profile file is too large"));
    }
    Ok(bytes)
}

fn relative_file(name: &str) -> io::Result<()> {
    if name.is_empty()
        || name.contains('\\')
        || name.split('/').any(|part| {
            let stem = part
                .split('.')
                .next()
                .unwrap_or_default()
                .to_ascii_lowercase();
            part.is_empty()
                || part == "."
                || part == ".."
                || (part.ends_with('.') || part.ends_with(' '))
                || part
                    .chars()
                    .any(|c| c.is_control() || "<>:\"|?*".contains(c))
                || matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
                || ((stem.starts_with("com") || stem.starts_with("lpt"))
                    && stem.len() == 4
                    && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        })
    {
        return Err(invalid("invalid task profile file path"));
    }
    Ok(())
}

// JavaScript's canonicalDigest recursively sorts keys in UTF-16 order.
fn canonical(value: &Value, output: &mut String) -> io::Result<()> {
    match value {
        Value::Object(object) => {
            output.push('{');
            let mut keys: Vec<_> = object.keys().collect();
            keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            for (index, key) in keys.into_iter().enumerate() {
                if index != 0 {
                    output.push(',');
                }
                output.push_str(&serde_json::to_string(key)?);
                output.push(':');
                canonical(&object[key], output)?;
            }
            output.push('}');
        }
        Value::Array(items) => {
            output.push('[');
            for (index, item) in items.iter().enumerate() {
                if index != 0 {
                    output.push(',');
                }
                canonical(item, output)?;
            }
            output.push(']');
        }
        _ => output.push_str(&serde_json::to_string(value)?),
    }
    Ok(())
}

fn verify_inventory(
    root: &Path,
    directory: &Path,
    files: &BTreeMap<String, String>,
) -> io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        safe_path(&path)?;
        let name = path
            .strip_prefix(root)
            .map_err(invalid)?
            .to_str()
            .ok_or_else(|| invalid("invalid task profile file name"))?
            .replace('\\', "/");
        if entry.file_type()?.is_dir() {
            if !files
                .keys()
                .any(|file| file.starts_with(&format!("{name}/")))
            {
                return Err(invalid("unlisted task profile directory"));
            }
            verify_inventory(root, &path, files)?;
        } else if !entry.file_type()?.is_file()
            || (name != "snapshot.json" && !files.contains_key(&name))
        {
            return Err(invalid("unlisted task profile file"));
        }
    }
    Ok(())
}

pub(super) async fn load(home: &Path, reference: &AgentProfileRef) -> Result<Snapshot, CodexErr> {
    reference
        .validate()
        .map_err(|e| CodexErr::InvalidRequest(e.to_owned()))?;
    let root = home.join("azrael/task-profiles").join(&reference.digest);
    let digest = reference.digest.clone();
    tokio::task::spawn_blocking(move || load_snapshot(&root, &digest))
        .await
        .map_err(|e| CodexErr::InvalidRequest(format!("task profile loader failed: {e}")))?
        .map_err(|e| CodexErr::InvalidRequest(format!("invalid task profile snapshot: {e}")))
}

fn load_snapshot(root: &Path, digest: &str) -> io::Result<Snapshot> {
    let file = root.join("snapshot.json");
    let bytes = read_file(&file)?;
    let mut value: Value = serde_json::from_slice(&bytes)?;
    if value.as_object().is_none_or(|object| {
        object.len() != 10 + usize::from(object.contains_key("providerAccount")) + usize::from(object.contains_key("resourceSelection")) + usize::from(object.contains_key("inheritModel")) + usize::from(object.contains_key("allowedRoles"))
            || !object.contains_key("reasoningEffort")
    }) {
        return Err(invalid("invalid task profile snapshot shape"));
    }
    let snapshot: Snapshot = serde_json::from_value(value.clone())?;
    if let Some(scope) = &snapshot.provider_account {
        scope.validate().map_err(invalid)?;
    }
    if snapshot.version != 1
        || snapshot.digest != digest
        || snapshot.profile_id.is_empty()
        || snapshot.model.is_empty()
        || snapshot.provider.is_empty()
    {
        return Err(invalid("task profile snapshot identity mismatch"));
    }
    value
        .as_object_mut()
        .ok_or_else(|| invalid("invalid snapshot object"))?
        .remove("integrity");
    let mut encoded = String::new();
    canonical(&value, &mut encoded)?;
    if format!("{:x}", Sha256::digest(encoded.as_bytes())) != snapshot.integrity {
        return Err(invalid("task profile integrity mismatch"));
    }
    let mut names = BTreeSet::new();
    let mut total = 0usize;
    for (name, encoded) in &snapshot.files {
        relative_file(name)?;
        if !(name.starts_with("skills/") || name.starts_with("roles/"))
            || !names.insert(name.to_lowercase())
        {
            return Err(invalid("invalid or colliding task profile file"));
        }
        let expected = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(invalid)?;
        total = total.saturating_add(expected.len());
        if total > 64 * 1024 * 1024 {
            return Err(invalid("task profile files are too large"));
        }
        let path = root.join(name);
        if read_file(&path)? != expected {
            return Err(invalid("task profile file does not match its manifest"));
        }
    }
    verify_inventory(root, root, &snapshot.files)?;
    // Validate all config paths and role contents even before a context is constructed.
    snapshot.contribution(root)?;
    Ok(snapshot)
}

/// Role profiles load the same immutable manifests as one-turn task profiles.
/// Only resource/context contributions apply here: native role policy owns model settings.
pub(crate) fn apply_role_profile(config: &mut crate::config::Config, profile: &codex_protocol::protocol::AgentRoleProfile) -> Result<(), String> {
    config.config_layer_stack = config.config_layer_stack.with_session_overlay(toml::Value::try_from(serde_json::json!({"agent_profile_resources": {"enabled": false}})).map_err(|e| e.to_string())?);
    let Some(extension) = &profile.profile_extension else { return Ok(()); };
    if extension.diagnostics.as_ref().is_some_and(|v| v.as_array().is_none_or(|a| !a.is_empty())) {
        return Err("role profile has unresolved diagnostics".into());
    }
    let Some(reference) = &extension.agent_profile else {
        if extension.optional_selection.is_some() || extension.provider_account.is_some() || [&extension.components, &extension.mcp_server_ids, &extension.resource_ids, &extension.component_ids, &extension.resource_selections].iter().any(|v| v.as_ref().is_some_and(|v| v.as_array().is_none_or(|a| !a.is_empty()))) {
            return Err("role profile resources require an immutable snapshot".into());
        }
        return Ok(());
    };
    reference.validate().map_err(str::to_owned)?;
    let root = config.codex_home.join("azrael/task-profiles").join(&reference.digest);
    let snapshot = load_snapshot(&root, &reference.digest).map_err(|e| e.to_string())?;
    if snapshot.profile_id != profile.id { return Err("role profile snapshot identity mismatch".into()); }
    if let Some(selection) = &extension.optional_selection {
        if selection.as_str() != Some("selected-only") || snapshot.resource_selection.is_none() { return Err("role profile resource selection snapshot mismatch".into()); }
        let ids: Vec<String> = extension.mcp_server_ids.as_ref().map(|value| serde_json::from_value(value.clone()).map_err(|e| e.to_string())).transpose()?.unwrap_or_default();
        if snapshot.resource_selection.as_ref().is_none_or(|s| s.mcp_server_ids != ids) { return Err("role profile MCP snapshot mismatch".into()); }
    }
    if profile.model.as_ref().is_some_and(|model| model != &snapshot.model) { return Err("role profile model snapshot mismatch".into()); }
    let (overlay, roles) = snapshot.contribution(&root).map_err(|e| e.to_string())?;
    for (name, role) in &roles {
        if let Some(existing) = config.agent_roles.get(name) && existing.config_file != role.config_file {
            return Err("role profile would replace an existing role".into());
        }
    }
    let account = extension.provider_account.as_ref().map(|value| serde_json::from_value::<ProviderAccountScope>(value.clone()).map_err(|e| e.to_string())).transpose()?;
    if account != snapshot.provider_account { return Err("role profile account snapshot mismatch".into()); }
    config.agent_roles.extend(roles);
    config.config_layer_stack = config.config_layer_stack.with_session_overlay(overlay);
    if !snapshot.context.is_empty() {
        let existing = config.developer_instructions.take().unwrap_or_default();
        config.developer_instructions = Some(format!("{existing}\n\n{}", snapshot.context));
    }
    Ok(())
}

pub(crate) fn validate_project_admission(configuration: &SessionConfiguration) -> Result<(), CodexErr> {
    if codex_protocol::agent_profile::execution_mode(configuration.original_config_do_not_use.role_profile.as_ref(), &configuration.session_source) != codex_protocol::agent_profile::AgentProfileExecutionMode::Direct {
        return Err(CodexErr::InvalidRequest("project profiles cannot replace a Team or child role profile".into()));
    }
    Ok(())
}

pub(crate) fn role_account(config: &crate::config::Config) -> Result<Option<ProviderAccountScope>, CodexErr> {
    let account = config.role_profile.as_ref().and_then(|p| p.selected_profile().ok()).and_then(|p| p.profile_extension.as_ref()).and_then(|e| e.provider_account.as_ref());
    account.map(|value| serde_json::from_value(value.clone()).map_err(|_| CodexErr::InvalidRequest("invalid role profile account scope".into()))).transpose()
}

impl Snapshot {
    fn contribution(
        &self,
        root: &Path,
    ) -> io::Result<(toml::Value, BTreeMap<String, AgentRoleConfig>)> {
        let mut overlay = toml::map::Map::new();
        let mut roles = BTreeMap::new();
        if let Some(selection) = &self.resource_selection {
            let mut seen = BTreeSet::new();
            if selection.mode != "selected-only" || selection.mcp_server_ids.iter().any(|id| id.is_empty() || id.chars().any(char::is_control) || !seen.insert(id)) {
                return Err(invalid("invalid task profile resource selection"));
            }
            overlay.insert("agent_profile_resources".into(), toml::Value::try_from(serde_json::json!({
                "enabled": true, "skill_roots": [root.join("skills")], "mcp_server_ids": selection.mcp_server_ids,
            })).map_err(invalid)?);
        }
        for (key, value) in &self.config {
            if key == "skills.extra_roots" {
                let roots: Vec<PathBuf> = serde_json::from_value(value.clone())?;
                if roots != vec![root.join("skills")]
                    || !self.files.keys().any(|p| p.starts_with("skills/"))
                {
                    return Err(invalid("task skill root is outside its snapshot"));
                }
                overlay.insert(
                    "skills".into(),
                    toml::Value::try_from(serde_json::json!({"extra_roots": roots}))
                        .map_err(invalid)?,
                );
            } else if key == "harness.models" {
                let bindings: BTreeMap<String, HarnessBindingToml> =
                    serde_json::from_value(value.clone())?;
                if bindings.len() != 1 || !bindings.contains_key(&self.model) {
                    return Err(invalid("task harness must bind only the selected model"));
                }
                let binding = &bindings[&self.model];
                if binding.profile.is_some()
                    || binding.prompt_profile.as_deref().is_some_and(|p| {
                        !matches!(
                            p,
                            "builtin/azrael-default" | "builtin/anthropic" | "builtin/claude-lean"
                        )
                    })
                    || binding
                        .tool_profile
                        .as_deref()
                        .is_some_and(|p| p != "builtin/azrael-default")
                {
                    return Err(invalid("invalid task harness binding"));
                }
                overlay.insert(
                    "harness".into(),
                    toml::Value::try_from(serde_json::json!({"models": value})).map_err(invalid)?,
                );
            } else if let Some(role_key) = key.strip_prefix("agents.") {
                let (name, field) = role_key
                    .split_once('.')
                    .ok_or_else(|| invalid("invalid task role key"))?;
                if name.is_empty()
                    || name.len() > 64
                    || !name.bytes().all(|c| {
                        c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-'
                    })
                    || !name.as_bytes()[0].is_ascii_alphanumeric()
                {
                    return Err(invalid("invalid task role name"));
                }
                let role = roles
                    .entry(name.to_owned())
                    .or_insert_with(AgentRoleConfig::default);
                match field {
                    "description" => {
                        role.description = Some(
                            value
                                .as_str()
                                .ok_or_else(|| invalid("invalid task role description"))?
                                .to_owned(),
                        )
                    }
                    "config_file" => {
                        let path = PathBuf::from(
                            value
                                .as_str()
                                .ok_or_else(|| invalid("invalid task role path"))?,
                        );
                        let relative = path
                            .strip_prefix(root)
                            .map_err(invalid)?
                            .to_str()
                            .ok_or_else(|| invalid("invalid task role path"))?
                            .replace('\\', "/");
                        relative_file(&relative)?;
                        if !relative.starts_with(&format!("roles/{name}/"))
                            || !self.files.contains_key(&relative)
                        {
                            return Err(invalid("task role is outside its manifest"));
                        }
                        let contents = String::from_utf8(
                            base64::engine::general_purpose::STANDARD
                                .decode(&self.files[&relative])
                                .map_err(invalid)?,
                        )
                        .map_err(invalid)?;
                        let raw: toml::Value = toml::from_str(&contents).map_err(invalid)?;
                        if raw
                            .as_table()
                            .ok_or_else(|| invalid("invalid task role TOML"))?
                            .keys()
                            .any(|k| {
                                !matches!(
                                    k.as_str(),
                                    "model"
                                        | "model_reasoning_effort"
                                        | "developer_instructions"
                                        | "description"
                                )
                            })
                        {
                            return Err(invalid("task role machine configuration rejected"));
                        }
                        parse_agent_role_file_contents(&contents, &path, root, Some(name))?;
                        role.config_file = Some(path);
                    }
                    _ => return Err(invalid("task role machine configuration rejected")),
                }
            } else {
                return Err(invalid("task profile machine configuration rejected"));
            }
        }
        for role in roles.values() {
            if role.config_file.is_none()
                || role
                    .description
                    .as_ref()
                    .is_none_or(|d| d.trim().is_empty())
            {
                return Err(invalid("incomplete task role declaration"));
            }
        }
        Ok((toml::Value::Table(overlay), roles))
    }

    pub(super) fn apply(
        &self,
        mut configuration: SessionConfiguration,
    ) -> Result<SessionConfiguration, CodexErr> {
        validate_project_admission(&configuration)?;
        if self.allowed_roles.as_ref().is_some_and(|roles| !roles.contains(&codex_protocol::protocol::AgentProfileRole::Root)) {
            return Err(CodexErr::InvalidRequest("project profiles require the root role".into()));
        }
        let fail = |e: io::Error| CodexErr::InvalidRequest(format!("invalid task profile: {e}"));
        let root = configuration
            .codex_home
            .as_path()
            .join("azrael/task-profiles")
            .join(&self.digest);
        let (mut overlay, roles) = self.contribution(&root).map_err(fail)?;
        let mut config = (*configuration.original_config_do_not_use).clone();
        for name in roles.keys() {
            if crate::agent::role::resolve_role_config(&config, name).is_some() {
                return Err(fail(invalid("task role would replace an existing role")));
            }
        }
        if !self.inherit_model {
        if let Some(required) = config.config_layer_stack.required_model_provider()
            && required != self.provider
        {
            return Err(fail(invalid(
                "task provider conflicts with native requirements",
            )));
        }
        // Reuse native managed/Devin model selection, including catalog validation.
        crate::devin::select_model(&mut config, &self.model).map_err(fail)?;
        if config.model_provider_id != self.provider {
            if crate::managed_catalog::is_managed(&self.model)
                || crate::devin::catalog::is_devin(&self.model)
            {
                return Err(fail(invalid(
                    "task provider does not match the selected model",
                )));
            }
            config.model_provider = config
                .model_providers
                .get(&self.provider)
                .cloned()
                .ok_or_else(|| fail(invalid("task provider is unavailable")))?;
            config.model_provider_id = self.provider.clone();
        }
        }
        // Preserve existing native skill roots when adding the snapshot root.
        if let Some(skills) = overlay.get_mut("skills") {
            let existing = config.config_layer_stack.effective_config();
            let mut roots = existing
                .get("skills")
                .and_then(|v| v.get("extra_roots"))
                .and_then(toml::Value::as_array)
                .cloned()
                .unwrap_or_default();
            for root in skills
                .get("extra_roots")
                .and_then(toml::Value::as_array)
                .into_iter()
                .flatten()
            {
                if !roots.contains(root) {
                    roots.push(root.clone());
                }
            }
            skills
                .as_table_mut()
                .ok_or_else(|| fail(invalid("invalid task skills")))?
                .insert("extra_roots".into(), toml::Value::Array(roots));
        }
        if let Some(value) = self.config.get("harness.models") {
            let bindings: BTreeMap<String, HarnessBindingToml> =
                serde_json::from_value(value.clone()).map_err(|e| fail(invalid(e)))?;
            config.harness_profiles = config
                .harness_profiles
                .with_model_binding(&config.model_provider_id, if self.inherit_model { configuration.step_settings.collaboration_mode.model() } else { &self.model }, bindings[&self.model].clone())
                .map_err(fail)?;
        }
        config.agent_roles.extend(roles);
        config.config_layer_stack = config.config_layer_stack.with_session_overlay(overlay);
        if !self.inherit_model { config.model_reasoning_effort = self.reasoning_effort.clone(); }
        configuration.original_config_do_not_use = Arc::new(config);
        configuration = configuration
            .apply(
                &SessionSettingsUpdate {
                    step_settings: StepSettingsUpdate {
                        model: (!self.inherit_model).then(|| self.model.clone()),
                        effort: (!self.inherit_model).then(|| self.reasoning_effort.clone()),
                        ..Default::default()
                    },
                    ..Default::default()
                },
                &configuration.environments,
            )
            .map_err(|e| CodexErr::InvalidRequest(e.to_string()))?;
        let config = &configuration.original_config_do_not_use;
        configuration.provider = create_model_provider(
            config.model_provider.clone(),
            if matches!(
                config.model_provider_id.as_str(),
                crate::devin::PROVIDER_ID | crate::managed_catalog::PROVIDER_ID
            ) {
                None
            } else {
                configuration.native_auth_manager.clone()
            },
        );
        validate_account_scope(
            &configuration.original_config_do_not_use,
            configuration.step_settings.collaboration_mode.model(),
            configuration.native_auth_manager.as_deref(),
            self.provider_account.as_ref(),
        )?;
        if !self.context.trim().is_empty() {
            configuration.developer_instructions =
                Some(match configuration.developer_instructions {
                    Some(existing) if !existing.trim().is_empty() => {
                        format!("{existing}\n\n{}", self.context)
                    }
                    _ => self.context.clone(),
                });
        }
        Arc::make_mut(&mut configuration.original_config_do_not_use).developer_instructions =
            configuration.developer_instructions.clone();
        Ok(configuration)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::tests::make_session_and_context;
    use crate::session::turn_context::NewTurnContextOptions;
    use codex_utils_absolute_path::AbsolutePathBuf;
    use serde_json::json;

    fn snapshot_value() -> Value {
        json!({
            "version": 1, "profileId": "profile-a", "digest": "a".repeat(64),
            "model": "gpt-5.1", "provider": "openai", "reasoningEffort": null,
            "config": {}, "context": "Captured contribution", "files": {}
        })
    }

    fn write_snapshot(root: &Path, mut value: Value) {
        value.as_object_mut().unwrap().remove("integrity");
        let mut encoded = String::new();
        canonical(&value, &mut encoded).unwrap();
        value["integrity"] = json!(format!("{:x}", Sha256::digest(encoded.as_bytes())));
        fs::create_dir_all(root).unwrap();
        fs::write(
            root.join("snapshot.json"),
            serde_json::to_vec(&value).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn profile_resource_selection_manifest_is_explicit_and_closed() {
        let home = tempfile::tempdir().unwrap();
        let root = home.path().join("snapshot");
        let mut value = snapshot_value();
        value["inheritModel"] = json!(true);
        value["resourceSelection"] = json!({"mode": "selected-only", "mcpServerIds": ["selected"]});
        write_snapshot(&root, value.clone());
        let snapshot = load_snapshot(&root, &"a".repeat(64)).unwrap();
        assert!(snapshot.inherit_model);
        let (overlay, _) = snapshot.contribution(&root).unwrap();
        assert_eq!(overlay["agent_profile_resources"]["enabled"].as_bool(), Some(true));
        assert_eq!(overlay["agent_profile_resources"]["mcp_server_ids"][0].as_str(), Some("selected"));
        value["resourceSelection"]["mode"] = json!("additive");
        write_snapshot(&root, value.clone());
        assert!(load_snapshot(&root, &"a".repeat(64)).is_err());
        value["resourceSelection"] = json!({"mode": "selected-only", "mcpServerIds": ["selected", "selected"]});
        write_snapshot(&root, value);
        assert!(load_snapshot(&root, &"a".repeat(64)).is_err());
    }

    #[test]
    fn profile_integrity_and_manifest_fail_closed() {
        let home = tempfile::tempdir().unwrap();
        let root = home.path().join("snapshot");
        write_snapshot(&root, snapshot_value());
        assert!(load_snapshot(&root, &"a".repeat(64)).is_ok());
        let mut value: Value =
            serde_json::from_slice(&fs::read(root.join("snapshot.json")).unwrap()).unwrap();
        value["context"] = json!("tampered");
        fs::write(
            root.join("snapshot.json"),
            serde_json::to_vec(&value).unwrap(),
        )
        .unwrap();
        assert!(
            load_snapshot(&root, &"a".repeat(64))
                .unwrap_err()
                .to_string()
                .contains("integrity")
        );
        let mut value = snapshot_value();
        value["config"] = json!({"permissions": {"approval_policy": "never"}});
        write_snapshot(&root, value);
        assert!(load_snapshot(&root, &"a".repeat(64)).is_err());
        let mut value = snapshot_value();
        value["files"] = json!({"skills/example/SKILL.md": "ZXhwZWN0ZWQ="});
        fs::create_dir_all(root.join("skills/example")).unwrap();
        fs::write(root.join("skills/example/SKILL.md"), "changed").unwrap();
        write_snapshot(&root, value);
        assert!(
            load_snapshot(&root, &"a".repeat(64))
                .unwrap_err()
                .to_string()
                .contains("manifest")
        );
    }

    // Retain the end-to-end boundary: rebuilding role-local config must not drop
    // selected-only filtering or the mandatory harness resource exceptions.
    #[tokio::test]
    async fn role_profile_selected_resources_reach_skill_and_mcp_catalogs() {
        let home = tempfile::tempdir().unwrap();
        let mut config = crate::session::tests::build_test_config(home.path()).await;
        let workspace = home.path().join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        config.cwd = AbsolutePathBuf::from_absolute_path(workspace).unwrap();
        let ambient = home.path().join("skills");
        let core_skills = [
            "design-collaboration",
            "design-documentation",
            "development-workflow",
            "implementation",
            "testing",
            "project-bootstrap",
        ];
        for name in core_skills.into_iter().chain(["ambient-optional"]) {
            let directory = ambient.join(name);
            fs::create_dir_all(&directory).unwrap();
            fs::write(
                directory.join("SKILL.md"),
                format!("---\nname: {name}\ndescription: {name} guidance\n---\n"),
            )
            .unwrap();
        }
        config.config_layer_stack = config.config_layer_stack.with_session_overlay(
            toml::Value::try_from(json!({"skills": {"extra_roots": [ambient]}})).unwrap(),
        );
        let service = codex_skills_extension::HostSkillsService::new(config.codex_home.clone(), false);
        service.set_home_dir_for_tests(None);
        let ordinary = service
            .snapshot_for_config(
                &crate::skills::skills_load_input_from_config(&config, vec![]),
                Some(Arc::clone(&codex_exec_server::LOCAL_FS)),
            )
            .await;
        assert!(ordinary.outcome().skills.iter().any(|skill| skill.name == "ambient-optional"));

        let root = home.path().join("azrael/task-profiles").join("a".repeat(64));
        let skill = "---\nname: selected-skill\ndescription: Selected profile skill\n---\n";
        fs::create_dir_all(root.join("skills/selected-skill")).unwrap();
        fs::write(root.join("skills/selected-skill/SKILL.md"), skill).unwrap();
        let mut value = snapshot_value();
        value["config"] = json!({"skills.extra_roots": [root.join("skills")]});
        value["files"] = json!({
            "skills/selected-skill/SKILL.md": base64::engine::general_purpose::STANDARD.encode(skill),
        });
        value["resourceSelection"] = json!({"mode": "selected-only", "mcpServerIds": ["selected"]});
        write_snapshot(&root, value);
        let profile: codex_protocol::protocol::AgentRoleProfile = serde_json::from_value(json!({
            "id": "profile-a", "name": "Selected resources", "allowed_roles": ["root"],
            "model": null, "provider": null, "reasoning_effort": null, "instructions": "",
            "profile_extension": {
                "agentProfile": {"digest": "a".repeat(64)},
                "optionalSelection": "selected-only", "mcpServerIds": ["selected"],
            },
        }))
        .unwrap();
        let server: codex_config::types::McpServerConfig =
            toml::from_str("command = 'unused-profile-test-server'\nenabled = true\n").unwrap();
        config.mcp_servers.set(
            ["selected", "unselected", "node_repl", "azrael_window"]
                .into_iter()
                .map(|name| (name.to_owned(), server.clone()))
                .collect(),
        ).unwrap();

        apply_role_profile(&mut config, &profile).unwrap();
        let selected = service
            .snapshot_for_config(
                &crate::skills::skills_load_input_from_config(&config, vec![]),
                Some(Arc::clone(&codex_exec_server::LOCAL_FS)),
            )
            .await;
        let outcome = selected.outcome();
        assert!(outcome.errors.is_empty(), "{:?}", outcome.errors);
        assert!(!outcome.skills.iter().any(|skill| skill.name == "ambient-optional"));
        for name in core_skills.into_iter().chain(["selected-skill"]) {
            let skill = outcome.skills.iter().find(|skill| skill.name == name)
                .unwrap_or_else(|| panic!("missing required skill {name}"));
            assert!(outcome.is_skill_enabled(skill), "disabled required skill {name}");
        }
        let mcp = config.to_mcp_config_with_loaded_plugins(
            &codex_core_plugins::PluginLoadOutcome::default(),
            std::iter::empty(),
        );
        let servers = mcp.mcp_server_catalog.configured_servers();
        for name in ["selected", "node_repl", "azrael_window"] {
            assert!(servers[name].enabled, "disabled selected/core MCP {name}");
        }
        assert!(!servers["unselected"].enabled);
    }

    #[test]
    fn profile_paths_use_the_common_portable_contract() {
        for path in [
            "../config.toml",
            "/root",
            "skills/../auth.json",
            "roles/x:stream",
            "skills/CON",
            "skills/x\\y",
            "skills/file.",
        ] {
            assert!(relative_file(path).is_err(), "{path}");
        }
        assert!(relative_file("skills/example/references/한글.md").is_ok());
        let mut output = String::new();
        canonical(&json!({"z":1,"a":{"b":2,"a":"한글"}}), &mut output).unwrap();
        assert_eq!(output, r#"{"a":{"a":"한글","b":2},"z":1}"#);
        let mut output = String::new();
        canonical(&snapshot_value(), &mut output).unwrap();
        // Produced independently by scripts/instruction-library.cjs::canonicalDigest.
        assert_eq!(
            format!("{:x}", Sha256::digest(output.as_bytes())),
            "9e0acf014a181124d95571d12811158b9a5d9ae5cbb3d677cb02ae68f586b7e2"
        );
    }

    #[test]
    fn profile_hard_links_are_rejected() {
        let home = tempfile::tempdir().unwrap();
        let root = home.path().join("snapshot");
        write_snapshot(&root, snapshot_value());
        fs::hard_link(root.join("snapshot.json"), home.path().join("alias.json")).unwrap();
        assert!(
            load_snapshot(&root, &"a".repeat(64))
                .unwrap_err()
                .to_string()
                .contains("links")
        );
    }

    #[tokio::test]
    #[ignore = "requires a snapshot produced by the real JavaScript materializer"]
    async fn materializer_snapshot_contract_fixture() {
        let home = std::env::var_os("TASK_PROFILE_CONTRACT_HOME")
            .expect("missing materializer fixture home");
        let digest = std::env::var("TASK_PROFILE_CONTRACT_DIGEST")
            .expect("missing materializer fixture digest");
        let expected_model =
            std::env::var("TASK_PROFILE_CONTRACT_MODEL").expect("missing expected fixture model");
        let expected_provider = std::env::var("TASK_PROFILE_CONTRACT_PROVIDER")
            .expect("missing expected fixture provider");
        let expected_account = std::env::var("TASK_PROFILE_CONTRACT_ACCOUNT")
            .expect("missing expected fixture account scope (JSON object or null)");
        let reference = AgentProfileRef {
            digest,
            project_id: None,
            revision: None,
        };
        let snapshot = load(Path::new(&home), &reference)
            .await
            .expect("JavaScript materializer output rejected by native loader");
        assert_eq!(snapshot.model, expected_model);
        assert_eq!(snapshot.provider, expected_provider);
        assert_eq!(
            serde_json::to_value(snapshot.provider_account).unwrap(),
            serde_json::from_str::<Value>(&expected_account).unwrap()
        );
        assert!(
            !snapshot.files.is_empty(),
            "fixture must exercise materialized component files"
        );
        assert!(
            snapshot.config.contains_key("skills.extra_roots"),
            "fixture must exercise native skill roots"
        );
    }

    #[tokio::test]
    async fn profile_composes_native_roots_roles_and_harness_without_overwriting_roles() {
        let (session, _) = make_session_and_context().await;
        let mut native = session.state.lock().await.session_configuration.clone();
        let home = native.codex_home.to_path_buf();
        let root = home.join("azrael/task-profiles").join("a".repeat(64));
        let old_root = home.join("native-skills");
        let original = Arc::make_mut(&mut native.original_config_do_not_use);
        original.config_layer_stack = original.config_layer_stack.with_session_overlay(
            toml::Value::try_from(json!({"skills": {"extra_roots": [old_root]}})).unwrap(),
        );
        let role = "description = 'Profile role'\nmodel = 'gpt-5.1'\ndeveloper_instructions = 'Role contribution'\n";
        let mut value = snapshot_value();
        value["model"] = json!(native.step_settings.collaboration_mode.model());
        let model = value["model"].as_str().unwrap().to_owned();
        value["config"] = json!({
            "skills.extra_roots": [root.join("skills")],
            "agents.profile_worker.config_file": root.join("roles/profile_worker/config.toml"),
            "agents.profile_worker.description": "Profile role",
            "harness.models": {model.clone(): {"prompt_profile": "builtin/claude-lean"}},
        });
        value["files"] = json!({
            "skills/profile-skill/SKILL.md": base64::engine::general_purpose::STANDARD.encode("skill"),
            "roles/profile_worker/config.toml": base64::engine::general_purpose::STANDARD.encode(role),
        });
        value["integrity"] = json!("not-used-by-validated-apply");
        let snapshot: Snapshot = serde_json::from_value(value).unwrap();
        let applied = snapshot.apply(native.clone()).unwrap();
        let roots = applied
            .original_config_do_not_use
            .config_layer_stack
            .effective_config();
        assert_eq!(roots["skills"]["extra_roots"].as_array().unwrap().len(), 2);
        assert!(
            applied
                .original_config_do_not_use
                .agent_roles
                .contains_key("profile_worker")
        );
        assert!(
            !native
                .original_config_do_not_use
                .agent_roles
                .contains_key("profile_worker")
        );
        assert_eq!(
            applied
                .original_config_do_not_use
                .harness_profiles
                .resolve("openai", &model)
                .unwrap()
                .prompt_profile,
            "builtin/claude-lean"
        );
        Arc::make_mut(&mut native.original_config_do_not_use)
            .agent_roles
            .insert("profile_worker".into(), AgentRoleConfig::default());
        assert!(
            snapshot
                .apply(native)
                .err()
                .expect("existing role must be protected")
                .to_string()
                .contains("existing role")
        );
    }

    #[tokio::test]
    async fn project_profiles_admit_only_ordinary_root_sessions() {
        let (session, _) = make_session_and_context().await;
        let mut native = session.state.lock().await.session_configuration.clone();
        assert!(validate_project_admission(&native).is_ok());
        let mut value = snapshot_value();
        value["integrity"] = json!("already-validated");
        value["allowedRoles"] = json!(["subagent"]);
        let snapshot: Snapshot = serde_json::from_value(value).unwrap();
        assert!(snapshot.apply(native.clone()).err().unwrap().to_string().contains("root role"));
        native.session_source = codex_protocol::protocol::SessionSource::SubAgent(codex_protocol::protocol::SubAgentSource::Other("child".into()));
        assert!(validate_project_admission(&native).is_err());
        native.session_source = codex_protocol::protocol::SessionSource::Cli;
        Arc::make_mut(&mut native.original_config_do_not_use).role_profile = Some(codex_protocol::protocol::RoleProfilePolicy {
            configuration_path: Some("team.json".into()), role: codex_protocol::protocol::AgentProfileRole::Root,
            profile_id: "root".into(), profiles: Vec::new(), root_profile_ids: Vec::new(), subagent_profile_ids: Vec::new(), base_developer_instructions: None,
        });
        assert!(validate_project_admission(&native).is_err());
    }

    #[tokio::test]
    async fn restricted_profile_rejects_unverified_and_changed_native_account() {
        let (session, _) = make_session_and_context().await;
        let native = session.state.lock().await.session_configuration.clone();
        let mut value = snapshot_value();
        value["model"] = json!(native.step_settings.collaboration_mode.model());
        value["providerAccount"] = json!({"providerId": "openai", "accountId": "a".repeat(32)});
        value["integrity"] = json!("apply-receives-an-already-validated-snapshot");
        let snapshot: Snapshot = serde_json::from_value(value.clone()).unwrap();
        assert!(
            snapshot.apply(native.clone()).is_err(),
            "unmanaged auth cannot impersonate a saved profile"
        );
        value["providerAccount"]["providerId"] = json!("unknown-provider");
        let snapshot: Snapshot = serde_json::from_value(value).unwrap();
        assert!(
            snapshot.apply(native).is_err(),
            "an unverifiable provider scope must stop execution"
        );
    }

    #[tokio::test]
    async fn profile_turn_overlay_leaves_next_native_turn_unchanged() {
        let (session, _) = make_session_and_context().await;
        let home = tempfile::tempdir().unwrap();
        let root = home
            .path()
            .join("azrael/task-profiles")
            .join("a".repeat(64));
        let native_model = {
            let mut state = session.state.lock().await;
            let configuration = &mut state.session_configuration;
            configuration.codex_home = AbsolutePathBuf::try_from(home.path()).unwrap();
            Arc::make_mut(&mut configuration.original_config_do_not_use).codex_home =
                configuration.codex_home.clone();
            configuration.developer_instructions = Some("Native instructions".to_owned());
            configuration
                .step_settings
                .collaboration_mode
                .model()
                .to_owned()
        };
        let mut value = snapshot_value();
        value["model"] = json!(native_model);
        write_snapshot(&root, value);
        let (profiled, _) = session
            .new_turn_with_sub_id(
                "profiled".into(),
                Default::default(),
                NewTurnContextOptions {
                    agent_profile: Some(AgentProfileRef {
                        digest: "a".repeat(64),
                        project_id: Some("project-a".into()),
                        revision: Some(1),
                    }),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        let (native, _) = session
            .new_turn_with_sub_id("native".into(), Default::default(), Default::default())
            .await
            .unwrap();
        assert_eq!(
            profiled.developer_instructions.as_deref(),
            Some("Native instructions\n\nCaptured contribution")
        );
        assert_eq!(
            native.developer_instructions.as_deref(),
            Some("Native instructions")
        );
        assert_eq!(
            native
                .initial_settings
                .selected_collaboration_mode()
                .model(),
            native_model
        );
        // Keeping an old context alive must not acquire the next turn's settings.
        assert_eq!(
            profiled.developer_instructions.as_deref(),
            Some("Native instructions\n\nCaptured contribution")
        );
        let persisted = vec![
            codex_history::RolloutItem::EventMsg(codex_protocol::protocol::EventMsg::TurnStarted(
                serde_json::from_value(json!({
                    "turn_id": profiled.sub_id,
                    "turn_attribution": profiled.attribution(),
                }))
                .unwrap(),
            )),
            codex_history::RolloutItem::TurnContext(profiled.to_turn_context_item()),
        ];
        let replayed: Vec<codex_history::RolloutItem> =
            serde_json::from_slice(&serde_json::to_vec(&persisted).unwrap()).unwrap();
        let reconstructed = session
            .reconstruct_history_from_rollout(&profiled, &replayed)
            .await;
        {
            let mut state = session.state.lock().await;
            state.turn_attribution = reconstructed.turn_attribution;
            state.set_reference_context_item(reconstructed.reference_context_item);
        }
        let captured = session.recovered_turn_start_options(&profiled.sub_id).await;
        assert_eq!(captured.agent_profile, profiled.agent_profile);
        let recovered = session
            .new_profiled_turn_with_default_settings(
                "recovered".into(),
                NewTurnContextOptions {
                    agent_profile: captured.agent_profile,
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(
            recovered.developer_instructions,
            profiled.developer_instructions
        );
        assert_eq!(recovered.agent_profile, profiled.agent_profile);
        fs::write(root.join("snapshot.json"), "{}").unwrap();
        assert!(
            session
                .new_profiled_turn_with_default_settings(
                    "invalid-recovery".into(),
                    NewTurnContextOptions {
                        agent_profile: recovered.agent_profile.clone(),
                        ..Default::default()
                    }
                )
                .await
                .is_err()
        );
    }
}

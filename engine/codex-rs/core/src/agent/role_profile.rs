//! Captured Team/Direct policy, separate from ambient named agent roles.
use crate::config::Config;
use codex_protocol::protocol::AgentProfileRole;
use codex_protocol::protocol::RoleProfilePolicy;
use codex_protocol::protocol::SessionSource;

/// Only child admission reads the Team-owned mutable copy. Active session instructions
/// remain those captured in the session header.
pub(crate) fn spawn_policy(config: &Config) -> Result<Option<RoleProfilePolicy>, String> {
    let Some(captured) = &config.role_profile else {
        return Ok(None);
    };
    let Some(configured_path) = &captured.configuration_path else {
        return Ok(Some(captured.clone()));
    };
    let load = || -> Result<RoleProfilePolicy, String> {
        let path = std::path::Path::new(configured_path);
        let directory = config.codex_home.join("azrael/role-profiles/teams");
        if !path.is_absolute() || path.extension().is_none_or(|ext| ext != "json") {
            return Err("Team configuration_path must be an absolute JSON path".to_string());
        }
        let canonical_directory = dunce::canonicalize(&directory).map_err(|e| e.to_string())?;
        let canonical = dunce::canonicalize(path).map_err(|e| e.to_string())?;
        let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
        if canonical != path
            || canonical.parent() != Some(canonical_directory.as_path())
            || !metadata.is_file()
            || metadata.file_type().is_symlink()
        {
            return Err("Team configuration_path must name a canonical regular file directly in the Team configuration directory".to_string());
        }
        // Policies contain instructions, not payloads; reject unbounded configuration input.
        if metadata.len() > 4 * 1024 * 1024 {
            return Err("Team configuration exceeds 4 MiB".to_string());
        }
        let bytes = std::fs::read(&canonical).map_err(|e| e.to_string())?;
        let fresh: RoleProfilePolicy = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        if fresh.configuration_path.as_ref() != Some(configured_path) {
            return Err("Team configuration may not replace configuration_path".to_string());
        }
        let mut policy = captured.clone();
        policy.profiles = fresh.profiles;
        policy.root_profile_ids = fresh.root_profile_ids;
        policy.subagent_profile_ids = fresh.subagent_profile_ids;
        policy.selected_profile()?;
        Ok(policy)
    };
    load()
        .map(Some)
        .map_err(|e| format!("Cannot load Team role profiles: {e}"))
}

pub(crate) fn has_root_authority(config: &Config, source: &SessionSource) -> bool {
    config.role_profile.as_ref().map_or_else(
        || !source.is_non_root_agent(),
        |policy| policy.role == AgentProfileRole::Root,
    )
}

pub(crate) fn has_user_interaction_authority(config: &Config, source: &SessionSource) -> bool {
    config.role_profile.as_ref().map_or_else(
        || !source.is_non_root_agent(),
        |policy| matches!(policy.role, AgentProfileRole::Lead | AgentProfileRole::Root),
    )
}

/// Applies frozen instructions, and optionally the initial profile model selection.
/// Resume keeps the session's explicitly selected model and reasoning.
pub(crate) fn apply_policy(config: &mut Config, select_model: bool) -> Result<(), String> {
    let Some(policy) = &config.role_profile else {
        return Ok(());
    };
    let profile = policy.selected_profile()?.clone();
    config.developer_instructions = Some(policy.developer_instructions()?);
    if select_model {
        if let Some(provider) = &profile.provider {
            let provider_info = config
                .model_providers
                .get(provider)
                .cloned()
                .ok_or_else(|| format!("Role profile provider `{provider}` is unavailable"))?;
            if !matches!(
                provider.as_str(),
                crate::devin::PROVIDER_ID | crate::managed_catalog::PROVIDER_ID
            ) {
                config.native_model_provider = Some((provider.clone(), provider_info.clone()));
                config.model_provider = provider_info;
                config.model_provider_id = provider.clone();
            }
        }
        if let Some(model) = &profile.model {
            crate::devin::select_model(config, model).map_err(|e| e.to_string())?;
        }
        if profile
            .provider
            .as_ref()
            .is_some_and(|provider| provider != &config.model_provider_id)
        {
            return Err(
                "Role profile model is incompatible with its selected provider".to_string(),
            );
        }
        config.model_reasoning_effort = profile.reasoning_effort.clone();
    }
    crate::session::agent_profile::apply_role_profile(config, &profile)?;
    Ok(())
}

pub(crate) fn child_policy(
    parent: &RoleProfilePolicy,
    profile_id: &str,
) -> Result<RoleProfilePolicy, String> {
    parent.selected_profile()?;
    if !parent.child_profile_ids().iter().any(|id| id == profile_id) {
        return Err(format!(
            "Role profile `{profile_id}` is not allowed for this parent's children"
        ));
    }
    let mut child = parent.clone();
    child.role = match parent.role {
        AgentProfileRole::Lead => AgentProfileRole::Root,
        AgentProfileRole::Root | AgentProfileRole::Subagent => AgentProfileRole::Subagent,
    };
    child.profile_id = profile_id.to_owned();
    child.selected_profile()?;
    Ok(child)
}

#[cfg(test)]
mod tests {
    use super::*;
    use codex_protocol::protocol::AgentRoleProfile;

    fn policy() -> RoleProfilePolicy {
        let profile = |id: &str, role| AgentRoleProfile {
            id: id.to_owned(),
            name: id.to_owned(),
            allowed_roles: vec![role],
            model: Some("gpt-5.5".to_owned()),
            provider: None,
            reasoning_effort: None,
            instructions: format!("{id} instructions"),
            profile_extension: None,
        };
        RoleProfilePolicy {
            configuration_path: None,
            role: AgentProfileRole::Lead,
            profile_id: "lead".to_owned(),
            profiles: vec![
                profile("lead", AgentProfileRole::Lead),
                profile("root", AgentProfileRole::Root),
                profile("worker", AgentProfileRole::Subagent),
            ],
            root_profile_ids: vec!["root".to_owned()],
            subagent_profile_ids: vec!["worker".to_owned()],
            base_developer_instructions: Some("common runtime".to_owned()),
        }
    }

    // Future edits to spawn admission must preserve both the role boundary and instruction isolation.
    #[test]
    fn role_profile_model_may_inherit_without_changing_role_admission() {
        let mut inherited = policy();
        inherited.profiles[0].model = None;
        assert!(inherited.selected_profile().is_ok());
        inherited.profiles[0].model = Some(String::new());
        assert!(inherited.selected_profile().is_err());
    }

    #[tokio::test]
    async fn direct_session_applies_root_profile_and_resume_preserves_manual_picker() {
        let mut config = crate::config::test_config().await;
        let direct = child_policy(&policy(), "root").unwrap();
        config.role_profile = Some(direct.clone());
        config.model = Some("manual-picker-model".into());
        config.developer_instructions = Some("common runtime\n\nroot instructions".into());
        apply_policy(&mut config, true).unwrap();
        assert_eq!(config.developer_instructions.as_deref(), Some("common runtime\n\nroot instructions"));
        assert_eq!(config.model.as_deref(), Some("gpt-5.5"));
        assert_eq!(config.role_profile.as_ref(), Some(&direct));
        config.model = Some("manual-picker-model".into());
        apply_policy(&mut config, false).unwrap();
        assert_eq!(config.model.as_deref(), Some("manual-picker-model"));
        assert_eq!(config.developer_instructions.as_deref(), Some("common runtime\n\nroot instructions"));
    }

    #[test]
    fn role_profile_children_select_role_and_own_instructions() {
        let lead = policy();
        assert!(child_policy(&lead, "worker").is_err());
        assert!(child_policy(&lead, "missing").is_err());
        let root = child_policy(&lead, "root").unwrap();
        assert_eq!(root.role, AgentProfileRole::Root);
        assert_eq!(
            root.developer_instructions().unwrap(),
            "common runtime\n\nroot instructions"
        );
        assert!(child_policy(&root, "root").is_err());
        let worker = child_policy(&root, "worker").unwrap();
        assert_eq!(worker.role, AgentProfileRole::Subagent);
        assert_eq!(
            worker.developer_instructions().unwrap(),
            "common runtime\n\nworker instructions"
        );
        assert!(child_policy(&worker, "root").is_err());
    }

    #[test]
    fn role_profile_session_meta_round_trip_preserves_frozen_policy() {
        let meta = codex_protocol::protocol::SessionMeta {
            role_profile: Some(policy()),
            ..Default::default()
        };
        let restored: codex_protocol::protocol::SessionMeta =
            serde_json::from_slice(&serde_json::to_vec(&meta).unwrap()).unwrap();
        assert_eq!(restored.role_profile, meta.role_profile);
    }

    // Verify the shared native preparation boundary, including real offline catalog
    // admission, rather than only constructing child-policy data.
    #[tokio::test]
    async fn role_profile_prepare_spawn_applies_model_effort_and_distinct_instructions() {
        use crate::agent::child_config::SpawnConfigOptions;
        use crate::agent::child_config::SpawnConfigVersion;
        use crate::agent::child_config::prepare_agent_spawn_config;
        use crate::session::step_context::StepContext;
        use codex_protocol::openai_models::ReasoningEffort;
        use std::sync::Arc;

        let (session, mut turn) = crate::session::tests::make_session_and_context().await;
        let session_before = session.get_config().await;
        let mut captured = policy();
        let root = captured
            .profiles
            .iter_mut()
            .find(|profile| profile.id == "root")
            .unwrap();
        // This existing native catalog model differs from the fixture parent's gpt-5.5.
        root.model = Some("gpt-6-sol".to_owned());
        root.provider = Some(turn.config.model_provider_id.clone());
        root.reasoning_effort = Some(ReasoningEffort::High);
        let mut alternate = root.clone();
        alternate.id = "root_alternate".to_owned();
        alternate.instructions = "alternate root instructions".to_owned();
        captured.profiles.push(alternate);
        captured.root_profile_ids.push("root_alternate".to_owned());
        let mut config = turn.config.as_ref().clone();
        config.role_profile = Some(captured);
        config.model_reasoning_effort = Some(ReasoningEffort::Low);
        apply_policy(&mut config, false).unwrap();
        turn.developer_instructions = config.developer_instructions.clone();
        turn.config = Arc::new(config);
        crate::session::tests::update_turn_settings_for_test(&mut turn, |settings| {
            crate::session::tests::update_selected_settings_for_test(settings, |selected| {
                selected.collaboration_mode.settings.reasoning_effort = Some(ReasoningEffort::Low);
            });
        });
        let parent_before = turn.config.as_ref().clone();
        let step = StepContext::for_test(Arc::new(turn));
        assert_ne!(step.settings.model_info.slug, "gpt-6-sol");
        assert_eq!(
            step.settings.effective_reasoning_effort(),
            Some(ReasoningEffort::Low)
        );

        for version in [SpawnConfigVersion::V1, SpawnConfigVersion::V2] {
            for (profile_id, expected_instructions) in [
                ("root", "common runtime\n\nroot instructions"),
                (
                    "root_alternate",
                    "common runtime\n\nalternate root instructions",
                ),
            ] {
                let prepared = prepare_agent_spawn_config(
                    &session,
                    step.as_ref(),
                    SpawnConfigOptions {
                        version,
                        full_history_fork: true,
                        role_name: None,
                        profile_id: Some(profile_id),
                        model: None,
                        reasoning_effort: None,
                    },
                )
                .await
                .expect("allowed profile should pass native catalog admission");
                assert_eq!(prepared.role_name.as_deref(), Some(profile_id));
                assert_eq!(prepared.config.model.as_deref(), Some("gpt-6-sol"));
                assert_eq!(
                    prepared.config.model_provider_id,
                    parent_before.model_provider_id
                );
                assert_eq!(
                    prepared.config.model_reasoning_effort,
                    Some(ReasoningEffort::High)
                );
                assert_eq!(
                    prepared.config.developer_instructions.as_deref(),
                    Some(expected_instructions)
                );
                let child = prepared.config.role_profile.as_ref().unwrap();
                assert_eq!(child.role, AgentProfileRole::Root);
                assert_eq!(child.profile_id, profile_id);
                assert_eq!(step.turn.config.as_ref(), &parent_before);
            }
        }
        assert_eq!(session.get_config().await.as_ref(), session_before.as_ref());
        assert_eq!(
            step.turn.developer_instructions.as_deref(),
            Some("common runtime\n\nlead instructions")
        );
    }

    #[tokio::test]
    async fn role_profile_root_authority_keeps_child_lineage_and_resume_selection() {
        let mut config = crate::config::test_config().await;
        config.role_profile = Some(child_policy(&policy(), "root").unwrap());
        config.model = Some("user-selected-model".to_owned());
        config.model_reasoning_effort = Some(codex_protocol::openai_models::ReasoningEffort::High);
        apply_policy(&mut config, false).unwrap();
        assert_eq!(config.model.as_deref(), Some("user-selected-model"));
        assert_eq!(
            config.model_reasoning_effort,
            Some(codex_protocol::openai_models::ReasoningEffort::High)
        );
        let source = SessionSource::SubAgent(codex_protocol::protocol::SubAgentSource::Other(
            "child".to_owned(),
        ));
        assert!(source.is_non_root_agent());
        assert!(has_root_authority(&config, &source));
        assert!(has_user_interaction_authority(&config, &source));
        config.role_profile = Some(policy());
        assert!(!has_root_authority(&config, &SessionSource::Cli));
        assert!(has_user_interaction_authority(&config, &SessionSource::Cli));
    }

    // Team edits are a separate authority from the active caller's captured policy.
    #[tokio::test]
    async fn role_profile_team_refresh_changes_future_children_only_and_fails_closed() {
        let directory = tempfile::tempdir().unwrap();
        let teams = directory.path().join("azrael/role-profiles/teams");
        std::fs::create_dir_all(&teams).unwrap();
        let path = teams.join("team.json");
        std::fs::write(&path, b"{}").unwrap();
        let path = dunce::canonicalize(&path)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let mut captured = child_policy(&policy(), "root").unwrap();
        captured.configuration_path = Some(path.clone());
        let mut fresh = policy();
        fresh.configuration_path = Some(path.clone());
        fresh.base_developer_instructions = Some("unauthorized common replacement".to_owned());
        fresh.profiles[2].instructions = "edited future worker".to_owned();
        std::fs::write(&path, serde_json::to_vec(&fresh).unwrap()).unwrap();
        let mut config = crate::config::test_config().await;
        config.codex_home =
            codex_utils_absolute_path::AbsolutePathBuf::from_absolute_path(directory.path())
                .unwrap();
        config.role_profile = Some(captured.clone());
        apply_policy(&mut config, false).unwrap();
        let active_instructions = config.developer_instructions.clone();
        let loaded = spawn_policy(&config).unwrap().unwrap();
        assert_eq!(loaded.role, AgentProfileRole::Root);
        assert_eq!(loaded.profile_id, "root");
        assert_eq!(
            loaded.base_developer_instructions.as_deref(),
            Some("common runtime")
        );
        assert_eq!(
            child_policy(&loaded, "worker")
                .unwrap()
                .developer_instructions()
                .unwrap(),
            "common runtime\n\nedited future worker"
        );
        assert_eq!(config.role_profile, Some(captured));
        assert_eq!(config.developer_instructions, active_instructions);
        std::fs::write(&path, b"malformed").unwrap();
        assert!(spawn_policy(&config).is_err());
        std::fs::remove_file(&path).unwrap();
        assert!(spawn_policy(&config).is_err());
    }
}

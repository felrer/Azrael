//! Request-scoped policy composition for an independently authenticated OpenAI service.

use super::Config;
use super::managed_features::ManagedFeatures;
use codex_config::CloudConfigBundleLayers;
use codex_config::ConfigRequirements;
use codex_config::ConfigRequirementsToml;
use codex_config::ConfigRequirementsWithSources;
use codex_config::RequirementSource;
use codex_config::compose_requirements;
use codex_features::Feature;
use codex_features::canonical_feature_for_key;
use codex_http_client::DestinationPolicy;
use codex_login::AuthManager;
use std::io;
use std::sync::Arc;

fn blocked(field: &str) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        format!(
            "OpenAI service policy cannot satisfy `{field}` together with the current request policy"
        ),
    )
}

fn exact<T: Clone + PartialEq>(
    parent: &mut Option<T>,
    service: Option<T>,
    field: &str,
) -> io::Result<()> {
    if let Some(service) = service {
        if parent.as_ref().is_some_and(|parent| parent != &service) {
            return Err(blocked(field));
        }
        *parent = Some(service);
    }
    Ok(())
}

fn allowed<T: Clone + PartialEq>(
    parent: &mut Option<Vec<T>>,
    service: Option<Vec<T>>,
    field: &str,
) -> io::Result<()> {
    if let Some(service) = service {
        let intersection = match parent.as_ref() {
            Some(parent) => parent
                .iter()
                .filter(|value| service.contains(value))
                .cloned()
                .collect(),
            None => service,
        };
        if intersection.is_empty() {
            return Err(blocked(field));
        }
        *parent = Some(intersection);
    }
    Ok(())
}

/// Explicitly enumerate every requirement. New requirement fields must receive an
/// enforcement decision here instead of disappearing during request-only loading.
fn intersect_service_requirements(
    parent: &ConfigRequirementsToml,
    service: ConfigRequirementsToml,
) -> io::Result<ConfigRequirementsToml> {
    let ConfigRequirementsToml {
        allowed_login_methods,
        allowed_chatgpt_workspaces,
        cli_auth_credentials_store,
        chatgpt_base_url,
        sqlite_home,
        log_dir,
        model_catalog_json,
        model_provider,
        model_providers,
        check_for_update_on_startup,
        allow_login_shell,
        feedback,
        allowed_approval_policies,
        allowed_approvals_reviewers,
        allowed_sandbox_modes,
        allowed_permission_profiles,
        default_permissions,
        remote_sandbox_config,
        allowed_web_search_modes,
        allow_managed_hooks_only,
        allow_browser_and_computer_use,
        allow_appshots,
        allow_remote_control,
        computer_use,
        browser_use,
        in_app_browser,
        windows,
        feature_requirements,
        hooks,
        mcp_servers,
        plugins,
        marketplaces,
        apps,
        rules,
        enforce_residency,
        network,
        application,
        permissions,
        auto_review,
        models,
        additional_developer_instructions,
        guardian_policy_config,
        guardian_extra_policy,
    } = service;
    let mut result = parent.clone();
    allowed(
        &mut result.allowed_login_methods,
        allowed_login_methods,
        "allowed_login_methods",
    )?;
    allowed(
        &mut result.allowed_chatgpt_workspaces,
        allowed_chatgpt_workspaces,
        "allowed_chatgpt_workspaces",
    )?;
    exact(&mut result.model_provider, model_provider, "model_provider")?;
    exact(
        &mut result.model_providers,
        model_providers,
        "model_providers",
    )?;
    exact(
        &mut result.enforce_residency,
        enforce_residency,
        "enforce_residency",
    )?;
    exact(
        &mut result.guardian_policy_config,
        guardian_policy_config,
        "guardian_policy_config",
    )?;
    // Extra policies and developer requirements are additive instructions.
    for (target, incoming) in [
        (&mut result.guardian_extra_policy, guardian_extra_policy),
        (
            &mut result.additional_developer_instructions,
            additional_developer_instructions,
        ),
    ] {
        if let Some(incoming) = incoming {
            match target {
                Some(existing) if *existing != incoming => {
                    existing.push_str("\n\n");
                    existing.push_str(&incoming);
                }
                None => *target = Some(incoming),
                _ => {}
            }
        }
    }
    if let Some(service) = feature_requirements {
        let entries = &mut result.feature_requirements.get_or_insert_default().entries;
        for (key, value) in service.entries {
            let feature = canonical_feature_for_key(&key)
                .ok_or_else(|| blocked(&format!("features.{key}")))?;
            // Match aliases by semantic identity, not spelling.
            if entries.iter().any(|(key, parent)| {
                canonical_feature_for_key(key) == Some(feature) && *parent != value
            }) {
                return Err(blocked(&format!("features.{key}")));
            }
            entries.insert(key, value);
        }
    }
    if let Some(service) = application {
        let parent_network = result
            .application
            .as_ref()
            .and_then(|value| value.network.as_ref());
        let service_network = service.network.as_ref();
        let mut combined = service.clone();
        if let Some(parent_network) = parent_network.filter(|network| network.enabled) {
            match combined.network.as_mut().filter(|network| network.enabled) {
                Some(network) => {
                    network.domains.retain(|host, permission| {
                        *permission == codex_config::NetworkDomainPermissionToml::Allow
                            && parent_network.domains.get(host)
                                == Some(&codex_config::NetworkDomainPermissionToml::Allow)
                    });
                }
                None => combined.network = Some(parent_network.clone()),
            }
        } else if service_network.is_none() {
            combined = result.application.clone().unwrap_or_default();
        }
        result.application = Some(combined);
    }
    // These requirements govern other execution owners (tools, filesystem,
    // credentials, UI, etc.). Existing identical requirements remain enforced by
    // the parent. A new/different constraint has no proven request-only application
    // path and must block this request, never silently become a default.
    macro_rules! existing_only { ($($field:ident),* $(,)?) => { $(
        if $field.as_ref().is_some_and(|service| parent.$field.as_ref() != Some(service)) {
            return Err(blocked(stringify!($field)));
        }
    )* }; }
    existing_only!(
        cli_auth_credentials_store,
        chatgpt_base_url,
        sqlite_home,
        log_dir,
        model_catalog_json,
        check_for_update_on_startup,
        allow_login_shell,
        feedback,
        allowed_approval_policies,
        allowed_approvals_reviewers,
        allowed_sandbox_modes,
        allowed_permission_profiles,
        default_permissions,
        remote_sandbox_config,
        allowed_web_search_modes,
        allow_managed_hooks_only,
        allow_browser_and_computer_use,
        allow_appshots,
        allow_remote_control,
        computer_use,
        browser_use,
        in_app_browser,
        windows,
        hooks,
        mcp_servers,
        plugins,
        marketplaces,
        apps,
        rules,
        network,
        permissions,
        auto_review,
        models
    );
    Ok(result)
}

impl Config {
    /// Clone the current runtime, enforcing both its policy and the service
    /// account's mandatory policy. Ordinary cloud config defaults do not replace
    /// the project's current configuration or runtime overrides.
    pub async fn for_openai_service(&self, manager: Arc<AuthManager>) -> io::Result<Self> {
        let loader = codex_cloud_config::cloud_config_bundle_loader(
            Arc::clone(&manager),
            self.chatgpt_base_url.clone(),
            self.codex_home.to_path_buf(),
            manager.http_client_factory(),
        );
        let snapshot = loader.get_snapshot().await;
        let bundle = snapshot
            .bundle
            .map_err(|error| blocked(&format!("cloud requirements: {error}")))?;
        let bundle = bundle.unwrap_or_default();
        // Reject unrecognized mandatory top-level fields before the normal
        // forward-compatible requirements parser can ignore them.
        for fragment in &bundle.requirements_toml.enterprise_managed {
            validate_requirement_keys(&fragment.contents)?;
        }
        let layers = CloudConfigBundleLayers::from_bundle(bundle, &self.codex_home)
            .map_err(|error| blocked(&format!("cloud requirements: {error}")))?;
        let service = compose_requirements(layers.enterprise_managed_requirements)
            .map_err(|error| blocked(&format!("cloud requirements: {error}")))?
            .unwrap_or_default()
            .into_toml();
        let requirements_toml =
            intersect_service_requirements(self.config_layer_stack.requirements_toml(), service)?;
        let mut sourced = ConfigRequirementsWithSources::default();
        sourced.merge_unset_fields(RequirementSource::Unknown, requirements_toml.clone());
        let requirements =
            ConfigRequirements::try_from(sourced).map_err(|error| blocked(&error.to_string()))?;
        super::validate_managed_developer_instructions(
            requirements.additional_developer_instructions.as_ref(),
        )?;
        let mut result = self.clone();
        // Authentication constraints apply to the independently selected service
        // credential, without changing the parent's authentication manager.
        if requirements_toml.allowed_login_methods.is_some()
            || requirements_toml.allowed_chatgpt_workspaces.is_some()
        {
            let auth = manager
                .auth()
                .await
                .ok_or_else(|| blocked("service authentication"))?;
            let method = if auth.auth_mode().uses_codex_backend() {
                codex_protocol::config_types::ForcedLoginMethod::Chatgpt
            } else {
                codex_protocol::config_types::ForcedLoginMethod::Api
            };
            if requirements_toml
                .allowed_login_methods
                .as_ref()
                .is_some_and(|allowed| !allowed.contains(&method))
            {
                return Err(blocked("allowed_login_methods"));
            }
            if requirements_toml
                .allowed_chatgpt_workspaces
                .as_ref()
                .is_some_and(|allowed| {
                    method != codex_protocol::config_types::ForcedLoginMethod::Chatgpt
                        || auth
                            .get_account_id()
                            .is_none_or(|id| !allowed.contains(&id))
                })
            {
                return Err(blocked("allowed_chatgpt_workspaces"));
            }
        }
        result.features = ManagedFeatures::from_configured(
            self.features.get().clone(),
            requirements.feature_requirements.clone(),
        )?;
        if requirements
            .feature_requirements
            .as_ref()
            .is_some_and(|features| {
                features
                    .value
                    .entries
                    .keys()
                    .any(|key| canonical_feature_for_key(key) == Some(Feature::RespectSystemProxy))
            })
        {
            result.respect_system_proxy = result.features.enabled(Feature::RespectSystemProxy);
        }
        result.enforce_residency = requirements.enforce_residency.value.clone();
        if let Some(providers) = &requirements_toml.model_providers {
            result.model_providers.extend(providers.clone());
        }
        if let Some(provider) = &requirements_toml.model_provider {
            result.model_provider = result
                .model_providers
                .get(provider)
                .cloned()
                .ok_or_else(|| blocked("model_provider"))?;
            result.model_provider_id = provider.clone();
        } else if let Some(provider) = requirements_toml
            .model_providers
            .as_ref()
            .and_then(|providers| providers.get(&result.model_provider_id))
        {
            result.model_provider = provider.clone();
        }
        if requirements_toml.guardian_policy_config.is_some() {
            result.guardian_policy_config =
                super::guardian_policy_config_from_requirements(&requirements_toml);
        }
        if requirements_toml.guardian_extra_policy.is_some() {
            result.guardian_extra_policy = requirements_toml.guardian_extra_policy.clone();
        }
        if let Some(network) = requirements_toml
            .application
            .as_ref()
            .and_then(|application| application.network.as_ref())
            .filter(|network| network.enabled)
        {
            let allowed_hosts = network
                .domains
                .iter()
                .filter(|(_, permission)| {
                    **permission == codex_config::NetworkDomainPermissionToml::Allow
                })
                .map(|(host, _)| host.clone())
                .collect();
            result.application_network_policy = result
                .application_network_policy
                .restrict_to_destinations(DestinationPolicy::Restricted { allowed_hosts });
        }
        // Retain the runtime's auth route when its effective transport did not
        // change. A changed content route must use the narrowed request policy.
        if result.http_client_factory() != self.http_client_factory() {
            result.application_auth_route_config =
                Some(codex_login::AuthRouteConfig::from_http_client_factory(
                    result.http_client_factory(),
                ));
        }
        result.config_layer_stack = self
            .config_layer_stack
            .with_requirements(requirements, requirements_toml)?;
        if snapshot.binding.is_some() {
            result.config_layer_stack = result
                .config_layer_stack
                .with_cloud_config_binding(snapshot.binding);
        }
        Ok(result)
    }
}

fn validate_requirement_keys(contents: &str) -> io::Result<()> {
    let value: toml::Value =
        toml::from_str(contents).map_err(|error| blocked(&error.to_string()))?;
    // Cloud layers deliberately discard local-only auth policy. Refuse it here
    // rather than falsely reporting that the service request enforced it.
    for key in [
        "allowed_login_methods",
        "allowed_chatgpt_workspaces",
        "cli_auth_credentials_store",
        "chatgpt_base_url",
    ] {
        if value.get(key).is_some() {
            return Err(blocked(key));
        }
    }
    let mut ignored = Vec::new();
    let _: ConfigRequirementsToml =
        serde_ignored::deserialize(value.clone(), |path| ignored.push(path.to_string()))
            .map_err(|error| blocked(&error.to_string()))?;
    if let Some(path) = ignored.first() {
        return Err(blocked(path));
    }
    for key in value
        .as_table()
        .ok_or_else(|| blocked("requirements"))?
        .keys()
    {
        // Unsupported known fields are rejected by the exhaustive typed mapping.
        // Keep this list aligned with ConfigRequirementsToml; unknown mandatory
        // fields fail closed instead of inheriting its tolerant deserializer.
        if !matches!(
            key.as_str(),
            "allowed_login_methods"
                | "allowed_chatgpt_workspaces"
                | "cli_auth_credentials_store"
                | "chatgpt_base_url"
                | "sqlite_home"
                | "log_dir"
                | "model_catalog_json"
                | "model_provider"
                | "model_providers"
                | "check_for_update_on_startup"
                | "allow_login_shell"
                | "feedback"
                | "allowed_approval_policies"
                | "allowed_approvals_reviewers"
                | "allowed_sandbox_modes"
                | "allowed_permission_profiles"
                | "default_permissions"
                | "remote_sandbox_config"
                | "allowed_web_search_modes"
                | "allow_managed_hooks_only"
                | "allow_browser_and_computer_use"
                | "allow_appshots"
                | "allow_remote_control"
                | "computer_use"
                | "browser_use"
                | "in_app_browser"
                | "windows"
                | "features"
                | "feature_requirements"
                | "hooks"
                | "mcp_servers"
                | "plugins"
                | "marketplaces"
                | "apps"
                | "rules"
                | "enforce_residency"
                | "experimental_network"
                | "application"
                | "permissions"
                | "auto_review"
                | "models"
                | "additional_developer_instructions"
                | "guardian_policy_config"
                | "guardian_extra_policy"
        ) {
            return Err(blocked(key));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_policy_intersects_workspaces_and_preserves_parent() {
        let parent: ConfigRequirementsToml =
            toml::from_str("allowed_chatgpt_workspaces = ['a', 'b']").unwrap();
        let service = toml::from_str("allowed_chatgpt_workspaces = ['b', 'c']").unwrap();
        let result = intersect_service_requirements(&parent, service).unwrap();
        assert_eq!(result.allowed_chatgpt_workspaces, Some(vec!["b".into()]));
        assert_eq!(
            parent.allowed_chatgpt_workspaces,
            Some(vec!["a".into(), "b".into()])
        );
        assert!(
            intersect_service_requirements(
                &parent,
                toml::from_str("allowed_chatgpt_workspaces = ['c']").unwrap()
            )
            .is_err()
        );
    }

    #[test]
    fn service_policy_conflicts_and_unknown_constraints_fail_closed() {
        let parent = toml::from_str("model_provider = 'openai'").unwrap();
        assert!(
            intersect_service_requirements(
                &parent,
                toml::from_str("model_provider = 'other'").unwrap()
            )
            .is_err()
        );
        assert!(
            intersect_service_requirements(
                &ConfigRequirementsToml::default(),
                toml::from_str("allow_login_shell = false").unwrap()
            )
            .is_err()
        );
        assert!(validate_requirement_keys("future_policy = true").is_err());
        assert!(
            intersect_service_requirements(
                &ConfigRequirementsToml::default(),
                toml::from_str("[features]\nfuture_feature = false").unwrap()
            )
            .is_err()
        );
    }

    #[test]
    fn service_policy_application_network_is_an_intersection() {
        let parent = toml::from_str(
            "[application.network.domains]\n'a.example'='allow'\n'b.example'='allow'",
        )
        .unwrap();
        let service = toml::from_str(
            "[application.network.domains]\n'b.example'='allow'\n'c.example'='allow'",
        )
        .unwrap();
        let result = intersect_service_requirements(&parent, service).unwrap();
        let network = result.application.unwrap().network.unwrap();
        assert_eq!(
            network.domains.keys().cloned().collect::<Vec<_>>(),
            vec!["b.example"]
        );
    }
}

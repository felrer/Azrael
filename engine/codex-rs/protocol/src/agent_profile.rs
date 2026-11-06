//! Host-resolved, credential-free reference to an immutable task profile.
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use ts_rs::TS;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub enum AgentProfileExecutionMode { Direct, Team, Role }

/// Runtime identity, independent of a caller's current project selection.
pub fn execution_mode(policy: Option<&crate::protocol::RoleProfilePolicy>, source: &crate::protocol::SessionSource) -> AgentProfileExecutionMode {
    if policy.is_some_and(|p| p.configuration_path.is_some()) {
        AgentProfileExecutionMode::Team
    } else if source.is_non_root_agent() || policy.is_some_and(|p| p.role != crate::protocol::AgentProfileRole::Root) {
        AgentProfileExecutionMode::Role
    } else {
        AgentProfileExecutionMode::Direct
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderAccountScope {
    pub provider_id: String,
    pub account_id: String,
}

impl ProviderAccountScope {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.provider_id.is_empty()
            || self.provider_id.len() > 200
            || self.account_id.is_empty()
            || self.account_id.len() > 500
            || self
                .provider_id
                .chars()
                .chain(self.account_id.chars())
                .any(char::is_control)
        {
            return Err("invalid task profile provider account scope");
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export_to = "v2/")]
pub struct AgentProfileRef {
    pub digest: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub revision: Option<u64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execution_mode_uses_policy_and_native_source_instead_of_role_name() {
        use crate::protocol::{AgentProfileRole, RoleProfilePolicy, SessionSource, SubAgentSource};
        let mut policy = RoleProfilePolicy {
            configuration_path: None, role: AgentProfileRole::Root, profile_id: "root".into(),
            profiles: Vec::new(), root_profile_ids: Vec::new(), subagent_profile_ids: Vec::new(), base_developer_instructions: None,
        };
        assert_eq!(execution_mode(None, &SessionSource::Cli), AgentProfileExecutionMode::Direct);
        assert_eq!(execution_mode(Some(&policy), &SessionSource::Cli), AgentProfileExecutionMode::Direct);
        let child = SessionSource::SubAgent(SubAgentSource::Other("child".into()));
        assert_eq!(execution_mode(Some(&policy), &child), AgentProfileExecutionMode::Role);
        policy.configuration_path = Some("team.json".into());
        assert_eq!(execution_mode(Some(&policy), &SessionSource::Cli), AgentProfileExecutionMode::Team);
        assert_eq!(execution_mode(Some(&policy), &child), AgentProfileExecutionMode::Team);
    }

    #[test]
    fn reference_is_camel_case_and_rejects_paths() {
        let reference = AgentProfileRef {
            digest: "a".repeat(64),
            project_id: Some("project-a".into()),
            revision: Some(2),
        };
        let value = serde_json::to_value(&reference).unwrap();
        assert_eq!(value["projectId"], "project-a");
        assert_eq!(value["revision"], 2);
        assert!(reference.validate().is_ok());
        for digest in ["../config.toml".to_owned(), "A".repeat(64), "a".repeat(63)] {
            assert!(
                AgentProfileRef {
                    digest,
                    ..reference.clone()
                }
                .validate()
                .is_err()
            );
        }
        let mut injected = value;
        injected["snapshotPath"] = serde_json::json!("arbitrary.json");
        assert!(serde_json::from_value::<AgentProfileRef>(injected).is_err());
    }
}

impl AgentProfileRef {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.digest.len() != 64
            || !self
                .digest
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        {
            return Err("agent profile digest must be 64 lowercase hexadecimal characters");
        }
        Ok(())
    }
}

/// Credential-free host metadata. Execution uses only the validated snapshot reference.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoleProfileExtension {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_profile: Option<AgentProfileRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_ids: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_selections: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub components: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub component_ids: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_server_ids: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub optional_selection: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_account: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_selection: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<serde_json::Value>,
}

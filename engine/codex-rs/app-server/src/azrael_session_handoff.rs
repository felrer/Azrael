//! Private, thread-scoped transfer metadata. A receipt never grants the engine lease.
use codex_protocol::ThreadId;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io;
use std::path::{Path, PathBuf};

pub(crate) const PROTOCOL: u32 = 1;

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn hex(value: &str, minimum: usize) -> bool {
    (minimum..=64).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Attach {
    pub schema: u32,
    pub protocol: u32,
    pub thread_id: String,
    pub workspace_id: String,
    pub owner_id: String,
    pub host_pid: u32,
    pub target_instance_id: String,
    pub source_instance_id: String,
    pub source_identity: String,
    pub storage_compatibility: Value,
}

impl Attach {
    pub fn validate(
        &self,
        instance: &str,
        identity: &str,
        compatibility: &Value,
    ) -> io::Result<()> {
        if self.schema != 1
            || self.protocol != PROTOCOL
            || ThreadId::from_string(&self.thread_id)
                .map(|id| id.to_string())
                .ok()
                .as_deref()
                != Some(&self.thread_id)
            || !hex(&self.workspace_id, 64)
            || !hex(&self.owner_id, 32)
            || !hex(&self.target_instance_id, 64)
            || self.target_instance_id == instance
            || self.source_instance_id != instance
            || self.source_identity != identity
            || &self.storage_compatibility != compatibility
            || self.host_pid == 0
        {
            return Err(invalid(
                "session attachment identity or storage compatibility mismatch",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Selection {
    pub selected_profile_id: Option<String>,
    #[serde(default)]
    pub requires_recovery: bool,
}

impl Selection {
    pub fn read(path: &Path, default: Option<&Path>, home: &Path) -> io::Result<Self> {
        let path = if path.try_exists()? {
            path.to_path_buf()
        } else if let Some(default) = default.filter(|p| p.exists()) {
            default.to_path_buf()
        } else {
            home.join("account-state.json")
        };
        let selection = match std::fs::read(path) {
            Ok(bytes) => {
                // Copy only the two selection fields, never authentication material.
                let value: Value = serde_json::from_slice(&bytes).map_err(io::Error::other)?;
                let selected = value
                    .get("selectedProfileId")
                    .ok_or_else(|| invalid("selection identity missing"))?;
                serde_json::from_value(serde_json::json!({"selectedProfileId": selected,
                    "requiresRecovery": value.get("requiresRecovery").cloned().unwrap_or(Value::Bool(false))}))
                    .map_err(io::Error::other)?
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => Self {
                selected_profile_id: None,
                requires_recovery: false,
            },
            Err(error) => return Err(error),
        };
        Ok(selection)
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Receipt {
    pub schema: u32,
    pub protocol: u32,
    pub state: String,
    pub thread_id: String,
    pub workspace_id: String,
    pub source_instance_id: String,
    pub source_identity: String,
    pub target_instance_id: String,
    pub storage_compatibility: Value,
    pub selection: Selection,
    /// Whitelisted, token-free fields accepted by normal thread/resume.
    pub resume: Value,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RuntimeSnapshot {
    pub computer_use_mode: Option<codex_protocol::protocol::ComputerUseMode>,
    pub settings: codex_protocol::protocol::ThreadSettingsSnapshot,
    pub profile_roots: Vec<String>,
    pub environments: Vec<LocalEnvironment>,
    pub client_mcp_extensions: Vec<(String, Value)>,
    pub base_instructions: Option<String>,
    pub developer_instructions: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LocalEnvironment {
    pub id: String,
    pub cwd: String,
    pub roots: Vec<String>,
}

impl RuntimeSnapshot {
    pub fn safe_client_capabilities(&self) -> bool {
        use codex_protocol::mcp::{
            MCP_APP_UI_EXTENSION_ID, OPENAI_ELICITATION_EXTENSION_ID, OPENAI_FORM_EXTENSION_ID,
            OPENAI_STANDARD_FORM_INPUT_EXTENSION_ID,
        };
        self.client_mcp_extensions.iter().all(|(id, value)| {
            let Some(settings) = value.as_object() else {
                return false;
            };
            match id.as_str() {
                OPENAI_STANDARD_FORM_INPUT_EXTENSION_ID => settings.is_empty(),
                OPENAI_FORM_EXTENSION_ID => settings
                    .iter()
                    .all(|(key, value)| key == "version" && value.as_u64().is_some()),
                OPENAI_ELICITATION_EXTENSION_ID => settings.iter().all(|(key, value)| {
                    matches!(key.as_str(), "form" | "userVerification")
                        && value.as_object().is_some_and(|object| object.is_empty())
                }),
                MCP_APP_UI_EXTENSION_ID => settings.iter().all(|(key, value)| {
                    key == "mimeTypes"
                        && value.as_array().is_some_and(|types| {
                            types.iter().all(|value| {
                                matches!(
                                    value.as_str(),
                                    Some("text/html" | "text/html;profile=mcp-app")
                                )
                            })
                        })
                }),
                _ => false,
            }
        })
    }

    pub fn permission_snapshot(
        &self,
    ) -> io::Result<codex_protocol::models::PermissionProfileSnapshot> {
        use codex_protocol::models::{PermissionProfileSnapshot, ProfileWorkspaceRoot};
        let roots = self
            .profile_roots
            .iter()
            .map(|root| {
                codex_utils_path_uri::PathUri::parse(root)
                    .map(ProfileWorkspaceRoot::from)
                    .map_err(io::Error::other)
            })
            .collect::<io::Result<Vec<_>>>()?;
        match &self.settings.active_permission_profile {
            Some(profile) => Ok(
                PermissionProfileSnapshot::active_with_profile_workspace_roots(
                    self.settings.permission_profile.clone(),
                    profile.clone(),
                    roots,
                ),
            ),
            None if roots.is_empty() => Ok(PermissionProfileSnapshot::legacy(
                self.settings.permission_profile.clone(),
            )),
            None => Err(invalid("profile roots lack active permission identity")),
        }
    }

    pub fn overrides(&self) -> io::Result<codex_core::CodexThreadSettingsOverrides> {
        use codex_protocol::models::ProfileWorkspaceRoot;
        use codex_protocol::protocol::{
            EnvironmentConfigState, TurnEnvironmentRequest, TurnEnvironmentRequests,
        };
        use codex_utils_path_uri::PathUri;
        let settings = &self.settings;
        let environments = self
            .environments
            .iter()
            .map(|environment| {
                Ok(TurnEnvironmentRequest {
                    environment_id: environment.id.clone(),
                    cwd: PathUri::parse(&environment.cwd).map_err(io::Error::other)?,
                    workspace_roots: environment
                        .roots
                        .iter()
                        .map(|root| PathUri::parse(root).map_err(io::Error::other))
                        .collect::<io::Result<Vec<_>>>()?,
                    config: EnvironmentConfigState::FromThread,
                })
            })
            .collect::<io::Result<Vec<_>>>()?;
        Ok(codex_core::CodexThreadSettingsOverrides {
            auto_compaction_enabled: Some(settings.auto_compaction_enabled),
            environments: Some(TurnEnvironmentRequests::new(
                settings.cwd.clone(),
                environments,
            )),
            runtime_workspace_roots: settings.runtime_workspace_roots.clone(),
            profile_workspace_roots: Some(
                self.profile_roots
                    .iter()
                    .map(|root| {
                        PathUri::parse(root)
                            .map(ProfileWorkspaceRoot::from)
                            .map_err(io::Error::other)
                    })
                    .collect::<io::Result<Vec<_>>>()?,
            ),
            approval_policy: Some(settings.approval_policy),
            approvals_reviewer: Some(settings.approvals_reviewer),
            permission_profile: Some(settings.permission_profile.clone()),
            active_permission_profile: settings.active_permission_profile.clone(),
            model: Some(settings.model.clone()),
            effort: Some(settings.reasoning_effort.clone()),
            summary: settings.reasoning_summary,
            service_tier: Some(settings.service_tier.clone()),
            collaboration_mode: Some(settings.collaboration_mode.clone()),
            personality: settings.personality,
            disabled_plugin_ids: Some(settings.disabled_plugin_ids.clone()),
            ..Default::default()
        })
    }

    pub fn resume_params(&self) -> Value {
        serde_json::json!({"computerUseMode":self.computer_use_mode,"model":self.settings.model,"modelProvider":self.settings.model_provider_id,
            "serviceTier":self.settings.service_tier,"cwd":self.settings.cwd,
            "runtimeWorkspaceRoots":self.settings.runtime_workspace_roots,"approvalPolicy":self.settings.approval_policy,
            "approvalsReviewer":self.settings.approvals_reviewer,"baseInstructions":self.base_instructions,
            "developerInstructions":self.developer_instructions,"personality":self.settings.personality,
            "config":{"model_reasoning_effort":self.settings.reasoning_effort,"model_reasoning_summary":self.settings.reasoning_summary}})
    }
}

pub(crate) fn receipt_path(home: &Path, thread: &str) -> io::Result<PathBuf> {
    let id = ThreadId::from_string(thread).map_err(io::Error::other)?;
    Ok(home
        .join("azrael-thread-engines-v1")
        .join(format!("{id}.transfer.json")))
}

impl Receipt {
    pub fn validate(
        &self,
        thread: &str,
        workspace: &str,
        target: &str,
        compatibility: &Value,
    ) -> io::Result<()> {
        if self.schema != 1
            || self.protocol != PROTOCOL
            || self.state != "stopped"
            || self.thread_id != thread
            || self.workspace_id != workspace
            || self.target_instance_id != target
            || !hex(&self.source_instance_id, 64)
            || !hex(&self.source_identity, 64)
            || self.source_instance_id == target
            || &self.storage_compatibility != compatibility
            || !self.resume.is_object()
        {
            return Err(invalid("incomplete or mismatched session transfer receipt"));
        }
        Ok(())
    }

    pub fn read(home: &Path, thread: &str) -> io::Result<Option<Self>> {
        let path = receipt_path(home, thread)?;
        match std::fs::symlink_metadata(&path) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_file() {
                    return Err(invalid("unsafe transfer receipt"));
                }
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if metadata.file_attributes() & 0x400 != 0 {
                        return Err(invalid("unsafe transfer receipt"));
                    }
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::MetadataExt;
                    if metadata.uid() != unsafe { libc::geteuid() } || metadata.nlink() != 1 {
                        return Err(invalid("unsafe transfer receipt"));
                    }
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        }
        serde_json::from_slice(&std::fs::read(path)?)
            .map(Some)
            .map_err(io::Error::other)
    }
}

/// Only explicitly thread-addressed notifications and server callbacks enter an attached stream.
pub(crate) fn message_thread(value: &Value) -> Option<&str> {
    let params = value.get("params")?;
    params
        .get("threadId")
        .or_else(|| params.get("conversationId"))
        .or_else(|| params.get("thread").and_then(|thread| thread.get("id")))?
        .as_str()
}

pub(crate) fn scoped_request(method: &str, params: Option<&Value>, thread: &str) -> bool {
    if method == "initialize" {
        return true;
    }
    let Some(params) = params else {
        return false;
    };
    // This namespace allowlist excludes global/account/config operations even if they carry
    // an incidental threadId. Fork/start create another runtime and are intentionally excluded.
    (method.starts_with("thread/") || method.starts_with("turn/") || method.starts_with("item/"))
        && !matches!(method, "thread/start" | "thread/fork")
        && params.get("threadId").and_then(Value::as_str) == Some(thread)
}

/// Opening a source session observes its existing runtime. A new UI's defaults cannot
/// trigger generic resume's replacement-runtime path or replace source history/settings.
pub(crate) fn retain_scoped_resume_presentation(params: &mut Value) {
    if let Some(params) = params.as_object_mut() {
        params.retain(|key, _| {
            matches!(
                key.as_str(),
                "threadId" | "excludeTurns" | "initialTurnsPage"
            )
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn target_resume_preserves_source_computer_use_ceiling_including_absence() {
        use codex_protocol::config_types::{
            ApprovalsReviewer, CollaborationMode, ModeKind, Settings,
        };
        use codex_protocol::protocol::{AskForApproval, ComputerUseMode, ThreadSettingsSnapshot};
        let home = tempfile::tempdir().unwrap();
        let mut snapshot = RuntimeSnapshot {
            computer_use_mode: Some(ComputerUseMode::SelectedWindow),
            settings: ThreadSettingsSnapshot {
                auto_compaction_enabled: true,
                model: "source-model".into(),
                model_provider_id: "openai".into(),
                service_tier: None,
                approval_policy: AskForApproval::Never,
                approvals_reviewer: ApprovalsReviewer::User,
                permission_profile: codex_protocol::models::PermissionProfile::Disabled,
                active_permission_profile: None,
                cwd: codex_utils_absolute_path::AbsolutePathBuf::from_absolute_path_checked(
                    home.path(),
                )
                .unwrap(),
                runtime_workspace_roots: Some(vec![]),
                reasoning_effort: None,
                reasoning_summary: None,
                personality: None,
                collaboration_mode: CollaborationMode {
                    mode: ModeKind::Default,
                    settings: Settings {
                        model: "source-model".into(),
                        reasoning_effort: None,
                        developer_instructions: None,
                    },
                },
                disabled_plugin_ids: vec![],
            },
            profile_roots: vec![],
            environments: vec![],
            client_mcp_extensions: vec![],
            base_instructions: None,
            developer_instructions: None,
        };
        let encoded = serde_json::to_value(&snapshot).unwrap();
        let restored: RuntimeSnapshot = serde_json::from_value(encoded).unwrap();
        assert_eq!(
            restored.resume_params()["computerUseMode"],
            "selectedWindow"
        );
        snapshot.computer_use_mode = None;
        assert!(
            snapshot
                .resume_params()
                .get("computerUseMode")
                .unwrap()
                .is_null()
        );
    }
    #[test]
    fn scoped_source_resume_keeps_presentation_and_strips_all_runtime_overrides() {
        let mut params = serde_json::json!({"threadId":"source","excludeTurns":true,
            "initialTurnsPage":{"limit":12},"history":[{"type":"message"}],"path":"other-session.jsonl",
            "computerUseMode":"selectedWindow","model":"target-default","modelProvider":"other",
            "serviceTier":"priority","cwd":"other-project","runtimeWorkspaceRoots":["other-root"],
            "approvalPolicy":"never","approvalsReviewer":"user","sandbox":"danger-full-access",
            "permissions":":full-access","config":{"model_reasoning_effort":"low"},
            "baseInstructions":"replacement","developerInstructions":"replacement","personality":"friendly",
            "futureRuntimeOverride":true});
        retain_scoped_resume_presentation(&mut params);
        assert_eq!(
            params,
            serde_json::json!({"threadId":"source","excludeTurns":true,"initialTurnsPage":{"limit":12}})
        );
        let mut minimal = serde_json::json!({"threadId":"source","excludeTurns":false});
        retain_scoped_resume_presentation(&mut minimal);
        assert_eq!(
            minimal,
            serde_json::json!({"threadId":"source","excludeTurns":false})
        );
    }
    #[tokio::test]
    async fn nonapproval_callback_has_exact_thread_ownership_until_canceled() {
        use crate::outgoing_message::{ConnectionId, OutgoingMessageSender};
        use codex_app_server_protocol::{AttestationGenerateParams, ServerRequestPayload};
        let (tx, _rx) = tokio::sync::mpsc::channel(4);
        let outgoing =
            OutgoingMessageSender::new(tx, codex_analytics::AnalyticsEventsClient::disabled());
        let thread = ThreadId::new();
        let other = ThreadId::new();
        let (request, _waiter) = outgoing
            .send_request_to_connections(
                Some(&[ConnectionId(1)]),
                ServerRequestPayload::AttestationGenerate(AttestationGenerateParams {}),
                Some(thread),
            )
            .await;
        assert!(outgoing.has_pending_requests_for_thread(thread).await);
        assert!(!outgoing.has_pending_requests_for_thread(other).await);
        assert_eq!(outgoing.server_request_thread(&request).await, Some(thread));
        assert!(outgoing.cancel_request(&request).await);
        assert!(!outgoing.has_pending_requests_for_thread(thread).await);
        assert_eq!(outgoing.server_request_thread(&request).await, None);
    }
    #[test]
    fn attachment_binds_both_instances_source_hash_and_storage_abi() {
        let manifest = serde_json::json!({"abi":1});
        let mut attach = Attach {
            schema: 1,
            protocol: 1,
            thread_id: ThreadId::new().to_string(),
            workspace_id: "a".repeat(64),
            owner_id: "b".repeat(32),
            host_pid: 1,
            target_instance_id: "c".repeat(64),
            source_instance_id: "d".repeat(64),
            source_identity: "e".repeat(64),
            storage_compatibility: manifest.clone(),
        };
        assert!(
            attach
                .validate(&"d".repeat(64), &"e".repeat(64), &manifest)
                .is_ok()
        );
        assert!(
            attach
                .validate(&"f".repeat(64), &"e".repeat(64), &manifest)
                .is_err()
        );
        assert!(
            attach
                .validate(&"d".repeat(64), &"f".repeat(64), &manifest)
                .is_err()
        );
        assert!(
            attach
                .validate(
                    &"d".repeat(64),
                    &"e".repeat(64),
                    &serde_json::json!({"abi":2})
                )
                .is_err()
        );
        attach.target_instance_id = attach.source_instance_id.clone();
        assert!(
            attach
                .validate(&"d".repeat(64), &"e".repeat(64), &manifest)
                .is_err()
        );
    }
    #[test]
    fn scope_does_not_grant_account_or_other_session_authority() {
        let params = serde_json::json!({"threadId":"one"});
        assert!(scoped_request("turn/start", Some(&params), "one"));
        assert!(!scoped_request("turn/start", Some(&params), "two"));
        assert!(!scoped_request("account/login/start", Some(&params), "one"));
        assert!(!scoped_request("thread/fork", Some(&params), "one"));
        assert_eq!(
            message_thread(&serde_json::json!({"params":{"thread":{"id":"one"}}})),
            Some("one")
        );
        assert_eq!(
            message_thread(&serde_json::json!({"params":{"id":"one"}})),
            None
        );
    }
    #[test]
    fn selection_copy_does_not_copy_tokens_or_change_default() {
        let home = tempfile::tempdir().unwrap();
        let path = home.path().join("selected.json");
        std::fs::write(
            &path,
            br#"{"selectedProfileId":"source","requiresRecovery":false,"token":"secret"}"#,
        )
        .unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let snapshot = Selection::read(&path, None, home.path()).unwrap();
        assert_eq!(snapshot.selected_profile_id.as_deref(), Some("source"));
        assert!(!serde_json::to_string(&snapshot).unwrap().contains("secret"));
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
    }
    #[test]
    fn receipt_requires_exact_thread_workspace_target_and_completed_state() {
        let manifest = serde_json::json!({"abi":1});
        let mut receipt = Receipt {
            schema: 1,
            protocol: 1,
            state: "stopped".into(),
            thread_id: "thread".into(),
            workspace_id: "workspace".into(),
            source_instance_id: "a".repeat(64),
            source_identity: "b".repeat(64),
            target_instance_id: "c".repeat(64),
            storage_compatibility: manifest.clone(),
            selection: Selection {
                selected_profile_id: None,
                requires_recovery: false,
            },
            resume: serde_json::json!({}),
        };
        assert!(
            receipt
                .validate("thread", "workspace", &"c".repeat(64), &manifest)
                .is_ok()
        );
        assert!(
            receipt
                .validate("other", "workspace", &"c".repeat(64), &manifest)
                .is_err()
        );
        assert!(
            receipt
                .validate("thread", "other", &"c".repeat(64), &manifest)
                .is_err()
        );
        assert!(
            receipt
                .validate("thread", "workspace", &"d".repeat(64), &manifest)
                .is_err()
        );
        receipt.state = "preparing".into();
        assert!(
            receipt
                .validate("thread", "workspace", &"c".repeat(64), &manifest)
                .is_err()
        );
    }
}

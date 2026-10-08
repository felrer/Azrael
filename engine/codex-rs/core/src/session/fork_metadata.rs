//! Read-only provenance for forks of live, including ephemeral, sessions.

use super::session::Session;
use codex_protocol::models::BaseInstructions;
use codex_protocol::protocol::SessionMeta;
use codex_protocol::protocol::SessionMetaLine;

impl Session {
    pub(crate) async fn fork_metadata_snapshot(&self) -> (SessionMetaLine, Option<String>) {
        let state = self.state.lock().await;
        let config = &state.session_configuration;
        let meta = SessionMeta {
            id: self.thread_id,
            session_id: self.session_id(),
            computer_use_mode: self.computer_use_mode,
            forked_from_id: config.forked_from_thread_id,
            parent_thread_id: config.parent_thread_id,
            cwd: config.legacy_fallback_cwd.to_path_buf(),
            runtime_workspace_roots: Some(
                config
                    .runtime_workspace_roots
                    .iter()
                    .map(|path| path.to_path_buf())
                    .collect(),
            ),
            originator: config.originator.clone(),
            source: config.session_source.clone(),
            thread_source: config.thread_source.clone(),
            model_provider: Some(config.original_config_do_not_use.model_provider_id.clone()),
            base_instructions: Some(BaseInstructions {
                text: config.base_instructions.clone(),
                provenance: state.base_instructions_provenance.clone(),
            }),
            dynamic_tools: Some(config.dynamic_tools.clone()),
            history_mode: config.history_mode,
            multi_agent_version: self.multi_agent_version(),
            ..Default::default()
        };
        (
            SessionMetaLine { meta, git: None },
            config.thread_name.clone(),
        )
    }
}

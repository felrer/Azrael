//! Live, independent model-window snapshots for tool-free side questions.

use codex_extension_api::ConversationHistorySnapshot;
use codex_protocol::ThreadId;
use codex_protocol::protocol::ThreadHistoryMode;
use codex_rollout::CompactedItem;
use codex_rollout::RolloutItem;
use codex_thread_store::StoredThread;
use std::path::PathBuf;

/// Metadata used by fork orchestration, independent of whether a source is persisted.
pub(super) struct ForkSource {
    pub thread_id: ThreadId,
    pub name: Option<String>,
    pub cwd: PathBuf,
    pub rollout_path: Option<PathBuf>,
    pub history_mode: ThreadHistoryMode,
    pub preview: String,
    pub project_id: Option<String>,
    pub daybreak_enabled: Option<bool>,
}

impl From<StoredThread> for ForkSource {
    fn from(source: StoredThread) -> Self {
        Self {
            thread_id: source.thread_id,
            name: source.name,
            cwd: source.cwd,
            rollout_path: source.rollout_path,
            history_mode: source.history_mode,
            preview: source.preview,
            project_id: source.project_id,
            daybreak_enabled: source.daybreak_enabled,
        }
    }
}

/// Retain session/configuration provenance, but replace persisted response context with the
/// immutable live window. A checkpoint also restores retained context without replaying stale
/// user turns or incomplete persisted tool calls.
pub(super) fn live_fork_history(
    metadata_history: &[RolloutItem],
    snapshot: &dyn ConversationHistorySnapshot,
) -> Vec<RolloutItem> {
    let mut history: Vec<_> = metadata_history
        .iter()
        .filter(|item| matches!(item, RolloutItem::SessionMeta(_)))
        .cloned()
        .collect();
    history.push(RolloutItem::Compacted(CompactedItem {
        message: String::new(),
        replacement_history: Some(snapshot.model_context_items()),
        guardian_history: None,
        retained_context: snapshot.retained_context().cloned(),
        mcp_resource_origins: None,
        window_number: None,
        first_window_id: None,
        previous_window_id: None,
        window_id: None,
        compaction_response_id: None,
        latest_token_usage_record: None,
        resume_metadata: None,
    }));
    if let Some(context) = metadata_history
        .iter()
        .rev()
        .find(|item| matches!(item, RolloutItem::TurnContext(_)))
    {
        history.push(context.clone());
    }
    history
}

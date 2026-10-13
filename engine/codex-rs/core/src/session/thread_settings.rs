//! Handles persistent thread-settings updates and serializes their persistence
//! with checkpoints written directly to storage.

use super::session::Session;
use super::session::SessionSettingsUpdate;
use super::step_settings::StepSettingsUpdate;
use crate::WithTurnExtensionData;
use crate::config::ConstraintResult;
use codex_history::RolloutItem;
use codex_protocol::capabilities::SelectedCapabilityRoot;
use codex_protocol::protocol::Event;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::ThreadSettingsAppliedEvent;
use codex_protocol::protocol::ThreadSettingsOverrides;
use codex_protocol::protocol::ThreadSettingsSnapshot;
use codex_thread_store::ThreadStoreResult;
use tokio::sync::SemaphorePermit;

/// Only a resumed thread restores its own setting; copied history never propagates opt-out.
pub(super) fn initial_auto_compaction_enabled(history: &codex_history::InitialHistory) -> bool {
    match history {
        codex_history::InitialHistory::Resumed(resumed) => {
            codex_history::latest_auto_compaction_enabled(&resumed.history, resumed.conversation_id)
        }
        _ => true,
    }
}

impl Session {
    pub(crate) async fn auto_compaction_enabled(&self) -> bool {
        self.state
            .lock()
            .await
            .session_configuration
            .auto_compaction_enabled
    }
    /// Captures and flushes current settings under the shared persistence permit.
    pub(crate) async fn checkpoint_thread_settings(&self) -> ThreadStoreResult<()> {
        let _settings_guard = acquire_persistence_lock(self).await;
        if let Some(live_thread) = self.live_thread() {
            live_thread
                .append_items(&[RolloutItem::EventMsg(applied_event(self).await)])
                .await?;
            live_thread.flush().await?;
        }
        Ok(())
    }
}

/// Applies standalone thread settings. The caller holds the persistence permit through notification.
pub(super) async fn update(
    session: &Session,
    overrides: impl Into<WithTurnExtensionData<ThreadSettingsOverrides>>,
) -> codex_protocol::error::Result<ThreadSettingsSnapshot> {
    let updates = prepare_update(overrides, &session.services.selected_capability_roots);
    let durable_toggle = updates.auto_compaction_enabled.is_some();
    let previous = session.thread_settings_snapshot().await;
    let commit = session.update_settings(updates).await.map_err(|error| {
        codex_protocol::error::CodexErr::InvalidRequest(format!(
            "invalid thread settings override: {error}"
        ))
    })?;
    if durable_toggle && let Err(error) = persist_applied_snapshot(session, &commit.snapshot).await
    {
        // Preserve the previous admission policy when storage rejects the toggle.
        // A compensating owned snapshot also supersedes any buffered/partial append.
        {
            let mut state = session.state.lock().await;
            state.session_configuration.auto_compaction_enabled = previous.auto_compaction_enabled;
            if let Some(mut info) = state.token_info() {
                if let Some(policy) = info.context_policy.as_mut() {
                    policy.auto_compaction_enabled = previous.auto_compaction_enabled;
                }
                state.set_token_info(Some(info));
            }
        }
        let mut compensation = commit.snapshot;
        compensation.auto_compaction_enabled = previous.auto_compaction_enabled;
        if let Err(rollback_error) = persist_applied_snapshot(session, &compensation).await {
            tracing::warn!(%rollback_error, "failed to persist rejected compaction setting rollback");
        }
        return Err(std::io::Error::other(error).into());
    }
    // Standalone settings changes supersede a pending automatic continuation.
    session.state.lock().await.last_started_turn_id = None;
    Ok(commit.snapshot)
}

/// Persists without event delivery or reacquiring the caller's settings permit.
/// Explicit toggle replies and notifications must follow this durability barrier.
async fn persist_applied_snapshot(
    session: &Session,
    snapshot: &ThreadSettingsSnapshot,
) -> ThreadStoreResult<()> {
    if let Some(live_thread) = session.live_thread() {
        live_thread
            .append_items(&[RolloutItem::EventMsg(EventMsg::ThreadSettingsApplied(
                ThreadSettingsAppliedEvent {
                    thread_id: Some(session.thread_id()),
                    thread_settings: snapshot.clone(),
                },
            ))])
            .await?;
        live_thread
            .persist(codex_thread_store::PersistContext::Standard)
            .await?;
        live_thread.flush().await?;
    }
    Ok(())
}

/// Converts protocol overrides into the internal settings update shape.
pub(super) fn prepare_update(
    overrides: impl Into<WithTurnExtensionData<ThreadSettingsOverrides>>,
    roots: &[SelectedCapabilityRoot],
) -> SessionSettingsUpdate {
    let WithTurnExtensionData {
        request: overrides,
        turn_extension_init,
    } = overrides.into();
    let ThreadSettingsOverrides {
        auto_compaction_enabled,
        environments: environment_requests,
        runtime_workspace_roots,
        profile_workspace_roots,
        approval_policy,
        approvals_reviewer,
        sandbox_policy,
        permission_profile,
        active_permission_profile,
        windows_sandbox_level,
        model,
        effort,
        summary,
        service_tier,
        collaboration_mode,
        personality,
        disabled_plugin_ids,
    } = overrides;
    SessionSettingsUpdate {
        auto_compaction_enabled,
        turn_extension_init,
        step_settings: StepSettingsUpdate {
            model,
            effort,
            collaboration_mode,
            reasoning_summary: summary,
            service_tier,
            personality,
            approval_policy,
            approvals_reviewer,
        },
        environments: environment_requests.map(|requests| requests.select(roots)),
        runtime_workspace_roots,
        profile_workspace_roots,
        sandbox_policy,
        permission_profile,
        active_permission_profile,
        windows_sandbox_level,
        disabled_plugin_ids,
        ..Default::default()
    }
}

/// Acquires the shared permit before capturing or changing persistent settings.
pub(super) async fn acquire_persistence_lock(session: &Session) -> SemaphorePermit<'_> {
    session
        .thread_settings_persistence
        .acquire()
        .await
        .unwrap_or_else(|_| unreachable!("thread settings persistence semaphore is never closed"))
}

/// Applies persistent settings and emits the resulting thread-owned snapshot.
pub(super) async fn apply_update(
    session: &Session,
    submission_id: String,
    updates: SessionSettingsUpdate,
) -> ConstraintResult<()> {
    let _settings_guard = acquire_persistence_lock(session).await;
    let commit = session.update_settings(updates).await?;
    emit_applied(session, submission_id, commit.snapshot, false).await;
    Ok(())
}

/// Emits the snapshot published by one successful settings update.
pub(super) async fn emit_applied(
    session: &Session,
    submission_id: String,
    snapshot: ThreadSettingsSnapshot,
    already_persisted: bool,
) {
    let msg = EventMsg::ThreadSettingsApplied(ThreadSettingsAppliedEvent {
        thread_id: Some(session.thread_id()),
        thread_settings: snapshot,
    });
    let event = Event {
        id: submission_id,
        msg,
    };
    if already_persisted {
        session.send_event_raw_with_persistence(event, false).await;
    } else {
        session
            .send_event_raw_without_materializing_rollout(event)
            .await;
    }
}

/// Builds a current thread-owned snapshot for storage checkpoints.
pub(super) async fn applied_event(session: &Session) -> EventMsg {
    EventMsg::ThreadSettingsApplied(ThreadSettingsAppliedEvent {
        thread_id: Some(session.thread_id()),
        thread_settings: session.thread_settings_snapshot().await,
    })
}

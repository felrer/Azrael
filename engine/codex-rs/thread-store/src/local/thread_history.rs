use codex_app_server_protocol::ThreadHistoryChangeSet;
use codex_app_server_protocol::ThreadItem;
use codex_app_server_protocol::TurnStatus;
use codex_protocol::ThreadId;
use codex_protocol::models::MessagePhase;
use codex_protocol::realtime::RealtimeItem;

use super::LocalThreadStore;
use crate::ThreadStoreError;
use crate::ThreadStoreResult;

pub(super) const CURRENT_PROJECTION_VERSION: i64 = 3;

mod read;
mod realtime;
mod search;
mod segment_paging;
mod turn_lookup;

pub(super) use read::list_items;
pub(super) use read::list_turns;
pub(super) use realtime::list_timeline;
pub(super) use search::search_thread_occurrences;
pub(super) use turn_lookup::find_source_turn;
pub(super) use turn_lookup::find_visible_turn;

/// A valid complete rollout line with its absolute byte span in durable JSONL.
///
/// `start_byte_offset..end_byte_offset` includes the terminating newline.
pub(super) struct ProjectedRolloutLine {
    pub ordinal: u64,
    pub start_byte_offset: u64,
    pub end_byte_offset: u64,
    pub fallback_created_at_ms: Option<i64>,
    pub changes: ThreadHistoryChangeSet,
    pub realtime_item: Option<RealtimeItem>,
}

/// One ordered update to apply while advancing a rollout projection checkpoint.
///
/// Skipped ordinal ranges keep the byte and ordinal checkpoints describing the same durable
/// prefix even when a complete rollout line cannot be projected.
pub(super) enum RolloutProjectionStep {
    Line(Box<ProjectedRolloutLine>),
    SkippedOrdinalRange {
        start_ordinal: u64,
        end_ordinal_exclusive: u64,
    },
}

pub(super) struct RolloutProjectionState {
    pub next_byte_offset: u64,
    pub next_ordinal: u64,
    pub projection_version: i64,
}

pub(super) async fn projection_state(
    store: &LocalThreadStore,
    thread_id: ThreadId,
) -> ThreadStoreResult<Option<RolloutProjectionState>> {
    if store.state_db.is_none() {
        return Ok(None);
    }
    let db_path = store.config.sqlite.thread_history_db_path();
    if !tokio::fs::try_exists(db_path.as_path())
        .await
        .map_err(thread_history_error)?
    {
        return Ok(None);
    }

    let pool = store.thread_history_db().await?;
    let state = sqlx::query_as::<_, (i64, i64, i64)>(
        r#"
SELECT next_rollout_byte_offset, next_rollout_ordinal, projection_version
FROM thread_history_projection_state
WHERE thread_id = ?
        "#,
    )
    .bind(thread_id.to_string())
    .fetch_optional(pool)
    .await
    .map_err(thread_history_error)?;
    state
        .map(|(next_byte_offset, next_ordinal, projection_version)| {
            Ok(RolloutProjectionState {
                next_byte_offset: u64::try_from(next_byte_offset).map_err(|_| {
                    ThreadStoreError::Internal {
                        message: format!(
                            "thread history projection for {thread_id} has a negative byte offset"
                        ),
                    }
                })?,
                next_ordinal: u64::try_from(next_ordinal).map_err(|_| {
                    ThreadStoreError::Internal {
                        message: format!(
                            "thread history projection for {thread_id} has a negative ordinal"
                        ),
                    }
                })?,
                projection_version,
            })
        })
        .transpose()
}

pub(super) async fn apply_projection(
    store: &LocalThreadStore,
    thread_id: ThreadId,
    start_offset: u64,
    next_offset: u64,
    initial_ordinal: u64,
    rebuild_projection_version: Option<i64>,
    projections: Vec<RolloutProjectionStep>,
) -> ThreadStoreResult<()> {
    let pool = store.thread_history_db().await?;
    // Write the projected rows and advance the JSONL offset and ordinal in one transaction. If
    // SQLite fails, it stays behind the durable rollout instead of claiming data it did not
    // materialize.
    let mut transaction = pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(thread_history_error)?;
    let thread_id = thread_id.to_string();
    let projection_state = sqlx::query_as::<_, (i64, i64, i64)>(
        r#"
SELECT next_rollout_byte_offset, next_rollout_ordinal, projection_version
FROM thread_history_projection_state
WHERE thread_id = ?
        "#,
    )
    .bind(thread_id.as_str())
    .fetch_optional(&mut *transaction)
    .await
    .map_err(thread_history_error)?;
    let (expected_offset, mut next_ordinal) = match projection_state {
        Some((next_byte_offset, _, CURRENT_PROJECTION_VERSION))
            if rebuild_projection_version.is_some() =>
        {
            let parsed_next_offset = sqlite_integer(next_offset, "rollout byte offset")?;
            if next_byte_offset >= parsed_next_offset {
                transaction.commit().await.map_err(thread_history_error)?;
                return Ok(());
            }
            return Err(ThreadStoreError::Internal {
                message: format!(
                    "thread history projection for {thread_id} changed while rebuilding"
                ),
            });
        }
        Some((next_byte_offset, next_ordinal, CURRENT_PROJECTION_VERSION)) => {
            (next_byte_offset, next_ordinal)
        }
        Some((_, _, version)) if rebuild_projection_version == Some(version) => {
            delete_thread_rows(&mut transaction, thread_id.as_str())
                .await
                .map_err(thread_history_error)?;
            (0, sqlite_integer(initial_ordinal, "rollout ordinal")?)
        }
        Some((_, _, version)) => {
            return Err(ThreadStoreError::Internal {
                message: format!(
                    "thread history projection for {thread_id} has stale version {version}"
                ),
            });
        }
        None => (0, sqlite_integer(initial_ordinal, "rollout ordinal")?),
    };
    let start_offset = sqlite_integer(start_offset, "rollout byte offset")?;
    if expected_offset != start_offset {
        return Err(ThreadStoreError::Internal {
            message: format!("thread history projection for {thread_id} is behind durable rollout"),
        });
    }

    for projection in projections {
        match projection {
            RolloutProjectionStep::Line(projection) => {
                let ordinal = sqlite_integer(projection.ordinal, "rollout ordinal")?;
                if ordinal != next_ordinal {
                    return Err(ThreadStoreError::Internal {
                        message: format!(
                            "thread history projection for {thread_id} expected ordinal {next_ordinal}, got {ordinal}"
                        ),
                    });
                }
                apply_change_set(
                    &mut transaction,
                    thread_id.as_str(),
                    ordinal,
                    sqlite_integer(projection.start_byte_offset, "rollout byte offset")?,
                    sqlite_integer(projection.end_byte_offset, "rollout byte offset")?,
                    projection.fallback_created_at_ms,
                    projection.changes,
                )
                .await?;
                if let Some(item) = projection.realtime_item {
                    let item_json = serde_json::to_string(&item).map_err(thread_history_error)?;
                    sqlx::query(
                        r#"
INSERT INTO thread_realtime_items (
    thread_id,
    item_id,
    rollout_ordinal,
    created_at_ms,
    item_type,
    item_json
) VALUES (?, ?, ?, ?, json_extract(?, '$.type'), ?)
ON CONFLICT(thread_id, item_id) DO NOTHING
                        "#,
                    )
                    .bind(thread_id.as_str())
                    .bind(item.id.as_str())
                    .bind(ordinal)
                    .bind(projection.fallback_created_at_ms.ok_or_else(|| {
                        ThreadStoreError::Internal {
                            message: "realtime rollout item is missing its timestamp".to_string(),
                        }
                    })?)
                    .bind(item_json.as_str())
                    .bind(item_json.as_str())
                    .execute(&mut *transaction)
                    .await
                    .map_err(thread_history_error)?;
                }
                next_ordinal =
                    next_ordinal
                        .checked_add(1)
                        .ok_or_else(|| ThreadStoreError::Internal {
                            message: "rollout ordinal exceeds SQLite integer range".to_string(),
                        })?;
            }
            RolloutProjectionStep::SkippedOrdinalRange {
                start_ordinal,
                end_ordinal_exclusive,
            } => {
                let start_ordinal = sqlite_integer(start_ordinal, "rollout ordinal")?;
                if start_ordinal != next_ordinal {
                    return Err(ThreadStoreError::Internal {
                        message: format!(
                            "thread history projection for {thread_id} expected ordinal {next_ordinal}, got {start_ordinal}"
                        ),
                    });
                }
                let end_ordinal_exclusive =
                    sqlite_integer(end_ordinal_exclusive, "rollout ordinal")?;
                if end_ordinal_exclusive <= start_ordinal {
                    return Err(ThreadStoreError::Internal {
                        message: format!(
                            "thread history projection for {thread_id} has an empty skipped ordinal range"
                        ),
                    });
                }
                next_ordinal = end_ordinal_exclusive;
            }
        }
    }

    sqlx::query(
        r#"
INSERT INTO thread_history_projection_state (
    thread_id,
    next_rollout_byte_offset,
    next_rollout_ordinal,
    projection_version
) VALUES (?, ?, ?, ?)
ON CONFLICT(thread_id) DO UPDATE SET
    next_rollout_byte_offset = excluded.next_rollout_byte_offset,
    next_rollout_ordinal = excluded.next_rollout_ordinal,
    projection_version = excluded.projection_version
        "#,
    )
    .bind(thread_id.as_str())
    .bind(sqlite_integer(next_offset, "rollout byte offset")?)
    .bind(next_ordinal)
    .bind(CURRENT_PROJECTION_VERSION)
    .execute(&mut *transaction)
    .await
    .map_err(thread_history_error)?;
    transaction.commit().await.map_err(thread_history_error)
}

pub(super) async fn delete_thread(
    store: &LocalThreadStore,
    thread_id: ThreadId,
) -> ThreadStoreResult<()> {
    let db_path = store.config.sqlite.thread_history_db_path();
    if !tokio::fs::try_exists(db_path.as_path())
        .await
        .map_err(thread_history_delete_error)?
    {
        return Ok(());
    }

    let pool = store.thread_history_db().await?;
    let mut transaction = pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(thread_history_delete_error)?;
    let thread_id = thread_id.to_string();
    delete_thread_rows(&mut transaction, thread_id.as_str())
        .await
        .map_err(thread_history_delete_error)?;
    transaction
        .commit()
        .await
        .map_err(thread_history_delete_error)
}

async fn delete_thread_rows(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    thread_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM thread_items WHERE thread_id = ?")
        .bind(thread_id)
        .execute(&mut **transaction)
        .await?;
    sqlx::query("DELETE FROM thread_realtime_items WHERE thread_id = ?")
        .bind(thread_id)
        .execute(&mut **transaction)
        .await?;
    sqlx::query("DELETE FROM thread_turns WHERE thread_id = ?")
        .bind(thread_id)
        .execute(&mut **transaction)
        .await?;
    sqlx::query("DELETE FROM thread_history_projection_state WHERE thread_id = ?")
        .bind(thread_id)
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

async fn apply_change_set(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    thread_id: &str,
    rollout_ordinal: i64,
    rollout_byte_offset: i64,
    rollout_end_byte_offset: i64,
    fallback_created_at_ms: Option<i64>,
    changes: ThreadHistoryChangeSet,
) -> ThreadStoreResult<()> {
    for update in changes.root_resume_wait_updates {
        // Wait revisions do not change turn status, work duration, or terminal rollout bounds.
        sqlx::query("UPDATE thread_turns SET root_resume_wait_json = ? WHERE thread_id = ? AND turn_id = ? AND (root_resume_wait_json IS NULL OR json_extract(root_resume_wait_json, '$.revision') < ?)")
            .bind(serde_json::to_string(&update.wait).map_err(thread_history_error)?)
            .bind(thread_id).bind(&update.turn_id).bind(update.wait.revision)
            .execute(&mut **transaction).await.map_err(thread_history_error)?;
    }
    for turn in changes.changed_turns {
        let turn_id = turn.turn_id;
        let error_json = turn
            .error
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(thread_history_error)?;
        let (terminal_ordinal, terminal_byte_offset) = match &turn.status {
            TurnStatus::Completed
            | TurnStatus::Deferred
            | TurnStatus::Interrupted
            | TurnStatus::Failed => (Some(rollout_ordinal), Some(rollout_end_byte_offset)),
            TurnStatus::InProgress => (None, None),
        };
        // The same turn can appear again as it moves from started to completed. Update its latest
        // status, error, and timestamps, but keep the rollout ordinal from the first record that
        // created it.
        sqlx::query(
            r#"
INSERT INTO thread_turns (
    thread_id,
    turn_id,
    root_turn_id,
    rollout_ordinal,
    rollout_byte_offset,
    rollout_end_ordinal,
    rollout_end_byte_offset,
    status,
    error_json,
    started_at,
    completed_at,
    duration_ms,
    root_resume_wait_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(thread_id, turn_id) DO UPDATE SET
    root_turn_id = COALESCE(thread_turns.root_turn_id, excluded.root_turn_id),
    rollout_end_ordinal = excluded.rollout_end_ordinal,
    rollout_end_byte_offset = excluded.rollout_end_byte_offset,
    root_resume_wait_json = COALESCE(excluded.root_resume_wait_json, thread_turns.root_resume_wait_json),
    status = excluded.status,
    error_json = excluded.error_json,
    started_at = COALESCE(excluded.started_at, thread_turns.started_at),
    completed_at = excluded.completed_at,
    duration_ms = COALESCE(
        excluded.duration_ms,
        CASE
            WHEN excluded.status = 'deferred'
              AND ? IS NOT NULL
              AND thread_turns.started_at IS NOT NULL
            THEN MAX(0, ? - thread_turns.started_at * 1000)
        END
    )
WHERE (thread_turns.rollout_end_ordinal IS NULL AND thread_turns.status = 'inProgress')
   OR (thread_turns.status = 'deferred' AND excluded.status = 'interrupted')
            "#,
        )
        .bind(thread_id)
        .bind(turn_id.as_str())
        .bind(turn.root_turn_id)
        .bind(rollout_ordinal)
        .bind(rollout_byte_offset)
        .bind(terminal_ordinal)
        .bind(terminal_byte_offset)
        .bind(turn_status(&turn.status))
        .bind(error_json)
        .bind(turn.started_at)
        .bind(turn.completed_at)
        .bind(turn.duration_ms)
        .bind(turn.root_resume_wait.as_ref().map(serde_json::to_string).transpose().map_err(thread_history_error)?)
        .bind(fallback_created_at_ms)
        .bind(fallback_created_at_ms)
        .execute(&mut **transaction)
        .await
        .map_err(thread_history_error)?;

        // Review turns can persist completed items before their turn lifecycle record. Fill the
        // summary IDs from those older item rows when the turn row finally arrives.
        sqlx::query(
            r#"
UPDATE thread_turns
SET
    first_user_item_id = COALESCE(
        first_user_item_id,
        (
            SELECT item_id
            FROM thread_items
            WHERE thread_id = ?
              AND turn_id = ?
              AND (
                item_type = 'userMessage'
                OR (item_type = '' AND json_extract(item_json, '$.type') = 'userMessage')
              )
            ORDER BY rollout_ordinal
            LIMIT 1
        )
    ),
    final_agent_item_id = COALESCE(
        (
            SELECT item_id
            FROM thread_items
            WHERE thread_id = ?
              AND turn_id = ?
              AND (
                item_type = 'agentMessage'
                OR (item_type = '' AND json_extract(item_json, '$.type') = 'agentMessage')
              )
              AND json_extract(item_json, '$.phase') = 'final_answer'
            ORDER BY rollout_ordinal DESC
            LIMIT 1
        ),
        CASE
            WHEN status IN ('completed', 'interrupted', 'failed') THEN (
                SELECT item_id
                FROM thread_items
                WHERE thread_id = ?
                  AND turn_id = ?
                  AND (
                    item_type = 'agentMessage'
                    OR (item_type = '' AND json_extract(item_json, '$.type') = 'agentMessage')
                  )
                  AND json_extract(item_json, '$.phase') IS NULL
                ORDER BY rollout_ordinal DESC
                LIMIT 1
            )
        END,
        final_agent_item_id
    )
WHERE thread_id = ?
  AND turn_id = ?
  AND (
    rollout_end_ordinal = ?
    OR status = 'inProgress'
  )
            "#,
        )
        .bind(thread_id)
        .bind(turn_id.as_str())
        .bind(thread_id)
        .bind(turn_id.as_str())
        .bind(thread_id)
        .bind(turn_id.as_str())
        .bind(thread_id)
        .bind(turn_id.as_str())
        .bind(rollout_ordinal)
        .execute(&mut **transaction)
        .await
        .map_err(thread_history_error)?;
    }

    for item in changes.changed_items {
        let created_at_ms =
            item.started_at_ms
                .or(fallback_created_at_ms)
                .ok_or_else(|| ThreadStoreError::Internal {
                    message: format!(
                        "thread history projection for {thread_id} is missing an item creation timestamp"
                    ),
                })?;
        let item_id = item.item.id().to_string();
        let item_json = serde_json::to_string(&item.item).map_err(thread_history_error)?;
        // Completed items are immutable: local producers emit ItemCompleted exactly once per
        // item. Tolerate an unexpected duplicate defensively so it cannot poison materialization,
        // preserving the original creation ordinal and timestamp while updating its snapshot.
        sqlx::query(
            r#"
INSERT INTO thread_items (
    thread_id,
    turn_id,
    item_id,
    rollout_ordinal,
    updated_at_ordinal,
    created_at_ms,
    started_at_ms,
    completed_at_ms,
    item_type,
    item_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, json_extract(?, '$.type'), ?)
ON CONFLICT(thread_id, turn_id, item_id) DO UPDATE SET
    updated_at_ordinal = excluded.updated_at_ordinal,
    started_at_ms = COALESCE(thread_items.started_at_ms, excluded.started_at_ms),
    completed_at_ms = COALESCE(thread_items.completed_at_ms, excluded.completed_at_ms),
    item_type = excluded.item_type,
    item_json = excluded.item_json
            "#,
        )
        .bind(thread_id)
        .bind(item.turn_id.as_str())
        .bind(item_id.as_str())
        .bind(rollout_ordinal)
        .bind(rollout_ordinal)
        .bind(created_at_ms)
        .bind(item.started_at_ms)
        .bind(item.completed_at_ms)
        .bind(item_json.as_str())
        .bind(item_json)
        .execute(&mut **transaction)
        .await
        .map_err(thread_history_error)?;

        // Keep summary item IDs on the turn row so reads do not need to scan every item in the
        // turn.
        match item.item {
            ThreadItem::UserMessage { .. } => {
                sqlx::query(
                    r#"
UPDATE thread_turns
SET first_user_item_id = COALESCE(first_user_item_id, ?)
WHERE thread_id = ?
  AND turn_id = ?
  AND rollout_end_ordinal IS NULL
  AND status = 'inProgress'
                    "#,
                )
                .bind(item_id.as_str())
                .bind(thread_id)
                .bind(item.turn_id.as_str())
                .execute(&mut **transaction)
                .await
                .map_err(thread_history_error)?;
            }
            ThreadItem::AgentMessage {
                phase: Some(MessagePhase::FinalAnswer),
                ..
            } => {
                sqlx::query(
                    r#"
UPDATE thread_turns
SET final_agent_item_id = ?
WHERE thread_id = ?
  AND turn_id = ?
  AND rollout_end_ordinal IS NULL
  AND status = 'inProgress'
                    "#,
                )
                .bind(item_id.as_str())
                .bind(thread_id)
                .bind(item.turn_id.as_str())
                .execute(&mut **transaction)
                .await
                .map_err(thread_history_error)?;
            }
            ThreadItem::AgentMessage {
                phase: Some(MessagePhase::Commentary | MessagePhase::PartialAnswer) | None,
                ..
            }
            | ThreadItem::HookPrompt { .. }
            | ThreadItem::FunctionCallOutput { .. }
            | ThreadItem::Plan { .. }
            | ThreadItem::Reasoning { .. }
            | ThreadItem::CommandExecution { .. }
            | ThreadItem::FileChange { .. }
            | ThreadItem::McpToolCall { .. }
            | ThreadItem::DynamicToolCall { .. }
            | ThreadItem::CollabAgentToolCall { .. }
            | ThreadItem::SubAgentActivity { .. }
            | ThreadItem::WebSearch(_)
            | ThreadItem::ImageView { .. }
            | ThreadItem::Sleep(_)
            | ThreadItem::ImageGeneration(_)
            | ThreadItem::EnteredReviewMode { .. }
            | ThreadItem::ExitedReviewMode { .. }
            | ThreadItem::ContextCompaction { .. } => {}
        }
    }
    Ok(())
}

fn turn_status(status: &TurnStatus) -> &'static str {
    match status {
        TurnStatus::Completed => "completed",
        TurnStatus::Deferred => "deferred",
        TurnStatus::Interrupted => "interrupted",
        TurnStatus::Failed => "failed",
        TurnStatus::InProgress => "inProgress",
    }
}

fn sqlite_integer(value: u64, field: &str) -> ThreadStoreResult<i64> {
    i64::try_from(value).map_err(|_| ThreadStoreError::Internal {
        message: format!("{field} exceeds SQLite integer range"),
    })
}

fn thread_history_error(err: impl std::fmt::Display) -> ThreadStoreError {
    ThreadStoreError::Internal {
        message: format!("failed to access thread history: {err}"),
    }
}

impl From<sqlx::Error> for ThreadStoreError {
    fn from(err: sqlx::Error) -> Self {
        thread_history_error(err)
    }
}

fn thread_history_delete_error(err: impl std::fmt::Display) -> ThreadStoreError {
    ThreadStoreError::Internal {
        message: format!("failed to delete thread history: {err}"),
    }
}

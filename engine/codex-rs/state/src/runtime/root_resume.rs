use super::StateRuntime;
use codex_protocol::root_resume::RootResumeAgentTask;
use codex_protocol::root_resume::RootResumeReservation;
use codex_protocol::root_resume::RootResumeState;
use codex_protocol::root_resume::RootResumeWakeReason;
use sqlx::QueryBuilder;
use sqlx::Row;
use sqlx::Sqlite;
use sqlx::sqlite::SqliteRow;

const ROOT_RESUME_COLUMNS: &str = r#"
    id,
    root_thread_id,
    originating_turn_id,
    root_turn_id,
    call_id,
    resume_turn_id,
    resume_at_ms,
    created_at_ms,
    updated_at_ms,
    wait_started_at_ms,
    wait_ended_at_ms,
    revision,
    state,
    agent_tasks_json,
    completion_tasks_json,
    reason,
    final_output_json_schema,
    wake_reason,
    last_error
"#;

impl StateRuntime {
    pub async fn create_root_resume(&self, record: &RootResumeReservation) -> anyhow::Result<()> {
        let agent_tasks_json = serde_json::to_string(&record.agent_tasks)?;
        let completion_tasks_json = serde_json::to_string(&record.completion_tasks)?;
        let final_output_json_schema = record
            .final_output_json_schema
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        sqlx::query(
            r#"
INSERT INTO root_resume_reservations (
    id,
    root_thread_id,
    originating_turn_id,
    root_turn_id,
    call_id,
    resume_turn_id,
    resume_at_ms,
    created_at_ms,
    updated_at_ms,
    wait_started_at_ms,
    wait_ended_at_ms,
    revision,
    state,
    agent_tasks_json,
    completion_tasks_json,
    reason,
    final_output_json_schema,
    wake_reason,
    last_error
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&record.id)
        .bind(&record.root_thread_id)
        .bind(&record.originating_turn_id)
        .bind(&record.root_turn_id)
        .bind(&record.call_id)
        .bind(&record.resume_turn_id)
        .bind(record.resume_at_ms)
        .bind(record.created_at_ms)
        .bind(record.updated_at_ms)
        .bind(record.wait_started_at_ms)
        .bind(record.wait_ended_at_ms)
        .bind(record.revision)
        .bind(root_resume_state_as_str(&record.state))
        .bind(agent_tasks_json)
        .bind(completion_tasks_json)
        .bind(&record.reason)
        .bind(final_output_json_schema)
        .bind(
            record
                .wake_reason
                .as_ref()
                .map(root_resume_wake_reason_as_str),
        )
        .bind(&record.last_error)
        .execute(self.pool.as_ref())
        .await?;
        Ok(())
    }

    pub async fn get_root_resume(&self, id: &str) -> anyhow::Result<Option<RootResumeReservation>> {
        let mut query = QueryBuilder::<Sqlite>::new("SELECT ");
        query
            .push(ROOT_RESUME_COLUMNS)
            .push(" FROM root_resume_reservations WHERE id = ")
            .push_bind(id);
        let row = query.build().fetch_optional(self.pool.as_ref()).await?;
        row.map(|row| root_resume_from_row(&row)).transpose()
    }

    pub async fn list_root_resumes(&self) -> anyhow::Result<Vec<RootResumeReservation>> {
        let mut query = QueryBuilder::<Sqlite>::new("SELECT ");
        query.push(ROOT_RESUME_COLUMNS).push(
            r#"
FROM root_resume_reservations
WHERE state IN ('preparing', 'waiting', 'claimed', 'blocked')
ORDER BY resume_at_ms ASC, created_at_ms ASC, id ASC
LIMIT 1000
            "#,
        );
        let rows = query.build().fetch_all(self.pool.as_ref()).await?;
        rows.iter().map(root_resume_from_row).collect()
    }

    pub async fn get_active_root_resume(
        &self,
        root_thread_id: &str,
    ) -> anyhow::Result<Option<RootResumeReservation>> {
        let mut query = QueryBuilder::<Sqlite>::new("SELECT ");
        query
            .push(ROOT_RESUME_COLUMNS)
            .push(" FROM root_resume_reservations WHERE root_thread_id = ")
            .push_bind(root_thread_id)
            .push(
                r#"
  AND state IN ('preparing', 'waiting', 'claimed', 'blocked')
LIMIT 1
            "#,
            );
        let row = query.build().fetch_optional(self.pool.as_ref()).await?;
        row.map(|row| root_resume_from_row(&row)).transpose()
    }

    pub async fn transition_root_resume(
        &self,
        id: &str,
        expected_revision: i64,
        state: RootResumeState,
        wake_reason: Option<RootResumeWakeReason>,
        last_error: Option<String>,
        now_ms: i64,
    ) -> anyhow::Result<Option<RootResumeReservation>> {
        let allowed_from = allowed_root_resume_sources(&state);
        if allowed_from.is_empty() {
            return Ok(None);
        }

        let mut query =
            sqlx::QueryBuilder::<sqlx::Sqlite>::new("UPDATE root_resume_reservations SET state = ");
        query
            .push_bind(root_resume_state_as_str(&state))
            .push(", wake_reason = ")
            .push_bind(wake_reason.as_ref().map(root_resume_wake_reason_as_str))
            .push(", last_error = ")
            .push_bind(last_error)
            .push(", updated_at_ms = ")
            .push_bind(now_ms)
            .push(", wait_started_at_ms = CASE WHEN ")
            .push_bind(root_resume_state_as_str(&state))
            .push(" = 'waiting' THEN COALESCE(wait_started_at_ms, ")
            .push_bind(now_ms)
            .push(") ELSE wait_started_at_ms END, wait_ended_at_ms = CASE WHEN state = 'waiting' AND ")
            .push_bind(root_resume_state_as_str(&state))
            .push(" IN ('claimed', 'cancelled', 'blocked') THEN COALESCE(wait_ended_at_ms, ")
            .push_bind(now_ms)
            .push(") ELSE wait_ended_at_ms END")
            .push(", revision = revision + 1 WHERE id = ")
            .push_bind(id)
            .push(" AND revision = ")
            .push_bind(expected_revision)
            .push(" AND state IN (");
        let mut separated = query.separated(", ");
        for source in allowed_from {
            separated.push_bind(root_resume_state_as_str(source));
        }
        separated
            .push_unseparated(") RETURNING ")
            .push_unseparated(ROOT_RESUME_COLUMNS);

        let row = query.build().fetch_optional(self.pool.as_ref()).await?;
        row.map(|row| root_resume_from_row(&row)).transpose()
    }
}

fn allowed_root_resume_sources(state: &RootResumeState) -> &'static [RootResumeState] {
    use RootResumeState::*;
    match state {
        Preparing => &[],
        Waiting => &[Preparing],
        Claimed => &[Waiting, Blocked],
        Resumed => &[Claimed],
        Cancelled => &[Preparing, Waiting, Claimed, Blocked],
        Blocked => &[Preparing, Waiting, Claimed],
    }
}

fn root_resume_state_as_str(state: &RootResumeState) -> &'static str {
    match state {
        RootResumeState::Preparing => "preparing",
        RootResumeState::Waiting => "waiting",
        RootResumeState::Claimed => "claimed",
        RootResumeState::Resumed => "resumed",
        RootResumeState::Cancelled => "cancelled",
        RootResumeState::Blocked => "blocked",
    }
}

fn root_resume_state_from_str(value: &str) -> anyhow::Result<RootResumeState> {
    match value {
        "preparing" => Ok(RootResumeState::Preparing),
        "waiting" => Ok(RootResumeState::Waiting),
        "claimed" => Ok(RootResumeState::Claimed),
        "resumed" => Ok(RootResumeState::Resumed),
        "cancelled" => Ok(RootResumeState::Cancelled),
        "blocked" => Ok(RootResumeState::Blocked),
        _ => anyhow::bail!("unknown root resume state: {value}"),
    }
}

fn root_resume_wake_reason_as_str(reason: &RootResumeWakeReason) -> &'static str {
    match reason {
        RootResumeWakeReason::Deadline => "deadline",
        RootResumeWakeReason::AgentsCompleted => "agents_completed",
        RootResumeWakeReason::WorkCompleted => "work_completed",
        RootResumeWakeReason::UserInput => "user_input",
        RootResumeWakeReason::Manual => "manual",
    }
}

fn root_resume_wake_reason_from_str(value: &str) -> anyhow::Result<RootResumeWakeReason> {
    match value {
        "deadline" => Ok(RootResumeWakeReason::Deadline),
        "agents_completed" => Ok(RootResumeWakeReason::AgentsCompleted),
        "work_completed" => Ok(RootResumeWakeReason::WorkCompleted),
        "user_input" => Ok(RootResumeWakeReason::UserInput),
        "manual" => Ok(RootResumeWakeReason::Manual),
        _ => anyhow::bail!("unknown root resume wake reason: {value}"),
    }
}

fn root_resume_from_row(row: &SqliteRow) -> anyhow::Result<RootResumeReservation> {
    let state: String = row.try_get("state")?;
    let wake_reason: Option<String> = row.try_get("wake_reason")?;
    let agent_tasks_json: String = row.try_get("agent_tasks_json")?;
    let completion_tasks_json: String = row.try_get("completion_tasks_json")?;
    let final_output_json_schema: Option<String> = row.try_get("final_output_json_schema")?;
    Ok(RootResumeReservation {
        id: row.try_get("id")?,
        root_thread_id: row.try_get("root_thread_id")?,
        originating_turn_id: row.try_get("originating_turn_id")?,
        root_turn_id: row.try_get("root_turn_id")?,
        call_id: row.try_get("call_id")?,
        resume_turn_id: row.try_get("resume_turn_id")?,
        resume_at_ms: row.try_get("resume_at_ms")?,
        created_at_ms: row.try_get("created_at_ms")?,
        updated_at_ms: row.try_get("updated_at_ms")?,
        wait_started_at_ms: row.try_get("wait_started_at_ms")?,
        wait_ended_at_ms: row.try_get("wait_ended_at_ms")?,
        revision: row.try_get("revision")?,
        state: root_resume_state_from_str(&state)?,
        agent_tasks: serde_json::from_str::<Vec<RootResumeAgentTask>>(&agent_tasks_json)?,
        completion_tasks: serde_json::from_str(&completion_tasks_json)?,
        reason: row.try_get("reason")?,
        final_output_json_schema: final_output_json_schema
            .as_deref()
            .map(serde_json::from_str)
            .transpose()?,
        wake_reason: wake_reason
            .as_deref()
            .map(root_resume_wake_reason_from_str)
            .transpose()?,
        last_error: row.try_get("last_error")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SqliteConfig;
    use crate::runtime::test_support::unique_temp_dir;
    use codex_utils_absolute_path::test_support::PathExt;
    use pretty_assertions::assert_eq;
    use std::path::Path;
    use std::sync::Arc;

    fn reservation(
        id: &str,
        root_thread_id: &str,
        state: RootResumeState,
    ) -> RootResumeReservation {
        RootResumeReservation {
            wait_started_at_ms: None,
            wait_ended_at_ms: None,

            id: id.to_string(),
            root_thread_id: root_thread_id.to_string(),
            originating_turn_id: format!("origin-{id}"),
            root_turn_id: format!("root-turn-{id}"),
            call_id: format!("call-{id}"),
            resume_turn_id: format!("resume-{id}"),
            resume_at_ms: 2_000,
            created_at_ms: 1_000,
            updated_at_ms: 1_000,
            revision: 0,
            state,
            agent_tasks: vec![RootResumeAgentTask {
                thread_id: "child-thread".to_string(),
                agent_path: "/root/child".to_string(),
                turn_id: "child-turn".to_string(),
            }],
            completion_tasks: vec!["d640335a-f9b8-4f44-8b78-76932200bad0".to_string()],
            reason: "wait for child".to_string(),
            final_output_json_schema: Some(serde_json::json!({
                "type": "object",
                "required": ["answer"]
            })),
            wake_reason: None,
            last_error: None,
        }
    }

    async fn test_runtime(path: &Path) -> Arc<StateRuntime> {
        StateRuntime::init(
            SqliteConfig::new_for_testing(path.abs()),
            "test-provider".to_string(),
        )
        .await
        .expect("state runtime should initialize")
    }

    #[tokio::test]
    async fn completion_tasks_and_work_completed_survive_state_round_trip() {
        let codex_home = unique_temp_dir();
        let runtime = test_runtime(&codex_home).await;
        let mut expected = reservation("completion", "root-thread", RootResumeState::Waiting);
        expected.agent_tasks.clear();
        runtime
            .create_root_resume(&expected)
            .await
            .expect("completion reservation should be stored");
        assert_eq!(
            runtime
                .get_root_resume(&expected.id)
                .await
                .expect("read reservation"),
            Some(expected.clone())
        );
        let claimed = runtime
            .transition_root_resume(
                &expected.id,
                0,
                RootResumeState::Claimed,
                Some(RootResumeWakeReason::WorkCompleted),
                None,
                3000,
            )
            .await
            .expect("work completion should claim reservation")
            .expect("claim should succeed");
        assert_eq!(claimed.completion_tasks, expected.completion_tasks);
        assert_eq!(
            claimed.wake_reason,
            Some(RootResumeWakeReason::WorkCompleted)
        );
        assert_eq!(
            runtime
                .get_root_resume(&expected.id)
                .await
                .expect("read claimed reservation"),
            Some(claimed)
        );
        runtime.close().await;
        let _ = tokio::fs::remove_dir_all(codex_home).await;
    }

    #[tokio::test]
    async fn completion_migration_preserves_existing_reservations_and_defaults_tasks() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:")
            .await
            .expect("in-memory database should open");
        for migration in [
            include_str!("../../migrations/0055_root_resume_reservations.sql"),
            include_str!("../../migrations/0060_root_resume_wait_timestamps.sql"),
        ] {
            sqlx::raw_sql(migration)
                .execute(&pool)
                .await
                .expect("old schema should apply");
        }
        sqlx::query(
            "INSERT INTO root_resume_reservations (
                id, root_thread_id, originating_turn_id, root_turn_id, call_id, resume_turn_id,
                resume_at_ms, created_at_ms, updated_at_ms, revision, state, agent_tasks_json,
                reason, wake_reason, wait_started_at_ms, wait_ended_at_ms
            ) VALUES ('old', 'root', 'origin', 'turn', 'call', 'resume',
                2000, 1000, 3000, 2, 'claimed', '[]', 'wait', 'agents_completed', 1000, 3000)",
        )
        .execute(&pool)
        .await
        .expect("old reservation should insert");
        sqlx::raw_sql(include_str!(
            "../../migrations/0063_root_resume_completion_tasks.sql"
        ))
        .execute(&pool)
        .await
        .expect("completion migration should apply");
        let mut query = QueryBuilder::<Sqlite>::new("SELECT ");
        query
            .push(ROOT_RESUME_COLUMNS)
            .push(" FROM root_resume_reservations");
        let row = query
            .build()
            .fetch_one(&pool)
            .await
            .expect("old reservation should remain");
        let record = root_resume_from_row(&row).expect("migrated reservation should decode");
        assert_eq!(record.id, "old");
        assert_eq!(record.revision, 2);
        assert_eq!(record.wait_started_at_ms, Some(1000));
        assert_eq!(record.wait_ended_at_ms, Some(3000));
        assert_eq!(
            record.wake_reason,
            Some(RootResumeWakeReason::AgentsCompleted)
        );
        assert!(record.completion_tasks.is_empty());
        sqlx::query("UPDATE root_resume_reservations SET wake_reason = 'work_completed'")
            .execute(&pool)
            .await
            .expect("expanded wake reason constraint should allow completion");
        let indexes: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index'
                AND name IN ('root_resume_one_active_per_root', 'root_resume_active_due')",
        )
        .fetch_one(&pool)
        .await
        .expect("migration indexes should be readable");
        assert_eq!(indexes, 2);
        pool.close().await;
    }

    #[tokio::test]
    async fn rejects_duplicate_active_reservation_for_root() {
        let codex_home = unique_temp_dir();
        let runtime = test_runtime(&codex_home).await;
        runtime
            .create_root_resume(&reservation(
                "first",
                "root-thread",
                RootResumeState::Waiting,
            ))
            .await
            .expect("first reservation should be stored");

        let error = runtime
            .create_root_resume(&reservation(
                "second",
                "root-thread",
                RootResumeState::Preparing,
            ))
            .await
            .expect_err("second active reservation should violate the root constraint");

        assert!(error.to_string().contains("UNIQUE constraint failed"));
        runtime.close().await;
        let _ = tokio::fs::remove_dir_all(codex_home).await;
    }

    #[tokio::test]
    async fn concurrent_compare_and_swap_has_one_winner() {
        let codex_home = unique_temp_dir();
        let runtime = test_runtime(&codex_home).await;
        runtime
            .create_root_resume(&reservation(
                "race",
                "root-thread",
                RootResumeState::Waiting,
            ))
            .await
            .expect("reservation should be stored");

        let first = runtime.transition_root_resume(
            "race",
            0,
            RootResumeState::Claimed,
            Some(RootResumeWakeReason::Deadline),
            None,
            3_000,
        );
        let second = runtime.transition_root_resume(
            "race",
            0,
            RootResumeState::Claimed,
            Some(RootResumeWakeReason::AgentsCompleted),
            None,
            3_001,
        );
        let (first, second) = tokio::join!(first, second);
        let winners = [first.expect("first CAS"), second.expect("second CAS")]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();

        assert_eq!(1, winners.len());
        assert_eq!(1, winners[0].revision);
        assert_eq!(RootResumeState::Claimed, winners[0].state);
        runtime.close().await;
        let _ = tokio::fs::remove_dir_all(codex_home).await;
    }

    #[tokio::test]
    async fn reservation_survives_runtime_reload() {
        let codex_home = unique_temp_dir();
        let sqlite = SqliteConfig::new_for_testing(codex_home.as_path().abs());
        let expected = reservation("durable", "root-thread", RootResumeState::Waiting);
        let runtime = StateRuntime::init(sqlite.clone(), "test-provider".to_string())
            .await
            .expect("state runtime should initialize");
        runtime
            .create_root_resume(&expected)
            .await
            .expect("reservation should be stored");
        runtime.close().await;
        drop(runtime);

        let runtime = StateRuntime::init(sqlite, "test-provider".to_string())
            .await
            .expect("state runtime should reopen");
        assert_eq!(
            Some(expected),
            runtime
                .get_root_resume("durable")
                .await
                .expect("reservation should load")
        );
        runtime.close().await;
        let _ = tokio::fs::remove_dir_all(codex_home).await;
    }

    #[tokio::test]
    async fn cancelled_reservation_cannot_be_claimed() {
        let codex_home = unique_temp_dir();
        let runtime = test_runtime(&codex_home).await;
        runtime
            .create_root_resume(&reservation(
                "cancel",
                "root-thread",
                RootResumeState::Waiting,
            ))
            .await
            .expect("reservation should be stored");
        let cancelled = runtime
            .transition_root_resume(
                "cancel",
                0,
                RootResumeState::Cancelled,
                Some(RootResumeWakeReason::UserInput),
                None,
                2_500,
            )
            .await
            .expect("cancellation should execute")
            .expect("cancellation should win");

        assert_eq!(1, cancelled.revision);
        assert_eq!(
            None,
            runtime
                .transition_root_resume(
                    "cancel",
                    1,
                    RootResumeState::Claimed,
                    Some(RootResumeWakeReason::Manual),
                    None,
                    2_600,
                )
                .await
                .expect("claim attempt should execute")
        );
        runtime.close().await;
        let _ = tokio::fs::remove_dir_all(codex_home).await;
    }

    #[tokio::test]
    async fn preparing_must_arm_and_blocked_can_retry() {
        let codex_home = unique_temp_dir();
        let runtime = test_runtime(&codex_home).await;
        runtime
            .create_root_resume(&reservation(
                "states",
                "root-thread",
                RootResumeState::Preparing,
            ))
            .await
            .expect("reservation should be stored");

        assert_eq!(
            None,
            runtime
                .transition_root_resume(
                    "states",
                    0,
                    RootResumeState::Claimed,
                    Some(RootResumeWakeReason::Manual),
                    None,
                    2_000,
                )
                .await
                .expect("invalid claim should execute")
        );
        let waiting = runtime
            .transition_root_resume("states", 0, RootResumeState::Waiting, None, None, 2_100)
            .await
            .expect("arming should execute")
            .expect("preparing reservation should arm");
        let blocked = runtime
            .transition_root_resume(
                "states",
                waiting.revision,
                RootResumeState::Blocked,
                None,
                Some("provider unavailable".to_string()),
                2_200,
            )
            .await
            .expect("blocking should execute")
            .expect("waiting reservation should block");
        let claimed = runtime
            .transition_root_resume(
                "states",
                blocked.revision,
                RootResumeState::Claimed,
                Some(RootResumeWakeReason::Manual),
                None,
                2_300,
            )
            .await
            .expect("retry should execute")
            .expect("blocked reservation should be claimable");

        assert_eq!(
            (waiting.wait_started_at_ms, waiting.wait_ended_at_ms),
            (Some(2_100), None)
        );
        assert_eq!(
            (blocked.wait_started_at_ms, blocked.wait_ended_at_ms),
            (Some(2_100), Some(2_200))
        );
        assert_eq!(
            (claimed.wait_started_at_ms, claimed.wait_ended_at_ms),
            (Some(2_100), Some(2_200))
        );
        assert_eq!(RootResumeState::Claimed, claimed.state);
        assert_eq!(3, claimed.revision);
        assert_eq!(None, claimed.last_error);
        runtime.close().await;
        let _ = tokio::fs::remove_dir_all(codex_home).await;
    }
}

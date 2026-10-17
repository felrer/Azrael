use std::borrow::Cow;

use sqlx::migrate::Migrator;
use sqlx_sqlite::SqlitePool;

pub(crate) static STATE_MIGRATOR: Migrator = sqlx_macros::migrate!("./migrations");
pub(crate) static LOGS_MIGRATOR: Migrator = sqlx_macros::migrate!("./logs_migrations");
pub(crate) static GOALS_MIGRATOR: Migrator = sqlx_macros::migrate!("./goals_migrations");
pub(crate) static MEMORIES_MIGRATOR: Migrator = sqlx_macros::migrate!("./memory_migrations");
pub(crate) static QUEUE_MIGRATOR: Migrator = sqlx_macros::migrate!("./queue_migrations");
pub(crate) static THREAD_HISTORY_MIGRATOR: Migrator =
    sqlx_macros::migrate!("./thread_history_migrations");

/// Allow an older Codex binary to open a database that has already been
/// migrated by a newer binary running in parallel.
///
/// We intentionally ignore applied migration versions that are newer than the
/// embedded migration set. Known migration versions are still validated by
/// checksum, so this only relaxes the "database is ahead of me" case.
fn runtime_migrator(base: &'static Migrator) -> Migrator {
    Migrator {
        migrations: Cow::Borrowed(base.migrations.as_ref()),
        ignore_missing: true,
        locking: base.locking,
        no_tx: base.no_tx,
        table_name: base.table_name.clone(),
        create_schemas: base.create_schemas.clone(),
    }
}

pub(crate) fn runtime_state_migrator() -> Migrator {
    runtime_migrator(&STATE_MIGRATOR)
}

pub(crate) fn runtime_logs_migrator() -> Migrator {
    runtime_migrator(&LOGS_MIGRATOR)
}

pub(crate) fn runtime_goals_migrator() -> Migrator {
    runtime_migrator(&GOALS_MIGRATOR)
}

pub(crate) fn runtime_memories_migrator() -> Migrator {
    runtime_migrator(&MEMORIES_MIGRATOR)
}

pub(crate) fn runtime_queue_migrator() -> Migrator {
    runtime_migrator(&QUEUE_MIGRATOR)
}

// The paginated history projector will call this when it takes ownership of opening the database.
#[allow(dead_code)]
pub(crate) fn runtime_thread_history_migrator() -> Migrator {
    runtime_migrator(&THREAD_HISTORY_MIGRATOR)
}

pub(crate) async fn repair_legacy_recency_migration_version(
    pool: &SqlitePool,
    migrator: &Migrator,
) -> anyhow::Result<()> {
    let Some(recency_migration) = migrator
        .migrations
        .iter()
        .find(|migration| migration.version == 39)
    else {
        return Ok(());
    };
    let migrations_table_exists = sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_optional(pool)
    .await?
    .is_some();
    if !migrations_table_exists {
        return Ok(());
    }

    let legacy_recency_needs_repair = sqlx::query_scalar::<_, i64>(
        r#"
SELECT 1
FROM _sqlx_migrations
WHERE version = ?
  AND checksum = ?
  AND NOT EXISTS (
      SELECT 1 FROM _sqlx_migrations WHERE version = ?
  )
        "#,
    )
    .bind(38_i64)
    .bind(recency_migration.checksum.as_ref())
    .bind(recency_migration.version)
    .fetch_optional(pool)
    .await?
    .is_some();
    if !legacy_recency_needs_repair {
        return Ok(());
    }

    sqlx::query(
        r#"
UPDATE _sqlx_migrations
SET version = ?, description = ?
WHERE version = ?
  AND checksum = ?
  AND NOT EXISTS (
      SELECT 1 FROM _sqlx_migrations WHERE version = ?
  )
        "#,
    )
    .bind(recency_migration.version)
    .bind(recency_migration.description.as_ref())
    .bind(38_i64)
    .bind(recency_migration.checksum.as_ref())
    .bind(recency_migration.version)
    .execute(pool)
    .await?;
    Ok(())
}

/// Called while the state startup transaction holds the SQLite writer lock.
/// Only the successful, byte-identical legacy root-wait migration may move.
pub(crate) async fn repair_legacy_root_wait_migration_version(
    connection: &mut sqlx::SqliteConnection,
    migrator: &Migrator,
) -> anyhow::Result<()> {
    let Some(root_wait) = migrator.migrations.iter().find(|migration| {
        migration.version == 60 && migration.description == "root resume wait timestamps"
    }) else {
        return Ok(());
    };
    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_optional(&mut *connection)
    .await?
    .is_some();
    if !exists {
        return Ok(());
    }
    let legacy = sqlx::query_as::<_, (bool, Vec<u8>)>(
        "SELECT success, checksum FROM _sqlx_migrations WHERE version = 56",
    )
    .fetch_optional(&mut *connection)
    .await?;
    let Some((true, checksum)) = legacy else {
        return Ok(());
    };
    if checksum.as_slice() != root_wait.checksum.as_ref() {
        return Ok(());
    }
    let occupied =
        sqlx::query_scalar::<_, i64>("SELECT 1 FROM _sqlx_migrations WHERE version = 60")
            .fetch_optional(&mut *connection)
            .await?
            .is_some();
    anyhow::ensure!(
        !occupied,
        "legacy root-wait migration conflicts with existing version 60"
    );
    sqlx::query("UPDATE _sqlx_migrations SET version = 60 WHERE version = 56 AND success = TRUE AND checksum = ?")
        .bind(root_wait.checksum.as_ref())
        .execute(&mut *connection)
        .await?;
    Ok(())
}

#[cfg(test)]
#[path = "migrations_tests.rs"]
mod tests;

/// Bump for incompatible non-SQL JSON storage or persisted protocol semantics.
/// SQL migration changes are represented independently by embedded checksums.
pub const AZRAEL_NON_SQL_STORAGE_ABI_VERSION: u32 = 1;

/// Deterministic, credential-free metadata for every embedded runtime migrator.
/// Equal manifests permit participating engines to share storage concurrently;
/// this manifest does not replace native migration checksum validation.
pub fn azrael_storage_compatibility_manifest() -> String {
    let migrators = [
        ("state", &STATE_MIGRATOR),
        ("logs", &LOGS_MIGRATOR),
        ("goals", &GOALS_MIGRATOR),
        ("memories", &MEMORIES_MIGRATOR),
        ("queue", &QUEUE_MIGRATOR),
        ("thread_history", &THREAD_HISTORY_MIGRATOR),
    ];
    let entries: Vec<_> = migrators
        .into_iter()
        .map(|(label, migrator)| {
            let migrations: Vec<_> = migrator
                .migrations
                .iter()
                .map(|migration| {
                    serde_json::json!({
                        "version": migration.version,
                        "description": migration.description.as_ref(),
                        "checksum": migration.checksum.as_ref(),
                    })
                })
                .collect();
            serde_json::json!({ "label": label, "migrations": migrations })
        })
        .collect();
    serde_json::json!({
        "protocol": 1,
        "non_sql_storage_abi": AZRAEL_NON_SQL_STORAGE_ABI_VERSION,
        "migrators": entries,
    })
    .to_string()
}

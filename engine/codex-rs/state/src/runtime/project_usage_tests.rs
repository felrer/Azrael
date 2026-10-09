use codex_utils_absolute_path::test_support::PathExt;

use super::*;
use crate::SqliteConfig;
use crate::runtime::test_support::unique_temp_dir;

fn delta(date: &str, project_id: &str, amount: Option<i64>) -> ProjectUsageDelta {
    ProjectUsageDelta {
        date: date.to_string(),
        project_id: project_id.to_string(),
        project_name: "Same name".to_string(),
        provider: "provider".to_string(),
        model: "model".to_string(),
        amount_nano_usd: amount,
    }
}

// Each test exercises the migrated on-disk store with the production pool
// configuration. Close pools before removing the test-owned SQLite files.
#[tokio::test]
async fn daily_totals_preserve_identity_and_bound_row_growth() -> anyhow::Result<()> {
    let home = unique_temp_dir();
    let runtime = StateRuntime::init(
        SqliteConfig::new_for_testing(home.as_path().abs()),
        "provider".to_string(),
    )
    .await?;
    for _ in 0..100 {
        runtime
            .add_project_usage(&delta("2026-10-09", "a", Some(7)))
            .await?;
    }
    runtime
        .add_project_usage(&delta("2026-10-09", "a", None))
        .await?;
    runtime
        .add_project_usage(&delta("2026-10-09", "b", Some(0)))
        .await?;
    let mut other = delta("2026-10-09", "a", Some(3));
    other.model = "other-model".to_string();
    runtime.add_project_usage(&other).await?;
    other.provider = "other-provider".to_string();
    runtime.add_project_usage(&other).await?;
    let rows = runtime.project_usage_daily(2026).await?;
    assert_eq!(rows.len(), 4);
    let total = rows
        .iter()
        .find(|row| row.project_id == "a" && row.model == "model")
        .unwrap();
    assert_eq!(total.amount_nano_usd, 700);
    assert_eq!(total.priced_requests, 100);
    assert_eq!(total.unpriced_requests, 1);
    assert!(rows.iter().all(|row| row.project_name == "Same name"));
    let zero = rows.iter().find(|row| row.project_id == "b").unwrap();
    assert_eq!((zero.priced_requests, zero.unpriced_requests), (1, 0));
    runtime.close().await;
    tokio::fs::remove_dir_all(home).await?;
    Ok(())
}

#[tokio::test]
async fn independent_connections_update_without_lost_totals() -> anyhow::Result<()> {
    let home = unique_temp_dir();
    let config = SqliteConfig::new_for_testing(home.as_path().abs());
    let first = StateRuntime::init(config.clone(), "provider".to_string()).await?;
    let second = StateRuntime::init(config, "provider".to_string()).await?;
    let writer = |runtime: std::sync::Arc<StateRuntime>| async move {
        for _ in 0..50 {
            runtime
                .add_project_usage(&delta("2026-10-09", "a", Some(11)))
                .await?;
            runtime
                .add_project_usage(&delta("2026-10-09", "a", None))
                .await?;
        }
        anyhow::Ok(())
    };
    let (a, b) = tokio::join!(writer(first.clone()), writer(second.clone()));
    a?;
    b?;
    let rows = first.project_usage_daily(2026).await?;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].amount_nano_usd, 1100);
    assert_eq!(rows[0].priced_requests, 100);
    assert_eq!(rows[0].unpriced_requests, 100);
    first.close().await;
    second.close().await;
    tokio::fs::remove_dir_all(home).await?;
    Ok(())
}

#[tokio::test]
async fn invalid_inputs_and_overflow_leave_valid_totals_unchanged() -> anyhow::Result<()> {
    let home = unique_temp_dir();
    let runtime = StateRuntime::init(
        SqliteConfig::new_for_testing(home.as_path().abs()),
        "provider".to_string(),
    )
    .await?;
    for date in [
        "0000-01-01",
        "2026-02-29",
        "2026-1-01",
        "10000-01-01",
        "2026-10-09x",
    ] {
        assert!(
            runtime
                .add_project_usage(&delta(date, "a", Some(1)))
                .await
                .is_err()
        );
    }
    assert!(
        runtime
            .add_project_usage(&delta("2026-10-09", "a", Some(-1)))
            .await
            .is_err()
    );
    for id in [
        String::new(),
        " ".to_string(),
        "x".repeat(MAX_ID_BYTES + 1),
        "a\nb".to_string(),
    ] {
        let mut invalid = delta("2026-10-09", &id, Some(1));
        assert!(runtime.add_project_usage(&invalid).await.is_err());
        invalid.project_id = "a".to_string();
        invalid.provider = id.clone();
        assert!(runtime.add_project_usage(&invalid).await.is_err());
        invalid.provider = "provider".to_string();
        invalid.model = id;
        assert!(runtime.add_project_usage(&invalid).await.is_err());
    }
    assert!(runtime.project_usage_daily(0).await.is_err());
    assert!(runtime.project_usage_daily(10000).await.is_err());
    assert!(runtime.project_usage_daily(2026).await?.is_empty());
    runtime
        .add_project_usage(&delta("2026-10-09", "a", Some(i64::MAX)))
        .await?;
    let before = runtime.project_usage_daily(2026).await?;
    let mut overflowing = delta("2026-10-09", "a", Some(1));
    overflowing.project_name = "must not persist".to_string();
    assert!(runtime.add_project_usage(&overflowing).await.is_err());
    assert_eq!(runtime.project_usage_daily(2026).await?, before);
    runtime
        .add_project_usage(&delta("2026-10-09", "a", None))
        .await?;
    for column in ["priced_requests", "unpriced_requests"] {
        // Seed the otherwise impractical request-count limit without changing
        // the amount. Exercise each guard independently.
        let statement = if column == "priced_requests" {
            "UPDATE project_usage_daily SET priced_requests = ? WHERE project_id = 'a'"
        } else {
            "UPDATE project_usage_daily SET unpriced_requests = ? WHERE project_id = 'a'"
        };
        sqlx::query(statement)
            .bind(i64::MAX)
            .execute(runtime.pool.as_ref())
            .await?;
        let before = runtime.project_usage_daily(2026).await?;
        let amount = if column == "priced_requests" {
            Some(0)
        } else {
            None
        };
        assert!(
            runtime
                .add_project_usage(&delta("2026-10-09", "a", amount))
                .await
                .is_err()
        );
        assert_eq!(runtime.project_usage_daily(2026).await?, before);
    }
    runtime
        .add_project_usage(&delta("2026-10-09", "b", Some(1)))
        .await?;
    assert_eq!(runtime.project_usage_daily(2026).await?.len(), 2);
    runtime.close().await;
    tokio::fs::remove_dir_all(home).await?;
    Ok(())
}

#[tokio::test]
async fn year_queries_include_boundaries_and_names_are_sanitized() -> anyhow::Result<()> {
    let home = unique_temp_dir();
    let runtime = StateRuntime::init(
        SqliteConfig::new_for_testing(home.as_path().abs()),
        "provider".to_string(),
    )
    .await?;
    for date in [
        "0001-01-01",
        "2025-12-31",
        "2026-01-01",
        "2026-12-31",
        "2027-01-01",
        "9999-12-31",
    ] {
        let mut entry = delta(date, "a", Some(1));
        entry.project_name = format!("\0\n{}\t", "가".repeat(300));
        runtime.add_project_usage(&entry).await?;
    }
    let rows = runtime.project_usage_daily(2026).await?;
    assert_eq!(
        rows.iter().map(|row| row.date.as_str()).collect::<Vec<_>>(),
        ["2026-01-01", "2026-12-31"]
    );
    assert!(
        rows.iter()
            .all(|row| row.project_name == "가".repeat(MAX_NAME_CHARS))
    );
    assert_eq!(runtime.project_usage_daily(1).await?.len(), 1);
    assert_eq!(runtime.project_usage_daily(9999).await?.len(), 1);
    runtime.close().await;
    tokio::fs::remove_dir_all(home).await?;
    Ok(())
}

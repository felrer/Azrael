//! Aggregate API-equivalent USD usage; no individual request records are retained.

use chrono::Datelike;
use chrono::NaiveDate;
use sqlx::Row;

use super::StateRuntime;

const MAX_ID_BYTES: usize = 256;
const MAX_NAME_CHARS: usize = 256;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectUsageDelta {
    /// ISO calendar date in Asia/Seoul, resolved by the accounting caller.
    pub date: String,
    pub project_id: String,
    pub project_name: String,
    pub provider: String,
    pub model: String,
    /// None records one unpriced request; Some records one priced request.
    pub amount_nano_usd: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectUsageDailyRow {
    pub date: String,
    pub project_id: String,
    pub project_name: String,
    pub provider: String,
    pub model: String,
    pub amount_nano_usd: i64,
    pub priced_requests: i64,
    pub unpriced_requests: i64,
}

impl StateRuntime {
    pub async fn add_project_usage(&self, delta: &ProjectUsageDelta) -> anyhow::Result<()> {
        validate_delta(delta)?;
        let name: String = delta
            .project_name
            .chars()
            .filter(|character| !character.is_control())
            .take(MAX_NAME_CHARS)
            .collect();
        let amount = delta.amount_nano_usd.unwrap_or(0);
        let priced = i64::from(delta.amount_nano_usd.is_some());
        let unpriced = i64::from(delta.amount_nano_usd.is_none());
        // Acquire the existing SQLite writer lock before updating. The guards
        // prevent SQLite's overflowing integer additions from becoming REALs.
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        let result = sqlx::query(
            "INSERT INTO project_usage_daily
             (date, project_id, project_name, provider, model, amount_nano_usd,
              priced_requests, unpriced_requests)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (date, project_id, provider, model) DO UPDATE SET
               project_name = excluded.project_name,
               amount_nano_usd = project_usage_daily.amount_nano_usd + excluded.amount_nano_usd,
               priced_requests = project_usage_daily.priced_requests + excluded.priced_requests,
               unpriced_requests = project_usage_daily.unpriced_requests + excluded.unpriced_requests
             WHERE project_usage_daily.amount_nano_usd <= 9223372036854775807 - excluded.amount_nano_usd
               AND project_usage_daily.priced_requests <= 9223372036854775807 - excluded.priced_requests
               AND project_usage_daily.unpriced_requests <= 9223372036854775807 - excluded.unpriced_requests",
        )
        .bind(&delta.date)
        .bind(&delta.project_id)
        .bind(name.trim())
        .bind(&delta.provider)
        .bind(&delta.model)
        .bind(amount)
        .bind(priced)
        .bind(unpriced)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() != 1 {
            tx.rollback().await?;
            anyhow::bail!("project usage aggregate overflow");
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn project_usage_daily(
        &self,
        year: i32,
    ) -> anyhow::Result<Vec<ProjectUsageDailyRow>> {
        anyhow::ensure!((1..=9999).contains(&year), "invalid project usage year");
        let start = format!("{year:04}-01-01");
        let end = format!("{year:04}-12-31");
        let rows = sqlx::query(
            "SELECT date, project_id, project_name, provider, model, amount_nano_usd,
                    priced_requests, unpriced_requests
             FROM project_usage_daily WHERE date >= ? AND date <= ?
             ORDER BY date, project_id, provider, model",
        )
        .bind(start)
        .bind(end)
        .fetch_all(self.pool.as_ref())
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(ProjectUsageDailyRow {
                    date: row.try_get("date")?,
                    project_id: row.try_get("project_id")?,
                    project_name: row.try_get("project_name")?,
                    provider: row.try_get("provider")?,
                    model: row.try_get("model")?,
                    amount_nano_usd: row.try_get("amount_nano_usd")?,
                    priced_requests: row.try_get("priced_requests")?,
                    unpriced_requests: row.try_get("unpriced_requests")?,
                })
            })
            .collect()
    }
}

fn validate_delta(delta: &ProjectUsageDelta) -> anyhow::Result<()> {
    let bytes = delta.date.as_bytes();
    anyhow::ensure!(
        bytes.len() == 10
            && bytes.iter().enumerate().all(|(index, byte)| {
                if index == 4 || index == 7 {
                    *byte == b'-'
                } else {
                    byte.is_ascii_digit()
                }
            }),
        "invalid project usage ISO date"
    );
    let date = NaiveDate::parse_from_str(&delta.date, "%Y-%m-%d")?;
    anyhow::ensure!(
        (1..=9999).contains(&date.year()),
        "invalid project usage year"
    );
    for value in [&delta.project_id, &delta.provider, &delta.model] {
        anyhow::ensure!(
            !value.trim().is_empty()
                && value.len() <= MAX_ID_BYTES
                && !value.chars().any(char::is_control),
            "invalid project usage identifier"
        );
    }
    anyhow::ensure!(
        delta.amount_nano_usd.is_none_or(|amount| amount >= 0),
        "negative project usage amount"
    );
    Ok(())
}

#[cfg(test)]
#[path = "project_usage_tests.rs"]
mod tests;

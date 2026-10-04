use super::SqliteQueueStore;
use crate::MAX_QUEUE_ITEMS;
use codex_protocol::ThreadId;
use sqlx::Row;
use sqlx::sqlite::SqliteRow;
use uuid::Uuid;

/// Durable custody of an acknowledged input, or its retained retry tombstone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcceptedUserInputRecord {
    pub receipt_id: String,
    pub thread_id: ThreadId,
    pub client_id: Option<String>,
    pub turn_id: String,
    pub acceptance_order: u64,
    pub payload_json: Option<String>,
    pub payload_sha256: String,
    pub state: AcceptedUserInputState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcceptedUserInputState {
    Pending,
    Consumed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AcceptUserInputOutcome {
    Added(AcceptedUserInputRecord),
    Existing(AcceptedUserInputRecord),
}

impl AcceptedUserInputRecord {
    fn try_from_row(row: &SqliteRow) -> anyhow::Result<Self> {
        let state: String = row.try_get("state")?;
        Ok(Self {
            receipt_id: row.try_get("receipt_id")?,
            thread_id: ThreadId::try_from(row.try_get::<String, _>("thread_id")?)?,
            client_id: row.try_get("client_id")?,
            turn_id: row.try_get("turn_id")?,
            acceptance_order: u64::try_from(row.try_get::<i64, _>("acceptance_order")?)?,
            payload_json: row.try_get("payload_json")?,
            payload_sha256: row.try_get("payload_sha256")?,
            state: match state.as_str() {
                "pending" => AcceptedUserInputState::Pending,
                "consumed" => AcceptedUserInputState::Consumed,
                _ => anyhow::bail!("invalid accepted user input state: {state}"),
            },
        })
    }
}

impl SqliteQueueStore {
    /// Commit custody before acknowledging. The caller supplies canonical JSON
    /// and its digest; retries retain the original receipt, turn and order.
    pub async fn accept_user_input(
        &self,
        thread_id: ThreadId,
        client_id: Option<&str>,
        turn_id: &str,
        acceptance_order: u64,
        payload_json: &str,
        payload_sha256: &str,
    ) -> anyhow::Result<AcceptUserInputOutcome> {
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        if let Some(client_id) = client_id {
            let row = sqlx::query(
                "SELECT * FROM accepted_user_inputs WHERE thread_id = ? AND client_id = ?",
            )
            .bind(thread_id.to_string())
            .bind(client_id)
            .fetch_optional(transaction.as_mut())
            .await?;
            if let Some(row) = row {
                let record = AcceptedUserInputRecord::try_from_row(&row)?;
                anyhow::ensure!(
                    record.payload_sha256 == payload_sha256,
                    "accepted user input client ID conflicts with a different payload digest"
                );
                transaction.commit().await?;
                return Ok(AcceptUserInputOutcome::Existing(record));
            }
        }
        let order = i64::try_from(acceptance_order)?;
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM accepted_user_inputs WHERE thread_id = ? AND state = 'pending'",
        )
        .bind(thread_id.to_string())
        .fetch_one(transaction.as_mut())
        .await?;
        anyhow::ensure!(
            count < i64::try_from(MAX_QUEUE_ITEMS)?,
            "accepted user input pending capacity reached"
        );
        let row = sqlx::query(
            "INSERT INTO accepted_user_inputs
             (receipt_id, thread_id, client_id, turn_id, acceptance_order,
              payload_json, payload_sha256, state)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending') RETURNING *",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(thread_id.to_string())
        .bind(client_id)
        .bind(turn_id)
        .bind(order)
        .bind(payload_json)
        .bind(payload_sha256)
        .fetch_one(transaction.as_mut())
        .await?;
        let record = AcceptedUserInputRecord::try_from_row(&row)?;
        transaction.commit().await?;
        Ok(AcceptUserInputOutcome::Added(record))
    }

    pub async fn pending_user_inputs(
        &self,
        thread_id: ThreadId,
    ) -> anyhow::Result<Vec<AcceptedUserInputRecord>> {
        let rows = sqlx::query(
            "SELECT * FROM accepted_user_inputs WHERE thread_id = ? AND state = 'pending'
             ORDER BY acceptance_order, receipt_id",
        )
        .bind(thread_id.to_string())
        .fetch_all(self.pool.as_ref())
        .await?;
        rows.iter()
            .map(AcceptedUserInputRecord::try_from_row)
            .collect()
    }

    /// Look up pending receipts and consumed tombstones alike.
    pub async fn user_input_receipt(
        &self,
        thread_id: ThreadId,
        client_id: &str,
    ) -> anyhow::Result<Option<AcceptedUserInputRecord>> {
        let row =
            sqlx::query("SELECT * FROM accepted_user_inputs WHERE thread_id = ? AND client_id = ?")
                .bind(thread_id.to_string())
                .bind(client_id)
                .fetch_optional(self.pool.as_ref())
                .await?;
        row.as_ref()
            .map(AcceptedUserInputRecord::try_from_row)
            .transpose()
    }

    /// Retire custody only after the caller has durably persisted ordinary history.
    /// Returns whether a pending receipt transitioned to a tombstone.
    pub async fn consume_user_input(
        &self,
        thread_id: ThreadId,
        receipt_id: &str,
    ) -> anyhow::Result<bool> {
        Ok(sqlx::query(
            "UPDATE accepted_user_inputs SET state = 'consumed', payload_json = NULL
             WHERE thread_id = ? AND receipt_id = ? AND state = 'pending'",
        )
        .bind(thread_id.to_string())
        .bind(receipt_id)
        .execute(self.pool.as_ref())
        .await?
        .rows_affected()
            > 0)
    }

    /// Include tombstones when seeding acceptance order after a restart.
    pub async fn max_user_input_order(&self, thread_id: ThreadId) -> anyhow::Result<Option<u64>> {
        let order: Option<i64> = sqlx::query_scalar(
            "SELECT MAX(acceptance_order) FROM accepted_user_inputs WHERE thread_id = ?",
        )
        .bind(thread_id.to_string())
        .fetch_one(self.pool.as_ref())
        .await?;
        order.map(u64::try_from).transpose().map_err(Into::into)
    }
}

#[cfg(test)]
#[path = "accepted_user_inputs_tests.rs"]
mod tests;

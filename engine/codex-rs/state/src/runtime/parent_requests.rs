use super::StateRuntime;
use anyhow::Result;
use anyhow::bail;
use anyhow::ensure;
use codex_protocol::parent_request::ParentRequest;
use codex_protocol::parent_request::ParentRequestDeliveryState;
use codex_protocol::parent_request::ParentRequestStatus;
use codex_protocol::parent_request::ParentResponse;
use codex_protocol::parent_request::ParentResponseWait;
use codex_protocol::parent_request::ParentResponseWaitResult;
use sqlx::Row;
use sqlx::Sqlite;
use sqlx::Transaction;

impl StateRuntime {
    pub async fn create_parent_request(&self, record: &ParentRequest) -> Result<ParentRequest> {
        ensure!(
            record.status == ParentRequestStatus::Pending
                && record.response.is_none()
                && record.delivery_state == ParentRequestDeliveryState::Queued
                && record.delivery_reason.is_none(),
            "invalid_initial_request"
        );
        let mut tx = self.pool.begin().await?;
        // Take SQLite's writer lock before reading the idempotency key.
        sqlx::query("INSERT INTO parent_requests(request_id,parent_thread_id,child_thread_id,child_task_id,request_key,status,created_at_ms,record_json) VALUES(?,?,?,?,?,'pending',?,?) ON CONFLICT(child_thread_id,child_task_id,request_key) DO NOTHING")
            .bind(&record.request_id).bind(&record.parent_thread_id).bind(&record.child_thread_id)
            .bind(&record.child_task_id).bind(&record.request_key).bind(record.created_at_ms)
            .bind(serde_json::to_string(record)?).execute(&mut *tx).await?;
        let json: String = sqlx::query_scalar("SELECT record_json FROM parent_requests WHERE child_thread_id=? AND child_task_id=? AND request_key=?")
            .bind(&record.child_thread_id).bind(&record.child_task_id).bind(&record.request_key).fetch_one(&mut *tx).await?;
        let existing: ParentRequest = serde_json::from_str(&json)?;
        ensure!(
            existing.parent_thread_id == record.parent_thread_id
                && existing.question == record.question
                && existing.context == record.context
                && existing.recommendation == record.recommendation
                && existing.blocked_action == record.blocked_action,
            "parent_request_key_conflict"
        );
        tx.commit().await?;
        Ok(existing)
    }

    pub async fn get_parent_request(&self, id: &str) -> Result<Option<ParentRequest>> {
        let json: Option<String> =
            sqlx::query_scalar("SELECT record_json FROM parent_requests WHERE request_id=?")
                .bind(id)
                .fetch_optional(self.pool.as_ref())
                .await?;
        json.map(|json| serde_json::from_str(&json).map_err(Into::into))
            .transpose()
    }

    pub async fn list_pending_parent_requests(
        &self,
        parent_thread_id: &str,
    ) -> Result<Vec<ParentRequest>> {
        let rows = sqlx::query("SELECT record_json FROM parent_requests WHERE parent_thread_id=? AND status='pending' ORDER BY created_at_ms,request_id")
            .bind(parent_thread_id).fetch_all(self.pool.as_ref()).await?;
        rows.iter()
            .map(|row| {
                Ok(serde_json::from_str(
                    &row.try_get::<String, _>("record_json")?,
                )?)
            })
            .collect()
    }

    pub async fn set_parent_request_delivery(
        &self,
        id: &str,
        state: ParentRequestDeliveryState,
        reason: Option<String>,
        now_ms: i64,
    ) -> Result<ParentRequest> {
        // Diagnostics are bounded machine codes, never arbitrary request content.
        ensure!(
            reason.as_ref().is_none_or(|r| !r.is_empty()
                && r.len() <= 80
                && r.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')),
            "invalid_delivery_reason"
        );
        let mut tx = self.pool.begin().await?;
        let mut record = locked_request(&mut tx, id).await?;
        record.delivery_state = state;
        record.delivery_reason = reason;
        record.updated_at_ms = now_ms;
        save_request(&mut tx, &record).await?;
        tx.commit().await?;
        Ok(record)
    }

    pub async fn respond_parent_request(
        &self,
        id: &str,
        parent_thread_id: &str,
        response: &ParentResponse,
        now_ms: i64,
    ) -> Result<ParentRequest> {
        ensure!(
            response.status != ParentRequestStatus::Pending,
            "invalid_parent_response_status"
        );
        if response.status == ParentRequestStatus::Deferred {
            ensure!(
                !response.reason.trim().is_empty()
                    && response
                        .retry_condition
                        .as_ref()
                        .is_some_and(|c| !c.trim().is_empty()),
                "deferred_response_requires_reason_and_condition"
            );
        } else {
            ensure!(
                response.retry_condition.is_none(),
                "unexpected_retry_condition"
            );
        }
        let mut tx = self.pool.begin().await?;
        let mut record = locked_request(&mut tx, id).await?;
        ensure!(
            record.parent_thread_id == parent_thread_id,
            "parent_request_owner_mismatch"
        );
        if let Some(existing) = &record.response {
            ensure!(existing == response, "parent_response_conflict");
        } else {
            ensure!(
                record.status == ParentRequestStatus::Pending,
                "parent_request_not_pending"
            );
            record.status = response.status.clone();
            record.response = Some(response.clone());
            record.delivery_state = ParentRequestDeliveryState::Queued;
            record.delivery_reason = None;
            record.updated_at_ms = now_ms;
            save_request(&mut tx, &record).await?;
        }
        tx.commit().await?;
        Ok(record)
    }

    pub async fn create_parent_response_wait(
        &self,
        record: &ParentResponseWait,
    ) -> Result<ParentResponseWait> {
        ensure!(
            record.result.is_none()
                && record.ended_at_ms.is_none()
                && record.measured_active_ms == 0,
            "invalid_initial_wait"
        );
        let mut tx = self.pool.begin().await?;
        let request = locked_request(&mut tx, &record.request_id).await?;
        ensure!(
            request.child_task_id == record.child_task_id
                && request.child_thread_id == record.child_thread_id,
            "parent_wait_owner_mismatch"
        );
        // A response may race with wait creation: core reconciles it immediately.
        let json: Option<String> = sqlx::query_scalar("SELECT record_json FROM parent_response_waits WHERE wait_id=? OR (request_id=? AND child_task_id=? AND result IS NULL)")
            .bind(&record.wait_id).bind(&record.request_id).bind(&record.child_task_id).fetch_optional(&mut *tx).await?;
        let existing = if let Some(json) = json {
            let existing: ParentResponseWait = serde_json::from_str(&json)?;
            ensure!(
                existing.request_id == record.request_id
                    && existing.child_task_id == record.child_task_id
                    && existing.child_thread_id == record.child_thread_id
                    && existing.originating_call_id == record.originating_call_id
                    && existing.resume_settings == record.resume_settings,
                "parent_wait_conflict"
            );
            existing
        } else {
            sqlx::query("INSERT INTO parent_response_waits(wait_id,request_id,child_task_id,result,record_json) VALUES(?,?,?,NULL,?)")
                .bind(&record.wait_id).bind(&record.request_id).bind(&record.child_task_id).bind(serde_json::to_string(record)?).execute(&mut *tx).await?;
            record.clone()
        };
        tx.commit().await?;
        Ok(existing)
    }

    pub async fn get_parent_response_wait(&self, id: &str) -> Result<Option<ParentResponseWait>> {
        let json: Option<String> =
            sqlx::query_scalar("SELECT record_json FROM parent_response_waits WHERE wait_id=?")
                .bind(id)
                .fetch_optional(self.pool.as_ref())
                .await?;
        json.map(|json| serde_json::from_str(&json).map_err(Into::into))
            .transpose()
    }

    pub async fn list_active_parent_response_waits(
        &self,
        child_thread_id: &str,
    ) -> Result<Vec<ParentResponseWait>> {
        let rows = sqlx::query("SELECT w.record_json FROM parent_response_waits w JOIN parent_requests r ON r.request_id=w.request_id WHERE r.child_thread_id=? AND w.result IS NULL ORDER BY w.wait_id")
            .bind(child_thread_id).fetch_all(self.pool.as_ref()).await?;
        rows.iter()
            .map(|row| {
                Ok(serde_json::from_str(
                    &row.try_get::<String, _>("record_json")?,
                )?)
            })
            .collect()
    }

    pub async fn checkpoint_parent_response_wait(
        &self,
        id: &str,
        measured_active_ms: i64,
        now_ms: i64,
    ) -> Result<ParentResponseWait> {
        self.update_parent_response_wait(id, None, Some(measured_active_ms), now_ms)
            .await
    }

    pub async fn end_parent_response_wait(
        &self,
        id: &str,
        result: ParentResponseWaitResult,
        measured_active_ms: i64,
        now_ms: i64,
    ) -> Result<ParentResponseWait> {
        self.update_parent_response_wait(id, Some(result), Some(measured_active_ms), now_ms)
            .await
    }

    pub async fn recover_parent_response_wait(
        &self,
        id: &str,
        now_ms: i64,
    ) -> Result<ParentResponseWait> {
        self.update_parent_response_wait(
            id,
            Some(ParentResponseWaitResult::Interrupted),
            None,
            now_ms,
        )
        .await
    }

    /// Record the first actual blocked boundary; wall-clock corrections do not measure duration.
    pub async fn begin_parent_response_wait(
        &self,
        id: &str,
        parked_at_ms: i64,
    ) -> Result<ParentResponseWait> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE parent_response_waits SET wait_id=wait_id WHERE wait_id=?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        let json: Option<String> =
            sqlx::query_scalar("SELECT record_json FROM parent_response_waits WHERE wait_id=?")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?;
        let Some(json) = json else {
            bail!("parent_wait_not_found")
        };
        let mut record: ParentResponseWait = serde_json::from_str(&json)?;
        ensure!(
            record.result.is_none() && record.ended_at_ms.is_none(),
            "parent_wait_terminal_conflict"
        );
        if record.parked_at_ms.is_none() {
            record.parked_at_ms = Some(parked_at_ms);
            sqlx::query("UPDATE parent_response_waits SET record_json=? WHERE wait_id=?")
                .bind(serde_json::to_string(&record)?)
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(record)
    }

    /// Replace a recovered active-time segment without a crash window lacking an active wait.
    pub async fn rotate_parent_response_wait(
        &self,
        old_wait_id: &str,
        new_record: &ParentResponseWait,
        now_ms: i64,
    ) -> Result<ParentResponseWait> {
        ensure!(
            new_record.wait_id != old_wait_id
                && new_record.result.is_none()
                && new_record.ended_at_ms.is_none()
                && new_record.measured_active_ms == 0,
            "invalid_rotated_wait"
        );
        let mut tx = self.pool.begin().await?;
        let request = locked_request(&mut tx, &new_record.request_id).await?;
        ensure!(
            request.child_thread_id == new_record.child_thread_id
                && request.child_task_id == new_record.child_task_id,
            "parent_wait_owner_mismatch"
        );
        let old_json: Option<String> =
            sqlx::query_scalar("SELECT record_json FROM parent_response_waits WHERE wait_id=?")
                .bind(old_wait_id)
                .fetch_optional(&mut *tx)
                .await?;
        let Some(old_json) = old_json else {
            bail!("parent_wait_not_found")
        };
        let mut old: ParentResponseWait = serde_json::from_str(&old_json)?;
        ensure!(
            same_wait_owner_and_settings(&old, new_record),
            "parent_wait_rotation_conflict"
        );
        ensure!(
            old.result.is_none() || old.result == Some(ParentResponseWaitResult::Interrupted),
            "parent_wait_terminal_conflict"
        );
        let existing_json: Option<String> = sqlx::query_scalar("SELECT record_json FROM parent_response_waits WHERE wait_id=? OR (request_id=? AND child_task_id=? AND result IS NULL AND wait_id<>?)")
            .bind(&new_record.wait_id).bind(&new_record.request_id).bind(&new_record.child_task_id).bind(old_wait_id)
            .fetch_optional(&mut *tx).await?;
        if let Some(json) = existing_json {
            let existing: ParentResponseWait = serde_json::from_str(&json)?;
            ensure!(
                same_wait_owner_and_settings(&existing, new_record),
                "parent_wait_rotation_conflict"
            );
            ensure!(old.result.is_some(), "parent_wait_rotation_conflict");
            tx.commit().await?;
            return Ok(existing);
        }
        if old.result.is_none() {
            old.result = Some(ParentResponseWaitResult::Interrupted);
            old.ended_at_ms = Some(now_ms);
            old.last_checkpoint_at_ms = now_ms;
            // Preserve runtime-measured duration; never count the offline wall-clock gap.
            sqlx::query("UPDATE parent_response_waits SET result=?,record_json=? WHERE wait_id=?")
                .bind(serde_json::to_string(
                    &ParentResponseWaitResult::Interrupted,
                )?)
                .bind(serde_json::to_string(&old)?)
                .bind(old_wait_id)
                .execute(&mut *tx)
                .await?;
        }
        sqlx::query("INSERT INTO parent_response_waits(wait_id,request_id,child_task_id,result,record_json) VALUES(?,?,?,NULL,?)")
            .bind(&new_record.wait_id).bind(&new_record.request_id).bind(&new_record.child_task_id)
            .bind(serde_json::to_string(new_record)?).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(new_record.clone())
    }

    async fn update_parent_response_wait(
        &self,
        id: &str,
        result: Option<ParentResponseWaitResult>,
        measured_active_ms: Option<i64>,
        now_ms: i64,
    ) -> Result<ParentResponseWait> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE parent_response_waits SET wait_id=wait_id WHERE wait_id=?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        let json: Option<String> =
            sqlx::query_scalar("SELECT record_json FROM parent_response_waits WHERE wait_id=?")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?;
        let Some(json) = json else {
            bail!("parent_wait_not_found")
        };
        let mut record: ParentResponseWait = serde_json::from_str(&json)?;
        let measured = measured_active_ms.unwrap_or(record.measured_active_ms);
        if record.result.is_some() {
            ensure!(
                record.result == result && record.measured_active_ms == measured,
                "parent_wait_terminal_conflict"
            );
        } else {
            ensure!(
                measured >= record.measured_active_ms && measured >= 0,
                "parent_wait_duration_regression"
            );
            record.measured_active_ms = measured;
            record.last_checkpoint_at_ms = now_ms;
            record.ended_at_ms = result.as_ref().map(|_| now_ms);
            record.result = result;
            let result_json = record
                .result
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?;
            sqlx::query("UPDATE parent_response_waits SET result=?,record_json=? WHERE wait_id=?")
                .bind(result_json)
                .bind(serde_json::to_string(&record)?)
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(record)
    }
}

fn same_wait_owner_and_settings(left: &ParentResponseWait, right: &ParentResponseWait) -> bool {
    left.request_id == right.request_id
        && left.child_task_id == right.child_task_id
        && left.child_thread_id == right.child_thread_id
        && left.originating_call_id == right.originating_call_id
        && left.resume_settings == right.resume_settings
}

async fn locked_request(tx: &mut Transaction<'_, Sqlite>, id: &str) -> Result<ParentRequest> {
    sqlx::query("UPDATE parent_requests SET request_id=request_id WHERE request_id=?")
        .bind(id)
        .execute(&mut **tx)
        .await?;
    let json: Option<String> =
        sqlx::query_scalar("SELECT record_json FROM parent_requests WHERE request_id=?")
            .bind(id)
            .fetch_optional(&mut **tx)
            .await?;
    let Some(json) = json else {
        bail!("parent_request_not_found")
    };
    Ok(serde_json::from_str(&json)?)
}

async fn save_request(tx: &mut Transaction<'_, Sqlite>, record: &ParentRequest) -> Result<()> {
    let status = match record.status {
        ParentRequestStatus::Pending => "pending",
        ParentRequestStatus::Resolved => "resolved",
        ParentRequestStatus::Cancelled => "cancelled",
        ParentRequestStatus::Deferred => "deferred",
    };
    sqlx::query("UPDATE parent_requests SET status=?,record_json=? WHERE request_id=?")
        .bind(status)
        .bind(serde_json::to_string(record)?)
        .bind(&record.request_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

#[cfg(test)]
#[path = "parent_requests_tests.rs"]
mod tests;

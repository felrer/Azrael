//! Durable host approval receipts and serialized, typed idle wakeups.
//! Neither chat text nor this ledger grants authority to engine tools.
use super::Session;
use codex_history::{InitialHistory, RolloutItem};
use codex_protocol::ThreadId;
use codex_protocol::error::{CodexErr, Result};
use codex_protocol::host_approvals::*;
use codex_protocol::protocol::EventMsg;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::sync::Arc;

const MAX_PENDING: usize = 32;
const MAX_RECORDS: usize = 256;
const MAX_PAYLOAD_BYTES: usize = 16 * 1024;
fn invalid(message: &str) -> CodexErr {
    CodexErr::InvalidRequest(message.into())
}
fn hex64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn owner_hash(token: &str) -> Result<String> {
    if !hex64(token) {
        return Err(invalid("invalid host approval owner capability"));
    }
    Ok(format!("{:x}", Sha256::digest(token.as_bytes())))
}
// Compare fixed-size digests without stopping at the first mismatching byte.
fn same_owner(left: &str, right: &str) -> bool {
    left.len() == 64
        && right.len() == 64
        && left
            .bytes()
            .zip(right.bytes())
            .fold(0u8, |diff, (a, b)| diff | (a ^ b))
            == 0
}
#[derive(Clone, Default)]
pub(crate) struct HostApprovals {
    records: BTreeMap<String, StoredHostApproval>,
    closed: bool,
}
impl HostApprovals {
    pub(crate) fn from_history(thread_id: ThreadId, items: &[RolloutItem]) -> Self {
        let mut ledger = Self::default();
        for item in items {
            if let RolloutItem::EventMsg(EventMsg::HostApprovalLedgerUpdated(event)) = item {
                event.apply_to(thread_id, &mut ledger.records);
            }
        }
        ledger
    }
    pub(crate) fn pending_count(&self) -> usize {
        self.records
            .values()
            .filter(|r| r.request.state == HostApprovalState::Pending)
            .count()
    }
    pub(crate) fn has_resume(&self) -> bool {
        self.records.values().any(|r| {
            matches!(
                r.request.resume_state,
                HostApprovalResumeState::Pending | HostApprovalResumeState::Claimed
            )
        })
    }
    pub(crate) fn list(&self, token: &str) -> Result<Vec<HostApprovalRecord>> {
        let hash = owner_hash(token)?;
        Ok(self
            .records
            .values()
            .filter(|r| same_owner(&r.owner_hash, &hash))
            .map(|r| r.request.clone())
            .collect())
    }
    fn register(
        &mut self,
        token: &str,
        id: String,
        scope: String,
        payload: serde_json::Value,
        turn: Option<String>,
        root: Option<String>,
    ) -> Result<HostApprovalRecord> {
        let hash = owner_hash(token)?;
        if self.closed {
            return Err(invalid(
                "host approvals were stopped; start a new turn first",
            ));
        }
        if id.is_empty()
            || id.len() > 128
            || !id.bytes().all(|c| c.is_ascii_graphic())
            || !hex64(&scope)
        {
            return Err(invalid("invalid host approval request identity"));
        }
        if !payload.is_object()
            || serde_json::to_vec(&payload)
                .map_err(|_| invalid("invalid approval payload"))?
                .len()
                > MAX_PAYLOAD_BYTES
        {
            return Err(invalid(
                "approval payload must be an object of at most 16 KiB",
            ));
        }
        if let Some(existing) = self.records.get(&id) {
            if !same_owner(&existing.owner_hash, &hash)
                || existing.request.scope_key != scope
                || existing.request.payload != payload
            {
                return Err(invalid("host approval identity or scope mismatch"));
            }
            if existing.request.state == HostApprovalState::Cancelled {
                return Err(invalid("host approval was cancelled"));
            }
            return Ok(existing.request.clone());
        }
        if self.records.len() >= MAX_RECORDS || self.pending_count() >= MAX_PENDING {
            return Err(invalid("host approval ledger capacity reached"));
        }
        let request = HostApprovalRecord {
            request_id: id.clone(),
            scope_key: scope,
            payload,
            state: HostApprovalState::Pending,
            persistence: None,
            original_turn_id: turn,
            original_root_turn_id: root,
            waiter_detached: false,
            resume_state: HostApprovalResumeState::None,
            resume_turn_id: None,
        };
        self.records.insert(
            id,
            StoredHostApproval {
                owner_hash: hash,
                request: request.clone(),
            },
        );
        Ok(request)
    }
    fn resolve(
        &mut self,
        token: &str,
        id: &str,
        scope: &str,
        decision: HostApprovalDecision,
        persistence: Option<HostApprovalPersistence>,
        resume: bool,
    ) -> Result<HostApprovalRecord> {
        let hash = owner_hash(token)?;
        let stored = self
            .records
            .get_mut(id)
            .ok_or_else(|| invalid("unknown host approval request"))?;
        if !same_owner(&stored.owner_hash, &hash) || stored.request.scope_key != scope {
            return Err(invalid("host approval identity or scope mismatch"));
        }
        let state = match decision {
            HostApprovalDecision::Accept => HostApprovalState::Accepted,
            HostApprovalDecision::Decline => HostApprovalState::Declined,
            HostApprovalDecision::Cancel => HostApprovalState::Cancelled,
        };
        if (state == HostApprovalState::Accepted) != persistence.is_some() {
            return Err(invalid(
                "accept requires persistence; decline and cancel forbid persistence",
            ));
        }
        if state == HostApprovalState::Cancelled && resume {
            return Err(invalid("cancelled host approvals cannot resume work"));
        }
        let request = &mut stored.request;
        if request.state == HostApprovalState::Cancelled {
            return if state == HostApprovalState::Cancelled {
                Ok(request.clone())
            } else {
                Err(invalid("host approval was cancelled"))
            };
        }
        if request.state != HostApprovalState::Pending
            && (request.state != state || request.persistence != persistence)
        {
            return Err(invalid("host approval decision is already recorded"));
        }
        request.state = state;
        request.persistence = persistence;
        if request.state == HostApprovalState::Cancelled {
            request.resume_state = HostApprovalResumeState::Cancelled;
        } else if (resume || request.waiter_detached)
            && request.resume_state == HostApprovalResumeState::None
        {
            request.resume_state = HostApprovalResumeState::Pending;
        }
        // Repeated fast-wait replies cannot downgrade an existing reservation.
        Ok(request.clone())
    }
    fn defer(&mut self, token: &str, id: &str, scope: &str) -> Result<HostApprovalRecord> {
        let hash = owner_hash(token)?;
        let stored = self
            .records
            .get_mut(id)
            .ok_or_else(|| invalid("unknown host approval request"))?;
        if !same_owner(&stored.owner_hash, &hash) || stored.request.scope_key != scope {
            return Err(invalid("host approval identity or scope mismatch"));
        }
        let request = &mut stored.request;
        if request.state == HostApprovalState::Cancelled {
            return Err(invalid("host approval was cancelled"));
        }
        request.waiter_detached = true;
        if matches!(
            request.state,
            HostApprovalState::Accepted | HostApprovalState::Declined
        ) && request.resume_state == HostApprovalResumeState::None
        {
            request.resume_state = HostApprovalResumeState::Pending;
        }
        Ok(request.clone())
    }
    fn withdraw(
        &mut self,
        token: Option<&str>,
        id: Option<&str>,
    ) -> Result<Vec<HostApprovalRecord>> {
        let hash = token.map(owner_hash).transpose()?;
        if let Some(id) = id {
            let stored = self
                .records
                .get(id)
                .ok_or_else(|| invalid("unknown host approval request"))?;
            if hash
                .as_ref()
                .is_some_and(|h| !same_owner(&stored.owner_hash, h))
            {
                return Err(invalid("host approval owner mismatch"));
            }
        }
        let mut changed = Vec::new();
        for stored in self.records.values_mut() {
            if id.is_some_and(|id| id != stored.request.request_id)
                || hash
                    .as_ref()
                    .is_some_and(|h| !same_owner(&stored.owner_hash, h))
            {
                continue;
            }
            stored.request.state = HostApprovalState::Cancelled;
            stored.request.persistence = None;
            stored.request.resume_state = HostApprovalResumeState::Cancelled;
            changed.push(stored.request.clone());
        }
        Ok(changed)
    }
}
impl Session {
    pub(crate) fn reopen_host_approval_registration(&self) {
        self.host_approvals.lock().unwrap().closed = false;
    }
    pub(crate) fn pending_approval_count(&self) -> usize {
        self.host_approvals.lock().unwrap().pending_count()
    }
    pub(crate) fn has_host_approval_resume(&self) -> bool {
        self.host_approvals.lock().unwrap().has_resume()
    }
    pub(crate) fn list_host_approvals(&self, token: &str) -> Result<Vec<HostApprovalRecord>> {
        self.host_approvals.lock().unwrap().list(token)
    }
    pub(super) async fn restore_host_approvals(&self, history: &InitialHistory) -> Result<()> {
        // Forks never inherit receipts or wakeup reservations from their parent.
        if let InitialHistory::Resumed(h) = history {
            let items = if let Some(path) = self
                .current_rollout_path()
                .await
                .map_err(|e| invalid(&e.to_string()))?
            {
                let (items, id, errors) =
                    codex_rollout::RolloutRecorder::load_rollout_items(&path).await?;
                if id != Some(self.thread_id) || errors != 0 {
                    return Err(invalid("incomplete host approval history"));
                }
                items
            } else {
                h.history.as_ref().clone()
            };
            *self.host_approvals.lock().unwrap() =
                HostApprovals::from_history(self.thread_id, &items);
        }
        Ok(())
    }
    async fn commit_host_approvals(&self, next: HostApprovals) -> Result<()> {
        let current = self.host_approvals.lock().unwrap().clone();
        let updates: Vec<_> = next
            .records
            .iter()
            .filter(|(id, r)| current.records.get(*id) != Some(*r))
            .map(|(_, r)| r.clone())
            .collect();
        if updates.is_empty() {
            *self.host_approvals.lock().unwrap() = next;
            return Ok(());
        }
        if self.live_thread().is_none() {
            return Err(invalid("durable host approval storage unavailable"));
        }
        self.try_ensure_rollout_materialized(codex_thread_store::PersistContext::Standard)
            .await?;
        // Publish only after the append and durability barrier; never emit the private event.
        if !self
            .persist_rollout_items(&[RolloutItem::EventMsg(EventMsg::HostApprovalLedgerUpdated(
                HostApprovalLedgerEvent {
                    thread_id: self.thread_id,
                    updates,
                },
            ))])
            .await
        {
            return Err(invalid("failed to persist host approval ledger"));
        }
        self.flush_rollout().await?;
        *self.host_approvals.lock().unwrap() = next;
        self.notify_question_state_changed().await;
        Ok(())
    }
    pub(crate) async fn request_host_approval(
        &self,
        token: &str,
        id: String,
        scope: String,
        payload: serde_json::Value,
    ) -> Result<HostApprovalRecord> {
        let _guard = self.root_resume_submission_guard().await;
        let turn = self.state.lock().await.last_started_turn_id.clone();
        let root = self
            .state
            .lock()
            .await
            .turn_attribution
            .as_ref()
            .and_then(|a| a.root_turn_id.clone());
        let mut next = self.host_approvals.lock().unwrap().clone();
        let record = next.register(token, id, scope, payload, turn, root)?;
        self.commit_host_approvals(next).await?;
        Ok(record)
    }
    pub(crate) async fn resolve_host_approval(
        self: &Arc<Self>,
        token: &str,
        id: &str,
        scope: &str,
        decision: HostApprovalDecision,
        persistence: Option<HostApprovalPersistence>,
        resume: bool,
    ) -> Result<HostApprovalRecord> {
        {
            let _guard = self.root_resume_submission_guard().await;
            let mut next = self.host_approvals.lock().unwrap().clone();
            next.resolve(token, id, scope, decision, persistence, resume)?;
            self.commit_host_approvals(next).await?;
        }
        self.maybe_resume_host_approval().await?;
        self.list_host_approvals(token)?
            .into_iter()
            .find(|r| r.request_id == id)
            .ok_or_else(|| invalid("unknown host approval request"))
    }
    pub(crate) async fn defer_host_approval(
        self: &Arc<Self>,
        token: &str,
        id: &str,
        scope: &str,
    ) -> Result<HostApprovalRecord> {
        {
            let _guard = self.root_resume_submission_guard().await;
            let mut next = self.host_approvals.lock().unwrap().clone();
            next.defer(token, id, scope)?;
            self.commit_host_approvals(next).await?;
        }
        self.maybe_resume_host_approval().await?;
        self.list_host_approvals(token)?
            .into_iter()
            .find(|r| r.request_id == id)
            .ok_or_else(|| invalid("unknown host approval request"))
    }
    pub(crate) async fn withdraw_host_approvals(
        &self,
        token: Option<&str>,
        id: Option<&str>,
    ) -> Result<Vec<HostApprovalRecord>> {
        let _guard = self.root_resume_submission_guard().await;
        self.withdraw_host_approvals_locked(token, id).await
    }
    pub(crate) async fn withdraw_host_approvals_locked(
        &self,
        token: Option<&str>,
        id: Option<&str>,
    ) -> Result<Vec<HostApprovalRecord>> {
        let mut next = self.host_approvals.lock().unwrap().clone();
        let records = next.withdraw(token, id)?;
        if token.is_none() {
            next.closed = true;
        }
        self.commit_host_approvals(next).await?;
        Ok(records)
    }
    /// Post a typed wake without reacquiring a gate still held by the caller.
    pub(crate) fn schedule_host_approval_resume(self: &Arc<Self>) {
        if !self.has_host_approval_resume() {
            return;
        }
        let weak = Arc::downgrade(self);
        tokio::spawn(async move {
            if let Some(session) = weak.upgrade() {
                if let Err(error) = session.maybe_resume_host_approval().await {
                    tracing::warn!(%error, "scheduled host approval resume did not start");
                }
            }
        });
    }
    pub(crate) fn maybe_resume_host_approval(
        self: &Arc<Self>,
    ) -> futures::future::BoxFuture<'static, Result<()>> {
        let session = Arc::clone(self);
        Box::pin(async move {
            if session.state.lock().await.shutting_down || !session.has_host_approval_resume() {
                return Ok(());
            }
            let model = session.current_execution_model().await;
            if session.account_is_retired_for_model(&model)
                || session
                    .execution_admission_for_model(&model)
                    .requires_recovery()
            {
                return Ok(());
            }
            let _guard = session.root_resume_submission_guard().await;
            if session.state.lock().await.shutting_down
                || session.active_turn.lock().await.is_some()
                || session.has_root_resume_reservation()
                || session.parent_response_turn_is_deferred()
            {
                return Ok(());
            }
            let mut next = session.host_approvals.lock().unwrap().clone();
            if next
                .records
                .values()
                .any(|r| r.request.resume_state == HostApprovalResumeState::Claimed)
            {
                // A prior crash may have started that turn; preserve the recovery hold.
                return Ok(());
            }
            let Some(stored) = next.records.values_mut().find(|r| {
                r.request.resume_state == HostApprovalResumeState::Pending
                    && matches!(
                        r.request.state,
                        HostApprovalState::Accepted | HostApprovalState::Declined
                    )
            }) else {
                return Ok(());
            };
            stored.request.resume_state = HostApprovalResumeState::Claimed;
            stored.request.resume_turn_id = Some(uuid::Uuid::new_v4().to_string());
            let record = stored.request.clone();
            session.commit_host_approvals(next).await?;
            // A crash after the durable claim is ambiguous and never automatically retries.
            let result = super::turn_input::start_host_approval_resume(&session, &record).await;
            let mut next = session.host_approvals.lock().unwrap().clone();
            if let Some(stored) = next.records.get_mut(&record.request_id) {
                stored.request.resume_state = if matches!(
                    &result,
                    Ok(codex_protocol::turn_input::TurnInputSubmission::Started { .. })
                ) {
                    HostApprovalResumeState::Resumed
                } else {
                    HostApprovalResumeState::Pending
                };
                session.commit_host_approvals(next).await?;
            }
            result.map(|_| ())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture_thread_id() -> ThreadId {
        ThreadId::from_string("00000000-0000-4000-8000-000000000001").unwrap()
    }
    fn token() -> String {
        "a".repeat(64)
    }
    fn scope() -> String {
        "b".repeat(64)
    }
    fn create(ledger: &mut HostApprovals, id: &str) -> HostApprovalRecord {
        ledger.register(&token(), id.into(), scope(), serde_json::json!({"request": {"title": "Approval"}, "binding": {"task": "task-1"}}), Some("turn-1".into()), Some("root-1".into())).unwrap()
    }
    fn replay(ledger: &HostApprovals) -> HostApprovals {
        let items = vec![RolloutItem::EventMsg(EventMsg::HostApprovalLedgerUpdated(
            HostApprovalLedgerEvent {
                thread_id: fixture_thread_id(),
                updates: ledger.records.values().cloned().collect(),
            },
        ))];
        HostApprovals::from_history(
            fixture_thread_id(),
            &serde_json::from_str::<Vec<RolloutItem>>(&serde_json::to_string(&items).unwrap())
                .unwrap(),
        )
    }
    #[test]
    fn host_approval_fork_history_never_inherits_foreign_consent_or_wakeups() {
        let parent = fixture_thread_id();
        let child = ThreadId::new();
        let mut parent_ledger = HostApprovals::default();
        create(&mut parent_ledger, "host:pending");
        create(&mut parent_ledger, "host:accepted");
        parent_ledger
            .resolve(
                &token(),
                "host:accepted",
                &scope(),
                HostApprovalDecision::Accept,
                Some(HostApprovalPersistence::Session),
                true,
            )
            .unwrap();
        let foreign = RolloutItem::EventMsg(EventMsg::HostApprovalLedgerUpdated(
            HostApprovalLedgerEvent {
                thread_id: parent,
                updates: parent_ledger.records.values().cloned().collect(),
            },
        ));
        // Canonical copied and reference-backed history may expose ancestor records.
        let history: Vec<RolloutItem> =
            serde_json::from_str(&serde_json::to_string(&vec![foreign.clone()]).unwrap()).unwrap();
        let inherited = HostApprovals::from_history(child, &history);
        assert_eq!(inherited.pending_count(), 0);
        assert!(!inherited.has_resume());
        assert!(inherited.list(&token()).unwrap().is_empty());
        assert_eq!(
            HostApprovals::from_history(parent, &history)
                .list(&token())
                .unwrap()
                .len(),
            2
        );
        let mut child_ledger = HostApprovals::default();
        create(&mut child_ledger, "host:accepted");
        child_ledger.withdraw(Some(&token()), None).unwrap();
        let mut mixed = vec![RolloutItem::EventMsg(EventMsg::HostApprovalLedgerUpdated(
            HostApprovalLedgerEvent {
                thread_id: child,
                updates: child_ledger.records.values().cloned().collect(),
            },
        ))];
        mixed.push(foreign);
        let restored = HostApprovals::from_history(child, &mixed);
        assert_eq!(
            restored.list(&token()).unwrap()[0].state,
            HostApprovalState::Cancelled
        );
        assert!(!restored.has_resume());
    }
    #[test]
    fn host_approval_owner_scope_and_terminal_identity_are_enforced() {
        let mut ledger = HostApprovals::default();
        let original = create(&mut ledger, "host:1");
        assert_eq!(create(&mut ledger, "host:1"), original);
        assert!(ledger.list(&"c".repeat(64)).unwrap().is_empty());
        assert!(
            ledger
                .resolve(
                    &"c".repeat(64),
                    "host:1",
                    &scope(),
                    HostApprovalDecision::Accept,
                    Some(HostApprovalPersistence::Session),
                    false
                )
                .is_err()
        );
        assert!(
            ledger
                .resolve(
                    &token(),
                    "host:1",
                    &"c".repeat(64),
                    HostApprovalDecision::Accept,
                    Some(HostApprovalPersistence::Session),
                    false
                )
                .is_err()
        );
        assert!(
            ledger
                .resolve(
                    &token(),
                    "host:1",
                    &scope(),
                    HostApprovalDecision::Accept,
                    None,
                    false
                )
                .is_err()
        );
        ledger
            .resolve(
                &token(),
                "host:1",
                &scope(),
                HostApprovalDecision::Accept,
                Some(HostApprovalPersistence::Session),
                false,
            )
            .unwrap();
        assert!(
            ledger
                .resolve(
                    &token(),
                    "host:1",
                    &scope(),
                    HostApprovalDecision::Decline,
                    None,
                    false
                )
                .is_err()
        );
        assert!(
            ledger
                .resolve(
                    &token(),
                    "host:1",
                    &scope(),
                    HostApprovalDecision::Accept,
                    Some(HostApprovalPersistence::Always),
                    false
                )
                .is_err()
        );
        assert!(
            ledger
                .withdraw(Some(&"c".repeat(64)), Some("host:1"))
                .is_err()
        );
        ledger.withdraw(Some(&token()), Some("host:1")).unwrap();
        let mut restored = replay(&ledger);
        assert_eq!(
            restored.list(&token()).unwrap()[0].state,
            HostApprovalState::Cancelled
        );
        assert!(
            restored
                .register(
                    &token(),
                    "host:1".into(),
                    scope(),
                    original.payload,
                    None,
                    None
                )
                .is_err()
        );
        assert!(
            restored
                .resolve(
                    &token(),
                    "host:1",
                    &scope(),
                    HostApprovalDecision::Accept,
                    Some(HostApprovalPersistence::Session),
                    true
                )
                .is_err()
        );
        assert!(!restored.has_resume());
    }
    #[test]
    fn host_approval_defer_and_reply_race_survive_restore_in_both_orders() {
        for defer_first in [true, false] {
            let mut ledger = HostApprovals::default();
            create(&mut ledger, "host:1");
            if defer_first {
                ledger.defer(&token(), "host:1", &scope()).unwrap();
            }
            ledger
                .resolve(
                    &token(),
                    "host:1",
                    &scope(),
                    HostApprovalDecision::Accept,
                    Some(HostApprovalPersistence::Session),
                    false,
                )
                .unwrap();
            let mut restored = replay(&ledger);
            if !defer_first {
                restored.defer(&token(), "host:1", &scope()).unwrap();
            }
            restored.defer(&token(), "host:1", &scope()).unwrap();
            restored
                .resolve(
                    &token(),
                    "host:1",
                    &scope(),
                    HostApprovalDecision::Accept,
                    Some(HostApprovalPersistence::Session),
                    true,
                )
                .unwrap();
            let record = &restored.list(&token()).unwrap()[0];
            assert!(record.waiter_detached);
            assert_eq!(record.resume_state, HostApprovalResumeState::Pending);
            assert_eq!(restored.pending_count(), 0);
            assert_eq!(restored.records.len(), 1);
            assert!(restored.has_resume());
            restored
                .records
                .get_mut("host:1")
                .unwrap()
                .request
                .resume_state = HostApprovalResumeState::Resumed;
            restored.defer(&token(), "host:1", &scope()).unwrap();
            restored
                .resolve(
                    &token(),
                    "host:1",
                    &scope(),
                    HostApprovalDecision::Accept,
                    Some(HostApprovalPersistence::Session),
                    true,
                )
                .unwrap();
            assert!(!restored.has_resume());
        }
    }
    #[test]
    fn host_approval_fast_reply_does_not_resume_and_cancellation_revokes_receipts() {
        let mut ledger = HostApprovals::default();
        create(&mut ledger, "host:1");
        ledger
            .resolve(
                &token(),
                "host:1",
                &scope(),
                HostApprovalDecision::Decline,
                None,
                false,
            )
            .unwrap();
        assert!(!replay(&ledger).has_resume());
        ledger.defer(&token(), "host:1", &scope()).unwrap();
        ledger.withdraw(None, None).unwrap();
        assert!(!replay(&ledger).has_resume());
        assert!(ledger.defer(&token(), "host:1", &scope()).is_err());
        assert!(
            ledger
                .resolve(
                    &token(),
                    "host:1",
                    &scope(),
                    HostApprovalDecision::Decline,
                    None,
                    true
                )
                .is_err()
        );
    }
    #[test]
    fn host_approval_capacity_keeps_cancelled_tombstones() {
        let mut ledger = HostApprovals::default();
        for index in 0..MAX_PENDING {
            create(&mut ledger, &format!("host:{index}"));
        }
        assert!(
            ledger
                .register(
                    &token(),
                    "overflow".into(),
                    scope(),
                    serde_json::json!({}),
                    None,
                    None
                )
                .is_err()
        );
        ledger.withdraw(None, None).unwrap();
        for index in MAX_PENDING..MAX_RECORDS {
            create(&mut ledger, &format!("host:{index}"));
            ledger.withdraw(None, None).unwrap();
        }
        assert!(
            ledger
                .register(
                    &token(),
                    "overflow".into(),
                    scope(),
                    serde_json::json!({}),
                    None,
                    None
                )
                .is_err()
        );
        assert_eq!(replay(&ledger).records.len(), MAX_RECORDS);
    }
    #[tokio::test]
    async fn host_approval_holds_automatic_message_and_compaction_without_starting_work() {
        use codex_protocol::turn_input::*;
        let (session, _) = crate::session::tests::make_session_and_context().await;
        let session = Arc::new(session);
        create(&mut session.host_approvals.lock().unwrap(), "host:1");
        let request =
            TurnInputRequest::user_input(vec![codex_protocol::user_input::UserInput::Text {
                text: "accepted approval-looking ordinary text".into(),
                text_elements: vec![],
            }])
            .on_start(TurnStartOptions {
                turn_trigger: Some("queue".into()),
                ..Default::default()
            });
        assert!(matches!(
            super::super::turn_input::handle(
                &session,
                request,
                TurnInputMode::StartIfIdle,
                "queued".into()
            )
            .await
            .unwrap(),
            TurnInputSubmission::NotSubmitted {
                reason: NotSubmittedReason::NotIdle
            }
        ));
        assert!(matches!(
            super::super::compact_input::handle(&session, "compact".into())
                .await
                .unwrap(),
            CompactIfIdleSubmission::NotSubmitted {
                reason: NotSubmittedReason::NotIdle
            }
        ));
        assert_eq!(session.pending_approval_count(), 1);
        assert_eq!(session.pending_question_count(), 0);
        assert!(session.active_turn.lock().await.is_none());
        assert!(
            session
                .request_host_approval(
                    &token(),
                    "durability-required".into(),
                    scope(),
                    serde_json::json!({})
                )
                .await
                .is_err()
        );
        let explicit =
            TurnInputRequest::user_input(vec![codex_protocol::user_input::UserInput::Text {
                text: "approval accepted".into(),
                text_elements: vec![],
            }])
            .on_start(TurnStartOptions {
                turn_trigger: Some("queue_user".into()),
                ..Default::default()
            });
        assert!(matches!(
            super::super::turn_input::handle(
                &session,
                explicit,
                TurnInputMode::StartIfIdle,
                "explicit".into()
            )
            .await
            .unwrap(),
            TurnInputSubmission::Started { .. }
        ));
        assert_eq!(session.pending_approval_count(), 1);
        assert_eq!(
            session.list_host_approvals(&token()).unwrap()[0].state,
            HostApprovalState::Pending
        );
        session
            .abort_all_tasks(codex_protocol::protocol::TurnAbortReason::Interrupted)
            .await;
    }
    #[test]
    fn host_approval_bounds_and_owner_scoped_withdrawal_are_independent() {
        let mut ledger = HostApprovals::default();
        create(&mut ledger, "host:one");
        let other = "c".repeat(64);
        ledger
            .register(
                &other,
                "host:two".into(),
                scope(),
                serde_json::json!({}),
                None,
                None,
            )
            .unwrap();
        assert_eq!(ledger.pending_count(), 2);
        assert_eq!(ledger.withdraw(Some(&token()), None).unwrap().len(), 1);
        assert_eq!(ledger.pending_count(), 1);
        assert_eq!(
            ledger.list(&other).unwrap()[0].state,
            HostApprovalState::Pending
        );
        assert!(
            ledger
                .register(
                    &token(),
                    "x".repeat(129),
                    scope(),
                    serde_json::json!({}),
                    None,
                    None
                )
                .is_err()
        );
        assert!(
            ledger
                .register(
                    &token(),
                    "bad-scope".into(),
                    "B".repeat(64),
                    serde_json::json!({}),
                    None,
                    None
                )
                .is_err()
        );
        assert!(
            ledger
                .register(
                    "bad-token",
                    "bad-owner".into(),
                    scope(),
                    serde_json::json!({}),
                    None,
                    None
                )
                .is_err()
        );
        assert!(
            ledger
                .register(
                    &token(),
                    "big".into(),
                    scope(),
                    serde_json::json!({"data": "x".repeat(MAX_PAYLOAD_BYTES)}),
                    None,
                    None
                )
                .is_err()
        );
        assert!(
            ledger
                .register(
                    &token(),
                    "array".into(),
                    scope(),
                    serde_json::json!([]),
                    None,
                    None
                )
                .is_err()
        );
    }

    async fn persistent(
        home: &std::path::Path,
        history: InitialHistory,
        mode: codex_protocol::protocol::ThreadHistoryMode,
    ) -> Arc<Session> {
        crate::session::tests::make_persistent_session_and_context_with_time_provider_and_history_mode_and_rx(home, history, Arc::new(crate::current_time::SystemTimeProvider), "http://127.0.0.1:1/v1".into(), mode).await.unwrap().0
    }
    #[tokio::test]
    async fn host_approval_real_rollout_restart_preserves_receipts_and_explicit_stop_revokes() {
        use codex_protocol::protocol::{ThreadHistoryMode, TurnAbortReason};
        for mode in [ThreadHistoryMode::Legacy, ThreadHistoryMode::Paginated] {
            let home = tempfile::tempdir().unwrap();
            let session = persistent(home.path(), InitialHistory::New, mode).await;
            session.record_started_turn("original", None).await;
            for id in ["host:accepted", "host:pending"] {
                session
                    .request_host_approval(&token(), id.into(), scope(), serde_json::json!({}))
                    .await
                    .unwrap();
            }
            session
                .resolve_host_approval(
                    &token(),
                    "host:accepted",
                    &scope(),
                    HostApprovalDecision::Accept,
                    Some(HostApprovalPersistence::Session),
                    false,
                )
                .await
                .unwrap();
            // This is the task teardown used by ordinary runtime shutdown, not an explicit Stop.
            session.abort_all_tasks(TurnAbortReason::Interrupted).await;
            assert_eq!(session.pending_approval_count(), 1);
            let path = session.current_rollout_path().await.unwrap().unwrap();
            let (items, _, errors) = codex_rollout::RolloutRecorder::load_rollout_items(&path)
                .await
                .unwrap();
            assert_eq!(errors, 0);
            assert_eq!(
                crate::CodexThread::pending_approval_count_from_history(session.thread_id, &items),
                1
            );
            assert_eq!(
                crate::CodexThread::host_approvals_from_history(
                    session.thread_id,
                    &items,
                    &token()
                )
                .unwrap()
                .len(),
                2
            );
            assert_eq!(
                session
                    .list_host_approvals(&token())
                    .unwrap()
                    .iter()
                    .find(|r| r.request_id == "host:accepted")
                    .unwrap()
                    .state,
                HostApprovalState::Accepted
            );
            let thread_id = session.thread_id;
            session.live_thread().unwrap().shutdown().await.unwrap();
            drop(session);
            let history = || {
                InitialHistory::Resumed(codex_history::ResumedHistory {
                    conversation_id: thread_id,
                    history: Arc::new(Vec::new()),
                    history_revision: None,
                    rollout_path: None,
                })
            };
            let resumed = persistent(home.path(), history(), mode).await;
            assert_eq!(resumed.pending_approval_count(), 1);
            assert!(resumed.active_turn.lock().await.is_none());
            assert_eq!(
                resumed
                    .list_host_approvals(&token())
                    .unwrap()
                    .iter()
                    .find(|r| r.request_id == "host:accepted")
                    .unwrap()
                    .state,
                HostApprovalState::Accepted
            );
            tokio::time::timeout(std::time::Duration::from_secs(5), resumed.interrupt_task())
                .await
                .expect("explicit stop must not reacquire its admission gate");
            assert_eq!(resumed.pending_approval_count(), 0);
            assert!(
                resumed
                    .list_host_approvals(&token())
                    .unwrap()
                    .iter()
                    .all(|r| r.state == HostApprovalState::Cancelled)
            );
            resumed.live_thread().unwrap().shutdown().await.unwrap();
            drop(resumed);
            let restored = persistent(home.path(), history(), mode).await;
            assert!(
                restored
                    .list_host_approvals(&token())
                    .unwrap()
                    .iter()
                    .all(|r| r.state == HostApprovalState::Cancelled)
            );
            assert!(
                restored
                    .resolve_host_approval(
                        &token(),
                        "host:accepted",
                        &scope(),
                        HostApprovalDecision::Accept,
                        Some(HostApprovalPersistence::Session),
                        true
                    )
                    .await
                    .is_err()
            );
            assert!(restored.active_turn.lock().await.is_none());
            restored.live_thread().unwrap().shutdown().await.unwrap();
        }
    }
    #[tokio::test]
    async fn host_approval_copied_fork_and_cold_restore_keep_their_own_ledger() {
        use codex_history::ResumedHistory;
        use codex_protocol::protocol::ThreadHistoryMode;
        for mode in [ThreadHistoryMode::Legacy, ThreadHistoryMode::Paginated] {
            let home = tempfile::tempdir().unwrap();
            let parent = persistent(home.path(), InitialHistory::New, mode).await;
            parent
                .request_host_approval(
                    &token(),
                    "host:parent".into(),
                    scope(),
                    serde_json::json!({}),
                )
                .await
                .unwrap();
            let parent_path = parent.current_rollout_path().await.unwrap().unwrap();
            let (history, _, errors) =
                codex_rollout::RolloutRecorder::load_rollout_items(&parent_path)
                    .await
                    .unwrap();
            assert_eq!(errors, 0);
            let child = persistent(home.path(), InitialHistory::Forked(history), mode).await;
            assert_ne!(child.thread_id, parent.thread_id);
            assert_eq!(child.pending_approval_count(), 0);
            assert!(child.list_host_approvals(&token()).unwrap().is_empty());
            let child_id = child.thread_id;
            let child_path = child.current_rollout_path().await.unwrap().unwrap();
            child.live_thread().unwrap().shutdown().await.unwrap();
            let (history, id, errors) =
                codex_rollout::RolloutRecorder::load_rollout_items(&child_path)
                    .await
                    .unwrap();
            assert_eq!(id, Some(child_id));
            assert_eq!(errors, 0);
            assert!(history.iter().any(|item| matches!(
                item,
                RolloutItem::EventMsg(EventMsg::HostApprovalLedgerUpdated(_))
            )));
            let child = persistent(
                home.path(),
                InitialHistory::Resumed(ResumedHistory {
                    history_revision: None,
                    conversation_id: child_id,
                    history: Arc::new(history),
                    rollout_path: Some(child_path),
                }),
                mode,
            )
            .await;
            assert_eq!(child.pending_approval_count(), 0);
            assert!(!child.has_host_approval_resume());
            assert!(child.list_host_approvals(&token()).unwrap().is_empty());
            child.live_thread().unwrap().shutdown().await.unwrap();
            parent.live_thread().unwrap().shutdown().await.unwrap();
        }
    }
    #[tokio::test]
    async fn host_approval_retirement_clear_wakes_one_idle_decision() {
        use core_test_support::responses::{
            ev_completed, ev_response_created, mount_sse_once, sse, start_mock_server,
        };
        use futures::FutureExt;
        use std::sync::atomic::Ordering;
        let server = start_mock_server().await;
        let requests = mount_sse_once(
            &server,
            sse(vec![
                ev_response_created("approval-retired"),
                ev_completed("approval-retired"),
            ]),
        )
        .await;
        let home = tempfile::tempdir().unwrap();
        let (session, _, events) =
            crate::session::tests::make_persistent_session_and_context_with_time_provider_and_rx(
                home.path(),
                InitialHistory::New,
                Arc::new(crate::current_time::SystemTimeProvider),
                format!("{}/v1", server.uri()),
            )
            .await
            .unwrap();
        let configured = loop {
            if let EventMsg::SessionConfigured(configured) = events.recv().await.unwrap().msg {
                break configured;
            }
        };
        let (tx_sub, _rx_sub) = async_channel::unbounded();
        let thread = crate::CodexThread::new(
            Arc::clone(&session),
            super::super::SessionIo {
                tx_sub,
                rx_event: events.clone(),
                agent_status: session.agent_status.subscribe(),
                session_loop_termination: async {}.boxed().shared(),
            },
            crate::ThreadStartupMetadata::from(&configured),
            None,
            codex_protocol::protocol::SessionSource::Exec,
        );
        *session.retired_provider.lock().unwrap() = Some("openai".into());
        session.account_retired.store(true, Ordering::Release);
        session
            .request_host_approval(
                &token(),
                "host:retired".into(),
                scope(),
                serde_json::json!({}),
            )
            .await
            .unwrap();
        let pending = session
            .resolve_host_approval(
                &token(),
                "host:retired",
                &scope(),
                HostApprovalDecision::Decline,
                None,
                true,
            )
            .await
            .unwrap();
        assert_eq!(pending.resume_state, HostApprovalResumeState::Pending);
        assert!(session.active_turn.lock().await.is_none());
        thread.clear_native_account_retirement();
        let complete = tokio::time::timeout(std::time::Duration::from_secs(15), async {
            loop {
                if let EventMsg::TurnComplete(event) = events.recv().await.unwrap().msg {
                    break event;
                }
            }
        })
        .await
        .unwrap();
        let record = session
            .list_host_approvals(&token())
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(record.resume_state, HostApprovalResumeState::Resumed);
        assert_eq!(
            record.resume_turn_id.as_deref(),
            Some(complete.turn_id.as_str())
        );
        thread.clear_native_account_retirement();
        session.maybe_resume_host_approval().await.unwrap();
        assert_eq!(requests.requests().len(), 1);
        session.live_thread().unwrap().shutdown().await.unwrap();
    }
    #[tokio::test]
    async fn host_approval_active_decision_waits_and_idle_dispatch_claims_once() {
        let home = tempfile::tempdir().unwrap();
        let session = persistent(
            home.path(),
            InitialHistory::New,
            codex_protocol::protocol::ThreadHistoryMode::Paginated,
        )
        .await;
        session.record_started_turn("original", None).await;
        *session.active_turn.lock().await = Some(crate::state::ActiveTurn::default());
        session
            .request_host_approval(
                &token(),
                "host:deferred".into(),
                scope(),
                serde_json::json!({}),
            )
            .await
            .unwrap();
        session
            .defer_host_approval(&token(), "host:deferred", &scope())
            .await
            .unwrap();
        let first = session
            .resolve_host_approval(
                &token(),
                "host:deferred",
                &scope(),
                HostApprovalDecision::Decline,
                None,
                false,
            )
            .await
            .unwrap();
        assert_eq!(first.resume_state, HostApprovalResumeState::Pending);
        assert!(
            session
                .active_turn
                .lock()
                .await
                .as_ref()
                .unwrap()
                .task
                .is_none()
        );
        assert_eq!(
            session.state.lock().await.last_started_turn_id.as_deref(),
            Some("original")
        );
        *session.active_turn.lock().await = None;
        session.maybe_resume_host_approval().await.unwrap();
        let dispatched = session
            .list_host_approvals(&token())
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(dispatched.resume_state, HostApprovalResumeState::Resumed);
        let resumed_turn = dispatched.resume_turn_id.unwrap();
        assert_eq!(
            session.state.lock().await.last_started_turn_id.as_deref(),
            Some(resumed_turn.as_str())
        );
        assert_eq!(
            session
                .state
                .lock()
                .await
                .turn_attribution
                .as_ref()
                .unwrap()
                .turn_trigger
                .as_deref(),
            Some("approval_decision")
        );
        session
            .resolve_host_approval(
                &token(),
                "host:deferred",
                &scope(),
                HostApprovalDecision::Decline,
                None,
                true,
            )
            .await
            .unwrap();
        session.maybe_resume_host_approval().await.unwrap();
        assert_eq!(
            session.state.lock().await.last_started_turn_id.as_deref(),
            Some(resumed_turn.as_str())
        );
        session.interrupt_task().await;
        session.live_thread().unwrap().shutdown().await.unwrap();
    }
}

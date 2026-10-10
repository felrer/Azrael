//! Durable custody between accepting a local submission and flushing ordinary history.
use std::collections::BTreeMap;
use std::sync::Arc;

use codex_history::RolloutItem;
use codex_history::UserInputOrigin;
use codex_protocol::error::CodexErr;
use codex_protocol::error::Result;
use codex_protocol::items::TurnItem;
use codex_protocol::items::UserMessageItem;
use codex_protocol::models::ResponseItem;
use codex_protocol::models::snapshot_local_user_input;
use codex_protocol::protocol::AdditionalContextEntry;
use codex_protocol::protocol::AdditionalContextKind;
use codex_protocol::protocol::Event;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::ItemCompletedEvent;
use codex_protocol::protocol::ItemStartedEvent;
use codex_protocol::turn_input::TurnInput as SubmittedTurnInput;
use codex_protocol::user_input::UserInput;
use codex_state::AcceptUserInputOutcome;
use codex_thread_store::LocalThreadStore;
use codex_thread_store::PersistContext;
use serde::Deserialize;
use serde::Serialize;
use sha2::Digest;
use sha2::Sha256;
use tracing::error;

use super::Session;
use super::TurnInput;
use super::UserInputMetadata;

#[derive(Serialize, Deserialize)]
struct AcceptedPayload {
    content: Vec<UserInput>,
    #[serde(with = "accepted_context")]
    additional_context: BTreeMap<String, AdditionalContextEntry>,
    origin: UserInputOrigin,
}

// The protocol submission context is an in-process type without serde. Keep its
// lossless storage representation private rather than changing the public schema.
mod accepted_context {
    use super::*;
    #[derive(Serialize, Deserialize)]
    struct Entry {
        value: String,
        kind: Kind,
    }
    #[derive(Serialize, Deserialize)]
    enum Kind {
        Untrusted,
        Application,
    }

    pub(super) fn serialize<S: serde::Serializer>(
        context: &BTreeMap<String, AdditionalContextEntry>,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        let entries: BTreeMap<_, _> = context
            .iter()
            .map(|(key, entry)| {
                let kind = match entry.kind {
                    AdditionalContextKind::Untrusted => Kind::Untrusted,
                    AdditionalContextKind::Application => Kind::Application,
                };
                (
                    key,
                    Entry {
                        value: entry.value.clone(),
                        kind,
                    },
                )
            })
            .collect();
        entries.serialize(serializer)
    }

    pub(super) fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<BTreeMap<String, AdditionalContextEntry>, D::Error> {
        Ok(BTreeMap::<String, Entry>::deserialize(deserializer)?
            .into_iter()
            .map(|(key, entry)| {
                let kind = match entry.kind {
                    Kind::Untrusted => AdditionalContextKind::Untrusted,
                    Kind::Application => AdditionalContextKind::Application,
                };
                (
                    key,
                    AdditionalContextEntry {
                        value: entry.value,
                        kind,
                    },
                )
            })
            .collect())
    }
}

fn storage_error(error: impl std::fmt::Display) -> CodexErr {
    CodexErr::Io(std::io::Error::other(format!(
        "accepted input storage: {error}"
    )))
}

impl Session {
    pub(crate) fn journals_user_input(&self) -> bool {
        self.live_thread().is_some() && self.services.thread_store.as_any().is::<LocalThreadStore>()
    }

    #[cfg(test)]
    pub(super) async fn accepted_input_retry(
        &self,
        input: &mut SubmittedTurnInput,
        context: &BTreeMap<String, AdditionalContextEntry>,
        origin: UserInputOrigin,
    ) -> Result<Option<String>> {
        Ok(self
            .accepted_input_receipt(input, context, origin)
            .await?
            .map(|receipt| receipt.turn_id))
    }

    pub(super) async fn accepted_input_retry_with_root(
        &self,
        input: &mut SubmittedTurnInput,
        context: &BTreeMap<String, AdditionalContextEntry>,
        origin: UserInputOrigin,
    ) -> Result<Option<(String, String)>> {
        let Some(receipt) = self.accepted_input_receipt(input, context, origin).await? else {
            return Ok(None);
        };
        let root = match receipt.root_turn_id {
            Some(root) => root,
            None => {
                // Historical receipts predate causal-root storage. Only canonical attribution
                // may recover their root; never infer it from a caller's retry settings.
                self.flush_rollout().await.map_err(storage_error)?;
                let live_thread = self
                    .live_thread()
                    .ok_or_else(|| storage_error("accepted input has no live canonical thread"))?;
                let items = if let Some(path) = live_thread
                    .local_rollout_path()
                    .await
                    .map_err(storage_error)?
                {
                    let (items, _, _) = codex_rollout::RolloutRecorder::load_rollout_items(&path)
                        .await
                        .map_err(|error| {
                            if error.kind() == std::io::ErrorKind::NotFound {
                                storage_error(
                                    "historical accepted input has no authoritative causal root",
                                )
                            } else {
                                storage_error(error)
                            }
                        })?;
                    items
                } else {
                    // A local thread without a materialized canonical rollout has no
                    // authoritative attribution to inspect. Its paginated store deliberately
                    // does not implement the legacy load_history API.
                    return Err(storage_error(
                        "no authoritative causal root for accepted input",
                    ));
                };
                let mut root = None;
                for item in items {
                    let candidate = match item {
                        codex_history::RolloutItem::TurnContext(context)
                            if context.turn_id.as_deref() == Some(receipt.turn_id.as_str()) =>
                        {
                            context.root_turn_id
                        }
                        codex_history::RolloutItem::EventMsg(
                            codex_protocol::protocol::EventMsg::TurnStarted(event),
                        ) if event.turn_id == receipt.turn_id => event.root_turn_id,
                        codex_history::RolloutItem::EventMsg(
                            codex_protocol::protocol::EventMsg::TurnComplete(event),
                        ) if event.turn_id == receipt.turn_id => event.root_turn_id,
                        _ => None,
                    };
                    if let Some(candidate) = candidate {
                        if root.as_ref().is_some_and(|known| known != &candidate) {
                            return Err(storage_error(
                                "conflicting canonical causal roots for accepted input",
                            ));
                        }
                        root = Some(candidate);
                    }
                }
                root.ok_or_else(|| {
                    storage_error("historical accepted input has no authoritative causal root")
                })?
            }
        };
        Ok(Some((receipt.turn_id, root)))
    }

    #[cfg(test)]
    pub(super) async fn journal_user_input(
        &self,
        input: &SubmittedTurnInput,
        context: &BTreeMap<String, AdditionalContextEntry>,
        turn_id: &str,
        origin: UserInputOrigin,
    ) -> Result<Option<u64>> {
        self.journal_user_input_with_root(input, context, turn_id, turn_id, origin)
            .await
    }

    async fn accepted_input_receipt(
        &self,
        input: &mut SubmittedTurnInput,
        additional_context: &BTreeMap<String, AdditionalContextEntry>,
        origin: UserInputOrigin,
    ) -> Result<Option<codex_state::AcceptedUserInputRecord>> {
        if !self.journals_user_input() {
            return Ok(None);
        }
        let SubmittedTurnInput::UserInput { content, client_id } = input else {
            return Ok(None);
        };
        if content.is_empty() {
            return Ok(None);
        }
        for item in content.iter_mut() {
            snapshot_local_user_input(item)?;
        }
        let db = self
            .state_db()
            .ok_or_else(|| storage_error("persistent local session has no state database"))?;
        if let Some(client_id) = client_id
            && let Some(receipt) = db
                .thread_queue()
                .user_input_receipt(self.thread_id, client_id)
                .await
                .map_err(storage_error)?
        {
            let payload = AcceptedPayload {
                content: content.clone(),
                additional_context: additional_context.clone(),
                origin,
            };
            let json = serde_json::to_string(&payload).map_err(storage_error)?;
            if receipt.payload_sha256 != format!("{:x}", Sha256::digest(json.as_bytes())) {
                return Err(CodexErr::InvalidRequest(
                    "client input ID was already accepted with a different payload".into(),
                ));
            }
            return Ok(Some(receipt));
        }
        Ok(None)
    }

    pub(super) async fn journal_user_input_with_root(
        &self,
        input: &SubmittedTurnInput,
        additional_context: &BTreeMap<String, AdditionalContextEntry>,
        turn_id: &str,
        root_turn_id: &str,
        origin: UserInputOrigin,
    ) -> Result<Option<u64>> {
        let SubmittedTurnInput::UserInput { content, client_id } = input else {
            return Ok(None);
        };
        if content.is_empty() {
            return Ok(None);
        }
        let order = self.reserve_user_input_order().await;
        if self.journals_user_input() {
            let db = self
                .state_db()
                .ok_or_else(|| storage_error("persistent local session has no state database"))?;
            let payload = AcceptedPayload {
                content: content.clone(),
                additional_context: additional_context.clone(),
                origin,
            };
            let json = serde_json::to_string(&payload).map_err(storage_error)?;
            let digest = format!("{:x}", Sha256::digest(json.as_bytes()));
            match db
                .thread_queue()
                .accept_user_input_with_root(
                    self.thread_id,
                    client_id.as_deref(),
                    turn_id,
                    Some(root_turn_id),
                    order,
                    &json,
                    &digest,
                )
                .await
                .map_err(storage_error)?
            {
                AcceptUserInputOutcome::Added(_) => {}
                AcceptUserInputOutcome::Existing(_) => {
                    return Err(storage_error("concurrent duplicate input submission"));
                }
            }
        }
        Ok(Some(order))
    }

    /// Persist both history API representations with checked writes before retiring custody.
    pub(super) async fn persist_accepted_user_message_events(
        &self,
        turn_id: &str,
        item: UserMessageItem,
        recorded: &[RolloutItem],
        context: PersistContext,
    ) -> bool {
        let matches_item = |candidate: &TurnItem| {
            matches!(candidate, TurnItem::UserMessage(candidate)
            if candidate.client_id == item.client_id && candidate.content == item.content)
        };
        let completed = recorded.iter().find_map(|entry| match entry {
            RolloutItem::EventMsg(EventMsg::ItemCompleted(event))
                if event.turn_id == turn_id && matches_item(&event.item) =>
            {
                Some(event)
            }
            _ => None,
        });
        let started = recorded.iter().find_map(|entry| match entry {
            RolloutItem::EventMsg(EventMsg::ItemStarted(event))
                if event.turn_id == turn_id && matches_item(&event.item) =>
            {
                Some(event)
            }
            _ => None,
        });
        let legacy = item.as_legacy_event();
        let legacy_recorded = recorded.iter().any(|entry| matches!((entry, &legacy),
            (RolloutItem::EventMsg(EventMsg::UserMessage(candidate)), EventMsg::UserMessage(expected)) if candidate == expected));
        let now = super::now_unix_timestamp_ms();
        let canonical = completed
            .map(|event| event.item.clone())
            .or_else(|| started.map(|event| event.item.clone()))
            .unwrap_or(TurnItem::UserMessage(item));
        let mut events = Vec::new();
        if started.is_none() && completed.is_none() {
            events.push(EventMsg::ItemStarted(ItemStartedEvent {
                thread_id: self.thread_id,
                turn_id: turn_id.to_owned(),
                item: canonical.clone(),
                started_at_ms: now,
            }));
        }
        if completed.is_none() {
            events.push(EventMsg::ItemCompleted(ItemCompletedEvent {
                thread_id: self.thread_id,
                turn_id: turn_id.to_owned(),
                item: canonical,
                started_at_ms: Some(started.map_or(now, |event| event.started_at_ms)),
                completed_at_ms: now,
            }));
        }
        if !legacy_recorded {
            events.push(legacy);
        }
        if events.is_empty() {
            return true;
        }
        let rollout = events
            .iter()
            .cloned()
            .map(RolloutItem::EventMsg)
            .collect::<Vec<_>>();
        if !self.persist_rollout_items(&rollout).await {
            return false;
        }
        if let Err(error) = self.try_ensure_rollout_materialized(context).await {
            error!(%error, "failed to materialize canonical user-message events");
            return false;
        }
        if let Err(error) = self.flush_rollout().await {
            error!(%error, "failed to flush canonical user-message events");
            return false;
        }
        for msg in events {
            self.send_event_raw_with_persistence(
                Event {
                    id: turn_id.to_owned(),
                    msg,
                },
                /*persist*/ false,
            )
            .await;
        }
        true
    }

    pub(super) async fn retire_accepted_user_input(&self, order: Option<u64>) -> bool {
        if !self.journals_user_input() {
            return true;
        }
        let Some(order) = order else {
            return true;
        };
        let Some(db) = self.state_db() else {
            return false;
        };
        let result = async {
            for receipt in db
                .thread_queue()
                .pending_user_inputs(self.thread_id)
                .await?
            {
                if receipt.acceptance_order == order {
                    db.thread_queue()
                        .consume_user_input(self.thread_id, &receipt.receipt_id)
                        .await?;
                }
            }
            Ok::<_, anyhow::Error>(())
        }
        .await;
        if let Err(error) = result {
            error!(%error, "failed to retire accepted input");
            return false;
        }
        true
    }

    pub(super) async fn reconcile_accepted_user_inputs(&self, rollout: &[RolloutItem]) -> bool {
        if !self.journals_user_input() {
            return true;
        }
        let Some(db) = self.state_db() else {
            return false;
        };
        let result = async {
            let pending = db
                .thread_queue()
                .pending_user_inputs(self.thread_id)
                .await?;
            for receipt in pending {
                if let Some(index) = rollout.iter().position(|item| recorded_receipt(item, &receipt.turn_id, receipt.acceptance_order)) {
                    let payload: AcceptedPayload = serde_json::from_str(receipt.payload_json.as_deref().ok_or_else(|| anyhow::anyhow!("pending input has no payload"))?)?;
                    let RolloutItem::ResponseItem(envelope) = &rollout[index] else { unreachable!() };
                    let mut image_positions = std::collections::HashMap::new();
                    self.response_item_from_user_input_with_image_positions(payload.content.clone(), &mut image_positions);
                    let mut canonical = UserMessageItem::new(&payload.content);
                    canonical.client_id = receipt.client_id.clone();
                    super::apply_prepared_image_file_ids(&mut canonical, std::slice::from_ref(envelope), &image_positions);
                    // A raw user item's order identifies its event interval even without a
                    // client ID, and distinguishes repeated identical no-ID submissions.
                    let end = rollout[index + 1..].iter().position(|item| matches!(item,
                        RolloutItem::ResponseItem(envelope) if envelope.metadata.as_ref().and_then(|metadata| metadata.user_input_order).is_some() && matches!(&envelope.item, ResponseItem::Message { role, .. } if role == "user")))
                        .map_or(rollout.len(), |offset| index + 1 + offset);
                    if !self.persist_accepted_user_message_events(&receipt.turn_id, canonical, &rollout[index + 1..end], PersistContext::Standard).await {
                        anyhow::bail!("canonical user-message repair failed");
                    }
                    db.thread_queue().consume_user_input(self.thread_id, &receipt.receipt_id).await?;
                }
            }
            Ok::<_, anyhow::Error>(())
        }
        .await;
        if let Err(error) = result {
            error!(%error, "failed to reconcile accepted inputs");
            return false;
        }
        true
    }

    /// Explicit warm resume records idle receipts; it never drains an active turn.
    pub(crate) async fn recover_accepted_user_inputs_on_resume(self: &Arc<Self>) -> Result<()> {
        if !self.journals_user_input() {
            return Ok(());
        }
        let _admission = self.root_resume_submission_guard().await;
        let turn_state = {
            let mut active = self.active_turn.lock().await;
            if active.is_some() {
                return Ok(());
            }
            let turn = active.get_or_insert_with(crate::state::ActiveTurn::default);
            Arc::clone(&turn.turn_state)
        };
        // Reserve idle admission without holding the active lock while hooks run.
        let result = async {
            let db = self
                .state_db()
                .ok_or_else(|| storage_error("persistent local session has no state database"))?;
            let pending = db
                .thread_queue()
                .pending_user_inputs(self.thread_id)
                .await
                .map_err(storage_error)?;
            if pending.is_empty() {
                return Ok(());
            }
            self.try_ensure_rollout_materialized(PersistContext::Standard)
                .await?;
            self.flush_rollout().await?;
            let rollout_path = self
                .live_thread()
                .ok_or_else(|| storage_error("live thread unavailable"))?
                .local_rollout_path()
                .await
                .map_err(storage_error)?
                .ok_or_else(|| storage_error("local rollout path unavailable"))?;
            // Paginated local threads reject legacy load_history. Read the
            // flushed recorder directly, as in provider-handoff reconciliation.
            let (history, thread_id, parse_errors) =
                codex_rollout::RolloutRecorder::load_rollout_items(&rollout_path)
                    .await
                    .map_err(storage_error)?;
            if thread_id != Some(self.thread_id) || parse_errors != 0 {
                return Err(storage_error(
                    "incomplete or mismatched rollout; receipts retained",
                ));
            }
            // Failed appends can leave a user only in memory. Restore persisted
            // history in that specific case before recording its still-owned receipt.
            let memory = self.clone_history().await;
            let has_unpersisted_user = pending.iter().any(|receipt| {
                !history
                    .iter()
                    .any(|item| recorded_receipt(item, &receipt.turn_id, receipt.acceptance_order))
                    && memory.annotated_items().iter().any(|item| {
                        recorded_user_envelope(item, &receipt.turn_id, receipt.acceptance_order)
                    })
            });
            if has_unpersisted_user {
                let context = self.new_inject_items_context().await;
                self.apply_rollout_reconstruction(&context, &history).await;
            }
            if !self.reconcile_accepted_user_inputs(&history).await {
                return Err(storage_error(
                    "warm resume reconciliation failed; receipts retained",
                ));
            }
            if !self.recover_accepted_user_inputs().await {
                return Err(storage_error(
                    "warm resume recovery failed; receipts retained",
                ));
            }
            Ok(())
        }
        .await;
        self.clear_reserved_idle_turn(&turn_state).await;
        result
    }

    pub(super) async fn recover_accepted_user_inputs(self: &Arc<Self>) -> bool {
        if !self.journals_user_input() {
            return true;
        }
        let Some(db) = self.state_db() else {
            return false;
        };
        let result = async {
            if let Some(order) = db
                .thread_queue()
                .max_user_input_order(self.thread_id)
                .await?
            {
                self.state
                    .lock()
                    .await
                    .history
                    .ensure_input_order_floor(order.saturating_add(1));
            }
            for receipt in db
                .thread_queue()
                .pending_user_inputs(self.thread_id)
                .await?
            {
                let payload: AcceptedPayload = serde_json::from_str(
                    receipt
                        .payload_json
                        .as_deref()
                        .ok_or_else(|| anyhow::anyhow!("pending input has no payload"))?,
                )?;
                let context = self.new_accepted_input_context(receipt.turn_id).await;
                let input = TurnInput::UserInput {
                    content: payload.content,
                    client_id: receipt.client_id,
                    metadata: UserInputMetadata {
                        acceptance_order: Some(receipt.acceptance_order),
                        origin: payload.origin,
                    },
                };
                let hook = crate::hook_runtime::inspect_pending_input(self, &context, &input).await;
                if hook.should_stop {
                    continue;
                }
                let extra = super::turn_input::merge_additional_context_input(
                    self,
                    payload.additional_context,
                )
                .await;
                for item in extra {
                    if !crate::hook_runtime::record_pending_input(
                        self,
                        &context,
                        context.model_info(),
                        item,
                        Vec::new(),
                        PersistContext::Standard,
                    )
                    .await
                    {
                        anyhow::bail!("recovered context persistence failed");
                    }
                }
                if !crate::hook_runtime::record_pending_input(
                    self,
                    &context,
                    context.model_info(),
                    input,
                    hook.additional_contexts,
                    PersistContext::Standard,
                )
                .await
                {
                    anyhow::bail!("recovered user input persistence failed");
                }
            }
            Ok::<_, anyhow::Error>(())
        }
        .await;
        if let Err(error) = result {
            error!(%error, "failed to recover accepted inputs; receipts retained");
            return false;
        }
        true
    }
}

fn recorded_receipt(item: &RolloutItem, turn_id: &str, order: u64) -> bool {
    let RolloutItem::ResponseItem(envelope) = item else {
        return false;
    };
    recorded_user_envelope(envelope, turn_id, order)
}

fn recorded_user_envelope(
    envelope: &codex_history::ResponseItemEnvelope,
    turn_id: &str,
    order: u64,
) -> bool {
    matches!(&envelope.item, ResponseItem::Message { role, internal_chat_message_metadata_passthrough: Some(metadata), .. }
        if role == "user" && metadata.turn_id.as_deref() == Some(turn_id))
        && envelope
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.user_input_order)
            == Some(order)
}

#[cfg(test)]
#[path = "accepted_user_inputs_tests.rs"]
mod tests;

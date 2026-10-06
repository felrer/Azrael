//! Root-only parking. Timers and child status watches never invoke a model.
use super::Session;
use super::TurnContext;
use super::input_queue::InputQueueActivity;
use super::input_queue::TurnInput;
use super::turn_context::NewTurnContextOptions;
use crate::state::ActiveTurn;
use crate::tasks::RegularTask;
use codex_protocol::error::CodexErr;
use codex_protocol::error::Result as CodexResult;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::TurnAbortReason;
use codex_protocol::protocol::TurnAbortedEvent;
use codex_protocol::protocol::TurnDeferredEvent;
use codex_protocol::root_resume::RootResumeReservation;
use codex_protocol::root_resume::RootResumeState;
use codex_protocol::root_resume::RootResumeWakeReason;
use futures::future::BoxFuture;
use std::collections::HashSet;
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::sync::Notify;
use tokio::sync::OwnedMutexGuard;
use tokio_util::sync::CancellationToken;

const MAX_DELAY_MS: u64 = 43_200_000;

#[derive(Default)]
struct RootResumeControl {
    gate: Arc<Mutex<()>>,
    record: StdMutex<Option<RootResumeReservation>>,
    deferred_turn: StdMutex<Option<String>>,
    parked: Notify,
    timer: StdMutex<Option<CancellationToken>>,
    terminal_turns: StdMutex<HashSet<String>>,
    terminal_activity: Arc<Notify>,
    parked_context: StdMutex<Option<Arc<TurnContext>>>,
    closed: AtomicBool,
}

fn invalid(message: impl Into<String>) -> CodexErr {
    CodexErr::InvalidRequest(message.into())
}

fn storage_error(error: impl std::fmt::Display) -> CodexErr {
    CodexErr::Fatal(format!("root reservation persistence failed: {error}"))
}

fn deadline(now: i64, after: Option<u64>, at: Option<String>) -> CodexResult<i64> {
    match (after, at) {
        (Some(delay), None) if (1..=MAX_DELAY_MS).contains(&delay) => now
            .checked_add(delay as i64)
            .ok_or_else(|| invalid("resume time overflow")),
        (None, Some(at)) => {
            let at = chrono::DateTime::parse_from_rfc3339(&at)
                .map_err(|_| invalid("resume_at must be an RFC3339 UTC timestamp"))?;
            let delay = at.timestamp_millis().saturating_sub(now);
            if at.offset().local_minus_utc() != 0 || !(1..=MAX_DELAY_MS as i64).contains(&delay) {
                return Err(invalid(
                    "resume_at must be in UTC, within the next 12 hours",
                ));
            }
            Ok(at.timestamp_millis())
        }
        _ => Err(invalid(
            "specify exactly one schedule, between 1 ms and 12 hours",
        )),
    }
}

impl Session {
    fn root_resume_control(&self) -> Arc<RootResumeControl> {
        self.services
            .thread_extension_data
            .get_or_init(RootResumeControl::default)
    }

    fn root_resume_record(&self) -> Option<RootResumeReservation> {
        self.root_resume_control()
            .record
            .lock()
            .unwrap_or_else(|error| panic!("root resume record: {error}"))
            .clone()
    }

    fn set_root_resume_record(&self, record: Option<RootResumeReservation>) {
        if record.as_ref().is_none_or(|r| {
            matches!(
                r.state,
                RootResumeState::Resumed | RootResumeState::Cancelled
            )
        }) {
            *self
                .root_resume_control()
                .parked_context
                .lock()
                .unwrap_or_else(|error| panic!("parked context: {error}")) = None;
        }
        *self
            .root_resume_control()
            .record
            .lock()
            .unwrap_or_else(|error| panic!("root resume record: {error}")) = record;
    }

    pub(crate) fn has_root_resume_reservation(&self) -> bool {
        self.root_resume_record().is_some_and(|record| {
            matches!(
                record.state,
                RootResumeState::Preparing
                    | RootResumeState::Waiting
                    | RootResumeState::Claimed
                    | RootResumeState::Blocked
            )
        })
    }

    pub(crate) fn root_turn_is_deferred(&self, turn_id: &str) -> bool {
        self.root_resume_control()
            .deferred_turn
            .lock()
            .unwrap_or_else(|error| panic!("deferred turn: {error}"))
            .as_deref()
            == Some(turn_id)
    }

    pub(crate) fn root_resume_originating_turn(&self) -> Option<String> {
        self.root_resume_record()
            .filter(|_| self.has_root_resume_reservation())
            .map(|r| r.originating_turn_id)
    }

    /// Serialize user submission with dispatch; wait only for the short parking boundary.
    pub(crate) async fn root_resume_submission_guard(&self) -> OwnedMutexGuard<()> {
        let control = self.root_resume_control();
        loop {
            let parked = control.parked.notified();
            tokio::pin!(parked);
            parked.as_mut().enable();
            let guard = Arc::clone(&control.gate).lock_owned().await;
            if control
                .deferred_turn
                .lock()
                .unwrap_or_else(|error| panic!("deferred turn: {error}"))
                .is_none()
            {
                return guard;
            }
            drop(guard);
            parked.await;
        }
    }

    pub(crate) async fn prepare_root_resume(
        self: &Arc<Self>,
        turn: &Arc<TurnContext>,
        call_id: &str,
        resume_after_ms: Option<u64>,
        resume_at: Option<String>,
        agent_paths: Vec<String>,
        reason: String,
    ) -> CodexResult<RootResumeReservation> {
        let control = self.root_resume_control();
        let _guard = Arc::clone(&control.gate).lock_owned().await;
        if control.closed.load(Ordering::Acquire) {
            return Err(invalid("root runtime is closing"));
        }
        if turn.session_source.is_non_root_agent() {
            return Err(invalid("defer_root is available only to the root agent"));
        }
        if !turn.provider.info().is_openai() {
            return Err(invalid(
                "defer_root requires the native OpenAI execution path",
            ));
        }
        let reason = reason.trim().to_string();
        if reason.is_empty() || reason.len() > 512 || agent_paths.len() > 32 {
            return Err(invalid(
                "reason must contain 1..512 bytes; at most 32 child tasks are supported",
            ));
        }
        let db = self
            .state_db()
            .ok_or_else(|| invalid("defer_root requires persistent state storage"))?;
        if self.has_root_resume_reservation()
            || db
                .get_active_root_resume(&self.thread_id.to_string())
                .await
                .map_err(storage_error)?
                .is_some()
        {
            return Err(invalid("this root already has an active reservation"));
        }
        let now = self
            .services
            .time_provider
            .current_time(self.thread_id)
            .await
            .map_err(storage_error)?
            .timestamp_millis();
        let resume_at_ms = deadline(now, resume_after_ms, resume_at)?;
        let descendants = if agent_paths.is_empty() {
            Vec::new()
        } else {
            self.services
                .agent_control
                .list_live_agent_subtree_thread_ids(self.thread_id)
                .await?
        };
        let mut seen = HashSet::new();
        let mut agent_tasks = Vec::new();
        for path in agent_paths {
            let id = self
                .services
                .agent_control
                .resolve(
                    self.thread_id,
                    /*parent*/ None,
                    &turn.session_source,
                    &path,
                )
                .await?;
            if id == self.thread_id || !descendants.contains(&id) || !seen.insert(id) {
                return Err(invalid(
                    "wake targets must be distinct descendants of this root",
                ));
            }
            let task = self
                .services
                .agent_control
                .root_resume_agent_task(id)
                .await?;
            agent_tasks.push(task);
        }
        let record = RootResumeReservation {
            wait_started_at_ms: None,
            wait_ended_at_ms: None,

            id: uuid::Uuid::new_v4().to_string(),
            root_thread_id: self.thread_id.to_string(),
            originating_turn_id: turn.sub_id.clone(),
            root_turn_id: turn
                .turn_metadata_state
                .root_turn_id()
                .unwrap_or_else(|| turn.sub_id.clone()),
            call_id: call_id.to_string(),
            resume_turn_id: uuid::Uuid::new_v4().to_string(),
            resume_at_ms,
            created_at_ms: now,
            updated_at_ms: now,
            revision: 0,
            state: RootResumeState::Preparing,
            agent_tasks,
            reason,
            wake_reason: None,
            last_error: None,
            final_output_json_schema: turn.final_output_json_schema.clone(),
        };
        db.create_root_resume(&record)
            .await
            .map_err(storage_error)?;
        *control
            .parked_context
            .lock()
            .unwrap_or_else(|error| panic!("parked context: {error}")) = Some(Arc::clone(turn));
        self.set_root_resume_record(Some(record.clone()));
        Ok(record)
    }

    async fn transition_root_resume_record(
        &self,
        record: &RootResumeReservation,
        state: RootResumeState,
        reason: Option<RootResumeWakeReason>,
        error: Option<String>,
    ) -> CodexResult<RootResumeReservation> {
        let db = self
            .state_db()
            .ok_or_else(|| invalid("root reservation storage unavailable"))?;
        // A failed scheduling clock must still allow recording Blocked or Cancelled.
        let now = self
            .services
            .time_provider
            .current_time(self.thread_id)
            .await
            .map(|time| time.timestamp_millis())
            .unwrap_or_else(|_| chrono::Utc::now().timestamp_millis());
        let was_preparing = record.state == RootResumeState::Preparing;
        let record = db
            .transition_root_resume(&record.id, record.revision, state, reason, error, now)
            .await
            .map_err(storage_error)?
            .ok_or_else(|| invalid("reservation changed; refresh before retrying"))?;
        self.set_root_resume_record(Some(record.clone()));
        if !(was_preparing
            && record.state == RootResumeState::Cancelled
            && record.wait_started_at_ms.is_none())
        {
            let event = codex_protocol::protocol::Event {
                id: record.originating_turn_id.clone(),
                msg: EventMsg::RootResumeWaitUpdated(
                    codex_protocol::protocol::RootResumeWaitUpdatedEvent {
                        turn_id: record.originating_turn_id.clone(),
                        wait: (&record).into(),
                    },
                ),
            };
            // Use the normal event persistence pipeline without adding a new failure
            // after the authoritative reservation transition has already committed.
            self.send_event_raw(event).await;
        }
        Ok(record)
    }

    /// Called only after all sampled tools returned and their outputs were recorded.
    pub(crate) async fn defer_root_after_tools(
        self: &Arc<Self>,
        turn: &Arc<TurnContext>,
    ) -> CodexResult<bool> {
        if !self.root_resume_record().is_some_and(|record| {
            record.originating_turn_id == turn.sub_id && record.state == RootResumeState::Preparing
        }) {
            return Ok(false);
        }
        let control = self.root_resume_control();
        let _guard = Arc::clone(&control.gate).lock_owned().await;
        let Some(record) = self.root_resume_record().filter(|r| {
            r.originating_turn_id == turn.sub_id && r.state == RootResumeState::Preparing
        }) else {
            return Ok(false);
        };
        let turn_state = self
            .input_queue
            .turn_state_for_sub_id(&self.active_turn, &turn.sub_id)
            .await;
        let (_, activity) = self
            .input_queue
            .subscribe_activity(turn_state.as_deref())
            .await;
        if activity == Some(InputQueueActivity::Steer) {
            self.transition_root_resume_record(
                &record,
                RootResumeState::Cancelled,
                Some(RootResumeWakeReason::UserInput),
                None,
            )
            .await?;
            return Ok(false);
        }
        let mut pending = if let Some(turn_state) = turn_state {
            self.input_queue
                .take_pending_input_for_turn_state(turn_state.as_ref())
                .await
        } else {
            Vec::new()
        };
        let (mail, _) = self.input_queue.drain_mailbox_input_items().await;
        pending.extend(mail);
        super::turn::run_hooks_and_record_inputs(
            self,
            turn,
            &turn.capture_current_model_info(),
            &pending,
            codex_thread_store::PersistContext::Standard,
        )
        .await;
        if let Err(error) = self.flush_rollout().await {
            self.transition_root_resume_record(
                &record,
                RootResumeState::Blocked,
                None,
                Some(error.to_string()),
            )
            .await?;
            return Err(storage_error(error));
        }
        self.transition_root_resume_record(&record, RootResumeState::Waiting, None, None)
            .await?;
        *control
            .deferred_turn
            .lock()
            .unwrap_or_else(|error| panic!("deferred turn: {error}")) = Some(turn.sub_id.clone());
        Ok(true)
    }

    /// A distinct terminal path: no completion, interruption, idle hooks, or tree teardown.
    pub(crate) async fn finish_deferred_root(self: &Arc<Self>, turn: &Arc<TurnContext>) -> bool {
        if !self.root_turn_is_deferred(&turn.sub_id)
            && !self.root_resume_record().is_some_and(|record| {
                record.originating_turn_id == turn.sub_id
                    && record.state == RootResumeState::Preparing
            })
        {
            return false;
        }
        let control = self.root_resume_control();
        let _guard = Arc::clone(&control.gate).lock_owned().await;
        if !self.root_turn_is_deferred(&turn.sub_id) {
            if let Some(record) = self.root_resume_record().filter(|r| {
                r.originating_turn_id == turn.sub_id && r.state == RootResumeState::Preparing
            }) {
                let _ = self
                    .transition_root_resume_record(
                        &record,
                        RootResumeState::Cancelled,
                        None,
                        Some("turn ended before the tool boundary could park".to_string()),
                    )
                    .await;
            }
            return false;
        }
        let record = self.root_resume_record();
        let turn_state = self
            .input_queue
            .turn_state_for_sub_id(&self.active_turn, &turn.sub_id)
            .await;
        if let Some(turn_state) = turn_state {
            let pending = self
                .input_queue
                .take_pending_input_for_turn_state(turn_state.as_ref())
                .await;
            super::turn::run_hooks_and_record_inputs(
                self,
                turn,
                &turn.capture_current_model_info(),
                &pending,
                codex_thread_store::PersistContext::Standard,
            )
            .await;
        }
        {
            let mut active = self.active_turn.lock().await;
            if active
                .as_ref()
                .and_then(|a| a.task.as_ref())
                .is_some_and(|t| t.turn_context.sub_id == turn.sub_id)
            {
                if let Some(task) = active.as_mut().and_then(|a| a.task.take()) {
                    task.handle.detach();
                }
                // Accepted input is durable. New parked mail is persisted by enqueue_root_aware_mail.
                *active = None;
            }
        }
        turn.turn_metadata_state.cancel_git_enrichment_task();
        if let Some(record) = record.as_ref() {
            let (started_at, deferred_at, duration_ms) =
                turn.turn_timing_state.defer_timing().await;
            self.send_event(
                turn,
                EventMsg::TurnDeferred(TurnDeferredEvent {
                    turn_id: turn.sub_id.clone(),
                    reservation_id: record.id.clone(),
                    wait: Some(record.into()),
                    started_at,
                    deferred_at,
                    duration_ms,
                }),
            )
            .await;
            if let Err(error) = self.flush_rollout().await {
                let _ = self
                    .transition_root_resume_record(
                        record,
                        RootResumeState::Blocked,
                        None,
                        Some(error.to_string()),
                    )
                    .await;
            }
        }
        *control
            .deferred_turn
            .lock()
            .unwrap_or_else(|error| panic!("deferred turn: {error}")) = None;
        control.parked.notify_waiters();
        if let Some(record) = self
            .root_resume_record()
            .filter(|r| r.state == RootResumeState::Waiting)
        {
            self.schedule_root_resume(record);
        }
        true
    }

    pub(crate) fn stop_root_resume_timer(&self) {
        if let Some(timer) = self
            .root_resume_control()
            .timer
            .lock()
            .unwrap_or_else(|error| panic!("root resume timer: {error}"))
            .take()
        {
            timer.cancel();
        }
    }

    pub(crate) async fn close_root_resume_runtime(&self) {
        let control = self.root_resume_control();
        let _guard = Arc::clone(&control.gate).lock_owned().await;
        control.closed.store(true, Ordering::Release);
        self.stop_root_resume_timer();
    }

    /// Parked mail becomes native conversation history immediately, once, without sampling.
    /// The gate seals the handoff from the ordinary in-memory queue to durable waiting history.
    pub(crate) async fn enqueue_root_aware_mail(
        self: &Arc<Self>,
        communication: codex_protocol::protocol::InterAgentCommunication,
        start_options: codex_protocol::turn_input::TurnStartOptions,
    ) {
        let control = self.root_resume_control();
        let _guard = Arc::clone(&control.gate).lock_owned().await;
        let context = control
            .parked_context
            .lock()
            .unwrap_or_else(|error| panic!("parked context: {error}"))
            .clone();
        if let Some(context) = context.filter(|_| self.has_root_resume_reservation()) {
            self.record_inter_agent_communication(
                &context,
                &context.capture_current_model_info(),
                communication,
            )
            .await;
            if let Err(error) = self.flush_rollout().await {
                if let Some(record) = self
                    .root_resume_record()
                    .filter(|r| r.state != RootResumeState::Blocked)
                {
                    let _ = self
                        .transition_root_resume_record(
                            &record,
                            RootResumeState::Blocked,
                            None,
                            Some(error.to_string()),
                        )
                        .await;
                }
                tracing::warn!(%error, "could not flush parked root mail");
            }
        } else {
            self.input_queue
                .enqueue_mailbox_communication(communication, start_options)
                .await;
        }
    }

    fn schedule_root_resume(self: &Arc<Self>, record: RootResumeReservation) {
        if self.root_resume_control().closed.load(Ordering::Acquire) {
            return;
        }
        self.stop_root_resume_timer();
        let token = CancellationToken::new();
        *self
            .root_resume_control()
            .timer
            .lock()
            .unwrap_or_else(|error| panic!("root resume timer: {error}")) = Some(token.clone());
        let weak = Arc::downgrade(self);
        let clock = Arc::clone(&self.services.time_provider);
        let agent_control = self.services.agent_control.clone();
        let thread_id = self.thread_id;
        tokio::spawn(async move {
            let timed = async {
                let now = clock.current_time(thread_id).await?;
                let delay = record
                    .resume_at_ms
                    .saturating_sub(now.timestamp_millis())
                    .max(0) as u64;
                clock.sleep(thread_id, Duration::from_millis(delay)).await?;
                anyhow::Ok(RootResumeWakeReason::Deadline)
            };
            let agents = async {
                if record.agent_tasks.is_empty() {
                    return std::future::pending().await;
                }
                futures::future::join_all(
                    record
                        .agent_tasks
                        .iter()
                        .map(|task| agent_control.wait_root_resume_agent_task(task)),
                )
                .await;
                anyhow::Ok(RootResumeWakeReason::AgentsCompleted)
            };
            let reason = tokio::select! {
                biased;
                _ = token.cancelled() => return,
                result = timed => result,
                result = agents => result,
            };
            if let Some(session) = weak.upgrade() {
                match reason {
                    Ok(reason) => {
                        if let Err(error) = session
                            .dispatch_root_resume(record.id.clone(), record.revision, reason)
                            .await
                        {
                            tracing::warn!(%error, "root reservation dispatch did not start");
                        }
                    }
                    Err(error) => {
                        let _ = session
                            .transition_root_resume_record(
                                &record,
                                RootResumeState::Blocked,
                                None,
                                Some(error.to_string()),
                            )
                            .await;
                    }
                }
            }
        });
    }

    fn dispatch_root_resume(
        self: &Arc<Self>,
        id: String,
        revision: i64,
        reason: RootResumeWakeReason,
    ) -> BoxFuture<'static, CodexResult<()>> {
        let session = Arc::clone(self);
        Box::pin(async move {
            // Account switching must not hold the root gate hostage to an admission wait.
            let admission = session
                .services
                .auth_manager
                .azrael_admission()
                .admit_request()
                .await;
            let control = session.root_resume_control();
            let _guard = Arc::clone(&control.gate).lock_owned().await;
            if control.closed.load(Ordering::Acquire) {
                return Err(invalid("root runtime is closing"));
            }
            let record = session
                .root_resume_record()
                .filter(|r| r.id == id && r.revision == revision)
                .ok_or_else(|| invalid("reservation changed; refresh before retrying"))?;
            if !matches!(
                record.state,
                RootResumeState::Waiting | RootResumeState::Blocked
            ) {
                return Err(invalid("reservation is not ready to resume"));
            }
            if session.active_turn.lock().await.is_some() {
                return Err(invalid("root thread is currently active"));
            }
            let _account_admission = match admission {
                Ok(guard) => guard,
                Err(error) => {
                    if record.state == RootResumeState::Waiting {
                        session
                            .transition_root_resume_record(
                                &record,
                                RootResumeState::Blocked,
                                None,
                                Some(error.to_string()),
                            )
                            .await?;
                    }
                    return Err(invalid(error.to_string()));
                }
            };
            // A manual retry of a blocked write must first establish durable history.
            session.flush_rollout().await.map_err(storage_error)?;
            let claimed = session
                .transition_root_resume_record(
                    &record,
                    RootResumeState::Claimed,
                    Some(reason),
                    None,
                )
                .await?;
            session.stop_root_resume_timer();
            // Normal thread configuration carries source, permissions, provider and account admission.
            let previous = session.reference_context_item().await;
            let context = session
                .new_turn_with_default_settings(
                    claimed.resume_turn_id.clone(),
                    NewTurnContextOptions {
                        final_output_json_schema: claimed.final_output_json_schema.clone(),
                        cyber_access_program: previous.and_then(|c| c.cyber_access_program),
                    },
                )
                .await;
            if !context.provider.info().is_openai() {
                session
                    .transition_root_resume_record(
                        &claimed,
                        RootResumeState::Blocked,
                        None,
                        Some(
                            "the thread provider changed; native OpenAI execution is required"
                                .to_string(),
                        ),
                    )
                    .await?;
                return Err(invalid(
                    "root reservation requires the native OpenAI execution path",
                ));
            }
            context
                .turn_metadata_state
                .set_root_turn_id(claimed.root_turn_id.clone());
            context
                .turn_metadata_state
                .set_parent_turn_id(claimed.originating_turn_id.clone());
            context
                .turn_metadata_state
                .set_turn_trigger("root_resume".to_string());
            let busy = {
                let mut active = session.active_turn.lock().await;
                if active.is_some() {
                    true
                } else {
                    *active = Some(ActiveTurn::default());
                    false
                }
            };
            if busy {
                session
                    .transition_root_resume_record(
                        &claimed,
                        RootResumeState::Blocked,
                        None,
                        Some("root admission changed".to_string()),
                    )
                    .await?;
                return Err(invalid("root thread is currently active"));
            }
            let wake = match claimed.wake_reason {
                Some(RootResumeWakeReason::Deadline) => "deadline reached",
                Some(RootResumeWakeReason::AgentsCompleted) => "selected child tasks terminated",
                _ => "manual resume",
            };
            let input = TurnInput::ResponseItem(codex_history::ResponseItemEnvelope::new(
                codex_protocol::models::ResponseItem::Message {
                    id: None,
                    role: "developer".to_string(),
                    content: vec![codex_protocol::models::ContentItem::InputText {
                        text: format!(
                            "Root wait ended: {wake}. Continue the same task using any pending child results."
                        ),
                    }],
                    phase: None,
                    internal_chat_message_metadata_passthrough: None,
                },
            ));
            session
                .start_task(context, vec![input], RegularTask::new())
                .await;
            // An ambiguous crash before this acknowledgement stays claimed and needs review.
            session
                .transition_root_resume_record(
                    &claimed,
                    RootResumeState::Resumed,
                    claimed.wake_reason.clone(),
                    None,
                )
                .await?;
            Ok(())
        })
    }

    pub(crate) async fn manually_resume_root(
        self: &Arc<Self>,
        id: &str,
        revision: i64,
    ) -> CodexResult<()> {
        self.dispatch_root_resume(id.to_string(), revision, RootResumeWakeReason::Manual)
            .await
    }

    pub(crate) async fn cancel_root_reservation(
        self: &Arc<Self>,
        id: &str,
        revision: i64,
    ) -> CodexResult<()> {
        let _guard = self.root_resume_submission_guard().await;
        let record = self
            .root_resume_record()
            .filter(|r| r.id == id && r.revision == revision)
            .ok_or_else(|| invalid("reservation changed; refresh before retrying"))?;
        let parked = self.parked_root_context();
        self.transition_root_resume_record(&record, RootResumeState::Cancelled, None, None)
            .await?;
        self.stop_root_resume_timer();
        self.interrupt_parked_root(parked).await;
        Ok(())
    }

    pub(crate) fn parked_root_context(&self) -> Option<Arc<TurnContext>> {
        self.root_resume_control()
            .parked_context
            .lock()
            .unwrap_or_else(|error| panic!("parked context: {error}"))
            .clone()
    }

    /// Publish the terminal boundary after durable cancellation of an idle parked root.
    pub(crate) async fn interrupt_parked_root(&self, parked: Option<Arc<TurnContext>>) {
        let Some(turn) = parked else {
            return;
        };
        if self.active_turn.lock().await.is_some() {
            return;
        }
        let (started_at, completed_at, duration_ms) = turn.turn_timing_state.defer_timing().await;
        self.send_event(
            &turn,
            EventMsg::TurnAborted(TurnAbortedEvent {
                turn_id: Some(turn.sub_id.clone()),
                reason: TurnAbortReason::Interrupted,
                error: None,
                started_at,
                completed_at,
                duration_ms,
            }),
        )
        .await;
        if let Err(error) = self.flush_rollout().await {
            tracing::warn!(%error, "could not flush parked root interruption");
        }
        self.emit_turn_abort_lifecycle(TurnAbortReason::Interrupted, turn.extension_data.as_ref())
            .await;
    }

    /// Caller owns the submission gate. The actual user input uses normal turn admission.
    pub(crate) async fn supersede_root_resume(&self) -> CodexResult<Option<String>> {
        let Some(record) = self
            .root_resume_record()
            .filter(|_| self.has_root_resume_reservation())
        else {
            return Ok(None);
        };
        self.transition_root_resume_record(
            &record,
            RootResumeState::Cancelled,
            Some(RootResumeWakeReason::UserInput),
            None,
        )
        .await?;
        self.stop_root_resume_timer();
        Ok(Some(record.root_turn_id))
    }

    pub(crate) async fn recover_root_resume(self: &Arc<Self>) -> CodexResult<()> {
        let control = self.root_resume_control();
        let _guard = Arc::clone(&control.gate).lock_owned().await;
        let Some(db) = self.state_db() else {
            return Ok(());
        };
        let Some(record) = db
            .get_active_root_resume(&self.thread_id.to_string())
            .await
            .map_err(storage_error)?
        else {
            return Ok(());
        };
        if self.has_root_resume_reservation() {
            return Ok(());
        }
        self.set_root_resume_record(Some(record.clone()));
        let context = self
            .new_turn_with_default_settings(
                record.originating_turn_id.clone(),
                NewTurnContextOptions {
                    final_output_json_schema: record.final_output_json_schema.clone(),
                    cyber_access_program: self
                        .reference_context_item()
                        .await
                        .and_then(|c| c.cyber_access_program),
                },
            )
            .await;
        *control
            .parked_context
            .lock()
            .unwrap_or_else(|error| panic!("parked context: {error}")) = Some(context);
        if matches!(
            record.state,
            RootResumeState::Preparing | RootResumeState::Claimed
        ) {
            self.transition_root_resume_record(&record, RootResumeState::Blocked, None,
                Some("restart at an ambiguous reservation boundary; review the thread before resuming".to_string())).await?;
        } else if record.state == RootResumeState::Waiting {
            self.schedule_root_resume(record);
        }
        Ok(())
    }

    pub(crate) fn note_root_resume_terminal(&self, turn_id: &str) {
        let control = self.root_resume_control();
        control
            .terminal_turns
            .lock()
            .unwrap_or_else(|error| panic!("terminal turns: {error}"))
            .insert(turn_id.to_string());
        control.terminal_activity.notify_waiters();
    }

    pub(crate) fn root_resume_terminal_activity(&self) -> Arc<Notify> {
        Arc::clone(&self.root_resume_control().terminal_activity)
    }

    pub(crate) async fn root_resume_task_identity(&self) -> Option<String> {
        if let Some(id) = self
            .active_turn
            .lock()
            .await
            .as_ref()
            .and_then(|a| a.task.as_ref())
            .map(|t| t.turn_context.sub_id.clone())
        {
            return Some(id);
        }
        self.reference_context_item().await.and_then(|c| c.turn_id)
    }

    pub(crate) fn root_resume_task_terminal(&self, turn_id: &str) -> bool {
        self.root_resume_control()
            .terminal_turns
            .lock()
            .unwrap_or_else(|error| panic!("terminal turns: {error}"))
            .contains(turn_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedule_bounds_and_utc_are_enforced() {
        let now = 1_800_000_000_000;
        assert_eq!(deadline(now, Some(1), None).unwrap(), now + 1);
        assert_eq!(
            deadline(now, Some(MAX_DELAY_MS), None).unwrap(),
            now + MAX_DELAY_MS as i64
        );
        for duration in [0, MAX_DELAY_MS + 1, u64::MAX] {
            assert!(deadline(now, Some(duration), None).is_err());
        }
        assert!(deadline(now, None, None).is_err());
        assert!(deadline(now, Some(1), Some("2027-01-15T08:00:01Z".to_string())).is_err());
        assert!(deadline(now, None, Some("2027-01-15T17:00:01+09:00".to_string())).is_err());
        let at = chrono::DateTime::from_timestamp_millis(now + 1_000)
            .unwrap()
            .to_rfc3339();
        assert_eq!(deadline(now, None, Some(at)).unwrap(), now + 1_000);
    }
}

#[cfg(test)]
#[path = "root_resume_tests.rs"]
mod lifecycle_tests;

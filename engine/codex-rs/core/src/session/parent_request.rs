//! Durable decisions are separate from ordinary progress mail and task completion.
use super::{Session, TurnContext};
use crate::config::AZRAEL_AGENT_TOOL_NAMESPACE;
use codex_protocol::AgentPath;
use codex_protocol::ThreadId;
use codex_protocol::error::{CodexErr, Result as CodexResult};
use codex_protocol::parent_request::{
    ParentRequest, ParentRequestDeliveryState, ParentRequestPresentation, ParentRequestStatus, ParentResponse,
};
use codex_protocol::protocol::{HasLegacyEvent, InterAgentCommunication, MultiAgentVersion};
use codex_protocol::root_resume::RootResumeState;
use codex_protocol::turn_input::TurnStartOptions;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Default)]
struct ParentRequestControl {
    gate: Mutex<()>,
}

pub(crate) fn parent_request_tools_enabled(turn: &TurnContext) -> bool {
    turn.multi_agent_version == MultiAgentVersion::V2
        && turn.config.multi_agent_v2.tool_namespace.as_deref() == Some(AZRAEL_AGENT_TOOL_NAMESPACE)
        && !turn.config.multi_agent_v2.disable_direct_message
        && !turn.config.ephemeral
        && turn.provider.info().is_openai()
}

fn invalid(message: impl Into<String>) -> CodexErr {
    CodexErr::InvalidRequest(message.into())
}
fn storage(error: impl std::fmt::Display) -> CodexErr {
    tracing::error!(target: "codex_core::parent_request", event = "parent_request_storage_failed", "parent request persistence failed");
    CodexErr::Fatal(format!("parent request persistence failed: {error}"))
}

impl Session {
    pub(crate) async fn emit_sub_agent_activity(&self, turn_id: String, item: codex_protocol::items::SubAgentActivityItem) {
        use codex_protocol::items::TurnItem;
        use codex_protocol::protocol::{Event, EventMsg, ItemStartedEvent, ItemCompletedEvent};
        use crate::turn_timing::now_unix_timestamp_ms;
        let thread_id = self.thread_id;
        let started_at_ms = now_unix_timestamp_ms();
        let item = TurnItem::SubAgentActivity(item);
        self.send_event_raw(Event {
                id: turn_id.clone(),
                msg: EventMsg::ItemStarted(ItemStartedEvent {
                    thread_id,
                    turn_id: turn_id.clone(),
                    item: item.clone(),
                    started_at_ms,
                }),
            })
            .await;
        let completed_at_ms = now_unix_timestamp_ms();
        let completed = ItemCompletedEvent {
            thread_id,
            turn_id: turn_id.clone(),
            item,
            started_at_ms: Some(started_at_ms),
            completed_at_ms,
        };
        self.send_event_raw(Event {
                id: turn_id.clone(),
                msg: EventMsg::ItemCompleted(completed.clone()),
            })
            .await;
        for legacy in completed.as_legacy_events(/*show_raw_agent_reasoning*/ false) {
            self.send_event_raw(Event {
                    id: turn_id.clone(),
                    msg: legacy,
                })
                .await;
        }
    }

    async fn emit_parent_request_activity(&self, request: &ParentRequest) -> CodexResult<()> {
        let presentation = request.presentation.as_ref().ok_or_else(|| invalid("parent request lacks presentation turn"))?;
        let child = ThreadId::from_string(&request.child_thread_id).map_err(storage)?;
        self.emit_sub_agent_activity(presentation.parent_turn_id.clone(), codex_protocol::items::SubAgentActivityItem {
            parent_request: Some(request.clone()),
            model: None,
            reasoning_effort: None,
            id: format!("parent-request-{}", request.request_id),
            kind: codex_protocol::protocol::SubAgentActivityKind::Interacted,
            agent_thread_id: child,
            agent_path: presentation.child_agent_path.clone(),
        }).await;
        self.flush_rollout().await.map_err(storage)
    }

    pub(crate) async fn request_parent(
        self: &Arc<Self>,
        turn: &Arc<TurnContext>,
        request_key: String,
        question: String,
        context: String,
        recommendation: String,
        blocked_action: String,
    ) -> CodexResult<ParentRequest> {
        if !parent_request_tools_enabled(turn) {
            return Err(invalid("parent requests unavailable in this session"));
        }
        let parent = turn
            .session_source
            .parent_thread_id()
            .ok_or_else(|| invalid("request_parent requires a direct parent"))?;
        for (value, limit) in [
            (&request_key, 256),
            (&question, 16_384),
            (&context, 32_768),
            (&recommendation, 16_384),
            (&blocked_action, 4096),
        ] {
            if value.trim().is_empty() || value.len() > limit {
                return Err(invalid(
                    "parent request fields must be nonempty and within their size limits",
                ));
            }
        }
        let db = self
            .state_db()
            .ok_or_else(|| invalid("parent requests require persistent state"))?;
        let now = crate::turn_timing::now_unix_timestamp_ms();
        let request = ParentRequest {
            presentation: turn.turn_metadata_state.parent_turn_id().zip(turn.session_source.get_agent_path()).map(|(parent_turn_id, child_agent_path)| ParentRequestPresentation { parent_turn_id, child_agent_path }),
            request_id: uuid::Uuid::now_v7().to_string(),
            request_key,
            parent_thread_id: parent.to_string(),
            child_thread_id: self.thread_id.to_string(),
            child_task_id: turn.sub_id.clone(),
            question,
            context,
            recommendation,
            blocked_action,
            status: ParentRequestStatus::Pending,
            delivery_state: ParentRequestDeliveryState::Queued,
            delivery_reason: None,
            response: None,
            created_at_ms: now,
            updated_at_ms: now,
        };
        let record = db.create_parent_request(&request).await.map_err(storage)?;
        // A retry acknowledges the durable original; it does not replay the wake side effect.
        if record.request_id != request.request_id {
            return Ok(record);
        }
        tracing::info!(target: "codex_core::parent_request", event = "request_created", thread_id = %self.thread_id, request_id = %record.request_id,
            parent_thread_id = %record.parent_thread_id, child_thread_id = %record.child_thread_id, child_task_id = %record.child_task_id);
        if self
            .services
            .agent_control
            .deliver_parent_request(self.thread_id, parent, record.request_id.clone())
            .await
            .is_err()
        {
            tracing::warn!(target: "codex_core::parent_request", event = "parent_request_delivery_failed", thread_id = %self.thread_id, request_id = %record.request_id, error_kind = "parent_delivery_failed");
            return db
                .set_parent_request_delivery(
                    &record.request_id,
                    ParentRequestDeliveryState::Blocked,
                    Some("parent_delivery_failed".into()),
                    crate::turn_timing::now_unix_timestamp_ms(),
                )
                .await
                .map_err(storage);
        }
        db.get_parent_request(&record.request_id)
            .await
            .map_err(storage)?
            .ok_or_else(|| invalid("parent request disappeared"))
    }

    pub(crate) async fn receive_parent_request(
        self: &Arc<Self>,
        request_id: &str,
        child: ThreadId,
        author: AgentPath,
        recipient: AgentPath,
    ) -> CodexResult<()> {
        let control = self
            .services
            .thread_extension_data
            .get_or_init(ParentRequestControl::default);
        let _guard = control.gate.lock().await;
        let db = self
            .state_db()
            .ok_or_else(|| invalid("parent requests require persistent state"))?;
        let mut request = db
            .get_parent_request(request_id)
            .await
            .map_err(storage)?
            .ok_or_else(|| invalid("unknown parent request"))?;
        if request.parent_thread_id != self.thread_id.to_string()
            || request.child_thread_id != child.to_string()
        {
            return Err(invalid("parent request identity mismatch"));
        }
        if request.presentation.is_none() {
            let parent_turn_id = match self.root_resume_originating_turn() {
                Some(id) => Some(id),
                None => self.root_resume_task_identity().await,
            }.ok_or_else(|| invalid("parent request requires an existing parent turn"))?;
            request = db.set_parent_request_presentation(request_id, &self.thread_id.to_string(), &ParentRequestPresentation {
                parent_turn_id, child_agent_path: author.clone(),
            }).await.map_err(storage)?;
        }
        self.emit_parent_request_activity(&request).await?;
        if request.status != ParentRequestStatus::Pending
            || matches!(
                request.delivery_state,
                ParentRequestDeliveryState::Delivered | ParentRequestDeliveryState::ResumeScheduled
            )
        {
            return Ok(());
        }
        let config = self.get_config().await;
        if !config.model_provider.is_openai() || config.ephemeral {
            db.set_parent_request_delivery(
                request_id,
                ParentRequestDeliveryState::Blocked,
                Some("parent_capability_unavailable".into()),
                crate::turn_timing::now_unix_timestamp_ms(),
            )
            .await
            .map_err(storage)?;
            return Ok(());
        }
        // Content remains agent mail, never developer instructions. Stopped parents retain it.
        let stopped = self.is_interrupted() || self.state.lock().await.shutting_down;
        let parked = self.has_root_resume_reservation();
        let reservation_state = self.root_resume_state();
        let blocked = reservation_state == Some(RootResumeState::Blocked);
        let parent_waiting = self.parent_response_turn_is_deferred();
        let content = serde_json::to_string(&request).map_err(storage)?;
        self.enqueue_root_aware_mail(InterAgentCommunication::new(author, recipient, Vec::new(),
            format!("Parent decision request (request_id={request_id}). Reply with respond_to_request.\n{content}"),
            !parked && !stopped && !parent_waiting), TurnStartOptions::default()).await;
        self.flush_rollout().await.map_err(storage)?;
        let delivery = if stopped || blocked || parent_waiting {
            ParentRequestDeliveryState::Blocked
        } else if reservation_state == Some(RootResumeState::Waiting) {
            ParentRequestDeliveryState::ResumeScheduled
        } else {
            ParentRequestDeliveryState::Delivered
        };
        db.set_parent_request_delivery(
            request_id,
            delivery,
            if stopped {
                Some("parent_explicitly_stopped".into())
            } else if blocked {
                Some("parent_resume_blocked".into())
            } else if parent_waiting {
                Some("parent_waiting_for_its_parent".into())
            } else {
                None
            },
            crate::turn_timing::now_unix_timestamp_ms(),
        )
        .await
        .map_err(storage)?;
        tracing::info!(target: "codex_core::parent_request", event = "parent_request_delivered", thread_id = %self.thread_id, request_id,
            parent_thread_id = %self.thread_id, child_thread_id = %child, stopped, parked);
        if !stopped && !blocked && !parent_waiting {
            if reservation_state == Some(RootResumeState::Waiting) {
                self.resume_root_for_parent_request().await?;
            } else if !parked {
                self.maybe_start_turn_for_pending_work().await;
            }
        }
        Ok(())
    }

    pub(crate) async fn respond_to_parent_request(
        self: &Arc<Self>,
        turn: &Arc<TurnContext>,
        request_id: &str,
        response: ParentResponse,
    ) -> CodexResult<ParentRequest> {
        if !parent_request_tools_enabled(turn) {
            return Err(invalid("parent requests unavailable in this session"));
        }
        let control = self
            .services
            .thread_extension_data
            .get_or_init(ParentRequestControl::default);
        let _guard = control.gate.lock().await;
        let db = self
            .state_db()
            .ok_or_else(|| invalid("parent requests require persistent state"))?;
        let now = crate::turn_timing::now_unix_timestamp_ms();
        let request = db
            .respond_parent_request(request_id, &self.thread_id.to_string(), &response, now)
            .await
            .map_err(storage)?;
        let request = if request.presentation.is_none() {
            let child = ThreadId::from_string(&request.child_thread_id).map_err(storage)?;
            let info = self.services.agent_control.inspect(self.thread_id, crate::agent::api::AgentTarget::Id(child)).await?;
            let child_agent_path = info.metadata().agent_path.clone().ok_or_else(|| invalid("parent request lacks child identity"))?;
            db.set_parent_request_presentation(request_id, &self.thread_id.to_string(), &ParentRequestPresentation {
                parent_turn_id: turn.sub_id.clone(), child_agent_path,
            }).await.map_err(storage)?
        } else { request };
        self.emit_parent_request_activity(&request).await?;
        if request.delivery_state == ParentRequestDeliveryState::Delivered {
            return Ok(request);
        }
        tracing::info!(target: "codex_core::parent_request", event = "response_saved", thread_id = %self.thread_id, request_id,
            parent_thread_id = %request.parent_thread_id, child_thread_id = %request.child_thread_id,
            child_task_id = %request.child_task_id, request_response_ms = now.saturating_sub(request.created_at_ms), status = ?request.status);
        let child = ThreadId::from_string(&request.child_thread_id).map_err(storage)?;
        if self
            .services
            .agent_control
            .notify_parent_response(child, request_id.to_owned())
            .await
            .is_err()
        {
            tracing::warn!(target: "codex_core::parent_request", event = "response_delivery_failed", thread_id = %self.thread_id, request_id, error_kind = "child_not_available");
            return db
                .set_parent_request_delivery(
                    request_id,
                    ParentRequestDeliveryState::Blocked,
                    Some("response_delivery_failed".into()),
                    now,
                )
                .await
                .map_err(storage);
        }
        tracing::info!(target: "codex_core::parent_request", event = "response_delivered", thread_id = %self.thread_id, request_id);
        db.set_parent_request_delivery(
            request_id,
            ParentRequestDeliveryState::Delivered,
            None,
            crate::turn_timing::now_unix_timestamp_ms(),
        )
        .await
        .map_err(storage)
    }

    pub(crate) async fn ensure_parent_requests_handled(&self) -> CodexResult<()> {
        let Some(db) = self.state_db() else {
            return Ok(());
        };
        let pending = db
            .list_pending_parent_requests(&self.thread_id.to_string())
            .await
            .map_err(storage)?;
        if pending.is_empty() {
            Ok(())
        } else {
            Err(invalid(format!(
                "respond to or explicitly defer these parent requests before parking: {}",
                serde_json::to_string(&pending).map_err(storage)?
            )))
        }
    }

    /// Rehydrate pending mail at a recovery/parking boundary, not by model polling.
    pub(crate) async fn restore_pending_parent_request_mail(self: &Arc<Self>) -> CodexResult<bool> {
        let control = self
            .services
            .thread_extension_data
            .get_or_init(ParentRequestControl::default);
        let _guard = control.gate.lock().await;
        let Some(db) = self.state_db() else {
            return Ok(false);
        };
        let pending = db
            .list_pending_parent_requests(&self.thread_id.to_string())
            .await
            .map_err(storage)?;
        for request in &pending {
            if request.presentation.is_some() {
                self.emit_parent_request_activity(request).await?;
            }
            let marker = format!(
                "Parent decision request (request_id={})",
                request.request_id
            );
            let history = self.clone_history().await;
            let already_recorded = history.raw_items().any(|item| match item {
                codex_protocol::models::ResponseItem::AgentMessage { content, .. } => {
                    codex_protocol::models::plaintext_agent_message_content(content)
                        .is_some_and(|text| text.contains(&marker))
                }
                _ => false,
            });
            if !already_recorded {
                let child = ThreadId::from_string(&request.child_thread_id).map_err(storage)?;
                let info = self
                    .services
                    .agent_control
                    .inspect(self.thread_id, crate::agent::api::AgentTarget::Id(child))
                    .await?;
                let author = info.metadata().agent_path.clone().ok_or_else(|| {
                    invalid("pending parent request lacks its recorded child identity")
                })?;
                let recipient = self
                    .services
                    .agent_control
                    .inspect(
                        self.thread_id,
                        crate::agent::api::AgentTarget::Id(self.thread_id),
                    )
                    .await?
                    .metadata()
                    .agent_path
                    .clone()
                    .unwrap_or_else(AgentPath::root);
                let content = serde_json::to_string(request).map_err(storage)?;
                self.enqueue_root_aware_mail(
                    InterAgentCommunication::new(
                        author,
                        recipient,
                        Vec::new(),
                        format!("{marker}. Reply with respond_to_request.\n{content}"),
                        false,
                    ),
                    TurnStartOptions::default(),
                )
                .await;
            }
        }
        if !pending.is_empty() {
            self.flush_rollout().await.map_err(storage)?;
        }
        Ok(!pending.is_empty())
    }
}

#[cfg(test)]
#[path = "parent_request_tests.rs"]
mod tests;

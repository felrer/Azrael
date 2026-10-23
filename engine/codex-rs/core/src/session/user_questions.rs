//! Conversation-owned questions, reconstructed from durable lifecycle events.
use super::Session;
#[cfg(test)]
use codex_history::InitialHistory;
use codex_history::RolloutItem;
use codex_protocol::error::{CodexErr, Result};
use codex_protocol::items::{AgentMessageItem, TurnItem};
use codex_protocol::protocol::{Event, EventMsg, ItemCompletedEvent, ThreadQueueChangedEvent};
use codex_protocol::user_input::UserInput;
use std::collections::{BTreeMap, HashSet};

#[derive(Default)]
pub(crate) struct UserQuestions {
    messages: BTreeMap<String, (String, AgentMessageItem)>,
    answered: HashSet<String>,
    // Accepted inputs can outlive their withdrawal events after a failed write.
    superseded: HashSet<String>,
}

pub(crate) fn question_id(message: &str, index: usize) -> String {
    serde_json::json!(["request_user_input_async", message, index]).to_string()
}

pub(crate) fn reply_ids(text: &str) -> Result<Vec<String>> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Reply {
        question_item_id: String,
        question: String,
        answer: String,
    }
    #[derive(serde::Deserialize)]
    #[serde(untagged)]
    enum Replies {
        Many(Vec<Reply>),
        One(Reply),
    }
    let text = text.trim();
    let text = if text.starts_with("# Context from my IDE setup:\n") {
        let Some((_, request)) = text.rsplit_once("\n## My request for Codex:\n") else {
            return Ok(Vec::new());
        };
        request.trim()
    } else {
        text
    };
    let Some(json) = text
        .strip_prefix("<send_user_message_question_reply>")
        .and_then(|text| text.strip_suffix("</send_user_message_question_reply>"))
    else {
        return Ok(Vec::new());
    };
    let replies = match serde_json::from_str::<Replies>(json)
        .map_err(|_| CodexErr::InvalidRequest("invalid question reply".into()))?
    {
        Replies::Many(replies) => replies,
        Replies::One(reply) => vec![reply],
    };
    if replies.is_empty() {
        return Err(CodexErr::InvalidRequest(
            "question replies must not be empty".into(),
        ));
    }
    Ok(replies
        .into_iter()
        .map(|reply| {
            let _ = (reply.question, reply.answer);
            reply.question_item_id
        })
        .collect())
}

pub(crate) fn reply_ids_from_content(content: &[UserInput]) -> Vec<String> {
    content
        .iter()
        .filter_map(|input| match input {
            UserInput::Text { text, .. } => Some(reply_ids(text).unwrap_or_default()),
            _ => None,
        })
        .flatten()
        .collect()
}

pub(crate) fn queued_reply_ids(content: &[UserInput]) -> Result<Vec<String>> {
    let [UserInput::Text { text, .. }] = content else {
        return Err(CodexErr::InvalidRequest(
            "queued question reply must contain one text envelope".into(),
        ));
    };
    let ids = reply_ids(text)?;
    if ids.is_empty() {
        return Err(CodexErr::InvalidRequest(
            "queued question reply has no question IDs".into(),
        ));
    }
    Ok(ids)
}

impl UserQuestions {
    fn pending_ids(&self) -> Vec<String> {
        self.messages
            .values()
            .flat_map(|(_, item)| {
                item.questions
                    .iter()
                    .flatten()
                    .enumerate()
                    .filter_map(move |(i, q)| {
                        let id = question_id(&item.id, i);
                        (!q.withdrawn
                            && !self.answered.contains(&id)
                            && !self.superseded.contains(&id))
                        .then_some(id)
                    })
            })
            .collect()
    }

    pub(crate) fn supersede(&mut self, ids: &[String]) {
        self.superseded.extend(ids.iter().cloned());
    }

    pub(crate) fn pending_count(&self) -> usize {
        self.pending_ids().len()
    }

    fn find(&self, id: &str) -> Option<(&AgentMessageItem, usize)> {
        self.messages.values().find_map(|(_, item)| {
            item.questions
                .as_ref()?
                .iter()
                .enumerate()
                .find(|(i, _)| question_id(&item.id, *i) == id)
                .map(|(i, _)| (item, i))
        })
    }

    fn validate(&self, ids: &[String]) -> Result<()> {
        for id in ids {
            let (item, index) = self
                .find(id)
                .ok_or_else(|| CodexErr::InvalidRequest(format!("unknown question ID: {id}")))?;
            if !self.answered.contains(id)
                && (self.superseded.contains(id)
                    || item
                        .questions
                        .as_ref()
                        .is_some_and(|qs| qs[index].withdrawn))
            {
                return Err(CodexErr::InvalidRequest(format!(
                    "question was withdrawn: {id}"
                )));
            }
        }
        Ok(())
    }

    fn observe(&mut self, event: &EventMsg) {
        match event {
            EventMsg::ItemCompleted(event) => match &event.item {
                TurnItem::AgentMessage(item) if item.questions.is_some() => {
                    self.messages
                        .insert(item.id.clone(), (event.turn_id.clone(), item.clone()));
                }
                _ => {}
            },
            _ => {}
        }
    }

    pub(crate) fn answer_content(&mut self, content: &[UserInput]) -> bool {
        let answered_before = self.answered.len();
        for input in content {
            if let UserInput::Text { text, .. } = input {
                if let Ok(ids) = reply_ids(text) {
                    self.answered.extend(ids);
                }
            }
        }
        self.answered.len() != answered_before
    }

    pub(crate) fn from_history(history: &[RolloutItem]) -> Self {
        let mut state = Self::default();
        for item in history {
            match item {
                RolloutItem::EventMsg(event) => state.observe(event),
                RolloutItem::ResponseItem(item) => {
                    if let Some(metadata) = &item.metadata {
                        state
                            .answered
                            .extend(metadata.answered_async_question_ids.clone());
                    }
                }
                _ => {}
            }
        }
        state
    }
}

impl Session {
    pub(crate) fn pending_question_count(&self) -> usize {
        self.user_questions.lock().unwrap().pending_count()
    }

    pub(super) async fn restore_user_questions(
        &self,
        items: &[RolloutItem],
        resumed: bool,
    ) -> Result<()> {
        let mut questions = UserQuestions::from_history(items);
        if resumed {
            if self.journals_user_input() {
                if let Some(db) = self.state_db() {
                    for receipt in db
                        .thread_queue()
                        .pending_user_inputs(self.thread_id)
                        .await
                        .map_err(|e| CodexErr::InvalidRequest(e.to_string()))?
                    {
                        let payload: serde_json::Value = serde_json::from_str(
                            receipt.payload_json.as_deref().ok_or_else(|| {
                                CodexErr::InvalidRequest("accepted input missing payload".into())
                            })?,
                        )
                        .map_err(|e| CodexErr::InvalidRequest(e.to_string()))?;
                        let content: Vec<UserInput> =
                            serde_json::from_value(payload["content"].clone())
                                .map_err(|e| CodexErr::InvalidRequest(e.to_string()))?;
                        let superseded: Vec<String> = serde_json::from_value(
                            payload
                                .get("superseded_async_question_ids")
                                .cloned()
                                .unwrap_or_else(|| serde_json::json!([])),
                        )
                        .map_err(|e| CodexErr::InvalidRequest(e.to_string()))?;
                        questions.supersede(&superseded);
                        if payload["origin"] != "queue" {
                            questions.answer_content(&content);
                        }
                    }
                }
            }
        }
        *self.user_questions.lock().unwrap() = questions;
        Ok(())
    }

    pub(crate) fn observe_user_question_event(&self, event: &EventMsg) {
        self.user_questions.lock().unwrap().observe(event);
    }

    pub(super) fn validate_question_replies(&self, content: &[UserInput]) -> Result<()> {
        let state = self.user_questions.lock().unwrap();
        for input in content {
            if let UserInput::Text { text, .. } = input {
                state.validate(&reply_ids(text)?)?;
            }
        }
        Ok(())
    }

    /// A typed queued reply cannot smuggle an ordinary request through the hold.
    pub(super) fn validate_queued_question_reply(&self, content: &[UserInput]) -> Result<()> {
        let ids = queued_reply_ids(content)?;
        self.user_questions.lock().unwrap().validate(&ids)
    }

    pub(super) async fn accept_question_replies(&self, content: &[UserInput]) {
        let changed = self.user_questions.lock().unwrap().answer_content(content);
        if changed {
            self.notify_question_state_changed().await;
        }
    }

    /// Called under input admission, before journaling, to freeze exactly the old questions.
    /// Queue registration never reaches this boundary; accepted queue dispatch does.
    pub(super) fn questions_superseded_by_input(
        &self,
        content: &[UserInput],
        origin: codex_history::UserInputOrigin,
    ) -> Vec<String> {
        if content.is_empty()
            || origin == codex_history::UserInputOrigin::Heartbeat
            || (origin != codex_history::UserInputOrigin::Queue
                && !reply_ids_from_content(content).is_empty())
        {
            return Vec::new();
        }
        self.user_questions.lock().unwrap().pending_ids()
    }

    pub(crate) async fn notify_question_state_changed(&self) {
        self.send_event_raw(Event {
            id: String::new(),
            msg: EventMsg::ThreadQueueChanged(ThreadQueueChangedEvent {
                thread_id: self.thread_id,
            }),
        })
        .await;
    }

    pub(crate) async fn withdraw_user_questions(&self, ids: &[String]) -> Result<()> {
        let _guard = self.root_resume_submission_guard().await;
        self.withdraw_user_questions_under_admission(ids).await
    }

    /// The caller already holds admission, or is restoring the not-yet-published session.
    pub(super) async fn withdraw_user_questions_under_admission(
        &self,
        ids: &[String],
    ) -> Result<()> {
        let updates = {
            let state = self.user_questions.lock().unwrap();
            for id in ids {
                if state.find(id).is_none() {
                    return Err(CodexErr::InvalidRequest(format!(
                        "unknown question ID: {id}"
                    )));
                }
            }
            let answered = state.answered.clone();
            let mut updates = Vec::new();
            for (turn, original) in state.messages.values() {
                let mut item = original.clone();
                let mut changed = false;
                if let Some(qs) = &mut item.questions {
                    for (i, q) in qs.iter_mut().enumerate() {
                        let id = question_id(&item.id, i);
                        if ids.contains(&id) && !answered.contains(&id) && !q.withdrawn {
                            q.withdrawn = true;
                            changed = true;
                        }
                    }
                }
                if changed {
                    updates.push((turn.clone(), item.clone()));
                }
            }
            updates
        };
        let events = updates
            .into_iter()
            .map(|(turn_id, item)| Event {
                id: turn_id.clone(),
                msg: EventMsg::ItemCompleted(ItemCompletedEvent {
                    thread_id: self.thread_id,
                    turn_id,
                    item: TurnItem::AgentMessage(item),
                    started_at_ms: None,
                    completed_at_ms: super::now_unix_timestamp_ms(),
                }),
            })
            .collect::<Vec<_>>();
        if events.is_empty() {
            return Ok(());
        }
        let items = events
            .iter()
            .map(|event| RolloutItem::EventMsg(event.msg.clone()))
            .collect::<Vec<_>>();
        // Keep the live ledger and visible messages unchanged until both append and
        // the durability barrier succeed. The admission guard spans this commit.
        if !self.persist_rollout_items(&items).await {
            return Err(CodexErr::Io(std::io::Error::other(
                "failed to persist question withdrawal",
            )));
        }
        self.flush_rollout().await?;
        for event in events {
            self.send_event_raw_with_persistence(event, false).await;
        }
        self.notify_question_state_changed().await;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use codex_protocol::items::{
        AgentMessageContent, AgentMessageDelivery, AsyncUserInputQuestion,
    };
    use codex_protocol::turn_input::{
        CompactIfIdleSubmission, NotSubmittedReason, TurnInputMode, TurnInputRequest,
        TurnInputSubmission,
    };
    use std::sync::Arc;

    fn questions(thread_id: codex_protocol::ThreadId) -> EventMsg {
        EventMsg::ItemCompleted(ItemCompletedEvent {
            thread_id,
            turn_id: "original-turn".into(),
            started_at_ms: None,
            completed_at_ms: 1,
            item: TurnItem::AgentMessage(AgentMessageItem {
                id: "questions".into(),
                content: vec![AgentMessageContent::Text {
                    text: "First? Second?".into(),
                }],
                phase: None,
                memory_citation: None,
                delivery: Some(AgentMessageDelivery::Async),
                questions: Some(vec![
                    AsyncUserInputQuestion {
                        withdrawn: false,
                        title: "First?".into(),
                        options: None,
                    },
                    AsyncUserInputQuestion {
                        withdrawn: false,
                        title: "Second?".into(),
                        options: None,
                    },
                ]),
            }),
        })
    }

    fn reply(index: usize) -> Vec<UserInput> {
        vec![UserInput::Text {
            text: format!(
                "<send_user_message_question_reply>\n{}\n</send_user_message_question_reply>",
                serde_json::json!([{"questionItemId": question_id("questions", index), "question": "First?", "answer": "Accepted answer"}])
            ),
            text_elements: vec![],
        }]
    }

    fn new_request(text: &str) -> Vec<UserInput> {
        vec![UserInput::Text {
            text: text.into(),
            text_elements: vec![],
        }]
    }

    #[tokio::test]
    async fn async_question_typed_queued_reply_passes_question_hold_without_supersession() {
        let (session, _) = crate::session::tests::make_session_and_context().await;
        let session = Arc::new(session);
        session.observe_user_question_event(&questions(session.thread_id));
        let accepted = super::super::turn_input::handle(
            &session,
            TurnInputRequest::user_input(reply(0)).on_start(
                codex_protocol::turn_input::TurnStartOptions {
                    turn_trigger: Some("queue_question_reply".into()),
                    ..Default::default()
                },
            ),
            TurnInputMode::StartIfIdle,
            "typed-reply".into(),
        )
        .await
        .unwrap();
        assert!(matches!(accepted, TurnInputSubmission::Started { .. }));
        assert_eq!(session.pending_question_count(), 1);
        {
            let state = session.user_questions.lock().unwrap();
            assert!(state.answered.contains(&question_id("questions", 0)));
            assert!(
                !state
                    .find(&question_id("questions", 1))
                    .unwrap()
                    .0
                    .questions
                    .as_ref()
                    .unwrap()[1]
                    .withdrawn
            );
        }
        session
            .abort_all_tasks(codex_protocol::protocol::TurnAbortReason::Interrupted)
            .await;
    }

    #[tokio::test]
    async fn async_question_typed_queued_reply_rejects_plain_unknown_and_withdrawn_input() {
        let (session, _) = crate::session::tests::make_session_and_context().await;
        let session = Arc::new(session);
        session.observe_user_question_event(&questions(session.thread_id));
        session
            .withdraw_user_questions(&[question_id("questions", 0)])
            .await
            .unwrap();
        for content in [new_request("ordinary request"), reply(99), reply(0)] {
            let result = super::super::turn_input::handle(
                &session,
                TurnInputRequest::user_input(content).on_start(
                    codex_protocol::turn_input::TurnStartOptions {
                        turn_trigger: Some("queue_question_reply".into()),
                        ..Default::default()
                    },
                ),
                TurnInputMode::StartIfIdle,
                "invalid-typed-reply".into(),
            )
            .await;
            assert!(result.is_err());
            assert!(session.active_turn.lock().await.is_none());
            assert_eq!(session.pending_question_count(), 1);
        }
    }

    #[tokio::test]
    async fn async_question_new_request_withdraws_only_old_unanswered_questions() {
        let (session, _) = crate::session::tests::make_session_and_context().await;
        session.observe_user_question_event(&questions(session.thread_id));
        // An answer-only input must preserve the other question.
        session
            .journal_user_input(
                &codex_protocol::turn_input::TurnInput::UserInput {
                    content: reply(0),
                    client_id: None,
                },
                &BTreeMap::new(),
                "answer",
                codex_history::UserInputOrigin::User,
            )
            .await
            .unwrap();
        assert_eq!(session.pending_question_count(), 1);
        session
            .journal_user_input(
                &codex_protocol::turn_input::TurnInput::UserInput {
                    content: new_request("A new request"),
                    client_id: None,
                },
                &BTreeMap::new(),
                "new-request",
                codex_history::UserInputOrigin::User,
            )
            .await
            .unwrap();
        assert_eq!(session.pending_question_count(), 0);
        {
            let state = session.user_questions.lock().unwrap();
            assert!(state.answered.contains(&question_id("questions", 0)));
            assert!(
                !state
                    .find(&question_id("questions", 0))
                    .unwrap()
                    .0
                    .questions
                    .as_ref()
                    .unwrap()[0]
                    .withdrawn
            );
            assert!(
                state
                    .find(&question_id("questions", 1))
                    .unwrap()
                    .0
                    .questions
                    .as_ref()
                    .unwrap()[1]
                    .withdrawn
            );
        }
        // A subsequent question belongs to the new request and still blocks the queue.
        let mut newer = questions(session.thread_id);
        let EventMsg::ItemCompleted(event) = &mut newer else {
            unreachable!()
        };
        let TurnItem::AgentMessage(item) = &mut event.item else {
            unreachable!()
        };
        item.id = "newer-questions".into();
        session.observe_user_question_event(&newer);
        assert_eq!(session.pending_question_count(), 2);
        let held = super::super::turn_input::handle(
            &Arc::new(session),
            TurnInputRequest::user_input(new_request("queued")),
            TurnInputMode::StartIfIdle,
            "queue".into(),
        )
        .await
        .unwrap();
        assert!(matches!(
            held,
            TurnInputSubmission::NotSubmitted {
                reason: NotSubmittedReason::NotIdle
            }
        ));
    }

    #[tokio::test]
    async fn async_question_heartbeat_preserves_questions() {
        let (session, _) = crate::session::tests::make_session_and_context().await;
        session.observe_user_question_event(&questions(session.thread_id));
        session
            .journal_user_input(
                &codex_protocol::turn_input::TurnInput::UserInput {
                    content: new_request("Scheduled input"),
                    client_id: None,
                },
                &BTreeMap::new(),
                "heartbeat",
                codex_history::UserInputOrigin::Heartbeat,
            )
            .await
            .unwrap();
        assert_eq!(session.pending_question_count(), 2);
    }

    #[tokio::test]
    async fn async_question_recovery_uses_frozen_ids_and_retry_preserves_new_questions() {
        let home = tempfile::tempdir().unwrap();
        let (session, context, _) = crate::session::tests::make_persistent_session_and_context_with_time_provider_and_history_mode_and_rx(
            home.path(), InitialHistory::New, Arc::new(crate::current_time::SystemTimeProvider),
            "http://127.0.0.1:1/v1".into(), codex_protocol::protocol::ThreadHistoryMode::Paginated,
        ).await.unwrap();
        let old = questions(session.thread_id);
        session.observe_user_question_event(&old);
        assert!(
            session
                .persist_rollout_items(&[RolloutItem::EventMsg(old.clone())])
                .await
        );
        let mut input = codex_protocol::turn_input::TurnInput::UserInput {
            content: new_request("New task"),
            client_id: Some("supersession-client".into()),
        };
        session
            .journal_user_input_with_root(
                &input,
                &BTreeMap::new(),
                &context.sub_id,
                &context.root_turn_id(),
                codex_history::UserInputOrigin::User,
            )
            .await
            .unwrap();
        assert_eq!(session.pending_question_count(), 0);
        let records = session
            .state_db()
            .unwrap()
            .thread_queue()
            .pending_user_inputs(session.thread_id)
            .await
            .unwrap();
        let payload: serde_json::Value =
            serde_json::from_str(records[0].payload_json.as_ref().unwrap()).unwrap();
        let ids: Vec<String> =
            serde_json::from_value(payload["superseded_async_question_ids"].clone()).unwrap();
        assert_eq!(ids.len(), 2);
        let mut newer = old.clone();
        let EventMsg::ItemCompleted(event) = &mut newer else {
            unreachable!()
        };
        let TurnItem::AgentMessage(item) = &mut event.item else {
            unreachable!()
        };
        item.id = "newer-questions".into();
        let history = vec![RolloutItem::EventMsg(old), RolloutItem::EventMsg(newer)];
        // Simulate a crash after custody was saved but before withdrawal was flushed.
        session
            .restore_user_questions(&history, true)
            .await
            .unwrap();
        assert_eq!(session.pending_question_count(), 2);
        assert!(session.validate_question_replies(&reply(0)).is_err());
        assert_eq!(
            crate::CodexThread::pending_question_count_from_history(&history, &[], &ids),
            2
        );
        // Retry must use the original receipt, repair old updates, and keep new questions.
        assert!(
            session
                .accepted_input_retry_with_root(
                    &mut input,
                    &BTreeMap::new(),
                    codex_history::UserInputOrigin::User
                )
                .await
                .unwrap()
                .is_some()
        );
        assert_eq!(session.pending_question_count(), 2);
        assert_eq!(
            session
                .state_db()
                .unwrap()
                .thread_queue()
                .pending_user_inputs(session.thread_id)
                .await
                .unwrap()
                .len(),
            1
        );
        let persisted = session.user_questions.lock().unwrap();
        assert!(
            persisted
                .find(&ids[0])
                .unwrap()
                .0
                .questions
                .as_ref()
                .unwrap()
                .iter()
                .all(|q| q.withdrawn)
        );
        assert!(
            persisted
                .find(&question_id("newer-questions", 0))
                .unwrap()
                .0
                .questions
                .as_ref()
                .unwrap()
                .iter()
                .all(|q| !q.withdrawn)
        );
    }

    #[tokio::test]
    async fn async_question_new_request_write_failure_keeps_custody_and_live_questions() {
        let home = tempfile::tempdir().unwrap();
        let (session, _, _) = crate::session::tests::make_persistent_session_and_context_with_time_provider_and_history_mode_and_rx(
            home.path(), InitialHistory::New, Arc::new(crate::current_time::SystemTimeProvider),
            "http://127.0.0.1:1/v1".into(), codex_protocol::protocol::ThreadHistoryMode::Paginated,
        ).await.unwrap();
        session.observe_user_question_event(&questions(session.thread_id));
        session.live_thread().unwrap().shutdown().await.unwrap();
        assert!(
            session
                .journal_user_input(
                    &codex_protocol::turn_input::TurnInput::UserInput {
                        content: new_request("New task"),
                        client_id: Some("failed-new-task".into())
                    },
                    &BTreeMap::new(),
                    "failed-task",
                    codex_history::UserInputOrigin::User,
                )
                .await
                .is_err()
        );
        assert_eq!(session.pending_question_count(), 2);
        let records = session
            .state_db()
            .unwrap()
            .thread_queue()
            .pending_user_inputs(session.thread_id)
            .await
            .unwrap();
        assert_eq!(records.len(), 1);
        let payload: serde_json::Value =
            serde_json::from_str(records[0].payload_json.as_ref().unwrap()).unwrap();
        assert_eq!(
            payload["superseded_async_question_ids"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }

    #[test]
    fn async_question_materialization_retains_answers_and_withdrawals() {
        let thread_id = codex_protocol::ThreadId::new();
        let first = questions(thread_id);
        let mut update = first.clone();
        let EventMsg::ItemCompleted(event) = &mut update else {
            unreachable!()
        };
        let TurnItem::AgentMessage(message) = &mut event.item else {
            unreachable!()
        };
        message.questions.as_mut().unwrap()[1].withdrawn = true;
        let accepted = RolloutItem::ResponseItem(codex_history::ResponseItemEnvelope { item: serde_json::from_value(serde_json::json!({"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Accepted answer"}]})).unwrap(), metadata: Some(codex_history::CodexHarnessMetadata { answered_async_question_ids: vec![question_id("questions", 0)], ..Default::default() }) });
        let encoded = serde_json::to_string(&vec![
            RolloutItem::EventMsg(first),
            accepted,
            RolloutItem::EventMsg(update),
        ])
        .unwrap();
        let restored: Vec<RolloutItem> = serde_json::from_str(&encoded).unwrap();
        let state = UserQuestions::from_history(&restored);
        assert_eq!(state.pending_count(), 0);
        assert!(state.answered.contains(&question_id("questions", 0)));
        assert!(state.validate(&[question_id("questions", 0)]).is_ok());
        assert!(state.validate(&[question_id("questions", 1)]).is_err());
        assert!(state.validate(&["unknown".into()]).is_err());
        assert_eq!(
            question_id("questions", 1),
            r#"["request_user_input_async","questions",1]"#
        );
    }

    #[tokio::test]
    async fn async_question_partial_and_all_withdrawal_hold_idle_and_compaction() {
        let (session, _) = crate::session::tests::make_session_and_context().await;
        let session = Arc::new(session);
        session.observe_user_question_event(&questions(session.thread_id));
        assert_eq!(session.pending_question_count(), 2);
        let input = TurnInputRequest::user_input(vec![UserInput::Text {
            text: "queued message".into(),
            text_elements: vec![],
        }]);
        let held = super::super::turn_input::handle(
            &session,
            input.clone(),
            TurnInputMode::StartIfIdle,
            "queue-attempt".into(),
        )
        .await
        .unwrap();
        assert!(matches!(
            held,
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
        assert!(session.active_turn.lock().await.is_none());
        session
            .withdraw_user_questions(&[question_id("questions", 0)])
            .await
            .unwrap();
        assert_eq!(session.pending_question_count(), 1);
        session
            .withdraw_user_questions(&[question_id("questions", 0)])
            .await
            .unwrap();
        assert_eq!(session.pending_question_count(), 1);
        assert!(
            session
                .withdraw_user_questions(&["other-conversation".into()])
                .await
                .is_err()
        );
        session
            .withdraw_user_questions(&[question_id("questions", 1)])
            .await
            .unwrap();
        assert_eq!(session.pending_question_count(), 0);
        assert!(session.validate_question_replies(&reply(0)).is_err());
    }

    #[tokio::test]
    async fn async_question_answer_first_preserves_answer_and_late_reply_is_rejected() {
        let (session, _) = crate::session::tests::make_session_and_context().await;
        let session = Arc::new(session);
        session.observe_user_question_event(&questions(session.thread_id));
        // This is the accepted-input transition called after the durable journal succeeds.
        session.validate_question_replies(&reply(0)).unwrap();
        session.accept_question_replies(&reply(0)).await;
        session
            .withdraw_user_questions(&[question_id("questions", 0)])
            .await
            .unwrap();
        assert!(
            !session
                .user_questions
                .lock()
                .unwrap()
                .find(&question_id("questions", 0))
                .unwrap()
                .0
                .questions
                .as_ref()
                .unwrap()[0]
                .withdrawn
        );
        session
            .withdraw_user_questions(&[question_id("questions", 1)])
            .await
            .unwrap();
        let result = super::super::turn_input::handle(
            &session,
            TurnInputRequest::user_input(reply(1)),
            TurnInputMode::StartOrSteer,
            "late-answer".into(),
        )
        .await;
        assert!(result.is_err());
        assert!(session.active_turn.lock().await.is_none());
        assert_eq!(session.pending_question_count(), 0);
    }

    #[tokio::test]
    async fn async_question_explicit_queue_start_supersedes_pending_questions() {
        let (session, _) = crate::session::tests::make_session_and_context().await;
        let session = Arc::new(session);
        session.observe_user_question_event(&questions(session.thread_id));
        let request = TurnInputRequest::user_input(reply(0)).on_start(
            codex_protocol::turn_input::TurnStartOptions {
                turn_trigger: Some("queue_user".into()),
                ..Default::default()
            },
        );
        let accepted = super::super::turn_input::handle(
            &session,
            request,
            TurnInputMode::StartIfIdle,
            "explicit-queue".into(),
        )
        .await
        .unwrap();
        assert!(matches!(accepted, TurnInputSubmission::Started { .. }));
        assert_eq!(session.pending_question_count(), 0);
        assert!(session.user_questions.lock().unwrap().answered.is_empty());
        session
            .abort_all_tasks(codex_protocol::protocol::TurnAbortReason::Interrupted)
            .await;
    }

    #[tokio::test]
    async fn async_question_queue_envelopes_hold_until_explicit_acceptance() {
        for reply_index in [0, 99] {
            let (session, _) = crate::session::tests::make_session_and_context().await;
            let session = Arc::new(session);
            session.observe_user_question_event(&questions(session.thread_id));
            session
                .withdraw_user_questions(&[question_id("questions", 0)])
                .await
                .unwrap();
            let input = reply(reply_index);
            // The same payload is a rejected late/unknown reply when sent directly.
            assert!(
                super::super::turn_input::handle(
                    &session,
                    TurnInputRequest::user_input(input.clone()),
                    TurnInputMode::StartOrSteer,
                    "direct-reply".into()
                )
                .await
                .is_err()
            );
            assert!(session.active_turn.lock().await.is_none());
            let queued = |trigger: &str| {
                TurnInputRequest::user_input(input.clone()).on_start(
                    codex_protocol::turn_input::TurnStartOptions {
                        turn_trigger: Some(trigger.into()),
                        ..Default::default()
                    },
                )
            };
            let held = super::super::turn_input::handle(
                &session,
                queued("queue"),
                TurnInputMode::StartIfIdle,
                "automatic-queue".into(),
            )
            .await
            .unwrap();
            assert!(matches!(
                held,
                TurnInputSubmission::NotSubmitted {
                    reason: NotSubmittedReason::NotIdle
                }
            ));
            assert_eq!(session.pending_question_count(), 1);
            let explicit = super::super::turn_input::handle(
                &session,
                queued("queue_user"),
                TurnInputMode::StartIfIdle,
                "explicit-queue".into(),
            )
            .await
            .unwrap();
            assert!(matches!(explicit, TurnInputSubmission::Started { .. }));
            assert_eq!(session.pending_question_count(), 0);
            session
                .abort_all_tasks(codex_protocol::protocol::TurnAbortReason::Interrupted)
                .await;
        }
    }

    #[tokio::test]
    async fn async_question_automatic_queue_accepts_reply_shaped_text_after_hold_clears() {
        for reply_index in [0, 99] {
            let (session, _) = crate::session::tests::make_session_and_context().await;
            let session = Arc::new(session);
            session.observe_user_question_event(&questions(session.thread_id));
            session
                .withdraw_user_questions(&[
                    question_id("questions", 0),
                    question_id("questions", 1),
                ])
                .await
                .unwrap();
            let request = TurnInputRequest::user_input(reply(reply_index)).on_start(
                codex_protocol::turn_input::TurnStartOptions {
                    turn_trigger: Some("queue".into()),
                    ..Default::default()
                },
            );
            let accepted = super::super::turn_input::handle(
                &session,
                request,
                TurnInputMode::StartIfIdle,
                "automatic-queue".into(),
            )
            .await
            .unwrap();
            assert!(matches!(accepted, TurnInputSubmission::Started { .. }));
            assert_eq!(session.pending_question_count(), 0);
            assert!(session.user_questions.lock().unwrap().answered.is_empty());
            session
                .abort_all_tasks(codex_protocol::protocol::TurnAbortReason::Interrupted)
                .await;
        }
    }

    #[test]
    fn async_question_replay_does_not_infer_answers_from_user_message_text() {
        let thread_id = codex_protocol::ThreadId::new();
        let UserInput::Text { text, .. } = &reply(0)[0] else {
            unreachable!()
        };
        let history = vec![
            RolloutItem::EventMsg(questions(thread_id)),
            RolloutItem::EventMsg(EventMsg::UserMessage(
                codex_protocol::protocol::UserMessageEvent {
                    message: text.clone(),
                    ..Default::default()
                },
            )),
        ];
        assert_eq!(UserQuestions::from_history(&history).pending_count(), 2);
    }

    #[test]
    fn async_question_both_queue_triggers_restore_as_queue_origin() {
        for trigger in ["queue", "queue_user"] {
            let origin = codex_history::UserInputOrigin::from_turn_trigger(Some(trigger));
            assert_eq!(origin, codex_history::UserInputOrigin::Queue);
            assert_eq!(serde_json::to_value(origin).unwrap(), "queue");
        }
    }

    #[tokio::test]
    async fn async_question_failed_persistence_retains_pending_hold_and_visible_message() {
        let home = tempfile::tempdir().unwrap();
        let (session, _, events) = crate::session::tests::make_persistent_session_and_context_with_time_provider_and_history_mode_and_rx(
            home.path(), InitialHistory::New, Arc::new(crate::current_time::SystemTimeProvider),
            "http://127.0.0.1:1/v1".into(), codex_protocol::protocol::ThreadHistoryMode::Paginated,
        ).await.unwrap();
        session.observe_user_question_event(&questions(session.thread_id));
        session.live_thread().unwrap().shutdown().await.unwrap();
        assert!(
            session
                .withdraw_user_questions(&[
                    question_id("questions", 0),
                    question_id("questions", 1)
                ])
                .await
                .is_err()
        );
        assert_eq!(session.pending_question_count(), 2);
        assert!(session.validate_question_replies(&reply(0)).is_ok());
        while let Ok(event) = events.try_recv() {
            assert!(!matches!(
                event.msg,
                EventMsg::ItemCompleted(ItemCompletedEvent {
                    item: TurnItem::AgentMessage(_),
                    ..
                })
            ));
        }
        assert!(matches!(
            super::super::compact_input::handle(&session, "held-after-failure".into())
                .await
                .unwrap(),
            CompactIfIdleSubmission::NotSubmitted {
                reason: NotSubmittedReason::NotIdle
            }
        ));
    }
}

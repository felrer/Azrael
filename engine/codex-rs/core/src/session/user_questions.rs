//! Conversation-owned questions, reconstructed from durable lifecycle events.
use super::Session;
use codex_history::{InitialHistory, RolloutItem};
use codex_protocol::error::{CodexErr, Result};
use codex_protocol::items::{AgentMessageItem, TurnItem};
use codex_protocol::protocol::{Event, EventMsg, ItemCompletedEvent, ThreadQueueChangedEvent};
use codex_protocol::user_input::UserInput;
use std::collections::{BTreeMap, HashSet};

#[derive(Default)]
pub(crate) struct UserQuestions {
    messages: BTreeMap<String, (String, AgentMessageItem)>,
    answered: HashSet<String>,
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

impl UserQuestions {
    pub(crate) fn pending_count(&self) -> usize {
        self.messages
            .values()
            .map(|(_, item)| {
                item.questions.as_ref().map_or(0, |qs| {
                    qs.iter()
                        .enumerate()
                        .filter(|(i, q)| {
                            !q.withdrawn && !self.answered.contains(&question_id(&item.id, *i))
                        })
                        .count()
                })
            })
            .sum()
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
                && item
                    .questions
                    .as_ref()
                    .is_some_and(|qs| qs[index].withdrawn)
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

    pub(super) async fn restore_user_questions(&self, history: &InitialHistory) -> Result<()> {
        let items = match history {
            InitialHistory::Resumed(h) => h.history.as_slice(),
            InitialHistory::Forked(h) => h.as_slice(),
            _ => &[],
        };
        let mut questions = UserQuestions::from_history(items);
        if matches!(history, InitialHistory::Resumed(_)) {
            if let Some(path) = self
                .current_rollout_path()
                .await
                .map_err(|e| CodexErr::InvalidRequest(e.to_string()))?
            {
                let (items, id, errors) =
                    codex_rollout::RolloutRecorder::load_rollout_items(&path).await?;
                if id != Some(self.thread_id) || errors != 0 {
                    return Err(CodexErr::InvalidRequest(
                        "incomplete question history".into(),
                    ));
                }
                questions = UserQuestions::from_history(&items);
            }
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

    pub(super) async fn accept_question_replies(&self, content: &[UserInput]) {
        let changed = self.user_questions.lock().unwrap().answer_content(content);
        if changed {
            self.notify_question_state_changed().await;
        }
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
    async fn async_question_explicit_queue_start_preserves_pending_questions() {
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
        assert_eq!(session.pending_question_count(), 2);
        session
            .abort_all_tasks(codex_protocol::protocol::TurnAbortReason::Interrupted)
            .await;
    }

    #[tokio::test]
    async fn async_question_queue_envelopes_skip_reply_validation_and_preserve_holds() {
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
            assert_eq!(session.pending_question_count(), 1);
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

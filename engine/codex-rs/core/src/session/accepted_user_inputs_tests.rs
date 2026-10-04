use super::*;
use crate::session::tests::make_persistent_session_and_context_with_time_provider_and_history_mode_and_rx;
use crate::session::tests::make_persistent_session_and_context_with_time_provider_and_rx;
use codex_history::InitialHistory;
use codex_protocol::protocol::ThreadHistoryMode;
use codex_protocol::turn_input::TurnInputMode;
use codex_protocol::turn_input::TurnInputRequest;
use codex_protocol::turn_input::TurnInputSubmission;

fn submitted(client_id: &str) -> SubmittedTurnInput {
    SubmittedTurnInput::UserInput {
        content: vec![UserInput::Text {
            text: "same text".into(),
            text_elements: Vec::new(),
        }],
        client_id: Some(client_id.into()),
    }
}

async fn persistent_session(home: &std::path::Path) -> Arc<Session> {
    make_persistent_session_and_context_with_time_provider_and_history_mode_and_rx(
        home,
        InitialHistory::New,
        Arc::new(crate::current_time::SystemTimeProvider),
        "http://127.0.0.1:1/v1".into(),
        ThreadHistoryMode::Paginated,
    )
    .await
    .unwrap()
    .0
}

#[tokio::test]
async fn same_id_returns_original_turn_and_new_id_accepts_same_text() {
    let home = tempfile::tempdir().unwrap();
    let session = persistent_session(home.path()).await;
    let context = BTreeMap::new();
    session
        .journal_user_input(
            &submitted("one"),
            &context,
            "original",
            UserInputOrigin::User,
        )
        .await
        .unwrap();
    let mut retry = submitted("one");
    assert_eq!(
        session
            .accepted_input_retry(&mut retry, &context, UserInputOrigin::User)
            .await
            .unwrap(),
        Some("original".into())
    );
    let mut new_input = submitted("two");
    assert_eq!(
        session
            .accepted_input_retry(&mut new_input, &context, UserInputOrigin::User)
            .await
            .unwrap(),
        None
    );
    session
        .journal_user_input(&new_input, &context, "second", UserInputOrigin::User)
        .await
        .unwrap();
    let records = session
        .state_db()
        .unwrap()
        .thread_queue()
        .pending_user_inputs(session.thread_id)
        .await
        .unwrap();
    assert_eq!(records.len(), 2);
    let result = super::super::turn_input::handle(
        &session,
        TurnInputRequest {
            input: submitted("one"),
            ..TurnInputRequest::user_input(Vec::new())
        },
        TurnInputMode::StartOrSteer,
        "retry".into(),
    )
    .await
    .unwrap();
    assert_eq!(
        result,
        TurnInputSubmission::Steered {
            turn_id: "original".into()
        }
    );
    assert!(session.active_turn.lock().await.is_none());
}

#[tokio::test]
async fn closed_journal_returns_submission_error_without_ack_or_enqueue() {
    let home = tempfile::tempdir().unwrap();
    let session = persistent_session(home.path()).await;
    session.state_db().unwrap().close().await;
    let result = super::super::turn_input::handle(
        &session,
        TurnInputRequest {
            input: submitted("one"),
            ..TurnInputRequest::user_input(Vec::new())
        },
        TurnInputMode::StartOrSteer,
        "submit".into(),
    )
    .await;
    assert!(result.is_err());
    assert!(session.active_turn.lock().await.is_none());
    assert!(
        session
            .input_queue
            .get_pending_input(&session.active_turn)
            .await
            .0
            .is_empty()
    );
}

#[tokio::test]
async fn recovery_records_once_without_sampling_and_seeds_order_floor() {
    let home = tempfile::tempdir().unwrap();
    let session = persistent_session(home.path()).await;
    session
        .state
        .lock()
        .await
        .history
        .ensure_input_order_floor(500);
    session
        .journal_user_input(
            &submitted("one"),
            &BTreeMap::new(),
            "original",
            UserInputOrigin::User,
        )
        .await
        .unwrap();
    session.recover_accepted_user_inputs().await;
    assert!(
        session
            .state_db()
            .unwrap()
            .thread_queue()
            .pending_user_inputs(session.thread_id)
            .await
            .unwrap()
            .is_empty()
    );
    let before = session.clone_history().await.raw_items().count();
    session.recover_accepted_user_inputs().await;
    assert_eq!(session.clone_history().await.raw_items().count(), before);
    assert!(session.active_turn.lock().await.is_none());
    assert!(session.reserve_user_input_order().await > 500);
    assert_eq!(
        session
            .state_db()
            .unwrap()
            .thread_queue()
            .user_input_receipt(session.thread_id, "one")
            .await
            .unwrap()
            .unwrap()
            .turn_id,
        "original"
    );
}

#[tokio::test]
async fn history_append_failure_retains_pending_receipt() {
    let home = tempfile::tempdir().unwrap();
    let session = persistent_session(home.path()).await;
    let order = session
        .journal_user_input(
            &submitted("one"),
            &BTreeMap::new(),
            "original",
            UserInputOrigin::User,
        )
        .await
        .unwrap();
    session.live_thread().unwrap().shutdown().await.unwrap();
    let context = session.new_accepted_input_context("original".into()).await;
    let SubmittedTurnInput::UserInput { content, client_id } = submitted("one") else {
        unreachable!()
    };
    assert!(
        !session
            .record_user_prompt_and_emit_turn_item(
                &context,
                context.model_info(),
                &content,
                client_id,
                UserInputMetadata {
                    acceptance_order: order,
                    origin: UserInputOrigin::User
                },
                PersistContext::Standard
            )
            .await
    );
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
}

#[test]
fn reconciliation_only_matches_user_with_original_turn_and_order() {
    let item = ResponseItem::Message {
        id: None,
        role: "user".into(),
        content: Vec::new(),
        phase: None,
        internal_chat_message_metadata_passthrough: None,
    };
    let mut envelope = codex_history::ResponseItemEnvelope::new(item);
    envelope.item.set_turn_id_if_missing("original");
    envelope.metadata = Some(codex_history::CodexHarnessMetadata {
        user_input_order: Some(42),
        ..Default::default()
    });
    assert!(recorded_receipt(
        &RolloutItem::ResponseItem(envelope.clone()),
        "original",
        42
    ));
    assert!(!recorded_receipt(
        &RolloutItem::ResponseItem(envelope.clone()),
        "different",
        42
    ));
    if let ResponseItem::Message { role, .. } = &mut envelope.item {
        *role = "assistant".into();
    }
    assert!(!recorded_receipt(
        &RolloutItem::ResponseItem(envelope),
        "original",
        42
    ));
}

#[tokio::test]
async fn pending_receipt_survives_session_drop_and_explicit_resume() {
    let home = tempfile::tempdir().unwrap();
    let session = make_persistent_session_and_context_with_time_provider_and_rx(
        home.path(),
        InitialHistory::New,
        Arc::new(crate::current_time::SystemTimeProvider),
        "http://127.0.0.1:1/v1".into(),
    )
    .await
    .unwrap()
    .0;
    let thread_id = session.thread_id;
    session
        .journal_user_input(
            &submitted("restart"),
            &BTreeMap::new(),
            "original",
            UserInputOrigin::User,
        )
        .await
        .unwrap();
    session
        .try_ensure_rollout_materialized(PersistContext::Standard)
        .await
        .unwrap();
    session.flush_rollout().await.unwrap();
    session.live_thread().unwrap().shutdown().await.unwrap();
    drop(session);
    let (resumed, _context, _events) =
        make_persistent_session_and_context_with_time_provider_and_rx(
            home.path(),
            InitialHistory::Resumed(codex_history::ResumedHistory {
                conversation_id: thread_id,
                history: Arc::new(Vec::new()),
                rollout_path: None,
            }),
            Arc::new(crate::current_time::SystemTimeProvider),
            "http://127.0.0.1:1/v1".into(),
        )
        .await
        .unwrap();
    assert!(resumed.active_turn.lock().await.is_none());
    let history = resumed.clone_history().await;
    assert!(history.raw_items().any(|item| matches!(item, ResponseItem::Message { role, internal_chat_message_metadata_passthrough: Some(metadata), .. }
        if role == "user" && metadata.turn_id.as_deref() == Some("original"))));
    assert!(
        resumed
            .state_db()
            .unwrap()
            .thread_queue()
            .pending_user_inputs(thread_id)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn absent_client_id_keeps_identical_submissions_independent() {
    let home = tempfile::tempdir().unwrap();
    let session = persistent_session(home.path()).await;
    let mut input = submitted("unused");
    if let SubmittedTurnInput::UserInput { client_id, .. } = &mut input {
        *client_id = None;
    }
    for turn_id in ["first", "second"] {
        session
            .journal_user_input(&input, &BTreeMap::new(), turn_id, UserInputOrigin::User)
            .await
            .unwrap();
    }
    let records = session
        .state_db()
        .unwrap()
        .thread_queue()
        .pending_user_inputs(session.thread_id)
        .await
        .unwrap();
    assert_eq!(records.len(), 2);
    assert_ne!(records[0].receipt_id, records[1].receipt_id);
}

#[test]
fn journal_payload_preserves_context_classification_and_complete_user_input() {
    let SubmittedTurnInput::UserInput { content, .. } = submitted("one") else {
        unreachable!()
    };
    let additional_context = BTreeMap::from([
        (
            "app".into(),
            AdditionalContextEntry {
                value: "trusted app context".into(),
                kind: AdditionalContextKind::Application,
            },
        ),
        (
            "external".into(),
            AdditionalContextEntry {
                value: "external context".into(),
                kind: AdditionalContextKind::Untrusted,
            },
        ),
    ]);
    let payload = AcceptedPayload {
        content,
        additional_context,
        origin: UserInputOrigin::User,
    };
    let json = serde_json::to_string(&payload).unwrap();
    let restored: AcceptedPayload = serde_json::from_str(&json).unwrap();
    assert_eq!(restored.content, payload.content);
    assert_eq!(restored.additional_context, payload.additional_context);
    assert_eq!(restored.origin, payload.origin);
}

#[tokio::test]
async fn raw_user_crash_midpoint_repairs_identity_and_spans_without_duplicate_model_input() {
    for (warm_resume, client_id) in [
        (false, Some("exact client ID with spaces".to_owned())),
        (false, None),
        (true, Some("exact client ID with spaces".to_owned())),
        (true, None),
    ] {
        let home = tempfile::tempdir().unwrap();
        let session = persistent_session(home.path()).await;
        let content = vec![UserInput::Text {
            text: "span text".into(),
            text_elements: vec![codex_protocol::user_input::TextElement::new(
                (0..4).into(),
                Some("span".into()),
            )],
        }];
        let input = SubmittedTurnInput::UserInput {
            content: content.clone(),
            client_id: client_id.clone(),
        };
        let order = session
            .journal_user_input(&input, &BTreeMap::new(), "original", UserInputOrigin::User)
            .await
            .unwrap()
            .unwrap();
        let context = session.new_accepted_input_context("original".into()).await;
        let raw = codex_history::ResponseItemEnvelope {
            item: session.response_item_from_user_input(content.clone()),
            metadata: Some(codex_history::CodexHarnessMetadata {
                user_input_order: Some(order),
                ..Default::default()
            }),
        };
        assert!(
            session
                .record_annotated_conversation_items_checked(
                    &context,
                    context.model_info(),
                    vec![raw]
                )
                .await
        );
        session
            .try_ensure_rollout_materialized(PersistContext::Standard)
            .await
            .unwrap();
        session.flush_rollout().await.unwrap();
        let path = session
            .live_thread()
            .unwrap()
            .local_rollout_path()
            .await
            .unwrap()
            .unwrap();
        let history = codex_rollout::RolloutRecorder::get_rollout_history(&path)
            .await
            .unwrap();
        drop(context);
        let resumed = if warm_resume {
            session
                .recover_accepted_user_inputs_on_resume()
                .await
                .unwrap();
            session
        } else {
            session.live_thread().unwrap().shutdown().await.unwrap();
            drop(session);
            make_persistent_session_and_context_with_time_provider_and_history_mode_and_rx(
                home.path(),
                history,
                Arc::new(crate::current_time::SystemTimeProvider),
                "http://127.0.0.1:1/v1".into(),
                ThreadHistoryMode::Paginated,
            )
            .await
            .unwrap()
            .0
        };
        assert!(resumed.active_turn.lock().await.is_none());
        assert!(
            resumed
                .state_db()
                .unwrap()
                .thread_queue()
                .pending_user_inputs(resumed.thread_id)
                .await
                .unwrap()
                .is_empty()
        );
        let path = resumed
            .live_thread()
            .unwrap()
            .local_rollout_path()
            .await
            .unwrap()
            .unwrap();
        let repaired = codex_rollout::RolloutRecorder::get_rollout_history(&path)
            .await
            .unwrap();
        let InitialHistory::Resumed(repaired) = repaired else {
            panic!("expected resumed history");
        };
        let canonical = repaired
            .history
            .iter()
            .filter_map(|entry| match entry {
                RolloutItem::EventMsg(EventMsg::ItemCompleted(event))
                    if event.turn_id == "original" =>
                {
                    match &event.item {
                        TurnItem::UserMessage(item) => Some(item),
                        _ => None,
                    }
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(canonical.len(), 1);
        assert_eq!(canonical[0].client_id, client_id);
        assert_eq!(canonical[0].content, content);
        assert_eq!(
            resumed
                .clone_history()
                .await
                .raw_items()
                .filter(|item| matches!(item, ResponseItem::Message { role, .. } if role == "user"))
                .count(),
            1
        );
        assert_eq!(
            repaired
                .history
                .iter()
                .filter(|entry| recorded_receipt(entry, "original", order))
                .count(),
            1
        );
        assert!(
            resumed
                .reconcile_accepted_user_inputs(&repaired.history)
                .await
        );
        resumed.recover_accepted_user_inputs().await;
        let InitialHistory::Resumed(again) =
            codex_rollout::RolloutRecorder::get_rollout_history(&path)
                .await
                .unwrap()
        else {
            panic!("expected resumed history");
        };
        assert_eq!(
            serde_json::to_value(&again.history).unwrap(),
            serde_json::to_value(&repaired.history).unwrap()
        );
    }
}

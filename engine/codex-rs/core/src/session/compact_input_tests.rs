use super::*;
use crate::session::tests::make_session_and_context;
use crate::session::tests::make_session_and_context_with_rx;
use codex_protocol::protocol::TokenUsage;

fn usage(total: i64, window: Option<i64>) -> TokenUsageInfo {
    TokenUsageInfo {
        response_performance: None,
        context_policy: None,
        total_token_usage: TokenUsage::default(),
        last_token_usage: TokenUsage {
            total_tokens: total,
            ..TokenUsage::default()
        },
        model_context_window: window,
    }
}

#[test]
fn exact_threshold_and_invalid_data() {
    for (total, window, expected) in [
        (79_999, Some(1_000_000), true),
        (80_000, Some(1_000_000), false),
        (80_001, Some(1_000_000), false),
        (0, Some(1000), true),
        (-1, Some(1000), false),
        (79_999, None, true),
        (79_999, Some(0), true),
        (79_999, Some(-1), true),
        (80_000, None, false),
        (80_000, Some(272_000), false),
        (i64::MAX, Some(i64::MAX), false),
    ] {
        assert_eq!(
            below_compaction_threshold(Some(&usage(total, window))),
            expected
        );
    }
    assert!(!below_compaction_threshold(None));
}

#[tokio::test]
async fn skip_releases_idle_reservation_and_uses_latest_usage() {
    let (session, _, rx) = make_session_and_context_with_rx().await;
    session
        .state
        .lock()
        .await
        .set_token_info(Some(usage(80_001, Some(1_000_000))));
    session
        .state
        .lock()
        .await
        .set_token_info(Some(usage(79_999, Some(1_000_000))));
    assert_eq!(
        handle(&session, "compact-skip".to_string()).await.unwrap(),
        CompactIfIdleSubmission::Skipped
    );
    assert!(session.active_turn.lock().await.is_none());
    let event = rx
        .try_recv()
        .expect("skip must notify the user without starting a turn");
    assert_eq!(event.id, "compact-skip");
    let EventMsg::Warning(warning) = event.msg else {
        panic!("expected a compaction skip warning");
    };
    assert_eq!(
        warning.message,
        "Context compaction skipped: context usage is below 80,000 tokens."
    );
    assert!(rx.try_recv().is_err(), "one notice per skipped request");
}

#[tokio::test]
async fn unknown_usage_and_exact_threshold_start_compaction() {
    for snapshot in [
        None,
        Some(usage(80_000, Some(1_000_000))),
        Some(usage(80_001, Some(1_000_000))),
        Some(usage(-1, Some(1000))),
        Some(usage(80_000, None)),
    ] {
        let (session, _) = make_session_and_context().await;
        let session = Arc::new(session);
        session.state.lock().await.set_token_info(snapshot);
        assert_eq!(
            handle(&session, "compact-start".to_string()).await.unwrap(),
            CompactIfIdleSubmission::Started {
                turn_id: "compact-start".to_string()
            }
        );
        session
            .abort_all_tasks(codex_protocol::protocol::TurnAbortReason::Interrupted)
            .await;
    }
}

#[tokio::test]
async fn occupied_idle_reservation_is_preserved() {
    let (session, _) = make_session_and_context().await;
    let session = Arc::new(session);
    let reserved = {
        let mut active = session.active_turn.lock().await;
        Arc::clone(&active.get_or_insert_with(ActiveTurn::default).turn_state)
    };
    assert_eq!(
        handle(&session, "compact-busy".to_string()).await.unwrap(),
        CompactIfIdleSubmission::NotSubmitted {
            reason: NotSubmittedReason::NotIdle
        }
    );
    let active = session.active_turn.lock().await;
    assert!(Arc::ptr_eq(&active.as_ref().unwrap().turn_state, &reserved));
}

#[tokio::test]
async fn pending_trigger_mailbox_is_preserved() {
    let (session, _) = make_session_and_context().await;
    let session = Arc::new(session);
    session
        .input_queue
        .enqueue_mailbox_communication(
            codex_protocol::protocol::InterAgentCommunication::new(
                codex_protocol::AgentPath::root(),
                codex_protocol::AgentPath::root(),
                Vec::new(),
                "pending trigger".to_string(),
                /*trigger_turn*/ true,
            ),
            Default::default(),
        )
        .await;
    assert_eq!(
        handle(&session, "compact-mailbox".to_string())
            .await
            .unwrap(),
        CompactIfIdleSubmission::NotSubmitted {
            reason: NotSubmittedReason::PendingTriggerTurn
        }
    );
    assert!(session.active_turn.lock().await.is_none());
    assert!(session.input_queue.has_trigger_turn_mailbox_items().await);
}

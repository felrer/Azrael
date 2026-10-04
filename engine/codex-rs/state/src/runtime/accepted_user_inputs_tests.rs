use super::*;
use crate::SqliteConfig;
use crate::StateRuntime;
use crate::runtime::test_support::unique_temp_dir;
use codex_utils_absolute_path::test_support::PathExt;
use pretty_assertions::assert_eq;
use std::sync::Arc;

async fn runtime() -> Arc<StateRuntime> {
    let home = unique_temp_dir();
    StateRuntime::init(
        SqliteConfig::new_for_testing(home.as_path().abs()),
        "test-provider".to_string(),
    )
    .await
    .unwrap()
}

fn added(outcome: AcceptUserInputOutcome) -> AcceptedUserInputRecord {
    match outcome {
        AcceptUserInputOutcome::Added(record) => record,
        AcceptUserInputOutcome::Existing(_) => panic!("expected new receipt"),
    }
}

#[tokio::test]
async fn pending_receipt_survives_restart_with_complete_payload() {
    let runtime = runtime().await;
    let thread = ThreadId::new();
    let record = added(
        runtime
            .thread_queue()
            .accept_user_input(
                thread,
                Some("client"),
                "turn",
                /*acceptance_order*/ 8,
                r#"{"text":"hello","attachments":["file"]}"#,
                "digest",
            )
            .await
            .unwrap(),
    );
    let config = runtime.sqlite().clone();
    runtime.close().await;
    let reopened = StateRuntime::init(config, "test-provider".to_string())
        .await
        .unwrap();
    assert_eq!(
        vec![record.clone()],
        reopened
            .thread_queue()
            .pending_user_inputs(thread)
            .await
            .unwrap()
    );
    assert_eq!(
        Some(record),
        reopened
            .thread_queue()
            .user_input_receipt(thread, "client")
            .await
            .unwrap()
    );
    assert_eq!(
        Some(8),
        reopened
            .thread_queue()
            .max_user_input_order(thread)
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn duplicate_and_consumed_retry_retain_original_acknowledgement() {
    let runtime = runtime().await;
    let queue = runtime.thread_queue();
    let thread = ThreadId::new();
    let original = added(
        queue
            .accept_user_input(
                thread,
                Some("client"),
                "original-turn",
                /*acceptance_order*/ 4,
                "{}",
                "digest",
            )
            .await
            .unwrap(),
    );
    for _ in 0..2 {
        assert_eq!(
            AcceptUserInputOutcome::Existing(original.clone()),
            queue
                .accept_user_input(
                    thread,
                    Some("client"),
                    "retry-turn",
                    /*acceptance_order*/ 9,
                    "{}",
                    "digest",
                )
                .await
                .unwrap()
        );
    }
    assert!(
        queue
            .consume_user_input(thread, &original.receipt_id)
            .await
            .unwrap()
    );
    assert!(
        !queue
            .consume_user_input(thread, &original.receipt_id)
            .await
            .unwrap()
    );
    let tombstone = AcceptedUserInputRecord {
        payload_json: None,
        state: AcceptedUserInputState::Consumed,
        ..original
    };
    assert_eq!(
        Some(tombstone.clone()),
        queue.user_input_receipt(thread, "client").await.unwrap()
    );
    assert_eq!(
        AcceptUserInputOutcome::Existing(tombstone),
        queue
            .accept_user_input(
                thread,
                Some("client"),
                "retry-turn",
                /*acceptance_order*/ 10,
                "{}",
                "digest",
            )
            .await
            .unwrap()
    );
    assert!(queue.pending_user_inputs(thread).await.unwrap().is_empty());
    assert_eq!(Some(4), queue.max_user_input_order(thread).await.unwrap());
}

#[tokio::test]
async fn concurrent_same_client_across_runtimes_inserts_once() {
    let runtime = runtime().await;
    let other = StateRuntime::init(runtime.sqlite().clone(), "test-provider".to_string())
        .await
        .unwrap();
    let thread = ThreadId::new();
    let (first, second) = tokio::join!(
        runtime.thread_queue().accept_user_input(
            thread,
            Some("client"),
            "turn-a",
            /*acceptance_order*/ 0,
            "{}",
            "digest"
        ),
        other.thread_queue().accept_user_input(
            thread,
            Some("client"),
            "turn-b",
            /*acceptance_order*/ 1,
            "{}",
            "digest"
        ),
    );
    let record = match (first.unwrap(), second.unwrap()) {
        (AcceptUserInputOutcome::Added(first), AcceptUserInputOutcome::Existing(second))
        | (AcceptUserInputOutcome::Existing(first), AcceptUserInputOutcome::Added(second)) => {
            assert_eq!(first, second);
            first
        }
        outcomes => panic!("expected exactly one insertion: {outcomes:?}"),
    };
    assert_eq!(
        vec![record],
        runtime
            .thread_queue()
            .pending_user_inputs(thread)
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn identical_payload_with_new_or_absent_identity_is_independent() {
    let runtime = runtime().await;
    let queue = runtime.thread_queue();
    let thread = ThreadId::new();
    let mut expected = Vec::new();
    for (order, client) in [Some("a"), Some("b"), None, None].into_iter().enumerate() {
        expected.push(added(
            queue
                .accept_user_input(thread, client, "turn", order as u64, "{}", "digest")
                .await
                .unwrap(),
        ));
    }
    assert_eq!(expected, queue.pending_user_inputs(thread).await.unwrap());
}

#[tokio::test]
async fn conflicting_digest_is_rejected_for_pending_and_consumed_receipts() {
    let runtime = runtime().await;
    let queue = runtime.thread_queue();
    let thread = ThreadId::new();
    let original = added(
        queue
            .accept_user_input(
                thread,
                Some("client"),
                "turn",
                /*acceptance_order*/ 0,
                "{}",
                "digest",
            )
            .await
            .unwrap(),
    );
    assert!(
        queue
            .accept_user_input(
                thread,
                Some("client"),
                "turn",
                /*acceptance_order*/ 1,
                r#"{"changed":true}"#,
                "different",
            )
            .await
            .is_err()
    );
    assert_eq!(
        vec![original.clone()],
        queue.pending_user_inputs(thread).await.unwrap()
    );
    queue
        .consume_user_input(thread, &original.receipt_id)
        .await
        .unwrap();
    assert!(
        queue
            .accept_user_input(
                thread,
                Some("client"),
                "turn",
                /*acceptance_order*/ 1,
                "{}",
                "different",
            )
            .await
            .is_err()
    );
}

#[tokio::test]
async fn thread_isolation_and_cleanup_include_tombstones_and_empty_ordinary_queue() {
    let runtime = runtime().await;
    let queue = runtime.thread_queue();
    let first = ThreadId::new();
    let second = ThreadId::new();
    let first_record = added(
        queue
            .accept_user_input(
                first,
                Some("same-client"),
                "turn",
                /*acceptance_order*/ 1,
                "{}",
                "first",
            )
            .await
            .unwrap(),
    );
    let second_record = added(
        queue
            .accept_user_input(
                second,
                Some("same-client"),
                "turn",
                /*acceptance_order*/ 2,
                "{}",
                "second",
            )
            .await
            .unwrap(),
    );
    assert!(
        !queue
            .consume_user_input(second, &first_record.receipt_id)
            .await
            .unwrap()
    );
    assert_eq!(
        None,
        queue
            .user_input_receipt(ThreadId::new(), "same-client")
            .await
            .unwrap()
    );
    queue
        .consume_user_input(first, &first_record.receipt_id)
        .await
        .unwrap();
    assert!(queue.delete_thread_queue(first).await.unwrap());
    assert!(!queue.delete_thread_queue(first).await.unwrap());
    assert_eq!(
        None,
        queue
            .user_input_receipt(first, "same-client")
            .await
            .unwrap()
    );
    assert_eq!(None, queue.max_user_input_order(first).await.unwrap());
    assert_eq!(
        vec![second_record],
        queue.pending_user_inputs(second).await.unwrap()
    );
    queue.enqueue(second, "{}").await.unwrap();
    assert!(queue.delete_thread_queue(second).await.unwrap());
    assert!(queue.pending_user_inputs(second).await.unwrap().is_empty());
    assert!(
        queue
            .list_page(second, /*offset*/ 0, /*limit*/ 10)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn ordering_capacity_and_concurrent_final_slot_are_transactional() {
    let runtime = runtime().await;
    let other = StateRuntime::init(runtime.sqlite().clone(), "test-provider".to_string())
        .await
        .unwrap();
    let queue = runtime.thread_queue();
    let thread = ThreadId::new();
    assert_eq!(None, queue.max_user_input_order(thread).await.unwrap());
    let mut records = Vec::new();
    for order in (0..MAX_QUEUE_ITEMS - 1).rev() {
        records.push(added(
            queue
                .accept_user_input(
                    thread,
                    Some(&format!("client-{order}")),
                    "turn",
                    order as u64,
                    "{}",
                    "digest",
                )
                .await
                .unwrap(),
        ));
    }
    records.reverse();
    assert_eq!(records, queue.pending_user_inputs(thread).await.unwrap());
    let (first, second) = tokio::join!(
        queue.accept_user_input(
            thread,
            Some("final-a"),
            "turn",
            /*acceptance_order*/ 99,
            "{}",
            "digest"
        ),
        other.thread_queue().accept_user_input(
            thread,
            Some("final-b"),
            "turn",
            /*acceptance_order*/ 100,
            "{}",
            "digest"
        ),
    );
    assert_ne!(first.is_ok(), second.is_ok());
    let retained = queue.pending_user_inputs(thread).await.unwrap();
    assert_eq!(MAX_QUEUE_ITEMS, retained.len());
    assert!(
        queue
            .accept_user_input(
                thread,
                Some("overflow"),
                "turn",
                /*acceptance_order*/ 101,
                "{}",
                "digest",
            )
            .await
            .unwrap_err()
            .to_string()
            .contains("capacity")
    );
    assert_eq!(
        None,
        queue.user_input_receipt(thread, "overflow").await.unwrap()
    );
    assert_eq!(
        AcceptUserInputOutcome::Existing(records[0].clone()),
        queue
            .accept_user_input(
                thread,
                Some("client-0"),
                "retry",
                /*acceptance_order*/ 101,
                "{}",
                "digest",
            )
            .await
            .unwrap()
    );
    queue
        .consume_user_input(thread, &records[0].receipt_id)
        .await
        .unwrap();
    queue
        .accept_user_input(
            thread,
            Some("after-consume"),
            "turn",
            /*acceptance_order*/ 102,
            "{}",
            "digest",
        )
        .await
        .unwrap();
    assert_eq!(Some(102), queue.max_user_input_order(thread).await.unwrap());
}

#[tokio::test]
async fn out_of_range_order_fails_without_insertion() {
    let runtime = runtime().await;
    let thread = ThreadId::new();
    assert!(
        runtime
            .thread_queue()
            .accept_user_input(thread, Some("client"), "turn", u64::MAX, "{}", "digest",)
            .await
            .is_err()
    );
    assert!(
        runtime
            .thread_queue()
            .pending_user_inputs(thread)
            .await
            .unwrap()
            .is_empty()
    );
}

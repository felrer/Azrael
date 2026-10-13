//! Protect request identity/ownership and durable active-time accounting.
use super::*;
use crate::runtime::test_support::unique_temp_dir;
use codex_utils_absolute_path::test_support::PathExt;

fn request() -> ParentRequest {
    ParentRequest {
        request_id: "request-1".into(),
        request_key: "choice".into(),
        parent_thread_id: "parent".into(),
        child_thread_id: "child".into(),
        child_task_id: "task".into(),
        question: "Which route?".into(),
        context: "Two supported routes".into(),
        recommendation: "Route A".into(),
        blocked_action: "Deploy".into(),
        status: ParentRequestStatus::Pending,
        delivery_state: ParentRequestDeliveryState::Queued,
        delivery_reason: None,
        response: None,
        created_at_ms: 1000,
        updated_at_ms: 1000,
    }
}

fn wait() -> ParentResponseWait {
    ParentResponseWait {
        wait_id: "wait-1".into(),
        request_id: "request-1".into(),
        child_task_id: "task".into(),
        child_thread_id: "child".into(),
        originating_call_id: "call-1".into(),
        started_at_ms: 1100,
        parked_at_ms: None,
        last_checkpoint_at_ms: 1100,
        ended_at_ms: None,
        measured_active_ms: 0,
        result: None,
        resume_settings: None,
    }
}

#[tokio::test]
async fn parent_request_identity_response_and_delivery() -> Result<()> {
    let path = unique_temp_dir();
    let runtime = StateRuntime::init(
        crate::SqliteConfig::new_for_testing(path.as_path().abs()),
        "test".into(),
    )
    .await?;
    let original = request();
    assert_eq!(runtime.create_parent_request(&original).await?, original);
    let mut retry = original.clone();
    retry.request_id = "new-id".into();
    retry.created_at_ms = 2000;
    assert_eq!(runtime.create_parent_request(&retry).await?, original);
    for field in 0..4 {
        let mut conflicting = retry.clone();
        match field {
            0 => conflicting.question.push('!'),
            1 => conflicting.context.push('!'),
            2 => conflicting.recommendation.push('!'),
            _ => conflicting.blocked_action.push('!'),
        }
        assert!(runtime.create_parent_request(&conflicting).await.is_err());
    }
    assert_eq!(
        runtime.list_pending_parent_requests("parent").await?,
        vec![original.clone()]
    );
    assert!(
        runtime
            .list_pending_parent_requests("other")
            .await?
            .is_empty()
    );
    let delivered = runtime
        .set_parent_request_delivery(
            &original.request_id,
            ParentRequestDeliveryState::Blocked,
            Some("parent_busy".into()),
            2200,
        )
        .await?;
    assert_eq!(delivered.status, ParentRequestStatus::Pending);
    assert!(
        runtime
            .set_parent_request_delivery(
                &original.request_id,
                ParentRequestDeliveryState::Blocked,
                Some("private context text".into()),
                2300
            )
            .await
            .is_err()
    );
    runtime
        .set_parent_request_delivery(
            &original.request_id,
            ParentRequestDeliveryState::Delivered,
            Some("request_delivered".into()),
            2400,
        )
        .await?;
    let response = ParentResponse {
        status: ParentRequestStatus::Resolved,
        decision: "A".into(),
        reason: "Available".into(),
        retry_condition: None,
    };
    assert!(
        runtime
            .respond_parent_request(&original.request_id, "other", &response, 3000)
            .await
            .is_err()
    );
    let answered = runtime
        .respond_parent_request(&original.request_id, "parent", &response, 3000)
        .await?;
    assert_eq!(answered.delivery_state, ParentRequestDeliveryState::Queued);
    assert_eq!(answered.delivery_reason, None);
    assert_eq!(
        runtime
            .respond_parent_request(&original.request_id, "parent", &response, 4000)
            .await?,
        answered
    );
    let delivered_response = runtime
        .set_parent_request_delivery(
            &original.request_id,
            ParentRequestDeliveryState::Delivered,
            None,
            4100,
        )
        .await?;
    assert_eq!(
        runtime
            .respond_parent_request(&original.request_id, "parent", &response, 4200)
            .await?,
        delivered_response
    );
    let mut conflicting = response;
    conflicting.decision = "B".into();
    assert!(
        runtime
            .respond_parent_request(&original.request_id, "parent", &conflicting, 4000)
            .await
            .is_err()
    );
    assert!(
        runtime
            .list_pending_parent_requests("parent")
            .await?
            .is_empty()
    );

    let mut deferred_request = original;
    deferred_request.request_id = "request-2".into();
    deferred_request.request_key = "later".into();
    runtime.create_parent_request(&deferred_request).await?;
    let mut deferred = ParentResponse {
        status: ParentRequestStatus::Deferred,
        decision: "Wait".into(),
        reason: "Review needed".into(),
        retry_condition: None,
    };
    assert!(
        runtime
            .respond_parent_request("request-2", "parent", &deferred, 5000)
            .await
            .is_err()
    );
    deferred.retry_condition = Some("Review approved".into());
    let persisted = runtime
        .respond_parent_request("request-2", "parent", &deferred, 5000)
        .await?;
    assert_eq!(persisted.response, Some(deferred));
    // A second runtime proves the response is durable, rather than cached.
    let reopened = StateRuntime::init(
        crate::SqliteConfig::new_for_testing(path.as_path().abs()),
        "test".into(),
    )
    .await?;
    assert_eq!(
        reopened.get_parent_request("request-2").await?,
        Some(persisted)
    );
    reopened.close().await;
    runtime.close().await;
    tokio::fs::remove_dir_all(path).await?;
    Ok(())
}

#[tokio::test]
async fn parent_response_wait_checkpoint_recovery_and_terminal_immutability() -> Result<()> {
    let path = unique_temp_dir();
    let runtime = StateRuntime::init(
        crate::SqliteConfig::new_for_testing(path.as_path().abs()),
        "test".into(),
    )
    .await?;
    runtime.create_parent_request(&request()).await?;
    let initial = wait();
    let mut wrong_owner = initial.clone();
    wrong_owner.child_task_id = "different-task".into();
    assert!(
        runtime
            .create_parent_response_wait(&wrong_owner)
            .await
            .is_err()
    );
    assert_eq!(
        runtime.create_parent_response_wait(&initial).await?,
        initial
    );
    let mut duplicate = initial.clone();
    duplicate.wait_id = "duplicate".into();
    assert_eq!(
        runtime.create_parent_response_wait(&duplicate).await?,
        initial
    );
    duplicate.originating_call_id = "different-call".into();
    assert!(
        runtime
            .create_parent_response_wait(&duplicate)
            .await
            .is_err()
    );
    assert_eq!(
        runtime.list_active_parent_response_waits("child").await?,
        vec![initial]
    );
    assert!(
        runtime
            .list_active_parent_response_waits("other")
            .await?
            .is_empty()
    );
    let checkpoint = runtime
        .checkpoint_parent_response_wait("wait-1", 250, 1500)
        .await?;
    assert_eq!(checkpoint.measured_active_ms, 250);
    assert!(
        runtime
            .checkpoint_parent_response_wait("wait-1", 249, 1600)
            .await
            .is_err()
    );
    let recovered = runtime
        .recover_parent_response_wait("wait-1", 100_000)
        .await?;
    assert_eq!(recovered.measured_active_ms, 250); // Offline gap is never counted.
    assert_eq!(
        recovered.result,
        Some(ParentResponseWaitResult::Interrupted)
    );
    assert_eq!(
        runtime
            .recover_parent_response_wait("wait-1", 200_000)
            .await?,
        recovered
    );
    assert!(
        runtime
            .checkpoint_parent_response_wait("wait-1", 251, 200_000)
            .await
            .is_err()
    );
    assert!(
        runtime
            .end_parent_response_wait("wait-1", ParentResponseWaitResult::Answered, 250, 200_000)
            .await
            .is_err()
    );
    assert!(
        runtime
            .list_active_parent_response_waits("child")
            .await?
            .is_empty()
    );
    let mut fresh = wait();
    fresh.wait_id = "wait-2".into();
    fresh.originating_call_id = "call-2".into();
    runtime.create_parent_response_wait(&fresh).await?;
    let ended = runtime
        .end_parent_response_wait("wait-2", ParentResponseWaitResult::Answered, 20, 210_000)
        .await?;
    assert_eq!(ended.ended_at_ms, Some(210_000));
    assert_eq!(
        runtime
            .end_parent_response_wait("wait-2", ParentResponseWaitResult::Answered, 20, 220_000)
            .await?,
        ended
    );
    runtime.close().await;
    tokio::fs::remove_dir_all(path).await?;
    Ok(())
}

#[tokio::test]
async fn parent_response_wait_rotation_is_atomic_and_idempotent() -> Result<()> {
    let path = unique_temp_dir();
    let runtime = StateRuntime::init(
        crate::SqliteConfig::new_for_testing(path.as_path().abs()),
        "test".into(),
    )
    .await?;
    runtime.create_parent_request(&request()).await?;
    let mut original = wait();
    original.resume_settings = Some(codex_protocol::parent_request::ParentResponseWaitSettings {
        model: "fixture-model".into(),
        provider_id: "fixture-provider".into(),
        reasoning_effort: Some(codex_protocol::openai_models::ReasoningEffort::Medium),
        final_output_json_schema: Some(serde_json::json!({"type": "object"})),
        permission_profile: serde_json::json!({"fixture": "restricted"}),
        approval_policy: serde_json::json!("on-request"),
    });
    runtime.create_parent_response_wait(&original).await?;
    let checkpoint = runtime
        .checkpoint_parent_response_wait("wait-1", 250, 1500)
        .await?;
    let mut next = original.clone();
    next.wait_id = "rotation-fails".into();
    next.started_at_ms = 100_000;
    next.parked_at_ms = Some(100_000);
    next.last_checkpoint_at_ms = 100_000;
    // Fail after the old segment was updated to prove that both writes roll back.
    sqlx::query("CREATE TRIGGER reject_wait_rotation BEFORE INSERT ON parent_response_waits WHEN NEW.wait_id='rotation-fails' BEGIN SELECT RAISE(ABORT,'fixture_insert_failure'); END")
        .execute(runtime.pool.as_ref()).await?;
    assert!(
        runtime
            .rotate_parent_response_wait("wait-1", &next, 100_000)
            .await
            .is_err()
    );
    assert_eq!(
        runtime.get_parent_response_wait("wait-1").await?,
        Some(checkpoint)
    );
    assert!(
        runtime
            .get_parent_response_wait("rotation-fails")
            .await?
            .is_none()
    );

    next.wait_id = "wait-2".into();
    assert_eq!(
        runtime
            .rotate_parent_response_wait("wait-1", &next, 100_000)
            .await?,
        next
    );
    let ended = runtime.get_parent_response_wait("wait-1").await?.unwrap();
    assert_eq!(ended.result, Some(ParentResponseWaitResult::Interrupted));
    assert_eq!(ended.measured_active_ms, 250);
    assert_eq!(ended.ended_at_ms, Some(100_000));
    let mut retry = next.clone();
    retry.wait_id = "wait-retry".into();
    assert_eq!(
        runtime
            .rotate_parent_response_wait("wait-1", &retry, 200_000)
            .await?,
        next
    );
    assert_eq!(
        runtime.list_active_parent_response_waits("child").await?,
        vec![next.clone()]
    );
    assert_eq!(
        runtime.get_parent_response_wait("wait-1").await?,
        Some(ended)
    );
    retry.resume_settings.as_mut().unwrap().model = "different-model".into();
    assert!(
        runtime
            .rotate_parent_response_wait("wait-1", &retry, 200_000)
            .await
            .is_err()
    );
    retry = next.clone();
    retry.originating_call_id = "different-call".into();
    assert!(
        runtime
            .rotate_parent_response_wait("wait-1", &retry, 200_000)
            .await
            .is_err()
    );
    runtime.close().await;
    tokio::fs::remove_dir_all(path).await?;
    Ok(())
}

#[tokio::test]
async fn parent_response_wait_actual_park_is_first_wins_and_separate_from_active_time() -> Result<()>
{
    let path = unique_temp_dir();
    let runtime = StateRuntime::init(
        crate::SqliteConfig::new_for_testing(path.as_path().abs()),
        "test".into(),
    )
    .await?;
    runtime.create_parent_request(&request()).await?;
    let original = wait();
    runtime.create_parent_response_wait(&original).await?;
    // A corrected UTC clock can go backwards between prepare and actual blocking.
    let parked = runtime.begin_parent_response_wait("wait-1", 900).await?;
    let mut expected = original;
    expected.parked_at_ms = Some(900);
    assert_eq!(parked, expected);
    assert_eq!(parked.measured_active_ms, 0);
    assert_eq!(
        runtime.begin_parent_response_wait("wait-1", 900).await?,
        parked
    );
    assert_eq!(
        runtime.begin_parent_response_wait("wait-1", 1200).await?,
        parked
    );
    let checkpoint = runtime
        .checkpoint_parent_response_wait("wait-1", 25, 800)
        .await?;
    assert_eq!(checkpoint.parked_at_ms, Some(900));
    assert_eq!(checkpoint.measured_active_ms, 25);
    assert_eq!(
        runtime.begin_parent_response_wait("wait-1", 400).await?,
        checkpoint
    );
    let ended = runtime
        .end_parent_response_wait("wait-1", ParentResponseWaitResult::Interrupted, 30, 700)
        .await?;
    assert_eq!(ended.measured_active_ms, 30);
    assert_eq!(ended.parked_at_ms, Some(900));
    assert!(
        runtime
            .begin_parent_response_wait("wait-1", 1300)
            .await
            .is_err()
    );
    assert_eq!(
        runtime.get_parent_response_wait("wait-1").await?,
        Some(ended)
    );
    assert!(
        runtime
            .begin_parent_response_wait("missing", 1300)
            .await
            .is_err()
    );
    runtime.close().await;
    tokio::fs::remove_dir_all(path).await?;
    Ok(())
}

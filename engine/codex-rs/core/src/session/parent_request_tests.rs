//! Direct-child decisions wake parked roots independently of child completion.
use super::Session;
use crate::current_time::SystemTimeProvider;
use crate::session::tests::make_persistent_session_and_context_with_time_provider_and_rx;
use codex_history::InitialHistory;
use codex_protocol::AgentPath;
use codex_protocol::ThreadId;
use codex_protocol::models::ResponseItem;
use codex_protocol::models::plaintext_agent_message_content;
use codex_protocol::parent_request::ParentRequest;
use codex_protocol::parent_request::ParentRequestDeliveryState;
use codex_protocol::parent_request::ParentRequestStatus;
use codex_protocol::root_resume::RootResumeState;
use codex_protocol::root_resume::RootResumeWakeReason;
use core_test_support::responses::ev_completed;
use core_test_support::responses::ev_response_created;
use core_test_support::responses::mount_sse_once;
use core_test_support::responses::sse;
use core_test_support::responses::start_mock_server;
use std::sync::Arc;
use std::time::Duration;

fn fixture_request(session: &Session, child: ThreadId) -> ParentRequest {
    ParentRequest {
        presentation: None,
        request_id: "fixture-parent-request".into(),
        request_key: "fixture-decision".into(),
        parent_thread_id: session.thread_id.to_string(),
        child_thread_id: child.to_string(),
        child_task_id: "fixture-child-task".into(),
        question: "Which supported route should the child use?".into(),
        context: "Both routes are available".into(),
        recommendation: "Use route A".into(),
        blocked_action: "Choose the route".into(),
        status: ParentRequestStatus::Pending,
        delivery_state: ParentRequestDeliveryState::Queued,
        delivery_reason: None,
        response: None,
        created_at_ms: 1000,
        updated_at_ms: 1000,
    }
}

async fn request_mail_count(session: &Session, request_id: &str) -> usize {
    let marker = format!("Parent decision request (request_id={request_id})");
    session
        .clone_history()
        .await
        .raw_items()
        .filter(|item| match item {
            ResponseItem::AgentMessage { content, .. } => {
                plaintext_agent_message_content(content).is_some_and(|text| text.contains(&marker))
            }
            _ => false,
        })
        .count()
}

#[tokio::test]
async fn parent_request_wakes_waiting_root_once_without_child_completion() {
    let server = start_mock_server().await;
    let requests = mount_sse_once(
        &server,
        sse(vec![
            ev_response_created("parent-request-response"),
            ev_completed("parent-request-response"),
        ]),
    )
    .await;
    let home = tempfile::tempdir().unwrap();
    let (session, turn, _events) = make_persistent_session_and_context_with_time_provider_and_rx(
        home.path(),
        InitialHistory::New,
        Arc::new(SystemTimeProvider),
        format!("{}/v1", server.uri()),
    )
    .await
    .unwrap();
    let reservation = session
        .prepare_root_resume(
            &turn,
            "parent-request-defer",
            Some(60_000),
            None,
            Vec::new(),
            "fixture dependency".into(),
        )
        .await
        .unwrap();
    assert!(session.defer_root_after_tools(&turn).await.unwrap());
    assert!(session.finish_deferred_root(&turn).await);
    let db = session.state_db().unwrap();
    assert_eq!(
        db.get_root_resume(&reservation.id)
            .await
            .unwrap()
            .unwrap()
            .state,
        RootResumeState::Waiting
    );
    let child = ThreadId::new();
    let mut request = fixture_request(&session, child);
    request.presentation = Some(codex_protocol::parent_request::ParentRequestPresentation {
        parent_turn_id: turn.sub_id.clone(), child_agent_path: AgentPath::try_from("/root/worker").unwrap(),
    });
    db.create_parent_request(&request).await.unwrap();
    assert!(session.ensure_parent_requests_handled().await.is_err());
    session
        .receive_parent_request(
            &request.request_id,
            child,
            AgentPath::try_from("/root/worker").unwrap(),
            AgentPath::root(),
        )
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        while requests.requests().is_empty() || session.active_turn.lock().await.is_some() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(requests.requests().len(), 1);
    let resumed = db.get_root_resume(&reservation.id).await.unwrap().unwrap();
    assert_eq!(
        resumed.wake_reason,
        Some(RootResumeWakeReason::ParentRequest)
    );
    assert_eq!(request_mail_count(&session, &request.request_id).await, 1);
    session
        .receive_parent_request(
            &request.request_id,
            child,
            AgentPath::try_from("/root/worker").unwrap(),
            AgentPath::root(),
        )
        .await
        .unwrap();
    assert_eq!(requests.requests().len(), 1);
    assert!(session.active_turn.lock().await.is_none());
    assert_eq!(request_mail_count(&session, &request.request_id).await, 1);
    assert!(session.ensure_parent_requests_handled().await.is_err());
    session.close_root_resume_runtime().await;
    db.close().await;
}

#[tokio::test]
async fn parent_request_preparing_race_cancels_parking_and_stopped_root_stays_stopped() {
    let server = start_mock_server().await;
    let requests = mount_sse_once(
        &server,
        sse(vec![
            ev_response_created("must-not-start"),
            ev_completed("must-not-start"),
        ]),
    )
    .await;
    let home = tempfile::tempdir().unwrap();
    let (session, turn, _events) = make_persistent_session_and_context_with_time_provider_and_rx(
        home.path(),
        InitialHistory::New,
        Arc::new(SystemTimeProvider),
        format!("{}/v1", server.uri()),
    )
    .await
    .unwrap();
    let reservation = session
        .prepare_root_resume(
            &turn,
            "parent-request-race",
            Some(60_000),
            None,
            Vec::new(),
            "fixture dependency".into(),
        )
        .await
        .unwrap();
    let child = ThreadId::new();
    let mut request = fixture_request(&session, child);
    request.presentation = Some(codex_protocol::parent_request::ParentRequestPresentation {
        parent_turn_id: turn.sub_id.clone(), child_agent_path: AgentPath::try_from("/root/worker").unwrap(),
    });
    let db = session.state_db().unwrap();
    db.create_parent_request(&request).await.unwrap();
    assert!(!session.defer_root_after_tools(&turn).await.unwrap());
    let cancelled = db.get_root_resume(&reservation.id).await.unwrap().unwrap();
    assert_eq!(cancelled.state, RootResumeState::Cancelled);
    assert_eq!(
        cancelled.wake_reason,
        Some(RootResumeWakeReason::ParentRequest)
    );
    assert!(!session.has_root_resume_reservation());
    assert!(!session.finish_deferred_root(&turn).await);
    assert!(requests.requests().is_empty());

    session.mark_interrupted();
    session
        .receive_parent_request(
            &request.request_id,
            child,
            AgentPath::try_from("/root/worker").unwrap(),
            AgentPath::root(),
        )
        .await
        .unwrap();
    let blocked = db
        .get_parent_request(&request.request_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(blocked.delivery_state, ParentRequestDeliveryState::Blocked);
    assert_eq!(
        blocked.delivery_reason.as_deref(),
        Some("parent_explicitly_stopped")
    );
    assert!(session.is_interrupted());
    assert!(session.active_turn.lock().await.is_none());
    assert!(requests.requests().is_empty());
    session.close_root_resume_runtime().await;
    db.close().await;
}

#[tokio::test]
async fn parent_request_activity_emits_stable_interaction_without_task_completion() {
    use codex_protocol::protocol::EventMsg;
    use codex_protocol::items::TurnItem;
    use codex_protocol::protocol::SubAgentActivityKind;
    let (session, turn, events) = crate::session::tests::make_session_and_context_with_rx().await;
    let child = ThreadId::new();
    let mut request = fixture_request(&session, child);
    request.presentation = Some(codex_protocol::parent_request::ParentRequestPresentation {
        parent_turn_id: turn.sub_id.clone(), child_agent_path: AgentPath::try_from("/root/worker").unwrap(),
    });
    for status in [ParentRequestStatus::Pending, ParentRequestStatus::Resolved, ParentRequestStatus::Deferred, ParentRequestStatus::Cancelled] {
        request.status = status;
        session.emit_parent_request_activity(&request).await.unwrap();
        for index in 0..3 {
            let event = events.recv().await.unwrap();
            assert_eq!(event.id, turn.sub_id);
            let activity = match (index, event.msg) {
                (0, EventMsg::ItemStarted(e)) => e.item,
                (1, EventMsg::ItemCompleted(e)) => e.item,
                (2, EventMsg::SubAgentActivity(e)) => {
                    assert_eq!(e.kind, SubAgentActivityKind::Interacted);
                    assert_eq!(e.parent_request.as_ref(), Some(&request));
                    continue;
                }
                _ => panic!("expected activity lifecycle only"),
            };
            let TurnItem::SubAgentActivity(activity) = activity else { panic!("activity") };
            assert_eq!(activity.id, format!("parent-request-{}", request.request_id));
            assert_eq!(activity.kind, SubAgentActivityKind::Interacted);
            assert_eq!(activity.parent_request.as_ref(), Some(&request));
        }
    }
}

use anyhow::Result;
use codex_core::TurnInputRequest;
use codex_protocol::protocol::EventMsg;
use codex_protocol::user_input::UserInput;
use core_test_support::responses;
use core_test_support::streaming_sse::StreamingSseChunk;
use core_test_support::streaming_sse::start_streaming_sse_server;
use core_test_support::test_codex::test_codex;
use core_test_support::wait_for_event;
use pretty_assertions::assert_eq;
use std::io;
use std::time::Duration;
use tokio::sync::oneshot;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn active_turn_blocks_account_switch_until_completion() -> Result<()> {
    let (release_completion, completion_gate) = oneshot::channel();
    let (server, _) = start_streaming_sse_server(vec![vec![
        StreamingSseChunk {
            gate: None,
            body: responses::sse(vec![responses::ev_response_created("active-turn")]),
        },
        StreamingSseChunk {
            gate: Some(completion_gate),
            body: responses::sse(vec![responses::ev_completed("active-turn")]),
        },
    ]])
    .await;
    let test = test_codex().build_with_streaming_server(&server).await?;

    test.codex
        .start_or_steer_turn(TurnInputRequest::user_input(vec![UserInput::Text {
            text: "hold this turn open".to_owned(),
            text_elements: Vec::new(),
        }]))
        .await?;
    server.wait_for_request_count(/*count*/ 1).await;

    let admission = test.thread_manager.auth_manager().azrael_admission();
    let pending_switch = admission.begin_switch()?;
    assert!(pending_switch.try_commit().is_none());
    assert_eq!(
        admission.admit_request().await.unwrap_err().kind(),
        io::ErrorKind::WouldBlock
    );

    release_completion
        .send(())
        .expect("stream completion receiver should remain active");
    wait_for_event(&test.codex, |event| {
        matches!(event, EventMsg::TurnComplete(_))
    })
    .await;

    let commit_guard = tokio::time::timeout(Duration::from_secs(/*secs*/ 5), async {
        loop {
            if let Some(guard) = pending_switch.try_commit() {
                break guard;
            }
            tokio::task::yield_now().await;
        }
    })
    .await?;
    drop(commit_guard);
    drop(pending_switch);
    assert!(admission.admit_request().await.is_ok());

    server.shutdown().await;
    Ok(())
}

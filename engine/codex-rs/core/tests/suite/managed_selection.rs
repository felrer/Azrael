use anyhow::Context;
use codex_core::TurnInputRequest;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::Op;
use codex_protocol::protocol::ThreadSettingsOverrides;
use codex_protocol::user_input::UserInput;
use core_test_support::responses::ev_completed;
use core_test_support::responses::ev_response_created;
use core_test_support::responses::mount_sse_once;
use core_test_support::responses::sse;
use core_test_support::responses::start_mock_server;
use core_test_support::test_codex::test_codex;
use pretty_assertions::assert_eq;
use std::time::Duration;

/// Failed managed admission must leave the previous native provider/model usable.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unavailable_managed_selection_preserves_native_next_turn() -> anyhow::Result<()> {
    let server = start_mock_server().await;
    let mock = mount_sse_once(
        &server,
        sse(vec![ev_response_created("native"), ev_completed("native")]),
    )
    .await;
    let mut builder = test_codex();
    let test = builder.build_with_auto_env(&server).await?;
    let original_model = test.session_configured.model.clone();
    let selection_id = test
        .codex
        .submit(Op::ThreadSettings {
            thread_settings: ThreadSettingsOverrides {
                model: Some("managed/invalid-provider/model".to_string()),
                ..Default::default()
            },
            reply: None,
        })
        .await?;
    let selection_result = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let event = test.codex.next_event().await?;
            if event.id == selection_id {
                return anyhow::Ok(event.msg);
            }
        }
    })
    .await
    .context("managed selection did not return its admission result")??;
    assert!(
        matches!(selection_result, EventMsg::Error(_)),
        "failed managed selection was admitted: {selection_result:?}"
    );
    // Submit plain input: the convenience submit_turn helper reapplies the
    // original model and consumes TurnComplete, which would mask restoration bugs.
    test.codex
        .start_or_steer_turn(TurnInputRequest::user_input(vec![UserInput::Text {
            text: "continue with the admitted native model".to_string(),
            text_elements: Vec::new(),
        }]))
        .await?;
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            match test.codex.next_event().await?.msg {
                EventMsg::TurnComplete(_) => return anyhow::Ok(()),
                EventMsg::Error(error) => {
                    anyhow::bail!("native continuation failed: {}", error.message)
                }
                _ => {}
            }
        }
    })
    .await
    .context("native continuation did not complete after failed managed selection")??;
    assert_eq!(mock.single_request().body_json()["model"], original_model);
    Ok(())
}

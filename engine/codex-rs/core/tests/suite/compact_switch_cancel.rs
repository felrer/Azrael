use anyhow::Result;
use codex_core::TurnInputRequest;
use codex_features::Feature;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::Op;
use codex_protocol::protocol::ThreadSettingsOverrides;
use codex_protocol::user_input::UserInput;
use core_test_support::responses;
use core_test_support::streaming_sse::StreamingSseChunk;
use core_test_support::streaming_sse::start_streaming_sse_server;
use core_test_support::test_codex::test_codex;
use core_test_support::wait_for_event;
use pretty_assertions::assert_eq;

// Complements the three-provider request tests with the public thread API:
// receive B's partial answer, interrupt, select C, then manually compact.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn manual_compact_uses_selection_after_interrupted_response() -> Result<()> {
    let (gate_tx, gate_rx) = tokio::sync::oneshot::channel();
    let (server, _) = start_streaming_sse_server(vec![
        vec![
            StreamingSseChunk {
                gate: None,
                body: responses::sse(vec![
                    responses::ev_response_created("response-b"),
                    responses::ev_assistant_message("message-b", "partial answer from B"),
                ]),
            },
            StreamingSseChunk {
                gate: Some(gate_rx),
                body: responses::sse_completed("response-b"),
            },
        ],
        vec![StreamingSseChunk {
            gate: None,
            body: responses::sse(vec![
                responses::ev_assistant_message("compact-c", "summary by C"),
                responses::ev_completed("response-c"),
            ]),
        }],
    ])
    .await;
    let test = test_codex()
        .with_model("gpt-5.2")
        .with_config(|config| {
            config.model_provider.name = "local-compaction-fixture".to_string();
            config.features.disable(Feature::TokenBudget).unwrap();
        })
        .build_with_streaming_server(&server)
        .await?;
    test.codex
        .start_or_steer_turn(
            TurnInputRequest::user_input(vec![UserInput::Text {
                text: "produce an answer".to_string(),
                text_elements: Vec::new(),
            }])
            .with_thread_settings(ThreadSettingsOverrides {
                model: Some("gpt-5.4".to_string()),
                ..Default::default()
            }),
        )
        .await?;
    tokio::time::timeout(std::time::Duration::from_secs(10), wait_for_event(&test.codex, |event| {
        matches!(event, EventMsg::AgentMessage(message) if message.message == "partial answer from B")
    })).await?;
    test.codex.submit(Op::Interrupt).await?;
    wait_for_event(&test.codex, |event| {
        matches!(event, EventMsg::TurnAborted(_))
    })
    .await;
    drop(gate_tx);
    core_test_support::submit_thread_settings(
        &test.codex,
        ThreadSettingsOverrides {
            model: Some("gpt-5.6-sol".to_string()),
            ..Default::default()
        },
    )
    .await?;
    test.codex.submit(Op::Compact).await?;
    let event = wait_for_event(&test.codex, |event| {
        matches!(event, EventMsg::TurnComplete(_) | EventMsg::Error(_))
    })
    .await;
    assert!(matches!(event, EventMsg::TurnComplete(_)), "{event:?}");
    let requests = server.requests().await;
    assert_eq!(requests.len(), 2);
    let models: Vec<serde_json::Value> = requests
        .iter()
        .map(|request| {
            serde_json::from_slice::<serde_json::Value>(request).unwrap()["model"].clone()
        })
        .collect();
    assert_eq!(
        models,
        vec![
            serde_json::json!("gpt-5.4"),
            serde_json::json!("gpt-5.6-sol")
        ]
    );
    server.shutdown().await;
    Ok(())
}

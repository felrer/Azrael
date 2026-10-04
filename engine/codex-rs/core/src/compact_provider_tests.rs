//! Regression tests for provider routing during compaction.
//!
//! `TurnContext.provider` is the routing authority for each compaction flavor
//! (local stream and compaction-item v2). These tests
//! set up the stale state that previously caused misrouting:
//!
//! * `sess.services.model_client` stays bound to provider A (the provider the
//!   session was created with).
//! * `previous_turn_settings` records an interrupted turn on provider B, and a
//!   real B stream that already produced assistant output is cancelled before
//!   compaction starts.
//! * `turn_context.provider` is switched to provider C (with matching
//!   `config.model_provider` and `model_info`).
//!
//! Each test asserts that only server C receives the compaction HTTP request,
//! that the request uses the current turn's model, and that the session's
//! initial provider A receives nothing.

use std::sync::Arc;
use std::time::Duration;

use crate::Prompt;
use crate::client_common::ResponseEvent;
use crate::session::PreviousTurnSettings;
use crate::session::session::Session;
use crate::session::tests::make_session_and_context_with_auth_and_config_and_rx;
use crate::session::turn_context::TurnContext;
use codex_login::CodexAuth;
use codex_model_provider::SharedModelProvider;
use codex_model_provider::create_model_provider;
use codex_model_provider_info::ModelProviderInfo;
use codex_model_provider_info::WireApi;
use codex_model_provider_info::create_oss_provider_with_base_url;
use codex_models_manager::test_support::construct_model_info_offline_for_tests;
use codex_protocol::models::ContentItem;
use codex_protocol::models::ResponseItem;
use codex_protocol::protocol::Event;
use codex_protocol::user_input::UserInput;
use codex_rollout_trace::InferenceTraceContext;
use core_test_support::responses;
use core_test_support::streaming_sse::StreamingSseChunk;
use core_test_support::streaming_sse::start_streaming_sse_server;
use futures::StreamExt;
use pretty_assertions::assert_eq;
use tokio::sync::oneshot;
use wiremock::MockServer;

const MODEL_C: &str = "gpt-compact-provider-c";
const MODEL_B: &str = "gpt-compact-provider-b";

struct ProviderSwitchFixture {
    sess: Arc<Session>,
    turn_context: Arc<TurnContext>,
    provider_a: SharedModelProvider,
    provider_c: SharedModelProvider,
    server_a: MockServer,
    server_c: MockServer,
    _rx: async_channel::Receiver<Event>,
}

fn provider_info(name: &str, base_uri: &str) -> ModelProviderInfo {
    let mut info = create_oss_provider_with_base_url(base_uri, WireApi::Responses);
    info.name = name.to_string();
    info
}

fn user_message(text: &str) -> ResponseItem {
    ResponseItem::Message {
        id: None,
        role: "user".to_string(),
        content: vec![ContentItem::InputText {
            text: text.to_string(),
        }],
        phase: None,
        internal_chat_message_metadata_passthrough: None,
    }
}

/// Builds a session whose initial model client is bound to provider A, records
/// an interrupted provider-B turn (stale `previous_turn_settings` plus a real B
/// stream cancelled after it produced assistant output), then switches
/// `TurnContext.provider` to provider C.
async fn provider_switch_fixture() -> ProviderSwitchFixture {
    let server_a = MockServer::start().await;
    let server_c = MockServer::start().await;
    // B's second chunk is gated forever: the stream stays open after delivering
    // response.created and one assistant output item, so aborting the consumer
    // represents a response-generated-then-stopped B turn.
    let (b_completed_gate_tx, b_completed_gate_rx) = oneshot::channel::<()>();
    let (server_b, _b_completions) = start_streaming_sse_server(vec![vec![
        StreamingSseChunk {
            gate: None,
            body: responses::sse(vec![
                responses::ev_response_created("resp-b"),
                responses::ev_assistant_message("msg-b", "partial b output"),
            ]),
        },
        StreamingSseChunk {
            gate: Some(b_completed_gate_rx),
            body: responses::sse(vec![responses::ev_completed("resp-b")]),
        },
    ]])
    .await;
    let info_a = provider_info("provider-a", &format!("{}/v1", server_a.uri()));
    let info_b = provider_info("provider-b", &format!("{}/v1", server_b.uri()));
    let info_c = provider_info("provider-c", &format!("{}/v1", server_c.uri()));

    let (sess, mut turn_context, rx) = make_session_and_context_with_auth_and_config_and_rx(
        CodexAuth::from_api_key("Test API Key"),
        Vec::new(),
        |config| {
            config.model_provider = info_a.clone();
        },
    )
    .await;

    let auth_manager = Arc::clone(&sess.services.auth_manager);
    let provider_a = create_model_provider(info_a, Some(Arc::clone(&auth_manager)));
    let provider_b = create_model_provider(info_b, Some(Arc::clone(&auth_manager)));
    let provider_c = create_model_provider(info_c.clone(), Some(auth_manager));

    // Simulate an interrupted turn on provider B: stale recorded settings plus a
    // real B stream cancelled after assistant output was observed.
    sess.set_previous_turn_settings(Some(PreviousTurnSettings {
        model: MODEL_B.to_string(),
        cyber_access_program: turn_context.cyber_access_program,
        comp_hash: None,
        realtime_active: None,
    }))
    .await;
    let mut b_session = sess
        .services
        .model_client
        .session_for_provider(Arc::clone(&provider_b), None);
    let b_prompt = Prompt {
        input: vec![user_message("interrupted b turn")],
        ..Default::default()
    };
    let b_model_info = construct_model_info_offline_for_tests(
        MODEL_B,
        &turn_context.config.to_models_manager_config(),
    );
    let b_telemetry = turn_context.session_telemetry.clone();
    let b_summary = turn_context.reasoning_summary();
    let b_metadata = sess.handoff_responses_metadata(turn_context.as_ref()).await;
    let (b_output_tx, b_output_rx) = oneshot::channel::<()>();
    let b_stream = tokio::spawn(async move {
        let Ok(mut stream) = b_session
            .stream(
                &b_prompt,
                &b_model_info,
                &b_telemetry,
                /*effort*/ None,
                b_summary,
                /*service_tier*/ None,
                &b_metadata,
                &InferenceTraceContext::disabled(),
            )
            .await
        else {
            return;
        };
        while let Some(event) = stream.next().await {
            if matches!(event, Ok(ResponseEvent::OutputItemDone(_))) {
                let _ = b_output_tx.send(());
                break;
            }
        }
        // Keep the interrupted stream alive until the fixture aborts it.
        std::future::pending::<()>().await;
        drop(stream);
    });
    tokio::time::timeout(Duration::from_secs(10), b_output_rx)
        .await
        .expect("b stream should emit assistant output")
        .expect("b output signal");
    b_stream.abort();
    let b_join = b_stream.await.expect_err("b stream task must be aborted");
    assert!(b_join.is_cancelled(), "b stream task must be cancelled");

    let b_requests = server_b.requests().await;
    assert_eq!(
        b_requests.len(),
        1,
        "provider B should only see the cancelled pre-switch stream"
    );
    let b_body: serde_json::Value =
        serde_json::from_slice(&b_requests[0]).expect("b request body should be json");
    assert_eq!(b_body["model"].as_str(), Some(MODEL_B));
    drop(b_completed_gate_tx);
    server_b.shutdown().await;

    // Switch the current turn to provider C. Changing the model string alone is
    // not enough: the provider binding and the pinned model info must move
    // together, as they do for a real provider switch.
    let turn_mut = Arc::get_mut(&mut turn_context).expect("turn context is uniquely owned");
    let mut config_c = (*turn_mut.config).clone();
    config_c.model_provider = info_c;
    config_c.model = Some(MODEL_C.to_string());
    turn_mut.provider = create_model_provider(
        config_c.model_provider.clone(),
        turn_mut.auth_manager.clone(),
    );
    let mut settings_c = (*turn_mut.initial_settings).clone();
    settings_c.model_info = Arc::new(construct_model_info_offline_for_tests(
        MODEL_C,
        &config_c.to_models_manager_config(),
    ));
    turn_mut.config = Arc::new(config_c);
    turn_mut.initial_settings = Arc::new(settings_c);

    ProviderSwitchFixture {
        sess,
        turn_context,
        provider_a,
        provider_c,
        server_a,
        server_c,
        _rx: rx,
    }
}

impl ProviderSwitchFixture {
    /// Asserts the stale-state invariants and that only provider C received the
    /// compaction request carrying the current turn's model.
    async fn assert_only_c_received_compact_request(
        &self,
        mock_c: &core_test_support::responses::ResponseMock,
        expected_path_suffix: &str,
    ) {
        assert!(
            self.sess
                .services
                .model_client
                .new_session()
                .is_for_provider(&self.provider_a),
            "session model client must remain bound to its initial provider A"
        );
        assert!(
            !self
                .sess
                .services
                .model_client
                .new_session()
                .is_for_provider(&self.provider_c),
            "session model client must not silently rebind to provider C"
        );

        let request_c = mock_c.single_request();
        assert!(
            request_c.path().ends_with(expected_path_suffix),
            "provider C should receive {expected_path_suffix}, got {}",
            request_c.path()
        );
        assert_eq!(
            request_c.body_json()["model"].as_str(),
            Some(MODEL_C),
            "compaction request must use the current turn's model"
        );

        let requests_a = self.server_a.received_requests().await.unwrap_or_default();
        assert!(
            requests_a.is_empty(),
            "initial provider A must not receive compaction traffic: {requests_a:?}"
        );
    }
}

#[tokio::test]
async fn local_compact_routes_to_current_turn_provider() {
    let fixture = provider_switch_fixture().await;
    let mock_c = responses::mount_sse_once(
        &fixture.server_c,
        responses::sse(vec![
            responses::ev_response_created("resp-c"),
            responses::ev_assistant_message("msg-c", "compacted by provider c"),
            responses::ev_completed("resp-c"),
        ]),
    )
    .await;

    crate::compact::run_compact_task(
        Arc::clone(&fixture.sess),
        Arc::clone(&fixture.turn_context),
        vec![UserInput::Text {
            text: "compact".to_string(),
            text_elements: Vec::new(),
        }],
    )
    .await
    .expect("local compaction should succeed on provider C");

    fixture
        .assert_only_c_received_compact_request(&mock_c, "/responses")
        .await;
}

#[tokio::test]
async fn remote_compact_v2_routes_to_current_turn_provider() {
    let fixture = provider_switch_fixture().await;
    fixture
        .sess
        .record_conversation_items(
            &fixture.turn_context,
            fixture.turn_context.model_info().as_ref(),
            &[user_message("hello")],
        )
        .await;
    let mock_c = responses::mount_sse_once(
        &fixture.server_c,
        responses::sse(vec![
            responses::ev_response_created("resp-c"),
            serde_json::json!({
                "type": "response.output_item.done",
                "item": {
                    "type": "compaction",
                    "id": "cmp-c",
                    "encrypted_content": "compacted by provider c",
                }
            }),
            responses::ev_completed("resp-c"),
        ]),
    )
    .await;

    // Covers the standalone path, which creates its own client session via
    // `session_for_provider(turn_context.provider)`.
    crate::compact_remote_v2::run_remote_compact_task(
        Arc::clone(&fixture.sess),
        Arc::clone(&fixture.turn_context),
    )
    .await
    .expect("remote compaction v2 should succeed on provider C");

    fixture
        .assert_only_c_received_compact_request(&mock_c, "/responses")
        .await;
}

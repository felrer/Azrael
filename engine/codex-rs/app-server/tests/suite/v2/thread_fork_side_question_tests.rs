use super::*;
use std::time::Duration;

#[tokio::test]
async fn side_question_rejects_invalid_options_and_unloaded_sources() -> Result<()> {
    let server = create_mock_responses_server_repeating_assistant("Done").await;
    let codex_home = TempDir::new()?;
    MockResponsesConfig::new(&server.uri()).write(codex_home.path())?;
    let source = create_fake_rollout(
        codex_home.path(),
        "2025-01-05T12-00-00",
        "2025-01-05T12:00:00Z",
        "Stored context must never substitute for live context",
        Some("mock_provider"),
        /*git_info*/ None,
    )?;
    let mut app = TestAppServer::builder()
        .with_codex_home(codex_home.path())
        .build_initialized()
        .await?;
    let valid = ThreadForkParams {
        thread_id: source,
        ephemeral: true,
        exclude_turns: true,
        side_question: true,
        ..Default::default()
    };
    let mut invalid = vec![
        ThreadForkParams {
            ephemeral: false,
            ..valid.clone()
        },
        ThreadForkParams {
            exclude_turns: false,
            ..valid.clone()
        },
        ThreadForkParams {
            path: Some(codex_home.path().to_path_buf()),
            ..valid.clone()
        },
        ThreadForkParams {
            last_turn_id: Some("turn".into()),
            ..valid.clone()
        },
        ThreadForkParams {
            before_turn_id: Some("turn".into()),
            ..valid.clone()
        },
        ThreadForkParams {
            defer_goal_continuation: true,
            ..valid.clone()
        },
    ];
    for params in invalid.drain(..) {
        let id = app.send_thread_fork_request(params).await?;
        let error = timeout(
            DEFAULT_READ_TIMEOUT,
            app.read_stream_until_error_message(RequestId::Integer(id)),
        )
        .await??;
        assert!(error.error.message.contains("`sideQuestion` requires"));
    }
    let id = app.send_thread_fork_request(valid).await?;
    let error = timeout(
        DEFAULT_READ_TIMEOUT,
        app.read_stream_until_error_message(RequestId::Integer(id)),
    )
    .await??;
    assert!(error.error.message.contains("available live source thread"));
    Ok(())
}

#[test_case::test_case(false; "persisted_parent")]
#[test_case::test_case(true; "ephemeral_parent")]
#[tokio::test]
async fn side_question_snapshots_active_parent_without_interrupting_or_steering_it(
    ephemeral_parent: bool,
) -> Result<()> {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/responses"))
        .respond_with(|request: &wiremock::Request| {
            let body: Value = serde_json::from_slice(&request.body).expect("request JSON");
            let is_side = body["input"]
                .as_array()
                .expect("input")
                .iter()
                .filter(|item| item["role"] == "user")
                .next_back()
                .is_some_and(|item| item.to_string().contains("SIDE_QUESTION_MARKER"));
            let response = ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_string(responses::sse(vec![responses::ev_completed(if is_side {
                    "side"
                } else {
                    "parent"
                })]));
            if is_side {
                response
            } else {
                response.set_delay(Duration::from_secs(10))
            }
        })
        .mount(&server)
        .await;
    let codex_home = TempDir::new()?;
    MockResponsesConfig::new(&server.uri()).write(codex_home.path())?;
    let mut app = TestAppServer::builder()
        .with_codex_home(codex_home.path())
        .build_initialized()
        .await?;
    let id = app
        .send_thread_start_request_with_auto_env(ThreadStartParams {
            ephemeral: Some(ephemeral_parent),
            ..Default::default()
        })
        .await?;
    let ThreadStartResponse { thread: parent, .. } = app.read_response(id).await?;
    let id = app
        .send_turn_start_request(TurnStartParams {
            thread_id: parent.id.clone(),
            input: vec![UserInput::Text {
                text: "ACTIVE_PARENT_MARKER".into(),
                text_elements: Vec::new(),
            }],
            ..Default::default()
        })
        .await?;
    let _: TurnStartResponse = app.read_response(id).await?;
    timeout(DEFAULT_READ_TIMEOUT, async {
        loop {
            if server
                .received_requests()
                .await
                .is_some_and(|requests| !requests.is_empty())
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await?;
    let id = app
        .send_thread_fork_request(ThreadForkParams {
            thread_id: parent.id.clone(),
            ephemeral: true,
            exclude_turns: true,
            side_question: true,
            ..Default::default()
        })
        .await?;
    let ThreadForkResponse {
        thread: side,
        side_question,
        ..
    } = app.read_response(id).await?;
    assert!(
        side_question,
        "require a confirmed tool-free fork before inference"
    );
    assert!(side.ephemeral);
    assert!(side.turns.is_empty());
    assert_eq!(side.forked_from_id, Some(parent.id.clone()));
    app.start_turn_and_wait_for_completion(TurnStartParams {
        thread_id: side.id,
        input: vec![UserInput::Text {
            text: "SIDE_QUESTION_MARKER".into(),
            text_elements: Vec::new(),
        }],
        ..Default::default()
    })
    .await?;
    let requests = server.received_requests().await.expect("requests");
    let body: Value = serde_json::from_slice(&requests.last().expect("side request").body)?;
    assert!(
        body.get("tools")
            .is_none_or(|tools| tools.as_array().is_some_and(Vec::is_empty))
    );
    assert!(body["input"].to_string().contains("ACTIVE_PARENT_MARKER"));
    let id = app
        .send_thread_read_request(ThreadReadParams {
            thread_id: parent.id.clone(),
            include_turns: false,
        })
        .await?;
    let ThreadReadResponse { thread } = app.read_response(id).await?;
    assert!(matches!(thread.status, ThreadStatus::Active { .. }));
    let parent_body: Value = serde_json::from_slice(&requests[0].body)?;
    assert!(
        !parent_body["input"]
            .to_string()
            .contains("SIDE_QUESTION_MARKER")
    );
    Ok(())
}

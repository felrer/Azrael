use super::*;
use pretty_assertions::assert_eq;
use test_case::test_case;

#[test_case(false; "direct_tools")]
#[test_case(true; "code_mode")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deny_all_startup_policy_survives_extension_mutation_and_rejects_dispatch(
    code_mode: bool,
) -> anyhow::Result<()> {
    skip_if_no_network!(Ok(()));
    let server = responses::start_mock_server().await;
    let fixture = test_codex()
        .with_config(move |config| {
            config
                .features
                .set_enabled(codex_features::Feature::CodeMode, code_mode);
        })
        .build_with_auto_env(&server)
        .await?;
    let mut options = StartThreadOptions::new(fixture.config.clone());
    options.config.ephemeral = true;
    options.environments = Some(
        fixture
            .codex
            .environment_selections()
            .await
            .into_iter()
            .map(|selection| selection.into_request())
            .collect(),
    );
    options
        .thread_extension_init
        .insert(SessionIsolation::Isolated);
    options.thread_extension_init.insert(ToolPolicy {
        allowed_tools: Some(Vec::new()),
        ..Default::default()
    });
    options.dynamic_tools = vec![serde_json::from_value(json!({
        "type": "function", "name": "inherited_task", "description": "A host task tool",
        "inputSchema": { "type": "object", "properties": {} }
    }))?];
    let cancelled = CancellationToken::new();
    let tasks = TaskTracker::new();
    let agent = fixture
        .thread_manager
        .start_thread_until(options, cancelled.clone().cancelled_owned(), &tasks)
        .await?;
    agent
        .thread
        .thread_extension_data()
        .insert(ToolPolicy::default());
    let response = responses::mount_sse_sequence(
        &server,
        vec![
            responses::sse(vec![
                responses::ev_function_call("denied-call", "inherited_task", "{}"),
                responses::ev_completed("attempt"),
            ]),
            responses::sse(vec![responses::ev_completed("done")]),
        ],
    )
    .await;
    agent
        .thread
        .start_or_steer_turn(TurnInputRequest::user_input(vec![UserInput::Text {
            text: "Answer without tools".into(),
            text_elements: Vec::new(),
        }]))
        .await?;
    wait_for_event(&agent.thread, |event| {
        matches!(event, EventMsg::TurnComplete(_))
    })
    .await;
    let requests = response.requests();
    assert_eq!(requests.len(), 2);
    for request in &requests {
        assert!(
            request
                .body_json()
                .get("tools")
                .is_none_or(|tools| tools.as_array().is_some_and(Vec::is_empty))
        );
    }
    let output = requests[1].function_call_output("denied-call");
    assert!(output.to_string().contains("unsupported") || output.to_string().contains("not found"));
    cancelled.cancel();
    tasks.close();
    tasks.wait().await;
    fixture.codex.shutdown_and_wait().await?;
    Ok(())
}

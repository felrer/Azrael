//! Model-visible instructions and tools from originator catalog routing.

use super::*;
use codex_models_manager::model_info::model_info_from_slug;
use codex_protocol::openai_models::ApplyPatchToolType;
use codex_protocol::openai_models::ModelVisibility;
use codex_protocol::openai_models::ModelsResponse;
use pretty_assertions::assert_eq;

/// Originator routing supplies the actual turn's instructions and tools without changing legacy callers.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn originator_catalogs_control_turn_instructions_and_tools() -> Result<()> {
    skip_if_no_network!(Ok(()));

    let server = wiremock::MockServer::start().await;
    for (originator, instructions, patch_tool) in [
        ("provider-default", "Default catalog instructions.", None),
        (
            "codex_work_cca",
            "Work catalog instructions.",
            Some(ApplyPatchToolType::Freeform),
        ),
        ("chatgpt_cca", "Chat catalog instructions.", None),
    ] {
        let mut model = model_info_from_slug("gpt-5.5");
        model.visibility = ModelVisibility::List;
        model.use_responses_lite = false;
        model.tool_mode = Some(ToolMode::Direct);
        model.apply_patch_tool_type = patch_tool;
        model
            .model_messages
            .get_or_insert_default()
            .instructions_template = Some(instructions.into());
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/v1/models"))
            .and(wiremock::matchers::header("originator", originator))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(ModelsResponse {
                    models: vec![model],
                }),
            )
            .expect(1)
            .mount(&server)
            .await;
    }
    let mock = mount_sse_sequence(
        &server,
        (1..=5)
            .map(|index| sse(vec![ev_completed(&format!("response-{index}"))]))
            .collect(),
    )
    .await;
    let mut test = test_codex()
        .with_auth(CodexAuth::create_dummy_chatgpt_auth_for_testing())
        .with_config(|config| {
            configure_scenario_catalog(config);
            config.model_catalog = None;
            config.model = Some("gpt-5.5".to_string());
            config
                .model_provider
                .http_headers
                .get_or_insert_default()
                .insert("originator".into(), "provider-default".into());
        })
        .build_with_auto_env(&server)
        .await?;
    test.submit_turn("Describe the task.").await?;
    for originator in ["codex_work_cca", "chatgpt_cca", "unknown", "codex_work_cca"] {
        let started = test
            .thread_manager
            .start_thread(StartThreadOptions {
                metrics_service_name: Some(originator.into()),
                ..test.start_thread_options().await
            })
            .await?;
        test.codex = started.thread;
        test.session_configured = started.session_configured;
        test.submit_turn("Describe the task.").await?;
    }
    let requests = mock.requests();
    assert_eq!(requests.len(), 5);
    for (request, expected) in requests.iter().zip([
        "Default catalog instructions.",
        "Work catalog instructions.",
        "Chat catalog instructions.",
        "Default catalog instructions.",
        "Work catalog instructions.",
    ]) {
        assert_eq!(request.instructions_text(), expected);
    }
    let tools = requests
        .iter()
        .map(|request| {
            request.body_json()["tools"]
                .as_array()
                .expect("Responses tool catalog")
                .clone()
        })
        .collect::<Vec<_>>();
    assert_eq!(tools[0], tools[3]);
    assert_eq!(tools[1], tools[4]);
    assert_eq!(
        tools
            .iter()
            .map(|declarations| declarations
                .iter()
                .any(|tool| tool["name"] == "apply_patch"))
            .collect::<Vec<_>>(),
        vec![false, true, false, false, true],
    );
    server.verify().await;
    Ok(())
}

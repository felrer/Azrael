//! Exercise session-local MCP reloads through the native model/tool loop.

use anyhow::Result;
use codex_features::Feature;
use codex_protocol::openai_models::ToolMode;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::Op;
use core_test_support::responses;
use core_test_support::responses::ResponsesRequest;
use core_test_support::skip_if_no_network;
use core_test_support::skip_if_wine_exec;
use core_test_support::test_codex::test_codex;
use core_test_support::wait_for_event;
use pretty_assertions::assert_eq;
use serde_json::Value;
use serde_json::json;
use std::io::Write;

use super::rmcp_client::remote_aware_environment_id;
use super::rmcp_client::remote_aware_stdio_server_bin;

fn output_json(request: &ResponsesRequest, call_id: &str) -> Result<Value> {
    let (text, success) = request
        .function_call_output_content_and_success(call_id)
        .expect("tool output must reach the next model request");
    assert_ne!(success, Some(false));
    let text = text.expect("tool output must contain text");
    let payload = text
        .split_once("\nOutput:\n")
        .map_or(text.as_str(), |(_, payload)| payload);
    Ok(serde_json::from_str(payload)?)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reload_discovers_tools_in_the_same_turn_and_reconnect_preserves_history() -> Result<()> {
    skip_if_wine_exec!(
        Ok(()),
        "requires a Windows test_stdio_server in the Wine-exec environment"
    );
    skip_if_no_network!(Ok(()));
    let server = responses::start_mock_server().await;
    let command = remote_aware_stdio_server_bin()?;
    let test = test_codex()
        .with_model_info_override("gpt-5.5", |model| {
            model.use_responses_lite = true;
            model.supports_search_tool = false;
            model.tool_mode = Some(ToolMode::Direct);
        })
        .with_config(|config| {
            config
                .features
                .enable(Feature::TokenBudget)
                .expect("enable explicit context-window reset");
            config.model_auto_compact_token_limit = Some(100_000);
        })
        .build_with_auto_env(&server)
        .await?;
    assert!(test.config.mcp_servers.get().is_empty());

    // The session already exists. Only the admitted user's MCP declarations change;
    // model/provider/environment settings supplied by the builder remain in memory.
    let config_path = test.codex_home_path().join("config.toml");
    let declarations = toml::to_string(&json!({
        "mcp_servers": {
            "reload_echo": {
                "command": command,
                "environment_id": remote_aware_environment_id(),
                "env": {
                    "MCP_TEST_VALUE": "loaded-after-session-start",
                    "MCP_TEST_DYNAMIC_SERVER_METADATA": "1",
                },
                "enabled_tools": ["echo"],
                "default_tools_approval_mode": "approve",
            },
        },
    }))?;
    writeln!(
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&config_path)?,
        "\n{declarations}"
    )?;
    let config_bytes = std::fs::read(&config_path)?;

    let calls = [
        ("reload-initial", "functions", "reload_mcp_servers", "{}"),
        (
            "echo-initial",
            "mcp__reload_echo",
            "echo",
            r#"{"message":"first"}"#,
        ),
        ("reload-reuse", "functions", "reload_mcp_servers", "{}"),
        (
            "echo-reused",
            "mcp__reload_echo",
            "echo",
            r#"{"message":"reused"}"#,
        ),
        (
            "reload-reconnect",
            "functions",
            "reload_mcp_servers",
            r#"{"reconnect_servers":["reload_echo"]}"#,
        ),
        (
            "echo-reconnected",
            "mcp__reload_echo",
            "echo",
            r#"{"message":"reconnected"}"#,
        ),
    ];
    let mut sequence = calls
        .iter()
        .enumerate()
        .map(|(index, (call_id, namespace, name, arguments))| {
            let response_id = format!("reload-response-{index}");
            responses::sse(vec![
                responses::ev_response_created(&response_id),
                responses::ev_function_call_with_namespace(call_id, namespace, name, arguments),
                responses::ev_completed(&response_id),
            ])
        })
        .collect::<Vec<_>>();
    sequence.push(responses::sse(vec![
        responses::ev_assistant_message("reload-done", "The reloaded MCP tool completed."),
        responses::ev_completed("reload-final"),
    ]));
    sequence.push(responses::sse(vec![
        responses::ev_assistant_message("after-reset", "The current MCP tools remain available."),
        responses::ev_completed("reload-after-reset"),
    ]));
    let mock = responses::mount_sse_sequence(&server, sequence).await;
    test.submit_text_turn("Reload MCP and use the echo tool, then verify reuse and reconnect.")
        .await?;
    // Token-budget compaction replaces the context window without an extra model call.
    // Its new initial context must materialize the latest complete MCP catalog.
    test.codex.submit(Op::Compact).await?;
    wait_for_event(&test.codex, |event| {
        matches!(event, EventMsg::TurnComplete(_))
    })
    .await;
    test.submit_text_turn("Continue after resetting the context window.")
        .await?;
    test.codex.shutdown_and_wait().await?;

    let requests = mock.requests();
    assert_eq!(requests.len(), calls.len() + 2);
    for pair in requests[..calls.len() + 1].windows(2) {
        assert!(
            pair[1].input().starts_with(&pair[0].input()),
            "reload must append tool changes and results without rewriting prior inputs"
        );
    }
    for (request_index, call_id) in [
        (1, "reload-initial"),
        (3, "reload-reuse"),
        (5, "reload-reconnect"),
    ] {
        let result = output_json(&requests[request_index], call_id)?;
        assert_eq!(result["ready"], true);
        assert_eq!(result["servers"]["reload_echo"], true);
        assert!(result["tool_count"].as_u64().is_some_and(|count| count > 0));
    }
    let initial = output_json(&requests[2], "echo-initial")?;
    let reused = output_json(&requests[4], "echo-reused")?;
    let reconnected = output_json(&requests[6], "echo-reconnected")?;
    for result in [&initial, &reused, &reconnected] {
        assert_eq!(result["env"], "loaded-after-session-start");
        assert!(
            result["echo"]
                .as_str()
                .is_some_and(|label| label.starts_with("rmcp-test-process-"))
        );
    }
    assert_eq!(
        initial["echo"], reused["echo"],
        "default reload reuses the process"
    );
    assert_ne!(
        initial["echo"], reconnected["echo"],
        "explicit reconnect starts a new process"
    );

    let initial_tools = requests[0].inputs_of_type("additional_tools");
    let loaded_tools = requests[1].inputs_of_type("additional_tools");
    let reused_tools = requests[3].inputs_of_type("additional_tools");
    let reconnected_tools = requests[5].inputs_of_type("additional_tools");
    assert!(loaded_tools.len() > initial_tools.len());
    assert_eq!(
        reused_tools, loaded_tools,
        "unchanged catalog adds no definitions"
    );
    assert!(reconnected_tools.len() > reused_tools.len());
    assert!(reconnected_tools.starts_with(&reused_tools));
    // Process-specific tool descriptions must reflect the newly connected server.
    assert!(
        serde_json::to_string(
            reconnected_tools
                .last()
                .expect("reconnected tool definitions")
        )?
        .contains(reconnected["echo"].as_str().expect("process label"))
    );
    let reset_tools = requests[calls.len() + 1].inputs_of_type("additional_tools");
    let reset_catalog = serde_json::to_string(&reset_tools)?;
    assert!(reset_catalog.contains("reload_mcp_servers"));
    assert!(reset_catalog.contains("mcp__reload_echo"));
    assert!(reset_catalog.contains(reconnected["echo"].as_str().expect("current process label")));
    assert!(
        !reset_catalog.contains(initial["echo"].as_str().expect("original process label")),
        "a new context window must not restore the stale server's declaration"
    );
    assert_eq!(
        std::fs::read(config_path)?,
        config_bytes,
        "reload must not write config"
    );
    server.verify().await;
    Ok(())
}

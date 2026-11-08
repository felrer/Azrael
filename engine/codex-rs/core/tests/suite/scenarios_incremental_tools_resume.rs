//! Request-history coverage for adopting incremental tools when initial context is rebuilt.

use anyhow::Result;
use codex_features::Feature;
use codex_login::CodexAuth;
use codex_protocol::openai_models::ToolMode;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::Op;
use core_test_support::responses;
use core_test_support::skip_if_no_network;
use core_test_support::test_codex::TestCodexBuilder;
use core_test_support::test_codex::test_codex;
use core_test_support::wait_for_event;
use pretty_assertions::assert_eq;
use serde_json::json;
use test_case::test_case;

fn builder(incremental_tools: bool, token_budget: bool) -> TestCodexBuilder {
    test_codex()
        .with_auth(CodexAuth::create_dummy_chatgpt_auth_for_testing())
        .with_model_info_override("gpt-5.4", |model| {
            model.use_responses_lite = true;
            model.tool_mode = Some(ToolMode::CodeMode);
        })
        .with_config(move |config| {
            if incremental_tools {
                config
                    .features
                    .enable(Feature::IncrementalTools)
                    .expect("enable incremental tools");
            } else {
                config
                    .features
                    .disable(Feature::IncrementalTools)
                    .expect("disable incremental tools");
            }
            if token_budget {
                config
                    .features
                    .enable(Feature::TokenBudget)
                    .expect("enable token budget");
            }
            config.base_instructions =
                Some("Use the available tools to help the user.".to_string());
            config.model_auto_compact_token_limit = Some(100_000);
            config.code_mode.disable_in_process_fallback = true;
        })
}

#[test_case(true; "window_reset")]
#[test_case(false; "remote_compaction")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn legacy_resume_switches_only_after_window_replacement(token_budget: bool) -> Result<()> {
    skip_if_no_network!(Ok(()));
    let server = responses::start_mock_server().await;
    let mut replies = (1..=2)
        .map(|i| {
            responses::sse(vec![responses::ev_completed_with_tokens(
                &format!("before-{i}"),
                if i == 2 && !token_budget { 100_001 } else { 0 },
            )])
        })
        .collect::<Vec<_>>();
    if !token_budget {
        replies.push(responses::sse(vec![
            json!({"type": "response.output_item.done", "item": {"type": "compaction", "encrypted_content": "COMPACTED_HISTORY"}}),
            responses::ev_completed("compact"),
        ]));
    }
    replies.extend(
        (1..=4).map(|i| responses::sse(vec![responses::ev_completed(&format!("after-{i}"))])),
    );
    let mock = responses::mount_sse_sequence(&server, replies).await;
    let initial = builder(/*incremental_tools*/ false, token_budget)
        .build_with_auto_env(&server)
        .await?;
    initial
        .submit_turn("Begin with the legacy tool prefix.")
        .await?;
    let resumed = builder(/*incremental_tools*/ true, token_budget)
        .restart_with_auto_env(&server, &initial)
        .await?;
    resumed
        .submit_turn("Resume without moving the tool prefix.")
        .await?;
    if token_budget {
        resumed.codex.submit(Op::Compact).await?;
        wait_for_event(&resumed.codex, |event| {
            matches!(event, EventMsg::TurnComplete(_))
        })
        .await;
    }
    // A window reset survives restart; remote compaction runs before the next turn.
    let migrated = builder(/*incremental_tools*/ true, token_budget)
        .restart_with_auto_env(&server, &resumed)
        .await?;
    migrated
        .submit_turn("Continue in the new window with incremental tools.")
        .await?;
    let migrated = builder(/*incremental_tools*/ true, token_budget)
        .restart_with_auto_env(&server, &migrated)
        .await?;
    migrated
        .submit_turn("Resume with the new window unchanged.")
        .await?;
    let changed = builder(/*incremental_tools*/ true, token_budget)
        .with_config(|config| {
            config.update_plan_enabled = true;
            config
                .features
                .disable(Feature::ShellTool)
                .expect("disable shell");
        })
        .restart_with_auto_env(&server, &migrated)
        .await?;
    changed
        .submit_turn("Enable planning and remove shell tools after migration.")
        .await?;
    changed.submit_turn("Continue with the same tools.").await?;
    let requests = mock.requests();
    assert_eq!(requests.len(), if token_budget { 6 } else { 7 });
    assert!(requests[1].input().starts_with(&requests[0].input()));
    assert_eq!(
        requests[1].inputs_of_type("additional_tools"),
        requests[0].inputs_of_type("additional_tools"),
        "enabling the feature on resume must preserve the legacy prefix"
    );
    let next_window = if token_budget { 2 } else { 3 };
    let fresh = &requests[next_window];
    let resumed = &requests[next_window + 1];
    let changed = &requests[next_window + 2];
    let unchanged = &requests[next_window + 3];
    let initial_tools = fresh.inputs_of_type("additional_tools");
    assert_eq!(
        initial_tools.len(),
        1,
        "new windows start with a full catalog"
    );
    assert_eq!(
        initial_tools[0]["tools"],
        requests[0].inputs_of_type("additional_tools")[0]["tools"],
        "unchanged tool definitions survive window replacement"
    );
    assert!(resumed.input().starts_with(&fresh.input()));
    assert_eq!(resumed.inputs_of_type("additional_tools"), initial_tools);
    assert!(changed.input().starts_with(&resumed.input()));
    let updates = changed.inputs_of_type("additional_tools");
    assert_eq!(updates.len(), initial_tools.len() + 1);
    assert!(updates.starts_with(&initial_tools));
    let namespaces = updates.last().expect("planning update")["tools"]
        .as_array()
        .expect("updated namespaces");
    assert_eq!(namespaces.len(), 1);
    assert_eq!(namespaces[0]["name"], "functions");
    let functions = namespaces[0]["tools"]
        .as_array()
        .expect("updated functions");
    assert_eq!(functions.len(), 1);
    assert_eq!(functions[0]["name"], "update_plan");
    let changed_input = changed.input();
    let suffix = &changed_input[resumed.input().len()..];
    let notices = serde_json::to_string(suffix)?;
    assert!(notices.contains("The following tools are no longer available"));
    assert!(notices.contains("functions.exec_command"));
    assert!(notices.contains("functions.write_stdin"));
    assert!(unchanged.input().starts_with(&changed_input));
    assert_eq!(unchanged.inputs_of_type("additional_tools"), updates);

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn disable_incremental_tools_at_next_window() -> Result<()> {
    skip_if_no_network!(Ok(()));
    let server = responses::start_mock_server().await;
    let mock = responses::mount_sse_sequence(
        &server,
        vec![
            responses::sse(vec![responses::ev_completed("initial")]),
            responses::sse(vec![responses::ev_completed("disabled")]),
            responses::sse(vec![
                json!({"type": "response.output_item.done", "item": {"type": "compaction", "encrypted_content": "COMPACTED_HISTORY"}}),
                responses::ev_completed("compact"),
            ]),
            responses::sse(vec![responses::ev_completed("new-window")]),
            responses::sse(vec![responses::ev_completed("resumed")]),
        ],
    )
    .await;
    let session_builder = |enabled| {
        builder(enabled, /*token_budget*/ false).with_model_info_override("gpt-5.4", |model| {
            model.use_responses_lite = true;
            model.tool_mode = Some(ToolMode::Direct);
        })
    };
    let initial = session_builder(/*enabled*/ true)
        .build_with_auto_env(&server)
        .await?;
    initial.submit_turn("Begin with all tools.").await?;
    let disabled_builder = || {
        session_builder(/*enabled*/ false).with_config(|config| {
            config
                .features
                .disable(Feature::ShellTool)
                .expect("disable shell");
        })
    };
    let disabled = disabled_builder()
        .restart_with_auto_env(&server, &initial)
        .await?;
    disabled
        .submit_turn("Disable incremental tools and remove shell tools in the existing window.")
        .await?;
    disabled.codex.submit(Op::Compact).await?;
    wait_for_event(&disabled.codex, |event| {
        matches!(event, EventMsg::TurnComplete(_))
    })
    .await;
    disabled.submit_turn("Continue in the new window.").await?;
    let resumed = disabled_builder()
        .restart_with_auto_env(&server, &disabled)
        .await?;
    resumed.submit_turn("Resume with the same tools.").await?;
    let requests = mock.requests();
    assert_eq!(requests.len(), 5);
    assert!(requests[1].input().starts_with(&requests[0].input()));
    assert_eq!(
        requests[1].inputs_of_type("additional_tools"),
        requests[0].inputs_of_type("additional_tools"),
        "disabling the feature must preserve the existing window's declarations"
    );
    let old_input = requests[0].input();
    let updated_input = requests[1].input();
    let notices = serde_json::to_string(&updated_input[old_input.len()..])?;
    assert!(notices.contains("The following tools are no longer available"));
    assert!(notices.contains("functions.exec_command"));
    assert!(notices.contains("functions.write_stdin"));
    let fresh_tools = requests[3].inputs_of_type("additional_tools");
    assert_eq!(fresh_tools.len(), 1);
    let catalog = serde_json::to_string(&fresh_tools)?;
    assert!(!catalog.contains("exec_command"));
    assert!(!catalog.contains("write_stdin"));
    assert!(catalog.contains("reload_mcp_servers"));
    assert!(requests[4].input().starts_with(&requests[3].input()));
    assert_eq!(requests[4].inputs_of_type("additional_tools"), fresh_tools);

    Ok(())
}

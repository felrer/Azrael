use std::collections::BTreeMap;
use std::sync::Arc;

use crate::config::Config;
use crate::session::step_context::StepContext;
use crate::session::tests::make_session_and_context;
use crate::tools::context::ToolPayload;
use crate::tools::handlers::McpHandler;
use crate::tools::registry::CoreToolRuntime;
use crate::tools::registry::RegisteredTool;
use crate::tools::registry::ToolExposure;
use crate::tools::spec_plan::append_source_tools;
use crate::tools::spec_plan::build_core_tool_registry;
use crate::tools::spec_plan::extension_tool_executors;
use crate::turn_diff_tracker::TurnDiffTracker;
use codex_extension_api::ExtensionData;
use codex_extension_api::ExtensionRegistry;
use codex_extension_api::ExtensionRegistryBuilder;
use codex_extension_api::ResponsesApiTool;
use codex_extension_api::ToolCall as ExtensionToolCall;
use codex_extension_api::ToolExecutor;
use codex_protocol::DEFAULT_FUNCTION_NAMESPACE;
use codex_protocol::dynamic_tools::DynamicToolFunctionSpec;
use codex_protocol::dynamic_tools::DynamicToolNamespaceSpec;
use codex_protocol::dynamic_tools::DynamicToolNamespaceTool;
use codex_protocol::dynamic_tools::DynamicToolSpec;
use codex_protocol::models::ContentItem;
use codex_protocol::models::FunctionCallOutputBody;
use codex_protocol::models::ResponseItem;
use codex_tools::ResponsesApiNamespace;
use codex_tools::ResponsesApiNamespaceTool;
use codex_tools::ToolName;
use codex_tools::ToolSpec;
use codex_tools::default_namespace_description;
use core_test_support::responses::strip_response_item_ids_from_json;
use pretty_assertions::assert_eq;
use serde_json::json;
use tokio_util::sync::CancellationToken;

use super::ChatToolDiscoveryPolicy;
use super::ToolCall;
use super::ToolCallSource;
use super::ToolRouter;
use super::tool_log_payload;

struct ExtensionEchoContributor;

#[tokio::test]
async fn unavailable_tool_marker_rejects_dispatch_even_with_registered_collision() {
    use super::UNAVAILABLE_TOOL_NAMESPACE;
    use crate::function_tool::FunctionCallError;
    use crate::tools::context::ToolCallState;

    let (session, turn) = make_session_and_context().await;
    let session = Arc::new(session);
    let step = StepContext::for_test(Arc::new(turn));
    for collision in [false, true] {
        let tools = if collision {
            vec![mcp_runtime(mcp_tool_info(
                "unavailable-test",
                false,
                UNAVAILABLE_TOOL_NAMESPACE,
                "unknown",
            ))]
        } else {
            Vec::new()
        };
        let router = test_tool_router(&step, tools, Vec::new(), &[]);
        let name = ToolName::namespaced(UNAVAILABLE_TOOL_NAMESPACE, "unknown");
        assert_eq!(router.tool_runtime(&name).is_some(), collision);
        let call = ToolRouter::build_tool_call(ResponseItem::FunctionCall {
            id: None,
            namespace: Some(UNAVAILABLE_TOOL_NAMESPACE.to_string()),
            name: "unknown".to_string(),
            arguments: "{}".to_string(),
            call_id: "unavailable-call".to_string(),
            encrypted_function_args: None,
            internal_chat_message_metadata_passthrough: None,
        })
        .unwrap()
        .unwrap();
        assert_eq!(call.call_id, "unavailable-call");
        let result = router
            .dispatch_tool_call_with_state(
                Arc::clone(&session),
                Arc::clone(&step),
                CancellationToken::new(),
                Arc::new(tokio::sync::Mutex::new(TurnDiffTracker::new())),
                call,
                ToolCallSource::Direct,
                Arc::new(ToolCallState::default()),
            )
            .await;
        assert!(
            matches!(result, Err(FunctionCallError::RespondToModel(message))
            if message == "Tool unknown is not available. Use only tools in the current tool catalog.")
        );
    }
}

#[tokio::test]
async fn unavailable_tool_output_preserves_call_id_and_allows_next_call() -> anyhow::Result<()> {
    use super::UNAVAILABLE_TOOL_NAMESPACE;
    use crate::tools::parallel::ToolCallRuntime;

    let (session, turn) = make_session_and_context().await;
    let step = StepContext::for_test(Arc::new(turn));
    let router = test_tool_router(
        &step,
        Vec::new(),
        [Arc::new(ExtensionEchoExecutor)
            as Arc<
                dyn for<'call> ToolExecutor<ExtensionToolCall<'call>>,
            >],
        &[],
    );
    let step = step.with_tool_router_for_test(Arc::new(router));
    let runtime = ToolCallRuntime::new(
        Arc::new(session),
        step,
        Arc::new(tokio::sync::Mutex::new(TurnDiffTracker::new())),
    );
    for (namespace, name, id, success) in [
        (
            UNAVAILABLE_TOOL_NAMESPACE,
            "unknown",
            "rejected-call",
            false,
        ),
        ("extension/", "echo", "next-call", true),
    ] {
        let output = runtime
            .clone()
            .handle_tool_call(
                ToolCall {
                    tool_name: ToolName::namespaced(namespace, name),
                    call_id: id.to_string(),
                    payload: ToolPayload::Function {
                        arguments: json!({"message": "continue"}).to_string(),
                    },
                    encrypted_function_args: None,
                },
                CancellationToken::new(),
            )
            .await?;
        let ResponseItem::FunctionCallOutput {
            call_id, output, ..
        } = output.item
        else {
            panic!("expected paired function output");
        };
        assert_eq!(call_id.as_deref(), Some(id));
        if success {
            assert_ne!(output.success, Some(false));
        } else {
            assert_eq!(output.success, Some(false));
            let FunctionCallOutputBody::Text(text) = output.body else {
                panic!("expected text tool rejection");
            };
            assert!(text.contains("Tool unknown is not available."));
        }
    }
    Ok(())
}

#[test]
fn tool_log_payload_redacts_plaintext_multi_agent_messages() {
    let payload = ToolPayload::Function {
        arguments: json!({"target": "/root/worker", "message": "secret message"}).to_string(),
    };
    assert_eq!(
        tool_log_payload(&payload, &ToolCallSource::DirectPlaintextMessage),
        "[plaintext arguments]"
    );
    assert_eq!(
        tool_log_payload(&payload, &ToolCallSource::Direct),
        payload.log_payload()
    );
}

#[test]
fn direct_source_accepts_only_expected_plaintext_message_shapes() {
    let source = |namespace: &str, name: &str, encrypted_function_args| {
        ToolCall {
            tool_name: ToolName::namespaced(namespace, name),
            call_id: "call-source".to_string(),
            payload: ToolPayload::Function {
                arguments: json!({"message": "delegated task"}).to_string(),
            },
            encrypted_function_args,
        }
        .direct_source()
    };

    assert_eq!(
        source("collaboration", "followup_task", Some(Vec::new())),
        ToolCallSource::DirectPlaintextMessage
    );
    assert_eq!(
        source("collaboration", "followup_task", None),
        ToolCallSource::Direct
    );
    assert_eq!(
        source(
            "collaboration",
            "followup_task",
            Some(vec!["opaque".to_string()]),
        ),
        ToolCallSource::Direct
    );

    for metadata in [None, Some(Vec::new())] {
        assert_eq!(
            source("azrael_agents", "followup_task", metadata),
            ToolCallSource::DirectPlaintextMessage
        );
    }
    assert_eq!(
        source(
            "azrael_agents",
            "followup_task",
            Some(vec!["malformed-ciphertext".to_string()]),
        ),
        ToolCallSource::Direct
    );
    assert_eq!(
        source("azrael_agents", "wait_agent", None),
        ToolCallSource::Direct
    );
}

#[test]
fn parent_request_direct_sources_preserve_namespace_encryption_and_log_boundaries() {
    for name in [
        "spawn_agent",
        "send_message",
        "followup_task",
        "request_parent",
        "await_parent_response",
        "respond_to_request",
        "wait_agent",
    ] {
        for namespace in ["azrael_agents", "collaboration", "other"] {
            for metadata in [None, Some(Vec::new()), Some(vec!["opaque".to_string()])] {
                let old_message = matches!(name, "spawn_agent" | "send_message" | "followup_task");
                let expected_plaintext = (namespace == "azrael_agents" && name != "wait_agent"
                    && metadata.as_ref().is_none_or(Vec::is_empty))
                    || (namespace == "collaboration" && old_message
                        && metadata.as_ref().is_some_and(Vec::is_empty));
                let payload = ToolPayload::Function {
                    arguments: json!({"question": "private question", "decision": "private answer"})
                        .to_string(),
                };
                let source = ToolCall {
                    tool_name: ToolName::namespaced(namespace, name),
                    call_id: "parent-request-source".into(),
                    payload: payload.clone(),
                    encrypted_function_args: metadata.clone(),
                }
                .direct_source();
                assert_eq!(
                    source == ToolCallSource::DirectPlaintextMessage,
                    expected_plaintext,
                    "{namespace}.{name}: {metadata:?}"
                );
                if expected_plaintext {
                    assert_eq!(tool_log_payload(&payload, &source), "[plaintext arguments]");
                }
            }
        }
    }
}

impl codex_extension_api::ToolContributor for ExtensionEchoContributor {
    fn tools(
        &self,
        _session_store: &ExtensionData,
        _thread_store: &ExtensionData,
    ) -> Vec<Arc<dyn for<'call> ToolExecutor<ExtensionToolCall<'call>>>> {
        vec![Arc::new(ExtensionEchoExecutor)]
    }
}

struct ExtensionEchoExecutor;

impl<'call> ToolExecutor<ExtensionToolCall<'call>> for ExtensionEchoExecutor {
    fn tool_name(&self) -> ToolName {
        ToolName::namespaced("extension/", "echo")
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec::Namespace(ResponsesApiNamespace {
            name: "extension/".to_string(),
            description: default_namespace_description("extension/"),
            tools: vec![ResponsesApiNamespaceTool::Function(ResponsesApiTool {
                name: "echo".to_string(),
                description: "Echoes arguments through an extension tool.".to_string(),
                strict: true,
                parameters: codex_extension_api::parse_tool_input_schema(&json!({
                    "type": "object",
                    "properties": {
                        "message": { "type": "string" },
                    },
                    "required": ["message"],
                    "additionalProperties": false,
                }))
                .expect("extension schema should parse"),
                output_schema: None,
                defer_loading: None,
            })],
        })
    }

    fn handle<'a>(&'a self, call: ExtensionToolCall<'call>) -> codex_tools::ToolExecutorFuture<'a>
    where
        'call: 'a,
    {
        Box::pin(self.handle_call(call))
    }
}

impl ExtensionEchoExecutor {
    async fn handle_call(
        &self,
        call: ExtensionToolCall<'_>,
    ) -> Result<Box<dyn codex_tools::ToolOutput>, codex_tools::FunctionCallError> {
        let arguments: serde_json::Value =
            serde_json::from_str(call.function_arguments()?).expect("test arguments should parse");
        Ok(Box::new(codex_tools::JsonToolOutput::new(json!({
            "arguments": arguments,
            "callId": call.call_id,
            "conversationHistory": call.conversation_history.items(),
            "ok": true,
        }))) as Box<dyn codex_tools::ToolOutput>)
    }
}

fn extension_tool_test_registry() -> Arc<ExtensionRegistry<Config>> {
    let mut builder = ExtensionRegistryBuilder::new();
    builder.tool_contributor(Arc::new(ExtensionEchoContributor));
    Arc::new(builder.build())
}

struct DeferredEchoExecutor;

impl<'call> ToolExecutor<ExtensionToolCall<'call>> for DeferredEchoExecutor {
    fn tool_name(&self) -> ToolName {
        ExtensionEchoExecutor.tool_name()
    }

    fn spec(&self) -> ToolSpec {
        ExtensionEchoExecutor.spec()
    }

    fn exposure(&self) -> ToolExposure {
        ToolExposure::Deferred
    }

    fn handle<'a>(&'a self, call: ExtensionToolCall<'call>) -> codex_tools::ToolExecutorFuture<'a>
    where
        'call: 'a,
    {
        Box::pin(ExtensionEchoExecutor.handle_call(call))
    }
}

#[tokio::test]
async fn anthropic_azrael_tools_patch_read_and_execute() -> anyhow::Result<()> {
    let fixture = tempfile::tempdir()?;
    std::fs::write(fixture.path().join("fixture.txt"), "before\n")?;
    let (session, mut turn, _events) =
        crate::session::tests::make_session_and_context_with_auth_and_config_and_rx(
            codex_login::CodexAuth::from_api_key("Test API Key"),
            Vec::new(),
            |config| {
                config.cwd =
                    codex_utils_absolute_path::AbsolutePathBuf::from_absolute_path(fixture.path())
                        .unwrap();
                config.model_provider_id = "azrael-managed".into();
                config
                    .permissions
                    .set_permission_profile(codex_protocol::models::PermissionProfile::Disabled)
                    .unwrap();
                config.permissions.approval_policy = crate::config::Constrained::allow_any(
                    codex_protocol::protocol::AskForApproval::Never,
                );
            },
        )
        .await;
    crate::session::tests::update_turn_settings_for_test(
        Arc::get_mut(&mut turn).expect("unique turn"),
        |settings| {
            let model = Arc::make_mut(&mut settings.model_info);
            model.slug = "managed/anthropic/future-model".into();
            model.shell_type = codex_protocol::openai_models::ConfigShellToolType::UnifiedExec;
            model.apply_patch_tool_type =
                Some(codex_protocol::openai_models::ApplyPatchToolType::Freeform);
        },
    );
    let step = StepContext::for_test(turn);
    assert!(!step.harness_profile.uses_claude_tools());
    let router = test_tool_router(&step, Vec::new(), Vec::new(), &[]);
    let tracker = Arc::new(tokio::sync::Mutex::new(TurnDiffTracker::new()));
    let calls = [
        ("apply_patch", ToolPayload::Custom { input: "*** Begin Patch\n*** Update File: fixture.txt\n@@\n-before\n+CJ_TOOL_RESULT\n*** End Patch".into() }),
        ("exec_command", ToolPayload::Function { arguments: json!({
            "cmd": if cfg!(windows) { "Get-Content fixture.txt" } else { "cat fixture.txt" },
            "shell": if cfg!(windows) { "powershell.exe" } else { "/bin/sh" },
            "login": false, "tty": false, "yield_time_ms": 10000,
            "workdir": fixture.path(),
        }).to_string() }),
    ];
    for (name, payload) in calls {
        let response = router
            .dispatch_tool_call_with_code_mode_result(
                Arc::clone(&session),
                Arc::clone(&step),
                CancellationToken::new(),
                Arc::clone(&tracker),
                ToolCall {
                    tool_name: ToolName::namespaced(DEFAULT_FUNCTION_NAMESPACE, name),
                    call_id: name.into(),
                    payload,
                    encrypted_function_args: None,
                },
                ToolCallSource::Direct,
            )
            .await?
            .into_response()
            .item;
        let output = serde_json::to_string(&response)?;
        if name == "exec_command" {
            assert!(output.contains("CJ_TOOL_RESULT"), "{output}");
        }
        assert_eq!(
            std::fs::read_to_string(fixture.path().join("fixture.txt"))?,
            "CJ_TOOL_RESULT\n"
        );
    }
    Ok(())
}

#[tokio::test]
async fn claude_tool_search_loads_and_dispatches_a_deferred_tool() -> anyhow::Result<()> {
    let (session, mut turn) = make_session_and_context().await;
    Arc::make_mut(&mut turn.config).model_provider_id = "azrael-managed".to_string();
    let filesystem = turn.initial_environments.primary_filesystem().expect("test filesystem");
    Arc::make_mut(&mut turn.config).harness_profiles =
        codex_config::harness_profiles::HarnessProfiles::load(
            toml::from_str("[providers.anthropic]\nprofile = 'anthropic-default'").unwrap(),
            filesystem.as_ref(),
        ).await?;
    crate::session::tests::update_turn_settings_for_test(&mut turn, |settings| {
        let model = Arc::make_mut(&mut settings.model_info);
        model.slug = "managed/anthropic/future-model".to_string();
        model.supports_search_tool = false;
    });
    let step = StepContext::for_test(Arc::new(turn));
    let router = test_tool_router(
        &step,
        Vec::new(),
        [Arc::new(DeferredEchoExecutor)
            as Arc<
                dyn for<'call> ToolExecutor<ExtensionToolCall<'call>>,
            >],
        &[],
    );
    assert!(
        !router
            .model_visible_specs()
            .iter()
            .any(|spec| spec.name() == "extension/")
    );
    assert!(
        router
            .model_visible_specs()
            .iter()
            .any(|spec| spec.name() == "ToolSearch")
    );
    let session = Arc::new(session);
    let diff = Arc::new(tokio::sync::Mutex::new(TurnDiffTracker::new()));
    let call = |name: &str, namespace: Option<&str>, id: &str, arguments| {
        ToolRouter::build_tool_call(ResponseItem::FunctionCall {
            id: None,
            name: name.to_string(),
            namespace: namespace.map(str::to_string),
            arguments,
            call_id: id.to_string(),
            encrypted_function_args: None,
            internal_chat_message_metadata_passthrough: None,
        })
        .unwrap()
        .unwrap()
    };
    let search = router
        .dispatch_tool_call_with_code_mode_result(
            Arc::clone(&session),
            Arc::clone(&step),
            CancellationToken::new(),
            Arc::clone(&diff),
            call(
                "ToolSearch",
                None,
                "search-echo",
                json!({"query":"echo", "max_results":1}).to_string(),
            ),
            ToolCallSource::Direct,
        )
        .await?
        .into_response()
        .item;
    assert!(
        matches!(&search, ResponseItem::ToolSearchOutput { call_id, execution, status, .. }
        if call_id.as_deref() == Some("search-echo") && execution == "client" && status == "completed")
    );
    let specs =
        router.chat_specs_with_discovered(&[search], ChatToolDiscoveryPolicy::RetainDiscovered);
    assert_eq!(namespace_function_names(&specs, "extension/"), vec!["echo"]);
    let result = router
        .dispatch_tool_call_with_code_mode_result(
            session,
            step,
            CancellationToken::new(),
            diff,
            call(
                "echo",
                Some("extension/"),
                "echo-call",
                json!({"message":"hello"}).to_string(),
            ),
            ToolCallSource::Direct,
        )
        .await?
        .into_response()
        .item;
    let ResponseItem::FunctionCallOutput {
        call_id, output, ..
    } = result
    else {
        panic!("expected tool result");
    };
    assert_eq!(call_id.as_deref(), Some("echo-call"));
    let FunctionCallOutputBody::Text(text) = output.body else {
        panic!("expected text");
    };
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&text)?["arguments"],
        json!({"message":"hello"})
    );
    Ok(())
}

fn test_tool_router(
    step_context: &StepContext,
    mcp_tools: Vec<RegisteredTool>,
    extension_tool_executors: impl IntoIterator<
        Item = Arc<dyn for<'call> ToolExecutor<ExtensionToolCall<'call>>>,
    >,
    dynamic_tools: &[DynamicToolSpec],
) -> ToolRouter {
    let mut registry = build_core_tool_registry(
        step_context.turn.as_ref(),
        step_context.turn.model_info(),
        &step_context.environments,
        step_context.mcp.as_ref(),
        /*tool_suggest_candidates*/ None,
        /*wait_for_environment_tool_config*/ None,
    );
    let hosted_specs = append_source_tools(
        step_context.turn.as_ref(),
        step_context.turn.model_info(),
        &mut registry,
        mcp_tools,
        extension_tool_executors,
        dynamic_tools,
    );
    ToolRouter::from_registry(
        step_context.turn.as_ref(),
        step_context.turn.model_info(),
        registry,
        hosted_specs,
        &Default::default(),
    )
}

#[tokio::test]
async fn parallel_support_does_not_match_namespaced_local_tool_names() -> anyhow::Result<()> {
    let (_, turn) = make_session_and_context().await;
    let turn = Arc::new(turn);
    let step_context = StepContext::for_test(Arc::clone(&turn));
    let router = test_tool_router(
        step_context.as_ref(),
        Vec::new(),
        Vec::new(),
        &turn.dynamic_tools,
    );

    let parallel_tool_name = ["exec_command"]
        .into_iter()
        .find(|name| {
            router.tool_supports_parallel(&ToolCall {
                tool_name: ToolName::plain(*name),
                call_id: "call-parallel-tool".to_string(),
                payload: ToolPayload::Function {
                    arguments: "{}".to_string(),
                },
                encrypted_function_args: None,
            })
        })
        .expect("test session should expose a parallel shell-like tool");

    assert_eq!(
        router
            .tool_runtime(&ToolName::plain(parallel_tool_name))
            .map(|runtime| runtime.tool_name()),
        Some(ToolName::plain(parallel_tool_name))
    );

    assert!(!router.tool_supports_parallel(&ToolCall {
        tool_name: ToolName::namespaced("mcp__server__", parallel_tool_name),
        call_id: "call-namespaced-tool".to_string(),
        payload: ToolPayload::Function {
            arguments: "{}".to_string(),
        },
        encrypted_function_args: None,
    }));

    Ok(())
}

#[tokio::test]
async fn build_tool_call_uses_namespace_for_registry_name() -> anyhow::Result<()> {
    let tool_name = "create_event".to_string();

    let call = ToolRouter::build_tool_call(ResponseItem::FunctionCall {
        id: None,
        name: tool_name.clone(),
        namespace: Some("mcp__codex_apps__calendar".to_string()),
        arguments: "{}".to_string(),
        encrypted_function_args: Some(Vec::new()),
        call_id: "call-namespace".to_string(),
        internal_chat_message_metadata_passthrough: None,
    })?
    .expect("function_call should produce a tool call");

    assert_eq!(
        call.tool_name,
        ToolName::namespaced("mcp__codex_apps__calendar", tool_name)
    );
    assert_eq!(call.call_id, "call-namespace");
    assert_eq!(call.encrypted_function_args, Some(Vec::new()));
    assert_eq!(call.direct_source(), ToolCallSource::Direct);
    match call.payload {
        ToolPayload::Function { arguments } => {
            assert_eq!(arguments, "{}");
        }
        other => panic!("expected function payload, got {other:?}"),
    }

    Ok(())
}

#[tokio::test]
async fn build_custom_tool_call_uses_namespace_for_registry_name() -> anyhow::Result<()> {
    let tool_name = "exec".to_string();

    let call = ToolRouter::build_tool_call(ResponseItem::CustomToolCall {
        id: None,
        status: None,
        call_id: "call-namespace".to_string(),
        name: tool_name.clone(),
        namespace: Some("mcp__python".to_string()),
        input: "print('hello')".to_string(),
        internal_chat_message_metadata_passthrough: None,
    })?
    .expect("custom_tool_call should produce a tool call");

    assert_eq!(
        call,
        ToolCall {
            tool_name: ToolName::namespaced("mcp__python", tool_name),
            call_id: "call-namespace".to_string(),
            payload: ToolPayload::Custom {
                input: "print('hello')".to_string(),
            },
            encrypted_function_args: None,
        }
    );

    Ok(())
}

#[test]
fn build_tool_call_normalizes_default_function_and_custom_namespaces() -> anyhow::Result<()> {
    for namespace in [None, Some(""), Some(DEFAULT_FUNCTION_NAMESPACE)] {
        let function_call = ToolRouter::build_tool_call(ResponseItem::FunctionCall {
            id: None,
            name: "lookup".to_string(),
            namespace: namespace.map(str::to_string),
            arguments: "{}".to_string(),
            encrypted_function_args: None,
            call_id: "call-function".to_string(),
            internal_chat_message_metadata_passthrough: None,
        })?
        .expect("function_call should produce a tool call");
        let custom_call = ToolRouter::build_tool_call(ResponseItem::CustomToolCall {
            id: None,
            status: None,
            call_id: "call-custom".to_string(),
            name: "apply_patch".to_string(),
            namespace: namespace.map(str::to_string),
            input: "patch".to_string(),
            internal_chat_message_metadata_passthrough: None,
        })?
        .expect("custom_tool_call should produce a tool call");

        assert_eq!(
            [function_call.tool_name, custom_call.tool_name],
            [
                ToolName::namespaced(DEFAULT_FUNCTION_NAMESPACE, "lookup"),
                ToolName::namespaced(DEFAULT_FUNCTION_NAMESPACE, "apply_patch"),
            ]
        );
    }

    Ok(())
}

#[tokio::test]
async fn mcp_parallel_support_uses_handler_data() -> anyhow::Result<()> {
    let (_, turn) = make_session_and_context().await;
    let turn = Arc::new(turn);
    let step_context = StepContext::for_test(Arc::clone(&turn));
    let router = test_tool_router(
        step_context.as_ref(),
        vec![
            mcp_runtime(mcp_tool_info(
                "echo",
                /*supports_parallel_tool_calls*/ true,
                "mcp__echo__",
                "query_with_delay",
            )),
            RegisteredTool {
                exposure: ToolExposure::DirectModelOnly,
                ..mcp_runtime(mcp_tool_info(
                    "hello_echo",
                    /*supports_parallel_tool_calls*/ false,
                    "mcp__hello_echo__",
                    "query_with_delay",
                ))
            },
            RegisteredTool {
                exposure: ToolExposure::Hidden,
                ..mcp_runtime(mcp_tool_info(
                    "hidden_echo",
                    /*supports_parallel_tool_calls*/ true,
                    "mcp__hidden_echo__",
                    "query_with_delay",
                ))
            },
            RegisteredTool {
                exposure: ToolExposure::CodeModeOnly,
                ..mcp_runtime(mcp_tool_info(
                    "nested_echo",
                    /*supports_parallel_tool_calls*/ true,
                    "mcp__nested_echo__",
                    "query_with_delay",
                ))
            },
        ],
        Vec::new(),
        &turn.dynamic_tools,
    );

    let call = ToolCall {
        tool_name: ToolName::namespaced("mcp__echo__", "query_with_delay"),
        call_id: "call-handler".to_string(),
        payload: ToolPayload::Function {
            arguments: "{}".to_string(),
        },
        encrypted_function_args: None,
    };
    assert!(router.tool_supports_parallel(&call));
    assert_eq!(
        router
            .tool_runtime(&call.tool_name)
            .map(|runtime| runtime.tool_name()),
        Some(call.tool_name.clone())
    );

    let different_server_call = ToolCall {
        tool_name: ToolName::namespaced("mcp__hello_echo__", "query_with_delay"),
        call_id: "call-other-server".to_string(),
        payload: ToolPayload::Function {
            arguments: "{}".to_string(),
        },
        encrypted_function_args: None,
    };
    assert!(!router.tool_supports_parallel(&different_server_call));
    assert_eq!(
        router
            .tool_runtime(&different_server_call.tool_name)
            .map(|runtime| runtime.tool_name()),
        Some(different_server_call.tool_name.clone())
    );

    let hidden_call = ToolCall {
        tool_name: ToolName::namespaced("mcp__hidden_echo__", "query_with_delay"),
        call_id: "call-hidden".to_string(),
        payload: ToolPayload::Function {
            arguments: "{}".to_string(),
        },
        encrypted_function_args: None,
    };
    assert!(!router.tool_supports_parallel(&hidden_call));
    assert!(router.tool_runtime(&hidden_call.tool_name).is_some());

    let nested_only_call = ToolCall {
        tool_name: ToolName::namespaced("mcp__nested_echo__", "query_with_delay"),
        call_id: "call-nested-only-server".to_string(),
        payload: ToolPayload::Function {
            arguments: "{}".to_string(),
        },
        encrypted_function_args: None,
    };
    assert!(router.tool_supports_parallel(&nested_only_call));

    Ok(())
}

#[tokio::test]
async fn tools_without_handlers_do_not_support_parallel() -> anyhow::Result<()> {
    let (_, turn) = make_session_and_context().await;
    let turn = Arc::new(turn);
    let step_context = StepContext::for_test(Arc::clone(&turn));
    let router = test_tool_router(
        step_context.as_ref(),
        Vec::new(),
        Vec::new(),
        &turn.dynamic_tools,
    );

    assert!(!router.tool_supports_parallel(&ToolCall {
        tool_name: ToolName::plain("web_search"),
        call_id: "call-web-search".to_string(),
        payload: ToolPayload::Function {
            arguments: "{}".to_string(),
        },
        encrypted_function_args: None,
    }));

    Ok(())
}

#[tokio::test]
async fn specs_filter_deferred_dynamic_tools() -> anyhow::Result<()> {
    let (_, turn) = make_session_and_context().await;
    let turn = Arc::new(turn);
    let step_context = StepContext::for_test(Arc::clone(&turn));
    let hidden_tool = "hidden_dynamic_tool";
    let visible_tool = "visible_dynamic_tool";
    let dynamic_tools = vec![DynamicToolSpec::Namespace(DynamicToolNamespaceSpec {
        name: "codex_app".to_string(),
        description: "Codex app tools.".to_string(),
        tools: vec![
            DynamicToolNamespaceTool::Function(DynamicToolFunctionSpec {
                name: hidden_tool.to_string(),
                description: "Hidden until discovered.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false,
                }),
                defer_loading: true,
            }),
            DynamicToolNamespaceTool::Function(DynamicToolFunctionSpec {
                name: visible_tool.to_string(),
                description: "Visible immediately.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false,
                }),
                defer_loading: false,
            }),
        ],
    })];

    let router = test_tool_router(
        step_context.as_ref(),
        Vec::new(),
        Vec::new(),
        &dynamic_tools,
    );
    let visible_specs = router.model_visible_specs();

    assert!(Arc::ptr_eq(&visible_specs, &router.model_visible_specs()));
    assert_eq!(
        namespace_function_names(&visible_specs, "codex_app"),
        vec![visible_tool.to_string()]
    );
    assert_eq!(
        router.deferred_tool_namespaces(),
        BTreeMap::from([("codex_app".to_string(), "Codex app tools.".to_string())])
    );

    let updated_router = test_tool_router(step_context.as_ref(), Vec::new(), Vec::new(), &[]);
    let updated_specs = updated_router.model_visible_specs();
    assert!(!Arc::ptr_eq(&visible_specs, &updated_specs));
    assert!(namespace_function_names(&updated_specs, "codex_app").is_empty());

    Ok(())
}

async fn discovery_budget_test_router(description_bytes: usize) -> ToolRouter {
    let (_, turn) = make_session_and_context().await;
    let turn = Arc::new(turn);
    let step_context = StepContext::for_test(Arc::clone(&turn));
    let dynamic_tools = vec![DynamicToolSpec::Namespace(DynamicToolNamespaceSpec {
        name: "budget_test".to_string(),
        description: "Current live namespace.".to_string(),
        tools: (0..30)
            .map(|index| {
                DynamicToolNamespaceTool::Function(DynamicToolFunctionSpec {
                    name: format!("tool_{index:02}"),
                    // Non-ASCII content catches character-count budget mistakes.
                    description: "한".repeat(description_bytes / 3),
                    input_schema: json!({
                        "type": "object",
                        "properties": {"query": {"type": "string", "enum": ["intact"]}},
                        "required": ["query"],
                        "additionalProperties": false,
                    }),
                    defer_loading: index != 29,
                })
            })
            .collect(),
    })];
    test_tool_router(
        step_context.as_ref(),
        Vec::new(),
        Vec::new(),
        &dynamic_tools,
    )
}

fn discovery_search_history() -> ResponseItem {
    ResponseItem::ToolSearchOutput {
        id: None,
        call_id: Some("search".to_string()),
        status: "completed".to_string(),
        execution: "client".to_string(),
        tools: vec![json!({
            "type": "namespace",
            "name": "budget_test",
            "description": "obsolete history metadata".repeat(12_000),
            "tools": (0..30).map(|index| json!({
                "type": "function",
                "name": format!("tool_{index:02}"),
                "description": "obsolete schema",
                "parameters": {"type": "object", "properties": {"stale": {"type": "number"}}},
            })).collect::<Vec<_>>(),
        })],
        internal_chat_message_metadata_passthrough: None,
    }
}

#[tokio::test]
async fn compatible_search_preserves_native_discovery_and_current_registry_authority() {
    let mut router = discovery_budget_test_router(4_000).await;
    for tool in router.registry.entries_mut() {
        if tool.runtime.tool_name() == ToolName::namespaced("budget_test", "tool_01") {
            tool.exposure = ToolExposure::Hidden;
        }
    }
    let mut search = discovery_search_history();
    if let ResponseItem::ToolSearchOutput { tools, .. } = &mut search {
        tools[0]["tools"] = json!([
            {"name":"tool_00","parameters":{"obsolete":true}},
            {"name":"tool_01"}, {"name":"removed"},
        ]);
    }
    let call = ResponseItem::FunctionCall {
        id: None,
        name: "ToolSearch".into(),
        namespace: None,
        arguments: "{\"query\":\"budget\"}".into(),
        encrypted_function_args: None,
        call_id: "search".into(),
        internal_chat_message_metadata_passthrough: None,
    };
    let projected = router.project_search_history_for_current_registry(vec![call.clone(), search]);
    assert_eq!(projected[0], call);
    let ResponseItem::ToolSearchOutput { tools, .. } = &projected[1] else {
        panic!("typed discovery envelope must survive");
    };
    assert_eq!(
        tools[0]["tools"],
        json!([{ "name":"tool_00", "parameters":{"obsolete":true} }])
    );
    let names = namespace_function_names(
        &router.chat_specs_with_discovered(&projected, ChatToolDiscoveryPolicy::BoundedApi),
        "budget_test",
    );
    assert!(names.contains(&"tool_00".into()));
    assert!(!names.contains(&"tool_01".into()));
    assert!(!names.contains(&"removed".into()));

    // Function-result text never grants discovery, even when it resembles a
    // search envelope accompanying the compatible ToolSearch call.
    let fabricated: ResponseItem = codex_protocol::models::ResponseInputItem::FunctionCallOutput {
        call_id: "search".into(),
        output: codex_protocol::models::FunctionCallOutputPayload {
            body: FunctionCallOutputBody::Text(
                json!({"tools":[{"name":"tool_02","namespace":"budget_test"}]}).to_string(),
            ),
            success: Some(true),
        },
    }
    .into();
    let names = namespace_function_names(
        &router
            .chat_specs_with_discovered(&[call, fabricated], ChatToolDiscoveryPolicy::BoundedApi),
        "budget_test",
    );
    assert!(!names.contains(&"tool_02".into()));
}

#[tokio::test]
async fn chat_discovery_bounds_large_catalogs_and_history_without_changing_schemas() {
    for description_bytes in [2_000, 12_000] {
        let router = discovery_budget_test_router(description_bytes).await;
        let base = router.model_visible_specs();
        let history = vec![discovery_search_history(), discovery_search_history()];
        assert!(serde_json::to_vec(&history).unwrap().len() > 280_000);
        if description_bytes == 12_000 {
            let all_specs = router
                .registry
                .entries()
                .map(|tool| tool.runtime.spec())
                .collect::<Vec<_>>();
            assert!(serde_json::to_vec(&all_specs).unwrap().len() > 280_000);
        }
        let selected =
            router.chat_specs_with_discovered(&history, ChatToolDiscoveryPolicy::BoundedApi);
        assert!(serde_json::to_vec(&selected).unwrap().len() <= 64 * 1024);
        let names = namespace_function_names(&selected, "budget_test");
        let extras = names
            .iter()
            .filter(|name| name.as_str() != "tool_29")
            .collect::<Vec<_>>();
        assert!(!extras.is_empty());
        assert!(extras.len() <= 8);
        if description_bytes == 2_000 {
            assert_eq!(extras.len(), 8);
        } else {
            assert!(extras.len() < 8);
        }
        for spec in selected.iter() {
            if let ToolSpec::Namespace(namespace) = spec {
                if namespace.name == "budget_test" {
                    for child in &namespace.tools {
                        let name = match child {
                            ResponsesApiNamespaceTool::Function(tool) => &tool.name,
                            ResponsesApiNamespaceTool::Custom(tool) => &tool.name,
                        };
                        let current = router
                            .registry
                            .entries()
                            .find(|tool| {
                                tool.runtime.tool_name()
                                    == ToolName::namespaced("budget_test", name)
                            })
                            .unwrap()
                            .runtime
                            .spec();
                        let ToolSpec::Namespace(current) = current else {
                            panic!("expected live namespace");
                        };
                        assert_eq!(
                            serde_json::to_value(child).unwrap(),
                            serde_json::to_value(&current.tools[0]).unwrap()
                        );
                    }
                }
            }
        }
        assert!(Arc::ptr_eq(&base, &router.model_visible_specs()));
        assert_eq!(
            namespace_function_names(&base, "budget_test"),
            vec!["tool_29"]
        );
        assert_eq!(
            router.chat_specs_with_discovered(&[], ChatToolDiscoveryPolicy::BoundedApi),
            base
        );
    }
}

#[tokio::test]
async fn claude_chat_discovery_retains_whole_live_schemas_beyond_api_limits() {
    for description_bytes in [4_000, 90_000] {
        let mut router = discovery_budget_test_router(description_bytes).await;
        for tool in router.registry.entries_mut() {
            if tool.runtime.tool_name() == ToolName::namespaced("budget_test", "tool_01") {
                tool.exposure = ToolExposure::Hidden;
            }
        }
        let base = router.model_visible_specs();
        assert_eq!(
            router.chat_specs_with_discovered(&[], ChatToolDiscoveryPolicy::RetainDiscovered),
            base
        );
        let history = vec![discovery_search_history(), discovery_search_history()];
        let selected =
            router.chat_specs_with_discovered(&history, ChatToolDiscoveryPolicy::RetainDiscovered);
        let names = namespace_function_names(&selected, "budget_test");
        assert_eq!(names.len(), 29);
        assert!(!names.contains(&"tool_01".to_string()));
        assert!(serde_json::to_vec(&selected).unwrap().len() > 64 * 1024);
        let ToolSpec::Namespace(namespace) = selected
            .iter()
            .find(|spec| spec.name() == "budget_test")
            .unwrap()
        else {
            panic!("expected merged namespace");
        };
        assert_eq!(namespace.description, "Current live namespace.");
        for child in &namespace.tools {
            let name = match child {
                ResponsesApiNamespaceTool::Function(tool) => &tool.name,
                ResponsesApiNamespaceTool::Custom(tool) => &tool.name,
            };
            let current = router
                .registry
                .entries()
                .find(|tool| tool.runtime.tool_name() == ToolName::namespaced("budget_test", name))
                .unwrap()
                .runtime
                .spec();
            let ToolSpec::Namespace(current) = current else {
                panic!("expected live namespace");
            };
            assert_eq!(
                serde_json::to_value(child).unwrap(),
                serde_json::to_value(&current.tools[0]).unwrap()
            );
        }
        assert!(Arc::ptr_eq(&base, &router.model_visible_specs()));
    }
}

#[tokio::test]
async fn chat_discovery_prefers_recent_calls_and_authorized_additions() {
    let router = discovery_budget_test_router(2_000).await;
    let history = vec![
        discovery_search_history(),
        serde_json::from_value(json!({"type": "additional_tools", "role": "developer", "tools": [
            {"type": "namespace", "name": "budget_test", "tools": [{"name": "tool_28"}]}
        ]})).unwrap(),
        serde_json::from_value(json!({"type": "function_call", "namespace": "budget_test", "name": "tool_27", "arguments": "{}", "call_id": "recent-function"})).unwrap(),
        serde_json::from_value(json!({"type": "custom_tool_call", "namespace": "budget_test", "name": "tool_26", "input": "", "call_id": "recent-custom"})).unwrap(),
    ];
    assert_eq!(
        namespace_function_names(
            &router.chat_specs_with_discovered(&history, ChatToolDiscoveryPolicy::BoundedApi),
            "budget_test"
        ),
        vec![
            "tool_00", "tool_01", "tool_02", "tool_03", "tool_04", "tool_26", "tool_27", "tool_28",
            "tool_29"
        ]
    );
}

#[tokio::test]
async fn chat_discovery_does_not_revive_hidden_removed_or_unauthorized_tools() {
    let mut router = discovery_budget_test_router(4_000).await;
    for tool in router.registry.entries_mut() {
        if tool.runtime.tool_name() == ToolName::namespaced("budget_test", "tool_00") {
            tool.exposure = ToolExposure::Hidden;
        }
    }
    let hidden_or_removed = json!({"type": "namespace", "name": "budget_test", "tools": [{"name": "tool_00"}, {"name": "removed"}]});
    let mut search = discovery_search_history();
    if let ResponseItem::ToolSearchOutput { tools, .. } = &mut search {
        *tools = vec![hidden_or_removed];
    }
    let unauthorized = |kind: &str| -> ResponseItem {
        let tools =
            json!([{"type": "namespace", "name": "budget_test", "tools": [{"name": "tool_01"}]}]);
        let value = match kind {
            "user" => json!({"type": "additional_tools", "role": "user", "tools": tools}),
            "server" => {
                json!({"type": "tool_search_output", "execution": "server", "status": "completed", "tools": tools})
            }
            _ => {
                json!({"type": "tool_search_output", "execution": "client", "status": "in_progress", "tools": tools})
            }
        };
        serde_json::from_value(value).unwrap()
    };
    let hidden_call = serde_json::from_value(json!({"type": "function_call", "namespace": "budget_test", "name": "tool_00", "arguments": "{}", "call_id": "hidden"})).unwrap();
    let history = vec![
        search,
        hidden_call,
        unauthorized("user"),
        unauthorized("server"),
        unauthorized("pending"),
    ];
    assert_eq!(
        router.chat_specs_with_discovered(&history, ChatToolDiscoveryPolicy::BoundedApi),
        router.model_visible_specs()
    );
}

#[tokio::test]
async fn chat_discovery_preserves_oversized_mandatory_base_catalog() {
    let router = discovery_budget_test_router(90_000).await;
    let base = router.model_visible_specs();
    assert!(serde_json::to_vec(&base).unwrap().len() > 64 * 1024);
    assert!(Arc::ptr_eq(
        &base,
        &router.chat_specs_with_discovered(
            &[discovery_search_history()],
            ChatToolDiscoveryPolicy::BoundedApi
        )
    ));
}

#[tokio::test]
async fn search_history_projection_preserves_current_schemas_and_raw_history() {
    let mut router = discovery_budget_test_router(4_000).await;
    router.code_mode_tool_names.clear();
    // This case exercises deferred search exposure after removing Code Mode.
    // The shared fixture initially exposes deferred tools only through Code Mode.
    let mut visible = router.model_visible_specs.to_vec();
    visible.push(ToolSpec::ToolSearch {
        execution: "client".to_string(),
        description: "Search current tools".to_string(),
        parameters: codex_tools::JsonSchema::object(BTreeMap::new(), None, None),
    });
    router.model_visible_specs = visible.into();
    assert!(router.exposes_tool(&ToolName::namespaced("budget_test", "tool_00")));
    for tool in router.registry.entries_mut() {
        if tool.runtime.tool_name() == ToolName::namespaced("budget_test", "tool_01") {
            tool.exposure = ToolExposure::Hidden;
        }
    }
    let mut search = discovery_search_history();
    if let ResponseItem::ToolSearchOutput { tools, .. } = &mut search {
        tools[0]["tools"] = json!([
            {"name": "tool_00", "parameters": {"intact": "schema"}},
            {"name": "tool_01", "description": "hidden".repeat(60_000)},
            {"name": "removed", "description": "removed".repeat(60_000)},
            {"name": "tool_29", "parameters": {"intact": "direct schema"}},
        ]);
        tools.push(json!({"type": "namespace", "name": "removed_namespace", "description": "stale".repeat(60_000), "tools": [{"name": "removed"}]}));
    }
    let history = vec![search];
    let raw_before = serde_json::to_value(&history).unwrap();
    let projected = router.project_search_history_for_current_registry(history.clone());
    assert_eq!(serde_json::to_value(&history).unwrap(), raw_before);
    let mut expected = history;
    if let ResponseItem::ToolSearchOutput { tools, .. } = &mut expected[0] {
        tools.truncate(1);
        let children = tools[0]["tools"].as_array_mut().unwrap();
        children.remove(2);
        children.remove(1);
    }
    assert_eq!(
        serde_json::to_value(projected).unwrap(),
        serde_json::to_value(expected).unwrap()
    );
}

#[tokio::test]
async fn search_history_projection_preserves_direct_helpers_and_nested_tools_without_search() {
    let mut router = discovery_budget_test_router(4_000).await;
    router.code_mode_tool_names.clear();
    router.code_mode_tool_names.insert(
        "nested_tool".to_string(),
        ToolName::namespaced("budget_test", "tool_01"),
    );
    let mut visible = router.model_visible_specs().to_vec();
    visible.retain(|spec| !matches!(spec, ToolSpec::ToolSearch { .. }));
    // A directly exposed helper/alias need not have the same registry identity.
    let ToolSpec::Namespace(namespace) = visible.iter().find(|spec| matches!(spec, ToolSpec::Namespace(namespace) if namespace.name == "budget_test")).unwrap() else {
        panic!("expected namespace");
    };
    let ResponsesApiNamespaceTool::Function(mut helper) = namespace.tools[0].clone() else {
        panic!("expected function");
    };
    helper.name = "run".to_string();
    visible.push(ToolSpec::Namespace(ResponsesApiNamespace {
        name: "functions".to_string(),
        description: "Code Mode helper.".to_string(),
        tools: vec![ResponsesApiNamespaceTool::Function(helper.clone())],
    }));
    helper.name = "direct_alias".to_string();
    visible.push(ToolSpec::Function(helper));
    router.model_visible_specs = visible.into();
    assert!(!router.exposes_tool(&ToolName::namespaced("budget_test", "tool_00")));
    let mut search = discovery_search_history();
    if let ResponseItem::ToolSearchOutput { tools, .. } = &mut search {
        *tools = vec![
            json!({"type": "namespace", "name": "budget_test", "tools": [{"name": "tool_00"}, {"name": "tool_01"}]}),
            json!({"type": "namespace", "name": "functions", "description": "preserved helper", "tools": [{"name": "run", "parameters": {"helper": "intact"}}]}),
            json!({"type": "function", "name": "direct_alias", "parameters": {"alias": "intact"}}),
        ];
    }
    let mut expected = vec![search.clone()];
    if let ResponseItem::ToolSearchOutput { tools, .. } = &mut expected[0] {
        tools[0]["tools"].as_array_mut().unwrap().remove(0);
    }
    let projected = router.project_search_history_for_current_registry(vec![search]);
    assert_eq!(
        serde_json::to_value(projected).unwrap(),
        serde_json::to_value(expected).unwrap()
    );
}

#[tokio::test]
async fn search_history_projection_preserves_failed_outputs_and_pairing() {
    let router = discovery_budget_test_router(4_000).await;
    let mut completed = discovery_search_history();
    if let ResponseItem::ToolSearchOutput { tools, .. } = &mut completed {
        *tools = vec![
            json!({"type": "function", "name": "removed", "description": "stale".repeat(60_000)}),
        ];
    }
    let mut failed = completed.clone();
    if let ResponseItem::ToolSearchOutput { status, .. } = &mut failed {
        *status = "failed".to_string();
    }
    let mut server = completed.clone();
    if let ResponseItem::ToolSearchOutput { execution, .. } = &mut server {
        *execution = "server".to_string();
    }
    let call: ResponseItem = serde_json::from_value(json!({"type": "tool_search_call", "call_id": "search", "execution": "client", "arguments": {"query": "removed"}})).unwrap();
    let history = vec![call, completed, failed, server];
    let mut expected = history.clone();
    if let ResponseItem::ToolSearchOutput { tools, .. } = &mut expected[1] {
        tools.clear();
    }
    let projected = router.project_search_history_for_current_registry(history);
    assert_eq!(
        serde_json::to_value(projected).unwrap(),
        serde_json::to_value(expected).unwrap()
    );
}

fn mcp_tool_info(
    server_name: &str,
    supports_parallel_tool_calls: bool,
    callable_namespace: &str,
    tool_name: &str,
) -> codex_mcp::ToolInfo {
    codex_mcp::ToolInfo {
        server_name: server_name.to_string(),
        supports_parallel_tool_calls,
        server_origin: None,
        callable_name: tool_name.to_string(),
        callable_namespace: callable_namespace.to_string(),
        namespace_description: None,
        tool: rmcp::model::Tool::new(
            tool_name.to_string(),
            "Test MCP tool",
            Arc::new(rmcp::model::object(json!({
                "type": "object",
            }))),
        ),
        openai_file_input_optional_fields: Default::default(),
        connector_id: None,
        connector_name: None,
        plugin_display_names: Vec::new(),
    }
}

fn mcp_runtime(tool_info: codex_mcp::ToolInfo) -> RegisteredTool {
    let runtime = Arc::new(McpHandler::new(tool_info).expect("MCP tool spec should build"))
        as Arc<dyn CoreToolRuntime>;
    RegisteredTool {
        exposure: runtime.exposure(),
        runtime,
    }
}

#[tokio::test]
async fn extension_tool_executors_are_model_visible_and_dispatchable() -> anyhow::Result<()> {
    let (mut session, turn) = make_session_and_context().await;
    session.services.extensions = extension_tool_test_registry();
    let turn = Arc::new(turn);
    let step_context = StepContext::for_test(Arc::clone(&turn));
    let history_item = ResponseItem::Message {
        id: None,
        role: "user".to_string(),
        content: vec![ContentItem::InputText {
            text: "extension history".to_string(),
        }],
        phase: None,
        internal_chat_message_metadata_passthrough: None,
    };
    session
        .record_conversation_items(
            &turn,
            turn.model_info(),
            std::slice::from_ref(&history_item),
        )
        .await;
    let expected_history_item = session
        .clone_history()
        .await
        .raw_items()
        .next()
        .expect("history item")
        .clone();

    let router = test_tool_router(
        step_context.as_ref(),
        Vec::new(),
        extension_tool_executors(
            &session,
            &codex_extension_api::ExtensionData::new(turn.sub_id.clone()),
        ),
        &turn.dynamic_tools,
    );

    assert!(
        router.model_visible_specs().iter().any(
            |spec| matches!(spec, ToolSpec::Namespace(namespace)
            if namespace.name == "extension/"
                && namespace.tools.iter().any(|tool| matches!(
                    tool,
                    ResponsesApiNamespaceTool::Function(tool) if tool.name == "echo"
                )))
        ),
        "expected extension-provided tool to be visible to the model"
    );

    let call = ToolRouter::build_tool_call(ResponseItem::FunctionCall {
        id: None,
        name: "echo".to_string(),
        namespace: Some("extension/".to_string()),
        arguments: json!({ "message": "hello" }).to_string(),
        call_id: "call-extension".to_string(),
        encrypted_function_args: None,
        internal_chat_message_metadata_passthrough: None,
    })?
    .expect("function_call should produce a tool call");
    let result = router
        .dispatch_tool_call_with_code_mode_result(
            Arc::new(session),
            step_context,
            CancellationToken::new(),
            Arc::new(tokio::sync::Mutex::new(TurnDiffTracker::new())),
            call,
            ToolCallSource::Direct,
        )
        .await?;

    let response = result.into_response().item;
    match response {
        ResponseItem::FunctionCallOutput {
            call_id, output, ..
        } => {
            assert_eq!(call_id.as_deref(), Some("call-extension"));
            let FunctionCallOutputBody::Text(text) = output.body else {
                panic!("expected text function call output")
            };
            let value: serde_json::Value =
                serde_json::from_str(&text).expect("extension tool output should be json");
            assert_eq!(
                strip_response_item_ids_from_json(value),
                strip_response_item_ids_from_json(json!({
                    "arguments": { "message": "hello" },
                    "callId": "call-extension",
                    "conversationHistory": [expected_history_item],
                    "ok": true,
                }))
            );
        }
        other => panic!("expected function call output, got {other:?}"),
    }

    Ok(())
}

fn namespace_function_names(specs: &[ToolSpec], namespace_name: &str) -> Vec<String> {
    specs
        .iter()
        .find_map(|spec| match spec {
            ToolSpec::Namespace(namespace) if namespace.name == namespace_name => Some(
                namespace
                    .tools
                    .iter()
                    .map(|tool| match tool {
                        ResponsesApiNamespaceTool::Function(tool) => tool.name.clone(),
                        ResponsesApiNamespaceTool::Custom(tool) => tool.name.clone(),
                    })
                    .collect(),
            ),
            ToolSpec::Function(_)
            | ToolSpec::Freeform(_)
            | ToolSpec::ToolSearch { .. }
            | ToolSpec::WebSearch { .. }
            | ToolSpec::Namespace(_) => None,
        })
        .unwrap_or_default()
}

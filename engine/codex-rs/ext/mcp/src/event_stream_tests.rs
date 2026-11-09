//! Exercises independent event connections through the real MCP HTTP transport.
#![allow(clippy::unwrap_used)]

use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use axum::Json;
use axum::Router;
use axum::http::HeaderMap;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::response::sse::Event;
use axum::response::sse::Sse;
use axum::routing::post;
use codex_config::McpServerTransportConfig;
use codex_core::config::ConfigBuilder;
use codex_core::plugins_manager_for_config;
use codex_exec_server_test_support::environment_manager_without_environments;
use codex_login::AuthManager;
use codex_login::CodexAuth;
use codex_login::ExternalAuth;
use codex_login::ExternalAuthFuture;
use codex_login::ExternalAuthRefreshContext;
use codex_mcp::CODEX_APPS_MCP_SERVER_NAME;
use codex_mcp::EffectiveMcpServer;
use codex_mcp::McpEventNotification;
use codex_mcp::McpResourceClient;
use codex_mcp::McpRuntime;
use codex_mcp::McpRuntimeContext;
use codex_mcp::McpRuntimeInput;
use codex_mcp::McpServerRegistration;
use codex_mcp::McpStartupPolicy;
use codex_mcp::ResolvedMcpCatalog;
use futures::StreamExt;
use pretty_assertions::assert_eq;
use serde_json::Value;
use serde_json::json;
use tokio::sync::mpsc;
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

pub(super) const WAIT: Duration = Duration::from_secs(/*secs*/ 5);

pub(super) struct TestStream {
    pub request: Value,
    pub headers: HeaderMap,
    pub notifications: mpsc::UnboundedSender<Value>,
}

impl TestStream {
    pub fn notify(&self, method: &str) -> McpEventNotification {
        let params = json!({
            "data": {"text": "hello"},
            "_meta": {"io.modelcontextprotocol/subscriptionId": self.request["id"], "connector": "test"},
        });
        self.notifications
            .send(json!({"jsonrpc": "2.0", "method": method, "params": params}))
            .unwrap();
        McpEventNotification {
            method: method.into(),
            params: Some(params),
        }
    }
}

pub(super) struct Fixture {
    _home: tempfile::TempDir,
    _server: tokio_util::task::AbortOnDropHandle<std::io::Result<()>>,
    pub runtime: Arc<McpRuntime>,
    pub runtime_input: McpRuntimeInput,
    pub auth: Arc<AuthManager>,
    pub opened: mpsc::UnboundedReceiver<TestStream>,
}

impl Fixture {
    pub async fn new() -> Result<Self> {
        let (opened_tx, opened) = mpsc::unbounded_channel();
        let router = Router::new().fallback(post(
            move |headers: HeaderMap, Json(request): Json<Value>| {
                let opened = opened_tx.clone();
                async move {
                    let result = match request["method"].as_str() {
                        Some("initialize") => json!({
                            "protocolVersion": "2025-06-18", "capabilities": {},
                            "serverInfo": {"name": "test", "version": "1"},
                        }),
                        Some("tools/list") => json!({"tools": []}),
                        Some("notifications/initialized") => {
                            return StatusCode::ACCEPTED.into_response();
                        }
                        Some("events/stream") => {
                            let (notifications, receive) = mpsc::unbounded_channel();
                            opened
                                .send(TestStream {
                                    request,
                                    headers,
                                    notifications,
                                })
                                .unwrap();
                            let events = futures::stream::unfold(receive, |mut receive| async {
                                receive.recv().await.map(|value| (value, receive))
                            })
                            .map(|value: Value| {
                                Ok::<_, Infallible>(
                                    Event::default().event("message").data(value.to_string()),
                                )
                            });
                            return Sse::new(events).into_response();
                        }
                        method => panic!("unexpected request: {method:?}"),
                    };
                    Json(json!({"jsonrpc": "2.0", "id": request["id"], "result": result}))
                        .into_response()
                }
            },
        ));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let url = format!("http://{}", listener.local_addr()?);
        let server = tokio::spawn(async move { axum::serve(listener, router).await });
        let home = tempfile::tempdir()?;
        let auth_value = CodexAuth::from_external_chatgpt_tokens(
            "header.e30.first",
            "account",
            /*chatgpt_plan_type*/ None,
        )?;
        let auth =
            AuthManager::from_auth_for_testing_with_home(auth_value.clone(), home.path().into());
        let config = ConfigBuilder::default()
            .codex_home(home.path().into())
            .fallback_cwd(Some(home.path().into()))
            .build()
            .await?;
        let plugins = plugins_manager_for_config(&config, Arc::clone(&auth));
        let mut config = config.to_mcp_config(&plugins).await;
        let mut server_config = codex_mcp::hosted_plugin_runtime_mcp_server_config(
            &url, /*apps_mcp_product_sku*/ None, /*originator*/ None,
        );
        let McpServerTransportConfig::StreamableHttp {
            bearer_token_env_var,
            ..
        } = &mut server_config.transport
        else {
            panic!("HTTP server");
        };
        *bearer_token_env_var = None;
        let mut catalog = ResolvedMcpCatalog::builder();
        catalog.register(McpServerRegistration::from_hosted_apps(
            "test",
            /*contribution_order*/ 0,
            server_config.clone(),
        ));
        config.mcp_server_catalog = catalog.build();
        let config = Arc::new(config);
        let runtime_input = || McpRuntimeInput {
            network_policy_metadata: None,
            startup_policy: McpStartupPolicy::Eager,
            config: Arc::clone(&config),
            plugins_available: false,
            ready_selected_capability_roots: Vec::new(),
            mcp_servers: HashMap::from([(
                CODEX_APPS_MCP_SERVER_NAME.into(),
                EffectiveMcpServer::from_host_config(server_config.clone()),
            )]),
            submit_id: "test".into(),
            tx_event: None,
            startup_cancellation_token: CancellationToken::new(),
            runtime_context: McpRuntimeContext::new(
                Arc::new(environment_manager_without_environments()),
                home.path().into(),
            ),
            codex_apps_tools_cache: Default::default(),
            tool_catalog_cache: Default::default(),
            codex_apps_tools_cache_key: codex_mcp::codex_apps_tools_cache_key(Some(&auth_value)),
            client_mcp_extensions: Default::default(),
            auth: Some(auth_value.clone()),
            auth_manager: Some(Arc::clone(&auth)),
            elicitation_reviewer: None,
            elicitation_lifecycle: None,
        };
        let runtime = Arc::new(McpRuntime::new(runtime_input()).await);
        let runtime_input = runtime_input();
        assert!(
            runtime
                .latest_wait_for_server_ready(CODEX_APPS_MCP_SERVER_NAME, WAIT)
                .await
        );
        Ok(Self {
            _home: home,
            _server: tokio_util::task::AbortOnDropHandle::new(server),
            runtime,
            runtime_input,
            auth,
            opened,
        })
    }
}

pub(super) struct StaticAuth(pub CodexAuth);

impl ExternalAuth for StaticAuth {
    fn resolve(&self) -> ExternalAuthFuture<'_, CodexAuth> {
        Box::pin(async { Ok(self.0.clone()) })
    }
    fn refresh(&self, _: ExternalAuthRefreshContext) -> ExternalAuthFuture<'_, CodexAuth> {
        self.resolve()
    }
}

#[tokio::test]
async fn event_connections_open_after_runtime_shutdown_with_current_auth() -> Result<()> {
    let mut fixture = Fixture::new().await?;
    let opener = McpResourceClient::new(Arc::clone(&fixture.runtime)).event_stream_opener()?;
    fixture.runtime.shutdown().await;
    drop(fixture.runtime);

    fixture
        .auth
        .set_external_auth(Arc::new(StaticAuth(
            CodexAuth::from_external_chatgpt_tokens(
                "header.e30.refreshed",
                "account",
                /*chatgpt_plan_type*/ None,
            )?,
        )))
        .await?;
    let mut stream = opener
        .open("test.event", &json!({}), /*request_meta*/ None)
        .await?;
    let remote = timeout(WAIT, fixture.opened.recv()).await?.unwrap();
    assert_eq!(
        remote.headers["authorization"],
        "Bearer header.e30.refreshed"
    );
    let expected = remote.notify("notifications/events/active");
    assert_eq!(timeout(WAIT, stream.recv()).await??, Some(expected));
    drop(stream);
    timeout(WAIT, remote.notifications.closed()).await?;
    Ok(())
}

#[tokio::test]
async fn service_selection_keeps_started_streams_and_rebinds_retained_openers() -> Result<()> {
    let mut fixture = Fixture::new().await?;
    let original = ConfigBuilder::default()
        .codex_home(fixture._home.path().into())
        .fallback_cwd(Some(fixture._home.path().into()))
        .build()
        .await?;
    let template = AuthManager::azrael_service_template(&original);
    assert!(
        template.auth_cached().is_none(),
        "service template must not adopt conversation credentials"
    );
    let accounts = Arc::new(codex_login::test_support::EphemeralServiceAccounts::new(
        fixture._home.path(),
    ));
    let auth_a = codex_login::test_support::fixture_chatgpt_auth("service-a");
    let auth_b = codex_login::test_support::fixture_chatgpt_auth("service-b");
    let profile_a = accounts.create(&template, &auth_a).await?;
    let profile_b = accounts.create(&template, &auth_b).await?;
    let profile_a_id = profile_a.id().to_string();
    let profile_b_id = profile_b.id().to_string();
    accounts.selection.select(Some(profile_a_id.clone()))?;
    drop(profile_a);
    drop(profile_b);

    let mut base = fixture.runtime_input.clone();
    base.auth = None;
    base.auth_manager = None;
    let observed = Arc::new(std::sync::Mutex::new(Vec::<(
        String,
        std::sync::Weak<codex_login::AzraelProfileAuth>,
        std::sync::Weak<AuthManager>,
    )>::new()));
    let observation = Arc::clone(&observed);
    let build = Arc::new(move || {
        let accounts = Arc::clone(&accounts);
        let original = original.clone();
        let mut input = base.clone();
        let observation = Arc::clone(&observation);
        Box::pin(async move {
            let template = AuthManager::azrael_service_template(&original);
            let binding = Arc::new(accounts.resolve(&template).await?);
            let scoped = original.for_openai_service(binding.manager()).await?;
            let mut config = (*input.config).clone();
            config.azrael_service_auth = binding.manager().auth().await;
            observation.lock().unwrap().push((
                config
                    .azrael_service_auth
                    .as_ref()
                    .and_then(CodexAuth::get_account_id)
                    .unwrap(),
                Arc::downgrade(&binding.profile),
                Arc::downgrade(&binding.manager()),
            ));
            config.azrael_service_network_policy = Some(scoped.application_network_policy.clone());
            config.azrael_service_account = Some(binding);
            input.codex_apps_tools_cache_key = config.apps_runtime_cache_key(None);
            input.config = Arc::new(config);
            input.startup_cancellation_token = CancellationToken::new();
            Ok(input)
        }) as futures::future::BoxFuture<'static, Result<McpRuntimeInput>>
    });
    let initial = build().await?;
    let selection = codex_login::AzraelServiceAccountStore::new(fixture._home.path());
    fixture
        .runtime
        .set_service_request_resolver(codex_mcp::McpServiceRequestResolver::new(move || build()));
    fixture.runtime.replace(initial).await;
    let resources = McpResourceClient::new(Arc::clone(&fixture.runtime));
    let retained = resources.event_stream_opener()?;
    let mut stream_a = retained.open("test.event", &json!({}), None).await?;
    let remote_a = timeout(WAIT, fixture.opened.recv()).await?.unwrap();
    assert_eq!(remote_a.headers["chatgpt-account-id"], "service-a");

    let selected_b = selection.select(Some(profile_b_id))?;
    fixture.runtime.retire_stale_service_runtime(&selected_b);
    let expected_a = remote_a.notify("notifications/events/active");
    assert_eq!(timeout(WAIT, stream_a.recv()).await??, Some(expected_a));
    let mut stream_b = retained.open("test.event", &json!({}), None).await?;
    let remote_b = timeout(WAIT, fixture.opened.recv()).await?.unwrap();
    assert_eq!(remote_b.headers["chatgpt-account-id"], "service-b");
    let direct_b = resources
        .open_event_stream("test.event", &json!({}), None)
        .await?;
    let direct_remote_b = timeout(WAIT, fixture.opened.recv()).await?.unwrap();
    assert_eq!(direct_remote_b.headers["chatgpt-account-id"], "service-b");

    codex_login::AzraelProfileStore::new(fixture._home.path().join("azrael/accounts"))
        .publish_removal(&profile_a_id)?;
    fixture.runtime.poll_service_profile_retirement();
    assert!(
        timeout(WAIT, stream_a.recv()).await?.is_err(),
        "explicit retirement cancels A"
    );
    timeout(WAIT, remote_a.notifications.closed()).await?;
    let expected_b = remote_b.notify("notifications/events/active");
    assert_eq!(timeout(WAIT, stream_b.recv()).await??, Some(expected_b));
    timeout(WAIT, async {
        while observed
            .lock()
            .unwrap()
            .iter()
            .filter(|(account, _, _)| account == "service-a")
            .any(|(_, profile, manager)| profile.upgrade().is_some() || manager.upgrade().is_some())
        {
            tokio::task::yield_now().await;
        }
    })
    .await?;
    drop(direct_b);
    drop(stream_b);
    timeout(WAIT, direct_remote_b.notifications.closed()).await?;
    timeout(WAIT, remote_b.notifications.closed()).await?;
    timeout(WAIT, async {
        while observed
            .lock()
            .unwrap()
            .iter()
            .filter(|(account, _, _)| account == "service-b")
            .any(|(_, profile, manager)| profile.upgrade().is_some() || manager.upgrade().is_some())
        {
            tokio::task::yield_now().await;
        }
    })
    .await?;
    // The retained opener remains usable and owns no retired profile lease.
    drop(retained);
    Ok(())
}

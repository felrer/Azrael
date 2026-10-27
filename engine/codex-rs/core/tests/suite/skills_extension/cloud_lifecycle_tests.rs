//! Cloud catalog reuse, refresh retries, and auth-scoped retention through real Core turns.

use super::*;
use codex_extension_api::ThreadLifecycleContributor;
use codex_extension_api::ThreadStartInput;
use codex_mcp::McpResourceClient;
use pretty_assertions::assert_eq;
use std::sync::atomic::AtomicUsize;

struct CloudTurnProvider {
    reply: Mutex<Result<Option<(&'static str, u32)>, ()>>,
    lists: AtomicUsize,
    reads: AtomicUsize,
    resource_key: Mutex<Option<codex_mcp::McpResourceServerCacheKey>>,
    pause_list: Option<Arc<CatalogPause>>,
}

impl SkillProvider for CloudTurnProvider {
    fn list(&self, query: SkillListQuery) -> SkillProviderFuture<'_, SkillCatalog> {
        Box::pin(async move {
            self.lists.fetch_add(1, Ordering::SeqCst);
            *self.resource_key.lock().expect("resource key lock") = query
                .mcp_resources
                .as_ref()
                .and_then(|client| client.server_cache_key(CODEX_APPS_MCP_SERVER_NAME));
            let reply = *self.reply.lock().expect("cloud reply lock");
            let selected =
                reply.map_err(|()| SkillProviderError::new("cloud skill unavailable"))?;
            if let Some(pause) = &self.pause_list {
                pause.wait().await;
            }
            let entries = selected
                .into_iter()
                .map(|(plugin, revision)| {
                    let package = format!("skill://{plugin}/demo");
                    SkillCatalogEntry::new(
                        SkillPackageId(package.clone()),
                        SkillAuthority::new(SkillSourceKind::Cloud, CODEX_APPS_MCP_SERVER_NAME),
                        format!("{plugin}:demo"),
                        format!("Cloud {plugin} revision {revision}"),
                        SkillResourceId::new(format!("{package}/SKILL.md")),
                    )
                    .with_display_path(&package)
                    .with_alias_root(format!("skill://{plugin}"))
                })
                .collect();
            Ok(SkillCatalog {
                entries,
                warnings: Vec::new(),
            })
        })
    }

    fn read<'a>(
        &'a self,
        request: SkillReadRequest<'a>,
    ) -> SkillProviderFuture<'a, SkillReadResult> {
        Box::pin(async move {
            self.reads.fetch_add(1, Ordering::SeqCst);
            let selected = *self.reply.lock().expect("cloud reply lock");
            let (plugin, revision) = selected
                .ok()
                .flatten()
                .ok_or_else(|| SkillProviderError::new("cloud skill unavailable"))?;
            assert_eq!(
                request.resource.as_str(),
                format!("skill://{plugin}/demo/SKILL.md")
            );
            Ok(SkillReadResult {
                resource: request.resource,
                contents: format!("{plugin} instructions {revision}"),
            })
        })
    }

    fn search(&self, _request: SkillSearchRequest) -> SkillProviderFuture<'_, SkillSearchResult> {
        Box::pin(async { Ok(SkillSearchResult::default()) })
    }
}

#[derive(Default)]
struct SessionResources(Mutex<Option<Arc<McpResourceClient>>>);

impl ThreadLifecycleContributor<Config> for SessionResources {
    fn on_thread_start<'a>(
        &'a self,
        input: ThreadStartInput<'a, Config>,
    ) -> ExtensionFuture<'a, ()> {
        Box::pin(async move {
            *self.0.lock().expect("session resources lock") = input.mcp_resource_client.clone();
        })
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cloud_skills_reuse_cache_and_invalidate_on_connection_or_auth_change() -> Result<()> {
    core_test_support::skip_if_no_network!(Ok(()));

    let server = responses::start_mock_server().await;
    let apps = AppsTestServer::mount(&server).await?;
    let calendar = ("calendar", 1);
    let updated_calendar = ("calendar", 2);
    let gmail = ("gmail", 1);
    let provider = Arc::new(CloudTurnProvider {
        reply: Mutex::new(Ok(Some(calendar))),
        lists: AtomicUsize::new(0),
        reads: AtomicUsize::new(0),
        resource_key: Mutex::new(None),
        pause_list: None,
    });
    let resources = Arc::new(SessionResources::default());
    let mut extensions = ExtensionRegistryBuilder::new();
    extensions.thread_lifecycle_contributor(resources.clone());
    install_with_providers(
        &mut extensions,
        SkillProviders::new().with_cloud_provider(provider.clone()),
        |_config: &Config| SkillsExtensionConfig {
            include_instructions: true,
            max_context_tokens: None,
            bundled_skills_enabled: false,
            cloud_skill_enabled: true,
            shadow_selection_enabled: false,
        },
    );
    let mut builder = apps_enabled_builder(apps.chatgpt_base_url)
        .with_exec_server_url("none")
        .with_extensions(Arc::new(extensions.build()))
        .with_auth(CodexAuth::from_external_chatgpt_tokens(
            "header.e30.initial",
            "account-a",
            /*chatgpt_plan_type*/ None,
        )?)
        .with_config(move |config| {
            config.include_skill_instructions = true;
            config.cloud_skill_enabled = true;
        });
    let test = builder.build_with_auto_env(&server).await?;
    let mut last_available_skill = calendar;
    // Back off failures across steps and turns; reconnects allow immediate recovery.
    for (turn, next_reply, expected_skill, new_account, expected_lists, expected_reads) in [
        ("discovered", Ok(Some(calendar)), Some(calendar), None, 1, 1),
        (
            "cached",
            Ok(Some(updated_calendar)),
            Some(calendar),
            None,
            0,
            0,
        ),
        (
            "refreshed",
            Ok(Some(updated_calendar)),
            Some(updated_calendar),
            None,
            1,
            1,
        ),
        (
            "same-account-failure",
            Err(()),
            Some(updated_calendar),
            None,
            1,
            0,
        ),
        ("removed", Ok(None), None, None, 1, 0),
        ("empty-cached", Ok(Some(updated_calendar)), None, None, 0, 0),
        (
            "restored",
            Ok(Some(updated_calendar)),
            Some(updated_calendar),
            None,
            1,
            1,
        ),
        (
            "auth-changed-failure",
            Err(()),
            None,
            Some("account-b"),
            1,
            0,
        ),
        ("new-account-cooldown", Ok(Some(gmail)), None, None, 0, 0),
        (
            "new-account-discovered",
            Ok(Some(gmail)),
            Some(gmail),
            None,
            1,
            1,
        ),
        (
            "connection-replaced-failure",
            Err(()),
            Some(gmail),
            None,
            1,
            0,
        ),
        (
            "replacement-connection-discovered",
            Ok(Some(gmail)),
            Some(gmail),
            None,
            1,
            1,
        ),
    ] {
        let previous_lists = provider.lists.load(Ordering::SeqCst);
        let previous_reads = provider.reads.load(Ordering::SeqCst);
        *provider.reply.lock().expect("cloud reply lock") = next_reply;
        let previous_connection_scope = if matches!(
            turn,
            "refreshed"
                | "same-account-failure"
                | "removed"
                | "restored"
                | "new-account-discovered"
                | "connection-replaced-failure"
                | "replacement-connection-discovered"
        ) {
            let client = resources
                .0
                .lock()
                .expect("session resources lock")
                .clone()
                .expect("thread MCP resource client");
            let auth = client.auth_cache_key_for_server(CODEX_APPS_MCP_SERVER_NAME);
            let connection = client.server_cache_key(CODEX_APPS_MCP_SERVER_NAME);
            // Turn-start preparation must consume the pending reconnect before discovery.
            test.codex.submit(Op::RefreshMcpServers).await?;
            Some((client, auth, connection))
        } else {
            None
        };
        if let Some(account) = new_account {
            let client = resources
                .0
                .lock()
                .expect("session resources lock")
                .clone()
                .expect("thread MCP resource client");
            let previous_auth = client.auth_cache_key_for_server(CODEX_APPS_MCP_SERVER_NAME);
            codex_login::auth::login_with_chatgpt_auth_tokens(
                test.codex_home_path(),
                "header.e30.changed",
                account,
                /*chatgpt_plan_type*/ None,
            )?;
            test.thread_manager.auth_manager().reload().await;
            // Wait for the real auth transition, without manually refreshing MCP.
            tokio::time::timeout(Duration::from_secs(10), async {
                while client.auth_cache_key_for_server(CODEX_APPS_MCP_SERVER_NAME) == previous_auth
                {
                    tokio::task::yield_now().await;
                }
            })
            .await?;
            assert_eq!(provider.lists.load(Ordering::SeqCst), previous_lists);
        }
        // Empty catalogs must also reject reads of the previously cached skill.
        let (plugin, _) = expected_skill.unwrap_or(last_available_skill);
        let package = format!("skill://{plugin}/demo");
        let list_id = format!("list-{turn}");
        let read_id = format!("read-{turn}");
        let response = responses::mount_sse_sequence(
            &server,
            vec![
                sse(vec![
                    ev_response_created("tools"),
                    responses::ev_function_call_with_namespace(
                        &list_id,
                        "skills",
                        "list",
                        &json!({"authority":{"kind":"cloud"}}).to_string(),
                    ),
                    responses::ev_function_call_with_namespace(
                        &read_id,
                        "skills",
                        "read",
                        &json!({"package": package}).to_string(),
                    ),
                    ev_completed("tools"),
                ]),
                sse(vec![ev_response_created("done"), ev_completed("done")]),
            ],
        )
        .await;
        test.submit_turn("Inspect the cloud skill and read its instructions.")
            .await?;
        let client = resources
            .0
            .lock()
            .expect("session resources lock")
            .clone()
            .expect("thread MCP resource client");
        assert!(
            client.server_cache_key(CODEX_APPS_MCP_SERVER_NAME)
                == *provider.resource_key.lock().expect("resource key lock"),
            "turn-start reprojection must not invalidate resource caches: {turn}"
        );
        if let Some((client, scope, connection)) = previous_connection_scope {
            assert!(client.server_cache_key(CODEX_APPS_MCP_SERVER_NAME) != connection);
            assert!(
                client.auth_cache_key_for_server(CODEX_APPS_MCP_SERVER_NAME) == scope,
                "same-auth reconnect must preserve the cloud cache scope"
            );
        }
        let requests = response.requests();
        assert_eq!(requests.len(), 2, "turn {turn}");
        assert_eq!(
            provider.lists.load(Ordering::SeqCst),
            previous_lists + expected_lists,
            "turn {turn}"
        );
        assert_eq!(
            provider.reads.load(Ordering::SeqCst),
            previous_reads + expected_reads,
            "turn {turn}"
        );
        let listed: Value = serde_json::from_str(
            &requests[1]
                .function_call_output_text(&list_id)
                .expect("skills.list result"),
        )?;
        let read = requests[1]
            .function_call_output_text(&read_id)
            .expect("skills.read result");
        if let Some((plugin, revision)) = expected_skill {
            last_available_skill = (plugin, revision);
            let description = format!("Cloud {plugin} revision {revision}");
            assert_eq!(
                listed["skills"].as_array().expect("listed skills").len(),
                1,
                "turn {turn}"
            );
            assert_eq!(listed["skills"][0]["package"], package, "turn {turn}");
            assert_eq!(
                listed["skills"][0]["description"], description,
                "turn {turn}"
            );
            assert!(
                requests[0]
                    .message_input_texts("developer")
                    .join("\n")
                    .contains(&description),
                "turn {turn}"
            );
            let read: Value = serde_json::from_str(&read)?;
            assert_eq!(
                read["contents"],
                format!("{plugin} instructions {revision}"),
                "turn {turn}"
            );
        } else {
            assert_eq!(listed["skills"], json!([]), "turn {turn}");
            assert!(
                read.contains("skill package is not available"),
                "turn {turn}: {read}"
            );
        }
    }
    Ok(())
}

#[derive(Default)]
struct CatalogPause {
    armed: AtomicBool,
    started: tokio::sync::Notify,
    resume: tokio::sync::Notify,
}
impl CatalogPause {
    async fn wait(&self) {
        if self.armed.swap(false, Ordering::SeqCst) {
            self.started.notify_one();
            self.resume.notified().await;
        }
    }
}

struct MidTurnCloud {
    pause_list: Option<Arc<CatalogPause>>,
    available: AtomicBool,
    lists: AtomicUsize,
    finished: tokio::sync::mpsc::UnboundedSender<tokio::sync::oneshot::Sender<()>>,
}
impl codex_core_plugins::PluginProvider for MidTurnCloud {
    fn list(
        &self,
        _query: codex_core_plugins::PluginListQuery,
    ) -> codex_core_plugins::PluginProviderFuture<'_, codex_core_plugins::PluginCatalog> {
        Box::pin(async move {
            self.lists.fetch_add(1, Ordering::SeqCst);
            let catalog = codex_core_plugins::PluginCatalog {
                entries: if self.available.load(Ordering::SeqCst) {
                    vec![codex_core_plugins::PluginCatalogEntry {
                        id: codex_core_plugins::PluginIdentity::Remote {
                            remote_plugin_id: "plugin_demo".into(),
                        },
                        display_name: "Cloud Demo".into(),
                        version: None,
                        mcp_servers: Default::default(),
                        connector_ids: Vec::new(),
                        locations: vec![codex_core_plugins::PluginSourceLocation::Cloud {
                            resource_uri: "plugin://plugin_demo".into(),
                            bundle_uri: None,
                        }],
                    }]
                } else {
                    Vec::new()
                },
                warnings: Vec::new(),
            };
            if let Some(pause) = &self.pause_list {
                pause.wait().await;
            }
            Ok(catalog)
        })
    }
}
impl codex_extension_api::ToolLifecycleContributor for MidTurnCloud {
    fn on_tool_finish<'a>(
        &'a self,
        _input: codex_extension_api::ToolFinishInput<'a>,
    ) -> codex_extension_api::ToolLifecycleFuture<'a> {
        Box::pin(async move {
            let (resume, wait) = tokio::sync::oneshot::channel();
            self.finished.send(resume).expect("turn observer");
            wait.await.expect("resume tool completion");
        })
    }
}

/// The next model request and its tools must reflect a mid-turn account change.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn mid_turn_auth_refreshes_both_cloud_catalogs_and_skill_instructions() -> Result<()> {
    core_test_support::skip_if_no_network!(Ok(()));
    let server = responses::start_mock_server().await;
    let apps = AppsTestServer::mount(&server).await?;
    let resources = Arc::new(SessionResources::default());
    let skills = Arc::new(CloudTurnProvider {
        reply: Mutex::new(Ok(Some(("calendar", 1)))),
        lists: AtomicUsize::new(0),
        reads: AtomicUsize::new(0),
        resource_key: Mutex::new(None),
        pause_list: None,
    });
    let (finished, mut steps) = tokio::sync::mpsc::unbounded_channel();
    let plugins = Arc::new(MidTurnCloud {
        available: AtomicBool::new(true),
        pause_list: None,
        lists: AtomicUsize::new(0),
        finished,
    });
    let mut extensions = ExtensionRegistryBuilder::new();
    extensions.thread_lifecycle_contributor(resources.clone());
    extensions.tool_lifecycle_contributor(plugins.clone());
    codex_mcp_extension::install_plugin_providers(
        &mut extensions,
        codex_mcp_extension::PluginProviders::new(Arc::new(
            codex_core_plugins::ExecutorPluginProvider::new(Arc::new(
                EnvironmentManager::default_for_tests(),
            )),
        ))
        .with_cloud_provider(plugins.clone()),
    );
    install_with_providers(
        &mut extensions,
        SkillProviders::new().with_cloud_provider(skills.clone()),
        |_config: &Config| SkillsExtensionConfig {
            include_instructions: true,
            max_context_tokens: None,
            bundled_skills_enabled: false,
            cloud_skill_enabled: true,
            shadow_selection_enabled: false,
        },
    );
    let mut builder = apps_enabled_builder(apps.chatgpt_base_url)
        .with_exec_server_url("none")
        .with_extensions(Arc::new(extensions.build()))
        .with_auth(CodexAuth::from_external_chatgpt_tokens(
            "header.e30.initial",
            "account-a",
            None,
        )?)
        .with_config(|config| {
            config.include_skill_instructions = true;
            config.cloud_skill_enabled = true;
            config.features.enable(Feature::Plugins);
        });
    let test = builder.build_with_auto_env(&server).await?;
    let response = responses::mount_sse_sequence(
        &server,
        vec![
            sse(vec![
                ev_response_created("first"),
                responses::ev_function_call_with_namespace(
                    "first-list",
                    "skills",
                    "list",
                    r#"{"authority":{"kind":"cloud"}}"#,
                ),
                ev_completed("first"),
            ]),
            sse(vec![
                ev_response_created("second"),
                responses::ev_function_call_with_namespace(
                    "second-list",
                    "skills",
                    "list",
                    r#"{"authority":{"kind":"cloud"}}"#,
                ),
                ev_completed("second"),
            ]),
            sse(vec![ev_response_created("done"), ev_completed("done")]),
        ],
    )
    .await;
    let (result, rotation) = tokio::join!(
        test.submit_turn("List the cloud skills again after the account changes."),
        async {
            let resume = tokio::time::timeout(Duration::from_secs(10), steps.recv())
                .await?
                .expect("first tool");
            let client = resources
                .0
                .lock()
                .expect("resources")
                .clone()
                .expect("MCP client");
            let plugin_state = test
                .codex
                .thread_extension_data()
                .get::<codex_mcp_extension::PluginsThreadState>()
                .expect("plugin state");
            assert_eq!(
                plugin_state
                    .cloud_catalog()
                    .expect("initial plugin catalog")
                    .entries
                    .len(),
                1
            );
            let before = client.auth_cache_key_for_server(CODEX_APPS_MCP_SERVER_NAME);
            plugins.available.store(false, Ordering::SeqCst);
            *skills.reply.lock().expect("skill reply") = Ok(Some(("gmail", 2)));
            codex_login::auth::login_with_chatgpt_auth_tokens(
                test.codex_home_path(),
                "header.e30.changed",
                "account-b",
                None,
            )?;
            test.thread_manager.auth_manager().reload().await;
            tokio::time::timeout(Duration::from_secs(10), async {
                while client.auth_cache_key_for_server(CODEX_APPS_MCP_SERVER_NAME) == before {
                    tokio::task::yield_now().await;
                }
            })
            .await?;
            resume.send(()).expect("resume first tool");
            let resume = tokio::time::timeout(Duration::from_secs(10), steps.recv())
                .await?
                .expect("second tool");
            // Discovery completed before dispatching the next step's tools.
            assert!(
                plugin_state
                    .cloud_catalog()
                    .expect("refreshed plugin catalog")
                    .entries
                    .is_empty()
            );
            assert_eq!(plugins.lists.load(Ordering::SeqCst), 2);
            assert_eq!(skills.lists.load(Ordering::SeqCst), 2);
            resume.send(()).expect("resume second tool");
            Ok::<(), anyhow::Error>(())
        }
    );
    result?;
    rotation?;
    let requests = response.requests();
    assert_eq!(requests.len(), 3);
    assert!(
        requests[0]
            .message_input_texts("developer")
            .join("\n")
            .contains("Cloud calendar revision 1")
    );
    assert!(
        requests[1]
            .message_input_texts("developer")
            .join("\n")
            .contains("Cloud gmail revision 2")
    );
    let listed: Value = serde_json::from_str(
        &requests[2]
            .function_call_output_text("second-list")
            .expect("second skills result"),
    )?;
    assert_eq!(listed["skills"][0]["package"], "skill://gmail/demo");
    Ok(())
}

/// Same-auth reconnects supersede in-flight success and same-turn successful caches.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resource_changes_discard_inflight_catalogs_and_refresh_same_turn_success() -> Result<()> {
    core_test_support::skip_if_no_network!(Ok(()));
    let server = responses::start_mock_server().await;
    let apps = AppsTestServer::mount(&server).await?;
    let resources = Arc::new(SessionResources::default());
    let plugin_pause = Arc::new(CatalogPause::default());
    let skill_pause = Arc::new(CatalogPause::default());
    plugin_pause.armed.store(true, Ordering::SeqCst);
    skill_pause.armed.store(true, Ordering::SeqCst);
    let skills = Arc::new(CloudTurnProvider {
        reply: Mutex::new(Ok(Some(("calendar", 1)))),
        lists: AtomicUsize::new(0),
        reads: AtomicUsize::new(0),
        resource_key: Mutex::new(None),
        pause_list: Some(skill_pause.clone()),
    });
    let (finished, mut steps) = tokio::sync::mpsc::unbounded_channel();
    let plugins = Arc::new(MidTurnCloud {
        available: AtomicBool::new(true),
        lists: AtomicUsize::new(0),
        finished,
        pause_list: Some(plugin_pause.clone()),
    });
    let mut extensions = ExtensionRegistryBuilder::new();
    extensions.thread_lifecycle_contributor(resources.clone());
    extensions.tool_lifecycle_contributor(plugins.clone());
    codex_mcp_extension::install_plugin_providers(
        &mut extensions,
        codex_mcp_extension::PluginProviders::new(Arc::new(
            codex_core_plugins::ExecutorPluginProvider::new(Arc::new(
                EnvironmentManager::default_for_tests(),
            )),
        ))
        .with_cloud_provider(plugins.clone()),
    );
    install_with_providers(
        &mut extensions,
        SkillProviders::new().with_cloud_provider(skills.clone()),
        |_config: &Config| SkillsExtensionConfig {
            include_instructions: true,
            max_context_tokens: None,
            bundled_skills_enabled: false,
            cloud_skill_enabled: true,
            shadow_selection_enabled: false,
        },
    );
    let mut builder = apps_enabled_builder(apps.chatgpt_base_url)
        .with_exec_server_url("none")
        .with_extensions(Arc::new(extensions.build()))
        .with_auth(CodexAuth::from_external_chatgpt_tokens(
            "header.e30.initial",
            "account-a",
            None,
        )?)
        .with_config(|config| {
            config.include_skill_instructions = true;
            config.cloud_skill_enabled = true;
            config.features.enable(Feature::Plugins);
        });
    let test = builder.build_with_auto_env(&server).await?;
    let response = responses::mount_sse_sequence(
        &server,
        vec![
            sse(vec![
                ev_response_created("first"),
                responses::ev_function_call_with_namespace(
                    "resource-list",
                    "skills",
                    "list",
                    r#"{"authority":{"kind":"cloud"}}"#,
                ),
                ev_completed("first"),
            ]),
            sse(vec![ev_response_created("done"), ev_completed("done")]),
        ],
    )
    .await;
    let reconnect = || async {
        let client = resources
            .0
            .lock()
            .expect("resources")
            .clone()
            .expect("MCP client");
        let auth = client.auth_cache_key_for_server(CODEX_APPS_MCP_SERVER_NAME);
        let key = client.server_cache_key(CODEX_APPS_MCP_SERVER_NAME);
        assert!(
            key.is_some(),
            "test requires an actual Apps server generation"
        );
        test.codex.submit(Op::RefreshMcpServers).await?;
        tokio::time::timeout(Duration::from_secs(10), async {
            while client.server_cache_key(CODEX_APPS_MCP_SERVER_NAME) == key {
                test.codex
                    .mcp_server_status_snapshot(
                        CODEX_APPS_MCP_SERVER_NAME,
                        codex_mcp::McpSnapshotDetail::ToolsAndAuthOnly,
                    )
                    .await?;
                tokio::task::yield_now().await;
            }
            anyhow::Ok(())
        })
        .await??;
        assert!(client.auth_cache_key_for_server(CODEX_APPS_MCP_SERVER_NAME) == auth);
        anyhow::Ok(())
    };
    let (result, changes) = tokio::join!(
        test.submit_turn("Inspect the changing cloud skill catalog."),
        async {
            tokio::time::timeout(Duration::from_secs(10), plugin_pause.started.notified()).await?;
            reconnect().await?;
            plugins.available.store(false, Ordering::SeqCst);
            plugin_pause.resume.notify_one();
            tokio::time::timeout(Duration::from_secs(10), skill_pause.started.notified()).await?;
            reconnect().await?;
            *skills.reply.lock().expect("skill reply") = Ok(Some(("gmail", 2)));
            skill_pause.resume.notify_one();
            let resume = tokio::time::timeout(Duration::from_secs(10), steps.recv())
                .await?
                .expect("first tool");
            let plugin_state = test
                .codex
                .thread_extension_data()
                .get::<codex_mcp_extension::PluginsThreadState>()
                .expect("plugin state");
            assert!(
                plugin_state
                    .cloud_catalog()
                    .expect("refreshed catalog")
                    .entries
                    .is_empty()
            );
            assert_eq!(plugins.lists.load(Ordering::SeqCst), 2);
            assert_eq!(skills.lists.load(Ordering::SeqCst), 2);
            // Both catalogs have succeeded in this turn; resource changes still require refresh.
            reconnect().await?;
            plugins.available.store(true, Ordering::SeqCst);
            *skills.reply.lock().expect("skill reply") = Ok(Some(("gmail", 3)));
            resume.send(()).expect("resume first tool");
            anyhow::Ok(())
        }
    );
    result?;
    changes?;
    assert_eq!(plugins.lists.load(Ordering::SeqCst), 3);
    assert_eq!(skills.lists.load(Ordering::SeqCst), 3);
    let requests = response.requests();
    assert_eq!(requests.len(), 2);
    assert!(
        requests[0]
            .message_input_texts("developer")
            .join("\n")
            .contains("Cloud gmail revision 2")
    );
    assert!(
        requests[1]
            .message_input_texts("developer")
            .join("\n")
            .contains("Cloud gmail revision 3")
    );
    Ok(())
}

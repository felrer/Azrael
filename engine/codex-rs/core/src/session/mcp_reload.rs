//! Agent-initiated, thread-scoped MCP reload without rewriting conversation history.

use super::*;
use std::collections::BTreeMap;
use std::time::Duration;

#[derive(serde::Serialize)]
pub(crate) struct McpReloadResult {
    pub ready: bool,
    pub servers: BTreeMap<String, bool>,
    pub tool_count: usize,
}

impl Session {
    pub(crate) async fn reload_mcp_servers_from_disk(
        self: &Arc<Self>,
        reconnect_servers: &[String],
    ) -> anyhow::Result<McpReloadResult> {
        let mut published = false;
        for _ in 0..3 {
            let expected = {
                let state = self.state.lock().await;
                Arc::clone(&state.session_configuration.original_config_do_not_use)
            };
            let layers = expected.config_layer_stack.reload_local_mcp_servers()?;
            let next = Config::rebuild_with_session_layers(
                &expected.config_layer_stack,
                expected.cwd.to_path_buf(),
                &layers,
                expected.codex_home.clone(),
                None,
            )
            .await?;
            match self.refresh_mcp_config(expected, next).await {
                crate::ConfigRefreshOutcome::Published => {
                    published = true;
                    break;
                }
                crate::ConfigRefreshOutcome::Stale => continue,
                crate::ConfigRefreshOutcome::Rejected => {
                    anyhow::bail!("MCP configuration was rejected by current policy")
                }
            }
        }
        anyhow::ensure!(
            published,
            "MCP configuration changed concurrently; retry reload"
        );
        self.refresh_mcp_if_dirty().await;
        let runtime = &self.services.mcp_runtime;
        let config = runtime
            .current_config()
            .ok_or_else(|| anyhow::anyhow!("MCP runtime unavailable"))?;
        let configured = codex_mcp::configured_mcp_servers(&config);
        // The catalog also contains auth-gated built-ins that the runtime does not
        // register. Reuse its published eligibility decision rather than waiting
        // for nonexistent connections or independently re-evaluating permissions.
        let registered = runtime.connection_statuses(&config).await;
        for name in reconnect_servers {
            anyhow::ensure!(
                configured.get(name).is_some_and(|server| server.enabled)
                    && registered.contains_key(name),
                "MCP reconnect target is missing, disabled or ineligible: {name}"
            );
        }
        if !reconnect_servers.is_empty() {
            runtime.reconnect_servers_on_next_refresh(reconnect_servers);
            self.mark_mcp_runtime_dirty();
            self.refresh_mcp_if_dirty().await;
        }
        let names = configured.into_iter().filter_map(|(name, server)| {
            (server.enabled && registered.contains_key(&name)).then_some(name)
        });
        let servers = futures::future::join_all(names.map(|name| async move {
            let ready = runtime
                .latest_wait_for_server_ready(&name, Duration::from_secs(30))
                .await;
            (name, ready)
        }))
        .await
        .into_iter()
        .collect::<BTreeMap<_, _>>();
        // Read the catalog only after readiness, so a reconnect cannot report its old cached tools.
        let tool_count = runtime.latest_list_all_tools().await.len();
        Ok(McpReloadResult {
            ready: servers.values().all(|ready| *ready),
            servers,
            tool_count,
        })
    }
}

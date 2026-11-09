//! Service selection owns idle publication; individual requests own credential leases.

use crate::connection_manager::McpConnectionSet;
use crate::{CODEX_APPS_MCP_SERVER_NAME, McpConfig, McpRuntime, McpRuntimeInput};
use anyhow::Result;
use futures::future::BoxFuture;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, Weak};
use tokio::sync::watch;

#[derive(Clone)]
pub struct McpServiceRequestResolver(
    Arc<dyn Fn() -> BoxFuture<'static, Result<McpRuntimeInput>> + Send + Sync>,
);

impl McpServiceRequestResolver {
    pub fn new(
        resolve: impl Fn() -> BoxFuture<'static, Result<McpRuntimeInput>> + Send + Sync + 'static,
    ) -> Self {
        Self(Arc::new(resolve))
    }
}

#[derive(Default)]
pub(crate) struct ServiceRequestState {
    resolver: Mutex<Option<McpServiceRequestResolver>>,
    scopes: Mutex<Vec<ServiceScope>>,
}

struct ServiceScope {
    auth_home: PathBuf,
    connections: Option<Weak<McpConnectionSet>>,
    client: Option<Weak<codex_rmcp_client::RmcpClient>>,
    runtime: Option<Weak<McpRuntime>>,
    cancellation: watch::Sender<()>,
}

impl ServiceRequestState {
    pub(crate) fn set_resolver(&self, resolver: McpServiceRequestResolver) {
        *self
            .resolver
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(resolver);
    }

    pub(crate) fn enabled(&self) -> bool {
        self.resolver
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_some()
    }

    pub(crate) async fn resolve_input(&self) -> Result<McpRuntimeInput> {
        let resolver = self
            .resolver
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
            .ok_or_else(|| anyhow::anyhow!("service resolver is unavailable"))?;
        let mut input = (resolver.0)().await?;
        // The operation may only initialize the trusted hosted Apps registration.
        input
            .mcp_servers
            .retain(|name, _| name == CODEX_APPS_MCP_SERVER_NAME);
        anyhow::ensure!(!input.mcp_servers.is_empty(), "Apps service is unavailable");
        anyhow::ensure!(
            input
                .config
                .mcp_server_catalog
                .server(CODEX_APPS_MCP_SERVER_NAME)
                .is_some_and(|server| server
                    .source()
                    .is_host_owned_apps(CODEX_APPS_MCP_SERVER_NAME, server.config())),
            "Apps service registration is not host-owned"
        );
        input.config = Arc::new(input.config.for_threadless_operations(&input.mcp_servers));
        Ok(input)
    }

    pub(crate) async fn capture(&self) -> Result<Arc<McpRuntime>> {
        let input = self.resolve_input().await?;
        let scope = Arc::new(McpRuntime::new(input).await);
        let config = scope.service_config();
        if let Some(config) = config {
            self.track(
                &config,
                &scope.latest_connections(),
                scope.service_cancellation_sender(),
                Some(&scope),
            );
        }
        Ok(scope)
    }

    pub(crate) fn track(
        &self,
        config: &McpConfig,
        connections: &Arc<McpConnectionSet>,
        cancellation: watch::Sender<()>,
        runtime: Option<&Arc<McpRuntime>>,
    ) {
        let Some(binding) = config.azrael_service_account.as_ref() else {
            return;
        };
        let mut scopes = self
            .scopes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        scopes.retain(|scope| {
            scope
                .connections
                .as_ref()
                .is_some_and(|connections| connections.strong_count() > 0)
                || scope
                    .client
                    .as_ref()
                    .is_some_and(|client| client.strong_count() > 0)
        });
        scopes.push(ServiceScope {
            auth_home: binding.profile.auth_home().to_path_buf(),
            connections: Some(Arc::downgrade(connections)),
            client: None,
            runtime: runtime.map(Arc::downgrade),
            cancellation,
        });
    }

    pub(crate) fn track_event_client(
        &self,
        scope: &McpRuntime,
        client: &Arc<codex_rmcp_client::RmcpClient>,
    ) {
        let Some(config) = scope.service_config() else {
            return;
        };
        let Some(binding) = &config.azrael_service_account else {
            return;
        };
        self.scopes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(ServiceScope {
                auth_home: binding.profile.auth_home().to_path_buf(),
                connections: None,
                client: Some(Arc::downgrade(client)),
                cancellation: scope.service_cancellation_sender(),
                runtime: None,
            });
    }

    pub(crate) fn poll_retirements(&self) {
        let mut scopes = self
            .scopes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        scopes.retain(|scope| {
            let connections = scope.connections.as_ref().and_then(Weak::upgrade);
            let client = scope.client.as_ref().and_then(Weak::upgrade);
            if connections.is_none() && client.is_none() {
                return false;
            }
            // Status reads only marker/metadata files; no auth resolution or backend traffic.
            let retired = codex_login::AzraelProfileStore::new(
                scope
                    .auth_home
                    .parent()
                    .unwrap_or(&scope.auth_home)
                    .to_path_buf(),
            )
            .status(
                scope
                    .auth_home
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or(""),
            )
            .is_ok_and(|status| status != codex_login::AzraelProfileStatus::Available);
            if retired {
                scope.cancellation.send_replace(());
                if let Some(runtime) = scope.runtime.as_ref().and_then(Weak::upgrade) {
                    runtime.retire_stale_service_runtime(
                        &codex_login::AzraelServiceAccountSelection::default(),
                    );
                }
                if let Some(connections) = connections {
                    connections.cancel_hosted_service();
                }
                if let Some(client) = client {
                    tokio::spawn(async move {
                        client.shutdown().await;
                    });
                }
                return false;
            }
            true
        });
    }
}

/// Transport recipes may outlive a request after shutdown. They must not own a
/// profile lease; the published/request config owns it while the scope is live.
pub(crate) fn service_auth_provider(
    manager: &Arc<codex_login::AuthManager>,
    auth: &codex_login::CodexAuth,
) -> codex_api::SharedAuthProvider {
    Arc::new(ServiceAuthProvider {
        manager: Arc::downgrade(manager),
        account: auth.get_account_id(),
        user: auth.get_chatgpt_user_id(),
    })
}

struct ServiceAuthProvider {
    manager: Weak<codex_login::AuthManager>,
    account: Option<String>,
    user: Option<String>,
}

impl ServiceAuthProvider {
    fn provider(
        &self,
        manager: &codex_login::AuthManager,
    ) -> Option<codex_api::SharedAuthProvider> {
        let auth = manager.auth_cached()?;
        (auth.uses_codex_backend()
            && auth.get_account_id() == self.account
            && auth.get_chatgpt_user_id() == self.user)
            .then(|| codex_model_provider::auth_provider_from_auth(&auth))
    }
}

impl codex_api::AuthProvider for ServiceAuthProvider {
    fn add_auth_headers(&self, headers: &mut http::HeaderMap) {
        if let Some(manager) = self.manager.upgrade() {
            if let Some(provider) = self.provider(&manager) {
                provider.add_auth_headers(headers);
            }
        }
    }
    fn resolve_auth_headers(&self) -> codex_api::AuthHeadersFuture<'_> {
        Box::pin(async move {
            let manager = self.manager.upgrade().ok_or_else(|| {
                codex_api::AuthError::Transient("service request scope ended".into())
            })?;
            let auth = manager.auth().await.ok_or_else(|| {
                codex_api::AuthError::Transient("service account is unavailable".into())
            })?;
            if !auth.uses_codex_backend()
                || auth.get_account_id() != self.account
                || auth.get_chatgpt_user_id() != self.user
            {
                return Err(codex_api::AuthError::Transient(
                    "service account identity changed".into(),
                ));
            }
            Ok(codex_model_provider::auth_provider_from_auth(&auth).to_auth_headers())
        })
    }
}

//! Test-only helpers exposed for cross-crate integration tests.
//!
//! Production code should receive an [`AuthRouteConfig`](crate::AuthRouteConfig) adapted from the
//! application's resolved HTTP client factory instead of depending on this module.

use crate::AuthManager;
use crate::AuthRouteConfig;
use crate::CodexAuth;
use crate::auth::AgentIdentityAuth;
use crate::auth::AgentIdentityAuthRecord;
use codex_http_client::HttpClientFactory;
use codex_http_client::OutboundProxyPolicy;
use codex_protocol::account::PlanType as AccountPlanType;
use std::sync::Arc;

/// Synthetic, short-lived ChatGPT credentials for isolated fixtures. Never use
/// these unsigned tokens with a live service.
pub fn fixture_chatgpt_auth(account: &str) -> crate::auth::AuthDotJson {
    use base64::Engine;
    let encode = |value: &[u8]| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(value);
    let payload = serde_json::to_vec(&serde_json::json!({
        "exp": chrono::Utc::now().timestamp() + 3600,
        "https://api.openai.com/auth": {
            "chatgpt_account_id": account, "chatgpt_user_id": "fixture-user",
            "user_id": "fixture-user", "chatgpt_plan_type": "team"
        }
    }))
    .expect("serialize fixture token");
    let token = format!(
        "{}.{}.c2ln",
        encode(br#"{"alg":"none","typ":"JWT"}"#),
        encode(&payload)
    );
    serde_json::from_value(serde_json::json!({
        "auth_mode":"chatgpt",
        "tokens": {"id_token":token,"access_token":token,"refresh_token":"fixture-refresh","account_id":account},
        "last_refresh": chrono::Utc::now()
    })).expect("deserialize fixture credentials")
}

/// Isolated cross-crate fixture using the production selection and identity
/// validation with process-local credentials, never the user's keyring.
pub struct EphemeralServiceAccounts {
    pub selection: crate::AzraelServiceAccountStore,
    profiles: crate::AzraelProfileStore,
}

impl EphemeralServiceAccounts {
    pub fn new(codex_home: &std::path::Path) -> Self {
        Self {
            selection: crate::AzraelServiceAccountStore::new(codex_home),
            profiles: crate::AzraelProfileStore::new_ephemeral(codex_home.join("azrael/accounts")),
        }
    }

    pub async fn create(
        &self,
        template: &AuthManager,
        auth: &crate::auth::AuthDotJson,
    ) -> std::io::Result<Arc<crate::AzraelProfileAuth>> {
        let profile = self.profiles.create(template).await?;
        crate::save_auth(
            profile.auth_home(),
            auth,
            codex_config::types::AuthCredentialsStoreMode::Ephemeral,
            codex_config::types::AuthKeyringBackendKind::default(),
        )?;
        profile.finalize().await?;
        Ok(profile)
    }

    pub async fn resolve(
        &self,
        template: &AuthManager,
    ) -> std::io::Result<crate::AzraelServiceAccountBinding> {
        self.selection
            .resolve_with_store(template, &self.profiles)
            .await
    }
}

/// Creates an authentication manager with optional credentials for cross-crate tests.
pub fn auth_manager_from_optional_auth(auth: Option<CodexAuth>) -> Arc<AuthManager> {
    AuthManager::from_optional_auth_for_testing(auth)
}

/// Creates an authentication manager with initialized Agent Identity credentials for tests.
pub async fn auth_manager_with_agent_identity() -> std::io::Result<Arc<AuthManager>> {
    let key_material =
        codex_agent_identity::generate_agent_key_material().map_err(std::io::Error::other)?;
    let auth = AgentIdentityAuth::from_record(
        AgentIdentityAuthRecord {
            agent_runtime_id: "test-agent-runtime-id".to_string(),
            agent_private_key: key_material.private_key_pkcs8_base64,
            account_id: "test-account-id".to_string(),
            chatgpt_user_id: "test-user-id".to_string(),
            email: Some("test-user@example.com".to_string()),
            plan_type: AccountPlanType::Pro,
            chatgpt_account_is_fedramp: false,
            task_id: Some("test-task-id".to_string()),
        },
        "https://unused.invalid",
        &transport_default_auth_route_config(),
    )
    .await?;
    Ok(auth_manager_from_optional_auth(Some(
        CodexAuth::AgentIdentity(auth),
    )))
}

/// Returns auth routing that preserves the transport's built-in proxy behavior.
pub fn transport_default_auth_route_config() -> AuthRouteConfig {
    AuthRouteConfig::from_http_client_factory(HttpClientFactory::new(
        OutboundProxyPolicy::ReqwestDefault,
    ))
}

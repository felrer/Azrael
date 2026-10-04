use super::*;
use base64::Engine;
use chrono::Utc;
use serde_json::json;
use serial_test::serial;
use std::sync::atomic::AtomicUsize;
use tempfile::tempdir;

struct RefreshingProvider {
    initial: CodexAuth,
    refreshed: CodexAuth,
    refresh_count: AtomicUsize,
}

impl ExternalAuth for RefreshingProvider {
    fn resolve(&self) -> ExternalAuthFuture<'_, CodexAuth> {
        Box::pin(async { Ok(self.initial.clone()) })
    }

    fn refresh(&self, _context: ExternalAuthRefreshContext) -> ExternalAuthFuture<'_, CodexAuth> {
        self.refresh_count.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(self.refreshed.clone()) })
    }
}

fn header_auth(marker: &'static str) -> CodexAuth {
    let mut headers = http::HeaderMap::new();
    headers.insert(
        http::header::AUTHORIZATION,
        http::HeaderValue::from_static("Bearer test"),
    );
    headers.insert(
        "chatgpt-account-id",
        http::HeaderValue::from_static("account-one"),
    );
    headers.insert("x-auth-marker", http::HeaderValue::from_static(marker));
    CodexAuth::Headers(AuthHeaders::new(headers))
}

fn chatgpt_auth_json(access_token: &str, refresh_token: &str) -> AuthDotJson {
    let encode = |value: &[u8]| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(value);
    let header = encode(br#"{"alg":"none","typ":"JWT"}"#);
    let payload = encode(
        &serde_json::to_vec(&json!({
            "email": "person@example.com",
            "https://api.openai.com/auth": {
                "chatgpt_account_id": "workspace-1",
                "chatgpt_user_id": "user-1",
                "user_id": "user-1",
                "chatgpt_plan_type": "team",
            }
        }))
        .expect("serialize JWT payload"),
    );
    AuthDotJson {
        auth_mode: Some(AuthMode::Chatgpt),
        openai_api_key: None,
        tokens: Some(TokenData {
            id_token: crate::token_data::IdTokenInfo {
                email: Some("person@example.com".to_string()),
                chatgpt_plan_type: Some(InternalPlanType::from_raw_value("team")),
                chatgpt_user_id: Some("user-1".to_string()),
                chatgpt_account_id: Some("workspace-1".to_string()),
                chatgpt_account_is_fedramp: false,
                raw_jwt: format!("{header}.{payload}.c2ln"),
            },
            access_token: access_token.to_string(),
            refresh_token: refresh_token.to_string(),
            account_id: Some("workspace-1".to_string()),
        }),
        last_refresh: Some(Utc::now()),
        agent_identity: None,
        personal_access_token: None,
        bedrock_api_key: None,
        bedrock_access_keys: None,
    }
}

fn access_token(auth: Option<CodexAuth>) -> Option<String> {
    auth.and_then(|auth| auth.get_current_auth_json())
        .and_then(|auth| auth.tokens)
        .map(|tokens| tokens.access_token)
}

struct TestAuthConfig {
    home: PathBuf,
    store_mode: AuthCredentialsStoreMode,
}

impl AuthManagerConfig for TestAuthConfig {
    fn codex_home(&self) -> PathBuf {
        self.home.clone()
    }

    fn cli_auth_credentials_store_mode(&self) -> AuthCredentialsStoreMode {
        self.store_mode
    }

    fn auth_keyring_backend_kind(&self) -> AuthKeyringBackendKind {
        AuthKeyringBackendKind::default()
    }

    fn forced_login_method(&self) -> Option<ForcedLoginMethod> {
        None
    }

    fn forced_chatgpt_workspace_id(&self) -> Option<Vec<String>> {
        None
    }

    fn managed_auth_policy(&self) -> ManagedAuthPolicy {
        ManagedAuthPolicy::default()
    }

    fn chatgpt_base_url(&self) -> String {
        "https://chatgpt.com/backend-api".to_string()
    }

    fn auth_route_config(&self) -> AuthRouteConfig {
        crate::test_support::transport_default_auth_route_config()
    }
}

fn test_config(root: &Path) -> TestAuthConfig {
    TestAuthConfig {
        home: root.to_path_buf(),
        store_mode: AuthCredentialsStoreMode::Ephemeral,
    }
}

async fn leased_manager(root: &Path) -> Arc<AuthManager> {
    save_auth(
        root,
        &chatgpt_auth_json("initial-access", "initial-refresh"),
        AuthCredentialsStoreMode::Ephemeral,
        AuthKeyringBackendKind::default(),
    )
    .expect("save ephemeral auth");
    AuthManager::shared_for_azrael(&test_config(root), false)
        .await
        .expect("create azrael authentication manager")
}

#[tokio::test]
async fn azrael_unmanaged_shared_usage_allows_independent_managers() {
    let root = tempdir().expect("tempdir");
    let first = leased_manager(root.path()).await;
    let second = AuthManager::shared_for_azrael(&test_config(root.path()), false)
        .await
        .expect("create independent authentication manager");

    assert!(first.owns_azrael_unmanaged_auth_lease());
    assert!(second.owns_azrael_unmanaged_auth_lease());
    assert!(
        first
            .auth_cached()
            .is_some_and(|auth| auth.auth_mode() == AuthMode::Chatgpt)
    );
    assert!(
        second
            .auth_cached()
            .is_some_and(|auth| auth.auth_mode() == AuthMode::Chatgpt)
    );

    first.release_azrael_unmanaged_auth_lease();
    assert!(!first.owns_azrael_unmanaged_auth_lease());
    assert!(second.owns_azrael_unmanaged_auth_lease());
}

#[test]
fn azrael_unmanaged_shared_lease_handles_release_and_reacquire_independently() {
    let root = tempdir().expect("tempdir");
    let first = AzraelUnmanagedAuthLease::acquire_shared(root.path()).expect("first lease");
    let second = AzraelUnmanagedAuthLease::acquire_shared(root.path()).expect("shared lease");
    assert!(!Arc::ptr_eq(&first, &second));

    first.release();
    assert!(second.owns());
    first.acquire().expect("reacquire lease");
    assert!(first.owns());
}

#[tokio::test]
async fn azrael_unmanaged_empty_manager_releases_shared_usage_for_first_login() {
    let root = tempdir().expect("tempdir");
    let manager = AuthManager::shared_for_azrael(&test_config(root.path()), false)
        .await
        .expect("create empty manager");

    assert!(manager.auth_cached().is_none());
    assert!(!manager.owns_azrael_unmanaged_auth_lease());
}

#[tokio::test]
async fn azrael_unmanaged_mutation_guard_preserves_ownership_and_release_intent() {
    let root = tempdir().expect("tempdir");
    let manager = AuthManager::shared_for_azrael(&test_config(root.path()), false)
        .await
        .expect("create empty manager");
    manager
        .acquire_azrael_unmanaged_auth_lease()
        .expect("acquire root usage for login");

    let mutation = manager
        .lock_azrael_unmanaged_mutation()
        .await
        .expect("acquire root mutation")
        .expect("root mutation guard");
    assert!(manager.owns_azrael_unmanaged_auth_lease());
    save_auth(
        root.path(),
        &chatgpt_auth_json("replacement-access", "replacement-refresh"),
        AuthCredentialsStoreMode::Ephemeral,
        AuthKeyringBackendKind::default(),
    )
    .expect("save credentials while mutation is exclusive");
    manager.reload().await;
    assert!(manager.auth_cached().is_some());
    drop(mutation);
    assert!(manager.owns_azrael_unmanaged_auth_lease());

    let mutation = manager
        .lock_azrael_unmanaged_mutation()
        .await
        .expect("reacquire root mutation")
        .expect("root mutation guard");
    manager.release_azrael_unmanaged_auth_lease();
    assert!(!manager.owns_azrael_unmanaged_auth_lease());
    drop(mutation);
    assert!(!manager.owns_azrael_unmanaged_auth_lease());
}

#[tokio::test]
async fn azrael_unmanaged_old_exclusive_busy_starts_without_credentials_and_reacquires() {
    let root = tempdir().expect("tempdir");
    save_auth(
        root.path(),
        &chatgpt_auth_json("initial-access", "initial-refresh"),
        AuthCredentialsStoreMode::Ephemeral,
        AuthKeyringBackendKind::default(),
    )
    .expect("save ephemeral auth");
    let lock_dir = root.path().join("azrael");
    std::fs::create_dir_all(&lock_dir).expect("create lock directory");
    let old_exclusive = try_lock_exclusive_file(
        &lock_dir.join("unmanaged-auth.lock"),
        "old engine owns unmanaged authentication",
    )
    .expect("hold old exclusive lease");

    let manager = AuthManager::shared_for_azrael(&test_config(root.path()), false)
        .await
        .expect("busy old lease does not prevent startup");
    assert!(manager.auth_cached().is_none());
    assert!(!manager.owns_azrael_unmanaged_auth_lease());

    drop(old_exclusive);
    manager
        .acquire_azrael_unmanaged_auth_lease()
        .expect("acquire shared usage after old engine exits");
    manager.reload().await;
    assert!(manager.auth_cached().is_some());
}

#[tokio::test]
async fn azrael_unmanaged_busy_mutation_preserves_credentials() {
    let root = tempdir().expect("tempdir");
    let first = leased_manager(root.path()).await;
    let second = AuthManager::shared_for_azrael(&test_config(root.path()), false)
        .await
        .expect("create independent authentication manager");

    let Err(error) = first.lock_azrael_unmanaged_mutation().await else {
        panic!("competing shared owner should prevent mutation");
    };
    assert_eq!(error.kind(), io::ErrorKind::WouldBlock);
    assert!(first.auth_cached().is_some());
    assert!(second.auth_cached().is_some());
    assert!(first.owns_azrael_unmanaged_auth_lease());

    second.release_azrael_unmanaged_auth_lease();
    let mutation = first
        .lock_azrael_unmanaged_mutation()
        .await
        .expect("exclusive mutation after competing owner releases")
        .expect("root mutation guard");
    first.logout().await.expect("clear root credentials");
    drop(mutation);
    assert!(first.auth_cached().is_none());
}

#[tokio::test]
async fn azrael_unmanaged_refresh_transaction_reloads_persisted_auth_before_authority() {
    let root = tempdir().expect("tempdir");
    save_auth(
        root.path(),
        &chatgpt_auth_json("initial-access", "initial-refresh"),
        AuthCredentialsStoreMode::Ephemeral,
        AuthKeyringBackendKind::default(),
    )
    .expect("save initial auth");
    let first = AuthManager::shared_for_azrael(&test_config(root.path()), false)
        .await
        .expect("create first manager");
    let second = AuthManager::shared_for_azrael(&test_config(root.path()), false)
        .await
        .expect("create second manager");
    let transaction = first
        .lock_azrael_unmanaged_refresh()
        .await
        .expect("lock root refresh transaction")
        .expect("root refresh transaction");
    let refresh_manager = Arc::clone(&second);
    let refresh = tokio::spawn(async move { refresh_manager.refresh_token().await });
    tokio::task::yield_now().await;
    assert!(!refresh.is_finished());
    save_auth(
        root.path(),
        &chatgpt_auth_json("persisted-access", "persisted-refresh"),
        AuthCredentialsStoreMode::Ephemeral,
        AuthKeyringBackendKind::default(),
    )
    .expect("persist credentials refreshed by another owner");
    drop(transaction);

    refresh
        .await
        .expect("refresh task")
        .expect("reload avoids authority refresh");
    assert_eq!(
        access_token(second.auth_cached()),
        Some("persisted-access".to_string())
    );
}

#[tokio::test]
async fn azrael_unmanaged_released_manager_cannot_reload_root_auth() {
    let root = tempdir().expect("tempdir");
    let manager = leased_manager(root.path()).await;
    assert!(manager.auth_cached().is_some());

    manager.release_azrael_unmanaged_auth_lease();
    manager.reload().await;
    assert!(manager.auth_cached().is_none());

    manager
        .acquire_azrael_unmanaged_auth_lease()
        .expect("reacquire lease");
    manager.reload().await;
    assert!(manager.auth_cached().is_some());
}

#[tokio::test]
async fn azrael_unmanaged_released_manager_cannot_refresh_root_auth() {
    let root = tempdir().expect("tempdir");
    let manager = leased_manager(root.path()).await;
    manager.release_azrael_unmanaged_auth_lease();

    let error = manager
        .refresh_token()
        .await
        .expect_err("released manager must not refresh");
    assert!(matches!(
        error,
        RefreshTokenError::Transient(error)
            if error.kind() == io::ErrorKind::PermissionDenied
    ));
}

#[tokio::test]
async fn azrael_unmanaged_stored_api_key_remains_saved_but_cannot_authenticate() {
    let root = tempdir().expect("tempdir");
    let saved = AuthDotJson {
        auth_mode: Some(AuthMode::ApiKey),
        openai_api_key: Some("saved-test-key".to_string()),
        tokens: None,
        last_refresh: None,
        agent_identity: None,
        personal_access_token: None,
        bedrock_api_key: None,
        bedrock_access_keys: None,
    };
    save_auth(
        root.path(),
        &saved,
        AuthCredentialsStoreMode::File,
        AuthKeyringBackendKind::default(),
    )
    .expect("save API key auth");
    let config = TestAuthConfig {
        home: root.path().to_path_buf(),
        store_mode: AuthCredentialsStoreMode::File,
    };
    let manager = AuthManager::shared_for_azrael(&config, false)
        .await
        .expect("create Azrael manager");
    assert_eq!(
        manager.allowed_login_methods(),
        vec![ForcedLoginMethod::Chatgpt]
    );
    assert!(manager.auth_cached().is_none());
    assert_eq!(
        load_auth_dot_json(
            root.path(),
            AuthCredentialsStoreMode::File,
            AuthKeyringBackendKind::default(),
        )
        .expect("read stored auth"),
        Some(saved)
    );
    let ordinary = AuthManager::shared_from_config(&config, false)
        .await
        .expect("create ordinary manager");
    assert!(
        ordinary
            .auth_cached()
            .is_some_and(|auth| auth.is_api_key_auth())
    );
}

#[serial(codex_auth_env)]
#[tokio::test]
async fn azrael_unmanaged_env_api_key_cannot_authenticate() {
    struct EnvGuard(Option<std::ffi::OsString>);
    impl Drop for EnvGuard {
        fn drop(&mut self) {
            unsafe {
                match self.0.take() {
                    Some(previous) => std::env::set_var(CODEX_API_KEY_ENV_VAR, previous),
                    None => std::env::remove_var(CODEX_API_KEY_ENV_VAR),
                }
            }
        }
    }

    let root = tempdir().expect("tempdir");
    let _guard = EnvGuard(std::env::var_os(CODEX_API_KEY_ENV_VAR));
    unsafe { std::env::set_var(CODEX_API_KEY_ENV_VAR, "env-test-key") };
    let manager = AuthManager::shared_for_azrael(&test_config(root.path()), true)
        .await
        .expect("create Azrael manager");
    assert!(manager.auth_cached().is_none());
    let ordinary = AuthManager::shared_from_config(&test_config(root.path()), true)
        .await
        .expect("create ordinary manager");
    assert!(
        ordinary
            .auth_cached()
            .is_some_and(|auth| auth.is_api_key_auth())
    );
}

#[tokio::test]
async fn azrael_unmanaged_released_lease_allows_external_provider_refresh() {
    let root = tempdir().expect("tempdir");
    let manager = leased_manager(root.path()).await;
    let provider = Arc::new(RefreshingProvider {
        initial: header_auth("initial"),
        refreshed: header_auth("refreshed"),
        refresh_count: AtomicUsize::new(0),
    });
    manager
        .set_external_auth(provider.clone())
        .await
        .expect("install external provider");
    manager.release_azrael_unmanaged_auth_lease();

    manager
        .refresh_token()
        .await
        .expect("external refresh after lease release");
    manager
        .refresh_token_from_authority()
        .await
        .expect("direct external refresh after lease release");

    assert_eq!(provider.refresh_count.load(Ordering::SeqCst), 2);
    assert_eq!(manager.auth_cached(), Some(header_auth("refreshed")));
}

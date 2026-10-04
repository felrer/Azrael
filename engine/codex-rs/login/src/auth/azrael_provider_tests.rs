use super::*;
use std::sync::atomic::AtomicUsize;
use tokio::sync::Notify;

struct GatedExternalAuth {
    initial: CodexAuth,
    refreshed: CodexAuth,
    resolve_count: AtomicUsize,
    block_resolve_after: Option<usize>,
    resolve_entered: Notify,
    resolve_release: Notify,
    block_refresh: bool,
    refresh_entered: Notify,
    refresh_release: Notify,
}

impl GatedExternalAuth {
    fn delayed_reload(auth: CodexAuth) -> Self {
        Self {
            initial: auth.clone(),
            refreshed: auth,
            resolve_count: AtomicUsize::new(0),
            block_resolve_after: Some(1),
            resolve_entered: Notify::new(),
            resolve_release: Notify::new(),
            block_refresh: false,
            refresh_entered: Notify::new(),
            refresh_release: Notify::new(),
        }
    }

    fn delayed_refresh(initial: CodexAuth, refreshed: CodexAuth) -> Self {
        Self {
            initial,
            refreshed,
            resolve_count: AtomicUsize::new(0),
            block_resolve_after: None,
            resolve_entered: Notify::new(),
            resolve_release: Notify::new(),
            block_refresh: true,
            refresh_entered: Notify::new(),
            refresh_release: Notify::new(),
        }
    }
}

impl ExternalAuth for GatedExternalAuth {
    fn resolve(&self) -> ExternalAuthFuture<'_, CodexAuth> {
        let call = self.resolve_count.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move {
            if self.block_resolve_after.is_some_and(|after| call >= after) {
                self.resolve_entered.notify_one();
                self.resolve_release.notified().await;
            }
            Ok(self.initial.clone())
        })
    }

    fn refresh(&self, _context: ExternalAuthRefreshContext) -> ExternalAuthFuture<'_, CodexAuth> {
        Box::pin(async move {
            if self.block_refresh {
                self.refresh_entered.notify_one();
                self.refresh_release.notified().await;
            }
            Ok(self.refreshed.clone())
        })
    }
}

#[derive(Clone)]
struct StaticExternalAuth(CodexAuth);

impl ExternalAuth for StaticExternalAuth {
    fn resolve(&self) -> ExternalAuthFuture<'_, CodexAuth> {
        Box::pin(async { Ok(self.0.clone()) })
    }

    fn refresh(&self, _context: ExternalAuthRefreshContext) -> ExternalAuthFuture<'_, CodexAuth> {
        Box::pin(async { Ok(self.0.clone()) })
    }
}

fn account_auth(account_id: &'static str) -> CodexAuth {
    let mut headers = http::HeaderMap::new();
    headers.insert(
        http::header::AUTHORIZATION,
        http::HeaderValue::from_static("Bearer test"),
    );
    headers.insert(
        "chatgpt-account-id",
        http::HeaderValue::from_static(account_id),
    );
    CodexAuth::Headers(AuthHeaders::new(headers))
}

fn cached_account(manager: &AuthManager) -> Option<String> {
    manager.auth_cached().and_then(|auth| auth.get_account_id())
}

#[tokio::test]
async fn azrael_delayed_old_reload_cannot_restore_previous_account() {
    let old = account_auth("account-old");
    let new = account_auth("account-new");
    let manager = AuthManager::from_optional_auth_for_testing(None);
    let old_provider = Arc::new(GatedExternalAuth::delayed_reload(old));
    manager
        .set_external_auth(old_provider.clone())
        .await
        .expect("install old provider");

    let reload_manager = Arc::clone(&manager);
    let reload = tokio::spawn(async move { reload_manager.reload().await });
    old_provider.resolve_entered.notified().await;
    manager
        .set_external_auth(Arc::new(StaticExternalAuth(new)))
        .await
        .expect("install new provider");
    old_provider.resolve_release.notify_one();

    assert!(!reload.await.expect("reload task"));
    assert_eq!(cached_account(&manager).as_deref(), Some("account-new"));
}

#[tokio::test]
async fn azrael_delayed_guarded_reload_cannot_restore_previous_account() {
    let old = account_auth("account-old");
    let new = account_auth("account-new");
    let manager = AuthManager::from_optional_auth_for_testing(None);
    let old_provider = Arc::new(GatedExternalAuth::delayed_reload(old));
    manager
        .set_external_auth(old_provider.clone())
        .await
        .expect("install old provider");

    let refresh_manager = Arc::clone(&manager);
    let refresh = tokio::spawn(async move { refresh_manager.refresh_token().await });
    old_provider.resolve_entered.notified().await;
    manager
        .set_external_auth(Arc::new(StaticExternalAuth(new)))
        .await
        .expect("install new provider");
    old_provider.resolve_release.notify_one();

    assert!(matches!(
        refresh.await.expect("refresh task"),
        Err(RefreshTokenError::Permanent(_))
    ));
    assert_eq!(cached_account(&manager).as_deref(), Some("account-new"));
}

#[tokio::test]
async fn azrael_delayed_old_refresh_cannot_restore_previous_account() {
    let old = account_auth("account-old");
    let old_refreshed = account_auth("account-old-refreshed");
    let new = account_auth("account-new");
    let manager = AuthManager::from_optional_auth_for_testing(None);
    let old_provider = Arc::new(GatedExternalAuth::delayed_refresh(old, old_refreshed));
    manager
        .set_external_auth(old_provider.clone())
        .await
        .expect("install old provider");

    let refresh_manager = Arc::clone(&manager);
    let refresh = tokio::spawn(async move { refresh_manager.refresh_token_from_authority().await });
    old_provider.refresh_entered.notified().await;
    manager
        .set_external_auth(Arc::new(StaticExternalAuth(new)))
        .await
        .expect("install new provider");
    old_provider.refresh_release.notify_one();

    refresh
        .await
        .expect("refresh task")
        .expect("obsolete refresh is ignored");
    assert_eq!(cached_account(&manager).as_deref(), Some("account-new"));
}

use super::*;
use codex_config::types::AuthCredentialsStoreMode;
use codex_core::config::ConfigBuilder;
use codex_protocol::auth::AuthMode;
use std::time::Duration;

async fn test_context() -> (
    tempfile::TempDir,
    Config,
    Arc<AuthManager>,
    Arc<azrael_state::AzraelAccountRuntime>,
) {
    let temp = tempfile::tempdir().expect("temporary directory");
    let mut config = ConfigBuilder::default()
        .codex_home(temp.path().to_path_buf())
        .build()
        .await
        .expect("test config");
    config.cli_auth_credentials_store_mode = AuthCredentialsStoreMode::File;
    let auth_manager = AuthManager::shared_from_config(&config, false)
        .await
        .expect("test auth manager");
    let azrael = Arc::new(azrael_state::AzraelAccountRuntime::new(&config));
    (temp, config, auth_manager, azrael)
}

fn synthetic_auth(label: &str) -> codex_login::AuthDotJson {
    codex_login::AuthDotJson {
        auth_mode: Some(AuthMode::ApiKey),
        openai_api_key: Some(format!("synthetic-{label}")),
        tokens: None,
        last_refresh: None,
        agent_identity: None,
        personal_access_token: None,
        bedrock_api_key: None,
        bedrock_access_keys: None,
    }
}

fn install_active_login(
    auth_manager: &Arc<AuthManager>,
) -> (
    Arc<Mutex<Option<ActiveLogin>>>,
    Uuid,
    CancellationToken,
    Arc<tokio::sync::Notify>,
) {
    let login_id = Uuid::new_v4();
    let cancel = CancellationToken::new();
    let completion = Arc::new(tokio::sync::Notify::new());
    let request = auth_manager
        .azrael_admission()
        .begin_switch()
        .expect("login switch should begin");
    let guard = request
        .try_commit()
        .expect("test login should own the idle execution gate");
    let active = ActiveLogin::DeviceCode {
        cancel: cancel.clone(),
        login_id,
        completion: Arc::clone(&completion),
        _unmanaged_refresh_guard: None,
        _change_request: request,
        _change_guard: Some(guard),
    };
    (
        Arc::new(Mutex::new(Some(active))),
        login_id,
        cancel,
        completion,
    )
}

#[tokio::test]
async fn native_account_change_timeout_reopens_admission() {
    let admission = Arc::new(codex_login::AzraelAuthAdmission::default());
    let active_work = admission.enter_task().await;
    let request = admission.begin_switch().expect("begin account change");
    let error = wait_for_native_account_change(&request, Duration::from_millis(20))
        .await
        .expect_err("active work should outlast the bounded wait");
    assert!(error.message.contains("busy"));
    assert!(error.message.contains("retry"));
    drop(request);
    assert!(!admission.is_pending());
    drop(active_work);
    assert!(admission.admit_request().await.is_ok());
}

fn save(config: &Config, auth: &codex_login::AuthDotJson) {
    codex_login::save_auth(
        &config.codex_home,
        auth,
        config.cli_auth_credentials_store_mode,
        config.auth_keyring_backend_kind(),
    )
    .expect("synthetic auth should save");
}

fn load(config: &Config) -> Option<codex_login::AuthDotJson> {
    codex_login::load_auth_dot_json(
        &config.codex_home,
        config.cli_auth_credentials_store_mode,
        config.auth_keyring_backend_kind(),
    )
    .expect("synthetic auth should load")
}

#[tokio::test]
async fn cancel_before_callback_restores_snapshot_before_releasing_writer() {
    let (_temp, config, auth_manager, azrael) = test_context().await;
    let prior = synthetic_auth("prior");
    save(&config, &synthetic_auth("oauth-result"));
    let (active_login, login_id, cancel, completion) = install_active_login(&auth_manager);
    cancel.cancel();

    let settlement = AccountRequestProcessor::settle_native_login(
        &active_login,
        login_id,
        &cancel,
        &config,
        Some(&prior),
        &auth_manager,
        &azrael,
        &completion,
    )
    .await;
    let NativeLoginSettlement::Cancelled(owner) = settlement else {
        panic!("cancelled login should restore and retain ownership");
    };

    assert_eq!(load(&config), Some(prior));
    assert!(auth_manager.azrael_admission().has_active_work());
    assert!(auth_manager.azrael_admission().is_pending());
    drop(owner);
    assert!(!auth_manager.azrael_admission().has_active_work());
    assert!(!auth_manager.azrael_admission().is_pending());
}

#[tokio::test]
async fn callback_take_before_cancel_returns_not_found_and_retains_commit_ownership() {
    let (_temp, config, auth_manager, azrael) = test_context().await;
    let (active_login, login_id, cancel, completion) = install_active_login(&auth_manager);

    let settlement = AccountRequestProcessor::settle_native_login(
        &active_login,
        login_id,
        &cancel,
        &config,
        None,
        &auth_manager,
        &azrael,
        &completion,
    )
    .await;
    let NativeLoginSettlement::Commit(owner) = settlement else {
        panic!("callback should own the uncancelled commit");
    };
    assert!(matches!(
        AccountRequestProcessor::request_native_login_cancel(&active_login, login_id).await,
        Err(CancelLoginError::NotFound)
    ));
    assert!(auth_manager.azrael_admission().has_active_work());
    drop(owner);
    assert!(!auth_manager.azrael_admission().has_active_work());
}

#[tokio::test]
async fn restore_failure_retains_writer_and_permanently_blocks_admission() {
    let (_temp, config, auth_manager, azrael) = test_context().await;
    std::fs::create_dir(config.codex_home.join("auth.json"))
        .expect("directory should force file restore failure");
    let prior = synthetic_auth("prior");
    let (active_login, login_id, cancel, completion) = install_active_login(&auth_manager);
    cancel.cancel();
    let completion_wait = Arc::clone(&completion).notified_owned();

    let settlement = AccountRequestProcessor::settle_native_login(
        &active_login,
        login_id,
        &cancel,
        &config,
        Some(&prior),
        &auth_manager,
        &azrael,
        &completion,
    )
    .await;
    assert!(matches!(settlement, NativeLoginSettlement::RestoreFailed));
    tokio::time::timeout(Duration::from_secs(1), completion_wait)
        .await
        .expect("restore failure should notify registered cancellation waiters");

    assert!(auth_manager.azrael_admission().is_pending());
    assert!(auth_manager.azrael_admission().has_active_work());
    let state = azrael.inner.lock().await;
    assert!(state.failed_closed_guard.is_some());
    assert!(state.last_error.is_some());
}

#[tokio::test]
async fn cancellation_wait_registered_before_callback_does_not_miss_completion() {
    let (_temp, config, auth_manager, azrael) = test_context().await;
    let prior = synthetic_auth("prior");
    save(&config, &synthetic_auth("oauth-result"));
    let (active_login, login_id, cancel, completion) = install_active_login(&auth_manager);
    let cancel_task = {
        let active_login = Arc::clone(&active_login);
        tokio::spawn(async move {
            AccountRequestProcessor::request_native_login_cancel(&active_login, login_id).await
        })
    };
    tokio::time::timeout(Duration::from_secs(1), async {
        while !cancel.is_cancelled() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("cancellation should be registered");

    let settlement = AccountRequestProcessor::settle_native_login(
        &active_login,
        login_id,
        &cancel,
        &config,
        Some(&prior),
        &auth_manager,
        &azrael,
        &completion,
    )
    .await;
    let NativeLoginSettlement::Cancelled(owner) = settlement else {
        panic!("callback should observe the registered cancellation");
    };
    drop(owner);
    completion.notify_waiters();

    tokio::time::timeout(Duration::from_secs(1), cancel_task)
        .await
        .expect("registered waiter should observe callback completion")
        .expect("cancel task should not panic")
        .expect("matching cancellation should succeed");
}

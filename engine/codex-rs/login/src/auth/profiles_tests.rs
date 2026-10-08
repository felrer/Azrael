use super::*;
use base64::Engine;
use chrono::Utc;
use codex_http_client::DestinationPolicy;
use codex_http_client::NetworkPolicyController;
use serde_json::json;
use tempfile::tempdir;

async fn template(home: &Path) -> AuthManager {
    AuthManager::new(
        home.to_path_buf(),
        false,
        AuthCredentialsStoreMode::Ephemeral,
        None,
        None,
        AuthKeyringBackendKind::default(),
        crate::test_support::transport_default_auth_route_config(),
    )
    .await
}

fn jwt(email: &str, account_id: &str, user_id: &str, plan: &str) -> String {
    let encode = |value: &[u8]| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(value);
    let header = encode(br#"{"alg":"none","typ":"JWT"}"#);
    let payload = encode(
        &serde_json::to_vec(&json!({
            "email": email,
            "https://api.openai.com/auth": {
                "chatgpt_account_id": account_id,
                "chatgpt_user_id": user_id,
                "user_id": user_id,
                "chatgpt_plan_type": plan,
            }
        }))
        .expect("serialize JWT payload"),
    );
    format!("{header}.{payload}.c2ln")
}

fn auth_json(email: &str, account_id: &str, user_id: &str) -> AuthDotJson {
    auth_json_with_tokens(email, account_id, user_id, "test-access", "test-refresh")
}

fn auth_json_with_tokens(
    email: &str,
    account_id: &str,
    user_id: &str,
    access_token: &str,
    refresh_token: &str,
) -> AuthDotJson {
    let raw_jwt = jwt(email, account_id, user_id, "team");
    AuthDotJson {
        auth_mode: Some(AuthMode::Chatgpt),
        openai_api_key: None,
        tokens: Some(TokenData {
            id_token: crate::token_data::IdTokenInfo {
                email: Some(email.to_string()),
                chatgpt_plan_type: Some(InternalPlanType::from_raw_value("team")),
                chatgpt_user_id: Some(user_id.to_string()),
                chatgpt_account_id: Some(account_id.to_string()),
                chatgpt_account_is_fedramp: false,
                raw_jwt,
            },
            access_token: access_token.to_string(),
            refresh_token: refresh_token.to_string(),
            account_id: Some(account_id.to_string()),
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

async fn finalized_profile(
    store: &AzraelProfileStore,
    template: &AuthManager,
    account_id: &str,
    user_id: &str,
) -> Arc<AzraelProfileAuth> {
    let profile = store.create(template).await.expect("create profile");
    save_auth(
        profile.auth_home(),
        &auth_json("person@example.com", account_id, user_id),
        AuthCredentialsStoreMode::Ephemeral,
        AuthKeyringBackendKind::default(),
    )
    .expect("save ephemeral auth");
    profile.finalize().await.expect("finalize profile");
    profile
}

#[tokio::test]
async fn profiles_persist_observed_downgrade_without_reusing_stale_token_plan() {
    let root = tempdir().expect("tempdir");
    let template = template(root.path()).await;
    let store = AzraelProfileStore::new_ephemeral(root.path().join("accounts"));
    let profile = finalized_profile(&store, &template, "workspace-1", "user-1").await;
    let auth = profile.manager().auth().await.expect("profile auth");
    assert_eq!(
        profile.info().expect("info").plan_type.as_deref(),
        Some("team")
    );

    profile
        .update_observed_plan(&auth, "free")
        .expect("persist downgrade");

    assert_eq!(
        store.list().expect("list")[0].plan_type.as_deref(),
        Some("free")
    );
    // Reading credentials must not revert the newer backend observation.
    profile.manager().reload().await;
    assert_eq!(
        profile.info().expect("info").plan_type.as_deref(),
        Some("free")
    );
}

#[tokio::test]
async fn profiles_reject_observed_plans_for_different_workspace_or_user() {
    let root = tempdir().expect("tempdir");
    let template = template(root.path()).await;
    let store = AzraelProfileStore::new_ephemeral(root.path().join("accounts"));
    let profile = finalized_profile(&store, &template, "workspace-1", "user-1").await;
    for (workspace, user) in [("workspace-2", "user-1"), ("workspace-1", "user-2")] {
        let other = finalized_profile(&store, &template, workspace, user).await;
        let auth = other.manager().auth().await.expect("other auth");
        assert_eq!(
            profile
                .update_observed_plan(&auth, "free")
                .expect_err("identity mismatch")
                .kind(),
            io::ErrorKind::PermissionDenied
        );
    }
    assert_eq!(
        profile.info().expect("info").plan_type.as_deref(),
        Some("team")
    );
}

#[tokio::test]
async fn profiles_reject_invalid_ids_and_path_traversal() {
    let root = tempdir().expect("tempdir");
    let template = template(root.path()).await;
    let store = AzraelProfileStore::new_ephemeral(root.path().join("accounts"));

    for id in ["", "../outside", "A0000000000000000000000000000000", "abc"] {
        let Err(error) = store.open(id, &template).await else {
            panic!("invalid id was accepted");
        };
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert_eq!(
            store.remove(id).await.expect_err("invalid id").kind(),
            io::ErrorKind::InvalidInput
        );
    }
}

#[tokio::test]
async fn profiles_allow_independent_stores_to_share_usage_and_reuse_local_manager() {
    let root = tempdir().expect("tempdir");
    let template = template(root.path()).await;
    let accounts = root.path().join("accounts");
    let first_store = AzraelProfileStore::new_ephemeral(accounts.clone());
    let second_store = AzraelProfileStore::new_ephemeral(accounts);
    let first = finalized_profile(&first_store, &template, "workspace-1", "user-1").await;

    let reused = first_store
        .open(first.id(), &template)
        .await
        .expect("reuse open profile");
    assert!(Arc::ptr_eq(&first, &reused));
    let independently_opened = second_store
        .open(first.id(), &template)
        .await
        .expect("independent store shares profile usage");
    assert!(!Arc::ptr_eq(&first, &independently_opened));
    assert_eq!(
        independently_opened
            .manager()
            .auth()
            .await
            .and_then(|auth| auth.get_account_id()),
        Some("workspace-1".to_string())
    );

    let id = first.id().to_string();
    drop(reused);
    drop(first);
    drop(independently_opened);
    second_store
        .open(&id, &template)
        .await
        .expect("profile remains available after shared owners release");
}

#[tokio::test]
async fn profile_reload_does_not_revoke_the_shared_application_policy() {
    let root = tempdir().expect("tempdir");
    let mut template = template(root.path()).await;
    let controller = NetworkPolicyController::default();
    let policy = controller.policy();
    template.auth_route_config = AuthRouteConfig::from_http_client_factory(
        template
            .http_client_factory()
            .with_network_policy(policy.clone()),
    );
    let endpoint = "https://example.com/".parse().unwrap();
    let store = AzraelProfileStore::new_ephemeral(root.path().join("accounts"));
    let profile = store.create(&template).await.expect("create profile");
    save_auth(
        profile.auth_home(),
        &auth_json("person@example.com", "workspace-1", "user-1"),
        AuthCredentialsStoreMode::Ephemeral,
        AuthKeyringBackendKind::default(),
    )
    .expect("save ephemeral auth");
    assert!(controller.publish(
        policy.revision(),
        DestinationPolicy::Restricted {
            allowed_hosts: ["example.com".to_string()].into(),
        },
    ));

    profile
        .finalize()
        .await
        .expect("finalize profile reloads auth");
    assert!(policy.acquire(&endpoint).is_ok());
    let another_store = AzraelProfileStore::new_ephemeral(root.path().join("accounts"));
    let reopened = another_store
        .open(profile.id(), &template)
        .await
        .expect("open profile in another store");
    reopened.manager().reload().await;
    assert!(policy.acquire(&endpoint).is_ok());
    let profile_policy = reopened
        .manager()
        .http_client_factory()
        .network_policy()
        .clone();
    assert!(profile_policy.acquire(&endpoint).is_ok());
    assert!(
        profile_policy
            .acquire(&"https://blocked.example/".parse().unwrap())
            .is_err()
    );

    template.set_cached_auth(Some(CodexAuth::from_api_key("new-root-owner")));
    assert!(policy.acquire(&endpoint).is_err());
}

#[tokio::test]
async fn profiles_remove_retires_every_cross_store_owner_even_with_active_usage() {
    let root = tempdir().expect("tempdir");
    let template = template(root.path()).await;
    let accounts = root.path().join("accounts");
    let owning_store = AzraelProfileStore::new_ephemeral(accounts.clone());
    let removing_store = AzraelProfileStore::new_ephemeral(accounts);
    let profile = finalized_profile(&owning_store, &template, "workspace-1", "user-1").await;
    let reused = owning_store
        .open(profile.id(), &template)
        .await
        .expect("reuse open profile");
    let independently_opened = removing_store
        .open(profile.id(), &template)
        .await
        .expect("independent store shares profile usage");
    let id = profile.id().to_string();
    let external: Arc<dyn ExternalAuth> = profile.clone();
    template
        .set_external_auth(external)
        .await
        .expect("bind root manager");
    assert!(template.auth_cached().is_some());
    removing_store
        .remove(&id)
        .await
        .expect("retirement overrides active usage");
    assert!(
        removing_store
            .list()
            .expect("retired profile is hidden")
            .is_empty()
    );
    assert!(profile.resolve().await.is_err());
    assert!(reused.resolve().await.is_err());
    assert!(independently_opened.resolve().await.is_err());
    assert!(profile.manager().auth_cached().is_none());
    assert!(template.auth_cached().is_none());
    assert!(template.auth_with_http_client_factory().await.is_none());
    assert!(owning_store.open(&id, &template).await.is_err());
    assert!(
        load_auth_dot_json(
            profile.auth_home(),
            AuthCredentialsStoreMode::Ephemeral,
            AuthKeyringBackendKind::default(),
        )
        .expect("load credentials after retirement")
        .is_none()
    );

    drop(reused);
    drop(profile);
    drop(independently_opened);
    removing_store
        .remove(&id)
        .await
        .expect("retirement is idempotent");
    assert_eq!(
        removing_store.list().expect("list after removal"),
        Vec::new()
    );
}

#[tokio::test]
async fn profiles_metadata_is_sanitized_and_listed() {
    let root = tempdir().expect("tempdir");
    let template = template(root.path()).await;
    let store = AzraelProfileStore::new_ephemeral(root.path().join("accounts"));
    let profile = finalized_profile(&store, &template, "workspace-1", "user-1").await;

    let metadata: serde_json::Value = serde_json::from_slice(
        &std::fs::read(profile.auth_home().join(PROFILE_METADATA)).expect("read metadata"),
    )
    .expect("parse metadata");
    assert_eq!(
        metadata,
        json!({
            "id": profile.id(),
            "email": "person@example.com",
            "workspaceAccountId": "workspace-1",
            "userId": "user-1",
            "planType": "team",
            "autoSwitchAllowed": false,
        })
    );
    assert!(!profile.auth_home().join("auth.json").exists());
    assert_eq!(
        store.list().expect("list profiles"),
        vec![profile.info().unwrap()]
    );
}

#[tokio::test]
async fn retirement_marker_precedes_refresh_lock_and_prevents_reauthentication_resurrection() {
    let root = tempdir().expect("tempdir");
    let template = template(root.path()).await;
    let store = Arc::new(AzraelProfileStore::new_ephemeral(
        root.path().join("accounts"),
    ));
    let profile = finalized_profile(&store, &template, "workspace-1", "user-1").await;
    let staged = finalized_profile(&store, &template, "workspace-1", "user-1").await;
    let manager = profile.manager();
    let transaction = manager
        .lock_azrael_unmanaged_refresh()
        .await
        .unwrap()
        .unwrap();
    let removing_store = store.clone();
    let id = profile.id().to_string();
    let removal = tokio::spawn(async move { removing_store.remove(&id).await });
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while profile.status().unwrap() != AzraelProfileStatus::Removed {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("marker published before waiting for writer");
    assert!(!removal.is_finished());
    assert!(profile.resolve().await.is_err());
    let replacing_profile = profile.clone();
    let reauthentication =
        tokio::spawn(async move { replacing_profile.replace_from(&staged).await });
    drop(transaction);
    removal.await.unwrap().unwrap();
    assert!(reauthentication.await.unwrap().is_err());
    assert!(
        load_auth_dot_json(
            profile.auth_home(),
            AuthCredentialsStoreMode::Ephemeral,
            AuthKeyringBackendKind::default()
        )
        .unwrap()
        .is_none()
    );
    assert!(profile.manager().auth_cached().is_none());
}

#[tokio::test]
async fn permanent_unavailability_heals_only_by_matching_explicit_reauthentication() {
    let root = tempdir().expect("tempdir");
    let template = template(root.path()).await;
    let store = AzraelProfileStore::new_ephemeral(root.path().join("accounts"));
    let profile = finalized_profile(&store, &template, "workspace-1", "user-1").await;
    let other = finalized_profile(&store, &template, "workspace-2", "user-2").await;
    let replacement = finalized_profile(&store, &template, "workspace-1", "user-1").await;
    assert!(profile.mark_reauthentication_required().await.unwrap());
    assert_eq!(store.list().unwrap().len(), 3);
    assert!(profile.resolve().await.is_err());
    assert!(profile.replace_from(&other).await.is_err());
    assert_eq!(
        profile.status().unwrap(),
        AzraelProfileStatus::ReauthenticationRequired
    );
    profile.replace_from(&replacement).await.unwrap();
    assert_eq!(profile.status().unwrap(), AzraelProfileStatus::Available);
    assert!(profile.resolve().await.is_ok());
    store.remove(profile.id()).await.unwrap();
    assert!(profile.replace_from(&replacement).await.is_err());
    assert!(profile.resolve().await.is_err());
}

#[tokio::test]
async fn stale_permanent_failure_cannot_republish_after_matching_peer_reauthentication() {
    let root = tempdir().unwrap();
    let template = template(root.path()).await;
    let home = root.path().join("accounts");
    let store = AzraelProfileStore::new_ephemeral(home.clone());
    let profile = finalized_profile(&store, &template, "workspace-1", "user-1").await;
    let peer_store = AzraelProfileStore::new_ephemeral(home);
    let peer = peer_store.open(profile.id(), &template).await.unwrap();
    let old = peer.manager.auth().await.unwrap();
    peer.manager.record_permanent_refresh_failure_if_unchanged(
        &old,
        &RefreshTokenFailedError::new(
            RefreshTokenFailedReason::Other,
            "confirmed synthetic failure",
        ),
    );
    assert!(peer.mark_reauthentication_required().await.unwrap());
    let staged = finalized_profile(&store, &template, "workspace-1", "user-1").await;
    save_auth(
        staged.auth_home(),
        &auth_json_with_tokens(
            "person@example.com",
            "workspace-1",
            "user-1",
            "new-access",
            "new-refresh",
        ),
        AuthCredentialsStoreMode::Ephemeral,
        AuthKeyringBackendKind::default(),
    )
    .unwrap();
    staged.manager.reload().await;
    profile.replace_from(&staged).await.unwrap();
    assert!(!peer.mark_reauthentication_required().await.unwrap());
    assert_eq!(peer.status().unwrap(), AzraelProfileStatus::Available);
    assert_eq!(
        access_token(Some(peer.resolve().await.unwrap())).as_deref(),
        Some("new-access")
    );
}

#[tokio::test]
async fn retirement_cross_process_usage_owner() {
    let Some(home) = std::env::var_os("AZRAEL_RETIREMENT_TEST_HOME") else {
        return;
    };
    let home = PathBuf::from(home);
    let id = std::env::var("AZRAEL_RETIREMENT_TEST_PROFILE").unwrap();
    let template = template(&home).await;
    let store = AzraelProfileStore::with_credentials_mode(
        home.join("accounts"),
        AuthCredentialsStoreMode::File,
    );
    let profile = store.open(&id, &template).await.unwrap();
    let external: Arc<dyn ExternalAuth> = profile.clone();
    template.set_external_auth(external).await.unwrap();
    assert!(template.auth_cached().is_some());
    let manager = profile.manager();
    let transaction = manager
        .lock_azrael_unmanaged_refresh()
        .await
        .unwrap()
        .unwrap();
    std::fs::write(home.join("ready"), b"ready").unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        while profile.status().unwrap() != AzraelProfileStatus::Removed {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    assert!(profile.resolve().await.is_err());
    assert!(template.auth_cached().is_none());
    assert!(template.auth_with_http_client_factory().await.is_none());
    // A refresh writer in a different process observes retirement before it can persist.
    assert!(ensure_profile_not_removed(profile.auth_home()).is_err());
    std::fs::write(home.join("observed"), b"retired").unwrap();
    drop(transaction);
}

#[tokio::test]
async fn removal_retires_real_second_process_before_waiting_for_credential_writer() {
    let root = tempdir().unwrap();
    let template = template(root.path()).await;
    let store = Arc::new(AzraelProfileStore::with_credentials_mode(
        root.path().join("accounts"),
        AuthCredentialsStoreMode::File,
    ));
    let profile = store.create(&template).await.unwrap();
    save_auth(
        profile.auth_home(),
        &auth_json("fixture@example.com", "fixture-workspace", "fixture-user"),
        AuthCredentialsStoreMode::File,
        AuthKeyringBackendKind::default(),
    )
    .unwrap();
    profile.finalize().await.unwrap();
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "auth::manager::profiles::tests::retirement_cross_process_usage_owner",
            "--nocapture",
        ])
        .env("AZRAEL_RETIREMENT_TEST_HOME", root.path())
        .env("AZRAEL_RETIREMENT_TEST_PROFILE", profile.id())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let ready = tokio::time::timeout(std::time::Duration::from_secs(15), async {
        while !root.path().join("ready").exists() {
            if child.try_wait().unwrap().is_some() {
                panic!("second process exited before admission")
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await;
    if ready.is_err() {
        let _ = child.kill();
        panic!("second process did not acquire shared profile")
    }
    let removing = store.clone();
    let id = profile.id().to_string();
    let remove = tokio::spawn(async move { removing.remove(&id).await });
    let observed = tokio::time::timeout(std::time::Duration::from_secs(15), async {
        while !root.path().join("observed").exists() {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await;
    if observed.is_err() {
        let _ = child.kill();
        panic!("second process did not observe retirement")
    }
    remove.await.unwrap().unwrap();
    assert!(child.wait().unwrap().success());
    assert!(
        load_auth_dot_json(
            profile.auth_home(),
            AuthCredentialsStoreMode::File,
            AuthKeyringBackendKind::default()
        )
        .unwrap()
        .is_none()
    );
    assert!(store.list().unwrap().is_empty());
}

#[tokio::test]
async fn profiles_reauth_rejects_a_different_identity() {
    let root = tempdir().expect("tempdir");
    let template = template(root.path()).await;
    let store = AzraelProfileStore::new_ephemeral(root.path().join("accounts"));
    let target = finalized_profile(&store, &template, "workspace-1", "user-1").await;
    let staged = finalized_profile(&store, &template, "workspace-2", "user-2").await;

    assert_eq!(
        target
            .replace_from(&staged)
            .await
            .expect_err("identity mismatch")
            .kind(),
        io::ErrorKind::PermissionDenied
    );
    assert_eq!(target.info().unwrap().workspace_account_id, "workspace-1");
    assert_eq!(
        access_token(target.manager().auth().await),
        Some("test-access".to_string())
    );
}

#[tokio::test]
async fn profiles_discard_pending_removes_credentials_without_metadata() {
    let root = tempdir().expect("tempdir");
    let template = template(root.path()).await;
    let store = AzraelProfileStore::new_ephemeral(root.path().join("accounts"));
    let staged = store.create(&template).await.expect("create stage");
    save_auth(
        staged.auth_home(),
        &auth_json("person@example.com", "workspace-1", "user-1"),
        AuthCredentialsStoreMode::Ephemeral,
        AuthKeyringBackendKind::default(),
    )
    .expect("save staged auth");

    store.discard_pending(&staged).expect("discard stage");

    assert!(
        load_auth_dot_json(
            staged.auth_home(),
            AuthCredentialsStoreMode::Ephemeral,
            AuthKeyringBackendKind::default(),
        )
        .expect("load staged auth")
        .is_none()
    );
    assert!(!staged.auth_home().join(PROFILE_METADATA).exists());
}

#[tokio::test]
async fn profiles_logged_out_metadata_can_be_opened_and_reauthenticated() {
    let root = tempdir().expect("tempdir");
    let template = template(root.path()).await;
    let store = AzraelProfileStore::new_ephemeral(root.path().join("accounts"));
    let target = finalized_profile(&store, &template, "workspace-1", "user-1").await;
    let target_id = target.id().to_string();
    let target_home = target.auth_home().to_path_buf();
    drop(target);
    logout(
        &target_home,
        AuthCredentialsStoreMode::Ephemeral,
        AuthKeyringBackendKind::default(),
    )
    .expect("remove target credentials");

    let target = store
        .open(&target_id, &template)
        .await
        .expect("open logged-out profile");
    assert!(target.manager().auth().await.is_none());
    let staged = finalized_profile(&store, &template, "workspace-1", "user-1").await;

    let info = target
        .replace_from(&staged)
        .await
        .expect("replace logged-out credentials");
    assert_eq!(info.workspace_account_id, "workspace-1");
    assert_eq!(info.user_id, "user-1");
    assert_eq!(
        target
            .manager()
            .auth()
            .await
            .and_then(|auth| auth.get_account_id())
            .as_deref(),
        Some("workspace-1")
    );
}

#[tokio::test]
async fn profiles_cross_store_replacement_is_serialized_with_refresh_and_stays_coherent() {
    let root = tempdir().expect("tempdir");
    let template = template(root.path()).await;
    let accounts = root.path().join("accounts");
    let first_store = AzraelProfileStore::new_ephemeral(accounts.clone());
    let second_store = AzraelProfileStore::new_ephemeral(accounts);
    let target = finalized_profile(&first_store, &template, "workspace-1", "user-1").await;
    let second = second_store
        .open(target.id(), &template)
        .await
        .expect("second shared profile owner");
    let staged = finalized_profile(&first_store, &template, "workspace-1", "user-1").await;
    save_auth(
        staged.auth_home(),
        &auth_json_with_tokens(
            "person@example.com",
            "workspace-1",
            "user-1",
            "replacement-access",
            "replacement-refresh",
        ),
        AuthCredentialsStoreMode::Ephemeral,
        AuthKeyringBackendKind::default(),
    )
    .expect("save replacement credentials");
    staged.manager().reload().await;

    let refresh = second
        .manager()
        .lock_azrael_unmanaged_refresh()
        .await
        .expect("lock cross-store refresh transaction")
        .expect("profile refresh transaction");
    let replace_target = Arc::clone(&target);
    let replace_staged = Arc::clone(&staged);
    let replacement =
        tokio::spawn(async move { replace_target.replace_from(&replace_staged).await });
    tokio::task::yield_now().await;
    assert!(!replacement.is_finished());
    drop(refresh);
    replacement
        .await
        .expect("replacement task")
        .expect("replacement succeeds");
    second.manager().reload().await;
    assert_eq!(
        access_token(second.manager().auth().await),
        Some("replacement-access".to_string())
    );
    assert_eq!(
        second.info().expect("metadata remains coherent"),
        target.info().unwrap()
    );
}

#[tokio::test]
async fn profiles_refresh_transaction_reloads_persisted_auth_before_authority() {
    let root = tempdir().expect("tempdir");
    let template = template(root.path()).await;
    let accounts = root.path().join("accounts");
    let first_store = AzraelProfileStore::new_ephemeral(accounts.clone());
    let second_store = AzraelProfileStore::new_ephemeral(accounts);
    let first = finalized_profile(&first_store, &template, "workspace-1", "user-1").await;
    let second = second_store
        .open(first.id(), &template)
        .await
        .expect("second shared profile owner");

    let transaction = first
        .manager()
        .lock_azrael_unmanaged_refresh()
        .await
        .expect("lock profile refresh transaction")
        .expect("profile refresh transaction");
    let refresh_manager = second.manager();
    let refresh = tokio::spawn(async move { refresh_manager.refresh_token().await });
    tokio::task::yield_now().await;
    assert!(!refresh.is_finished());
    save_auth(
        first.auth_home(),
        &auth_json_with_tokens(
            "person@example.com",
            "workspace-1",
            "user-1",
            "persisted-access",
            "persisted-refresh",
        ),
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
        access_token(second.manager().auth().await),
        Some("persisted-access".to_string())
    );
}

#[tokio::test]
async fn profiles_busy_logout_with_revoke_preserves_credentials_and_metadata() {
    let root = tempdir().expect("tempdir");
    let template = template(root.path()).await;
    let accounts = root.path().join("accounts");
    let first_store = AzraelProfileStore::new_ephemeral(accounts.clone());
    let second_store = AzraelProfileStore::new_ephemeral(accounts);
    let profile = finalized_profile(&first_store, &template, "workspace-1", "user-1").await;
    let second = second_store
        .open(profile.id(), &template)
        .await
        .expect("second shared profile owner");
    let info = profile.info().expect("profile metadata");

    assert_eq!(
        profile
            .logout_with_revoke()
            .await
            .expect_err("shared owner prevents revoke and credential clearing")
            .kind(),
        io::ErrorKind::WouldBlock
    );
    assert_eq!(profile.info().expect("metadata preserved"), info);
    assert_eq!(
        access_token(profile.manager().auth().await),
        Some("test-access".to_string())
    );

    drop(second);
    profile
        .clear_credentials()
        .await
        .expect("credential clearing succeeds after competing owner releases");
    assert!(profile.manager().auth().await.is_none());
    assert_eq!(profile.info().expect("metadata remains after logout"), info);
}

#[tokio::test]
async fn automatic_switch_permission_defaults_off_and_persists_by_identity() {
    let root = tempdir().unwrap();
    let template = template(root.path()).await;
    let store = AzraelProfileStore::new_ephemeral(root.path().join("accounts"));
    let first = finalized_profile(&store, &template, "workspace-1", "user-1").await;
    let alias = finalized_profile(&store, &template, "workspace-1", "user-1").await;
    let other = finalized_profile(&store, &template, "workspace-1", "user-2").await;
    assert!(
        store
            .list()
            .unwrap()
            .iter()
            .all(|info| !info.auto_switch_allowed)
    );
    store.set_auto_switch_allowed(first.id(), true).unwrap();
    let reopened = AzraelProfileStore::new_ephemeral(root.path().join("accounts"));
    for info in reopened.list().unwrap() {
        assert_eq!(info.auto_switch_allowed, info.id != other.id());
    }
    reopened.set_auto_switch_allowed(alias.id(), false).unwrap();
    assert!(
        store
            .list()
            .unwrap()
            .iter()
            .all(|info| !info.auto_switch_allowed)
    );
}

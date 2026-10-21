use super::test_support::TempCodexHome;
use super::*;
use codex_keyring_store::tests::MockKeyringStore;

fn tokens(name: &str, access: &str) -> StoredOAuthTokens {
    let mut response = OAuthTokenResponse::new(
        AccessToken::new(access.to_string()),
        BasicTokenType::Bearer,
        VendorExtraTokenFields::default(),
    );
    response.set_refresh_token(Some(RefreshToken::new(format!("refresh-{access}"))));
    StoredOAuthTokens {
        server_name: name.to_string(),
        url: "https://api.liampli.com/mcp".to_string(),
        issuer: Some("https://issuer.example.test".to_string()),
        client_id: "synthetic-client".to_string(),
        token_response: WrappedOAuthTokenResponse(response),
        expires_at: None,
    }
}

fn duplicate_file_tokens(name: &str) -> Result<(StoredOAuthTokens, Vec<String>)> {
    let current = tokens(name, "current");
    save_oauth_tokens_to_file(&current)?;
    let keys = compatible_store_keys(name, &current.url)?;
    let mut file = read_fallback_file_unlocked()?.unwrap();
    let mut stale = file[&keys[0]].clone();
    stale.access_token = "stale".to_string();
    // Expiry is deliberately later: it does not establish which login is current.
    stale.expires_at = Some(u64::MAX);
    file.insert(keys[1].clone(), stale);
    write_fallback_file(&file)?;
    Ok((current, keys))
}

#[test]
fn canonical_and_legacy_keys_are_independent_of_json_map_features() -> Result<()> {
    assert_eq!(
        compatible_store_keys("laio", "https://api.liampli.com/mcp")?,
        vec!["laio|b78268cda0267519", "laio|00a31ac0731c6c13"]
    );
    assert_eq!(
        compute_store_key("local:laio", "https://api.liampli.com/mcp")?,
        "laio|b78268cda0267519"
    );
    let _env = TempCodexHome::new();
    assert_eq!(
        compatible_store_keys("ema-idp:synthetic", "https://issuer.example.test")?.len(),
        1
    );
    Ok(())
}

#[test]
fn file_prefers_canonical_over_lexically_first_and_later_expiry_alias() -> Result<()> {
    let _env = TempCodexHome::new();
    for name in ["laio", "local:laio", "executor:synthetic"] {
        let (current, keys) = duplicate_file_tokens(name)?;
        let loaded = load_oauth_tokens_from_file(name, &current.url)?.unwrap();
        assert_eq!(loaded, current);
        let mut file = read_fallback_file_unlocked()?.unwrap();
        file.remove(&keys[0]);
        write_fallback_file(&file)?;
        let legacy = load_oauth_tokens_from_file(name, &current.url)?.unwrap();
        assert_eq!(legacy.token_response.0.access_token().secret(), "stale");
        delete_oauth_tokens_from_file(name, &current.url)?;
    }
    Ok(())
}

#[test]
fn reauthentication_consolidates_only_matching_file_identity() -> Result<()> {
    let _env = TempCodexHome::new();
    let (current, keys) = duplicate_file_tokens("laio")?;
    let mut other_endpoint = current.clone();
    other_endpoint.url = "https://other.example.test/mcp".to_string();
    save_oauth_tokens_to_file(&other_endpoint)?;
    let other_server = tokens("other", "other-server");
    save_oauth_tokens_to_file(&other_server)?;
    let executor = tokens("executor:laio", "executor");
    save_oauth_tokens_to_file(&executor)?;
    let fresh = tokens("laio", "reauthenticated");
    save_oauth_tokens_to_file(&fresh)?;
    let file = read_fallback_file_unlocked()?.unwrap();
    assert!(file.contains_key(&keys[0]));
    assert!(!file.contains_key(&keys[1]));
    assert_eq!(
        load_oauth_tokens_from_file("laio", &fresh.url)?,
        Some(fresh)
    );
    assert!(delete_oauth_tokens_from_file("laio", &current.url)?);
    assert!(load_oauth_tokens_from_file("laio", &current.url)?.is_none());
    for other in [other_endpoint, other_server, executor] {
        assert_eq!(
            load_oauth_tokens_from_file(&other.server_name, &other.url)?,
            Some(other)
        );
    }
    Ok(())
}

#[test]
fn logout_removes_file_aliases_even_when_canonical_is_absent() -> Result<()> {
    let _env = TempCodexHome::new();
    let (current, keys) = duplicate_file_tokens("laio")?;
    assert!(delete_oauth_tokens_from_file("laio", &current.url)?);
    assert!(!delete_oauth_tokens_from_file("laio", &current.url)?);
    let (_, _) = duplicate_file_tokens("laio")?;
    let mut file = read_fallback_file_unlocked()?.unwrap();
    file.remove(&keys[0]);
    write_fallback_file(&file)?;
    assert!(delete_oauth_tokens_from_file("laio", &current.url)?);
    assert!(load_oauth_tokens_from_file("laio", &current.url)?.is_none());
    Ok(())
}

#[test]
fn direct_keyring_legacy_transition_and_logout() -> Result<()> {
    let _env = TempCodexHome::new();
    let store = MockKeyringStore::default();
    let stale = tokens("laio", "stale");
    let fresh = tokens("laio", "fresh");
    let keys = compatible_store_keys("laio", &fresh.url)?;
    store.save(KEYRING_SERVICE, &keys[1], &serde_json::to_string(&stale)?)?;
    assert_eq!(
        load_oauth_tokens_from_direct_keyring(&store, "laio", &fresh.url)?,
        Some(stale.clone())
    );
    save_oauth_tokens_to_direct_keyring(&store, "laio", &fresh)?;
    // Even a surviving/reintroduced legacy alias cannot override the canonical login.
    store.save(KEYRING_SERVICE, &keys[1], &serde_json::to_string(&stale)?)?;
    assert_eq!(
        load_oauth_tokens_from_direct_keyring(&store, "laio", &fresh.url)?,
        Some(fresh.clone())
    );
    assert!(delete_oauth_tokens_from_direct_keyring(
        &store, "laio", &fresh.url
    )?);
    assert!(load_oauth_tokens_from_direct_keyring(&store, "laio", &fresh.url)?.is_none());
    Ok(())
}

#[test]
fn encrypted_keyring_legacy_transition_and_logout() -> Result<()> {
    let _env = TempCodexHome::new();
    let store = MockKeyringStore::default();
    let stale = tokens("laio", "stale");
    let fresh = tokens("laio", "fresh");
    let keys = compatible_store_keys("laio", &fresh.url)?;
    let manager = SecretsManager::new_with_keyring_store_and_namespace(
        find_codex_home()?.to_path_buf(),
        SecretsBackendKind::Local,
        Arc::new(store.clone()),
        LocalSecretsNamespace::McpOAuth,
    );
    let alias = secret_name_for_store_key(&keys[1])?;
    manager.set(
        &SecretScope::Global,
        &alias,
        &serde_json::to_string(&stale)?,
    )?;
    assert_eq!(
        load_oauth_tokens_from_secrets_keyring(&store, "laio", &fresh.url)?.unwrap(),
        stale.clone()
    );
    save_oauth_tokens_to_secrets_keyring(&store, "laio", &fresh)?;
    assert!(manager.get(&SecretScope::Global, &alias)?.is_none());
    manager.set(
        &SecretScope::Global,
        &alias,
        &serde_json::to_string(&stale)?,
    )?;
    assert_eq!(
        load_oauth_tokens_from_secrets_keyring(&store, "laio", &fresh.url)?.unwrap(),
        fresh.clone()
    );
    assert!(delete_oauth_tokens_from_secrets_keyring(
        &store, "laio", &fresh.url
    )?);
    assert!(load_oauth_tokens_from_secrets_keyring(&store, "laio", &fresh.url)?.is_none());
    Ok(())
}

#[test]
#[tracing_test::traced_test]
fn keyring_transition_failures_preserve_authority_and_safe_warning() -> Result<()> {
    let _env = TempCodexHome::new();
    let store = MockKeyringStore::default();
    let stale = tokens("laio", "stale-sentinel");
    let fresh = tokens("laio", "fresh-sentinel");
    let keys = compatible_store_keys("laio", &fresh.url)?;
    store.save(KEYRING_SERVICE, &keys[1], &serde_json::to_string(&stale)?)?;
    store.set_error(
        &keys[0],
        keyring::Error::Invalid("synthetic".into(), "save".into()),
    );
    assert!(save_oauth_tokens_to_direct_keyring(&store, "laio", &fresh).is_err());
    assert_eq!(
        load_oauth_tokens_from_direct_keyring(&store, "laio", &fresh.url)?,
        Some(stale.clone())
    );

    store.set_error(
        &keys[1],
        keyring::Error::Invalid("synthetic".into(), "cleanup".into()),
    );
    save_oauth_tokens_to_direct_keyring(&store, "laio", &fresh)?;
    assert_eq!(
        load_oauth_tokens_from_direct_keyring(&store, "laio", &fresh.url)?,
        Some(fresh.clone())
    );
    assert!(store.saved_value(&keys[1]).is_some());
    assert!(logs_contain(
        "failed to remove legacy MCP OAuth keyring entry after canonical save"
    ));
    assert!(!logs_contain("stale-sentinel"));
    assert!(!logs_contain("fresh-sentinel"));

    store.set_error(
        &keys[1],
        keyring::Error::Invalid("synthetic".into(), "delete".into()),
    );
    assert!(delete_oauth_tokens_from_direct_keyring(&store, "laio", &fresh.url).is_err());
    assert_eq!(
        load_oauth_tokens_from_direct_keyring(&store, "laio", &fresh.url)?,
        Some(fresh)
    );
    assert!(delete_oauth_tokens_from_direct_keyring(
        &store, "laio", &stale.url
    )?);
    Ok(())
}

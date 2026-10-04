use super::*;
use pretty_assertions::assert_eq;

#[tokio::test]
async fn custom_native_provider_survives_managed_and_devin_selections() {
    let (_, turn) = crate::session::tests::make_session_and_context().await;
    let mut config = (*turn.config).clone();
    let custom = ModelProviderInfo {
        name: "Fixture native".to_string(),
        base_url: Some("http://127.0.0.1:12345/v1".to_string()),
        request_max_retries: Some(2),
        ..Default::default()
    };
    config.model_provider_id = "fixture_openai".to_string();
    config.model_provider = custom.clone();
    activate_helper_provider(
        &mut config,
        crate::managed_catalog::PROVIDER_ID,
        crate::managed_catalog::provider_info(),
    );
    activate_helper_provider(&mut config, PROVIDER_ID, provider_info());
    activate_helper_provider(
        &mut config,
        crate::managed_catalog::PROVIDER_ID,
        crate::managed_catalog::provider_info(),
    );
    select_model(&mut config, "native-model").unwrap();
    assert_eq!(
        (
            config.model_provider_id.clone(),
            config.model_provider.clone()
        ),
        ("fixture_openai".to_string(), custom.clone())
    );
    activate_helper_provider(&mut config, PROVIDER_ID, provider_info());
    select_model(&mut config, "native-model").unwrap();
    assert_eq!(
        (config.model_provider_id, config.model_provider),
        ("fixture_openai".to_string(), custom)
    );
}

#[tokio::test]
async fn unknown_original_native_provider_fails_without_changing_selection() {
    let (_, turn) = crate::session::tests::make_session_and_context().await;
    let mut config = (*turn.config).clone();
    activate_helper_provider(
        &mut config,
        crate::managed_catalog::PROVIDER_ID,
        crate::managed_catalog::provider_info(),
    );
    config.native_model_provider = None;
    let original = config.clone();
    assert!(select_model(&mut config, "native-model").is_err());
    assert_eq!(config, original);
}

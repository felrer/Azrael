use super::*;

#[test]
fn api_catalog_preserves_opaque_remote_ids_and_connection_identity() {
    let bytes = br#"{"models":[{"provider_id":"api-0123456789abcdef0123456789abcdef","model_id":"vendor/model:alias","display_name":"Local Model","context_window":8192,"supports_tools":false,"stream":false,"timeout_ms":180000}]}"#;
    let models = models_from_catalog(bytes).unwrap();
    assert_eq!(
        models[0].slug,
        "api/0123456789abcdef0123456789abcdef/vendor/model:alias"
    );
    let (provider, remote) = selection(&models[0].slug).unwrap();
    assert_eq!(provider, "api-0123456789abcdef0123456789abcdef");
    assert_eq!(remote, "vendor/model:alias");
    assert_eq!(
        models[0].multi_agent_version, None,
        "text-only API children remain eligible"
    );
    assert!(is_managed(&models[0].slug));
    for invalid in [
        "api/short/model",
        "api/0123456789ABCDEF0123456789abcdef/model",
        "api/0123456789abcdef0123456789abcdef/",
        "api/0123456789abcdef0123456789abcdef/model\n",
    ] {
        assert!(selection(invalid).is_err());
    }
    assert!(models_from_catalog(br#"{"models":[{"provider_id":"api-0123456789abcdef0123456789abcdef","model_id":"model","display_name":"Fixture","context_window":8192}]}"#).is_err());
}
use pretty_assertions::assert_eq;

#[test]
fn managed_merge_preserves_inner_catalog_on_collision() {
    let managed = models_from_catalog(br#"{"models":[{"provider_id":"openrouter","model_id":"a","display_name":"A","context_window":8192},{"provider_id":"openrouter","model_id":"b","display_name":"B","context_window":8192}]}"#).unwrap();
    let mut native = vec![managed[0].clone()];
    native[0].model_provider = "openai".to_string();
    let merged = merge_models(native, managed);
    assert_eq!(merged.len(), 2);
    assert_eq!(merged[0].model_provider, "openai");
    assert_eq!(merged[1].model_provider, PROVIDER_ID);
}

#[test]
fn provider_catalog_statuses_are_separate_and_sanitized() {
    let bytes = br#"{"models":[],"provider_statuses":[{"provider_id":"openrouter","state":"error","model_count":0,"observed_at":123,"error_code":"network"}]}"#;
    assert!(models_from_catalog(bytes).unwrap().is_empty());
    let statuses = statuses_from_catalog(bytes).unwrap();
    assert_eq!(statuses[0].provider_id, "openrouter");
    assert_eq!(
        statuses[0].state,
        codex_models_manager::manager::ProviderCatalogState::Error
    );
    let claude = br#"{"models":[{"provider_id":"anthropic","model_id":"claude-sonnet-4-6","display_name":"Claude Sonnet","context_window":200000}],"provider_statuses":[{"provider_id":"anthropic","state":"ready","model_count":1,"observed_at":123}]}"#;
    assert_eq!(
        models_from_catalog(claude).unwrap()[0].slug,
        "managed/anthropic/claude-sonnet-4-6"
    );
    assert_eq!(
        statuses_from_catalog(claude).unwrap()[0].provider_id,
        "anthropic"
    );
    for bad in [
        br#"{"models":[],"provider_statuses":[{"provider_id":"unknown","state":"ready","model_count":0,"observed_at":123}]}"#.as_slice(),
        br#"{"models":[],"provider_statuses":[{"provider_id":"openrouter","state":"error","model_count":0,"observed_at":123,"error_code":"raw secret"}]}"#.as_slice(),
        br#"{"models":[],"provider_statuses":[{"provider_id":"openrouter","state":"ready","model_count":1,"observed_at":123}]}"#.as_slice(),
    ] { assert!(statuses_from_catalog(bad).is_err()); }
}

#[test]
fn opaque_remote_id_and_catalog_metadata_are_preserved() {
    let bytes = br#"{"models":[{"provider_id":"openrouter","model_id":"vendor/model:free","display_name":"Fixture","context_window":8192}]}"#;
    let models = models_from_catalog(bytes).unwrap();
    assert_eq!(
        selection(&models[0].slug).unwrap(),
        (
            std::borrow::Cow::Borrowed("openrouter"),
            "vendor/model:free"
        )
    );
    let mut expected = unavailable_model_info("managed/openrouter/vendor/model:free");
    expected.display_name = "Fixture".to_string();
    expected.visibility = ModelVisibility::List;
    expected.supported_in_api = true;
    expected.priority = 20_000;
    expected.context_window = Some(8192);
    expected.max_context_window = Some(8192);
    expected.truncation_policy = TruncationPolicyConfig::tokens(8192);
    expected.shell_type = codex_protocol::openai_models::ConfigShellToolType::UnifiedExec;
    expected.apply_patch_tool_type =
        Some(codex_protocol::openai_models::ApplyPatchToolType::Freeform);
    assert_eq!(models, vec![expected]);
}

#[test]
fn malformed_catalogs_fail_closed() {
    for bytes in [
        br#"{"models":[{"provider_id":"unknown","model_id":"m","display_name":"M","context_window":8192}]}"#.as_slice(),
        br#"{"models":[{"provider_id":"google","model_id":"m","display_name":"M","context_window":0}]}"#.as_slice(),
        br#"{"models":[{"provider_id":"google","model_id":"m","display_name":"M","context_window":8192},{"provider_id":"google","model_id":"m","display_name":"M","context_window":8192}]}"#.as_slice(),
    ] { assert!(models_from_catalog(bytes).is_err()); }
    assert!(models_from_catalog(&vec![b' '; MAX_CATALOG_BYTES + 1]).is_err());
}

#[test]
fn anthropic_code_mode_policy_survives_catalog_projection() {
    let catalog = br#"{"models":[{"provider_id":"anthropic","model_id":"claude-sonnet-4-6","display_name":"Claude","context_window":200000},{"provider_id":"openrouter","model_id":"anthropic/claude-sonnet-4-6","display_name":"Remote Claude","context_window":200000}],"retained_models":[{"provider_id":"anthropic","model_id":"claude-opus-4-6","display_name":"Retained Claude","context_window":200000}]}"#;
    let visible = models_from_catalog(catalog).unwrap();
    let retained = retained_models_from_catalog(catalog).unwrap();
    let actual = visible
        .iter()
        .chain(retained.iter())
        .map(|model| {
            (
                model.slug.as_str(),
                model.node_repl_disabled,
                unavailable_model_info(&model.slug).node_repl_disabled,
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        actual,
        vec![
            ("managed/anthropic/claude-sonnet-4-6", false, false),
            ("managed/openrouter/anthropic/claude-sonnet-4-6", true, true),
            ("managed/anthropic/claude-opus-4-6", false, false),
        ]
    );
}

#[test]
fn control_characters_and_blank_remote_ids_are_rejected() {
    for key in [
        "managed/google/ ",
        "managed/xai/\t",
        "managed/openrouter/vendor/\nmodel",
        "managed/google/model\0",
    ] {
        assert!(selection(key).is_err());
    }
    assert_eq!(
        selection("managed/openrouter/vendor/model:free").unwrap(),
        (
            std::borrow::Cow::Borrowed("openrouter"),
            "vendor/model:free"
        )
    );
    assert_eq!(
        selection("managed/anthropic/claude-sonnet-5").unwrap(),
        (std::borrow::Cow::Borrowed("anthropic"), "claude-sonnet-5")
    );
}

#[test]
fn anthropic_removed_model_is_retained_for_continuation_but_hidden_from_catalog() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("models.json");
    let initial = br#"{"models":[{"provider_id":"anthropic","model_id":"claude-sonnet-4-6","display_name":"Sonnet 4.6","context_window":200000,"reasoning":{"supported_efforts":["low","high","xhigh"],"default_effort":"high","mandatory":true}},{"provider_id":"anthropic","model_id":"claude-opus-5-5","display_name":"Opus 5.5","context_window":1000000,"reasoning":{"supported_efforts":["low","medium","high","xhigh","max"],"default_effort":"medium","mandatory":true}}],"provider_statuses":[{"provider_id":"anthropic","state":"ready","model_count":2,"observed_at":1000}]}"#;
    let removed = br#"{"models":[{"provider_id":"anthropic","model_id":"claude-opus-5-5","display_name":"Opus 5.5","context_window":1000000}],"provider_statuses":[{"provider_id":"anthropic","state":"ready","model_count":1,"observed_at":2000}]}"#;
    persist_snapshot(&path, initial).unwrap();
    persist_snapshot(&path, removed).unwrap();

    let visible = load_snapshot(&path).unwrap();
    assert_eq!(
        visible
            .iter()
            .map(|model| model.slug.as_str())
            .collect::<Vec<_>>(),
        vec!["managed/anthropic/claude-opus-5-5"]
    );
    assert_eq!(visible[0].visibility, ModelVisibility::List);
    let retained = load_retained_snapshot(&path).unwrap();
    assert_eq!(retained.len(), 1);
    let old = &retained[0];
    assert_eq!(old.slug, "managed/anthropic/claude-sonnet-4-6");
    assert_eq!(old.visibility, ModelVisibility::Hide);
    assert_eq!(old.display_name, "Sonnet 4.6");
    assert_eq!(old.context_window, Some(200000));
    assert_eq!(old.max_context_window, Some(200000));
    assert_eq!(
        old.supported_reasoning_levels
            .iter()
            .map(|level| level.effort.clone())
            .collect::<Vec<_>>(),
        vec![
            ReasoningEffort::Low,
            ReasoningEffort::High,
            ReasoningEffort::XHigh
        ]
    );
    assert_eq!(old.default_reasoning_level, Some(ReasoningEffort::High));
    assert_eq!(
        old.truncation_policy,
        TruncationPolicyConfig::tokens(200000)
    );
    assert!(old.supported_in_api);
    assert_eq!(
        selection(&old.slug).unwrap(),
        (std::borrow::Cow::Borrowed("anthropic"), "claude-sonnet-4-6")
    );
    let statuses = load_statuses(&path).unwrap();
    assert_eq!(statuses.len(), 1);
    assert_eq!(statuses[0].provider_id, "anthropic");
    assert_eq!(
        statuses[0].state,
        codex_models_manager::manager::ProviderCatalogState::Ready
    );
    assert_eq!(statuses[0].model_count, 1);

    let empty = br#"{"models":[],"provider_statuses":[{"provider_id":"anthropic","state":"empty","model_count":0,"observed_at":3000}]}"#;
    persist_snapshot(&path, empty).unwrap();
    assert!(load_snapshot(&path).unwrap().is_empty());
    let archived = load_retained_snapshot(&path).unwrap();
    assert_eq!(archived.len(), 2);
    assert!(
        archived
            .iter()
            .all(|model| model.visibility == ModelVisibility::Hide)
    );
    assert_eq!(
        load_statuses(&path).unwrap()[0].state,
        codex_models_manager::manager::ProviderCatalogState::Empty
    );
}

#[tokio::test]
async fn catalog_subprocess_receives_scoped_storage_environment() {
    let root = tempfile::tempdir().unwrap();
    let home = root.path().join("isolated home");
    let expected = home.join("azrael/providers/opencodex");
    #[cfg(windows)]
    let (runtime, helper, script) = (
        PathBuf::from("powershell.exe"),
        root.path().join("catalog.cmd"),
        format!(
            "@echo off\nif not \"%CODEX_HOME%\"==\"{}\" exit /b 1\nif not \"%OPENCODEX_HOME%\"==\"{}\" exit /b 2\necho {{\"models\":[]}}\n",
            home.display(),
            expected.display()
        ),
    );
    #[cfg(not(windows))]
    let (runtime, helper, script) = (
        PathBuf::from("/bin/sh"),
        root.path().join("catalog.sh"),
        format!(
            "[ \"$CODEX_HOME\" = '{}' ] || exit 1\n[ \"$OPENCODEX_HOME\" = '{}' ] || exit 2\nprintf '%s\\n' '{{\"models\":[]}}'\n",
            home.display().to_string().replace('\'', "'\\''"),
            expected.display().to_string().replace('\'', "'\\''")
        ),
    );
    std::fs::write(&helper, script).unwrap();
    assert_eq!(
        models_from_catalog(
            &fetch_catalog(&helper, &runtime, &home, false)
                .await
                .unwrap()
        )
        .unwrap(),
        Vec::<ModelInfo>::new()
    );
}

#[tokio::test]
async fn online_uncached_refresh_observes_account_catalog_changes_with_nonempty_cache() {
    let root = tempfile::tempdir().unwrap();
    let initial = br#"{"models":[{"provider_id":"google","model_id":"first","display_name":"First","context_window":8192}]}"#;
    let added = r#"{"models":[{"provider_id":"xai","model_id":"added","display_name":"Added","context_window":8192}]}"#;
    #[cfg(windows)]
    let (bun, helper) = (
        PathBuf::from("powershell.exe"),
        root.path().join("changing-catalog.cmd"),
    );
    #[cfg(not(windows))]
    let (bun, helper) = (
        PathBuf::from("/bin/sh"),
        root.path().join("changing-catalog.sh"),
    );
    let script = |catalog: &str| {
        #[cfg(windows)]
        {
            format!("@echo off\necho {catalog}\n")
        }
        #[cfg(not(windows))]
        {
            format!("printf '%s\\n' '{}'\n", catalog.replace('\'', "'\\''"))
        }
    };
    std::fs::write(&helper, script(added)).unwrap();
    let manager = ManagedModelsManager {
        inner: Arc::new(codex_models_manager::manager::StaticModelsManager::new(
            /*auth_manager*/ None,
            ModelsResponse { models: Vec::new() },
        )),
        helper: helper.clone(),
        bun,
        codex_home: root.path().to_path_buf(),
        snapshot_path: root.path().join("models.json"),
        managed_models: RwLock::new(models_from_catalog(initial).unwrap()),
        provider_catalogs: RwLock::new(Vec::new()),
        catalog_refresh: Semaphore::new(1),
    };
    manager
        .refresh_managed(RefreshStrategy::OnlineIfUncached)
        .await;
    assert_eq!(
        manager.managed_models.read().await.clone(),
        models_from_catalog(added.as_bytes()).unwrap()
    );
    std::fs::write(&helper, script("invalid catalog response")).unwrap();
    manager
        .refresh_managed(RefreshStrategy::OnlineIfUncached)
        .await;
    assert_eq!(
        manager.managed_models.read().await.clone(),
        models_from_catalog(added.as_bytes()).unwrap()
    );
    assert_eq!(
        load_snapshot(&manager.snapshot_path).unwrap(),
        models_from_catalog(added.as_bytes()).unwrap()
    );
    std::fs::write(&helper, script(r#"{"models":[]}"#)).unwrap();
    manager
        .refresh_managed(RefreshStrategy::OnlineIfUncached)
        .await;
    assert_eq!(
        manager.managed_models.read().await.clone(),
        Vec::<ModelInfo>::new()
    );
}

#[test]
fn openrouter_reasoning_metadata_maps_to_model_info() {
    let bytes = br#"{"models":[{"provider_id":"openrouter","model_id":"z-ai/glm-4.6","display_name":"GLM","context_window":200000,"reasoning":{"supported_efforts":["low","high","max"],"default_effort":"max","mandatory":true}}]}"#;
    let models = models_from_catalog(bytes).unwrap();
    assert_eq!(
        models[0]
            .supported_reasoning_levels
            .iter()
            .map(|preset| preset.effort.clone())
            .collect::<Vec<_>>(),
        vec![
            ReasoningEffort::Low,
            ReasoningEffort::High,
            ReasoningEffort::Max
        ]
    );
    assert_eq!(
        models[0].default_reasoning_level,
        Some(ReasoningEffort::Max)
    );
}

#[test]
fn anthropic_reasoning_metadata_maps_exact_stages_and_opus_default() {
    let bytes = br#"{"models":[{"provider_id":"anthropic","model_id":"claude-opus-5-5","display_name":"Opus 5.5","context_window":1000000,"reasoning":{"supported_efforts":["low","medium","high","xhigh","max"],"default_effort":"medium","mandatory":true}},{"provider_id":"anthropic","model_id":"claude-unknown-future","display_name":"Future","context_window":200000}]}"#;
    let models = models_from_catalog(bytes).unwrap();
    assert_eq!(
        models[0]
            .supported_reasoning_levels
            .iter()
            .map(|level| level.effort.clone())
            .collect::<Vec<_>>(),
        vec![
            ReasoningEffort::Low,
            ReasoningEffort::Medium,
            ReasoningEffort::High,
            ReasoningEffort::XHigh,
            ReasoningEffort::Max
        ]
    );
    assert_eq!(
        models[0].default_reasoning_level,
        Some(ReasoningEffort::Medium)
    );
    assert!(models[1].supported_reasoning_levels.is_empty());
    assert_eq!(models[1].default_reasoning_level, None);
}

#[test]
fn openrouter_reasoning_max_serializes_exactly() {
    let bytes = br#"{"models":[{"provider_id":"openrouter","model_id":"m","display_name":"M","context_window":8192,"reasoning":{"supported_efforts":["max"],"default_effort":"max"}}]}"#;
    let models = models_from_catalog(bytes).unwrap();
    assert_eq!(
        serde_json::to_value(&models[0].supported_reasoning_levels[0].effort).unwrap(),
        serde_json::json!("max")
    );
    assert_eq!(
        serde_json::to_value(&models[0].default_reasoning_level).unwrap(),
        serde_json::json!("max")
    );
}

#[test]
fn openrouter_missing_reasoning_default_uses_automatic_sentinel() {
    let bytes = br#"{"models":[{"provider_id":"openrouter","model_id":"m","display_name":"M","context_window":8192,"reasoning":{"supported_efforts":["low","high"]}}]}"#;
    let models = models_from_catalog(bytes).unwrap();
    assert_eq!(
        models[0].default_reasoning_level,
        Some(ReasoningEffort::Custom("automatic".to_string()))
    );
    // The sentinel is internal only: supported stages stay pure gateway values.
    assert_eq!(
        models[0]
            .supported_reasoning_levels
            .iter()
            .map(|preset| preset.effort.as_str())
            .collect::<Vec<_>>(),
        vec!["low", "high"]
    );
    let preset = codex_protocol::openai_models::ModelPreset::from(models[0].clone());
    assert_eq!(
        preset.default_reasoning_effort,
        ReasoningEffort::Custom("automatic".to_string())
    );
    assert_ne!(preset.default_reasoning_effort, ReasoningEffort::None);
}

#[test]
fn openrouter_absent_or_empty_reasoning_advertises_no_reasoning() {
    for bytes in [
        br#"{"models":[{"provider_id":"openrouter","model_id":"m","display_name":"M","context_window":8192}]}"#.as_slice(),
        br#"{"models":[{"provider_id":"openrouter","model_id":"m","display_name":"M","context_window":8192,"reasoning":{"supported_efforts":[]}}]}"#.as_slice(),
        br#"{"models":[{"provider_id":"openrouter","model_id":"m","display_name":"M","context_window":8192,"reasoning":null}]}"#.as_slice(),
    ] {
        let models = models_from_catalog(bytes).unwrap();
        assert!(models[0].supported_reasoning_levels.is_empty());
        assert_eq!(models[0].default_reasoning_level, None);
    }
}

#[test]
fn reasoning_default_enabled_false_without_none_stage_keeps_automatic() {
    // Provider defaults off but advertises no `none` effort: no declared
    // default, so the automatic sentinel is preserved rather than inventing
    // `none` or failing.
    let bytes = br#"{"models":[{"provider_id":"openrouter","model_id":"m","display_name":"M","context_window":8192,"reasoning":{"supported_efforts":["none","low"],"default_enabled":false}}]}"#;
    let models = models_from_catalog(bytes).unwrap();
    assert_eq!(
        models[0].default_reasoning_level,
        Some(ReasoningEffort::Custom("automatic".to_string()))
    );
    // An explicit `none` default is preserved only when declared.
    let bytes = br#"{"models":[{"provider_id":"openrouter","model_id":"m","display_name":"M","context_window":8192,"reasoning":{"supported_efforts":["none","low"],"default_effort":"none","default_enabled":false}}]}"#;
    let models = models_from_catalog(bytes).unwrap();
    assert_eq!(
        models[0].default_reasoning_level,
        Some(ReasoningEffort::None)
    );
}

#[test]
fn invalid_reasoning_metadata_fails_closed() {
    for bytes in [
        // mandatory reasoning cannot offer a `none` stage.
        br#"{"models":[{"provider_id":"openrouter","model_id":"m","display_name":"M","context_window":8192,"reasoning":{"supported_efforts":["none","low"],"mandatory":true}}]}"#.as_slice(),
        // default outside the advertised set.
        br#"{"models":[{"provider_id":"openrouter","model_id":"m","display_name":"M","context_window":8192,"reasoning":{"supported_efforts":["low","high"],"default_effort":"medium"}}]}"#.as_slice(),
        // duplicate stages.
        br#"{"models":[{"provider_id":"openrouter","model_id":"m","display_name":"M","context_window":8192,"reasoning":{"supported_efforts":["low","low"]}}]}"#.as_slice(),
        // non-ascending order.
        br#"{"models":[{"provider_id":"openrouter","model_id":"m","display_name":"M","context_window":8192,"reasoning":{"supported_efforts":["high","low"]}}]}"#.as_slice(),
        // unknown effort value.
        br#"{"models":[{"provider_id":"openrouter","model_id":"m","display_name":"M","context_window":8192,"reasoning":{"supported_efforts":["turbo"]}}]}"#.as_slice(),
        // mandatory reasoning cannot be disabled by default.
        br#"{"models":[{"provider_id":"openrouter","model_id":"m","display_name":"M","context_window":8192,"reasoning":{"supported_efforts":["low"],"mandatory":true,"default_enabled":false}}]}"#.as_slice(),
        // empty supported list cannot carry an explicit default.
        br#"{"models":[{"provider_id":"openrouter","model_id":"m","display_name":"M","context_window":8192,"reasoning":{"supported_efforts":[],"default_effort":"low"}}]}"#.as_slice(),
    ] {
        assert!(models_from_catalog(bytes).is_err());
    }
}

#[test]
fn google_provider_reasoning_metadata_maps_to_model_info() {
    let bytes = br#"{"models":[{"provider_id":"google","model_id":"gemini","display_name":"Gemini","context_window":8192,"reasoning":{"supported_efforts":["low","high"],"default_effort":"high","mandatory":true}},{"provider_id":"google-antigravity","model_id":"gemini-pro","display_name":"Gemini Pro","context_window":8192,"reasoning":{"supported_efforts":["medium","high","max"],"default_effort":"medium","mandatory":true}},{"provider_id":"google","model_id":"unknown","display_name":"Unknown","context_window":8192}]}"#;
    let models = models_from_catalog(bytes).unwrap();
    let efforts = |model: &ModelInfo| {
        model
            .supported_reasoning_levels
            .iter()
            .map(|level| level.effort.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        efforts(&models[0]),
        vec![ReasoningEffort::Low, ReasoningEffort::High]
    );
    assert_eq!(
        models[0].default_reasoning_level,
        Some(ReasoningEffort::High)
    );
    assert_eq!(
        efforts(&models[1]),
        vec![
            ReasoningEffort::Medium,
            ReasoningEffort::High,
            ReasoningEffort::Max
        ]
    );
    assert_eq!(
        models[1].default_reasoning_level,
        Some(ReasoningEffort::Medium)
    );
    assert!(efforts(&models[2]).is_empty());
    assert_eq!(models[2].default_reasoning_level, None);
}

#[test]
fn helper_normalized_catalog_fixture_maps_every_row() {
    // Durable contract fixture generated by the helper normalizer; owned by
    // root at core/tests/fixtures/managed_reasoning_catalog.json.
    let bytes = include_str!("../tests/fixtures/managed_reasoning_catalog.json");
    let models = models_from_catalog(bytes.as_bytes()).unwrap();
    let by_slug = |slug: &str| {
        models
            .iter()
            .find(|model| model.slug == slug)
            .unwrap_or_else(|| panic!("missing {slug}"))
    };
    let efforts = |model: &ModelInfo| {
        model
            .supported_reasoning_levels
            .iter()
            .map(|preset| preset.effort.clone())
            .collect::<Vec<_>>()
    };
    let automatic = Some(ReasoningEffort::Custom("automatic".to_string()));

    for slug in [
        "managed/openrouter/z-ai/glm-5.3",
        "managed/openrouter/z-ai/glm-5.3-flash",
    ] {
        let model = by_slug(slug);
        assert_eq!(
            efforts(model),
            vec![
                ReasoningEffort::Low,
                ReasoningEffort::High,
                ReasoningEffort::Max
            ]
        );
        assert_eq!(model.default_reasoning_level, Some(ReasoningEffort::Max));
    }

    let missing = by_slug("managed/openrouter/fixture/missing");
    assert!(missing.supported_reasoning_levels.is_empty());
    assert_eq!(missing.default_reasoning_level, None);

    for slug in [
        "managed/openrouter/fixture/empty-mandatory",
        "managed/openrouter/fixture/invalid",
    ] {
        let model = by_slug(slug);
        assert!(model.supported_reasoning_levels.is_empty());
        assert_eq!(model.default_reasoning_level, automatic);
    }

    let off = by_slug("managed/openrouter/fixture/off-without-none");
    assert_eq!(
        efforts(off),
        vec![ReasoningEffort::Low, ReasoningEffort::High]
    );
    assert_eq!(off.default_reasoning_level, automatic);

    let auto_none = by_slug("managed/openrouter/fixture/automatic-with-none");
    assert_eq!(
        efforts(auto_none),
        vec![
            ReasoningEffort::None,
            ReasoningEffort::Low,
            ReasoningEffort::High
        ]
    );
    assert_eq!(auto_none.default_reasoning_level, automatic);

    let batch = by_slug("managed/openrouter/z-ai/glm-5.3-flash:batch");
    assert_eq!(
        efforts(batch),
        vec![ReasoningEffort::Low, ReasoningEffort::High]
    );
    assert_eq!(batch.default_reasoning_level, Some(ReasoningEffort::High));

    let fixed = by_slug("managed/openrouter/fixture/fixed");
    assert_eq!(efforts(fixed), vec![ReasoningEffort::High]);
    assert_eq!(fixed.default_reasoning_level, Some(ReasoningEffort::High));

    let all = by_slug("managed/openrouter/fixture/gateway-all");
    assert_eq!(
        efforts(all),
        vec![
            ReasoningEffort::None,
            ReasoningEffort::Minimal,
            ReasoningEffort::Low,
            ReasoningEffort::Medium,
            ReasoningEffort::High,
            ReasoningEffort::XHigh,
            ReasoningEffort::Max
        ]
    );
    assert_eq!(all.default_reasoning_level, Some(ReasoningEffort::Medium));
}

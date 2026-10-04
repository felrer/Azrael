use super::*;
use codex_protocol::openai_models::ConfigShellToolType;
use codex_protocol::openai_models::InputModality;
use codex_protocol::openai_models::ModelVisibility;
use pretty_assertions::assert_eq;

const CATALOG: &str = r#"{
  "families": [{
    "family_label": "SWE-2",
    "family_uid": "swe-2",
    "slug": "swe-2",
    "aliases": ["swe"],
    "variants": [
      {"model_uid":"swe-2-medium","label":"SWE-2 Medium","max_context_tokens":200000,"max_output_tokens":64000},
      {"model_uid":"swe-2-max","label":"SWE-2 Max","max_context_tokens":200000,"max_output_tokens":64000},
      {"model_uid":"swe-2-high","label":"SWE-2 High","max_context_tokens":200000,"max_output_tokens":64000}
    ]
  }]
}"#;

const REALISTIC_OPTIONAL_LIMITS_CATALOG: &str = r#"{
  "families": [{
    "family_label": "SWE-2",
    "family_uid": "swe-2",
    "slug": "swe-2",
    "aliases": [],
    "variants": [
      {"model_uid":"adaptive","label":"Adaptive"},
      {"model_uid":"fusion-swe-2","label":"Fusion SWE-2","max_context_tokens":1000000},
      {"model_uid":"swe-2-medium","label":"SWE-2 Medium","max_context_tokens":262000,"max_output_tokens":128000}
    ]
  }]
}"#;

const EMPTY_CATALOG: &str = r#"{"families": []}"#;

#[test]
fn catalog_merge_preserves_native_provider_on_collision() {
    let devin = models_from_catalog(CATALOG.as_bytes(), &HashSet::new()).unwrap();
    let mut native = vec![devin[0].clone()];
    native[0].model_provider = "openai".to_string();
    let merged = merge_models(native, devin.clone());
    assert_eq!(merged.len(), devin.len());
    assert_eq!(merged[0].model_provider, "openai");
    assert!(
        merged
            .iter()
            .skip(1)
            .all(|model| model.model_provider == "devin")
    );
}

fn manager(codex_home: &Path, devin_models: Vec<ModelInfo>) -> DevinModelsManager {
    DevinModelsManager {
        inner: Arc::new(codex_models_manager::manager::StaticModelsManager::new(
            None,
            ModelsResponse { models: Vec::new() },
        )),
        executable: codex_home.join("missing-devin-executable"),
        snapshot_path: snapshot_path(codex_home),
        capabilities_path: codex_home.join(CAPABILITIES_PATH),
        devin_models: RwLock::new(devin_models),
    }
}

#[test]
fn groups_effort_variants_and_keeps_exact_hidden_aliases() {
    // Catalog grouping is shared by ACP and native hosts. Native hosts advertise
    // Codex-executed shell tools; ACP hosts retain their disabled shell metadata.
    let shell_type = if crate::devin::native_runtime::enabled() {
        ConfigShellToolType::UnifiedExec
    } else {
        ConfigShellToolType::Disabled
    };
    let models = models_from_catalog(CATALOG.as_bytes(), &HashSet::new()).expect("catalog should parse");
    assert_eq!(
        models
            .iter()
            .map(|model| (
                model.slug.as_str(),
                model.display_name.as_str(),
                model.context_window,
                model.shell_type,
                model.visibility,
                model.default_reasoning_level.clone(),
                model
                    .supported_reasoning_levels
                    .iter()
                    .map(|preset| preset.effort.clone())
                    .collect::<Vec<_>>(),
            ))
            .collect::<Vec<_>>(),
        vec![
            (
                "devin/@group/swe-2/default/200000",
                "SWE-2 (Devin)",
                Some(200_000),
                shell_type,
                ModelVisibility::List,
                Some(ReasoningEffort::Medium),
                vec![
                    ReasoningEffort::Medium,
                    ReasoningEffort::High,
                    ReasoningEffort::Max,
                ],
            ),
            (
                "devin/swe-2-medium",
                "SWE-2 Medium (Devin)",
                Some(200_000),
                shell_type,
                ModelVisibility::Hide,
                None,
                vec![],
            ),
            (
                "devin/swe-2-max",
                "SWE-2 Max (Devin)",
                Some(200_000),
                shell_type,
                ModelVisibility::Hide,
                None,
                vec![],
            ),
            (
                "devin/swe-2-high",
                "SWE-2 High (Devin)",
                Some(200_000),
                shell_type,
                ModelVisibility::Hide,
                None,
                vec![],
            ),
        ]
    );
    assert!(models.iter().all(|model| {
        model.include_skills_usage_instructions
            && model.model_messages.is_none()
            && model.experimental_supported_tools.is_empty()
            && model.input_modalities == vec![InputModality::Text]
    }));
}

#[test]
fn accepts_optional_limits_and_omits_only_unknown_context_variants() {
    let models = models_from_catalog(REALISTIC_OPTIONAL_LIMITS_CATALOG.as_bytes(), &HashSet::new())
        .expect("realistic catalog should parse");
    assert_eq!(
        models
            .iter()
            .map(|model| (model.slug.as_str(), model.context_window))
            .collect::<Vec<_>>(),
        vec![
            ("devin/fusion-swe-2", Some(1_000_000)),
            ("devin/swe-2-medium", Some(262_000)),
        ]
    );

    let codex_home = tempfile::tempdir().expect("temporary codex home");
    let path = snapshot_path(codex_home.path());
    std::fs::create_dir_all(path.parent().expect("snapshot parent")).expect("create parent");
    std::fs::write(&path, REALISTIC_OPTIONAL_LIMITS_CATALOG).expect("write realistic catalog");
    assert!(
        resolve_with_executable(
            codex_home.path(),
            "devin/adaptive",
            None,
            codex_home.path().join("devin-test"),
        )
        .is_err(),
        "unknown-context variants must not be selectable",
    );
}

#[test]
fn rejects_explicit_non_positive_context_limit() {
    let invalid = REALISTIC_OPTIONAL_LIMITS_CATALOG
        .replace("\"max_context_tokens\":262000", "\"max_context_tokens\":0");
    let error = models_from_catalog(invalid.as_bytes(), &HashSet::new()).expect_err("zero context must fail");
    assert!(error.to_string().contains("invalid context limit"));
}

#[test]
fn rejects_duplicate_model_ids() {
    let duplicate = CATALOG.replace("swe-2-high", "swe-2-medium");
    let error = models_from_catalog(duplicate.as_bytes(), &HashSet::new()).expect_err("duplicate must fail");
    assert!(
        error
            .to_string()
            .contains("duplicate model_uid swe-2-medium")
    );
}

#[test]
fn model_key_detection_is_prefix_isolated() {
    assert!(is_devin("devin/swe-2-high"));
    assert!(!is_devin("other/devin/swe-2-high"));
    assert!(!is_devin("devin-swe-2-high"));
}

#[test]
fn resolve_uses_group_effort_and_preserves_exact_persisted_keys() {
    let codex_home = tempfile::tempdir().expect("temporary codex home");
    let path = snapshot_path(codex_home.path());
    std::fs::create_dir_all(path.parent().expect("snapshot parent")).expect("create parent");
    std::fs::write(&path, CATALOG).expect("write catalog");
    let executable = codex_home.path().join("devin-test");

    assert_eq!(
        resolve_with_executable(
            codex_home.path(),
            "devin/@group/swe-2/default/200000",
            Some(&ReasoningEffort::High),
            executable.clone(),
        )
        .expect("known model"),
        DevinSelection {
            executable: executable.clone(),
            model_id: "swe-2-high".to_string(),
        }
    );
    assert_eq!(
        resolve_with_executable(
            codex_home.path(),
            "devin/swe-2-high",
            Some(&ReasoningEffort::Minimal),
            executable.clone(),
        )
        .expect("saved exact model ignores effort metadata"),
        DevinSelection {
            executable: executable.clone(),
            model_id: "swe-2-high".to_string(),
        }
    );
    let unsupported = resolve_with_executable(
        codex_home.path(),
        "devin/@group/swe-2/default/200000",
        Some(&ReasoningEffort::Ultra),
        executable.clone(),
    )
    .expect_err("unknown group effort must fail");
    assert!(
        unsupported
            .to_string()
            .contains("does not support reasoning effort ultra")
    );
    for unknown in ["devin/swe", "devin/swe-2", "devin/swe-2-high-extra"] {
        assert!(
            resolve_with_executable(codex_home.path(), unknown, None, executable.clone()).is_err()
        );
    }
}

#[test]
fn separates_fast_priority_and_context_tiers_and_preserves_composites() {
    let catalog = r#"{
      "families": [
        {
          "family_label": "GPT-X", "family_uid": "gpt-x", "slug": "gpt-x", "aliases": [],
          "variants": [
            {"model_uid":"gpt-x-low","label":"GPT-X Low Thinking","max_context_tokens":200000},
            {"model_uid":"gpt-x-high","label":"GPT-X High Thinking","max_context_tokens":200000},
            {"model_uid":"gpt-x-low-fast","label":"GPT-X Low Thinking Fast","max_context_tokens":200000},
            {"model_uid":"gpt-x-high-fast","label":"GPT-X High Thinking Fast","max_context_tokens":200000},
            {"model_uid":"gpt-x-low-priority","label":"GPT-X Low Thinking Priority","max_context_tokens":200000},
            {"model_uid":"gpt-x-high-priority","label":"GPT-X High Thinking Priority","max_context_tokens":200000},
            {"model_uid":"gpt-x-low-1m","label":"GPT-X Low Thinking 1M","max_context_tokens":1000000},
            {"model_uid":"gpt-x-high-1m","label":"GPT-X High Thinking 1M","max_context_tokens":1000000}
          ]
        },
        {
          "family_label": "Fusion", "family_uid": "fusion", "slug": "fusion", "aliases": [],
          "variants": [
            {"model_uid":"fusion-low","label":"Fusion (GPT-X Low + SWE High)","max_context_tokens":1000000},
            {"model_uid":"fusion-high","label":"Fusion (GPT-X High + SWE High)","max_context_tokens":1000000}
          ]
        }
      ]
    }"#;
    let models = models_from_catalog(catalog.as_bytes(), &HashSet::new()).expect("catalog should parse");
    assert_eq!(
        models
            .iter()
            .filter(|model| model.visibility == ModelVisibility::List)
            .map(|model| (model.slug.as_str(), model.display_name.as_str()))
            .collect::<Vec<_>>(),
        vec![
            ("devin/@group/gpt-x/default/200000", "GPT-X (Devin)"),
            ("devin/@group/gpt-x/Fast/200000", "GPT-X Fast (Devin)"),
            (
                "devin/@group/gpt-x/Priority/200000",
                "GPT-X Priority (Devin)",
            ),
            ("devin/@group/gpt-x/1M/1000000", "GPT-X 1M (Devin)"),
            ("devin/fusion-low", "Fusion (GPT-X Low + SWE High) (Devin)"),
            (
                "devin/fusion-high",
                "Fusion (GPT-X High + SWE High) (Devin)"
            ),
        ]
    );
}

#[test]
fn recognizes_all_known_effort_labels_and_escapes_exact_keys() {
    let catalog = r#"{
      "families": [{
        "family_label": "Model", "family_uid": "model/group", "slug": "model", "aliases": [],
        "variants": [
          {"model_uid":"model/@none","label":"Model No Thinking","max_context_tokens":1000},
          {"model_uid":"model/minimal","label":"Model Minimal","max_context_tokens":1000},
          {"model_uid":"model/low","label":"Model Low","max_context_tokens":1000},
          {"model_uid":"model/medium","label":"Model Medium","max_context_tokens":1000},
          {"model_uid":"model/high","label":"Model High","max_context_tokens":1000},
          {"model_uid":"model/xhigh","label":"Model X-High","max_context_tokens":1000},
          {"model_uid":"model/max","label":"Model Max","max_context_tokens":1000},
          {"model_uid":"model/ultra","label":"Model Ultra","max_context_tokens":1000},
          {"model_uid":"model/persistent","label":"Model Persistent","max_context_tokens":1000}
        ]
      }]
    }"#;
    let models = models_from_catalog(catalog.as_bytes(), &HashSet::new()).expect("catalog should parse");
    let visible = models
        .iter()
        .find(|model| model.visibility == ModelVisibility::List)
        .expect("group should be visible");
    assert_eq!(
        visible
            .supported_reasoning_levels
            .iter()
            .map(|preset| preset.effort.clone())
            .collect::<Vec<_>>(),
        vec![
            ReasoningEffort::None,
            ReasoningEffort::Minimal,
            ReasoningEffort::Low,
            ReasoningEffort::Medium,
            ReasoningEffort::High,
            ReasoningEffort::XHigh,
            ReasoningEffort::Max,
            ReasoningEffort::Ultra,
            ReasoningEffort::Persistent,
        ]
    );
    assert_eq!(visible.slug, "devin/@group/model%2Fgroup/default/1000");
    assert!(models.iter().any(|model| {
        model.slug == "devin/model%2F%40none" && model.visibility == ModelVisibility::Hide
    }));
    assert!(models.iter().any(|model| {
        model.slug == "devin/model/@none" && model.visibility == ModelVisibility::Hide
    }));
}

#[tokio::test]
async fn online_refresh_failure_preserves_memory_and_snapshot() {
    let codex_home = tempfile::tempdir().expect("temporary codex home");
    let path = snapshot_path(codex_home.path());
    persist_snapshot(&path, CATALOG.as_bytes()).expect("persist initial snapshot");
    let models = load_snapshot(&path, &path.with_file_name("capabilities.json"))
        .expect("load initial snapshot");
    let manager = manager(codex_home.path(), models.clone());

    manager.refresh_devin(RefreshStrategy::Online).await;

    // A failed refresh retains the last-good catalog in memory and on disk.
    assert_eq!(*manager.devin_models.read().await, models);
    assert_eq!(
        load_snapshot(&path, &path.with_file_name("capabilities.json"))
            .expect("retained snapshot still parses"),
        models
    );

    // Exact and grouped selections still resolve against the retained snapshot.
    let executable = codex_home.path().join("devin-test");
    assert_eq!(
        resolve_with_executable(
            codex_home.path(),
            "devin/swe-2-high",
            None,
            executable.clone(),
        )
        .expect("exact model"),
        DevinSelection {
            executable: executable.clone(),
            model_id: "swe-2-high".to_string(),
        }
    );
    assert_eq!(
        resolve_with_executable(
            codex_home.path(),
            "devin/@group/swe-2/default/200000",
            Some(&ReasoningEffort::Max),
            executable.clone(),
        )
        .expect("grouped model"),
        DevinSelection {
            executable,
            model_id: "swe-2-max".to_string(),
        }
    );
}

#[tokio::test]
async fn offline_missing_snapshot_retains_memory() {
    let codex_home = tempfile::tempdir().expect("temporary codex home");
    let models = models_from_catalog(CATALOG.as_bytes(), &HashSet::new()).expect("catalog should parse");
    let manager = manager(codex_home.path(), models.clone());

    manager.refresh_devin(RefreshStrategy::Offline).await;

    assert_eq!(*manager.devin_models.read().await, models);
}

#[tokio::test]
async fn offline_corrupt_snapshot_retains_memory() {
    let codex_home = tempfile::tempdir().expect("temporary codex home");
    let path = snapshot_path(codex_home.path());
    persist_snapshot(&path, b"not a devin catalog").expect("persist corrupt snapshot");
    let models = models_from_catalog(CATALOG.as_bytes(), &HashSet::new()).expect("catalog should parse");
    let manager = manager(codex_home.path(), models.clone());

    manager.refresh_devin(RefreshStrategy::Offline).await;

    assert_eq!(*manager.devin_models.read().await, models);
}

#[tokio::test]
async fn successful_empty_snapshot_clears_memory() {
    let codex_home = tempfile::tempdir().expect("temporary codex home");
    let path = snapshot_path(codex_home.path());
    persist_snapshot(&path, EMPTY_CATALOG.as_bytes()).expect("persist empty snapshot");
    let models = models_from_catalog(CATALOG.as_bytes(), &HashSet::new()).expect("catalog should parse");
    let manager = manager(codex_home.path(), models);

    manager.refresh_devin(RefreshStrategy::Offline).await;

    // A successfully loaded empty catalog is authoritative.
    assert!(manager.devin_models.read().await.is_empty());
    assert!(
        resolve_with_executable(
            codex_home.path(),
            "devin/swe-2-high",
            None,
            codex_home.path().join("devin-test"),
        )
        .is_err()
    );
}

#[tokio::test]
async fn online_failure_without_initial_cache_remains_unavailable() {
    let codex_home = tempfile::tempdir().expect("temporary codex home");
    let manager = manager(codex_home.path(), Vec::new());

    manager.refresh_devin(RefreshStrategy::Online).await;

    assert!(manager.devin_models.read().await.is_empty());
    assert!(!snapshot_path(codex_home.path()).exists());
    assert_eq!(
        manager
            .get_model_info("devin/swe-2-high", &ModelsManagerConfig::default())
            .await,
        unavailable_model_info("devin/swe-2-high")
    );
}

#[test]
fn image_modalities_require_verified_capabilities_for_every_selectable_member() {
    let modalities = |models: &[ModelInfo], slug: &str| {
        models
            .iter()
            .find(|model| model.slug == slug)
            .map(|model| model.input_modalities.clone())
            .unwrap_or_else(|| panic!("missing {slug}"))
    };
    let text = vec![InputModality::Text];
    let images = vec![InputModality::Text, InputModality::Image];
    let all: HashSet<String> = ["swe-2-medium", "swe-2-max", "swe-2-high"]
        .into_iter()
        .map(String::from)
        .collect();
    let models = models_from_catalog(CATALOG.as_bytes(), &all).expect("catalog should parse");
    assert!(models.iter().all(|model| model.input_modalities == images));

    // One unverified effort member keeps the effort group text-only while the
    // verified exact aliases keep their own capability.
    let partial: HashSet<String> = ["swe-2-medium"].into_iter().map(String::from).collect();
    let models = models_from_catalog(CATALOG.as_bytes(), &partial).expect("catalog should parse");
    let group = models
        .iter()
        .find(|model| model.visibility == ModelVisibility::List)
        .expect("group model");
    assert_eq!(group.input_modalities, text);
    assert_eq!(modalities(&models, "devin/swe-2-medium"), images);
    assert_eq!(modalities(&models, "devin/swe-2-high"), text);
}

#[test]
fn capability_snapshot_is_ignored_without_native_transport() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("capabilities.json");
    std::fs::write(&path, br#"{"image_model_ids":["swe-2-high"]}"#).unwrap();
    let expected: HashSet<String> = if crate::devin::native_runtime::enabled() {
        ["swe-2-high".to_string()].into_iter().collect()
    } else {
        HashSet::new()
    };
    assert_eq!(image_models(&path), expected);
    std::fs::write(&path, b"not json").unwrap();
    assert!(image_models(&path).is_empty());
}

//! Private managed-provider catalog. No credentials cross this boundary.
use anyhow::Context;
use anyhow::Result;
use anyhow::anyhow;
use codex_http_client::HttpClientFactory;
use codex_login::AuthManager;
use codex_models_manager::ModelsManagerConfig;
use codex_models_manager::manager::ModelsManager;
use codex_models_manager::manager::ModelsManagerFuture;
use codex_models_manager::manager::ProviderCatalogStatus;
use codex_models_manager::manager::RefreshStrategy;
use codex_models_manager::manager::SharedModelsManager;
use codex_protocol::config_types::CollaborationModeMask;
use codex_protocol::openai_models::InputModality;
use codex_protocol::openai_models::ModelInfo;
use codex_protocol::openai_models::ModelVisibility;
use codex_protocol::openai_models::ModelsResponse;
use codex_protocol::openai_models::ReasoningEffort;
use codex_protocol::openai_models::ReasoningEffortPreset;
use codex_protocol::openai_models::TruncationPolicyConfig;
use std::collections::HashSet;
use std::path::Path;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::RwLock;
use tokio::sync::Semaphore;
use tokio::sync::TryLockError;
use tokio::time::timeout;
use tracing::warn;

use serde::Deserialize;
use serde::Serialize;

const HELPER_ENV: &str = "AZRAEL_PROVIDER_INFERENCE_HELPER";
const BUN_ENV: &str = "AZRAEL_PROVIDER_BUN";
const MAX_CATALOG_BYTES: usize = 1024 * 1024;
const CLI_TIMEOUT: Duration = Duration::from_secs(30);
pub(crate) const PROVIDER_ID: &str = "azrael-managed";

#[derive(Debug)]
struct ManagedModelsManager {
    inner: SharedModelsManager,
    helper: PathBuf,
    bun: PathBuf,
    codex_home: PathBuf,
    snapshot_path: PathBuf,
    managed_models: RwLock<Vec<ModelInfo>>,
    provider_catalogs: RwLock<Vec<ProviderCatalogStatus>>,
    catalog_refresh: Semaphore,
}

pub(crate) fn is_managed(key: &str) -> bool {
    key.starts_with("managed/")
}

pub(crate) fn selection(key: &str) -> Result<(&str, &str)> {
    let (provider, model) = key
        .strip_prefix("managed/")
        .and_then(|value| value.split_once('/'))
        .context("invalid managed model key")?;
    if !matches!(
        provider,
        "google" | "google-antigravity" | "xai" | "openrouter" | "anthropic"
    ) || model.trim().is_empty()
        || model.chars().any(char::is_control)
        || model.len() > 256
    {
        return Err(anyhow!("invalid managed model selection"));
    }
    Ok((provider, model))
}

pub(crate) fn provider_info() -> codex_model_provider_info::ModelProviderInfo {
    codex_model_provider_info::ModelProviderInfo {
        name: "Managed inference".to_string(),
        base_url: Some("azrael-managed://native".to_string()),
        request_max_retries: Some(0),
        stream_max_retries: Some(0),
        ..Default::default()
    }
}

pub(crate) fn enabled() -> bool {
    std::env::var_os(HELPER_ENV).is_some_and(|value| !value.is_empty())
}

pub(crate) fn runtime_paths() -> Result<(PathBuf, PathBuf)> {
    let path = |name| -> Result<PathBuf> {
        let value = std::env::var_os(name).context("managed provider runtime is not configured")?;
        let path = PathBuf::from(value);
        if !path.is_absolute() {
            return Err(anyhow!("managed provider runtime paths must be absolute"));
        }
        Ok(path)
    };
    Ok((path(HELPER_ENV)?, path(BUN_ENV)?))
}

pub(crate) fn wrap(inner: SharedModelsManager, codex_home: PathBuf) -> SharedModelsManager {
    if !enabled() {
        return inner;
    }
    // Invalid configured artifacts remain unavailable, never an OpenAI fallback.
    let (helper, bun) = runtime_paths().unwrap_or_default();
    let snapshot_path = codex_home.join("azrael/providers/models.json");
    let managed_models = load_snapshot(&snapshot_path).unwrap_or_default();
    let provider_catalogs = load_statuses(&snapshot_path).unwrap_or_default();
    Arc::new(ManagedModelsManager {
        inner,
        helper,
        bun,
        codex_home,
        snapshot_path,
        managed_models: RwLock::new(managed_models),
        provider_catalogs: RwLock::new(provider_catalogs),
        catalog_refresh: Semaphore::new(1),
    })
}

pub(crate) fn resolve(codex_home: &Path, key: &str) -> Result<()> {
    selection(key)?;
    runtime_paths()?;
    let path = codex_home.join("azrael/providers/models.json");
    let models = load_snapshot(&path)?;
    let retained = load_retained_snapshot(&path)?;
    if !models
        .iter()
        .chain(retained.iter())
        .any(|model| model.slug == key)
    {
        return Err(anyhow!("managed model is unavailable"));
    }
    Ok(())
}

impl ManagedModelsManager {
    async fn refresh_managed(&self, refresh_strategy: RefreshStrategy) {
        let Ok(_permit) = self.catalog_refresh.acquire().await else {
            self.managed_models.write().await.clear();
            for status in self.provider_catalogs.write().await.iter_mut() {
                status.state = codex_models_manager::manager::ProviderCatalogState::Error;
                status.model_count = 0;
                status.error_code = Some("unavailable".into());
            }
            warn!(
                error_code = "unavailable",
                "managed provider catalog refresh admission failed"
            );
            return;
        };
        match refresh_strategy {
            RefreshStrategy::Offline => {
                *self.managed_models.write().await =
                    load_snapshot(&self.snapshot_path).unwrap_or_default();
                *self.provider_catalogs.write().await =
                    load_statuses(&self.snapshot_path).unwrap_or_default();
            }
            RefreshStrategy::Online | RefreshStrategy::OnlineIfUncached => {
                match fetch_catalog(
                    &self.helper,
                    &self.bun,
                    &self.codex_home,
                    matches!(refresh_strategy, RefreshStrategy::Online),
                )
                .await
                .and_then(|bytes| {
                    let models = models_from_catalog(&bytes)?;
                    let statuses = statuses_from_catalog(&bytes)?;
                    persist_snapshot(&self.snapshot_path, &bytes)?;
                    Ok((models, statuses))
                }) {
                    Ok((models, statuses)) => {
                        for status in &statuses {
                            if status.error_code.is_some() {
                                warn!(provider_id = %status.provider_id, error_code = ?status.error_code, "managed provider catalog discovery degraded");
                            }
                        }
                        *self.managed_models.write().await = models;
                        *self.provider_catalogs.write().await = statuses;
                    }
                    Err(_error) => {
                        for status in self.provider_catalogs.write().await.iter_mut() {
                            status.state = if status.model_count > 0 {
                                codex_models_manager::manager::ProviderCatalogState::Stale
                            } else {
                                codex_models_manager::manager::ProviderCatalogState::Error
                            };
                            status.error_code = Some("unavailable".into());
                        }
                        // Retain last-good discovery on a failed refresh. A
                        // successful empty catalog still removes unavailable
                        // models; inference independently validates credentials.
                        warn!(
                            error_code = "unavailable",
                            "managed provider catalog refresh failed"
                        );
                    }
                }
            }
        }
    }

    async fn merged_models(&self, native_models: Vec<ModelInfo>) -> Vec<ModelInfo> {
        merge_models(native_models, self.managed_models.read().await.clone())
    }
}

impl ModelsManager for ManagedModelsManager {
    fn provider_catalogs(&self) -> ModelsManagerFuture<'_, Vec<ProviderCatalogStatus>> {
        Box::pin(async move { self.provider_catalogs.read().await.clone() })
    }
    fn raw_model_catalog(
        &self,
        refresh_strategy: RefreshStrategy,
        http_client_factory: HttpClientFactory,
    ) -> ModelsManagerFuture<'_, ModelsResponse> {
        Box::pin(async move {
            let (native, ()) = tokio::join!(
                self.inner
                    .raw_model_catalog(refresh_strategy, http_client_factory),
                self.refresh_managed(refresh_strategy),
            );
            ModelsResponse {
                models: self.merged_models(native.models).await,
            }
        })
    }

    fn get_remote_models(&self) -> ModelsManagerFuture<'_, Vec<ModelInfo>> {
        Box::pin(async move {
            let native_models = self.inner.get_remote_models().await;
            self.merged_models(native_models).await
        })
    }

    fn try_get_remote_models(&self) -> Result<Vec<ModelInfo>, TryLockError> {
        let native_models = self.inner.try_get_remote_models()?;
        let managed_models = self.managed_models.try_read()?.clone();
        Ok(merge_models(native_models, managed_models))
    }

    fn auth_manager(&self) -> Option<&AuthManager> {
        self.inner.auth_manager()
    }

    fn list_collaboration_modes(&self) -> Vec<CollaborationModeMask> {
        self.inner.list_collaboration_modes()
    }

    fn get_default_model<'a>(
        &'a self,
        model: &'a Option<String>,
        allow_provider_model_fallback: bool,
        refresh_strategy: RefreshStrategy,
        http_client_factory: HttpClientFactory,
    ) -> ModelsManagerFuture<'a, String> {
        if model.as_deref().is_some_and(is_managed) {
            return Box::pin(async move {
                self.refresh_managed(refresh_strategy).await;
                model.clone().unwrap_or_default()
            });
        }
        self.inner.get_default_model(
            model,
            allow_provider_model_fallback,
            refresh_strategy,
            http_client_factory,
        )
    }

    fn get_model_info<'a>(
        &'a self,
        model: &'a str,
        config: &'a ModelsManagerConfig,
    ) -> ModelsManagerFuture<'a, ModelInfo> {
        if !is_managed(model) {
            return self.inner.get_model_info(model, config);
        }
        Box::pin(async move {
            self.managed_models
                .read()
                .await
                .iter()
                .find(|candidate| candidate.slug == model)
                .cloned()
                .or_else(|| {
                    load_retained_snapshot(&self.snapshot_path)
                        .ok()?
                        .into_iter()
                        .find(|candidate| candidate.slug == model)
                })
                .unwrap_or_else(|| unavailable_model_info(model))
        })
    }

    fn refresh_if_new_etag(
        &self,
        etag: String,
        http_client_factory: HttpClientFactory,
    ) -> ModelsManagerFuture<'_, ()> {
        self.inner.refresh_if_new_etag(etag, http_client_factory)
    }
}

#[derive(Deserialize)]
struct Catalog {
    models: Vec<Entry>,
    #[serde(default)]
    retained_models: Vec<Entry>,
    #[serde(default)]
    provider_statuses: Vec<ProviderCatalogStatus>,
}
#[derive(Clone, Deserialize, Serialize)]
struct Entry {
    provider_id: String,
    model_id: String,
    display_name: String,
    context_window: i64,
    #[serde(default)]
    reasoning: Option<EntryReasoning>,
    /// Helper-declared prompt modalities. Omitted means text-only so that an
    /// unverified model is blocked in the composer before any image is sent.
    #[serde(default)]
    input_modalities: Option<Vec<InputModality>>,
}

fn entry_input_modalities(entry: &Entry) -> Result<Vec<InputModality>> {
    match entry.input_modalities.as_deref() {
        None | Some([InputModality::Text]) => Ok(vec![InputModality::Text]),
        Some([InputModality::Text, InputModality::Image]) => {
            Ok(vec![InputModality::Text, InputModality::Image])
        }
        Some(_) => Err(anyhow!("invalid managed model input modalities")),
    }
}

/// Optional gateway-advertised reasoning metadata. The helper normalizes values
/// to exact effort names in ascending order; this side validates that contract
/// and fails closed on any deviation.
#[derive(Clone, Deserialize, Serialize)]
struct EntryReasoning {
    #[serde(default)]
    supported_efforts: Vec<String>,
    #[serde(default)]
    default_effort: Option<String>,
    #[serde(default)]
    mandatory: bool,
    #[serde(default)]
    default_enabled: Option<bool>,
}

/// Internal host sentinel marking "reasoning supported, no explicit default".
/// `ModelPreset::from` would otherwise collapse `None` into `ReasoningEffort::None`,
/// losing the distinction between an advertised `none` stage and automatic/omit.
/// The UI renders this as Automatic/null and inference strips it before the wire;
/// it is never a supported stage and never sent upstream.
const AUTOMATIC_REASONING_DEFAULT: &str = "automatic";

fn automatic_reasoning_default() -> ReasoningEffort {
    ReasoningEffort::Custom(AUTOMATIC_REASONING_DEFAULT.to_string())
}

fn gateway_reasoning_effort(value: &str) -> Option<ReasoningEffort> {
    match value {
        "none" => Some(ReasoningEffort::None),
        "minimal" => Some(ReasoningEffort::Minimal),
        "low" => Some(ReasoningEffort::Low),
        "medium" => Some(ReasoningEffort::Medium),
        "high" => Some(ReasoningEffort::High),
        "xhigh" => Some(ReasoningEffort::XHigh),
        "max" => Some(ReasoningEffort::Max),
        _ => None,
    }
}

fn gateway_reasoning_rank(effort: &ReasoningEffort) -> usize {
    match effort {
        ReasoningEffort::None => 0,
        ReasoningEffort::Minimal => 1,
        ReasoningEffort::Low => 2,
        ReasoningEffort::Medium => 3,
        ReasoningEffort::High => 4,
        ReasoningEffort::XHigh => 5,
        ReasoningEffort::Max => 6,
        ReasoningEffort::Ultra | ReasoningEffort::Persistent | ReasoningEffort::Custom(_) => {
            usize::MAX
        }
    }
}

/// Maps provider-declared reasoning stages onto the native model contract.
/// Missing or empty metadata never inherits a fabricated Medium default.
fn apply_entry_reasoning(model: &mut ModelInfo, entry: &Entry) -> Result<()> {
    model.supported_reasoning_levels = Vec::new();
    model.default_reasoning_level = None;
    let Some(reasoning) = &entry.reasoning else {
        return Ok(());
    };
    if reasoning.mandatory && reasoning.default_enabled == Some(false) {
        return Err(anyhow!("invalid managed reasoning metadata"));
    }
    if reasoning.supported_efforts.is_empty() {
        if reasoning.default_effort.is_some() {
            return Err(anyhow!("invalid managed reasoning metadata"));
        }
        // Reasoning flagged on without advertised stages keeps the automatic
        // marker; otherwise there is no default at all.
        if reasoning.mandatory || reasoning.default_enabled == Some(true) {
            model.default_reasoning_level = Some(automatic_reasoning_default());
        }
        return Ok(());
    }
    let mut efforts = Vec::with_capacity(reasoning.supported_efforts.len());
    for value in &reasoning.supported_efforts {
        let effort = gateway_reasoning_effort(value)
            .ok_or_else(|| anyhow!("invalid managed reasoning effort"))?;
        if efforts.last().is_some_and(|previous: &ReasoningEffort| {
            gateway_reasoning_rank(previous) >= gateway_reasoning_rank(&effort)
        }) {
            return Err(anyhow!("invalid managed reasoning effort order"));
        }
        efforts.push(effort);
    }
    if reasoning.mandatory && efforts.contains(&ReasoningEffort::None) {
        return Err(anyhow!("invalid managed reasoning metadata"));
    }
    let default_effort = match &reasoning.default_effort {
        Some(value) => Some(
            gateway_reasoning_effort(value)
                .ok_or_else(|| anyhow!("invalid managed reasoning effort"))?,
        ),
        // No declared default: the gateway did not pick one (including
        // provider-off without a `none` stage). Keep the automatic sentinel
        // instead of inventing `none`; the helper emits `none` explicitly when
        // it is advertised and selected.
        None => Some(automatic_reasoning_default()),
    };
    if let Some(default) = &default_effort
        && *default != automatic_reasoning_default()
        && !efforts.contains(default)
    {
        return Err(anyhow!("invalid managed reasoning metadata"));
    }
    model.supported_reasoning_levels = efforts
        .into_iter()
        .map(|effort| ReasoningEffortPreset {
            description: effort.as_str().to_string(),
            effort,
        })
        .collect();
    model.default_reasoning_level = default_effort;
    Ok(())
}

fn models_from_catalog(bytes: &[u8]) -> Result<Vec<ModelInfo>> {
    if bytes.len() > MAX_CATALOG_BYTES {
        return Err(anyhow!("managed catalog exceeds hard limit"));
    }
    let catalog: Catalog =
        serde_json::from_slice(bytes).context("invalid managed model catalog")?;
    models_from_entries(catalog.models, ModelVisibility::List)
}

fn retained_models_from_catalog(bytes: &[u8]) -> Result<Vec<ModelInfo>> {
    if bytes.len() > MAX_CATALOG_BYTES {
        return Err(anyhow!("managed catalog exceeds hard limit"));
    }
    let catalog: Catalog =
        serde_json::from_slice(bytes).context("invalid managed model catalog")?;
    models_from_entries(catalog.retained_models, ModelVisibility::Hide)
}

fn models_from_entries(entries: Vec<Entry>, visibility: ModelVisibility) -> Result<Vec<ModelInfo>> {
    let mut seen = HashSet::new();
    entries
        .into_iter()
        .enumerate()
        .map(|(index, entry)| {
            let slug = format!("managed/{}/{}", entry.provider_id, entry.model_id);
            selection(&slug)?;
            if entry.display_name.is_empty()
                || entry.display_name.len() > 4096
                || entry.context_window <= 0
                || !seen.insert(slug.clone())
            {
                return Err(anyhow!("invalid managed model metadata"));
            }
            let mut model = unavailable_model_info(&slug);
            model.model_provider = PROVIDER_ID.to_string();
            apply_entry_reasoning(&mut model, &entry)?;
            model.input_modalities = entry_input_modalities(&entry)?;
            model.display_name = entry.display_name;
            model.visibility = visibility;
            model.supported_in_api = true;
            model.priority = i32::try_from(index)?
                .checked_add(20_000)
                .context("too many managed models")?;
            model.context_window = Some(entry.context_window);
            model.max_context_window = Some(entry.context_window);
            model.truncation_policy = TruncationPolicyConfig::tokens(entry.context_window);
            model.shell_type = codex_protocol::openai_models::ConfigShellToolType::UnifiedExec;
            model.apply_patch_tool_type =
                Some(codex_protocol::openai_models::ApplyPatchToolType::Freeform);
            Ok(model)
        })
        .collect()
}

fn unavailable_model_info(model: &str) -> ModelInfo {
    // Reuse the text-only native helper metadata contract.
    let mut info = crate::devin::catalog::unavailable_model_info(model);
    info.model_provider = PROVIDER_ID.to_string();
    if matches!(selection(model), Ok(("anthropic", _))) {
        info.node_repl_disabled = false;
    }
    info
}
fn merge_models(mut native: Vec<ModelInfo>, managed: Vec<ModelInfo>) -> Vec<ModelInfo> {
    let mut seen: HashSet<String> = native.iter().map(|model| model.slug.clone()).collect();
    native.extend(
        managed
            .into_iter()
            .filter(|model| seen.insert(model.slug.clone()))
            .map(|mut model| {
                model.model_provider = PROVIDER_ID.to_string();
                model
            }),
    );
    native
}
fn load_snapshot(path: &Path) -> Result<Vec<ModelInfo>> {
    models_from_catalog(&std::fs::read(path)?)
}
fn load_retained_snapshot(path: &Path) -> Result<Vec<ModelInfo>> {
    retained_models_from_catalog(&std::fs::read(path)?)
}
fn load_statuses(path: &Path) -> Result<Vec<ProviderCatalogStatus>> {
    statuses_from_catalog(&std::fs::read(path)?)
}
fn statuses_from_catalog(bytes: &[u8]) -> Result<Vec<ProviderCatalogStatus>> {
    if bytes.len() > MAX_CATALOG_BYTES {
        return Err(anyhow!("managed catalog exceeds hard limit"));
    }
    let catalog: Catalog =
        serde_json::from_slice(bytes).context("invalid managed model catalog")?;
    let mut seen = HashSet::new();
    for status in &catalog.provider_statuses {
        if !matches!(
            status.provider_id.as_str(),
            "google" | "google-antigravity" | "xai" | "openrouter" | "anthropic"
        ) || !seen.insert(status.provider_id.clone())
            || status.observed_at < 0
            || matches!(
                status.state,
                codex_models_manager::manager::ProviderCatalogState::Ready
            ) && status.model_count == 0
            || matches!(
                status.state,
                codex_models_manager::manager::ProviderCatalogState::Empty
                    | codex_models_manager::manager::ProviderCatalogState::Error
            ) && status.model_count != 0
            || status.model_count
                != catalog
                    .models
                    .iter()
                    .filter(|m| m.provider_id == status.provider_id)
                    .count()
            || status.error_code.as_deref().is_some_and(|code| {
                !matches!(
                    code,
                    "network"
                        | "timeout"
                        | "http"
                        | "invalid_response"
                        | "catalog_limit"
                        | "storage"
                        | "unavailable"
                )
            })
        {
            return Err(anyhow!("invalid managed provider catalog status"));
        }
    }
    Ok(catalog.provider_statuses)
}
fn persist_snapshot(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("managed snapshot has no parent")?;
    std::fs::create_dir_all(parent)?;
    let mut current: serde_json::Value = serde_json::from_slice(bytes)?;
    let next: Catalog = serde_json::from_slice(bytes)?;
    let active: HashSet<String> = next
        .models
        .iter()
        .map(|entry| format!("managed/{}/{}", entry.provider_id, entry.model_id))
        .collect();
    let previous: Option<Catalog> = std::fs::read(path)
        .ok()
        .and_then(|old| serde_json::from_slice(&old).ok());
    let mut retained = next.retained_models;
    if let Some(previous) = previous {
        retained.extend(previous.retained_models);
        retained.extend(previous.models);
    }
    let mut seen = HashSet::new();
    retained.retain(|entry| {
        let slug = format!("managed/{}/{}", entry.provider_id, entry.model_id);
        !active.contains(&slug) && seen.insert(slug)
    });
    models_from_entries(retained.clone(), ModelVisibility::Hide)?;
    current["retained_models"] = serde_json::to_value(retained)?;
    let merged = serde_json::to_vec(&current)?;
    if merged.len() > MAX_CATALOG_BYTES {
        return Err(anyhow!("managed catalog exceeds hard limit"));
    }
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    std::io::Write::write_all(&mut temp, &merged)?;
    temp.persist(path)?;
    Ok(())
}
async fn fetch_catalog(
    helper: &Path,
    bun: &Path,
    codex_home: &Path,
    refresh: bool,
) -> Result<Vec<u8>> {
    let mut command = Command::new(bun);
    if refresh {
        command.arg(helper).arg("--catalog").arg("--refresh");
    } else {
        command.arg(helper).arg("--catalog");
    }
    command
        .env("CODEX_HOME", codex_home)
        .env(
            "OPENCODEX_HOME",
            codex_home.join("azrael/providers/opencodex"),
        )
        .env_remove("BUN_OPTIONS")
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut child = command
        .spawn()
        .context("managed catalog helper unavailable")?;
    let mut stdout = child
        .stdout
        .take()
        .context("managed catalog pipe unavailable")?;
    timeout(CLI_TIMEOUT, async {
        let mut bytes = Vec::new();
        (&mut stdout)
            .take(MAX_CATALOG_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .await?;
        if bytes.len() > MAX_CATALOG_BYTES {
            return Err(anyhow!("managed catalog exceeds hard limit"));
        }
        if !child.wait().await?.success() {
            return Err(anyhow!("managed catalog helper failed"));
        }
        Ok(bytes)
    })
    .await
    .context("managed catalog helper timed out")?
}

#[cfg(test)]
#[path = "managed_catalog_tests.rs"]
mod tests;

#[cfg(test)]
mod antigravity_tests {
    use super::*;

    #[test]
    fn google_antigravity_selection_preserves_opaque_model() {
        assert_eq!(
            selection("managed/google-antigravity/vendor/model:alias").unwrap(),
            ("google-antigravity", "vendor/model:alias")
        );
        assert!(selection("managed/google-antigravity/").is_err());
        assert!(selection("managed/google-antigravity/model\n").is_err());
        assert_eq!(
            selection("managed/google/gemini").unwrap(),
            ("google", "gemini")
        );
    }

    #[test]
    fn google_antigravity_catalog_and_status_remain_separate() {
        let bytes = br#"{"models":[{"provider_id":"google-antigravity","model_id":"vendor/model:alias","display_name":"Fixture","context_window":8192}],"provider_statuses":[{"provider_id":"google-antigravity","state":"ready","model_count":1,"observed_at":123},{"provider_id":"google","state":"empty","model_count":0,"observed_at":123}]}"#;
        let models = models_from_catalog(bytes).unwrap();
        assert_eq!(
            models[0].slug,
            "managed/google-antigravity/vendor/model:alias"
        );
        let statuses = statuses_from_catalog(bytes).unwrap();
        assert_eq!(statuses.len(), 2);
        assert_eq!(statuses[0].provider_id, "google-antigravity");
        assert_eq!(statuses[1].provider_id, "google");
        for invalid in [
            br#"{"models":[],"provider_statuses":[{"provider_id":"google-antigravity","state":"ready","model_count":1,"observed_at":123}]}"#.as_slice(),
            br#"{"models":[],"provider_statuses":[{"provider_id":"google-antigravity","state":"error","model_count":0,"observed_at":123,"error_code":"raw secret"}]}"#.as_slice(),
        ] {
            assert!(statuses_from_catalog(invalid).is_err());
        }
    }
}

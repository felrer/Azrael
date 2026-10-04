use anyhow::Context;
use anyhow::Result;
use anyhow::anyhow;
use codex_http_client::HttpClientFactory;
use codex_login::AuthManager;
use codex_models_manager::ModelsManagerConfig;
use codex_models_manager::manager::ModelsManager;
use codex_models_manager::manager::ModelsManagerFuture;
use codex_models_manager::manager::RefreshStrategy;
use codex_models_manager::manager::SharedModelsManager;
use codex_protocol::config_types::CollaborationModeMask;
use codex_protocol::openai_models::ModelInfo;
use codex_protocol::openai_models::ModelVisibility;
use codex_protocol::openai_models::ModelsResponse;
use codex_protocol::openai_models::ReasoningEffort;
use codex_protocol::openai_models::TruncationPolicyConfig;
use std::collections::HashSet;
use std::ffi::OsString;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::RwLock;
use tokio::sync::TryLockError;
use tokio::time::timeout;
use tracing::warn;

const DEVIN_EXECUTABLE_ENV: &str = "AZRAEL_EX_DEVIN_EXECUTABLE";
const DEVIN_PREFIX: &str = "devin/";
const CATALOG_PATH: &str = "azrael/devin/models.json";
const CAPABILITIES_PATH: &str = "azrael/devin/capabilities.json";
const CLI_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_CATALOG_BYTES: usize = 1024 * 1024;

#[path = "catalog_mapping.rs"]
mod mapping;

use mapping::models_from_catalog;
use mapping::parse_catalog;
use mapping::resolve_model;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DevinSelection {
    pub executable: PathBuf,
    pub model_id: String,
}

#[derive(Debug)]
struct DevinModelsManager {
    inner: SharedModelsManager,
    executable: PathBuf,
    snapshot_path: PathBuf,
    capabilities_path: PathBuf,
    devin_models: RwLock<Vec<ModelInfo>>,
}

/// Image-capable cloud model ids persisted beside the CLI catalog. Only the
/// native transport forwards images, so the ACP fallback always stays text-only.
#[derive(Debug, Default, serde::Deserialize, serde::Serialize)]
struct Capabilities {
    image_model_ids: Vec<String>,
}

pub(crate) fn executable() -> Option<PathBuf> {
    executable_from(std::env::var_os(DEVIN_EXECUTABLE_ENV))
}

fn executable_from(value: Option<OsString>) -> Option<PathBuf> {
    let path = PathBuf::from(value?);
    path.is_absolute().then_some(path)
}

pub(crate) fn is_devin(key: &str) -> bool {
    key.starts_with(DEVIN_PREFIX)
}

pub(crate) fn is_ungrouped_selection(key: &str) -> bool {
    is_devin(key) && !key.starts_with(mapping::GROUP_PREFIX)
}

pub(crate) fn resolve(
    codex_home: &Path,
    key: &str,
    effort: Option<&ReasoningEffort>,
) -> Result<DevinSelection> {
    let executable = executable().context("Devin integration is not enabled")?;
    resolve_with_executable(codex_home, key, effort, executable)
}

fn resolve_with_executable(
    codex_home: &Path,
    key: &str,
    effort: Option<&ReasoningEffort>,
    executable: PathBuf,
) -> Result<DevinSelection> {
    if !is_devin(key) {
        return Err(anyhow!("model key is not a Devin selection: {key}"));
    }

    let bytes =
        std::fs::read(snapshot_path(codex_home)).context("Devin model catalog unavailable")?;
    let catalog = parse_catalog(&bytes, MAX_CATALOG_BYTES)?;
    let model_id = resolve_model(&catalog, key, effort)?;

    Ok(DevinSelection {
        executable,
        model_id,
    })
}

pub(crate) fn wrap(inner: SharedModelsManager, codex_home: PathBuf) -> SharedModelsManager {
    let Some(executable) = executable() else {
        return inner;
    };
    let snapshot_path = snapshot_path(&codex_home);
    let capabilities_path = codex_home.join(CAPABILITIES_PATH);
    let devin_models = load_snapshot(&snapshot_path, &capabilities_path).unwrap_or_default();
    Arc::new(DevinModelsManager {
        inner,
        executable,
        snapshot_path,
        capabilities_path,
        devin_models: RwLock::new(devin_models),
    })
}

impl DevinModelsManager {
    async fn refresh_devin(&self, refresh_strategy: RefreshStrategy) {
        match refresh_strategy {
            RefreshStrategy::Offline => match load_snapshot(
                &self.snapshot_path,
                &self.capabilities_path,
            ) {
                Ok(models) => *self.devin_models.write().await = models,
                Err(error) => {
                    warn!(
                        "failed to load Devin model catalog; retaining previous catalog: {error:#}"
                    );
                }
            },
            RefreshStrategy::OnlineIfUncached if !self.devin_models.read().await.is_empty() => {}
            RefreshStrategy::Online | RefreshStrategy::OnlineIfUncached => {
                let catalog = fetch_catalog(&self.executable).await;
                if catalog.is_ok() {
                    self.refresh_capabilities().await;
                }
                match catalog.and_then(|bytes| {
                    let models =
                        models_from_catalog(&bytes, &image_models(&self.capabilities_path))?;
                    persist_snapshot(&self.snapshot_path, &bytes)?;
                    Ok(models)
                }) {
                    Ok(models) => *self.devin_models.write().await = models,
                    Err(error) => {
                        warn!(
                            "failed to refresh Devin model catalog; retaining previous catalog: {error:#}"
                        );
                    }
                }
            }
        }
    }

    /// A failed lookup keeps the last verified capabilities; models that were
    /// never verified remain text-only.
    async fn refresh_capabilities(&self) {
        match super::native_runtime::image_model_ids().await {
            None => {}
            Some(Ok(image_model_ids)) => {
                let persisted = serde_json::to_vec(&Capabilities { image_model_ids })
                    .map_err(anyhow::Error::from)
                    .and_then(|bytes| persist_snapshot(&self.capabilities_path, &bytes));
                if let Err(error) = persisted {
                    warn!("failed to persist Devin model capabilities: {error:#}");
                }
            }
            Some(Err(error)) => {
                warn!("failed to refresh Devin model capabilities; retaining previous capabilities: {error:#}");
            }
        }
    }

    async fn merged_models(&self, native_models: Vec<ModelInfo>) -> Vec<ModelInfo> {
        merge_models(native_models, self.devin_models.read().await.clone())
    }
}

impl ModelsManager for DevinModelsManager {
    fn raw_model_catalog(
        &self,
        refresh_strategy: RefreshStrategy,
        http_client_factory: HttpClientFactory,
    ) -> ModelsManagerFuture<'_, ModelsResponse> {
        Box::pin(async move {
            let (native, ()) = tokio::join!(
                self.inner
                    .raw_model_catalog(refresh_strategy, http_client_factory),
                self.refresh_devin(refresh_strategy),
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
        let devin_models = self.devin_models.try_read()?.clone();
        Ok(merge_models(native_models, devin_models))
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
        if model.as_deref().is_some_and(is_devin) {
            return Box::pin(async move {
                self.refresh_devin(refresh_strategy).await;
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
        if !is_devin(model) {
            return self.inner.get_model_info(model, config);
        }
        Box::pin(async move {
            self.devin_models
                .read()
                .await
                .iter()
                .find(|candidate| candidate.slug == model)
                .cloned()
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

fn snapshot_path(codex_home: &Path) -> PathBuf {
    codex_home.join(CATALOG_PATH)
}

fn load_snapshot(path: &Path, capabilities_path: &Path) -> Result<Vec<ModelInfo>> {
    let bytes = std::fs::read(path)?;
    models_from_catalog(&bytes, &image_models(capabilities_path))
}

fn image_models(path: &Path) -> HashSet<String> {
    if !super::native_runtime::enabled() {
        return HashSet::new();
    }
    let parsed = std::fs::read(path).ok().and_then(|bytes| {
        (bytes.len() <= MAX_CATALOG_BYTES)
            .then(|| serde_json::from_slice::<Capabilities>(&bytes).ok())
            .flatten()
    });
    parsed
        .map(|capabilities| capabilities.image_model_ids.into_iter().collect())
        .unwrap_or_default()
}

pub(crate) fn unavailable_model_info(model: &str) -> ModelInfo {
    ModelInfo {
        slug: model.to_string(),
        display_name: model.to_string(),
        visibility: ModelVisibility::Hide,
        supported_in_api: false,
        context_window: None,
        max_context_window: None,
        truncation_policy: TruncationPolicyConfig::tokens(1),
        ..mapping::unavailable_template(model)
    }
}

fn merge_models(mut native_models: Vec<ModelInfo>, devin_models: Vec<ModelInfo>) -> Vec<ModelInfo> {
    for model in &mut native_models {
        // The inner catalog is authoritative for any slug collision.
        if model.model_provider.is_empty() {
            model.model_provider = "openai".to_string();
        }
    }
    let mut slugs: HashSet<String> = native_models
        .iter()
        .map(|model| model.slug.clone())
        .collect();
    for mut model in devin_models {
        if slugs.insert(model.slug.clone()) {
            model.model_provider = super::PROVIDER_ID.to_string();
            native_models.push(model);
        } else {
            warn!(slug = model.slug, "ignored colliding Devin model key");
        }
    }
    native_models
}

async fn fetch_catalog(executable: &Path) -> Result<Vec<u8>> {
    if !super::account::manage_devin_account("status")
        .await?
        .logged_in
    {
        return Err(anyhow!("Devin account is not logged in"));
    }
    let mut command = Command::new(executable);
    command
        .arg("models")
        .arg("list")
        .arg("--format")
        .arg("json")
        .env_remove("WINDSURF_API_KEY")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.as_std_mut().creation_flags(0x0800_0000);
    }

    let mut child = command
        .spawn()
        .with_context(|| format!("failed to start Devin CLI at {}", executable.display()))?;
    let stdout = child
        .stdout
        .take()
        .context("Devin CLI stdout was not piped")?;
    let read_stdout = async move {
        let mut bytes = Vec::new();
        stdout
            .take((MAX_CATALOG_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .await?;
        Ok::<_, std::io::Error>(bytes)
    };
    let completed = timeout(CLI_TIMEOUT, async {
        let (bytes, status) = tokio::try_join!(read_stdout, child.wait())?;
        Ok::<_, std::io::Error>((bytes, status))
    })
    .await;

    let (bytes, status) = match completed {
        Ok(Ok(completed)) => completed,
        Ok(Err(error)) => return Err(error).context("failed to read Devin model catalog"),
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(anyhow!("Devin model catalog command timed out"));
        }
    };
    if !status.success() {
        return Err(anyhow!("Devin model catalog command failed with {status}"));
    }
    if bytes.len() > MAX_CATALOG_BYTES {
        return Err(anyhow!("Devin model catalog exceeds size limit"));
    }
    Ok(bytes)
}

fn persist_snapshot(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("Devin model catalog has no parent")?;
    std::fs::create_dir_all(parent)
        .with_context(|| format!("failed to create {}", parent.display()))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .context("failed to create temporary Devin model catalog")?;
    temporary
        .write_all(bytes)
        .context("failed to write temporary Devin model catalog")?;
    temporary
        .as_file_mut()
        .sync_all()
        .context("failed to flush temporary Devin model catalog")?;
    temporary
        .persist(path)
        .map_err(|error| error.error)
        .context("failed to replace Devin model catalog")?;
    Ok(())
}

#[cfg(test)]
#[path = "catalog_tests.rs"]
mod tests;

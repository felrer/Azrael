use std::sync::Arc;

use codex_core::config::Config;
use codex_extension_api::ConfigContributor;
use codex_extension_api::ExtensionData;
use codex_extension_api::ExtensionFuture;
use codex_extension_api::ExtensionRegistryBuilder;
use codex_extension_api::ThreadLifecycleContributor;
use codex_extension_api::ThreadOriginator;
use codex_extension_api::ThreadStartInput;
use codex_extension_api::ToolCall;
use codex_extension_api::ToolContributor;
use codex_extension_api::ToolExecutor;
use codex_login::AuthManager;
use codex_login::AzraelServiceAccountStore;
use codex_utils_absolute_path::AbsolutePathBuf;

use crate::backend::CodexImagesBackend;
use crate::tool::ImageGenerationTool;

#[derive(Clone)]
struct ImageGenerationExtension {
    auth_manager: Arc<AuthManager>,
    resolve_save_root: Arc<SaveRootResolver>,
}

type SaveRootResolver = dyn Fn(&Config) -> Option<AbsolutePathBuf> + Send + Sync;

#[derive(Clone)]
struct ImageGenerationExtensionConfig {
    config: Arc<Config>,
    save_root: Option<AbsolutePathBuf>,
}

impl ImageGenerationExtensionConfig {
    /// Resolves the image provider and save root for a thread.
    fn from_config(config: &Config, resolve_save_root: &SaveRootResolver) -> Self {
        Self {
            config: Arc::new(config.clone()),
            save_root: resolve_save_root(config),
        }
    }
}

impl ThreadLifecycleContributor<Config> for ImageGenerationExtension {
    /// Seeds image-generation configuration when a thread begins.
    fn on_thread_start<'a>(
        &'a self,
        input: ThreadStartInput<'a, Config>,
    ) -> ExtensionFuture<'a, ()> {
        Box::pin(async move {
            input
                .thread_store
                .insert(ImageGenerationExtensionConfig::from_config(
                    input.config,
                    self.resolve_save_root.as_ref(),
                ));
        })
    }
}

impl ConfigContributor<Config> for ImageGenerationExtension {
    /// Refreshes image-generation configuration after thread configuration changes.
    fn on_config_changed(
        &self,
        _session_store: &ExtensionData,
        thread_store: &ExtensionData,
        _previous_config: &Config,
        new_config: &Config,
    ) {
        thread_store.insert(ImageGenerationExtensionConfig::from_config(
            new_config,
            self.resolve_save_root.as_ref(),
        ));
    }
}

impl ToolContributor for ImageGenerationExtension {
    /// Creates the image-generation tool exposed by this installed extension.
    fn tools(
        &self,
        _session_store: &ExtensionData,
        thread_store: &ExtensionData,
    ) -> Vec<Arc<dyn for<'call> ToolExecutor<ToolCall<'call>>>> {
        let Some(config) = thread_store.get::<ImageGenerationExtensionConfig>() else {
            return Vec::new();
        };
        if !AzraelServiceAccountStore::new(config.config.codex_home.as_path())
            .selected_profile_info()
            .is_ok_and(|profile| {
                profile.is_some_and(|profile| profile.plan_type.as_deref() != Some("free"))
            })
        {
            return Vec::new();
        }

        vec![Arc::new(ImageGenerationTool::new(
            CodexImagesBackend::new(
                Arc::clone(&config.config),
                Arc::clone(&self.auth_manager),
                thread_store
                    .get::<ThreadOriginator>()
                    .map(|originator| originator.0.clone()),
            ),
            config.save_root.clone(),
            thread_store.level_id().to_string(),
        ))]
    }
}

/// Installs the standalone image-generation extension contributors.
pub fn install(
    registry: &mut ExtensionRegistryBuilder<Config>,
    auth_manager: Arc<AuthManager>,
    resolve_save_root: impl Fn(&Config) -> Option<AbsolutePathBuf> + Send + Sync + 'static,
) {
    let extension = Arc::new(ImageGenerationExtension {
        auth_manager,
        resolve_save_root: Arc::new(resolve_save_root),
    });
    registry.thread_lifecycle_contributor(extension.clone());
    registry.config_contributor(extension.clone());
    registry.tool_contributor(extension);
}

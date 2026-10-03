//! Opt-in Devin execution alongside the native OpenAI provider.

pub(crate) mod account;
pub(crate) mod catalog;
pub(crate) mod native_runtime;
pub(crate) mod runtime;

use crate::config::Config;
use codex_model_provider_info::ModelProviderInfo;
use std::io;
use std::path::Path;

pub(crate) const PROVIDER_ID: &str = "devin";

pub(crate) fn managed_catalog(codex_home: &Path, path: &Path) -> bool {
    // The UI marker must not freeze native refresh when Devin is later disabled.
    path == codex_home.join("azrael/devin/catalog.json")
}

pub(crate) fn provider_info() -> ModelProviderInfo {
    let native = native_runtime::enabled();
    ModelProviderInfo {
        name: if native {
            "Devin native tools"
        } else {
            "Devin ACP"
        }
        .to_string(),
        // Local runtime selection, never an OpenAI fallback endpoint.
        base_url: Some(
            if native {
                "devin://native"
            } else {
                "devin://acp"
            }
            .to_string(),
        ),
        request_max_retries: Some(0),
        stream_max_retries: Some(0),
        ..Default::default()
    }
}

pub(crate) fn select_model(config: &mut Config, model: &str) -> io::Result<()> {
    if crate::managed_catalog::is_managed(model) {
        crate::managed_catalog::resolve(config.codex_home.as_path(), model)
            .map_err(|err| io::Error::new(io::ErrorKind::InvalidInput, err.to_string()))?;
        activate_helper_provider(
            config,
            crate::managed_catalog::PROVIDER_ID,
            crate::managed_catalog::provider_info(),
        );
    } else if catalog::is_devin(model) {
        catalog::resolve(config.codex_home.as_path(), model, None)
            .map_err(|err| io::Error::new(io::ErrorKind::InvalidInput, err.to_string()))?;
        activate_helper_provider(config, PROVIDER_ID, provider_info());
    } else if matches!(
        config.model_provider_id.as_str(),
        PROVIDER_ID | crate::managed_catalog::PROVIDER_ID
    ) {
        let (provider_id, provider) = config.native_model_provider.clone().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "original native provider is unavailable",
            )
        })?;
        config.model_provider_id = provider_id;
        config.model_provider = provider;
    }
    config.model = Some(model.to_string());
    Ok(())
}

fn activate_helper_provider(config: &mut Config, provider_id: &str, provider: ModelProviderInfo) {
    if !matches!(
        config.model_provider_id.as_str(),
        PROVIDER_ID | crate::managed_catalog::PROVIDER_ID
    ) {
        config.native_model_provider = Some((
            config.model_provider_id.clone(),
            config.model_provider.clone(),
        ));
    }
    config.model_provider_id = provider_id.to_string();
    config.model_provider = provider;
}

#[cfg(test)]
#[path = "selection_tests.rs"]
mod tests;

use codex_api::ImageEditRequest;
use codex_api::ImageGenerationRequest;
use codex_api::ImageRequestError;
use codex_api::ImageResponse;
use codex_api::ImagesClient;
use codex_api::ReqwestTransport;
use codex_api::map_api_error;
use codex_core::config::Config;
use codex_http_client::ClientRouteClass;
use codex_login::AuthManager;
use codex_login::AzraelServiceAccountBinding;
use codex_login::AzraelServiceAccountStore;
use codex_login::default_client::add_originator_header;
use codex_login::default_client::create_transport_for_routes_async;
use codex_model_provider::create_model_provider;
use codex_model_provider_info::ModelProviderInfo;
use codex_protocol::account::PlanType;
use codex_protocol::error::CodexErr;
use http::HeaderMap;
use http::HeaderValue;
use std::sync::Arc;

const X_CODEX_IMAGE_TURN_ID_HEADER: &str = "x-codex-image-turn-id";

pub(crate) struct ImageBackendError {
    message: String,
    codex_error: CodexErr,
    imagegen_request_id: Option<String>,
}

impl ImageBackendError {
    fn from_image_request(error: ImageRequestError) -> Self {
        let (error, imagegen_request_id) = error.into_parts();
        let message = error.to_string();
        Self {
            message,
            codex_error: map_api_error(error),
            imagegen_request_id,
        }
    }

    fn from_message(message: String) -> Self {
        Self {
            codex_error: CodexErr::Stream(message.clone()),
            message,
            imagegen_request_id: None,
        }
    }

    pub(crate) fn message(&self) -> &str {
        &self.message
    }

    pub(crate) fn codex_error(&self) -> &CodexErr {
        &self.codex_error
    }

    pub(crate) fn imagegen_request_id(&self) -> Option<&str> {
        self.imagegen_request_id.as_deref()
    }
}

#[derive(Clone)]
pub(crate) struct CodexImagesBackend {
    config: Arc<Config>,
    auth_manager: Arc<AuthManager>,
    originator: Option<String>,
}

impl CodexImagesBackend {
    /// Creates a backend that resolves the independent service account per request.
    pub(crate) fn new(
        config: Arc<Config>,
        auth_manager: Arc<AuthManager>,
        originator: Option<String>,
    ) -> Self {
        Self {
            config,
            auth_manager,
            originator,
        }
    }

    /// Resolves the provider and auth required for the current image API request.
    async fn client(
        &self,
    ) -> Result<
        (
            ImagesClient<ReqwestTransport>,
            Arc<AzraelServiceAccountBinding>,
        ),
        ImageBackendError,
    > {
        let binding = Arc::new(
            AzraelServiceAccountStore::new(self.config.codex_home.as_path())
                .resolve(&self.auth_manager)
                .await
                .map_err(|err| ImageBackendError::from_message(err.to_string()))?,
        );
        let mut config = self.config.as_ref().clone();
        config.model_provider_id = "openai".to_string();
        config.model_provider = ModelProviderInfo::create_openai_provider(None);
        config.azrael_service_account = Some(Arc::clone(&binding));
        let config = config
            .for_openai_service(binding.manager())
            .await
            .map_err(|err| ImageBackendError::from_message(err.to_string()))?;
        if config.model_provider_id != "openai"
            || config.model_provider != ModelProviderInfo::create_openai_provider(None)
            || !config
                .features
                .get()
                .enabled_features()
                .iter()
                .any(|feature| feature.key() == "image_generation")
        {
            return Err(ImageBackendError::from_message(
                "service policy does not permit the built-in OpenAI image executor".to_string(),
            ));
        }
        ensure_image_generation_plan(
            binding
                .manager()
                .auth_cached()
                .and_then(|auth| auth.account_plan_type()),
        )?;
        let model_provider =
            create_model_provider(config.model_provider.clone(), Some(binding.manager()));
        let provider = model_provider
            .api_provider()
            .await
            .map_err(|err| ImageBackendError::from_message(err.to_string()))?;
        let auth = model_provider
            .api_auth()
            .await
            .map_err(|err| ImageBackendError::from_message(err.to_string()))?;
        let transport =
            create_transport_for_routes_async(config.http_client_factory(), ClientRouteClass::Api)
                .await
                .map_err(|err| ImageBackendError::from_message(err.to_string()))?;
        Ok((ImagesClient::new(transport, provider, auth), binding))
    }

    /// Sends a standalone image generation request through the configured Images client.
    pub(crate) async fn generate(
        &self,
        request: ImageGenerationRequest,
        turn_id: &str,
    ) -> Result<(ImageResponse, Option<String>), ImageBackendError> {
        let (client, _binding) = self.client().await?;
        client
            .generate(
                &request,
                image_request_headers(self.originator.as_deref(), turn_id),
            )
            .await
            .map_err(ImageBackendError::from_image_request)
    }

    /// Sends a standalone image edit request through the configured Images client.
    pub(crate) async fn edit(
        &self,
        request: ImageEditRequest,
        turn_id: &str,
    ) -> Result<(ImageResponse, Option<String>), ImageBackendError> {
        let (client, _binding) = self.client().await?;
        client
            .edit(
                &request,
                image_request_headers(self.originator.as_deref(), turn_id),
            )
            .await
            .map_err(ImageBackendError::from_image_request)
    }
}

fn ensure_image_generation_plan(plan: Option<PlanType>) -> Result<(), ImageBackendError> {
    if plan == Some(PlanType::Free) {
        return Err(ImageBackendError::from_message(
            "image generation is unavailable for the selected service account plan".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod service_plan_tests {
    use super::ensure_image_generation_plan;
    use codex_protocol::account::PlanType;

    #[test]
    fn selected_service_plan_preserves_image_generation_restriction() {
        assert!(ensure_image_generation_plan(Some(PlanType::Free)).is_err());
        assert!(ensure_image_generation_plan(Some(PlanType::Team)).is_ok());
        assert!(ensure_image_generation_plan(None).is_ok());
    }
}

fn image_request_headers(originator: Option<&str>, turn_id: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    if let Ok(turn_id) = HeaderValue::from_str(turn_id) {
        headers.insert(X_CODEX_IMAGE_TURN_ID_HEADER, turn_id);
    }
    if let Some(originator) = originator {
        add_originator_header(&mut headers, originator);
    }
    headers
}

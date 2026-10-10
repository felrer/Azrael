use std::sync::Arc;
use std::time::Duration;

use codex_api::Reasoning;
use codex_api::ReqwestTransport;
use codex_api::ResponseEvent;
use codex_api::ResponsesApiRequest;
use codex_api::ResponsesClient;
use codex_api::ResponsesOptions;
use codex_http_client::ClientRouteClass;
use codex_login::AzraelProfileAuth;
use codex_login::default_client::ClientRedirectPolicy;
use codex_login::default_client::create_client_for_route_async;
use codex_model_provider::auth_provider_from_auth_manager;
use codex_model_provider_info::ModelProviderInfo;
use codex_protocol::models::ContentItem;
use codex_protocol::models::ResponseItem;
use codex_protocol::openai_models::ReasoningEffort;
use futures::StreamExt;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const IDENTITY_ERROR: &str = "Usage window account identity is unavailable or changed";
const CONNECTION_ERROR: &str = "Usage window network policy or connection is unavailable";
const REQUEST_ERROR: &str = "Usage window request failed; outcome uncertain";
const TIMEOUT_ERROR: &str = "Usage window request timed out; outcome uncertain";

pub(super) async fn start_window(
    profile: Arc<AzraelProfileAuth>,
    model: String,
) -> Result<(), String> {
    tokio::time::timeout(REQUEST_TIMEOUT, async move {
        let info = profile.info().map_err(|_| IDENTITY_ERROR.to_owned())?;
        let manager = profile.manager();
        let (auth, factory) = manager
            .auth_with_http_client_factory()
            .await
            .ok_or_else(|| IDENTITY_ERROR.to_owned())?;
        if !auth.is_chatgpt_auth()
            || auth.get_account_id().as_deref() != Some(info.workspace_account_id.as_str())
            || auth.get_chatgpt_user_id().as_deref() != Some(info.user_id.as_str())
        {
            return Err(IDENTITY_ERROR.to_owned());
        }

        let mut provider = ModelProviderInfo::create_openai_provider(None)
            .to_api_provider(Some(auth.api_auth_mode()))
            .map_err(|_| CONNECTION_ERROR.to_owned())?;
        // An uncertain inference outcome must never trigger another request.
        provider.retry.max_attempts = 1;
        provider.retry.retry_429 = false;
        provider.retry.retry_5xx = false;
        provider.retry.retry_transport = false;
        let http_client = create_client_for_route_async(
            factory,
            provider.url_for_path("/responses"),
            ClientRouteClass::Api,
            ClientRedirectPolicy::Reject,
        )
        .await
        .map_err(|_| CONNECTION_ERROR.to_owned())?;
        let client = ResponsesClient::new(
            ReqwestTransport::from_http_client(http_client),
            provider,
            auth_provider_from_auth_manager(manager, &auth),
        );
        let request = ResponsesApiRequest {
            model,
            input: vec![ResponseItem::Message {
                id: None,
                role: "user".to_owned(),
                content: vec![ContentItem::InputText {
                    text: "Reply with exactly OK.".to_owned(),
                }],
                phase: None,
                internal_chat_message_metadata_passthrough: None,
            }],
            tools: None,
            tool_choice: "none".to_owned(),
            parallel_tool_calls: false,
            reasoning: Some(Reasoning {
                effort: Some(ReasoningEffort::Low),
                summary: None,
                context: None,
            }),
            store: false,
            stream: true,
            stream_options: None,
            include: Vec::new(),
            service_tier: None,
            prompt_cache_key: None,
            text: None,
            client_metadata: None,
            access_programs: None,
        };
        let mut stream = client
            .stream_request(request, ResponsesOptions::default())
            .await
            .map_err(|_| REQUEST_ERROR.to_owned())?;
        while let Some(event) = stream.next().await {
            match event {
                Ok(ResponseEvent::Completed { .. }) => {
                    // Keep the selected profile and auth snapshot alive through completion.
                    drop(auth);
                    drop(profile);
                    return Ok(());
                }
                Ok(_) => {}
                Err(_) => return Err(REQUEST_ERROR.to_owned()),
            }
        }
        Err(REQUEST_ERROR.to_owned())
    })
    .await
    .map_err(|_| TIMEOUT_ERROR.to_owned())?
}

use codex_api::SearchClient;
use codex_api::SearchCommands;
use codex_api::SearchQuery;
use codex_api::SearchRequest;
use codex_core::X_CODEX_TURN_METADATA_HEADER;
use codex_core::config::Config;
use codex_core::web_search_action_detail;
use codex_extension_api::ExtensionTurnItem;
use codex_extension_api::FunctionCallError;
use codex_extension_api::ResponsesApiTool;
use codex_extension_api::ToolCall;
use codex_extension_api::ToolExecutor;
use codex_extension_api::ToolName;
use codex_extension_api::ToolOutput;
use codex_extension_api::ToolSpec;
use codex_extension_api::parse_tool_input_schema_without_compaction;
use codex_extension_items::ExtensionItem;
use codex_extension_items::web_search::WebSearchAction;
use codex_extension_items::web_search::WebSearchItem;
use codex_http_client::ClientRouteClass;
use codex_login::AuthManager;
use codex_login::AzraelServiceAccountStore;
use codex_login::default_client::add_originator_header;
use codex_login::default_client::create_transport_for_routes_async;
use codex_model_provider::create_model_provider;
use codex_model_provider_info::ModelProviderInfo;
use codex_protocol::models::WebSearchAction as CoreWebSearchAction;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::WebSearchBeginEvent;
use codex_protocol::protocol::WebSearchEndEvent;
use codex_tools::ResponsesApiNamespace;
use codex_tools::ResponsesApiNamespaceTool;
use codex_tools::ToolExposure;
use codex_tools::default_namespace_description;
use http::HeaderMap;
use http::HeaderValue;
use std::sync::Arc;
use url::Url;

use crate::extension::search_settings;
use crate::extension::uses_provider_search;
use crate::history::recent_input;
use crate::output::SearchOutput;
use crate::schema::commands_schema;

pub(crate) const WEB_NAMESPACE: &str = "web";
pub(crate) const RUN_TOOL_NAME: &str = "run";
const WEB_RUN_DESCRIPTION: &str = include_str!("../web_run_description.md");
const RESULTS_PAYLOAD_BYTES_METRIC: &str = "codex.web_search.results.payload_bytes";

pub(crate) struct WebSearchTool {
    pub(crate) session_id: String,
    pub(crate) config: Arc<Config>,
    pub(crate) auth_manager: Arc<AuthManager>,
    pub(crate) originator: Option<String>,
}

impl<'call> ToolExecutor<ToolCall<'call>> for WebSearchTool {
    fn tool_name(&self) -> ToolName {
        ToolName::namespaced(WEB_NAMESPACE, RUN_TOOL_NAME)
    }

    fn spec(&self) -> ToolSpec {
        // parse schema without compaction that removes field metadata/descriptions to match hosted tool definition
        let parameters = match parse_tool_input_schema_without_compaction(&commands_schema()) {
            Ok(parameters) => parameters,
            Err(err) => panic!("search command schema should parse: {err}"),
        };

        ToolSpec::Namespace(ResponsesApiNamespace {
            name: WEB_NAMESPACE.to_string(),
            description: default_namespace_description(WEB_NAMESPACE),
            tools: vec![ResponsesApiNamespaceTool::Function(ResponsesApiTool {
                name: RUN_TOOL_NAME.to_string(),
                description: WEB_RUN_DESCRIPTION.to_string(),
                strict: false,
                parameters,
                output_schema: None,
                defer_loading: None,
            })],
        })
    }

    fn exposure(&self) -> ToolExposure {
        ToolExposure::Direct
    }

    fn supports_parallel_tool_calls(&self) -> bool {
        true
    }

    fn handle<'a>(&'a self, call: ToolCall<'call>) -> codex_extension_api::ToolExecutorFuture<'a>
    where
        'call: 'a,
    {
        Box::pin(self.handle_call(call))
    }
}

impl WebSearchTool {
    async fn handle_call(
        &self,
        call: ToolCall<'_>,
    ) -> Result<Box<dyn ToolOutput>, FunctionCallError> {
        let commands = parse_commands(&call)?;
        let command_action = command_action(&commands);
        let mut request_config = self.config.as_ref().clone();
        let (model_provider, model) = if uses_provider_search(&request_config.model_provider) {
            (
                create_model_provider(
                    request_config.model_provider.clone(),
                    Some(Arc::clone(&self.auth_manager)),
                ),
                call.model.clone(),
            )
        } else {
            let binding = Arc::new(
                AzraelServiceAccountStore::new(request_config.codex_home.as_path())
                    .resolve(&self.auth_manager)
                    .await
                    .map_err(|err| FunctionCallError::RespondToModel(err.to_string()))?,
            );
            request_config.model_provider_id = "openai".to_string();
            request_config.model_provider = ModelProviderInfo::create_openai_provider(None);
            request_config.azrael_service_account = Some(Arc::clone(&binding));
            request_config = request_config
                .for_openai_service(binding.manager())
                .await
                .map_err(|err| FunctionCallError::RespondToModel(err.to_string()))?;
            if request_config.model_provider != ModelProviderInfo::create_openai_provider(None)
                || request_config.model_provider_id != "openai"
            {
                return Err(FunctionCallError::RespondToModel(
                    "service policy does not permit the built-in OpenAI web executor".to_string(),
                ));
            }
            let provider = create_model_provider(
                request_config.model_provider.clone(),
                Some(binding.manager()),
            );
            let models = provider
                .models_manager_without_cache(None)
                .try_list_models()
                .map_err(|err| FunctionCallError::RespondToModel(err.to_string()))?;
            let model = models
                .iter()
                .find(|model| model.is_default)
                .or_else(|| models.first())
                .map(|model| model.model.clone())
                .filter(|model| !model.is_empty())
                .ok_or_else(|| {
                    FunctionCallError::RespondToModel(
                        "OpenAI web service has no available default model".to_string(),
                    )
                })?;
            (provider, model)
        };
        let web_search_mode = request_config.web_search_mode.value();
        if web_search_mode == codex_protocol::config_types::WebSearchMode::Disabled {
            return Err(FunctionCallError::RespondToModel(
                "web search is disabled".to_string(),
            ));
        }
        let provider = model_provider
            .api_provider()
            .await
            .map_err(|err| FunctionCallError::Fatal(err.to_string()))?;
        let auth = model_provider
            .api_auth()
            .await
            .map_err(|err| FunctionCallError::Fatal(err.to_string()))?;
        let transport = create_transport_for_routes_async(
            request_config.http_client_factory(),
            ClientRouteClass::Api,
        )
        .await
        .map_err(|err| FunctionCallError::Fatal(err.to_string()))?;
        let client = SearchClient::new(transport, provider, auth);
        let request = SearchRequest {
            id: self.session_id.clone(),
            model,
            reasoning: None,
            input: recent_input(call.conversation_history.items()),
            commands: Some(commands),
            settings: Some(search_settings(&request_config, web_search_mode)),
            max_output_tokens: Some(
                u64::try_from(call.truncation_policy.token_budget()).unwrap_or(u64::MAX),
            ),
        };
        let extra_headers = search_request_headers(
            self.originator.as_deref(),
            call.codex_turn_metadata.as_deref(),
        );
        call.turn_item_emitter
            .emit_started(extension_turn_item(
                WebSearchItem {
                    id: call.call_id.clone(),
                    query: String::new(),
                    action: None,
                    results: None,
                },
                EventMsg::WebSearchBegin(WebSearchBeginEvent {
                    call_id: call.call_id.clone(),
                }),
            ))
            .await;
        let response = client
            .search(&request, extra_headers)
            .await
            .map_err(|err| FunctionCallError::Fatal(err.to_string()))?;
        let output = response.output;
        let results = response.results;
        if let Some(results) = results.as_ref()
            && let Some(metrics) = codex_otel::global()
            && let Ok(payload) = serde_json::to_vec(results)
        {
            let payload_bytes = i64::try_from(payload.len()).unwrap_or(i64::MAX);
            let _ = metrics.histogram(RESULTS_PAYLOAD_BYTES_METRIC, payload_bytes, &[]);
        }
        let legacy_action = match &command_action {
            WebSearchAction::Search { query, queries } => CoreWebSearchAction::Search {
                query: query.clone(),
                queries: queries.clone(),
            },
            WebSearchAction::OpenPage { url } => CoreWebSearchAction::OpenPage { url: url.clone() },
            WebSearchAction::FindInPage { url, pattern } => CoreWebSearchAction::FindInPage {
                url: url.clone(),
                pattern: pattern.clone(),
            },
            WebSearchAction::Other => CoreWebSearchAction::Other,
        };
        let query = web_search_action_detail(&legacy_action);
        call.turn_item_emitter
            .emit_completed(extension_turn_item(
                WebSearchItem {
                    id: call.call_id.clone(),
                    query: query.clone(),
                    action: Some(command_action),
                    results: results.clone(),
                },
                EventMsg::WebSearchEnd(WebSearchEndEvent {
                    call_id: call.call_id.clone(),
                    query,
                    action: legacy_action,
                    results,
                }),
            ))
            .await;

        Ok(Box::new(SearchOutput::new(output)))
    }
}

fn search_request_headers(originator: Option<&str>, turn_metadata: Option<&str>) -> HeaderMap {
    let mut headers = HeaderMap::new();
    if let Some(turn_metadata) = turn_metadata
        && let Ok(header_value) = HeaderValue::from_str(turn_metadata)
    {
        headers.insert(X_CODEX_TURN_METADATA_HEADER, header_value);
    }

    if let Some(originator) = originator {
        add_originator_header(&mut headers, originator);
    }
    headers
}

fn parse_commands(call: &ToolCall<'_>) -> Result<SearchCommands, FunctionCallError> {
    let arguments = call.function_arguments()?;
    if arguments.trim().is_empty() {
        return Ok(SearchCommands::default());
    }

    serde_json::from_str(arguments)
        .map_err(|err| FunctionCallError::RespondToModel(err.to_string()))
}

fn command_action(commands: &SearchCommands) -> WebSearchAction {
    commands
        .search_query
        .as_deref()
        .and_then(query_action)
        .or_else(|| commands.image_query.as_deref().and_then(query_action))
        .or_else(|| {
            commands
                .open
                .as_deref()
                .and_then(|operations| operations.first())
                .and_then(|operation| {
                    literal_url(&operation.ref_id)
                        .map(|url| WebSearchAction::OpenPage { url: Some(url) })
                })
        })
        .or_else(|| {
            commands
                .find
                .as_deref()
                .and_then(|operations| operations.first())
                .map(|operation| WebSearchAction::FindInPage {
                    url: literal_url(&operation.ref_id),
                    pattern: Some(operation.pattern.clone()),
                })
        })
        .unwrap_or(WebSearchAction::Other)
}

fn query_action(queries: &[SearchQuery]) -> Option<WebSearchAction> {
    match queries {
        [] => None,
        [query] => Some(WebSearchAction::Search {
            query: Some(query.q.clone()),
            queries: None,
        }),
        queries => Some(WebSearchAction::Search {
            query: None,
            queries: Some(queries.iter().map(|query| query.q.clone()).collect()),
        }),
    }
}

fn literal_url(ref_id: &str) -> Option<String> {
    Url::parse(ref_id).is_ok().then(|| ref_id.to_string())
}

fn extension_turn_item(item: WebSearchItem, legacy_event: EventMsg) -> ExtensionTurnItem {
    ExtensionTurnItem {
        item: ExtensionItem::WebSearch(item),
        legacy_events: vec![legacy_event],
    }
}

#[cfg(test)]
mod tests {
    use codex_api::SearchCommands;
    use codex_extension_items::web_search::WebSearchAction;
    use pretty_assertions::assert_eq;

    use super::command_action;
    use super::search_request_headers;
    use codex_core::X_CODEX_TURN_METADATA_HEADER;

    #[test]
    fn search_request_headers_forward_thread_originator_and_turn_metadata() {
        let headers = search_request_headers(Some("chatgpt_cca"), Some("turn-metadata"));
        assert_eq!(
            headers
                .get("originator")
                .and_then(|value| value.to_str().ok()),
            Some("chatgpt_cca")
        );
        assert_eq!(
            headers
                .get(X_CODEX_TURN_METADATA_HEADER)
                .and_then(|value| value.to_str().ok()),
            Some("turn-metadata")
        );
    }

    #[test]
    fn command_action_reports_queries_and_navigation_detail() {
        let cases = [
            (
                r#"{"image_query":[{"q":"waterfalls"},{"q":"mountains"}]}"#,
                WebSearchAction::Search {
                    query: None,
                    queries: Some(vec!["waterfalls".to_string(), "mountains".to_string()]),
                },
            ),
            (
                r#"{"open":[{"ref_id":"https://example.com/docs"}]}"#,
                WebSearchAction::OpenPage {
                    url: Some("https://example.com/docs".to_string()),
                },
            ),
            (
                r#"{"find":[{"ref_id":"https://example.com/docs","pattern":"install"}]}"#,
                WebSearchAction::FindInPage {
                    url: Some("https://example.com/docs".to_string()),
                    pattern: Some("install".to_string()),
                },
            ),
            (
                r#"{"find":[{"ref_id":"turn0search0","pattern":"install"}]}"#,
                WebSearchAction::FindInPage {
                    url: None,
                    pattern: Some("install".to_string()),
                },
            ),
            (
                r#"{"open":[{"ref_id":"turn0search0"}]}"#,
                WebSearchAction::Other,
            ),
        ];

        for (arguments, expected) in cases {
            let commands: SearchCommands =
                serde_json::from_str(arguments).expect("valid search command arguments");
            assert_eq!(command_action(&commands), expected);
        }
    }
}

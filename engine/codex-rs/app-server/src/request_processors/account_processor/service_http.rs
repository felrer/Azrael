//! Execute host HTTP services under native application network policy.
//! One request owns its profile lease and no mutation is retried here.
use super::*;
use crate::connection_rpc_gate::ConnectionRpcGate;
use crate::outgoing_message::RequestContext;
use crate::transport::ConnectionId;
use base64::Engine;
use codex_app_server_protocol::AzraelServiceHttpParams;
use codex_app_server_protocol::AzraelServiceHttpResponse;
use codex_http_client::ClientRouteClass;
use codex_login::AzraelServiceAccountBinding;
use std::collections::BTreeMap;
use std::collections::HashMap;

const MAX_SERVICE_REQUESTS_PER_CONNECTION: usize = 65_536;

#[derive(Default)]
pub(super) struct ServiceHttpRequests {
    connections: std::sync::Mutex<HashMap<ConnectionId, HashMap<String, ServiceRequest>>>,
}

struct ServiceRequest {
    cancellation: CancellationToken,
    binding: Option<Arc<AzraelServiceAccountBinding>>,
    ended: bool,
    busy: bool,
    attempts: HttpAttempts,
}

#[derive(Default)]
struct HttpAttempts {
    count: u8,
    refresh_allowed: bool,
    http_allowed: bool,
}

impl HttpAttempts {
    fn begin_http(&mut self) -> Result<(), JSONRPCErrorError> {
        if !self.http_allowed || self.count >= 2 {
            return Err(invalid_request("Service HTTP request must not be replayed"));
        }
        self.http_allowed = false;
        self.count += 1;
        Ok(())
    }

    fn received_response(&mut self, status: u16) {
        self.refresh_allowed = status == 401 && self.count == 1;
    }

    fn begin_refresh(&mut self) -> Result<(), JSONRPCErrorError> {
        if !self.refresh_allowed {
            return Err(invalid_request(
                "Service authentication refresh is not available",
            ));
        }
        self.refresh_allowed = false;
        Ok(())
    }

    fn refreshed(&mut self) {
        self.http_allowed = self.count == 1;
    }
}

#[derive(Clone, Copy)]
pub(super) enum ServiceRequestOperation {
    Http,
    Refresh,
}

pub(super) struct ServiceRequestGuard {
    owner: Arc<ServiceHttpRequests>,
    connection_id: ConnectionId,
    request_id: String,
    pub(super) cancellation: CancellationToken,
    caller_cancellation: CancellationToken,
    pub(super) binding: Option<Arc<AzraelServiceAccountBinding>>,
    initializing: bool,
}

fn validate_request_id(request_id: &str) -> Result<(), JSONRPCErrorError> {
    if request_id.is_empty() || request_id.len() > 128 || !request_id.is_ascii() {
        return Err(invalid_params("Invalid service request identifier"));
    }
    Ok(())
}

impl ServiceHttpRequests {
    pub(super) fn begin(
        self: &Arc<Self>,
        connection_id: ConnectionId,
        request_id: &str,
        gate: &ConnectionRpcGate,
        caller_cancellation: CancellationToken,
    ) -> Result<ServiceRequestGuard, JSONRPCErrorError> {
        validate_request_id(request_id)?;
        let mut connections = self
            .connections
            .lock()
            .map_err(|_| internal_error("Service request registry is unavailable"))?;
        if gate.is_closed() {
            return Err(invalid_request("Service connection is closed"));
        }
        let requests = connections.entry(connection_id).or_default();
        if requests.contains_key(request_id) {
            return Err(invalid_request(
                "Service request identifier was already used",
            ));
        }
        if requests.len() >= MAX_SERVICE_REQUESTS_PER_CONNECTION {
            return Err(invalid_request(
                "Service request limit reached; reconnect before starting a new request",
            ));
        }
        let cancellation = caller_cancellation.child_token();
        requests.insert(
            request_id.to_owned(),
            ServiceRequest {
                cancellation: cancellation.clone(),
                binding: None,
                ended: false,
                busy: true,
                attempts: HttpAttempts::default(),
            },
        );
        Ok(ServiceRequestGuard {
            owner: Arc::clone(self),
            connection_id,
            request_id: request_id.to_owned(),
            cancellation,
            caller_cancellation,
            binding: None,
            initializing: true,
        })
    }

    pub(super) fn checkout(
        self: &Arc<Self>,
        connection_id: ConnectionId,
        request_id: &str,
        gate: &ConnectionRpcGate,
        caller_cancellation: CancellationToken,
        operation: ServiceRequestOperation,
    ) -> Result<ServiceRequestGuard, JSONRPCErrorError> {
        validate_request_id(request_id)?;
        let mut connections = self
            .connections
            .lock()
            .map_err(|_| internal_error("Service request registry is unavailable"))?;
        if gate.is_closed() {
            return Err(invalid_request("Service connection is closed"));
        }
        let entry = connections
            .get_mut(&connection_id)
            .and_then(|requests| requests.get_mut(request_id))
            .ok_or_else(|| invalid_request("Service request lease is unavailable"))?;
        if entry.ended || entry.cancellation.is_cancelled() || entry.busy {
            return Err(invalid_request("Service request lease is ended or busy"));
        }
        let binding = entry
            .binding
            .clone()
            .ok_or_else(|| invalid_request("Service request lease is not initialized"))?;
        match operation {
            ServiceRequestOperation::Http => entry.attempts.begin_http()?,
            ServiceRequestOperation::Refresh => entry.attempts.begin_refresh()?,
        }
        entry.busy = true;
        Ok(ServiceRequestGuard {
            owner: Arc::clone(self),
            connection_id,
            request_id: request_id.to_owned(),
            cancellation: entry.cancellation.clone(),
            caller_cancellation,
            binding: Some(binding),
            initializing: false,
        })
    }

    pub(super) fn end(
        &self,
        connection_id: ConnectionId,
        request_id: &str,
        gate: &ConnectionRpcGate,
    ) -> Result<(), JSONRPCErrorError> {
        validate_request_id(request_id)?;
        let mut connections = self
            .connections
            .lock()
            .map_err(|_| internal_error("Service request registry is unavailable"))?;
        if gate.is_closed() {
            return Err(invalid_request("Service connection is closed"));
        }
        let requests = connections.entry(connection_id).or_default();
        if !requests.contains_key(request_id)
            && requests.len() >= MAX_SERVICE_REQUESTS_PER_CONNECTION
        {
            return Err(invalid_request(
                "Service request limit reached; reconnect before starting a new request",
            ));
        }
        // Keep an ended entry even when cancel/end arrives before the first auth.
        let entry = requests
            .entry(request_id.to_owned())
            .or_insert_with(|| ServiceRequest {
                cancellation: CancellationToken::new(),
                binding: None,
                ended: true,
                busy: false,
                attempts: HttpAttempts::default(),
            });
        entry.cancellation.cancel();
        entry.binding = None;
        entry.ended = true;
        Ok(())
    }

    pub(super) fn connection_closed(&self, connection_id: ConnectionId) {
        let mut connections = self
            .connections
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(requests) = connections.remove(&connection_id) {
            for entry in requests.into_values() {
                entry.cancellation.cancel();
            }
        }
    }
}

impl ServiceRequestGuard {
    pub(super) fn publish_binding(
        &mut self,
        binding: Arc<AzraelServiceAccountBinding>,
    ) -> Result<(), JSONRPCErrorError> {
        let mut connections = self
            .owner
            .connections
            .lock()
            .map_err(|_| internal_error("Service request registry is unavailable"))?;
        let entry = connections
            .get_mut(&self.connection_id)
            .and_then(|requests| requests.get_mut(&self.request_id))
            .ok_or_else(service_cancelled)?;
        if entry.ended || entry.cancellation.is_cancelled() || !self.initializing {
            return Err(service_cancelled());
        }
        entry.binding = Some(binding);
        entry.attempts.http_allowed = true;
        self.initializing = false;
        Ok(())
    }

    fn received_response(&self, status: u16) {
        if let Ok(mut connections) = self.owner.connections.lock()
            && let Some(entry) = connections
                .get_mut(&self.connection_id)
                .and_then(|requests| requests.get_mut(&self.request_id))
        {
            entry.attempts.received_response(status);
        }
    }

    pub(super) fn refreshed(&self) {
        if let Ok(mut connections) = self.owner.connections.lock()
            && let Some(entry) = connections
                .get_mut(&self.connection_id)
                .and_then(|requests| requests.get_mut(&self.request_id))
            && !entry.ended
            && !entry.cancellation.is_cancelled()
        {
            entry.attempts.refreshed();
        }
    }
}

impl Drop for ServiceRequestGuard {
    fn drop(&mut self) {
        let mut connections = self
            .owner
            .connections
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(entry) = connections
            .get_mut(&self.connection_id)
            .and_then(|requests| requests.get_mut(&self.request_id))
        {
            entry.busy = false;
            if self.initializing
                || self.cancellation.is_cancelled()
                || self.caller_cancellation.is_cancelled()
            {
                entry.cancellation.cancel();
                entry.binding = None;
                entry.ended = true;
            }
        }
    }
}

fn service_cancelled() -> JSONRPCErrorError {
    invalid_request("Service request cancelled; delivery may be unknown and was not replayed")
}

pub(super) async fn run_service_request<T>(
    cancellation: &CancellationToken,
    caller_cancellation: &CancellationToken,
    future: impl std::future::Future<Output = Result<T, JSONRPCErrorError>>,
) -> Result<T, JSONRPCErrorError> {
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => Err(service_cancelled()),
        _ = caller_cancellation.cancelled() => Err(service_cancelled()),
        result = future => result,
    }
}

fn service_url_allowed(url: &url::Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none_or(|port| port == 443)
        && (host == "chatgpt.com"
            || host == "openai.com"
            || host.ends_with(".openai.com")
            || host.ends_with(".chatgpt.com") && !host.starts_with("ab."))
}

fn is_service_logout_all(url: &url::Url, method: &http::Method) -> bool {
    method == http::Method::POST
        && service_url_allowed(url)
        && url.host_str() == Some("chatgpt.com")
        && url.path() == "/backend-api/accounts/logout_all"
        && url.query().is_none()
        && url.fragment().is_none()
}

/// Called only after the entire HTTP response body has completed successfully.
/// The observed/stored credential comparison preserves a concurrent new login.
async fn mark_completed_service_logout(
    binding: &AzraelServiceAccountBinding,
    url: &url::Url,
    method: &http::Method,
    status: u16,
    cancellation: &CancellationToken,
    caller_cancellation: &CancellationToken,
) -> Result<bool, JSONRPCErrorError> {
    if !is_service_logout_all(url, method) || !(200..300).contains(&status) {
        return Ok(false);
    }
    if cancellation.is_cancelled() || caller_cancellation.is_cancelled() {
        return Err(service_cancelled());
    }
    binding
        .profile
        .mark_reauthentication_required()
        .await
        .map_err(|_| {
            internal_error(
                "Service logout completed, but its local account state could not be updated; request was not replayed",
            )
        })
}

fn service_header(
    name: &str,
    value: &str,
    token: &str,
    account_id: Option<&str>,
) -> Result<Option<(http::HeaderName, http::HeaderValue)>, JSONRPCErrorError> {
    let header_name = http::HeaderName::from_bytes(name.as_bytes())
        .map_err(|_| invalid_params("Invalid service HTTP header name"))?;
    let header_value = http::HeaderValue::from_str(value)
        .map_err(|_| invalid_params("Invalid service HTTP header value"))?;
    if name.eq_ignore_ascii_case("authorization") {
        if value != format!("Bearer {token}") {
            return Err(invalid_request(
                "Service request authentication does not match its binding",
            ));
        }
        return Ok(None);
    }
    if name.eq_ignore_ascii_case("chatgpt-account-id") {
        if account_id != Some(value) {
            return Err(invalid_request(
                "Service workspace header does not match its binding",
            ));
        }
        return Ok(None);
    }
    if [
        "host",
        "content-length",
        "cookie",
        "connection",
        "transfer-encoding",
    ]
    .iter()
    .any(|blocked| name.eq_ignore_ascii_case(blocked))
    {
        return Ok(None);
    }
    Ok(Some((header_name, header_value)))
}

impl AccountRequestProcessor {
    pub(crate) async fn service_http(
        &self,
        connection_id: ConnectionId,
        gate: &ConnectionRpcGate,
        context: &RequestContext,
        params: AzraelServiceHttpParams,
    ) -> Result<Option<ClientResponsePayload>, JSONRPCErrorError> {
        let guard = self.service_http_requests.checkout(
            connection_id,
            &params.request_id,
            gate,
            context.cancellation.clone(),
            ServiceRequestOperation::Http,
        )?;
        run_service_request(
            &guard.cancellation,
            &context.cancellation,
            self.service_http_bound(params, &guard),
        )
        .await
    }

    pub(crate) fn service_request_end(
        &self,
        connection_id: ConnectionId,
        gate: &ConnectionRpcGate,
        params: codex_app_server_protocol::AzraelServiceRequestEndParams,
    ) -> Result<(), JSONRPCErrorError> {
        self.service_http_requests
            .end(connection_id, &params.request_id, gate)
    }

    pub(crate) fn service_http_connection_closed(&self, connection_id: ConnectionId) {
        self.service_http_requests.connection_closed(connection_id);
    }

    async fn service_http_bound(
        &self,
        params: AzraelServiceHttpParams,
        guard: &ServiceRequestGuard,
    ) -> Result<Option<ClientResponsePayload>, JSONRPCErrorError> {
        if std::env::var_os("AZRAEL_EX_MANAGEMENT_SOCKET").is_none() {
            return Err(invalid_request(
                "OpenAI HTTP services require an Azrael host",
            ));
        }
        let url = url::Url::parse(&params.url)
            .map_err(|_| invalid_params("Invalid OpenAI service URL"))?;
        if !service_url_allowed(&url) {
            return Err(invalid_request("URL is not an OpenAI service destination"));
        }
        let binding = guard
            .binding
            .as_ref()
            .ok_or_else(|| invalid_request("Service request lease is unavailable"))?;
        if binding.selection.profile_id.as_deref() != Some(params.profile_id.as_str())
            || binding.selection.revision != params.revision
        {
            return Err(invalid_request(
                "OpenAI service selection changed before dispatch; request was not replayed",
            ));
        }
        let manager = binding.manager();
        let config = self
            .config
            .for_openai_service(Arc::clone(&manager))
            .await
            .map_err(|_| {
                invalid_request("OpenAI service request is blocked by account or project policy")
            })?;
        let auth = manager
            .auth()
            .await
            .ok_or_else(|| invalid_request("OpenAI service authentication is unavailable"))?;
        if !super::azrael::profile_identity_matches(&binding.profile, Some(&auth)) {
            return Err(invalid_request(
                "OpenAI service authentication identity changed",
            ));
        }
        let token = auth
            .get_token()
            .map_err(|_| invalid_request("OpenAI service token is unavailable"))?;
        if codex_login::token_data::parse_jwt_expiration(&token)
            .map_err(|_| invalid_request("OpenAI service authentication is unavailable"))?
            .is_some_and(|expires_at| expires_at <= chrono::Utc::now())
        {
            return Err(invalid_request(
                "OpenAI service account requires reauthentication",
            ));
        }
        let factory = config.http_client_factory();
        let client = factory
            .build_client_without_request_logging(url.as_str(), ClientRouteClass::Api)
            .map_err(|_| invalid_request("OpenAI service transport could not be prepared"))?;
        let method = http::Method::from_bytes(params.method.as_bytes())
            .map_err(|_| invalid_params("Invalid OpenAI service HTTP method"))?;
        if ["CONNECT", "TRACE", "TRACK"].contains(&method.as_str()) {
            return Err(invalid_params(
                "HTTP method is not allowed by the host fetch contract",
            ));
        }
        let account_id = auth.get_account_id();
        let mut request = client.request(method.clone(), url.as_str());
        for (name, value) in &params.headers {
            if let Some((header_name, header_value)) =
                service_header(name, value, &token, account_id.as_deref())?
            {
                request = request.header(header_name, header_value);
            }
        }
        request = request.bearer_auth(token);
        if let Some(account_id) = account_id {
            let account_id = http::HeaderValue::from_str(&account_id)
                .map_err(|_| invalid_params("Invalid service workspace header value"))?;
            request = request.header("ChatGPT-Account-Id", account_id);
        }
        if let Some(body) = params.body {
            request = request.body(body);
        }
        // The logical request owns this binding across selection changes. Policy,
        // retirement and cancellation still fail through their existing owners.
        if binding
            .profile
            .status()
            .map_err(|_| invalid_request("OpenAI service account is unavailable"))?
            != codex_login::AzraelProfileStatus::Available
        {
            return Err(invalid_request(
                "OpenAI service account requires reauthentication",
            ));
        }
        let mut response = request.send().await.map_err(|_| {
            internal_error(
                "OpenAI service delivery failed or its policy changed; outcome may be unknown",
            )
        })?;
        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                if name.as_str() == "authorization" || name.as_str() == "set-cookie" {
                    return None;
                }
                value
                    .to_str()
                    .ok()
                    .map(|value| (name.as_str().to_string(), value.to_string()))
            })
            .collect::<BTreeMap<_, _>>();
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| {
            internal_error(
                "OpenAI service response could not be completed; request was not replayed",
            )
        })? {
            body.extend_from_slice(&chunk);
        }
        if mark_completed_service_logout(
            binding,
            &url,
            &method,
            status,
            &guard.cancellation,
            &guard.caller_cancellation,
        )
        .await?
        {
            self.send_azrael_update().await;
        }
        guard.received_response(status);
        Ok(Some(
            AzraelServiceHttpResponse {
                status,
                headers,
                body_base64: base64::prelude::BASE64_STANDARD.encode(body),
            }
            .into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn service_logout_all_marks_only_completed_captured_profile_and_preserves_selection() {
        let home = tempfile::tempdir().unwrap();
        let accounts = codex_login::test_support::EphemeralServiceAccounts::new(home.path());
        let template = codex_login::test_support::auth_manager_from_optional_auth(None);
        let first = accounts
            .create(
                &template,
                &codex_login::test_support::fixture_chatgpt_auth("workspace-a"),
            )
            .await
            .unwrap();
        let second = accounts
            .create(
                &template,
                &codex_login::test_support::fixture_chatgpt_auth("workspace-b"),
            )
            .await
            .unwrap();
        accounts
            .selection
            .select(Some(first.id().to_owned()))
            .unwrap();
        let captured = accounts.resolve(&template).await.unwrap();
        let selected_second = accounts
            .selection
            .select(Some(second.id().to_owned()))
            .unwrap();
        let endpoint =
            url::Url::parse("https://chatgpt.com/backend-api/accounts/logout_all").unwrap();
        let cancellation = CancellationToken::new();
        let caller = CancellationToken::new();
        for (target, method, status) in [
            (endpoint.clone(), http::Method::POST, 401),
            (endpoint.clone(), http::Method::POST, 500),
            (endpoint.clone(), http::Method::GET, 200),
            (
                url::Url::parse("https://chatgpt.com/backend-api/accounts/logout_all/other")
                    .unwrap(),
                http::Method::POST,
                200,
            ),
            (
                url::Url::parse("https://api.openai.com/backend-api/accounts/logout_all").unwrap(),
                http::Method::POST,
                200,
            ),
        ] {
            assert!(
                !mark_completed_service_logout(
                    &captured,
                    &target,
                    &method,
                    status,
                    &cancellation,
                    &caller
                )
                .await
                .unwrap()
            );
            assert_eq!(
                first.status().unwrap(),
                codex_login::AzraelProfileStatus::Available
            );
        }
        let aborted = CancellationToken::new();
        aborted.cancel();
        assert!(
            mark_completed_service_logout(
                &captured,
                &endpoint,
                &http::Method::POST,
                200,
                &aborted,
                &caller
            )
            .await
            .is_err()
        );
        assert_eq!(
            first.status().unwrap(),
            codex_login::AzraelProfileStatus::Available
        );
        assert!(
            mark_completed_service_logout(
                &captured,
                &endpoint,
                &http::Method::POST,
                204,
                &cancellation,
                &caller
            )
            .await
            .unwrap()
        );
        assert_eq!(
            first.status().unwrap(),
            codex_login::AzraelProfileStatus::ReauthenticationRequired
        );
        assert_eq!(
            second.status().unwrap(),
            codex_login::AzraelProfileStatus::Available
        );
        assert_eq!(accounts.selection.snapshot().unwrap(), selected_second);
    }

    #[tokio::test]
    async fn service_logout_all_does_not_mark_replaced_credentials() {
        let home = tempfile::tempdir().unwrap();
        let accounts = codex_login::test_support::EphemeralServiceAccounts::new(home.path());
        let template = codex_login::test_support::auth_manager_from_optional_auth(None);
        let mut credentials = codex_login::test_support::fixture_chatgpt_auth("workspace-a");
        let profile = accounts.create(&template, &credentials).await.unwrap();
        accounts
            .selection
            .select(Some(profile.id().to_owned()))
            .unwrap();
        let captured = accounts.resolve(&template).await.unwrap();
        credentials.tokens.as_mut().unwrap().refresh_token =
            "replacement-login-refresh-token".to_owned();
        codex_login::save_auth(
            profile.auth_home(),
            &credentials,
            codex_config::types::AuthCredentialsStoreMode::Ephemeral,
            codex_config::types::AuthKeyringBackendKind::default(),
        )
        .unwrap();
        let endpoint =
            url::Url::parse("https://chatgpt.com/backend-api/accounts/logout_all").unwrap();
        assert!(
            !mark_completed_service_logout(
                &captured,
                &endpoint,
                &http::Method::POST,
                200,
                &CancellationToken::new(),
                &CancellationToken::new()
            )
            .await
            .unwrap()
        );
        assert_eq!(
            profile.status().unwrap(),
            codex_login::AzraelProfileStatus::Available
        );
        assert_eq!(accounts.selection.snapshot().unwrap(), captured.selection);
    }

    #[test]
    fn service_http_headers_cannot_override_account_and_reject_invalid_values() {
        assert!(
            service_header(
                "ChatGPT-Account-ID",
                "workspace-a",
                "token",
                Some("workspace-a")
            )
            .unwrap()
            .is_none()
        );
        assert!(
            service_header(
                "chatgpt-account-id",
                "workspace-b",
                "token",
                Some("workspace-a")
            )
            .is_err()
        );
        assert!(
            service_header(
                "Authorization",
                "Bearer token",
                "token",
                Some("workspace-a")
            )
            .unwrap()
            .is_none()
        );
        assert!(
            service_header(
                "authorization",
                "Bearer other",
                "token",
                Some("workspace-a")
            )
            .is_err()
        );
        assert!(service_header("x-ok", "line\r\ninjected: true", "token", None).is_err());
        assert!(service_header("bad header", "value", "token", None).is_err());
        assert!(
            service_header("x-ok", "value", "token", None)
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn service_http_attempts_require_one_completed_401_before_same_account_retry() {
        let mut attempts = HttpAttempts {
            http_allowed: true,
            ..Default::default()
        };
        attempts.begin_http().unwrap();
        assert!(attempts.begin_http().is_err());
        assert!(attempts.begin_refresh().is_err());
        attempts.received_response(401);
        attempts.begin_refresh().unwrap();
        assert!(attempts.begin_refresh().is_err());
        attempts.refreshed();
        attempts.begin_http().unwrap();
        attempts.received_response(401);
        assert!(attempts.begin_refresh().is_err());
        assert!(attempts.begin_http().is_err());

        let mut successful = HttpAttempts {
            http_allowed: true,
            ..Default::default()
        };
        successful.begin_http().unwrap();
        successful.received_response(200);
        assert!(successful.begin_refresh().is_err());
        assert!(successful.begin_http().is_err());
    }

    #[tokio::test]
    async fn service_http_cancel_before_start_and_disconnect_are_connection_scoped() {
        let registry = Arc::new(ServiceHttpRequests::default());
        let first = ConnectionId(1);
        let second = ConnectionId(2);
        let first_gate = ConnectionRpcGate::new();
        let second_gate = ConnectionRpcGate::new();
        registry.end(first, "early", &first_gate).unwrap();
        assert!(
            registry
                .begin(first, "early", &first_gate, CancellationToken::new())
                .is_err()
        );
        let first_request = registry
            .begin(first, "same-id", &first_gate, CancellationToken::new())
            .unwrap();
        let second_request = registry
            .begin(second, "same-id", &second_gate, CancellationToken::new())
            .unwrap();
        assert!(
            registry
                .checkout(
                    first,
                    "same-id",
                    &first_gate,
                    CancellationToken::new(),
                    ServiceRequestOperation::Http
                )
                .is_err()
        );
        registry.end(first, "same-id", &first_gate).unwrap();
        assert!(first_request.cancellation.is_cancelled());
        assert!(!second_request.cancellation.is_cancelled());
        assert!(
            registry
                .begin(first, "same-id", &first_gate, CancellationToken::new())
                .is_err()
        );
        first_gate.close().await;
        registry.connection_closed(first);
        assert!(
            registry
                .begin(first, "late", &first_gate, CancellationToken::new())
                .is_err()
        );
        assert!(!registry.connections.lock().unwrap().contains_key(&first));
        drop(first_request);
        assert!(!registry.connections.lock().unwrap().contains_key(&first));
        second_gate.close().await;
        registry.connection_closed(second);
        assert!(second_request.cancellation.is_cancelled());
        assert!(registry.connections.lock().unwrap().is_empty());
    }

    #[test]
    fn service_http_registry_bounds_tombstones_and_rejects_dropped_initialization() {
        let registry = Arc::new(ServiceHttpRequests::default());
        let connection = ConnectionId(1);
        let gate = ConnectionRpcGate::new();
        drop(
            registry
                .begin(connection, "dropped", &gate, CancellationToken::new())
                .unwrap(),
        );
        assert!(
            registry
                .begin(connection, "dropped", &gate, CancellationToken::new())
                .is_err()
        );
        for index in 1..MAX_SERVICE_REQUESTS_PER_CONNECTION {
            registry.end(connection, &index.to_string(), &gate).unwrap();
        }
        assert!(
            registry
                .begin(connection, "over-limit", &gate, CancellationToken::new())
                .is_err()
        );
        assert!(registry.end(connection, "over-limit", &gate).is_err());
        registry.end(connection, "dropped", &gate).unwrap();
    }

    #[tokio::test]
    async fn service_http_cancellation_drops_pending_transport_future_without_replay() {
        struct Dropped(Arc<std::sync::atomic::AtomicBool>);
        impl Drop for Dropped {
            fn drop(&mut self) {
                self.0.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }
        let cancellation = CancellationToken::new();
        let caller = CancellationToken::new();
        let dropped = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let result = run_service_request(&cancellation, &caller, async {
            let _guard = Dropped(Arc::clone(&dropped));
            cancellation.cancel();
            std::future::pending::<Result<(), JSONRPCErrorError>>().await
        })
        .await;
        assert!(result.is_err());
        assert!(dropped.load(std::sync::atomic::Ordering::SeqCst));
        let polled = std::sync::atomic::AtomicBool::new(false);
        assert!(
            run_service_request(&cancellation, &caller, async {
                polled.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(())
            })
            .await
            .is_err()
        );
        assert!(!polled.load(std::sync::atomic::Ordering::SeqCst));
    }

    #[test]
    fn service_http_destination_is_exact_and_does_not_allow_credential_urls() {
        for url in [
            "https://chatgpt.com/backend-api/ecosystem/url_safe",
            "https://api.openai.com/v1/responses",
        ] {
            assert!(service_url_allowed(&url::Url::parse(url).unwrap()));
        }
        for url in [
            "http://chatgpt.com",
            "https://chatgpt.com.evil.test",
            "https://user:secret@chatgpt.com",
            "https://ab.chatgpt.com",
            "https://chatgpt.com:8443",
        ] {
            assert!(!service_url_allowed(&url::Url::parse(url).unwrap()));
        }
    }
}

//! App-wide service selection never changes a project's chat authentication.
use super::*;
use codex_app_server_protocol::AzraelServiceAccountReadiness as Readiness;
use codex_app_server_protocol::AzraelServiceAccountState;
use codex_login::AzraelProfileStatus;
use codex_login::AzraelServiceAccountStore;

fn refresh_binding_matches(
    params: &codex_app_server_protocol::AzraelServiceAuthParams,
    selected: &codex_login::AzraelServiceAccountSelection,
) -> bool {
    match (&params.profile_id, params.revision) {
        (None, None) => !params.refresh_token,
        (Some(profile_id), Some(revision)) => {
            Some(profile_id) == selected.profile_id.as_ref() && revision == selected.revision
        }
        _ => false,
    }
}

impl AccountRequestProcessor {
    pub(crate) async fn service_auth_status(
        &self,
        connection_id: crate::transport::ConnectionId,
        gate: &crate::connection_rpc_gate::ConnectionRpcGate,
        context: &crate::outgoing_message::RequestContext,
        params: codex_app_server_protocol::AzraelServiceAuthParams,
    ) -> Result<Option<ClientResponsePayload>, JSONRPCErrorError> {
        if std::env::var_os("AZRAEL_EX_MANAGEMENT_SOCKET").is_none() {
            return Err(invalid_request(
                "OpenAI service authentication requires an Azrael host",
            ));
        }
        let mut guard = if params.refresh_token {
            self.service_http_requests.checkout(
                connection_id,
                &params.request_id,
                gate,
                context.cancellation.clone(),
                service_http::ServiceRequestOperation::Refresh,
            )?
        } else {
            self.service_http_requests.begin(
                connection_id,
                &params.request_id,
                gate,
                context.cancellation.clone(),
            )?
        };
        let cancellation = guard.cancellation.clone();
        service_http::run_service_request(
            &cancellation,
            &context.cancellation,
            self.service_auth_status_bound(params, &mut guard),
        )
        .await
    }

    async fn service_auth_status_bound(
        &self,
        params: codex_app_server_protocol::AzraelServiceAuthParams,
        guard: &mut service_http::ServiceRequestGuard,
    ) -> Result<Option<ClientResponsePayload>, JSONRPCErrorError> {
        let binding = if let Some(binding) = &guard.binding {
            Arc::clone(binding)
        } else {
            Arc::new(
                self.service_account_store()
                    .resolve(&self.auth_manager)
                    .await
                    .map_err(|_| {
                        invalid_request(
                            "OpenAI service account is unavailable; select or reauthenticate it",
                        )
                    })?,
            )
        };
        if !refresh_binding_matches(&params, &binding.selection) {
            return Err(invalid_request(
                "OpenAI service account changed; the original request was not replayed",
            ));
        }
        let manager = binding.manager();
        if binding
            .profile
            .status()
            .map_err(|_| invalid_request("OpenAI service account is unavailable"))?
            != AzraelProfileStatus::Available
        {
            return Err(invalid_request(
                "OpenAI service account requires reauthentication",
            ));
        }
        // Check the service account's requirements against this project's policy.
        let _service_config = self
            .config
            .for_openai_service(Arc::clone(&manager))
            .await
            .map_err(|_| {
                invalid_request("OpenAI service request is blocked by account or project policy")
            })?;
        if params.refresh_token {
            manager
                .refresh_token()
                .await
                .map_err(|_| invalid_request("OpenAI service account requires reauthentication"))?;
        }
        let auth = manager
            .auth()
            .await
            .ok_or_else(|| invalid_request("OpenAI service authentication is unavailable"))?;
        if !super::azrael::profile_identity_matches(&binding.profile, Some(&auth)) {
            return Err(invalid_request(
                "OpenAI service authentication identity changed",
            ));
        }
        if binding
            .profile
            .status()
            .map_err(|_| invalid_request("OpenAI service account is unavailable"))?
            != AzraelProfileStatus::Available
        {
            return Err(invalid_request(
                "OpenAI service account requires reauthentication",
            ));
        }
        let token = auth
            .get_token()
            .map_err(|_| invalid_request("OpenAI service authentication token is unavailable"))?;
        if params.refresh_token {
            guard.refreshed();
        } else {
            guard.publish_binding(Arc::clone(&binding))?;
        }
        Ok(Some(
            codex_app_server_protocol::AzraelServiceAuthResponse {
                auth_method: Some(auth_mode_to_api(auth.api_auth_mode())),
                auth_token: Some(token),
                requires_openai_auth: true,
                profile_id: binding.selection.profile_id.clone(),
                revision: binding.selection.revision,
            }
            .into(),
        ))
    }

    pub(super) fn service_account_store(&self) -> AzraelServiceAccountStore {
        AzraelServiceAccountStore::new(self.config.codex_home.as_path())
    }

    pub(super) async fn select_service_account(
        &self,
        profile_id: Option<String>,
    ) -> Result<(), JSONRPCErrorError> {
        if let Some(id) = profile_id.as_deref() {
            let profile = self.azrael_profile_auth(id).await?;
            let auth = profile.manager().auth().await;
            if !auth.as_ref().is_some_and(CodexAuth::uses_codex_backend)
                || !super::azrael::profile_identity_matches(&profile, auth.as_ref())
            {
                return Err(invalid_request(
                    "Reauthenticate the OpenAI service account before selecting it",
                ));
            }
        }
        self.service_account_store()
            .select(profile_id)
            .map_err(|_| internal_error("OpenAI service account selection could not be saved"))?;
        self.send_azrael_update().await;
        Ok(())
    }

    pub(super) async fn service_account_state(&self) -> AzraelServiceAccountState {
        let selection = match self.service_account_store().snapshot() {
            Ok(selection) => selection,
            Err(_) => {
                return AzraelServiceAccountState {
                    profile_id: None,
                    revision: 0,
                    state: Readiness::Unavailable,
                    reason: Some("OpenAI 서비스 계정 설정을 읽을 수 없습니다".into()),
                };
            }
        };
        let mut state = AzraelServiceAccountState {
            profile_id: selection.profile_id.clone(),
            revision: selection.revision,
            state: Readiness::Unconfigured,
            reason: Some("OpenAI 서비스 메인 계정을 선택해주세요".into()),
        };
        let Some(id) = selection.profile_id.clone() else {
            return state;
        };
        match self.azrael.store.status(&id) {
            Ok(AzraelProfileStatus::Available) => {}
            Ok(AzraelProfileStatus::ReauthenticationRequired) => {
                state.state = Readiness::ReauthRequired;
                state.reason = Some("OpenAI 서비스 메인 계정을 재인증해주세요".into());
                return state;
            }
            _ => {
                state.state = Readiness::Unavailable;
                state.reason = Some("선택한 OpenAI 서비스 계정을 사용할 수 없습니다".into());
                return state;
            }
        }
        match self.azrael_profile_auth(&id).await {
            Ok(profile) => {
                let auth = profile.manager().auth().await;
                if auth.as_ref().is_some_and(CodexAuth::uses_codex_backend)
                    && super::azrael::profile_identity_matches(&profile, auth.as_ref())
                {
                    match self.config.for_openai_service(profile.manager()).await {
                        Ok(_) => {
                            state.state = Readiness::Ready;
                            state.reason = None;
                        }
                        Err(_) => {
                            state.state = Readiness::PolicyBlocked;
                            state.reason = Some(
                                "OpenAI 서비스가 계정 또는 프로젝트 정책에 의해 제한됩니다".into(),
                            );
                        }
                    }
                } else {
                    state.state = Readiness::ReauthRequired;
                    state.reason = Some("OpenAI 서비스 메인 계정을 재인증해주세요".into());
                }
            }
            Err(_) => {
                state.state = Readiness::Unavailable;
                state.reason = Some("OpenAI 서비스 계정 인증을 확인할 수 없습니다".into());
            }
        }
        // Policy/auth checks may await cloud state. Never publish readiness for
        // an account that was replaced while those checks were in flight.
        match self.service_account_store().snapshot() {
            Ok(current) if current != selection => AzraelServiceAccountState {
                profile_id: current.profile_id,
                revision: current.revision,
                state: Readiness::Checking,
                reason: Some("OpenAI 서비스 계정 변경을 확인하고 있습니다".into()),
            },
            Err(_) => AzraelServiceAccountState {
                state: Readiness::Unavailable,
                reason: Some("OpenAI 서비스 계정 설정을 읽을 수 없습니다".into()),
                ..state
            },
            Ok(_) => state,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn service_account_refresh_cannot_adopt_a_new_selection() {
        let selected = codex_login::AzraelServiceAccountSelection {
            profile_id: Some("b".repeat(32)),
            revision: 4,
            initialized: true,
        };
        let mut request = codex_app_server_protocol::AzraelServiceAuthParams {
            request_id: "request-1".to_owned(),
            refresh_token: true,
            profile_id: Some("a".repeat(32)),
            revision: Some(3),
        };
        assert!(!refresh_binding_matches(&request, &selected));
        request.profile_id = selected.profile_id.clone();
        assert!(!refresh_binding_matches(&request, &selected));
        request.revision = Some(selected.revision);
        assert!(refresh_binding_matches(&request, &selected));
        request.refresh_token = false;
        request.profile_id = None;
        request.revision = None;
        assert!(refresh_binding_matches(&request, &selected));
        request.profile_id = selected.profile_id.clone();
        assert!(!refresh_binding_matches(&request, &selected));
        request.profile_id = None;
        request.revision = Some(selected.revision);
        assert!(!refresh_binding_matches(&request, &selected));
    }

    #[test]
    fn service_account_begin_distinguishes_omitted_preconditions_from_null() {
        type Params = codex_app_server_protocol::AzraelServiceAuthParams;
        assert!(
            serde_json::from_value::<Params>(serde_json::json!({"requestId":"request-1"})).is_ok()
        );
        for value in [
            serde_json::json!({"requestId":"request-1", "profileId":null}),
            serde_json::json!({"requestId":"request-1", "revision":null}),
            serde_json::json!({"refreshToken":false}),
        ] {
            assert!(serde_json::from_value::<Params>(value).is_err());
        }
    }
}

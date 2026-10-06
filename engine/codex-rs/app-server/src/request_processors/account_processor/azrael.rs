use super::azrael_state::write_selected_states;
use super::*;
use codex_app_server_protocol::AzraelAccountAction;
use codex_app_server_protocol::AzraelAccountParams;
use codex_app_server_protocol::AzraelAccountResponse;
use codex_app_server_protocol::AzraelAccountState;
use codex_app_server_protocol::AzraelProfile;
use codex_http_client::RouteAwareRequestError;
use codex_login::AzraelProfileAuth;
use codex_login::AzraelProfileInfo;
use codex_login::ExternalAuth;
use std::io;
use std::sync::atomic::Ordering;
use tokio::sync::OwnedRwLockWriteGuard;
use tokio_util::sync::CancellationToken;

impl AccountRequestProcessor {
    pub(crate) fn auth_manager(&self) -> &AuthManager {
        &self.auth_manager
    }

    pub(super) async fn azrael_account_response(
        &self,
        _request_id: ConnectionRequestId,
        params: AzraelAccountParams,
    ) -> Result<AzraelAccountResponse, JSONRPCErrorError> {
        let mut login = None;
        let mut usage = None;
        let mut usage_profile_id = None;
        let mut reset_credit_outcome = None;
        let mut auto_windows = None;
        match params.action {
            AzraelAccountAction::List => {}
            AzraelAccountAction::CaptureCurrent => self.azrael_capture_current().await?,
            AzraelAccountAction::LoginStart => {
                login = Some(self.azrael_login_start(params.profile_id).await?);
            }
            AzraelAccountAction::LoginCancel => {
                self.azrael_login_cancel(params.login_id.as_deref()).await?;
            }
            AzraelAccountAction::Remove => {
                self.azrael_remove(required_profile_id(params.profile_id)?)
                    .await?;
            }
            AzraelAccountAction::Switch => {
                self.azrael_switch(required_profile_id(params.profile_id)?)
                    .await?;
            }
            AzraelAccountAction::CancelSwitch => self.azrael_cancel_switch().await?,
            AzraelAccountAction::Usage => {
                let id = required_profile_id(params.profile_id)?;
                usage = Some(self.azrael_usage(&id, params.include_details).await?);
                usage_profile_id = Some(id);
            }
            AzraelAccountAction::ConsumeResetCredit => {
                let id = required_profile_id(params.profile_id)?;
                let key = required_reset_credit_idempotency_key(params.idempotency_key)?;
                if params.credit_id.as_deref().is_some_and(str::is_empty) {
                    return Err(invalid_params("creditId must not be empty"));
                }
                reset_credit_outcome = Some(
                    self.azrael_consume_reset_credit(&id, &key, params.credit_id.as_deref())
                        .await?,
                );
            }
            AzraelAccountAction::AutoSwitchEnable | AzraelAccountAction::AutoSwitchDisable => {
                let enabled = params.action == AzraelAccountAction::AutoSwitchEnable;
                let id = required_profile_id(params.profile_id)?;
                let permission_guard = self.auth_manager.azrael_admission()
                    .admit_queued_request()
                    .map_err(|error| {
                        if error.kind() == io::ErrorKind::WouldBlock {
                            invalid_request("An account change is being committed. Retry the automatic-switch setting after it finishes.")
                        } else {
                            invalid_request("Account recovery is required before changing automatic-switch settings. Restart the engine.")
                        }
                    })?;
                self.azrael
                    .store
                    .set_auto_switch_allowed(&id, enabled)
                    .map_err(account_mutation_error)?;
                drop(permission_guard);
                self.send_azrael_update().await;
            }
            AzraelAccountAction::AutoWindowStatus => {
                auto_windows = Some(self.usage_window_status()?);
            }
            AzraelAccountAction::AutoWindowEnable | AzraelAccountAction::AutoWindowDisable => {
                let enabled = params.action == AzraelAccountAction::AutoWindowEnable;
                let id = required_profile_id(params.profile_id)?;
                self.usage_window_set_enabled(&id, enabled)?;
                auto_windows = Some(self.usage_window_status()?);
            }
            AzraelAccountAction::AutoWindowTick => {
                self.usage_window_tick().await?;
                auto_windows = Some(self.usage_window_status()?);
            }
        }
        Ok(AzraelAccountResponse {
            state: self.azrael_state().await,
            login,
            usage,
            usage_profile_id,
            reset_credit_outcome,
            auto_windows,
        })
    }

    pub(super) async fn restore_azrael_profile_inner(&self) {
        let selected = self.azrael.inner.lock().await.selected_profile_id.clone();
        let Some(profile_id) = selected else {
            return;
        };
        if let Err(error) = self.restore_azrael_profile_direct(&profile_id).await {
            // A failed saved selection must not silently use the root login instead.
            self.auth_manager.release_azrael_unmanaged_auth_lease();
            self.auth_manager.reload().await;
            let mut state = self.azrael.inner.lock().await;
            state.last_error = Some(match error.kind() {
                io::ErrorKind::WouldBlock => "The selected account is held exclusively by another azrael window. Reload that window after its work finishes, or select another account.".to_string(),
                io::ErrorKind::NotFound => "The saved account profile was not found. Select another account.".to_string(),
                io::ErrorKind::PermissionDenied => "Access to the saved account profile was denied.".to_string(),
                _ => "미분류된 오류 발생".to_string(),
            });
            if error.kind() == io::ErrorKind::NotFound {
                state.selected_profile_id = None;
                let _ = write_selected_states(
                    &self.azrael.selection_path,
                    self.azrael.default_selection_path.as_deref(),
                    None,
                );
            }
            tracing::warn!(kind = ?error.kind(), "failed to restore selected azrael account");
        }
    }

    async fn restore_azrael_profile_direct(&self, profile_id: &str) -> io::Result<()> {
        let profile = self
            .azrael
            .store
            .open(profile_id, &self.auth_manager)
            .await?;
        let request = self.auth_manager.azrael_admission().begin_switch()?;
        {
            let mut state = self.azrael.inner.lock().await;
            state.pending_profile_id = Some(profile_id.to_string());
            state.last_error = None;
        }
        let guard = wait_for_switch_guard(&request, CancellationToken::new()).await?;
        self.commit_azrael_switch(profile, /*retire_root_auth*/ false, guard)
            .await;
        drop(request);
        let mut state = self.azrael.inner.lock().await;
        state.pending_profile_id = None;
        Ok(())
    }

    async fn azrael_capture_current(&self) -> Result<(), JSONRPCErrorError> {
        self.auth_manager
            .acquire_azrael_unmanaged_auth_lease()
            .map_err(|_| invalid_request("unmanaged authentication is owned by another engine"))?;
        let _refresh_guard = self
            .auth_manager
            .lock_azrael_unmanaged_mutation()
            .await
            .map_err(account_mutation_error)?;
        let request = self
            .auth_manager
            .azrael_admission()
            .begin_switch()
            .map_err(|_| invalid_request("an account change is already pending"))?;
        let guard = request.try_commit().ok_or_else(|| {
            invalid_request("account capture is unavailable while account work is active")
        })?;
        let auth = self.auth_manager.auth_cached().ok_or_else(|| {
            invalid_request("managed ChatGPT authentication is required to capture an account")
        })?;
        if !matches!(auth, CodexAuth::Chatgpt(_)) {
            return Err(invalid_request(
                "managed ChatGPT authentication is required to capture an account",
            ));
        }
        let account_id = auth.get_account_id();
        let user_id = auth.get_chatgpt_user_id();
        let existing = self
            .azrael
            .store
            .list()
            .map_err(|_| internal_error("failed to list account profiles"))?
            .into_iter()
            .find(|profile| {
                Some(profile.workspace_account_id.as_str()) == account_id.as_deref()
                    && Some(profile.user_id.as_str()) == user_id.as_deref()
            });
        let captured = self
            .azrael
            .store
            .capture_current(&self.auth_manager)
            .await
            .map_err(|_| internal_error("failed to capture the current account"))?;
        let profile = if let Some(existing) = existing {
            let profile = self
                .azrael
                .store
                .open(&existing.id, &self.auth_manager)
                .await
                .map_err(|_| invalid_request("account profile is unavailable or busy"))?;
            profile
                .replace_from(&captured)
                .await
                .map_err(|_| internal_error("failed to update the captured account"))?;
            let _ = self.azrael.store.discard_pending(&captured);
            profile
        } else {
            captured
        };
        self.commit_azrael_switch(profile, /*retire_root_auth*/ true, guard)
            .await;
        drop(request);
        Ok(())
    }

    async fn azrael_remove(&self, profile_id: String) -> Result<(), JSONRPCErrorError> {
        {
            let state = self.azrael.inner.lock().await;
            if state.active_profile.as_ref().map(|p| p.id()) == Some(profile_id.as_str()) {
                return Err(invalid_request(
                    "the active account profile cannot be removed",
                ));
            }
            if state.pending_profile_id.as_deref() == Some(profile_id.as_str())
                || state.login.as_ref().is_some_and(|login| {
                    login.profile.id() == profile_id
                        || login.replacement_id.as_deref() == Some(profile_id.as_str())
                })
            {
                return Err(invalid_request("account profile is currently in use"));
            }
        }
        self.azrael
            .store
            .remove(&profile_id)
            .await
            .map_err(profile_remove_error)?;
        {
            let mut state = self.azrael.inner.lock().await;
            if state.selected_profile_id.as_deref() == Some(profile_id.as_str()) {
                state.selected_profile_id = None;
                if write_selected_states(
                    &self.azrael.selection_path,
                    self.azrael.default_selection_path.as_deref(),
                    None,
                )
                .is_err()
                {
                    state.last_error = Some(
                        "The account was removed, but its saved selection could not be cleared."
                            .to_string(),
                    );
                }
            }
        }
        self.send_azrael_update().await;
        Ok(())
    }

    async fn azrael_switch(&self, profile_id: String) -> Result<(), JSONRPCErrorError> {
        let profile = self
            .azrael
            .store
            .open(&profile_id, &self.auth_manager)
            .await
            .map_err(|_| invalid_request("account profile is unavailable or busy"))?;
        self.start_switch(profile, /*retire_root_auth*/ false).await
    }

    async fn start_switch(
        &self,
        profile: Arc<AzraelProfileAuth>,
        retire_root_auth: bool,
    ) -> Result<(), JSONRPCErrorError> {
        {
            let state = self.azrael.inner.lock().await;
            if state.active_profile.as_ref().map(|active| active.id()) == Some(profile.id()) {
                return Ok(());
            }
            if state.failed_closed_guard.is_some() {
                return Err(invalid_request(
                    "account switching is blocked after a failed recovery",
                ));
            }
        }
        let request = self
            .auth_manager
            .azrael_admission()
            .begin_switch()
            .map_err(|_| invalid_request("an account change is already pending"))?;
        let cancel = CancellationToken::new();
        {
            let mut state = self.azrael.inner.lock().await;
            state.pending_profile_id = Some(profile.id().to_string());
            state.switch_cancel = Some(cancel.clone());
            state.last_error = None;
        }
        let processor = self.clone();
        tokio::spawn(async move {
            let result = wait_for_switch_guard(&request, cancel.clone()).await;
            if let Ok(guard) = result {
                processor
                    .commit_azrael_switch(profile, retire_root_auth, guard)
                    .await;
            }
            drop(request);
            {
                let mut state = processor.azrael.inner.lock().await;
                state.pending_profile_id = None;
                state.switch_cancel = None;
            }
            processor.send_azrael_update().await;
        });
        self.send_azrael_update().await;
        Ok(())
    }

    pub(super) async fn commit_azrael_switch(
        &self,
        profile: Arc<AzraelProfileAuth>,
        retire_root_auth: bool,
        guard: OwnedRwLockWriteGuard<()>,
    ) {
        let mut completion = super::quota_recovery::CommitCompletion {
            admission: self.auth_manager.azrael_admission(),
            completed: false,
        };
        let (previous, previous_selection) = {
            let state = self.azrael.inner.lock().await;
            (
                state.active_profile.clone(),
                state.selected_profile_id.clone(),
            )
        };
        let previous_auth = self.auth_manager.auth_cached();
        if retire_root_auth && self.auth_manager.logout().await.is_err() {
            self.auth_manager.azrael_admission().block_new_work();
            let mut state = self.azrael.inner.lock().await;
            state.last_error = Some(
                "The current account could not be retired. New work is blocked until restart."
                    .to_string(),
            );
            state.failed_closed_guard = Some(guard);
            completion.completed = true;
            return;
        }
        let external: Arc<dyn ExternalAuth> = profile.clone();
        let switched = self.auth_manager.set_external_auth(external).await.is_ok()
            && profile_identity_matches(&profile, self.auth_manager.auth_cached().as_ref());
        let selected = profile.id().to_string();
        if switched
            && write_selected_states(
                &self.azrael.selection_path,
                self.azrael.default_selection_path.as_deref(),
                Some(selected.clone()),
            )
            .is_ok()
        {
            {
                let mut state = self.azrael.inner.lock().await;
                state.active_profile = Some(Arc::clone(&profile));
                state.selected_profile_id = Some(selected);
                state.last_error = None;
            }
            self.refresh_after_azrael_account_change().await;
            if profile_identity_matches(&profile, self.auth_manager.auth_cached().as_ref()) {
                self.auth_manager.release_azrael_unmanaged_auth_lease();
                completion.completed = true;
                drop(guard);
                return;
            }
        }
        // Restore both binding and durable selection before reopening execution.
        let restored = if let Some(previous) = previous.as_ref() {
            let external: Arc<dyn ExternalAuth> = previous.clone();
            self.auth_manager.set_external_auth(external).await.is_ok()
                && profile_identity_matches(previous, self.auth_manager.auth_cached().as_ref())
        } else if !retire_root_auth {
            self.auth_manager.clear_external_auth();
            self.auth_manager.reload().await;
            same_auth_identity(
                previous_auth.as_ref(),
                self.auth_manager.auth_cached().as_ref(),
            )
        } else {
            false
        };
        if restored
            && write_selected_states(
                &self.azrael.selection_path,
                self.azrael.default_selection_path.as_deref(),
                previous_selection.clone(),
            )
            .is_ok()
        {
            {
                let mut state = self.azrael.inner.lock().await;
                state.active_profile = previous;
                state.selected_profile_id = previous_selection;
                state.last_error =
                    Some("Account switch failed; the previous account was restored.".to_string());
            }
            self.refresh_after_azrael_account_change().await;
            if same_auth_identity(
                previous_auth.as_ref(),
                self.auth_manager.auth_cached().as_ref(),
            ) {
                completion.completed = true;
                drop(guard);
                return;
            }
        }
        self.auth_manager.azrael_admission().block_new_work();
        let mut state = self.azrael.inner.lock().await;
        state.last_error = Some(
            "Account recovery could not be verified. New work is blocked until restart."
                .to_string(),
        );
        state.failed_closed_guard = Some(guard);
        completion.completed = true;
    }

    async fn azrael_cancel_switch(&self) -> Result<(), JSONRPCErrorError> {
        let state = self.azrael.inner.lock().await;
        let Some(cancel) = state.switch_cancel.clone() else {
            return Err(invalid_request("no account switch is pending"));
        };
        cancel.cancel();
        Ok(())
    }

    pub(super) async fn azrael_profile_auth(
        &self,
        profile_id: &str,
    ) -> Result<Arc<AzraelProfileAuth>, JSONRPCErrorError> {
        let profile = {
            let state = self.azrael.inner.lock().await;
            state
                .active_profile
                .as_ref()
                .filter(|profile| profile.id() == profile_id)
                .cloned()
        };
        match profile {
            Some(profile) => Ok(profile),
            None => self
                .azrael
                .store
                .open(profile_id, &self.auth_manager)
                .await
                .map_err(|_| invalid_request("account profile is unavailable or busy")),
        }
    }

    async fn azrael_consume_reset_credit(
        &self,
        profile_id: &str,
        idempotency_key: &str,
        credit_id: Option<&str>,
    ) -> Result<ConsumeAccountRateLimitResetCreditOutcome, JSONRPCErrorError> {
        tokio::time::timeout(Duration::from_secs(10), async {
            let profile = self.azrael_profile_auth(profile_id).await?;
            let manager = profile.manager();
            let mut auth = manager
                .auth()
                .await
                .ok_or_else(|| invalid_request("account profile authentication is unavailable"))?;
            if !profile_identity_matches(&profile, Some(&auth)) {
                return Err(invalid_request("account profile identity is unavailable"));
            }
            let expected_identity = (auth.get_account_id(), auth.get_chatgpt_user_id());
            let mut recovery = manager.unauthorized_recovery();
            loop {
                let client = BackendClient::from_auth(
                    self.config.chatgpt_base_url.clone(),
                    &auth,
                    manager.http_client_factory(),
                );
                let result = match credit_id {
                    Some(credit_id) => {
                        client
                            .consume_rate_limit_reset_credit_by_id(idempotency_key, credit_id)
                            .await
                    }
                    // Replay old unresolved extension attempts that saved only a key.
                    None => {
                        client
                            .consume_rate_limit_reset_credit(idempotency_key)
                            .await
                    }
                };
                match result {
                    Ok(response) => return Ok(reset_credit_outcome_from_backend(response.code)),
                    Err(err)
                        if err
                            .downcast_ref::<BackendRequestError>()
                            .is_some_and(BackendRequestError::is_unauthorized)
                            && recovery.has_next() =>
                    {
                        recovery.next().await.map_err(|_| {
                            internal_error("OpenAI account authentication refresh failed")
                        })?;
                        auth = manager.auth().await.ok_or_else(|| {
                            invalid_request("account profile authentication is unavailable")
                        })?;
                        if (auth.get_account_id(), auth.get_chatgpt_user_id()) != expected_identity
                        {
                            return Err(internal_error(
                                "account profile identity changed during authentication recovery",
                            ));
                        }
                        // Recovery retries the same logical mutation with the original key and credit ID.
                    }
                    Err(error) => return Err(internal_error(azrael_usage_error(&error))),
                }
            }
        })
        .await
        .map_err(|_| internal_error("OpenAI reset credit request timed out"))?
    }

    pub(super) async fn azrael_usage(
        &self,
        profile_id: &str,
        include_details: bool,
    ) -> Result<GetAccountRateLimitsResponse, JSONRPCErrorError> {
        let observed_at = chrono::Utc::now().timestamp();
        let profile = self.azrael_profile_auth(profile_id).await?;
        let manager = profile.manager();
        let mut auth = manager
            .auth()
            .await
            .ok_or_else(|| invalid_request("account profile authentication is unavailable"))?;
        let expected_identity = (auth.get_account_id(), auth.get_chatgpt_user_id());
        if expected_identity.0.is_none() || expected_identity.1.is_none() {
            return Err(invalid_request("account profile identity is unavailable"));
        }
        let params = GetAccountRateLimitsParams {
            supports_luna_reserve: false,
            exclude_reset_credit_details: !include_details,
        };
        let mut recovery = manager.unauthorized_recovery();
        loop {
            match self
                .fetch_account_rate_limits_for_auth(
                    &auth,
                    manager.http_client_factory(),
                    params.clone(),
                )
                .await
            {
                Ok((response, reset_credits)) => {
                    if response
                        .account_id
                        .as_ref()
                        .is_some_and(|id| Some(id) != expected_identity.0.as_ref())
                        || response
                            .user_id
                            .as_ref()
                            .is_some_and(|id| Some(id) != expected_identity.1.as_ref())
                    {
                        return Err(internal_error(
                            "OpenAI usage response belongs to a different account",
                        ));
                    }
                    let usage = self
                        .account_rate_limits_response_from_backend(&auth, response, reset_credits)
                        .await
                        .map_err(|_| {
                            internal_error(
                                "OpenAI usage response contained no rate-limit snapshots",
                            )
                        })?;
                    if let Some(plan) = usage.rate_limits.plan_type {
                        // Reuse the existing account-scoped usage request; listing profiles
                        // remains local and never adds a quota request for collapsed cards.
                        let value = serde_json::to_value(plan)
                            .map_err(|_| internal_error("OpenAI usage plan could not be read"))?;
                        if let Some(plan_type) = value.as_str() {
                            profile
                                .update_observed_plan(&auth, plan_type)
                                .map_err(|_| {
                                    internal_error(
                                        "OpenAI account plan metadata could not be updated",
                                    )
                                })?;
                        }
                    }
                    self.usage_window_observe(profile_id, &usage, observed_at);
                    return Ok(usage);
                }
                Err(err)
                    if err
                        .downcast_ref::<BackendRequestError>()
                        .is_some_and(BackendRequestError::is_unauthorized)
                        && recovery.has_next() =>
                {
                    recovery.next().await.map_err(|error| {
                        let reason = error
                            .failed_reason()
                            .map(|reason| format!(" ({reason:?})"))
                            .unwrap_or_else(|| " (temporary refresh failure)".to_string());
                        internal_error(format!(
                            "OpenAI account authentication refresh failed{reason}"
                        ))
                    })?;
                    auth = manager.auth().await.ok_or_else(|| {
                        invalid_request("account profile authentication is unavailable")
                    })?;
                    if (auth.get_account_id(), auth.get_chatgpt_user_id()) != expected_identity {
                        return Err(internal_error(
                            "account profile identity changed during authentication recovery",
                        ));
                    }
                }
                Err(error) => return Err(internal_error(azrael_usage_error(&error))),
            }
        }
    }

    pub(super) async fn refresh_after_azrael_account_change(&self) {
        self.config_manager.replace_cloud_config_bundle_loader(
            self.auth_manager.clone(),
            self.config.chatgpt_base_url.clone(),
            self.config.http_client_factory(),
        );
        self.config_manager
            .sync_default_client_residency_requirement()
            .await;
        Self::maybe_refresh_plugin_caches_for_current_config(
            &self.config_manager,
            &self.thread_manager,
            self.auth_manager.auth_cached(),
        )
        .await;
        self.outgoing
            .send_server_notification(ServerNotification::AccountUpdated(
                self.current_account_updated_notification(),
            ))
            .await;
        self.send_azrael_update().await;
    }

    async fn azrael_state(&self) -> AzraelAccountState {
        let revision = self.azrael.revision.fetch_add(1, Ordering::Relaxed);
        let profiles = match self.azrael.store.list() {
            Ok(profiles) => profiles.into_iter().map(azrael_profile).collect(),
            Err(_) => {
                self.azrael.inner.lock().await.last_error =
                    Some("Account profiles could not be read.".to_string());
                Vec::new()
            }
        };
        let (
            managed_active_profile_id,
            pending_profile_id,
            login_pending,
            last_error,
            is_switching,
            has_active_turns,
        ) = {
            let state = self.azrael.inner.lock().await;
            let managed_active_profile_id =
                state.active_profile.as_ref().map(|p| p.id().to_string());
            let pending_profile_id = state.pending_profile_id.clone();
            let login_pending = state.login.is_some();
            let last_error = state.last_error.clone();
            let is_switching = self.auth_manager.azrael_admission().is_pending()
                || state.failed_closed_guard.is_some();
            let has_active_turns = self.auth_manager.azrael_admission().has_active_work();
            (
                managed_active_profile_id,
                pending_profile_id,
                login_pending,
                last_error,
                is_switching,
                has_active_turns,
            )
        };
        let cached_auth = self.auth_manager.auth_cached();
        let active_profile_id = resolve_active_profile_id(
            &profiles,
            managed_active_profile_id,
            cached_auth
                .as_ref()
                .and_then(codex_login::CodexAuth::get_account_id)
                .as_deref(),
            cached_auth
                .as_ref()
                .and_then(codex_login::CodexAuth::get_chatgpt_user_id)
                .as_deref(),
        );
        let current_account = self
            .read_account(/*request*/ None)
            .await
            .ok()
            .and_then(|read| read.account_state.account.map(Account::from));
        AzraelAccountState {
            revision,
            instance_id: self.azrael.instance_id.clone(),
            codex_home: self.config.codex_home.as_path().display().to_string(),
            profiles,
            current_account,
            active_profile_id,
            pending_profile_id,
            is_switching,
            has_active_turns,
            login_pending,
            last_error,
        }
    }

    pub(super) async fn send_azrael_update(&self) {
        self.outgoing
            .send_server_notification(ServerNotification::AzraelAccountUpdated(
                self.azrael_state().await,
            ))
            .await;
    }
}

fn azrael_usage_error(error: &anyhow::Error) -> String {
    if let Some(request) = error.downcast_ref::<BackendRequestError>() {
        if let BackendRequestError::Policy(denied) = request {
            return format!("OpenAI usage request blocked: {denied}");
        }
        if let Some(status) = request.status() {
            return format!("OpenAI usage request failed (HTTP {})", status.as_u16());
        }
    }
    let route = error
        .downcast_ref::<RouteAwareRequestError>()
        .or_else(|| match error.downcast_ref::<BackendRequestError>() {
            Some(BackendRequestError::Other(inner)) => {
                inner.downcast_ref::<RouteAwareRequestError>()
            }
            Some(BackendRequestError::Policy(_) | BackendRequestError::UnexpectedStatus { .. })
            | None => None,
        });
    if let Some(route) = route {
        if let RouteAwareRequestError::Policy(denied) = route {
            return format!("OpenAI usage request blocked: {denied}");
        }
        if route.is_timeout() {
            return "OpenAI usage request timed out".to_string();
        }
        if let Some(class) = route.failure_class() {
            return format!("OpenAI usage connection failed ({class:?})");
        }
        if route.is_connect() {
            return "OpenAI usage connection failed".to_string();
        }
        return "OpenAI usage transport failed".to_string();
    }
    if error.to_string().starts_with("Decode error for ") {
        return "OpenAI usage response was not valid JSON".to_string();
    }
    "OpenAI usage request failed (unclassified error)".to_string()
}

fn resolve_active_profile_id(
    profiles: &[AzraelProfile],
    managed_active_profile_id: Option<String>,
    current_workspace_account_id: Option<&str>,
    current_user_id: Option<&str>,
) -> Option<String> {
    managed_active_profile_id.or_else(|| {
        let workspace_account_id = current_workspace_account_id?;
        let user_id = current_user_id?;
        profiles
            .iter()
            .find(|profile| {
                profile.workspace_account_id == workspace_account_id && profile.user_id == user_id
            })
            .map(|profile| profile.id.clone())
    })
}

fn azrael_profile(profile: AzraelProfileInfo) -> AzraelProfile {
    AzraelProfile {
        id: profile.id,
        email: profile.email,
        workspace_account_id: profile.workspace_account_id,
        user_id: profile.user_id,
        plan_type: profile.plan_type,
        auto_switch_allowed: profile.auto_switch_allowed,
    }
}

fn required_profile_id(profile_id: Option<String>) -> Result<String, JSONRPCErrorError> {
    profile_id.ok_or_else(|| invalid_params("profileId is required for this action"))
}

fn required_reset_credit_idempotency_key(
    idempotency_key: Option<String>,
) -> Result<String, JSONRPCErrorError> {
    let key = idempotency_key
        .ok_or_else(|| invalid_params("idempotencyKey is required for this action"))?;
    Uuid::parse_str(&key).map_err(|_| invalid_params("idempotencyKey must be a UUID"))?;
    Ok(key)
}

fn reset_credit_outcome_from_backend(
    code: BackendConsumeRateLimitResetCreditCode,
) -> ConsumeAccountRateLimitResetCreditOutcome {
    match code {
        BackendConsumeRateLimitResetCreditCode::Reset => {
            ConsumeAccountRateLimitResetCreditOutcome::Reset
        }
        BackendConsumeRateLimitResetCreditCode::NothingToReset => {
            ConsumeAccountRateLimitResetCreditOutcome::NothingToReset
        }
        BackendConsumeRateLimitResetCreditCode::NoCredit => {
            ConsumeAccountRateLimitResetCreditOutcome::NoCredit
        }
        BackendConsumeRateLimitResetCreditCode::AlreadyRedeemed => {
            ConsumeAccountRateLimitResetCreditOutcome::AlreadyRedeemed
        }
    }
}

#[cfg(test)]
mod reset_credit_tests {
    use super::*;

    #[test]
    fn reset_credit_requires_uuid_and_preserves_key() {
        assert!(required_reset_credit_idempotency_key(None).is_err());
        for key in ["", "not-a-uuid"] {
            assert!(required_reset_credit_idempotency_key(Some(key.into())).is_err());
        }
        let key = "0197cf1d-2703-7e00-b8fd-941428628c43";
        assert_eq!(
            required_reset_credit_idempotency_key(Some(key.into())).unwrap(),
            key
        );
    }

    #[test]
    fn reset_credit_maps_all_backend_outcomes() {
        for (code, outcome) in [
            (
                BackendConsumeRateLimitResetCreditCode::Reset,
                ConsumeAccountRateLimitResetCreditOutcome::Reset,
            ),
            (
                BackendConsumeRateLimitResetCreditCode::NothingToReset,
                ConsumeAccountRateLimitResetCreditOutcome::NothingToReset,
            ),
            (
                BackendConsumeRateLimitResetCreditCode::NoCredit,
                ConsumeAccountRateLimitResetCreditOutcome::NoCredit,
            ),
            (
                BackendConsumeRateLimitResetCreditCode::AlreadyRedeemed,
                ConsumeAccountRateLimitResetCreditOutcome::AlreadyRedeemed,
            ),
        ] {
            assert_eq!(reset_credit_outcome_from_backend(code), outcome);
        }
    }
}

pub(super) fn account_mutation_error(error: io::Error) -> JSONRPCErrorError {
    match error.kind() {
        io::ErrorKind::WouldBlock => invalid_request(
            "This account is in use by another azrael window. Switch that window to another account or close it before replacing, signing out of, or removing these credentials.",
        ),
        io::ErrorKind::TimedOut => {
            internal_error("Timed out waiting for another credential operation to finish.")
        }
        io::ErrorKind::PermissionDenied => {
            internal_error("Access to account credential storage was denied.")
        }
        _ => internal_error("미분류된 오류 발생"),
    }
}

fn profile_remove_error(error: io::Error) -> JSONRPCErrorError {
    match error.kind() {
        io::ErrorKind::WouldBlock => invalid_request(
            "Account profile is currently in use. Finish account operations and switch away from this account or close the azrael window using it before removing it.",
        ),
        io::ErrorKind::NotFound => invalid_request(
            "A required account profile file was not found. Refresh the account list before trying again.",
        ),
        io::ErrorKind::PermissionDenied => internal_error(
            "Access to account profile storage was denied while removing the profile.",
        ),
        _ => internal_error("미분류된 오류 발생"),
    }
}

pub(super) fn profile_identity_matches(
    profile: &AzraelProfileAuth,
    auth: Option<&CodexAuth>,
) -> bool {
    let Ok(info) = profile.info() else {
        return false;
    };
    auth.is_some_and(|auth| {
        matches!(auth, CodexAuth::Chatgpt(_))
            && auth.get_account_id().as_deref() == Some(info.workspace_account_id.as_str())
            && auth.get_chatgpt_user_id().as_deref() == Some(info.user_id.as_str())
    })
}

fn same_auth_identity(left: Option<&CodexAuth>, right: Option<&CodexAuth>) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => {
            left.api_auth_mode() == right.api_auth_mode()
                && left.get_account_id() == right.get_account_id()
                && left.get_chatgpt_user_id() == right.get_chatgpt_user_id()
        }
        (None, None) => true,
        (Some(_), None) | (None, Some(_)) => false,
    }
}

pub(super) async fn wait_for_switch_guard(
    request: &codex_login::AzraelSwitchRequest,
    cancel: CancellationToken,
) -> io::Result<OwnedRwLockWriteGuard<()>> {
    loop {
        if cancel.is_cancelled() {
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "account switch cancelled",
            ));
        }
        if let Some(guard) = request.try_commit() {
            return Ok(guard);
        }
        tokio::time::sleep(Duration::from_millis(/*millis*/ 50)).await;
    }
}

#[cfg(test)]
#[path = "azrael_tests.rs"]
mod tests;

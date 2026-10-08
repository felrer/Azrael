use super::azrael::profile_identity_matches;
use super::azrael::wait_for_switch_guard;
use super::azrael_state::PendingLogin;
use super::*;
use codex_app_server_protocol::AzraelLogin;
use codex_login::AuthCredentialsStoreMode;
use codex_login::AuthKeyringBackendKind;
use codex_login::AzraelProfileAuth;
use codex_login::ExternalAuth;
use std::io;

impl AccountRequestProcessor {
    pub(super) async fn azrael_login_start(
        &self,
        replacement_id: Option<String>,
    ) -> Result<AzraelLogin, JSONRPCErrorError> {
        {
            let state = self.azrael.inner.lock().await;
            if state.login.is_some() || self.auth_manager.azrael_admission().has_pending_switch() {
                return Err(invalid_request("an account change is already pending"));
            }
        }
        if let Some(id) = replacement_id.as_deref() {
            self.azrael
                .store
                .open(id, &self.auth_manager)
                .await
                .map_err(|_| invalid_request("account profile is unavailable"))?;
        }
        let staged = self
            .azrael
            .store
            .create(&self.auth_manager)
            .await
            .map_err(|_| internal_error("failed to prepare account login"))?;
        let login_id = Uuid::new_v4();
        let mut options = LoginServerOptions {
            open_browser: false,
            force_state: Some(login_id.to_string()),
            ..LoginServerOptions::new(
                staged.auth_home().to_path_buf(),
                oauth_client_id(),
                self.auth_manager.effective_chatgpt_workspaces(),
                AuthCredentialsStoreMode::Keyring,
                AuthKeyringBackendKind::default(),
                self.config.auth_route_config(),
            )
        };
        if let Ok(issuer) = std::env::var(LOGIN_ISSUER_OVERRIDE_ENV_VAR)
            && !issuer.trim().is_empty()
        {
            options.issuer = issuer;
        }
        let server = match run_login_server(options) {
            Ok(server) => server,
            Err(_) => {
                let _ = self.azrael.store.discard_pending(&staged);
                return Err(internal_error("failed to start account login"));
            }
        };
        let auth_url = server.auth_url.clone();
        let shutdown_handle = server.cancel_handle();
        let commit_cancel = CancellationToken::new();
        {
            let mut state = self.azrael.inner.lock().await;
            state.last_error = None;
            state.login = Some(PendingLogin {
                login_id,
                profile: Arc::clone(&staged),
                replacement_id: replacement_id.clone(),
                shutdown_handle,
                commit_cancel: commit_cancel.clone(),
            });
        }
        let processor = self.clone();
        tokio::spawn(async move {
            let result =
                tokio::time::timeout(LOGIN_CHATGPT_TIMEOUT, server.block_until_done()).await;
            processor
                .finish_azrael_login(login_id, staged, replacement_id, commit_cancel, result)
                .await;
        });
        self.send_azrael_update().await;
        Ok(AzraelLogin {
            login_id: login_id.to_string(),
            auth_url,
        })
    }

    async fn finish_azrael_login(
        &self,
        login_id: Uuid,
        staged: Arc<AzraelProfileAuth>,
        replacement_id: Option<String>,
        commit_cancel: CancellationToken,
        result: Result<io::Result<()>, tokio::time::error::Elapsed>,
    ) {
        let is_current = self
            .azrael
            .inner
            .lock()
            .await
            .login
            .as_ref()
            .is_some_and(|login| login.login_id == login_id);
        if !is_current {
            let _ = self.azrael.store.discard_pending(&staged);
            return;
        }
        let completion = match result {
            Ok(Ok(())) if replacement_id.is_none() => staged.finalize().await.map(|_| ()),
            Ok(Ok(())) => {
                self.finish_azrael_reauthentication(
                    &staged,
                    replacement_id.as_deref(),
                    commit_cancel,
                )
                .await
            }
            Ok(Err(_)) | Err(_) => Err(io::Error::other("account login did not complete")),
        };
        {
            let mut state = self.azrael.inner.lock().await;
            if state
                .login
                .as_ref()
                .is_some_and(|login| login.login_id == login_id)
            {
                state.login = None;
                state.last_error = completion
                    .as_ref()
                    .err()
                    .map(|_| "Account login failed.".to_string());
            }
        }
        if completion.is_err() || replacement_id.is_some() {
            let _ = self.azrael.store.discard_pending(&staged);
        }
        self.send_azrael_update().await;
    }

    async fn finish_azrael_reauthentication(
        &self,
        staged: &Arc<AzraelProfileAuth>,
        replacement_id: Option<&str>,
        commit_cancel: CancellationToken,
    ) -> io::Result<()> {
        let id = replacement_id.ok_or_else(|| io::Error::other("missing replacement account"))?;
        staged.finalize().await?;
        let target = self.azrael.store.open(id, &self.auth_manager).await?;
        let active = self
            .azrael
            .inner
            .lock()
            .await
            .active_profile
            .as_ref()
            .map(|p| p.id().to_string());
        if active.as_deref() != Some(id) {
            target.replace_from(staged).await?;
            return Ok(());
        }
        let request = self.auth_manager.azrael_admission().begin_switch()?;
        let guard = wait_for_switch_guard(&request, commit_cancel).await?;
        target.replace_from(staged).await?;
        let external: Arc<dyn ExternalAuth> = target.clone();
        self.auth_manager
            .set_external_auth(external)
            .await
            .map_err(|_| io::Error::other("failed to activate refreshed account"))?;
        self.refresh_after_azrael_account_change().await;
        if !profile_identity_matches(&target, self.auth_manager.auth_cached().as_ref()) {
            self.auth_manager.azrael_admission().block_new_work();
            let mut state = self.azrael.inner.lock().await;
            state.last_error = Some("Refreshed account identity could not be verified. New work is blocked until restart.".to_string());
            state.failed_closed_guard = Some(guard);
            return Err(io::Error::other(
                "refreshed account identity could not be verified",
            ));
        }
        drop(guard);
        drop(request);
        Ok(())
    }

    pub(super) async fn azrael_login_cancel(
        &self,
        login_id: Option<&str>,
    ) -> Result<(), JSONRPCErrorError> {
        let expected = login_id
            .map(Uuid::parse_str)
            .transpose()
            .map_err(|_| invalid_params("loginId must be a UUID"))?;
        {
            let mut state = self.azrael.inner.lock().await;
            let Some(login) = state.login.take() else {
                return Err(invalid_request("no account login is pending"));
            };
            if expected.is_some_and(|id| id != login.login_id) {
                state.login = Some(login);
                return Err(invalid_request("account login does not match loginId"));
            }
            login.commit_cancel.cancel();
            login.shutdown_handle.shutdown();
        }
        self.send_azrael_update().await;
        Ok(())
    }
}

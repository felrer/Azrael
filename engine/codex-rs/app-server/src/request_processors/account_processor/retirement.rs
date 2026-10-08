//! Credential-free account retirement detection, independent of Settings RPCs.
use super::*;
use codex_login::AzraelProfileStatus;
use codex_login::ExternalAuth;
use std::io;
use tokio_util::task::AbortOnDropHandle;

struct RecoveryRequiredAuth;

impl ExternalAuth for RecoveryRequiredAuth {
    fn is_available(&self) -> bool {
        false
    }
    fn resolve(&self) -> codex_login::ExternalAuthFuture<'_, CodexAuth> {
        Box::pin(async { Err(io::Error::other("account recovery is required")) })
    }
    fn refresh(
        &self,
        _: codex_login::ExternalAuthRefreshContext,
    ) -> codex_login::ExternalAuthFuture<'_, CodexAuth> {
        self.resolve()
    }
}

pub(super) fn block_saved_recovery(auth: &codex_login::AuthManager) -> io::Result<()> {
    auth.azrael_admission().block_new_work();
    auth.install_unavailable_external_auth(Arc::new(RecoveryRequiredAuth))?;
    auth.release_azrael_unmanaged_auth_lease();
    Ok(())
}

#[cfg(test)]
mod durable_recovery_tests {
    use super::*;

    struct HealthySyntheticAuth;
    impl ExternalAuth for HealthySyntheticAuth {
        fn resolve(&self) -> codex_login::ExternalAuthFuture<'_, CodexAuth> {
            Box::pin(async { Ok(CodexAuth::from_api_key("synthetic-explicit-account")) })
        }
        fn refresh(
            &self,
            _: codex_login::ExternalAuthRefreshContext,
        ) -> codex_login::ExternalAuthFuture<'_, CodexAuth> {
            self.resolve()
        }
    }

    #[tokio::test]
    async fn durable_recovery_hides_root_auth_without_erasing_it_and_explicit_auth_recovers() {
        let home = tempfile::tempdir().unwrap();
        let root_auth = home.path().join("auth.json");
        std::fs::write(&root_auth, b"synthetic untouched root credentials").unwrap();
        let original = std::fs::read(&root_auth).unwrap();
        let manager = codex_login::AuthManager::from_auth_for_testing_with_home(
            CodexAuth::from_api_key("synthetic-root-account"),
            home.path().to_path_buf(),
        );
        assert!(manager.auth_cached().is_some());
        block_saved_recovery(&manager).unwrap();
        assert!(manager.auth_cached().is_none());
        assert!(manager.auth().await.is_none());
        assert!(manager.auth_with_http_client_factory().await.is_none());
        assert!(manager.azrael_admission().admit_request().await.is_err());
        assert!(!manager.azrael_admission().has_pending_switch());
        assert_eq!(std::fs::read(&root_auth).unwrap(), original);
        let admission = manager.azrael_admission();
        let recovery = admission.begin_explicit_recovery().unwrap();
        let guard = recovery.try_commit().unwrap();
        manager
            .set_external_auth(Arc::new(HealthySyntheticAuth))
            .await
            .unwrap();
        assert!(manager.auth_cached().is_some());
        admission.complete_retirement(&guard);
        drop(guard);
        drop(recovery);
        assert!(admission.admit_request().await.is_ok());
        assert_eq!(std::fs::read(root_auth).unwrap(), original);
    }
}

pub(super) fn start_monitor(processor: &Arc<AccountRequestProcessor>) {
    let weak = Arc::downgrade(processor);
    let cancellation = processor.workspace_routing_shutdown.clone();
    let handle = tokio::spawn(async move {
        let mut native_worker: Option<AbortOnDropHandle<()>> = None;
        let mut managed_workers = codex_core::account_retirement::RetirementWorkers::default();
        let mut interval = tokio::time::interval(Duration::from_millis(750));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                biased;
                _ = cancellation.cancelled() => break,
                _ = interval.tick() => {}
            }
            let Some(processor) = weak.upgrade() else {
                break;
            };
            if native_worker
                .as_ref()
                .is_none_or(|worker| worker.is_finished())
            {
                let native_processor = processor.clone();
                let native_cancellation = cancellation.clone();
                native_worker = Some(AbortOnDropHandle::new(tokio::spawn(async move {
                    tokio::select! {
                        _ = native_cancellation.cancelled() => {},
                        _ = native_processor.check_native_retirement() => {},
                    }
                })));
            }
            tokio::select! {
                biased;
                _ = cancellation.cancelled() => break,
                _ = async {
                    let result = codex_core::account_retirement::poll_threads(
                        &processor.thread_manager, &cancellation, &mut managed_workers,
                    ).await;
                    if result.is_err() {
                        tracing::debug!("managed account retirement status could not be checked");
                    }
                } => {}
            }
        }
    });
    *processor
        .retirement_monitor
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(AbortOnDropHandle::new(handle));
}

impl AccountRequestProcessor {
    pub(super) async fn restore_required_account_recovery(&self) {
        let _ = block_saved_recovery(&self.auth_manager);
        self.azrael.inner.lock().await.last_error = Some(
            "The account is unavailable. Work was stopped. Sign in again or select another account to continue.".to_string(),
        );
    }
    /// Choose admission from the requested model before a provider change is applied.
    pub(crate) async fn execution_admission_for_request(
        &self,
        request: &ClientRequest,
    ) -> Arc<codex_login::AzraelAuthAdmission> {
        let (thread_id, model) = match request {
            ClientRequest::ThreadStart { params, .. } => (None, params.model.as_deref()),
            ClientRequest::ThreadResume { params, .. } => {
                (Some(params.thread_id.as_str()), params.model.as_deref())
            }
            ClientRequest::ThreadFork { params, .. } => {
                (Some(params.thread_id.as_str()), params.model.as_deref())
            }
            ClientRequest::TurnStart { params, .. } => (
                Some(params.thread_id.as_str()),
                params
                    .collaboration_mode
                    .as_ref()
                    .map(|mode| mode.settings.model.as_str())
                    .or(params.model.as_deref()),
            ),
            ClientRequest::ThreadQueueStart { params, .. } => {
                (Some(params.thread_id.as_str()), None)
            }
            ClientRequest::ThreadCompactStart { params, .. } => {
                (Some(params.thread_id.as_str()), None)
            }
            ClientRequest::ThreadInjectItems { params, .. } => {
                (Some(params.thread_id.as_str()), None)
            }
            ClientRequest::ReviewStart { params, .. } => (Some(params.thread_id.as_str()), None),
            _ => return self.auth_manager.azrael_admission(),
        };
        if let Some(id) = thread_id.and_then(|id| ThreadId::from_string(id).ok()) {
            if let Ok(thread) = self.thread_manager.get_thread(id).await {
                return match model {
                    Some(model) => thread.auth_admission_for_model(model),
                    None => thread.auth_admission().await,
                };
            }
        }
        let model = model.or(self.config.model.as_deref());
        if model.is_some_and(codex_core::account_retirement::is_managed_execution_model)
            || (thread_id.is_some()
                && model.is_none()
                && self.auth_manager.azrael_admission().requires_recovery())
        {
            // Loading an unloaded thread is not inference. Core selects the actual
            // model's gate when an input/task is dispatched, including native recovery.
            Arc::new(codex_login::AzraelAuthAdmission::default())
        } else {
            self.auth_manager.azrael_admission()
        }
    }

    async fn check_native_retirement(&self) {
        let profile = self.azrael.inner.lock().await.active_profile.clone();
        let Some(profile) = profile else { return };
        match profile.status() {
            Ok(AzraelProfileStatus::Available) => {
                if self
                    .auth_manager
                    .auth_cached()
                    .as_ref()
                    .is_some_and(|auth| self.auth_manager.refresh_failure_for_auth(auth).is_some())
                {
                    // Propagate the outer owner's confirmed permanent failure to the profile.
                    if profile
                        .mark_reauthentication_required()
                        .await
                        .is_ok_and(|published| published)
                    {
                        let _ = self.retire_native_account(profile.id()).await;
                    }
                }
            }
            Ok(AzraelProfileStatus::ReauthenticationRequired) => {
                if profile
                    .mark_reauthentication_required()
                    .await
                    .is_ok_and(|published| published)
                {
                    let _ = self.retire_native_account(profile.id()).await;
                }
            }
            Ok(AzraelProfileStatus::Removed) => {
                let _ = self.retire_native_account(profile.id()).await;
            }
            Err(_) => tracing::debug!("native account retirement status could not be checked"),
        }
    }

    pub(super) async fn retire_native_account(&self, id: &str) -> io::Result<()> {
        let _serial = self.retirement_gate.lock().await;
        let affected = {
            let mut state = self.azrael.inner.lock().await;
            let affected = state
                .active_profile
                .as_ref()
                .is_some_and(|profile| profile.id() == id)
                || state.selected_profile_id.as_deref() == Some(id);
            if affected || state.pending_profile_id.as_deref() == Some(id) {
                if let Some(cancel) = state.switch_cancel.take() {
                    cancel.cancel();
                }
            }
            if state.login.as_ref().is_some_and(|login| {
                login.profile.id() == id || login.replacement_id.as_deref() == Some(id)
            }) {
                if let Some(login) = state.login.take() {
                    login.commit_cancel.cancel();
                    login.shutdown_handle.shutdown();
                }
            }
            affected
        };
        if !affected {
            return Ok(());
        }
        let admission = self.auth_manager.azrael_admission();
        let request = admission.begin_retirement();
        // Block queues and new tasks before aborting work. Interrupt uses the existing
        // cleanup path, including parked roots, reservations, tools and subagents.
        let mut interrupted = Vec::new();
        for thread_id in self.thread_manager.list_thread_ids().await {
            if let Ok(thread) = self.thread_manager.get_thread(thread_id).await {
                let execution = thread.account_execution_context().await;
                if Arc::ptr_eq(
                    &thread.auth_admission_for_model(&execution.model),
                    &admission,
                ) && execution.uses_openai_profile
                {
                    thread.close_account_retirement_admission(&execution.model);
                    interrupted.push(thread);
                }
            }
        }
        futures::future::join_all(
            interrupted
                .iter()
                .map(|thread| thread.interrupt_retired_work()),
        )
        .await;
        let guard =
            azrael::wait_for_switch_guard(&request, self.workspace_routing_shutdown.clone())
                .await?;
        {
            let mut state = self.azrael.inner.lock().await;
            state.active_profile = None;
            state.selected_profile_id = None;
            state.pending_profile_id = None;
            state.failed_closed_guard = None;
            state.requires_recovery = true;
        }
        azrael_state::write_recovery_states(
            &self.azrael.selection_path,
            self.azrael.default_selection_path.as_deref(),
        )?;
        let mut candidates = self.azrael.store.list()?;
        candidates.sort_by_key(|info| !info.auto_switch_allowed);
        for info in candidates {
            if info.id == id {
                continue;
            }
            let Ok(profile) = self.azrael.store.open(&info.id, &self.auth_manager).await else {
                continue;
            };
            let Ok(auth) = profile.resolve().await else {
                continue;
            };
            if !azrael::profile_identity_matches(&profile, Some(&auth)) {
                continue;
            }
            // Backend authentication, not a cached token, establishes replacement health.
            if !matches!(
                tokio::time::timeout(Duration::from_secs(10), self.azrael_usage(&info.id, false))
                    .await,
                Ok(Ok(_))
            ) {
                continue;
            }
            if profile.resolve().await.is_err() {
                continue;
            }
            let external: Arc<dyn ExternalAuth> = profile.clone();
            if self.auth_manager.set_external_auth(external).await.is_err()
                || !azrael::profile_identity_matches(
                    &profile,
                    self.auth_manager.auth_cached().as_ref(),
                )
            {
                continue;
            }
            azrael_state::write_selected_states(
                &self.azrael.selection_path,
                self.azrael.default_selection_path.as_deref(),
                Some(info.id.clone()),
            )?;
            {
                let mut state = self.azrael.inner.lock().await;
                state.active_profile = Some(profile.clone());
                state.selected_profile_id = Some(info.id);
                state.last_error = None;
                state.requires_recovery = false;
            }
            self.refresh_after_azrael_account_change().await;
            if profile.resolve().await.is_err()
                || !azrael::profile_identity_matches(
                    &profile,
                    self.auth_manager.auth_cached().as_ref(),
                )
            {
                let mut state = self.azrael.inner.lock().await;
                state.active_profile = None;
                state.selected_profile_id = None;
                state.requires_recovery = true;
                drop(state);
                azrael_state::write_recovery_states(
                    &self.azrael.selection_path,
                    self.azrael.default_selection_path.as_deref(),
                )?;
                continue;
            }
            self.auth_manager.release_azrael_unmanaged_auth_lease();
            admission.complete_retirement(&guard);
            self.reopen_native_account_threads().await;
            drop(guard);
            drop(request);
            return Ok(());
        }
        // Leave the unavailable external owner installed: clearing it would expose
        // an unrelated root login through reload. Explicit user recovery is required.
        self.azrael.inner.lock().await.last_error = Some(
            "The account is unavailable. Work was stopped. Sign in again or select another account to continue.".to_string(),
        );
        drop(guard);
        drop(request);
        self.send_azrael_update().await;
        Ok(())
    }

    pub(super) async fn reopen_native_account_threads(&self) {
        for id in self.thread_manager.list_thread_ids().await {
            if let Ok(thread) = self.thread_manager.get_thread(id).await {
                thread.clear_native_account_retirement();
            }
        }
    }
}

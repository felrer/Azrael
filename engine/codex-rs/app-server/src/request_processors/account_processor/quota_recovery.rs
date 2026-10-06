use super::*;
use codex_login::AzraelQuotaRecovery;
use codex_login::AzraelQuotaRecoveryContext;
use codex_login::AzraelQuotaRecoveryOutcome;
use codex_login::ExternalAuth;
use codex_login::ExternalAuthFuture;
use tokio::sync::OwnedRwLockWriteGuard;

impl AzraelQuotaRecovery for AccountRequestProcessor {
    fn recover(
        &self,
        context: AzraelQuotaRecoveryContext,
        guard: OwnedRwLockWriteGuard<()>,
    ) -> ExternalAuthFuture<'_, AzraelQuotaRecoveryOutcome> {
        Box::pin(async move {
            use AzraelQuotaRecoveryOutcome::*;
            if !source_matches(&self.auth_manager, &context) {
                return Ok(Superseded);
            }
            {
                let state = self.azrael.inner.lock().await;
                if state.pending_profile_id.is_some() || state.login.is_some() {
                    return Ok(Superseded);
                }
            }
            let profiles = self.azrael.store.list()?;
            // Candidates are metadata order, never presentation quota or current usage.
            for info in profiles {
                if !eligible(&info, &context) {
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
                if !source_matches(&self.auth_manager, &context) {
                    return Ok(Superseded);
                }
                // Recheck persisted permission and identity after credential resolution.
                let current = self
                    .azrael
                    .store
                    .list()?
                    .into_iter()
                    .find(|candidate| candidate.id == info.id);
                let Some(current) = current else {
                    continue;
                };
                if !eligible(&current, &context)
                    || current.workspace_account_id != info.workspace_account_id
                    || current.user_id != info.user_id
                    || auth.get_account_id().as_deref()
                        != Some(current.workspace_account_id.as_str())
                    || auth.get_chatgpt_user_id().as_deref() != Some(current.user_id.as_str())
                {
                    continue;
                }
                self.commit_azrael_switch(profile.clone(), /*retire_root_auth*/ false, guard)
                    .await;
                let committed = {
                    let state = self.azrael.inner.lock().await;
                    state.failed_closed_guard.is_none()
                        && state.last_error.is_none()
                        && state.selected_profile_id.as_deref() == Some(info.id.as_str())
                        && azrael_state::read_selected_state(&self.azrael.selection_path).as_deref()
                            == Some(info.id.as_str())
                        && self
                            .azrael
                            .default_selection_path
                            .as_deref()
                            .is_none_or(|path| {
                                azrael_state::read_selected_state(path).as_deref()
                                    == Some(info.id.as_str())
                            })
                        && azrael::profile_identity_matches(
                            &profile,
                            self.auth_manager.auth_cached().as_ref(),
                        )
                };
                if !committed && !source_matches(&self.auth_manager, &context) {
                    self.auth_manager.azrael_admission().block_new_work();
                    self.azrael.inner.lock().await.last_error = Some(
                        "Account recovery could not be verified. New work is blocked until restart.".to_string(),
                    );
                }
                return Ok(if committed {
                    Switched {
                        profile_id: info.id,
                    }
                } else {
                    Unavailable
                });
            }
            Ok(Unavailable)
        })
    }
    fn completed(&self) -> ExternalAuthFuture<'_, ()> {
        Box::pin(async move {
            self.send_azrael_update().await;
            Ok(())
        })
    }
}

fn source_matches(manager: &AuthManager, context: &AzraelQuotaRecoveryContext) -> bool {
    manager.auth_cached().is_some_and(|auth| {
        matches!(auth, CodexAuth::Chatgpt(_))
            && context.previous_account_id.is_some()
            && context.previous_user_id.is_some()
            && auth.get_account_id() == context.previous_account_id
            && auth.get_chatgpt_user_id() == context.previous_user_id
    })
}

fn eligible(info: &codex_login::AzraelProfileInfo, context: &AzraelQuotaRecoveryContext) -> bool {
    info.auto_switch_allowed
        && !context.excluded_profile_ids.contains(&info.id)
        && !context.excluded_profile_ids.contains(
            &serde_json::to_string(&(&info.workspace_account_id, &info.user_id))
                .unwrap_or_else(|error| panic!("serialize account identity: {error}")),
        )
        && !(context.previous_account_id.as_deref() == Some(info.workspace_account_id.as_str())
            && context.previous_user_id.as_deref() == Some(info.user_id.as_str()))
}

/// Cancellation during a binding transaction cannot reopen execution on partial state.
pub(super) struct CommitCompletion {
    pub(super) admission: Arc<codex_login::AzraelAuthAdmission>,
    pub(super) completed: bool,
}

impl Drop for CommitCompletion {
    fn drop(&mut self) {
        if !self.completed {
            self.admission.block_new_work();
        }
    }
}

#[cfg(test)]
#[path = "quota_recovery_tests.rs"]
mod tests;

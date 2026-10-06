//! Quota recovery ownership is separate from credential refresh authority.
use crate::AzraelTaskAuthLease;
use crate::ExternalAuthFuture;
use std::sync::Arc;
use tokio::sync::OwnedRwLockWriteGuard;

#[derive(Clone, Debug, Default)]
pub struct AzraelQuotaRecoveryContext {
    pub previous_account_id: Option<String>,
    pub previous_user_id: Option<String>,
    pub excluded_profile_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AzraelQuotaRecoveryOutcome {
    Switched { profile_id: String },
    Unavailable,
    Busy,
    Superseded,
}

/// Commits a quota-triggered destination while holding exclusive execution admission.
/// Implementations verify source identity and durable destination and drop the guard
/// before returning, or retain it only after blocking new work.
pub trait AzraelQuotaRecovery: Send + Sync {
    fn recover(
        &self,
        context: AzraelQuotaRecoveryContext,
        guard: OwnedRwLockWriteGuard<()>,
    ) -> ExternalAuthFuture<'_, AzraelQuotaRecoveryOutcome>;

    /// Publishes final state after the task pin is restored and admission reopens.
    fn completed(&self) -> ExternalAuthFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
}

pub(crate) async fn recover(
    lease: &AzraelTaskAuthLease,
    context: AzraelQuotaRecoveryContext,
    owner: Arc<dyn AzraelQuotaRecovery>,
) -> std::io::Result<AzraelQuotaRecoveryOutcome> {
    let recovery = match lease.begin_recovery() {
        Ok(recovery) => recovery,
        Err(outcome) => return Ok(outcome),
    };
    let Some(guard) = recovery.request.try_commit() else {
        return Ok(AzraelQuotaRecoveryOutcome::Busy);
    };
    let outcome = owner.recover(context, guard).await;
    drop(recovery);
    owner.completed().await?;
    outcome
}

#[cfg(test)]
#[path = "azrael_quota_recovery_tests.rs"]
mod tests;

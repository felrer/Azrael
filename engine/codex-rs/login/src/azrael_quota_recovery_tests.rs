use super::*;
use crate::AzraelAuthAdmission;
use std::sync::atomic::AtomicUsize;
use std::sync::atomic::Ordering;

struct Owner {
    calls: AtomicUsize,
    fail_closed: Option<Arc<AzraelAuthAdmission>>,
}
impl AzraelQuotaRecovery for Owner {
    fn recover(
        &self,
        _: AzraelQuotaRecoveryContext,
        guard: OwnedRwLockWriteGuard<()>,
    ) -> ExternalAuthFuture<'_, AzraelQuotaRecoveryOutcome> {
        Box::pin(async move {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if let Some(admission) = &self.fail_closed {
                admission.block_new_work();
                drop(guard);
                return Err(std::io::Error::other("unverified rollback"));
            }
            drop(guard);
            Ok(AzraelQuotaRecoveryOutcome::Switched {
                profile_id: "destination".into(),
            })
        })
    }
}

fn owner() -> Arc<Owner> {
    Arc::new(Owner {
        calls: AtomicUsize::new(0),
        fail_closed: None,
    })
}

#[tokio::test]
async fn single_task_recovers_and_restores_pin_until_explicit_finish() {
    let admission = Arc::new(AzraelAuthAdmission::default());
    let lease = admission.enter_task().await;
    let callback = owner();
    assert_eq!(
        recover(
            &lease,
            AzraelQuotaRecoveryContext::default(),
            callback.clone()
        )
        .await
        .unwrap(),
        AzraelQuotaRecoveryOutcome::Switched {
            profile_id: "destination".into()
        }
    );
    assert!(admission.has_active_work());
    assert!(!admission.is_pending());
    lease.finish();
    assert!(!admission.has_active_work());
    assert_eq!(
        recover(
            &lease,
            AzraelQuotaRecoveryContext::default(),
            callback.clone()
        )
        .await
        .unwrap(),
        AzraelQuotaRecoveryOutcome::Superseded
    );
    assert_eq!(callback.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn sibling_is_busy_and_manual_pending_has_precedence() {
    let admission = Arc::new(AzraelAuthAdmission::default());
    let lease = admission.enter_task().await;
    let sibling = admission.enter_task().await;
    let callback = owner();
    assert_eq!(
        recover(
            &lease,
            AzraelQuotaRecoveryContext::default(),
            callback.clone()
        )
        .await
        .unwrap(),
        AzraelQuotaRecoveryOutcome::Busy
    );
    assert!(admission.has_active_work());
    sibling.finish();
    let manual = admission.begin_switch().unwrap();
    assert_eq!(
        recover(
            &lease,
            AzraelQuotaRecoveryContext::default(),
            callback.clone()
        )
        .await
        .unwrap(),
        AzraelQuotaRecoveryOutcome::Superseded
    );
    assert_eq!(callback.calls.load(Ordering::SeqCst), 0);
    assert!(manual.try_commit().is_none());
    drop(manual);
    lease.finish();
    assert!(!admission.has_active_work());
}

#[tokio::test]
async fn failed_closed_recovery_does_not_wait_for_read_reacquisition() {
    let admission = Arc::new(AzraelAuthAdmission::default());
    let lease = admission.enter_task().await;
    let callback = Arc::new(Owner {
        calls: AtomicUsize::new(0),
        fail_closed: Some(admission.clone()),
    });
    assert!(
        recover(&lease, AzraelQuotaRecoveryContext::default(), callback)
            .await
            .is_err()
    );
    assert!(admission.admit_request().await.is_err());
    lease.finish();
}

struct RejectOwner;
impl AzraelQuotaRecovery for RejectOwner {
    fn recover(
        &self,
        _: AzraelQuotaRecoveryContext,
        guard: OwnedRwLockWriteGuard<()>,
    ) -> ExternalAuthFuture<'_, AzraelQuotaRecoveryOutcome> {
        Box::pin(async move {
            drop(guard);
            Err(std::io::Error::other("destination authentication rejected"))
        })
    }
}

#[tokio::test]
async fn rejected_destination_restores_execution_pin() {
    let admission = Arc::new(AzraelAuthAdmission::default());
    let lease = admission.enter_task().await;
    assert!(
        recover(
            &lease,
            AzraelQuotaRecoveryContext::default(),
            Arc::new(RejectOwner)
        )
        .await
        .is_err()
    );
    assert!(!admission.is_pending());
    assert!(admission.has_active_work());
    let manual = admission.begin_switch().unwrap();
    assert!(manual.try_commit().is_none());
    lease.finish();
    assert!(manual.try_commit().is_some());
}

#[tokio::test]
async fn callback_registration_is_weak_and_foreign_lease_is_rejected() {
    let manager = crate::AuthManager::from_auth_for_testing(crate::CodexAuth::from_api_key("test"));
    let callback: Arc<dyn AzraelQuotaRecovery> = owner();
    manager.set_azrael_quota_recovery(Arc::downgrade(&callback));
    let foreign = Arc::new(AzraelAuthAdmission::default()).enter_task().await;
    assert_eq!(
        manager
            .recover_usage_limit(&foreign, AzraelQuotaRecoveryContext::default())
            .await
            .unwrap(),
        AzraelQuotaRecoveryOutcome::Superseded
    );
    drop(callback);
    let lease = manager.azrael_admission().enter_task().await;
    assert_eq!(
        manager
            .recover_usage_limit(&lease, AzraelQuotaRecoveryContext::default())
            .await
            .unwrap(),
        AzraelQuotaRecoveryOutcome::Unavailable
    );
    assert!(manager.azrael_admission().has_active_work());
}

use super::*;
use pretty_assertions::assert_eq;

#[tokio::test]
async fn pending_switch_allows_child_completion_and_rejects_new_requests() {
    let admission = Arc::new(AzraelAuthAdmission::default());
    let parent = admission.enter_task().await;
    let pending = admission.begin_switch().unwrap();
    assert!(pending.try_commit().is_none());
    assert_eq!(
        admission.admit_request().await.unwrap_err().kind(),
        io::ErrorKind::WouldBlock
    );
    let child = tokio::time::timeout(std::time::Duration::from_secs(1), admission.enter_task())
        .await
        .unwrap();
    drop(parent);
    assert!(pending.try_commit().is_none());
    drop(child);
    let commit = pending.try_commit().unwrap();
    assert!(admission.begin_switch().is_err());
    drop(commit);
    drop(pending);
    assert!(admission.admit_request().await.is_ok());
}

#[tokio::test]
async fn cancelled_switch_keeps_existing_work_and_reopens_admission() {
    let admission = Arc::new(AzraelAuthAdmission::default());
    let task = admission.enter_task().await;
    let pending = admission.begin_switch().unwrap();
    drop(pending);
    assert!(admission.has_active_work());
    assert!(admission.admit_request().await.is_ok());
    drop(task);
    assert!(!admission.has_active_work());
}

#[tokio::test]
async fn commit_excludes_background_work_until_account_is_consistent() {
    let admission = Arc::new(AzraelAuthAdmission::default());
    let pending = admission.begin_switch().unwrap();
    let commit = pending.try_commit().unwrap();
    let waiting = {
        let admission = Arc::clone(&admission);
        tokio::spawn(async move { admission.enter_task().await })
    };
    tokio::task::yield_now().await;
    assert!(!waiting.is_finished());
    drop(commit);
    drop(pending);
    drop(waiting.await.unwrap());
    assert!(!admission.has_active_work());
}

#[tokio::test]
async fn explicit_queue_admission_pins_current_account_while_switch_waits() {
    let admission = Arc::new(AzraelAuthAdmission::default());
    let pending = admission.begin_switch().unwrap();
    let queued = admission.admit_queued_request().unwrap();
    assert!(pending.try_commit().is_none());
    assert_eq!(
        admission.admit_request().await.unwrap_err().kind(),
        io::ErrorKind::WouldBlock
    );
    let child = admission.enter_task().await;
    drop(queued);
    assert!(pending.try_commit().is_none());
    drop(child);
    let commit = pending.try_commit().unwrap();
    assert_eq!(
        admission.admit_queued_request().unwrap_err().kind(),
        io::ErrorKind::WouldBlock
    );
    drop(commit);
    drop(pending);
    assert!(admission.admit_queued_request().is_ok());
}

#[tokio::test]
async fn failed_recovery_blocks_both_admission_paths_after_switch_drops() {
    let admission = Arc::new(AzraelAuthAdmission::default());
    let pending = admission.begin_switch().unwrap();
    let commit = pending.try_commit().unwrap();
    admission.block_new_work();
    drop(commit);
    drop(pending);
    assert_eq!(
        admission.admit_queued_request().unwrap_err().kind(),
        io::ErrorKind::Other
    );
    assert_eq!(
        admission.admit_request().await.unwrap_err().kind(),
        io::ErrorKind::Other
    );
    assert!(admission.begin_switch().is_err());
}

#[tokio::test]
async fn notifications_reopen_on_completion_and_cancel_and_preserve_failure() {
    let admission = Arc::new(AzraelAuthAdmission::default());
    let mut changes = admission.subscribe_changes();
    let cancelled = admission.begin_switch().unwrap();
    changes.changed().await.unwrap();
    assert!(admission.is_pending());
    drop(cancelled);
    changes.changed().await.unwrap();
    assert!(!admission.is_pending());
    let completed = admission.begin_switch().unwrap();
    let commit = completed.try_commit().unwrap();
    drop(commit);
    drop(completed);
    changes.changed().await.unwrap();
    assert!(!admission.is_pending());
    let failed = admission.begin_switch().unwrap();
    let commit = failed.try_commit().unwrap();
    admission.block_new_work();
    drop(commit);
    drop(failed);
    changes.changed().await.unwrap();
    assert!(admission.is_pending());
}

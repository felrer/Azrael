use super::with_account_lease;
use std::sync::Arc;

#[tokio::test]
async fn memory_stream_account_lease_releases_when_cancelled() {
    let admission = Arc::new(codex_login::AzraelAuthAdmission::default());
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let operation = {
        let admission = Arc::clone(&admission);
        tokio::spawn(async move {
            with_account_lease(admission, async move {
                let _ = started_tx.send(());
                std::future::pending::<()>().await;
            })
            .await;
        })
    };

    started_rx.await.expect("leased operation should start");
    let pending_switch = admission.begin_switch().expect("begin account switch");
    assert!(pending_switch.try_commit().is_none());

    operation.abort();
    assert!(
        operation
            .await
            .expect_err("operation should be cancelled")
            .is_cancelled()
    );
    assert!(pending_switch.try_commit().is_some());
}

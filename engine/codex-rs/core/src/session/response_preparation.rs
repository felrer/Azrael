//! Bounds work performed before model dispatch. Never wraps inference, tools or human input waits.

use std::future::Future;
use std::time::Duration;

use codex_protocol::error::CodexErr;
use codex_protocol::error::Result as CodexResult;
use tokio_util::sync::CancellationToken;

pub(super) const DEADLINE: Duration = Duration::from_secs(90);
const TIMEOUT_MESSAGE: &str = "response preparation exceeded its 90s deadline";

pub(super) async fn run<T>(
    stage: &'static str,
    thread_id: &str,
    turn_id: &str,
    cancellation_token: &CancellationToken,
    operation: impl Future<Output = CodexResult<T>>,
) -> CodexResult<T> {
    run_with_deadline(
        stage,
        thread_id,
        turn_id,
        cancellation_token,
        DEADLINE,
        operation,
    )
    .await
}

async fn run_with_deadline<T>(
    stage: &'static str,
    thread_id: &str,
    turn_id: &str,
    cancellation_token: &CancellationToken,
    deadline: Duration,
    operation: impl Future<Output = CodexResult<T>>,
) -> CodexResult<T> {
    let started = tokio::time::Instant::now();
    tracing::info!(
        event = "response_preparation",
        stage,
        thread_id,
        turn_id,
        outcome = "started"
    );
    let (result, outcome) = tokio::select! {
        biased;
        _ = cancellation_token.cancelled() => (Err(CodexErr::TurnAborted), "cancelled"),
        result = tokio::time::timeout(deadline, operation) => match result {
            Ok(Ok(value)) => (Ok(value), "completed"),
            Ok(Err(error)) => (Err(error), "failed"),
            Err(_) => (Err(CodexErr::Fatal(TIMEOUT_MESSAGE.to_string())), "timed_out"),
        },
    };
    let elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    if outcome == "timed_out" {
        tracing::warn!(
            event = "response_preparation",
            stage,
            thread_id,
            turn_id,
            outcome,
            elapsed_ms
        );
    } else {
        tracing::info!(
            event = "response_preparation",
            stage,
            thread_id,
            turn_id,
            outcome,
            elapsed_ms
        );
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use codex_protocol::error::CodexErrorDetails;
    use std::sync::Arc;
    use std::sync::atomic::AtomicBool;
    use std::sync::atomic::Ordering;

    struct DropFlag(Arc<AtomicBool>);
    impl Drop for DropFlag {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    #[tokio::test]
    async fn response_preparation_timeout_drops_stalled_work_and_allows_next_request() {
        let dropped = Arc::new(AtomicBool::new(false));
        let drop_flag = DropFlag(Arc::clone(&dropped));
        let token = CancellationToken::new();
        let result: CodexResult<()> = run_with_deadline(
            "world_state",
            "thread",
            "turn",
            &token,
            Duration::from_millis(10),
            async move {
                let _drop_flag = drop_flag;
                std::future::pending().await
            },
        )
        .await;
        let error = result.expect_err("stalled preparation must terminate");
        assert!(
            matches!(error.details(), CodexErrorDetails::Fatal(message) if message == TIMEOUT_MESSAGE)
        );
        assert!(
            error.retry_delay(1).is_none(),
            "preparation must not automatically replay input"
        );
        assert!(dropped.load(Ordering::SeqCst));
        assert!(
            !token.is_cancelled(),
            "the deadline must not poison later turns"
        );
        assert_eq!(
            run("world_state", "thread", "next", &token, async { Ok(7) })
                .await
                .unwrap(),
            7
        );
    }

    #[tokio::test]
    async fn response_preparation_cancellation_drops_work_without_waiting_for_deadline() {
        let token = CancellationToken::new();
        let cancel = token.clone();
        let dropped = Arc::new(AtomicBool::new(false));
        let drop_flag = DropFlag(Arc::clone(&dropped));
        let result: CodexResult<()> =
            run("sampling_context", "thread", "turn", &token, async move {
                let _drop_flag = drop_flag;
                cancel.cancel();
                std::future::pending().await
            })
            .await;
        assert!(matches!(
            result.unwrap_err().details(),
            CodexErrorDetails::TurnAborted
        ));
        assert!(dropped.load(Ordering::SeqCst));
    }
}

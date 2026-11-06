use super::process::OutputDrainPolicy;
use super::process::UnifiedExecProcess;
use crate::unified_exec::UnifiedExecError;
use codex_exec_server::ExecProcess;
use codex_exec_server::ExecProcessEventReceiver;
use codex_exec_server::ExecProcessFuture;
use codex_exec_server::ExecServerError;
use codex_exec_server::ProcessId;
use codex_exec_server::ProcessSignal;
use codex_exec_server::ReadResponse;
use codex_exec_server::StartedExecProcess;
use codex_exec_server::WriteResponse;
use codex_exec_server::WriteStatus;
use pretty_assertions::assert_eq;
use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::sync::watch;

struct MockExecProcess {
    process_id: ProcessId,
    write_response: WriteResponse,
    read_responses: Mutex<VecDeque<ReadResponse>>,
    terminate_error: Option<String>,
    wake_tx: watch::Sender<u64>,
}

impl MockExecProcess {
    async fn read(&self) -> Result<ReadResponse, ExecServerError> {
        Ok(self
            .read_responses
            .lock()
            .await
            .pop_front()
            .unwrap_or(ReadResponse {
                chunks: Vec::new(),
                next_seq: 1,
                exited: false,
                exit_code: None,
                closed: false,
                failure: None,
                sandbox_denied: false,
            }))
    }

    async fn terminate(&self) -> Result<(), ExecServerError> {
        if let Some(message) = &self.terminate_error {
            return Err(ExecServerError::Protocol(message.clone()));
        }
        Ok(())
    }
}

impl ExecProcess for MockExecProcess {
    fn process_id(&self) -> &ProcessId {
        &self.process_id
    }

    fn subscribe_wake(&self) -> watch::Receiver<u64> {
        self.wake_tx.subscribe()
    }

    fn subscribe_events(&self) -> ExecProcessEventReceiver {
        ExecProcessEventReceiver::empty()
    }

    fn read(
        &self,
        _after_seq: Option<u64>,
        _max_bytes: Option<usize>,
        _wait_ms: Option<u64>,
    ) -> ExecProcessFuture<'_, ReadResponse> {
        Box::pin(MockExecProcess::read(self))
    }

    fn write(&self, _chunk: Vec<u8>) -> ExecProcessFuture<'_, WriteResponse> {
        Box::pin(async { Ok(self.write_response.clone()) })
    }

    fn signal(&self, _signal: ProcessSignal) -> ExecProcessFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }

    fn terminate(&self) -> ExecProcessFuture<'_, ()> {
        Box::pin(MockExecProcess::terminate(self))
    }
}

pub(super) async fn remote_process(
    write_status: WriteStatus,
    terminate_error: Option<String>,
    sandbox_type: impl Into<Option<codex_sandboxing::SandboxType>>,
) -> UnifiedExecProcess {
    let (wake_tx, _wake_rx) = watch::channel(0);
    let started = StartedExecProcess {
        process: Arc::new(MockExecProcess {
            process_id: "test-process".to_string().into(),
            write_response: WriteResponse {
                status: write_status,
            },
            read_responses: Mutex::new(VecDeque::new()),
            terminate_error,
            wake_tx,
        }),
        sandbox_type: sandbox_type.into(),
    };

    UnifiedExecProcess::from_exec_server_started(started, OutputDrainPolicy::WaitForOutputClosure)
        .await
        .expect("remote process should start")
}

#[tokio::test]
async fn remote_write_unknown_process_marks_process_exited() {
    let process = remote_process(
        WriteStatus::UnknownProcess,
        /*terminate_error*/ None,
        codex_sandboxing::SandboxType::None,
    )
    .await;

    let err = process
        .write(b"hello")
        .await
        .expect_err("expected write failure");

    assert!(matches!(err, UnifiedExecError::WriteToStdin));
    assert!(process.has_exited());
}

#[tokio::test]
async fn remote_write_closed_stdin_marks_process_exited() {
    let process = remote_process(
        WriteStatus::StdinClosed,
        /*terminate_error*/ None,
        codex_sandboxing::SandboxType::None,
    )
    .await;

    let err = process
        .write(b"hello")
        .await
        .expect_err("expected write failure");

    assert!(matches!(err, UnifiedExecError::WriteToStdin));
    assert!(process.has_exited());
}

#[tokio::test]
async fn fail_and_terminate_preserves_failure_message() {
    let process = remote_process(
        WriteStatus::Accepted,
        /*terminate_error*/ None,
        codex_sandboxing::SandboxType::None,
    )
    .await;

    process.fail_and_terminate("network denied".to_string());
    process.fail_and_terminate("second failure".to_string());

    assert!(process.has_exited());
    assert_eq!(
        process.failure_message(),
        Some("network denied".to_string())
    );
}

#[tokio::test]
async fn remote_terminate_confirmed_updates_state_on_success_only() {
    let process = remote_process(
        WriteStatus::Accepted,
        Some("terminate unavailable".to_string()),
        codex_sandboxing::SandboxType::None,
    )
    .await;

    let err = process
        .terminate_confirmed()
        .await
        .expect_err("expected terminate failure");

    assert!(matches!(err, UnifiedExecError::ProcessFailed { .. }));
    assert!(!process.has_exited());

    let process = remote_process(
        WriteStatus::Accepted,
        /*terminate_error*/ None,
        codex_sandboxing::SandboxType::None,
    )
    .await;

    process
        .terminate_confirmed()
        .await
        .expect("terminate should succeed");

    assert!(process.has_exited());
}

#[tokio::test]
async fn remote_process_preserves_executor_sandbox_type() {
    use codex_sandboxing::SandboxType;
    for sandbox_type in [
        None,
        Some(SandboxType::None),
        Some(SandboxType::LinuxSeccomp),
    ] {
        let process = remote_process(
            WriteStatus::Accepted,
            /*terminate_error*/ None,
            sandbox_type,
        )
        .await;
        assert_eq!(process.sandbox_type(), sandbox_type);
    }
}

// Real local pipe execution exercises the host receipt boundary independently
// of tool output formatting and transport mocks on Windows and Unix.
pub(super) async fn host_completion_process(script: &str) -> Arc<UnifiedExecProcess> {
    #[cfg(windows)]
    let (program, args) = (
        "powershell.exe",
        vec![
            "-NoProfile".into(),
            "-NonInteractive".into(),
            "-Command".into(),
            script.into(),
        ],
    );
    #[cfg(not(windows))]
    let (program, args) = ("sh", vec!["-c".into(), script.into()]);
    let spawned = codex_utils_pty::spawn_pipe_process_no_stdin(
        program,
        &args,
        &std::env::current_dir().unwrap(),
        &std::env::vars().collect(),
        &None,
        &[],
    )
    .await
    .unwrap();
    Arc::new(
        UnifiedExecProcess::from_spawned(
            spawned,
            codex_sandboxing::SandboxType::None,
            Box::new(super::process::NoopSpawnLifecycle),
        )
        .await
        .unwrap(),
    )
}

pub(super) async fn await_host_receipt(
    store: &crate::session::work_completion::WorkCompletionStore,
    id: &str,
) -> crate::session::work_completion::WorkCompletionRecord {
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let record = store.status(id.to_string()).await.unwrap();
            if record.state != crate::session::work_completion::WorkCompletionState::Running {
                return record;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("host must publish a bounded terminal receipt")
}

#[tokio::test]
async fn host_completion_observes_fast_success_and_failure() {
    use crate::session::work_completion::{WorkCompletionState, WorkCompletionStore};
    let home = tempfile::tempdir().unwrap();
    let store = WorkCompletionStore::for_test(home.path(), "exec-host");
    for (code, expected) in [
        (0, WorkCompletionState::Succeeded),
        (7, WorkCompletionState::Failed),
    ] {
        let work = store.create("fast executor".into(), 0).await.unwrap();
        let completion = store
            .bind_execution(&work.work_id, format!("fast-{code}"))
            .unwrap();
        let process = host_completion_process(&format!("exit {code}")).await;
        process.attach_work_completion(completion);
        let receipt = await_host_receipt(&store, &work.work_id).await;
        assert_eq!(receipt.state, expected);
        assert_eq!(receipt.exit_code, Some(code));
        drop(process);
        assert_eq!(
            store.status(work.work_id).await.unwrap().exit_code,
            Some(code)
        );
    }
}

#[tokio::test]
async fn host_completion_timeout_records_raw_exit_instead_of_synthetic_124() {
    use crate::session::work_completion::{WorkCompletionState, WorkCompletionStore};
    let home = tempfile::tempdir().unwrap();
    let store = WorkCompletionStore::for_test(home.path(), "exec-host");
    let work = store.create("timeout executor".into(), 0).await.unwrap();
    let completion = store
        .bind_execution(&work.work_id, "timeout-raw".into())
        .unwrap();
    #[cfg(windows)]
    let script = "Start-Sleep -Seconds 1; exit 7";
    #[cfg(not(windows))]
    let script = "sleep 1; exit 7";
    let process = host_completion_process(script).await;
    process.mark_timed_out();
    process.attach_work_completion(completion);
    let receipt = await_host_receipt(&store, &work.work_id).await;
    assert_eq!(receipt.state, WorkCompletionState::Failed);
    assert_eq!(receipt.exit_code, Some(7));
    assert_eq!(process.exit_code(), Some(124));
}

#[tokio::test]
async fn host_completion_dropped_live_handle_is_unknown_and_immutable() {
    use crate::session::work_completion::{WorkCompletionState, WorkCompletionStore};
    let home = tempfile::tempdir().unwrap();
    let store = WorkCompletionStore::for_test(home.path(), "exec-host");
    let work = store.create("dropped executor".into(), 0).await.unwrap();
    let completion = store
        .bind_execution(&work.work_id, "drop-without-callback".into())
        .unwrap();
    #[cfg(windows)]
    let script = "Start-Sleep -Seconds 20; exit 0";
    #[cfg(not(windows))]
    let script = "sleep 20; exit 0";
    let process = host_completion_process(script).await;
    assert!(!process.has_exited());
    process.attach_work_completion(completion.clone());
    drop(process);
    let receipt = await_host_receipt(&store, &work.work_id).await;
    assert_eq!(receipt.state, WorkCompletionState::Unknown);
    assert_eq!(receipt.exit_code, None);
    assert!(
        completion
            .complete(WorkCompletionState::Succeeded, Some(0), "invented success")
            .is_err()
    );
    assert_eq!(
        store.status(work.work_id).await.unwrap().state,
        WorkCompletionState::Unknown
    );
}

#[tokio::test]
async fn host_completion_policy_failure_without_exit_cannot_claim_success() {
    use crate::session::work_completion::{WorkCompletionState, WorkCompletionStore};
    let home = tempfile::tempdir().unwrap();
    let store = WorkCompletionStore::for_test(home.path(), "exec-host");
    let work = store
        .create("lost remote executor".into(), 0)
        .await
        .unwrap();
    let completion = store
        .bind_execution(&work.work_id, "lost-remote".into())
        .unwrap();
    let process = Arc::new(
        remote_process(
            WriteStatus::Accepted,
            None,
            codex_sandboxing::SandboxType::None,
        )
        .await,
    );
    process.attach_work_completion(completion);
    process.fail_and_terminate("network denied".into());
    let receipt = await_host_receipt(&store, &work.work_id).await;
    assert_eq!(receipt.state, WorkCompletionState::Unknown);
    assert_eq!(receipt.exit_code, None);
}

#[tokio::test]
async fn host_completion_policy_failure_overrides_observed_zero_exit() {
    use crate::session::work_completion::{WorkCompletionState, WorkCompletionStore};
    let home = tempfile::tempdir().unwrap();
    let store = WorkCompletionStore::for_test(home.path(), "exec-host");
    let work = store.create("denied executor".into(), 0).await.unwrap();
    let completion = store
        .bind_execution(&work.work_id, "denied-exit-zero".into())
        .unwrap();
    let process = host_completion_process("exit 0").await;
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while process.exit_code().is_none() {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    process.fail_and_terminate("policy denied".into());
    process.attach_work_completion(completion);
    let receipt = await_host_receipt(&store, &work.work_id).await;
    assert_eq!(receipt.state, WorkCompletionState::Failed);
    assert_eq!(receipt.exit_code, Some(0));
}

#[tokio::test]
async fn host_completion_explicit_termination_observes_actual_exit() {
    use crate::session::work_completion::{WorkCompletionState, WorkCompletionStore};
    let home = tempfile::tempdir().unwrap();
    let store = WorkCompletionStore::for_test(home.path(), "exec-host");
    let work = store.create("cancelled executor".into(), 0).await.unwrap();
    let completion = store
        .bind_execution(&work.work_id, "explicit-termination".into())
        .unwrap();
    #[cfg(windows)]
    let script = "Start-Sleep -Seconds 20; exit 0";
    #[cfg(not(windows))]
    let script = "sleep 20; exit 0";
    let process = host_completion_process(script).await;
    assert!(!process.has_exited());
    process.attach_work_completion(completion);
    process.terminate();
    let receipt = await_host_receipt(&store, &work.work_id).await;
    assert_eq!(receipt.state, WorkCompletionState::Cancelled);
    assert!(receipt.exit_code.is_some());
    assert_ne!(receipt.exit_code, Some(124));
}

#[tokio::test]
async fn host_completion_cleanup_preserves_natural_exit_before_observer_runs() {
    use crate::session::work_completion::{WorkCompletionState, WorkCompletionStore};
    let home = tempfile::tempdir().unwrap();
    let store = WorkCompletionStore::for_test(home.path(), "exec-host");
    for confirmed in [false, true] {
        for (code, state) in [
            (0, WorkCompletionState::Succeeded),
            (7, WorkCompletionState::Failed),
        ] {
            let work = store
                .create("natural exit cleanup".into(), 0)
                .await
                .unwrap();
            let completion = store
                .bind_execution(&work.work_id, format!("cleanup-{confirmed}-{code}"))
                .unwrap();
            let process = host_completion_process(&format!("exit {code}")).await;
            tokio::time::timeout(std::time::Duration::from_secs(10), async {
                while process.exit_code().is_none() {
                    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
            process.attach_work_completion(completion);
            // The current-thread runtime cannot poll the detached observer before
            // this synchronous cleanup inspects the already-observed raw exit.
            if confirmed {
                process.terminate_confirmed().await.unwrap();
            } else {
                process.terminate();
            }
            let receipt = await_host_receipt(&store, &work.work_id).await;
            assert_eq!(receipt.state, state);
            assert_eq!(receipt.exit_code, Some(code));
        }
    }
}

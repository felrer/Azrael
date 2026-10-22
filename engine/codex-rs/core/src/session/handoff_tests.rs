use super::*;
use crate::session::completed_session_loop_termination;
use crate::session::tests::make_session_and_context;
use crate::state::ActiveTurn;
use codex_protocol::protocol::AgentStatus;
use tokio::sync::watch;

fn submission(op: Op) -> Submission {
    Submission {
        id: "handoff-test".into(),
        op,
        turn_extension_init: None,
        trace: None,
        parent_turn_id: None,
        root_turn_id: None,
        residency_guard: None,
    }
}

fn io(capacity: usize) -> (SessionIo, async_channel::Receiver<Submission>) {
    let (sender, receiver) = async_channel::bounded(capacity);
    let (_events, rx_event) = async_channel::unbounded();
    (
        SessionIo {
            tx_sub: sender.into(),
            rx_event,
            agent_status: watch::channel(AgentStatus::PendingInit).1,
            session_loop_termination: completed_session_loop_termination(),
        },
        receiver,
    )
}

#[tokio::test]
async fn busy_reopens_shared_admission_and_preserves_accepted_order() {
    let (io, receiver) = io(4);
    io.submit(Op::Interrupt).await.unwrap();
    let caller = tokio::spawn({
        let io = io.clone();
        async move { io.try_shutdown_for_handoff().await }
    });
    assert!(matches!(receiver.recv().await.unwrap().op, Op::Interrupt));
    let Op::TryShutdownForHandoff { reply } = receiver.recv().await.unwrap().op else {
        panic!("ordered handoff")
    };
    assert!(io.submit(Op::Interrupt).await.is_err());
    assert!(
        io.tx_sub
            .clone()
            .send(submission(Op::Shutdown))
            .await
            .is_err()
    );
    reply.send(Ok(false)).unwrap();
    assert!(!caller.await.unwrap().unwrap());
    io.submit(Op::Interrupt).await.unwrap();
    assert!(matches!(receiver.recv().await.unwrap().op, Op::Interrupt));
}

#[tokio::test]
async fn ready_waits_for_session_loop_termination_and_keeps_admission_closed() {
    let (mut io, receiver) = io(1);
    let (finished, termination) = oneshot::channel();
    io.session_loop_termination =
        crate::session::session_loop_termination_from_handle(tokio::spawn(async move {
            termination.await.unwrap();
        }));
    let caller = tokio::spawn({
        let io = io.clone();
        async move { io.try_shutdown_for_handoff().await }
    });
    let Op::TryShutdownForHandoff { reply } = receiver.recv().await.unwrap().op else {
        panic!("handoff")
    };
    reply.send(Ok(true)).unwrap();
    tokio::task::yield_now().await;
    assert!(!caller.is_finished());
    assert!(io.submit(Op::Interrupt).await.is_err());
    finished.send(()).unwrap();
    assert!(caller.await.unwrap().unwrap());
    assert!(io.submit(Op::Interrupt).await.is_err());
}

#[tokio::test]
async fn disconnected_caller_does_not_cancel_barrier_or_busy_rollback() {
    let (io, receiver) = io(1);
    let caller = tokio::spawn({
        let io = io.clone();
        async move { io.try_shutdown_for_handoff().await }
    });
    let Op::TryShutdownForHandoff { reply } = receiver.recv().await.unwrap().op else {
        panic!("handoff")
    };
    caller.abort();
    reply.send(Ok(false)).unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        loop {
            if *io.tx_sub.open.lock().await {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(io.submit(Op::Interrupt).await.is_ok());
}

#[tokio::test]
async fn persistence_error_never_reports_success_or_reopens_admission() {
    let (io, receiver) = io(1);
    let caller = tokio::spawn({
        let io = io.clone();
        async move { io.try_shutdown_for_handoff().await }
    });
    let Op::TryShutdownForHandoff { reply } = receiver.recv().await.unwrap().op else {
        panic!("handoff")
    };
    reply
        .send(Err(CodexErr::Fatal("writer close failed".into())))
        .unwrap();
    assert!(caller.await.unwrap().is_err());
    assert!(io.submit(Op::Interrupt).await.is_err());
}

#[tokio::test]
async fn active_turn_and_elicitation_are_busy_without_cancellation() {
    let (session, _) = make_session_and_context().await;
    let session = Arc::new(session);
    *session.active_turn.lock().await = Some(ActiveTurn::default());
    assert!(!shutdown_if_idle(&session, "active".into()).await.unwrap());
    assert!(session.active_turn.lock().await.is_some());
    assert!(!session.state.lock().await.shutting_down);
    *session.active_turn.lock().await = None;
    let registration = session.services.elicitations.register();
    assert!(
        !shutdown_if_idle(&session, "elicitation".into())
            .await
            .unwrap()
    );
    assert!(*session.services.elicitations.subscribe().borrow());
    drop(registration);
}

#[tokio::test]
async fn active_task_remains_running_when_handoff_is_busy() {
    struct WaitingTask;
    impl crate::tasks::SessionTask for WaitingTask {
        fn kind(&self) -> crate::state::TaskKind {
            crate::state::TaskKind::Regular
        }
        fn span_name(&self) -> &'static str {
            "handoff_test.waiting"
        }
        async fn run(
            self: Arc<Self>,
            _session: Arc<Session>,
            _turn: Arc<crate::session::TurnContext>,
            _input: Vec<crate::session::TurnInput>,
            cancellation: tokio_util::sync::CancellationToken,
        ) -> crate::tasks::SessionTaskResult {
            cancellation.cancelled().await;
            Ok(None)
        }
    }
    let (session, turn) = make_session_and_context().await;
    let session = Arc::new(session);
    session
        .start_task(Arc::new(turn), Vec::new(), WaitingTask)
        .await;
    let cancellation = session
        .active_turn
        .lock()
        .await
        .as_ref()
        .unwrap()
        .task
        .as_ref()
        .unwrap()
        .cancellation_token
        .clone();
    assert!(!shutdown_if_idle(&session, "task".into()).await.unwrap());
    assert!(!cancellation.is_cancelled());
    assert!(
        session
            .active_turn
            .lock()
            .await
            .as_ref()
            .unwrap()
            .task
            .is_some()
    );
    session
        .abort_all_tasks(codex_protocol::protocol::TurnAbortReason::Interrupted)
        .await;
}

#[tokio::test]
async fn runtime_seal_refuses_shared_members_and_never_cancels_owner() {
    let (session, _) = make_session_and_context().await;
    let session = Arc::new(session);
    let runtime = &session.services.local_agent_runtime;
    let owner = runtime.admit_start().unwrap();
    let descendant = runtime.admit_start().unwrap();
    assert!(
        !shutdown_if_idle(&session, "shared-runtime".into())
            .await
            .unwrap()
    );
    assert!(!runtime.try_seal_for_handoff());
    assert!(!runtime.shutdown.is_cancelled());
    drop(descendant);
    assert!(runtime.try_seal_for_handoff());
    assert!(!runtime.shutdown.is_cancelled());
    assert!(runtime.admit_start().is_err());
    drop(owner);
}

async fn persistent_session() -> (
    tempfile::TempDir,
    crate::thread_manager::ThreadManager,
    Arc<crate::CodexThread>,
) {
    let home = tempfile::tempdir().unwrap();
    let mut config = crate::session::tests::build_test_config(home.path()).await;
    config.ephemeral = false;
    config.model_provider.base_url = Some("http://127.0.0.1:1/v1".into());
    config.model_provider.supports_websockets = false;
    let manager = crate::thread_manager::ThreadManager::with_models_provider_and_home_for_tests(
        codex_login::CodexAuth::from_api_key("Test API Key"),
        config.model_provider.clone(),
        home.path().to_path_buf(),
        Arc::new(codex_exec_server::EnvironmentManager::default_for_tests()),
    );
    let thread = manager
        .start_thread(crate::thread_manager::StartThreadOptions::new(config))
        .await
        .unwrap()
        .thread;
    (home, manager, thread)
}

#[tokio::test]
async fn pending_host_approval_is_busy_and_preserved() {
    let (_home, _manager, thread) = persistent_session().await;
    let session = &thread.session;
    session
        .request_host_approval(
            &"a".repeat(64),
            "host:handoff".into(),
            "b".repeat(64),
            serde_json::json!({}),
        )
        .await
        .unwrap();
    assert!(!shutdown_if_idle(session, "approval".into()).await.unwrap());
    assert_eq!(session.pending_approval_count(), 1);
    assert!(!session.state.lock().await.shutting_down);
    thread.shutdown_and_wait().await.unwrap();
}

#[tokio::test]
async fn real_writer_failure_never_reports_ready() {
    let (_home, _manager, thread) = persistent_session().await;
    let session = &thread.session;
    // Closing the actual local writer makes the next persistence barrier fail.
    session.live_thread().unwrap().shutdown().await.unwrap();
    let error = shutdown_if_idle(session, "writer-failure".into())
        .await
        .unwrap_err();
    assert!(
        error.to_string().contains("pre-handoff flush failed"),
        "{error}"
    );
    assert!(!session.state.lock().await.shutting_down);
    thread.shutdown_and_wait().await.unwrap();
}

#[tokio::test]
async fn idle_handoff_closes_writer_and_blocks_task_and_scheduler_starts() {
    let (_home, _manager, thread) = persistent_session().await;
    let session = &thread.session;
    assert!(thread.try_shutdown_for_handoff().await.unwrap());
    assert!(session.state.lock().await.shutting_down);
    assert!(session.services.local_agent_runtime.admit_start().is_err());
    assert!(session.reserve_pending_work_turn().await.is_none());
    let turn = session.new_default_turn().await;
    session
        .start_task(turn, Vec::new(), crate::tasks::RegularTask::new())
        .await;
    assert!(session.active_turn.lock().await.is_none());
    assert!(session.live_thread().unwrap().flush().await.is_err());
}

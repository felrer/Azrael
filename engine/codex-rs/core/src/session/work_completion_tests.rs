use super::*;

fn new_store(home: &Path, thread_id: &str) -> WorkCompletionStore {
    WorkCompletionStore {
        directory: home.join(thread_id),
        thread_id: thread_id.to_string(),
        changed: Arc::new(Notify::new()),
    }
}

fn signal(id: &str, state: WorkCompletionState) -> WorkCompletionSignal {
    WorkCompletionSignal {
        work_id: id.to_string(),
        state,
        summary: Some("producer result".to_string()),
        exit_code: Some(0),
    }
}

fn external_write(path: &Path, bytes: &[u8]) {
    let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap()).unwrap();
    file.write_all(bytes).unwrap();
    file.as_file().sync_all().unwrap();
    file.persist_noclobber(path).unwrap();
}

#[tokio::test]
async fn terminal_results_are_sticky_and_metadata_is_immutable() {
    let home = tempfile::tempdir().unwrap();
    let store = new_store(home.path(), "owner");
    for state in [
        WorkCompletionState::Succeeded,
        WorkCompletionState::Failed,
        WorkCompletionState::Cancelled,
    ] {
        let record = store
            .create(" local build ".to_string(), 123)
            .await
            .unwrap();
        assert_eq!(record.label, "local build");
        assert_eq!(record.state, WorkCompletionState::Running);
        let metadata = store.directory.join(format!("{}.json", record.work_id));
        let original = std::fs::read(&metadata).unwrap();
        let terminal = signal(&record.work_id, state.clone());
        assert_eq!(store.finish(terminal.clone()).await.unwrap().state, state);
        assert_eq!(store.finish(terminal.clone()).await.unwrap().state, state);
        let mut conflicting = terminal;
        conflicting.summary = Some("different result".to_string());
        assert!(store.finish(conflicting).await.is_err());
        assert_eq!(std::fs::read(metadata).unwrap(), original);
        let restarted = new_store(home.path(), "owner");
        let durable = restarted.status(record.work_id).await.unwrap();
        assert_eq!(durable.state, state);
        assert_eq!(durable.summary.as_deref(), Some("producer result"));
    }
}

#[tokio::test]
async fn wait_all_requires_every_id_and_observes_external_atomic_signals() {
    let home = tempfile::tempdir().unwrap();
    let store = new_store(home.path(), "owner");
    let first = store.create("first".to_string(), 1).await.unwrap();
    let second = store.create("second".to_string(), 2).await.unwrap();
    let ids = vec![first.work_id.clone(), second.work_id.clone()];
    let waiting_store = store.clone();
    let waiter = tokio::spawn(async move { waiting_store.wait_all(&ids).await });
    store
        .finish(signal(&first.work_id, WorkCompletionState::Succeeded))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert!(
        !waiter.is_finished(),
        "one completed ID must not satisfy the wait"
    );
    external_write(
        &second.signal_path,
        &serde_json::to_vec(&signal(&second.work_id, WorkCompletionState::Failed)).unwrap(),
    );
    let results = tokio::time::timeout(Duration::from_secs(3), waiter)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].state, WorkCompletionState::Succeeded);
    assert_eq!(results[1].state, WorkCompletionState::Failed);
    assert_eq!(
        store.wait_all(&[second.work_id]).await.unwrap()[0].state,
        WorkCompletionState::Failed
    );
}

#[tokio::test]
async fn invalid_signals_fail_closed() {
    let home = tempfile::tempdir().unwrap();
    let store = new_store(home.path(), "owner");
    let mut invalid = vec![b"{broken".to_vec(), vec![b' '; 8193]];
    for state in [
        WorkCompletionState::Running,
        WorkCompletionState::Succeeded,
        WorkCompletionState::Unknown,
    ] {
        invalid
            .push(serde_json::to_vec(&signal(&uuid::Uuid::new_v4().to_string(), state)).unwrap());
    }
    for bytes in invalid {
        let record = store.create("invalid signal".to_string(), 1).await.unwrap();
        external_write(&record.signal_path, &bytes);
        assert!(store.status(record.work_id.clone()).await.is_err());
        assert!(store.wait_all(&[record.work_id.clone()]).await.is_err());
        assert!(
            store
                .finish(signal(&record.work_id, WorkCompletionState::Succeeded))
                .await
                .is_err()
        );
        assert_eq!(std::fs::read(&record.signal_path).unwrap(), bytes);
    }
}

// Retained regression coverage: a missing host observation must never imply success or tree stop.
#[tokio::test]
async fn host_results_are_durable_exclusive_and_immutable() {
    let home = tempfile::tempdir().unwrap();
    let store = new_store(home.path(), "owner");
    for (state, exit_code) in [
        (WorkCompletionState::Succeeded, Some(0)),
        (WorkCompletionState::Failed, Some(23)),
        (WorkCompletionState::Cancelled, None),
    ] {
        let record = store.create("host work".to_string(), 1).await.unwrap();
        let metadata_path = store.directory.join(format!("{}.json", record.work_id));
        let original = std::fs::read(&metadata_path).unwrap();
        let completion = store
            .bind_execution(&record.work_id, "tool-call-id".to_string())
            .unwrap();
        let binding_path = store.sibling(&record.work_id, "execution.json");
        let binding = std::fs::read(&binding_path).unwrap();
        let restarted = new_store(home.path(), "owner");
        let active = restarted.status(record.work_id.clone()).await.unwrap();
        assert_eq!(active.state, WorkCompletionState::Running);
        assert_eq!(active.execution.unwrap().execution_id, "tool-call-id");
        assert!(
            store
                .bind_execution(&record.work_id, "second".to_string())
                .is_err()
        );
        assert!(
            store
                .finish(signal(&record.work_id, WorkCompletionState::Succeeded))
                .await
                .is_err()
        );
        // Even an independently written external signal cannot become authoritative after binding.
        external_write(&record.signal_path, b"{malformed external signal");
        completion
            .complete(state.clone(), exit_code, "observed exit")
            .unwrap();
        completion
            .complete(state.clone(), exit_code, "observed exit")
            .unwrap();
        assert!(
            completion
                .complete(WorkCompletionState::Unknown, None, "conflicting")
                .is_err()
        );
        drop(completion);
        let durable = restarted.status(record.work_id.clone()).await.unwrap();
        assert_eq!(durable.state, state);
        assert_eq!(durable.exit_code, exit_code);
        assert_eq!(durable.summary.as_deref(), Some("observed exit"));
        assert_eq!(std::fs::read(metadata_path).unwrap(), original);
        assert_eq!(std::fs::read(binding_path).unwrap(), binding);
        assert!(
            restarted
                .bind_execution(&record.work_id, "third".to_string())
                .is_err()
        );
    }
}

#[tokio::test]
async fn last_host_handle_drop_records_unknown_without_exit_code() {
    let home = tempfile::tempdir().unwrap();
    let store = new_store(home.path(), "owner");
    let record = store
        .create("dropped observer".to_string(), 1)
        .await
        .unwrap();
    let completion = store
        .bind_execution(&record.work_id, "call".to_string())
        .unwrap();
    let last = completion.clone();
    assert!(
        completion
            .complete(WorkCompletionState::Running, None, "invalid")
            .is_err()
    );
    assert!(
        completion
            .complete(WorkCompletionState::Unknown, Some(0), "invalid")
            .is_err()
    );
    drop(completion);
    assert_eq!(
        store.status(record.work_id.clone()).await.unwrap().state,
        WorkCompletionState::Running
    );
    drop(last);
    let result = store
        .wait_all(&[record.work_id.clone()])
        .await
        .unwrap()
        .remove(0);
    assert_eq!(result.state, WorkCompletionState::Unknown);
    assert_eq!(result.exit_code, None);
    assert_eq!(result.summary.as_deref(), Some(OBSERVATION_LOST));
    assert!(
        store
            .finish(signal(&record.work_id, WorkCompletionState::Succeeded))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn recovery_uses_exact_os_lease_and_persists_lost_observation() {
    let home = tempfile::tempdir().unwrap();
    let store = new_store(home.path(), "owner");
    let record = store.create("lost engine".to_string(), 1).await.unwrap();
    // Construct the durable boundary left by a crashed engine without invoking handle Drop.
    let execution = WorkExecution {
        work_id: record.work_id.clone(),
        thread_id: "owner".to_string(),
        execution_id: "crashed-call".to_string(),
    };
    let lease = open_lock(&store.sibling(&record.work_id, "execution.lock"), true).unwrap();
    lease.try_lock().unwrap();
    publish_once(
        &store.sibling(&record.work_id, "execution.json"),
        &execution,
    )
    .unwrap();
    let restarted = new_store(home.path(), "owner");
    assert_eq!(
        restarted
            .status(record.work_id.clone())
            .await
            .unwrap()
            .state,
        WorkCompletionState::Running
    );
    drop(lease);
    let recovered = restarted.status(record.work_id.clone()).await.unwrap();
    assert_eq!(recovered.state, WorkCompletionState::Unknown);
    assert_eq!(recovered.exit_code, None);
    assert_eq!(recovered.execution, Some(execution));
    let receipt_path = store.sibling(&record.work_id, "host-terminal.json");
    let receipt = std::fs::read(&receipt_path).unwrap();
    assert_eq!(
        store.status(record.work_id).await.unwrap().state,
        WorkCompletionState::Unknown
    );
    assert_eq!(std::fs::read(receipt_path).unwrap(), receipt);
}

#[tokio::test]
async fn supported_finish_and_bind_share_a_nonblocking_mutation_lease() {
    let home = tempfile::tempdir().unwrap();
    let store = new_store(home.path(), "owner");
    let record = store
        .create("serialized binding".to_string(), 1)
        .await
        .unwrap();
    let mutation = store.mutation_lease(&record.work_id).unwrap();
    assert!(
        store
            .bind_execution(&record.work_id, "call".to_string())
            .is_err()
    );
    assert!(
        store
            .finish(signal(&record.work_id, WorkCompletionState::Succeeded))
            .await
            .is_err()
    );
    assert!(!store.sibling(&record.work_id, "execution.json").exists());
    assert!(!record.signal_path.exists());
    drop(mutation);
    store
        .finish(signal(&record.work_id, WorkCompletionState::Succeeded))
        .await
        .unwrap();
    assert!(
        store
            .bind_execution(&record.work_id, "call".to_string())
            .is_err()
    );
}

#[tokio::test]
async fn host_binding_and_receipts_fail_closed() {
    let home = tempfile::tempdir().unwrap();
    let store = new_store(home.path(), "owner");
    let unbound = store.create("external".to_string(), 1).await.unwrap();
    assert!(
        serde_json::to_value(&unbound)
            .unwrap()
            .get("execution")
            .is_none()
    );
    assert!(
        store
            .bind_execution(&unbound.work_id, " ".to_string())
            .is_err()
    );
    assert!(
        store
            .finish(signal(&unbound.work_id, WorkCompletionState::Unknown))
            .await
            .is_err()
    );
    store
        .finish(signal(&unbound.work_id, WorkCompletionState::Failed))
        .await
        .unwrap();
    assert!(
        store
            .bind_execution(&unbound.work_id, "late".to_string())
            .is_err()
    );

    for bytes in [
        b"{broken".to_vec(),
        serde_json::to_vec(&WorkExecution {
            work_id: uuid::Uuid::new_v4().to_string(),
            thread_id: "foreign".to_string(),
            execution_id: "foreign".to_string(),
        })
        .unwrap(),
    ] {
        let record = store
            .create("invalid binding".to_string(), 1)
            .await
            .unwrap();
        external_write(&store.sibling(&record.work_id, "execution.json"), &bytes);
        assert!(store.status(record.work_id.clone()).await.is_err());
        assert!(
            store
                .bind_execution(&record.work_id, "call".to_string())
                .is_err()
        );
    }
    for foreign in [false, true] {
        let record = store
            .create("invalid receipt".to_string(), 1)
            .await
            .unwrap();
        let completion = store
            .bind_execution(&record.work_id, "call".to_string())
            .unwrap();
        let mut receipt = HostTerminal {
            execution: completion.0.execution.clone(),
            state: WorkCompletionState::Succeeded,
            exit_code: Some(0),
            summary: "result".to_string(),
        };
        receipt.execution.thread_id = "foreign".to_string();
        let bytes = if foreign {
            serde_json::to_vec(&receipt).unwrap()
        } else {
            b"{broken".to_vec()
        };
        let path = store.sibling(&record.work_id, "host-terminal.json");
        external_write(&path, &bytes);
        assert!(store.status(record.work_id.clone()).await.is_err());
        assert!(
            completion
                .complete(WorkCompletionState::Succeeded, Some(0), "result")
                .is_err()
        );
        drop(completion);
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }
}

#[tokio::test]
async fn thread_ownership_and_canonical_ids_are_enforced() {
    let home = tempfile::tempdir().unwrap();
    let owner = new_store(home.path(), "owner");
    let record = owner.create("owned".to_string(), 1).await.unwrap();
    let foreign = new_store(home.path(), "foreign");
    assert!(foreign.status(record.work_id.clone()).await.is_err());
    assert!(
        foreign
            .bind_execution(&record.work_id, "foreign".to_string())
            .is_err()
    );
    std::fs::create_dir_all(&foreign.directory).unwrap();
    std::fs::copy(
        owner.directory.join(format!("{}.json", record.work_id)),
        foreign.directory.join(format!("{}.json", record.work_id)),
    )
    .unwrap();
    assert!(foreign.status(record.work_id.clone()).await.is_err());
    assert!(
        foreign
            .finish(signal(&record.work_id, WorkCompletionState::Succeeded))
            .await
            .is_err()
    );
    for id in [
        "../escape".to_string(),
        record.work_id.to_uppercase(),
        uuid::Uuid::new_v4().to_string(),
    ] {
        assert!(owner.status(id).await.is_err());
    }
}

#[tokio::test]
async fn terminal_summary_limit_counts_utf8_bytes_and_running_is_rejected() {
    let home = tempfile::tempdir().unwrap();
    let store = new_store(home.path(), "owner");
    let record = store.create("byte limit".to_string(), 1).await.unwrap();
    let mut terminal = signal(&record.work_id, WorkCompletionState::Succeeded);
    terminal.summary = Some("é".repeat(257));
    assert!(store.finish(terminal.clone()).await.is_err());
    terminal.summary = Some("é".repeat(256));
    terminal.state = WorkCompletionState::Running;
    assert!(store.finish(terminal.clone()).await.is_err());
    assert_eq!(
        store.status(record.work_id.clone()).await.unwrap().state,
        WorkCompletionState::Running
    );
    terminal.state = WorkCompletionState::Succeeded;
    assert_eq!(
        store.finish(terminal).await.unwrap().summary.unwrap().len(),
        512
    );
}

use super::*;

#[tokio::test]
async fn pre_resume_claim_is_exclusive_and_fences_later_original_requests() {
    let thread = ThreadId::new().to_string();
    let unrelated = ThreadId::new().to_string();
    let mut scopes = HashMap::new();
    let first = SessionScope {
        thread: thread.clone(),
        context: "a".repeat(32),
        workspace: "b".repeat(64),
        target: "c".repeat(64),
        host: capture_process_identity(std::process::id())
            .await
            .unwrap()
            .unwrap(),
    };
    assert_eq!(
        bind_session_scope_if_unsubscribed(&mut scopes, ConnectionId(3), first, &[]),
        "attached"
    );
    // Neither attachment has resumed or created a thread subscription yet.
    let competing = SessionScope {
        thread: thread.clone(),
        context: "a".repeat(32),
        workspace: "b".repeat(64),
        target: "c".repeat(64),
        host: capture_process_identity(std::process::id())
            .await
            .unwrap()
            .unwrap(),
    };
    assert_eq!(
        bind_session_scope_if_unsubscribed(&mut scopes, ConnectionId(4), competing, &[]),
        "busy"
    );
    assert!(!scopes.contains_key(&ConnectionId(4)));
    assert_eq!(scopes.len(), 1);
    // The same admission predicate gates thread/resume and other exact-thread RPCs.
    assert!(!session_claim_allows_request(
        &scopes,
        ConnectionId(1),
        &thread
    ));
    assert!(!session_claim_allows_request(
        &scopes,
        ConnectionId(1),
        &thread.to_uppercase()
    ));
    assert!(!session_claim_allows_request(
        &scopes,
        ConnectionId(4),
        &thread
    ));
    assert!(session_claim_allows_request(
        &scopes,
        ConnectionId(3),
        &thread
    ));
    assert!(session_claim_allows_request(
        &scopes,
        ConnectionId(1),
        &unrelated
    ));
    scopes.remove(&ConnectionId(3));
    assert!(session_claim_allows_request(
        &scopes,
        ConnectionId(1),
        &thread
    ));
}

#[tokio::test]
async fn live_session_subscriber_returns_busy_without_control_or_approval_route() {
    use crate::thread_state::{ConnectionCapabilities, ThreadStateManager};
    let home = tempfile::tempdir().unwrap();
    let mut registry = new_registry(home.path());
    let original = registration(home.path(), 'a');
    registry.bind(&original).unwrap();
    let thread = ThreadId::new();
    let unrelated = ThreadId::new();
    let manager = ThreadStateManager::new();
    for connection in [ConnectionId(1), ConnectionId(2)] {
        manager
            .connection_initialized(
                connection,
                ConnectionCapabilities {
                    request_attestation: false,
                },
            )
            .await;
    }
    assert!(
        manager
            .try_ensure_connection_subscribed(thread, ConnectionId(1), false)
            .await
            .is_some()
    );
    assert!(
        manager
            .try_ensure_connection_subscribed(unrelated, ConnectionId(2), false)
            .await
            .is_some()
    );
    let scope = SessionScope {
        thread: thread.to_string(),
        context: original.owner_id.clone(),
        workspace: original.workspace_id.clone(),
        target: "b".repeat(64),
        host: capture_process_identity(std::process::id())
            .await
            .unwrap()
            .unwrap(),
    };
    let owners = HashMap::from([(ConnectionId(1), original.owner_id.clone())]);
    let mut scopes = HashMap::new();
    assert_eq!(
        bind_session_scope_if_unsubscribed(
            &mut scopes,
            ConnectionId(3),
            scope,
            &manager.subscribed_connection_ids(thread).await
        ),
        "busy"
    );
    assert!(!scopes.contains_key(&ConnectionId(3)));
    // Incoming control and callback replies cannot select any processor without a binding.
    assert_eq!(
        routed_context(&registry, &owners, &scopes, ConnectionId(3)),
        None
    );
    assert_eq!(
        routed_context(&registry, &owners, &scopes, ConnectionId(1)),
        Some(original.owner_id.clone())
    );
    assert_eq!(
        manager.subscribed_connection_ids(thread).await,
        vec![ConnectionId(1)]
    );
    manager
        .unsubscribe_connection_from_thread(thread, ConnectionId(1))
        .await;
    let scope = SessionScope {
        thread: thread.to_string(),
        context: original.owner_id,
        workspace: original.workspace_id,
        target: "b".repeat(64),
        host: capture_process_identity(std::process::id())
            .await
            .unwrap()
            .unwrap(),
    };
    assert_eq!(
        bind_session_scope_if_unsubscribed(
            &mut scopes,
            ConnectionId(4),
            scope,
            &manager.subscribed_connection_ids(thread).await
        ),
        "attached"
    );
    assert!(scopes.contains_key(&ConnectionId(4)));
    assert_eq!(
        manager.subscribed_connection_ids(unrelated).await,
        vec![ConnectionId(2)]
    );
}

#[tokio::test]
async fn target_restore_error_fences_only_selected_session_and_retains_lease() {
    let home = tempfile::tempdir().unwrap();
    let mut registry = new_registry(home.path());
    let first = registration(home.path(), 'a');
    let other = registration(home.path(), 'b');
    registry.bind(&first).unwrap();
    registry.bind(&other).unwrap();
    let thread = thread_id();
    let unrelated = thread_id();
    let context = "d".repeat(32);
    registry.saved.owners.insert(
        context.clone(),
        Owner {
            workspace_id: first.workspace_id.clone(),
            account_state_file: home.path().join("isolated.json"),
            account_default_file: None,
            context: context.clone(),
            session_thread: Some(thread.clone()),
            session_handoff_pending: true,
        },
    );
    registry
        .saved
        .threads
        .insert(thread.clone(), context.clone());
    registry
        .saved
        .threads
        .insert(unrelated.clone(), other.owner_id.clone());
    let mut leases =
        crate::azrael_thread_engines::ThreadEngineLeases::new(home.path(), &"a".repeat(64))
            .await
            .unwrap();
    leases.acquire(&thread).unwrap();
    leases.acquire(&unrelated).unwrap();
    let compatibility = serde_json::json!({"abi":1});
    let receipt = Receipt {
        schema: 1,
        protocol: 1,
        state: "stopped".into(),
        thread_id: thread.clone(),
        workspace_id: first.workspace_id.clone(),
        source_instance_id: "b".repeat(64),
        source_identity: "c".repeat(64),
        target_instance_id: "a".repeat(64),
        storage_compatibility: compatibility.clone(),
        selection: Selection {
            selected_profile_id: None,
            requires_recovery: false,
        },
        resume: serde_json::json!({"incomplete":true}),
    };
    let error = validated_target_snapshot(
        &receipt,
        &thread,
        &first.workspace_id,
        &"a".repeat(64),
        &compatibility,
    )
    .err()
    .expect("corrupt runtime snapshot rejected");
    let mut failed = HashSet::new();
    let mut routes = HashMap::new();
    let (tx, mut rx) = mpsc::channel(4);
    isolate_target_restore_error(
        &registry,
        &mut routes,
        &mut failed,
        &tx,
        ConnectionId(1),
        RequestId::Integer(7),
        &thread,
        error,
    )
    .await
    .unwrap();
    assert!(matches!(
        rx.recv().await,
        Some(OutgoingEnvelope::ToConnection {
            connection_id: ConnectionId(1),
            message: OutgoingMessage::Error(_),
            ..
        })
    ));
    assert_eq!(
        routes.get(&(ConnectionId(1), thread.clone())),
        Some(&context)
    );
    assert!(failed.contains(&thread));
    assert!(!failed.contains(&unrelated));
    assert!(registry.saved.owners[&context].session_handoff_pending);
    assert_eq!(registry.context(&other.owner_id).unwrap(), other.owner_id);
    assert_eq!(registry.saved.threads[&unrelated], other.owner_id);
    let owned = leases.owned_threads();
    assert!(owned.contains(&ThreadId::from_string(&thread).unwrap()));
    assert!(owned.contains(&ThreadId::from_string(&unrelated).unwrap()));
    // The outbound channel remains usable for another context after the selected failure.
    send_error(
        &tx,
        ConnectionId(2),
        RequestId::Integer(8),
        "unrelated reply",
    )
    .await
    .unwrap();
    assert!(matches!(
        rx.recv().await,
        Some(OutgoingEnvelope::ToConnection {
            connection_id: ConnectionId(2),
            ..
        })
    ));
}

#[tokio::test]
async fn diagnostic_snapshot_timeout_does_not_wait_for_collection() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("snapshot.json");
    let snapshots = capture_shutdown_snapshot(
        std::future::pending(),
        path.clone(),
        vec![],
        Duration::from_millis(10),
    )
    .await;
    assert!(snapshots.is_empty());
    assert!(!path.exists());
}

#[tokio::test]
async fn diagnostic_snapshot_preserves_shape_and_storage_failure_is_nonfatal() {
    use codex_app_server_transport::daemon_recovery::RecoverySnapshot;
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("snapshot.json");
    let id = thread_id();
    let snapshot = RecoverySnapshot {
        loaded: [id.clone()].into_iter().collect(),
        ..Default::default()
    };
    let snapshots = capture_shutdown_snapshot(
        std::future::ready(vec![Ok(snapshot)]),
        path.clone(),
        vec![id.clone()],
        Duration::from_secs(2),
    )
    .await;
    assert_eq!(snapshots.len(), 1);
    assert!(snapshots[0].loaded.contains(&id));
    let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(saved["schema"], 1);
    assert_eq!(saved["loadedThreadIds"][0], id);
    assert_eq!(saved["snapshots"].as_array().unwrap().len(), 1);
    let snapshots = capture_shutdown_snapshot(
        std::future::ready(vec![Ok(RecoverySnapshot::default())]),
        path.join("invalid.json"),
        vec![],
        Duration::from_secs(2),
    )
    .await;
    assert!(snapshots.is_empty());
}

fn registration(root: &Path, byte: char) -> Registration {
    Registration {
        schema: 1,
        role: Role::Window,
        owner_id: byte.to_string().repeat(32),
        workspace_id: "a".repeat(64),
        host_pid: std::process::id(),
        account_state_file: root.join(format!("{byte}.json")),
        account_default_file: None,
        engine_version: "test".into(),
        engine_identity: "b".repeat(64),
    }
}
fn new_registry(root: &Path) -> Registry {
    Registry::load(&root.join("window-owners.json")).unwrap()
}
fn thread_id() -> String {
    ThreadId::new().to_string()
}

#[tokio::test]
async fn session_attachment_routes_only_its_thread_without_rebinding_window_aliases() {
    let root = tempfile::tempdir().unwrap();
    let mut registry = new_registry(root.path());
    let first = registration(root.path(), 'a');
    let second = registration(root.path(), 'b');
    registry.bind(&first).unwrap();
    registry.bind(&second).unwrap();
    let thread = thread_id();
    registry
        .saved
        .threads
        .insert(thread.clone(), first.owner_id.clone());
    let owners = HashMap::from([(ConnectionId(1), second.owner_id.clone())]);
    let scope = SessionScope {
        thread: thread.clone(),
        context: first.owner_id.clone(),
        workspace: first.workspace_id,
        target: "c".repeat(64),
        host: capture_process_identity(std::process::id())
            .await
            .unwrap()
            .unwrap(),
    };
    let scopes = HashMap::from([(ConnectionId(2), scope)]);
    assert_eq!(
        routed_context(&registry, &owners, &scopes, ConnectionId(2)),
        Some(first.owner_id.clone())
    );
    assert_eq!(
        routed_context(&registry, &owners, &scopes, ConnectionId(1)),
        Some(second.owner_id.clone())
    );
    assert_eq!(registry.context(&second.owner_id).unwrap(), second.owner_id);
    assert_eq!(registry.saved.threads[&thread], first.owner_id);
}
fn register_without_lease(registry: &mut Registry, registration: &Registration) {
    registry.bind(registration).unwrap();
    registry.sequence += 1;
    registry
        .registered_at
        .insert(registration.owner_id.clone(), registry.sequence);
}

#[test]
fn rejects_identity_and_binding_changes() {
    let root = tempfile::tempdir().unwrap();
    let first = registration(root.path(), 'a');
    assert!(first.validate("test", &"b".repeat(64)).is_ok());
    assert!(first.validate("wrong", &"b".repeat(64)).is_err());
    let mut registry = new_registry(root.path());
    registry.bind(&first).unwrap();
    let mut changed = first.clone();
    changed.account_state_file = root.path().join("other.json");
    assert!(registry.bind(&changed).is_err());
    changed = first.clone();
    changed.workspace_id = "c".repeat(64);
    assert!(registry.bind(&changed).is_err());
    let mut different = registration(root.path(), 'b');
    different.account_state_file = first.account_state_file;
    assert!(registry.bind(&different).is_err());
}

#[test]
fn registry_corruption_and_missing_authority_fail_closed() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("window-owners.json");
    std::fs::write(&path, "{broken").unwrap();
    assert!(Registry::load(&path).is_err());
    std::fs::write(
        &path,
        r#"{"schema":1,"owners":{},"threads":{"bad":"missing"}}"#,
    )
    .unwrap();
    assert!(Registry::load(&path).is_err());
}

#[test]
fn same_owner_reconnect_preserves_authority_and_thread_owner() {
    let root = tempfile::tempdir().unwrap();
    let first = registration(root.path(), 'a');
    let mut registry = new_registry(root.path());
    register_without_lease(&mut registry, &first);
    let thread = thread_id();
    registry
        .select_thread(&first.owner_id, &thread, true)
        .unwrap();
    registry.bind(&first).unwrap();
    assert_eq!(
        registry
            .select_thread(&first.owner_id, &thread, true)
            .unwrap(),
        first.owner_id
    );
    registry
        .save(&root.path().join("window-owners.json"))
        .unwrap();
    let loaded = new_registry(root.path());
    assert_eq!(loaded.saved.threads[&thread], first.owner_id);
}

#[test]
fn fresh_same_workspace_rejoin_moves_all_aliases() {
    let root = tempfile::tempdir().unwrap();
    let old = registration(root.path(), 'a');
    let new = registration(root.path(), 'b');
    let companion = registration(root.path(), 'c');
    let mut registry = new_registry(root.path());
    register_without_lease(&mut registry, &old);
    let thread = thread_id();
    registry
        .select_thread(&old.owner_id, &thread, true)
        .unwrap();
    registry.sequence += 1;
    registry
        .disappeared_at
        .insert(old.owner_id.clone(), registry.sequence);
    register_without_lease(&mut registry, &new);
    registry.bind(&companion).unwrap();
    registry
        .saved
        .owners
        .get_mut(&companion.owner_id)
        .unwrap()
        .context = new.owner_id.clone();
    assert_eq!(
        registry
            .select_thread(&new.owner_id, &thread, true)
            .unwrap(),
        old.owner_id
    );
    assert_eq!(registry.context(&companion.owner_id).unwrap(), old.owner_id);
    assert_eq!(registry.saved.threads[&thread], old.owner_id);
}

#[test]
fn already_open_window_cannot_take_over_after_owner_disappears() {
    let root = tempfile::tempdir().unwrap();
    let old = registration(root.path(), 'a');
    let other = registration(root.path(), 'b');
    let mut registry = new_registry(root.path());
    register_without_lease(&mut registry, &old);
    register_without_lease(&mut registry, &other);
    let thread = thread_id();
    registry
        .select_thread(&old.owner_id, &thread, true)
        .unwrap();
    registry.sequence += 1;
    registry
        .disappeared_at
        .insert(old.owner_id.clone(), registry.sequence);
    assert!(
        registry
            .select_thread(&other.owner_id, &thread, true)
            .is_err()
    );
}

#[test]
fn rejoin_rejects_other_workspace_mutation_and_owned_work() {
    let root = tempfile::tempdir().unwrap();
    let old = registration(root.path(), 'a');
    let mut other = registration(root.path(), 'b');
    let mut registry = new_registry(root.path());
    register_without_lease(&mut registry, &old);
    let thread = thread_id();
    registry
        .select_thread(&old.owner_id, &thread, true)
        .unwrap();
    registry.disappeared_at.insert(old.owner_id.clone(), 1);
    other.workspace_id = "c".repeat(64);
    register_without_lease(&mut registry, &other);
    assert!(
        registry
            .select_thread(&other.owner_id, &thread, true)
            .is_err()
    );
    registry
        .saved
        .owners
        .get_mut(&other.owner_id)
        .unwrap()
        .workspace_id = old.workspace_id;
    assert!(
        registry
            .select_thread(&other.owner_id, &thread, false)
            .is_err()
    );
    registry
        .select_thread(&other.owner_id, &thread_id(), true)
        .unwrap();
    assert!(
        registry
            .select_thread(&other.owner_id, &thread, true)
            .is_err()
    );
}

#[tokio::test]
async fn leases_count_hosts_once_and_last_close_serializes_admission() {
    let root = tempfile::tempdir().unwrap();
    let first = registration(root.path(), 'a');
    let mut registry = new_registry(root.path());
    registry.bind(&first).unwrap();
    for _ in 0..2 {
        let identity = capture_process_identity(std::process::id())
            .await
            .unwrap()
            .unwrap();
        registry
            .admit_window(&first.owner_id, std::process::id(), identity)
            .unwrap();
    }
    assert_eq!(registry.leases.len(), 1);
    assert!(registry.context_is_live(&first.owner_id));
    registry.host_disappeared(&first.owner_id);
    assert!(registry.last_window_gone.is_some());
    assert!(!registry.context_is_live(&first.owner_id));
    registry.stopping = true;
    assert!(registry.bind(&first).is_err());
}

#[test]
fn companion_binding_does_not_create_a_window_lease() {
    let root = tempfile::tempdir().unwrap();
    let mut companion = registration(root.path(), 'a');
    companion.role = Role::Companion;
    let mut registry = new_registry(root.path());
    registry.bind(&companion).unwrap();
    assert!(registry.leases.is_empty());
    assert!(!registry.had_window);
    assert!(registry.last_window_gone.is_none());
}

#[test]
fn shutdown_preserves_storage_failure_when_cleanup_also_times_out() {
    let mut failure = None;
    retain_shutdown_error(
        &mut failure,
        io::Error::new(
            io::ErrorKind::PermissionDenied,
            "owner metadata cannot be saved",
        ),
    );
    retain_shutdown_error(
        &mut failure,
        io::Error::new(io::ErrorKind::TimedOut, "tree cleanup timed out"),
    );
    let failure = failure.unwrap();
    assert_eq!(failure.kind(), io::ErrorKind::PermissionDenied);
    assert_eq!(failure.to_string(), "owner metadata cannot be saved");
}

#[test]
fn unregistered_engine_stops_at_startup_deadline_without_reset_by_companion() {
    let root = tempfile::tempdir().unwrap();
    let mut registry = new_registry(root.path());
    let started = registry.startup_started;
    assert_eq!(
        registry.no_window_shutdown_reason_at(
            started + STARTUP_NO_WINDOW_TIMEOUT - Duration::from_millis(1)
        ),
        None
    );
    // An owner binding left by failed context preparation must not count as a live window.
    registry.bind(&registration(root.path(), 'a')).unwrap();
    assert!(!registry.had_window);
    let mut companion = registration(root.path(), 'b');
    companion.role = Role::Companion;
    registry.bind(&companion).unwrap();
    assert_eq!(registry.startup_started, started);
    assert_eq!(
        registry.no_window_shutdown_reason_at(started + STARTUP_NO_WINDOW_TIMEOUT),
        Some("startup_no_window_timeout")
    );
    assert_eq!(
        registry.no_window_shutdown_reason_at(started + Duration::from_secs(60)),
        Some("startup_no_window_timeout")
    );
}

#[tokio::test]
async fn valid_window_disables_startup_deadline_and_preserves_reconnect_grace() {
    let root = tempfile::tempdir().unwrap();
    let first = registration(root.path(), 'a');
    let mut registry = new_registry(root.path());
    registry.bind(&first).unwrap();
    let identity = capture_process_identity(std::process::id())
        .await
        .unwrap()
        .unwrap();
    registry
        .admit_window(&first.owner_id, std::process::id(), identity)
        .unwrap();
    assert_eq!(
        registry.no_window_shutdown_reason_at(registry.startup_started + Duration::from_secs(3600)),
        None
    );
    registry.host_disappeared(&first.owner_id);
    let disappeared = registry.last_window_gone.unwrap();
    assert_eq!(
        registry
            .no_window_shutdown_reason_at(disappeared + RECONNECT_GRACE - Duration::from_millis(1)),
        None
    );
    assert_eq!(
        registry.no_window_shutdown_reason_at(disappeared + RECONNECT_GRACE),
        Some("last_window_closed")
    );
    let identity = capture_process_identity(std::process::id())
        .await
        .unwrap()
        .unwrap();
    registry
        .admit_window(&first.owner_id, std::process::id(), identity)
        .unwrap();
    assert_eq!(
        registry.no_window_shutdown_reason_at(disappeared + Duration::from_secs(3600)),
        None
    );
}

#[test]
fn inactive_owner_keeps_account_path_unique_while_fresh_window_can_rejoin_thread() {
    let root = tempfile::tempdir().unwrap();
    let old = registration(root.path(), 'a');
    let new = registration(root.path(), 'b');
    let mut registry = new_registry(root.path());
    register_without_lease(&mut registry, &old);
    let thread = thread_id();
    registry
        .select_thread(&old.owner_id, &thread, true)
        .unwrap();
    registry.sequence += 1;
    registry
        .disappeared_at
        .insert(old.owner_id.clone(), registry.sequence);
    assert!(!registry.context_is_live(&old.owner_id));
    let mut reused_path = new.clone();
    reused_path.account_state_file = old.account_state_file.clone();
    let rejection = registry.bind(&reused_path).unwrap_err();
    assert_eq!(
        rejection.to_string(),
        "account state path belongs to another window"
    );
    assert!(!registry.saved.owners.contains_key(&new.owner_id));
    register_without_lease(&mut registry, &new);
    assert_eq!(
        registry
            .select_thread(&new.owner_id, &thread, true)
            .unwrap(),
        old.owner_id
    );
    assert_eq!(registry.saved.threads[&thread], old.owner_id);
    // Rejoin routes requests to the retained authority rather than admitting a replacement turn.
    assert_eq!(registry.context(&new.owner_id).unwrap(), old.owner_id);
}

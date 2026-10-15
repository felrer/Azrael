use super::*;

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

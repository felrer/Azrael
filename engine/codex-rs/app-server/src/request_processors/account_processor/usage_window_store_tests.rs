use super::*;

fn profile(id: &str) -> AzraelProfileInfo {
    AzraelProfileInfo {
        id: id.to_string(),
        email: None,
        workspace_account_id: "workspace".to_string(),
        user_id: "user".to_string(),
        plan_type: None,
        auto_switch_allowed: false,
    }
}

fn observation(at: i64, reset: Option<i64>, used: i32) -> Observation {
    Observation {
        observed_at: at,
        windows: vec![Window {
            slot: 0,
            duration: 300,
            reset,
            used,
        }],
    }
}

fn enabled() -> Record {
    let mut record = Record::new(&profile("first"));
    record.schedule.enabled = true;
    record.schedule.status = AzraelUsageWindowStatus::Scheduled;
    record
}

#[test]
fn repeated_queries_keep_one_existing_deadline() {
    let mut record = enabled();
    record.reserve(observation(100, Some(1000), 0));
    let schedule = record.schedule.clone();
    record.reserve(observation(200, Some(1000), 0));
    record.reserve(observation(300, Some(1100), 0));
    assert_eq!(record.schedule, schedule);
}

#[test]
fn two_limits_share_the_earliest_unprocessed_deadline() {
    let mut record = enabled();
    let mut observed = observation(100, Some(1000), 10);
    observed.windows.push(Window {
        slot: 1,
        duration: 10080,
        reset: Some(2000),
        used: 10,
    });
    record.reserve(observed.clone());
    assert_eq!(record.schedule.next_run_at, Some(1045));
    record.finish_cycle(observed);
    assert_eq!(record.schedule.next_run_at, Some(2045));
    assert_eq!(record.processed, vec![1000]);
}

#[test]
fn sliding_future_reset_does_not_postpone_an_overdue_reservation() {
    let mut record = enabled();
    record.reserve(observation(100, Some(18100), 0));
    let schedule = record.schedule.clone();
    let observed = observation(18145, Some(36145), 0);
    assert_eq!(record.dormant(&observed), vec![0]);
    record.reserve(observed);
    assert_eq!(record.schedule, schedule);
}

#[test]
fn rounded_zero_is_confirmed_by_stable_future_reset() {
    let mut record = enabled();
    record.observation = observation(100, Some(18100), 0);
    assert!(record.confirm_started(&observation(115, Some(18100), 0)));
    assert!(!record.confirm_started(&observation(115, Some(18115), 0)));
    assert!(!record.confirm_started(&observation(105, Some(18100), 0)));
}

#[test]
fn attempt_guard_survives_reload_and_profile_aliases() {
    let directory = tempfile::tempdir().unwrap();
    let first = profile("first");
    let store = Store::open(directory.path(), &first).unwrap();
    let mut record = enabled();
    record.record_attempt(&observation(100, None, 0), &[0]);
    store.save(&record).unwrap();
    let alias = profile("alias");
    assert_eq!(
        Store::open(directory.path(), &alias).err().unwrap().kind(),
        io::ErrorKind::WouldBlock
    );
    let busy = Store::status(directory.path(), &alias).unwrap();
    assert!(busy.schedule.enabled);
    assert_eq!(busy.schedule.status, AzraelUsageWindowStatus::Confirming);
    assert_eq!(busy.schedule.next_run_at, record.schedule.next_run_at);
    drop(store);
    let store = Store::open(directory.path(), &alias).unwrap();
    let restored = store.load(&alias).unwrap().unwrap();
    assert_eq!(restored.schedule.profile_id, "alias");
    assert_eq!(
        restored.schedule.status,
        AzraelUsageWindowStatus::Confirming
    );
    assert!(restored.dormant(&observation(200, None, 0)).is_empty());
    assert_eq!(restored.dormant(&observation(18100, None, 0)), vec![0]);
}

#[test]
fn observations_cannot_rearm_confirmation_or_apply_stale_results() {
    let mut record = enabled();
    record.reserve(observation(100, Some(1000), 0));
    let schedule = record.schedule.clone();
    record.reserve(observation(90, Some(800), 0));
    assert_eq!(record.schedule, schedule);
    record.record_attempt(&observation(1100, None, 0), &[0]);
    let schedule = record.schedule.clone();
    record.reserve(observation(1200, Some(19200), 0));
    assert_eq!(record.schedule, schedule);
    assert_eq!(record.observation.observed_at, 1100);
}

#[test]
fn only_recognized_paid_plans_default_on() {
    for plan in [
        "go",
        "plus",
        "pro",
        "prolite",
        "promax",
        "team",
        "business",
        "ent26",
        "self_serve_business_prolite",
        "self_serve_business_usage_based",
        "enterprise_cbp_automation",
        "enterprise_cbp_usage_based",
        "enterprise",
        "edu",
        "edu_plus",
        "edu_pro",
    ] {
        let mut account = profile("paid");
        account.plan_type = Some(plan.to_string());
        let record = Record::new(&account);
        assert!(record.schedule.enabled, "{plan}");
        assert!(record.schedule.next_run_at.is_some(), "{plan}");
        assert_eq!(record.choice, Choice::DefaultPolicy);
    }
    for plan in [
        None,
        Some("free"),
        Some("unknown"),
        Some("future-paid-tier"),
        Some(""),
    ] {
        let mut account = profile("unconfirmed");
        account.plan_type = plan.map(str::to_string);
        let record = Record::new(&account);
        assert!(!record.schedule.enabled, "{plan:?}");
        assert_eq!(record.schedule.next_run_at, None);
    }
}

#[test]
fn status_initializes_and_persists_defaults_without_observations() {
    let directory = tempfile::tempdir().unwrap();
    let mut account = profile("paid");
    account.plan_type = Some("plus".to_string());
    let initialized = Store::status(directory.path(), &account).unwrap();
    assert!(initialized.schedule.enabled);
    assert_eq!(initialized.observation.observed_at, 0);
    let restored = Store::snapshot(directory.path(), &account)
        .unwrap()
        .unwrap();
    assert_eq!(restored.schedule, initialized.schedule);
    assert_eq!(restored.choice, Choice::DefaultPolicy);
    assert_eq!(
        Store::status(directory.path(), &account).unwrap().schedule,
        initialized.schedule
    );
}

#[test]
fn unknown_default_can_become_paid_but_noop_off_is_explicit() {
    for explicit_off in [false, true] {
        let directory = tempfile::tempdir().unwrap();
        let mut account = profile("first");
        let initial = Store::status(directory.path(), &account).unwrap();
        assert!(!initial.schedule.enabled);
        if explicit_off {
            let store = Store::open(directory.path(), &account).unwrap();
            let mut record = store.load(&account).unwrap().unwrap();
            record.set_enabled(false);
            store.save(&record).unwrap();
        }
        account.id = "alias".to_string();
        account.plan_type = Some("pro".to_string());
        let restored = Store::status(directory.path(), &account).unwrap();
        assert_eq!(restored.schedule.enabled, !explicit_off);
        assert_eq!(restored.schedule.profile_id, "alias");
        assert_eq!(restored.choice == Choice::Explicit, explicit_off);
    }
}

#[test]
fn manual_off_preserves_history_across_aliases_and_reopen() {
    let directory = tempfile::tempdir().unwrap();
    let mut account = profile("first");
    account.plan_type = Some("plus".to_string());
    let store = Store::open(directory.path(), &account).unwrap();
    let mut record = Record::new(&account);
    record.record_attempt(&observation(100, None, 0), &[0]);
    record.processed = vec![50];
    let observation_before = serde_json::to_value(&record.observation).unwrap();
    let attempt_before = record.attempt_until;
    record.set_enabled(false);
    store.save(&record).unwrap();
    drop(store);
    account.id = "alias".to_string();
    let restored = Store::status(directory.path(), &account).unwrap();
    assert!(!restored.schedule.enabled);
    assert_eq!(restored.choice, Choice::Explicit);
    assert_eq!(restored.processed, vec![50]);
    assert_eq!(restored.attempt_until, attempt_before);
    assert_eq!(
        serde_json::to_value(restored.observation).unwrap(),
        observation_before
    );
    assert_eq!(restored.schedule.last_attempt_at, Some(100));
}

#[test]
fn legacy_enabled_values_are_saved_choices_and_keep_history() {
    for enabled in [false, true] {
        let directory = tempfile::tempdir().unwrap();
        let mut account = profile("legacy");
        account.plan_type = Some("plus".to_string());
        let store = Store::open(directory.path(), &account).unwrap();
        let mut record = Record::new(&account);
        record.schedule.enabled = enabled;
        record.processed = vec![50];
        record.attempt_until = [100, 200];
        record.observation = observation(20, Some(50), 10);
        let mut legacy = serde_json::to_value(&record).unwrap();
        legacy.as_object_mut().unwrap().remove("choice");
        std::fs::write(&store.path, serde_json::to_vec(&legacy).unwrap()).unwrap();
        let mut migrated = store.load(&account).unwrap().unwrap();
        migrated.initialize_default(&account);
        store.save(&migrated).unwrap();
        drop(store);
        let restored = Store::status(directory.path(), &account).unwrap();
        assert_eq!(restored.schedule.enabled, enabled);
        assert_eq!(restored.choice, Choice::Explicit);
        assert_eq!(restored.processed, vec![50]);
        assert_eq!(restored.attempt_until, [100, 200]);
        assert_eq!(restored.observation.observed_at, 20);
    }
}

#[test]
fn status_lock_contention_returns_snapshot_and_retries_default_later() {
    let directory = tempfile::tempdir().unwrap();
    let mut account = profile("first");
    let store = Store::open(directory.path(), &account).unwrap();
    account.plan_type = Some("plus".to_string());
    assert!(
        !Store::status(directory.path(), &account)
            .unwrap()
            .schedule
            .enabled
    );
    assert!(
        Store::snapshot(directory.path(), &account)
            .unwrap()
            .is_none()
    );
    let mut pending = Record::pending(&account);
    pending.schedule.status = AzraelUsageWindowStatus::Checking;
    store.save(&pending).unwrap();
    let busy = Store::status(directory.path(), &account).unwrap();
    assert!(!busy.schedule.enabled);
    assert_eq!(busy.schedule.status, AzraelUsageWindowStatus::Checking);
    drop(store);
    assert!(
        Store::status(directory.path(), &account)
            .unwrap()
            .schedule
            .enabled
    );
}

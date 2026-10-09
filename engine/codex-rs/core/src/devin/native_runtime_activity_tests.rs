use super::*;
use pretty_assertions::assert_eq;

fn progress(count: u64, age: u64, phase: &str, event: &str) -> Progress {
    serde_json::from_value(serde_json::json!({
        "phase": phase, "elapsed_ms": 1000, "network_idle_ms": 0,
        "event_idle_ms": age, "bytes_received": 99999, "event_count": count,
        "last_event": event,
    }))
    .unwrap()
}

#[test]
fn provider_activity_requires_new_recent_meaningful_stream_events() {
    let started = Instant::now();
    let now = started + Duration::from_secs(10);
    let mut activity = InferenceActivity::new(started);
    let idle = Duration::from_secs(5);
    activity.observe(&progress(1, 2000, "stream", "reasoning"), now, idle);
    assert_eq!(
        (activity.last_activity, activity.last_event),
        (now - Duration::from_secs(2), "reasoning")
    );
    for report in [
        progress(1, 0, "stream", "text"),
        progress(0, 0, "stream", "text"),
        progress(2, 6000, "stream", "tool_call_args"),
        progress(3, 0, "headers", "text"),
        progress(4, 0, "stream", "none"),
        progress(2, 0, "stream", "text"),
    ] {
        activity.observe(&report, now, idle);
    }
    assert_eq!(
        (activity.last_activity, activity.last_event),
        (now - Duration::from_secs(2), "reasoning")
    );
    activity.observe(&progress(5, 1000, "stream", "tool_call_args"), now, idle);
    assert_eq!(
        (activity.last_activity, activity.last_event),
        (now - Duration::from_secs(1), "tool_call_args")
    );
}

#[test]
fn reported_age_is_clamped_without_moving_activity_backwards() {
    let started = Instant::now();
    let mut activity = InferenceActivity::new(started);
    activity.observe(
        &progress(1, 4000, "stream", "text"),
        started + Duration::from_secs(1),
        Duration::from_secs(5),
    );
    assert_eq!(activity.last_activity, started);
}

fn thinking_progress(count: u64, age: u64, open: bool, phase: &str) -> Progress {
    serde_json::from_value(serde_json::json!({
        "phase": phase, "elapsed_ms": 0, "network_idle_ms": 0,
        "event_idle_ms": 0, "bytes_received": 99999, "event_count": 0,
        "last_event": "none", "thinking_wait": {
            "open": open, "heartbeat_count": count, "heartbeat_idle_ms": age
        }
    }))
    .unwrap()
}

#[test]
fn thinking_heartbeats_extend_idle_beyond_100_seconds_without_semantic_activity() {
    let started = Instant::now();
    let idle = Duration::from_secs(100);
    let mut activity = InferenceActivity::new(started);
    for count in 1..=5 {
        let now = started + Duration::from_secs(count * 90);
        assert!(activity.observe_thinking_wait(
            &thinking_progress(count, 1000, true, "stream"),
            now,
            idle,
            true
        ));
        assert_eq!(
            activity.idle_deadline(idle),
            now + idle - Duration::from_secs(1)
        );
        assert_eq!(
            (activity.last_activity, activity.last_event),
            (started, "none")
        );
    }
    activity.observe_thinking_wait(
        &thinking_progress(5, 0, false, "stream"),
        started + Duration::from_secs(451),
        idle,
        true,
    );
    assert_eq!(activity.idle_deadline(idle), started + idle);
}

#[test]
fn thinking_wait_rejects_repeated_regressed_stale_closed_and_unscoped_heartbeats() {
    let started = Instant::now();
    let idle = Duration::from_secs(100);
    let now = started + Duration::from_secs(90);
    let mut activity = InferenceActivity::new(started);
    assert!(activity.observe_thinking_wait(
        &thinking_progress(5, 0, true, "stream"),
        now,
        idle,
        true
    ));
    for (report, enabled) in [
        (thinking_progress(5, 0, true, "stream"), true),
        (thinking_progress(4, 0, true, "stream"), true),
        (thinking_progress(6, 100000, true, "stream"), true),
        (thinking_progress(7, 0, true, "headers"), true),
        (thinking_progress(8, 0, true, "stream"), false),
        (thinking_progress(9, 0, false, "stream"), true),
        (progress(10, 0, "stream", "none"), true),
    ] {
        assert!(!activity.observe_thinking_wait(
            &report,
            now + Duration::from_secs(10),
            idle,
            enabled
        ));
        assert_eq!(
            (activity.last_activity, activity.last_event),
            (started, "none")
        );
    }
}

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

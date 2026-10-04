use super::protocol::Progress;
use super::protocol::ProgressEvent;
use super::protocol::ProgressPhase;
use std::time::Duration;
use tokio::time::Instant;

#[derive(Clone, Copy)]
pub(super) struct TimingPolicy {
    pub(super) idle: Duration,
    pub(super) deadline: Duration,
    pub(super) backoff: Duration,
}

impl Default for TimingPolicy {
    fn default() -> Self {
        Self {
            idle: Duration::from_secs(100),
            // Helper owns 900s; allow bounded delivery/cleanup grace.
            deadline: Duration::from_secs(915),
            backoff: Duration::from_secs(1),
        }
    }
}

pub(super) struct InferenceActivity {
    pub(super) last_activity: Instant,
    pub(super) last_event: &'static str,
    started: Instant,
    high_water: u64,
}

impl InferenceActivity {
    pub(super) fn new(started: Instant) -> Self {
        Self {
            last_activity: started,
            started,
            last_event: "none",
            high_water: 0,
        }
    }

    pub(super) fn observe(&mut self, progress: &Progress, now: Instant, idle: Duration) {
        let fresh = progress.event_count > self.high_water;
        self.high_water = self.high_water.max(progress.event_count);
        if !fresh
            || !matches!(progress.phase, ProgressPhase::Stream)
            || matches!(progress.last_event, ProgressEvent::None)
            || Duration::from_millis(progress.event_idle_ms) >= idle
        {
            return;
        }
        let event_at = now
            .checked_sub(Duration::from_millis(progress.event_idle_ms))
            .unwrap_or(self.started)
            .max(self.started);
        if event_at > self.last_activity {
            self.last_activity = event_at;
            self.last_event = match progress.last_event {
                ProgressEvent::None => "none",
                ProgressEvent::Text => "text",
                ProgressEvent::Reasoning => "reasoning",
                ProgressEvent::ReasoningSignature => "reasoning_signature",
                ProgressEvent::ToolCallStart => "tool_call_start",
                ProgressEvent::ToolCallArgs => "tool_call_args",
                ProgressEvent::Usage => "usage",
                ProgressEvent::Finish => "finish",
            };
        }
    }
}

#[cfg(test)]
#[path = "native_runtime_activity_tests.rs"]
mod tests;

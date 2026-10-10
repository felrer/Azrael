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
    pub(super) retry_idle: bool,
}

impl Default for TimingPolicy {
    fn default() -> Self {
        Self {
            idle: Duration::from_secs(100),
            // Helper owns 900s; allow bounded delivery/cleanup grace.
            deadline: Duration::from_secs(915),
            backoff: Duration::from_secs(1),
            retry_idle: true,
        }
    }
}

pub(super) struct InferenceActivity {
    pub(super) last_activity: Instant,
    pub(super) last_event: &'static str,
    started: Instant,
    high_water: u64,
    thinking_high_water: u64,
    thinking_wait_at: Option<Instant>,
    thinking_open: bool,
}

impl InferenceActivity {
    pub(super) fn new(started: Instant) -> Self {
        Self {
            last_activity: started,
            started,
            last_event: "none",
            high_water: 0,
            thinking_high_water: 0,
            thinking_wait_at: None,
            thinking_open: false,
        }
    }

    pub(super) fn idle_deadline(&self, idle: Duration) -> Instant {
        let last = if self.thinking_open {
            self.thinking_wait_at
                .unwrap_or(self.last_activity)
                .max(self.last_activity)
        } else {
            self.last_activity
        };
        last + idle
    }

    pub(super) fn observe_thinking_wait(
        &mut self,
        progress: &Progress,
        now: Instant,
        idle: Duration,
        enabled: bool,
    ) -> bool {
        let Some(wait) = progress.thinking_wait.as_ref().filter(|_| enabled) else {
            self.thinking_open = false;
            return false;
        };
        let fresh = wait.heartbeat_count > self.thinking_high_water;
        self.thinking_high_water = self.thinking_high_water.max(wait.heartbeat_count);
        self.thinking_open = wait.open && matches!(progress.phase, ProgressPhase::Stream);
        if !self.thinking_open || !fresh || Duration::from_millis(wait.heartbeat_idle_ms) >= idle {
            return false;
        }
        let heartbeat_at = now
            .checked_sub(Duration::from_millis(wait.heartbeat_idle_ms))
            .unwrap_or(self.started)
            .max(self.started);
        if self.thinking_wait_at.is_none_or(|last| heartbeat_at > last) {
            self.thinking_wait_at = Some(heartbeat_at);
            return true;
        }
        false
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

//! Completed inference observations for one turn, independent of tool/wait time.
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use ts_rs::TS;

const MINUTE_MS: u64 = 60_000;
const GRAPH_MINUTES: u64 = 40;

#[derive(
    Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord, JsonSchema, TS,
)]
#[serde(rename_all = "lowercase")]
pub enum ResponseSpeedMode {
    Standard,
    Fast,
    Ultrafast,
}

impl ResponseSpeedMode {
    pub fn from_service_tier(tier: Option<&str>) -> Option<Self> {
        match tier {
            None | Some("default" | "standard") => Some(Self::Standard),
            Some("priority" | "fast") => Some(Self::Fast),
            Some("ultrafast") => Some(Self::Ultrafast),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct ResponseMinuteSample {
    #[ts(type = "number")]
    pub minute: u64,
    #[ts(type = "number")]
    pub output_tokens: u64,
    #[ts(type = "number")]
    pub request_duration_ms: u64,
    #[serde(default)]
    pub mode: Option<ResponseSpeedMode>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct ResponsePerformanceTurn {
    pub turn_id: String,
    #[ts(type = "number")]
    pub started_at_unix_ms: i64,
    pub minute_samples: Vec<ResponseMinuteSample>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct ResponsePerformance {
    pub turn_id: String,
    #[ts(type = "number")]
    pub output_tokens: u64,
    #[ts(type = "number")]
    pub request_duration_ms: u64,
    pub completed_requests: u32,
    pub unmeasured_requests: u32,
    #[serde(default)]
    pub minute_samples: Vec<ResponseMinuteSample>,
    #[serde(default)]
    pub graph_estimated: bool,
    #[serde(default)]
    pub truncated_minutes: bool,
    #[serde(default)]
    #[ts(type = "number | null")]
    pub started_at_unix_ms: Option<i64>,
    #[serde(default)]
    #[ts(type = "number | null")]
    pub observed_at_unix_ms: Option<i64>,
    #[serde(default)]
    pub history: Vec<ResponsePerformanceTurn>,
}

impl ResponsePerformance {
    /// Only sum token counts whose complete request duration was observed.
    /// Reasoning is already included in provider output and is not added again.
    pub fn record(&mut self, output_tokens: Option<i64>, duration_ms: u64) {
        self.record_at(output_tokens, duration_ms, 0);
    }

    /// Provider totals carry no exact token timestamps. Allocate completed
    /// observations across request overlap, leaving tool-only minutes absent.
    pub fn record_at(&mut self, output_tokens: Option<i64>, duration_ms: u64, started_at_ms: u64) {
        self.record_at_mode(output_tokens, duration_ms, started_at_ms, None);
    }

    pub fn record_at_mode(
        &mut self,
        output_tokens: Option<i64>,
        duration_ms: u64,
        started_at_ms: u64,
        mode: Option<ResponseSpeedMode>,
    ) {
        let Some(tokens) = output_tokens.filter(|tokens| *tokens >= 0) else {
            self.unmeasured_requests = self.unmeasured_requests.saturating_add(1);
            return;
        };
        if duration_ms == 0 {
            self.unmeasured_requests = self.unmeasured_requests.saturating_add(1);
            return;
        }
        self.output_tokens = self.output_tokens.saturating_add(tokens as u64);
        self.request_duration_ms = self.request_duration_ms.saturating_add(duration_ms);
        self.completed_requests = self.completed_requests.saturating_add(1);
        let end_ms = started_at_ms.saturating_add(duration_ms);
        let last_minute = end_ms.saturating_sub(1) / MINUTE_MS;
        let lower = last_minute.saturating_sub(GRAPH_MINUTES - 1);
        let first_minute = (started_at_ms / MINUTE_MS).max(lower);
        let before = self.minute_samples.len();
        self.minute_samples.retain(|sample| sample.minute >= lower);
        self.truncated_minutes |=
            before != self.minute_samples.len() || started_at_ms / MINUTE_MS < lower;
        for minute in first_minute..=last_minute {
            let begin = started_at_ms.max(minute.saturating_mul(MINUTE_MS));
            let end = end_ms.min(minute.saturating_add(1).saturating_mul(MINUTE_MS));
            let overlap = end.saturating_sub(begin);
            if overlap == 0 {
                continue;
            }
            let allocated_until = |at: u64| {
                (tokens as u128 * at.saturating_sub(started_at_ms) as u128 / duration_ms as u128)
                    as u64
            };
            let output_tokens = allocated_until(end).saturating_sub(allocated_until(begin));
            match self
                .minute_samples
                .binary_search_by_key(&(minute, mode), |sample| (sample.minute, sample.mode))
            {
                Ok(index) => {
                    let sample = &mut self.minute_samples[index];
                    sample.output_tokens = sample.output_tokens.saturating_add(output_tokens);
                    sample.request_duration_ms = sample.request_duration_ms.saturating_add(overlap);
                }
                Err(index) => self.minute_samples.insert(
                    index,
                    ResponseMinuteSample {
                        minute,
                        output_tokens,
                        request_duration_ms: overlap,
                        mode,
                    },
                ),
            }
        }
        self.graph_estimated = true;
    }

    /// Replace the current turn snapshot; never add a replayed snapshot twice.
    /// History uses the same persisted usage envelope as the live observation.
    pub fn retain_history_from(&mut self, previous: Option<&Self>) {
        let Some(observed_at) = self.observed_at_unix_ms else {
            return;
        };
        let cutoff = observed_at.saturating_sub((GRAPH_MINUTES * MINUTE_MS) as i64);
        self.history = previous
            .map(|previous| previous.history.clone())
            .unwrap_or_default();
        if let Some(previous) = previous
            && previous.turn_id != self.turn_id
            && let Some(started_at_unix_ms) = previous.started_at_unix_ms
        {
            self.history.retain(|turn| turn.turn_id != previous.turn_id);
            self.history.push(ResponsePerformanceTurn {
                turn_id: previous.turn_id.clone(),
                started_at_unix_ms,
                minute_samples: previous.minute_samples.clone(),
            });
        }
        self.history.retain(|turn| turn.turn_id != self.turn_id);
        for turn in &mut self.history {
            prune_samples(&mut turn.minute_samples, turn.started_at_unix_ms, cutoff);
        }
        self.history
            .retain(|turn| turn.started_at_unix_ms > cutoff || !turn.minute_samples.is_empty());
        if let Some(start) = self.started_at_unix_ms {
            let before = self.minute_samples.len();
            prune_samples(&mut self.minute_samples, start, cutoff);
            self.truncated_minutes |= before != self.minute_samples.len();
        }
    }
}

fn prune_samples(samples: &mut Vec<ResponseMinuteSample>, started_at: i64, cutoff: i64) {
    samples.retain(|sample| {
        let end = sample.minute.saturating_add(1).saturating_mul(MINUTE_MS);
        started_at.saturating_add(i64::try_from(end).unwrap_or(i64::MAX)) > cutoff
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "manual local cost probe; not an end-to-end latency benchmark"]
    fn response_performance_cost_probe() {
        let mut stats = ResponsePerformance::default();
        stats.record_at(Some(40_000), 40 * MINUTE_MS, 0);
        let iterations = 10_000;
        for run in 0..5 {
            let start = std::time::Instant::now();
            for _ in 0..iterations {
                stats.record_at(std::hint::black_box(Some(100)), 1000, 39 * MINUTE_MS);
                std::hint::black_box(serde_json::to_vec(&stats).unwrap());
            }
            eprintln!(
                "response TPS cost probe run={run}: {:.3} us/observation (40-minute aggregate + JSON; debug test profile)",
                start.elapsed().as_secs_f64() * 1_000_000.0 / iterations as f64
            );
        }
        assert_eq!(stats.minute_samples.len(), 40);
    }

    #[test]
    fn response_performance_minute_graph_preserves_overlap_totals_and_gaps() {
        let mut stats = ResponsePerformance::default();
        stats.record_at(Some(1200), 120_000, 30_000);
        assert_eq!(
            stats
                .minute_samples
                .iter()
                .map(|sample| (
                    sample.minute,
                    sample.output_tokens,
                    sample.request_duration_ms
                ))
                .collect::<Vec<_>>(),
            vec![(0, 300, 30_000), (1, 600, 60_000), (2, 300, 30_000)]
        );
        stats.record_at(Some(0), 60_000, 240_000);
        assert_eq!(stats.minute_samples.last().unwrap().minute, 4);
        assert_eq!(stats.minute_samples.last().unwrap().output_tokens, 0);
        assert!(!stats.minute_samples.iter().any(|sample| sample.minute == 3));
        assert_eq!(stats.output_tokens, 1200);
        assert_eq!(stats.request_duration_ms, 180_000);
        assert!(stats.graph_estimated);
    }

    #[test]
    fn response_performance_minute_graph_bounds_long_requests_without_changing_mean() {
        let mut stats = ResponsePerformance::default();
        stats.record_at(Some(2000), 200 * MINUTE_MS, 0);
        assert_eq!(stats.minute_samples.len(), 40);
        assert_eq!(stats.minute_samples.first().unwrap().minute, 160);
        assert_eq!(stats.minute_samples.last().unwrap().minute, 199);
        assert_eq!(stats.output_tokens, 2000);
        assert_eq!(stats.request_duration_ms, 200 * MINUTE_MS);
        assert!(stats.truncated_minutes);
        stats.record_at(Some(10), MINUTE_MS, 400 * MINUTE_MS);
        assert_eq!(stats.minute_samples.len(), 1);
        assert_eq!(stats.minute_samples[0].minute, 400);
    }

    #[test]
    fn response_performance_weights_by_duration_and_excludes_missing_observations() {
        let mut stats = ResponsePerformance::default();
        stats.record(Some(100), 1000);
        stats.record(Some(100), 9000);
        stats.record(None, 1000);
        stats.record(Some(-1), 1000);
        stats.record(Some(100), 0);
        assert_eq!(stats.output_tokens, 200);
        assert_eq!(stats.request_duration_ms, 10000);
        assert_eq!(stats.completed_requests, 2);
        assert_eq!(stats.unmeasured_requests, 3);
    }

    #[test]
    fn response_performance_preserves_zero_and_round_trips() {
        let mut stats = ResponsePerformance {
            turn_id: "turn-2".into(),
            ..Default::default()
        };
        stats.record(Some(0), 100);
        let json = serde_json::to_value(&stats).unwrap();
        assert_eq!(json["turnId"], "turn-2");
        assert_eq!(json["completedRequests"], 1);
        assert_eq!(
            serde_json::from_value::<ResponsePerformance>(json).unwrap(),
            stats
        );
        assert_eq!(ResponsePerformance::default().completed_requests, 0);
    }

    #[test]
    fn response_performance_modes_stay_separate_in_the_same_minute() {
        let mut stats = ResponsePerformance::default();
        stats.record_at_mode(Some(100), 1000, 0, Some(ResponseSpeedMode::Fast));
        stats.record_at_mode(Some(300), 3000, 2000, Some(ResponseSpeedMode::Ultrafast));
        stats.record_at_mode(Some(50), 1000, 5000, Some(ResponseSpeedMode::Fast));
        assert_eq!(stats.minute_samples.len(), 2);
        assert_eq!(stats.minute_samples[0].output_tokens, 150);
        assert_eq!(stats.minute_samples[0].request_duration_ms, 2000);
        assert_eq!(
            stats.minute_samples[1].mode,
            Some(ResponseSpeedMode::Ultrafast)
        );
        assert_eq!(stats.output_tokens, 450);
        assert_eq!(
            ResponseSpeedMode::from_service_tier(None),
            Some(ResponseSpeedMode::Standard)
        );
        assert_eq!(
            ResponseSpeedMode::from_service_tier(Some("priority")),
            Some(ResponseSpeedMode::Fast)
        );
        assert_eq!(ResponseSpeedMode::from_service_tier(Some("other")), None);
    }

    #[test]
    fn response_performance_history_retains_waiting_turns_and_is_idempotent() {
        let mut first = ResponsePerformance {
            turn_id: "first".into(),
            started_at_unix_ms: Some(60_000),
            observed_at_unix_ms: Some(120_000),
            ..Default::default()
        };
        first.record_at_mode(Some(120), 1000, 0, Some(ResponseSpeedMode::Standard));
        let mut next = ResponsePerformance {
            turn_id: "next".into(),
            started_at_unix_ms: Some(120_000),
            observed_at_unix_ms: Some(120_000),
            ..Default::default()
        };
        next.retain_history_from(Some(&first));
        assert_eq!(next.history.len(), 1);
        assert_eq!(next.history[0].turn_id, "first");
        assert_eq!(next.completed_requests, 0);
        let previous = next.clone();
        next.retain_history_from(Some(&previous));
        assert_eq!(next.history, previous.history);
        let mut third = ResponsePerformance {
            turn_id: "third".into(),
            started_at_unix_ms: Some(180_000),
            observed_at_unix_ms: Some(180_000),
            ..Default::default()
        };
        third.retain_history_from(Some(&next));
        assert_eq!(third.history.len(), 2);
        assert!(third.history[1].minute_samples.is_empty());
        let restored: ResponsePerformance =
            serde_json::from_value(serde_json::to_value(&third).unwrap()).unwrap();
        assert_eq!(restored, third);
        third.observed_at_unix_ms = Some(180_000 + 40 * MINUTE_MS as i64);
        third.retain_history_from(Some(&restored));
        assert!(third.history.is_empty());
    }

    #[test]
    fn response_performance_history_prunes_samples_but_keeps_active_old_turn() {
        let mut previous = ResponsePerformance {
            turn_id: "long".into(),
            started_at_unix_ms: Some(60_000),
            observed_at_unix_ms: Some(120_000),
            ..Default::default()
        };
        previous.record_at(Some(100), 1000, 0);
        previous.record_at(Some(200), 1000, 60 * MINUTE_MS);
        let mut next = ResponsePerformance {
            turn_id: "new".into(),
            started_at_unix_ms: Some(61 * MINUTE_MS as i64),
            observed_at_unix_ms: Some(61 * MINUTE_MS as i64),
            ..Default::default()
        };
        next.retain_history_from(Some(&previous));
        assert_eq!(next.history.len(), 1);
        assert_eq!(next.history[0].minute_samples.len(), 1);
        assert_eq!(next.history[0].minute_samples[0].output_tokens, 200);
    }

    #[test]
    fn response_performance_old_snapshots_have_no_invented_clock_or_mode() {
        let old = serde_json::json!({"turnId":"old", "outputTokens":10, "requestDurationMs":1000,
            "completedRequests":1,"unmeasuredRequests":0,"minuteSamples":[{"minute":0,"outputTokens":10,"requestDurationMs":1000}]});
        let stats: ResponsePerformance = serde_json::from_value(old).unwrap();
        assert_eq!(stats.started_at_unix_ms, None);
        assert_eq!(stats.minute_samples[0].mode, None);
        assert!(stats.history.is_empty());
    }
}

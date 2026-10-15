//! Completed inference observations for one turn, independent of tool/wait time.
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use ts_rs::TS;

const MINUTE_MS: u64 = 60_000;
const GRAPH_MINUTES: u64 = 120;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct ResponseMinuteSample {
    #[ts(type = "number")]
    pub minute: u64,
    #[ts(type = "number")]
    pub output_tokens: u64,
    #[ts(type = "number")]
    pub request_duration_ms: u64,
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
                .binary_search_by_key(&minute, |sample| sample.minute)
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
                    },
                ),
            }
        }
        self.graph_estimated = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "manual local cost probe; not an end-to-end latency benchmark"]
    fn response_performance_cost_probe() {
        let mut stats = ResponsePerformance::default();
        stats.record_at(Some(120_000), 120 * MINUTE_MS, 0);
        let iterations = 10_000;
        for run in 0..5 {
            let start = std::time::Instant::now();
            for _ in 0..iterations {
                stats.record_at(std::hint::black_box(Some(100)), 1000, 119 * MINUTE_MS);
                std::hint::black_box(serde_json::to_vec(&stats).unwrap());
            }
            eprintln!("response TPS cost probe run={run}: {:.3} us/observation (120-minute aggregate + JSON; debug test profile)", start.elapsed().as_secs_f64() * 1_000_000.0 / iterations as f64);
        }
        assert_eq!(stats.minute_samples.len(), 120);
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
        assert_eq!(stats.minute_samples.len(), 120);
        assert_eq!(stats.minute_samples.first().unwrap().minute, 80);
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
}

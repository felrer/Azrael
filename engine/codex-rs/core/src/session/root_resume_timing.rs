//! Content-free timings for one root-resume attempt, using the existing tracing sink.
use codex_protocol::root_resume::RootResumeReservation;
use codex_protocol::root_resume::RootResumeWakeReason;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::time::Instant;

#[derive(Clone)]
pub(crate) struct RootResumeTiming {
    thread_id: String,
    reservation_id: String,
    resume_turn_id: String,
    wake_reason: &'static str,
    started: Instant,
    model_request_started: Arc<AtomicBool>,
    model_request_submitted: Arc<AtomicBool>,
}

impl RootResumeTiming {
    pub(crate) fn new(record: &RootResumeReservation, reason: &RootResumeWakeReason) -> Self {
        let timing = Self {
            thread_id: record.root_thread_id.clone(),
            reservation_id: record.id.clone(),
            resume_turn_id: record.resume_turn_id.clone(),
            wake_reason: match reason {
                RootResumeWakeReason::Deadline => "deadline",
                RootResumeWakeReason::AgentsCompleted => "agents_completed",
                RootResumeWakeReason::WorkCompleted => "work_completed",
                RootResumeWakeReason::ParentRequest => "parent_request",
                RootResumeWakeReason::UserInput => "user_input",
                RootResumeWakeReason::Manual => "manual",
            },
            started: Instant::now(),
            model_request_started: Arc::new(AtomicBool::new(false)),
            model_request_submitted: Arc::new(AtomicBool::new(false)),
        };
        timing.record("wake_detected", "completed", 0);
        timing
    }

    fn record(&self, phase: &'static str, outcome: &'static str, duration_ms: u64) {
        tracing::info!(
            target: "azrael_root_resume",
            event = "root_resume_timing",
            thread_id = %self.thread_id,
            reservation_id = %self.reservation_id,
            resume_turn_id = %self.resume_turn_id,
            wake_reason = self.wake_reason,
            phase,
            outcome,
            duration_ms,
            elapsed_ms = millis(self.started),
            "root resume timing"
        );
    }

    pub(crate) fn first_model_request(&self) -> Option<RootResumePhase> {
        if self.model_request_started.swap(true, Ordering::Relaxed) {
            return None;
        }
        Some(RootResumePhase::new(Some(self), "model_request"))
    }

    /// First non-warmup native transport invocation, not proof of server receipt.
    pub(crate) fn model_request_submitted(&self) {
        if !self.model_request_submitted.swap(true, Ordering::Relaxed) {
            self.record("model_request_submit", "started", 0);
        }
    }
}

fn millis(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// A dropped in-flight phase records cancellation, never a successful completion.
pub(crate) struct RootResumePhase {
    timing: Option<RootResumeTiming>,
    phase: &'static str,
    started: Instant,
    finished: bool,
}

impl RootResumePhase {
    pub(crate) fn new(timing: Option<&RootResumeTiming>, phase: &'static str) -> Self {
        let guard = Self {
            timing: timing.cloned(),
            phase,
            started: Instant::now(),
            finished: false,
        };
        if let Some(timing) = &guard.timing {
            timing.record(phase, "started", 0);
        }
        guard
    }

    pub(crate) fn finish(mut self, succeeded: bool) {
        if let Some(timing) = &self.timing {
            timing.record(
                self.phase,
                if succeeded { "completed" } else { "failed" },
                millis(self.started),
            );
        }
        self.finished = true;
    }
}

impl Drop for RootResumePhase {
    fn drop(&mut self) {
        if !self.finished
            && let Some(timing) = &self.timing
        {
            timing.record(self.phase, "cancelled", millis(self.started));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::Mutex;

    #[derive(Clone)]
    struct Capture(Arc<Mutex<Vec<u8>>>);

    impl Write for Capture {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn timing() -> RootResumeTiming {
        RootResumeTiming {
            thread_id: "00000000-0000-4000-8000-000000000003".into(),
            reservation_id: "00000000-0000-4000-8000-000000000001".into(),
            resume_turn_id: "00000000-0000-4000-8000-000000000002".into(),
            wake_reason: "deadline",
            started: Instant::now(),
            model_request_started: Arc::new(AtomicBool::new(false)),
            model_request_submitted: Arc::new(AtomicBool::new(false)),
        }
    }

    fn capture(f: impl FnOnce()) -> String {
        let bytes = Arc::new(Mutex::new(Vec::new()));
        let writer = Capture(Arc::clone(&bytes));
        let subscriber = tracing_subscriber::fmt()
            .without_time()
            .with_ansi(false)
            .with_writer(move || writer.clone())
            .finish();
        tracing::subscriber::with_default(subscriber, f);
        let captured = bytes.lock().unwrap().clone();
        String::from_utf8(captured).unwrap()
    }

    #[test]
    fn root_resume_timing_records_correlated_success_failure_and_cancellation() {
        let log = capture(|| {
            let timing = timing();
            RootResumePhase::new(Some(&timing), "execution_admission").finish(true);
            RootResumePhase::new(Some(&timing), "history_flush").finish(false);
            drop(RootResumePhase::new(Some(&timing), "submission_gate"));
        });
        let lines: Vec<_> = log.lines().collect();
        assert_eq!(lines.len(), 6);
        for line in &lines {
            assert!(line.contains("event=\"root_resume_timing\""));
            assert!(line.contains("thread_id=00000000-0000-4000-8000-000000000003"));
            assert!(line.contains("reservation_id=00000000-0000-4000-8000-000000000001"));
            assert!(line.contains("resume_turn_id=00000000-0000-4000-8000-000000000002"));
            assert!(line.contains("elapsed_ms="));
            assert!(line.contains("duration_ms="));
        }
        assert!(lines[1].contains("outcome=\"completed\""));
        assert!(lines[3].contains("outcome=\"failed\""));
        assert!(lines[5].contains("outcome=\"cancelled\""));
    }

    #[test]
    fn root_resume_timing_first_request_is_shared_across_clones_and_not_repeated() {
        let log = capture(|| {
            let timing = timing();
            let phase = timing.first_model_request().unwrap();
            assert!(timing.clone().first_model_request().is_none());
            timing.model_request_submitted();
            timing.clone().model_request_submitted();
            phase.finish(true);
            RootResumePhase::new(None, "history_flush").finish(true);
        });
        assert_eq!(log.lines().count(), 3);
        assert_eq!(log.matches("phase=\"model_request_submit\"").count(), 1);
        assert_eq!(log.matches("outcome=\"completed\"").count(), 1);
    }

    #[test]
    fn root_resume_timing_manual_resume_reaches_native_request_boundary() {
        use crate::current_time::SystemTimeProvider;
        use crate::session::tests::make_persistent_session_and_context_with_time_provider_and_rx;
        use codex_history::InitialHistory;
        use core_test_support::responses::ev_completed;
        use core_test_support::responses::ev_response_created;
        use core_test_support::responses::mount_sse_once;
        use core_test_support::responses::sse;
        use core_test_support::responses::start_mock_server;
        use std::time::Duration;

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let log = capture(|| {
            runtime.block_on(async {
                let server = start_mock_server().await;
                let requests = mount_sse_once(
                    &server,
                    sse(vec![
                        ev_response_created("timing-response"),
                        ev_completed("timing-response"),
                    ]),
                )
                .await;
                let home = tempfile::tempdir().unwrap();
                let (session, turn, _events) =
                    make_persistent_session_and_context_with_time_provider_and_rx(
                        home.path(),
                        InitialHistory::New,
                        Arc::new(SystemTimeProvider),
                        format!("{}/v1", server.uri()),
                    )
                    .await
                    .unwrap();
                session
                    .prepare_root_resume(
                        &turn,
                        "timing-defer",
                        Some(60_000),
                        None,
                        Vec::new(),
                        "fixture dependency".into(),
                    )
                    .await
                    .unwrap();
                assert!(session.defer_root_after_tools(&turn).await.unwrap());
                assert!(session.finish_deferred_root(&turn).await);
                let record = session
                    .state_db()
                    .unwrap()
                    .get_active_root_resume(&session.thread_id.to_string())
                    .await
                    .unwrap()
                    .unwrap();
                session
                    .manually_resume_root(&record.id, record.revision)
                    .await
                    .unwrap();
                tokio::time::timeout(Duration::from_secs(10), async {
                    while requests.requests().is_empty()
                        || session.active_turn.lock().await.is_some()
                    {
                        tokio::time::sleep(Duration::from_millis(10)).await;
                    }
                })
                .await
                .unwrap();
                assert_eq!(requests.requests().len(), 1);
                session.close_root_resume_runtime().await;
            });
        });
        let timing_rows: Vec<_> = log
            .lines()
            .filter(|line| line.contains("event=\"root_resume_timing\""))
            .collect();
        for phase in [
            "wake_detected",
            "execution_admission",
            "submission_gate",
            "history_flush",
            "reservation_claim",
            "turn_context",
            "turn_start",
            "model_request",
            "model_request_submit",
            "resume_dispatch",
        ] {
            assert!(
                timing_rows
                    .iter()
                    .any(|line| line.contains(&format!("phase=\"{phase}\""))),
                "missing {phase}: {timing_rows:?}"
            );
        }
        assert_eq!(
            timing_rows
                .iter()
                .filter(|line| line.contains("phase=\"model_request_submit\""))
                .count(),
            1
        );
        assert!(
            timing_rows
                .iter()
                .all(|line| line.contains("wake_reason=\"manual\""))
        );
        for phase in [
            "execution_admission",
            "submission_gate",
            "history_flush",
            "reservation_claim",
            "turn_context",
            "turn_start",
            "resume_dispatch",
        ] {
            let rows: Vec<_> = timing_rows
                .iter()
                .filter(|line| line.contains(&format!("phase=\"{phase}\"")))
                .collect();
            assert_eq!(
                rows.iter()
                    .filter(|line| line.contains("outcome=\"completed\""))
                    .count(),
                1,
                "missing successful {phase}: {rows:?}"
            );
            assert!(
                !rows.iter().any(|line| line.contains("outcome=\"failed\"")
                    || line.contains("outcome=\"cancelled\"")),
                "unexpected terminal outcome for {phase}: {rows:?}"
            );
        }
        // A failed first client attempt may precede a later HTTP retry. Preserve that
        // outcome while requiring exactly one first-attempt boundary and terminal result.
        let requests: Vec<_> = timing_rows
            .iter()
            .filter(|line| line.contains("phase=\"model_request\""))
            .collect();
        assert_eq!(
            requests.len(),
            2,
            "first attempt must be recorded once: {requests:?}"
        );
        assert!(requests[0].contains("outcome=\"started\""));
        assert!(
            requests[1].contains("outcome=\"completed\"")
                || requests[1].contains("outcome=\"failed\""),
            "first attempt must retain its actual outcome: {requests:?}"
        );
    }
}

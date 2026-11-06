//! Pure turn-local accounting. Callers supply monotonic elapsed milliseconds;
//! wall timestamps are derived from one origin and never from a second clock.

use std::collections::BTreeMap;
use std::collections::BTreeSet;

use codex_protocol::user_wait::UserWaitInterval;
use codex_protocol::user_wait::UserWaitRequest;
use codex_protocol::user_wait::UserWaitTiming;

#[derive(Debug)]
struct Request {
    value: UserWaitRequest,
    started_ms: u64,
}

#[derive(Debug)]
struct Activity {
    parent: Option<String>,
    passive: bool,
}

#[derive(Debug)]
pub(crate) struct UserWaitTracker {
    wall_origin_ms: i64,
    last_elapsed_ms: u64,
    revision: u64,
    activities: BTreeMap<String, Activity>,
    dependency_waits: BTreeSet<String>,
    requests: Vec<Request>,
    blocked_intervals: Vec<UserWaitInterval>,
    finished: bool,
}

impl UserWaitTracker {
    pub(crate) fn new(wall_origin_ms: i64) -> Self {
        Self {
            wall_origin_ms,
            last_elapsed_ms: 0,
            revision: 0,
            activities: BTreeMap::new(),
            dependency_waits: BTreeSet::new(),
            requests: Vec::new(),
            blocked_intervals: Vec::new(),
            finished: false,
        }
    }

    /// Parent containers do not count as running while they have live children.
    /// Activity IDs must be unique within a turn; duplicate starts are ignored.
    pub(crate) fn begin_activity(
        &mut self,
        id: impl Into<String>,
        parent: Option<String>,
        now_ms: u64,
    ) {
        self.start_activity(id.into(), parent, false, now_ms);
    }

    /// Keep a waiting container in the hierarchy without treating it as work.
    pub(crate) fn begin_passive_activity(
        &mut self,
        id: impl Into<String>,
        parent: Option<String>,
        now_ms: u64,
    ) {
        self.start_activity(id.into(), parent, true, now_ms);
    }

    fn start_activity(&mut self, id: String, parent: Option<String>, passive: bool, now_ms: u64) {
        if self.finished || self.activities.contains_key(&id) {
            return;
        }
        let now_ms = self.advance(now_ms);
        self.activities.insert(id, Activity { parent, passive });
        self.changed(now_ms);
    }

    pub(crate) fn end_activity(&mut self, id: &str, now_ms: u64) {
        if self.finished {
            return;
        }
        let activity_ended = self.activities.remove(id).is_some();
        let dependency_ended = self.dependency_waits.remove(id);
        if !activity_ended && !dependency_ended {
            return;
        }
        let now_ms = self.advance(now_ms);
        self.changed(now_ms);
    }

    /// Track a human-blocked dependency without attributing its raw request here.
    pub(crate) fn set_dependency_wait(
        &mut self,
        id: impl Into<String>,
        blocked: bool,
        now_ms: u64,
    ) {
        if self.finished {
            return;
        }
        let id = id.into();
        let changed = if blocked {
            self.dependency_waits.insert(id)
        } else {
            self.dependency_waits.remove(&id)
        };
        if changed {
            let now_ms = self.advance(now_ms);
            self.changed(now_ms);
        }
    }

    /// Whether this live activity subtree contains an executing leaf.
    pub(crate) fn activity_running(&self, id: &str) -> bool {
        if self.finished || !self.activities.contains_key(id) {
            return false;
        }
        self.activities.keys().any(|leaf| {
            if !self.running_leaf(leaf) {
                return false;
            }
            let mut ancestor = leaf.as_str();
            // Bound traversal even if a caller supplies a cyclic hierarchy.
            for _ in 0..self.activities.len() {
                if ancestor == id {
                    return true;
                }
                let Some(parent) = self
                    .activities
                    .get(ancestor)
                    .and_then(|activity| activity.parent.as_deref())
                else {
                    break;
                };
                ancestor = parent;
            }
            false
        })
    }

    /// Only actual human-response waits belong here. An asynchronous question
    /// must retain its continuing model/tool activity until that work stops.
    pub(crate) fn begin_wait(
        &mut self,
        request_id: impl Into<String>,
        call_id: impl Into<String>,
        kind: impl Into<String>,
        now_ms: u64,
    ) {
        let request_id = request_id.into();
        if self
            .requests
            .iter()
            .any(|request| request.value.request_id == request_id)
        {
            return;
        }
        let now_ms = self.advance(now_ms);
        self.requests.push(Request {
            value: UserWaitRequest {
                request_id,
                call_id: call_id.into(),
                kind: kind.into(),
                started_at_ms: self.wall_time(now_ms),
                ended_at_ms: None,
                duration_ms: None,
            },
            started_ms: now_ms,
        });
        self.changed(now_ms);
    }

    pub(crate) fn end_wait(&mut self, request_id: &str, now_ms: u64) {
        let Some(index) = self.requests.iter().position(|request| {
            request.value.request_id == request_id && request.value.ended_at_ms.is_none()
        }) else {
            return;
        };
        let now_ms = self.advance(now_ms);
        let ended_at_ms = self.wall_time(now_ms);
        Self::close_request(&mut self.requests[index], now_ms, ended_at_ms);
        self.changed(now_ms);
    }

    /// Seal work timing and existing requests at the terminal boundary. Retained
    /// cells may later create distinct raw request lifetimes under this turn.
    pub(crate) fn finish(&mut self, now_ms: u64) {
        if self.finished {
            return;
        }
        let now_ms = self.advance(now_ms);
        let ended_at_ms = self.wall_time(now_ms);
        for request in &mut self.requests {
            if request.value.ended_at_ms.is_none() {
                Self::close_request(request, now_ms, ended_at_ms);
            }
        }
        self.activities.clear();
        self.dependency_waits.clear();
        self.finished = true;
        self.changed(now_ms);
    }

    /// Open boundaries remain open for consumers to render against their clock.
    /// Sampling does not create revisions or mutate a terminal measurement.
    pub(crate) fn snapshot(&self, _now_ms: u64) -> UserWaitTiming {
        UserWaitTiming {
            started_at_ms: Some(self.wall_origin_ms),
            revision: self.revision,
            requests: self
                .requests
                .iter()
                .map(|request| request.value.clone())
                .collect(),
            blocked_intervals: self.blocked_intervals.clone(),
        }
    }

    fn close_request(request: &mut Request, now_ms: u64, ended_at_ms: i64) {
        request.value.ended_at_ms = Some(ended_at_ms);
        request.value.duration_ms =
            Some(i64::try_from(now_ms.saturating_sub(request.started_ms)).unwrap_or(i64::MAX));
    }

    fn advance(&mut self, now_ms: u64) -> u64 {
        self.last_elapsed_ms = self.last_elapsed_ms.max(now_ms);
        self.last_elapsed_ms
    }

    fn wall_time(&self, elapsed_ms: u64) -> i64 {
        (i128::from(self.wall_origin_ms) + i128::from(elapsed_ms))
            .clamp(i128::from(i64::MIN), i128::from(i64::MAX)) as i64
    }

    fn running_leaf(&self, id: &str) -> bool {
        !self.finished
            && self
                .activities
                .get(id)
                .is_some_and(|activity| !activity.passive)
            && !self.dependency_waits.contains(id)
            && !self
                .activities
                .values()
                .any(|activity| activity.parent.as_deref() == Some(id))
            && !self
                .requests
                .iter()
                .any(|request| request.value.ended_at_ms.is_none() && request.value.call_id == id)
    }

    fn changed(&mut self, now_ms: u64) {
        self.revision = self.revision.saturating_add(1);
        let pending = !self.dependency_waits.is_empty()
            || self
                .requests
                .iter()
                .any(|request| request.value.ended_at_ms.is_none());
        let running_leaf = self.activities.keys().any(|id| self.running_leaf(id));
        let blocked = pending && !running_leaf && !self.finished;
        let open = self
            .blocked_intervals
            .last()
            .is_some_and(|interval| interval.ended_at_ms.is_none());
        let wall_time = self.wall_time(now_ms);
        match (blocked, open) {
            (true, false) => self.blocked_intervals.push(UserWaitInterval {
                started_at_ms: wall_time,
                ended_at_ms: None,
            }),
            (false, true) => {
                if let Some(interval) = self.blocked_intervals.last_mut() {
                    interval.ended_at_ms = Some(wall_time);
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn intervals(tracker: &UserWaitTracker) -> Vec<(i64, Option<i64>)> {
        tracker
            .snapshot(0)
            .blocked_intervals
            .into_iter()
            .map(|interval| (interval.started_at_ms, interval.ended_at_ms))
            .collect()
    }

    #[test]
    fn approval_preserves_raw_duration_and_blocks_only_until_response() {
        let mut tracker = UserWaitTracker::new(1_000);
        tracker.begin_activity("exec", None, 0);
        tracker.begin_wait("approval", "exec", "approval", 10);
        assert_eq!(intervals(&tracker), vec![(1_010, None)]);
        assert_eq!(tracker.snapshot(25).requests[0].duration_ms, None);
        tracker.end_wait("approval", 40);
        tracker.end_activity("exec", 60);
        tracker.finish(70);
        assert_eq!(intervals(&tracker), vec![(1_010, Some(1_040))]);
        let request = &tracker.snapshot(1_000).requests[0];
        assert_eq!(request.started_at_ms, 1_010);
        assert_eq!(request.ended_at_ms, Some(1_040));
        assert_eq!(request.duration_ms, Some(30));
    }

    #[test]
    fn overlapping_requests_share_one_blocked_interval_and_are_idempotent() {
        let mut tracker = UserWaitTracker::new(0);
        tracker.begin_wait("a", "unknown-a", "input", 10);
        tracker.begin_wait("b", "unknown-b", "approval", 20);
        let revision = tracker.snapshot(20).revision;
        tracker.begin_wait("a", "changed", "changed", 25);
        assert_eq!(tracker.snapshot(25).revision, revision);
        tracker.end_wait("a", 30);
        assert_eq!(intervals(&tracker), vec![(10, None)]);
        tracker.end_wait("b", 50);
        tracker.end_wait("a", 60);
        let snapshot = tracker.snapshot(100);
        assert_eq!(intervals(&tracker), vec![(10, Some(50))]);
        assert_eq!(snapshot.requests[0].duration_ms, Some(20));
        assert_eq!(snapshot.requests[1].duration_ms, Some(30));
    }

    #[test]
    fn unrelated_running_tool_preserves_work_and_splits_blocked_intervals() {
        let mut tracker = UserWaitTracker::new(0);
        tracker.begin_activity("other-tool", None, 0);
        tracker.begin_wait("a", "unregistered-call", "input", 10);
        assert!(intervals(&tracker).is_empty());
        tracker.end_activity("other-tool", 20);
        tracker.begin_activity("another-tool", None, 30);
        tracker.end_activity("another-tool", 40);
        tracker.end_wait("a", 50);
        assert_eq!(intervals(&tracker), vec![(20, Some(30)), (40, Some(50))]);
        assert_eq!(tracker.snapshot(50).requests[0].duration_ms, Some(40));
    }

    #[test]
    fn nested_containers_do_not_mask_a_waiting_leaf() {
        let mut tracker = UserWaitTracker::new(0);
        tracker.begin_activity("container", None, 0);
        tracker.begin_activity("nested", Some("container".into()), 1);
        tracker.begin_activity("exec", Some("nested".into()), 2);
        tracker.begin_wait("a", "exec", "approval", 10);
        assert_eq!(intervals(&tracker), vec![(10, None)]);
        tracker.begin_activity("sibling", Some("container".into()), 20);
        tracker.end_activity("sibling", 30);
        tracker.end_wait("a", 40);
        assert_eq!(intervals(&tracker), vec![(10, Some(20)), (30, Some(40))]);
    }

    #[test]
    fn asynchronous_question_keeps_model_sampling_time() {
        let mut tracker = UserWaitTracker::new(0);
        tracker.begin_activity("input-call", None, 0);
        tracker.begin_activity("model", None, 1);
        tracker.begin_wait("question", "input-call", "input", 10);
        assert!(intervals(&tracker).is_empty());
        tracker.end_activity("model", 30);
        assert_eq!(intervals(&tracker), vec![(30, None)]);
        tracker.begin_activity("model-next", None, 40);
        tracker.end_wait("question", 50);
        assert_eq!(intervals(&tracker), vec![(30, Some(40))]);
        assert_eq!(tracker.snapshot(50).requests[0].duration_ms, Some(40));
    }

    #[test]
    fn cancellation_closes_pending_requests_and_freezes_their_late_events() {
        let mut tracker = UserWaitTracker::new(100);
        tracker.begin_wait("a", "exec", "approval", 10);
        tracker.begin_wait("b", "input", "input", 20);
        tracker.finish(40);
        let frozen = tracker.snapshot(40);
        assert_eq!(intervals(&tracker), vec![(110, Some(140))]);
        assert_eq!(frozen.requests[0].duration_ms, Some(30));
        assert_eq!(frozen.requests[1].duration_ms, Some(20));
        tracker.end_wait("a", 50);
        tracker.begin_wait("a", "changed", "input", 60);
        tracker.begin_activity("late-tool", None, 70);
        tracker.end_activity("late-tool", 80);
        tracker.finish(90);
        assert_eq!(tracker.snapshot(1_000), frozen);
    }

    #[test]
    fn new_post_terminal_requests_record_answer_and_cancellation_without_reopening_work() {
        let mut tracker = UserWaitTracker::new(1_000);
        tracker.begin_wait("prior", "tool", "approval", 10);
        tracker.finish(20);
        let terminal = tracker.snapshot(20);
        tracker.begin_wait("answered", "old-cell-tool", "approval", 30);
        let live = tracker.snapshot(40);
        assert_eq!(live.requests[1].ended_at_ms, None);
        assert_eq!(live.blocked_intervals, terminal.blocked_intervals);
        tracker.end_wait("answered", 50);
        tracker.begin_wait("cancelled", "old-cell-tool", "input", 60);
        tracker.end_wait("cancelled", 75);
        tracker.begin_wait("prior", "other", "approval", 80);
        tracker.end_wait("prior", 90);
        tracker.finish(100);
        let final_timing = tracker.snapshot(100);
        assert_eq!(final_timing.requests[0], terminal.requests[0]);
        assert_eq!(final_timing.requests[1].duration_ms, Some(20));
        assert_eq!(final_timing.requests[2].duration_ms, Some(15));
        assert_eq!(final_timing.blocked_intervals, terminal.blocked_intervals);
        assert!(final_timing.revision > terminal.revision);
    }

    #[test]
    fn backward_elapsed_input_cannot_create_negative_durations() {
        let mut tracker = UserWaitTracker::new(-100);
        tracker.begin_wait("a", "exec", "approval", 20);
        tracker.end_wait("a", 10);
        assert_eq!(tracker.snapshot(0).requests[0].duration_ms, Some(0));
        assert_eq!(intervals(&tracker), vec![(-80, Some(-80))]);
    }

    #[test]
    fn activity_subtree_tracks_nested_tools_wait_resume_and_close() {
        let mut tracker = UserWaitTracker::new(0);
        tracker.begin_activity("cell", None, 0);
        tracker.begin_activity("nested", Some("cell".into()), 1);
        tracker.begin_activity("first", Some("nested".into()), 2);
        tracker.begin_activity("second", Some("nested".into()), 3);
        tracker.begin_activity("unrelated", None, 4);
        assert!(tracker.activity_running("cell"));
        assert!(tracker.activity_running("nested"));
        assert!(!tracker.activity_running("absent"));

        tracker.begin_wait("a", "first", "approval", 10);
        assert!(!tracker.activity_running("first"));
        assert!(tracker.activity_running("second"));
        assert!(tracker.activity_running("cell"));
        tracker.begin_wait("b", "second", "input", 20);
        assert!(!tracker.activity_running("nested"));
        assert!(!tracker.activity_running("cell"));
        assert!(tracker.activity_running("unrelated"));

        tracker.end_wait("a", 30);
        assert!(tracker.activity_running("cell"));
        assert!(tracker.activity_running("first"));
        tracker.end_activity("first", 40);
        assert!(!tracker.activity_running("cell"));
        tracker.end_wait("b", 50);
        tracker.end_activity("second", 51);
        assert!(tracker.activity_running("nested"));
        tracker.end_activity("nested", 52);
        assert!(tracker.activity_running("cell"));
        tracker.end_activity("cell", 53);
        assert!(!tracker.activity_running("cell"));
        tracker.finish(60);
        assert!(!tracker.activity_running("unrelated"));
    }

    #[test]
    fn passive_wait_suppresses_ancestor_without_fabricating_human_wait() {
        let mut tracker = UserWaitTracker::new(0);
        tracker.begin_activity("cell", None, 0);
        tracker.begin_passive_activity("wait", Some("cell".into()), 10);
        assert!(!tracker.activity_running("cell"));
        assert!(!tracker.activity_running("wait"));
        assert!(intervals(&tracker).is_empty());
        assert!(tracker.snapshot(20).requests.is_empty());

        tracker.begin_wait("real-request", "wait", "input", 20);
        assert_eq!(intervals(&tracker), vec![(20, None)]);
        tracker.end_wait("real-request", 30);
        assert_eq!(intervals(&tracker), vec![(20, Some(30))]);
        tracker.end_activity("wait", 40);
        assert!(tracker.activity_running("cell"));
    }

    #[test]
    fn blocked_child_dependency_excludes_only_when_no_other_work_executes() {
        for work in ["model", "tool", "process", "otherchild"] {
            let mut tracker = UserWaitTracker::new(0);
            tracker.begin_activity("cell", None, 0);
            tracker.begin_passive_activity("wait", Some("cell".into()), 1);
            tracker.set_dependency_wait("child", true, 10);
            assert_eq!(intervals(&tracker), vec![(10, None)]);
            assert!(tracker.snapshot(10).requests.is_empty());

            // A passive node still allows its descendants to execute.
            tracker.begin_activity(work, Some("wait".into()), 20);
            assert!(tracker.activity_running("wait"));
            assert!(tracker.activity_running("cell"));
            assert_eq!(intervals(&tracker), vec![(10, Some(20))]);
            tracker.end_activity(work, 30);
            tracker.set_dependency_wait("child", false, 40);
            assert_eq!(intervals(&tracker), vec![(10, Some(20)), (30, Some(40))]);
            assert!(tracker.snapshot(50).requests.is_empty());
        }
    }

    #[test]
    fn dependency_waits_are_idempotent_and_end_with_their_activity() {
        let mut tracker = UserWaitTracker::new(0);
        tracker.begin_activity("child", None, 0);
        tracker.set_dependency_wait("child", true, 10);
        assert!(!tracker.activity_running("child"));
        let revision = tracker.snapshot(10).revision;
        tracker.begin_passive_activity("child", None, 11);
        tracker.set_dependency_wait("child", true, 12);
        assert_eq!(tracker.snapshot(12).revision, revision);
        tracker.end_activity("child", 20);
        assert_eq!(intervals(&tracker), vec![(10, Some(20))]);
        let revision = tracker.snapshot(20).revision;
        tracker.set_dependency_wait("child", false, 21);
        tracker.end_activity("child", 22);
        assert_eq!(tracker.snapshot(22).revision, revision);

        tracker.set_dependency_wait("source-only", true, 30);
        tracker.end_activity("source-only", 40);
        assert_eq!(intervals(&tracker), vec![(10, Some(20)), (30, Some(40))]);
    }

    #[test]
    fn terminal_seals_passive_and_dependency_work_but_allows_new_raw_lifetimes() {
        let mut tracker = UserWaitTracker::new(0);
        tracker.begin_activity("cell", None, 0);
        tracker.begin_passive_activity("wait", Some("cell".into()), 1);
        tracker.set_dependency_wait("child", true, 10);
        tracker.begin_wait("prior", "wait", "approval", 15);
        tracker.finish(20);
        let terminal = tracker.snapshot(20);
        assert_eq!(intervals(&tracker), vec![(10, Some(20))]);
        tracker.begin_passive_activity("late-container", None, 30);
        tracker.set_dependency_wait("late-child", true, 31);
        tracker.set_dependency_wait("child", false, 32);
        tracker.end_activity("wait", 33);
        assert_eq!(tracker.snapshot(33), terminal);
        assert!(!tracker.activity_running("cell"));

        tracker.begin_wait("late-request", "old-cell", "input", 40);
        tracker.end_wait("late-request", 50);
        tracker.begin_wait("prior", "different", "input", 60);
        tracker.end_wait("prior", 70);
        let final_timing = tracker.snapshot(80);
        assert_eq!(final_timing.blocked_intervals, terminal.blocked_intervals);
        assert_eq!(final_timing.requests[0], terminal.requests[0]);
        assert_eq!(final_timing.requests[1].duration_ms, Some(10));
    }
}

//! Monotonic runtime and cancellation-safe guards for human-response timing.
use crate::session::session::Session;
use crate::user_wait_timing::UserWaitTracker;

tokio::task_local! { pub(crate) static TOOL_CALL_ID: String; }
use codex_protocol::protocol::{Event, EventMsg, UserWaitTimingUpdatedEvent};
use codex_protocol::user_wait::UserWaitTiming;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Instant;
use tokio::sync::watch;

#[derive(Debug)]
pub(crate) struct UserWaitRuntime {
    origin: Instant,
    running: watch::Sender<Option<bool>>,
    tracker: Mutex<UserWaitTracker>,
    live_tracker: Mutex<UserWaitTracker>,
    updates: watch::Sender<u64>,
    sequence: AtomicU64,
    children: Mutex<std::collections::HashMap<String, ChildBinding>>,
    timing_updates: watch::Sender<UserWaitTiming>,
    publication: Arc<Publication>,
    publisher_started: AtomicBool,
    finished: AtomicBool,
}
#[derive(Debug)]
struct ChildBinding {
    generation: u64,
    running: watch::Receiver<Option<bool>>,
    stop: tokio_util::sync::CancellationToken,
}
struct ChildSourceGuard {
    runtime: Weak<UserWaitRuntime>,
    id: String,
}
impl Drop for ChildSourceGuard {
    fn drop(&mut self) {
        if let Some(runtime) = self.runtime.upgrade() {
            runtime.change(|tracker, now| {
                tracker.end_activity(&self.id, now);
                tracker.set_dependency_wait(self.id.clone(), false, now);
            });
        }
    }
}
#[derive(Debug, Default)]
struct Publication {
    publishing: tokio::sync::Mutex<()>,
    admitted: AtomicBool,
    last_published: Mutex<Option<UserWaitTiming>>,
}
impl Publication {
    async fn publish(&self, session: &Session, turn_id: &str, timing: UserWaitTiming) {
        let _publishing = self.publishing.lock().await;
        if self.admitted.load(Ordering::Acquire) {
            self.publish_locked(session, turn_id, timing).await;
        }
    }
    async fn publish_locked(&self, session: &Session, turn_id: &str, timing: UserWaitTiming) {
        {
            let mut last = self
                .last_published
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if last.as_ref().is_some_and(|last| {
                last.revision >= timing.revision
                    || (last.requests == timing.requests
                        && last.blocked_intervals == timing.blocked_intervals)
            }) {
                return;
            }
            *last = Some(timing.clone());
        }
        session
            .send_event_raw(Event {
                id: turn_id.to_owned(),
                msg: EventMsg::UserWaitTimingUpdated(UserWaitTimingUpdatedEvent {
                    turn_id: turn_id.to_owned(),
                    timing,
                }),
            })
            .await;
    }
}

pub(crate) struct UserWaitGuard {
    runtime: Weak<UserWaitRuntime>,
    id: String,
    wait: bool,
}
impl UserWaitRuntime {
    pub(crate) fn new(origin: Instant, wall_origin_ms: i64) -> Arc<Self> {
        Arc::new(Self {
            origin,
            running: watch::channel(Some(true)).0,
            tracker: Mutex::new(UserWaitTracker::new(wall_origin_ms)),
            live_tracker: Mutex::new(UserWaitTracker::new(wall_origin_ms)),
            updates: watch::channel(0).0,
            sequence: AtomicU64::new(0),
            children: Mutex::new(std::collections::HashMap::new()),
            timing_updates: watch::channel(UserWaitTracker::new(wall_origin_ms).snapshot(0)).0,
            publication: Arc::new(Publication::default()),
            publisher_started: AtomicBool::new(false),
            finished: AtomicBool::new(false),
        })
    }
    fn elapsed(&self) -> u64 {
        u64::try_from(self.origin.elapsed().as_millis()).unwrap_or(u64::MAX)
    }
    fn change(&self, mut change: impl FnMut(&mut UserWaitTracker, u64)) {
        let mut tracker = self
            .tracker
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let now = self.elapsed();
        change(&mut tracker, now);
        let mut live = self
            .live_tracker
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        change(&mut live, now);
        let revision = live.snapshot(now).revision;
        drop(live);
        let snapshot = tracker.snapshot(self.elapsed());
        self.updates.send_replace(revision);
        let running = !self.finished.load(Ordering::Acquire)
            && !snapshot
                .blocked_intervals
                .last()
                .is_some_and(|interval| interval.ended_at_ms.is_none());
        drop(tracker);
        self.timing_updates.send_replace(snapshot);
        let running = (!self.finished.load(Ordering::Acquire)).then_some(running);
        self.running.send_if_modified(|value| {
            if *value == running {
                false
            } else {
                *value = running;
                true
            }
        });
    }
    pub(crate) fn subscribe_running(&self) -> watch::Receiver<Option<bool>> {
        self.running.subscribe()
    }

    pub(crate) fn track_child(
        self: &Arc<Self>,
        id: String,
        running: watch::Receiver<Option<bool>>,
    ) {
        let generation = self.sequence.fetch_add(1, Ordering::Relaxed);
        let stop = tokio_util::sync::CancellationToken::new();
        {
            let mut children = self
                .children
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if children
                .get(&id)
                .is_some_and(|binding| binding.running.same_channel(&running))
            {
                return;
            }
            if let Some(old) = children.insert(
                id.clone(),
                ChildBinding {
                    generation,
                    running: running.clone(),
                    stop: stop.clone(),
                },
            ) {
                old.stop.cancel();
            }
        }
        let guard = ChildSourceGuard {
            runtime: Arc::downgrade(self),
            id: format!("child-source:{generation}:{id}"),
        };
        let runtime = Arc::downgrade(self);
        let mut target_state = self.running.subscribe();
        tokio::spawn(async move {
            let mut running = running;
            let mut previous = None;
            loop {
                let Some(runtime) = runtime.upgrade() else {
                    return;
                };
                if runtime.finished.load(Ordering::Acquire) || stop.is_cancelled() {
                    break;
                }
                let state = *running.borrow_and_update();
                if previous != Some(state) {
                    runtime.change(|tracker, now| match state {
                        Some(true) => {
                            tracker.set_dependency_wait(guard.id.clone(), false, now);
                            tracker.begin_activity(guard.id.clone(), None, now);
                        }
                        Some(false) => {
                            tracker.end_activity(&guard.id, now);
                            tracker.set_dependency_wait(guard.id.clone(), true, now);
                        }
                        None => {
                            tracker.end_activity(&guard.id, now);
                            tracker.set_dependency_wait(guard.id.clone(), false, now);
                        }
                    });
                    previous = Some(state);
                }
                drop(runtime);
                if state.is_none() {
                    break;
                }
                tokio::select! {
                    _ = stop.cancelled() => break,
                    changed = running.changed() => { if changed.is_err() { break; } },
                    changed = target_state.changed() => {
                        if changed.is_err() || target_state.borrow().is_none() { break; }
                    },
                }
            }
            drop(guard);
            if let Some(runtime) = runtime.upgrade() {
                let mut children = runtime
                    .children
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if children
                    .get(&id)
                    .is_some_and(|binding| binding.generation == generation)
                {
                    children.remove(&id);
                }
            }
        });
    }

    pub(crate) fn mirror_activity(
        self: &Arc<Self>,
        id: String,
        source: &Arc<Self>,
        source_id: String,
    ) -> tokio_util::task::AbortOnDropHandle<()> {
        let mut updates = source.updates.subscribe();
        let mut target_state = self.running.subscribe();
        let target = Arc::downgrade(self);
        let source = Arc::downgrade(source);
        tokio_util::task::AbortOnDropHandle::new(tokio::spawn(async move {
            let mut activity = None;
            loop {
                let (Some(target), Some(source)) = (target.upgrade(), source.upgrade()) else {
                    return;
                };
                if target.finished.load(Ordering::Acquire) {
                    return;
                }
                let running = source
                    .live_tracker
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .activity_running(&source_id);
                if running {
                    if activity.is_none() {
                        activity = Some(target.activity(id.clone(), None));
                    }
                } else {
                    activity = None;
                }
                drop(target);
                drop(source);
                tokio::select! {
                    changed = updates.changed() => { if changed.is_err() { return; } },
                    changed = target_state.changed() => { if changed.is_err() || target_state.borrow().is_none() { return; } },
                }
            }
        }))
    }

    pub(crate) fn activity(self: &Arc<Self>, id: String, parent: Option<String>) -> UserWaitGuard {
        self.change(|tracker, now| tracker.begin_activity(id.clone(), parent.clone(), now));
        UserWaitGuard {
            runtime: Arc::downgrade(self),
            id,
            wait: false,
        }
    }
    pub(crate) fn passive_activity(
        self: &Arc<Self>,
        id: String,
        parent: Option<String>,
    ) -> UserWaitGuard {
        self.change(|tracker, now| tracker.begin_passive_activity(id.clone(), parent.clone(), now));
        UserWaitGuard {
            runtime: Arc::downgrade(self),
            id,
            wait: false,
        }
    }
    pub(crate) fn phase(self: &Arc<Self>) -> UserWaitGuard {
        self.activity(
            format!("phase-{}", self.sequence.fetch_add(1, Ordering::Relaxed)),
            None,
        )
    }
    pub(crate) fn wait(self: &Arc<Self>, id: String, call_id: String, kind: &str) -> UserWaitGuard {
        self.change(|tracker, now| tracker.begin_wait(id.clone(), call_id.clone(), kind, now));
        UserWaitGuard {
            runtime: Arc::downgrade(self),
            id,
            wait: true,
        }
    }
    pub(crate) fn start_publisher(self: &Arc<Self>, session: Weak<Session>, turn_id: String) {
        if self.publisher_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let mut updates = self.timing_updates.subscribe();
        let publication = Arc::clone(&self.publication);
        // The receiver owns snapshots, never the runtime. Closing the sender
        // drains its final unseen request ending before the publisher exits.
        tokio::spawn(async move {
            while updates.changed().await.is_ok() {
                let timing = updates.borrow_and_update().clone();
                let Some(session) = session.upgrade() else {
                    return;
                };
                publication.publish(&session, &turn_id, timing).await;
            }
        });
    }
    fn snapshot(&self) -> UserWaitTiming {
        self.tracker
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .snapshot(self.elapsed())
    }
    pub(crate) async fn publish(&self, session: &Session, turn_id: &str) {
        self.publication
            .publish(session, turn_id, self.snapshot())
            .await;
    }
    pub(crate) async fn admit_and_publish(&self, session: &Session, turn_id: &str) {
        let _publishing = self.publication.publishing.lock().await;
        if self.finished.load(Ordering::Acquire) {
            return;
        }
        self.publication.admitted.store(true, Ordering::Release);
        self.publication
            .publish_locked(session, turn_id, self.snapshot())
            .await;
    }
    pub(crate) async fn finish_and_publish(&self, session: &Session, turn_id: &str) {
        self.finished.store(true, Ordering::Release);
        let _publishing = self.publication.publishing.lock().await;
        self.tracker
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .finish(self.elapsed());
        self.running.send_replace(None);
        self.updates
            .send_modify(|revision| *revision = revision.saturating_add(1));
        let timing = self.snapshot();
        self.timing_updates.send_replace(timing.clone());
        if self.publication.admitted.load(Ordering::Acquire) {
            self.publication
                .publish_locked(session, turn_id, timing)
                .await;
        }
    }
}
impl Drop for UserWaitGuard {
    fn drop(&mut self) {
        let Some(runtime) = self.runtime.upgrade() else {
            return;
        };
        runtime.change(|tracker, now| {
            if self.wait {
                tracker.end_wait(&self.id, now)
            } else {
                tracker.end_activity(&self.id, now)
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn turn_start_precedes_seed_despite_early_activity_and_unstarted_finish_is_silent() {
        let (session, turn, events) =
            crate::session::tests::make_session_and_context_with_rx().await;
        turn.turn_timing_state
            .mark_turn_started(Instant::now())
            .await;
        let runtime = turn.turn_timing_state.user_wait().unwrap();
        runtime.start_publisher(Arc::downgrade(&session), turn.sub_id.clone());
        let wait = runtime.wait("early-approval".into(), "tool".into(), "commandApproval");
        tokio::task::yield_now().await;
        runtime.publish(&session, &turn.sub_id).await;
        let before_start: Vec<_> = std::iter::from_fn(|| events.try_recv().ok()).collect();
        assert!(
            !before_start
                .iter()
                .any(|event| matches!(&event.msg, EventMsg::UserWaitTimingUpdated(_)))
        );
        session
            .emit_turn_started(&turn, crate::state::TaskKind::Regular)
            .await;
        let started = events.recv().await.unwrap();
        assert!(matches!(started.msg, EventMsg::TurnStarted(_)));
        let snapshot = events.recv().await.unwrap();
        let EventMsg::UserWaitTimingUpdated(snapshot) = snapshot.msg else {
            panic!("expected seed after start");
        };
        assert_eq!(snapshot.timing.requests[0].request_id, "early-approval");
        drop(wait);
        let unstarted = UserWaitRuntime::new(Instant::now(), 0);
        unstarted
            .finish_and_publish(&session, "never-started")
            .await;
        assert!(!std::iter::from_fn(|| events.try_recv().ok()).any(|event| matches!(&event.msg, EventMsg::UserWaitTimingUpdated(snapshot) if snapshot.turn_id == "never-started")));
    }

    #[tokio::test]
    async fn retained_original_turn_callback_publishes_new_answered_and_cancelled_raw_requests() {
        use codex_protocol::approvals::ElicitationRequest;
        use codex_protocol::protocol::TurnCompleteEvent;
        use codex_rmcp_client::{ElicitationAction, ElicitationResponse};
        use rmcp::model::RequestId;
        let (session, turn, events) =
            crate::session::tests::make_session_and_context_with_rx().await;
        turn.turn_timing_state
            .mark_turn_started(Instant::now())
            .await;
        let runtime = turn.turn_timing_state.user_wait().unwrap();
        runtime.start_publisher(Arc::downgrade(&session), turn.sub_id.clone());
        session
            .emit_turn_started(&turn, crate::state::TaskKind::Regular)
            .await;
        let prior = runtime.wait("prior".into(), "prior-tool".into(), "commandApproval");
        session
            .send_event(
                &turn,
                EventMsg::TurnComplete(TurnCompleteEvent {
                    root_turn_id: None,
                    turn_id: turn.sub_id.clone(),
                    last_agent_message: None,
                    error: None,
                    started_at: None,
                    completed_at: None,
                    duration_ms: Some(42),
                    time_to_first_token_ms: None,
                }),
            )
            .await;
        drop(prior);
        let terminal = runtime.tracker.lock().unwrap().snapshot(runtime.elapsed());
        while events.try_recv().is_ok() {}
        // The receiving turn's pending-response map can accept a callback that
        // still retains the original cell's TurnContext.
        *session.active_turn.lock().await = Some(crate::state::ActiveTurn::default());
        for (id, cancelled) in [("answered", false), ("cancelled", true)] {
            let pending = tokio::spawn({
                let session = Arc::clone(&session);
                let turn = Arc::clone(&turn);
                async move {
                    session
                        .request_mcp_server_elicitation(
                            &turn,
                            "server".into(),
                            RequestId::String(id.into()),
                            ElicitationRequest::Url {
                                meta: None,
                                message: "Approve old cell".into(),
                                url: "https://example.com/approve".into(),
                                elicitation_id: id.into(),
                            },
                        )
                        .await
                }
            });
            loop {
                let event = tokio::time::timeout(std::time::Duration::from_secs(5), events.recv())
                    .await
                    .unwrap()
                    .unwrap();
                if let EventMsg::ElicitationRequest(request) = event.msg {
                    assert_eq!(request.turn_id, Some(turn.sub_id.clone()));
                    break;
                }
            }
            if cancelled {
                pending.abort();
                assert!(matches!(pending.await, Err(error) if error.is_cancelled()));
            } else {
                session
                    .resolve_elicitation(
                        "server".into(),
                        RequestId::String(id.into()),
                        ElicitationResponse {
                            action: ElicitationAction::Accept,
                            content: None,
                            meta: None,
                        },
                    )
                    .await
                    .unwrap();
                assert!(pending.await.unwrap().sent);
            }
            runtime.publish(&session, &turn.sub_id).await;
            let request_id = format!("mcp:server:{}", serde_json::to_string(id).unwrap());
            let snapshots: Vec<_> = std::iter::from_fn(|| events.try_recv().ok())
                .filter_map(|event| match event.msg {
                    EventMsg::UserWaitTimingUpdated(snapshot) => Some(snapshot),
                    _ => None,
                })
                .collect();
            let final_snapshot = snapshots
                .iter()
                .rev()
                .find(|snapshot| {
                    snapshot.timing.requests.iter().any(|request| {
                        request.request_id == request_id && request.ended_at_ms.is_some()
                    })
                })
                .expect("post-terminal raw timing must reach clients");
            assert_eq!(final_snapshot.turn_id, turn.sub_id);
            assert_eq!(
                final_snapshot.timing.blocked_intervals,
                terminal.blocked_intervals
            );
            assert_eq!(final_snapshot.timing.requests[0], terminal.requests[0]);
            assert!(
                final_snapshot
                    .timing
                    .requests
                    .iter()
                    .find(|request| request.request_id == request_id)
                    .unwrap()
                    .duration_ms
                    .is_some()
            );
        }
    }

    #[tokio::test]
    async fn publisher_drains_last_raw_ending_when_original_runtime_drops() {
        let (session, _, events) = crate::session::tests::make_session_and_context_with_rx().await;
        let runtime = UserWaitRuntime::new(Instant::now(), 1_000);
        runtime.start_publisher(Arc::downgrade(&session), "original-turn".into());
        runtime.admit_and_publish(&session, "original-turn").await;
        runtime.finish_and_publish(&session, "original-turn").await;
        let wait = runtime.wait("late".into(), "old-cell".into(), "userInput");
        runtime.publish(&session, "original-turn").await;
        while events.try_recv().is_ok() {}
        let weak = Arc::downgrade(&runtime);
        drop(wait);
        drop(runtime);
        assert!(
            weak.upgrade().is_none(),
            "publisher must not retain the runtime"
        );
        let event = tokio::time::timeout(std::time::Duration::from_secs(5), events.recv())
            .await
            .unwrap()
            .unwrap();
        let EventMsg::UserWaitTimingUpdated(snapshot) = event.msg else {
            panic!("expected final raw request ending");
        };
        assert_eq!(snapshot.turn_id, "original-turn");
        assert!(snapshot.timing.requests[0].ended_at_ms.is_some());
    }

    #[test]
    fn dropped_human_wait_closes_request_and_restores_running_state() {
        let runtime = UserWaitRuntime::new(Instant::now(), 1_000);
        let activity = runtime.activity("tool".into(), None);
        let running = runtime.subscribe_running();
        let wait = runtime.wait("approval".into(), "tool".into(), "commandApproval");
        assert_eq!(*running.borrow(), Some(false));
        drop(wait);
        assert_eq!(*running.borrow(), Some(true));
        let snapshot = runtime.tracker.lock().unwrap().snapshot(runtime.elapsed());
        assert!(snapshot.requests[0].ended_at_ms.is_some());
        assert!(snapshot.requests[0].duration_ms.is_some());
        assert!(snapshot.blocked_intervals[0].ended_at_ms.is_some());
        drop(activity);
    }

    #[tokio::test]
    async fn old_cell_mirror_tracks_running_blocked_resumed_and_closed_after_turn_finish() {
        let source = UserWaitRuntime::new(Instant::now(), 1_000);
        let cell = source.activity("cell".into(), None);
        let tool = source.activity("nested".into(), Some("cell".into()));
        // Freeze durable turn accounting while the issuing cell remains alive.
        source.finished.store(true, Ordering::Release);
        source.tracker.lock().unwrap().finish(source.elapsed());
        let target = UserWaitRuntime::new(Instant::now(), 2_000);
        let mirror = target.mirror_activity("old-cell".into(), &source, "cell".into());
        tokio::task::yield_now().await;
        let target_wait = target.wait("approval".into(), "other-tool".into(), "commandApproval");
        assert_eq!(*target.subscribe_running().borrow(), Some(true));
        let old_wait = source.wait("old-input".into(), "nested".into(), "userInput");
        tokio::task::yield_now().await;
        assert_eq!(*target.subscribe_running().borrow(), Some(false));
        drop(old_wait);
        tokio::task::yield_now().await;
        assert_eq!(*target.subscribe_running().borrow(), Some(true));
        drop(tool);
        drop(cell);
        tokio::task::yield_now().await;
        assert_eq!(*target.subscribe_running().borrow(), Some(false));
        assert_eq!(
            source.tracker.lock().unwrap().snapshot(0).requests[0].request_id,
            "old-input"
        );
        drop(mirror);
        drop(target_wait);
    }

    #[tokio::test]
    async fn child_wait_propagates_without_counting_a_waiting_child_as_running() {
        let parent = UserWaitRuntime::new(Instant::now(), 1_000);
        let child = UserWaitRuntime::new(Instant::now(), 1_000);
        parent.track_child("child".into(), child.subscribe_running());
        tokio::task::yield_now().await;
        let wait = parent.wait(
            "parent-approval".into(),
            "parent-tool".into(),
            "commandApproval",
        );
        assert_eq!(*parent.subscribe_running().borrow(), Some(true));
        let child_wait = child.wait("child-input".into(), "child-tool".into(), "userInput");
        tokio::task::yield_now().await;
        assert_eq!(*parent.subscribe_running().borrow(), Some(false));
        drop(child_wait);
        tokio::task::yield_now().await;
        assert_eq!(*parent.subscribe_running().borrow(), Some(true));
        child.finished.store(true, Ordering::Release);
        child.change(|tracker, now| tracker.finish(now));
        tokio::task::yield_now().await;
        assert_eq!(*parent.subscribe_running().borrow(), Some(false));
        drop(wait);
    }
    async fn expect_running(runtime: &Arc<UserWaitRuntime>, expected: bool) {
        let mut running = runtime.subscribe_running();
        tokio::time::timeout(
            std::time::Duration::from_secs(1),
            running.wait_for(|state| *state == Some(expected)),
        )
        .await
        .expect("runtime state transition timed out")
        .expect("runtime closed");
    }

    #[tokio::test]
    async fn user_wait_child_dependency_blocks_passive_parent_without_own_request() {
        let parent = UserWaitRuntime::new(Instant::now(), 1_000);
        let _wait_agent = parent.passive_activity("wait_agent".into(), None);
        assert_eq!(*parent.subscribe_running().borrow(), Some(true));
        let (child, receiver) = watch::channel(Some(false));
        parent.track_child("child".into(), receiver);
        expect_running(&parent, false).await;
        assert!(parent.snapshot().requests.is_empty());
        assert!(
            parent
                .snapshot()
                .blocked_intervals
                .last()
                .unwrap()
                .ended_at_ms
                .is_none()
        );
        for activity_id in ["model", "native-process", "other-tool"] {
            let executing = parent.activity(activity_id.into(), None);
            expect_running(&parent, true).await;
            drop(executing);
            expect_running(&parent, false).await;
        }
        let (sibling, receiver) = watch::channel(Some(true));
        parent.track_child("sibling".into(), receiver);
        expect_running(&parent, true).await;
        sibling.send_replace(Some(false));
        expect_running(&parent, false).await;
        child.send_replace(Some(true));
        expect_running(&parent, true).await;
        child.send_replace(None);
        expect_running(&parent, false).await;
        sibling.send_replace(None);
        expect_running(&parent, true).await;
        assert!(parent.snapshot().requests.is_empty());
    }

    #[tokio::test]
    async fn user_wait_passive_nested_agent_wait_suppresses_cell_but_keeps_executing_descendants() {
        let parent = UserWaitRuntime::new(Instant::now(), 1_000);
        let _cell = parent.activity("cell".into(), None);
        let _mailbox = parent.passive_activity("mailbox".into(), Some("cell".into()));
        // Passive mailbox waiting alone remains elapsed work without a human source.
        expect_running(&parent, true).await;
        let (child, receiver) = watch::channel(Some(false));
        parent.track_child("child".into(), receiver);
        expect_running(&parent, false).await;
        let nested = parent.activity("nested-tool".into(), Some("mailbox".into()));
        expect_running(&parent, true).await;
        drop(nested);
        expect_running(&parent, false).await;
        child.send_replace(None);
        expect_running(&parent, true).await;
    }

    #[tokio::test]
    async fn user_wait_child_binding_replaces_channels_without_stale_cleanup_or_frozen_updates() {
        let parent = UserWaitRuntime::new(Instant::now(), 1_000);
        let _passive = parent.passive_activity("wait".into(), None);
        let (old, receiver) = watch::channel(Some(false));
        parent.track_child("child".into(), receiver.clone());
        parent.track_child("child".into(), receiver);
        expect_running(&parent, false).await;
        let (next, receiver) = watch::channel(Some(true));
        parent.track_child("child".into(), receiver);
        expect_running(&parent, true).await;
        old.send_replace(None);
        next.send_replace(Some(false));
        expect_running(&parent, false).await;
        next.send_replace(None);
        expect_running(&parent, true).await;
        let (last, receiver) = watch::channel(Some(false));
        parent.track_child("child".into(), receiver);
        expect_running(&parent, false).await;
        parent.finished.store(true, Ordering::Release);
        parent.tracker.lock().unwrap().finish(parent.elapsed());
        parent.running.send_replace(None);
        let terminal = parent.snapshot();
        last.send_replace(Some(true));
        last.send_replace(None);
        // Drain any already queued watcher before asserting the sealed model.
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
        assert_eq!(parent.snapshot(), terminal);
        assert!(parent.snapshot().requests.is_empty());
    }

    #[tokio::test]
    async fn user_wait_child_source_drop_clears_dependency_and_does_not_retain_runtime() {
        let parent = UserWaitRuntime::new(Instant::now(), 1_000);
        let (child, receiver) = watch::channel(Some(false));
        parent.track_child("child".into(), receiver);
        expect_running(&parent, false).await;
        drop(child);
        expect_running(&parent, true).await;
        let weak = Arc::downgrade(&parent);
        drop(parent);
        assert!(weak.upgrade().is_none());
    }
}

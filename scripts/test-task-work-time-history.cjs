"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { azraelCreateTaskTimeHistory, azraelMergeTaskTimeTurns } = require("./task-work-time-history.cjs");

test("all metadata pages exclude bodies, normalize seconds, deduplicate and preserve order", async () => {
  const calls = [];
  const store = azraelCreateTaskTimeHistory({ async listThreadTurns(id, params) {
    calls.push({ id, ...params });
    return { response: params.cursor == null ? {
      data: [{ id: "a", startedAt: 12, status: "completed", durationMs: 2500 }], nextCursor: "next",
    } : { data: [{ id: "a" }, { id: "b", startedAt: 30, status: "inProgress" }], nextCursor: null } };
  } }, "thread");
  await store.refresh();
  assert.deepEqual(store.getSnapshot().turns.map(t => [t.turnId, t.turnStartedAtMs]), [["a", 12000], ["b", 30000]]);
  assert.equal(store.getSnapshot().complete, true);
  assert.equal(store.getSnapshot().turns[0].turnStartedAtPrecisionMs, 1000);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => c.id === "thread" && c.itemsView === "notLoaded" && c.sortDirection === "asc"));
  store.dispose();
});

test("failed refresh preserves previous complete snapshot and exposes retry error", async () => {
  let fail = false;
  const store = azraelCreateTaskTimeHistory({ async listThreadTurns() {
    if (fail) throw Error("offline");
    return { response: { data: [{ id: "a", status: "completed" }] } };
  } }, "thread");
  await store.refresh(); fail = true; await store.refresh();
  assert.equal(store.getSnapshot().turns[0].turnId, "a");
  assert.equal(store.getSnapshot().error, "offline");
  store.dispose();
});

test("cursor cycles are rejected and incomplete data is not presented as complete", async () => {
  const store = azraelCreateTaskTimeHistory({ async listThreadTurns() {
    return { response: { data: [], nextCursor: "loop" } };
  } }, "thread");
  await store.refresh();
  assert.equal(store.getSnapshot().complete, false);
  assert.match(store.getSnapshot().error, /cursor/);
  store.dispose();
});

test("synchronous transport failure can retry and request changes coalesce without polling", async () => {
  let calls = 0, fail = true;
  const store = azraelCreateTaskTimeHistory({ listThreadTurns() {
    calls++;
    if (fail) throw Error("transport not ready");
    return Promise.resolve({ response: { data: [{ id: "a" }] } });
  } }, "thread");
  await store.refresh();
  assert.equal(store.getSnapshot().error, "transport not ready");
  fail = false;
  const pending = store.refresh(); store.refresh(); store.refresh();
  await pending;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 3);
  assert.equal(store.getSnapshot().error, null);
  assert.equal(store.getSnapshot().complete, true);
  store.dispose();
});

test("disposing suppresses late history responses and subscriber updates", async () => {
  let resolve, updates = 0;
  const store = azraelCreateTaskTimeHistory({ listThreadTurns: () => new Promise(r => { resolve = r; }) }, "thread");
  store.subscribe(() => updates++);
  const pending = store.refresh(); await Promise.resolve(); store.dispose();
  resolve({ response: { data: [{ id: "a" }] } }); await pending;
  assert.equal(updates, 1); assert.deepEqual(store.getSnapshot().turns, []);
});

test("live progress and higher revision wait override old history without reviving frozen turns", () => {
  const history = [{ turnId: "a", status: "deferred", turnStartedAtMs: 1000, durationMs: 4000,
    rootResumeWait: { reservationId: "r", revision: 4, state: "resumed" } },
  { turnId: "b", status: "completed", turnStartedAtMs: 20000, durationMs: 2000 }];
  const live = [{ turnId: "a", status: "inProgress", durationMs: 100000,
    rootResumeWait: { reservationId: "r", revision: 2, state: "waiting" } },
  { turnId: "b", status: "inProgress" }, { turnId: "c", status: "inProgress", turnStartedAtMs: 40000 }];
  const merged = azraelMergeTaskTimeTurns(history, live);
  assert.equal(merged[0].durationMs, 4000); assert.equal(merged[0].rootResumeWait.state, "resumed");
  assert.equal(merged[1].status, "completed"); assert.equal(merged[2].turnId, "c");
  assert.equal(history.length, 2);
});

test("live wait-end recovery updates a frozen turn without replacing its measured work", () => {
  const saved = [{ turnId: "a", status: "interrupted", turnStartedAtMs: 1000, durationMs: 4000,
    rootResumeWait: { reservationId: "r", revision: 4, state: "waiting", waitStartedAtMs: 5000 } }];
  const live = [{ turnId: "a", status: "inProgress", turnStartedAtMs: 90000, durationMs: 99999,
    rootResumeWait: { reservationId: "r", revision: 5, state: "cancelled", waitStartedAtMs: 5000, waitEndedAtMs: 7000 } }];
  const merged = azraelMergeTaskTimeTurns(saved, live)[0];
  assert.equal(merged.status, "interrupted"); assert.equal(merged.durationMs, 4000);
  assert.equal(merged.turnStartedAtMs, 1000); assert.equal(merged.rootResumeWait.waitEndedAtMs, 7000);
});

test("rehydrated live records retain second precision but a new live millisecond clock uses its own precision", () => {
  const saved = [{ turnId: "a", status: "completed", turnStartedAtMs: 12000,
    turnStartedAtPrecisionMs: 1000, durationMs: 200 }];
  assert.equal(azraelMergeTaskTimeTurns(saved, [{ ...saved[0], turnStartedAtPrecisionMs: undefined }])[0].turnStartedAtPrecisionMs, 1000);
  const live = [{ turnId: "a", status: "completed", turnStartedAtMs: 12230, durationMs: 200 }];
  assert.equal(azraelMergeTaskTimeTurns(saved, live)[0].turnStartedAtPrecisionMs, undefined);
});

test("history and live retain attribution even when a partial UI record omits it", async () => {
  const store = azraelCreateTaskTimeHistory({ async listThreadTurns() {
    return { response: { data: [{ id: "b", rootTurnId: "a", parentTurnId: "a", turnTrigger: "root_resume",
      startedAt: 12, status: "completed", durationMs: 250 }], nextCursor: null, backwardsCursor: null } };
  } }, "thread");
  await store.refresh();
  const merged = azraelMergeTaskTimeTurns(store.getSnapshot().turns, [{ turnId: "b", status: "completed" }]);
  assert.deepEqual([merged[0].rootTurnId, merged[0].parentTurnId, merged[0].turnTrigger], ["a", "a", "root_resume"]);
  const fresh = azraelMergeTaskTimeTurns([], [{ turnId: "c", rootTurnId: "a", parentTurnId: "b", turnTrigger: "root_resume" }]);
  assert.deepEqual([fresh[0].rootTurnId, fresh[0].parentTurnId, fresh[0].turnTrigger], ["a", "b", "root_resume"]);
  const frozen = azraelMergeTaskTimeTurns([{ turnId: "d", status: "completed", durationMs: 10 }],
    [{ turnId: "d", status: "inProgress", rootTurnId: "a", parentTurnId: "c", turnTrigger: "root_resume" }])[0];
  assert.equal(frozen.status, "completed");
  assert.deepEqual([frozen.rootTurnId, frozen.parentTurnId, frozen.turnTrigger], ["a", "c", "root_resume"]);
  store.dispose();
});

test("unloaded and ephemeral native threads have lifecycle states and safe diagnostics", async () => {
  let message = "thread not loaded: thread", calls = 0;
  const diagnostics = [];
  const store = azraelCreateTaskTimeHistory({ logger: { info(name, value) { diagnostics.push({ name, ...value }); } },
    async listThreadTurns() { calls++; throw Object.assign(Error(message), { code: -32600 }); } }, "thread", { hostId: "local" });
  await store.refresh();
  assert.equal(store.getSnapshot().availability, "notLoaded");
  assert.equal(store.getSnapshot().error, null);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1, "unloaded threads never poll");
  message = "thread thread is not materialized yet; thread/turns/list is unavailable before first user message";
  await store.refresh();
  assert.equal(store.getSnapshot().availability, "notLoaded");
  assert.equal(store.getSnapshot().error, null);
  message = "ephemeral threads do not support thread/turns/list";
  await store.refresh();
  assert.equal(store.getSnapshot().availability, "unsupported");
  assert.equal(diagnostics[0].errorCode, -32600);
  assert.ok(diagnostics.every(value => !("message" in value)));
  store.dispose();
});

test("missing native transport does not throw or repeatedly request metadata", async () => {
  const store = azraelCreateTaskTimeHistory({}, "thread");
  await store.refresh();
  assert.equal(store.getSnapshot().availability, "unavailable");
  assert.equal(store.getSnapshot().loading, false);
  store.dispose();
});

test("missing live turns are inserted between common anchors in persisted order", () => {
  const merged = azraelMergeTaskTimeTurns([{ turnId: "a" }, { turnId: "c" }],
    [{ turnId: "a" }, { turnId: "b", parentTurnId: "a" }, { turnId: "c" }]);
  assert.deepEqual(merged.map(turn => turn.turnId), ["a", "b", "c"]);
  const timed = azraelMergeTaskTimeTurns([{ turnId: "a", turnStartedAtMs: 1000 }, { turnId: "c", turnStartedAtMs: 3000 }],
    [{ turnId: "b", turnStartedAtMs: 2000 }]);
  assert.deepEqual(timed.map(turn => turn.turnId), ["a", "b", "c"]);
});

test("cross-reservation revisions cannot overwrite later terminal history", () => {
  const saved = [{ turnId: "a", status: "completed", durationMs: 1000,
    rootResumeWait: { reservationId: "new", revision: 2, state: "resumed", waitStartedAtMs: 2000, waitEndedAtMs: 3000 } }];
  const live = [{ turnId: "a", status: "inProgress", rootResumeWait:
    { reservationId: "old", revision: 99, state: "waiting", waitStartedAtMs: 1200 } }];
  const merged = azraelMergeTaskTimeTurns(saved, live)[0];
  assert.equal(merged.rootResumeWait.reservationId, "new");
  assert.equal(merged.rootResumeWait.state, "resumed");
  assert.equal(merged.durationMs, 1000);
});

test("ended waits never reopen even with a higher incoming revision", () => {
  const saved = [{ turnId: "a", status: "deferred", rootResumeWait:
    { reservationId: "r", revision: 2, state: "cancelled", waitStartedAtMs: 1000, waitEndedAtMs: 3000 } }];
  const merged = azraelMergeTaskTimeTurns(saved, [{ turnId: "a", status: "deferred", rootResumeWait:
    { reservationId: "r", revision: 99, state: "waiting", waitStartedAtMs: 1000 } }])[0];
  assert.equal(merged.rootResumeWait.state, "cancelled");
  assert.equal(merged.rootResumeWait.waitEndedAtMs, 3000);
});

const userTiming = (revision, endedAtMs = 3000) => ({ revision,
  requests: [{ requestId: "approval", callId: "call", kind: "commandApproval", startedAtMs: 1000,
    endedAtMs, durationMs: endedAtMs == null ? null : endedAtMs - 1000 }],
  blockedIntervals: [{ startedAtMs: 1000, endedAtMs }] });

test("history normalizes the user wait snapshot and missing legacy metadata separately", async () => {
  const snapshot = userTiming(3);
  const store = azraelCreateTaskTimeHistory({ async listThreadTurns() {
    return { response: { data: [{ id: "a", userWaitTiming: snapshot }, { id: "b" }] } };
  } }, "thread");
  await store.refresh();
  assert.deepEqual(store.getSnapshot().turns[0].userWaitTiming, snapshot);
  assert.equal(store.getSnapshot().turns[1].userWaitTiming, null);
  store.dispose();
});

test("user wait snapshots require strictly higher revisions and absent live data cannot erase history", () => {
  const snapshot = userTiming(3);
  const saved = [{ turnId: "a", status: "inProgress", userWaitTiming: snapshot }];
  for (const incoming of [undefined, userTiming(2, null), userTiming(3, null)]) {
    assert.deepEqual(azraelMergeTaskTimeTurns(saved, [{ turnId: "a", userWaitTiming: incoming }])[0].userWaitTiming, snapshot);
  }
  const newer = userTiming(4, 4000);
  assert.deepEqual(azraelMergeTaskTimeTurns(saved, [{ turnId: "a", userWaitTiming: newer }])[0].userWaitTiming, newer);
  assert.deepEqual(azraelMergeTaskTimeTurns([], saved)[0].userWaitTiming, snapshot);
});

test("closed user waits cannot reopen and higher revision recovery can close a frozen snapshot", () => {
  const closed = userTiming(3);
  const saved = [{ turnId: "a", status: "completed", durationMs: 4000, userWaitTiming: closed }];
  const stale = { turnId: "a", status: "inProgress", durationMs: 99000, userWaitTiming: userTiming(99, null) };
  const merged = azraelMergeTaskTimeTurns(saved, [stale])[0];
  assert.deepEqual(merged.userWaitTiming, closed);
  assert.equal(merged.status, "completed");
  assert.equal(merged.durationMs, 4000);
  const openSaved = [{ ...saved[0], userWaitTiming: userTiming(2, null) }];
  assert.deepEqual(azraelMergeTaskTimeTurns(openSaved, [{ ...stale, userWaitTiming: closed }])[0].userWaitTiming, closed);
  const different = userTiming(100, null); different.requests[0].requestId = "another";
  different.blockedIntervals[0].startedAtMs = 5000;
  assert.deepEqual(azraelMergeTaskTimeTurns(saved, [{ ...stale, userWaitTiming: different }])[0].userWaitTiming, closed);
});

test("terminal turns accept new raw requests and their closure without reopening work", () => {
  const original = { ...userTiming(3), startedAtMs: 999 };
  const terminalTurn = { turnId: "a", status: "completed", turnStartedAtMs: 999, durationMs: 4000,
    userWaitTiming: original };
  const request = { requestId: "late-approval", callId: "retained-cell", kind: "commandApproval",
    startedAtMs: 6000, endedAtMs: null, durationMs: null };
  const pending = { ...original, revision: 4, requests: [...original.requests, request] };
  const live = { turnId: "a", status: "inProgress", turnStartedAtMs: 90000, durationMs: 99000,
    userWaitTiming: pending };
  const merged = azraelMergeTaskTimeTurns([terminalTurn], [live])[0];
  assert.deepEqual(merged.userWaitTiming, pending);
  assert.equal(merged.status, "completed");
  assert.equal(merged.durationMs, 4000);
  assert.equal(merged.turnStartedAtMs, 999);
  assert.equal(merged.userWaitTiming.startedAtMs, 999);
  assert.deepEqual(merged.userWaitTiming.requests[0], original.requests[0]);
  assert.deepEqual(merged.userWaitTiming.blockedIntervals, original.blockedIntervals);
  for (const endedAtMs of [7000, 8000]) { // Answer and cancellation both close the raw timer.
    const closed = { ...pending, revision: 5, requests: [original.requests[0],
      { ...request, endedAtMs, durationMs: endedAtMs - request.startedAtMs }] };
    const final = azraelMergeTaskTimeTurns([merged], [{ ...live, userWaitTiming: closed }])[0];
    assert.deepEqual(final.userWaitTiming, closed);
    assert.equal(final.status, "completed");
    assert.equal(final.durationMs, 4000);
    const reopened = { ...pending, revision: 6 };
    assert.deepEqual(azraelMergeTaskTimeTurns([final], [{ ...live, userWaitTiming: reopened }])[0].userWaitTiming, closed);
  }
  for (const revision of [2, 3]) {
    assert.deepEqual(azraelMergeTaskTimeTurns([terminalTurn], [{ ...live,
      userWaitTiming: { ...pending, revision } }])[0].userWaitTiming, original);
  }
  const reopenedWork = { ...pending, revision: 6,
    blockedIntervals: [...original.blockedIntervals, { startedAtMs: 6000, endedAtMs: null }] };
  assert.deepEqual(azraelMergeTaskTimeTurns([merged], [{ ...live,
    userWaitTiming: reopenedWork }])[0].userWaitTiming, pending);
  const reopenedOriginal = { ...pending, revision: 6,
    requests: [{ ...original.requests[0], endedAtMs: null, durationMs: null }, request] };
  assert.deepEqual(azraelMergeTaskTimeTurns([merged], [{ ...live,
    userWaitTiming: reopenedOriginal }])[0].userWaitTiming, pending);
});

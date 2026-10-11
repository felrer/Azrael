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

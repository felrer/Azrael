"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { RecoveryState, STORAGE_KEY } = require("./recovery-state.cjs");

const continuation = (threadId = "thread-1", text = "continue") => ({
  threadId,
  input: [{ type: "text", text }],
});

const handlerPanicMarker = () => ({ code: -32603,
  data: { requestOutcome: "unknown", reason: "handlerPanicked" } });

for (const method of ["turn/start", "turn/steer"]) {
  for (const marker of [handlerPanicMarker(), { code: -32603 },
    { code: -32603, data: { requestOutcome: "unknown" } },
    { code: -32603, data: { requestOutcome: "unknown", reason: "other" } },
    { code: -32603, data: { requestOutcome: "rejected", reason: "handlerPanicked" } },
    { code: -1, data: { requestOutcome: "unknown", reason: "handlerPanicked" } },
    { code: "-32603", data: { requestOutcome: "unknown", reason: "handlerPanicked" } }]) {
    test(`${method} readback requires exact handler panic marker ${JSON.stringify(marker)}`, async () => {
      const original = Object.assign(new Error("private handler payload"), { rpcError: marker });
      const calls = [], logs = [], store = memoryStore();
      const turn = { id: "wake-turn", status: "inProgress", items: [{ type: "userMessage", clientId: "private-id" }] };
      const state = new RecoveryState({ store, log: record => logs.push(record), rpc: async (name, params) => {
        calls.push({ name, params });
        if (name === method) throw original;
        assert.equal(name, "thread/turns/list");
        return { data: [turn] };
      } });
      const params = { threadId: "panic-thread", expectedTurnId: "parked-turn", clientUserMessageId: "private-id",
        input: [{ type: "text", text: "private input" }] };
      const pending = method === "turn/start" ? state.start(params) : state.steer(params);
      const accepted = JSON.stringify(marker) === JSON.stringify(handlerPanicMarker());
      if (accepted) assert.deepEqual(await pending, method === "turn/start" ? { turn } : { turnId: turn.id });
      else await assert.rejects(pending, error => error === original);
      assert.equal(calls.filter(call => call.name === method).length, 1);
      assert.equal(calls.filter(call => call.name === "thread/turns/list").length, accepted ? 1 : 0);
      assert.equal(params.expectedTurnId, "parked-turn");
      assert.equal(store.updates.length, 0);
      assert.equal(logs.find(record => record.event === "recovery.send_reconciliation").method, method);
      assert.ok(!JSON.stringify(logs).includes("private"));
    });
  }
}

test("normal steering response preserves actual wake turn and all result fields exactly", async () => {
  const result = { turnId: "new-wake-turn", extra: { value: 7 } }, calls = [];
  const state = new RecoveryState({ store: memoryStore(), rpc: async (method, params) => {
    calls.push({ method, params });

for (const method of ["turn/start", "turn/steer"]) {
  test(`${method} unmatched handler panic keeps original error and observed execution`, async () => {
    let state;
    const original = Object.assign(new Error("handler uncertainty"), { rpcError: handlerPanicMarker() });
    state = new RecoveryState({ store: memoryStore(), pause: async () => {}, rpc: async name => {
      if (name === method) { state.setStage("observed-panic", "tool", "observed-turn"); throw original; }
      assert.equal(name, "thread/turns/list"); return { data: [] };
    } });
    const params = { threadId: "observed-panic", clientUserMessageId: "unmatched", input: [{ type: "text", text: "new input" }] };
    await assert.rejects(method === "turn/start" ? state.start(params) : state.steer(params), error => error === original);
    assert.equal(state.list()[0].phase, "tool");
    assert.equal(state.list()[0].turnId, "observed-turn");
  });
} return result;
  } });
  const params = { threadId: "normal-steer", expectedTurnId: "parked-turn", clientUserMessageId: "client-normal" };
  assert.equal(await state.steer(params), result);
  assert.deepEqual(calls, [{ method: "turn/steer", params }]);
  assert.equal(params.expectedTurnId, "parked-turn");
});

for (const scenario of ["matched", "delayed", "completed", "interrupted", "failed", "missing_id", "empty_id",
  "wrong_id", "equal_text", "wrong_item", "read_failed", "malformed", "invalid_turn", "invalid_status",
  "generation_before_read", "generation_during_read", "generation_during_pause", "deadline", "late_match", "attempt_cap", "outside_page"] ) {
  test(`uncertain steering bounded identity readback: ${scenario}`, async () => {
    const original = new Error("private acknowledgement timeout"), calls = [], logs = [], store = memoryStore();
    let state, reads = 0, clock = 0;
    const params = { threadId: "steer-thread", expectedTurnId: "parked-turn",
      input: [{ type: "text", text: "private repeated input" }],
      ...(scenario === "missing_id" ? {} : { clientUserMessageId: scenario === "empty_id" ? "" : "private-client" }) };
    const turn = { id: "actual-wake-turn", status: ["completed", "interrupted", "failed"].includes(scenario) ? scenario : "inProgress",
      items: [{ type: scenario === "wrong_item" ? "agentMessage" : "userMessage",
        clientId: ["wrong_id", "equal_text"].includes(scenario) ? "other" : "private-client", content: params.input }] };
    state = new RecoveryState({ store, now: () => clock, log: record => logs.push(record),
      pause: async ms => { clock += ms; if (scenario === "generation_during_pause") state.disconnect(); },
      rpc: async (method, request, timeout) => {
        calls.push({ method, request, timeout });
        if (method === "turn/steer") {
          state.setStage(params.threadId, "responding", turn.id);
          if (scenario === "generation_before_read") state.disconnect();
          throw original;
        }
        assert.equal(method, "thread/turns/list");
        assert.deepEqual(request, { threadId: params.threadId, limit: 20, sortDirection: "desc", itemsView: "full" });
        assert.ok(timeout > 0 && timeout <= 5000);
        reads += 1;
        if (scenario === "read_failed") throw new Error("private read failure");
        if (scenario === "generation_during_read") state.disconnect();
        if (scenario === "deadline") clock += 2600;
        if (scenario === "late_match") clock += 5001;
        if (scenario === "malformed") return { data: null };
        if (scenario === "invalid_turn") return { data: [{ ...turn, id: "" }] };
        if (scenario === "invalid_status") return { data: [{ ...turn, status: "unknown" }] };
        if (["attempt_cap", "deadline", "generation_during_pause"].includes(scenario) || (scenario === "delayed" && reads === 1)) return { data: [] };
        if (scenario === "outside_page") return { data: [...Array.from({ length: 20 }, () => ({ items: [] })), turn] };
        return { data: [turn] };
      } });
    const accepted = ["matched", "delayed", "completed", "interrupted", "failed"].includes(scenario);
    const pending = state.steer(params);
    if (accepted) assert.deepEqual(await pending, { turnId: turn.id });
    else await assert.rejects(pending, error => error === original);
    assert.equal(calls.filter(call => call.method === "turn/steer").length, 1);
    assert.equal(reads, ["missing_id", "empty_id", "generation_before_read"].includes(scenario) ? 0 :
      ["wrong_id", "equal_text", "wrong_item", "attempt_cap", "outside_page"].includes(scenario) ? 20 :
        ["delayed", "deadline"].includes(scenario) ? 2 : 1);
    assert.equal(params.expectedTurnId, "parked-turn");
    assert.equal(store.updates.length, 0);
    assert.equal(state.list()[0].phase, scenario.startsWith("generation_") ? "disconnected" :
      scenario === "failed" ? "error" : ["completed", "interrupted"].includes(scenario) ? scenario : "responding");
    assert.ok(!JSON.stringify(logs).includes("private"));
  });
}

test("steering readback keeps followup ordered and lets another thread proceed without replay", async () => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  const mutations = [], store = memoryStore();
  const state = new RecoveryState({ store, rpc: async (method, params) => {
    if (method === "turn/steer") {
      mutations.push(params.clientUserMessageId);
      if (params.clientUserMessageId === "first") throw new Error("ack missing");
      return { turnId: "followup-turn" };
    }
    assert.equal(method, "thread/turns/list"); entered(); await gate;
    return { data: [{ id: "wake-turn", status: "inProgress", items: [{ type: "userMessage", clientId: "first" }] }] };
  } });
  const request = id => ({ threadId: "serial-steer", expectedTurnId: "parked-turn", clientUserMessageId: id });
  const first = state.steer(request("first")), second = state.steer(request("second"));
  await ready;
  await state.steer({ ...request("other"), threadId: "independent" });
  assert.deepEqual(mutations, ["first", "other"]);
  release();
  assert.deepEqual(await first, { turnId: "wake-turn" });
  assert.deepEqual(await second, { turnId: "followup-turn" });
  assert.deepEqual(mutations, ["first", "other", "second"]);
  assert.equal(store.updates.length, 0);
  assert.equal(state.queues.size, 0);
});

for (const status of ["completed", "interrupted", "failed"]) {
  test(`persisted uncertain delivery reconciles ${status} by identity without replay`, async () => {
    const store = memoryStore(), calls = [];
    const params = { ...continuation("restart-identity"), clientUserMessageId: "saved-client" };
    const unavailable = new RecoveryState({ store, rpc: async (method) => {
      if (method === "thread/read") return { thread: { status: { type: "idle" } } };
      if (method === "thread/turns/list") return { data: [] };
      throw new Error("lost acknowledgement");
    } });
    await assert.rejects(unavailable.start(params), /lost acknowledgement/);
    assert.equal(store.updates.at(-1)[0].clientUserMessageId, "saved-client");
    const turn = { id: "accepted-before-reload", status,
      items: [{ type: "userMessage", clientId: "saved-client" }] };
    const restored = new RecoveryState({ store, rpc: async (method, p) => {
      calls.push(method);
      if (method === "thread/read") return { thread: { status: { type: "idle" } } };
      assert.equal(method, "thread/turns/list");
      if (p.itemsView === "full") { assert.equal(p.limit, 20); return { data: [turn] }; }
      return { data: [{ id: turn.id, status }] };
    } });
    assert.deepEqual(await restored.start(params), { turn });
    assert.equal(store.updates.at(-1)[0].phase, "finished");
    assert.equal(restored.list()[0].uncertain, false);
    assert.equal(calls.includes("turn/start"), false);
  });
}

for (const scenario of ["wrong_client", "wrong_item", "malformed", "inProgress", "read_failure", "disconnect", "storage_failure"]) {
  test(`persisted reconciliation preserves guard on ${scenario}`, async () => {
    const store = memoryStore([{ threadId: "unresolved", operationId: "old-op", phase: "unknown",
      turnId: null, clientUserMessageId: "exact-client" }]);
    const calls = [];
    let state;
    state = new RecoveryState({ store, rpc: async (method, p) => {
      calls.push(method);
      if (method === "thread/read") return { thread: { status: { type: "idle" } } };
      assert.equal(method, "thread/turns/list");
      if (p.itemsView !== "full") return { data: [] };
      if (scenario === "read_failure") throw new Error("read failure");
      if (scenario === "disconnect") state.disconnect();
      if (scenario === "malformed") return { data: {} };
      return { data: [{ id: "candidate", status: scenario === "inProgress" ? "inProgress" : "completed",
        items: [{ type: scenario === "wrong_item" ? "agentMessage" : "userMessage",
          clientId: scenario === "wrong_client" ? "different-client" : "exact-client" }] }] };
    } });
    if (scenario === "storage_failure") store.update = async () => { throw new Error("disk full"); };
    await assert.rejects(state.start(continuation("unresolved")));
    assert.equal(state.list()[0].uncertain, true);
    assert.equal(calls.includes("turn/start"), false);
  });
}

test("legacy unknown receipt admits exactly one explicitly reviewed new continuation", async () => {
  const calls = [], store = memoryStore([{ threadId: "legacy", operationId: "old-op",
    phase: "unknown", turnId: null }]);
  const state = new RecoveryState({ store, rpc: idleSnapshotRpc(calls) });
  await assert.rejects(state.start(continuation("legacy")), /Ctrl\+Shift\+P/);
  assert.equal(calls.filter(c => c.method === "turn/start").length, 0);
  await state.recover("legacy", true);
  assert.equal(calls.filter(c => c.method === "turn/start").length, 1);
  assert.equal(store.updates.at(-1)[0].phase, "accepted");
});

test("account pre-dispatch rejection does not poison continuation across reload", async () => {
  const store = memoryStore(), calls = [];
  const rejection = Object.assign(new Error("pending"), {
    rpcError: { code: -32603, data: { azraelAdmission: "accountChangePending" } },
  });
  let pending = true;
  const rpc = async (method, params) => {
    calls.push(method);
    if (method === "thread/read") return { thread: { id: params.threadId, status: { type: "idle" } } };
    if (method === "thread/turns/list") return { data: [{ id: "old", status: "interrupted" }] };
    if (method === "turn/start") { if (pending) throw rejection; return { turn: { id: "new", status: "inProgress" } }; }
    throw Error("Unexpected method");
  };
  const first = new RecoveryState({ store, rpc });
  await assert.rejects(first.start(continuation("thread-account")), e => e === rejection);
  assert.equal(store.updates.at(-1)[0].phase, "finished");
  pending = false;
  const reloaded = new RecoveryState({ store, rpc });
  assert.equal((await reloaded.start(continuation("thread-account"))).turn.id, "new");
  assert.equal(calls.filter(method => method === "turn/start").length, 2);
});

for (const continuing of [false, true]) {
  for (const scenario of ["delayed_items", "attempt_cap", "deadline", "generation_during_pause", "read_failure_after_empty"]) {
    test(`${continuing ? "continuation" : "ordinary"} bounded history visibility polling ${scenario}`, async () => {
      let clock = 0, reads = 0, starts = 0, state;
      const pauses = [], timeouts = [], store = memoryStore();
      const error = new Error("original acknowledgement missing");
      const turn = { id: "turn-delayed", status: "completed", items: [{ type: "userMessage", clientId: "delayed-client" }] };
      state = new RecoveryState({ store, now: () => clock,
        pause: async ms => { pauses.push(ms); clock += ms; if (scenario === "generation_during_pause") state.disconnect(); },
        rpc: async (method, params, timeout) => {
          if (method === "thread/read") return { thread: { id: params.threadId, status: { type: "idle" } } };
          if (method === "turn/start") { starts += 1; throw error; }
          if (method === "thread/turns/list" && params.itemsView === "summary") return { data: [] };
          assert.equal(method, "thread/turns/list");
          assert.equal(params.limit, 20);
          assert.equal(params.itemsView, "full");
          reads += 1; timeouts.push(timeout);
          if (scenario === "deadline") clock += 2600;
          if (scenario === "read_failure_after_empty" && reads === 2) throw new Error("read failed");
          return { data: scenario === "delayed_items" && reads === 2 ? [turn] : [{ ...turn, items: [] }] };
        } });
      const pending = state.start({ ...continuation("poll-thread", continuing ? "continue" : "new task"), clientUserMessageId: "delayed-client" });
      if (scenario === "delayed_items") {
        assert.deepEqual(await pending, { turn });
        assert.equal(state.list()[0].phase, "completed");
        if (continuing) assert.equal(store.updates.at(-1)[0].phase, "finished");
      } else await assert.rejects(pending, e => e === error);
      assert.equal(starts, 1);
      assert.equal(reads, scenario === "attempt_cap" ? 20 : scenario === "generation_during_pause" ? 1 : 2);
      assert.ok(timeouts.every(ms => ms > 0 && ms <= 5000));
      assert.ok(pauses.every(ms => ms > 0 && ms <= 100));
      assert.equal(timeouts[0], 5000);
      if (scenario === "delayed_items") assert.equal(timeouts[1], 4900);
      if (scenario === "deadline") assert.equal(timeouts[1], 2300);
    });
  }
}

for (const continuing of [false, true]) {
  for (const status of ["completed", "interrupted", "failed", "inProgress"]) {
    test(`${continuing ? "continuation" : "ordinary start"} readback supplies ${status} without notifications`, async () => {
      const calls = [], store = memoryStore();
      const turn = { id: "turn-readback", status, items: [{ type: "userMessage", clientId: "client-readback" }] };
      const baseRpc = idleSnapshotRpc(calls);
      const state = new RecoveryState({ store, pause: async () => {}, rpc: async (method, params) => {
        if (method === "turn/start") { calls.push({ method, params }); throw new Error("missing acknowledgement"); }
        if (method === "thread/turns/list" && params.itemsView === "full") { calls.push({ method, params }); return { data: [turn] }; }
        return baseRpc(method, params);
      } });
      assert.deepEqual(await state.start({ ...continuation("thread-readback", continuing ? "continue" : "new work"), clientUserMessageId: "client-readback" }), { turn });
      const expectedPhase = { completed: "completed", interrupted: "interrupted", failed: "error", inProgress: "waiting" }[status];
      assert.equal(state.list()[0].phase, expectedPhase);
      assert.equal(state.list()[0].turnId, turn.id);
      assert.ok(!state.list()[0].uncertain);
      assert.equal(state.queues.size, 0);
      assert.equal(state.list()[0].delayed, false);
      if (continuing) assert.equal(store.updates.at(-1)[0].phase, status === "inProgress" ? "accepted" : "finished");
      assert.equal(calls.filter(call => call.method === "turn/start").length, 1);
    });
  }
  for (const phase of ["completed", "interrupted", "error"]) {
    test(`${continuing ? "continuation" : "ordinary start"} stale inProgress readback preserves ${phase}`, async () => {
      const store = memoryStore(), calls = [];
      const turn = { id: "turn-stale", status: "inProgress", items: [{ type: "userMessage", clientId: "client-stale" }] };
      let state;
      const baseRpc = idleSnapshotRpc(calls);
      state = new RecoveryState({ store, rpc: async (method, params) => {
        if (method === "turn/start") { state.setStage(params.threadId, phase, turn.id); throw new Error("missing acknowledgement"); }
        if (method === "thread/turns/list" && params.itemsView === "full") return { data: [turn] };
        return baseRpc(method, params);
      } });
      await state.start({ ...continuation("thread-stale", continuing ? "continue" : "new work"), clientUserMessageId: "client-stale" });
      assert.equal(state.list()[0].phase, phase);
      if (continuing) assert.equal(store.updates.at(-1)[0].phase, "finished");
    });
  }
  for (const malformed of [null, { data: {} }, { data: [null] }, { data: [{ items: {} }] },
    { data: [{ id: "", status: "completed", items: [{ type: "userMessage", clientId: "client-malformed" }] }] },
    { data: [{ id: "turn-bad", status: "invalid", items: [{ type: "userMessage", clientId: "client-malformed" }] }] }]) {
    test(`${continuing ? "continuation" : "ordinary start"} malformed readback preserves original rejection ${JSON.stringify(malformed)}`, async () => {
      const calls = [], store = memoryStore(), error = new Error("original uncertainty");
      const baseRpc = idleSnapshotRpc(calls);
      const state = new RecoveryState({ store, rpc: async (method, params) => {
        if (method === "turn/start") { calls.push({ method, params }); throw error; }
        if (method === "thread/turns/list" && params.itemsView === "full") return malformed;
        return baseRpc(method, params);
      } });
      await assert.rejects(state.start({ ...continuation("thread-bad", continuing ? "continue" : "new work"), clientUserMessageId: "client-malformed" }), e => e === error);
      assert.equal(state.list()[0].phase, "unknown");
      if (continuing) assert.equal(store.updates.at(-1)[0].phase, "unknown");
      assert.equal(calls.filter(call => call.method === "turn/start").length, 1);
    });
  }
}

for (const continuing of [false, true]) {
  for (const scenario of ["matched", "completed", "wrong_client", "identical_prompt", "wrong_item", "no_id", "empty_id", "read_failed", "generation_changed", "generation_before_read", "rpc_rejected"]) {
    test(`${continuing ? "continuation" : "ordinary start"} lost acknowledgement: ${scenario}`, async () => {
      const calls = [], logs = [], store = memoryStore();
      const transportError = new Error("fixture lost acknowledgement");
      if (scenario === "rpc_rejected") transportError.rpcError = { code: -1 };
      const input = [{ type: "text", text: continuing ? "continue" : "private fixture instruction" }];
      const acceptedTurn = { id: "turn-accepted", status: scenario === "completed" ? "completed" : "inProgress",
        items: [{ type: scenario === "wrong_item" ? "agentMessage" : "userMessage",
          clientId: ["wrong_client", "identical_prompt"].includes(scenario) ? "other-client" : "client-expected",
          content: input }] };
      let state;
      const rpc = async (method, params, timeout) => {
        calls.push({ method, params, timeout });
        if (method === "thread/read") return { thread: { id: params.threadId, status: { type: "idle" } } };
        if (method === "thread/turns/list") {
          if (params.itemsView === "summary") return { data: [{ id: "turn-old", status: "completed" }] };
          assert.deepEqual(params, { threadId: "thread-ack", limit: 20, sortDirection: "desc", itemsView: "full" });
          assert.ok(timeout > 0 && timeout <= 5000);
          if (scenario === "read_failed") throw new Error("private read error");
          if (scenario === "generation_changed") state.disconnect();
          return { data: [{ id: "unrelated", status: "completed", items: [] }, acceptedTurn], nextCursor: "ignored" };
        }
        if (method === "turn/start") {
          state.observe({ method: "turn/started", params: { threadId: params.threadId, turn: { id: acceptedTurn.id } } });
          if (scenario === "completed") state.observe({ method: "turn/completed", params: { threadId: params.threadId, turn: acceptedTurn } });
          else state.observe({ method: "item/agentMessage/delta", params: { threadId: params.threadId, turnId: acceptedTurn.id } });
          if (scenario === "generation_before_read") state.disconnect();
          throw transportError;
        }
        throw new Error(`Unexpected RPC: ${method}`);
      };
      state = new RecoveryState({ store, rpc, pause: async () => {}, log: record => logs.push(record) });
      const params = { threadId: "thread-ack", input,
        ...(scenario === "no_id" ? {} : { clientUserMessageId: scenario === "empty_id" ? "" : "client-expected" }) };
      const pending = state.start(params);
      const accepted = ["matched", "completed"].includes(scenario);
      if (accepted) assert.deepEqual(await pending, { turn: acceptedTurn });
      else await assert.rejects(pending, error => error === transportError);
      assert.equal(calls.filter(call => call.method === "turn/start").length, 1);
      const fullReads = calls.filter(call => call.method === "thread/turns/list" && call.params.itemsView === "full");
      assert.equal(fullReads.length, ["no_id", "empty_id", "rpc_rejected", "generation_before_read"].includes(scenario) ? 0 :
        ["wrong_client", "identical_prompt", "wrong_item"].includes(scenario) ? 20 : 1);
      const phase = state.list()[0].phase;
      assert.equal(phase, scenario === "completed" ? "completed" :
        scenario.startsWith("generation_") ? "disconnected" :
          scenario === "rpc_rejected" && !continuing ? "error" : "responding");
      if (continuing) assert.equal(store.updates.at(-1)[0].phase, accepted ? (scenario === "completed" ? "finished" : "accepted") : "unknown");
      const reconciliation = logs.find(record => record.event === "recovery.send_reconciliation");
      assert.ok(reconciliation);
      assert.equal(reconciliation.outcome, accepted ? "matched" :
        ["no_id", "empty_id"].includes(scenario) ? "missing_client_id" :
          scenario.startsWith("generation_") ? "generation_changed" :
            scenario === "rpc_rejected" ? "rpc_rejected" : scenario === "read_failed" ? "read_failed" : "no_match");
      assert.ok(!JSON.stringify(logs).includes("private"));
      assert.ok(!JSON.stringify(store.updates).includes("private"));
      assert.ok(!JSON.stringify(logs).includes("client-expected"));
    });
  }
}

for (const continuing of [false, true]) {
  for (const phase of ["waiting", "responding", "tool", "approval", "input", "completed", "interrupted", "error"]) {
    test(`${continuing ? "continuation" : "ordinary start"} uncertainty preserves observed ${phase}`, async () => {
      const calls = [];
      const baseRpc = idleSnapshotRpc(calls);
      let state;
      const error = new Error("fixture uncertainty");
      const rpc = async (method, params) => {
        if (method !== "turn/start") return baseRpc(method, params);
        calls.push({ method, params });
        state.setStage(params.threadId, phase, "known-turn");
        throw error;
      };
      state = new RecoveryState({ store: memoryStore(), rpc });
      await assert.rejects(state.start(continuation("thread-phase", continuing ? "continue" : "new work")), e => e === error);
      assert.equal(state.list()[0].phase, phase);
      assert.equal(state.list()[0].turnId, "known-turn");
      assert.equal(calls.filter(call => call.method === "turn/start").length, 1);
    });
  }
}

function memoryStore(records = []) {
  const values = new Map([[STORAGE_KEY, structuredClone(records)]]);
  const updates = [];
  return {
    updates,
    get(key, fallback) { return structuredClone(values.has(key) ? values.get(key) : fallback); },
    async update(key, value) { updates.push(structuredClone(value)); values.set(key, structuredClone(value)); },
  };
}

function idleSnapshotRpc(calls, options = {}) {
  return async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/read") return { thread: { id: params.threadId, status: { type: "idle" } } };
    if (method === "thread/turns/list") return { data: [{ id: options.latestId ?? "turn-old", status: options.latestStatus ?? "completed" }] };
    if (method === "turn/start") return { turn: { id: options.startedId ?? "turn-new", status: "inProgress" } };
    throw new Error(`Unexpected RPC: ${method}`);
  };
}

test("a play click racing typed continue dispatches one continuation", async () => {
  const calls = [];
  let releaseRead;
  const readGate = new Promise(resolve => { releaseRead = resolve; });
  const baseRpc = idleSnapshotRpc(calls);
  const rpc = async (method, params) => {
    if (method === "thread/read") await readGate;
    return baseRpc(method, params);
  };
  const state = new RecoveryState({ store: memoryStore(), rpc });

  const play = state.start(continuation("thread-race", "continue"));
  const typed = state.start(continuation("thread-race", "계속해주세요"));
  releaseRead();
  const [first, second] = await Promise.all([play, typed]);

  assert.equal(first.turn.id, "turn-new");
  assert.deepEqual(second, first);
  assert.equal(calls.filter(call => call.method === "turn/start").length, 1);
  assert.deepEqual(calls.find(call => call.method === "turn/start").params.input, [{ type: "text", text: "continue" }]);
});

test("concurrent native thread resume requests share one RPC", async () => {
  const calls = [];
  let releaseResume;
  const resumeGate = new Promise(resolve => { releaseResume = resolve; });
  const baseRpc = idleSnapshotRpc(calls);
  const rpc = async (method, params) => {
    if (method === "thread/resume") {
      calls.push({ method, params });
      await resumeGate;
      return { thread: { id: params.threadId } };
    }
    return baseRpc(method, params);
  };
  const state = new RecoveryState({ store: memoryStore(), rpc });
  const params = { threadId: "thread-resume" };

  const first = state.resume(params);
  const second = state.resume({ ...params });
  releaseResume();
  await Promise.all([first, second]);

  assert.equal(calls.filter(call => call.method === "thread/resume").length, 1);
});

for (const method of ["turn/start", "turn/steer"]) {
  test(`${method} waits for pending recovery without overtaking its admission`, async () => {
    const calls = [];
    let release, entered;
    const gate = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { entered = resolve; });
    const baseRpc = idleSnapshotRpc(calls);
    const state = new RecoveryState({ store: memoryStore(), rpc: async (name, params) => {
      if (name === "thread/resume") {
        calls.push({ method: name, params }); entered(); await gate;
        return { thread: { id: params.threadId } };
      }
      if (name === "turn/steer") { calls.push({ method: name, params }); return { turnId: "turn-live" }; }
      return baseRpc(name, params);
    } });
    const resume = state.resume({ threadId: "ordered" });
    const params = { threadId: "ordered", clientUserMessageId: "new-input", expectedTurnId: "turn-live",
      input: [{ type: "text", text: "new instruction" }] };
    const input = method === "turn/start" ? state.start(params) : state.steer(params);
    await ready;
    assert.deepEqual(calls.map(call => call.method), ["thread/resume"]);
    release(); await Promise.all([resume, input]);
    assert.equal(calls.filter(call => call.method === method).length, 1);
    assert.ok(calls.findIndex(call => call.method === method) > calls.findIndex(call => call.method === "thread/turns/list"));
  });

  test(`${method} preserves pending-recovery failure without dispatching input`, async () => {
    const calls = [], error = Object.assign(Error("resume rejected"), { rpcError: { code: -32603, message: "resume rejected" } });
    const state = new RecoveryState({ store: memoryStore(), rpc: async name => { calls.push(name); throw error; } });
    const resume = state.resume({ threadId: "resume-failure" });
    const params = { threadId: "resume-failure", input: [{ type: "text", text: "new instruction" }] };
    const input = method === "turn/start" ? state.start(params) : state.steer(params);
    await Promise.all([assert.rejects(resume, e => e === error), assert.rejects(input, e => e === error)]);
    assert.deepEqual(calls, ["thread/resume"]);
  });
}

test("distinct steering inputs remain ordered while another thread can proceed", async () => {
  const calls = [];
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  const state = new RecoveryState({ store: memoryStore(), rpc: async (method, params) => {
    calls.push({ method, params });
    if (params.clientUserMessageId === "first") { entered(); await gate; }
    return { turnId: params.threadId };
  } });
  const request = id => ({ threadId: "same", expectedTurnId: "live", clientUserMessageId: id,
    input: [{ type: "text", text: "same text" }] });
  const first = state.steer(request("first")), second = state.steer(request("second"));
  await ready;
  await state.steer({ ...request("independent"), threadId: "other" });
  assert.deepEqual(calls.map(call => call.params.clientUserMessageId), ["first", "independent"]);
  release(); await Promise.all([first, second]);
  assert.deepEqual(calls.map(call => call.params.clientUserMessageId), ["first", "independent", "second"]);
});

test("steering queued against a disconnected generation is not replayed", async () => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  const calls = [];
  const state = new RecoveryState({ store: memoryStore(), rpc: async (method, params) => {
    calls.push(params.clientUserMessageId); entered(); await gate; return { turnId: "live" };
  } });
  const first = state.steer({ threadId: "disconnect", clientUserMessageId: "first" });
  const second = state.steer({ threadId: "disconnect", clientUserMessageId: "second" });
  const rejected = assert.rejects(second, /연결이 변경/);
  await ready; state.disconnect(); release(); await first; await rejected;
  assert.deepEqual(calls, ["first"]);
});

test("continuation attaches to an active turn without adding input", async () => {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/read") return { thread: { id: params.threadId, status: { type: "active", activeFlags: [] } } };
    if (method === "thread/turns/list") return { data: [{ id: "turn-live", status: "inProgress" }] };
    throw new Error(`Continuation must not dispatch ${method}`);
  };
  const store = memoryStore();
  const state = new RecoveryState({ store, rpc });

  const result = await state.start(continuation("thread-live"));

  assert.equal(result.turn.id, "turn-live");
  assert.deepEqual(calls.map(call => call.method), ["thread/read", "thread/turns/list"]);
  assert.equal(store.updates.length, 0);
});

test("a persisted outcome-unknown receipt blocks replay after reload", async () => {
  const calls = [];
  const store = memoryStore([{
    threadId: "thread-unknown", operationId: "op-1", fingerprint: "hash", baselineTurnId: "turn-old",
    phase: "dispatching", turnId: null, updatedAt: 1,
  }]);
  const state = new RecoveryState({ store, rpc: idleSnapshotRpc(calls) });

  await assert.rejects(state.start(continuation("thread-unknown")), /결과가 불명확/);
  assert.equal(calls.filter(call => call.method === "turn/start").length, 0);
  assert.equal(state.list().find(entry => entry.threadId === "thread-unknown").uncertain, true);
});

test("reload reattaches live work to an uncertain receipt without replay", async () => {
  const calls = [];
  const store = memoryStore([{
    threadId: "thread-attach", operationId: "op-attach", fingerprint: "hash", baselineTurnId: "turn-old",
    phase: "unknown", turnId: null, updatedAt: 1,
  }]);
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/read") return { thread: { id: params.threadId, status: { type: "active", activeFlags: [] } } };
    if (method === "thread/turns/list") return { data: [{ id: "turn-live", status: "inProgress" }] };
    throw new Error(`Reload attachment must not dispatch ${method}`);
  };
  const state = new RecoveryState({ store, rpc });

  const result = await state.start(continuation("thread-attach"));

  assert.equal(result.turn.id, "turn-live");
  assert.deepEqual(calls.map(call => call.method), ["thread/read", "thread/turns/list"]);
  assert.equal(store.updates.at(-1).find(receipt => receipt.threadId === "thread-attach").phase, "accepted");
  assert.equal(store.updates.at(-1).find(receipt => receipt.threadId === "thread-attach").attached, true);
});

test("ordinary instructions preserve native steering and bypass recovery receipts", async () => {
  const calls = [];
  const store = memoryStore();
  const state = new RecoveryState({ store, rpc: idleSnapshotRpc(calls) });
  const params = { threadId: "thread-steer", input: [{ type: "text", text: "Use the other approach" }] };

  const result = await state.start(params);

  assert.equal(result.turn.id, "turn-new");
  assert.deepEqual(calls.map(call => call.method), ["turn/start"]);
  assert.equal(calls[0].params, params);
  assert.equal(store.updates.length, 0);
});

test("concurrent ordinary steering remains distinct and is serialized per thread", async () => {
  const calls = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const rpc = async (method, params) => {
    assert.equal(method, "turn/start");
    calls.push(params);
    if (calls.length === 1) await firstGate;
    return { turn: { id: `turn-${calls.length}` } };
  };
  const state = new RecoveryState({ store: memoryStore(), rpc });
  const firstParams = { threadId: "thread-steer-queue", input: [{ type: "text", text: "first instruction" }] };
  const secondParams = { threadId: "thread-steer-queue", input: [{ type: "text", text: "second instruction" }] };

  const first = state.start(firstParams);
  const second = state.start(secondParams);
  while (calls.length === 0) await Promise.resolve();
  assert.equal(calls.length, 1);
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(calls, [firstParams, secondParams]);
});

test("receipt persistence failure prevents continuation dispatch", async () => {
  const calls = [];
  const store = memoryStore();
  store.update = async () => { throw new Error("disk full"); };
  const state = new RecoveryState({ store, rpc: idleSnapshotRpc(calls) });

  await assert.rejects(state.start(continuation("thread-storage")), /저장에 실패/);
  assert.equal(calls.filter(call => call.method === "turn/start").length, 0);
});

test("recovery confirms interruption and idle before starting one continuation", async () => {
  const calls = [];
  let reads = 0;
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/read") {
      reads++;
      return { thread: { id: params.threadId, status: { type: reads < 2 ? "active" : "idle", activeFlags: [] } } };
    }
    if (method === "thread/turns/list") return { data: [{ id: reads < 2 ? "turn-live" : "turn-interrupted", status: reads < 2 ? "inProgress" : "interrupted" }] };
    if (method === "turn/interrupt") return {};
    if (method === "turn/start") return { turn: { id: "turn-recovered", status: "inProgress" } };
    throw new Error(`Unexpected RPC: ${method}`);
  };
  const state = new RecoveryState({ store: memoryStore(), rpc, pause: async () => {} });

  const result = await state.recover("thread-recover");

  assert.equal(result.turn.id, "turn-recovered");
  assert.equal(calls.filter(call => call.method === "turn/interrupt").length, 1);
  assert.equal(calls.filter(call => call.method === "turn/start").length, 1);
  assert.ok(calls.findIndex(call => call.method === "turn/interrupt") < calls.findIndex(call => call.method === "turn/start"));
});

test("interruption timeout refuses a new start", async () => {
  const calls = [];
  let clock = 0;
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/read") return { thread: { id: params.threadId, status: { type: "active", activeFlags: [] } } };
    if (method === "thread/turns/list") return { data: [{ id: "turn-stuck", status: "inProgress" }] };
    if (method === "turn/interrupt") return {};
    throw new Error(`Unexpected RPC: ${method}`);
  };
  const state = new RecoveryState({ store: memoryStore(), rpc, now: () => clock, pause: async () => { clock += 10000; } });

  await assert.rejects(state.recover("thread-stuck"), /새 작업은 시작하지 않았습니다/);
  assert.equal(calls.filter(call => call.method === "turn/start").length, 0);
});

test("90 second silence marks progress delayed while human waits remain exempt", () => {
  let clock = 0;
  const state = new RecoveryState({ store: memoryStore(), rpc: async () => {}, now: () => clock });
  state.setStage("thread-work", "waiting", "turn-1");
  state.setStage("thread-approval", "approval", "turn-2");
  state.setStage("thread-input", "input", "turn-3");
  clock = 90000;

  const listed = new Map(state.list().map(entry => [entry.threadId, entry]));
  assert.equal(listed.get("thread-work").delayed, true);
  assert.equal(listed.get("thread-approval").delayed, false);
  assert.equal(listed.get("thread-input").delayed, false);
});

test("disconnect fences an in-flight continuation before dispatch", async () => {
  const calls = [];
  let releaseRead;
  const gate = new Promise(resolve => { releaseRead = resolve; });
  const baseRpc = idleSnapshotRpc(calls);
  const rpc = async (method, params) => {
    if (method === "thread/read") await gate;
    return baseRpc(method, params);
  };
  const state = new RecoveryState({ store: memoryStore(), rpc });

  const pending = state.start(continuation("thread-fenced"));
  await Promise.resolve();
  state.disconnect();
  releaseRead();

  await assert.rejects(pending, /연결이 변경/);
  assert.equal(calls.filter(call => call.method === "turn/start").length, 0);
});

test("terminal notification before start acknowledgement remains terminal and persists finished", async () => {
  const calls = [];
  const store = memoryStore();
  let acknowledge;
  const acknowledgement = new Promise(resolve => { acknowledge = resolve; });
  const baseRpc = idleSnapshotRpc(calls);
  const rpc = async (method, params) => {
    if (method === "turn/start") {
      calls.push({ method, params });
      return acknowledgement;
    }
    return baseRpc(method, params);
  };
  const state = new RecoveryState({ store, rpc });
  const pending = state.start(continuation("thread-fast"));
  while (!calls.some(call => call.method === "turn/start")) await Promise.resolve();

  state.observe({ method: "turn/started", params: { threadId: "thread-fast", turn: { id: "turn-fast" } } });
  state.observe({ method: "turn/completed", params: { threadId: "thread-fast", turn: { id: "turn-fast", status: "completed" } } });
  acknowledge({ turn: { id: "turn-fast", status: "completed" } });
  await pending;

  assert.equal(state.list().find(entry => entry.threadId === "thread-fast").phase, "completed");
  assert.equal(store.updates.at(-1).find(receipt => receipt.threadId === "thread-fast").phase, "finished");
});

test("late item activity and unload do not overwrite a completed turn", () => {
  const state = new RecoveryState({ store: memoryStore(), rpc: async () => {} });
  state.setStage("thread-terminal", "waiting", "turn-terminal");
  state.observe({ method: "turn/completed", params: { threadId: "thread-terminal", turn: { id: "turn-terminal", status: "completed" } } });
  state.observe({ method: "item/commandExecution/outputDelta", params: { threadId: "thread-terminal", turnId: "turn-terminal" } });
  state.observe({ method: "item/completed", params: { threadId: "thread-terminal", turnId: "turn-terminal" } });
  state.observe({ method: "thread/status/changed", params: { threadId: "thread-terminal", status: { type: "notLoaded" } } });

  assert.equal(state.list().find(entry => entry.threadId === "thread-terminal").phase, "completed");
});

function failedTurn(id, error) {
  return { id, status: "failed", error };
}

function systemErrorRpc(calls, { error, latestStatus = "failed", threadStatus = "systemError", startedId = "turn-new" } = {}) {
  return async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/read") return { thread: { id: params.threadId, status: { type: threadStatus } } };
    if (method === "thread/turns/list") return { data: [{ ...failedTurn("turn-failed", error), status: latestStatus }] };
    if (method === "turn/start") return { turn: { id: startedId, status: "inProgress" } };
    throw new Error(`Unexpected RPC: ${method}`);
  };
}

const timeoutMessages = [
  "Fatal error: native inference helper became idle",
  "Fatal error: native inference request exceeded its deadline",
  "Fatal error: native inference produced no output frames for 120s",
  "Fatal error: native inference helper failed (provider_headers_timeout)",
  "Fatal error: native inference helper failed (provider_stream_idle)",
  "Fatal error: native inference helper failed (provider_request_deadline)",
];

const terminalErrors = [
  { name: "timeout", error: { codexErrorInfo: "other", message: timeoutMessages[2] } },
  { name: "quota", error: { codexErrorInfo: "usageLimitExceeded", message: "Usage limit reached" } },
  { name: "provider-rejection", error: { codexErrorInfo: "other",
    message: "미분류 오류: native inference helper failed (provider_http_400)" } },
];

for (const text of [null, "continue", "계속"]) {
  test(`historical provider rejection admits ${text ?? "empty play"} without asserting quota`, async () => {
    const calls = [], records = [];
    const state = new RecoveryState({ store: memoryStore(), log: record => records.push(record),
      rpc: systemErrorRpc(calls, { error: terminalErrors[2].error }) });
    const params = text === null ? { threadId: "thread-rejection", input: [] } : continuation("thread-rejection", text);
    const results = await Promise.all([state.start({ ...params, model: "current-model" }),
      state.start({ ...params, model: "current-model" })]);
    assert.equal(results[0].turn.id, results[1].turn.id);
    const starts = calls.filter(call => call.method === "turn/start");
    assert.equal(starts.length, 1);
    assert.equal(starts[0].params.model, "current-model");
    assert.deepEqual(starts[0].params.input, [{ type: "text", text: text ?? "continue" }]);
    assert.equal(records.find(record => record.event === "recovery.admission").errorKind, "provider_request_rejected");
    assert.equal(JSON.stringify(records).includes(terminalErrors[2].error.message), false);
  });
}

for (const message of ["native inference helper failed (provider_http_400)",
  "미분류 오류: native inference helper failed (provider_http_400) extra",
  'docs say "미분류 오류: native inference helper failed (provider_http_400)"',
  "미분류 오류: native inference helper failed (provider_http_403)"]) {
  test(`provider rejection lookalike stays blocked: ${message}`, async () => {
    const calls = [];
    const state = new RecoveryState({ store: memoryStore(),
      rpc: systemErrorRpc(calls, { error: { codexErrorInfo: "other", message } }) });
    await assert.rejects(state.start({ threadId: "thread-rejection-other", input: [] }), /엔진 상태를 확인/);
    assert.equal(calls.filter(call => call.method === "turn/start").length, 0);
  });
}

for (const message of [undefined, "Usage limit reached", "unrelated private engine text", timeoutMessages[0]]) {
  for (const text of [null, "continue", "계속"]) {
    test(`structured quota failure admits ${text ?? "empty play"} regardless of message ${JSON.stringify(message)}`, async () => {
      const calls = [], records = [], store = memoryStore();
      const state = new RecoveryState({ store, log: record => records.push(record),
        rpc: systemErrorRpc(calls, { error: { codexErrorInfo: "usageLimitExceeded", message } }) });
      const params = text === null ? { threadId: "thread-quota", input: [] } : continuation("thread-quota", text);

      // No account transition or additional request is needed for explicit retry.
      assert.equal(calls.length, 0);
      const result = await state.start({ ...params, model: "selected-model" });
      const starts = calls.filter(call => call.method === "turn/start");
      assert.equal(result.turn.id, "turn-new");
      assert.equal(starts.length, 1);
      assert.deepEqual(starts[0].params.input, [{ type: "text", text: text ?? "continue" }]);
      assert.equal(starts[0].params.model, "selected-model");
      assert.equal(store.updates.at(-1)[0].phase, "accepted");
      const admission = records.find(record => record.event === "recovery.admission");
      assert.equal(admission.outcome, "admitted");
      assert.equal(admission.errorKind, "usage_limit_exceeded");
      assert.equal("message" in admission, false);
      if (message) assert.equal(JSON.stringify(records).includes(message), false);
      assert.ok(calls.every(call => ["thread/read", "thread/turns/list", "turn/start"].includes(call.method)));
    });
  }
}

test("quota message with category other remains blocked", async () => {
  const calls = [], records = [];
  const state = new RecoveryState({ store: memoryStore(), log: record => records.push(record),
    rpc: systemErrorRpc(calls, { error: { codexErrorInfo: "other", message: "Usage limit reached" } }) });
  await assert.rejects(state.start({ threadId: "thread-quota-text", input: [] }), /엔진 상태를 확인/);
  assert.equal(calls.filter(call => call.method === "turn/start").length, 0);
  assert.equal(records.find(record => record.event === "recovery.admission").errorKind, "other");
});

for (const latestStatus of ["completed", "interrupted", "inProgress"]) {
  test(`quota category on a ${latestStatus} latest turn does not admit continuation`, async () => {
    const calls = [];
    const state = new RecoveryState({ store: memoryStore(), rpc: systemErrorRpc(calls,
      { latestStatus, error: terminalErrors[1].error }) });
    await assert.rejects(state.start(continuation("thread-quota-notfailed")), /엔진 상태를 확인/);
    assert.equal(calls.filter(call => call.method === "turn/start").length, 0);
  });
}

test("live turn with a quota error attaches without dispatch", async () => {
  const calls = [], store = memoryStore();
  const state = new RecoveryState({ store, rpc: systemErrorRpc(calls,
    { threadStatus: "active", latestStatus: "inProgress", error: terminalErrors[1].error, startedId: "must-not-start" }) });
  const result = await state.start({ threadId: "thread-quota-active", input: [] });
  assert.equal(result.turn.id, "turn-failed");
  assert.deepEqual(calls.map(call => call.method), ["thread/read", "thread/turns/list"]);
  assert.equal(store.updates.length, 0);
});

for (const message of timeoutMessages) {
  test(`system error timeout "${message}" admits one continuation`, async () => {
    const calls = [];
    const store = memoryStore();
    const state = new RecoveryState({ store, rpc: systemErrorRpc(calls, { error: { codexErrorInfo: "other", message } }) });

    const result = await state.start(continuation("thread-timeout"));

    assert.equal(result.turn.id, "turn-new");
    assert.equal(calls.filter(call => call.method === "turn/start").length, 1);
    assert.equal(store.updates.at(-1).find(receipt => receipt.threadId === "thread-timeout").phase, "accepted");
  });

  test(`empty-input resume after "${message}" dispatches canonical continue`, async () => {
    const calls = [];
    const records = [];
    const state = new RecoveryState({ store: memoryStore(), log: record => records.push(record),
      rpc: systemErrorRpc(calls, { error: { codexErrorInfo: "other", message } }) });
    await state.start({ threadId: "thread-empty-timeout", input: [], model: "selected-model" });
    const starts = calls.filter(call => call.method === "turn/start");
    assert.equal(starts.length, 1);
    assert.deepEqual(starts[0].params.input, [{ type: "text", text: "continue" }]);
    assert.equal(starts[0].params.model, "selected-model");
    assert.notEqual(records.find(record => record.event === "recovery.admission").errorKind, "other");
  });
}

for (const message of [
  "Fatal error: native inference produced no output frames for 121s",
  "Fatal error: native inference produced no output frames for 120s extra",
  "Fatal error: native inference helper failed (provider_failure)",
]) {
  test(`unrecognized or non-timeout failure remains blocked: ${message}`, async () => {
    const calls = [];
    const state = new RecoveryState({ store: memoryStore(),
      rpc: systemErrorRpc(calls, { error: { codexErrorInfo: "other", message } }) });
    await assert.rejects(state.start({ threadId: "thread-blocked", input: [] }), /엔진 상태를 확인/);
    assert.equal(calls.filter(call => call.method === "turn/start").length, 0);
  });
}

test("system error with a generic failure message blocks continuation", async () => {
  const calls = [];
  const state = new RecoveryState({ store: memoryStore(), rpc: systemErrorRpc(calls, { error: { codexErrorInfo: "other", message: "Fatal error: stream disconnected" } }) });

  await assert.rejects(state.start(continuation("thread-generic")), /엔진 상태를 확인/);
  assert.equal(calls.filter(call => call.method === "turn/start").length, 0);
});

test("system error timeout under a non-other error category blocks continuation", async () => {
  const calls = [];
  const state = new RecoveryState({ store: memoryStore(), rpc: systemErrorRpc(calls, { error: { codexErrorInfo: "contextWindowExceeded", message: timeoutMessages[1] } }) });

  await assert.rejects(state.start(continuation("thread-category")), /엔진 상태를 확인/);
  assert.equal(calls.filter(call => call.method === "turn/start").length, 0);
});

test("system error without a failed latest turn blocks continuation", async () => {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/read") return { thread: { id: params.threadId, status: { type: "systemError" } } };
    if (method === "thread/turns/list") return { data: [{ id: "turn-interrupted", status: "interrupted" }] };
    throw new Error(`Unexpected RPC: ${method}`);
  };
  const state = new RecoveryState({ store: memoryStore(), rpc });

  await assert.rejects(state.start(continuation("thread-notfailed")), /엔진 상태를 확인/);
  assert.equal(calls.filter(call => call.method === "turn/start").length, 0);
});

test("system error without a latest error blocks continuation", async () => {
  const calls = [];
  const state = new RecoveryState({ store: memoryStore(), rpc: systemErrorRpc(calls, { error: undefined }) });

  await assert.rejects(state.start(continuation("thread-noerror")), /엔진 상태를 확인/);
  assert.equal(calls.filter(call => call.method === "turn/start").length, 0);
});

for (const { name, error } of terminalErrors) {
  test(`${name} admission still applies after a notLoaded resume snapshot`, async () => {
    const calls = [];
    let reads = 0;
    const rpc = async (method, params) => {
      calls.push({ method, params });
      if (method === "thread/read") {
        reads++;
        return { thread: { id: params.threadId, status: { type: reads === 1 ? "notLoaded" : "systemError" } } };
      }
      if (method === "thread/turns/list") return { data: [failedTurn("turn-failed", error)] };
      if (method === "thread/resume") return { thread: { id: params.threadId } };
      if (method === "turn/start") return { turn: { id: "turn-new", status: "inProgress" } };
      throw new Error(`Unexpected RPC: ${method}`);
    };
    const state = new RecoveryState({ store: memoryStore(), rpc });

    const result = await state.start(continuation("thread-resumed"));

    assert.equal(result.turn.id, "turn-new");
    assert.equal(calls.filter(call => call.method === "thread/resume").length, 1);
    assert.equal(calls.filter(call => call.method === "turn/start").length, 1);
  });
}

test("a thread still notLoaded after resume blocks continuation", async () => {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/read") return { thread: { id: params.threadId, status: { type: "notLoaded" } } };
    if (method === "thread/turns/list") return { data: [failedTurn("turn-failed", { codexErrorInfo: "other", message: timeoutMessages[0] })] };
    if (method === "thread/resume") return { thread: { id: params.threadId } };
    throw new Error(`Unexpected RPC: ${method}`);
  };
  const state = new RecoveryState({ store: memoryStore(), rpc });

  await assert.rejects(state.start(continuation("thread-still-unloaded")), /스레드 복구가 완료되지 않았습니다/);
  assert.equal(calls.filter(call => call.method === "turn/start").length, 0);
});

for (const { name, error } of terminalErrors) {
  test(`a racing empty play and typed continue on a ${name} thread dispatch once`, async () => {
    const calls = [];
    let releaseRead;
    const readGate = new Promise(resolve => { releaseRead = resolve; });
    const baseRpc = systemErrorRpc(calls, { error });
    const rpc = async (method, params) => {
      if (method === "thread/read") await readGate;
      return baseRpc(method, params);
    };
    const state = new RecoveryState({ store: memoryStore(), rpc });

    const play = state.start({ threadId: "thread-timeout-race", input: [] });
    const typed = state.start(continuation("thread-timeout-race", "계속"));
    releaseRead();
    const [first, second] = await Promise.all([play, typed]);

    assert.equal(first.turn.id, "turn-new");
    assert.deepEqual(second, first);
    assert.equal(calls.filter(call => call.method === "turn/start").length, 1);
    assert.deepEqual(calls.find(call => call.method === "turn/start").params.input, [{ type: "text", text: "continue" }]);
  });

  test(`an unresolved receipt still blocks a ${name}-admitted continuation`, async () => {
    const calls = [];
    const store = memoryStore([{
      threadId: "thread-timeout-unknown", operationId: "op-timeout", fingerprint: "hash", baselineTurnId: "turn-failed",
      phase: "unknown", turnId: null, updatedAt: 1,
    }]);
    const state = new RecoveryState({ store, rpc: systemErrorRpc(calls, { error }) });

    await assert.rejects(state.start(continuation("thread-timeout-unknown")), /결과가 불명확/);
    assert.equal(calls.filter(call => call.method === "turn/start").length, 0);
  });
}

test("admission diagnostics record allowlisted kinds and correlation ids without engine text", async () => {
  const records = [];
  const log = record => records.push(record);
  const admissions = threadId => records.filter(r => r.event === "recovery.admission" && r.threadId === threadId);

  // Attached: live turn attaches without dispatch.
  const activeRpc = async (method, params) => {
    if (method === "thread/read") return { thread: { id: params.threadId, status: { type: "active", activeFlags: [] } } };
    if (method === "thread/turns/list") return { data: [{ id: "turn-live", status: "inProgress" }] };
    throw new Error(`Unexpected RPC: ${method}`);
  };
  const attached = new RecoveryState({ store: memoryStore(), rpc: activeRpc, log });
  await attached.start(continuation("thread-diag-attach"));
  const attachedRecord = admissions("thread-diag-attach").at(-1);
  assert.equal(attachedRecord.outcome, "attached");
  assert.equal(attachedRecord.reason, "active_turn");
  assert.equal(attachedRecord.turnId, "turn-live");
  assert.equal(attachedRecord.threadStatus, "active");
  assert.equal(attachedRecord.turnStatus, "inProgress");
  assert.equal(attachedRecord.errorKind, "none");
  assert.equal(attachedRecord.reviewedUnknown, false);

  // Admitted: legacy helper idle is a known terminal admission.
  const admittedCalls = [];
  const admitted = new RecoveryState({ store: memoryStore(), log,
    rpc: systemErrorRpc(admittedCalls, { error: { codexErrorInfo: "other", message: timeoutMessages[0] } }) });
  await admitted.start(continuation("thread-diag-admit"));
  const admittedRecord = admissions("thread-diag-admit").at(-1);
  assert.equal(admittedRecord.outcome, "admitted");
  assert.equal(admittedRecord.reason, "terminal_state_confirmed");
  assert.equal(admittedRecord.turnId, "turn-failed");
  assert.equal(admittedRecord.threadStatus, "systemError");
  assert.equal(admittedRecord.turnStatus, "failed");
  assert.equal(admittedRecord.errorKind, "legacy_helper_idle");

  // Blocked: the new helper_unresponsive diagnostic stays blocked.
  const unresponsiveCalls = [];
  const unresponsive = new RecoveryState({ store: memoryStore(), log,
    rpc: systemErrorRpc(unresponsiveCalls, { error: { codexErrorInfo: "other",
      message: "Fatal error: native inference helper unresponsive (no protocol frames for 120s)" } }) });
  await assert.rejects(unresponsive.start(continuation("thread-diag-unresponsive")), /엔진 상태를 확인/);
  const unresponsiveRecord = admissions("thread-diag-unresponsive").at(-1);
  assert.equal(unresponsiveRecord.outcome, "blocked");
  assert.equal(unresponsiveRecord.reason, "terminal_state_not_admitted");
  assert.equal(unresponsiveRecord.errorKind, "helper_unresponsive");
  assert.equal(unresponsiveCalls.filter(call => call.method === "turn/start").length, 0);

  // Blocked: arbitrary secret-bearing engine text never reaches the record.
  const secret = "sk-live-SECRET-diagnostic-token";
  const secretCalls = [];
  const secreted = new RecoveryState({ store: memoryStore(), log,
    rpc: systemErrorRpc(secretCalls, { error: { codexErrorInfo: "other",
      message: `Fatal error: credential ${secret} rejected` } }) });
  await assert.rejects(secreted.start(continuation("thread-diag-secret")), /엔진 상태를 확인/);
  const secretRecord = admissions("thread-diag-secret").at(-1);
  assert.equal(secretRecord.outcome, "blocked");
  assert.equal(secretRecord.errorKind, "other");
  assert.equal("message" in secretRecord, false);
  assert.equal(JSON.stringify(secretRecord).includes(secret), false);
});

test("phase, dispatch, accepted and terminal records share thread and turn correlation", async () => {
  const records = [];
  const calls = [];
  const store = memoryStore();
  const state = new RecoveryState({ store, rpc: idleSnapshotRpc(calls), log: record => records.push(record) });

  const pending = state.start(continuation("thread-corr"));
  while (!calls.some(call => call.method === "turn/start")) await Promise.resolve();
  state.observe({ method: "turn/started", params: { threadId: "thread-corr", turn: { id: "turn-new" } } });
  const result = await pending;
  state.observe({ method: "turn/completed", params: { threadId: "thread-corr", turn: { id: "turn-new", status: "completed" } } });
  await state.writes;

  const own = records.filter(r => r.threadId === "thread-corr");
  const phases = own.filter(r => r.event === "recovery.phase").map(r => r.phase);
  assert.deepEqual(phases, ["recovering", "completed", "starting", "waiting", "completed"]);
  assert.equal(phases.at(-1), "completed");
  for (const record of own.filter(r => r.event === "recovery.phase")) {
    assert.equal(typeof record.previousPhase, "string");
    assert.equal(record.turnId == null || typeof record.turnId === "string", true);
    assert.equal(Number.isSafeInteger(record.elapsedSinceUpdateMs), true);
    assert.equal(Number.isSafeInteger(record.droppedDiagnostics), true);
  }
  const dispatch = own.find(r => r.event === "recovery.dispatch");
  const accepted = own.find(r => r.event === "recovery.accepted");
  assert.equal(typeof dispatch.operationId, "string");
  assert.equal(accepted.operationId, dispatch.operationId);
  assert.equal(accepted.turnId, result.turn.id);
  assert.equal(accepted.alreadyFinished, false);
  const terminal = own.find(r => r.event === "recovery.turn_terminal");
  assert.equal(terminal.turnId, "turn-new");
  assert.equal(terminal.status, "completed");
  assert.equal(terminal.errorKind, "none");
  const receipt = store.updates.at(-1).find(r => r.threadId === "thread-corr");
  assert.equal(receipt.phase, "finished");
  assert.equal(receipt.operationId, dispatch.operationId);
});

test("a throwing diagnostic logger does not change start success and counts drops", async () => {
  const calls = [];
  const store = memoryStore();
  const state = new RecoveryState({ store, rpc: idleSnapshotRpc(calls),
    log: () => { throw new Error("diagnostic sink unavailable"); } });

  const result = await state.start(continuation("thread-throwing-log"));

  assert.equal(result.turn.id, "turn-new");
  assert.ok(state.droppedDiagnostics > 0);
  assert.equal(store.updates.at(-1).find(r => r.threadId === "thread-throwing-log").phase, "accepted");
  const dropsAfterStart = state.droppedDiagnostics;
  state.observe({ method: "turn/completed", params: { threadId: "thread-throwing-log", turn: { id: "turn-new", status: "completed" } } });
  assert.ok(state.droppedDiagnostics > dropsAfterStart);
  assert.equal(state.list().find(entry => entry.threadId === "thread-throwing-log").phase, "completed");
});

"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require(path.resolve("extensions/azrael-ex/node_modules/typescript/lib/typescript.js"));
const { createImmediateStopCoordinator } = require("./immediate-stop.cjs");
const { IMMEDIATE_STOP_ASSET: asset, IMMEDIATE_STOP_MARKER: marker, injectImmediateStop } = require("./inject-immediate-stop.cjs");
const { transformAsset } = require("./namespace-azrael-host.cjs");
const pristine = fs.readFileSync(path.resolve("artifacts/upstream-ui/26.930.61225", asset), "utf8");
const changed = injectImmediateStop(pristine, asset).text;
function declarations(source) {
  const ast = ts.createSourceFile(asset, source, 99, true, ts.ScriptKind.JS), found = {};
  function visit(n) {
    if (ts.isFunctionDeclaration(n) && ["oOn", "LSn", "zSn", "FSn", "RSn", "$Q", "gZ", "hZ"].includes(n.name?.text)) {
      assert.ok(!Object.hasOwn(found, n.name.text), `Unique pinned declaration: ${n.name.text}`);
      found[n.name.text] = n.getText(ast);
    }
    if (ts.isMethodDeclaration(n) && n.name.getText(ast) === "interruptConversationSelf") {
      assert.ok(!Object.hasOwn(found, "method"), "Unique pinned interrupt method");
      found.method = n.getText(ast);
    }
    ts.forEachChild(n, visit);
  }
  visit(ast);
  for (const key of ["oOn", "LSn", "zSn", "FSn", "RSn", "$Q", "gZ", "hZ", "method"]) assert.ok(found[key], key);
  return found;
}
const native = declarations(pristine), injected = declarations(changed);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function clock() {
  let time = 0, counter = 0; const timers = new Map();
  return {
    options: { now: () => time, setTimeout: (fn, ms) => { const id = ++counter; timers.set(id, { fn, at: time + ms }); return id; }, clearTimeout: id => timers.delete(id) },
    async advance(ms) { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn(); } await flush(); }
  };
}
function harness({ helper, send, start } = {}) {
  const requests = [], updates = [], states = new Map(), cancellations = [];
  const context = {
    setTimeout, clearTimeout, console,
    c: e => e.message ?? String(e), BSn: { default: (rows, predicate) => rows.findLast(predicate) },
    Ch: (_rows, overlay) => overlay,
    Fh: () => null, bxn() {}, p: {},
    sOn: start ?? (() => Promise.resolve({ turn: { id: "accepted" } })),
  };
  vm.createContext(context);
  vm.runInContext(changed.slice(changed.indexOf(marker)), context);
  if (helper) context.__azraelImmediateStop = helper;
  vm.runInContext(Object.entries(injected).filter(([key]) => key !== "method").map(([, value]) => value).join("\n"), context);
  const method = vm.runInContext(`({${injected.method}}).interruptConversationSelf`, context);
  const manager = {
    conversations: states, getConversation: id => states.get(id), getStreamRole: () => null,
    sendThreadFollowerRequest: async () => null, logger: { warning() {} },
    runtime: { killNodeReplExecutions: () => null }, events: { emitTurnInterruptStarted() {} }, scheduler: { schedule: setTimeout },
    cleanBackgroundTerminals: async () => {},
    async sendRequest(method, params) { requests.push({ method, ...params }); return send?.(params, manager); },
    updateConversationState(id, mutate) { updates.push({ id, before: states.get(id)?.turns.at(-1)?.status }); mutate(states.get(id)); },
  };
  return { context, manager, requests, updates, states, cancellations,
    turn(id = "accepted", status = "inProgress") { states.set("thread", { id: "thread", turns: [{ turnId: id, status }] }); },
    start(messageId = "message") { return context.oOn({ manager, conversationId: "thread", clientUserMessageId: messageId, observeRequest: () => ({ cancel: () => cancellations.push(messageId) }) }); },
    stop(mode = "user-stop", id) { return method.call(manager, "thread", mode, id); }
  };
}

test("pinned injection parses through existing pipeline and guards asset, anchors, and idempotence", () => {
  const integrated = injectImmediateStop(transformAsset(pristine, asset, asset, ts).text, asset).text;
  assert.equal(ts.createSourceFile(asset, integrated, 99, true, ts.ScriptKind.JS).parseDiagnostics.length, 0);
  assert.equal(ts.createSourceFile(asset, changed, 99, true, ts.ScriptKind.JS).parseDiagnostics.length, 0);
  assert.deepEqual(injectImmediateStop(changed, asset), { text: changed, count: 0 });
  assert.deepEqual(injectImmediateStop(pristine, "future.js"), { text: pristine, count: 0 });
  assert.throws(() => injectImmediateStop("", asset), /anchor/);
  assert.throws(() => injectImmediateStop(pristine + pristine, asset), /anchor/);
  assert.throws(() => injectImmediateStop(changed + marker, asset), /Duplicate/);
  for (const damaged of [
    changed.replace("return __azraelImmediateStop.trackStart", "return missing.trackStart"),
    changed.replace("let i=()=>__azraelImmediateStop.stop", "let i=()=>missing.stop"),
    changed.replace("expectedTurnId:__azraelExpectedTurnId", "expectedTurnId:null"),
    changed.replace("const managers = new WeakMap();", "const managers = new Map();"),
    changed + native.oOn,
  ]) assert.throws(() => injectImmediateStop(damaged, asset), /Damaged/);
  for (const key of ["LSn", "zSn", "FSn", "RSn", "$Q", "gZ", "hZ"]) assert.equal(injected[key], native[key]);
});

test("actual native pending start is captured once; later submission cannot replace its ID", async () => {
  const one = deferred(), two = deferred(); let calls = 0;
  const h = harness({ start: () => (++calls === 1 ? one.promise : two.promise), send: (_, m) => { m.getConversation("thread").turns[0].status = "interrupted"; } });
  const first = h.start("first"), stopping = h.stop(); await flush();
  const second = h.start("later"); h.turn(); one.resolve({ turn: { id: "accepted" } });
  assert.equal(await stopping, "accepted"); await first;
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].turnId, "accepted"); assert.equal(calls, 2);
  two.resolve({ turn: { id: "later" } }); await second;
});

test("latest pending token is selected independently per manager and conversation", async () => {
  const helper = createImmediateStopCoordinator(), a = {}, b = {}, first = deferred(), latest = deferred(), other = deferred(), foreign = deferred();
  const starts = [helper.trackStart(a, "t", "first", () => first.promise), helper.trackStart(a, "t", "latest", () => latest.promise), helper.trackStart(b, "t", "other", () => other.promise), helper.trackStart(a, "different", "foreign", () => foreign.promise)];
  const stopA = helper.stop(a, "t", null, true, id => id), stopB = helper.stop(b, "t", null, true, id => id);
  latest.resolve({ turn: { id: "latest" } }); other.resolve({ turn: { id: "other" } });
  assert.equal(await stopA, "latest"); assert.equal(await stopB, "other");
  first.resolve({ turn: { id: "first" } }); foreign.resolve({ turn: { id: "foreign" } }); await Promise.all(starts);
});

test("native start failure remains visible and observer is cancelled; timeout never cancels later", async () => {
  const c = clock(), pending = deferred(), h = harness({ helper: createImmediateStopCoordinator(c.options), start: () => pending.promise });
  const starting = h.start(), stopping = h.stop(); const failure = assert.rejects(starting, /start failed/), stopFailure = assert.rejects(stopping, /start failed/);
  pending.reject(Error("start failed")); await Promise.all([failure, stopFailure]); assert.deepEqual(h.cancellations, ["message"]); assert.equal(h.requests.length, 0);
  const later = deferred(), timed = harness({ helper: createImmediateStopCoordinator(c.options), start: () => later.promise });
  const start = timed.start(), stop = timed.stop(), rejected = assert.rejects(stop, /timed out/); await flush(); await c.advance(20000); await rejected;
  timed.turn(); later.resolve({ turn: { id: "accepted" } }); await start; await flush(); assert.equal(timed.requests.length, 0);
});

test("no-active response retries same target until terminal; successful ACK waits for notification", async () => {
  for (const initiallyUnavailable of [false, true]) {
    const c = clock(); let count = 0;
    const h = harness({ helper: createImmediateStopCoordinator(c.options), send: () => { count++; if (initiallyUnavailable && count === 1) throw Error("no active turn to interrupt"); } });
    h.turn(); let done = false; const stopping = h.stop().then(value => { done = true; return value; }); await flush();
    assert.equal(done, false); assert.equal(h.updates.length, 0);
    await c.advance(25); assert.equal(count, initiallyUnavailable ? 2 : 1); assert.equal(done, false);
    h.manager.getConversation("thread").turns[0].status = "interrupted";
    await c.advance(25); assert.equal(await stopping, "accepted");
    assert.ok(h.requests.every(x => x.turnId === "accepted")); assert.ok(h.updates.every(x => x.before === "interrupted"));
  }
});

test("terminal state, missing state, newer turn, deferred, disconnect and mismatch guard actual LSn", async () => {
  const helper = createImmediateStopCoordinator(); let sent = 0;
  for (const status of ["completed", "interrupted", "failed"]) await helper.interrupt({}, "t", "target", () => { sent++; }, () => ({ turnId: "target", status }));
  assert.equal(sent, 0);
  for (const value of [null, { turnId: "newer", status: "inProgress" }, { turnId: "target", status: "deferred" }]) await assert.rejects(helper.interrupt({}, "t", "target", () => { sent++; }, () => value), /missing|newer|deferred/);
  for (const message of ["disconnected", "expected active turn id `accepted` but found `newer`", 'ExpectedTurnMismatch { actual: "newer" }']) {
    const h = harness({ send: () => { throw Error(message); } }); h.turn(); await assert.rejects(h.stop(), /disconnected|changed/); assert.equal(h.requests.length, 1); assert.equal(h.updates.length, 0);
  }
  const c = clock(), h = harness({ helper: createImmediateStopCoordinator(c.options), send: () => { throw Error("no active turn to interrupt"); } });
  h.turn(); const stop = h.stop(), rejected = assert.rejects(stop, /missing|newer/); await flush(); h.turn("newer"); await c.advance(25); await rejected;
  assert.equal(h.requests.length, 1); assert.equal(h.updates.length, 0);
});

test("interrupt deadline bounds repeated no-active errors and acknowledged nonterminal waits", async () => {
  for (const unavailable of [false, true]) {
    const c = clock(), h = harness({ helper: createImmediateStopCoordinator(c.options), send: () => { if (unavailable) throw Error("no active turn to interrupt"); } });
    h.turn(); const stopping = h.stop(), rejected = assert.rejects(stopping, /timed out/); await flush(); await c.advance(20000); await rejected;
    const count = h.requests.length; h.turn("accepted", "interrupted"); await c.advance(25000); assert.equal(h.requests.length, count); assert.equal(h.updates.length, 0);
  }
});

test("explicit expected ID and non-user paths keep native behavior while start remains pending", async () => {
  for (const [mode, expected] of [["user-stop", "accepted"], ["system", undefined], ["descendant-cleanup", undefined]]) {
    const pending = deferred(), h = harness({ start: () => pending.promise }); h.turn(); const starting = h.start();
    assert.equal(await h.stop(mode, expected), "accepted"); assert.equal(h.requests.length, 1); assert.equal(h.updates[0].before, "inProgress");
    pending.resolve({ turn: { id: "later" } }); await starting;
  }
  const h = harness(); h.turn("newer"); assert.equal(await h.stop("user-stop", "accepted"), null); assert.equal(h.requests.length, 0);
});

test("actual method rejects accepted targets replaced or deferred before native interrupt", async () => {
  for (const [id, status, expectedError] of [["newer", "inProgress", /newer/], ["accepted", "deferred", /deferred/]]) {
    const pending = deferred(), h = harness({ start: () => pending.promise });
    const starting = h.start(), stopping = h.stop(), rejected = assert.rejects(stopping, expectedError);
    await flush(); h.turn(id, status); pending.resolve({ turn: { id: "accepted" } });
    await starting; await rejected; assert.equal(h.requests.length, 0); assert.equal(h.updates.length, 0);
  }
  const pending = deferred(), h = harness({ start: () => pending.promise });
  const starting = h.start(), stopping = h.stop(); await flush(); h.turn("accepted", "completed"); pending.resolve({ turn: { id: "accepted" } });
  await starting; assert.equal(await stopping, null); assert.equal(h.requests.length, 0);
});

test("actual implicit stop rejects deferred and untracked pending snapshots and pins active ID", async () => {
  for (const [id, status, expectedError] of [["accepted", "deferred", /deferred/], [null, "inProgress", /unconfirmed/]]) {
    const h = harness(); h.turn(id, status); await assert.rejects(h.stop(), expectedError); assert.equal(h.requests.length, 0);
  }
  const h = harness({ send: (_, m) => { m.getConversation("thread").turns[0].status = "interrupted"; } });
  h.turn(); const expected = [];
  const original = h.context.LSn;
  h.context.LSn = params => { expected.push(params.expectedTurnId); return original(params); };
  assert.equal(await h.stop(), "accepted"); assert.deepEqual(expected, ["accepted"]);
  const missing = harness(); assert.equal(await missing.stop(), null); assert.equal(missing.requests.length, 0);
});

test("native null result requires matching terminal confirmation for implicit selected turn", async () => {
  const h = harness(); h.turn(); h.context.LSn = async () => null;
  await assert.rejects(h.stop(), /did not confirm/);
  h.context.LSn = async () => { h.turn("accepted", "completed"); return null; };
  assert.equal(await h.stop(), null);
  h.turn(); h.context.LSn = async () => { h.turn("newer"); return null; };
  await assert.rejects(h.stop(), /newer/);
});

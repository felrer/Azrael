"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { QUEUE_CONSUMPTION_ASSET, QUEUE_CONSUMPTION_MARKER, injectQueueConsumption } = require("./inject-queue-consumption.cjs");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const filename = path.join(process.env.AZRAEL_PINNED_HOST_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.928.31416"), QUEUE_CONSUMPTION_ASSET);
const original = fs.readFileSync(filename, "utf8");
const patched = injectQueueConsumption(original).text;
const tick = () => new Promise(resolve => setImmediate(resolve));
const message = id => ({ id, text: "identical input", context: {} });
const ids = items => Array.from(items, item => item.id);

function fixture(source, initial = [message("accepted"), message("next")], history = new Set()) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0);
  let expression;
  function visit(node) {
    if (ts.isBinaryExpression(node) && node.left.getText(ast) === "Mkn" && ts.isClassExpression(node.right)) expression = node.right;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(expression, "pinned coordinator class expression exists");
  class Disposable { constructor(fn) { this.dispose = fn; } }
  const submissionFactory = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "Okn");
  const submissionContext = { ZQ: class extends Error {} };
  const Okn = vm.runInNewContext(`(${source.slice(submissionFactory.getStart(ast), submissionFactory.end)})`, submissionContext);
  const Coordinator = vm.runInNewContext(`(${source.slice(expression.getStart(ast), expression.end)})`, {
    aJ: class {}, Okn, Ye: () => { const disposables = []; return { u: x => disposables.push(x), d() { disposables.reverse().forEach(x => x.dispose()); if (this.e) throw this.e; }, e: null }; }, xX: Disposable, mt: () => ({ u() {}, d() {} }), H: x => x, $Q: [], I6t: () => {}, mt: () => false,
    jkn: "submission-outcome-unknown", de: class extends Error {}, QQ: { default: (x,y) => JSON.stringify(x)===JSON.stringify(y) }, Dn: class extends Error {}, ZQ: class extends Error {}, Ae: class extends Error {}, dkn: () => false,
    d: () => { const disposables = []; return { u: x => disposables.push(x), d() { disposables.reverse().forEach(x => x.dispose()); if (this.e) throw this.e; }, e: null }; },
  });
  let state = { thread: initial }, role = { role: "owner" }, callbacks, broadcastHandler;
  let sendFailure, activeTurn = null, ready = false, canSend = true;
  const writes = [], loads = [], events = [], sends = [], warnings = [], blockedLocks = new Set();
  const execution = {
    subscribe: handlers => { callbacks = handlers; return () => events.push("execution-disposed"); },
    isClientReady: () => ready, canAcquireOwnership: () => true,
    tryAcquireStartTurn: () => { events.push("start-acquired"); return true; },
    releaseStartTurn: () => events.push("start-released"),
    acquireSendLock: async (_thread, id) => { events.push(`lock-acquired:${id}`); return blockedLocks.has(id) ? null : { release: async sent => events.push(`lock-released:${id}:${sent}`) }; },
    errorReason: error => error.message,
    prepare: async (thread, item) => ({ status: "ready", submission: { conversationId: thread, resume: { conversationId: thread }, start: { id: item.id }, steer: { id: item.id } } }),
  };
  const queue = new Coordinator({
    hostId: "local-host", wasMessageAccepted: (_thread, id) => history.has(id), execution: () => execution, getStreamRole: () => role, canSend: () => canSend, isDurableThread: () => false, getMessageQueueMode: () => "steer",
    storage: {
      read: () => ({ isLoading: false, value: state }),
      load: () => new Promise(resolve => loads.push({ resolve })),
      update: transform => new Promise((resolve, reject) => writes.push({ transform, resolve: () => { state = transform(state); events.push("storage-committed"); resolve(); }, reject })),
    },
    coordination: { registerBroadcastHandler: handler => { broadcastHandler = handler; return () => events.push("broadcast-disposed"); }, broadcast: async () => {} },
    logger: { error: (...args) => warnings.push(args), warning: (...args) => warnings.push(args) },
    submissionHost: {
      needsResume: () => false, getActiveTurnId: () => activeTurn, hasPendingTurnStart: () => false,
      canStartAfterSteerError: () => false, hasFinalAnswer: () => false,
      start: async (_thread, input, _onMessageAdded, beforeSend) => { await beforeSend?.(); sends.push(input.id); events.push(`accepted:${input.id}`); if (sendFailure) throw sendFailure; return "turn"; },
      steer: async (_thread, input, _onMessageAdded, beforeSend) => { await beforeSend?.(); sends.push(input.id); if (sendFailure) throw sendFailure; return "turn"; },
    },
  });
  return {
    queue, writes, loads, events, sends, warnings, blockedLocks,
    send: (id = "accepted", thread = "thread") => queue.sendQueuedMessageNow(thread, id, {}, async request => ({ conversationId: thread, resume: { conversationId: thread }, start: { id: request.message.id }, steer: { id: request.message.id } })),
    changed: () => callbacks.changed(), completed: () => callbacks.turnCompleted({ conversationId: "thread", status: "completed" }), setRole: value => { role = value; },
    broadcast: (items, thread = "thread") => broadcastHandler({ params: { conversationId: thread, messages: items }, sourceClientId: "owner-client" }),
    setState: value => { state = value; }, setFailure: value => { sendFailure = value; },
    setCanSend: value => { canSend = value; }, setActive: value => { activeTurn = value; }, setReady: value => { ready = value; },
  };
}

async function finishWrite(f) {
  await tick(); assert.equal(f.writes.length, 1); f.writes[0].resolve(); await tick();
}

test("original coordinator releases send lock while accepted removal is still pending", async () => {
  const f = fixture(original), sending = f.send(); await tick();
  assert.equal(f.writes.length, 1);
  assert.ok(f.events.includes("lock-released:accepted:true"));
  assert.ok(!f.events.includes("storage-committed"));
  assert.equal((await sending).status, "sent");
  f.writes[0].resolve(); await tick(); f.queue.dispose();
});

test("original coordinator republishes accepted ID from a stale storage snapshot", async () => {
  const f = fixture(original), sending = f.send(); await finishWrite(f); await sending;
  assert.deepEqual(f.sends, ["accepted"]);
  assert.deepEqual(ids(f.queue.readMessages("thread")), ["next"]);
  const stale = [message("accepted"), message("next")];
  f.setState({ thread: stale }); f.loads[0].resolve({ thread: stale }); await tick();
  assert.deepEqual(ids(f.queue.readMessages("thread")), ["accepted", "next"]);
  f.queue.dispose();
});

test("patched coordinator persists accepted ID removal before releasing both locks", async () => {
  const f = fixture(patched); let finished = false;
  const sending = f.send().then(result => { finished = true; return result; }); await tick();
  assert.deepEqual(ids(f.queue.readMessages("thread")), ["next"]);
  assert.equal(finished, false); assert.ok(!f.events.some(x => x.startsWith("lock-released")));
  assert.ok(!f.events.includes("start-released"));
  await finishWrite(f); assert.equal((await sending).status, "sent");
  assert.ok(f.events.indexOf("storage-committed") < f.events.indexOf("lock-released:accepted:true"));
  assert.ok(f.events.indexOf("lock-released:accepted:true") < f.events.indexOf("start-released"));
  f.queue.dispose();
});

test("stale storage refresh cannot resurrect or resend accepted ID; identical text new ID survives", async () => {
  const f = fixture(patched), sending = f.send(); await finishWrite(f); await sending;
  assert.equal(f.loads.length, 1);
  const stale = [message("accepted"), message("next"), message("same-text-new-id")];
  f.setState({ thread: stale }); f.loads[0].resolve({ thread: stale }); await tick();
  assert.deepEqual(ids(f.queue.readMessages("thread")), ["next", "same-text-new-id"]);
  assert.deepEqual(ids(f.queue.readState().thread), ["next", "same-text-new-id"]);
  assert.equal(await f.send(), null); assert.deepEqual(f.sends, ["accepted"]);
  f.queue.dispose();
});

test("accepted submission remains sent when persistence fails and stale state cannot resend it", async () => {
  const f = fixture(patched), sending = f.send(); await tick();
  assert.equal(f.writes.length, 1);
  assert.ok(!f.events.some(x => x.startsWith("lock-released")));
  f.writes[0].reject(new Error("storage unavailable"));
  assert.equal((await sending).status, "sent"); await tick();
  assert.ok(f.warnings.some(args => args[0] === "Failed to execute queued message" && args[1].sensitive.error.message === "storage unavailable"));
  assert.ok(f.events.includes("lock-released:accepted:true"));
  assert.deepEqual(ids(f.queue.readMessages("thread")), ["next"]);
  assert.deepEqual(ids(f.queue.readState().thread), ["next"]);
  f.setState({ thread: [message("accepted"), message("next")] });
  assert.deepEqual(ids(f.queue.readMessages("thread")), ["next"]);
  assert.deepEqual(ids(f.queue.readState().thread), ["next"]);
  f.setRole({ role: "follower", ownerClientId: "owner-client" });
  f.broadcast([message("accepted"), message("next")]);
  assert.deepEqual(ids(f.queue.readMessages("thread")), ["next"]);
  assert.deepEqual(ids(f.queue.readState().thread), ["next"]);
  assert.equal(await f.send(), null); assert.deepEqual(f.sends, ["accepted"]);
  f.queue.dispose();
});

test("stale follower broadcast during pending removal and later broadcast filter accepted ID", async () => {
  const f = fixture(patched), sending = f.send(); await tick();
  f.setRole({ role: "follower", ownerClientId: "owner-client" });
  const stale = [message("accepted"), message("same-text-new-id")]; f.broadcast(stale);
  f.writes[0].resolve(); await sending; await tick();
  assert.deepEqual(ids(f.queue.readMessages("thread")), ["same-text-new-id"]);
  f.broadcast(stale); assert.deepEqual(ids(f.queue.readMessages("thread")), ["same-text-new-id"]);
  assert.equal(await f.send(), null); assert.deepEqual(f.sends, ["accepted"]);
  f.queue.dispose();
});

test("failed send leaves ID eligible and persists its pause reason", async () => {
  const f = fixture(patched); f.setFailure(new Error("host rejected submission"));
  await assert.rejects(f.send(), /host rejected submission/); await tick();
  assert.deepEqual(ids(f.queue.readMessages("thread")), ["accepted", "next"]);
  assert.equal(f.queue.readMessages("thread")[0].pausedReason, "host rejected submission");
  assert.ok(f.events.includes("lock-released:accepted:false"));
  f.writes[0].resolve(); await tick(); f.queue.dispose();
});

test("deferred automatic admission leaves message eligible without storage consumption", async () => {
  const f = fixture(patched); await f.queue.executionReady; await f.queue.loadMessages("thread");
  f.setActive("active-turn"); f.setReady(true); f.queue.executionChanged(); await tick();
  assert.deepEqual(f.sends, []); assert.equal(f.writes.length, 0);
  assert.deepEqual(ids(f.queue.readMessages("thread")), ["accepted", "next"]);
  assert.ok(f.events.includes("lock-released:accepted:false")); f.queue.dispose();
});

test("accepted receipts are scoped by conversation ID and disposal clears them", async () => {
  const f = fixture(patched), sending = f.send(); await finishWrite(f); await sending;
  f.setState({ thread: [message("accepted")], other: [message("accepted")] });
  assert.deepEqual(ids(f.queue.readMessages("other")), ["accepted"]);
  f.queue.dispose(); assert.equal(f.queue.__azraelAccepted.size, 0);
  assert.ok(f.events.includes("execution-disposed")); assert.ok(f.events.includes("broadcast-disposed"));
  f.loads[0].resolve({ thread: [message("accepted")] }); await tick(); assert.equal(f.queue.messages.size, 0);
});

test("injection is idempotent and fails closed for absent, repeated, and partial anchors", () => {
  assert.deepEqual(injectQueueConsumption(patched), { text: patched, count: 0 });
  assert.throws(() => injectQueueConsumption("changed host"), /anchor/);
  assert.throws(() => injectQueueConsumption(original + original), /anchor/);
  assert.throws(() => injectQueueConsumption(original.replace("#v(e,t){this.messages.set(e,{messages:t,refreshing:!1})", "changed-anchor")), /anchor/);
  assert.throws(() => injectQueueConsumption(patched + QUEUE_CONSUMPTION_MARKER), /Duplicate/);
  assert.throws(() => injectQueueConsumption(patched.replace("async __azraelConsume", "async brokenConsume")), /Partial/);
  assert.throws(() => injectQueueConsumption(original.replace("Mkn=class extends aJ{", "Mkn=class extends aJ{/*azrael-queue-consumption-v1*/")), /Outdated/);
});



const localMessage = (id, status = "pending", pausedReason) => ({ ...message(id), submission: { hostId: "local-host", status }, ...(pausedReason == null ? {} : { pausedReason }) });

for (const status of ["pending", "queued", "sending", "outcome-unknown"]) {
  test(`history-confirmed ${status} is consumed before send lock and next completion progresses`, async () => {
    const f = fixture(patched, [localMessage("accepted", status), message("next")], new Set(["accepted"]));
    f.blockedLocks.add("accepted");
    await f.queue.executionReady; await f.queue.loadMessages("thread");
    f.setReady(true); f.completed(); await tick();
    assert.deepEqual(f.sends, []);
    assert.ok(!f.events.some(event => event.startsWith("lock-acquired:")));
    assert.deepEqual(ids(f.queue.readMessages("thread")), ["next"]);
    await finishWrite(f);
    assert.equal(f.loads.length, 1);
    f.loads[0].resolve({ thread: [message("next")] }); await tick();
    assert.deepEqual(f.sends, ["next"]);
    assert.equal(f.writes.length, 2); f.writes[1].resolve(); await tick();
    assert.ok(!f.events.some(event => event.startsWith("lock-released:accepted:")));
    assert.deepEqual(ids(f.queue.readMessages("thread")), []);
    f.queue.dispose();
  });
}

for (const status of ["pending", "queued"]) {
  test(`paused ${status} reconciles only when history confirms acceptance`, async () => {
    const accepted = fixture(patched, [localMessage("accepted", status, "paused")], new Set(["accepted"]));
    const unaccepted = fixture(patched, [localMessage("accepted", status, "paused")]);
    for (const f of [accepted, unaccepted]) {
      f.setCanSend(false);
      await f.queue.executionReady; await f.queue.loadMessages("thread");
      f.setReady(true); f.completed(); await tick();
      assert.deepEqual(f.sends, []);
      assert.ok(!f.events.some(event => event.startsWith("lock-acquired:")));
    }
    assert.deepEqual(ids(accepted.queue.readMessages("thread")), []);
    await finishWrite(accepted);
    assert.equal(unaccepted.writes.length, 0);
    assert.equal(unaccepted.queue.readMessages("thread")[0].pausedReason, "paused");
    accepted.queue.dispose(); unaccepted.queue.dispose();
  });
}

async function metadataSend(f, failRemoval = false) {
  const sending = f.send(); await tick();
  assert.equal(f.writes.length, 1); // Persist sending before native dispatch.
  f.writes[0].resolve(); await tick();
  assert.deepEqual(f.sends, ["accepted"]);
  assert.equal(f.writes.length, 2);
  assert.ok(!f.events.some(event => event.startsWith("lock-released:")));
  if (failRemoval) f.writes[1].reject(new Error("storage unavailable"));
  else f.writes[1].resolve();
  assert.equal((await sending).status, "sent"); await tick();
}

test("metadata native success awaits ID removal and filters stale storage and broadcasts", async () => {
  const f = fixture(patched, [localMessage("accepted"), message("next")]);
  await metadataSend(f);
  assert.ok(f.events.indexOf("storage-committed", f.events.indexOf("accepted:accepted")) < f.events.indexOf("lock-released:accepted:true"));
  const stale = [localMessage("accepted"), message("same-text-new-id")];
  f.setState({ thread: stale }); f.loads[0].resolve({ thread: stale }); await tick();
  assert.deepEqual(ids(f.queue.readMessages("thread")), ["same-text-new-id"]);
  f.setRole({ role: "follower", ownerClientId: "owner-client" }); f.broadcast(stale);
  assert.deepEqual(ids(f.queue.readMessages("thread")), ["same-text-new-id"]);
  assert.deepEqual(ids(f.queue.readState().thread), ["same-text-new-id"]);
  assert.equal(await f.send(), null); assert.deepEqual(f.sends, ["accepted"]);
  f.queue.dispose();
});

test("metadata persistence failure preserves native sent outcome without replay or pause rewrite", async () => {
  const f = fixture(patched, [localMessage("accepted"), message("next")]);
  await metadataSend(f, true);
  assert.equal(f.writes.length, 2);
  assert.ok(f.events.includes("lock-released:accepted:true"));
  assert.ok(f.warnings.some(args => args[1]?.sensitive?.error?.message === "storage unavailable"));
  const stale = [localMessage("accepted"), message("same-text-new-id")];
  f.setState({ thread: stale }); f.loads[0].resolve({ thread: stale }); await tick();
  f.setRole({ role: "follower", ownerClientId: "owner-client" }); f.broadcast(stale);
  assert.deepEqual(ids(f.queue.readMessages("thread")), ["same-text-new-id"]);
  assert.equal(await f.send(), null); assert.deepEqual(f.sends, ["accepted"]);
  f.queue.dispose();
});

test("history cleanup persistence failure registers receipt without claiming a host send", async () => {
  const f = fixture(patched, [localMessage("accepted")], new Set(["accepted"]));
  await f.queue.executionReady; await f.queue.loadMessages("thread"); f.setReady(true); f.completed(); await tick();
  f.writes[0].reject(new Error("storage unavailable")); await tick();
  assert.deepEqual(f.sends, []); assert.equal(f.writes.length, 1);
  assert.ok(!f.events.some(event => event.startsWith("lock-acquired:") || event.startsWith("lock-released:")));
  f.setReady(false);
  const stale = [localMessage("accepted"), message("same-text-new-id")];
  f.setState({ thread: stale });
  f.setRole({ role: "follower", ownerClientId: "owner-client" }); f.broadcast(stale);
  assert.deepEqual(ids(f.queue.readMessages("thread")), ["same-text-new-id"]);
  assert.equal(await f.send(), null); assert.deepEqual(f.sends, []);
  f.queue.dispose();
});

test("server queue client ID receipt consumes local pending metadata without host dispatch", async () => {
  const f = fixture(patched, [localMessage("accepted")]);
  f.queue.serverQueue = { findByClientMessageId: (_thread, id) => id === "accepted" ? "server-id" : null, isEnabled: () => false, dispose() {} };
  await f.queue.executionReady; await f.queue.loadMessages("thread"); f.setReady(true); f.completed(); await tick();
  assert.deepEqual(f.sends, []); assert.ok(!f.events.some(event => event.startsWith("lock-acquired:")));
  await finishWrite(f); assert.deepEqual(ids(f.queue.readMessages("thread")), []);
  f.setReady(false);
  const stale = [localMessage("accepted"), message("same-text-new-id")];
  f.setState({ thread: stale }); f.loads[0].resolve({ thread: stale }); await tick();
  assert.deepEqual(ids(f.queue.readMessages("thread")), ["same-text-new-id"]);
  f.queue.dispose();
});

test("native serverAccepted result registers local receipt and awaits persisted ID removal", async () => {
  const f = fixture(patched, [localMessage("accepted")]);
  f.queue.submission.sendMessage = async () => ({ status: "queued", messageId: "accepted", serverAccepted: true });
  const sending = f.send(); await tick();
  assert.equal(f.writes.length, 1); assert.deepEqual(ids(f.queue.readMessages("thread")), []);
  assert.ok(!f.events.some(event => event.startsWith("lock-released:")));
  f.writes[0].resolve(); assert.equal(await sending, null); await tick();
  assert.ok(f.events.includes("lock-released:accepted:true"));
  f.setReady(false);
  const stale = [localMessage("accepted"), message("same-text-new-id")];
  f.setState({ thread: stale }); f.loads[0].resolve({ thread: stale }); await tick();
  assert.deepEqual(ids(f.queue.readMessages("thread")), ["same-text-new-id"]);
  f.queue.dispose();
});

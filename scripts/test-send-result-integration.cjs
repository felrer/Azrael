"use strict";

const assert = require("node:assert/strict");
const vs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const cm = require("node:vm");
const util = require("node:util");
const { COMPOSER_DRAFT_ASSET, injectComposerDraft } = require("./inject-composer-draft.cjs");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { RecoveryState } = require("./recovery-state.cjs");
const { QUEUE_CONSUMPTION_ASSET, injectQueueConsumption } = require("./inject-queue-consumption.cjs");
const hostRoot = process.env.AZRAEL_PINNED_HOST_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.930.61225");
const tick = () => new Promise(resolve => setImmediate(resolve));

function parse(filename) {
  const source = vs.readFileSync(filename, "utf8");
  const Ost = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(Ost.parseDiagnostics.length, 0);
  return { source, Ost };
}

function requestClient() {
  const { Ost } = parse(path.join(hostRoot, "webview/assets/app-initial-532d60c9b397.js"));
  const methods = new Map();
  function visit(node) {
    if (ts.isMethodDeclaration(node) && ["onDelivery", "onResult"].includes(node.name?.getText(Ost))) {
      assert.ok(!methods.has(node.name.getText(Ost)), "request client method is unique");
      methods.set(node.name.getText(Ost), node.getText(Ost));
    }
    ts.forEachChild(node, visit);
  }
  visit(Ost);
  assert.equal(methods.size, 2);
  const logs = [], events = [];
  const Client = cm.runInNewContext(`(class {${[...methods.values()].join("\n")}})`, {
    ly: id => id, DE: class extends Error {}, Gx() {},
    mp: { debug() {}, warning: (...args) => logs.push(args), error: (...args) => logs.push(args) },
  });
  const client = new Client();
  client.requestPromises = new Map();
  client.hostId = "fixture-host";
  client.clearRequestTimeout = () => {};
  client.releaseRequestCapacity = () => {};
  client.emitRequestLifecycleEvent = event => events.push(event);
  client.onError = () => assert.fail("outcome-unknown must not reject the original request");
  let resolves = 0, unknowns = 0;
  const promise = new Promise(resolve => client.requestPromises.set("original-request", {
    method: "turn/start", clientUserMessageId: "queued-item", queuedAtMs: Date.now(),
    onOutcomeUnknown: () => { unknowns += 1; },
    resolve: result => { resolves += 1; resolve(result); },
  }));
  return { client, promise, logs, events, resolves: () => resolves, unknowns: () => unknowns };
}

test("pinned request client retains outcome-unknown promise and resolves reconciled result once", async () => {
  const f = requestClient();
  let settled = false;
  f.promise.then(() => { settled = true; });
  const event = { type: "outcome-unknown", delivery: { requestId: "original-request" } };
  f.client.onDelivery(event);
  f.client.onDelivery(event);
  await tick();
  assert.equal(settled, false);
  assert.equal(f.client.requestPromises.size, 1);
  assert.equal(f.unknowns(), 1);
  const result = { turn: { id: "matched-turn", status: "completed" } };
  f.client.onResult("original-request", result);
  assert.equal(await f.promise, result);
  assert.equal(f.resolves(), 1);
  assert.equal(f.client.requestPromises.size, 0);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].type, "completed");
  assert.deepEqual(f.logs, []);
});

const queueAstCache = new Map();
function queueFixture(initial) {
  // Reuse the existing test's AST extraction and minimal coordinator adapters.
  // Its fixture executes the pinned class and submission factory, not replicas.
  const filename = path.join(hostRoot, QUEUE_CONSUMPTION_ASSET);
  const { source, Ost } = parse(path.join(__dirname, "test-queue-consumption.cjs"));
  const declaration = Ost.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "fixture");
  assert.ok(declaration);
  const fixture = cm.runInNewContext(`(${source.slice(declaration.getStart(Ost), declaration.end)})`, {
    assert, ts, vm: cm, astCache: queueAstCache, filename, message: id => ({ id, text: "identical input", context: {} }),
  });
  return fixture(injectQueueConsumption(vs.readFileSync(filename, "utf8")).text, initial);
}

function composerFixture(options) {
  const product = injectComposerDraft(vs.readFileSync(path.join(hostRoot, COMPOSER_DRAFT_ASSET), "utf8")).text;
  const Ost = ts.createSourceFile("composer.js", product, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declarations = new Map(Ost.statements.filter(ts.isFunctionDeclaration).map(node => [node.name.text, node.getText(Ost)]));
  const testSource = parse(path.join(__dirname, "test-composer-draft.cjs"));
  const factory = testSource.Ost.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "fixture");
  const fixture = cm.runInNewContext(`(${factory.getText(testSource.Ost)})`, { pm: cm, assert, util, declarations, performance });
  return fixture(options);
}

for (const failure of ["preparation", "not-sent", "outcome-unknown", "storage"]) {
  test(`composer and local coordinator preserve follow-up custody on ${failure}`, async () => {
    const q = queueFixture([]);
    q.setReady(true);
    if (failure === "preparation") q.setPrepareFailure(Error("preparation rejected"));
    if (["not-sent", "outcome-unknown"].includes(failure)) q.setFailure(new q.DeliveryError(failure));
    let result;
    const f = composerFixture({ submission: async (composer, args) => {
      const item = args[4];
      assert.ok(item?.id, "actual composer constructs the follow-up identity");
      result = await q.queue.sendMessage({ conversationId: "thread", message: item, acceptLocally: true },
        async request => {
          if (failure === "preparation") throw Error("preparation rejected");
          return { conversationId: "thread", resume: { conversationId: "thread" },
            start: { id: request.message.id }, steer: { id: request.message.id } };
        }, flags => composer.added(flags));
      return { messageResult: result };
    } });
    let done = false, written = 0;
    const running = f.run().finally(() => { done = true; });
    try {
      for (let step = 0; step < 60 && !done; step++) {
        await tick(); q.flushLoads();
        while (written < q.writes.length) {
          const index = written++, write = q.writes[index];
          failure === "storage" && index === 0 ? write.reject(Error("storage unavailable")) : write.resolve();
        }
      }
      assert.equal(done, true, "submission completes rather than disappearing behind a pending promise");
      await running;
      if (failure === "storage") {
        assert.equal(f.text(), "A"); assert.equal(f.clears(), 0);
        assert.equal(f.errors.length, 1); assert.equal(q.sends.length, 0);
      } else {
        assert.equal(result.status, "queued");
        assert.equal(f.errors.length, 0); assert.equal(f.text(), ""); assert.equal(f.restores(), 0);
        const messages = Array.from(q.queue.readMessages("thread"));
        assert.equal(messages.length, 1); assert.equal(messages[0].id, result.messageId);
        assert.equal(messages[0].text, "A"); assert.ok(messages[0].pausedReason);
        assert.equal(messages[0].submission.status, failure === "outcome-unknown" ? "outcome-unknown" : "queued");
        assert.equal(q.sends.length, failure === "preparation" ? 0 : 1);
        const sends = Array.from(q.sends);
        q.changed(); q.completed(); await tick();
        assert.deepEqual(Array.from(q.sends), sends, "paused or uncertain input must not automatically replay");
      }
    } finally { q.queue.dispose(); }
  });
}

for (const continuing of [false, true, "steer"]) {
  test(`pinned queue consumes ${continuing === "steer" ? "steering" : continuing ? "continuation" : "ordinary"} reconciled send once`, async () => {
    const q = queueFixture(), client = requestClient(), calls = [], receipts = [];
    const method = continuing === "steer" ? "turn/steer" : "turn/start";
    client.client.requestPromises.get("original-request").method = method;
    const turn = { id: "reconciled-turn", status: "completed",
      items: [{ type: "userMessage", clientId: "accepted" }] };
    const state = new RecoveryState({ store: { get: () => [], update: async (_key, records) => receipts.push(records) },
      rpc: async (method, params) => {
        calls.push({ method, params });
        if (method === "thread/read") return { thread: { id: "thread", status: { type: "idle" } } };
        if (method === "thread/turns/list") return { data: params.itemsView === "full" ? [turn] : [] };
        if (method === (continuing === "steer" ? "turn/steer" : "turn/start")) {
          client.client.onDelivery({ type: "outcome-unknown", delivery: { requestId: "original-request" } });
          assert.equal(client.client.requestPromises.size, 1);
          throw new Error("fixture acknowledgement timeout");
        }
        throw new Error(`Unexpected RPC: ${method}`);
      } });
    q.queue.options.submissionHost.start = async (threadId, input) => {
      q.sends.push(input.id);
      const params = { threadId, clientUserMessageId: input.id,
        ...(continuing === "steer" ? { expectedTurnId: "parked-turn" } : {}),
        input: [{ type: "text", text: continuing === true ? "continue" : "new instruction" }] };
      const pending = continuing === "steer" ? state.steer(params) : state.start(params);
      const result = await pending;
      client.client.onResult("original-request", result);
      const accepted = await client.promise;
      return continuing === "steer" ? accepted.turnId : accepted.turn.id;
    };
    try {
      const sending = q.send();
      await tick();
      assert.equal(q.writes.length, 1);
      assert.equal(state.list()[0].phase, "completed");
      assert.deepEqual(Array.from(q.queue.readMessages("thread"), item => item.id), ["next"]);
      q.writes[0].resolve();
      assert.equal((await sending).status, "sent");
      await tick();
      // Explicit sends await the fixture's pending storage reload; deliver its
      // stale snapshot before checking that the accepted item cannot resend.
      q.loads[0].resolve({ thread: [{ id: "accepted", text: "identical input", context: {} }, { id: "next", text: "identical input", context: {} }] });
      await tick();
      assert.equal(await q.send(), null);
      assert.deepEqual(Array.from(q.sends), ["accepted"]);
      assert.equal(calls.filter(call => call.method === method).length, 1);
      if (continuing === "steer") {
        assert.equal(calls.find(call => call.method === method).params.expectedTurnId, "parked-turn");
        assert.equal(receipts.length, 0);
      }
      assert.equal(calls.filter(call => call.method === "thread/turns/list" && call.params.itemsView === "full").length, 1);
      assert.equal(client.resolves(), 1);
      assert.equal(client.unknowns(), 1);
      assert.deepEqual(client.logs, []);
      assert.equal(client.client.requestPromises.size, 0);
      if (continuing === true) assert.equal(receipts.at(-1)[0].phase, "finished");
      assert.deepEqual(Array.from(q.queue.readMessages("thread"), item => item.id), ["next"]);
    } finally { q.queue.dispose(); }
  });
}

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { RecoveryState } = require("./recovery-state.cjs");
const { QUEUE_CONSUMPTION_ASSET, injectQueueConsumption } = require("./inject-queue-consumption.cjs");
const hostRoot = process.env.AZRAEL_PINNED_HOST_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.928.31416");
const tick = () => new Promise(resolve => setImmediate(resolve));

function parse(filename) {
  const source = fs.readFileSync(filename, "utf8");
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0);
  return { source, ast };
}

function requestClient() {
  const { ast } = parse(path.join(hostRoot, "webview/assets/app-initial-9cbfb5c07b41.js"));
  const methods = new Map();
  function visit(node) {
    if (ts.isMethodDeclaration(node) && ["onDelivery", "onResult"].includes(node.name?.getText(ast))) {
      assert.ok(!methods.has(node.name.getText(ast)), "request client method is unique");
      methods.set(node.name.getText(ast), node.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(methods.size, 2);
  const logs = [], events = [];
  const Client = vm.runInNewContext(`(class {${[...methods.values()].join("\n")}})`, {
    Xv: id => id, ME: class extends Error {}, hx() {},
    t_: { debug() {}, warning: (...args) => logs.push(args), error: (...args) => logs.push(args) },
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

function queueFixture() {
  // Reuse the existing test's AST extraction and minimal coordinator adapters.
  // Its fixture executes the pinned class and submission factory, not replicas.
  const filename = path.join(hostRoot, QUEUE_CONSUMPTION_ASSET);
  const { source, ast } = parse(path.join(__dirname, "test-queue-consumption.cjs"));
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "fixture");
  assert.ok(declaration);
  const fixture = vm.runInNewContext(`(${source.slice(declaration.getStart(ast), declaration.end)})`, {
    assert, ts, vm, filename, message: id => ({ id, text: "identical input", context: {} }),
  });
  return fixture(injectQueueConsumption(fs.readFileSync(filename, "utf8")).text);
}

for (const continuing of [false, true]) {
  test(`pinned queue consumes ${continuing ? "continuation" : "ordinary"} reconciled send once`, async () => {
    const q = queueFixture(), client = requestClient(), calls = [], receipts = [];
    const turn = { id: "reconciled-turn", status: "completed",
      items: [{ type: "userMessage", clientId: "accepted" }] };
    const state = new RecoveryState({ store: { get: () => [], update: async (_key, records) => receipts.push(records) },
      rpc: async (method, params) => {
        calls.push({ method, params });
        if (method === "thread/read") return { thread: { id: "thread", status: { type: "idle" } } };
        if (method === "thread/turns/list") return { data: params.itemsView === "full" ? [turn] : [] };
        if (method === "turn/start") {
          client.client.onDelivery({ type: "outcome-unknown", delivery: { requestId: "original-request" } });
          assert.equal(client.client.requestPromises.size, 1);
          throw new Error("fixture acknowledgement timeout");
        }
        throw new Error(`Unexpected RPC: ${method}`);
      } });
    q.queue.options.submissionHost.start = async (threadId, input) => {
      q.sends.push(input.id);
      const pending = state.start({ threadId, clientUserMessageId: input.id,
        input: [{ type: "text", text: continuing ? "continue" : "new instruction" }] });
      const result = await pending;
      client.client.onResult("original-request", result);
      return (await client.promise).turn.id;
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
      assert.equal(calls.filter(call => call.method === "turn/start").length, 1);
      assert.equal(calls.filter(call => call.method === "thread/turns/list" && call.params.itemsView === "full").length, 1);
      assert.equal(client.resolves(), 1);
      assert.equal(client.unknowns(), 1);
      assert.deepEqual(client.logs, []);
      assert.equal(client.client.requestPromises.size, 0);
      if (continuing) assert.equal(receipts.at(-1)[0].phase, "finished");
      assert.deepEqual(Array.from(q.queue.readMessages("thread"), item => item.id), ["next"]);
    } finally { q.queue.dispose(); }
  });
}

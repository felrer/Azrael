"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { QUEUE_REFRESH_ASSET, injectQueueRefresh } = require("./inject-queue-refresh.cjs");
const { rewriteJavaScript } = require("./namespace-azrael-host.cjs");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const filename = path.join(process.env.AZRAEL_PINNED_HOST_ROOT ??
  path.join(__dirname, "../artifacts/upstream-ui/26.928.31416"), QUEUE_REFRESH_ASSET);
const original = fs.readFileSync(filename, "utf8");
const patched = injectQueueRefresh(rewriteJavaScript(original, filename, ts).text).text;

function fixture(source) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0);
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "I9t");
  assert.ok(node);
  const factory = vm.runInNewContext(`(${source.slice(node.getStart(ast), node.end)})`, {
    Zv: x => x, aO: () => false, J_: () => true, Ry: () => true, h_: x => x, sve: () => null, L9t: (_manager, _thread, item) => ({ id: item.id }),
    cO: { default: (a, b) => JSON.stringify(a) === JSON.stringify(b) }, t_: { warning() {} },
  });
  const requests = [], snapshots = [];
  let notify;
  const queue = factory({ scope: {}, appServerVersion: () => "test", manager: {
    getHostId: () => "local", getConversation: () => null,
    addNotificationCallback: (_method, callback) => { notify = callback; return () => {}; },
    sendRequest: (method, params) => new Promise((resolve, reject) => requests.push({ method, params, resolve, reject })),
  } });
  queue.subscribe(id => snapshots.push(Array.from(queue.read(id), x => x.id)));
  return { queue, requests, snapshots, notify: (id = "thread") => notify({ params: { threadId: id } }) };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const page = (...ids) => ({ data: ids.map(id => ({ id })), nextCursor: null });

test("notifications during load coalesce and discard stale snapshot, preserving unsent message", async () => {
  const f = fixture(patched), loading = f.queue.load("thread");
  f.notify(); f.notify(); f.requests[0].resolve(page("consumed", "pending")); await tick();
  assert.equal(f.requests.length, 2); assert.deepEqual(f.snapshots, []);
  f.requests[1].resolve(page("pending")); await loading; await tick();
  assert.deepEqual(f.snapshots, [["pending"]]);
  assert.equal(f.requests.length, 2);
});

test("notification on a later page restarts pagination from the beginning", async () => {
  const f = fixture(patched), loading = f.queue.load("thread");
  f.requests[0].resolve({ data: [{ id: "consumed" }], nextCursor: "next" }); await tick();
  assert.equal(f.requests[1].params.cursor, "next"); f.notify();
  f.requests[1].resolve(page("pending")); await tick();
  assert.equal(f.requests[2].params.cursor, null);
  f.requests[2].resolve(page("pending")); await loading;
  assert.deepEqual(f.snapshots, [["pending"]]);
});

test("failure releases in-flight state and a later notification retries", async () => {
  const f = fixture(patched), loading = f.queue.load("thread");
  f.notify(); f.requests[0].reject(new Error("list failed"));
  await assert.rejects(loading, /list failed/); await tick(); f.notify();
  assert.equal(f.requests.length, 2); f.requests[1].resolve(page()); await tick();
  assert.deepEqual(f.snapshots, [[]]);
});

test("disposal suppresses publication and invalidated retry", async () => {
  const f = fixture(patched), loading = f.queue.load("thread");
  f.notify(); f.queue.dispose(); f.requests[0].resolve(page("consumed")); await loading;
  assert.equal(f.requests.length, 1); assert.deepEqual(f.snapshots, []);
});

test("native refresh validation does not modify source and refuses missing or duplicate anchors", () => {
  assert.deepEqual(injectQueueRefresh(patched), { text: patched, count: 0, nativeChecks: 1 });
  assert.throws(() => injectQueueRefresh("changed host"), /anchor/);
  assert.throws(() => injectQueueRefresh(original + original), /anchor/);
});


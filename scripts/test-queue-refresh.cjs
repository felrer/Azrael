"use strict";
const assert = require("node:assert/strict");
const hs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const pm = require("node:vm");
const { QUEUE_REFRESH_ASSET, injectQueueRefresh } = require("./inject-queue-refresh.cjs");
const { rewriteJavaScript } = require("./namespace-azrael-host.cjs");
const { injectAccountSwitchQueue } = require("./inject-account-switch-queue.cjs");
const { QUESTION_QUEUE_ASSETS, QUESTION_QUEUE_CORE_ASSET, QUESTION_QUEUE_LIST_ASSET, injectQuestionQueue, questionQueueEditsFor } = require("./inject-question-queue.cjs");
const { injectQueueConsumption } = require("./inject-queue-consumption.cjs");
const { injectQueuedCompactionList } = require("./inject-queued-compaction.cjs");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const filename = path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? process.env.AZRAEL_PINNED_HOST_ROOT ??
  path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.1007.21434")), QUEUE_REFRESH_ASSET);
const original = hs.readFileSync(filename, "utf8");
const patched = injectQueueRefresh(rewriteJavaScript(original, filename, ts).text).text;

function fixture(source) {
  const Cst = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(Cst.parseDiagnostics.length, 0);
  const node = Cst.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "vsn");

  const factory = pm.runInNewContext(`(${source.slice(node.getStart(Cst), node.end)})`, {
    Nv: x => x, AE: () => false, Gf: () => true, Sy: () => true, Qx: x => x, nt: () => null, ysn: (_manager, _thread, item) => ({ id: item.id }),
    RD: { default: (a, b) => JSON.stringify(a) === JSON.stringify(b) }, Uh: { warning() {} },
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





test("account validation retains exact question and approval boundaries in core and list composition", () => {
  for (const asset of [QUESTION_QUEUE_CORE_ASSET, QUESTION_QUEUE_LIST_ASSET]) {
    const source = hs.readFileSync(path.join(path.dirname(path.dirname(path.dirname(filename))), asset), "utf8");
    const prepared = asset === QUESTION_QUEUE_CORE_ASSET ? injectQueueConsumption(source).text : injectQueuedCompactionList(source).text;
    const account = injectAccountSwitchQueue(prepared, asset).text;
    const composed = injectQuestionQueue(account, asset).text;
    assert.equal(injectAccountSwitchQueue(composed, asset).text, composed);
    assert.equal(injectQuestionQueue(composed, asset).text, composed);
    const marker = `/*azrael-question-queue-${QUESTION_QUEUE_ASSETS.indexOf(asset)}-v1*/`;
    for (const damaged of [composed.replace(marker, ""), composed + marker,
      ...questionQueueEditsFor(asset).flatMap(([anchor, replacement]) => [composed.replace(replacement, anchor), composed + replacement]),
    ]) assert.throws(() => injectAccountSwitchQueue(damaged, asset), /question queue/);
  }
});

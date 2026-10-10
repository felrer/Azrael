"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { ACCOUNT_QUEUE_CORE_ASSET: core, ACCOUNT_QUEUE_PRESENTATION_ASSET: presentation, ACCOUNT_QUEUE_LIST_ASSET: list, injectAccountSwitchQueue } = require("./inject-account-switch-queue.cjs");
const { injectQueuedCompactionPresentation, injectQueuedCompactionList } = require("./inject-queued-compaction.cjs");
const root = path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.1007.21434"));
const source = asset => fs.readFileSync(path.join(root, asset), "utf8");
const transformed = injectAccountSwitchQueue(source(core), core).text;
const ast = ts.createSourceFile(core, transformed, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === "ajn").getText(ast);
const creationGuard = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === "__azraelCreateAfterAccountChange").getText(ast);
const preparedSource = asset => asset === list ? injectQueuedCompactionList(source(asset)).text : source(asset);

function fixture({ pending = false, mode = "queue", error, queryError, activeTurnId = null } = {}) {
  const calls = [];
  const context = vm.createContext({ P1: Error, Oe: Error, Nt: () => false, qt: value => value });
  vm.runInContext(declaration + ";globalThis.create = ajn", context);
  const host = {
    accountChangePending: async () => { calls.push("query"); if (queryError) throw queryError; return pending; },
    needsResume: () => false, getActiveTurnId: () => activeTurnId, hasPendingTurnStart: () => false,
    hasFinalAnswer: () => false,
    start: async () => { calls.push("start"); if (error) throw error; return "turn"; },
    steer: async () => { calls.push("steer"); if (error) throw error; return activeTurnId; },
  };
  const api = context.create({ host, isActive: () => true, isDurableThread: () => true,
    getQueueMode: async () => mode, enqueue: async (thread, message) => { calls.push("enqueue"); return { status: "queued", messageId: message.id }; } });
  const request = { conversationId: "thread", message: { id: "client-id", context: {} }, queueModeOverride: "send-now" };
  const prepare = async () => ({ conversationId: "thread", resume: { conversationId: "thread" }, start: {}, steer: {} });
  return { calls, api, send: () => api.sendMessage(request, prepare), request };
}

for (const mode of ["queue", "send-only", "queue-only"]) test(`pending switch queues idle composer with ${mode} and override`, async () => {
  const f = fixture({ pending: true, mode });
  assert.deepEqual(await f.send(), { status: "queued", messageId: "client-id" });
  assert.deepEqual(f.calls, ["query", "enqueue"]);
});

test("ordinary send keeps its native start once no account change is pending", async () => {
  const f = fixture();
  assert.equal((await f.send()).turnId, "turn");
  assert.deepEqual(f.calls, ["query", "start"]);
});

test("account-state lookup failure does not send with old authentication", async () => {
  const error = Error("lookup failed"), f = fixture({ queryError: error });
  await assert.rejects(f.send(), e => e === error);
  assert.deepEqual(f.calls, ["query"]);
});

test("structured pre-dispatch rejection enqueues original client identity", async () => {
  const error = Object.assign(Error("pending"), { code: -32603, jsonRpcCode: -32603,
    name: "AppServerRequestError(-32603)", data: { azraelAdmission: "accountChangePending" } });
  const f = fixture({ error });
  assert.deepEqual(await f.send(), { status: "queued", messageId: "client-id" });
  assert.deepEqual(f.calls, ["query", "start", "enqueue"]);
});

for (const error of [Error("An account change is pending."), Object.assign(Error("unknown"), { data: { azraelAdmission: "accountChangePending" } }),
  Object.assign(Error("recovery"), { name: "AppServerRequestError(-32603)", code: -32603, jsonRpcCode: -32603, data: { azraelAdmission: "recoveryRequired" } })]) {
  test(`uncertain or unrelated failure is not queued: ${error.message}`, async () => {
    const f = fixture({ error });
    await assert.rejects(f.send(), e => e === error);
    assert.deepEqual(f.calls, ["query", "start"]);
  });
}

for (const asset of [core, presentation, list]) test(`pinned transform parses and is idempotent: ${asset}`, () => {
  const first = injectAccountSwitchQueue(preparedSource(asset), asset);
  const parsed = ts.createSourceFile(asset, first.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(parsed.parseDiagnostics.length, 0);
  assert.equal(first.count, 1);
  assert.deepEqual(injectAccountSwitchQueue(first.text, asset), { text: first.text, count: 0 });
});

for (const asset of [core, presentation, list]) test(`combined production transforms retain account queue guard: ${asset}`, () => {
  const { transformAsset } = require("./namespace-azrael-host.cjs");
  const result = transformAsset(source(asset), asset, path.join(root, asset), ts);
  assert.equal(result.asset.accountSwitchQueueEdits, 1);
  assert.equal(ts.createSourceFile(asset, result.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS).parseDiagnostics.length, 0);
  assert.ok(result.text.includes("account-switch-queue"));
});

test("automatic native queue resume waits for switch; explicit send-now stays available", async () => {
  const text = injectAccountSwitchQueue(injectQueuedCompactionPresentation(source(presentation)).text, presentation).text;
  const start = text.indexOf("resume:i?void 0:async(e,n)=>{") + "resume:i?void 0:".length;
  const end = text.indexOf(",sendNow:", start);
  const calls = [], context = vm.createContext({ __azraelRefreshAccount: async () => { calls.push("azrael/account"); return true; }, i: false, t: { sendRequest: async method => {
    calls.push(method); return { state: { isSwitching: true } };
  }, isConversationStreaming: () => false }, g: () => { throw Error("must not dispatch"); } });
  const resume = vm.runInContext("(" + text.slice(start, end) + ")", context);
  await resume("thread", () => true);
  assert.deepEqual(calls, ["azrael/account"]);
  const explicitStart = end + ",sendNow:i?void 0:".length;
  const explicitEnd = text.indexOf(",subscribe(e){", explicitStart);
  const item = { id: "queued", kind: "userInput" }, queue = { items: [item], messagesById: { queued: {} } };
  Object.assign(context, { _: async () => queue, p: () => [item], l: false, u: () => true,
    RD: { default: (a, b) => a === b }, HT: Error, v: async () => {}, f: () => {} });
  context.t.sendRequest = async (method, params) => {
    calls.push(method); assert.equal(params.queuedSubmissionId, "queued"); return { turn: { id: "old-account-turn" } };
  };
  const sendNow = vm.runInContext("(" + text.slice(explicitStart, explicitEnd) + ")", context);
  const sent = await sendNow("thread", "queued", null, null, () => true);
  assert.equal(sent.turnId, "old-account-turn");
  assert.deepEqual(calls, ["azrael/account", "thread/queue/start"]);
  assert.equal(queue.items.length, 0);
});

test("explicit queued steer uses the active old-account turn during a pending switch", async () => {
  const f = fixture({ pending: true, activeTurnId: "old-account-turn" });
  f.request.explicitQueuedSteer = true;
  assert.equal((await f.send()).turnId, "old-account-turn");
  assert.deepEqual(f.calls, ["query", "steer"]);
});

test("ordinary input still queues during a pending switch with an active turn", async () => {
  const f = fixture({ pending: true, activeTurnId: "old-account-turn" });
  assert.equal((await f.send()).status, "queued");
  assert.deepEqual(f.calls, ["query", "enqueue"]);
});

test("explicit queued steer without an active turn still waits for the switch", async () => {
  const f = fixture({ pending: true });
  f.request.explicitQueuedSteer = true;
  assert.equal((await f.send()).status, "queued");
  assert.deepEqual(f.calls, ["query", "enqueue"]);
});

function creationFixture(states) {
  const notices = [], timers = [], calls = [];
  const context = vm.createContext({ setTimeout: resolve => timers.push(resolve), document: {
    createElement: () => ({ style: {}, setAttribute() {}, remove() { notices.splice(notices.indexOf(this), 1); } }),
    body: { appendChild: notice => notices.push(notice) },
  } });
  vm.runInContext(creationGuard + ";globalThis.guard=__azraelCreateAfterAccountChange", context);
  const manager = { assertActive() {}, sendRequest: async () => {
    calls.push("query"); const state = states.shift();
    if (state instanceof Error) throw state;
    return { state: { isSwitching: state } };
  } };
  return { notices, timers, calls, run: (create, current) => context.guard(manager, create, current) };
}

test("new conversation stays queued with visible notice until the account switch finishes", async () => {
  const f = creationFixture([true, true, false]);
  let created = 0;
  const request = f.run(async () => { created++; return "created"; });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  assert.equal(created, 0);
  assert.equal(f.notices.length, 1);
  assert.match(f.notices[0].textContent, /계정 전환 대기 중/);
  f.timers.shift()(); await flush();
  assert.equal(created, 0); assert.equal(f.notices.length, 1);
  f.timers.shift()();
  assert.equal(await request, "created");
  assert.equal(created, 1); assert.equal(f.notices.length, 0);
});

test("new conversation retries only a confirmed pre-dispatch account admission rejection", async () => {
  const f = creationFixture([false, false]);
  let attempts = 0;
  const request = f.run(async () => {
    if (++attempts === 1) throw Object.assign(Error("pending"), { code: -32603, jsonRpcCode: -32603,
      name: "AppServerRequestError(-32603)", data: { azraelAdmission: "accountChangePending" } });
    return "created";
  });
  await new Promise(resolve => setImmediate(resolve));
  f.timers.shift()();
  assert.equal(await request, "created"); assert.equal(attempts, 2);
});

test("cancelled creation releases its waiting notice and never creates a thread", async () => {
  const f = creationFixture([true]); let cancelled = false;
  const error = Error("cancelled");
  const request = f.run(() => assert.fail("must not create"), () => { if (cancelled) throw error; });
  const rejection = assert.rejects(request, e => e === error);
  await new Promise(resolve => setImmediate(resolve));
  cancelled = true; f.timers.shift()(); await rejection;
  assert.equal(f.notices.length, 0);
});

for (const error of [Error("unknown delivery"), Error("Account recovery is required")]) {
  test(`new conversation does not retry ${error.message}`, async () => {
    const f = creationFixture([false]); let attempts = 0;
    await assert.rejects(f.run(() => { attempts++; throw error; }), e => e === error);
    assert.equal(attempts, 1); assert.equal(f.timers.length, 0);
  });
}

test("new conversation state lookup failure never starts a thread", async () => {
  const error = Error("lookup failed"), f = creationFixture([error]);
  await assert.rejects(f.run(() => assert.fail("must not create")), e => e === error);
});

test("queue rows show account wait state and account updates release the display", async () => {
  const text = injectAccountSwitchQueue(injectQueuedCompactionPresentation(source(presentation)).text, presentation).text;
  const ast = ts.createSourceFile(presentation, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === "vsn").getText(ast);
  const callbacks = new Map(); let pending = true, changes = 0, disposed = 0;
  const manager = { getHostId: () => "local", getConversation: () => ({ ephemeral: false }), getStreamRole: () => ({ role: "owner" }),
    addNotificationCallback: (name, callback) => { callbacks.set(name, callback); return () => { disposed++; callbacks.delete(name); }; },
    sendRequest: async method => method === "azrael/account" ? { state: { isSwitching: pending } } : { data: [{ id: "q", clientUserMessageId: "c", kind: "userInput" }], nextCursor: null },
  };
  const context = vm.createContext({ AE: () => false, Sy: () => true, nt: () => null, Nv: x => x,
    ysn: () => ({ id: "q", context: {} }), RD: { default: (a,b) => a === b }, Uh: { warning: assert.fail } });
  vm.runInContext(declaration + ";globalThis.create=vsn", context);
  const queue = context.create({ manager, appServerVersion: () => "v" });
  queue.subscribe(() => { changes++; }); await queue.load("thread");
  await callbacks.get("azrael/account/updated")(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(queue.read("thread")[0].submission.accountChangePending, true);
  const before = changes;
  await callbacks.get("azrael/account/updated")(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(changes, before, "unchanged state must not retrigger automatic resume");
  pending = false;
  await callbacks.get("azrael/account/updated")(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(queue.read("thread")[0].submission, undefined);
  queue.dispose(); assert.equal(disposed, 2);
  const row = injectAccountSwitchQueue(preparedSource(list), list).text;
  assert.ok(row.includes('defaultMessage:N===`account-change`?`계정 전환 대기 중`:`전송 대기 중`'));
  assert.ok(row.includes('K=(!N||N===`account-change`)&&te?'), "account wait keeps the explicit send-now action visible");
});

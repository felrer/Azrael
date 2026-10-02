"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { ACCOUNT_QUEUE_CORE_ASSET: core, ACCOUNT_QUEUE_PRESENTATION_ASSET: presentation, injectAccountSwitchQueue } = require("./inject-account-switch-queue.cjs");
const { injectQueuedCompactionPresentation } = require("./inject-queued-compaction.cjs");
const root = path.join(__dirname, "../artifacts/upstream-ui/26.928.31416");
const source = asset => fs.readFileSync(path.join(root, asset), "utf8");
const transformed = injectAccountSwitchQueue(source(core), core).text;
const ast = ts.createSourceFile(core, transformed, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === "Okn").getText(ast);

function fixture({ pending = false, mode = "queue", error, queryError } = {}) {
  const calls = [];
  const context = vm.createContext({ ZQ: Error, Ae: Error, tt: () => false, me: value => value });
  vm.runInContext(declaration + ";globalThis.create = Okn", context);
  const host = {
    accountChangePending: async () => { calls.push("query"); if (queryError) throw queryError; return pending; },
    needsResume: () => false, getActiveTurnId: () => null, hasPendingTurnStart: () => false,
    hasFinalAnswer: () => false,
    start: async () => { calls.push("start"); if (error) throw error; return "turn"; },
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

for (const asset of [core, presentation]) test(`pinned transform parses and is idempotent: ${asset}`, () => {
  const first = injectAccountSwitchQueue(source(asset), asset);
  const parsed = ts.createSourceFile(asset, first.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(parsed.parseDiagnostics.length, 0);
  assert.equal(first.count, 1);
  assert.deepEqual(injectAccountSwitchQueue(first.text, asset), { text: first.text, count: 0 });
});

for (const asset of [core, presentation]) test(`combined production transforms retain account queue guard: ${asset}`, () => {
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
  const calls = [], context = vm.createContext({ i: false, t: { sendRequest: async method => {
    calls.push(method); return { state: { isSwitching: true } };
  }, isConversationStreaming: () => false }, g: () => { throw Error("must not dispatch"); } });
  const resume = vm.runInContext("(" + text.slice(start, end) + ")", context);
  await resume("thread", () => true);
  assert.deepEqual(calls, ["azrael/account"]);
  const explicitStart = end + ",sendNow:i?void 0:".length;
  const explicitEnd = text.indexOf(",subscribe(e){", explicitStart);
  const item = { id: "queued", kind: "userInput" }, queue = { items: [item], messagesById: { queued: {} } };
  Object.assign(context, { g: async () => queue, f: () => [item], l: false, u: () => true,
    cO: { default: (a, b) => a === b }, jE: Error, _: async () => {}, d: () => {} });
  context.t.sendRequest = async (method, params) => {
    calls.push(method); assert.equal(params.queuedSubmissionId, "queued"); return { turn: { id: "old-account-turn" } };
  };
  const sendNow = vm.runInContext("(" + text.slice(explicitStart, explicitEnd) + ")", context);
  const sent = await sendNow("thread", "queued", null, null, () => true);
  assert.equal(sent.turnId, "old-account-turn");
  assert.deepEqual(calls, ["azrael/account", "thread/queue/start"]);
  assert.equal(queue.items.length, 0);
});

"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { injectAccountSwitchQueue } = require("./inject-account-switch-queue.cjs");
const { injectQueueConsumption } = require("./inject-queue-consumption.cjs");
const { injectQueuedCompactionPresentation, injectQueuedCompactionList } = require("./inject-queued-compaction.cjs");
const { QUESTION_QUEUE_ASSETS, QUESTION_QUEUE_PRESENTATION_ASSET, QUESTION_QUEUE_CORE_ASSET, QUESTION_QUEUE_LIST_ASSET, injectQuestionQueue, __azraelPendingQuestionCount, __azraelPendingResponseCounts } = require("./inject-question-queue.cjs");
const root = process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.1007.21434");
function prepare(asset) {
  let text = fs.readFileSync(path.join(root, asset), "utf8");
  if (asset === QUESTION_QUEUE_PRESENTATION_ASSET) text = injectQueuedCompactionPresentation(text).text;
  if (asset === QUESTION_QUEUE_LIST_ASSET) text = injectQueuedCompactionList(text).text;
  if (asset === QUESTION_QUEUE_CORE_ASSET) text = injectQueueConsumption(text).text;
  return injectAccountSwitchQueue(text, asset).text;
}
const prepared = new Map(QUESTION_QUEUE_ASSETS.map(asset => [asset, prepare(asset)]));
const transformed = new Map([...prepared].map(([asset, text]) => [asset, injectQuestionQueue(text, asset).text]));
const asts = new Map([...transformed].map(([asset, text]) => [asset, ts.createSourceFile(asset, text, 99, true, 1)]));

test("question queue transforms compose, parse, and reject partial or changed pinned inputs", () => {
  for (const [asset, text] of transformed) {
    assert.equal(asts.get(asset).parseDiagnostics.length, 0);
    assert.equal(injectQuestionQueue(text, asset).text, text);
    assert.throws(() => injectQuestionQueue(text.replace("/*azrael-question-queue-", "/*broken-question-queue-"), asset), /anchor/);
  }
  assert.throws(() => injectQuestionQueue("unrecognized source", QUESTION_QUEUE_CORE_ASSET), /anchor/);
});

test("missing, malformed, or failed question state never establishes an empty wait", () => {
  for (const count of [undefined, null, -1, 1.5, "0", Infinity, NaN]) assert.throws(() => __azraelPendingQuestionCount({ pendingQuestionCount: count }), /unavailable/);
  assert.equal(__azraelPendingQuestionCount({ pendingQuestionCount: 0 }), 0);
  assert.equal(__azraelPendingQuestionCount({ pendingQuestionCount: 2 }), 2);
  for (const count of [undefined, null, -1, 1.5, "0", Infinity, NaN]) assert.throws(() => __azraelPendingResponseCounts({ pendingQuestionCount: 0, pendingApprovalCount: count }), /approval state is unavailable/);
  assert.throws(() => __azraelPendingResponseCounts({ pendingApprovalCount: 0 }), /question state is unavailable/);
  assert.deepEqual(__azraelPendingResponseCounts({ pendingQuestionCount: 0, pendingApprovalCount: 0 }), { pendingQuestionCount: 0, pendingApprovalCount: 0 });
});

function adapterFixture() {
  const ast = asts.get(QUESTION_QUEUE_PRESENTATION_ASSET);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "vsn").getText(ast);
  const callbacks = new Map(), calls = [], warnings = [], item = { id: "q", clientUserMessageId: "client", input: [], kind: "userInput" };
  let count = 2, approvalCount = 0, pendingAccount = false, interrupted = false;
  const deferredLists=[];
  const manager = { getHostId: () => "local", getConversation: () => ({ ephemeral: false }), isConversationStreaming: () => false,
    getStreamRole: () => ({ role: "owner" }),
    addNotificationCallback: (name, callback) => { callbacks.set(name, callback); return () => callbacks.delete(name); },
    sendRequest: async method => { calls.push(method);
      if (method === "azrael/account") return { state: { isSwitching: pendingAccount } };
      if (method === "thread/queue/list") { if(deferredLists.length)return deferredLists.shift()();return { data: [item], nextCursor: null, pendingQuestionCount: count, pendingApprovalCount: approvalCount }; }
      if (method === "thread/queue/start") return { turn: { id: "turn" } };
      throw Error(method);
    } };
  const context = vm.createContext({ __azraelPendingQuestionCount, __azraelPendingResponseCounts, AE: () => false, Gf: () => true, Sy: () => true,
    nt: () => interrupted ? { status: "interrupted" } : null, Nv: value => value, Lpt: "interrupted",
    ysn: () => ({ id: "q", context: {} }), RD: { default: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    $Oe: () => false, Xf: async () => false, HT: Error, Uh: { warning: (...args) => warnings.push(args) } });
  vm.runInContext(declaration + ";globalThis.create=vsn", context);
  const queue = context.create({ manager, appServerVersion: () => "v" });
  return { queue, calls, callbacks, warnings, setCount: value => { count = value; }, setApprovalCount: value => { approvalCount = value; }, deferList: fn=>deferredLists.push(fn), setAccount: value => { pendingAccount = value; }, setInterrupted: value => { interrupted = value; } };
}

test("native automatic resume holds partial questions and rechecks before releasing the final hold", async () => {
  const f = adapterFixture();
  await f.queue.load("thread");
  assert.equal(f.queue.read("thread")[0].submission.pendingQuestionCount, 2);
  await f.queue.resume("thread", () => true);
  assert.ok(!f.calls.includes("thread/queue/start"));
  f.setCount(1); await f.queue.load("thread");
  assert.equal(f.queue.read("thread")[0].submission.pendingQuestionCount, 1);
  await f.queue.resume("thread", () => true);
  assert.ok(!f.calls.includes("thread/queue/start"));
  f.setCount(0);
  await f.queue.resume("thread", () => true);
  assert.equal(f.calls.filter(method => method === "thread/queue/start").length, 1);
  assert.equal(f.queue.read("thread").length, 0);
  f.queue.dispose();
});

test("question removal keeps account and interruption presentation intact", async () => {
  const f = adapterFixture(); f.setAccount(true); f.setInterrupted(true);
  await f.queue.load("thread");
  await f.callbacks.get("azrael/account/updated")(); await new Promise(resolve => setImmediate(resolve));
  let row = f.queue.read("thread")[0];
  assert.equal(row.submission.pendingQuestionCount, 2); assert.equal(row.submission.accountChangePending, true); assert.equal(row.pausedReason, "interrupted");
  f.setCount(0); await f.queue.load("thread");
  row = f.queue.read("thread")[0];
  assert.equal(row.submission.pendingQuestionCount, undefined); assert.equal(row.submission.accountChangePending, true); assert.equal(row.pausedReason, "interrupted");
  await f.queue.resume("thread", () => true); assert.ok(!f.calls.includes("thread/queue/start"));
  f.queue.dispose();
});

test("question notifications refresh the native wait and malformed snapshots retain the saved queue", async () => {
  const f = adapterFixture(); await f.queue.load("thread"); f.setCount(0);
  f.callbacks.get("thread/queue/changed")({ params: { threadId: "thread" } }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.queue.read("thread")[0].submission, undefined);
  f.setCount(undefined); await assert.rejects(f.queue.load("thread"), /unavailable/);
  assert.equal(f.queue.read("thread")[0].id, "q");
  f.queue.dispose();
});

test("legacy automatic dispatch checks questions after accepted-input reconciliation and before send-lock admission", () => {
  const text = transformed.get(QUESTION_QUEUE_CORE_ASSET);
  const accepted = text.indexOf("if(r!=null&&this.__azraelWasAccepted(e,r))");
  const hold = text.indexOf("if(n==null&&await this.options.submissionHost.hasPendingQuestions(e))return;");
  const lock = text.indexOf("if(!d()||r==null||!t.tryAcquireStartTurn(e)", hold);
  assert.ok(accepted >= 0 && hold > accepted && lock > hold);
  const row = transformed.get(QUESTION_QUEUE_LIST_ASSET);
  for (const label of ['사용자 답변 대기 중','승인 응답 대기','사용자 응답 대기']) assert.ok(row.includes(label));
});

test("multiple approvals hold automatic resume until every approval and question is answered", async () => {
  const f=adapterFixture();f.setCount(0);f.setApprovalCount(2);await f.queue.load('thread');
  assert.equal(f.queue.read('thread')[0].submission.pendingApprovalCount,2);
  await f.queue.resume('thread',()=>true);assert.ok(!f.calls.includes('thread/queue/start'));
  f.setApprovalCount(1);await f.queue.resume('thread',()=>true);assert.ok(!f.calls.includes('thread/queue/start'));
  f.setCount(1);f.setApprovalCount(0);await f.queue.resume('thread',()=>true);assert.ok(!f.calls.includes('thread/queue/start'));
  f.setCount(0);await f.queue.resume('thread',()=>true);assert.equal(f.calls.filter(x=>x==='thread/queue/start').length,1);f.queue.dispose();
});

test("unknown approval state preserves queued input and blocks automatic resume", async () => {
  const f=adapterFixture();f.setCount(0);f.setApprovalCount(1);await f.queue.load('thread');
  for(const invalid of [undefined,null,-1,'0',1.5]){
    f.setApprovalCount(invalid);await assert.rejects(f.queue.resume('thread',()=>true),/unavailable/);
    assert.equal(f.queue.read('thread')[0].id,'q');assert.equal(f.queue.read('thread')[0].submission.pendingApprovalCount,1);
  }
  assert.ok(!f.calls.includes('thread/queue/start'));f.queue.dispose();
});

test("cross-window approval changes invalidate a stale empty snapshot before automatic resume", async () => {
  const f=adapterFixture();f.setCount(0);f.setApprovalCount(0);await f.queue.load('thread');
  let release;const barrier=new Promise(resolve=>{release=resolve});
  f.deferList(async()=>{await barrier;return {data:[{id:'q',clientUserMessageId:'client',input:[],kind:'userInput'}],nextCursor:null,pendingQuestionCount:0,pendingApprovalCount:0}});
  const loading=f.queue.load('thread');f.setApprovalCount(2);
  f.callbacks.get('thread/queue/changed')({params:{threadId:'thread'}});release();await loading;
  assert.equal(f.queue.read('thread')[0].submission.pendingApprovalCount,2);
  await f.queue.resume('thread',()=>true);assert.ok(!f.calls.includes('thread/queue/start'));
  // Another renderer may add an approval after this renderer last saw zero.
  f.setApprovalCount(0);await f.queue.load('thread');f.setApprovalCount(1);
  await f.queue.resume('thread',()=>true);assert.ok(!f.calls.includes('thread/queue/start'));f.queue.dispose();
});

test("explicit send-now retains its existing path while automatic approval hold is active", async () => {
  const f=adapterFixture();f.setCount(1);f.setApprovalCount(2);await f.queue.load('thread');
  const reply=await f.queue.sendNow('thread','q',null,null,()=>true);
  assert.equal(reply.status,'sent');assert.equal(f.calls.filter(x=>x==='thread/queue/start').length,1);f.queue.dispose();
});

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { EventEmitter } = require("node:events");
const { createRootResumeStore } = require("./inject-deferred-turn.cjs");
const load = (name, imports) => {
  const exports = {};
  const source = fs.readFileSync(require("node:path").join(__dirname, "../extensions/azrael-ex/src", name + ".ts"), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: id => imports[id], setInterval, clearInterval });
  return exports;
};
const protocol = load("rootResumeProtocol", { "./protocol": { isRecord: v => !!v && typeof v === "object" && !Array.isArray(v) } });
const { RootResumeView } = load("rootResumeView", { vscode: {}, "./rootResumeProtocol": protocol });

const reservationFixture = (extra = {}) => ({ id: "r1", rootThreadId: "root", originatingTurnId: "t0", rootTurnId: "t0", callId: "call", resumeTurnId: "resume", resumeAtMs: 20000, createdAtMs: 0, updatedAtMs: 0, revision: 2, state: "waiting", agentTasks: [], reason: "wait", wakeReason: null, lastError: null, ...extra });

test("host preserves completion identities and work wake reason, defaults old records", () => {
  const parse = value => protocol.parseRootResumeResponse({ reservations: [value] }).reservations[0];
  const jobs = ["exec:session-123", "cell:<job>"];
  const result = parse(reservationFixture({ completionTasks: jobs, wakeReason: "work_completed" }));
  assert.deepEqual(Array.from(result.completionTasks), jobs);
  assert.equal(result.wakeReason, "work_completed");
  assert.equal(parse(reservationFixture()).completionTasks.length, 0);
  for (const completionTasks of [null, undefined, "exec:1", [123], ["exec:1", {}]]) {
    assert.throws(() => parse(reservationFixture({ completionTasks })), /completionTasks/);
  }
  assert.throws(() => parse(reservationFixture({ wakeReason: "unknown" })), /wakeReason/);
});

test("management cards distinguish jobs, agents, combined and scheduled-only conditions", () => {
  const service = new EventEmitter();
  const view = new RootResumeView(service);
  const panel = { webview: { html: "" } }; view.panel = panel;
  const render = extra => { service.rootResumeReservations = [reservationFixture(extra)]; view.render(); return panel.webview.html; };
  const agentTasks = [{ threadId: "child", agentPath: "/root/child", turnId: "t1" }];
  assert.match(render({}), /class="condition">예약 시각에 재개/);
  assert.match(render({ agentTasks }), /다음 하위 에이전트가 모두 종료되면 조기 재개/);
  const jobs = render({ completionTasks: ["exec:<one>"] });
  assert.match(jobs, /다음 작업이 모두 종료되면 조기 재개 · 예약 시각에 재개/);
  assert.match(jobs, /작업 <code>exec:&lt;one&gt;<\/code>/);
  assert.doesNotMatch(jobs, /exec:<one>/);
  const combined = render({ agentTasks, completionTasks: ["cell:2"] });
  assert.match(combined, /다음 하위 에이전트와 작업이 모두 종료되면 조기 재개 · 예약 시각에 재개/);
  assert.match(combined, /\/root\/child/); assert.match(combined, /cell:2/);
  view.panel = undefined; view.dispose();
});

test("inline resume uses selected ID/revision, blocks duplicates and recovers after host error", () => {
  const sent = []; let receive;
  const store = createRootResumeStore({ subscribe: (_type, cb) => { receive = cb; return () => {}; }, dispatchMessage: (_type, value) => sent.push(value) }, "client");
  const reservation = { id: "r1", revision: 7, state: "waiting", agentTasks: [{ threadId: "child", agentPath: "/root/child", turnId: "t1" }] };
  receive({ clientId: "other", available: true, reservations: [reservation] });
  assert.equal(store.getSnapshot().available, false);
  receive({ clientId: "client", available: true, reservations: [reservation] });
  store.resume(reservation); store.resume(reservation);
  assert.equal(sent.filter(r => r.action === "resume").length, 1);
  assert.deepEqual(sent.at(-1), { clientId: "client", action: "resume", reservationId: "r1", revision: 7 });
  receive({ clientId: "client", available: true, reservations: [{ ...reservation, revision: 8 }], error: "revision changed" });
  assert.equal(store.getSnapshot().pending, null);
  assert.equal(store.getSnapshot().error, "revision changed");
  store.resume(store.getSnapshot().reservations[0]);
  assert.equal(sent.at(-1).revision, 8);
  receive({ clientId: "client", available: true, reservations: [{ ...reservation, state: "resumed" }] });
  store.dispose();
  assert.equal(sent.at(-1).action, "unsubscribe");
});

test("embedded management refreshes a lost revision race without retrying mutation", async () => {
  const service = new EventEmitter(); service.rootResumeAvailable = true; service.rootResumeReservations = [{ id: "r1", revision: 2, state: "waiting", agentTasks: [] }];
  const requests = []; service.rootResume = async request => { requests.push(request); if (request.action === "resume") throw Error("revision changed"); return { reservations: service.rootResumeReservations }; };
  const messages = []; const webview = { postMessage: async message => { messages.push(message); return true; } };
  let dispose; const panel = { onDidDispose: cb => { dispose = cb; return { dispose() {} }; } };
  const view = new RootResumeView(service);
  await view.handleEmbedded(webview, { type: "azrael-root-resume", clientId: "client", action: "subscribe" }, panel);
  await view.handleEmbedded(webview, { type: "azrael-root-resume", clientId: "wrong", action: "resume", reservationId: "r1", revision: 1 });
  assert.equal(requests.length, 1);
  await view.handleEmbedded(webview, { type: "azrael-root-resume", clientId: "client", action: "resume", reservationId: "r1", revision: 1 });
  assert.deepEqual(requests.map(r => r.action), ["list", "resume", "list"]);
  assert.match(messages.at(-1).error, /revision changed/);
  assert.equal(messages.at(-1).pending, null);
  const count = messages.length; dispose(); service.emit("rootResume"); await Promise.resolve(); assert.equal(messages.length, count);
  view.dispose();
});

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

test("inline reconnect is explicit and deduplicated without submitting a resume", () => {
  const sent = []; let receive;
  const store = createRootResumeStore({ subscribe: (_type, cb) => { receive = cb; return () => {}; }, dispatchMessage: (_type, value) => sent.push(value) }, "client");
  receive({ clientId: "client", available: false, reservations: [], error: "connection" });
  store.reconnect(); store.reconnect();
  assert.equal(sent.filter(r => r.action === "reconnect").length, 1);
  assert.equal(store.getSnapshot().reconnecting, true);
  store.resume({ id: "r", revision: 1, state: "waiting" });
  assert.equal(sent.filter(r => r.action === "resume").length, 0);
  receive({ clientId: "client", available: true, reservations: [], error: null });
  assert.equal(store.getSnapshot().reconnecting, false);
  store.dispose();
});

test("embedded reconnect shares one connection and clears all connection errors after refresh", async () => {
  const service = new EventEmitter(); service.rootResumeAvailable = false;
  let release; let connects = 0; const requests = [];
  service.connect = async () => { connects++; await new Promise(resolve => { release = resolve; }); service.rootResumeAvailable = true; service.emit("rootResumeConnection", true); };
  service.rootResume = async request => {
    requests.push(request.action);
    if (!service.rootResumeAvailable) throw Error("The engine connection has not been verified.");
    service.rootResumeReservations = []; service.emit("rootResume", []); return { reservations: [] };
  };
  const states = [[], []]; const views = states.map(messages => ({ postMessage: async message => { messages.push(message); return true; } }));
  const view = new RootResumeView(service);
  try {
    for (const webview of views) await view.handleEmbedded(webview, { type: "azrael-root-resume", clientId: "client", action: "subscribe" });
    assert.match(states[0].at(-1).error, /재개 관리 연결/);
    const first = view.handleEmbedded(views[0], { type: "azrael-root-resume", clientId: "client", action: "reconnect" });
    const second = view.handleEmbedded(views[1], { type: "azrael-root-resume", clientId: "client", action: "reconnect" });
    await Promise.resolve(); assert.equal(connects, 1); release(); await Promise.all([first, second]);
    for (const messages of states) { assert.equal(messages.at(-1).available, true); assert.equal(messages.at(-1).error, null); assert.equal(messages.at(-1).reconnecting, false); }
    assert.deepEqual(requests, ["list", "list", "list"]);
  } finally { view.dispose(); }
});

test("automatic reconnect refresh clears connection errors but preserves action errors", async () => {
  const service = new EventEmitter(); service.rootResumeAvailable = true;
  service.rootResume = async request => {
    if (!service.rootResumeAvailable) throw Error("bridge disconnected");
    if (request.action === "resume") throw Error("revision changed");
    service.emit("rootResume", []); return { reservations: [] };
  };
  const messages = []; const webview = { postMessage: async message => { messages.push(message); return true; } }; const view = new RootResumeView(service);
  try {
    await view.handleEmbedded(webview, { type: "azrael-root-resume", clientId: "c", action: "subscribe" });
    await view.handleEmbedded(webview, { type: "azrael-root-resume", clientId: "c", action: "resume", reservationId: "r", revision: 1 });
    service.rootResumeAvailable = false; service.emit("rootResumeConnection", false);
    service.rootResumeAvailable = true; service.emit("rootResumeConnection", true);
    await new Promise(resolve => setImmediate(resolve));
    assert.match(messages.at(-1).error, /revision changed/);
    service.rootResumeAvailable = false; service.emit("rootResumeConnection", false);
    await view.handleEmbedded(webview, { type: "azrael-root-resume", clientId: "c", action: "list" });
    service.rootResumeAvailable = true; service.emit("rootResumeConnection", true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages.at(-1).error, null);
  } finally { view.dispose(); }
});

test("late failure from an earlier connection cannot replace recovered embedded state", async () => {
  const service = new EventEmitter(); service.rootResumeAvailable = true; let rejectOld;
  service.rootResume = () => new Promise((_resolve, reject) => { rejectOld = reject; });
  const messages = []; const webview = { postMessage: async message => { messages.push(message); return true; } }; const view = new RootResumeView(service);
  try {
    const old = view.handleEmbedded(webview, { type: "azrael-root-resume", clientId: "c", action: "subscribe" });
    await new Promise(resolve => setImmediate(resolve));
    service.emit("rootResumeConnection", false);
    service.rootResume = async () => { service.emit("rootResume", []); return { reservations: [] }; };
    service.emit("rootResumeConnection", true);
    await new Promise(resolve => setImmediate(resolve));
    rejectOld(Error("old connection failed")); await old;
    assert.equal(messages.at(-1).available, true); assert.equal(messages.at(-1).error, null);
  } finally { view.dispose(); }
});

test("failed explicit reconnect remains retryable without forgetting engine identity", async () => {
  const service = new EventEmitter(); service.rootResumeAvailable = false; let attempts = 0;
  service.connect = async () => {
    if (++attempts === 1) throw Error("Reconnected bridge belongs to a different engine instance.");
    service.rootResumeAvailable = true; service.emit("rootResumeConnection", true);
  };
  service.rootResume = async () => {
    if (!service.rootResumeAvailable) throw Error("bridge disconnected");
    service.emit("rootResume", []); return { reservations: [] };
  };
  const messages = []; const webview = { postMessage: async message => { messages.push(message); return true; } }; const view = new RootResumeView(service);
  try {
    await view.handleEmbedded(webview, { type: "azrael-root-resume", clientId: "c", action: "subscribe" });
    await view.handleEmbedded(webview, { type: "azrael-root-resume", clientId: "c", action: "reconnect" });
    assert.equal(messages.at(-1).reconnecting, false); assert.equal(messages.at(-1).available, false);
    assert.match(messages.at(-1).error, /different engine instance/);
    await view.handleEmbedded(webview, { type: "azrael-root-resume", clientId: "c", action: "reconnect" });
    assert.equal(attempts, 2); assert.equal(messages.at(-1).error, null);
  } finally { view.dispose(); }
});

test("reconnect from another surface cannot replace a connection during a resume mutation", async () => {
  const service = new EventEmitter(); service.rootResumeAvailable = true; let finish; let connects = 0;
  service.connect = async () => { connects++; };
  service.rootResume = async request => { if (request.action === "resume") await new Promise(resolve => { finish = resolve; }); return { reservations: [] }; };
  const webviews = [0, 1].map(() => ({ postMessage: async () => true })); const view = new RootResumeView(service);
  try {
    for (const webview of webviews) await view.handleEmbedded(webview, { type: "azrael-root-resume", clientId: "c", action: "subscribe" });
    const mutation = view.handleEmbedded(webviews[0], { type: "azrael-root-resume", clientId: "c", action: "resume", reservationId: "r", revision: 1 });
    await new Promise(resolve => setImmediate(resolve));
    await view.handleEmbedded(webviews[1], { type: "azrael-root-resume", clientId: "c", action: "reconnect" });
    assert.equal(connects, 0); finish(); await mutation;
  } finally { view.dispose(); }
});

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

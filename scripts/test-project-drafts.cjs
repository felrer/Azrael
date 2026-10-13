"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { HELPERS, projectDraftKey, injectProjectDrafts } = require("./inject-project-drafts.cjs");
const root = process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.1007.21434");
const original = fs.readFileSync(path.join(root, "out/extension.js"), "utf8");
const patched = injectProjectDrafts(original).text;
const ast = ts.createSourceFile("host.js", patched, 99, true, 1);
assert.equal(ast.parseDiagnostics.length, 0);
const methods = new Map();
let merge;
let providerHasProjectMethod, projectHandlerOwnsProjectMethod = false, fetchWrapperOwnsHandler = false;
function visit(node) {
  if (ts.isClassExpression(node)) {
    const names = node.members.filter(ts.isMethodDeclaration).map(member => member.name.getText(ast));
    if (names.includes("sendPersistedAtomState")) providerHasProjectMethod = names.includes("getWorkspaceProject");
    if (names.includes("getWorkspaceProject")) projectHandlerOwnsProjectMethod = true;
    if (names.includes("fetch") && node.getText(ast).includes("this.extensionFetchHandler=")) fetchWrapperOwnsHandler = true;
  }
  if (ts.isMethodDeclaration(node) && ["sendPersistedAtomState", "broadcastPersistedAtomUpdate", "updatePersistedAtomValue", "enqueueUpdate"].includes(node.name.getText(ast))) methods.set(node.name.getText(ast), node.getText(ast));
  if (ts.isFunctionDeclaration(node) && node.name?.text === "$Ke") merge = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
const updateStart = patched.indexOf('case"persisted-atom-update":{') + 'case"persisted-atom-update":{'.length;
const updateEnd = patched.indexOf(';break}', updateStart);
const receive = patched.slice(updateStart, updateEnd);
const clone = value => JSON.parse(JSON.stringify(value));
function fixture(state = {}) {
  const ctx = vm.createContext({ Object, JSON, Map, Promise, Error, Re: { PERSISTED_ATOM_STATE: "state" },
    tZt: { safeParse: value => ({ success: value != null && typeof value === "object", data: value == null ? undefined : clone(value) }) },
    UKe: { default: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  });
  vm.runInContext(HELPERS + merge, ctx);
  const store = vm.runInContext(`({${methods.get("updatePersistedAtomValue")},${methods.get("enqueueUpdate")}})`, ctx);
  store.pendingUpdates = new Map(); store.pendingPersistedAtomUpdates = new Map();
  store.storage = { get: () => state, update: async (_key, value) => { state = value; } };
  store.onDidUpdateEntryEmitter = { fire() {} };
  const hosts = [];
  store.onDidUpdatePersistedAtomEmitter = { fire: ({ key, value }) => { for (const host of hosts) host.pending.push(host.broadcastPersistedAtomUpdate(key, value)); } };
  function open(id) {
    const host = vm.runInContext(`({${methods.get("sendPersistedAtomState")},${methods.get("broadcastPersistedAtomUpdate")},async receive(r){${receive}}})`, ctx);
    // Match the production provider's owner graph. The provider itself has no
    // getWorkspaceProject method; that method belongs to ExtensionFetchHandler.
    host.fetchWrapper = { extensionFetchHandler: { getWorkspaceProject: async () => id == null ? null : { id } } };
    host.readPersistedAtomState = async () => state;
    host.globalState = store; host.messages = []; host.pending = [];
    host.postMessageToWebview = (_view, message) => host.messages.push(clone(message));
    host.broadcastToAllViews = message => host.messages.push(clone(message));
    hosts.push(host); return host;
  }
  async function save(host, key, entry, storeKey = "composer-prompt-drafts-v2") {
    await host.receive({ key: storeKey, recordUpdate: { entries: { [key]: entry }, legacyStorageKey: "composer-prompt-drafts-v1" } });
    await Promise.all(hosts.flatMap(h => h.pending.splice(0)));
  }
  return { open, save, state: () => clone(state) };
}
test("pinned host transform is complete, idempotent and rejects drift", () => {
  assert.equal(providerHasProjectMethod, false);
  assert.equal(projectHandlerOwnsProjectMethod, true);
  assert.equal(fetchWrapperOwnsHandler, true);
  assert.equal(injectProjectDrafts(patched).count, 0);
  assert.throws(() => injectProjectDrafts(original.replace("async sendPersistedAtomState(e)", "async changed(e)")), /anchor/);
  assert.throws(() => injectProjectDrafts(patched.replace("projectDraftView(r[k],p)", "r[k]")), /Invalid/);
});
test("flags and filter survive host reconstruction and project-scoped draft synchronization", async () => {
  const flags = { '["local","a"]': true, '["other-host","b"]': true };
  const f = fixture(), a = f.open("project-a");
  assert.equal(a.getWorkspaceProject, undefined);
  await a.receive({ key: "azrael-session-flags", value: flags });
  await a.receive({ key: "azrael-session-flag-only", value: true });
  await f.save(a, "new-conversation", { value: { prompt: "preserved draft" } });
  const restarted = fixture(f.state()), reopened = restarted.open("project-a");
  await reopened.sendPersistedAtomState({});
  const restored = reopened.messages.at(-1).state;
  assert.deepEqual(restored["azrael-session-flags"], flags);
  assert.equal(restored["azrael-session-flag-only"], true);
  assert.equal(restored["composer-prompt-drafts-v2"]["new-conversation"].prompt, "preserved draft");
  await reopened.receive({ key: "azrael-session-flags", value: { '["other-host","b"]': true } });
  await reopened.sendPersistedAtomState({});
  assert.deepEqual(reopened.messages.at(-1).state["azrael-session-flags"], { '["other-host","b"]': true });
});
test("two projects persist, broadcast, reopen and clear independent new-chat drafts", async () => {
  const f = fixture(), a = f.open("project-a"), b = f.open("project-b");
  const draftA = { prompt: "A", pullRequestChecks: [], attachment: { path: "a.txt" } };
  await f.save(a, "new-conversation", { value: draftA });
  assert.deepEqual(a.messages.at(-1).value["new-conversation"], draftA);
  assert.equal(b.messages.at(-1).value["new-conversation"], undefined);
  await f.save(b, "new-conversation", { value: { prompt: "B" } });
  await f.save(a, "new-conversation", { delete: true, expectedValue: { prompt: "stale" } });
  assert.deepEqual(a.messages.at(-1).value["new-conversation"], draftA);
  await f.save(a, "panel-new-conversation", { value: { prompt: "panel A" } });
  const reopened = f.open("project-a"); await reopened.sendPersistedAtomState({});
  assert.deepEqual(reopened.messages.at(-1).state["composer-prompt-drafts-v2"]["new-conversation"], draftA);
  await f.save(a, "new-conversation", { delete: true, expectedValue: draftA });
  assert.equal(a.messages.at(-1).value["new-conversation"], undefined);
  assert.equal(b.messages.at(-1).value["new-conversation"].prompt, "B");
  assert.equal(a.messages.at(-1).value["panel-new-conversation"].prompt, "panel A");
});
test("legacy unattributed drafts stay stored; conversation drafts retain native behavior", async () => {
  const old = { "new-conversation": { prompt: "unattributed" }, thread: { prompt: "existing chat" } };
  const f = fixture({ "composer-prompt-drafts-v1": old }), a = f.open("A");
  await a.sendPersistedAtomState({});
  assert.equal(a.messages.at(-1).state["composer-prompt-drafts-v1"]["new-conversation"], undefined);
  assert.equal(a.messages.at(-1).state["composer-prompt-drafts-v1"].thread.prompt, "existing chat");
  await f.save(a, "new-conversation", { value: { prompt: "owned" } });
  assert.deepEqual(f.state()["composer-prompt-drafts-v1"], old);
  assert.equal(f.state()["composer-prompt-drafts-v2"].thread.prompt, "existing chat");
  await f.save(a, "thread", { value: { prompt: "updated" } });
  assert.equal(a.messages.at(-1).value.thread.prompt, "updated");
});
test("projectless windows use their own scope and IDs cannot collide", async () => {
  const f = fixture(), a = f.open(null), b = f.open("A");
  await f.save(a, "new-conversation", { value: { prompt: "no project" } });
  assert.equal(b.messages.at(-1).value["new-conversation"], undefined);
  assert.notEqual(projectDraftKey("new-conversation", { id: "a,b" }), projectDraftKey("panel-new-conversation", { id: "a" }));
});
test("ordinary preferences keep their original sync and update path", async () => {
  const f = fixture({ preference: "old" }), a = f.open("A");
  await a.sendPersistedAtomState({});
  assert.equal(a.messages.at(-1).state.preference, "old");
  await a.receive({ key: "preference", value: "new" });
  await Promise.all(a.pending);
  assert.equal(a.messages.at(-1).key, "preference");
  assert.equal(a.messages.at(-1).value, "new");
});

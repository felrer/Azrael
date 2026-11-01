"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { isDeepStrictEqual } = require("node:util");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const atoms = require("./persisted-atoms.cjs");
const { injectPersistedAtoms } = require("./inject-persisted-atoms.cjs");
const { HELPERS, injectProjectDrafts } = require("./inject-project-drafts.cjs");
const root = process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.1007.21434");
const original = fs.readFileSync(path.join(root, "out/extension.js"), "utf8");
const patched = injectProjectDrafts(injectPersistedAtoms(original).text).text;
const ast = ts.createSourceFile("host.js", patched, 99, true, 1);
let storageClass, merge;
const methods = new Map();
function visit(node) {
  if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.members.some(m => m.name?.getText(ast) === "updatePersistedAtomValue")) storageClass = node.getText(ast);
  if (ts.isFunctionDeclaration(node) && node.name?.text === "$Ke") merge = node.getText(ast);
  if (ts.isMethodDeclaration(node) && ["sendPersistedAtomState", "broadcastPersistedAtomUpdate"].includes(node.name.getText(ast))) methods.set(node.name.getText(ast), node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);

test("pinned atom/draft composition remains complete and rejects upstream drift", () => {
  assert.equal(ast.parseDiagnostics.length, 0);
  assert.equal(injectPersistedAtoms(patched).count, 0);
  assert.equal(injectProjectDrafts(patched).count, 0);
  assert.throws(() => injectPersistedAtoms(original.replace("async getStored(e)", "async changed(e)")), /anchor/);
  const { getTransformRules, getAssetTransformRules } = require("./namespace-azrael-host.cjs");
  const rules = getTransformRules();
  assert.ok(rules["persisted-atoms.cjs"]);
  assert.ok(getAssetTransformRules("out/extension.js", rules)["persisted-atoms.cjs"]);
  // These are recurring packaging/input omissions at each host update.
  const prepare = fs.readFileSync(path.join(__dirname, "prepare-independent-vscode.ps1"), "utf8");
  assert.match(prepare, /'extension\/out\/persisted-atoms\.cjs'/);
  assert.match(prepare, /foreach \(\$module in @\('session-links\.cjs'[^\n]*'persisted-atoms\.cjs'/);
  assert.match(fs.readFileSync(path.join(__dirname, "prepare-platform-host.cjs"), "utf8"), /const modules=\[[^\n]*"persisted-atoms\.cjs"/);
  assert.match(fs.readFileSync(path.join(__dirname, "preparation-state.cjs"), "utf8"), /"persisted-atoms\.cjs"/);
  assert.match(fs.readFileSync(path.join(__dirname, "integrated-azrael-entry.cjs"), "utf8"), /await require\("\.\/out\/persisted-atoms\.cjs"\)\.initialize/);
});

test("actual transformed host preserves draft merge, no-op notification, reset and committed reads", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-atoms-host-"));
  let store;
  try {
    const values = new Map([["persisted-atom-state", { preference: "old", "mcp-server-tools-cache-v2": { large: "x".repeat(700000) } }], ["account", "preserved"]]);
    let mementoWrites = 0, stats;
    const memento = { get: key => values.get(key), update: async (key, value) => { mementoWrites++; value === undefined ? values.delete(key) : values.set(key, value); } };
    store = await atoms.initialize({ globalStorageUri: { fsPath: directory }, globalState: memento }, value => { stats = value; });
    class Emitter { listeners = []; event = listener => { this.listeners.push(listener); return { dispose() {} }; }; fire(value) { this.listeners.forEach(listener => listener(value)); } dispose() {} }
    const clone = v => JSON.parse(JSON.stringify(v));
    const context = vm.createContext({ require: id => { assert.equal(id, "./persisted-atoms.cjs"); return atoms; }, Map, Promise, Error, AggregateError, TextEncoder, queueMicrotask,
      aL: { EventEmitter: Emitter }, Re: { PERSISTED_ATOM_STATE: "persisted-atom-state", THREAD_PROJECT_ASSIGNMENTS: "assignments", PROJECTLESS_THREAD_IDS: "projectless" }, GX: () => false, Hoe: () => null,
      tZt: { safeParse: value => ({ success: value != null && typeof value === "object", data: value == null ? undefined : clone(value) }) }, UKe: { default: isDeepStrictEqual },
    });
    vm.runInContext(HELPERS + merge, context);
    const HostStore = vm.runInContext(`(${storageClass})`, context);
    const host = new HostStore(memento), notifications = [];
    host.onDidUpdatePersistedAtom(event => notifications.push(event));
    await host.updatePersistedAtomValue("preference", "old");
    assert.equal(notifications.length, 0);
    const pending = Array.from({ length: 20 }, (_, i) => host.updatePersistedAtomValue("preference", i));
    await Promise.all(pending);
    await host.updatePersistedAtomValue("composer-prompt-drafts-v2", undefined, { entries: { 'azrael-project-draft:["A","new-conversation"]': { value: { prompt: "keep" } }, thread: { value: { prompt: "existing" } } } });
    const provider = vm.runInContext(`({${methods.get("sendPersistedAtomState")},${methods.get("broadcastPersistedAtomUpdate")}})`, context);
    provider.fetchWrapper = { extensionFetchHandler: { getWorkspaceProject: async () => ({ id: "A" }) } };
    provider.readPersistedAtomState = () => host.get("persisted-atom-state");
    const messages = [];
    provider.postMessageToWebview = (_view, message) => messages.push(clone(message));
    await provider.sendPersistedAtomState({});
    assert.equal(messages[0].state.preference, 19);
    assert.equal(messages[0].state["composer-prompt-drafts-v2"]["new-conversation"].prompt, "keep");
    assert.equal(messages[0].state["composer-prompt-drafts-v2"].thread.prompt, "existing");
    assert.equal(messages[0].state["mcp-server-tools-cache-v2"].large.length, 700000);
    assert.equal(mementoWrites, 1, "only migration clears Memento; regular saves never rewrite it");
    assert.equal(values.get("account"), "preserved");
    const previousNotifications = notifications.length;
    await host.updatePersistedAtomValue("composer-prompt-drafts-v2", undefined, { entries: { thread: { delete: true, expectedValue: { prompt: "stale" } } } });
    assert.equal(notifications.length, previousNotifications + 1, "conditional record no-op still returns authoritative state to reconcile optimistic UI");
    assert.equal(notifications.at(-1).value.thread.prompt, "existing");
    await host.resetPersistedAtoms();
    assert.deepEqual(clone(await host.get("persisted-atom-state")), {});
    await host.update("persisted-atom-state", { preference: "generic global-state route" });
    assert.deepEqual(clone(await host.get("persisted-atom-state")), { preference: "generic global-state route" });
    assert.equal(mementoWrites, 1, "generic whole-state route also uses SQLite instead of resurrecting Memento");
    await store.close(); store = undefined;
    assert.ok(stats.bytesWritten < 1000, "preference/draft saves exclude the 700KB MCP cache");
    assert.ok(stats.transactions < 10, "host burst reaches batching instead of serializing every save");
  } finally {
    await store?.close();
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true });
    assert.equal(fs.existsSync(directory), false);
  }
});

"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require(path.resolve("extensions/azrael-ex/node_modules/typescript/lib/typescript.js"));
const { transformAsset, getTransformRules } = require("./namespace-azrael-host.cjs");
const { createAssetTransformCache } = require("./asset-transform-cache.cjs");
const { PAGINATED_HISTORY_ASSET: asset } = require("./inject-paginated-history.cjs");
const source = fs.readFileSync(path.resolve("artifacts/upstream-ui/26.930.61225", asset), "utf8");
const transformed = transformAsset(source, asset, asset, ts);
const ast = ts.createSourceFile(asset, transformed.text, 99, true, ts.ScriptKind.JS);
function declaration(name) {
  const found = ast.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.equal(found.length, 1, name);
  return found[0].getText(ast);
}
function editHarness(turns, historyMode = "paginated") {
  const calls = [], starts = [], state = { turns, historyMode, cwd: "/workspace" };
  const context = {
    hZ: state => state.turns, yt: () => true, Re: (_old, message) => message,
    GTn: mode => { if (mode === "paginated") throw Error("unsupported history"); },
  };
  vm.createContext(context);
  vm.runInContext(["gZ", "_Z", "KTn"].map(declaration).join("\n"), context);
  const manager = {
    getConversation: () => state, getStreamRole: () => ({ role: "owner" }),
    requestClient: { getAppServerVersion: () => "0.159.3" },
    sendThreadFollowerRequest: async () => false, waitForPendingThreadSettingsUpdate: async () => {},
    sendRequest: async (method, params) => {
      calls.push({ method, params });
      if (method === "thread/rollback") throw Error("unknown variant thread/rollback");
      assert.equal(method, "thread/revert");
      return { thread: { cwd: "/workspace" }, turnsBackwardsCursor: "retained" };
    },
    applyRevertResponseToConversation: result => { calls.push({ apply: result }); },
  };
  return { calls, starts, run: () => context.KTn({ manager, conversationId: "thread", options: {
    turnId: "target", message: "edited", shouldSendPermissionOverrides: false,
  }, startTurn: async (...args) => starts.push(args), ownerWindowError: "owner required" }) };
}
const turn = (id, status, input = [{ type: "text", text: "original", text_elements: [] }]) => ({
  turnId: id, status, params: { input },
});
test("integrated source parses, records both transforms, and fingerprints every new owner", () => {
  assert.equal(ast.parseDiagnostics.length, 0);
  assert.equal(transformed.asset.paginatedHistoryEdits, 1);
  assert.equal(transformed.asset.immediateStopEdits, 1);
  const rules = getTransformRules();
  for (const file of ["inject-paginated-history.cjs", "inject-immediate-stop.cjs", "immediate-stop.cjs"])
    assert.match(rules[file], /^[a-f0-9]{64}$/);
  const context = {}; vm.createContext(context); vm.runInContext(declaration("wTn"), context);
  assert.equal(context.wTn({}, { approvalPolicy: "on-request" }, "legacy", "0.159.3").historyMode, "paginated");
});
test("integrated native edit of interrupted turn uses exact revert boundary then resubmits", async () => {
  const turns = [turn("previous", "completed"), turn("target", "interrupted"), turn("continuation", "interrupted", [])];
  const before = structuredClone(turns), h = editHarness(turns);
  await h.run();
  assert.equal(h.calls[0].method, "thread/revert");
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].params)), { threadId: "thread", beforeTurnId: "target" });
  assert.equal(h.calls[1].apply.revertedTurns.length, 2);
  assert.equal(h.starts.length, 1);
  assert.equal(h.starts[0][0].turnTrigger, "edit_user_message");
  assert.equal(h.starts[0][0].input[0].text, "edited");
  assert.deepEqual(turns, before);
});
test("integrated native edit blocks in-progress target or tail before revert and resubmit", async () => {
  for (const turns of [[turn("target", "inProgress")], [turn("target", "interrupted"), turn("later", "inProgress", [])]]) {
    const h = editHarness(turns); await assert.rejects(h.run(), /turn is in progress/);
    assert.equal(h.calls.length, 0); assert.equal(h.starts.length, 0);
  }
});
test("legacy edit and later real messages are outside the paginated change", async () => {
  const legacy = editHarness([turn("target", "interrupted")], "legacy");
  await assert.rejects(legacy.run(), /unknown variant/);
  assert.equal(legacy.calls[0].method, "thread/rollback");
  const later = editHarness([turn("target", "interrupted"), turn("later", "completed")]);
  await assert.rejects(later.run(), /most recent message/); assert.equal(later.calls.length, 0);
});
test("cached integrated asset retains edit/stop counters on an unchanged second pass", () => {
  const directory = fs.mkdtempSync(path.resolve("artifacts/verification/azrael-edit-stop-cache-"));
  try {
    const options = { cacheDirectory: directory, typescriptSha256: "a".repeat(64), typescriptVersion: ts.version,
      transformRules: getTransformRules() };
    const first = createAssetTransformCache(options);
    assert.equal(first.run(asset, source, () => transformed).asset.immediateStopEdits, 1); first.flush();
    const second = createAssetTransformCache(options);
    const result = second.run(asset, source, () => { throw Error("cache miss"); });
    assert.equal(result.asset.immediateStopEdits, 1); assert.equal(result.asset.paginatedHistoryEdits, 1);
    assert.equal(result.text, transformed.text); second.flush();
  } finally {
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync("artifacts/verification"));
    assert.ok(path.basename(directory).startsWith("azrael-edit-stop-cache-"));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

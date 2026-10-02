"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const patch = require("./inject-queued-compaction.cjs");
const { injectQueueRefresh } = require("./inject-queue-refresh.cjs");
const { rewriteJavaScript } = require("./namespace-azrael-host.cjs");

const root = process.env.AZRAEL_PINNED_HOST_ROOT ??
  path.join(__dirname, "../artifacts/upstream-ui/26.928.31416");
const inputs = [
  [patch.QUEUED_COMPACTION_CORE_ASSET, patch.injectQueuedCompactionCore],
  [patch.QUEUED_COMPACTION_PRESENTATION_ASSET, patch.injectQueuedCompactionPresentation],
  [patch.QUEUED_COMPACTION_LIST_ASSET, patch.injectQueuedCompactionList],
].map(([asset, inject]) => {
  const filename = path.join(root, asset);
  let before = rewriteJavaScript(fs.readFileSync(filename, "utf8"), filename, ts).text;
  if (asset === patch.QUEUED_COMPACTION_PRESENTATION_ASSET) before = injectQueueRefresh(before).text;
  return { asset, before, inject, result: inject(before) };
});

function compactFunction() {
  const source = inputs[0].result.text;
  const position = source.indexOf("/*azrael-queued-compaction-core-v1*/");
  assert.notEqual(position, -1);
  const ast = ts.createSourceFile("compaction.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let node;
  const visit = candidate => {
    if (candidate.pos <= position && candidate.end >= position) {
      if (ts.isFunctionDeclaration(candidate)) node = candidate;
      ts.forEachChild(candidate, visit);
    }
  };
  visit(ast);
  assert.ok(node);
  return source.slice(node.getStart(ast), node.end);
}

function fixture({ enabled = true, backlog = [] } = {}) {
  const calls = [];
  const fn = vm.runInNewContext(`(${compactFunction()})`, {
    aQ: async () => false,
    crypto: { randomUUID: () => "compaction-id" },
  });
  const manager = {
    waitForPendingThreadSettingsUpdate: async () => {},
    getConversation: () => null,
    getConversationCwd: () => "/workspace",
    getStreamRole: () => ({ role: "owner" }),
    turnCoordinator: {
      serverQueue: { isEnabled: () => enabled },
      loadMessages: async () => {},
      readState: () => ({ thread: backlog }),
    },
    sendRequest: async (method, params) => { calls.push({ method, params }); },
  };
  const options = {
    ownerWindowError: "owner unavailable",
    registerPendingManualContextCompaction() { throw Error("legacy placeholder used"); },
    removePendingManualContextCompaction() {},
  };
  return { fn, manager, options, calls };
}

test("manual compaction uses the server queue without a local placeholder", async () => {
  const f = fixture();
  await f.fn(f.manager, "thread", f.options);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [{
    method: "thread/queue/add",
    params: { threadId: "thread", input: [], clientUserMessageId: "compaction-id", kind: "contextCompaction" },
  }]);
});

test("manual compaction leaves a legacy backlog intact and refuses an unsupported queue", async () => {
  const backlog = [{ id: "existing-user-input" }];
  const occupied = fixture({ backlog });
  await assert.rejects(occupied.fn(occupied.manager, "thread", occupied.options), /Existing queued messages/);
  assert.equal(occupied.calls.length, 0);
  assert.deepEqual(backlog, [{ id: "existing-user-input" }]);

  const unsupported = fixture({ enabled: false });
  await assert.rejects(unsupported.fn(unsupported.manager, "thread", unsupported.options), /unavailable on this host/);
  assert.equal(unsupported.calls.length, 0);
});

test("the three version-pinned UI transforms parse, remain idempotent, and reject drift", () => {
  for (const { asset, before, inject, result } of inputs) {
    assert.equal(result.count, 1, asset);
    assert.equal(ts.createSourceFile(asset, result.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length, 0);
    assert.deepEqual(inject(result.text), { text: result.text, count: 0 });
    assert.throws(() => inject("changed host"), /anchor/);
    assert.throws(() => inject(before + before), /anchor/);
    assert.throws(() => inject(result.text + result.text), /Duplicate/);
  }
  assert.ok(inputs[1].result.text.includes("kind:s?.kind??T.context.queuedOperationKind"));
  assert.ok(inputs[2].result.text.includes("isSendNowDisabled:c||l&&R(e.context)||e.context.queuedOperationKind"));
  const presentation = inputs.find(({ asset }) => asset === patch.QUEUED_COMPACTION_PRESENTATION_ASSET);
  assert.throws(() => patch.injectQueuedCompactionPresentation(presentation.result.text.replace(
    "/*azrael-queued-compaction-presentation-v2*/", "/*azrael-queued-compaction-presentation-v1*/",
  )), /Stale/);
});

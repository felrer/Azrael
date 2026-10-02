"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { rewriteJavaScript } = require("./namespace-azrael-host.cjs");
const patch = require("./inject-deferred-turn.cjs");

const root = process.env.AZRAEL_PINNED_HOST_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.928.31416");
const inputs = [
  [patch.DEFERRED_REDUCER_ASSET, patch.injectDeferredTurn, 2],
  [patch.DEFERRED_PRESENTATION_ASSET, patch.injectDeferredPresentation, 4],
  ["out/extension.js", patch.injectDeferredHostNotification, 1],
].map(([asset, inject, count]) => {
  const file = path.join(root, asset);
  const source = rewriteJavaScript(fs.readFileSync(file, "utf8"), file, ts).text;
  return { file, source, result: inject(source), inject, count };
});

function functionContaining(source, marker) {
  const ast = ts.createSourceFile("reducer.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const position = source.indexOf(marker);
  assert.notEqual(position, -1);
  let found;
  function visit(node) {
    if (node.pos <= position && node.end >= position) {
      if (ts.isFunctionDeclaration(node)) found = node;
      ts.forEachChild(node, visit);
    }
  }
  visit(ast);
  assert.ok(found);
  return source.slice(found.getStart(ast), found.end);
}

function functionNamed(source, name) {
  const ast = ts.createSourceFile("presentation.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(found, name);
  return source.slice(found.getStart(ast), found.end);
}

test("deferred anchors match the pinned host, parse, and fail closed", () => {
  for (const { file, source, result, inject, count } of inputs) {
    assert.equal(result.count, count, file);
    assert.equal(ts.createSourceFile(file, result.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length, 0);
    assert.throws(() => inject(result.text), /anchor must occur exactly once/);
    assert.throws(() => inject("anchor missing"), /anchor must occur exactly once/);
    assert.notEqual(source, result.text);
  }
});

test("deferred updates the current turn without terminal side effects and drains before replay", () => {
  const reducer = vm.runInNewContext(`(${functionContaining(inputs[0].result.text, "case`turn/deferred`:")})`, { H: x => x });
  const turn = { turnId: "turn-1", status: "inProgress", error: { message: "stale" }, items: [] };
  const conversation = { turns: [turn] }, conversations = new Map([["thread-1", conversation]]), calls = [];
  let draining = true, replay;
  const manager = {
    logger: { error: () => calls.push("error") },
    broadcastConversationSnapshot: () => calls.push("snapshot"),
    onNotification: () => calls.push("replay"),
  };
  const notificationContext = {
    itemStreamState: { drainBefore: callback => { if (draining) replay = callback; return draining; } },
    threadStore: { conversations },
    updateTurnState: (_thread, _id, update) => { calls.push("update"); update(turn); },
  };
  const event = { method: "turn/deferred", params: { threadId: "thread-1", turn: { id: "turn-1", durationMs: 4250, startedAt: 12 } } };
  const environment = { manager, notificationContext };
  assert.equal(reducer(environment, event), "deferred");
  assert.deepEqual(calls, []);
  draining = false;
  replay();
  assert.deepEqual(calls, ["replay"]);
  assert.equal(reducer(environment, event), "handled");
  assert.deepEqual(calls, ["replay", "update", "snapshot"]);
  assert.equal(turn.status, "deferred");
  assert.equal(turn.durationMs, 4250);
  assert.equal(turn.turnStartedAtMs, 12000);
  assert.equal(turn.error, null);
  assert.equal(conversation.turns.length, 1);
});

test("presentation projects deferred duration and a frozen waiting divider", () => {
  const source = inputs[1].result.text;
  const status = vm.runInNewContext(`(${functionNamed(source, "Ont")})`);
  const duration = vm.runInNewContext(`(${functionNamed(source, "Hmt")})`);
  const divider = vm.runInNewContext(`(${functionNamed(source, "$mt")})`);
  assert.equal(status("deferred"), "deferred");
  assert.equal(duration({ turnStartedAtMs: 12000, durationMs: 4250 }), 16250);
  assert.deepEqual(JSON.parse(JSON.stringify(divider({ items: [{ type: "agent-message" }], status: "deferred", workStartedAtMs: 12000, finalAssistantStartedAtMs: 16250 }).at(-1))),
    { type: "worked-for", status: "azraelDeferred", startedAtMs: 12000, completedAtMs: 16250 });
  assert.deepEqual(JSON.parse(JSON.stringify(divider({ items: [], status: "deferred", workStartedAtMs: null, finalAssistantStartedAtMs: null })[0])),
    { type: "worked-for", status: "pausedUnknown", startedAtMs: 0, completedAtMs: 0 });
  assert.match(source, /case`azraelDeferred`:l=`\$\{s\} 작업 후 재개 대기`/);
  assert.match(source, /case`pausedUnknown`:l=`재개 대기`/);
  assert.ok(source.includes("durationMs"));
});

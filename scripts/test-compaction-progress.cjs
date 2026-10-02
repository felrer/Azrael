"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {
  COMPACTION_PROGRESS_MARKER,
  injectCompactionProgress,
} = require("./inject-compaction-progress.cjs");
const { rewriteJavaScript } = require("./namespace-azrael-host.cjs");

const projectRoot = path.resolve(__dirname, "..");
const reducerRelativePath = "webview/assets/app-initial-9f7d97690e9b.js";
const defaultPinnedRoot = path.join(
  projectRoot,
  "artifacts/upstream-ui/26.928.31416",
);
const pinnedOriginalPath = path.join(
  process.env.AZRAEL_PINNED_HOST_ROOT ?? defaultPinnedRoot,
  reducerRelativePath,
);
const typescriptPath = path.join(
  projectRoot,
  "extensions/azrael-ex/node_modules/typescript/lib/typescript.js",
);

for (const required of [pinnedOriginalPath, typescriptPath]) {
  assert.equal(fs.existsSync(required), true, `missing pinned test input: ${required}`);
}

const ts = require(typescriptPath);

function extractFunction(source, filename, name) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.deepEqual(ast.parseDiagnostics, [], `${filename} did not parse`);
  let found = null;
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    if (found == null) ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(found, `could not find ${name} in ${filename}`);
  return source.slice(found.getStart(ast), found.end);
}

function transformReducer(filename) {
  const original = fs.readFileSync(filename, "utf8");
  const namespaced = rewriteJavaScript(original, filename, ts).text;
  const transformed = injectCompactionProgress(namespaced);
  assert.equal(transformed.count, 1, `${filename} did not receive exactly one compaction-progress edit`);
  assert.equal(transformed.text.split(COMPACTION_PROGRESS_MARKER).length - 1, 1);
  assert.deepEqual(
    ts.createSourceFile(filename, transformed.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics,
    [],
    `${filename} no longer parses after compaction-progress injection`,
  );
  return transformed.text;
}

function reducerFrom(source, filename) {
  const reducerText = extractFunction(source, filename, "HCn");
  const upsertText = extractFunction(source, filename, "gh");
  const nativeUpsert = new vm.Script(`(${upsertText})`, { filename }).runInNewContext({
    Fn: () => false,
    vr: items => items,
  });
  const context = {
    H: value => value,
    YX: (conversation, turnId) => conversation.turns.find(turn => turn.turnId === turnId) ?? null,
    wZ: turn => { turn.items ??= []; return turn; },
    yh() {},
    EX: conversation => conversation.turns,
    TCn() {},
    VCn: item => item.type !== "userMessage" && item.type !== "hookPrompt",
    UCn: (_environment, item) => ({ ...item }),
    xr: item => ({ ...item }),
    gh: nativeUpsert,
  };
  return new vm.Script(`(${reducerText})`, { filename }).runInNewContext(context);
}

function runScenario(reducer) {
  const priorRetry = { id: "prior-retry", type: "error", message: "other turn", willRetry: true };
  const currentRetry = { id: "retry", type: "error", message: "retrying", willRetry: true };
  const terminalError = { id: "terminal", type: "error", message: "stopped", willRetry: false };
  const unspecifiedError = { id: "unspecified", type: "error", message: "old shape" };
  const message = { id: "message", type: "agentMessage", text: "keep me" };
  const completedItem = { id: "done", type: "commandExecution", status: "completed" };
  const turns = [
    { turnId: "turn-previous", status: "failed", items: [priorRetry] },
    {
      turnId: "turn-current",
      status: "inProgress",
      items: [
        currentRetry,
        terminalError,
        unspecifiedError,
        message,
        completedItem,
        { id: "compact-1", type: "contextCompaction", completed: true, source: "automatic" },
      ],
    },
  ];
  const conversation = { turns };
  const conversations = new Map([["thread-1", conversation]]);
  const environment = {
    manager: {
      logger: { error() {} },
      updateConversationState(threadId, update) { update(conversations.get(threadId)); },
    },
    notificationContext: {
      threadStore: { conversations },
      manualContextCompactions: {
        consumeSource() { return "automatic"; },
        removePendingItemFromTurn() {},
      },
    },
    createId: () => "generated",
  };
  const notification = {
    method: "item/started",
    params: {
      threadId: "thread-1",
      turnId: "turn-current",
      startedAtMs: 1234,
      item: { id: "compact-1", type: "contextCompaction" },
    },
  };

  assert.equal(reducer(environment, notification, null), "handled");
  assert.equal(reducer(environment, notification, null), "handled");

  const current = turns[1];
  assert.equal(turns[0].items[0], priorRetry, "a retry error from another turn was changed");
  assert.equal(current.status, "inProgress", "item progress changed the turn's completion state");
  assert.equal(current.items.includes(currentRetry), false, "the transient retry row remained");
  assert.equal(current.items.includes(terminalError), true, "a terminal error was removed");
  assert.equal(current.items.includes(unspecifiedError), true, "an error without willRetry=true was removed");
  assert.equal(current.items.includes(message), true, "a message was removed");
  assert.equal(current.items.includes(completedItem), true, "an unrelated completed item was changed");
  const compactions = current.items.filter(item => item.type === "contextCompaction");
  assert.equal(compactions.length, 1, "repeated same-ID progress created another compaction item");
  assert.deepEqual(JSON.parse(JSON.stringify(compactions[0])), {
    id: "compact-1",
    type: "contextCompaction",
    completed: false,
    startedAtMs: 1234,
    source: "automatic",
  });
  return JSON.parse(JSON.stringify(turns));
}

function runManualScenario(reducer) {
  const turn = { turnId: "turn-manual", status: "inProgress", items: [] };
  const conversations = new Map([["thread-manual", { turns: [turn] }]]);
  let pendingCount = 1;
  let consumeCount = 0;
  const environment = {
    manager: {
      logger: { error() {} },
      updateConversationState(threadId, update) { update(conversations.get(threadId)); },
    },
    notificationContext: {
      threadStore: { conversations },
      manualContextCompactions: {
        consumeSource() {
          consumeCount++;
          if (pendingCount === 0) return "automatic";
          pendingCount--;
          return "manual";
        },
        removePendingItemFromTurn() {},
      },
    },
    createId: () => "generated",
  };
  const notification = {
    method: "item/started",
    params: {
      threadId: "thread-manual", turnId: "turn-manual", startedAtMs: 1234,
      item: { id: "manual-compact-1", type: "contextCompaction" },
    },
  };
  assert.equal(reducer(environment, notification, null), "handled");
  assert.equal(consumeCount, 1);
  assert.equal(pendingCount, 0);
  assert.equal(turn.items[0].source, "manual");

  // A later manual request is pending while the first item's attempt resumes.
  pendingCount = 1;
  assert.equal(reducer(environment, notification, null), "handled");
  assert.equal(reducer(environment, notification, null), "handled");
  assert.equal(consumeCount, 1, "same-ID progress consumed another manual request");
  assert.equal(pendingCount, 1, "a later pending manual request was consumed");
  assert.equal(turn.items.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(turn.items[0])), {
    id: "manual-compact-1", type: "contextCompaction", completed: false, startedAtMs: 1234, source: "manual",
  });
}

const transformedInputs = [pinnedOriginalPath].map(filename => ({
  filename,
  source: transformReducer(filename),
}));

for (const { filename, source } of transformedInputs) {
  test(`real transformed reducer clears only current-turn retry errors: ${path.dirname(filename)}`, () => {
    const snapshot = runScenario(reducerFrom(source, filename));
    assert.deepEqual(snapshot.map(turn => ({
      turnId: turn.turnId,
      status: turn.status,
      itemIds: turn.items.map(item => item.id),
    })), [
      { turnId: "turn-previous", status: "failed", itemIds: ["prior-retry"] },
      {
        turnId: "turn-current",
        status: "inProgress",
        itemIds: ["terminal", "unspecified", "message", "done", "compact-1"],
      },
    ]);
  });
  test(`real transformed reducer preserves manual source across same-ID progress: ${path.dirname(filename)}`, () => {
    runManualScenario(reducerFrom(source, filename));
  });
}

test("injection is idempotent and fails closed when the pinned reducer anchor changes", () => {
  const first = injectCompactionProgress(
    "before let d=xr(u.type===`contextCompaction`?{...u,completed:!1,startedAtMs:c,source:a.manualContextCompactions.consumeSource(l)}:u);" +
    "u.type===`contextCompaction`&&a.manualContextCompactions.removePendingItemFromTurn(r),gh(r,d) after",
  );
  assert.equal(first.count, 1);
  const second = injectCompactionProgress(first.text);
  assert.equal(second.count, 0);
  assert.equal(second.text, first.text);
  assert.throws(() => injectCompactionProgress("anchor missing"), /anchor must occur exactly once/);
});



"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require(path.resolve("extensions/azrael-ex/node_modules/typescript/lib/typescript.js"));
const {
  PAGINATED_HISTORY_ASSET: asset,
  PAGINATED_HISTORY_MARKER: marker,
  injectPaginatedHistory,
} = require("./inject-paginated-history.cjs");
const pristine = fs.readFileSync(path.resolve("artifacts/upstream-ui/26.930.61225", asset), "utf8");
const transformed = injectPaginatedHistory(pristine, asset);

function creationDeclaration(source) {
  const ast = ts.createSourceFile(asset, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0, "pinned bundle parses");
  const found = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "wTn") found.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(found.length, 1, "one pinned native creation declaration");
  return found[0];
}
const originalDeclaration = creationDeclaration(pristine);
const patchedDeclaration = creationDeclaration(transformed.text);

function harness(declaration = patchedDeclaration) {
  const flags = [];
  const context = { yt(config, name) { flags.push(name); return config?.[name] === true; } };
  vm.createContext(context);
  vm.runInContext(declaration, context);
  return { create: context.wTn, flags };
}

test("pinned transform parses, is idempotent, and ignores other assets", () => {
  assert.equal(transformed.count, 1);
  assert.deepEqual(injectPaginatedHistory(transformed.text, asset), { text: transformed.text, count: 0 });
  assert.deepEqual(injectPaginatedHistory(pristine, "webview/assets/app-initial-future.js"), { text: pristine, count: 0 });
  assert.deepEqual(injectPaginatedHistory(marker + marker, "other.js"), { text: marker + marker, count: 0 });
});

test("missing, duplicate, altered, and damaged marked anchors fail closed", () => {
  assert.throws(() => injectPaginatedHistory("", asset), /anchor/);
  assert.throws(() => injectPaginatedHistory(pristine + originalDeclaration, asset), /anchor/);
  assert.throws(() => injectPaginatedHistory(pristine.replace("function wTn(e,t,n,r)", "function wTn(e,t,n,x)"), asset), /anchor/);
  assert.throws(() => injectPaginatedHistory(transformed.text + marker, asset), /Duplicate/);
  assert.throws(() => injectPaginatedHistory(pristine + marker, asset), /Damaged/);
  assert.throws(() => injectPaginatedHistory(transformed.text.replace(patchedDeclaration, ""), asset), /Damaged/);
  assert.throws(() => injectPaginatedHistory(transformed.text + patchedDeclaration, asset), /Damaged/);
  assert.throws(() => injectPaginatedHistory(transformed.text.replace(marker, ""), asset), /anchor/);
});

test("actual native persistent creation forces paginated for legacy, default, and paginated callers", () => {
  for (const mode of ["legacy", undefined, "paginated"]) {
    for (const enabled of [false, true]) {
      for (const ephemeral of [undefined, false]) {
        const h = harness();
        const input = Object.freeze({ conversationId: "new", historyMode: "legacy", ephemeral, config: Object.freeze({ custom: "kept" }) });
        const before = structuredClone(input);
        const result = h.create(input, { approvalPolicy: "on-request" }, mode, { defaultPaginatedHistory: enabled });
        assert.equal(result.historyMode, "paginated");
        assert.equal(result.conversationId, "new");
        assert.equal(result.config, input.config);
        assert.notEqual(result, input);
        assert.deepEqual(input, before);
        assert.deepEqual(h.flags, [], "creation no longer depends on the rollout flag");
      }
    }
  }
  const original = harness(originalDeclaration);
  const input = { historyMode: "legacy" };
  assert.equal(original.create(input, { approvalPolicy: "on-request" }, "legacy", { defaultPaginatedHistory: false }), input);
});

test("actual native ephemeral inputs preserve their history mode and identity", () => {
  for (const historyMode of [undefined, "legacy", "paginated"]) {
    for (const callerMode of [undefined, "legacy", "paginated"]) {
      const input = Object.freeze({ ephemeral: true, historyMode, config: Object.freeze({ custom: "kept" }) });
      const before = structuredClone(input);
      assert.equal(harness().create(input, { approvalPolicy: "on-request" }, callerMode, { defaultPaginatedHistory: true }), input);
      assert.deepEqual(input, before);
    }
  }
});

test("actual native permission-tool config remains identical to upstream for persistent and ephemeral creation", () => {
  for (const policy of [undefined, { approvalPolicy: { granular: {} } }, { approvalPolicy: "on-request" }]) {
    for (const ephemeral of [false, true]) {
      const input = Object.freeze({ ephemeral, historyMode: "legacy", config: Object.freeze({ custom: "kept", "features.request_permissions_tool": false }) });
      const before = structuredClone(input);
      const upstream = harness(originalDeclaration).create(input, policy, "legacy", {});
      const result = harness().create(input, policy, "legacy", {});
      assert.deepEqual(JSON.parse(JSON.stringify(result.config)), JSON.parse(JSON.stringify(upstream.config)));
      assert.equal(result.historyMode, ephemeral ? "legacy" : "paginated");
      assert.deepEqual(input, before);
    }
  }
});

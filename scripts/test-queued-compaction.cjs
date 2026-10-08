"use strict";

const assert = require("node:assert/strict");
const hs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const pm = require("node:vm");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const patch = require("./inject-queued-compaction.cjs");
const { injectQueueRefresh } = require("./inject-queue-refresh.cjs");
const { rewriteJavaScript } = require("./namespace-azrael-host.cjs");

const root = process.env.AZRAEL_PINNED_HOST_ROOT ??
  path.join(__dirname, "../artifacts/upstream-ui/26.930.61225");
const inputs = [
  [patch.QUEUED_COMPACTION_CORE_ASSET, patch.injectQueuedCompactionCore],
  [patch.QUEUED_COMPACTION_PRESENTATION_ASSET, patch.injectQueuedCompactionPresentation],
  [patch.QUEUED_COMPACTION_LIST_ASSET, patch.injectQueuedCompactionList],
].map(([asset, inject]) => {
  const filename = path.join(root, asset);
  let before = rewriteJavaScript(hs.readFileSync(filename, "utf8"), filename, ts).text;
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
  const fn = pm.runInNewContext(`(${compactFunction()})`, {
    KQ: async () => false,
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
  assert.ok(inputs[2].result.text.includes("isSendNowDisabled:o||s&&L(e.context)||e.context.queuedOperationKind"));
  const presentation = inputs.find(({ asset }) => asset === patch.QUEUED_COMPACTION_PRESENTATION_ASSET);
  assert.throws(() => patch.injectQueuedCompactionPresentation(presentation.result.text.replace(
    "/*azrael-queued-compaction-presentation-v3*/", "/*azrael-queued-compaction-presentation-v2*/",
  )), /Stale/);
});

test("marked compaction assets reject incomplete composer isolation", () => {
  const presentation = inputs.find(({ asset }) => asset === patch.QUEUED_COMPACTION_PRESENTATION_ASSET);
  for (const token of ["if(__azraelCompactActions.has(f))return;", "const __azraelCompactActions=new WeakMap;", "await __azraelRunSlashSelection(e,n,()=>THi("]) {
    assert.ok(presentation.result.text.includes(token));
    assert.throws(() => patch.injectQueuedCompactionPresentation(presentation.result.text.replace(token, "")), /composer isolation/);
  }
});

function listRenderer(source) {
  const ast = ts.createSourceFile("queued-list.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const renderer = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "Ve");
  assert.ok(renderer, "pinned queued row renderer");
  return { ast, renderer };
}

test("the actual queued row status is visible only while awaiting engine acceptance", () => {
  const list = inputs[2];
  const { ast, renderer } = listRenderer(list.result.text);
  let status, awaiting;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "N") awaiting = node.initializer;
    if (ts.isBinaryExpression(node) && node.left.getText(ast) === "W" &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isConditionalExpression(node.right)) status = node.right;
    ts.forEachChild(node, visit);
  };
  visit(renderer);
  assert.ok(status);
  assert.ok(awaiting);
  const jsx = (type, props) => ({ type, props });
  for (const [submission, paused, expected] of [
    [{ status: "pending" }, false, true], [{ status: "sending" }, false, true],
    [{ status: "queued" }, false, false], [{ status: "outcome-unknown" }, true, false],
    [{ status: "sending" }, true, false], [null, false, false],
  ]) {
    const N = pm.runInNewContext(awaiting.getText(ast), { o: submission, a: paused });
    assert.equal(N, expected);
    const rendered = pm.runInNewContext(status.getText(ast), { N, $: { jsx }, S: "localized-message" });
    if (!expected) {
      assert.equal(rendered, null);
      continue;
    }
    assert.equal(rendered.type, "span");
    assert.equal(rendered.props.role, "status");
    assert.equal(rendered.props["aria-live"], "polite");
    assert.equal(rendered.props.className, "text-text-tertiary text-xs select-none shrink-0");
    assert.equal(rendered.props.children.props.id, "azrael.queuedMessage.awaitingAcceptance");
    assert.equal(rendered.props.children.props.defaultMessage, "전송 대기 중");
    assert.match(rendered.props.children.props.description, /locally saved.*engine to accept/);
  }
  // The row's conditions, spinner, paused/unknown outcomes and controls stay
  // byte-for-byte upstream behavior; only its existing status span changes.
  const before = listRenderer(list.before);
  const oldSpan = "className:`sr-only select-none`,role:`status`,children:(0,$.jsx)(S,{id:`composer.queuedMessage.sending`,defaultMessage:`Sending`,description:`Status of a locally saved message waiting for the app server to accept it`})";
  const newSpan = status.whenTrue.getText(ast);
  assert.equal(renderer.getText(ast).replace(newSpan, `(0,$.jsx)(\`span\`,{${oldSpan}})`), before.renderer.getText(before.ast));
});

test("the preserved queued spinner dependency respects reduced motion", () => {
  const { ast, renderer } = listRenderer(inputs[2].result.text);
  assert.ok(renderer.getText(ast).includes("R=N?(0,$.jsx)(de,{className:`icon-2xs text-text-tertiary/70`}):F"));
  const imported = ast.statements.filter(ts.isImportDeclaration).find(node =>
    node.importClause?.namedBindings?.elements?.some(element => element.name.text === "de"));
  const symbol = imported.importClause.namedBindings.elements.find(element => element.name.text === "de").propertyName.text;
  const dependency = hs.readFileSync(path.join(root, "webview/assets", imported.moduleSpecifier.text), "utf8");
  const dependencyAst = ts.createSourceFile("spinner.js", dependency, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const exported = dependencyAst.statements.filter(ts.isExportDeclaration).flatMap(node => node.exportClause?.elements ?? [])
    .find(element => element.name.text === symbol);
  const spinner = dependencyAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === exported.propertyName.text);
  assert.ok(spinner);
  const jsx = (type, props) => ({ type, props });
  const render = pm.runInNewContext(`(${spinner.getText(dependencyAst)})`, {
    gBt: { c: count => Array(count).fill(Symbol("uninitialized")) },
    J: (...classes) => classes.filter(Boolean).join(" "), uPe: "spinner-icon",
    _Bt: { jsx }, hBt: () => {},
  });
  const result = render({ className: "icon-2xs text-text-tertiary/70" });
  assert.ok(result.props.className.split(" ").includes("motion-safe:animate-spin"));
  assert.ok(!result.props.className.split(" ").includes("animate-spin"));
});

test("queued list v2 rejects stale, missing and partial waiting-label transforms", () => {
  const { before, result, inject } = inputs[2];
  assert.throws(() => inject(result.text.replace("/*azrael-queued-compaction-list-v2*/", "/*azrael-queued-compaction-list-v1*/")), /Stale/);
  assert.throws(() => inject(before.replace("composer.queuedMessage.sending", "changed.message")), /anchor/);
  assert.throws(() => inject(before.replace("sr-only select-none", "changed-class")), /anchor/);
  for (const [anchor, replacement] of [
    ["azrael.queuedMessage.awaitingAcceptance", "composer.queuedMessage.sending"],
    ["text-text-tertiary text-xs select-none shrink-0", "sr-only select-none"],
    ["\"aria-live\":`polite`,", ""],
    ["onEditMessage:e.context.queuedOperationKind===`contextCompaction`?void 0:d", "onEditMessage:d"],
  ]) assert.throws(() => inject(result.text.replace(anchor, replacement)), /Invalid.*list replacement/);
  assert.deepEqual(inject(result.text), { text: result.text, count: 0 });
});

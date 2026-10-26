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

const root = process.env.AZRAEL_PRESERVATION_UI_ROOT ?? process.env.AZRAEL_PINNED_HOST_ROOT ??
  path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.join(__dirname, "../artifacts/upstream-ui/26.1007.21434"));
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

  return source.slice(node.getStart(ast), node.end);
}

function fixture({ enabled = true, backlog = [] } = {}) {
  const calls = [];
  const fn = pm.runInNewContext(`(${compactFunction()})`, {
    I$: async () => false,
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

    assert.equal(ts.createSourceFile(asset, result.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length, 0);
    assert.equal(inject(result.text).text, result.text);
    assert.throws(() => inject("changed host"), /anchor/);
    assert.throws(() => inject(before + before), /anchor/);
    assert.throws(() => inject(result.text + result.text), /Duplicate/);
  }

  const presentation = inputs.find(({ asset }) => asset === patch.QUEUED_COMPACTION_PRESENTATION_ASSET);
  assert.throws(() => patch.injectQueuedCompactionPresentation(presentation.result.text.replace(
    "/*azrael-queued-compaction-presentation-v5*/", "/*azrael-queued-compaction-presentation-v4*/",
  )), /Stale/);
});

test("native host subscribes to warning notifications with a pinned, idempotent transform", () => {
  const filename = path.join(root, patch.QUEUED_COMPACTION_HOST_ASSET);
  const before = rewriteJavaScript(hs.readFileSync(filename, "utf8"), filename, ts).text;
  const result = patch.injectQueuedCompactionHost(before);

  assert.equal(ts.createSourceFile(filename, result.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length, 0);

  assert.equal(patch.injectQueuedCompactionHost(result.text).text, result.text);
  assert.throws(() => patch.injectQueuedCompactionHost("changed host"), /anchor/);
  assert.throws(() => patch.injectQueuedCompactionHost(result.text.replace("warning:/*azrael-queued-compaction-host-v1*/!0", "warning:/*azrael-queued-compaction-host-v1*/!1")), /subscription/);
});

test("marked presentation assets reject missing skip feedback", () => {
  const source = inputs[1].result.text;
  for (const [before, after] of [
    ["guardianWarning:!0,warning:!0", "guardianWarning:!0,warning:!1"],
    ["azrael.compaction.skipped.reason", "changed.reason"],
    [JSON.stringify(patch.COMPACTION_SKIPPED_MESSAGE), '"unrelated warning"'],
  ]) assert.throws(() => patch.injectQueuedCompactionPresentation(source.replace(before, after)), /skip notice/);
});

test("compaction skip warnings show localized native feedback even with diagnostics disabled", () => {
  const source = inputs[1].result.text;
  const ast = ts.createSourceFile("compaction-notification.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const handler = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "_Xa");

  for (const locale of ["ko-KR", "en"]) {
    const notices = [];
    const fn = pm.runInNewContext(`(${handler.getText(ast)})`, { gx() {}, fm: "intl", hx: "toast", bXa: "diagnostics" });
    const scope = { get(atom) {
      if (atom === "intl") return { locale, formatMessage: ({ defaultMessage }) => defaultMessage };
      if (atom === "toast") return { warning: (title, options) => notices.push({ title, ...options }) };
      assert.equal(atom, "diagnostics");
      return false;
    } };
    const skipped = { hostId: "local", method: "warning", params: { threadId: "thread", message: patch.COMPACTION_SKIPPED_MESSAGE } };
    fn(scope, skipped);
    fn(scope, skipped);
    assert.equal(notices.length, 2, "each skipped request is acknowledged");
    assert.equal(notices[0].title, locale === "ko-KR" ? "압축을 실행하지 않았습니다" : "Context compaction was skipped");
    assert.ok(notices[0].description.includes("80,000"));
    for (const notification of [
      { ...skipped, method: "thread/queue/changed" },
      { ...skipped, params: { threadId: "thread", message: "unrelated warning" } },
      { ...skipped, params: { message: patch.COMPACTION_SKIPPED_MESSAGE } },
      { ...skipped, params: null },
    ]) fn(scope, notification);
    assert.equal(notices.length, 2, "queue changes, unrelated warnings and malformed input produce no skip notice");
  }
  const rust = hs.readFileSync(path.join(__dirname, "../engine/codex-rs/core/src/session/compact_input.rs"), "utf8");
  assert.ok(rust.includes(JSON.stringify(patch.COMPACTION_SKIPPED_MESSAGE)), "native warning and host recognition share the same contract");
});

test("marked compaction assets reject incomplete composer isolation", () => {
  const presentation = inputs.find(({ asset }) => asset === patch.QUEUED_COMPACTION_PRESENTATION_ASSET);
  for (const token of ["if(__azraelCompactActions.has(p))return;", "const __azraelCompactActions=new WeakMap;", "await __azraelRunSlashSelection(e,n,()=>I2i("]) {

    assert.throws(() => patch.injectQueuedCompactionPresentation(presentation.result.text.replace(token, "")), /composer isolation/);
  }
});

function listRenderer(source) {
  const ast = ts.createSourceFile("queued-list.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const renderer = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "We");

  return { ast, renderer };
}

test("the actual queued row status is visible only while awaiting engine acceptance", () => {
  const list = inputs[2];
  const { ast, renderer } = listRenderer(list.result.text);
  let status, awaiting;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "N") awaiting = node.initializer;
    if (ts.isBinaryExpression(node) && node.left.getText(ast) === "G" &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isConditionalExpression(node.right)) status = node.right;
    ts.forEachChild(node, visit);
  };
  visit(renderer);

  const jsx = (type, props) => ({ type, props });
  for (const [submission, paused, expected] of [
    [{ status: "pending" }, false, true], [{ status: "sending" }, false, true],
    [{ status: "queued" }, false, false], [{ status: "outcome-unknown" }, true, false],
    [{ status: "sending" }, true, false], [null, false, false],
  ]) {
    const N = pm.runInNewContext(awaiting.getText(ast), { u: submission, l: paused });
    assert.equal(N, expected);
    const rendered = pm.runInNewContext(status.getText(ast), { N, $: { jsx }, c: "localized-message" });
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


});

test("the preserved queued spinner dependency respects reduced motion", () => {
  const { ast } = listRenderer(inputs[2].result.text);

  const imported = ast.statements.filter(ts.isImportDeclaration).find(node =>
    node.importClause?.namedBindings?.elements?.some(element => element.name.text === "ue"));
  const symbol = imported.importClause.namedBindings.elements.find(element => element.name.text === "ue").propertyName.text;
  const dependency = hs.readFileSync(path.join(root, "webview/assets", imported.moduleSpecifier.text), "utf8");
  const dependencyAst = ts.createSourceFile("spinner.js", dependency, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const exported = dependencyAst.statements.filter(ts.isExportDeclaration).flatMap(node => node.exportClause?.elements ?? [])
    .find(element => element.name.text === symbol);
  const spinner = dependencyAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === exported.propertyName.text);

  const jsx = (type, props) => ({ type, props });
  const render = pm.runInNewContext(`(${spinner.getText(dependencyAst)})`, {
    wGt: { c: count => Array(count).fill(Symbol("uninitialized")) },
    ru: (...classes) => classes.filter(Boolean).join(" "), H3e: "spinner-icon",
    TGt: { jsx }, CGt: () => {},
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
    ["onEditMessage:e.context.queuedOperationKind===`contextCompaction`?void 0:m", "onEditMessage:m"],
  ]) assert.throws(() => inject(result.text.replace(anchor, replacement)), /Invalid.*list replacement/);
  assert.equal(inject(result.text).text, result.text);
});

"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ts = require(require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
const { UI_CLEANUP_ASSETS, COMPOSER_ASSET, PERMISSIONS_ASSET, MARKER, injectUiCleanup } = require("./inject-ui-cleanup.cjs");
const original = Object.fromEntries(UI_CLEANUP_ASSETS.map(p => [p, fs.readFileSync(path.resolve(__dirname, "../artifacts/upstream-ui/26.928.31416", p), "utf8")]));
const transformed = Object.fromEntries(UI_CLEANUP_ASSETS.map(p => [p, injectUiCleanup(original[p], p, ts).text]));
function parsed(text) { return ts.createSourceFile("ui.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS); }
function fn(text, name) { const f = parsed(text); return f.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)?.getText(f); }
function nodes(text, predicate) { const f = parsed(text), found = []; function visit(n) { if (predicate(n)) found.push(n.getText(f)); ts.forEachChild(n, visit); } visit(f); return found; }
const memo = { c: n => Array(n).fill(Symbol.for("react.memo_cache_sentinel")) };
const jsx = (type, props) => ({ type, props });

test("both pinned assets parse; unrelated assets, repeat invocation and corrupted anchors fail closed", () => {
  for (const p of UI_CLEANUP_ASSETS) {
    assert.equal(parsed(transformed[p]).parseDiagnostics.length, 0);
    assert.equal(injectUiCleanup(transformed[p], p, ts).count, 0);
    assert.equal(injectUiCleanup(original[p], p, ts).count, 1);
    assert.throws(() => injectUiCleanup(original[p] + MARKER, p, ts));
    assert.throws(() => injectUiCleanup(transformed[p] + MARKER, p, ts));
  }
  assert.deepEqual(injectUiCleanup(original[COMPOSER_ASSET], "other.js", ts), { text: original[COMPOSER_ASSET], count: 0 });
  assert.throws(() => injectUiCleanup(original[COMPOSER_ASSET].replace("function Oaa(e)", "function Changed(e)"), COMPOSER_ASSET, ts));
  assert.throws(() => injectUiCleanup(original[COMPOSER_ASSET].replace("D6(C),null}function kaa", "D6(X),null}function kaa"), COMPOSER_ASSET, ts));
  assert.throws(() => injectUiCleanup(original[PERMISSIONS_ASSET].replace("At=kt?`warning`", "At=kt?`changed`"), PERMISSIONS_ASSET, ts));
  assert.throws(() => injectUiCleanup(transformed[COMPOSER_ASSET].replace('return "-";', 'return "changed";'), COMPOSER_ASSET, ts));
});

test("actual transformed placeholder returns literal ASCII hyphen for every composer variant", () => {
  const get = vm.runInNewContext(`(${fn(transformed[COMPOSER_ASSET], "c_i")})`);
  for (const followUpType of [undefined, "cloud", "local"])
    for (const composerMode of ["cloud", "local"])
      for (const flags of [{}, { isGoalModeActive: true }, { isPlanModeActive: true }, { isImageMarkupActive: true }, { isCompactFloatingComposer: true, isResponseInProgress: true }, { placeholderText: "custom" }, { isBackgroundSubagentsPanelVisible: true }])
        assert.equal(get({ intl: { formatMessage() { throw new Error("translation must not override placeholder"); } }, followUpType, composerMode, ...flags }), "-");
});

test("registration/mounts and sketch dispatch removed; attachments and shared recovery preserved", async () => {
  const text = transformed[COMPOSER_ASSET];
  for (const name of ["Oaa", "Via", "FQi", "kaa", "Aaa", "Hia", "Wia"]) {
    assert.ok(nodes(original[COMPOSER_ASSET], n => ts.isIdentifier(n) && n.text === name).length >= 2, `pinned ${name} must have a declaration and value reference`);
    assert.equal(fn(text, name), undefined);
    assert.equal(nodes(text, n => ts.isIdentifier(n) && n.text === name).length, 0);
  }
  const removed = nodes(text, n => ts.isPropertyAssignment(n) && n.name.getText() === "id" && ts.isStringLiteralLike(n.initializer) && ["goal", "plan-mode", "sketch"].includes(n.initializer.text));
  assert.deepEqual(removed, []);
  assert.ok(text.includes("context-action:pick-local-files"));
  assert.ok(!text.includes("command:goal") && !text.includes("command:plan-mode"));
  const sharedComposer = fn(text, "h0i");
  assert.ok(!sharedComposer.includes("Ao.current?.openNew"));
  assert.ok(sharedComposer.includes("Ao.current?.openAttachment"));
  const capability = nodes(sharedComposer, n => ts.isVariableDeclaration(n) && n.name.getText() === "us" && n.initializer?.getText() === "()=>!1");
  assert.equal(capability.length, 1);
  assert.equal(vm.runInNewContext(`(()=>{let ${capability[0]};return us()})()`), false);
  for (const preserved of ["onClearGoal:Tc", "sketchComposer:Se", "retainAttachmentForUndo(e)", "handleRemoveFileAttachment:jc"])
    assert.ok(text.includes(preserved), preserved);
  const context = { wL: () => true, qVn: {}, UVn: () => true, EL: () => false, WVn: () => 0, JVn: { search: "search-icon" }, YVn: { search: [] } };
  const catalog = vm.runInNewContext(`(${fn(text, "RVn")})`, context);
  const entries = catalog([{ system_hint: "sketch", name: "Sketch", aliases: [] }, { system_hint: "search", name: "Search", aliases: [] }], { sketchEligibility: { canEditSketch: true, canOpenSketch: true } });
  assert.equal(entries.length, 1); assert.equal(entries[0].systemHint, "search");
  const registered = [], selected = [], local = [];
  const dispatch = vm.runInNewContext(`(${fn(text, "sQi")})`, {
    cQi: memo, Jo: () => ({}), $: {}, ba: () => ({ formatMessage: e => e.defaultMessage }), EL: () => false,
    Bm: () => {}, cfe: {}, D6: e => registered.push(e),
  });
  dispatch({ command: { kind: "local_action", systemHint: "sketch", title: "Sketch", searchAliases: [], disabled: false }, selectedSystemHints: [], onSystemHintsChange: e => selected.push(e), onLocalAction: e => local.push(e) });
  await registered[0].onSelect(); assert.deepEqual(local, []); assert.deepEqual(selected, []);
  dispatch({ command: { kind: "system_hint", systemHint: "search", title: "Search", searchAliases: [] }, selectedSystemHints: [], onSystemHintsChange: e => selected.push(e) });
  await registered[1].onSelect(); assert.equal(selected[0][0], "search");
  const attachments = [], pickerOptions = [], picker = { supportsFileAttachments: true, executionTargetHostId: "local", labels: { filesAndFolders: "Files and folders" }, getAttachmentGeneration: () => 1,
    pickFiles: async options => { pickerOptions.push(options); return { files: ["file", "folder"], orderKeys: ["a", "b"] }; },
    addPickedFiles: async (files, options) => attachments.push({ files, options }), onFilePickerError: error => { throw error; } };
  const attachmentContext = vm.createContext({});
  vm.runInContext(fn(text, "ida") + ";" + fn(text, "rda"), attachmentContext);
  const attachmentActions = attachmentContext.rda(picker);
  assert.equal(attachmentActions[0].id, "pick-local-files");
  await attachmentActions[0].run();
  assert.equal(pickerOptions[0].imagesOnly, false); assert.equal(attachments[0].files[1], "folder");
  assert.equal(attachments[0].options.imagesOnly, false);
});

test("cleanup applies after the production namespace rewrite on both pinned assets", () => {
  const transformer = require("./namespace-azrael-host.cjs");
  for (const p of UI_CLEANUP_ASSETS) {
    const namespaced = transformer.rewriteJavaScript(original[p], p, ts);
    assert.ok(namespaced.count > 0, "test must exercise actual namespace edits");
    const cleanup = injectUiCleanup(namespaced.text, p, ts);
    assert.equal(cleanup.count, 1);
    assert.equal(parsed(cleanup.text).parseDiagnostics.length, 0);
    assert.equal(injectUiCleanup(cleanup.text, p, ts).count, 0);
    if (p === COMPOSER_ASSET) {
      assert.equal(vm.runInNewContext(`(${fn(cleanup.text, "c_i")})`)({}), "-");
      assert.equal(nodes(cleanup.text, n => ts.isIdentifier(n) && ["Oaa", "Via", "FQi", "kaa", "Aaa", "Hia", "Wia"].includes(n.text)).length, 0);
    }
  }
});

test("actual transformed permission description, chip and menu use neutral colors with selection callback intact", () => {
  const text = transformed[PERMISSIONS_ASSET], desc = vm.runInNewContext(`(${fn(text, "pn")})`, { vn: memo, Q: { jsx }, s: "message" });
  const full = desc({ permissionSelection: { kind: "agent-mode", agentMode: "full-access" } });
  const ask = desc({ permissionSelection: { kind: "agent-mode", agentMode: "auto" } });
  assert.equal(full.props.className, ask.props.className);
  for (const [name, expected] of [["At", "tertiary"], ["Y", "text-tertiary"]]) {
    const declaration = nodes(text, n => ts.isVariableDeclaration(n) && n.name.getText() === name && n.initializer?.getText().includes(expected));
    assert.equal(declaration.length, 1);
    assert.equal(vm.runInNewContext(`(()=>{let ${declaration[0]};return ${name}})()`), expected);
  }
  const object = nodes(text, n => ts.isObjectLiteralExpression(n) && n.properties.some(p => ts.isPropertyAssignment(p) && p.name.getText() === "LeftIcon" && p.initializer.getText() === "dt"));
  assert.equal(object.length, 1);
  const selected = [], callback = () => selected.push("full-access");
  const item = vm.runInNewContext(`(${object[0]})`, { dt: "icon", p: (...v) => v.join(" "), J: null, K: "full-access", Fe: "check", qt: callback, St: true, q: false, $: { jsx }, s: "message" });
  assert.equal(item.leftIconClassName, "icon-sm"); assert.equal(item.rightIconClassName, "icon-xs");
  assert.equal(item.SubText.props.className, "text-codex-description"); assert.equal(item.children.props.className, "text-default");
  assert.equal(item.RightIcon, "check"); assert.equal(item.disabled, false); item.onClick(); assert.deepEqual(selected, ["full-access"]);
});

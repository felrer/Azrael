"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), hs = require("node:fs"), path = require("node:path"), pm = require("node:vm");
const ts = require(require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
const { UI_CLEANUP_ASSETS, COMPOSER_ASSET, PERMISSIONS_ASSET, MARKER, injectUiCleanup } = require("./inject-ui-cleanup.cjs");
const original = Object.fromEntries(UI_CLEANUP_ASSETS.map(p => [p, hs.readFileSync(path.resolve(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.resolve(__dirname, "../artifacts/upstream-ui/26.1007.21434"), p), "utf8")]));
const transformed = Object.fromEntries(UI_CLEANUP_ASSETS.map(p => [p, injectUiCleanup(original[p], p, ts).text]));
const parsedFixtures = new Map();
const canonicalFixtures = new Set([...Object.values(original), ...Object.values(transformed)]);
function parsed(text) {
  if (parsedFixtures.has(text)) return parsedFixtures.get(text);
  const file = ts.createSourceFile("ui.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (canonicalFixtures.has(text)) parsedFixtures.set(text, file);
  return file;
}
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
  assert.throws(() => injectUiCleanup(original[COMPOSER_ASSET].replace("function aOa(e)", "function Changed(e)"), COMPOSER_ASSET, ts));
  assert.throws(() => injectUiCleanup(original[COMPOSER_ASSET].replace("J3(C),null}function oOa", "ChangedHook(C),null}function oOa"), COMPOSER_ASSET, ts));
  assert.throws(() => injectUiCleanup(original[PERMISSIONS_ASSET].replace("f=d?`warning`", "f=d?`changed`"), PERMISSIONS_ASSET, ts));
  assert.throws(() => injectUiCleanup(transformed[COMPOSER_ASSET].replace('return "^•⩊•^";', 'return "changed";'), COMPOSER_ASSET, ts));
});

test("actual transformed placeholder returns the cat text emoticon for every composer variant", () => {
  const get = pm.runInNewContext(`(${fn(transformed[COMPOSER_ASSET], "mPi")})`);
  for (const followUpType of [undefined, "cloud", "local"])
    for (const composerMode of ["cloud", "local"])
      for (const flags of [{}, { isGoalModeActive: true }, { isPlanModeActive: true }, { isImageMarkupActive: true }, { isCompactFloatingComposer: true, isResponseInProgress: true }, { placeholderText: "custom" }, { isBackgroundSubagentsPanelVisible: true }])
        assert.equal(get({ intl: { formatMessage() { throw new Error("translation must not override placeholder"); } }, followUpType, composerMode, ...flags }), "^•⩊•^");
});

test("retired slash-menu registrations are removed while toolbar and other commands remain", () => {
  const text = transformed[COMPOSER_ASSET];
  for (const name of ["YDa", "sDa", "vDa", "hOa", "FEa", "HEa"]) {
    assert.ok(fn(original[COMPOSER_ASSET], name)?.includes("J3("), `pinned registration ${name}`);
    assert.equal(fn(text, name), undefined);
    assert.equal(nodes(text, n => ts.isIdentifier(n) && n.text === name).length, 0);
    assert.throws(() => injectUiCleanup(original[COMPOSER_ASSET].replace(`function ${name}(`, `function Changed${name}(`), COMPOSER_ASSET, ts));
  }
  // This is the existing model selector leaf, independent of slash commands.
  assert.equal(fn(text, "B8"), fn(original[COMPOSER_ASSET], "B8"));
  for (const name of ["rDa", "JEa", "RXn", "Oua"])
    assert.ok(fn(text, name), `retained command component ${name}`);
  assert.ok(!fn(text, "zEa").includes("jsx)(FEa"));
  assert.ok(!fn(text, "zEa").includes("jsx)(HEa"));
});

test("goal and plan removed; sketch entry points and attachments preserved", async () => {
  const text = transformed[COMPOSER_ASSET];
  for (const name of ["aOa", "uDa", "oOa", "sOa", "dDa", "pDa"]) {
    assert.ok(nodes(original[COMPOSER_ASSET], n => ts.isIdentifier(n) && n.text === name).length >= 2, `pinned ${name} must have a declaration and value reference`);
    assert.equal(fn(text, name), undefined);
    assert.equal(nodes(text, n => ts.isIdentifier(n) && n.text === name).length, 0);
  }
  const removed = nodes(text, n => ts.isPropertyAssignment(n) && n.name.getText() === "id" && ts.isStringLiteralLike(n.initializer) && ["goal", "plan-mode"].includes(n.initializer.text));
  assert.deepEqual(removed, []);
  assert.ok(text.includes("context-action:pick-local-files"));
  assert.ok(!text.includes("command:goal") && !text.includes("command:plan-mode"));
  const sharedComposer = fn(text, "Ypa");
  assert.equal(sharedComposer, fn(original[COMPOSER_ASSET], "Ypa"));
  for (const name of ["uda", "RXn", "Oua"])
    assert.equal(fn(text, name), fn(original[COMPOSER_ASSET], name));
  assert.ok(fn(text, "bFa").includes("jsx)(uda,{ref:De"));
  for (const preserved of ["onClearGoal:", "sketchComposer:", "retainAttachmentForUndo(e)", "handleRemoveFileAttachment:"])
    assert.ok(text.includes(preserved), preserved);
  const context = { RI: () => true, JXn: {}, WXn: () => true, VI: () => false, GXn: () => 0, A2t: "sketch-16", j2t: "sketch-20", YXn: { search: "search-icon" }, XXn: { search: [] } };
  const catalog = pm.runInNewContext(`(${fn(text, "RXn")})`, context);
  const entries = catalog([{ system_hint: "sketch", name: "Sketch", aliases: [] }, { system_hint: "search", name: "Search", aliases: [] }], { sketchEligibility: { canEditSketch: true, canOpenSketch: true } });
  assert.equal(entries.length, 2);
  const sketch = entries.find(e => e.systemHint === "sketch");
  assert.equal(sketch.kind, "local_action"); assert.equal(sketch.disabled, false);
  const disabled = catalog([{ system_hint: "sketch", name: "Sketch", aliases: [] }], { sketchEligibility: { canEditSketch: true, canOpenSketch: false } });
  assert.equal(disabled[0].disabled, true);
  const registered = [], selected = [], local = [];
  const dispatch = pm.runInNewContext(`(${fn(text, "Oua")})`, {
    kua: memo, Ou: () => ({}), $: {}, st: () => ({ formatMessage: e => e.defaultMessage }), VI: () => false,
    yh: () => {}, Qge: {}, J3: e => registered.push(e),
  });
  dispatch({ command: { kind: "local_action", systemHint: "sketch", title: "Sketch", searchAliases: [], disabled: false }, selectedSystemHints: [], onSystemHintsChange: e => selected.push(e), onLocalAction: e => local.push(e) });
  await registered[0].onSelect(); assert.deepEqual(local, ["sketch"]); assert.deepEqual(selected, []);
  dispatch({ command: { kind: "system_hint", systemHint: "search", title: "Search", searchAliases: [] }, selectedSystemHints: [], onSystemHintsChange: e => selected.push(e) });
  await registered[1].onSelect(); assert.equal(selected[0][0], "search");
  const attachments = [], pickerOptions = [], picker = { supportsFileAttachments: true, executionTargetHostId: "local", labels: { filesAndFolders: "Files and folders" }, getAttachmentGeneration: () => 1,
    pickFiles: async options => { pickerOptions.push(options); return { files: ["file", "folder"], orderKeys: ["a", "b"] }; },
    addPickedFiles: async (files, options) => attachments.push({ files, options }), onFilePickerError: error => { throw error; } };
  const attachmentContext = pm.createContext({});
  pm.runInContext(fn(text, "NNa") + ";" + fn(text, "MNa"), attachmentContext);
  const attachmentActions = attachmentContext.MNa(picker);
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
      assert.equal(pm.runInNewContext(`(${fn(cleanup.text, "mPi")})`)({}), "^•⩊•^");
      assert.equal(nodes(cleanup.text, n => ts.isIdentifier(n) && ["aOa", "uDa", "oOa", "sOa", "dDa", "pDa"].includes(n.text)).length, 0);
    }
  }
});

test("actual transformed permission description, chip and menu use neutral colors with selection callback intact", () => {
  const text = transformed[PERMISSIONS_ASSET], desc = pm.runInNewContext(`(${fn(text, "cn")})`, { pn: memo, Q: { jsx }, a: "message" });
  const full = desc({ permissionSelection: { kind: "agent-mode", agentMode: "full-access" } });
  const ask = desc({ permissionSelection: { kind: "agent-mode", agentMode: "auto" } });
  assert.equal(full.props.className, ask.props.className);
  for (const [name, expected] of [["f", "tertiary"], ["p", "text-tertiary"]]) {
    const declaration = nodes(text, n => ts.isVariableDeclaration(n) && n.name.getText() === name && n.initializer?.getText().includes(expected));
    assert.equal(declaration.length, 1);
    assert.equal(pm.runInNewContext(`(()=>{let ${declaration[0]};return ${name}})()`), expected);
  }
  const object = nodes(text, n => ts.isObjectLiteralExpression(n) && n.properties.some(p => ts.isPropertyAssignment(p) && p.name.getText() === "LeftIcon" && p.initializer.getText() === "azraelFullAccessIcon"));
  assert.equal(object.length, 1);
  const selected = [], callback = () => selected.push("full-access");
  const item = pm.runInNewContext(`(${object[0]})`, { azraelFullAccessIcon: "icon", l: (...v) => v.join(" "), Je: null, J: "full-access", Pe: "check", It: callback, vt: true, q: false, $: { jsx }, a: "message" });
  assert.equal(item.leftIconClassName, "icon-sm"); assert.equal(item.rightIconClassName, "icon-xs");
  assert.equal(item.SubText.props.className, "text-codex-description"); assert.equal(item.children.props.className, "text-default");
  assert.equal(item.RightIcon, "check"); assert.equal(item.disabled, false); item.onClick(); assert.deepEqual(selected, ["full-access"]);
});

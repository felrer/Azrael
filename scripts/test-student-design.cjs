"use strict";
const assert = require("node:assert/strict");
const ms = require("node:fs");
const path = require("node:path");
const _m = require("node:vm");
const test = require("node:test");
const vp = require(process.env.AZRAEL_PRESERVATION_TYPESCRIPT_PATH ?? require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
const { DESIGN_ASSETS, injectStudentDesign, createDesignStore, AzraelStudentAvatar, AzraelDesignSettings, pickStudentPreview, observeStudentCreated } = require("./inject-student-design.cjs");
const { injectInstructionSettings } = require("./inject-instruction-settings.cjs");
const { injectAccountSettings } = require("./inject-account-settings.cjs");
const root = (process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.resolve(__dirname, "../artifacts/upstream-ui/26.930.61225"));

test("native navigation custom icons retain active class and suppress assets only for their slugs", () => {
  const { transformAsset } = require("./namespace-azrael-host.cjs");
  const asset = DESIGN_ASSETS[2], filename = path.join(root, asset);
  const text = transformAsset(ms.readFileSync(filename, "utf8"), asset, filename, vp).text;
  const ast = vp.createSourceFile(asset, text, vp.ScriptTarget.Latest, true, vp.ScriptKind.JS);
  const expressions = {};
  const visit = node => {
    if (vp.isPropertyAssignment(node) && ["icon", "iconAssetSource"].includes(node.name.getText(ast)) && node.initializer.getText(ast).includes('e.slug===`azrael-design`')) expressions[node.name.getText(ast)] = node.initializer.getText(ast);
    vp.forEachChild(node, visit);
  };
  visit(ast);
  assert(expressions.icon && expressions.iconAssetSource);
  for (const slug of ["azrael-design", "azrael-instructions", "usage", "general-settings", "pets"]) {
    for (const active of [false, true]) {
      const context = { e: { slug }, t: active, i: slug === "pets" && active,
        s: { 16: "native-icon" }, r: { navigation: "native-assets" },
        Z: { jsx: (type, props) => ({ type, props }) }, he: "native-icon-renderer",
        AzraelInstructionNavigationIcon: "instruction", AzraelDesignNavigationIcon: "design" };
      const icon = _m.runInNewContext(expressions.icon, context);
      const assets = _m.runInNewContext(expressions.iconAssetSource, context);
      const custom = slug === "azrael-design" || slug === "azrael-instructions";
      assert.equal(icon.type, custom ? (slug === "azrael-design" ? "design" : "instruction") : "native-icon-renderer");
      assert.equal(icon.props.className, active ? "text-codex-icon-active" : undefined);
      assert.equal(assets, custom || context.i ? undefined : "native-assets");
    }
  }
});

test("production pipeline applies student design and preserves it through Pets retirement", () => {
  const { transformAsset } = require("./namespace-azrael-host.cjs");
  const assets = [];
  for (const asset of DESIGN_ASSETS) {
    const filename = path.join(root, asset), source = ms.readFileSync(filename, "utf8");
    const result = transformAsset(source, asset, filename, vp);
    assert.equal(result.asset.studentDesignEdits, 1, asset);
    assert.equal(result.asset.petsCleanupEdits, 1, asset);
    assert.equal(vp.createSourceFile(asset, result.text, vp.ScriptTarget.Latest, true, vp.ScriptKind.JS).parseDiagnostics.length, 0);
    if (asset === DESIGN_ASSETS[2]) {
      assert.ok(result.text.includes("personalization.azrael-instructions.azrael-design.usage"));
      assert.ok(result.text.includes("defaultMessage:`디자인`"));
      assert.equal(result.text.includes("`azrael-design`,`pets`,`keyboard-shortcuts`"), false);
    }
    assets.push(result.asset);
  }
  const gate = require("./feature-preservation.cjs"), manifest = gate.loadManifest(path.resolve(__dirname, ".."));
  gate.validateTransformReport({ features: manifest.features.filter(feature => feature.id === "ui.student-design") }, { assets });
});

test("injected settings bridges resolve to the pinned module's real exports", () => {
  const { transformAsset } = require("./namespace-azrael-host.cjs");
  const parse = (text, asset) => vp.createSourceFile(asset, text, vp.ScriptTarget.Latest, true, vp.ScriptKind.JS);
  const bridgeAsset = DESIGN_ASSETS[0];
  const original = ms.readFileSync(path.join(root, bridgeAsset), "utf8");
  const bridge = transformAsset(original, bridgeAsset, path.join(root, bridgeAsset), vp).text;
  const exports = new Set(parse(bridge, bridgeAsset).statements.filter(vp.isExportDeclaration)
    .flatMap(node => node.exportClause?.elements?.map(e => e.name.text) ?? []));
  assert(exports.has("F3t"));
  assert(!exports.has("WEe"));
  const asset = DESIGN_ASSETS[2], filename = path.join(root, asset);
  const settings = transformAsset(ms.readFileSync(filename, "utf8"), asset, filename, vp).text;
  const injected = parse(settings, asset).statements.filter(vp.isImportDeclaration)
    .flatMap(node => node.moduleSpecifier.text === "./app-initial-5120fa5fe295.js"
      ? node.importClause?.namedBindings?.elements ?? [] : [])
    .filter(e => /^azrael(?:Account|Instruction|Window)Bridge$/.test(e.name.text));
  assert.equal(injected.length, 3);
  const navigationAsset = DESIGN_ASSETS[1];
  const navigation = transformAsset(ms.readFileSync(path.join(root, navigationAsset), "utf8"), navigationAsset, path.join(root, navigationAsset), vp).text;
  assert(!navigation.includes("azraelInstructionAsset16=O("));
  assert(navigation.includes("case`pets`:return{visible:!1,pending:!1};"));
  assert(navigation.includes("commandAsset:Or,navigation:{assets:{16:Or,20:Er}"));
  for (const imported of injected) assert(exports.has(imported.propertyName.text), imported.name.text);
});

test("pinned composed assets parse, preserve settings, reject drift and remain idempotent", () => {
  for (const asset of DESIGN_ASSETS) {
    const source = ms.readFileSync(path.join(root, asset), "utf8");
    const composed = injectInstructionSettings(injectAccountSettings(source, asset).text, asset).text;
    const result = injectStudentDesign(composed, asset);
    assert.equal(result.count, 1);
    assert.equal(vp.createSourceFile(asset, result.text, vp.ScriptTarget.Latest, true, vp.ScriptKind.JS).parseDiagnostics.length, 0);
    assert.equal(injectStudentDesign(result.text, asset).text, result.text);
    assert.equal(injectStudentDesign(result.text, asset).count, 0);
    assert.throws(() => injectStudentDesign(result.text + "/*azrael-student-design-v1*/", asset), /Duplicate/);
    if (asset === "out/extension.js") {
      assert(source.includes('case"open-vscode-command":{Ge.commands.executeCommand'));
      assert(result.text.includes('Ge.commands.executeCommand("azrael.designEmbedded"'));
      assert(result.text.includes('azraelObserveStudentCreated(e,Ge.commands)'));
    }
    assert.throws(() => injectStudentDesign("", asset), /anchor changed|requires instruction/);
    if (asset === DESIGN_ASSETS[2]) {
      for (const value of ["AzraelAccountSettings", "AzraelInstructionSettings", "AzraelDesignSettings", ".azrael-instructions.azrael-design.pets.", 'defaultMessage:`디자인`']) assert(result.text.includes(value));
    }
    if (asset === DESIGN_ASSETS[1]) {
      assert(result.text.includes('{slug:`azrael-instructions`},{slug:`azrael-design`}'));
      assert(result.text.includes('case`azrael-design`:case`azrael-instructions`'));
    }
    if (asset === DESIGN_ASSETS[0]) {
      assert(result.text.includes('function azraelOriginalAvatar(e)'));
      assert(result.text.includes('export{azraelDesignStore,useAzraelDesignState}'));
    }
  }
  assert.equal(injectStudentDesign("other", "other").count, 0);
});

test("pinned design defers cyclic bundle initialization until the first rendered hook", () => {
  const asset = DESIGN_ASSETS[0];
  const source = ms.readFileSync(path.join(root, asset), "utf8");
  const result = injectStudentDesign(source, asset);
  const ust = vp.createSourceFile(asset, source, 99, true, vp.ScriptKind.JS);
  const avatar = ust.statements.find(n => vp.isFunctionDeclaration(n) && n.name?.text === "c_i");
  assert(avatar.getText(ust).includes("(0,d_i.jsx)"));
  assert(source.includes("function m_i()"));
  assert(source.includes("Dm=Em.getInstance()"));
  const start = result.text.indexOf("var azraelDesignStore;function useAzraelDesignState()");
  assert(start > 0);
  const calls = [];
  const context = _m.createContext({
    m_i: () => { throw new Error("Cyclic avatar owner must not initialize eagerly"); }, Om: () => calls.push("bridge-owner"),
    Dm: { subscribe: kind => { calls.push(kind); return () => {}; }, dispatchMessage: (_kind, value) => calls.push(value.action) },
    createDesignStore, crypto: { randomUUID: () => "bootstrap" },
    q: () => ({ useSyncExternalStore: (_subscribe, get) => get() }),
    K: () => ({ c: () => [] }),
    setTimeout: () => 1, clearTimeout: () => {},
    window: { addEventListener: kind => calls.push(kind) },
  });
  _m.runInContext(result.text.slice(start).replace("export{azraelDesignStore,useAzraelDesignState};", ""), context);
  assert.deepEqual(calls, ["pagehide"]);
  assert.equal(_m.runInContext("useAzraelDesignState().loading", context), true);
  assert.deepEqual(calls, ["pagehide", "bridge-owner", "azrael-design-state", "subscribe"]);
  assert.equal(_m.runInContext("useAzraelDesignState().loading", context), true);
  assert.equal(calls.filter(value => value === "subscribe").length, 1);
});

test("injected hooks resolve through pinned React exports, not compiler runtime", () => {
  const asset = DESIGN_ASSETS[0], source = ms.readFileSync(path.join(root, asset), "utf8");
  const parse = (text, name) => vp.createSourceFile(name, text, vp.ScriptTarget.Latest, true, vp.ScriptKind.JS);
  const entry = parse(source, asset);
  const binding = local => {
    for (const node of entry.statements.filter(vp.isImportDeclaration)) {
      const imported = node.importClause?.namedBindings?.elements?.find(e => e.name.text === local);
      if (imported) return { file: path.resolve(path.dirname(path.join(root, asset)), node.moduleSpecifier.text), exported: imported.propertyName.text };
    }
    assert.fail(`Missing pinned import ${local}`);
  };
  const reactBinding = binding("q"), compilerBinding = binding("K");
  assert.equal(reactBinding.file, compilerBinding.file);
  const owner = parse(ms.readFileSync(reactBinding.file, "utf8"), reactBinding.file);
  const exportLocal = exported => {
    const specifier = owner.statements.filter(vp.isExportDeclaration).flatMap(n => n.exportClause?.elements ?? [])
      .find(e => e.name.text === exported);
    assert(specifier, `Missing actual export ${exported}`);
    return specifier.propertyName?.text ?? specifier.name.text;
  };
  const declarations = new Map(owner.statements.filter(vp.isVariableStatement)
    .flatMap(n => n.declarationList.declarations).map(d => [d.name.text, d]));
  const reactLocal = exportLocal(reactBinding.exported), compilerLocal = exportLocal(compilerBinding.exported);
  // Evaluate the actual bundled CommonJS factories and their imported loader.
  // Only React's dispatcher is supplied by the test, as a renderer would do.
  const factory = local => {
    const declaration = declarations.get(local);
    assert(declaration && vp.isCallExpression(declaration.initializer), local);
    const callback = declaration.initializer.arguments[0];
    assert(vp.isParenthesizedExpression(callback) && vp.isArrowFunction(callback.expression));
    const body = callback.expression.body;
    assert(vp.isBlock(body) && body.statements.length === 1);
    const assignment = body.statements[0].expression;
    assert(vp.isBinaryExpression(assignment) && vp.isCallExpression(assignment.right));
    return assignment.right.expression.text;
  };
  const loaderLocal = declarations.get(reactLocal).initializer.expression.text;
  const loaderImport = owner.statements.filter(vp.isImportDeclaration).find(n => n.importClause?.namedBindings?.elements?.some(e => e.name.text === loaderLocal));
  const loaderSpecifier = loaderImport.importClause.namedBindings.elements.find(e => e.name.text === loaderLocal);
  const loaderPath = path.resolve(path.dirname(reactBinding.file), loaderImport.moduleSpecifier.text);
  const runtime = parse(ms.readFileSync(loaderPath, "utf8"), loaderPath);
  const loaderExport = runtime.statements.filter(vp.isExportDeclaration).flatMap(n => n.exportClause.elements)
    .find(e => e.name.text === loaderSpecifier.propertyName.text);
  const context = _m.createContext({});
  _m.runInContext(runtime.statements.filter(n => !vp.isExportDeclaration(n)).map(n => n.getText(runtime)).join("\n"), context);
  _m.runInContext(`var ${loaderLocal}=${loaderExport.propertyName.text};`, context);
  for (const local of [factory(reactLocal), reactLocal, factory(compilerLocal), compilerLocal]) {
    _m.runInContext(`var ${declarations.get(local).getText(owner)};`, context);
  }
  const react = _m.runInContext(`${reactLocal}()`, context), compiler = _m.runInContext(`${compilerLocal}()`, context);
  assert.equal(typeof react.useState, "function");
  assert.equal(typeof react.useSyncExternalStore, "function");
  assert.equal(typeof compiler.c, "function");
  assert.equal(compiler.useState, undefined);
  assert.equal(compiler.useSyncExternalStore, undefined);
  const hooks = [];
  react.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H = {
    useState: value => { hooks.push("useState"); return [value, () => {}]; },
    useSyncExternalStore: (_subscribe, get) => { hooks.push("useSyncExternalStore"); return get(); },
  };
  const injected = injectStudentDesign(source, asset).text;
  const patched = parse(injected, asset);
  const avatar = patched.statements.find(n => vp.isFunctionDeclaration(n) && n.name?.text === "AzraelStudentAvatar");
  const useState = patched.statements.find(n => vp.isFunctionDeclaration(n) && n.name?.text === "useAzraelDesignState");
  Object.assign(context, {
    q: _m.runInContext(reactLocal, context), K: _m.runInContext(compilerLocal, context), Om: () => {},
    azraelDesignStore: { subscribe() {}, getSnapshot: () => ({ students: [{ id: "s", url: "local" }], assignments: { thread: "s" } }) },
    d_i: { jsx: (type, props) => ({ type, props }) }, ni: (...values) => values.filter(Boolean).join(" "), azraelOriginalAvatar: () => {},
  });
  _m.runInContext(avatar.getText(patched) + "\n" + useState.getText(patched), context);
  assert.equal(_m.runInContext('AzraelStudentAvatar({seed:"thread"}).type', context), "img");
  assert.deepEqual(hooks, ["useSyncExternalStore", "useState"]);
});

function harness(timing) {
  let receive, unsubscribed = false;
  const sent = [];
  const bridge = { subscribe(type, callback) { assert.equal(type, "azrael-design-state"); receive = callback; return () => { unsubscribed = true; }; },
    dispatchMessage(type, message) { sent.push({ type, ...message }); } };
  const store = createDesignStore(bridge, "client", timing);
  return { store, sent, receive: message => receive(message), unsubscribed: () => unsubscribed };
}

test("bootstrap, broadcast, off request and disposal keep assignment authority on host", () => {
  const h = harness();
  assert.deepEqual(h.sent, [{ type: "azrael-design", clientId: "client", action: "subscribe" }]);
  assert.equal(h.store.getSnapshot().enabled, false);
  h.store.setEnabled(true); assert.equal(h.sent.length, 1);
  let renders = 0;
  const unmount = h.store.subscribe(() => renders++);
  h.receive({ clientId: "other", enabled: true, students: [], assignments: {} }); assert.equal(renders, 0);
  const assignments = { "thread-1": "student-1" };
  h.receive({ clientId: "client", enabled: true, students: [], assignments });
  assert.equal(renders, 1); assert.equal(h.store.getSnapshot().assignments, assignments);
  h.store.setEnabled(false);
  assert.deepEqual(h.sent[1], { type: "azrael-design", clientId: "client", action: "setEnabled", enabled: false });
  assert.equal(h.store.getSnapshot().saving, true);
  h.store.setEnabled(true); assert.equal(h.sent.length, 2);
  h.receive({ clientId: "client", enabled: false, students: [], assignments, error: "save failed" });
  assert.equal(h.store.getSnapshot().error, "save failed");
  assert.equal(h.store.getSnapshot().saving, false);
  assert.deepEqual(assignments, { "thread-1": "student-1" });
  unmount(); const before = renders;
  h.receive({ clientId: "client", enabled: false, students: [], assignments }); assert.equal(renders, before);
  h.store.dispose(); assert.equal(h.sent[2].action, "unsubscribe"); assert(h.unsubscribed());
});

test("lost replies time out, retry only reads host state, and disposal cancels pending work", () => {
  let sequence = 0;
  const timers = new Map();
  const timing = { setTimeout: (callback, delay) => { assert.equal(delay, 10000); timers.set(++sequence, callback); return sequence; }, clearTimeout: id => timers.delete(id) };
  const expire = () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); };
  const h = harness(timing);
  assert.equal(timers.size, 1);
  expire();
  assert.equal(h.store.getSnapshot().loading, false);
  assert.match(h.store.getSnapshot().error, /다시 불러오기/);
  h.store.retry();
  assert.equal(h.sent[1].action, "subscribe");
  assert.equal(h.store.getSnapshot().loading, true);
  const assignments = { thread: "student" };
  h.receive({ clientId: "client", enabled: true, students: [], assignments });
  assert.equal(timers.size, 0);
  h.store.setEnabled(false);
  expire();
  assert.equal(h.store.getSnapshot().saving, false);
  assert.equal(h.store.getSnapshot().enabled, true);
  assert.equal(h.store.getSnapshot().assignments, assignments);
  h.store.retry();
  assert.deepEqual(h.sent.map(message => message.action), ["subscribe", "subscribe", "setEnabled", "subscribe"]);
  assert.equal(h.sent[3].enabled, undefined);
  const snapshot = h.store.getSnapshot();
  h.store.dispose();
  assert.equal(timers.size, 0);
  h.receive({ clientId: "client", enabled: false, students: [], assignments: {} });
  h.store.retry(); h.store.setEnabled(false); h.store.dispose();
  assert.equal(h.store.getSnapshot(), snapshot);
  assert.equal(h.sent.length, 5);
  assert.equal(h.sent[4].action, "unsubscribe");
});

test("unavailable host reports error and exits loading", () => {
  const store = createDesignStore({ subscribe: () => () => {}, dispatchMessage: () => { throw new Error("host unavailable"); } }, "client");
  assert.equal(store.getSnapshot().loading, false);
  assert.equal(store.getSnapshot().error, "host unavailable");
});

test("host observes only completed native spawn notifications and safely preserves fanout on failures", async () => {
  const calls = [], commands = { executeCommand: (...args) => { calls.push(args); } };
  const notification = { method: "item/completed", params: { item: { type: "collabAgentToolCall", tool: "spawnAgent", status: "completed", receiverThreadIds: ["new-thread", "", null, "new-thread", " bad "] } } };
  observeStudentCreated(notification, commands);
  assert.deepEqual(calls, [["azrael.studentCreated", "new-thread"]]);
  for (const message of [
    { method: "thread/started", params: { thread: { id: "historical" } } },
    { method: "thread/list", params: { threads: [{ id: "historical" }] } },
    { ...notification, method: "item/started" },
    { ...notification, params: { item: { ...notification.params.item, tool: "resumeAgent" } } },
    { ...notification, params: { item: { ...notification.params.item, status: "failed" } } },
    { ...notification, params: { item: { ...notification.params.item, type: "other" } } },
    { ...notification, params: { item: { ...notification.params.item, receiverThreadIds: null } } },
  ]) observeStudentCreated(message, commands);
  assert.equal(calls.length, 1);
  const warnings = [];
  const observe = _m.runInNewContext("(" + observeStudentCreated.toString() + ")", { console: { warn: (...args) => warnings.push(args) }, Promise, Set });
  observe(notification, { executeCommand: () => { throw new Error("sync failure"); } });
  observe(notification, { executeCommand: () => Promise.reject(new Error("async failure")) });
  await Promise.resolve();
  assert.equal(warnings.length, 2);
});

const jsx = (type, props, key) => ({ type, props, key });
test("avatar uses exact assigned seed even when off, preserves props and falls back after image error", () => {
  let state = { enabled: false, students: [{ id: "student", url: "https://webview.local/student.png" }], assignments: { thread: "student" } }, failed = null;
  const original = () => {};
  const avatar = _m.runInNewContext("(" + AzraelStudentAvatar.toString() + ")", {
    q: () => ({ useState: () => [failed, next => { failed = next; }] }), K: () => ({ c: () => [] }), useAzraelDesignState: () => state,
    d_i: { jsx }, ni: (...values) => values.filter(Boolean).join(" "), azraelOriginalAvatar: original,
  });
  const props = { seed: "thread", className: "custom", title: "title", alt: "ignored" };
  const image = avatar(props);
  assert.equal(image.type, "img"); assert.equal(image.props.alt, ""); assert.equal(image.props.title, "title");
  assert.equal(image.props.className, "size-3.5 shrink-0 custom");
  assert.equal(avatar({ seed: "other" }).type, original);
  assert.equal(avatar({ seed: "thread-extra" }).type, original);
  image.props.onError({}); assert.equal(avatar(props).type, original);
  state = { ...state, students: [] }; assert.equal(avatar(props).type, original);
  state = { ...state, assignments: {} }; assert.equal(avatar({ seed: "toString" }).type, original);
});

// Model React's indexed hooks, queued effects and functional local updates. Native
// component symbols remain opaque so assertions inspect their public prop contracts.
function settingsHarness(initialState, randomValues = [0]) {
  let state = initialState, cursor = 0, dirty = false, randomIndex = 0;
  const slots = [], effects = [], calls = [], initializers = [];
  const native = Object.fromEntries(["Tt", "AzraelSettingsCard", "AzraelSettingsRow", "AzraelSwitch", "pe"].map(name => [name, Symbol(name)]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => {
        const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
      }];
    },
    useEffect(callback, dependencies) {
      const index = cursor++, previous = slots[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous[i]))) {
        slots[index] = dependencies; effects.push(callback);
      }
    },
  };
  const choose = (students, previous) => pickStudentPreview(students, previous, () => randomValues[randomIndex++ % randomValues.length]);
  const component = _m.runInNewContext("(" + AzraelDesignSettings.toString() + ")", {
    ...native, Q: react, $: { jsx, jsxs: jsx }, pickStudentPreview: choose,
    initAzraelSettingsCard: () => initializers.push("card"), initAzraelSettingsRow: () => initializers.push("row"), initAzraelSwitch: () => initializers.push("switch"),
    useAzraelDesignState: () => state,
    azraelDesignStore: { setEnabled: value => calls.push(["setEnabled", value]), retry: () => calls.push(["retry"]) },
  });
  const render = () => {
    let tree, passes = 0;
    do {
      assert(++passes < 10, "Settings effects must settle"); dirty = false; cursor = 0; tree = component();
      effects.splice(0).forEach(effect => effect());
    } while (dirty);
    return tree;
  };
  return { native, calls, initializers, render, update: next => { state = next; return render(); } };
}
function treeNodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...[tree.props?.children, tree.props?.label].flat(Infinity).flatMap(treeNodes)];
}
function findNode(tree, predicate) {
  const node = treeNodes(tree).find(predicate); assert(node, "Expected settings tree node"); return node;
}
function settingsControls(h, tree) {
  const rows = treeNodes(tree).filter(node => node.type === h.native.AzraelSettingsRow);
  assert.equal(rows.length, 2);
  return { toggle: rows[0].props.control({ "aria-labelledby": "native-label", "aria-describedby": "native-description", id: "native-control" }),
    draw: rows[1].props.control({}), rows };
}
const previewStudents = [
  { id: "a", nameKo: "학생 가", nameEn: "Student A", url: "local-a" },
  { id: "b", nameKo: "학생 나", nameEn: "Student B", url: "local-b" },
];
const loadedDesignState = () => ({ enabled: false, loading: false, saving: false, error: null, students: previewStudents, assignments: { existing: "a" } });

test("settings uses native page/card/row/switch/button and controlled boolean toggle with busy locks", () => {
  const base = loadedDesignState(), h = settingsHarness({ ...base, loading: true });
  let tree = h.render(), controls = settingsControls(h, tree);
  assert.equal(tree.type, h.native.Tt); assert.equal(tree.props.title, "디자인");
  assert.equal(treeNodes(tree).filter(node => node.type === h.native.AzraelSettingsCard).length, 2);
  assert.equal(treeNodes(tree).some(node => node.type === "input"), false);
  assert.equal(controls.toggle.type, h.native.AzraelSwitch);
  assert.equal(controls.toggle.props.checked, false); assert.equal(controls.toggle.props.disabled, true);
  assert.equal(controls.toggle.props["aria-labelledby"], "native-label");
  assert.equal(controls.toggle.props["aria-describedby"], "native-description"); assert.equal(controls.toggle.props.id, "native-control");
  assert.equal(controls.draw.type, h.native.pe); assert.equal(controls.draw.props.disabled, true);
  assert.match(findNode(tree, node => node.props?.role === "status").props.children, /불러오는/);
  tree = h.update(base); controls = settingsControls(h, tree);
  assert.equal(controls.toggle.props.disabled, false);
  controls.toggle.props.onChange(true); controls.toggle.props.onChange(false);
  assert.deepEqual(h.calls, [["setEnabled", true], ["setEnabled", false]]);
  tree = h.update({ ...base, enabled: true, saving: true }); controls = settingsControls(h, tree);
  assert.equal(controls.toggle.props.checked, true); assert.equal(controls.toggle.props.disabled, true);
  assert.equal(controls.draw.props.disabled, false); // Preview remains usable while persistence is busy.
  assert.equal(findNode(tree, node => node.props?.role === "status").props.children, "저장 중…");
  assert.equal(findNode(tree, node => node.props?.["aria-busy"] !== undefined).props["aria-busy"], true);
  tree = h.update({ ...base, error: "host unavailable" });
  const alert = findNode(tree, node => node.props?.role === "alert");
  assert.equal(alert.props.children[0].props.children, "host unavailable");
  const retry = findNode(alert, node => node.type === h.native.pe);
  assert.equal(retry.props.disabled, false); retry.props.onClick(); assert.deepEqual(h.calls.at(-1), ["retry"]);
  tree = h.update({ ...base, saving: true, error: "failed" });
  assert.equal(findNode(findNode(tree, node => node.props?.role === "alert"), node => node.type === h.native.pe).props.disabled, true);
  assert.deepEqual(h.initializers.slice(0, 3), ["card", "row", "switch"]);
});

test("preview initializes once after loading, draws independently while off, and never mutates or dispatches", () => {
  const bridge = harness(), base = loadedDesignState();
  bridge.receive({ clientId: "client", ...base });
  const before = bridge.store.getSnapshot(), snapshot = JSON.stringify(before), sent = bridge.sent.length;
  const h = settingsHarness({ ...before, loading: true }, [0, 0.99]);
  let tree = h.render(); assert.equal(treeNodes(tree).filter(node => node.type === "img").length, 0);
  tree = h.update(before);
  assert.equal(findNode(tree, node => node.type === "img").props.src, "local-a");
  tree = h.render(); assert.equal(findNode(tree, node => node.type === "img").props.src, "local-a");
  settingsControls(h, tree).draw.props.onClick(); tree = h.render();
  assert.equal(findNode(tree, node => node.type === "img").props.src, "local-b");
  assert.equal(findNode(tree, node => node.type === "img").props.alt, "학생 나");
  assert.equal(treeNodes(tree).filter(node => node.type === "img").length, 1);
  assert.equal(settingsControls(h, tree).toggle.props.checked, false);
  assert.deepEqual(h.calls, []); assert.equal(bridge.sent.length, sent);
  assert.equal(bridge.store.getSnapshot(), before); assert.equal(JSON.stringify(before), snapshot);
  bridge.store.dispose();
});

test("preview excludes the previous student with alternatives and handles empty/single rosters", () => {
  assert.equal(pickStudentPreview([], null, () => { throw new Error("No draw needed"); }), null);
  assert.equal(pickStudentPreview(previewStudents, null, () => 0), "a");
  assert.equal(pickStudentPreview(previewStudents, null, () => 0.999), "b");
  for (const random of [0, 0.5, 0.999]) {
    assert.equal(pickStudentPreview(previewStudents, "a", () => random), "b");
    assert.equal(pickStudentPreview(previewStudents, "b", () => random), "a");
    assert.equal(pickStudentPreview([previewStudents[0]], "a", () => random), "a");
  }
  const base = loadedDesignState(), h = settingsHarness({ ...base, students: [] });
  let tree = h.render();
  assert.equal(settingsControls(h, tree).toggle.props.disabled, true); assert.equal(settingsControls(h, tree).draw.props.disabled, true);
  assert.equal(findNode(tree, node => node.props?.children === "미리보기 없음").type, "span");
  tree = h.update({ ...base, students: [previewStudents[0]] });
  settingsControls(h, tree).draw.props.onClick(); tree = h.render();
  assert.equal(findNode(tree, node => node.type === "img").props.src, "local-a");
  assert.deepEqual(h.calls, []);
});

test("preview shows image error fallback, recovers on a different draw, and handles removed roster", () => {
  const base = loadedDesignState(), h = settingsHarness(base);
  let tree = h.render(); findNode(tree, node => node.type === "img").props.onError(); tree = h.render();
  assert.equal(treeNodes(tree).filter(node => node.type === "img").length, 0);
  assert.equal(findNode(tree, node => node.props?.children === "사진을 불러오지 못했습니다").type, "span");
  settingsControls(h, tree).draw.props.onClick(); tree = h.render();
  assert.equal(findNode(tree, node => node.type === "img").props.src, "local-b");
  tree = h.update({ ...base, students: [] });
  assert.equal(findNode(tree, node => node.props?.children === "미리보기 없음").type, "span");
});

test("native settings imports bind to actual pinned exports and retain native page, button and React owners", () => {
  const asset = DESIGN_ASSETS[2], filename = path.join(root, asset);
  const text = injectStudentDesign(injectInstructionSettings(injectAccountSettings(ms.readFileSync(filename, "utf8"), asset).text, asset).text, asset).text;
  const parse = (source, name) => vp.createSourceFile(name, source, vp.ScriptTarget.Latest, true, vp.ScriptKind.JS);
  const ast = parse(text, asset), imports = ast.statements.filter(vp.isImportDeclaration);
  const expected = {
    AzraelSettingsCard: ["./app-initial-5120fa5fe295.js", "d3"], initAzraelSettingsCard: ["./app-initial-5120fa5fe295.js", "f3"],
    AzraelSettingsRow: ["./app-initial-5120fa5fe295.js", "y3"], initAzraelSettingsRow: ["./app-initial-5120fa5fe295.js", "x3"],
    AzraelSwitch: ["./app-initial-532d60c9b397.js", "r4"], initAzraelSwitch: ["./app-initial-532d60c9b397.js", "a4"],
  };
  for (const local of [...Object.keys(expected), "Tt", "pe", "Q", "$"]) {
    let importLocal = local;
    if (local === "Q" || local === "$") {
      const assignments = [];
      const visit = node => {
        if (vp.isBinaryExpression(node) && node.left.getText(ast) === local && vp.isCallExpression(node.right)) assignments.push(node.right);
        vp.forEachChild(node, visit);
      };
      visit(ast); assert.equal(assignments.length, 1, `Unique pinned initializer for ${local}`);
      importLocal = assignments[0].expression.text;
      assert.equal(importLocal, local === "Q" ? "h" : "s");
    }
    const ownerImport = imports.find(node => node.importClause?.namedBindings?.elements?.some(e => e.name.text === importLocal));
    assert(ownerImport, `Missing native import ${local} via ${importLocal}`);
    const imported = ownerImport.importClause.namedBindings.elements.find(e => e.name.text === importLocal);
    const binding = [ownerImport.moduleSpecifier.text, imported.propertyName?.text ?? imported.name.text];
    if (expected[local]) assert.deepEqual(binding, expected[local]);
    const ownerPath = path.resolve(path.dirname(filename), binding[0]);
    const owner = parse(ms.readFileSync(ownerPath, "utf8"), ownerPath);
    const exported = owner.statements.filter(vp.isExportDeclaration).flatMap(node => node.exportClause?.elements ?? []).find(e => e.name.text === binding[1]);
    assert(exported, `${local} must resolve to real pinned export ${binding[1]}`);
    const exportLocal = exported.propertyName?.text ?? exported.name.text;
    assert(owner.statements.some(node => (vp.isFunctionDeclaration(node) && node.name?.text === exportLocal) ||
      (vp.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.text === exportLocal))), `${local} export must have an implementation`);
  }
});

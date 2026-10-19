"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("../extensions/azrael-ex/node_modules/typescript");
const { createBtwCommand, createBtwController } = require("./btw-conversation.cjs");
const { BTW_ASSETS, BTW_MARKER, INSTRUCTIONS, injectBtw } = require("./inject-btw.cjs");
const { injectComposerDraft } = require("./inject-composer-draft.cjs");
const { transformAsset } = require("./ui-test-transform-fixture.cjs");
const root = path.resolve(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.resolve(__dirname, "../artifacts/upstream-ui/26.1007.21434"));
const originals = BTW_ASSETS.map(asset => fs.readFileSync(path.join(root, asset), "utf8"));
const patched = originals.map((source, i) => transformAsset(source, BTW_ASSETS[i], BTW_ASSETS[i], ts));
function declaration(source, name) {
  const ast = ts.createSourceFile("pinned.js", source, 99, true, ts.ScriptKind.JS);
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === name);
  assert.ok(node, name); return node.getText(ast);
}
function assignedExpression(source, name) {
  const ast = ts.createSourceFile("pinned.js", source, 99, true, ts.ScriptKind.JS);
  let expression;
  function visit(node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left) && node.left.text === name) expression = node.right.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(expression, name); return expression;
}
test("btw imports the actual latest native button wrapper and initializer", () => {
  const ast = ts.createSourceFile("composer.js", originals[1], 99, true, ts.ScriptKind.JS);
  const exports = new Map(ast.statements.filter(ts.isExportDeclaration).flatMap(node =>
    node.exportClause?.elements?.map(spec => [spec.name.text, spec.propertyName?.text ?? spec.name.text]) ?? []));
  assert.equal(exports.get("ZIt"), "mw");
  assert.equal(exports.get("$It"), "gw");
  assert.equal(patched[2].text.split('import{ZIt as __azraelBtwButton,$It as __azraelInitBtwButton}').length, 2);
  const noop = () => {};
  const context = {
    e: fn => fn, Q: () => ({ c: count => Array(count).fill(Symbol("empty React cache")) }),
    ha: noop, wd: () => ({}), zl: noop, $Wt: noop, pw: noop,
    m: () => ({ jsx: (type, props) => ({ type, props }) }), DGt: Symbol("native button base"),
  };
  vm.createContext(context);
  vm.runInContext(declaration(originals[1], "gw") + "\n" + declaration(originals[1], "mw"), context);
  context.gw();
  assert.match(context.AGt.composerPrimary, /bg-composer-primary/);
  const onClick = () => {}, props = { children: "Transfer answer", disabled: true, onClick };
  const rendered = context.mw(props);
  assert.equal(rendered.type, context.DGt);
  assert.equal(rendered.props.children, props.children);
  assert.equal(rendered.props.disabled, true);
  assert.equal(rendered.props.onClick, onClick);
});
function fixture() {
  const controller = createBtwController(), requests = [], openings = [], disposed = [];
  const parent = { cwd: "/workspace", latestModel: "managed/anthropic/current", threadRuntimeStatus: { type: "running" }, turns: [{ status: "inProgress" }] };
  const states = new Map([["parent", parent]]), messages = new Map(); let next = 0;
  const manager = {
    getConversation: async id => states.get(id), getHostId: async () => "local",
    readRecentThreadMessages: async id => messages.get(id) ?? [],
    copyEphemeralConversationHistory: (old, id) => { messages.set(id, structuredClone(messages.get(old) ?? [])); return true; },
    sendRequest: async (method, params) => requests.push({ method, params }),
    sendFollowUpMessage: async (id, { prompt }) => { requests.push({ method: "follow-up", id, prompt }); messages.set(id, [...messages.get(id) ?? [], { role: "user", text: prompt }, { role: "assistant", text: "Answer: " + prompt }]); },
    discardConversationFromCache: async id => { disposed.push(id); states.delete(id); },
  };
  const openPanel = async options => {
    openings.push(options); const id = "side-" + ++next;
    states.set(id, { ephemeral: true, sideConversation: true, threadRuntimeStatus: { type: "idle" }, turns: [] });
    await options.prepare(id); return id;
  };
  const submit = overrides => controller.submit({ conversationId: "parent", hostId: "local", manager, openPanel, text: "/btw Why?", ...overrides });
  return { controller, parent, states, messages, manager, requests, openings, disposed, submit, openPanel };
}

test("all integrated pinned assets parse, report coverage and guard version, duplicate anchors and idempotence", () => {
  for (let i = 0; i < BTW_ASSETS.length; i++) {
    assert.equal(patched[i].asset.btwEdits, 1);
    assert.equal(ts.createSourceFile(BTW_ASSETS[i], patched[i].text, 99, true, 1).parseDiagnostics.length, 0);
    const input = i === 1 ? injectComposerDraft(originals[i]).text : originals[i];
    const result = injectBtw(input, BTW_ASSETS[i]);
    assert.deepEqual(injectBtw(result.text, BTW_ASSETS[i]), { text: result.text, count: 0 });
    assert.throws(() => injectBtw("", BTW_ASSETS[i]), /anchor/);
    assert.throws(() => injectBtw(input + input, BTW_ASSETS[i]), /anchor/);
    assert.throws(() => injectBtw(result.text + BTW_MARKER, BTW_ASSETS[i]), /Duplicate/);
  }
  assert.deepEqual(injectBtw("unchanged", "future.js"), { text: "unchanged", count: 0 });
});

test("active parent stays unchanged; every follow-up forks that parent, carries isolated reference history, and discards the old side", async () => {
  const h = fixture(), before = structuredClone(h.parent);
  assert.equal(await h.submit({ isResponseInProgress: true }), true);
  assert.equal(await h.submit({ conversationId: "side-1", text: "Explain more" }), true);
  assert.deepEqual(h.openings.map(o => [o.parentId, o.previousId, o.question]), [["parent", undefined, "Why?"], ["parent", "side-1", "Explain more"]]);
  assert.deepEqual(h.parent, before);
  assert.equal(h.requests.some(r => r.id === "parent" || r.params?.threadId === "parent"), false);
  const reference = h.requests.find(r => r.method === "thread/inject_items");
  assert.equal(reference.params.threadId, "side-2");
  assert.match(reference.params.items[0].content[0].text, /Answer: Why\?/);
  assert.deepEqual(h.disposed, ["side-1"]);
  assert.equal(h.controller.lookup("side-1"), undefined);
  assert.equal(h.controller.lookup("side-2").parentId, "parent");
  assert.deepEqual(h.messages.get("side-2").map(m => m.text), ["Why?", "Answer: Why?", "Explain more", "Answer: Explain more"]);
});

test("only explicit transfer uses ordinary parent follow-up admission, with selection or latest answer", async () => {
  const h = fixture(); await h.submit();
  await h.controller.transfer("side-1", "Selected answer");
  await h.controller.transfer("side-1");
  assert.deepEqual(h.requests.filter(r => r.id === "parent").map(r => r.prompt), ["Selected answer", "Answer: Why?"]);
  h.controller.forget("side-1");
  await assert.rejects(h.controller.transfer("side-1"), /다시 열어/);
});

test("ordinary/literal prompts bypass the command; empty /btw opens without inference and child literal follow-up remains isolated", async () => {
  const h = fixture();
  for (const text of ["ordinary", "/btwOther", "Please explain /btw", "/btw question"]) assert.equal(await h.submit({ text, literal: true }), false);
  assert.equal(await h.submit({ text: "/btw" }), true); assert.deepEqual(h.requests, []);
  await h.submit({ conversationId: "side-1", text: "literal follow-up", literal: true });
  assert.equal(h.requests.at(-1).id, "side-2");
});

test("attachment, overlapping side answer, unavailable parent and preparation failure never send to parent", async () => {
  const h = fixture();
  await assert.rejects(h.submit({ hasAttachments: true }), /텍스트/);
  await assert.rejects(h.submit({ conversationId: null }), /열려 있어야/);
  await h.submit(); h.states.get("side-1").threadRuntimeStatus.type = "running";
  await assert.rejects(h.submit({ conversationId: "side-1", text: "next", isResponseInProgress: true }), /완료/);
  await assert.rejects(h.submit(), /진행 중/);
  h.states.get("side-1").threadRuntimeStatus.type = "idle";
  await assert.rejects(h.submit({ openPanel: async () => { throw Error("fork failed"); } }), /fork failed/);
  assert.equal(h.requests.some(r => r.id === "parent"), false);
  assert.ok(h.controller.lookup("side-1"), "failed replacement preserves previous side");
});

test("cached reference history is bounded, and repeated submission cannot race another fork", async () => {
  const h = fixture(); await h.submit();
  h.messages.set("side-1", Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "x".repeat(5000) })));
  let release;
  const pending = h.submit({ openPanel: async options => { await new Promise(r => { release = r; }); return h.openings[0].prepare ? (await options.prepare("side-x"), "side-x") : null; } });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(h.submit(), /準備|준비/); release(); await pending;
  const item = h.requests.find(r => r.method === "thread/inject_items").params.items[0];
  const history = JSON.parse(item.content[0].text.split("\n")[1]);
  assert.ok(history.length <= 20); assert.equal(history.reduce((n, m) => n + m.text.length, 0), 2000);
});

test("actual native side creator forwards tool-free RPC, selected helper model and task boundary", async () => {
  const requests = [], manager = { getConversation: async () => ({ modelProvider: "azrael-managed" }) };
  const context = { bc: () => false, MYe: async () => ["/workspace"], mg: async () => ({ instructions: "inherited task instructions" }), Uye: () => false,
    eJi: "ordinary side instructions", Bp: () => manager,
    $Ze: async (_scope, _host, params) => { requests.push(params); return { conversationId: "child", synchronization: { status: "complete" } }; } };
  vm.createContext(context); vm.runInContext(declaration(patched[2].text, "Qqi"), context);
  await context.Qqi({ scope: {}, sourceConversationId: "parent", hostId: "local", cwd: "/workspace", sideQuestion: true, collaborationMode: { mode: "default", settings: { model: "managed/anthropic/current", reasoning_effort: "high" } } });
  const request = requests[0];
  assert.equal(request.sideQuestion, true); assert.equal(request.ephemeral, true); assert.equal(request.sideConversation, true);
  assert.equal(request.addForkedSyntheticItem, false); assert.equal(request.model, "managed/anthropic/current"); assert.equal(request.modelProvider, undefined);
  assert.equal(request.reasoningEffort, "high"); assert.equal(request.developerInstructions, INSTRUCTIONS);
  assert.equal(request.developerInstructions.includes("inherited task instructions"), false);
  await context.Qqi({ scope: {}, sourceConversationId: "parent", hostId: "local", cwd: "/workspace", sideQuestion: true, collaborationMode: { mode: "default", settings: { model: "gpt-6.1-sol", reasoning_effort: "medium" } } });
  assert.equal(requests[1].modelProvider, "openai");
});

test("actual composer helper keeps the native string host ID across async RPC and opens the isolated panel", async () => {
  const h = fixture(), nativeModule = { __azraelOpenBtwPanel: h.openPanel };
  h.manager.getHostId = () => { throw Error("RPC host ID must not be read synchronously"); };
  const scope = { get: atom => atom === "attachments" ? {} : { locale: "ko" } };
  const ctx = { QG: "attachments", fm: "intl", __azraelBtw: h.controller, nativeModule,
    Px: (_scope, hostId) => { assert.equal(hostId, "local"); return h.manager; } };
  vm.createContext(ctx);
  vm.runInContext(declaration(patched[1].text, "__azraelTryBtw").replace('import("./app-initial-c014f9ee4429.js")', 'Promise.resolve(nativeModule)'), ctx);
  assert.equal(await ctx.__azraelTryBtw(scope, "parent", "/btw", { type: "local" }, "local", true, false, {}), true);
  assert.equal(h.openings[0].hostId, "local"); assert.equal(h.requests.length, 0);
  assert.equal(await ctx.__azraelTryBtw(scope, "parent", "/btw Why?", { type: "local" }, "local", true, false, {}), true);
  assert.equal(h.requests.at(-1).prompt, "Why?");
});

test("native slash registration opens /btw as an action without parent message admission", async () => {
  const registered = [], opened = [], errors = [];
  const ctx = { createBtwCommand, Rja() {}, J3: value => registered.push(value), hA: "host", hx: "toast", goe: "side16", IDe: "side20",
    __azraelTryBtw: async (...args) => opened.push(args), __azraelBtw: { lookup: () => undefined } };
  const scope = { get: atom => atom === "host" ? "local" : { danger: error => errors.push(error) } };
  vm.createContext(ctx); vm.runInContext(declaration(patched[1].text, "__azraelRegisterBtw"), ctx);
  ctx.__azraelRegisterBtw("parent", scope, { locale: "ko" });
  const command = registered[0];
  assert.equal(command.id, "btw"); assert.equal(command.requiresEmptyComposer, true); assert.equal(command.enabled, true);
  assert.match(command.description, /별도 질문/);
  assert.ok(declaration(patched[1].text, "rDa").includes("__azraelRegisterBtw(n,__azraelBtwComposerScope,a)"));
  await command.onSelect(); assert.equal(opened.length, 1); assert.equal(opened[0][2], "/btw"); assert.equal(opened[0][4], "local");
  ctx.__azraelTryBtw = async () => { throw Error("fork failed"); }; await command.onSelect(); assert.deepEqual(errors, ["fork failed"]);
  ctx.__azraelBtw.lookup = () => ({}); ctx.__azraelRegisterBtw("side", scope, { locale: "en" }); assert.equal(registered[1].enabled, false);
});

test("native slash component uses ComposerScope for real attachment state and RouteScope ancestors across session switches", async () => {
  const h = fixture(), registered = [], errors = [], cache = Array(31);
  const appToken = { id: "app" }, routeToken = { id: "route" }, composerToken = { id: "composer" };
  const hostAtom = { token: appToken }, toastAtom = { token: appToken }, intlAtom = { token: appToken };
  const app = { token: appToken, parent: null }, instances = new Map([[appToken.id, app]]);
  let route, composer, attachments, attachmentReads = 0;
  const ctx = { iDa: { c: () => cache }, $: appToken, Uf: routeToken, Dh: composerToken,
    Ou: token => token === composerToken ? composer : token === routeToken ? route : app,
    st: () => ({ locale: "ko", formatMessage: ({ defaultMessage }) => defaultMessage }),
    Hu: () => ({}), qCn: {}, aCa: () => ({}), d5n: {},
    J3: command => registered.push(command), Rja() {}, hA: hostAtom, hx: toastAtom, fm: intlAtom, goe: {}, IDe: {},
    createBtwCommand, __azraelBtw: h.controller, Px: () => h.manager,
    // Run the pinned QG atom's actual read function, resolving its required
    // scope through the production DK/OK resolver before evaluating it.
    ou: (token, read) => ({ token, read }), Mbr: "attachments", ZG: "extra", mK: "annotations", Wbr: "conflict",
    nativeModule: { __azraelOpenBtwPanel: async options => {
      assert.equal(ctx.DK(options.scope, instances, routeToken), route);
      assert.equal(options.scope, composer);
      return h.openPanel(options);
    } } };
  vm.createContext(ctx);
  const common = fs.readFileSync(path.join(root, BTW_ASSETS[0]), "utf8");
  const composerAst = ts.createSourceFile("composer.js", originals[1], 99, true, 1);
  let attachmentInitializer;
  function visit(node) {
    if (ts.isBinaryExpression(node) && node.left.getText(composerAst) === "QG" && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) attachmentInitializer = node.right.getText(composerAst);
    ts.forEachChild(node, visit);
  }
  visit(composerAst);
  assert.ok(attachmentInitializer?.startsWith("ou(Dh,"));
  const importedScope = composerAst.statements.filter(ts.isImportDeclaration).flatMap(node =>
    node.importClause?.namedBindings?.elements?.filter(spec => spec.name.text === "Dh").map(spec => [node.moduleSpecifier.text, spec.propertyName.text]) ?? []);
  assert.deepEqual(importedScope, [["./app-initial-c014f9ee4429.js", "e2t"]]);
  // Guard the pinned import's actual owner as well as the atom's scope token.
  assert.match(originals[2], /Iv as e2t/);
  assert.match(originals[2], /Iv=z\(`ComposerScope`,\{key:[\s\S]*?parent:Ev,retain:\{max:100\}\}\)/);
  vm.runInContext([declaration(common, "DK"), declaration(common, "OK"),
    declaration(patched[1].text, "__azraelTryBtw").replace('import("./app-initial-c014f9ee4429.js")', 'Promise.resolve(nativeModule)'),
    declaration(patched[1].text, "__azraelRegisterBtw"), declaration(patched[1].text, "rDa"),
    "QG=" + attachmentInitializer].join("\n"), ctx);
  function get(atom) {
    const owner = ctx.DK(this, instances, atom.token);
    if (atom === ctx.QG) {
      attachmentReads++;
      return atom.read({ scope: owner, get: key => ({ attachments, extra: {}, annotations: [], conflict: null })[key] });
    }
    if (atom === hostAtom) return "local";
    if (atom === toastAtom) return { danger: error => errors.push(error) };
    if (atom === intlAtom) return ctx.st();
    assert.fail("Unexpected native atom");
  }
  app.get = get;
  const parentBefore = structuredClone(h.parent);
  for (const [conversationId, running] of [["parent", true], ["restored", false], ["parent", false]]) {
    // Restoring/revisiting a conversation creates a fresh UI scope. No child
    // ComposerScope is discoverable from the route's instance-map fallback.
    route = { token: routeToken, parent: app, get };
    composer = { token: composerToken, parent: route, value: { kind: "local", conversationId }, get };
    attachments = {};
    h.states.set(conversationId, h.parent);
    assert.throws(() => route.get(ctx.QG), /Missing scope instance/);
    registered.length = 0;
    ctx.rDa({ conversationId, isResponseInProgress: running });
    const command = registered.find(command => command.id === "btw");
    const before = h.openings.length;
    await command.onSelect();
    assert.deepEqual(errors, []);
    assert.equal(command.dependencies[0], composer);
    assert.equal(h.openings.length, before + 1);
    assert.equal(h.openings.at(-1).parentId, conversationId);
    assert.equal(h.requests.length, 0, "bare menu selection must not start inference");
    attachments = { imageAttachments: [{}] };
    await command.onSelect();
    assert.match(errors.pop(), /첨부/);
    assert.equal(h.openings.length, before + 1, "attachment rejection must precede panel creation");
  }
  attachments = {};
  assert.equal(await ctx.__azraelTryBtw(composer, "parent", "/btw Why?", { type: "local" }, "local", false, false, {}), true);
  assert.equal(h.requests.at(-1).prompt, "Why?");
  assert.ok(attachmentReads >= 7);
  assert.deepEqual(h.parent, parentBefore);
});

test("actual native panel opener awaits source model and cwd RPC before native tab creation", async () => {
  const calls = [], source = { latestThreadSettings: { model: "gpt-6.1-sol", effort: "medium" } };
  const routeScope = { value: { pathname: "/local/parent", search: "" } };
  const scope = { get: atom => atom.read({ scope: routeScope }) };
  const ctx = { EJi() {}, DDn() {}, qqi() {}, OJi() {}, __azraelInitBtwButton() {}, bc: host => { assert.equal(host, "local"); return false; },
    Ev: {}, q: (_token, read) => ({ read }),
    __azraelBtwRouteScope: undefined, __azraelBtwPanel: "Panel", gJi: async (...args) => { calls.push(args); return "side"; } };
  vm.createContext(ctx); vm.runInContext(declaration(patched[2].text, "__azraelOpenBtwPanel"), ctx);
  const result = await ctx.__azraelOpenBtwPanel({ scope, hostId: "local", parentId: "parent",
    manager: { getConversation: async () => source, getConversationCwd: async () => "/workspace" }, intl: {}, prepare() {}, onDiscard() {} });
  assert.equal(result, "side"); assert.equal(calls[0][0], routeScope); assert.equal(calls[0][2].cwd, "/workspace");
  assert.equal(calls[0][2].collaborationMode.settings.model, "gpt-6.1-sol"); assert.equal(calls[0][2].sideQuestion, true);
  assert.ok(declaration(originals[2], "EJi")); assert.ok(declaration(originals[2], "DDn"));
  let observer, refreshes = 0;
  ctx.__azraelBtwPanel = undefined;
  Object.assign(ctx, { xJi: {}, SJi: {}, __azraelBtwButton: {}, DJi: {}, __azraelBtw: {}, TDn: "native turn atom",
    createBtwPanel: (...args) => { observer = args[5]; return "Panel"; } });
  await ctx.__azraelOpenBtwPanel({ scope, hostId: "local", parentId: "parent",
    manager: { getConversation: async () => source, getConversationCwd: async () => "/workspace" }, intl: {}, prepare() {}, onDiscard() {} });
  const stop = () => {};
  assert.equal(observer({ id: "side", scope: { watch: callback => {
    callback({ get: (atom, key) => { assert.equal(atom, "native turn atom"); assert.equal(key.conversationId, "side"); } }); return stop;
  } } }, () => refreshes++), stop);
  assert.equal(refreshes, 1);
});

test("actual native panel creation receives RouteScope and preserves paths, preparation and readiness for bare and direct btw", async () => {
  const routeToken = { id: "route" }, composerToken = { id: "composer" };
  const instances = new Map(), pending = [], forks = [], completed = [], watched = [];
  let route, composer, h, tabUnavailable = false;
  const panel = { panelId: "right", tabs$: "tabs", tabById$: "tabById",
    async openPendingTab(scope, _type, options) {
      assert.equal(scope, route, "native tab state must receive the route, not the composer");
      pending.push(options); if (tabUnavailable) return null;
      return { isCurrent: () => true, complete: (_type, tab) => { completed.push(tab); return true; }, fail() {} };
    } };
  const ctx = { EJi() {}, DDn() {}, qqi() {}, OJi() {}, __azraelInitBtwButton() {}, bc: () => false,
    Ev: routeToken, q: (scope, read) => ({ scope, read }), __azraelBtwRouteScope: undefined, __azraelBtwPanel: "Panel",
    gVi: {}, Md: "archived", Tq: "archiving", c9: { dropDestinations: ["right"] }, Aj: () => panel,
    CJi: "pending:", XOn: "sidechat:", SJi: { jsx: (type, props) => ({ type, props }) }, TJi: {},
    Eg: "instructions", c$e: "model", Ist: () => ({}), Sp: () => null, hd: "toast", dJi: {}, uJi: {},
    s0t: (scope, _parent, _child) => { assert.equal(scope, route); },
    mJi: (scope, options) => { assert.equal(scope, route); watched.push(options.conversationId); return () => {}; },
    Qqi: async options => {
      assert.equal(options.scope, route); forks.push(options);
      h.states.set("side", { threadRuntimeStatus: { type: "idle" }, turns: [] });
      return { conversationId: "side", hostId: "local", creation: { status: "created", firstTurn: { status: "not-requested" } } };
    } };
  vm.createContext(ctx);
  vm.runInContext([declaration(originals[0], "DK"), declaration(originals[0], "OK"),
    "tj=" + assignedExpression(originals[2], "tj"), declaration(patched[2].text, "gJi"),
    declaration(patched[2].text, "__azraelOpenBtwPanel")].join("\n"), ctx);
  function get(atom) {
    if (atom?.scope) {
      const owner = ctx.DK(this, instances, atom.scope);
      return atom.read({ scope: owner, get: key => owner.get(key) });
    }
    if (atom === "tabs") return [];
    if (atom === "tabById") return { contentInstance: "native-tab" };
    if (["archived", "archiving"].includes(atom)) return false;
    if (atom === "model") return h.parent.latestModel;
    if (atom === "instructions") return {};
    assert.fail("Unexpected native atom");
  }
  for (const [parentId, running, text, search] of [["parent", true, "/btw", "?tab=source"], ["restored", false, "/btw", ""],
    ["parent", true, "/btw Why?", "?tab=source"], ["restored", false, "/btw Why?", ""]]) {
    h = fixture(); h.parent.threadRuntimeStatus.type = running ? "running" : "idle";
    h.states.set(parentId, h.parent);
    const before = structuredClone(h.parent);
    route = { token: routeToken, parent: null, value: { pathname: "/local/" + parentId, search, routeKind: "local-thread" }, get };
    composer = { token: composerToken, parent: route, value: { kind: "local", conversationId: parentId }, get };
    assert.equal(await h.submit({ scope: composer, conversationId: parentId, text, openPanel: ctx.__azraelOpenBtwPanel }), true);
    assert.equal(forks.at(-1).parentNavigationPath, route.value.pathname + search);
    assert.equal(forks.at(-1).sideQuestion, true);
    assert.equal(completed.at(-1).props.SideChatTab, "Panel");
    assert.equal(completed.at(-1).props.conversationId, "side");
    assert.equal(h.controller.lookup("side").parentId, parentId, "native preparation must register the isolated child");
    assert.equal(h.requests.length, text === "/btw" ? 0 : 1);
    if (text !== "/btw") assert.equal(h.requests[0].id, "side");
    assert.deepEqual(h.parent, before);
  }
  assert.equal(pending.length, 4); assert.equal(completed.length, 4); assert.equal(watched.length, 4);
  for (const blocked of [{ routeKind: "other" }, { persistentWorkspace: {} }]) {
    h = fixture(); Object.assign(route.value, { routeKind: "local-thread", persistentWorkspace: null }, blocked);
    await assert.rejects(h.submit({ scope: composer, text: "/btw", openPanel: ctx.__azraelOpenBtwPanel }), /패널/);
    assert.equal(pending.length, 4); assert.equal(forks.length, 4); assert.equal(h.requests.length, 0);
  }
  Object.assign(route.value, { routeKind: "local-thread", persistentWorkspace: null });
  h = fixture(); tabUnavailable = true;
  await assert.rejects(h.submit({ scope: composer, text: "/btw", openPanel: ctx.__azraelOpenBtwPanel }), /패널/);
  assert.equal(forks.length, 4, "unavailable native tabs must prevent the fork");
});

test("actual native fork request preserves ephemeral/excludeTurns, sends sideQuestion and has no goal continuation", async () => {
  const context = { n1: x => x, NEn: x => x, Lt: "native side-conversation boundary" };
  vm.createContext(context); vm.runInContext(declaration(patched[0].text, "$En"), context);
  const native = context.$En({ getHostId: () => "local", requestClient: { getAppServerVersion: () => "0.160.1" }, getConversation: () => ({ cwd: "/workspace" }) },
    { sourceConversationId: "parent", sideQuestion: true, sideConversation: true, ephemeral: true, model: "managed/anthropic/current" },
    { readTokenBudgetThread: () => false, readConfig: async () => ({}) }, { mapThreadTurns: x => x });
  const { request } = await native.prepareRequest();
  assert.equal(request.sideQuestion, true); assert.equal(request.ephemeral, true); assert.equal(request.excludeTurns, true);
  assert.equal(request.threadId, "parent"); assert.equal(request.deferGoalContinuation, undefined);
});

test("unacknowledged older engine forks are discarded before side inference, while ordinary forks retain their behavior", async () => {
  const requests = [], ctx = {};
  vm.createContext(ctx); vm.runInContext(declaration(patched[0].text, "__azraelCheckBtwFork"), ctx);
  const manager = { sendRequest: async (method, params) => requests.push({ method, params }) };
  await assert.rejects(ctx.__azraelCheckBtwFork(manager, { sideQuestion: true }, { thread: { id: "unsupported" } }), /지원하지/);
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ method: "thread/unsubscribe", params: { threadId: "unsupported" } }]);
  await ctx.__azraelCheckBtwFork(manager, { sideQuestion: true }, { sideQuestion: true, thread: { id: "supported" } });
  await ctx.__azraelCheckBtwFork(manager, {}, { thread: { id: "ordinary" } });
  assert.equal(requests.length, 1);
});

test("expired /btw panels cannot recreate an ordinary tool-enabled side chat", () => {
  const notices=[];let forks=0;
  const ast=ts.createSourceFile("thread.js",patched[3].text,99,true,1);let callback;
  function visit(node){if(ts.isArrowFunction(node)&&node.getText(ast).startsWith("()=>{if(globalThis.__azraelBtw?.lookup(n))"))callback=node.getText(ast);ts.forEachChild(node,visit)}visit(ast);assert.ok(callback);
  const ctx={n:"side",i:"parent",h:false,g(){},Hr:()=>{forks++;return Promise.resolve(null)},bg:{},c:{get:()=>({danger:message=>notices.push(message)})},un:{},__azraelBtw:{lookup:id=>id==="side"?{}:undefined}};
  vm.runInNewContext(callback,ctx)();assert.equal(forks,0);assert.match(notices[0],/\/btw/);
});

test("actual composer routes /btw before queue, goal, history and steering and clears only its owned draft", async () => {
  const composer = injectBtw(injectComposerDraft(originals[1]).text, BTW_ASSETS[1]).text;
  const names = ["zMa", "__azraelComposerSnapshot", "__azraelComposerMatches"], code = names.map(n => declaration(composer, n)).join("\n");
  let text = "/btw explain", routed = 0, cleared = 0, admission = 0; const errors = [];
  const ctx = { performance, Nx: () => ({ u: () => ({}), e: e => { throw e; }, d() {} }), dq: "blocked", QG: "attachments", RG: { drafts$: "drafts" },
    g_: () => "parent", PG: x => x, IG: { default: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    uK: 1, OW: 2, DW: 3, iW: 4, lW: 5, SW: 6, xW: 7, jnt: x => x,
    __azraelBtw: { lookup: () => undefined, matches: text => /^\s*\/btw(?:\s|$)/.test(text) }, __azraelTryBtw: async () => { routed++; return true; } };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const scope = { value: {}, get: atom => atom === "drafts" ? { parent: {} } : atom === "attachments" ? {} : undefined };
  const submit = () => ctx.zMa({ scope, composerController: { getText: () => text, getPersistedText: () => text }, clearStopTurnConfirmation() {},
    conversationId: "parent", submitTarget: { type: "local" }, clearComposerUi: () => { text = ""; cleared++; }, options: {},
    prepareGoalSubmit: () => { admission++; }, appendPromptToHistory: () => { admission++; }, handleSubmitError: e => errors.push(e) });
  await submit(); assert.deepEqual(errors, []); assert.equal(routed, 1); assert.equal(cleared, 1); assert.equal(admission, 0);
  text = "/btw another"; ctx.__azraelTryBtw = async () => { text = "new draft"; return true; };
  await submit(); assert.equal(text, "new draft"); assert.equal(cleared, 1);
  text = "/btw failure"; ctx.__azraelTryBtw = async () => { throw Error("fork failed"); };
  await submit(); assert.equal(text, "/btw failure"); assert.equal(cleared, 1); assert.match(errors.at(-1).message, /fork failed/);
});

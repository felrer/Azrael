"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { injectAccountSettings, ACCOUNT_SETTINGS_ASSET, AzraelAccountSettings } = require("./inject-account-settings.cjs");
const namespace = require("./namespace-azrael-host.cjs");
const ts = require(require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
const root = path.resolve(__dirname, "../artifacts/upstream-ui/26.928.31416");

test("pinned settings and host transforms parse, reject drift and invalidate the cache", () => {
  for (const asset of [ACCOUNT_SETTINGS_ASSET, "out/extension.js"]) {
    const source = fs.readFileSync(path.join(root, asset), "utf8");
    const result = injectAccountSettings(source, asset);
    assert.equal(result.count, 1);
    assert.equal(ts.createSourceFile(asset, result.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS).parseDiagnostics.length, 0);
    assert.equal(injectAccountSettings(result.text, asset).count, 0);
    assert.throws(() => injectAccountSettings("", asset), /anchor changed/);
    if (asset === ACCOUNT_SETTINGS_ASSET) assert(result.text.includes('if(ne===`usage`)Ne=(0,$.jsx)(AzraelAccountSettings,{})'));
    else assert(result.text.includes('executeCommand("azrael.accountsEmbedded",e,r,this.findPanelByWebview(e))'));
  }
  assert(namespace.getTransformRules()["inject-account-settings.cjs"]);
});

test("display branding preserves backend identifiers, URLs and model names", () => {
  const source = 'const settings="Codex Settings",brand="Codex";const qOt=`azrael`;const auth="chatgpt",home="CODEX_HOME",url="https://chatgpt.com/Codex";const memory={id:"settings.memory",defaultMessage:"Delete Codex memories"};const model={defaultMessage:"Codex Spark"};';
  const text = namespace.rewriteJavaScript(source, "branding.js", ts).text;
  for (const expected of ["Azrael Settings", 'brand="Azrael"', 'qOt=`Azrael`', "Delete Azrael memories", 'auth="chatgpt"', 'home="CODEX_HOME"', "https://chatgpt.com/Codex", "Codex Spark"]) assert(text.includes(expected), expected);
  const host = fs.readFileSync(path.join(root, "out/extension.js"), "utf8");
  assert(namespace.rewriteJavaScript(host, "extension.js", ts).text.includes('new SR("Azrael Settings")'));
  const memory = fs.readFileSync(path.join(root, "webview/assets/app-initial-4bd9e54bcd58.js"), "utf8");
  const rewrittenMemory = namespace.rewriteJavaScript(memory, "memory.js", ts).text;
  for (const label of ["Azrael memory", "Enable Azrael memories", "Delete Azrael memories"]) assert(rewrittenMemory.includes(label), label);
  const koreanPath = "webview/assets/ko-KR-669e0b3acfd6.js";
  const korean = namespace.rewriteJavaScript(fs.readFileSync(path.join(root, koreanPath), "utf8"), koreanPath, ts).text;
  for (const label of ["Azrael 메모리", "Azrael 설정"]) assert(korean.includes(label), label);
  assert(!korean.includes("Codex 메모리"));
  const manifest = namespace.transformManifest(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")), "1.0.0");
  assert.equal(manifest.displayName, "Azrael");
  assert(manifest.contributes.commands.every(command => command.category === "Azrael"));
  for (const containers of Object.values(manifest.contributes.viewsContainers)) {
    assert(containers.every(container => container.title === "Azrael"));
  }
});

test("settings mount renders scoped markup, forwards actions and cleans subscriptions", () => {
  let effect, cleanup, receiver, click;
  const sent = [];
  const shadow = { innerHTML: "", addEventListener: (_, fn) => { click = fn; }, removeEventListener: (_, fn) => { assert.equal(fn, click); click = undefined; } };
  const element = { attachShadow: () => shadow };
  class Element { closest() { return this; } }
  class HTMLElement extends Element { dataset = { action: "openaiSwitch", profile: "profile-1" }; disabled = false; }
  const component = vm.runInNewContext("(" + AzraelAccountSettings.toString() + ")", {
    Q: { useRef: () => ({ current: element }), useEffect: fn => { effect = fn; } },
    $: { jsx: (tag, props) => ({ tag, props }) },
    crypto: { randomUUID: () => "mount-1" }, Element, HTMLElement,
    azraelAccountBridge: { dispatchMessage: (type, message) => sent.push({ type, ...message }),
      subscribe: (_, fn) => { receiver = fn; return () => { receiver = undefined; }; } },
  });
  assert.equal(component().tag, "div");
  cleanup = effect();
  assert.equal(sent[0].action, "mount");
  receiver({ clientId: "stale", html: "stale" });
  assert(!shadow.innerHTML.includes("stale"));
  receiver({ clientId: "mount-1", html: "<style>:host{}</style><main>accounts</main>" });
  assert(shadow.innerHTML.includes("accounts"));
  const button = new HTMLElement();
  click({ target: button });
  assert.equal(sent[1].message.profileId, "profile-1");
  button.disabled = true;
  click({ target: button });
  assert.equal(sent.length, 2);
  cleanup();
  assert.equal(sent[2].action, "unmount");
  assert.equal(receiver, undefined);
  assert.equal(click, undefined);
});

function loadUsageView() {
  const filename = path.resolve(__dirname, "../extensions/azrael-ex/src/usageView.ts");
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  let timerCount = 0;
  const context = {
    module, exports: module.exports, setInterval: () => ++timerCount, clearInterval: () => --timerCount,
    require: name => {
      if (name === "vscode") return {};
      if (name === "node:crypto") return require(name);
      if (name === "./protocol") return { isRecord: v => v !== null && typeof v === "object" && !Array.isArray(v) };
      if (name === "./resetCredit") return { ResetCreditService: class {} };
      return {};
    },
  };
  vm.runInNewContext(source, context, { filename });
  return { UsageView: module.exports.UsageView, timers: () => timerCount };
}

test("embedded lifecycle rejects stale actions and follows panel visibility", async () => {
  const { UsageView, timers } = loadUsageView();
  const service = new EventEmitter();
  const devin = { cancelRefresh() {}, dispose() {} };
  const view = new UsageView(service, {}, devin);
  let actions = 0, refreshes = 0, disposed, visibility;
  view.renderMarkup = () => "<style>:host{}</style><main>shared</main>";
  view.refresh = async () => { ++refreshes; };
  view.onMessage = async () => { ++actions; };
  const received = [];
  const webview = { postMessage: async msg => { received.push(msg); return true; } };
  const panel = { visible: true, onDidDispose: fn => { disposed = fn; return { dispose() {} }; },
    onDidChangeViewState: fn => { visibility = fn; return { dispose() {} }; } };
  const request = (action, clientId = "mount-1") => view.handleEmbedded(webview, { type: "azrael-accounts", action, clientId, message: {} }, panel);
  await request("mount");
  assert.equal(received[0].html, "<style>:host{}</style><main>shared</main>");
  assert.equal(timers(), 1);
  assert.equal(service.listenerCount("state"), 1);
  await request("action", "stale");
  assert.equal(actions, 0);
  await request("action");
  assert.equal(actions, 1);
  panel.visible = false; visibility();
  assert.equal(timers(), 0);
  assert.equal(service.listenerCount("state"), 0);
  const before = refreshes;
  panel.visible = true; visibility();
  assert(refreshes > before);
  assert.equal(timers(), 1);
  await request("mount", "mount-2");
  await request("unmount", "mount-1");
  assert.equal(timers(), 1);
  disposed();
  assert.equal(timers(), 0);
  view.dispose();
});

test("failed posts remove embedded targets and stop refresh", async () => {
  const { UsageView, timers } = loadUsageView();
  const view = new UsageView(new EventEmitter(), {}, { cancelRefresh() {}, dispose() {} });
  view.renderMarkup = () => "shared";
  view.refresh = async () => {};
  await view.handleEmbedded({ postMessage: async () => false }, { type: "azrael-accounts", action: "mount", clientId: "mount" });
  await Promise.resolve();
  assert.equal(timers(), 0);
  view.dispose();
});

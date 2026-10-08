"use strict";
const assert = require("node:assert/strict");
const ms = require("node:fs");
const path = require("node:path");
const gm = require("node:vm");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { injectAccountSettings, ACCOUNT_SETTINGS_ASSET, AzraelAccountSettings } = require("./inject-account-settings.cjs");
const namespace = require("./namespace-azrael-host.cjs");
const Nf = require(require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
const root = path.resolve(__dirname, "../artifacts/upstream-ui/26.930.61225");

test("pinned settings and host transforms parse, reject drift and invalidate the cache", () => {
  for (const asset of [ACCOUNT_SETTINGS_ASSET, "out/extension.js"]) {
    const source = ms.readFileSync(path.join(root, asset), "utf8");
    const result = injectAccountSettings(source, asset);
    assert.equal(result.count, 1);
    assert.equal(Nf.createSourceFile(asset, result.text, Nf.ScriptTarget.Latest, true, Nf.ScriptKind.JS).parseDiagnostics.length, 0);
    assert.equal(injectAccountSettings(result.text, asset).count, 0);
    assert.throws(() => injectAccountSettings(result.text + "/*azrael-account-settings-v1*/", asset), /Duplicate/);
    assert.throws(() => injectAccountSettings("", asset), /anchor changed/);
    if (asset === ACCOUNT_SETTINGS_ASSET) {
      assert(source.includes('(0,Z.jsx)(fr,{canCollapse:x,externalTooltip:$e,hideLabels:F})'));
      assert(!result.text.includes('(0,Z.jsx)(fr,{canCollapse:x,externalTooltip:$e,hideLabels:F})'));
      assert(result.text.includes('if(x===`usage`)Pe=(0,$.jsx)(AzraelAccountSettings,{})'));
    }
    else {
      assert(source.includes('case"open-vscode-command":{Ge.commands.executeCommand'));
      assert(result.text.includes('Ge.commands.executeCommand("azrael.accountsEmbedded",e,r,this.findPanelByWebview(e))'));
    }
  }
  assert(namespace.getTransformRules()["inject-account-settings.cjs"]);
});

test("display branding preserves backend identifiers, URLs and model names", () => {
  const source = 'const settings="Codex Settings",brand="Codex";const qOt=`azrael`;const auth="chatgpt",home="CODEX_HOME",url="https://chatgpt.com/Codex";const memory={id:"settings.memory",defaultMessage:"Delete Codex memories"};const model={defaultMessage:"Codex Spark"};';
  const text = namespace.rewriteJavaScript(source, "branding.js", Nf).text;
  for (const expected of ["Azrael Settings", 'brand="Azrael"', 'qOt=`Azrael`', "Delete Azrael memories", 'auth="chatgpt"', 'home="CODEX_HOME"', "https://chatgpt.com/Codex", "Codex Spark"]) assert(text.includes(expected), expected);
  const host = ms.readFileSync(path.join(root, "out/extension.js"), "utf8");
  assert(namespace.rewriteJavaScript(host, "extension.js", Nf).text.includes('new SR("Azrael Settings")'));
  const memory = ms.readFileSync(path.join(root, "webview/assets/app-initial-5120fa5fe295.js"), "utf8");
  const rewrittenMemory = namespace.rewriteJavaScript(memory, "memory.js", Nf).text;
  for (const label of ["Azrael memory", "Enable Azrael memories", "Delete Azrael memories"]) assert(rewrittenMemory.includes(label), label);
  const koreanPath = "webview/assets/ko-KR-669e0b3acfd6.js";
  const korean = namespace.rewriteJavaScript(ms.readFileSync(path.join(root, koreanPath), "utf8"), koreanPath, Nf).text;
  for (const label of ["Azrael 메모리", "Azrael 설정"]) assert(korean.includes(label), label);
  assert(!korean.includes("Codex 메모리"));
  const manifest = namespace.transformManifest(JSON.parse(ms.readFileSync(path.join(root, "package.json"), "utf8")), "1.0.0");
  assert.equal(manifest.displayName, "Azrael");
  assert(manifest.contributes.commands.every(command => command.category === "Azrael"));
  for (const containers of Object.values(manifest.contributes.viewsContainers)) {
    assert(containers.every(container => container.title === "Azrael"));
  }
});

test("settings mount renders scoped markup, forwards actions and cleans subscriptions", () => {
  let effect, cleanup, receiver, click, change, toggle, keydown;
  const sent = [];
  const shadow = { innerHTML: "", querySelector: () => null, addEventListener: (type, fn) => { if (type === "click") click = fn; else if (type === "change") change = fn; else if (type === "keydown") keydown = fn; else toggle = fn; }, removeEventListener: (type, fn) => { assert.equal(fn, type === "click" ? click : type === "change" ? change : type === "keydown" ? keydown : toggle); if (type === "click") click = undefined; else if (type === "change") change = undefined; else if (type === "keydown") keydown = undefined; else toggle = undefined; } };
  const element = { attachShadow: () => shadow };
  class Element { closest() { return this; } }
  class HTMLElement extends Element { dataset = { action: "openaiSwitch", profile: "profile-1" }; disabled = false; }
  class HTMLInputElement extends HTMLElement { type = "checkbox"; checked = true; dataset = { action: "setAutoSwitch", provider: "provider", account: "saved" }; }
  class HTMLDetailsElement extends HTMLElement { open = true; classList = { contains: value => value === "ticket-details" }; dataset = { profile: 'profile-1', workspace: 'workspace-1' }; }
  const component = gm.runInNewContext("(" + AzraelAccountSettings.toString() + ")", {
    Q: { useRef: () => ({ current: element }), useEffect: fn => { effect = fn; } },
    $: { jsx: (tag, props) => ({ tag, props }) },
    crypto: { randomUUID: () => "mount-1" }, Element, HTMLElement, HTMLInputElement, HTMLDetailsElement,
    azraelAccountBridge: { dispatchMessage: (type, message) => sent.push({ type, ...message }),
      subscribe: (v, fn) => { receiver = fn; return () => { receiver = undefined; }; } },
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
  const input = new HTMLInputElement();
  change({ target: input });
  assert.equal(sent[2].message.enabled, true);
  assert.equal(sent[2].message.accountId, "saved");
  assert.equal(input.disabled, true);
  change({ target: input });
  assert.equal(sent.length, 3);
  toggle({ target: new HTMLDetailsElement() });
  assert.deepEqual(JSON.parse(JSON.stringify(sent[3].message)), { action: 'ticketDetails', profileId: 'profile-1', workspaceAccountId: 'workspace-1', open: true });
  button.disabled = false;
  button.dataset = { action: 'consumeResetCredit', profile: 'profile-1', workspace: 'workspace-1', credit: 'selected-ticket' };
  click({ target: button });
  assert.equal(sent[4].message.creditId, 'selected-ticket');
  let activated = 0, prevented = 0;
  const summary = new HTMLElement();
  summary.dataset = { action: 'toggleUsage', profile: 'profile-1', workspace: 'workspace-1' };
  summary.getAttribute = () => 'button';
  summary.click = () => { ++activated; };
  for (const key of ['Enter', ' ']) keydown({ target: summary, key, preventDefault: () => { ++prevented; } });
  keydown({ target: summary, key: 'ArrowDown' });
  assert.equal(activated, 2);
  assert.equal(prevented, 2);
  cleanup();
  assert.equal(sent[5].action, "unmount");
  assert.equal(change, undefined);
  assert.equal(receiver, undefined);
  assert.equal(click, undefined);
  assert.equal(toggle, undefined);
  assert.equal(keydown, undefined);
});

function loadUsageView() {
  const filename = path.resolve(__dirname, "../extensions/azrael-ex/src/usageView.ts");
  const source = Nf.transpileModule(ms.readFileSync(filename, "utf8"), { compilerOptions: { module: Nf.ModuleKind.CommonJS, target: Nf.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  let timerCount = 0;
  const context = {
    module, exports: module.exports, setInterval: () => ++timerCount, clearInterval: () => --timerCount,
    require: name => {
      if (name === "vscode") return {};
      if (name === "node:crypto") return require(name);
      if (name === "./protocol") return { isRecord: y => y !== null && typeof y === "object" && !Array.isArray(y) };
      if (name === "./resetCredit") return { ResetCreditService: class {} };
      return {};
    },
  };
  gm.runInNewContext(source, context, { filename });
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

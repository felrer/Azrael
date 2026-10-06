"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require(require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
const { INSTRUCTION_SETTINGS_ASSETS, injectInstructionSettings, AzraelInstructionSettings } = require("./inject-instruction-settings.cjs");
const { injectAccountSettings } = require("./inject-account-settings.cjs");
const root = path.resolve(__dirname, "../artifacts/upstream-ui/26.930.61225");

test("settings command opens the existing native settings panel for pristine and namespaced hosts", async () => {
  const pristine = fs.readFileSync(path.join(root, "out/extension.js"), "utf8");
  for (const source of [pristine, pristine.replace('"chatgpt.openSidebar"', '"azrael.openSidebar"')]) {
    const { text } = injectInstructionSettings(source, "out/extension.js");
    const registration = text.match(/e\.push\(kt\.commands\.registerCommand\("azrael\.openSettingsPanel".*?\)\)\)/)?.[0];
    assert.ok(registration);
    const calls = [], subscriptions = [];
    let handler;
    vm.runInNewContext(registration, { e: subscriptions,
      kt: { commands: { registerCommand(command, callback) { assert.equal(command, "azrael.openSettingsPanel"); handler = callback; return "disposable"; } } },
      Pe: { async showSettings(options) { calls.push(options.section); } },
    });
    await handler();
    assert.deepEqual(calls, ["general-settings"]);
    assert.deepEqual(subscriptions, ["disposable"]);
    assert.throws(() => injectInstructionSettings(source.replace(/registerCommand\("(?:chatgpt|azrael)\.openSidebar",Au\)/, "changed"), "out/extension.js"), /sidebar registration anchor changed/);
  }
});

test("pinned native registration/content/host parse; anchors fail closed; account transforms compose in both orders", () => {
  for (const asset of [...INSTRUCTION_SETTINGS_ASSETS, "out/extension.js"]) {
    const source = fs.readFileSync(path.join(root, asset), "utf8");
    const result = injectInstructionSettings(source, asset);
    assert.equal(result.count, 1);
    assert.equal(ts.createSourceFile(asset, result.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS).parseDiagnostics.length, 0);
    assert.equal(injectInstructionSettings(result.text, asset).count, 0);
    assert.throws(() => injectInstructionSettings(result.text + "/*azrael-instruction-settings-v1*/", asset), /Duplicate/);
    assert.equal(ts.createSourceFile(asset, result.text, 99, true, ts.ScriptKind.JS).statements.filter(ts.isExportDeclaration).length,
      ts.createSourceFile(asset, source, 99, true, ts.ScriptKind.JS).statements.filter(ts.isExportDeclaration).length);
    assert.throws(() => injectInstructionSettings("", asset), /anchor changed/);
    for (const composed of [injectAccountSettings(result.text, asset).text, injectInstructionSettings(injectAccountSettings(source, asset).text, asset).text]) {
      assert.equal(ts.createSourceFile(asset, composed, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS).parseDiagnostics.length, 0);
      assert(composed.includes("azrael-instruction-settings-v1"));
      if (asset !== INSTRUCTION_SETTINGS_ASSETS[0]) assert(composed.includes("azrael-account-settings-v1"));
    }
    if (asset === INSTRUCTION_SETTINGS_ASSETS[0]) {
      assert(result.text.includes('e.slug===`personalization`?[e,{slug:`azrael-instructions`}]:[e]'));
      assert(result.text.includes('case`azrael-instructions`:case`general-settings`'));
      assert(result.text.includes('assets:{16:Or,20:Er}'));
    }
    if (asset === INSTRUCTION_SETTINGS_ASSETS[1]) {
      assert(result.text.includes('.personalization.azrael-instructions.pets.'));
      assert(result.text.includes('`personalization`,`azrael-instructions`,`pets`'));
    }
  }
});

test("native mount request correlation, action payload, busy gate, delayed response and cleanup", () => {
  let effect, receiver, cleanup, timer;
  const sent = [], listeners = {};
  const shadow = { innerHTML: "", addEventListener: (kind, mn) => { listeners[kind] = mn; }, removeEventListener: kind => { delete listeners[kind]; },
    querySelector: selector => selector === "select" ? { value: "1.2.0" } : null,
    querySelectorAll: () => [{ dataset: { component: "agents" } }] };
  class Element { closest() { return this; } }
  class HTMLElement extends Element { dataset = { action: "download", path: "AGENTS.md" }; disabled = false; }
  const component = vm.runInNewContext("(" + AzraelInstructionSettings.toString() + ")", {
    Q: { useRef: () => ({ current: { attachShadow: () => shadow } }), useEffect: mn => { effect = mn; } },
    $: { jsx: (tag, props) => ({ tag, props }) }, crypto: { randomUUID: () => "mount" }, Element, HTMLElement,
    setTimeout: mn => { timer = mn; return 1; }, clearTimeout: () => { timer = undefined; },
    azraelInstructionBridge: { dispatchMessage: (type, message) => sent.push({ type, ...message }), subscribe: (y, mn) => { receiver = mn; return () => {}; } },
  });
  component(); cleanup = effect();
  assert.equal(sent[0].action, "mount");
  receiver({ clientId: "mount", requestId: "stale", html: "stale" }); assert(!shadow.innerHTML.includes("stale"));
  receiver({ clientId: "mount", requestId: "1", html: "ready" }); assert.equal(shadow.innerHTML, "ready");
  listeners.click({ target: new HTMLElement() }); assert.equal(sent[1].action, "download"); assert.equal(sent[1].message.version, "1.2.0");
  assert.deepEqual(Array.from(sent[1].message.componentIds), ["agents"]);
  listeners.click({ target: new HTMLElement() }); assert.equal(sent.length, 2);
  receiver({ clientId: "mount", requestId: "2", html: "done" });
  const select = new HTMLElement(); select.dataset.action = "selectVersion";
  listeners.change({ target: select }); timer(); assert.equal(sent[2].action, "selectVersion");
  const late = receiver; cleanup(); late({ clientId: "mount", requestId: "4", html: "late" });
  assert.equal(shadow.innerHTML, ""); assert.equal(sent[3].action, "unmount"); assert.equal(Object.keys(listeners).length, 0);
});

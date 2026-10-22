"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require(require.resolve("typescript", { paths: [path.resolve(__dirname, "../extensions/azrael-ex")] }));
const { INSTRUCTION_SETTINGS_ASSETS, injectInstructionSettings, AzraelInstructionSettings, azraelSettingsText, instructionClientTools } = require("./inject-instruction-settings.cjs");
const { injectAccountSettings } = require("./inject-account-settings.cjs");
const root = path.resolve(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.resolve(__dirname, "../artifacts/upstream-ui/26.1007.21434"));

test("native and standalone instruction clients share the same serialized tools", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../extensions/azrael-ex/src/instructionView.ts"), "utf8");
  const ast = ts.createSourceFile("instructionView.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "instructionClientTools");
  const serialized = ts.transpileModule(declaration.getText(ast).replace(/^export /, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim();
  assert.equal(instructionClientTools.toString(), serialized);
});

test("acquisition uses the selected version in the active detail instead of hidden catalog controls", () => {
  const controls = digest => ({ dataset: { versionControls: "entry" }, querySelector: selector => selector === '[data-field="to-digest"]' ? { value: digest } : undefined });
  const detail = controls("historical"), hidden = controls("latest");
  const shadow = { querySelector: () => undefined, querySelectorAll: selector => selector === '.library-reading [data-version-controls]' ? [detail] : [hidden, detail] };
  const tools = instructionClientTools(shadow);
  const button = { dataset: { action: "libraryPlanAcquire", id: "entry" }, closest: () => null };
  assert.deepEqual(tools.payload(button), { id: "entry", digest: "historical" });
  button.closest = () => controls("inline-choice");
  assert.deepEqual(tools.payload(button), { id: "entry", digest: "inline-choice" });
});

test("library client preserves full source drafts through busy/plan rerenders and sends scoped actions", () => {
  const field = (name, value) => ({ dataset: { field: name }, value });
  const file = (name, encoding, value) => ({ dataset: { filePath: name, encoding }, value });
  let fields = [field("name", "Edited name"), field("sharing", "local"), field("file-path", "references/guide.md")];
  let files = [file("SKILL.md", "utf8", "unsaved <script>한국어</script>"), file("references/guide.md", "utf8", "edited support"), file("image.png", "base64", "AQID")];
  const panels = files.map(f => ({ dataset: { filePanel: f.dataset.filePath }, hidden: false }));
  const editor = { dataset: { editorId: "one" }, querySelector: selector => fields.find(f => selector.includes('"' + f.dataset.field + '"')),
    querySelectorAll: selector => selector === 'textarea[data-file-path]' ? files : [...fields, ...files] };
  const filters = [{ dataset: { filter: "search" }, value: "edit" }, { dataset: { filter: "kind" }, value: "skill" }, { dataset: { filter: "sharing" }, value: "local" }];
  const entries = [{ dataset: { name: "Edited name", kind: "skill", sharing: "local" } }, { dataset: { name: "Other", kind: "context", sharing: "public" } }];
  const create = [field("create-name", "new-skill"), field("create-kind", "skill"), field("create-sharing", "collaborators")];
  const revision = { dataset: { libraryRevision: "7" } };
  const alert = { textContent: "" };
  const shadow = {
    querySelector: selector => selector === '[data-editor-id]' ? editor : selector === '[data-library-revision]' ? revision : selector === '[data-client-error]' ? alert : filters.find(e => selector.includes('"' + e.dataset.filter + '"')) ?? [...fields, ...create].find(e => selector.includes('"' + e.dataset.field + '"')),
    querySelectorAll: selector => selector === '[data-filter]' ? filters : selector === '.library-entry' ? entries : selector === '[data-file-panel]' ? panels : [],
  };
  const tools = instructionClientTools(shadow);
  tools.capture();
  // Host busy and plan responses contain the old saved source. Restore edits after replacement.
  fields = [field("name", "Saved name"), field("sharing", "collaborators"), field("file-path", "SKILL.md")];
  files = [file("SKILL.md", "utf8", "saved source"), file("references/guide.md", "utf8", "saved support"), file("image.png", "base64", "AQID")];
  tools.restore();
  assert.equal(fields[0].value, "Edited name"); assert.equal(files[0].value, "unsaved <script>한국어</script>"); assert.equal(files[1].value, "edited support");
  assert.equal(panels[0].hidden, true); assert.equal(panels[1].hidden, false);
  assert.equal(entries[0].hidden, false); assert.equal(entries[1].hidden, true);
  const button = action => ({ dataset: { action, id: "one", token: "frozen-token" } });
  assert.deepEqual(tools.payload(button("librarySave")), { id: "one", name: "Edited name", sharing: "local", revision: 7, files: files.map(f => ({ path: f.dataset.filePath, encoding: f.dataset.encoding, content: f.value })) });
  assert.deepEqual(tools.payload(button("libraryPlanApply")), { ids: ["one"] });
  fields.push(field("publish-version", "1.2.0"));
  assert.throws(() => tools.payload(button("libraryPlanPublish")), /publish repository/);
  fields.push(field("publish-repository", "owner/personal"));
  assert.deepEqual(tools.payload(button("libraryPlanPublish")), { ids: ["one"], version: "1.2.0", repository: "owner/personal" });
  assert.deepEqual(tools.payload(button("libraryPublish")), { token: "frozen-token" });
  assert.deepEqual(tools.payload(button("libraryImport")), { id: "one" });
  const created = tools.payload(button("libraryCreate"));
  assert.equal(created.sharing, "collaborators"); assert.equal(created.files[0].path, "SKILL.md"); assert.match(created.files[0].content, /name: new-skill/);
  create[0].value = "한국어 제목";
  const korean = tools.payload(button("libraryCreate"));
  assert.equal(korean.name, "한국어 제목"); assert.match(korean.files[0].content, /name: skill-[a-f0-9]{12}\n/);
  create.push(field("create-installation-name", "my-skill"));
  assert.match(tools.payload(button("libraryCreate")).files[0].content, /name: my-skill\n/);
  create.at(-1).value = "잘못된 이름";
  assert.throws(() => tools.payload(button("libraryCreate")), /ASCII/);
  create.at(-1).value = ""; create[1].value = "playbook";
  assert.equal(tools.payload(button("libraryCreate")).files[0].path, "PLAYBOOK.md");
  create[1].value = "agent-role";
  const role = tools.payload(button("libraryCreate")).files[0];
  assert.equal(role.path, "role.toml"); assert.match(role.content, /developer_instructions = """/);
  assert.deepEqual(tools.payload(button("libraryAcquire")), { token: "frozen-token" });
  assert.deepEqual(tools.payload(button("libraryOpenInstalled")), { id: "one" });
  fields.push(field("profile", '{"model":"recommended","dependencies":[{"id":"context","digest":"pinned"}]}'));
  assert.deepEqual(tools.payload(button("librarySave")).profile.dependencies, [{ id: "context", digest: "pinned" }]);
  fields.at(-1).value = '{ malformed'; assert.throws(() => tools.payload(button("librarySave")), SyntaxError);
  tools.error(new Error("JSON parse failed")); assert.equal(alert.textContent, "JSON parse failed");
});

test("application locale recognizes Korean variants and falls back to English", () => {
  for (const locale of ["ko", "ko-KR", "KO-kr", "ko_KR"]) assert.equal(azraelSettingsText(locale, "English", "한국어"), "한국어");
  for (const locale of ["en", "en-US", "ja", "korean", "", undefined, null, 42]) assert.equal(azraelSettingsText(locale, "English", "한국어"), "English");
});

test("application locale change cleans the old instruction mount and ignores late callbacks", () => {
  let locale = "en-US", dependencies, pendingEffect, cleanup, timer, serial = 0;
  const sent = [], receivers = [], listeners = new Map(), unsubscribed = [];
  const shadow = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [],
    addEventListener: (kind, callback) => listeners.set(kind, callback),
    removeEventListener: (kind, callback) => { if (listeners.get(kind) === callback) listeners.delete(kind); } };
  const element = { shadowRoot: shadow };
  class Element { closest() { return this; } }
  class HTMLElement extends Element { dataset = { action: "selectVersion" }; }
  const component = vm.runInNewContext("(" + AzraelInstructionSettings.toString() + ")", {
    s: () => ({ locale }), azraelSettingsText, instructionClientTools, Element, HTMLElement,
    Q: { useRef: () => ({ current: element }), useEffect: (effect, next) => {
      if (!dependencies || next.some((value, i) => value !== dependencies[i])) { dependencies = next; pendingEffect = effect; }
    } }, $: { jsx: (tag, props) => ({ tag, props }) }, crypto: { randomUUID: () => "mount-" + ++serial },
    setTimeout: callback => { timer = callback; return 1; }, clearTimeout: () => { timer = undefined; },
    azraelInstructionBridge: { dispatchMessage: (type, message) => sent.push({ type, ...message }), subscribe: (_type, callback) => {
      const index = receivers.push(callback) - 1; return () => unsubscribed.push(index);
    } },
  });
  const render = next => { locale = next; component(); if (pendingEffect) { cleanup?.(); cleanup = pendingEffect(); pendingEffect = undefined; } };
  render("en-US"); assert.match(shadow.innerHTML, /Loading instruction documents/);
  assert.equal(sent[0].locale, "en-US");
  receivers[0]({ clientId: "mount-1", requestId: "1", html: "English host" });
  listeners.get("change")({ target: new HTMLElement() }); const delayed = timer;
  render("ko-KR"); assert.match(shadow.innerHTML, /지침 문서를 불러오는/);
  assert.deepEqual(sent.map(x => [x.action, x.locale]), [["mount", "en-US"], ["unmount", "en-US"], ["mount", "ko-KR"]]);
  assert.deepEqual(unsubscribed, [0]); assert.equal(listeners.size, 3); assert.equal(timer, undefined);
  delayed(); receivers[0]({ clientId: "mount-1", requestId: "2", html: "late English host" });
  receivers[1]({ clientId: "mount-1", requestId: "1", html: "wrong client" });
  assert.match(shadow.innerHTML, /지침 문서를 불러오는/); assert.equal(sent.length, 3);
  receivers[1]({ clientId: "mount-2", requestId: "1", html: "한국어 host" }); assert.equal(shadow.innerHTML, "한국어 host");
  render("ko-KR"); assert.equal(sent.length, 3);
  cleanup(); assert.equal(shadow.innerHTML, ""); assert.equal(listeners.size, 0); assert.deepEqual(unsubscribed, [0, 1]);
});

test("settings command opens the existing native settings panel for pristine and namespaced hosts", async () => {
  const pristine = fs.readFileSync(path.join(root, "out/extension.js"), "utf8");
  for (const source of [pristine, pristine.replace('"chatgpt.openSidebar"', '"azrael.openSidebar"')]) {
    const { text } = injectInstructionSettings(source, "out/extension.js");
    const registration = text.match(/e\.push\(Mt\.commands\.registerCommand\("azrael\.openSettingsPanel".*?\)\)\)/)?.[0];
    assert.ok(registration);
    const calls = [], subscriptions = [];
    let handler;
    vm.runInNewContext(registration, { e: subscriptions,
      Mt: { commands: { registerCommand(command, callback) { assert.equal(command, "azrael.openSettingsPanel"); handler = callback; return "disposable"; } } },
      Pe: { async showSettings(options) { calls.push(options.section); } },
    });
    await handler();
    assert.deepEqual(calls, ["general-settings"]);
    assert.deepEqual(subscriptions, ["disposable"]);
    assert.throws(() => injectInstructionSettings(source.replace(/registerCommand\("(?:chatgpt|azrael)\.openSidebar",Ru\)/, "changed"), "out/extension.js"), /sidebar registration anchor changed/);
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
      assert(result.text.includes('assets:{16:wr,20:Er}'));
    }
    if (asset === INSTRUCTION_SETTINGS_ASSETS[1]) {
      assert(result.text.includes('.personalization.azrael-instructions.pets.'));
      assert(result.text.includes('.personalization.azrael-instructions.pets.'));
    }
  }
});

test("native mount request correlation, action payload, busy gate, delayed response and cleanup", () => {
  let effect, receiver, cleanup, timer;
  const sent = [], listeners = {};
  const shadow = { innerHTML: "", addEventListener: (kind, mn) => { listeners[kind] = mn; }, removeEventListener: kind => { delete listeners[kind]; },
    querySelector: selector => selector === "#instruction-version" ? { value: "1.2.0" } : null,
    querySelectorAll: selector => selector === "input[data-component]:checked" ? [{ dataset: { component: "agents" } }] : [] };
  class Element { closest() { return this; } }
  class HTMLElement extends Element { dataset = { action: "download", path: "AGENTS.md" }; disabled = false; }
  const component = vm.runInNewContext("(" + AzraelInstructionSettings.toString() + ")", {
    s: () => ({ locale: "en-US" }), azraelSettingsText, instructionClientTools,
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

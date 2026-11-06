"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../..");
const ts = require(require.resolve("typescript", { paths: [path.join(root, "extensions/azrael-ex")] }));
const prepared = new Map();
function compiledSource(relative) {
  return ts.transpileModule(fs.readFileSync(path.join(root, relative), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}
function compiledProviderModule(name) {
  if (prepared.has(name)) return prepared.get(name);
  const exports = {}; prepared.set(name, exports);
  vm.runInNewContext(compiledSource(`extensions/azrael-ex/src/${name}.ts`), { exports, process,
    require: key => key.startsWith("./") ? compiledProviderModule(key.slice(2)) : require(key) });
  return exports;
}

// This adapter fixture writes no files and launches no server or model request.
function fixture() {
  const calls = [], exports = {}, state = { hostId: "local", project: { id: "native-project", name: "Project" }, models: [
    { id: "native-model", displayName: "Live native", modelProvider: "openai", supportedReasoningEfforts: [{ reasoningEffort: "high", description: "High" }], defaultReasoningEffort: "high" },
    { model: "managed/source/live", modelProvider: "azrael-managed", displayName: "Live managed", supportedReasoningEfforts: [] },
  ] };
  let captured = { revision: 3, projectId: "thread-project", profile: { model: "native-model", providerAccount: { providerId: "openai", accountId: "account" } }, components: [{ id: "frozen" }] };
  const metadata = { providers: [
    { id: "scope-openai", modelProvider: "openai", selected: true, account: { providerId: "openai", accountId: "account" } },
    { id: "scope-managed", modelProvider: "azrael-managed", selected: true, account: { providerId: "source", accountId: "managed" } },
  ], models: [{ model: "stale-cache" }], cached: true };
  class Library { async workbenchMetadata() { return { root: path.join(root, "legacy-library"), connections: [] }; } }
  class Workbench {
    constructor(options) { calls.push(["construct", options]); this.projects = []; }
    setProjects(projects) { this.projects = projects; }
    async snapshot(projectId) { return { projectId, projects: this.projects }; }
    async action(action, payload) { calls.push([action, payload]); return action === "captureRequest" ? { ...captured, projectId: payload.projectId } : {}; }
    async close() {}
  }
  const source = fs.readFileSync(path.join(root, "extensions/azrael-ex/src/instructionWorkbenchService.ts"), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const vscode = { commands: { executeCommand: async command => { if (command === "azrael.workbenchContext") return state; calls.push([command]); } } };
  vm.runInNewContext(code, { exports, require: name => name === "vscode" ? vscode : name === "./instructionLibraryService" ? { InstructionLibraryService: Library } : name === "./providerAccountService" ? compiledProviderModule("providerAccountService") : require(name), URL, process });
  let accountMatches = true;
  const service = new exports.InstructionWorkbenchService({ extensionUri: { fsPath: root } }, { codexHome: path.join(root, "fixture-home"), engine: "unused" }, async () => accountMatches);
  class RoleProfileStore {
    constructor(options) { calls.push(["role-store",options]); }
    async snapshot() { return { version:1,revision:1,profiles:[],teamPresets:[],direct:{rootProfileId:"azrael-root",subagentProfileIds:[]} }; }
    async action(action,payload) { calls.push([action,payload]); return this.snapshot(); }
  }
  service.module = name => name === "instruction-workbench.cjs" ? { InstructionWorkbench: Workbench } : name === "role-profile-store.cjs" ? { RoleProfileStore } : { readProfileOptions: async () => metadata };
  return { service, state, calls, metadata, setAccount: value => { accountMatches = value; }, setCaptured: value => { captured = value; } };
}
const request = (route, body) => ({ type: "azraelWorkbenchRequest", id: "request", path: route, ...(body ? { body } : {}) });

// Keep this check: future shared-workbench routes must preserve the native model
// catalog and action authority when adding settings endpoints.
test("role-profile settings use native live models and a separate mutation allowlist", async () => {
  const f = fixture();
  const result = await f.service.request(request("/api/role-profiles"));
  assert.equal(result.models,f.state.models);
  assert.equal(result.version,1);
  assert.equal(f.calls[0][0],"role-store");
  const store = f.service.roleProfiles();
  assert.equal(store,f.service.roleProfiles());
  const options = f.calls[0][1];
  assert.equal(options.codexHome,path.join(root,"fixture-home"));
  assert.equal(await options.models(),f.state.models);
  await f.service.request(request("/api/role-profiles",{action:"saveDirect",payload:{direct:{rootProfileId:"azrael-root",subagentProfileIds:[]}}}));
  assert.equal(f.calls.at(-1)[0],"saveDirect");
  await f.service.request(request("/api/role-profiles",{action:"saveTeamProfile",payload:{teamId:"team",profile:{id:"azrael-root",allowedRoles:["root"]}}}));
  assert.equal(f.calls.at(-1)[0],"saveTeamProfile");
  assert.equal(f.calls.at(-1)[1].teamId,"team");
  await assert.rejects(f.service.request(request("/api/role-profiles",{action:"capture",payload:{}})),/Unsupported role-profile action/);
  await assert.rejects(f.service.request(request("/api/role-profiles",{action:"saveProfile",payload:[]})),/Unsupported role-profile action/);
  f.state.hostId = "remote";
  await assert.rejects(f.service.request(request("/api/role-profiles")),/Native project\/model context is unavailable/);
  f.service.dispose();
  assert.throws(() => f.service.roleProfiles(),/closed/);
});

test("native UI owns project identity while internal thread capture accepts another native project", async () => {
  const f = fixture();
  const state = await f.service.request(request("/api/state?project=forged"));
  assert.equal(state.projectId, "native-project");
  await assert.rejects(f.service.request(request("/api/action", { action: "equip", payload: { projectId: "forged", profileId: "profile" } })), /Native project changed/);
  await f.service.request(request("/api/action", { action: "equip", payload: { projectId: "native-project", profileId: "profile" } }));
  assert.equal(f.calls.at(-1)[1].projectId, "native-project");
  const captured = await f.service.capture({ hostId: "local", project: { id: "thread-project" } });
  assert.equal(captured.projectId, "thread-project");
  assert.equal(captured.profile.model, "native-model");
  const constructor = f.calls.find(call => call[0] === "construct")[1];
  assert.equal(constructor.root, path.join(root, "fixture-home/azrael/instruction-workbench"));
  assert.equal(constructor.profileRepository, f.service.roleProfiles());
  await assert.rejects(f.service.request(request("https://other.invalid/api/state")), /Invalid workbench route/);
  await assert.rejects(f.service.request(request("/api/action", { action: "publish", payload: {} })), /Unsupported workbench action/);
  await f.service.request(request("/api/action", { action: "legacyLibrary", payload: {} }));
  assert.equal(f.calls.at(-1)[0], "azrael.instructionsLegacy");
  f.service.dispose();
});

test("capture blocks when a restricted account is inactive and never switches accounts", async () => {
  const f = fixture(), input = { hostId: "local", project: { id: "thread-project" } };
  f.setAccount(false);
  await assert.rejects(f.service.capture(input), /selected account is unavailable/);
  f.setAccount(true); f.metadata.providers[0].selected = false;
  await assert.rejects(f.service.capture(input), /selected account is unavailable/);
  f.setCaptured({ revision: 4, profile: { model: "native-model" }, components: [] });
  const captured = await f.service.capture(input);
  assert.equal(captured.profile.model, "native-model");
  assert(!f.calls.some(([action]) => /switch/i.test(action)));
  f.service.dispose();
});

test("profile choices use live models with saved account scopes and never cached model rows", async () => {
  const f = fixture(), options = await f.service.profileOptions();
  assert.equal(options.cached, false);
  assert.deepEqual(Array.from(options.models, m => m.model), ["native-model", "managed/source/live"]);
  assert.deepEqual(Array.from(options.models[0].providerIds), ["scope-openai"]);
  assert.deepEqual(Array.from(options.models[1].providerIds), ["scope-managed"]);
  assert.equal(options.models[0].supportedReasoningEfforts[0].reasoningEffort, "high");
  f.state.hostId = "remote";
  await assert.rejects(f.service.profileOptions(), /Native project\/model context is unavailable/);
  f.service.dispose();
});

test("injected settings mounts the shared client in an isolated root and disposes its transport", () => {
  const { AzraelWorkbenchSettings } = require("../inject-instruction-settings.cjs");
  let effect, receive, options, disposed = 0, unsubscribed = 0, disconnected = 0, scriptsRemoved = 0;
  const sent = [], notifications = [], children = [];
  const shadow = { replaceChildren: () => { children.length = 0; }, appendChild: node => children.push(node) };
  const element = { shadowRoot: shadow, dataset: {} };
  const style = { textContent: ':root{--bg:white}html[data-theme=dark]{--bg:black}body{color:red}' };
  const document = { body: { classList: { contains: value => value === "vscode-dark" } }, documentElement: { dataset: {} }, importNode: node => ({ ...node }) };
  class DOMParser {
    parseFromString() { return { querySelectorAll: () => [{ remove: () => { scriptsRemoved++; } }], head: { querySelectorAll: () => [style] }, body: { childNodes: [{ id: "app" }] } }; }
  }
  class MutationObserver { observe() {} disconnect() { disconnected++; } }
  const component = vm.runInNewContext("(" + AzraelWorkbenchSettings.toString() + ")", {
    s: () => ({ locale: "ko" }), Q: { useRef: () => ({ current: element }), useEffect: callback => { effect = callback; } },
    $: { jsx: () => null }, crypto: { randomUUID: () => "active-client" }, document, DOMParser, MutationObserver,
    azraelSettingsText: (_locale, _en, ko) => ko,
    azraelInstructionBridge: { dispatchMessage: (type, message) => sent.push({ type, ...message }), subscribe: (_type, callback) => { receive = callback; return () => { unsubscribed++; }; } },
    azraelWorkbenchClient: (_token, _locale, input) => { options = input; input.subscribe(message => notifications.push(message)); return { dispose: () => { disposed++; } }; },
  });
  component(); const cleanup = effect();
  assert.equal(sent[0].type, "azrael-workbench"); assert.equal(sent[0].action, "mount");
  assert.equal(element.dataset.theme, "dark");
  receive({ clientId: "another-client", html: "ignored" }); assert.equal(options, undefined);
  receive({ clientId: "active-client", html: "shared page", projectId: "native-project" });
  assert.equal(scriptsRemoved, 1); assert.equal(options.root, shadow); assert.equal(options.projectId, "native-project");
  assert.match(children[0].textContent, /:host\(\[data-theme=dark\]\)/);
  assert.doesNotMatch(children[0].textContent, /:root|body\{/);
  options.postMessage({ type: "azraelWorkbenchRequest", id: "one", path: "/api/state" });
  assert.equal(sent[1].action, "request"); assert.equal(sent[1].message.id, "one");
  receive({ clientId: "active-client", message: { type: "azraelWorkbenchResponse", id: "one", ok: true } });
  assert.equal(notifications.length, 1);
  cleanup(); assert.equal(disposed, 1); assert.equal(unsubscribed, 1); assert.equal(disconnected, 1);
  assert.equal(sent.at(-1).action, "unmount"); assert.equal(children.length, 0);
  receive({ clientId: "active-client", html: "late response" }); assert.equal(children.length, 0);
});

test("packaged metadata adapter runs with compiled parser and no repository sources or TypeScript runtime", async () => {
  // Prepare the exact JS package closure in memory. The staged loader exposes
  // only these shipped modules and Node builtins; no source-tree fallback exists.
  const sources = new Map();
  for (const file of ["instruction-workbench-options.cjs", "provider-accounts-host.cjs", "platform-runtime.cjs"]) sources.set(`account-ui/${file}`, fs.readFileSync(path.join(root, "scripts", file), "utf8"));
  sources.set("account-ui/azrael-platforms.json", "module.exports=" + fs.readFileSync(path.join(root, "scripts/azrael-platforms.json"), "utf8"));
  for (const file of ["providerAccountService", "protocol", "optionalDiagnostics"]) sources.set(`account-ui/${file}.js`, compiledSource(`extensions/azrael-ex/src/${file}.ts`));
  const staged = new Map(), loaded = [], stageRoot = path.join(path.parse(root).root, "virtual-packaged-host");
  function load(file) {
    if (staged.has(file)) return staged.get(file).exports;
    assert(sources.has(file), `Unshipped package dependency: ${file}`);
    loaded.push(file);
    const module = { exports: {} }; staged.set(file, module);
    const filename = path.join(stageRoot, file);
    const localRequire = key => {
      if (key.startsWith("node:")) return require(key);
      assert(key.startsWith("."), `Unexpected package dependency: ${key}`);
      let target = path.posix.normalize(path.posix.join(path.posix.dirname(file), key));
      if (!sources.has(target)) target += ".js";
      return load(target);
    };
    vm.runInNewContext(sources.get(file), { module, exports: module.exports, require: localRequire, __filename: filename, __dirname: path.dirname(filename), process, Buffer, setTimeout, clearTimeout });
    return module.exports;
  }
  const parseProviderSnapshot = load("account-ui/providerAccountService.js").parseProviderSnapshot;
  const { readProfileOptions } = load("account-ui/instruction-workbench-options.cjs");
  const raw = { providers: [{ id: "source", label: "Source", authKind: "oauth", quotaMode: "passive", inferenceConnected: true, accounts: [
    { id: "active", label: "Active", selected: true, needsReauth: false }, { id: "retired", label: "Retired", selected: false, needsReauth: true },
  ] }], availableProviders: [] };
  const options = { codexHome: root, env: {}, metadataOnly: true, parseProviderSnapshot, openaiAccounts: async () => [], providerAccounts: async () => raw,
    get nativeModelsPath() { throw Error("Native cache must not be read"); }, get managedModelsPath() { throw Error("Managed cache must not be read"); } };
  const result = await readProfileOptions(options);
  assert.equal(result.cached, false); assert.equal(result.models.length, 0); assert.equal(result.providers.length, 1);
  assert.equal(result.providers[0].account.accountId, "active"); assert.equal(result.providers[0].selected, true);
  assert(!loaded.some(file => file.endsWith(".ts") || file.includes("typescript")));
  raw.providers[0].accounts[0].selected = "malformed";
  const rejected = await readProfileOptions(options);
  assert.equal(rejected.providers.length, 0);
  raw.providers[0].accounts[0].selected = true;
  const development = await require("../instruction-workbench-options.cjs").readProfileOptions({ codexHome: root, env: {}, metadataOnly: true, openaiAccounts: options.openaiAccounts, providerAccounts: options.providerAccounts });
  assert.equal(development.providers.length, 1);
});

test("native project change command broadcasts current host context and is disposed with the view", async () => {
  const commands = new Map(), received = [];
  let project = "first", disposed = false;
  const exports = {}, vscode = { commands: { registerCommand: (name, callback) => { commands.set(name, callback); return { dispose: () => { disposed = true; commands.delete(name); } }; } }, env: { language: "en" } };
  vm.runInNewContext(compiledSource("extensions/azrael-ex/src/instructionWorkbenchView.ts"), { exports, require: key => key === "vscode" ? vscode : require(key) });
  const service = { liveContext: async () => ({ project: project ? { id: project } : null, hostId: "local", models: [] }), module: () => ({ renderWorkbenchPage: () => "<body></body>" }) };
  const view = new exports.InstructionWorkbenchView(service), webview = { postMessage: async message => { received.push(message); } };
  await view.handleEmbedded(webview, { type: "azrael-workbench", clientId: "mount", requestId: "1", action: "mount" });
  project = "second";
  await commands.get("azrael.workbenchContextChanged")({ projectId: "forged" });
  assert.equal(received.at(-1).clientId, "mount");
  assert.equal(received.at(-1).message.type, "azraelWorkbenchContextChanged");
  assert.equal(received.at(-1).message.projectId, "second");
  project = ""; await commands.get("azrael.workbenchContextChanged")();
  assert.equal(received.at(-1).message.projectId, "");
  view.dispose(); assert.equal(disposed, true); assert.equal(commands.size, 0);
});

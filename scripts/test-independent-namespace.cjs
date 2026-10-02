"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const [originalArgument, hostArgument, typescriptArgument] = process.argv.slice(2);
if (!originalArgument || !hostArgument || !typescriptArgument) {
  throw new Error("Usage: test-independent-namespace.cjs <original-extension> <azrael-host> <typescript-module>");
}

const originalRoot = fs.realpathSync(originalArgument);
const hostRoot = fs.realpathSync(hostArgument);
const ts = require(path.resolve(typescriptArgument));
const transformer = require("./namespace-azrael-host.cjs");

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
}

function strings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => strings(item, output));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      output.push(key);
      strings(item, output);
    }
  }
  return output;
}

function count(text, token) {
  return text.split(token).length - 1;
}

function inspectStringLiterals(text, filename) {
  const sourceFile = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(sourceFile.parseDiagnostics.length, 0, `${filename} has TypeScript parse diagnostics`);
  const result = { configChatgpt: 0, configAzrael: 0, nativeChatgpt: 0 };
  const visit = (node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === "chatgpt") {
      const parent = node.parent;
      const isConfiguration = ts.isCallExpression(parent) &&
        ts.isPropertyAccessExpression(parent.expression) && parent.expression.name.text === "getConfiguration";
      if (isConfiguration) result.configChatgpt += 1;
      else result.nativeChatgpt += 1;
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === "azrael") {
      const parent = node.parent;
      if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression) &&
          parent.expression.name.text === "getConfiguration") result.configAzrael += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function commandIds(manifest) {
  return (manifest.contributes?.commands ?? []).map((entry) => entry.command);
}

function configurationIds(manifest) {
  return Object.keys(manifest.contributes?.configuration?.properties ?? {});
}

function viewIds(manifest) {
  const containers = manifest.contributes?.viewsContainers ?? {};
  const views = manifest.contributes?.views ?? {};
  return [
    ...Object.values(containers).flat().map((entry) => entry.id),
    ...Object.keys(views),
    ...Object.values(views).flat().map((entry) => entry.id),
  ];
}

const originalManifestText = fs.readFileSync(path.join(originalRoot, "package.json"), "utf8");
const originalManifest = JSON.parse(originalManifestText);
const hostManifest = readJson(hostRoot, "package.json");
const payloadManifest = readJson(hostRoot, "account-ui/package.json");
const originalBundle = fs.readFileSync(path.join(originalRoot, "out", "extension.js"), "utf8");
const hostBundle = fs.readFileSync(path.join(hostRoot, "out", "extension.js"), "utf8");
assert.equal(count(originalBundle, require("./inject-image-file-open.cjs").MARKER), 0,
  "original Codex host unexpectedly contains the Azrael image link patch");
assert.equal(count(hostBundle, require("./inject-image-file-open.cjs").MARKER), 1,
  "packaged Azrael host must contain exactly one image link patch");
const recentThreadAsset = "webview/assets/app-initial-9f7d97690e9b.js";
const originalRecentThreadBundle = fs.readFileSync(path.join(originalRoot, recentThreadAsset), "utf8");
const hostRecentThreadBundle = fs.readFileSync(path.join(hostRoot, recentThreadAsset), "utf8");
const wrapperPath = path.join(hostRoot, hostManifest.main.replace(/^\.\//, ""));
const wrapper = fs.readFileSync(wrapperPath, "utf8");
const accountBundle = ["extension.js", "accountView.js", "usageView.js", "rootResumeProtocol.js", "rootResumeView.js"]
  .map((filename) => fs.readFileSync(path.join(hostRoot, "account-ui", "dist", "src", filename), "utf8"))
  .join("\n");

assert.equal(`${originalManifest.publisher}.${originalManifest.name}`, "openai.chatgpt");
assert.equal(originalManifest.version, "26.928.31416");
assert.equal(`${hostManifest.publisher}.${hostManifest.name}`, "azrael-ex-local.azrael");
assert.match(hostManifest.version, /^0\.5\.\d+$/, "host package version is not independently updateable");
assert.equal(hostManifest.azraelIntegratedAccounts, true, "host did not declare its integrated account UI");
assert.equal(hostManifest.main, "./integrated-azrael-entry.cjs", "host main bypassed the integration wrapper");
assert.match(payloadManifest.version, /^0\.4\.\d+$/, "embedded account payload version differed");
assert.equal(hostManifest.azraelAccountPayloadVersion, payloadManifest.version,
  "host account payload marker differed from the embedded payload");
assert.equal(payloadManifest.main, "./dist/src/extension.js");
for (const [label, manifest] of [["host", hostManifest], ["payload", payloadManifest]]) {
  assert.equal(manifest.extensionDependencies, undefined, `${label} declared an extension dependency`);
  assert.equal(manifest.extensionPack, undefined, `${label} declared an extension pack`);
}
assert(wrapper.includes('require("./out/extension.js")') || wrapper.includes("require('./out/extension.js')"),
  "integration wrapper did not load the native extension bundle");
assert(wrapper.includes("account-ui/dist/src/extension.js"), "integration wrapper did not load the embedded account UI");
assert(wrapper.indexOf("extension.js") < wrapper.indexOf("account-ui/dist/src/extension.js"),
  "integration wrapper did not activate the native extension before the account UI");
assert(wrapper.includes("azrael-runtime.cjs"), "integration wrapper did not load the host runtime");
assert(wrapper.includes("azrael-recovery.cjs"), "integration wrapper did not initialize recovery");
for (const moduleName of ["azrael-recovery.cjs", "recovery-state.cjs", "url-safety-transport.cjs"]) {
  assert.equal(fs.readFileSync(path.join(hostRoot, "out", moduleName), "utf8"),
    fs.readFileSync(path.join(__dirname, moduleName), "utf8"), `packaged ${moduleName} differs from the validated source`);
}
assert.equal(count(hostBundle, require("./inject-url-safety-transport.cjs").MARKER), 1,
  "packaged host must contain exactly one URL safety transport injection");
assert.equal(count(hostBundle, 'require("./url-safety-transport.cjs").fetchUrlSafety('), 1,
  "packaged host omitted or duplicated the URL safety transport call");
for (const hook of ["dispatch", "observe", "disconnect"]) {
  assert(hostBundle.includes(`require("./azrael-recovery.cjs").${hook}(this`), `packaged host omitted recovery ${hook}`);
}
assert(/AZRAEL_EX_ACCOUNT_STATE_FILE[\s\S]*AZRAEL_EX_ACCOUNT_DEFAULT_FILE[\s\S]*nativeExtension\.activate\(context\)[\s\S]*accountUi\.activate\(context, runtime\)/.test(wrapper),
  "integration wrapper did not scope session and default account state before activating native then account UI");

const wrapperTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-wrapper-test-"));
let wrapperFixtureIndex = 0;

function wrapperFixture({ accountActivationError, sessionId = "11111111-1111-4111-8111-111111111111",
  fallbackUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } = {}) {
  const fixtureRoot = path.join(wrapperTestRoot, `fixture-${++wrapperFixtureIndex}`);
  const events = [];
  const context = {
    marker: "shared-context",
    storageUri: { scheme: "file", fsPath: path.join(fixtureRoot, "workspace-storage") },
    globalStorageUri: { scheme: "file", fsPath: path.join(fixtureRoot, "global-storage") },
  };
  const runtimeEnvironment = { EXISTING_VALUE: "preserved" };
  const runtime = Object.freeze({ marker: "shared-runtime", env: runtimeEnvironment });
  const nativeApi = { marker: "native-api" };
  const nativeExtension = {
    async activate(value) {
      events.push(["native.activate", value, runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE,
        runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE,
        fs.existsSync(runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE)
          ? fs.readFileSync(runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE, "utf8") : undefined]);
      return nativeApi;
    },
    async deactivate() { events.push(["native.deactivate"]); },
  };
  const accountUi = {
    async activate(receivedContext, receivedRuntime) {
      events.push(["account.activate", receivedContext, receivedRuntime]);
      if (accountActivationError) throw accountActivationError;
    },
    async deactivate() { events.push(["account.deactivate"]); },
  };
  const module = { exports: {} };
  vm.runInNewContext(wrapper, {
    module,
    exports: module.exports,
    AggregateError,
    Promise,
    require(request) {
      if (request === "node:path") return path;
      if (request === "node:crypto") return { createHash: crypto.createHash, randomUUID: () => fallbackUuid };
      if (request === "node:fs/promises") return fs.promises;
      if (request === "vscode") return { env: { sessionId } };
      if (request === "./out/extension.js") return nativeExtension;
      if (request === "./account-ui/dist/src/extension.js") return accountUi;
      if (request === "./out/azrael-runtime.cjs") return { runtime };
      if (request === "./out/azrael-recovery.cjs") return { initialize: () => ({ dispose() {} }) };
      throw new Error(`wrapper required unexpected module ${request}`);
    },
  }, { filename: wrapperPath });
  return { api: module.exports, events, context, runtime, nativeApi };
}

function writeOldAccountState(root, scope, contents, modified) {
  const filename = path.join(root, scope, "azrael-account-state.json");
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, contents, "utf8");
  fs.utimesSync(filename, modified, modified);
  return filename;
}

async function testWrapperLifecycle() {
  const originalProcessEnvironment = process.env.AZRAEL_EX_ACCOUNT_STATE_FILE;
  const originalDefaultEnvironment = process.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE;
  const success = wrapperFixture();
  assert.equal(await success.api.activate(success.context), success.nativeApi,
    "integration wrapper did not preserve the native activation API");
  const successSessionScope = crypto.createHash("sha256")
    .update("11111111-1111-4111-8111-111111111111", "utf8").digest("hex");
  const workspaceStateFile = path.join(success.context.storageUri.fsPath, "window",
    successSessionScope, "azrael-account-state.json");
  const workspaceDefaultFile = path.join(success.context.storageUri.fsPath, "default",
    "azrael-account-state.json");
  assert.deepEqual(success.events.slice(0, 2), [
    ["native.activate", success.context, workspaceStateFile, workspaceDefaultFile, undefined],
    ["account.activate", success.context, success.runtime],
  ], "integration wrapper activation order or injected instances differed");
  assert.equal(success.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE, workspaceStateFile,
    "workspace account selection did not use extension workspace storage");
  assert.equal(success.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE, workspaceDefaultFile,
    "workspace account default did not use stable extension workspace storage");
  assert.equal(success.runtime.env.EXISTING_VALUE, "preserved", "wrapper replaced the host runtime environment");
  assert.equal(process.env.AZRAEL_EX_ACCOUNT_STATE_FILE, originalProcessEnvironment,
    "wrapper changed the ordinary process environment");
  assert.equal(process.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE, originalDefaultEnvironment,
    "wrapper changed the ordinary process default environment");

  const otherWorkspace = wrapperFixture();
  otherWorkspace.context.storageUri = { scheme: "file", fsPath: path.resolve("other-workspace-storage") };
  await otherWorkspace.api.activate(otherWorkspace.context);
  assert.notEqual(otherWorkspace.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE,
    success.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE, "different workspaces shared account selection state");
  assert.notEqual(otherWorkspace.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE,
    success.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE, "different workspaces shared the durable account default");

  const duplicateWorkspace = wrapperFixture({ sessionId: "22222222-2222-4222-8222-222222222222" });
  duplicateWorkspace.context.storageUri = success.context.storageUri;
  await duplicateWorkspace.api.activate(duplicateWorkspace.context);
  assert.notEqual(duplicateWorkspace.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE,
    success.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE, "duplicate workspace windows shared account selection state");
  assert.equal(duplicateWorkspace.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE,
    success.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE,
    "different sessions for one workspace did not share the durable account default");
  const reloadedWorkspace = wrapperFixture();
  reloadedWorkspace.context.storageUri = success.context.storageUri;
  await reloadedWorkspace.api.activate(reloadedWorkspace.context);
  assert.equal(reloadedWorkspace.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE,
    success.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE, "stable VS Code session ID changed account selection scope");
  assert.equal(reloadedWorkspace.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE, workspaceDefaultFile,
    "reloaded workspace did not retain its durable account default path");

  const emptyWindow = wrapperFixture({ sessionId: "33333333-3333-4333-8333-333333333333" });
  emptyWindow.context.storageUri = undefined;
  await emptyWindow.api.activate(emptyWindow.context);
  const emptyWindowSessionScope = crypto.createHash("sha256")
    .update("33333333-3333-4333-8333-333333333333", "utf8").digest("hex");
  const emptyWindowStateFile = path.join(emptyWindow.context.globalStorageUri.fsPath, "empty-window",
    emptyWindowSessionScope, "azrael-account-state.json");
  assert.equal(emptyWindow.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE, emptyWindowStateFile,
    "empty window account selection did not use its session-specific global-storage scope");
  const emptyWindowDefaultFile = path.join(emptyWindow.context.globalStorageUri.fsPath,
    "empty-window-default", "azrael-account-state.json");
  assert.equal(emptyWindow.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE, emptyWindowDefaultFile,
    "empty window account default did not use stable global storage");
  assert.notEqual(emptyWindow.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE,
    success.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE, "empty window shared workspace account selection state");
  const otherEmptyWindow = wrapperFixture({ sessionId: "44444444-4444-4444-8444-444444444444" });
  otherEmptyWindow.context.storageUri = undefined;
  await otherEmptyWindow.api.activate(otherEmptyWindow.context);
  assert.notEqual(otherEmptyWindow.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE,
    emptyWindow.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE, "different empty windows shared account selection state");
  const sharedEmptyWindow = wrapperFixture({ sessionId: "66666666-6666-4666-8666-666666666666" });
  sharedEmptyWindow.context.storageUri = undefined;
  sharedEmptyWindow.context.globalStorageUri = emptyWindow.context.globalStorageUri;
  await sharedEmptyWindow.api.activate(sharedEmptyWindow.context);
  assert.equal(sharedEmptyWindow.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE,
    emptyWindow.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE,
    "empty-window sessions using one global storage did not share the durable account default");

  const unavailableSession = wrapperFixture({ sessionId: null,
    fallbackUuid: "55555555-5555-4555-8555-555555555555" });
  unavailableSession.context.storageUri = undefined;
  await unavailableSession.api.activate(unavailableSession.context);
  assert.equal(unavailableSession.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE,
    path.join(unavailableSession.context.globalStorageUri.fsPath, "empty-window",
      "55555555-5555-4555-8555-555555555555", "azrael-account-state.json"),
  "unavailable VS Code session ID did not use the per-window fallback UUID");

  for (const [label, invalidContext] of [
    ["non-file workspace storage", { ...success.context, storageUri: { scheme: "untitled", fsPath: "ignored" } }],
    ["relative workspace storage", { ...success.context, storageUri: { scheme: "file", fsPath: "relative" } }],
    ["non-file global storage", { ...success.context, storageUri: undefined,
      globalStorageUri: { scheme: "vscode-userdata", fsPath: "ignored" } }],
  ]) {
    const invalid = wrapperFixture();
    await assert.rejects(invalid.api.activate(invalidContext), /absolute file|absolute file-system/,
      `${label} was accepted for account selection state`);
    assert.equal(invalid.events.length, 0, `${label} reached native activation`);
  }
  const opaqueSessionId = "window/../opaque:session?with=path\\characters";
  const opaqueSession = wrapperFixture({ sessionId: opaqueSessionId });
  opaqueSession.context.storageUri = success.context.storageUri;
  await opaqueSession.api.activate(opaqueSession.context);
  const opaqueScope = crypto.createHash("sha256").update(opaqueSessionId, "utf8").digest("hex");
  assert.equal(opaqueSession.runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE,
    path.join(opaqueSession.context.storageUri.fsPath, "window", opaqueScope, "azrael-account-state.json"),
    "opaque VS Code session ID was not safely hashed into the account selection scope");

  const newestMigration = wrapperFixture();
  const migrationRoot = newestMigration.context.storageUri.fsPath;
  writeOldAccountState(path.join(migrationRoot, "window"), "older",
    JSON.stringify({ selectedProfileId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }), new Date("2026-01-01T00:00:00Z"));
  writeOldAccountState(path.join(migrationRoot, "window"), "newer",
    JSON.stringify({ selectedProfileId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", ignored: "remove-me" }),
    new Date("2026-01-02T00:00:00Z"));
  await newestMigration.api.activate(newestMigration.context);
  const migratedDefaultFile = path.join(migrationRoot, "default", "azrael-account-state.json");
  assert.deepEqual(JSON.parse(fs.readFileSync(migratedDefaultFile, "utf8")),
    { selectedProfileId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    "newest valid old workspace session was not sanitized into the durable default");
  assert.equal(newestMigration.events[0][4],
    '{"selectedProfileId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}\n',
    "workspace default migration did not finish before native activation");

  const invalidSkip = wrapperFixture();
  const invalidSkipRoot = invalidSkip.context.storageUri.fsPath;
  writeOldAccountState(path.join(invalidSkipRoot, "window"), "valid",
    JSON.stringify({ selectedProfileId: "cccccccccccccccccccccccccccccccc" }),
    new Date("2026-01-01T00:00:00Z"));
  writeOldAccountState(path.join(invalidSkipRoot, "window"), "invalid-shape",
    JSON.stringify({ selectedProfileId: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC" }),
    new Date("2026-01-03T00:00:00Z"));
  writeOldAccountState(path.join(invalidSkipRoot, "window"), "unreadable-json", "{not-json",
    new Date("2026-01-02T00:00:00Z"));
  await invalidSkip.api.activate(invalidSkip.context);
  assert.deepEqual(JSON.parse(fs.readFileSync(invalidSkip.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE, "utf8")),
    { selectedProfileId: "cccccccccccccccccccccccccccccccc" },
    "invalid newer old sessions were not skipped during default migration");

  const existingDefault = wrapperFixture();
  const preservedText = '{"selectedProfileId":null,"existing":"preserve exactly"}\n';
  const existingDefaultFile = path.join(existingDefault.context.storageUri.fsPath, "default",
    "azrael-account-state.json");
  fs.mkdirSync(path.dirname(existingDefaultFile), { recursive: true });
  fs.writeFileSync(existingDefaultFile, preservedText, "utf8");
  writeOldAccountState(path.join(existingDefault.context.storageUri.fsPath, "window"), "newest",
    JSON.stringify({ selectedProfileId: "dddddddddddddddddddddddddddddddd" }),
    new Date("2026-01-04T00:00:00Z"));
  await existingDefault.api.activate(existingDefault.context);
  assert.equal(fs.readFileSync(existingDefaultFile, "utf8"), preservedText,
    "existing durable default with explicit null was overwritten");

  const emptyMigration = wrapperFixture();
  emptyMigration.context.storageUri = undefined;
  writeOldAccountState(path.join(emptyMigration.context.globalStorageUri.fsPath, "empty-window"), "old-empty",
    JSON.stringify({ selectedProfileId: null, ignored: true }), new Date("2026-01-05T00:00:00Z"));
  await emptyMigration.api.activate(emptyMigration.context);
  assert.deepEqual(JSON.parse(fs.readFileSync(emptyMigration.runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE, "utf8")),
    { selectedProfileId: null }, "empty-window old session did not migrate to its durable default");

  await success.api.deactivate();
  assert(success.events.some(([event]) => event === "account.deactivate"), "wrapper did not dispose account UI");
  assert(success.events.some(([event]) => event === "native.deactivate"), "wrapper did not dispose native extension");

  const activationError = new Error("account activation failed");
  const failure = wrapperFixture({ accountActivationError: activationError });
  await assert.rejects(failure.api.activate(failure.context), (error) => error === activationError);
  assert(failure.events.some(([event]) => event === "account.deactivate"),
    "wrapper did not clean up account UI after account activation failure");
  assert(failure.events.some(([event]) => event === "native.deactivate"),
    "wrapper did not clean up native extension after account activation failure");
  assert.equal(process.env.AZRAEL_EX_ACCOUNT_STATE_FILE, originalProcessEnvironment,
    "wrapper changed the ordinary process environment during lifecycle checks");
  assert.equal(process.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE, originalDefaultEnvironment,
    "wrapper changed the ordinary process default environment during lifecycle checks");
}
const provenance = readJson(hostRoot, ".azrael-independent-host.json");
assert.equal(provenance.hostId, "azrael-ex-local.azrael");
assert.equal(provenance.hostVersion, hostManifest.version);
assert.equal(provenance.sourceVersion, originalManifest.version);
assert.equal(provenance.assets.find(asset => asset.path === "out/extension.js").recoveryEdits, 3);
assert(commandIds(hostManifest).includes("azrael.recoveryStatus"));
assert.equal(hostManifest.enabledApiProposals, undefined, "local host opted into proposed APIs");
assert.equal(hostManifest.contributes?.chatSessions, undefined, "local host contributed proposed chat sessions");
assert.equal(hostManifest.contributes?.configuration?.properties?.["azrael.commentCodeLensEnabled"]?.default, false,
  "local host enabled a duplicate TODO CodeLens by default");

const originalCommands = commandIds(originalManifest);
const hostCommands = commandIds(hostManifest);
assert(originalCommands.includes("chatgpt.openSidebar"));
assert(hostCommands.includes("azrael.openSidebar"));
for (const command of [
  "azrael.manageAccounts", "azrael.usage", "azrael.rootResume", "azrael.accountQuickPick", "azrael.refreshAccounts",
  "azrael.openCodex", "azrael.openCodexSettings", "azrael.devinAccount",
]) assert(hostCommands.includes(command), `host manifest omitted integrated command ${command}`);
assert(hostCommands.every((id) => id.startsWith("azrael.")), "host command namespace is not independent");
assert(hostCommands.every((id) => !originalCommands.includes(id)), "host and original share a command ID");
assert(!hostCommands.some((id) => id.startsWith("azrael-ex.")), "host retained a companion command namespace");

const originalConfiguration = configurationIds(originalManifest);
const hostConfiguration = configurationIds(hostManifest);
assert(originalConfiguration.length > 0 && originalConfiguration.every((id) => id.startsWith("chatgpt.")));
assert.deepEqual(hostConfiguration.slice().sort(), [
  ...originalConfiguration.map((id) => id.replace(/^chatgpt\./, "azrael.")),
  "azrael.sharedEnvironment.repository", "azrael.sharedEnvironment.ref",
].sort(), "host settings must contain the renamed upstream settings and integrated shared-environment settings only");
for (const [id, defaultValue] of [["azrael.sharedEnvironment.repository", ""], ["azrael.sharedEnvironment.ref", "main"]]) {
  const setting = hostManifest.contributes.configuration.properties[id];
  assert.equal(setting.type, "string");
  assert.equal(setting.default, defaultValue);
}
assert(hostConfiguration.every((id) => id.startsWith("azrael.")), "host configuration namespace is not independent");

const originalViews = viewIds(originalManifest);
const hostViews = viewIds(hostManifest);
assert(hostViews.length > 0 && hostViews.every((id) => id.startsWith("azrael")), "host view namespace is not independent");
assert(hostViews.every((id) => !originalViews.includes(id)), "host and original share a view ID");

const originalEditors = (originalManifest.contributes?.customEditors ?? []).map((entry) => entry.viewType);
const hostEditors = hostManifest.contributes?.customEditors ?? [];
assert(hostEditors.some((entry) => entry.viewType === "azrael.conversationEditor"));
assert(hostEditors.every((entry) => !originalEditors.includes(entry.viewType)), "host and original share a custom editor ID");
assert(hostEditors.flatMap((entry) => entry.selector ?? []).some((entry) => entry.filenamePattern?.startsWith("azrael-session:")));

const manifestStrings = strings(hostManifest);
for (const forbidden of ["openai.chatgpt", "codexViewContainer", "codexSecondaryViewContainer", "openai-codex", "codex-rules", "codex-ipc"]) {
  assert(!manifestStrings.some((value) => value.includes(forbidden)), `host manifest retained ${forbidden}`);
}
for (const required of ["azraelViewContainer", "azraelSecondaryViewContainer", "azrael-session", "azrael-rules"]) {
  assert(manifestStrings.some((value) => value.includes(required)), `host manifest omitted ${required}`);
}

for (const preserved of ["chatgpt.com", "CODEX_HOME", "codex.chatSessionProvider", "codex.chatSessionObserver", "Codex chat session item provider not registered"]) {
  assert(count(originalBundle, preserved) > 0, `original bundle omitted expected marker ${preserved}`);
  assert.equal(count(hostBundle, preserved), count(originalBundle, preserved), `host changed preserved marker ${preserved}`);
}
assert(count(originalBundle, "codex-ipc") > 0, "original bundle omitted the Windows IPC prefix");
assert.equal(count(hostBundle, "codex-ipc"), 0, "host retained the original IPC namespace");
assert.equal(count(hostBundle, "azrael-ipc"), count(originalBundle, "codex-ipc"), "host IPC replacement count differs");
assert.equal(count(hostBundle, "openai.chatgpt"), 0, "host retained the original extension ID");
assert.equal((hostBundle.match(/chatgpt\.(?!com\b)/g) ?? []).length, 0, "host retained an extension-owned chatgpt namespace");
assert(accountBundle.includes("계정 및 사용량"), "embedded account panel title was not integrated");
assert(accountBundle.includes("azrael.manageAccounts") && accountBundle.includes("azrael.usage") && accountBundle.includes("azrael.rootResume"),
  "embedded account bundle did not use integrated commands");

const webviewAssets = [];
for (const entry of fs.readdirSync(path.join(hostRoot, "webview", "assets"))) {
  if (entry.endsWith(".js")) webviewAssets.push(fs.readFileSync(path.join(hostRoot, "webview", "assets", entry), "utf8"));
}
const menuAsset = webviewAssets.find((text) => text.includes("계정 및 사용량") && text.includes("루트 재개 예약"));
assert(menuAsset, "host webview omitted the integrated profile menu entries");
function evaluateMenuClick(label, expectedCommand) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = 'onClick:\\(\\)=>\\{([A-Za-z_$][\\w$]*)\\(\\),([A-Za-z_$][\\w$]*)\\.dispatchMessage\\(`open-vscode-command`,\\{command:`([^`]+)`\\}\\)\\},children:`' + escapedLabel + '`';
  const match = menuAsset.match(new RegExp(pattern));
  assert(match, `could not extract the packaged ${label} profile-menu click handler`);
  const messages = [];
  let menuClosed = 0;
  Function(match[1], match[2], `"use strict";return(${match[0].slice("onClick:".length).split(",children:")[0]})();`)(
    () => { menuClosed += 1; },
    { dispatchMessage: (type, payload) => messages.push({ type, payload }) },
  );
  assert.equal(menuClosed, 1, `${label} click did not close the profile menu`);
  assert.equal(match[3], expectedCommand, `${label} click named the wrong VS Code command`);
  assert.deepEqual(messages, [{ type: "open-vscode-command", payload: { command: expectedCommand } }],
    `${label} click dispatched the wrong VS Code command message`);
}
assert.equal(count(menuAsset, 'children:`계정 및 사용량`'), 1);
assert(!menuAsset.includes('children:`계정 추가·전환`'));
assert(!menuAsset.includes('children:`사용량`'));
for (const command of ["azrael.manageAccounts", "azrael.devinAccount"]) {
  assert(hostManifest.contributes.menus.commandPalette.some(item => item.command === command && item.when === "false"),
    `host command palette exposed duplicate page command ${command}`);
}
evaluateMenuClick("계정 및 사용량", "azrael.usage");
evaluateMenuClick("루트 재개 예약", "azrael.rootResume");

const originalLiterals = inspectStringLiterals(originalBundle, "original-extension.js");
const hostLiterals = inspectStringLiterals(hostBundle, "azrael-extension.js");
assert(originalLiterals.configChatgpt > 0, "original bundle had no standalone chatgpt configuration lookup");
assert.equal(hostLiterals.configChatgpt, 0, "host retained a standalone chatgpt configuration lookup");
assert(hostLiterals.configAzrael >= originalLiterals.configChatgpt, "host omitted transformed azrael configuration lookups");
assert.equal(hostLiterals.nativeChatgpt, originalLiterals.nativeChatgpt, "host changed native chatgpt authentication identifiers");

const externalUrls = [
  "https://example.test/openai.chatgpt/openai-codex/chatgpt.route",
  "http://example.test/openai.chatgpt",
  "wss://example.test/openai-codex",
  "ws://example.test/chatgpt.route",
];
for (const url of externalUrls) assert.equal(transformer.rewriteValue(url), url, `external URL changed: ${url}`);
const synthetic = 'const a=vscode.workspace.getConfiguration("chatgpt");const auth="chatgpt";const url="https://chatgpt.com/auth";const external="https://example.test/openai.chatgpt/openai-codex/chatgpt.route";const provider="codex.chatSessionProvider";const home="CODEX_HOME";const pipe=`\\\\.\\pipe\\codex-ipc-${id}`;const httpsTemplate=`https://example.test/openai.chatgpt/${id}/openai-codex`;const wsTemplate=`wss://example.test/chatgpt.route/${id}`;';
const rewritten = transformer.rewriteJavaScript(synthetic, "namespace-fixture.js", ts).text;
assert(rewritten.includes('getConfiguration("azrael")'));
assert(rewritten.includes('auth="chatgpt"'));
assert(rewritten.includes("https://chatgpt.com/auth"));
assert(rewritten.includes("https://example.test/openai.chatgpt/openai-codex/chatgpt.route"));
assert(rewritten.includes("https://example.test/openai.chatgpt/${id}/openai-codex"));
assert(rewritten.includes("wss://example.test/chatgpt.route/${id}"));
assert(rewritten.includes("codex.chatSessionProvider"));
assert(rewritten.includes('home="CODEX_HOME"'));
assert(rewritten.includes("azrael-ipc-${id}"), "template IPC prefix was not rewritten");

const recentThreadListFixture = [
  'function listRecent(client,params,background){return client.sendRequest(`thread/list`,params,',
  'background?{priority:`background`,source:`recent_threads`}:{source:`recent_threads`});}',
  'function listCollab(client,params){return client.sendRequest(`thread/list`,params,',
  '{priority:`background`,source:`collab_hydration`});}',
].join("");
const markedRecentThreadListFixture = transformer.markRecentThreadListRequest(
  recentThreadListFixture, "recent-thread-list-fixture.js", ts,
);
assert.equal(markedRecentThreadListFixture.count, 1,
  "synthetic recent thread/list request count differed");

const bridgeFixture = [
  'class Bridge{sendProviderRequest(provider,id,method,params,prewarm,delivery){',
  'let request={id:id,method:method,params:params};return request;}}',
].join("");
const filteredBridgeFixture = transformer.injectWorkspaceThreadListBridgeFilter(
  bridgeFixture, "thread-list-bridge-fixture.js", ts,
);
assert.equal(filteredBridgeFixture.count, 1, "synthetic app-server bridge count differed");

function runThreadListFixture(workspaceFolders, expression, params, background = false) {
  let vscodeRequireCount = 0;
  const client = { sendRequest: (...args) => args[1] };
  const context = {
    client,
    params,
    background,
    require(request) {
      assert.equal(request, "vscode", "workspace filter required an unexpected module");
      vscodeRequireCount += 1;
      return { workspace: { workspaceFolders } };
    },
  };
  const source = `${markedRecentThreadListFixture.text};${filteredBridgeFixture.text};${expression}`;
  const result = vm.runInNewContext(source, context, { filename: "thread-list-fixture.js" });
  return { result, vscodeRequireCount };
}

const recentListExpression = 'new Bridge().sendProviderRequest("provider","request-id","thread/list",' +
  'listRecent(client,params,background),false,false).params';
const oneRoot = runThreadListFixture(
  [{ uri: { scheme: "file", fsPath: "C:\\work\\one" } }],
  recentListExpression,
  { limit: 50 },
);
assert.deepEqual(JSON.parse(JSON.stringify(oneRoot.result.cwd)), ["C:\\work\\one"],
  "single-root workspace was not added to thread/list");
assert.equal(oneRoot.vscodeRequireCount, 1);
assert.equal(oneRoot.result.__azraelWorkspaceThreadList, undefined,
  "internal workspace marker escaped the app-server bridge");

// null/omitted selects the server's default provider; [] includes Devin too.
for (const providerParams of [{}, { modelProviders: null }, { modelProviders: ["openai"] }]) {
  for (const background of [false, true]) {
    const params = { limit: 25, cursor: "next-page", archived: false, ...providerParams };
    const snapshot = JSON.stringify(params);
    const allProviders = runThreadListFixture(
      [{ uri: { scheme: "file", fsPath: "C:\\work\\one" } }],
      recentListExpression, params, background,
    );
    assert.deepEqual(JSON.parse(JSON.stringify(allProviders.result)), {
      ...params, modelProviders: [], cwd: ["C:\\work\\one"],
    }, "recent chats must include every provider while preserving pagination and archive filters");
    assert.equal(JSON.stringify(params), snapshot, "recent-list input parameters were mutated");
  }
}

const multiRoot = runThreadListFixture([
  { uri: { scheme: "file", fsPath: "C:\\work\\one" } },
  { uri: { scheme: "untitled", fsPath: "ignored" } },
  { uri: { scheme: "file", fsPath: "D:\\work\\two" } },
], recentListExpression, { limit: 25, cwd: ["stale"] }, true);
assert.deepEqual(JSON.parse(JSON.stringify(multiRoot.result)), {
  limit: 25,
  modelProviders: [],
  cwd: ["C:\\work\\one", "D:\\work\\two"],
}, "multi-root file workspaces did not replace thread/list cwd");

const emptyRoots = runThreadListFixture(undefined, recentListExpression, { limit: 10 });
assert.deepEqual(JSON.parse(JSON.stringify(emptyRoots.result.cwd)), [],
  "empty workspace did not fail closed with an empty cwd list");

const unmarkedParams = { limit: 10, modelProviders: ["openai"] };
const unmarked = runThreadListFixture(
  [{ uri: { scheme: "file", fsPath: "C:\\work\\one" } }],
  'new Bridge().sendProviderRequest("provider","request-id","thread/list",' +
    'listCollab(client,params),false,false).params',
  unmarkedParams,
);
assert.equal(unmarked.result, unmarkedParams, "unmarked thread/list parameters were changed");
assert.equal(unmarked.vscodeRequireCount, 0,
  "unmarked thread/list evaluated workspace filtering");

assert.throws(
  () => transformer.markRecentThreadListRequest(
    'client.sendRequest(`thread/list`,params,{source:`recent_threads`});',
    "recent-thread-list-guard-mismatch.js", ts,
  ),
  /expected 1 conditional recent_threads request.*unsupported/,
  "changed recent thread/list option shape did not fail transformation",
);
assert.throws(
  () => transformer.injectWorkspaceThreadListBridgeFilter(
    'class Bridge{sendProviderRequest(provider,id,method,params){return {id,method,params};}}',
    "thread-list-bridge-guard-mismatch.js", ts,
  ),
  /expected 1 request params boundary, found 0/,
  "changed app-server bridge shape did not fail transformation",
);
const pinnedBridgeTransform = transformer.injectWorkspaceThreadListBridgeFilter(
  originalBundle, "pinned-original-extension.js", ts,
);
assert.equal(pinnedBridgeTransform.count, 1,
  "pinned official host bridge did not match the guarded transformation");
const pinnedRecentThreadTransform = transformer.markRecentThreadListRequest(
  originalRecentThreadBundle, "pinned-original-recent-thread-list.js", ts,
);
assert.equal(pinnedRecentThreadTransform.count, 1,
  "pinned recent-thread list did not match the guarded transformation");
assert.equal(count(hostBundle, "__azraelWorkspaceThreadList"), 2,
  "packaged host bridge does not consume and remove the workspace marker");
assert.equal(count(hostRecentThreadBundle, "__azraelWorkspaceThreadList"), 1,
  "packaged recent-thread list does not emit the workspace marker");

const report = {
  passed: true,
  originalId: "openai.chatgpt",
  hostId: "azrael-ex-local.azrael",
  commandCount: hostCommands.length,
  configurationCount: hostConfiguration.length,
  viewCount: hostViews.length,
  customEditorCount: hostEditors.length,
  nativeAuthLiteralCount: hostLiterals.nativeChatgpt,
  proposedApiOptIn: false,
  integratedAccountPayloadVersion: payloadManifest.version,
  extensionDependencyDeclared: false,
  menuDispatchBoundary: "evaluated packaged profile-menu onClick handlers",
  workspaceThreadListFilter: "guarded recent-thread marker and host bridge cwd/all-provider injection",
  urlSafetyTransport: "source-identical runtime module and exactly one host injection",
};
testWrapperLifecycle().then(
  () => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`),
  (error) => { console.error(error); process.exitCode = 1; },
).finally(() => fs.rmSync(wrapperTestRoot, { recursive: true, force: true }));

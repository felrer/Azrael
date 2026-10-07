"use strict";

const assert = require("node:assert/strict");
const hs = require("node:fs");
const path = require("node:path");
const pm = require("node:vm");
const { CONTEXT_ASSET, SETTINGS_ASSET, MARKER } = require("./inject-provider-context.cjs");

const [originalArgument, hostArgument, typescriptArgument] = process.argv.slice(2);
if (!originalArgument || !hostArgument || !typescriptArgument) {
  throw new Error("Usage: test-independent-namespace.cjs <original-extension> <azrael-host> <typescript-module>");
}

const originalRoot = hs.realpathSync(originalArgument);
const hostRoot = hs.realpathSync(hostArgument);
const ts = require(path.resolve(typescriptArgument));

function readJson(root, relative) {
  return JSON.parse(hs.readFileSync(path.join(root, relative), "utf8"));
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

const originalManifestText = hs.readFileSync(path.join(originalRoot, "package.json"), "utf8");
const originalManifest = JSON.parse(originalManifestText);
const hostManifest = readJson(hostRoot, "package.json");
const payloadManifest = readJson(hostRoot, "account-ui/package.json");
const originalBundle = hs.readFileSync(path.join(originalRoot, "out", "extension.js"), "utf8");
const hostBundle = hs.readFileSync(path.join(hostRoot, "out", "extension.js"), "utf8");
assert.equal(count(originalBundle, require("./inject-image-file-open.cjs").MARKER), 0,
  "original Codex host unexpectedly contains the Azrael image link patch");
assert.equal(count(hostBundle, require("./inject-image-file-open.cjs").MARKER), 1,
  "packaged Azrael host must contain exactly one image link patch");
const recentThreadAsset = "webview/assets/app-initial-efe028fd535e.js";
const hostRecentThreadBundle = hs.readFileSync(path.join(hostRoot, recentThreadAsset), "utf8");
const composerDraftTransform = require("./inject-composer-draft.cjs");
const originalComposer = hs.readFileSync(path.join(originalRoot, composerDraftTransform.COMPOSER_DRAFT_ASSET), "utf8");
const hostComposer = hs.readFileSync(path.join(hostRoot, composerDraftTransform.COMPOSER_DRAFT_ASSET), "utf8");
assert.equal(count(originalComposer, composerDraftTransform.MARKER), 0);
assert.equal(count(hostComposer, composerDraftTransform.MARKER), 1);
assert.equal(composerDraftTransform.injectComposerDraft(hostComposer).count, 0,
  "packaged composer draft protection must be complete and idempotent");
const wrapperPath = path.join(hostRoot, hostManifest.main.replace(/^\.\//, ""));
const wrapper = hs.readFileSync(wrapperPath, "utf8");
assert.equal(wrapper, hs.readFileSync(path.join(__dirname, "integrated-azrael-entry.cjs"), "utf8"),
  "packaged integration entry differs from the lifecycle-validated source");
const accountBundle = ["extension.js", "accountView.js", "usageView.js", "rootResumeProtocol.js", "rootResumeView.js"]
  .map((filename) => hs.readFileSync(path.join(hostRoot, "account-ui", "dist", "src", filename), "utf8"))
  .join("\n");

assert.equal(`${originalManifest.publisher}.${originalManifest.name}`, "openai.chatgpt");
assert.equal(originalManifest.version, "26.930.61225");
assert.equal(`${hostManifest.publisher}.${hostManifest.name}`, "azrael-ex-local.azrael");
assert.match(hostManifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "host package version is not independently updateable");
assert(hostManifest.version.split(".").every(part => Number.isSafeInteger(Number(part))),
  "host package version components must be safe integers");
assert.equal(hostManifest.azraelIntegratedAccounts, true, "host did not declare its integrated account UI");
assert.equal(hostManifest.main, "./integrated-azrael-entry.cjs", "host main bypassed the integration wrapper");
assert.match(payloadManifest.version, /^0\.4\.\d+$/, "embedded account payload version differed");
assert.equal(hostManifest.azraelAccountPayloadVersion, payloadManifest.version,
  "host account payload marker differed from the embedded payload");
assert.equal(payloadManifest.main, "./dist/src/extension.js");
for (const [label, manifest] of [["host", hostManifest], ["payload", payloadManifest]]) {
  assert.equal(manifest.extensionDependencies, undefined, `${label} declared q extension dependency`);
  assert.equal(manifest.extensionPack, undefined, `${label} declared q extension pack`);
}
assert(wrapper.includes('require("./out/extension.js")') || wrapper.includes("require('./out/extension.js')"),
  "integration wrapper did not load the native extension bundle");
assert(wrapper.includes("account-ui/dist/src/extension.js"), "integration wrapper did not load the embedded account UI");
assert(wrapper.indexOf("extension.js") < wrapper.indexOf("account-ui/dist/src/extension.js"),
  "integration wrapper did not activate the native extension before the account UI");
assert(wrapper.includes("azrael-runtime.cjs"), "integration wrapper did not load the host runtime");
assert(wrapper.includes("azrael-recovery.cjs"), "integration wrapper did not initialize recovery");
for (const moduleName of ["azrael-recovery.cjs", "recovery-state.cjs", "url-safety-transport.cjs"]) {
  assert.equal(hs.readFileSync(path.join(hostRoot, "out", moduleName), "utf8"),
    hs.readFileSync(path.join(__dirname, moduleName), "utf8"), `packaged ${moduleName} differs from the validated source`);
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
  "azrael.instructions",
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
  "azrael.instructions.repository",
].sort(), "host settings must contain the renamed upstream settings and integrated shared-environment and instruction settings");
for (const [id, defaultValue] of [["azrael.sharedEnvironment.repository", ""], ["azrael.sharedEnvironment.ref", "main"], ["azrael.instructions.repository", "felrer/Azrael"]]) {
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
for (const entry of hs.readdirSync(path.join(hostRoot, "webview", "assets"))) {
  if (entry.endsWith(".js")) webviewAssets.push(hs.readFileSync(path.join(hostRoot, "webview", "assets", entry), "utf8"));
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
  assert.equal(match[3], expectedCommand, `${label} click named the wrong JS Code command`);
  assert.deepEqual(messages, [{ type: "open-vscode-command", payload: { command: expectedCommand } }],
    `${label} click dispatched the wrong JS Code command message`);
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

assert.equal(count(hostBundle, "__azraelWorkspaceThreadList"), 2,
  "packaged host bridge does not consume and remove the workspace marker");
assert.equal(count(hostRecentThreadBundle, "__azraelWorkspaceThreadList"), 1,
  "packaged recent-thread list does not emit the workspace marker");

for (const asset of [CONTEXT_ASSET, SETTINGS_ASSET]) {
  assert.equal(count(hs.readFileSync(path.join(hostRoot, asset), "utf8"), MARKER), 1,
    "packaged provider context settings/gauge injection is absent or duplicated");
}
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
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

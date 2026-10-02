"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createAssetTransformCache } = require("./asset-transform-cache.cjs");
const { readAssetsInOrder } = require("./ordered-asset-reader.cjs");
const { injectRecovery } = require("./inject-recovery.cjs");
const { injectFetchResponse } = require("./inject-fetch-response.cjs");
const { injectUrlSafetyTransport } = require("./inject-url-safety-transport.cjs");
const { FILE_OPEN_MENU_ASSET, injectFileOpenMenu } = require("./inject-file-open-menu.cjs");
const { injectImageFileOpen } = require("./inject-image-file-open.cjs");
const { DROP_ASSET, COMPOSER_ASSET, injectLocalFileDrop } = require("./inject-local-file-drop.cjs");
const { DEFERRED_REDUCER_ASSET, DEFERRED_PRESENTATION_ASSET, injectDeferredTurn, injectDeferredPresentation, injectDeferredHostNotification } = require("./inject-deferred-turn.cjs");
const { COMPACTION_PROGRESS_REDUCER_ASSET, injectCompactionProgress } = require("./inject-compaction-progress.cjs");
const { QUEUE_REFRESH_ASSET, injectQueueRefresh } = require("./inject-queue-refresh.cjs");
const { QUEUE_CONSUMPTION_ASSET, injectQueueConsumption } = require("./inject-queue-consumption.cjs");
const { PROVIDER_PICKER_ASSETS, injectProviderModelPicker } = require("./inject-provider-model-picker.cjs");
const { THREAD_BRANCH_ASSET, injectThreadBranch } = require("./inject-thread-branch.cjs");
const { QUEUED_COMPACTION_CORE_ASSET, QUEUED_COMPACTION_PRESENTATION_ASSET, QUEUED_COMPACTION_LIST_ASSET,
  injectQueuedCompactionCore, injectQueuedCompactionPresentation, injectQueuedCompactionList } = require("./inject-queued-compaction.cjs");

const HOST_ID = "azrael-ex-local.azrael";
const ACCOUNT_UI_COMMANDS = [
  "azrael.manageAccounts",
  "azrael.usage",
  "azrael.rootResume",
  "azrael.accountQuickPick",
  "azrael.refreshAccounts",
  "azrael.openCodex",
  "azrael.openCodexSettings",
  "azrael.devinAccount",
  "azrael.syncSharedEnvironment",
  "azrael.fetchSharedPlaybook",
];
const RECENT_THREAD_LIST_ASSET = "webview/assets/app-initial-9f7d97690e9b.js";
const RECENT_THREAD_LIST_SCOPE_MARKER = "__azraelWorkspaceThreadList";
const WORKSPACE_CWD_EXPRESSION = '(require("vscode").workspace.workspaceFolders??[])' +
  '.filter(({uri})=>uri.scheme==="file").map(({uri})=>uri.fsPath)';
function rewriteValue(value) {
  if (/^(?:https?|wss?):\/\//i.test(value)) return value;
  return value
    .replaceAll("azrael-ex.manageAccounts", "azrael.manageAccounts")
    .replaceAll("azrael-ex.usage", "azrael.usage")
    .replaceAll("azrael-ex.rootResume", "azrael.rootResume")
    .replaceAll("openai.chatgpt", HOST_ID)
    .replace(/chatgpt\.(?!com\b)/g, "azrael.")
    .replaceAll("codexSecondaryViewContainer", "azraelSecondaryViewContainer")
    .replaceAll("codexViewContainer", "azraelViewContainer")
    .replaceAll("openai-codex", "azrael-session")
    .replaceAll("codex-ipc", "azrael-ipc")
    .replaceAll("codex-rules", "azrael-rules");
}
function sha(text) { return crypto.createHash("sha256").update(text).digest("hex"); }

// Assemble descending edits without repeatedly copying the complete asset.
// The suffix stack also retains the old splice semantics for overlapping edits.
function applyEdits(text, edits) {
  const suffix = [];
  let cursor = text.length;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    if (edit.end <= cursor) suffix.push(text.slice(edit.end, cursor));
    else {
      let remove = edit.end - cursor;
      while (remove && suffix.length) {
        const piece = suffix.pop();
        if (piece.length > remove) {
          suffix.push(piece.slice(remove));
          remove = 0;
        } else remove -= piece.length;
      }
    }
    suffix.push(edit.replacement);
    cursor = edit.start;
  }
  suffix.push(text.slice(0, cursor));
  return suffix.reverse().join("");
}

function rewriteJavaScript(text, filename, ts) {
  const file = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (file.parseDiagnostics.length) throw new Error(`Cannot parse pinned asset: ${filename}`);
  const edits = [];
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      let next = rewriteValue(node.text);
      // "chatgpt" also denotes the native authentication type. Only change the
      // VS Code configuration argument, never that backend contract.
      if (node.text === "chatgpt" && ts.isCallExpression(node.parent) &&
          ts.isPropertyAccessExpression(node.parent.expression) &&
          node.parent.expression.name.text === "getConfiguration") next = "azrael";
      if (node.text === "Codex" || node.text === "Codex Chat" || node.text === "Codex Agent") next = node.text.replace("Codex", "azrael");
      if (next !== node.text) {
        const replacement = ts.isStringLiteral(node) ? JSON.stringify(next) :
          "`" + next.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${") + "`";
        edits.push({ start: node.getStart(file), end: node.end, replacement });
      }
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const original = text.slice(node.getStart(file), node.end);
      const template = ts.isTemplateExpression(node.parent) ? node.parent : node.parent.parent;
      const externalTemplate = ts.isTemplateExpression(template) && /^(?:https?|wss?):\/\//i.test(template.head.text);
      const replacement = externalTemplate ? original : rewriteValue(original);
      if (replacement !== original) edits.push({ start: node.getStart(file), end: node.end, replacement });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  const result = applyEdits(text, edits);
  const parsed = ts.createSourceFile(filename, result, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  if (parsed.parseDiagnostics.length) throw new Error(`Invalid transformed asset: ${filename}`);
  return { text: result, count: edits.length };
}

function injectWorkspaceThreadListBridgeFilter(text, filename, ts) {
  const file = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (file.parseDiagnostics.length) throw new Error(`Cannot parse pinned asset: ${filename}`);
  const edits = [];
  const visit = (node) => {
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) &&
        node.name.text === "sendProviderRequest" && node.body && node.parameters.length === 6 &&
        node.parameters.every(({ name }) => ts.isIdentifier(name))) {
      const methodName = node.parameters[2].name.text;
      const paramsName = node.parameters[3].name.text;
      const findRequestParams = (child) => {
        if (ts.isPropertyAssignment(child) && ts.isIdentifier(child.name) && child.name.text === "params" &&
            ts.isIdentifier(child.initializer) && child.initializer.text === paramsName &&
            ts.isObjectLiteralExpression(child.parent)) {
          const methodProperty = child.parent.properties.find((property) =>
            ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === "method");
          if (methodProperty && ts.isIdentifier(methodProperty.initializer) &&
              methodProperty.initializer.text === methodName) edits.push(child.initializer);
        }
        ts.forEachChild(child, findRequestParams);
      };
      findRequestParams(node.body);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (edits.length !== 1) {
    throw new Error(`Pinned host app-server bridge contract changed in ${filename}: expected 1 request params boundary, found ${edits.length}.`);
  }
  const params = edits[0];
  const paramsName = params.text;
  const method = params.parent.parent.properties.find((property) =>
    ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === "method").initializer.text;
  const replacement = `(${method}==="thread/list"&&${paramsName}?.${RECENT_THREAD_LIST_SCOPE_MARKER}` +
    `?(({${RECENT_THREAD_LIST_SCOPE_MARKER}:_,...__azraelParams})=>({...__azraelParams,modelProviders:[],cwd:${WORKSPACE_CWD_EXPRESSION}}))(${paramsName})` +
    `:${paramsName})`;
  const result = text.slice(0, params.getStart(file)) + replacement + text.slice(params.end);
  const parsed = ts.createSourceFile(filename, result, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  if (parsed.parseDiagnostics.length) throw new Error(`Invalid transformed asset: ${filename}`);
  return { text: result, count: 1 };
}

function markRecentThreadListRequest(text, filename, ts) {
  const file = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (file.parseDiagnostics.length) throw new Error(`Cannot parse pinned asset: ${filename}`);
  const edits = [];
  let invalidShapes = 0;
  function countRecentThreadSources(node) {
    let count = 0;
    const visit = (child) => {
      if (ts.isPropertyAssignment(child) && ts.isIdentifier(child.name) && child.name.text === "source" &&
          (ts.isStringLiteral(child.initializer) || ts.isNoSubstitutionTemplateLiteral(child.initializer)) &&
          child.initializer.text === "recent_threads") count += 1;
      ts.forEachChild(child, visit);
    };
    visit(node);
    return count;
  }
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "sendRequest" && node.arguments.length >= 3) {
      const method = node.arguments[0];
      const sourceCount = countRecentThreadSources(node.arguments[2]);
      if ((ts.isStringLiteral(method) || ts.isNoSubstitutionTemplateLiteral(method)) &&
          method.text === "thread/list" && sourceCount) {
        const params = node.arguments[1];
        if (node.arguments.length !== 3 || !ts.isIdentifier(params) || sourceCount !== 2) invalidShapes += 1;
        else edits.push(params);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (edits.length !== 1 || invalidShapes) {
    throw new Error(`Pinned recent-thread list contract changed in ${filename}: expected 1 conditional recent_threads request, found ${edits.length} (${invalidShapes} unsupported).`);
  }
  const result = applyEdits(text, edits.map((edit) => ({
    start: edit.getStart(file), end: edit.end,
    replacement: `({...(${text.slice(edit.getStart(file), edit.end)}),${RECENT_THREAD_LIST_SCOPE_MARKER}:!0})`,
  })));
  const parsed = ts.createSourceFile(filename, result, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  if (parsed.parseDiagnostics.length) throw new Error(`Invalid transformed asset: ${filename}`);
  return { text: result, count: edits.length };
}

function transformManifest(original, hostVersion = "0.5.0", accountUiManifest) {
  function visit(value) {
    if (typeof value === "string") return rewriteValue(value);
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [rewriteValue(key), visit(item)]));
  }
  const manifest = visit(original);
  manifest.publisher = "azrael-ex-local";
  manifest.name = "azrael";
  manifest.version = hostVersion;
  manifest.displayName = "azrael";
  manifest.description = "Independent azrael chat host with its own accounts, sessions and engine.";
  manifest.extensionKind = ["ui"];
  delete manifest.__metadata;
  delete manifest.enabledApiProposals;
  // The original extension is allowlisted for proposed APIs; the local host is
  // not. Its guarded native implementation falls back to normal Webview panels.
  delete manifest.contributes.chatSessions;
  delete manifest.contributes.menus?.["chatSessions/newSession"];
  delete manifest.extensionDependencies;
  delete manifest.extensionPack;
  if (accountUiManifest) {
    const accountVersion = accountUiManifest.version;
    if (typeof accountVersion !== "string" || !/^\d+(?:\.\d+){2}(?:[-+].*)?$/.test(accountVersion) ||
        accountVersion.split(".").slice(0, 3).map(Number).some((part) => !Number.isSafeInteger(part)) ||
        compareVersions(accountVersion, "0.3.0") < 0) {
      throw new Error("Integrated account UI version 0.3.0 or newer is required.");
    }
    const payloadCommands = accountUiManifest.contributes?.commands;
    if (!Array.isArray(payloadCommands)) throw new Error("Integrated account UI commands are missing.");
    const sidebarCommands = payloadCommands.filter((command) => command?.command === "azrael.openSidebar");
    if (sidebarCommands.length > 1) throw new Error("Integrated account UI duplicates the official sidebar command.");
    const accountCommands = payloadCommands.filter((command) => command?.command !== "azrael.openSidebar");
    const commandIds = accountCommands.map((command) => command?.command).sort();
    const expectedIds = [...ACCOUNT_UI_COMMANDS].sort();
    if (JSON.stringify(commandIds) !== JSON.stringify(expectedIds)) {
      throw new Error(`Integrated account UI command contract mismatch: ${commandIds.join(", ")}`);
    }
    manifest.contributes.commands = [...(manifest.contributes.commands ?? []), ...accountCommands.map(visit)];
    manifest.contributes.menus ??= {};
    manifest.contributes.menus.commandPalette = [
      ...(manifest.contributes.menus.commandPalette ?? []),
      ...(accountUiManifest.contributes?.menus?.commandPalette ?? []).map(visit),
    ];
    const payloadConfiguration = accountUiManifest.contributes?.configuration;
    const configurationBlocks = Array.isArray(payloadConfiguration) ? payloadConfiguration : payloadConfiguration ? [payloadConfiguration] : [];
    for (const block of configurationBlocks) {
      if (!block || typeof block !== "object" || !block.properties || typeof block.properties !== "object") continue;
      manifest.contributes.configuration ??= { properties: {} };
      manifest.contributes.configuration.properties = { ...manifest.contributes.configuration.properties, ...visit(block.properties) };
    }
    manifest.contributes.commands.push({ command: "azrael.recoveryStatus", title: "실행 상태 및 복구", category: "azrael" });
    manifest.main = "./integrated-azrael-entry.cjs";
    manifest.azraelIntegratedAccounts = true;
    manifest.azraelAccountPayloadVersion = accountVersion;
  }
  manifest.contributes.configuration.title = "azrael Settings";
  manifest.contributes.configuration.properties["azrael.commentCodeLensEnabled"].default = false;
  for (const command of manifest.contributes.commands ?? []) {
    if (typeof command.title === "string") command.title = command.title.replaceAll("Codex", "azrael");
    command.category = "azrael";
  }
  for (const editor of manifest.contributes.customEditors ?? []) editor.displayName = editor.displayName.replaceAll("Codex", "azrael");
  for (const language of manifest.contributes.languages ?? []) {
    delete language.extensions; // Keep ordinary .rules file associations intact.
    language.aliases = ["azrael Rules"];
  }
  return manifest;
}

function compareVersions(left, right) {
  const parts = (value) => value.split(/[+-]/, 1)[0].split(".").map(Number);
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function transformAsset(source, relativePath, filename, ts) {
  const isHostBundle = relativePath === "out/extension.js";
  const isRecentThreadListAsset = relativePath === RECENT_THREAD_LIST_ASSET;
  const isQueuedCompactionAsset = [QUEUED_COMPACTION_CORE_ASSET, QUEUED_COMPACTION_PRESENTATION_ASSET, QUEUED_COMPACTION_LIST_ASSET].includes(relativePath);
  if (!isHostBundle && !isRecentThreadListAsset && !isQueuedCompactionAsset && ![FILE_OPEN_MENU_ASSET, DROP_ASSET, COMPOSER_ASSET, THREAD_BRANCH_ASSET].includes(relativePath) && !PROVIDER_PICKER_ASSETS.includes(relativePath) && !/chatgpt|codexViewContainer|codexSecondaryViewContainer|openai-codex|codex-ipc|codex-rules|["'`]Codex["'`]/.test(source)) return { text: source, asset: null };
  const namespaced = rewriteJavaScript(source, filename, ts);
  const filtered = isHostBundle ? injectWorkspaceThreadListBridgeFilter(namespaced.text, filename, ts) :
    isRecentThreadListAsset ? markRecentThreadListRequest(namespaced.text, filename, ts) :
      { text: namespaced.text, count: 0 };
  const fetchResponse = isHostBundle ? injectFetchResponse(filtered.text) : { text: filtered.text, count: 0 };
  const recovered = isHostBundle ? injectRecovery(fetchResponse.text, filename, ts) : { text: fetchResponse.text, count: 0 };
  const deferred = isHostBundle ? injectDeferredHostNotification(recovered.text) : relativePath === DEFERRED_REDUCER_ASSET ? injectDeferredTurn(recovered.text) :
    relativePath === DEFERRED_PRESENTATION_ASSET ? injectDeferredPresentation(recovered.text) : { text: recovered.text, count: 0 };
  const compactionProgress = relativePath === COMPACTION_PROGRESS_REDUCER_ASSET ?
    injectCompactionProgress(deferred.text) : { text: deferred.text, count: 0 };
  const queueRefresh = relativePath === QUEUE_REFRESH_ASSET ?
    injectQueueRefresh(compactionProgress.text) : { text: compactionProgress.text, count: 0 };
  const queuedCompaction = relativePath === QUEUED_COMPACTION_CORE_ASSET ? injectQueuedCompactionCore(queueRefresh.text) :
    relativePath === QUEUED_COMPACTION_PRESENTATION_ASSET ? injectQueuedCompactionPresentation(queueRefresh.text) :
      relativePath === QUEUED_COMPACTION_LIST_ASSET ? injectQueuedCompactionList(queueRefresh.text) : { text: queueRefresh.text, count: 0 };
  const queueConsumption = relativePath === QUEUE_CONSUMPTION_ASSET ? injectQueueConsumption(queuedCompaction.text) : { text: queuedCompaction.text, count: 0 };
  const providerPicker = injectProviderModelPicker(queueConsumption.text, relativePath);
  const threadBranch = injectThreadBranch(providerPicker.text, relativePath);
  const urlSafety = isHostBundle ? injectUrlSafetyTransport(threadBranch.text) : { text: threadBranch.text, count: 0 };
  const fileOpenMenu = injectFileOpenMenu(urlSafety.text, relativePath);
  const imageFileOpen = isHostBundle ? injectImageFileOpen(fileOpenMenu.text) : { text: fileOpenMenu.text, count: 0 };
  const localFileDrop = injectLocalFileDrop(imageFileOpen.text, relativePath);
  if (namespaced.count || filtered.count || fetchResponse.count || recovered.count || deferred.count || compactionProgress.count || queueRefresh.count || queuedCompaction.count || queueConsumption.count || providerPicker.count || threadBranch.count || urlSafety.count || fileOpenMenu.count || imageFileOpen.count || localFileDrop.count) {
    return { text: localFileDrop.text, asset: {
      path: relativePath,
      edits: namespaced.count + filtered.count + fetchResponse.count + recovered.count + deferred.count + compactionProgress.count + queueRefresh.count + queuedCompaction.count + queueConsumption.count + providerPicker.count + threadBranch.count + urlSafety.count + fileOpenMenu.count + imageFileOpen.count + localFileDrop.count,
      namespaceEdits: namespaced.count,
      workspaceThreadListEdits: filtered.count,
      recoveryEdits: recovered.count,
      fetchResponseEdits: fetchResponse.count,
      deferredTurnEdits: deferred.count,
      deferredNativeTimingChecks: deferred.nativeTimingChecks ?? 0,
      compactionProgressEdits: compactionProgress.count,
      queueRefreshEdits: queueRefresh.count,
      queueRefreshNativeChecks: queueRefresh.nativeChecks ?? 0,
      providerPickerEdits: providerPicker.count,
      threadBranchEdits: threadBranch.count,
      queuedCompactionEdits: queuedCompaction.count,
      queueConsumptionEdits: queueConsumption.count,
      urlSafetyTransportEdits: urlSafety.count,
      imageFileOpenEdits: imageFileOpen.count,
      fileOpenMenuEdits: fileOpenMenu.count,
      localFileDropEdits: localFileDrop.count,
      sourceSha256: sha(source),
      sha256: sha(localFileDrop.text),
    } };
  }
  return { text: localFileDrop.text, asset: null };
}

function getTransformRules() {
  const transformSources = [
    "namespace-azrael-host.cjs", "asset-transform-cache.cjs", "ordered-asset-reader.cjs", "inject-recovery.cjs", "inject-fetch-response.cjs", "inject-url-safety-transport.cjs", "inject-image-file-open.cjs", "inject-file-open-menu.cjs", "pdf-file-open.cjs", "inject-local-file-drop.cjs",
    "inject-deferred-turn.cjs", "inject-compaction-progress.cjs", "inject-queue-refresh.cjs",
    "inject-queue-consumption.cjs", "inject-queued-compaction.cjs",
    "inject-provider-model-picker.cjs", "provider-model-picker.cjs",
    "inject-thread-branch.cjs", "thread-branch.cjs",
  ];
  return Object.fromEntries(transformSources.map((name) =>
    [name, sha(fs.readFileSync(path.join(__dirname, name)))]));
}

async function transformExtension(directory, ts, hostVersion, options = {}) {
  const started = performance.now();
  const readConcurrency = options.readConcurrency ?? 4;
  if (!Number.isInteger(readConcurrency) || readConcurrency < 1 || readConcurrency > 8) {
    throw new Error("Asset read concurrency must be an integer from 1 to 8.");
  }
  const stages = Object.fromEntries(["enumeration", "sourceRead", "decode", "sourceHash",
    "cacheInitialization", "cacheLookup", "cacheRead", "cacheValidation", "cacheWrite",
    "cacheFlush", "transform", "outputWrite", "finalize"].map((name) =>
    [name, { elapsedMs: 0, count: 0, bytes: 0 }]));
  const performanceReport = { elapsedMs: 0, readBytes: 0, fileCount: 0, cache: { hits: 0, misses: 0 },
    stages, slowFiles: [], reads: { concurrency: readConcurrency, scanElapsedMs: 0 },
    timingSemantics: "sourceRead elapsedMs sums asynchronous request latency and may overlap other reads and transformation. reads.scanElapsedMs is scan wall time; reads.readWaitMs sums ordered-consumer waits. Other stages measure synchronous wall time. cacheInitialization/cacheFlush include nested cacheRead/cacheValidation/cacheWrite; finalize includes cacheFlush. slowFiles elapsedMs combines consumptionMs and ordered readWaitMs, excluding prior read-ahead latency. Do not sum overlapping or nested totals. sourceRead/cacheRead/cacheWrite/outputWrite bytes count successful I/O; decode/sourceHash bytes count processed source bytes. Do not sum repeated byte counts. Finalize metadata and report I/O are excluded." };
  function measure(stage, action) {
    const stageStarted = performance.now();
    try { return action(); } finally {
      stages[stage].elapsedMs += performance.now() - stageStarted;
      stages[stage].count += 1;
    }
  }
  if (!/^0\.5\.\d+$/.test(hostVersion ?? "") || !Number.isSafeInteger(Number(hostVersion.split(".")[2]))) {
    throw new Error("A unique 0.5.<build> host version is required.");
  }
  const root = fs.realpathSync(directory);
  const manifestPath = path.join(root, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.publisher !== "openai" || manifest.name !== "chatgpt" || manifest.version !== "26.928.31416") {
    throw new Error("Independent transformation requires the prepared pinned original identity.");
  }
  if (!fs.existsSync(path.join(root, "out", "azrael-runtime.cjs")) || !fs.existsSync(path.join(root, ".azrael-official-ui.json"))) {
    throw new Error("Prepare the hash-verified host and private runtime before namespacing.");
  }
  const sourceUi = JSON.parse(fs.readFileSync(path.join(root, ".azrael-official-ui.json"), "utf8"));
  if (sourceUi.schema !== 1 || sourceUi.sourceVersion !== manifest.version ||
      !/^[a-f\d]{64}$/i.test(sourceUi.sourcePackageSha256 ?? "") ||
      !/^[a-f\d]{64}$/i.test(sourceUi.sourceWebviewSha256 ?? "")) {
    throw new Error("Prepared official UI provenance does not match the pinned source.");
  }
  const accountUiManifestPath = path.join(root, "account-ui", "package.json");
  const integratedEntryPath = path.join(root, "integrated-azrael-entry.cjs");
  const accountUiEntryPath = path.join(root, "account-ui", "dist", "src", "extension.js");
  if (!fs.existsSync(accountUiManifestPath) || !fs.existsSync(accountUiEntryPath) || !fs.existsSync(integratedEntryPath)) {
    throw new Error("Prepare the integrated account UI payload and entry point before namespacing.");
  }
  const accountUiManifest = JSON.parse(fs.readFileSync(accountUiManifestPath, "utf8"));
  const report = {
    schema: 1, hostId: HOST_ID, hostVersion, sourceVersion: manifest.version,
    sourceUi: {
      version: sourceUi.sourceVersion,
      packageSha256: sourceUi.sourcePackageSha256,
      webviewSha256: sourceUi.sourceWebviewSha256,
    },
    transformRules: getTransformRules(),
    assets: [],
  };
  const cache = createAssetTransformCache({
    cacheDirectory: options.cacheDirectory,
    typescriptSha256: options.typescriptSha256,
    typescriptVersion: ts.version,
    transformRules: report.transformRules,
    statistics: performanceReport.cache,
    metrics: stages,
  });
  function* enumerate(folder) {
    for (const entry of measure("enumeration", () => fs.readdirSync(folder, { withFileTypes: true }))) {
      const filename = path.join(folder, entry.name);
      if (entry.isDirectory()) { yield* enumerate(filename); continue; }
      if (!entry.isFile() || !filename.endsWith(".js")) continue;
      yield filename;
    }
  }
  function* assets() {
    yield* enumerate(path.join(root, "out"));
    yield* enumerate(path.join(root, "webview"));
  }
  const scanStarted = performance.now();
  await readAssetsInOrder(assets(), (filename, sourceBytes, readWaitMs) => {
      const fileStarted = performance.now();
      const source = measure("decode", () => sourceBytes.toString("utf8"));
      stages.decode.bytes += sourceBytes.length;
      const relativePath = path.relative(root, filename).replaceAll("\\", "/");
      performanceReport.fileCount += 1;
      performanceReport.readBytes += sourceBytes.length;
      const sourceSha256 = measure("sourceHash", () => sha(sourceBytes));
      stages.sourceHash.bytes += sourceBytes.length;
      const hitsBefore = performanceReport.cache.hits;
      const result = cache.run(relativePath, source,
        () => measure("transform", () => transformAsset(source, relativePath, filename, ts)), sourceSha256);
      if (result.asset) {
        measure("outputWrite", () => fs.writeFileSync(filename, result.text));
        stages.outputWrite.bytes += Buffer.byteLength(result.text);
        report.assets.push(result.asset);
      }
      const consumptionMs = performance.now() - fileStarted;
      const elapsedMs = consumptionMs + readWaitMs;
      const slowFiles = performanceReport.slowFiles;
      if (slowFiles.length < 10 || elapsedMs > slowFiles[slowFiles.length - 1].elapsedMs) {
        slowFiles.push({ path: relativePath, elapsedMs, consumptionMs, readWaitMs, readBytes: sourceBytes.length,
          cacheHit: performanceReport.cache.hits > hitsBefore, changed: Boolean(result.asset) });
        slowFiles.sort((a, b) => b.elapsedMs - a.elapsedMs);
        if (slowFiles.length > 10) slowFiles.pop();
      }
  }, { concurrency: readConcurrency, statistics: performanceReport.reads, readMetrics: stages.sourceRead });
  performanceReport.reads.scanElapsedMs = performance.now() - scanStarted;
  const finalizeStarted = performance.now();
  if (report.assets.reduce((total, asset) => total + asset.providerPickerEdits, 0) !== PROVIDER_PICKER_ASSETS.length) {
    throw new Error("Provider model-picker transformation was incomplete.");
  }
  if (report.assets.reduce((total, asset) => total + (asset.threadBranchEdits ?? 0), 0) !== 1) {
    throw new Error("Thread branch transformation was incomplete.");
  }
  if (report.assets.reduce((total, asset) => total + asset.urlSafetyTransportEdits, 0) !== 1) {
    throw new Error("URL safety transport transformation was incomplete.");
  }
  if (report.assets.reduce((total, asset) => total + (asset.fileOpenMenuEdits ?? 0), 0) !== 1) {
    throw new Error("File-open menu transformation was incomplete.");
  }
  if (report.assets.reduce((total, asset) => total + asset.imageFileOpenEdits, 0) !== 1) {
    throw new Error("Image file-open transformation was incomplete.");
  }
  if (report.assets.reduce((total, asset) => total + asset.localFileDropEdits, 0) !== 2) {
    throw new Error("Local file-drop transformation was incomplete.");
  }
  if (report.assets.reduce((total, asset) => total + asset.queueConsumptionEdits, 0) !== 1) {
    throw new Error("Queue-consumption transformation was incomplete.");
  }
  if (report.assets.reduce((total, asset) => total + (asset.fetchResponseEdits ?? 0), 0) !== 1) {
    throw new Error("Fetch-response transformation was incomplete.");
  }
  if (report.assets.reduce((total, asset) => total + asset.queuedCompactionEdits, 0) !== 3) {
    throw new Error("Queued-compaction transformation was incomplete.");
  }
  if (report.assets.reduce((total, asset) => total + asset.queueRefreshNativeChecks, 0) !== 1) {
    throw new Error("Native queue-refresh validation was incomplete.");
  }
  if (report.assets.reduce((total, asset) => total + asset.deferredTurnEdits, 0) !== 7) {
    throw new Error("Deferred-turn transformation was incomplete.");
  }
  if (report.assets.reduce((total, asset) => total + asset.deferredNativeTimingChecks, 0) !== 1) {
    throw new Error("Native deferred timing validation was incomplete.");
  }
  if (report.assets.reduce((total, asset) => total + asset.compactionProgressEdits, 0) !== 1) {
    throw new Error("Compaction-progress transformation was incomplete.");
  }
  const workspaceThreadListEdits = report.assets.reduce(
    (total, asset) => total + asset.workspaceThreadListEdits, 0);
  if (workspaceThreadListEdits !== 2) {
    throw new Error(`Workspace thread-list transformation was incomplete: expected 2 edits, found ${workspaceThreadListEdits}.`);
  }
  cache.flush();
  const grammarPath = path.join(root, "syntaxes", "starlark.tmLanguage.json");
  fs.writeFileSync(grammarPath, rewriteValue(fs.readFileSync(grammarPath, "utf8")));
  const transformed = transformManifest(manifest, hostVersion, accountUiManifest);
  fs.writeFileSync(manifestPath, JSON.stringify(transformed, null, 2) + "\n");
  const oldVsixManifest = path.join(root, ".vsixmanifest");
  if (fs.existsSync(oldVsixManifest)) fs.unlinkSync(oldVsixManifest);
  fs.writeFileSync(path.join(root, "readme.md"), "# azrael\n\nIndependent local azrael extension. Runs beside the original Codex extension with separate accounts and conversations.\n\nDerived from the locally installed, pinned Codex extension; original notices are retained in LICENSE.md.\n");
  // The guarded Windows host always resolves the source-verified external
  // runtime.engine. Keep its existing Windows tools, including rg, but do not
  // package an unused second engine or unsupported Linux executables.
  fs.writeFileSync(path.join(root, ".vscodeignore"), "bin/linux-x86_64/**\nbin/windows-x86_64/codex.exe\n");
  report.manifestSha256 = sha(fs.readFileSync(manifestPath));
  stages.finalize.elapsedMs = performance.now() - finalizeStarted;
  stages.finalize.count = 1;
  performanceReport.elapsedMs = performance.now() - started;
  report.performance = performanceReport;
  fs.writeFileSync(path.join(root, ".azrael-independent-host.json"), JSON.stringify(report, null, 2) + "\n");
  return report;
}

module.exports = {
  applyEdits,
  getTransformRules,
  transformAsset,
  rewriteValue,
  rewriteJavaScript,
  injectWorkspaceThreadListBridgeFilter,
  markRecentThreadListRequest,
  transformManifest,
  transformExtension,
};
if (require.main === module) {
  const [directory, typescript, hostVersion, cacheDirectory] = process.argv.slice(2);
  if (!directory || !typescript) throw new Error("Usage: namespace-azrael-host.cjs <prepared extension> <typescript module> <host version> [cache directory]");
  const typescriptPath = path.resolve(typescript);
  transformExtension(directory, require(typescriptPath), hostVersion, {
    cacheDirectory, typescriptSha256: sha(fs.readFileSync(typescriptPath)),
  }).then(report => {
    console.log(JSON.stringify({ hostId: report.hostId, changedAssets: report.assets.length, manifestSha256: report.manifestSha256 }));
  }).catch(error => { console.error(error); process.exitCode = 1; });
}

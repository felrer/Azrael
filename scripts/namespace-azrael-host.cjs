"use strict";
const { ACCOUNT_SETTINGS_ASSET, injectAccountSettings } = require("./inject-account-settings.cjs");
const { INSTRUCTION_SETTINGS_ASSETS, injectInstructionSettings } = require("./inject-instruction-settings.cjs");
const { DESIGN_ASSETS, injectStudentDesign } = require("./inject-student-design.cjs");
const { copyStudentAvatarAssets } = require("./student-avatar-assets.cjs");
const { SESSION_LINK_ASSETS, injectSessionLinks } = require("./inject-session-links.cjs");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createAssetTransformCache } = require("./asset-transform-cache.cjs");
const { readAssetsInOrder } = require("./ordered-asset-reader.cjs");
const { injectRecovery } = require("./inject-recovery.cjs");
const { injectFetchResponse } = require("./inject-fetch-response.cjs");
const { injectUrlSafetyTransport } = require("./inject-url-safety-transport.cjs");
const { injectComputerUse, injectComputerUseSettings, injectComputerUseCancelRequest, injectComputerUseManagement, COMPUTER_USE_SETTINGS_ASSET, COMPUTER_USE_APPROVAL_CARD_ASSET, COMPUTER_USE_MANAGEMENT_ASSET } = require("./inject-computer-use.cjs");
const { injectWindowControl, SETTINGS_ASSET: WINDOW_CONTROL_SETTINGS_ASSET } = require("./inject-window-control.cjs");
const { FILE_OPEN_MENU_ASSET, injectFileOpenMenu } = require("./inject-file-open-menu.cjs");
const { injectImageFileOpen } = require("./inject-image-file-open.cjs");
const { DROP_ASSET, COMPOSER_ASSET, injectLocalFileDrop } = require("./inject-local-file-drop.cjs");
const { COMPOSER_DRAFT_ASSET, injectComposerDraft } = require("./inject-composer-draft.cjs");
const { injectUiInputDiagnostics } = require("./inject-ui-input-diagnostics.cjs");
const { UI_CLEANUP_ASSETS, injectUiCleanup } = require("./inject-ui-cleanup.cjs");
const { PETS_CLEANUP_ASSETS, injectPetsCleanup } = require("./inject-pets-cleanup.cjs");
const { CONTENT_FONT_ASSETS, CONTENT_FONT_CSS_ASSET, injectContentFonts } = require("./inject-content-fonts.cjs");
const { getContentFontRules, copyContentFontAssets } = require("./content-fonts.cjs");
const { CONTEXT_ASSET, SETTINGS_ASSET, injectProviderContextControls } = require("./inject-provider-context.cjs");
const { runProviderContext } = require("./provider-context-labels.cjs");
const { DEFERRED_REDUCER_ASSET, DEFERRED_PRESENTATION_ASSET, DEFERRED_WAIT_RENDERER_ASSET, DEFERRED_THREAD_ASSET, DEFERRED_TURN_ASSET, DEFERRED_COLLAPSED_ASSET,
  injectDeferredTurn, injectDeferredPresentation, injectDeferredWaitRenderer, injectDeferredThread, injectDeferredTurnView, injectDeferredCollapsed, injectDeferredHostNotification } = require("./inject-deferred-turn.cjs");
const { COMPACTION_PROGRESS_REDUCER_ASSET, injectCompactionProgress } = require("./inject-compaction-progress.cjs");
const { QUEUE_REFRESH_ASSET, injectQueueRefresh } = require("./inject-queue-refresh.cjs");
const { ACCOUNT_QUEUE_CORE_ASSET, ACCOUNT_QUEUE_PRESENTATION_ASSET, ACCOUNT_QUEUE_LIST_ASSET, injectAccountSwitchQueue } = require("./inject-account-switch-queue.cjs");
const { QUEUE_CONSUMPTION_ASSET, injectQueueConsumption } = require("./inject-queue-consumption.cjs");
const { PROVIDER_PICKER_ASSETS, injectProviderModelPicker } = require("./inject-provider-model-picker.cjs");
const { MAX_REASONING_ASSETS, injectMaxReasoning } = require("./inject-max-reasoning.cjs");
const { loadManifest, validateManifest, validateTransformReport } = require("./feature-preservation.cjs");
const { THREAD_BRANCH_ASSET, injectThreadBranch } = require("./inject-thread-branch.cjs");
const { ASSET: RECENT_CHAT_FILTER_ASSET, injectRecentChatFilter } = require("./inject-recent-chat-filter.cjs");
const { PAGINATED_HISTORY_ASSET, injectPaginatedHistory } = require("./inject-paginated-history.cjs");
const { IMMEDIATE_STOP_ASSET, injectImmediateStop } = require("./inject-immediate-stop.cjs");
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
  "azrael.instructions",
];
const RECENT_THREAD_LIST_ASSET = "webview/assets/app-initial-efe028fd535e.js";
const RECENT_THREAD_LIST_SCOPE_MARKER = "__azraelWorkspaceThreadList";
const WORKSPACE_CWD_EXPRESSION = '(require("vscode").workspace.workspaceFolders??[])' +
  '.filter(({uri})=>uri.scheme==="file").map(({uri})=>uri.fsPath)';
function rewriteValue(value) {
  if (/^(?:https?|wss?):\/\//i.test(value)) return value;
  // Backend header names are protocol identifiers, independent of UI branding.
  if (/^(?:OAI-|x-openai-)/i.test(value)) return value;
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
  const isLocaleAsset = /(?:^|[\\/])[a-z]{2}(?:-[A-Za-z]{2,4})?-[a-f0-9]+\.js$/.test(filename);
  const file = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (file.parseDiagnostics.length) throw new Error(`Cannot parse pinned asset: ${filename}`);
  const edits = [];
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) &&
        node.name.text === "OAI-App-Brand" && ["Nl.toLowerCase()", "tu.toLowerCase()"].includes(node.initializer.getText(file))) {
      edits.push({ start: node.initializer.getStart(file), end: node.initializer.end, replacement: '"codex"' });
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      let next = rewriteValue(node.text);
      // "chatgpt" also denotes the native authentication type. Only change the
      // VS Code configuration argument, never that backend contract.
      if (node.text === "chatgpt" && ts.isCallExpression(node.parent) &&
          ts.isPropertyAccessExpression(node.parent.expression) &&
          node.parent.expression.name.text === "getConfiguration") next = "azrael";
      if (node.text === "Codex" || node.text === "Codex Chat" || node.text === "Codex Agent") next = node.text.replace("Codex", "Azrael");
      if (node.text === "Codex Settings") next = "Azrael Settings";
      if (["Codex Dark", "Codex Light", "Implement with Codex", "Open Codex Sidebar", "New Codex Agent", "Add to Codex Thread", "Add File to Codex Thread"].includes(node.text)) next = node.text.replace("Codex", "Azrael");
      if (node.text === "azrael" && ts.isVariableDeclaration(node.parent) && node.parent.name.getText(file) === "qOt") next = "Azrael";
      if (ts.isPropertyAssignment(node.parent) && node.parent.initializer === node &&
          (isLocaleAsset || node.parent.name.getText(file) === "defaultMessage")) {
        next = next.replace(/\bCodex\b(?! (?:Spark|Mini)\b)/g, "Azrael");
      }
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
  manifest.displayName = "Azrael";
  manifest.description = "Independent Azrael chat host with its own accounts, sessions and engine.";
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
    manifest.contributes.commands.push({ command: "azrael.recoveryStatus", title: "실행 상태 및 복구", category: "Azrael" });
    manifest.contributes.commands.push({ command: "azrael.migrateSessionLink", title: "Migrate old session link", category: "Azrael" });
    manifest.contributes.commands.push({ command: "azrael.windowControl", title: "Computer Use: 선택 창 모드", category: "Azrael" });
    manifest.main = "./integrated-azrael-entry.cjs";
    manifest.azraelIntegratedAccounts = true;
    manifest.azraelAccountPayloadVersion = accountVersion;
  }
  manifest.contributes.configuration.title = "Azrael Settings";
  manifest.contributes.configuration.properties["azrael.commentCodeLensEnabled"].default = false;
  for (const command of manifest.contributes.commands ?? []) {
    if (typeof command.title === "string") command.title = command.title.replaceAll("Codex", "Azrael");
    command.category = "Azrael";
  }
  for (const editor of manifest.contributes.customEditors ?? []) editor.displayName = editor.displayName.replaceAll("Codex", "Azrael");
  for (const containers of Object.values(manifest.contributes.viewsContainers ?? {})) {
    for (const container of containers) if (/^(?:Codex|azrael)$/.test(container.title)) container.title = "Azrael";
  }
  for (const views of Object.values(manifest.contributes.views ?? {})) {
    for (const view of views) if (/^(?:Codex|azrael)$/.test(view.name)) view.name = "Azrael";
  }
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
  if (!isHostBundle && !isRecentThreadListAsset && !isQueuedCompactionAsset && ![DEFERRED_REDUCER_ASSET, DEFERRED_PRESENTATION_ASSET, DEFERRED_WAIT_RENDERER_ASSET, DEFERRED_THREAD_ASSET, DEFERRED_TURN_ASSET, DEFERRED_COLLAPSED_ASSET, FILE_OPEN_MENU_ASSET, DROP_ASSET, COMPOSER_ASSET, THREAD_BRANCH_ASSET, CONTEXT_ASSET, SETTINGS_ASSET, ACCOUNT_SETTINGS_ASSET, COMPUTER_USE_SETTINGS_ASSET, COMPUTER_USE_APPROVAL_CARD_ASSET, COMPUTER_USE_MANAGEMENT_ASSET].includes(relativePath) && !SESSION_LINK_ASSETS.includes(relativePath) && !INSTRUCTION_SETTINGS_ASSETS.includes(relativePath) && !DESIGN_ASSETS.includes(relativePath) && !PROVIDER_PICKER_ASSETS.includes(relativePath) && !MAX_REASONING_ASSETS.includes(relativePath) && !UI_CLEANUP_ASSETS.includes(relativePath) && !PETS_CLEANUP_ASSETS.includes(relativePath) && !CONTENT_FONT_ASSETS.includes(relativePath) && !/chatgpt|codexViewContainer|codexSecondaryViewContainer|openai-codex|codex-ipc|codex-rules|\bCodex\b/.test(source)) return { text: source, asset: null };
  const namespaced = relativePath === CONTENT_FONT_CSS_ASSET ? { text: source, count: 0 } : rewriteJavaScript(source, filename, ts);
  const accountSettings = injectAccountSettings(namespaced.text, relativePath);
  const instructionSettings = injectInstructionSettings(accountSettings.text, relativePath);
  const studentDesign = injectStudentDesign(instructionSettings.text, relativePath, ts);
  const filtered = isHostBundle ? injectWorkspaceThreadListBridgeFilter(studentDesign.text, filename, ts) :
    isRecentThreadListAsset ? markRecentThreadListRequest(studentDesign.text, filename, ts) :
      { text: studentDesign.text, count: 0 };
  const fetchResponse = isHostBundle ? injectFetchResponse(filtered.text) : { text: filtered.text, count: 0 };
  const recovered = isHostBundle ? injectRecovery(fetchResponse.text, filename, ts) : { text: fetchResponse.text, count: 0 };
  const deferred = isHostBundle ? injectDeferredHostNotification(recovered.text) : relativePath === DEFERRED_REDUCER_ASSET ? injectDeferredTurn(recovered.text) :
    relativePath === DEFERRED_PRESENTATION_ASSET ? injectDeferredPresentation(recovered.text) :
    relativePath === DEFERRED_WAIT_RENDERER_ASSET ? injectDeferredWaitRenderer(recovered.text) :
    relativePath === DEFERRED_THREAD_ASSET ? injectDeferredThread(recovered.text) :
    relativePath === DEFERRED_TURN_ASSET ? injectDeferredTurnView(recovered.text) :
    relativePath === DEFERRED_COLLAPSED_ASSET ? injectDeferredCollapsed(recovered.text) : { text: recovered.text, count: 0 };
  const compactionProgress = relativePath === COMPACTION_PROGRESS_REDUCER_ASSET ?
    injectCompactionProgress(deferred.text) : { text: deferred.text, count: 0 };
  const queueRefresh = relativePath === QUEUE_REFRESH_ASSET ?
    injectQueueRefresh(compactionProgress.text) : { text: compactionProgress.text, count: 0 };
  const queuedCompaction = relativePath === QUEUED_COMPACTION_CORE_ASSET ? injectQueuedCompactionCore(queueRefresh.text) :
    relativePath === QUEUED_COMPACTION_PRESENTATION_ASSET ? injectQueuedCompactionPresentation(queueRefresh.text) :
      relativePath === QUEUED_COMPACTION_LIST_ASSET ? injectQueuedCompactionList(queueRefresh.text) : { text: queueRefresh.text, count: 0 };
  const queueConsumption = relativePath === QUEUE_CONSUMPTION_ASSET ? injectQueueConsumption(queuedCompaction.text) : { text: queuedCompaction.text, count: 0 };
  const accountQueue = injectAccountSwitchQueue(queueConsumption.text, relativePath);
  const providerPicker = injectProviderModelPicker(accountQueue.text, relativePath);
  const maxReasoning = injectMaxReasoning(providerPicker.text, relativePath);
  const threadBranch = injectThreadBranch(maxReasoning.text, relativePath);
  const paginatedHistory = injectPaginatedHistory(threadBranch.text, relativePath);
  const recentChatFilter = injectRecentChatFilter(paginatedHistory.text, relativePath);
  const immediateStop = injectImmediateStop(recentChatFilter.text, relativePath);
  const urlSafety = isHostBundle ? injectUrlSafetyTransport(immediateStop.text) : { text: immediateStop.text, count: 0 };
  const computerUse = isHostBundle ? injectComputerUse(urlSafety.text) : { text: urlSafety.text, count: 0 };
  const computerUseSettings = injectComputerUseSettings(computerUse.text, relativePath);
  const computerUseCancelRequest = injectComputerUseCancelRequest(computerUseSettings.text, relativePath);
  const computerUseManagement = injectComputerUseManagement(computerUseCancelRequest.text, relativePath);
  const windowControl = injectWindowControl(computerUseManagement.text, relativePath, ts);
  const fileOpenMenu = injectFileOpenMenu(windowControl.text, relativePath);
  const imageFileOpen = isHostBundle ? injectImageFileOpen(fileOpenMenu.text) : { text: fileOpenMenu.text, count: 0 };
  const localFileDrop = injectLocalFileDrop(imageFileOpen.text, relativePath);
  const composerDraft = relativePath === COMPOSER_DRAFT_ASSET ? injectComposerDraft(localFileDrop.text) : { text: localFileDrop.text, count: 0 };
  const providerContext = runProviderContext(composerDraft.text, relativePath,
    [CONTEXT_ASSET, SETTINGS_ASSET].includes(relativePath) ? injectProviderContextControls : undefined);
  const uiCleanup = injectUiCleanup(providerContext.text, relativePath, ts);
  const petsCleanup = injectPetsCleanup(uiCleanup.text, relativePath, ts);
  const contentFonts = injectContentFonts(petsCleanup.text, relativePath, ts);
  const uiInputDiagnostics = injectUiInputDiagnostics(contentFonts.text, relativePath, ts);
  const sessionLinks = injectSessionLinks(uiInputDiagnostics.text, relativePath);
  if (namespaced.count || accountSettings.count || instructionSettings.count || studentDesign.count || filtered.count || fetchResponse.count || recovered.count || deferred.count || compactionProgress.count || queueRefresh.count || queuedCompaction.count || queueConsumption.count || accountQueue.count || providerPicker.count || maxReasoning.count || threadBranch.count || paginatedHistory.count || recentChatFilter.count || immediateStop.count || urlSafety.count || computerUse.count || computerUseSettings.count || computerUseCancelRequest.count || computerUseManagement.count || windowControl.count || fileOpenMenu.count || imageFileOpen.count || localFileDrop.count || composerDraft.count || providerContext.count || uiCleanup.count || petsCleanup.count || contentFonts.count || uiInputDiagnostics.count || sessionLinks.count) {
    return { text: sessionLinks.text, asset: {
      path: relativePath,
      edits: namespaced.count + accountSettings.count + instructionSettings.count + studentDesign.count + filtered.count + fetchResponse.count + recovered.count + deferred.count + compactionProgress.count + queueRefresh.count + queuedCompaction.count + queueConsumption.count + accountQueue.count + providerPicker.count + maxReasoning.count + threadBranch.count + paginatedHistory.count + recentChatFilter.count + immediateStop.count + urlSafety.count + computerUse.count + computerUseSettings.count + computerUseCancelRequest.count + computerUseManagement.count + windowControl.count + fileOpenMenu.count + imageFileOpen.count + localFileDrop.count + composerDraft.count + providerContext.count + uiCleanup.count + petsCleanup.count + contentFonts.count + uiInputDiagnostics.count + sessionLinks.count,
      accountSettingsEdits: accountSettings.count,
      instructionSettingsEdits: instructionSettings.count,
      studentDesignEdits: studentDesign.count,
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
      maxReasoningEdits: maxReasoning.count,
      threadBranchEdits: threadBranch.count,
      paginatedHistoryEdits: paginatedHistory.count,
      recentChatFilterEdits: recentChatFilter.count,
      immediateStopEdits: immediateStop.count,
      queuedCompactionEdits: queuedCompaction.count,
      queueConsumptionEdits: queueConsumption.count,
      accountSwitchQueueEdits: accountQueue.count,
      urlSafetyTransportEdits: urlSafety.count,
      computerUseApprovalEdits: computerUse.count,
      computerUseSettingsEdits: computerUseSettings.count,
      computerUseCancelRequestEdits: computerUseCancelRequest.count,
      computerUseManagementEdits: computerUseManagement.count,
      windowControlEdits: windowControl.count,
      imageFileOpenEdits: imageFileOpen.count,
      fileOpenMenuEdits: fileOpenMenu.count,
      localFileDropEdits: localFileDrop.count,
      composerDraftEdits: composerDraft.count,
      providerContextEdits: providerContext.count,
      uiCleanupEdits: uiCleanup.count,
      petsCleanupEdits: petsCleanup.count,
      contentFontEdits: contentFonts.count,
      uiInputDiagnosticsEdits: uiInputDiagnostics.count,
      sessionLinkEdits: sessionLinks.count,
      sourceSha256: sha(source),
      sha256: sha(sessionLinks.text),
    } };
  }
  return { text: sessionLinks.text, asset: null };
}

function getTransformRules() {
  const transformSources = [
    "inject-window-control.cjs", "window-control-host.cjs", "window-control-backend.cjs", "window-control-policy.cjs", "window-control-occupancy.cjs", "window-task-macros.cjs",
    "namespace-azrael-host.cjs", "asset-transform-cache.cjs", "ordered-asset-reader.cjs", "inject-recovery.cjs", "inject-fetch-response.cjs", "inject-url-safety-transport.cjs", "inject-computer-use.cjs", "computer-use-approvals.cjs", "inject-image-file-open.cjs", "inject-file-open-menu.cjs", "pdf-file-open.cjs", "inject-local-file-drop.cjs", "inject-composer-draft.cjs",
    "inject-deferred-turn.cjs", "root-resume-wait.cjs", "inject-compaction-progress.cjs", "inject-queue-refresh.cjs",
    "inject-ui-input-diagnostics.cjs", "ui-input-diagnostics-runtime.cjs",
    "inject-queue-consumption.cjs", "inject-queued-compaction.cjs", "inject-account-switch-queue.cjs",
    "inject-provider-model-picker.cjs", "provider-model-picker.cjs", "inject-account-settings.cjs", "inject-instruction-settings.cjs",
    "inject-max-reasoning.cjs", "feature-preservation.cjs", "azrael-feature-contracts.json",
    "inject-student-design.cjs", "student-avatar-assets.cjs",
    "inject-provider-context.cjs", "provider-context-labels.cjs", "inject-ui-cleanup.cjs", "inject-pets-cleanup.cjs",
    "inject-content-fonts.cjs", "content-fonts.cjs",
    "inject-thread-branch.cjs", "thread-branch.cjs",
    "inject-session-links.cjs", "session-links.cjs",
    "inject-recent-chat-filter.cjs", "inject-paginated-history.cjs", "inject-immediate-stop.cjs", "immediate-stop.cjs",
  ];
  return { ...Object.fromEntries(transformSources.map((name) =>
    [name, sha(fs.readFileSync(path.join(__dirname, name)))])), ...getContentFontRules() };
}

// Only closed path gates from transformAsset or the injector owners belong here.
// Unlisted rules (including generic label transforms and helper dependencies)
// remain shared. The namespace/cache implementations also invalidate every asset.
const ASSET_RULE_PATHS = {
  "inject-student-design.cjs": DESIGN_ASSETS,
  "inject-session-links.cjs": SESSION_LINK_ASSETS,
  "session-links.cjs": ["out/extension.js"],
  "inject-window-control.cjs": ["out/extension.js", WINDOW_CONTROL_SETTINGS_ASSET],
  "window-control-host.cjs": ["out/extension.js"],
  "window-control-backend.cjs": ["out/extension.js"],
  "window-control-policy.cjs": ["out/extension.js"],
  "window-control-occupancy.cjs": ["out/extension.js"],
  "window-task-macros.cjs": ["out/extension.js"],
  "inject-recovery.cjs": ["out/extension.js"],
  "inject-fetch-response.cjs": ["out/extension.js"],
  "inject-url-safety-transport.cjs": ["out/extension.js"],
  "inject-image-file-open.cjs": ["out/extension.js"],
  "inject-file-open-menu.cjs": [FILE_OPEN_MENU_ASSET],
  "inject-local-file-drop.cjs": [DROP_ASSET, COMPOSER_ASSET],
  "inject-composer-draft.cjs": [COMPOSER_DRAFT_ASSET],
  "inject-ui-cleanup.cjs": UI_CLEANUP_ASSETS,
  "inject-pets-cleanup.cjs": PETS_CLEANUP_ASSETS,
  "inject-content-fonts.cjs": CONTENT_FONT_ASSETS,
  "content-fonts.cjs": [CONTENT_FONT_CSS_ASSET],
  ...Object.fromEntries(Object.keys(getContentFontRules()).map(name => [name, [CONTENT_FONT_CSS_ASSET]])),
  "inject-deferred-turn.cjs": ["out/extension.js", DEFERRED_REDUCER_ASSET, DEFERRED_PRESENTATION_ASSET,
    DEFERRED_WAIT_RENDERER_ASSET, DEFERRED_THREAD_ASSET, DEFERRED_TURN_ASSET, DEFERRED_COLLAPSED_ASSET],
  "inject-compaction-progress.cjs": [COMPACTION_PROGRESS_REDUCER_ASSET],
  "inject-queue-refresh.cjs": [QUEUE_REFRESH_ASSET],
  "inject-queue-consumption.cjs": [QUEUE_CONSUMPTION_ASSET],
  "inject-ui-input-diagnostics.cjs": [QUEUE_CONSUMPTION_ASSET, COMPOSER_DRAFT_ASSET, "webview/assets/app-initial-5120fa5fe295.js"],
  "ui-input-diagnostics-runtime.cjs": [QUEUE_CONSUMPTION_ASSET, COMPOSER_DRAFT_ASSET, "webview/assets/app-initial-5120fa5fe295.js"],
  "inject-queued-compaction.cjs": [QUEUED_COMPACTION_CORE_ASSET, QUEUED_COMPACTION_PRESENTATION_ASSET, QUEUED_COMPACTION_LIST_ASSET],
  "inject-account-switch-queue.cjs": [ACCOUNT_QUEUE_CORE_ASSET, ACCOUNT_QUEUE_PRESENTATION_ASSET, ACCOUNT_QUEUE_LIST_ASSET],
  "inject-provider-model-picker.cjs": PROVIDER_PICKER_ASSETS,
  "inject-max-reasoning.cjs": MAX_REASONING_ASSETS,
  "inject-account-settings.cjs": ["out/extension.js", ACCOUNT_SETTINGS_ASSET],
  "inject-instruction-settings.cjs": ["out/extension.js", ...INSTRUCTION_SETTINGS_ASSETS],
  "inject-provider-context.cjs": [CONTEXT_ASSET, SETTINGS_ASSET],
  "inject-thread-branch.cjs": [THREAD_BRANCH_ASSET],
  "inject-recent-chat-filter.cjs": [RECENT_CHAT_FILTER_ASSET],
  "inject-paginated-history.cjs": [PAGINATED_HISTORY_ASSET],
  "inject-immediate-stop.cjs": [IMMEDIATE_STOP_ASSET],
};

function getAssetTransformRules(relativePath, transformRules = getTransformRules()) {
  return Object.fromEntries(Object.entries(transformRules)
    .filter(([name]) => !Object.hasOwn(ASSET_RULE_PATHS, name) || ASSET_RULE_PATHS[name].includes(relativePath)));
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
  if (manifest.publisher !== "openai" || manifest.name !== "chatgpt" || manifest.version !== "26.930.61225") {
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
      packageSha256: sourceUi.sourcePackageSha256.toLowerCase(),
      webviewSha256: sourceUi.sourceWebviewSha256.toLowerCase(),
    },
    transformRules: getTransformRules(),
    assets: [],
  };
  const featureManifest = loadManifest(path.resolve(__dirname, ".."));
  validateManifest(featureManifest, path.resolve(__dirname, ".."), report.transformRules);
  const cache = createAssetTransformCache({
    cacheDirectory: options.cacheDirectory,
    typescriptSha256: options.typescriptSha256,
    typescriptVersion: ts.version,
    transformRules: report.transformRules,
    getAssetTransformRules,
    statistics: performanceReport.cache,
    metrics: stages,
    pruneUnused: true,
  });
  function* enumerate(folder) {
    for (const entry of measure("enumeration", () => fs.readdirSync(folder, { withFileTypes: true }))) {
      const filename = path.join(folder, entry.name);
      if (entry.isDirectory()) { yield* enumerate(filename); continue; }
      if (!entry.isFile() || (!filename.endsWith(".js") && path.relative(root, filename).replaceAll("\\", "/") !== CONTENT_FONT_CSS_ASSET)) continue;
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
  for (const [field, paths] of [["uiCleanupEdits", UI_CLEANUP_ASSETS], ["petsCleanupEdits", PETS_CLEANUP_ASSETS], ["contentFontEdits", CONTENT_FONT_ASSETS]]) {
    for (const assetPath of paths) {
      if (!report.assets.some(asset => asset.path === assetPath && asset[field] > 0)) {
        throw new Error(`${field} transformation was incomplete: ${assetPath}`);
      }
    }
  }
  if (report.assets.reduce((total, asset) => total + asset.providerPickerEdits, 0) !== PROVIDER_PICKER_ASSETS.length) {
    throw new Error("Provider model-picker transformation was incomplete.");
  }
  for (const assetPath of MAX_REASONING_ASSETS) {
    if (!report.assets.some(asset => asset.path === assetPath && asset.maxReasoningEdits === 1)) {
      throw new Error(`Max availability transformation was incomplete: ${assetPath}`);
    }
  }
  if (report.assets.reduce((total, asset) => total + (asset.threadBranchEdits ?? 0), 0) !== 1) {
    throw new Error("Thread branch transformation was incomplete.");
  }
  for (const field of ["paginatedHistoryEdits", "immediateStopEdits"]) {
    if (report.assets.reduce((total, asset) => total + (asset[field] ?? 0), 0) !== 1) {
      throw new Error(`${field} transformation was incomplete.`);
    }
  }
  if (report.assets.reduce((total, asset) => total + (asset.computerUseApprovalEdits ?? 0), 0) !== 7) throw new Error("Computer-use approval transformation was incomplete.");
  if (report.assets.reduce((total, asset) => total + (asset.computerUseSettingsEdits ?? 0), 0) !== 1) throw new Error("Computer-use settings transformation was incomplete.");
  if (report.assets.reduce((total, asset) => total + (asset.computerUseCancelRequestEdits ?? 0), 0) !== 1) throw new Error("Computer-use cancel-request transformation was incomplete.");
  if (report.assets.reduce((total, asset) => total + (asset.computerUseManagementEdits ?? 0), 0) !== 1) throw new Error("Computer-use local-management transformation was incomplete.");
  if (report.assets.reduce((total, asset) => total + (asset.windowControlEdits ?? 0), 0) !== 5) throw new Error("Selected-window Computer Use transformation was incomplete.");
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
  if (report.assets.reduce((total, asset) => total + (asset.composerDraftEdits ?? 0), 0) !== 1) {
    throw new Error("Composer draft transformation was incomplete.");
  }
  for (const contextAsset of [CONTEXT_ASSET, SETTINGS_ASSET]) {
    if (!report.assets.some(asset => asset.path === contextAsset && asset.providerContextEdits > 0)) throw new Error("Provider context transformation was incomplete: " + contextAsset);
  }
  if (report.assets.reduce((total, asset) => total + (asset.accountSwitchQueueEdits ?? 0), 0) !== 3) {
    throw new Error("Account-switch queue transformation was incomplete.");
  }
  if (report.assets.reduce((total, asset) => total + asset.queueConsumptionEdits, 0) !== 1) {
    throw new Error("Queue-consumption transformation was incomplete.");
  }
  for (const assetPath of [QUEUE_CONSUMPTION_ASSET, COMPOSER_DRAFT_ASSET, "webview/assets/app-initial-5120fa5fe295.js"]) {
    if (!report.assets.some(asset => asset.path === assetPath && asset.uiInputDiagnosticsEdits === 1)) {
      throw new Error("UI input diagnostics transformation was incomplete: " + assetPath);
    }
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
  if (report.assets.reduce((total, asset) => total + asset.deferredTurnEdits, 0) !== 26) {
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
  report.studentAvatars = copyStudentAvatarAssets(path.join(root, "webview"));
  report.contentFonts = copyContentFontAssets(root);
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
  validateTransformReport(featureManifest, report);
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
  getAssetTransformRules,
  ASSET_RULE_PATHS,
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

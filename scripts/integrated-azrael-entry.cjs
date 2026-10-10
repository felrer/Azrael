"use strict";

const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const vscode = require("vscode");
const nativeExtension = require("./out/extension.js");
const accountUi = require("./account-ui/dist/src/extension.js");
const { runtime } = require("./out/azrael-runtime.cjs");
const recovery = require("./out/azrael-recovery.cjs");
const { validateRuntimePlatform } = require("./out/platform-runtime.cjs");

let nativeActivated = false;
let accountUiActivationAttempted = false;
let fallbackWindowSessionId;
let recoveryActivation;
let windowControlActivation;

function fileSystemPath(uri, owner) {
  // Local desktop VS Code routes vscode-userdata to its file provider without
  // changing the path. Remote or authority-bearing providers are not this contract.
  const localUserData = uri?.scheme === "vscode-userdata" && uri.authority === "" &&
    !vscode.env.remoteName;
  if (!uri || (uri.scheme !== "file" && !localUserData)) {
    throw new Error(`${owner} must be an absolute file URI.`);
  }
  if (typeof uri.fsPath !== "string" || !path.isAbsolute(uri.fsPath)) {
    throw new Error(`${owner} must resolve to an absolute file-system path.`);
  }
  return uri.fsPath;
}

function accountStateFiles(context) {
  const vscodeSessionId = vscode.env.sessionId;
  const windowSessionId = typeof vscodeSessionId === "string" && vscodeSessionId.length > 0
    ? createHash("sha256").update(vscodeSessionId, "utf8").digest("hex")
    : (fallbackWindowSessionId ??= randomUUID());
  if (context.storageUri) {
    const storagePath = fileSystemPath(context.storageUri, "Extension workspace storage");
    return {
      sessionFile: path.join(storagePath, "window", windowSessionId, "azrael-account-state.json"),
      defaultFile: path.join(storagePath, "default", "azrael-account-state.json"),
      previousSessionRoot: path.join(storagePath, "window"),
    };
  }
  const globalStoragePath = fileSystemPath(context.globalStorageUri, "Extension global storage");
  return {
    sessionFile: path.join(globalStoragePath, "empty-window", windowSessionId, "azrael-account-state.json"),
    defaultFile: path.join(globalStoragePath, "empty-window-default", "azrael-account-state.json"),
    previousSessionRoot: path.join(globalStoragePath, "empty-window"),
  };
}

function sanitizedAccountState(text) {
  let state;
  try {
    state = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!state || typeof state !== "object" || Array.isArray(state)) return undefined;
  const { selectedProfileId } = state;
  if (selectedProfileId !== null &&
      (typeof selectedProfileId !== "string" || !/^[0-9a-f]{32}$/.test(selectedProfileId))) {
    return undefined;
  }
  return { selectedProfileId };
}

async function migrateAccountDefault(defaultFile, previousSessionRoot) {
  try {
    await fs.access(defaultFile);
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") return;
  }

  let sessionDirectories;
  try {
    sessionDirectories = await fs.readdir(previousSessionRoot, { withFileTypes: true });
  } catch {
    return;
  }

  const candidates = [];
  await Promise.all(sessionDirectories.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const candidateFile = path.join(previousSessionRoot, entry.name, "azrael-account-state.json");
    try {
      const stat = await fs.stat(candidateFile);
      if (stat.isFile()) candidates.push({ candidateFile, modified: stat.mtimeMs });
    } catch {
      // A missing or unreadable old session is not eligible for migration.
    }
  }));
  candidates.sort((left, right) => right.modified - left.modified);

  let migratedState;
  for (const { candidateFile } of candidates) {
    try {
      migratedState = sanitizedAccountState(await fs.readFile(candidateFile, "utf8"));
    } catch {
      continue;
    }
    if (migratedState) break;
  }
  if (!migratedState) return;

  await fs.mkdir(path.dirname(defaultFile), { recursive: true });
  let handle;
  try {
    handle = await fs.open(defaultFile, "wx");
    await handle.writeFile(`${JSON.stringify(migratedState)}\n`, "utf8");
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  } finally {
    await handle?.close();
  }
}

exports.activate = async function activate(context) {
  const stateFiles = accountStateFiles(context);
  runtime.env.AZRAEL_EX_ACCOUNT_STATE_FILE = stateFiles.sessionFile;
  runtime.env.AZRAEL_EX_ACCOUNT_DEFAULT_FILE = stateFiles.defaultFile;
  await migrateAccountDefault(stateFiles.defaultFile, stateFiles.previousSessionRoot);
  recoveryActivation = recovery.initialize(context, vscode);
  try {
    const platform = validateRuntimePlatform(runtime.platform);
    if (platform.desktopControl && runtime.windowControl) {
      windowControlActivation = require("./out/window-control-host.cjs").initialize(context, vscode, runtime);
    }
    const nativeApi = await nativeExtension.activate(context);
    nativeActivated = true;
    accountUiActivationAttempted = true;
    await accountUi.activate(context, runtime);
    return nativeApi;
  } catch (error) {
    try { await deactivate(); } catch { /* Preserve the activation failure. */ }
    throw error;
  }
};

async function deactivate() {
  await windowControlActivation?.dispose();
  windowControlActivation = undefined;
  recoveryActivation?.dispose();
  recoveryActivation = undefined;
  const deactivations = [];
  if (accountUiActivationAttempted && typeof accountUi.deactivate === "function") {
    deactivations.push(Promise.resolve().then(() => accountUi.deactivate()));
  }
  if (nativeActivated && typeof nativeExtension.deactivate === "function") {
    deactivations.push(Promise.resolve().then(() => nativeExtension.deactivate()));
  }
  accountUiActivationAttempted = false;
  nativeActivated = false;
  const failures = (await Promise.allSettled(deactivations))
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Azrael extension deactivation failed.");
}

exports.deactivate = deactivate;

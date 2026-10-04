const vscode = require("vscode");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");

const OFFICIAL_ID = "openai.chatgpt";
const COMPANION_ID = "azrael-ex-local.azrael-ex";
const OFFICIAL_VERSION = "26.908.40401";
const SERVER_VERSION = "0.154.0-alpha.6.2";
const ACCOUNT_METHOD = "azrael/account";
const ACCOUNT_COMMANDS = [
  "azrael-ex.devinAccount",
  "azrael-ex.manageAccounts",
  "azrael-ex.accountQuickPick",
  "azrael-ex.refreshAccounts",
  "azrael-ex.openCodex",
  "azrael-ex.openCodexSettings",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function samePath(left, right) {
  const a = path.resolve(left).replace(/[\\/]+$/, "").toLowerCase();
  const b = path.resolve(right).replace(/[\\/]+$/, "").toLowerCase();
  return a === b;
}

async function waitFor(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${description} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

function bridgeSession(executable, socket) {
  const child = spawn(executable, [socket], {
    env: process.env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  let stderr = "";
  let nextId = 1;
  let connected;
  const pending = new Map();

  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`bridge connection timed out: ${stderr}`)), 15_000);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!connected) reject(new Error(`bridge exited ${code}: ${stderr}`));
    });
    lines.on("line", (line) => {
      let message;
      try { message = JSON.parse(line); } catch { reject(new Error("bridge emitted invalid JSON")); return; }
      if (message.method === "azrael/connected") {
        connected = message.params;
        clearTimeout(timer);
        resolve(connected);
        return;
      }
      if (typeof message.id !== "number") return;
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message || "bridge request failed"));
      else request.resolve(message.result);
    });
  });

  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("bridge request timed out"));
      }, 20_000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (error) reject(error);
      });
    });
  }

  function dispose() {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("bridge disposed"));
    }
    pending.clear();
    lines.close();
    child.stdin.end();
    if (!child.killed) child.kill();
  }

  return { ready, request, dispose };
}

async function connectBridge() {
  const executable = process.env.AZRAEL_BRIDGE_BIN;
  const socket = process.env.AZRAEL_EX_MANAGEMENT_SOCKET;
  assert(executable && path.isAbsolute(executable), "AZRAEL_BRIDGE_BIN is not absolute");
  assert(socket && path.isAbsolute(socket), "AZRAEL_EX_MANAGEMENT_SOCKET is not absolute");
  return waitFor(async () => {
    const session = bridgeSession(executable, socket);
    try {
      const connected = await session.ready;
      return { session, connected };
    } catch (error) {
      session.dispose();
      throw error;
    }
  }, 45_000, "management bridge connection");
}

function accountState(response) {
  assert(response && typeof response === "object" && response.state && typeof response.state === "object", "account list returned no state");
  return response.state;
}

exports.run = async function run() {
  const resultPath = process.env.AZRAEL_HOST_RESULT;
  const codexHome = process.env.CODEX_HOME;
  const expectedEngine = process.env.AZRAEL_EXPECTED_ENGINE;
  assert(resultPath && path.isAbsolute(resultPath), "AZRAEL_HOST_RESULT is not absolute");
  let result;
  try {
    assert(codexHome && path.isAbsolute(codexHome), "CODEX_HOME is not absolute");
    assert(expectedEngine && path.isAbsolute(expectedEngine), "AZRAEL_EXPECTED_ENGINE is not absolute");
    assert(vscode.env.remoteName === undefined, `host unexpectedly ran remotely: ${vscode.env.remoteName}`);

    const official = vscode.extensions.getExtension(OFFICIAL_ID);
    const companion = vscode.extensions.getExtension(COMPANION_ID);
    assert(official, "pinned official extension was not discovered");
    assert(companion, "installed companion extension was not discovered");
    assert(official.extensionUri.scheme === "file", "official extension is not local");
    assert(companion.extensionUri.scheme === "file", "companion extension is not local");
    const localExtensionKinds = new Set([vscode.ExtensionKind.UI, vscode.ExtensionKind.Workspace]);
    assert(localExtensionKinds.has(official.extensionKind), `official extensionKind was unsupported: ${official.extensionKind}`);
    assert(localExtensionKinds.has(companion.extensionKind), `companion extensionKind was unsupported: ${companion.extensionKind}`);
    assert(official.packageJSON.version === OFFICIAL_VERSION, `official version was ${official.packageJSON.version}`);

    const manifest = official.packageJSON;
    const labels = [
      manifest.contributes?.viewsContainers?.activitybar?.[0]?.title,
      manifest.contributes?.viewsContainers?.secondarySidebar?.[0]?.title,
      manifest.contributes?.views?.codexViewContainer?.[0]?.name,
      manifest.contributes?.views?.codexSecondaryViewContainer?.[0]?.name,
    ];
    assert(labels.length === 4 && labels.every((label) => label === "azrael"), `official manifest labels were ${JSON.stringify(labels)}`);

    await official.activate();
    await companion.activate();
    assert(official.isActive, "official extension did not activate");
    assert(companion.isActive, "companion extension did not activate");
    const registered = new Set(await vscode.commands.getCommands(true));
    const contributedCommands = (companion.packageJSON.contributes?.commands || [])
      .map((entry) => entry?.command)
      .filter((command) => typeof command === "string" && command.startsWith("azrael-ex."));
    for (const command of ACCOUNT_COMMANDS) assert(contributedCommands.includes(command), `companion manifest omitted required command: ${command}`);
    for (const command of contributedCommands) assert(registered.has(command), `companion command was not registered: ${command}`);
    assert(registered.has("chatgpt.openSidebar"), "official sidebar command was not registered");
    assert(samePath(vscode.workspace.getConfiguration("chatgpt").get("cliExecutable"), expectedEngine), "official host engine override did not match the built engine");

    await vscode.commands.executeCommand("azrael-ex.openCodex");
    await vscode.commands.executeCommand("chatgpt.openSidebar");
    await vscode.commands.executeCommand("azrael-ex.manageAccounts");
    const findAccountsTab = () => {
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          if (tab.input instanceof vscode.TabInputWebview && tab.label === "azrael-ex OpenAI Accounts") return tab;
        }
      }
      return undefined;
    };
    let accountsTab;
    try {
      accountsTab = await waitFor(findAccountsTab, 30_000, "accounts Webview tab");
    } catch (error) {
      const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs.map((tab) => ({
        label: tab.label,
        input: tab.input?.constructor?.name,
        viewType: tab.input instanceof vscode.TabInputWebview ? tab.input.viewType : undefined,
      })));
      throw new Error(`${error instanceof Error ? error.message : String(error)}; open tabs: ${JSON.stringify(tabs)}`);
    }
    assert(accountsTab.input.viewType.endsWith("azrael-ex.accounts"), `accounts Webview viewType was ${JSON.stringify(accountsTab.input.viewType)}`);

    const { session, connected } = await connectBridge();
    let firstState;
    let secondState;
    try {
      firstState = accountState(await session.request(ACCOUNT_METHOD, { action: "list" }));
      secondState = accountState(await session.request(ACCOUNT_METHOD, { action: "list" }));
    } finally {
      session.dispose();
    }
    assert(samePath(connected.codexHome, codexHome), "bridge and host CODEX_HOME differ");
    assert(connected.serverVersion === SERVER_VERSION, `bridge server version was ${connected.serverVersion}`);
    assert(samePath(firstState.codexHome, codexHome) && samePath(secondState.codexHome, codexHome), "account state and host CODEX_HOME differ");
    assert(typeof firstState.instanceId === "string" && firstState.instanceId.length > 0, "account state has no instance ID");
    assert(secondState.instanceId === firstState.instanceId, "successive account lists came from different engine instances");
    assert(firstState.currentAccount === null && firstState.activeProfileId === null && firstState.profiles.length === 0, "fresh fixture was not logged out");
    assert(firstState.loginPending === false, "fresh fixture unexpectedly had a pending login");

    result = {
      passed: true,
      official: { id: OFFICIAL_ID, version: official.packageJSON.version, active: official.isActive, local: true, extensionKind: official.extensionKind, labels },
      companion: { id: COMPANION_ID, version: companion.packageJSON.version, active: companion.isActive, local: true, extensionKind: companion.extensionKind, commands: contributedCommands },
      nativeSidebarCommand: true,
      accountsWebview: { viewType: accountsTab.input.viewType, label: accountsTab.label },
      engine: { codexHome, serverVersion: connected.serverVersion, instanceId: firstState.instanceId, loggedOut: true },
      loginPerformed: false,
      modelRequestPerformed: false,
    };
    await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  } catch (error) {
    result = { passed: false, error: error instanceof Error ? error.message : String(error), loginPerformed: false, modelRequestPerformed: false };
    if (resultPath) await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    throw error;
  }
};

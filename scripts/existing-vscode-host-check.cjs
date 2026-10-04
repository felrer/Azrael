const vscode = require("vscode");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");

const OFFICIAL_ID = "openai.chatgpt";
const COMPANION_ID = "azrael-ex-local.azrael-ex";
const OFFICIAL_VERSION = "26.908.40401";
const REQUIRED_COMMANDS = [
  "azrael-ex.usage",
  "azrael-ex.manageAccounts",
  "azrael-ex.accountQuickPick",
  "azrael-ex.refreshAccounts",
  "azrael-ex.openCodex",
  "azrael-ex.openCodexSettings",
];

function assert(value, message) { if (!value) throw new Error(message); }
function samePath(a, b) { return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase(); }
async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} timed out`);
}

function bridgeSession(executable, socket, env) {
  const child = spawn(executable, [socket], { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let stderr = "";
  let nextId = 1;
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`bridge connection timed out: ${stderr}`)), 20_000);
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`bridge exited ${code}: ${stderr}`)));
    lines.on("line", (line) => {
      let message;
      try { message = JSON.parse(line); } catch { reject(new Error(`bridge emitted invalid JSON: ${line}`)); return; }
      if (message.method === "azrael/connected") { clearTimeout(timer); resolve(message.params); return; }
      if (typeof message.id !== "number" || !pending.has(message.id)) return;
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message || "bridge request failed"));
      else request.resolve(message.result);
    });
  });
  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("bridge request timed out")); }, 20_000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }
  function dispose() { lines.close(); child.stdin.end(); if (!child.killed) child.kill(); }
  return { ready, request, dispose };
}

function findWebview(label, suffix) {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputWebview && tab.label === label && tab.input.viewType.endsWith(suffix)) return tab;
    }
  }
}

exports.run = async function run() {
  const root = process.env.ORDINARY_VSCODE_CHECK_ROOT;
  assert(root && path.isAbsolute(root), "ORDINARY_VSCODE_CHECK_ROOT is missing");
  const resultPath = path.join(root, "host-result.json");
  const diagnostics = {};
  let result;
  try {
    for (const key of Object.keys(process.env)) {
      assert(key !== "CODEX_HOME" && !key.startsWith("AZRAEL_"), `ordinary host inherited forbidden environment variable ${key}`);
    }
    assert(vscode.env.remoteName === undefined, `host unexpectedly ran remotely: ${vscode.env.remoteName}`);
    const official = vscode.extensions.getExtension(OFFICIAL_ID);
    const companion = vscode.extensions.getExtension(COMPANION_ID);
    assert(official && companion, "installed official and companion extensions were not both discovered");
    assert(official.packageJSON.version === OFFICIAL_VERSION, `official version was ${official.packageJSON.version}`);
    const runtimePath = path.join(official.extensionPath, "out", "azrael-runtime.cjs");
    const configPath = path.join(official.extensionPath, "out", "azrael-runtime.json");
    diagnostics.officialExtensionPath = official.extensionPath;
    diagnostics.runtimeConfigPath = configPath;
    const config = JSON.parse(await fs.readFile(configPath, "utf8"));

    await official.activate();
    await companion.activate();
    const runtime = require(runtimePath).runtime;
    diagnostics.testRuntimeSocket = runtime.socket;
    diagnostics.runtimeModuleCache = Object.entries(require.cache)
      .filter(([key, module]) => key.toLowerCase().endsWith("azrael-runtime.cjs") && module?.exports?.runtime)
      .map(([key, module]) => ({ key, socket: module.exports.runtime.socket, sameAsTestRuntime: module.exports.runtime === runtime }));
    assert(require(runtimePath).runtime === runtime, "installed extensions did not share one cached runtime module");
    assert(samePath(runtime.engine, config.engine) && samePath(runtime.bridge, config.bridge), "runtime engine pair differs from its deployment config");
    assert(samePath(runtime.codexHome, config.codexHome), "runtime state root differs from its deployment config");
    assert(process.env.CODEX_HOME === undefined && process.env.AZRAEL_EX_MANAGEMENT_SOCKET === undefined, "runtime mutated process.env");
    const commands = new Set(await vscode.commands.getCommands(true));
    for (const command of REQUIRED_COMMANDS) assert(commands.has(command), `required command was not registered: ${command}`);
    assert(commands.has("chatgpt.openSidebar"), "official sidebar command was not registered");

    await vscode.commands.executeCommand("azrael-ex.manageAccounts");
    const accounts = await waitFor(() => findWebview("azrael-ex OpenAI Accounts", "azrael-ex.accounts"), 30_000, "accounts Webview");
    await vscode.commands.executeCommand("azrael-ex.usage");
    const usage = await waitFor(() => findWebview("사용량", "azrael-ex.usage"), 30_000, "usage Webview");

    await waitFor(async () => {
      try { await fs.access(runtime.socket); return true; } catch { return false; }
    }, 30_000, "management socket");
    const bridge = bridgeSession(runtime.bridge, runtime.socket, runtime.env);
    let connected;
    let state;
    try {
      connected = await bridge.ready;
      const response = await bridge.request("azrael/account", { action: "list" });
      state = response?.state;
    } finally { bridge.dispose(); }
    assert(connected && samePath(connected.codexHome, runtime.codexHome), "bridge did not connect to the ordinary runtime state root");
    assert(state && samePath(state.codexHome, runtime.codexHome), "account command used a different engine state root");
    assert(typeof state.instanceId === "string" && state.instanceId.length > 0, "engine returned no instance ID");

    result = {
      passed: true,
      inheritedLauncherEnvironment: false,
      runtimeProcessEnvironmentMutated: false,
      official: { version: official.packageJSON.version, active: official.isActive },
      companion: { version: companion.packageJSON.version, active: companion.isActive, commands: REQUIRED_COMMANDS },
      webviews: { accounts: accounts.input.viewType, usage: usage.input.viewType },
      engine: { path: runtime.engine, bridge: runtime.bridge, codexHome: runtime.codexHome, instanceId: state.instanceId },
      loginPerformed: false,
      modelRequestPerformed: false,
    };
    await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  } catch (error) {
    result = { passed: false, error: error instanceof Error ? error.stack || error.message : String(error), diagnostics, loginPerformed: false, modelRequestPerformed: false };
    await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    throw error;
  }
};

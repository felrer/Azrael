"use strict";

const vscode = require("vscode");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { createInterface } = require("node:readline");

const ORIGINAL_ID = "openai.chatgpt";
const HOST_ID = "azrael-ex-local.azrael";
const COMPANION_ID = "azrael-ex-local.azrael-ex";
const ACCOUNT_COMMANDS = [
  "azrael.usage",
  "azrael.rootResume",
  "azrael.devinAccount",
  "azrael.manageAccounts",
  "azrael.accountQuickPick",
  "azrael.refreshAccounts",
  "azrael.openCodex",
  "azrael.openCodexSettings",
];

function assert(value, message) { if (!value) throw new Error(message); }
function samePath(a, b) { return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase(); }
function extensionHostModulePath(value) {
  if (process.platform !== "win32") return value;
  return value.replace(/^([A-Z]):/, (match, drive) => `${drive.toLowerCase()}:`);
}
async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
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
  function dispose() {
    for (const pendingRequest of pending.values()) {
      clearTimeout(pendingRequest.timer);
      pendingRequest.reject(new Error("bridge disposed"));
    }
    pending.clear();
    lines.close();
    child.stdin.end();
    if (!child.killed) child.kill();
  }
  return { ready, request, dispose };
}

function contributionIds(manifest) {
  const containers = manifest.contributes?.viewsContainers ?? {};
  const views = manifest.contributes?.views ?? {};
  return {
    commands: (manifest.contributes?.commands ?? []).map((entry) => entry.command),
    configuration: Object.keys(manifest.contributes?.configuration?.properties ?? {}),
    views: [
      ...Object.values(containers).flat().map((entry) => entry.id),
      ...Object.keys(views),
      ...Object.values(views).flat().map((entry) => entry.id),
    ],
    customEditors: (manifest.contributes?.customEditors ?? []).map((entry) => entry.viewType),
  };
}

function findWebview(label, suffix) {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputWebview && tab.label === label && tab.input.viewType.endsWith(suffix)) return tab;
    }
  }
}

function observeEmbeddedStartupConnect(accountServiceModulePath) {
  const { AccountService } = require(accountServiceModulePath);
  assert(typeof AccountService === "function", "embedded AccountService export was unavailable");
  const originalConnect = AccountService.prototype.connect;
  const instances = new Map();
  const observedPromises = new WeakSet();
  const outcomes = [];
  const errorStateEvents = [];
  let calls = 0;
  let uniquePromiseCount = 0;
  const instanceRecord = (instance) => {
    let record = instances.get(instance);
    if (!record) {
      record = { id: instances.size + 1, errorListener: (error) => errorStateEvents.push(String(error)) };
      instances.set(instance, record);
      instance.on("errorState", record.errorListener);
    }
    return record;
  };
  AccountService.prototype.connect = function observedConnect(...args) {
    calls += 1;
    const record = instanceRecord(this);
    const promise = originalConnect.apply(this, args);
    if (!observedPromises.has(promise)) {
      observedPromises.add(promise);
      uniquePromiseCount += 1;
      promise.then(
        () => outcomes.push({ instanceId: record.id, status: "fulfilled", changesEnabled: this.changesEnabled, error: this.error }),
        (error) => outcomes.push({ instanceId: record.id, status: "rejected", changesEnabled: this.changesEnabled, error: error instanceof Error ? error.message : String(error) }),
      );
    }
    return promise;
  };
  return {
    snapshot: () => ({
      calls,
      instanceCount: instances.size,
      uniquePromiseCount,
      outcomes: outcomes.map((outcome) => ({ ...outcome })),
      errorStateEvents: [...errorStateEvents],
    }),
    hasOutcome: () => outcomes.length > 0,
    restore: () => {
      AccountService.prototype.connect = originalConnect;
      for (const [instance, record] of instances) instance.off("errorState", record.errorListener);
    },
  };
}

exports.run = async function run() {
  const root = process.env.SAME_WINDOW_CHECK_ROOT;
  assert(root && path.isAbsolute(root), "SAME_WINDOW_CHECK_ROOT is missing");
  const mode = process.env.SAME_WINDOW_CHECK_MODE;
  assert(mode === "standalone" || mode === "coexistence", "SAME_WINDOW_CHECK_MODE is invalid");
  const standalone = mode === "standalone";
  const resultPath = path.join(root, standalone ? "standalone-host-result.json" : "host-result.json");
  const expectedState = process.env.SAME_WINDOW_EXPECTED_STATE_ROOT;
  const expectedOrdinaryHome = process.env.SAME_WINDOW_EXPECTED_ORDINARY_HOME;
  const expectedHostVersion = process.env.SAME_WINDOW_EXPECTED_HOST_VERSION;
  const expectedOriginalVersion = process.env.SAME_WINDOW_EXPECTED_ORIGINAL_VERSION;
  const diagnostics = {};
  const assertFixtureEnvironment = () => {
    assert(expectedState && path.isAbsolute(expectedState), "SAME_WINDOW_EXPECTED_STATE_ROOT is missing");
    assert(expectedOrdinaryHome && path.isAbsolute(expectedOrdinaryHome), "SAME_WINDOW_EXPECTED_ORDINARY_HOME is missing");
    assert(!samePath(expectedState, expectedOrdinaryHome), "fixture ordinary and azrael state homes were not distinct");
    assert(samePath(process.env.CODEX_HOME, expectedOrdinaryHome), "extension host did not use the fixture ordinary CODEX_HOME");
    const inheritedAzrael = Object.keys(process.env).filter((key) => key.startsWith("AZRAEL_"));
    assert(inheritedAzrael.length === 0, `extension host environment contained azrael variables: ${inheritedAzrael.join(", ")}`);
  };
  try {
    assert(vscode.env.remoteName === undefined, `host unexpectedly ran remotely: ${vscode.env.remoteName}`);
    assertFixtureEnvironment();

    const original = vscode.extensions.getExtension(ORIGINAL_ID);
    const host = vscode.extensions.getExtension(HOST_ID);
    const companion = vscode.extensions.getExtension(COMPANION_ID);
    diagnostics.discoveredExtensions = vscode.extensions.all.map((extension) => extension.id).sort();
    diagnostics.expectedExtensions = { original: !!original, host: !!host, companion: !!companion };
    assert(host, "integrated azrael host was not discovered");
    if (standalone) assert(!original || !original.isActive, "disabled original extension was active in standalone mode");
    else assert(original, "original extension was not discovered in coexistence mode");
    assert(!companion, "retired companion extension was discovered");
    assert(expectedOriginalVersion && /^\d+\.\d+\.\d+$/.test(expectedOriginalVersion), "expected original version was not supplied");
    if (original) assert(original.packageJSON.version === expectedOriginalVersion, `original version was ${original.packageJSON.version}`);
    assert(expectedHostVersion && host.packageJSON.version === expectedHostVersion, `host version was ${host.packageJSON.version}`);
    if (original) assert(!samePath(original.extensionPath, host.extensionPath), "original and host resolved to one directory");
    diagnostics.paths = { original: original?.extensionPath, host: host.extensionPath };

    const accountModulePath = extensionHostModulePath(path.join(host.extensionPath, "account-ui", "dist", "src", "extension.js"));
    const accountServiceModulePath = extensionHostModulePath(path.join(host.extensionPath, "account-ui", "dist", "src", "accountService.js"));
    diagnostics.hostActiveBeforeStartupObservation = host.isActive;
    diagnostics.accountServiceObservationPath = accountServiceModulePath;
    assert(!host.isActive, "integrated host activated before startup connection observation was installed");
    const startupConnect = observeEmbeddedStartupConnect(accountServiceModulePath);
    try {
      await host.activate();
      await waitFor(() => startupConnect.hasOutcome(), 30_000, "embedded AccountService startup connection");
    } finally {
      startupConnect.restore();
    }
    const startupConnectResult = startupConnect.snapshot();
    assert(startupConnectResult.instanceCount === 1, `embedded startup used ${startupConnectResult.instanceCount} AccountService instances`);
    assert(startupConnectResult.outcomes.some((outcome) => outcome.status === "fulfilled"), "embedded startup AccountService.connect did not fulfill");
    assert(startupConnectResult.outcomes.every((outcome) => outcome.status === "fulfilled"), "embedded startup AccountService.connect rejected");
    assert(startupConnectResult.outcomes.every((outcome) => outcome.changesEnabled === true), "embedded startup account changes were not enabled");
    assert(startupConnectResult.errorStateEvents.length === 0, "embedded startup emitted a terminal account error state");
    assert(host.isActive, "integrated host did not remain active");
    assertFixtureEnvironment();
    if (standalone) assert(!original || !original.isActive, "host activation activated the disabled original extension");
    else {
      await original.activate();
      assert(original.isActive, "original extension did not remain active in coexistence mode");
      assertFixtureEnvironment();
    }

    const registered = new Set(await vscode.commands.getCommands(true));
    for (const command of ["azrael.openSidebar", ...ACCOUNT_COMMANDS]) {
      assert(registered.has(command), `required command was not registered: ${command}`);
    }
    if (!standalone) {
      assert(registered.has("chatgpt.openSidebar"), "original sidebar command was not registered");
      await vscode.commands.executeCommand("chatgpt.openSidebar");
    }
    await vscode.commands.executeCommand("azrael.openSidebar");
    await vscode.commands.executeCommand("azrael.manageAccounts");
    const accountsWebview = await waitFor(
      () => findWebview("계정 및 사용량", "azrael.accounts"), 30_000, "integrated accounts Webview");
    await vscode.commands.executeCommand("azrael.usage");
    const usageWebview = await waitFor(
      () => findWebview("계정 및 사용량", "azrael.accounts"), 30_000, "integrated usage Webview");
    assert(usageWebview.input.viewType === accountsWebview.input.viewType,
      "accounts and usage commands did not share the unified panel");
    assert(vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
      tab.input instanceof vscode.TabInputWebview && tab.input.viewType === usageWebview.input.viewType).length === 1,
      "usage command created a duplicate unified accounts panel");
    await vscode.commands.executeCommand("azrael.rootResume");
    const rootResumeWebview = await waitFor(
      () => findWebview("루트 재개 예약", "azrael.rootResume"), 30_000, "integrated root resume Webview");

    const originalIds = original ? contributionIds(original.packageJSON) : undefined;
    const hostIds = contributionIds(host.packageJSON);
    for (const kind of ["commands", "configuration", "views", "customEditors"]) {
      assert(hostIds[kind].length > 0, `host exposed no ${kind} contributions`);
      if (originalIds) assert(hostIds[kind].every((id) => !originalIds[kind].includes(id)), `host shared ${kind} contribution IDs with original`);
    }
    if (originalIds) assert(originalIds.configuration.every((id) => id.startsWith("chatgpt.")), "original configuration namespace changed");
    assert(hostIds.configuration.every((id) => id.startsWith("azrael.")), "host configuration namespace was not independent");
    assert(host.packageJSON.azraelIntegratedAccounts === true, "host manifest did not mark integrated accounts");
    assert(host.packageJSON.extensionDependencies === undefined && host.packageJSON.extensionPack === undefined,
      "host declared an original or companion extension dependency");
    assert(host.packageJSON.enabledApiProposals === undefined && host.packageJSON.contributes?.chatSessions === undefined,
      "host activated with a proposed API declaration");

    const runtimePath = path.join(host.extensionPath, "out", "azrael-runtime.cjs");
    const configPath = path.join(host.extensionPath, "out", "azrael-runtime.json");
    const runtime = require(runtimePath).runtime;
    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    assert(runtime && require(runtimePath).runtime === runtime, "host runtime was not stable in the module cache");
    assert(samePath(runtime.engine, config.engine) && samePath(runtime.bridge, config.bridge), "host runtime engine pair differed from config");
    assert(samePath(runtime.codexHome, config.codexHome), "host runtime state differed from config");
    if (expectedState) assert(samePath(runtime.codexHome, expectedState), "host runtime did not use the expected native state home");
    assert(runtime.env && samePath(runtime.env.CODEX_HOME, expectedState), "host runtime environment did not use the expected native state home");
    assert(!samePath(runtime.env.CODEX_HOME, expectedOrdinaryHome), "host runtime reused the fixture ordinary CODEX_HOME");
    if (process.platform === "win32") {
      assert(typeof runtime.env.PATH === "string" && runtime.env.PATH === process.env.PATH,
        "host runtime lost the inherited Windows PATH");
      assert(Object.keys(runtime.env).filter(key => key.toUpperCase() === "PATH").join() === "PATH",
        "host runtime contains competing Windows PATH keys");
      const shellCheck = spawnSync("powershell.exe", ["-NoProfile", "-Command", "Write-Output AZRAEL_PATH_OK"], {
        env: runtime.env, encoding: "utf8", windowsHide: true, timeout: 10000,
      });
      assert(shellCheck.status === 0 && shellCheck.stdout.trim() === "AZRAEL_PATH_OK",
        `host runtime could not execute PowerShell through inherited PATH: ${shellCheck.error?.message ?? shellCheck.status}`);
      diagnostics.runtimePathCheck = { passed: true, exitCode: shellCheck.status };
    }
    assertFixtureEnvironment();
    const runtimeModules = Object.entries(require.cache)
      .filter(([key, module]) => key.toLowerCase().endsWith("azrael-runtime.cjs") && module?.exports?.runtime)
      .map(([key, module]) => ({ key, sameRuntime: module.exports.runtime === runtime }));
    diagnostics.runtimeModules = runtimeModules;
    assert(runtimeModules.some((entry) => entry.sameRuntime && samePath(entry.key, runtimePath)) &&
      runtimeModules.every((entry) => entry.sameRuntime),
      "integrated account UI did not use the host's cached runtime instance");
    assert(!original || runtimeModules.every((entry) => !entry.key.toLowerCase().startsWith(original.extensionPath.toLowerCase() + path.sep)),
      "integrated account UI resolved a runtime below the original extension");
    assert(Object.keys(require.cache).some((key) => samePath(key, accountModulePath)),
      "host wrapper did not load the embedded account UI module");

    await waitFor(async () => {
      try { await fs.access(runtime.socket); return true; } catch { return false; }
    }, 45_000, "azrael management socket");
    const bridge = bridgeSession(runtime.bridge, runtime.socket, runtime.env);
    let connected;
    let state;
    let rootResume;
    try {
      connected = await bridge.ready;
      const response = await bridge.request("azrael/account", { action: "list" });
      state = response?.state;
      rootResume = await bridge.request("azrael/rootResume", { action: "list" });
    } finally { bridge.dispose(); }
    assert(connected && samePath(connected.codexHome, runtime.codexHome), "bridge connected to a different state home");
    assert(state && samePath(state.codexHome, runtime.codexHome), "account list used a different state home");
    assert(typeof state.instanceId === "string" && state.instanceId.length > 0, "account list returned no instance ID");
    assert(Array.isArray(state.profiles) && Number.isSafeInteger(state.profiles.length) && state.profiles.length >= 0,
      "account list returned an invalid profile collection");
    assert(Array.isArray(rootResume?.reservations), "root resume list returned an invalid reservation collection");

    const result = {
      passed: true,
      rootResume: { listVerified: true, reservationCount: rootResume.reservations.length },
      extensions: {
        original: original
          ? { id: ORIGINAL_ID, version: original.packageJSON.version, active: original.isActive, disabledForRun: standalone }
          : { id: ORIGINAL_ID, discovered: false, active: false, disabledForRun: standalone },
        host: { id: HOST_ID, version: host.packageJSON.version, active: host.isActive },
        companion: { id: COMPANION_ID, installed: false },
      },
      openSidebarCommandsCalled: standalone ? ["azrael.openSidebar"] : ["chatgpt.openSidebar", "azrael.openSidebar"],
      contributions: hostIds,
      runtime: { engine: runtime.engine, bridge: runtime.bridge, codexHome: runtime.codexHome, socket: runtime.socket, instanceId: state.instanceId },
      ordinaryCodexHome: expectedOrdinaryHome,
      integratedAccountUiUsesHostRuntime: true,
      embeddedStartupConnect: startupConnectResult,
      webviews: { accounts: accountsWebview.input.viewType, usage: usageWebview.input.viewType, rootResume: rootResumeWebview.input.viewType },
      accountCount: state.profiles.length,
      mode,
      loginPerformed: false,
      modelRequestPerformed: false,
      newThreadPerformed: false,
      testObjectMutationPerformed: false,
    };
    await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  } catch (error) {
    const result = {
      passed: false,
      error: error instanceof Error ? error.stack || error.message : String(error),
      diagnostics,
      loginPerformed: false,
      modelRequestPerformed: false,
      newThreadPerformed: false,
      testObjectMutationPerformed: false,
    };
    await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    throw error;
  }
};

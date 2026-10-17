"use strict";
// Windows can cache this file twice when VS Code supplies C: and c: paths.
// Share one rendezvous per physical runtime file within this extension host.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { validateRuntimePlatform, requireExecutable, canonicalPath } = require("./platform-runtime.cjs");
const registryKey = Symbol.for("azrael-ex.host-runtimes.v1");
const registry = globalThis[registryKey] ??= new Map();
const physicalPath = fs.realpathSync.native(__filename);
const runtimeKey = process.platform === "win32" ? physicalPath.toLowerCase() : physicalPath;
if (registry.has(runtimeKey)) {
  module.exports = registry.get(runtimeKey);
} else {
  let runtime;
  let scopedProcess;
  let initialization;
  function publish(completed) {
    const env = completed.env;
    runtime = completed;
    // Only the pinned bundle sees this environment; the host stays untouched.
    scopedProcess = new Proxy(process, {
      get(target, key) { return key === "env" ? env : Reflect.get(target, key); },
    });
    return runtime;
  }
  function ready() {
    if (runtime) return runtime;
    if (initialization) throw new Error("Azrael runtime initialization is still pending; await initialize().");
    return publish(initializeSync());
  }
  Object.defineProperties(exports, {
    runtime: { enumerable: true, get: ready },
    process: { enumerable: true, get() { ready(); return scopedProcess; } },
  });
  exports.initialize = function initialize() {
    if (initialization) return initialization;
    if (runtime) return Promise.resolve(runtime);
    const { Worker } = require("node:worker_threads");
    initialization = new Promise((resolve, reject) => {
      const worker = new Worker(`
        const { parentPort, workerData } = require("node:worker_threads");
        parentPort.postMessage(require(workerData.filename).runtime);
      `, { eval: true, workerData: { filename: physicalPath } });
      let completed;
      let received = false;
      let failure;
      worker.on("message", value => { completed = value; received = true; });
      worker.on("error", error => { failure = error; });
      worker.once("exit", code => {
        if (failure) reject(failure);
        else if (code !== 0) reject(new Error(`Azrael runtime validation worker exited with code ${code}.`));
        else if (!received) reject(new Error("Azrael runtime validation worker exited without a result."));
        else resolve(completed);
      });
    }).then(completed => {
      initialization = undefined;
      return publish(completed);
    }, error => {
      initialization = undefined;
      throw error;
    });
    return initialization;
  };
  registry.set(runtimeKey, module.exports);

  function initializeSync() {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "azrael-runtime.json"), "utf8"));
  validateRuntimePlatform(config.platform);
  if (config.windowControlRelative) {
    if (config.windowControlRelative !== "window-control") throw new Error("Invalid local Window Use path");
    const checked = require("./window-control-runtime.cjs").verifyRuntime(path.join(__dirname, "..", config.windowControlRelative));
    if (checked.manifestSha256 !== config.windowControl.manifestSha256) throw new Error("Window Use manifest changed");
    config.windowControl = { ...config.windowControl, directory: checked.directory, executable: checked.executable, mcpScript: checked.mcpScript, manifestSha256: checked.manifestSha256, restartDelayMs: 1000 };
  }
  if (config.schema !== 1) throw new Error("Unsupported azrael runtime configuration.");
  for (const key of ["engine", "bridge", "codexHome"]) {
    if (typeof config[key] !== "string" || !path.isAbsolute(config[key])) throw new Error(`Invalid azrael ${key}.`);
  }
  if (typeof config.engineVersion !== "string" || !/^\d+\.\d+\.\d+(?:[-.][\w.-]+)?$/.test(config.engineVersion)) {
    throw new Error("Invalid azrael engine version.");
  }
  for (const key of ["engine", "bridge"]) {
    requireExecutable(config[key]);
  }
  if (config.nodeExecutable !== undefined) requireExecutable(config.nodeExecutable);
  const ordinaryHome = canonicalPath(path.join(os.homedir(), ".codex"));
  const state = canonicalPath(config.codexHome);
  if (state === ordinaryHome || state.startsWith(ordinaryHome + path.sep)) throw new Error("azrael requires its own state home.");
  fs.mkdirSync(config.codexHome, { recursive: true });
  const physicalState = canonicalPath(fs.realpathSync.native(config.codexHome));
  const physicalOrdinary = fs.existsSync(ordinaryHome) ? canonicalPath(fs.realpathSync.native(ordinaryHome)) : ordinaryHome;
  if (physicalState === physicalOrdinary || physicalState.startsWith(physicalOrdinary + path.sep)) throw new Error("azrael requires its own state home.");
  if (config.sharedEngine !== undefined && typeof config.sharedEngine !== "boolean") throw new Error("Invalid shared Azrael engine mode.");
  if (config.sharedEngine) require("./shared-engine-host.cjs").validateSharedRuntime(config);
  const socket = config.sharedEngine
    ? undefined
    : path.join(os.tmpdir(), `azo-${crypto.randomBytes(6).toString("hex")}`, "m.sock");
  const env = { ...process.env, CODEX_HOME: config.codexHome, AZRAEL_EX_MANAGEMENT_SOCKET: socket };
  if (config.sharedEngine) delete env.AZRAEL_EX_MANAGEMENT_SOCKET;
  // Spreading process.env loses Windows' case-insensitive property lookup.
  // The pinned host reads PATH explicitly when appending its bundled tools.
  if (process.platform === "win32") {
    const pathKey = Object.keys(env).find(key => key.toUpperCase() === "PATH");
    const inheritedPath = process.env.PATH ?? (pathKey ? env[pathKey] : undefined);
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === "PATH") delete env[key];
    }
    if (inheritedPath !== undefined) env.PATH = inheritedPath;
  }
  env.AZRAEL_EX_PLAINTEXT_AGENTS = "1";
  delete env.AZRAEL_EX_DEVIN_EXECUTABLE;
  if (config.devinExecutable) env.AZRAEL_EX_DEVIN_EXECUTABLE = config.devinExecutable;
  require("./devin-native-host.cjs").configureEnvironment(env, config);
  require("./provider-accounts-host.cjs").configureEnvironment(env, config);
  return { ...config, socket, env };
  }
}

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
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "azrael-runtime.json"), "utf8"));
  validateRuntimePlatform(config.platform);
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
  const ordinaryHome = canonicalPath(path.join(os.homedir(), ".codex"));
  const state = canonicalPath(config.codexHome);
  if (state === ordinaryHome || state.startsWith(ordinaryHome + path.sep)) throw new Error("azrael requires its own state home.");
  fs.mkdirSync(config.codexHome, { recursive: true });
  const physicalState = canonicalPath(fs.realpathSync.native(config.codexHome));
  const physicalOrdinary = fs.existsSync(ordinaryHome) ? canonicalPath(fs.realpathSync.native(ordinaryHome)) : ordinaryHome;
  if (physicalState === physicalOrdinary || physicalState.startsWith(physicalOrdinary + path.sep)) throw new Error("azrael requires its own state home.");
  const socket = path.join(os.tmpdir(), `azo-${crypto.randomBytes(6).toString("hex")}`, "m.sock");
  const env = { ...process.env, CODEX_HOME: config.codexHome, AZRAEL_EX_MANAGEMENT_SOCKET: socket };
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
  exports.runtime = Object.freeze({ ...config, socket, env });
  // Only the pinned Codex bundle sees this environment. Other extensions and
  // terminal launches retain the VS Code process's original environment.
  exports.process = new Proxy(process, {
    get(target, key) { return key === "env" ? env : Reflect.get(target, key); },
  });
  registry.set(runtimeKey, module.exports);
}

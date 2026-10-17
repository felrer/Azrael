"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFile } = require("node:child_process");
const verified = new Map();
const endpoints = new WeakMap();
const endpointOutputLimit = 16 * 1024;
const digest = text => createHash("sha256").update(text, "utf8").digest("hex");

function validateSharedRuntime(runtime) {
  if (runtime.sharedEngine !== true) throw new Error("Shared Azrael engine mode is not enabled.");
  if (runtime.sharedEngineProtocol !== 2 || !/^[0-9a-f]{64}$/.test(runtime.engineSha256 ?? "")) {
    throw new Error("Shared Azrael engine requires protocol 2 and engineSha256 from the immutable build receipt. Prepare the host with the matching engine release.");
  }
}

function verifyEngine(runtime) {
  validateSharedRuntime(runtime);
  const key = `${runtime.engine}:${runtime.engineSha256}`;
  if (!verified.has(key)) verified.set(key, new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(runtime.engine);
    stream.on("data", bytes => hash.update(bytes));
    stream.on("error", reject);
    stream.on("end", () => hash.digest("hex") === runtime.engineSha256 ? resolve() :
      reject(new Error("Azrael engine does not match its immutable build receipt. Prepare the matching release again.")));
  }));
  return verified.get(key);
}

// Discovery uses the selected executable's native identity calculation. It must
// finish before any account/window authority is passed to the official host.
async function resolveEngineEndpoint(runtime, options = {}) {
  validateSharedRuntime(runtime);
  if (!endpoints.has(runtime)) endpoints.set(runtime, (async () => {
    await verifyEngine(runtime);
    if (typeof runtime.env?.CODEX_HOME !== "string" || !path.isAbsolute(runtime.env.CODEX_HOME)) {
      throw new Error("Azrael engine endpoint discovery requires an absolute selected CODEX_HOME.");
    }
    const timeoutMs = options.timeoutMs ?? 10000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
      throw new Error("Invalid Azrael engine endpoint discovery timeout.");
    }
    const env = { ...runtime.env };
    for (const key of Object.keys(env)) {
      if (["AZRAEL_EX_WINDOW_CONTEXT", "AZRAEL_EX_MANAGEMENT_SOCKET"].includes(key.toUpperCase())) delete env[key];
    }
    const stdout = await new Promise((resolve, reject) => {
      let child, finished = false;
      const finish = (error, output) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (error) reject(new Error("Azrael engine endpoint discovery failed.", { cause: error }));
        else resolve(output);
      };
      const timer = setTimeout(() => {
        try { child?.kill(); } catch { /* Discovery already failed closed. */ }
        finish(new Error("Azrael engine endpoint discovery timed out."));
      }, timeoutMs);
      try {
        child = (options.execFile ?? execFile)(runtime.engine,
          ["-c", "features.code_mode_host=true", "app-server", "--analytics-default-enabled", "--azrael-engine-endpoint"],
          { env, encoding: "utf8", timeout: timeoutMs, maxBuffer: endpointOutputLimit, windowsHide: true },
          (error, output, stderr) => {
            if (error) return finish(error);
            if (typeof output !== "string" || Buffer.byteLength(output) > endpointOutputLimit ||
                typeof stderr !== "string" || Buffer.byteLength(stderr) > endpointOutputLimit) {
              return finish(new Error("Azrael engine endpoint discovery exceeded its output limit."));
            }
            finish(null, output);
          });
      } catch (error) { finish(error); }
    });
    let descriptor;
    try { descriptor = JSON.parse(stdout); } catch {
      throw new Error("Invalid Azrael engine endpoint descriptor JSON.");
    }
    if (!descriptor || descriptor.schema !== 2 || typeof descriptor.instanceId !== "string" || !/^[0-9a-f]{64}$/.test(descriptor.instanceId) ||
        typeof descriptor.socketPath !== "string" || !path.isAbsolute(descriptor.socketPath) || descriptor.socketPath.includes("\0") ||
        typeof descriptor.engineVersion !== "string" || descriptor.engineVersion !== runtime.engineVersion || descriptor.engineIdentity !== runtime.engineSha256) {
      throw new Error("Azrael engine endpoint descriptor does not match the selected release.");
    }
    runtime.socket = descriptor.socketPath;
    runtime.env.AZRAEL_EX_MANAGEMENT_SOCKET = descriptor.socketPath;
    runtime.engineInstanceId = descriptor.instanceId;
    return Object.freeze(descriptor);
  })());
  return endpoints.get(runtime);
}

function windowContext(runtime, { sessionId, workspacePath, hostPid, accountStateFile, accountDefaultFile }) {
  validateSharedRuntime(runtime);
  for (const value of [workspacePath, accountStateFile, accountDefaultFile].filter(value => value !== null)) {
    if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error("Shared Azrael window paths must be absolute local paths.");
  }
  if (typeof sessionId !== "string" || !sessionId || !Number.isInteger(hostPid) || hostPid < 1 || hostPid > 0xffffffff) {
    throw new Error("Shared Azrael window requires a session identity and actual extension host PID.");
  }
  return { schema: 1, role: "window", ownerId: digest(sessionId), workspaceId: digest(workspacePath),
    hostPid, accountStateFile, accountDefaultFile, engineVersion: runtime.engineVersion, engineIdentity: runtime.engineSha256 };
}

// Native code owns marker writes and clearing. A corrupt/unreadable marker
// suppresses automatic work, matching the core's fail-closed policy.
function requiresManualResume(home, threadId) {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(home, "azrael/runtime/manual-resume.json"), "utf8"));
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (marker?.schema !== 1 || Object.keys(marker).some(key => !["schema", "threads"].includes(key)) ||
        !Array.isArray(marker.threads) || marker.threads.some(id => typeof id !== "string" || !uuid.test(id))) return true;
    return marker.threads.includes(threadId);
  } catch (error) { return error?.code !== "ENOENT"; }
}

module.exports = { validateSharedRuntime, verifyEngine, resolveEngineEndpoint, windowContext, requiresManualResume };

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const verified = new Map();
const digest = text => createHash("sha256").update(text, "utf8").digest("hex");

function validateSharedRuntime(runtime) {
  if (runtime.sharedEngine !== true) throw new Error("Shared Azrael engine mode is not enabled.");
  if (runtime.sharedEngineProtocol !== 1 || !/^[0-9a-f]{64}$/.test(runtime.engineSha256 ?? "")) {
    throw new Error("Shared Azrael engine requires protocol 1 and engineSha256 from the immutable build receipt. Prepare the host with the matching engine release.");
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

module.exports = { validateSharedRuntime, verifyEngine, windowContext, requiresManualResume };

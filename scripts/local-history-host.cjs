"use strict";
const path = require("node:path");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const { createHash } = require("node:crypto");

// The extension host owns retries; each child is disposable and the importer is idempotent.
async function sync(runtime, output, options = {}) {
  if (!runtime.localHistory?.sourceHome) return { disabled: true };
  const script = path.join(__dirname, "sync-local-history.py");
  const args = [script, "--source", runtime.localHistory.sourceHome, "--target", runtime.codexHome];
  let attempt = 0;
  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("Invalid history import retry limit.");
  const appVersion = options.appVersion;
  if (typeof appVersion !== "string" || !/^\d+\.\d+\.\d+(?:[-.][\w.-]+)?$/.test(appVersion)) throw new Error("Invalid history import app version.");
  const versionDirectory = path.join(runtime.codexHome, "local-history-versions");
  fs.mkdirSync(versionDirectory, { recursive: true });
  const versionFile = path.join(versionDirectory, createHash("sha256").update(appVersion).digest("hex") + ".json");
  try {
    fs.writeFileSync(versionFile, JSON.stringify({ schema: 1, appVersion, state: "started" }), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code === "EEXIST") return { skipped: true, reason: "version-already-attempted", appVersion };
    throw error;
  }
  const recordVersion = state => fs.writeFileSync(versionFile, JSON.stringify({ schema: 1, appVersion, state }), { mode: 0o600 });
  const spawnChild = options.spawnChild ?? spawn;
  for (;;) {
    attempt++;
    const statusPath = path.join(runtime.codexHome, "local-history-supervisor.json");
    fs.mkdirSync(runtime.codexHome, { recursive: true });
    let last;
    const code = await new Promise(resolve => {
      const child = spawnChild("/usr/bin/python3", args, { stdio: ["ignore", "pipe", "pipe"] });
      fs.writeFileSync(statusPath, JSON.stringify({ state: "running", attempt, parentPid: process.pid, childPid: child.pid }), { mode: 0o600 });
      options.onChild?.(child);
      let pending = "";
      child.stdout.on("data", bytes => {
        pending += bytes.toString();
        const lines = pending.split("\n"); pending = lines.pop();
        for (const line of lines) {
          try { last = JSON.parse(line); output?.appendLine(`Local history: ${line}`); } catch { /* No personal content is logged. */ }
        }
      });
      child.stderr.resume();
      child.once("error", () => resolve(1));
      child.once("exit", exitCode => resolve(exitCode ?? 1));
    });
    if (code === 0) {
      fs.writeFileSync(statusPath, JSON.stringify({ state: "complete", attempt, parentPid: process.pid, result: last }), { mode: 0o600 });
      recordVersion("complete");
      return last;
    }
    const delay = Math.min((options.cooldownMs ?? 1000) * 2 ** Math.min(attempt - 1, 8), 300000);
    if (attempt >= maxAttempts) {
      fs.writeFileSync(statusPath, JSON.stringify({ state: "failed", attempt, parentPid: process.pid }), { mode: 0o600 });
      recordVersion("failed");
      throw new Error("Local history import failed; see Azrael Local History output.");
    }
    fs.writeFileSync(statusPath, JSON.stringify({ state: "cooldown", attempt, parentPid: process.pid, retryAfterMs: delay }), { mode: 0o600 });
    output?.appendLine(`Local history import interrupted; retrying in ${delay} ms.`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

exports.sync = sync;

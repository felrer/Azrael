"use strict";
const path = require("node:path");
const { spawn } = require("node:child_process");
const fs = require("node:fs");

// The extension host owns retries; each child is disposable and the importer is idempotent.
async function sync(runtime, output, options = {}) {
  if (!runtime.localHistory?.sourceHome) return { disabled: true };
  const script = path.join(__dirname, "sync-local-history.py");
  const args = [script, "--source", runtime.localHistory.sourceHome, "--target", runtime.codexHome];
  let attempt = 0;
  const maxAttempts = options.maxAttempts ?? 0;
  for (;;) {
    attempt++;
    const statusPath = path.join(runtime.codexHome, "local-history-supervisor.json");
    fs.mkdirSync(runtime.codexHome, { recursive: true });
    let last;
    const code = await new Promise(resolve => {
      const child = spawn("/usr/bin/python3", args, { stdio: ["ignore", "pipe", "pipe"] });
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
      return last;
    }
    const delay = Math.min((options.cooldownMs ?? 1000) * 2 ** Math.min(attempt - 1, 8), 300000);
    fs.writeFileSync(statusPath, JSON.stringify({ state: "cooldown", attempt, parentPid: process.pid, retryAfterMs: delay }), { mode: 0o600 });
    if (maxAttempts && attempt >= maxAttempts) throw new Error("Local history import failed; see Azrael Local History output.");
    output?.appendLine(`Local history import interrupted; retrying in ${delay} ms.`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

exports.sync = sync;

"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { Worker } = require("node:worker_threads");
const { beginArtifactRun, trackArtifactChild, finishArtifactRun } = require("../../scripts/artifact-run.cjs");
const projectRoot = path.resolve(__dirname, "../..");
const hostIndex = process.argv.indexOf("--host");
if (hostIndex < 0) throw new Error("Explicit --host is required.");
const extensionRoot = path.resolve(process.argv[hostIndex + 1]);
// Windows AF_UNIX includes the home path in its fixed-length socket address.
const run = beginArtifactRun(projectRoot, { workId: "standalone-app-ui", owner: "apps/azrael-desktop/verify.cjs", requireStopEvidence: true, paths: { temporary: path.join(projectRoot, "artifacts", "dt", randomUUID().slice(0, 8)) } });
run.record = require("../../scripts/artifact-lifecycle.cjs").recordLifecycle(projectRoot, { ...run.record, expected_revision: run.record.revision, members: run.record.members.map(member => member.path === run.temporary ? { ...member, generated: true, protection_known: true } : member) });
const workspace = path.join(run.temporary, "workspace");
fs.mkdirSync(workspace);
fs.writeFileSync(path.join(workspace, "sample.md"), "# Azrael\n\n읽기 전용 Markdown 문서\n<script>globalThis.__azraelInjected=true</script>\n");
fs.writeFileSync(path.join(workspace, "sample.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRk0AAAAASUVORK5CYII=", "base64"));
const models = fs.readFileSync(path.join(projectRoot, "engine/codex-rs/models-manager/models.json"));
fs.writeFileSync(path.join(run.temporary, "models.json"), models);
const log = fs.openSync(path.join(run.logs, "electron.log"), "w");
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.toUpperCase() === "ELECTRON_RUN_AS_NODE") delete env[key];
const executable = require("electron");
const backend = new Worker(path.join(__dirname, "fixture-backend.cjs"), { workerData: { models: path.join(run.temporary, "models.json") } });
let launched = false;
let backendExited = false, backendError;
backend.once("exit", () => { backendExited = true; });
function backendFailure(cause) {
  backendError = cause.message;
  process.stderr.write(cause.message + "\n");
  if (launched) return;
  fs.closeSync(log);
  fs.writeFileSync(path.join(run.reports, "backend-failure.json"), JSON.stringify({ message: cause.message }));
  finishArtifactRun(run, { exitCode: 1, producerStopped: false, reason: "Fixture backend failed before Electron launch." });
  process.exitCode = 1;
  void backend.terminate();
}
backend.once("error", backendFailure);
backend.on("message", message => {
  if (message.type === "ready") start(message.url);
  if (message.type === "error") backendFailure(new Error(message.message));
});
function start(backendUrl) {
launched = true;
const themeIndex = process.argv.indexOf("--theme");
const theme = themeIndex < 0 ? "dark" : process.argv[themeIndex + 1];
const child = trackArtifactChild(run, spawn(executable, [__dirname, "--enable-logging=stderr", "--host", extensionRoot, "--workspace", workspace, "--verification-root", run.temporary, "--theme", theme === "both" ? "dark" : theme, ...(theme === "both" ? ["--verify-both-themes"] : [])], { cwd: projectRoot, env: { ...env, AZRAEL_DESKTOP_VERIFICATION_BACKEND: backendUrl }, windowsHide: true, stdio: ["ignore", log, log] }));
const watchdog = setTimeout(() => { process.stderr.write("Verification exceeded 180 seconds; terminating its exact Electron child. Descendant stop remains subject to independent verification.\n"); child.kill(); }, 180000);
child.on("error", cause => { process.stderr.write(`${cause.message}\n`); process.exitCode = 1; });
child.on("close", async (code, signal) => {
  clearTimeout(watchdog);
  fs.closeSync(log);
  // Preserve the observed outcome even if the shared catalog cannot reconcile.
  fs.writeFileSync(path.join(run.reports, "electron-close.json"), JSON.stringify({ pid: child.pid, exitCode: code, signal, observedAt: new Date().toISOString() }, null, 2));
  const stopped = backendExited ? Promise.resolve([]) : new Promise(resolve => {
    backend.on("message", message => { if (message.type === "stopped") resolve(message.requests); });
    backend.once("exit", () => resolve([]));
    backend.postMessage("stop");
  });
  fs.writeFileSync(path.join(run.reports, "fixture-requests.json"), JSON.stringify(await stopped, null, 2));
  let result;
  for (const name of ["result.json", "failure.json"]) if (fs.existsSync(path.join(run.temporary, name))) result = JSON.parse(fs.readFileSync(path.join(run.temporary, name), "utf8"));
  let lifecycleError;
  try { finishArtifactRun(run, { exitCode: code, signal, producerStopped: false, reason: "Actual Electron child close; independent native descendant verification required." }); }
  catch (cause) { lifecycleError = cause.message; process.stderr.write(`Lifecycle reconciliation failed: ${cause.message}\n`); }
  process.stdout.write(JSON.stringify({ runRoot: run.runRoot, exitCode: code, signal, result, ...(backendError && { backendError }), ...(lifecycleError && { lifecycleError }) }) + "\n");
  process.exitCode = backendError || lifecycleError ? 1 : code ?? 1;
});
}

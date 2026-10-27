"use strict";
// Task controller: production policy remains in the maintenance library.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { beginArtifactRun, finishArtifactRun } = require("../../scripts/artifact-run.cjs");
const { copyTree, inventoryTree } = require("../../scripts/freeze-platform-inputs.cjs");
const { runManagedCargoSync } = require("../../scripts/cargo-target-owner.cjs");
const root = path.resolve(__dirname, "../..");
const retry = process.argv.includes("--retry-with-rust-path");
const base = path.join(root, `artifacts/verification/dn01-root-retirement${retry ? "-2" : ""}`);
const run = beginArtifactRun(root, { workId: "DN-01-root-retirement", owner: "DN-01-approved-temp-cleanup",
  runId: `validation-20261024${retry ? "-2" : ""}`, references: retry ? [{ id: "run:DN-01-root-retirement:validation-20261024", reason: "Reuse independently frozen source after terminal tool PATH failure", kind: "execution" }] : [], paths: Object.fromEntries(["inputs", "temporary", "logs", "reports", "outputs"].map(role => [role, path.join(base, role)])) });
let code = 1;
const results = [];
try {
  const source = path.join(root, "engine");
  const frozen = retry ? path.join(root, "artifacts/verification/dn01-root-retirement/inputs/engine") : path.join(run.inputs, "engine");
  const receipt = JSON.parse(fs.readFileSync(path.join(source, "SOURCE.json"), "utf8"));
  const additions = ["codex-rs/project-maintenance/src/retirement.rs", "codex-rs/project-maintenance/src/bin/maintenance_owner.rs", "codex-rs/project-maintenance/tests/root_retirement.rs"];
  // The imported inventory selects source, never target directories or caches.
  for (const relative of retry ? [] : [...new Set([...Object.keys(receipt.files), "SOURCE.json", ...additions])].sort()) {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) throw Error("Invalid source inventory path");
    copyTree(path.join(source, relative), path.join(frozen, relative), [], source);
  }
  const identity = inventoryTree(frozen);
  if (retry && identity.sha256 !== JSON.parse(fs.readFileSync(path.join(root, "artifacts/verification/dn01-root-retirement/reports/frozen-inputs.json"))).sha256) throw Error("Reused frozen input identity changed");
  fs.writeFileSync(path.join(run.reports, "frozen-inputs.json"), JSON.stringify(identity, null, 2));
  const env = { ...process.env, PATH: `C:\\Users\\felre\\.cargo\\bin;${process.env.PATH}`, CARGO_TARGET_DIR: path.join(run.temporary, "target"), TEMP: path.join(run.temporary, "tmp"), TMP: path.join(run.temporary, "tmp"), INSTA_PENDING_DIR: path.join(run.temporary, "pending") };
  fs.mkdirSync(env.TEMP, { recursive: true });
  const log = fs.openSync(path.join(run.logs, "library.log"), "wx");
  try {
    const test = spawnSync(process.execPath, [path.join(root, "scripts/check-project-maintenance.cjs"), frozen, "--stage", "library"], { cwd: root, env, windowsHide: true, stdio: ["ignore", log, log] });
    results.push({ stage: "library", exitCode: test.status, signal: test.signal, error: test.error?.message });
    if (test.error || test.signal || test.status !== 0) throw Error("Library verification failed; inspect library.log");
  } finally { fs.closeSync(log); }
  const buildLog = fs.openSync(path.join(run.logs, "owner-build.log"), "wx");
  try {
    const built = runManagedCargoSync({ command: "cargo", args: ["build", "-p", "azrael-project-maintenance", "--bin", "maintenance_owner", "--locked", "--offline"], cwd: path.join(frozen, "codex-rs"), selectedSourceRoot: frozen, env, windowsHide: true, stdio: ["ignore", buildLog, buildLog] });
    results.push({ stage: "owner-build", exitCode: built.status, signal: built.signal, error: built.error?.message });
    if (built.error || built.signal || built.status !== 0) throw Error("Owner compilation failed; inspect owner-build.log");
  } finally { fs.closeSync(buildLog); }
  if (inventoryTree(frozen).sha256 !== identity.sha256) throw Error("Frozen source changed during verification");
  fs.copyFileSync(path.join(env.CARGO_TARGET_DIR, "debug/maintenance_owner.exe"), path.join(run.outputs, "maintenance_owner.exe"));
  code = 0;
} catch (error) {
  results.push({ error: error.stack });
} finally {
  fs.writeFileSync(path.join(run.reports, "validation.json"), JSON.stringify({ exitCode: code, results }, null, 2));
  finishArtifactRun(run, { exitCode: code, producerStopped: true, reason: "All synchronous owned verification producers returned terminal outcomes" });
}
process.exitCode = code;

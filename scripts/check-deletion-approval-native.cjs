"use strict";
const fs = require("node:fs"), path = require("node:path");
const { beginArtifactRun, finishArtifactRun } = require("./artifact-run.cjs");
const { copyTree, inventoryTree } = require("./freeze-platform-inputs.cjs");
const { runCargoTest } = require("./cargo-verification.cjs");
const root = path.resolve(__dirname, "..");
const selectedSource = process.argv[2];
if (process.argv.length > 3 || (selectedSource && !path.isAbsolute(selectedSource))) {
  throw Error("Usage: check-deletion-approval-native.cjs [absolute frozen engine source root]");
}
const run = beginArtifactRun(root, { workId: "bt-deletion-native", owner: "BT-deletion-approval", paths: {
  inputs: path.join(root, "artifacts/verification", `bt-delete-${process.pid}`),
  temporary: path.join(root, "artifacts/verification", `bt-temp-${process.pid}`),
} });
const source = selectedSource || path.join(run.inputs, "engine");
let exitCode = 1;
let producerStopped = true;
let observedSignal = null;
try {
  if (!selectedSource) copyTree(path.join(root, "engine"), source, ["target", "node_modules", ".git", "artifacts"]);
  const identity = inventoryTree(source);
  fs.writeFileSync(path.join(run.reports, "source.json"), JSON.stringify(identity));
  const temp = path.join(run.temporary, "temp");
  fs.mkdirSync(temp, { recursive: true });
  const env = { ...process.env, TEMP: temp, TMP: temp,
    CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || path.join(root, "engine/codex-rs/target"),
    PATH: path.join(require("node:os").homedir(), ".cargo/bin") + path.delimiter + (process.env.PATH || ""),
  };
  if (process.platform === "win32") env.AZRAEL_CARGO_TARGET ||= "x86_64-pc-windows-msvc";
  const checks = [
    ["classification", "codex-shell-command", "command_safety::"],
    ["policy", "codex-core", "exec_policy::tests::"],
    ["routing", "codex-core", "tools::approvals::tests::deletion_approval_"],
    ["patch", "codex-core", "apply_patch::tests::"],
  ];
  const results = [];
  for (const [name, pkg, filter] of checks) {
    const started = new Date().toISOString();
    const result = runCargoTest(source, ["test", "-p", pkg, "--lib", filter, "--locked", "--offline", "--", "--test-threads=1"], {
      env, isolateHostEnvironment: true, capture: true,
    });
    fs.writeFileSync(path.join(run.logs, `${name}.stdout.log`), result.stdout || "");
    fs.writeFileSync(path.join(run.logs, `${name}.stderr.log`), result.stderr || "");
    exitCode = result.status ?? 1;
    if (!Number.isInteger(result.status)) {
      producerStopped = false;
      observedSignal = result.signal ?? null;
    }
    results.push({ name, started, ended: new Date().toISOString(), exitCode, error: result.error?.message, preflight: result.cargoPreflight });
    fs.writeFileSync(path.join(run.reports, "results.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results.at(-1)));
    if (result.error || exitCode !== 0) break;
  }
} finally {
  finishArtifactRun(run, { exitCode: producerStopped ? exitCode : null, signal: observedSignal, producerStopped });
  console.log(JSON.stringify({ exitCode, runRoot: run.runRoot, logs: run.logs }));
}
process.exitCode = exitCode;

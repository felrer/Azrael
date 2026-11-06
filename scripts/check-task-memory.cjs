"use strict";

// Focused native acceptance. Uses the existing immutable-input, Cargo and
// artifact owners; no app package is built or installed.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { beginArtifactRun, finishArtifactRun } = require("./artifact-run.cjs");
const { copyTree, inventoryTree } = require("./freeze-platform-inputs.cjs");
const { inventory } = require("./cargo-stable-source.cjs");
const { runCargoTest } = require("./cargo-verification.cjs");
const { selectCache } = require("./cargo-shared-cache.cjs");

const root = path.resolve(__dirname, "..");
const [scope = "all", ...extra] = process.argv.slice(2);
if (extra.length || !["all", "storage", "core"].includes(scope)) throw Error("Usage: check-task-memory.cjs [all|storage|core]");
const run = beginArtifactRun(root, { workId: "FK-01-task-memory", owner: "scripts/check-task-memory.cjs",
  paths: { inputs: path.join(root, "artifacts/verification/fk-" + crypto.randomBytes(4).toString("hex")) } });
run.record = require("./artifact-lifecycle.cjs").recordLifecycle(root, { ...run.record,
  members: run.record.members.map(member => member.role === "inputs" ? { ...member, generated: true, protection_known: true } : member),
  expected_revision: run.record.revision });
let exitCode = 1, producerStopped = true;
try {
  const source = path.join(root, "engine"), frozen = path.join(run.inputs, "engine");
  const identity = tree => JSON.stringify(Object.entries(tree.files).sort(([a], [b]) => a.localeCompare(b)).map(([name, entry]) => [name, entry.sha256]));
  const before = identity(inventory(source, true));
  copyTree(source, frozen);
  if (identity(inventory(source, true)) !== before || identity(inventory(frozen, true)) !== before) throw Error("Engine changed while freezing task-memory inputs");
  const fixed = inventoryTree(frozen).sha256;
  const env = { ...process.env, PATH: path.join(require("node:os").homedir(), ".cargo/bin") + path.delimiter + process.env.PATH,
    AZRAEL_CARGO_CACHE_PROJECT_ROOT: root, AZRAEL_CARGO_RUN_ID: run.lifecycleId,
    RUSTUP_TOOLCHAIN: "1.95.0", TEMP: run.temporary, TMP: run.temporary, TMPDIR: run.temporary,
    INSTA_PENDING_DIR: path.join(run.temporary, "insta"), RUST_MIN_STACK: "33554432" };
  const cache = selectCache({ projectRoot: root, sourceRoot: frozen, env });
  env.CARGO_TARGET_DIR = cache.targetDirectory;
  const selected = [
    ...(scope !== "core" ? [["azrael-task-memory", null]] : []),
    ...(scope !== "storage" ? [["codex-core", "task_memory"]] : []),
  ];
  const results = [];
  for (const [crate, filter] of selected) {
    console.log(JSON.stringify({ phase: "selected-test-start", crate, filter, startedUtc: new Date().toISOString() }));
    const result = runCargoTest(frozen, ["test", "-p", crate, "--lib", "--locked", "--offline", ...(filter ? [filter] : []), "--", "--test-threads=1"], { env, isolateHostEnvironment: true, capture: true });
    fs.writeFileSync(path.join(run.logs, crate + ".stdout.log"), result.stdout || "");
    fs.writeFileSync(path.join(run.logs, crate + ".stderr.log"), result.stderr || "");
    producerStopped = !result.error && Number.isInteger(result.status);
    if (result.error && !result.preflight?.phases?.some(p => p.exitCode != null)) producerStopped = false;
    const evidence = { crate, filter, exitCode: result.status ?? null, accepted: result.preflight?.accepted === true,
      actualCounts: result.preflight?.actualCounts, error: result.error?.message,
      phases: result.preflight?.phases };
    results.push(evidence); console.log(JSON.stringify(evidence));
    if (!evidence.accepted) { if (result.stderr) console.error(result.stderr.slice(-10000)); break; }
  }
  if (inventoryTree(frozen).sha256 !== fixed) throw Error("Frozen task-memory inputs changed during execution");
  exitCode = results.length === selected.length && results.every(result => result.accepted) ? 0 : 1;
  fs.writeFileSync(path.join(run.reports, "summary.json"), JSON.stringify({ sourceSha256: fixed, sourceRoot: frozen,
    cache: cache.targetDirectory, scope, results, exitCode }, null, 2));
} catch (error) { console.error(error.stack || error); }
finally {
  finishArtifactRun(run, { exitCode, producerStopped,
    reason: producerStopped ? "Selected synchronous native producers ended" : "Native producer termination requires investigation" });
  console.log(JSON.stringify({ lifecycleId: run.lifecycleId, runRoot: run.runRoot, inputs: run.inputs, exitCode }));
  process.exitCode = exitCode;
}

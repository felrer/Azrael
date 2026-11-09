"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { beginArtifactRun, finishArtifactRun } = require("./artifact-run.cjs");
const { runCargoTest } = require("./cargo-verification.cjs");
const { selectCache } = require("./cargo-shared-cache.cjs");
const { copyTree, inventoryTree } = require("./freeze-platform-inputs.cjs");
const { inventory } = require("./cargo-stable-source.cjs");
const root = path.resolve(__dirname, "..");
const [requestedSource, ...extra] = process.argv.slice(2);
if (extra.length || (requestedSource && (!path.isAbsolute(requestedSource) || !fs.existsSync(path.join(requestedSource, "codex-rs/Cargo.toml"))))) {
  throw Error("Usage: check-role-profiles-native.cjs [absolute engine source root]");
}

// Keep Windows compilation source paths short while retaining explicit ownership.
const run = beginArtifactRun(root, { workId: "FH-01-role-profiles-native", owner: "scripts/check-role-profiles-native.cjs",
  paths: { ...(!requestedSource ? { inputs: path.join(root, "artifacts/verification/fh01-" + crypto.randomBytes(4).toString("hex")) } : {}),
    temporary: path.join(root, "artifacts/verification/fh01-t-" + crypto.randomBytes(4).toString("hex")) } });
run.record = require("./artifact-lifecycle.cjs").recordLifecycle(root, { ...run.record,
  members: run.record.members.map(member => ["inputs", "temporary"].includes(member.role) ? { ...member, generated: true, protection_known: true } : member),
  expected_revision: run.record.revision });
let exitCode = 1, producerStopped = true;
try {
  const source = requestedSource || path.join(root, "engine"), frozen = requestedSource || path.join(run.inputs, "engine");
  const content = record => JSON.stringify(Object.entries(record.files).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => [name, value.sha256]));
  const before = content(inventory(source, true));
  if (!requestedSource) copyTree(source, frozen);
  if (content(inventory(source, true)) !== before || content(inventory(frozen, true)) !== before) throw Error("Engine inputs changed while freezing role-profile tests");
  const fixed = inventoryTree(frozen).sha256;
  const env = { ...process.env, PATH: path.join(require("node:os").homedir(), ".cargo/bin") + path.delimiter + process.env.PATH,
    AZRAEL_CARGO_CACHE_PROJECT_ROOT: root, AZRAEL_CARGO_RUN_ID: run.lifecycleId,
    AZRAEL_CARGO_CACHE_SCOPE: process.env.AZRAEL_CARGO_CACHE_SCOPE ?? "role-profiles-verification",
    TEMP: run.temporary, TMP: run.temporary, TMPDIR: run.temporary,
    INSTA_PENDING_DIR: path.join(run.temporary, "insta"), RUST_MIN_STACK: "33554432" };
  const cache = env.CARGO_TARGET_DIR ? { targetDirectory: env.CARGO_TARGET_DIR } : selectCache({ projectRoot: root, sourceRoot: frozen, env });
  env.CARGO_TARGET_DIR = cache.targetDirectory;
  const results = [];
  for (const [crate, filter] of [
    ["codex-core", "role_profile"],
    ["codex-core", "spawn_agent_fork"],
    ["codex-core", "multi_agent_v2_spawn_fork_turns_all_applies_agent_type_override"],
    ["codex-core", "spawn_agent_can_fork_parent_thread_history_with_sanitized_items"],
    ["codex-core", "root_coordination"],
    ["codex-core", "defer_root_registration"],
    ["codex-core", "config::schema::tests::config_schema_matches_fixture"],
    ["codex-app-server-protocol", "schema_fixtures_tests::"],
  ]) {
    console.log(JSON.stringify({ phase: "selected-test-start", crate, filter }));
    const result = runCargoTest(frozen, ["test", "-p", crate, "--lib", "--locked", "--offline", filter, "--", "--test-threads=1"], { env, isolateHostEnvironment: true, capture: true });
    fs.writeFileSync(path.join(run.logs, filter + ".stdout.log"), result.stdout ?? "");
    fs.writeFileSync(path.join(run.logs, filter + ".stderr.log"), result.stderr ?? "");
    producerStopped = !result.error && Number.isInteger(result.status);
    // A reported spawn/setup error does not turn an unknown tree into stopped.
    if (result.error && !result.preflight?.phases?.some(p => p.exitCode != null)) producerStopped = false;
    const evidence = { crate, filter, exitCode: result.status ?? null, accepted: result.preflight?.accepted === true, actualCounts: result.preflight?.actualCounts, error: result.error?.message };
    results.push(evidence); console.log(JSON.stringify(evidence));
    if (result.status !== 0 || result.error) { if (result.stderr) console.error(result.stderr.slice(-12000)); break; }
  }
  if (inventoryTree(frozen).sha256 !== fixed) throw Error("Frozen native test inputs changed during execution");
  exitCode = results.length === 8 && results.every(r => r.accepted) ? 0 : 1;
  fs.writeFileSync(path.join(run.reports, "summary.json"), JSON.stringify({ sourceSha256: fixed, sourceRoot: frozen, cache: cache.targetDirectory, results, exitCode }, null, 2));
} catch (error) { console.error(error.stack || error); }
finally {
  finishArtifactRun(run, { exitCode, producerStopped, reason: producerStopped ? "Selected native tests and owned synchronous producers ended" : "Native producer termination requires investigation" });
  console.log(JSON.stringify({ lifecycleId: run.lifecycleId, runRoot: run.runRoot, exitCode }));
  process.exitCode = exitCode;
}

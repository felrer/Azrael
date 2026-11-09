"use strict";

// Focused native acceptance. Uses the existing immutable-input, Cargo and
// artifact owners; no app package is built or installed.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { beginArtifactRun, addArtifactRunReferences, finishArtifactRun } = require("./artifact-run.cjs");
const { copyTree, inventoryTree } = require("./freeze-platform-inputs.cjs");
const { inventory } = require("./cargo-stable-source.cjs");
const { runCargoTest } = require("./cargo-verification.cjs");
const { selectCache } = require("./cargo-shared-cache.cjs");
const lifecycle = require("./artifact-lifecycle.cjs");

const root = path.resolve(__dirname, "..");
const [scope = "all", ...extra] = process.argv.slice(2);
const privateTarget = extra.includes("--private-target");
if (extra.some(value => value.startsWith("--seed-run="))) throw Error("--seed-run no longer copies run-owned Cargo targets. Use --private-target to reuse the managed image-verification cache in place. Legacy run targets remain with their original owner; the first managed cache use may compile from cold.");
if (extra.some(value => value !== "--private-target") || new Set(extra).size !== extra.length || !["all", "storage", "core", "protocol"].includes(scope)) throw Error("Usage: check-agent-image-attachments.cjs [all|storage|core|protocol] [--private-target]");
const run = beginArtifactRun(root, { workId: "FS-01-agent-image-attachments", owner: "scripts/check-agent-image-attachments.cjs",
  paths: { inputs: path.join(root, "artifacts/verification/fs-" + crypto.randomBytes(4).toString("hex")) } });
run.record = require("./artifact-lifecycle.cjs").recordLifecycle(root, { ...run.record,
  members: run.record.members.map(member => ["inputs", "outputs"].includes(member.role) ? { ...member, generated: true, protection_known: true } : member),
  expected_revision: run.record.revision });
let exitCode = 1, producerStopped = true, cache;
try {
  const source = path.join(root, "engine"), frozen = path.join(run.inputs, "engine");
  const identity = tree => JSON.stringify(Object.entries(tree.files).sort(([a], [b]) => a.localeCompare(b)).map(([name, entry]) => [name, entry.sha256]));
  const before = identity(inventory(source, true));
  copyTree(source, frozen);
  if (identity(inventory(source, true)) !== before || identity(inventory(frozen, true)) !== before) throw Error("Engine changed while freezing agent-image-attachments inputs");
  const fixed = inventoryTree(frozen).sha256;
  const env = { ...process.env, PATH: path.join(require("node:os").homedir(), ".cargo/bin") + path.delimiter + process.env.PATH,
    AZRAEL_CARGO_CACHE_PROJECT_ROOT: root, AZRAEL_CARGO_RUN_ID: run.lifecycleId,
    AZRAEL_CARGO_CACHE_SCOPE: process.env.AZRAEL_CARGO_CACHE_SCOPE ?? "agent-image-attachments",
    RUSTUP_TOOLCHAIN: "1.95.0", TEMP: run.temporary, TMP: run.temporary, TMPDIR: run.temporary,
    INSTA_PENDING_DIR: path.join(run.temporary, "insta"), RUST_MIN_STACK: "33554432" };
  // Select before both direct lookup and isolated Cargo execution, including
  // the private profile flags, while preserving an explicit caller scope.
  if (privateTarget) {
    env.CARGO_PROFILE_DEV_DEBUG = "0";
    env.CARGO_PROFILE_TEST_DEBUG = "0";
  }
  cache = selectCache({ projectRoot: root, sourceRoot: frozen, env });
  addArtifactRunReferences(root, run.lifecycleId, { owner: run.owner, expected_revision: run.record.revision,
    references: [{ id: cache.lifecycleId, kind: "execution", reason: "Protect the selected Cargo cache between image-verification test filters" }] });
  env.CARGO_TARGET_DIR = cache.targetDirectory;
  console.log(JSON.stringify({ phase: "selected-cargo-cache", targetDirectory: cache.targetDirectory,
    lifecycleId: cache.lifecycleId, scope: cache.identity.scope ?? "shared", cacheCopyBytes: 0 }));
  const selected = [
    ...(scope === "all" || scope === "protocol" ? [["codex-protocol", "inter_agent"]] : []),
    ...(scope === "all" || scope === "storage" ? [["codex-thread-store", "image_snapshot"]] : []),
    ...(scope === "all" || scope === "core" ? [["codex-core", "image_attachments"], ["codex-core", "agent_image_label"], ["codex-core", "tool_message_transport"], ["codex-core", "devin_recipient_requires_plaintext"]] : []),
  ];
  const results = [];
  for (const [crate, filter] of selected) {
    console.log(JSON.stringify({ phase: "selected-test-start", crate, filter, startedUtc: new Date().toISOString() }));
    // An exception or lost result cannot let the run's exit hook publish a
    // false stopped receipt and make the cache reference appear releasable.
    run.producerStopped = producerStopped = false;
    const result = runCargoTest(frozen, ["test", "-p", crate, "--lib", "--locked", "--offline", ...(filter ? [filter] : []), "--", "--test-threads=1"], { env, isolateHostEnvironment: true, capture: true });
    fs.writeFileSync(path.join(run.logs, crate + "-" + filter + ".stdout.log"), result.stdout || "");
    fs.writeFileSync(path.join(run.logs, crate + "-" + filter + ".stderr.log"), result.stderr || "");
    producerStopped = !result.error && Number.isInteger(result.status);
    if (result.error && !result.preflight?.phases?.some(p => p.exitCode != null)) producerStopped = false;
    run.producerStopped = producerStopped;
    const evidence = { crate, filter, exitCode: result.status ?? null, accepted: result.preflight?.accepted === true,
      actualCounts: result.preflight?.actualCounts, error: result.error?.message,
      phases: result.preflight?.phases };
    results.push(evidence); console.log(JSON.stringify(evidence));
    if (!evidence.accepted) { if (result.stderr) console.error(result.stderr.slice(-10000)); break; }
  }
  if (inventoryTree(frozen).sha256 !== fixed) throw Error("Frozen agent-image-attachments inputs changed during execution");
  exitCode = results.length === selected.length && results.every(result => result.accepted) ? 0 : 1;
  fs.writeFileSync(path.join(run.reports, "summary.json"), JSON.stringify({ sourceSha256: fixed, sourceRoot: frozen,
    cache: cache.targetDirectory, cacheLifecycleId: cache.lifecycleId, cacheCopyBytes: 0, scope, results, exitCode }, null, 2));
} catch (error) { console.error(error.stack || error); }
finally {
  finishArtifactRun(run, { exitCode, producerStopped,
    reason: producerStopped ? "Selected synchronous native producers ended" : "Native producer termination requires investigation" });
  if (cache && producerStopped && run.record.producer?.status === "stopped" && run.record.references.some(reference => reference.id === cache.lifecycleId)) {
    const proof = run.record.producer;
    lifecycle.releaseReferences(root, run.lifecycleId, { owner: run.owner, expected_revision: run.record.revision,
      reference_ids: run.record.references.filter(reference => reference.id === cache.lifecycleId).map(reference => reference.reference_id),
      reason: "Selected synchronous native tests ended; cache remains with its managed owner",
      evidence_ref: proof.evidence_ref, evidence_sha256: proof.evidence_sha256 });
  }
  console.log(JSON.stringify({ lifecycleId: run.lifecycleId, runRoot: run.runRoot, inputs: run.inputs, exitCode }));
  process.exitCode = exitCode;
}

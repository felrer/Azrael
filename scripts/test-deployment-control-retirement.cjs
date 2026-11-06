"use strict";
// Retain the smallest real acceptance: boundary/whitelist refusal before owner
// publication, then actual metadata custody, deletion, CAS and child closure.
// Partial/unknown recovery is protected in product code; fault fixtures are not
// admitted here because they lack a completed formal replan cleanup contract.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const lifecycle = require("./artifact-lifecycle.cjs");
const { beginArtifactRun } = require("./artifact-run.cjs");
const { prepareDeploymentControlRetirement: prepare, applyDeploymentControlRetirement: apply } = require("./deployment-workspace.cjs");
const hash = value => createHash("sha256").update(value).digest("hex");
const fixture = process.argv[2], selectedScope = process.argv[3] || "happy";
assert.equal(process.platform, "win32", "Windows acceptance fixture required");
assert(fixture && path.isAbsolute(fixture), "Fresh absolute caller-owned fixture required");
assert.equal(selectedScope, "happy", "Only the cleanup-complete happy acceptance scope is admitted");
// Later inventory refactors must retain unrelated historical pending decisions
// while preserving target/group/provenance protection and unresolved bindings.
const inside = (parent, child) => { const relative = path.relative(parent, child); return relative === "" || relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative); };
const { validateDecisionScope } = require("./deployment-control-retirement-native.cjs").createNativeGuard({ sha: hash, overlaps: (a, b) => inside(a, b) || inside(b, a) });
const decisionRoot = path.join(fixture, "decision-boundary"), decisionTarget = path.join(decisionRoot, "artifacts/target");
const pending = { id: "item", decision_id: "decision", status: "pending", lifecycle_group_id: "group" };
const ordinary = { id: "item", path: path.join(decisionRoot, "artifacts/unrelated"), lifecycle_group_id: "group", references: [] };
const decisionGroup = { id: "group", membership_complete: true, members: ["item"] };
assert.equal(validateDecisionScope(decisionRoot, decisionTarget, [pending], [ordinary], [decisionGroup]).length, 1);
assert.throws(() => validateDecisionScope(decisionRoot, decisionTarget, [{ ...pending, id: "missing" }], [ordinary], [decisionGroup]), /binding/);
assert.throws(() => validateDecisionScope(decisionRoot, decisionTarget, [pending], [{ ...ordinary, provenance: { source_path: decisionTarget } }], [decisionGroup]), /protects retirement scope/);
assert.throws(() => validateDecisionScope(decisionRoot, decisionTarget, [pending], [ordinary, { id: "other", path: decisionTarget, lifecycle_group_id: "group" }], [{ ...decisionGroup, members: ["item", "other"] }]), /protects retirement scope/);
const happyWorker = process.argv[4] === "--happy-worker";
async function exercise() {
  fs.mkdirSync(fixture);
  const root = path.join(fixture, "normal"); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "project-maintenance.json"), JSON.stringify({ schema_version: 1, project_id: "deployment-control-retirement-fixture", managed_roots: ["artifacts/tasks"], protected_paths: [], bundles: [] }));
  const run = beginArtifactRun(root, { owner: "control-retirement-test", workId: "test", runId: "controller", requireStopEvidence: true });
  process.removeListener("exit", run.onExit); // The supervisor closes from the actual child exit.
  const workingRoot = path.join(root, "artifacts", "workspace");
  const structuralDirectories = [workingRoot, path.join(workingRoot, "control"), path.join(workingRoot, "empty"), path.join(workingRoot, "empty", "child")];
  for (const directory of structuralDirectories) fs.mkdirSync(directory);
  const text = `gitdir: ${path.join(workingRoot, "control", "git").replaceAll("\\", "/")}\n`;
  const gitfile = { path: path.join(workingRoot, ".git"), text, sha256: hash(text), gitdir: path.join(workingRoot, "control", "git") };
  fs.writeFileSync(gitfile.path, text);
  const original = { workingLifecycleId: "workspace:original-finalized", owner: "original-owner", generation: null };
  const evidence_ref = path.join(run.reports, "attestation.json");
  fs.writeFileSync(evidence_ref, JSON.stringify({ schema: 1, action: "deployment-control-retirement-attestation", original, workingRoot, gitfile, structuralDirectories,
    producer_stopped_verified: true, references_zero: true, payload_finalized: true, reason: "Fresh fixture represents finalized generated payload; it restores no historical production receipt" }));
  const options = { artifactProjectRoot: root, workingRoot, original, gitfile, structuralDirectories,
    outputDirectory: run.reports, owner: run.owner, runLifecycleId: run.lifecycleId, evidence_ref, evidence_sha256: hash(fs.readFileSync(evidence_ref)) };
  const originalCatalog = lifecycle.catalog(root);
  for (const changes of [
    { owner: "wrong-owner" }, { original: { ...original, owner: "wrong-original-owner" } }, { original: { ...original, generation: "wrong-generation" } },
    { workingRoot: path.join(root, "artifacts") }, { outputDirectory: workingRoot },
    { gitfile: { ...gitfile, path: path.join(workingRoot, "control") } }, { gitfile: { ...gitfile, gitdir: path.join(root, "elsewhere") } },
    { structuralDirectories: structuralDirectories.filter(directory => directory !== workingRoot) }
  ]) {
    await assert.rejects(() => prepare({ ...options, ...changes }));
    assert.deepEqual(lifecycle.catalog(root), originalCatalog, "Rejected selection must not publish or alter an owner");
    assert.equal(fs.readFileSync(gitfile.path, "utf8"), text);
  }
  assert.throws(() => lifecycle.withCatalogLock(root, () => lifecycle.recordLifecycle(root, { id: "generic-git", kind: "work", owner: "test", state: "complete", membership_complete: true,
    members: [{ path: gitfile.path, role: "artifact", generated: true, protection_known: true }] }), { operation: "test.control-generic-refusal", drainOnly: true }), error => {
      assert.match(error.message, /Source or management/);
      assert.equal(error.release_error, undefined, "Generic refusal must also observe its native lease release/exit/close");
      return true;
    });
  assert.deepEqual(lifecycle.catalog(root), originalCatalog, "Generic .git protection must not publish an owner");
  const plan = await prepare(options);
  const prepared = JSON.parse(fs.readFileSync(plan.planPath, "utf8"));
  assert.equal(plan.record.revision, 1);
  assert.equal(plan.record.version, plan.record.generation);
  assert.throws(() => apply({ planPath: plan.planPath, planSha256: "0".repeat(64) }), /SHA256/);
  assert(!fs.existsSync(plan.files.intent), "Bad plan hash must not start an apply attempt");
  const good = await apply(plan);
  assert.equal(good.success, true, JSON.stringify(good));
  assert.equal(good.worker.exit_observed, true); assert.equal(good.worker.exit_code, 0); assert.equal(good.worker.signal, null); assert.equal(good.worker.close_observed, true);
  for (const release of [good.result.nativeRelease, good.result.maintenanceRelease]) {
    assert.equal(release.native_exit_observed, true); assert.equal(release.native_exit_code, 0); assert.equal(release.native_close_observed, true); assert.equal(release.native_signal, null);
  }
  assert(good.result.windowsAttributeChecks.every(check => check.status === 0 && check.signal === null && check.stdout_drained && check.stderr_drained));
  assert(good.result.nativeSnapshot.queries.every(query => query.exit_observed && query.exit_code === 0 && query.signal === null && query.close_observed && query.stdout_drained && query.stderr_drained));
  assert(prepared.preparationAttributeChecks.every(check => check.status === 0 && check.signal === null && check.stdout_drained && check.stderr_drained));
  assert(prepared.nativeSnapshot.queries.every(query => query.exit_observed && query.exit_code === 0 && query.signal === null && query.close_observed && query.stdout_drained && query.stderr_drained));
  assert.equal(good.result.finalization.status, "finalized");
  assert(!fs.existsSync(workingRoot));
  assert(!lifecycle.catalog(root).some(record => record.id === plan.record.id));
  console.log(JSON.stringify({ status: "passed", selectedScope, fixture, root, caller: lifecycle.catalog(root).find(record => record.id === run.lifecycleId), good,
    preparation: { windowsAttributeChecks: prepared.preparationAttributeChecks, nativeQueries: prepared.nativeSnapshot.queries },
    checks: ["invalid selections and generic gitfile membership reject before publication", "bad plan SHA rejects before intent", "real native metadata/dual custody and exact control retirement", "actual worker/query/attribute/dual-native exits and closes; retirement record finalized"] }));
}
async function supervise() {
  assert(!fs.existsSync(fixture), "Fresh happy fixture required");
  const observed = await new Promise(resolve => {
    const child = spawn(process.execPath, [__filename, fixture, "happy", "--happy-worker"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    let stdout = "", stderr = "", exit = null, error = null;
    child.stdout.on("data", value => { stdout += value; }); child.stderr.on("data", value => { stderr += value; });
    child.on("error", value => { error = value.message; }); child.on("exit", (code, signal) => { exit = { code, signal }; });
    child.on("close", () => resolve({ pid: child.pid, stdout, stderr, exit, close_observed: true, error }));
  });
  assert.equal(observed.error, null, JSON.stringify(observed)); assert.equal(observed.exit?.code, 0, JSON.stringify(observed)); assert.equal(observed.exit.signal, null);
  const result = JSON.parse(observed.stdout); assert.equal(result.status, "passed");
  const proof = path.join(result.root, "artifacts/tasks/test/runs/controller/reports", "happy-supervisor-stop.json");
  fs.writeFileSync(proof, JSON.stringify({ schema: 1, producer_stopped_verified: true, process_tree_stopped_verified: true,
    worker: { pid: observed.pid, exit_code: observed.exit.code, signal: observed.exit.signal, close_observed: true }, apply: result.good.worker,
    catalogNative: result.good.result.nativeRelease, maintenanceNative: result.good.result.maintenanceRelease,
    preparation: result.preparation, windowsAttributeChecks: result.good.result.windowsAttributeChecks, nativeQueries: result.good.result.nativeSnapshot.queries }), { flag: "wx" });
  const caller = result.caller;
  const closed = lifecycle.withCatalogLock(result.root, () => lifecycle.closeLifecycle(result.root, caller.id, { owner: caller.owner, expected_revision: caller.revision,
    producer_stopped_verified: true, outcome: "success", exit_code: observed.exit.code,
    reason: "Actual fixture producer exited; all recorded apply/query/attribute/native children drained and closed", evidence_ref: proof, evidence_sha256: hash(fs.readFileSync(proof)) }),
    { operation: "test.control-caller-close", drainOnly: true });
  assert.equal(closed.producer.outcome, "success"); assert.equal(closed.references.length, 0);
  assert(!fs.existsSync(path.join(result.root, "artifacts/workspace")));
  console.log(JSON.stringify({ status: "passed", selectedScope: "happy", fixture, checks: result.checks,
    caller_closed: { id: closed.id, revision: closed.revision, producer: closed.producer }, proof, fixture_cleanup_ready: true,
    cleanup: "Supervising outer fixture owner must now remove this exact generated fixture; no gitfile/container, active child or reservation remains" }));
}
(happyWorker ? exercise() : supervise()).catch(error => { console.error(error.stack); process.exitCode = 1; });

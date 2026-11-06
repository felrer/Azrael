"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { beginArtifactRun, finishArtifactRun } = require("./artifact-run.cjs");
const { catalog, recordLifecycle, planCleanup } = require("./artifact-lifecycle.cjs");
const freezeTools = require("./freeze-platform-inputs.cjs");
const { inventoryTree } = freezeTools;
const inventoryCounts = new Map();
freezeTools.inventoryTree = (root, ...args) => {
  if (inventoryCounts.has(root)) inventoryCounts.set(root, inventoryCounts.get(root) + 1);
  return inventoryTree(root, ...args);
};
const { serializeDeploymentManifest, prepareDeploymentWorkspace, verifyDeploymentWorkspace, reuseDeploymentInputs, verifyReusedDeploymentInputs, resolveDeploymentModuleCacheOwner } = require("./deployment-workspace.cjs");
freezeTools.inventoryTree = inventoryTree;
function checkManifestSerialization() {
  const manifest = { schema: 1, path: "C:\\입력\\source", inventory: [{ path: "file", size: 7, deleted: false }], optional: null };
  const bytes = serializeDeploymentManifest(manifest);
  assert.deepEqual(JSON.parse(bytes), manifest, "compact manifest preserves every selected value");
  assert.equal(bytes.toString(), JSON.stringify(manifest) + "\n");
  const limit = 16 * 1024 * 1024;
  const overhead = Buffer.byteLength(JSON.stringify({ payload: "" }) + "\n");
  assert.equal(serializeDeploymentManifest({ payload: "a".repeat(limit - overhead) }).length, limit);
  assert.throws(() => serializeDeploymentManifest({ payload: "a".repeat(limit - overhead + 1) }), /exceeds 16 MiB registry bound/);
  assert.throws(() => serializeDeploymentManifest({ payload: "한".repeat(Math.floor((limit - overhead) / 3) + 1) }), /exceeds 16 MiB registry bound/);
}
checkManifestSerialization();
if (process.argv[2] === "--serialization-only") {
  console.log("Deployment manifest serialization: roundtrip, exact UTF-8 byte bound and oversized evidence rejection passed");
  process.exit(0);
}
const fixture = process.argv[2];
const pythonExecutable = process.env.AZRAEL_TEST_PYTHON || (process.platform === "win32" ? "python" : "python3");
assert(fixture && path.isAbsolute(fixture), "fresh absolute owned fixture required");
fs.mkdirSync(fixture);
function git(root, ...args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function setup(name, references = []) {
  const projectRoot = path.join(fixture, name);
  fs.mkdirSync(projectRoot);
  git(projectRoot, "init", "--quiet");
  git(projectRoot, "config", "user.email", "workspace@example.invalid");
  git(projectRoot, "config", "user.name", "Workspace Fixture");
  fs.writeFileSync(path.join(projectRoot, ".gitignore"), "/artifacts/\n/engine/\nnode_modules/\ndist/\n");
  fs.mkdirSync(path.join(projectRoot, "scripts"));
  fs.writeFileSync(path.join(projectRoot, "scripts/input.js"), "module.exports = 1;\n");
  fs.writeFileSync(path.join(projectRoot, "deleted.txt"), "deleted after commit");
  git(projectRoot, "add", "."); git(projectRoot, "commit", "--quiet", "-m", "source fixture");
  fs.unlinkSync(path.join(projectRoot, "deleted.txt"));
  fs.writeFileSync(path.join(projectRoot, "untracked.txt"), "selected untracked source");
  const run = beginArtifactRun(projectRoot, { owner: "deployment-workspace-test", workId: "workspace", runId: "controller", requireStopEvidence: true, references });
  // Fixture records remain pending under the caller-owned retained test boundary.
  process.removeListener("exit", run.onExit);
  const options = { projectRoot, inputRoot: path.join(projectRoot, "artifacts/inputs/input"), workingRoot: path.join(projectRoot, "artifacts/workspaces/work"),
    reportPath: path.join(run.reports, "inputs.json"), owner: run.owner, runLifecycleId: run.lifecycleId };
  return { projectRoot, run, options };
}
function stopProof(run) {
  const evidence_ref = path.join(run.reports, "tree-stopped.json");
  fs.writeFileSync(evidence_ref, JSON.stringify({ fixture: "in-process deployment controller", stopped: true }));
  return { producer_stopped_verified: true, evidence_ref,
    evidence_sha256: createHash("sha256").update(fs.readFileSync(evidence_ref)).digest("hex"),
    reason: "In-process preparation settled with no outstanding owned children" };
}
async function main() {
  const checks = [];
  const paths = setup("paths");
  for (const override of [
    { inputRoot: paths.options.workingRoot },
    { workingRoot: path.join(paths.options.inputRoot, "nested") },
    { reportPath: path.join(paths.options.inputRoot, "report.json") },
    { inputRoot: fixture },
    { owner: "wrong-owner" },
    { reportPath: path.join(paths.run.logs, "wrong-role.json") },
    { workingRoot: paths.run.temporary }
  ]) await assert.rejects(prepareDeploymentWorkspace({ ...paths.options, ...override }));
  assert(!fs.existsSync(paths.options.inputRoot));
  assert(!fs.existsSync(paths.options.workingRoot));
  const claimed = path.join(paths.projectRoot, "artifacts/workspaces/claimed");
  recordLifecycle(paths.projectRoot, { id: "prior-workspace", kind: "run", owner: "prior", state: "pending", membership_complete: false,
    members: [{ path: path.join(claimed, "scripts"), role: "source" }], expected_revision: 0 });
  await assert.rejects(prepareDeploymentWorkspace({ ...paths.options, workingRoot: claimed }), /claimed/);
  checks.push("fresh contained disjoint roots, caller ownership, report role and catalog overlap checks");
  const overrideSource = path.join(paths.projectRoot, "untracked.txt");
  const overrideHash = createHash("sha256").update(fs.readFileSync(overrideSource)).digest("hex");
  for (const override of [
    { source: overrideSource, destinationRelative: "../escape", sha256: overrideHash },
    { source: overrideSource, destinationRelative: "engine/file", sha256: overrideHash },
    { source: overrideSource, destinationRelative: ".git/config", sha256: overrideHash },
    { source: overrideSource, destinationRelative: "scripts/file", sha256: "0".repeat(64) }
  ]) await assert.rejects(prepareDeploymentWorkspace({ ...paths.options, projectOverrides: [override] }), /override/i);
  const callerDependency = { id: "fixture-runtime", kind: "dependency", reason: "Controller prerequisite remains in use" };
  const normal = setup("normal", [callerDependency]);
  const nested = path.join(normal.projectRoot, "vendor"); fs.mkdirSync(nested);
  git(nested, "init", "--quiet"); git(nested, "config", "user.email", "workspace@example.invalid"); git(nested, "config", "user.name", "Workspace Fixture");
  fs.writeFileSync(path.join(nested, "nested.txt"), "nested selected source");
  git(nested, "add", "."); git(nested, "commit", "--quiet", "-m", "nested baseline");
  git(normal.projectRoot, "add", "vendor");
  git(normal.projectRoot, "commit", "--quiet", "-m", "nested source");
  const normalOverrideSource = path.join(normal.projectRoot, "untracked.txt");
  const context = await prepareDeploymentWorkspace({ ...normal.options, projectOverrides: [{ source: normalOverrideSource, destinationRelative: "added/overlay.txt", sha256: overrideHash }] });
  assert.equal((await verifyDeploymentWorkspace(context)).status, "verified");
  assert.equal(context.moduleCacheProjectRoot, normal.projectRoot);
  assert.equal(JSON.parse(fs.readFileSync(context.reportPath, 'utf8')).moduleCacheProjectRoot, normal.projectRoot);
  await assert.rejects(verifyDeploymentWorkspace({ ...context, moduleCacheProjectRoot: context.workingRoot }), /module cache owner changed/);
  const secondWorkspace = await prepareDeploymentWorkspace({ ...normal.options, artifactProjectRoot: normal.projectRoot, projectRoot: context.immutableProjectRoot,
    inputRoot: path.join(normal.projectRoot, 'artifacts/inputs/second'), workingRoot: path.join(normal.projectRoot, 'artifacts/workspaces/second'),
    reportPath: path.join(normal.run.reports, 'second.json') });
  assert.notEqual(secondWorkspace.projectRoot, normal.projectRoot, 'frozen source identity remains distinct from stable cache owner');
  assert.equal(secondWorkspace.moduleCacheProjectRoot, context.moduleCacheProjectRoot, 'independent disposable workspaces retain the explicit stable owner');
  assert.equal((await verifyDeploymentWorkspace(secondWorkspace)).moduleCacheProjectRoot, normal.projectRoot);
  const launchOwner = spawnSync(process.execPath, [path.join(__dirname, 'deployment-workspace.cjs'), '--module-cache-owner', secondWorkspace.reportPath,
    secondWorkspace.manifestSha256, secondWorkspace.workingRoot], { encoding: 'utf8', windowsHide: true });
  assert.equal(launchOwner.status, 0, launchOwner.stderr);
  assert.equal(JSON.parse(launchOwner.stdout).moduleCacheProjectRoot, normal.projectRoot, 'actual launch CLI uses stable owner for its verified execution root');
  const launchOptions = { manifestPath: secondWorkspace.reportPath, manifestSha256: secondWorkspace.manifestSha256, projectRoot: secondWorkspace.workingRoot };
  await assert.rejects(resolveDeploymentModuleCacheOwner({ ...launchOptions, manifestSha256: '0'.repeat(64) }), /manifest changed/);
  await assert.rejects(resolveDeploymentModuleCacheOwner({ ...launchOptions, projectRoot: context.workingRoot }), /differs from selected working root/);
  const currentManifestBytes = fs.readFileSync(secondWorkspace.reportPath);
  const legacyManifest = JSON.parse(currentManifestBytes);
  delete legacyManifest.moduleCacheProjectRoot;
  delete legacyManifest.rootIdentities.moduleCacheOwner;
  fs.writeFileSync(secondWorkspace.reportPath, JSON.stringify(legacyManifest));
  try {
    const legacyContext = { ...secondWorkspace, manifestSha256: createHash('sha256').update(fs.readFileSync(secondWorkspace.reportPath)).digest('hex') };
    delete legacyContext.moduleCacheProjectRoot;
    assert.equal((await verifyDeploymentWorkspace(legacyContext)).moduleCacheProjectRoot, normal.projectRoot, 'legacy schema-1 explicit artifact owner remains readable');
  } finally { fs.writeFileSync(secondWorkspace.reportPath, currentManifestBytes); }
  checks.push('independent normal workspaces expose stable artifact owner in manifests and verified contexts, rejecting owner redirection');
  assert.equal(fs.readFileSync(path.join(context.workingRoot, "untracked.txt"), "utf8"), "selected untracked source");
  assert(!fs.existsSync(path.join(context.workingRoot, "deleted.txt")));
  assert.equal(context.projectSha256, context.workingProjectSha256);
  assert.equal(context.workingCopy.mode, 'standard-copy');
  assert.equal(context.workingCopy.contentVerified, false, 'copy completion is not content verification');
  assert.notEqual(context.baselineProjectSha256, context.projectSha256);
  assert.equal(fs.readFileSync(path.join(context.workingRoot, "added/overlay.txt"), "utf8"), "selected untracked source");
  assert(context.workingRecord.members.some(member => member.path === path.join(context.workingRoot, "added")));
  assert.equal(fs.readFileSync(path.join(context.workingRoot, "vendor/nested.txt"), "utf8"), "nested selected source");
  assert(fs.lstatSync(path.join(context.workingRoot, ".git")).isFile());
  assert(!context.workingRecord.members.some(member => member.path === path.join(context.workingRoot, ".git")));
  assert(context.workingRecord.members.some(member => member.path === path.join(context.workingRoot, "control")));
  assert.equal(context.inputRecord.kind, "work");
  assert.equal(context.inputRecord.state, "complete");
  assert.equal(context.workingRecord.kind, "run");
  assert(context.runRecord.references.some(ref => ref.id === context.workingLifecycleId && ref.kind === "execution"));
  assert(context.runRecord.references.some(ref => ref.id === context.inputLifecycleId && ref.kind === "execution"));
  assert.deepEqual(context.workingRecord.references.find(ref => ref.id === context.inputLifecycleId).member_paths, [context.inputRoot]);
  assert.deepEqual(context.runRecord.references.find(ref => ref.id === context.inputLifecycleId).member_paths, [context.inputRoot]);
  assert.deepEqual(context.runRecord.references.find(ref => ref.id === context.workingLifecycleId).member_paths,
    require("./artifact-lifecycle.cjs").projectMembers(context.workingRecord.members).map(member => member.path));
  assert(context.runRecord.references.every(ref => ref.target_revision === undefined && ref.target_version === undefined));
  assert.equal(normal.run.record.revision, secondWorkspace.runRecord.revision);
  assert.deepEqual(normal.run.record.references, secondWorkspace.runRecord.references);
  assert(!context.workingRecord.members.some(member => member.path === context.workingRoot || member.path === path.join(context.workingRoot, "artifacts")));
  const output = path.join(context.workingRoot, "artifacts/version");
  recordLifecycle(normal.projectRoot, { id: "separate-version", kind: "version", owner: "producer", state: "pending", membership_complete: false,
    members: [{ path: output, role: "release" }], expected_revision: 0 });
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "generated.bin"), "generated");
  fs.mkdirSync(path.join(context.workingRoot, "scripts/node_modules"));
  fs.writeFileSync(path.join(context.workingRoot, "scripts/node_modules/generated.js"), "ignored generated output");
  assert.equal((await verifyDeploymentWorkspace(context)).status, "verified");
  fs.writeFileSync(path.join(normal.projectRoot, "untracked.txt"), "later checkout change is excluded");
  assert.equal((await verifyDeploymentWorkspace(context)).status, "verified");
  checks.push("tracked/untracked/deleted/nested snapshot, explicit override hashes and new top-level ownership, independent working source, generated artifacts separately owned, later checkout edits excluded");
  const workingDependency = context.workingRecord.references.find(ref => ref.id === context.inputLifecycleId);
  const completed = finishArtifactRun(normal.run, { exitCode: 0, producerStopped: true, stopEvidence: stopProof(normal.run) });
  assert.equal(completed.state, "complete");
  assert.equal(completed.producer.exit_code, 0);
  assert(completed.references.every(ref => ref.kind !== "execution"));
  assert.equal(completed.references.find(ref => ref.id === callerDependency.id).reason, callerDependency.reason);
  assert.deepEqual(catalog(normal.projectRoot).find(record => record.id === context.workingLifecycleId).references.find(ref => ref.id === context.inputLifecycleId), workingDependency);
  assert.equal(fs.readFileSync(path.join(context.immutableProjectRoot, "untracked.txt"), "utf8"), "selected untracked source");
  checks.push("prepared and verified source finishes through synchronized caller revision; scoped execution references released and working input dependency preserved");
  const reusable = setup("reusable");
  const frozen = await prepareDeploymentWorkspace(reusable.options);
  const originalManifest = fs.readFileSync(frozen.reportPath);
  const originalInventory = inventoryTree(frozen.inputRoot).sha256;
  const originalProducer = finishArtifactRun(reusable.run, { exitCode: 7, producerStopped: true, stopEvidence: stopProof(reusable.run), reason: "Fixture downstream stage failed after successful immutable input preparation" });
  assert.equal(originalProducer.producer.outcome, "failure");
  assert.equal(catalog(reusable.projectRoot).find(record => record.id === frozen.inputLifecycleId).producer.outcome, "success");
  const consumers = ["first", "second"].map(runId => {
    const run = beginArtifactRun(reusable.projectRoot, { owner: "reuse-test", workId: "reuse", runId, requireStopEvidence: true, references: [callerDependency] });
    process.removeListener("exit", run.onExit);
    return run;
  });
  const reuseOptions = run => ({ artifactProjectRoot: reusable.projectRoot, owner: run.owner, runLifecycleId: run.lifecycleId,
    reportPath: path.join(run.reports, "reuse.json"), inputManifestPath: frozen.reportPath, inputManifestSha256: frozen.manifestSha256, expectedProjectSha256: frozen.projectSha256 });
  const beforeIds = catalog(reusable.projectRoot).map(record => record.id);
  for (const override of [{ owner: "wrong" }, { expectedProjectSha256: "0".repeat(64) }, { inputManifestSha256: "0".repeat(64) },
    { reportPath: frozen.reportPath }, { reportPath: path.join(consumers[0].logs, "wrong.json") }, { inputManifestPath: undefined }])
    await assert.rejects(reuseDeploymentInputs({ ...reuseOptions(consumers[0]), ...override }));
  assert.deepEqual(catalog(reusable.projectRoot).map(record => record.id), beforeIds);
  assert.equal(consumers[0].record.references.filter(ref => ref.kind === "execution").length, 0);
  const reservationDirectory = path.join(reusable.projectRoot, "artifacts/maintenance/lifecycles/reservations");
  fs.mkdirSync(reservationDirectory);
  try {
    for (const id of [frozen.inputLifecycleId, reusable.run.lifecycleId]) {
      const reservationFile = path.join(reservationDirectory, createHash("sha256").update(JSON.stringify(id)).digest("hex") + ".json");
      fs.writeFileSync(reservationFile, "{}"); // Even an uncertain cleanup reservation must block a new consumer.
      try { await assert.rejects(reuseDeploymentInputs(reuseOptions(consumers[0])), /cleanup reservation/); }
      finally { fs.unlinkSync(reservationFile); }
    }
  } finally { fs.rmdirSync(reservationDirectory); }
  assert.equal(consumers[0].record.references.filter(ref => ref.kind === "execution").length, 0);
  fs.writeFileSync(path.join(reusable.projectRoot, "scripts/input.js"), "later live checkout ignored");
  // Simulate retirement of the old working copy; immutable reuse must never inspect it.
  const retiredWorking = frozen.workingRoot + "-retired";
  fs.renameSync(frozen.workingRoot, retiredWorking);
  let firstReuse, secondReuse;
  try {
    firstReuse = await reuseDeploymentInputs(reuseOptions(consumers[0]));
    secondReuse = await reuseDeploymentInputs(reuseOptions(consumers[1]));
    for (const reused of [firstReuse, secondReuse]) {
      assert.equal(reused.moduleCacheProjectRoot, reusable.projectRoot);
      assert.equal(reused.readOnly, true);
      assert.equal(reused.sourceRoot, frozen.immutableProjectRoot);
      assert.equal(reused.inputManifestLifecycleId, reusable.run.lifecycleId);
      assert.equal(reused.inputManifestMemberPath, reusable.run.runRoot);
      assert.equal(reused.inputManifestReportsPath, reusable.run.reports);
      assert.equal(reused.copiedFileCount, 0); assert.equal(reused.copiedBytes, 0);
      assert.equal((await verifyReusedDeploymentInputs(reused)).status, "verified");
      assert.equal(reused.workingRoot, undefined);
    }
    assert.equal(fs.existsSync(frozen.workingRoot), false);
  } finally { fs.renameSync(retiredWorking, frozen.workingRoot); }
  assert.equal(inventoryTree(frozen.inputRoot).sha256, originalInventory);
  assert.deepEqual(fs.readFileSync(frozen.reportPath), originalManifest);
  assert.deepEqual(catalog(reusable.projectRoot).map(record => record.id), beforeIds, "reuse creates no input/workspace producer records");
  assert.equal(consumers[0].record.revision, firstReuse.runRecord.revision);
  assert(consumers[0].record.references.some(ref => ref.id === callerDependency.id));
  await assert.rejects(verifyReusedDeploymentInputs({ ...firstReuse, immutableProjectRoot: reusable.projectRoot }), /selection mismatch/);
  await assert.rejects(verifyReusedDeploymentInputs({ ...firstReuse, expectedProjectSha256: "0".repeat(64) }), /selection mismatch/);
  await assert.rejects(verifyReusedDeploymentInputs({ ...firstReuse, sourceRoot: reusable.projectRoot }), /selection mismatch/);
  await assert.rejects(verifyReusedDeploymentInputs({ ...firstReuse, immutableEngineRoot: reusable.projectRoot }), /selection mismatch/);
  await assert.rejects(verifyReusedDeploymentInputs({ ...firstReuse, projectSha256: "0".repeat(64) }), /selection mismatch/);
  await assert.rejects(verifyReusedDeploymentInputs({ ...firstReuse, engine: { fingerprint: "forged" } }), /identity mismatch/);
  await assert.rejects(reuseDeploymentInputs(reuseOptions(consumers[0])), /Fresh/);
  const cleanup = () => planCleanup(reusable.projectRoot, { paths: [frozen.inputRoot] }).groups.find(group => group.id === frozen.inputLifecycleId);
  for (const run of consumers) assert(cleanup().blockers.includes(`active-reference:${run.lifecycleId}`));
  const manifestCleanup = () => planCleanup(reusable.projectRoot, { paths: [reusable.run.runRoot] }).groups.find(group => group.id === reusable.run.lifecycleId);
  for (const run of consumers) assert(manifestCleanup().blockers.includes(`active-reference:${run.lifecycleId}`));
  const referenceBytes = fs.readFileSync(firstReuse.reportPath);
  fs.appendFileSync(firstReuse.reportPath, " ");
  await assert.rejects(verifyReusedDeploymentInputs(firstReuse), /reference manifest changed/);
  fs.writeFileSync(firstReuse.reportPath, referenceBytes);
  const frozenFile = path.join(frozen.immutableProjectRoot, "untracked.txt");
  const frozenBytes = fs.readFileSync(frozenFile);
  fs.writeFileSync(frozenFile, "immutable reuse tamper");
  await assert.rejects(verifyReusedDeploymentInputs(firstReuse), /inventory changed/);
  // A post-claim failure holds references, and closes with its actual failure outcome.
  const failedConsumer = beginArtifactRun(reusable.projectRoot, { owner: "reuse-test", workId: "reuse", runId: "failed", requireStopEvidence: true });
  process.removeListener("exit", failedConsumer.onExit);
  await assert.rejects(reuseDeploymentInputs(reuseOptions(failedConsumer)), /inventory changed/);
  assert(failedConsumer.record.references.some(ref => ref.kind === "execution" && ref.id === frozen.inputLifecycleId));
  const failedReuse = finishArtifactRun(failedConsumer, { exitCode: 9, producerStopped: true, stopEvidence: stopProof(failedConsumer) });
  assert.equal(failedReuse.producer.exit_code, 9); assert.equal(failedReuse.producer.outcome, "failure");
  assert(failedReuse.references.every(ref => ref.kind !== "execution"));
  fs.writeFileSync(frozenFile, frozenBytes);
  const linkedFrozenFile = path.join(reusable.projectRoot, "artifacts/linked-frozen-input");
  fs.linkSync(frozenFile, linkedFrozenFile);
  try { await assert.rejects(verifyReusedDeploymentInputs(firstReuse), /Linked or alternate/); }
  finally { fs.unlinkSync(linkedFrozenFile); }
  fs.appendFileSync(frozen.reportPath, " ");
  await assert.rejects(verifyReusedDeploymentInputs(firstReuse), /manifest changed/);
  fs.writeFileSync(frozen.reportPath, originalManifest);
  const displacedRoot = frozen.inputRoot + "-displaced";
  fs.renameSync(frozen.inputRoot, displacedRoot);
  try {
    fs.cpSync(displacedRoot, frozen.inputRoot, { recursive: true });
    await assert.rejects(verifyReusedDeploymentInputs(firstReuse), /root identity changed/);
    await assert.rejects(reuseDeploymentInputs({ ...reuseOptions(consumers[1]), reportPath: path.join(consumers[1].reports, "replacement.json") }), /root identity changed/);
  } finally {
    fs.rmSync(frozen.inputRoot, { recursive: true });
    fs.renameSync(displacedRoot, frozen.inputRoot);
  }
  const displacedSource = frozen.inputRoot + "-source-displaced";
  fs.renameSync(frozen.immutableProjectRoot, displacedSource);
  try {
    fs.cpSync(displacedSource, frozen.immutableProjectRoot, { recursive: true });
    await assert.rejects(verifyReusedDeploymentInputs(firstReuse), /root identity changed/);
  } finally {
    fs.rmSync(frozen.immutableProjectRoot, { recursive: true });
    fs.renameSync(displacedSource, frozen.immutableProjectRoot);
  }
  // Registry ownership is mandatory even when the immutable bytes and manifest remain intact.
  const registryFile = require("./artifact-lifecycle.cjs").registryPath(reusable.projectRoot, frozen.inputLifecycleId);
  const registryBytes = fs.readFileSync(registryFile);
  try {
    for (const change of [{ state: "pending", membership_complete: false }, { state: "failed", producer: { ...frozen.inputRecord.producer, outcome: "failure", exit_code: 3 } },
      { producer: { ...frozen.inputRecord.producer, outcome: "unknown", exit_code: null } }, { owner: "different-owner" },
      { members: frozen.inputRecord.members.map(member => ({ ...member, role: "moved-input" })) }]) {
      fs.writeFileSync(registryFile, JSON.stringify({ ...frozen.inputRecord, ...change }));
      await assert.rejects(verifyReusedDeploymentInputs(firstReuse), /original input owner/);
      await assert.rejects(reuseDeploymentInputs({ ...reuseOptions(consumers[1]), reportPath: path.join(consumers[1].reports, "invalid-owner.json") }), /original input owner/);
    }
    fs.unlinkSync(registryFile);
    await assert.rejects(verifyReusedDeploymentInputs(firstReuse), /original input owner/);
  } finally { fs.writeFileSync(registryFile, registryBytes); }
  const manifestRegistry = require("./artifact-lifecycle.cjs").registryPath(reusable.projectRoot, reusable.run.lifecycleId);
  const manifestRegistryBytes = fs.readFileSync(manifestRegistry);
  try {
    const changedReportsOwner = JSON.parse(manifestRegistryBytes);
    changedReportsOwner.members = changedReportsOwner.members.map(member => member.role === "reports" ? { ...member, role: "moved-reports" } : member);
    fs.writeFileSync(manifestRegistry, JSON.stringify(changedReportsOwner));
    await assert.rejects(verifyReusedDeploymentInputs(firstReuse), /manifest reports owner/);
  } finally { fs.writeFileSync(manifestRegistry, manifestRegistryBytes); }
  assert.equal((await verifyReusedDeploymentInputs(firstReuse)).status, "verified");
  const firstFinished = finishArtifactRun(consumers[0], { exitCode: 0, producerStopped: true, stopEvidence: stopProof(consumers[0]) });
  assert(firstFinished.references.some(ref => ref.id === callerDependency.id));
  assert(!cleanup().blockers.includes(`active-reference:${consumers[0].lifecycleId}`));
  assert(cleanup().blockers.includes(`active-reference:${consumers[1].lifecycleId}`));
  finishArtifactRun(consumers[1], { exitCode: 0, producerStopped: true, stopEvidence: stopProof(consumers[1]) });
  assert(!cleanup().blockers.includes(`active-reference:${consumers[1].lifecycleId}`));
  assert(!manifestCleanup().blockers.includes(`active-reference:${consumers[1].lifecycleId}`));
  assert.equal((await verifyReusedDeploymentInputs(firstReuse)).status, "verified", "reference identity verification survives truthful caller closure");
  assert.equal(inventoryTree(frozen.inputRoot).sha256, originalInventory);
  assert.deepEqual(fs.readFileSync(frozen.reportPath), originalManifest);
  checks.push("two read-only callers reuse frozen inputs without copying or new producers; absent old working copy and later checkout ignored; hashes, ownership, root identity, tampering, truthful failure closure and scoped cleanup protections enforced");
  const preparationFailure = setup("preparation-failure");
  const initialRevision = preparationFailure.run.record.revision;
  const mkdir = fs.mkdirSync;
  let boundaryReached = false;
  fs.mkdirSync = function (destination, ...args) {
    if (path.resolve(destination) === path.join(preparationFailure.options.inputRoot, "project")) {
      boundaryReached = true;
      throw Error("Intentional immutable Git preparation failure");
    }
    return mkdir.call(fs, destination, ...args);
  };
  try { await assert.rejects(prepareDeploymentWorkspace(preparationFailure.options), /Intentional immutable Git preparation failure/); }
  finally { fs.mkdirSync = mkdir; }
  assert.equal(boundaryReached, true);
  const updatedCaller = catalog(preparationFailure.projectRoot).find(record => record.id === preparationFailure.run.lifecycleId);
  assert(updatedCaller.revision > initialRevision);
  assert.equal(preparationFailure.run.record.revision, updatedCaller.revision);
  const claimedInputs = updatedCaller.references.filter(ref => ref.kind === "execution");
  assert(claimedInputs.some(ref => ref.member_paths.includes(preparationFailure.options.inputRoot)));
  assert(claimedInputs.some(ref => ref.member_paths.some(member => member.startsWith(preparationFailure.options.workingRoot + path.sep))));
  const failure = finishArtifactRun(preparationFailure.run, { exitCode: 7, producerStopped: true,
    stopEvidence: stopProof(preparationFailure.run), reason: "Immutable Git preparation failed" });
  assert.equal(failure.state, "failed");
  assert.equal(failure.producer.outcome, "failure");
  assert.equal(failure.producer.exit_code, 7);
  assert.equal(failure.membership_complete, true);
  assert(failure.references.every(ref => ref.kind !== "execution"));
  assert.equal(JSON.parse(fs.readFileSync(failure.producer.evidence_ref, "utf8")).exitCode, 7);
  assert.equal(catalog(preparationFailure.projectRoot).find(record => record.id === claimedInputs.find(ref => ref.member_paths.includes(preparationFailure.options.inputRoot)).id).state, "pending");
  checks.push("preparation failure after durable caller reference update closes actual nonzero failure with synchronized revision while incomplete inputs remain pending");
  const sentinelPath = path.join(context.workingRoot, ".git");
  const sentinelText = fs.readFileSync(sentinelPath, "utf8");
  fs.appendFileSync(sentinelPath, "changed control evidence\n");
  await assert.rejects(verifyDeploymentWorkspace(context), /Git control evidence changed/);
  const sentinelHandle = fs.openSync(sentinelPath, "r+");
  try { fs.writeSync(sentinelHandle, sentinelText, 0, "utf8"); fs.ftruncateSync(sentinelHandle, Buffer.byteLength(sentinelText)); }
  finally { fs.closeSync(sentinelHandle); }
  fs.writeFileSync(path.join(context.workingRoot, "scripts/input.js"), "compiled source tamper");
  await assert.rejects(verifyDeploymentWorkspace(context), /Compiled project/);
  fs.writeFileSync(path.join(context.workingRoot, "scripts/input.js"), "module.exports = 1;\n");
  const immutableFile = path.join(context.immutableProjectRoot, "untracked.txt");
  fs.writeFileSync(immutableFile, "immutable input tamper");
  await assert.rejects(verifyDeploymentWorkspace(context), /Immutable/);
  fs.writeFileSync(immutableFile, "selected untracked source");
  fs.appendFileSync(context.reportPath, " ");
  await assert.rejects(verifyDeploymentWorkspace(context), /manifest changed/);
  checks.push("working source, immutable payload and independent manifest changes rejected");
  const imported = setup("ambiguous-engine");
  const engine = path.join(imported.projectRoot, "engine"); fs.mkdirSync(engine);
  fs.writeFileSync(path.join(engine, "SOURCE.json"), "{}"); fs.mkdirSync(path.join(engine, ".git"));
  await assert.rejects(prepareDeploymentWorkspace({ ...imported.options, engineSourceRoot: engine }), /without Git metadata/);
  assert(!fs.existsSync(imported.options.inputRoot));
  checks.push("imported engine Git ambiguity rejected before copy");
  const engineCase = setup("imported-engine");
  for (const name of ["engine-provenance.py", "import-engine-source.py", "azrael-platforms.json"]) fs.copyFileSync(path.join(__dirname, name), path.join(engineCase.projectRoot, "scripts", name));
  const derivedCase = setup("derived");
  const derivedVendor = path.join(derivedCase.projectRoot, 'vendor');
  fs.mkdirSync(derivedVendor); git(derivedVendor, 'init', '--quiet');
  git(derivedVendor, 'config', 'user.email', 'workspace@example.invalid'); git(derivedVendor, 'config', 'user.name', 'Workspace Fixture');
  fs.writeFileSync(path.join(derivedVendor, 'nested.txt'), 'unchanged nested source');
  git(derivedVendor, 'add', '.'); git(derivedVendor, 'commit', '--quiet', '-m', 'nested baseline');
  git(derivedCase.projectRoot, 'add', 'vendor'); git(derivedCase.projectRoot, 'commit', '--quiet', '-m', 'selected nested source');
  const derivedBaseline = await prepareDeploymentWorkspace(derivedCase.options);
  const baselineState = inventoryTree(derivedBaseline.inputRoot).sha256;
  const baselineScript = path.join(derivedBaseline.immutableProjectRoot, 'scripts/input.js');
  const baselineScriptBytes = fs.readFileSync(baselineScript);
  inventoryCounts.set(derivedBaseline.inputRoot, 0);
  const sourceInputs = await reuseDeploymentInputs({ artifactProjectRoot: derivedCase.projectRoot, owner: derivedCase.run.owner, runLifecycleId: derivedCase.run.lifecycleId,
    reportPath: path.join(derivedCase.run.reports, 'baseline-reference.json'), inputManifestPath: derivedBaseline.reportPath,
    inputManifestSha256: derivedBaseline.manifestSha256, expectedProjectSha256: derivedBaseline.projectSha256 });
  const correction = path.join(derivedCase.run.inputs, 'script.js');
  fs.writeFileSync(correction, 'module.exports = 2;\n');
  const correctionSha = createHash('sha256').update(fs.readFileSync(correction)).digest('hex');
  const deltaOptions = { sourceInputs, inputRoot: path.join(derivedCase.projectRoot, 'artifacts/inputs/delta'), workingRoot: path.join(derivedCase.projectRoot, 'artifacts/derived'),
    reportPath: path.join(derivedCase.run.reports, 'delta.json'), projectOverrides: [{ source: correction, destinationRelative: 'scripts/input.js', sha256: correctionSha }] };
  for (const invalid of [
    { owner: 'wrong' }, { projectRoot: derivedCase.projectRoot }, { workingRoot: deltaOptions.inputRoot },
    { projectOverrides: [{ source: correction, destinationRelative: 'engine/file.cjs', sha256: correctionSha }] },
    { projectOverrides: [{ source: correction, destinationRelative: 'scripts/../escape.js', sha256: correctionSha }] },
    { projectOverrides: [{ source: correction, destinationRelative: 'scripts/new.js', sha256: correctionSha }] },
    { projectOverrides: [{ source: correction, destinationRelative: 'scripts/input.js', sha256: '0'.repeat(64) }] }
  ]) await assert.rejects(prepareDeploymentWorkspace({ ...deltaOptions, ...invalid }));
  assert(!fs.existsSync(deltaOptions.inputRoot));
  const derived = await prepareDeploymentWorkspace(deltaOptions);
  assert.equal(inventoryCounts.get(derivedBaseline.inputRoot), 4, 'same-process handoff keeps first/final full scans, each with before/after inventory');
  const deltaAttempt = (name, selected = sourceInputs) => ({ ...deltaOptions, sourceInputs: selected, inputRoot: path.join(derivedCase.projectRoot, 'artifacts/inputs', name),
    workingRoot: path.join(derivedCase.projectRoot, 'artifacts', name), reportPath: path.join(path.dirname(selected.reportPath), name + '.json') });
  inventoryCounts.set(derivedBaseline.inputRoot, 0);
  await prepareDeploymentWorkspace(deltaAttempt('replayed'));
  assert.equal(inventoryCounts.get(derivedBaseline.inputRoot), 4, 'a consumed handoff falls back to full entry and final scans');
  const handoffConsumers = [];
  const freshReuse = name => {
    const run = beginArtifactRun(derivedCase.projectRoot, { owner: derivedCase.run.owner, workId: 'handoff', runId: name, requireStopEvidence: true });
    process.removeListener('exit', run.onExit);
    handoffConsumers.push(run);
    return reuseDeploymentInputs({ artifactProjectRoot: derivedCase.projectRoot, owner: run.owner, runLifecycleId: run.lifecycleId,
      reportPath: path.join(run.reports, 'reference.json'), inputManifestPath: derivedBaseline.reportPath,
      inputManifestSha256: derivedBaseline.manifestSha256, expectedProjectSha256: derivedBaseline.projectSha256 });
  };
  inventoryCounts.set(derivedBaseline.inputRoot, 0);
  const serializedReuse = JSON.parse(JSON.stringify(await freshReuse('serialized')));
  await prepareDeploymentWorkspace(deltaAttempt('serialized', serializedReuse));
  assert.equal(inventoryCounts.get(derivedBaseline.inputRoot), 6, 'JSON does not transfer a private handoff; all three full scans run');
  const changedReuse = await freshReuse('changed');
  fs.appendFileSync(baselineScript, '// changed before capture');
  try { await assert.rejects(prepareDeploymentWorkspace(deltaAttempt('changed', changedReuse)), /inventory changed/); }
  finally { fs.writeFileSync(baselineScript, baselineScriptBytes); }
  const finalReuse = await freshReuse('final');
  const finalOptions = deltaAttempt('final', finalReuse);
  const copyBeforeFinal = fs.copyFileSync;
  fs.copyFileSync = (from, to, ...args) => {
    const result = copyBeforeFinal(from, to, ...args);
    if (to === path.join(finalOptions.workingRoot, 'scripts/input.js')) fs.appendFileSync(baselineScript, '// changed after capture');
    return result;
  };
  try { await assert.rejects(prepareDeploymentWorkspace(finalOptions), /inventory changed/); }
  finally { fs.copyFileSync = copyBeforeFinal; fs.writeFileSync(baselineScript, baselineScriptBytes); }
  const corruptReuse = await freshReuse('copy-corrupt'), corruptOptions = deltaAttempt('copy-corrupt', corruptReuse);
  const nativeCopy = fs.promises.copyFile;
  fs.promises.copyFile = async (from, to, ...args) => {
    const result = await nativeCopy(from, to, ...args);
    if (to === path.join(corruptOptions.workingRoot, 'untracked.txt')) fs.appendFileSync(to, 'corrupt copied content');
    return result;
  };
  let corruptContext;
  try { corruptContext = await prepareDeploymentWorkspace(corruptOptions); }
  finally { fs.promises.copyFile = nativeCopy; }
  assert.equal(corruptContext.workingCopy.contentVerified, false);
  await assert.rejects(verifyDeploymentWorkspace(corruptContext), /working source differs/, 'required consumer verification still rejects a bad copy');
  const failedCopyReuse = await freshReuse('copy-error'), failedCopyOptions = deltaAttempt('copy-error', failedCopyReuse);
  fs.promises.copyFile = async () => { throw new Error('intentional native copy error'); };
  try { await assert.rejects(prepareDeploymentWorkspace(failedCopyOptions), /intentional native copy error/); }
  finally { fs.promises.copyFile = nativeCopy; }
  const forgedReuse = await freshReuse('forged');
  const originalOwner = forgedReuse.owner;
  forgedReuse.owner = 'forged-owner';
  await assert.rejects(prepareDeploymentWorkspace(deltaAttempt('forged', forgedReuse)), /caller|consumer|mismatch|required/);
  forgedReuse.owner = originalOwner;
  for (const run of handoffConsumers) finishArtifactRun(run, { exitCode: 0, producerStopped: true, stopEvidence: stopProof(run) });
  checks.push('private single-use handoff reduces full baseline scans from three to two; serialized/replayed inputs and changed source cannot bypass verification');
  assert.equal(derived.moduleCacheProjectRoot, derivedCase.projectRoot);
  assert.equal(JSON.parse(fs.readFileSync(derived.reportPath, 'utf8')).moduleCacheProjectRoot, derivedCase.projectRoot);
  await assert.rejects(verifyDeploymentWorkspace({ ...derived, moduleCacheProjectRoot: derived.workingRoot }), /module cache owner changed/);
  assert.equal((await resolveDeploymentModuleCacheOwner({ manifestPath: derived.reportPath, manifestSha256: derived.manifestSha256, projectRoot: derived.workingRoot })).moduleCacheProjectRoot, derivedCase.projectRoot);
  await assert.rejects(resolveDeploymentModuleCacheOwner({ manifestPath: sourceInputs.reportPath, manifestSha256: sourceInputs.manifestSha256, projectRoot: derived.workingRoot }), /Writable deployment workspace required/);
  assert.equal(derived.schema, 2); assert.equal(derived.inputKind, 'script-delta');
  assert.equal(derived.projectCopy.mode, 'standard-copy');
  assert.equal(derived.projectCopy.contentVerified, false);
  assert.equal(derived.immutableProjectRoot, null, 'a layered input never pretends to have a merged immutable checkout');
  assert.equal(derived.projectCopy.sha256, sourceInputs.projectSha256);
  assert.equal(derived.immutableInventory.files.length, 1, 'only changed bytes are stored in the new immutable input');
  assert.equal(derived.immutableInventory.files[0].path, 'overrides/scripts/input.js');
  assert.equal(fs.existsSync(path.join(derived.inputRoot, 'project')), false);
  assert.equal((await verifyDeploymentWorkspace(derived)).status, 'verified');
  assert.notEqual(derived.projectSha256, sourceInputs.projectSha256);
  assert.equal(fs.readFileSync(path.join(derived.workingRoot, 'scripts/input.js'), 'utf8'), 'module.exports = 2;\n');
  assert.deepEqual(fs.readFileSync(baselineScript), baselineScriptBytes);
  assert.equal(inventoryTree(derivedBaseline.inputRoot).sha256, baselineState);
  const deltaOwner = catalog(derivedCase.projectRoot).find(record => record.id === derived.inputLifecycleId);
  assert(deltaOwner.references.some(reference => reference.id === derivedBaseline.inputLifecycleId && reference.kind === 'dependency'));
  assert(deltaOwner.references.some(reference => reference.id === derivedCase.run.lifecycleId && reference.kind === 'dependency'));
  const deltaFile = derived.projectOverrides[0].source;
  const deltaBytes = fs.readFileSync(deltaFile);
  fs.appendFileSync(deltaFile, 'tamper');
  await assert.rejects(verifyDeploymentWorkspace(derived), /inventory changed/);
  fs.writeFileSync(deltaFile, deltaBytes);
  const changedWorking = path.join(derived.workingRoot, 'untracked.txt');
  const unchangedBytes = fs.readFileSync(changedWorking);
  fs.writeFileSync(changedWorking, 'undeclared working edit');
  await assert.rejects(verifyDeploymentWorkspace(derived), /working source differs/);
  fs.writeFileSync(changedWorking, unchangedBytes);
  fs.appendFileSync(baselineScript, 'baseline tamper');
  await assert.rejects(verifyDeploymentWorkspace(derived), /inventory changed/);
  fs.writeFileSync(baselineScript, baselineScriptBytes);
  assert.equal((await verifyDeploymentWorkspace(derived)).status, 'verified');
  const failedDeltaOptions = { ...deltaOptions, inputRoot: path.join(derivedCase.projectRoot, 'artifacts/inputs/failed-delta'),
    workingRoot: path.join(derivedCase.projectRoot, 'artifacts/failed-derived'), reportPath: path.join(derivedCase.run.reports, 'failed-delta.json') };
  const copyFile = fs.copyFileSync;
  fs.copyFileSync = (source, destination, ...args) => {
    if (source === correction) throw Error('intentional delta freeze failure');
    return copyFile(source, destination, ...args);
  };
  try { await assert.rejects(prepareDeploymentWorkspace(failedDeltaOptions), /intentional delta freeze failure/); }
  finally { fs.copyFileSync = copyFile; }
  for (const record of catalog(derivedCase.projectRoot).filter(record => record.members.some(member => member.path.startsWith(failedDeltaOptions.inputRoot) || member.path.startsWith(failedDeltaOptions.workingRoot)))) {
    assert.equal(record.producer.status, 'stopped'); assert.equal(record.producer.outcome, 'failure');
    assert.equal(record.membership_complete, true);
  }
  finishArtifactRun(derivedCase.run, { exitCode: 0, producerStopped: true, stopEvidence: stopProof(derivedCase.run) });
  assert.equal((await verifyDeploymentWorkspace(derived)).status, 'verified', 'durable baseline dependencies outlive the producer execution');
  checks.push('script delta stores only exact changed files, independently verifies derived source, protects baseline and manifests, rejects tampering and closes prelaunch failures');
  const engineSource = path.join(fixture, "engine-source"); fs.mkdirSync(engineSource);
  git(engineSource, "init", "--quiet"); git(engineSource, "config", "user.email", "workspace@example.invalid"); git(engineSource, "config", "user.name", "Workspace Fixture");
  fs.writeFileSync(path.join(engineSource, "source.txt"), "engine source fixture");
  fs.writeFileSync(path.join(engineSource, ".gitignore"), "codex-rs/target/\n");
  git(engineSource, "add", "."); git(engineSource, "commit", "--quiet", "-m", "engine baseline");
  git(engineSource, "remote", "add", "origin", "https://github.com/openai/codex.git"); git(engineSource, "tag", "rust-v0.159.3");
  const engineDestination = path.join(engineCase.projectRoot, "engine");
  const importer = spawnSync(pythonExecutable, ["-B", path.join(__dirname, "import-engine-source.py"), "--source", engineSource, "--destination", engineDestination, "--allow-source-advance"], { encoding: "utf8", windowsHide: true });
  assert.equal(importer.status, 0, importer.error?.message || importer.stderr || "Imported fixture creation failed");
  const unexpectedEngineSource = path.join(engineDestination, "unrecorded.txt");
  fs.writeFileSync(unexpectedEngineSource, "unrecorded engine input");
  await assert.rejects(prepareDeploymentWorkspace({ ...engineCase.options, engineSourceRoot: engineDestination, pythonExecutable }), /Destination coverage differs/);
  assert(!fs.existsSync(engineCase.options.inputRoot), "invalid engine must not create immutable inputs");
  assert(!fs.existsSync(engineCase.options.workingRoot), "invalid engine must not create a working copy");
  fs.unlinkSync(unexpectedEngineSource);
  checks.push("invalid imported inventory rejected before deployment copies");
  const engineContext = await prepareDeploymentWorkspace({ ...engineCase.options, engineSourceRoot: engineDestination, pythonExecutable });
  assert.equal((await verifyDeploymentWorkspace(engineContext)).status, "verified");
  // Later performance edits must not turn the preflight reuse into trust in a
  // replacement source directory, even when its bytes still match the receipt.
  const swapped = setup("engine-root-swap"), mkdirBeforeSwap = fs.mkdirSync;
  for (const name of ["engine-provenance.py", "import-engine-source.py", "azrael-platforms.json"]) fs.copyFileSync(path.join(__dirname, name), path.join(swapped.projectRoot, "scripts", name));
  const originalEngine = path.join(fixture, "engine-before-swap"), replacementEngine = path.join(fixture, "engine-replacement");
  let didSwap = false;
  fs.mkdirSync = function (destination, ...args) {
    const result = mkdirBeforeSwap(destination, ...args);
    if (!didSwap && destination === path.join(swapped.options.inputRoot, "project")) {
      didSwap = true;
      fs.renameSync(engineDestination, originalEngine);
      fs.cpSync(originalEngine, engineDestination, { recursive: true, force: false, errorOnExist: true });
    }
    return result;
  };
  try {
    await assert.rejects(prepareDeploymentWorkspace({ ...swapped.options, engineSourceRoot: engineDestination, pythonExecutable }), /Engine source root changed/);
  } finally {
    fs.mkdirSync = mkdirBeforeSwap;
    if (didSwap) {
      fs.renameSync(engineDestination, replacementEngine);
      fs.renameSync(originalEngine, engineDestination);
    }
  }
  checks.push("preflight reuse rejects a byte-identical source root replacement before freeze completion");
  const reviewedValidator = path.join(engineCase.run.inputs, "engine-provenance.py");
  fs.writeFileSync(reviewedValidator, fs.readFileSync(path.join(__dirname, "engine-provenance.py"), "utf8") +
    "\n_original_snapshot = snapshot\ndef snapshot(root, target=TARGET):\n    result = _original_snapshot(root, target)\n    result['reviewedPolicy'] = 'fixture'\n    return result\n");
  const validatorOverride = await prepareDeploymentWorkspace({ ...engineCase.options,
    inputRoot: path.join(engineCase.projectRoot, "artifacts/inputs/validator-override"),
    workingRoot: path.join(engineCase.projectRoot, "artifacts/workspaces/validator-override"),
    reportPath: path.join(engineCase.run.reports, "validator-override.json"), engineSourceRoot: engineDestination, pythonExecutable,
    projectOverrides: [{ source: reviewedValidator, destinationRelative: "scripts/engine-provenance.py",
      sha256: createHash("sha256").update(fs.readFileSync(reviewedValidator)).digest("hex") }] });
  assert.equal(validatorOverride.engine.reviewedPolicy, "fixture");
  assert.equal((await verifyDeploymentWorkspace(validatorOverride)).status, "verified");
  checks.push("changed provenance tools use the reviewed frozen validator instead of reusing the old preflight");
  const engineConsumer = beginArtifactRun(engineCase.projectRoot, { owner: "reuse-test", workId: "reuse", runId: "engine", requireStopEvidence: true });
  process.removeListener("exit", engineConsumer.onExit);
  const reusedEngine = await reuseDeploymentInputs({ artifactProjectRoot: engineCase.projectRoot, owner: engineConsumer.owner, runLifecycleId: engineConsumer.lifecycleId,
    reportPath: path.join(engineConsumer.reports, "reuse.json"), inputManifestPath: engineContext.reportPath, inputManifestSha256: engineContext.manifestSha256,
    expectedProjectSha256: engineContext.projectSha256 });
  assert.deepEqual(reusedEngine.engine, engineContext.engine);
  const verifiedEngine = await verifyReusedDeploymentInputs(reusedEngine);
  assert.equal(verifiedEngine.status, "verified");
  assert.deepEqual(verifiedEngine.engine, engineContext.engine);
  assert.equal(verifiedEngine.sourceRoot, engineContext.immutableProjectRoot);
  assert.equal(verifiedEngine.immutableEngineRoot, engineContext.immutableEngineRoot);
  await assert.rejects(verifyReusedDeploymentInputs({ ...reusedEngine, engine: { ...reusedEngine.engine, fingerprint: "forged" } }), /identity mismatch/);
  const importedFile = path.join(engineContext.immutableEngineRoot, "source.txt");
  const importedBytes = fs.readFileSync(importedFile);
  fs.writeFileSync(importedFile, "immutable imported engine tamper");
  await assert.rejects(verifyReusedDeploymentInputs(reusedEngine), /inventory changed|engine source/);
  fs.writeFileSync(importedFile, importedBytes);
  assert.equal((await verifyReusedDeploymentInputs(reusedEngine)).status, "verified");
  const engineCorrection = path.join(engineConsumer.inputs, 'script.js');
  fs.writeFileSync(engineCorrection, 'module.exports = 3;\n');
  const engineDerived = await prepareDeploymentWorkspace({ sourceInputs: reusedEngine,
    inputRoot: path.join(engineCase.projectRoot, 'artifacts/inputs/script-delta'), workingRoot: path.join(engineCase.projectRoot, 'artifacts/engine-derived'),
    reportPath: path.join(engineConsumer.reports, 'derived.json'), projectOverrides: [{ source: engineCorrection, destinationRelative: 'scripts/input.js',
      sha256: createHash('sha256').update(fs.readFileSync(engineCorrection)).digest('hex') }] });
  assert.equal(engineDerived.immutableInventory.files.length, 1);
  assert.equal(fs.existsSync(path.join(engineDerived.inputRoot, 'engine')), false, 'immutable imported engine is referenced, not recopied');
  assert.equal(engineDerived.immutableEngineRoot, engineContext.immutableEngineRoot);
  assert.deepEqual((await verifyDeploymentWorkspace(engineDerived)).engine, engineContext.engine);
  const workingEngineFile = path.join(engineDerived.workingEngineRoot, 'source.txt');
  fs.writeFileSync(workingEngineFile, 'derived engine tamper');
  await assert.rejects(verifyDeploymentWorkspace(engineDerived), /engine differs|Copied source differs/);
  fs.writeFileSync(workingEngineFile, importedBytes);
  assert.equal((await verifyDeploymentWorkspace(engineDerived)).status, 'verified');
  finishArtifactRun(engineConsumer, { exitCode: 0, producerStopped: true, stopEvidence: stopProof(engineConsumer) });
  checks.push("reused imported engine receipt verified and immutable imported engine tampering rejected");
  fs.mkdirSync(path.join(engineContext.workingRoot, "engine/codex-rs/target"), { recursive: true });
  fs.writeFileSync(path.join(engineContext.workingRoot, "engine/codex-rs/target/cache.bin"), "ignored build cache");
  assert.equal((await verifyDeploymentWorkspace(engineContext)).status, "verified");
  fs.writeFileSync(path.join(engineContext.workingRoot, "engine/source.txt"), "engine tamper");
  await assert.rejects(verifyDeploymentWorkspace(engineContext), /command failed|Compiled engine/);
  checks.push("actual imported engine fingerprints match; permitted Cargo cache ignored; compiled engine tampering rejected");
  git(engineCase.projectRoot, "add", "--force", "engine");
  git(engineCase.projectRoot, "commit", "--quiet", "-m", "embedded imported engine");
  const embeddedOptions = { ...engineCase.options, inputRoot: path.join(engineCase.projectRoot, "artifacts/inputs/embedded"), workingRoot: path.join(engineCase.projectRoot, "artifacts/workspaces/embedded"), reportPath: path.join(engineCase.run.reports, "embedded.json"), pythonExecutable };
  await assert.rejects(prepareDeploymentWorkspace({ ...embeddedOptions, engineSourceRoot: engineContext.immutableEngineRoot }), /conflicts/);
  const embedded = await prepareDeploymentWorkspace({ ...embeddedOptions, engineSourceRoot: engineDestination });
  assert.equal(embedded.embeddedEngine, true);
  assert.equal(embedded.immutableEngineRoot, path.join(embedded.immutableProjectRoot, "engine"));
  assert(!fs.existsSync(path.join(embedded.inputRoot, "engine")));
  assert.equal(embedded.workingRecord.members.filter(member => member.path === embedded.workingEngineRoot).length, 1);
  assert.equal((await verifyDeploymentWorkspace(embedded)).status, "verified");
  fs.mkdirSync(path.join(embedded.workingEngineRoot, "codex-rs/target"), { recursive: true });
  fs.writeFileSync(path.join(embedded.workingEngineRoot, "codex-rs/target/cache.bin"), "permitted generated cache");
  assert.equal((await verifyDeploymentWorkspace(embedded)).status, "verified");
  fs.writeFileSync(path.join(embedded.workingEngineRoot, "source.txt"), "embedded engine tamper");
  await assert.rejects(verifyDeploymentWorkspace(embedded), /Compiled project|command failed|Compiled engine/);
  checks.push("tracked embedded imported engine captured once, external conflict refused, canonical roots audited, generated cache accepted and source tamper rejected");
  const distinctSource = setup("distinct-source");
  const boundary = await prepareDeploymentWorkspace({ ...paths.options, projectRoot: distinctSource.projectRoot, artifactProjectRoot: paths.projectRoot });
  assert.equal((await verifyDeploymentWorkspace(boundary)).status, "verified");
  assert.equal(boundary.artifactProjectRoot, paths.projectRoot);
  assert.equal(boundary.projectRoot, distinctSource.projectRoot);
  checks.push("source selection and artifact ownership project roots remain separate");
  for (const test of [paths, normal, imported, engineCase, distinctSource]) process.removeListener("exit", test.run.onExit);
  console.log(JSON.stringify({ status: "passed", checks, fixture, retained: true, records: catalog(normal.projectRoot).length }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

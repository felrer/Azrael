"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { beginArtifactRun, finishArtifactRun } = require("./artifact-run.cjs");
const { catalog, recordLifecycle, closeLifecycle, planCleanup } = require("./artifact-lifecycle.cjs");
const freezeTools = require("./freeze-platform-inputs.cjs");
const { inventoryTree } = freezeTools;
const inventoryCounts = new Map();
freezeTools.inventoryTree = (root, ...args) => {
  if (inventoryCounts.has(root)) inventoryCounts.set(root, inventoryCounts.get(root) + 1);
  return inventoryTree(root, ...args);
};
const { serializeDeploymentManifest, prepareDeploymentWorkspace, verifyDeploymentWorkspace, reuseDeploymentInputs, verifyReusedDeploymentInputs, resolveDeploymentModuleCacheOwner } = require("./deployment-workspace.cjs");
const { writeDeploymentManifest, readDeploymentManifest, createDeploymentContextReference, readDeploymentContextReference } = require("./deployment-manifest.cjs");
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
function checkManifestDetails(reportPath, original) {
  // Future callers must hydrate all evidence instead of treating the small index
  // as the original manifest or forgetting required sidecars.
  const logical = { ...original, evidence: { unicode: "입".repeat(6 * 1024 * 1024), optional: null, selected: [false, 0, ""] } };
  writeDeploymentManifest(reportPath, logical);
  const indexBytes = fs.readFileSync(reportPath);
  const manifestHash = createHash("sha256").update(indexBytes).digest("hex");
  const contextReference = createDeploymentContextReference(reportPath, manifestHash);
  assert(Buffer.byteLength(JSON.stringify(contextReference)) < 4096, "prepared context handoff references inventories without duplicating them");
  const restored = readDeploymentContextReference(JSON.parse(JSON.stringify(contextReference)));
  assert.deepEqual(restored.evidence, logical.evidence);
  assert.equal(restored.reportPath, reportPath);
  assert.equal(restored.manifestSha256, manifestHash);
  assert.throws(() => createDeploymentContextReference(reportPath, "0".repeat(64)), /changed/);
  assert.throws(() => readDeploymentContextReference({ ...contextReference, summary: { ...contextReference.summary, projectBytes: -1 } }), /binding changed/);
  const index = JSON.parse(indexBytes);
  assert.equal(index.schema, 3);
  assert.equal(index.storageFormat, "deployment-details-v1");
  assert(indexBytes.length < 4096, "main manifest stays compact independently of full evidence size");
  assert.equal(index.details.directory, path.basename(reportPath) + ".details");
  assert.equal(index.details.chunkBytes, 8 * 1024 * 1024);
  assert(index.details.bytes > 16 * 1024 * 1024);
  assert.equal(index.details.chunkCount, Math.ceil(index.details.bytes / index.details.chunkBytes));
  assert.deepEqual(index.summary, { sourceCommit: original.sourceCommit, projectSha256: original.projectSha256,
    projectFileCount: original.project.fileCount, projectBytes: original.project.bytes, immutableSha256: original.immutableInventory.sha256 });
  const detailsRoot = path.join(path.dirname(reportPath), index.details.directory);
  const names = fs.readdirSync(detailsRoot).sort();
  assert.deepEqual(names, Array.from({ length: index.details.chunkCount }, (_, i) => `part-${String(i).padStart(8, "0")}.bin`));
  const content = Buffer.concat(names.map((name, i) => {
    const bytes = fs.readFileSync(path.join(detailsRoot, name));
    assert.equal(bytes.length, Math.min(index.details.chunkBytes, index.details.bytes - i * index.details.chunkBytes));
    return bytes;
  }));
  assert.equal(content.length, index.details.bytes);
  assert.equal(createHash("sha256").update(content).digest("hex"), index.details.sha256);
  assert.deepEqual(JSON.parse(content), logical, "chunks preserve every logical value including UTF-8 crossing part boundaries");
  assert.deepEqual(readDeploymentManifest(reportPath), logical);
  const firstPart = path.join(detailsRoot, names[0]);
  const originalPart = fs.readFileSync(firstPart);
  const missingPart = reportPath + ".missing-part";
  fs.renameSync(firstPart, missingPart);
  try { assert.throws(() => readDeploymentManifest(reportPath), undefined, "missing required part rejected"); }
  finally { fs.renameSync(missingPart, firstPart); }
  const modifiedPart = Buffer.from(originalPart); modifiedPart[0] ^= 1;
  fs.writeFileSync(firstPart, modifiedPart);
  try { assert.throws(() => readDeploymentManifest(reportPath), undefined, "changed bytes rejected before JSON hydration"); }
  finally { fs.writeFileSync(firstPart, originalPart); }
  const extraPart = path.join(detailsRoot, "unexpected.bin");
  fs.writeFileSync(extraPart, "unexpected evidence");
  try { assert.throws(() => readDeploymentManifest(reportPath), undefined, "unlisted evidence rejected"); }
  finally { fs.unlinkSync(extraPart); }
  const linkedPart = reportPath + ".linked-part";
  fs.linkSync(firstPart, linkedPart);
  try { assert.throws(() => readDeploymentManifest(reportPath), undefined, "linked part rejected"); }
  finally { fs.unlinkSync(linkedPart); }
  for (const changed of [
    { directory: "../" + index.details.directory },
    { chunkCount: index.details.chunkCount + 1 },
    { bytes: index.details.bytes + 1 },
    { sha256: "0".repeat(64) }
  ]) {
    fs.writeFileSync(reportPath, JSON.stringify({ ...index, details: { ...index.details, ...changed } }));
    try { assert.throws(() => readDeploymentManifest(reportPath), undefined, `invalid details metadata rejected: ${Object.keys(changed)[0]}`); }
    finally { fs.writeFileSync(reportPath, indexBytes); }
  }
  assert.deepEqual(readDeploymentManifest(reportPath), logical, "all corruption fixtures restored");
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
  for (const suffix of ["", ".details"]) {
    const collision = paths.options.reportPath + suffix;
    fs.mkdirSync(path.dirname(collision), { recursive: true });
    fs.writeFileSync(collision, "pre-existing report evidence");
    try {
      await assert.rejects(prepareDeploymentWorkspace(paths.options));
      assert(!fs.existsSync(paths.options.inputRoot), "manifest collision rejected before immutable copy");
      assert(!fs.existsSync(paths.options.workingRoot), "manifest collision rejected before working copy");
      assert.equal(fs.readFileSync(collision, "utf8"), "pre-existing report evidence");
    } finally { fs.unlinkSync(collision); }
  }
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
  const context = await prepareDeploymentWorkspace(normal.options);
  assert.equal((await verifyDeploymentWorkspace(context)).status, "verified");
  checkManifestDetails(path.join(normal.run.reports, "large-details.json"), readDeploymentManifest(context.reportPath));
  const contextIndex = JSON.parse(fs.readFileSync(context.reportPath, "utf8"));
  const contextPart = path.join(path.dirname(context.reportPath), contextIndex.details.directory, "part-00000000.bin");
  const contextPartBytes = fs.readFileSync(contextPart);
  fs.appendFileSync(contextPart, " ");
  try { await assert.rejects(verifyDeploymentWorkspace(context)); }
  finally { fs.writeFileSync(contextPart, contextPartBytes); }
  assert.equal((await verifyDeploymentWorkspace(context)).status, "verified");
  checks.push("full >16 MiB UTF-8 manifest roundtrip, compact index, canonical 8 MiB parts; missing, modified, extra, linked, escaping, count, size and SHA evidence rejected; public verification authenticates sidecars");
  await assert.rejects(verifyDeploymentWorkspace({ ...context, sourceCommit: "0".repeat(context.sourceCommit.length) }), /sourceCommit binding changed/);
  const committedControl = path.join(context.workingRoot, "control/committed-source.json");
  const committedControlBytes = fs.readFileSync(committedControl);
  fs.appendFileSync(committedControl, " ");
  await assert.rejects(verifyDeploymentWorkspace(context), /committed source control receipt changed/);
  fs.writeFileSync(committedControl, committedControlBytes);
  const selectedHead = git(context.workingRoot, "rev-parse", "HEAD");
  const otherHead = git(normal.projectRoot, "rev-parse", "HEAD^");
  git(context.workingRoot, "fetch", "--quiet", normal.projectRoot, otherHead);
  git(context.workingRoot, "update-ref", "HEAD", otherHead);
  await assert.rejects(verifyDeploymentWorkspace(context), /sourceCommit binding changed/);
  git(context.workingRoot, "update-ref", "HEAD", selectedHead);
  assert.equal(context.moduleCacheProjectRoot, normal.projectRoot);
  assert.equal(readDeploymentManifest(context.reportPath).moduleCacheProjectRoot, normal.projectRoot);
  await assert.rejects(verifyDeploymentWorkspace({ ...context, moduleCacheProjectRoot: context.workingRoot }), /module cache owner changed/);
  const secondWorkspace = await prepareDeploymentWorkspace({ ...normal.options, artifactProjectRoot: normal.projectRoot, projectRoot: context.immutableProjectRoot,
    inputRoot: path.join(normal.projectRoot, 'artifacts/inputs/second'), workingRoot: path.join(normal.projectRoot, 'artifacts/workspaces/second'),
    reportPath: path.join(normal.run.reports, 'nested', 'second.json') });
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
  const legacyManifest = readDeploymentManifest(secondWorkspace.reportPath);
  delete legacyManifest.moduleCacheProjectRoot;
  delete legacyManifest.rootIdentities.moduleCacheOwner;
  fs.writeFileSync(secondWorkspace.reportPath, JSON.stringify(legacyManifest));
  try {
    const legacyContext = { ...secondWorkspace, manifestSha256: createHash('sha256').update(fs.readFileSync(secondWorkspace.reportPath)).digest('hex') };
    delete legacyContext.moduleCacheProjectRoot;
    assert.equal((await verifyDeploymentWorkspace(legacyContext)).moduleCacheProjectRoot, normal.projectRoot, 'legacy schema-1 explicit artifact owner remains readable');
  } finally { fs.writeFileSync(secondWorkspace.reportPath, currentManifestBytes); }
  checks.push('independent normal workspaces expose stable artifact owner in manifests and verified contexts, rejecting owner redirection');
  assert(!fs.existsSync(path.join(context.workingRoot, "untracked.txt")));
  assert.equal(fs.readFileSync(path.join(context.workingRoot, "deleted.txt"), "utf8"), "deleted after commit");
  assert.equal(context.projectSha256, context.workingProjectSha256);
  assert.equal(context.workingCopy.mode, 'standard-copy');
  assert.equal(context.workingCopy.contentVerified, false, 'copy completion is not content verification');
  assert.equal(context.baselineProjectSha256, context.projectSha256);
  assert.equal(context.sourceCommit, git(normal.projectRoot, "rev-parse", "HEAD"));
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
  checks.push("committed tracked/deleted/nested source and untracked exclusion, independent working source, generated artifacts separately owned, later checkout edits excluded");
  const workingDependency = context.workingRecord.references.find(ref => ref.id === context.inputLifecycleId);
  const completed = finishArtifactRun(normal.run, { exitCode: 0, producerStopped: true, stopEvidence: stopProof(normal.run) });
  assert.equal(completed.state, "complete");
  assert.equal(completed.producer.exit_code, 0);
  assert(completed.references.every(ref => ref.kind !== "execution"));
  assert.equal(completed.references.find(ref => ref.id === callerDependency.id).reason, callerDependency.reason);
  assert.deepEqual(catalog(normal.projectRoot).find(record => record.id === context.workingLifecycleId).references.find(ref => ref.id === context.inputLifecycleId), workingDependency);
  assert(!fs.existsSync(path.join(context.immutableProjectRoot, "untracked.txt")));
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
  const frozenIndex = JSON.parse(originalManifest);
  const frozenPart = path.join(path.dirname(frozen.reportPath), frozenIndex.details.directory, "part-00000000.bin");
  const frozenPartBytes = fs.readFileSync(frozenPart);
  fs.appendFileSync(frozenPart, " ");
  try {
    await assert.rejects(verifyReusedDeploymentInputs(firstReuse));
    const corruptReuseReport = path.join(consumers[0].reports, "corrupt-sidecar-reuse.json");
    await assert.rejects(reuseDeploymentInputs({ ...reuseOptions(consumers[0]), reportPath: corruptReuseReport }));
    assert(!fs.existsSync(corruptReuseReport), "corrupt source sidecar never publishes a reusable reference");
  } finally { fs.writeFileSync(frozenPart, frozenPartBytes); }
  assert.equal((await verifyReusedDeploymentInputs(firstReuse)).status, "verified");
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
  const frozenFile = path.join(frozen.immutableProjectRoot, "deleted.txt");
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
  checks.push("two read-only callers reuse frozen inputs without copying or new producers; required sidecars authenticated during reuse and later verification; absent old working copy and later checkout ignored; hashes, ownership, root identity, tampering, truthful failure closure and scoped cleanup protections enforced");
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
  const immutableFile = path.join(context.immutableProjectRoot, "deleted.txt");
  fs.writeFileSync(immutableFile, "immutable input tamper");
  await assert.rejects(verifyDeploymentWorkspace(context), /Immutable/);
  fs.writeFileSync(immutableFile, "deleted after commit");
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
  git(engineCase.projectRoot, "add", "scripts"); git(engineCase.projectRoot, "commit", "--quiet", "-m", "committed validators");
  const derivedCase = setup("legacy-derived");
  const legacyBaseline = await prepareDeploymentWorkspace(derivedCase.options);
  const sourceInputs = await reuseDeploymentInputs({ artifactProjectRoot: derivedCase.projectRoot, owner: derivedCase.run.owner, runLifecycleId: derivedCase.run.lifecycleId,
    reportPath: path.join(derivedCase.run.reports, 'legacy-baseline-reference.json'), inputManifestPath: legacyBaseline.reportPath,
    inputManifestSha256: legacyBaseline.manifestSha256, expectedProjectSha256: legacyBaseline.projectSha256 });
  await assert.rejects(prepareDeploymentWorkspace({ sourceInputs, projectOverrides: [] }), /script-delta.*committed/);
  // Representative existing schema-2 data is assembled locally; the production
  // preparation entry point never offers a legacy override bypass.
  const legacyInput = path.join(derivedCase.projectRoot, 'artifacts/inputs/legacy-delta');
  const legacyFile = path.join(legacyInput, 'overrides/scripts/input.js');
  fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
  fs.copyFileSync(path.join(legacyBaseline.workingRoot, 'scripts/input.js'), legacyFile);
  const legacyHash = createHash('sha256').update(fs.readFileSync(legacyFile)).digest('hex');
  const identity = root => { const stat = fs.lstatSync(root); return { realpath: fs.realpathSync(root), dev: stat.dev, ino: stat.ino }; };
  const legacyReport = path.join(derivedCase.run.reports, 'legacy-delta.json');
  const legacyRecord = recordLifecycle(derivedCase.projectRoot, { id: 'legacy-delta', kind: 'work', owner: derivedCase.run.owner, state: 'pending', membership_complete: false,
    members: [{ path: legacyInput, role: 'immutable-script-delta', generated: true, protection_known: true }], expected_revision: 0 });
  const legacyDeltaManifest = { ...legacyBaseline, schema: 2, inputKind: 'script-delta', sourceInputs, inputRoot: legacyInput, inputLifecycleId: legacyRecord.id,
    immutableProjectRoot: null, baselineProjectSha256: sourceInputs.projectSha256,
    projectOverrides: [{ source: legacyFile, destinationRelative: 'scripts/input.js', sha256: legacyHash, mode: fs.statSync(legacyFile).mode & 0o777 }],
    immutableInventory: inventoryTree(legacyInput), rootIdentities: { ...legacyBaseline.rootIdentities, input: identity(legacyInput) } };
  delete legacyDeltaManifest.sourceCommit;
  fs.writeFileSync(legacyReport, JSON.stringify(legacyDeltaManifest) + '\n');
  const legacySha = createHash('sha256').update(fs.readFileSync(legacyReport)).digest('hex');
  closeLifecycle(derivedCase.projectRoot, legacyRecord.id, { owner: derivedCase.run.owner, expected_revision: legacyRecord.revision, producer_stopped_verified: true,
    outcome: 'success', exit_code: 0, reason: 'Synthetic historical fixture', evidence_ref: legacyReport, evidence_sha256: legacySha });
  const legacyContext = { ...legacyDeltaManifest, reportPath: legacyReport, manifestSha256: legacySha };
  assert.equal((await verifyDeploymentWorkspace(legacyContext)).status, 'verified');
  fs.appendFileSync(legacyFile, 'tamper');
  await assert.rejects(verifyDeploymentWorkspace(legacyContext), /inventory changed/);
  checks.push('new arbitrary script deltas rejected; existing schema-2 baseline binding, content and lifecycle verification preserved');
  finishArtifactRun(derivedCase.run, { exitCode: 0, producerStopped: true, stopEvidence: stopProof(derivedCase.run) });
  const engineSource = path.join(fixture, "engine-source"); fs.mkdirSync(engineSource);
  git(engineSource, "init", "--quiet"); git(engineSource, "config", "user.email", "workspace@example.invalid"); git(engineSource, "config", "user.name", "Workspace Fixture");
  fs.writeFileSync(path.join(engineSource, "source.txt"), "engine source fixture");
  fs.writeFileSync(path.join(engineSource, ".gitignore"), "codex-rs/target/\n");
  git(engineSource, "add", "."); git(engineSource, "commit", "--quiet", "-m", "engine baseline");
  git(engineSource, "remote", "add", "origin", "https://github.com/openai/codex.git"); git(engineSource, "tag", "rust-v0.159.3");
  const engineDestination = path.join(engineCase.projectRoot, "engine");
  const importer = spawnSync(pythonExecutable, ["-B", path.join(__dirname, "import-engine-source.py"), "--source", engineSource, "--destination", engineDestination, "--allow-source-advance"], { encoding: "utf8", windowsHide: true });
  assert.equal(importer.status, 0, importer.error?.message || importer.stderr || "Imported fixture creation failed");
  const engineReceipt = JSON.parse(fs.readFileSync(path.join(engineDestination, 'SOURCE.json'), 'utf8'));
  const engineDigest = createHash('sha256');
  for (const [name, entry] of Object.entries(engineReceipt.files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) engineDigest.update(name + '\0' + (entry.sha256 || 'missing') + '\0');
  const engineSourceSha256 = engineDigest.digest('hex');
  await assert.rejects(prepareDeploymentWorkspace({ ...engineCase.options, engineSourceRoot: engineDestination, pythonExecutable }), /Pinned engineSourceSha256/);
  assert(!fs.existsSync(engineCase.options.inputRoot));
  const invalidOptions = { ...engineCase.options, inputRoot: path.join(engineCase.projectRoot, 'artifacts/inputs/invalid-engine'), workingRoot: path.join(engineCase.projectRoot, 'artifacts/workspaces/invalid-engine'), reportPath: path.join(engineCase.run.reports, 'invalid-engine.json') };
  const unexpectedEngineSource = path.join(engineDestination, "unrecorded.txt");
  fs.writeFileSync(unexpectedEngineSource, "unrecorded engine input");
  await assert.rejects(prepareDeploymentWorkspace({ ...invalidOptions, engineSourceRoot: engineDestination, engineSourceSha256, pythonExecutable }), /Destination coverage differs/);
  assert(!fs.existsSync(path.join(invalidOptions.inputRoot, "engine")), "invalid engine is never copied");
  assert(!fs.existsSync(path.join(invalidOptions.workingRoot, "engine")), "invalid engine is never materialized for build");
  fs.unlinkSync(unexpectedEngineSource);
  checks.push("invalid imported inventory rejected before external engine copy using committed validators");
  const engineContext = await prepareDeploymentWorkspace({ ...engineCase.options, engineSourceRoot: engineDestination, engineSourceSha256, pythonExecutable });
  assert.equal((await verifyDeploymentWorkspace(engineContext)).status, "verified");
  // Later performance edits must not turn the preflight reuse into trust in a
  // replacement source directory, even when its bytes still match the receipt.
  const swapped = setup("engine-root-swap"), mkdirBeforeSwap = fs.mkdirSync;
  for (const name of ["engine-provenance.py", "import-engine-source.py", "azrael-platforms.json"]) fs.copyFileSync(path.join(__dirname, name), path.join(swapped.projectRoot, "scripts", name));
  git(swapped.projectRoot, "add", "scripts"); git(swapped.projectRoot, "commit", "--quiet", "-m", "committed validators");
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
    await assert.rejects(prepareDeploymentWorkspace({ ...swapped.options, engineSourceRoot: engineDestination, engineSourceSha256, pythonExecutable }), /Engine source root changed/);
  } finally {
    fs.mkdirSync = mkdirBeforeSwap;
    if (didSwap) {
      fs.renameSync(engineDestination, replacementEngine);
      fs.renameSync(originalEngine, engineDestination);
    }
  }
  checks.push("preflight reuse rejects a byte-identical source root replacement before freeze completion");
  await assert.rejects(prepareDeploymentWorkspace({ ...engineCase.options, projectOverrides: [{ source: path.join(engineCase.projectRoot, 'scripts/engine-provenance.py'), destinationRelative: 'scripts/engine-provenance.py', sha256: '0'.repeat(64) }] }), /overrides.*commit-bound/);
  checks.push('uncommitted validator overrides rejected');
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
  await assert.rejects(prepareDeploymentWorkspace({ sourceInputs: reusedEngine, projectOverrides: [] }), /script-delta.*committed/);
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
  const embedded = await prepareDeploymentWorkspace({ ...embeddedOptions, engineSourceRoot: engineDestination, pythonExecutable });
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

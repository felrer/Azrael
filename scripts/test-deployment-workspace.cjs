"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { beginArtifactRun } = require("./artifact-run.cjs");
const { catalog, recordLifecycle } = require("./artifact-lifecycle.cjs");
const { prepareDeploymentWorkspace, verifyDeploymentWorkspace } = require("./deployment-workspace.cjs");
const fixture = process.argv[2];
const pythonExecutable = process.env.AZRAEL_TEST_PYTHON || (process.platform === "win32" ? "python" : "python3");
assert(fixture && path.isAbsolute(fixture), "fresh absolute owned fixture required");
fs.mkdirSync(fixture);
function git(root, ...args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function setup(name) {
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
  const run = beginArtifactRun(projectRoot, { owner: "deployment-workspace-test", workId: "workspace", runId: "controller", requireStopEvidence: true });
  // Fixture records remain pending under the caller-owned retained test boundary.
  process.removeListener("exit", run.onExit);
  const options = { projectRoot, inputRoot: path.join(projectRoot, "artifacts/inputs/input"), workingRoot: path.join(projectRoot, "artifacts/workspaces/work"),
    reportPath: path.join(run.reports, "inputs.json"), owner: run.owner, runLifecycleId: run.lifecycleId };
  return { projectRoot, run, options };
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
  const normal = setup("normal");
  const nested = path.join(normal.projectRoot, "vendor"); fs.mkdirSync(nested);
  git(nested, "init", "--quiet"); git(nested, "config", "user.email", "workspace@example.invalid"); git(nested, "config", "user.name", "Workspace Fixture");
  fs.writeFileSync(path.join(nested, "nested.txt"), "nested selected source");
  git(nested, "add", "."); git(nested, "commit", "--quiet", "-m", "nested baseline");
  git(normal.projectRoot, "add", "vendor");
  git(normal.projectRoot, "commit", "--quiet", "-m", "nested source");
  const normalOverrideSource = path.join(normal.projectRoot, "untracked.txt");
  const context = await prepareDeploymentWorkspace({ ...normal.options, projectOverrides: [{ source: normalOverrideSource, destinationRelative: "added/overlay.txt", sha256: overrideHash }] });
  assert.equal((await verifyDeploymentWorkspace(context)).status, "verified");
  assert.equal(fs.readFileSync(path.join(context.workingRoot, "untracked.txt"), "utf8"), "selected untracked source");
  assert(!fs.existsSync(path.join(context.workingRoot, "deleted.txt")));
  assert.equal(context.projectSha256, context.workingProjectSha256);
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

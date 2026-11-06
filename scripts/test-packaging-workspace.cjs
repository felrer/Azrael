"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { beginArtifactRun, finishArtifactRun } = require("./artifact-run.cjs");
const { catalog, planCleanup } = require("./artifact-lifecycle.cjs");
const { prepareDeploymentWorkspace, reuseDeploymentInputs } = require("./deployment-workspace.cjs");
const { preparePackagingWorkspace, verifyPackagingWorkspace } = require("./packaging-workspace.cjs");
const { inventoryTree, hash } = require("./freeze-platform-inputs.cjs");
const fixture = process.argv[2], python = process.env.AZRAEL_TEST_PYTHON || (process.platform === "win32" ? "python" : "python3");
assert(fixture && path.isAbsolute(fixture), "fresh absolute owned fixture required");
fs.mkdirSync(fixture);
function execute(command, args, options = {}) {
  const r = spawnSync(command, args, { encoding: "utf8", windowsHide: true, ...options });
  assert.equal(r.status, 0, r.error?.message || r.stderr || r.stdout); return r.stdout.trim();
}
const git = (root, ...args) => execute("git", ["-C", root, ...args]);
function repository(root) {
  fs.mkdirSync(root); git(root, "init", "--quiet"); git(root, "config", "user.email", "fixture@example.invalid"); git(root, "config", "user.name", "Packaging Fixture");
}
function bootstrapFixtureMaintenance(destinationRoot) {
  const sourceRoot = path.resolve(__dirname, ".."), config = require("./maintenance-owner-config.cjs");
  const selected = config.resolveMaintenanceCommand(sourceRoot);
  if (!selected.args.length && !process.env.AZRAEL_MAINTENANCE_OWNER) {
    const relative = "artifacts/maintenance/owner-installation.json";
    const pin = JSON.parse(fs.readFileSync(path.join(sourceRoot, relative), "utf8"));
    const versionRoot = path.dirname(path.dirname(pin.executable));
    const executable = path.join(destinationRoot, "m.exe");
    assert.ok(process.platform !== "win32" || executable.length < 260, "Fixture executable must fit Windows launch paths");
    assert.equal(fs.existsSync(executable), false, "Fresh fixture executable required");
    require("./freeze-platform-inputs.cjs").copyTree(path.join(sourceRoot, pin.executable), executable);
    const files = [relative, ...["performance.json", "native-acceptance.json"].map(name => path.join(versionRoot, "verification", name)).filter(name => fs.existsSync(path.join(sourceRoot, name)))];
    for (const name of files) {
      const target = path.join(destinationRoot, name);
      assert.equal(fs.existsSync(target), false, "Fresh standalone fixture metadata required");
      require("./freeze-platform-inputs.cjs").copyTree(path.join(sourceRoot, name), target);
    }
    fs.writeFileSync(path.join(destinationRoot, relative), JSON.stringify({ ...pin, executable: "m.exe" }, null, 2) + "\n");
  }
  const actual = config.resolveMaintenanceCommand(destinationRoot);
  assert.deepEqual(actual.args, selected.args);
  assert.equal(actual.maxLockWaitMs, selected.maxLockWaitMs, "Fixture must preserve the installed queue capability");
  return actual;
}

async function main() {
  const projectRoot = path.join(fixture, "project"); repository(projectRoot);
  fs.mkdirSync(path.join(projectRoot, "scripts"));
  // The fixture baseline contains the actual consumer/verifier source closure.
  for (const name of ["prepare-app-release.ps1", "package-app-release.py", "install-app-release.ps1", "azrael-app-release.json", "engine-provenance.py", "import-engine-source.py", "azrael-platforms.json",
    ...["packaging-workspace", "deployment-workspace", "deployment-control-retirement", "deployment-control-retirement-native", "lifecycle-empty-publication-recovery", "artifact-lifecycle", "artifact-observations", "artifact-run", "maintenance-lock-owner", "maintenance-preferences", "maintenance-owner-config", "maintenance-lock-worker", "freeze-platform-inputs", "capture-project-inputs", "deployment-input-snapshot"].map(n => n + ".cjs")]) fs.copyFileSync(path.join(__dirname, name), path.join(projectRoot, "scripts", name));
  bootstrapFixtureMaintenance(projectRoot);
  const configuration = JSON.parse(fs.readFileSync(path.join(projectRoot, "scripts/azrael-app-release.json"), "utf8")); configuration.version = "2026.0.0";
  fs.writeFileSync(path.join(projectRoot, "scripts/azrael-app-release.json"), JSON.stringify(configuration));
  fs.copyFileSync(path.join(__dirname, "../LICENSE"), path.join(projectRoot, "LICENSE"));
  fs.writeFileSync(path.join(projectRoot, ".gitignore"), "/artifacts/\n/engine/\n");
  git(projectRoot, "add", "."); git(projectRoot, "commit", "--quiet", "-m", "packaging baseline");
  const engineSource = path.join(fixture, "engine-source"); repository(engineSource);
  fs.writeFileSync(path.join(engineSource, "source.txt"), "engine bytes must never be recopied to compact packaging\n");
  fs.writeFileSync(path.join(engineSource, "LICENSE"), "fixture engine license\n"); fs.writeFileSync(path.join(engineSource, "NOTICE"), "fixture notice\n");
  git(engineSource, "add", "."); git(engineSource, "commit", "--quiet", "-m", "engine source"); git(engineSource, "remote", "add", "origin", "https://github.com/openai/codex.git"); git(engineSource, "tag", "rust-v0.159.3");
  const engine = path.join(projectRoot, "engine");
  execute(python, ["-B", path.join(__dirname, "import-engine-source.py"), "--source", engineSource, "--destination", engine, "--allow-source-advance"]);
  const run = beginArtifactRun(projectRoot, { owner: "packaging-workspace-test", workId: "packaging", runId: "controller", requireStopEvidence: true });
  process.removeListener("exit", run.onExit);
  const frozen = await prepareDeploymentWorkspace({ projectRoot, inputRoot: path.join(projectRoot, "artifacts/inputs/full"), workingRoot: path.join(projectRoot, "artifacts/workspaces/full"), owner: run.owner, runLifecycleId: run.lifecycleId, reportPath: path.join(run.reports, "full.json"), engineSourceRoot: engine, pythonExecutable: python });
  const reused = await reuseDeploymentInputs({ artifactProjectRoot: projectRoot, owner: run.owner, runLifecycleId: run.lifecycleId, reportPath: path.join(run.reports, "reuse.json"), inputManifestPath: frozen.reportPath, inputManifestSha256: frozen.manifestSha256, expectedProjectSha256: frozen.projectSha256 });
  const baselineBefore = inventoryTree(frozen.inputRoot).sha256;
  const options = { sourceInputs: reused, inputRoot: path.join(projectRoot, "artifacts/inputs/compact"), reportPath: path.join(run.reports, "compact.json") };
  for (const override of [
    { source: path.join(projectRoot, "LICENSE"), destinationRelative: "../escape", sha256: hash(path.join(projectRoot, "LICENSE")) },
    { source: path.join(projectRoot, "LICENSE"), destinationRelative: "engine/source.txt", sha256: hash(path.join(projectRoot, "LICENSE")) },
    { source: path.join(projectRoot, "LICENSE"), destinationRelative: "LICENSE", sha256: "0".repeat(64) },
    { source: path.join(engineSource, "LICENSE"), destinationRelative: "LICENSE", sha256: hash(path.join(engineSource, "LICENSE")) }
  ]) await assert.rejects(preparePackagingWorkspace({ ...options, projectOverrides: [override] }));
  const duplicate = { source: path.join(projectRoot, "LICENSE"), destinationRelative: "LICENSE", sha256: hash(path.join(projectRoot, "LICENSE")) };
  await assert.rejects(preparePackagingWorkspace({ ...options, projectOverrides: [duplicate, duplicate] }), /unique/);
  const badDependency = path.join(projectRoot, "scripts/bad-dependency.cjs"); fs.writeFileSync(badDependency, 'require("./missing.cjs");\n');
  await assert.rejects(preparePackagingWorkspace({ ...options, projectOverrides: [{ source: badDependency, destinationRelative: "scripts/deployment-workspace.cjs", sha256: hash(badDependency) }] }), /dependency/);
  fs.writeFileSync(badDependency, "require(process.env.MISSING_MODULE);\n");
  await assert.rejects(preparePackagingWorkspace({ ...options, projectOverrides: [{ source: badDependency, destinationRelative: "scripts/deployment-workspace.cjs", sha256: hash(badDependency) }] }), /dynamic/);
  const compact = await preparePackagingWorkspace(options);
  assert.equal((await verifyPackagingWorkspace(compact)).status, "verified");
  assert.equal(inventoryTree(frozen.inputRoot).sha256, baselineBefore);
  assert.deepEqual(fs.readdirSync(path.join(compact.sourceRoot, "engine")).sort(), ["LICENSE", "NOTICE"]);
  assert(!fs.existsSync(path.join(compact.sourceRoot, ".git")));
  assert(!fs.existsSync(path.join(compact.sourceRoot, "engine/source.txt")));
  const compactFiles = inventoryTree(compact.inputRoot).files;
  assert(compactFiles.every(f => compact.files.some(s => "project/" + s.path === f.path && s.sha256 === f.sha256)));
  assert.equal(compact.copiedBytes, compact.files.reduce((n, f) => n + fs.statSync(path.join(compact.sourceRoot, f.path)).size, 0));
  assert(catalog(projectRoot).find(r => r.id === compact.inputLifecycleId).references.some(r => r.id === frozen.inputLifecycleId && r.kind === "dependency"));
  assert(planCleanup(projectRoot, { paths: [frozen.inputRoot] }).groups.find(g => g.id === frozen.inputLifecycleId).blockers.includes(`active-reference:${compact.inputLifecycleId}`));
  await assert.rejects(verifyPackagingWorkspace({ ...compact, manifestSha256: "0".repeat(64) }), /manifest/);
  const extra = path.join(compact.sourceRoot, "unexpected.txt"); fs.writeFileSync(extra, "extra");
  await assert.rejects(verifyPackagingWorkspace(compact), /inventory/); fs.unlinkSync(extra);
  const copied = path.join(compact.sourceRoot, "LICENSE"), copiedBytes = fs.readFileSync(copied); fs.appendFileSync(copied, "tamper");
  await assert.rejects(verifyPackagingWorkspace(compact), /inventory/); fs.writeFileSync(copied, copiedBytes);
  const baselineFile = path.join(reused.immutableEngineRoot, "source.txt"), before = fs.readFileSync(baselineFile); fs.appendFileSync(baselineFile, "tamper");
  await assert.rejects(verifyPackagingWorkspace(compact)); fs.writeFileSync(baselineFile, before);
  // Reuse the maintained Python fixture's real packager/runtime assertions and
  // installer PrepareOnly boundary instead of reimplementing its synthetic build.
  const expression = [
    "import importlib.util,json,os,sys,tempfile",
    "from pathlib import Path",
    "spec=importlib.util.spec_from_file_location('fixture',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
    "tempfile.tempdir=sys.argv[2]",
    "t=m.AppReleaseTests(); t.setUp()",
    "t.temp._finalizer.detach()",
    "build=json.loads((t.release/'build-info.json').read_bytes()); build['engineProvenance']['source']['sourceSha256']=sys.argv[3]; t.write_json(t.release/'build-info.json',build)",
    "t.write_json(t.root/'prepared.json',{'HostVersion':'2026.0.0','ReleaseDirectory':str(t.release),'HostVsix':str(t.host),'HostSha256':m.sha(t.host.read_bytes())})",
    "print(json.dumps({'root':str(t.root),'release':str(t.release),'receipt':str(t.root/'prepared.json')}))"
  ].join("\n");
  const synthetic = JSON.parse(execute(python, ["-B", "-c", expression, path.join(__dirname, "tests/test_app_release.py"), fixture, compact.engineSourceSha256]));
  const output = path.join(synthetic.root, "wrapper-output");
  for (const [name, additional] of [["external-config", ["-ConfigurationPath", path.join(projectRoot, "scripts/azrael-app-release.json")]], ["host-source-option", ["-SourceExtensionPath", projectRoot]], ["half-pair", ["-PackagingInputSha256", ""]]]) {
    const invalidOutput = path.join(synthetic.root, name);
    const result = spawnSync("pwsh", ["-NoProfile", "-File", path.join(compact.sourceRoot, "scripts/prepare-app-release.ps1"), "-ReleaseDirectory", synthetic.release, "-PreparedHostReceipt", synthetic.receipt, "-OutputDirectory", invalidOutput, "-PackagingInputManifest", compact.reportPath, ...(name === "half-pair" ? [] : ["-PackagingInputSha256", compact.manifestSha256]), ...additional], { encoding: "utf8", windowsHide: true });
    assert.notEqual(result.status, 0, name); assert(!fs.existsSync(invalidOutput), name);
  }
  execute("pwsh", ["-NoProfile", "-File", path.join(compact.sourceRoot, "scripts/prepare-app-release.ps1"), "-ReleaseDirectory", synthetic.release, "-PreparedHostReceipt", synthetic.receipt, "-OutputDirectory", output, "-PackagingInputManifest", compact.reportPath, "-PackagingInputSha256", compact.manifestSha256]);
  const installExpression = ["import sys,zipfile", "from pathlib import Path", "asset=Path(sys.argv[1]); target=Path(sys.argv[2])", "with zipfile.ZipFile(asset) as z: z.extractall(target)"].join("\n");
  const extracted = path.join(synthetic.root, "extracted");
  execute(python, ["-B", "-c", installExpression, path.join(output, "assets/Azrael-2026.0.0-windows-x64.zip"), extracted]);
  execute("pwsh", ["-NoProfile", "-File", path.join(extracted, "install.ps1"), "-PrepareOnly", "-InstallRoot", path.join(synthetic.root, "recipient"), "-StateRoot", path.join(synthetic.root, "state"), "-CodePath", path.join(synthetic.root, "missing-code.cmd")]);
  assert.equal((await verifyPackagingWorkspace(compact)).status, "verified");
  const stoppedEvidence = path.join(run.reports, "controller-stopped.json");
  fs.writeFileSync(stoppedEvidence, JSON.stringify({ stopped: true, scope: "in-process fixture controller; all synchronous children settled" }));
  finishArtifactRun(run, { exitCode: 0, producerStopped: true, stopEvidence: { producer_stopped_verified: true, evidence_ref: stoppedEvidence, evidence_sha256: hash(stoppedEvidence), reason: "All in-process preparation and synchronous child calls settled" } });
  await assert.rejects(verifyPackagingWorkspace(compact), /Active packaging caller/);
  const closedOutput = path.join(synthetic.root, "closed-controller-output");
  const closed = spawnSync("pwsh", ["-NoProfile", "-File", path.join(compact.sourceRoot, "scripts/prepare-app-release.ps1"), "-ReleaseDirectory", synthetic.release, "-PreparedHostReceipt", synthetic.receipt, "-OutputDirectory", closedOutput, "-PackagingInputManifest", compact.reportPath, "-PackagingInputSha256", compact.manifestSha256], { encoding: "utf8", windowsHide: true });
  assert.notEqual(closed.status, 0, "Closed creator cannot execute fixed packaging"); assert(!fs.existsSync(closedOutput));
  // Each consumer owns a fresh cheap compact capture; full engine/project input
  // bytes and their original manifest are shared across truthful run closure.
  const next = beginArtifactRun(projectRoot, { owner: run.owner, workId: "packaging", runId: "next-controller", requireStopEvidence: true });
  process.removeListener("exit", next.onExit);
  const nextReuse = await reuseDeploymentInputs({ artifactProjectRoot: projectRoot, owner: next.owner, runLifecycleId: next.lifecycleId, reportPath: path.join(next.reports, "reuse.json"), inputManifestPath: frozen.reportPath, inputManifestSha256: frozen.manifestSha256, expectedProjectSha256: frozen.projectSha256 });
  fs.mkdirSync(next.temporary, { recursive: true });
  const overrideSource = path.join(next.temporary, "LICENSE"), overrideBytes = Buffer.from("Packaging-only fixture license override.\nOriginal full input bytes remain unchanged.\n");
  fs.writeFileSync(overrideSource, overrideBytes);
  const overrideSha256 = hash(overrideSource);
  const nextCompact = await preparePackagingWorkspace({ sourceInputs: nextReuse, inputRoot: path.join(projectRoot, "artifacts/inputs/next-compact"), reportPath: path.join(next.reports, "compact.json"), projectOverrides: [{ source: overrideSource, destinationRelative: "LICENSE", sha256: overrideSha256 }] });
  assert.equal(inventoryTree(frozen.inputRoot).sha256, baselineBefore);
  assert.notEqual(nextCompact.packagingSha256, compact.packagingSha256);
  assert.equal(nextCompact.baselineProjectSha256, compact.baselineProjectSha256);
  assert.deepEqual(fs.readFileSync(path.join(nextCompact.sourceRoot, "LICENSE")), overrideBytes);
  assert.equal(nextCompact.files.find(f => f.path === "LICENSE").sha256, overrideSha256);
  assert.deepEqual(nextCompact.files.filter(f => f.path !== "LICENSE"), compact.files.filter(f => f.path !== "LICENSE"));
  execute("pwsh", ["-NoProfile", "-File", path.join(nextCompact.sourceRoot, "scripts/prepare-app-release.ps1"), "-ReleaseDirectory", synthetic.release, "-PreparedHostReceipt", synthetic.receipt, "-OutputDirectory", path.join(synthetic.root, "next-wrapper-output"), "-PackagingInputManifest", nextCompact.reportPath, "-PackagingInputSha256", nextCompact.manifestSha256]);
  const zipLicense = execute(python, ["-B", "-c", "import base64,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z: print(base64.b64encode(z.read('LICENSE')).decode('ascii'))", path.join(synthetic.root, "next-wrapper-output/assets/Azrael-2026.0.0-windows-x64.zip")]);
  assert.deepEqual(Buffer.from(zipLicense, "base64"), overrideBytes);
  assert.equal(inventoryTree(frozen.inputRoot).sha256, baselineBefore);
  process.stdout.write(JSON.stringify({ status: "passed", copiedFiles: compact.copiedFileCount, copiedBytes: compact.copiedBytes, baselineFiles: frozen.immutableInventory.files.length, baselineTimings: frozen.timings, reuseTimings: reused.timings, timings: compact.timings, nextReuseTimings: nextReuse.timings, overrideCaptureTimings: nextCompact.timings, checks: "full capture/reuse/compact + real PS wrapper/Python package/installer PrepareOnly; successful license override through ZIP, confinement, provenance, closure, hashes, tampering and baseline dependencies" }) + "\n");
}
main().catch(e => { process.stderr.write(e.stack + "\n"); process.exitCode = 1; });

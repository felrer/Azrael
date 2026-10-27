"use strict";
const fs = require("node:fs");
const { acquire } = require("./maintenance-lock-owner.cjs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { captureProject } = require("./capture-project-inputs.cjs");
const { snapshotProject } = require("./deployment-input-snapshot.cjs");
const { copyTree, inventoryTree, hash } = require("./freeze-platform-inputs.cjs");
const lifecycle = require("./artifact-lifecycle.cjs");
const inside = (root, file) => { const rel = path.relative(root, file); return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel)); };
const overlaps = (a, b) => inside(a, b) || inside(b, a);
function checked(root, value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0") || value.split(/[\\/]/).includes("..")) throw Error("Absolute deployment path without traversal required");
  const result = path.resolve(value);
  if (result === root || !inside(root, result)) throw Error("Deployment path outside project");
  let current = path.parse(result).root;
  for (const part of result.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw Error("Linked deployment path"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return result;
}
function execute(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw Error(`Deployment preparation command failed: ${command} (${result.status}): ${result.error?.message || result.stderr}`);
  return result.stdout.trim();
}
const git = (root, ...args) => execute("git", ["-c", "core.longpaths=true", "-C", root, ...args]);
function exactRepository(root) {
  if (fs.realpathSync(git(root, "rev-parse", "--show-toplevel")) !== fs.realpathSync(root)) throw Error("Independent project Git root required");
}
function prepareGit(source, destination, snapshot, separateControl) {
  let sequence = 0;
  for (const tree of snapshot.inventory) {
    exactRepository(tree.root);
    const target = path.join(destination, path.relative(source, tree.root));
    fs.mkdirSync(target, { recursive: true });
    if (separateControl) {
      const relative = path.relative(source, tree.root);
      const metadata = path.join(separateControl, relative ? "n" + sequence++ : "git");
      fs.mkdirSync(path.dirname(metadata), { recursive: true });
      git(target, "init", "--quiet", "--separate-git-dir", metadata);
    } else git(target, "init", "--quiet");
    const head = git(tree.root, "rev-parse", "HEAD");
    if (!/^[a-f0-9]{40,64}$/.test(head)) throw Error("Exact source HEAD required");
    git(target, "fetch", "--quiet", "--depth=1", "--no-tags", tree.root, head);
    git(target, "reset", "--mixed", "--no-refresh", head);
  }
}
function rootIdentity(root) {
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("Physical deployment directory required");
  return { realpath: fs.realpathSync(root), dev: stat.dev, ino: stat.ino };
}
function engineSnapshot(project, engine, pythonExecutable) {
  const receipt = path.join(engine, "SOURCE.json");
  if (fs.existsSync(path.join(engine, ".git")) || !fs.existsSync(receipt) || !fs.lstatSync(receipt).isFile() || fs.lstatSync(receipt).isSymbolicLink()) throw Error("Imported SOURCE.json engine without Git metadata required");
  const script = path.join(project, "scripts/engine-provenance.py");
  const expression = "import importlib.util,json,sys; s=importlib.util.spec_from_file_location('deployment_engine_provenance',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(json.dumps(m.snapshot(sys.argv[2]),sort_keys=True))";
  return JSON.parse(execute(pythonExecutable, ["-B", "-c", expression, script, engine]));
}
async function prepareDeploymentWorkspace({ projectRoot, artifactProjectRoot = projectRoot, inputRoot, workingRoot, owner, runLifecycleId, reportPath, engineSourceRoot, projectOverrides = [], pythonExecutable = process.platform === "win32" ? "python" : "python3" }) {
  const started = performance.now();
  const timings = {};
  projectRoot = fs.realpathSync(projectRoot);
  artifactProjectRoot = fs.realpathSync(artifactProjectRoot);
  inputRoot = checked(artifactProjectRoot, inputRoot); workingRoot = checked(artifactProjectRoot, workingRoot); reportPath = checked(artifactProjectRoot, reportPath);
  for (const root of [inputRoot, workingRoot]) {
    if (!inside(path.join(artifactProjectRoot, "artifacts"), root) || overlaps(path.join(artifactProjectRoot, "artifacts/maintenance"), root)) throw Error("Generated deployment scope required");
    if (fs.existsSync(root)) throw Error("Fresh deployment roots required");
  }
  if (overlaps(inputRoot, workingRoot) || inside(inputRoot, reportPath) || inside(workingRoot, reportPath)) throw Error("Disjoint deployment boundaries required");
  const records = lifecycle.catalog(artifactProjectRoot);
  let runRecord = records.find(record => record.id === runLifecycleId);
  if (!runRecord || runRecord.owner !== owner || runRecord.kind !== "run" || runRecord.producer || runRecord.state !== "pending") throw Error("Active caller run with exact owner required");
  if (!runRecord.members.some(member => member.role === "reports" && inside(member.path, reportPath))) throw Error("Report path must be owned by caller reports");
  if (fs.existsSync(reportPath)) throw Error("Fresh deployment report required");
  for (const root of [inputRoot, workingRoot]) if (records.some(record => record.members.some(member => overlaps(root, member.path)))) throw Error("Deployment root already claimed");
  exactRepository(projectRoot);
  const sourceSnapshotStarted = performance.now();
  const source = await snapshotProject(projectRoot);
  timings.sourceSnapshotMs = performance.now() - sourceSnapshotStarted;
  if (!Array.isArray(projectOverrides)) throw Error("Explicit project override array required");
  const overridePaths = new Set();
  const overrides = projectOverrides.map(override => {
    const relative = override?.destinationRelative;
    if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || path.win32.isAbsolute(relative) || /[\0:]/.test(relative) || relative.split(/[\\/]/).some(part => !part || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || [".", "..", ".git", "artifacts", "engine", "control"].includes(part.toLowerCase()))) throw Error("Safe relative project override destination required");
    const normalized = relative.split(/[\\/]/).join(path.sep);
    const identity = process.platform === "win32" ? normalized.toLowerCase() : normalized;
    if (overridePaths.has(identity)) throw Error("Duplicate project override destination");
    overridePaths.add(identity);
    const sourcePath = checked(artifactProjectRoot, override.source);
    if (!fs.lstatSync(sourcePath).isFile() || !/^[a-f0-9]{64}$/.test(override.sha256 || "") || hash(sourcePath) !== override.sha256) throw Error("Exact regular override file and SHA256 required");
    return { source: sourcePath, destinationRelative: normalized, sha256: override.sha256 };
  });
  const topLevels = new Set(["control"]);
  for (const tree of source.inventory) for (const entry of tree.entries) {
    const relative = path.relative(projectRoot, path.join(tree.root, entry.path));
    const top = relative.split(path.sep)[0];
    if (["artifacts", ".git", "control"].includes(top)) throw Error("Generated artifacts or reserved control directory selected as project source");
    topLevels.add(top);
  }
  for (const override of overrides) topLevels.add(override.destinationRelative.split(path.sep)[0]);
  let embeddedEngine = false;
  if (engineSourceRoot !== undefined) {
    if (!path.isAbsolute(engineSourceRoot)) throw Error("Absolute imported engine root required");
    engineSourceRoot = fs.realpathSync(engineSourceRoot);
    embeddedEngine = topLevels.has("engine") && engineSourceRoot === fs.realpathSync(path.join(projectRoot, "engine"));
    if (topLevels.has("engine") && !embeddedEngine) throw Error("Imported engine conflicts with selected project source");
    if ([inputRoot, workingRoot].some(root => overlaps(root, engineSourceRoot))) throw Error("Engine source overlaps deployment roots");
    if (fs.existsSync(path.join(engineSourceRoot, ".git")) || !fs.existsSync(path.join(engineSourceRoot, "SOURCE.json"))) throw Error("Imported SOURCE.json engine without Git metadata required");
    // Reject an invalid imported inventory before claiming/copying two full trees.
    // The frozen and working copies are still independently checked below.
    const enginePreflightStarted = performance.now();
    engineSnapshot(projectRoot, engineSourceRoot, pythonExecutable);
    timings.enginePreflightMs = performance.now() - enginePreflightStarted;
    topLevels.add("engine");
  }
  const suffix = crypto.createHash("sha256").update(inputRoot).digest("hex").slice(0, 24);
  const inputLifecycleId = `input:${suffix}`, workingLifecycleId = `workspace:${suffix}`;
  const member = (file, role) => ({ path: file, role, generated: true, protection_known: true });
  let inputRecord, workingRecord;
  const claimDirectory = checked(artifactProjectRoot, path.join(artifactProjectRoot, "artifacts/maintenance/lifecycles"));
  fs.mkdirSync(claimDirectory, { recursive: true });
  const claimPath = path.join(claimDirectory, ".run-claim.lock"), claim = acquire(claimPath, { operation: "deployment-workspace.claim" });
  try {
    const currentRecords = lifecycle.catalog(artifactProjectRoot);
    for (const root of [inputRoot, workingRoot]) {
      if (fs.existsSync(root) || currentRecords.some(record => record.members.some(member => overlaps(root, member.path)))) throw Error("Deployment root already claimed or created");
    }
    runRecord = currentRecords.find(record => record.id === runLifecycleId);
    if (!runRecord || runRecord.owner !== owner || runRecord.producer || runRecord.state !== "pending") throw Error("Caller run changed before deployment claim");
    inputRecord = lifecycle.recordLifecycle(artifactProjectRoot, { id: inputLifecycleId, kind: "work", owner, state: "pending", membership_complete: false, members: [member(inputRoot, "immutable-input")], expected_revision: 0 });
    workingRecord = lifecycle.recordLifecycle(artifactProjectRoot, { id: workingLifecycleId, kind: "run", owner, state: "pending", membership_complete: false,
      members: [...topLevels].sort().map(top => member(path.join(workingRoot, top), "working-source")),
      references: [{ id: inputLifecycleId, member_paths: [inputRoot], kind: "dependency", reason: "Working source consumes immutable deployment inputs" }], expected_revision: 0 });
    runRecord = lifecycle.recordLifecycle(artifactProjectRoot, { ...runRecord, expected_revision: runRecord.revision, references: [...runRecord.references,
      { id: inputLifecycleId, member_paths: [inputRoot], kind: "execution", reason: "Deployment controller consumes immutable inputs" },
      { id: workingLifecycleId, member_paths: lifecycle.projectMembers(workingRecord.members).map(member => member.path), kind: "execution", reason: "Deployment controller consumes working source" }] });
  } finally { claim.release(); }
  const immutableProjectRoot = path.join(inputRoot, "project");
  const gitStarted = performance.now();
  prepareGit(projectRoot, immutableProjectRoot, source);
  const immutableGitPreparationMs = performance.now() - gitStarted;
  const project = await captureProject(projectRoot, immutableProjectRoot);
  for (const override of overrides) {
    const destination = checked(immutableProjectRoot, path.join(immutableProjectRoot, override.destinationRelative));
    if (hash(override.source) !== override.sha256) throw Error("Override source changed before copy");
    copyTree(override.source, destination, []);
    if (hash(destination) !== override.sha256 || hash(override.source) !== override.sha256) throw Error("Override source changed while copying");
    const repository = git(path.dirname(destination), "rev-parse", "--show-toplevel");
    git(repository, "add", "--force", "--", path.relative(repository, destination));
  }
  const immutableSnapshotStarted = performance.now();
  // captureProject already independently hashes its complete frozen output.
  const immutableProject = overrides.length ? await snapshotProject(immutableProjectRoot) : project.frozenSnapshot;
  timings.immutableSnapshotMs = performance.now() - immutableSnapshotStarted;
  const workingGitStarted = performance.now();
  prepareGit(immutableProjectRoot, workingRoot, immutableProject, path.join(workingRoot, "control"));
  // Source selection excludes only independently audited imported engine/control data.
  const exclude = git(workingRoot, "rev-parse", "--git-path", "info/exclude");
  const excludePath = path.resolve(workingRoot, exclude);
  fs.appendFileSync(excludePath, "\n/control/\n" + (engineSourceRoot && !embeddedEngine ? "/engine/\n" : ""));
  const workingGitPreparationMs = performance.now() - workingGitStarted;
  const workingProject = await captureProject(immutableProjectRoot, workingRoot);
  if (workingProject.sha256 !== immutableProject.sha256) throw Error("Working project differs from immutable inputs");
  timings.immutableCaptureMs = project.elapsedMs;
  timings.workingCaptureMs = workingProject.elapsedMs;
  timings.workingCapturePhasesMs = workingProject.phasesMs;
  timings.workingGitIo = workingProject.gitIo;
  let engine;
  const immutableEngineRoot = engineSourceRoot ? path.join(embeddedEngine ? immutableProjectRoot : inputRoot, "engine") : null;
  const workingEngineRoot = engineSourceRoot ? path.join(workingRoot, "engine") : null;
  if (engineSourceRoot) {
    const engineFreezeStarted = performance.now();
    const before = engineSnapshot(immutableProjectRoot, engineSourceRoot, pythonExecutable);
    if (!embeddedEngine) copyTree(engineSourceRoot, immutableEngineRoot);
    engine = engineSnapshot(immutableProjectRoot, immutableEngineRoot, pythonExecutable);
    if (JSON.stringify(before) !== JSON.stringify(engine) || JSON.stringify(before) !== JSON.stringify(engineSnapshot(immutableProjectRoot, engineSourceRoot, pythonExecutable))) throw Error("Engine changed while freezing source");
    if (!embeddedEngine) copyTree(immutableEngineRoot, workingEngineRoot);
    if (JSON.stringify(engine) !== JSON.stringify(engineSnapshot(immutableProjectRoot, workingEngineRoot, pythonExecutable))) throw Error("Working engine differs from immutable inputs");
    timings.engineFreezeMs = performance.now() - engineFreezeStarted;
  }
  const inventoryStarted = performance.now();
  const immutableInventory = inventoryTree(inputRoot);
  timings.immutableInventoryMs = performance.now() - inventoryStarted;
  const manifest = { schema: 1, projectRoot, artifactProjectRoot, inputRoot, immutableProjectRoot, workingRoot, owner, runLifecycleId, inputLifecycleId, workingLifecycleId, pythonExecutable,
    project, baselineProjectSha256: project.sha256, projectOverrides: overrides, projectSha256: immutableProject.sha256, workingProjectSha256: workingProject.sha256, engine: engine ?? null, embeddedEngine, immutableEngineRoot, workingEngineRoot,
    immutableInventory, rootIdentities: { input: rootIdentity(inputRoot), working: rootIdentity(workingRoot) },
    retainedControlEvidence: { path: path.join(workingRoot, ".git"), text: fs.readFileSync(path.join(workingRoot, ".git"), "utf8"), sha256: hash(path.join(workingRoot, ".git")),
      reason: "Lifecycle member guards exclude .git; retain this small structural gitfile until a supported control-file retirement owner exists" },
    timings: { ...timings, immutableGitPreparationMs, workingGitPreparationMs, preparationMs: performance.now() - started } };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  const manifestSha256 = hash(reportPath);
  inputRecord = lifecycle.closeLifecycle(artifactProjectRoot, inputLifecycleId, { owner, expected_revision: inputRecord.revision, producer_stopped_verified: true, outcome: "success", exit_code: 0,
    reason: "Immutable deployment input preparation completed", evidence_ref: reportPath, evidence_sha256: manifestSha256 });
  return { ...manifest, reportPath, manifestSha256, inputRecord, workingRecord, runRecord };
}
async function verifyDeploymentWorkspace(context) {
  const { artifactProjectRoot, inputRoot, workingRoot, reportPath, manifestSha256 } = context;
  checked(artifactProjectRoot, inputRoot); checked(artifactProjectRoot, workingRoot); checked(artifactProjectRoot, reportPath);
  if (hash(reportPath) !== manifestSha256) throw Error("Deployment input manifest changed");
  const manifest = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (JSON.stringify(rootIdentity(inputRoot)) !== JSON.stringify(manifest.rootIdentities.input) || JSON.stringify(rootIdentity(workingRoot)) !== JSON.stringify(manifest.rootIdentities.working)) throw Error("Deployment root identity changed");
  if (inventoryTree(inputRoot).sha256 !== manifest.immutableInventory.sha256) throw Error("Immutable deployment input inventory changed");
  const sentinel = checked(artifactProjectRoot, path.join(workingRoot, ".git"));
  if (!fs.lstatSync(sentinel).isFile() || fs.readFileSync(sentinel, "utf8") !== manifest.retainedControlEvidence.text || hash(sentinel) !== manifest.retainedControlEvidence.sha256) throw Error("Retained Git control evidence changed");
  if (fs.realpathSync(git(workingRoot, "rev-parse", "--absolute-git-dir")) !== fs.realpathSync(path.join(workingRoot, "control/git"))) throw Error("Working Git metadata escaped owned control directory");
  exactRepository(manifest.immutableProjectRoot); exactRepository(workingRoot);
  const immutable = await snapshotProject(manifest.immutableProjectRoot), compiled = await snapshotProject(workingRoot);
  if (immutable.sha256 !== manifest.projectSha256 || compiled.sha256 !== manifest.projectSha256) throw Error("Compiled project source differs from immutable inputs");
  if (manifest.engine && (JSON.stringify(engineSnapshot(manifest.immutableProjectRoot, manifest.immutableEngineRoot, manifest.pythonExecutable)) !== JSON.stringify(manifest.engine) || JSON.stringify(engineSnapshot(manifest.immutableProjectRoot, manifest.workingEngineRoot, manifest.pythonExecutable)) !== JSON.stringify(manifest.engine))) throw Error("Compiled engine source differs from immutable inputs");
  return { status: "verified", projectSha256: immutable.sha256, engine: manifest.engine, inputLifecycleId: manifest.inputLifecycleId, workingLifecycleId: manifest.workingLifecycleId };
}
module.exports = { prepareDeploymentWorkspace, verifyDeploymentWorkspace };

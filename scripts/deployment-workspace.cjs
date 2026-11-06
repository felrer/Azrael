"use strict";
const fs = require("node:fs");
const { acquire } = require("./maintenance-lock-owner.cjs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { captureProject, copyVerifiedProject, copyVerifiedTree } = require("./capture-project-inputs.cjs");
const { snapshotProject } = require("./deployment-input-snapshot.cjs");
const { copyTree, inventoryTree, hash } = require("./freeze-platform-inputs.cjs");
const lifecycle = require("./artifact-lifecycle.cjs");
const { addArtifactRunReferences } = require("./artifact-run.cjs");
// Only an exact, live result can hand its private verified snapshot to the
// immediately following derived preparation. Serialized receipts are evidence,
// not capabilities, and final verification never consumes this handoff.
const verifiedReuseHandoffs = new WeakMap();
const inside = (root, file) => { const rel = path.relative(root, file); return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel)); };
const overlaps = (a, b) => inside(a, b) || inside(b, a);
function serializeDeploymentManifest(manifest) {
  // Lifecycle close reads this exact evidence through the native registry bound.
  const bytes = Buffer.from(JSON.stringify(manifest) + "\n");
  if (bytes.length > 16 * 1024 * 1024) throw Error(`Deployment manifest evidence exceeds 16 MiB registry bound: ${bytes.length} bytes`);
  return bytes;
}
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
function verifyModuleCacheOwner(manifest, context = manifest) {
  // Older schema-1 manifests already name their owner explicitly, but did not pin its inode.
  if (manifest.schema === 1 && manifest.moduleCacheProjectRoot === undefined && manifest.rootIdentities?.moduleCacheOwner === undefined) {
    if (context.moduleCacheProjectRoot !== undefined) throw Error("Deployment module cache owner changed");
    checked(path.parse(manifest.artifactProjectRoot).root, manifest.artifactProjectRoot);
    rootIdentity(manifest.artifactProjectRoot);
    return manifest.artifactProjectRoot;
  }
  if (manifest.moduleCacheProjectRoot !== manifest.artifactProjectRoot || context.moduleCacheProjectRoot !== manifest.moduleCacheProjectRoot ||
      JSON.stringify(rootIdentity(manifest.moduleCacheProjectRoot)) !== JSON.stringify(manifest.rootIdentities?.moduleCacheOwner)) throw Error("Deployment module cache owner changed");
  return manifest.moduleCacheProjectRoot;
}
function engineSnapshot(project, engine, pythonExecutable) {
  const receipt = path.join(engine, "SOURCE.json");
  if (fs.existsSync(path.join(engine, ".git")) || !fs.existsSync(receipt) || !fs.lstatSync(receipt).isFile() || fs.lstatSync(receipt).isSymbolicLink()) throw Error("Imported SOURCE.json engine without Git metadata required");
  const script = path.join(project, "scripts/engine-provenance.py");
  const expression = "import importlib.util,json,sys; s=importlib.util.spec_from_file_location('deployment_engine_provenance',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(json.dumps(m.snapshot(sys.argv[2]),sort_keys=True))";
  return JSON.parse(execute(pythonExecutable, ["-B", "-c", expression, script, engine]));
}
function engineValidationTools(project) {
  return ["engine-provenance.py", "import-engine-source.py", "azrael-platforms.json", "engine-native-materialization.py"]
    .map(name => { const file = path.join(project, "scripts", name); return [name, fs.existsSync(file) ? hash(file) : null]; });
}
async function prepareDeploymentWorkspace({ projectRoot, artifactProjectRoot = projectRoot, inputRoot, workingRoot, owner, runLifecycleId, reportPath, engineSourceRoot, projectOverrides = [], sourceInputs, pythonExecutable = process.platform === "win32" ? "python" : "python3" }) {
  if (sourceInputs) {
    if (projectRoot && projectRoot !== sourceInputs.sourceRoot || engineSourceRoot && engineSourceRoot !== sourceInputs.immutableEngineRoot) throw Error("Derived input cannot change its selected baseline source or engine");
    return prepareDerivedDeploymentWorkspace({ artifactProjectRoot: artifactProjectRoot ?? sourceInputs.artifactProjectRoot, inputRoot, workingRoot,
      owner: owner ?? sourceInputs.owner, runLifecycleId: runLifecycleId ?? sourceInputs.runLifecycleId, reportPath, projectOverrides, sourceInputs });
  }
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
  let embeddedEngine = false, engineBaseline, engineSourceIdentity, engineTools;
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
    engineSourceIdentity = rootIdentity(engineSourceRoot);
    engineTools = engineValidationTools(projectRoot);
    engineBaseline = engineSnapshot(projectRoot, engineSourceRoot, pythonExecutable);
    if (JSON.stringify(engineValidationTools(projectRoot)) !== JSON.stringify(engineTools)) throw Error("Engine validation tools changed during preflight");
    if (JSON.stringify(rootIdentity(engineSourceRoot)) !== JSON.stringify(engineSourceIdentity)) throw Error("Engine source root changed during preflight");
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
    runRecord = addArtifactRunReferences(artifactProjectRoot, runLifecycleId, { owner, expected_revision: runRecord.revision, references: [
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
  const workingProject = await copyVerifiedProject(immutableProjectRoot, workingRoot, immutableProject);
  timings.immutableCaptureMs = project.elapsedMs;
  timings.workingCaptureMs = workingProject.elapsedMs;
  timings.workingCapturePhasesMs = workingProject.phasesMs;
  timings.workingGitIo = workingProject.gitIo;
  let engine;
  const immutableEngineRoot = engineSourceRoot ? path.join(embeddedEngine ? immutableProjectRoot : inputRoot, "engine") : null;
  const workingEngineRoot = engineSourceRoot ? path.join(workingRoot, "engine") : null;
  if (engineSourceRoot) {
    const engineFreezeStarted = performance.now();
    // The preflight is already the before-copy observation. Keep its wider
    // interval rather than rereading the whole engine immediately before copy.
    if (JSON.stringify(rootIdentity(engineSourceRoot)) !== JSON.stringify(engineSourceIdentity)) throw Error("Engine source root changed while freezing source");
    const before = JSON.stringify(engineValidationTools(immutableProjectRoot)) === JSON.stringify(engineTools)
      ? engineBaseline : engineSnapshot(immutableProjectRoot, engineSourceRoot, pythonExecutable);
    if (!embeddedEngine) copyTree(engineSourceRoot, immutableEngineRoot);
    engine = engineSnapshot(immutableProjectRoot, immutableEngineRoot, pythonExecutable);
    if (JSON.stringify(before) !== JSON.stringify(engine) || JSON.stringify(before) !== JSON.stringify(engineSnapshot(immutableProjectRoot, engineSourceRoot, pythonExecutable))) throw Error("Engine changed while freezing source");
    if (JSON.stringify(rootIdentity(engineSourceRoot)) !== JSON.stringify(engineSourceIdentity)) throw Error("Engine source root changed while freezing source");
    if (!embeddedEngine) await copyVerifiedTree(immutableEngineRoot, workingEngineRoot);
    timings.engineFreezeMs = performance.now() - engineFreezeStarted;
  }
  const inventoryStarted = performance.now();
  const immutableInventory = inventoryTree(inputRoot);
  timings.immutableInventoryMs = performance.now() - inventoryStarted;
  const manifest = { schema: 1, projectRoot, artifactProjectRoot, moduleCacheProjectRoot: artifactProjectRoot, inputRoot, immutableProjectRoot, workingRoot, owner, runLifecycleId, inputLifecycleId, workingLifecycleId, pythonExecutable,
    project, baselineProjectSha256: project.sha256, projectOverrides: overrides, projectSha256: immutableProject.sha256, workingProjectSha256: immutableProject.sha256, workingCopy: workingProject, engine: engine ?? null, embeddedEngine, immutableEngineRoot, workingEngineRoot,
    immutableInventory, rootIdentities: { input: rootIdentity(inputRoot), working: rootIdentity(workingRoot), moduleCacheOwner: rootIdentity(artifactProjectRoot) },
    retainedControlEvidence: { path: path.join(workingRoot, ".git"), text: fs.readFileSync(path.join(workingRoot, ".git"), "utf8"), sha256: hash(path.join(workingRoot, ".git")),
      reason: "Lifecycle member guards exclude .git; retain this small structural gitfile until a supported control-file retirement owner exists" },
    timings: { ...timings, immutableGitPreparationMs, workingGitPreparationMs, preparationMs: performance.now() - started } };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, serializeDeploymentManifest(manifest), { flag: "wx" });
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
  const moduleCacheProjectRoot = verifyModuleCacheOwner(manifest, context);
  if (manifest.schema === 2 && manifest.inputKind === "script-delta") return verifyDerivedDeploymentWorkspace(context, manifest);
  if (manifest.schema !== 1) throw Error("Unsupported deployment input manifest");
  if (JSON.stringify(rootIdentity(inputRoot)) !== JSON.stringify(manifest.rootIdentities.input) || JSON.stringify(rootIdentity(workingRoot)) !== JSON.stringify(manifest.rootIdentities.working)) throw Error("Deployment root identity changed");
  if (inventoryTree(inputRoot).sha256 !== manifest.immutableInventory.sha256) throw Error("Immutable deployment input inventory changed");
  const sentinel = checked(artifactProjectRoot, path.join(workingRoot, ".git"));
  if (!fs.lstatSync(sentinel).isFile() || fs.readFileSync(sentinel, "utf8") !== manifest.retainedControlEvidence.text || hash(sentinel) !== manifest.retainedControlEvidence.sha256) throw Error("Retained Git control evidence changed");
  if (fs.realpathSync(git(workingRoot, "rev-parse", "--absolute-git-dir")) !== fs.realpathSync(path.join(workingRoot, "control/git"))) throw Error("Working Git metadata escaped owned control directory");
  exactRepository(manifest.immutableProjectRoot); exactRepository(workingRoot);
  const immutable = await snapshotProject(manifest.immutableProjectRoot), compiled = await snapshotProject(workingRoot);
  if (immutable.sha256 !== manifest.projectSha256 || compiled.sha256 !== manifest.projectSha256) throw Error("Compiled project source differs from immutable inputs");
  if (manifest.engine && (JSON.stringify(engineSnapshot(manifest.immutableProjectRoot, manifest.immutableEngineRoot, manifest.pythonExecutable)) !== JSON.stringify(manifest.engine) || JSON.stringify(engineSnapshot(manifest.immutableProjectRoot, manifest.workingEngineRoot, manifest.pythonExecutable)) !== JSON.stringify(manifest.engine))) throw Error("Compiled engine source differs from immutable inputs");
  return { status: "verified", moduleCacheProjectRoot, projectSha256: immutable.sha256, engine: manifest.engine, inputLifecycleId: manifest.inputLifecycleId, workingLifecycleId: manifest.workingLifecycleId };
}
function reuseSelection(options) {
  for (const name of ["artifactProjectRoot", "owner", "runLifecycleId", "reportPath", "inputManifestPath", "inputManifestSha256", "expectedProjectSha256"])
    if (typeof options?.[name] !== "string" || !options[name]) throw Error(`Explicit reuse ${name} required`);
  for (const name of ["inputManifestSha256", "expectedProjectSha256"])
    if (!/^[a-f0-9]{64}$/.test(options[name])) throw Error(`Exact reuse ${name} required`);
  if (!path.isAbsolute(options.artifactProjectRoot) || options.artifactProjectRoot.split(/[\\/]/).includes("..")) throw Error("Absolute artifact project root without traversal required");
  const artifactProjectRoot = path.resolve(options.artifactProjectRoot);
  // Check physical ancestors before canonicalization can hide a linked root.
  checked(path.parse(artifactProjectRoot).root, artifactProjectRoot);
  const reportPath = checked(artifactProjectRoot, options.reportPath);
  const inputManifestPath = checked(artifactProjectRoot, options.inputManifestPath);
  if (!fs.lstatSync(inputManifestPath).isFile() || hash(inputManifestPath) !== options.inputManifestSha256) throw Error("Original deployment input manifest changed");
  const manifest = JSON.parse(fs.readFileSync(inputManifestPath, "utf8"));
  if (manifest.schema !== 1 || manifest.artifactProjectRoot !== artifactProjectRoot || manifest.projectSha256 !== options.expectedProjectSha256) throw Error("Original deployment input selection mismatch");
  verifyModuleCacheOwner(manifest);
  const inputRoot = checked(artifactProjectRoot, manifest.inputRoot);
  if (!inside(path.join(artifactProjectRoot, "artifacts"), inputRoot) || overlaps(path.join(artifactProjectRoot, "artifacts/maintenance"), inputRoot) ||
      manifest.immutableProjectRoot !== path.join(inputRoot, "project") || inside(inputRoot, reportPath) || reportPath === inputManifestPath || inside(inputRoot, inputManifestPath)) throw Error("Disjoint contained reuse paths required");
  checked(inputRoot, manifest.immutableProjectRoot);
  if (manifest.engine && manifest.immutableEngineRoot !== path.join(manifest.embeddedEngine ? manifest.immutableProjectRoot : inputRoot, "engine")) throw Error("Contained immutable engine required");
  if (JSON.stringify(rootIdentity(inputRoot)) !== JSON.stringify(manifest.rootIdentities?.input)) throw Error("Deployment input root identity changed");
  return { ...options, artifactProjectRoot, reportPath, inputManifestPath, manifest, inputRoot };
}
function reuseOwners(selection, records, requireActiveCaller = true) {
  const { manifest, owner, runLifecycleId, inputRoot, reportPath, inputManifestPath, inputManifestSha256 } = selection;
  const input = records.find(record => record.id === manifest.inputLifecycleId);
  if (!input || input.kind !== "work" || input.owner !== manifest.owner || input.state !== "complete" || !input.membership_complete ||
      input.producer?.status !== "stopped" || input.producer.outcome !== "success" || input.producer.exit_code !== 0 ||
      input.producer.evidence_ref !== inputManifestPath || input.producer.evidence_sha256 !== inputManifestSha256 ||
      !input.members.some(member => member.path === inputRoot && member.role === "immutable-input" && member.generated === true && member.protection_known === true)) throw Error("Successfully frozen original input owner required");
  if (lifecycle.cleanupReservation(selection.artifactProjectRoot, input)) throw Error("Input has active cleanup reservation");
  const manifestOwner = records.find(record => record.id === manifest.runLifecycleId);
  const reports = manifestOwner?.members.find(member => member.role === "reports" && inside(member.path, inputManifestPath));
  const manifestMember = manifestOwner && lifecycle.projectMembers(manifestOwner.members).find(member => inside(member.path, inputManifestPath));
  if (!manifestOwner || manifestOwner.kind !== "run" || manifestOwner.owner !== manifest.owner || !reports || !manifestMember ||
      reports.generated !== true || reports.protection_known !== true || manifestMember.generated !== true || manifestMember.protection_known !== true) throw Error("Original manifest reports owner required");
  if (lifecycle.cleanupReservation(selection.artifactProjectRoot, manifestOwner)) throw Error("Original manifest has active cleanup reservation");
  const caller = records.find(record => record.id === runLifecycleId);
  if (!caller || caller.owner !== owner || caller.kind !== "run" || (requireActiveCaller && (caller.producer || caller.state !== "pending")) ||
      !caller.members.some(member => member.role === "reports" && inside(member.path, reportPath))) throw Error("Active caller run with owned reports required");
  if (records.some(record => record.id !== runLifecycleId && record.members.some(member => overlaps(member.path, reportPath)))) throw Error("Reuse report already claimed");
  return { input, caller, manifestOwner, manifestMember, reports };
}
async function verifyFrozenSelection(selection) {
  const { manifest, inputRoot } = selection;
  const sourceIdentity = rootIdentity(manifest.immutableProjectRoot);
  const before = inventoryTree(inputRoot);
  if (before.links.length || before.sha256 !== manifest.immutableInventory?.sha256) throw Error("Immutable deployment input inventory changed or linked");
  for (const file of before.files) {
    if (fs.lstatSync(path.join(inputRoot, file.path)).nlink !== 1 || /(^|\/)\.git\/objects\/info\/(alternates|http-alternates)$/.test(file.path)) throw Error("Linked or alternate immutable input rejected");
  }
  exactRepository(manifest.immutableProjectRoot);
  const snapshot = await snapshotProject(manifest.immutableProjectRoot);
  if (snapshot.sha256 !== selection.expectedProjectSha256) throw Error("Immutable project source differs from selected inputs");
  if (manifest.engine && JSON.stringify(engineSnapshot(manifest.immutableProjectRoot, manifest.immutableEngineRoot, manifest.pythonExecutable)) !== JSON.stringify(manifest.engine)) throw Error("Immutable engine source differs from selected inputs");
  if (inventoryTree(inputRoot).sha256 !== before.sha256 || JSON.stringify(rootIdentity(manifest.immutableProjectRoot)) !== JSON.stringify(sourceIdentity) || JSON.stringify(rootIdentity(inputRoot)) !== JSON.stringify(manifest.rootIdentities.input) || hash(selection.inputManifestPath) !== selection.inputManifestSha256) throw Error("Immutable deployment inputs changed during verification");
  return snapshot;
}
async function reuseDeploymentInputs(options) {
  const started = performance.now();
  const selection = reuseSelection(options);
  const { artifactProjectRoot, inputRoot, manifest, reportPath } = selection;
  const directory = checked(artifactProjectRoot, path.join(artifactProjectRoot, "artifacts/maintenance/lifecycles"));
  const claim = acquire(path.join(directory, ".run-claim.lock"), { operation: "deployment-input.reuse", waitMs: 5000 });
  let runRecord;
  let manifestOwnership;
  try {
    lifecycle.withCatalogLock(artifactProjectRoot, () => {
      const { caller, manifestOwner, manifestMember, reports } = reuseOwners(selection, lifecycle.catalog(artifactProjectRoot));
      manifestOwnership = { inputManifestLifecycleId: manifestOwner.id, inputManifestMemberPath: manifestMember.path, inputManifestReportsPath: reports.path };
      if (fs.existsSync(reportPath)) throw Error("Fresh reuse report required");
      runRecord = addArtifactRunReferences(artifactProjectRoot, selection.runLifecycleId, { owner: selection.owner, expected_revision: caller.revision,
        references: [{ id: manifest.inputLifecycleId, member_paths: [inputRoot], kind: "execution", reason: "Read-only consumer reuses immutable deployment inputs" },
          { id: manifestOwner.id, member_paths: [manifestMember.path], kind: "execution", reason: "Read-only consumer requires original deployment input manifest" }] });
    });
  } finally { claim.release(); }
  // Once held, references belong to the caller and survive all failures until truthful close.
  const verifiedStarted = performance.now();
  const snapshot = await verifyFrozenSelection(selection);
  reuseOwners(selection, lifecycle.catalog(artifactProjectRoot));
  const reference = { schema: 1, readOnly: true, artifactProjectRoot, moduleCacheProjectRoot: verifyModuleCacheOwner(manifest),
    moduleCacheOwnerOrigin: manifest.moduleCacheOwnerOrigin ?? (manifest.moduleCacheProjectRoot ? 'artifact-project-root' : 'legacy-artifact-project-root'), owner: selection.owner, runLifecycleId: selection.runLifecycleId,
    sourceRoot: manifest.immutableProjectRoot, immutableProjectRoot: manifest.immutableProjectRoot, inputRoot, inputLifecycleId: manifest.inputLifecycleId,
    inputManifestPath: selection.inputManifestPath, inputManifestSha256: selection.inputManifestSha256, expectedProjectSha256: selection.expectedProjectSha256, ...manifestOwnership,
    projectSha256: manifest.projectSha256, engine: manifest.engine, immutableEngineRoot: manifest.immutableEngineRoot,
    rootIdentities: { input: rootIdentity(inputRoot), source: rootIdentity(manifest.immutableProjectRoot), moduleCacheOwner: rootIdentity(artifactProjectRoot) },
    copiedFileCount: 0, copiedBytes: 0, timings: { verificationMs: performance.now() - verifiedStarted, reuseMs: performance.now() - started } };
  fs.writeFileSync(reportPath, JSON.stringify(reference, null, 2) + "\n", { flag: "wx" });
  const result = { ...reference, reportPath, manifestSha256: hash(reportPath), runRecord };
  verifiedReuseHandoffs.set(result, { snapshot, reportPath, manifestSha256: result.manifestSha256 });
  return result;
}
async function verifyReusedDeploymentSelection(context, consumeHandoff = false) {
  const handoff = consumeHandoff ? verifiedReuseHandoffs.get(context) : undefined;
  if (consumeHandoff) verifiedReuseHandoffs.delete(context);
  const reportPath = checked(context.artifactProjectRoot, context.reportPath);
  if (!fs.lstatSync(reportPath).isFile() || hash(reportPath) !== context.manifestSha256) throw Error("Reused deployment reference manifest changed");
  const reference = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  verifyModuleCacheOwner(reference, context);
  for (const name of ["artifactProjectRoot", "owner", "runLifecycleId", "inputManifestPath", "inputManifestSha256", "expectedProjectSha256", "sourceRoot", "immutableProjectRoot", "immutableEngineRoot", "projectSha256", "readOnly", "inputRoot", "inputLifecycleId", "inputManifestLifecycleId", "inputManifestMemberPath", "inputManifestReportsPath"])
    if (reference[name] !== context[name]) throw Error("Reused deployment reference selection mismatch");
  if (JSON.stringify(reference.engine) !== JSON.stringify(context.engine) || JSON.stringify(reference.rootIdentities) !== JSON.stringify(context.rootIdentities)) throw Error("Reused deployment reference identity mismatch");
  if (reference.schema !== 1 || reference.readOnly !== true || reference.copiedFileCount !== 0 || reference.copiedBytes !== 0) throw Error("Read-only deployment reference required");
  const selection = reuseSelection({ ...reference, reportPath });
  if (reference.immutableProjectRoot !== reference.sourceRoot || reference.projectSha256 !== selection.expectedProjectSha256 || reference.immutableEngineRoot !== selection.manifest.immutableEngineRoot || JSON.stringify(reference.engine) !== JSON.stringify(selection.manifest.engine)) throw Error("Reused deployment input binding mismatch");
  const { manifestOwner, manifestMember, reports } = reuseOwners(selection, lifecycle.catalog(selection.artifactProjectRoot), false);
  if (reference.inputManifestLifecycleId !== manifestOwner.id || reference.inputManifestMemberPath !== manifestMember.path || reference.inputManifestReportsPath !== reports.path) throw Error("Original manifest owner identity changed");
  if (reference.inputLifecycleId !== selection.manifest.inputLifecycleId || reference.sourceRoot !== selection.manifest.immutableProjectRoot ||
      JSON.stringify(reference.rootIdentities.input) !== JSON.stringify(rootIdentity(selection.inputRoot)) ||
      JSON.stringify(reference.rootIdentities.source) !== JSON.stringify(rootIdentity(reference.sourceRoot))) throw Error("Reused deployment root identity changed");
  const snapshot = handoff && handoff.reportPath === reportPath && handoff.manifestSha256 === context.manifestSha256
    ? handoff.snapshot : await verifyFrozenSelection(selection);
  // Verification proves identity and contents; execution/dependency leases belong to the consumer.
  reuseOwners(selection, lifecycle.catalog(selection.artifactProjectRoot), false);
  if (hash(reportPath) !== context.manifestSha256 || JSON.stringify(rootIdentity(reference.sourceRoot)) !== JSON.stringify(reference.rootIdentities.source)) throw Error("Reused deployment reference changed during verification");
  return { selection, reference, snapshot };
}
async function verifyReusedDeploymentInputs(context) {
  const { selection, reference } = await verifyReusedDeploymentSelection(context);
  return { status: "verified", readOnly: true, moduleCacheProjectRoot: verifyModuleCacheOwner(reference), projectSha256: selection.manifest.projectSha256, inputLifecycleId: reference.inputLifecycleId,
    engine: selection.manifest.engine, sourceRoot: selection.manifest.immutableProjectRoot, immutableProjectRoot: selection.manifest.immutableProjectRoot,
    immutableEngineRoot: selection.manifest.immutableEngineRoot };
}
// Script corrections retain the full original input instead of duplicating it.
// A fresh writable checkout is still independent; it is never an immutable root.
function scriptOverrides(root, baseline, overrides) {
  if (!Array.isArray(overrides) || !overrides.length) throw Error("Explicit script overrides required");
  const seen = new Set();
  return overrides.map(override => {
    const relative = override?.destinationRelative;
    if (typeof relative !== 'string' || !/^scripts\/[A-Za-z0-9_.-]+\.(?:cjs|mjs|js|ps1|py|json)$/.test(relative) ||
        /[. ]$/.test(relative) || seen.has(relative.toLowerCase())) throw Error("Unique existing top-level script override required; other changes require full input preparation");
    seen.add(relative.toLowerCase());
    const original = checked(baseline.sourceRoot, path.join(baseline.sourceRoot, relative));
    const source = checked(root, override.source);
    for (const file of [original, source]) if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).nlink !== 1) throw Error("Regular unlinked script override required");
    if (!/^[a-f0-9]{64}$/.test(override.sha256 || '') || hash(source) !== override.sha256) throw Error("Exact script override SHA256 required");
    return { source, destinationRelative: relative, sha256: override.sha256, mode: fs.lstatSync(original).mode & 0o777 };
  });
}
function derivedProjectSha256(snapshot, overrides) {
  const entries = snapshot.inventory[0].entries.map(entry => ({ ...entry }));
  for (const override of overrides) {
    const entry = entries.find(entry => entry.path === override.destinationRelative);
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw Error("Override must replace an existing selected script");
    entry.sha256 = override.sha256;
  }
  return crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}
async function prepareDerivedDeploymentWorkspace(options) {
  const { artifactProjectRoot, owner, runLifecycleId, sourceInputs } = options;
  if (artifactProjectRoot !== sourceInputs.artifactProjectRoot || owner !== sourceInputs.owner || runLifecycleId !== sourceInputs.runLifecycleId) throw Error("Derived input must use its active baseline consumer");
  const inputRoot = checked(artifactProjectRoot, options.inputRoot), workingRoot = checked(artifactProjectRoot, options.workingRoot), reportPath = checked(artifactProjectRoot, options.reportPath);
  const overrides = scriptOverrides(artifactProjectRoot, sourceInputs, options.projectOverrides);
  for (const output of [inputRoot, workingRoot]) {
    if (!inside(path.join(artifactProjectRoot, 'artifacts'), output) || overlaps(output, path.join(artifactProjectRoot, 'artifacts/maintenance')) ||
        overlaps(output, sourceInputs.inputRoot) || overlaps(output, sourceInputs.sourceRoot) || fs.existsSync(output)) throw Error("Fresh disjoint generated derived roots required");
  }
  if (overlaps(inputRoot, workingRoot) || inside(inputRoot, reportPath) || inside(workingRoot, reportPath) || fs.existsSync(reportPath)) throw Error("Fresh disjoint derived report required");
  const { selection, snapshot } = await verifyReusedDeploymentSelection(sourceInputs, true);
  const expectedProjectSha256 = derivedProjectSha256(snapshot, overrides);
  const topLevels = new Set(['control']);
  for (const entry of snapshot.inventory[0].entries) {
    const top = entry.path.split(/[\\/]/)[0];
    if (['.git', 'artifacts', 'control'].includes(top)) throw Error("Reserved derived source selected");
    topLevels.add(top);
  }
  if (sourceInputs.engine) topLevels.add('engine');
  const suffix = crypto.createHash('sha256').update(inputRoot).digest('hex').slice(0, 24);
  const inputLifecycleId = `input:${suffix}`, workingLifecycleId = `workspace:${suffix}`;
  const member = (file, role) => ({ path: file, role, generated: true, protection_known: true });
  let inputRecord, workingRecord, runRecord;
  const claim = acquire(path.join(artifactProjectRoot, 'artifacts/maintenance/lifecycles/.run-claim.lock'), { operation: 'deployment-input.derive', waitMs: 5000 });
  try {
    lifecycle.withCatalogLock(artifactProjectRoot, () => {
      const records = lifecycle.catalog(artifactProjectRoot), { caller, manifestOwner, manifestMember } = reuseOwners(selection, records);
      for (const output of [inputRoot, workingRoot]) if (fs.existsSync(output) || records.some(record => record.members.some(member => overlaps(output, member.path)))) throw Error("Derived root already claimed");
      if (records.some(record => record.id !== runLifecycleId && record.members.some(member => overlaps(member.path, reportPath))) ||
          !caller.members.some(member => member.role === 'reports' && inside(member.path, reportPath))) throw Error("Caller-owned derived reports required");
      const callerReportMember = lifecycle.projectMembers(caller.members).find(member => inside(member.path, reportPath));
      const references = [
        { id: sourceInputs.inputLifecycleId, member_paths: [sourceInputs.inputRoot], kind: 'dependency', reason: 'Derived scripts require unchanged immutable baseline' },
        { id: manifestOwner.id, member_paths: [manifestMember.path], kind: 'dependency', reason: 'Original baseline manifest and verification evidence' },
        { id: caller.id, member_paths: [callerReportMember.path], kind: 'dependency', reason: 'Derived manifest and baseline reference remain necessary' }];
      inputRecord = lifecycle.recordLifecycle(artifactProjectRoot, { id: inputLifecycleId, kind: 'work', owner, state: 'pending', membership_complete: false, members: [member(inputRoot, 'immutable-script-delta')], references, expected_revision: 0 });
      workingRecord = lifecycle.recordLifecycle(artifactProjectRoot, { id: workingLifecycleId, kind: 'run', owner, state: 'pending', membership_complete: false,
        members: [...topLevels].sort().map(top => member(path.join(workingRoot, top), 'working-source')),
        references: [{ id: inputLifecycleId, member_paths: [inputRoot], kind: 'dependency', reason: 'Working source consumes baseline plus script delta' }], expected_revision: 0 });
      runRecord = addArtifactRunReferences(artifactProjectRoot, runLifecycleId, { owner, expected_revision: caller.revision, references: [
        { id: inputLifecycleId, kind: 'execution', reason: 'Preparing compact immutable script delta' },
        { id: workingLifecycleId, kind: 'execution', reason: 'Preparing independent derived working source' }] });
    });
  } finally { claim.release(); }
  try {
    const frozenOverrides = overrides.map(override => {
      const source = path.join(inputRoot, 'overrides', override.destinationRelative);
      copyTree(override.source, source, []); fs.chmodSync(source, override.mode);
      if (hash(source) !== override.sha256) throw Error("Script override changed while freezing");
      return { ...override, source };
    });
    prepareGit(sourceInputs.sourceRoot, workingRoot, snapshot, path.join(workingRoot, 'control'));
    const excludePath = path.resolve(workingRoot, git(workingRoot, 'rev-parse', '--git-path', 'info/exclude'));
    fs.appendFileSync(excludePath, '\n/control/\n' + (sourceInputs.engine && !selection.manifest.embeddedEngine ? '/engine/\n' : ''));
    const project = await copyVerifiedProject(sourceInputs.sourceRoot, workingRoot, snapshot);
    for (const override of frozenOverrides) {
      const destination = checked(workingRoot, path.join(workingRoot, override.destinationRelative));
      fs.copyFileSync(override.source, destination);
      git(workingRoot, 'add', '--force', '--', override.destinationRelative);
    }
    if (sourceInputs.engine && !selection.manifest.embeddedEngine) await copyVerifiedTree(sourceInputs.immutableEngineRoot, path.join(workingRoot, 'engine'));
    await verifyReusedDeploymentInputs(sourceInputs);
    const sentinel = path.join(workingRoot, '.git');
    const manifest = { schema: 2, inputKind: 'script-delta', artifactProjectRoot, moduleCacheProjectRoot: verifyModuleCacheOwner(sourceInputs),
      moduleCacheOwnerOrigin: sourceInputs.moduleCacheOwnerOrigin ?? (sourceInputs.moduleCacheProjectRoot ? 'artifact-project-root' : 'legacy-artifact-project-root'), owner, runLifecycleId, inputRoot, workingRoot, inputLifecycleId, workingLifecycleId,
      sourceInputs, projectOverrides: frozenOverrides, baselineProjectSha256: sourceInputs.projectSha256, projectSha256: expectedProjectSha256,
      immutableProjectRoot: null, immutableEngineRoot: sourceInputs.immutableEngineRoot, workingEngineRoot: sourceInputs.engine ? path.join(workingRoot, 'engine') : null,
      engine: sourceInputs.engine, pythonExecutable: selection.manifest.pythonExecutable,
      projectCopy: { fileCount: project.fileCount, bytes: project.bytes, sha256: project.sourceSha256, mode: project.mode, contentVerified: false }, workingCopy: project,
      immutableInventory: inventoryTree(inputRoot), rootIdentities: { input: rootIdentity(inputRoot), working: rootIdentity(workingRoot), moduleCacheOwner: rootIdentity(artifactProjectRoot) },
      retainedControlEvidence: { path: sentinel, text: fs.readFileSync(sentinel, 'utf8'), sha256: hash(sentinel) } };
    fs.writeFileSync(reportPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    const manifestSha256 = hash(reportPath);
    inputRecord = lifecycle.closeLifecycle(artifactProjectRoot, inputLifecycleId, { owner, expected_revision: inputRecord.revision, producer_stopped_verified: true, outcome: 'success', exit_code: 0,
      reason: 'Compact script delta frozen and working copy completed; consumer verifies working content', evidence_ref: reportPath, evidence_sha256: manifestSha256 });
    return { ...manifest, reportPath, manifestSha256, inputRecord, workingRecord, runRecord };
  } catch (error) {
    const evidence_ref = reportPath + '.failure.json';
    fs.writeFileSync(evidence_ref, JSON.stringify({ status: 'failed', error: error.message, producerStopped: true }) + '\n', { flag: 'wx' });
    const evidence = { owner, producer_stopped_verified: true, outcome: 'failure', exit_code: 1, reason: 'Derived preparation settled with failure', evidence_ref, evidence_sha256: hash(evidence_ref) };
    for (const record of [inputRecord, workingRecord]) {
      try { lifecycle.closeLifecycle(artifactProjectRoot, record.id, { ...evidence, expected_revision: record.revision }); }
      catch (closeError) { (error.lifecycleCloseErrors ??= []).push(closeError.message); }
    }
    throw error;
  }
}
async function verifyDerivedDeploymentWorkspace(context, manifest) {
  const { artifactProjectRoot, inputRoot, workingRoot, reportPath, manifestSha256 } = context;
  for (const name of ['artifactProjectRoot', 'inputRoot', 'workingRoot']) if (context[name] !== manifest[name]) throw Error("Derived deployment selection mismatch");
  if (manifest.immutableProjectRoot !== null || JSON.stringify(rootIdentity(inputRoot)) !== JSON.stringify(manifest.rootIdentities.input) ||
      JSON.stringify(rootIdentity(workingRoot)) !== JSON.stringify(manifest.rootIdentities.working)) throw Error("Derived deployment root identity changed");
  const records = lifecycle.catalog(artifactProjectRoot), input = records.find(record => record.id === manifest.inputLifecycleId);
  if (!input || input.owner !== manifest.owner || input.state !== 'complete' || !input.membership_complete || input.producer?.outcome !== 'success' ||
      input.producer.evidence_ref !== reportPath || input.producer.evidence_sha256 !== manifestSha256 || lifecycle.cleanupReservation(artifactProjectRoot, input)) throw Error("Successfully frozen derived input owner required");
  const before = inventoryTree(inputRoot);
  if (before.links.length || before.sha256 !== manifest.immutableInventory.sha256 || before.files.some(file => fs.lstatSync(path.join(inputRoot, file.path)).nlink !== 1)) throw Error("Derived immutable input inventory changed or linked");
  const { selection, snapshot } = await verifyReusedDeploymentSelection(manifest.sourceInputs);
  const overrides = scriptOverrides(artifactProjectRoot, manifest.sourceInputs, manifest.projectOverrides);
  for (const override of overrides) if (override.source !== path.join(inputRoot, 'overrides', override.destinationRelative)) throw Error("Derived script must belong to immutable delta");
  if (derivedProjectSha256(snapshot, overrides) !== manifest.projectSha256 || manifest.baselineProjectSha256 !== manifest.sourceInputs.projectSha256 ||
      JSON.stringify(manifest.engine) !== JSON.stringify(manifest.sourceInputs.engine) || manifest.immutableEngineRoot !== manifest.sourceInputs.immutableEngineRoot) throw Error("Derived baseline binding changed");
  exactRepository(workingRoot);
  const sentinel = checked(artifactProjectRoot, path.join(workingRoot, '.git'));
  if (hash(sentinel) !== manifest.retainedControlEvidence.sha256 || fs.readFileSync(sentinel, 'utf8') !== manifest.retainedControlEvidence.text ||
      fs.realpathSync(git(workingRoot, 'rev-parse', '--absolute-git-dir')) !== fs.realpathSync(path.join(workingRoot, 'control/git'))) throw Error("Derived Git control identity changed");
  if ((await snapshotProject(workingRoot)).sha256 !== manifest.projectSha256) throw Error("Derived working source differs from selected inputs");
  for (const override of overrides) {
    const file = checked(workingRoot, path.join(workingRoot, override.destinationRelative)), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== override.mode) throw Error("Derived working script identity or mode changed");
  }
  if (manifest.engine && JSON.stringify(engineSnapshot(manifest.sourceInputs.sourceRoot, manifest.workingEngineRoot, selection.manifest.pythonExecutable)) !== JSON.stringify(manifest.engine)) throw Error("Derived engine differs from selected inputs");
  if (inventoryTree(inputRoot).sha256 !== before.sha256 || hash(reportPath) !== manifestSha256 ||
      JSON.stringify(rootIdentity(inputRoot)) !== JSON.stringify(manifest.rootIdentities.input) ||
      JSON.stringify(rootIdentity(workingRoot)) !== JSON.stringify(manifest.rootIdentities.working)) throw Error("Derived inputs changed during verification");
  return { status: 'verified', inputKind: 'script-delta', moduleCacheProjectRoot: manifest.moduleCacheProjectRoot, projectSha256: manifest.projectSha256, engine: manifest.engine, inputLifecycleId: manifest.inputLifecycleId, workingLifecycleId: manifest.workingLifecycleId };
}
async function resolveDeploymentModuleCacheOwner({ manifestPath, manifestSha256, projectRoot }) {
  if (typeof manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifestSha256)) throw Error('Exact deployment manifest SHA256 required');
  for (const value of [manifestPath, projectRoot]) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw Error('Absolute deployment manifest and execution project required');
    checked(path.parse(value).root, value);
  }
  if (hash(manifestPath) !== manifestSha256) throw Error('Deployment input manifest changed');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.readOnly || typeof manifest.workingRoot !== 'string') throw Error('Writable deployment workspace required');
  if (fs.realpathSync(manifest.workingRoot) !== fs.realpathSync(projectRoot)) throw Error('Deployment execution project differs from selected working root');
  const verified = await verifyDeploymentWorkspace({ ...manifest, reportPath: manifestPath, manifestSha256 });
  return { moduleCacheProjectRoot: verified.moduleCacheProjectRoot, workingRoot: manifest.workingRoot,
    moduleCacheOwnerOrigin: manifest.moduleCacheOwnerOrigin ?? (manifest.moduleCacheProjectRoot ? 'artifact-project-root' : 'legacy-artifact-project-root') };
}
module.exports = { serializeDeploymentManifest, prepareDeploymentWorkspace, verifyDeploymentWorkspace, reuseDeploymentInputs, verifyReusedDeploymentInputs, resolveDeploymentModuleCacheOwner,
  ...require("./deployment-control-retirement.cjs") };
if (require.main === module) {
  const [action, manifestPath, manifestSha256, projectRoot, ...extra] = process.argv.slice(2);
  if (action !== '--module-cache-owner' || extra.length) { console.error('Expected --module-cache-owner MANIFEST SHA256 EXECUTION_PROJECT'); process.exitCode = 1; }
  else resolveDeploymentModuleCacheOwner({ manifestPath, manifestSha256, projectRoot }).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}

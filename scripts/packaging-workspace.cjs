"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { builtinModules } = require("node:module");
const { acquire } = require("./maintenance-lock-owner.cjs");
const lifecycle = require("./artifact-lifecycle.cjs");
const { addArtifactRunReferences } = require("./artifact-run.cjs");
const { verifyReusedDeploymentInputs } = require("./deployment-workspace.cjs");
const { inventoryTree, hash } = require("./freeze-platform-inputs.cjs");
const inside = (root, file) => { const r = path.relative(root, file); return !path.isAbsolute(r) && r !== ".." && !r.startsWith(".." + path.sep); };
const overlaps = (a, b) => inside(a, b) || inside(b, a);
const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const MINIMUM = ["scripts/prepare-app-release.ps1", "scripts/package-app-release.py", "scripts/install-app-release.ps1", "scripts/azrael-app-release.json", "scripts/packaging-workspace.cjs", "LICENSE", "engine/LICENSE", "engine/NOTICE"];
// Reviewed verifier closure, including the worker runtime entry. Literal local
// imports are checked against this boundary; dynamic imports fail closed.
const MODULES = ["packaging-workspace", "deployment-workspace", "deployment-control-retirement", "deployment-control-retirement-native", "lifecycle-empty-publication-recovery", "artifact-lifecycle", "artifact-observations", "artifact-run", "maintenance-lock-owner", "maintenance-preferences", "maintenance-owner-config", "maintenance-lock-worker", "freeze-platform-inputs", "capture-project-inputs", "deployment-input-snapshot"].map(n => `scripts/${n}.cjs`);
const ALLOWED = new Set([...MINIMUM, ...MODULES]);
function checked(root, value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0") || value.split(/[\\/]/).includes("..")) throw Error("Absolute contained packaging path required");
  const result = path.resolve(value);
  if (!inside(root, result) || result === root) throw Error("Packaging path escaped boundary");
  for (let current = result;; current = path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) throw Error("Linked packaging path rejected"); } catch (e) { if (e.code !== "ENOENT") throw e; }
    if (path.dirname(current) === current) break;
  }
  return result;
}
function identity(file) {
  const s = fs.lstatSync(file);
  if (s.isSymbolicLink() || (!s.isFile() && !s.isDirectory()) || (s.isFile() && s.nlink !== 1)) throw Error("Physical unlinked packaging input required");
  return { realpath: fs.realpathSync(file), dev: s.dev, ino: s.ino, mode: s.mode, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs };
}
function rootIdentity(root) {
  if (!fs.lstatSync(root).isDirectory()) throw Error("Physical packaging directory required");
  const { realpath, dev, ino } = identity(root); return { realpath, dev, ino };
}
function readGuarded(root, file) {
  checked(root, file);
  const parents = [];
  for (let p = path.dirname(file); inside(root, p); p = path.dirname(p)) { parents.push([p, rootIdentity(p)]); if (p === root) break; }
  const before = identity(file);
  if (!fs.lstatSync(file).isFile()) throw Error("Regular packaging source required");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let bytes;
  try { const s = fs.fstatSync(fd); if (s.dev !== before.dev || s.ino !== before.ino || s.nlink !== 1) throw Error("Packaging source identity changed"); bytes = fs.readFileSync(fd); } finally { fs.closeSync(fd); }
  if (JSON.stringify(identity(file)) !== JSON.stringify(before) || parents.some(([p, i]) => JSON.stringify(rootIdentity(p)) !== JSON.stringify(i))) throw Error("Packaging source changed while reading");
  return { bytes, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), identity: before };
}
function closure(select) {
  const pending = [...MINIMUM, ...MODULES], result = new Map();
  while (pending.length) {
    const relative = pending.shift();
    if (result.has(relative)) continue;
    if (!ALLOWED.has(relative)) throw Error(`Unreviewed packaging dependency: ${relative}`);
    const selected = select(relative); result.set(relative, selected);
    if (!relative.endsWith(".cjs")) continue;
    const text = selected.bytes.toString("utf8");
    const calls = [...text.matchAll(/\brequire(?:\.resolve)?\s*\(([^\n]*?)\)/g)];
    if ([...text.matchAll(/\brequire(?:\.resolve)?\s*\(/g)].length !== calls.length || /\bimport\s*\(/.test(text)) throw Error(`Unsupported dynamic packaging dependency: ${relative}`);
    for (const call of calls) {
      const literal = /^\s*(["'])([^"']+)\1\s*$/.exec(call[1]);
      if (!literal) throw Error(`Unaccounted dynamic packaging dependency: ${relative}`);
      const name = literal[2];
      if (name.startsWith("node:") || builtinModules.includes(name)) continue;
      if (!name.startsWith("./") && !name.startsWith("../")) throw Error(`External packaging dependency: ${name}`);
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(relative), name));
      if (!ALLOWED.has(dependency)) throw Error(`Unreviewed packaging dependency: ${dependency}`);
      pending.push(dependency);
    }
  }
  return result;
}
function ownerState(context) {
  const records = lifecycle.catalog(context.artifactProjectRoot);
  const caller = records.find(r => r.id === context.runLifecycleId);
  if (!caller || caller.owner !== context.owner || caller.kind !== "run" || caller.state !== "pending" || caller.producer || !caller.members.some(m => m.role === "reports" && inside(m.path, context.reportPath))) throw Error("Active packaging caller with owned report required");
  if (inside(context.inputRoot, context.reportPath) || records.some(r => r.id !== caller.id && r.members.some(m => overlaps(m.path, context.reportPath)))) throw Error("Disjoint caller-owned packaging report required");
  return { records, caller };
}
async function preparePackagingWorkspace({ sourceInputs, inputRoot, reportPath, projectOverrides = [] }) {
  const started = performance.now();
  await verifyReusedDeploymentInputs(sourceInputs);
  if (!sourceInputs.engine?.sourceSha256) throw Error("Original engine source fingerprint required");
  const { artifactProjectRoot, owner, runLifecycleId } = sourceInputs;
  inputRoot = checked(artifactProjectRoot, inputRoot); reportPath = checked(artifactProjectRoot, reportPath);
  if (!inside(path.join(artifactProjectRoot, "artifacts"), inputRoot) || overlaps(path.join(artifactProjectRoot, "artifacts/maintenance"), inputRoot) || overlaps(inputRoot, sourceInputs.inputRoot) || inside(inputRoot, reportPath)) throw Error("Disjoint generated packaging root required");
  if (!Array.isArray(projectOverrides)) throw Error("Packaging override array required");
  const overrides = new Map();
  for (const o of projectOverrides) {
    if (!o || !ALLOWED.has(o.destinationRelative) || overrides.has(o.destinationRelative.toLowerCase()) || !/^[a-f0-9]{64}$/.test(o.sha256 || "")) throw Error("Exact allowed unique packaging override required");
    const source = checked(artifactProjectRoot, o.source), read = readGuarded(artifactProjectRoot, source);
    if (read.sha256 !== o.sha256) throw Error("Packaging override hash changed");
    overrides.set(o.destinationRelative.toLowerCase(), { ...o, source });
  }
  const select = relative => {
    const o = overrides.get(relative.toLowerCase());
    // Imported engine lives outside project/ in some frozen captures.
    const root = !o && relative.startsWith("engine/") ? sourceInputs.immutableEngineRoot : !o ? sourceInputs.sourceRoot : artifactProjectRoot;
    const source = o?.source || path.join(root, relative.startsWith("engine/") ? relative.slice(7) : relative);
    const selected = readGuarded(root, source);
    if (o && selected.sha256 !== o.sha256) throw Error("Packaging override hash changed");
    return { ...selected, source, root };
  };
  const selected = closure(select);
  for (const o of overrides.values()) if (!selected.has(o.destinationRelative)) throw Error("Override outside selected packaging closure");
  const inputLifecycleId = `packaging-input:${digest(inputRoot).slice(0, 24)}`;
  const context = { artifactProjectRoot, owner, runLifecycleId, inputRoot, sourceRoot: path.join(inputRoot, "project"), reportPath, inputLifecycleId };
  let record;
  const claim = acquire(path.join(artifactProjectRoot, "artifacts/maintenance/lifecycles/.run-claim.lock"), { operation: "packaging-input.claim" });
  try {
    lifecycle.withCatalogLock(artifactProjectRoot, () => {
      const { records, caller } = ownerState(context);
      if (fs.existsSync(inputRoot) || fs.existsSync(reportPath) || records.some(r => r.members.some(m => overlaps(m.path, inputRoot)))) throw Error("Fresh unclaimed packaging paths required");
      const reportOwners = [sourceInputs.reportPath, sourceInputs.inputManifestPath].map(p => {
        const r = records.find(r => r.members.some(m => m.role === "reports" && inside(m.path, p)));
        if (!r) throw Error("Owned baseline evidence required");
        return { id: r.id, member_paths: [lifecycle.projectMembers(r.members).find(m => inside(m.path, p)).path], kind: "dependency", reason: "Compact packaging retains baseline verification evidence" };
      });
      const references = [{ id: sourceInputs.inputLifecycleId, member_paths: [sourceInputs.inputRoot], kind: "dependency", reason: "Compact packaging retains original frozen inputs" }, ...reportOwners];
      const unique = [...new Map(references.map(r => [r.id + JSON.stringify(r.member_paths), r])).values()];
      record = lifecycle.recordLifecycle(artifactProjectRoot, { id: inputLifecycleId, kind: "work", owner, state: "pending", membership_complete: false, members: [{ path: inputRoot, role: "immutable-input", generated: true, protection_known: true }], references: unique, expected_revision: 0 });
      addArtifactRunReferences(artifactProjectRoot, runLifecycleId, { owner, expected_revision: caller.revision, references: [{ id: inputLifecycleId, member_paths: [inputRoot], kind: "execution", reason: "Packaging caller consumes compact frozen inputs" }] });
    });
  } finally { claim.release(); }
  const copyStarted = performance.now(), files = [];
  fs.mkdirSync(context.sourceRoot, { recursive: true });
  for (const [relative, selection] of selected) {
    const read = readGuarded(selection.root, selection.source);
    if (read.sha256 !== selection.sha256 || JSON.stringify(read.identity) !== JSON.stringify(selection.identity)) throw Error("Packaging source changed before copy");
    const destination = checked(context.sourceRoot, path.join(context.sourceRoot, relative));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, read.bytes, { flag: "wx", mode: selection.identity.mode & 0o777 });
    const after = readGuarded(selection.root, selection.source);
    if (hash(destination) !== selection.sha256 || after.sha256 !== selection.sha256 || JSON.stringify(after.identity) !== JSON.stringify(selection.identity)) throw Error("Packaging source changed during copy");
    files.push({ path: relative, bytes: read.bytes.length, sha256: read.sha256 });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  await verifyReusedDeploymentInputs(sourceInputs);
  const immutableInventory = inventoryTree(inputRoot);
  if (immutableInventory.links.length || immutableInventory.files.length !== files.length) throw Error("Unexpected packaging inventory");
  const manifest = { schema: 1, packagingOnly: true, ...context, baseline: sourceInputs, baselineProjectSha256: sourceInputs.projectSha256, engineSourceSha256: sourceInputs.engine.sourceSha256,
    projectOverrides: [...overrides.values()], files, copiedFileCount: files.length, copiedBytes: files.reduce((n, f) => n + f.bytes, 0),
    packagingSha256: digest({ baselineProjectSha256: sourceInputs.projectSha256, files, projectOverrides: [...overrides.values()] }),
    immutableInventory, rootIdentities: { input: rootIdentity(inputRoot), source: rootIdentity(context.sourceRoot) }, timings: { copyMs: performance.now() - copyStarted, preparationMs: performance.now() - started } };
  fs.writeFileSync(reportPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  const manifestSha256 = hash(reportPath);
  lifecycle.closeLifecycle(artifactProjectRoot, inputLifecycleId, { owner, expected_revision: record.revision, producer_stopped_verified: true, outcome: "success", exit_code: 0, reason: "Compact packaging capture completed", evidence_ref: reportPath, evidence_sha256: manifestSha256 });
  return { ...manifest, manifestSha256 };
}
async function verifyPackagingWorkspace(context) {
  checked(context.artifactProjectRoot, context.reportPath);
  if (!/^[a-f0-9]{64}$/.test(context.manifestSha256 || "") || hash(context.reportPath) !== context.manifestSha256) throw Error("Packaging manifest hash changed");
  const m = JSON.parse(fs.readFileSync(context.reportPath, "utf8"));
  for (const k of ["artifactProjectRoot", "owner", "runLifecycleId", "inputRoot", "sourceRoot", "inputLifecycleId", "reportPath"]) if (context[k] !== m[k]) throw Error("Packaging context mismatch");
  checked(m.artifactProjectRoot, m.inputRoot);
  if (m.schema !== 1 || m.packagingOnly !== true || m.sourceRoot !== path.join(m.inputRoot, "project")) throw Error("Compact packaging manifest required");
  const { records, caller } = ownerState(m), input = records.find(r => r.id === m.inputLifecycleId);
  if (!input || input.owner !== m.owner || input.state !== "complete" || !input.membership_complete || input.producer?.outcome !== "success" || input.producer.exit_code !== 0 || input.producer.evidence_ref !== m.reportPath || input.producer.evidence_sha256 !== context.manifestSha256 || lifecycle.cleanupReservation(m.artifactProjectRoot, input) || !input.members.some(r => r.path === m.inputRoot) || !caller.references.some(r => r.id === input.id && r.kind === "execution" && r.member_paths?.includes(m.inputRoot))) throw Error("Held successful packaging owner required");
  for (const [id, target] of [[m.baseline.inputLifecycleId, m.baseline.inputRoot], ...[m.baseline.reportPath, m.baseline.inputManifestPath].map(p => { const r = records.find(r => r.members.some(x => x.role === "reports" && inside(x.path, p))); return [r?.id, r && lifecycle.projectMembers(r.members).find(x => inside(x.path, p))?.path]; })]) if (!input.references.some(r => r.id === id && r.kind === "dependency" && r.member_paths?.includes(target))) throw Error("Packaging baseline dependency missing");
  await verifyReusedDeploymentInputs(m.baseline);
  if (m.engineSourceSha256 !== m.baseline.engine?.sourceSha256 || m.baselineProjectSha256 !== m.baseline.projectSha256 || m.packagingSha256 !== digest({ baselineProjectSha256: m.baselineProjectSha256, files: m.files, projectOverrides: m.projectOverrides })) throw Error("Packaging baseline binding changed");
  if (JSON.stringify(rootIdentity(m.inputRoot)) !== JSON.stringify(m.rootIdentities.input) || JSON.stringify(rootIdentity(m.sourceRoot)) !== JSON.stringify(m.rootIdentities.source) || inventoryTree(m.inputRoot).sha256 !== m.immutableInventory.sha256) throw Error("Compact packaging inventory changed");
  for (const f of m.immutableInventory.files) readGuarded(m.inputRoot, path.join(m.inputRoot, f.path));
  if (hash(m.reportPath) !== context.manifestSha256) throw Error("Packaging manifest changed during verification");
  return { status: "verified", sourceRoot: m.sourceRoot, packagingSha256: m.packagingSha256, engineSourceSha256: m.engineSourceSha256 };
}
module.exports = { preparePackagingWorkspace, verifyPackagingWorkspace };
if (require.main === module) (async () => {
  if (process.argv.length !== 5 || process.argv[2] !== "verify") throw Error("Usage: packaging-workspace.cjs verify <reportPath> <sha256>");
  const reportPath = path.resolve(process.argv[3]), m = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  // Resolve the installed owner through the copied verifier, with its original
  // artifact catalog root explicitly selected; no primary source script loading.
  if (!process.env.AZRAEL_MAINTENANCE_OWNER) {
    const command = require("./maintenance-owner-config.cjs").resolveMaintenanceCommand(m.artifactProjectRoot);
    process.env.AZRAEL_MAINTENANCE_OWNER = command.executable;
    process.env.AZRAEL_MAINTENANCE_OWNER_MODE = command.args.length ? "azrael-maintenance" : "standalone";
  }
  process.stdout.write(JSON.stringify(await verifyPackagingWorkspace({ ...m, reportPath, manifestSha256: process.argv[4] })) + "\n");
})().catch(e => { process.stderr.write(e.stack + "\n"); process.exitCode = 1; });

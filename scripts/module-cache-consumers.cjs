"use strict";

// The caller holds the physical module cache's exclusive lease throughout attach.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const lifecycle = require("./artifact-lifecycle.cjs");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const read = filename => JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, ""));
function physical(filename) {
  if (typeof filename !== "string" || !path.isAbsolute(filename) || filename.split(/[\\/]/).includes("..")) throw new Error("Absolute physical path required");
  const resolved = path.resolve(filename);
  let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Linked consumer path");
  }
  const stat = fs.statSync(resolved, { bigint: true });
  return { path: fs.realpathSync.native(resolved), dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) };
}
function contained(root, filename) {
  const relative = path.relative(root, filename);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error("Consumer path outside physical root");
  return filename;
}
function identity(ownerRoot, projectRoot, versionId, module, key) {
  if (module !== "companion" || !/^[a-f0-9]{64}$/.test(key) || !/^version:[^\\/:]+$/.test(versionId)) throw new Error("Invalid exact module cache consumer identity");
  const owner = physical(ownerRoot), project = physical(projectRoot);
  if (owner.path !== project.path) contained(owner.path, project.path);
  const token = sha(JSON.stringify([project.path, versionId, module, key]));
  return { schema: 1, id: `run:module-cache-consumer:${token}`, owner, project, versionId, module, key,
    reference: { id: `run:module-cache:${module}:${key}`, reason: "companion-tool", kind: "dependency" },
    bindingPath: path.join(owner.path, "artifacts/cache/module-consumers", token, "binding.json") };
}
function exact(reference, expected) {
  return reference.id === expected.id && reference.reason === expected.reason && reference.kind === expected.kind &&
    reference.member_paths === undefined && reference.target_revision === undefined && reference.target_version === undefined;
}
function plannedRelease(filename) {
  let ancestor = path.dirname(filename);
  for (;;) {
    try { fs.lstatSync(ancestor); break; }
    catch (error) { if (error.code !== "ENOENT") throw error; ancestor = path.dirname(ancestor); }
  }
  return { kind: "planned", path: filename, ancestor: physical(ancestor) };
}
function checkPlanned(release, filename) {
  if (release.kind !== "planned" || release.path !== filename || path.resolve(filename) !== filename ||
      !release.ancestor || !isDeepStrictEqual(physical(release.ancestor.path), release.ancestor)) throw new Error("Planned release ancestor or path changed");
  contained(release.ancestor.path, filename);
}
function sourceRecord(binding, invalidation, allowPlanned = false) {
  if (!isDeepStrictEqual(physical(binding.project.path), binding.project) || !isDeepStrictEqual(physical(binding.owner.path), binding.owner)) throw new Error("Consumer physical root identity changed");
  const source = lifecycle.catalog(binding.project.path).find(record => record.id === binding.versionId);
  if (!source || source.owner !== "azrael-release" || source.kind !== "version" || !invalidation && (source.state === "failed" ||
      source.producer && source.producer.outcome !== "success")) throw new Error("Exact source release lifecycle required");
  const releases = source.members.filter(member => member.role === "release");
  if (releases.length !== 1) throw new Error("Exact source release member required");
  contained(binding.project.path, releases[0].path);
  if (path.basename(releases[0].path) !== binding.versionId.slice("version:".length)) throw new Error("Source release version mismatch");
  const filename = releases[0].path;
  try { return { source, release: physical(filename) }; }
  catch (error) {
    if (error.code !== "ENOENT" || !allowPlanned || source.state !== "pending" || source.producer || source.membership_complete) throw error;
    return { source, release: plannedRelease(filename) };
  }
}
function immutable(filename, value) {
  const bytes = JSON.stringify(value, null, 2) + "\n";
  if (fs.existsSync(filename)) {
    if (fs.readFileSync(filename, "utf8") !== bytes) throw new Error("Conflicting immutable consumer binding or proof");
  } else fs.writeFileSync(filename, bytes, { flag: "wx" });
  return sha(bytes);
}
function bindingRecord(expected) {
  physical(expected.bindingPath);
  const binding = read(expected.bindingPath);
  for (const key of Object.keys(expected)) if (!isDeepStrictEqual(binding[key], expected[key])) throw new Error("Consumer binding mismatch");
  if (!exact(binding.sourceReference || {}, expected.reference) || !binding.release || !path.isAbsolute(binding.release.path)) throw new Error("Consumer source binding mismatch");
  const record = lifecycle.catalog(expected.owner.path).find(record => record.id === expected.id);
  if (!record || record.owner !== "module-cache-consumer" || record.kind !== "run" || !["pending", "complete"].includes(record.state) || record.producer ||
      !record.membership_complete || record.members.length !== 1 || record.members[0].path !== path.dirname(expected.bindingPath) ||
      record.members[0].role !== "consumer-receipt" || record.version !== expected.versionId) throw new Error("Consumer proxy lifecycle mismatch");
  return { binding, record };
}
function attach(ownerRoot, projectRoot, versionId, module, key) {
  const expected = identity(ownerRoot, projectRoot, versionId, module, key);
  const { source, release } = sourceRecord(expected, undefined, true);
  if (!source.references.some(reference => exact(reference, expected.reference))) throw new Error("Exact source companion-tool dependency required");
  const cache = path.join(expected.owner.path, "artifacts/cache/modules", module, key);
  contained(expected.owner.path, cache);
  // The entry may not exist yet; validate its extant ancestors before recipe use.
  let ancestor = cache;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  physical(ancestor);
  let binding = { ...expected, release, sourceReference: source.references.find(reference => exact(reference, expected.reference)) };
  let previous = lifecycle.catalog(expected.owner.path).find(record => record.id === expected.id);
  if (previous?.membership_complete) {
    const validated = bindingRecord(expected);
    if (validated.binding.release.kind === "planned") checkPlanned(validated.binding.release, release.path);
    else if (!isDeepStrictEqual(validated.binding.release, release)) throw new Error("Source release physical identity changed");
    if (!validated.record.references.some(reference => exact(reference, expected.reference))) throw new Error("Released consumer cannot be reattached");
    return { id: expected.id, bindingPath: expected.bindingPath, reference: expected.reference };
  }
  const members = [{ path: path.dirname(expected.bindingPath), role: "consumer-receipt", generated: true, protection_known: true }];
  if (previous && (previous.owner !== "module-cache-consumer" || previous.kind !== "run" || previous.version !== versionId ||
      previous.state !== "pending" || previous.membership_complete || previous.producer || !isDeepStrictEqual(previous.members, members) ||
      previous.references.length !== 1 || !exact(previous.references[0], expected.reference))) throw new Error("Conflicting pending consumer proxy");
  if (previous && fs.existsSync(expected.bindingPath)) {
    physical(expected.bindingPath);
    const stored = read(expected.bindingPath);
    for (const key of Object.keys(expected)) if (!isDeepStrictEqual(stored[key], expected[key])) throw new Error("Consumer binding mismatch");
    if (!isDeepStrictEqual(stored.sourceReference, binding.sourceReference)) throw new Error("Consumer source binding mismatch");
    if (stored.release?.kind === "planned") checkPlanned(stored.release, release.path);
    else if (!isDeepStrictEqual(stored.release, release)) throw new Error("Source release physical identity changed");
    binding = stored;
  }
  if (!previous) previous = lifecycle.recordLifecycle(expected.owner.path, { id: expected.id, kind: "run", owner: "module-cache-consumer", version: versionId,
    expected_revision: 0, state: "pending", membership_complete: false, members, references: [expected.reference] });
  fs.mkdirSync(path.dirname(expected.bindingPath), { recursive: true });
  physical(path.dirname(expected.bindingPath));
  immutable(expected.bindingPath, binding);
  lifecycle.recordLifecycle(expected.owner.path, { id: expected.id, kind: "run", owner: "module-cache-consumer", version: versionId,
    expected_revision: previous.revision, state: "pending", membership_complete: true, members, references: [expected.reference] });
  return { id: expected.id, bindingPath: expected.bindingPath, reference: expected.reference };
}
function sealedRelease(binding) {
  if (binding.release.kind !== "planned") return binding.release;
  checkPlanned(binding.release, binding.release.path);
  const filename = path.join(path.dirname(binding.bindingPath), "release-identity.json");
  physical(filename);
  const receipt = read(filename);
  if (receipt.schema !== 1 || receipt.bindingSha256 !== sha(fs.readFileSync(binding.bindingPath)) ||
      receipt.release?.path !== binding.release.path || !isDeepStrictEqual(physical(binding.release.path), receipt.release)) throw new Error("Sealed release identity changed");
  return receipt.release;
}
function seal(ownerRoot, projectRoot, versionId, module, key) {
  const expected = identity(ownerRoot, projectRoot, versionId, module, key);
  const { binding, record } = bindingRecord(expected);
  const { source, release } = sourceRecord(binding);
  if (source.state !== "pending" || source.producer || source.membership_complete || record.state !== "pending" ||
      !source.references.some(reference => exact(reference, expected.reference)) ||
      !record.references.some(reference => exact(reference, expected.reference))) throw new Error("Exact pending source and consumer dependency required for seal");
  if (binding.release.kind !== "planned") {
    if (!isDeepStrictEqual(release, binding.release)) throw new Error("Source release physical identity changed");
    return { id: expected.id, release };
  }
  checkPlanned(binding.release, release.path);
  const plain = filename => {
    const checked = physical(filename).path;
    const stat = fs.lstatSync(checked);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error("Plain packaged release file required for seal");
    return checked;
  };
  const build = read(plain(path.join(release.path, "build-info.json")));
  const required = ["engine/azrael.exe", "engine/azrael-bridge.exe", "engine/azrael-code-mode-host.exe", "azrael-ex.vsix"];
  if (build.product !== "azrael-ex" || !build.sha256 || required.some(name => !/^[a-f0-9]{64}$/i.test(build.sha256[name] || ""))) throw new Error("Complete packaged release receipt required for seal");
  for (const name of required) if (sha(fs.readFileSync(plain(path.join(release.path, name)))) !== build.sha256[name].toLowerCase()) throw new Error("Packaged release changed before seal");
  if (!isDeepStrictEqual(physical(release.path), release)) throw new Error("Source release physical identity changed");
  const receipt = { schema: 1, bindingSha256: sha(fs.readFileSync(expected.bindingPath)), release };
  const receiptPath = path.join(path.dirname(expected.bindingPath), "release-identity.json");
  immutable(receiptPath, receipt);
  sealedRelease(binding);
  return { id: expected.id, release, receiptPath };
}
function legacyToolOwner(projectRoot, config, option) {
  physical(option?.evidence_ref);
  const evidence = lifecycle.checkedEvidence(projectRoot, { ...option, reason: "Explicit legacy preparation tool cache invalidation" });
  const bytes = fs.readFileSync(evidence.evidence_ref);
  if (sha(bytes) !== evidence.evidence_sha256) throw new Error("Invalidation evidence SHA256 changed");
  const authority = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  const owner = physical(authority.cache_owner), project = physical(projectRoot);
  if (owner.path !== project.path) contained(owner.path, project.path);
  const key = path.basename(config.toolDirectory);
  const cache = path.join(owner.path, "artifacts/cache/modules/companion", key);
  if (!/^[a-f0-9]{64}$/.test(key) || path.resolve(config.toolDirectory) !== cache || physical(cache).path !== cache) throw new Error("Exact legacy tool cache owner path required");
  const markerPath = physical(path.join(cache, "owner.json")).path;
  const markerStat = fs.lstatSync(markerPath);
  if (!markerStat.isFile() || markerStat.nlink !== 1 || markerStat.size < 1 || markerStat.size > 65536) throw new Error("Plain bounded legacy tool cache owner marker required");
  const marker = read(markerPath);
  const record = lifecycle.catalog(owner.path).find(record => record.id === `run:module-cache:companion:${key}`);
  if (marker.schema !== 1 || marker.module !== "companion" || marker.key !== key || !record || record.owner !== "module-build-cache" ||
      record.kind !== "run" || record.members.length !== 1 || record.members[0].role !== "cache-entry" || record.members[0].path !== cache ||
      record.members[0].generated !== true || record.members[0].protection_known !== true) throw new Error("Matching legacy tool cache lifecycle and marker required");
  if (!isDeepStrictEqual(physical(owner.path), owner) || !isDeepStrictEqual(physical(project.path), project)) throw new Error("Legacy tool cache physical identity changed");
  return owner.path;
}
function hasConsumer(ownerRoot, projectRoot, versionId, module, key) {
  const expected = identity(ownerRoot, projectRoot, versionId, module, key);
  const listed = listConsumers(ownerRoot, projectRoot).filter(value => value.id === expected.id);
  const recorded = lifecycle.catalog(expected.owner.path).some(record => record.id === expected.id);
  let exists = false;
  for (let current = expected.bindingPath; current !== expected.owner.path; current = path.dirname(current)) {
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error("Linked consumer binding path");
      if (current === expected.bindingPath) exists = true;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (listed.length || recorded || exists) { bindingRecord(expected); return true; }
  return false;
}
function toolInvalidation(projectRoot, output, config, versionId, option) {
  if (!option) return null;
  physical(option.evidence_ref);
  const evidence = lifecycle.checkedEvidence(projectRoot, { ...option, reason: "Explicit preparation tool cache invalidation" });
  const filename = physical(evidence.evidence_ref).path;
  if (!fs.lstatSync(filename).isFile() || fs.lstatSync(filename).nlink !== 1) throw new Error("Plain independent invalidation evidence required");
  for (const boundary of [output, config.release, config.toolDirectory]) {
    const relative = path.relative(path.resolve(boundary), filename);
    if (!relative || !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep)) throw new Error("External invalidation evidence required");
  }
  const authorityBytes = fs.readFileSync(filename);
  if (sha(authorityBytes) !== evidence.evidence_sha256) throw new Error("Invalidation evidence SHA256 changed");
  const authority = JSON.parse(authorityBytes.toString("utf8").replace(/^\uFEFF/, ""));
  if (authority.schema !== 1 || authority.action !== "invalidate-preparation-tool-cache" || authority.user_authorized !== true ||
      authority.project !== path.resolve(projectRoot) || authority.release_id !== versionId || authority.release !== path.resolve(config.release) ||
      authority.tool_directory !== path.resolve(config.toolDirectory) || authority.cache_owner !== path.resolve(config.cacheOwner) ||
      authority.checkpoint_sha256 !== sha(fs.readFileSync(path.join(output, "preparation-state.json"))) ||
      typeof authority.reason !== "string" || !authority.reason.trim()) throw new Error("Exact user-authorized tool cache invalidation evidence required");
  return { evidence_ref: filename, evidence_sha256: evidence.evidence_sha256, authority,
    reason: `Explicit user-authorized preparation tool cache invalidation: ${JSON.stringify({ evidence_ref: filename, evidence_sha256: evidence.evidence_sha256, reason: authority.reason })}` };
}
function release(ownerRoot, projectRoot, versionId, module, key, evidencePath, evidenceSha, invalidationOption) {
  const expected = identity(ownerRoot, projectRoot, versionId, module, key);
  const { binding, record } = bindingRecord(expected);
  const checkpoint = read(evidencePath), completed = checkpoint.stages?.complete;
  const config = checkpoint.inputs?.config;
  const invalidation = toolInvalidation(projectRoot, path.dirname(evidencePath), { ...config, cacheOwner: ownerRoot }, versionId, invalidationOption);
  const { source, release: releaseIdentity } = sourceRecord(binding, invalidation);
  if (!isDeepStrictEqual(releaseIdentity, sealedRelease(binding))) throw new Error("Source release physical identity changed");
  if (source.references.some(reference => exact(reference, expected.reference))) throw new Error("Source dependency must be released first");
  lifecycle.checkedEvidence(expected.project.path, { evidence_ref: evidencePath, evidence_sha256: evidenceSha, reason: "Verified preparation checkpoint" });
  if (source.release_receipt?.evidence_ref !== path.resolve(evidencePath) || source.release_receipt.evidence_sha256 !== evidenceSha) throw new Error("Validated source dependency release evidence required");
  const sourceRequest = { owner: source.owner, expected_revision: source.revision - 1,
    reference_ids: [binding.sourceReference.reference_id],
    reason: invalidation?.reason || "Verified package is complete; preparation tools can be recreated for subsequent checks.",
    evidence_ref: evidencePath, evidence_sha256: evidenceSha };
  if (source.release_receipt.request_sha256 !== sha(JSON.stringify(Object.keys(sourceRequest).sort().map(key => [key, sourceRequest[key]])))) throw new Error("Exact source dependency release receipt required");
  if (!completed || path.resolve(config?.release || "") !== binding.release.path ||
      path.resolve(config?.toolDirectory || "") !== path.join(expected.owner.path, "artifacts/cache/modules", module, key) ||
      path.resolve(completed.data?.ReleaseDirectory || "") !== binding.release.path ||
      sha(fs.readFileSync(physical(completed.data.HostVsix).path)) !== completed.hostSha256 ||
      sha(fs.readFileSync(physical(path.join(path.dirname(evidencePath), "independent-prepared.json")).path)) !== completed.manifestSha256) throw new Error("Validated completed preparation checkpoint required");
  const references = record.references.filter(reference => exact(reference, expected.reference));
  const complete = current => {
    if (current.state === "pending" && current.references.length === 0) lifecycle.recordLifecycle(expected.owner.path, { id: current.id, owner: current.owner,
      kind: current.kind, version: current.version, expected_revision: current.revision, state: "complete", membership_complete: true,
      members: current.members, references: [] });
  };
  if (!references.length) { complete(record); return { released: 0 }; }
  const proofPath = path.join(path.dirname(expected.bindingPath), "release.json");
  // Keep immutable, independently readable source evidence with the owner receipt.
  const proof = { schema: 1, bindingSha256: sha(fs.readFileSync(expected.bindingPath)), sourceReleaseReceipt: source.release_receipt,
    sourceRevision: source.revision, checkpointSha256: evidenceSha, checkpoint,
    ...(invalidation ? { invalidation } : {}) };
  const proofSha = immutable(proofPath, proof);
  const released = lifecycle.releaseReferences(expected.owner.path, record.id, { owner: record.owner, expected_revision: record.revision,
    reference_ids: references.map(reference => reference.reference_id), reason: "Verified preparation released the exact source companion-tool dependency.",
    evidence_ref: proofPath, evidence_sha256: proofSha });
  complete(released);
  return { released: references.length };
}
function listConsumers(ownerRoot, projectRoot) {
  const owner = physical(ownerRoot);
  if (projectRoot !== undefined && (typeof projectRoot !== "string" || !path.isAbsolute(projectRoot) || projectRoot.split(/[\\/]/).includes(".."))) throw new Error("Absolute consumer project path required");
  // A retired/missing/replaced workspace must not hide its durable protection.
  const project = projectRoot === undefined ? undefined : path.resolve(projectRoot);
  return lifecycle.catalog(owner.path).filter(record => record.owner === "module-cache-consumer").map(record => {
    if (record.members.length !== 1) throw new Error("Consumer proxy membership mismatch");
    const binding = read(physical(path.join(record.members[0].path, "binding.json")).path);
    const expected = { ...binding };
    delete expected.release; delete expected.sourceReference;
    const token = sha(JSON.stringify([binding.project?.path, binding.versionId, binding.module, binding.key]));
    if (!isDeepStrictEqual(binding.owner, owner) || record.id !== `run:module-cache-consumer:${token}` || record.id !== binding.id ||
        binding.bindingPath !== path.join(owner.path, "artifacts/cache/module-consumers", token, "binding.json") ||
        path.dirname(binding.bindingPath) !== record.members[0].path || !path.isAbsolute(binding.project?.path || "") ||
        !/^[a-f0-9]{64}$/.test(binding.key) || binding.module !== "companion" || !/^version:[^\\/:]+$/.test(binding.versionId) ||
        !isDeepStrictEqual(binding.reference, { id: `run:module-cache:companion:${binding.key}`, reason: "companion-tool", kind: "dependency" })) throw new Error("Consumer binding mismatch");
    bindingRecord(expected);
    return { id: record.id, bindingPath: binding.bindingPath, project: binding.project, module: binding.module, key: binding.key, references: record.references };
  }).filter(record => project === undefined || record.project.path === project);
}
module.exports = { attach, seal, release, listConsumers, toolInvalidation, legacyToolOwner, hasConsumer };
if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === "attach") console.log(JSON.stringify(attach(...args)));
    else if (command === "seal") console.log(JSON.stringify(seal(...args)));
    else if (command === "list-consumers") console.log(JSON.stringify(listConsumers(...args)));
    else throw new Error("Unknown module cache consumer command");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

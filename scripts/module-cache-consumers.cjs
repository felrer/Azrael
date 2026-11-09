"use strict";

// The caller holds the physical module cache's exclusive lease throughout attach.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const lifecycle = require("./artifact-lifecycle.cjs");
const maintenanceLocks = require("./maintenance-lock-owner.cjs");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const read = filename => JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, ""));
const inside = (parent, child) => { const relative = path.relative(parent, child); return relative === "" || relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative); };
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
  if (source?.failed_consumer_retirement) throw new Error("Frozen failed consumer source cannot be attached, sealed or released through the success path");
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
function samePath(left, right) {
  const a = path.resolve(left), b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function fileIdentity(stat) {
  return { dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) };
}
function readPlain(filename, maxBytes = 16 * 1024 * 1024) {
  physical(path.dirname(filename));
  physical(filename);
  const before = fs.lstatSync(filename, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maxBytes)) throw new Error("Retirement evidence must be a bounded unlinked regular file");
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink"].every(key => before[key] === opened[key])) throw new Error("Retirement input changed while opening");
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd, { bigint: true }), final = fs.lstatSync(filename, { bigint: true });
    if (!["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink"].every(key => before[key] === after[key] && before[key] === final[key]) || bytes.length !== Number(before.size)) throw new Error("Retirement input changed while reading");
    return { bytes, sha256: sha(bytes), identity: fileIdentity(before), size: Number(before.size) };
  } finally { fs.closeSync(fd); }
}
function requireAbsent(filename) {
  try { fs.lstatSync(filename); throw new Error(`Retirement requires absent path: ${filename}`); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
function createImmutable(filename, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
  try {
    const fd = fs.openSync(filename, "wx");
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (!fs.readFileSync(filename).equals(bytes)) throw new Error("Conflicting immutable failed consumer retirement proof");
  }
  const stat = fs.lstatSync(filename, { bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n || !fs.readFileSync(filename).equals(bytes)) throw new Error("Failed consumer retirement proof identity changed");
  return sha(bytes);
}
function createOrReuseRetirementProof(filename, value, equivalent) {
  try {
    const previous = readPlain(filename);
    if (!equivalent(JSON.parse(previous.bytes), value)) throw new Error("Conflicting immutable failed consumer retirement proof");
    return previous.sha256;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return createImmutable(filename, value);
  }
}
function withModuleCacheLease(owner, action) {
  const lockPath = path.join(owner.path, "artifacts/cache/modules/.lock");
  const before = physical(lockPath);
  const stat = fs.lstatSync(lockPath, { bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n) throw new Error("Existing plain module cache lock file required");
  const dotnet = process.platform === "win32";
  const lease = dotnet ? require("./module-cache-dotnet-lease.cjs").acquire(lockPath)
    : maintenanceLocks.acquire(lockPath, { operation: "module-cache.consumer-retirement", waitMs: 0 });
  if (!lease.owner || lease.owner.schema !== (dotnet ? 1 : 2) || !Number.isSafeInteger(lease.owner.pid) || lease.owner.pid < 1 ||
      typeof lease.owner.token !== "string" || !(dotnet ? /^[a-f0-9]{64}$/ : new RegExp(`^${lease.owner.pid}-[0-9]+-[a-f0-9]{16}$`)).test(lease.owner.token) ||
      lease.owner.operation !== "module-cache.consumer-retirement") {
    try { lease.release(); } catch { /* Preserve the invalid lease-owner diagnostic. */ }
    throw new Error("Verified native module cache lease owner required");
  }
  const locked = { path: lockPath, identity: before, owner: lease.owner, backend: dotnet ? lease.backend : "native-maintenance-owner",
    ...(dotnet ? { sha256: lease.handle.sha256 } : {}) };
  let value, failure, release;
  try {
    if (!dotnet && !isDeepStrictEqual(physical(lockPath), before)) throw new Error("Module cache lock identity changed during acquisition");
    lease.assertHeld?.();
    value = action(locked, () => lease.assertHeld?.());
    lease.assertHeld?.();
  } catch (error) { failure = error; }
  try { release = lease.release(); }
  catch (error) {
    if (failure) failure.module_cache_lease_release_error = error;
    else failure = error;
  }
  if (failure) throw failure;
  if (dotnet ? !release?.process_exit_observed || release.process_exit_code !== 0 || release.process_signal !== null || release.process_close_observed !== true
    : !release?.native_exit_observed || release.native_exit_code !== 0 || release.native_signal !== null || release.native_close_observed !== true) {
    throw new Error("Module cache retirement lease did not terminate with a verified zero exit");
  }
  if (!isDeepStrictEqual(physical(lockPath), before)) throw new Error("Module cache lock identity changed before release completion");
  return { value, lease: locked, release };
}
function sourceSnapshot(record) {
  return Object.fromEntries(["id", "kind", "owner", "version", "generation", "revision", "state", "membership_complete", "members", "references", "producer"]
    .map(key => [key, record[key] ?? null]));
}
function consumerSnapshot(record) {
  return Object.fromEntries(["id", "kind", "owner", "version", "generation", "revision", "state", "membership_complete", "members", "references", "producer"]
    .map(key => [key, record[key] ?? null]));
}
function expectedCheckpoint(source, projectPath, versionId) {
  const name = versionId.slice("version:".length);
  const members = source.members.filter(member => member.role === "deploy-logs");
  if (members.length !== 1) throw new Error("Exact source deploy-logs member required to locate canonical checkpoint");
  const canonicalDir = path.join(projectPath, "artifacts/logs", `deploy-${name}`);
  if (!samePath(members[0].path, canonicalDir)) throw new Error("Source deploy-logs member does not identify the canonical build checkpoint");
  return path.join(members[0].path, "pipeline-state.json");
}
function checkpointSnapshot(filename, projectPath, versionId) {
  let input;
  try { input = readPlain(filename); }
  catch (error) { if (error.code === "ENOENT") return { path: filename, presence: "absent" }; throw error; }
  const state = JSON.parse(input.bytes.toString("utf8"));
  const name = versionId.slice("version:".length);
  if (![1, 2].includes(state.schema) || state.schema === 2 && state.storageFormat !== "pipeline-payloads-v1" ||
      !state.identity || !samePath(state.identity.project || "", projectPath) || state.identity.releaseName !== name ||
      state.identity.platform !== "windows-x64" || typeof state.stages !== "object" || Array.isArray(state.stages)) {
    throw new Error("Canonical build checkpoint identity is unknown or changed");
  }
  const attempts = state.stages["build.package"] ?? [];
  if (!Array.isArray(attempts) || attempts.some(attempt => !attempt || typeof attempt !== "object" ||
      !["running", "unknown", "failed", "succeeded", "invalid-output"].includes(attempt.status) ||
      !(attempt.exitCode === null || Number.isInteger(attempt.exitCode)))) throw new Error("Canonical build package checkpoint is malformed");
  if (attempts.some(attempt => attempt.status === "succeeded" || attempt.exitCode === 0)) throw new Error("Completed source package checkpoint exists");
  if (attempts.some(attempt => attempt.status === "running")) throw new Error("Source package checkpoint still reports a running producer");
  return { path: filename, presence: "present", sha256: input.sha256, identity: input.identity, size: input.size,
    package_attempts: attempts.map(({ id, status, exitCode }) => ({ id, status, exitCode })) };
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
const failedRetirementSourceReason = "Retire the exact module cache dependency from a terminal failed source with independently pinned ownership evidence.";
const failedRetirementProxyReason = "Retire the exact failed source consumer proxy after its source-first freeze.";
const failedRetirementRecoveryReason = "Authorize native cleanup of the exact failed source consumer receipt after source-first retirement.";
function sourceProofPath(expected, source, reviewToken) {
  const evidence = physical(source.producer.evidence_ref).path;
  const directory = path.dirname(evidence);
  contained(expected.project.path, directory);
  const registryDirectory = path.dirname(lifecycle.registryPath(expected.project.path, source.id));
  if (insideLifecycleMember(source, directory) || overlaps(directory, registryDirectory)) throw new Error("Retirement proof directory overlaps protected source ownership");
  physical(directory);
  return path.join(directory, `${sha(JSON.stringify([expected.id, reviewToken, "failed-consumer-source-proof"]))}.json`);
}
function insideLifecycleMember(record, filename) {
  return record.members.some(member => overlaps(member.path, filename));
}
function overlaps(left, right) {
  const containedBy = (parent, child) => { const relative = path.relative(parent, child); return relative === "" || relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative); };
  return containedBy(left, right) || containedBy(right, left);
}
function sourceRetirementDoc(expected, source, consumer, binding, bindingSha, checkpoint, moduleLock) {
  const reference = source.references.find(value => exact(value, expected.reference));
  if (!reference) throw new Error("Exact source companion-tool dependency required");
  const sourceRelease = source.members.filter(member => member.role === "release");
  if (sourceRelease.length !== 1 || binding.release?.kind !== "planned" || binding.release.path !== sourceRelease[0].path) throw new Error("Exact absent planned release binding required");
  checkPlanned(binding.release, sourceRelease[0].path);
  requireAbsent(sourceRelease[0].path);
  const proxyRoot = path.dirname(expected.bindingPath);
  const sealPath = path.join(proxyRoot, "release-identity.json"), releaseReceiptPath = path.join(proxyRoot, "release.json");
  requireAbsent(sealPath); requireAbsent(releaseReceiptPath);
  const checkpointPath = expectedCheckpoint(source, expected.project.path, expected.versionId);
  if (checkpoint.path !== checkpointPath) throw new Error("Checkpoint path is not the canonical source build pipeline");
  const sourceTerminal = readPlain(source.producer.evidence_ref);
  if (!inside(expected.project.path, source.producer.evidence_ref) || sourceTerminal.sha256 !== source.producer.evidence_sha256 ||
      insideLifecycleMember(source, source.producer.evidence_ref) || !inside(expected.project.path, source.producer.evidence_ref)) {
    throw new Error("Exact independent source producer stop evidence required");
  }
  return {
    schema: 1, action: "retire-failed-module-cache-consumer",
    source: sourceSnapshot(source), consumer: consumerSnapshot(consumer), cache_owner: expected.owner, project: expected.project,
    source_reference: reference, reference_id: reference.reference_id,
    binding: { path: expected.bindingPath, sha256: bindingSha, bytes_base64: readPlain(expected.bindingPath).bytes.toString("base64"), release: binding.release }, planned_release: binding.release,
    native_registration: lifecycle.registerRequest(expected.owner.path, consumer.id).group,
    checkpoint, seal_path: sealPath, release_receipt_path: releaseReceiptPath,
    terminal_producer_evidence: { path: source.producer.evidence_ref, sha256: source.producer.evidence_sha256 },
    module_cache_lock: moduleLock,
  };
}
function validateFailedSource(source, expected) {
  if (!source || source.id !== expected.versionId || source.owner !== "azrael-release" || source.kind !== "version" ||
      source.state !== "failed" || source.producer?.status !== "stopped" || source.producer.outcome !== "failure" ||
      !(source.producer.exit_code === null || Number.isInteger(source.producer.exit_code) && source.producer.exit_code !== 0) ||
      !source.membership_complete || !source.members.length || source.members.some(member => member.generated !== true || member.protection_known !== true)) {
    throw new Error("Exact stopped failed source with complete generated-known membership required");
  }
}
function validateFailedProxy(record, expected, referenceId) {
  if (!record || record.id !== expected.id || record.owner !== "module-cache-consumer" || record.kind !== "run" ||
      record.version !== expected.versionId || record.state !== "pending" || record.producer || !record.membership_complete ||
      record.members.length !== 1 || record.members[0].path !== path.dirname(expected.bindingPath) ||
      record.members[0].role !== "consumer-receipt" || record.members[0].generated !== true || record.members[0].protection_known !== true) {
    throw new Error("Exact pending complete consumer proxy required");
  }
  if (record.references.length !== 1 || !record.references.some(reference => lifecycle.referenceIdentity(reference) === referenceId)) throw new Error("Exact consumer cache dependency required");
}
function readSourceProof(source) {
  const retirement = source.failed_consumer_retirement;
  if (!retirement) return null;
  const proof = readPlain(retirement.evidence_ref);
  if (proof.sha256 !== retirement.evidence_sha256) throw new Error("Source failed consumer retirement proof changed");
  const document = JSON.parse(proof.bytes.toString("utf8"));
  if (document.schema !== 1 || document.action !== "retire-failed-module-cache-consumer" || document.review_token !== sha(JSON.stringify(document.review)) ||
      !isDeepStrictEqual(document.source, retirement.source) || document.consumer?.id !== retirement.consumer_id ||
      document.reference_id !== retirement.reference_id) throw new Error("Source failed consumer retirement receipt is not exact");
  return { retirement, document, sha256: proof.sha256 };
}
function inspectFailedRetirement(expected) {
  const source = lifecycle.withCatalogLock(expected.project.path, () => {
    const record = lifecycle.catalog(expected.project.path).find(value => value.id === expected.versionId);
    if (record && lifecycle.cleanupReservation(expected.project.path, record)) throw new Error("Active source cleanup reservation blocks failed consumer retirement");
    return record;
  });
  if (!source) throw new Error("Exact source release lifecycle required");
  validateFailedSource(source, expected);
  const frozen = readSourceProof(source);
  const sourceBefore = frozen ? frozen.document.source : sourceSnapshot(source);
  const sourceRef = sourceBefore.references.find(reference => exact(reference, expected.reference));
  if (!sourceRef) throw new Error("Exact source companion-tool dependency required");
  const expectedPath = expectedCheckpoint(sourceBefore, expected.project.path, expected.versionId);
  const currentCheckpoint = checkpointSnapshot(expectedPath, expected.project.path, expected.versionId);
  const { binding, record } = lifecycle.withCatalogLock(expected.owner.path, () => {
    const current = bindingRecord(expected);
    if (lifecycle.cleanupReservation(expected.owner.path, current.record)) throw new Error("Active proxy cleanup reservation blocks failed consumer retirement");
    return current;
  });
  const bindingBytes = readPlain(expected.bindingPath);
  const bindingSha = bindingBytes.sha256;
  const planned = binding.release;
  if (planned.kind !== "planned" || planned.path !== sourceBefore.members.find(member => member.role === "release")?.path ||
      !isDeepStrictEqual(planned.ancestor, frozen?.document.planned_release.ancestor ?? planned.ancestor)) throw new Error("Exact planned release binding required");
  checkPlanned(planned, planned.path);
  requireAbsent(planned.path);
  requireAbsent(path.join(path.dirname(expected.bindingPath), "release-identity.json"));
  requireAbsent(path.join(path.dirname(expected.bindingPath), "release.json"));
  const consumerBefore = frozen ? frozen.document.consumer : consumerSnapshot(record);
  const referenceId = sourceRef.reference_id;
  if (frozen) {
    if (frozen.retirement.consumer_id !== expected.id || frozen.retirement.reference_id !== referenceId ||
        !isDeepStrictEqual(frozen.document.cache_owner, expected.owner) || !isDeepStrictEqual(frozen.document.project, expected.project) ||
        !isDeepStrictEqual(frozen.document.binding, { path: expected.bindingPath, sha256: bindingSha, bytes_base64: bindingBytes.bytes.toString("base64"), release: binding.release }) ||
        !isDeepStrictEqual(frozen.document.checkpoint, currentCheckpoint) ||
        !isDeepStrictEqual(frozen.document.seal_path, path.join(path.dirname(expected.bindingPath), "release-identity.json")) ||
        !isDeepStrictEqual(frozen.document.release_receipt_path, path.join(path.dirname(expected.bindingPath), "release.json"))) {
      throw new Error("Frozen failed consumer source binding changed");
    }
  } else {
    validateFailedProxy(record, expected, referenceId);
    if (source.release_receipt || record.release_receipt || record.cleanup_recovery) throw new Error("Existing release or recovery receipt conflicts with failed unsealed retirement");
  }
  if (frozen) {
    if (record.cleanup_recovery?.consumer_retirement) {
      const retirement = record.cleanup_recovery.consumer_retirement;
      if (retirement.source_id !== source.id || retirement.source_request_sha256 !== frozen.retirement.request_sha256 ||
          retirement.consumer_id !== expected.id || retirement.binding_sha256 !== bindingSha || record.references.length !== 0) throw new Error("Recovered proxy differs from the exact source-first retirement");
    } else if (record.references.length === 1 && record.references.some(reference => lifecycle.referenceIdentity(reference) === referenceId)) {
      if (!isDeepStrictEqual(consumerSnapshot(record), consumerBefore)) throw new Error("Consumer proxy changed after source retirement review");
    } else if (record.references.length === 0 && record.release_receipt) {
      const releaseProofPath = proxyReleaseProofPath(expected, frozen.document.review_token, consumerBefore.revision, path.dirname(frozen.retirement.evidence_ref));
      const releaseProof = readPlain(releaseProofPath);
      const request = proxyReleaseRequest(record, expected, frozen, releaseProofPath, releaseProof.sha256, consumerBefore.revision);
      if (record.release_receipt.request_sha256 !== lifecycle.requestIdentity(request) ||
          record.release_receipt.evidence_ref !== releaseProofPath || record.release_receipt.evidence_sha256 !== releaseProof.sha256 ||
          record.revision !== consumerBefore.revision + 1 || record.state !== "pending" || record.producer || !record.membership_complete ||
          !isDeepStrictEqual(record.members, consumerBefore.members)) throw new Error("Partial proxy release does not match the exact failed retirement");
    } else throw new Error("Proxy phase is neither untouched nor an exact retirement retry");
  }
  const review = frozen ? frozen.document.review : sourceRetirementDoc(expected, sourceBefore, consumerBefore, binding, bindingSha, currentCheckpoint, null);
  const reviewToken = frozen ? frozen.document.review_token : sha(JSON.stringify(review));
  if (frozen && !isDeepStrictEqual(review, frozen.document.review)) throw new Error("Frozen failed consumer review snapshot changed");
  return { source, sourceBefore, proxy: record, consumerBefore, binding, bindingSha, checkpoint: currentCheckpoint,
    review, reviewToken, sourceRetirement: frozen, phase: !frozen ? "review" : record.cleanup_recovery?.consumer_retirement ? "recovered" : record.references.length ? "source-frozen" : "proxy-reference-released" };
}
function proxyReleaseProofPath(expected, reviewToken, proxyRevision, evidenceDirectory) {
  return path.join(evidenceDirectory, `${sha(JSON.stringify([expected.id, reviewToken, proxyRevision, "failed-consumer-proxy-release"]))}.json`);
}
function proxyReleaseDocument(plan, sourceRetirement) {
  return { schema: 1, action: "retire-failed-module-cache-proxy", review_token: plan.reviewToken,
    source_id: plan.sourceBefore.id, source_generation: plan.sourceBefore.generation, source_revision: sourceRetirement.source_revision,
    source_request_sha256: sourceRetirement.request_sha256, source_proof_ref: sourceRetirement.evidence_ref,
    source_proof_sha256: sourceRetirement.evidence_sha256, source_evidence_ref: plan.sourceBefore.producer.evidence_ref,
    source_evidence_sha256: plan.sourceBefore.producer.evidence_sha256, consumer: plan.consumerBefore,
    reference_id: plan.sourceBefore.references.find(reference => exact(reference, plan.review.source_reference)).reference_id,
    binding_sha256: plan.bindingSha, reason: failedRetirementProxyReason };
}
function proxyReleaseRequest(record, expected, frozen, evidenceRef, evidenceSha, revision) {
  return { owner: record.owner, expected_revision: revision,
    reference_ids: [frozen.document.reference_id], reason: failedRetirementProxyReason,
    evidence_ref: evidenceRef, evidence_sha256: evidenceSha };
}
function recoveryProofPath(expected, reviewToken, proxyRevision, evidenceDirectory) {
  return path.join(evidenceDirectory, `${sha(JSON.stringify([expected.id, reviewToken, proxyRevision, "failed-consumer-recovery"]))}.json`);
}
function proxyRecoverySource(record) {
  return { id: record.id, kind: record.kind, owner: record.owner, version: record.version ?? null, generation: record.generation ?? null,
    revision: record.revision, state: record.state, membership_complete: record.membership_complete, producer: record.producer ?? null, members: record.members };
}
function retirementTypedReceipt(plan, frozen, proxyReleaseRequestSha, proxyReleaseProofRef, proxyReleaseProofSha) {
  return { schema: 1, consumer_id: plan.consumerBefore.id, source_id: frozen.source.id, source_generation: frozen.source.generation,
    source_revision: frozen.source_revision, source_request_sha256: frozen.request_sha256,
    source_evidence_ref: frozen.source.producer.evidence_ref, source_evidence_sha256: frozen.source.producer.evidence_sha256,
    source_proof_ref: frozen.evidence_ref, source_proof_sha256: frozen.evidence_sha256,
    binding_sha256: plan.bindingSha, proxy_release_request_sha256: proxyReleaseRequestSha,
    proxy_release_proof_ref: proxyReleaseProofRef, proxy_release_proof_sha256: proxyReleaseProofSha };
}
function retirementNativeInventory(expected, original) {
  const command = require("./maintenance-owner-config.cjs").resolveMaintenanceCommand(expected.owner.path);
  const { spawnSync } = require("node:child_process");
  const calls = [];
  function sweep() {
    const selected = { items: [], groups: [], decisions: [] };
    let totals, offset = 0;
    do {
      const request = { operation: "inventory", offset, limit: 200, lock_wait_ms: command.maxLockWaitMs ?? 5000 };
      const result = spawnSync(command.executable, [...command.args, "--project-root", expected.owner.path, "--request", "-"],
        { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
      if (result.error || result.status !== 0 || result.signal) throw new Error(`Failed consumer terminal inventory failed: ${result.error?.message || result.stderr || result.stdout || result.signal}`);
      const value = JSON.parse(result.stdout), page = value.pagination;
      if (!page || page.offset !== offset || page.limit !== 200 || !["total", "groups_total", "decisions_total", "runs_total", "bundles_total"].every(key => Number.isSafeInteger(page[key]) && page[key] >= 0) ||
          !samePath(value.project_root, expected.owner.path) || !Array.isArray(value.items) || !Array.isArray(value.groups) || !Array.isArray(value.decisions)) throw new Error("Malformed native terminal inventory");
      const current = Object.fromEntries(["total", "groups_total", "decisions_total", "runs_total", "bundles_total"].map(key => [key, page[key]]));
      if (totals && !isDeepStrictEqual(totals, current)) throw new Error("Native terminal inventory membership changed during pagination");
      totals = current;
      const items = value.items.filter(item => item.lifecycle_group_id === expected.id || original.members.some(member => member.id === item.id));
      const groups = value.groups.filter(group => group.id === expected.id);
      const decisions = value.decisions.filter(decision => decision.lifecycle_group_id === expected.id || original.members.some(member => member.id === decision.id));
      selected.items.push(...items); selected.groups.push(...groups); selected.decisions.push(...decisions);
      calls.push({ operation: "inventory", request, actual_exit_code: result.status, stdout_sha256: sha(result.stdout),
        stdout_bytes: Buffer.byteLength(result.stdout), selected: { items, groups, decisions }, pagination: page });
      offset += 200;
      if (offset > 1000000) throw new Error("Native terminal inventory exceeds bounded metadata observation");
    } while (offset < Math.max(totals.total, totals.groups_total, totals.decisions_total));
    return { totals, ...selected };
  }
  const first = sweep(), current = sweep();
  if (!isDeepStrictEqual(first, current)) throw new Error("Native terminal inventory changed between independent observations");
  if (current.groups.length !== 1 || current.items.length !== 1 || original.members.length !== 1) throw new Error("Exact native terminal consumer group and item required");
  const group = current.groups[0], item = current.items[0], member = original.members[0];
  if (group.id !== original.id || group.owner !== original.owner || group.kind !== original.kind || group.version !== original.version ||
      group.provenance_ref !== original.provenance_ref || group.membership_source !== original.membership_source ||
      group.membership_source_format !== original.membership_source_format || group.members_total !== 1 || group.cached_live_members !== 0 || group.cleanup_status !== "deleted" ||
      item.id !== member.id || item.path !== member.path || item.owner !== original.owner || item.lifecycle_group_id !== original.id ||
      item.cleanup_status !== "deleted" || item.remaining !== false || item.generated !== true || item.protection_known !== true ||
      !Array.isArray(item.references) || item.references.length || group.reservation_protection || item.reservation_protection ||
      group.retain_reason || item.retain_reason || !current.decisions.length || current.decisions.some(decision =>
        decision.id !== member.id || decision.lifecycle_group_id !== original.id || decision.decision !== "delete" ||
        decision.status !== "deleted" || decision.remaining !== false || decision.group_status !== "deleted" ||
        !decision.token || !decision.attempt_id || ["error", "persistence_error", "observation_error"].some(key => decision[key] != null))) {
    throw new Error("Native consumer cleanup is incomplete, referenced or not the exact terminal deletion");
  }
  return { command: { executable: command.executable, executable_sha256: readPlain(command.executable, 128 * 1024 * 1024).sha256, args: command.args }, ...current, calls };
}
function completeFailedRetirement(ownerRoot, projectRoot, versionId, module, key, reviewToken, terminalEvidenceRef, terminalEvidenceSha) {
  const expected = identity(ownerRoot, projectRoot, versionId, module, key);
  const result = withModuleCacheLease(expected.owner, (locked, assertHeld) => {
    const source = lifecycle.withCatalogLock(expected.project.path, () => lifecycle.catalog(expected.project.path).find(value => value.id === versionId));
    validateFailedSource(source, expected);
    const frozen = readSourceProof(source);
    if (!frozen || frozen.document.review_token !== reviewToken || !isDeepStrictEqual(frozen.document.project, expected.project) ||
        !isDeepStrictEqual(frozen.document.cache_owner, expected.owner) || frozen.retirement.consumer_id !== expected.id) throw new Error("Exact frozen failed consumer review required for completion");
    const terminal = readPlain(terminalEvidenceRef);
    if (terminal.sha256 !== terminalEvidenceSha || !inside(expected.project.path, terminalEvidenceRef) || insideLifecycleMember(source, terminalEvidenceRef)) throw new Error("Independent terminal cleanup evidence required");
    const observeProxyAbsence = () => lifecycle.withCatalogLock(expected.owner.path, () => {
      if (lifecycle.catalog(expected.owner.path).some(record => record.id === expected.id)) throw new Error("Consumer proxy must be canonically finalized before completion");
      requireAbsent(path.dirname(expected.bindingPath));
    });
    observeProxyAbsence();
    const native = retirementNativeInventory(expected, frozen.document.native_registration);
    observeProxyAbsence();
    const original = frozen.document;
    checkPlanned(original.planned_release, original.planned_release.path); requireAbsent(original.planned_release.path);
    if (!isDeepStrictEqual(checkpointSnapshot(original.checkpoint.path, expected.project.path, versionId), original.checkpoint)) throw new Error("Frozen source package checkpoint changed before completion");
    const proofRef = path.join(path.dirname(frozen.retirement.evidence_ref), `${sha(JSON.stringify([expected.id, reviewToken, "failed-consumer-completion"]))}.json`);
    return lifecycle.withCatalogLock(expected.project.path, () => {
      assertHeld();
      const current = lifecycle.catalog(expected.project.path).find(value => value.id === versionId);
      if (!current || !isDeepStrictEqual(current.failed_consumer_retirement, source.failed_consumer_retirement) || current.revision !== source.revision) throw new Error("Source changed during failed consumer completion");
      if (current.failed_consumer_completion) {
        const completed = JSON.parse(readPlain(current.failed_consumer_completion.evidence_ref).bytes);
        if (!isDeepStrictEqual(completed.terminal_evidence, { path: terminalEvidenceRef, sha256: terminalEvidenceSha })) throw new Error("Conflicting failed consumer completion retry");
        return { status: "completed", id: expected.id, idempotent: true };
      }
      const proof = { schema: 1, action: "complete-failed-module-cache-consumer-retirement", consumer_id: expected.id,
        source_request_sha256: frozen.retirement.request_sha256, binding_sha256: original.binding.sha256,
        terminal_evidence: { path: terminalEvidenceRef, sha256: terminalEvidenceSha }, native, module_cache_lock: locked };
      const proofSha = createOrReuseRetirementProof(proofRef, proof, (previous, current) =>
        isDeepStrictEqual({ ...previous, module_cache_lock: null, native: null }, { ...current, module_cache_lock: null, native: null }) &&
        isDeepStrictEqual(previous.module_cache_lock?.identity, current.module_cache_lock.identity) &&
        previous.module_cache_lock.backend === current.module_cache_lock.backend && previous.module_cache_lock.sha256 === current.module_cache_lock.sha256 &&
        isDeepStrictEqual(previous.native?.items, current.native.items) && isDeepStrictEqual(previous.native?.groups, current.native.groups) &&
        isDeepStrictEqual(previous.native?.decisions, current.native.decisions));
      const completed = lifecycle.completeFailedConsumerRetirement(expected.project.path, versionId, { owner: current.owner,
        expected_revision: current.revision, source_request_sha256: frozen.retirement.request_sha256, consumer_id: expected.id,
        reason: "Complete the exact failed consumer retirement after native deletion and canonical finalization.", evidence_ref: proofRef, evidence_sha256: proofSha });
      assertHeld();
      return { status: "completed", id: expected.id, source_revision: completed.revision, proof: { path: proofRef, sha256: proofSha } };
    }, { operation: "lifecycle.reconcile" });
  });
  return { ...result.value, module_cache_lock: result.lease, module_cache_lease_release: result.release };
}
function reviewFailedRetirement(ownerRoot, projectRoot, versionId, module, key) {
  const expected = identity(ownerRoot, projectRoot, versionId, module, key);
  const result = withModuleCacheLease(expected.owner, () => inspectFailedRetirement(expected));
  return { action: "review-failed-consumer-retirement", status: result.value.phase, consumer_id: expected.id,
    review_token: result.value.reviewToken, snapshot: result.value.review,
    source_revision: result.value.source.revision, proxy_revision: result.value.proxy.revision,
    module_cache_lock: result.lease, module_cache_lease_release: result.release };
}
function applyFailedRetirement(ownerRoot, projectRoot, versionId, module, key, reviewToken) {
  if (typeof reviewToken !== "string" || !/^[a-f0-9]{64}$/.test(reviewToken)) throw new Error("Exact reviewed retirement token required");
  const expected = identity(ownerRoot, projectRoot, versionId, module, key);
  const result = withModuleCacheLease(expected.owner, (locked, assertHeld) => {
    let plan = inspectFailedRetirement(expected);
    if (plan.reviewToken !== reviewToken) throw new Error("Failed consumer retirement review is stale");
    if (plan.phase === "recovered") return { status: "recovered", id: expected.id, review_token: reviewToken, idempotent: true };
    let frozen = plan.sourceRetirement?.retirement;
    if (!frozen) {
      const proofRef = sourceProofPath(expected, plan.source, reviewToken);
      const proof = { ...plan.review, review: plan.review, review_token: reviewToken, module_cache_lock: locked };
      lifecycle.withCatalogLock(expected.project.path, () => {
        assertHeld();
        const current = lifecycle.catalog(expected.project.path).find(record => record.id === expected.versionId);
        if (!current || current.failed_consumer_retirement || !isDeepStrictEqual(sourceSnapshot(current), plan.review.source)) throw new Error("Source changed after failed consumer review");
        const proofSha = createOrReuseRetirementProof(proofRef, proof, (previous, current) =>
          isDeepStrictEqual({ ...previous, module_cache_lock: null }, { ...current, module_cache_lock: null }) &&
          isDeepStrictEqual(previous.module_cache_lock?.identity, current.module_cache_lock.identity) &&
          previous.module_cache_lock.backend === current.module_cache_lock.backend && previous.module_cache_lock.sha256 === current.module_cache_lock.sha256 &&
          previous.module_cache_lock?.owner?.operation === "module-cache.consumer-retirement");
        const request = { owner: plan.source.owner, expected_revision: plan.source.revision,
          expected_generation: plan.source.generation ?? null, consumer_id: expected.id,
          reference_id: plan.review.reference_id, reference: plan.review.source_reference,
          reason: failedRetirementSourceReason, evidence_ref: proofRef, evidence_sha256: proofSha };
        lifecycle.retireFailedConsumerReference(expected.project.path, expected.versionId, request);
        assertHeld();
      }, { operation: "lifecycle.reconcile" });
      plan = inspectFailedRetirement(expected);
      if (plan.reviewToken !== reviewToken || !plan.sourceRetirement) throw new Error("Source-first failed consumer freeze did not commit exactly");
      frozen = plan.sourceRetirement.retirement;
    }
    if (plan.phase === "recovered") return { status: "recovered", id: expected.id, review_token: reviewToken, idempotent: true };

    const sourceNow = lifecycle.withCatalogLock(expected.project.path, () => {
      const current = lifecycle.catalog(expected.project.path).find(record => record.id === expected.versionId);
      if (!current?.failed_consumer_retirement || current.failed_consumer_retirement.request_sha256 !== frozen.request_sha256 ||
          current.failed_consumer_retirement.consumer_id !== expected.id || !isDeepStrictEqual(current.failed_consumer_retirement.source, plan.review.source)) {
        throw new Error("Exact source failure freeze receipt required before proxy release");
      }
      return current;
    }, { operation: "lifecycle.catalog" });
    const sourceProof = readSourceProof(sourceNow);
    if (!sourceProof || sourceProof.retirement.request_sha256 !== frozen.request_sha256 || sourceProof.document.review_token !== reviewToken) throw new Error("Source retirement proof changed before proxy release");

    const proxyResult = lifecycle.withCatalogLock(expected.owner.path, () => {
      assertHeld();
      const { binding, record } = bindingRecord(expected);
      const bindingBytes = readPlain(expected.bindingPath);
      if (bindingBytes.sha256 !== plan.bindingSha || !isDeepStrictEqual(binding.release, plan.review.binding.release)) throw new Error("Consumer binding changed after source freeze");
      const proofPath = proxyReleaseProofPath(expected, reviewToken, plan.consumerBefore.revision, path.dirname(frozen.evidence_ref));
      const proofValue = proxyReleaseDocument(plan, frozen);
      const proofSha = createImmutable(proofPath, proofValue);
      const releaseRequest = proxyReleaseRequest(record, expected, sourceProof, proofPath, proofSha, plan.consumerBefore.revision);
      const releaseRequestSha = lifecycle.requestIdentity(releaseRequest);
      const referenceId = plan.review.reference_id;
      if (record.references.some(reference => lifecycle.referenceIdentity(reference) === referenceId)) {
        if (!isDeepStrictEqual(consumerSnapshot(record), plan.consumerBefore)) throw new Error("Consumer proxy changed before exact source-first reference release");
      } else if (record.references.length !== 0 || record.release_receipt?.request_sha256 !== releaseRequestSha ||
          record.release_receipt.evidence_ref !== proofPath || record.release_receipt.evidence_sha256 !== proofSha ||
          record.revision !== plan.consumerBefore.revision + 1) {
        throw new Error("Proxy dependency release is not an exact partial retry");
      }
      const released = lifecycle.releaseReferences(expected.owner.path, record.id, releaseRequest);
      assertHeld();
      if (released.references.length !== 0) throw new Error("Unexpected consumer proxy references remain");
      const typed = retirementTypedReceipt(plan, frozen, releaseRequestSha, proofPath, proofSha);
      const recoveryProofPathname = recoveryProofPath(expected, reviewToken, released.revision, path.dirname(frozen.evidence_ref));
      const recoveryDocument = { schema: 1, action: "recover-cleanup", source: proxyRecoverySource(released),
        producer_stopped_verified: true, membership_complete_verified: true,
        stop_basis: "The exact failed source producer is terminal and the existing module-cache exclusive lease is held by this operation.",
        membership_basis: "The exact complete consumer proxy, sole binding and planned source release were revalidated under its owner catalog lock.",
        producer_evidence: [
          { path: sourceProof.document.terminal_producer_evidence.path, sha256: sourceProof.document.terminal_producer_evidence.sha256 },
          { path: frozen.evidence_ref, sha256: frozen.evidence_sha256 },
          { path: proofPath, sha256: proofSha },
        ],
        failed_consumer_retirement: typed };
      const recoveryProofSha = createImmutable(recoveryProofPathname, recoveryDocument);
      const recoveryRequest = { owner: released.owner, expected_revision: released.revision,
        producer_stopped_verified: true, membership_complete_verified: true, reason: failedRetirementRecoveryReason,
        evidence_ref: recoveryProofPathname, evidence_sha256: recoveryProofSha, consumer_retirement: typed };
      assertHeld();
      const recovered = lifecycle.recoverCleanup(expected.owner.path, released.id, recoveryRequest);
      assertHeld();
      return { status: "recovered", id: recovered.id, review_token: reviewToken,
        source_revision: sourceNow.revision, proxy_revision: recovered.revision,
        source_proof: { path: frozen.evidence_ref, sha256: frozen.evidence_sha256 },
        proxy_release_proof: { path: proofPath, sha256: proofSha },
        recovery_proof: { path: recoveryProofPathname, sha256: recoveryProofSha } };
    }, { operation: "lifecycle.reconcile" });
    return proxyResult;
  });
  return { ...result.value, module_cache_lock: result.lease, module_cache_lease_release: result.release };
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
  return lifecycle.withCatalogLock(expected.owner.path, () => hasConsumerUnlocked(expected, ownerRoot, projectRoot));
}
function hasConsumerUnlocked(expected, ownerRoot, projectRoot) {
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
  return lifecycle.withCatalogLock(owner.path, () => listConsumersUnlocked(owner, project));
}
function listConsumersUnlocked(owner, project) {
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
module.exports = { attach, seal, release, reviewFailedRetirement, applyFailedRetirement, completeFailedRetirement, listConsumers, toolInvalidation, legacyToolOwner, hasConsumer };
if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === "attach") console.log(JSON.stringify(attach(...args)));
    else if (command === "seal") console.log(JSON.stringify(seal(...args)));
    else if (command === "list-consumers") console.log(JSON.stringify(listConsumers(...args)));
    else throw new Error("Unknown module cache consumer command");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

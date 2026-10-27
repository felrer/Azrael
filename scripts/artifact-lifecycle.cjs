"use strict";
// Producer metadata only. Native maintenance owns review, registration and deletion.
const fs = require("node:fs");
const { acquire } = require("./maintenance-lock-owner.cjs");
const path = require("node:path");
const crypto = require("node:crypto");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const inside = (parent, child) => { const rel = path.relative(parent, child); return rel === "" || (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel)); };
const overlap = (a, b) => inside(a, b) || inside(b, a);
function checked(root, value, member = false) {
  root = path.resolve(root);
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0") || value.split(/[\\/]/).includes("..")) throw new Error("Lifecycle paths must be absolute without traversal");
  const result = path.resolve(value);
  if (!inside(root, result) || result === root) throw new Error("Lifecycle path outside project");
  if (member) {
    const allowed = [path.join(root, "artifacts"), path.join(root, "engine/codex-rs/target")];
    if (!allowed.some(parent => inside(parent, result) && parent !== result) || overlap(path.join(root, "artifacts/maintenance"), result) || path.relative(root, result).split(path.sep).some(part => [".git", ".azrael-ex", ".codex", ".ssh"].includes(part))) throw new Error("Source or management/user state cannot be a lifecycle member");
  }
  let current = path.parse(result).root;
  for (const part of result.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Linked lifecycle path"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return result;
}
function registry(root) { return checked(root, path.join(path.resolve(root), "artifacts/maintenance/lifecycles")); }
function registryPath(root, id) { return checked(root, path.join(registry(root), sha(id) + ".json")); }
function validate(root, record) {
  if (record.schema !== 1 || typeof record.id !== "string" || !record.id || !["version", "run", "work"].includes(record.kind) || typeof record.owner !== "string" || !record.owner || !["pending", "complete", "failed", "retained"].includes(record.state) || typeof record.membership_complete !== "boolean" || !Array.isArray(record.members) || !record.members.length) throw new Error("Invalid lifecycle record");
  if (record.version != null && (typeof record.version !== "string" || !record.version)) throw new Error("Invalid lifecycle version");
  if (record.generation !== undefined && (typeof record.generation !== "string" || !record.generation.trim())) throw new Error("Invalid lifecycle generation");
  for (const member of record.members) {
    checked(root, member.path, true);
    if (typeof member.role !== "string" || !member.role) throw new Error("Lifecycle member role required");
    for (const key of ["generated", "protection_known"]) if (member[key] !== undefined && typeof member[key] !== "boolean") throw new Error(`Invalid lifecycle member ${key}`);
  }
  if (!Array.isArray(record.references) || record.references.some(ref => typeof ref.id !== "string" || !ref.id || typeof ref.reason !== "string" || !ref.reason.trim() || (ref.kind !== undefined && !referenceKinds.has(ref.kind)) || (ref.reference_id !== undefined && (typeof ref.reference_id !== "string" || !ref.reference_id)))) throw new Error("Invalid lifecycle references");
  if (new Set(record.references.map(referenceIdentity)).size !== record.references.length) throw new Error("Duplicate reference identity");
  record.references = record.references.map(reference => ({ ...reference, reference_id: referenceIdentity(reference) }));
  if (record.producer && (record.producer.status !== "stopped" || !["success", "failure", "unknown"].includes(record.producer.outcome) || !(record.producer.exit_code === null || Number.isInteger(record.producer.exit_code)) || typeof record.producer.reason !== "string" || !record.producer.reason.trim() || typeof record.producer.evidence_ref !== "string" || !/^[a-f0-9]{64}$/.test(record.producer.evidence_sha256 || ""))) throw new Error("Invalid lifecycle producer");
  return record;
}
function catalog(root) {
  const directory = registry(root);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => {
    const filename = checked(root, path.join(directory, name));
    const record = validate(root, JSON.parse(fs.readFileSync(filename, "utf8")));
    if (path.basename(filename) !== sha(record.id) + ".json") throw new Error("Lifecycle registry identity mismatch");
    return record;
  });
}
function projectMembers(members) {
  return members.filter((member, index) => !members.some((other, otherIndex) => otherIndex !== index && inside(other.path, member.path) && (other.path !== member.path || otherIndex < index)))
    .map(member => ({ ...member,
      ...(members.some(child => inside(member.path, child.path) && child.generated === false) ? { generated: false } : {}),
      ...(members.some(child => inside(member.path, child.path) && child.protection_known === false) ? { protection_known: false } : {}) }))
    .sort((a, b) => Number(/log|report|evidence/.test(a.role)) - Number(/log|report|evidence/.test(b.role)));
}
function withCatalogLock(root, action) {
  const directory = registry(root);
  fs.mkdirSync(directory, { recursive: true });
  const lock = checked(root, path.join(directory, "catalog.lock"));
  const descriptor = acquire(lock, { operation: "lifecycle.catalog" });
  try { return action(); } finally { descriptor.release(); }
}
const referenceKinds = new Set(["execution", "installation", "recovery", "evidence", "dependency"]);
function referenceIdentity(reference) { return reference.reference_id || sha(JSON.stringify([reference.id, reference.reason, reference.kind ?? null])); }
function cleanupReady(record) { return record.producer ? record.producer.status === "stopped" && record.producer.outcome !== "unknown" : record.state === "complete"; }
function writeRecord(root, filename, record) {
  const temporary = checked(root, filename + "." + crypto.randomUUID() + ".tmp");
  fs.writeFileSync(temporary, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  fs.renameSync(temporary, filename);
}
function checkedEvidence(root, request) {
  if (typeof request.reason !== "string" || !request.reason.trim()) throw new Error("Nonblank reason required");
  const evidence = checked(root, request.evidence_ref);
  if (!fs.lstatSync(evidence).isFile()) throw new Error("Readable evidence file required");
  const hash = sha(fs.readFileSync(evidence));
  if (!/^[a-f0-9]{64}$/.test(request.evidence_sha256 || "") || request.evidence_sha256 !== hash) throw new Error("Evidence SHA256 changed or missing");
  return { evidence_ref: evidence, evidence_sha256: hash, reason: request.reason };
}
function mutateLifecycle(root, id, request, operation, mutate) {
  return withCatalogLock(root, () => {
    const filename = registryPath(root, id), lock = checked(root, filename + ".lock");
    const descriptor = acquire(lock, { operation: "lifecycle.write" });
    try {
      const record = validate(root, JSON.parse(fs.readFileSync(filename, "utf8")));
      if (record.custody_transfer && record.state === "pending") throw new Error("Pending custody transfer requires transfer-custody retry");
      if (record.custody_refinement && record.state === "pending") throw new Error("Pending custody refinement requires refine-custody retry");
      if (record.id !== id || request.owner !== record.owner) throw new Error("Exact lifecycle owner required");
      const evidence = checkedEvidence(root, request);
      const identity = sha(JSON.stringify(Object.keys(request).sort().map(key => [key, request[key]])));
      const receiptKey = operation + "_receipt";
      if (record[receiptKey]?.request_sha256 === identity) {
        if (operation === "release" && record.references.some(reference => request.reference_ids.includes(referenceIdentity(reference)))) throw new Error("Conflicting release retry after reference replacement");
        return record;
      }
      if (request.expected_revision !== record.revision) throw new Error("Stale lifecycle revision");
      mutate(record, evidence);
      record[receiptKey] = { request_sha256: identity, ...evidence };
      record.revision++;
      record.updated_at = new Date().toISOString();
      validate(root, record);
      writeRecord(root, filename, record);
      return record;
    } finally { descriptor.release(); }
  });
}
function closeLifecycle(root, id, request) {
  return mutateLifecycle(root, id, request, "close", (record, evidence) => {
    if (record.producer) throw new Error("Conflicting lifecycle close retry");
    if (request.producer_stopped_verified !== true) throw new Error("Verified producer stop required");
    if (!["success", "failure", "unknown"].includes(request.outcome) || !(request.exit_code === null || Number.isInteger(request.exit_code)) || (request.outcome === "success" && request.exit_code !== 0) || (request.outcome === "failure" && request.exit_code === 0) || (request.outcome === "unknown" && request.exit_code !== null)) throw new Error("Invalid terminal producer outcome");
    // Reconcile owned planned roots, including absent outputs, without expanding ownership.
    for (const member of record.members) {
      checked(root, member.path, true);
      try { fs.lstatSync(member.path); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    record.producer = { status: "stopped", outcome: request.outcome, exit_code: request.exit_code, ...evidence };
    record.state = request.outcome === "success" ? "complete" : request.outcome === "failure" ? "failed" : "pending";
    record.membership_complete = request.outcome !== "unknown";
    record.references = record.references.filter(reference => reference.kind !== "execution");
  });
}
function releaseReferences(root, id, request) {
  return mutateLifecycle(root, id, request, "release", record => {
    if (!Array.isArray(request.reference_ids) || !request.reference_ids.length || request.reference_ids.some(value => typeof value !== "string" || !value) || new Set(request.reference_ids).size !== request.reference_ids.length) throw new Error("Explicit unique reference_ids required");
    if (request.reference_ids.some(id => !record.references.some(reference => referenceIdentity(reference) === id))) throw new Error("Unknown reference identity or conflicting release retry");
    record.references = record.references.filter(reference => !request.reference_ids.includes(referenceIdentity(reference)));
  });
}
function recordLifecycle(root, request) { return withCatalogLock(root, () => recordLifecycleUnlocked(root, request)); }
function recordLifecycleUnlocked(root, request) {
  root = path.resolve(root);
  const incoming = validate(root, { ...request, schema: 1, references: request.references || [] });
  const filename = registryPath(root, incoming.id);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const lock = filename + ".lock";
  checked(root, lock);
  const descriptor = acquire(lock, { operation: "lifecycle.write" });
  try {
    const previous = fs.existsSync(filename) ? validate(root, JSON.parse(fs.readFileSync(filename, "utf8"))) : null;
    if (previous?.custody_transfer && previous.state === "pending") throw new Error("Pending custody transfer requires transfer-custody retry");
    if (previous?.custody_refinement && previous.state === "pending") throw new Error("Pending custody refinement requires refine-custody retry");
    if (previous?.custody_handoffs?.some(receipt => incoming.members.some(member => receipt.paths.some(transferred => overlap(transferred, member.path))))) throw new Error("Transferred custody cannot be reclaimed by ordinary record writes");
    if (previous?.custody_refinements?.some(receipt => incoming.members.some(member => receipt.paths.some(transferred => overlap(transferred, member.path))))) throw new Error("Refined custody cannot be reclaimed by ordinary record writes");
    if (previous && (previous.id !== incoming.id || previous.kind !== incoming.kind || previous.owner !== incoming.owner || (previous.version ?? null) !== (incoming.version ?? null))) throw new Error("Conflicting lifecycle identity");
    const newGeneration = previous && incoming.generation !== undefined && incoming.generation !== previous.generation;
    if (newGeneration && (request.expected_revision !== previous.revision || previous.producer?.status !== "stopped" || previous.producer.outcome === "unknown" || incoming.state !== "pending" || incoming.membership_complete)) throw new Error("New lifecycle generation requires exact revision and known stopped producer");
    if (previous?.producer && !newGeneration && (incoming.state !== previous.state || incoming.membership_complete !== previous.membership_complete || incoming.members.some(member => !previous.members.some(old => old.path === member.path && old.role === member.role)))) throw new Error("Closed lifecycle cannot restart or extend membership");
    if (previous && incoming.members.some(member => member.role === "release" && previous.members.some(old => old.role === "release" && old.path !== checked(root, member.path, true)))) throw new Error("Conflicting lifecycle release identity");
    if (request.expected_revision !== undefined && request.expected_revision !== (previous?.revision || 0)) throw new Error("Stale lifecycle revision");
    const members = [...(previous?.members || [])];
    for (const member of incoming.members) {
      const normalized = { path: checked(root, member.path, true), role: member.role };
      for (const key of ["generated", "protection_known"]) if (member[key] !== undefined) normalized[key] = member[key];
      const old = members.find(old => old.path === normalized.path && old.role === normalized.role);
      if (!old) members.push(normalized);
      else for (const key of ["generated", "protection_known"]) {
        if (old[key] === false && normalized[key] === true) throw new Error(`Cannot promote protected lifecycle member ${key}`);
        if (normalized[key] !== undefined) old[key] = normalized[key];
      }
    }
    const references = [...(previous?.references || [])];
    for (const reference of incoming.references) {
      const normalized = { ...reference, reference_id: referenceIdentity(reference) };
      const old = references.find(old => referenceIdentity(old) === normalized.reference_id);
      if (old && (old.id !== normalized.id || old.reason !== normalized.reason || old.kind !== normalized.kind)) throw new Error("Conflicting reference identity");
      if (!old) {
        const target = catalog(root).find(record => record.id === reference.id);
        if (target && cleanupReady(target) && target.membership_complete && !target.members.some(member => {
          try { fs.lstatSync(checked(root, member.path, true)); return true; }
          catch (error) { if (error.code === "ENOENT") return false; throw error; }
        })) throw new Error("Reference target has no extant lifecycle member");
        references.push(normalized);
      }
    }
    const result = { schema: 1, id: incoming.id, kind: incoming.kind, owner: incoming.owner, version: incoming.version ?? null,
      state: incoming.state, membership_complete: incoming.membership_complete, members, references,
      ...(incoming.generation !== undefined || previous?.generation !== undefined ? { generation: incoming.generation ?? previous.generation } : {}),
      ...(!newGeneration && previous?.producer ? { producer: previous.producer } : {}),
      ...(!newGeneration && previous?.close_receipt ? { close_receipt: previous.close_receipt } : {}),
      ...(!newGeneration && previous?.release_receipt ? { release_receipt: previous.release_receipt } : {}),
      ...(previous?.custody_handoffs ? { custody_handoffs: previous.custody_handoffs } : {}),
      ...(previous?.custody_transfer ? { custody_transfer: previous.custody_transfer } : {}),
      ...(previous?.custody_refinement ? { custody_refinement: previous.custody_refinement } : {}),
      ...(previous?.custody_refinements ? { custody_refinements: previous.custody_refinements } : {}),
      revision: (previous?.revision || 0) + 1, created_at: previous?.created_at || new Date().toISOString(), updated_at: new Date().toISOString() };
    const temporary = checked(root, filename + "." + crypto.randomUUID() + ".tmp");
    fs.writeFileSync(temporary, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
    fs.renameSync(temporary, filename);
    return result;
  } finally { descriptor.release(); }
}
// A custody handoff adjudicates ownership; it makes no claim about historical execution success.
function custodyInputs(root, sourceId, request, extraProofRoots = []) {
    root = path.resolve(root);
    const records = catalog(root), source = records.find(record => record.id === sourceId);
    if (!source || request.owner !== source.owner) throw new Error("Exact custody source owner required");
    const target = request.target;
    if (!target || typeof target.id !== "string" || !target.id || target.id === sourceId || target.kind !== "work" || typeof target.owner !== "string" || !target.owner.trim() || (target.version !== undefined && (typeof target.version !== "string" || !target.version))) throw new Error("Invalid custody target identity");
    if (!Array.isArray(request.paths) || !request.paths.length) throw new Error("Explicit custody paths required");
    const paths = request.paths.map(value => checked(root, value, true));
    const logs = path.join(root, "artifacts/logs");
    if (paths.some(value => value === logs || !inside(logs, value)) || paths.some((value, index) => paths.some((other, j) => j !== index && overlap(value, other)))) throw new Error("Custody paths must be disjoint roots strictly below artifacts/logs");
    const proofPath = value => {
      const result = checked(root, value);
      if (inside(registry(root), result) || [...paths, ...extraProofRoots].some(selected => inside(selected, result)) || source.members.some(member => inside(member.path, result)) || !fs.lstatSync(result).isFile()) throw new Error("Custody proof must be a surviving project file outside custody members and registry");
      return result;
    };
    const evidence = checkedEvidence(root, request);
    proofPath(evidence.evidence_ref);
    const document = JSON.parse(fs.readFileSync(evidence.evidence_ref, "utf8"));
    if (document.schema !== 1 || document.source_id !== sourceId || document.source_revision !== request.expected_revision || document.target_id !== target.id || document.user_authorized !== true || !Array.isArray(document.entries) || document.entries.length !== paths.length) throw new Error("Invalid custody evidence identity or authorization");
    const seen = new Set();
    for (const entry of document.entries) {
      const entryPath = checked(root, entry.path, true);
      if (!paths.includes(entryPath) || seen.has(entryPath) || entry.generated !== true || entry.protection_known !== true || entry.consumers_released !== true || entry.producer_stopped_verified !== true || typeof entry.generation_basis !== "string" || !entry.generation_basis.trim() || !Array.isArray(entry.producer_evidence) || !entry.producer_evidence.length) throw new Error("Invalid custody evidence entry");
      seen.add(entryPath);
      for (const proof of entry.producer_evidence) {
        const filename = proofPath(proof.path);
        if (!/^[a-f0-9]{64}$/.test(proof.sha256 || "") || sha(fs.readFileSync(filename)) !== proof.sha256) throw new Error("Custody producer proof SHA256 mismatch");
      }
    }
    const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
    const identity = sha(JSON.stringify(stable(request)));
    const receipt = source.custody_handoffs?.find(item => item.request_sha256 === identity);
    const existing = records.find(record => record.id === target.id);
    if (source.references.length || records.some(record => record.references.some(ref => ref.id === sourceId || ref.id === target.id))) throw new Error("Active custody consumer references");
    if (records.some(record => record.id !== sourceId && record.id !== target.id && record.members.some(member => paths.some(selected => overlap(selected, member.path))))) throw new Error("Custody overlaps another lifecycle owner");
    return { root, records, source, target, paths, evidence, document, identity, receipt, existing };
}
function rejectCustodyLinks(filename) {
  const metadata = fs.lstatSync(filename);
  if (metadata.isSymbolicLink()) throw new Error("Linked custody descendant");
  if (metadata.isDirectory()) for (const entry of fs.readdirSync(filename)) rejectCustodyLinks(path.join(filename, entry));
}
function custodyClaims(source, paths) {
  for (const selected of paths) {
    if (!source.members.some(member => member.path === selected) || source.members.some(member => member.path !== selected && inside(member.path, selected))) throw new Error("Custody selection must use exact roots without partial ancestor claims");
  }
  const transferred = source.members.filter(member => paths.some(selected => inside(selected, member.path)));
  if (transferred.some(member => member.role !== "legacy-custody" || member.generated !== false || member.protection_known !== false)) throw new Error("Only unresolved legacy custody may transfer");
  if (transferred.length === source.members.length) throw new Error("Custody source must retain remaining members");
  return transferred;
}
function custodyReceipt(input) {
  const { source, target, paths, identity, evidence, document } = input;
  return { request_sha256: identity, source_id: source.id, source_revision: source.revision, target: { ...target }, paths, original_members: custodyClaims(source, paths), original_producer: source.producer ?? null, original_state: source.state, ...evidence, producer_evidence: document.entries.map(entry => ({ path: entry.path, producer_evidence: entry.producer_evidence })) };
}
function transferCustody(root, sourceId, request) {
  return withCatalogLock(root, () => {
    const input = custodyInputs(root, sourceId, request);
    const { source, target, paths, identity, receipt, existing } = input;
    if (receipt && !existing) {
      if (paths.some(value => fs.existsSync(value))) throw new Error("Retired custody target still has extant paths");
      return { status: "already-retired", source_id: sourceId, target_id: target.id, receipt };
    }
    if (existing && (existing.custody_transfer?.request_sha256 !== identity || existing.owner !== target.owner || existing.kind !== target.kind || (existing.version ?? null) !== (target.version ?? null) || existing.references.length || existing.producer || !["pending", "complete"].includes(existing.state) || existing.members.length !== paths.length || existing.members.some(member => !paths.includes(member.path) || member.role !== "log" || member.generated !== true || member.protection_known !== true))) throw new Error("Conflicting custody target or retry");
    if (!receipt) {
      if (request.expected_revision !== source.revision) throw new Error("Stale custody source revision");
      // Inspect metadata only; do not follow links or read/hash historical payload.
      for (const selected of paths) rejectCustodyLinks(selected);
      const handoff = custodyReceipt(input);
      const now = new Date().toISOString();
      const pending = validate(root, { schema: 1, id: target.id, kind: target.kind, owner: target.owner, version: target.version ?? null, state: "pending", membership_complete: false, members: paths.map(value => ({ path: value, role: "log", generated: true, protection_known: true })), references: [], custody_transfer: handoff, revision: 1, created_at: now, updated_at: now });
      if (!existing) writeRecord(root, registryPath(root, target.id), pending);
      source.members = source.members.filter(member => !paths.some(selected => inside(selected, member.path)));
      source.custody_handoffs = [...(source.custody_handoffs || []), handoff];
      source.revision++;
      source.updated_at = now;
      writeRecord(root, registryPath(root, sourceId), validate(root, source));
    } else if (source.members.some(member => paths.some(selected => overlap(selected, member.path)))) throw new Error("Transferred source claims reappeared");
    const result = existing || validate(root, JSON.parse(fs.readFileSync(registryPath(root, target.id), "utf8")));
    if (result.state !== "complete") {
      result.state = "complete";
      result.membership_complete = true;
      result.revision++;
      result.updated_at = new Date().toISOString();
      writeRecord(root, registryPath(root, target.id), validate(root, result));
    }
    return { status: "transferred", source_id: sourceId, target_id: target.id, record: result };
  });
}
// Refine historical container claims without declaring its other contents generated.
// A pending destination protects partial publication; native maintenance still deletes.
function refineCustody(root, request) {
  return withCatalogLock(root, () => {
    root = path.resolve(root);
    const records = catalog(root), parent = checked(root, request.parent, true), target = request.target;
    const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
    const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
    const identity = sha(JSON.stringify(stable(request)));
    if (!target || typeof target.id !== "string" || !target.id || target.kind !== "work" || typeof target.owner !== "string" || !target.owner.trim() ||
        (target.version !== undefined && (typeof target.version !== "string" || !target.version))) throw new Error("Invalid refinement target");
    if (!Array.isArray(request.sources) || !request.sources.length || new Set(request.sources.map(s => s.id)).size !== request.sources.length ||
        request.sources.some(s => !s.id || s.id === target.id || !s.owner || !Number.isInteger(s.expected_revision) || s.expected_revision < 1)) throw new Error("Exact refinement sources required");
    if (!Array.isArray(request.paths) || !request.paths.length) throw new Error("Explicit refinement paths required");
    const paths = request.paths.map(p => checked(root, p, true));
    if (new Set(paths).size !== paths.length || paths.some(p => path.dirname(p) !== parent)) throw new Error("Refinement requires distinct immediate children");
    const sources = request.sources.map(s => {
      const record = records.find(r => r.id === s.id);
      if (!record || record.owner !== s.owner || record.state !== "retained" || record.membership_complete || record.producer || record.references.length) throw new Error("Unresolved inactive legacy source required");
      return record;
    });
    const evidence = checkedEvidence(root, request);
    if (inside(registry(root), evidence.evidence_ref) || inside(parent, evidence.evidence_ref) || sources.some(s => s.members.some(m => inside(m.path, evidence.evidence_ref)))) throw new Error("Refinement evidence must survive outside custody");
    const document = JSON.parse(fs.readFileSync(evidence.evidence_ref, "utf8"));
    if (document.schema !== 1 || document.action !== "refine-custody" || document.parent !== parent || document.target_id !== target.id || document.user_authorized !== true ||
        !equal(document.sources, request.sources) || !Array.isArray(document.entries) || document.entries.length !== paths.length) throw new Error("Invalid refinement evidence identity");
    const seen = new Set(), proofFiles = new Map();
    const addProof = proof => {
      const file = checked(root, proof.path);
      if (inside(registry(root), file) || inside(parent, file) || sources.some(s => s.members.some(m => inside(m.path, file))) || !fs.lstatSync(file).isFile() ||
          !/^[a-f0-9]{64}$/.test(proof.sha256 || "") || (proofFiles.has(file) && proofFiles.get(file) !== proof.sha256)) throw new Error("Refinement producer evidence changed or unsafe");
      proofFiles.set(file, proof.sha256);
    };
    for (const entry of document.entries) {
      if (!paths.includes(entry.path) || seen.has(entry.path) || entry.generated !== true || entry.protection_known !== true || entry.consumers_released !== true ||
          entry.producer_stopped_verified !== true || typeof entry.generation_basis !== "string" || !entry.generation_basis.trim() || !Array.isArray(entry.producer_evidence) || !entry.producer_evidence.length) throw new Error("Invalid refinement generation evidence");
      seen.add(entry.path);
      for (const proof of entry.producer_evidence) addProof(proof);
    }
    const exclusions = request.consumer_exclusions ?? [];
    const consumers = records.filter(r => r.references.some(ref => request.sources.some(s => s.id === ref.id)));
    if (!Array.isArray(exclusions) || !equal(exclusions, document.consumer_exclusions ?? []) || exclusions.length !== consumers.length ||
        new Set(exclusions.map(c => c.id)).size !== exclusions.length) throw new Error("Exact custody consumer exclusions required");
    for (const consumer of consumers) {
      const exclusion = exclusions.find(c => c.id === consumer.id);
      const references = consumer.references.filter(ref => request.sources.some(s => s.id === ref.id)).map(referenceIdentity).sort();
      if (!exclusion || exclusion.owner !== consumer.owner || exclusion.expected_revision !== consumer.revision || !equal(exclusion.paths, paths) ||
          !Array.isArray(exclusion.reference_ids) || !equal([...exclusion.reference_ids].sort(), references)) throw new Error("Active custody consumer references require exact owner exclusion");
      const proof = checkedEvidence(root, exclusion);
      addProof({ path: proof.evidence_ref, sha256: proof.evidence_sha256 });
    }
    const checkProofs = () => {
      for (const [file, expected] of proofFiles) if (sha(fs.readFileSync(checked(root, file))) !== expected) throw new Error("Refinement producer evidence changed");
    };
    checkProofs();
    const existing = records.find(r => r.id === target.id);
    for (const r of records) {
      if (r.references.some(ref => ref.id === target.id)) throw new Error("Active custody target consumer references");
      if (r.id !== target.id && !sources.includes(r) && r.members.some(m => paths.some(p => overlap(p, m.path)))) throw new Error("Custody overlaps another lifecycle owner");
    }
    if (existing && (existing.custody_refinement?.request_sha256 !== identity || existing.owner !== target.owner || existing.kind !== target.kind ||
        (existing.version ?? null) !== (target.version ?? null) || existing.references.length || existing.producer || !["pending", "complete"].includes(existing.state) ||
        !equal(existing.members, paths.map(p => ({ path: p, role: "artifact", generated: true, protection_known: true }))))) throw new Error("Conflicting refinement target or retry");
    const receipts = sources.map(s => s.custody_refinements?.find(r => r.request_sha256 === identity));
    if (!existing && receipts.some(Boolean)) {
      if (!receipts.every(Boolean)) throw new Error("Missing pending refinement target");
      if (paths.some(custodyPresent)) throw new Error("Retired custody target still has extant paths");
      return { status: "already-retired", target_id: target.id };
    }
    const parentIdentity = custodyFileIdentity(parent);
    if (!fs.lstatSync(parent).isDirectory()) throw new Error("Refinement parent must be a directory");
    const children = fs.readdirSync(parent).sort().map(name => checked(root, path.join(parent, name), true));
    if (paths.some(p => !children.includes(p))) throw new Error("Selected refinement child missing or aliased");
    const remaining = children.filter(p => !paths.includes(p));
    if (!remaining.length) throw new Error("Refinement must preserve unknown container contents");
    const childIdentities = children.map(p => ({ path: p, ...custodyFileIdentity(p) }));
    for (const p of paths) {
      if (!fs.lstatSync(p).isDirectory()) throw new Error("Refinement child must be a directory");
      rejectCustodyLinks(p);
    }
    const snapshot = { parent_identity: parentIdentity, child_identities: childIdentities };
    if (existing && !equal(existing.custody_refinement.snapshot, snapshot)) throw new Error("Refinement filesystem identity or membership changed");
    const changes = sources.map((source, index) => {
      const applied = receipts[index];
      if (applied) {
        if (source.revision !== request.sources[index].expected_revision + 1 || !equal(applied.paths, paths) || source.members.some(m => paths.some(p => overlap(p, m.path))) ||
            !applied.replacements.every(m => source.members.some(other => equal(m, other)))) throw new Error("Refined source changed after publication");
        return null;
      }
      if (source.revision !== request.sources[index].expected_revision) throw new Error("Stale custody source revision");
      const claims = source.members.filter(m => m.path === parent);
      if (claims.length !== 1 || !["legacy-custody", "legacy-input"].includes(claims[0].role) || claims[0].generated !== false || claims[0].protection_known !== false ||
          source.members.some(m => m.path !== parent && paths.some(p => overlap(p, m.path)))) throw new Error("Exact unresolved legacy parent claim required");
      const replacements = remaining.map(p => ({ ...claims[0], path: p }));
      const members = [...source.members.filter(m => m.path !== parent)];
      for (const m of replacements) if (!members.some(other => equal(m, other))) members.push(m);
      return { source, members, receipt: { request_sha256: identity, parent, paths, original_member: claims[0], replacements, ...evidence } };
    });
    const checkSnapshot = () => {
      verifyCustodyIdentity(parent, parentIdentity);
      if (!equal(fs.readdirSync(parent).sort().map(name => path.join(parent, name)), children)) throw new Error("Refinement directory membership changed");
      for (const child of childIdentities) verifyCustodyIdentity(child.path, child);
      checkedEvidence(root, request);
      checkProofs();
    };
    checkSnapshot();
    const now = new Date().toISOString();
    const pending = existing || validate(root, { schema: 1, id: target.id, kind: "work", owner: target.owner, version: target.version ?? null,
      state: "pending", membership_complete: false, members: paths.map(p => ({ path: p, role: "artifact", generated: true, protection_known: true })), references: [],
      custody_refinement: { request_sha256: identity, sources: request.sources, paths, snapshot, ...evidence }, revision: 1, created_at: now, updated_at: now });
    if (!existing) writeRecord(root, registryPath(root, target.id), pending);
    for (const change of changes.filter(Boolean)) {
      checkSnapshot();
      const { source, members, receipt } = change;
      source.members = members;
      source.custody_refinements = [...(source.custody_refinements || []), receipt];
      source.revision++;
      source.updated_at = new Date().toISOString();
      writeRecord(root, registryPath(root, source.id), validate(root, source));
    }
    checkSnapshot();
    if (pending.state !== "complete") {
      pending.state = "complete";
      pending.membership_complete = true;
      pending.revision++;
      pending.updated_at = new Date().toISOString();
      writeRecord(root, registryPath(root, target.id), validate(root, pending));
    }
    return { status: "refined", target_id: target.id, record: pending };
  });
}
function custodyFileIdentity(filename) {
  const stat = fs.lstatSync(filename, { bigint: true });
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error("Unsupported custody filesystem entry");
  return { dev: stat.dev.toString(), ino: stat.ino.toString() };
}
function custodyPresent(filename) {
  try { fs.lstatSync(filename); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
function verifyCustodyIdentity(filename, expected) {
  const actual = custodyFileIdentity(filename);
  if (actual.dev !== expected.dev || actual.ino !== expected.ino) throw new Error("Custody filesystem identity changed: " + filename);
}
function relocateCustody(root, sourceId, request) {
  return withCatalogLock(root, () => {
    root = path.resolve(root);
    const destination = checked(root, request.destination_root, true), logs = path.join(root, "artifacts/logs");
    if (destination === logs || !inside(logs, destination)) throw new Error("Custody destination must be strictly below artifacts/logs");
    const input = custodyInputs(root, sourceId, request, [destination]);
    const { records, source, target, paths, identity, receipt, existing } = input;
    if (paths.some(selected => overlap(selected, destination)) || records.some(record => record.id !== target.id && record.members.some(member => overlap(member.path, destination)))) throw new Error("Custody destination overlaps existing claims");
    const basenames = paths.map(selected => path.basename(selected));
    const names = process.platform === "win32" ? basenames.map(name => name.toLowerCase()) : basenames;
    if (new Set(names).size !== names.length) throw new Error("Custody destination basename collision");
    if (receipt && !existing) {
      if (paths.some(custodyPresent) || custodyPresent(destination)) throw new Error("Retired custody migration still has extant paths");
      return { status: "already-retired", source_id: sourceId, target_id: target.id, receipt };
    }
    if (existing && (existing.custody_transfer?.request_sha256 !== identity || !existing.custody_transfer.migration || existing.owner !== target.owner || existing.kind !== target.kind || (existing.version ?? null) !== (target.version ?? null) || existing.references.length || existing.producer || !["pending", "complete"].includes(existing.state) || existing.membership_complete !== (existing.state === "complete") || existing.members.length !== 1 || existing.members[0].path !== destination || existing.members[0].role !== "log" || existing.members[0].generated !== true || existing.members[0].protection_known !== true)) throw new Error("Conflicting custody migration target or retry");
    if (receipt) {
      if (source.members.some(member => paths.some(selected => overlap(selected, member.path))) || paths.some(custodyPresent)) throw new Error("Migrated source paths or claims reappeared");
      if (existing.state === "complete") {
        const migration = existing.custody_transfer.migration;
        if (migration.destination_root !== destination || !migration.destination_identity || migration.moves.length !== paths.length || new Set(migration.moves.map(move => move.original)).size !== paths.length || migration.moves.some(move => !paths.includes(move.original) || move.destination !== path.join(destination, path.basename(move.original)))) throw new Error("Conflicting completed custody migration intent");
        verifyCustodyIdentity(path.dirname(destination), migration.parent_identity);
        verifyCustodyIdentity(destination, migration.destination_identity);
        const expectedNames = migration.moves.map(move => path.basename(move.destination)).sort();
        const actualNames = fs.readdirSync(destination).sort();
        if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) throw new Error("Unexpected content in completed custody destination");
        rejectCustodyLinks(destination);
        for (const move of migration.moves) {
          checked(root, move.destination, true);
          verifyCustodyIdentity(move.destination, move.identity);
        }
        return { status: "relocated", source_id: sourceId, target_id: target.id, record: existing };
      }
    } else {
      if (request.expected_revision !== source.revision) throw new Error("Stale custody source revision");
      custodyClaims(source, paths);
      if (existing?.state === "complete") throw new Error("Completed migration lacks source receipt");
    }
    let pending = existing;
    if (!pending) {
      if (custodyPresent(destination)) throw new Error("Custody destination already exists");
      const parent = path.dirname(destination);
      if (!fs.lstatSync(parent).isDirectory()) throw new Error("Custody destination parent must exist");
      const parentIdentity = custodyFileIdentity(parent);
      const moves = paths.map(selected => {
        rejectCustodyLinks(selected);
        const before = custodyFileIdentity(selected);
        if (before.dev !== parentIdentity.dev) throw new Error("Custody migration requires the same volume");
        return { original: selected, destination: path.join(destination, path.basename(selected)), identity: before };
      });
      const handoff = { ...custodyReceipt(input), migration: { destination_root: destination, parent_identity: parentIdentity, moves } };
      const now = new Date().toISOString();
      pending = validate(root, { schema: 1, id: target.id, kind: "work", owner: target.owner, version: target.version ?? null, state: "pending", membership_complete: false, members: [{ path: destination, role: "log", generated: true, protection_known: true }], references: [], custody_transfer: handoff, revision: 1, created_at: now, updated_at: now });
      writeRecord(root, registryPath(root, target.id), pending);
    }
    const migration = pending.custody_transfer.migration;
    if (migration.destination_root !== destination || migration.moves.length !== paths.length || migration.moves.some(move => !paths.includes(move.original) || move.destination !== path.join(destination, path.basename(move.original)))) throw new Error("Conflicting custody migration intent");
    verifyCustodyIdentity(path.dirname(destination), migration.parent_identity);
    if (!migration.destination_identity) {
      if (custodyPresent(destination)) throw new Error("Custody destination exists without saved identity; explicit recovery evidence required");
      // mkdir cannot be atomic with its receipt. A crash in this gap deliberately fails closed.
      fs.mkdirSync(destination);
      migration.destination_identity = custodyFileIdentity(destination);
      pending.revision++; pending.updated_at = new Date().toISOString();
      writeRecord(root, registryPath(root, target.id), validate(root, pending));
    }
    verifyCustodyIdentity(destination, migration.destination_identity);
    const allowed = new Set(migration.moves.map(move => path.basename(move.destination)));
    if (fs.readdirSync(destination).some(name => !allowed.has(name))) throw new Error("Unexpected content in custody destination");
    // Reconcile the entire plan before moving another root on a retry.
    for (const move of migration.moves) {
      const original = custodyPresent(move.original), moved = custodyPresent(move.destination);
      if (original === moved) throw new Error("Custody migration requires exactly one original or destination: " + move.original);
      const current = original ? move.original : move.destination;
      checked(root, current, true); rejectCustodyLinks(current); verifyCustodyIdentity(current, move.identity);
      if (move.identity.dev !== migration.destination_identity.dev) throw new Error("Custody migration requires the same volume");
    }
    for (const move of migration.moves) if (custodyPresent(move.original)) {
      verifyCustodyIdentity(move.original, move.identity);
      fs.renameSync(move.original, move.destination);
      verifyCustodyIdentity(move.destination, move.identity);
    }
    for (const move of migration.moves) {
      if (custodyPresent(move.original)) throw new Error("Custody original remains after migration");
      verifyCustodyIdentity(move.destination, move.identity);
    }
    if (!receipt) {
      source.members = source.members.filter(member => !paths.some(selected => inside(selected, member.path)));
      source.custody_handoffs = [...(source.custody_handoffs || []), pending.custody_transfer];
      source.revision++; source.updated_at = new Date().toISOString();
      writeRecord(root, registryPath(root, sourceId), validate(root, source));
    }
    pending.state = "complete"; pending.membership_complete = true;
    pending.revision++; pending.updated_at = new Date().toISOString();
    writeRecord(root, registryPath(root, target.id), validate(root, pending));
    return { status: "relocated", source_id: sourceId, target_id: target.id, record: pending };
  });
}
function planCleanup(root, { paths = [], protectedPaths = [], reportPath } = {}) {
  const records = catalog(root);
  const candidates = paths.map(value => checked(root, value, true));
  const protectedList = protectedPaths.map(value => path.resolve(value));
  const report = reportPath ? checked(root, reportPath) : null;
  const selected = new Set(records.filter(record => record.members.some(member => candidates.some(candidate => overlap(member.path, candidate)))).map(record => record.id));
  // Shared members connect ownership groups; a partial selection cannot split them.
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) if (!selected.has(record.id) && records.some(other => selected.has(other.id) && other.members.some(a => record.members.some(b => overlap(a.path, b.path))))) { selected.add(record.id); changed = true; }
  }
  const groups = records.filter(record => selected.has(record.id)).map(record => {
    const blockers = [];
    if (!cleanupReady(record)) blockers.push(`lifecycle-state:${record.state}`);
    if (!record.membership_complete) blockers.push("incomplete-membership");
    if (record.members.some(member => member.generated === false)) blockers.push("unconfirmed-generated-ownership");
    if (record.members.some(member => member.protection_known === false)) blockers.push("unknown-member-protection");
    if (record.members.some(member => protectedList.some(protectedPath => overlap(member.path, protectedPath)))) blockers.push("protected-member");
    if (report && record.members.some(member => inside(member.path, report))) blockers.push("report-inside-member");
    for (const other of records) if (other.references.some(ref => ref.id === record.id)) blockers.push(`active-reference:${other.id}`);
    return { id: record.id, members: projectMembers(record.members), blockers, registered: true };
  });
  const globalBlockers = [];
  const standalone = candidates.filter(candidate => !records.some(record => selected.has(record.id) && record.members.some(member => overlap(member.path, candidate)))).map(candidate => {
    if (report && inside(candidate, report)) globalBlockers.push(`report-inside-standalone:${candidate}`);
    return { path: candidate, registered: false };
  });
  // Connected groups share protection; independent selected groups stay independent.
  changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) if (!group.blockers.length && groups.some(other => other.blockers.length && other.members.some(a => group.members.some(b => overlap(a.path, b.path))))) { group.blockers.push("shared-group-protection"); changed = true; }
  }
  return { groups, standalone, blockers: globalBlockers };
}
function registerRequest(root, id) {
  const records = catalog(root);
  const record = records.find(value => value.id === id);
  if (!record) throw new Error("Unknown lifecycle id");
  const provenance = registryPath(root, id);
  // Registry references describe a consumer's dependencies. Native item
  // references protect an item from its consumers, so project the inverse.
  const inbound = records.flatMap(consumer => consumer.references.filter(reference => reference.id === id)
    .map(reference => `${consumer.id}:${reference.reason}`));
  return { operation: "register", group: { id, kind: record.kind, owner: record.owner, version: record.version,
    membership_complete: cleanupReady(record) && record.membership_complete, provenance_ref: provenance,
    membership_source: registry(root), membership_source_format: "producer_registry_v1",
    members: projectMembers(record.members).map(member => ({ id: sha(id + "\0" + member.path), path: member.path, role: member.role,
      lifecycle_role: /(?:^|[-_\s])logs?(?:$|[-_\s])/i.test(member.role) ? "log"
        : /(?:^|[-_\s])(?:reports?|evidence|verification)(?:$|[-_\s])/i.test(member.role) ? "evidence"
        : /(?:^|[-_\s])(?:snapshots?|inputs?)(?:$|[-_\s])/i.test(member.role) ? "snapshot" : "artifact",
      kind: member.role, owner: record.owner, generated: member.generated !== false, protection_known: member.protection_known === true,
      references: inbound, provenance_ref: provenance })) } };
}
function finalize(root, id, retirement) { return withCatalogLock(root, () => finalizeUnlocked(root, id, retirement)); }
function finalizeUnlocked(root, id, retirement) {
  const filename = registryPath(root, id);
  const lock = filename + ".lock";
  const descriptor = acquire(checked(root, lock), { operation: "lifecycle.finalize" });
  try {
    const records = catalog(root), record = records.find(value => value.id === id);
    if (!record) throw new Error("Unknown lifecycle id");
    const remaining = record.members.filter(member => {
      checked(root, member.path, true);
      try { fs.lstatSync(member.path); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
    }).map(member => member.path);
    const references = records.filter(other => other.references.some(reference => reference.id === id)).map(other => other.id);
    const blockers = [];
    let retirementEvidence = null;
    if (retirement !== undefined) {
      if (retirement.producer_stopped_verified !== true || typeof retirement.reason !== "string" || !retirement.reason.trim()) throw new Error("Verified producer retirement and reason required");
      const evidence = checked(root, retirement.evidence_ref);
      if (record.members.some(member => overlap(member.path, evidence)) || inside(registry(root), evidence)) throw new Error("Retirement evidence must survive the retired group and registry");
      const stat = fs.lstatSync(evidence);
      if (!stat.isFile()) throw new Error("Readable retirement evidence file required");
      const evidenceHash = sha(fs.readFileSync(evidence));
      if (retirement.evidence_sha256 !== undefined && (!/^[a-f0-9]{64}$/.test(retirement.evidence_sha256) || retirement.evidence_sha256 !== evidenceHash)) throw new Error("Retirement evidence SHA256 changed");
      retirementEvidence = { path: evidence, sha256: evidenceHash, reason: retirement.reason, original_state: record.state, original_membership_complete: record.membership_complete };
    }
    if (!retirementEvidence && !cleanupReady(record)) blockers.push(`lifecycle-state:${record.state}`);
    if (!retirementEvidence && !record.membership_complete) blockers.push("incomplete-membership");
    if (remaining.length || references.length || blockers.length) return { id, status: "retained", remaining, references, blockers, registryPath: filename };
    if (retirementEvidence && sha(fs.readFileSync(checked(root, retirementEvidence.path))) !== retirementEvidence.sha256) throw new Error("Retirement evidence changed before finalization");
    // Metadata reconciliation follows verified absence, never a producer state label.
    fs.unlinkSync(filename);
    return { id, status: "finalized", remaining: [], references: [], blockers: [], registryPath: filename,
      ...(retirementEvidence ? { retirement: retirementEvidence } : {}) };
  } finally { descriptor.release(); }
}
function main(argv = process.argv.slice(2)) {
  const action = argv.shift(), options = {}, members = [], references = [], paths = [], protectedPaths = [];
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i], value = argv[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing ${key} value`);
    if (key === "--member") { const split = value.indexOf("="); if (split < 1) throw new Error("Expected role=ABS"); members.push({ role: value.slice(0, split), path: value.slice(split + 1) }); }
    else if (key === "--reference") { const split = value.indexOf("="); if (split < 1 || split === value.length - 1) throw new Error("Expected lifecycle-id=reason"); references.push({ id: value.slice(0, split), reason: value.slice(split + 1) }); }
    else if (key === "--candidate") paths.push(value);
    else if (key === "--protected") protectedPaths.push(value);
    else if (["--project-root", "--id", "--kind", "--owner", "--version", "--state", "--report", "--membership-complete", "--limit", "--offset", "--producer-stopped-verified", "--evidence-ref", "--evidence-sha256", "--reason", "--request-file", "--generated", "--protection-known", "--reference-kind"].includes(key) && !Object.hasOwn(options, key.slice(2))) options[key.slice(2)] = value;
    else throw new Error(`Unknown or duplicate option ${key}`);
  }
  if (!options["project-root"] || !path.isAbsolute(options["project-root"])) throw new Error("--project-root ABS required");
  const root = options["project-root"];
  const retirementKeys = ["producer-stopped-verified", "evidence-ref", "evidence-sha256", "reason"];
  const retirementRequested = retirementKeys.some(key => Object.hasOwn(options, key));
  if (retirementRequested && !["finalize", "reconcile"].includes(action)) throw new Error("Retirement options require finalize or reconcile");
  if (["close", "release", "transfer-custody", "relocate-custody", "refine-custody"].includes(action)) {
    const requestFile = checked(root, options["request-file"]);
    const request = JSON.parse(fs.readFileSync(requestFile, "utf8"));
    return action === "refine-custody" ? refineCustody(root, request) : action === "relocate-custody" ? relocateCustody(root, options.id, request) : action === "transfer-custody" ? transferCustody(root, options.id, request) : action === "close" ? closeLifecycle(root, options.id, request) : releaseReferences(root, options.id, request);
  }
  if (action === "record") {
    if (options["reference-kind"] !== undefined) {
      if (!referenceKinds.has(options["reference-kind"])) throw new Error("Invalid reference kind");
      for (const reference of references) reference.kind = options["reference-kind"];
    }
    for (const key of ["generated", "protection-known"]) if (options[key] !== undefined && !["true", "false"].includes(options[key])) throw new Error(`--${key} true|false`);
    for (const member of members) {
      if (options.generated !== undefined) member.generated = options.generated === "true";
      if (options["protection-known"] !== undefined) member.protection_known = options["protection-known"] === "true";
    }
    if (options["membership-complete"] && !["true", "false"].includes(options["membership-complete"])) throw new Error("--membership-complete true|false");
    return recordLifecycle(root, { id: options.id, kind: options.kind, owner: options.owner, version: options.version,
      state: options.state, membership_complete: options["membership-complete"] === "true", members, references });
  }
  if (action === "plan") return planCleanup(root, { paths, protectedPaths, reportPath: options.report });
  if (action === "register") return registerRequest(root, options.id);
  if (action === "finalize" || action === "reconcile") {
    if (!retirementRequested) return finalize(root, options.id);
    if (retirementKeys.some(key => !Object.hasOwn(options, key)) || options["producer-stopped-verified"] !== "true" ||
        !path.isAbsolute(options["evidence-ref"]) || !/^[a-f0-9]{64}$/.test(options["evidence-sha256"]) || !options.reason.trim()) throw new Error("Explicit verified retirement, absolute evidence path, SHA256 and reason required");
    return finalize(root, options.id, { producer_stopped_verified: true, evidence_ref: options["evidence-ref"], evidence_sha256: options["evidence-sha256"], reason: options.reason });
  }
  if (action === "catalog") {
    const limit = options.limit === undefined ? 50 : Number(options.limit), offset = options.offset === undefined ? 0 : Number(options.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) throw new Error("Catalog limit 1..200 and nonnegative offset required");
    const records = catalog(root);
    return { total: records.length, offset, limit, groups: records.slice(offset, offset + limit).map(({ id, kind, owner, version, state, membership_complete, members, references, revision, producer, generation }) => ({ id, kind, owner, version, state, membership_complete, member_count: members.length, references, revision, ...(producer ? { producer } : {}), ...(generation ? { generation } : {}) })) };
  }
  throw new Error("Expected record, plan, register, catalog or finalize");
}
module.exports = { checkedEvidence, withCatalogLock, closeLifecycle, releaseReferences, transferCustody, relocateCustody, refineCustody, recordLifecycle, planCleanup, registerRequest, catalog, registryPath, projectMembers, finalize, main };
if (require.main === module) { try { console.log(JSON.stringify(main())); } catch (error) { console.error(error.message); process.exitCode = 1; } }

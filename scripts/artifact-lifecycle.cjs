"use strict";
// Producer metadata only. Native maintenance owns review, registration and deletion.
const fs = require("node:fs");
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
  const descriptor = fs.openSync(lock, "wx");
  try { return action(); } finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
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
    const descriptor = fs.openSync(lock, "wx");
    try {
      const record = validate(root, JSON.parse(fs.readFileSync(filename, "utf8")));
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
    } finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
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
  const descriptor = fs.openSync(lock, "wx");
  try {
    const previous = fs.existsSync(filename) ? validate(root, JSON.parse(fs.readFileSync(filename, "utf8"))) : null;
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
      revision: (previous?.revision || 0) + 1, created_at: previous?.created_at || new Date().toISOString(), updated_at: new Date().toISOString() };
    const temporary = checked(root, filename + "." + crypto.randomUUID() + ".tmp");
    fs.writeFileSync(temporary, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
    fs.renameSync(temporary, filename);
    return result;
  } finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
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
  const descriptor = fs.openSync(checked(root, lock), "wx");
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
      retirementEvidence = { path: evidence, sha256: sha(fs.readFileSync(evidence)), reason: retirement.reason, original_state: record.state, original_membership_complete: record.membership_complete };
    }
    if (!retirementEvidence && !cleanupReady(record)) blockers.push(`lifecycle-state:${record.state}`);
    if (!retirementEvidence && !record.membership_complete) blockers.push("incomplete-membership");
    if (remaining.length || references.length || blockers.length) return { id, status: "retained", remaining, references, blockers, registryPath: filename };
    // Metadata reconciliation follows verified absence, never a producer state label.
    fs.unlinkSync(filename);
    return { id, status: "finalized", remaining: [], references: [], blockers: [], registryPath: filename,
      ...(retirementEvidence ? { retirement: retirementEvidence } : {}) };
  } finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
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
    else if (["--project-root", "--id", "--kind", "--owner", "--version", "--state", "--report", "--membership-complete", "--limit", "--offset", "--request-file", "--generated", "--protection-known", "--reference-kind"].includes(key) && !Object.hasOwn(options, key.slice(2))) options[key.slice(2)] = value;
    else throw new Error(`Unknown or duplicate option ${key}`);
  }
  if (!options["project-root"] || !path.isAbsolute(options["project-root"])) throw new Error("--project-root ABS required");
  const root = options["project-root"];
  if (["close", "release"].includes(action)) {
    const requestFile = checked(root, options["request-file"]);
    const request = JSON.parse(fs.readFileSync(requestFile, "utf8"));
    return action === "close" ? closeLifecycle(root, options.id, request) : releaseReferences(root, options.id, request);
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
  if (action === "finalize" || action === "reconcile") return finalize(root, options.id);
  if (action === "catalog") {
    const limit = options.limit === undefined ? 50 : Number(options.limit), offset = options.offset === undefined ? 0 : Number(options.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) throw new Error("Catalog limit 1..200 and nonnegative offset required");
    const records = catalog(root);
    return { total: records.length, offset, limit, groups: records.slice(offset, offset + limit).map(({ id, kind, owner, version, state, membership_complete, members, references, revision, producer, generation }) => ({ id, kind, owner, version, state, membership_complete, member_count: members.length, references, revision, ...(producer ? { producer } : {}), ...(generation ? { generation } : {}) })) };
  }
  throw new Error("Expected record, plan, register, catalog or finalize");
}
module.exports = { withCatalogLock, closeLifecycle, releaseReferences, recordLifecycle, planCleanup, registerRequest, catalog, registryPath, projectMembers, finalize, main };
if (require.main === module) { try { console.log(JSON.stringify(main())); } catch (error) { console.error(error.message); process.exitCode = 1; } }

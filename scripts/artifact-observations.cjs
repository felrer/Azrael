"use strict";
// Observation scopes carry no generated ownership. Dependency references are the
// existing native protection protocol; all publication uses the catalog lease.
const { isDeepStrictEqual: equal } = require("node:util");
function createObservationApi(d) {
  const { fs, path, sha, inside, overlap, checked, registry, registryPath, validate, catalog, projectMembers,
    withCatalogLock, writeRecord, checkedEvidence, referenceIdentity, cleanupReservation } = d;
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  const requestHash = value => sha(JSON.stringify(stable(value)));
  const rawRecord = (root, id) => fs.readFileSync(registryPath(root, id));
  const isUnclassifiedCustody = record => record.record_type !== "observation" && record.state === "retained" && record.membership_complete === false &&
    !record.producer && !record.owned_root && !record.ownership_scope && record.members.every(member =>
      ["legacy-custody", "legacy-input"].includes(member.role) && member.generated === false && member.protection_known === false);
  const ownerRecords = root => catalog(root).filter(record => record.record_type !== "observation" && !isUnclassifiedCustody(record));
  const binding = (record, raw) => ({ id: record.id, owner: record.owner, expected_revision: record.revision, record_sha256: sha(raw) });
  function validateObservation(root, record) {
    const o = record.observation;
    if (record.kind !== "work" || record.state !== "retained" || record.membership_complete !== false || record.producer || record.ownership_scope || record.owned_root ||
        !o || o.schema !== 1 || !Array.isArray(o.scopes) || !o.scopes.length || !Array.isArray(o.holds) || !Array.isArray(o.resolutions) ||
        o.scopes.length !== record.members.length || new Set(o.scopes.map(scope => scope.path)).size !== o.scopes.length) throw new Error("Invalid observation carrier");
    for (const scope of o.scopes) {
      checked(root, scope.path, true);
      if (scope.status !== "unresolved" || typeof scope.reason !== "string" || !scope.reason.trim() || !record.members.some(member => member.path === scope.path && member.role === "observation-scope" && member.generated === false && member.protection_known === false)) throw new Error("Observation scopes cannot confer ownership");
    }
    if (new Set(o.holds.map(hold => hold.reference_id)).size !== o.holds.length) throw new Error("Duplicate observation holds");
    for (const hold of o.holds) {
      if (!o.scopes.some(scope => scope.path === hold.scope) || typeof hold.target_id !== "string" || !hold.target_id || !Array.isArray(hold.member_paths) || !hold.member_paths.length ||
          !record.references.some(ref => ref.id === hold.target_id && ref.kind === "dependency" && ref.reference_id === hold.reference_id && equal(ref.member_paths, hold.member_paths))) throw new Error("Missing materialized observation protection");
    }
  }
  function views(records) {
    return records.map(record => ({ id: record.id, owner: record.owner, revision: record.revision, record_type: "observation",
      scopes: record.observation.scopes, holds: record.observation.holds, resolutions: record.observation.resolutions,
      references: record.references, ...(record.observation.migration ? { migration: record.observation.migration } : {}) }));
  }
  const observationCatalog = root => views(catalog(root).filter(record => record.record_type === "observation"));
  function addHolds(record, target, targetHash) {
    let changed = false;
    for (const scope of record.observation.scopes) {
      const member_paths = projectMembers(target.members).filter(member => overlap(scope.path, member.path)).map(member => member.path).sort();
      if (!member_paths.length) continue;
      if (record.observation.resolutions.some(resolution => resolution.scope === scope.path && resolution.target.id === target.id && resolution.target.record_sha256 === targetHash)) continue;
      const reason = `Unresolved observation scope: ${scope.path}`;
      const reference = { id: target.id, reason, kind: "dependency", member_paths };
      reference.reference_id = referenceIdentity(reference);
      if (record.observation.holds.some(hold => hold.reference_id === reference.reference_id)) continue;
      record.references.push(reference);
      record.observation.holds.push({ target_id: target.id, scope: scope.path, reference_id: reference.reference_id, member_paths });
      changed = true;
    }
    return changed;
  }
  function publish(root, record) {
    record.updated_at = new Date().toISOString();
    writeRecord(root, registryPath(root, record.id), validate(root, record));
    return record;
  }
  function protectOwner(root, target) {
    // Publish holds first. A failed owner write leaves conservative dangling
    // dependencies; retry reuses their deterministic reference identities.
    if (isUnclassifiedCustody(target)) return;
    for (const record of catalog(root).filter(record => record.record_type === "observation")) {
      // This publisher creates a new owner or revision. Previous resolutions
      // bind old raw bytes, so never predict the native serializer's new hash.
      if (addHolds(record, target, null)) {
        record.revision++;
        publish(root, record);
      }
    }
  }
  function outsideProof(root, request, scopes, targets = []) {
    const proof = checkedEvidence(root, request);
    if (inside(registry(root), proof.evidence_ref) || scopes.some(scope => overlap(scope.path, proof.evidence_ref)) ||
        targets.some(target => target.members.some(member => overlap(member.path, proof.evidence_ref)))) throw new Error("Observation evidence must survive outside scopes, owners and registry");
    return proof;
  }
  function recordObservation(root, request) {
    return withCatalogLock(root, () => {
      const identity = requestHash(request), previous = catalog(root).find(record => record.id === request.id);
      if (previous) {
        if (previous.record_type === "observation" && previous.revision === 1 && previous.observation.creation_request_sha256 === identity) return previous;
        throw new Error("Observation id already exists; use exact migration or resolution");
      }
      if (typeof request.id !== "string" || !request.id || typeof request.owner !== "string" || !request.owner.trim() || !Array.isArray(request.scopes) || !request.scopes.length ||
          request.record_type && request.record_type !== "observation" || request.producer || request.owned_root || request.ownership_scope || request.references?.length) throw new Error("Explicit observation identity and scopes required");
      const scopes = request.scopes.map(scope => ({ path: checked(root, scope.path, true), reason: scope.reason, status: "unresolved" }));
      const now = new Date().toISOString();
      const record = { schema: 1, record_type: "observation", id: request.id, owner: request.owner, kind: "work", version: null,
        state: "retained", membership_complete: false, members: scopes.map(scope => ({ path: scope.path, role: "observation-scope", generated: false, protection_known: false })),
        references: [], observation: { schema: 1, scopes, holds: [], resolutions: [], creation_request_sha256: identity }, revision: 1, created_at: now, updated_at: now };
      for (const target of ownerRecords(root)) addHolds(record, target, sha(rawRecord(root, target.id)));
      return publish(root, record);
    });
  }
  function migrateObservation(root, id, request) {
    return withCatalogLock(root, () => {
      const raw = rawRecord(root, id), source = validate(root, JSON.parse(raw)), identity = requestHash(request);
      if (source.record_type === "observation") {
        const receipt = source.observation.migration;
        if (receipt?.request_sha256 !== identity || source.revision !== request.expected_revision + 1) throw new Error("Conflicting observation migration retry");
        outsideProof(root, request, source.observation.scopes);
        return source;
      }
      if (source.id !== id || source.owner !== request.owner || source.revision !== request.expected_revision || sha(raw) !== request.source_sha256 ||
          !isUnclassifiedCustody(source) || source.references.length) throw new Error("Exact unresolved custody source required for observation migration");
      if (cleanupReservation(root, source)) throw new Error("Observation migration has active-cleanup-reservation");
      const scopes = source.members.map(member => ({ path: member.path, reason: request.reason, status: "unresolved" }));
      const targets = ownerRecords(root).filter(target => target.id !== id);
      const evidence = outsideProof(root, request, scopes, targets.filter(target => target.members.some(member => scopes.some(scope => overlap(scope.path, member.path)))));
      const document = JSON.parse(fs.readFileSync(evidence.evidence_ref, "utf8"));
      if (document.schema !== 1 || document.action !== "migrate-observation" || document.user_authorized !== true ||
          !equal(document.source, binding(source, raw)) || document.original_record_raw !== raw.toString("utf8")) throw new Error("Migration evidence must preserve exact original custody bytes");
      const record = { ...source, record_type: "observation", kind: "work", state: "retained", membership_complete: false,
        members: scopes.map(scope => ({ path: scope.path, role: "observation-scope", generated: false, protection_known: false })),
        observation: { schema: 1, scopes, holds: [], resolutions: [], migration: { request_sha256: identity, source: binding(source, raw), ...evidence } }, revision: source.revision + 1 };
      for (const target of targets) addHolds(record, target, sha(rawRecord(root, target.id)));
      outsideProof(root, request, scopes);
      if (!rawRecord(root, id).equals(raw)) throw new Error("Observation source changed before migration");
      return publish(root, record);
    });
  }
  function resolveObservation(root, id, request) {
    return withCatalogLock(root, () => {
      const raw = rawRecord(root, id), source = validate(root, JSON.parse(raw)), identity = requestHash(request);
      if (source.record_type !== "observation" || source.owner !== request.owner || source.id !== id) throw new Error("Exact observation owner required");
      const retry = source.observation.resolution_receipts?.find(receipt => receipt.request_sha256 === identity);
      if (source.revision !== request.expected_revision + (retry ? 1 : 0)) throw new Error("Stale observation revision");
      const targetBinding = request.target;
      if (!targetBinding || targetBinding.id === id) throw new Error("Actual target binding required");
      const checkTarget = () => {
        const targetRaw = rawRecord(root, targetBinding.id), target = validate(root, JSON.parse(targetRaw)), producer = target.producer;
        if (target.record_type === "observation" || !equal(binding(target, targetRaw), targetBinding) || !target.membership_complete || !producer || producer.status !== "stopped" ||
            !["success", "failure"].includes(producer.outcome) || !Number.isInteger(producer.exit_code) ||
            (producer.outcome === "success" ? producer.exit_code !== 0 || target.state !== "complete" : producer.exit_code === 0 || target.state !== "failed") ||
            target.members.some(member => member.generated !== true || member.protection_known !== true)) throw new Error("Target binding, stopped outcome or generated protection invalid");
        if (cleanupReservation(root, target)) throw new Error("Observation target has active-cleanup-reservation");
        outsideProof(root, producer, source.observation.scopes, [target]);
        return target;
      };
      const target = checkTarget();
      if (!Array.isArray(request.paths) || !request.paths.length || new Set(request.paths).size !== request.paths.length ||
          request.paths.some(value => !source.observation.scopes.some(scope => scope.path === value))) throw new Error("Exact selected observation scopes required");
      const selected = request.paths.map(value => source.observation.scopes.find(scope => scope.path === value));
      const holds = source.observation.holds.filter(hold => hold.target_id === target.id && request.paths.includes(hold.scope));
      if (!retry && selected.some(scope => !holds.some(hold => hold.scope === scope.path))) throw new Error("Selected scope has no target hold");
      const evidence = outsideProof(root, request, source.observation.scopes, [target]);
      const document = JSON.parse(fs.readFileSync(evidence.evidence_ref, "utf8"));
      if (document.schema !== 1 || document.action !== "resolve-observation" || document.user_authorized !== true ||
          !equal(document.source, { id, owner: request.owner, expected_revision: request.expected_revision }) || !equal(document.target, targetBinding) || !equal(document.paths, request.paths) ||
          !Array.isArray(document.entries) || document.entries.length !== selected.length || new Set(document.entries.map(entry => entry.path)).size !== selected.length ||
          document.entries.some(entry => !request.paths.includes(entry.path) || entry.consumers_released !== true || entry.producer_stopped_verified !== true || entry.generated !== true || entry.protection_known !== true || typeof entry.generation_basis !== "string" || !entry.generation_basis.trim())) throw new Error("Invalid observation resolution evidence binding");
      const records = catalog(root), consumers = records.filter(record => record.references.some(ref => ref.id === id));
      const exclusions = request.consumer_exclusions ?? [];
      if (!Array.isArray(exclusions) || !equal(exclusions, document.consumer_exclusions ?? []) || exclusions.length !== consumers.length || new Set(exclusions.map(exclusion => exclusion.id)).size !== exclusions.length) throw new Error("Exact observation consumer exclusions required");
      for (const consumer of consumers) {
        const exclusion = exclusions.find(value => value.id === consumer.id);
        const reference_ids = consumer.references.filter(ref => ref.id === id).map(referenceIdentity).sort();
        if (!exclusion || exclusion.owner !== consumer.owner || exclusion.expected_revision !== consumer.revision || !equal(exclusion.paths, request.paths) ||
            !Array.isArray(exclusion.reference_ids) || !equal([...exclusion.reference_ids].sort(), reference_ids)) throw new Error("Observation consumer requires exact owner exclusion");
        outsideProof(root, exclusion, source.observation.scopes, [target]);
      }
      if (retry) {
        if (holds.length || !equal(retry.target, targetBinding) || !equal(retry.paths, request.paths)) throw new Error("Conflicting observation resolution retry");
        return source;
      }
      const removed = new Set(holds.map(hold => hold.reference_id));
      source.references = source.references.filter(ref => !removed.has(ref.reference_id));
      source.observation.holds = source.observation.holds.filter(hold => !removed.has(hold.reference_id));
      source.observation.resolutions.push(...selected.map(scope => ({ scope: scope.path, target: targetBinding, request_sha256: identity, ...evidence })));
      source.observation.resolution_receipts = [...(source.observation.resolution_receipts || []), { request_sha256: identity, target: targetBinding, paths: request.paths, removed_holds: holds, ...evidence }];
      checkTarget(); outsideProof(root, request, source.observation.scopes, [target]);
      for (const exclusion of exclusions) outsideProof(root, exclusion, source.observation.scopes, [target]);
      if (!rawRecord(root, id).equals(raw)) throw new Error("Observation source changed before resolution");
      source.revision++;
      return publish(root, source);
    });
  }
  return { validateObservation, views, observationCatalog, protectOwner, isUnclassifiedCustody, recordObservation, migrateObservation, resolveObservation };
}
module.exports = { createObservationApi };

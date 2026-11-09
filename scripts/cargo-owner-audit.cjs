"use strict";

// Metadata-only queue for investigation. Age never establishes safe deletion.
const fs = require("node:fs");
const path = require("node:path");
const lifecycle = require("./artifact-lifecycle.cjs");
const { inspectTargetOwner } = require("./cargo-target-owner.cjs");
const identity = value => process.platform === "win32" ? value.toLowerCase() : value;
function inside(parent, child) {
  const relative = path.relative(identity(parent), identity(child));
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}
function plain(root, filename) {
  if (typeof filename !== "string" || !path.isAbsolute(filename) || filename.split(/[\\/]/).includes("..") || !inside(root, filename)) throw Error("Cargo path outside canonical project bounds");
  for (let current = path.resolve(filename); ; current = path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) throw Error("Linked Cargo path"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (current === path.dirname(current)) break;
  }
  return path.resolve(filename);
}
function presence(root, filename) {
  try {
    plain(root, filename);
    const stat = fs.lstatSync(filename);
    return { status: "present", type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other" };
  } catch (error) {
    return error.code === "ENOENT" ? { status: "absent" } : { status: "uncertain", reason: error.message };
  }
}
const timestampNames = ["preparingUtc", "startedUtc", "lastProgressUtc", "spawnAttemptedUtc", "resultObservedUtc"];
function age(owner, updated, nowMs, hours) {
  const timestamps = Object.fromEntries(timestampNames.filter(name => owner?.[name] != null).map(name => [name, owner[name]]));
  const fallback = Object.keys(timestamps).length === 0;
  const candidates = fallback ? { updated_at: updated } : timestamps;
  const errors = [];
  if (!Number.isFinite(nowMs)) errors.push("clock-invalid");
  const times = [];
  for (const [name, value] of Object.entries(candidates)) {
    const parsed = typeof value === "string" && value.trim() ? Date.parse(value) : NaN;
    if (!Number.isFinite(parsed)) errors.push(`${name}:${value == null ? "missing" : "invalid"}`);
    else if (Number.isFinite(nowMs) && parsed > nowMs) errors.push(`${name}:future`);
    else times.push([name, parsed]);
  }
  times.sort((a, b) => b[1] - a[1]);
  const selected = times[0];
  const elapsed = errors.length || !selected ? null : (nowMs - selected[1]) / 3600000;
  return { timestamps, source: selected?.[0] || (fallback ? "updated_at" : null),
    timestamp: selected ? new Date(selected[1]).toISOString() : null,
    legacy_uncertain: fallback, fallback: fallback ? "lifecycle.updated_at (not producer progress)" : null,
    hours: elapsed, eligible: elapsed !== null && elapsed > hours, errors };
}
function inspect(root, targetDirectory) {
  const memberPresence = presence(root, targetDirectory);
  if (memberPresence.status !== "present" || memberPresence.type !== "directory") return { targetDirectory, presence: memberPresence, status: memberPresence.status === "absent" ? "target-absent" : "uncertain" };
  try {
    const result = inspectTargetOwner({ targetDirectory: plain(root, targetDirectory) });
    if (!inside(root, result.targetDirectory)) throw Error("Cargo target resolved outside canonical project bounds");
    if (!result.exists) return { targetDirectory, presence: memberPresence, status: "no-lease" };
    const owner = result.owner;
    if (!owner || owner.schema !== 1 || typeof owner.token !== "string" || !owner.token ||
        typeof owner.targetDirectory !== "string" || identity(owner.targetDirectory) !== identity(result.targetDirectory) ||
        owner.targetIdentity !== identity(result.targetDirectory) || !["running", "unknown", "interrupted", "not-started", "success", "failed"].includes(owner.status)) throw Error("Corrupt Cargo owner metadata");
    return { targetDirectory, presence: memberPresence, status: "lease-present", owner_status: owner.status,
      token: result.token, ownerSha256: result.ownerSha256, run: owner.run ?? null,
      coordinatorPid: owner.coordinatorPid ?? null, producerPid: owner.producerPid ?? null,
      phase: owner.phase ?? null, producerStarted: owner.producerStarted ?? null,
      ...Object.fromEntries(timestampNames.map(name => [name, owner[name] ?? null])) };
  } catch (error) { return { targetDirectory, presence: memberPresence, status: "uncertain", reason: error.message }; }
}
function cargoMember(member) {
  return ["cargo-cache", "cargo-target", "target", "pending"].includes(member.role) || /(?:^|[\\/])(?:cache[\\/]cargo|codex-rs[\\/]target)(?:[\\/]|$)/.test(member.path);
}
function targetPath(member) {
  // A shared-cache entry owns its identity marker and target subdirectory.
  // Do not interpret the cache entry itself as a Cargo target.
  return member.role === "cargo-cache" || /[\\/]cache[\\/]cargo[\\/][^\\/]+$/.test(member.path)
    ? path.join(member.path, "target") : member.path;
}
function cacheIdentity(root, members) {
  return members.filter(member => member.role === "cargo-cache").map(member => {
    try {
      const filename = plain(root, path.join(member.path, "identity.json"));
      const stat = fs.lstatSync(filename);
      if (!stat.isFile() || stat.nlink !== 1) throw Error("Identity must be an unlinked regular file");
      const value = JSON.parse(fs.readFileSync(filename, "utf8"));
      if (!value || value.schema !== 1 || !["platform", "arch", "target"].every(key => typeof value[key] === "string" && value[key]) ||
          !value.tools || !["rustc", "cargo"].every(key => typeof value.tools[key] === "string" && value.tools[key]) ||
          !Array.isArray(value.configuration) || value.configuration.some(entry => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !/^[a-f0-9]{64}$/.test(entry[1])) ||
          !value.flags || typeof value.flags !== "object" || Array.isArray(value.flags) || Object.values(value.flags).some(flag => typeof flag !== "string") ||
          (value.scope !== undefined && (typeof value.scope !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.scope)))) throw Error("Invalid Cargo cache identity");
      return { status: value.scope === undefined ? "legacy" : "scoped", scope: value.scope ?? null, identity: value };
    } catch (error) { return { status: error.code === "ENOENT" ? "missing" : "invalid", scope: null, identity: null, reason: error.message }; }
  });
}
// Native sizes are cached logical measurements, never current allocation or reclaim estimates.
function cacheMembers(record) {
  return record.owner === "cargo-shared-cache" ? record.members.filter(member => member.role === "cargo-cache") : [];
}
function inventoryIndex(root, input, records) {
  const errors = [], items = new Map(), paths = new Set(), ids = new Set(), offsets = new Set();
  const accounted = new Set(records.flatMap(record => cacheMembers(record).map(member => JSON.stringify([record.id, identity(path.resolve(member.path))]))));
  const pages = Array.isArray(input) ? input : [input];
  let expectedOffset = 0, total;
  if (!pages.length) errors.push("inventory-pages-missing");
  for (const page of pages) {
    const pagination = page?.pagination;
    if (!page || typeof page.project_root !== "string" || identity(path.resolve(page.project_root)) !== identity(root) || !path.isAbsolute(page.project_root)) errors.push("inventory-project-root-invalid");
    if (!Array.isArray(page?.items) || !pagination || ![pagination.offset, pagination.total, pagination.limit].every(Number.isSafeInteger) ||
        pagination.offset !== expectedOffset || pagination.total < 0 || pagination.limit <= 0 || pagination.offset < 0 ||
        page.items.length > pagination.limit || pagination.offset + page.items.length > pagination.total || (total !== undefined && total !== pagination.total)) {
      errors.push("inventory-pagination-incomplete-or-invalid");
      continue;
    }
    total = pagination.total;
    if (offsets.has(pagination.offset)) errors.push("inventory-page-duplicate");
    offsets.add(pagination.offset);
    expectedOffset += page.items.length;
    for (const item of page.items) {
      if (!item || typeof item.id !== "string" || !item.id ||
          typeof item.path !== "string" || !path.isAbsolute(item.path) || !inside(root, item.path) || item.path.split(/[\\/]/).includes("..")) {
        errors.push("inventory-item-invalid"); continue;
      }
      const memberPath = identity(path.resolve(item.path)), key = JSON.stringify([item.lifecycle_group_id, memberPath]);
      if (!accounted.has(key)) continue;
      if (items.has(key) || paths.has(memberPath) || ids.has(item.id)) errors.push("inventory-item-duplicate");
      else items.set(key, item);
      paths.add(memberPath); ids.add(item.id);
    }
  }
  if (total === undefined || expectedOffset !== total) errors.push("inventory-pages-incomplete");
  return { items, errors: [...new Set(errors)] };
}
function groupCapacity(record, index) {
  const errors = [], seen = new Set();
  let bytes = 0, excluded = 0;
  const members = cacheMembers(record);
  if (!members.length) return { status: "not-accounted", reason: "not-a-canonical-shared-cache-entry", cached_logical_bytes: null, excluded_member_count: 0, errors: [] };
  for (const member of members) {
    const key = JSON.stringify([record.id, identity(path.resolve(member.path))]);
    if (seen.has(key)) { errors.push("catalog-member-duplicate"); continue; }
    seen.add(key);
    const item = index.items.get(key);
    if (!item) { errors.push("member-measurement-missing"); continue; }
    if (item.remaining === false || item.cleanup_status === "deleted" || item.presence === "absent") { excluded++; continue; }
    if (item.presence !== "present" || item.remaining !== true || !Number.isSafeInteger(item.logical_bytes) || item.logical_bytes < 0 ||
        !Number.isSafeInteger(item.measured_at_ms) || item.measured_at_ms < 0) { errors.push("member-measurement-invalid-or-uncertain"); continue; }
    bytes += item.logical_bytes;
    if (!Number.isSafeInteger(bytes)) errors.push("measurement-total-overflow");
  }
  return { status: index.errors.length || errors.length ? "uncertain" : "complete", cached_logical_bytes: Number.isSafeInteger(bytes) ? bytes : null,
    excluded_member_count: excluded, errors: [...new Set(errors)] };
}
function auditCargoOwners({ projectRoot, olderThanHours, targetDirectories = [], now = new Date(), inventoryPages, capacityBudgetBytes }) {
  if (typeof projectRoot !== "string" || !path.isAbsolute(projectRoot)) throw Error("Absolute projectRoot required");
  if (typeof olderThanHours !== "number" || !Number.isFinite(olderThanHours) || olderThanHours <= 0) throw Error("Explicit positive olderThanHours required");
  if (!Array.isArray(targetDirectories) || targetDirectories.some(value => typeof value !== "string" || !path.isAbsolute(value))) throw Error("Explicit absolute Cargo targets required");
  if ((inventoryPages === undefined) !== (capacityBudgetBytes === undefined) || (capacityBudgetBytes !== undefined && (!Number.isSafeInteger(capacityBudgetBytes) || capacityBudgetBytes <= 0))) throw Error("Inventory pages and explicit positive safe-integer capacityBudgetBytes required together");
  const nowMs = now instanceof Date ? now.getTime() : NaN;
  const report = { schema: 1, projectRoot: path.resolve(projectRoot), olderThanHours,
    observedAt: Number.isFinite(nowMs) ? now.toISOString() : null, errors: [], records: [], additional_targets: [], deletion_authorized: false };
  let records;
  try {
    plain(report.projectRoot, report.projectRoot);
    report.projectRoot = fs.realpathSync.native(report.projectRoot);
    records = lifecycle.withCatalogLock(report.projectRoot, () => lifecycle.catalog(report.projectRoot), { operation: "cargo-owner-audit.observe" });
  } catch (error) { report.errors.push(`catalog-uncertain: ${error.message}`); return report; }
  if (!Number.isFinite(nowMs)) report.errors.push("clock-invalid");
  const inventory = inventoryPages === undefined ? null : inventoryIndex(report.projectRoot, inventoryPages, records);
  if (inventory) {
    const roots = records.flatMap(record => cacheMembers(record).map(member => member.path));
    if (roots.some((entry, index) => roots.slice(index + 1).some(other => inside(entry, other) || inside(other, entry)))) inventory.errors.push("cache-entry-roots-overlap");
  }
  if (inventory) report.capacity = { status: "uncertain", budget_bytes: capacityBudgetBytes, measurement: "cached-logical-bytes",
    physical_bytes: null, reclaimable_bytes: null, cached_logical_bytes: null, budget_assessment: "uncertain", errors: inventory.errors,
    retirement_review_candidates: [], fresh_native_review_required: true, deletion_authorized: false };
  report.additional_targets = [...new Set(targetDirectories)].map(targetDirectory => {
    const target = inspect(report.projectRoot, targetDirectory);
    return { ...target, age: age(target.status === "lease-present" ? target : null, null, nowMs, olderThanHours),
      investigation_required: true, deletion_authorized: false };
  });
  for (const record of records) {
    if (!["cargo-shared-cache", "cargo-target-owner"].includes(record.owner) && !/cargo/i.test(record.id)) continue;
    const selected = record.members.filter(cargoMember);
    if (!selected.length && !["cargo-shared-cache", "cargo-target-owner"].includes(record.owner)) continue;
    const members = selected.map(member => ({ path: member.path, role: member.role, presence: presence(report.projectRoot, member.path) }));
    const targets = [...new Set(selected.filter(member => member.role !== "pending").map(targetPath))].map(target => inspect(report.projectRoot, target));
    for (const target of targets) target.age = age(target.status === "lease-present" ? target : null, record.updated_at, nowMs, olderThanHours);
    const recordAge = age(null, record.updated_at, nowMs, olderThanHours);
    const inbound = records.filter(other => other.references.some(ref => ref.id === record.id)).length;
    report.records.push({ id: record.id, owner: record.owner, generation: record.generation ?? null, revision: record.revision,
      state: record.state, membership_complete: record.membership_complete, producer: record.producer ? { status: record.producer.status, outcome: record.producer.outcome, exit_code: record.producer.exit_code } : null,
      cache_identities: cacheIdentity(report.projectRoot, selected),
      members, omitted_member_count: record.members.length - selected.length, targets,
      target_association: targets.length ? "catalog-member" : "unavailable", age: recordAge,
      age_eligible: targets.length ? targets.some(target => target.age.eligible) : recordAge.eligible,
      termination: { investigation_required: !record.producer || record.producer.status !== "stopped" || record.producer.outcome === "unknown" || targets.some(target => ["lease-present", "uncertain"].includes(target.status)) },
      references: { investigation_required: true, outgoing_count: record.references.length, inbound_record_count: inbound },
      investigation_required: true, deletion_authorized: false });
    if (inventory) {
      const row = report.records[report.records.length - 1];
      row.capacity = groupCapacity(record, inventory);
      const blockers = [];
      if (!record.producer || record.producer.status !== "stopped" || !["success", "failure"].includes(record.producer.outcome)) blockers.push("producer-not-known-stopped");
      if (!record.membership_complete) blockers.push("membership-incomplete");
      if (record.references.length || inbound) blockers.push("references-present");
      if (!targets.length || targets.some(target => !["no-lease", "target-absent"].includes(target.status))) blockers.push("lease-or-target-uncertain");
      if (record.members.some(member => member.generated !== true || member.protection_known !== true || presence(report.projectRoot, member.path).status !== "present")) blockers.push("member-not-present-generated-and-protection-known");
      if (row.capacity.status !== "complete" || row.capacity.excluded_member_count) blockers.push("capacity-uncertain-or-excluded");
      if (!row.cache_identities.length || row.cache_identities.some(value => !["scoped", "legacy"].includes(value.status))) blockers.push("cache-identity-missing-or-invalid");
      row.capacity.retirement_review = { eligible: blockers.length === 0, blockers, fresh_native_review_required: true, deletion_authorized: false };
    }
  }
  if (inventory) {
    const summary = report.capacity;
    const bytes = report.records.reduce((sum, row) => sum + (row.capacity.cached_logical_bytes ?? 0), 0);
    const complete = !inventory.errors.length && Number.isSafeInteger(bytes) && report.records.every(row => ["complete", "not-accounted"].includes(row.capacity.status));
    summary.status = complete ? "complete" : "uncertain";
    summary.cached_logical_bytes = Number.isSafeInteger(bytes) && !inventory.errors.includes("cache-entry-roots-overlap") ? bytes : null;
    summary.budget_assessment = complete ? bytes > capacityBudgetBytes ? "over-cached-logical-budget" : "within-cached-logical-budget" : "uncertain";
    for (const row of report.records) {
      const review = row.capacity.retirement_review;
      review.review_reasons = [...(row.age_eligible ? ["older-than-requested-threshold"] : []), ...(complete && bytes > capacityBudgetBytes ? ["over-cached-logical-budget"] : [])];
      if (!review.review_reasons.length) { review.eligible = false; review.blockers.push("no-age-or-budget-review-reason"); }
    }
    summary.retirement_review_candidates = report.records.filter(row => row.capacity.retirement_review.eligible)
      .sort((a, b) => b.capacity.cached_logical_bytes - a.capacity.cached_logical_bytes || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(row => ({ id: row.id, cached_logical_bytes: row.capacity.cached_logical_bytes, review_reasons: row.capacity.retirement_review.review_reasons, fresh_native_review_required: true, deletion_authorized: false }));
    if (!complete) report.errors.push("capacity-uncertain");
  }
  return report;
}
module.exports = { auditCargoOwners };
if (require.main === module) {
  try {
    const args = process.argv.slice(2), options = {}, targetDirectories = [];
    for (let i = 0; i < args.length; i += 2) {
      if (args[i] === "--target-directory" && args[i + 1]) { targetDirectories.push(args[i + 1]); continue; }
      if (!["--project-root", "--older-than-hours", "--inventory", "--capacity-budget-bytes"].includes(args[i]) || !args[i + 1] || Object.hasOwn(options, args[i])) throw Error("Usage: cargo-owner-audit --project-root ABS --older-than-hours POSITIVE [--inventory FILE --capacity-budget-bytes POSITIVE]");
      options[args[i]] = args[i + 1];
    }
    const report = auditCargoOwners({ projectRoot: options["--project-root"], olderThanHours: Number(options["--older-than-hours"]), targetDirectories,
      inventoryPages: options["--inventory"] === undefined ? undefined : JSON.parse(fs.readFileSync(options["--inventory"], "utf8")),
      capacityBudgetBytes: options["--capacity-budget-bytes"] === undefined ? undefined : Number(options["--capacity-budget-bytes"]) });
    console.log(JSON.stringify(report));
    if (report.errors.length) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

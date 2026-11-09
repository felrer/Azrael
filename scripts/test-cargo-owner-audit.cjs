"use strict";

// Retained contract: old metadata queues investigation without mutating ownership.
// The enclosing artifact-owned test run owns and removes this entire fixture root.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const lifecycle = require("./artifact-lifecycle.cjs");
const { auditCargoOwners } = require("./cargo-owner-audit.cjs");
const defaultRun = process.env.AZRAEL_CARGO_AUDIT_TEST_ROOT ? null : require("./artifact-run.cjs").beginArtifactRun(path.resolve(__dirname, ".."), { workId: "cargo-owner-audit-tests", owner: "cargo-owner-audit-tests" });
const fixture = process.env.AZRAEL_CARGO_AUDIT_TEST_ROOT || defaultRun.temporary;
assert.ok(fixture && path.isAbsolute(fixture), "Artifact-owned AZRAEL_CARGO_AUDIT_TEST_ROOT required");
fs.mkdirSync(fixture, { recursive: true });
const root = fs.mkdtempSync(path.join(fixture, "audit-"));
require("node:test").after(() => {
  const fixtureLink = path.join(root, "artifacts/targets/linked-lease/.azrael-cargo-owner");
  if (fs.existsSync(fixtureLink)) {
    assert.ok(fs.lstatSync(fixtureLink).isSymbolicLink());
    assert.equal(fs.realpathSync.native(fixtureLink), fs.realpathSync.native(path.join(root, "artifacts/lease-destination")));
    if (process.platform === "win32") fs.rmdirSync(fixtureLink); else fs.unlinkSync(fixtureLink);
    assert.equal(fs.existsSync(fixtureLink), false);
  }
  if (defaultRun) {
    fs.rmSync(root, { recursive: true });
    assert.equal(fs.existsSync(root), false);
  }
});
const registry = path.join(root, "artifacts/maintenance/lifecycles");
fs.mkdirSync(registry, { recursive: true });
const now = new Date("2026-10-28T12:00:00.000Z"), old = "2026-10-26T12:00:00.000Z";
function record(name, options = {}) {
  const target = path.join(root, "artifacts", "targets", name);
  const value = { schema: 1, id: `cargo:${name}`, kind: "work", owner: "cargo-target-owner", state: "pending",
    generation: name, revision: 1, membership_complete: false,
    members: [{ role: "cargo-target", path: target, generated: true, protection_known: true }],
    references: [], created_at: old, updated_at: old, ...options };
  const filename = path.join(registry, crypto.createHash("sha256").update(value.id).digest("hex") + ".json");
  fs.writeFileSync(filename, JSON.stringify(value));
  return { value, target, filename };
}
function lease(row, options = {}) {
  const directory = path.join(row.target, ".azrael-cargo-owner");
  fs.mkdirSync(directory, { recursive: true });
  const owner = { schema: 1, token: row.value.generation, targetDirectory: row.target,
    targetIdentity: process.platform === "win32" ? row.target.toLowerCase() : row.target,
    status: "running", phase: "preparing", preparingUtc: old, startedUtc: old, lastProgressUtc: old,
    producerStarted: null, ...options };
  const filename = path.join(directory, "owner.json");
  fs.writeFileSync(filename, JSON.stringify(owner));
  return filename;
}
const pending = record("old-pending");
lease(pending);
const cutoff = record("cutoff");
lease(cutoff, { lastProgressUtc: "2026-10-27T12:00:00.000Z" });
const future = record("future");
lease(future, { lastProgressUtc: "2026-10-29T12:00:00.000Z" });
const invalid = record("invalid");
lease(invalid, { startedUtc: "not-a-time" });
const missing = record("missing", { updated_at: null });
const noLease = record("no-lease");
fs.mkdirSync(noLease.target, { recursive: true });
const absent = record("absent");
const pendingOnlyPath = path.join(root, "artifacts/verification/cargo-pending/only");
record("pending-only", { members: [{ role: "pending", path: pendingOnlyPath, generated: true, protection_known: true }] });
const cachePath = path.join(root, "artifacts/cache/cargo/key");
const cache = record("cache", { owner: "cargo-shared-cache", members: [{ role: "cargo-cache", path: cachePath, generated: true, protection_known: true }] });
cache.target = path.join(cachePath, "target");
lease(cache);
const corrupt = record("corrupt");
const corruptFile = lease(corrupt);
fs.writeFileSync(corruptFile, "{broken");
const unreadable = record("unreadable");
const unreadableFile = lease(unreadable);
const terminal = { status: "stopped", outcome: "success", exit_code: 0, reason: "fixture close",
  evidence_ref: path.join(root, "artifacts/maintenance/evidence.json"), evidence_sha256: "a".repeat(64) };
record("complete", { state: "complete", membership_complete: true, producer: terminal });
record("unknown", { producer: { ...terminal, outcome: "unknown", exit_code: null } });
record("unrelated", { id: "unrelated", owner: "unrelated", members: [{ role: "log", path: path.join(root, "artifacts/log") }] });
const linked = record("linked-lease");
fs.mkdirSync(linked.target, { recursive: true });
const linkDestination = path.join(root, "artifacts", "lease-destination");
fs.mkdirSync(linkDestination, { recursive: true });
// A directory junction works without Windows Developer Mode privileges.
fs.symlinkSync(linkDestination, path.join(linked.target, ".azrael-cargo-owner"), process.platform === "win32" ? "junction" : "dir");
// Read custody may maintain its catalog.lock sentinel; ownership JSON must stay byte-identical.
const recordBytes = () => fs.readdirSync(registry).filter(name => name.endsWith(".json")).sort()
  .map(name => [name, fs.readFileSync(path.join(registry, name), "utf8")]);
const bytesBefore = recordBytes();
const leaseBefore = fs.readFileSync(path.join(pending.target, ".azrael-cargo-owner/owner.json"), "utf8");
const originalRead = fs.readFileSync;
let report;
try {
  fs.readFileSync = function(filename, ...args) {
    if (path.resolve(String(filename)) === unreadableFile) throw Object.assign(Error("fixture unreadable owner"), { code: "EACCES" });
    return originalRead.call(this, filename, ...args);
  };
  report = auditCargoOwners({ projectRoot: root, olderThanHours: 24, now });
} finally { fs.readFileSync = originalRead; }
assert.deepEqual(report.errors, []);
const row = name => report.records.find(value => value.id === `cargo:${name}`);
assert.equal(row("old-pending").age_eligible, true);
assert.equal(row("old-pending").targets[0].phase, "preparing");
assert.equal(row("old-pending").targets[0].producerStarted, null);
assert.equal(row("old-pending").termination.investigation_required, true);
assert.equal(row("cutoff").age_eligible, false, "Exactly the cutoff is not older than it");
assert.equal(row("future").age_eligible, false);
assert.ok(row("future").targets[0].age.errors.includes("lastProgressUtc:future"));
assert.equal(row("invalid").age_eligible, false);
assert.ok(row("invalid").targets[0].age.errors.includes("startedUtc:invalid"));
assert.ok(row("missing").age.errors.includes("updated_at:missing"));
assert.equal(row("no-lease").targets[0].status, "no-lease");
assert.equal(row("absent").targets[0].status, "target-absent");
assert.equal(row("absent").age.legacy_uncertain, true);
assert.equal(row("pending-only").target_association, "unavailable");
assert.equal(row("pending-only").age_eligible, true);
assert.equal(row("cache").targets[0].targetDirectory, cache.target);
assert.equal(row("cache").targets[0].status, "lease-present");
for (const name of ["corrupt", "unreadable", "linked-lease"]) assert.equal(row(name).targets[0].status, "uncertain", name);
assert.equal(row("complete").termination.investigation_required, false);
assert.equal(row("unknown").termination.investigation_required, true);
assert.ok(report.records.every(value => value.deletion_authorized === false && value.references.investigation_required));
assert.equal(report.records.some(value => value.id === "unrelated"), false);
assert.deepEqual(recordBytes(), bytesBefore);
assert.equal(fs.readFileSync(path.join(pending.target, ".azrael-cargo-owner/owner.json"), "utf8"), leaseBefore);
assert.equal(fs.existsSync(absent.target), false);
assert.ok(auditCargoOwners({ projectRoot: root, olderThanHours: 24, now: new Date(NaN) }).errors.includes("clock-invalid"));
for (const olderThanHours of [undefined, 0, -1, Infinity, NaN]) assert.throws(() => auditCargoOwners({ projectRoot: root, olderThanHours }), /positive/);
const cli = spawnSync(process.execPath, [path.join(__dirname, "cargo-owner-audit.cjs"), "--project-root", root, "--older-than-hours", "24"], { encoding: "utf8", windowsHide: true });
assert.equal(cli.status, 0, cli.stderr);
assert.equal(JSON.parse(cli.stdout).deletion_authorized, false);
const noAge = spawnSync(process.execPath, [path.join(__dirname, "cargo-owner-audit.cjs"), "--project-root", root], { encoding: "utf8", windowsHide: true });
assert.equal(noAge.status, 1);
assert.equal(noAge.stdout, "");
const unavailable = spawnSync(process.execPath, [path.join(__dirname, "cargo-owner-audit.cjs"), "--project-root", path.join(root, "missing-project"), "--older-than-hours", "24"], { encoding: "utf8", windowsHide: true });
assert.equal(unavailable.status, 1);
assert.ok(JSON.parse(unavailable.stdout).errors.some(error => error.startsWith("catalog-uncertain:")));
console.log("Cargo owner audit behavioral contracts passed");
const extra = auditCargoOwners({ projectRoot: root, olderThanHours: 24, now,
  targetDirectories: [pending.target, absent.target, path.resolve(root, "..", "outside")] });
assert.equal(extra.additional_targets[0].status, "lease-present");
assert.equal(extra.additional_targets[0].token, pending.value.generation);
assert.match(extra.additional_targets[0].ownerSha256, /^[a-f0-9]{64}$/);
assert.equal(extra.additional_targets[1].status, "target-absent");
assert.equal(extra.additional_targets[2].status, "uncertain");
assert.ok(extra.additional_targets.every(target => target.deletion_authorized === false));

// Retain these cases against later simplification of partial-size and protection guards.
const cacheMetadata = { schema: 1, platform: process.platform, arch: process.arch, target: "fixture-target", tools: { rustc: "fixture", cargo: "fixture" }, configuration: [], flags: {} };
function reviewCache(name, options = {}) {
  const entry = path.join(root, "artifacts/cache/cargo", name);
  const result = record(name, { state: "complete", membership_complete: true, producer: terminal, owner: "cargo-shared-cache",
    members: [{ path: entry, role: "cargo-cache", generated: true, protection_known: true }], ...options });
  result.target = entry;
  fs.mkdirSync(entry, { recursive: true });
  fs.writeFileSync(path.join(entry, "identity.json"), JSON.stringify(cacheMetadata));
  return result;
}
const ready = reviewCache("review-ready");
fs.mkdirSync(ready.target, { recursive: true });
const referred = reviewCache("review-referred");
fs.mkdirSync(referred.target, { recursive: true });
record("review-consumer", { references: [{ id: referred.value.id, reason: "fixture consumer" }] });
const outgoing = reviewCache("review-outgoing", {
  references: [{ id: ready.value.id, reason: "fixture outgoing" }] });
fs.mkdirSync(outgoing.target, { recursive: true });
const unprotected = reviewCache("review-unprotected", {
  members: [{ path: path.join(root, "artifacts/cache/cargo/review-unprotected"), role: "cargo-cache", generated: true, protection_known: false }] });
fs.mkdirSync(unprotected.target, { recursive: true });
const eligible = reviewCache("review-eligible");
fs.mkdirSync(eligible.target, { recursive: true });
const liveReview = reviewCache("review-live");
liveReview.target = path.join(liveReview.target, "target");
lease(liveReview);
const unknownReview = reviewCache("review-unknown", { producer: { ...terminal, outcome: "unknown", exit_code: null } });
fs.mkdirSync(unknownReview.target, { recursive: true });
const all = lifecycle.catalog(root);
const items = all.flatMap(group => group.members.map((member, index) => ({ id: `${group.id}:${index}`, lifecycle_group_id: group.id,
  path: member.path, logical_bytes: 10, measured_at_ms: now.getTime(), presence: fs.existsSync(member.path) ? "present" : "absent",
  remaining: fs.existsSync(member.path) })));
const measuredEligible = items.find(item => item.lifecycle_group_id === eligible.value.id);
const inventoryPage = entries => ({ project_root: root, items: entries, pagination: { offset: 0, limit: Math.max(1, entries.length), total: entries.length } });
const capacityAudit = (inventoryPages = inventoryPage(items), capacityBudgetBytes = 1) => auditCargoOwners({ projectRoot: root, olderThanHours: 24, now, inventoryPages, capacityBudgetBytes });
const capacity = capacityAudit();
assert.equal(capacity.capacity.status, "complete");
assert.equal(capacity.capacity.budget_assessment, "over-cached-logical-budget");
assert.equal(capacity.capacity.physical_bytes, null);
assert.equal(capacity.capacity.reclaimable_bytes, null);
assert.deepEqual(capacity.capacity.retirement_review_candidates.map(value => value.id), [eligible.value.id]);
assert.ok(capacity.records.find(value => value.id === liveReview.value.id).capacity.retirement_review.blockers.includes("lease-or-target-uncertain"));
assert.ok(capacity.records.find(value => value.id === unknownReview.value.id).capacity.retirement_review.blockers.includes("producer-not-known-stopped"));
assert.ok(capacity.records.every(value => !value.deletion_authorized && !value.capacity.retirement_review.deletion_authorized));
assert.equal(capacity.records.find(value => value.id === cache.value.id).cache_identities[0].status, "missing");
const within = capacityAudit(inventoryPage(items), Number.MAX_SAFE_INTEGER);
assert.equal(within.capacity.budget_assessment, "within-cached-logical-budget");
assert.deepEqual(within.capacity.retirement_review_candidates.map(value => value.id), [eligible.value.id]);
assert.deepEqual(within.capacity.retirement_review_candidates[0].review_reasons, ["older-than-requested-threshold"]);
const freshUnderBudget = auditCargoOwners({ projectRoot: root, olderThanHours: 240, now, inventoryPages: inventoryPage(items), capacityBudgetBytes: Number.MAX_SAFE_INTEGER });
assert.deepEqual(freshUnderBudget.capacity.retirement_review_candidates, []);
const partial = inventoryPage(items.slice(1)); partial.pagination.total = items.length;
const invalidInputs = [partial, [inventoryPage(items), inventoryPage(items)],
  inventoryPage([...items, { ...measuredEligible, id: "duplicate-member" }]),
  { ...inventoryPage(items), project_root: path.dirname(root) },
  inventoryPage(items.map(item => item.lifecycle_group_id === eligible.value.id ? { ...item, logical_bytes: null } : item)),
  inventoryPage(items.filter(item => item.lifecycle_group_id !== eligible.value.id))];
for (const input of invalidInputs) {
  const uncertain = capacityAudit(input, Number.MAX_SAFE_INTEGER);
  assert.equal(uncertain.capacity.status, "uncertain");
  assert.equal(uncertain.capacity.budget_assessment, "uncertain");
  assert.ok(uncertain.errors.includes("capacity-uncertain"));
}
const duplicated = capacityAudit(inventoryPage([...items, { ...measuredEligible, id: "duplicate-member" }]));
assert.equal(duplicated.capacity.cached_logical_bytes, capacity.capacity.cached_logical_bytes, "Duplicate measurements cannot inflate totals");
const split = Math.floor(items.length / 2);
const pages = [{ ...inventoryPage(items.slice(0, split)), pagination: { offset: 0, limit: split, total: items.length } },
  { ...inventoryPage(items.slice(split)), pagination: { offset: split, limit: items.length, total: items.length } }];
assert.equal(capacityAudit(pages).capacity.cached_logical_bytes, capacity.capacity.cached_logical_bytes);
assert.equal(capacityAudit(pages).capacity.status, "complete");
for (const capacityBudgetBytes of [0, -1, Infinity, NaN, 1.5]) assert.throws(() => capacityAudit(inventoryPage(items), capacityBudgetBytes), /positive/);
assert.throws(() => auditCargoOwners({ projectRoot: root, olderThanHours: 24, inventoryPages: inventoryPage(items) }), /together/);
const marker = path.join(cachePath, "identity.json");
fs.writeFileSync(marker, JSON.stringify(cacheMetadata));
const cacheStatus = () => auditCargoOwners({ projectRoot: root, olderThanHours: 24, now }).records.find(value => value.id === cache.value.id).cache_identities[0];
assert.equal(cacheStatus().status, "legacy");
fs.writeFileSync(marker, JSON.stringify({ ...cacheMetadata, scope: "verification" }));
assert.equal(cacheStatus().status, "scoped");
assert.equal(cacheStatus().scope, "verification");
fs.writeFileSync(marker, "{broken");
assert.equal(cacheStatus().status, "invalid");
const nativeUnrelated = { id: "native-ungrouped", lifecycle_group_id: null, path: path.join(root, "artifacts/unrelated-native"), logical_bytes: null };
const withUnrelated = capacityAudit(inventoryPage([...items, nativeUnrelated]));
assert.equal(withUnrelated.capacity.status, "complete");
assert.equal(withUnrelated.capacity.cached_logical_bytes, capacity.capacity.cached_logical_bytes);
const childPath = path.join(eligible.target, "target");
record("overlapping-child", { members: [{ path: childPath, role: "cargo-target", generated: true, protection_known: true }] });
const childMeasurement = { id: "native-overlapping-child", lifecycle_group_id: "cargo:overlapping-child", path: childPath,
  logical_bytes: 9999, measured_at_ms: now.getTime(), presence: "present", remaining: true };
const withChild = capacityAudit(inventoryPage([...items, childMeasurement]));
assert.equal(withChild.capacity.status, "complete");
assert.equal(withChild.capacity.cached_logical_bytes, capacity.capacity.cached_logical_bytes);
assert.equal(withChild.records.find(value => value.id === "cargo:overlapping-child").capacity.status, "not-accounted");
fs.writeFileSync(path.join(eligible.target, "identity.json"), "{broken");
const invalidIdentity = capacityAudit(inventoryPage(items));
assert.ok(invalidIdentity.records.find(value => value.id === eligible.value.id).capacity.retirement_review.blockers.includes("cache-identity-missing-or-invalid"));
assert.equal(invalidIdentity.capacity.retirement_review_candidates.some(value => value.id === eligible.value.id), false);
record("overlapping-cache", { owner: "cargo-shared-cache", members: [{ path: childPath, role: "cargo-cache", generated: true, protection_known: true }] });
const overlap = capacityAudit(inventoryPage([...items, { ...childMeasurement, id: "native-overlapping-cache", lifecycle_group_id: "cargo:overlapping-cache" }]));
assert.equal(overlap.capacity.status, "uncertain");
assert.ok(overlap.capacity.errors.includes("cache-entry-roots-overlap"));

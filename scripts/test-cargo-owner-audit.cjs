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
const bytesBefore = fs.readdirSync(registry).map(name => [name, fs.readFileSync(path.join(registry, name), "utf8")]);
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
assert.deepEqual(fs.readdirSync(registry).map(name => [name, fs.readFileSync(path.join(registry, name), "utf8")]), bytesBefore);
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

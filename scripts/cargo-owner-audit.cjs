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
function auditCargoOwners({ projectRoot, olderThanHours, targetDirectories = [], now = new Date() }) {
  if (typeof projectRoot !== "string" || !path.isAbsolute(projectRoot)) throw Error("Absolute projectRoot required");
  if (typeof olderThanHours !== "number" || !Number.isFinite(olderThanHours) || olderThanHours <= 0) throw Error("Explicit positive olderThanHours required");
  if (!Array.isArray(targetDirectories) || targetDirectories.some(value => typeof value !== "string" || !path.isAbsolute(value))) throw Error("Explicit absolute Cargo targets required");
  const nowMs = now instanceof Date ? now.getTime() : NaN;
  const report = { schema: 1, projectRoot: path.resolve(projectRoot), olderThanHours,
    observedAt: Number.isFinite(nowMs) ? now.toISOString() : null, errors: [], records: [], additional_targets: [], deletion_authorized: false };
  let records;
  try {
    plain(report.projectRoot, report.projectRoot);
    report.projectRoot = fs.realpathSync.native(report.projectRoot);
    records = lifecycle.catalog(report.projectRoot); // One bounded metadata catalog read.
  } catch (error) { report.errors.push(`catalog-uncertain: ${error.message}`); return report; }
  if (!Number.isFinite(nowMs)) report.errors.push("clock-invalid");
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
      members, omitted_member_count: record.members.length - selected.length, targets,
      target_association: targets.length ? "catalog-member" : "unavailable", age: recordAge,
      age_eligible: targets.length ? targets.some(target => target.age.eligible) : recordAge.eligible,
      termination: { investigation_required: !record.producer || record.producer.status !== "stopped" || record.producer.outcome === "unknown" || targets.some(target => ["lease-present", "uncertain"].includes(target.status)) },
      references: { investigation_required: true, outgoing_count: record.references.length, inbound_record_count: inbound },
      investigation_required: true, deletion_authorized: false });
  }
  return report;
}
module.exports = { auditCargoOwners };
if (require.main === module) {
  try {
    const args = process.argv.slice(2), options = {}, targetDirectories = [];
    for (let i = 0; i < args.length; i += 2) {
      if (args[i] === "--target-directory" && args[i + 1]) { targetDirectories.push(args[i + 1]); continue; }
      if (!["--project-root", "--older-than-hours"].includes(args[i]) || !args[i + 1] || Object.hasOwn(options, args[i])) throw Error("Usage: cargo-owner-audit --project-root ABS --older-than-hours POSITIVE");
      options[args[i]] = args[i + 1];
    }
    const report = auditCargoOwners({ projectRoot: options["--project-root"], olderThanHours: Number(options["--older-than-hours"]), targetDirectories });
    console.log(JSON.stringify(report));
    if (report.errors.length) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

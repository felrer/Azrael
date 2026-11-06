"use strict";
// Explicit abort of two identity-pinned, empty, unpublished control files.
// Catalog custody excludes supported publication, never proves an old writer stopped.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const OPERATION = "lifecycle-empty-publication-recovery";
function validateRequest(value) {
  if (!value || value.schema !== 1 || value.operation !== OPERATION || value.platform !== "win32" || value.arch !== "x64" ||
      !path.isAbsolute(value.artifactProjectRoot || "") || !path.isAbsolute(value.outputDirectory || "") ||
      value.original_writer !== "unknown" || Object.hasOwn(value, "producer_stopped_verified") ||
      typeof value.reason !== "string" || !value.reason.trim() || typeof value.runLifecycleId !== "string" || !value.runLifecycleId ||
      typeof value.owner !== "string" || !value.owner || !Number.isSafeInteger(value.caller_revision) || value.caller_revision < 1) throw Error("Exact empty-publication authority required");
  const directory = path.join(value.artifactProjectRoot, "artifacts/maintenance/lifecycles");
  if (!Array.isArray(value.entries) || value.entries.length !== 2 || new Set(value.entries.map(entry => entry?.path)).size !== 2) throw Error("Exactly two unique approved publications required");
  for (const entry of value.entries) {
    const id = entry?.identity;
    if (!entry || path.dirname(entry.path || "") !== directory || !/^[a-f0-9]{64}\.pending$/.test(path.basename(entry.path || "")) ||
        entry.sha256 !== EMPTY_SHA256 || !id || Object.keys(id).sort().join(",") !== "dev,ino,mode,nlink,size" ||
        ["dev", "ino", "mode"].some(key => !/^[0-9]+$/.test(id[key] || "")) || id.nlink !== "1" || id.size !== "0") throw Error("Identity-pinned empty publication required");
  }
  const id = value.projectIdentity;
  if (!id || Object.keys(id).sort().join(",") !== "dev,ino,mode" || Object.values(id).some(value => !/^[0-9]+$/.test(value))) throw Error("Exact project identity required");
  return value;
}
function successfulRelease(value) {
  return value?.released === true && value.native_exit_observed === true && value.native_exit_code === 0 &&
    value.native_signal === null && value.native_close_observed === true && Array.isArray(value.reservations_retained) && value.reservations_retained.length === 0;
}
module.exports = { validateRequest, successfulRelease, EMPTY_SHA256 };
module.exports.createOwner = helpers => {
  const { checked, identity, absent, sha, inside, same, windowsAttributes, evidence, writeNew, lifecycle, acquire, native, assertEnabled, workerFile } = helpers;
  function caller(request, records) {
    const current = records.find(record => record.id === request.runLifecycleId);
    if (!current || current.owner !== request.owner || current.revision !== request.caller_revision || current.kind !== "run" ||
        current.state !== "pending" || current.producer || lifecycle.cleanupReservation(request.artifactProjectRoot, current) ||
        !current.members.some(member => member.role === "reports" && inside(member.path, request.outputDirectory))) throw Error("Exact active recovery report caller required");
    return current;
  }
  function select(options) {
    if (process.platform !== "win32" || process.arch !== "x64") throw Error("Empty publication recovery is currently scoped to Windows x64");
    if (!path.isAbsolute(options.artifactProjectRoot || "")) throw Error("Absolute recovery project required");
    const root = options.artifactProjectRoot;
    checked(path.parse(root).root, root);
    const request = validateRequest(evidence(root, options.requestPath, options.requestSha256));
    same(request.artifactProjectRoot, root, "Recovery authority root changed");
    same(identity(root, "directory"), request.projectIdentity, "Recovery project identity changed");
    checked(root, request.outputDirectory); identity(request.outputDirectory, "directory");
    if (!inside(request.outputDirectory, options.requestPath)) throw Error("Recovery authority must be in caller reports");
    for (const entry of request.entries) checked(root, entry.path);
    return request;
  }
  function checkFiles(request, audit = () => {}) {
    const root = request.artifactProjectRoot, observed = [];
    same(identity(root, "directory"), request.projectIdentity, "Recovery project changed");
    windowsAttributes([...request.entries.map(entry => entry.path), request.outputDirectory], audit);
    for (const entry of request.entries) {
      checked(root, entry.path);
      same(identity(entry.path, "file"), entry.identity, "Approved pending identity changed");
      const bytes = fs.readFileSync(entry.path);
      same(identity(entry.path, "file"), entry.identity, "Approved pending changed while reading");
      if (bytes.length !== 0 || sha(bytes) !== entry.sha256 || !absent(entry.path.slice(0, -8) + ".json")) throw Error("Only empty unpublished pending may be aborted");
      observed.push({ path: entry.path, identity: entry.identity, sha256: entry.sha256, canonical_absent: true });
    }
    return observed;
  }
  function catalogFence(request) {
    const records = lifecycle.catalog(request.artifactProjectRoot);
    native.validatePublicationCatalog(request.artifactProjectRoot, request.entries, records);
    return { caller: caller(request, records), sha256: sha(JSON.stringify(records)) };
  }
  function recoveryQuiescence(request, remaining = request.entries) {
    const root = request.artifactProjectRoot, directory = checked(root, path.join(root, "artifacts/maintenance/lifecycles"));
    identity(directory, "directory");
    if (!absent(checked(root, path.join(root, "artifacts/maintenance/manifest.pending")))) throw Error("Native pending requires its existing recovery");
    const allowed = new Set(remaining.map(entry => path.basename(entry.path)));
    const pending = fs.readdirSync(directory).filter(name => /\.pending$/i.test(name));
    if (pending.length !== allowed.size || pending.some(name => !allowed.has(name))) throw Error("Unapproved lifecycle pending protects recovery");
    native.reservationRecords(root, [], { paths: [...request.entries.flatMap(entry => [entry.path, entry.path.slice(0, -8) + ".json"]), request.outputDirectory],
      ids: [request.runLifecycleId], pendingStems: request.entries.map(entry => path.basename(entry.path, ".pending")) });
  }
  function allChecks(request, fence, snapshot, audit) {
    native.verify(request.artifactProjectRoot, snapshot);
    same(catalogFence(request), fence, "Recovery caller or catalog changed");
    recoveryQuiescence(request);
    return checkFiles(request, audit);
  }
  function acquireBoth(root, command) {
    const maintenance = acquire(path.join(root, "artifacts/maintenance/maintenance.lock"), { operation: "lifecycle.empty-recovery", queue: true, drainOnly: true, command });
    let catalog = null;
    try {
      catalog = acquire(path.join(root, "artifacts/maintenance/lifecycles/catalog.lock"), { operation: "lifecycle.empty-recovery", queue: true, drainOnly: true, command });
      const locks = ["maintenance/maintenance.lock", "maintenance/lifecycles/catalog.lock"].map(relative => {
        const filename = checked(root, path.join(root, "artifacts", relative));
        return { path: filename, identity: identity(filename, "file") };
      });
      return { maintenance, catalog, locks };
    } catch (error) {
      error.release_errors = [];
      for (const [name, lease] of [["catalog", catalog], ["maintenance", maintenance]]) if (lease) {
        try {
          error[name + "_release"] = lease.release();
          if (!successfulRelease(error[name + "_release"])) throw Error("Actual release/exit/close required after acquisition failure");
        } catch (releaseError) { error.release_error ||= releaseError; error.release_errors.push({ phase: name + "-release", message: releaseError.message, lease: releaseError.lease }); }
      }
      throw error;
    }
  }
  function verifyLockPaths(leases) {
    for (const lock of leases.locks) same(identity(lock.path, "file"), lock.identity, "Recovery OS lock path identity changed");
  }
  function releaseBoth(leases, result) {
    for (const name of ["catalog", "maintenance"]) {
      try {
        result[name + "Release"] = leases[name].release();
        if (!successfulRelease(result[name + "Release"])) throw Error("Actual native release/exit/close required");
      } catch (error) {
        result.status = "unknown";
        result.errors.push({ phase: name + "-release", message: error.message, ...(error.lease ? { lease: error.lease } : {}) });
      }
    }
  }
  async function prepare(options) {
    assertEnabled("deletion");
    const request = select(options), root = request.artifactProjectRoot;
    recoveryQuiescence(request);
    checkFiles(request);
    const fence = catalogFence(request);
    const snapshot = await native.captureEmptyPublications(root, request.entries);
    const nonce = crypto.randomUUID(), prefix = path.join(request.outputDirectory, "empty-publication-recovery-" + nonce);
    const files = Object.fromEntries(["plan", "prepare", "intent", "result"].map(role => [role, prefix + "." + role + ".json"]));
    const plan = { schema: 1, operation: OPERATION, request, requestPath: options.requestPath, requestSha256: options.requestSha256, fence, snapshot, files };
    const result = { schema: 1, operation: OPERATION, status: "prepared", errors: [], catalogRelease: null, maintenanceRelease: null };
    const leases = acquireBoth(root, snapshot.command);
    try {
      verifyLockPaths(leases);
      allChecks(request, fence, snapshot);
      select(options);
    } catch (error) {
      result.status = error.lease ? "unknown" : "blocked";
      result.errors.push({ message: error.message, ...(error.lease ? { lease: error.lease } : {}) });
    } finally { releaseBoth(leases, result); }
    writeNew(files.prepare, result);
    if (result.status !== "prepared") throw Object.assign(Error("Empty publication preparation did not complete"), { recoveryPreparation: result, files });
    plan.preparationRelease = result;
    writeNew(files.plan, plan);
    return { planPath: files.plan, planSha256: sha(fs.readFileSync(files.plan)), files };
  }
  function readPlan(planPath, planSha256) {
    if (!path.isAbsolute(planPath || "")) throw Error("Absolute recovery plan required");
    const before = identity(planPath, "file");
    if (BigInt(before.size) > 1024n * 1024n) throw Error("Bounded recovery plan required");
    const bytes = fs.readFileSync(planPath);
    same(identity(planPath, "file"), before, "Recovery plan changed");
    if (!/^[a-f0-9]{64}$/.test(planSha256 || "") || sha(bytes) !== planSha256) throw Error("Recovery plan SHA changed");
    const plan = JSON.parse(bytes), request = validateRequest(plan.request);
    if (plan.schema !== 1 || plan.operation !== OPERATION) throw Error("Unsupported recovery plan");
    same(select({ artifactProjectRoot: request.artifactProjectRoot, requestPath: plan.requestPath, requestSha256: plan.requestSha256 }), request, "Recovery authority changed");
    if (Object.keys(plan.files).sort().join(",") !== "intent,plan,prepare,result" || new Set(Object.values(plan.files)).size !== 4 || plan.files.plan !== planPath ||
        Object.values(plan.files).some(file => path.dirname(checked(request.artifactProjectRoot, file)) !== request.outputDirectory)) throw Error("Exact independent recovery outputs required");
    const receiptPath = plan.files.prepare, receipt = evidence(request.artifactProjectRoot, receiptPath, sha(fs.readFileSync(receiptPath)));
    if (receipt.status !== "prepared" || !successfulRelease(receipt.catalogRelease) || !successfulRelease(receipt.maintenanceRelease)) throw Error("Prepared native caller release required");
    same(receipt, plan.preparationRelease, "Preparation release receipt changed");
    if (!absent(plan.files.intent) || !absent(plan.files.result)) throw Error("Existing recovery intent/result requires explicit recovery");
    return plan;
  }
  async function applyWorker(planPath, planSha256) {
    assertEnabled("deletion");
    const plan = readPlan(planPath, planSha256), { request, files, fence } = plan, root = request.artifactProjectRoot;
    // Before intent, requery under no exclusive custody. Never inventory while locked.
    recoveryQuiescence(request); checkFiles(request);
    const fresh = await native.captureEmptyPublications(root, request.entries);
    same(fresh.controls, plan.snapshot.controls, "Recovery native state changed");
    same(fresh.command, plan.snapshot.command, "Recovery executable changed");
    const result = { schema: 1, operation: OPERATION, status: "blocked", worker_pid: process.pid, planPath, planSha256,
      original_writer: "unknown", supported_publication_critical_section_excluded: false, removed: [], errors: [],
      catalogOwner: null, maintenanceOwner: null, catalogRelease: null, maintenanceRelease: null, windowsAttributeChecks: [], snapshot: fresh };
    let leases = null, physicalStarted = false;
    try {
      leases = acquireBoth(root, fresh.command);
      result.catalogOwner = leases.catalog.owner; result.maintenanceOwner = leases.maintenance.owner;
      const audit = value => result.windowsAttributeChecks.push(value);
      allChecks(request, fence, fresh, audit);
      verifyLockPaths(leases);
      readPlan(planPath, planSha256);
      // This proof describes current supported lock custody, not the old writer.
      result.supported_publication_critical_section_excluded = true;
      writeNew(files.intent, { schema: 1, operation: OPERATION, planPath, planSha256, worker_pid: process.pid,
        original_writer: "unknown", supported_publication_critical_section_excluded: true, requestSha256: plan.requestSha256,
        entries: request.entries, catalogOwner: result.catalogOwner, maintenanceOwner: result.maintenanceOwner });
      for (const entry of request.entries) {
        verifyLockPaths(leases);
        native.verify(root, fresh);
        same(catalogFence(request), fence, "Recovery catalog changed before unlink");
        // Previously removed names must remain absent; only the remaining exact approvals may exist.
        if (result.removed.some(file => !absent(file))) throw Error("Aborted publication reappeared");
        const remaining = request.entries.filter(value => !result.removed.includes(value.path));
        if (request.entries.some(value => !absent(value.path.slice(0, -8) + ".json"))) throw Error("Canonical lifecycle appeared during recovery");
        recoveryQuiescence(request, remaining);
        checkFiles({ ...request, entries: remaining }, audit);
        const pending = fs.readdirSync(path.join(root, "artifacts/maintenance/lifecycles")).filter(name => /\.pending$/i.test(name));
        same(pending.sort(), remaining.map(value => path.basename(value.path)).sort(), "Pending publication set changed");
        assertEnabled("deletion");
        physicalStarted = true;
        fs.unlinkSync(entry.path);
        if (!absent(entry.path)) throw Error("Empty publication absence unconfirmed");
        result.removed.push(entry.path);
      }
      result.status = "deleted";
    } catch (error) {
      result.status = error.lease || error.release_error ? "unknown" : physicalStarted ? "partial" : "blocked";
      result.errors.push({ message: error.message, ...(error.lease ? { lease: error.lease } : {}),
        ...(error.release_error ? { release_error: { message: error.release_error.message, lease: error.release_error.lease } } : {}),
        ...(error.maintenance_release ? { maintenance_release: error.maintenance_release } : {}),
        ...(error.catalog_release ? { catalog_release: error.catalog_release } : {}),
        ...(error.release_errors ? { release_errors: error.release_errors } : {}),
        ...(error.attributeCheck ? { attributeCheck: error.attributeCheck } : {}) });
    } finally { if (leases) releaseBoth(leases, result); }
    writeNew(files.result, result);
    return result;
  }
  function apply({ planPath, planSha256 }) {
    const plan = readPlan(planPath, planSha256);
    return new Promise(resolve => {
      const child = spawn(process.execPath, [workerFile, "--empty-publication-worker", planPath, planSha256], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "", exit = null, error = null, overflow = false;
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", value => { if (Buffer.byteLength(stdout) + Buffer.byteLength(value) <= 1024 * 1024) stdout += value; else overflow = true; });
      child.stderr.on("data", value => { stderr = (stderr + value).slice(-16384); });
      child.on("error", value => { error = value.message; });
      child.on("exit", (code, signal) => { exit = { code, signal }; });
      child.on("close", () => {
        let result = null;
        try { if (!overflow) result = JSON.parse(stdout); } catch { /* Missing terminal stays unknown. */ }
        const success = !error && !overflow && exit?.code === 0 && exit.signal === null && result?.status === "deleted" &&
          result.planSha256 === planSha256 && result.worker_pid === child.pid && result.removed.length === 2 &&
          successfulRelease(result.catalogRelease) && successfulRelease(result.maintenanceRelease) &&
          plan.request.entries.every(entry => result.removed.includes(entry.path) && absent(entry.path) && absent(entry.path.slice(0, -8) + ".json"));
        resolve({ success: Boolean(success), status: success ? "deleted" : result?.status === "deleted" ? "unknown" : result?.status || "unknown",
          worker: { pid: child.pid ?? null, exit_observed: exit !== null, exit_code: exit?.code ?? null, signal: exit?.signal ?? null,
            close_observed: true, stdout_drained: true, stderr_drained: true }, result, resultPath: plan.files.result, stderr, error, overflow });
      });
    });
  }
  return { prepare, apply, applyWorker };
};

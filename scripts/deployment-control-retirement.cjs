"use strict";
// Deliberately separate from generic cleanup: .git remains protected everywhere else.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { isDeepStrictEqual: equal } = require("node:util");
const lifecycle = require("./artifact-lifecycle.cjs");
const { acquire } = require("./maintenance-lock-owner.cjs");
const { assertEnabled } = require("./maintenance-preferences.cjs");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const inside = (root, file) => { const rel = path.relative(root, file); return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel)); };
const overlaps = (a, b) => inside(a, b) || inside(b, a);
const same = (actual, expected, message) => { if (!equal(actual, expected)) throw Error(message); };
function checked(root, value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0") || value.split(/[\\/]/).some(part => part === ".." || part === ".")) throw Error("Absolute physical retirement path without traversal required");
  const result = path.resolve(value);
  if (!inside(root, result) || result === root) throw Error("Retirement path outside project");
  if (result.slice(path.parse(result).root.length).split(path.sep).some(part => /[:\0]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw Error("Unambiguous Windows retirement path required");
  let current = path.parse(result).root;
  for (const part of result.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current, { bigint: true }).isSymbolicLink()) throw Error("Linked retirement path"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return result;
}
function identity(file, kind) {
  const stat = fs.lstatSync(file, { bigint: true });
  if (stat.isSymbolicLink() || (kind === "file" ? !stat.isFile() || stat.nlink !== 1n : !stat.isDirectory())) throw Error(`Independent physical ${kind} required: ${file}`);
  return { dev: String(stat.dev), ino: String(stat.ino), mode: String(stat.mode), ...(kind === "file" ? { nlink: String(stat.nlink), size: String(stat.size) } : {}) };
}
function fileIdentity(file) {
  const { size, ...object } = identity(file, "file");
  return object;
}
function absent(file) {
  try { fs.lstatSync(file); return false; } catch (error) { if (error.code === "ENOENT") return true; throw error; }
}
function entriesAllowed(directory, allowed) {
  const handle = fs.opendirSync(directory);
  try {
    let entry;
    while ((entry = handle.readSync())) {
      if (!allowed.has(path.join(directory, entry.name))) throw Error(`Unplanned deployment entry: ${path.join(directory, entry.name)}`);
    }
  } finally { handle.closeSync(); }
}
function empty(directory) {
  const handle = fs.opendirSync(directory);
  try { return handle.readSync() === null; } finally { handle.closeSync(); }
}
function windowsAttributes(files, audit = () => {}) {
  const targets = new Set();
  for (let file of files) for (;;) {
    targets.add(file);
    const parent = path.dirname(file);
    if (parent === file) break;
    file = parent;
  }
  const paths = [...targets].sort();
  if (paths.length > 4096) throw Error("Bounded retirement ancestor scope required");
  const windowsRoot = process.env.SystemRoot;
  if (!windowsRoot || !path.win32.isAbsolute(windowsRoot)) throw Error("Absolute Windows system root required for attribute reader");
  const command = path.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = "$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);try{$paths=[Console]::In.ReadToEnd()|ConvertFrom-Json;$result=@();for($i=0;$i -lt $paths.Count;$i++){$result+=@{index=$i;attributes=[int][IO.File]::GetAttributes([string]$paths[$i])}};ConvertTo-Json -InputObject $result -Compress}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}";
  // Fixed executable/command; paths are JSON data on stdin. spawnSync has no
  // timeout and returns after process exit and pipe draining, never PID polling.
  const execution = spawnSync(command, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    input: JSON.stringify(paths.map(path.toNamespacedPath)), encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const check = { command, paths, pid: execution.pid ?? null, status: execution.status, signal: execution.signal,
    process_returned: true, stdout_drained: !execution.error, stderr_drained: !execution.error, ...(execution.error ? { error: execution.error.message } : {}) };
  audit(check);
  const fail = message => { throw Object.assign(Error(message), { attributeCheck: check }); };
  if (execution.error || execution.status !== 0 || execution.signal !== null) fail(`Windows attribute observation failed: ${execution.error?.message || execution.stderr}`);
  let values;
  try { values = JSON.parse(execution.stdout.replace(/^\uFEFF/, "")); } catch { fail("Invalid Windows attribute observation response"); }
  if (!Array.isArray(values) || values.length !== paths.length || values.some((value, index) => !value || value.index !== index || !Number.isInteger(value.attributes) || value.attributes < 0)) fail("Incomplete Windows attribute observation response");
  check.attributes = values.map(value => value.attributes);
  if (values.some(value => (value.attributes & 0x400) !== 0)) fail("Windows reparse point in retirement target or ancestor");
  return check;
}
function evidence(root, filename, expectedHash) {
  checked(root, filename);
  const before = identity(filename, "file");
  if (BigInt(before.size) > 1024n * 1024n || !/^[a-f0-9]{64}$/.test(expectedHash || "")) throw Error("Bounded exact retirement evidence SHA256 required");
  const bytes = fs.readFileSync(filename);
  same(identity(filename, "file"), before, "Retirement evidence identity changed");
  if (sha(bytes) !== expectedHash) throw Error("Retirement evidence SHA256 changed");
  return JSON.parse(bytes);
}
function sourceOf(options) {
  const source = options.original;
  if (!source || typeof source.workingLifecycleId !== "string" || !source.workingLifecycleId || typeof source.owner !== "string" || !source.owner ||
      !(source.generation === null || typeof source.generation === "string" && source.generation)) throw Error("Explicit original lifecycle id, owner and generation (or null) required");
  return source;
}
function selection(options) {
  if (process.platform !== "win32") throw Error("Deployment control retirement is currently scoped to Windows");
  const root = path.resolve(options.artifactProjectRoot || "");
  if (!path.isAbsolute(options.artifactProjectRoot || "")) throw Error("Absolute artifact project root required");
  checked(path.parse(root).root, root);
  const workingRoot = checked(root, options.workingRoot);
  const artifacts = path.join(root, "artifacts");
  if (workingRoot === artifacts || !inside(artifacts, workingRoot) || overlaps(path.join(artifacts, "maintenance"), workingRoot)) throw Error("Contained generated deployment workspace required");
  const original = sourceOf(options);
  const gitfile = options.gitfile;
  if (!gitfile || gitfile.path !== path.join(workingRoot, ".git") || typeof gitfile.text !== "string" || Buffer.byteLength(gitfile.text) > 32768 ||
      sha(Buffer.from(gitfile.text, "utf8")) !== gitfile.sha256 || gitfile.gitdir !== path.join(workingRoot, "control", "git")) throw Error("Exact retained gitfile bytes, SHA256 and former control/git binding required");
  const match = /^gitdir: ([^\r\n]+)\r?\n?$/.exec(gitfile.text);
  if (!match || path.resolve(workingRoot, match[1]) !== gitfile.gitdir) throw Error("Gitfile target binding changed");
  checked(root, gitfile.gitdir);
  if (!absent(gitfile.gitdir)) throw Error("Former Git control target must be absent");
  if (!Array.isArray(options.structuralDirectories) || options.structuralDirectories.length > 128 || !options.structuralDirectories.includes(workingRoot) ||
      new Set(options.structuralDirectories).size !== options.structuralDirectories.length) throw Error("Explicit bounded unique structural directory list including workspace required");
  const directories = options.structuralDirectories.map(file => {
    checked(root, file);
    if (!inside(workingRoot, file) || path.relative(workingRoot, file).split(path.sep).includes(".git")) throw Error("Structural directory outside workspace or Git metadata");
    if (file !== workingRoot && !options.structuralDirectories.includes(path.dirname(file))) throw Error("Every structural parent must be enumerated");
    return file;
  }).sort((a, b) => b.split(path.sep).length - a.split(path.sep).length || a.localeCompare(b));
  const outputDirectory = checked(root, options.outputDirectory);
  if (overlaps(workingRoot, outputDirectory)) throw Error("Retirement journal/reports must survive workspace removal");
  identity(outputDirectory, "directory");
  if (typeof options.owner !== "string" || !options.owner || typeof options.runLifecycleId !== "string" || !options.runLifecycleId) throw Error("Caller owner and active output run required");
  const attestation = evidence(root, options.evidence_ref, options.evidence_sha256);
  if (attestation.schema !== 1 || attestation.action !== "deployment-control-retirement-attestation" || attestation.producer_stopped_verified !== true ||
      attestation.references_zero !== true || attestation.payload_finalized !== true || typeof attestation.reason !== "string" || !attestation.reason.trim()) throw Error("Explicit stopped, references-zero and payload-finalized attestation required");
  same(attestation.original, original, "Original lifecycle evidence binding changed");
  same(attestation.workingRoot, workingRoot, "Original workspace evidence binding changed");
  same(attestation.gitfile, gitfile, "Retained preparation gitfile evidence binding changed");
  same([...(attestation.structuralDirectories || [])].sort(), [...directories].sort(), "Structural evidence scope changed");
  if (inside(workingRoot, options.evidence_ref)) throw Error("Attestation must survive workspace removal");
  return { artifactProjectRoot: root, workingRoot, original, gitfile, structuralDirectories: directories, outputDirectory,
    owner: options.owner, runLifecycleId: options.runLifecycleId, evidence_ref: options.evidence_ref, evidence_sha256: options.evidence_sha256 };
}
// Inspect only the explicitly enumerated tiny structural tree, never payloads.
function observe(scope, audit) {
  const root = scope.artifactProjectRoot;
  checked(root, scope.workingRoot);
  if (!absent(scope.gitfile.gitdir)) throw Error("Former Git control target reappeared");
  windowsAttributes([...scope.structuralDirectories, scope.gitfile.path, scope.outputDirectory, scope.evidence_ref], audit);
  const directories = scope.structuralDirectories.map(file => ({ path: file, identity: identity(checked(root, file), "directory") }));
  const gitfileIdentity = identity(checked(root, scope.gitfile.path), "file");
  if (BigInt(gitfileIdentity.size) > 32768n) throw Error("Gitfile size changed");
  const bytes = fs.readFileSync(scope.gitfile.path);
  same(identity(scope.gitfile.path, "file"), gitfileIdentity, "Gitfile identity changed while reading");
  if (!bytes.equals(Buffer.from(scope.gitfile.text, "utf8")) || sha(bytes) !== scope.gitfile.sha256) throw Error("Retained Git control evidence changed");
  const allowed = new Set([...scope.structuralDirectories, scope.gitfile.path]);
  for (const directory of directories) entriesAllowed(directory.path, allowed);
  for (const directory of directories) same(identity(directory.path, "directory"), directory.identity, "Structural directory identity changed");
  return { project: identity(root, "directory"), directories, gitfile: gitfileIdentity, output: identity(scope.outputDirectory, "directory") };
}
function owners(scope, records, workRecord) {
  if (records.some(record => record.id === scope.original.workingLifecycleId || record.references.some(ref => ref.id === scope.original.workingLifecycleId))) throw Error("Original payload lifecycle must be finalized, absent and without references");
  const caller = records.find(record => record.id === scope.runLifecycleId);
  if (!caller || caller.owner !== scope.owner || caller.kind !== "run" || caller.state !== "pending" || caller.producer ||
      !caller.members.some(member => member.role === "reports" && inside(member.path, scope.outputDirectory))) throw Error("Active exact caller report owner required");
  if (lifecycle.cleanupReservation(scope.artifactProjectRoot, caller)) throw Error("Caller output owner has cleanup reservation");
  for (const record of records) {
    if (record.id === workRecord?.id) continue;
    if (record.members.some(member => overlaps(member.path, scope.workingRoot)) ||
        record.observation?.scopes.some(member => overlaps(member.path, scope.workingRoot))) throw Error(`Conflicting workspace claim: ${record.id}`);
  }
  if (workRecord) {
    const current = records.find(record => record.id === workRecord.id);
    same(current, workRecord, "Retirement owner, revision, generation or consumers changed");
    if (records.some(record => record.references.some(ref => ref.id === workRecord.id))) throw Error("Retirement workspace has live consumer");
  }
  return caller;
}
function writeNew(filename, value) {
  const fd = fs.openSync(filename, "wx");
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}
function append(filename, entry) {
  const fd = fs.openSync(filename, "a");
  try { fs.writeFileSync(fd, JSON.stringify(entry) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
const native = require("./deployment-control-retirement-native.cjs").createNativeGuard({ checked, identity, absent, sha, inside, overlaps, same });
const emptyRecoveryModule = require("./lifecycle-empty-publication-recovery.cjs");
const emptyRecovery = emptyRecoveryModule.createOwner({ checked, identity, absent, sha, inside, same, windowsAttributes, evidence, writeNew,
  lifecycle, acquire, native, assertEnabled, workerFile: __filename });
function reservationScope(scope, record = null) {
  return { paths: [scope.workingRoot, scope.outputDirectory], ids: [scope.original.workingLifecycleId, scope.runLifecycleId, ...(record ? [record.id] : [])], pendingStems: [] };
}
async function prepareControl(options, prior = null) {
  assertEnabled("deletion");
  const scope = selection(options);
  const preparationAttributeChecks = [];
  const caller = owners(scope, lifecycle.catalog(scope.artifactProjectRoot), prior?.record);
  // Fail before publishing a journal/owner or starting expensive native readers.
  native.quiescent(scope.artifactProjectRoot, [], reservationScope(scope, prior?.record));
  if (prior) {
    same(caller, prior.caller, "Blocked-plan caller changed");
    if (!absent(prior.claimPath)) throw Error("Blocked plan already has an explicit reprepare intent");
    prior.verify();
  }
  const observed = observe(scope, check => preparationAttributeChecks.push(check));
  const nonce = crypto.randomUUID();
  const files = Object.fromEntries(["plan", "journal", "intent", "evidence", "result"].map(role => [role, path.join(scope.outputDirectory, `control-retirement-${nonce}.${role}.json`)]));
  // The active caller already owns these planned outputs; the new work record
  // owns only the control container and never absorbs surviving report paths.
  writeNew(files.journal, { schema: 1, operation: "deployment-control-retirement", phase: "planned", files, scope, observed });
  const journalIdentity = fileIdentity(files.journal);
  let nativeSnapshot;
  try { nativeSnapshot = await native.capture(scope.artifactProjectRoot, scope.workingRoot, query => append(files.journal, { phase: "native-preparation-query", query })); }
  catch (error) { append(files.journal, { phase: "preparation-blocked", message: error.message }); throw error; }
  const record = lifecycle.withCatalogLock(scope.artifactProjectRoot, () => {
    const freshCaller = owners(scope, lifecycle.catalog(scope.artifactProjectRoot), prior?.record);
    same(freshCaller, caller, "Caller changed before retirement publication");
    evidence(scope.artifactProjectRoot, scope.evidence_ref, scope.evidence_sha256);
    same(identity(scope.artifactProjectRoot, "directory"), observed.project, "Project identity changed before publication");
    for (const directory of observed.directories) same(identity(directory.path, "directory"), directory.identity, "Structural identity changed before publication");
    same(identity(scope.gitfile.path, "file"), observed.gitfile, "Gitfile identity changed before publication");
    native.quiescent(scope.artifactProjectRoot, [], reservationScope(scope, prior?.record));
    if (prior) {
      prior.verify();
      writeNew(prior.claimPath, { schema: 1, operation: "deployment-control-retirement-reprepare", nonce, record: prior.record,
        previous: prior.linkage, newPlanPath: files.plan });
      return prior.record;
    }
    return lifecycle.recordLifecycle(scope.artifactProjectRoot, { id: `work:deployment-control-retirement:${nonce}`, kind: "work", owner: scope.owner,
      version: nonce, generation: nonce, state: "complete", membership_complete: true, expected_revision: 0,
      members: [{ path: scope.workingRoot, role: "deployment-control-container", generated: true, protection_known: true }] });
  }, { operation: "deployment.control-prepare", drainOnly: true });
  const plan = { schema: 1, operation: "deployment-control-retirement", scope, observed, caller, record, files, journalIdentity, preparationAttributeChecks, nativeSnapshot };
  if (prior) plan.recovery = prior.linkage;
  writeNew(files.plan, plan);
  append(files.journal, { phase: "prepared", record, plan: files.plan, sha256: sha(fs.readFileSync(files.plan)) });
  return { planPath: files.plan, planSha256: sha(fs.readFileSync(files.plan)), record, files };
}
function prepareDeploymentControlRetirement(options) { return prepareControl(options); }

// Deliberately admits only the known pre-reservation blocked outcome. A failed
// result/intent is immutable; this is not replay or partial/unknown recovery.
function validateBlockedPlanStop(plan, stop, result, intent, events, original) {
  const target = original?.worker?.targets?.[0], applied = target?.applied, observed = original?.supervisor;
  if (stop?.schema !== 1 || stop.operation !== "blocked-control-reprepare-child-stop" || stop.scope !== "original-attempt-child-only" ||
      stop.outerCallerRemainsActive !== true || Object.hasOwn(stop, "producer_stopped_verified") || Object.hasOwn(stop, "process_tree_stopped_verified") ||
      original?.producer_stopped_verified !== false || original?.process_tree_stopped_verified !== false ||
      stop.sourceReview?.unobservedExecutionPaths !== false || stop.sourceReview?.scope !== "original-attempt-child-only") throw Error("Child-only stop attestation must preserve active outer and original aggregate false");
  same(stop.originalAggregate, { producer_stopped_verified: false, process_tree_stopped_verified: false }, "Original aggregate flags changed");
  same(stop.record, { id: plan.record.id, revision: plan.record.revision, owner: plan.record.owner, generation: plan.record.generation }, "Child stop record binding changed");
  same(stop.children, { supervisor: observed, applyWorker: applied?.worker, queries: [...(plan.nativeSnapshot?.queries || []), ...(result.nativeSnapshot?.queries || [])],
    attributeHelpers: [...(plan.preparationAttributeChecks || []), ...(result.windowsAttributeChecks || [])],
    maintenance: { owner: result.maintenanceOwner, release: result.maintenanceRelease } }, "Original per-child evidence changed");
  const preparation = stop.preparationCatalog;
  if (preparation?.evidenceType !== "source-enforced-synchronous-return" || preparation.native_pid !== null ||
      preparation.exit_event !== null || preparation.close_event !== null || preparation.prepare_return_observed !== true ||
      preparation.planPath !== result.planPath || preparation.planSha256 !== result.planSha256 ||
      stop.sourceReview.preparationCatalogReturnGuarantee !== true) throw Error("Source-enforced preparation catalog termination proof required");
  if (original?.schema !== 1 || original.worker?.targets?.length !== 1 || observed?.pid !== original.worker.controllerPid || observed.error !== null ||
      observed.exit?.code !== 1 || observed.exit.signal !== null || observed.close_observed !== true ||
      observed.stdout_drained !== true || observed.stderr_drained !== true ||
      applied?.worker?.pid !== result.worker_pid || applied.worker.exit_observed !== true || applied.worker.exit_code !== 1 ||
      applied.worker.signal !== null || applied.worker.close_observed !== true || applied.success !== false ||
      target.prepared?.planPath !== result.planPath || target.prepared?.planSha256 !== result.planSha256) throw Error("Exact blocked worker/supervisor exit and close evidence required");
  same(applied.result, result, "Independent blocked result changed");
  if (result.schema !== 1 || result.operation !== plan.operation || result.id !== plan.record.id || result.status !== "blocked" ||
      !Array.isArray(result.removed) || result.removed.length || result.errors?.length !== 1 ||
      result.errors[0].message !== "Pending lifecycle publication requires existing explicit recovery" || result.errors[0].lease ||
      ["nativeOwner", "nativeRelease", "reservationObservation", "reservationFinalization", "finalization"].some(key => result[key] !== null) ||
      !Number.isSafeInteger(result.maintenanceOwner?.pid) || result.maintenanceOwner.parent_pid !== result.worker_pid ||
      !emptyRecoveryModule.successfulRelease(result.maintenanceRelease)) throw Error("Only confirmed pre-reservation physical-zero failure may be reprepared");
  if (intent.schema !== 1 || intent.operation !== plan.operation || intent.phase !== "applying" || intent.worker_pid !== result.worker_pid ||
      intent.planPath !== result.planPath || intent.planSha256 !== result.planSha256) throw Error("Original blocked intent binding changed");
  if (!Array.isArray(events) || events.length < 2 || events[0].phase !== "planned" || events.at(-1).phase !== "terminal" ||
      events.at(-1).status !== "blocked" || events.some(event => ["reserve-intent", "reserved", "catalog-released", "unlink-intent", "unlinked", "rmdir-intent", "removed-directory", "finish-intent"].includes(event.phase))) throw Error("Journal does not prove a pre-reservation stop");
  same(events[0].files, plan.files, "Original journal files changed");
  same(events.at(-1).maintenanceRelease, result.maintenanceRelease, "Original maintenance release evidence changed");
  if (events.at(-1).nativeRelease !== null) throw Error("Unexpected original catalog custody");
  for (const snapshot of [plan.nativeSnapshot, result.nativeSnapshot]) {
    if (!Array.isArray(snapshot?.queries) || !snapshot.queries.length || snapshot.queries.some(query => query.exit_observed !== true || query.exit_code !== 0 ||
        query.signal !== null || query.close_observed !== true || query.stdout_drained !== true || query.stderr_drained !== true || query.error || query.overflow)) throw Error("Original native queries were not fully drained");
  }
  const attributes = stop.children.attributeHelpers;
  if (!attributes.length || attributes.some(check => !Number.isSafeInteger(check.pid) || check.pid <= 0 || check.status !== 0 || check.signal !== null ||
      check.process_returned !== true || check.stdout_drained !== true || check.stderr_drained !== true || check.error)) throw Error("Original attribute helpers were not fully drained");
  return true;
}
async function reprepareBlockedDeploymentControlRetirement({ priorPlanPath, priorPlanSha256, stopEvidencePath, stopEvidenceSha256 }) {
  const plan = readPlan(priorPlanPath, priorPlanSha256), root = plan.scope.artifactProjectRoot;
  const pins = [];
  function read(filename, expectedHash, maxBytes = 1024 * 1024) {
    checked(root, filename);
    const before = identity(filename, "file");
    if (BigInt(before.size) > BigInt(maxBytes)) throw Error("Bounded blocked-plan evidence required");
    const bytes = fs.readFileSync(filename);
    same(identity(filename, "file"), before, "Blocked-plan evidence changed");
    const hash = sha(bytes);
    if (expectedHash && hash !== expectedHash) throw Error("Blocked-plan evidence SHA changed");
    pins.push({ path: filename, identity: before, sha256: hash });
    return bytes;
  }
  const stop = JSON.parse(read(stopEvidencePath, stopEvidenceSha256, 8 * 1024 * 1024));
  if (!/^[a-f0-9]{64}$/.test(stopEvidenceSha256 || "")) throw Error("Exact independent stop evidence SHA required");
  read(priorPlanPath, priorPlanSha256);
  const resultBytes = read(plan.files.result), intentBytes = read(plan.files.intent);
  const result = JSON.parse(resultBytes), intent = JSON.parse(intentBytes);
  const journalBytes = read(plan.files.journal, null, 8 * 1024 * 1024);
  const events = journalBytes.toString("utf8").trim().split(/\r?\n(?=\{)/).map(value => JSON.parse(value));
  if (result.planPath !== priorPlanPath || result.planSha256 !== priorPlanSha256) throw Error("Original failure plan binding changed");
  if (!/^[a-f0-9]{64}$/.test(stop.originalEvidence?.sha256 || "")) throw Error("Exact original attempt evidence SHA required");
  const original = JSON.parse(read(stop.originalEvidence.path, stop.originalEvidence.sha256, 8 * 1024 * 1024));
  const target = original.worker?.targets?.[0];
  if (target?.rawResult?.path !== plan.files.result || target.rawResult.sha256 !== sha(resultBytes) ||
      target?.journal?.path !== plan.files.journal || target.journal.sha256 !== sha(journalBytes)) throw Error("Independent original result/journal SHA binding required");
  validateBlockedPlanStop(plan, stop, result, intent, events, original);
  const executionPlan = JSON.parse(Buffer.from(original.plan.base64, "base64").toString("utf8"));
  if (sha(Buffer.from(original.plan.base64, "base64")) !== original.plan.sha256) throw Error("Original execution source plan SHA changed");
  const expectedSources = { controller: original.controller.sha256,
    controlOwner: executionPlan.inputs.find(value => path.basename(value.path) === "deployment-control-retirement.cjs")?.sha256,
    nativeGuard: executionPlan.inputs.find(value => path.basename(value.path) === "deployment-control-retirement-native.cjs")?.sha256,
    lifecycle: executionPlan.inputs.find(value => path.basename(value.path) === "artifact-lifecycle.cjs")?.sha256,
    leaseOwner: executionPlan.inputs.find(value => path.basename(value.path) === "maintenance-lock-owner.cjs")?.sha256,
    leaseWorker: executionPlan.inputs.find(value => path.basename(value.path) === "maintenance-lock-worker.cjs")?.sha256,
    resolver: executionPlan.inputs.find(value => path.basename(value.path) === "maintenance-owner-config.cjs")?.sha256 };
  const reviewed = stop.sourceReview.sources;
  if (!Array.isArray(reviewed) || reviewed.length !== 7 || new Set(reviewed.map(value => value.role)).size !== 7) throw Error("All original child-launch source owners must be reviewed");
  for (const source of reviewed) {
    if (!expectedSources[source.role] || source.sha256 !== expectedSources[source.role]) throw Error("Reviewed original execution source changed");
    read(source.path, source.sha256);
  }
  const linkage = { operation: "deployment-control-retirement-reprepare", priorPlanPath, priorPlanSha256, stopEvidencePath, stopEvidenceSha256,
    previousOutcome: "blocked", previousExitCode: 1, originalEvidence: pins };
  const verify = () => { for (const pin of pins) { same(identity(pin.path, "file"), pin.identity, "Original failed evidence identity changed"); if (sha(fs.readFileSync(pin.path)) !== pin.sha256) throw Error("Original failed evidence SHA changed"); } };
  return prepareControl(plan.scope, { record: plan.record, caller: plan.caller, claimPath: priorPlanPath + ".reprepare-intent.json", linkage, verify });
}

function readPlan(planPath, planSha256) {
  if (!path.isAbsolute(planPath || "")) throw Error("Absolute retirement plan required");
  const before = identity(planPath, "file");
  if (BigInt(before.size) > 1024n * 1024n) throw Error("Bounded retirement plan required");
  const bytes = fs.readFileSync(planPath);
  same(identity(planPath, "file"), before, "Retirement plan identity changed");
  if (sha(bytes) !== planSha256) throw Error("Retirement plan SHA256 changed");
  const plan = JSON.parse(bytes);
  if (plan.schema !== 1 || plan.operation !== "deployment-control-retirement") throw Error("Unsupported control retirement plan");
  same(selection(plan.scope), plan.scope, "Retirement selection changed");
  if (plan.files.plan !== planPath || new Set(Object.values(plan.files)).size !== 5 ||
      Object.keys(plan.files).sort().join(",") !== "evidence,intent,journal,plan,result") throw Error("Exact disjoint retirement output paths required");
  for (const filename of Object.values(plan.files)) if (path.dirname(checked(plan.scope.artifactProjectRoot, filename)) !== plan.scope.outputDirectory) throw Error("Retirement output escaped caller directory");
  same(fileIdentity(plan.files.journal), plan.journalIdentity, "Retirement journal identity changed");
  return plan;
}
function cleanupPlan(plan, reservations = []) {
  const check = lifecycle.planCleanup(plan.scope.artifactProjectRoot, { paths: [plan.scope.workingRoot], reportPath: plan.files.result, reservations });
  if (check.blockers.length || check.standalone.length || check.groups.length !== 1 || check.groups[0].id !== plan.record.id || check.groups[0].blockers.length) {
    throw Error(`Retirement cleanup plan blocked: ${JSON.stringify(check)}`);
  }
}
function remainingIdentities(plan, removed) {
  const { scope, observed } = plan;
  checked(scope.artifactProjectRoot, scope.workingRoot);
  same(identity(scope.artifactProjectRoot, "directory"), observed.project, "Project identity changed during retirement");
  same(identity(scope.outputDirectory, "directory"), observed.output, "Report directory identity changed during retirement");
  for (const directory of observed.directories) {
    if (removed.includes(directory.path)) { if (!absent(directory.path)) throw Error("Removed structural directory reappeared"); }
    else same(identity(directory.path, "directory"), directory.identity, "Remaining structural identity changed");
  }
  if (removed.includes(scope.gitfile.path) && !absent(scope.gitfile.path)) throw Error("Retired gitfile reappeared");
  if (!absent(scope.gitfile.gitdir)) throw Error("Former Git target reappeared");
  evidence(scope.artifactProjectRoot, scope.evidence_ref, scope.evidence_sha256);
  same(owners(scope, lifecycle.catalog(scope.artifactProjectRoot), plan.record), plan.caller, "Caller or workspace ownership changed during retirement");
}
async function applyWorker(planPath, planSha256) {
  assertEnabled("deletion");
  const plan = readPlan(planPath, planSha256), { scope, files } = plan, root = scope.artifactProjectRoot;
  const windowsAttributeChecks = [], audit = check => windowsAttributeChecks.push(check);
  same(observe(scope, audit), plan.observed, "Retirement filesystem identity or structure changed");
  same(owners(scope, lifecycle.catalog(root), plan.record), plan.caller, "Caller revision, owner or generation changed");
  cleanupPlan(plan);
  const nativeSnapshot = await native.capture(root, scope.workingRoot);
  same(nativeSnapshot.controls, plan.nativeSnapshot.controls, "Native state changed since retirement preparation");
  same(nativeSnapshot.command, plan.nativeSnapshot.command, "Installed native owner changed since preparation");
  // An existing intent, including an interrupted attempt, requires explicit
  // recovery. It is never silently replayed by this owner.
  writeNew(files.intent, { schema: 1, operation: plan.operation, planPath, planSha256, worker_pid: process.pid, phase: "applying" });
  const result = { schema: 1, operation: plan.operation, id: plan.record.id, status: "blocked", worker_pid: process.pid,
    planPath, planSha256, removed: [], errors: [], windowsAttributeChecks, nativeSnapshot, nativeOwner: null, nativeRelease: null,
    maintenanceOwner: null, maintenanceRelease: null, reservationObservation: null, reservationFinalization: null, finalization: null };
  let lease, maintenance, reserved = false, physicalStarted = false, outcomes;
  const event = value => {
    checked(root, files.journal);
    same(fileIdentity(files.journal), plan.journalIdentity, "Retirement journal identity changed");
    same(identity(scope.outputDirectory, "directory"), plan.observed.output, "Caller report directory identity changed");
    append(files.journal, value);
  };
  try {
    // Same order as Store/registration: maintenance first, catalog second.
    // Native inventory must never run while this exclusive custody is held.
    maintenance = acquire(path.join(root, "artifacts/maintenance/maintenance.lock"), { operation: "deployment.control-retirement", queue: true, drainOnly: true, command: nativeSnapshot.command });
    result.maintenanceOwner = maintenance.owner;
    native.verify(root, nativeSnapshot);
    native.quiescent(root, [], reservationScope(scope, plan.record));
    event({ phase: "maintenance-custody", owner: maintenance.owner, controls: nativeSnapshot.controls });
    lease = acquire(path.join(root, "artifacts/maintenance/lifecycles/catalog.lock"), { operation: "lifecycle.cleanup", queue: true, drainOnly: true, command: nativeSnapshot.command });
    result.nativeOwner = lease.owner;
    native.quiescent(root, [], reservationScope(scope, plan.record));
    same(owners(scope, lifecycle.catalog(root), plan.record), plan.caller, "Caller changed before reservation");
    evidence(root, scope.evidence_ref, scope.evidence_sha256);
    cleanupPlan(plan);
    event({ phase: "reserve-intent", id: plan.record.id, revision: plan.record.revision });
    const reservation = lease.reserveProducers([{ id: plan.record.id, revision: plan.record.revision }]);
    reserved = true;
    result.reservationObservation = reservation.observed;
    if (!Array.isArray(reservation.observed) || reservation.observed.length !== 1 || reservation.observed[0].id !== plan.record.id) throw Error("Exact native reservation observer required");
    cleanupPlan(plan, reservation.observed);
    native.verify(root, nativeSnapshot);
    native.quiescent(root, reservation.observed, reservationScope(scope, plan.record));
    event({ phase: "reserved", observed: reservation.observed });
    lease.releaseCatalog();
    event({ phase: "catalog-released" });
    // Cooperative reservations protect catalog ownership. These fresh checks
    // do not claim atomic protection from hostile external filesystem swaps.
    same(observe(scope, audit), plan.observed, "Retirement identity changed after reservation");
    native.verify(root, nativeSnapshot);
    native.quiescent(root, reservation.observed, reservationScope(scope, plan.record));
    same(owners(scope, lifecycle.catalog(root), plan.record), plan.caller, "Caller changed after catalog release");
    cleanupPlan(plan, reservation.observed);
    assertEnabled("deletion");
    event({ phase: "unlink-intent", path: scope.gitfile.path, identity: plan.observed.gitfile });
    same(observe(scope, audit), plan.observed, "Retirement identity changed before gitfile unlink");
    evidence(root, scope.evidence_ref, scope.evidence_sha256);
    native.verify(root, nativeSnapshot);
    native.quiescent(root, reservation.observed, reservationScope(scope, plan.record));
    physicalStarted = true;
    fs.unlinkSync(scope.gitfile.path);
    if (!absent(scope.gitfile.path)) throw Error("Gitfile absence unconfirmed after unlink");
    result.removed.push(scope.gitfile.path);
    event({ phase: "unlinked", path: scope.gitfile.path });
    for (const directory of plan.observed.directories) {
      remainingIdentities(plan, result.removed);
      checked(root, directory.path);
      same(identity(root, "directory"), plan.observed.project, "Project identity changed during retirement");
      same(identity(directory.path, "directory"), directory.identity, "Structural directory identity changed before rmdir");
      if (!absent(scope.gitfile.gitdir) || !empty(directory.path)) throw Error(`Structural directory is no longer empty: ${directory.path}`);
      event({ phase: "rmdir-intent", path: directory.path, identity: directory.identity });
      windowsAttributes([directory.path], audit);
      native.verify(root, nativeSnapshot);
      native.quiescent(root, reservation.observed, reservationScope(scope, plan.record));
      remainingIdentities(plan, result.removed);
      same(identity(directory.path, "directory"), directory.identity, "Structural directory changed after rmdir intent");
      if (!empty(directory.path)) throw Error("Structural directory became nonempty");
      fs.rmdirSync(directory.path);
      if (!absent(directory.path)) throw Error("Structural directory absence unconfirmed");
      result.removed.push(directory.path);
      event({ phase: "removed-directory", path: directory.path });
    }
    if (!absent(scope.workingRoot)) throw Error("Workspace retirement absence unconfirmed");
    result.status = "deleted";
  } catch (error) {
    result.status = error.lease ? "unknown" : physicalStarted ? "partial" : "blocked";
    result.errors.push({ message: error.message, ...(error.lease ? { lease: error.lease } : {}), ...(error.attributeCheck ? { attributeCheck: error.attributeCheck } : {}) });
  } finally {
    if (reserved) {
      try {
        let remaining = null;
        try { remaining = !absent(scope.workingRoot); } catch { /* Unknown preserves reservation. */ }
        const status = result.status === "unknown" || remaining === null ? "unknown" : result.status === "deleted" && !remaining ? "deleted" : "partial";
        outcomes = [{ id: plan.record.id, status, members: [{ path: scope.workingRoot,
          status: status === "deleted" ? "deleted" : status === "unknown" ? "unknown" : "failed", remaining }] }];
        writeNew(files.evidence, { schema_version: 1, operation: "lifecycle.cleanup", outcomes, result });
        event({ phase: "finish-intent", outcomes, evidence_ref: files.evidence, evidence_sha256: sha(fs.readFileSync(files.evidence)) });
        result.reservationFinalization = lease.finishProducers(outcomes, files.evidence, sha(fs.readFileSync(files.evidence)));
        if (result.reservationFinalization.finished !== true || !Array.isArray(result.reservationFinalization.reservations_retained) || result.reservationFinalization.reservations_retained.length) throw Error("Native reservation remains protected or finalization unconfirmed");
        event({ phase: "reservation-finished", result: result.reservationFinalization });
      } catch (error) { result.status = "unknown"; result.errors.push({ phase: "finish", message: error.message, ...(error.lease ? { lease: error.lease } : {}) }); }
    }
    if (lease) {
      try { result.nativeRelease = lease.release(); }
      catch (error) { result.status = "unknown"; result.errors.push({ phase: "release", message: error.message, lease: error.lease }); }
    }
  }
  if (result.status === "deleted") {
    if (!result.nativeRelease?.native_exit_observed || result.nativeRelease.native_exit_code !== 0 || result.nativeRelease.native_signal !== null || !result.nativeRelease.native_close_observed) {
      result.status = "unknown";
      result.errors.push({ message: "Actual native lease exit and close required" });
    } else {
      try {
        result.finalization = lifecycle.withCatalogLock(root, () => lifecycle.finalize(root, plan.record.id),
          { operation: "deployment.control-finalize", drainOnly: true });
        if (result.finalization.status !== "finalized") throw Error("Control-container owner finalization retained");
      } catch (error) {
        result.status = error.lease || error.release_error ? "unknown" : "partial";
        result.errors.push({ phase: "finalize", message: error.message, ...(error.lease ? { lease: error.lease } : {}),
          ...(error.release_error ? { release_error: { message: error.release_error.message, lease: error.release_error.lease } } : {}),
          ...(error.catalog_lease_release ? { catalog_lease_release: error.catalog_lease_release } : {}) });
      }
    }
  }
  if (maintenance) {
    try { result.maintenanceRelease = maintenance.release(); }
    catch (error) { result.status = "unknown"; result.errors.push({ phase: "maintenance-release", message: error.message, lease: error.lease }); }
    if (!result.maintenanceRelease?.native_exit_observed || result.maintenanceRelease.native_exit_code !== 0 || result.maintenanceRelease.native_signal !== null || !result.maintenanceRelease.native_close_observed) result.status = "unknown";
  }
  event({ phase: "terminal", status: result.status, errors: result.errors, nativeRelease: result.nativeRelease, maintenanceRelease: result.maintenanceRelease });
  writeNew(files.result, result);
  return result;
}
function applyDeploymentControlRetirement({ planPath, planSha256 }) {
  // Validate before spawning, then validate again inside the actual worker.
  const plan = readPlan(planPath, planSha256);
  return new Promise(resolve => {
    const child = spawn(process.execPath, [__filename, "--apply-worker", planPath, planSha256], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    let stdout = "", stderr = "", overflow = false, spawnError = null, exit = null;
    child.stdout.on("data", bytes => { if (Buffer.byteLength(stdout) + bytes.length <= 1024 * 1024) stdout += bytes.toString(); else overflow = true; });
    child.stderr.on("data", bytes => { stderr = (stderr + bytes.toString()).slice(-16384); });
    child.on("error", error => { spawnError = error.message; });
    child.on("exit", (code, signal) => { exit = { observed: true, code, signal }; });
    // No timer, kill or PID-absence inference. Close also drains both pipes.
    child.on("close", () => {
      let result = null;
      try { if (!overflow) result = JSON.parse(stdout); } catch { /* Missing terminal packet stays unknown. */ }
      let targetAbsent = false;
      try { targetAbsent = absent(plan.scope.workingRoot); } catch { /* Fresh absence must be observable. */ }
      const successful = !spawnError && targetAbsent && exit?.observed && exit.code === 0 && exit.signal === null && result?.status === "deleted" &&
        result.id === plan.record.id && result.planSha256 === planSha256 && result.reservationFinalization?.finished === true && result.reservationFinalization.reservations_retained?.length === 0 &&
        result.nativeRelease?.native_exit_observed === true && result.nativeRelease.native_exit_code === 0 && result.nativeRelease.native_signal === null && result.nativeRelease.native_close_observed === true &&
        result.maintenanceRelease?.native_exit_observed === true && result.maintenanceRelease.native_exit_code === 0 && result.maintenanceRelease.native_signal === null && result.maintenanceRelease.native_close_observed === true &&
        result.finalization?.status === "finalized";
      resolve({ status: successful ? "deleted" : result?.status === "deleted" ? "unknown" : result?.status || "unknown", success: Boolean(successful),
        worker: { pid: child.pid ?? null, exit_observed: exit?.observed === true, exit_code: exit?.code ?? null, signal: exit?.signal ?? null, close_observed: true },
        result, resultPath: plan.files.result, ...(spawnError ? { spawnError } : {}), ...(stderr ? { stderr } : {}), ...(overflow ? { output_overflow: true } : {}) });
    });
  });
}
module.exports = { prepareDeploymentControlRetirement, applyDeploymentControlRetirement, reprepareBlockedDeploymentControlRetirement,
  prepareEmptyLifecyclePublicationRecovery: emptyRecovery.prepare, applyEmptyLifecyclePublicationRecovery: emptyRecovery.apply, validateBlockedPlanStop };
if (require.main === module) {
  const [mode, planPath, planSha256, ...extra] = process.argv.slice(2);
  try {
    if (!["--apply-worker", "--empty-publication-worker"].includes(mode) || extra.length) throw Error("Expected explicit retirement/recovery worker PLAN SHA256");
    (mode === "--apply-worker" ? applyWorker : emptyRecovery.applyWorker)(planPath, planSha256).then(result => {
      process.stdout.write(JSON.stringify(result) + "\n");
      process.exitCode = result.status === "deleted" ? 0 : 1;
    }).catch(error => {
      process.stderr.write(JSON.stringify({ message: error.message, ...(error.lease ? { lease: error.lease } : {}), ...(error.attributeCheck ? { attributeCheck: error.attributeCheck } : {}) }) + "\n");
      process.exitCode = 1;
    });
  } catch (error) {
    process.stderr.write(JSON.stringify({ message: error.message, ...(error.lease ? { lease: error.lease } : {}), ...(error.attributeCheck ? { attributeCheck: error.attributeCheck } : {}) }) + "\n");
    process.exitCode = 1;
  }
}

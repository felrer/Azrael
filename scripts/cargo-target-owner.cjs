"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

// Resolve existing ancestors too: an as-yet absent target reached through a
// junction/symlink must share its owner with the physical spelling.
function physicalPath(input) {
  const absolute = path.resolve(input);
  let current = absolute;
  const tail = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Cannot resolve Cargo target: ${input}`);
    tail.unshift(path.basename(current));
    current = parent;
  }
  return path.join(fs.realpathSync.native(current), ...tail);
}

function compilationSignature({ command, args, cwd, env }) {
  const compilationArgs = [...args];
  // Cargo's optional TESTNAME is a runtime filter. Retain every compilation
  // flag and its value; never union features or use this hash as test evidence.
  const values = new Set(["-p", "--package", "--features", "-F", "--target", "--profile", "--test", "--bin", "--bench", "--example", "--manifest-path", "--target-dir", "--message-format", "--jobs", "-j", "--config", "--exclude", "--color"]);
  if (args[0] === "test") {
    const runtime = compilationArgs.indexOf("--");
    if (runtime >= 0) compilationArgs.splice(runtime);
    for (let i = 1; i < compilationArgs.length && compilationArgs[i] !== "--"; i++) {
      if (values.has(compilationArgs[i])) { i++; continue; }
      if (!compilationArgs[i].startsWith("-")) { compilationArgs.splice(i, 1); break; }
    }
  }
  return createHash("sha256").update(JSON.stringify({ command, args: compilationArgs, cwd,
    env: Object.keys(env).sort().map(key => [key, env[key]]) })).digest("hex");
}

function acquireTargetOwner(spec) {
  // CLI config can override build.target-dir after CARGO_TARGET_DIR. Current
  // managed commands do not need it; reject this unsupported input rather
  // than pretending arbitrary TOML/file overrides share the selected owner.
  const separator = spec.args.indexOf("--");
  const cargoArgs = separator < 0 ? spec.args : spec.args.slice(0, separator);
  if (cargoArgs.some(arg => arg === "--config" || arg.startsWith("--config="))) {
    throw new Error("Managed Cargo does not support command-line --config overrides; target-directory ownership cannot be established");
  }
  const explicitTarget = targetArgument(spec.args);
  const target = spec.env.CARGO_TARGET_DIR;
  if (!target || !path.isAbsolute(target)) throw new Error("Managed Cargo requires absolute CARGO_TARGET_DIR");
  const physicalTarget = physicalPath(target);
  const identity = value => process.platform === "win32" ? value.toLowerCase() : value;
  if (explicitTarget && identity(physicalPath(path.resolve(spec.cwd, explicitTarget.value))) !== identity(physicalTarget)) {
    throw new Error("Cargo --target-dir conflicts with leased CARGO_TARGET_DIR; select the same physical target before launching Cargo");
  }
  fs.mkdirSync(physicalTarget, { recursive: true });
  const leasePath = path.join(physicalTarget, ".azrael-cargo-owner");
  const ownerPath = path.join(leasePath, "owner.json");
  const owner = { schema: 1, token: randomUUID(), run: spec.env.AZRAEL_CARGO_RUN_ID || `pid-${process.pid}`,
    coordinatorPid: process.pid, producerPid: null, startedUtc: new Date().toISOString(),
    targetDirectory: physicalTarget, targetIdentity: process.platform === "win32" ? physicalTarget.toLowerCase() : physicalTarget,
    command: spec.command, args: spec.args, cwd: spec.cwd, compilationSignature: compilationSignature(spec),
    pendingDirectory: spec.env.INSTA_PENDING_DIR || null, status: "running" };
  try { fs.mkdirSync(leasePath); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    let existing;
    try { existing = JSON.parse(fs.readFileSync(ownerPath, "utf8")); } catch { existing = { status: "unknown owner (metadata unavailable)" }; }
    throw new Error(`Cargo target owner conflict at ${leasePath}: ${JSON.stringify({ status: "blocked", requestedCompilationSignature: owner.compilationSignature, targetIdentity: owner.targetIdentity, existingOwner: existing })}. Wait for that owner to complete; unknown/abandoned owners require independent producer-tree verification and explicit recovery. No Cargo process was launched.`);
  }
  fs.writeFileSync(ownerPath, JSON.stringify(owner, null, 2), { flag: "wx" });
  return { owner, leasePath, ownerPath };
}

function finishTargetOwner(lease, result) {
  const { owner, ownerPath, leasePath } = lease;
  const current = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
  if (current.token !== owner.token) throw new Error(`Cargo target owner changed; retaining ${leasePath}`);
  // A signal/timeout may leave descendants. A missing executable created no
  // producer; all other errors or indeterminate outcomes retain protection.
  const neverStarted = result.error && ["ENOENT", "EACCES"].includes(result.error.code) && !result.pid;
  const ended = Number.isInteger(result.status) && !result.signal && !result.error;
  owner.producerPid = result.pid || null;
  owner.status = ended ? (result.status === 0 ? "success" : "failed") : neverStarted ? "not-started" : "unknown";
  owner.exitCode = result.status ?? null;
  owner.signal = result.signal || null;
  fs.writeFileSync(ownerPath, JSON.stringify(owner, null, 2));
  recordPending(lease, owner.status === "unknown" ? "pending" : owner.status === "success" ? "complete" : "failed", owner.status !== "unknown");
  if (ended || neverStarted) { fs.unlinkSync(ownerPath); fs.rmdirSync(leasePath); }
  return owner;
}

const pathIdentity = value => process.platform === "win32" ? value.toLowerCase() : value;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
function containsPath(parent, child) {
  const relative = path.relative(pathIdentity(parent), pathIdentity(child));
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}
function exactStat(filename, directory = false) {
  const stat = fs.lstatSync(filename, { bigint: true });
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile()) || (!directory && stat.nlink !== 1n)) throw new Error("Uncertain Cargo recovery filesystem identity");
  return { dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) };
}
function inspectTargetOwner({ targetDirectory }) {
  if (typeof targetDirectory !== "string" || !path.isAbsolute(targetDirectory)) throw new Error("Absolute Cargo target required");
  const target = fs.realpathSync.native(targetDirectory);
  const leasePath = path.join(target, ".azrael-cargo-owner"), ownerPath = path.join(leasePath, "owner.json");
  const targetStat = exactStat(target, true);
  if (!fs.existsSync(leasePath)) return { exists: false, targetDirectory: target, targetStat };
  const leaseStat = exactStat(leasePath, true);
  const names = fs.readdirSync(leasePath);
  if (names.length !== 1 || names[0] !== "owner.json") throw new Error("Unidentified Cargo lease contents");
  const ownerStat = exactStat(ownerPath);
  if (fs.statSync(ownerPath).size > 65536) throw new Error("Oversized Cargo owner");
  const bytes = fs.readFileSync(ownerPath), owner = JSON.parse(bytes);
  if (JSON.stringify(exactStat(ownerPath)) !== JSON.stringify(ownerStat)) throw new Error("Cargo owner identity changed");
  return { exists: true, targetDirectory: target, targetStat, leasePath, leaseStat, ownerPath, ownerStat,
    token: owner.token, ownerSha256: sha256(bytes), owner, ownerBytesBase64: bytes.toString("base64") };
}
function refuseLiveOwner(owner) {
  for (const [name, pid] of [["coordinator", owner.coordinatorPid], ["producer", owner.producerPid]]) {
    if (name === "producer" && pid === null) continue;
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Uncertain Cargo ${name} PID`);
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === "ESRCH") continue; throw error; }
    throw new Error(`Cargo ${name} PID is live; recovery refused`);
  }
}
// The caller supplies independent exact producer-tree verification. PID absence
// only removes a veto; it never establishes termination or a Cargo result.
function recoverTargetOwner(options) {
  const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  if (options.producer_stopped_verified !== true || typeof options.reason !== "string" || !options.reason.trim() ||
      typeof options.expectedToken !== "string" || !options.expectedToken || !hash(options.expectedOwnerSha256) || !hash(options.evidence_sha256)) {
    throw new Error("Exact verified recovery, token, hashes and reason required");
  }
  const current = inspectTargetOwner(options);
  if (!current.exists || current.token !== options.expectedToken || current.ownerSha256 !== options.expectedOwnerSha256) throw new Error("Cargo lease identity changed");
  const prior = current.owner;
  if (prior.schema !== 1 || typeof prior.cwd !== "string" || !path.isAbsolute(prior.cwd) ||
      pathIdentity(prior.targetDirectory) !== pathIdentity(current.targetDirectory) || prior.targetIdentity !== pathIdentity(current.targetDirectory) ||
      !["running", "unknown", "interrupted"].includes(prior.status)) throw new Error("Uncertain Cargo owner metadata");
  const source = physicalPath(prior.cwd);
  const artifacts = physicalPath(path.resolve(__dirname, "../artifacts"));
  function externalFile(value, receipt = false) {
    if (typeof value !== "string" || !path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) throw new Error("Absolute recovery evidence/receipt path required");
    const filename = physicalPath(value);
    if (containsPath(current.targetDirectory, filename) || containsPath(source, filename) || (receipt && !containsPath(artifacts, filename))) throw new Error("Recovery evidence/receipt must survive outside target/source; receipt must be in project artifacts");
    exactStat(path.dirname(filename), true);
    if (!receipt) exactStat(filename);
    else if (fs.existsSync(filename)) throw new Error("Recovery receipt already exists");
    return filename;
  }
  const evidence = externalFile(options.evidence_ref), receipt = externalFile(options.receipt_ref, true);
  if (pathIdentity(evidence) === pathIdentity(receipt)) throw new Error("Separate recovery receipt required");
  const evidenceStat = exactStat(evidence);
  function recheck() {
    const final = inspectTargetOwner(options);
    if (JSON.stringify(final) !== JSON.stringify(current)) throw new Error("Cargo lease identity changed");
    if (externalFile(options.evidence_ref) !== evidence || JSON.stringify(exactStat(evidence)) !== JSON.stringify(evidenceStat) || sha256(fs.readFileSync(evidence)) !== options.evidence_sha256) throw new Error("Recovery evidence changed");
    if (physicalPath(options.receipt_ref) !== receipt) throw new Error("Recovery receipt path changed");
    refuseLiveOwner(final.owner);
  }
  recheck();
  const decision = { schema: 1, action: "verified-cargo-lease-retirement", lease: current,
    result: { status: prior.status === "interrupted" ? "interrupted" : "unknown", exitCode: prior.exitCode ?? null },
    producer_stopped_verified: true, reason: options.reason, evidence_ref: evidence, evidence_sha256: options.evidence_sha256,
    decidedAt: new Date().toISOString() };
  // Exclusive publication survives partial failure and never changes cache validity.
  fs.writeFileSync(receipt, JSON.stringify(decision, null, 2) + "\n", { flag: "wx" });
  recheck();
  fs.unlinkSync(current.ownerPath);
  // A changed/nonempty directory fails ordinary removal and remains protected.
  if (JSON.stringify(exactStat(current.leasePath, true)) !== JSON.stringify(current.leaseStat) ||
      JSON.stringify(exactStat(current.targetDirectory, true)) !== JSON.stringify(current.targetStat)) throw new Error("Cargo lease directory identity changed");
  fs.rmdirSync(current.leasePath);
  return { recovered: true, targetDirectory: current.targetDirectory, receipt_ref: receipt, result: decision.result };
}

function runManagedCargoSync(spec) {
  let pending = spec.env.INSTA_PENDING_DIR;
  if (pending) {
    if (!path.isAbsolute(pending)) throw new Error("INSTA_PENDING_DIR must be absolute");
    pending = physicalPath(pending);
    if (spec.selectedSourceRoot) {
      const source = physicalPath(spec.selectedSourceRoot);
      const identity = value => process.platform === "win32" ? value.toLowerCase() : value;
      const relative = path.relative(identity(source), identity(pending));
      if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
        throw new Error("INSTA_PENDING_DIR must be outside selected engine source at Cargo launch");
      }
    }
  }
  // Pin output aliases before acquiring ownership or allowing a producer.
  spec = { ...spec, env: { ...spec.env, ...(pending ? { INSTA_PENDING_DIR: pending } : {}) } };
  const lease = acquireTargetOwner(spec);
  let result;
  try {
    const { command, args, selectedSourceRoot, ...options } = spec;
    recordPending(lease, "pending", false);
    if (spec.env.INSTA_PENDING_DIR) fs.mkdirSync(spec.env.INSTA_PENDING_DIR, { recursive: true });
    // Pin the physical cache we leased, rather than following the caller's
    // mutable junction/symlink a second time when Cargo starts.
    const selected = targetArgument(args);
    const executionArgs = [...args];
    if (selected) executionArgs[selected.index] = selected.inline ? `--target-dir=${lease.owner.targetDirectory}` : lease.owner.targetDirectory;
    options.env = { ...options.env, CARGO_TARGET_DIR: lease.owner.targetDirectory };
    result = require("node:child_process").spawnSync(command, executionArgs, options);
  } catch (error) { result = { status: null, error }; }
  const owner = finishTargetOwner(lease, result);
  // Keep Cargo JSON stdout byte-for-byte usable by native artifact discovery.
  process.stderr.write(`[cargo-owner] ${JSON.stringify(owner)}\n`);
  return result;
}

function targetArgument(args) {
  let selected;
  for (let index = 1; index < args.length && args[index] !== "--"; index++) {
    if (args[index] === "--target-dir" && args[index + 1]) selected = { index: ++index, value: args[index], inline: false };
    else if (args[index].startsWith("--target-dir=")) selected = { index, value: args[index].slice("--target-dir=".length), inline: true };
  }
  return selected;
}

function recordPending(lease, state, membershipComplete) {
  if (!lease.owner.pendingDirectory) return;
  const projectRoot = physicalPath(path.resolve(__dirname, ".."));
  const hash = createHash("sha256").update(lease.owner.targetIdentity).digest("hex");
  const pending = physicalPath(path.join(projectRoot, "artifacts", "verification", "cargo-pending", hash));
  const identity = value => process.platform === "win32" ? value.toLowerCase() : value;
  // An explicitly supplied output keeps its caller's lifecycle owner.
  if (identity(physicalPath(lease.owner.pendingDirectory)) !== identity(pending)) return;
  const lifecycle = require("./artifact-lifecycle.cjs");
  const id = `shared:cargo-pending:${hash}`;
  if (!membershipComplete) {
    if (lease.pendingRecord) return; // Unknown termination retains the running generation unchanged.
    const previous = lifecycle.catalog(projectRoot).find(record => record.id === id);
    lifecycle.recordLifecycle(projectRoot, { id, kind: "work", owner: "cargo-target-owner", state,
      generation: lease.owner.token, expected_revision: previous?.revision || 0,
      membership_complete: false, members: [{ role: "pending", path: pending, generated: true, protection_known: true }] });
    lease.pendingRecord = true;
    return;
  }
  if (!lease.pendingRecord) return;
  const directory = path.join(projectRoot, "artifacts/maintenance/cargo-terminal");
  fs.mkdirSync(directory, { recursive: true });
  const evidence = path.join(directory, `${hash}.json`);
  fs.writeFileSync(evidence, JSON.stringify(lease.owner, null, 2) + "\n");
  const record = lifecycle.catalog(projectRoot).find(record => record.id === id);
  if (!record || record.generation !== lease.owner.token) throw new Error("Cargo pending producer generation changed");
  lifecycle.closeLifecycle(projectRoot, id, { owner: "cargo-target-owner", expected_revision: record.revision,
    producer_stopped_verified: true, outcome: state === "complete" ? "success" : "failure", exit_code: lease.owner.exitCode,
    reason: "Synchronous Cargo producer terminal result", evidence_ref: evidence,
    evidence_sha256: createHash("sha256").update(fs.readFileSync(evidence)).digest("hex") });
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (!["build", "test"].includes(args[0])) throw new Error("Usage: cargo-target-owner.cjs <build|test> <exact Cargo arguments>");
  const result = runManagedCargoSync({ command: "cargo", args, cwd: process.cwd(), env: process.env, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

module.exports = { physicalPath, compilationSignature, acquireTargetOwner, finishTargetOwner, inspectTargetOwner, recoverTargetOwner, runManagedCargoSync };

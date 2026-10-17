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
  require("./artifact-lifecycle.cjs").recordLifecycle(projectRoot, {
    id: `shared:cargo-pending:${hash}`, kind: "work", owner: "cargo-target-owner", state,
    membership_complete: membershipComplete, members: [{ role: "pending", path: pending }],
  });
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (!["build", "test"].includes(args[0])) throw new Error("Usage: cargo-target-owner.cjs <build|test> <exact Cargo arguments>");
  const result = runManagedCargoSync({ command: "cargo", args, cwd: process.cwd(), env: process.env, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

module.exports = { physicalPath, compilationSignature, acquireTargetOwner, finishTargetOwner, runManagedCargoSync };

"use strict";

// Compilation storage is independent of a release or source-copy address.
// Cargo fingerprints still decide what to compile; this is never test evidence.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const lifecycle = require("./artifact-lifecycle.cjs");
const { isDeepStrictEqual } = require("node:util");
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function withOwnershipStage(error, stage) {
  if (error !== null && typeof error === "object" && Object.isExtensible(error)) {
    try { error.stage ||= stage; return error; }
    catch { /* Read-only diagnostic properties require a cause wrapper too. */ }
  }
  return Object.assign(new Error(`Cargo ownership failed at ${stage}`, { cause: error }), { stage });
}
function plain(filename) {
  if (!path.isAbsolute(filename) || filename.split(/[\\/]/).includes("..")) throw Error("Absolute plain cache path required");
  filename = path.resolve(filename);
  for (let current = filename; ; current = path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) throw Error("Linked shared cache path rejected"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (current === path.dirname(current)) break;
  }
  return filename;
}
function tool(command, args, cwd, env) {
  // Identify the executable selected by the invocation environment, rather
  // than preferring a different installed compiler outside its PATH.
  if (command === "rustc") command = env.RUSTC || env.CARGO_BUILD_RUSTC || command;
  const result = spawnSync(command, args, { cwd, env, windowsHide: true, encoding: "utf8" });
  if (result.error || result.signal || result.status !== 0) throw Error(`Cannot identify Cargo cache tool ${command}: ${result.error?.message || result.stderr || result.signal}`);
  return result.stdout.trim();
}
function selectCache({ projectRoot, sourceRoot, target, env = process.env, tools }) {
  const scope = env.AZRAEL_CARGO_CACHE_SCOPE;
  if (typeof scope !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(scope)) throw Error("Explicit valid Cargo cache scope (AZRAEL_CARGO_CACHE_SCOPE) required before selecting a shared Cargo cache");
  projectRoot = plain(projectRoot); sourceRoot = plain(sourceRoot);
  if (!fs.statSync(projectRoot).isDirectory() || !fs.statSync(sourceRoot).isDirectory()) throw Error("Existing cache owner and source roots required");
  const cwd = path.join(sourceRoot, "codex-rs");
  if (!fs.existsSync(path.join(cwd, "Cargo.toml"))) throw Error("Selected engine Cargo manifest required");
  tools ??= { rustc: tool("rustc", ["-vV"], cwd, env), cargo: tool("cargo", ["-V"], cwd, env) };
  if (typeof tools.rustc !== "string" || !tools.rustc.trim() || typeof tools.cargo !== "string" || !tools.cargo.trim()) throw Error("Complete Cargo tool identity required");
  target ||= /^host: (.+)$/m.exec(tools.rustc)?.[1];
  if (typeof target !== "string" || !/^[A-Za-z0-9_.-]+$/.test(target)) throw Error("Explicit Cargo target identity required");
  const configuration = [];
  // Include effective ancestor config bytes, but not the source-copy address.
  for (let directory = cwd; ; directory = path.dirname(directory)) {
    for (const name of [".cargo/config", ".cargo/config.toml"]) {
      const file = path.join(directory, name);
      if (fs.existsSync(file)) { plain(file); configuration.push([path.relative(cwd, file).replaceAll("\\", "/"), hash(fs.readFileSync(file).toString("base64"))]); }
    }
    if (directory === path.dirname(directory)) break;
  }
  // Cargo also reads its user configuration when it is outside the source's
  // ancestor chain. Bind its bytes without depending on the source-copy path.
  if (env.CARGO_HOME !== undefined && (typeof env.CARGO_HOME !== "string" || !path.isAbsolute(env.CARGO_HOME))) throw Error("Absolute CARGO_HOME required for shared cache identity");
  const cargoHome = path.resolve(env.CARGO_HOME || path.join(require("node:os").homedir(), ".cargo"));
  for (const name of ["config", "config.toml"]) {
    const file = path.join(cargoHome, name);
    if (fs.existsSync(file) && !configuration.some(([relative]) => path.resolve(cwd, relative) === file)) {
      plain(file); configuration.push([`cargo-home/${name}`, hash(fs.readFileSync(file).toString("base64"))]);
    }
  }
  const flags = Object.fromEntries(Object.entries(env).filter(([name]) => name !== "CARGO_TARGET_DIR" &&
    /^(?:CARGO_(?:ENCODED_RUST(?:DOC)?FLAGS|BUILD_(?:RUSTFLAGS|RUSTC|RUSTDOC|RUSTC_WRAPPER|RUSTC_WORKSPACE_WRAPPER|TARGET)|TARGET_.*|PROFILE_.*|INCREMENTAL)|RUSTFLAGS|RUSTDOCFLAGS|RUSTC|RUSTDOC|RUSTC_WRAPPER|RUSTC_WORKSPACE_WRAPPER)$/.test(name)).sort(([a], [b]) => a.localeCompare(b)));
  const identity = { schema: 1, platform: process.platform, arch: process.arch, target, tools, configuration, flags,
    scope };
  // Scoped verification targets need short Windows paths. The full identity
  // marker and full lifecycle key still reject a prefix collision before use.
  const key = hash(identity), directory = plain(path.join(projectRoot, "artifacts/cargo", key.slice(0, 32)));
  return { projectRoot, key, identity, directory, targetDirectory: path.join(directory, "target"), lifecycleId: `shared:cargo-target:${key}` };
}
function beginExecution(selection, token) {
  const { projectRoot, lifecycleId, directory, identity } = selection;
  // A saved legacy selection cannot bypass the future-writer scope contract.
  if (identity?.schema !== 1 || typeof identity.scope !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(identity.scope) ||
      !identity.tools?.rustc?.trim() || !identity.tools?.cargo?.trim() || !identity.platform || !identity.arch || !identity.target ||
      !Array.isArray(identity.configuration) || !identity.flags || hash(identity) !== selection.key ||
      lifecycleId !== `shared:cargo-target:${selection.key}` || path.resolve(directory) !== path.join(path.resolve(projectRoot), "artifacts/cargo", selection.key.slice(0, 32))) {
    throw Error("Complete scoped Cargo cache identity required before creating a generation");
  }
  plain(directory);
  const marker = plain(path.join(directory, "identity.json"));
  if (fs.existsSync(marker)) {
    const stat = fs.lstatSync(marker);
    if (!stat.isFile() || stat.nlink !== 1) throw Error("Shared Cargo cache identity must be an unlinked regular file");
  }
  const old = lifecycle.withCatalogLock(projectRoot, () => lifecycle.catalog(projectRoot).find(record => record.id === lifecycleId), { operation: "cargo-cache.observe" });
  if (old && (!old.producer || old.producer.status !== "stopped" || old.producer.outcome === "unknown" && !lifecycle.canRestartGeneration(projectRoot, old))) throw Error("Shared Cargo cache has an unresolved producer; explicit recovery required");
  if (old?.restart_recovery && fs.existsSync(plain(path.join(selection.targetDirectory, ".azrael-cargo-owner")))) throw Error("Shared Cargo target lease is still active");
  if (fs.existsSync(directory) && (!fs.existsSync(marker) || fs.readFileSync(marker, "utf8") !== JSON.stringify(identity))) throw Error("Shared Cargo cache identity missing or changed");
  // Claim the full entry before creating either marker, target or Cargo lease.
  let record;
  try {
    record = lifecycle.withCatalogLock(projectRoot, () => lifecycle.recordLifecycle(projectRoot, {
      id: lifecycleId, kind: "work", owner: "cargo-shared-cache", state: "pending", membership_complete: false,
      generation: token, expected_revision: old?.revision || 0, references: [], members: [{ role: "cargo-cache", path: directory, generated: true, protection_known: true }]
    }), { operation: "cargo-cache.begin" });
  } catch (error) { throw withOwnershipStage(error, "cargo-shared-cache.lifecycle-begin"); }
  const execution = { ...selection, record, startedUtc: new Date().toISOString() };
  try {
    fs.mkdirSync(directory, { recursive: true });
    if (!fs.existsSync(marker)) fs.writeFileSync(marker, JSON.stringify(identity), { flag: "wx" });
    return execution;
  } catch (error) {
    // This invocation has not called Cargo or acquired a target lease. Retain
    // partial payload, but close only the generation we actually claimed.
    try { finishExecution(execution, { status: null, error }, { status: "not-started", producerStarted: false,
      phase: "preparing", startedUtc: execution.startedUtc, resultObservedUtc: new Date().toISOString(),
      error: error.message, errorCode: error.code || null }); }
    catch (cleanupError) { error.ownershipErrors = [cleanupError]; }
    throw error;
  }
}
function saveTerminalEvidence(projectRoot, prefix, generation, payload) {
  if (!/^[a-f0-9]{64}(?:-cache)?$/.test(prefix) || typeof generation !== "string" || !generation) throw Error("Exact Cargo evidence identity required");
  const directory = plain(path.join(projectRoot, "artifacts/maintenance/cargo-terminal"));
  fs.mkdirSync(directory, { recursive: true });
  const bytes = Buffer.from(JSON.stringify({ ...payload, generation }) + "\n");
  const evidence = plain(path.join(directory, `${prefix}-${crypto.createHash("sha256").update(bytes).digest("hex")}.json`));
  let fd;
  try { fd = fs.openSync(evidence, "wx"); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = fs.lstatSync(evidence);
    if (!stat.isFile() || stat.nlink !== 1 || !fs.readFileSync(evidence).equals(bytes)) throw Error("Immutable Cargo terminal evidence changed");
  }
  if (fd !== undefined) {
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  return { evidence_ref: evidence, evidence_sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}
function recoverExecution(selection, options) {
  const { projectRoot, lifecycleId, identity, directory, targetDirectory } = selection;
  if (options.producer_stopped_verified !== true || typeof options.reason !== "string" || !options.reason.trim() ||
      typeof options.expectedGeneration !== "string" || !options.expectedGeneration || !Number.isSafeInteger(options.expectedRevision) ||
      typeof options.expectedToken !== "string" || !options.expectedToken || !/^[a-f0-9]{64}$/.test(options.expectedOwnerSha256 || "")) throw Error("Exact independent cache recovery identity required");
  function proof(filename, digest) {
    filename = plain(filename);
    const relative = path.relative(projectRoot, filename);
    if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative) ||
        filename === directory || filename.startsWith(directory + path.sep) ||
        filename.startsWith(path.join(projectRoot, "artifacts/maintenance/lifecycles") + path.sep)) throw Error("Contained independent recovery proof required");
    const before = fs.lstatSync(filename, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n) throw Error("Unlinked regular recovery proof required");
    const bytes = fs.readFileSync(filename), after = fs.lstatSync(filename, { bigint: true });
    if (!["dev", "ino", "size", "mtimeNs", "ctimeNs"].every(key => before[key] === after[key]) ||
        !/^[a-f0-9]{64}$/.test(digest || "") || crypto.createHash("sha256").update(bytes).digest("hex") !== digest) throw Error("Recovery proof SHA256 or identity changed");
    return bytes;
  }
  function recheck() {
    const marker = plain(path.join(directory, "identity.json")), stat = fs.lstatSync(marker);
    if (!stat.isFile() || stat.nlink !== 1 || fs.readFileSync(marker, "utf8") !== JSON.stringify(identity)) throw Error("Shared Cargo cache identity changed");
    if (require("./cargo-target-owner.cjs").inspectTargetOwner({ targetDirectory }).exists) throw Error("Shared Cargo target lease is still active");
    proof(options.evidence_ref, options.evidence_sha256);
    const receipt = JSON.parse(proof(options.receipt_ref, options.receipt_sha256));
    const lease = receipt.lease, canonical = value => process.platform === "win32" ? value.toLowerCase() : value;
    if (receipt.schema !== 1 || receipt.action !== "verified-cargo-lease-retirement" || receipt.producer_stopped_verified !== true ||
        receipt.evidence_ref !== options.evidence_ref || receipt.evidence_sha256 !== options.evidence_sha256 ||
        !["unknown", "interrupted"].includes(receipt.result?.status) || receipt.result.exitCode !== null ||
        lease?.token !== options.expectedToken || lease.ownerSha256 !== options.expectedOwnerSha256 || lease.owner?.token !== options.expectedToken ||
        canonical(lease.targetDirectory || "") !== canonical(plain(targetDirectory)) || canonical(lease.owner.targetDirectory || "") !== canonical(plain(targetDirectory)) ||
        lease.owner.targetIdentity !== canonical(plain(targetDirectory))) throw Error("Target recovery receipt binding changed");
    const ownerBytes = Buffer.from(lease.ownerBytesBase64 || "", "base64");
    if (crypto.createHash("sha256").update(ownerBytes).digest("hex") !== lease.ownerSha256 || !isDeepStrictEqual(JSON.parse(ownerBytes), lease.owner)) throw Error("Target recovery original owner changed");
  }
  return lifecycle.withCatalogLock(projectRoot, () => {
    recheck();
    let record = lifecycle.catalog(projectRoot).find(value => value.id === lifecycleId);
    if (!record || record.owner !== "cargo-shared-cache" || record.generation !== options.expectedGeneration ||
        !isDeepStrictEqual(record.members, [{ path: directory, role: "cargo-cache", generated: true, protection_known: true }])) throw Error("Cache recovery generation or ownership changed");
    if (record.restart_recovery) {
      const document = JSON.parse(fs.readFileSync(record.restart_recovery.evidence_ref));
      if (!isDeepStrictEqual(document.recovery_request, options)) throw Error("Conflicting cache recovery retry");
      lifecycle.canRestartGeneration(projectRoot, record);
      return record;
    }
    const closeRequest = { owner: record.owner, expected_revision: options.expectedRevision,
      producer_stopped_verified: true, outcome: "unknown", exit_code: null, reason: options.reason,
      evidence_ref: options.receipt_ref, evidence_sha256: options.receipt_sha256 };
    const closeIdentity = crypto.createHash("sha256").update(JSON.stringify(Object.keys(closeRequest).sort().map(key => [key, closeRequest[key]]))).digest("hex");
    if (record.revision !== options.expectedRevision && !(record.revision === options.expectedRevision + 1 && record.close_receipt?.request_sha256 === closeIdentity)) throw Error("Stale cache recovery revision");
    if (!record.producer) record = lifecycle.closeLifecycle(projectRoot, lifecycleId, closeRequest);
    if (record.producer.outcome !== "unknown" || record.producer.exit_code !== null) throw Error("Only unknown cache outcomes may be recovered");
    const evidence = saveTerminalEvidence(projectRoot, `${selection.key}-cache`, record.generation, {
      schema: 1, action: "authorize-restart", source: lifecycle.restartSource(record), producer_stopped_verified: true,
      stop_basis: options.reason, recovery_request: options, producer_evidence: [
        { path: options.evidence_ref, sha256: options.evidence_sha256 }, { path: options.receipt_ref, sha256: options.receipt_sha256 }] });
    recheck();
    return lifecycle.authorizeRestart(projectRoot, lifecycleId, { owner: record.owner, expected_revision: record.revision,
      expected_generation: record.generation, producer_stopped_verified: true, reason: options.reason, ...evidence });
  }, { operation: "cargo-cache.recover" });
}
function finishExecution(selection, result, owner) {
  const notStarted = owner?.status === "not-started" && !result.pid && !result.signal && !Number.isInteger(result.status);
  const ended = !result.error && !result.signal && Number.isInteger(result.status);
  if (!ended && !notStarted) return; // Preserve unknown producer protection.
  let stage = "cargo-shared-cache.terminal-evidence";
  try {
    const evidence = saveTerminalEvidence(selection.projectRoot, `${selection.key}-cache`, selection.record.generation,
      { ...owner, cacheIdentity: selection.identity, startedUtc: owner?.startedUtc || selection.startedUtc });
    stage = "cargo-shared-cache.lifecycle-close";
    return lifecycle.closeLifecycle(selection.projectRoot, selection.lifecycleId, { owner: "cargo-shared-cache", expected_revision: selection.record.revision,
      producer_stopped_verified: true, outcome: ended && result.status === 0 && !result.sourceVerificationError ? "success" : "failure",
      // A source audit has no process exit. The observed Cargo exit remains in
      // immutable owner evidence even when overall source validation fails.
      exit_code: ended && !(result.sourceVerificationError && result.status === 0) ? result.status : null,
      reason: notStarted ? "Managed Cargo preparation failed before producer start" : "Managed Cargo actual synchronous close; unresolved outcomes stay protected", ...evidence });
  } catch (error) { throw withOwnershipStage(error, stage); }
}
module.exports = { selectCache, beginExecution, recoverExecution, finishExecution, saveTerminalEvidence, withOwnershipStage };
if (require.main === module) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!["--project-root", "--source-root", "--target", "--scope"].includes(args[i]) || !args[i + 1] || options[args[i]]) throw Error("Usage: cargo-shared-cache --project-root ABS --source-root ABS [--target TARGET] --scope PURPOSE");
      options[args[i]] = args[i + 1];
    }
    console.log(JSON.stringify(selectCache({ projectRoot: options["--project-root"], sourceRoot: options["--source-root"], target: options["--target"],
      env: { ...process.env, ...(options["--scope"] === undefined ? {} : { AZRAEL_CARGO_CACHE_SCOPE: options["--scope"] }) } })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

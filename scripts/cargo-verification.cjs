"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const { physicalPath, runManagedCargoSync } = require("./cargo-target-owner.cjs");

// Pure command construction is shared by execution and verification identity.
// Cargo owns compilation reuse; every requested test filter still executes.
const PREFLIGHT = Object.freeze({ schema: 2, compilation: "cargo-test", testExecution: "nonzero-passed" });
const PREFLIGHT_ID = "selected-tests-v2";
const guardedCargoWrappers = new Set([
  "check-selected-upstream-native",
  "check-mcp-oauth-store",
  "check-mcp-lazy-startup",
  "check-window-approval-native", "check-question-withdrawal-native", "check-shared-engine-native", "check-startup-performance-native",
  "check-parent-requests", "check-api-context", "check-root-resume-reasoning", "check-model-harness-profiles",
  "check-task-work-time-native", "check-response-tps-native", "check-thread-auto-compaction", "check-devin-compaction",
  "check-capacity-recovery", "check-task-profile-skills", "check-project-maintenance", "check-error-classification-native",
  "check-task-recovery-native", "check-usage-window", "check-edit-message-native",
  "check-deletion-approval-native",
  "check-executor-completion", "check-role-profiles-native", "check-task-memory", "check-find-names", "check-agent-image-attachments",
].map(name => `scripts/${name}.cjs`));

function validateCargoPreflight(check) {
  const required = check.level === "native" && check.executable === "node" && guardedCargoWrappers.has(check.args?.[0]);
  if ((required || Object.hasOwn(check, "cargoPreflight")) && (!required || check.cargoPreflight !== PREFLIGHT_ID)) {
    throw new Error(`Missing or invalid Cargo preflight declaration: ${check.id}`);
  }
}
// Coordinator options are separate from application runtime state. Restore
// only this validated set after host-environment isolation.
function cargoManagementEnvironment(env, pathImpl = path) {
  const selected = {};
  for (const name of ["AZRAEL_CARGO_CACHE_PROJECT_ROOT", "AZRAEL_CARGO_CACHE_SCOPE", "AZRAEL_CARGO_RUN_ID", "AZRAEL_CARGO_STABLE_SOURCE", "AZRAEL_VERIFICATION_REUSE_DECISIONS_PATH"]) {
    const value = env[name];
    if (value === undefined) continue;
    if (typeof value !== "string" || !value || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`Invalid Cargo management option: ${name}`);
    if (["AZRAEL_CARGO_CACHE_PROJECT_ROOT", "AZRAEL_VERIFICATION_REUSE_DECISIONS_PATH"].includes(name) && (!pathImpl.isAbsolute(value) || value.split(/[\\/]/).includes(".."))) {
      throw new Error("Cargo cache project root must be an absolute plain path");
    }
    if (name === "AZRAEL_CARGO_RUN_ID" && value.length > 256) throw new Error("Cargo run identity exceeds 256 characters");
    if (name === "AZRAEL_CARGO_CACHE_SCOPE" && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) throw new Error("Invalid Cargo cache scope");
    if (name === "AZRAEL_CARGO_STABLE_SOURCE" && !["0", "1"].includes(value)) throw new Error("Cargo stable source option must be 0 or 1");
    selected[name] = value;
  }
  if (selected.AZRAEL_CARGO_CACHE_PROJECT_ROOT && !selected.AZRAEL_CARGO_CACHE_SCOPE) throw new Error("Shared Cargo cache requires explicit AZRAEL_CARGO_CACHE_SCOPE");
  return selected;
}

function cargoErrorDetails(error, seen = new Set(), depth = 0) {
  if (error == null) return null;
  if (depth >= 6 || seen.has(error)) return { message: "Additional error context omitted" };
  if (typeof error !== "object") return { message: String(error) };
  seen.add(error);
  const details = { message: String(error.message || error) };
  for (const key of ["name", "stage", "code", "maintenance_code", "retryable", "lock_path", "lease"]) {
    if (error[key] !== undefined) details[key] = error[key];
  }
  if (error.cause) details.cause = cargoErrorDetails(error.cause, seen, depth + 1);
  if (error.release_error) details.release_error = cargoErrorDetails(error.release_error, seen, depth + 1);
  return details;
}

function buildCargoTestCommand(sourceRoot, cargoArgs, {
  env = process.env, pathImpl = path, isolateHostEnvironment = false,
} = {}) {
  if (!sourceRoot || !pathImpl.isAbsolute(sourceRoot)) {
    throw new Error("Cargo verification requires an absolute frozen engine source root");
  }
  if (cargoArgs[0] !== "test") throw new Error("Cargo verification requires cargo test");
  const cwd = pathImpl.join(pathImpl.normalize(sourceRoot), "codex-rs");
  const targetDirectory = env.CARGO_TARGET_DIR || pathImpl.join(cwd, "target");
  if (!pathImpl.isAbsolute(targetDirectory)) {
    throw new Error("CARGO_TARGET_DIR must be absolute for frozen-source verification");
  }
  const args = [...cargoArgs];
  const options = [];
  if (env.AZRAEL_CARGO_TARGET) options.push("--target", env.AZRAEL_CARGO_TARGET);
  // Unset preserves Cargo's test profile (including [profile.test] overrides).
  if (env.AZRAEL_CARGO_PROFILE) options.push("--profile", env.AZRAEL_CARGO_PROFILE);
  const separator = args.indexOf("--");
  args.splice(separator < 0 ? args.length : separator, 0, ...options);
  const cargoEnv = { ...env };
  if (isolateHostEnvironment) {
    const management = cargoManagementEnvironment(env, pathImpl);
    for (const key of Object.keys(cargoEnv)) {
      if (/^(AZRAEL_|CODEX_)/i.test(key)) delete cargoEnv[key];
    }
    Object.assign(cargoEnv, management);
  }
  cargoEnv.CARGO_TARGET_DIR = pathImpl.normalize(targetDirectory);
  cargoEnv.RUST_MIN_STACK ||= "33554432";
  cargoEnv.INSTA_UPDATE = "no";
  const physical = value => pathImpl === path ? physicalPath(value) : pathImpl.normalize(value);
  const identity = value => pathImpl === path.win32 || (pathImpl === path && process.platform === "win32") ? value.toLowerCase() : value;
  const targetIdentity = identity(physical(cargoEnv.CARGO_TARGET_DIR));
  const outputRoot = pathImpl === path ? path.join(__dirname, "..", "artifacts", "verification", "cargo-pending")
    : pathImpl.join(pathImpl.dirname(sourceRoot), "artifacts", "verification", "cargo-pending");
  cargoEnv.INSTA_PENDING_DIR ||= pathImpl.join(outputRoot, createHash("sha256").update(targetIdentity).digest("hex"));
  if (!pathImpl.isAbsolute(cargoEnv.INSTA_PENDING_DIR)) throw new Error("INSTA_PENDING_DIR must be absolute and outside selected engine source");
  const relative = pathImpl.relative(identity(physical(sourceRoot)), identity(physical(cargoEnv.INSTA_PENDING_DIR)));
  if (relative === "" || (!relative.startsWith(`..${pathImpl.sep}`) && relative !== ".." && !pathImpl.isAbsolute(relative))) {
    throw new Error("INSTA_PENDING_DIR must be outside selected engine source");
  }
  return { command: "cargo", args, cwd, selectedSourceRoot: physical(sourceRoot), env: cargoEnv, stdio: "inherit", windowsHide: true };
}

function assertExecutableTestRequest(spec) {
  const separator = spec.args.indexOf("--");
  const cargo = spec.args.slice(0, separator < 0 ? undefined : separator);
  const runtime = separator < 0 ? [] : spec.args.slice(separator + 1);
  if (cargo.includes("--no-run") || cargo.includes("--doc") || runtime.some(arg => /^(--list|--help|--format)(=|$)/.test(arg))) {
    throw new Error("Cargo verification requires executable libtest checks; declare compile-only preparation separately");
  }
  return { cargo, runtime };
}

// Explicit preparation callers retain the older command construction. The
// default verification path below never invokes these preliminary commands.
function preflightCommands(spec) {
  const { cargo, runtime } = assertExecutableTestRequest(spec);
  // Retain every compilation option and its value. TESTNAME is a positional
  // runtime filter; it must not become a cargo-check positional argument.
  const values = new Set(["-p", "--package", "--features", "-F", "--target", "--profile", "--test", "--bin", "--bench", "--example", "--manifest-path", "--target-dir", "--message-format", "--jobs", "-j", "--config", "--exclude", "--color"]);
  const check = ["check"];
  for (let index = 1; index < cargo.length; index++) {
    const arg = cargo[index];
    if (values.has(arg)) { check.push(arg, cargo[++index]); continue; }
    if (arg.startsWith("-")) check.push(arg);
  }
  // --lib alone checks the production library. --tests is needed for cfg(test)
  // imports and types; Cargo may also check other test targets in that package.
  if (!cargo.some(arg => /^(--tests|--all-targets|--test|--bench|--example)(=|$)/.test(arg))) check.push("--tests");
  if (!cargo.some(arg => /^(--profile|--release|-r)(=|$)/.test(arg))) check.push("--profile", "test");
  return {
    typeCheck: { ...spec, args: check },
    selection: { ...spec, args: [...cargo, "--", ...runtime, "--list", "--format=terse"],
      stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  };
}

function actualTestCounts(stdout) {
  const text = String(stdout || "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  const summaries = [];
  for (const match of text.matchAll(/^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out;(?: finished in [^\r\n]*)?\r?$/gm)) {
    const [passed, failed, ignored, measured, filteredOut] = match.slice(2).map(Number);
    if (![passed, failed, ignored, measured, filteredOut].every(Number.isSafeInteger)) return null;
    summaries.push({ status: match[1], passed, failed, ignored, measured, filteredOut });
  }
  const counts = { summaries, passed: 0, failed: 0, ignored: 0, measured: 0, filteredOut: 0, executed: 0 };
  for (const summary of summaries) for (const key of ["passed", "failed", "ignored", "measured", "filteredOut"]) counts[key] += summary[key];
  counts.executed = counts.passed + counts.failed;
  return [counts.passed, counts.failed, counts.ignored, counts.measured, counts.filteredOut, counts.executed].every(Number.isSafeInteger) ? counts : null;
}

function runCargoTest(sourceRoot, cargoArgs, options) {
  const spec = { ...buildCargoTestCommand(sourceRoot, cargoArgs, options),
    stdio: "pipe", encoding: "utf8", maxBuffer: 64 * 1024 * 1024 };
  assertExecutableTestRequest(spec);
  const started = Date.now();
  // The shared owner still owns the one actual Cargo compilation/execution.
  // Preparation receipts cannot replace this invocation or its observed counts.
  const result = runManagedCargoSync(spec);
  const counts = actualTestCounts(result.stdout);
  const accepted = result.status === 0 && !result.error && !result.signal && !result.sourceVerificationError &&
    counts && counts.summaries.length > 0 && counts.summaries.every(summary => summary.status === "ok") &&
    counts.executed > 0 && counts.passed > 0 && counts.failed === 0;
  const evidence = { ...PREFLIGHT, contract: PREFLIGHT_ID, cargoInvocations: 1, accepted: Boolean(accepted),
    actualCounts: counts, phases: [{ phase: "compilation-and-execution", args: spec.args,
      startedUtc: new Date(started).toISOString(), durationMs: Date.now() - started,
      exitCode: result.status ?? null, signal: result.signal ?? null }],
    ...(result.error ? { error: cargoErrorDetails(result.error) } : {}),
    ...(result.sourceVerificationError ? { sourceVerificationError: cargoErrorDetails(result.sourceVerificationError) } : {}),
    ...(result.ownershipErrors?.length ? { ownershipErrors: result.ownershipErrors.map(error => cargoErrorDetails(error)) } : {}) };
  if (!options?.capture) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  process.stderr.write(`[cargo-preflight] ${JSON.stringify(evidence)}\n`);
  if (accepted) return { ...result, preflight: evidence };
  if (result.status !== 0 || result.error || result.signal || result.sourceVerificationError) {
    return { ...result, status: result.status === 0 ? 1 : result.status, preflight: evidence };
  }
  return { ...result, status: 1,
    error: new Error("Cargo test did not report a nonzero successful actual libtest execution"), preflight: evidence };
}

// Preparation is an early scheduling boundary. It is never test evidence and
// never substitutes for runCargoTest's actual nonzero execution gate.
function prepareCargoTests(sourceRoot, cargoArgs, options = {}) {
  const spec = preflightCommands(buildCargoTestCommand(sourceRoot, cargoArgs, options)).typeCheck;
  if (options.logDirectory) {
    if (!path.isAbsolute(options.logDirectory)) throw Error("Preparation log directory must be absolute");
    fs.mkdirSync(options.logDirectory, { recursive: true });
    for (const name of ["stdout.log", "stderr.log", "preparation.json"]) {
      if (fs.existsSync(path.join(options.logDirectory, name))) throw Error("Preparation log directory already contains evidence; choose a new attempt directory");
    }
  }
  const started = Date.now();
  const result = runManagedCargoSync({ ...spec, stdio: "pipe", encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const preparation = { phase: "prepare", command: spec.command, args: spec.args, cwd: spec.cwd,
    targetDirectory: physicalPath(spec.env.CARGO_TARGET_DIR), toolchain: spec.env.RUSTUP_TOOLCHAIN || null,
    environmentSha256: createHash("sha256").update(JSON.stringify(Object.keys(spec.env).sort().map(key => [key, spec.env[key]]))).digest("hex"),
    startedUtc: new Date(started).toISOString(), durationMs: Date.now() - started,
    exitCode: result.status ?? null, signal: result.signal ?? null, error: result.error?.message || null };
  if (options.logDirectory) {
    // Exclusive creation preserves evidence across attempts.
    for (const [name, contents] of [["stdout.log", result.stdout || ""], ["stderr.log", result.stderr || ""], ["preparation.json", JSON.stringify(preparation, null, 2)]]) {
      fs.writeFileSync(path.join(options.logDirectory, name), contents, { flag: "wx" });
    }
  }
  return { ...result, status: (result.error || result.signal) && result.status === 0 ? 1 : result.status, preparation };
}

module.exports = { PREFLIGHT, PREFLIGHT_ID, guardedCargoWrappers, validateCargoPreflight, preflightCommands, buildCargoTestCommand, runCargoTest, runManagedCargoSync, prepareCargoTests };

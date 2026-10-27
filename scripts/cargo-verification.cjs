"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const { physicalPath, runManagedCargoSync } = require("./cargo-target-owner.cjs");
const { preparationContext } = require("./cargo-test-preparation.cjs");

// Pure command construction is shared by execution and verification identity.
// Cargo owns compilation reuse; every requested test filter still executes.
const PREFLIGHT = Object.freeze({ schema: 1, typeCheck: "selected-tests", testSelection: "nonzero" });
const PREFLIGHT_ID = "selected-tests-v1";
const guardedCargoWrappers = new Set([
  "check-selected-upstream-native",
  "check-mcp-oauth-store",
  "check-mcp-lazy-startup",
  "check-window-approval-native", "check-question-withdrawal-native", "check-shared-engine-native", "check-startup-performance-native",
  "check-parent-requests", "check-api-context", "check-root-resume-reasoning", "check-model-harness-profiles",
  "check-task-work-time-native", "check-response-tps-native", "check-thread-auto-compaction",
  "check-capacity-recovery", "check-task-profile-skills", "check-project-maintenance", "check-error-classification-native",
  "check-task-recovery-native", "check-usage-window",
  "check-deletion-approval-native",
].map(name => `scripts/${name}.cjs`));

function validateCargoPreflight(check) {
  const required = check.level === "native" && check.executable === "node" && guardedCargoWrappers.has(check.args?.[0]);
  if ((required || Object.hasOwn(check, "cargoPreflight")) && (!required || check.cargoPreflight !== PREFLIGHT_ID)) {
    throw new Error(`Missing or invalid Cargo preflight declaration: ${check.id}`);
  }
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
    for (const key of Object.keys(cargoEnv)) {
      if (/^(AZRAEL_|CODEX_)/i.test(key)) delete cargoEnv[key];
    }
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

function preflightCommands(spec) {
  const separator = spec.args.indexOf("--");
  const cargo = spec.args.slice(0, separator < 0 ? undefined : separator);
  const runtime = separator < 0 ? [] : spec.args.slice(separator + 1);
  if (cargo.includes("--no-run") || cargo.includes("--doc") || runtime.some(arg => /^(--list|--help|--format)(=|$)/.test(arg))) {
    throw new Error("Cargo verification requires executable libtest checks; declare compile-only preparation separately");
  }
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

function runCargoTest(sourceRoot, cargoArgs, options) {
  const spec = { ...buildCargoTestCommand(sourceRoot, cargoArgs, options),
    ...(options?.capture ? { stdio: "pipe", encoding: "utf8", maxBuffer: 64 * 1024 * 1024 } : {}) };
  const commands = preflightCommands(spec);
  const evidence = { ...PREFLIGHT, phases: [] };
  const environment = options?.env || process.env;
  const configuration = options?.preparation || (environment.AZRAEL_CARGO_PREPARATION_DIR ? {
    directory: environment.AZRAEL_CARGO_PREPARATION_DIR,
    sourceIdentity: environment.AZRAEL_CARGO_PREPARATION_SOURCE_IDENTITY,
    runtimeIdentity: environment.AZRAEL_CARGO_PREPARATION_RUNTIME_IDENTITY,
    mode: environment.AZRAEL_CARGO_PREPARATION_MODE,
  } : undefined);
  let preparation;
  if (configuration) {
    try { preparation = preparationContext(spec, configuration); }
    catch (error) { preparation = { report: { recommendation: "reuse-caution", action: "prepare", reason: error.message } }; }
    evidence.preparation = preparation.report;
    process.stderr.write(`[cargo-preparation] ${JSON.stringify(preparation.report)}\n`);
  }
  for (const [phase, command] of Object.entries(commands)) {
    if (phase === "typeCheck" && preparation?.skipTypeCheck) continue;
    const started = Date.now();
    const result = runManagedCargoSync(command, { onSuccess(observed) {
      if (phase === "selection") preparation?.save?.([...evidence.phases, { phase,
        exitCode: observed.status, signal: observed.signal, durationMs: Date.now() - started,
        selectedTests: (String(observed.stdout || "").match(/^.+: test\r?$/gm) || []).length }]);
    } });
    if (result.observationError && preparation) {
      evidence.preparation.saveWarning = String(result.observationError);
      process.stderr.write(`[cargo-preparation] ${JSON.stringify(evidence.preparation)}\n`);
    }
    const count = phase === "selection" ? (String(result.stdout || "").match(/^.+: test\r?$/gm) || []).length : undefined;
    evidence.phases.push({ phase, args: command.args, startedUtc: new Date(started).toISOString(),
      durationMs: Date.now() - started, exitCode: result.status ?? null, signal: result.signal ?? null,
      ...(count === undefined ? {} : { selectedTests: count }) });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.stderr.write(`[cargo-preflight] ${JSON.stringify(evidence)}\n`);
    if (result.error || result.signal || result.status !== 0 || count === 0) {
      try { preparation?.invalidate?.(); }
      catch (error) { evidence.preparation.invalidateWarning = error.message; }
      return { ...result, status: count === 0 || result.status === 0 ? 1 : result.status,
        ...(count === 0 ? { error: new Error("Cargo preflight selected zero tests; refusing test execution") } : {}), preflight: evidence };
    }
  }
  const executionStarted = Date.now();
  const result = runManagedCargoSync(spec);
  evidence.phases.push({ phase: "execution", args: spec.args, startedUtc: new Date(executionStarted).toISOString(),
    durationMs: Date.now() - executionStarted, exitCode: result.status ?? null, signal: result.signal ?? null });
  process.stderr.write(`[cargo-preflight] ${JSON.stringify(evidence)}\n`);
  return { ...result, preflight: evidence };
}

// Preparation is an early scheduling boundary. It is never test evidence and
// deliberately leaves runCargoTest's type/selection/execution gates intact.
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

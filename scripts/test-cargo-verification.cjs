"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { PREFLIGHT, PREFLIGHT_ID, validateCargoPreflight, preflightCommands, buildCargoTestCommand, runCargoTest, prepareCargoTests } = require("./cargo-verification.cjs");

const args = ["test", "-p", "codex-core", "--lib", "filter", "--locked", "--offline", "--", "--test-threads=1"];
function commandFixture(context, name) {
  const root = path.resolve(process.env.AZRAEL_CARGO_OWNER_TEST_ROOT || "artifacts/verification/cargo-owner-tests");
  fs.mkdirSync(root, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(root, `${name}-`));
  context.after(() => {
    assert.equal(path.dirname(fixture), root);
    assert.ok(fs.lstatSync(fixture).isDirectory() && !fs.lstatSync(fixture).isSymbolicLink());
    fs.rmSync(fixture, { recursive: true });
    assert.equal(fs.existsSync(fixture), false);
  });
  return fixture;
}
test("early type preparation leases the actual target, preserves configuration and writes separate evidence", context => {
  const fixture = commandFixture(context, "early-prepare");
  const env = { CARGO_TARGET_DIR: path.join(fixture, "target"), INSTA_PENDING_DIR: path.join(fixture, "pending"), RUSTUP_TOOLCHAIN: "pinned", AZRAEL_CARGO_TARGET: "selected-triple", AZRAEL_CARGO_PROFILE: "release" };
  const logDirectory = path.join(fixture, "logs"); let calls = 0;
  context.mock.method(require("node:child_process"), "spawnSync", (_command, actualArgs, options) => {
    calls++; assert.equal(actualArgs[0], "check");
    for (const value of ["codex-core", "--features", "one", "--target", "selected-triple", "--profile", "release", "--tests"]) assert.ok(actualArgs.includes(value));
    assert.equal(options.env.RUSTUP_TOOLCHAIN, "pinned");
    assert.ok(fs.existsSync(path.join(env.CARGO_TARGET_DIR, ".azrael-cargo-owner/owner.json")));
    return { status: 101, stdout: "compiler output", stderr: "type failure" };
  });
  const result = prepareCargoTests(path.join(fixture, "source"), ["test", "-p", "codex-core", "--lib", "filter", "--features", "one"], { env, logDirectory });
  assert.equal(calls, 1); assert.equal(result.status, 101); assert.equal(result.preparation.phase, "prepare");
  assert.equal(JSON.parse(fs.readFileSync(path.join(logDirectory, "preparation.json"))).exitCode, 101);
  assert.equal(fs.readFileSync(path.join(logDirectory, "stderr.log"), "utf8"), "type failure");
  assert.throws(() => prepareCargoTests(path.join(fixture, "source"), args, { env, logDirectory }), /already contains evidence/);
  assert.equal(calls, 1);
});
test("early preparation cannot launch Cargo when a physical target already has an owner", context => {
  const fixture = commandFixture(context, "early-conflict"); const target = path.join(fixture, "target");
  fs.mkdirSync(path.join(target, ".azrael-cargo-owner"), { recursive: true });
  fs.writeFileSync(path.join(target, ".azrael-cargo-owner/owner.json"), JSON.stringify({ status: "running", run: "other-owner" }));
  context.mock.method(require("node:child_process"), "spawnSync", () => { throw Error("must not launch"); });
  assert.throws(() => prepareCargoTests(path.join(fixture, "source"), args, { env: { CARGO_TARGET_DIR: target, INSTA_PENDING_DIR: path.join(fixture, "pending") } }), /owner conflict/);
});
const summary = (passed, failed = 0, ignored = 0) => `test result: ${failed ? "FAILED" : "ok"}. ${passed} passed; ${failed} failed; ${ignored} ignored; 0 measured; 8 filtered out; finished in 0.01s\n`;

test("one actual Cargo test preserves the complete command and owner while proving execution", context => {
  const fixture = commandFixture(context, "command-contract");
  const sourceRoot = path.join(fixture, "engine");
  const env = { INSTA_PENDING_DIR: path.join(fixture, "pending") };
  const expected = buildCargoTestCommand(sourceRoot, args, { env });
  const spawn = context.mock.method(require("node:child_process"), "spawnSync", (command, actualArgs, options) => {
    const { command: expectedCommand, args: expectedArgs, selectedSourceRoot, ...expectedOptions } = expected;
    assert.equal(command, expectedCommand);
    assert.deepEqual(actualArgs, expectedArgs);
    assert.equal(options.cwd, expectedOptions.cwd);
    assert.deepEqual(options.env, expectedOptions.env);
    assert.equal(options.stdio, "pipe");
    assert.ok(fs.existsSync(path.join(options.env.CARGO_TARGET_DIR, ".azrael-cargo-owner/owner.json")));
    return { status: 0, stdout: summary(3) };
  });
  const result = runCargoTest(sourceRoot, args, { env });
  assert.equal(result.status, 0);
  assert.equal(result.preflight.actualCounts.passed, 3);
  assert.equal(result.preflight.actualCounts.executed, 3);
  assert.equal(result.preflight.phases[0].exitCode, 0);
  assert.equal(result.preflight.accepted, true);
  assert.equal(spawn.mock.callCount(), 1);
});

for (const [name, failure] of [
  ["compiler failure", { status: 101 }], ["test failure", { status: 101, stdout: summary(1, 1) }],
  ["zero tests", { status: 0, stdout: summary(0) }], ["only ignored tests", { status: 0, stdout: summary(0, 0, 2) }],
  ["missing actual summary", { status: 0, stdout: "fixture: test\n" }],
  ["unknown exit", { status: null, stdout: summary(1) }],
  ["interruption", { status: null, signal: "SIGTERM" }],
  ["inconsistent interruption", { status: 0, signal: "SIGTERM", stdout: summary(1) }],
  ["missing tool", { status: null, error: new Error("missing Cargo") }],
  ["reported failure with zero exit", { status: 0, stdout: summary(1, 1) }],
]) test(`actual verification rejects ${name} without another Cargo invocation`, context => {
  let calls = 0;
  context.mock.method(require("node:child_process"), "spawnSync", () => { calls++; return failure; });
  const fixture = commandFixture(context, `actual-${name.replaceAll(" ", "-")}`);
  const result = runCargoTest(path.join(fixture, "engine"), args, { env: { INSTA_PENDING_DIR: path.join(fixture, "pending") } });
  assert.equal(calls, 1);
  assert.ok(result.status !== 0 || result.error || result.signal);
  assert.equal(result.preflight.accepted, false);
  assert.equal(result.preflight.phases[0].exitCode, failure.status);
  if (failure.status !== 0) assert.equal(result.status, failure.status);
  if (failure.error) assert.equal(result.error, failure.error);
  if (failure.signal) assert.equal(result.signal, failure.signal);
});

test("actual summaries aggregate targets and preserve capture, exact/ignored and compilation options", context => {
  const fixture = commandFixture(context, "actual-targets");
  const env = { CARGO_TARGET_DIR: path.join(fixture, "target"), INSTA_PENDING_DIR: path.join(fixture, "pending"), AZRAEL_CARGO_TARGET: "selected-triple", AZRAEL_CARGO_PROFILE: "release" };
  const input = ["test", "-p", "crate", "--lib", "filter", "--features", "one", "--", "--exact", "--ignored"];
  const output = summary(0) + "\x1b[32m" + summary(2).trimEnd() + "\x1b[0m\r\n";
  const calls = context.mock.method(require("node:child_process"), "spawnSync", (_command, actualArgs) => {
    assert.deepEqual(actualArgs, buildCargoTestCommand(path.join(fixture, "source"), input, { env }).args);
    return { status: 0, stdout: output, stderr: "diagnostics" };
  });
  const result = runCargoTest(path.join(fixture, "source"), input, { env, capture: true,
    preparation: { mode: "auto", sourceIdentity: "old", runtimeIdentity: "old" } });
  assert.equal(calls.mock.callCount(), 1);
  assert.equal(result.status, 0); assert.equal(result.stdout, output); assert.equal(result.stderr, "diagnostics");
  assert.equal(result.preflight.actualCounts.executed, 2); assert.equal(result.preflight.actualCounts.summaries.length, 2);
  assert.equal(result.preflight.preparation, undefined);
});

test("nonexecuting requests are rejected before Cargo starts", context => {
  const fixture = commandFixture(context, "actual-nonexecuting");
  const calls = context.mock.method(require("node:child_process"), "spawnSync", () => { throw Error("must not launch"); });
  for (const input of [["test", "--no-run"], ["test", "--doc"], ["test", "--", "--list"]]) {
    assert.throws(() => runCargoTest(path.join(fixture, "engine"), input, { env: { INSTA_PENDING_DIR: path.join(fixture, "pending") } }), /executable libtest/);
  }
  assert.equal(calls.mock.callCount(), 0);
});

test("preflight preserves selectors, features, target and effective test profile", () => {
  const spec = buildCargoTestCommand("/frozen", ["test", "-p", "crate", "--lib", "filter", "--features", "one", "--locked", "--offline", "--", "--exact"], { pathImpl: path.posix, env: {} });
  assert.deepEqual(preflightCommands(spec).typeCheck.args, ["check", "-p", "crate", "--lib", "--features", "one", "--locked", "--offline", "--tests", "--profile", "test"]);
  assert.deepEqual(preflightCommands(spec).selection.args.slice(-3), ["--exact", "--list", "--format=terse"]);
  assert.throws(() => preflightCommands({ ...spec, args: ["test", "--no-run"] }), /compile-only/);
  assert.equal(PREFLIGHT.testExecution, "nonzero-passed");
  assert.equal(PREFLIGHT_ID, "selected-tests-v2");
});

test("Cargo bundles require the supported preflight contract and reject undeclared or weakened policy", () => {
  const check = { id: "engine.fixture", executable: "node", level: "native", args: ["scripts/check-api-context.cjs"] };
  assert.throws(() => validateCargoPreflight(check), /preflight declaration/);
  assert.throws(() => validateCargoPreflight({ ...check, cargoPreflight: "skip" }), /preflight declaration/);
  assert.throws(() => validateCargoPreflight({ ...check, cargoPreflight: "selected-tests-v1" }), /preflight declaration/);
  assert.doesNotThrow(() => validateCargoPreflight({ ...check, cargoPreflight: PREFLIGHT_ID }));
  assert.throws(() => validateCargoPreflight({ ...check, level: "source", cargoPreflight: PREFLIGHT_ID }), /preflight declaration/);
});

test("task recovery retains captured pass-count validation after joining the preflight gate", () => {
  for (const passed of [1, 0]) {
    let calls = 0;
    const script = fs.readFileSync(path.join(__dirname, "check-task-recovery-native.cjs"), "utf8");
    const execute = () => vm.runInNewContext(script, {
      process: { argv: ["node", "check-task-recovery-native.cjs", path.resolve("artifacts/frozen")],
        stdout: { write() {} }, stderr: { write() {} } },
      require(id) {
        if (id === "node:path") return path;
        if (id === "./cargo-verification.cjs") return { runCargoTest(_root, _args, options) {
          calls++; assert.equal(options.capture, true); assert.equal(options.isolateHostEnvironment, true);
          return { status: 0, stdout: `test result: ok. ${passed} passed; 0 failed;` };
        } };
        throw Error(`Unexpected dependency: ${id}`);
      },
    });
    if (passed) { assert.doesNotThrow(execute); assert.ok(calls > 0); }
    else { assert.throws(execute, /no passing tests/); assert.equal(calls, 1); }
  }
});
test("image checker reuses its private cache across runs and pins it throughout each batch", context => {
  // Retained: later checker preparation edits can accidentally reintroduce
  // seed copying, drop cache scope, or release protection between test filters.
  const fixture = commandFixture(context, "image-cache");
  fs.mkdirSync(path.join(fixture, "scripts"));
  fs.mkdirSync(path.join(fixture, "engine/codex-rs"), { recursive: true });
  fs.writeFileSync(path.join(fixture, "engine/codex-rs/Cargo.toml"), "[workspace]\n");
  const cache = require("./cargo-shared-cache.cjs"), lifecycle = require("./artifact-lifecycle.cjs");
  const freeze = require("./freeze-platform-inputs.cjs");
  const script = fs.readFileSync(path.join(__dirname, "check-agent-image-attachments.cjs"), "utf8");
  const targets = [], runs = [], tools = { rustc: "fixture\nhost: x86_64-pc-windows-msvc", cargo: "fixture" };
  const artifactRun = require("./artifact-run.cjs");
  let copied = 0, executions = 0, unknown = false;
  const execute = extra => {
    const fakeProcess = { argv: ["node", "checker", "all", ...extra], env: {}, exitCode: undefined };
    vm.runInNewContext(script, { __dirname: path.join(fixture, "scripts"), process: fakeProcess, console: { log() {}, error() {} }, require(id) {
      if (id === "./artifact-run.cjs") return { ...artifactRun, beginArtifactRun(...args) {
        const run = artifactRun.beginArtifactRun(...args); runs.push(run); return run;
      } };
      if (id === "./freeze-platform-inputs.cjs") return { ...freeze, copyTree(source, ...args) {
        assert.equal(source, path.join(fixture, "engine"), "Only immutable source, never Cargo target, may be copied");
        copied++; return freeze.copyTree(source, ...args);
      } };
      if (id === "./cargo-stable-source.cjs") return { inventory: () => ({ files: { manifest: { sha256: "fixture" } } }) };
      if (id === "./cargo-shared-cache.cjs") return { selectCache: options => cache.selectCache({ ...options, tools }) };
      if (id === "./cargo-verification.cjs") return { runCargoTest(sourceRoot, _args, options) {
        executions++;
        assert.equal(options.env.AZRAEL_CARGO_CACHE_SCOPE, "agent-image-attachments");
        assert.equal(options.env.AZRAEL_CARGO_CACHE_PROJECT_ROOT, fixture);
        assert.equal(options.env.CARGO_PROFILE_TEST_DEBUG, "0");
        const selection = cache.selectCache({ projectRoot: fixture, sourceRoot, env: options.env, tools });
        assert.equal(options.env.CARGO_TARGET_DIR, selection.targetDirectory);
        targets.push(selection.targetDirectory);
        const run = lifecycle.catalog(fixture).find(record => record.id === options.env.AZRAEL_CARGO_RUN_ID);
        assert.ok(run.references.some(reference => reference.id === selection.lifecycleId), "Cache remains pinned across filters");
        if (unknown) return { status: null, error: new Error("fixture lost result") };
        const active = cache.beginExecution(selection, `fixture-${executions}`);
        // Simulate only the compiler boundary; lifecycle and files are real.
        fs.mkdirSync(selection.targetDirectory, { recursive: true });
        const payload = path.join(selection.targetDirectory, "compiled-object");
        if (executions === 1) fs.writeFileSync(payload, "compiled once");
        else assert.equal(fs.readFileSync(payload, "utf8"), "compiled once");
        cache.finishExecution(active, { status: 0 }, { exitCode: 0 });
        return { status: 0, stdout: "fixture", preflight: { accepted: true, actualCounts: { executed: 1 } } };
      } };
      return require(id);
    } });
    return fakeProcess.exitCode;
  };
  assert.equal(execute(["--private-target"]), 0);
  assert.equal(execute(["--private-target"]), 0);
  assert.equal(executions, 12);
  assert.equal(new Set(targets).size, 1);
  assert.equal(copied, 2, "One immutable source copy per run, no cache copies");
  for (const run of lifecycle.catalog(fixture).filter(record => record.kind === "run")) {
    assert.equal(run.references.length, 0, "Known-stop releases only the caller's cache reference");
    const summary = JSON.parse(fs.readFileSync(path.join(run.owned_root, "reports/summary.json")));
    assert.equal(summary.cacheCopyBytes, 0);
  }
  const before = lifecycle.catalog(fixture).length;
  assert.throws(() => execute(["--private-target", "--seed-run=old-run"]), /no longer copies/);
  assert.equal(lifecycle.catalog(fixture).length, before, "Legacy seed is rejected before allocating a run");
  unknown = true;
  assert.equal(execute(["--private-target"]), 1);
  const unresolved = runs.at(-1);
  assert.equal(unresolved.producerStopped, false, "Exit hook must preserve unknown termination");
  const pending = lifecycle.catalog(fixture).find(record => record.id === unresolved.lifecycleId);
  assert.equal(pending.state, "pending");
  assert.equal(pending.producer, undefined);
  assert.equal(pending.references.length, 1);
  // This fixture launched no compiler; close its wrapper before test teardown.
  artifactRun.finishArtifactRun(unresolved, { exitCode: 1, producerStopped: true, reason: "Fixture stub returned without starting a child" });
});
for (const [platform, pathImpl, sourceRoot] of [
  ["Windows", path.win32, "C:\\frozen\\engine"],
  ["POSIX", path.posix, "/frozen/engine"],
]) {
  test(`${platform}: frozen workspace and Cargo default test profile`, () => {
    const env = { RUSTFLAGS: "-C debuginfo=1", INSTA_UPDATE: "always" };
    const result = buildCargoTestCommand(sourceRoot, args, { env, pathImpl });
    assert.equal(result.cwd, pathImpl.join(sourceRoot, "codex-rs"));
    assert.equal(result.env.CARGO_TARGET_DIR, pathImpl.join(result.cwd, "target"));
    assert.deepEqual(result.args, args);
    assert.equal(result.env.RUSTFLAGS, env.RUSTFLAGS);
    assert.equal(result.env.RUST_MIN_STACK, "33554432");
    assert.equal(result.env.INSTA_UPDATE, "no");
    assert.equal(result.windowsHide, true);
    assert.equal(result.stdio, "inherit");
    assert.deepEqual(env, { RUSTFLAGS: "-C debuginfo=1", INSTA_UPDATE: "always" });
  });
  test(`${platform}: explicit cache, target and profile precede test arguments`, () => {
    const cache = pathImpl.join(sourceRoot, "shared-target");
    const env = { CARGO_TARGET_DIR: cache, AZRAEL_CARGO_TARGET: "selected-triple", AZRAEL_CARGO_PROFILE: "dev", RUST_MIN_STACK: "67108864" };
    const result = buildCargoTestCommand(sourceRoot, args, { env, pathImpl });
    assert.equal(result.env.CARGO_TARGET_DIR, cache);
    assert.deepEqual(result.args, [...args.slice(0, -2), "--target", "selected-triple", "--profile", "dev", ...args.slice(-2)]);
    assert.equal(result.env.RUST_MIN_STACK, "67108864");
    assert.throws(() => buildCargoTestCommand(sourceRoot, args, { env: { CARGO_TARGET_DIR: "relative" }, pathImpl }), /must be absolute/);
    assert.throws(() => buildCargoTestCommand("relative", args, { env: {}, pathImpl }), /absolute frozen/);
  });
}

test("host isolation retains selected compilation settings and scrubs runtime sockets", () => {
  const result = buildCargoTestCommand("/frozen", args, {
    pathImpl: path.posix, isolateHostEnvironment: true,
    env: { AZRAEL_CARGO_TARGET: "aarch64-apple-darwin", AZRAEL_CARGO_PROFILE: "test", AZRAEL_SOCKET: "secret", CODEX_HOME: "secret", RUSTUP_TOOLCHAIN: "pinned",
      AZRAEL_CARGO_CACHE_PROJECT_ROOT: "/owner", AZRAEL_CARGO_CACHE_SCOPE: "verification", AZRAEL_CARGO_RUN_ID: "verification-r1", AZRAEL_CARGO_STABLE_SOURCE: "1", AZRAEL_CARGO_UNKNOWN: "not-an-option",
      AZRAEL_VERIFICATION_REUSE_DECISIONS_PATH: "/owner/reuse-decisions.json" },
  });
  assert.ok(result.args.includes("aarch64-apple-darwin"));
  assert.ok(result.args.includes("test"));
  assert.equal(result.env.AZRAEL_SOCKET, undefined);
  assert.equal(result.env.CODEX_HOME, undefined);
  assert.equal(result.env.AZRAEL_CARGO_PROFILE, undefined);
  assert.equal(result.env.RUSTUP_TOOLCHAIN, "pinned");
  assert.equal(result.env.AZRAEL_CARGO_CACHE_PROJECT_ROOT, "/owner");
  assert.equal(result.env.AZRAEL_CARGO_CACHE_SCOPE, "verification");
  assert.equal(result.env.AZRAEL_CARGO_RUN_ID, "verification-r1");
  assert.equal(result.env.AZRAEL_CARGO_STABLE_SOURCE, "1");
  assert.equal(result.env.AZRAEL_CARGO_UNKNOWN, undefined);
  assert.equal(result.env.AZRAEL_VERIFICATION_REUSE_DECISIONS_PATH, "/owner/reuse-decisions.json");
  for (const invalid of [
    { AZRAEL_CARGO_CACHE_PROJECT_ROOT: "/owner" },
    { AZRAEL_CARGO_CACHE_PROJECT_ROOT: "relative" }, { AZRAEL_CARGO_CACHE_PROJECT_ROOT: "/owner/../elsewhere" },
    { AZRAEL_VERIFICATION_REUSE_DECISIONS_PATH: "relative" }, { AZRAEL_VERIFICATION_REUSE_DECISIONS_PATH: "/owner/../decision.json" },
    { AZRAEL_CARGO_RUN_ID: "bad\nrun" }, { AZRAEL_CARGO_STABLE_SOURCE: "yes" },
  ]) assert.throws(() => buildCargoTestCommand("/frozen", args, {
    pathImpl: path.posix, isolateHostEnvironment: true, env: invalid,
  }), /Cargo|cache/);
});

test("isolated Cargo forwards managed ownership and preserves terminal publication diagnostics", context => {
  const fixture = commandFixture(context, "isolated-managed");
  const sourceRoot = path.join(fixture, "engine"), target = path.join(fixture, "target");
  const cache = require("./cargo-shared-cache.cjs");
  let selected = 0, began = 0, finished = 0, spawned = 0;
  const selection = { targetDirectory: target };
  context.mock.method(cache, "selectCache", options => {
    selected++;
    assert.equal(options.projectRoot, fixture);
    assert.equal(options.sourceRoot, sourceRoot);
    assert.equal(options.env.AZRAEL_CARGO_CACHE_SCOPE, "agent-image-attachments");
    return selection;
  });
  context.mock.method(cache, "beginExecution", actual => { began++; assert.equal(actual, selection); return selection; });
  const busy = Object.assign(new Error("catalog occupied"), { code: "BUSY", maintenance_code: "maintenance_busy", lock_path: path.join(fixture, "catalog.lock"),
    lease: { request_operation: "catalog_snapshot" } });
  context.mock.method(cache, "finishExecution", () => { finished++; throw busy; });
  context.mock.method(require("node:child_process"), "spawnSync", (_command, _args, options) => {
    spawned++;
    assert.equal(options.env.AZRAEL_CARGO_CACHE_PROJECT_ROOT, fixture);
    assert.equal(options.env.AZRAEL_CARGO_RUN_ID, "isolated-r1");
    assert.equal(options.env.AZRAEL_CARGO_CACHE_SCOPE, "agent-image-attachments");
    assert.equal(options.env.AZRAEL_CARGO_STABLE_SOURCE, "0");
    assert.equal(options.env.CODEX_HOME, undefined);
    assert.equal(options.env.AZRAEL_SOCKET, undefined);
    const owner = JSON.parse(fs.readFileSync(path.join(target, ".azrael-cargo-owner/owner.json")));
    assert.equal(owner.run, "isolated-r1");
    return { status: 0, stdout: summary(1) };
  });
  const result = runCargoTest(sourceRoot, args, { isolateHostEnvironment: true, capture: true, env: {
    CARGO_TARGET_DIR: target, INSTA_PENDING_DIR: path.join(fixture, "pending"),
    AZRAEL_CARGO_CACHE_PROJECT_ROOT: fixture, AZRAEL_CARGO_CACHE_SCOPE: "agent-image-attachments", AZRAEL_CARGO_RUN_ID: "isolated-r1", AZRAEL_CARGO_STABLE_SOURCE: "0",
    AZRAEL_SOCKET: "secret", CODEX_HOME: "secret",
  } });
  assert.deepEqual([selected, began, spawned, finished], [1, 1, 1, 1]);
  assert.equal(result.preflight.phases[0].exitCode, 0);
  assert.equal(result.status, 1);
  assert.equal(result.preflight.accepted, false);
  const [details] = result.preflight.ownershipErrors;
  assert.equal(details.maintenance_code, "maintenance_busy");
  assert.equal(details.lock_path, busy.lock_path);
  assert.deepEqual(details.lease, busy.lease);
  assert.equal(result.preflight.error.cause.message, "catalog occupied");
});

const cases = [
  ["check-api-context", "prompts", [["codex-prompts", "api_projection"], ["codex-prompts", "configured_canonical_hint"]]],
  ["check-api-context", "skills", [["codex-skills-extension", "api_host_dedup"]]],
  ["check-api-context", "core", [["codex-core", "instruction_state_projection"], ["codex-core", "multi_agent_mode::tests"]]],
  ["check-model-harness-profiles", "config", [["codex-config", "harness"], ["codex-prompts", "model_instructions"], ["codex-prompts", "multi_agent_instructions"]]],
  ["check-model-harness-profiles", "tools", [["codex-core", "anthropic_shared_tools"], ["codex-core", "anthropic_common_discovery"], ["codex-core", "anthropic_azrael_tools_patch_read_and_execute"], ["codex-core", "tools::router::tests::chat_discovery"], ["codex-core", "mcp_and_tool_search_follow_direct_and_deferred_tool_exposure"], ["codex-core", "retired_model_harness_is_rejected_during_config_load"]]],
  ["check-task-work-time-native", "protocol", [["codex-app-server-protocol", "thread_history"]]],
  ["check-task-work-time-native", "store", [["codex-thread-store", "recorded_turn_attribution"], ["codex-thread-store", "deferred_turn_duration_stays_frozen_after_a_new_turn"]]],
  ["check-task-work-time-native", "appserver", [["codex-app-server", "bespoke_event_handling::tests::test_handle_turn_"], ["codex-app-server", "test_emit_turn_deferred_preserves_frozen_timing"]]],
  ["check-root-resume-reasoning", undefined, [[["codex-core", "codex-protocol", "codex-state"], "root_resume"]]],
  ["check-thread-auto-compaction", undefined, [[["codex-core", "codex-protocol", "codex-app-server-protocol", "codex-app-server"], "auto_compaction"], ["codex-core", "auto_compaction", "all"]]],
];

function runWrapper(name, scope, result = { status: 0 }) {
  const calls = [];
  const sourceRoot = path.resolve("artifacts", "verification", "cargo-fixture");
  const processStub = { argv: [process.execPath, `${name}.cjs`, sourceRoot, ...scope ? [scope] : []], env: {}, exitCode: undefined };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, `${name}.cjs`), "utf8"), {
    process: processStub,
    require(id) {
      if (id === "node:fs") return { statSync() { return { isFile: () => true }; } };
      if (id === "node:path") return path;
      if (id === "./cargo-verification.cjs") return { runCargoTest(root, input, options) {
        calls.push(buildCargoTestCommand(root, Array.from(input), { ...options, env: {} }));
        return result;
      } };
      throw new Error(`Unexpected dependency: ${id}`);
    },
  }, { filename: `${name}.cjs` });
  return { calls, exitCode: processStub.exitCode };
}

for (const [name, scope, expected] of cases) {
  test(`${name} ${scope || ""}: preserves every package/filter and Cargo reuse`, () => {
    const { calls } = runWrapper(name, scope);
    assert.equal(calls.length, expected.length);
    for (let index = 0; index < calls.length; index++) {
      const [crates, filter, integration] = expected[index];
      const packages = (Array.isArray(crates) ? crates : [crates]).flatMap(crate => ["-p", crate]);
      assert.deepEqual(calls[index].args, ["test", ...packages, ...integration ? ["--test", integration, "--features", "codex-core/integration-tests"] : ["--lib"], filter, "--locked", "--offline", "--", "--test-threads=1"]);
      assert.equal(calls[index].env.CARGO_TARGET_DIR, path.join(calls[index].cwd, "target"));
    }
    if (calls.length > 1) assert.deepEqual(calls[0].env, calls[1].env);
  });
  test(`${name} ${scope || ""}: first failure stops subsequent filters`, () => {
    const failure = runWrapper(name, scope, { status: 7 });
    assert.equal(failure.calls.length, 1);
    assert.equal(failure.exitCode, 7);
    const signalled = runWrapper(name, scope, { status: null });
    assert.equal(signalled.exitCode, 1);
    assert.throws(() => runWrapper(name, scope, { error: new Error("Cargo unavailable") }), /Cargo unavailable/);
  });
}

function runSharedNative({ platform = "win32", scope = "appserver", artifacts, listing = {}, compile = {}, runtime = {}, env = {}, imported = false, invoke, ordinaryResult = { status: 0 } } = {}) {
  const root = path.resolve("artifacts", "verification", "selected-frozen-engine");
  const calls = [], ordinary = [], output = { stdout: "", stderr: "" };
  const processStub = {
    argv: imported ? [] : [process.execPath, "check-shared-engine-native.cjs", root, scope], platform, env,
    stdout: { write(value) { output.stdout += value; } }, stderr: { write(value) { output.stderr += value; } },
  };
  const moduleStub = { exports: {} };
  let error;
  const requireStub = id => {
    if (id === "node:fs") return { statSync() { return { isFile: () => true }; } };
    if (id === "node:path") return path;
    if (id === "./cargo-verification.cjs") return {
      runManagedCargoSync(spec) { const { command, args, ...options } = spec; return requireStub("node:child_process").spawnSync(command, args, options); },
      buildCargoTestCommand(sourceRoot, args, options) { return buildCargoTestCommand(sourceRoot, Array.from(args), { ...options, env }); },
      preflightCommands(spec) { return preflightCommands(spec); },
      runCargoTest(sourceRoot, args, options) { ordinary.push({ sourceRoot, args: Array.from(args), options }); return ordinaryResult; },
    };
    if (id === "node:child_process") return { spawnSync(command, args, options) {
      calls.push({ command, args: Array.from(args), options });
      if (command === "cargo") {
        const crate = args[args.indexOf("-p") + 1];
        const directory = crate === "codex-utils-pty" ? path.join("utils", "pty") : "app-server-daemon";
        const artifact = {
          reason: "compiler-artifact", manifest_path: path.join(root, "codex-rs", directory, "Cargo.toml"),
          package_id: `selected-frozen-${crate}`, profile: { test: true }, executable: path.join(root, "selected-target", `${crate}-tests.exe`),
          target: { name: crate.replaceAll("-", "_"), kind: ["lib"], src_path: path.join(root, "codex-rs", directory, "src", "lib.rs") },
        };
        return { status: 0, stdout: (artifacts ? artifacts(artifact) : [artifact]).map(value => typeof value === "string" ? value : JSON.stringify(value)).join("\n"),
          stderr: "compiler diagnostics\n", ...compile };
      }
      if (args.includes("--list")) return { status: 0, stdout: "selected_native: test\n", ...listing };
      return { status: 0, stdout: "native test diagnostics\n", stderr: "native stderr\n", ...runtime };
    } };
    throw new Error(`Unexpected dependency: ${id}`);
  };
  requireStub.main = imported ? {} : moduleStub;
  try {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "check-shared-engine-native.cjs"), "utf8"), {
      process: processStub, require: requireStub, module: moduleStub,
    }, { filename: "check-shared-engine-native.cjs" });
    if (invoke) {
      const result = moduleStub.exports.runWindowsNativeTests(root, ...invoke);
      if (result.error) throw result.error;
      if (result.status !== 0) processStub.exitCode = result.status ?? 1;
    }
  } catch (caught) { error = caught; }
  return { root, calls, ordinary, output, error, exitCode: processStub.exitCode, exported: moduleStub.exports };
}

test("bridge scope runs remote library and terminal binary tests separately without embedded features", () => {
  const result = runSharedNative({ scope: "bridge" });
  assert.equal(result.error, undefined);
  assert.equal(result.calls.length, 0);
  assert.deepEqual(result.ordinary.map(call => call.args), [
    ["test", "-p", "codex-app-server-client", "--no-default-features", "--lib", "remote::tests::", "--locked", "--offline", "--", "--test-threads=1"],
    ["test", "-p", "codex-app-server-client", "--no-default-features", "--bin", "azrael-bridge", "terminal_", "--locked", "--offline", "--", "--test-threads=1"],
  ]);
  assert.ok(result.ordinary.every(call => call.options.isolateHostEnvironment === true));
});

const nativeGroups = [
  ["codex-utils-pty", "windows_tests::"],
  ["codex-app-server-daemon", "backend::pid::tests::"],
];

test("Windows native helper forwards frozen source and Cargo arguments to the identified libtest", () => {
  for (const [crate, filter] of nativeGroups) {
    const result = runSharedNative({
      imported: true, invoke: [crate, filter],
      env: { AZRAEL_SOCKET: "private", CODEX_HOME: "private", AZRAEL_CARGO_TARGET: "selected-triple", AZRAEL_CARGO_PROFILE: "test", RUSTUP_TOOLCHAIN: "pinned" },
      artifacts: artifact => [
        { ...artifact, manifest_path: path.join(path.dirname(artifact.manifest_path), "other", "Cargo.toml"), executable: path.join(path.dirname(artifact.executable), "wrong.exe") },
        { ...artifact, profile: { test: false } }, artifact,
      ],
    });
    assert.equal(result.error, undefined);
    const compile = result.calls.find(call => call.command === "cargo");
    const list = result.calls.find(call => call.args.includes("--list"));
    const direct = result.calls.find(call => call.command !== "cargo" && !call.args.includes("--list"));
    assert.deepEqual(list.args, [filter, "--list", "--format=terse"]);
    assert.equal(compile.command, "cargo");
    assert.deepEqual(compile.args, ["test", "-p", crate, "--lib", filter, "--locked", "--offline", "--no-run", "--message-format=json", "--target", "selected-triple", "--profile", "test"]);
    assert.equal(direct.command, path.join(result.root, "selected-target", `${crate}-tests.exe`));
    assert.equal(list.command, direct.command);
    assert.deepEqual(direct.args, [filter, "--test-threads=1", ...(crate === "codex-utils-pty" ? ["--nocapture"] : [])]);
    assert.equal(direct.options.cwd, path.join(result.root, "codex-rs"));
    assert.deepEqual(direct.options.env, compile.options.env);
    assert.equal(direct.options.env.CODEX_HOME, undefined);
    assert.equal(direct.options.env.AZRAEL_SOCKET, undefined);
    assert.equal(direct.options.env.RUSTUP_TOOLCHAIN, "pinned");
    assert.equal(direct.options.env.INSTA_UPDATE, "no");
    assert.equal(direct.options.windowsHide, true);
    assert.equal(compile.options.cwd, path.join(result.root, "codex-rs"));
    assert.match(result.output.stdout, /native test diagnostics/);
    assert.match(result.output.stderr, /compiler diagnostics[\s\S]*native stderr/);
  }
});

test("Windows PTY runtime discovers inbox PowerShell modules without changing Cargo or daemon environments", () => {
  const env = { PSModulePath: "portable-pwsh-modules", psmodulepath: "duplicate-case", RUSTUP_TOOLCHAIN: "pinned" };
  for (const [crate, filter] of nativeGroups) {
    const result = runSharedNative({ imported: true, invoke: [crate, filter], env });
    assert.equal(result.error, undefined);
    for (const call of result.calls) {
      const stripsModules = crate === "codex-utils-pty" && call.command !== "cargo";
      assert.equal(call.options.env.PSModulePath, stripsModules ? undefined : "portable-pwsh-modules");
      assert.equal(call.options.env.psmodulepath, stripsModules ? undefined : "duplicate-case");
      assert.equal(call.options.env.RUSTUP_TOOLCHAIN, "pinned");
    }
  }
  assert.deepEqual(env, { PSModulePath: "portable-pwsh-modules", psmodulepath: "duplicate-case", RUSTUP_TOOLCHAIN: "pinned" });
});

test("default native scopes forward only selected omission guards on each supported OS", () => {
  const selections = {
    appserver: [
      ["codex-app-server-daemon", "azrael_storage::tests::"],
      ["codex-app-server-daemon", "registration::tests::"],
      ["codex-app-server-daemon", "backend::pid::tests::update_loop_uses_hidden_app_server_subcommand"],
      ["codex-app-server-daemon", "backend::pid::tests::app_server_remote_control_uses_runtime_flag"],
      ["codex-app-server-daemon", "backend::pid::tests::app_server_disabled_remote_control_uses_compatible_args_and_runtime_env"],
      ["codex-install-context", "azrael_entry_resolves_its_own_code_mode_host"],
      ["codex-app-server", "entry::tests::azrael_proxy_preserves_global_startup_options_and_rejects_listener_changes", "azrael"],
    ],
    handoff: [
      ["codex-app-server-daemon", "session_handoff::tests::real_websocket_sessions_callbacks_busy_release_and_no_turn_replay"],
      ["codex-app-server-daemon", "session_handoff::tests::read_only_preview_reads_source_then_reauthenticates_before_resume"],
      ["codex-app-server", "azrael_session_handoff::tests::target_resume_preserves_source_computer_use_ceiling_including_absence"],
      ["codex-app-server", "azrael_session_handoff::tests::scoped_source_resume_keeps_presentation_and_strips_all_runtime_overrides"],
      ["codex-app-server", "azrael_session_handoff::tests::nonapproval_callback_has_exact_thread_ownership_until_canceled"],
      ["codex-app-server", "azrael_session_handoff::tests::scope_does_not_grant_account_or_other_session_authority"],
    ],
  };
  for (const platform of ["win32", "linux", "darwin"]) {
    for (const [scope, selected] of Object.entries(selections)) {
      const result = runSharedNative({ platform, scope });
      assert.equal(result.error, undefined);
      assert.deepEqual(result.ordinary.map(call => call.args), selected.map(([crate, filter, bin]) =>
        ["test", "-p", crate, ...(bin ? ["--bin", bin] : ["--lib"]), filter, "--locked", "--offline", "--", "--test-threads=1"]));
      assert.ok(result.ordinary.every(call => call.sourceRoot === result.root && call.options.isolateHostEnvironment === true));
      assert.deepEqual(result.calls, []);
    }
  }
});

test("importing Windows native runner exports a reusable helper without CLI side effects", () => {
  const result = runSharedNative({ imported: true });
  assert.equal(result.error, undefined);
  assert.equal(typeof result.exported.runWindowsNativeTests, "function");
  assert.equal(result.calls.length, 0);
  assert.equal(result.ordinary.length, 0);
  assert.deepEqual(result.output, { stdout: "", stderr: "" });
});

for (const crate of ["codex-app-server-daemon", "codex-utils-pty"]) {
  const invoke = [crate, crate === "codex-utils-pty" ? "windows_tests::" : "backend::pid::tests::"];
  test(`${crate}: direct execution rejects empty or interrupted listing`, () => {
    for (const listing of [{ status: 0, stdout: "0 tests, 0 benchmarks\n" }, { status: 1 }, { status: null, signal: "SIGTERM" }]) {
      const result = runSharedNative({ imported: true, invoke, listing });
      assert.ok(result.calls.every(call => call.command === "cargo" || call.args.includes("--list")));
      assert.ok(result.error || result.exitCode !== 0);
    }
  });
  test(`${crate}: native runner rejects missing, foreign, ambiguous and malformed Cargo artifacts`, () => {
    for (const artifacts of [
      () => [],
      artifact => [{ ...artifact, manifest_path: path.join(path.dirname(artifact.manifest_path), "foreign", "Cargo.toml") }],
      artifact => [{ ...artifact, target: { ...artifact.target, src_path: path.join(path.dirname(artifact.target.src_path), "foreign.rs") } }],
      artifact => [{ ...artifact, target: { ...artifact.target, name: "foreign_target" } }],
      artifact => [{ ...artifact, target: { ...artifact.target, kind: ["bin"] } }],
      artifact => [artifact, { ...artifact, executable: path.join(path.dirname(artifact.executable), "second.exe") }],
      () => ["not JSON"],
      artifact => [{ ...artifact, executable: "relative.exe" }],
    ]) {
      const result = runSharedNative({ imported: true, invoke, artifacts });
      assert.ok(result.error);
      assert.ok(result.calls.every(call => call.command === "cargo"));
      assert.equal(result.ordinary.length, 0);
      assert.match(result.output.stderr, /compiler diagnostics/);
    }
  });

  test(`${crate}: native runner propagates compile and runtime failures without continuing`, () => {
    for (const [stage, failure, expectedStatus] of [
      ["compile", { status: 7 }, 7], ["runtime", { status: 9 }, 9],
      ["compile", { status: null, signal: "SIGTERM" }, 1], ["runtime", { status: null, signal: "SIGTERM" }, 1],
    ]) {
      const result = runSharedNative({ imported: true, invoke, [stage]: failure });
      assert.equal(result.error, undefined);
      assert.equal(result.exitCode, expectedStatus);
      if (stage === "compile") assert.ok(result.calls.every(call => call.command === "cargo"));
      assert.equal(result.ordinary.length, 0);
    }
    for (const stage of ["compile", "runtime"]) {
      const failure = new Error(`${stage} spawn failed`);
      const result = runSharedNative({ imported: true, invoke, [stage]: { error: failure, stdout: "partial diagnostics\n" } });
      assert.equal(result.error, failure);
      assert.match(result.output.stdout, /partial diagnostics/);
      assert.equal(result.ordinary.length, 0);
    }
  });
}

test("CLI propagates Cargo failures without running later selected filters", () => {
  for (const ordinaryResult of [{ status: 7 }, { status: null }, { error: new Error("Cargo unavailable") }]) {
    const result = runSharedNative({ ordinaryResult });
    if (ordinaryResult.error) assert.equal(result.error, ordinaryResult.error);
    else assert.equal(result.exitCode, ordinaryResult.status ?? 1);
    assert.deepEqual(result.ordinary.map(call => call.args[4]), ["azrael_storage::tests::"]);
  }
});

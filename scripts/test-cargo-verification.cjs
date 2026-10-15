"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { buildCargoTestCommand, runCargoTest } = require("./cargo-verification.cjs");

const args = ["test", "-p", "codex-core", "--lib", "filter", "--locked", "--offline", "--", "--test-threads=1"];
test("execution uses the same pure command contract without additional compile calls", context => {
  const sourceRoot = path.resolve("artifacts", "verification", "cargo-fixture");
  const expected = buildCargoTestCommand(sourceRoot, args, { env: {} });
  const spawn = context.mock.method(require("node:child_process"), "spawnSync", (command, actualArgs, options) => {
    const { command: expectedCommand, args: expectedArgs, ...expectedOptions } = expected;
    assert.equal(command, expectedCommand);
    assert.deepEqual(actualArgs, expectedArgs);
    assert.deepEqual(options, expectedOptions);
    return { status: 0 };
  });
  assert.deepEqual(runCargoTest(sourceRoot, args, { env: {} }), { status: 0 });
  assert.equal(spawn.mock.callCount(), 1);
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
    env: { AZRAEL_CARGO_TARGET: "aarch64-apple-darwin", AZRAEL_CARGO_PROFILE: "test", AZRAEL_SOCKET: "secret", CODEX_HOME: "secret", RUSTUP_TOOLCHAIN: "pinned" },
  });
  assert.ok(result.args.includes("aarch64-apple-darwin"));
  assert.ok(result.args.includes("test"));
  assert.equal(result.env.AZRAEL_SOCKET, undefined);
  assert.equal(result.env.CODEX_HOME, undefined);
  assert.equal(result.env.AZRAEL_CARGO_PROFILE, undefined);
  assert.equal(result.env.RUSTUP_TOOLCHAIN, "pinned");
});

const cases = [
  ["check-api-context", "prompts", [["codex-prompts", "api_projection"], ["codex-prompts", "configured_canonical_hint"]]],
  ["check-api-context", "skills", [["codex-skills-extension", "api_host_dedup"]]],
  ["check-api-context", "core", [["codex-core", "instruction_state_projection"], ["codex-core", "multi_agent_mode::tests"]]],
  ["check-model-harness-profiles", "config", [["codex-config", "harness"]]],
  ["check-model-harness-profiles", "tools", [["codex-core", "claude"], ["codex-core", "anthropic_profile_replaces_native_tools_and_other_providers_exclude_compatible_tools"], ["codex-core", "tools::router::tests::chat_discovery"], ["codex-core", "mcp_and_tool_search_follow_direct_and_deferred_tool_exposure"]]],
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
      assert.deepEqual(calls[index].args, ["test", ...packages, ...integration ? ["--test", integration] : ["--lib"], filter, "--locked", "--offline", "--", "--test-threads=1"]);
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

function runSharedNative({ platform = "win32", artifacts, compile = {}, runtime = {}, env = {}, imported = false, invoke } = {}) {
  const root = path.resolve("artifacts", "verification", "selected-frozen-engine");
  const calls = [], ordinary = [], output = { stdout: "", stderr: "" };
  const processStub = {
    argv: imported ? [] : [process.execPath, "check-shared-engine-native.cjs", root, "appserver"], platform, env,
    stdout: { write(value) { output.stdout += value; } }, stderr: { write(value) { output.stderr += value; } },
  };
  const moduleStub = { exports: {} };
  let statCalls = 0, error;
  const requireStub = id => {
    if (id === "node:fs") return { statSync() { statCalls++; return { isFile: () => true }; } };
    if (id === "node:path") return path;
    if (id === "./cargo-verification.cjs") return {
      buildCargoTestCommand(sourceRoot, args, options) { return buildCargoTestCommand(sourceRoot, Array.from(args), { ...options, env }); },
      runCargoTest(sourceRoot, args, options) { ordinary.push({ sourceRoot, args: Array.from(args), options }); return { status: 0 }; },
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
  return { root, calls, ordinary, output, error, exitCode: processStub.exitCode, exported: moduleStub.exports, statCalls };
}

const nativeGroups = [
  ["codex-utils-pty", "windows_tests::"],
  ["codex-utils-pty", "win::process_tree::tests::"],
  ["codex-utils-pty", "pipe::tests::process_fallback_interrupt_terminates_root"],
  ["codex-app-server-daemon", "backend::pid::tests::"],
];

test("Windows native PTY and daemon groups compile selected frozen libtests then execute them outside Cargo", () => {
  const result = runSharedNative({
    env: { AZRAEL_SOCKET: "private", CODEX_HOME: "private", AZRAEL_CARGO_TARGET: "selected-triple", AZRAEL_CARGO_PROFILE: "test", RUSTUP_TOOLCHAIN: "pinned" },
    artifacts: artifact => [
      { ...artifact, manifest_path: path.join(path.dirname(artifact.manifest_path), "other", "Cargo.toml"), executable: path.join(path.dirname(artifact.executable), "wrong.exe") },
      { ...artifact, profile: { test: false } }, artifact,
    ],
  });
  assert.equal(result.error, undefined);
  assert.equal(result.calls.length, nativeGroups.length * 2);
  for (const [index, [crate, filter]] of nativeGroups.entries()) {
    const [compile, direct] = result.calls.slice(index * 2, index * 2 + 2);
    assert.equal(compile.command, "cargo");
    assert.deepEqual(compile.args, ["test", "-p", crate, "--lib", filter, "--locked", "--offline", "--no-run", "--message-format=json", "--target", "selected-triple", "--profile", "test"]);
    assert.equal(direct.command, path.join(result.root, "selected-target", `${crate}-tests.exe`));
    assert.deepEqual(direct.args, [filter, "--test-threads=1", ...(crate === "codex-utils-pty" ? ["--nocapture"] : [])]);
    assert.equal(direct.options.cwd, path.join(result.root, "codex-rs"));
    assert.deepEqual(direct.options.env, compile.options.env);
    assert.equal(direct.options.env.CODEX_HOME, undefined);
    assert.equal(direct.options.env.AZRAEL_SOCKET, undefined);
    assert.equal(direct.options.env.RUSTUP_TOOLCHAIN, "pinned");
    assert.equal(direct.options.env.INSTA_UPDATE, "no");
    assert.equal(direct.options.windowsHide, true);
    assert.ok(Number.isSafeInteger(direct.options.maxBuffer) && direct.options.maxBuffer > 0);
    assert.equal(direct.options.encoding, "utf8");
  }
  assert.match(result.output.stdout, /native test diagnostics/);
  assert.match(result.output.stderr, /compiler diagnostics[\s\S]*native stderr/);
  assert.equal(result.ordinary.length, 6);
  assert.ok(!result.ordinary.some(call => call.args.includes("codex-utils-pty") || call.args.includes("backend::pid::tests::")));
  assert.ok(result.ordinary.some(call => call.args.includes("azrael::tests::")));
});

test("native direct execution is Windows scoped", () => {
  const result = runSharedNative({ platform: "linux" });
  assert.equal(result.error, undefined);
  assert.equal(result.calls.length, 0);
  const group = result.ordinary.find(call => call.args.includes("backend::pid::tests::"));
  assert.deepEqual(group.args, ["test", "-p", "codex-app-server-daemon", "--lib", "backend::pid::tests::", "--locked", "--offline", "--", "--test-threads=1"]);
  assert.ok(!result.ordinary.some(call => call.args.includes("codex-utils-pty")));
});

test("importing Windows native runner exports a reusable helper without CLI side effects", () => {
  const result = runSharedNative({ imported: true });
  assert.equal(result.error, undefined);
  assert.equal(typeof result.exported.runWindowsNativeTests, "function");
  assert.equal(result.calls.length, 0);
  assert.equal(result.ordinary.length, 0);
  assert.equal(result.statCalls, 0);
  assert.deepEqual(result.output, { stdout: "", stderr: "" });
});

for (const crate of ["codex-app-server-daemon", "codex-utils-pty"]) {
  const invoke = [crate, crate === "codex-utils-pty" ? "windows_tests::" : "backend::pid::tests::"];
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
      assert.equal(result.calls.length, 1);
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
      assert.equal(result.calls.length, stage === "compile" ? 1 : 2);
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

test("CLI stops subsequent native groups after the first compile or test failure", () => {
  for (const stage of ["compile", "runtime"]) {
    const result = runSharedNative({ [stage]: { status: 7 } });
    assert.equal(result.error, undefined);
    assert.equal(result.exitCode, 7);
    assert.equal(result.calls.length, stage === "compile" ? 1 : 2);
    assert.equal(result.ordinary.length, 0);
  }
});

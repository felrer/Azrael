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

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

// Execute the actual wrappers with an in-memory Cargo boundary. No workspace,
// compilation, host state, or temporary fixture is needed for these contracts.
const sourceRoot = path.resolve("frozen engine fixture");
test('shared guidance and Python diagnostics retain each feature with identical invocation', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'azrael-feature-contracts.json'), 'utf8'));
  const check = id => manifest.features.flatMap(feature => feature.checks).find(item => item.id === id);
  const guidance = ['engine.parent-requests.guidance', 'engine.model-harness-profiles.guidance', 'tool.project-maintenance.guidance'].map(check);
  for (const item of guidance) {
    assert.equal(item.level, 'source');
    assert.equal(item.executable, 'node');
    assert.deepEqual(item.args, ['--test', 'scripts/test-common-agent-instructions.cjs']);
  }
  const diagnostics = ['engine.provider-context.safe-context-export', 'engine.error-classification.export'].map(check);
  for (const item of diagnostics) {
    assert.equal(item.executable, 'python');
    assert.deepEqual(item.args, ['-B', 'scripts/tests/test_inspect_native_azrael_errors.py']);
  }
});
function runWrapper(name, args = [sourceRoot], results = [{ status: 0 }], workspaceExists = true) {
  const calls = [];
  const processStub = { argv: [process.execPath, name, ...args], exitCode: undefined };
  let error;
  try {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, name), "utf8"), {
      process: processStub,
      require(id) {
        if (id === "node:path") return path;
        if (id === "node:fs") return { statSync(file) {
          assert.equal(file, path.join(sourceRoot, "codex-rs", "Cargo.toml"));
          return { isFile: () => workspaceExists };
        } };
        if (id === "./cargo-verification.cjs") return { runCargoTest(root, args, options) {
          assert.equal(root, sourceRoot);
          calls.push({ args: Array.from(args), options: options && { ...options } });
          return results[calls.length - 1] ?? { status: 0 };
        } };
        throw new Error(`Unexpected dependency: ${id}`);
      },
    }, { filename: name });
  } catch (caught) {
    error = caught;
  }
  return { calls, exitCode: processStub.exitCode, error };
}

const parent = "check-parent-requests.cjs";
const compaction = "check-thread-auto-compaction.cjs";
const libArgs = [
  "test", "-p", "codex-core", "-p", "codex-protocol", "-p", "codex-app-server-protocol", "-p", "codex-app-server",
  "--lib", "auto_compaction", "--locked", "--offline", "--", "--test-threads=1",
];
const integrationArgs = [
  "test", "-p", "codex-core", "--test", "all", "--features", "codex-core/integration-tests", "auto_compaction", "--locked", "--offline", "--", "--test-threads=1",
];

test("parent requests drops only codex-protocol and retains filters and host isolation", () => {
  const result = runWrapper(parent);
  assert.equal(result.error, undefined);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.calls, [{ args: [
    "test", "-p", "codex-core", "-p", "codex-prompts", "-p", "codex-state", "-p", "codex-app-server-protocol", "-p", "codex-thread-store",
    "--lib", "--locked", "--offline", "--", "--test-threads=1", "--nocapture", "parent_request", "parent_response_wait",
  ], options: { isolateHostEnvironment: true } }]);
});

for (const [scope, expected] of [
  [undefined, [libArgs, integrationArgs]],
  ["all", [libArgs, integrationArgs]],
  ["lib", [libArgs]],
  ["integration", [integrationArgs]],
]) {
  const args = scope === undefined ? [sourceRoot] : [sourceRoot, scope];
  test(`auto-compaction ${scope ?? "default"} selects only the requested Cargo boundaries`, () => {
    const result = runWrapper(compaction, args);
    assert.equal(result.error, undefined);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.calls, expected.map(args => ({ args, options: undefined })));
  });
  for (const [cargoResult, expectedCode] of [[{ status: 7 }, 7], [{ status: null }, 1]]) {
    test(`auto-compaction ${scope ?? "default"} stops and preserves failure ${expectedCode}`, () => {
      const result = runWrapper(compaction, args, [cargoResult]);
      assert.equal(result.error, undefined);
      assert.equal(result.exitCode, expectedCode);
      assert.equal(result.calls.length, 1);
    });
  }
}

test("auto-compaction all preserves an integration failure after lib success", () => {
  const result = runWrapper(compaction, [sourceRoot, "all"], [{ status: 0 }, { status: 19 }]);
  assert.equal(result.error, undefined);
  assert.equal(result.exitCode, 19);
  assert.equal(result.calls.length, 2);
});

for (const [name, args, results, expectedCalls] of [
  [parent, [sourceRoot], [], 1],
  [compaction, [sourceRoot, "lib"], [], 1],
  [compaction, [sourceRoot, "integration"], [], 1],
  [compaction, [sourceRoot], [{ status: 0 }], 2],
]) {
  test(`${name} ${args[1] ?? "default"} propagates Cargo launch errors`, () => {
    const launchError = new Error("mock Cargo launch failure");
    const result = runWrapper(name, args, [...results, { error: launchError, status: null }]);
    assert.equal(result.error, launchError);
    assert.equal(result.calls.length, expectedCalls);
  });
}

for (const cargoResult of [{ status: 23 }, { status: null }]) {
  test(`parent requests preserves failure ${cargoResult.status ?? "null"}`, () => {
    const result = runWrapper(parent, [sourceRoot], [cargoResult]);
    assert.equal(result.error, undefined);
    assert.equal(result.exitCode, cargoResult.status ?? 1);
    assert.equal(result.calls.length, 1);
  });
}

for (const [name, invalidArgs] of [
  [parent, [[], ["relative"], [sourceRoot, "lib"]]],
  [compaction, [[], ["relative"], [sourceRoot, "unknown"], [sourceRoot, ""], [sourceRoot, "ALL"], [sourceRoot, "lib", "extra"]]],
]) {
  test(`${name} rejects invalid arguments before Cargo`, () => {
    for (const args of invalidArgs) {
      const result = runWrapper(name, args);
      assert.match(result.error?.message ?? "", /Usage:/);
      assert.equal(result.calls.length, 0);
    }
  });
  test(`${name} rejects a missing workspace before Cargo`, () => {
    const result = runWrapper(name, [sourceRoot], undefined, false);
    assert.match(result.error?.message ?? "", /no Cargo workspace/);
    assert.equal(result.calls.length, 0);
  });
}

"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runCargoTest, buildCargoTestCommand } = require("./cargo-verification.cjs");
const { preparationContext } = require("./cargo-test-preparation.cjs");

function fixture(context) {
  const base = path.resolve(process.env.AZRAEL_CARGO_OWNER_TEST_ROOT || "artifacts/verification/cargo-owner-tests");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "reuse-"));
  context.after(() => {
    assert.equal(path.dirname(root), base);
    assert.ok(path.basename(root).startsWith("reuse-"));
    assert.ok(fs.lstatSync(root).isDirectory() && !fs.lstatSync(root).isSymbolicLink());
    fs.rmSync(root, { recursive: true });
    assert.equal(fs.existsSync(root), false);
  });
  const options = { env: { CARGO_TARGET_DIR: path.join(root, "target"), INSTA_PENDING_DIR: path.join(root, "pending") },
    preparation: { directory: path.join(root, "preparation"), sourceIdentity: "frozen-one", runtimeIdentity: "measured-tools-and-config" } };
  const calls = [];
  let response;
  context.mock.method(require("node:child_process"), "spawnSync", (command, args, execution) => {
    calls.push({ command, args, execution });
    return response?.(args) || { status: 0, stdout: args.includes("--list") ? "selected: test\n" : "test result: ok. 1 passed\n" };
  });
  return { root, options, calls, setResponse(value) { response = value; }, run(filter, extra = [], overrides = {}) {
    return runCargoTest(path.join(root, "engine"), ["test", "--lib", filter, ...extra, "--", "--test-threads=1"], { ...options, ...overrides });
  } };
}

test("same preparation skips repeated type checking but selects and executes each filter", context => {
  const f = fixture(context);
  assert.equal(f.run("first").status, 0);
  const second = f.run("second");
  assert.equal(second.status, 0);
  assert.equal(second.preflight.preparation.action, "reuse");
  assert.equal(second.preflight.preparation.recommendation, "reuse-recommended");
  assert.equal(f.calls.filter(call => call.args[0] === "check").length, 1);
  assert.equal(f.calls.filter(call => call.args.includes("--list")).length, 2);
  assert.equal(f.calls.filter(call => call.args[0] === "test" && !call.args.includes("--list")).length, 2);
  assert.ok(f.calls.at(-1).args.includes("second"));
  assert.ok(Number.isFinite(second.preflight.preparation.previousPreparationMs));
});

test("input, features, target, toolchain and explicit fresh preparation preserve preparation boundaries", context => {
  const f = fixture(context); f.run("first");
  const variants = [
    { preparation: { ...f.options.preparation, sourceIdentity: "frozen-two" } },
    { preparation: { ...f.options.preparation, runtimeIdentity: "updated-tools-or-config" } },
    { env: { ...f.options.env, RUSTUP_TOOLCHAIN: "another" } },
    { env: { ...f.options.env, CARGO_TARGET_DIR: path.join(f.root, "another-target") } },
    { preparation: { ...f.options.preparation, mode: "fresh" } },
  ];
  for (const overrides of variants) {
    const before = f.calls.length;
    const result = f.run("next", [], overrides);
    assert.equal(result.status, 0); assert.equal(f.calls[before].args[0], "check");
  }
  const before = f.calls.length; f.run("feature", ["--features", "different"]);
  assert.equal(f.calls[before].args[0], "check");
});

test("advice mode keeps normal execution even when reuse is recommended", context => {
  const f = fixture(context); f.run("first");
  const before = f.calls.length;
  const result = f.run("next", [], { preparation: { ...f.options.preparation, mode: "advice" } });
  assert.equal(result.preflight.preparation.recommendation, "reuse-recommended");
  assert.equal(result.preflight.preparation.action, "advice-only");
  assert.equal(f.calls[before].args[0], "check");
});

test("ownership labels and pending output locations remain compilation inputs", context => {
  const f = fixture(context);
  f.run("first", [], { env: { ...f.options.env, AZRAEL_CARGO_RUN_ID: "first-run" } });
  const result = f.run("second", [], { env: { ...f.options.env, AZRAEL_CARGO_RUN_ID: "second-run" } });
  assert.equal(result.status, 0);
  assert.equal(result.preflight.preparation.action, "prepare");
  assert.equal(f.calls.filter(call => call.args[0] === "check").length, 2);
  assert.equal(f.calls.filter(call => call.args.includes("--list")).length, 2);
  assert.equal(f.calls.filter(call => call.args[0] === "test" && !call.args.includes("--list")).length, 2);
  const changedFlags = f.run("third", [], { env: { ...f.options.env, RUSTFLAGS: "--cfg changed" } });
  assert.equal(changedFlags.preflight.preparation.action, "prepare");
  const changedPending = f.run("fourth", [], { env: { ...f.options.env,
    INSTA_PENDING_DIR: path.join(f.root, "another-pending") } });
  assert.equal(changedPending.preflight.preparation.action, "prepare");
});

test("removing and recreating a Cargo target invalidates successful preparation", context => {
  const f = fixture(context); f.run("first");
  // Preserve the old directory as evidence; a different inode is deterministic
  // even on filesystems with coarse creation-time resolution.
  fs.renameSync(f.options.env.CARGO_TARGET_DIR, path.join(f.root, "previous-target"));
  fs.mkdirSync(f.options.env.CARGO_TARGET_DIR);
  const next = f.calls.length;
  const result = f.run("second");
  assert.equal(result.status, 0);
  assert.equal(result.preflight.preparation.action, "prepare");
  assert.equal(f.calls[next].args[0], "check");
});

test("missing targets and incomplete receipts never establish preparation", context => {
  const f = fixture(context); f.run("first");
  const receiptPath = path.join(f.options.preparation.directory, fs.readdirSync(f.options.preparation.directory).find(name => name.endsWith(".json")));
  const original = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  for (const patch of [{ selectedTests: 0 }, { selectedTests: -1 }, { selectionExitCode: null },
    { typeCheckExitCode: 1 }, { preparationMs: -1 }, { runtimeIdentity: "changed" }, { schema: 1 }]) {
    fs.writeFileSync(receiptPath, JSON.stringify({ ...original, ...patch }));
    const before = f.calls.length;
    assert.equal(f.run("second").status, 0);
    assert.equal(f.calls[before].args[0], "check");
  }
  fs.renameSync(f.options.env.CARGO_TARGET_DIR, path.join(f.root, "absent-target-evidence"));
  const spec = buildCargoTestCommand(path.join(f.root, "engine"), ["test", "--lib", "first", "--", "--test-threads=1"], f.options);
  assert.equal(preparationContext(spec, f.options.preparation).skipTypeCheck, false);
});

test("failed, unknown and zero-test phases cannot write preparation evidence", context => {
  const f = fixture(context);
  fs.mkdirSync(f.options.env.CARGO_TARGET_DIR);
  const spec = buildCargoTestCommand(path.join(f.root, "engine"), ["test", "--lib", "first"], f.options);
  const prepared = preparationContext(spec, f.options.preparation);
  const phases = [{ phase: "typeCheck", exitCode: 0, durationMs: 1 },
    { phase: "selection", exitCode: 0, durationMs: 2, selectedTests: 1 }];
  for (const [index, patch] of [[0, { exitCode: 1 }], [0, { exitCode: null }], [0, { signal: "SIGTERM" }],
    [0, { error: "unobserved" }], [1, { exitCode: 1 }], [1, { selectedTests: 0 }], [1, { selectedTests: -1 }],
    [1, { durationMs: NaN }], [1, { durationMs: -1 }]]) {
    prepared.save(phases.map((phase, current) => current === index ? { ...phase, ...patch } : phase));
    assert.equal(fs.existsSync(prepared.filename), false);
  }
  prepared.save(phases);
  assert.equal(fs.existsSync(prepared.filename), true);
  assert.equal(JSON.parse(fs.readFileSync(prepared.filename, "utf8")).selectedTests, 1);
});

test("environment handoff survives host isolation without leaking preparation controls to tests", context => {
  const f = fixture(context);
  const options = { preparation: undefined, isolateHostEnvironment: true, env: { ...f.options.env,
    AZRAEL_CARGO_PREPARATION_DIR: f.options.preparation.directory,
    AZRAEL_CARGO_PREPARATION_SOURCE_IDENTITY: f.options.preparation.sourceIdentity,
    AZRAEL_CARGO_PREPARATION_RUNTIME_IDENTITY: f.options.preparation.runtimeIdentity } };
  assert.equal(f.run("first", [], options).status, 0);
  const result = f.run("second", [], options);
  assert.equal(result.status, 0); assert.equal(result.preflight.preparation.action, "reuse");
  assert.equal(f.calls.at(-1).execution.env.AZRAEL_CARGO_PREPARATION_DIR, undefined);
});

test("preparation storage failure reports caution without changing actual passing execution", context => {
  const f = fixture(context); const blocked = path.join(f.root, "not-a-directory"); fs.writeFileSync(blocked, "fixture");
  const result = f.run("first", [], { preparation: { ...f.options.preparation, directory: blocked } });
  assert.equal(result.status, 0); assert.match(result.preflight.preparation.saveWarning, /ENOTDIR|EEXIST/);
  assert.equal(result.preflight.phases.at(-1).phase, "execution");
});

for (const failure of [{ status: 101 }, { status: null, signal: "SIGTERM" }, { status: 0, stdout: "0 tests\n" }]) {
  test(`selection failure ${JSON.stringify(failure)} does not run tests or retain reusable preparation`, context => {
    const f = fixture(context); f.run("first"); const before = f.calls.length;
    f.setResponse(() => failure);
    assert.notEqual(f.run("next").status, 0);
    assert.equal(f.calls.length, before + 1);
    assert.equal(fs.readdirSync(f.options.preparation.directory).filter(name => name.endsWith(".json")).length, 0);
    f.setResponse(undefined);
    if (failure.signal) {
      assert.throws(() => f.run("recovery"), /owner conflict/);
      assert.equal(f.calls.length, before + 1);
      return;
    }
    const next = f.calls.length; assert.equal(f.run("recovery").status, 0);
    assert.equal(f.calls[next].args[0], "check");
  });
}

test("test failures remain failures while valid preparation can serve another filter", context => {
  const f = fixture(context);
  f.setResponse(args => args[0] === "test" && !args.includes("--list") ? { status: 101 } : undefined);
  assert.equal(f.run("failing").status, 101);
  f.setResponse(undefined);
  const next = f.run("passing");
  assert.equal(next.status, 0); assert.equal(next.preflight.preparation.action, "reuse");
});

test("missing or unreadable preparation evidence recommends normal Cargo preparation", context => {
  const f = fixture(context);
  const result = f.run("first", [], { preparation: { directory: f.options.preparation.directory } });
  assert.equal(result.status, 0); assert.equal(result.preflight.preparation.recommendation, "reuse-caution");
  f.run("second");
  const receipt = fs.readdirSync(f.options.preparation.directory).find(name => name.endsWith(".json"));
  fs.writeFileSync(path.join(f.options.preparation.directory, receipt), "broken");
  const before = f.calls.length; assert.equal(f.run("third").status, 0);
  assert.equal(f.calls[before].args[0], "check");
});

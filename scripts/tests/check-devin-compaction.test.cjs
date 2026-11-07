"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { validateCargoPreflight } = require("../cargo-verification.cjs");

function run(status = 0) {
  const calls = [], root = path.resolve("frozen-engine");
  const processStub = { argv: [process.execPath, "check", root], execPath: process.execPath,
    env: { PATH: "toolchain", CODEX_HOME: "private", AZRAEL_DEVIN_NATIVE_HELPER: "live-helper",
      AZRAEL_PROVIDER_ACCOUNTS_HELPER: "live-account", AZRAEL_CARGO_RUN_ID: "owned-run" } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../check-devin-compaction.cjs"), "utf8"), {
    process: processStub,
    require(name) {
      if (name === "node:fs") return { existsSync: () => true };
      if (name === "node:path") return path;
      if (name === "./cargo-verification.cjs") return { runCargoTest(source, args, options) {
        calls.push({ source, args: Array.from(args), env: { ...options.env } }); return { status };
      } };
      throw Error(`Unexpected dependency ${name}`);
    },
  });
  return { calls, exitCode: processStub.exitCode, root };
}

test("Devin verification isolates credentials and explicitly runs the serial mock boundary", () => {
  const { calls, root } = run();
  assert.equal(calls.length, 6);
  assert.ok(calls[0].args.includes("devin::catalog::"));
  for (const call of calls) {
    assert.equal(call.source, root);
    assert.equal(call.env.CODEX_HOME, undefined);
    assert.equal(call.env.AZRAEL_DEVIN_NATIVE_HELPER, undefined);
    assert.equal(call.env.AZRAEL_PROVIDER_ACCOUNTS_HELPER, undefined);
    assert.equal(call.env.AZRAEL_CARGO_RUN_ID, "owned-run");
    assert.equal(call.env.AZRAEL_DEVIN_NODE, process.execPath);
    assert.ok(call.args.includes("--offline") && call.args.includes("--locked"));
    assert.equal(call.args.at(-1), "--test-threads=1");
  }
  assert.ok(calls.at(-1).args.includes("--ignored"));
  assert.equal(calls.slice(0, -1).some(call => call.args.includes("--ignored")), false);
  validateCargoPreflight({ id: "devin", level: "native", executable: "node",
    args: ["scripts/check-devin-compaction.cjs"], cargoPreflight: "selected-tests-v2" });
});

test("Devin verification stops after the actual first failed Cargo execution", () => {
  const result = run(101);
  assert.equal(result.calls.length, 1);
  assert.equal(result.exitCode, 101);
});

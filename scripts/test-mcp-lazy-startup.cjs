"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { commands } = require("./check-mcp-lazy-startup.cjs");
const { validateCargoPreflight } = require("./cargo-verification.cjs");

test("MCP preservation keeps native integration and connection checks with offline locks", () => {
  const sourceRoot = path.resolve(__dirname, "../engine");
  const plans = commands([sourceRoot]);

  assert.ok(plans[0].args.includes("suite::mcp_tool_cache::"));
  assert.ok(plans[0].args.includes("integration-tests"));
  assert.ok(plans[1].args.includes("codex-mcp"));
  for (const plan of plans) {
    assert.equal(plan.sourceRoot, sourceRoot);
    assert.ok(plan.args.includes("--locked"));
    assert.ok(plan.args.includes("--offline"));
    assert.ok(plan.args.includes("--test-threads=1"));
  }
});

test("MCP preservation requires the managed nonzero test preflight", () => {
  const check = { id: "engine.mcp-lazy-startup.native", level: "native", executable: "node",
    args: ["scripts/check-mcp-lazy-startup.cjs", "{engineSourceRoot}"] };
  assert.throws(() => validateCargoPreflight(check), /preflight/);
  assert.doesNotThrow(() => validateCargoPreflight({ ...check, cargoPreflight: "selected-tests-v1" }));
  for (const args of [[], ["relative"], [path.resolve("engine"), "extra"]]) {
    assert.throws(() => commands(args), /Usage/);
  }
});

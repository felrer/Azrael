"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildCargoTestCommand, runCargoTest, runManagedCargoSync } = require("./cargo-verification.cjs");

function commands(argv) {
  const [sourceRoot, ...extra] = argv;
  if (!sourceRoot || !path.isAbsolute(sourceRoot) || extra.length) {
    throw new Error("Usage: check-mcp-lazy-startup.cjs <absolute frozen engine source root>");
  }
  if (!fs.statSync(path.join(sourceRoot, "codex-rs", "core", "tests", "suite", "mcp_tool_cache.rs")).isFile()) {
    throw new Error("Selected source has no MCP tool cache integration tests");
  }
  return [
    ["test", "-p", "codex-core", "--features", "integration-tests", "--test", "all", "suite::mcp_tool_cache::",
      "--locked", "--offline", "--", "--test-threads=1"],
    ["test", "-p", "codex-mcp", "--lib", "--locked", "--offline", "--", "--test-threads=1"],
  ].map(args => ({ sourceRoot, args }));
}

function main(argv = process.argv.slice(2)) {
  const plans = commands(argv);
  // The core integration target resolves this separate package's fixture binary at runtime.
  const fixture = buildCargoTestCommand(plans[0].sourceRoot,
    ["test", "-p", "codex-rmcp-client", "--bin", "test_stdio_server", "--locked", "--offline"],
    { isolateHostEnvironment: true });
  fixture.args[0] = "build";
  const prepared = runManagedCargoSync(fixture);
  process.stderr.write(`[mcp-fixture-preparation] ${JSON.stringify({ args: fixture.args,
    exitCode: prepared.status ?? null, signal: prepared.signal ?? null })}\n`);
  if (prepared.error) throw prepared.error;
  if (prepared.signal) throw new Error(`MCP fixture preparation interrupted: ${prepared.signal}`);
  if (prepared.status !== 0) return prepared.status ?? 1;
  for (const plan of plans) {
    const result = runCargoTest(plan.sourceRoot, plan.args, { isolateHostEnvironment: true });
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`Native verification interrupted: ${result.signal}`);
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

module.exports = { commands, main };
if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

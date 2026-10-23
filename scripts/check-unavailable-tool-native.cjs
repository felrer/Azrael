"use strict";

const path = require("node:path");
const { runCargoTest } = require("./cargo-verification.cjs");

const [sourceRoot, ...extra] = process.argv.slice(2);
if (!sourceRoot || !path.isAbsolute(sourceRoot) || extra.length) {
  throw new Error("Usage: check-unavailable-tool-native.cjs <absolute frozen engine source root>");
}
for (const filter of ["unavailable_tool_", "tool_catalog_rejects_unknown_kind_and_duplicate_call_ids", "function_arguments_must_be_json_objects"]) {
  const result = runCargoTest(sourceRoot, ["test", "-p", "codex-core", "--lib", filter,
    "--locked", "--offline", "--", "--test-threads=1"], { isolateHostEnvironment: true, capture: true });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
  if (!/test result: ok\. [1-9][0-9]* passed; 0 failed;/.test(result.stdout || "")) {
    throw new Error(`Unavailable-tool filter selected no passing tests: ${filter}`);
  }
}

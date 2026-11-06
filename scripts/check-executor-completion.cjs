"use strict";
const path = require("node:path");
const { runCargoTest } = require("./cargo-verification.cjs");

const [sourceRoot, ...extra] = process.argv.slice(2);
if (!sourceRoot || !path.isAbsolute(sourceRoot) || extra.length) {
  throw new Error("Usage: check-executor-completion.cjs <absolute frozen engine root>");
}
for (const filter of ["session::work_completion::", "unified_exec::", "tools::handlers::unified_exec::"]) {
  const result = runCargoTest(sourceRoot, ["test", "-p", "codex-core", "--lib", filter,
    "--locked", "--offline", "--", "--test-threads=1"], { isolateHostEnvironment: true, capture: true });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
  if (!/test result: ok\. [1-9][0-9]* passed; 0 failed;/.test(result.stdout || "")) {
    throw new Error(`Executor completion selection ran no passing tests: ${filter}`);
  }
}

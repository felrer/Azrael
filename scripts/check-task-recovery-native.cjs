"use strict";

const path = require("node:path");
const { runCargoTest } = require("./cargo-verification.cjs");

const [sourceRoot, ...extra] = process.argv.slice(2);
if (!sourceRoot || !path.isAbsolute(sourceRoot) || extra.length) {
  throw new Error("Usage: check-task-recovery-native.cjs <absolute frozen engine source root>");
}
// These tests execute debug-assertion recovery, panic unwinding/terminal delivery,
// interruption ownership and a subsequent task in the same native session.
for (const filter of [
  "context_manager::history::tests::normalize_",
  "context_manager::history::tests::for_prompt_recovers_interrupted_tools_with_stable_ids_and_preserves_raw_history",
  "tasks::panic_tests::",
  "tasks::tests::",
]) {
  const result = runCargoTest(sourceRoot, ["test", "-p", "codex-core", "--lib", filter,
    "--locked", "--offline", "--", "--test-threads=1"], { isolateHostEnvironment: true, capture: true });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
  if (!/test result: ok\. [1-9][0-9]* passed; 0 failed;/.test(result.stdout || "")) {
    throw new Error(`Native recovery filter selected no passing tests: ${filter}`);
  }
}

"use strict";

const path = require("node:path");
const { runCargoTest } = require("./cargo-verification.cjs");

const [sourceRoot, ...extra] = process.argv.slice(2);
if (!sourceRoot || !path.isAbsolute(sourceRoot) || extra.length) {
  throw new Error("Usage: check-edit-message-native.cjs <absolute frozen engine source root>");
}
for (const [crate, filter] of [
  ["codex-state", "runtime::accepted_user_inputs::tests::"],
  ["codex-thread-store", "local::revert_thread::tests::"],
]) {
  const result = runCargoTest(sourceRoot, ["test", "-p", crate, "--lib", filter,
    "--locked", "--offline", "--", "--test-threads=1"], { isolateHostEnvironment: true, capture: true });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
  if (!/test result: ok\. [1-9][0-9]* passed; 0 failed;/.test(result.stdout || "")) {
    throw new Error(`Message editing filter selected no passing tests: ${filter}`);
  }
}

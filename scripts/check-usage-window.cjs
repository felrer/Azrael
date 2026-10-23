"use strict";

const path = require("node:path");
const { runCargoTest } = require("./cargo-verification.cjs");

const [sourceRoot, ...extra] = process.argv.slice(2);
if (!sourceRoot || extra.length || !path.isAbsolute(sourceRoot)) {
  throw new Error("Usage: check-usage-window.cjs <absolute frozen engine source root>");
}
const result = runCargoTest(sourceRoot, [
  "test", "-p", "codex-app-server", "--lib", "account_processor", "--locked", "--offline",
  "--", "--test-threads=1",
], { isolateHostEnvironment: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

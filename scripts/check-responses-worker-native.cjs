"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { runCargoTest } = require("./cargo-verification.cjs");

const [sourceRoot, ...extra] = process.argv.slice(2);
if (!sourceRoot || extra.length || !path.isAbsolute(sourceRoot)) {
  throw new Error("Usage: check-responses-worker-native.cjs <absolute frozen engine source root>");
}
if (!fs.statSync(path.join(sourceRoot, "codex-rs", "Cargo.toml")).isFile()) {
  throw new Error("Selected source has no Cargo workspace");
}
// The worker package's subprocess integration tests use the very executable
// Cargo builds for this selection, rather than a worker from an installation.
const result = runCargoTest(sourceRoot, [
  "test", "-p", "codex-responses-worker-protocol", "-p", "codex-responses-worker-client",
  "-p", "codex-responses-worker", "--locked", "--offline", "--", "--test-threads=1", "--nocapture",
], { isolateHostEnvironment: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { runCargoTest } = require("./cargo-verification.cjs");

const [sourceRoot, ...extra] = process.argv.slice(2);
if (!sourceRoot || extra.length || !path.isAbsolute(sourceRoot)) {
  throw new Error("Usage: check-capacity-recovery.cjs <absolute frozen engine source root>");
}
if (!fs.statSync(path.join(sourceRoot, "codex-rs", "Cargo.toml")).isFile()) {
  throw new Error("Selected source has no Cargo workspace");
}
const result = runCargoTest(sourceRoot, [
  "test", "-p", "codex-core", "--lib", "capacity", "--locked", "--offline",
  "--", "--test-threads=1",
], { isolateHostEnvironment: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { runCargoTest } = require("./cargo-verification.cjs");

const [sourceRoot, ...extra] = process.argv.slice(2);
if (!sourceRoot || extra.length || !path.isAbsolute(sourceRoot)) {
  throw new Error("Usage: check-parent-requests.cjs <absolute frozen engine source root>");
}
const cwd = path.join(sourceRoot, "codex-rs");
if (!fs.statSync(path.join(cwd, "Cargo.toml")).isFile()) {
  throw new Error("Selected engine source has no Cargo workspace");
}
const result = runCargoTest(sourceRoot, [
  "test", "-p", "codex-core", "-p", "codex-prompts", "-p", "codex-protocol", "-p", "codex-state",
  "--lib", "--locked", "--offline", "--", "--test-threads=1", "--nocapture", "parent_request", "parent_response_wait",
], { isolateHostEnvironment: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

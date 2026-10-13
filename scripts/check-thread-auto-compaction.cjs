"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const [sourceRoot, ...extra] = process.argv.slice(2);
if (!sourceRoot || extra.length || !path.isAbsolute(sourceRoot)) {
  throw new Error("Usage: check-thread-auto-compaction.cjs <absolute frozen engine source root>");
}
const cwd = path.join(sourceRoot, "codex-rs");
if (!fs.statSync(path.join(cwd, "Cargo.toml")).isFile()) throw new Error("Selected source has no Cargo workspace");
const result = spawnSync("cargo", [
  "test", "-p", "codex-core", "-p", "codex-protocol", "-p", "codex-app-server-protocol", "-p", "codex-app-server",
  "--lib", "auto_compaction", "--locked", "--offline", "--", "--test-threads=1",
], {
  cwd, env: { ...process.env, RUST_MIN_STACK: process.env.RUST_MIN_STACK || "33554432", INSTA_UPDATE: "no" },
  stdio: "inherit", windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
if (process.exitCode === 0) {
  const storage = spawnSync("cargo", [
    "test", "-p", "codex-core", "--test", "all", "auto_compaction", "--locked", "--offline", "--", "--test-threads=1",
  ], {
    cwd, env: { ...process.env, RUST_MIN_STACK: process.env.RUST_MIN_STACK || "33554432", INSTA_UPDATE: "no" },
    stdio: "inherit", windowsHide: true,
  });
  if (storage.error) throw storage.error;
  process.exitCode = storage.status ?? 1;
}

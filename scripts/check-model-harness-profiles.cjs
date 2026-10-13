"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const [sourceRoot, scope, ...extra] = process.argv.slice(2);
if (!sourceRoot || !path.isAbsolute(sourceRoot) || !["config", "tools"].includes(scope) || extra.length) {
  throw new Error("Usage: check-model-harness-profiles.cjs <absolute frozen engine source root> <config|tools>");
}
const cwd = path.join(sourceRoot, "codex-rs");
if (!fs.statSync(path.join(cwd, "Cargo.toml")).isFile()) throw new Error("Selected engine source has no Cargo workspace");
const checks = scope === "config"
  ? [["codex-config", "harness"]]
  : [["codex-core", "claude"], ["codex-core", "anthropic_profile_replaces_native_tools_and_other_providers_exclude_compatible_tools"]];
for (const [crate, filter] of checks) {
  const result = spawnSync("cargo", ["test", "-p", crate, "--lib", filter, "--locked", "--offline", "--", "--test-threads=1"], {
    cwd,
    env: { ...process.env, RUST_MIN_STACK: process.env.RUST_MIN_STACK || "33554432", INSTA_UPDATE: "no" },
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}

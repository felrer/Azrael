"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const [sourceRoot, scope, ...extra] = process.argv.slice(2);
const checks = {
  prompts: [["codex-prompts", "api_projection"], ["codex-prompts", "configured_canonical_hint"]],
  skills: [["codex-skills-extension", "api_host_dedup"]],
  core: [["codex-core", "instruction_state_projection"], ["codex-core", "multi_agent_mode::tests"]],
};
if (!sourceRoot || !path.isAbsolute(sourceRoot) || !checks[scope] || extra.length) {
  throw new Error("Usage: check-api-context.cjs <absolute frozen engine source root> <prompts|skills|core>");
}
const cwd = path.join(sourceRoot, "codex-rs");
if (!fs.statSync(path.join(cwd, "Cargo.toml")).isFile()) throw new Error("Missing frozen Cargo workspace");
for (const [crate, filter] of checks[scope]) {
  const result = spawnSync("cargo", ["test", "-p", crate, "--lib", filter, "--locked", "--offline", "--", "--test-threads=1"], {
    cwd, windowsHide: true, stdio: "inherit",
    env: { ...process.env, RUST_MIN_STACK: process.env.RUST_MIN_STACK || "33554432", INSTA_UPDATE: "no" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}

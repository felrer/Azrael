"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { runCargoTest } = require("./cargo-verification.cjs");
const [sourceRoot, ...extra] = process.argv.slice(2);
if (!sourceRoot || extra.length || !path.isAbsolute(sourceRoot) || !fs.existsSync(path.join(sourceRoot, "codex-rs/Cargo.toml"))) {
  throw new Error("Usage: check-task-profile-skills.cjs <absolute frozen engine source root>");
}
for (const [crate, filter] of [["codex-config", "skills_config"], ["codex-skills-extension", "host_roots"]]) {
  const result = runCargoTest(sourceRoot, ["test", "-p", crate, "--lib", "--locked", "--offline", filter], { isolateHostEnvironment: true });
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { runCargoTest } = require("./cargo-verification.cjs");

const [sourceRoot, scope = "all", ...extra] = process.argv.slice(2);
const groups = {
  store: [
    ["codex-thread-store", "history_revision::tests"],
    ["codex-thread-store", "model_context::tests"],
  ],
  appserver: [["codex-app-server", "resume_history_reuse_tests"]],
};
if (!sourceRoot || !path.isAbsolute(sourceRoot) || extra.length ||
    !["all", ...Object.keys(groups)].includes(scope) ||
    !fs.existsSync(path.join(sourceRoot, "codex-rs/Cargo.toml"))) {
  throw new Error("Usage: check-startup-performance-native.cjs <absolute frozen engine root> [all|store|appserver]");
}
for (const [crate, filter] of scope === "all" ? [...groups.store, ...groups.appserver] : groups[scope]) {
  const result = runCargoTest(sourceRoot,
    ["test", "-p", crate, "--lib", filter, "--locked", "--offline"],
    { isolateHostEnvironment: true });
  if (result.error || result.status !== 0) {
    if (result.error) process.stderr.write(`${result.error.message}\n`);
    process.exit(result.status ?? 1);
  }
}

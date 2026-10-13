"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { runCargoTest } = require("./cargo-verification.cjs");

const [sourceRoot, scope, ...extra] = process.argv.slice(2);
const scopes = {
  protocol: [["codex-app-server-protocol", "thread_history"]],
  store: [["codex-thread-store", "recorded_turn_attribution"],
    ["codex-thread-store", "deferred_turn_duration_stays_frozen_after_a_new_turn"]],
  appserver: [["codex-app-server", "bespoke_event_handling::tests::test_handle_turn_"],
    ["codex-app-server", "test_emit_turn_deferred_preserves_frozen_timing"]],
};
if (!sourceRoot || !path.isAbsolute(sourceRoot) || !Object.hasOwn(scopes, scope) || extra.length) {
  throw new Error("Usage: check-task-work-time-native.cjs <absolute frozen engine source root> <protocol|store|appserver>");
}
const cwd = path.join(sourceRoot, "codex-rs");
if (!fs.statSync(path.join(cwd, "Cargo.toml")).isFile()) throw new Error("Selected engine source has no Cargo workspace");
for (const [crate, filter] of scopes[scope]) {
  const result = runCargoTest(sourceRoot, ["test", "-p", crate, "--lib", filter,
    "--locked", "--offline", "--", "--test-threads=1"], { isolateHostEnvironment: true });
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}

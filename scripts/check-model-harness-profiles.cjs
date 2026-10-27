"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { runCargoTest } = require("./cargo-verification.cjs");

const [sourceRoot, scope, ...extra] = process.argv.slice(2);
if (!sourceRoot || !path.isAbsolute(sourceRoot) || !["config", "tools", "context"].includes(scope) || extra.length) {
  throw new Error("Usage: check-model-harness-profiles.cjs <absolute frozen engine source root> <config|tools|context>");
}
const cwd = path.join(sourceRoot, "codex-rs");
if (!fs.statSync(path.join(cwd, "Cargo.toml")).isFile()) throw new Error("Selected engine source has no Cargo workspace");
const checks = scope === "config"
  ? [["codex-config", "harness"], ["codex-prompts", "model_instructions"]]
  : scope === "context" ? [
      ["codex-core", "context::world_state::model::tests"],
      ["codex-core", "session::provider_handoff::tests"],
      ["codex-core", "instruction_state_projection"],
    ] : [
      ["codex-core", "claude"],
      ["codex-core", "anthropic_azrael_tools_patch_read_and_execute"],
      ["codex-core", "tools::router::tests::chat_discovery"],
      ["codex-core", "mcp_and_tool_search_follow_direct_and_deferred_tool_exposure"],
    ];
for (const [crate, filter] of checks) {
  const result = runCargoTest(sourceRoot, ["test", "-p", crate, "--lib", filter, "--locked", "--offline", "--", "--test-threads=1"]);
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}
if (scope === "context" && !process.exitCode) {
  const result = runCargoTest(sourceRoot, ["test", "-p", "codex-core", "--test", "all", "--features", "codex-core/integration-tests", "suite::model_switching", "--locked", "--offline", "--", "--test-threads=1"]);
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { runCargoTest } = require("./cargo-verification.cjs");

function commands(argv) {
  const [sourceRoot, flag, stage] = argv;
  if (!sourceRoot || !path.isAbsolute(sourceRoot) || flag !== "--stage" ||
      !["default", "preserve-order"].includes(stage) || argv.length !== 3) {
    throw new Error("Usage: check-mcp-oauth-store.cjs <absolute frozen engine source root> --stage default|preserve-order");
  }
  if (!fs.statSync(path.join(sourceRoot, "codex-rs", "rmcp-client", "Cargo.toml")).isFile()) {
    throw new Error("Selected source has no codex-rmcp-client package");
  }
  const args = ["test", "-p", "codex-rmcp-client", "--lib", "oauth::", "--locked", "--offline"];
  if (stage === "preserve-order") args.push("--features", "serde_json/preserve_order");
  args.push("--", "--test-threads=1");
  return { sourceRoot, args };
}

function main(argv = process.argv.slice(2)) {
  const plan = commands(argv);
  const result = runCargoTest(plan.sourceRoot, plan.args, { isolateHostEnvironment: true });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Native verification interrupted: ${result.signal}`);
  return result.status ?? 1;
}

module.exports = { commands, main };
if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

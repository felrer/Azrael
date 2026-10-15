"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { runCargoTest } = require("./cargo-verification.cjs");

function commands(argv) {
  const [sourceRoot, flag, stage] = argv;
  if (!sourceRoot || !path.isAbsolute(sourceRoot) || flag !== "--stage" ||
      !["library", "prompts", "core"].includes(stage) || argv.length !== 3) {
    throw new Error("Usage: check-project-maintenance.cjs <absolute frozen engine source root> --stage library|prompts|core");
  }
  if (!fs.statSync(path.join(sourceRoot, "codex-rs", "Cargo.toml")).isFile()) {
    throw new Error("Selected source has no Cargo workspace");
  }
  const packages = { library: "azrael-project-maintenance", prompts: "codex-prompts", core: "codex-core" };
  const args = ["test", "-p", packages[stage]];
  if (stage !== "library") args.push("--lib", "project_maintenance");
  args.push("--locked", "--offline", "--", "--test-threads=1");
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

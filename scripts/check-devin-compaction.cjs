"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { runCargoTest } = require("./cargo-verification.cjs");

const [sourceRoot, ...extra] = process.argv.slice(2);
if (!sourceRoot || extra.length || !path.isAbsolute(sourceRoot) ||
    !fs.existsSync(path.join(sourceRoot, "codex-rs/Cargo.toml"))) {
  throw Error("Usage: check-devin-compaction.cjs <absolute frozen engine source root>");
}
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !/^(AZRAEL_|CODEX_)/i.test(name) || /^AZRAEL_CARGO_/i.test(name)));
// Only the opt-in mock test receives a runtime path; it supplies all account and
// transport fixtures itself and restores its process-wide runtime settings.
env.AZRAEL_DEVIN_NODE = process.execPath;
for (const [filter, ignored] of [
  ["devin::catalog::", false],
  ["compact::tests", false],
  ["auto_compaction", false],
  ["reconstruct_history_", false],
  ["compaction_persists_resume_metadata_and_companion_records", false],
  ["native_devin_compaction_commits_only_completed_nonempty_summary", true],
]) {
  const result = runCargoTest(sourceRoot, ["test", "-p", "codex-core", "--lib", "--locked", "--offline",
    filter, "--", ...(ignored ? ["--ignored"] : []), "--test-threads=1"], { env });
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}

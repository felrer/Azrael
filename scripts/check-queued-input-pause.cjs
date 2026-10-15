"use strict";

const path = require("node:path");
const { runCargoTest } = require("./cargo-verification.cjs");

const [sourceRoot, ...extra] = process.argv.slice(2);
if (!sourceRoot || extra.length || !path.isAbsolute(sourceRoot)) {
  throw new Error("Usage: check-queued-input-pause.cjs <absolute frozen engine source root>");
}
// Share the selected Cargo cache, running compilation sequentially. The queue
// integration fixture protects pause persistence, ordinary drain and manual start.
for (const args of [
  ["test", "-p", "codex-core", "--lib", "queued_input_pause", "--locked", "--offline", "--", "--test-threads=1"],
  ["test", "-p", "codex-queue-extension", "--test", "queue_service", "manual_resume_marker", "--locked", "--offline", "--", "--test-threads=1"],
  ["test", "-p", "codex-queue-extension", "--test", "queue_service", "queued_input_pause_tool_final", "--locked", "--offline", "--", "--test-threads=1"],
]) {
  const result = runCargoTest(sourceRoot, args, { isolateHostEnvironment: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}

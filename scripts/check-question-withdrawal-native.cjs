"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { runCargoTest } = require("./cargo-verification.cjs");

const [sourceRoot, scope = "all", ...extra] = process.argv.slice(2);
if (!sourceRoot || !path.isAbsolute(sourceRoot) || extra.length || !["all", "lib", "queue", "questions", "schemas"].includes(scope)) {
  throw Error("Usage: check-question-withdrawal-native.cjs <absolute frozen engine source root> [all|lib|queue|questions|schemas]");
}
if (!fs.statSync(path.join(sourceRoot, "codex-rs/Cargo.toml")).isFile()) throw Error("Selected source has no Cargo workspace");
const checks = [
  ["lib", ["-p", "codex-core", "-p", "codex-protocol", "-p", "codex-app-server-protocol", "-p", "codex-app-server", "--lib", "async_question"]],
  ["schemas", ["-p", "codex-app-server-protocol", "--lib", "schema_fixtures_tests"]],
  ["queue", ["-p", "codex-queue-extension", "--test", "queue_service"]],
  ["questions", ["-p", "codex-core", "--test", "request_user_input_async", "--features", "codex-core/integration-tests", "request_user_input_async"]],
  ["lib", ["-p", "codex-core", "--lib", "session::accepted_user_inputs::tests"]],
  ["lib", ["-p", "codex-core", "--lib", "session::compact_input::tests"]],
  ["lib", ["-p", "codex-core", "--lib", "session::turn_input::tests"]],
];
for (const [name, args] of checks) {
  if (scope !== "all" && scope !== name) continue;
  const started = new Date().toISOString();
  console.log(JSON.stringify({ stage: name, started, sourceRoot }));
  const result = runCargoTest(sourceRoot, ["test", ...args, "--locked", "--offline", "--", "--test-threads=1"], { isolateHostEnvironment: true });
  const exitCode = result.status ?? 1;
  console.log(JSON.stringify({ stage: name, started, ended: new Date().toISOString(), exitCode }));
  if (result.error) throw result.error;
  if (exitCode !== 0) { process.exitCode = exitCode; break; }
}

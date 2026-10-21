"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { runCargoTest } = require("./cargo-verification.cjs");
const { sdkPython, composePath } = require("./pipeline-preflight.cjs");

const [sourceRoot, scope = "all", ...extra] = process.argv.slice(2);
const scopes = ["all", "ledger", "wire", "archive", "admission", "queue", "rpc", "schemas"];
if (!sourceRoot || !path.isAbsolute(sourceRoot) || extra.length || !scopes.includes(scope)) {
  throw Error("Usage: check-window-approval-native.cjs <absolute frozen engine source root> [all|ledger|wire|archive|admission|queue|rpc|schemas]");
}
if (!fs.statSync(path.join(sourceRoot, "codex-rs/Cargo.toml")).isFile()) throw Error("Selected source has no Cargo workspace");
// Match early preparation's sdk-python-path environment recipe exactly.
const needsPython = ["all", "queue"].includes(scope);
const testEnv = needsPython ? composePath(process.env, [path.dirname(sdkPython(path.resolve(__dirname, ".."), process.env))]) : { ...process.env };
if (needsPython && spawnSync("python", ["-B", "-c", "import sys; assert sys.version_info.major == 3"], { env: testEnv, windowsHide: true }).status !== 0) {
  throw Error("Queue hook fixtures require a working Python 3 interpreter on PATH");
}
const checks = [
  ["ledger", ["-p", "codex-core", "--lib", "host_approval"]],
  ["wire", ["-p", "codex-app-server-protocol", "--lib", "host_approval"]],
  ["archive", ["-p", "codex-thread-store", "--lib", "host_approval"]],
  ["admission", ["-p", "codex-core", "--lib", "session::compact_input::tests"]],
  ["admission", ["-p", "codex-core", "--lib", "session::turn_input::tests"]],
  ["queue", ["-p", "codex-queue-extension", "--test", "queue_service"]],
  ["rpc", ["-p", "codex-app-server", "--features", "integration-tests", "--test", "all", "host_approval_rpc"]],
  ["schemas", ["-p", "codex-app-server-protocol", "--lib", "schema_fixtures_tests"]],
];
for (const [name, args] of checks) {
  if (scope !== "all" && scope !== name) continue;
  const started = new Date().toISOString();
  console.log(JSON.stringify({ stage: name, started, sourceRoot }));
  const result = runCargoTest(sourceRoot, ["test", ...args, "--locked", "--offline", "--", "--test-threads=1"], { isolateHostEnvironment: true, env: testEnv });
  const exitCode = result.status ?? 1;
  console.log(JSON.stringify({ stage: name, started, ended: new Date().toISOString(), exitCode }));
  if (result.error) throw result.error;
  if (exitCode !== 0) { process.exitCode = exitCode; break; }
}

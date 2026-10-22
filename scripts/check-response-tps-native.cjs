"use strict";
const path = require("node:path");
const { runCargoTest } = require("./cargo-verification.cjs");
const [sourceRoot, scope, ...extra] = process.argv.slice(2);
const crates = { protocol: "codex-protocol", core: "codex-core", appserver: "codex-app-server-protocol" };
if (!sourceRoot || !path.isAbsolute(sourceRoot) || !Object.hasOwn(crates, scope) || extra.length) {
  throw Error("Usage: check-response-tps-native.cjs <absolute frozen engine root> <protocol|core|appserver>");
}
const filters = scope === "core" ? ["turn_timing::tests", "session::tests::response_performance"] : ["response_performance"];
for (const filter of filters) {
  const result = runCargoTest(sourceRoot, ["test", "-p", crates[scope], "--lib", filter, "--locked", "--offline", "--", "--test-threads=1"], { isolateHostEnvironment: true });
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}

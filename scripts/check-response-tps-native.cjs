"use strict";
const path = require("node:path");
const { runCargoTest } = require("./cargo-verification.cjs");
const [sourceRoot, scope, ...extra] = process.argv.slice(2);
const crates = { protocol: "codex-protocol", core: "codex-core", appserver: "codex-app-server-protocol" };
if (!sourceRoot || !path.isAbsolute(sourceRoot) || !Object.hasOwn(crates, scope) || extra.length) {
  throw Error("Usage: check-response-tps-native.cjs <absolute frozen engine root> <protocol|core|appserver>");
}
const filter = scope === "core" ? "turn_timing::tests" : "response_performance";
const result = runCargoTest(sourceRoot, ["test", "-p", crates[scope], "--lib", filter, "--locked", "--offline", "--", "--test-threads=1"], { isolateHostEnvironment: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

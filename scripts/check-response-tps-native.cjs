"use strict";
const path = require("node:path");
const { runCargoTest } = require("./cargo-verification.cjs");
const [sourceRoot, scope, ...extra] = process.argv.slice(2);
const crates = { protocol: "codex-protocol", core: "codex-core", appserver: "codex-app-server-protocol", api: "codex-api" };
if (!sourceRoot || !path.isAbsolute(sourceRoot) || !Object.hasOwn(crates, scope) || extra.length) {
  throw Error("Usage: check-response-tps-native.cjs <absolute frozen engine root> <protocol|core|appserver|api>");
}
const selections = scope === "api"
  ? [["--lib", "completed_preserves_server_service_tier"], ["--test", "sse_end_to_end", "responses_stream_parses_items_and_completed_end_to_end"]]
  : (scope === "core" ? ["turn_timing::tests", "session::tests::response_performance", "client::tests::response_stream_records_last_model_feedback_ids"]
    : scope === "appserver" ? ["response_performance", "schema_fixtures_tests"] : ["response_performance"]).map(filter => ["--lib", filter]);
for (const selection of selections) {
  const result = runCargoTest(sourceRoot, ["test", "-p", crates[scope], ...selection, "--locked", "--offline", "--", "--test-threads=1"], { isolateHostEnvironment: true });
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}

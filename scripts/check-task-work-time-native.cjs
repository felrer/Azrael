"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const [sourceRoot, scope, ...extra] = process.argv.slice(2);
const scopes = {
  protocol: [["codex-app-server-protocol", "thread_history"]],
  store: [["codex-thread-store", "recorded_turn_attribution"],
    ["codex-thread-store", "deferred_turn_duration_stays_frozen_after_a_new_turn"]],
  appserver: [["codex-app-server", "bespoke_event_handling::tests::test_handle_turn_"],
    ["codex-app-server", "test_emit_turn_deferred_preserves_frozen_timing"]],
};
if (!sourceRoot || !path.isAbsolute(sourceRoot) || !Object.hasOwn(scopes, scope) || extra.length) {
  throw new Error("Usage: check-task-work-time-native.cjs <absolute frozen engine source root> <protocol|store|appserver>");
}
const cwd = path.join(sourceRoot, "codex-rs");
if (!fs.statSync(path.join(cwd, "Cargo.toml")).isFile()) throw new Error("Selected engine source has no Cargo workspace");
const env = { ...process.env };
// 격리 검사에 실행 중인 호스트의 관리 소켓·프로필을 상속하지 않는다.
for (const key of Object.keys(env)) if (/^(AZRAEL_|CODEX_)/i.test(key)) delete env[key];
env.RUST_MIN_STACK ||= "33554432";
env.INSTA_UPDATE = "no";
for (const [crate, filter] of scopes[scope]) {
  const result = spawnSync("cargo", ["test", "-p", crate, "--lib", filter,
    "--locked", "--offline", "--", "--test-threads=1"], { cwd, env, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}

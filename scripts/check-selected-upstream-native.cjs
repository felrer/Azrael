"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { runCargoTest } = require("./cargo-verification.cjs");

// Each filter executes product behavior. Platform-only cases remain explicit;
// a Windows result does not accept Seatbelt, native macOS aliases or bubblewrap.
const suites = {
  "catalog-retention": [
    ["codex-models-manager", "--lib", ""],
    ["codex-model-provider", "--lib", "shared_state_tests"],
    ["codex-protocol", "--lib", "error::"],
  ],
  "analytics-bound": [
    ["codex-analytics", "--lib", ""],
    ["codex-app-server", "--lib", "outgoing_message::tests"],
  ],
  "code-mode-trace": [
    ["codex-code-mode", "--lib", ""],
    ["codex-core", "--test", "code_mode_tracing", "stdio_callbacks_preserve_context_across_overlapping_yielded_cells"],
  ],
  "catalog-retention-integration": [
    ["codex-core", "--test", "all", "suite::remote_models"],
  ],
  "catalog-refresh": [
    ["codex-mcp-extension", "--lib", "cloud_"],
    ["codex-mcp-extension", "--test", "plugin_mcp", ""],
    ["codex-skills-extension", "--lib", "cloud_cache_tests"],
    ["codex-core", "--lib", "turn_start_refreshes_dirty_mcp_reuses_clean_runtime_and_cancels_discovery"],
  ],
  "catalog-refresh-integration": [
    ["codex-core", "--test", "all", "suite::skills_extension::cloud_lifecycle_tests"],
  ],
  network: [["codex-network-proxy", "--lib", ""]],
  protocol: [["codex-protocol", "--lib", "permissions::"]],
  sandbox: [["codex-sandboxing", "--lib", ""]],
  "thread-store": [["codex-thread-store", "--lib", "resolve_requested_rollout_path_"]],
  "core-lib": [
    ["codex-core", "--lib", "recompute_token_usage"],
    ["codex-core", "--lib", "context_manager::history::tests::"],
    ["codex-core", "--lib", "unified_exec::"],
    ["codex-core", "--lib", "persisted_permissions_initialize_proxy_with_expandable_managed_allowlist"],
    ["codex-core", "--lib", "explicit_permission_overrides_win_over_saved_unnamed_permissions"],
    ["codex-core", "--lib", "initial_settings_remain_pending_until_persistence_succeeds"],
  ],
  "core-integration": [
    ["codex-core", "--test", "all", "auto_compact_accounts_for_encrypted_reasoning"],
    ["codex-core", "--test", "all", "compaction_preserves_history_after_restart"],
    ["codex-core", "--test", "all", "manual_compact_emits_context_compaction_items"],
    ["codex-core", "--test", "all", "manual_compact_records_durable_and_local_token_usage"],
    ["codex-core", "--test", "all", "exec_command_consumes_pushed_remote_process_events"],
    ["codex-core", "--test", "all", "cloud_skill_reads_run_in_parallel"],
    ["codex-core", "--test", "all", "code_mode_interrupt_terminates_active_cells_and_nested_tools"],
    ...(process.platform === "win32" ? [] : [
      ["codex-core", "--test", "all", "shell_snapshot_v2_returns_before_inherited_output_closes"],
      ["codex-core", "--test", "all", "agent_started_proxy_denies_brokered_provider_alias"],
    ]),
    ...(process.platform === "darwin" ? [["codex-core", "--test", "all", "apply_patch_system_aliases"]] : []),
  ],
  "app-server-lib": [
    ["codex-app-server", "--lib", "persisted_resume_settings"],
    ["codex-app-server", "--lib", "collect_resume_override_mismatches_includes_service_tier"],
  ],
  "app-server": [
    ["codex-app-server", "--test", "all", "thread_resume::"],
    ["codex-app-server", "--test", "all", "thread_revert::"],
    ["codex-app-server", "--test", "all", "thread_settings_update::"],
    ["codex-app-server", "--test", "all", "rollout_compress_runs_after_startup_with_compression_disabled"],
  ],
  tui: [
    ["codex-tui", "--lib", "fork_last_filters_latest_session_by_cwd_unless_show_all"],
    ["codex-tui", "--lib", "configured_ctrl_space_submit_wins_over_transcript_selection"],
    ["codex-tui", "--lib", "replay_preserves_typed_updates_before_voice_steers_the_turn"],
    ["codex-tui", "--lib", "in_progress_voice_replay_restores_the_late_reasoning_guard"],
  ],
};

function main(args = process.argv.slice(2)) {
  const [sourceRoot, suite, runtimeDirectory, ...extra] = args;
  const needsHost = ["core-integration", "code-mode-trace"].includes(suite);
  if (!sourceRoot || !path.isAbsolute(sourceRoot) || !Object.hasOwn(suites, suite) || extra.length ||
      (needsHost ? !runtimeDirectory || !path.isAbsolute(runtimeDirectory) : runtimeDirectory !== undefined)) {
    throw new Error(`Usage: check-selected-upstream-native.cjs <absolute frozen engine root> <${Object.keys(suites).join("|")}> [absolute engine runtime directory for Code Mode suites]`);
  }
  const env = { ...process.env };
  if (needsHost) {
    const host = fs.realpathSync.native(path.join(runtimeDirectory, process.platform === "win32" ? "azrael-code-mode-host.exe" : "azrael-code-mode-host"));
    if (!fs.statSync(host).isFile()) throw new Error("Code Mode integration requires the selected runtime host");
    env.CARGO_BIN_EXE_codex_code_mode_host = host;
  }
  for (const [crate, target, ...selection] of suites[suite]) {
    const filter = selection.at(-1) || "<all>";
    const result = runCargoTest(sourceRoot, ["test", "-p", crate, target,
      ...selection.filter(Boolean), ...(["codex-core", "codex-app-server"].includes(crate) && target === "--test" ? ["--features", "integration-tests"] : []),
      "--locked", "--offline", "--", "--test-threads=1"],
    { isolateHostEnvironment: true, capture: true, env });
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    if (result.error) throw result.error;
    if (result.status !== 0) { process.exitCode = result.status ?? 1; return; }
    if (!/test result: ok\. [1-9][0-9]* passed; 0 failed;/.test(result.stdout || "")) {
      throw new Error(`Selected upstream suite has no passing tests: ${suite}/${crate}/${filter}`);
    }
  }
}

module.exports = { suites, main };
if (require.main === module) main();

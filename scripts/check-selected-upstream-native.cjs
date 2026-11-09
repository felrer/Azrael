"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { runCargoTest, buildCargoTestCommand, runManagedCargoSync } = require("./cargo-verification.cjs");

// Each filter executes product behavior. Platform-only cases remain explicit;
// a Windows result does not accept Seatbelt, native macOS aliases or bubblewrap.
const suites = {
  "third-small": [
    ["codex-cloud-config", "--lib", "each_loader_owns_refresh_until_its_last_clone_is_dropped"],
    ["codex-core-plugins", "--lib", "marketplace_"],
    ["codex-voice-host", "--lib", "real_encoder_produces_twenty_millisecond_opus_packets"],
  ],
  "third-mcp": [
    ["codex-mcp", "--lib", ""],
    ["codex-config", "--lib", "requirements"],
    ["codex-rmcp-client", "--lib", "recovered_tool_calls_use_current_session_capabilities"],
    ["codex-mcp-extension", "--test", "hosted_apps_mcp", ""],
  ],
  "third-models": [
    ["codex-models-manager", "--lib", ""],
    ["codex-model-provider", "--lib", "originator_tests"],
    ["codex-core", "--lib", "originator_catalogs_preserve_"],
    ["codex-core", "--lib", "new_uses_active_provider_for_model_refresh"],
  ],
  "third-core": [
    ["codex-core", "--test", "all", "suite::hooks::user_prompt_submit"],
    ["codex-core", "--test", "all", "guardian_denial_rejects_tool_call_with_rationale"],
    ["codex-core", "--test", "all", "code_mode_can_yield_and_resume_with_wait"],
    ["codex-core", "--test", "all", "originator_catalogs_control_turn_instructions_and_tools"],
    ["codex-core", "--lib", "initial_settings_remain_pending_until_persistence_succeeds"],
  ],
  "third-appserver": [
    ["codex-app-server", "--lib", "resume_history_reuse_tests"],
    ["codex-app-server", "--test", "all", "thread_resume::"],
    ["codex-app-server", "--test", "all", "resume_revalidates_persisted_thread_after_config_load"],
    ["codex-app-server", "--test", "all", "resume_reloads_config_when_saved_workspace_roots_change"],
  ],
  "third-tui": [
    ["codex-tui", "--lib", "transcript_view"],
    ["codex-tui", "--lib", "owned_transcript"],
    ["codex-tui", "--lib", "transcript_composer"],
    ["codex-tui", "--lib", "owned_prompt_revert_retained_history"],
  ],
  "mcp-reload-state": [
    ["codex-config", "--lib", "reload_local_mcp_servers"],
    ["codex-features", "--lib", "incremental_tools_are_stable"],
    ["codex-mcp", "--lib", "cancelled_reconnect_restores_claimed_servers"],
    ["codex-mcp", "--lib", "excluding_reconnect_servers"],
    ["codex-core", "--lib", "reload_mcp_servers_handler"],
    ["codex-core", "--lib", "tools::spec_plan::tests::allowed_tools_filter_sources_before_code_mode_and_discovery"],
    ["codex-core", "--lib", "tools::spec_plan::tests::api_tool_free_model_closes_catalog_and_native_dispatch_registry"],
    ["codex-core", "--lib", "tools::spec_plan::tests::mcp_and_tool_search_follow_direct_and_deferred_tool_exposure"],
    ["codex-core", "--lib", "ignore_user_config_keeps_empty_user_layer"],
    ["codex-core", "--lib", "context::world_state::top_level_tools"],
  ],
  "mcp-reload-integration": [
    ["codex-core", "--test", "all", "suite::mcp_reload_tool::"],
    ["codex-core", "--test", "all", "suite::scenarios::incremental_tools::"],
    ["codex-core", "--test", "all", "suite::scenarios::incremental_tools_resume::"],
  ],
  "reasoning-effort-default": [["codex-features", "--lib", ""]],
  "auth-decrypted-cache": [
    ["codex-secrets", "--lib", "local::"],
    ["codex-secrets", "--lib", "tests::manager_round_trips_local_backend"],
    ["codex-login", "--lib", "auth::storage::tests::policy"],
  ],
  "catalog-retention": [
    ["codex-models-manager", "--lib", ""],
    ["codex-model-provider", "--lib", "shared_state::tests::"],
    ["codex-protocol", "--lib", "error::"],
    ["codex-prompts", "--lib", "model_instructions"],
    ["codex-core", "--lib", "model_resolution_preserves_startup_overrides_and_instruction_provenance"],
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
    ["codex-core", "--test", "all", "suite::models_cache_auth::failed_catalog_refresh_preserves_tool_search_on_the_next_turn"],
    ["codex-core", "--test", "all", "suite::personality::config_personality_"],
    ...(process.platform === "win32" ? [] : [["codex-core", "--test", "all", "suite::remote_models"]]),
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
    ["codex-core", "--lib", "context_manager::history::"],
    ["codex-core", "--lib", "context::instruction_state_projection::tests::"],
    ["codex-core", "--lib", "unified_exec::"],
    ["codex-core", "--lib", "persisted_permissions_initialize_proxy_with_expandable_managed_allowlist"],
    ["codex-core", "--lib", "explicit_permission_overrides_win_over_saved_unnamed_permissions"],
    ["codex-core", "--lib", "initial_settings_remain_pending_until_persistence_succeeds"],
  ],
  "core-integration": [
    ["codex-core", "--test", "all", "auto_compact_accounts_for_encrypted_reasoning"],
    ["codex-core", "--test", "all", "auto_compact_accounts_for_unreported_reasoning"],
    ["codex-core", "--test", "all", "code_mode_dynamic_tool_calls_pending_together_resolve_in_reverse_order"],
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
  const needsHost = ["core-integration", "code-mode-trace", "third-core"].includes(suite);
  if (!sourceRoot || !path.isAbsolute(sourceRoot) || !Object.hasOwn(suites, suite) || extra.length ||
      (needsHost ? !runtimeDirectory || !path.isAbsolute(runtimeDirectory) : runtimeDirectory !== undefined)) {
    throw new Error(`Usage: check-selected-upstream-native.cjs <absolute frozen engine root> <${Object.keys(suites).join("|")}> [absolute engine runtime directory for Code Mode suites]`);
  }
  const env = { ...process.env };
  if (["mcp-reload-integration", "third-mcp"].includes(suite)) {
    const fixture = buildCargoTestCommand(sourceRoot,
      ["test", "-p", "codex-rmcp-client", "--bin", "test_stdio_server", "--locked", "--offline"],
      { env, isolateHostEnvironment: true });
    fixture.args[0] = "build";
    const prepared = runManagedCargoSync(fixture);
    if (prepared.stdout) process.stdout.write(prepared.stdout);
    if (prepared.stderr) process.stderr.write(prepared.stderr);
    if (prepared.error) throw prepared.error;
    if (prepared.status !== 0 || prepared.signal) {
      throw Error(`MCP fixture preparation failed (exit ${prepared.status}, signal ${prepared.signal})`);
    }
  }
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

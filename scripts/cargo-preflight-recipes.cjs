'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// These are reviewed command recipes and reviewed side-effect-free selections. A wrapper
// change requires reviewing its commands/environment and updating this identity;
// otherwise cache eligibility reports a gap rather than silently using stale commands.
// Normalize checkout line endings, but preserve all other source bytes.
const wrapperHashes = Object.freeze({
  'check-responses-worker-native': 'ac1a092b5b59694c9ec24a76d2dd566903b4181f1da9be4160788c7f6578a639',
  'check-service-auth-native': 'c3de3963bb8e39d2dc54cbc0cf18c48c11459fd70d7fbe041f28fc22fe9b95ae',
  'check-agent-image-attachments': 'cd163c4a4b7b8f45539549aa3d3193e966632ad2a58d1ca1e5b0252db29e1e2b',
  'check-find-names': 'ca76c4c96c8240322096bd9d271ea00e2bb7a6153527d557ce63d527405bbf9a',
  'check-devin-compaction': 'e5e9113405e0ec7875ab871975c4598e17b20a60e9485ec54f83742235be5c4a',
  'check-role-profiles-native': '3c84c80fce595b8e04562ba77406c2546b45c89d2262eba807938876dc5d6cf0',
  'check-executor-completion': 'fbba5203634989dcdd30802d2f58af11418b8f32d9b8613ef05cbf7f80a28c09',
  'check-deletion-approval-native': '139f05599adda7215de9fd9c67a986803fc08a7b081dc9fc3184441ac8631829',
  'check-mcp-lazy-startup': '58cd264045141212a0ddad17f4d36c89e18401c687edbb7f23ed43c407844a86',
  'check-selected-upstream-native': '732679dc9744387cb117463d077298c30d45f4fa55a92fc056a54a169e58428c',
  'check-usage-window': 'b87b8e4c67236e297b003584c353448b7acc2a7a5ce36aec107b3ab0af173fbd',
  'check-api-context': '29a883f035865ade22a579c238e33d7c33e7931795115f949f0f597a08af6d37',
  'check-model-harness-profiles': 'c4f2c63c2034e2ee134431573739132a16d550a7a1e097a7bac256b01b3a24fa',
  'check-root-resume-reasoning': '0158f4af4864a884036821e42228d0d74e4396a7d9cc3856bcd7f4db190a76e4',
  'check-task-work-time-native': '858d85c4c4b199b8567c251bec58e3b95779d3851e0e8d3c0ea3992590e3813e',
  'check-thread-auto-compaction': '45538fd544446ae4af9453e6cde0b4cd62e9ba87b1b62e5f2c57ea80723bb053',
  'check-parent-requests': 'aa2456ae2edc5a2e3df68815594a0d01b6e1de202bebe50a2fe9ce7ac819a368',
  'check-capacity-recovery': 'ca6cccb3d50df005500d5ceeedbba0c064806a74aa4c089c880f82186b6d4c37',
  'check-task-profile-skills': '8b917134a02db256c4b5940e8611aaf37da7699934382563a4a34a0c895923e5',
  'check-shared-engine-native': '99fa4ff0be0f2306361bab0a4e29af83b1f2c9d7a8de78c35887774b682075b1',
  'check-task-memory': '69ce4a4f4f43d11fcfd074efbae8d7182e8a885e656936640ad7ca54df195840',
  'check-question-withdrawal-native': 'b17ee0244ec76cb3fa54d0384dfdb260bd8d8055a5ff32958bd1305d5bf22080',
  'check-mcp-oauth-store': '1b2d990b48a5bdcd038fc6a58cfa56f587797681823e3c10d41e43513cfdddfa',
  'check-startup-performance-native': '5cb7624493f45adf3e04f8d3cc4c51b55f0386b735e87a001c99afede7c947e2',
  'check-response-tps-native': 'a9c935f67afaf2f6bc6395c66311f481b12690548e93fafdbafee162ef620e6a',
  'check-task-recovery-native': 'bf1efa7f6b25732bd964d4181df234a5420a60ce327fa95753d341e4cde18728',
  'check-project-maintenance': '79877d89003169e5e5744e3fb8f87b80a6332ff953a0aeccb2c59a5e72d94492',
  'check-error-classification-native': '338386a3b633c8364fae67e268c86405328b60f809e951f193edc8a533c1d616',
  'check-window-approval-native': '525b897176b1c4ca2bd8c91fff09cd61b5f6c211ac874ea0aa02d5397c963325',
});
const finish = (args, threads = 1) => ['test', ...args, '--locked', '--offline', '--', `--test-threads=${threads}`];
const lib = (crate, filter) => finish(['-p', crate, '--lib', filter]);
const libs = (crates, filter) => finish([...crates.flatMap(crate => ['-p', crate]), '--lib', filter]);
const integration = filter => finish(['-p', 'codex-core', '--test', 'all', '--features', 'codex-core/integration-tests', filter]);

function reviewedRecipes(wrapper, tail, platform) {
  let isolateHostEnvironment = true;
  let envRecipe;
  let args;
  const scoped = (choices, fallback) => {
    if (tail.length > 1 || (tail.length === 0 && fallback === undefined)) return undefined;
    const name = tail[0] ?? fallback;
    return Object.hasOwn(choices, name) ? choices[name] : undefined;
  };
  switch (wrapper) {
    case 'check-responses-worker-native': {
      if (tail.length) break;
      args = [[...finish(['-p', 'codex-responses-worker-protocol', '-p', 'codex-responses-worker-client', '-p', 'codex-responses-worker']), '--nocapture']];
      break;
    }
    case 'check-service-auth-native': {
      const scope = tail.length === 0 ? 'all' : tail.length === 2 && tail[0] === '--scope' ? tail[1] : undefined;
      // Baseline-pin invocations are explicit one-off verification inputs and do
      // not advertise reusable recipes for an unmodified configured source.
      if (!['login', 'all'].includes(scope)) break;
      args = [
        ['codex-login', 'auth::service_account::tests'],
        ['codex-core', 'long_term_memories_cannot_be_enabled_for_azrael'],
        ['codex-memories-extension', 'when_disabled'],
        ['codex-memories-extension', 'prompt_contribution_uses_memory_summary_when_enabled'],
        ['codex-app-server', 'azrael'],
        ['codex-app-server', 'project_accounts_share_admission_without_sharing_policy_or_root_login'],
        ['codex-core', 'service_policy'],
        ['codex-http-client', 'service_policy'],
        ['codex-core', 'guardian::review_session::setup::service_history_tests'],
        ['codex-connectors', 'service_revision'],
        ['codex-core', 'mcp_runtime_keeps_local_backend_without_a_selected_local_environment'],
        ['codex-app-server', 'service_account'],
        ['codex-app-server', 'service_http'],
        ['codex-app-server-protocol', 'azrael'],
        ['codex-app-server-protocol', 'schema_fixtures_tests::'],
        ['codex-web-search-extension', 'only_explicit_custom_standalone_search_uses_chat_provider'],
        ['codex-mcp', 'hosted_apps_service_auth_reaches_transport_without_conversation_fallback'],
        ['codex-image-generation-extension', ''],
        ['codex-core', 'service_reviewer_spawn_pins_account_and_catalog_across_main_switch'],
        ['codex-core', 'guardian_review_session_config_uses_requirements_guardian_policy_config'],
        ['codex-core', 'hosted_web_search_and_standalone_image_generation_follow_runtime_gates'],
        ['codex-core', 'no_main_omits_openai_hosted_web_search_and_native_devin_omits_custom_hosted_search'],
        ['codex-core', 'hosted_web_search_fallback_follows_winning_browser_runtime'],
        ['codex-core', 'allowed_tools_filter_sources_before_code_mode_and_discovery'],
        ['codex-core', 'code_mode_only_can_expose_namespaced_multi_agent_v2_as_normal_tools'],
        ['codex-mcp-extension', 'service_selection_keeps_started_streams_and_rebinds_retained_openers'],
        ['codex-mcp-extension', 'event_connections_open_after_runtime_shutdown_with_current_auth'],
      ].filter(([crate]) => scope === 'all' || crate === 'codex-login').map(([crate, filter]) =>
        ['test', '-p', crate, '--lib', '--locked', '--offline', filter, '--', '--test-threads=1']);
      break;
    }
    case 'check-agent-image-attachments': {
      const groups = { protocol: [['codex-protocol', 'inter_agent']], storage: [['codex-thread-store', 'image_snapshot']],
        core: ['image_attachments', 'agent_image_label', 'tool_message_transport', 'devin_recipient_requires_plaintext'].map(filter => ['codex-core', filter]) };
      const selected = scoped({ ...groups, all: [...groups.protocol, ...groups.storage, ...groups.core] }, 'all');
      args = selected?.map(([crate, filter]) => ['test', '-p', crate, '--lib', '--locked', '--offline', filter, '--', '--test-threads=1']);
      break;
    }
    case 'check-find-names':
      isolateHostEnvironment = false;
      if (!tail.length) args = ['find_names', 'reviewer_tool_policy', 'api_tool_free_model_closes_catalog_and_native_dispatch_registry', 'find_names_with_packaged_helper', 'find_names_missing_runtime']
        .map((filter, index) => ['test', '-p', 'codex-core', '--lib', '--locked', '--offline', filter, '--', '--test-threads=1', ...(index >= 3 ? ['--ignored'] : [])]);
      break;
    case 'check-devin-compaction':
      isolateHostEnvironment = false;
      if (!tail.length) args = ['devin::catalog::', 'compact::tests', 'auto_compaction', 'reconstruct_history_', 'compaction_persists_resume_metadata_and_companion_records', 'native_devin_compaction_commits_only_completed_nonempty_summary']
        .map((filter, index) => ['test', '-p', 'codex-core', '--lib', '--locked', '--offline', filter, '--', ...(index === 5 ? ['--ignored'] : []), '--test-threads=1']);
      break;
    case 'check-role-profiles-native':
      if (!tail.length) args = ['role_profile', 'spawn_agent_fork',
        'multi_agent_v2_spawn_fork_turns_all_applies_agent_type_override',
        'spawn_agent_can_fork_parent_thread_history_with_sanitized_items',
        'root_coordination', 'defer_root_registration', 'config::schema::tests::config_schema_matches_fixture'].map(filter =>
        ['test', '-p', 'codex-core', '--lib', '--locked', '--offline', filter, '--', '--test-threads=1'])
        .concat([['test', '-p', 'codex-app-server-protocol', '--lib', '--locked', '--offline', 'schema_fixtures_tests::', '--', '--test-threads=1']]);
      break;
    case 'check-executor-completion':
      if (!tail.length) args = ['session::work_completion::', 'unified_exec::', 'tools::handlers::unified_exec::']
        .map(filter => finish(['-p', 'codex-core', '--lib', filter]));
      break;
    case 'check-mcp-lazy-startup':
      if (!tail.length) args = [finish(['-p', 'codex-core', '--features', 'integration-tests', '--test', 'all', 'suite::mcp_tool_cache::']),
        finish(['-p', 'codex-mcp', '--lib'])];
      break;
    case 'check-selected-upstream-native': {
      const [scope, runtime, ...extra] = tail;
      const needsHost = ['core-integration', 'code-mode-trace', 'third-core'].includes(scope);
      if (extra.length || (needsHost ? !runtime : tail.length !== 1)) break;
      const choices = {
        'third-small': [["codex-cloud-config","--lib","each_loader_owns_refresh_until_its_last_clone_is_dropped"],["codex-core-plugins","--lib","marketplace_"],["codex-voice-host","--lib","real_encoder_produces_twenty_millisecond_opus_packets"]],
        'third-mcp': [["codex-mcp","--lib",""],["codex-config","--lib","requirements"],["codex-rmcp-client","--lib","recovered_tool_calls_use_current_session_capabilities"],["codex-mcp-extension","--test","hosted_apps_mcp",""]],
        'third-models': [["codex-models-manager","--lib",""],["codex-model-provider","--lib","originator_tests"],["codex-core","--lib","originator_catalogs_preserve_"],["codex-core","--lib","new_uses_active_provider_for_model_refresh"]],
        'third-core': [["codex-core","--test","all","suite::hooks::user_prompt_submit"],["codex-core","--test","all","guardian_denial_rejects_tool_call_with_rationale"],["codex-core","--test","all","code_mode_can_yield_and_resume_with_wait"],["codex-core","--test","all","originator_catalogs_control_turn_instructions_and_tools"],["codex-core","--lib","initial_settings_remain_pending_until_persistence_succeeds"]],
        'third-appserver': [["codex-app-server","--lib","resume_history_reuse_tests"],["codex-app-server","--test","all","thread_resume::"],["codex-app-server","--test","all","resume_revalidates_persisted_thread_after_config_load"],["codex-app-server","--test","all","resume_reloads_config_when_saved_workspace_roots_change"]],
        'third-tui': [["codex-tui","--lib","transcript_view"],["codex-tui","--lib","owned_transcript"],["codex-tui","--lib","transcript_composer"],["codex-tui","--lib","owned_prompt_revert_retained_history"]],
        'mcp-reload-state': [
          ['codex-config', '--lib', 'reload_local_mcp_servers'],
          ['codex-features', '--lib', 'incremental_tools_are_stable'],
          ['codex-mcp', '--lib', 'cancelled_reconnect_restores_claimed_servers'],
          ['codex-mcp', '--lib', 'excluding_reconnect_servers'],
          ['codex-core', '--lib', 'reload_mcp_servers_handler'],
          ['codex-core', '--lib', 'tools::spec_plan::tests::allowed_tools_filter_sources_before_code_mode_and_discovery'],
          ['codex-core', '--lib', 'tools::spec_plan::tests::api_tool_free_model_closes_catalog_and_native_dispatch_registry'],
          ['codex-core', '--lib', 'tools::spec_plan::tests::mcp_and_tool_search_follow_direct_and_deferred_tool_exposure'],
          ['codex-core', '--lib', 'ignore_user_config_keeps_empty_user_layer'],
          ['codex-core', '--lib', 'context::world_state::top_level_tools'],
        ],
        'mcp-reload-integration': [
          ['codex-core', '--test', 'all', 'suite::mcp_reload_tool::'],
          ['codex-core', '--test', 'all', 'suite::scenarios::incremental_tools::'],
          ['codex-core', '--test', 'all', 'suite::scenarios::incremental_tools_resume::'],
        ],
        'reasoning-effort-default': [['codex-features', '--lib', '']],
        'auth-decrypted-cache': [['codex-secrets', '--lib', 'local::'], ['codex-secrets', '--lib', 'tests::manager_round_trips_local_backend'], ['codex-login', '--lib', 'auth::storage::tests::policy']],
        'catalog-retention': [['codex-models-manager', '--lib', ''], ['codex-model-provider', '--lib', 'shared_state::tests::'], ['codex-protocol', '--lib', 'error::'], ['codex-prompts', '--lib', 'model_instructions'], ['codex-core', '--lib', 'model_resolution_preserves_startup_overrides_and_instruction_provenance']],
        'analytics-bound': [['codex-analytics', '--lib', ''], ['codex-app-server', '--lib', 'outgoing_message::tests']],
        'code-mode-trace': [['codex-code-mode', '--lib', ''], ['codex-core', '--test', 'code_mode_tracing', 'stdio_callbacks_preserve_context_across_overlapping_yielded_cells']],
        'catalog-retention-integration': [['codex-core', '--test', 'all', 'suite::models_cache_auth::failed_catalog_refresh_preserves_tool_search_on_the_next_turn'], ['codex-core', '--test', 'all', 'suite::personality::config_personality_'], ...(platform === 'win32' ? [] : [['codex-core', '--test', 'all', 'suite::remote_models']])],
        'catalog-refresh': [['codex-mcp-extension', '--lib', 'cloud_'], ['codex-mcp-extension', '--test', 'plugin_mcp', ''], ['codex-skills-extension', '--lib', 'cloud_cache_tests'], ['codex-core', '--lib', 'turn_start_refreshes_dirty_mcp_reuses_clean_runtime_and_cancels_discovery']],
        'catalog-refresh-integration': [['codex-core', '--test', 'all', 'suite::skills_extension::cloud_lifecycle_tests']],
        network: [['codex-network-proxy', '--lib', '']], protocol: [['codex-protocol', '--lib', 'permissions::']],
        sandbox: [['codex-sandboxing', '--lib', '']], 'thread-store': [['codex-thread-store', '--lib', 'resolve_requested_rollout_path_']],
        'core-lib': ['recompute_token_usage', 'context_manager::history::', 'context::instruction_state_projection::tests::', 'unified_exec::', 'persisted_permissions_initialize_proxy_with_expandable_managed_allowlist',
          'explicit_permission_overrides_win_over_saved_unnamed_permissions', 'initial_settings_remain_pending_until_persistence_succeeds'].map(f => ['codex-core', '--lib', f]),
        'core-integration': ['auto_compact_accounts_for_encrypted_reasoning', 'auto_compact_accounts_for_unreported_reasoning', 'code_mode_dynamic_tool_calls_pending_together_resolve_in_reverse_order', 'compaction_preserves_history_after_restart', 'manual_compact_emits_context_compaction_items',
          'manual_compact_records_durable_and_local_token_usage', 'exec_command_consumes_pushed_remote_process_events',
          'cloud_skill_reads_run_in_parallel', 'code_mode_interrupt_terminates_active_cells_and_nested_tools',
          ...(platform === 'win32' ? [] : ['shell_snapshot_v2_returns_before_inherited_output_closes', 'agent_started_proxy_denies_brokered_provider_alias']),
          ...(platform === 'darwin' ? ['apply_patch_system_aliases'] : [])].map(f => ['codex-core', '--test', 'all', f]),
        'app-server-lib': ['persisted_resume_settings', 'collect_resume_override_mismatches_includes_service_tier'].map(f => ['codex-app-server', '--lib', f]),
        'app-server': ['thread_resume::', 'thread_revert::', 'thread_settings_update::', 'rollout_compress_runs_after_startup_with_compression_disabled'].map(f => ['codex-app-server', '--test', 'all', f]),
        tui: ['fork_last_filters_latest_session_by_cwd_unless_show_all', 'configured_ctrl_space_submit_wins_over_transcript_selection',
          'replay_preserves_typed_updates_before_voice_steers_the_turn', 'in_progress_voice_replay_restores_the_late_reasoning_guard'].map(f => ['codex-tui', '--lib', f]),
      };
      if (Object.hasOwn(choices, scope)) args = choices[scope].map(([crate, target, ...selection]) => finish(['-p', crate, target,
        ...selection.filter(Boolean), ...(['codex-core', 'codex-app-server'].includes(crate) && target === '--test' ? ['--features', 'integration-tests'] : [])]));
      if (needsHost) envRecipe = 'code-mode-host';
      break;
    }
    case 'check-deletion-approval-native':
      if (!tail.length) args = [lib('codex-shell-command', 'command_safety::'),
        ...['exec_policy::tests::', ...(platform === 'win32' ? [] : ['tools::approvals::tests::deletion_approval_']),
          'apply_patch::tests::'].map(filter => lib('codex-core', filter))];
      break;
    case 'check-usage-window':
      if (!tail.length) args = [lib('codex-app-server', 'account_processor')];
      break;
    case 'check-api-context':
      isolateHostEnvironment = false;
      args = scoped({ prompts: [lib('codex-prompts', 'api_projection'), lib('codex-prompts', 'configured_canonical_hint')],
        skills: [lib('codex-skills-extension', 'api_host_dedup')],
        core: [lib('codex-core', 'instruction_state_projection'), lib('codex-core', 'multi_agent_mode::tests')] });
      break;
    case 'check-model-harness-profiles':
      isolateHostEnvironment = false;
      args = scoped({ config: [lib('codex-config', 'harness'), lib('codex-prompts', 'model_instructions'), lib('codex-prompts', 'multi_agent_instructions')],
        context: ['context::world_state::model::tests', 'context::world_state::multi_agent_mode::tests', 'session::provider_handoff::tests', 'instruction_state_projection'].map(f => lib('codex-core', f)).concat([integration('suite::model_switching')]),
        tools: ['anthropic_shared_tools', 'anthropic_common_discovery', 'anthropic_azrael_tools_patch_read_and_execute', 'tools::router::tests::chat_discovery', 'mcp_and_tool_search_follow_direct_and_deferred_tool_exposure', 'retired_model_harness_is_rejected_during_config_load'].map(f => lib('codex-core', f)) });
      break;
    case 'check-root-resume-reasoning':
      if (!tail.length) args = [libs(['codex-core', 'codex-protocol', 'codex-state'], 'root_resume')];
      break;
    case 'check-task-work-time-native':
      args = scoped({ protocol: [lib('codex-app-server-protocol', 'thread_history')],
        'user-wait': [lib('codex-core', 'user_wait'), lib('codex-mcp', 'elicitation'),
          ...['codex-app-server-protocol', 'codex-thread-store', 'codex-app-server'].map(p => lib(p, 'user_wait'))],
        store: ['recorded_turn_attribution', 'deferred_turn_duration_stays_frozen_after_a_new_turn'].map(f => lib('codex-thread-store', f)),
        appserver: ['bespoke_event_handling::tests::test_handle_turn_', 'test_emit_turn_deferred_preserves_frozen_timing'].map(f => lib('codex-app-server', f)) });
      break;
    case 'check-thread-auto-compaction': {
      isolateHostEnvironment = false;
      const library = libs(['codex-core', 'codex-protocol', 'codex-app-server-protocol', 'codex-app-server'], 'auto_compaction');
      const test = integration('auto_compaction');
      args = scoped({ all: [library, test], lib: [library], integration: [test] }, 'all');
      break;
    }
    case 'check-parent-requests':
      if (!tail.length) args = [['test', ...['codex-core', 'codex-prompts', 'codex-state', 'codex-app-server-protocol', 'codex-thread-store'].flatMap(c => ['-p', c]), '--lib', '--locked', '--offline', '--', '--test-threads=1', '--nocapture', 'parent_request', 'parent_response_wait']];
      break;
    case 'check-capacity-recovery':
      if (!tail.length) args = [lib('codex-core', 'capacity')];
      break;
    case 'check-task-memory': {
      // This wrapper owns its freeze/environment and derives projectRoot/engine;
      // its argv contains only an optional scope, never a source-root argument.
      const storage = ['test', '-p', 'azrael-task-memory', '--lib', '--locked', '--offline', '--', '--test-threads=1'];
      const core = ['test', '-p', 'codex-core', '--lib', '--locked', '--offline', 'task_memory', '--', '--test-threads=1'];
      args = scoped({ all: [storage, core], storage: [storage], core: [core] }, 'all');
      break;
    }
    case 'check-task-profile-skills':
      if (!tail.length) args = [
        ['codex-config', ['--lib'], 'skills_config'],
        ['codex-skills-extension', ['--lib'], 'host_roots'],
        ['codex-protocol', ['--lib'], 'agent_profile::tests::'],
        ['codex-login', ['--lib'], 'auth::profiles::tests::profiles_remove_retires_every_cross_store_owner_even_with_active_usage'],
        ['codex-core', ['--lib'], 'session::agent_profile::tests::'],
        ['codex-core', ['--lib'], 'session::turn_input::tests::steering_does_not_wait_for_realtime_history'],
        ['codex-core', ['--lib'], 'session::user_questions::tests::queued_reply_retains_original_profile_after_newer_turn_metadata'],
        ['codex-queue-extension', ['--test', 'queue_service'], 'captured_profile_survives_queue_restart_and_content_edit'],
      ].map(([c, target, f]) => ['test', '-p', c, ...target, '--locked', '--offline', f])
        .concat([['test', '-p', 'codex-core', '--lib', '--locked', '--offline',
          'session::agent_profile::tests::materializer_snapshot_contract_fixture', '--', '--ignored', '--exact']]);
      break;
    case 'check-shared-engine-native': {
      // Share reviewed selections with the side-effect-free runner export so
      // early preparation cannot reintroduce retired broad test targets.
      const choices = require('./check-shared-engine-native.cjs').selectedScopes();
      args = scoped(Object.fromEntries(Object.entries(choices).map(([name, entries]) => [name,
        entries.map(([crate, filter, target]) => finish(['-p', crate,
          ...(Array.isArray(target) ? target : target ? ['--test', target] : ['--lib']), filter]))])));
      break;
    }
    case 'check-question-withdrawal-native': {
      const groups = { lib: [libs(['codex-core', 'codex-protocol', 'codex-app-server-protocol', 'codex-app-server'], 'async_question'),
        ...['session::accepted_user_inputs::tests', 'session::compact_input::tests', 'session::turn_input::tests'].map(f => lib('codex-core', f))],
      schemas: [lib('codex-app-server-protocol', 'schema_fixtures_tests')],
      queue: [finish(['-p', 'codex-queue-extension', '--test', 'queue_service'])],
      questions: [finish(['-p', 'codex-core', '--test', 'request_user_input_async', '--features', 'codex-core/integration-tests', 'request_user_input_async'])] };
      // Preserve the wrapper's actual execution order for an all-scopes plan.
      args = scoped({ ...groups, all: [groups.lib[0], ...groups.schemas, ...groups.queue, ...groups.questions, ...groups.lib.slice(1)] }, 'all');
      break;
    }
    case 'check-window-approval-native': {
      const groups = { ledger: [lib('codex-core', 'host_approval')], wire: [lib('codex-app-server-protocol', 'host_approval')],
        archive: [lib('codex-thread-store', 'host_approval')],
        admission: ['session::compact_input::tests', 'session::turn_input::tests'].map(f => lib('codex-core', f)),
        queue: [finish(['-p', 'codex-queue-extension', '--test', 'queue_service'])],
        rpc: [finish(['-p', 'codex-app-server', '--features', 'integration-tests', '--test', 'all', 'host_approval_rpc'])],
        schemas: [lib('codex-app-server-protocol', 'schema_fixtures_tests')] };
      args = scoped({ ...groups, all: Object.values(groups).flat() }, 'all');
      if (['all', 'queue'].includes(tail[0] ?? 'all')) envRecipe = 'sdk-python-path';
      break;
    }
    case 'check-mcp-oauth-store':
      if (tail.length === 2 && tail[0] === '--stage' && ['default', 'preserve-order'].includes(tail[1])) {
        args = [['test', '-p', 'codex-rmcp-client', '--lib', 'oauth::', '--locked', '--offline', ...(tail[1] === 'preserve-order' ? ['--features', 'serde_json/preserve_order'] : []), '--', '--test-threads=1']];
      }
      break;
    case 'check-startup-performance-native': {
      const store = ['history_revision::tests', 'model_context::tests'].map(f => ['test', '-p', 'codex-thread-store', '--lib', f, '--locked', '--offline']);
      const appserver = [['test', '-p', 'codex-app-server', '--lib', 'resume_history_reuse_tests', '--locked', '--offline']];
      args = scoped({ store, appserver, all: [...store, ...appserver] }, 'all');
      break;
    }
    case 'check-response-tps-native':
      args = scoped({ protocol: [lib('codex-protocol', 'response_performance')], core: [lib('codex-core', 'turn_timing::tests'), lib('codex-core', 'session::tests::response_performance'), lib('codex-core', 'client::tests::response_stream_records_last_model_feedback_ids')], appserver: [lib('codex-app-server-protocol', 'response_performance'), lib('codex-app-server-protocol', 'schema_fixtures_tests')], api: [lib('codex-api', 'completed_preserves_server_service_tier'), finish(['-p', 'codex-api', '--test', 'sse_end_to_end', 'responses_stream_parses_items_and_completed_end_to_end'])] });
      break;
    case 'check-task-recovery-native':
      if (!tail.length) args = ['host_approval', 'async_question', 'session::accepted_user_inputs::tests', 'context_manager::history::tests::normalize_', 'context_manager::history::tests::for_prompt_recovers_interrupted_tools_with_stable_ids_and_preserves_raw_history', 'tasks::panic_tests::', 'tasks::tests::'].map(f => lib('codex-core', f));
      break;
    case 'check-project-maintenance':
      if (tail.length === 2 && tail[0] === '--stage') {
        const stages = { library: [finish(['-p', 'azrael-project-maintenance'], 4)], prompts: [lib('codex-prompts', 'project_maintenance')], core: [lib('codex-core', 'project_maintenance')] };
        args = Object.hasOwn(stages, tail[1]) ? stages[tail[1]] : undefined;
      }
      break;
    case 'check-error-classification-native':
      if (!tail.length) args = [lib('codex-protocol', 'unclassified_error_preserves_unknown_cause_without_automatic_retry'), ...['devin::native_runtime::errors::tests::', 'devin::native_runtime::transport::tests::', 'devin::native_runtime::tests::helper_failures_preserve_precise_client_error_categories'].map(f => lib('codex-core', f))];
      break;
  }
  return args?.map(value => ({ args: value, isolateHostEnvironment, ...(envRecipe ? { envRecipe } : {}) }));
}

function recipesForCheck(config, check) {
  const fail = reason => ({ cargoPreparations: [], gaps: [{ checkId: check.id, reason }] });
  const argv = check.args || [];
  if (check.executable !== 'node' || check.cargoPreflight !== 'selected-tests-v2') return fail('unsupported Cargo preflight declaration or executable');
  if (!/^scripts\/check-[a-z-]+\.cjs$/.test(argv[0] || '')) return fail('unsupported wrapper path');
  const wrapper = path.basename(argv[0], '.cjs');
  if (!Object.hasOwn(wrapperHashes, wrapper)) return fail('no reviewed Cargo recipe for wrapper');
  const derivesSource = ['check-task-memory', 'check-agent-image-attachments', 'check-find-names'].includes(wrapper);
  if (derivesSource) {
    if (typeof config.engineSourceRoot !== 'string' || !path.isAbsolute(config.engineSourceRoot) ||
        path.resolve(config.engineSourceRoot) !== path.resolve(config.projectRoot, 'engine')) {
      return fail(wrapper + ' wrapper does not derive the configured engine source root');
    }
  } else if (argv[1] !== '{engineSourceRoot}' && argv[1] !== config.engineSourceRoot) return fail('wrapper does not select the configured engine source root');
  if (wrapper === 'check-selected-upstream-native' && ['core-integration', 'code-mode-trace'].includes(argv[2]) &&
      argv[3] !== '{engineDirectory}' && argv[3] !== config.engineDirectory) return fail('wrapper does not select the configured engine runtime directory');
  let source;
  try { source = fs.readFileSync(path.join(config.projectRoot, argv[0]), 'utf8'); }
  catch (error) { return fail(`cannot read wrapper: ${error.code || error.message}`); }
  if (createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex') !== wrapperHashes[wrapper]) return fail('wrapper source changed; review its recipe and update the recorded source hash');
  const recipes = reviewedRecipes(wrapper, argv.slice(derivesSource ? 1 : 2), process.platform);
  if (!recipes?.length) return fail('unsupported wrapper scope or arguments');
  return { cargoPreparations: recipes.map((recipe, index) => ({ checkId: check.id, ...recipe,
    ...(wrapper === 'check-task-profile-skills' && index === recipes.length - 1
      ? { envRecipe: 'task-profile-materializer' } : {}) })), gaps: [] };
}

module.exports = { recipesForCheck };

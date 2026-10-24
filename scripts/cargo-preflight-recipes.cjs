'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// These are reviewed command recipes, never evaluated wrapper source. A wrapper
// change requires reviewing its commands/environment and updating this identity;
// otherwise cache eligibility reports a gap rather than silently using stale commands.
// Normalize checkout line endings, but preserve all other source bytes.
const wrapperHashes = Object.freeze({
  'check-usage-window': 'b87b8e4c67236e297b003584c353448b7acc2a7a5ce36aec107b3ab0af173fbd',
  'check-api-context': '29a883f035865ade22a579c238e33d7c33e7931795115f949f0f597a08af6d37',
  'check-model-harness-profiles': 'a38d1ac09f80351d662d824245dbdcb03a6e9f320e8c550bed9c7066e2ae3928',
  'check-root-resume-reasoning': '0158f4af4864a884036821e42228d0d74e4396a7d9cc3856bcd7f4db190a76e4',
  'check-task-work-time-native': '63cb1e6655af44990874fbf20c2158470631e25397c9a72ba24b96233354f973',
  'check-thread-auto-compaction': '45538fd544446ae4af9453e6cde0b4cd62e9ba87b1b62e5f2c57ea80723bb053',
  'check-parent-requests': 'aa2456ae2edc5a2e3df68815594a0d01b6e1de202bebe50a2fe9ce7ac819a368',
  'check-capacity-recovery': 'ca6cccb3d50df005500d5ceeedbba0c064806a74aa4c089c880f82186b6d4c37',
  'check-task-profile-skills': '963c93a86d4c501dd7543fe4809ff48b4ee2d3e2cab2cd2e2727a1d484ef4d17',
  'check-shared-engine-native': 'db9d1b3a0316cd017a8c5934b88ee295050a166ab9c4987644a0dcae17a2fc05',
  'check-question-withdrawal-native': 'b17ee0244ec76cb3fa54d0384dfdb260bd8d8055a5ff32958bd1305d5bf22080',
  'check-mcp-oauth-store': '1b2d990b48a5bdcd038fc6a58cfa56f587797681823e3c10d41e43513cfdddfa',
  'check-startup-performance-native': '5cb7624493f45adf3e04f8d3cc4c51b55f0386b735e87a001c99afede7c947e2',
  'check-response-tps-native': 'ff6fd89fe8103a7da51f5555f0c704bd37d056b3f5017f10251d7285563b74e0',
  'check-task-recovery-native': 'b6a39560e33898d9919cd99cd95e07f405cfcb7a3720ad256426019f03de851c',
  'check-project-maintenance': '1eea8c6a873bcf17a7899461a4c2e171796054bc13b9e3a48e87d95a8499e87e',
  'check-error-classification-native': '338386a3b633c8364fae67e268c86405328b60f809e951f193edc8a533c1d616',
  'check-window-approval-native': '525b897176b1c4ca2bd8c91fff09cd61b5f6c211ac874ea0aa02d5397c963325',
});
const finish = args => ['test', ...args, '--locked', '--offline', '--', '--test-threads=1'];
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
      args = scoped({ config: [lib('codex-config', 'harness'), lib('codex-prompts', 'model_instructions')],
        context: ['context::world_state::model::tests', 'session::provider_handoff::tests', 'instruction_state_projection'].map(f => lib('codex-core', f)).concat([integration('suite::model_switching')]),
        tools: ['claude', 'azrael_defaults_and_explicit_claude_profile_select_executable_tools', 'anthropic_azrael_tools_patch_read_and_execute', 'tools::router::tests::chat_discovery', 'mcp_and_tool_search_follow_direct_and_deferred_tool_exposure'].map(f => lib('codex-core', f)) });
      break;
    case 'check-root-resume-reasoning':
      if (!tail.length) args = [libs(['codex-core', 'codex-protocol', 'codex-state'], 'root_resume')];
      break;
    case 'check-task-work-time-native':
      args = scoped({ protocol: [lib('codex-app-server-protocol', 'thread_history')],
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
    case 'check-task-profile-skills':
      if (!tail.length) args = [['codex-config', 'skills_config'], ['codex-skills-extension', 'host_roots']].map(([c, f]) => ['test', '-p', c, '--lib', '--locked', '--offline', f]);
      break;
    case 'check-shared-engine-native': {
      const appserver = [];
      // Windows native launch tests have a special executor. These arguments are
      // its explicit preflightCommands input, before --no-run/JSON compilation.
      if (platform === 'win32') for (const f of ['windows_tests::', 'win::process_tree::tests::', 'pipe::tests::process_fallback_interrupt_terminates_root']) appserver.push(['test', '-p', 'codex-utils-pty', '--lib', f, '--locked', '--offline']);
      for (const f of ['azrael::tests::', 'azrael_lifecycle::tests::', 'registration::tests::', 'azrael_storage::tests::', 'backend::pid::tests::']) {
        appserver.push(platform === 'win32' && f === 'backend::pid::tests::' ? ['test', '-p', 'codex-app-server-daemon', '--lib', f, '--locked', '--offline'] : lib('codex-app-server-daemon', f));
      }
      for (const f of ['azrael_shared_server::tests::', 'azrael_shutdown::tests::', 'azrael_shared_server::instance_tests::', 'azrael_thread_engines::tests::', 'azrael_state::', 'config_manager::window_context_tests::']) appserver.push(lib('codex-app-server', f));
      appserver.push(lib('codex-install-context', 'azrael_entry_resolves_its_own_code_mode_host'));
      for (const f of ['entry::tests::', 'entry::endpoint_tests::']) appserver.push(finish(['-p', 'codex-app-server', '--bin', 'azrael', f]));
      args = scoped({ appserver,
        handoff: [lib('codex-app-server-daemon', 'session_handoff::tests::'),
          lib('codex-core', 'session::handoff::tests::'),
          lib('codex-app-server', 'azrael_session_handoff::tests::'),
          lib('codex-app-server', 'azrael_thread_engines::tests::'),
          lib('codex-app-server', 'azrael_shared_server::tests::')],
        bridge: [finish(['-p', 'codex-app-server-client', '--no-default-features', '--lib', 'remote::tests::']),
          finish(['-p', 'codex-app-server-client', '--no-default-features', '--bin', 'azrael-bridge', 'terminal_'])],
        manual: [lib('codex-core', 'azrael_manual_resume::tests::'), lib('codex-core', 'manual_resume_marker'), finish(['-p', 'codex-queue-extension', '--test', 'queue_service', 'manual_resume_marker'])] });
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
      args = scoped({ protocol: [lib('codex-protocol', 'response_performance')], core: [lib('codex-core', 'turn_timing::tests'), lib('codex-core', 'session::tests::response_performance')], appserver: [lib('codex-app-server-protocol', 'response_performance')] });
      break;
    case 'check-task-recovery-native':
      if (!tail.length) args = ['session_restore_', 'host_approval', 'async_question', 'session::accepted_user_inputs::tests', 'context_manager::history::tests::normalize_', 'context_manager::history::tests::for_prompt_recovers_interrupted_tools_with_stable_ids_and_preserves_raw_history', 'tasks::panic_tests::', 'tasks::tests::'].map(f => lib('codex-core', f));
      break;
    case 'check-project-maintenance':
      if (tail.length === 2 && tail[0] === '--stage') {
        const stages = { library: [finish(['-p', 'azrael-project-maintenance'])], prompts: [lib('codex-prompts', 'project_maintenance')], core: [lib('codex-core', 'project_maintenance')] };
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
  if (check.executable !== 'node' || check.cargoPreflight !== 'selected-tests-v1') return fail('unsupported Cargo preflight declaration or executable');
  if (!/^scripts\/check-[a-z-]+\.cjs$/.test(argv[0] || '')) return fail('unsupported wrapper path');
  const wrapper = path.basename(argv[0], '.cjs');
  if (!Object.hasOwn(wrapperHashes, wrapper)) return fail('no reviewed Cargo recipe for wrapper');
  if (argv[1] !== '{engineSourceRoot}' && argv[1] !== config.engineSourceRoot) return fail('wrapper does not select the configured engine source root');
  let source;
  try { source = fs.readFileSync(path.join(config.projectRoot, argv[0]), 'utf8'); }
  catch (error) { return fail(`cannot read wrapper: ${error.code || error.message}`); }
  if (createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex') !== wrapperHashes[wrapper]) return fail('wrapper source changed; review its recipe and update the recorded source hash');
  const recipes = reviewedRecipes(wrapper, argv.slice(2), process.platform);
  if (!recipes?.length) return fail('unsupported wrapper scope or arguments');
  return { cargoPreparations: recipes.map(recipe => ({ checkId: check.id, ...recipe })), gaps: [] };
}

module.exports = { recipesForCheck };

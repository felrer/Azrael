'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, mock } = require('node:test');
const { recipesForCheck } = require('./cargo-preflight-recipes.cjs');
const { preflightCommands } = require('./cargo-verification.cjs');
const projectRoot = path.resolve(__dirname, '..');
// Filesystem fixtures are virtual: no Cargo process or temporary tree is needed.
const engineSourceRoot = path.join(projectRoot, 'artifacts', 'virtual-recipe-source');
const config = { projectRoot, engineSourceRoot };
function check(wrapper, tail = [], id = wrapper) {
  return { id, executable: 'node', args: [`scripts/${wrapper}.cjs`, '{engineSourceRoot}', ...tail], level: 'native', cargoPreflight: 'selected-tests-v2' };
}
const oauth = stage => check('check-mcp-oauth-store', ['--stage', stage], `oauth-${stage}`);
const capacity = check('check-capacity-recovery');

test('task-profile recipe matches all actual wrapper calls and keeps materializer preparation explicit', async () => {
  const calls = [], homes = [], closures = [];
  const digest = 'a'.repeat(64), home = path.join(projectRoot, 'artifacts', 'virtual-task-profile', 'home');
  const selected = check('check-task-profile-skills');
  const result = recipesForCheck(config, selected);
  assert.deepEqual(result.gaps, []);
  const context = {
    __dirname, console, process: { argv: ['node', selected.args[0], engineSourceRoot], env: {} },
    require: name => {
      if (name === 'node:fs') return { existsSync: () => true, writeFileSync() {} };
      if (name === 'node:path') return path;
      if (name === './cargo-verification.cjs') return { runCargoTest: (_source, args, options) => {
        calls.push({ source: _source, args, options }); return { status: 0 };
      } };
      if (name === './artifact-run.cjs') return {
        beginArtifactRun: () => ({ temporary: path.dirname(home), reports: path.dirname(home) }),
        finishArtifactRun: (_run, outcome) => closures.push(outcome),
      };
      if (name === './task-profile-runtime.cjs') return { TaskProfileRuntime: class {
        constructor(options) { homes.push(options.codexHome); }
        async createWorkbench() { return { digest }; }
      } };
      throw Error('Unexpected wrapper dependency: ' + name);
    },
  };
  await require('node:vm').runInNewContext(fs.readFileSync(path.join(__dirname, 'check-task-profile-skills.cjs'), 'utf8'), context);
  assert.equal(calls.length, 9);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.map(call => call.args))), result.cargoPreparations.map(recipe => recipe.args));
  assert.ok(calls.every(call => call.source === engineSourceRoot && call.options.isolateHostEnvironment === true));
  assert.equal(result.cargoPreparations.at(-1).envRecipe, 'task-profile-materializer');
  assert.ok(result.cargoPreparations.slice(0, -1).every(recipe => recipe.envRecipe === undefined));
  assert.deepEqual(homes, [home]);
  assert.equal(calls.at(-1).options.env.TASK_PROFILE_CONTRACT_HOME, home);
  assert.equal(calls.at(-1).options.env.TASK_PROFILE_CONTRACT_DIGEST, digest);
  assert.equal(closures.length, 1);
  assert.equal(closures[0].producerStopped, true);
  assert.equal(closures[0].exitCode, 0);
  assert.equal(recipesForCheck(config, check('check-task-profile-skills', ['unknown'])).gaps.length, 1);
});

test('role profile admission recipe preserves dispatcher, fork isolation and root authority selections', () => {
  const result = recipesForCheck(config, check('check-role-profiles-native'));
  assert.deepEqual(result.gaps, []);
  assert.deepEqual(result.cargoPreparations.map(x => x.args), [
    'role_profile', 'spawn_agent_fork', 'multi_agent_v2_spawn_fork_turns_all_applies_agent_type_override',
    'spawn_agent_can_fork_parent_thread_history_with_sanitized_items', 'root_coordination', 'defer_root_registration',
    'config::schema::tests::config_schema_matches_fixture',
  ].map(filter => ['test', '-p', 'codex-core', '--lib', '--locked', '--offline', filter, '--', '--test-threads=1'])
    .concat([['test', '-p', 'codex-app-server-protocol', '--lib', '--locked', '--offline', 'schema_fixtures_tests::', '--', '--test-threads=1']]));
  assert.ok(result.cargoPreparations.every(x => x.isolateHostEnvironment));
  assert.equal(recipesForCheck(config, check('check-role-profiles-native', ['unknown'])).gaps.length, 1);
});

test('model harness recipes retain prompt roles, retirement rejection and context coverage', () => {
  const selected = Object.fromEntries(['config', 'tools', 'context'].map(scope => {
    const result = recipesForCheck(config, check('check-model-harness-profiles', [scope]));
    assert.deepEqual(result.gaps, []);
    return [scope, result.cargoPreparations];
  }));
  assert.deepEqual(selected.config.map(recipe => recipe.args[4]), ['harness', 'model_instructions', 'multi_agent_instructions']);
  assert.equal(selected.tools.length, 6);
  assert.equal(selected.tools.at(-1).args[4], 'retired_model_harness_is_rejected_during_config_load');
  assert.deepEqual(selected.context.slice(0, -1).map(recipe => recipe.args[4]), [
    'context::world_state::model::tests', 'context::world_state::multi_agent_mode::tests',
    'session::provider_handoff::tests', 'instruction_state_projection',
  ]);
  assert.ok(Object.values(selected).flat().every(recipe => recipe.isolateHostEnvironment === false));
});

test('usage window recipe preserves host isolation and rejects extra arguments', () => {
  const result = recipesForCheck(config, check('check-usage-window'));
  assert.deepEqual(result.gaps, []);
  assert.equal(result.cargoPreparations[0].isolateHostEnvironment, true);
  assert.equal(recipesForCheck(config, check('check-usage-window', ['extra'])).gaps.length, 1);
});

test('OAuth default and preserve_order preserve separate exact compilation recipes', () => {
  const results = [oauth('default'), oauth('preserve-order')].map(value => recipesForCheck(config, value));
  assert.deepEqual(results.flatMap(result => result.gaps), []);
  const recipes = results.flatMap(result => result.cargoPreparations);
  assert.deepEqual(recipes.map(x => x.args), [
    ['test', '-p', 'codex-rmcp-client', '--lib', 'oauth::', '--locked', '--offline', '--', '--test-threads=1'],
    ['test', '-p', 'codex-rmcp-client', '--lib', 'oauth::', '--locked', '--offline', '--features', 'serde_json/preserve_order', '--', '--test-threads=1'],
  ]);
  assert.ok(recipes.every(x => x.isolateHostEnvironment === true));
});

test('bridge, integration, package-wide library and parent-request arguments stay intact', () => {
  const bridge = recipesForCheck(config, check('check-shared-engine-native', ['bridge']));
  assert.deepEqual(bridge.gaps, []);
  assert.deepEqual(bridge.cargoPreparations.map(recipe => recipe.args), [
    ['test', '-p', 'codex-app-server-client', '--no-default-features', '--lib', 'remote::tests::', '--locked', '--offline', '--', '--test-threads=1'],
    ['test', '-p', 'codex-app-server-client', '--no-default-features', '--bin', 'azrael-bridge', 'terminal_', '--locked', '--offline', '--', '--test-threads=1'],
  ]);
  const context = recipesForCheck(config, check('check-model-harness-profiles', ['context'])).cargoPreparations;
  assert.deepEqual(context.at(-1).args, ['test', '-p', 'codex-core', '--test', 'all', '--features', 'codex-core/integration-tests', 'suite::model_switching', '--locked', '--offline', '--', '--test-threads=1']);
  assert.equal(context.at(-1).isolateHostEnvironment, false);
  assert.deepEqual(recipesForCheck(config, check('check-project-maintenance', ['--stage', 'library'])).cargoPreparations[0].args,
    ['test', '-p', 'azrael-project-maintenance', '--locked', '--offline', '--', '--test-threads=4']);
  const maintenance = require('./check-project-maintenance.cjs');
  const actualSource = path.join(projectRoot, 'engine');
  assert.deepEqual(maintenance.commands([actualSource, '--stage', 'library']).args,
    ['test', '-p', 'azrael-project-maintenance', '--locked', '--offline', '--', '--test-threads=4']);
  for (const stage of ['prompts', 'core']) {
    assert.deepEqual(maintenance.commands([actualSource, '--stage', stage]).args,
      ['test', '-p', stage === 'core' ? 'codex-core' : 'codex-prompts', '--lib', 'project_maintenance', '--locked', '--offline', '--', '--test-threads=1']);
  }
  const parent = recipesForCheck(config, check('check-parent-requests')).cargoPreparations[0];
  assert.deepEqual(parent.args.slice(-5), ['--', '--test-threads=1', '--nocapture', 'parent_request', 'parent_response_wait']);
});

test('unsupported wrappers, declarations, root selections and scopes explicitly report gaps', () => {
  for (const value of [check('check-new-wrapper'), check('check-api-context', ['not-a-scope']),
    check('check-api-context', ['__proto__']), check('check-project-maintenance', ['--stage', '__proto__']),
    { ...capacity, cargoPreflight: 'unknown-v2' }, { ...capacity, args: [capacity.args[0], '/different/source'] },
    { ...capacity, args: ['scripts/../check-capacity-recovery.cjs', '{engineSourceRoot}'] }]) {
    const result = recipesForCheck(config, value);
    assert.equal(result.gaps.length, 1, value.id);
    assert.deepEqual(result.cargoPreparations, []);
  }
});

test('wrapper source drift and unreadable wrappers never execute discovery code', () => {
  const original = fs.readFileSync;
  let executed = false;
  global.__cargoRecipeDiscovery = () => { executed = true; };
  mock.method(fs, 'readFileSync', (filename, ...args) => String(filename).endsWith('check-capacity-recovery.cjs') ? 'global.__cargoRecipeDiscovery();' : original(filename, ...args));
  try {
    assert.match(recipesForCheck(config, capacity).gaps[0].reason, /source changed/);
    assert.equal(executed, false);
  } finally { mock.restoreAll(); delete global.__cargoRecipeDiscovery; }
  mock.method(fs, 'readFileSync', (filename, ...args) => {
    if (String(filename).endsWith('check-capacity-recovery.cjs')) throw Object.assign(Error('missing'), { code: 'ENOENT' });
    return original(filename, ...args);
  });
  try { assert.match(recipesForCheck(config, capacity).gaps[0].reason, /cannot read wrapper: ENOENT/); }
  finally { mock.restoreAll(); }
});

test('wrapper source identity accepts ordinary checkout line-ending differences', () => {
  const original = fs.readFileSync;
  mock.method(fs, 'readFileSync', (filename, ...args) => {
    const content = original(filename, ...args);
    return String(filename).endsWith('check-capacity-recovery.cjs') ? content.replace(/\r\n/g, '\n') : content;
  });
  try { assert.deepEqual(recipesForCheck(config, capacity).gaps, []); }
  finally { mock.restoreAll(); }
});

test('window approval preserves SDK environment only on all/queue scope', () => {
  const all = recipesForCheck(config, check('check-window-approval-native', ['all']));
  assert.deepEqual(all.gaps, []);
  assert.ok(all.cargoPreparations.every(x => x.envRecipe === 'sdk-python-path'));
  const rpc = all.cargoPreparations.find(x => x.args.includes('host_approval_rpc'));
  assert.deepEqual(rpc.args.slice(0, 9), ['test', '-p', 'codex-app-server', '--features', 'integration-tests', '--test', 'all', 'host_approval_rpc', '--locked']);
});

test('deletion approval preparation preserves the current platform native command selections', () => {
  const result = recipesForCheck(config, check('check-deletion-approval-native'));
  assert.deepEqual(result.gaps, []);
  assert.deepEqual(result.cargoPreparations.map(x => x.args), [
    ['test', '-p', 'codex-shell-command', '--lib', 'command_safety::', '--locked', '--offline', '--', '--test-threads=1'],
    ...['exec_policy::tests::', ...(process.platform === 'win32' ? [] : ['tools::approvals::tests::deletion_approval_']), 'apply_patch::tests::'].map(filter =>
      ['test', '-p', 'codex-core', '--lib', filter, '--locked', '--offline', '--', '--test-threads=1']),
  ]);
  assert.ok(result.cargoPreparations.every(x => x.isolateHostEnvironment === true));
  assert.equal(recipesForCheck(config, check('check-deletion-approval-native', ['unknown'])).gaps.length, 1);
});

test('MCP startup recipes retain both integration and library checks', () => {
  const result = recipesForCheck(config, check('check-mcp-lazy-startup'));
  assert.deepEqual(result.gaps, []);
  const integration = result.cargoPreparations.find(x => x.args.includes('codex-core'));
  assert.ok(integration.args.includes('--features') && integration.args.includes('integration-tests'));
  assert.ok(integration.args.includes('--test') && integration.args.includes('all'));
  assert.ok(result.cargoPreparations.some(x => x.args.includes('codex-mcp') && x.args.includes('--lib')));
  assert.equal(recipesForCheck(config, check('check-mcp-lazy-startup', ['unknown'])).gaps.length, 1);
});

test('selected upstream recipes match every actual host suite and preserve runtime binding', () => {
  const { suites } = require('./check-selected-upstream-native.cjs');
  for (const [scope, commands] of Object.entries(suites)) {
    const needsHost = ['core-integration', 'code-mode-trace'].includes(scope);
    const tail = [scope, ...(needsHost ? ['{engineDirectory}'] : [])];
    const result = recipesForCheck(config, check('check-selected-upstream-native', tail));
    assert.deepEqual(result.gaps, [], scope);
    assert.deepEqual(result.cargoPreparations.map(x => x.args), commands.map(([crate, target, ...selection]) =>
      ['test', '-p', crate, target, ...selection.filter(Boolean),
        ...(['codex-core', 'codex-app-server'].includes(crate) && target === '--test' ? ['--features', 'integration-tests'] : []),
        '--locked', '--offline', '--', '--test-threads=1']), scope);
    assert.ok(result.cargoPreparations.every(x => x.isolateHostEnvironment));
    if (needsHost) assert.ok(result.cargoPreparations.every(x => x.envRecipe === 'code-mode-host'));
  }
  for (const tail of [['unknown'], ['network', 'extra'], ['core-integration'], ['core-integration', '/different/runtime'], ['code-mode-trace'], ['code-mode-trace', '/different/runtime']]) {
    assert.equal(recipesForCheck(config, check('check-selected-upstream-native', tail)).gaps.length, 1);
  }
});

// Future wrapper argv/root changes must update this recipe alongside the hash.
test('task-memory preparation binds its derived engine and rejects unsupported arguments', () => {
  const bound = { ...config, engineSourceRoot: path.join(projectRoot, 'engine') };
  const selected = tail => ({ id: 'tool.task-memory.native', executable: 'node',
    args: ['scripts/check-task-memory.cjs', ...tail], level: 'native', cargoPreflight: 'selected-tests-v2' });
  const storage = ['test', '-p', 'azrael-task-memory', '--lib', '--locked', '--offline', '--', '--test-threads=1'];
  const core = ['test', '-p', 'codex-core', '--lib', '--locked', '--offline', 'task_memory', '--', '--test-threads=1'];
  for (const [tail, expected] of [[[], [storage, core]], [['all'], [storage, core]], [['storage'], [storage]], [['core'], [core]]]) {
    const result = recipesForCheck(bound, selected(tail));
    assert.deepEqual(result.gaps, []);
    assert.deepEqual(result.cargoPreparations.map(recipe => recipe.args), expected);
    assert.ok(result.cargoPreparations.every(recipe => recipe.isolateHostEnvironment));
  }
  assert.equal(recipesForCheck(config, selected([])).gaps.length, 1);
  for (const source of [path.join(projectRoot, 'engine-other'), 'engine', path.join(projectRoot, 'engine', 'nested')]) {
    assert.equal(recipesForCheck({ ...bound, engineSourceRoot: source }, selected([])).gaps.length, 1);
  }
  for (const tail of [['unknown'], ['all', 'extra'], ['storage', 'core'], ['{engineSourceRoot}'], [bound.engineSourceRoot]]) {
    assert.equal(recipesForCheck(bound, selected(tail)).gaps.length, 1);
  }
});

test('every registered selected-tests-v2 check has a reviewed recipe and valid shared type-check transformation', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'scripts/azrael-feature-contracts.json'), 'utf8'));
  const selected = manifest.features.flatMap(x => x.checks).filter(x => x.cargoPreflight === 'selected-tests-v2');
  assert.ok(selected.length > 0, 'registered Cargo checks must exercise the current recipe contract');
  for (const value of selected) {
    const result = recipesForCheck(['scripts/check-task-memory.cjs', 'scripts/check-agent-image-attachments.cjs', 'scripts/check-find-names.cjs'].includes(value.args[0])
      ? { ...config, engineSourceRoot: path.join(projectRoot, 'engine') } : config, value);
    assert.deepEqual(result.gaps, [], value.id);
    for (const recipe of result.cargoPreparations) {
      assert.equal(recipe.args[0], 'test');
      const command = preflightCommands({ args: recipe.args }).typeCheck.args;
      assert.equal(command[0], 'check');
      assert.ok(command.includes('--locked'));
      assert.ok(command.includes('--offline'));
      assert.ok(command.includes('--profile'));
    }
  }

});

test('shared-engine preparation keeps selected launch wiring without broad native suites', () => {
  const result = recipesForCheck(config, check('check-shared-engine-native', ['appserver']));
  assert.deepEqual(result.gaps, []);
  assert.ok(result.cargoPreparations.every(x => !x.args.includes('--no-run') && !x.args.includes('--message-format=json')));
  assert.deepEqual(result.cargoPreparations.map(x => x.args.find(arg => arg.includes('::')) || x.args.find(arg => arg === 'azrael_entry_resolves_its_own_code_mode_host')), [
    'azrael_storage::tests::',
    'registration::tests::',
    'backend::pid::tests::update_loop_uses_hidden_app_server_subcommand',
    'backend::pid::tests::app_server_remote_control_uses_runtime_flag',
    'backend::pid::tests::app_server_disabled_remote_control_uses_compatible_args_and_runtime_env',
    'azrael_entry_resolves_its_own_code_mode_host',
    'entry::tests::azrael_proxy_preserves_global_startup_options_and_rejects_listener_changes',
  ]);
});

test('session handoff preparation keeps routing and forwarded limits without core libtests', () => {
  const result = recipesForCheck(config, check('check-shared-engine-native', ['handoff']));
  assert.deepEqual(result.gaps, []);
  assert.ok(result.cargoPreparations.every(x => !x.args.includes('codex-core')));
  assert.deepEqual(result.cargoPreparations.map(x => x.args.find(arg => arg.includes('::'))), [
    'session_handoff::tests::real_websocket_sessions_callbacks_busy_release_and_no_turn_replay',
    'session_handoff::tests::read_only_preview_reads_source_then_reauthenticates_before_resume',
    'azrael_session_handoff::tests::target_resume_preserves_source_computer_use_ceiling_including_absence',
    'azrael_session_handoff::tests::scoped_source_resume_keeps_presentation_and_strips_all_runtime_overrides',
    'azrael_session_handoff::tests::nonapproval_callback_has_exact_thread_ownership_until_canceled',
    'azrael_session_handoff::tests::scope_does_not_grant_account_or_other_session_authority',
  ]);
  assert.ok(result.cargoPreparations.every(x => x.args.includes('--lib') && x.args.includes('--locked') && x.args.includes('--offline')));
});

test('registered image, find-names and Devin recipes preserve scopes and ignored test gates', () => {
  const bound = { ...config, engineSourceRoot: path.join(projectRoot, 'engine') };
  const derived = (name, tail = []) => ({ ...check(name), args: ['scripts/' + name + '.cjs', ...tail] });
  const image = recipesForCheck(bound, derived('check-agent-image-attachments'));
  assert.deepEqual(image.gaps, []);
  assert.deepEqual(image.cargoPreparations.map(r => [r.args[2], r.args[6]]), [['codex-protocol','inter_agent'],['codex-thread-store','image_snapshot'],['codex-core','image_attachments'],['codex-core','agent_image_label'],['codex-core','tool_message_transport'],['codex-core','devin_recipient_requires_plaintext']]);
  const names = recipesForCheck(bound, derived('check-find-names')).cargoPreparations;
  assert.deepEqual(names.map(r => r.args[6]), ['find_names','reviewer_tool_policy','api_tool_free_model_closes_catalog_and_native_dispatch_registry','find_names_with_packaged_helper','find_names_missing_runtime']);
  assert.deepEqual(names.map(r => r.args.includes('--ignored')), [false,false,false,true,true]);
  const devin = recipesForCheck(config, check('check-devin-compaction')).cargoPreparations;
  assert.deepEqual(devin.map(r => r.args[6]), ['devin::catalog::','compact::tests','auto_compaction','reconstruct_history_','compaction_persists_resume_metadata_and_companion_records','native_devin_compaction_commits_only_completed_nonempty_summary']);
  assert.deepEqual(devin.map(r => r.args.includes('--ignored')), [false,false,false,false,false,true]);
  for (const name of ['check-agent-image-attachments','check-find-names']) {
    assert.equal(recipesForCheck(config, derived(name)).gaps.length, 1);
    assert.equal(recipesForCheck(bound, derived(name, ['unknown'])).gaps.length, 1);
  }
  assert.equal(recipesForCheck(config, check('check-devin-compaction', ['unknown'])).gaps.length, 1);
});

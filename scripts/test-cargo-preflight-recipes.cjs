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
  return { id, executable: 'node', args: [`scripts/${wrapper}.cjs`, '{engineSourceRoot}', ...tail], level: 'native', cargoPreflight: 'selected-tests-v1' };
}
const oauth = stage => check('check-mcp-oauth-store', ['--stage', stage], `oauth-${stage}`);
const capacity = check('check-capacity-recovery');

test('usage window recipe preserves account processor selection and host isolation', () => {
  const result = recipesForCheck(config, check('check-usage-window'));
  assert.deepEqual(result.gaps, []);
  assert.deepEqual(result.cargoPreparations.map(recipe => recipe.args), [
    ['test', '-p', 'codex-app-server', '--lib', 'account_processor', '--locked', '--offline', '--', '--test-threads=1'],
  ]);
  assert.equal(result.cargoPreparations[0].isolateHostEnvironment, true);
  assert.equal(recipesForCheck(config, check('check-usage-window', ['extra'])).gaps.length, 1);
});

test('TPS core recipe preserves timing and fork isolation checks', () => {
  const result = recipesForCheck(config, check('check-response-tps-native', ['core']));
  assert.deepEqual(result.gaps, []);
  assert.deepEqual(result.cargoPreparations.map(recipe => recipe.args),
    ['turn_timing::tests', 'session::tests::response_performance'].map(filter =>
      ['test', '-p', 'codex-core', '--lib', filter, '--locked', '--offline', '--', '--test-threads=1']));
});

test('session restoration recipe preserves all recovery filters and preflight gates', () => {
  const result = recipesForCheck(config, check('check-task-recovery-native'));
  assert.deepEqual(result.gaps, []);
  const filters = [
    'session_restore_', 'host_approval', 'async_question', 'session::accepted_user_inputs::tests',
    'context_manager::history::tests::normalize_',
    'context_manager::history::tests::for_prompt_recovers_interrupted_tools_with_stable_ids_and_preserves_raw_history',
    'tasks::panic_tests::', 'tasks::tests::',
  ];
  assert.deepEqual(result.cargoPreparations.map(recipe => recipe.args), filters.map(filter =>
    ['test', '-p', 'codex-core', '--lib', filter, '--locked', '--offline', '--', '--test-threads=1']));
  for (const recipe of result.cargoPreparations) {
    assert.equal(recipe.isolateHostEnvironment, true);
    const gates = preflightCommands({ args: recipe.args });
    assert.ok(gates.typeCheck.args.includes('--tests'));
    assert.ok(gates.selection.args.includes('--list'));
    assert.ok(gates.selection.args.includes('--format=terse'));
  }
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
  assert.equal(context.length, 4);
  assert.deepEqual(context.at(-1).args, ['test', '-p', 'codex-core', '--test', 'all', '--features', 'codex-core/integration-tests', 'suite::model_switching', '--locked', '--offline', '--', '--test-threads=1']);
  assert.equal(context.at(-1).isolateHostEnvironment, false);
  assert.deepEqual(recipesForCheck(config, check('check-project-maintenance', ['--stage', 'library'])).cargoPreparations[0].args,
    ['test', '-p', 'azrael-project-maintenance', '--locked', '--offline', '--', '--test-threads=1']);
  const parent = recipesForCheck(config, check('check-parent-requests')).cargoPreparations[0];
  assert.deepEqual(parent.args.slice(-5), ['--', '--test-threads=1', '--nocapture', 'parent_request', 'parent_response_wait']);
  assert.equal(parent.args.filter(x => x === '-p').length, 5);
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
  assert.equal(all.cargoPreparations.length, 8);
  assert.ok(all.cargoPreparations.every(x => x.envRecipe === 'sdk-python-path'));
  const rpc = all.cargoPreparations.find(x => x.args.includes('host_approval_rpc'));
  assert.deepEqual(rpc.args.slice(0, 9), ['test', '-p', 'codex-app-server', '--features', 'integration-tests', '--test', 'all', 'host_approval_rpc', '--locked']);
});

test('deletion approval preparation preserves the four reviewed native command selections', () => {
  const result = recipesForCheck(config, check('check-deletion-approval-native'));
  assert.deepEqual(result.gaps, []);
  assert.deepEqual(result.cargoPreparations.map(x => x.args), [
    ['test', '-p', 'codex-shell-command', '--lib', 'command_safety::', '--locked', '--offline', '--', '--test-threads=1'],
    ...['exec_policy::tests::', 'deletion_approval_', 'apply_patch::tests::'].map(filter =>
      ['test', '-p', 'codex-core', '--lib', filter, '--locked', '--offline', '--', '--test-threads=1']),
  ]);
  assert.ok(result.cargoPreparations.every(x => x.isolateHostEnvironment === true));
  assert.equal(recipesForCheck(config, check('check-deletion-approval-native', ['unknown'])).gaps.length, 1);
});

test('MCP startup recipes retain both integration and library checks', () => {
  const result = recipesForCheck(config, check('check-mcp-lazy-startup'));
  assert.deepEqual(result.gaps, []);
  assert.deepEqual(result.cargoPreparations.map(x => x.args), [
    ['test', '-p', 'codex-core', '--features', 'integration-tests', '--test', 'all', 'suite::mcp_tool_cache::', '--locked', '--offline', '--', '--test-threads=1'],
    ['test', '-p', 'codex-mcp', '--lib', '--locked', '--offline', '--', '--test-threads=1'],
  ]);
  assert.equal(recipesForCheck(config, check('check-mcp-lazy-startup', ['unknown'])).gaps.length, 1);
});

test('selected upstream recipes match every actual host suite and preserve runtime binding', () => {
  const { suites } = require('./check-selected-upstream-native.cjs');
  for (const [scope, commands] of Object.entries(suites)) {
    const tail = [scope, ...(scope === 'core-integration' ? ['{engineDirectory}'] : [])];
    const result = recipesForCheck(config, check('check-selected-upstream-native', tail));
    assert.deepEqual(result.gaps, [], scope);
    assert.deepEqual(result.cargoPreparations.map(x => x.args), commands.map(([crate, target, ...selection]) =>
      ['test', '-p', crate, target, ...selection.filter(Boolean),
        ...(['codex-core', 'codex-app-server'].includes(crate) && target === '--test' ? ['--features', 'integration-tests'] : []),
        '--locked', '--offline', '--', '--test-threads=1']), scope);
    assert.ok(result.cargoPreparations.every(x => x.isolateHostEnvironment));
    if (scope === 'core-integration') assert.ok(result.cargoPreparations.every(x => x.envRecipe === 'code-mode-host'));
  }
  for (const tail of [['unknown'], ['network', 'extra'], ['core-integration'], ['core-integration', '/different/runtime']]) {
    assert.equal(recipesForCheck(config, check('check-selected-upstream-native', tail)).gaps.length, 1);
  }
});

test('every registered selected-tests-v1 check has a reviewed recipe and valid shared type-check transformation', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'scripts/azrael-feature-contracts.json'), 'utf8'));
  const selected = manifest.features.flatMap(x => x.checks).filter(x => x.cargoPreflight === 'selected-tests-v1');
  for (const value of selected) {
    const result = recipesForCheck(config, value);
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

test('shared-engine native preparation follows the current host platform branch', () => {
  const result = recipesForCheck(config, check('check-shared-engine-native', ['appserver']));
  assert.deepEqual(result.gaps, []);
  const pty = result.cargoPreparations.filter(x => x.args.includes('codex-utils-pty'));
  assert.equal(pty.length, process.platform === 'win32' ? 3 : 0);
  assert.ok(result.cargoPreparations.every(x => !x.args.includes('--no-run') && !x.args.includes('--message-format=json')));
});

test('session handoff preparation covers proxy, core admission and server ownership', () => {
  const result = recipesForCheck(config, check('check-shared-engine-native', ['handoff']));
  assert.deepEqual(result.gaps, []);
  assert.deepEqual(result.cargoPreparations.map(x => x.args[x.args.indexOf('-p') + 1]),
    ['codex-app-server-daemon', 'codex-core', 'codex-app-server', 'codex-app-server', 'codex-app-server']);
  assert.ok(result.cargoPreparations.every(x => x.args.includes('--lib') && x.args.includes('--locked') && x.args.includes('--offline')));
});

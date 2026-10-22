'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, mock } = require('node:test');
const { plan, recipesForCheck, literalPackageName } = require('./cargo-preflight-recipes.cjs');
const { preflightCommands } = require('./cargo-verification.cjs');
const projectRoot = path.resolve(__dirname, '..');
// Filesystem fixtures are virtual: no Cargo process or temporary tree is needed.
const engineSourceRoot = path.join(projectRoot, 'artifacts', 'virtual-recipe-source');
const config = { projectRoot, engineSourceRoot };
function check(wrapper, tail = [], id = wrapper) {
  return { id, executable: 'node', args: [`scripts/${wrapper}.cjs`, '{engineSourceRoot}', ...tail], level: 'native', cargoPreflight: 'selected-tests-v1' };
}
const feature = (checks, owners = []) => ({ id: 'fixture', owners, checks });
function fixtures(files) {
  const read = fs.readFileSync;
  const exists = fs.existsSync;
  const map = new Map(Object.entries(files).map(([name, contents]) => [path.resolve(engineSourceRoot, name), contents]));
  mock.method(fs, 'readFileSync', (filename, ...args) => map.has(path.resolve(filename)) ? map.get(path.resolve(filename)) : read(filename, ...args));
  mock.method(fs, 'existsSync', filename => map.has(path.resolve(filename)) || exists(filename));
}
const oauth = stage => check('check-mcp-oauth-store', ['--stage', stage], `oauth-${stage}`);
const capacity = check('check-capacity-recovery');

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
  const result = plan(config, [feature([oauth('default'), oauth('preserve-order')])]);
  assert.deepEqual(result.gaps, []);
  assert.deepEqual(result.cargoPreparations.map(x => x.args), [
    ['test', '-p', 'codex-rmcp-client', '--lib', 'oauth::', '--locked', '--offline', '--', '--test-threads=1'],
    ['test', '-p', 'codex-rmcp-client', '--lib', 'oauth::', '--locked', '--offline', '--features', 'serde_json/preserve_order', '--', '--test-threads=1'],
  ]);
  assert.ok(result.cargoPreparations.every(x => x.isolateHostEnvironment === true));
});

test('bridge, integration, package-wide library and parent-request arguments stay intact', () => {
  const bridge = recipesForCheck(config, check('check-shared-engine-native', ['bridge'])).cargoPreparations[0];
  assert.deepEqual(bridge.args, ['test', '-p', 'codex-app-server-client', '--no-default-features', '--lib', '--bin', 'azrael-bridge', 'remote::tests::', '--locked', '--offline', '--', '--test-threads=1']);
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

test('dedup removes only identical preparation semantics and retains every owning check ID', () => {
  const result = plan(config, [feature([capacity, check('check-task-recovery-native'), check('check-api-context', ['core']), check('check-model-harness-profiles', ['context'])])]);
  const isolated = result.cargoPreparations.filter(x => x.isolateHostEnvironment);
  assert.equal(isolated.length, 1);
  assert.deepEqual(isolated[0].checkIds, ['check-capacity-recovery', 'check-task-recovery-native']);
  const nonisolatedLib = result.cargoPreparations.filter(x => !x.isolateHostEnvironment && x.args.includes('--lib'));
  assert.equal(nonisolatedLib.length, 1);
  assert.deepEqual(nonisolatedLib[0].checkIds, ['check-api-context', 'check-model-harness-profiles']);
  assert.equal(result.cargoPreparations.filter(x => x.args.includes('codex-core/integration-tests')).length, 1);
});

test('closest actual manifest name schedules its owning crate and defers dependency consumers', () => {
  fixtures({ 'codex-rs/Cargo.toml': '[workspace]\nmembers=[]',
    'codex-rs/unexpected-directory/Cargo.toml': '[package]\nname = "codex-rmcp-client"\n',
    'codex-rs/unexpected-directory/nested/Cargo.toml': '[package]\nname="codex-core"\n' });
  try {
    const features = [feature([capacity]), feature([oauth('default')], ['engine/codex-rs/unexpected-directory/src/oauth.rs'])];
    const result = plan(config, features, { changedPaths: ['engine/codex-rs/unexpected-directory/src/oauth.rs'] });
    assert.deepEqual(result.changedPackages, ['codex-rmcp-client']);
    assert.deepEqual(result.cargoPreparations.map(x => x.checkId), ['oauth-default']);
    assert.deepEqual(result.deferredPreparations.map(x => x.checkId), ['check-capacity-recovery']);
    assert.equal(result.selection, 'affected-selected-native');
    const nested = plan(config, features, { changedPaths: [path.join(engineSourceRoot, 'codex-rs/unexpected-directory/nested/src/lib.rs')] });
    assert.deepEqual(nested.changedPackages, ['codex-core']);
    assert.equal(nested.cargoPreparations[0].checkId, 'check-capacity-recovery');
    assert.deepEqual(nested.deferredPreparations.map(x => x.checkId), ['oauth-default']);
  } finally { mock.restoreAll(); }
});

test('mapped OAuth and skills test changes split exact deduplicated recipes and conserve all check owners', () => {
  fixtures({
    'codex-rs/rmcp-client/Cargo.toml': '[package]\nname="codex-rmcp-client"',
    'codex-rs/skills/Cargo.toml': '[package]\nname="codex-skills-extension"',
  });
  try {
    const features = [feature([capacity, check('check-task-recovery-native')]),
      feature([oauth('default'), oauth('preserve-order')]),
      feature([check('check-task-profile-skills')], ['engine/codex-rs/skills/src/tests.rs']),
      feature([check('check-window-approval-native', ['queue'])])];
    const full = plan(config, features);
    const result = plan(config, features, { changedPaths: [
      'engine/codex-rs/rmcp-client/src/oauth.rs', 'engine/codex-rs/skills/src/tests.rs', 'docs/readme.md',
    ] });
    assert.deepEqual(result.gaps, []);
    assert.equal(result.selection, 'affected-selected-native');
    assert.deepEqual(result.changedPackages, ['codex-rmcp-client', 'codex-skills-extension']);
    assert.equal(result.cargoPreparations.length, 4);
    assert.equal(result.deferredPreparations.length, 2);
    assert.ok(result.cargoPreparations.every(recipe => recipe.checkIds.every(id =>
      ['oauth-default', 'oauth-preserve-order', 'check-task-profile-skills'].includes(id))));
    assert.ok(result.cargoPreparations.some(recipe => recipe.args.includes('codex-config')),
      'a direct owner retains its other package recipe');
    assert.deepEqual(result.deferredPreparations.find(recipe => recipe.checkId === capacity.id).checkIds,
      [capacity.id, 'check-task-recovery-native']);
    assert.ok(result.deferredPreparations.some(recipe => recipe.envRecipe === 'sdk-python-path'));
    assert.ok(result.deferredPreparations.every(recipe => recipe.reason ===
      'prepared by selected native consumer if reusable evidence misses'));
    const semantics = recipe => JSON.stringify({ ...recipe, reason: undefined });
    const combined = [...result.cargoPreparations, ...result.deferredPreparations];
    assert.deepEqual(combined.map(semantics).sort(), full.cargoPreparations.map(semantics).sort());
    assert.deepEqual(new Set(combined.flatMap(recipe => recipe.checkIds)),
      new Set(features.flatMap(entry => entry.checks.map(check => check.id))));
  } finally { mock.restoreAll(); }
});

test('one unknown, unmatched, shared or build input keeps every selected preparation early', () => {
  fixtures({
    'codex-rs/rmcp-client/Cargo.toml': '[package]\nname="codex-rmcp-client"',
    'codex-rs/unselected/Cargo.toml': '[package]\nname="unselected"',
  });
  try {
    for (const changed of ['engine/codex-rs/unknown/src/lib.rs', 'engine/codex-rs/unselected/src/lib.rs',
      'engine/codex-rs/shared.rs', 'engine/other/src/lib.rs', 'external/src/lib.rs',
      'engine/codex-rs/rmcp-client/build.rs', 'engine/codex-rs/rmcp-client/Cargo.toml',
      'engine/codex-rs/Cargo.lock', 'engine/codex-rs/rust-toolchain', 'engine/rust-toolchain.toml',
      'engine/.cargo/config.toml', 'engine/codex-rs/.cargo/config', 'engine/codex-rs/dependencies.toml']) {
      const result = plan(config, [feature([capacity, oauth('default')])], { changedPaths: [
        'engine/codex-rs/rmcp-client/src/oauth.rs', changed,
      ] });
      assert.equal(result.selection, 'conservative-selected-native', changed);
      assert.equal(result.cargoPreparations.length, 2, changed);
      assert.deepEqual(result.deferredPreparations, [], changed);
    }
  } finally { mock.restoreAll(); }
});

test('mapped changes still validate all selected consumers before narrowing preparation', () => {
  fixtures({ 'codex-rs/rmcp-client/Cargo.toml': '[package]\nname="codex-rmcp-client"' });
  try {
    const result = plan(config, [feature([oauth('default'), capacity, check('check-new-wrapper')])], {
      changedPaths: ['engine/codex-rs/rmcp-client/src/oauth.rs'],
    });
    assert.equal(result.selection, 'conservative-selected-native');
    assert.equal(result.cargoPreparations.length, 2);
    assert.deepEqual(result.deferredPreparations, []);
    assert.deepEqual(result.gaps, [{ checkId: 'check-new-wrapper', reason: 'no reviewed Cargo recipe for wrapper' }]);
  } finally { mock.restoreAll(); }
});

test('manifest owners select priority when a crate declaration cannot be resolved', () => {
  const owned = oauth('default');
  const result = plan(config, [feature([capacity]), feature([owned], ['engine/codex-rs/rmcp-client/Cargo.toml'])], { changedPaths: ['engine/codex-rs/rmcp-client/Cargo.toml'] });
  assert.equal(result.cargoPreparations[0].checkId, owned.id);
  assert.equal(result.cargoPreparations.length, 2);
});

test('production, test paths, build scripts, locks and unknown native scopes remain conservative', () => {
  for (const changed of ['engine/codex-rs/core/src/lib.rs', 'engine/codex-rs/core/tests/suite.rs', 'engine/codex-rs/core/build.rs',
    'engine/codex-rs/Cargo.lock', 'engine/codex-rs/.cargo/config.toml', 'engine/.cargo/config', 'native/other/src/lib.rs']) {
    const result = plan(config, [feature([capacity, oauth('default')])], { changedPaths: [changed] });
    assert.equal(result.cargoPreparations.length, 2, changed);
    assert.equal(result.selection, 'conservative-selected-native');
  }
});

test('docs and scripts do not schedule all native preparations; native checks without Cargo metadata are skipped', () => {
  const sdk = { id: 'sdk', executable: 'node', args: ['scripts/sdk.cjs', '{engineSourceRoot}'], level: 'native' };
  const result = plan(config, [feature([capacity, sdk])], { changedPaths: ['docs/architecture/build.md', 'scripts/helper.cjs'] });
  assert.deepEqual(result.cargoPreparations, []);
  assert.deepEqual(result.gaps, []);
  assert.deepEqual(result.skipped.map(x => x.reason), ['not a declared Cargo test preparation consumer', 'changed paths do not affect native source']);
  const full = plan(config, [feature([capacity, sdk])]);
  assert.equal(full.cargoPreparations.length, 1);
  assert.equal(full.skipped[0].checkId, 'sdk');
  assert.deepEqual(full.gaps, []);
});

test('unsupported wrappers, declarations, root selections and scopes explicitly report gaps', () => {
  for (const value of [check('check-new-wrapper'), check('check-api-context', ['not-a-scope']),
    check('check-api-context', ['__proto__']), check('check-project-maintenance', ['--stage', '__proto__']),
    { ...capacity, cargoPreflight: 'unknown-v2' }, { ...capacity, args: [capacity.args[0], '/different/source'] },
    { ...capacity, args: ['scripts/../check-capacity-recovery.cjs', '{engineSourceRoot}'] }]) {
    const result = plan(config, [feature([value])]);
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
    assert.match(plan(config, [feature([capacity])]).gaps[0].reason, /source changed/);
    assert.equal(executed, false);
  } finally { mock.restoreAll(); delete global.__cargoRecipeDiscovery; }
  mock.method(fs, 'readFileSync', (filename, ...args) => {
    if (String(filename).endsWith('check-capacity-recovery.cjs')) throw Object.assign(Error('missing'), { code: 'ENOENT' });
    return original(filename, ...args);
  });
  try { assert.match(plan(config, [feature([capacity])]).gaps[0].reason, /cannot read wrapper: ENOENT/); }
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

test('literal package declarations fall back conservatively for ambiguous or unsupported TOML syntax', () => {
  assert.equal(literalPackageName('[package]\nname="codex-core" # comment\n[dependencies]\nname="other"'), 'codex-core');
  assert.equal(literalPackageName("[package]\nname='codex-core'"), 'codex-core');
  for (const value of ['[workspace]\nmembers=[]', '[package]\nname.workspace=true', '[package]\nname="first"\nname="second"',
    '[package]\nname="first"\n[package]\nname="first"', '["package"]\nname="quoted"', '[package]\nname="""multiline"""']) assert.equal(literalPackageName(value), undefined);
  fixtures({ 'codex-rs/core/Cargo.toml': '[package]\nname.workspace = true' });
  try {
    const result = plan(config, [feature([capacity, oauth('default')])], { changedPaths: ['engine/codex-rs/core/src/lib.rs'] });
    assert.deepEqual(result.changedPackages, []);
    assert.equal(result.cargoPreparations.length, 2);
  } finally { mock.restoreAll(); }
});

test('window approval preserves SDK environment only on all/queue scope and dedups separately', () => {
  const all = recipesForCheck(config, check('check-window-approval-native', ['all']));
  assert.deepEqual(all.gaps, []);
  assert.equal(all.cargoPreparations.length, 8);
  assert.ok(all.cargoPreparations.every(x => x.envRecipe === 'sdk-python-path'));
  const ledger = check('check-window-approval-native', ['ledger'], 'ledger');
  const combined = plan(config, [feature([capacity, check('check-window-approval-native', ['all']), ledger])]);
  assert.ok(combined.cargoPreparations.some(x => x.envRecipe === 'sdk-python-path' && x.args.includes('host_approval')));
  assert.ok(combined.cargoPreparations.find(x => x.checkIds.includes('ledger') && !x.envRecipe));
  const rpc = all.cargoPreparations.find(x => x.args.includes('host_approval_rpc'));
  assert.deepEqual(rpc.args.slice(0, 9), ['test', '-p', 'codex-app-server', '--features', 'integration-tests', '--test', 'all', 'host_approval_rpc', '--locked']);
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
  const report = plan(config, manifest.features);
  assert.deepEqual(report.gaps, []);
  assert.deepEqual(new Set(report.cargoPreparations.flatMap(x => x.checkIds)), new Set(selected.map(x => x.id)));
});

test('shared-engine native preparation follows the current host platform branch', () => {
  const result = recipesForCheck(config, check('check-shared-engine-native', ['appserver']));
  assert.deepEqual(result.gaps, []);
  const pty = result.cargoPreparations.filter(x => x.args.includes('codex-utils-pty'));
  assert.equal(pty.length, process.platform === 'win32' ? 3 : 0);
  assert.ok(result.cargoPreparations.every(x => !x.args.includes('--no-run') && !x.args.includes('--message-format=json')));
});

test('invalid root and changed-path contracts fail before command planning', () => {
  assert.throws(() => plan({ ...config, engineSourceRoot: 'relative' }, []), /absolute/);
  assert.throws(() => plan(config, [], { changedPaths: [null] }), /changedPaths/);
});

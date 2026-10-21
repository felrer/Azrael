'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const gate = require('./feature-preservation.cjs');
const root = path.resolve(process.env.AZRAEL_PIPELINE_PRESERVATION_TEST_ROOT || path.join(__dirname, '../artifacts/verification/pipeline-preservation-tests'));
fs.mkdirSync(root, { recursive: true });
const owned = [];
after(() => { for (const item of owned) { assert.equal(path.dirname(item), root); fs.rmSync(item, { recursive: true }); } });
function fixture() {
  const projectRoot = fs.mkdtempSync(path.join(root, 'case-')); owned.push(projectRoot);
  fs.mkdirSync(path.join(projectRoot, 'scripts')); fs.mkdirSync(path.join(projectRoot, 'docs'));
  for (const file of ['scripts/source.cjs', 'scripts/native.cjs', 'scripts/owner.cjs', 'docs/contract.md']) fs.writeFileSync(path.join(projectRoot, file), 'fixture');
  const feature = { id: 'engine.fixture', area: 'engine', owners: ['scripts/owner.cjs'], contract: 'docs/contract.md', reportFields: [], checks: [
    { id: 'engine.fixture.source', executable: 'node', args: ['scripts/source.cjs'], level: 'source' },
    { id: 'engine.fixture.native', executable: 'node', args: ['scripts/native.cjs'], level: 'native' },
  ] };
  const calls = []; const state = { revision: 1, fail: undefined };
  const config = { projectRoot, outputDirectory: path.join(projectRoot, 'logs'), area: 'engine', manifest: { schema: 1, features: [feature] }, transformRules: {},
    identityProvider: async config => ({ project: state.revision, ...(config.checkPhase === 'source' ? {} : { engine: 'binary' }) }),
    execute: async (_executable, args, options) => { calls.push(args[0]); fs.writeFileSync(options.logPath, 'evidence'); fs.writeFileSync(options.errorPath, ''); return { exitCode: args[0] === state.fail ? 1 : 0 }; } };
  return { config, calls, state };
}
test('source failure blocks native checks and persists completion and skipped evidence', async () => {
  const { config, calls, state } = fixture(); state.fail = 'scripts/source.cjs';
  const r = await gate.runPreservation(config);
  assert.equal(r.status, 'failed'); assert.deepEqual(calls, ['scripts/source.cjs']);
  assert.equal(r.skipped[0].checkId, 'engine.fixture.native'); assert(r.startedUtc && r.completedUtc);
  assert.equal(r.checks[0].exitCode, 1); assert(r.checks[0].startedUtc && r.checks[0].completedUtc);
});
test('source receipt hands passing checks to the complete run without a duplicate invocation', async () => {
  const { config, calls } = fixture();
  const first = await gate.runPreservation({ ...config, checkPhase: 'source' });
  assert.equal(first.status, 'passed'); assert.equal(first.checks.length, 1);
  const r = await gate.runPreservation({ ...config, sourceReceiptPath: first.receiptPath });
  assert.equal(r.status, 'passed', r.error); assert.equal(r.checks.length, 2);
  assert.deepEqual(calls, ['scripts/source.cjs', 'scripts/native.cjs']);
  assert.equal(r.checks[0].executionStatus, 'reused');
  assert.equal((await gate.verifyReceipt({ ...config, receiptPath: r.receiptPath })).status, 'passed');
});
test('source-only receipt cannot pass complete engine acceptance', async () => {
  const { config } = fixture(); const r = await gate.runPreservation({ ...config, checkPhase: 'source' });
  await assert.rejects(gate.verifyReceipt({ ...config, receiptPath: r.receiptPath }), /phase differs/);
});
test('changed source identity and changed evidence prevent preflight handoff', async () => {
  for (const changed of ['source', 'log']) {
    const { config, state, calls } = fixture(); const r = await gate.runPreservation({ ...config, checkPhase: 'source' });
    if (changed === 'source') state.revision++; else fs.appendFileSync(r.checks[0].logPath, 'tampered');
    const result = await gate.runPreservation({ ...config, sourceReceiptPath: r.receiptPath });
    assert.equal(result.status, 'failed'); assert.equal(calls.length, 1);
  }
});
test('native failure leaves the source pass reusable for same-input retry', async () => {
  const { config, state, calls } = fixture(); const source = await gate.runPreservation({ ...config, checkPhase: 'source' });
  state.fail = 'scripts/native.cjs';
  assert.equal((await gate.runPreservation({ ...config, sourceReceiptPath: source.receiptPath })).status, 'failed');
  state.fail = undefined;
  assert.equal((await gate.runPreservation({ ...config, sourceReceiptPath: source.receiptPath })).status, 'passed');
  assert.equal(calls.filter(x => x === 'scripts/source.cjs').length, 1);
});
test('source preflight cannot hide mandatory native checks by receipt phase tampering', async () => {
  const { config } = fixture(); const r = await gate.runPreservation({ ...config, checkPhase: 'source' });
  const raw = JSON.parse(fs.readFileSync(r.receiptPath, 'utf8')); raw.checkPhase = 'all'; fs.writeFileSync(r.receiptPath, JSON.stringify(raw));
  await assert.rejects(gate.verifyReceipt({ ...config, receiptPath: r.receiptPath }), /mandatory checks missing/);
});

test('Cargo pass evidence survives an independent failure and honors explicit forced native reexecution', async () => {
  const cargo = require('./cargo-verification-cache.cjs'); const runtime = cargo.runtime;
  cargo.runtime = async () => ({ toolchain: 'fixture' });
  try {
    const { config, calls, state } = fixture();
    config.engineSourceRoot = path.join(config.projectRoot, 'engine'); fs.mkdirSync(config.engineSourceRoot);
    for (const name of ['feature-preservation.cjs', 'cargo-verification-cache.cjs', 'cargo-preflight-recipes.cjs', 'cargo-verification.cjs', 'artifact-lifecycle.cjs', 'cargo-target-owner.cjs', 'cargo-config-self-contained.py', 'verification-result-cache.cjs', 'directory-state.cjs', 'check-api-context.cjs']) fs.writeFileSync(path.join(config.projectRoot, 'scripts', name), 'stable helper');
    const checks = config.manifest.features[0].checks;
    checks.splice(1, 0, { id: 'engine.fixture.cargo', executable: 'node', args: ['scripts/check-api-context.cjs', '{engineSourceRoot}', 'skills'], level: 'native', cargoPreflight: 'selected-tests-v1' });
    state.fail = 'scripts/native.cjs'; const failed = await gate.runPreservation(config); assert.equal(failed.status, 'failed');
    assert.match(failed.error, /engine\.fixture\.native.*exit 1/);
    assert.equal(calls.filter(name => name === 'scripts/check-api-context.cjs').length, 1, failed.error);
    state.fail = undefined; const warm = await gate.runPreservation(config);
    assert.equal(warm.status, 'passed', warm.error); assert.equal(warm.cargoCache.reused, 1);
    assert.equal(calls.filter(name => name === 'scripts/check-api-context.cjs').length, 1);
    const forced = await gate.runPreservation({ ...config, reuseNativeChecks: false });
    assert.equal(forced.status, 'passed', forced.error); assert.equal(forced.cargoCache.reused, 0);
    assert.equal(calls.filter(name => name === 'scripts/check-api-context.cjs').length, 2);
  } finally { cargo.runtime = runtime; }
});

test('real Git/source identity validates preflight handoff and detects changed ignored runtime environment', async () => {
  const { config, calls } = fixture(); delete config.identityProvider;
  config.engineSourceRoot = path.join(config.projectRoot, 'engine-source'); fs.mkdirSync(config.engineSourceRoot);
  config.engineDirectory = path.join(config.projectRoot, 'artifacts/engine'); fs.mkdirSync(config.engineDirectory, { recursive: true });
  config.outputDirectory = path.join(config.projectRoot, 'artifacts/output');
  const spawn = require('node:child_process').spawnSync;
  for (const dir of [config.projectRoot, config.engineSourceRoot]) {
    assert.equal(spawn('git', ['init', '--quiet', dir], { windowsHide: true }).status, 0);
    fs.writeFileSync(path.join(dir, '.gitignore'), 'artifacts/\n'); fs.writeFileSync(path.join(dir, 'input.txt'), 'immutable');
  }
  for (const file of ['feature-preservation.cjs', 'directory-state.cjs', 'deployment-input-snapshot.cjs', 'engine-provenance.py']) fs.writeFileSync(path.join(config.projectRoot, 'scripts', file), 'stable identity');
  fs.writeFileSync(path.join(config.projectRoot, 'scripts/azrael-feature-contracts.json'), JSON.stringify(config.manifest));
  const execute = config.execute;
  config.execute = async (command, args, options) => {
    if (command !== 'python') return execute(command, args, options);
    fs.writeFileSync(options.logPath, '{}'); fs.writeFileSync(options.errorPath, ''); return { exitCode: 0, stdout: '{}' };
  };
  const first = await gate.runPreservation({ ...config, checkPhase: 'source' }); assert.equal(first.status, 'passed', first.error);
  const complete = await gate.runPreservation({ ...config, sourceReceiptPath: first.receiptPath }); assert.equal(complete.status, 'passed', complete.error);
  assert.deepEqual(calls, ['scripts/source.cjs', 'scripts/native.cjs']);
  const old = process.env.AU_PIPELINE_FIXTURE_ENV; process.env.AU_PIPELINE_FIXTURE_ENV = 'changed';
  try { const stale = await gate.runPreservation({ ...config, sourceReceiptPath: first.receiptPath }); assert.equal(stale.status, 'failed'); assert.match(stale.error, /stale/); }
  finally { if (old === undefined) delete process.env.AU_PIPELINE_FIXTURE_ENV; else process.env.AU_PIPELINE_FIXTURE_ENV = old; }
});

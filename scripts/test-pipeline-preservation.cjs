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
  assert.deepEqual(r.executionSummary.kinds.source, { executed: 0, reused: 1, miss: 0, forced: 0, preflightReused: 1 });
  assert.deepEqual(r.executionSummary.kinds.native, { executed: 1, reused: 0, miss: 0, forced: 0, preflightReused: 0 });
  assert.equal(r.nativeCache.executed, 0, 'uncacheable native checks do not count as native-cache executions');
  assert.equal(r.cache.executed, 1); assert.equal(r.cache.reused, 1);
  assert.equal(r.checks[0].originalEvidence.receiptPath, first.receiptPath);
  assert.equal(r.checks[0].originalEvidence.logPath, first.checks[0].logPath);
  assert.equal(r.checks[0].evidenceKind, 'source');
  assert.equal((await gate.verifyReceipt({ ...config, receiptPath: r.receiptPath })).status, 'passed');
});
test('source-only receipt cannot pass complete engine acceptance', async () => {
  const { config } = fixture(); const r = await gate.runPreservation({ ...config, checkPhase: 'source' });
  await assert.rejects(gate.verifyReceipt({ ...config, receiptPath: r.receiptPath }), /phase differs/);
});
test('native cache accounting distinguishes misses, reuse and forced runs from source checks', async t => {
  const native = require('./native-verification-cache.cjs'); const runtime = native.runtime;
  native.runtime = async () => ({ toolchain: 'fixture' });
  try {
    const { config, calls } = fixture();
    for (const name of ['feature-preservation.cjs', 'native-verification-cache.cjs', 'verification-result-cache.cjs', 'directory-state.cjs'])
      fs.writeFileSync(path.join(config.projectRoot, 'scripts', name), 'stable helper');
    const check = config.manifest.features[0].checks[1];
    check.args.push('{fixture}'); check.nativeCacheInputs = { schema: 1, files: ['scripts/native.cjs'] };
    let started = performance.now();
    const cold = await gate.runPreservation(config);
    const coldMs = performance.now() - started;
    assert.equal(cold.status, 'passed', cold.error);
    assert.deepEqual(cold.executionSummary.kinds.native, { executed: 1, reused: 0, miss: 1, forced: 0, preflightReused: 0 });
    started = performance.now();
    const warm = await gate.runPreservation(config);
    const warmMs = performance.now() - started;
    assert.equal(warm.status, 'passed', warm.error);
    assert.deepEqual(warm.executionSummary.kinds.native, { executed: 0, reused: 1, miss: 0, forced: 0, preflightReused: 0 });
    assert.equal(warm.nativeCache.reused, 1); assert.equal(warm.cache.executed, 1);
    const forced = await gate.runPreservation({ ...config, reuseNativeChecks: false });
    assert.equal(forced.status, 'passed', forced.error);
    assert.deepEqual(forced.executionSummary.kinds.native, { executed: 1, reused: 0, miss: 0, forced: 1, preflightReused: 0 });
    assert.equal(calls.filter(name => name === 'scripts/native.cjs').length, 2);
    assert.equal(calls.filter(name => name === 'scripts/source.cjs').length, 3);
    t.diagnostic(JSON.stringify({ fixturePerformance: { cold: { durationMs: coldMs, summary: cold.executionSummary }, warm: { durationMs: warmMs, summary: warm.executionSummary } } }));
  } finally { native.runtime = runtime; }
});
test('deployment metrics preserve independent full scope and reuse intent and receipt summaries', { skip: process.platform !== 'win32' }, async () => {
  const { config } = fixture(); const receipt = await gate.runPreservation(config);
  assert.equal(receipt.status, 'passed', receipt.error);
  const logRoot = path.join(config.projectRoot, 'deployment-logs');
  const stage = path.join(logRoot, 'engine-preservation', 'preservation-fixture'); fs.mkdirSync(stage, { recursive: true });
  fs.copyFileSync(receipt.receiptPath, path.join(stage, 'receipt.json'));
  const command = `
    $ErrorActionPreference = 'Stop'
    $parseTokens = $null; $parseErrors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($env:AZRAEL_METRICS_SCRIPT, [ref]$parseTokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw 'Deployment parse failure' }
    $assignment = $ast.Find({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$metrics'}, $true)
    $writer = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Write-DeploymentMetrics'}, $true)
    $logs = $env:AZRAEL_METRICS_LOG_ROOT; $project = $env:AZRAEL_METRICS_PROJECT
    $ReleaseName = 'fixture'; $VerifyOnly = $true; $release = $project; $package = $project; $fixture = $project; $EngineTargetDirectory = $null
    $timer = [Diagnostics.Stopwatch]::StartNew()
    foreach ($FullRegression in @($false, $true)) {
      foreach ($ForceNativeVerification in @($false, $true)) {
        $CargoVerificationCacheProjectRoot = Join-Path $project 'external-cache-owner'
        Invoke-Expression $assignment.Extent.Text
        Invoke-Expression $writer.Extent.Text
        Write-DeploymentMetrics
        Get-Content -LiteralPath (Join-Path $logs 'deployment-metrics.json') -Raw | ConvertFrom-Json | ConvertTo-Json -Depth 20 -Compress
      }
    }`;
  const result = require('node:child_process').spawnSync(process.env.AZRAEL_TEST_PWSH || 'pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true, encoding: 'utf8', env: { ...process.env, AZRAEL_METRICS_SCRIPT: path.join(__dirname, 'deploy-azrael.ps1'),
      AZRAEL_METRICS_LOG_ROOT: logRoot, AZRAEL_METRICS_PROJECT: config.projectRoot },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const results = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(results.length, 4);
  for (const [index, result] of results.entries()) {
    assert.equal(result.verificationPolicy.scope, index < 2 ? 'changed' : 'full');
    assert.equal(result.verificationPolicy.nativeReuse, index % 2 === 0);
    assert.equal(result.verificationPolicy.cargoVerificationCacheProjectRoot, path.join(config.projectRoot, 'external-cache-owner'));
    assert.deepEqual(result.verificationResults.enginePreservation.summary, receipt.executionSummary);
    assert.equal(result.verificationResults.enginePreservation.status, 'passed');
  }
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
    for (const name of ['feature-preservation.cjs', 'cargo-verification-cache.cjs', 'cargo-preflight-recipes.cjs', 'cargo-verification.cjs', 'artifact-lifecycle.cjs', 'artifact-observations.cjs', 'cargo-target-owner.cjs', 'cargo-shared-cache.cjs', 'cargo-test-preparation.cjs', 'cargo-config-self-contained.py', 'verification-result-cache.cjs', 'directory-state.cjs', 'check-api-context.cjs']) fs.writeFileSync(path.join(config.projectRoot, 'scripts', name), 'stable helper');
    const checks = config.manifest.features[0].checks;
    checks.splice(1, 0, { id: 'engine.fixture.cargo', executable: 'node', args: ['scripts/check-api-context.cjs', '{engineSourceRoot}', 'skills'], level: 'native', cargoPreflight: 'selected-tests-v1' });
    state.fail = 'scripts/native.cjs'; const failed = await gate.runPreservation(config); assert.equal(failed.status, 'failed');
    assert.match(failed.error, /engine\.fixture\.native.*exit 1/);
    assert.equal(calls.filter(name => name === 'scripts/check-api-context.cjs').length, 1, failed.error);
    state.fail = undefined; const warm = await gate.runPreservation(config);
    assert.equal(warm.status, 'passed', warm.error); assert.equal(warm.cargoCache.reused, 1);
    assert.deepEqual(warm.executionSummary.kinds.cargo, { executed: 0, reused: 1, miss: 0, forced: 0, preflightReused: 0 });
    assert.equal(failed.executionSummary.kinds.cargo.miss, 1);
    assert.equal(warm.nativeCache.executed, 0);
    const proof = warm.checks.find(check => check.evidenceKind === 'cargo');
    assert.equal(proof.originalEvidence.cacheKey, proof.cacheKey);
    assert.equal(proof.originalEvidence.logSha256, proof.logSha256);
    assert.equal(calls.filter(name => name === 'scripts/check-api-context.cjs').length, 1);
    const forced = await gate.runPreservation({ ...config, reuseNativeChecks: false });
    assert.equal(forced.status, 'passed', forced.error); assert.equal(forced.cargoCache.reused, 0);
    assert.deepEqual(forced.executionSummary.kinds.cargo, { executed: 1, reused: 0, miss: 0, forced: 1, preflightReused: 0 });
    assert.equal(forced.reusePolicy.native, false);
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

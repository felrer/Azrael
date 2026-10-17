'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, after } = require('node:test');
const { spawnSync } = require('node:child_process');
const gate = require('./feature-preservation.cjs');
const verificationCache = require('./verification-result-cache.cjs');
const { getDirectoryState } = require('./directory-state.cjs');
const repository = path.resolve(__dirname, '..');
const fixtures = path.resolve(process.env.AZRAEL_FEATURE_PRESERVATION_TEST_ROOT || path.join(repository, 'artifacts/verification'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const roots = [];
const evidence = [];
fs.mkdirSync(fixtures, { recursive: true });

function setup() {
  const root = fs.mkdtempSync(path.join(fixtures, 'preservation-cache-')); roots.push(root);
  function write(file, text) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); }
  for (const name of ['feature-preservation', 'verification-result-cache', 'directory-state']) write(`scripts/${name}.cjs`, fs.readFileSync(path.join(__dirname, `${name}.cjs`)));
  write('scripts/inject-provider-model-picker.cjs', 'module.exports={PROVIDER_PICKER_ASSET:"picker.js"};');
  write('ui/package.json', '{"version":"1.0.0"}'); write('ui/picker.js', 'pristine');
  write('portable/unrelated.txt', 'unrelated'); write('scripts/shared.cjs', '// shared');
  const features = ['alpha', 'beta', 'gamma', 'uncached', 'native'].map(id => {
    write(`scripts/${id}.cjs`, `console.log(${JSON.stringify(id)});`);
    write(`scripts/owner-${id}.cjs`, '// owner'); write(`docs/${id}.md`, 'contract');
    const check = { id: `${id}.check`, executable: 'node', args: [`scripts/${id}.cjs`], level: id === 'native' ? 'native' : 'source' };
    if (['alpha', 'beta', 'gamma'].includes(id)) check.cacheInputs = { schema: 1, files: [`scripts/owner-${id}.cjs`, ...(['alpha', 'beta'].includes(id) ? ['scripts/shared.cjs'] : [])] };
    return { id, area: id === 'native' ? 'engine' : 'ui', owners: [`scripts/owner-${id}.cjs`], contract: `docs/${id}.md`, reportFields: id === 'native' ? [] : [`${id}Edits`], checks: [check] };
  });
  let calls = []; let hook;
  // Exact invalidation counts require uncontended cache acquisition. The sync
  // child fixture can otherwise block another worker's lifecycle lease release.
  // Parallel cache safety is exercised separately with an intentional lease.
  const config = { projectRoot: root, uiRoot: path.join(root, 'ui'), outputDirectory: path.join(root, 'output'), sourceConcurrency: 1, area: 'all', manifest: { schema: 1, features }, transformRules: {},
    typeScriptPath: require.resolve('typescript', { paths: [path.join(repository, 'extensions/azrael-ex')] }),
    identityProvider: async () => ({ project: await getDirectoryState(root, ['portable/unrelated.txt', ...features.flatMap(f => [...f.owners, f.contract]), 'scripts/shared.cjs']), ui: await getDirectoryState(path.join(root, 'ui')) }),
    execute: async (_executable, args, options) => {
      calls.push(args[0]); if (hook) await hook(args, options);
      const result = spawnSync(process.execPath, args, { cwd: options.cwd, env: options.env, encoding: 'utf8' });
      fs.writeFileSync(options.logPath, result.stdout || ''); fs.writeFileSync(options.errorPath, result.stderr || '');
      return { exitCode: result.status, signal: result.signal, error: result.error?.message };
    } };
  return { root, config, write, calls: () => calls, hook: fn => { hook = fn; }, async run() { calls = []; const receipt = await gate.runPreservation(config); evidence.push({ fixture: path.basename(root), status: receipt.status, cache: receipt.cache, checks: receipt.checks.map(({ checkId, exitCode, reused, cacheKey, logSha256, errorSha256 }) => ({ checkId, exitCode, reused, cacheKey, logSha256, errorSha256 })) }); assert.equal(receipt.status, 'passed', receipt.error); return receipt; } };
}
function keys(f, id) { const slot = path.join(f.root, 'artifacts/cache/verification-results/v1', sha(`${id}.check`)); return fs.existsSync(slot) ? fs.readdirSync(slot).filter(name => /^[a-f0-9]{64}$/.test(name)) : []; }
function entry(f, id, receipt) { return path.join(f.root, 'artifacts/cache/verification-results/v1', sha(`${id}.check`), receipt.checks.find(c => c.checkId === `${id}.check`).cacheKey); }
function counts(receipt, executed, reused) { assert.equal(receipt.cache.executed, executed); assert.equal(receipt.cache.reused, reused); assert.equal(receipt.checks.filter(c => c.reused).length, reused); }

test('cold/hit reuse, selective dependencies, unrelated project drift and package authority', async () => {
  const f = setup(); const cold = await f.run(); counts(cold, 5, 0); const warm = await f.run(); counts(warm, 2, 3);
  assert.deepEqual(f.calls(), ['scripts/uncached.cjs', 'scripts/native.cjs']);
  const old = entry(f, 'alpha', warm); f.write('scripts/owner-alpha.cjs', '// changed');
  f.hook(args => { if (args[0] === 'scripts/alpha.cjs') assert.equal(fs.existsSync(old), false, 'old key removed before execution'); });
  const changed = await f.run(); counts(changed, 3, 2); assert.equal(keys(f, 'alpha').length, 1); f.hook(null);
  f.write('scripts/shared.cjs', '// shared changed'); counts(await f.run(), 4, 1);
  f.write('portable/unrelated.txt', 'unrelated changed'); const unrelated = await f.run(); counts(unrelated, 2, 3);
  // Receipt verification retains aggregate project authority even when source checks hit.
  const config = { ...f.config, area: 'ui', featureIds: ['alpha', 'beta', 'gamma', 'uncached'] };
  const ui = await gate.runPreservation(config); assert.equal(ui.status, 'passed', ui.error);
  const reportPath = path.join(f.root, 'report.json'), packagePath = path.join(f.root, 'candidate.vsix');
  fs.writeFileSync(reportPath, JSON.stringify({ assets: [{ alphaEdits: 1, betaEdits: 1, gammaEdits: 1, uncachedEdits: 1 }], transformRules: {}, sourceUi: { version: '1.0.0', packageSha256: sha(fs.readFileSync(path.join(f.root, 'ui/package.json'))), webviewSha256: sha(fs.readFileSync(path.join(f.root, 'ui/picker.js'))) } })); fs.writeFileSync(packagePath, 'package');
  const binding = { ...config, receiptPath: ui.receiptPath, reportPath, packagePath };
  await gate.bindPackage(binding); await gate.verifyPackage(binding);
  f.write('portable/unrelated.txt', 'full project drift'); await assert.rejects(gate.verifyPackage(binding), /input identity is stale/);
});

test('UI, execution environment, runner and declared contract changes invalidate keys', async () => {
  const f = setup(); await f.run(); counts(await f.run(), 2, 3);
  f.write('ui/picker.js', 'changed UI'); counts(await f.run(), 5, 0);
  const envName = 'AZRAEL_CACHE_INTEGRATION_MARKER', previous = process.env[envName];
  try { process.env[envName] = crypto.randomUUID(); counts(await f.run(), 5, 0); }
  finally { if (previous === undefined) delete process.env[envName]; else process.env[envName] = previous; }
  counts(await f.run(), 5, 0);
  f.write('scripts/directory-state.cjs', '// changed runner dependency'); counts(await f.run(), 5, 0);
  f.write('docs/gamma.md', 'changed contract'); counts(await f.run(), 3, 2);
  // Use a complete, real installed TS package; changing a sibling proves the
  // key binds the runtime tree rather than only the require entry.
  const copiedRuntime = path.join(f.root, 'runtime/typescript');
  fs.cpSync(path.dirname(path.dirname(f.config.typeScriptPath)), copiedRuntime, { recursive: true });
  f.config.typeScriptPath = path.join(copiedRuntime, 'lib/typescript.js'); counts(await f.run(), 5, 0); counts(await f.run(), 2, 3);
  fs.appendFileSync(path.join(copiedRuntime, 'lib/typescript.d.ts'), '\n// runtime sibling changed\n'); counts(await f.run(), 5, 0);
  // Execute a copied real Node binary, preserving and restoring process state.
  const nodeDescriptor = Object.getOwnPropertyDescriptor(process, 'execPath');
  const nodeCopy = path.join(f.root, 'runtime', path.basename(process.execPath)); fs.copyFileSync(process.execPath, nodeCopy);
  try { Object.defineProperty(process, 'execPath', { ...nodeDescriptor, value: nodeCopy }); counts(await f.run(), 5, 0); counts(await f.run(), 2, 3); }
  finally { Object.defineProperty(process, 'execPath', nodeDescriptor); }
  const original = f.config.typeScriptPath; f.config.typeScriptPath = path.join(f.root, 'missing/typescript.js');
  const noRuntime = await f.run(); counts(noRuntime, 5, 0); assert.ok(noRuntime.cache.disabledReason); f.config.typeScriptPath = original;
});

test('failed and drifting runs publish no passing check results', async () => {
  const f = setup(); f.write('scripts/uncached.cjs', 'process.exit(7);');
  const failed = await gate.runPreservation(f.config); assert.equal(failed.status, 'failed'); assert(failed.checks.some(c => c.exitCode === 7));
  for (const id of ['alpha', 'beta', 'gamma']) assert.deepEqual(keys(f, id), []);
  f.write('scripts/uncached.cjs', 'console.log("fixed");'); let mutated = false;
  f.hook(() => { if (!mutated) { mutated = true; f.write('portable/unrelated.txt', 'drift during execution'); } });
  const drift = await gate.runPreservation(f.config); assert.equal(drift.status, 'failed'); assert.match(drift.error, /Inputs changed/);
  for (const id of ['alpha', 'beta', 'gamma']) assert.deepEqual(keys(f, id), []);
  f.hook(null); counts(await f.run(), 5, 0);
});

test('corrupt cache receipt/log misses and copied run logs survive invalidation', async () => {
  const f = setup(); const cold = await f.run(); const warm = await f.run();
  fs.writeFileSync(path.join(entry(f, 'alpha', cold), 'receipt.json'), '{corrupt'); counts(await f.run(), 3, 2);
  const latest = await f.run(); fs.writeFileSync(path.join(entry(f, 'beta', latest), 'stdout.log'), 'tampered'); counts(await f.run(), 3, 2);
  f.write('scripts/shared.cjs', '// delete old cached evidence'); await f.run();
  for (const record of warm.checks) { assert.equal(sha(fs.readFileSync(record.logPath)), record.logSha256); assert.equal(sha(fs.readFileSync(record.errorPath)), record.errorSha256); }
  f.config.reuseSourceChecks = false; counts(await f.run(), 5, 0);
});

test('reuseSourceChecks requires an explicit boolean', async () => {
  const f = setup();
  for (const value of ['false', 0, null]) {
    f.config.reuseSourceChecks = value; const receipt = await gate.runPreservation(f.config);
    assert.equal(receipt.status, 'failed'); assert.match(receipt.error, /reuseSourceChecks.*boolean/); assert.deepEqual(f.calls(), []);
  }
});

test('parallel checks execute safely when a held cache lease prevents reuse', async () => {
  const f = setup(); const cold = await f.run(); counts(cold, 5, 0);
  const warm = await f.run(); counts(warm, 2, 3);
  const gammaEntry = entry(f, 'gamma', warm);
  const previous = new Map(['receipt.json', 'stdout.log', 'stderr.log'].map(name => [name, fs.readFileSync(path.join(gammaEntry, name))]));
  const held = await verificationCache.begin({ projectRoot: f.root, checkId: 'gamma.check',
    key: warm.checks.find(record => record.checkId === 'gamma.check').cacheKey,
    runDirectory: path.join(f.root, 'held-reader') });
  try {
    assert.equal(held.hit?.reused, true);
    f.config.sourceConcurrency = 4;
    const parallel = await f.run();
    assert.equal(parallel.checks.find(record => record.checkId === 'gamma.check').reused, false);
    for (const record of parallel.checks) {
      const baseline = warm.checks.find(previous => previous.checkId === record.checkId);
      assert.equal(record.logSha256, baseline.logSha256);
      assert.equal(record.errorSha256, baseline.errorSha256);
      assert.equal(sha(fs.readFileSync(record.logPath)), record.logSha256);
      assert.equal(sha(fs.readFileSync(record.errorPath)), record.errorSha256);
      if (['alpha.check', 'beta.check', 'gamma.check'].includes(record.checkId) && !record.reused) {
        assert.ok(parallel.cache.deferred.some(reason => reason.checkId === record.checkId && /^busy: (check|lifecycle) lease$/.test(reason.reason)),
          `${record.checkId} must either reuse valid evidence or report a busy lease`);
      }
    }
    assert.ok(f.calls().includes('scripts/gamma.cjs'));
    assert.equal(parallel.cache.executed, f.calls().length);
    assert.equal(parallel.cache.reused, parallel.checks.filter(record => record.reused).length);
    assert.equal(parallel.cache.executed + parallel.cache.reused, 5);
    for (const [name, bytes] of previous) assert.deepEqual(fs.readFileSync(path.join(gammaEntry, name)), bytes);
    for (const record of warm.checks) {
      assert.equal(sha(fs.readFileSync(record.logPath)), record.logSha256);
      assert.equal(sha(fs.readFileSync(record.errorPath)), record.errorSha256);
    }
  } finally { await held.close(); }
  f.config.sourceConcurrency = 1;
  counts(await f.run(), 2, 3);
});

function setupV2(all = true) {
  const f = setup();
  for (const feature of f.config.manifest.features) {
    for (const check of feature.checks) if (check.cacheInputs && (all || feature.id === 'alpha')) check.cacheInputs.schema = 2;
  }
  f.write('extensions/azrael-ex/node_modules/typescript/package.json', JSON.stringify({ name: 'typescript', version: '9.0.0-fixture', main: './lib/typescript.js' }));
  f.write('extensions/azrael-ex/node_modules/typescript/lib/typescript.js', 'module.exports={fixture:true};');
  f.write('extensions/azrael-ex/node_modules/typescript/lib/typescript.d.ts', '// actual project compiler sibling');
  const previous = f.config.identityProvider;
  let aggregate = { sourceUi: { fixture: 'source-ui' }, futureUnknownInput: { nested: 'one' }, engine: { ignoredBinaryRoot: 'one' } };
  f.config.identityProvider = async () => ({ ...await previous(), ...structuredClone(aggregate) });
  return { ...f, projectTypeScript: path.join(f.root, 'extensions/azrael-ex/node_modules/typescript'), aggregate: value => { aggregate = value; } };
}

test('schema2 accepts exactly the existing files/schema shape and rejects unknown schemas or fields', () => {
  const f = setupV2(); gate.validateManifest(f.config.manifest, f.root, {});
  for (const change of [check => { check.cacheInputs.schema = 3; }, check => { check.cacheInputs.schema = '2'; },
    check => { check.cacheInputs.extra = true; }, check => { check.cacheInputs.files = []; },
    check => { check.cacheInputs.files.push(check.cacheInputs.files[0]); }]) {
    const manifest = structuredClone(f.config.manifest); change(manifest.features[0].checks[0]);
    assert.throws(() => gate.validateManifest(manifest, f.root, {}), /Invalid source cache inputs/);
  }
});

test('schema2 exact success reuses proof while project, source UI and unknown aggregate inputs miss', async () => {
  const f = setupV2(); const cold = await f.run(); counts(cold, 5, 0);
  const warm = await f.run(); counts(warm, 2, 3);
  for (const check of warm.checks.filter(check => check.reused)) {
    const original = cold.checks.find(before => before.checkId === check.checkId);
    assert.equal(check.exitCode, 0); assert.equal(check.logSha256, original.logSha256); assert.equal(check.errorSha256, original.errorSha256);
    assert.equal(sha(fs.readFileSync(check.logPath)), check.logSha256); assert.equal(sha(fs.readFileSync(check.errorPath)), check.errorSha256);
    assert.ok(check.cacheKey && check.reused);
  }
  f.write('portable/unrelated.txt', 'aggregate project drift'); counts(await f.run(), 5, 0); counts(await f.run(), 2, 3);
  f.aggregate({ sourceUi: { fixture: 'source-ui' }, futureUnknownInput: { nested: 'two' }, engine: { ignoredBinaryRoot: 'one' } });
  counts(await f.run(), 5, 0); counts(await f.run(), 2, 3);
  f.aggregate({ sourceUi: { fixture: 'source-ui-changed' }, futureUnknownInput: { nested: 'two' }, engine: { ignoredBinaryRoot: 'one' } });
  counts(await f.run(), 5, 0); counts(await f.run(), 2, 3);
  f.aggregate({ sourceUi: { fixture: 'source-ui-changed' }, futureUnknownInput: { nested: 'two' }, engine: { ignoredBinaryRoot: 'changed-only-removed-engine' } });
  counts(await f.run(), 2, 3);
});

test('schema2 binds actual project TypeScript separately from a provided compiler runtime', async () => {
  const f = setupV2(); await f.run(); counts(await f.run(), 2, 3);
  assert.notEqual(f.config.typeScriptPath, path.join(f.projectTypeScript, 'lib/typescript.js'));
  fs.appendFileSync(path.join(f.projectTypeScript, 'lib/typescript.d.ts'), '\n// sibling changed\n');
  counts(await f.run(), 5, 0); counts(await f.run(), 2, 3);
  const pkgPath = path.join(f.projectTypeScript, 'package.json'); const pkg = JSON.parse(fs.readFileSync(pkgPath));
  pkg.version = '9.0.1-fixture'; fs.writeFileSync(pkgPath, JSON.stringify(pkg)); counts(await f.run(), 5, 0); counts(await f.run(), 2, 3);
  fs.appendFileSync(path.join(f.projectTypeScript, 'lib/typescript.js'), '\n// entry changed\n'); counts(await f.run(), 5, 0);
});

test('any schema2 group requires certain actual project TypeScript; runtime bypass executes every check', async () => {
  const f = setupV2(false); await f.run(); counts(await f.run(), 2, 3);
  const saved = `${f.projectTypeScript}-held`; fs.renameSync(f.projectTypeScript, saved);
  try { const missing = await f.run(); counts(missing, 5, 0); assert.ok(missing.cache.disabledReason); assert.equal(f.calls().length, 5); }
  finally { fs.renameSync(saved, f.projectTypeScript); }
  const pkgPath = path.join(f.projectTypeScript, 'package.json'); const pkg = JSON.parse(fs.readFileSync(pkgPath));
  fs.writeFileSync(pkgPath, JSON.stringify({ ...pkg, name: 'uncertain-project-tool' }));
  const uncertain = await f.run(); counts(uncertain, 5, 0); assert.match(uncertain.cache.disabledReason, /actual project TypeScript/);
  fs.writeFileSync(pkgPath, JSON.stringify(pkg)); counts(await f.run(), 2, 3);
});

test('schema2 with the same provided and actual compiler still binds the complete compiler tree', async () => {
  const f = setupV2(); f.config.typeScriptPath = path.join(f.projectTypeScript, 'lib/typescript.js');
  await f.run(); counts(await f.run(), 2, 3);
  fs.appendFileSync(path.join(f.projectTypeScript, 'lib/typescript.d.ts'), '\n// identical-runtime sibling drift\n');
  counts(await f.run(), 5, 0);
});

test('schema2 runtime reaffirm rejects actual project compiler drift and whole failures publish nothing', async () => {
  const f = setupV2(); let changed = false;
  f.hook(() => { if (!changed) { changed = true; fs.appendFileSync(path.join(f.projectTypeScript, 'lib/typescript.d.ts'), '\n// drift during execution\n'); } });
  const drift = await gate.runPreservation(f.config); assert.equal(drift.status, 'failed'); assert.match(drift.error, /changed during verification/);
  for (const id of ['alpha', 'beta', 'gamma']) assert.deepEqual(keys(f, id), []);
  f.hook(null); f.write('scripts/uncached.cjs', 'process.exit(7);');
  const failed = await gate.runPreservation(f.config); assert.equal(failed.status, 'failed');
  for (const id of ['alpha', 'beta', 'gamma']) assert.deepEqual(keys(f, id), []);
  f.write('scripts/uncached.cjs', 'console.log("fixed");'); counts(await f.run(), 5, 0); counts(await f.run(), 2, 3);
});

after(() => {
  const directory = process.env.AZRAEL_FEATURE_PRESERVATION_TEST_ROOT
    ? path.join(fixtures, 'evidence') : path.join(repository, 'artifacts/logs/verification-result-cache/integration');
  fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, 'fixture-receipts.json'), JSON.stringify(evidence, null, 2) + '\n');
  // Only this suite's generated fixture roots may be recursively removed.
  for (const root of roots) {
    assert.equal(path.dirname(root), fixtures); assert.match(path.basename(root), /^preservation-cache-/);
    const quoted = root.replace(/'/g, "''");
    const result = spawnSync('pwsh', ['-NoProfile', '-Command', `Remove-Item -LiteralPath '${quoted}' -Recurse -ErrorAction Stop`], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.equal(fs.existsSync(root), false);
  }
});

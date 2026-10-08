'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, after } = require('node:test');
const gate = require('./feature-preservation.cjs');
const { getDirectoryState } = require('./directory-state.cjs');
const cache = require('./verification-result-cache.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const fixtures = fs.mkdtempSync(path.resolve(__dirname, '../artifacts/verification/native-cache-'));
const summaries = [];
let sequence = 0;
function write(root, file, contents) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), contents);
}
function setup() {
  const root = path.join(fixtures, String(++sequence));
  for (const file of ['feature-preservation.cjs', 'native-verification-cache.cjs', 'verification-result-cache.cjs', 'directory-state.cjs']) {
    write(root, `scripts/${file}`, fs.readFileSync(path.join(__dirname, file)));
  }
  write(root, 'scripts/owner.cjs', '// owner');
  write(root, 'scripts/helper.cjs', '// helper');
  write(root, 'docs/contract.md', 'Native fixture contract');
  write(root, 'ui/view.js', 'UI bytes');
  write(root, 'engine-source/codex-rs/models-manager/models.json', '{"models":[]}');
  for (const file of ['codex.exe', 'azrael-bridge.exe', 'codex-code-mode-host.exe']) write(root, `engine/${file}`, file);
  write(root, 'scripts/probe.cjs', `const fs=require('node:fs'),path=require('node:path');
const [id,fixture,engine]=process.argv.slice(2);fs.mkdirSync(fixture,{recursive:true});
if(!fs.existsSync(path.join(engine,'codex.exe')))process.exit(8);
fs.appendFileSync('invocations.jsonl',JSON.stringify({id,fixture,engine})+'\\n');
const control=fs.existsSync('control.json')?JSON.parse(fs.readFileSync('control.json')):{};
if(control.mutate===id)fs.appendFileSync('scripts/helper.cjs','\\n// drift');
console.log('passing native evidence '+id);process.exit(control.fail===id?9:0);`);
  const manifest = { schema: 1, features: ['provider-context', 'recovery', 'accepted-input'].map(id => ({
    id: `engine.${id}`, area: 'engine', owners: ['scripts/owner.cjs'], contract: 'docs/contract.md', reportFields: [],
    checks: [{ id: `engine.${id}.native`, executable: 'node', level: 'native',
      args: ['scripts/probe.cjs', id, '{fixture}', '{engineDirectory}'], nativeCacheInputs: { schema: 1, files: ['scripts/helper.cjs'] } }]
  })) };
  let identities = 0, rejectProvenance = false, driftIdentity = false, ignoreProject = false;
  const config = { projectRoot: root, engineSourceRoot: path.join(root, 'engine-source'), engineDirectory: path.join(root, 'engine'),
    outputDirectory: path.join(root, 'artifacts/results'), area: 'engine', manifest, transformRules: {},
    identityProvider: async () => {
      identities++;
      if (rejectProvenance) throw Error('Engine provenance failed: synthetic rejection');
      if (ignoreProject) return { candidate: 'stable' };
      return { project: await getDirectoryState(root, ['scripts/owner.cjs', 'scripts/helper.cjs', 'docs/contract.md', 'ui/view.js']),
        engine: await getDirectoryState(config.engineDirectory), manifest, generation: driftIdentity ? identities : 0 };
    } };
  const calls = () => fs.existsSync(path.join(root, 'invocations.jsonl')) ? fs.readFileSync(path.join(root, 'invocations.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : [];
  async function run(executed, reused, status = 'passed') {
    const before = calls().length, identityBefore = identities;
    const receipt = await gate.runPreservation(config);
    assert.equal(receipt.status, status, receipt.error);
    assert.equal(calls().length - before, executed);
    assert.equal(receipt.nativeCache.executed, executed); assert.equal(receipt.nativeCache.reused, reused);
    if (status === 'passed') {
      assert.equal(identities - identityBefore, 2, 'full identities must run before and after every hit');
      for (const duration of Object.values(receipt.timings)) assert(Number.isFinite(duration) && duration >= 0);
      assert.equal(receipt.checks.filter(check => check.executionStatus === 'reused').length, reused);
      assert(receipt.checks.every(check => check.executionReason && check.exitCode === 0));
    }
    summaries.push({ fixture: sequence, status, executed, reused, timings: receipt.timings });
    return receipt;
  }
  const entries = check => path.join(root, 'artifacts/cache/verification-results/native', `v${cache.CACHE_SCHEMA}`, sha(check.checkId), check.cacheKey);
  return { root, config, manifest, run, calls, entries, identities: () => identities,
    reject: () => { rejectProvenance = true; }, drift: () => { driftIdentity = true; },
    stable: (ignore = false) => { driftIdentity = false; ignoreProject = ignore; } };
}
test('public gate cold/warm executes three real child probes and retains independent evidence', async () => {
  const f = setup(), cold = await f.run(3, 0), warm = await f.run(0, 3);
  assert.equal(cold.nativeCache.eligible, 3); assert.equal(warm.nativeCache.eligible, 3);
  assert.equal(f.identities(), 4);
  assert.equal(new Set(f.calls().map(call => call.fixture)).size, 3);
  for (let i = 0; i < 3; i++) {
    assert.notEqual(cold.checks[i].args[2], warm.checks[i].args[2]);
    assert.notEqual(cold.checks[i].logPath, warm.checks[i].logPath);
    assert.equal(fs.readFileSync(cold.checks[i].logPath, 'utf8'), fs.readFileSync(warm.checks[i].logPath, 'utf8'));
  }
});
test('UI and unrelated engine source changes retain native keys; copied same-byte release retains hits', async () => {
  const f = setup(); await f.run(3, 0);
  write(f.root, 'ui/view.js', 'updated UI'); write(f.root, 'engine-source/unrelated.rs', '// unrelated');
  await f.run(0, 3);
  const relocated = path.join(f.root, 'relocated'); fs.cpSync(f.config.engineDirectory, relocated, { recursive: true });
  f.config.engineDirectory = relocated; await f.run(0, 3);
});
for (const file of ['engine/codex.exe', 'engine/azrael-bridge.exe', 'engine/codex-code-mode-host.exe',
  'engine-source/codex-rs/models-manager/models.json', 'scripts/helper.cjs', 'scripts/owner.cjs', 'docs/contract.md',
  'scripts/feature-preservation.cjs', 'scripts/native-verification-cache.cjs', 'scripts/verification-result-cache.cjs']) {
  test(`changed ${file} reruns and removes superseded key`, async () => {
    const f = setup(), cold = await f.run(3, 0), old = f.entries(cold.checks[0]);
    fs.appendFileSync(path.join(f.root, file), '\nchanged input');
    await f.run(3, 0); assert.equal(fs.existsSync(old), false); await f.run(0, 3);
  });
}
test('command templates and environment are bound', async () => {
  const f = setup(); await f.run(3, 0);
  f.manifest.features.forEach(feature => feature.checks[0].args.push('new-flag')); await f.run(3, 0);
  const previous = process.env.AZRAEL_NATIVE_CACHE_TEST;
  try { process.env.AZRAEL_NATIVE_CACHE_TEST = 'changed'; await f.run(3, 0); await f.run(0, 3); }
  finally { if (previous === undefined) delete process.env.AZRAEL_NATIVE_CACHE_TEST; else process.env.AZRAEL_NATIVE_CACHE_TEST = previous; }
});
test('missing, corrupt or tampered stored evidence executes the affected probe', async () => {
  for (const mode of ['missing', 'corrupt', 'tampered']) {
    const f = setup(), cold = await f.run(3, 0), entry = f.entries(cold.checks[0]);
    const files = fs.readdirSync(entry);
    const receipt = files.find(file => file.endsWith('.json'));
    const log = files.find(file => file.endsWith('.log') && !file.includes('stderr'));
    assert(receipt && log);
    if (mode === 'missing') fs.unlinkSync(path.join(entry, log));
    else fs.writeFileSync(path.join(entry, mode === 'corrupt' ? receipt : log), 'corrupted');
    await f.run(1, 2); await f.run(0, 3);
  }
});
test('failed probes, full identity drift and native input drift never publish successes', async () => {
  for (const mode of ['fail', 'identity', 'native']) {
    const f = setup();
    if (mode === 'fail') write(f.root, 'control.json', JSON.stringify({ fail: 'recovery' }));
    if (mode === 'identity') f.drift();
    if (mode === 'native') {
      write(f.root, 'control.json', JSON.stringify({ mutate: 'recovery' }));
      f.stable(true);
    }
    const failed = await f.run(3, 0, 'failed');
    assert.match(failed.error, mode === 'fail' ? /mandatory check failed/ : /changed during verification/);
    for (const check of failed.checks) assert.equal(fs.existsSync(f.entries(check)), false);
    write(f.root, 'control.json', '{}');
    f.stable();
    await f.run(3, 0); await f.run(0, 3);
  }
});
test('warm cache still rejects failed engine provenance before any native probe', async () => {
  const f = setup(); await f.run(3, 0); f.reject();
  const before = f.calls().length, receipt = await gate.runPreservation(f.config);
  assert.equal(receipt.status, 'failed'); assert.match(receipt.error, /Engine provenance failed/);
  assert.equal(f.calls().length, before); assert.equal(receipt.checks.length, 0);
});
test('boolean opt-out forces probes, rejects nonboolean and undeclared native checks never reuse', async () => {
  const f = setup(); await f.run(3, 0); f.config.reuseNativeChecks = false;
  const forced = await f.run(3, 0); assert.equal(forced.nativeCache.eligible, 3);
  assert(forced.checks.every(check => /forced|disabled/.test(check.executionReason)));
  write(f.root, 'control.json', JSON.stringify({ fail: 'recovery' }));
  const failed = await f.run(3, 0, 'failed');
  assert.match(failed.error, /mandatory check failed/);
  for (const check of failed.checks) assert.equal(fs.existsSync(f.entries(check)), false, 'forced failure removes prior same-key pass');
  write(f.root, 'control.json', '{}');
  f.config.reuseNativeChecks = true;
  await f.run(3, 0); await f.run(0, 3);
  f.config.reuseNativeChecks = 'false'; const bad = await gate.runPreservation(f.config);
  assert.equal(bad.status, 'failed'); assert.match(bad.error, /must be boolean/);
  delete f.config.reuseNativeChecks;
  f.manifest.features.forEach(feature => { delete feature.checks[0].nativeCacheInputs; });
  await f.run(3, 0); await f.run(3, 0);
});
test('manifest rejects native declarations outside engine/node/native whole-fixture contract', () => {
  const f = setup();
  for (const mutate of [feature => { feature.area = 'ui'; feature.reportFields = ['edits']; feature.checks[0].level = 'source'; },
    feature => { feature.checks[0].level = 'source'; }, feature => { feature.checks[0].executable = 'python'; },
    feature => { feature.checks[0].args[2] = '--fixture={fixture}'; }, feature => { feature.checks[0].nativeCacheInputs.schema = 2; }]) {
    const manifest = structuredClone(f.manifest); mutate(manifest.features[0]);
    assert.throws(() => gate.validateManifest(manifest, f.root, {}), /Invalid native cache inputs/);
  }
});
after(() => {
  const output = path.resolve(__dirname, '../artifacts/logs/test-reduction/native'); fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'native-summary.json'), JSON.stringify({ fixtures, runs: summaries }, null, 2));
  // Same containment/link guard used by the existing storage-cache test hook.
  function clean(filename) {
    const relative = path.relative(fixtures, filename); assert(relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)));
    const stat = fs.lstatSync(filename); assert(!stat.isSymbolicLink(), `Linked fixture retained: ${filename}`);
    if (stat.isDirectory()) { for (const child of fs.readdirSync(filename)) clean(path.join(filename, child)); fs.rmdirSync(filename); }
    else fs.unlinkSync(filename);
  }
  clean(fixtures); assert.equal(fs.existsSync(fixtures), false); console.log('Native fixture cleanup: removed');
});

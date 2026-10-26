'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { selectAssetCacheFactory } = require('./namespace-cache-owner.cjs');
const root = path.resolve(__dirname, '..'), local = require.resolve('./asset-transform-cache.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const parent = path.join(root, 'artifacts/verification'); fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, 'namespace-owner-'));
  const owner = name => { const result = path.join(base, name); fs.mkdirSync(path.join(result, 'scripts'), { recursive: true });
    fs.copyFileSync(local, path.join(result, 'scripts/asset-transform-cache.cjs')); return result; };
  t.after(() => { fs.rmSync(base, { recursive: true }); assert.equal(fs.existsSync(base), false); });
  return { base, owner };
}
test('default factory identity and explicit owner module byte mismatch/unknown ownership', t => {
  const f = fixture(t), owner = f.owner('owner');
  assert.equal(selectAssetCacheFactory(local), require(local).createAssetTransformCache);
  for (const invalid of [null, 'relative']) assert.throws(() => selectAssetCacheFactory(local, invalid), /absolute/);
  fs.appendFileSync(path.join(owner, 'scripts/asset-transform-cache.cjs'), '\n// changed\n');
  assert.throws(() => selectAssetCacheFactory(local, owner), /bytes differ/);
});
test('module and cache junction escapes retain the production path guards', t => {
  const f = fixture(t), owner = f.owner('owner'), linked = path.join(f.base, 'linked'); fs.mkdirSync(linked);
  fs.symlinkSync(path.join(owner, 'scripts'), path.join(linked, 'scripts'), 'junction');
  assert.throws(() => selectAssetCacheFactory(local, linked), /escapes/);
  const factory = selectAssetCacheFactory(local, owner), outside = path.join(f.base, 'outside'); fs.mkdirSync(outside);
  fs.mkdirSync(path.join(owner, 'artifacts')); fs.symlinkSync(outside, path.join(owner, 'artifacts/escaped'), 'junction');
  assert.throws(() => factory({ cacheDirectory: path.join(owner, 'artifacts/escaped/cache'), typescriptSha256: 'a'.repeat(64),
    typescriptVersion: 'version', transformRules: {} }), /outside artifacts/);
});
test('unverified preloaded exports and later cached exports mutation are rejected', t => {
  const f = fixture(t), preloaded = f.owner('preloaded'), trusted = f.owner('trusted');
  require(path.join(preloaded, 'scripts/asset-transform-cache.cjs'));
  assert.throws(() => selectAssetCacheFactory(local, preloaded), /without verified identity/);
  const factory = selectAssetCacheFactory(local, trusted);
  assert.equal(selectAssetCacheFactory(local, trusted), factory);
  const modulePath = fs.realpathSync(path.join(trusted, 'scripts/asset-transform-cache.cjs'));
  require.cache[modulePath].exports.createAssetTransformCache = () => {};
  assert.throws(() => selectAssetCacheFactory(local, trusted), /exports changed/);
});
test('verified owner reload rejects changed file identity even when bytes stay equal', t => {
  const f = fixture(t), owner = f.owner('owner'); selectAssetCacheFactory(local, owner);
  const filename = path.join(owner, 'scripts/asset-transform-cache.cjs'), stat = fs.statSync(filename);
  fs.utimesSync(filename, stat.atime, new Date(stat.mtimeMs + 2000));
  assert.deepEqual(fs.readFileSync(filename), fs.readFileSync(local));
  assert.throws(() => selectAssetCacheFactory(local, owner), /identity or exports changed/);
});
test('module file identity must remain stable across the content read', t => {
  const f = fixture(t), owner = f.owner('owner'), filename = fs.realpathSync(path.join(owner, 'scripts/asset-transform-cache.cjs'));
  const original = fs.statSync; let reads = 0;
  fs.statSync = function (input, ...args) { const result = original.call(this, input, ...args);
    // Windows file IDs can exceed Number.MAX_SAFE_INTEGER; +1 may be unchanged.
    if (input === filename && ++reads === 2) return { ...result, ino: result.ino === 0 ? 1 : 0 };
    return result; };
  try { assert.throws(() => selectAssetCacheFactory(local, owner), /identity changed while reading/); }
  finally { fs.statSync = original; }
});
test('real pinned targets: independent uncached/cold output and metadata equality, warm skips producer', t => {
  const f = fixture(t), owner = f.owner('owner'), namespace = require('./namespace-azrael-host.cjs');
  const entry = require.resolve('../extensions/azrael-ex/node_modules/typescript'), ts = require(entry);
  const targets = require('./inject-task-work-time.cjs'), assets = [targets.ASSET, targets.TURN_ASSET].map(relative => {
    const fullPath = path.join(root, 'artifacts/upstream-ui/26.1007.21434', relative);
    return { relative, fullPath, source: fs.readFileSync(fullPath, 'utf8') }; });
  const expected = assets.map(a => namespace.transformAsset(a.source, a.relative, a.fullPath, ts));
  const rules = namespace.getTransformRules(); assert.ok(rules['namespace-cache-owner.cjs']);
  const factory = selectAssetCacheFactory(local, owner);
  for (const phase of ['cold', 'warm']) {
    let producers = 0; const statistics = { hits: 0, misses: 0 }, started = performance.now();
    const cache = factory({ cacheDirectory: path.join(owner, 'artifacts/cache/namespace'), typescriptSha256: sha(fs.readFileSync(entry)),
      typescriptVersion: ts.version, transformRules: rules, getAssetTransformRules: namespace.getAssetTransformRules, pruneUnused: true, statistics });
    const actual = assets.map(a => cache.run(a.relative, a.source, () => { producers++; return namespace.transformAsset(a.source, a.relative, a.fullPath, ts); }));
    cache.flush(); assert.deepEqual(actual, expected); assert.equal(producers, phase === 'cold' ? 2 : 0);
    assert.equal(statistics.hits, phase === 'cold' ? 0 : 2); assert.equal(statistics.misses, phase === 'cold' ? 2 : 0);
    t.diagnostic(JSON.stringify({ phase, elapsedMs: performance.now() - started, producers, ...statistics }));
  }
});
test('actual namespace CLI branch forwards default and explicit owner while retaining existing cache options', () => {
  const source = fs.readFileSync(path.join(__dirname, 'namespace-azrael-host.cjs'), 'utf8');
  const cli = source.slice(source.indexOf('if (require.main === module) {'));
  const entry = require.resolve('../extensions/azrael-ex/node_modules/typescript'), ts = require(entry);
  for (const owner of [undefined, root]) {
    let captured; const module = {}, requireStub = input => { assert.equal(input, entry); return ts; }; requireStub.main = module;
    vm.runInNewContext(cli, { require: requireStub, module, process: { argv: ['node', 'script', 'prepared', entry, 'version', 'cache', ...(owner ? [owner] : [])] },
      path, fs, sha, transformExtension: (...args) => { captured = args; return { then() { return { catch() {} }; } }; }, console });
    assert.equal(captured[3].cacheProjectRoot, owner); assert.equal(captured[3].cacheDirectory, 'cache');
    assert.equal(captured[3].typescriptSha256, sha(fs.readFileSync(entry)));
  }
});

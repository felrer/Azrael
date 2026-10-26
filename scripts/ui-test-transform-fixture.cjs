'use strict';
// Test-only reuse of the complete native transform; production exports stay untouched.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const namespace = require('./namespace-azrael-host.cjs');
const localCachePath = require.resolve('./asset-transform-cache.cjs');
const projectRoot = path.resolve(__dirname, '..');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const signature = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
function fileIdentity(filename) {
  const before = fs.statSync(filename), digest = sha(fs.readFileSync(filename)), after = fs.statSync(filename);
  if (!before.isFile() || signature(before) !== signature(after)) throw Error('Uncertain fixture tool identity');
  return { sha256: digest, signature: signature(after) };
}
function createUiTestTransformFixture(options = {}) {
  const instances = new Map(), records = [];
  const statistics = { calls: 0, hits: 0, misses: 0, producerCalls: 0, bypassed: 0 };
  let tools;
  function identity(ts) {
    if (!tools) {
      const entry = require.resolve('typescript', { paths: [path.join(projectRoot, 'extensions/azrael-ex')] });
      const actual = require(entry);
      tools = { entry, actual, ts: fileIdentity(entry), node: fileIdentity(process.execPath), wrapper: fileIdentity(__filename) };
    }
    if (ts !== tools.actual) throw Error('Unknown TypeScript export object');
    for (const [filename, expected] of [[tools.entry, tools.ts], [process.execPath, tools.node], [__filename, tools.wrapper]]) {
      if (signature(fs.statSync(filename)) !== expected.signature) throw Error('Fixture tool changed after loading');
    }
    return { node: { executable: process.execPath, sha256: tools.node.sha256, version: process.version,
      platform: process.platform, arch: process.arch }, environmentSha256: sha(canonical(process.env)),
      wrapperSha256: tools.wrapper.sha256, typescript: { entry: tools.entry, sha256: tools.ts.sha256, version: ts.version } };
  }
  function transformAsset(source, relativePath, fullPath, ts) {
    const args = Array.from(arguments), receiver = this === undefined ? 'undefined' : this === api ? 'fixture' : 'unknown';
    statistics.calls += 1;
    let produced = false;
    const produce = () => { produced = true; statistics.producerCalls += 1; return Reflect.apply(namespace.transformAsset, this, args); };
    let result, bypassReason, hit = 0, miss = 0;
    // Only identity/cache preparation failures bypass; original producer errors propagate once.
    let instance;
    try {
      if (args.length !== 4 || typeof source !== 'string' || typeof relativePath !== 'string' || typeof fullPath !== 'string' || receiver === 'unknown') throw Error('Uncertain transform context');
      const base = identity(ts);
      const owner = Object.hasOwn(options, 'cacheProjectRoot') ? options.cacheProjectRoot
        : process.env.AZRAEL_TEST_UI_TRANSFORM_CACHE_PROJECT_ROOT === undefined ? projectRoot : process.env.AZRAEL_TEST_UI_TRANSFORM_CACHE_PROJECT_ROOT;
      if (typeof owner !== 'string' || !path.isAbsolute(owner)) throw Error('Cache owner must be absolute');
      const physicalOwner = fs.realpathSync(owner);
      const cacheModulePath = fs.realpathSync(path.join(owner, 'scripts/asset-transform-cache.cjs'));
      if (path.dirname(cacheModulePath) !== path.join(physicalOwner, 'scripts')) throw Error('Unsafe cache module owner');
      const cacheModuleIdentity = fileIdentity(cacheModulePath);
      if (cacheModuleIdentity.sha256 !== fileIdentity(localCachePath).sha256) throw Error('Cache module bytes differ');
      const cacheModule = require(cacheModulePath);
      const rules = namespace.getTransformRules();
      const context = { ...base, cacheModule: { path: cacheModulePath, sha256: cacheModuleIdentity.sha256, physicalOwner }, relativePath, fullPath, receiver, transformRulesSha256: sha(canonical(rules)) };
      const key = sha(canonical(context)), directory = path.join(owner, 'artifacts/cache/ui-test-transform', key);
      instance = instances.get(directory);
      if (!instance) {
        const counters = { hits: 0, misses: 0 };
        instance = { counters, cache: cacheModule.createAssetTransformCache({ cacheDirectory: directory,
          typescriptSha256: base.typescript.sha256, typescriptVersion: base.typescript.version,
          transformRules: rules, getAssetTransformRules: namespace.getAssetTransformRules, pruneUnused: false, statistics: counters }) };
        instances.set(directory, instance);
      }
    } catch (error) { bypassReason = error.message; statistics.bypassed += 1; }
    if (!instance) result = produce();
    else if (instance.last?.source === source) {
      // Context identities were checked above. Share the immutable in-process
      // result instead of rereading, parsing and validating its persisted copy.
      result = instance.last.result;
      hit = 1; statistics.hits += 1;
    } else {
      const oldHits = instance.counters.hits, oldMisses = instance.counters.misses;
      result = instance.cache.run(relativePath, source, produce); instance.cache.flush();
      hit = instance.counters.hits - oldHits; miss = instance.counters.misses - oldMisses;
      statistics.hits += hit; statistics.misses += miss;
      if (result.asset) Object.freeze(result.asset);
      Object.freeze(result);
      instance.last = { source, result };
    }
    const digests = instance?.last?.digests ?? {
      sourceSha256: typeof source === 'string' ? sha(source) : null,
      outputSha256: sha(result.text), assetSha256: sha(canonical(result.asset)),
    };
    if (instance?.last) instance.last.digests = digests;
    records.push({ relativePath, fullPath, argumentCount: args.length, environmentSha256: sha(canonical(process.env)),
      ...digests, producerCalled: produced, hit, miss, bypassReason });
    return result;
  }
  const api = { transformAsset, getStatistics: () => ({ ...statistics, records: records.map(record => ({ ...record })) }) };
  return api;
}
const fixture = createUiTestTransformFixture();
fixture.createUiTestTransformFixture = createUiTestTransformFixture;
module.exports = fixture;

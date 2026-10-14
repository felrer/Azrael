'use strict';
const fs = require('node:fs');
const path = require('node:path');
const verified = new Map();
const signature = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
function readStable(filename) {
  const before = fs.statSync(filename), bytes = fs.readFileSync(filename), after = fs.statSync(filename);
  if (!before.isFile() || signature(before) !== signature(after)) throw Error('Cache module identity changed while reading');
  return { bytes, signature: signature(after) };
}
function descriptorsEqual(object, snapshot) {
  const current = Object.getOwnPropertyDescriptors(object);
  return Reflect.ownKeys(current).length === Reflect.ownKeys(snapshot).length && Reflect.ownKeys(snapshot).every(key => {
    const expected = snapshot[key], actual = current[key];
    return actual && Reflect.ownKeys(expected).every(field => actual[field] === expected[field]);
  });
}
function selectAssetCacheFactory(executionModulePath, owner) {
  // Default resolution preserves the original module, path guards and options.
  if (owner === undefined) return require(executionModulePath).createAssetTransformCache;
  if (typeof owner !== 'string' || !path.isAbsolute(owner)) throw Error('CacheProjectRoot must be absolute');
  const physicalOwner = fs.realpathSync(owner);
  const selected = fs.realpathSync(path.join(owner, 'scripts/asset-transform-cache.cjs'));
  if (path.dirname(selected) !== path.join(physicalOwner, 'scripts')) throw Error('Cache module escapes physical owner');
  const expected = readStable(executionModulePath), actual = readStable(selected);
  if (!actual.bytes.equals(expected.bytes)) throw Error('Cache owner module bytes differ');
  const previous = verified.get(selected), cached = require.cache[selected];
  if (cached && !previous) throw Error('Cache owner module was loaded without verified identity');
  if (previous && (cached !== previous.module || actual.signature !== previous.signature ||
      !actual.bytes.equals(previous.bytes) || cached.exports !== previous.exports ||
      Object.getPrototypeOf(cached.exports) !== previous.prototype || !descriptorsEqual(cached.exports, previous.descriptors) ||
      !descriptorsEqual(previous.factory, previous.factoryDescriptors))) throw Error('Cached owner module identity or exports changed');
  const loaded = require(selected), factory = loaded.createAssetTransformCache;
  const after = readStable(selected), executionAfter = readStable(executionModulePath);
  if (actual.signature !== after.signature || !actual.bytes.equals(after.bytes) ||
      expected.signature !== executionAfter.signature || !expected.bytes.equals(executionAfter.bytes)) throw Error('Cache module identity changed while loading');
  if (typeof factory !== 'function') throw Error('Uncertain cache owner exports');
  verified.set(selected, { module: require.cache[selected], signature: after.signature, bytes: after.bytes,
    exports: loaded, prototype: Object.getPrototypeOf(loaded), descriptors: Object.getOwnPropertyDescriptors(loaded),
    factory, factoryDescriptors: Object.getOwnPropertyDescriptors(factory) });
  return factory;
}
module.exports = { selectAssetCacheFactory };

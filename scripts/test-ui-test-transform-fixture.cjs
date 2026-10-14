'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const namespace = require('./namespace-azrael-host.cjs');
const original = namespace.transformAsset;
const { createUiTestTransformFixture } = require('./ui-test-transform-fixture.cjs');
const ts = require('../extensions/azrael-ex/node_modules/typescript');
const parent = path.resolve(__dirname, '../artifacts/verification');
function temporaryOwner(t) {
  fs.mkdirSync(parent, { recursive: true });
  const owner = fs.mkdtempSync(path.join(parent, 'ui-transform-fixture-'));
  fs.mkdirSync(path.join(owner, 'scripts'));
  fs.copyFileSync(path.join(__dirname, 'asset-transform-cache.cjs'), path.join(owner, 'scripts/asset-transform-cache.cjs'));
  t.after(() => {
    // Only this test's temporary owner is removed, with ordinary deletion.
    fs.rmSync(owner, { recursive: true });
    assert.equal(fs.existsSync(owner), false);
  });
  return owner;
}
const source = 'const label = "Codex";';
const relative = 'webview/assets/fixture.js';
test('real TypeScript warm reuse preserves results; cloned same-version TypeScript executes its producer', t => {
  const fixture = createUiTestTransformFixture({ cacheProjectRoot: temporaryOwner(t) });
  const { transformAsset } = fixture;
  const cold = transformAsset(source, relative, 'fixture.js', ts);
  assert.deepEqual(transformAsset(source, relative, 'fixture.js', ts), cold);
  assert.equal(fixture.getStatistics().hits, 1);
  let parses = 0;
  const cloned = { ...ts, createSourceFile(...args) { parses++; return ts.createSourceFile(...args); } };
  assert.equal(cloned.version, ts.version);
  assert.deepEqual(transformAsset(source, relative, 'fixture.js', cloned), cold);
  assert.ok(parses > 0);
  assert.equal(fixture.getStatistics().producerCalls, 2);
  assert.equal(fixture.getStatistics().bypassed, 1);
  assert.equal(namespace.transformAsset, original);
});
test('exact fullPath and current whole environment partition reuse', t => {
  const fixture = createUiTestTransformFixture({ cacheProjectRoot: temporaryOwner(t) });
  const { transformAsset } = fixture;
  const name = 'AZRAEL_FIXTURE_ENV_REGRESSION', saved = process.env[name];
  t.after(() => { if (saved === undefined) delete process.env[name]; else process.env[name] = saved; });
  process.env[name] = 'one';
  const expected = transformAsset(source, relative, 'fixture.js', ts);
  assert.deepEqual(transformAsset(source, relative, 'fixture.js', ts), expected);
  assert.deepEqual(transformAsset(source, relative, path.resolve('fixture.js'), ts), expected);
  process.env[name] = 'two';
  assert.deepEqual(transformAsset(source, relative, 'fixture.js', ts), expected);
  assert.equal(fixture.getStatistics().hits, 1);
  assert.equal(fixture.getStatistics().misses, 3);
  process.env[name] = 'one';
  assert.deepEqual(transformAsset(source, relative, 'fixture.js', ts), expected);
  assert.equal(fixture.getStatistics().hits, 2);
});
test('null, relative, missing, and different cache module owners fall back to original execution', t => {
  const owner = temporaryOwner(t);
  fs.appendFileSync(path.join(owner, 'scripts/asset-transform-cache.cjs'), '\n// changed cache module\n');
  for (const cacheProjectRoot of [null, 'relative-owner', path.join(owner, 'missing'), owner]) {
    const fixture = createUiTestTransformFixture({ cacheProjectRoot });
    const result = fixture.transformAsset(source, relative, 'fixture.js', ts);
    assert.deepEqual(result, original(source, relative, 'fixture.js', ts));
    assert.equal(fixture.getStatistics().producerCalls, 1);
    assert.equal(fixture.getStatistics().bypassed, 1);
    assert.equal(fixture.getStatistics().hits, 0);
  }
});

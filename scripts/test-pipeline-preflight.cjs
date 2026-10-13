'use strict';
const { test, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const preflight = require('./pipeline-preflight.cjs');
const root = path.resolve(__dirname, '../artifacts/verification/preflight-tests'); fs.mkdirSync(root, { recursive: true });
const owned = [];
after(() => { for (const dir of owned) { assert.equal(path.dirname(dir), root); fs.rmSync(dir, { recursive: true }); } });
const features = [{ checks: [{ args: ['scripts/test-provider-input-budget-helper.cjs'] }] }];
function fixture() {
  const projectRoot = fs.mkdtempSync(path.join(root, 'case-')); owned.push(projectRoot);
  const provider = path.join(projectRoot, 'providers/opencodex'); fs.mkdirSync(provider, { recursive: true });
  fs.writeFileSync(path.join(provider, 'package.json'), '{}'); return { projectRoot, provider };
}
function install(provider) {
  const zod = path.join(provider, 'node_modules/zod'); fs.mkdirSync(zod, { recursive: true });
  fs.writeFileSync(path.join(zod, 'package.json'), JSON.stringify({ name: 'zod', exports: { './v4': './index.cjs' } }));
  fs.writeFileSync(path.join(zod, 'index.cjs'), 'module.exports = {};');
}
test('unselected dependency check causes no install and no package resolution', () => {
  assert.deepEqual(preflight.prepare({ projectRoot: 'missing' }, [], () => { throw Error('unexpected install'); }), { dependenciesPrepared: false });
});
test('existing verification dependencies are reused', () => {
  const f = fixture(); install(f.provider);
  assert.deepEqual(preflight.prepare(f, features, () => { throw Error('unexpected install'); }), { dependenciesPrepared: false });
});
test('missing dependencies require a lockfile and preserve frozen install arguments', () => {
  const f = fixture(); assert.throws(() => preflight.prepare(f, features), /lockfile required/);
  fs.writeFileSync(path.join(f.provider, 'bun.lock'), 'pinned');
  const result = preflight.prepare(f, features, (_executable, args, options) => {
    assert.deepEqual(args, ['install', '--frozen-lockfile']); assert.equal(options.cwd, f.provider); assert.equal(options.shell, false);
    install(f.provider); return { status: 0 };
  }); assert.equal(result.dependenciesPrepared, true);
});
test('failed install and missing exported module reject preparation', () => {
  const f = fixture(); fs.writeFileSync(path.join(f.provider, 'bun.lock'), 'pinned');
  assert.throws(() => preflight.prepare(f, features, () => ({ status: 7 })), /failed: 7/);
  assert.throws(() => preflight.prepare(f, features, () => ({ status: 0 })), /zod/);
});
test('verification identity binds actual package and runtime bytes', async () => {
  const f = fixture(); install(f.provider); const bun = path.join(f.projectRoot, 'bun.exe'); fs.writeFileSync(bun, 'bun runtime');
  const previous = process.env.AZRAEL_BUN; process.env.AZRAEL_BUN = bun;
  try {
    const first = await preflight.identity(f, features);
    fs.appendFileSync(path.join(f.provider, 'node_modules/zod/index.cjs'), '// changed');
    const second = await preflight.identity(f, features); assert.notDeepEqual(second.zod, first.zod);
    fs.appendFileSync(bun, ' changed'); assert.notEqual((await preflight.identity(f, features)).bunSha256, first.bunSha256);
  } finally { if (previous === undefined) delete process.env.AZRAEL_BUN; else process.env.AZRAEL_BUN = previous; }
});

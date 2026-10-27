'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const parent = process.env.AZRAEL_ACCOUNT_CATALOG_TEST_ROOT || require('./artifact-run.cjs').beginArtifactRun(path.resolve(__dirname, '..'), {
  workId: 'account-catalog-checks', owner: 'scripts/test-account-models-catalog.cjs',
}).temporary;
assert(path.isAbsolute(parent));
fs.mkdirSync(parent, { recursive: true });
const fixture = fs.mkdtempSync(path.join(parent, 'catalog-'));
const load = import('./account-models-catalog.mjs');
function write(name, text) { const file = path.join(fixture, name); fs.writeFileSync(file, text); return file; }

test('default catalog belongs to the imported engine with no legacy fallback', async () => {
  const { loadAccountModelsCatalog, defaultAccountModelsCatalog } = await load;
  assert.equal(defaultAccountModelsCatalog, path.resolve(__dirname, '../engine/codex-rs/models-manager/models.json'));
  const result = await loadAccountModelsCatalog([]);
  assert.equal(result.path, defaultAccountModelsCatalog);
  assert(result.models.models.some(model => model.tool_mode === null));
});

test('explicit catalog reads exactly that file and consumes only its option', async () => {
  const { loadAccountModelsCatalog } = await load;
  const models = { models: [{ slug: 'selected-catalog', tool_mode: null }] };
  const file = write('selected.json', JSON.stringify(models));
  const args = ['engine', '--models-catalog', file, 'bridge', '--account-controls-only'];
  assert.deepEqual(await loadAccountModelsCatalog(args), { path: file, models });
  assert.deepEqual(args, ['engine', 'bridge', '--account-controls-only']);
});

test('missing, relative, duplicate, unreadable and invalid catalog inputs fail without fallback', async () => {
  const { loadAccountModelsCatalog } = await load;
  for (const args of [['--models-catalog'], ['--models-catalog', '--account-controls-only'], ['--models-catalog', 'relative.json'], ['--models-catalog', path.join(fixture, 'a'), '--models-catalog', path.join(fixture, 'b')]]) {
    await assert.rejects(loadAccountModelsCatalog(args), /--models-catalog/);
  }
  await assert.rejects(loadAccountModelsCatalog(['--models-catalog', path.join(fixture, 'absent.json')]), { code: 'ENOENT' });
  await assert.rejects(loadAccountModelsCatalog(['--models-catalog', write('invalid.json', '{')]), SyntaxError);
  for (const [name, value] of [['null', null], ['object', {}], ['models', { models: {} }]]) {
    await assert.rejects(loadAccountModelsCatalog(['--models-catalog', write(name + '.json', JSON.stringify(value))]), /models array/);
  }
});

test('real check rejects bad catalog and missing fixture model before creating a producer or fixture', () => {
  const check = path.join(__dirname, 'check-accounts.mjs');
  const state = path.join(fixture, 'never-created');
  const socket = path.join(fixture, 'never-created-socket', 'a.sock');
  for (const file of [path.join(fixture, 'absent.json'), write('empty.json', '{"models":[]}')]) {
    const result = spawnSync(process.execPath, [check, 'unused-engine', 'unused-bridge', state, socket, '--models-catalog', file], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /ENOENT|did not contain a fixture model/);
    assert.equal(fs.existsSync(state), false);
    assert.equal(fs.existsSync(path.dirname(socket)), false);
  }
});

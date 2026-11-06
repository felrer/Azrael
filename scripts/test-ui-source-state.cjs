'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { getDirectoryState } = require('./directory-state.cjs');
const { getUiSourceState } = require('./ui-source-state.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azrael-ui-observation-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true });
    assert.equal(fs.existsSync(root), false);
  });
  const source = path.join(root, 'source'); fs.mkdirSync(source);
  const file = path.join(source, 'original.txt'); fs.writeFileSync(file, 'original');
  const context = { statePath: path.join(root, 'state.json'), generation: 'first-attempt' };
  const saved = () => JSON.parse(fs.readFileSync(context.statePath, 'utf8'));
  return { root, source, file, context, saved };
}

async function observedReads(operation) {
  const original = fs.promises.open; let reads = 0;
  fs.promises.open = async (...args) => { reads++; return original(...args); };
  try { return { value: await operation(), reads }; }
  finally { fs.promises.open = original; }
}

// Retained: later caller/identity edits can accidentally skip the first full
// validation, mix generations, or replace reuse with repeated content reads.
test('UI observation preserves the full identity and avoids repeat source reads across processes', { skip: process.platform !== 'win32' }, async t => {
  const { source, context, saved } = fixture(t);
  const expected = await getDirectoryState(source);
  const first = await observedReads(() => getUiSourceState(source, context));
  assert.deepEqual(first.value, expected); assert.equal(first.reads, 1);
  assert.equal(saved().disposition, 'full');
  const reused = await observedReads(() => getUiSourceState(source, context));
  assert.deepEqual(reused.value, expected); assert.equal(reused.reads, 0);
  const child = execFileSync(process.execPath, ['-e',
    'require(process.argv[1]).getUiSourceState(process.argv[2],JSON.parse(process.argv[3])).then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exitCode=1})',
    require.resolve('./ui-source-state.cjs'), source, JSON.stringify(context)], { encoding: 'utf8', windowsHide: true });
  assert.deepEqual(JSON.parse(child), expected); assert.equal(saved().disposition, 'reused');
  assert.equal((await observedReads(() => getUiSourceState(source))).reads, 1, 'standalone default still reads contents');
});

test('ordinary source changes, restored mtime and root replacement invalidate UI reuse', { skip: process.platform !== 'win32' }, async t => {
  const { root, source, file, context, saved } = fixture(t);
  await getUiSourceState(source, context);
  const original = fs.statSync(file); fs.writeFileSync(file, 'modified'); fs.utimesSync(file, original.atime, original.mtime);
  const changed = await observedReads(() => getUiSourceState(source, context));
  assert.equal(changed.reads, 1); assert.deepEqual(changed.value, await getDirectoryState(source));
  for (const mutate of [
    () => fs.renameSync(file, path.join(source, 'renamed.txt')),
    () => fs.writeFileSync(path.join(source, 'added.txt'), 'new'),
    () => fs.unlinkSync(path.join(source, 'added.txt')),
    () => { fs.renameSync(source, path.join(root, 'retired')); fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'renamed.txt'), 'modified'); },
  ]) {
    mutate(); const current = await observedReads(() => getUiSourceState(source, context));
    assert.ok(current.reads > 0); assert.deepEqual(current.value, await getDirectoryState(source));
    assert.equal(saved().disposition, 'full');
  }
});

test('generation and damaged state require full validation; shared contents are always hashed', { skip: process.platform !== 'win32' }, async t => {
  const { source, file, context, saved } = fixture(t);
  await getUiSourceState(source, context);
  for (const mutate of [
    () => { context.generation = 'next-attempt'; },
    () => fs.writeFileSync(context.statePath, '{invalid'),
    () => { const s = saved(); s.binding = 'wrong-tool'; fs.writeFileSync(context.statePath, JSON.stringify(s)); },
    () => { const s = saved(); s.directory.bytes++; fs.writeFileSync(context.statePath, JSON.stringify(s)); },
  ]) {
    mutate(); assert.equal((await observedReads(() => getUiSourceState(source, context))).reads, 1);
    assert.equal(saved().disposition, 'full');
  }
  fs.writeFileSync(path.join(source, 'ordinary.txt'), 'unshared');
  fs.linkSync(file, path.join(source, 'shared.txt'));
  assert.throws(() => require('./engine-source-metadata.cjs').observe(source, []), /Shared/, 'engine observer keeps its original shared-file fallback');
  const shared = await observedReads(() => getUiSourceState(source, context));
  assert.equal(shared.reads, 5); assert.deepEqual(shared.value, await getDirectoryState(source));
  assert.equal((await observedReads(() => getUiSourceState(source, context))).reads, 2);
  assert.equal(saved().disposition, 'reused');
  const initialShared = fs.statSync(file);
  fs.writeFileSync(path.join(source, 'shared.txt'), 'external');
  fs.utimesSync(file, initialShared.atime, initialShared.mtime);
  const edited = await observedReads(() => getUiSourceState(source, context));
  assert.equal(edited.reads, 5); assert.deepEqual(edited.value, await getDirectoryState(source));
  assert.equal(saved().disposition, 'full');
  const bad = { statePath: path.join(source, 'must-not-be-created.json'), generation: 'invalid-location' };
  await getUiSourceState(source, bad); assert.equal(fs.existsSync(bad.statePath), false);
});

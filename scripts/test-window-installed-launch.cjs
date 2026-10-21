'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { createWindowOwner } = require('./window-control-policy.cjs');

test('installed package launch reaches the managed route without observing or selecting a parent window', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'window-installed-launch-'));
  t.after(() => fs.rm(home, { recursive: true }));
  const calls = [];
  const owner = createWindowOwner({ codexHome: home, occupancyDirectory: path.join(home, 'occupancy'), authorize: async () => true,
    backend: { request() { assert.fail('Installed package launch must not enumerate or manipulate parent windows'); } },
    isolation: async (...args) => { calls.push(args); return { ok: true, targetId: 'owned-child-target' }; } });
  const request = { packageName: 'Microsoft.Paint', applicationId: 'App' };
  assert.deepEqual(await owner.call('thread', 'launch_isolated', request), { ok: true, targetId: 'owned-child-target' });
  assert.deepEqual(calls, [['launch_isolated', 'thread', request, undefined]]);
  for (const invalid of [
    {}, { packageName: 'Microsoft.Paint', targetId: 'forged' },
    { packageName: 'Microsoft.*' }, { packageName: '../Paint' }, { packageName: 'C:\\Paint.exe' },
    { packageName: 'Microsoft.Paint', executable: 'C:\\Paint.exe' },
    { packageName: 'Microsoft.Paint', arguments: ['--anything'] },
    { packageName: 'Microsoft.Paint', applicationId: '*' }, { targetId: 'forged', applicationId: 'App' },
    { packageName: null }, { packageName: '' }
  ]) await assert.rejects(owner.call('thread', 'launch_isolated', invalid), { code: 'invalid_request' });
  await assert.rejects(owner.call('thread', 'launch_isolated', { targetId: 'forged' }));
  assert.equal(calls.length, 1, 'Rejected identities must never reach the launch adapter');
  await assert.rejects(owner.call('thread', 'capture_isolated', { packageName: 'Microsoft.Paint' }));
  await assert.rejects(owner.call('thread', 'input_isolated', { packageName: 'Microsoft.Paint', observationId: 'old', input: {} }));
});

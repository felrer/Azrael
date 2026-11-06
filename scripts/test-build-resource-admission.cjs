"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { MINIMUM_FREE_BYTES: minimum, POLL_MS, waitForBuildMemory, waitForBuildMemorySync } = require('./build-resource-admission.cjs');

// Retain the boundary checks: later scheduling edits must not turn admission
// into a timeout, start below the threshold, or cancel already running work.
test('sync admission waits below 4 GiB and admits exactly 4 GiB', () => {
  const messages = [], samples = [minimum - 1, minimum - 1, minimum];
  let sleeps = 0, started = false;
  waitForBuildMemorySync({ readMemory: () => { assert.equal(started, false); return samples.shift(); },
    sleep: ms => { assert.equal(ms, POLL_MS); sleeps++; }, log: text => messages.push(text) });
  started = true;
  assert.equal(started, true); assert.equal(sleeps, 2);
  assert.equal(messages.length, 2); assert.match(messages[0], /Waiting/); assert.match(messages[1], /Starting/);
  waitForBuildMemorySync({ readMemory: () => minimum, sleep: () => assert.fail('unnecessary delay'), log: () => assert.fail('unnecessary message') });
});

test('async admission keeps new work pending and admits when memory recovers', async () => {
  let free = minimum - 1, release;
  const waiting = waitForBuildMemory({ readMemory: () => free, sleep: ms => { assert.equal(ms, POLL_MS); return new Promise(resolve => { release = resolve; }); }, log: () => {} });
  let started = false; const work = waiting.then(() => { started = true; });
  await Promise.resolve(); assert.equal(started, false);
  free = minimum; release(); await work; assert.equal(started, true);
});

test('memory read failures prevent admission; cancellation leaves new work unstarted', async () => {
  for (const value of [NaN, Infinity, -1, undefined]) {
    assert.throws(() => waitForBuildMemorySync({ readMemory: () => value }), /Cannot read/);
    await assert.rejects(waitForBuildMemory({ readMemory: () => value }), /Cannot read/);
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(waitForBuildMemory({ signal: controller.signal, readMemory: () => minimum }), { name: 'AbortError' });
});

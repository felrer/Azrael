'use strict';
// Pure metadata checks only: importing the harness cannot launch the fixture or native backend.
const assert = require('node:assert/strict');
const { protectedCodeWindow, protectedCodeIdentities } = require('../../test-selected-window-native.cjs');
const flags = [0x08000000, 0x8, 0x20];
const overlay = { pid: 11, visible: true, minimized: false, className: 'Chrome_WidgetWin_1', popup: true, ownerHwnd: '0x0', extendedStyle: flags.reduce((a, b) => a | b, 0) };
assert.equal(protectedCodeWindow(overlay), false);
assert.equal(protectedCodeWindow({ ...overlay, extendedStyle: overlay.extendedStyle | 0x80 }), false);
for (let mask = 0; mask < 7; mask++) {
  const extendedStyle = flags.reduce((value, flag, bit) => value | ((mask & (1 << bit)) ? flag : 0), 0);
  assert.equal(protectedCodeWindow({ ...overlay, extendedStyle }), true, 'Partial overlay flag mask ' + mask);
}
for (const key of ['visible', 'className', 'popup', 'ownerHwnd', 'extendedStyle']) {
  const missing = { ...overlay }; delete missing[key];
  assert.equal(protectedCodeWindow(missing), true, 'Missing ' + key);
}
for (const change of [{ className: 'Unknown' }, { className: '' }, { popup: false }, { ownerHwnd: '0x1234' }, { ownerHwnd: null }, { extendedStyle: String(overlay.extendedStyle) }]) {
  assert.equal(protectedCodeWindow({ ...overlay, ...change }), true);
}
assert.equal(protectedCodeWindow({ visible: true }), true, 'Unknown visible window');
const normal = { ...overlay, pid: 22, popup: false };
const minimized = { ...normal, pid: 33, minimized: true };
assert.equal(protectedCodeWindow(minimized), true, 'Minimized workspace');
const hidden = { ...normal, pid: 44, visible: false };
assert.equal(protectedCodeWindow(hidden), false);
const baseline = { codeWindows: [overlay, normal, minimized, hidden], codeProcesses: [11, 22, 33, 44, 55].map(pid => ({ pid })) };
const protectedBaseline = protectedCodeIdentities(baseline);
assert.deepEqual(protectedBaseline.windows, [normal, minimized]);
assert.deepEqual(protectedBaseline.processes.map(process => process.pid), [22, 33]);
assert.equal(baseline.codeProcesses.length, 5, 'Full PID inventory retained for fixture overlap checks');
assert.equal(baseline.codeWindows.length, 4, 'Full window inventory retained');
console.log('Native desktop guard pure checks passed; no GUI/native operation executed.');

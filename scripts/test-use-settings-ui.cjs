'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { createUseSettingsStore, AzraelWindowControlLauncher } = require('./inject-window-control.cjs');
function fixture() {
  const calls = [], timeouts = new Map(), intervals = new Map(); let serial = 0, receive, unsubscribed = false;
  const timing = { setTimeout: fn => { timeouts.set(++serial, fn); return serial; }, clearTimeout: id => timeouts.delete(id), setInterval: fn => { intervals.set(++serial, fn); return serial; }, clearInterval: id => intervals.delete(id) };
  const store = createUseSettingsStore({ subscribe: (type, fn) => { assert.equal(type, 'azrael-use-settings-state'); receive = fn; return () => unsubscribed = true; }, dispatchMessage: (...args) => calls.push(args) }, 'client', timing);
  const settings = { schema: 1, revision: 0, computerUseEnabled: true, windowUseAllowAll: false, computerUseGeneration: 0, windowUseGeneration: 0 };
  return { store, calls, timeouts, intervals, settings, receive: m => receive({ clientId: 'client', requestId: calls.at(-1)[1].requestId, settings, approvedApps: [], ...m }), get unsubscribed() { return unsubscribed; } };
}
test('store saves only host acknowledged flags and renders host failures with retry', () => {
  const f = fixture(); assert.equal(f.store.getSnapshot().loading, true);
  f.receive({ clientId: 'other' }); assert.equal(f.store.getSnapshot().loading, true);
  f.receive({}); f.store.update({ computerUseEnabled: false }); assert.equal(f.store.getSnapshot().settings.computerUseEnabled, true); assert.equal(f.store.getSnapshot().saving, true);
  assert.deepEqual(f.calls.at(-1), ['azrael-use-settings', { clientId: 'client', requestId: f.calls.at(-1)[1].requestId, action: 'update', patch: { computerUseEnabled: false }, expectedRevision: 0 }]);
  f.receive({ error: 'conflict' }); assert.equal(f.store.getSnapshot().settings.computerUseEnabled, true); assert.equal(f.store.getSnapshot().error, 'conflict');
  f.store.retry(); f.receive({ settings: { ...f.settings, revision: 3, computerUseEnabled: false } }); assert.equal(f.store.getSnapshot().settings.computerUseEnabled, false); f.store.dispose();
});
test('bounded polling, response timeout, and disposal own all subscriptions and timers', () => {
  const f = fixture(); f.receive({}); [...f.intervals.values()][0](); assert.equal(f.calls.at(-1)[1].action, 'read');
  const [timeoutId, fire] = [...f.timeouts.entries()][0]; f.timeouts.delete(timeoutId); fire(); assert.equal(f.store.getSnapshot().loading, false); assert.match(f.store.getSnapshot().error, /응답/);
  f.store.retry(); f.receive({ error: 'host unavailable', settings: undefined }); assert.equal(f.store.getSnapshot().saving, false);
  f.store.dispose(); assert.equal(f.unsubscribed, true); assert.equal(f.timeouts.size, 0); assert.equal(f.intervals.size, 0);
});
test('native component initializes lazily and passes row aria props, switch booleans, and secondary button props', () => {
  const f = fixture(); f.receive({ approvedApps: [{ displayName: 'Example', bundleIdentifier: 'c:\\apps\\example.exe' }] });
  const initializers = [], effects = [];
  const context = vm.createContext({ Q: { useState: () => [f.store], useEffect: fn => effects.push(fn), useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot() }, crypto: { randomUUID: () => 'client' },
    initAzraelUseCard: () => initializers.push('card'), initAzraelUseRow: () => initializers.push('row'), initAzraelUseSwitch: () => initializers.push('switch'), initAzraelUseButton: () => initializers.push('button'),
    AzraelUseCard: 'NativeCard', AzraelUseRow: 'NativeRow', AzraelUseSwitch: 'NativeSwitch', AzraelUseButton: 'NativeButton',
    $: { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) } });
  vm.runInContext(AzraelWindowControlLauncher.toString(), context); assert.equal(initializers.length, 0);
  const root = context.AzraelWindowControlLauncher(); assert.deepEqual(initializers, ['card','row','switch','button']);
  const cuSwitch = root.props.children[0].props.children.props.control({ 'aria-labelledby': 'cu' }); assert.equal(cuSwitch.type, 'NativeSwitch'); assert.equal(cuSwitch.props['aria-labelledby'], 'cu');
  cuSwitch.props.onChange(false); assert.equal(f.calls.at(-1)[1].patch.computerUseEnabled, false); f.receive({});
  const wu = root.props.children[1]; const wuSwitch = wu.props.children[1].props.children.props.control({}); assert.equal(wuSwitch.props.checked, false);
  wuSwitch.props.onChange(true); assert.equal(f.calls.at(-1)[1].patch.windowUseAllowAll, true); f.receive({});
  const add = wu.props.children[2].props.children[0].props.control({}); assert.equal(add.type, 'NativeButton'); assert.equal(add.props.color, 'secondary'); assert.equal(add.props.size, 'default'); add.props.onClick(); assert.equal(f.calls.at(-1)[1].action, 'addApp'); f.receive({});
  const remove = wu.props.children[2].props.children[1].props.control({}); remove.props.onClick(); assert.equal(f.calls.at(-1)[1].bundleIdentifier, 'c:\\apps\\example.exe');
  effects[0]()(); assert.equal(f.unsubscribed, true);
});
test('late timed-out replies cannot complete or overwrite the active request', () => {
  const f = fixture(); const initialReadId = f.calls.at(-1)[1].requestId;
  const [timeoutId, fire] = [...f.timeouts.entries()][0]; f.timeouts.delete(timeoutId); fire();
  f.store.retry(); const retryId = f.calls.at(-1)[1].requestId; assert.notEqual(retryId, initialReadId);
  f.receive({ requestId: initialReadId, settings: { ...f.settings, computerUseEnabled: false } });
  assert.equal(f.store.getSnapshot().loading, true); assert.equal(f.store.getSnapshot().settings, null);
  f.receive({}); f.store.update({ computerUseEnabled: false }); const updateId = f.calls.at(-1)[1].requestId;
  f.receive({ requestId: retryId, settings: { ...f.settings, revision: 99, computerUseEnabled: true } });
  assert.equal(f.store.getSnapshot().saving, true); assert.equal(f.store.getSnapshot().settings.revision, 0);
  f.receive({ requestId: updateId, settings: { ...f.settings, revision: 1, computerUseEnabled: false } });
  assert.equal(f.store.getSnapshot().saving, false); assert.equal(f.store.getSnapshot().settings.computerUseEnabled, false);
  f.store.dispose();
});
test('first dispatch accepts synchronous bridge acknowledgment and owns no pending timeout', () => {
  let receive; const timeouts = new Map(); let serial = 0;
  const timing = { setTimeout: fn => { timeouts.set(++serial, fn); return serial; }, clearTimeout: id => timeouts.delete(id), setInterval: () => 7, clearInterval() {} };
  const settings = { schema: 1, revision: 0, computerUseEnabled: true, windowUseAllowAll: false };
  const store = createUseSettingsStore({ subscribe: (_type, fn) => { receive = fn; return () => {}; }, dispatchMessage: (_type, request) => receive({ clientId: request.clientId, requestId: request.requestId, settings, approvedApps: [] }) }, 'sync-client', timing, () => 'opaque-request');
  assert.equal(store.getSnapshot().loading, false); assert.equal(store.getSnapshot().settings.computerUseEnabled, true); assert.equal(timeouts.size, 0); store.dispose();
});
test('Computer Use OFF immediately preempts a held quiet poll without optimistic flags', () => {
  const f = fixture(); f.receive({ settings: { ...f.settings, revision: 4 } });
  [...f.intervals.values()][0](); const pollId = f.calls.at(-1)[1].requestId; const [pollTimer, pollTimeout] = [...f.timeouts.entries()][0];
  assert.equal(f.store.getSnapshot().loading, false); assert.equal(f.store.getSnapshot().saving, false);
  f.store.update({ computerUseEnabled: false }); const update = f.calls.at(-1)[1];
  assert.equal(update.action, 'update'); assert.equal(update.expectedRevision, 4); assert.notEqual(update.requestId, pollId);
  assert.equal(f.timeouts.has(pollTimer), false); assert.equal(f.timeouts.size, 1);
  assert.equal(f.store.getSnapshot().saving, true); assert.equal(f.store.getSnapshot().settings.computerUseEnabled, true);
  f.receive({ requestId: pollId, settings: { ...f.settings, revision: 5, computerUseEnabled: true } }); pollTimeout();
  assert.equal(f.store.getSnapshot().saving, true); assert.equal(f.store.getSnapshot().settings.revision, 4);
  const count = f.calls.length; f.store.addApp(); f.store.removeApp('c:\\app.exe'); f.store.open(); f.store.update({ windowUseAllowAll: true }); assert.equal(f.calls.length, count);
  f.receive({ settings: { ...f.settings, revision: 5, computerUseEnabled: false } });
  assert.equal(f.store.getSnapshot().saving, false); assert.equal(f.store.getSnapshot().settings.computerUseEnabled, false); f.store.dispose();
});
test('preempted quiet poll preserves visible CAS conflicts and next acknowledged revision', () => {
  const f = fixture(); f.receive({}); [...f.intervals.values()][0](); const pollId = f.calls.at(-1)[1].requestId;
  f.store.update({ computerUseEnabled: false }); assert.equal(f.calls.at(-1)[1].expectedRevision, 0);
  f.receive({ error: 'Settings revision conflict', settings: { ...f.settings, revision: 2 } });
  assert.match(f.store.getSnapshot().error, /revision conflict/); assert.equal(f.store.getSnapshot().settings.computerUseEnabled, true);
  f.receive({ requestId: pollId, settings: { ...f.settings, revision: 1 } }); assert.equal(f.store.getSnapshot().settings.revision, 2); assert.match(f.store.getSnapshot().error, /revision conflict/);
  f.store.update({ computerUseEnabled: false }); assert.equal(f.calls.at(-1)[1].expectedRevision, 2); f.store.dispose();
});
test('add, remove, and open preempt quiet polls and never replay after timeout or close', () => {
  for (const action of ['addApp','removeApp','open']) {
    const f = fixture(); f.receive({}); [...f.intervals.values()][0](); const pollId = f.calls.at(-1)[1].requestId;
    f.store[action]('c:\\app.exe'); const request = f.calls.at(-1)[1]; assert.equal(request.action, action); assert.notEqual(request.requestId, pollId); assert.equal(f.store.getSnapshot().saving, true);
    if (action === 'removeApp') assert.equal(request.bundleIdentifier, 'c:\\app.exe');
    f.receive({ requestId: pollId }); assert.equal(f.store.getSnapshot().saving, true);
    const [id, fire] = [...f.timeouts.entries()][0]; f.timeouts.delete(id); fire(); const count = f.calls.length;
    f.receive({ requestId: request.requestId }); [...f.intervals.values()][0](); assert.equal(f.calls.length, count); assert.match(f.store.getSnapshot().error, /응답/);
    f.store.dispose(); f.receive({ requestId: pollId }); f.store[action]('c:\\app.exe'); assert.equal(f.calls.length, count); assert.equal(f.timeouts.size, 0);
  }
});

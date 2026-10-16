'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createSettingsHost, unavailable } = require('./use-settings-host.cjs');
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'azrael-use-settings-')); t.after(() => fs.rmSync(home, { recursive: true }));
  const settingsOwner = require('./use-control-settings.cjs').createSettingsOwner(home);
  const approvals = require('./window-use-approvals.cjs').createOwner(home);
  const w = { hwnd: '1', pid: 4, processCreated: '2026', executable: 'C:\\Apps\\Example.exe', title: 'Example' };
  let windows = [w], pick = choices => choices[0], confirmation = '삭제', opened = 0;
  const replies = [], web = { postMessage: async m => replies.push(m) };
  const host = createSettingsHost({ runtime: { codexHome: home }, settingsOwner, approvals, backend: { request: async method => { assert.equal(method, 'listWindows'); return windows; } }, vscode: { window: { showQuickPick: async choices => pick(choices), showWarningMessage: async () => confirmation } }, open: () => opened++ });
  t.after(() => host.dispose());
  const send = async (action, args = {}) => { await host.receive(web, { type: 'azrael-use-settings', clientId: 'client', requestId: 'request', action, ...args }); return replies.at(-1); };
  return { send, host, web, replies, approvals, settingsOwner, home, w, setWindows: x => windows = x, setPick: x => pick = x, setConfirmation: x => confirmation = x, get opened() { return opened; } };
}
test('host acknowledges shared settings and rejects stale revisions and forged request fields', async t => {
  const f = fixture(t); const read = await f.send('read'); assert.equal(read.requestId, 'request'); assert.equal(read.settings.windowUseEnabled, true);
  let state = await f.send('update', { patch: { windowUseEnabled: false, windowUseAllowAll: true }, expectedRevision: 0 });
  assert.equal(state.settings.windowUseEnabled, false); assert.equal(state.settings.windowUseAllowAll, true);
  const other = require('./use-control-settings.cjs').createSettingsOwner(f.home); other.updateSettings({ windowUseAllowAll: false }, 1);
  assert.equal((await f.send('read')).settings.windowUseAllowAll, false);
  state = await f.send('update', { patch: { windowUseEnabled: true }, expectedRevision: 0 }); assert.match(state.error, /revision conflict/); assert.equal(state.settings.windowUseEnabled, false);
  assert.match((await f.send('addApp', { executable: 'C:\\Forged.exe' })).error, /Invalid/);
  assert.match((await f.send('update', { patch: { windowUseEnabled: 1 }, expectedRevision: 2 })).error, /Invalid/);
  assert.match((await f.send('surprise')).error, /Invalid/);
  assert.match((await f.send('read', { type: 'forged-envelope' })).error, /Invalid/);
  assert.match((await f.send('read', { type: undefined })).error, /Invalid/);
});
test('trusted picker grants fresh exact process identity only and keeps Computer Use grants separate', async t => {
  const f = fixture(t); await f.send('addApp');
  assert.equal(f.approvals.getPersistentAppApprovals().approvedApps.length, 1);
  const cu = require('./computer-use-approvals.cjs').createOwner(f.home); assert.equal(cu.getAppApprovals().approvedApps.length, 0);
  f.setPick(choices => ({ ...choices[0], description: 'C:\\Forged.exe', executable: 'C:\\Forged.exe' })); await f.send('addApp');
  assert.equal(f.approvals.getPersistentAppApprovals().approvedApps[0].bundleIdentifier, f.w.executable.toLowerCase());
  f.setPick(() => ({ id: 'forged' })); assert.match((await f.send('addApp')).error, /not enumerated/);
  f.setPick(choices => { f.setWindows([{ ...f.w, processCreated: 'new-process' }]); return choices[0]; }); assert.match((await f.send('addApp')).error, /changed/);
});
test('removal requires current entry and native confirmation; opening is independent of turn state', async t => {
  const f = fixture(t); await f.send('addApp'); const app = f.approvals.getPersistentAppApprovals().approvedApps[0];
  assert.match((await f.send('removeApp', { bundleIdentifier: 'C:\\Forged.exe', source: 'window' })).error, /Unknown/);
  f.setConfirmation(undefined); await f.send('removeApp', { bundleIdentifier: app.bundleIdentifier, source: 'window' }); assert.equal(f.approvals.getPersistentAppApprovals().approvedApps.length, 1);
  f.setConfirmation('삭제'); await f.send('removeApp', { bundleIdentifier: app.bundleIdentifier, source: 'window' }); assert.equal(f.approvals.getPersistentAppApprovals().approvedApps.length, 0);
  await f.send('open'); assert.equal(f.opened, 1);
});
test('unavailable and disposed hosts respond safely without retaining webviews', async t => {
  const f = fixture(t); await unavailable(f.web, { clientId: 'client', requestId: 'request' }); assert.match(f.replies.at(-1).error, /unavailable/);
  await f.host.receive(f.web, { clientId: 'x'.repeat(129), requestId: 'request', action: 'read' }); assert.equal(f.replies.length, 1);
  await f.host.receive(f.web, { clientId: 'client', requestId: 'x'.repeat(129), action: 'read' }); assert.equal(f.replies.length, 1);
  await f.host.receive(f.web, { clientId: 'client', action: 'read' }); assert.equal(f.replies.length, 1);
  f.setPick(choices => { f.host.dispose(); return choices[0]; }); await f.send('addApp'); assert.equal(f.approvals.getPersistentAppApprovals().approvedApps.length, 0);
});
test('production store uses the actual bridge envelope for initial read and acknowledged update', async t => {
  const f = fixture(t);
  const { createUseSettingsStore } = require('./inject-window-control.cjs');
  let receive; const pending = [], envelopes = [];
  f.web.postMessage = async message => { f.replies.push(message); receive(message); };
  const bridge = {
    subscribe(type, listener) { assert.equal(type, 'azrael-use-settings-state'); receive = listener; return () => {}; },
    dispatchMessage(type, payload) { const envelope = { ...payload, type }; envelopes.push(envelope); pending.push(f.host.receive(f.web, envelope)); }
  };
  const store = createUseSettingsStore(bridge, 'production-bridge-client'); t.after(() => store.dispose());
  await Promise.all(pending.splice(0));
  assert.equal(envelopes[0].type, 'azrael-use-settings'); assert.equal(envelopes[0].action, 'read');
  assert.equal(store.getSnapshot().error, null); assert.equal(store.getSnapshot().loading, false); assert.equal(store.getSnapshot().settings.windowUseEnabled, true);
  store.update({ windowUseEnabled: false }); await Promise.all(pending.splice(0));
  assert.equal(envelopes[1].action, 'update'); assert.notEqual(envelopes[1].requestId, envelopes[0].requestId);
  assert.equal(store.getSnapshot().error, null); assert.equal(store.getSnapshot().saving, false); assert.equal(store.getSnapshot().settings.windowUseEnabled, false);
  assert.equal(f.settingsOwner.getSettings().windowUseEnabled, false);
});
test('unified app rows preserve backend source and remove only the explicitly selected persistent grant', async t => {
  const f = fixture(t), desktop = require('./computer-use-approvals.cjs').createOwner(f.home);
  await f.send('addApp');
  const exact = f.approvals.getPersistentAppApprovals().approvedApps[0].bundleIdentifier;
  desktop.addAppApproval(exact, 'Desktop fixture'); desktop.addAppApproval('ambiguous legacy app', 'Legacy');
  let state = await f.send('read');
  assert.equal(state.approvedApps.length, 3);
  assert.deepEqual(state.approvedApps.filter(app => app.bundleIdentifier === exact).map(app => app.source), ['window', 'desktop']);
  assert.equal(f.approvals.hasAppApproval('C:\\Apps\\ambiguous legacy app.exe', 'thread'), false, 'legacy names do not become executable aliases');
  for (const source of [undefined, 'forged', '__proto__']) assert.match((await f.send('removeApp', { bundleIdentifier: exact, ...(source ? { source } : {}) })).error, /Unknown/);
  assert.equal(desktop.getPersistentAppApprovals().approvedApps.length, 2);
  await f.send('removeApp', { bundleIdentifier: exact, source: 'desktop' });
  assert.equal(f.approvals.getPersistentAppApprovals().approvedApps.length, 1); assert.equal(desktop.getPersistentAppApprovals().approvedApps.length, 1);
  await f.send('removeApp', { bundleIdentifier: 'ambiguous legacy app', source: 'desktop' });
  assert.deepEqual(desktop.getPersistentAppApprovals().approvedApps, []);
  await f.send('removeApp', { bundleIdentifier: exact, source: 'window' });
  state = await f.send('read'); assert.deepEqual(state.approvedApps, []);
});

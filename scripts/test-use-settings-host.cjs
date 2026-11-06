'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createSettingsHost, unavailable } = require('./use-settings-host.cjs');
function fixture(t) {
  const root = process.env.AZRAEL_WINDOW_SETTINGS_TEST_ROOT;
  if (!root || !path.isAbsolute(root)) throw new Error('Set an owned absolute AZRAEL_WINDOW_SETTINGS_TEST_ROOT before filesystem tests');
  fs.mkdirSync(root, { recursive: true });
  const home = fs.mkdtempSync(path.join(root, 'host-'));
  const settingsOwner = require('./use-control-settings.cjs').createSettingsOwner(home);
  const approvals = require('./window-use-approvals.cjs').createOwner(home);
  const w = { hwnd: '1', pid: 4, processCreated: '2026', executable: 'C:\\Apps\\Example.exe', title: 'Example' };
  let windows = [w], pick = choices => choices[0], confirmation = '제거', opened = 0;
  const replies = [], web = { postMessage: async m => replies.push(m) };
  const host = createSettingsHost({ runtime: { codexHome: home }, settingsOwner, approvals, backend: { request: async method => { assert.equal(method, 'listWindows'); return windows; } }, vscode: { window: { showQuickPick: async choices => pick(choices), showWarningMessage: async () => typeof confirmation === 'function' ? confirmation() : confirmation } }, open: () => opened++ });
  t.after(() => host.dispose());
  const send = async (action, args = {}) => { await host.receive(web, { type: 'azrael-use-settings', clientId: 'client', requestId: 'request', action, ...args }); return replies.at(-1); };
  return { send, host, web, replies, approvals, settingsOwner, home, w, setWindows: x => windows = x, setPick: x => pick = x, setConfirmation: x => confirmation = x, get opened() { return opened; } };
}
test('host acknowledges shared settings and rejects stale revisions and forged request fields', async t => {
  const f = fixture(t); const read = await f.send('read'); assert.equal(read.requestId, 'request'); assert.equal(read.settings.windowUseEnabled, true);
  let state = await f.send('update', { patch: { windowUseEnabled: false, controlAllowedApps: ['C:\\Apps\\Example.exe'] }, expectedRevision: 0 });
  assert.equal(state.settings.windowUseEnabled, false); assert.deepEqual(state.settings.controlAllowedApps, ['c:\\apps\\example.exe']);
  const other = require('./use-control-settings.cjs').createSettingsOwner(f.home); other.updateSettings({ controlAllowedApps: [] }, 1);
  assert.deepEqual((await f.send('read')).settings.controlAllowedApps, []);
  state = await f.send('update', { patch: { windowUseEnabled: true }, expectedRevision: 0 }); assert.match(state.error, /revision conflict/); assert.equal(state.settings.windowUseEnabled, false);
  assert.match((await f.send('addApp', { executable: 'C:\\Forged.exe' })).error, /Invalid/);
  assert.match((await f.send('update', { patch: { windowUseEnabled: 1 }, expectedRevision: 2 })).error, /Invalid/);
  assert.match((await f.send('surprise')).error, /Invalid/);
  assert.match((await f.send('read', { type: 'forged-envelope' })).error, /Invalid/);
  assert.match((await f.send('read', { type: undefined })).error, /Invalid/);
});
test('trusted picker grants fresh exact process identity only and keeps Computer Use grants separate', async t => {
  const f = fixture(t); await f.send('addApp', { list: 'controlAllowedApps' });
  assert.equal(f.approvals.getPersistentAppApprovals().approvedApps.length, 1);
  assert.equal(fs.existsSync(path.join(f.home, 'azrael', 'computer-use', 'app-approvals.json')), false);
  f.setPick(choices => ({ ...choices[0], description: 'C:\\Forged.exe', executable: 'C:\\Forged.exe' })); await f.send('addApp', { list: 'controlAllowedApps' });
  assert.equal(f.approvals.getPersistentAppApprovals().approvedApps[0].bundleIdentifier, f.w.executable.toLowerCase());
  f.setPick(() => ({ id: 'forged' })); assert.match((await f.send('addApp', { list: 'controlAllowedApps' })).error, /not enumerated/);
  f.setPick(choices => { f.setWindows([{ ...f.w, processCreated: 'new-process' }]); return choices[0]; }); assert.match((await f.send('addApp', { list: 'controlAllowedApps' })).error, /changed/);
});
test('removal requires current entry and native confirmation; opening is independent of turn state', async t => {
  const f = fixture(t); await f.send('addApp', { list: 'controlAllowedApps' }); const app = f.approvals.getPersistentAppApprovals().approvedApps[0];
  assert.match((await f.send('removeApp', { bundleIdentifier: 'C:\\Forged.exe', source: 'controlAllowedApps' })).error, /Unknown/);
  f.setConfirmation(undefined); await f.send('removeApp', { bundleIdentifier: app.bundleIdentifier, source: 'controlAllowedApps' }); assert.equal(f.approvals.getPersistentAppApprovals().approvedApps.length, 1);
  f.setConfirmation('제거'); await f.send('removeApp', { bundleIdentifier: app.bundleIdentifier, source: 'controlAllowedApps' }); assert.equal(f.approvals.getPersistentAppApprovals().approvedApps.length, 0);
  await f.send('open'); assert.equal(f.opened, 1);
});
test('unavailable and disposed hosts respond safely without retaining webviews', async t => {
  const f = fixture(t); await unavailable(f.web, { clientId: 'client', requestId: 'request' }); assert.match(f.replies.at(-1).error, /unavailable/);
  await f.host.receive(f.web, { clientId: 'x'.repeat(129), requestId: 'request', action: 'read' }); assert.equal(f.replies.length, 1);
  await f.host.receive(f.web, { clientId: 'client', requestId: 'x'.repeat(129), action: 'read' }); assert.equal(f.replies.length, 1);
  await f.host.receive(f.web, { clientId: 'client', action: 'read' }); assert.equal(f.replies.length, 1);
  f.setPick(choices => { f.host.dispose(); return choices[0]; }); await f.send('addApp', { list: 'controlAllowedApps' }); assert.equal(f.approvals.getPersistentAppApprovals().approvedApps.length, 0);
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

test('approval settings requires explicit save and fresh process, request and policy identity', async t => {
  const f = fixture(t);
  const options = { list: 'observationBlockedApps', descriptor: f.w, isCurrent: () => true };
  f.setConfirmation(undefined); await f.host.openApprovalSettings(options);
  assert.deepEqual(f.settingsOwner.getSettings().observationBlockedApps, []);
  f.setConfirmation('저장'); await f.host.openApprovalSettings(options);
  assert.deepEqual(f.settingsOwner.getSettings().observationBlockedApps, [f.w.executable.toLowerCase()]);
  await assert.rejects(f.host.openApprovalSettings({ ...options, isCurrent: () => false }), /request changed/);
  f.setPick(choices => { f.setWindows([{ ...f.w, processCreated: 'replaced' }]); return choices[0]; });
  await assert.rejects(f.host.openApprovalSettings({ ...options, list: 'controlAllowedApps' }), /window changed/);
  assert.deepEqual(f.settingsOwner.getSettings().controlAllowedApps, []);
  f.setWindows([f.w]); f.setPick(choices => { const current = f.settingsOwner.getSettings(); f.settingsOwner.updateSettings({ controlAllowedApps: [] }, current.revision); return choices[0]; });
  await assert.rejects(f.host.openApprovalSettings({ ...options, list: 'controlAllowedApps' }), /revision conflict/);
});

test('approval settings global picker has no fabricated application and preselects exact current app', async () => {
  let picks = [], confirmations = 0, written;
  const app = { hwnd: '1', pid: 8, processCreated: 'now', executable: 'C:\\Apps\\Current.exe', title: 'Current' };
  const other = { ...app, hwnd: '2', executable: 'C:\\Apps\\Other.exe', title: 'Other' };
  const policy = { observationBlockedApps: [], controlAllowedApps: [], revision: 0 };
  const host = createSettingsHost({ runtime: {}, approvals: {}, settingsOwner: { getSettings: () => policy, updateSettings: (...args) => written = args }, backend: { request: async () => [other, app] }, vscode: { window: {
    createQuickPick() {
      let accept, hide;
      const picker = { items: [], activeItems: [], selectedItems: [], onDidAccept(fn) { accept = fn; return { dispose() {} }; }, onDidHide(fn) { hide = fn; return { dispose() {} }; }, dispose() {}, show() { picks.push(picker); picker.selectedItems = picker.activeItems.length ? picker.activeItems : [picker.items[0]]; accept(); } };
      return picker;
    }, showWarningMessage: async () => { confirmations++; return '저장'; }
  } } });
  await host.openApprovalSettings({ list: 'controlAllowedApps', descriptor: app, isCurrent: () => true });
  assert.equal(picks[0].activeItems[0].label, 'Current'); assert.equal(written[0].controlAllowedApps[0], app.executable);
  await host.openApprovalSettings({ list: 'observationBlockedApps', isCurrent: () => true });
  assert.equal(picks[1].activeItems.length, 0); assert.equal(picks[1].items.length, 2); assert.equal(confirmations, 2);
  host.dispose();
});

test('approval settings removes offline registered apps through their own list with revision and request guards', async t => {
  const f = fixture(t), exact = f.w.executable.toLowerCase();
  await f.send('addApp', { list: 'controlAllowedApps' });
  await f.send('addApp', { list: 'observationBlockedApps' });
  f.setWindows([]);
  f.setPick(choices => { assert.equal(choices.length, 1); assert.equal(choices[0].description, exact); assert.match(choices[0].detail, /실행 중이지/); return choices[0]; });
  const context = { list: 'observationBlockedApps', isCurrent: () => true };
  f.setConfirmation(undefined); await f.host.openApprovalSettings(context);
  assert.deepEqual(f.settingsOwner.getSettings().observationBlockedApps, [exact]);
  let pending = true;
  f.setConfirmation(() => { pending = false; return '제거'; });
  await assert.rejects(f.host.openApprovalSettings({ ...context, isCurrent: () => pending }), /request changed/);
  assert.deepEqual(f.settingsOwner.getSettings().observationBlockedApps, [exact]);
  f.setConfirmation(() => { const policy = f.settingsOwner.getSettings(); f.settingsOwner.updateSettings({}, policy.revision); return '제거'; });
  await assert.rejects(f.host.openApprovalSettings(context), /revision conflict/);
  assert.deepEqual(f.settingsOwner.getSettings().observationBlockedApps, [exact]);
  f.setConfirmation('제거'); await f.host.openApprovalSettings(context);
  assert.deepEqual(f.settingsOwner.getSettings().observationBlockedApps, []);
  assert.deepEqual(f.settingsOwner.getSettings().controlAllowedApps, [exact]);
  const removed = [], originalRemove = f.approvals.removeAppApproval;
  f.approvals.removeAppApproval = (...args) => { removed.push(args); return originalRemove(...args); };
  const revision = f.settingsOwner.getSettings().revision;
  await f.host.openApprovalSettings({ list: 'controlAllowedApps', isCurrent: () => true });
  assert.deepEqual(removed, [[exact, 'control', revision]]);
  assert.deepEqual(f.settingsOwner.getSettings().controlAllowedApps, []);
  assert.deepEqual(f.approvals.getPersistentAppApprovals().approvedApps, []);
});

test('whitelist removal preserves legacy grants on stale revision and removes both forms on confirmed save', async t => {
  const f = fixture(t), exact = f.w.executable.toLowerCase();
  const request = { id: 'legacy-grant', method: 'mcpServer/elicitation/request', params: { serverName: 'azrael_window', threadId: 'legacy-thread', _meta: { connector_id: 'window-use', tool_params: { app: exact, permission: 'control' }, persist: ['always'] } } };
  let displayed = false;
  f.approvals.receive(request, () => assert.fail('new grant must require approval'), () => displayed = true);
  assert.equal(displayed, true);
  assert.equal(f.approvals.response(request.id, { action: 'accept', content: { persist: 'always' } }).action, 'accept');
  await f.send('addApp', { list: 'controlAllowedApps' });
  const policy = f.settingsOwner.getSettings(), file = path.join(f.home, 'azrael', 'window-use', 'app-approvals.json');
  const before = fs.readFileSync(file, 'utf8');
  f.settingsOwner.updateSettings({}, policy.revision);
  assert.throws(() => f.approvals.removeAppApproval(exact, 'control', policy.revision), { code: 'REVISION_CONFLICT' });
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'stale removal must not revoke the legacy grant');
  assert.deepEqual(f.settingsOwner.getSettings().controlAllowedApps, [exact]);
  f.setWindows([]); f.setConfirmation('제거');
  await f.host.openApprovalSettings({ list: 'controlAllowedApps', isCurrent: () => true });
  assert.deepEqual(f.settingsOwner.getSettings().controlAllowedApps, []);
  assert.deepEqual(f.approvals.getPersistentAppApprovals().approvedApps, []);
  assert.equal(f.approvals.hasAppApproval(exact, 'legacy-thread', 'control'), false);
});
test('observation blacklist and control whitelist remain independent and remove through their own list', async t => {
  const f = fixture(t), exact = f.w.executable.toLowerCase();
  await f.send('addApp', { list: 'observationBlockedApps' });
  assert.deepEqual(f.settingsOwner.getSettings().observationBlockedApps, [exact]);
  assert.deepEqual(f.approvals.getPersistentAppApprovals().approvedApps, []);
  assert.equal(f.approvals.hasAppApproval(exact, 'thread', 'observation'), false);
  await f.send('addApp', { list: 'controlAllowedApps' });
  assert.deepEqual(f.settingsOwner.getSettings().controlAllowedApps, [exact]);
  assert.equal(f.approvals.hasAppApproval(exact, 'thread', 'control'), false, 'Security App blocks effective control even when independently whitelisted');
  assert.equal(f.approvals.hasAppApproval(exact, 'thread', 'observation'), false);
  await f.send('removeApp', { bundleIdentifier: exact, source: 'observationBlockedApps' });
  assert.deepEqual(f.settingsOwner.getSettings().controlAllowedApps, [exact]);
  assert.equal(f.approvals.hasAppApproval(exact, 'thread', 'control'), true, 'removing the Security App restores the separately stored whitelist authority');
  await f.send('addApp', { list: 'observationBlockedApps' });
  for (const source of [undefined, 'forged', '__proto__']) assert.match((await f.send('removeApp', { bundleIdentifier: exact, ...(source ? { source } : {}) })).error, /Invalid/);
  await f.send('removeApp', { bundleIdentifier: exact, source: 'controlAllowedApps' });
  assert.deepEqual(f.settingsOwner.getSettings().controlAllowedApps, []);
  assert.deepEqual(f.settingsOwner.getSettings().observationBlockedApps, [exact]);
  await f.send('removeApp', { bundleIdentifier: exact, source: 'observationBlockedApps' });
  assert.equal(f.approvals.hasAppApproval(exact, 'thread', 'observation'), true);
});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { EventEmitter } = require('node:events');
test('settings host updates govern a separate Window host while Computer Use is disabled', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'use-settings-integration-'));
  const approvals = require('./window-use-approvals.cjs').createOwner(home);
  const controlApprovals = require('./window-use-approvals.cjs').createOwner(home);
  const revocations = new EventEmitter();
  const stop = controlApprovals.stop;
  t.mock.method(controlApprovals, 'stop', threadId => {
    const result = stop(threadId);
    // Observe the real host listener's completed lease revocation. Do not
    // replace its polling, generation check, or approval owner behavior.
    revocations.emit('revoked', threadId);
    return result;
  });
  const settings = require('./use-control-settings.cjs').createSettingsOwner(home);
  const win = { hwnd: 'fixture', pid: 1, processCreated: 'created', executable: 'C:/fixture/app.exe', title: 'Fixture', minimized: false, widthPx: 800, heightPx: 600, dpi: 96 };
  let calls = 0;
  const backend = { request: async method => { calls++; return method === 'listWindows' ? [win] : win; }, dispose: async () => {} };
  const control = require('./window-control-host.cjs').createHost({ runtime: { codexHome: home }, approvals: controlApprovals, backend, vscode: { window: { showInformationMessage: async () => '취소', showWarningMessage: async () => '허용' } }, createServer: () => { const s = new EventEmitter(); s.listen = (_, done) => done(); s.close = () => {}; return s; } });
  const host = require('./use-settings-host.cjs').createSettingsHost({ runtime: { codexHome: home }, backend, vscode: {}, settingsOwner: settings });
  t.after(async () => { host.dispose(); await control.dispose(); fs.rmSync(home, { recursive: true }); });
  let reply; const web = { postMessage: async value => { reply = value; } };
  const update = async patch => { await host.receive(web, { type: 'azrael-use-settings', clientId: 'integration', requestId: 'opaque-request', action: 'update', patch, expectedRevision: settings.getSettings().revision }); assert.equal(reply.error, undefined); assert.equal(reply.requestId, 'opaque-request'); };
  assert.deepEqual(approvals.getPersistentAppApprovals().approvedApps, []);
  await update({ stage4Enabled: false, windowUseAllowAll: true });
  assert.equal(require('./use-control-settings.cjs').createSettingsOwner(home).getSettings().stage4Enabled, false);
  const native = { registerProvider() { return { dispose() {} }; } }; control.attach(native, () => {});
  const thread = '12345678-1234-1234-1234-123456789abc'; control.observe(native, { method: 'turn/started', params: { threadId: thread, turn: { id: 'turn' } } }); await control.threads.get(thread).ready;
  const nextRevocation = () => {
    let timer, listener;
    const dispose = () => { clearTimeout(timer); revocations.off('revoked', listener); };
    const observed = new Promise((resolve, reject) => {
      listener = threadId => { if (threadId === thread) { dispose(); resolve(); } };
      revocations.on('revoked', listener);
      // A missing live notification fails; the timer never advances the test.
      timer = setTimeout(() => { dispose(); reject(new Error('Host did not revoke the fixture lease after the policy change')); }, 3000);
    });
    return { observed, dispose };
  };
  const call = (tool, args = {}) => control.handlePipe({ nonce: control.nonce, threadId: thread, method: 'call', tool, arguments: args, _meta: { threadId: thread, 'codex/sandbox-state-meta': { permissionProfile: { type: 'disabled' } }, 'x-codex-turn-metadata': { thread_id: thread, turn_id: 'turn' } } });
  const select = async () => { const candidate = (await call('list_windows')).candidates[0]; return call('select_window', { candidateId: candidate.candidateId }); };
  let selected = await select(); await call('status', { targetId: selected.targetId });
  let beforeStage = calls; await assert.rejects(call('resize', { targetId: selected.targetId, widthDip: 800, heightDip: 600 }), { code: 'permission_denied' }); assert.equal(calls, beforeStage, 'all-app grant cannot grant task-stage authority');
  const controlStage = () => call('request_stage', { stage: 2, targetId: selected.targetId, reason: 'Resize this fixture window' });
  assert.equal((await controlStage()).authorized, true);
  const settingsRevoked = nextRevocation();
  let before = calls;
  try { await update({ windowUseAllowAll: false }); await settingsRevoked.observed; }
  finally { settingsRevoked.dispose(); }
  assert.equal(calls, before, 'settings revocation must not call the window backend');
  await assert.rejects(call('resize', { targetId: selected.targetId, widthDip: 800, heightDip: 600 }), /revoked/); assert.equal(calls, before);
  approvals.addAppApproval(win.executable, 'Fixture'); selected = await select(); await call('status', { targetId: selected.targetId }); assert.equal((await controlStage()).authorized, true);
  const appRevoked = nextRevocation(); before = calls;
  try { approvals.removeAppApproval(win.executable); await appRevoked.observed; }
  finally { appRevoked.dispose(); }
  assert.equal(calls, before, 'app revocation must not call the window backend');
  await assert.rejects(call('resize', { targetId: selected.targetId, widthDip: 800, heightDip: 600 }), /revoked/); assert.equal(calls, before);
  await update({ stage1Enabled: false }); before = calls;
  await assert.rejects(call('list_windows'), { code: 'permission_denied' }); assert.equal(calls, before, 'disabled observation cannot enumerate unrelated windows');
  assert.equal(settings.getSettings().stage4Enabled, false);
});

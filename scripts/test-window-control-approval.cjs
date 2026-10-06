'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createOwner } = require('./window-use-approvals.cjs');
const { request: computerRequest } = require('./test-computer-use-approvals.cjs');
function request(id, app) { const value = computerRequest(id, app); value.params.serverName = 'azrael_window'; value.params._meta.connector_id = 'window-use'; return value; }
test('selected window authorization respects app grants and revocation across owners', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'azrael-window-approval-'));
  try {
    const a = createOwner(home), b = createOwner(home);
    assert.equal(a.hasAppApproval('C:\\Apps\\selected.exe', 'thread-a'), false);
    a.receive(request('one', 'C:\\Apps\\selected.exe'), () => {}, () => {});
    a.response('one', { action: 'accept', content: { persist: 'session' } });
    assert.equal(a.hasAppApproval('C:\\APPS\\SELECTED.EXE', 'thread-a'), true);
    assert.equal(a.hasAppApproval('C:\\Apps\\selected.exe', 'thread-b'), false);
    b.removeAppApproval('C:\\Apps\\selected.exe');
    assert.equal(a.hasAppApproval('C:\\Apps\\selected.exe', 'thread-a'), false);
    a.receive(request('two', 'C:\\Apps\\selected.exe'), () => {}, () => {});
    a.response('two', { action: 'accept', content: { persist: 'always' } });
    assert.equal(b.hasAppApproval('C:\\Apps\\selected.exe', 'thread-b'), true);
    a.stop('thread-a');
    assert.equal(a.hasAppApproval('C:\\Apps\\selected.exe', 'thread-a'), true);
    b.removeAppApproval('C:\\Apps\\selected.exe');
    assert.equal(a.hasAppApproval('C:\\Apps\\selected.exe', 'thread-a'), false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
test('window store is isolated and allow-all changes cancel pending while preserving explicit grants', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'azrael-window-policy-'));
  try {
    const settings = require('./use-control-settings.cjs').createSettingsOwner(home);
    const old = require('./computer-use-approvals.cjs').createOwner(home);
    old.addAppApproval('C:\\Apps\\old.exe', 'Old app');
    const a = createOwner(home), b = createOwner(home);
    assert.deepEqual(a.getPersistentAppApprovals(), { approvedApps: [] });
    assert.equal(a.hasAppApproval('C:\\Apps\\old.exe', 'thread-a'), false);
    assert.throws(() => a.addAppApproval('relative.exe', 'Relative'));
    assert.throws(() => a.hasAppApproval('Microsoft.WindowsCalculator'));
    a.addAppApproval('C:\\Apps\\saved.exe', 'Saved');
    a.receive(request('session', 'C:\\Apps\\session.exe'), () => {}, () => {});
    a.response('session', { action: 'accept', content: { persist: 'session' } });
    a.receive(request('late', 'C:\\Apps\\late.exe'), () => {}, () => {});
    settings.updateSettings({ windowUseAllowAll: true }, 0);
    assert.equal(a.hasAppApproval('C:\\Apps\\any.exe'), true);
    settings.updateSettings({ windowUseAllowAll: false }, 1);
    assert.equal(a.response('late', { action: 'accept', content: { persist: 'always' } }).action, 'cancel');
    assert.equal(a.hasAppApproval('C:\\Apps\\any.exe'), false);
    assert.equal(a.hasAppApproval('C:\\Apps\\saved.exe'), true);
    assert.equal(a.hasAppApproval('C:\\Apps\\session.exe', 'thread-a'), true);
    a.receive(request('revoked', 'C:\\Apps\\revoked.exe'), () => {}, () => {});
    b.removeAppApproval('C:\\Apps\\revoked.exe');
    assert.equal(a.response('revoked', { action: 'accept', content: { persist: 'always' } }).action, 'cancel');
    b.removeAppApproval('C:\\Apps\\session.exe');
    assert.equal(a.hasAppApproval('C:\\Apps\\session.exe', 'thread-a'), false);
    assert.equal(old.hasAppApproval('C:\\Apps\\old.exe'), true);
    fs.writeFileSync(path.join(home, 'azrael/computer-use/use-settings.json'), 'bad');
    assert.throws(() => a.hasAppApproval('C:\\Apps\\saved.exe'));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

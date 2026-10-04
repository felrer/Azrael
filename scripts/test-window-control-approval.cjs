'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createOwner } = require('./computer-use-approvals.cjs');
const { request } = require('./test-computer-use-approvals.cjs');
test('selected window authorization respects app grants and revocation across owners', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'azrael-window-approval-'));
  try {
    const a = createOwner(home), b = createOwner(home);
    assert.equal(a.hasAppApproval('selected.exe', 'thread-a'), false);
    a.receive(request('one', 'selected.exe'), () => {}, () => {});
    a.response('one', { action: 'accept', content: { persist: 'session' } });
    assert.equal(a.hasAppApproval('SELECTED.EXE', 'thread-a'), true);
    assert.equal(a.hasAppApproval('selected.exe', 'thread-b'), false);
    b.removeAppApproval('selected.exe');
    assert.equal(a.hasAppApproval('selected.exe', 'thread-a'), false);
    a.receive(request('two', 'selected.exe'), () => {}, () => {});
    a.response('two', { action: 'accept', content: { persist: 'always' } });
    assert.equal(b.hasAppApproval('selected.exe', 'thread-b'), true);
    a.stop('thread-a');
    assert.equal(a.hasAppApproval('selected.exe', 'thread-a'), true);
    b.removeAppApproval('selected.exe');
    assert.equal(a.hasAppApproval('selected.exe', 'thread-a'), false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createWindowsChildSessionManager } = require('./window-child-session.cjs');

function fixture(t, { change = {}, authorize = async () => true, response, observedChild = 6, write = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azrael-child-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  const file = path.join(root, 'request.json'), now = Date.now();
  const intent = { schemaVersion: 1, requestId: crypto.randomUUID(), sid: 'S-1-5-21-fixture', profile: 'C:\\Users\\fixture',
    parentSessionId: 2, childSessionId: 6, createdUtc: new Date(now - 1000).toISOString(), expiresUtc: new Date(now + 590000).toISOString(), ...change };
  if (write) fs.writeFileSync(file, JSON.stringify(intent));
  const environment = { platform: 'win32', readOnly: true, parent: { sid: intent.sid === 'foreign' ? 'S-1-5-21-fixture' : intent.sid, sessionId: 2, profile: 'C:\\Users\\fixture' },
    childSessions: { enabledQuerySucceeded: true, enabled: true, idQuerySucceeded: true, childSessionId: observedChild,
      sessionEnumerationSucceeded: true, reportedChildSessionLive: observedChild !== null },
    service: { status: 'Running' }, activeX: { activated: true, interfaces: Object.fromEntries(['extendedSettings', 'inputSink', 'scanCodeInput'].map(key => [key, { available: true }])) } };
  const identity = { sid: environment.parent.sid, profile: environment.parent.profile, parentSessionId: 2, childSessionId: 6, workerPid: 77, workerCreated: '123', sessionAnchorPid: 70, sessionAnchorCreated: '100' };
  const proof = { scope: 'child_platform_fixture', helperSha256: 'a'.repeat(64), identity,
    gates: Object.fromEntries(['connection', 'render', 'keyboard', 'mouse', 'parentIdentity', 'dataProfile'].map(key => [key, { passed: true }])), fixtureClosed: { passed: true } };
  const calls = [];
  const manager = createWindowsChildSessionManager({ enabled: true, manualRecoveryRequestPath: file,
    probe: async () => environment, nativeHelper: { path: 'C:\\fixture\\helper.exe', sha256: 'a'.repeat(64) }, authorize,
    transportFactory: (_helper, mode) => { assert.equal(mode, undefined, 'Recovery must not rewrite protected bootstrap state'); return {
      request: async (value, timeout) => { calls.push({ value, timeout }); return response ? response(value, identity, proof) : { ok: true, identity, ownershipVerified: true, inputReleased: true, admission: proof }; },
      healthy: true, disconnect() {} }; } });
  return { manager, root, file, intent, calls, environment };
}

test('manual request consumes once, authenticates exact existing child, and uses bounded recovery transport', async t => {
  const f = fixture(t);
  const result = await f.manager.start({ ownerId: 'task-a' });
  assert.equal(result.ok, true);
  assert.equal(result.admissionReady, true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].value.operation, 'recover');
  assert.equal(f.calls[0].value.childSessionId, 6);
  assert.equal(f.calls[0].value.recoveryRequestId, f.intent.requestId);
  assert.equal(f.calls[0].timeout, 240000);
  assert.equal(fs.existsSync(f.file), false);
  assert.equal(fs.existsSync(path.join(f.root, `consumed-${f.intent.requestId}.json`)), false);
  assert.deepEqual(result.recoveryRequestCleanup, { state: 'complete', remainingPaths: [] });
  assert.equal((await f.manager.describe()).ownershipVerified, true);
});

test('current same-user child automatically recovers without manual request while retaining native identity gates', async t => {
  const f = fixture(t, { write: false });
  assert.equal((await f.manager.start({ ownerId: 'task-a' })).ok, true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].value.operation, 'recover');
  assert.equal(f.calls[0].value.automaticRecovery, true);
  assert.match(f.calls[0].value.recoveryRequestId, /^[a-f0-9-]{36}$/);
});

test('unknown recovery transport preserves exact consumed request for later finalization', async t => {
  const f = fixture(t, { response: () => { throw new Error('Transport lost'); } });
  const result = await f.manager.start({ ownerId: 'task-a' });
  const consumed = path.join(f.root, `consumed-${f.intent.requestId}.json`);
  assert.equal(result.code, 'child_transport_failed');
  assert.deepEqual(result.recoveryRequestCleanup, { state: 'deferred', remainingPaths: [consumed] });
  assert.equal(fs.existsSync(consumed), true);
});

test('terminal recovery response preserves changed consumed request and reports its exact path', async t => {
  let f;
  f = fixture(t, { response: (_value, identity, proof) => {
    fs.writeFileSync(path.join(f.root, `consumed-${f.intent.requestId}.json`), '{"changed":true}');
    return { ok: true, identity, ownershipVerified: true, admission: proof };
  } });
  const result = await f.manager.start({ ownerId: 'task-a' });
  const consumed = path.join(f.root, `consumed-${f.intent.requestId}.json`);
  assert.equal(result.ok, true);
  assert.deepEqual(result.recoveryRequestCleanup, { state: 'deferred', remainingPaths: [consumed] });
  assert.equal(fs.readFileSync(consumed, 'utf8'), '{"changed":true}');
});

test('authority denial does not consume manual request or launch native code', async t => {
  const f = fixture(t, { authorize: async () => false });
  assert.equal((await f.manager.start({ ownerId: 'task-a' })).code, 'child_session_authority_required');
  assert.equal(fs.existsSync(f.file), true);
  assert.equal(f.calls.length, 0);
});

test('expired, foreign, parent-target, changed target, and unknown request fields cannot trigger recovery', async t => {
  for (const change of [{ expiresUtc: new Date(0).toISOString() }, { sid: 'foreign' }, { profile: 'C:\\Users\\other' },
    { parentSessionId: 3 }, { childSessionId: 2 }, { childSessionId: 7 }, { requestId: 'unbounded' }, { extra: true }]) {
    const f = fixture(t, { change });
    assert.equal((await f.manager.start({ ownerId: 'task-a' })).code, 'manual_recovery_request_invalid');
    assert.equal(f.calls.length, 0);
    assert.equal(fs.existsSync(f.file), true);
  }
});

test('manual recovery never creates a child if its target disappeared', async t => {
  const f = fixture(t, { observedChild: null });
  assert.equal((await f.manager.start({ ownerId: 'task-a' })).code, 'manual_recovery_request_invalid');
  assert.equal(f.calls.length, 0);
});

test('a different returned child fails ownership even with otherwise complete mock proof', async t => {
  const f = fixture(t, { response: (_value, identity, proof) => ({ ok: true, identity: { ...identity, childSessionId: 7 }, ownershipVerified: true, admission: proof }) });
  assert.equal((await f.manager.start({ ownerId: 'task-a' })).code, 'child_session_identity_mismatch');
  assert.equal((await f.manager.describe()).ownershipVerified, false);
});

test('concurrent manual requests cannot launch a second native operation', async t => {
  let finish;
  const f = fixture(t, { response: (_value, identity, proof) => new Promise(resolve => { finish = () => resolve({ ok: true, identity, ownershipVerified: true, admission: proof }); }) });
  const first = f.manager.start({ ownerId: 'task-a' });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.manager.start({ ownerId: 'task-b' })).code, 'child_session_occupied');
  finish();
  assert.equal((await first).ok, true);
  assert.equal(f.calls.length, 1);
});

test('revocation during native recovery prevents admission and releases held input without replay', async t => {
  let allowed = true;
  const f = fixture(t, { authorize: async () => allowed, response: (value, identity, proof) => {
    if (value.operation === 'recover') { allowed = false; return { ok: true, identity, ownershipVerified: true, admission: proof }; }
    assert.equal(value.operation, 'releaseInput');
    return { ok: true, sessionId: 6 };
  } });
  const result = await f.manager.start({ ownerId: 'task-a' });
  assert.equal(result.code, 'child_session_authority_required');
  assert.equal(result.available, false);
  assert.equal((await f.manager.describe()).available, false);
  assert.deepEqual(f.calls.map(call => call.value.operation), ['recover', 'releaseInput']);
});

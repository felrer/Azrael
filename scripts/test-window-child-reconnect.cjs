'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWindowsChildSessionManager } = require('./window-child-session.cjs');

const hash = 'a'.repeat(64);
function fixture(options = {}) {
  const initial = { sid: 'S-1-5-21-fixture', profile: 'C:\\Users\\fixture', parentSessionId: 1, childSessionId: 4,
    workerPid: 20, workerCreated: '123', sessionAnchorPid: 10, sessionAnchorCreated: '100' };
  let peer = { ...initial }, healthy = true, enabled = true, terminal = options.terminal !== false, channels = 0;
  const calls = [], events = [];
  const admission = identity => ({ scope: 'child_platform_fixture', helperSha256: hash, identity: { ...identity },
    gates: Object.fromEntries(['connection', 'render', 'keyboard', 'mouse', 'parentIdentity', 'dataProfile'].map(key => [key, { passed: true }])), fixtureClosed: { passed: true } });
  const manager = createWindowsChildSessionManager({ enabled: () => enabled, authorize: options.authorize || (async () => true),
    nativeHelper: { path: 'C:\\fixture\\helper.exe', sha256: hash }, bootstrapJournalPath: 'C:\\fixture\\bootstrap.json',
    probe: async () => ({ platform: 'win32', parent: { sid: initial.sid, profile: initial.profile, sessionId: 1 },
      childSessions: { enabledQuerySucceeded: true, enabled: true, idQuerySucceeded: true, childSessionId: options.observedChild || 4,
        sessionEnumerationSucceeded: true, reportedChildSessionLive: true }, service: { status: 'Running' },
      activeX: { activated: true, interfaces: Object.fromEntries(['extendedSettings', 'inputSink', 'scanCodeInput'].map(key => [key, { available: true }])) } }),
    transportFactory: () => {
      const channel = ++channels; events.push(`spawn:${channel}`); healthy = true;
      return { get healthy() { return healthy; }, disconnect() { events.push(`close:${channel}`); },
        async waitForExit() { events.push(`terminal:${channel}`); return terminal; },
        async request(value) {
          calls.push({ ...value, channel });
          if (value.operation === 'recover') {
            if (options.busy) return { ok: false, code: 'child_session_occupied' };
            peer = { ...initial, workerPid: 20 + channel, workerCreated: String(123 + channel), ...(options.changeIdentity || {}),
              ...(channel > 1 ? options.changedRecoveryIdentity : {}) };
            if (options.revokeOnRecovery) enabled = false;
            const proof = admission(peer);
            if (options.badAdmission) proof.gates.keyboard.passed = false;
            return { ok: true, identity: { ...peer }, ownershipVerified: true, inputReleased: true, admission: proof };
          }
          if (['input', 'launch', 'capture'].includes(value.operation) && options.failAction) { healthy = false; throw new Error('fixture transport lost after dispatch'); }
          if (value.operation === 'input' && options.uncertainActionReply) return { ok: false, code: 'native_worker_unknown', cleanupUnconfirmed: true, mutationOutcome: 'unknown' };
          if (value.operation === 'status') {
            if (options.failStatus) { healthy = false; throw new Error('fixture status transport lost'); }
            return { ok: true, ownershipVerified: true, state: 'running', sessionId: 4, identity: { ...peer, ...(options.changedStatusIdentity || {}) } };
          }
          return { ok: true, inputReleased: true, sessionId: 4, identity: { ...peer }, ownershipVerified: true };
        } };
    } });
  return { manager, calls, events, initial, fail: () => { healthy = false; }, disable: () => { enabled = false; }, setTerminal: value => { terminal = value; } };
}

test('automatically adopts current same-user child with fresh proof and native UUID', async () => {
  const f = fixture();
  const result = await f.manager.start({ ownerId: 'a' });
  assert.equal(result.ok, true); assert.equal(result.connectionRecovered, true); assert.equal(result.inputReleased, true);
  assert.equal(f.calls[0].operation, 'recover'); assert.equal(f.calls[0].automaticRecovery, true);
  assert.match(f.calls[0].recoveryRequestId, /^[a-f0-9-]{36}$/); assert.equal(f.calls[0].expectedIdentity, undefined);
});

for (const operation of ['input', 'launch', 'capture']) test(`${operation} uncertain dispatch repairs once and never replays original action`, async () => {
  const f = fixture({ failAction: true }); await f.manager.start({ ownerId: 'a' });
  const old = (await f.manager.describe()).identity;
  const result = await f.manager.request({ ownerId: 'a', operation });
  assert.equal(result.ok, false); assert.equal(result.executionState, 'unknown'); assert.equal(result.observationRequired, true);
  assert.equal(result.mutationOutcome, 'unknown');
  assert.equal(result.connectionRecovered, true); assert.equal(result.connectionVerification.ok, true);
  assert.deepEqual(result.previousIdentity, old); assert.deepEqual(result.connectionVerification.previousIdentity, old);
  assert.equal(f.calls.filter(call => call.operation === operation).length, 1);
  assert.equal(f.calls.filter(call => call.operation === 'recover').length, 2);
  assert.deepEqual(f.calls.at(-1).expectedIdentity, old);
  assert.deepEqual(f.events, ['spawn:1', 'close:1', 'terminal:1', 'spawn:2']);
});

test('known dead channel repairs before operation and reports not executed for fresh observation', async () => {
  const f = fixture(); await f.manager.start({ ownerId: 'a' }); f.fail();
  const result = await f.manager.request({ ownerId: 'a', operation: 'input' });
  assert.equal(result.executionState, 'not_executed'); assert.equal(result.mutationOutcome, 'not_executed'); assert.equal(result.actionExecuted, false); assert.equal(result.connectionVerification.ok, true);
  assert.equal(f.calls.some(call => call.operation === 'input'), false);
});

test('native unknown action reply repairs connection while retaining exact original failed outcome', async () => {
  const f = fixture({ uncertainActionReply: true }); await f.manager.start({ ownerId: 'a' });
  const result = await f.manager.request({ ownerId: 'a', operation: 'input' });
  assert.equal(result.ok, false); assert.equal(result.code, 'native_worker_unknown'); assert.equal(result.mutationOutcome, 'unknown');
  assert.equal(result.connectionVerification.ok, true); assert.equal(result.connectionRecovered, true);
  assert.equal(f.calls.filter(call => call.operation === 'input').length, 1);
});

test('unconfirmed native producer exit blocks replacement without killing or duplicating helper', async () => {
  const f = fixture({ terminal: false }); await f.manager.start({ ownerId: 'a' }); f.fail();
  assert.equal((await f.manager.ensureConnected({ ownerId: 'a' })).code, 'child_transport_termination_unconfirmed');
  assert.equal(f.events.filter(event => event.startsWith('spawn')).length, 1);
});

test('busy recovery preserves explicit blocked outcome without inventing unknown cleanup', async () => {
  const f = fixture({ busy: true }); const result = await f.manager.start({ ownerId: 'a' });
  assert.equal(result.code, 'child_session_occupied'); assert.notEqual(result.cleanupUnconfirmed, true);
  assert.equal((await f.manager.describe()).cleanupUnconfirmed, false);
});

test('wrong child anchor or bad admission cannot be adopted', async () => {
  for (const options of [{ changeIdentity: { childSessionId: 9 } }, { badAdmission: true }]) {
    const f = fixture(options);
    assert.equal((await f.manager.start({ ownerId: 'a' })).code, 'child_session_identity_mismatch');
    assert.equal((await f.manager.describe()).admissionReady, false);
  }
});

test('changed anchor during reconnect is rejected even when SID and session number match', async () => {
  const f = fixture({ changedRecoveryIdentity: { sessionAnchorCreated: '999' } });
  await f.manager.start({ ownerId: 'a' }); f.fail();
  assert.equal((await f.manager.ensureConnected({ ownerId: 'a' })).code, 'child_session_identity_mismatch');
  assert.equal((await f.manager.describe()).admissionReady, false);
  assert.equal(f.calls.filter(call => call.operation === 'recover').length, 2);
});

test('stage revocation during recovery prevents admission and releases native lease', async () => {
  const f = fixture({ revokeOnRecovery: true });
  assert.equal((await f.manager.start({ ownerId: 'a' })).code, 'child_session_authority_required');
  assert.equal(f.calls.at(-1).operation, 'releaseLease'); assert.equal((await f.manager.describe()).admissionReady, false);
});

test('stage revocation inside final asynchronous authority check cannot publish healthy admission', async () => {
  let f, acquisitions = 0;
  f = fixture({ authorize: async operation => {
    if (operation === 'acquire' && ++acquisitions === 2) f.disable();
    return true;
  } });
  await f.manager.start({ ownerId: 'a' });
  assert.equal((await f.manager.ensureConnected({ ownerId: 'a' })).code, 'child_session_authority_required');
  assert.equal(f.calls.at(-1).operation, 'releaseLease');
  assert.equal((await f.manager.describe()).admissionReady, false);
});

test('healthy validation preserves held input, release advertises idle, acquire reacquires native lease', async () => {
  const f = fixture(); await f.manager.start({ ownerId: 'a' });
  assert.equal((await f.manager.ensureConnected({ ownerId: 'a' })).ok, true);
  assert.deepEqual(f.calls.map(call => call.operation), ['recover', 'status']);
  assert.equal((await f.manager.release({ ownerId: 'a' })).ok, true);
  assert.equal(f.calls.at(-1).operation, 'releaseLease');
  assert.equal((await f.manager.acquire({ ownerId: 'b' })).ok, true);
  assert.deepEqual(f.calls.slice(-2).map(call => call.operation), ['status', 'acquireLease']);
  assert.equal((await f.manager.revalidateInput({ ownerId: 'b' })).ok, true);
  assert.equal(f.calls.at(-1).operation, 'releaseInput');
  assert.equal((await f.manager.describe()).inputOwner, 'b');
});

test('new live status identity never replaces cached ownership without exact recovery', async () => {
  const f = fixture({ changedStatusIdentity: { workerCreated: '999' } }); await f.manager.start({ ownerId: 'a' });
  assert.equal((await f.manager.ensureConnected({ ownerId: 'a' })).code, 'child_session_identity_mismatch');
  await assert.rejects(f.manager.ensureConnected({ ownerId: 'other' }), /occupied/);
  assert.equal(f.calls.filter(call => call.operation === 'recover').length, 1);
});

test('status transport failure performs only one bounded recovery', async () => {
  const f = fixture({ failStatus: true }); await f.manager.start({ ownerId: 'a' });
  assert.equal((await f.manager.ensureConnected({ ownerId: 'a' })).connectionRecovered, true);
  assert.equal(f.calls.filter(call => call.operation === 'recover').length, 2);
  assert.equal(f.calls.filter(call => call.operation === 'status').length, 1);
});

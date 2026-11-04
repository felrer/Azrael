'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const { createWindowsChildSessionManager } = require('./window-child-session.cjs');
// Mock transport only: native release accounting has separate Windows fixture coverage.
function fixture() {
  const identity = { parentSessionId: 2, childSessionId: 7, sid: 'fixture-sid', profile: 'C:/fixture/profile', workerPid: 33, workerCreated: '44' };
  const admission = { scope: 'child_platform_fixture', helperSha256: 'a'.repeat(64), identity,
    gates: Object.fromEntries(['connection', 'render', 'keyboard', 'mouse', 'parentIdentity', 'dataProfile'].map(key => [key, { passed: true }])), fixtureClosed: { passed: true } };
  const state = { connected: false, probeFailed: false, allowed: true, healthy: true, release: true, failInput: false, transportFailure: false, revokeOnRelease: false };
  const calls = [];
  const manager = createWindowsChildSessionManager({ enabled: true, nativeHelper: { path: path.resolve('fixture/helper.exe'), sha256: 'a'.repeat(64) }, bootstrapJournalPath: path.resolve('fixture/bootstrap.json'), authorize: async () => state.allowed,
    probe: async () => ({ schemaVersion: 1, platform: 'win32', architecture: 'AMD64', readOnly: true,
      parent: { sid: identity.sid, profile: identity.profile, sessionId: 2 }, childSessions: { enabledQuerySucceeded: true, enabled: true, idQuerySucceeded: !state.probeFailed, idError: state.probeFailed ? 5 : 0, childSessionId: state.connected ? 7 : null },
      service: { status: 'Running' }, activeX: { activated: true, interfaces: Object.fromEntries(['inputSink', 'scanCodeInput', 'extendedSettings'].map(key => [key, { available: true }])) }, errors: [] }),
    transportFactory: (_helper, options) => ({ get healthy() { return state.healthy; }, disconnect() {}, request: async request => {
      if (options?.reconcileBootstrap) return { ok: true };
      calls.push(request.operation);
      if (state.transportFailure) { state.healthy = false; throw new Error('lost response'); }
      if (request.operation === 'start') { state.connected = true; return { ok: true, identity, ownershipVerified: true, admission }; }
      if (request.operation === 'status') return { ok: true, state: 'running', sessionId: 7, ownershipVerified: true, heldInput: !state.release };
      if (['releaseInput', 'releaseLease', 'acquireLease'].includes(request.operation)) { if (state.revokeOnRelease) state.allowed = false; return { ok: state.release, inputReleased: state.release, sessionId: 7, identity, ownershipVerified: true }; }
      if (request.operation === 'input' && state.failInput) return { ok: false, code: 'native_child_input_delivery_failed', mutationOutcome: 'unknown', inputReleaseConfirmed: false };
      return { ok: true, sessionId: 7, delivered: true };
    } }) });
  return { manager, state, calls };
}
test('transient environment read failure is re-evaluated, rather than latching session unknown', async () => {
  const f = fixture(); assert.equal((await f.manager.start({ ownerId: 'task' })).ok, true);
  f.state.probeFailed = true; assert.equal((await f.manager.describe()).available, false);
  f.state.probeFailed = false; assert.equal((await f.manager.describe()).available, true);
  assert.equal((await f.manager.revalidateInput({ ownerId: 'task' })).inputReleased, true);
  assert.equal(f.calls.filter(x => x === 'start').length, 1);
});
test('uncertain delivery gates input, not capture; live input release validation permits new actions without replay', async () => {
  const f = fixture(); await f.manager.start({ ownerId: 'task' }); f.state.failInput = true;
  assert.equal((await f.manager.request({ ownerId: 'task', operation: 'input' })).mutationOutcome, 'unknown');
  assert.equal((await f.manager.request({ ownerId: 'task', operation: 'capture' })).ok, true);
  assert.equal((await f.manager.request({ ownerId: 'task', operation: 'input' })).code, 'child_input_revalidation_required');
  f.state.release = false; assert.equal((await f.manager.revalidateInput({ ownerId: 'task' })).code, 'child_input_release_unconfirmed');
  assert.equal((await f.manager.request({ ownerId: 'task', operation: 'capture' })).ok, true);
  f.state.release = true; assert.equal((await f.manager.revalidateInput({ ownerId: 'task' })).ok, true);
  assert.equal(f.calls.filter(x => x === 'input').length, 1);
  f.state.failInput = false; assert.equal((await f.manager.request({ ownerId: 'task', operation: 'input' })).ok, true);
});
test('terminal transport loss without verified anchor and producer exit cannot reconnect or replay', async () => {
  const f = fixture(); await f.manager.start({ ownerId: 'task' }); f.state.transportFailure = true;
  assert.equal((await f.manager.request({ ownerId: 'task', operation: 'input' })).code, 'child_transport_failed');
  f.state.transportFailure = false;
  assert.equal((await f.manager.revalidateInput({ ownerId: 'task' })).code, 'child_session_not_connected');
  assert.equal((await f.manager.request({ ownerId: 'task', operation: 'capture' })).ok, false);
  assert.equal(f.calls.filter(x => x === 'start').length, 1);
  assert.equal(f.calls.filter(x => x === 'input').length, 1);
});
test('revoked authority during release cannot admit a new input owner', async () => {
  const f = fixture(); await f.manager.start({ ownerId: 'task' }); await f.manager.release({ ownerId: 'task' });
  f.state.revokeOnRelease = true;
  assert.equal((await f.manager.acquire({ ownerId: 'next' })).code, 'child_session_authority_required');
  assert.equal((await f.manager.describe()).inputOwner, null);
  assert.equal(f.calls.filter(x => x === 'input').length, 0);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { describeChildSession, createWindowsChildSessionManager, probeWindowsChildSession } = require('./window-child-session.cjs');

const environment = () => ({
  schemaVersion: 1, platform: 'win32', architecture: 'AMD64', readOnly: true,
  parent: { sid: 'S-1-5-21-fixture', sessionId: 1, profile: 'C:\\Users\\fixture', elevated: false },
  childSessions: { enabledQuerySucceeded: true, enabled: true, enabledError: 0,
    idQuerySucceeded: true, childSessionId: null, idError: 0 },
  service: { status: 'Running' },
  activeX: { activated: true, connectionAttempted: false, interfaces:
    Object.fromEntries(['inputSink', 'scanCodeInput', 'extendedSettings'].map(key => [key, { available: true, hresult: 0 }])) },
  errors: [],
});

test('default stage 3 disabled; installed interfaces do not establish a usable backend', async () => {
  let count = 0;
  const manager = createWindowsChildSessionManager({ probe: async () => { count++; return environment(); } });
  assert.equal((await manager.status()).state, 'disabled');
  const result = await manager.start();
  assert.equal(count, 2);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'stage3_disabled');
  assert.equal(result.parentFallback, false);
  assert.equal(result.available, false);
  assert.equal(result.capabilities.isolatedInput, false);
  assert.equal(typeof manager.stop, 'function');
});

test('prepared machine still refuses admission until concrete backend gates exist', async () => {
  const manager = createWindowsChildSessionManager({ enabled: true, probe: async () => environment() });
  const result = await manager.start();
  assert.equal(result.state, 'backend_incomplete');
  assert.equal(result.code, 'child_session_backend_incomplete');
  assert.equal(result.admissionReady, false);
  assert.deepEqual(result.prerequisites, []);
  assert.deepEqual(result.missingAdapters, ['trusted_native_helper_not_configured']);
  assert.ok(result.requiredVerification.includes('safe_cleanup'));
});

test('actual prerequisite errors retained; an existing child never becomes owned', async () => {
  const value = environment();
  value.childSessions.enabled = false;
  value.childSessions.childSessionId = 4;
  value.service.status = 'Stopped';
  value.activeX.interfaces.inputSink = { available: false, hresult: -2147467262 };
  const manager = createWindowsChildSessionManager({ enabled: true, probe: async () => value });
  const result = await manager.start();
  assert.equal(result.code, 'child_session_prerequisites');
  assert.deepEqual(result.prerequisites.map(item => item.code), [
    'child_sessions_not_enabled', 'existing_child_not_owned', 'termservice_not_running', 'activex_interface_unavailable',
  ]);
  assert.equal(result.prerequisites[3].detail.hresult, -2147467262);
  assert.equal(result.environment.childSessions.childSessionId, 4);
  assert.equal(result.ok, false);
});

test('failed query cannot be mistaken for no child or disabled feature', () => {
  const value = environment();
  value.childSessions = { enabledQuerySucceeded: false, enabledError: 5, idQuerySucceeded: false, idError: 1722 };
  value.errors = [{ operation: 'fixture', message: 'Access denied', hresult: -1 }];
  const result = describeChildSession(value, { enabled: true });
  assert.deepEqual(result.prerequisites.slice(0, 2), [
    { code: 'child_enablement_query_failed', detail: 5 }, { code: 'child_identity_query_failed', detail: 1722 },
  ]);
  assert.equal(result.prerequisites.at(-1).detail.message, 'Access denied');
});

test('WTS ERROR_NOT_FOUND is an expected no-child state, while preserving the actual API result', () => {
  const value = environment();
  value.childSessions.idQuerySucceeded = false; value.childSessions.idError = 1168;
  const result = describeChildSession(value, { enabled: true });
  assert.deepEqual(result.prerequisites, []);
  assert.equal(result.environment.childSessions.idQuerySucceeded, false);
  assert.equal(result.environment.childSessions.idError, 1168);
});

test('non-Windows probe is explicit without executing native code', async () => {
  const result = describeChildSession(await probeWindowsChildSession({ platform: 'linux' }), { enabled: true });
  assert.deepEqual(result.prerequisites.map(item => item.code), ['unsupported_platform']);
  assert.equal(result.available, false);
});

test('stale child ID is absent only after successful native enumeration', () => {
  const value = environment();
  value.childSessions.childSessionId = 3;
  value.childSessions.reportedChildSessionLive = false;
  assert.ok(describeChildSession(value, { enabled: true }).prerequisites.some(item => item.code === 'existing_child_not_owned'));
  value.childSessions.sessionEnumerationSucceeded = true;
  assert.deepEqual(describeChildSession(value, { enabled: true }).prerequisites, []);
  value.childSessions.reportedChildSessionLive = true;
  assert.ok(describeChildSession(value, { enabled: true }).prerequisites.some(item => item.code === 'existing_child_not_owned'));
});

test('machine preparation requires task authority and rechecks it before connection', async () => {
  for (const scenario of ['denied', 'cancelled', 'unknown', 'revoked', 'failed-reprobe', 'success']) {
    let prepared = false, setupCalls = 0, transportCalls = 0;
    const manager = createWindowsChildSessionManager({ enabled: true,
      nativeHelper: { path: 'C:\\fixture\\trusted.exe', sha256: 'a'.repeat(64) },
      bootstrapJournalPath: 'C:\\fixture\\bootstrap.json',
      probe: async () => { const value = environment(); value.childSessions.enabled = prepared && scenario !== 'failed-reprobe'; value.service.status = prepared ? 'Running' : 'Stopped'; return value; },
      authorize: async () => scenario !== 'denied' && !(prepared && scenario === 'revoked'),
      prepareMachine: async () => { setupCalls++; prepared = true; return scenario === 'cancelled' ? { ok: false, code: 'child_setup_cancelled' } : scenario === 'unknown' ? { ok: false, code: 'child_setup_unknown', cleanupUnconfirmed: true } : { ok: true }; },
      transportFactory: () => { transportCalls++; return { request: async () => ({ ok: false, code: 'fixture_reconciliation_stop' }), disconnect() {} }; },
    });
    const result = await manager.start({ ownerId: 'task-a' });
    assert.equal(setupCalls, scenario === 'denied' ? 0 : 1, scenario);
    assert.equal(transportCalls, scenario === 'success' ? 1 : 0, scenario);
    assert.equal(result.code, { denied: 'child_session_authority_required', cancelled: 'child_setup_cancelled', unknown: 'child_setup_unknown', revoked: 'child_session_authority_required', 'failed-reprobe': 'child_session_prerequisites', success: 'fixture_reconciliation_stop' }[scenario]);
    assert.equal((await manager.describe()).cleanupUnconfirmed, scenario === 'unknown', scenario);
    if (scenario === 'unknown') {
      assert.equal((await manager.start({ ownerId: 'task-a' })).code, 'child_cleanup_unconfirmed');
      assert.equal(setupCalls, 1);
    }
  }
});

function mockAdmission(identity) {
  return { scope: 'child_platform_fixture', helperSha256: 'a'.repeat(64), identity: { ...identity },
    gates: Object.fromEntries(['connection', 'render', 'keyboard', 'mouse', 'parentIdentity', 'dataProfile']
      .map(name => [name, { passed: true, detail: 'mock transport fixture evidence' }])),
    fixtureClosed: { passed: true, detail: 'mock fixture' }, applicationCompatibility: 'unverified', mock: true };
}
function connectedFixture({ identity, responder, authorize = async () => true, enabled = true, proof, startOk = true,
  reconciliation = { ok: true, state: 'no_pending_bootstrap', registryValuesRemoved: 0 } } = {}) {
  const parent = environment().parent;
  const peer = identity || { parentSessionId: parent.sessionId, childSessionId: 4, sid: parent.sid,
    profile: parent.profile, workerPid: 567, workerCreated: '1234' };
  const calls = [];
  const reconciliations = [];
  let connected = false;
  let healthy = true;
  let disconnected = false;
  const manager = createWindowsChildSessionManager({ enabled, probe: async () => {
    const observed = environment(); if (connected) observed.childSessions.childSessionId = peer.childSessionId; return observed;
  },
    nativeHelper: { path: 'C:\\fixture\\trusted.exe', sha256: 'a'.repeat(64) }, bootstrapJournalPath: 'C:\\fixture\\bootstrap.json', authorize,
    transportFactory: (_helper, mode) => ({ request: async value => {
      if (mode?.reconcileBootstrap) { reconciliations.push(value); return reconciliation; }
      calls.push(value);
      if (value.operation === 'start') { connected = true; return { ok: startOk, identity: peer, ownershipVerified: true, admission: proof === undefined ? mockAdmission(peer) : proof }; }
      const result = responder ? await responder(value) : ['releaseInput', 'releaseLease', 'acquireLease'].includes(value.operation) ? { ok: true, inputReleased: true, sessionId: peer.childSessionId } : { ok: true, state: 'stopped' };
      if (value.operation === 'stop' && result.ok && ['stopped', 'closed'].includes(result.state)) connected = false;
      return result;
    }, get healthy() { return healthy; }, disconnect() { if (!mode?.reconcileBootstrap) disconnected = true; } }),
  });
  return { manager, calls, reconciliations, disconnected: () => disconnected, failTransport: () => { healthy = false; } };
}

test('trusted transport requires explicit authority before any native start', async () => {
  const f = connectedFixture({ authorize: async () => false });
  assert.equal((await f.manager.start({ ownerId: 'task-a' })).code, 'child_session_authority_required');
  assert.equal(f.calls.length, 0);
});

test('complete mock platform proof admits only its exact owned worker; one owner controls operations and stop', async () => {
  const f = connectedFixture();
  const started = await f.manager.start({ ownerId: 'task-a' });
  assert.equal(started.ok, true);
  assert.equal(started.admissionReady, true);
  assert.equal(started.available, true);
  assert.equal((await f.manager.describe()).available, true);
  assert.equal((await f.manager.describe()).applicationCompatibility, 'unverified');
  await assert.rejects(f.manager.request({ ownerId: 'task-b', operation: 'input' }), /occupied/);
  await assert.rejects(f.manager.stop({ ownerId: 'task-b' }), /occupied/);
  assert.equal((await f.manager.request({ ownerId: 'task-a', operation: 'shell' })).code, 'child_operation_unsupported');
  assert.equal((await f.manager.request({ ownerId: 'task-a', operation: 'releaseInput' })).ok, true);
  assert.equal((await f.manager.stop({ ownerId: 'task-a' })).ok, true);
  assert.equal((await f.manager.status()).identity, null);
  assert.equal(f.disconnected(), true);
});

test('same-session worker is rejected; uncertain ownership blocks logoff and retry', async () => {
  const parent = environment().parent;
  const f = connectedFixture({ identity: { parentSessionId: 1, childSessionId: 1, sid: parent.sid, profile: parent.profile } });
  assert.equal((await f.manager.start({ ownerId: 'task-a' })).code, 'child_session_identity_mismatch');
  assert.equal((await f.manager.start({ ownerId: 'task-a' })).code, 'child_cleanup_unconfirmed');
  assert.equal((await f.manager.stop({ ownerId: 'task-a' })).code, 'child_cleanup_unconfirmed');
  assert.equal(f.calls.length, 1);
});

test('unsafe cleanup retains ownership; concurrent input cannot race teardown', async () => {
  let release;
  const f = connectedFixture({ responder: request => request.operation === 'stop'
    ? { ok: false, safe: false, state: 'cleanup_deferred', reasons: ['Unsaved state'] }
    : new Promise(resolve => { release = resolve; }) });
  await f.manager.start({ ownerId: 'task-a' });
  assert.equal((await f.manager.stop({ ownerId: 'task-a' })).state, 'cleanup_deferred');
  assert.equal((await f.manager.status()).inputOwner, 'task-a');
  const pending = f.manager.request({ ownerId: 'task-a', operation: 'input' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.manager.stop({ ownerId: 'task-a' })).code, 'child_session_occupied');
  release({ ok: true }); await pending;
  assert.equal(f.disconnected(), false);
});

test('warm reuse releases input and requires fresh authority and verified identity', async () => {
  const f = connectedFixture({ responder: async request => request.operation === 'status'
    ? { ok: true, sessionId: 4, ownershipVerified: true, state: 'running', pendingWork: false, directUser: false,
      unsavedWork: false, unknownState: false, unrelatedApps: false, pendingUserDecision: false, heldInput: false }
    : { ok: true, inputReleased: true, sessionId: 4 } });
  await f.manager.start({ ownerId: 'task-a' });
  assert.equal((await f.manager.observe()).pendingWork, true);
  await f.manager.release({ ownerId: 'task-a' });
  assert.equal((await f.manager.observe()).pendingWork, false);
  assert.equal((await f.manager.request({ ownerId: 'task-b', operation: 'input' })).code, 'child_input_lease_required');
  assert.equal((await f.manager.acquire({ ownerId: 'task-b' })).ok, true);
  assert.equal((await f.manager.describe()).admissionReady, true);
  await assert.rejects(f.manager.request({ ownerId: 'task-a', operation: 'input' }), /occupied/);
  assert.equal((await f.manager.status()).inputOwner, 'task-b');
});

test('stage disable callback takes effect before each operation but permits releasing input', async () => {
  let enabled = true;
  // Exercise the public callback with a separate manager sharing only fixture transport behavior.
  const manager = createWindowsChildSessionManager({ enabled: () => enabled, probe: async () => environment(),
    nativeHelper: { path: 'C:\\fixture\\trusted.exe', sha256: 'a'.repeat(64) }, bootstrapJournalPath: 'C:\\fixture\\bootstrap.json', authorize: async () => true,
    transportFactory: (_helper, mode) => ({ request: async request => mode?.reconcileBootstrap ? { ok: true, state: 'no_pending_bootstrap' } : request.operation === 'start'
      ? { ok: true, ownershipVerified: true, identity: { parentSessionId: 1, childSessionId: 4, sid: environment().parent.sid, profile: environment().parent.profile, workerPid: 567, workerCreated: '1234' } }
      : { ok: true, inputReleased: true, sessionId: 4 }, disconnect() {} }) });
  await manager.start({ ownerId: 'task-a' });
  enabled = false;
  assert.equal((await manager.request({ ownerId: 'task-a', operation: 'input' })).code, 'stage3_disabled');
  assert.equal((await manager.request({ ownerId: 'task-a', operation: 'releaseInput' })).ok, true);
  assert.equal((await manager.acquire({ ownerId: 'task-a' })).code, 'stage3_disabled');
  assert.equal((await manager.describe()).enabled, false);
});

test('bootstrap reconciliation precedes start; trusted task/journal identities reach the native owner', async () => {
  const f = connectedFixture();
  assert.equal((await f.manager.start({ ownerId: 'task-a' })).ok, true);
  assert.equal(f.reconciliations.length, 1);
  assert.equal(f.reconciliations[0].bootstrapJournalPath, 'C:\\fixture\\bootstrap.json');
  assert.equal(f.calls[0].bootstrapJournalPath, 'C:\\fixture\\bootstrap.json');
  assert.equal(f.calls[0].ownerId, 'task-a');
  assert.equal((await f.manager.describe()).bootstrapReconciliation.state, 'no_pending_bootstrap');
});

test('each failed or unknown platform gate blocks app work while retaining exact ownership for cleanup', async () => {
  const peer = { parentSessionId: 1, childSessionId: 4, sid: environment().parent.sid, profile: environment().parent.profile, workerPid: 567, workerCreated: '1234' };
  for (const name of ['connection', 'render', 'keyboard', 'mouse', 'parentIdentity', 'dataProfile']) {
    const proof = mockAdmission(peer); proof.gates[name].passed = false;
    const f = connectedFixture({ proof, startOk: false });
    const result = await f.manager.start({ ownerId: 'task-a' });
    assert.equal(result.ok, false, name); assert.equal(result.ownershipVerified, true, name);
    assert.deepEqual(result.identity, peer);
    assert.equal((await f.manager.describe()).admissionReady, false, name);
    for (const operation of ['launch', 'capture', 'input']) assert.equal((await f.manager.request({ ownerId: 'task-a', operation })).code, 'child_session_admission_required', `${name}/${operation}`);
    assert.equal((await f.manager.release({ ownerId: 'task-a' })).ok, true, name);
    assert.equal((await f.manager.stop({ ownerId: 'task-a' })).ok, true, name);
  }
});

test('missing, mismatched or nonboolean proof cannot enable admission', async () => {
  const peer = { parentSessionId: 1, childSessionId: 4, sid: environment().parent.sid, profile: environment().parent.profile, workerPid: 567, workerCreated: '1234' };
  const mutations = [proof => { proof.helperSha256 = 'b'.repeat(64); }, proof => { proof.identity.workerCreated = 'different'; },
    proof => { proof.gates.keyboard.passed = 'true'; }, proof => { delete proof.gates.render; }, proof => { proof.fixtureClosed.passed = false; }];
  for (const mutate of mutations) {
    const proof = mockAdmission(peer); mutate(proof);
    const f = connectedFixture({ proof });
    assert.equal((await f.manager.start({ ownerId: 'task-a' })).available, false);
    assert.equal((await f.manager.describe()).available, false);
  }
  const absent = connectedFixture({ proof: null });
  assert.equal((await absent.manager.start({ ownerId: 'task-a' })).admissionReady, false);
  const contradictory = connectedFixture({ startOk: false });
  assert.equal((await contradictory.manager.start({ ownerId: 'task-a' })).admissionReady, false);
  assert.equal((await contradictory.manager.describe()).available, false);
});

test('transport loss revokes cached admission and capability claims', async () => {
  const f = connectedFixture();
  assert.equal((await f.manager.start({ ownerId: 'task-a' })).admissionReady, true);
  f.failTransport();
  const status = await f.manager.describe();
  assert.equal(status.available, false);
  assert.equal(status.admissionReady, false);
  assert.equal(status.ownershipVerified, false);
  assert.equal(status.capabilities.connection, false);
  assert.equal(status.cleanupUnconfirmed, true);
});

test('uncertain bootstrap state blocks start and stays observable without claiming session ownership', async () => {
  const f = connectedFixture({ reconciliation: { ok: false, state: 'bootstrap_reconciliation_deferred', reason: 'RunOnce value changed' } });
  const result = await f.manager.start({ ownerId: 'task-a' });
  assert.equal(result.code, 'child_bootstrap_reconciliation_required');
  assert.equal(f.calls.length, 0);
  assert.equal((await f.manager.observe()).bootstrapReconciliation.reason, 'RunOnce value changed');
  assert.equal((await f.manager.describe()).identity, null);
});

test('missing journal fails explicitly; disabled-stage startup reconciliation cannot connect or log off', async () => {
  let launches = 0;
  const manager = createWindowsChildSessionManager({ enabled: false, nativeHelper: { path: 'C:\\fixture\\trusted.exe', sha256: 'a'.repeat(64) },
    transportFactory: () => { launches++; throw new Error('must not launch without a journal'); } });
  assert.equal((await manager.reconcileBootstrap()).code, 'child_bootstrap_journal_required');
  assert.equal(launches, 0);
  const f = connectedFixture({ enabled: false, reconciliation: { ok: true, state: 'bootstrap_reconciled', registryValuesRemoved: 1 } });
  assert.equal((await f.manager.reconcileBootstrap()).state, 'bootstrap_reconciled');
  assert.equal(f.calls.length, 0);
});

test('pinned native headless reconciliation of absent fixture journal never creates bootstrap state', {
  skip: !process.env.AZRAEL_CHILD_HELPER_FIXTURE || !process.env.AZRAEL_CHILD_JOURNAL_FIXTURE,
}, async () => {
  const executable = path.resolve(process.env.AZRAEL_CHILD_HELPER_FIXTURE);
  const journal = path.resolve(process.env.AZRAEL_CHILD_JOURNAL_FIXTURE);
  const selfTest = require('node:child_process').spawnSync(executable, ['--self-test'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(selfTest.status, 0, selfTest.stderr || selfTest.stdout);
  const nativeChecks = JSON.parse(selfTest.stdout);
  assert.equal(nativeChecks.ok, true);
  assert.equal(nativeChecks.bootstrapLaunchFixtureChecks, 10);
  assert.equal(nativeChecks.connected, false);
  assert.equal(nativeChecks.configurationWritten, false);
  assert.equal(fs.existsSync(journal), false, 'Only a nonexistent task fixture journal may be inspected by this test');
  const manager = createWindowsChildSessionManager({ enabled: false, bootstrapJournalPath: journal,
    nativeHelper: { path: executable, sha256: crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex') } });
  const result = await manager.reconcileBootstrap();
  assert.equal(result.ok, true);
  assert.equal(result.state, 'no_pending_bootstrap');
  assert.equal(result.registryValuesRemoved, 0);
  assert.equal(fs.existsSync(journal), false);
});

const closedIdentity = () => ({ sid: environment().parent.sid, profile: environment().parent.profile,
  parentSessionId: 1, childSessionId: 4, workerPid: 567, workerCreated: '1234', sessionAnchorPid: 568, sessionAnchorCreated: '1235' });
const closedEvidence = identity => ({ ok: true, state: 'closed', identity: { ...identity }, ownershipVerified: true,
  logoffConfirmed: true, processesStopped: true, pendingWork: false, directUser: false, unsavedWork: false,
  unknownState: false, unrelatedApps: false, pendingUserDecision: false, heldInput: false });

test('fresh closure inspection is read-only, works disabled and does not alter live manager transport', async () => {
  const modes = [], requests = [], disconnected = [];
  const identity = closedIdentity();
  const manager = createWindowsChildSessionManager({ enabled: false, nativeHelper: { path: 'fixture.exe', sha256: 'a'.repeat(64) },
    transportFactory: (_helper, mode) => { modes.push(mode); return {
      async request(value) { requests.push(value); return closedEvidence(identity); },
      disconnect() { disconnected.push(mode); },
    }; }, probe: async () => { throw new Error('Closure must not create a viewer or run admission probe'); } });
  assert.deepEqual(await manager.inspectClosure(identity), closedEvidence(identity));
  assert.deepEqual(modes, [{ mode: 'inspectClosure' }]);
  assert.deepEqual(disconnected, modes);
  assert.deepEqual(requests, [{ helperSha256: 'a'.repeat(64), identity }]);
  assert.equal((await manager.observe()).state, 'absent');
});

test('closure inspection defers legacy proof, mismatched identity and every missing or unsafe closure flag', async () => {
  let response, launches = 0, disconnects = 0;
  const identity = closedIdentity();
  const manager = createWindowsChildSessionManager({ nativeHelper: { path: 'fixture.exe', sha256: 'a'.repeat(64) },
    transportFactory: () => { launches++; return { request: async () => response, disconnect() { disconnects++; } }; } });
  for (const key of Object.keys(identity)) {
    const missing = { ...identity }; delete missing[key];
    assert.equal((await manager.inspectClosure(missing)).ownershipVerified, false, key);
  }
  assert.equal(launches, 0);
  for (const key of Object.keys(identity)) {
    response = closedEvidence(identity); response.identity[key] = typeof identity[key] === 'string' ? `${identity[key]}other` : identity[key] + 100;
    assert.equal((await manager.inspectClosure(identity)).ownershipVerified, false, key);
  }
  for (const key of ['pendingWork', 'directUser', 'unsavedWork', 'unknownState', 'unrelatedApps', 'pendingUserDecision', 'heldInput']) {
    for (const unsafe of [true, undefined]) {
      response = closedEvidence(identity); response[key] = unsafe;
      assert.equal((await manager.inspectClosure(identity)).ownershipVerified, false, `${key}: ${unsafe}`);
    }
  }
  for (const key of ['ok', 'ownershipVerified', 'logoffConfirmed', 'processesStopped']) {
    response = closedEvidence(identity); response[key] = false;
    assert.equal((await manager.inspectClosure(identity)).ownershipVerified, false, key);
  }
  response = { ok: false, code: 'native_child_error', message: 'Unknown access or reused identity' };
  assert.equal((await manager.inspectClosure(identity)).unknownState, true);
  assert.equal(disconnects, launches);
});

test('closure transport loss is deferred and never resets uncertain live ownership', async () => {
  const fixture = connectedFixture({ identity: closedIdentity(), responder: async () => { throw new Error('lost transport'); } });
  await fixture.manager.start({ ownerId: 'task-a' });
  assert.equal((await fixture.manager.observe()).state, 'unknown');
  assert.equal((await fixture.manager.inspectClosure(closedIdentity())).unknownState, true);
  assert.equal((await fixture.manager.observe()).state, 'unknown');
  assert.equal(fixture.calls.some(value => value.operation === 'stop'), false);
});

test('retiring an exact proven closed child releases stale manager state for the next owned start', async () => {
  const identity = closedIdentity();
  let starts = 0, liveDisconnects = 0;
  const manager = createWindowsChildSessionManager({ enabled: true, probe: async () => environment(),
    nativeHelper: { path: 'fixture.exe', sha256: 'a'.repeat(64) }, bootstrapJournalPath: 'C:\\fixture\\bootstrap.json', authorize: async () => true,
    transportFactory: (_helper, mode) => ({ healthy: true, disconnect() { if (!mode) liveDisconnects++; },
      async request(value) {
        if (mode?.reconcileBootstrap) return { ok: true };
        if (mode?.mode === 'inspectClosure') return closedEvidence(value.identity);
        if (value.operation === 'start') { starts++; return { ok: true, identity, ownershipVerified: true, admission: mockAdmission(identity) }; }
        throw new Error('Transport lost');
      } }),
  });
  await manager.start({ ownerId: 'task-a' });
  assert.equal((await manager.observe()).state, 'unknown');
  assert.equal((await manager.retireClosed({ ...identity, childSessionId: 5 })).ok, false);
  assert.equal(liveDisconnects, 0);
  assert.equal((await manager.retireClosed(identity)).state, 'closed');
  assert.equal(liveDisconnects, 1);
  assert.equal((await manager.observe()).state, 'closed');
  assert.equal((await manager.start({ ownerId: 'task-b' })).ok, true);
  assert.equal(starts, 2);
});

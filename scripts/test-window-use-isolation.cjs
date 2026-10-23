'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const { createIsolationController } = require('./window-use-isolation.cjs');
const { createResourceManager } = require('./window-use-resources.cjs');
// All child admission proofs in this file are mocks. No native platform acceptance.
const root = path.resolve(process.env.WINDOW_USE_ISOLATION_TEST_ROOT || 'artifacts/tasks/DU-01-window-use-stages/runs/20261017-isolation-r1/temporary');
let next = 0;
async function remove(file) {
  let stat; try { stat = await fs.lstat(file); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (stat.isDirectory() && !stat.isSymbolicLink()) { for (const name of await fs.readdir(file)) await remove(path.join(file, name)); await fs.rmdir(file); } else await fs.unlink(file);
}
async function fixture(t, options = {}) {
  await fs.mkdir(root, { recursive: true }); const directory = path.join(root, `case-${process.pid}-${++next}`);
  let controller, childOwner, closed = false, allowed = true, appAllowed = true, releaseOk = true;
  const approvedParent = JSON.parse(JSON.stringify(options.parentIdentity || 'approved-parent'));
  const identity = { childSessionId: 20, parentSessionId: 10, sid: 'same-sid', profile: 'existing-profile', workerPid: 30, workerCreated: 'worker-created' };
  const calls = [], state = { width: 80, height: 60, unsavedWork: false, unknownState: false, admissionReady: options.admissionReady ?? true };
  function mockAdmission() {
    const proof = { scope: 'child_platform_fixture', helperSha256: 'b'.repeat(64), identity: { ...identity }, gates: Object.fromEntries(['connection', 'render', 'keyboard', 'mouse', 'parentIdentity', 'dataProfile'].map(name => [name, { passed: true, evidence: 'mock-only' }])), fixtureClosed: { passed: true }, applicationCompatibility: 'unverified' };
    return options.proof ? options.proof(proof) : proof;
  }
  const childSession = {
    describe: async () => ({ admissionReady: false, available: false, environment: { parent: { sessionId: 10, sid: 'same-sid', profile: 'existing-profile' } } }),
    start: async ({ ownerId }) => { calls.push('start'); childOwner = ownerId; closed = false; if (options.onStart) await options.onStart(); return { ok: options.startOk ?? true, ownershipVerified: true, identity: options.badIdentity ? { ...identity, sid: 'different' } : identity, admissionReady: state.admissionReady, available: state.admissionReady, admission: mockAdmission() }; },
    acquire: async ({ ownerId }) => { calls.push('acquire'); if (!releaseOk) return { ok: false, code: 'unconfirmed-release' }; childOwner = ownerId; return { ok: true, ownershipVerified: true, identity, inputReleased: true, admissionReady: state.admissionReady, available: state.admissionReady, admission: mockAdmission() }; },
    revalidateInput: async () => { calls.push('revalidateInput'); return releaseOk ? { ok: true, identity, inputReleased: true } : { ok: false, code: 'unconfirmed-release' }; },
    request: async request => {
      calls.push({ ...request }); if (options.onRequest) { const result = await options.onRequest(request, state); if (result !== undefined) return result; }
      if (request.operation === 'launch') return { ok: true, sessionId: 20, pid: 40, created: 'app-created', hwnd: '123', executable: request.executable };
      if (request.operation === 'capture') return { ok: true, sessionId: 20, width: state.width, height: state.height, png: 'fixture-png', contentVerified: false };
      return { ok: true, sessionId: 20, delivered: true, readbackVerified: false };
    },
    release: async () => { calls.push('release'); if (!releaseOk) return { ok: false, code: 'unconfirmed-release' }; childOwner = null; return { ok: true, inputReleased: true }; },
    observe: async () => ({ identity, ownershipVerified: true, state: closed ? 'closed' : 'running', pendingWork: Boolean(childOwner), directUser: false, unsavedWork: state.unsavedWork, unknownState: state.unknownState, unrelatedApps: false, pendingUserDecision: false, heldInput: false, processesStopped: closed, logoffConfirmed: closed }),
    stop: async () => { calls.push('stop'); closed = true; return { ok: true, state: 'closed' }; },
    retireClosed: async () => { throw new Error('Normal stop already retired the child manager'); },
  };
  const resources = createResourceManager({ directory, idleMs: 0, inspectSession: identity => controller.observeSession(identity), closeSession: identity => controller.closeSession(identity) });
  controller = createIsolationController({ childSession, resources,
    authorize: async (_owner, operation, parent) => { if (['capture', 'input'].includes(operation) || operation === 'launch' && parent !== undefined) { assert.deepEqual(parent, approvedParent); return allowed && appAllowed; } return allowed; },
    approveApp: async (_owner, parent) => { try { assert.deepEqual(parent, approvedParent); return true; } catch { return false; } },
    resolveExecutable: async parent => { assert.deepEqual(parent, approvedParent); if(options.onResolveExecutable) await options.onResolveExecutable(); return { executable: path.resolve('fixture-existing-app.exe'), sha256: 'a'.repeat(64) }; } });
  t.after(async () => { await resources.stopScheduler(); await remove(directory); });
  return { controller, childSession, resources, calls, state, identity, setAllowed: value => { allowed = value; }, setAppAllowed: value => { appAllowed = value; }, setReleaseOk: value => { releaseOk = value; } };
}
async function ready(f) { const started = await f.controller.start({ ownerId: 'one' }); const launched = await f.controller.launch({ ownerId: 'one', parentIdentity: 'approved-parent' }); const captured = await f.controller.capture({ ownerId: 'one', targetId: launched.targetId }); return { started, launched, captured }; }
test('explicit confirmed logoff discards old targets without forging disposable cleanup evidence',async t=>{
  const f=await fixture(t),{launched,captured}=await ready(f);let forgotten=0;
  f.childSession.forgetLoggedOff=async proof=>{forgotten++;assert.equal(proof.logoffConfirmed,true);return {retired:true};};
  const result=await f.controller.explicitLogoff({logoffConfirmed:true,processesStopped:true,identity:f.identity});
  assert.equal(result.retired,true);assert.equal(forgotten,1);
  await assert.rejects(f.controller.capture({ownerId:'one',targetId:launched.targetId}),/lease|target/i);
  await assert.rejects(f.controller.input({ownerId:'one',targetId:launched.targetId,observationId:captured.observationId,input:{kind:'text',text:'stale'}}),/lease|target/i);
  assert.ok((await f.resources.inspect()).resources.length>0,'resource records require independent closure and cleanup');
});

test('fresh host observes exact external closure without adopting or stopping a live session', async t => {
  const f = await fixture(t);
  const proof = { identity: f.identity, state: 'closed', ownershipVerified: true, processesStopped: true, logoffConfirmed: true,
    ...Object.fromEntries(['pendingWork', 'directUser', 'unsavedWork', 'unknownState', 'unrelatedApps', 'pendingUserDecision', 'heldInput'].map(key => [key, false])) };
  f.childSession.inspectClosure = async identity => { assert.deepEqual(identity, f.identity); return proof; };
  const fresh = createIsolationController({ childSession: f.childSession, resources: f.resources });
  assert.deepEqual(await fresh.observeSession(f.identity), proof);
  assert.equal(f.calls.length, 0);
  proof.identity = { ...f.identity, workerCreated: 'reused' };
  assert.equal((await fresh.observeSession(f.identity)).state, 'unknown');
  proof.identity = f.identity; delete proof.heldInput;
  assert.equal((await fresh.observeSession(f.identity)).state, 'unknown');
  assert.equal(f.calls.length, 0);
});

test('external closure retires stale task input and rejects old target input', async t => {
  const f = await fixture(t); const { captured } = await ready(f);
  const proof = { identity: f.identity, state: 'closed', ownershipVerified: true, processesStopped: true, logoffConfirmed: true,
    ...Object.fromEntries(['pendingWork', 'directUser', 'unsavedWork', 'unknownState', 'unrelatedApps', 'pendingUserDecision', 'heldInput'].map(key => [key, false])) };
  f.childSession.observe = async () => ({ identity: f.identity, state: 'unknown', ownershipVerified: false });
  f.childSession.inspectClosure = async () => proof;
  let retirements = 0; f.childSession.retireClosed = async identity => { assert.deepEqual(identity, f.identity); retirements++; return proof; };
  assert.equal((await f.resources.cleanup()).results[0].state, 'deleted');
  assert.equal(retirements, 1);
  await assert.rejects(f.controller.input({ ownerId: 'one', targetId: captured.targetId, observationId: captured.observationId, input: { kind: 'text', text: 'stale' } }), /lease required/);
  assert.ok(!f.calls.includes('stop'));
});

test('app grant revoked during executable resolution prevents child launch', async t => {
  const f = await fixture(t, { onResolveExecutable: () => f.setAppAllowed(false) });
  await f.controller.start({ ownerId: 'one' });
  await assert.rejects(f.controller.launch({ ownerId: 'one', parentIdentity: 'approved-parent' }), /authority/);
  assert.equal(f.calls.filter(c => c.operation === 'launch').length, 0);
});

test('installed application identity retains app consent and owned child input without a parent window', async t => {
  const installed = { source: 'installed-package', packageName: 'Microsoft.Paint', packageFullName: 'registered-package', applicationId: 'App', executable: 'C:/installed/Paint.exe', title: 'Paint' };
  const f = await fixture(t, { parentIdentity: installed });
  await f.controller.start({ ownerId: 'one' });
  const launched = await f.controller.launch({ ownerId: 'one', parentIdentity: installed });
  assert.match(launched.targetId, /^[a-f0-9-]{36}$/);
  assert.equal(f.calls.filter(c => c.operation === 'launch').length, 1);
  const captured = await f.controller.capture({ ownerId: 'one', targetId: launched.targetId });
  f.setAppAllowed(false);
  await assert.rejects(f.controller.input({ ownerId: 'one', targetId: launched.targetId, observationId: captured.observationId, input: { kind: 'mouse', action: 'move', x: 2, y: 2 } }), /authority/);
  assert.equal(f.calls.filter(c => c.operation === 'input').length, 0);
  await assert.rejects(f.controller.launch({ ownerId: 'one', parentIdentity: { ...installed, executable: 'C:/other/Paint.exe' } }), /approval/);
  assert.equal(f.calls.filter(c => c.operation === 'launch').length, 1);
});

test('mock admitted child returns opaque targets without claiming application compatibility', async t => {
  const f = await fixture(t), { started, launched, captured } = await ready(f);
  assert.equal(started.admissionReady, true); assert.equal(started.available, true); assert.equal(started.applicationCompatibility, 'unverified'); assert.match(launched.targetId, /^[0-9a-f-]{36}$/);
  assert.equal(launched.pid, undefined); assert.equal(launched.hwnd, undefined); assert.equal(captured.contentVerified, false);
  assert.deepEqual(captured.geometry, { width: 80, height: 60 });
  await assert.rejects(f.controller.launch({ ownerId: 'one', parentIdentity: 'unapproved' }), /approval/);
  assert.throws(() => f.controller.launch({ ownerId: 'one', parentIdentity: 'approved-parent', executable: 'caller-path' }), /fields/);
  await assert.rejects(f.controller.capture({ ownerId: 'one', targetId: '123' }), /Unknown isolated target/);
});

test('mock failed or incomplete platform gates deny app/input and release owned sessions for safe cleanup', async t => {
  const failures = [
    { admissionReady: false }, { startOk: false },
    { proof: () => null },
    { proof: proof => { proof.gates.keyboard.passed = false; return proof; } },
    { proof: proof => { delete proof.gates.mouse; return proof; } },
    { proof: proof => { proof.fixtureClosed.passed = false; return proof; } },
    { proof: proof => { proof.identity.workerCreated = 'reused-worker'; return proof; } },
    { proof: proof => { proof.helperSha256 = 'unknown'; return proof; } },
  ];
  for (const failure of failures) {
    const f = await fixture(t, failure), started = await f.controller.start({ ownerId: 'one' });
    assert.equal(started.ok, false); assert.equal(started.admissionReady, false); assert.equal(started.available, false);
    const status = await f.resources.inspect(); assert.equal(status.resources.length, 1); assert.equal(status.resources[0].leases.length, 0); assert.equal(status.resources[0].state, 'ready');
    await assert.rejects(f.controller.launch({ ownerId: 'one', parentIdentity: 'approved-parent' }), /lease|admission/);
    await assert.rejects(f.controller.input({ ownerId: 'one', targetId: 'unadmitted', observationId: 'unadmitted', input: { kind: 'text', text: 'denied' } }), /lease|admission/);
    assert.equal(f.calls.filter(value => value.operation === 'launch' || value.operation === 'input').length, 0);
    const cleaned = (await f.resources.cleanup()).results[0];
    assert.equal(cleaned.state, 'deleted', JSON.stringify(cleaned));
  }
});

test('mock warm reacquisition must retain authenticated current-session admission', async t => {
  const f = await fixture(t), { launched } = await ready(f);
  await f.controller.release('one'); f.state.admissionReady = false;
  await assert.rejects(f.controller.start({ ownerId: 'one' }), /admission is unverified/);
  await assert.rejects(f.controller.capture({ ownerId: 'one', targetId: launched.targetId }), /lease|admission/);
  assert.equal((await f.resources.inspect()).resources[0].leases.length, 0);
});

test('same-SID/profile proof and single input owner are mandatory', async t => {
  const invalid = await fixture(t, { badIdentity: true });
  await assert.rejects(invalid.controller.start({ ownerId: 'one' }), /Same-SID/); assert.ok(invalid.calls.includes('release'));
  const f = await fixture(t); await f.controller.start({ ownerId: 'one' });
  await assert.rejects(f.controller.start({ ownerId: 'two' }), /occupied/);
});

test('input consumes its matching observation; bounds and changed geometry reject before delivery', async t => {
  const f = await fixture(t), { launched, captured } = await ready(f);
  const request = { ownerId: 'one', targetId: launched.targetId, observationId: captured.observationId, input: { kind: 'mouse', action: 'down', button: 'left', x: 79, y: 59 } };
  assert.equal((await f.controller.input(request)).observationInvalidated, true);
  await assert.rejects(f.controller.input(request), /Stale isolated observation/);
  let capture = await f.controller.capture({ ownerId: 'one', targetId: launched.targetId });
  await assert.rejects(f.controller.input({ ...request, observationId: capture.observationId, input: { ...request.input, x: 80 } }), /bounds/);
  f.state.width = 70;
  await assert.rejects(f.controller.input({ ...request, observationId: capture.observationId, input: { kind: 'text', text: 'hello' } }), /Stale isolated capture bounds/);
  assert.equal(f.calls.filter(v => v.operation === 'input').length, 1);
});

test('text/key/mouse validation rejects untyped payloads and caller identity injection', async t => {
  const f = await fixture(t), { launched, captured } = await ready(f);
  for (const input of [{ kind: 'text', text: 'x', pid: 900 }, { kind: 'key', scanCode: 0, action: 'down' }, { kind: 'key', scanCode: 128, action: 'down' }, { kind: 'mouse', x: -1, y: 0, action: 'move' }, { kind: 'mouse', x: 0, y: 0, action: 'wheel', delta: 1201 }, { kind: 'text', text: 'x'.repeat(4097) }, { kind: 'shell', text: 'not a supported route' }]) {
    await assert.rejects(f.controller.input({ ownerId: 'one', targetId: launched.targetId, observationId: captured.observationId, input }));
  }
  assert.equal(f.calls.filter(v => v.operation === 'input').length, 0);
});

test('owned-app keyboard scope blocks Windows/task-switch chords and clears held modifiers on Stop', async t => {
  const f = await fixture(t), { launched } = await ready(f);
  async function key(scanCode, action = 'down', extended = false) {
    const captured = await f.controller.capture({ ownerId: 'one', targetId: launched.targetId });
    return f.controller.input({ ownerId: 'one', targetId: launched.targetId, observationId: captured.observationId, input: { kind: 'key', scanCode, action, extended } });
  }
  await assert.rejects(key(0x5b, 'down', true), /Windows keys/); await assert.rejects(key(0x5c, 'down', true), /Windows keys/);
  await key(56); await assert.rejects(key(15), /escapes/); await assert.rejects(key(1), /escapes/);
  await assert.rejects(f.controller.launch({ ownerId: 'one', parentIdentity: 'approved-parent' }), /held keys/);
  assert.equal((await key(62)).delivered, true); await key(62, 'up'); await key(56, 'up'); // Alt+F4 stays app-scoped.
  await key(29); await key(42); await assert.rejects(key(1), /escapes/); await key(42, 'up');
  await key(56); await assert.rejects(key(83, 'down', true), /escapes/);
  await f.controller.release('one'); await f.controller.start({ ownerId: 'one' });
  assert.equal((await key(15)).delivered, true); // Previous Alt/Ctrl holds were released.
});

test('Stop before queued start prevents native creation; Stop during creation leaves warm unleased state', async t => {
  const f = await fixture(t);
  const pending = f.controller.start({ ownerId: 'one' }), stopped = f.controller.release('one');
  await assert.rejects(pending, /stopped/); await stopped;
  assert.equal((await f.resources.inspect()).resources.length, 0);
  assert.ok(!f.calls.includes('start'));
  let started, resume; const began = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { resume = resolve; });
  const running = await fixture(t, { onStart: async () => { started(); await gate; } });
  const creating = running.controller.start({ ownerId: 'one' }); await began;
  const stop = running.controller.release('one'); resume(); await assert.rejects(creating, /stopped/); await stop;
  const state = await running.resources.inspect(); assert.equal(state.resources.length, 1); assert.equal(state.resources[0].leases.length, 0);
  assert.ok(running.calls.includes('release')); assert.ok(!running.calls.includes('stop'));
});

test('uncertain input remains an action outcome; capture and verified warm reuse remain possible without replay', async t => {
  let fail = false;
  const f = await fixture(t, { onRequest: async request => { if (fail && request.operation === 'input') throw new Error('uncertain-native-input'); } });
  const { launched, captured } = await ready(f); fail = true;
  await assert.rejects(f.controller.input({ ownerId: 'one', targetId: launched.targetId, observationId: captured.observationId, input: { kind: 'key', scanCode: 30, action: 'down' } }), error => error.mutationOutcome === 'unknown');
  const fresh = await f.controller.capture({ ownerId: 'one', targetId: launched.targetId });
  assert.equal(fresh.inputReady, false);
  assert.equal(f.calls.filter(c => c.operation === 'input').length, 1);
  await assert.rejects(f.controller.input({ ownerId: 'one', targetId: launched.targetId, observationId: fresh.observationId, input: { kind: 'text', text: 'a new action' } }), error => error.code === 'child_input_revalidated' && error.actionExecuted === false);
  assert.equal(f.calls.filter(c => c.operation === 'input').length, 1);
  fail = false;
  const afterValidation = await f.controller.capture({ ownerId: 'one', targetId: launched.targetId });
  await f.controller.input({ ownerId: 'one', targetId: launched.targetId, observationId: afterValidation.observationId, input: { kind: 'text', text: 'newly observed action' } });
  await f.controller.release('one');
  assert.equal((await f.resources.inspect()).resources[0].state, 'ready');
  assert.equal((await f.controller.start({ ownerId: 'one' })).ok, true);
  assert.equal(f.calls.filter(c => c.operation === 'input').length, 2);
});

test('failed release leaves input gated while fresh read-only capture stays available', async t => {
  const f = await fixture(t, { onRequest: request => { if (request.operation === 'input') throw new Error('uncertain delivery'); } });
  const { launched, captured } = await ready(f);
  await assert.rejects(f.controller.input({ ownerId: 'one', targetId: launched.targetId, observationId: captured.observationId, input: { kind: 'text', text: 'uncertain' } }));
  f.setReleaseOk(false);
  const fresh = await f.controller.capture({ ownerId: 'one', targetId: launched.targetId });
  await assert.rejects(f.controller.input({ ownerId: 'one', targetId: launched.targetId, observationId: fresh.observationId, input: { kind: 'text', text: 'new' } }), /unconfirmed-release/);
  await assert.rejects(f.controller.release('one'), /unconfirmed-release/);
  assert.equal((await f.resources.inspect()).resources[0].blocked, 'active leases');
  assert.equal(f.calls.filter(c => c.operation === 'input').length, 1);
});

test('viewer minimization is a proven preflight rejection and restored capture does not replay input', async t => {
  let minimized = false;
  const f = await fixture(t, { onRequest: request => {
    if (minimized && request.operation === 'capture') return { ok: false, code: 'isolated_viewer_minimized', actionExecuted: false, mutationOutcome: 'not_executed', viewerState: 'minimized', requiredUserAction: 'restore_isolated_viewer' };
  } });
  const { launched, captured } = await ready(f); minimized = true;
  await assert.rejects(f.controller.input({ ownerId: 'one', targetId: launched.targetId, observationId: captured.observationId, input: { kind: 'mouse', action: 'down', x: 1, y: 1 } }), error => error.code === 'isolated_viewer_minimized' && error.actionExecuted === false && error.mutationOutcome === 'not_executed' && error.requiredUserAction === 'restore_isolated_viewer');
  assert.equal(f.calls.filter(c => c.operation === 'input').length, 0);
  minimized = false;
  const restored = await f.controller.capture({ ownerId: 'one', targetId: launched.targetId });
  assert.equal(restored.ok, true);
  assert.equal(restored.inputReady, false);
  assert.equal(f.calls.filter(c => c.operation === 'input').length, 0);
});

test('revocation denies input while safety release persists warm state without RAM teardown', async t => {
  const f = await fixture(t), { launched, captured } = await ready(f);
  f.setAllowed(false);
  await assert.rejects(f.controller.input({ ownerId: 'one', targetId: launched.targetId, observationId: captured.observationId, input: { kind: 'key', scanCode: 30, action: 'down' } }), /authority/);
  const released = await f.controller.release('one'); assert.equal(released.loggedOff, false); assert.equal(released.warm, true);
  assert.ok(f.calls.includes('release')); assert.ok(!f.calls.includes('stop'));
  assert.equal((await f.resources.inspect()).resources[0].leases.length, 0);
  const cleanup = await f.resources.cleanup(); assert.equal(cleanup.results[0].state, 'deleted'); assert.ok(f.calls.includes('stop'));
});

test('stored app identity survives caller mutation and app revocation between geometry/input blocks delivery', async t => {
  const parentIdentity = { executable: path.resolve('approved-parent.exe'), pid: 71, processCreated: 'approved-parent-created' };
  let f, revokeAfterGeometry = false;
  f = await fixture(t, { parentIdentity, onRequest: async request => { if (revokeAfterGeometry && request.operation === 'capture') f.setAppAllowed(false); } });
  await f.controller.start({ ownerId: 'one' });
  const launching = f.controller.launch({ ownerId: 'one', parentIdentity });
  parentIdentity.executable = 'caller-mutated-path';
  const launched = await launching;
  let capture = await f.controller.capture({ ownerId: 'one', targetId: launched.targetId });
  await f.controller.input({ ownerId: 'one', targetId: launched.targetId, observationId: capture.observationId, input: { kind: 'key', scanCode: 56, action: 'down' } });
  capture = await f.controller.capture({ ownerId: 'one', targetId: launched.targetId });
  revokeAfterGeometry = true;
  await assert.rejects(f.controller.input({ ownerId: 'one', targetId: launched.targetId, observationId: capture.observationId, input: { kind: 'key', scanCode: 62, action: 'down' } }), /authority/);
  assert.equal(f.calls.filter(value => value.operation === 'input').length, 1); // Only the earlier Alt hold reached native code.
  await assert.rejects(f.controller.capture({ ownerId: 'one', targetId: launched.targetId }), /authority/);
  assert.throws(() => f.controller.capture({ ownerId: 'one', targetId: launched.targetId, parentIdentity: 'forged' }), /fields/);
  const released = await f.controller.release('one'); assert.equal(released.released, true); assert.ok(f.calls.includes('release'));
  assert.equal((await f.resources.inspect()).resources[0].leases.length, 0);
});

test('Stop interrupts geometry read before input, then releases held-input ownership', async t => {
  let waiting, resume; const blocked = new Promise(resolve => { waiting = resolve; }), gate = new Promise(resolve => { resume = resolve; }); let block = false;
  const f = await fixture(t, { onRequest: async request => { if (block && request.operation === 'capture') { waiting(); await gate; } } });
  const { launched, captured } = await ready(f); block = true;
  const pending = f.controller.input({ ownerId: 'one', targetId: launched.targetId, observationId: captured.observationId, input: { kind: 'text', text: 'pending' } });
  await blocked; const stopped = f.controller.release('one'); resume();
  await assert.rejects(pending, /stopped/); await stopped;
  assert.equal(f.calls.filter(v => v.operation === 'input').length, 0); assert.ok(f.calls.includes('release'));
});

test('unconfirmed held-input release retains persistent resource lease', async t => {
  const f = await fixture(t); await f.controller.start({ ownerId: 'one' }); f.setReleaseOk(false);
  await assert.rejects(f.controller.release('one'), /unconfirmed-release/);
  assert.equal((await f.resources.inspect()).resources[0].leases.length, 1);
  assert.equal((await f.resources.cleanup()).results[0].state, 'deferred'); assert.ok(!f.calls.includes('stop'));
  f.setReleaseOk(true); await f.controller.release('one');
});

test('warm RAM and generated disk stay distinct, with unsaved work protecting their group', async t => {
  const f = await fixture(t), started = await f.controller.start({ ownerId: 'one' });
  const output = await f.resources.registerGenerated({ id: 'capture', workId: 'one', runId: 'run', producer: 'fixture', sessionIds: [started.resourceId] });
  await fs.mkdir(output.path); await fs.writeFile(path.join(output.path, 'capture'), '12345'); await f.resources.releaseLease(output.id, output.lease);
  await f.controller.release('one'); f.state.unsavedWork = true;
  const deferred = await f.resources.cleanup(); assert.equal(deferred.results[0].state, 'deferred'); assert.equal(deferred.bytes, 5); assert.ok(!f.calls.includes('stop'));
  f.state.unsavedWork = false;
  const reused = await f.controller.start({ ownerId: 'two' }); assert.equal(reused.resourceId, started.resourceId); assert.ok(f.calls.includes('acquire'));
  await f.controller.release('two'); const removed = await f.resources.cleanup(); assert.equal(removed.freedBytes, 5); assert.equal(removed.resources.length, 0);
});

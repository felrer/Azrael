'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { beginArtifactRun } = require('./artifact-run.cjs');
const { createSwitchedInputProvider, switchedInputSchema, desktopInputSchema, validateInput, validateDesktopInput } = require('./window-switched-input.cjs');
const sha = b => createHash('sha256').update(b).digest('hex');
const target = { hwnd: '1234', pid: 123, processCreated: 'abcd', executable: 'C:\\Fixture\\fixture.exe' };
// Retained omission checks: schema forwarding, exact target binding, guards and stop-before-cleanup.
function fixture() {
  const parentRoot = process.env.AZRAEL_WINDOW_SETTINGS_TEST_ROOT;
  let run;
  if (parentRoot) {
    fs.mkdirSync(parentRoot, { recursive: true });
    run = { temporary: fs.mkdtempSync(path.join(parentRoot, 'switched-provider-')) };
  } else {
    run = beginArtifactRun(path.resolve(__dirname, '..'), { workId: 'EZ01',
      owner: 'EZ-01-window-use-multipointer-review', runId: 'sp-' + randomUUID().replaceAll('-','') });
  }
  const directory = path.join(run.temporary, 'runtime'), stateDirectory = path.join(run.temporary, 's');
  fs.mkdirSync(directory);
  const files = ['azrael-multi-pointer.exe', 'THIRD_PARTY_NOTICES.md'].map(name => {
    const bytes = Buffer.from('non-executable test fixture ' + name); fs.writeFileSync(path.join(directory, name), bytes);
    return { path: name, bytes: bytes.length, sha256: sha(bytes) };
  });
  const bytes = JSON.stringify({ schema: 1, kind: 'azrael-multi-pointer', platform: 'win32', arch: 'x64', sourceSha256: 'b'.repeat(64), files });
  fs.writeFileSync(path.join(directory, 'manifest.json'), bytes);
  const declaration = { directory, manifestSha256: sha(bytes), modulePath: path.join(__dirname, 'multi-pointer-mcp.cjs') };
  const calls = [], sessions = []; let stopped = { terminationVerified: true, exitCode: 0, signal: null }, failure;
  const options = { stateDirectory, platform: 'win32', arch: 'x64', createNativeBroker({ targetsFile }) {
    sessions.push({ targetsFile, allowlist: JSON.parse(fs.readFileSync(targetsFile, 'utf8')) });
    return { async call(method, args) {
      calls.push({ method, args });
      if (failure?.method === method) { const error = failure.error; failure = null; throw error; }
      return { delivered: true, targets: [{ pid: 321, executable: 'private.exe' }], hitObservation: { text: 'private text' } };
    }, async close() { return stopped; } };
  } };
  return { declaration, options, calls, sessions, stateDirectory, setStopped(value) { stopped = value; }, failNext(method, error) { failure = { method, error }; } };
}
test('public schema forwards native actions and operation identity without exposing pointer or target selection', () => {
  const schema = switchedInputSchema();
  assert.deepEqual(schema.oneOf.map(s => s.properties.action.enum[0]), ['status', 'collaboration', 'move', 'click', 'drag', 'scroll', 'press', 'text']);
  for (const s of schema.oneOf) {
    assert.equal(s.additionalProperties, false); assert.equal(s.properties.pointerId, undefined); assert.equal(s.properties.targetId, undefined);
  }
  assert.deepEqual(validateInput({ action: 'press', keys: [162, 65], operationId: 77, x: -10, y: 50 }), { action: 'press', keys: [162, 65], operationId: 77, x: -10, y: 50 });
  for (const packet of [{ action: 'key', vk: 65, down: true }, { action: 'click', pointerId: 'other', button: 'left' },
    { action: 'status', executable: 'other' }, { action: 'move', x: 1 }, { action: 'text', text: 'x', operationId: 0 }]) assert.throws(() => validateInput(packet));
});
test('lazy provider pins exactly one root; status/collaboration never create or activate a pointer', async () => {
  const f = fixture(), p = createSwitchedInputProvider(f.declaration, f.options); let checks = 0;
  assert.equal(f.sessions.length, 0);
  const status = await p.input('t', { ...target, title: 'excluded' }, { action: 'status' }, async () => { checks++; });
  assert.equal(status.targets, undefined); assert.equal(status.hitObservation, undefined); assert.equal(status.delivered, true);
  await p.input('t', target, { action: 'collaboration', enabled: false }, async () => { checks++; });
  assert.deepEqual(f.calls.map(c => c.method), ['status', 'collaboration']);
  assert.deepEqual(f.sessions[0].allowlist, { schema: 1, targets: [{ id: 'selected', pid: 123, hwnd: '0x1234', createdFileTime: '0xabcd', executable: target.executable }] });
  assert.equal(checks, 6);
  await p.input('t', target, { action: 'press', keys: [65], operationId: 19, x: 10, y: 20 });
  assert.deepEqual(f.calls.slice(2), [
    { method: 'create_pointer', args: { pointerId: 'model', targetId: 'selected', x: 10, y: 20 } },
    { method: 'press', args: { keys: [65], operationId: 19, pointerId: 'model' } },
  ]);
  const sessionDirectory = path.dirname(f.sessions[0].targetsFile);
  await p.input('t', target, { action: 'press', keys: [65], operationId: 19 });
  assert.equal(f.calls.at(-1).args.operationId, 19); // Same live broker owns duplicate outcomes.
  await p.release('t'); assert.equal(fs.existsSync(sessionDirectory), false);
  const before = f.calls.length;
  await assert.rejects(p.input('t', target, { action: 'press', keys: [65], operationId: 19, x: 10, y: 20 }), /retired session/);
  assert.equal(f.calls.length, before); assert.equal(f.sessions.length, 1);
  await p.input('t', target, { action: 'press', keys: [65], x: 10, y: 20 });
  assert.equal(f.calls.at(-1).args.operationId, 20);
  await p.input('t', { ...target, processCreated: 'abce' }, { action: 'press', keys: [65], x: 10, y: 20 });
  assert.equal(f.calls.at(-1).args.operationId, 21); await p.dispose();
});
test('guard revocation cleans up before action; unverified stop blocks replacement and retains allowlist', async () => {
  const f = fixture(), p = createSwitchedInputProvider(f.declaration, f.options); let checks = 0;
  await assert.rejects(p.input('t', target, { action: 'move', x: 10, y: 20 }, async () => {
    if (++checks === 3) throw Object.assign(Error('revoked after pointer creation'), { code: 'cancelled' });
  }), error => error.code === 'cancelled' && /revoked/.test(error.message));
  assert.deepEqual(f.calls.map(c => c.method), ['create_pointer']);
  assert.deepEqual(fs.readdirSync(f.stateDirectory), []);
  await p.input('t', target, { action: 'status' });
  f.setStopped({ terminationVerified: false, exitCode: null, signal: null });
  f.failNext('press', Object.assign(Error('raw private text C:\\private\\document.txt'), { details: {
    code: 'input_uncertain', actionExecuted: true, message: 'private native message', partial: {
      operationId: 7, observeRequired: true, hitObservation: { pid: 321, executable: 'private.exe', text: 'private text' },
      recovery: { uncertainDelivery: true, rounds: 2, lastBlocker: 'foreground' },
    },
  } }));
  await assert.rejects(p.input('t', target, { action: 'press', keys: [65], operationId: 7, x: 10, y: 20 }), error => {
    assert.equal(error.code, 'state_changed'); assert.equal(error.nativeCode, 'input_uncertain');
    assert.equal(error.actionExecuted, true); assert.equal(error.observationRequired, true); assert.equal(error.recovery, 'observe_again');
    assert.equal(error.mutationOutcome, 'unknown');
    assert.deepEqual(error.switchedInputDetails, { operationId: 7, observeRequired: true, recovery: { rounds: 2, uncertainDelivery: true, lastBlocker: 'foreground' } });
    assert.equal(/private|document\.txt/.test(error.message), false); return true;
  });
  await assert.rejects(p.input('t', { ...target, processCreated: 'abce' }, { action: 'status' }), /unverified/);
  assert.equal(f.sessions.length, 2); assert.equal(fs.existsSync(f.sessions[1].targetsFile), true);
  await assert.rejects(p.dispose(), /unverified/);
  f.setStopped({ terminationVerified: true, exitCode: 0, signal: null });
  await p.release('t'); assert.deepEqual(fs.readdirSync(f.stateDirectory), []);
});
test('exact manifest and valid identities are required; unsupported hosts never launch', async () => {
  const f = fixture();
  for (const declaration of [{ ...f.declaration, manifestSha256: 'a'.repeat(64) }, { ...f.declaration, modulePath: path.join(f.declaration.directory, 'multi-pointer-mcp.cjs') }]) {
    const p = createSwitchedInputProvider(declaration, f.options);
    await assert.rejects(p.input('t', target, { action: 'status' })); await p.dispose();
  }
  for (const platform of ['linux', 'darwin']) {
    const p = createSwitchedInputProvider(f.declaration, { ...f.options, platform });
    await assert.rejects(p.input('t', target, { action: 'status' }), /Windows x64/); await p.dispose();
  }
  const p = createSwitchedInputProvider(f.declaration, f.options);
  await assert.rejects(p.input('t', { ...target, hwnd: '0x1234' }, { action: 'status' }));
  await assert.rejects(p.input('t', target, { action: 'click', button: 'left' }), /explicit physical screen/);
  assert.equal(f.sessions.length, 0); await p.dispose();
});

// Retained forwarding checks prevent accidentally recreating a broker per desktop
// target or turning presentation into an operation during adapter changes.
test('desktop retargeting preserves one broker and cosmetic calls consume no operation identity', async () => {
  const f = fixture(), p = createSwitchedInputProvider(f.declaration, f.options);
  let checks = 0;
  const guard = async () => { checks++; };
  await p.desktopInput('t', target, { action: 'click', button: 'left', x: 10, y: 20 }, guard);
  const next = { ...target, hwnd: '5678', pid: 456, processCreated: 'bcde' };
  await p.desktopInput('t', next, { action: 'press', keys: [65], x: 30, y: 40 }, guard);
  assert.equal(f.sessions.length, 1);
  assert.equal(f.sessions[0].allowlist.desktop, true);
  assert.deepEqual(f.calls.filter(c => c.method === 'desktop_target').map(c => c.args), [
    { pointerId: 'model', target, x: 10, y: 20 },
    { pointerId: 'model', target: next, x: 30, y: 40 },
  ]);
  const before = f.calls.length;
  await p.visualize('t', next, { x: 50, y: 60, phase: 'active', click: true }, guard);
  await p.visualize('t', next, { x: 50, y: 60, phase: 'idle' }, guard);
  assert.deepEqual(f.calls.slice(before), [
    { method: 'present_pointer', args: { pointerId: 'model', x: 50, y: 60, phase: 'active', click: true } },
    { method: 'present_pointer', args: { pointerId: 'model', x: 50, y: 60, phase: 'idle' } },
  ]);
  await p.desktopInput('t', next, { action: 'click', button: 'left', x: 30, y: 40 }, guard);
  assert.equal(f.calls.at(-1).args.operationId, 3);
  assert.equal(checks, 5 + f.calls.length * 2);
  const sessionDirectory = path.dirname(f.sessions[0].targetsFile);
  await p.dispose();
  assert.equal(fs.existsSync(sessionDirectory), false);
});

test('desktop drag explicitly retargets its start and preserves endpoint semantics', async () => {
  const f = fixture(), p = createSwitchedInputProvider(f.declaration, f.options);
  const packet = { action: 'drag', fromX: 10, fromY: 20, x: 30, y: 40 };
  assert.deepEqual(validateDesktopInput(packet), packet);
  assert.throws(() => validateDesktopInput({ action: 'drag', x: 30, y: 40 }));
  assert.throws(() => validateInput(packet));
  assert.ok(desktopInputSchema().oneOf.find(d => d.properties.action.enum[0] === 'drag').required.includes('fromX'));
  await p.desktopInput('t', target, { action: 'collaboration', enabled: true, x: 5, y: 6 });
  await p.desktopInput('t', target, packet);
  assert.deepEqual(f.calls.slice(1), [
    { method: 'create_pointer', args: { pointerId: 'model', targetId: 'selected', x: 5, y: 6 } },
    { method: 'desktop_target', args: { pointerId: 'model', target, x: 10, y: 20 } },
    { method: 'drag', args: { pointerId: 'model', x: 30, y: 40, operationId: 1 } },
  ]);
  await p.dispose();
});

test('standalone visualization retains selected authority and native capacity failure is not resent', async () => {
  const f = fixture(), p = createSwitchedInputProvider(f.declaration, f.options);
  await p.visualize('t', target, { x: 10, y: 20, phase: 'active' });
  assert.equal(f.sessions[0].allowlist.desktop, undefined);
  assert.deepEqual(f.calls.map(c => c.method), ['create_pointer', 'present_pointer']);
  assert.deepEqual(f.calls[0].args, { pointerId: 'model', targetId: 'selected', x: 10, y: 20, presentationOnly: true });
  await p.desktopInput('t', target, { action: 'move', x: 10, y: 20 });
  assert.equal(f.sessions.length, 2);
  const failure = Object.assign(Error('private native failure'), { details: { code: 'target_capacity', actionExecuted: false } });
  f.failNext('desktop_target', failure);
  const before = f.calls.length;
  await assert.rejects(p.desktopInput('t', target, { action: 'click', button: 'left', x: 10, y: 20 }), error => {
    assert.equal(error.nativeCode, 'target_capacity');
    assert.equal(error.observationRequired, true);
    assert.equal(error.actionExecuted, false);
    return true;
  });
  assert.deepEqual(f.calls.slice(before).map(c => c.method), ['desktop_target']);
  await p.dispose();
});

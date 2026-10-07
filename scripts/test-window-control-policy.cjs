'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createWindowOwner } = require('./window-control-policy.cjs');
const window = () => ({ hwnd: '101', pid: 4, processCreated: '123', executable: 'test.exe', title: 'Selected', minimized: false, widthPx: 800, heightPx: 600, dpi: 96 });
async function main() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'window-policy-'));
  let current = window(), approved = true, restores = 0, observations = 0, pending, onRequest, frameOverride;
  const calls = [];
  const backend = { async request(method, args) {
    calls.push(method); if (onRequest) await onRequest(method, args);
    if (pending && method === 'observe') await pending;
    if (method === 'listWindows') return [current];
    if (method === 'restore') { restores++; current.minimized = false; }
    if (method === 'resize') { current.widthPx = args.widthDip; current.heightPx = args.heightDip; }
    if (method === 'observe' || method === 'inspect') return { window: { ...current }, observationId: 'o' + ++observations, frameTimestamp: 'now', widthPx: current.widthPx, heightPx: current.heightPx, dpi: 96, elementsTruncated: false, elements: [{ id: 'e', name: 'Button', controlType: 'Button', patterns: ['Invoke'], secret: 'strip' }], image: { mimeType: 'image/png', data: 'YQ==' }, unrelated: 'private', ...frameOverride };
    return { window: { ...current } };
  } };
  const owner = createWindowOwner({ backend, authorize: async () => approved, codexHome: home });
  try {
    let target = await owner.bind('thread', current); const args = { targetId: target.targetId };
    assert.equal((await owner.call('thread', 'status', {})).targetId, target.targetId);
    await assert.rejects(owner.call('thread', 'status', { targetId: 'forged' }), /forged/);
    assert.equal((await owner.call('unbound', 'status', {})).state, 'unbound');
    await assert.rejects(owner.call('thread', 'capture', {}), /Invalid arguments/);
    assert.equal((await owner.listWindows()).length, 1);
    await assert.rejects(owner.call('thread', 'capture', { ...args, hwnd: '999' }), /Invalid arguments/);
    await assert.rejects(owner.call('thread', 'bind', args), /Unsupported/);
    await assert.rejects(owner.call('thread', 'capture', { targetId: 'forged' }), /forged/);
    frameOverride = { widthPx: 784, heightPx: 562 };
    const distinctGeometry = await owner.call('thread', 'capture', args);
    assert.equal(distinctGeometry.widthPx, 784); assert.equal(distinctGeometry.heightPx, 562);
    assert.equal(distinctGeometry.window.widthPx, 800); assert.equal(distinctGeometry.window.heightPx, 600);
    for (const bad of [0, -1, 16385, 1.5, '800', null]) {
      frameOverride = { widthPx: bad }; await assert.rejects(owner.call('thread', 'capture', args), e => e.code === 'unclassified' && e.message === '미분류된 오류');
      frameOverride = { heightPx: bad }; await assert.rejects(owner.call('thread', 'capture', args), e => e.code === 'unclassified' && e.message === '미분류된 오류');
    }
    frameOverride = { dpi: 120 }; await assert.rejects(owner.call('thread', 'capture', args), e => e.code === 'unclassified' && e.message === '미분류된 오류');
    for (const invalid of [undefined, null, 0, 1, 'false', 'true', {}, []]) {
      frameOverride = { elementsTruncated: invalid };
      await assert.rejects(owner.call('thread', 'capture', args), e => e.code === 'unclassified' && e.message === '미분류된 오류');
      await assert.rejects(owner.call('thread', 'inspect', args), e => e.code === 'unclassified' && e.message === '미분류된 오류');
    }
    frameOverride = { elementsTruncated: true };
    const partialCapture = await owner.call('thread', 'capture', args);
    assert.equal(partialCapture.elementsTruncated, true);
    const partialInspect = await owner.call('thread', 'inspect', args);
    assert.equal(partialInspect.elementsTruncated, true);
    await assert.rejects(owner.call('thread', 'invoke', { ...args, observationId: partialInspect.observationId, elementId: 'unobserved' }), /Fresh/);
    const partialActs = calls.filter(method => method === 'act').length;
    await owner.call('thread', 'invoke', { ...args, observationId: partialInspect.observationId, elementId: 'e' });
    assert.equal(calls.filter(method => method === 'act').length - partialActs, 1);
    frameOverride = undefined;
    const captured = await owner.call('thread', 'capture', args);
    assert.equal(captured.elementsTruncated, false);
    assert.equal((await owner.call('thread', 'inspect', args)).elementsTruncated, false);
    assert.equal(captured.unrelated, undefined); assert.equal(captured.window.executable, undefined); assert.equal(captured.elements[0].secret, undefined);
    current.widthPx++;
    await assert.rejects(owner.call('thread', 'invoke', { ...args, observationId: captured.observationId, elementId: 'e' }), /Fresh/);
    const fresh = await owner.call('thread', 'capture', args);
    owner.invalidateObservation('thread');
    await assert.rejects(owner.call('thread', 'invoke', { ...args, observationId: fresh.observationId, elementId: 'e' }), /Fresh/);
    const latest = await owner.call('thread', 'capture', args);
    await assert.rejects(owner.call('thread', 'scroll', { ...args, observationId: fresh.observationId, elementId: 'e', value: { horizontal: 3, vertical: 0 } }), /scroll amount/);
    await assert.rejects(owner.call('thread', 'scroll', { ...args, observationId: fresh.observationId, elementId: 'e', value: { horizontal: 0, vertical: 1, rawHWND: 'forged' } }), /Invalid arguments/);
    await owner.call('thread', 'invoke', { ...args, observationId: latest.observationId, elementId: 'e' });
    await assert.rejects(owner.call('thread', 'invoke', { ...args, observationId: captured.observationId, elementId: 'e' }), /Fresh/);
    const beforeFailure = await owner.call('thread', 'capture', args);
    const providerFailure = new Error('Native UI Automation provider failed');
    onRequest = method => { if (method === 'act') throw providerFailure; };
    const failedAction = owner.call('thread', 'invoke', { ...args, observationId: beforeFailure.observationId, elementId: 'e' });
    const queuedCapture = owner.call('thread', 'capture', args);
    const queuedRejection = assert.rejects(queuedCapture, /cancelled/);
    await assert.rejects(failedAction, error => error === providerFailure); await queuedRejection;
    onRequest = null;
    assert.equal((await owner.call('thread', 'status', {})).state, 'paused');
    const callsWhilePaused = calls.length;
    await assert.rejects(owner.call('thread', 'capture', args), /paused/);
    await assert.rejects(owner.call('thread', 'invoke', { ...args, observationId: beforeFailure.observationId, elementId: 'e' }), /paused/);
    assert.equal(calls.length, callsWhilePaused);
    const resumedAfterFailure = await owner.resume('thread'); assert.equal(resumedAfterFailure.state, 'ready');
    assert.notEqual(resumedAfterFailure.observationId, beforeFailure.observationId);
    current.minimized = true;
    await assert.rejects(owner.call('thread', 'capture', args), /user resume/);
    await assert.rejects(owner.call('thread', 'capture', args), /paused/); assert.equal(restores, 0);
    await owner.resume('thread'); assert.equal(restores, 1);
    current.minimized = true; await assert.rejects(owner.call('thread', 'capture', args), /user resume/); assert.equal(restores, 1);
    owner.clear('thread'); current = { ...window(), minimized: true };
    target = await owner.bind('thread', current); args.targetId = target.targetId;
    await owner.call('thread', 'capture', args); assert.equal(restores, 2);
    let release, started; const began = new Promise(r => { started = r; }); pending = new Promise(r => { release = r; }); onRequest = method => { if (method === 'observe') started(); };
    const flight = owner.call('thread', 'capture', args); await began; owner.stop('thread'); release(); await assert.rejects(flight, /cancelled/); pending = null; onRequest = null;
    await owner.resume('thread');
    let release2, started2; const began2 = new Promise(r => { started2 = r; }); pending = new Promise(r => { release2 = r; }); onRequest = method => { if (method === 'observe') started2(); };
    const revoked = owner.call('thread', 'capture', args); await began2; approved = false; release2(); await assert.rejects(revoked, /revoked/); approved = true; pending = null; onRequest = null;
    await owner.resume('thread'); current.pid++;
    await assert.rejects(owner.call('thread', 'capture', args), /identity changed/);
    owner.clear('thread'); current = window(); target = await owner.bind('thread', current); args.targetId = target.targetId;
    await owner.saveMacro({ id: 'two', name: 'Two sizes', steps: [{ widthDip: 700, heightDip: 500 }, { widthDip: 900, heightDip: 600 }] });
    assert.throws(() => owner.saveMacro({ id: 'invalid', name: 'Invalid', steps: [{ widthDip: 0, heightDip: 500 }] }), /Size/);
    assert.equal((await owner.getMacros()).length, 1);
    const result = await owner.call('thread', 'run_size_macro', { ...args, macroId: 'two' }); assert.equal(result.widthPx, 900);
    let resized = 0; onRequest = method => { if (method === 'resize' && ++resized === 1) owner.stop('thread'); };
    await assert.rejects(owner.call('thread', 'run_size_macro', { ...args, macroId: 'two' }), /cancelled/); assert.equal(resized, 1); onRequest = null;
    const macroPath = path.join(home, 'azrael', 'computer-use', 'window-macros.json'); await fs.writeFile(macroPath + '.lock', 'held');
    await assert.rejects(owner.getMacros(), e => e.code === 'unclassified' && e.message === '미분류된 오류'); await fs.unlink(macroPath + '.lock');
    await fs.writeFile(macroPath, '{bad'); await assert.rejects(owner.getMacros(), e => e.code === 'unclassified' && e.message === '미분류된 오류');
    await geometryRecoveryChecks(home);
    console.log('PASS policy: identity, argument isolation, observation lifetime, minimize/resume, Stop, revocation, macro storage, cancellation and bounded geometry recovery');
  } finally { owner.dispose(); await fs.rm(home, { recursive: true, force: true }); }
}
async function geometryRecoveryChecks(home) {
  let current, approved, hook, sequence = 0;
  const calls = [];
  const backend = { async request(method, args) {
    calls.push({ method, args });
    if (hook) await hook(method);
    if (method === 'observe' || method === 'inspect') return {
      window: { ...current }, observationId: 'geometry-' + ++sequence, frameTimestamp: 'now',
      widthPx: current.widthPx, heightPx: current.heightPx, dpi: current.dpi,
      elementsTruncated: false, elements: [{ id: 'e', name: 'Button', controlType: 'Button', patterns: ['Invoke'] }],
      image: { mimeType: 'image/png', data: 'YQ==' },
    };
    return { window: { ...current } };
  } };
  const owner = createWindowOwner({ backend, authorize: async () => approved, codexHome: path.join(home, 'geometry-recovery') });
  const nativeError = (code = 'state_changed', nativeCode = 'capture-size-changed', mutationOutcome) =>
    Object.assign(new Error(nativeCode), { code, nativeCode, ...(mutationOutcome ? { mutationOutcome } : {}) });
  async function reset() {
    owner.clear('geometry'); current = window(); approved = true; hook = null; calls.length = 0;
    return { targetId: (await owner.bind('geometry', current)).targetId };
  }
  const methods = () => calls.map(call => call.method);
  async function stale(args, observation) {
    const actions = methods().filter(method => method === 'act').length;
    await assert.rejects(owner.call('geometry', 'invoke', { ...args, observationId: observation.observationId, elementId: 'e' }), /Fresh/);
    assert.equal(methods().filter(method => method === 'act').length, actions, 'Old observations must never reach native act');
  }
  try {
    for (const [tool, method] of [['capture', 'observe'], ['inspect', 'inspect']]) {
      for (const failures of [1, 2]) {
        const args = await reset(); const old = await owner.call('geometry', tool, args); calls.length = 0;
        let attempts = 0;
        hook = requested => { if (requested === method && ++attempts <= failures) {
          current.widthPx += 20; current.heightPx += 10; current.dpi += 24; throw nativeError();
        } };
        const recovered = await owner.call('geometry', tool, args);
        assert.equal(attempts, failures + 1); assert.equal(recovered.state, 'ready'); assert.equal(recovered.targetId, args.targetId);
        assert.equal(recovered.window.dpi, current.dpi);
        if (tool === 'capture') { assert.equal(recovered.widthPx, current.widthPx); assert.equal(recovered.dpi, current.dpi); }
        assert.deepEqual(methods(), ['status', ...Array.from({ length: failures }, () => [method, 'status']).flat(), method]);
        hook = null; await stale(args, old);
        await owner.call('geometry', 'invoke', { ...args, observationId: recovered.observationId, elementId: 'e' });
      }
      {
        const args = await reset(); const old = await owner.call('geometry', tool, args); calls.length = 0;
        const churn = nativeError(); hook = requested => { if (requested === method) throw churn; };
        const failed = owner.call('geometry', tool, args);
        // A queued call keeps its original generation; recovery must not cancel it.
        const queued = owner.call('geometry', 'status', {});
        await assert.rejects(failed, error => error === churn);
        assert.equal((await queued).state, 'ready');
        assert.equal(methods().filter(requested => requested === method).length, 3);
        hook = null; await stale(args, old);
        const fresh = await owner.call('geometry', tool, args); assert.equal(fresh.state, 'ready');
      }
      for (const failure of [nativeError('timeout', 'capture-timeout'), nativeError('state_changed', 'stale-target'), nativeError('unclassified'), nativeError('state_changed', 'capture-size-changed', 'unknown')]) {
        const args = await reset(); await owner.call('geometry', tool, args); calls.length = 0;
        hook = requested => { if (requested === method) throw failure; };
        await assert.rejects(owner.call('geometry', tool, args), error => error === failure);
        assert.equal(methods().filter(requested => requested === method).length, 1);
        hook = null; assert.equal((await owner.call('geometry', 'status', {})).state, 'paused');
        const count = calls.length; await assert.rejects(owner.call('geometry', tool, args), /paused/); assert.equal(calls.length, count);
      }
      for (const interrupt of ['stop', 'revoke', 'minimize', 'identity']) {
        const args = await reset(); await owner.call('geometry', tool, args); calls.length = 0;
        hook = requested => { if (requested === method) {
          if (interrupt === 'stop') owner.stop('geometry');
          if (interrupt === 'revoke') approved = false;
          if (interrupt === 'minimize') current.minimized = true;
          if (interrupt === 'identity') current.pid++;
          throw nativeError();
        } };
        await assert.rejects(owner.call('geometry', tool, args), interrupt === 'stop' ? /cancelled/ : interrupt === 'revoke' ? /revoked/ : interrupt === 'minimize' ? /user resume/ : /identity changed/);
        assert.equal(methods().filter(requested => requested === method).length, 1);
        assert.equal(methods().includes('restore'), false, 'Recovery must not restore a minimized window');
        hook = null; approved = true;
        if (interrupt === 'identity') current.pid--;
        assert.equal((await owner.call('geometry', 'status', {})).state, 'paused');
      }
    }
    for (const [code, nativeCode] of [['unsupported_action', 'not-resizable'], ['invalid_request', 'resize-bounds']]) {
      const args = await reset(); const old = await owner.call('geometry', 'capture', args); calls.length = 0;
      const rejection = nativeError(code, nativeCode); hook = method => { if (method === 'resize') throw rejection; };
      const failed = owner.call('geometry', 'resize', { ...args, widthDip: 900, heightDip: 700 });
      const queued = owner.call('geometry', 'capture', args);
      await assert.rejects(failed, error => error === rejection && error.mutationOutcome === undefined);
      const fresh = await queued; assert.equal(fresh.state, 'ready'); assert.equal(fresh.targetId, args.targetId);
      assert.equal(methods().filter(method => method === 'resize').length, 1, 'Rejected resize must not be replayed');
      hook = null; await stale(args, old);
      await owner.call('geometry', 'invoke', { ...args, observationId: fresh.observationId, elementId: 'e' });
      for (const failure of [nativeError(code, nativeCode, 'unknown'), nativeError(code, 'other-native-code')]) {
        const next = await reset(); await owner.call('geometry', 'capture', next); calls.length = 0;
        hook = method => { if (method === 'resize') throw failure; };
        await assert.rejects(owner.call('geometry', 'resize', { ...next, widthDip: 900, heightDip: 700 }), error => error === failure);
        hook = null; assert.equal((await owner.call('geometry', 'status', {})).state, 'paused');
        assert.equal(methods().filter(method => method === 'resize').length, 1);
      }
    }
  } finally { owner.dispose(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });

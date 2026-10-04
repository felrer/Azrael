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
    if (method === 'observe') return { window: { ...current }, observationId: 'o' + ++observations, frameTimestamp: 'now', widthPx: current.widthPx, heightPx: current.heightPx, dpi: 96, elements: [{ id: 'e', name: 'Button', controlType: 'Button', patterns: ['Invoke'], secret: 'strip' }], image: { mimeType: 'image/png', data: 'YQ==' }, unrelated: 'private', ...frameOverride };
    return { window: { ...current } };
  } };
  const owner = createWindowOwner({ backend, authorize: async () => approved, codexHome: home });
  try {
    let target = await owner.bind('thread', current); const args = { targetId: target.targetId };
    assert.equal((await owner.call('thread', 'status', {})).targetId, target.targetId);
    await assert.rejects(owner.call('thread', 'status', { targetId: 'forged' }), /forged/);
    await assert.rejects(owner.call('unbound', 'status', {}), /No selected/);
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
      frameOverride = { widthPx: bad }; await assert.rejects(owner.call('thread', 'capture', args), /Invalid selected-window observation/);
      frameOverride = { heightPx: bad }; await assert.rejects(owner.call('thread', 'capture', args), /Invalid selected-window observation/);
    }
    frameOverride = { dpi: 120 }; await assert.rejects(owner.call('thread', 'capture', args), /Invalid selected-window observation/);
    frameOverride = undefined;
    const captured = await owner.call('thread', 'capture', args);
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
    const interference = new Error('Native interference: foreground changed');
    onRequest = method => { if (method === 'act') throw interference; };
    const failedAction = owner.call('thread', 'invoke', { ...args, observationId: beforeFailure.observationId, elementId: 'e' });
    const queuedCapture = owner.call('thread', 'capture', args);
    const queuedRejection = assert.rejects(queuedCapture, /cancelled/);
    await assert.rejects(failedAction, error => error === interference); await queuedRejection;
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
    await assert.rejects(owner.getMacros(), /busy/); await fs.unlink(macroPath + '.lock');
    await fs.writeFile(macroPath, '{bad'); await assert.rejects(owner.getMacros(), /corrupt/);
    console.log('PASS policy: identity, argument isolation, observation lifetime, minimize/resume, Stop, revocation, macro storage and cancellation');
  } finally { owner.dispose(); await fs.rm(home, { recursive: true, force: true }); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });

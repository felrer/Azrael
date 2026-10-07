'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createWindowOwner, TOOLS } = require('./window-control-policy.cjs');
const { windowError, errorPayload } = require('./window-control-errors.cjs');
const descriptor = () => ({ hwnd: '101', pid: 4, processCreated: '123', executable: 'test.exe', title: 'Selected', minimized: false, widthPx: 800, heightPx: 600, dpi: 96 });
async function main() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'window-minimized-policy-'));
  let current, approved, hook, restoreOverride, sequence = 0;
  const calls = [];
  const backend = { async request(method, args) {
    calls.push({ method, args });
    if (hook) await hook(method, args);
    if (method === 'listWindows') return [{ ...current }];
    if (method === 'restore') {
      const restored = current.minimized; current.minimized = false;
      return { window: { ...current }, ...(restoreOverride || { restored }) };
    }
    if (['observe', 'inspect'].includes(method)) return {
      window: { ...current }, observationId: 'observation-' + ++sequence, frameTimestamp: 'now',
      widthPx: current.widthPx, heightPx: current.heightPx, dpi: current.dpi,
      elementsTruncated: false, elements: [{ id: 'e', name: 'Button', controlType: 'Button', patterns: ['Invoke'] }],
      image: { mimeType: 'image/png', data: 'YQ==' },
    };
    return { window: { ...current } };
  } };
  const owner = createWindowOwner({ backend, authorize: async () => approved, codexHome: home });
  const methods = () => calls.map(call => call.method);
  async function reset(minimized = false) {
    owner.clear('thread'); current = { ...descriptor(), minimized }; approved = true; hook = null; restoreOverride = null; calls.length = 0;
    return { targetId: (await owner.bind('thread', current)).targetId };
  }
  function paused(reason, allowed) {
    const view = owner.peek('thread');
    assert.equal(view.state, 'paused'); assert.equal(view.pauseReason, reason); assert.equal(view.restoreAllowed, allowed);
  }
  const minimizedFailure = error => {
    assert.equal(error.code, 'window_minimized'); assert.equal(error.pauseReason, 'minimized');
    assert.equal(error.message, '선택한 창이 최소화되었습니다. restore_window로 복원 가능 여부를 확인해주세요.');
    assert.equal(error.restoreAllowed, true); assert.equal(error.actionExecuted, error.mutationOutcome === 'unknown' ? undefined : false);
    const payload = errorPayload(error); assert.equal(payload.pauseReason, 'minimized'); assert.equal(payload.restoreAllowed, true);
    return true;
  };
  async function stale(args, observation) {
    const count = methods().filter(method => method === 'act').length;
    await assert.rejects(owner.call('thread', 'invoke', { ...args, observationId: observation.observationId, elementId: 'e' }), /Fresh/);
    assert.equal(methods().filter(method => method === 'act').length, count);
  }
  try {
    assert(TOOLS.includes('restore_window'));
    let args = await reset(true); paused('minimized', true);
    for (const tool of ['capture', 'inspect', 'resize', 'run_size_macro']) {
      const extra = tool === 'resize' ? { widthDip: 900, heightDip: 700 } : tool === 'run_size_macro' ? { macroId: 'unused' } : {};
      await assert.rejects(owner.call('thread', tool, { ...args, ...extra }), minimizedFailure);
    }
    assert.equal(methods().includes('restore'), false);
    const recovery = await owner.call('thread', 'restore_window', args);
    assert.equal(recovery.restored, true); assert.equal(recovery.observationRequired, true); assert.equal(recovery.state, 'ready');
    assert.equal(recovery.restoreAllowed, false); assert.equal(recovery.observationId, undefined);
    assert.deepEqual(calls.find(call => call.method === 'restore').args, { window: { ...descriptor(), minimized: true } });
    const old = await owner.call('thread', 'capture', args);
    current.minimized = true;
    await assert.rejects(owner.call('thread', 'inspect', args), minimizedFailure); paused('minimized', true);
    await owner.call('thread', 'restore_window', args); await stale(args, old);
    const fresh = await owner.call('thread', 'capture', args);
    await owner.call('thread', 'invoke', { ...args, observationId: fresh.observationId, elementId: 'e' });
    assert.equal((await owner.call('thread', 'restore_window', args)).restored, false);
    for (const forged of [{ ...args, hwnd: '999' }, { ...args, window: descriptor() }, { ...args, candidateId: '999' }]) {
      await assert.rejects(owner.call('thread', 'restore_window', forged), /Invalid arguments/);
    }
    await assert.rejects(owner.call('thread', 'restore_window', { targetId: '999' }), /forged/);

    // Initial discovery binds the approved exact target without restoring or replacing it.
    owner.clear('thread'); current.minimized = true;
    const listed = await owner.call('thread', 'list_windows', {});
    const selected = await owner.call('thread', 'select_window', { candidateId: listed.candidates[0].candidateId });
    args = { targetId: selected.targetId }; paused('minimized', true);
    await owner.call('thread', 'restore_window', args);

    for (const tool of ['capture', 'inspect', 'invoke', 'resize']) {
      args = await reset(); const observation = await owner.call('thread', 'capture', args);
      const nativeMethod = tool === 'capture' ? 'observe' : tool === 'invoke' ? 'act' : tool;
      const failure = windowError('window_minimized', 'Native minimized', { nativeCode: 'window-minimized', ...(tool === 'resize' ? { mutationOutcome: 'unknown' } : {}) });
      hook = method => { if (method === nativeMethod) throw failure; };
      const extra = tool === 'invoke' ? { observationId: observation.observationId, elementId: 'e' } : tool === 'resize' ? { widthDip: 900, heightDip: 700 } : {};
      await assert.rejects(owner.call('thread', tool, { ...args, ...extra }), error => minimizedFailure(error) && error.mutationOutcome === failure.mutationOutcome);
      paused('minimized', true); hook = null; current.minimized = true;
      await owner.call('thread', 'restore_window', args); await stale(args, observation);
      assert.equal(methods().filter(method => method === nativeMethod).length, nativeMethod === 'observe' ? 2 : 1, 'Failed request must not be replayed');
    }

    for (const reason of ['user_stopped', 'error']) {
      args = await reset(); await owner.call('thread', 'capture', args);
      if (reason === 'user_stopped') owner.stop('thread');
      else {
        const unclassified = windowError('unclassified', 'Provider failure');
        hook = method => { if (method === 'observe') { current.minimized = true; throw unclassified; } };
        await assert.rejects(owner.call('thread', 'capture', args), error => error === unclassified && error.code === 'unclassified'); hook = null;
      }
      current.minimized = true; await owner.call('thread', 'status', {}); paused(reason, false);
      const before = calls.length;
      await assert.rejects(owner.call('thread', 'restore_window', args), /paused/); assert.equal(calls.length, before);
      current.minimized = false; await owner.call('thread', 'status', {}); paused(reason, false);
      await assert.rejects(owner.call('thread', 'restore_window', args), /paused/);
      await owner.resume('thread'); assert.equal(owner.peek('thread').state, 'ready');
    }

    // External restoration can recover only a minimized pause; it cannot clear other pause causes.
    args = await reset(true); current.minimized = false;
    assert.equal((await owner.call('thread', 'restore_window', args)).restored, false);
    assert.equal(owner.peek('thread').state, 'ready');

    // Native restore reports whether it acted after the fresh status check.
    args = await reset(true);
    hook = method => { if (method === 'restore') current.minimized = false; };
    const raced = await owner.call('thread', 'restore_window', args);
    assert.equal(raced.restored, false); assert.equal(raced.state, 'ready'); assert.equal(raced.observationRequired, true);
    assert.equal(methods().filter(method => method === 'restore').length, 1);
    for (const invalid of [undefined, null, 0, 'false', {}]) {
      args = await reset(true); restoreOverride = { restored: invalid };
      await assert.rejects(owner.call('thread', 'restore_window', args), error => error.code === 'unclassified' && error.mutationOutcome === 'unknown');
      paused('error', false); assert.equal(methods().filter(method => method === 'restore').length, 1);
      await assert.rejects(owner.call('thread', 'restore_window', args), /paused/);
    }

    for (const interrupt of ['stop', 'revoke', 'identity', 'rebind']) {
      args = await reset(true);
      let release, started; const began = new Promise(resolve => { started = resolve; }); const pending = new Promise(resolve => { release = resolve; });
      hook = async method => { if (method === 'restore') { started(); await pending; } };
      const restore = owner.call('thread', 'restore_window', args); await began;
      let rebound;
      if (interrupt === 'stop') owner.stop('thread');
      if (interrupt === 'revoke') approved = false;
      if (interrupt === 'identity') current.pid++;
      if (interrupt === 'rebind') { owner.clear('thread'); rebound = owner.bind('thread', descriptor()); }
      release();
      await assert.rejects(restore, interrupt === 'revoke' ? /revoked/ : interrupt === 'identity' ? /identity changed/ : /cancelled/);
      hook = null;
      if (interrupt === 'stop') paused('user_stopped', false);
      if (interrupt === 'revoke' || interrupt === 'identity') paused('error', false);
      if (rebound) { current = descriptor(); await rebound; }
      assert.equal(methods().filter(method => method === 'restore').length, 1);
    }
    args = await reset(true);
    const queued = owner.call('thread', 'restore_window', args); owner.stop('thread');
    await assert.rejects(queued, /cancelled/); assert.equal(methods().includes('restore'), false); paused('user_stopped', false);
    console.log('PASS minimized policy: explicit exact-target restore, initial/later pause, native guard errors, stale observations, user/error protection, Stop/revocation/identity and queued/inflight cancellation');
  } finally { owner.dispose(); await fs.rm(home, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

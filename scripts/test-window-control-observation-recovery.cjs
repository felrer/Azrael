'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createWindowOwner } = require('./window-control-policy.cjs');
const { windowError, errorPayload } = require('./window-control-errors.cjs');
const { createProtocol, callResult } = require('./window-control-mcp.cjs');
const descriptor = () => ({ hwnd: '101', pid: 4, processCreated: '123', executable: 'test.exe', title: 'Selected', minimized: false, widthPx: 800, heightPx: 600, dpi: 96 });

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'window-read-recovery-'));
  const current = descriptor(), calls = [];
  let sequence = 0, hook, approved = true;
  const backend = { async request(method, args) {
    calls.push({ method, args });
    if (hook) await hook(method, args);
    if (method === 'observe' || method === 'inspect') return {
      window: { ...current }, observationId: 'observation-' + ++sequence, frameTimestamp: 'now',
      widthPx: current.widthPx, heightPx: current.heightPx, dpi: current.dpi,
      elementsTruncated: false, elements: [{ id: 'button', name: 'Button', controlType: 'Button', automationId: 'button', patterns: ['invoke'] }],
      image: { mimeType: 'image/png', data: 'YQ==' },
    };
    return { window: { ...current } };
  } };
  const owner = createWindowOwner({ backend, authorize: async () => approved, codexHome: home });
  t.after(async () => { owner.dispose(); await fs.rm(home, { recursive: true, force: true }); });
  const args = { targetId: (await owner.bind('thread', current)).targetId };
  return { owner, args, current, calls, setHook(value) { hook = value; }, revoke() { approved = false; } };
}
const readFailures = ['stale-element', 'uia-value-limit', 'capture-timeout', 'provider-timeout', 'backend-timeout',
  'native-error', 'capture-device', 'capture-format', 'capture-encode', 'capture-clock', 'capture-size',
  'capture-unsupported', 'protected-target', 'unobservable-target', 'connection_error', 'timeout'];
function failure(nativeCode, options = {}) {
  const transport = ['connection_error', 'timeout'].includes(nativeCode);
  const code = transport ? nativeCode : /timeout/.test(nativeCode) ? 'timeout' : nativeCode === 'stale-element' ? 'state_changed' : 'unclassified';
  return windowError(code, 'Read failed', { ...(transport ? {} : { nativeCode }), ...options });
}

for (const [tool, method] of [['capture', 'observe'], ['inspect', 'inspect']]) {
  for (const nativeCode of readFailures) test(`${tool}: ${nativeCode} returns failure and permits a fresh read`, async t => {
    const f = await fixture(t);
    const old = await f.owner.call('thread', tool, f.args);
    const expected = failure(nativeCode);
    let attempts = 0;
    f.setHook(requested => { if (requested === method) { attempts++; throw expected; } });
    await assert.rejects(f.owner.call('thread', tool, f.args), error => {
      assert.equal(error, expected);
      assert.equal(error.recovery, 'observe_again'); assert.equal(error.observationRequired, true); assert.equal(error.actionExecuted, false);
      return true;
    });
    assert.equal(attempts, 1, 'The agent receives the failure without an automatic retry');
    const status = await f.owner.call('thread', 'status', {});
    assert.equal(status.state, 'ready'); assert.equal(status.targetId, f.args.targetId); assert.equal(status.observationRequired, true);
    await assert.rejects(f.owner.call('thread', tool, f.args), error => error.recovery === 'observe_again');
    assert.equal(attempts, 2, 'Persistent failure remains a failure rather than locking selection');
    f.setHook(null);
    const before = f.calls.filter(c => c.method === 'act').length;
    await assert.rejects(f.owner.call('thread', 'invoke', { ...f.args, observationId: old.observationId, elementId: 'button' }), /Fresh/);
    assert.equal(f.calls.filter(c => c.method === 'act').length, before);
    const fresh = await f.owner.call('thread', tool, f.args);
    assert.notEqual(fresh.observationId, old.observationId);
    await f.owner.call('thread', 'invoke', { ...f.args, observationId: fresh.observationId, elementId: 'button' });
    assert.equal(f.calls.filter(c => c.method === 'act').length, before + 1);
  });
}

for (const nativeCode of ['stale-observation', 'unknown-element', 'stale-element', 'unsupported-action', 'unsupported-key', 'disabled-element', 'readonly-element']) {
  test(`${nativeCode}: input rejection invalidates references without pausing or replay`, async t => {
    const f = await fixture(t), old = await f.owner.call('thread', 'capture', f.args);
    const expected = windowError(nativeCode.startsWith('stale') || nativeCode === 'unknown-element' ? 'state_changed' : 'unsupported_action', 'Input rejected', { nativeCode });
    f.setHook(method => { if (method === 'act') throw expected; });
    const rejected = f.owner.call('thread', 'invoke', { ...f.args, observationId: old.observationId, elementId: 'button' });
    const queued = f.owner.call('thread', 'capture', f.args);
    await assert.rejects(rejected, error => error.recovery === 'observe_again' && error.actionExecuted === false && !error.mutationOutcome);
    const fresh = await queued;
    assert.equal(f.calls.filter(c => c.method === 'act').length, 1);
    assert.equal(fresh.state, 'ready'); assert.notEqual(fresh.observationId, old.observationId);
    f.setHook(null);
    await assert.rejects(f.owner.call('thread', 'invoke', { ...f.args, observationId: old.observationId, elementId: 'button' }), /Fresh/);
  });
}

test('read-only status transport failure also permits subsequent validation', async t => {
  const f = await fixture(t);
  f.setHook(method => { if (method === 'status') throw failure('connection_error'); });
  await assert.rejects(f.owner.call('thread', 'capture', f.args), error => error.recovery === 'observe_again');
  f.setHook(null);
  assert.equal((await f.owner.call('thread', 'capture', f.args)).state, 'ready');
});

for (const boundary of ['stop', 'revoke', 'minimize', 'identity']) test(`recovery cannot bypass ${boundary}`, async t => {
  const f = await fixture(t);
  const old = await f.owner.call('thread', 'capture', f.args);
  f.setHook(method => {
    if (method !== 'observe') return;
    if (boundary === 'stop') f.owner.stop('thread');
    if (boundary === 'revoke') f.revoke();
    if (boundary === 'minimize') f.current.minimized = true;
    if (boundary === 'identity') f.current.pid++;
    throw failure('stale-element');
  });
  await assert.rejects(f.owner.call('thread', 'capture', f.args));
  f.setHook(null);
  const actions = f.calls.filter(c => c.method === 'act').length;
  await assert.rejects(f.owner.call('thread', 'invoke', { ...f.args, observationId: old.observationId, elementId: 'button' }));
  await assert.rejects(f.owner.call('thread', 'capture', f.args));
  assert.equal(f.calls.filter(c => c.method === 'act').length, actions);
  assert.equal(f.calls.some(c => c.method === 'restore'), false);
});

for (const expected of [failure('stale-element', { mutationOutcome: 'unknown' }), failure('native-error', { mutationOutcome: 'unknown' }),
  windowError('state_changed', 'Target replaced', { nativeCode: 'stale-target' }), windowError('state_changed', 'Window closed', { nativeCode: 'window-closed' }),
  windowError('permission_denied', 'Native authority denied', { nativeCode: 'native-error' }), windowError('cancelled', 'Stopped', { nativeCode: 'stale-element' })]) {
  test(`nonrecoverable read stays paused: ${expected.code}/${expected.nativeCode}/${expected.mutationOutcome || ''}`, async t => {
    const f = await fixture(t);
    f.setHook(method => { if (method === 'observe') throw expected; });
    await assert.rejects(f.owner.call('thread', 'capture', f.args), error => error.recovery !== 'observe_again');
    f.setHook(null);
    assert.equal((await f.owner.call('thread', 'status', {})).state, 'paused');
    await assert.rejects(f.owner.call('thread', 'capture', f.args), /paused/);
  });
}

test('macro retains completed steps and confirmed rejection without uncertainty or replay', async t => {
  const f = await fixture(t); let acts = 0;
  f.setHook(method => {
    if (method === 'act' && ++acts === 2) throw windowError('unsupported_action', 'Read-only element', { nativeCode: 'readonly-element' });
  });
  const result = await f.owner.call('thread', 'run_task_macro', { ...f.args, definition: { schema: 1, steps: [
    { action: 'invoke', selector: { automationId: 'button' } },
    { action: 'invoke', selector: { automationId: 'button' } },
    { action: 'invoke', selector: { automationId: 'button' } },
  ] } });
  assert.equal(result.status, 'failed'); assert.equal(acts, 2);
  assert.deepEqual(result.steps.map(s => s.status), ['completed', 'failed']);
  assert.equal(result.error.actionExecuted, false); assert.equal(result.error.recovery, 'observe_again'); assert.equal(result.error.mutationOutcome, undefined);
  assert.equal((await f.owner.call('thread', 'status', {})).state, 'ready');
  assert.equal(callResult(result).isError, true);
});

test('macro observation failure after a completed action does not replay it or invent an uncertain input', async t => {
  const f = await fixture(t); let acts = 0, inspections = 0;
  f.setHook(method => {
    if (method === 'act') acts++;
    if (method === 'inspect' && ++inspections === 2) throw failure('stale-element');
  });
  const result = await f.owner.call('thread', 'run_task_macro', { ...f.args, definition: { schema: 1, steps: [
    { action: 'invoke', selector: { automationId: 'button' } },
    { action: 'invoke', selector: { automationId: 'button' } },
  ] } });
  assert.equal(result.status, 'failed'); assert.equal(acts, 1);
  assert.deepEqual(result.steps.map(s => s.status), ['completed', 'failed']);
  assert.equal(result.error.recovery, 'observe_again'); assert.equal(result.error.mutationOutcome, undefined);
  assert.equal((await f.owner.call('thread', 'capture', f.args)).state, 'ready');
});

test('an explicitly uncertain rejected input still pauses', async t => {
  const f = await fixture(t), old = await f.owner.call('thread', 'capture', f.args);
  f.setHook(method => { if (method === 'act') throw windowError('unsupported_action', 'Uncertain input', { nativeCode: 'readonly-element', mutationOutcome: 'unknown' }); });
  await assert.rejects(f.owner.call('thread', 'invoke', { ...f.args, observationId: old.observationId, elementId: 'button' }), error => error.mutationOutcome === 'unknown' && error.recovery !== 'observe_again');
  assert.equal((await f.owner.call('thread', 'status', {})).state, 'paused');
  await assert.rejects(f.owner.call('thread', 'capture', f.args), /paused/);
});

test('host failure metadata reaches the model as an MCP tool result', async t => {
  const f = await fixture(t);
  f.setHook(method => { if (method === 'observe') throw failure('capture-timeout'); });
  const protocol = createProtocol({ relay: (_thread, name, args) => f.owner.call('thread', name, args) });
  const response = await protocol({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'capture', arguments: f.args,
    _meta: { threadId: '12345678-1234-1234-1234-123456789abc', 'codex/sandbox-state-meta': { permissionProfile: { type: 'disabled' } } } } });
  assert.equal(response.error, undefined); assert.equal(response.result.isError, true);
  const payload = JSON.parse(response.result.content[0].text);
  assert.equal(payload.recovery, 'observe_again'); assert.equal(payload.observationRequired, true); assert.equal(payload.actionExecuted, false);
  assert.deepEqual(errorPayload(windowError(payload.code, payload.message, payload)), payload);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createBackend } = require('./window-control-backend.cjs');
const { createWindowOwner, TOOLS } = require('./window-control-policy.cjs');
const { createHost } = require('./window-control-host.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function transport(t) {
  const declaration = { executable: 'C:/verified/helper.exe', manifestSha256: 'hash' };
  const requests = []; let child;
  const backend = createBackend({ windowControl: declaration }, { verify: () => declaration, timeoutMs: 1000, spawnChild() {
    child = new EventEmitter(); child.exitCode = null; child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.stdin.write = line => requests.push(JSON.parse(line));
    child.stdin.end = () => { child.exitCode = 0; queueMicrotask(() => child.emit('exit', 0)); };
    child.kill = () => { child.exitCode = 1; child.emit('exit', 1); }; return child;
  } });
  t.after(() => backend.dispose());
  return { backend, requests, emit: value => child.stdout.emit('data', Buffer.from(value)) };
}
test('fragmented and coalesced stop events never settle a pending native action', async t => {
  const f = transport(t), received = [], event = { type: 'overlayStop', targetId: randomUUID(), generation: 3 };
  const subscription = f.backend.onOverlayStop(value => received.push(value));
  let settled = false; const action = f.backend.request('act', {}).then(value => { settled = true; return value; });
  await tick(); const line = JSON.stringify({ event }) + '\n';
  f.emit(line.slice(0, 15)); await tick(); assert.equal(received.length, 0);
  f.emit(line.slice(15) + line); await tick(); assert.deepEqual(received, [event, event]); assert.equal(settled, false);
  subscription.dispose(); f.emit(line); assert.equal(received.length, 2);
  f.emit(JSON.stringify({ id: f.requests[0].id, result: { acted: true } }) + '\n' + line);
  assert.deepEqual(await action, { acted: true }); assert.equal(received.length, 2);
});
for (const [name, event] of [
  ['wrong type', { type: 'stop', targetId: randomUUID(), generation: 0 }],
  ['negative generation', { type: 'overlayStop', targetId: randomUUID(), generation: -1 }],
  ['extra field', { type: 'overlayStop', targetId: randomUUID(), generation: 0, secret: 'x' }],
  ['invalid UUID', { type: 'overlayStop', targetId: '-'.repeat(36), generation: 0 }],
]) test('malformed event rejected: ' + name, async t => {
  const f = transport(t); let events = 0; f.backend.onOverlayStop(() => events++);
  const rejection = assert.rejects(f.backend.request('act', {}), error => error.code === 'connection_error' && error.mutationOutcome === 'unknown');
  await tick(); f.emit(JSON.stringify({ event }) + '\n'); await rejection; assert.equal(events, 0);
});
async function policy(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'azrael-overlay-test-'));
  const windows = [1, 2].map(id => ({ hwnd: String(id), pid: id, processCreated: 'created', executable: 'C:/app.exe', title: 'Private title', minimized: false, widthPx: 800, heightPx: 600, dpi: 96 }));
  const shown = [], hidden = [], calls = [], stops = [], diagnostics = []; let listener, n = 0, value = '', onAct, showError, hideError, disposed = false;
  const backend = {
    onOverlayStop(fn) { listener = fn; return { dispose() { listener = undefined; disposed = true; } }; },
    async showOverlay(params) { shown.push(params); if (showError) throw showError; return { visible: true, hotkeyRegistered: true }; },
    async hideOverlay(params) { hidden.push(params); if (hideError) throw hideError; return { visible: false }; },
    async request(method, params) {
      calls.push({ method, params }); if (method === 'listWindows') return windows;
      if (method === 'act') { if (onAct) await onAct(); if (params.action === 'setValue') value = params.value; }
      const window = windows.find(w => w.hwnd === params.window.hwnd);
      if (method === 'observe' || method === 'inspect') return { window, observationId: 'o' + ++n, frameTimestamp: 'now', widthPx: 800, heightPx: 600, dpi: 96, elementsTruncated: false, image: { mimeType: 'image/png', data: 'YQ==' }, elements: [{ id: 'e', name: 'Private element', automationId: 'input', controlType: 'Edit', patterns: ['Value', 'Invoke'], value }] };
      return { window };
    },
  };
  const owner = createWindowOwner({ backend, authorize: async () => true, codexHome: home, onUserStop: (thread, state) => stops.push({ thread, state }), onOverlayError: (thread, error) => diagnostics.push({ thread, error }) });
  t.after(async () => { owner.dispose(); await tick(); await fs.rm(home, { recursive: true, force: true }); });
  return { owner, backend, home, windows, shown, hidden, calls, stops, diagnostics, emit: event => listener?.(event), setAct: fn => { onAct = fn; }, setShowError: e => { showError = e; }, setHideError: e => { hideError = e; }, isDisposed: () => disposed };
}
test('stop bypasses stalled act, cancels queued mutation, and requires explicit resume', async t => {
  const f = await policy(t), a = await f.owner.bind('a', f.windows[0]), b = await f.owner.bind('b', f.windows[1]);
  const observation = await f.owner.call('a', 'capture', { targetId: a.targetId });
  let release, began; const started = new Promise(resolve => { began = resolve; });
  f.setAct(() => { began(); return new Promise(resolve => { release = resolve; }); });
  const pending = f.owner.call('a', 'invoke', { targetId: a.targetId, observationId: observation.observationId, elementId: 'e' });
  const pendingCheck = assert.rejects(pending, error => error.code === 'cancelled' && error.mutationOutcome === 'unknown'); await started;
  const queuedCheck = assert.rejects(f.owner.call('a', 'resize', { targetId: a.targetId, widthDip: 700, heightDip: 500 }), { code: 'cancelled' });
  const active = f.shown.at(-1);
  for (const event of [{ ...active, targetId: b.targetId }, { ...active, generation: active.generation + 1 }, { ...active, targetId: randomUUID() }]) f.emit(event);
  assert.equal(f.stops.length, 0);
  f.emit({ type: 'overlayStop', targetId: active.targetId, generation: active.generation });
  assert.equal(f.owner.peek('a').state, 'paused'); assert.equal(f.owner.peek('b').state, 'selected'); assert.equal(f.stops.length, 1);
  assert.ok(f.hidden.some(h => h.targetId === a.targetId && h.generation === active.generation));
  release(); await pendingCheck; await queuedCheck; f.setAct(undefined);
  assert.equal(f.calls.filter(c => c.method === 'resize').length, 0); assert.equal(f.owner.peek('a').state, 'paused');
  await assert.rejects(f.owner.call('a', 'capture', { targetId: a.targetId }), /resume/);
  const list = await f.owner.call('a', 'list_windows', {});
  await assert.rejects(f.owner.call('a', 'select_window', { candidateId: list.candidates[0].candidateId }), /explicit resume/);
  await f.owner.call('b', 'capture', { targetId: b.targetId });
  await f.owner.resume('a'); await f.owner.call('a', 'capture', { targetId: a.targetId });
  f.emit({ type: 'overlayStop', targetId: active.targetId, generation: active.generation }); assert.equal(f.owner.peek('a').state, 'ready');
  assert.equal(TOOLS.some(tool => /overlay|resume/.test(tool)), false);
  f.owner.dispose(); assert.equal(f.isDisposed(), true); f.emit({ type: 'overlayStop', targetId: active.targetId, generation: active.generation }); assert.equal(f.stops.length, 1);
});
test('manual selection releases only the successfully selected stopped identity', async t => {
  const f = await policy(t);
  await f.owner.bind('a', f.windows[0]); f.owner.stop('a');
  await f.owner.bind('a', f.windows[1]);
  async function modelSelectA() {
    const list = await f.owner.call('a', 'list_windows', {});
    return f.owner.call('a', 'select_window', { candidateId: list.candidates[0].candidateId });
  }
  await assert.rejects(modelSelectA(), /explicit resume/);
  const originalRequest = f.backend.request, failedBind = new Error('selected window unavailable');
  f.backend.request = async (method, params) => {
    if (method === 'status' && params.window.hwnd === f.windows[0].hwnd) throw failedBind;
    return originalRequest(method, params);
  };
  try { await assert.rejects(f.owner.bind('a', f.windows[0]), error => error === failedBind); }
  finally { f.backend.request = originalRequest; }
  await assert.rejects(modelSelectA(), /explicit resume/);
  await f.owner.bind('a', f.windows[0]);
  const selected = await modelSelectA(); assert.equal(selected.state, 'selected');
  await f.owner.call('a', 'capture', { targetId: selected.targetId });
});
test('show failure prevents mutation; hide failures reach diagnostics', async t => {
  const f = await policy(t), target = await f.owner.bind('a', f.windows[0]);
  const showError = new Error('overlay unavailable'); f.setShowError(showError);
  await assert.rejects(f.owner.call('a', 'resize', { targetId: target.targetId, widthDip: 700, heightDip: 500 }), error => error === showError);
  assert.equal(f.calls.some(c => c.method === 'resize'), false); assert.equal(f.hidden.length, 1);
  f.setShowError(undefined); const hideError = new Error('hide unavailable'); f.setHideError(hideError);
  await f.owner.call('a', 'capture', { targetId: target.targetId }); assert.equal(f.diagnostics.at(-1).error, hideError);
});
test('macro progress uses safe action and step labels without parameter content', async t => {
  const f = await policy(t), target = await f.owner.bind('a', f.windows[0]), secret = 'PRIVATE-PARAMETER';
  const selector = { automationId: 'input', controlType: 'Edit' };
  const result = await f.owner.call('a', 'run_task_macro', { targetId: target.targetId, parameters: { query: secret }, definition: { schema: 1, parameters: ['query'], steps: [{ action: 'set_value', selector, value: { parameter: 'query' }, postcondition: { selector, property: 'value', equals: { parameter: 'query' } } }, { action: 'assert', condition: { selector, property: 'value', equals: { parameter: 'query' } } }] } });
  assert.equal(result.status, 'completed');
  const labels = f.shown.map(s => s.label); assert.ok(labels.some(label => label.startsWith('1/2'))); assert.ok(labels.some(label => label.startsWith('2/2')));
  assert.equal(labels.some(label => /PRIVATE|Private|input|query/.test(label)), false); assert.ok(f.hidden.length);
});
test('host stop callback revokes only stopped thread approval during stalled act', async t => {
  const f = await policy(t); f.owner.dispose();
  const approvals = require('./window-use-approvals.cjs').createOwner(f.home);
  const host = createHost({ runtime: { codexHome: f.home }, occupancyDirectory: path.join(f.home, 'host-occupancy'), approvals,
    vscode: { window: { showInformationMessage: async () => '이 대화에서 허용' } }, backend: { ...f.backend, dispose: async () => {} },
    createServer: () => { const server = new EventEmitter(); server.listen = (_pipe, ready) => ready(); server.close = () => {}; return server; },
  });
  t.after(() => host.dispose());
  const native = { registerProvider: () => ({ dispose() {} }) }; host.attach(native, () => {});
  const ids = [randomUUID(), randomUUID()];
  for (const threadId of ids) { host.observe(native, { method: 'turn/started', params: { threadId, turn: { id: 'turn' } } }); await host.threads.get(threadId).ready; }
  const call = (threadId, tool, args = {}) => host.handlePipe({ nonce: host.nonce, threadId, method: 'call', tool, arguments: args, _meta: { threadId, 'codex/sandbox-state-meta': { permissionProfile: { type: 'disabled' } }, 'x-codex-turn-metadata': { thread_id: threadId, turn_id: 'turn' } } });
  const targets = [];
  for (const [index, id] of ids.entries()) { const list = await call(id, 'list_windows'); targets.push(await call(id, 'select_window', { candidateId: list.candidates[index].candidateId })); }
  const image = await call(ids[0], 'capture', { targetId: targets[0].targetId });
  let release, began; const started = new Promise(resolve => { began = resolve; });
  f.setAct(() => { began(); return new Promise(resolve => { release = resolve; }); });
  const flight = call(ids[0], 'invoke', { targetId: targets[0].targetId, observationId: image.observationId, elementId: 'e' }); const rejected = assert.rejects(flight, { code: 'cancelled' }); await started;
  const active = f.shown.at(-1); f.emit({ type: 'overlayStop', targetId: active.targetId, generation: active.generation });
  assert.equal(host.owner.peek(ids[0]).state, 'paused');
  assert.equal(approvals.hasAppApproval(f.windows[0].executable, ids[0]), false); assert.equal(approvals.hasAppApproval(f.windows[1].executable, ids[1]), true);
  release(); await rejected; f.setAct(undefined); await call(ids[1], 'capture', { targetId: targets[1].targetId });
  await host.dispose();
});

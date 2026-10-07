'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { test } = require('node:test');
const { windowError, errorPayload, fromPayload } = require('./window-control-errors.cjs');
const { createRelay, createProtocol, callResult, pipeRequest } = require('./window-control-mcp.cjs');
const threadId = '12345678-1234-1234-1234-123456789abc';
const meta = { threadId, 'codex/sandbox-state-meta': { permissionProfile: { type: 'disabled' } } };

test('session absence differs from unreadable or corrupt session state', async () => {
  for (const [cause, readFile, code] of [
    ['missing', async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }, 'selection_required'],
    ['denied', async () => { throw Object.assign(new Error('private path'), { code: 'EACCES' }); }, 'unclassified'],
    ['corrupt', async () => '{private content', 'unclassified'],
    ['oversized', async () => 'x'.repeat(16385), 'unclassified'],
  ]) {
    await assert.rejects(createRelay({ readFile })(threadId, 'status', {}, meta), e => e.code === code && !e.message.includes('private'), cause);
  }
});
test('corrupt saved task definitions are internal errors rather than invalid caller input', async t => {
  const prefix = path.join(os.tmpdir(), 'window-errors-store-'), home = await fs.mkdtemp(prefix);
  t.after(async () => { assert(path.resolve(home).startsWith(path.resolve(prefix))); await fs.rm(home, { recursive: true, force: true }); });
  const store = require('./window-task-macros.cjs').createStore(home);
  await fs.mkdir(path.dirname(store.file), { recursive: true });
  await fs.writeFile(store.file, JSON.stringify({ schema: 1, revision: 0, macros: [{ schema: 1 }] }));
  await assert.rejects(store.read(), e => e.code === 'unclassified' && e.stage === 'storage' && e.message === '미분류된 오류');
});

test('tool errors retain known recovery information and suppress arbitrary exception text', async () => {
  for (const thrown of [windowError('cancelled', 'Operation cancelled', { stage: 'approval', mutationOutcome: 'unknown' }), new Error('private provider content')]) {
    const protocol = createProtocol({ relay: async () => { throw thrown; } });
    const reply = await protocol({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'status', arguments: {}, _meta: meta } });
    assert.equal(reply.result.isError, true);
    const payload = JSON.parse(reply.result.content[0].text);
    assert.deepEqual(payload, errorPayload(thrown));
    assert.equal(payload.message.includes('private'), false);
  }
  const payload = errorPayload(windowError('connection_error', 'Window backend exited', { stage: 'native', nativeCode: 'worker-exit', exitCode: 7, signal: null }));
  assert.deepEqual(errorPayload(fromPayload(payload)), payload);
  assert.equal(fromPayload({ code: 'rare-new-code', message: 'private' }).message, '미분류된 오류');
});

function socketFixture() {
  const socket = new EventEmitter(); socket.destroy = () => {}; socket.write = () => {};
  socket.setTimeout = (ms, callback) => { socket.expire = callback; socket.timeoutMs = ms; };
  return socket;
}
test('minimized pause metadata round trips with strict enum and boolean validation', () => {
  for (const pauseReason of ['minimized', 'user_stopped', 'error']) {
    for (const restoreAllowed of [true, false]) {
      const payload = { code: 'window_minimized', message: '선택한 창이 최소화되었습니다.', pauseReason, restoreAllowed, actionExecuted: false };
      assert.deepEqual(errorPayload(windowError(payload.code, payload.message, payload)), payload);
      assert.deepEqual(errorPayload(fromPayload(JSON.parse(JSON.stringify(payload)))), payload);
    }
  }
  const plain = { code: 'window_minimized', message: '선택한 창이 최소화되었습니다.' };
  for (const invalid of [
    { pauseReason: 'unknown', restoreAllowed: 'true', actionExecuted: 0 },
    { pauseReason: 'MINIMIZED', restoreAllowed: 1, actionExecuted: null },
  ]) {
    assert.deepEqual(errorPayload(windowError(plain.code, plain.message, invalid)), plain);
    assert.deepEqual(errorPayload(fromPayload({ ...plain, ...invalid })), plain);
    assert.deepEqual(errorPayload({ ...plain, ...invalid }), plain);
  }
});
test('approval and native permission details survive serialization with strict field types', () => {
  for (const approvalState of ['waiting', 'expired', 'declined', 'cancelled', 'accepted']) {
    const payload = { code: approvalState === 'declined' ? 'approval_declined' : 'approval_timeout', message: 'Approval response', stage: 'approval', approvalState, userResponded: approvalState === 'declined', actionExecuted: false };
    assert.deepEqual(errorPayload(windowError(payload.code, payload.message, payload)), payload);
    assert.deepEqual(errorPayload(fromPayload(JSON.parse(JSON.stringify(payload)))), payload);
  }
  for (const nativePermissionReason of ['missing', 'malformed', 'not_disabled']) {
    const payload = { code: 'permission_denied', message: 'Native Disabled permission profile required', stage: 'permission', nativePermissionReason, actionExecuted: false };
    assert.deepEqual(errorPayload(fromPayload(payload)), payload);
  }
  const invalid = { approvalState: 'unknown', nativePermissionReason: 'secret', userResponded: 'false', actionExecuted: 0 };
  const plain = { code: 'approval_timeout', message: 'Awaiting approval' };
  assert.deepEqual(errorPayload(windowError(plain.code, plain.message, invalid)), plain);
  assert.deepEqual(errorPayload(fromPayload({ ...plain, ...invalid })), plain);
  assert.deepEqual(errorPayload({ ...plain, ...invalid }), plain);
  assert.deepEqual(errorPayload(windowError('cancelled', 'Cancelled', { approvalState: 'cancelled', userResponded: true, actionExecuted: true })), { code: 'cancelled', message: 'Cancelled', approvalState: 'cancelled', userResponded: true, actionExecuted: true });
});
test('approval progress is not a terminal result and expiry reports awaiting approval', async () => {
  const socket = socketFixture(); const request = pipeRequest('fixture', {}, { connect: () => socket });
  socket.emit('connect'); socket.emit('data', Buffer.from('{"progress":{"stage":"queued"}}\n{"progress":{"stage":"approval"}}\n'));
  socket.expire();
  await assert.rejects(request, e => e.code === 'approval_timeout' && e.stage === 'approval' && e.approvalState === 'expired' && e.userResponded === false && e.actionExecuted === false && !e.message.includes('host timed out'));
});

test('connection closing during approval reports expiry rather than user decline', async () => {
  for (const event of ['end', 'close']) {
    const socket = socketFixture(); const request = pipeRequest('fixture', { tool: 'select_window' }, { connect: () => socket });
    socket.emit('connect'); socket.emit('data', Buffer.from('{"progress":{"stage":"approval"}}\n')); socket.emit(event);
    await assert.rejects(request, e => e.code === 'approval_timeout' && e.approvalState === 'expired' && e.userResponded === false && e.actionExecuted === false);
  }
});

test('explicit decline stays distinct through host transport and model protocol', async () => {
  const payload = { code: 'approval_declined', message: 'Window Use approval declined', stage: 'approval', approvalState: 'declined', userResponded: true, actionExecuted: false };
  const socket = socketFixture();
  const protocol = createProtocol({ relay: () => pipeRequest('fixture', {}, { connect: () => socket }) });
  const reply = protocol({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'status', arguments: {}, _meta: meta } });
  socket.emit('connect'); socket.emit('data', Buffer.from(JSON.stringify({ error: payload }) + '\n'));
  assert.deepEqual(JSON.parse((await reply).result.content[0].text), payload);
});
test('fragmented progress and terminal response share a stream without losing structured cause', async () => {
  const socket = socketFixture(); const request = pipeRequest('fixture', {}, { connect: () => socket }); socket.emit('connect');
  const payload = errorPayload(windowError('permission_denied', 'Application authorization revoked', { stage: 'approval' }));
  const bytes = Buffer.from(JSON.stringify({ progress: { stage: 'running' } }) + '\n' + JSON.stringify({ error: payload }) + '\n');
  for (let i = 0; i < bytes.length; i++) socket.emit('data', bytes.subarray(i, i + 1));
  await assert.rejects(request, e => e.code === payload.code && e.message === payload.message);
});
test('transport expiry after a mutation starts does not imply the app was unchanged', async () => {
  for (const tool of ['invoke', 'status']) {
    const socket = socketFixture(); const request = pipeRequest('fixture', { tool }, { connect: () => socket }); socket.emit('connect');
    socket.emit('data', Buffer.from('{"progress":{"stage":"running"}}\n')); socket.expire();
    await assert.rejects(request, e => e.code === 'timeout' && e.mutationOutcome === (tool === 'invoke' ? 'unknown' : undefined));
  }
});
test('partial accessibility and experimental key flags survive model projection', () => {
  const projected = JSON.parse(callResult({ elements: [], elementsTruncated: true, experimental: true, delivery: 'windowMessage', verified: false }).content[0].text);
  assert.equal(projected.elementsTruncated, true); assert.equal(projected.experimental, true); assert.equal(projected.verified, false);
});

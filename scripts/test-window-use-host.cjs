'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { EventEmitter } = require('node:events');
const { createHost } = require('./window-control-host.cjs');
const ids = ['12345678-1234-1234-1234-123456789abc', '22345678-1234-1234-1234-123456789abc'];
async function fixture(t, delayed = false, occupancyDirectory) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'azrael-window-use-host-'));
  let releaseListen, panels = 0; const calls = [];
  const window = { hwnd: 'fixture', pid: 1, processCreated: 'created', executable: 'C:/fixture/app.exe', title: 'Fixture app', minimized: false, widthPx: 800, heightPx: 600, dpi: 96 };
  const approvals = require('./window-use-approvals.cjs').createOwner(home);
  const host = createHost({ occupancyDirectory: occupancyDirectory || path.join(home, 'occupancy'), runtime: { codexHome: home, workspacePath: 'C:/private/Workspace' }, approvals,
    vscode: { window: { createWebviewPanel() { panels++; throw new Error('ordinary thread must not open a panel'); }, showInformationMessage: async () => '이 대화에서 허용' } },
    backend: { request: async (method, params) => { calls.push({ method, params }); return method === 'listWindows' ? [window] : window; }, dispose: async () => {} },
    createServer: () => { const server = new EventEmitter(); server.listen = (_pipe, ready) => { releaseListen = ready; if (!delayed) ready(); }; server.close = () => {}; return server; },
  });
  const native = { registerProvider() { return { dispose() {} }; } };
  host.attach(native, () => {});
  t.after(async () => { releaseListen?.(); await host.dispose(); await fs.rm(home, { recursive: true, force: true }); });
  const file = id => path.join(home, 'azrael/computer-use/window-sessions', id + '.json');
  const started = (id = ids[0], turn = 'turn-one', engine = native) => host.observe(engine, { method: 'turn/started', params: { threadId: id, turn: { id: turn } } });
  const message = (id = ids[0], turn = 'turn-one') => ({ nonce: host.nonce, threadId: id, method: 'call', tool: 'status', arguments: {}, _meta: { threadId: id, 'codex/sandbox-state-meta': { permissionProfile: { type: 'disabled' } }, 'x-codex-turn-metadata': { thread_id: id, turn_id: turn } } });
  return { host, native, home, file, started, message, calls, approvals, release: () => releaseListen(), panels: () => panels };
}
async function replayResult(f, method, expected, returned = expected) {
  f.host.request(f.native, 'ordinary', 'request', method, { threadId: expected });
  const result = { id: 'ordinary:request', result: { thread: { id: returned } } };
  const reply = new Promise(resolve => assert.equal(f.host.beforeResult(f.native, result, resolve), true));
  return { reply, result };
}
test('ordinary start publishes the exact session before replay with no panel and repeats safely', async t => {
  const f = await fixture(t); const { reply, result } = await replayResult(f, 'thread/start', ids[0]);
  assert.equal(await reply, result);
  const record = JSON.parse(await fs.readFile(f.file(ids[0]), 'utf8'));
  assert.deepEqual(Object.keys(record).sort(), ['nonce', 'pipe', 'schema']); assert.equal(record.nonce, f.host.nonce);
  assert.equal(f.panels(), 0); assert.equal(f.host.threads.size, 1);
  f.host.observe(f.native, { method: 'thread/started', params: { thread: { id: ids[0] } } });
  const repeated = await replayResult(f, 'thread/resume', ids[0]); assert.equal(await repeated.reply, repeated.result);
  assert.equal(f.host.threads.size, 1); assert.deepEqual(JSON.parse(await fs.readFile(f.file(ids[0]), 'utf8')), record);
  assert.equal(f.host.beforeResult(f.native, result, () => assert.fail('duplicate replay')), false);
});
test('resume mismatch and cross-bridge ownership fail without replacing an existing session', async t => {
  const f = await fixture(t); f.started(); await f.host.threads.get(ids[0]).ready;
  const mismatch = await replayResult(f, 'thread/resume', ids[0], ids[1]); assert.match((await mismatch.reply).error.message, /initialization failed/); assert.equal(f.host.threads.has(ids[1]), false);
  const other = { registerProvider() { return { dispose() {} }; } }; f.host.attach(other, () => {});
  f.host.request(other, 'ordinary', 'other', 'thread/resume', { threadId: ids[0] });
  const reply = await new Promise(resolve => f.host.beforeResult(other, { id: 'ordinary:other', result: { thread: { id: ids[0] } } }, resolve));
  assert.match(reply.error.message, /initialization failed/); assert.equal(f.host.threads.get(ids[0]).bridge.native, f.native);
});
test('ordinary lifecycle tracks active turns and denies stale or inexact permission proof each call', async t => {
  const f = await fixture(t); f.started(); await f.host.threads.get(ids[0]).ready;
  for (const permissionProfile of [undefined, { type: 'managed', sandbox: 'danger-full-access' }, { type: 'disabled', extra: true }]) {
    const request = f.message(); request._meta['codex/sandbox-state-meta'] = { permissionProfile }; await assert.rejects(f.host.handlePipe(request), /denied/);
  }
  await assert.rejects(f.host.handlePipe(f.message(ids[0], 'old-turn')), /denied/);
  assert.equal((await f.host.handlePipe(f.message())).state, 'unbound');
  f.started(ids[0], 'new-turn'); await assert.rejects(f.host.handlePipe(f.message()), /denied/);
  f.host.observe(f.native, { method: 'turn/completed', params: { threadId: ids[0], turn: { status: 'cancelled' } } });
  assert.equal(f.host.threads.get(ids[0]).turnId, undefined); await assert.rejects(f.host.handlePipe(f.message(ids[0], 'new-turn')), /denied/); assert.equal(f.calls.length, 0);
});
test('ordinary threads select independently with app consent and reject stale candidates', async t => {
  const f = await fixture(t); f.started(); f.started(ids[1], 'turn-two'); await Promise.all(ids.map(id => f.host.threads.get(id).ready));
  const call = (id, tool, args = {}) => f.host.handlePipe({ ...f.message(id, id === ids[0] ? 'turn-one' : 'turn-two'), tool, arguments: args });
  const first = await call(ids[0], 'list_windows'); const second = await call(ids[1], 'list_windows');
  const stale = first.candidates[0].candidateId;
  const fresh = await call(ids[0], 'list_windows');
  await assert.rejects(call(ids[0], 'select_window', { candidateId: stale }), /candidate|expired|stale/i);
  await assert.rejects(call(ids[1], 'select_window', { candidateId: fresh.candidates[0].candidateId }), /candidate|expired|stale/i);
  const selected = await Promise.all([call(ids[0], 'select_window', { candidateId: fresh.candidates[0].candidateId }), call(ids[1], 'select_window', { candidateId: second.candidates[0].candidateId })]);
  assert.notEqual(selected[0].targetId, selected[1].targetId); assert.equal(f.panels(), 0);
  const occupancy = (await call(ids[0], 'status')).occupancy; assert.equal(occupancy.status,'occupied'); assert.deepEqual(occupancy.sessions.map(s=>s.isCurrentSession).sort(),[false,true]);
  for (const id of ids) assert.equal(f.approvals.hasAppApproval('C:/fixture/app.exe', id), true);
  f.host.observe(f.native, { method: 'thread/closed', params: { threadId: ids[0] } }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.approvals.hasAppApproval('C:/fixture/app.exe', ids[0]), false); assert.equal(f.approvals.hasAppApproval('C:/fixture/app.exe', ids[1]), true);
  const remaining = await call(ids[1], 'status'); assert.equal(remaining.targetId, selected[1].targetId); assert.equal(remaining.occupancy.status,'available');
});
test('session-file collision fails closed and preserves the other owner', async t => {
  const f = await fixture(t); await fs.mkdir(path.dirname(f.file(ids[0])), { recursive: true }); await fs.writeFile(f.file(ids[0]), '{"nonce":"other-owner"}');
  const result = await replayResult(f, 'thread/start', ids[0]); assert.match((await result.reply).error.message, /initialization failed/);
  assert.equal(f.host.threads.size, 0); assert.equal(await fs.readFile(f.file(ids[0]), 'utf8'), '{"nonce":"other-owner"}');
});
for (const boundary of ['disconnect', 'thread/closed']) test(`${boundary} during publication cancels ownership and removes its session`, async t => {
  const f = await fixture(t, true); const replies = [];
  f.host.request(f.native, 'ordinary', 'pending', 'thread/start', {});
  assert.equal(f.host.beforeResult(f.native, { id: 'ordinary:pending', result: { thread: { id: ids[0] } } }, reply => replies.push(reply)), true);
  const ready = f.host.threads.get(ids[0]).ready;
  if (boundary === 'disconnect') f.host.disconnect(f.native); else f.host.observe(f.native, { method: boundary, params: { threadId: ids[0] } });
  // Let the queued close mark registration cancelled before releasing publication.
  await new Promise(resolve => setImmediate(resolve));
  if (boundary === 'thread/closed') {
    f.host.request(f.native, 'ordinary', 'reuse', 'thread/resume', { threadId: ids[0] });
    assert.equal(f.host.beforeResult(f.native, { id: 'ordinary:reuse', result: { thread: { id: ids[0] } } }, reply => replies.push(reply)), true);
  }
  f.release(); await assert.rejects(ready, /cancelled/); await f.host.dispose();
  assert.equal(f.host.threads.size, 0); await assert.rejects(fs.stat(f.file(ids[0])), { code: 'ENOENT' });
  if (boundary === 'disconnect') assert.equal(replies.length, 0); else { assert.ok(replies.length >= 1); for (const reply of replies) assert.match(reply.error.message, /initialization failed/); }
});

test('different host code homes share occupancy and disconnect releases it', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(),'window-host-shared-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const a = await fixture(t,false,path.join(root,'occupancy')), b = await fixture(t,false,path.join(root,'occupancy'));
 a.started(ids[0]); b.started(ids[1],'turn-two'); await Promise.all([a.host.threads.get(ids[0]).ready,b.host.threads.get(ids[1]).ready]);
 const call=(f,id,turn,tool,args={})=>f.host.handlePipe({...f.message(id,turn),tool,arguments:args});
 const candidate=(await call(a,ids[0],'turn-one','list_windows')).candidates[0]; await call(a,ids[0],'turn-one','select_window',{candidateId:candidate.candidateId});
 const occupancy=(await call(b,ids[1],'turn-two','list_windows')).candidates[0].occupancy;
 assert.equal(occupancy.status,'occupied'); assert.equal(occupancy.sessions[0].workspaceName,'Workspace'); assert.equal(occupancy.sessions[0].sessionId,ids[0]); assert.equal(occupancy.sessions[0].isCurrentSession,false);
 a.host.disconnect(a.native); assert.equal((await call(b,ids[1],'turn-two','list_windows')).candidates[0].occupancy.status,'available');
});

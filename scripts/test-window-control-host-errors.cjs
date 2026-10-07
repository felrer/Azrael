'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { EventEmitter } = require('node:events');
const { createHost } = require('./window-control-host.cjs');
const thread = '12345678-1234-1234-1234-123456789abc';
const app = 'C:/fixture/app.exe';
async function fixture(t, approvalTimeoutMs = 100) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'azrael-window-errors-'));
  let connect, resolveAnswer, promptCount = 0, turn = 'turn-one';
  const approvals = require('./window-use-approvals.cjs').createOwner(home);
  const descriptor = { hwnd: 'fixture', pid: 1, processCreated: 'created', executable: app, title: 'Fixture', minimized: false, widthPx: 800, heightPx: 600, dpi: 96 };
  const host = createHost({ runtime: { codexHome: home }, occupancyDirectory: path.join(home, 'occupancy'), approvals, approvalTimeoutMs,
    vscode: { window: { showInformationMessage() { promptCount++; return new Promise(resolve => { resolveAnswer = resolve; }); } } },
    backend: { async request(method) { return method === 'listWindows' ? [descriptor] : descriptor; }, async dispose() {} },
    createServer(listener) { connect = listener; const server = new EventEmitter(); server.listen = (_pipe, done) => done(); server.close = () => {}; return server; }
  });
  const native = { registerProvider() { return { dispose() {} }; } }; host.attach(native, () => {});
  const started = id => { turn = id; host.observe(native, { method: 'turn/started', params: { threadId: thread, turn: { id } } }); };
  started(turn); await host.threads.get(thread).ready;
  t.after(async () => { await host.dispose(); await fs.rm(home, { recursive: true, force: true }); });
  const request = (tool, args = {}) => ({ nonce: host.nonce, threadId: thread, method: 'call', tool, arguments: args, _meta: { threadId: thread, 'codex/sandbox-state-meta': { permissionProfile: { type: 'disabled' } }, 'x-codex-turn-metadata': { thread_id: thread, turn_id: turn } } });
  function socketCall(tool, args) {
    const socket = new EventEmitter(), progress = []; let ended = false;
    socket.setTimeout = (_ms, fn) => { socket.expire = fn; }; socket.destroy = () => { socket.destroyed = true; socket.emit('close'); };
    socket.write = bytes => { progress.push(JSON.parse(bytes).progress.stage); };
    const reply = new Promise(resolve => { socket.end = bytes => { ended = true; resolve(JSON.parse(bytes)); }; });
    connect(socket); socket.emit('data', Buffer.from(JSON.stringify(request(tool, args)) + '\n'));
    return { socket, reply, progress, ended: () => ended };
  }
  async function candidate() { return (await host.handlePipe(request('list_windows'))).candidates[0].candidateId; }
  async function prompted() { for (let i = 0; i < 100 && !resolveAnswer; i++) await new Promise(resolve => setImmediate(resolve)); assert.ok(resolveAnswer); }
  return { host, native, home, approvals, request, started, socketCall, candidate, prompted, answer: value => resolveAnswer(value), promptCount: () => promptCount };
}

test('oversized requests report a request limit instead of an unexplained disconnect', async t => {
  const f = await fixture(t);
  const request = f.socketCall('status', { oversized: 'x'.repeat(65536) });
  const reply = await request.reply;
  assert.equal(reply.error.code, 'invalid_request');
  assert.equal(reply.error.message, '요청 크기가 Window Use 제한을 초과했습니다.');
});
test('unresolved approval times out, releases queued status, and ignores a late grant', async t => {
  const f = await fixture(t), selecting = f.socketCall('select_window', { candidateId: await f.candidate() }); await f.prompted();
  const status = f.socketCall('status');
  const result = await selecting.reply;
  assert.deepEqual(result.error, { code: 'approval_timeout', message: '승인 응답을 아직 받지 못해 대기 시간이 초과됐습니다.', stage: 'approval' });
  assert.deepEqual(selecting.progress, ['queued', 'running', 'approval']);
  assert.equal((await status.reply).result.state, 'unbound');
  f.answer('항상 허용'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.approvals.hasAppApproval(app, thread), false);
  assert.equal((await f.host.handlePipe(f.request('status'))).state, 'unbound');
});
for (const boundary of ['socket-close', 'socket-timeout', 'turn/started', 'turn/completed', 'disconnect', 'dispose']) test(`${boundary} cancels pending consent without a late grant`, async t => {
  const f = await fixture(t, 5000), selecting = f.socketCall('select_window', { candidateId: await f.candidate() }); await f.prompted();
  if (boundary === 'socket-close') selecting.socket.destroy();
  else if (boundary === 'socket-timeout') selecting.socket.expire();
  else if (boundary === 'turn/started') f.started('turn-two');
  else if (boundary === 'disconnect') f.host.disconnect(f.native);
  else if (boundary === 'dispose') await f.host.dispose();
  else f.host.observe(f.native, { method: boundary, params: { threadId: thread, turn: { status: 'completed' } } });
  if (!boundary.startsWith('socket')) assert.equal((await selecting.reply).error.code, 'cancelled');
  f.answer('항상 허용'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.approvals.hasAppApproval(app, thread), false);
  if (boundary.startsWith('socket')) { assert.equal(selecting.ended(), false); assert.equal((await f.socketCall('status').reply).result.state, 'unbound'); }
});
for (const [answer, code] of [['거부', 'approval_declined'], [undefined, 'cancelled']]) test(`approval answer ${String(answer)} yields ${code}`, async t => {
  const f = await fixture(t), selecting = f.socketCall('select_window', { candidateId: await f.candidate() }); await f.prompted(); f.answer(answer);
  assert.equal((await selecting.reply).error.code, code); assert.equal(f.approvals.hasAppApproval(app, thread), false);
});
for (const failure of ['store', 'settings', 'save']) test(`${failure} failure returns unclassified rather than refusal`, async t => {
  const f = await fixture(t), candidateId = await f.candidate();
  if (failure !== 'save') {
    const file = path.join(f.home, 'azrael', failure === 'store' ? 'window-use/app-approvals.json' : 'computer-use/use-settings.json');
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, 'corrupt');
  }
  const selecting = f.socketCall('select_window', { candidateId });
  if (failure === 'save') { await f.prompted(); const lock = path.join(f.home, 'azrael/window-use/app-approvals.json.lock'); await fs.mkdir(path.dirname(lock), { recursive: true }); await fs.writeFile(lock, 'occupied'); f.answer('항상 허용'); }
  assert.deepEqual((await selecting.reply).error, { code: 'unclassified', message: '미분류된 오류' });
});
test('a disconnected queued request never starts or opens another modal', async t => {
  const f = await fixture(t), selecting = f.socketCall('select_window', { candidateId: await f.candidate() }); await f.prompted();
  const queued = f.socketCall('select_window', { candidateId: 'unused' }); queued.socket.destroy(); f.answer('거부');
  await selecting.reply; await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(queued.progress, ['queued']); assert.equal(queued.ended(), false); assert.equal(f.promptCount(), 1);
});
for (const revocation of ['app', 'policy']) test(`${revocation} revocation during consent returns permission_denied`, async t => {
  const f = await fixture(t), selecting = f.socketCall('select_window', { candidateId: await f.candidate() }); await f.prompted();
  if (revocation === 'app') f.approvals.removeAppApproval(app);
  else require('./use-control-settings.cjs').createSettingsOwner(f.home).updateSettings({ windowUseAllowAll: true }, 0);
  f.answer('항상 허용');
  assert.deepEqual((await selecting.reply).error, { code: 'permission_denied', message: 'Application authorization revoked' });
  assert.deepEqual(f.approvals.getPersistentAppApprovals(), { approvedApps: [] });
});
for (const grant of ['stored', 'accepted']) test(`${grant} consent with no resulting grant returns permission_denied`, async t => {
  const f = await fixture(t), candidateId = await f.candidate();
  f.approvals.hasAppApproval = () => false;
  if (grant === 'stored') f.approvals.receive = (request, send) => send(request.id, { action: 'accept' });
  const selecting = f.socketCall('select_window', { candidateId });
  if (grant === 'accepted') { await f.prompted(); f.answer('이 대화에서 허용'); }
  assert.deepEqual((await selecting.reply).error, { code: 'permission_denied', message: 'Application authorization revoked', stage: 'approval' });
});

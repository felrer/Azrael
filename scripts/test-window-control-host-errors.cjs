'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { EventEmitter } = require('node:events');
const { createHost } = require('./window-control-host.cjs');
const thread = '12345678-1234-1234-1234-123456789abc';
const app = 'C:/fixture/app.exe';
test('recoverable observation failure survives the host pipe and permits the next capture', async t => {
  const { windowError } = require('./window-control-errors.cjs');
  let failed = true, sequence = 0;
  const f = await fixture(t, 1000, {}, true, (method, _args, descriptor) => {
    if (method === 'listWindows') return [descriptor];
    if (method !== 'observe') return { window: descriptor };
    if (failed) throw windowError('state_changed', 'Accessibility element unavailable', { nativeCode: 'stale-element' });
    return { window: descriptor, observationId: 'host-observation-' + ++sequence, frameTimestamp: 'now',
      widthPx: 800, heightPx: 600, dpi: 96, elementsTruncated: false, elements: [], image: { mimeType: 'image/png', data: 'YQ==' } };
  });
  const selecting = f.socketCall('select_window', { candidateId: await f.candidate() });
  await f.prompted(); f.answer('이번 대화');
  const selected = (await selecting.reply).result;
  assert.ok(selected.targetId);
  const args = { targetId: selected.targetId };
  const response = await f.socketCall('capture', args).reply;
  assert.equal(response.error.recovery, 'observe_again'); assert.equal(response.error.observationRequired, true); assert.equal(response.error.actionExecuted, false);
  const status = (await f.socketCall('status', {}).reply).result;
  assert.equal(status.state, 'ready'); assert.equal(status.observationRequired, true); assert.equal(status.targetId, selected.targetId);
  failed = false;
  const captured = (await f.socketCall('capture', args).reply).result;
  assert.equal(captured.state, 'ready'); assert.equal(captured.observationId, 'host-observation-1');
});
async function fixture(t, approvalTimeoutMs = 100, runtimeOverrides = {}, registerThread = true, requestBackend) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'azrael-window-errors-'));
  let connect, resolveAnswer, latestRequest, promptCount = 0, posts = [], turn = 'turn-one';
  const approvals = require('./window-use-approvals.cjs').createOwner(home);
  const descriptor = { hwnd: 'fixture', pid: 1, processCreated: 'created', executable: app, title: 'Fixture', minimized: false, widthPx: 800, heightPx: 600, dpi: 96 };
  const host = createHost({ runtime: { codexHome: home, ...runtimeOverrides }, occupancyDirectory: path.join(home, 'occupancy'), approvals, approvalTimeoutMs,
    vscode: { window: { showInformationMessage() { throw Error('External consent modal forbidden'); } } },
    backend: { async request(method, args) { return requestBackend ? requestBackend(method, args, descriptor) : method === 'listWindows' ? [descriptor] : descriptor; }, async dispose() {} },
    createServer(listener) { connect = listener; const server = new EventEmitter(); server.listen = (_pipe, done) => done(); server.close = () => {}; return server; }
  });
  const native = { registerProvider() { return { dispose() {} }; } }; host.attach(native, () => {});
  host.registerApprovalUI(native, envelope => { posts.push(envelope); if (envelope.type === 'mcp-request') { promptCount++; latestRequest = envelope.request; resolveAnswer = value => host.respondApproval(native, envelope.request.id, { action: value === '거부' ? 'decline' : value === undefined ? 'cancel' : 'accept', content: { persist: value === '항상 허용' ? 'always' : 'session' } }); } });
  const started = id => { turn = id; host.observe(native, { method: 'turn/started', params: { threadId: thread, turn: { id } } }); };
  if (registerThread) { started(turn); await host.threads.get(thread).ready; }
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
  return { host, native, home, approvals, posts, latestRequest: () => latestRequest, request, started, socketCall, candidate, prompted, answer: value => resolveAnswer(value), promptCount: () => promptCount };
}

for (const method of ['thread/start', 'thread/resume']) test(`${method} pins Window Use relay to the declared release without mutating user configuration`, async t => {
  const directory = path.resolve('artifacts/runtime-fixture/computer-use'), mcpScript = path.resolve('artifacts/runtime-fixture/window-control-mcp.cjs');
  const f = await fixture(t, 100, { computerUse: { directory }, windowControl: { mcpScript } });
  const params = { threadId: thread, config: { 'mcp_servers.azrael_window.command': 'C:/old/r6/node.exe', 'mcp_servers.azrael_window.args': ['C:/old/r6/window-control-mcp.cjs'], 'mcp_servers.azrael_window.env.CODEX_HOME': 'C:/old/home', 'mcp_servers.azrael_window.enabled': false, 'mcp_servers.other.command': 'other-command', 'model': 'preserved' } };
  const before = structuredClone(params), prepared = f.host.prepareRequest(method, params);
  assert.notEqual(prepared, params); assert.notEqual(prepared.config, params.config); assert.deepEqual(params, before);
  assert.deepEqual(prepared, { ...params, config: { ...params.config, 'mcp_servers.azrael_window.command': path.join(directory, 'node.exe'), 'mcp_servers.azrael_window.args': [mcpScript], 'mcp_servers.azrael_window.env.CODEX_HOME': f.home } });
  assert.equal(f.host.prepareRequest('turn/start', params), params);
});
test('synthetic fixtures and inactive module wrapper preserve original request objects', async t => {
  const f = await fixture(t), params = { config: { 'mcp_servers.azrael_window.enabled': false } };
  assert.equal(f.host.prepareRequest('thread/start', params), params); assert.equal(f.host.prepareRequest('thread/resume', params), params);
  assert.equal(require('./window-control-host.cjs').prepareRequest('thread/start', params), params);
});
for (const runtime of [{ windowControl: {} }, { windowControl: { mcpScript: 'relative.cjs' }, computerUse: { directory: 'C:/runtime' } }, { windowControl: { mcpScript: 'C:/runtime/mcp.cjs' }, computerUse: { directory: 'relative' } }, { windowControl: { mcpScript: 'C:/runtime/mcp.cjs' }, computerUse: { directory: 'C:/runtime' }, codexHome: 'relative' }]) test('incomplete declared runtime fails closed at the owned thread boundary', async t => {
  const f = await fixture(t, 100, runtime, false);
  for (const method of ['thread/start', 'thread/resume']) assert.throws(() => f.host.prepareRequest(method, {}), { code: 'connection_error', stage: 'connection', message: 'Window Use runtime binding is incomplete' });
});
test('dedicated start uses the same release binding and explicitly enables Window Use', async t => {
  const directory = path.resolve('artifacts/runtime-fixture/computer-use'), mcpScript = path.resolve('artifacts/runtime-fixture/window-control-mcp.cjs');
  const f = await fixture(t, 100, { computerUse: { directory }, windowControl: { mcpScript }, workspacePath: 'C:/fixture' }); let request;
  f.host.attach(f.native).rpc = async (method, params) => { request = { method, params }; return { computerUseMode: 'selectedWindow', thread: { id: thread } }; };
  await f.host.startThread(); assert.equal(request.method, 'thread/start'); assert.equal(request.params.config['mcp_servers.azrael_window.enabled'], true); assert.equal(request.params.config['mcp_servers.azrael_window.command'], path.join(directory, 'node.exe')); assert.deepEqual(request.params.config['mcp_servers.azrael_window.args'], [mcpScript]); assert.equal(request.params.config['mcp_servers.azrael_window.env.CODEX_HOME'], f.home);
});

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
  assert.deepEqual(result.error, { code: 'approval_timeout', message: '승인 응답을 아직 받지 못해 대기 시간이 초과됐습니다.', stage: 'approval', approvalState: 'expired', userResponded: false, actionExecuted: false });
  assert.equal(f.host.owner.peek(thread)?.targetId, undefined);
  assert.equal(f.posts.at(-1).notification.method, 'serverRequest/resolved');
  assert.deepEqual(f.posts.at(-1).notification.params, { threadId: thread, requestId: f.latestRequest().id });
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
  if (!boundary.startsWith('socket')) { const error = (await selecting.reply).error; assert.equal(error.code, 'cancelled'); assert.equal(error.approvalState, 'cancelled'); assert.equal(error.userResponded, false); assert.equal(error.actionExecuted, false); }
  f.answer('항상 허용'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.approvals.hasAppApproval(app, thread), false);
  if (boundary.startsWith('socket')) { assert.equal(selecting.ended(), false); assert.equal((await f.socketCall('status').reply).result.state, 'unbound'); }
});
for (const [answer, code] of [['거부', 'approval_declined'], [undefined, 'cancelled']]) test(`approval answer ${String(answer)} yields ${code}`, async t => {
  const f = await fixture(t), selecting = f.socketCall('select_window', { candidateId: await f.candidate() }); await f.prompted(); f.answer(answer);
  const error = (await selecting.reply).error; assert.equal(error.code, code); assert.equal(error.approvalState, code === 'approval_declined' ? 'declined' : 'cancelled'); assert.equal(error.userResponded, true); assert.equal(error.actionExecuted, false); assert.equal(f.approvals.hasAppApproval(app, thread), false);
});
for (const [answer, persistent] of [['이 대화에서 허용', false], ['항상 허용', true]]) test(`${answer} grants only the chosen scope`, async t => {
  const f = await fixture(t), selecting = f.socketCall('select_window', { candidateId: await f.candidate() }); await f.prompted();
  const request = f.latestRequest(); assert.match(request.id, /^azrael-window-consent-/); assert.equal(request.params.mode, 'form'); assert.deepEqual(request.params.requestedSchema, { type: 'object', properties: {} }); assert.equal(request.params._meta.connector_name, 'Window Use'); assert.equal(request.params._meta.codex_approval_kind, 'mcp_tool_call'); assert.equal(request.params._meta.tool_params_display[0].display_name, 'App');
  f.answer(answer); assert.ok((await selecting.reply).result.targetId); assert.equal(f.approvals.hasAppApproval(app, thread), true); f.approvals.stop(thread); assert.equal(f.approvals.hasAppApproval(app, thread), persistent);
});
test('wrong native, unknown IDs and malformed answers cannot grant authority', async t => {
  const f = await fixture(t), selecting = f.socketCall('select_window', { candidateId: await f.candidate() }); await f.prompted();
  const id = f.latestRequest().id, answer = { action: 'accept', content: { persist: 'always' } };
  assert.equal(f.host.respondApproval({}, id, answer), true); assert.equal(f.host.respondApproval(f.native, 'azrael-window-consent-retired', answer), true); assert.equal(f.host.respondApproval(f.native, 'engine-request', answer), false);
  assert.equal(f.host.respondApproval(f.native, id, { action: 'accept', content: { persist: 'invalid' } }), true); assert.equal(f.approvals.hasAppApproval(app, thread), false);
  f.answer('거부'); assert.equal((await selecting.reply).error.code, 'approval_declined'); assert.equal(f.host.respondApproval(f.native, id, answer), true); assert.equal(f.approvals.hasAppApproval(app, thread), false);
});
test('missing UI transport fails explicitly without a fallback modal', async t => {
  const f = await fixture(t); f.host.registerApprovalUI(f.native, undefined);
  const result = await f.socketCall('select_window', { candidateId: await f.candidate() }).reply;
  assert.equal(result.error.code, 'connection_error'); assert.equal(result.error.userResponded, false); assert.equal(result.error.actionExecuted, false); assert.equal(f.promptCount(), 0); assert.equal(f.approvals.hasAppApproval(app, thread), false);
});
for (const delivery of ['false', 'throw', 'reject', 'hang']) test(`UI delivery ${delivery} releases approval without authority`, async t => {
  const f = await fixture(t, 20); f.host.registerApprovalUI(f.native, envelope => {
    if (envelope.type === 'mcp-notification') return new Promise(() => {});
    if (delivery === 'false') return false; if (delivery === 'throw') throw new Error('transport'); if (delivery === 'reject') return Promise.reject(new Error('transport')); return new Promise(() => {});
  });
  const result = await f.socketCall('select_window', { candidateId: await f.candidate() }).reply;
  assert.equal(result.error.code, delivery === 'hang' ? 'approval_timeout' : 'connection_error'); assert.equal(result.error.userResponded, false); assert.equal(f.approvals.hasAppApproval(app, thread), false);
});
test('native card persistence metadata retains session scope', async t => {
  const f = await fixture(t), selecting = f.socketCall('select_window', { candidateId: await f.candidate() }); await f.prompted();
  assert.equal(f.host.respondApproval(f.native, f.latestRequest().id, { action: 'accept', _meta: { persist: 'session' } }), true);
  assert.ok((await selecting.reply).result.targetId); assert.equal(f.approvals.hasAppApproval(app, thread), true); f.approvals.stop(thread); assert.equal(f.approvals.hasAppApproval(app, thread), false);
});
test('replacing a UI registration cancels its pending consent and retires its answer', async t => {
  const f = await fixture(t), selecting = f.socketCall('select_window', { candidateId: await f.candidate() }); await f.prompted();
  f.host.registerApprovalUI(f.native, () => {});
  const error = (await selecting.reply).error; assert.equal(error.code, 'cancelled'); assert.equal(error.userResponded, false); assert.equal(error.actionExecuted, false);
  f.answer('항상 허용'); assert.equal(f.approvals.hasAppApproval(app, thread), false);
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
test('a disconnected queued request never starts or opens another approval', async t => {
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

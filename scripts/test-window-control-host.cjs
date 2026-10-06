'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createHost } = require('./window-control-host.cjs');
const thread = '12345678-1234-1234-1234-123456789abc';
const descriptor = { hwnd: 'window', pid: 1, processCreated: 'created', executable: 'C:/프로그램/한글앱.exe', title: '<한글 창 제목>', minimized: false, widthPx: 800, heightPx: 600, dpi: 96 };
async function main() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'azrael-window-host-'));
  try {
    let consent = '이 대화에서 허용', echo = 'selectedWindow', sandbox = 'danger-full-access', calls = 0, closed = 0, observedRequest, resolveConsent, deferConsent = false, deferTurn = false, turnReply, backendFailure, connectSocket, actedValue, permissionProfile = { type: 'disabled' }, skipDelivery = false, deferUI = false, uiReply, latestUIMessage, picker;
    const approvals = require('./window-use-approvals.cjs').createOwner(home);
    const receive = approvals.receive; approvals.receive = (request, ...args) => { observedRequest = request; return receive(request, ...args); };
    const posts = []; const panel = { webview: { html: '', postMessage(value) { posts.push(value); }, onDidReceiveMessage() {} }, onDidDispose() {}, reveal() {}, dispose() {} };
    const vscode = { ViewColumn: { One: 1 }, workspace: { workspaceFolders: [{ uri: { fsPath: 'C:/workspace' } }] }, window: { createWebviewPanel: () => panel, showInformationMessage: async () => deferConsent ? new Promise(r => { resolveConsent = r; }) : consent, showQuickPick: async values => { picker = values; return values[0]; } } };
    const backend = { request: async (method, params) => { calls++; if (backendFailure) throw new Error(backendFailure); if (method === 'listWindows') return [descriptor]; if (method === 'act') actedValue = params.value; if (method === 'observe') return { window: descriptor, observationId: 'observation', frameTimestamp: 'fresh', widthPx: 800, heightPx: 600, dpi: 96, elementsTruncated: false, elements: [{ id: 'element', name: '입력 영역', controlType: 'Edit', patterns: ['setValue'] }], image: { mimeType: 'image/png', data: 'YWJj' } }; return descriptor; }, dispose: async () => {} };
    const createServer = listener => { connectSocket = listener; const server = new EventEmitter(); server.listen = (_pipe, done) => done(); server.close = () => { closed++; }; return server; };
    async function fragmentedPipe(message) { const socket = new EventEmitter(); socket.setTimeout = () => {}; socket.destroy = () => {}; const reply = new Promise(resolve => { socket.end = bytes => resolve(JSON.parse(bytes)); }); connectSocket(socket); const bytes = Buffer.from(JSON.stringify(message) + '\n'); for (let i = 0; i < bytes.length; i++) socket.emit('data', bytes.subarray(i, i + 1)); return reply; }
    const host = createHost({ occupancyDirectory: path.join(home, 'occupancy'), runtime: { codexHome: home }, vscode, backend, approvals, createServer });
    let callbacks; const native = { registerProvider(_id, value) { callbacks = value; return { dispose() {} }; } };
    const requests = []; host.attach(native, (_provider, id, method, params) => {
      requests.push({ method, params });
      if (method === 'mcpServer/tool/call') {
        assert.deepEqual(Object.keys(params.arguments), ['requestToken']); assert.equal(params.server, 'azrael_window'); assert.equal(params.tool, 'ui_operation');
        latestUIMessage = { nonce: host.nonce, threadId: params.threadId, method: 'call', tool: 'ui_operation', arguments: params.arguments, _meta: { threadId: params.threadId, ...(permissionProfile ? { 'codex/sandbox-state-meta': { permissionProfile } } : {}) } };
        const proofMessage = latestUIMessage;
        const deliver = async () => { const response = skipDelivery ? { result: {} } : await fragmentedPipe(proofMessage); callbacks.onResult({ id, ...(response.error ? { error: { message: response.error } } : { result: { content: [] } }) }); };
        if (deferUI) uiReply = deliver; else queueMicrotask(() => { void deliver(); }); return;
      }
      const reply = () => callbacks.onResult({ id, result: method === 'thread/start' ? { computerUseMode: echo, thread: { id: thread }, sandbox: { type: sandbox } } : { turn: { id: 'turn-one' } } }); if (method === 'turn/start' && deferTurn) turnReply = reply; else queueMicrotask(reply);
    });
    host.open(); const ui = type => host.handleUI({ type, nonce: host.panelNonce });
    await assert.rejects(host.handleUI({ type: 'start', nonce: 'forged' }), /Invalid panel/); await assert.rejects(ui('arbitrary'), /Unknown panel/); await assert.rejects(host.handleUI({ type: 'select', nonce: host.panelNonce, selection: descriptor }), /Invalid panel/);
    echo = undefined; await assert.rejects(ui('start'), /did not verify/); assert.equal(host.threads.size, 0); assert.equal(calls, 0);
    echo = 'selectedWindow'; sandbox = 'danger-full-access'; permissionProfile = { type: 'managed', sandbox: 'danger-full-access' }; await ui('start'); await assert.rejects(ui('select'), /denied/); assert.equal(calls, 0);
    permissionProfile = undefined; await assert.rejects(ui('select'), /denied/); assert.equal(calls, 0); permissionProfile = { type: 'disabled', extra: true }; await assert.rejects(ui('select'), /denied/); assert.equal(calls, 0); permissionProfile = { type: 'disabled' }; skipDelivery = true; await assert.rejects(ui('select'), /not delivered/); assert.equal(calls, 0); skipDelivery = false;
    await ui('clear'); await assert.rejects(fs.stat(path.join(home, 'azrael', 'computer-use', 'window-sessions', thread + '.json')), { code: 'ENOENT' });
    sandbox = 'read-only'; consent = '거부'; await ui('start'); assert.equal(host.threads.get(thread).sandbox, undefined); await assert.rejects(ui('select'), /refused/); assert.equal(observedRequest.params._meta.connector_id, 'window-use'); assert.deepEqual(observedRequest.params._meta.persist, ['session', 'always']);
    deferConsent = true; const lateSelection = ui('select'); while (!resolveConsent) await new Promise(r => setImmediate(r)); await ui('pause'); resolveConsent('이 대화에서 허용'); await assert.rejects(lateSelection, /refused|cancelled/); assert.equal(approvals.hasAppApproval(descriptor.executable, thread), false); deferConsent = false;
    const other = require('./window-control-policy.cjs').createWindowOwner({ backend, authorize: async () => true, codexHome: path.join(home,'other-home'), occupancyDirectory: path.join(home,'occupancy'), workspaceName: 'Other workspace' });
    await other.bind('other-session', descriptor);
    consent = '이 대화에서 허용'; await ui('select');
    assert.equal(picker[0].detail, 'Other workspace · 대화 other-session · 선택됨'); assert.equal(typeof picker[0].id,'string'); assert.equal(picker[0].hwnd,undefined); assert.equal(host.owner.peek(thread).occupancy.status,'occupied'); other.stop('other-session'); await ui('select'); assert.equal(picker[0].detail,'Other workspace · 대화 other-session · 일시정지');
    other.dispose();
    let advisoryState = 'ready'; const advisory = require('./window-control-occupancy.cjs').createRegistry({directory:path.join(home,'occupancy'),entries:()=>[{sessionId:'advisory-session',workspaceName:'Other workspace',state:advisoryState,window:descriptor}]});
    for (const [state,label] of [['ready','준비'],['running','실행 중']]) { advisoryState = state; advisory.publish(); await ui('select'); assert.equal(picker[0].detail,`Other workspace · 대화 advisory-session · ${label}`); }
    advisory.dispose(); await ui('select'); assert.equal(picker[0].detail,'사용 가능');
    const malformedRecord = path.join(home,'occupancy','11111111-1111-1111-1111-111111111111.json'); await fs.writeFile(malformedRecord,'{'); await ui('select'); assert.equal(picker[0].detail,'점유 상태 확인 불가'); await fs.unlink(malformedRecord);
    assert.equal(approvals.hasAppApproval(descriptor.executable, thread), true); assert.equal(requests.find(r => r.method === 'thread/start').params.sandbox, undefined);
    await ui('capture'); assert.equal(posts.at(-1).value.image.data, 'YWJj');
    await assert.rejects(host.handlePipe(latestUIMessage), /token/);
    await host.handleUI({ nonce: host.panelNonce, type: 'send', text: 'Work with this selected window' });
    assert.equal(posts.at(-1).value.image, undefined); assert.deepEqual(requests.find(r => r.method === 'turn/start').params.input[0].text_elements, []);
    await assert.rejects(host.handleUI({ nonce: host.panelNonce, type: 'send', text: 'duplicate' }), /현재 실행/);
    const beforeActiveUI = calls; await assert.rejects(ui('capture'), /현재 실행/); await assert.rejects(ui('select'), /현재 실행/); assert.equal(calls, beforeActiveUI);
    const message = { nonce: host.nonce, threadId: thread, method: 'call', tool: 'status', arguments: { targetId: 'wrong' }, _meta: { threadId: thread, 'codex/sandbox-state-meta': { permissionProfile: { type: 'disabled' } }, 'x-codex-turn-metadata': { thread_id: thread, turn_id: 'turn-one', sandbox_mode: 'danger-full-access' } } };
    const modelCapture = () => host.handlePipe({ ...message, tool: 'capture', arguments: { targetId: posts.filter(p => p.type === 'state' && p.value.targetId).at(-1).value.targetId } });
    await assert.rejects(host.handlePipe({ ...message, nonce: '0'.repeat(64) }), /authentication/);
    await assert.rejects(host.handlePipe({ ...message, method: 'bind' }), /Unknown/);
    await assert.rejects(host.handlePipe({ ...message, _meta: { ...message._meta, 'codex/sandbox-state-meta': { permissionProfile: { type: 'managed', sandbox: 'danger-full-access' } } } }), /denied/);
    await assert.rejects(host.handlePipe({ ...message, _meta: { threadId: thread, 'x-codex-turn-metadata': message._meta['x-codex-turn-metadata'] } }), /denied/);
    await assert.rejects(host.handlePipe(message), /forged target/);
    await modelCapture(); const unicodeObservation = posts.at(-1).value; assert.equal(unicodeObservation.window.title, descriptor.title); assert.equal(unicodeObservation.elements[0].name, '입력 영역');
    const unicodeReply = await fragmentedPipe({ ...message, tool: 'set_value', arguments: { targetId: unicodeObservation.targetId, observationId: unicodeObservation.observationId, elementId: 'element', value: '한글 입력 값 🧪' } }); assert.equal(unicodeReply.error, undefined); assert.equal(actedValue, '한글 입력 값 🧪'); assert.equal(unicodeReply.result.window.title, descriptor.title); assert.equal(observedRequest.params._meta.tool_params.app, descriptor.executable);
    await modelCapture(); const boundTarget = posts.at(-1).value.targetId;
    backendFailure = 'Native input interference'; let beforeFailure = calls;
    await assert.rejects(host.handlePipe({ ...message, tool: 'capture', arguments: { targetId: boundTarget } }), /Native input interference/);
    assert.equal(calls, beforeFailure + 1); assert.equal(posts.at(-1).value.state, 'paused'); assert.equal(posts.at(-1).value.image, undefined); assert.equal(posts.at(-1).value.elements, undefined); assert.equal(approvals.hasAppApproval(descriptor.executable, thread), true);
    backendFailure = undefined; host.observe(native, { method: 'turn/completed', params: { threadId: thread, turn: { status: 'completed' } } }); await ui('resume'); assert.equal(posts.at(-1).value.image.data, 'YWJj'); backendFailure = 'Native window read failed'; beforeFailure = calls;
    await assert.rejects(ui('capture'), /Native window read failed/); assert.equal(calls, beforeFailure + 1); assert.equal(posts.at(-1).value.state, 'paused'); assert.equal(posts.at(-1).value.image, undefined); assert.equal(posts.at(-1).value.observationId, undefined);
    backendFailure = undefined; await ui('resume');
    await ui('capture'); const target = posts.at(-1).value.targetId; host.observe(native, { method: 'turn/completed', params: { threadId: thread, turn: { status: 'completed' } } }); assert.equal(posts.at(-1).value.image, undefined); assert.equal(posts.at(-1).value.observationId, undefined); assert.equal(posts.at(-1).value.targetId, target);
    deferTurn = true; const pendingSend = host.handleUI({ nonce: host.panelNonce, type: 'send', text: 'Race' }); while (!turnReply) await new Promise(r => setImmediate(r)); host.observe(native, { method: 'turn/started', params: { threadId: thread, turn: { id: 'authoritative-turn' } } }); host.observe(native, { method: 'turn/completed', params: { threadId: thread, turn: { status: 'completed' } } }); turnReply(); await pendingSend; assert.equal(host.threads.get(thread).turnId, undefined); deferTurn = false;
    await ui('pause'); assert.equal(approvals.hasAppApproval(descriptor.executable, thread), false); await ui('resume'); assert.equal(approvals.hasAppApproval(descriptor.executable, thread), true);
    deferUI = true; uiReply = undefined; let pendingUI = ui('capture'); while (!uiReply) await new Promise(r => setImmediate(r)); beforeFailure = calls;
    await assert.rejects(host.handlePipe({ ...latestUIMessage, _meta: { ...latestUIMessage._meta, 'x-codex-turn-metadata': { thread_id: thread, turn_id: 'model' } } }), /proof/); assert.equal(calls, beforeFailure); await uiReply(); await pendingUI;
    uiReply = undefined; pendingUI = ui('capture'); while (!uiReply) await new Promise(r => setImmediate(r)); beforeFailure = calls; await ui('pause'); await uiReply(); await assert.rejects(pendingUI, /token|cancelled/); assert.equal(calls, beforeFailure); deferUI = false; await ui('resume');
    approvals.removeAppApproval(descriptor.executable); beforeFailure = calls; await assert.rejects(ui('capture'), /revoked/); assert.equal(calls, beforeFailure); await ui('resume');
    deferUI = true; uiReply = undefined; pendingUI = ui('capture'); while (!uiReply) await new Promise(r => setImmediate(r)); beforeFailure = calls; const clearing = ui('clear'); await uiReply(); await assert.rejects(pendingUI, /token|cancelled/); await clearing; assert.equal(calls, beforeFailure); assert.equal(host.threads.size, 0); deferUI = false; await ui('start'); await ui('select');
    await ui('pause'); consent = '항상 허용'; await ui('resume'); await ui('pause'); assert.equal(approvals.hasAppApproval(descriptor.executable, thread), true); approvals.removeAppApproval(descriptor.executable); consent = '이 대화에서 허용'; await ui('resume');
    host.observe(native, { method: 'thread/closed', params: { threadId: 'ordinary-thread' } }); assert.equal(host.threads.size, 1);
    const file = path.join(home, 'azrael', 'computer-use', 'window-sessions', thread + '.json'); const rendezvous = JSON.parse(await fs.readFile(file, 'utf8')); assert.deepEqual(Object.keys(rendezvous).sort(), ['nonce', 'pipe', 'schema']);
    await fs.writeFile(file, JSON.stringify({ ...rendezvous, nonce: 'other-owner' })); host.disconnect(native); assert.equal(approvals.hasAppApproval(descriptor.executable, thread), false); await host.dispose(); assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).nonce, 'other-owner'); assert.equal(closed, 1);
    console.log('Window host: authoritative typed Disabled proof, one-use idle UI RPC tokens, denied Managed/absent proof, stop/clear and approval revocation, fragmented UTF8, turn races, stale image invalidation and rendezvous cleanup passed');
  } finally { await fs.rm(home, { recursive: true, force: true }); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { EventEmitter } = require('node:events');
const { createHost } = require('./window-control-host.cjs');
const { createBackend } = require('./window-control-backend.cjs');
const thread = '12345678-1234-1234-1234-123456789abc';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) { for (let i = 0; i < 100 && !predicate(); i++) await tick(); assert.ok(predicate()); }
async function fixture(t, { timeout = 1000, show, publish, focus, dedicated = false } = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'azrael-approval-notification-'));
  const approvals = require('./window-use-approvals.cjs').createOwner(home);
  const descriptor = { hwnd: 'fixture', pid: 1, processCreated: 'created', executable: 'C:/fixture/app.exe', title: 'Fixture app', minimized: false, widthPx: 800, heightPx: 600, dpi: 96 };
  const posts = [], shows = [], hides = [], navigation = [], commands = [], backendCalls = [];
  let listener, subscriptionDisposed = false, turn = 'turn-one';
  const backend = {
    async request(method) { backendCalls.push(method); return method === 'listWindows' ? [descriptor] : method === 'observe' ? ({window:{...descriptor},observationId:"fixture-observation",frameTimestamp:"fixture-time",widthPx:descriptor.widthPx,heightPx:descriptor.heightPx,dpi:descriptor.dpi,elements:[],elementsTruncated:false,image:{mimeType:"image/png",data:"aW1hZ2U="}}) : descriptor; },
    showApprovalNotification(params) { shows.push(params); return show?.(params); },
    hideApprovalNotification(params) { hides.push(params); },
    onApprovalNotificationActivated(callback) { listener = callback; return { dispose() { subscriptionDisposed = true; } }; }, async dispose() {},
  };
  const reveals = [];
  const panel = { webview: { postMessage(envelope) { posts.push(envelope); return true; }, onDidReceiveMessage() {} }, reveal(...args) { reveals.push(args); }, onDidDispose() {}, dispose() {} };
  const host = createHost({ runtime: { codexHome: home }, occupancyDirectory: path.join(home, 'occupancy'), approvals, approvalTimeoutMs: timeout, backend,
    vscode: { ViewColumn: { One: 1 }, workspace: { workspaceFolders: [] }, window: { showWarningMessage: async () => '허용', createWebviewPanel() { return panel; } }, commands: { async executeCommand(command) { commands.push(command); await focus?.(); } } },
    createServer() { const server = new EventEmitter(); server.listen = (_name, done) => done(); server.close = () => {}; return server; },
  });
  const native = { registerProvider() { return { dispose() {} }; } }; const {engine}=require('./window-approval-engine-fixture.cjs').attachApprovalEngine(host,native,()=>{});
  const publisher = envelope => { posts.push(envelope); return publish?.(envelope); };
  const navigate = (id, isPending) => navigation.push({ id, isPending });
  host.registerApprovalUI(native, publisher, navigate);
  if (dedicated) { host.open(); const originalRpc=host.attach(native).rpc.bind(host.attach(native));host.attach(native).rpc = async (method,params) => method.startsWith('thread/approval/')?originalRpc(method,params):({ computerUseMode: 'selectedWindow', thread: { id: thread } }); await host.startThread(); }
  function started(id) { turn = id; host.observe(native, { method: 'turn/started', params: { threadId: thread, turn: { id } } }); }
  started(turn); await host.threads.get(thread).ready;
  t.after(async () => { await host.dispose(); await fs.rm(home, { recursive: true }); });
  const call = (tool, args = {}) => host.handlePipe({ nonce: host.nonce, threadId: thread, method: 'call', tool, arguments: args, _meta: { threadId: thread, 'codex/sandbox-state-meta': { permissionProfile: { type: 'disabled' } }, 'x-codex-turn-metadata': { thread_id: thread, turn_id: turn } } });
  async function select() { const selected = (await call('list_windows')).candidates[0]; const result = call('resize', { windowId:selected.windowId,widthDip:700,heightDip:500 }); result.catch(() => {}); await until(() => posts.some(p => ['mcp-request', 'approval'].includes(p.type))); return { result, request: posts.find(p => ['mcp-request', 'approval'].includes(p.type)).request }; }
  return { host, native, engine, approvals, descriptor, publisher, navigate, posts, shows, hides, navigation, commands, backendCalls, reveals, call, select, started, click: id => listener({ requestId: id }), subscriptionDisposed: () => subscriptionDisposed,
    answer(request, action = 'accept') { host.respondApproval(native, request.id, { action, content: { persist: 'session' } }); } };
}
test('native settings action preserves the pending card and never grants or settles consent',async t=>{
  const settingsModule=require('./use-settings-host.cjs'),factory=settingsModule.createSettingsHost,opened=[];
  t.mock.method(settingsModule,'createSettingsHost',options=>({...factory(options),async openApprovalSettings(args){opened.push(args);}}));
  const f=await fixture(t),{result,request}=await f.select();let settled=false;result.finally(()=>settled=true).catch(()=>{});
  const settings={action:'settings',content:{list:'controlAllowedApps'}};
  f.host.respondApproval({},request.id,settings);f.host.respondApproval(f.native,request.id,{action:'settings',content:{list:'invalid'}});await tick();assert.equal(opened.length,0);
  f.host.respondApproval(f.native,request.id,settings);await until(()=>opened.length===1);assert.equal(opened[0].list,'controlAllowedApps');assert.equal(opened[0].descriptor.executable,f.descriptor.executable);assert.equal(opened[0].descriptor.pid,f.descriptor.pid);assert.equal(opened[0].isCurrent(),true);
  assert.equal(settled,false);assert.equal(f.engine.calls.filter(call=>call.method==='thread/approval/resolve').length,0);assert.equal(f.approvals.hasAppApproval(f.descriptor.executable,thread),false);assert.equal(f.backendCalls.includes('resize'),false);
  f.answer(request);await result;assert.equal(opened[0].isCurrent(),false);assert.equal(f.backendCalls.filter(method=>method==='resize').length,1);
});

test('notification follows delivered card, only navigates pending approval, and rebinding does not duplicate it', async t => {
  let delivered; const gate = new Promise(resolve => { delivered = resolve; });
  const f = await fixture(t, { publish: envelope => envelope.type === 'mcp-request' ? gate : undefined });
  const { result, request } = await f.select(); assert.equal(f.shows.length, 0); delivered(true);
  await until(() => f.shows.length === 1);
  const shown = f.shows[0]; assert.equal(request.id, 'azrael-window-consent-' + shown.requestId); assert.match(shown.requestId, /^[a-f0-9-]{36}$/i);
  assert.equal(shown.appTitle, 'Fixture app'); assert.equal(shown.timeoutMs,50000,'notification visibility budget is independent of the synchronous grace period');
  f.host.registerApprovalUI(f.native, f.publisher, f.navigate); await tick(); assert.equal(f.shows.length, 1);
  f.click('00000000-0000-0000-0000-000000000000'); await tick(); assert.equal(f.commands.length, 0);
  f.click(shown.requestId); await until(() => f.navigation.length === 1);
  assert.deepEqual(f.commands, ['workbench.action.focusWindow']); assert.equal(f.navigation[0].id, thread); assert.equal(f.navigation[0].isPending(), true);
  assert.equal(f.approvals.hasAppApproval(f.descriptor.executable, thread), false); assert.equal(f.backendCalls.includes('observe'), false);
  f.answer(request); assert.ok(await result); await until(() => f.hides.length > 0); assert.deepEqual(f.hides[0], { requestId: shown.requestId });
  assert.equal(f.navigation[0].isPending(), false); f.click(shown.requestId); await tick(); assert.equal(f.navigation.length, 1);
  await f.call('status', { windowId: (await f.call('list_windows')).candidates[0].windowId }); assert.equal(f.shows.length, 1);
});
test('dedicated approval activation reveals its panel without ordinary navigation', async t => {
  const f = await fixture(t, { dedicated: true }); const { result, request } = await f.select(); await until(() => f.shows.length === 1);
  f.click(f.shows[0].requestId); await until(() => f.reveals.length === 1); assert.deepEqual(f.reveals[0], [undefined, false]); assert.equal(f.navigation.length, 0);
  assert.equal(f.approvals.hasAppApproval(f.descriptor.executable, thread), false); f.answer(request, 'cancel'); await assert.rejects(result);
});
for (const ending of ['decline', 'cancel', 'disconnect', 'dispose', 'turn']) test(`${ending} retires notification and rejects stale activation`, async t => {
  const f = await fixture(t); const { result, request } = await f.select(); await until(() => f.shows.length === 1);
  if (ending === 'disconnect') f.host.disconnect(f.native);
  else if (ending === 'dispose') await f.host.dispose();
  else if (ending === 'turn') f.started('turn-two');
  else f.answer(request, ending);
  await assert.rejects(result, error => error.code === (ending === 'decline' ? 'approval_denied' : 'cancelled'));
  await until(() => f.hides.length > 0); f.click(f.shows[0].requestId); await tick(); assert.equal(f.navigation.length, 0); assert.equal(f.commands.length, 0);
  assert.equal(f.approvals.hasAppApproval(f.descriptor.executable, thread), false);
  if (ending === 'dispose') assert.equal(f.subscriptionDisposed(), true);
});
test('approval ending while focus awaits blocks navigation', async t => {
  let focused; const gate = new Promise(resolve => { focused = resolve; }); const f = await fixture(t, { focus: () => gate });
  const { result, request } = await f.select(); await until(() => f.shows.length === 1); f.click(f.shows[0].requestId); await until(() => f.commands.length === 1);
  f.answer(request, 'cancel'); await assert.rejects(result); focused(); await tick(); assert.equal(f.navigation.length, 0);
});
test('notification show failure leaves consent usable', async t => {
  const f = await fixture(t, { show() { throw new Error('native toast unavailable'); } }); const { result, request } = await f.select(); await until(() => f.shows.length === 1);
  f.answer(request); assert.ok(await result); await until(() => f.hides.length > 0);
});
test('show finishing after cancellation is hidden and never navigates', async t => {
  let finishShow; const gate = new Promise(resolve => { finishShow = resolve; }); const f = await fixture(t, { show: () => gate });
  const { result, request } = await f.select(); await until(() => f.shows.length === 1); f.answer(request, 'cancel'); await assert.rejects(result);
  finishShow(); await until(() => f.hides.length > 0); f.click(f.shows[0].requestId); await tick(); assert.equal(f.navigation.length, 0);
});
test('failed card delivery never shows a notification', async t => {
  const f = await fixture(t, { publish: () => false }); const { result } = await f.select(); await assert.rejects(result, { code: 'connection_error' }); assert.equal(f.shows.length, 0);
});

test('expired approval retires notification and rejects stale activation',async t=>{
  const f=await fixture(t,{timeout:30}),{result,request}=await f.select();await assert.rejects(result,{code:'approval_timeout'});await until(()=>f.hides.length>0);
  f.click(f.shows[0].requestId);await tick();assert.equal(f.navigation.length,0);f.answer(request);await tick();assert.deepEqual(f.engine.resumes,[]);assert.equal(f.approvals.hasAppApproval(f.descriptor.executable,thread),false);
});
test('rebinding a live card does not duplicate its notification or settle the tool',async t=>{
  const f=await fixture(t),{result,request}=await f.select();await until(()=>f.shows.length===1);let settled=false;result.finally(()=>settled=true).catch(()=>{});
  f.host.registerApprovalUI(f.native,envelope=>f.publisher(envelope),f.navigate);await tick();assert.equal(f.shows.length,1);assert.equal(settled,false);f.answer(request);await result;
});

function backendFixture(respond) {
  const declaration = { executable: 'C:/verified/helper.exe', manifestSha256: 'hash' }; let child;
  const backend = createBackend({ windowControl: declaration }, { verify: () => declaration, spawnChild() {
    child = new EventEmitter(); child.exitCode = null; child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.stdin.write = line => { const request = JSON.parse(line); queueMicrotask(() => respond(child, request)); };
    child.stdin.end = () => { child.exitCode = 0; queueMicrotask(() => child.emit('exit', 0)); }; return child;
  } });
  return { backend, event(message) { child.stdout.emit('data', Buffer.from(JSON.stringify(message) + '\n')); } };
}
test('backend routes notification methods and activation subscriptions without settling requests', async () => {
  const requests = [], events = []; const f = backendFixture((child, request) => { requests.push(request); child.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, result: { shown: true } }) + '\n')); });
  const params = { requestId: thread, appTitle: 'Fixture app', timeoutMs: 1000 };
  const broken = f.backend.onApprovalNotificationActivated(() => { throw Error('view unavailable'); }); const subscription = f.backend.onApprovalNotificationActivated(event => events.push(event));
  await f.backend.showApprovalNotification(params); assert.equal(requests[0].method, 'approvalNotificationShow'); assert.deepEqual(requests[0].params, params);
  f.event({ event: { type: 'approvalNotificationActivated', requestId: thread } }); assert.equal(events.length, 1);
  subscription.dispose(); broken.dispose(); f.event({ event: { type: 'approvalNotificationActivated', requestId: thread } }); assert.equal(events.length, 1);
  await f.backend.hideApprovalNotification({ requestId: thread }); assert.equal(requests[1].method, 'approvalNotificationHide'); await f.backend.dispose();
});
test('backend activation event leaves an outstanding request pending until its own reply', async () => {
  let childHandle, requestHandle, settled = false, activated = false;
  const f = backendFixture((child, request) => { childHandle = child; requestHandle = request; });
  f.backend.onApprovalNotificationActivated(() => { activated = true; });
  const pending = f.backend.showApprovalNotification({ requestId: thread, appTitle: 'app', timeoutMs: 1000 }).then(value => { settled = true; return value; });
  await tick(); f.event({ event: { type: 'approvalNotificationActivated', requestId: thread } }); await tick(); assert.equal(activated, true); assert.equal(settled, false);
  childHandle.stdout.emit('data', Buffer.from(JSON.stringify({ id: requestHandle.id, result: { shown: true } }) + '\n'));
  assert.deepEqual(await pending, { shown: true }); await f.backend.dispose();
});
for (const event of [{ type: 'approvalNotificationActivated', requestId: 'window-use:' + thread }, { type: 'approvalNotificationActivated', requestId: thread, action: 'accept' }, { type: 'approvalNotificationActivated' }]) test('backend rejects malformed activation and does not notify subscribers', async () => {
  const f = backendFixture(() => {}); let activated = false; f.backend.onApprovalNotificationActivated(() => { activated = true; });
  const pending = f.backend.showApprovalNotification({ requestId: thread, appTitle: 'app', timeoutMs: 1000 }); await tick(); f.event({ event });
  await assert.rejects(pending, { code: 'connection_error' }); assert.equal(activated, false); await f.backend.dispose();
});
test('transformed native callback binds stable navigation and checks pending state after opening sidebar', async () => {
  const vm = require('node:vm'), { injectComputerUse, MARKER } = require('./inject-computer-use.cjs');
  const original = await fs.readFile(path.join(process.env.AZRAEL_PRESERVATION_UI_ROOT ?? path.join(__dirname, '../artifacts/upstream-ui/26.1007.21434'), 'out/extension.js'), 'utf8');
  const transformed = injectComputerUse(original).text;
  const start = transformed.indexOf('onRequest:F=>{'), end = transformed.indexOf(MARKER, start);
  const registrations = [], commands = [], routes = []; let finishOpen;
  const context = vm.createContext({ require(name) {
    if (name === './azrael-runtime.cjs') return { runtime: { windowControl: {} } };
    if (name === './window-control-host.cjs') return { registerApprovalUI(...args) { registrations.push(args); } };
    if (name === './window-use-approvals.cjs') return { receive() {} };
    assert.equal(name, 'vscode'); return { commands: { executeCommand(command) { commands.push(command); return new Promise(resolve => { finishOpen = resolve; }); } } };
  } });
  const native = {}; Object.assign(context, { codexMcpConnection: native, broadcastToAllViews() {}, navigateToRoute(route) { routes.push(route); } });
  const onRequest = vm.runInContext('(' + transformed.slice(start + 'onRequest:'.length, end) + ')', context);
  onRequest({}); onRequest({}); assert.equal(registrations.length, 2);
  assert.equal(registrations[0][0], native); assert.equal(registrations[0][1], registrations[1][1]); assert.equal(registrations[0][2], registrations[1][2]);
  const navigate = registrations[0][2]; await navigate(thread, () => false); assert.equal(commands.length, 0);
  let pending = true; const stale = navigate(thread, () => pending); pending = false; finishOpen(); await stale; assert.equal(routes.length, 0);
  const live = navigate(thread, () => true); finishOpen(); await live;
  assert.deepEqual(commands, ['azrael.openSidebar', 'azrael.openSidebar']); assert.deepEqual(routes, ['/local/' + thread]);
});

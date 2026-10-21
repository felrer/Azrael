'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { createHost } = require('./window-control-host.cjs');
const thread = '12345678-1234-1234-1234-123456789abc';
const otherThread = '12345678-1234-1234-1234-123456789abd';
async function fixture(t, mode, childRuntime, approvalTimeoutMs=1000) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'window-stage-authority-'));
  const settings = require('./use-control-settings.cjs').createSettingsOwner(home);
  const approvals = require('./window-use-approvals.cjs').createOwner(home);
  const descriptor = { hwnd: 'fixture', pid: 4, processCreated: 'created', executable: 'C:/fixture/editor.exe', title: 'Fixture', minimized: false, widthPx: 800, heightPx: 600, dpi: 96 };
  const descriptors=[descriptor];
  const modals = [], backendCalls = [], cards = [];
  let answer = '허용';
  const host = createHost({ runtime: { codexHome: home, computerUse: { directory: path.join(home, 'desktop-runtime') }, windowControl: childRuntime ? { childSession: childRuntime } : {} }, occupancyDirectory: path.join(home, 'occupancy'), approvals, approvalTimeoutMs,
    vscode: { window: { async showWarningMessage(...args) { modals.push(args); return typeof answer === 'function' ? answer() : answer; } } },
    backend: { async request(method) { backendCalls.push(method); return method === 'listWindows' ? descriptors : descriptor; }, async dispose() {} } });
  t.after(async () => { await host.dispose(); await fs.rm(home, { recursive: true }); });
  const native = { registerProvider() { return { dispose() {} }; } };
  const {engine}=require('./window-approval-engine-fixture.cjs').attachApprovalEngine(host,native);
  const publisher=envelope => { cards.push(envelope); if(envelope.type==='mcp-request') {Promise.resolve().then(()=>typeof answer==='function'?answer(envelope.request):answer).then(value=>{if(value==='pending')return;host.respondApproval(native,envelope.request.id,{action:value==='허용'?'accept':value==='거부'?'decline':'cancel',content:{persist:'session'}});});}return true; };
  host.registerApprovalUI(native, publisher);
  async function register(id, computerUseMode = mode) {
    const result = { id: 'fixture-provider:' + id, result: { thread: { id }, computerUseMode } };
    // The request ID is independent of the returned thread ID.
    host.request(native, 'fixture-provider', 'register-' + id, 'thread/start', {});
    result.id = 'fixture-provider:register-' + id;
    const replayed = new Promise(resolve => assert.equal(host.beforeResult(native, result, resolve), true));
    assert.deepEqual(await replayed, result);
    assert.equal(host.threads.get(id).mode, computerUseMode);
  }
  await register(thread);
  let turn = 'turn-one';
  const start = (id = turn) => { turn = id; host.observe(native, { method: 'turn/started', params: { threadId: thread, turn: { id } } }); };
  start();
  const metadata = () => ({ threadId: thread, 'codex/sandbox-state-meta': { permissionProfile: { type: 'disabled' } }, 'x-codex-turn-metadata': { thread_id: thread, turn_id: turn, sandbox_mode: 'danger-full-access', sandbox: 'none' } });
  const call = (tool, args = {}, meta = metadata()) => host.handlePipe({ nonce: host.nonce, threadId: thread, method: 'call', tool, arguments: args, _meta: meta });
  const desktop = (meta = metadata(), extra = {}) => host.handlePipe({ nonce: host.nonce, threadId: thread, method: 'desktop_authority', _meta: meta, ...extra });
  const requestStage = (stage, targetId) => call('request_stage', { stage, ...(targetId ? { targetId } : {}), reason: 'Perform the explicitly requested fixture task' });
  const select = async () => call('select_window', { candidateId: (await call('list_windows')).candidates[0].candidateId });
  return { host, native, home, engine, settings, approvals, modals, backendCalls, cards, publisher, register, start, call, desktop, metadata, requestStage, select, setAnswer: value => answer = value,
    addApp(){descriptors.push({...descriptor,hwnd:'second',pid:5,executable:'C:/fixture/second.exe',title:'Second fixture'});},
    update(patch) { return settings.updateSettings(patch, settings.getSettings().revision); }, complete() { host.observe(native, { method: 'turn/completed', params: { threadId: thread, turn: { status: 'completed' } } }); } };
}
test('installed package launch cannot bypass stage authority or open app consent without it', async t => {
  const f = await fixture(t);
  await assert.rejects(f.call('launch_isolated', { packageName: 'Microsoft.Paint' }), { code: 'permission_denied' });
  assert.equal(f.cards.length, 0);
  assert.deepEqual(f.backendCalls, []);
});

test('ordinary thread stage4 requires explicit consent, active native turn and enabled global stage', async t => {
  const f = await fixture(t);
  await f.select(); assert.equal(f.cards.length, 0, 'stage1 observation does not ask app consent');
  await assert.rejects(f.desktop(), { code: 'permission_denied' });
  f.setAnswer(undefined); await assert.rejects(f.requestStage(4), { code: 'cancelled' }); await assert.rejects(f.desktop(), { code: 'permission_denied' });
  f.setAnswer('허용'); const granted = await f.requestStage(4); assert.equal(granted.authorized, true); assert.equal(granted.stage, 4);
  assert.equal(f.modals.length, 0); const card=f.cards.filter(value=>value.type==='mcp-request').at(-1).request;
  assert.equal(card.params._meta.tool_params.app, 'Window Use 4단계');assert.deepEqual(card.params._meta.persist,['session']);assert.match(card.params._meta.tool_params_display.find(field=>field.name==='reason').value,/fixture task/);
  const lease = await f.desktop(); assert.equal(lease.threadId, thread); assert.equal(lease.turnId, 'turn-one'); assert.match(lease.token, /^[a-f0-9]{64}$/);
  f.update({ stage4Enabled: false }); await assert.rejects(f.desktop(), { code: 'permission_denied' }); await assert.rejects(f.requestStage(4), { code: 'permission_denied' });
  f.update({ stage4Enabled: true }); await assert.rejects(f.desktop(), { code: 'permission_denied' });
  f.complete(); await assert.rejects(f.requestStage(4), { code: 'permission_denied' }); await assert.rejects(f.desktop(), { code: 'permission_denied' });
  assert.ok(f.backendCalls.every(method => ['listWindows', 'status'].includes(method)), 'no desktop input or fallback backend was invoked: ' + JSON.stringify(f.backendCalls));
});
test('stage4 consent never accepts forged thread, turn or sandbox metadata', async t => {
  const f = await fixture(t); await f.requestStage(4); await f.register(otherThread);
  for (const patch of [{ thread_id: otherThread }, { turn_id: 'forged-turn' }, { sandbox_mode: 'read-only' }, { sandbox: 'workspace-write' }]) {
    const meta = f.metadata(); Object.assign(meta['x-codex-turn-metadata'], patch); await assert.rejects(f.desktop(meta), { code: 'permission_denied' });
  }
  await assert.rejects(f.desktop({}, {}), { code: 'permission_denied' });
  await assert.rejects(f.desktop(f.metadata(), { threadId: otherThread }), { code: 'permission_denied' });
  await assert.rejects(f.desktop(f.metadata(), { tool: 'anything' }), { code: 'permission_denied' });
  assert.equal((await f.desktop()).threadId, thread, 'rejected forgeries cannot replace the real task lease');
});
test('selectedWindow native lifecycle result retains immutable stage4 ceiling', async t => {
  const f = await fixture(t, 'selectedWindow');
  assert.equal((await f.call('context')).stages.find(stage => stage.stage === 4).missingPrerequisite, 'immutable-selected-window-tool-ceiling');
  await assert.rejects(f.requestStage(4), { code: 'permission_denied' }); await assert.rejects(f.desktop(), { code: 'permission_denied' }); assert.equal(f.modals.length, 0);
});
test('turn completion, turn replacement, settings change and stage2 transition revoke desktop leases', async t => {
  const f = await fixture(t);
  for (const boundary of ['complete', 'replace', 'settings', 'stage2']) {
    f.start('turn-' + boundary); const selected = await f.select(); await f.requestStage(4); const lease = await f.desktop();
    if (boundary === 'complete') f.complete();
    if (boundary === 'replace') f.start('replacement-turn');
    if (boundary === 'settings') f.update({ windowUseAllowAll: !f.settings.getSettings().windowUseAllowAll });
    if (boundary === 'stage2') { f.approvals.addAppApproval('C:/fixture/editor.exe', 'Fixture'); assert.equal((await f.requestStage(2, selected.targetId)).stage, 2); }
    await assert.rejects(f.desktop(), { code: 'permission_denied' }, boundary);
    if (boundary !== 'settings') await assert.rejects(fs.stat(lease.recordPath), { code: 'ENOENT' }, boundary + ' removes persisted task lease');
  }
});
test('missing stage3 runtime reports unavailable and never falls back to parent control', async t => {
  const f = await fixture(t); f.update({ stage3Enabled: true });
  const context = await f.call('context'), stage = context.stages.find(item => item.stage === 3);
  assert.equal(stage.available, false); assert.equal(stage.missingPrerequisite, 'child-session-runtime-not-prepared');
  const result = await f.requestStage(3); assert.equal(result.authorized, false); assert.equal(result.missingPrerequisite, 'child-session-runtime-not-prepared');
  assert.equal(f.modals.length, 0); assert.deepEqual(f.backendCalls, []); await assert.rejects(f.desktop(), { code: 'permission_denied' });
});
test('native Stop revokes desktop lease and a late modal response cannot restore it', async t => {
  const f = await fixture(t); await f.requestStage(4); const lease = await f.desktop();
  f.host.request({}, 'fixture-provider', 'forged-stop', 'turn/interrupt', { threadId: thread, turnId: 'turn-one' });
  assert.equal((await f.desktop()).token, lease.token, 'an unrelated native connection cannot stop this task');
  f.host.request(f.native, 'fixture-provider', 'stop', 'turn/interrupt', { threadId: thread, turnId: 'turn-one' });
  await assert.rejects(f.desktop(), { code: 'permission_denied' }); await assert.rejects(fs.stat(lease.recordPath), { code: 'ENOENT' });
  f.start('next-turn'); let release;
  f.setAnswer(() => new Promise(resolve => { release = resolve; }));
  const pending = f.requestStage(4), cancelled = assert.rejects(pending, { code: 'cancelled' });
  for (let attempts = 0; !release && attempts < 100; attempts++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof release, 'function');
  f.host.request(f.native, 'fixture-provider', 'stop-pending', 'turn/interrupt', { threadId: thread, turnId: 'next-turn' });
  release('허용'); await cancelled; await assert.rejects(f.desktop(), { code: 'permission_denied' });
});
test('persisted desktop task lease replacement invalidates the granted authority', async t => {
  const f = await fixture(t); await f.requestStage(4); const lease = await f.desktop();
  const record = JSON.parse(await fs.readFile(lease.recordPath, 'utf8'));
  await fs.writeFile(lease.recordPath, JSON.stringify({ ...record, turnId: 'replaced-turn' }));
  await assert.rejects(f.desktop(), /replaced/);
});

for(const ending of ['decline','policy']) test(`stage card ${ending} cannot grant authority and retires its UI`,async t=>{
  const f=await fixture(t);f.setAnswer('pending');
  const waiting=f.requestStage(4),rejected=assert.rejects(waiting,error=>error.code===(ending==='decline'?'approval_declined':'cancelled'));
  for(let i=0;i<100&&!f.cards.some(value=>value.type==='mcp-request');i++)await new Promise(resolve=>setImmediate(resolve));
  const request=f.cards.find(value=>value.type==='mcp-request').request;
  assert.equal(request.params._meta.window_use_approval_kind,'stage');assert.deepEqual(request.params._meta.persist,['session']);
  assert.equal(f.host.respondApproval(f.native,request.id,{action:'accept',content:{persist:'always'}}),true);
  await assert.rejects(f.desktop(),{code:'permission_denied'},'a stage always response is never accepted');
  if(ending==='decline')f.host.respondApproval(f.native,request.id,{action:'decline'});
  if(ending==='policy'){f.update({stage4Enabled:false});f.host.respondApproval(f.native,request.id,{action:'accept',content:{persist:'session'}});}
  await rejected;await assert.rejects(f.desktop(),{code:'permission_denied'});
  f.host.respondApproval(f.native,request.id,{action:'accept',content:{persist:'session'}});
  assert.equal((await f.call('context')).stage,1);assert.deepEqual(f.approvals.getPersistentAppApprovals(),{approvedApps:[]});
  for(let i=0;i<100&&!f.cards.some(value=>value.notification?.method==='serverRequest/resolved'&&value.notification.params.requestId===request.id);i++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(f.cards.some(value=>value.notification?.method==='serverRequest/resolved'&&value.notification.params.requestId===request.id));
});

test('detached stage approval remains pending after its UI unregisters',async t=>{
  const f=await fixture(t,undefined,undefined,30);f.setAnswer('pending');
  const waiting=f.requestStage(4),rejected=assert.rejects(waiting,{code:'permission_pending'});
  for(let i=0;i<100&&!f.cards.some(value=>value.type==='mcp-request');i++)await new Promise(resolve=>setImmediate(resolve));
  const request=f.cards.find(value=>value.type==='mcp-request').request;
  f.host.registerApprovalUI(f.native,undefined);await rejected;
  f.host.respondApproval(f.native,request.id,{action:'accept',content:{persist:'session'}});
  for(let i=0;i<100&&!f.engine.resumes.length;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(f.engine.resumes.length,1);
  assert.equal((await f.call('context')).stage,1,'a late receipt alone cannot grant action authority');
});

test('prepare permissions returns independent app results and performs no native mutation',async t=>{
  const f=await fixture(t);f.addApp();const windows=await f.call('list_windows');const candidates=windows.candidates.map(value=>value.candidateId);
  let apps=0;f.setAnswer(request=>request.params._meta.window_use_approval_kind==='stage'?'허용':(++apps===1?'거부':'허용'));
  const result=await f.call('prepare_permissions',{stage:4,candidateIds:candidates,reason:'Prepare requested fixture work'});
  assert.deepEqual(result,{authorized:true,prepared:true,stage:4,appsAuthorized:false,appResults:[{index:0,authorized:false,code:'approval_declined'},{index:1,authorized:true}]});
  assert.ok(f.backendCalls.every(method=>method==='listWindows'));assert.equal(f.modals.length,0);
});

for(const ending of ['cancel','stop','policy','timeout']) test(`prepare app ${ending} stops before the next app card`,async t=>{
  const f=await fixture(t,undefined,undefined,ending==='timeout'?30:1000);f.addApp();const candidates=(await f.call('list_windows')).candidates.map(value=>value.candidateId);
  f.setAnswer(request=>request.params._meta.window_use_approval_kind==='stage'?'허용':'pending');
  const waiting=f.call('prepare_permissions',{stage:4,candidateIds:candidates,reason:'Verify sequential application permission cancellation'}),rejected=assert.rejects(waiting,ending==='timeout'?{code:'permission_pending',approvalState:'pending'}:undefined);
  for(let i=0;i<100&&f.cards.filter(value=>value.type==='mcp-request').length<2;i++)await new Promise(resolve=>setImmediate(resolve));
  const card=f.cards.filter(value=>value.type==='mcp-request')[1].request;
  if(ending==='cancel')f.host.respondApproval(f.native,card.id,{action:'cancel'});
  if(ending==='stop')f.host.request(f.native,'fixture-provider','prepare-stop','turn/interrupt',{threadId:thread,turnId:'turn-one'});
  if(ending==='policy'){f.update({stage4Enabled:false});f.host.respondApproval(f.native,card.id,{action:'accept',content:{persist:'session'}});}
  await rejected;assert.equal(f.cards.filter(value=>value.type==='mcp-request').length,2);
  f.host.respondApproval(f.native,card.id,{action:'accept',content:{persist:'always'}});
  assert.equal(f.approvals.hasAppApproval('C:/fixture/second.exe',thread),false);
});


test('late app-store notification preserves a fresh grant and later revocation removes it', async t => {
  const f = await fixture(t);
  const desktopApps=require('./computer-use-approvals.cjs').createOwner(f.home);
  desktopApps.removeAppApproval('legacy-editor');
  await f.requestStage(4); const fresh=await f.desktop();
  // The revocation preceded this explicit new grant; a delayed file event must not cancel it.
  await new Promise(resolve=>setTimeout(resolve,400));
  assert.equal((await f.desktop()).token,fresh.token);
  desktopApps.removeAppApproval('another-editor');
  await assert.rejects(f.desktop(), /revok|authority|approval/i);
  const deadline=Date.now()+2000;
  for(;;) {try{await fs.stat(fresh.recordPath);}catch(error){if(error.code==='ENOENT')break;throw error;}if(Date.now()>deadline)assert.fail('App revocation did not release the persisted task grant');await new Promise(resolve=>setTimeout(resolve,25));}
  await assert.rejects(f.desktop(),{code:'permission_denied'});
});

// The host and isolation controller are real; only the native manager boundary is
// substituted. These checks establish propagation and authority, not native RDP.
async function failingChildFixture(t, failure, thrown = false) {
  const childModule = require('./window-child-session.cjs');
  const original = childModule.createWindowsChildSessionManager;
  let starts = 0, releases = 0;
  const state = { admissionReady: false, available: false, cleanupUnconfirmed: true, state: 'unknown' };
  childModule.createWindowsChildSessionManager = () => ({
    describe: async () => ({ ...state }), reconcileBootstrap: async () => ({ ok: true }),
    start: async () => { starts++; if (thrown) throw Object.assign(new Error(failure.message), failure); return failure; },
    release: async () => { releases++; return { ok: true }; },
  });
  let f;
  try { f = await fixture(t, undefined, { executable: 'fixture.exe', sha256: 'a'.repeat(64) }); }
  finally { childModule.createWindowsChildSessionManager = original; }
  f.update({ stage3Enabled: true });
  return { ...f, state, counts: () => ({ starts, releases }) };
}

test('prepared stage3 approval defers startup until ordinary request_stage',async t=>{
  const f=await failingChildFixture(t,{ok:false,code:'fixture_admission_failed'});
  const prepared=await f.call('prepare_permissions',{stage:3,candidateIds:[],reason:'Prepare child-session permission before starting native work'});
  assert.deepEqual(prepared,{authorized:true,prepared:true,stage:3,appsAuthorized:true,appResults:[]});
  assert.deepEqual(f.counts(),{starts:0,releases:0});
  const cards=f.cards.filter(value=>value.type==='mcp-request').length;
  const result=await f.requestStage(3);assert.equal(result.authorized,false);assert.equal(f.counts().starts,1);
  assert.equal(f.cards.filter(value=>value.type==='mcp-request').length,cards,'prepared consent is reused while deferred startup executes');
});

test('stage3 native failure survives real isolation and host catch without authority or retry', async t => {
  const failure = { ok: false, code: 'native_child_error', hresult: -2146233088, cleanupUnconfirmed: true,
    message: "'ChildSession.Host'에 'Guard'에 대한 정의가 없습니다." };
  const f = await failingChildFixture(t, failure);
  const result = await f.requestStage(3);
  assert.equal(result.authorized, false);
  assert.equal(result.stage, 1);
  assert.equal(result.missingPrerequisite, failure.code);
  assert.equal(result.message, '격리 실행을 시작하지 못했습니다. 자식 세션의 준비·연결 상태를 확인해주세요.');
  assert.deepEqual(result.childSession, f.state);
  assert.deepEqual(result.diagnostic, { code: failure.code, hresult: failure.hresult, cleanupUnconfirmed: true,
    phase: 'start', message: failure.message });
  assert.deepEqual(f.counts(), { starts: 1, releases: 0 });
  assert.equal(f.modals.length, 0);assert.equal(f.cards.filter(value=>value.type==='mcp-request').length,1);
  await assert.rejects(f.call('launch_isolated', { targetId: 'forged' }));
  assert.deepEqual(f.backendCalls, []);
});

test('stage3 diagnostics redact untrusted text while retaining safe native context', async t => {
  const messages = [
    'Failed at C:\\Users\\private-user\\AppData\\secret.json',
    'Failed at /home/private-user/.config/state',
    'Connect \\\\.\\pipe\\private-channel',
    'challenge=' + 'a'.repeat(64),
    'Authorization: Bearer private-credential',
    'password="secret with spaces" token=other-secret api_key=private',
    'access_token=private refresh_token=private client_secret=private',
    'powershell -Command Get-Content private.json',
    '{"request":{"token":"private"},"result":"secret"}',
    'Error stack\n at privateFunction',
    'x'.repeat(9000),
  ];
  for (const message of messages) {
    const f = await failingChildFixture(t, { ok: false, code: 'native_child_error', hresult: 2147500037,
      cleanupUnconfirmed: true, diagnostic: { phase: 'child_connect', type: 'COMException', message, request: 'must not escape', stack: 'must not escape' } });
    const result = await f.requestStage(3);
    assert.equal(result.authorized, false);
    assert.deepEqual(result.childSession, f.state);
    assert.deepEqual(result.diagnostic, { code: 'native_child_error', hresult: 2147500037, cleanupUnconfirmed: true,
      phase: 'child_connect', type: 'COMException', message: '[redacted diagnostic message]' });
    assert.deepEqual(f.counts(), { starts: 1, releases: 0 });
  }
});

test('stage3 catches thrown manager errors and bounds diagnostic fields', async t => {
  const f = await failingChildFixture(t, { code: 'native_child_error', hresult: 1.5, cleanupUnconfirmed: true,
    phase: 'invalid phase', type: 'invalid type', message: 'x'.repeat(700), stack: 'private' }, true);
  const result = await f.requestStage(3);
  assert.equal(result.authorized, false);
  assert.deepEqual(result.diagnostic, { code: 'native_child_error', cleanupUnconfirmed: true, phase: 'start', message: 'x'.repeat(512) });
  assert.deepEqual(f.counts(), { starts: 1, releases: 0 });
});

// Exercise host classification with a substituted controller boundary; authority,
// policy dispatch and transport serialization remain production code.
async function isolatedOperationFixture(t, failure) {
  const isolationModule=require('./window-use-isolation.cjs'),childModule=require('./window-child-session.cjs');
  const originalController=isolationModule.createIsolationController,originalManager=childModule.createWindowsChildSessionManager;
  const calls=[];let rejectNext=true;
  isolationModule.createIsolationController=()=>({
    start:async()=>({ok:true}),release:async()=>({ok:true}),
    capture:async()=>{calls.push('capture');if(rejectNext){rejectNext=false;throw Object.assign(new Error(failure.message || 'Child operation failed'),failure);}return {ok:true,observationId:'fresh-after-failure',geometry:{width:10,height:10},png:'YQ=='};},
    input:async()=>{calls.push('input');throw Object.assign(new Error(failure.message || 'Child operation failed'),failure);},
  });
  childModule.createWindowsChildSessionManager=()=>({describe:async()=>({admissionReady:true}),reconcileBootstrap:async()=>({ok:true})});
  let f;try {f=await fixture(t,undefined,{executable:'fixture.exe',sha256:'a'.repeat(64)});}finally {isolationModule.createIsolationController=originalController;childModule.createWindowsChildSessionManager=originalManager;}
  f.update({stage3Enabled:true});assert.equal((await f.requestStage(3)).authorized,true);
  return {...f,calls};
}

test('stage3 minimized viewer has distinct sanitized public recovery metadata and fresh capture',async t=>{
  const f=await isolatedOperationFixture(t,{code:'isolated_viewer_minimized',actionExecuted:false,viewerState:'minimized',requiredUserAction:'restore_isolated_viewer',message:'Failed C:\\Users\\private\\session.json'});
  let payload;await assert.rejects(f.call('capture_isolated',{targetId:'child'}),error=>{payload=require('./window-control-errors.cjs').errorPayload(error);return true;});
  assert.equal(payload.code,'isolated_viewer_minimized');assert.equal(payload.actionExecuted,false);assert.equal(payload.viewerState,'minimized');assert.equal(payload.requiredUserAction,'restore_isolated_viewer');assert.equal(payload.observationRequired,true);
  assert.match(payload.message,/Azrael isolated session \(model control\)/);assert.doesNotMatch(payload.message,/restore_window|private/);
  assert.match(payload.message,/최소화를 해제해주세요/);
  assert.equal(payload.nativeCode,'isolated_viewer_minimized');assert.equal(payload.diagnostic.message,'[redacted diagnostic message]');
  assert.equal((await f.call('capture_isolated',{targetId:'child'})).observationId,'fresh-after-failure');assert.deepEqual(f.calls,['capture','capture']);assert.deepEqual(f.backendCalls,[]);
});

test('stage3 unknown mutation stops input without permanently blocking read-only capture',async t=>{
  const f=await isolatedOperationFixture(t,{code:'native_input_failed',mutationOutcome:'unknown',inputReleaseConfirmed:true,message:'secret=private'});
  let payload;await assert.rejects(f.call('input_isolated',{targetId:'child',observationId:'old',input:{kind:'text',text:'fixture'}}),error=>{payload=require('./window-control-errors.cjs').errorPayload(error);return true;});
  assert.equal(payload.code,'state_changed');assert.equal(payload.mutationOutcome,'unknown');assert.equal(payload.inputReleaseConfirmed,true);assert.equal(payload.recovery,'observe_again');assert.equal(payload.observationRequired,true);assert.equal(payload.diagnostic.message,'[redacted diagnostic message]');assert.deepEqual(f.calls,['input']);
  // The first explicit capture also fails in this fixture; neither failure revokes authority.
  await assert.rejects(f.call('capture_isolated',{targetId:'child'}),{code:'state_changed'});
  assert.equal((await f.call('capture_isolated',{targetId:'child'})).observationId,'fresh-after-failure');assert.deepEqual(f.calls,['input','capture','capture']);
});

test('stage3 revalidation and generic failures retain bounded native diagnostics',async t=>{
  for(const failure of [
    {code:'child_input_revalidated',actionExecuted:false,inputReleaseConfirmed:true},
    {code:'native_action_failed',actionExecuted:false,recovery:'observe_again',observationRequired:true,message:'token=private',diagnostic:{code:'native_action_failed',hresult:-1,type:'COMException',message:'token=private',stack:'private'}},
  ]) {
    const f=await isolatedOperationFixture(t,failure);let payload;
    await assert.rejects(f.call('input_isolated',{targetId:'child',observationId:'old',input:{kind:'text',text:'fixture'}}),error=>{payload=require('./window-control-errors.cjs').errorPayload(error);return true;});
    assert.equal(payload.nativeCode,failure.code);assert.equal(payload.diagnostic.code,failure.code);assert.doesNotMatch(JSON.stringify(payload),/private|stack/);
    if(failure.code==='child_input_revalidated'){assert.equal(payload.code,'state_changed');assert.equal(payload.actionExecuted,false);assert.equal(payload.inputReleaseConfirmed,true);assert.equal(payload.recovery,'observe_again');assert.equal(payload.observationRequired,true);}
    else {assert.equal(payload.code,'unsupported_action');assert.equal(payload.diagnostic.hresult,-1);assert.equal(payload.diagnostic.type,'COMException');assert.equal(payload.actionExecuted,false);assert.equal(payload.recovery,'observe_again');assert.equal(payload.observationRequired,true);}
    assert.deepEqual(f.calls,['input']);
  }
});

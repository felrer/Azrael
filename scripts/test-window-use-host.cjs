'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { EventEmitter } = require('node:events');
const { createHost } = require('./window-control-host.cjs');
const { attachApprovalEngine } = require('./window-approval-engine-fixture.cjs');
const ids = ['12345678-1234-1234-1234-123456789abc', '22345678-1234-1234-1234-123456789abc'];
async function fixture(t, delayed = false, occupancyDirectory, workspaceFile, extra = {}) {
  const parent=process.env.WINDOW_USE_HOST_TEST_ROOT || os.tmpdir();await fs.mkdir(parent,{recursive:true});
  const home = await fs.mkdtemp(path.join(parent, 'azrael-window-use-host-'));
  let releaseListen, panels = 0; const calls = [], cards=[];
  const window = { hwnd: 'fixture', pid: 1, processCreated: 'created', executable: 'C:/fixture/app.exe', title: 'Fixture app', minimized: false, widthPx: 800, heightPx: 600, dpi: 96 };
  const approvals = require('./window-use-approvals.cjs').createOwner(home);
  const host = createHost({ occupancyDirectory: occupancyDirectory || path.join(home, 'occupancy'), runtime: { codexHome: home, workspacePath: 'C:/private/Workspace', windowControl: {}, ...extra.runtime }, approvals, approvalTimeoutMs:extra.approvalTimeoutMs, switchedInput:extra.switchedInput,
    vscode: { workspace: {workspaceFile: workspaceFile ? {fsPath:workspaceFile} : undefined}, window: { createWebviewPanel() { panels++; throw new Error('ordinary thread must not open a panel'); }, showInformationMessage: () => assert.fail('Window Use consent must remain inside Azrael'), showWarningMessage: async () => {} } },
    backend: { request: async (method, params) => { calls.push({ method, params }); if(extra.backendRequest)return extra.backendRequest(method,params,window);return method === 'listWindows' ? [window] : method === 'observe' ? observation(window) : window; }, dispose: async () => {} },
    createServer: () => { const server = new EventEmitter(); server.listen = (_pipe, ready) => { releaseListen = ready; if (!delayed) ready(); }; server.close = () => {}; return server; },
  });
  const native = { registerProvider() { return { dispose() {} }; } };
  attachApprovalEngine(host, native);
  host.registerApprovalUI(native, envelope => {
    if (envelope.type === 'mcp-request') {cards.push(envelope.request);assert.equal(host.respondApproval(native, envelope.request.id, { action: 'accept', _meta: { persist: 'session' } }), true);}
  });
  t.after(async () => { releaseListen?.(); await host.dispose(); await fs.rm(home, { recursive: true }); });
  const file = id => path.join(home, 'azrael/computer-use/window-sessions', id + '.json');
  const started = (id = ids[0], turn = 'turn-one', engine = native) => host.observe(engine, { method: 'turn/started', params: { threadId: id, turn: { id: turn } } });
  const message = (id = ids[0], turn = 'turn-one') => ({ nonce: host.nonce, threadId: id, method: 'call', tool: 'status', arguments: {}, _meta: { threadId: id, 'codex/sandbox-state-meta': { permissionProfile: { type: 'disabled' } }, 'x-codex-turn-metadata': { thread_id: id, turn_id: turn } } });
  return { host, native, home, file, started, message, calls, approvals, cards, window, settings:require('./use-control-settings.cjs').createSettingsOwner(home), release: () => releaseListen(), panels: () => panels };
}
async function replayResult(f, method, expected, returned = expected) {
  f.host.request(f.native, 'ordinary', 'request', method, { threadId: expected });
  const result = { id: 'ordinary:request', result: { thread: { id: returned } } };
  const reply = new Promise(resolve => assert.equal(f.host.beforeResult(f.native, result, resolve), true));
  return { reply, result };
}
const desktopFrame=()=>({originX:-800,originY:0,widthPx:1600,heightPx:900,redacted:true,maskedWindowCount:1,image:{mimeType:'image/png',data:'aW1hZ2U='}});
const callHost=(f,tool,args={},request={})=>f.host.handlePipe({...f.message(),tool,arguments:args},request);
async function startSelected(f) {
  f.started();await f.host.threads.get(ids[0]).ready;
  const listed=await callHost(f,'list_windows');
  return callHost(f,'status',{windowId:listed.candidates[0].windowId});
}
function observation(window) {
  return {window:{...window},observationId:'fixture-observation',frameTimestamp:'fixture-time',widthPx:window.widthPx,heightPx:window.heightPx,dpi:window.dpi,elements:[],elementsTruncated:false,image:{mimeType:'image/png',data:'aW1hZ2U='}};
}
test('enabled observation is free and context exposes app permissions without stage cards',async t=>{
  const f=await fixture(t,false,undefined,undefined,{backendRequest:(method,_params,window)=>method==='listWindows'?[window]:method==='observe'?observation(window):window});
  const selected=await startSelected(f);
  assert.equal((await callHost(f,'capture',{windowId:selected.windowId})).image.mimeType,'image/png');
  const context=await callHost(f,'context');
  assert.deepEqual(context.permissions,{observation:'default-allow',control:'default-ask',desktopControl:'default-ask',desktopControlGranted:false});
  assert.equal(context.enabled,true);assert.equal('stage'in context,false);assert.equal('stages'in context,false);assert.equal('backendDirectory'in context,false);
  assert.equal(f.cards.length,0);assert.equal(f.approvals.hasAppApproval(f.window.executable,ids[0],'control'),false);
});
test('Security App observation approval remains independent and control is blocked before consent',async t=>{
  const f=await fixture(t,false,undefined,undefined,{backendRequest:(method,_params,window)=>method==='listWindows'?[window]:method==='observe'?observation(window):window});
  f.settings.updateSettings({observationBlockedApps:[f.window.executable]},f.settings.getSettings().revision);
  const selected=await startSelected(f);
  await callHost(f,'capture',{windowId:selected.windowId});
  assert.equal(f.cards.length,1);assert.equal(f.cards[0].params._meta.tool_params.permission,'observation');assert.deepEqual(f.cards[0].params._meta.persist,['session']);
  assert.equal(f.approvals.hasAppApproval(f.window.executable,ids[0],'observation'),true);assert.equal(f.approvals.hasAppApproval(f.window.executable,ids[0],'control'),false);
  await assert.rejects(callHost(f,'resize',{windowId:selected.windowId,widthDip:700,heightDip:500}),{code:'security_app_blocked'});
  assert.equal(f.cards.length,1);assert.equal(f.calls.filter(call=>call.method==='resize').length,0);
});
test('first desktop input automatically approves global control, retains it across turns and revokes on Stop',async t=>{
  const input={action:'click',button:'left',x:20,y:30};let delivered=0;
  const f=await fixture(t,false,undefined,undefined,{switchedInput:{desktopInput:async(_thread,_window,_input,guard)=>{await guard();delivered++;return {delivered:true};},release:async()=>{},dispose:async()=>{}},backendRequest:method=>method==='captureDesktop'?desktopFrame():{window:f.window}});
  f.started();await f.host.threads.get(ids[0]).ready;
  const frame=await callHost(f,'capture_desktop');await assert.rejects(callHost(f,'desktop_input',{observationId:frame.observationId,input}),{code:'state_changed',observationRequired:true,actionExecuted:false});assert.equal(delivered,0);const fresh=await callHost(f,'capture_desktop');await callHost(f,'desktop_input',{observationId:fresh.observationId,input});
  assert.equal(delivered,1);assert.deepEqual(f.cards.map(card=>card.params._meta.tool_params.permission),['desktop']);assert.deepEqual(f.cards[0].params._meta.persist,['session']);assert.equal(f.cards[0].params._meta.tool_params.app,undefined);
  f.host.observe(f.native,{method:'turn/completed',params:{threadId:ids[0],turn:{id:'turn-one',status:'completed'}}});assert.equal(f.approvals.hasDesktopApproval(ids[0]),true);
  f.started();assert.equal((await callHost(f,'context')).permissions.desktopControlGranted,true);
  f.host.request(f.native,'ordinary','stop','turn/interrupt',{threadId:ids[0],turnId:'turn-one'});assert.equal(f.approvals.hasDesktopApproval(ids[0]),false);
});

test('selectedWindow ceiling rejects desktop input before consent',async t=>{
  const f=await fixture(t,false,undefined,undefined,{switchedInput:{desktopInput:async()=>{},release:async()=>{},dispose:async()=>{}},backendRequest:()=>desktopFrame()});
  f.started();await f.host.threads.get(ids[0]).ready;f.host.threads.get(ids[0]).mode='selectedWindow';
  await assert.rejects(callHost(f,'desktop_input',{observationId:'unused',input:{action:'click',button:'left',x:20,y:30}}));assert.equal(f.cards.length,0);
});

for(const globalGrant of [false,true])test('Security App blocks desktop input before any consent even with whitelist and global grant '+globalGrant,async t=>{
  let delivered=0;const f=await fixture(t,false,undefined,undefined,{switchedInput:{desktopInput:async()=>{delivered++;},release:async()=>{},dispose:async()=>{}},backendRequest:method=>method==='captureDesktop'?desktopFrame():{window:f.window}});
  f.settings.updateSettings({observationBlockedApps:[f.window.executable],controlAllowedApps:[f.window.executable]},f.settings.getSettings().revision);
  f.started();await f.host.threads.get(ids[0]).ready;
  if(globalGrant){const request={id:'desktop-fixture',method:'mcpServer/elicitation/request',params:{serverName:'azrael_window',threadId:ids[0],_meta:{connector_id:'window-use',tool_params:{permission:'desktop'},persist:['session']}}};f.approvals.receive(request,()=>{},()=>{});f.approvals.response(request.id,{action:'accept',content:{persist:'session'}});}
  const captured=await callHost(f,'capture_desktop');await assert.rejects(callHost(f,'desktop_input',{observationId:captured.observationId,input:{action:'click',button:'left',x:20,y:30}}),{code:'security_app_blocked'});
  assert.equal(f.cards.length,0);assert.equal(delivered,0);
});

test('control whitelist skips all prompts and permits an actual selected-window mutation',async t=>{
  const f=await fixture(t,false,undefined,undefined,{backendRequest:(method,_params,window)=>method==='listWindows'?[window]:method==='observe'?observation(window):window});
  f.settings.updateSettings({controlAllowedApps:[f.window.executable]},f.settings.getSettings().revision);
  const selected=await startSelected(f);
  await callHost(f,'resize',{windowId:selected.windowId,widthDip:700,heightDip:500});
  assert.equal(f.cards.length,0);assert.equal(f.calls.filter(call=>call.method==='resize').length,1);
});
test('desktop observation forwards blacklist and rejects malformed or unredacted native output',async t=>{
  let output=desktopFrame();const f=await fixture(t,false,undefined,undefined,{backendRequest:(method)=>{assert.equal(method,'captureDesktop');return output;}});
  f.settings.updateSettings({observationBlockedApps:[f.window.executable]},f.settings.getSettings().revision);f.started();await f.host.threads.get(ids[0]).ready;
  const {observationId,...captured}=await callHost(f,'capture_desktop');assert.match(observationId,/^[a-f0-9]{48}$/);assert.deepEqual(captured,output);assert.deepEqual(f.calls[0].params,{blockedApps:f.settings.getSettings().observationBlockedApps});assert.equal(f.cards.length,0);
  for(const patch of [{redacted:false},{redacted:undefined},{originX:1.5},{originY:undefined},{maskedWindowCount:-1},{maskedWindowCount:1.5},{widthPx:16385},{heightPx:0},{image:{mimeType:'image/png',data:''}},{image:{mimeType:'image/png',data:'!'}}]){
    output={...desktopFrame(),...patch};await assert.rejects(callHost(f,'capture_desktop'),{code:'connection_error'});
  }
});
for(const ending of ['abort','policy'])test(`desktop observation rejects a response after ${ending}`,async t=>{
  let entered,release;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const f=await fixture(t,false,undefined,undefined,{backendRequest:async()=>{entered();await gate;return desktopFrame();}});
  f.started();await f.host.threads.get(ids[0]).ready;const controller=new AbortController();
  const waiting=callHost(f,'capture_desktop',{}, {signal:controller.signal}),rejected=assert.rejects(waiting,error=>['permission_denied','cancelled'].includes(error.code));
  await started;if(ending==='abort')controller.abort();else f.settings.updateSettings({windowUseEnabled:false},f.settings.getSettings().revision);release();await rejected;
  assert.equal(f.calls.length,1);assert.equal(f.cards.length,0);
});
test('retired stage, isolated-session and desktop-authority routes are unavailable',async t=>{
  const f=await fixture(t);await startSelected(f);const before=f.calls.length;
  for(const tool of ['request_stage','logoff_isolated','launch_isolated','capture_isolated','isolated_input','resource_status','cleanup'])await assert.rejects(callHost(f,tool));
  await assert.rejects(f.host.handlePipe({...f.message(),method:'desktop_authority'}));
  assert.equal(f.calls.length,before);assert.equal(f.cards.length,0);
});
test('host task macros use the runtime workspace', async t => {
  const f = await fixture(t);
  f.started(); await f.host.threads.get(ids[0]).ready;
  const definition = {schema:1,id:'workspace',name:'Workspace',steps:[{action:'capture'}]};
  await f.host.handlePipe({ ...f.message(), tool: 'save_task_macro', arguments: {definition} });
  const tasks = require('./window-task-macros.cjs');
  assert.equal((await tasks.createStore(f.home,'C:/private/Workspace').read()).macros[0].id,'workspace');
  assert.deepEqual((await tasks.createStore(f.home,'C:/private/Other').read()).macros,[]);
});
test('saved multi-root workspace owns macros rather than its first folder', async t => {
  const workspaceFile = 'C:/private/Team.code-workspace';
  const f = await fixture(t,false,undefined,workspaceFile);
  f.started(); await f.host.threads.get(ids[0]).ready;
  const definition = {schema:1,id:'team',name:'Team',steps:[{action:'capture'}]};
  await f.host.handlePipe({ ...f.message(), tool: 'save_task_macro', arguments: {definition} });
  const tasks = require('./window-task-macros.cjs');
  assert.equal((await tasks.createStore(f.home,workspaceFile).read()).macros[0].id,'team');
  assert.deepEqual((await tasks.createStore(f.home,'C:/private/Workspace').read()).macros,[]);
});
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
  const mismatch = await replayResult(f, 'thread/resume', ids[0], ids[1]); assert.deepEqual((await mismatch.reply).error, { code: 'unclassified', message: '미분류된 오류' }); assert.equal(f.host.threads.has(ids[1]), false);
  const other = { registerProvider() { return { dispose() {} }; } }; f.host.attach(other, () => {});
  f.host.request(other, 'ordinary', 'other', 'thread/resume', { threadId: ids[0] });
  const reply = await new Promise(resolve => f.host.beforeResult(other, { id: 'ordinary:other', result: { thread: { id: ids[0] } } }, resolve));
  assert.deepEqual(reply.error, { code: 'unclassified', message: '미분류된 오류' }); assert.equal(f.host.threads.get(ids[0]).bridge.native, f.native);
});
test('ordinary lifecycle tracks active turns and denies stale or inexact permission proof each call', async t => {
  const f = await fixture(t); f.started(); await f.host.threads.get(ids[0]).ready;
  for (const permissionProfile of [undefined, { type: 'managed', sandbox: 'danger-full-access' }, { type: 'disabled', extra: true }]) {
    const request = f.message(); request._meta['codex/sandbox-state-meta'] = { permissionProfile }; await assert.rejects(f.host.handlePipe(request), /denied/);
  }
  await assert.rejects(f.host.handlePipe(f.message(ids[0], 'old-turn')), /denied/);
  await assert.rejects(f.host.handlePipe(f.message()), /Invalid arguments/);
  f.started(ids[0], 'new-turn'); await assert.rejects(f.host.handlePipe(f.message()), /denied/);
  f.host.observe(f.native, { method: 'turn/completed', params: { threadId: ids[0], turn: { status: 'cancelled' } } });
  assert.equal(f.host.threads.get(ids[0]).turnId, undefined); await assert.rejects(f.host.handlePipe(f.message(ids[0], 'new-turn')), /denied/); assert.equal(f.calls.length, 0);
});
test('ordinary threads address stable scoped window IDs independently with app consent', async t => {
  const f = await fixture(t); f.started(); f.started(ids[1], 'turn-two'); await Promise.all(ids.map(id => f.host.threads.get(id).ready));
  const call = (id, tool, args = {}) => f.host.handlePipe({ ...f.message(id, id === ids[0] ? 'turn-one' : 'turn-two'), tool, arguments: args });
  const first = await call(ids[0], 'list_windows'); const second = await call(ids[1], 'list_windows');
  const stable = first.candidates[0].windowId;
  const fresh = await call(ids[0], 'list_windows');
  assert.equal(fresh.candidates[0].windowId, stable);
  await assert.rejects(call(ids[1], 'status', { windowId: fresh.candidates[0].windowId }), /window|forged|unknown/i);
  const selected = await Promise.all([call(ids[0], 'status', { windowId: fresh.candidates[0].windowId }), call(ids[1], 'status', { windowId: second.candidates[0].windowId })]);
  assert.notEqual(selected[0].windowId, selected[1].windowId); assert.equal(f.panels(), 0);
  const occupancy = (await call(ids[0], 'status', {windowId:selected[0].windowId})).occupancy; assert.equal(occupancy.status,'available'); assert.deepEqual(occupancy.sessions,[]);
  for (const id of ids) assert.equal(f.approvals.hasAppApproval('C:/fixture/app.exe', id), false);
  for (const [index, id] of ids.entries()) await call(id, 'resize', {windowId:selected[index].windowId,widthDip:700,heightDip:500});
  for (const id of ids) assert.equal(f.approvals.hasAppApproval('C:/fixture/app.exe', id), true);
  f.host.observe(f.native, { method: 'thread/closed', params: { threadId: ids[0] } }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.approvals.hasAppApproval('C:/fixture/app.exe', ids[0]), false); assert.equal(f.approvals.hasAppApproval('C:/fixture/app.exe', ids[1]), true);
  const remaining = await call(ids[1], 'status', {windowId:selected[1].windowId}); assert.equal(remaining.windowId, selected[1].windowId); assert.equal(remaining.occupancy.status,'available');
});
test('session-file collision fails closed and preserves the other owner', async t => {
  const f = await fixture(t); await fs.mkdir(path.dirname(f.file(ids[0])), { recursive: true }); await fs.writeFile(f.file(ids[0]), '{"nonce":"other-owner"}');
  const result = await replayResult(f, 'thread/start', ids[0]); assert.deepEqual((await result.reply).error, { code: 'unclassified', message: '미분류된 오류' });
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
  if (boundary === 'disconnect') assert.equal(replies.length, 0); else { assert.ok(replies.length >= 1); for (const reply of replies) assert.equal(reply.error.code, 'cancelled'); }
});

test('observation in different host code homes leaves control occupancy available', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(),'window-host-shared-')); t.after(()=>fs.rm(root,{recursive:true}));
 const a = await fixture(t,false,path.join(root,'occupancy')), b = await fixture(t,false,path.join(root,'occupancy'));
 a.started(ids[0]); b.started(ids[1],'turn-two'); await Promise.all([a.host.threads.get(ids[0]).ready,b.host.threads.get(ids[1]).ready]);
 const call=(f,id,turn,tool,args={})=>f.host.handlePipe({...f.message(id,turn),tool,arguments:args});
 const candidate=(await call(a,ids[0],'turn-one','list_windows')).candidates[0]; await call(a,ids[0],'turn-one','status',{windowId:candidate.windowId});
 const occupancy=(await call(b,ids[1],'turn-two','list_windows')).candidates[0].occupancy;
 assert.equal(occupancy.status,'available'); assert.deepEqual(occupancy.sessions,[]);
 a.host.disconnect(a.native); assert.equal((await call(b,ids[1],'turn-two','list_windows')).candidates[0].occupancy.status,'available');
});

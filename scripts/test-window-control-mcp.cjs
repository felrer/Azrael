'use strict';
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const vm = require('node:vm');
function loadMcp(platform, optionalModuleAvailable=true) {
  const module = { exports: {} };
  const loader=id=>id==='node:fs'&&!optionalModuleAvailable?{...fs,existsSync:file=>String(file).endsWith('window-switched-input.cjs')?false:fs.existsSync(file)}:require(id);
  vm.compileFunction(fs.readFileSync(require.resolve('./window-control-mcp.cjs'), 'utf8'), ['require', 'module', 'exports', 'process','__dirname'])(loader, module, module.exports, { platform, env: process.env },__dirname);
  return module.exports;
}
// Exercise the retained Windows protocol on every test host.
const { parseThreadMetadata, relayMetadata, pipeRequest, createRelay, createProtocol, runProtocol, callResult } = loadMcp('win32');
function fragmentedConnection(chunks) {
  return () => {
    const socket = new EventEmitter(); let destroyed = false;
    socket.setTimeout = () => socket;
    socket.destroy = () => { destroyed = true; };
    socket.write = () => { for (const chunk of chunks) { if (destroyed) break; socket.emit('data', chunk); } if (!destroyed) socket.emit('end'); };
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  };
}
async function main() {
  const ordinaryTools=loadMcp('win32',false).toolDefinitions();assert.ok(ordinaryTools.some(t=>t.name==='capture'));assert.ok(!ordinaryTools.some(t=>['switched_input','release_switched_input'].includes(t.name)));
  const projectedCoop=JSON.parse(callResult({inputBackends:{switchedInput:true,private:'omit'},inputResult:{operationId:7,targets:[{pid:123,executable:'private'}],recovery:{rounds:2,activeRecoveryMs:123,budgetExhausted:false,message:'private'},collaboration:{enabled:true,phase:'ready',user:{x:10,y:-20},rawPackets:4,private:'omit',deviceDiagnostics:{mouseSnapshotReady:true,snapshotMouseCount:1,ignoredOwnRawPackets:2,path:'private',lastDeviceChange:{change:'arrival',deviceHandle:'private',deviceType:'mouse',knownAtEnable:true,infoVerified:true,reason:'initial_known_mouse_arrival'},lastRaw:{deviceHandle:'private',deviceType:'mouse',mouseFlags:3,buttonFlags:0,absolute:true,ownExtraInfoLow32:true,ownReceiptMatched:false,eventTime:42,reason:'unmatched_synthetic_raw',extraInfo:'private'}}},text:'private'}}).content[0].text);
  assert.deepEqual(projectedCoop.inputBackends,{switchedInput:true});assert.equal(projectedCoop.inputResult.operationId,7);assert.equal(projectedCoop.inputResult.collaboration.phase,'ready');assert.equal(projectedCoop.inputResult.recovery.rounds,2);assert.ok(!JSON.stringify(projectedCoop).includes('private'));assert.equal(projectedCoop.inputResult.targets,undefined);
  const device=projectedCoop.inputResult.collaboration.deviceDiagnostics;
  assert.equal(device.ignoredOwnRawPackets,2);assert.equal(device.lastDeviceChange.reason,'initial_known_mouse_arrival');
  assert.equal(device.lastRaw.ownReceiptMatched,false);assert.equal(device.lastRaw.mouseFlags,3);assert.equal(device.lastRaw.eventTime,42);
  const errors=require('./window-control-errors.cjs');
  assert.deepEqual(errors.switchedMetadata({collaboration:{systemCursor:{visibilityCommands:1,handle:'private'}}}).collaboration.systemCursor,{visibilityCommands:1});
  assert.deepEqual(errors.switchedMetadata({collaboration:{systemCursor:{supported:true,hidden:false,restorePending:false,guardReady:true,lastError:'none',processId:123,handle:'private'}}}).collaboration.systemCursor,{supported:true,hidden:false,restorePending:false,guardReady:true,lastError:'none'});
  assert.deepEqual(errors.switchedMetadata({collaboration:{systemCursor:{hidden:'yes',lastError:'private/path'}}}).collaboration.systemCursor,{});
  assert.deepEqual(errors.switchedMetadata({collaboration:{deviceDiagnostics:{preparationWaitReason:'held_modifier',deviceHandle:'private'}}}).collaboration.deviceDiagnostics,{preparationWaitReason:'held_modifier'});
  const projectedFailure=errors.fromPayload(errors.errorPayload(errors.windowError('state_changed','Routing stopped',{switchedInputDetails:{collaboration:{failed:true,deviceDiagnostics:{snapshotMouseCount:-1,ignoredOwnRawPackets:NaN,lastRaw:{mouseFlags:Infinity,ownReceiptMatched:false,deviceHandle:'private',reason:'private/path'}}}}})));
  assert.deepEqual(projectedFailure.switchedInputDetails.collaboration.deviceDiagnostics,{lastRaw:{ownReceiptMatched:false}});
  for (const platform of ['linux', 'darwin']) {
    const mcp = loadMcp(platform);
    assert.deepEqual(mcp.toolDefinitions(), []);
    let relayed = false;
    const protocol = mcp.createProtocol({ relay: async () => { relayed = true; } });
    assert.deepEqual((await protocol({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools, []);
    for (const name of ['capture', 'context', 'capture_desktop', 'desktop_input', 'ui_operation']) {
      const denied = await protocol({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: {} } });
      assert.equal(denied.result.isError, true);
      const error = JSON.parse(denied.result.content[0].text);
      assert.equal(error.code, 'unsupported_action');
      assert.equal(error.actionExecuted, false);
    }
    assert.equal(relayed, false);
  }
  const virtualResult=JSON.parse(callResult({windowId:'opaque',targetId:'private',delivery:'virtualInput',verified:false,delivered:true,detached:true,pid:123,dllPath:'secret'}).content[0].text);
  assert.equal(virtualResult.windowId,'opaque');assert.equal(virtualResult.targetId,undefined);assert.equal(virtualResult.delivery,'virtualInput');assert.equal(virtualResult.verified,false);assert.equal(virtualResult.detached,true);assert.equal(virtualResult.pid,undefined);assert.equal(virtualResult.dllPath,undefined);
  const threadId = '12345678-1234-1234-1234-123456789abc';
  const proof = { 'codex/sandbox-state-meta': { permissionProfile: { type: 'disabled' } } };
  assert.equal(parseThreadMetadata({ 'x-codex-turn-metadata': { thread_id: threadId }, threadId }), threadId);
  assert.equal(parseThreadMetadata({ 'x-codex-turn-metadata': JSON.stringify({ thread_id: threadId }) }), threadId);
  assert.equal(parseThreadMetadata({ threadId }), threadId);
  assert.throws(() => parseThreadMetadata({ arguments: { threadId } }), /metadata/);
  assert.throws(() => parseThreadMetadata({ threadId, 'x-codex-turn-metadata': null }), /metadata/);
  assert.throws(() => parseThreadMetadata({ threadId, 'x-codex-turn-metadata': '{bad' }), /metadata/);
  assert.throws(() => parseThreadMetadata({ threadId, 'x-codex-turn-metadata': {} }), /identifier/);
  assert.throws(() => parseThreadMetadata({ 'x-codex-turn-metadata': { thread_id: '../escape' } }), /identifier/);
  assert.throws(() => parseThreadMetadata({ 'x-codex-turn-metadata': { thread_id: threadId }, threadId: 'different' }), /Conflicting/);
  assert.throws(() => parseThreadMetadata({ codexTurnMetadata: { threadId } }), /metadata/);
  let received, receivedOptions;
  const fixturePipe = process.platform === 'win32' ? '\\\\.\\pipe\\azrael-window-1234567890123456' : '/tmp/azw-ABC123/w.sock';
  const relay = createRelay({ codexHome: 'C:/fake', readFile: async file => { assert.ok(file.endsWith(threadId + '.json')); return JSON.stringify({ schema: 1, pipe: fixturePipe, nonce: 'n'.repeat(32) }); }, request: async (pipe, message, options) => { received = message; receivedOptions = options; return { windowId: 'opaque', state: 'ready', window: { title: 'Selected', executable: 'secret' } }; } });
  const protocol = createProtocol({ relay });
  const call = args => protocol({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'capture', arguments: args, _meta: { ...proof, 'x-codex-turn-metadata': { thread_id: threadId } } } });
  assert.equal((await call({ windowId: 'opaque' })).result.isError, false); assert.equal(received.threadId, threadId); assert.equal(received.method, 'call');
  assert.equal(received._meta['x-codex-turn-metadata'].sandbox_mode, undefined);
  const nativeMeta = { threadId, unrelated: 'omit', 'codex/sandbox-state-meta': { permissionProfile: { type: 'disabled' }, profileId: 'omit', sandboxPolicy: 'omit' }, 'x-codex-turn-metadata': JSON.stringify({ thread_id: threadId, turn_id: 'turn1', sandbox_mode: 'danger-full-access', unrelated: 'omit' }) };
  for(const retired of ['virtual_input','release_virtual_input','request_stage','launch_isolated','capture_isolated','input_isolated','logoff_isolated','resource_status']){
    const denied=await protocol({jsonrpc:'2.0',id:13,method:'tools/call',params:{name:retired,arguments:{},_meta:nativeMeta}});assert.equal(denied.result.isError,true);
  }
  await relay(threadId,'capture_desktop',{},nativeMeta);assert.equal(receivedOptions,undefined);
  const masked=callResult({redacted:true,originX:-1920,originY:0,maskedWindowCount:2,widthPx:3840,heightPx:1080,image:{mimeType:'image/png',data:'YQ=='}});assert.equal(masked.content[1].type,'image');assert.deepEqual(JSON.parse(masked.content[0].text),{widthPx:3840,heightPx:1080,originX:-1920,originY:0,redacted:true,maskedWindowCount:2});
  await relay(threadId, 'capture', { windowId: 'opaque' }, nativeMeta);
  assert.deepEqual(received._meta, { ...proof, threadId, 'x-codex-turn-metadata': { thread_id: threadId, turn_id: 'turn1' } });
  const forwarded = await protocol({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'capture', arguments: { windowId: 'opaque' }, _meta: nativeMeta } });
  assert.equal(forwarded.result.isError, false);
  assert.deepEqual(received._meta, { ...proof, threadId, 'x-codex-turn-metadata': { thread_id: threadId, turn_id: 'turn1' } });
  await protocol({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'status', arguments: { windowId: 'opaque' }, _meta: { ...proof, threadId } } });
  assert.deepEqual(received._meta, { ...proof, threadId });
  assert.deepEqual(relayMetadata({ ...proof, threadId }), { ...proof, threadId });
  assert.throws(() => relayMetadata(undefined), /metadata/);
  assert.throws(() => relayMetadata({ threadId }), e => e.code === 'permission_denied' && e.nativePermissionReason === 'missing' && e.stage === 'permission' && e.actionExecuted === false);
  await assert.rejects(relay(threadId, 'capture', {}, { threadId, 'x-codex-turn-metadata': { thread_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', sandbox_mode: 'danger-full-access' } }), /Conflicting/);
  assert.throws(() => relayMetadata({ ...proof, threadId, 'x-codex-turn-metadata': { thread_id: threadId, turn_id: {} } }), /context/);
  for (const [invalid, reason] of [[undefined, 'malformed'], [null, 'malformed'], ['disabled', 'malformed'], [{}, 'missing'], [[], 'malformed'], [{ permissionProfile: null }, 'malformed'], [{ permissionProfile: 'disabled' }, 'malformed'], [{ permissionProfile: {} }, 'malformed'], [{ permissionProfile: [] }, 'malformed'], [{ permissionProfile: { type: null } }, 'malformed'], [{ permissionProfile: { type: '' } }, 'malformed'], [{ permissionProfile: { type: 'managed' } }, 'not_disabled'], [{ permissionProfile: { type: 'external' } }, 'not_disabled'], [{ permissionProfile: { type: 'disabled', unexpected: true } }, 'malformed'], [{ permissionProfile: { type: 'managed', unexpected: true } }, 'malformed']]) {
    const invalidMeta = { threadId, 'x-codex-turn-metadata': { thread_id: threadId, sandbox_mode: 'danger-full-access' }, 'codex/sandbox-state-meta': invalid };
    assert.throws(() => relayMetadata(invalidMeta), e => e.code === 'permission_denied' && e.message === 'Native Disabled permission profile required' && e.stage === 'permission' && e.nativePermissionReason === reason && e.actionExecuted === false);
    const previousReceived = received;
    const denied = await protocol({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'capture', arguments: { windowId: 'opaque' }, _meta: invalidMeta } });
    assert.equal(denied.result.isError, true); assert.equal(received, previousReceived);
    assert.deepEqual(JSON.parse(denied.result.content[0].text), { code: 'permission_denied', message: 'Native Disabled permission profile required', stage: 'permission', actionExecuted: false, nativePermissionReason: reason });
  }
  assert.equal((await call({ windowId: 'opaque', threadId })).result.isError, true);
  assert.equal((await protocol({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'capture', arguments: { windowId: 'opaque' } } })).result.isError, true);
  assert.equal((await protocol({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })).result.capabilities.tools.constructor, Object);
  assert.deepEqual((await protocol({ jsonrpc: '2.0', id: 1, method: 'initialize' })).result.capabilities.experimental, { 'codex/sandbox-state-meta': {} });
  const listed = (await protocol({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools;
  assert.ok(!listed.some(t => t.name === 'select_window'));
  const previousSelection = received;
  const removedSelection = await protocol({ jsonrpc:'2.0', id:20, method:'tools/call', params:{name:'select_window',arguments:{candidateId:'opaque'},_meta:{...proof,threadId}} });
  assert.equal(removedSelection.result.isError,true); assert.equal(received,previousSelection);
  assert.ok(!listed.some(t=>['request_stage','launch_isolated','input_isolated','capture_isolated','logoff_isolated'].includes(t.name)));
  assert.ok(!listed.some(t=>['request_permission','prepare_permissions'].includes(t.name)));
  for(const name of ['request_permission','prepare_permissions']){const rejected=await protocol({jsonrpc:'2.0',id:19,method:'tools/call',params:{name,arguments:{permission:'desktop',reason:'removed'},_meta:proof}});assert.equal(rejected.result.isError,true);}
  const desktop=listed.find(t=>t.name==='desktop_input').inputSchema;
  assert.deepEqual(desktop.required,['observationId','input']);assert.equal(desktop.properties.windowId,undefined);
  const drag=desktop.properties.input.oneOf.find(s=>s.properties.action.enum[0]==='drag');
  assert.ok(drag.required.includes('fromX')&&drag.required.includes('fromY'));
  assert.deepEqual(listed.find(t=>t.name==='release_desktop_input').inputSchema.required,[]);
  assert.deepEqual(listed.find(t=>t.name==='capture_desktop').inputSchema.required,[]);
  const hiddenUi = listed.find(t => t.name === 'ui_operation');
  assert.deepEqual(hiddenUi._meta, { ui: { visibility: ['app'] } });
  assert.deepEqual(hiddenUi.inputSchema.required, ['requestToken']); assert.equal(hiddenUi.inputSchema.additionalProperties, false);

  for (const name of ['context','list_windows','list_task_macros','save_task_macro','capture_desktop','desktop_input','release_desktop_input']) assert.ok(!listed.find(t => t.name === name).inputSchema.required.includes('windowId'));
  const windowTools = listed.filter(t => !['context','list_windows','list_task_macros','save_task_macro','capture_desktop','desktop_input','release_desktop_input','ui_operation'].includes(t.name));
  for (const tool of windowTools) {
    assert.ok(tool.inputSchema.required.includes('windowId'),tool.name);
    assert.equal(tool.inputSchema.properties.targetId,undefined);
    for (const args of [{}, {targetId:'opaque'}, {windowId:''}, {windowId:42}]) {
      const previous = received;
      const rejected = await protocol({jsonrpc:'2.0',id:21,method:'tools/call',params:{name:tool.name,arguments:args,_meta:{...proof,threadId}}});
      assert.equal(rejected.result.isError,true,tool.name); assert.equal(received,previous);
    }
  }
  const uiCall = (args, meta) => protocol({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'ui_operation', arguments: args, _meta: meta } });
  const requestToken = 'a1'.repeat(32);
  const acceptedUi = await uiCall({ requestToken }, { ...proof, threadId, sessionId: threadId });
  assert.equal(acceptedUi.result.isError, false); assert.equal(received.tool, 'ui_operation');
  assert.deepEqual(received.arguments, { requestToken }); assert.deepEqual(received._meta, { ...proof, threadId });
  for (const invalidArgs of [{}, { requestToken: 'a'.repeat(63) }, { requestToken: 'g'.repeat(64) }, { requestToken: 1 }, { requestToken, threadId }, { requestToken, operation: 'bind' }]) {
    const previousReceived = received; assert.equal((await uiCall(invalidArgs, { ...proof, threadId })).result.isError, true); assert.equal(received, previousReceived);
  }
  for (const noAuthority of [undefined, { threadId }, { threadId, 'codex/sandbox-state-meta': { permissionProfile: { type: 'managed' } } }]) {
    const previousReceived = received; assert.equal((await uiCall({ requestToken }, noAuthority)).result.isError, true); assert.equal(received, previousReceived);
  }
  assert.equal((await uiCall({ requestToken }, { ...proof, threadId, 'x-codex-turn-metadata': null })).result.isError, true);
  assert.deepEqual(listed.find(t => t.name === 'status').inputSchema.required, ['windowId']);
  assert.ok(listed.find(t => t.name === 'capture').inputSchema.required.includes('windowId'));
  const restore = listed.find(t => t.name === 'restore_window');
  assert.deepEqual(restore.inputSchema.required, ['windowId']);
  assert.deepEqual(Object.keys(restore.inputSchema.properties), ['windowId']);
  assert.equal(restore.inputSchema.additionalProperties, false);
  assert.match(restore.description, /Never resumes a user stop/);
  assert.deepEqual(JSON.parse(callResult({state:'paused',pauseReason:'minimized',restoreAllowed:true,restored:false,window:{minimized:true}}).content[0].text), {state:'paused',window:{minimized:true},pauseReason:'minimized',restoreAllowed:true,restored:false});
  const initialStatus = await protocol({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'status', arguments: {}, _meta: { ...proof, threadId } } });
  assert.equal(initialStatus.result.isError, true);
  assert.equal((await call({})).result.isError, true);
  assert.ok(!listed.some(t => ['bind', 'resume', 'listWindows'].includes(t.name)));
  const sanitized = callResult({ window: { title: 'selected', hwnd: 'secret' }, unrelated: 'secret', image: { mimeType: 'image/png', data: 'YQ==' } });
  assert.ok(!sanitized.content[0].text.includes('secret')); assert.equal(sanitized.content[1].type, 'image');
  const missing = createRelay({ readFile: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } }); await assert.rejects(missing(threadId, 'capture', {}, { ...proof, threadId }), /No selected/);
  let output = ''; await runProtocol({ input: Readable.from(['{bad\n', JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }) + '\n']), output: new Writable({ write(chunk, encoding, done) { output += chunk; done(); } }), protocol });
  const lines = output.trim().split('\n').map(JSON.parse); assert.equal(lines[0].error.code, -32700); assert.deepEqual(lines[1].result, {});
  const koreanResult = { window: { title: '한국어 창 제목' }, elementsTruncated: false, elements: [{ id: 'e', name: '저장 버튼' }], _meta: relayMetadata(nativeMeta) };
  const encoded = Buffer.from(JSON.stringify({ result: koreanResult }) + '\n', 'utf8');
  const byteChunks = Array.from(encoded, byte => Buffer.from([byte]));
  assert.deepEqual(await pipeRequest('mock', {}, { connect: fragmentedConnection(byteChunks) }), koreanResult);
  const limit = 32 * 1024 * 1024;
  const oversizedMultibyte = Buffer.from('한'.repeat(Math.floor(limit / 3) + 1), 'utf8');
  assert.ok(oversizedMultibyte.length > limit); assert.ok(oversizedMultibyte.toString('utf8').length < limit);
  await assert.rejects(pipeRequest('mock', {}, { connect: fragmentedConnection([oversizedMultibyte.subarray(0, limit), oversizedMultibyte.subarray(limit)]) }), e => e.code === 'unclassified' && e.message === '미분류된 오류');
  const prefix = '{"result":{"text":"'; const suffix = '"}}\n';
  const atLimit = Buffer.from(prefix + 'x'.repeat(limit - Buffer.byteLength(prefix + suffix)) + suffix);
  assert.equal(atLimit.length, limit);
  assert.equal((await pipeRequest('mock', {}, { connect: fragmentedConnection([atLimit]) })).text.length, limit - Buffer.byteLength(prefix + suffix));
  console.log('PASS MCP: metadata isolation, session relay, tool boundary, sanitized result, newline JSON-RPC');
}
main().catch(e => { console.error(e); process.exitCode = 1; });

const publicOccupancy = {status:'occupied',sessions:[{sessionId:'other',workspaceName:'Workspace',state:'paused',isCurrentSession:false,updatedAt:123,nonce:'private',pipe:'private'}]};
const projectedOccupancy = JSON.parse(callResult({occupancy:publicOccupancy,candidates:[{windowId:'opaque',candidateId:'private',appName:'app',title:'title',minimized:false,hwnd:'private',occupancy:publicOccupancy}]}).content[0].text);
assert.deepEqual(Object.keys(projectedOccupancy.occupancy.sessions[0]).sort(),['isCurrentSession','sessionId','state','updatedAt','workspaceName']);
assert.equal(projectedOccupancy.candidates[0].windowId,'opaque');assert.equal(projectedOccupancy.candidates[0].candidateId,undefined);assert.equal(projectedOccupancy.candidates[0].occupancy.status,'occupied'); assert.equal(projectedOccupancy.candidates[0].hwnd,undefined);
assert.throws(()=>callResult({occupancy:{status:'available',sessions:publicOccupancy.sessions}}),/Invalid occupancy/);

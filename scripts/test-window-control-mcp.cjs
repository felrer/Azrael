'use strict';
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const vm = require('node:vm');
function loadMcp(platform) {
  const module = { exports: {} };
  vm.compileFunction(fs.readFileSync(require.resolve('./window-control-mcp.cjs'), 'utf8'), ['require', 'module', 'exports', 'process'])(require, module, module.exports, { platform, env: process.env });
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
  for (const platform of ['linux', 'darwin']) {
    const mcp = loadMcp(platform);
    assert.deepEqual(mcp.toolDefinitions(), []);
    let relayed = false;
    const protocol = mcp.createProtocol({ relay: async () => { relayed = true; } });
    assert.deepEqual((await protocol({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools, []);
    for (const name of ['capture', 'context', 'launch_isolated', 'ui_operation']) {
      const denied = await protocol({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: {} } });
      assert.equal(denied.result.isError, true);
      const error = JSON.parse(denied.result.content[0].text);
      assert.equal(error.code, 'unsupported_action');
      assert.equal(error.actionExecuted, false);
    }
    assert.equal(relayed, false);
  }
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
  const relay = createRelay({ codexHome: 'C:/fake', readFile: async file => { assert.ok(file.endsWith(threadId + '.json')); return JSON.stringify({ schema: 1, pipe: fixturePipe, nonce: 'n'.repeat(32) }); }, request: async (pipe, message, options) => { received = message; receivedOptions = options; return { targetId: 'opaque', state: 'ready', window: { title: 'Selected', executable: 'secret' } }; } });
  const protocol = createProtocol({ relay });
  const call = args => protocol({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'capture', arguments: args, _meta: { ...proof, 'x-codex-turn-metadata': { thread_id: threadId } } } });
  assert.equal((await call({ targetId: 'opaque' })).result.isError, false); assert.equal(received.threadId, threadId); assert.equal(received.method, 'call');
  assert.equal(received._meta['x-codex-turn-metadata'].sandbox_mode, undefined);
  const nativeMeta = { threadId, unrelated: 'omit', 'codex/sandbox-state-meta': { permissionProfile: { type: 'disabled' }, profileId: 'omit', sandboxPolicy: 'omit' }, 'x-codex-turn-metadata': JSON.stringify({ thread_id: threadId, turn_id: 'turn1', sandbox_mode: 'danger-full-access', unrelated: 'omit' }) };
  const nativeDiagnostic = {code:'native_child_error',hresult:-2146233088,cleanupUnconfirmed:true,phase:'start',message:"'ChildSession.Host'에 'Guard'에 대한 정의가 없습니다."};
  const diagnosticProtocol = createProtocol({relay:async()=>({authorized:false,missingPrerequisite:'native_child_error',diagnostic:{...nativeDiagnostic,stack:'must not escape'}})});
  const diagnosticReply = await diagnosticProtocol({jsonrpc:'2.0',id:13,method:'tools/call',params:{name:'request_stage',arguments:{stage:3,reason:'Verify bounded failure diagnostics'},_meta:nativeMeta}});
  const projectedDiagnostic = JSON.parse(diagnosticReply.result.content[0].text);
  assert.equal(projectedDiagnostic.authorized,false);
  assert.deepEqual(projectedDiagnostic.diagnostic,nativeDiagnostic);
  assert.equal(JSON.stringify(projectedDiagnostic).includes('must not escape'),false);
  const sensitiveDiagnostic = JSON.parse(callResult({diagnostic:{...nativeDiagnostic,message:'password=private-value'}}).content[0].text).diagnostic;
  assert.equal(sensitiveDiagnostic.message,'[redacted diagnostic message]');
  assert.equal(sensitiveDiagnostic.hresult,nativeDiagnostic.hresult);
  await relay(threadId, 'request_stage', { stage: 3, reason: 'fixture' }, nativeMeta);
  assert.deepEqual(receivedOptions, { timeoutMs: 360000 });
  await relay(threadId, 'request_stage', { stage: 2, reason: 'fixture' }, nativeMeta);
  assert.equal(receivedOptions, undefined);
  await relay(threadId, 'capture', { targetId: 'opaque' }, nativeMeta);
  assert.deepEqual(received._meta, { ...proof, threadId, 'x-codex-turn-metadata': { thread_id: threadId, turn_id: 'turn1' } });
  const forwarded = await protocol({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'capture', arguments: { targetId: 'opaque' }, _meta: nativeMeta } });
  assert.equal(forwarded.result.isError, false);
  assert.deepEqual(received._meta, { ...proof, threadId, 'x-codex-turn-metadata': { thread_id: threadId, turn_id: 'turn1' } });
  await protocol({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'status', arguments: { targetId: 'opaque' }, _meta: { ...proof, threadId } } });
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
    const denied = await protocol({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'capture', arguments: { targetId: 'opaque' }, _meta: invalidMeta } });
    assert.equal(denied.result.isError, true); assert.equal(received, previousReceived);
    assert.deepEqual(JSON.parse(denied.result.content[0].text), { code: 'permission_denied', message: 'Native Disabled permission profile required', stage: 'permission', actionExecuted: false, nativePermissionReason: reason });
  }
  assert.equal((await call({ targetId: 'opaque', threadId })).result.isError, true);
  assert.equal((await protocol({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'capture', arguments: { targetId: 'opaque' } } })).result.isError, true);
  assert.equal((await protocol({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })).result.capabilities.tools.constructor, Object);
  assert.deepEqual((await protocol({ jsonrpc: '2.0', id: 1, method: 'initialize' })).result.capabilities.experimental, { 'codex/sandbox-state-meta': {} });
  const listed = (await protocol({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools;
  assert.match(listed.find(t => t.name === 'select_window').description, /read-only observation.*Does not request or grant app control/);
  const installedLaunch = listed.find(t => t.name === 'launch_isolated');
  assert.deepEqual(installedLaunch.inputSchema.required, []);
  assert.deepEqual(installedLaunch.inputSchema.oneOf.map(branch => branch.required), [['targetId'], ['packageName']]);
  assert.equal(installedLaunch.inputSchema.properties.packageName.pattern, '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$');
  assert.match(installedLaunch.description, /No parent app window is required/);
  const hiddenUi = listed.find(t => t.name === 'ui_operation');
  assert.deepEqual(hiddenUi._meta, { ui: { visibility: ['app'] } });
  assert.deepEqual(hiddenUi.inputSchema.required, ['requestToken']); assert.equal(hiddenUi.inputSchema.additionalProperties, false);

  assert.equal(listed.find(t=>t.name==='prepare_permissions').inputSchema.properties.candidateIds.maxItems,8);
  for (const name of ['prepare_permissions','list_windows','select_window','list_task_macros','save_task_macro']) assert.ok(!listed.find(t => t.name === name).inputSchema.required.includes('targetId'));
  for (const name of ['inspect','press_key','run_task_macro']) assert.ok(listed.find(t => t.name === name).inputSchema.required.includes('targetId'));
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
  assert.deepEqual(listed.find(t => t.name === 'status').inputSchema.required, []);
  assert.ok(listed.find(t => t.name === 'capture').inputSchema.required.includes('targetId'));
  const restore = listed.find(t => t.name === 'restore_window');
  assert.deepEqual(restore.inputSchema.required, ['targetId']);
  assert.deepEqual(Object.keys(restore.inputSchema.properties), ['targetId']);
  assert.equal(restore.inputSchema.additionalProperties, false);
  assert.match(restore.description, /Never resumes a user stop/);
  assert.deepEqual(JSON.parse(callResult({state:'paused',pauseReason:'minimized',restoreAllowed:true,restored:false,window:{minimized:true}}).content[0].text), {state:'paused',window:{minimized:true},pauseReason:'minimized',restoreAllowed:true,restored:false});
  const initialStatus = await protocol({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'status', arguments: {}, _meta: { ...proof, threadId } } });
  assert.equal(initialStatus.result.isError, false); assert.deepEqual(received.arguments, {});
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
const projectedOccupancy = JSON.parse(callResult({occupancy:publicOccupancy,candidates:[{candidateId:'opaque',appName:'app',title:'title',minimized:false,hwnd:'private',occupancy:publicOccupancy}]}).content[0].text);
assert.deepEqual(Object.keys(projectedOccupancy.occupancy.sessions[0]).sort(),['isCurrentSession','sessionId','state','updatedAt','workspaceName']);
assert.equal(projectedOccupancy.candidates[0].occupancy.status,'occupied'); assert.equal(projectedOccupancy.candidates[0].hwnd,undefined);
assert.throws(()=>callResult({occupancy:{status:'available',sessions:publicOccupancy.sessions}}),/Invalid occupancy/);

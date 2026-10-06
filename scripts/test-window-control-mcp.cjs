'use strict';
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { parseThreadMetadata, relayMetadata, pipeRequest, createRelay, createProtocol, runProtocol, callResult } = require('./window-control-mcp.cjs');
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
  let received;
  const relay = createRelay({ codexHome: 'C:/fake', readFile: async file => { assert.ok(file.endsWith(threadId + '.json')); return JSON.stringify({ schema: 1, pipe: '\\\\.\\pipe\\azrael-window-1234567890123456', nonce: 'n'.repeat(32) }); }, request: async (pipe, message) => { received = message; return { targetId: 'opaque', state: 'ready', window: { title: 'Selected', executable: 'secret' } }; } });
  const protocol = createProtocol({ relay });
  const call = args => protocol({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'capture', arguments: args, _meta: { ...proof, 'x-codex-turn-metadata': { thread_id: threadId } } } });
  assert.equal((await call({ targetId: 'opaque' })).result.isError, false); assert.equal(received.threadId, threadId); assert.equal(received.method, 'call');
  assert.equal(received._meta['x-codex-turn-metadata'].sandbox_mode, undefined);
  const nativeMeta = { threadId, unrelated: 'omit', 'codex/sandbox-state-meta': { permissionProfile: { type: 'disabled' }, profileId: 'omit', sandboxPolicy: 'omit' }, 'x-codex-turn-metadata': JSON.stringify({ thread_id: threadId, turn_id: 'turn1', sandbox_mode: 'danger-full-access', unrelated: 'omit' }) };
  await relay(threadId, 'capture', { targetId: 'opaque' }, nativeMeta);
  assert.deepEqual(received._meta, { ...proof, threadId, 'x-codex-turn-metadata': { thread_id: threadId, turn_id: 'turn1' } });
  const forwarded = await protocol({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'capture', arguments: { targetId: 'opaque' }, _meta: nativeMeta } });
  assert.equal(forwarded.result.isError, false);
  assert.deepEqual(received._meta, { ...proof, threadId, 'x-codex-turn-metadata': { thread_id: threadId, turn_id: 'turn1' } });
  await protocol({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'status', arguments: { targetId: 'opaque' }, _meta: { ...proof, threadId } } });
  assert.deepEqual(received._meta, { ...proof, threadId });
  assert.deepEqual(relayMetadata({ ...proof, threadId }), { ...proof, threadId });
  assert.throws(() => relayMetadata(undefined), /metadata/);
  assert.throws(() => relayMetadata({ threadId }), /Disabled permission profile/);
  await assert.rejects(relay(threadId, 'capture', {}, { threadId, 'x-codex-turn-metadata': { thread_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', sandbox_mode: 'danger-full-access' } }), /Conflicting/);
  assert.throws(() => relayMetadata({ ...proof, threadId, 'x-codex-turn-metadata': { thread_id: threadId, turn_id: {} } }), /context/);
  for (const invalid of [undefined, null, 'disabled', {}, [], { permissionProfile: null }, { permissionProfile: 'disabled' }, { permissionProfile: {} }, { permissionProfile: { type: 'managed' } }, { permissionProfile: { type: 'external' } }, { permissionProfile: { type: 'disabled', unexpected: true } }]) {
    const invalidMeta = { threadId, 'x-codex-turn-metadata': { thread_id: threadId, sandbox_mode: 'danger-full-access' }, 'codex/sandbox-state-meta': invalid };
    assert.throws(() => relayMetadata(invalidMeta), /Disabled permission profile/);
    const previousReceived = received;
    const denied = await protocol({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'capture', arguments: { targetId: 'opaque' }, _meta: invalidMeta } });
    assert.equal(denied.result.isError, true); assert.equal(received, previousReceived);
  }
  assert.equal((await call({ targetId: 'opaque', threadId })).result.isError, true);
  assert.equal((await protocol({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'capture', arguments: { targetId: 'opaque' } } })).result.isError, true);
  assert.equal((await protocol({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })).result.capabilities.tools.constructor, Object);
  assert.deepEqual((await protocol({ jsonrpc: '2.0', id: 1, method: 'initialize' })).result.capabilities.experimental, { 'codex/sandbox-state-meta': {} });
  const listed = (await protocol({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools;
  const hiddenUi = listed.find(t => t.name === 'ui_operation');
  assert.deepEqual(hiddenUi._meta, { ui: { visibility: ['app'] } });
  assert.deepEqual(hiddenUi.inputSchema.required, ['requestToken']); assert.equal(hiddenUi.inputSchema.additionalProperties, false);
  assert.equal(listed.length, 19);
  for (const name of ['list_windows','select_window','list_task_macros','save_task_macro']) assert.ok(!listed.find(t => t.name === name).inputSchema.required.includes('targetId'));
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
  const initialStatus = await protocol({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'status', arguments: {}, _meta: { ...proof, threadId } } });
  assert.equal(initialStatus.result.isError, false); assert.deepEqual(received.arguments, {});
  assert.equal((await call({})).result.isError, true);
  assert.ok(!listed.some(t => ['bind', 'resume', 'listWindows'].includes(t.name)));
  const sanitized = callResult({ window: { title: 'selected', hwnd: 'secret' }, unrelated: 'secret', image: { mimeType: 'image/png', data: 'YQ==' } });
  assert.ok(!sanitized.content[0].text.includes('secret')); assert.equal(sanitized.content[1].type, 'image');
  const missing = createRelay({ readFile: async () => { throw new Error('ENOENT'); } }); await assert.rejects(missing(threadId, 'capture', {}, { ...proof, threadId }), /No selected/);
  let output = ''; await runProtocol({ input: Readable.from(['{bad\n', JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }) + '\n']), output: new Writable({ write(chunk, encoding, done) { output += chunk; done(); } }), protocol });
  const lines = output.trim().split('\n').map(JSON.parse); assert.equal(lines[0].error.code, -32700); assert.deepEqual(lines[1].result, {});
  const koreanResult = { window: { title: '한국어 창 제목' }, elementsTruncated: false, elements: [{ id: 'e', name: '저장 버튼' }], _meta: relayMetadata(nativeMeta) };
  const encoded = Buffer.from(JSON.stringify({ result: koreanResult }) + '\n', 'utf8');
  const byteChunks = Array.from(encoded, byte => Buffer.from([byte]));
  assert.deepEqual(await pipeRequest('mock', {}, { connect: fragmentedConnection(byteChunks) }), koreanResult);
  const limit = 32 * 1024 * 1024;
  const oversizedMultibyte = Buffer.from('한'.repeat(Math.floor(limit / 3) + 1), 'utf8');
  assert.ok(oversizedMultibyte.length > limit); assert.ok(oversizedMultibyte.toString('utf8').length < limit);
  await assert.rejects(pipeRequest('mock', {}, { connect: fragmentedConnection([oversizedMultibyte.subarray(0, limit), oversizedMultibyte.subarray(limit)]) }), /Host response too large/);
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

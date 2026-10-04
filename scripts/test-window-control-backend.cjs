'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createBackend } = require('./window-control-backend.cjs');
async function main() {
  let launched = 0, options, child, replyResult = { windows: [] }; const nativeRequests = [];
  const declaration = { executable: 'C:/verified/helper.exe', manifestSha256: 'hash' };
  const runtime = { windowControl: declaration, env: { AZRAEL_EX_MANAGEMENT_SOCKET: 'secret', SKY_SESSION: 'old' } };
  const spawnChild = (_exe, _args, opts) => {
    launched++; options = opts; child = new EventEmitter(); child.exitCode = null; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { write(line) { const request = JSON.parse(line); nativeRequests.push(request); const bytes = Buffer.from(JSON.stringify({ id: request.id, result: replyResult }) + '\n'); queueMicrotask(() => { for (let i = 0; i < bytes.length; i++) child.stdout.emit('data', bytes.subarray(i, i + 1)); }); }, end(line) { assert.equal(JSON.parse(line).method, 'shutdown'); child.exitCode = 0; queueMicrotask(() => child.emit('exit', 0)); } };
    child.kill = () => { throw new Error('Mock successful shutdown must not kill'); }; return child;
  };
  const backend = createBackend(runtime, { spawnChild, verify: () => declaration });
  assert.equal(launched, 0); assert.deepEqual(await backend.request('listWindows', {}), []); await backend.request('status', {}); assert.equal(launched, 1);
  const window = { hwnd: '1a', pid: 12, processCreated: '1b', executable: 'C:/프로그램/한글앱.exe', title: '한글 창 제목', minimized: false, widthPx: 800, heightPx: 600, dpi: 96 };
  replyResult = { windows: [window] }; assert.deepEqual(await backend.request('listWindows', {}), [window]); assert.deepEqual(nativeRequests.at(-1).params, {});
  for (const malformed of [null, [], { windows: {} }, { windows: [], extra: true }, {}]) { replyResult = malformed; await assert.rejects(backend.request('listWindows', {}), /listWindows result envelope/); }
  for (const [method, extra, response] of [
    ['status', {}, { window, state: 'normal', foregroundHwnd: '2a', cursorVisible: true }], ['restore', {}, { window, restored: true }], ['resize', { widthDip: 800, heightDip: 600 }, { window, widthPx: 800, heightPx: 600, widthDip: 800, heightDip: 600 }],
    ['act', { observationId: 'observation-1', elementId: 'element-1', action: 'setValue', value: '한글 값' }, { window, acted: true, requiresObservation: true }],
  ]) { const params = { window, ...extra }; replyResult = response; assert.deepEqual(await backend.request(method, params), response); assert.equal(nativeRequests.at(-1).method, method); assert.deepEqual(nativeRequests.at(-1).params, params); }
  replyResult = { window: { executable: 'C:/프로그램/한글앱.exe', title: '한글 창 제목' }, elements: [{ name: '입력 영역' }] }; assert.deepEqual(await backend.request('observe', {}), replyResult);
  assert.equal(options.windowsHide, true); assert.equal(options.env.AZRAEL_EX_MANAGEMENT_SOCKET, undefined); assert.equal(options.env.SKY_SESSION, undefined);
  await assert.rejects(backend.request('shell', {}), /Unsupported/); await backend.dispose(); await assert.rejects(backend.request('status', {}), /disposed/);
  let invalidSpawn = false; const invalid = createBackend(runtime, { spawnChild() { invalidSpawn = true; }, verify: () => ({ ...declaration, manifestSha256: 'wrong' }) });
  await assert.rejects(invalid.request('listWindows', {}), /declaration mismatch/); assert.equal(invalidSpawn, false); await invalid.dispose();
  let killed = 0; let timeoutChild;
  const stalled = createBackend(runtime, { verify: () => declaration, timeoutMs: 10, shutdownMs: 10, spawnChild() { timeoutChild = new EventEmitter(); timeoutChild.exitCode = null; timeoutChild.stdout = new EventEmitter(); timeoutChild.stderr = new EventEmitter(); timeoutChild.stdin = { write() {}, end() {} }; timeoutChild.kill = () => { killed++; timeoutChild.exitCode = 1; timeoutChild.emit('exit', 1); }; return timeoutChild; } });
  await assert.rejects(stalled.request('status', {}), /timed out/); await new Promise(r => setTimeout(r, 30)); assert.equal(killed, 1);
  console.log('Window backend: exact native listWindows envelope normalization and malformed rejection, other-method passthrough, fragmented Korean UTF8, manifest gate and owned-child lifecycle passed');
}
main().catch(e => { console.error(e); process.exitCode = 1; });

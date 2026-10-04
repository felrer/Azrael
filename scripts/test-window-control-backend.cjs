'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createBackend } = require('./window-control-backend.cjs');
async function main() {
  let launched = 0, options, child;
  const declaration = { executable: 'C:/verified/helper.exe', manifestSha256: 'hash' };
  const runtime = { windowControl: declaration, env: { AZRAEL_EX_MANAGEMENT_SOCKET: 'secret', SKY_SESSION: 'old' } };
  const spawnChild = (_exe, _args, opts) => {
    launched++; options = opts; child = new EventEmitter(); child.exitCode = null; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { write(line) { const request = JSON.parse(line); queueMicrotask(() => child.stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, result: [] }) + '\n'))); }, end(line) { assert.equal(JSON.parse(line).method, 'shutdown'); child.exitCode = 0; queueMicrotask(() => child.emit('exit', 0)); } };
    child.kill = () => { throw new Error('Mock successful shutdown must not kill'); }; return child;
  };
  const backend = createBackend(runtime, { spawnChild, verify: () => declaration });
  assert.equal(launched, 0); assert.deepEqual(await backend.request('listWindows', {}), []); await backend.request('status', {}); assert.equal(launched, 1);
  assert.equal(options.windowsHide, true); assert.equal(options.env.AZRAEL_EX_MANAGEMENT_SOCKET, undefined); assert.equal(options.env.SKY_SESSION, undefined);
  await assert.rejects(backend.request('shell', {}), /Unsupported/); await backend.dispose(); await assert.rejects(backend.request('status', {}), /disposed/);
  let invalidSpawn = false; const invalid = createBackend(runtime, { spawnChild() { invalidSpawn = true; }, verify: () => ({ ...declaration, manifestSha256: 'wrong' }) });
  await assert.rejects(invalid.request('listWindows', {}), /declaration mismatch/); assert.equal(invalidSpawn, false); await invalid.dispose();
  let killed = 0; let timeoutChild;
  const stalled = createBackend(runtime, { verify: () => declaration, timeoutMs: 10, shutdownMs: 10, spawnChild() { timeoutChild = new EventEmitter(); timeoutChild.exitCode = null; timeoutChild.stdout = new EventEmitter(); timeoutChild.stderr = new EventEmitter(); timeoutChild.stdin = { write() {}, end() {} }; timeoutChild.kill = () => { killed++; timeoutChild.exitCode = 1; timeoutChild.emit('exit', 1); }; return timeoutChild; } });
  await assert.rejects(stalled.request('status', {}), /timed out/); await new Promise(r => setTimeout(r, 30)); assert.equal(killed, 1);
  console.log('Window backend: mock launch, manifest gate, environment isolation, graceful shutdown and exact owned-child timeout passed');
}
main().catch(e => { console.error(e); process.exitCode = 1; });

'use strict';
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const { verifyRuntime } = require('./window-control-runtime.cjs');
const METHODS = new Set(['listWindows', 'status', 'observe', 'restore', 'resize', 'act']);
function createBackend(runtime, { spawnChild = spawn, verify = verifyRuntime, timeoutMs = 30000, shutdownMs = 3000 } = {}) {
  let child, identity, buffer = '', disposed = false, launching;
  const pending = new Map();
  const failPending = error => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); };
  async function start() {
    if (disposed) throw new Error('Window backend disposed');
    if (child) return child;
    if (launching) return launching;
    launching = Promise.resolve().then(() => {
      const declaration = runtime?.windowControl;
      if (!declaration?.executable || !declaration.manifestSha256) throw new Error('Verified Window Control runtime unavailable');
      const checked = verify(declaration.directory || path.dirname(declaration.executable));
      if (path.resolve(checked.executable).toLowerCase() !== path.resolve(declaration.executable).toLowerCase() || checked.manifestSha256 !== declaration.manifestSha256) throw new Error('Window runtime declaration mismatch');
      const env = { ...process.env, ...(runtime.env || {}) };
      for (const key of Object.keys(env)) if (/^(AZRAEL_EX_MANAGEMENT_SOCKET|SKY.*|AZRAEL_EX_SKY.*)$/i.test(key)) delete env[key];
      const spawned = spawnChild(checked.executable, [], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      child = spawned; identity = { handle: spawned, started: randomUUID() }; buffer = '';
      const decoder = new StringDecoder('utf8'); let frameBytes = 0;
      spawned.stdout.on('data', data => {
        if (child !== spawned) return;
        const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data); let offset = 0;
        while (offset < bytes.length) {
          const newline = bytes.indexOf(10, offset); const end = newline < 0 ? bytes.length : newline + 1; const part = bytes.subarray(offset, end); offset = end;
          frameBytes += part.length;
          if (frameBytes > 32 * 1024 * 1024) { failPending(new Error('Window backend response too large')); buffer = ''; void dispose(); return; }
          buffer += decoder.write(part); if (newline < 0) break;
          const line = buffer.slice(0, -1); buffer = ''; frameBytes = 0;
          let message; try { message = JSON.parse(line); } catch { failPending(new Error('Invalid Window backend response')); void dispose(); return; }
          const p = pending.get(message.id); if (!p) continue;
          pending.delete(message.id); clearTimeout(p.timer);
          if (message.error) p.reject(new Error(typeof message.error === 'string' ? message.error : message.error.message || 'Window backend error'));
          else if (p.method === 'listWindows') {
            const result = message.result;
            if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length !== 1 || !Object.hasOwn(result, 'windows') || !Array.isArray(result.windows)) p.reject(new Error('Invalid native listWindows result envelope'));
            else p.resolve(result.windows);
          } else p.resolve(message.result);
        }
      });
      spawned.stderr.on('data', () => {}); // Never emit native content or image data into host logs.
      spawned.on('error', error => failPending(error));
      spawned.on('exit', () => { if (child === spawned) { child = undefined; identity = undefined; failPending(new Error('Window backend exited')); } });
      return spawned;
    }).finally(() => { launching = undefined; });
    return launching;
  }
  async function request(method, params) {
    if (!METHODS.has(method)) throw new Error('Unsupported native window method');
    const active = await start();
    if (disposed || active !== child) throw new Error('Window backend unavailable');
    if (pending.size >= 64) throw new Error('Too many Window backend requests');
    return new Promise((resolve, reject) => {
      const id = randomUUID(); const timer = setTimeout(() => { pending.delete(id); reject(new Error('Window backend timed out')); failPending(new Error('Window backend timed out')); void dispose(); }, timeoutMs);
      pending.set(id, { resolve, reject, timer, method });
      try { active.stdin.write(JSON.stringify({ id, method, params }) + '\n'); } catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
    });
  }
  async function dispose() {
    if (disposed) return; disposed = true;
    failPending(new Error('Window backend disposed'));
    if (launching) { try { await launching; } catch {} }
    const owned = identity; if (!owned || child !== owned.handle) return;
    const active = owned.handle;
    await new Promise(resolve => {
      const timer = setTimeout(() => { if (identity === owned && child === active && active.exitCode === null) active.kill(); resolve(); }, shutdownMs);
      active.once('exit', () => { clearTimeout(timer); resolve(); });
      try { active.stdin.end(JSON.stringify({ id: randomUUID(), method: 'shutdown', params: {} }) + '\n'); } catch { /* The exact owned handle alone may be terminated by the timer. */ }
    });
  }
  return { request, dispose };
}
module.exports = { createBackend };

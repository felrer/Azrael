'use strict';
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const { verifyRuntime } = require('./window-control-runtime.cjs');
const { windowError } = require('./window-control-errors.cjs');
const METHODS = new Set(['listWindows', 'status', 'observe', 'inspect', 'restore', 'resize', 'act', 'overlayShow', 'overlayHide']);
const MUTATIONS = new Set(['act', 'resize', 'restore']);
function nativeError(payload, method, uncorrelated = false) {
  const nativeCode = typeof payload?.code === 'string' && /^[a-z][a-z0-9-]{0,127}$/.test(payload.code) ? payload.code : undefined;
  let code = 'unclassified', message;
  if (!uncorrelated) {
    if (nativeCode === 'operation-cancelled') { code = 'cancelled'; message = 'Window control stopped by the user'; }
    else if (['unsupported-action', 'unsupported-key', 'unsupported-method', 'not-resizable'].includes(nativeCode)) { code = 'unsupported_action'; message = 'The selected window does not support this action'; }
    else if (nativeCode === 'resize-bounds') { code = 'invalid_request'; message = 'Requested window size exceeds app constraints or monitor work area'; }
    else if (['stale-observation', 'stale-target', 'stale-element', 'unknown-element', 'window-closed', 'capture-size-changed'].includes(nativeCode)) { code = 'state_changed'; message = 'The selected window state changed; select or observe it again'; }
    else if (['capture-timeout', 'provider-timeout', 'backend-timeout'].includes(nativeCode)) { code = 'timeout'; message = 'The selected window operation timed out'; }
    else if (nativeCode === 'uncertain-delivery') { code = 'connection_error'; message = 'Window action delivery could not be confirmed'; }
  }
  return windowError(code, message, { stage: 'native', nativeCode,
    ...(payload?.mutationOutcome === 'unknown' || (MUTATIONS.has(method) && !['unsupported_action', 'state_changed', 'invalid_request'].includes(code)) ? { mutationOutcome: 'unknown' } : {}) });
}
function createBackend(runtime, { spawnChild = spawn, verify = verifyRuntime, timeoutMs = 30000, shutdownMs = 3000 } = {}) {
  let child, identity, buffer = '', disposed = false, launching;
  const pending = new Map();
  const overlayListeners = new Set();
  const transportError = (code, message, options = {}) => windowError(code, message, { ...options, stage: 'native' });
  const rejectPending = (p, error) => { clearTimeout(p.timer); p.reject(MUTATIONS.has(p.method) ? windowError(error.code, error.message, { ...error, mutationOutcome: 'unknown' }) : error); };
  const failPending = error => { for (const p of pending.values()) rejectPending(p, error); pending.clear(); };
  async function start() {
    if (disposed) throw transportError('cancelled', 'Window backend disposed');
    if (child) return child;
    if (launching) return launching;
    launching = Promise.resolve().then(() => {
      const declaration = runtime?.windowControl;
      if (!declaration?.executable || !declaration.manifestSha256) throw transportError('connection_error', 'Verified Window Control runtime unavailable');
      const checked = verify(declaration.directory || path.dirname(declaration.executable));
      if (path.resolve(checked.executable).toLowerCase() !== path.resolve(declaration.executable).toLowerCase() || checked.manifestSha256 !== declaration.manifestSha256) throw transportError('connection_error', 'Window runtime declaration mismatch');
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
          if (frameBytes > 32 * 1024 * 1024) { failPending(transportError('connection_error', 'Window backend response too large')); buffer = ''; void dispose(); return; }
          buffer += decoder.write(part); if (newline < 0) break;
          const line = buffer.slice(0, -1); buffer = ''; frameBytes = 0;
          let message; try { message = JSON.parse(line); if (!message || typeof message !== 'object') throw new Error(); } catch { failPending(transportError('connection_error', 'Invalid Window backend response')); void dispose(); return; }
          if (Object.hasOwn(message, 'event')) {
            const event = message.event;
            if (Object.keys(message).length !== 1 || !event || typeof event !== 'object' || Array.isArray(event) ||
                event.type !== 'overlayStop' || Object.keys(event).some(key => !['type', 'targetId', 'generation'].includes(key)) ||
                typeof event.targetId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(event.targetId) || !Number.isSafeInteger(event.generation) || event.generation < 0) {
              failPending(transportError('connection_error', 'Invalid Window overlay event')); void dispose(); return;
            }
            // Events originate only from the exact owned, verified helper. They never settle requests.
            try { for (const listener of overlayListeners) listener({ ...event }); }
            catch { failPending(transportError('connection_error', 'Window overlay stop handling failed')); void dispose(); return; }
            continue;
          }
          if (message.id == null && message.error) {
            for (const p of pending.values()) { clearTimeout(p.timer); p.reject(nativeError(message.error, p.method, true)); }
            pending.clear(); void dispose(); return;
          }
          const p = pending.get(message.id); if (!p) continue;
          pending.delete(message.id); clearTimeout(p.timer);
          if (message.error) p.reject(nativeError(message.error, p.method));
          else if (p.method === 'listWindows') {
            const result = message.result;
            if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length !== 1 || !Object.hasOwn(result, 'windows') || !Array.isArray(result.windows)) p.reject(transportError('connection_error', 'Invalid native listWindows result envelope'));
            else p.resolve(result.windows);
          } else p.resolve(message.result);
        }
      });
      spawned.stderr.on('data', () => {}); // Never emit native content or image data into host logs.
      spawned.stdout.on('error', () => failPending(transportError('connection_error', 'Window backend response transport failed')));
      spawned.stderr.on('error', () => failPending(transportError('connection_error', 'Window backend transport failed')));
      spawned.on('error', () => failPending(transportError('connection_error', 'Window backend connection failed')));
      spawned.stdin.on?.('error', () => failPending(transportError('connection_error', 'Window backend request delivery failed')));
      spawned.on('exit', (exitCode, signal) => { if (child === spawned) { child = undefined; identity = undefined; failPending(transportError('connection_error', 'Window backend exited', { exitCode, signal: signal ?? null })); } });
      return spawned;
    }).catch(error => { throw error?.stage === 'native' ? error : transportError('connection_error', 'Window backend could not start'); }).finally(() => { launching = undefined; });
    return launching;
  }
  async function request(method, params) {
    if (!METHODS.has(method)) throw transportError('unsupported_action', 'Unsupported native window method');
    const active = await start();
    if (disposed || active !== child) throw transportError('connection_error', 'Window backend unavailable');
    if (pending.size >= 64) throw transportError('connection_error', 'Too many Window backend requests');
    return new Promise((resolve, reject) => {
      const id = randomUUID(); const timer = setTimeout(() => { failPending(transportError('timeout', 'Window backend timed out')); void dispose(); }, timeoutMs);
      pending.set(id, { resolve, reject, timer, method });
      try { active.stdin.write(JSON.stringify({ id, method, params }) + '\n'); } catch { const p = pending.get(id); pending.delete(id); rejectPending(p, transportError('connection_error', 'Window backend request delivery failed')); }
    });
  }
  async function dispose() {
    if (disposed) return; disposed = true;
    overlayListeners.clear();
    failPending(transportError('cancelled', 'Window backend disposed'));
    if (launching) { try { await launching; } catch {} }
    const owned = identity; if (!owned || child !== owned.handle) return;
    const active = owned.handle;
    await new Promise(resolve => {
      const timer = setTimeout(() => { if (identity === owned && child === active && active.exitCode === null) active.kill(); resolve(); }, shutdownMs);
      active.once('exit', () => { clearTimeout(timer); resolve(); });
      try { active.stdin.end(JSON.stringify({ id: randomUUID(), method: 'shutdown', params: {} }) + '\n'); } catch { /* The exact owned handle alone may be terminated by the timer. */ }
    });
  }
  return {
    request, dispose,
    showOverlay: params => request('overlayShow', params),
    hideOverlay: params => request('overlayHide', params),
    onOverlayStop(listener) {
      overlayListeners.add(listener);
      return { dispose() { overlayListeners.delete(listener); } };
    },
  };
}
module.exports = { createBackend };

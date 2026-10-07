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
    else if (nativeCode === 'window-minimized') { code = 'window_minimized'; message = '선택한 창이 최소화되었습니다.'; }
    else if (['unsupported-action', 'unsupported-key', 'unsupported-method', 'not-resizable', 'disabled-element', 'readonly-element'].includes(nativeCode)) { code = 'unsupported_action'; message = 'The selected window does not support this action'; }
    else if (nativeCode === 'resize-bounds') { code = 'invalid_request'; message = 'Requested window size exceeds app constraints or monitor work area'; }
    else if (['stale-observation', 'stale-target', 'stale-element', 'unknown-element', 'window-closed', 'capture-size-changed'].includes(nativeCode)) { code = 'state_changed'; message = 'The selected window state changed; select or observe it again'; }
    else if (['capture-timeout', 'provider-timeout', 'backend-timeout'].includes(nativeCode)) { code = 'timeout'; message = 'The selected window operation timed out'; }
    else if (['observe', 'inspect'].includes(method) && nativeCode === 'unobservable-target') { code = 'state_changed'; message = 'The selected window cannot currently be observed; observe it again'; }
    else if (['observe', 'inspect'].includes(method) && nativeCode === 'uia-value-limit') { code = 'unsupported_action'; message = 'The selected window accessibility data exceeds supported bounds'; }
    else if (['observe', 'inspect'].includes(method) && nativeCode === 'capture-unsupported') { code = 'unsupported_action'; message = 'Selected-window capture is unavailable on this system'; }
    else if (['observe', 'inspect'].includes(method) && nativeCode === 'protected-target') { code = 'unsupported_action'; message = 'The selected window prevents screen capture'; }
    else if (['observe', 'inspect'].includes(method) && ['capture-device', 'capture-format', 'capture-encode', 'capture-clock', 'capture-size'].includes(nativeCode)) { code = 'state_changed'; message = 'The selected window snapshot could not be captured; observe it again'; }
    else if (nativeCode === 'uncertain-delivery') { code = 'connection_error'; message = 'Window action delivery could not be confirmed'; }
  }
  return windowError(code, message, { stage: 'native', nativeCode,
    ...(method === 'act' && !uncorrelated && ['stale-observation', 'stale-target', 'unknown-element', 'stale-element', 'unsupported-action', 'unsupported-key', 'disabled-element', 'readonly-element'].includes(nativeCode) && payload?.mutationOutcome !== 'unknown' ? { actionExecuted: false } : {}),
    ...(code === 'window_minimized' ? { pauseReason: 'minimized', ...(payload?.mutationOutcome === 'unknown' ? {} : { actionExecuted: false }) } : {}),
    ...(payload?.mutationOutcome === 'unknown' || (MUTATIONS.has(method) && !['unsupported_action', 'state_changed', 'invalid_request', 'window_minimized'].includes(code)) ? { mutationOutcome: 'unknown' } : {}) });
}
function createBackend(runtime, { spawnChild = spawn, verify = verifyRuntime, timeoutMs = 30000, shutdownMs = 3000 } = {}) {
  let child, identity, buffer = '', disposed = false, launching, resetting, retiring;
  const pending = new Map();
  const overlayListeners = new Set();
  const transportError = (code, message, options = {}) => windowError(code, message, { ...options, stage: 'native' });
  const rejectPending = (p, error) => { clearTimeout(p.timer); p.reject(MUTATIONS.has(p.method) ? windowError(error.code, error.message, { ...error, mutationOutcome: 'unknown' }) : error); };
  const failPending = error => { for (const p of pending.values()) rejectPending(p, error); pending.clear(); };
  async function start() {
    if (disposed) throw transportError('cancelled', 'Window backend disposed');
    if (resetting) { const failure = await resetting; if (disposed) throw transportError('cancelled', 'Window backend disposed'); if (failure) throw failure; return start(); }
    if (retiring) throw retiring.error || transportError('connection_error', 'Previous Window backend has not exited');
    if (child) return child;
    if (launching) return launching;
    launching = Promise.resolve().then(() => {
      if (disposed) throw transportError('cancelled', 'Window backend disposed');
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
          if (frameBytes > 32 * 1024 * 1024) { failPending(transportError('connection_error', 'Window backend response too large')); buffer = ''; void reset(); return; }
          buffer += decoder.write(part); if (newline < 0) break;
          const line = buffer.slice(0, -1); buffer = ''; frameBytes = 0;
          let message; try { message = JSON.parse(line); if (!message || typeof message !== 'object') throw new Error(); } catch { failPending(transportError('connection_error', 'Invalid Window backend response')); void reset(); return; }
          if (Object.hasOwn(message, 'event')) {
            const event = message.event;
            if (Object.keys(message).length !== 1 || !event || typeof event !== 'object' || Array.isArray(event) ||
                event.type !== 'overlayStop' || Object.keys(event).some(key => !['type', 'targetId', 'generation'].includes(key)) ||
                typeof event.targetId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(event.targetId) || !Number.isSafeInteger(event.generation) || event.generation < 0) {
              failPending(transportError('connection_error', 'Invalid Window overlay event')); void reset(); return;
            }
            // Events originate only from the exact owned, verified helper. They never settle requests.
            try { for (const listener of overlayListeners) listener({ ...event }); }
            catch { failPending(transportError('connection_error', 'Window overlay stop handling failed')); void reset(); return; }
            continue;
          }
          if (message.id == null && message.error) {
            for (const p of pending.values()) { clearTimeout(p.timer); p.reject(nativeError(message.error, p.method, true)); }
            pending.clear(); void reset(); return;
          }
          const p = pending.get(message.id); if (!p) continue;
          pending.delete(message.id); clearTimeout(p.timer);
          if (message.error) {
            p.reject(nativeError(message.error, p.method));
            if (message.error.code === 'operation-cancelled') { failPending(transportError('cancelled', 'Window control stopped by the user')); void reset(); return; }
          }
          else if (p.method === 'listWindows') {
            const result = message.result;
            if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length !== 1 || !Object.hasOwn(result, 'windows') || !Array.isArray(result.windows)) p.reject(transportError('connection_error', 'Invalid native listWindows result envelope'));
            else p.resolve(result.windows);
          } else p.resolve(message.result);
        }
      });
      const transportFailed = message => { if (child !== spawned) return; failPending(transportError('connection_error', message)); void reset(); };
      spawned.stderr.on('data', () => {}); // Never emit native content or image data into host logs.
      spawned.stdout.on('error', () => transportFailed('Window backend response transport failed'));
      spawned.stderr.on('error', () => transportFailed('Window backend transport failed'));
      spawned.on('error', () => { if (!spawned.pid && child === spawned) identity.notSpawned = true; transportFailed('Window backend connection failed'); });
      spawned.on('close', () => { if (retiring?.handle === spawned && retiring.notSpawned) retiring = undefined; });
      spawned.stdin.on?.('error', () => transportFailed('Window backend request delivery failed'));
      spawned.on('exit', (exitCode, signal) => { if (retiring?.handle === spawned) retiring = undefined; if (child === spawned) { child = undefined; identity = undefined; failPending(transportError('connection_error', 'Window backend exited', { exitCode, signal: signal ?? null })); } });
      return spawned;
    }).catch(error => { throw error?.stage === 'native' ? error : transportError('connection_error', 'Window backend could not start'); }).finally(() => { launching = undefined; });
    return launching;
  }
  async function request(method, params) {
    if (!METHODS.has(method)) throw transportError('unsupported_action', 'Unsupported native window method');
    const active = await start();
    if (disposed) throw transportError('cancelled', 'Window backend disposed');
    if (active !== child) throw transportError('connection_error', 'Window backend unavailable');
    if (pending.size >= 64) throw transportError('connection_error', 'Too many Window backend requests');
    return new Promise((resolve, reject) => {
      const id = randomUUID(); const timer = setTimeout(() => { failPending(transportError('timeout', 'Window backend timed out')); void reset(); }, timeoutMs);
      pending.set(id, { resolve, reject, timer, method });
      try { active.stdin.write(JSON.stringify({ id, method, params }) + '\n'); } catch { failPending(transportError('connection_error', 'Window backend request delivery failed')); void reset(); }
    });
  }
  // Reset detaches the failed helper immediately. All new requests await its
  // shutdown, and late replies/errors from that handle cannot affect the next one.
  function reset() {
    if (resetting) return resetting;
    const owned = identity || retiring;
    child = undefined; identity = undefined; buffer = '';
    if (!owned) return Promise.resolve();
    retiring = owned;
    const active = owned.handle;
    resetting = new Promise(resolve => {
      let timer, deadline, finished = false;
      const finish = failure => {
        if (finished) return; finished = true; clearTimeout(timer); clearTimeout(deadline);
        active.removeListener('exit', exited); active.removeListener('close', closed);
        if (failure) owned.error = failure; else if (retiring === owned) retiring = undefined;
        resolve(failure);
      };
      const exited = () => finish();
      const closed = () => { if (owned.notSpawned) finish(); };
      if (active.exitCode !== null && active.exitCode !== undefined) { finish(); return; }
      active.once('exit', exited); active.on('close', closed);
      // Report a bounded failure without releasing ownership. A late exit/failed
      // spawn close releases the retired handle and permits a future retry.
      timer = setTimeout(() => {
        if (!owned.notSpawned) { try { active.kill(); } catch { finish(transportError('connection_error', 'Previous Window backend could not be stopped')); return; } }
        if (finished) return;
        if (active.exitCode !== null && active.exitCode !== undefined) { finish(); return; }
        deadline = setTimeout(() => finish(transportError('connection_error', 'Previous Window backend did not exit')), shutdownMs);
      }, shutdownMs);
      try { active.stdin.end(JSON.stringify({ id: randomUUID(), method: 'shutdown', params: {} }) + '\n'); } catch { /* Only this exact owned handle may be terminated. */ }
    }).finally(() => { resetting = undefined; });
    return resetting;
  }
  async function dispose() {
    disposed = true;
    overlayListeners.clear();
    failPending(transportError('cancelled', 'Window backend disposed'));
    if (launching) { try { await launching; } catch {} }
    await reset();
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

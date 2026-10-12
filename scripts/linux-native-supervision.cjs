'use strict';
// Own only this host's app-server. Never replay RPCs or delivered mutations.
const { EventEmitter } = require('node:events');
const events = new EventEmitter(), states = new WeakMap(), active = new Set();
function state(host) {
  let value = states.get(host);
  if (!value) { value = { disposed: false, timer: undefined, delay: 1000, restarts: 0 }; states.set(host, value); active.add(host); }
  return value;
}
function schedule(host) {
  const s = state(host);
  if (s.disposed || s.timer) return;
  s.timer = setTimeout(() => {
    s.timer = undefined;
    if (s.disposed || host.proc) return;
    let result;
    try { result = host.startCodexProcess(); } catch { result = { success: false }; }
    if (!result?.success) { clearTimeout(s.timer); s.timer = undefined; s.delay = Math.min(300000, s.delay * 2); schedule(host); }
    else s.restarts++;
  }, s.delay);
  s.timer.unref?.();
}
function watch(host, child) {
  const s = state(host);
  const restarting = s.restarts > 0 || s.started;
  s.started = true;
  let announced = false;
  const initialized = () => {
    if (host.proc !== child || !host.initialized || announced) return;
    announced = true; s.delay = 1000;
    if (restarting) events.emit('restart', host);
  };
  // Initialized is checked after the host's stdout reader handles each chunk.
  child.stdout.on('data', () => setImmediate(initialized));
  return child;
}
function exited(host) { schedule(host); }
function dispose(host) { const s = state(host); s.disposed = true; clearTimeout(s.timer); s.timer = undefined; active.delete(host); }
function onRestart(listener) { events.on('restart', listener); return { dispose: () => events.off('restart', listener) }; }
function snapshot() { return [...active].map(host => ({ pid: host.proc?.pid, initialized: host.initialized, restarts: state(host).restarts })); }
function recoverUi(provider) { provider.fatalError = null; provider.mostRecentErrorLog = null; }
module.exports = { recoverUi, watch, exited, dispose, onRestart, snapshot };

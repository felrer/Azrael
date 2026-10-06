'use strict';
// Advisory only: these records never grant window authority or serialize input.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const STATES = ['selected', 'ready', 'paused', 'running'];
const text = (v, max = 256) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f]/.test(v);
const identity = w => w && text(w.hwnd) && Number.isSafeInteger(w.pid) && w.pid > 0 && text(w.processCreated) && text(w.executable, 32768);
const same = (a, b) => ['hwnd', 'pid', 'processCreated', 'executable'].every(k => a[k] === b[k]);
function publicOccupancy(value) {
  if (!value || !['available', 'occupied', 'unknown'].includes(value.status) || !Array.isArray(value.sessions) || value.sessions.length > 256) throw new Error('Invalid occupancy');
  const sessions = value.sessions.map(s => {
    if (!s || !text(s.sessionId) || !text(s.workspaceName) || /[\\/]/.test(s.workspaceName) || !STATES.includes(s.state) || typeof s.isCurrentSession !== 'boolean' || !Number.isSafeInteger(s.updatedAt) || s.updatedAt < 0) throw new Error('Invalid occupancy session');
    return Object.fromEntries(['sessionId', 'workspaceName', 'state', 'isCurrentSession', 'updatedAt'].map(k => [k, s[k]]));
  });
  if (value.status !== 'unknown' && value.status !== (sessions.some(s => !s.isCurrentSession) ? 'occupied' : 'available')) throw new Error('Invalid occupancy status');
  return { status: value.status, sessions };
}
const commonDirectory = () => path.join(os.homedir(), '.azrael-ex', 'window-use', 'occupancy');
function createRegistry({ directory, entries, now = Date.now, ttlMs = 30000, heartbeatMs = 5000, alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } } }) {
  const hostId = randomUUID(), filename = path.join(directory, hostId + '.json');
  let disposed = false, failed = false;
  function publish() {
    if (disposed) return;
    const temp = filename + '.' + randomUUID() + '.tmp';
    try {
      const sessions = entries();
      if (sessions.length > 256) throw new Error('Occupancy session limit');
      fs.mkdirSync(directory, { recursive: true });
      if (!sessions.length) { try { fs.unlinkSync(filename); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
      else {
        fs.writeFileSync(temp, JSON.stringify({ schema: 1, hostId, pid: process.pid, updatedAt: now(), sessions }), { flag: 'wx', mode: 0o600 });
        fs.renameSync(temp, filename);
      }
      failed = false;
    } catch { failed = true; }
    finally { try { fs.unlinkSync(temp); } catch {} }
  }
  function read(window, currentSession) {
    const sessions = []; let unknown = failed;
    try {
      const files = [], listing = fs.opendirSync(directory);
      try {
        let entry, scanned = 0;
        while ((entry = listing.readSync())) {
          if (++scanned > 1024) throw new Error('Occupancy directory limit');
          if (/^[a-f0-9-]{36}\.json$/.test(entry.name)) files.push(entry.name);
          if (files.length > 256) throw new Error('Occupancy record limit');
        }
      } finally { listing.closeSync(); }
      for (const file of files) {
        let fd;
        try {
          fd = fs.openSync(path.join(directory, file), 'r');
          if (!fs.fstatSync(fd).isFile()) throw new Error('Invalid record');
          const buffer = Buffer.alloc(262145), count = fs.readSync(fd, buffer, 0, buffer.length, 0);
          if (count > 262144) throw new Error('Record limit');
          const r = JSON.parse(buffer.subarray(0, count).toString('utf8'));
          if (r.schema !== 1 || r.hostId + '.json' !== file || !Number.isSafeInteger(r.pid) || r.pid <= 0 || !Number.isSafeInteger(r.updatedAt) || r.updatedAt < 0 || r.updatedAt > now() + 5000 || !Array.isArray(r.sessions) || r.sessions.length > 256) throw new Error('Invalid record');
          if (now() - r.updatedAt > ttlMs || !alive(r.pid)) continue;
          for (const s of r.sessions) {
            if (!identity(s.window)) throw new Error('Invalid identity');
            const projected = publicOccupancy({ status: 'unknown', sessions: [{ ...s, isCurrentSession: r.hostId === hostId && s.sessionId === currentSession, updatedAt: r.updatedAt }] }).sessions[0];
            if (same(window, s.window)) { if (sessions.length >= 256) throw new Error('Occupancy session limit'); sessions.push(projected); }
          }
        } catch (e) { if (e.code !== 'ENOENT') unknown = true; }
        finally { if (fd !== undefined) fs.closeSync(fd); }
      }
    } catch { unknown = true; }
    return { status: unknown ? 'unknown' : sessions.some(s => !s.isCurrentSession) ? 'occupied' : 'available', sessions };
  }
  publish();
  const timer = setInterval(publish, heartbeatMs); timer.unref();
  return { publish, read, dispose() { if (disposed) return; disposed = true; clearInterval(timer); try { fs.unlinkSync(filename); } catch {} } };
}
module.exports = { createRegistry, publicOccupancy, commonDirectory };

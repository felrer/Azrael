'use strict';
// Product-owned disposable resources only. This does not adopt project artifacts.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const clone = value => JSON.parse(JSON.stringify(value));
const key = value => process.platform === 'win32' ? value.toLowerCase() : value;
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value);
function requireText(value, label) { if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw new Error(`Invalid ${label}`); return value; }
function identityEqual(a, b) {
  const canonical = value => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).sort().map(k => [k, canonical(value[k])]) : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
async function statOrNull(file) { try { return await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function safeParents(file) {
  const resolved = path.resolve(file), parsed = path.parse(resolved);
  let current = parsed.root;
  for (const part of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await statOrNull(current);
    if (!info) continue;
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe directory: ${current}`);
  }
}
function fingerprint(stat) { return { dev: stat.dev, ino: stat.ino, type: stat.isDirectory() ? 'directory' : 'file', size: stat.isFile() ? stat.size : 0, mtimeMs: stat.isFile() ? stat.mtimeMs : 0 }; }
async function tree(root) {
  await safeParents(path.dirname(root));
  const entries = [];
  async function visit(file, relative) {
    const stat = await statOrNull(file);
    if (!stat) return;
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || (stat.isFile() && stat.nlink !== 1)) throw new Error(`Unsafe payload entry: ${file}`);
    entries.push({ relative, ...fingerprint(stat) });
    if (stat.isDirectory()) for (const name of (await fs.readdir(file)).sort()) await visit(path.join(file, name), relative ? path.join(relative, name) : name);
  }
  await visit(root, '');
  return entries;
}
function sameTree(expected, actual, partial = false) {
  const known = new Map(expected.map(entry => [entry.relative, entry]));
  return (partial || actual.length === expected.length) && actual.every(entry => identityEqual(known.get(entry.relative), entry));
}

function createResourceManager(options = {}) {
  if (!path.isAbsolute(options.directory || '')) throw new Error('An absolute dedicated resource directory is required');
  const directory = path.resolve(options.directory);
  if ([os.homedir(), path.parse(directory).root, process.env.USERPROFILE].filter(Boolean).some(p => key(path.resolve(p)) === key(directory))) throw new Error('Resource directory cannot be a user profile or filesystem root');
  const now = options.now || Date.now;
  const idleMs = options.idleMs ?? 15 * 60 * 1000, maxBytes = options.maxBytes ?? 256 * 1024 * 1024;
  const maxRecords = options.maxRecords ?? 512, historyLimit = options.historyLimit ?? 64;
  if (![idleMs, maxBytes, maxRecords, historyLimit].every(n => Number.isSafeInteger(n) && n >= 0) || !maxRecords) throw new Error('Invalid resource limits');
  const metadata = path.join(directory, 'management'), payload = path.join(directory, 'payload');
  const manifestFile = path.join(metadata, 'resources.json'), lock = path.join(metadata, 'admission.lock');
  const processIdentity = Object.freeze({ pid: process.pid, started: options.processStarted || `${Date.now()}-${crypto.randomUUID()}`, nonce: crypto.randomUUID() });
  let queue = Promise.resolve(), timer, scheduledRun = false;
  async function initialize() {
    await safeParents(directory);
    const existing = await statOrNull(directory);
    if (!existing) await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await safeParents(metadata);
    // Never absorb an arbitrary pre-existing directory into managed ownership.
    if (!(await statOrNull(metadata))) {
      if ((await fs.readdir(directory)).length) throw new Error('Resource directory is not an empty dedicated directory');
      await fs.mkdir(metadata, { mode: 0o700 });
      await fs.writeFile(path.join(metadata, 'owner.json'), JSON.stringify({ schema: 1, owner: 'azrael-window-use-resources' }), { flag: 'wx', mode: 0o600 });
    }
    const marker = path.join(metadata, 'owner.json'), markerStat = await fs.lstat(marker);
    if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.nlink !== 1 || markerStat.size > 256 || (JSON.parse(await fs.readFile(marker, 'utf8'))).owner !== 'azrael-window-use-resources') throw new Error('Unverified resource directory ownership');
    await safeParents(payload);
    await fs.mkdir(payload, { recursive: true, mode: 0o700 });
  }
  async function read() {
    const stat = await statOrNull(manifestFile);
    if (!stat) return { schema: 1, records: [], history: [] };
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 8 * 1024 * 1024) throw new Error('Unsafe resource metadata');
    const data = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    if (data.schema !== 1 || !Array.isArray(data.records) || !Array.isArray(data.history) || data.records.length > maxRecords) throw new Error('Invalid resource metadata');
    const ids = new Set();
    for (const record of data.records) {
      if (!validId(record.id) || ids.has(record.id) || !['generated', 'session'].includes(record.kind) || !Array.isArray(record.leases) || !Array.isArray(record.consumers) || !Array.isArray(record.sessionIds) || !Array.isArray(record.entries)) throw new Error('Invalid resource record');
      ids.add(record.id);
      if (record.kind === 'session' && (!record.identity || !Object.keys(record.identity).length)) throw new Error('Missing session identity');
      for (const entry of record.entries) if (typeof entry.relative !== 'string' || path.isAbsolute(entry.relative) || entry.relative.split(/[\\/]/).includes('..')) throw new Error('Unsafe stored payload path');
    }
    return data;
  }
  async function save(data) {
    data.history = historyLimit ? data.history.slice(-historyLimit) : [];
    const temporary = path.join(metadata, 'resources.next');
    if (await statOrNull(temporary)) throw new Error('Interrupted metadata write requires inspection');
    const bytes = JSON.stringify(data);
    if (Buffer.byteLength(bytes) > 8 * 1024 * 1024) throw new Error('Resource metadata capacity exceeded');
    await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, manifestFile);
  }
  async function locked(operation) {
    const pending = queue.then(async () => {
      await initialize();
      const deadline = Date.now() + (options.lockTimeoutMs ?? 1000);
      while (true) {
        await safeParents(metadata);
        try { await fs.mkdir(lock, { mode: 0o700 }); break; }
        catch (error) { if (error.code !== 'EEXIST') throw error; if (Date.now() >= deadline) throw new Error('Resource admission lock is busy or requires verified owner recovery'); await delay(10); }
      }
      try {
        await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify(processIdentity), { flag: 'wx', mode: 0o600 });
        return await operation(await read());
      } finally {
        await fs.unlink(path.join(lock, 'owner.json'));
        await fs.rmdir(lock);
      }
    });
    queue = pending.catch(() => {});
    return pending;
  }
  function find(data, id) { const result = data.records.find(r => r.id === id); if (!result) throw new Error('Unknown resource'); return result; }
  const resourcePath = record => path.join(payload, record.id);
  function blocked(record) {
    if (record.protected) return 'protected';
    if (record.leases.length) return 'active leases';
    if (record.consumers.length) return 'active consumers';
    if (!['ready', 'deleting', 'closed'].includes(record.state)) return `state ${record.state}`;
    return null;
  }
  async function usage(data) {
    let bytes = 0, reservedBytes = 0; const resources = [];
    for (const record of data.records) {
      let actualBytes = 0, error;
      if (record.kind === 'generated') try { actualBytes = (await tree(resourcePath(record))).reduce((n, entry) => n + entry.size, 0); } catch (e) { error = e.message; }
      bytes += actualBytes; reservedBytes += Math.max(actualBytes, record.reserveBytes || 0);
      resources.push({ ...clone(record), path: record.kind === 'generated' ? resourcePath(record) : undefined, bytes: actualBytes, usageError: error, blocked: error || blocked(record) });
    }
    const knownPaths = new Set(data.records.filter(r => r.kind === 'generated').map(r => r.id));
    const unregisteredPaths = (await fs.readdir(payload)).filter(name => !knownPaths.has(name)).map(name => path.join(payload, name));
    const pendingMetadataWrite = !!(await statOrNull(path.join(metadata, 'resources.next')));
    const capacityUnknown = pendingMetadataWrite || unregisteredPaths.length > 0 || resources.some(r => r.usageError);
    return { bytes, reservedBytes, maxBytes, overLimit: reservedBytes > maxBytes, capacityUnknown, pendingMetadataWrite, availableBytes: capacityUnknown ? 0 : Math.max(0, maxBytes - reservedBytes), unregisteredPaths, resources };
  }
  async function register(kind, input) {
    return locked(async data => {
      for (const name of ['workId', 'runId']) requireText(input[name], name);
      if (!validId(input.id) || data.records.some(r => r.id === input.id)) throw new Error('Invalid or duplicate resource id');
      if (data.records.length >= maxRecords) throw new Error('Resource record capacity exceeded');
      const reserveBytes = input.reserveBytes ?? 0;
      if (!Number.isSafeInteger(reserveBytes) || reserveBytes < 0) throw new Error('Invalid byte reservation');
      const currentUsage = await usage(data);
      if (currentUsage.capacityUnknown || currentUsage.reservedBytes + reserveBytes > maxBytes) throw new Error('Resource byte capacity exceeded or unknown; protected resources cannot be evicted');
      const lease = crypto.randomUUID(), timestamp = now();
      const record = { id: input.id, kind, workId: input.workId, runId: input.runId, producer: input.producer || 'owned-session', state: 'pending', createdAt: timestamp, idleSince: timestamp, protected: false, consumers: [], leases: [{ token: lease, consumer: input.producer || 'producer' }], sessionIds: [], entries: [], reserveBytes };
      if (kind === 'generated') {
        requireText(input.producer, 'producer');
        if (await statOrNull(resourcePath(record))) throw new Error('Payload path already exists');
        record.sessionIds = input.sessionIds || [];
        if (!Array.isArray(record.sessionIds) || record.sessionIds.some(id => find(data, id).kind !== 'session')) throw new Error('Invalid session reference');
      } else {
        if (!input.identity || typeof input.identity !== 'object' || Array.isArray(input.identity) || !Object.keys(input.identity).length || Buffer.byteLength(JSON.stringify(input.identity)) > 8192) throw new Error('Verified session identity is required');
        if (input.ownershipVerified !== true) throw new Error('Session ownership must be verified before registration');
        record.identity = clone(input.identity);
      }
      data.records.push(record); await save(data);
      return { id: record.id, lease, ...(kind === 'generated' ? { path: resourcePath(record), reserveBytes } : {}) };
    });
  }
  async function observedSession(record) {
    if (typeof options.inspectSession !== 'function') throw new Error('Session observation is unavailable');
    const observation = await options.inspectSession(clone(record.identity));
    if (!observation || !identityEqual(observation.identity, record.identity) || observation.ownershipVerified !== true || !['running', 'closed'].includes(observation.state)) throw new Error('Exact session ownership/state is unverified');
    for (const flag of ['pendingWork', 'directUser', 'unsavedWork', 'unknownState', 'unrelatedApps', 'pendingUserDecision', 'heldInput']) if (observation[flag] !== false) throw new Error(`Session ${flag} is not confirmed clear`);
    if (observation.state === 'closed' && (observation.processesStopped !== true || observation.logoffConfirmed !== true)) throw new Error('Session logoff/process termination is unconfirmed');
    return observation;
  }
  async function cleanup(input = {}) {
    return locked(async data => {
      // Reconcile an interrupted close only from positive exact closure evidence.
      for (const record of data.records.filter(r => r.kind === 'session' && r.state === 'closing')) {
        try { if ((await observedSession(record)).state === 'closed') { record.state = 'closed'; await save(data); } } catch { /* Remains protected and visible as closing. */ }
      }
      const before = await usage(data), results = [];
      if (input.ids && (!Array.isArray(input.ids) || input.ids.some(id => !data.records.some(r => r.id === id)))) throw new Error('Unknown cleanup resource');
      const selected = new Set(input.ids || data.records.filter(r => now() - r.idleSince >= idleMs || before.overLimit).map(r => r.id));
      // Disk groups and their sessions are inseparable for protection checks.
      for (const record of data.records) if (record.kind === 'generated' && (selected.has(record.id) || record.sessionIds.some(id => selected.has(id)))) { selected.add(record.id); for (const id of record.sessionIds) selected.add(id); }
      const remaining = new Set(selected);
      while (remaining.size) {
        const component = new Set([remaining.values().next().value]);
        let changed;
        do { changed = false; for (const r of data.records) if (r.kind === 'generated' && (component.has(r.id) || r.sessionIds.some(id => component.has(id)))) for (const id of [r.id, ...r.sessionIds]) if (!component.has(id)) { component.add(id); changed = true; } } while (changed);
        for (const id of component) remaining.delete(id);
        const records = [...component].map(id => find(data, id));
        let reason = records.map(r => blocked(r)).find(Boolean);
        if (!reason) for (const r of records.filter(r => r.kind === 'generated')) {
          try { if (!sameTree(r.entries, await tree(resourcePath(r)), r.state === 'deleting')) reason = 'Payload identity or membership changed'; } catch (e) { reason = e.message; }
          if (reason) break;
        }
        if (!reason) for (const r of records.filter(r => r.kind === 'session')) {
          try { await observedSession(r); } catch (error) { reason = error.message; break; }
        }
        if (reason) { results.push({ ids: [...component], state: 'deferred', reason }); continue; }
        let freedBytes = 0;
        try {
          for (const r of records.filter(r => r.kind === 'session')) {
            const observed = await observedSession(r);
            if (observed.state !== 'closed') {
              if (typeof options.closeSession !== 'function') throw new Error('Normal session closure is unavailable');
              r.state = 'closing'; await save(data);
              await options.closeSession(clone(r.identity));
              if ((await observedSession(r)).state !== 'closed') throw new Error('Normal session closure was not confirmed');
            }
            r.state = 'closed'; await save(data);
          }
          for (const r of records.filter(r => r.kind === 'generated')) {
            const target = resourcePath(r), actual = await tree(target);
            if (!sameTree(r.entries, actual, r.state === 'deleting')) throw new Error('Payload changed before deletion');
            r.state = 'deleting'; await save(data);
            for (const entry of actual.slice().sort((a, b) => b.relative.split(path.sep).length - a.relative.split(path.sep).length || b.relative.length - a.relative.length)) {
              const file = path.join(target, entry.relative);
              await safeParents(path.dirname(file));
              const stat = await fs.lstat(file);
              if (stat.isSymbolicLink() || !identityEqual(fingerprint(stat), entryWithoutPath(entry)) || (stat.isFile() && stat.nlink !== 1)) throw new Error('Payload changed during deletion');
              if (stat.isDirectory()) await fs.rmdir(file); else { await (options.unlink || fs.unlink)(file); freedBytes += stat.size; }
            }
            if (await statOrNull(target)) throw new Error('Payload remains after deletion');
          }
          const previousRecords = data.records;
          data.records = data.records.filter(r => !component.has(r.id));
          const result = { ids: [...component], state: 'deleted', freedBytes, at: now(), reason: input.reason || 'managed disposable resource policy' };
          data.history.push(result);
          try { await save(data); } catch (error) { data.records = previousRecords; data.history.pop(); throw error; }
          results.push(result);
        } catch (error) {
          // A closing session remains uncertain until exact closure is reconciled.
          const result = { ids: [...component], state: 'failed', freedBytes, reason: error.message, remainingPaths: [] };
          for (const r of records.filter(r => r.kind === 'generated')) if (await statOrNull(resourcePath(r))) result.remainingPaths.push(resourcePath(r));
          data.history.push({ ...result, at: now() });
          try { await save(data); } catch (metadataError) { result.metadataError = metadataError.message; }
          results.push(result);
        }
      }
      return { results, freedBytes: results.reduce((n, r) => n + (r.freedBytes || 0), 0), ...(await usage(data)) };
    });
  }
  function entryWithoutPath(entry) { const { relative, ...rest } = entry; return rest; }
  return {
    directory, registerGenerated: input => register('generated', input), registerSession: input => register('session', input),
    inspect: () => locked(usage), cleanup,
    acquireLease: (id, consumer) => locked(async data => { requireText(consumer, 'consumer'); const r = find(data, id); if (!['ready', 'pending'].includes(r.state)) throw new Error('Resource cannot be admitted in its current state'); const token = crypto.randomUUID(); r.leases.push({ token, consumer }); await save(data); return token; }),
    releaseLease: (id, token, input = {}) => locked(async data => {
      const r = find(data, id), index = r.leases.findIndex(lease => lease.token === token);
      if (index < 0) throw new Error('Unknown resource lease');
      const state = input.state || 'ready'; if (!['ready', 'unknown', 'protected'].includes(state)) throw new Error('Invalid release state');
      if (r.kind === 'generated' && state === 'ready') r.entries = await tree(resourcePath(r));
      r.leases.splice(index, 1); r.state = state; if (!r.leases.length) r.idleSince = now(); await save(data);
    }),
    setProtection: (id, input) => locked(async data => { const r = find(data, id); if (typeof input.protected !== 'boolean' || !Array.isArray(input.consumers) || input.consumers.some(v => typeof v !== 'string' || !v || v.length > 2048)) throw new Error('Explicit protection and consumers required'); r.protected = input.protected; r.consumers = [...new Set(input.consumers)]; await save(data); }),
    reconcileSession: id => locked(async data => { const r = find(data, id); if (r.kind !== 'session') throw new Error('Not a session'); const observed = await observedSession(r); if (observed.state !== 'closed') throw new Error('Session closure is still unconfirmed'); r.state = 'closed'; await save(data); return { id, state: 'closed' }; }),
    // Only an exact external process-identity observer can release an abandoned lock.
    recoverLock: async verifyOwnerStopped => {
      await initialize(); await safeParents(lock);
      const recoveryFile = path.join(lock, 'recovery.lock');
      await fs.writeFile(recoveryFile, JSON.stringify(processIdentity), { flag: 'wx', mode: 0o600 });
      try {
      const ownerFile = path.join(lock, 'owner.json'), ownerStat = await fs.lstat(ownerFile);
      if (!ownerStat.isFile() || ownerStat.isSymbolicLink() || ownerStat.nlink !== 1) throw new Error('Unknown lock owner');
      const bytes = await fs.readFile(ownerFile, 'utf8'), owner = JSON.parse(bytes);
      if (!owner.pid || !owner.started || !owner.nonce || typeof verifyOwnerStopped !== 'function') throw new Error('Exact lock owner verification required');
      const observed = await verifyOwnerStopped(clone(owner));
      if (!observed || observed.state !== 'stopped' || observed.exactIdentityVerified !== true || !identityEqual(observed.identity, owner)) throw new Error('Exact lock owner stop is unverified');
      if (await fs.readFile(ownerFile, 'utf8') !== bytes) throw new Error('Lock owner changed');
      await fs.unlink(ownerFile); await fs.unlink(recoveryFile); await fs.rmdir(lock); return { recovered: true, owner };
      } catch (error) { await fs.unlink(recoveryFile); throw error; }
    },
    startScheduler: ({ intervalMs = 60000, onResult = () => {} } = {}) => {
      if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) throw new Error('Invalid cleanup interval');
      if (timer) return;
      const tick = () => {
        if (scheduledRun) return;
        scheduledRun = true;
        cleanup().then(onResult, error => onResult({ state: 'failed', reason: error.message })).catch(() => {}).finally(() => { scheduledRun = false; });
      };
      timer = setInterval(tick, intervalMs); timer.unref?.(); tick();
    },
    stopScheduler: () => { clearInterval(timer); timer = undefined; return queue; },
  };
}
module.exports = { createResourceManager };

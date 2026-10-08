'use strict';

// Optional evidence storage. A lease covers a check across every schema version;
// readers copy evidence into their own run before releasing that lease.
const fs = require('node:fs').promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const CACHE_SCHEMA = 1;
const MAX_LOG_BYTES = 32 * 1024 * 1024;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const safeId = value => typeof value === 'string' && /^[a-z][a-z0-9.-]{0,127}$/.test(value);
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const inside = (root, target) => { const r = path.relative(root, target); return r === '' || (!r.startsWith(`..${path.sep}`) && r !== '..' && !path.isAbsolute(r)); };
const message = error => `${error.code || 'CACHE_ERROR'}: ${error.message}`;

async function inspect(filename, kind, missing = false) {
  let stat;
  try { stat = await fs.lstat(filename); } catch (error) { if (missing && error.code === 'ENOENT') return null; throw error; }
  if (stat.isSymbolicLink() || (kind === 'directory' ? !stat.isDirectory() : !stat.isFile())) throw Error(`Unsafe cache ${kind}: ${filename}`);
  if (path.resolve(await fs.realpath(filename)).toLowerCase() !== path.resolve(filename).toLowerCase()) throw Error(`Redirected cache path: ${filename}`);
  return stat;
}

async function directory(filename, create = false) {
  const absolute = path.resolve(filename), parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!await inspect(current, 'directory', true)) {
      if (!create) throw Error(`Missing directory: ${current}`);
      try { await fs.mkdir(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      await inspect(current, 'directory');
    }
  }
}

async function safeTree(root, target) {
  if (!inside(root, target) || target === root) throw Error(`Unsafe removal target: ${target}`);
  await directory(path.dirname(target));
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) throw Error(`Refusing linked cache entry: ${target}`);
  await inspect(target, stat.isDirectory() ? 'directory' : 'file');
  if (stat.isDirectory()) for (const name of await fs.readdir(target)) await safeTree(root, path.join(target, name));
}
async function remove(root, target) {
  // Preflight the entire tree before deleting any part; uncertain trees remain.
  await safeTree(root, target);
  async function erase(filename) {
    const stat = await fs.lstat(filename);
    if (stat.isDirectory()) { for (const name of await fs.readdir(filename)) await erase(path.join(filename, name)); await fs.rmdir(filename); }
    else await fs.unlink(filename);
  }
  await erase(target);
}

function configuration(options) {
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '..'));
  const allowed = path.join(projectRoot, 'artifacts', 'cache', 'verification-results');
  const cacheRoot = path.resolve(options.cacheRoot || allowed);
  if (!inside(allowed, cacheRoot)) throw Error('Verification result cache must be inside project artifacts/cache/verification-results');
  return { cacheRoot, projectRoot };
}
async function acquire(root, filename, waitMs = 0) {
  await directory(path.dirname(filename), true);
  const deadline = Date.now() + waitMs;
  for (;;) {
    try { await fs.mkdir(filename); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) return null;
      await delay(Math.min(10, deadline - Date.now()));
    }
  }
  const token = crypto.randomUUID();
  try { await fs.writeFile(path.join(filename, 'owner.json'), JSON.stringify({ token, pid: process.pid }), { flag: 'wx' }); }
  catch (error) { await fs.rmdir(filename).catch(() => {}); throw error; }
  return async () => {
    await directory(filename);
    await inspect(path.join(filename, 'owner.json'), 'file');
    const owner = JSON.parse(await fs.readFile(path.join(filename, 'owner.json'), 'utf8'));
    if (owner.token !== token) throw Error(`Lease ownership changed: ${filename}`);
    await remove(root, filename);
  };
}
async function obsolete(root, deferred) {
  const leases = path.join(root, '.leases');
  await directory(leases, true);
  if ((await fs.readdir(leases)).length) { deferred.push('obsolete versions: active or abandoned check leases'); return; }
  for (const name of await fs.readdir(root)) if (/^v[0-9]+$/.test(name) && name !== `v${CACHE_SCHEMA}`) {
    try { await remove(root, path.join(root, name)); } catch (error) { deferred.push(`obsolete ${name}: ${message(error)}`); }
  }
}
async function pruneObsoleteVersions(options = {}) {
  const { cacheRoot } = configuration(options), deferred = [];
  let release;
  try {
    await directory(cacheRoot, true);
    release = await acquire(cacheRoot, path.join(cacheRoot, '.lifecycle'), 2000);
    if (!release) return { deferred: ['obsolete versions: lifecycle lease busy'] };
    await obsolete(cacheRoot, deferred);
  } catch (error) { deferred.push(message(error)); }
  finally { if (release) await release().catch(error => deferred.push(message(error))); }
  return { deferred };
}

async function pruneRemovedChecks(options) {
  const { cacheRoot } = configuration(options), deferred = [], removed = [];
  if (!Array.isArray(options.checkIds) || options.checkIds.some(id => !safeId(id))) throw Error('Invalid active verification check IDs');
  const active = new Set(options.checkIds.map(sha));
  let release;
  try {
    await directory(cacheRoot, true);
    release = await acquire(cacheRoot, path.join(cacheRoot, '.lifecycle'), 2000);
    if (!release) return { removed, deferred: ['removed checks: lifecycle lease busy'] };
    const version = path.join(cacheRoot, `v${CACHE_SCHEMA}`);
    await directory(path.join(cacheRoot, '.leases'), true);
    if (await inspect(version, 'directory', true)) for (const name of await fs.readdir(version)) {
      if (active.has(name)) continue;
      if (!isHash(name)) { deferred.push(`unrecognized check slot retained: ${name}`); continue; }
      if (await fs.lstat(path.join(cacheRoot, '.leases', name)).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) { deferred.push(`removed check ${name}: active or abandoned lease`); continue; }
      try { await remove(cacheRoot, path.join(version, name)); removed.push(name); } catch (error) { deferred.push(`removed check ${name}: ${message(error)}`); }
    }
  } catch (error) { deferred.push(message(error)); }
  finally { if (release) await release().catch(error => deferred.push(message(error))); }
  return { removed, deferred };
}

async function pruneKeys(root, slot, key, deferred) {
  await directory(slot);
  for (const name of await fs.readdir(slot)) if (name !== key) {
    if (!isHash(name) && !/^\.tmp-[a-f0-9-]{36}$/.test(name)) { deferred.push(`unrecognized slot entry retained: ${name}`); continue; }
    try { await remove(root, path.join(slot, name)); } catch (error) { deferred.push(`prune ${name}: ${message(error)}`); }
  }
}

async function log(filename) {
  await directory(path.dirname(filename));
  const stat = await inspect(filename, 'file');
  if (stat.size > MAX_LOG_BYTES) throw Error(`Cache log exceeds ${MAX_LOG_BYTES} bytes: ${filename}`);
  const bytes = await fs.readFile(filename);
  if (bytes.length > MAX_LOG_BYTES) throw Error(`Cache log exceeds ${MAX_LOG_BYTES} bytes: ${filename}`);
  return bytes;
}
async function readEntry(entry, checkId, key) {
  await directory(entry);
  const receiptPath = path.join(entry, 'receipt.json');
  const stat = await inspect(receiptPath, 'file');
  if (stat.size > 4096) throw Error('Oversized cache receipt');
  const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  const fields = ['schema', 'checkId', 'key', 'exitCode', 'signal', 'error', 'logSha256', 'errorSha256'];
  if (Object.keys(receipt).sort().join() !== fields.sort().join() || receipt.schema !== CACHE_SCHEMA || receipt.checkId !== checkId || receipt.key !== key || receipt.exitCode !== 0 || receipt.signal !== null || receipt.error !== null || !isHash(receipt.logSha256) || !isHash(receipt.errorSha256)) throw Error('Invalid cache receipt');
  const [stdout, stderr] = await Promise.all([log(path.join(entry, 'stdout.log')), log(path.join(entry, 'stderr.log'))]);
  if (sha(stdout) !== receipt.logSha256 || sha(stderr) !== receipt.errorSha256) throw Error('Cache evidence hash mismatch');
  return { receipt, stdout, stderr };
}

async function begin(options) {
  const { cacheRoot } = configuration(options);
  const { checkId, key } = options, logName = options.logName || checkId;
  if (!safeId(checkId) || !safeId(logName) || !isHash(key)) throw Error('Invalid verification cache check ID, log name or key');
  if (options.force !== undefined && typeof options.force !== 'boolean') throw Error('Verification cache force must be boolean');
  if (typeof options.runDirectory !== 'string' || !options.runDirectory) throw Error('Verification cache requires runDirectory');
  const runDirectory = path.resolve(options.runDirectory), deferred = [];
  if (inside(cacheRoot, runDirectory)) throw Error('Run evidence must be outside the verification result cache');
  const slot = path.join(cacheRoot, `v${CACHE_SCHEMA}`, sha(checkId)), entry = path.join(slot, key);
  let releaseCheck, releaseLifecycle, closed = false, publishing = false;
  const handle = { hit: null, reason: null, deferred, publish: async () => ({ published: false, reason: handle.reason || 'cache unavailable' }), close: async () => {
    if (closed) return;
    if (publishing) throw Error('Cannot close cache while publishing');
    closed = true;
    if (releaseCheck) {
      await releaseCheck().catch(error => deferred.push(`lease release: ${message(error)}`));
      // The final active check releases deferred obsolete schema storage. The
      // lifecycle lock also prevents a new begin racing the idle-root check.
      if (!releaseLifecycle) {
        const cleanup = await pruneObsoleteVersions(options);
        deferred.push(...cleanup.deferred);
      }
    }
  } };
  try {
    await directory(cacheRoot, true);
    releaseLifecycle = await acquire(cacheRoot, path.join(cacheRoot, '.lifecycle'), 2000);
    if (!releaseLifecycle) { handle.reason = 'busy: lifecycle lease'; return handle; }
    await obsolete(cacheRoot, deferred);
    releaseCheck = await acquire(cacheRoot, path.join(cacheRoot, '.leases', sha(checkId)));
    if (!releaseCheck) { handle.reason = 'busy: check lease'; return handle; }
    await directory(slot, true);
    await pruneKeys(cacheRoot, slot, key, deferred);
    // A forced probe must revoke the old pass before executing, so a later
    // failure cannot leave that same input key eligible for reuse.
    if (options.force && await inspect(entry, 'directory', true)) await remove(cacheRoot, entry);
  } catch (error) { handle.reason = message(error); await handle.close(); return handle; }
  finally {
    if (releaseLifecycle) await releaseLifecycle().catch(error => deferred.push(`lifecycle release: ${message(error)}`));
    releaseLifecycle = null;
  }
  try {
    if (options.force) throw Error('forced execution');
    const cached = await readEntry(entry, checkId, key);
    await directory(runDirectory, true);
    const logPath = path.join(runDirectory, `${logName}.log`), errorPath = path.join(runDirectory, `${logName}.stderr.log`);
    for (const filename of [logPath, errorPath]) await inspect(filename, 'file', true);
    await fs.writeFile(logPath, cached.stdout);
    await fs.writeFile(errorPath, cached.stderr);
    handle.hit = { exitCode: 0, signal: null, error: undefined, logPath, errorPath, logSha256: cached.receipt.logSha256, errorSha256: cached.receipt.errorSha256, stdout: cached.stdout.toString(), stderr: cached.stderr.toString(), reused: true };
  } catch (error) { handle.reason = `miss: ${message(error)}`; }
  handle.publish = async record => {
    if (closed || publishing) return { published: false, reason: closed ? 'closed' : 'publication already active' };
    if (!record || record.exitCode !== 0 || record.signal != null || record.error != null) return { published: false, reason: 'check did not succeed' };
    publishing = true;
    const temp = path.join(slot, `.tmp-${crypto.randomUUID()}`);
    try {
      await directory(slot);
      const [stdout, stderr] = await Promise.all([log(record.logPath), log(record.errorPath)]);
      const receipt = { schema: CACHE_SCHEMA, checkId, key, exitCode: 0, signal: null, error: null, logSha256: sha(stdout), errorSha256: sha(stderr) };
      await fs.mkdir(temp);
      await Promise.all([fs.writeFile(path.join(temp, 'stdout.log'), stdout, { flag: 'wx' }), fs.writeFile(path.join(temp, 'stderr.log'), stderr, { flag: 'wx' }), fs.writeFile(path.join(temp, 'receipt.json'), JSON.stringify(receipt), { flag: 'wx' })]);
      await readEntry(temp, checkId, key);
      let valid = false;
      try { await readEntry(entry, checkId, key); valid = true; } catch { /* Invalid evidence is replaced only after safe tree inspection. */ }
      if (!valid) {
        if (await fs.lstat(entry).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) await remove(cacheRoot, entry);
        await fs.rename(temp, entry);
      }
      await readEntry(entry, checkId, key);
      await pruneKeys(cacheRoot, slot, key, deferred);
      return { published: true, deferred };
    } catch (error) { return { published: false, reason: message(error), deferred }; }
    finally {
      try {
        const temporary = await fs.lstat(temp).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (temporary) await remove(cacheRoot, temp);
      } catch (error) { deferred.push(`temporary cleanup: ${message(error)}`); }
      publishing = false;
    }
  };
  return handle;
}

module.exports = { CACHE_SCHEMA, begin, pruneObsoleteVersions, pruneRemovedChecks };

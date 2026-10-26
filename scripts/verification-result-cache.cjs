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
async function acquireRaw(root, filename, waitMs = 0, details = {}) {
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
  const ownerBytes = JSON.stringify({ ...details, token, pid: process.pid, acquisitionTime: new Date().toISOString(), coordinator: { pid: process.pid, parentPid: process.ppid, processStartTime: new Date(require('node:perf_hooks').performance.timeOrigin).toISOString() } });
  try { await fs.writeFile(path.join(filename, 'owner.json'), ownerBytes, { flag: 'wx' }); }
  catch (error) { await fs.rmdir(filename).catch(() => {}); throw error; }
  let released = false;
  const assertOwned = async () => {
    await directory(filename);
    const names = await fs.readdir(filename);
    if (names.length !== 1 || names[0] !== 'owner.json') throw Error(`Lease retirement in progress: ${filename}`);
    await inspect(path.join(filename, 'owner.json'), 'file');
    const owner = JSON.parse(await fs.readFile(path.join(filename, 'owner.json'), 'utf8'));
    if (owner.token !== token || sha(await fs.readFile(path.join(filename, 'owner.json'))) !== sha(ownerBytes)) throw Error(`Lease ownership changed: ${filename}`);
  };
  const release = async () => {
    if (released) return;
    await assertOwned();
    await remove(root, filename);
    released = true;
  };
  release.assertOwned = assertOwned;
  release.owner = JSON.parse(ownerBytes);
  return release;
}
// All cooperating lease mutations and publications share this short guard. An
// abandoned guard is deliberately fail-closed, never stolen by PID or age.
const accessQueues = new Map();
const lifecycleQueues = new Map();
async function localTurn(queues, root) {
  const canonical = await fs.realpath(root);
  const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  const previous = queues.get(key) || Promise.resolve();
  let next;
  const pending = new Promise(resolve => { next = resolve; });
  queues.set(key, pending);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (queues.get(key) === pending) queues.delete(key);
    next();
  };
  await previous;
  return finish;
}
async function access(root, details = {}) {
  const finish = await localTurn(accessQueues, root);
  try {
    const release = await acquireRaw(root, path.join(root, '.lease-access'), 2000, { runDirectory: null, checkId: null, operation: 'lease-access', ...details });
    if (!release) throw Error('Lease access guard busy; independent retirement required');
    // Keep the local FIFO slot until the disk guard release finishes. A failed
    // release leaves that disk ownership intact and later callers fail closed.
    return async () => { try { await release(); } finally { finish(); } };
  } catch (error) { finish(); throw error; }
}
async function acquire(root, filename, waitMs = 0, details = {}) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const unlock = await access(root, details);
    let lease;
    try { lease = await acquireRaw(root, filename, 0, details); }
    finally { await unlock(); }
    if (lease) {
      const release = async () => { const unlock = await access(root, details); try { await lease(); } finally { await unlock(); } };
      release.assertOwned = lease.assertOwned;
      release.owner = lease.owner;
      return release;
    }
    if (Date.now() >= deadline) return null;
    await delay(Math.min(10, deadline - Date.now()));
  }
}

async function acquireLifecycle(root, details) {
  // Local lifecycle owners may scan a large cache. Wait for their actual release
  // before starting the bounded deadline for an external or abandoned owner.
  const finish = await localTurn(lifecycleQueues, root);
  try {
    const lease = await acquire(root, path.join(root, '.lifecycle'), 2000, details);
    if (!lease) { finish(); return null; }
    const release = async () => { try { await lease(); } finally { finish(); } };
    release.assertOwned = lease.assertOwned;
    release.owner = lease.owner;
    return release;
  } catch (error) { finish(); throw error; }
}

function leasePath(cacheRoot, lease) {
  if (!['.lifecycle', '.lease-access'].includes(lease) && !isHash(lease)) throw Error('Expected exact lifecycle/access or check hash lease');
  return lease.startsWith('.') ? path.join(cacheRoot, lease) : path.join(cacheRoot, '.leases', lease);
}
async function inspectLease(options) {
  const { cacheRoot } = configuration(options), target = leasePath(cacheRoot, options.lease);
  await directory(path.dirname(target));
  if (!await inspect(target, 'directory', true)) return { lease: options.lease, path: target, exists: false };
  const names = await fs.readdir(target);
  const claimNames = names.filter(name => /^retirement(?:-[1-9][0-9]*-[a-f0-9-]{36}|-claim-[a-f0-9]{64})?\.json$/.test(name));
  if (!names.includes('owner.json') || names.some(name => name !== 'owner.json' && !(options.lease === '.lease-access' && claimNames.includes(name)))) throw Error('Unidentified lease contents; exact retirement requires owner.json');
  const filename = path.join(target, 'owner.json');
  const stat = await inspect(filename, 'file');
  if (stat.size > 16384) throw Error('Oversized lease owner');
  const bytes = await fs.readFile(filename);
  let owner = null;
  try { owner = JSON.parse(bytes); } catch { /* Exact malformed bytes remain inspectable for explicit retirement. */ }
  const token = owner && typeof owner.token === 'string' && owner.token ? owner.token : null;
  let retirement = null;
  if (claimNames.length) {
    const claims = new Map(), predecessors = new Set();
    for (const name of claimNames) {
      const claimPath = path.join(target, name), stat = await inspect(claimPath, 'file');
      if (stat.size > 16384) throw Error('Oversized retirement claim');
      const claimBytes = await fs.readFile(claimPath), claim = JSON.parse(claimBytes);
      if (!claim || typeof claim.token !== 'string' || !claim.token || !Number.isSafeInteger(claim.pid) || claim.pid <= 0 || claim.ownerSha256 !== sha(bytes)) throw Error('Unidentified retirement claim identity');
      const resumedPid = /^retirement-([1-9][0-9]*)-/.exec(name);
      claims.set(name, { name, claim, claimantPid: resumedPid ? Number(resumedPid[1]) : claim.pid, sha256: sha(claimBytes) });
    }
    for (const entry of claims.values()) {
      const prior = entry.claim.predecessor;
      if (prior === undefined) {
        if (entry.name.startsWith('retirement-claim-')) throw Error('Unidentified retirement claim predecessor');
        continue;
      }
      if (!prior || typeof prior.name !== 'string' || !isHash(prior.sha256) || entry.name !== `retirement-claim-${prior.sha256}.json` || claims.get(prior.name)?.sha256 !== prior.sha256 || predecessors.has(prior.name)) throw Error('Unidentified retirement claim chain');
      predecessors.add(prior.name);
    }
    const tips = [...claims.values()].filter(entry => !predecessors.has(entry.name));
    if (tips.length !== 1) throw Error('Unidentified retirement claim chain');
    const visited = new Set();
    for (let entry = tips[0]; entry; entry = claims.get(entry.claim.predecessor?.name)) {
      if (visited.has(entry.name)) throw Error('Unidentified retirement claim cycle');
      visited.add(entry.name);
    }
    if (visited.size !== claims.size) throw Error('Unidentified retirement claim chain');
    retirement = tips[0];
  }
  return { lease: options.lease, path: target, exists: true, owner, token, ownerSha256: sha(bytes), retirement };
}
function refuseLivePid(pid) {
  if (Number.isSafeInteger(pid) && pid > 0) {
    try { process.kill(pid, 0); throw Error('Lease producer PID is live; retirement refused'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}
function ownsRetirement(actual, expected) {
  return actual?.name === expected.name && actual.sha256 === expected.sha256 && actual.claimantPid === process.pid && actual.claim.token === expected.claim.token;
}
async function externalFile(projectRoot, cacheRoot, value, create = false) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) throw Error('Absolute project evidence path required');
  const filename = path.resolve(value);
  if (!inside(projectRoot, filename) || inside(cacheRoot, filename)) throw Error('Evidence and receipt must survive outside cache inside project');
  await directory(path.dirname(filename), create);
  await inspect(filename, 'file', create);
  return filename;
}
// Trusted caller attests independent verification of the exact producer tree.
// PID absence is never evidence. A positive live PID observation vetoes recovery.
async function recoverLease(options) {
  const { projectRoot, cacheRoot } = configuration(options);
  leasePath(cacheRoot, options.lease);
  if (options.producer_stopped_verified !== true || typeof options.reason !== 'string' || !options.reason.trim() || !isHash(options.expectedOwnerSha256) || !isHash(options.evidence_sha256) || !(options.expectedToken === null || typeof options.expectedToken === 'string' && options.expectedToken)) throw Error('Exact verified retirement, token, hashes and reason required');
  const evidence = await externalFile(projectRoot, cacheRoot, options.evidence_ref);
  const receipt = await externalFile(projectRoot, cacheRoot, options.receipt_ref, true);
  if (receipt === evidence) throw Error('Recovery receipt must be separate from evidence');
  const verifyEvidence = async () => { await externalFile(projectRoot, cacheRoot, evidence); if (sha(await fs.readFile(evidence)) !== options.evidence_sha256) throw Error('Retirement evidence changed'); };
  await verifyEvidence();
  let unlock, retirementClaim = null;
  // Recovery cannot acquire the disk guard it is retiring. It still shares the
  // local FIFO with ordinary guard users until its final ownership check ends.
  if (options.lease === '.lease-access') unlock = await localTurn(accessQueues, cacheRoot);
  else unlock = await access(cacheRoot, { operation: 'verified-retirement', lease: options.lease });
  try {
    const current = await inspectLease(options);
    if (!current.exists || current.token !== options.expectedToken || current.ownerSha256 !== options.expectedOwnerSha256) throw Error('Lease identity changed');
    refuseLivePid(current.owner?.pid);
    if (options.lease === '.lease-access') {
      // A claim stays in the dead guard on interruption. Only its exact proven
      // dead claimant can be resumed; competitors never remove this claim.
      let name = 'retirement.json';
      const claim = { token: crypto.randomUUID(), pid: process.pid, ownerSha256: current.ownerSha256, evidence_sha256: options.evidence_sha256 };
      if (current.retirement) {
        if (!isHash(options.expectedRetirementSha256) || current.retirement.sha256 !== options.expectedRetirementSha256 || options.expectedRetirementName !== current.retirement.name) throw Error('Exact retirement claim identity required');
        refuseLivePid(current.retirement.claimantPid);
        // Windows can complete two concurrent renames of the same source. A
        // fixed successor name and exclusive creation select only one resumer.
        name = `retirement-claim-${current.retirement.sha256}.json`;
        claim.predecessor = { name: current.retirement.name, sha256: current.retirement.sha256 };
      } else {
        if (options.expectedRetirementSha256 !== undefined) throw Error('Retirement claim identity changed');
      }
      const claimBytes = JSON.stringify(claim);
      await fs.writeFile(path.join(current.path, name), claimBytes, { flag: 'wx' });
      // New acquisitions remain excluded by the existing directory. All other
      // recovery attempts are excluded by the exclusively created claim.
      retirementClaim = { name, claim, claimantPid: process.pid, sha256: sha(claimBytes) };
      const claimed = await inspectLease(options);
      if (claimed.ownerSha256 !== current.ownerSha256 || claimed.token !== current.token || !ownsRetirement(claimed.retirement, retirementClaim)) throw Error('Lease identity changed');
    }
    await verifyEvidence();
    await safeTree(cacheRoot, current.path);
    const decision = { schema: 1, action: 'verified-lease-retirement', lease: current, retirementClaim, evidence_ref: evidence, evidence_sha256: options.evidence_sha256, reason: options.reason, producer_stopped_verified: true, decidedAt: new Date().toISOString() };
    // The immutable decision precedes deletion and survives a partial failure.
    await fs.writeFile(receipt, JSON.stringify(decision, null, 2) + '\n', { flag: 'wx' });
    await verifyEvidence();
    const final = await inspectLease(options);
    if (final.token !== current.token || final.ownerSha256 !== current.ownerSha256 || (retirementClaim && !ownsRetirement(final.retirement, retirementClaim))) throw Error('Lease identity changed');
    await remove(cacheRoot, current.path);
    return { recovered: true, lease: options.lease, receipt_ref: receipt, evidence_sha256: options.evidence_sha256 };
  } finally { if (unlock) await unlock(); }
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
    release = await acquireLifecycle(cacheRoot, { runDirectory: options.runDirectory ? path.resolve(options.runDirectory) : null, checkId: options.checkId || null, operation: 'prune-obsolete' });
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
    release = await acquireLifecycle(cacheRoot, { runDirectory: options.runDirectory ? path.resolve(options.runDirectory) : null, checkId: options.checkId || null, operation: 'prune-removed' });
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
  let releaseCheck, releaseLifecycle, closing, needsPrune = false, closeRequested = false, closed = false, publishing = false;
  const handle = { hit: null, reason: null, blockingLease: null, deferred, publish: async () => ({ published: false, reason: handle.reason || 'cache unavailable' }), close: () => {
    if (closed) return Promise.resolve();
    if (closing) return closing;
    if (publishing) return Promise.reject(Error('Cannot close cache while publishing'));
    closeRequested = true;
    closing = (async () => {
      if (releaseCheck) {
        try { await releaseCheck(); releaseCheck = null; }
        catch (error) { deferred.push(`lease release: ${message(error)}`); }
      }
      if (releaseLifecycle) {
        try { await releaseLifecycle(); releaseLifecycle = null; }
        catch (error) { deferred.push(`lifecycle release: ${message(error)}`); }
      }
      if (!releaseCheck && !releaseLifecycle) {
        // The final active check releases deferred obsolete schema storage. The
        // lifecycle lock also prevents a new begin racing the idle-root check.
        if (needsPrune) {
          const cleanup = await pruneObsoleteVersions(options);
          deferred.push(...cleanup.deferred);
        }
        closed = true;
      }
    })().finally(() => { closing = null; });
    return closing;
  } };
  const busy = async (lease, reason) => {
    handle.reason = reason;
    // Diagnostic snapshot only: recovery still requires independent producer
    // tree evidence and recoverLease's fresh, exact identity checks. Never infer
    // abandonment from age, PID absence, or a failed owner inspection.
    try { handle.blockingLease = await inspectLease({ ...options, lease }); }
    catch (error) { deferred.push(`blocking lease inspection: ${message(error)}`); }
    return handle;
  };
  try {
    await directory(cacheRoot, true);
    releaseLifecycle = await acquireLifecycle(cacheRoot, { runDirectory, checkId });
    if (!releaseLifecycle) return await busy('.lifecycle', 'busy: lifecycle lease');
    await obsolete(cacheRoot, deferred);
    releaseCheck = await acquire(cacheRoot, path.join(cacheRoot, '.leases', sha(checkId)), 0, { runDirectory, checkId });
    if (!releaseCheck) return await busy(sha(checkId), 'busy: check lease');
    needsPrune = true;
    handle.lease = { ...releaseCheck.owner, lease: sha(checkId), ownerSha256: (await inspectLease({ ...options, lease: sha(checkId) })).ownerSha256 };
    await directory(slot, true);
    await pruneKeys(cacheRoot, slot, key, deferred);
    // A forced probe must revoke the old pass before executing, so a later
    // failure cannot leave that same input key eligible for reuse.
    if (options.force && await inspect(entry, 'directory', true)) await remove(cacheRoot, entry);
  } catch (error) { handle.reason = message(error); await handle.close(); return handle; }
  finally {
    if (releaseLifecycle) {
      try { await releaseLifecycle(); releaseLifecycle = null; }
      catch (error) { deferred.push(`lifecycle release: ${message(error)}`); }
    }
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
    if (closeRequested || publishing) return { published: false, reason: closeRequested ? 'closed' : 'publication already active' };
    if (!record || record.exitCode !== 0 || record.signal != null || record.error != null) return { published: false, reason: 'check did not succeed' };
    publishing = true;
    const temp = path.join(slot, `.tmp-${crypto.randomUUID()}`);
    let unlock;
    try {
      unlock = await access(cacheRoot, { runDirectory, checkId, operation: 'publish' });
      await releaseCheck.assertOwned();
      await directory(slot);
      const [stdout, stderr] = await Promise.all([log(record.logPath), log(record.errorPath)]);
      const receipt = { schema: CACHE_SCHEMA, checkId, key, exitCode: 0, signal: null, error: null, logSha256: sha(stdout), errorSha256: sha(stderr) };
      await fs.mkdir(temp);
      await Promise.all([fs.writeFile(path.join(temp, 'stdout.log'), stdout, { flag: 'wx' }), fs.writeFile(path.join(temp, 'stderr.log'), stderr, { flag: 'wx' }), fs.writeFile(path.join(temp, 'receipt.json'), JSON.stringify(receipt), { flag: 'wx' })]);
      await readEntry(temp, checkId, key);
      let valid = false;
      try { await readEntry(entry, checkId, key); valid = true; } catch { /* Invalid evidence is replaced only after safe tree inspection. */ }
      if (!valid) {
        await releaseCheck.assertOwned();
        if (await fs.lstat(entry).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) await remove(cacheRoot, entry);
        await releaseCheck.assertOwned();
        await fs.rename(temp, entry);
      }
      await readEntry(entry, checkId, key);
      await releaseCheck.assertOwned();
      await pruneKeys(cacheRoot, slot, key, deferred);
      return { published: true, deferred };
    } catch (error) { return { published: false, reason: message(error), deferred }; }
    finally {
      try {
        const temporary = await fs.lstat(temp).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (temporary) await remove(cacheRoot, temp);
      } catch (error) { deferred.push(`temporary cleanup: ${message(error)}`); }
      publishing = false;
      if (unlock) await unlock();
    }
  };
  return handle;
}

module.exports = { CACHE_SCHEMA, begin, pruneObsoleteVersions, pruneRemovedChecks, inspectLease, recoverLease };

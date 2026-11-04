'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const identity = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function validateGrant({ threadId, turnId, policyGeneration } = {}) {
  if (!identity(threadId) || !identity(turnId) || !Number.isSafeInteger(policyGeneration) || policyGeneration < 0) throw new Error('Invalid desktop task authority identity');
}
function appRevocationFingerprint(codexHome, connector = 'computer-use') {
  if (typeof codexHome !== 'string' || !path.isAbsolute(codexHome) || !['computer-use', 'window-use'].includes(connector)) throw new Error('Invalid app revocation store location');
  const file = path.join(codexHome, 'azrael', connector, 'app-approvals.json');
  let state, fd;
  try {
    fd = fs.openSync(file, 'r');
    const stat = fs.fstatSync(fd), limit = 1024 * 1024;
    if (!stat.isFile() || stat.size > limit) throw new Error('App approval store exceeds limit');
    const bytes = Buffer.alloc(limit + 1), length = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (length > limit) throw new Error('App approval store exceeds limit');
    state = JSON.parse(bytes.subarray(0, length).toString('utf8'));
  } catch (error) { if (error.code !== 'ENOENT') throw error; state = { schema: 1, revocations: {}, apps: [] }; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
  if (state?.schema !== 1 || !state.revocations || typeof state.revocations !== 'object' || Array.isArray(state.revocations) || !Array.isArray(state.apps)) throw new Error('Invalid app approval store');
  const entries = Object.keys(state.revocations).sort().map(key => {
    const generation = state.revocations[key];
    if (!key || key !== key.trim() || (connector === 'computer-use' && key !== key.toLowerCase()) || key.length > 512 || /[\x00-\x1f\x7f]/.test(key) || !Number.isSafeInteger(generation) || generation < 0) throw new Error('Invalid app revocation generation');
    return [key, generation];
  });
  return crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}
function createDesktopAuthority({ directory, codexHome }) {
  if (!path.isAbsolute(directory)) throw new Error('Desktop authority directory must be absolute');
  if (typeof codexHome !== 'string' || !path.isAbsolute(codexHome)) throw new Error('Desktop authority requires absolute trusted CODEX_HOME');
  const grants = new Map();
  const recordPath = threadId => path.join(directory, threadId + '.json');
  function revoke(threadId) {
    if (!identity(threadId)) throw new Error('Invalid desktop task thread');
    grants.delete(threadId);
    try { fs.unlinkSync(recordPath(threadId)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  function grant(value) {
    validateGrant(value);
    const { threadId, turnId, policyGeneration } = value;
    revoke(threadId);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const token = crypto.randomBytes(32).toString('hex');
    const fingerprint = appRevocationFingerprint(codexHome);
    const lease = Object.freeze({ token, recordPath: recordPath(threadId), threadId, turnId, policyGeneration, appRevocationFingerprint: fingerprint });
    const record = { schema: 1, threadId, turnId, policyGeneration, appRevocationFingerprint: fingerprint, tokenHash: crypto.createHash('sha256').update(token).digest('hex') };
    const temporary = lease.recordPath + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify(record) + '\n', { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, lease.recordPath);
    } finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    grants.set(threadId, lease);
    return lease;
  }
  function authorize(value) {
    validateGrant(value);
    const lease = grants.get(value.threadId);
    if (!lease || lease.turnId !== value.turnId || lease.policyGeneration !== value.policyGeneration) throw new Error('Desktop task authority is not granted');
    let record;
    const fd = fs.openSync(lease.recordPath, 'r');
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 4096) throw new Error('Invalid desktop task authority record');
      const bytes = Buffer.alloc(4097), length = fs.readSync(fd, bytes, 0, bytes.length, 0);
      if (length > 4096) throw new Error('Invalid desktop task authority record');
      record = JSON.parse(bytes.subarray(0, length).toString('utf8'));
    } finally { fs.closeSync(fd); }
    if (record.tokenHash !== crypto.createHash('sha256').update(lease.token).digest('hex') || record.threadId !== lease.threadId || record.turnId !== lease.turnId || record.policyGeneration !== lease.policyGeneration || record.schema !== 1 || record.appRevocationFingerprint !== lease.appRevocationFingerprint || appRevocationFingerprint(codexHome) !== lease.appRevocationFingerprint) throw new Error('Desktop task authority was replaced or app approval revoked');
    return lease;
  }
  return { grant, revoke, authorize };
}
module.exports = { createDesktopAuthority, appRevocationFingerprint };

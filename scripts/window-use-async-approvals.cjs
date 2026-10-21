'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const ID = /^azrael-window-consent-[a-f0-9-]{36}$/i;
const HASH = /^[a-f0-9]{64}$/;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}
function scopeKey(binding) { return createHash('sha256').update(JSON.stringify(canonical(binding))).digest('hex'); }
// This bearer belongs to the host profile, never to the model or webview. An
// absent/malformed key cannot recover or resolve another host's pending ledger.
function readOwnerToken(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const actual = fs.realpathSync.native(directory), expected = path.resolve(directory);
  if ((process.platform === 'win32' ? actual.toLowerCase() !== expected.toLowerCase() : actual !== expected)) throw Error('Approval owner directory must not be redirected');
  const file = path.join(directory, 'owner-key');
  const directoryInfo = fs.statSync(directory);
  if (process.platform !== 'win32' && ((directoryInfo.mode & 0o077) !== 0 || directoryInfo.uid !== process.getuid())) throw Error('Approval owner directory is not private');
  try {
    const fd = fs.openSync(file, 'wx', 0o600);
    try { fs.writeFileSync(fd, randomBytes(32).toString('hex') + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== 65 || (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid()))) throw Error('Approval owner key is not private or valid');
  const fd = fs.openSync(file, 'r');
  try {
    const opened = fs.fstatSync(fd);
    if (opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== info.size) throw Error('Approval owner key changed');
    const token = fs.readFileSync(fd, 'utf8').trim();
    if (!HASH.test(token)) throw Error('Approval owner key is malformed');
    return token;
  } finally { fs.closeSync(fd); }
}
function record(value, threadId) {
  const binding = value?.payload?.binding, request = value?.payload?.request;
  if (value?.state === 'accepted' && !['session', 'always'].includes(value.persistence)) throw Error('Accepted approval lacks persistence');
  if (!ID.test(value?.requestId || '') || !HASH.test(value?.scopeKey || '') || !binding || binding.threadId !== threadId || request?.id !== value.requestId || request.params?.threadId !== threadId || scopeKey(binding) !== value.scopeKey || !['pending', 'accepted', 'declined', 'cancelled'].includes(value.state) || ![null, undefined, 'session', 'always'].includes(value.persistence) || Buffer.byteLength(JSON.stringify(value.payload)) > 16384) throw Error('Invalid durable Window Use approval record');
  return value;
}
function createLedger({ directory, rpc }) {
  let token;
  const call = (threadId, method, params = {}) => rpc(threadId, 'thread/approval/' + method, { ...params, threadId, ownerToken: token ??= readOwnerToken(directory) });
  return {
    scopeKey,
    async list(threadId) {
      const result = await call(threadId, 'list');
      if (!Array.isArray(result?.requests)) throw Error('Durable approval ledger unavailable');
      return result.requests.map(value => record(value, threadId));
    },
    async request(threadId, request, binding) {
      const result = await call(threadId, 'request', { requestId: request.id, scopeKey: scopeKey(binding), payload: { request, binding } });
      return record(result?.request, threadId);
    },
    async resolve(threadId, requestId, key, answer, resume) {
      const result = await call(threadId, 'resolve', { requestId, scopeKey: key, decision: answer.action, ...(answer.action === 'accept' ? { persistence: answer.content?.persist ?? answer._meta?.persist } : {}), resume });
      return record(result?.request, threadId);
    },
    async defer(threadId, requestId, key) {
      const result = await call(threadId, 'defer', { requestId, scopeKey: key });
      return record(result?.request, threadId);
    },
    async withdraw(threadId, requestId, reason) {
      const result = await call(threadId, 'withdraw', { ...(requestId ? { requestId } : {}), reason });
      if (!Array.isArray(result?.requests)) throw Error('Durable approval withdrawal unconfirmed');
      return result.requests.map(value => record(value, threadId));
    },
  };
}
module.exports = { createLedger, scopeKey, readOwnerToken };

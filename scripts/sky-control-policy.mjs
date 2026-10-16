import { createSettingsOwner } from './use-control-settings.mjs';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
const authority = new AsyncLocalStorage();
const identity = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function trustedDesktopMetadata() {
  const runtime = Object.getOwnPropertyDescriptor(globalThis, 'nodeRepl');
  if (!runtime || runtime.configurable || runtime.writable !== false || !runtime.value) throw new Error('Trusted NodeRepl runtime is required');
  const descriptor = Object.getOwnPropertyDescriptor(runtime.value, 'requestMeta');
  if (!descriptor || descriptor.configurable || typeof descriptor.get !== 'function' || descriptor.set) throw new Error('Trusted NodeRepl metadata is required');
  const meta = descriptor.get.call(runtime.value), turn = meta?.['x-codex-turn-metadata'];
  if (!meta || !Object.isFrozen(meta) || !turn || !Object.isFrozen(turn) || !identity(turn.thread_id) || !identity(turn.turn_id) || turn.sandbox_mode !== 'danger-full-access' || turn.sandbox !== 'none') throw new Error('Trusted active unsandboxed NodeRepl turn is required');
  if ((Object.hasOwn(meta, 'threadId') && meta.threadId !== turn.thread_id) || (Object.hasOwn(meta, 'thread_id') && meta.thread_id !== turn.thread_id)) throw new Error('Conflicting trusted NodeRepl thread identity');
  return meta;
}
function boundedJson(file, limit) {
  const fd = fs.openSync(file, 'r');
  try {
    if (!fs.fstatSync(fd).isFile() || fs.fstatSync(fd).size > limit) throw new Error('Desktop authority data exceeds limit');
    const bytes = Buffer.alloc(limit + 1), length = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (length > limit) throw new Error('Desktop authority data exceeds limit');
    return JSON.parse(bytes.subarray(0, length).toString('utf8'));
  } finally { fs.closeSync(fd); }
}
function assertLease(lease, generation) {
  const turn = trustedDesktopMetadata()['x-codex-turn-metadata'];
  if (!lease || lease.threadId !== turn.thread_id || lease.turnId !== turn.turn_id || lease.policyGeneration !== generation || typeof lease.token !== 'string' || !/^[a-f0-9]{64}$/.test(lease.token) || !path.isAbsolute(lease.recordPath)) throw new Error('Desktop task authority is not granted for this turn');
  const record = boundedJson(lease.recordPath, 4096);
  if (record.schema !== 1 || record.threadId !== lease.threadId || record.turnId !== lease.turnId || record.policyGeneration !== generation || record.tokenHash !== createHash('sha256').update(lease.token).digest('hex') || typeof lease.appRevocationFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(lease.appRevocationFingerprint) || record.appRevocationFingerprint !== lease.appRevocationFingerprint || appRevocationFingerprint() !== lease.appRevocationFingerprint) throw new Error('Desktop task authority was revoked or replaced');
}
function appRevocationFingerprint() {
  if (!process.env.CODEX_HOME || !path.isAbsolute(process.env.CODEX_HOME)) throw new Error('Managed Computer Use requires absolute CODEX_HOME');
  let state;
  try { state = boundedJson(path.join(process.env.CODEX_HOME, 'azrael', 'computer-use', 'app-approvals.json'), 1024 * 1024); }
  catch (error) { if (error.code !== 'ENOENT') throw error; state = { schema: 1, revocations: {}, apps: [] }; }
  if (state?.schema !== 1 || !state.revocations || typeof state.revocations !== 'object' || Array.isArray(state.revocations) || !Array.isArray(state.apps)) throw new Error('Invalid app approval store');
  const entries = Object.keys(state.revocations).sort().map(key => {
    const generation = state.revocations[key];
    if (!key || key !== key.trim() || key !== key.toLowerCase() || key.length > 512 || /[\x00-\x1f\x7f]/.test(key) || !Number.isSafeInteger(generation) || generation < 0) throw new Error('Invalid app revocation generation');
    return [key, generation];
  });
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}
function owner() {
  if (!process.env.CODEX_HOME) throw new Error('Managed Computer Use requires explicit CODEX_HOME');
  return createSettingsOwner(process.env.CODEX_HOME);
}
export function currentComputerUsePolicy() { return owner().getSettings(); }
export function assertComputerUseEnabled(generation) {
  const state = currentComputerUsePolicy();
  if (!state.windowUseEnabled || !state.stage4Enabled) throw new Error('Window Use desktop control is disabled');
  if (generation !== undefined && generation !== state.computerUseGeneration) throw new Error('Computer Use policy changed while request was queued');
  assertLease(authority.getStore(), state.windowUseGeneration);
  return state.computerUseGeneration;
}
export function withDesktopAuthority(lease, callback) {
  const snapshot = Object.freeze({ token: lease?.token, recordPath: lease?.recordPath, threadId: lease?.threadId, turnId: lease?.turnId, policyGeneration: lease?.policyGeneration, appRevocationFingerprint: lease?.appRevocationFingerprint });
  return authority.run(snapshot, async () => {
    assertComputerUseEnabled();
    const result = await callback();
    assertComputerUseEnabled();
    return result;
  });
}
export async function acquireDesktopAuthority() {
  const turn = trustedDesktopMetadata()['x-codex-turn-metadata'], threadId = turn.thread_id;
  const meta = { 'x-codex-turn-metadata': { thread_id: threadId, turn_id: turn.turn_id, sandbox_mode: turn.sandbox_mode, sandbox: turn.sandbox } };
  const state = currentComputerUsePolicy();
  if (!state.windowUseEnabled || !state.stage4Enabled) throw new Error('Window Use desktop control is disabled');
  const session = boundedJson(path.join(process.env.CODEX_HOME, 'azrael', 'computer-use', 'window-sessions', threadId + '.json'), 16384);
  if (session.schema !== 1 || typeof session.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(session.nonce) || typeof session.pipe !== 'string' || !(process.platform === 'win32' ? /^\\\\\.\\pipe\\azrael-window-[A-Za-z0-9_-]{16,128}$/.test(session.pipe) : /^\/tmp\/azw-[A-Za-z0-9]{6}\/w\.sock$/.test(session.pipe))) throw new Error('Invalid desktop authority session');
  const lease = await new Promise((resolve, reject) => {
    const socket = net.createConnection(session.pipe); let bytes = 0, buffer = '', settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; socket.destroy(); error ? reject(error) : resolve(result); };
    socket.setTimeout(30000, () => finish(new Error('Desktop authority request timed out')));
    socket.on('connect', () => socket.write(JSON.stringify({ nonce: session.nonce, threadId, method: 'desktop_authority', _meta: meta }) + '\n'));
    socket.on('error', error => finish(error));
    socket.on('close', () => finish(new Error('Desktop authority host closed before response')));
    socket.on('data', data => {
      bytes += data.length; if (bytes > 16384) return finish(new Error('Desktop authority response exceeds limit'));
      buffer += data.toString('utf8');
      for (;;) {
        const end = buffer.indexOf('\n'); if (end < 0) return;
        let reply; try { reply = JSON.parse(buffer.slice(0, end)); } catch (error) { return finish(error); }
        buffer = buffer.slice(end + 1);
        if (reply?.progress) continue;
        if (reply?.error) return finish(new Error(reply.error.message || 'Desktop task authority denied'));
        if (!reply || !Object.hasOwn(reply, 'result')) return finish(new Error('Invalid desktop authority response'));
        return finish(null, reply.result);
      }
    });
  });
  assertLease(lease, state.windowUseGeneration);
  return Object.freeze(lease);
}

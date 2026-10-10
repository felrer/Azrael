import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync, realpathSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { AdapterError, fail, MAX_BYTES } from './inference-mapping.mjs';
import { validateIsolatedHomeForTests } from './helper.ts';

export type ApiModel = { id: string; name: string; contextWindow: number; maxOutputTokens: number; supportsTools: boolean; enableThinking: boolean; sendThinkingParameter: boolean; parallelToolCalls: boolean };
export type ApiConnection = { id: string; name: string; baseUrl: string; protocol: 'chat' | 'responses'; enabled: boolean; timeoutMs: number; maxConcurrent: number; stream: boolean; auth: { kind: 'none' | 'bearerFile' | 'secret'; filePath?: string }; models: ApiModel[] };
export const isApiProvider = (id: unknown): id is string => typeof id === 'string' && /^api-[a-f0-9]{32}$/.test(id);
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const object = (v: any) => v && typeof v === 'object' && !Array.isArray(v);
const text = (v: any, max = 256) => typeof v === 'string' && v.trim().length > 0 && Buffer.byteLength(v) <= max && !/[\x00-\x1f\x7f-\x9f]/.test(v);
const integer = (v: any, fallback: number, max: number) => { const n = v ?? fallback; if (!Number.isSafeInteger(n) || n < 1 || n > max) fail('invalid_api_config'); return n; };
const boolean = (v: any, fallback: boolean) => { if (v === undefined) return fallback; if (typeof v !== 'boolean') fail('invalid_api_config'); return v; };
export function apiDirectory() {
  validateIsolatedHomeForTests();
  if (!process.env.CODEX_HOME || !isAbsolute(process.env.CODEX_HOME)) fail('api_home_unavailable');
  const home = resolve(process.env.CODEX_HOME), directory = join(home, 'azrael', 'providers', 'api');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const rel = relative(realpathSync(home), realpathSync(directory));
  if (rel.startsWith('..') || isAbsolute(rel)) fail('api_storage_not_isolated');
  return directory;
}
export function normalizeConnection(v: any, id = v?.id): ApiConnection {
  if (!object(v) || !/^[a-f0-9]{32}$/.test(id ?? '') || !text(v.name) || !text(v.baseUrl, 4096) || !['chat', 'responses'].includes(v.protocol) || !object(v.auth) || !['none', 'bearerFile', 'secret'].includes(v.auth.kind) || !Array.isArray(v.models) || v.models.length > 256) fail('invalid_api_config');
  let url: URL; try { url = new URL(v.baseUrl); } catch { fail('invalid_api_config'); }
  if (!['http:', 'https:'].includes(url!.protocol) || url!.username || url!.password || url!.hash || url!.search) fail('invalid_api_config');
  if (v.auth.kind === 'bearerFile' && (!text(v.auth.filePath, 4096) || !isAbsolute(v.auth.filePath))) fail('invalid_api_config');
  const ids = new Set<string>();
  const models = v.models.map((m: any) => {
    if (!object(m) || !text(m.id) || !text(m.name) || ids.has(m.id) || typeof m.supportsTools !== 'boolean') fail('invalid_api_config');
    ids.add(m.id);
    return { id: m.id, name: m.name, contextWindow: integer(m.contextWindow, 32768, 100_000_000), maxOutputTokens: integer(m.maxOutputTokens, 4096, 10_000_000), supportsTools: m.supportsTools, enableThinking: boolean(m.enableThinking, false), sendThinkingParameter: boolean(m.sendThinkingParameter, false), parallelToolCalls: boolean(m.parallelToolCalls, false) };
  });
  return { id, name: v.name, baseUrl: url!.toString().replace(/\/+$/, ''), protocol: v.protocol, enabled: boolean(v.enabled, true), timeoutMs: integer(v.timeoutMs, 180000, 900000), maxConcurrent: integer(v.maxConcurrent, 1, 64), stream: boolean(v.stream, false), auth: v.auth.kind === 'bearerFile' ? { kind: 'bearerFile', filePath: v.auth.filePath } : { kind: v.auth.kind }, models };
}
export function atomicJson(path: string, value: any) {
  const raw = JSON.stringify(value); if (Buffer.byteLength(raw) > 1024 * 1024) fail('api_config_limit');
  const temporary = path + '.' + randomUUID() + '.tmp';
  try { writeFileSync(temporary, raw, { flag: 'wx', mode: 0o600 }); renameSync(temporary, path); }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
export function readConnections(): ApiConnection[] {
  const path = join(apiDirectory(), 'connections.json'); if (!existsSync(path)) return [];
  try {
    if (statSync(path).size > 1024 * 1024) fail('api_config_limit');
    const v = JSON.parse(readFileSync(path, 'utf8'));
    if (!object(v) || v.version !== 1 || !Array.isArray(v.connections) || v.connections.length > 128) fail('invalid_api_config');
    const connections = v.connections.map((c: any) => normalizeConnection(c));
    if (new Set(connections.map((c: ApiConnection) => c.id)).size !== connections.length) fail('invalid_api_config');
    return connections;
  } catch (e: any) { if (e instanceof AdapterError) throw e; fail('invalid_api_config'); }
}
// Exclusive creation + owner identity guards protect release/reclaim across helper processes.
// A live owner is never expired merely because its request is slow.
export async function acquireApiLock(path: string, signal: AbortSignal, wait = true) {
  const owner = JSON.stringify({ pid: process.pid, owner: randomUUID() });
  for (;;) {
    if (signal.aborted) fail('provider_request_deadline');
    try {
      const fd = openSync(path, 'wx', 0o600);
      try { writeFileSync(fd, owner); } finally { closeSync(fd); }
      return () => { try { if (readFileSync(path, 'utf8') === owner) unlinkSync(path); } catch {} };
    } catch (e: any) { if (e.code !== 'EEXIST') fail('api_storage_unavailable'); }
    try {
      const raw = readFileSync(path, 'utf8'), lock = JSON.parse(raw);
      if (Number.isInteger(lock.pid) && lock.pid > 0) {
        let dead = false; try { process.kill(lock.pid, 0); } catch (e: any) { dead = e.code === 'ESRCH'; }
        if (dead && readFileSync(path, 'utf8') === raw) { unlinkSync(path); continue; }
      }
    } catch {} // Incomplete lock metadata cannot establish a dead owner.
    if (!wait) return undefined;
    await new Promise<void>(r => { const timer = setTimeout(done, 40); function done() { clearTimeout(timer); signal.removeEventListener('abort', done); r(); } signal.addEventListener('abort', done, { once: true }); });
  }
}
type Entry = { getPassword(): string | null; setPassword(value: string): void; deletePassword(): boolean };
const require = createRequire(import.meta.url);
let factory = (service: string, account: string): Entry => new (require('@napi-rs/keyring').Entry)(service, account);
export function setApiSecretFactoryForTests(value?: typeof factory) { factory = value ?? ((service, account) => new (require('@napi-rs/keyring').Entry)(service, account)); }
const secretEntry = (id: string) => factory('azrael.custom-api.v1', hash(realpathSync(process.env.CODEX_HOME!) + ':' + id));
function secret(id: string) { try { return secretEntry(id).getPassword(); } catch { fail('api_secret_unavailable'); } }
export function apiToken(connection: ApiConnection): string | undefined {
  if (connection.auth.kind === 'none') return;
  let token: string | null;
  if (connection.auth.kind === 'secret') token = secret(connection.id);
  else {
    try { const path = connection.auth.filePath!; if (!statSync(path).isFile() || statSync(path).size > 16384) fail('api_token_file_unavailable'); token = readFileSync(path, 'utf8').trim(); }
    catch { fail('api_token_file_unavailable'); }
  }
  if (!token || token.length > 16384 || /[\r\n\x00]/.test(token)) fail('api_secret_unavailable');
  return token;
}
export function apiProviderIdentity(c: ApiConnection, token?: string) { return hash(JSON.stringify([c.id, c.baseUrl, c.protocol, c.auth, token ? hash(token) : null])); }
export function apiIdentity(c: ApiConnection, model: ApiModel, token?: string) { const { name: _name, ...behavior } = model; return hash(JSON.stringify([apiProviderIdentity(c, token), c.enabled, c.timeoutMs, c.maxConcurrent, c.stream, behavior])); }
export async function boundedJson(response: Response, signal?: AbortSignal) {
  if (!response.body) fail('invalid_api_response');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); }; signal?.addEventListener('abort', cancel, { once: true });
  try { for (;;) { if (signal?.aborted) fail('provider_request_deadline'); const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > MAX_BYTES) fail('output_limit'); chunks.push(value); } return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (e: any) { if (e instanceof AdapterError) throw e; fail('invalid_api_response'); }
  finally { signal?.removeEventListener('abort', cancel); try { await reader.cancel(); } catch {} }
}
export async function apiConfigCommand(command: any, fetcher = globalThis.fetch) {
  if (!object(command) || !['list', 'upsert', 'delete', 'discover'].includes(command.action)) fail('invalid_api_command');
  if (command.action === 'list') return { connections: readConnections() };
  if (command.action === 'discover') {
    const c = command.connection ? normalizeConnection(command.connection, command.connection.id ?? randomBytes(16).toString('hex')) : readConnections().find(c => c.id === command.id);
    if (!c) fail('api_connection_missing');
    const token = command.apiKey === undefined ? apiToken(c) : command.apiKey;
    if (token !== undefined && (typeof token !== 'string' || !token || token.length > 16384 || /[\r\n\x00]/.test(token))) fail('invalid_api_key');
    const signal = AbortSignal.timeout(c.timeoutMs);
    let response: Response; try { response = await fetcher(c.baseUrl + '/models', { headers: token ? { authorization: 'Bearer ' + token } : {}, signal, redirect: 'error' }); } catch { fail(signal.aborted ? 'provider_request_deadline' : 'api_connection_failed'); }
    if (!response.ok) { void response.body?.cancel().catch(() => {}); fail('provider_http_' + response.status); }
    const payload = await boundedJson(response, signal);
    if (!Array.isArray(payload?.data) || payload.data.length > 4096 || payload.data.some((m: any) => !text(m?.id))) fail('invalid_api_response');
    return { modelIds: [...new Set(payload.data.map((m: any) => m.id))] };
  }
  const directory = apiDirectory(), release = await acquireApiLock(join(directory, 'config.lock'), AbortSignal.timeout(10000));
  try {
    const connections = readConnections();
    if (command.action === 'delete') {
      if (!/^[a-f0-9]{32}$/.test(command.id ?? '')) fail('invalid_api_config');
      const old = connections.find(c => c.id === command.id);
      atomicJson(join(directory, 'connections.json'), { version: 1, connections: connections.filter(c => c.id !== command.id) });
      if (old?.auth.kind === 'secret') { try { secretEntry(old.id).deletePassword(); } catch { fail('api_secret_cleanup_failed'); } }
      return { connections: connections.filter(c => c.id !== command.id) };
    }
    const c = normalizeConnection(command.connection, command.connection?.id ?? randomBytes(16).toString('hex'));
    const old = connections.find(v => v.id === c.id);
    if (command.connection?.id && !old) fail('api_connection_missing');
    const previousToken = old?.auth.kind === 'secret' ? secret(c.id) : null;
    let changedSecret = false, committed = false;
    try {
      if (command.apiKey !== undefined) {
        if (c.auth.kind !== 'secret' || typeof command.apiKey !== 'string' || !command.apiKey || command.apiKey.length > 16384 || /[\r\n\x00]/.test(command.apiKey)) fail('invalid_api_key');
        changedSecret = true;
        try { secretEntry(c.id).setPassword(command.apiKey); if (secret(c.id) !== command.apiKey) fail('api_secret_unavailable'); } catch { fail('api_secret_unavailable'); }
      }
      if (c.auth.kind === 'secret' && !secret(c.id)) fail('api_secret_unavailable');
      const updated = [...connections.filter(v => v.id !== c.id), c];
      if (updated.length > 128) fail('api_config_limit');
      atomicJson(join(directory, 'connections.json'), { version: 1, connections: updated });
      committed = true;
      if (old?.auth.kind === 'secret' && c.auth.kind !== 'secret') { try { secretEntry(c.id).deletePassword(); } catch { fail('api_secret_cleanup_failed'); } }
      return { connections: updated };
    } catch (e) {
      if (changedSecret && !committed) try { if (previousToken) secretEntry(c.id).setPassword(previousToken); else secretEntry(c.id).deletePassword(); } catch { fail('api_secret_rollback_failed'); }
      throw e;
    }
  } finally { release!(); }
}
export function apiCatalog() {
  return readConnections().filter(c => c.enabled).flatMap(c => c.models.map(m => ({ provider_id: 'api-' + c.id, model_id: m.id, display_name: c.name + ' · ' + m.name, context_window: m.contextWindow, supports_tools: m.supportsTools, stream: c.stream, timeout_ms: c.timeoutMs, input_modalities: ['text'] })));
}

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';

const [engineArg, stateArg, runtimeArg, provider, preferredModel] = process.argv.slice(2);
if (!engineArg || !stateArg || !runtimeArg || !['openai', 'anthropic'].includes(provider)) throw new Error('pass engine, isolated state, native runtime, and provider');
const engine = realpathSync(engineArg);
const state = realpathSync(stateArg);
const live = resolve(homedir(), '.azrael-ex').toLowerCase();
if (state.toLowerCase() === live || state.toLowerCase().startsWith(live + sep)) throw new Error('live state is not a test fixture');
if (!statSync(engine).isFile() || !statSync(state).isDirectory() || !existsSync(join(state, 'copy-state-localized.json'))) throw new Error('test fixture is incomplete');
const runtime = JSON.parse(readFileSync(realpathSync(runtimeArg), 'utf8'));
if (runtime.schema !== 2 || !runtime.helpers) throw new Error('invalid native runtime manifest');

const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(AZRAEL_|OPENCODEX_HOME$)/i.test(key) || /^(OPENAI|CODEX|ANTHROPIC|AZURE_OPENAI)_(?!HOME$)/i.test(key) ||
      /(API[_-]?KEY|AUTH[_-]?TOKEN|ACCESS[_-]?TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)) delete env[key];
}
env.CODEX_HOME = state;
env.OPENCODEX_HOME = join(state, 'azrael', 'providers', 'opencodex');
env.AZRAEL_EX_MANAGEMENT_SOCKET = join(tmpdir(), `azo-${randomBytes(6).toString('hex')}`, 'm.sock');
for (const [name, field] of Object.entries({
  AZRAEL_PROVIDER_INFERENCE_HELPER: 'providerInferenceHelper',
  AZRAEL_PROVIDER_ACCOUNTS_HELPER: 'providerAccountsHelper',
  AZRAEL_PROVIDER_BUN: 'providerBun',
  AZRAEL_EX_DEVIN_EXECUTABLE: 'devinExecutable',
  AZRAEL_DEVIN_NATIVE_HELPER: 'devinNativeHelper',
  AZRAEL_DEVIN_NODE: 'nodeExecutable',
})) {
  const path = runtime.helpers[field];
  if (path && statSync(path).isFile()) env[name] = realpathSync(path);
}

const child = spawn(engine, ['app-server'], { cwd: state, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const startedAt = Date.now();
const pending = new Map();
const events = [];
let nextId = 0;
let stderrBytes = 0;
let completed = false;
let catalogEvidence = null;
const failPending = error => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); } pending.clear(); };
child.on('error', failPending);
child.on('exit', code => failPending(new Error(`engine_exit_${code ?? 'signal'}`)));
child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', line => {
  let frame;
  try { frame = JSON.parse(line); } catch { failPending(new Error('invalid_json')); return; }
  if (frame.id !== undefined && frame.method) {
    child.stdin.write(JSON.stringify({ id: frame.id, error: { code: -32601, message: 'Live validation does not execute tools' } }) + '\n');
  } else if (frame.id !== undefined) {
    const entry = pending.get(frame.id); if (!entry) return;
    pending.delete(frame.id);
    clearTimeout(entry.timer);
    frame.error ? entry.reject(new Error(String(frame.error.message ?? 'request_failed'))) : entry.resolve(frame.result);
  } else {
    events.push(frame);
    if (events.length > 10000) events.shift();
  }
});
const deadline = Date.now() + 180000;
const request = (method, params) => new Promise((resolveRequest, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}_timeout`)); }, 60000);
  pending.set(id, { resolve: resolveRequest, reject, timer });
  child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
});
const waitTurn = async (threadId, turnId) => {
  while (Date.now() < deadline) {
    const event = events.find(frame => frame.method === 'turn/completed' && frame.params?.threadId === threadId && frame.params?.turn?.id === turnId);
    if (event) return event.params.turn;
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error('turn_timeout');
};
const safeError = value => String(value ?? '')
  .replace(/Bearer\s+\S+|sk-[A-Za-z0-9_-]+|[A-Za-z0-9_-]{48,}/gi, '[redacted]')
  .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<id>')
  .replace(/[A-Za-z]:\\[^\s]+/g, '<path>')
  .slice(0, 240);

try {
  const init = await request('initialize', { clientInfo: { name: 'az01-live-provider-check', version: '1.0.0' }, capabilities: { experimentalApi: true } });
  if (!init) throw new Error('initialize_empty');
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  const models = [];
  const providerCatalogs = [];
  let cursor = null;
  const seenCursors = new Set();
  for (let page = 0; page < 100; page++) {
    const catalog = await request('model/list', { includeHidden: true, ...(page === 0 ? { refresh: true } : { cursor }), limit: 100 });
    if (!Array.isArray(catalog?.data)) throw new Error('invalid_model_catalog');
    models.push(...catalog.data);
    providerCatalogs.push(...(catalog.providerCatalogs ?? []));
    if (models.length > 10000) throw new Error('model_catalog_limit');
    if (!catalog.nextCursor) { cursor = null; break; }
    if (seenCursors.has(catalog.nextCursor)) throw new Error('model_catalog_cursor_repeat');
    seenCursors.add(catalog.nextCursor);
    cursor = catalog.nextCursor;
  }
  if (cursor) throw new Error('model_catalog_page_limit');
  catalogEvidence = {
    modelCount: models.length,
    anthropicCandidateIds: models.map(entry => entry.id).filter(id => typeof id === 'string' && /anthropic|claude/i.test(id)).slice(0, 20),
    providerCatalogs: providerCatalogs.map(row => ({ providerId: row.providerId, state: row.state ?? row.status })).slice(0, 20),
  };
  const model = provider === 'openai'
    ? models.find(entry => entry.id === (preferredModel ?? 'gpt-6-astra'))
    : models.find(entry => typeof entry.id === 'string' && entry.id.startsWith('managed/anthropic/'));
  if (!model) throw new Error('provider_model_unavailable');
  const thread = await request('thread/start', { model: model.id, cwd: state, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: false });
  const marker = 'AZ01_VALIDATION_OK';
  const turn = await request('turn/start', { threadId: thread.thread.id, model: model.id, input: [{ type: 'text', text: `Reply with exactly ${marker}. Do not call any tools.`, text_elements: [] }] });
  const ended = await waitTurn(thread.thread.id, turn.turn.id);
  const reply = events.filter(frame => frame.method === 'item/completed' && frame.params?.threadId === thread.thread.id && frame.params?.item?.type === 'agentMessage').map(frame => frame.params.item.text).join('\n');
  const ok = ended.status === 'completed' && reply.includes(marker);
  completed = true;
  process.stdout.write(JSON.stringify({ status: ok ? 'passed' : 'failed', provider, model: model.id, turnStatus: ended.status, markerFound: reply.includes(marker), ...(ok ? {} : { turnError: safeError(ended.error?.message ?? ended.error) }), elapsedMs: Date.now() - startedAt, stderrBytes }) + '\n');
  if (!ok) process.exitCode = 1;
} catch (error) {
  const message = String(error?.message ?? error);
  const reason = /auth|token|credential|login/i.test(message) ? 'authentication' : /rate|quota|limit/i.test(message) ? 'usage_limit' : /timeout/i.test(message) ? 'timeout' : /model/i.test(message) ? 'model_unavailable' : 'request_failed';
  process.stdout.write(JSON.stringify({ status: 'failed', provider, reason, ...(catalogEvidence ? { catalogEvidence } : {}), elapsedMs: Date.now() - startedAt, stderrBytes }) + '\n');
  process.exitCode = 1;
} finally {
  child.stdin.end();
  child.kill();
}

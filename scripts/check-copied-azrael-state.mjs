import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';

// AZ-01: run only against a pre-existing, isolated COPY of CODEX_HOME.
// Request shapes follow generated v2 ThreadList/Read/Resume/QueueList/ItemsListParams.
const [engineArg, copyArg, runtimeArg] = process.argv.slice(2);
const report = { status: 'failed', counts: { pages: 0, threads: 0, sampled: 0, metadataRead: 0, resumed: 0, childReadOnly: 0, unsupportedHistoricalProviders: 0, listedSubagents: 0, sampledSubagents: 0, subagents: 0, queueItems: 0, compactions: 0, providers: {}, sampledProviders: {} }, limits: { pageSize: 50, maxPages: 40, maxSamples: 40, maxItemPagesPerSample: 4, maxQueuePagesPerSample: 4, timeMs: 600000 }, failures: [], incomplete: [] };
let child;
let stderr = '';
let phase = 'preflight';
const failed = (category, detail) => report.failures.push({ phase, category, ...(detail ? { detail } : {}) });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const sqliteCode = value => {
  const text = String(value);
  if (/failed to initialize (?:sqlite )?state runtime/i.test(text)) return 'SQLITE_STARTUP_UNRESOLVED';
  return text.match(/\bSQLITE_[A-Z0-9_]+\b/)?.[0]
    ?? ([
      ['database disk image is malformed', 'SQLITE_CORRUPT'],
      ['database is locked', 'SQLITE_BUSY'],
      ['unable to open database file', 'SQLITE_CANTOPEN'],
      ['no such table', 'SQLITE_MISSING_TABLE'],
      ['database schema has changed', 'SQLITE_SCHEMA'],
    ].find(([phrase]) => text.toLowerCase().includes(phrase))?.[1]);
};
const classify = error => {
  const message = String(error?.message ?? error);
  const code = sqliteCode(message) ?? sqliteCode(stderr);
  if (code) return { category: 'sqlite', detail: code };
  if (Number.isInteger(error?.rpcCode)) return { category: 'rpc', detail: `JSON_RPC_${error.rpcCode}` };
  if (/timed out/i.test(message)) return { category: 'timeout' };
  if (/spawn|ENOENT|EACCES/i.test(message)) return { category: 'launch' };
  if (/exited|disconnected|closed/i.test(message)) return { category: 'server_exit' };
  if (/invalid|malformed|limit|shape/i.test(message)) return { category: 'protocol' };
  return { category: 'request_failed' };
};
const safeRpcMessage = error => String(error?.message ?? '')
  .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<id>')
  .replace(/[A-Za-z]:\\[^\s]+/g, '<path>')
  .replace(/"[^"]*"/g, '"<value>"')
  .slice(0, 200);
const cappedCursor = value => value === null || (typeof value === 'string' && value.length <= 4096);
const verifyPage = value => {
  if (!object(value) || !Array.isArray(value.data) || !cappedCursor(value.nextCursor)) throw new Error('invalid response shape');
  return value;
};

try {
  if (!engineArg || !copyArg || !isAbsolute(engineArg) || !isAbsolute(copyArg)) throw new Error('invalid absolute paths');
  const engine = realpathSync(engineArg);
  const copy = realpathSync(copyArg);
  if (!statSync(engine).isFile() || !statSync(copy).isDirectory()) throw new Error('invalid path types');
  const original = resolve(homedir(), '.azrael-ex');
  const lower = value => process.platform === 'win32' ? value.toLowerCase() : value;
  if (lower(copy) === lower(original) || lower(copy).startsWith(lower(original + sep)) || lower(original).startsWith(lower(copy + sep))) throw new Error('copy overlaps original state');
  const liveCodex = resolve(homedir(), '.codex');
  if (lower(copy) === lower(liveCodex) || lower(copy).startsWith(lower(liveCodex + sep)) || lower(liveCodex).startsWith(lower(copy + sep))) throw new Error('copy overlaps live Codex state');
  if (!existsSync(resolve(copy, 'sessions')) && !existsSync(resolve(copy, 'state_5.sqlite')) && !existsSync(resolve(copy, 'config.toml'))) throw new Error('copy has no recognized state files');
  if (!existsSync(resolve(copy, 'copy-state-localized.json'))) throw new Error('copy rollout paths were not localized');
  const env = { ...process.env, CODEX_HOME: copy };
  for (const key of Object.keys(env)) {
    if (/^(AZRAEL_|OPENCODEX_HOME$)/i.test(key) ||
        /^(OPENAI|CODEX|ANTHROPIC|AZURE_OPENAI)_(?!HOME$)/i.test(key) ||
        /(API[_-]?KEY|AUTH[_-]?TOKEN|ACCESS[_-]?TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)) delete env[key];
  }
  env.AZRAEL_EX_MANAGEMENT_SOCKET = join(tmpdir(), `azo-${randomBytes(6).toString('hex')}`, 'm.sock');
  if (runtimeArg) {
    const runtime = JSON.parse(readFileSync(realpathSync(runtimeArg), 'utf8'));
    const helpers = runtime?.helpers;
    if (runtime?.schema !== 2 || !object(helpers)) throw new Error('invalid native runtime manifest');
    const bindings = {
      AZRAEL_PROVIDER_INFERENCE_HELPER: 'providerInferenceHelper',
      AZRAEL_PROVIDER_BUN: 'providerBun',
      AZRAEL_EX_DEVIN_EXECUTABLE: 'devinExecutable',
      AZRAEL_DEVIN_NATIVE_HELPER: 'devinNativeHelper',
      AZRAEL_DEVIN_NODE: 'nodeExecutable',
    };
    for (const [variable, name] of Object.entries(bindings)) {
      const path = helpers[name];
      if (path == null && name === 'devinExecutable') continue;
      if (typeof path !== 'string' || !isAbsolute(path) || !statSync(path).isFile()) throw new Error('invalid native runtime helper');
      env[variable] = realpathSync(path);
    }
  }
  // The copied config may contain account references. No model request is issued.
  child = spawn(engine, ['app-server'], { cwd: copy, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-8192); });
  const pending = new Map();
  let nextId = 0;
  let exited = false;
  let responseBytes = 0;
  const failPending = error => { exited = true; for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); } pending.clear(); };
  child.once('error', error => failPending(error));
  child.once('exit', code => failPending(new Error(`server exited (${typeof code === 'number' ? code : 'signal'})`)));
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  child.stdout.on('data', chunk => {
    responseBytes += chunk.length;
    if (responseBytes > 64 * 1024 * 1024) { failPending(new Error('response limit exceeded')); child.kill(); }
  });
  lines.on('line', line => {
    if (Buffer.byteLength(line) > 8 * 1024 * 1024) { failPending(new Error('response limit exceeded')); child.kill(); return; }
    let message;
    try { message = JSON.parse(line); } catch { failPending(new Error('invalid JSON')); child.kill(); return; }
    if (!object(message) || !own(message, 'id')) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error) {
      const error = new Error(typeof message.error.message === 'string' ? message.error.message : 'request failed');
      error.rpcCode = message.error.code;
      entry.reject(error);
    }
    else entry.resolve(message.result);
  });
  const deadline = Date.now() + report.limits.timeMs;
  const request = (method, params) => new Promise((resolveRequest, reject) => {
    if (exited || !child.stdin.writable) { reject(new Error('server disconnected')); return; }
    const remaining = Math.min(60000, deadline - Date.now());
    if (remaining <= 0) { reject(new Error('timed out')); return; }
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('timed out')); }, remaining);
    pending.set(id, { resolve: resolveRequest, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  phase = 'initialize';
  await request('initialize', { clientInfo: { name: 'az01-copied-state-check', version: '1.0.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  phase = 'thread/list';
  const allThreads = [];
  const seenCursors = new Set();
  let cursor = null;
  for (let pageNumber = 0; pageNumber < report.limits.maxPages; pageNumber++) {
    const page = verifyPage(await request('thread/list', { limit: report.limits.pageSize, cursor, modelProviders: [], sourceKinds: ['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'unknown'] }));
    report.counts.pages++;
    report.counts.threads += page.data.length;
    for (const thread of page.data) {
      if (!object(thread) || typeof thread.id !== 'string') throw new Error('invalid thread shape');
      if (thread.parentThreadId) { report.counts.subagents++; report.counts.listedSubagents++; }
      const provider = typeof thread.modelProvider === 'string' ? thread.modelProvider : 'unknown';
      report.counts.providers[provider] = (report.counts.providers[provider] ?? 0) + 1;
      allThreads.push(thread);
    }
    if (!page.nextCursor) { cursor = null; break; }
    if (seenCursors.has(page.nextCursor)) throw new Error('repeated cursor');
    seenCursors.add(page.nextCursor); cursor = page.nextCursor;
  }
  if (cursor) report.incomplete.push('thread_page_limit');
  const samples = [];
  const selected = new Set();
  const addSample = thread => {
    if (samples.length >= report.limits.maxSamples || selected.has(thread.id)) return;
    selected.add(thread.id); samples.push(thread);
  };
  for (const thread of allThreads.slice(0, 8)) addSample(thread);
  for (const provider of Object.keys(report.counts.providers)) {
    for (const thread of allThreads.filter(entry => (entry.modelProvider ?? 'unknown') === provider).slice(0, 5)) addSample(thread);
  }
  const childSamplesPath = resolve(copy, 'copy-state-child-samples.json');
  if (existsSync(childSamplesPath)) {
    const childSamples = JSON.parse(readFileSync(childSamplesPath, 'utf8'));
    if (!Array.isArray(childSamples)) throw new Error('invalid child sample inventory');
    const childProviders = [...new Set(childSamples.map(entry => entry.modelProvider ?? 'unknown'))];
    for (const provider of childProviders) {
      for (const child of childSamples.filter(entry => (entry.modelProvider ?? 'unknown') === provider).slice(0, 4)) {
        if (!object(child) || typeof child.id !== 'string' || typeof child.parentThreadId !== 'string') throw new Error('invalid child sample shape');
        const parent = allThreads.find(entry => entry.id === child.parentThreadId);
        if (parent) addSample(parent);
        addSample(child);
      }
    }
  }
  for (const thread of allThreads.filter(entry => entry.parentThreadId).slice(0, 4)) addSample(thread);
  for (let index = 0; index < allThreads.length && samples.length < report.limits.maxSamples; index += Math.max(1, Math.floor(allThreads.length / report.limits.maxSamples))) addSample(allThreads[index]);
  const resumedIds = new Set();
  for (const [sampleIndex, thread] of samples.entries()) {
    const threadId = thread.id;
    const provider = thread.modelProvider ?? 'unknown';
    if (thread.parentThreadId) report.counts.sampledSubagents++;
    report.counts.sampledProviders[provider] = (report.counts.sampledProviders[provider] ?? 0) + 1;
    report.counts.sampled++;
    phase = 'thread/read';
    try {
      const result = await request('thread/read', { threadId, includeTurns: false });
      if (!object(result?.thread) || result.thread.id !== threadId) throw new Error('invalid thread/read shape');
      report.counts.metadataRead++;
    } catch (error) { report.failures.push({ phase, ...classify(error), sampleIndex, diagnostic: safeRpcMessage(error) }); continue; }
    if (thread.parentThreadId) {
      report.counts.childReadOnly++;
      if (!resumedIds.has(thread.parentThreadId)) report.incomplete.push('child_parent_resume_not_verified');
      continue;
    }
    if (!['openai', 'devin', 'azrael-managed'].includes(provider)) {
      report.counts.unsupportedHistoricalProviders++;
      continue;
    }
    phase = 'thread/resume';
    try {
      const result = await request('thread/resume', { threadId, excludeTurns: true });
      if (!object(result?.thread) || result.thread.id !== threadId) throw new Error('invalid thread/resume shape');
      report.counts.resumed++;
      resumedIds.add(threadId);
    } catch (error) { report.failures.push({ phase, ...classify(error), sampleIndex, diagnostic: safeRpcMessage(error) }); continue; }
    for (const [method, maxPages] of [['thread/queue/list', report.limits.maxQueuePagesPerSample], ['thread/items/list', report.limits.maxItemPagesPerSample]]) {
      phase = method;
      let itemCursor = null;
      const visited = new Set();
      for (let index = 0; index < maxPages; index++) {
        try {
          const page = verifyPage(await request(method, { threadId, cursor: itemCursor, limit: report.limits.pageSize }));
          if (method === 'thread/queue/list') {
            report.counts.queueItems += page.data.length;
            for (const entry of page.data) if (entry?.kind === 'contextCompaction') report.counts.compactions++;
          } else for (const entry of page.data) {
            if (entry?.item?.type === 'contextCompaction') report.counts.compactions++;
            if (entry?.item?.type === 'collabAgentToolCall' || entry?.item?.type === 'subAgentActivity') report.counts.subagents++;
          }
          if (!page.nextCursor) { itemCursor = null; break; }
          if (visited.has(page.nextCursor)) throw new Error('repeated cursor');
          visited.add(page.nextCursor); itemCursor = page.nextCursor;
        } catch (error) { failed(...Object.values(classify(error))); itemCursor = null; break; }
      }
      if (itemCursor) report.incomplete.push(method === 'thread/queue/list' ? 'queue_page_limit' : 'item_page_limit');
    }
  }
  if (report.counts.threads > report.counts.sampled) report.incomplete.push('thread_sample_limit');
  if (report.counts.unsupportedHistoricalProviders) report.incomplete.push('unsupported_historical_provider_resume');
  report.status = report.failures.length ? 'failed' : report.incomplete.length ? 'partial' : 'passed';
} catch (error) {
  failed(...Object.values(classify(error)));
} finally {
  if (child) { child.stdin.end(); child.kill(); }
  // Deliberately omit paths, thread IDs, prompts, tokens, and raw server errors.
  process.stdout.write(JSON.stringify(report) + '\n');
  if (report.status !== 'passed') process.exitCode = 1;
}

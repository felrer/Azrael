import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { access, copyFile, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { appendFileSync } from 'node:fs';
import { startFixture, thoughtSignature, echoIdentity } from './managed-native-api-fixture.mjs';

assert(process.argv[2] && isAbsolute(process.argv[2]), 'absolute_engine_executable_required');
assert(process.argv[3] && isAbsolute(process.argv[3]), 'absolute_new_fixture_root_required');
const engine = process.argv[2], run = process.argv[3];
const managedOnly = process.argv.includes('--managed-only');
const devinHandoffOnly = process.argv.includes('--devin-handoff-only');
const claudeOnly = process.argv.includes('--claude-only') || devinHandoffOnly;
assert(!(managedOnly && claudeOnly), 'fixture_modes_are_exclusive');
const root = resolve(import.meta.dirname, '..');
const releaseOption = process.argv.indexOf('--release-directory');
const release = releaseOption < 0 ? null : process.argv[releaseOption + 1];
if (releaseOption >= 0) assert(release && isAbsolute(release), 'absolute_release_directory_required');
const bundle = release ? createRequire(import.meta.url)('./provider-accounts-host.cjs').readBundle(release, true) : null;
const bun = bundle?.bun ?? join(root, 'artifacts/tools/bun-1.4.2/package/bin/bun.exe');
const helper = bundle?.inferenceHelper ?? join(root, 'providers/opencodex/inference.ts');
await Promise.all([access(engine), access(bun), access(helper)]);
await mkdir(run); // Refuse to overwrite or reuse an earlier run or ordinary state.
const state = join(run, 'codex'), ocx = join(state, 'azrael', 'providers', 'opencodex'), cwd = join(run, 'work');
await Promise.all([state, ocx, cwd, join(run, 'temp'), join(run, 'appdata')].map(path => mkdir(path, { recursive: true })));
const keys = ['synthetic-managed-google-key', 'synthetic-managed-xai-key', 'synthetic-managed-openrouter-key'];
keys.push('synthetic-native-openai-key');
keys.push('synthetic-managed-devin-key');
if (claudeOnly) keys.push('synthetic-managed-anthropic-oauth-access', 'synthetic-managed-anthropic-oauth-refresh');
const rawModels = claudeOnly ? ['claude-sonnet-4-6'] : ['gemini-3-flash-preview', 'grok-4', 'fixture/model-with-slash'];
const providers = claudeOnly ? ['anthropic'] : ['google', 'xai', 'openrouter'];
const devinAccountId = '10000000000000000000000000000001';
const models = providers.map((provider, i) => `managed/${provider}/${rawModels[i]}`);
const report = { scope: claudeOnly ? 'subscription Claude OAuth and native OpenAI loopback boundary' : 'legacy key-provider native fixture', checks: [], status: 'failed' };
report.helperScope = bundle ? 'verified-packaged-helper' : 'source-helper';
if (!claudeOnly) report.legacy = 'Retired Google AI Studio, xAI, and OpenRouter key routes are still asserted by this mode; use --claude-only for the subscription release.';
if (managedOnly) report.pendingChecks = ['native_openai_managed_openai_boundary_requires_rebuilt_restore_fix'];
const timeout = 90_000;
let peer, generation = 0, sequence = 0;
const peers = [], histories = [];
const fixture = await startFixture();
const wrapper = join(run, 'managed-inference-wrapper.ts');
const wrapperSource = `import assert from 'node:assert/strict';
import { runCli, catalog } from ${JSON.stringify(pathToFileURL(helper).href)};
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
const tracePath = ${JSON.stringify(join(run, 'catalog-invocations.jsonl'))};
const catalogModePath = ${JSON.stringify(join(run, 'catalog-mode.txt'))};
const trace = (event) => appendFileSync(tracePath, JSON.stringify({ at: Date.now(), pid: process.pid, ppid: process.ppid, ...event }) + '\\n');
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
// Bun fetch owns the loopback connection. Any fallback to Node's pinned
// transport must fail closed rather than reaching a real provider.
const blockedTransport = () => { throw new Error('fixture_node_transport_rejected'); };
for (const module of [http, https]) { module.request = blockedTransport; module.get = blockedTransport; }
for (const module of [net, tls]) { module.connect = blockedTransport; module.createConnection = blockedTransport; }
const local = new URL(${JSON.stringify(fixture.baseUrl)});
function mapUrl(raw) {
  const url = new URL(raw);
  if (url.username || url.password) throw new Error('fixture_fetch_credentials_rejected');
  if (url.origin === local.origin && (/^\\/(google|xai|openrouter)\\//.test(url.pathname) || (url.pathname === '/anthropic/v1/messages' && !url.search))) return url.href;
  const allowed = [
    ['https://generativelanguage.googleapis.com', '/v1beta/', 'google'],
    ['https://api.x.ai', '/v1/', 'xai'],
    ['https://openrouter.ai', '/api/v1/', 'openrouter'],
    ['https://api.anthropic.com', '/v1/messages', 'anthropic'],
  ].find(([origin, prefix]) => url.origin === origin && url.pathname.startsWith(prefix));
  if (!allowed || (allowed[2] === 'anthropic' && (url.pathname !== '/v1/messages' || url.search))) throw new Error('fixture_fetch_destination_rejected');
  return local.origin + '/' + allowed[2] + url.pathname + url.search;
}
function guardedFetch(fetcher) {
  return (input, init) => {
    const request = new Request(input, init);
    const mapped = new Request(mapUrl(request.url), request);
    if (request.method === 'GET') trace({ kind: 'get', path: new URL(mapped.url).pathname });
    return fetcher(mapped, { redirect: 'error' });
  };
}
if (process.argv.includes('--guard-check')) {
  for (const module of [http, https]) { assert.throws(() => module.request('https://openrouter.ai/')); assert.throws(() => module.get('https://openrouter.ai/')); }
  for (const module of [net, tls]) assert.throws(() => module.connect(443, 'openrouter.ai'));
  for (const [url, path] of [
    ['https://generativelanguage.googleapis.com/v1beta/models/test:streamGenerateContent?alt=sse', '/google/v1beta/models/test:streamGenerateContent?alt=sse'],
    ['https://api.x.ai/v1/chat/completions', '/xai/v1/chat/completions'],
    ['https://openrouter.ai/api/v1/chat/completions', '/openrouter/api/v1/chat/completions'],
    ['https://api.anthropic.com/v1/messages', '/anthropic/v1/messages'],
  ]) assert.equal(mapUrl(url), local.origin + path);
  for (const url of ['https://example.com/', 'https://api.x.ai.evil.invalid/v1/test', 'https://api.x.ai/elsewhere', 'http://api.x.ai/v1/test', 'file:///tmp/test', 'http://127.0.0.1:1/google/test', 'https://user@api.x.ai/v1/test', 'https://api.anthropic.com/v1/messages/extra', 'https://api.anthropic.com/v1/messages?extra=1', 'http://api.anthropic.com/v1/messages', 'https://user@api.anthropic.com/v1/messages']) assert.throws(() => mapUrl(url));
  assert.equal(mapUrl(local.origin + '/google/test'), local.origin + '/google/test');
  const controller = new AbortController();
  await guardedFetch(async (request, init) => {
    assert.equal(request.url, local.origin + '/xai/v1/chat/completions');
    assert.equal(request.method, 'POST'); assert.equal(request.headers.get('x-fixture'), 'guard');
    assert.equal(await request.text(), 'synthetic-body'); assert.equal(init.redirect, 'error');
    controller.abort(); assert(request.signal.aborted);
    return new Response('guard-ok');
  })('https://api.x.ai/v1/chat/completions', { method: 'POST', body: 'synthetic-body', headers: { 'x-fixture': 'guard' }, signal: controller.signal });
  console.log('guard_passed');
} else {
  globalThis.fetch = guardedFetch(globalThis.fetch.bind(globalThis));
  if (process.argv.includes('--catalog')) {
    trace({ kind: 'catalog-start', refresh: process.argv.includes('--refresh'), argv: process.argv.slice(2) });
    const mode = existsSync(catalogModePath) ? readFileSync(catalogModePath, 'utf8') : '';
    process.stdout.write((mode === 'empty' ? JSON.stringify({ models: [], provider_statuses: [] }) : mode === 'failure' ? 'invalid fixture catalog' : JSON.stringify(await catalog({ refresh: process.argv.includes('--refresh'), fetch: globalThis.fetch }))) + '\\n');
    trace({ kind: 'catalog-end' });
  }
  else await runCli();
}
`;
async function prepareWrapper() {
  await writeFile(wrapper, wrapperSource);
  const guard = spawn(bun, [wrapper, '--guard-check'], { cwd, env: { ...process.env, OPENCODEX_HOME: ocx, CODEX_HOME: state }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  guard.stdout.on('data', value => { output += value; }); guard.stderr.on('data', value => { output += value; });
  const code = await new Promise((resolve, reject) => { guard.once('error', reject); guard.once('exit', resolve); });
  await writeFile(join(run, 'fetch-guard.log'), output);
  assert.equal(code, 0, 'guard_unit_checks_failed');
  assert(output.includes('guard_passed'), 'guard_unit_checks_not_executed');
  report.checks.push('fixture_fetch_whitelist_mapping_body_headers_signal_redirect_guards');
}

class Peer {
  constructor(child) {
    this.child = child; this.next = 0; this.pending = new Map(); this.events = []; this.waiters = []; this.calls = []; this.stderr = '';
    createInterface({ input: child.stdout }).on('line', line => {
      let value; try { value = JSON.parse(line); } catch { return; }
      if (value.id !== undefined && value.method) {
        if (value.method !== 'item/tool/call') { this.protocolError = `unexpected_server_request:${value.method}`; child.stdin.write(JSON.stringify({ id: value.id, error: { code: -32601, message: this.protocolError } }) + '\n'); return; }
        this.calls.push(value.params);
        const valid = value.params.namespace === 'namespace_b' && value.params.tool === 'echo';
        let args = value.params.arguments;
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
        const text = valid ? `ROUNDTRIP:${args?.value}` : 'WRONG_NAMESPACE';
        const respond = () => child.stdin.write(JSON.stringify({ id: value.id, result: { success: valid, contentItems: [{ type: 'inputText', text }] } }) + '\n');
        if (this.beforeToolResult) {
          const hook = this.beforeToolResult; this.beforeToolResult = null;
          Promise.resolve().then(hook).then(respond).catch(error => { this.protocolError = error.message; respond(); });
        } else respond();
      } else if (value.id !== undefined) {
        const pending = this.pending.get(value.id); if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(value.id);
        value.error ? pending.reject(new Error(JSON.stringify(value.error))) : pending.resolve(value.result);
      } else {
        this.events.push(value);
        for (const waiter of [...this.waiters]) if (waiter.predicate(value)) { clearTimeout(waiter.timer); this.waiters.splice(this.waiters.indexOf(waiter), 1); waiter.resolve(value.params); }
      }
    });
    child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-128000); });
    const fail = error => { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pending.clear(); };
    child.on('error', fail); child.on('exit', code => fail(new Error(`engine_exit:${code}`)));
  }
  request(method, params) {
    return new Promise((resolve, reject) => { const id = ++this.next;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout:${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      appendFileSync(join(run, 'client-requests.jsonl'), JSON.stringify({ at: Date.now(), enginePid: this.child.pid, id, method }) + '\n');
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
  }
  wait(predicate) {
    const event = this.events.find(predicate); if (event) return Promise.resolve(event.params);
    return new Promise((resolve, reject) => { const waiter = { predicate, resolve,
      timer: setTimeout(() => { this.waiters.splice(this.waiters.indexOf(waiter), 1); reject(new Error('notification_timeout')); }, timeout) }; this.waiters.push(waiter); });
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters) clearTimeout(waiter.timer);
    this.child.stdin.end();
    await new Promise(resolve => { const timer = setTimeout(() => { this.child.kill(); resolve(); }, 5000);
      this.child.once('exit', () => { clearTimeout(timer); resolve(); }); if (this.child.exitCode !== null || this.child.signalCode !== null) { clearTimeout(timer); resolve(); } });
  }
}
const dynamicTools = ['namespace_a', 'namespace_b'].map(name => ({ type: 'namespace', name, description: 'Managed native acceptance fixture',
  tools: [{ type: 'function', name: 'echo', description: name === 'namespace_b' ? `${echoIdentity}: Echo the supplied turn marker` : 'Echo the supplied turn marker', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } }] }));
async function start() {
  generation++;
  const env = { ...process.env, CODEX_HOME: state, OPENCODEX_HOME: ocx, AZRAEL_PROVIDER_INFERENCE_HELPER: wrapper, AZRAEL_PROVIDER_BUN: bun,
    APPDATA: join(run, 'appdata'), TEMP: join(run, 'temp'), TMP: join(run, 'temp'), AZRAEL_EX_PLAINTEXT_AGENTS: '1', RUST_LOG: 'codex_core::managed=info' };
  for (const key of Object.keys(env)) if (/API_KEY|ACCESS_TOKEN|AUTH_TOKEN|^OPENAI_BASE_URL$|^AZRAEL_EX_MANAGEMENT_SOCKET$|^AZRAEL_EX_INSTANCE_ID$|^(HTTP|HTTPS|ALL)_PROXY$/i.test(key)) delete env[key];
  for (const key of ['AZRAEL_DEVIN_NATIVE_HELPER', 'AZRAEL_DEVIN_NODE', 'AZRAEL_EX_DEVIN_EXECUTABLE', 'AZRAEL_PROVIDER_ACCOUNTS_HELPER']) delete env[key];
  env.OPENAI_API_KEY = keys[3];
  env.AZRAEL_PROVIDER_ACCOUNTS_HELPER = bundle?.helper ?? join(root, 'providers/opencodex/helper.ts');
  env.AZRAEL_DEVIN_NATIVE_HELPER = join(root, 'scripts/managed-devin-boundary-fixture.mjs');
  env.AZRAEL_DEVIN_NODE = process.execPath;
  env.AZRAEL_EX_DEVIN_EXECUTABLE = process.execPath;
  env.AZRAEL_MANAGED_DEVIN_TRACE = join(run, 'devin-requests.jsonl');
  if (devinHandoffOnly) env.AZRAEL_MANAGED_DEVIN_CONTROL = join(run, 'devin-handoff-control.txt');
  env.NO_PROXY = '127.0.0.1,localhost';
  const child = spawn(engine, ['-c', 'features.code_mode=false', '-c', 'features.plugins=false', '-c', 'web_search="disabled"', 'app-server'],
    { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  await writeFile(join(run, `engine-${generation}.json`), JSON.stringify({ generation, pid: child.pid }));
  peer = new Peer(child); peers.push(peer);
  await peer.request('initialize', { clientInfo: { name: 'managed_native_checker', version: '1' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  const catalog = await peer.request('model/list', { includeHidden: true });
  await writeFile(join(run, `catalog-${generation}.json`), JSON.stringify(catalog, null, 2));
  const catalogText = JSON.stringify(catalog);
  if (claudeOnly) {
    assert(catalogText.includes(models[0]), 'missing_claude_oauth_catalog_model');
    for (const provider of ['google', 'xai', 'openrouter']) assert(!catalogText.includes(`managed/${provider}/`), `retired_key_model_visible:${provider}`);
    assert.equal(fixture.controls.catalogRequests, 0, 'retired_openrouter_catalog_must_not_fetch');
    report.checks.push('claude_oauth_catalog_excludes_retired_key_routes_without_fetch');
    return;
  }
  assert(fixture.controls.catalogRequests > 0, 'catalog_discovery_must_hit_loopback_fixture');
  for (const model of models) assert(catalogText.includes(model), `missing_managed_catalog_model:${model}`);
  assert(catalogText.includes('devin/swe-2-high'), 'missing_native_devin_catalog_model');
  const providerStatus = catalog.providerCatalogs.find(row => row.providerId === 'openrouter');
  assert.equal(providerStatus.state, 'ready');
  assert.equal(providerStatus.modelCount, 151);
  assert.equal(typeof providerStatus.observedAt, 'number');
  // App-server starts a separate Online refresh worker immediately. Observe its
  // helper completion before measuring the explicit request's discovery count.
  const startupDeadline = Date.now() + timeout;
  let startupSettled = false;
  while (Date.now() < startupDeadline) {
    const rows = (await readFile(join(run, 'catalog-invocations.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const startup = rows.find(row => row.ppid === child.pid && row.kind === 'catalog-start' && row.refresh);
    if (startup && rows.some(row => row.pid === startup.pid && row.kind === 'catalog-end')) { startupSettled = true; break; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert(startupSettled, 'background_startup_catalog_refresh_must_complete');
  const pages = [], cursors = new Set();
  let cursor = null;
  const discoveryBefore = fixture.controls.catalogRequests;
  const pageTrace = [];
  do {
    const before = fixture.controls.catalogRequests;
    const page = await peer.request('model/list', { includeHidden: true, limit: 100, cursor, ...(cursor === null ? { refresh: true } : {}) });
    pageTrace.push({ at: Date.now(), cursor, before, after: fixture.controls.catalogRequests, count: page.data.length, nextCursor: page.nextCursor });
    await writeFile(join(run, `catalog-pages-${generation}.json`), JSON.stringify({ discoveryBefore, pages: pageTrace }, null, 2));
    pages.push(...page.data);
    cursor = page.nextCursor;
    if (cursor !== null) { assert(!cursors.has(cursor), 'catalog_cursor_must_advance'); cursors.add(cursor); }
  } while (cursor !== null);
  assert(cursors.size > 0, 'large_catalog_requires_multiple_pages');
  assert.equal(new Set(pages.map(model => model.model)).size, pages.length, 'catalog_pages_are_unique');
  assert.deepEqual(pages.map(model => model.model), catalog.data.map(model => model.model), 'catalog_pages_are_complete');
  assert.equal(fixture.controls.catalogRequests, discoveryBefore + 1, 'refresh_fetches_once_continuations_reuse_snapshot');
  report.checks.push(`catalog_${generation}:remote_discovery_status_refresh_and_all_pages`);
}
async function turn(threadId, modelIndex, recall = false) {
  const marker = `NATIVE_MANAGED_TURN_${++sequence}`;
  const offset = peer.events.length, calls = peer.calls.length, requestOffset = fixture.requests.length;
  const started = await peer.request('turn/start', { threadId, model: models[modelIndex], input: [{ type: 'text', text: `${marker}: Call namespace_b.echo with value ${marker}, then report its result.${recall ? ' RETAIN_EARLIER_RESULT: Also recall the exact first turn tool result from the compacted summary.' : ''}`, text_elements: [] }] });
  const end = await peer.wait(event => event.method === 'turn/completed' && event.params.threadId === threadId && event.params.turn.id === started.turn.id);
  assert.equal(end.turn.status, 'completed', JSON.stringify(end.turn.error));
  assert.equal(peer.calls.length - calls, 1, 'exactly_one_dynamic_call_per_turn');
  assert.equal(peer.calls.at(-1).namespace, 'namespace_b');
  assert.equal(peer.calls.at(-1).tool, 'echo');
  assert(!peer.protocolError, peer.protocolError);
  const messages = peer.events.slice(offset).filter(event => event.method === 'item/completed' && event.params.item?.type === 'agentMessage').map(event => event.params.item.text).join('\n');
  assert(messages.includes(`VERIFIED:${marker}:ROUNDTRIP:${marker}`), 'agent_final_has_tool_result');
  if (recall) assert(messages.includes('RECALLED:ROUNDTRIP:NATIVE_MANAGED_TURN_1'), 'compacted_summary_semantically_preserves_earlier_result');
  const allRequests = fixture.requests.slice(requestOffset);
  const requests = allRequests.filter(request => !request.handoff);
  for (const request of allRequests.filter(request => request.handoff)) {
    assert.notEqual(request.provider, providers[modelIndex], 'handoff_uses_original_provider');
    assert(!(request.body.tools?.length), 'handoff_has_no_tools');
  }
  assert.equal(requests.length, 2, 'one_tool_and_one_final_provider_request');
  assert(requests.every(request => request.provider === providers[modelIndex] && request.sequence === sequence), 'per_turn_provider_routing');
  assert.deepEqual(requests.map(request => request.final), [false, true]);
  const replay = JSON.stringify(requests[0].body);
  for (let i = 1; i < sequence; i++) assert(replay.includes(`ROUNDTRIP:NATIVE_MANAGED_TURN_${i}`), `provider_replay_retains_result_${i}`);
  report.checks.push(`turn_${sequence}:${models[modelIndex]}:tool_roundtrip`);
}
async function history(threadId, label) {
  const result = await peer.request('thread/read', { threadId, includeTurns: true });
  histories.push(result); await writeFile(join(run, `history-${label}.json`), JSON.stringify(result, null, 2));
  return JSON.stringify(result);
}
async function boundaryTurn(threadId, model, marker) {
  const offset = peer.events.length, calls = peer.calls.length;
  const started = await peer.request('turn/start', { threadId, model, input: [{ type: 'text', text: `${marker}: Call namespace_b.echo with value ${marker}, then report its result.`, text_elements: [] }] });
  const end = await peer.wait(event => event.method === 'turn/completed' && event.params.threadId === threadId && event.params.turn.id === started.turn.id);
  assert.equal(end.turn.status, 'completed', JSON.stringify(end.turn.error));
  assert.equal(peer.calls.length - calls, 1);
  const text = peer.events.slice(offset).filter(event => event.method === 'item/completed' && event.params.item?.type === 'agentMessage').map(event => event.params.item.text).join('\n');
  assert(text.includes(`VERIFIED:${marker}:ROUNDTRIP:${marker}`));
}
async function checkTranscripts() {
  const artifacts = [...histories, ...peers.map(value => value.events), fixture.requests];
  const text = JSON.stringify(artifacts);
  for (const key of keys) assert(!text.includes(key), 'secret_in_transcript');
  for (const value of peers) for (const key of keys) assert(!value.stderr.includes(key), 'secret_in_engine_log');
  // Rollouts are durable native transcripts, including hidden provider metadata.
  async function scan(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (entry.name.endsWith('.jsonl')) {
        const contents = await readFile(path, 'utf8');
        for (const key of keys) assert(!contents.includes(key), 'secret_in_rollout');
      }
    }
  }
  await scan(state);
}
try {
  await prepareWrapper(); // Guard checks make no fetch calls and precede engine startup.
  await mkdir(join(run, 'appdata', 'devin'), { recursive: true });
  await mkdir(join(state, 'azrael', 'devin'), { recursive: true });
  await writeFile(join(run, 'appdata', 'devin', 'credentials.toml'), `windsurf_api_key = ${JSON.stringify(keys[4])}\napi_server_url = "https://server.codeium.com"\n`);
  await writeFile(join(ocx, 'auth.json'), JSON.stringify({ ...(claudeOnly ? { anthropic: { activeAccountId: 'a1b2c3d4', accounts: [{ id: 'a1b2c3d4',
    credential: { access: keys[5], refresh: keys[6], expires: Number.MAX_SAFE_INTEGER, accountId: 'synthetic-claude-person', source: 'oauth' }, addedAt: 1 }], selectionRevision: '00000000-0000-4000-8000-000000000002' } } : {}), devin: { activeAccountId: devinAccountId, accounts: [{ id: devinAccountId,
    credential: { access: keys[4], refresh: keys[4], expires: Number.MAX_SAFE_INTEGER, accountId: 'managed-devin-fixture', source: 'oauth', apiBaseUrl: 'https://server.codeium.com' }, addedAt: 1 }],
    selectionRevision: '00000000-0000-4000-8000-000000000001' } }, null, 2));
  const families = { families: [{ family_label: 'SWE-2', family_uid: 'swe-2', slug: 'swe-2', aliases: [], variants: [{ model_uid: 'swe-2-high', label: 'SWE-2 High', max_context_tokens: 200000, max_output_tokens: 16000 }] }] };
  await writeFile(join(state, 'azrael', 'devin', 'models.json'), JSON.stringify(families));
  await copyFile(join(root, 'upstream/codex/codex-rs/models-manager/models.json'), join(state, 'azrael', 'devin', 'catalog.json'));
  await writeFile(join(cwd, 'models'), `process.stdout.write(${JSON.stringify(JSON.stringify(families))});`);
  await writeFile(join(cwd, 'auth'), 'process.stdout.write("Logged in (via Devin).\\nEmail: managed-boundary@fixture.invalid\\nPlan: test\\n");');
  const configured = claudeOnly ? [
    ['google', 'gemini-3-flash-preview', keys[0]], ['xai', 'grok-4', keys[1]], ['openrouter', 'fixture/model-with-slash', keys[2]],
    ['anthropic', rawModels[0], null],
  ] : providers.map((provider, i) => [provider, rawModels[i], keys[i]]);
  await writeFile(join(ocx, 'config.json'), JSON.stringify({ port: 0, providers: Object.fromEntries(configured.map(([provider, model, key]) => [provider,
    { adapter: provider === 'anthropic' ? 'anthropic' : provider === 'google' ? 'google' : 'openai-chat', baseUrl: provider === 'anthropic' ? 'https://api.anthropic.com' : `${fixture.baseUrl}/${provider}`, ...(key ? { apiKey: key } : {}), authMode: provider === 'anthropic' ? 'oauth' : 'key',
      allowPrivateNetwork: true, models: [model], defaultModel: model, codexToolMode: 'shell', defaultAliases: false }])),
    defaultProvider: claudeOnly ? 'anthropic' : 'google', defaultAliases: false }, null, 2));
  await writeFile(join(state, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: keys[3], tokens: null, last_refresh: null }));
  await writeFile(join(state, 'config.toml'), `model = ${JSON.stringify(models[0])}\nmodel_provider = "fixture_openai"\ncli_auth_credentials_store = "file"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n[model_providers.fixture_openai]\nname = "Loopback native OpenAI fixture"\nbase_url = ${JSON.stringify(`${fixture.baseUrl}/openai`)}\nwire_api = "responses"\nrequires_openai_auth = true\n[features]\nplugins = false\nresponses_websockets = false\n`);
  await start();
  if (devinHandoffOnly) {
    report.scope = 'Devin source handoff exhaustion and OpenAI loopback transitions';
    for (const scenario of [
      { name: 'same-thread-summary', control: '', fork: false },
      { name: 'fork-summary', control: '', fork: true },
      { name: 'same-thread-quota', control: 'quota', fork: false },
      { name: 'fork-quota', control: 'quota', fork: true },
      { name: 'resumed-fork-quota', control: 'quota', fork: true, restart: true },
      { name: 'fork-generic-400', control: 'http', fork: true },
      { name: 'fork-rate-limit', control: 'rate', fork: true },
    ]) {
      await writeFile(join(run, 'devin-handoff-control.txt'), '');
      const source = await peer.request('thread/start', { model: 'devin/swe-2-high', cwd, approvalPolicy: 'never', sandbox: 'danger-full-access', ephemeral: false, dynamicTools });
      await boundaryTurn(source.thread.id, 'devin/swe-2-high', 'DEVIN_BOUNDARY_START');
      const target = scenario.fork ? (await peer.request('thread/fork', { threadId: source.thread.id, model: 'gpt-5.2', cwd, dynamicTools })).thread.id : source.thread.id;
      if (scenario.restart) {
        await peer.close();
        await start();
        await peer.request('thread/resume', { threadId: target, cwd, model: 'gpt-5.2', dynamicTools });
      }
      await writeFile(join(run, 'devin-handoff-control.txt'), scenario.control);
      const offset = peer.events.length, before = fixture.requests.length, calls = peer.calls.length;
      const snapshot = await history(target, scenario.name + '-before');
      if (scenario.control === 'http' || scenario.control === 'rate') {
        const started = await peer.request('turn/start', { threadId: target, model: 'gpt-5.2', input: [{ type: 'text', text: 'OPENAI_BOUNDARY_END: continue', text_elements: [] }] });
        const ended = await peer.wait(event => event.method === 'turn/completed' && event.params.threadId === target && event.params.turn.id === started.turn.id);
        assert.equal(ended.turn.status, 'failed');
        assert.equal(fixture.requests.length, before, 'unrelated_error_must_not_call_target');
        assert.equal(peer.calls.length, calls, 'unrelated_error_must_not_replay_tools');
        assert(!JSON.stringify(peer.events.slice(offset)).includes('encrypted context was omitted'));
        assert((await history(target, scenario.name + '-failed')).includes('ROUNDTRIP:DEVIN_BOUNDARY_START'), 'failed_handoff_preserves_source_history');
        await writeFile(join(run, 'devin-handoff-control.txt'), 'quota');
        await boundaryTurn(target, 'gpt-5.2', 'OPENAI_BOUNDARY_END');
      } else {
        await boundaryTurn(target, 'gpt-5.2', 'OPENAI_BOUNDARY_END');
      }
      const requests = fixture.requests.slice(before).filter(r => r.provider === 'openai' && !r.handoff);
      assert.equal(requests.length, 2, 'only_target_tool_and_final_requests');
      const wire = JSON.stringify(requests);
      assert(wire.includes('ROUNDTRIP:DEVIN_BOUNDARY_START'), 'saved_source_tool_result_reaches_target');
      assert(!wire.includes('azrael-devin-v1') && !wire.includes('synthetic-devin-boundary-signature'), 'source_private_reasoning_excluded');
      if (scenario.control) {
        assert(!wire.includes('Synthetic public Devin reasoning'), 'quota_excludes_source_reasoning_items');
        const events = JSON.stringify(peer.events.slice(offset));
        assert(events.includes('devin usage') && events.includes('fixture_openai') && events.includes('encrypted context was omitted'), 'quota_warning_names_source_destination_and_loss');
      }
      assert(snapshot.includes('ROUNDTRIP:DEVIN_BOUNDARY_START'));
      report.checks.push(scenario.name);
    }
    assert.deepEqual(fixture.errors, []);
    await checkTranscripts();
    report.status = 'passed';
  } else if (claudeOnly) {
    const claudeThread = await peer.request('thread/start', { model: models[0], cwd, approvalPolicy: 'never', sandbox: 'danger-full-access', ephemeral: false, dynamicTools });
    await turn(claudeThread.thread.id, 0);
    await boundaryTurn(claudeThread.thread.id, 'gpt-5.2', 'OPENAI_BOUNDARY_START');
    await turn(claudeThread.thread.id, 0);
    const claudeRequests = fixture.requests.filter(request => request.provider === 'anthropic' && !request.handoff);
    assert.equal(claudeRequests.length, 4, 'claude_two_tool_and_final_roundtrips');
    assert(claudeRequests[0].body.system?.some(part => part.text?.length), 'claude_receives_shared_system_prompt');
    const sharedPrompt = claudeRequests[0].body.system;
    assert.deepEqual(claudeRequests[2].body.system, sharedPrompt, 'claude_preserves_system_prompt_across_openai_switch');
    assert(JSON.stringify(claudeRequests[2].body).includes('ROUNDTRIP:NATIVE_MANAGED_TURN_1'), 'claude_receives_earlier_tool_result');
    assert(JSON.stringify(claudeRequests[2].body).includes('ROUNDTRIP:OPENAI_BOUNDARY_START'), 'claude_receives_openai_public_history');
    const openaiRequests = fixture.requests.filter(request => request.provider === 'openai' && !request.handoff);
    assert.equal(openaiRequests.length, 2, 'openai_one_tool_and_final_roundtrip');
    assert(JSON.stringify(openaiRequests[0].body).includes('ROUNDTRIP:NATIVE_MANAGED_TURN_1'), 'openai_receives_claude_public_history');
    const claudeHistory = await history(claudeThread.thread.id, 'claude-openai-claude');
    for (const marker of ['NATIVE_MANAGED_TURN_1', 'OPENAI_BOUNDARY_START', 'NATIVE_MANAGED_TURN_2'])
      assert(claudeHistory.includes(`ROUNDTRIP:${marker}`), `claude_boundary_history_${marker}`);
    report.checks.push('claude_oauth_native_openai_claude_shared_prompt_history_and_tool_result');
    for (const model of ['managed/google/gemini-3-flash-preview', 'managed/xai/grok-4', 'managed/openrouter/fixture/model-with-slash']) {
      const keyRequests = fixture.requests.length;
      let keyRejected = false;
      try {
        const keyThread = await peer.request('thread/start', { model, cwd, approvalPolicy: 'never', sandbox: 'danger-full-access', ephemeral: false, dynamicTools });
        const attempted = await peer.request('turn/start', { threadId: keyThread.thread.id, model, input: [{ type: 'text', text: 'KEY_PROVIDER_MUST_REJECT', text_elements: [] }] });
        const ended = await peer.wait(event => event.method === 'turn/completed' && event.params.threadId === keyThread.thread.id && event.params.turn.id === attempted.turn.id);
        keyRejected = ended.turn.status === 'failed' && /provider_unavailable|unsupported|unavailable/i.test(JSON.stringify(ended.turn.error));
      } catch (error) { keyRejected = /provider_unavailable|unsupported|unavailable/i.test(error.message); }
      assert(keyRejected, `key_provider_must_reject:${model}`);
      assert.equal(fixture.requests.length, keyRequests, `key_provider_rejection_must_not_fetch:${model}`);
    }
    report.checks.push('configured_google_xai_openrouter_api_key_routes_rejected_without_network');
    assert.deepEqual(fixture.errors, []);
    await checkTranscripts(); report.checks.push('claude_no_secrets_in_requests_events_history_rollouts_or_logs');
    report.status = 'passed';
  } else {
  const started = await peer.request('thread/start', { model: models[0], cwd, approvalPolicy: 'never', sandbox: 'danger-full-access', ephemeral: false, dynamicTools });
  const id = started.thread.id;
  const route = [0, 1, 0, 2, 1, 2, 0]; // All six directed transitions; includes A -> B -> A.
  for (const index of route) await turn(id, index);
  const transitions = new Set(route.slice(1).map((value, i) => `${route[i]}>${value}`));
  assert.equal(transitions.size, 6);
  const before = await history(id, 'before-restart');
  for (let i = 1; i <= sequence; i++) assert(before.includes(`ROUNDTRIP:NATIVE_MANAGED_TURN_${i}`), 'history_retains_tool_results');
  report.checks.push('same_thread_all_six_directed_transitions_and_A_B_A');
  for (const mode of ['empty', 'failure']) {
    peer.beforeToolResult = async () => {
      const snapshotPath = join(state, 'azrael', 'providers', 'models.json');
      const before = await readFile(snapshotPath, 'utf8');
      await writeFile(join(run, 'catalog-mode.txt'), mode);
      await peer.request('model/list', { includeHidden: true });
      const after = await readFile(snapshotPath, 'utf8');
      if (mode === 'empty') assert(!after.includes(models[0]), 'refresh_omits_running_model');
      else assert.equal(after, before, 'failed_refresh_preserves_last_good_snapshot');
      await writeFile(join(run, 'catalog-mode.txt'), '');
    };
    await turn(id, 0);
    await peer.request('model/list', { includeHidden: true });
    report.checks.push(`active_tool_continuation_survives_catalog_${mode}`);
  }
  await peer.close(); await start();
  await peer.request('thread/resume', { threadId: id, cwd, dynamicTools });
  const resumed = await history(id, 'resumed');
  for (let i = 1; i <= sequence; i++) assert(resumed.includes(`ROUNDTRIP:NATIVE_MANAGED_TURN_${i}`), 'restart_retains_tool_results');
  await turn(id, 1);
  assert(JSON.stringify(fixture.requests.at(-2).body).includes('ROUNDTRIP:NATIVE_MANAGED_TURN_1'), 'restart_replays_prior_results_to_provider');
  report.checks.push('process_restart_resume_and_provider_switch');
  const forked = await peer.request('thread/fork', { threadId: id, cwd, model: models[2], dynamicTools });
  assert.notEqual(forked.thread.id, id);
  const forkHistory = await history(forked.thread.id, 'fork');
  for (let i = 1; i <= sequence; i++) assert(forkHistory.includes(`ROUNDTRIP:NATIVE_MANAGED_TURN_${i}`), 'fork_retains_tool_results');
  await turn(forked.thread.id, 2);
  await history(forked.thread.id, 'fork-final');
  report.checks.push('native_fork_preserves_managed_history');
  const compactOffset = peer.events.length;
  fixture.controls.compact = true;
  await peer.request('thread/compact/start', { threadId: forked.thread.id });
  const compacted = await peer.wait(event => peer.events.indexOf(event) >= compactOffset && event.params?.threadId === forked.thread.id &&
    (event.method === 'thread/compacted' || (event.method === 'item/completed' && event.params.item?.type === 'contextCompaction')));
  if (compacted.turnId) {
    const ended = await peer.wait(event => event.method === 'turn/completed' && event.params.threadId === forked.thread.id && event.params.turn.id === compacted.turnId);
    assert.equal(ended.turn.status, 'completed', JSON.stringify(ended.turn.error));
  }
  assert(fixture.requests.some(request => request.compact), 'managed_compaction_uses_actual_helper');
  await turn(forked.thread.id, 0, true);
  await history(forked.thread.id, 'after-compaction');
  report.checks.push('manual_native_compaction_and_semantic_result_recall');
  const quotaOffset = peer.events.length;
  fixture.controls.handoffQuota = true;
  await turn(forked.thread.id, 1, true);
  assert(fixture.requests.some(request => request.handoff && request.quota), 'source_quota_failure_exercised');
  assert(JSON.stringify(peer.events.slice(quotaOffset)).includes('encrypted context was omitted'), 'quota_fallback_warns_user');
  report.checks.push('source_quota_failure_continues_target_with_public_history');
  if (!managedOnly) {
  const boundary = await peer.request('thread/start', { model: 'gpt-5.2', modelProvider: 'fixture_openai', cwd, approvalPolicy: 'never', sandbox: 'danger-full-access', ephemeral: false, dynamicTools });
  await boundaryTurn(boundary.thread.id, 'gpt-5.2', 'OPENAI_BOUNDARY_START');
  await boundaryTurn(boundary.thread.id, models[1], 'NATIVE_MANAGED_TURN_100001');
  assert(JSON.stringify(fixture.requests.at(-2).body).includes('ROUNDTRIP:OPENAI_BOUNDARY_START'), 'managed_receives_native_openai_public_result');
  assert(!JSON.stringify(fixture.requests.at(-2).body).includes('synthetic-native-opaque-checkpoint'), 'target_never_receives_native_opaque_checkpoint');
  assert(fixture.requests.some(request => request.provider === 'openai' && request.handoff && JSON.stringify(request.body).includes('synthetic-native-opaque-checkpoint')), 'original_model_summarizes_its_opaque_checkpoint');
  await boundaryTurn(boundary.thread.id, 'gpt-5.2', 'OPENAI_BOUNDARY_END');
  const openaiRequests = fixture.requests.filter(request => request.provider === 'openai' && !request.handoff);
  assert.equal(openaiRequests.length, 4);
  const returned = JSON.stringify(openaiRequests.at(-2).body);
  assert(returned.includes('ROUNDTRIP:OPENAI_BOUNDARY_START') && returned.includes('ROUNDTRIP:NATIVE_MANAGED_TURN_100001'), 'openai_receives_public_cross_provider_history');
  for (const request of openaiRequests) {
    const text = JSON.stringify(request.body);
    assert(!/azrael[-_]managed|azrael[-_]devin|devin.*encrypted/i.test(text), 'private_replay_envelope_in_openai_wire');
    for (const item of request.body.input ?? []) if (typeof item.encrypted_content === 'string') {
      assert(!/azrael[-_]managed|azrael[-_]devin|devin.*encrypted/i.test(Buffer.from(item.encrypted_content, 'base64').toString('utf8')), 'encoded_private_replay_envelope_in_openai_wire');
    }
  }
  await history(boundary.thread.id, 'openai-boundary');
  report.checks.push('actual_native_openai_managed_openai_public_history_boundary');
  const opaqueQuota = await peer.request('thread/start', { model: 'gpt-5.2', modelProvider: 'fixture_openai', cwd, approvalPolicy: 'never', sandbox: 'danger-full-access', ephemeral: false, dynamicTools });
  await boundaryTurn(opaqueQuota.thread.id, 'gpt-5.2', 'OPENAI_BOUNDARY_START');
  const opaqueQuotaOffset = peer.events.length;
  fixture.controls.handoffQuota = true;
  await boundaryTurn(opaqueQuota.thread.id, models[1], 'NATIVE_MANAGED_TURN_100003');
  assert(fixture.requests.some(request => request.provider === 'openai' && request.quota && JSON.stringify(request.body).includes('synthetic-native-opaque-checkpoint')), 'native_quota_source_had_opaque_context');
  assert(!JSON.stringify(fixture.requests.at(-2).body).includes('synthetic-native-opaque-checkpoint'), 'native_quota_target_omits_opaque_context');
  assert(JSON.stringify(peer.events.slice(opaqueQuotaOffset)).includes('encrypted context was omitted'), 'native_quota_warns_user');
  await history(opaqueQuota.thread.id, 'native-opaque-quota');
  report.checks.push('native_source_quota_discards_opaque_checkpoint_and_continues');
  }
  const devin = await peer.request('thread/start', { model: 'devin/swe-2-high', cwd, approvalPolicy: 'never', sandbox: 'danger-full-access', ephemeral: false, dynamicTools });
  await boundaryTurn(devin.thread.id, 'devin/swe-2-high', 'DEVIN_BOUNDARY_START');
  const devinMarkerPath = join(state, 'azrael', 'devin', 'sessions', `${devin.thread.id}.runtime.json`);
  const devinPinBefore = JSON.parse(await readFile(devinMarkerPath, 'utf8'));
  assert.equal(devinPinBefore.account_id, devinAccountId, 'devin_native_runtime_pins_exact_fixture_account');
  assert(devinPinBefore.credential_scope, 'devin_native_runtime_pins_credential_scope');
  await boundaryTurn(devin.thread.id, models[2], 'NATIVE_MANAGED_TURN_100002');
  const managedDevinReplay = JSON.stringify(fixture.requests.at(-2).body);
  assert(managedDevinReplay.includes('ROUNDTRIP:DEVIN_BOUNDARY_START'), 'managed_receives_devin_public_result');
  assert(!managedDevinReplay.includes('azrael-devin-v1'), 'devin_private_envelope_in_managed_wire');
  await boundaryTurn(devin.thread.id, 'devin/swe-2-high', 'DEVIN_BOUNDARY_END');
  const devinPinAfter = JSON.parse(await readFile(devinMarkerPath, 'utf8'));
  assert.equal(devinPinAfter.account_id, devinPinBefore.account_id, 'devin_account_pin_survives_managed_interval');
  assert.equal(devinPinAfter.credential_scope, devinPinBefore.credential_scope, 'devin_credential_scope_survives_managed_interval');
  await writeFile(join(run, 'devin-account-pin.json'), JSON.stringify({ before: devinPinBefore, after: devinPinAfter }, null, 2));
  const devinRequests = (await readFile(join(run, 'devin-requests.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(devinRequests.filter(request => !request.handoff).length, 4);
  assert(devinRequests.every(request => request.threadId === devin.thread.id && request.credentialFingerprint === devinRequests[0].credentialFingerprint), 'devin_exact_credential_survives_managed_interval');
  const devinReturned = JSON.stringify(devinRequests.at(-2).messages);
  assert(devinReturned.includes('ROUNDTRIP:DEVIN_BOUNDARY_START') && devinReturned.includes('ROUNDTRIP:NATIVE_MANAGED_TURN_100002'), 'devin_return_receives_public_cross_provider_history');
  assert(!devinReturned.includes('azrael-managed-v1'), 'managed_private_envelope_in_devin_wire');
  for (const key of keys) assert(!JSON.stringify(devinRequests).includes(key), 'secret_in_devin_requests');
  await history(devin.thread.id, 'devin-boundary');
  report.checks.push('actual_native_devin_managed_devin_public_history_and_account_pin_boundary');
  const handoffCancel = await peer.request('thread/start', { model: models[1], cwd, approvalPolicy: 'never', sandbox: 'danger-full-access', dynamicTools });
  await boundaryTurn(handoffCancel.thread.id, models[1], 'NATIVE_MANAGED_TURN_200010');
  const handoffOffset = fixture.requests.length, handoffCalls = peer.calls.length;
  fixture.controls.handoffDelay = true;
  const interruptedHandoff = await peer.request('turn/start', { threadId: handoffCancel.thread.id, model: models[0], input: [{ type: 'text', text: 'NATIVE_MANAGED_TURN_200011: continue', text_elements: [] }] });
  let handoffTimer;
  try { await Promise.race([fixture.handoffStarted, new Promise((_, reject) => { handoffTimer = setTimeout(() => reject(new Error('handoff_not_started')), timeout); })]); }
  finally { clearTimeout(handoffTimer); }
  await peer.request('turn/interrupt', { threadId: handoffCancel.thread.id, turnId: interruptedHandoff.turn.id });
  const handoffEnd = await peer.wait(event => event.method === 'turn/completed' && event.params.threadId === handoffCancel.thread.id && event.params.turn.id === interruptedHandoff.turn.id);
  assert.equal(handoffEnd.turn.status, 'interrupted');
  assert.equal(peer.calls.length, handoffCalls, 'handoff_never_executes_tools');
  assert(fixture.requests.slice(handoffOffset).every(request => request.provider === 'xai' && request.handoff), 'cancelled_handoff_never_starts_target');
  const cancelledHistory = await history(handoffCancel.thread.id, 'cancelled-handoff');
  assert(!cancelledHistory.includes('UNFINISHED_HANDOFF_MUST_NOT_PERSIST'), 'partial_handoff_is_not_committed');
  assert(cancelledHistory.includes('ROUNDTRIP:NATIVE_MANAGED_TURN_200010'), 'original_history_survives_handoff_cancel');
  await boundaryTurn(handoffCancel.thread.id, models[0], 'NATIVE_MANAGED_TURN_200012');
  assert(JSON.stringify(fixture.requests.at(-2).body).includes('ROUNDTRIP:NATIVE_MANAGED_TURN_200010'), 'retry_preserves_original_result');
  report.checks.push('handoff_cancel_preserves_history_and_retry_without_tool_replay');
  const cancel = await peer.request('thread/start', { model: models[1], cwd, approvalPolicy: 'never', sandbox: 'danger-full-access', dynamicTools });
  const cancelCalls = peer.calls.length, cancelOffset = peer.events.length;
  fixture.controls.delay = true;
  const cancelled = await peer.request('turn/start', { threadId: cancel.thread.id, model: models[1], input: [{ type: 'text', text: 'NATIVE_MANAGED_TURN_200001: Call namespace_b.echo with value NATIVE_MANAGED_TURN_200001.', text_elements: [] }] });
  let delayTimer;
  try { await Promise.race([fixture.delayedStarted, new Promise((_, reject) => { delayTimer = setTimeout(() => reject(new Error('delayed_provider_not_started')), timeout); })]); }
  finally { clearTimeout(delayTimer); }
  await peer.request('turn/interrupt', { threadId: cancel.thread.id, turnId: cancelled.turn.id });
  const cancelledEnd = await peer.wait(event => event.method === 'turn/completed' && event.params.threadId === cancel.thread.id && event.params.turn.id === cancelled.turn.id);
  assert.equal(cancelledEnd.turn.status, 'interrupted');
  assert.equal(peer.calls.length, cancelCalls, 'partial_tool_call_not_executed');
  assert(!peer.events.slice(cancelOffset).some(event => event.params?.item?.type === 'dynamicToolCall'), 'partial_tool_call_not_surfaced');
  report.checks.push('managed_cancel_partial_stream_no_dynamic_execution');
  assert(fixture.requests.some(request => request.provider === 'google' && request.final && JSON.stringify(request.body).includes(thoughtSignature)), 'google_thought_signature_preserved');
  assert.deepEqual(fixture.errors, []);
  await checkTranscripts(); report.checks.push('no_secrets_in_requests_events_history_rollouts_or_logs');
  report.status = 'passed';
  }
} catch (error) {
  report.error = error.message;
  report.fixtureErrors = fixture.errors;
  process.exitCode = 1;
} finally {
  await Promise.all(peers.map(value => value.close()));
  await fixture.close();
  await Promise.all(peers.map((value, i) => writeFile(join(run, `engine-${i + 1}.stderr.log`), value.stderr)));
  await writeFile(join(run, 'requests.json'), JSON.stringify(fixture.requests, null, 2));
  await writeFile(join(run, 'events.json'), JSON.stringify(peers.map(value => ({ events: value.events, calls: value.calls })), null, 2));
  await writeFile(join(run, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, run }));
}

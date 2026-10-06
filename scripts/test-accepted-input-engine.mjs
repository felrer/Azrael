// Acceptance probe for durable native user input. Run only with an explicitly
// selected engine; every scenario owns fresh synthetic homes and child PIDs.
// node scripts/test-accepted-input-engine.mjs --engine ABS_EXE --output ABS_NEW_ARTIFACT_DIR [--catalog ABS_JSON]
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
import { access, copyFile, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const fixture = join(root, 'scripts/fixtures/accepted-input-helper.mjs');
const timeoutMs = 25_000;
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
const owned = [];
let generation = 0;
const summary = { status: 'failed', scenarios: [], processes: [], isolation: 'fresh synthetic state and whitelisted child environment; no user auth or provider network' };
const families = { families: [{ family_label: 'SWE-2', family_uid: 'swe-2', slug: 'swe-2', aliases: [],
  variants: [{ model_uid: 'swe-2-high', label: 'SWE-2 High', max_context_tokens: 200000, max_output_tokens: 16000 }] }] };
const dynamicTools = [{ type: 'namespace', name: 'accepted_input_probe', description: 'Isolated acceptance hold',
  tools: [{ type: 'function', name: 'hold', description: 'Wait for the probe', inputSchema: { type: 'object', properties: {} } }] }];

function options() {
  const args = process.argv.slice(2), result = {};
  for (let i = 0; i < args.length; i += 2) {
    assert(['--engine', '--output', '--catalog'].includes(args[i]), `Unknown option ${args[i]}`);
    assert(args[i + 1] && !result[args[i]], `Missing or duplicate ${args[i]}`);
    result[args[i]] = args[i + 1];
  }
  for (const key of ['--engine', '--output']) assert(isAbsolute(result[key] ?? ''), `${key} must be absolute`);
  if (result['--catalog']) assert(isAbsolute(result['--catalog']), '--catalog must be absolute');
  return { engine: resolve(result['--engine']), output: resolve(result['--output']),
    catalog: result['--catalog'] ?? join(root, 'upstream/codex/codex-rs/models-manager/models.json') };
}

async function validatePaths(opts) {
  assert((await stat(opts.engine)).isFile(), 'Engine must be an existing file');
  const catalog = JSON.parse(await readFile(opts.catalog, 'utf8'));
  assert(Array.isArray(catalog.models) && catalog.models.length > 0, 'Catalog must contain development model entries');
  const artifactRoot = await realpath(join(root, 'artifacts'));
  const inside = relative(artifactRoot, opts.output);
  assert(inside && !inside.startsWith('..') && !isAbsolute(inside), '--output must be a NEW directory inside this repository artifacts directory');
  assert(!(await access(opts.output).then(() => true, () => false)), '--output already exists; refusing to reuse state');
  let ancestor = dirname(opts.output);
  while (!(await access(ancestor).then(() => true, () => false))) ancestor = dirname(ancestor);
  const actualAncestor = await realpath(ancestor);
  const actualInside = relative(artifactRoot, actualAncestor);
  assert(actualInside === '' || (!actualInside.startsWith('..') && !isAbsolute(actualInside)), 'Output ancestor escapes artifacts through a link');
  await mkdir(opts.output, { recursive: true });
}

class Peer {
  constructor(child, prefix) {
    this.child = child; this.prefix = prefix; this.pending = new Map(); this.events = []; this.next = 0;
    child.stderr.on('data', data => appendFileSync(prefix + '.stderr.log', data));
    createInterface({ input: child.stdout }).on('line', line => {
      appendFileSync(prefix + '.rpc.log', 'OUT ' + line + '\n');
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.method) { this.events.push(message); return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.error) pending.reject(Object.assign(new Error(JSON.stringify(message.error)), { rpcError: message.error }));
      else pending.resolve(message.result);
    });
    child.once('error', error => { this.spawnError = error; this.rejectPending(error); });
    child.once('close', (code, signal) => {
      this.exit = { pid: child.pid ?? null, code, signal, spawnError: this.spawnError?.message ?? null };
      appendFileSync(prefix + '.exit.json', JSON.stringify(this.exit, null, 2));
      summary.processes.push({ prefix, ...this.exit });
      this.rejectPending(new Error('Owned engine exited'));
    });
    child.stdin.on('error', error => this.rejectPending(error));
  }
  rejectPending(error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  send(message) {
    assert(!this.exit && !this.spawnError, 'Cannot write to exited engine');
    const line = JSON.stringify(message);
    appendFileSync(this.prefix + '.rpc.log', 'IN ' + line + '\n');
    this.child.stdin.write(line + '\n');
  }
  request(method, params) {
    return new Promise((resolveRequest, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Timeout: ' + method)); }, timeoutMs);
      this.pending.set(id, { resolve: resolveRequest, reject, timer });
      try { this.send({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async event(method, predicate = () => true) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = this.events.findIndex(event => event.method === method && predicate(event));
      if (index >= 0) return this.events.splice(index, 1)[0];
      assert(!this.exit && !this.spawnError, 'Engine exited waiting for ' + method);
      await sleep(20);
    }
    throw new Error('Timeout event: ' + method);
  }
  async stop(abrupt = false) {
    if (!this.exit && !this.spawnError) {
      if (abrupt) this.child.kill('SIGKILL'); else this.child.stdin.end();
      const deadline = Date.now() + 4000;
      while (!this.exit && Date.now() < deadline) await sleep(20);
      if (!this.exit) this.child.kill('SIGKILL');
    }
    const deadline = Date.now() + 4000;
    while (!this.exit && Date.now() < deadline) await sleep(20);
    assert(this.exit, 'Owned engine failed to exit: ' + this.child.pid);
    if (!abrupt) assert.equal(this.exit.code, 0, 'Graceful engine exit must succeed');
  }
}

async function setup(opts, mode) {
  const base = join(opts.output, mode);
  const dirs = Object.fromEntries(['state', 'work', 'appdata', 'localappdata', 'home', 'temp'].map(name => [name, join(base, name)]));
  for (const dir of Object.values(dirs)) await mkdir(dir, { recursive: true });
  await mkdir(join(dirs.state, 'azrael/devin'), { recursive: true });
  await mkdir(join(dirs.appdata, 'devin'), { recursive: true });
  await writeFile(join(dirs.appdata, 'devin/credentials.toml'), 'windsurf_api_key = "synthetic-accepted-input"\napi_server_url = "https://server.codeium.com"\n');
  await copyFile(opts.catalog, join(dirs.state, 'azrael/devin/catalog.json'));
  await writeFile(join(dirs.state, 'azrael/devin/models.json'), JSON.stringify(families));
  // Node replaces the Devin executable; CLI model/auth checks execute these local scripts.
  await writeFile(join(dirs.work, 'models'), `process.stdout.write(${JSON.stringify(JSON.stringify(families))});`);
  await writeFile(join(dirs.work, 'auth'), 'process.stdout.write("Logged in (via Devin).\\nEmail: isolated@fixture.invalid\\nPlan: test\\n");');
  await writeFile(join(dirs.state, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'synthetic-fixture', tokens: null, last_refresh: null }));
  await writeFile(join(dirs.state, 'config.toml'), `model = "devin/swe-2-high"\nmodel_catalog_json = ${JSON.stringify(join(dirs.state, 'azrael/devin/catalog.json'))}\ncli_auth_credentials_store = "file"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n[features]\nplugins = false\nresponses_websockets = false\n`);
  return { base, ...dirs, trace: join(base, 'provider-invocations.jsonl') };
}

async function start(opts, state) {
  const env = {};
  for (const key of ['SystemRoot', 'SystemDrive', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC', 'PROCESSOR_ARCHITECTURE']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, { CODEX_HOME: state.state, APPDATA: state.appdata, LOCALAPPDATA: state.localappdata,
    USERPROFILE: state.home, HOME: state.home, TEMP: state.temp, TMP: state.temp,
    AZRAEL_EX_DEVIN_EXECUTABLE: process.execPath, AZRAEL_DEVIN_NODE: process.execPath,
    AZRAEL_DEVIN_NATIVE_HELPER: fixture, AZRAEL_EX_PLAINTEXT_AGENTS: '1',
    AZRAEL_ACCEPTED_INPUT_TRACE: state.trace, RUST_LOG: 'codex_core::devin=info,devin_native_progress=info' });
  assert(!('AZRAEL_EX_MANAGEMENT_SOCKET' in env));
  const prefix = join(state.base, `engine-${++generation}`);
  await writeFile(prefix + '.stderr.log', ''); await writeFile(prefix + '.rpc.log', '');
  const child = spawn(opts.engine, ['-c', 'features.code_mode=false', '-c', 'features.code_mode_host=true',
    '-c', 'features.multi_agent_v2.enabled=true', '-c', 'web_search="disabled"', '-c', 'features.plugins=false', 'app-server'],
  { cwd: state.work, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const peer = new Peer(child, prefix); owned.push(peer);
  await peer.request('initialize', { clientInfo: { name: 'accepted_input_acceptance', version: '1' }, capabilities: { experimentalApi: true } });
  peer.send({ method: 'initialized' });
  await peer.request('model/list', { includeHidden: true });
  return peer;
}

async function invocations(state) {
  const text = await readFile(state.trace, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  return text.trim() ? text.trim().split('\n').map(JSON.parse).length : 0;
}

async function snapshot(peer, state, threadId, label, expected) {
  const read = await peer.request('thread/read', { threadId, includeTurns: true });
  const pages = []; let cursor;
  do {
    const page = await peer.request('thread/turns/list', { threadId, limit: 100, itemsView: 'full', ...(cursor ? { cursor } : {}) });
    pages.push(page); cursor = page.nextCursor;
    assert(pages.length <= 10, 'Unexpected pagination loop');
  } while (cursor);
  await writeFile(join(state.base, label + '.json'), JSON.stringify({ read, pages }, null, 2));
  const views = { read: read.thread.turns, list: pages.flatMap(page => page.data) };
  for (const [view, turns] of Object.entries(views)) {
    assert(Array.isArray(turns), `${view}: missing turns`);
    const users = turns.flatMap(turn => turn.items ?? []).filter(item => item.type === 'userMessage');
    assert.equal(users.length, expected.length, `${view}: unexpected or duplicated user messages`);
    for (const message of expected) {
      const matches = users.filter(item => item.clientId === message.id);
      assert.equal(matches.length, 1, `${view}: expected exactly one ${message.id}`);
      assert.deepEqual(matches[0].content, message.input, `${view}: complete payload mismatch for ${message.id}`);
    }
  }
  return { label, readUserMessages: expected.length, listUserMessages: expected.length };
}

async function rejected(peer, method, params) {
  try { await peer.request(method, params); } catch (error) {
    assert(error.rpcError, 'Expected an RPC conflict rejection, not transport failure');
    return error.rpcError;
  }
  throw new Error('Conflicting client ID payload was accepted: ' + method);
}

async function scenario(opts, mode) {
  const state = await setup(opts, mode), peer = await start(opts, state);
  const record = { mode, snapshots: [] }; summary.scenarios.push(record);
  const thread = await peer.request('thread/start', { model: 'devin/swe-2-high', cwd: state.work,
    approvalPolicy: 'never', sandbox: 'danger-full-access', ephemeral: false, dynamicTools });
  const threadId = thread.thread.id; record.threadId = threadId;
  const initial = { id: `initial-${mode}`, input: [{ type: 'text', text: `INITIAL_ACCEPTED_${mode}`, text_elements: [] }] };
  const startParams = { threadId, clientUserMessageId: initial.id, input: initial.input };
  const turn = await peer.request('turn/start', startParams); record.turnId = turn.turn.id;
  const call = await peer.event('item/tool/call', event => event.params?.threadId === threadId);
  assert.equal(await invocations(state), 1, 'Initial hold must have exactly one traced provider invocation');
  const initialRetry = await peer.request('turn/start', startParams);
  assert.equal(initialRetry.turn.id, turn.turn.id, 'Initial start retry must return original turn');
  record.initialConflict = await rejected(peer, 'turn/start', { ...startParams, input: [{ type: 'text', text: 'CONFLICT_INITIAL', text_elements: [] }] });
  const input = [{ type: 'text', text: `DURABLE_ACCEPTED_${mode}\n한글 complete payload`,
    text_elements: [{ byteRange: { start: 0, end: 7 }, placeholder: 'accepted-input-span' }] }];
  const first = { id: `queued-${mode}-a`, input }, second = { id: `queued-${mode}-b`, input };
  const steerParams = { threadId, expectedTurnId: turn.turn.id, clientUserMessageId: first.id, input };
  const ack = await peer.request('turn/steer', steerParams);
  assert.equal(ack.turnId, turn.turn.id);
  const retry = await peer.request('turn/steer', steerParams);
  assert.equal(retry.turnId, ack.turnId, 'Steer retry must return original turn');
  record.conflict = await rejected(peer, 'turn/steer', { ...steerParams, input: [{ type: 'text', text: 'CONFLICT_STEER', text_elements: [] }] });
  const secondAck = await peer.request('turn/steer', { ...steerParams, clientUserMessageId: second.id });
  assert.equal(secondAck.turnId, ack.turnId);
  const expected = [initial, first, second];
  if (mode === 'consumed') {
    peer.send({ id: call.id, result: { success: true, contentItems: [{ type: 'inputText', text: 'accepted-input-released' }] } });
    const completed = await peer.event('turn/completed', event => event.params?.threadId === threadId);
    assert.equal(completed.params.turn.status, 'completed', 'Released turn must complete');
    record.snapshots.push(await snapshot(peer, state, threadId, 'consumed-before-restart', expected));
    await peer.stop();
  } else if (mode === 'interrupt') {
    await peer.request('turn/interrupt', { threadId, turnId: turn.turn.id });
    await peer.event('turn/completed', event => event.params?.threadId === threadId);
    const beforeResume = await invocations(state);
    await peer.request('thread/resume', { threadId, cwd: state.work, model: 'devin/swe-2-high',
      approvalPolicy: 'never', sandbox: 'danger-full-access' });
    record.snapshots.push(await snapshot(peer, state, threadId, 'same-process-interrupt-resume', expected));
    await sleep(300);
    assert.equal(await invocations(state), beforeResume, 'Warm resume must invoke no provider');
    await peer.stop();
  } else await peer.stop(true); // No delay or history read after final acceptance ACK.
  for (let restart = 1; restart <= 2; restart++) {
    const before = await invocations(state), fresh = await start(opts, state);
    for (let resume = 1; resume <= 2; resume++) {
      await fresh.request('thread/resume', { threadId, cwd: state.work, model: 'devin/swe-2-high', approvalPolicy: 'never', sandbox: 'danger-full-access' });
      const restoredRetry = await fresh.request('turn/start', startParams);
      assert.equal(restoredRetry.turn.id, turn.turn.id, 'Retry after restart must return original turn');
      await rejected(fresh, 'turn/start', { ...startParams,
        input: [{ type: 'text', text: 'CONFLICT_AFTER_RESTART', text_elements: [] }] });
      record.snapshots.push(await snapshot(fresh, state, threadId, `restart-${restart}-resume-${resume}`, expected));
      await sleep(300);
      assert.equal(await invocations(state), before, 'Explicit resume/history reads must invoke no provider');
    }
    await fresh.stop();
    assert.equal(await invocations(state), before, 'Restart/resume invoked provider');
  }
  record.providerInvocations = await invocations(state); record.status = 'passed';
}

let opts;
try {
  opts = options(); await validatePaths(opts);
  summary.engine = opts.engine; summary.catalog = opts.catalog; summary.startedAt = new Date().toISOString();
  for (const mode of ['consumed', 'interrupt', 'crash']) await scenario(opts, mode);
  summary.status = 'passed';
} catch (error) { summary.error = error.stack; process.exitCode = 1; }
finally {
  for (const peer of owned) {
    if (!peer.exit) {
      try { await peer.stop(true); } catch (error) { summary.status = 'failed'; summary.cleanupError = error.stack; process.exitCode = 1; }
    }
  }
  summary.exitCode = process.exitCode ?? 0; summary.finishedAt = new Date().toISOString();
  if (opts && summary.startedAt) await writeFile(join(opts.output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ status: summary.status, exitCode: summary.exitCode,
    scenarios: summary.scenarios.map(({ mode, status }) => ({ mode, status })),
    summary: opts && summary.startedAt ? join(opts.output, 'summary.json') : null, error: summary.error ?? null }));
}

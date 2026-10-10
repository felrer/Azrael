import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { RecoveryState } = require('./recovery-state.cjs');
const [engine, directory] = process.argv.slice(2);
if (!engine || !directory || !isAbsolute(directory)) throw new Error('Usage: node scripts/test-recovery-engine.mjs <engine> <new absolute fixture directory>');
await mkdir(directory); // Never reuse user state or another test's directory.
const threadId = randomUUID();
const oldTurnId = randomUUID();
const timestamp = '2026-09-15T00:00:00.000Z';
const sessionFolder = join(directory, 'sessions', '2026', '09', '15');
await mkdir(sessionFolder, { recursive: true });
await writeFile(join(sessionFolder, `rollout-2026-09-15T00-00-00-${threadId}.jsonl`), [
  { timestamp, type: 'session_meta', payload: { id: threadId, session_id: threadId, timestamp, cwd: directory,
    originator: 'azrael-recovery-fixture', cli_version: '0.154.0', source: 'vscode', model_provider: 'fixture', history_mode: 'legacy' } },
  { timestamp, type: 'event_msg', payload: { type: 'task_started', turn_id: oldTurnId, model_context_window: 200000, collaboration_mode_kind: 'default' } },
  { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Recovery fixture.' }] } },
].map(row => JSON.stringify(row)).join('\n') + '\n');

// The local provider deliberately never produces inference output. No account,
// external model, tools or user data are involved in this interruption test.
let providerRequests = 0;
const providerPaths = [];
const sockets = new Set();
const server = createServer((request, response) => {
  request.resume();
  providerRequests++;
  providerPaths.push({ method: request.method, path: request.url });
  if (request.method === 'POST' && request.url?.endsWith('/responses')) {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(': local recovery fixture\n\n');
    return;
  }
  if (request.method === 'GET' && request.url?.includes('/models')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ object: 'list', data: [] }));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: { message: 'fixture endpoint not found' } }));
});
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
const port = server.address().port;
await writeFile(join(directory, 'config.toml'), `model = "gpt-5.6-sol"\nmodel_provider = "fixture"\napproval_policy = "never"\nsandbox_mode = "read-only"\n[model_providers.fixture]\nname = "Local recovery fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\nstream_idle_timeout_ms = 120000\nrequest_max_retries = 0\n`);

let client;
let state;
let receiptRecords = [];
const receiptFile = join(directory, 'receipts.json');
const store = { get: () => structuredClone(receiptRecords), update: async (_key, value) => {
  await writeFile(receiptFile, JSON.stringify(value));
  receiptRecords = structuredClone(value);
} };
const counts = {};

async function bounded(promise, milliseconds, phase) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Fixture ${phase} timed out after ${milliseconds}ms (engine PID ${client?.child.pid ?? 'not spawned'}, exit ${client?.child.exitCode}, signal ${client?.child.signalCode}, provider sockets ${sockets.size})`)), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForProviderRequests(expected) {
  const deadline = Date.now() + 10000;
  while (providerRequests < expected) {
    if (Date.now() >= deadline) throw new Error(`Fixture provider did not receive request ${expected}: ${JSON.stringify(providerPaths)}`);
    await new Promise(resolvePause => setTimeout(resolvePause, 50));
  }
}

async function connect() {
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith('AZRAEL_EX_') || ['CODEX_HOME', 'CODEX_SESSION_ID', 'CODEX_THREAD_ID'].includes(key)) delete childEnv[key];
  }
  childEnv.CODEX_HOME = directory;
  const child = spawn(resolve(engine), ['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled'], { cwd: directory, windowsHide: true,
    // Never inherit the running Azrael host's private rendezvous or account
    // files. The direct stdio fixture needs only its fresh state directory.
    env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let next = 0;
  let stderr = '';
  let terminalError;
  let settled = false;
  const rejectPending = error => {
    for (const wait of pending.values()) { clearTimeout(wait.timer); wait.reject(error); }
    pending.clear();
  };
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); }
    catch (error) { terminalError = error; rejectPending(error); return; }
    if (message.method) state?.observe(message);
    const wait = pending.get(message.id);
    if (!wait) return;
    pending.delete(message.id);
    clearTimeout(wait.timer);
    if (message.error) wait.reject(new Error(JSON.stringify(message.error)));
    else wait.resolve(message.result);
  });
  const exited = new Promise(resolveExit => {
    const finish = (code, error) => {
      if (settled) return;
      settled = true;
      terminalError = error ?? new Error(`Fixture engine exited ${code} (signal ${child.signalCode})`);
      rejectPending(terminalError);
      lines.close();
      resolveExit({ code, signal: child.signalCode, error });
    };
    child.once('exit', code => finish(code));
    // A failed spawn emits error and close, but may never emit exit.
    child.once('error', error => finish(null, error));
  });
  child.stdin.on('error', error => { terminalError = error; rejectPending(error); });
  const rpc = (method, params, timeout = 20000) => new Promise((resolveRpc, reject) => {
    if (terminalError) { reject(terminalError); return; }
    counts[method] = (counts[method] ?? 0) + 1;
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Fixture ${method} timed out`)); }, timeout);
    pending.set(id, { resolve: resolveRpc, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => {
      if (error) { terminalError = error; rejectPending(error); }
    });
  });
  const disposeStreams = () => {
    rejectPending(new Error('Fixture connection closed'));
    lines.close();
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
  };
  const result = { child, rpc, exited, disposeStreams, settled: () => settled, stderr: () => stderr };
  client = result;
  await rpc('initialize', { clientInfo: { name: 'azrael-recovery-fixture', version: '1.0.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  return result;
}

let result;
let failure;
try {
  client = await connect();
  state = new RecoveryState({ store, rpc: (...args) => client.rpc(...args) });
  await state.resume({ threadId });
  const before = await state.snapshot(threadId);
  assert.equal(before.active, false);
  assert.equal(before.latest.status, 'interrupted');
  const [first, duplicate] = await Promise.all([
    state.start({ threadId, input: [] }),
    state.start({ threadId, input: [{ type: 'text', text: 'continue' }] }),
  ]);
  assert.equal(first.turn.id, duplicate.turn.id);
  assert.equal(counts['turn/start'], 1);
  const firstActiveDeadline = Date.now() + 10000;
  let firstSnapshot = await state.snapshot(threadId);
  while (!firstSnapshot.active) {
    if (Date.now() >= firstActiveDeadline) throw new Error(`Fixture first turn never became active: ${JSON.stringify(providerPaths)}`);
    await new Promise(resolvePause => setTimeout(resolvePause, 50));
    firstSnapshot = await state.snapshot(threadId);
  }
  const attached = await state.start({ threadId, input: [] });
  assert.equal(attached.turn.id, first.turn.id);
  assert.equal(counts['turn/start'], 1);
  await waitForProviderRequests(1);
  // Crash only this test-owned child, leaving an accepted unfinished receipt.
  client.child.kill();
  await bounded(client.exited, 3000, 'crashed engine exit');
  client.disposeStreams();
  state.disconnect();
  receiptRecords = JSON.parse(await readFile(receiptFile, 'utf8'));
  state = undefined;
  client = await connect();
  state = new RecoveryState({ store, rpc: (...args) => client.rpc(...args) });
  await state.resume({ threadId });
  assert.equal((await state.snapshot(threadId)).active, false);
  const resumed = await state.start({ threadId, input: [] });
  assert.notEqual(resumed.turn.id, first.turn.id);
  assert.equal(counts['turn/start'], 2);
  const activeDeadline = Date.now() + 10000;
  let resumedSnapshot = await state.snapshot(threadId);
  while (!resumedSnapshot.active) {
    if (Date.now() >= activeDeadline) throw new Error(`Fixture resumed turn never became active: ${JSON.stringify(providerPaths)}`);
    await new Promise(resolvePause => setTimeout(resolvePause, 50));
    resumedSnapshot = await state.snapshot(threadId);
  }
  await waitForProviderRequests(2);
  await client.rpc('turn/interrupt', { threadId, turnId: resumed.turn.id });
  const deadline = Date.now() + 10000;
  while ((await state.snapshot(threadId)).active) {
    if (Date.now() >= deadline) throw new Error('Fixture turn did not become idle');
    await new Promise(resolvePause => setTimeout(resolvePause, 100));
  }
  result = { passed: true, engine: resolve(engine), threadId, counts, providerRequests, providerPaths,
    checks: ['native orphan normalization', 'one concurrent resume dispatch', 'live attachment', 'engine crash and persisted receipt reload', 'new continuation after crash', 'confirmed interruption'], externalModelCalls: false };
} catch (error) {
  failure = error;
} finally {
  const cleanupErrors = [];
  try {
    if (client && !client.settled()) {
      client.child.stdin.end();
      const timer = setTimeout(() => client.child.kill(), 3000);
      try { await bounded(client.exited, 6000, 'engine teardown'); }
      finally { clearTimeout(timer); }
    }
  } catch (error) {
    cleanupErrors.push(error);
    // Do not let an unresponsive test-owned child keep a failed validator alive.
    // The timeout remains a failure, and its diagnostic identifies the PID.
    client?.child.kill();
    client?.child.unref();
  } finally {
    client?.disposeStreams();
  }
  for (const socket of sockets) socket.destroy();
  try {
    await bounded(new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose())), 3000, 'provider server teardown');
  } catch (error) {
    cleanupErrors.push(error);
    server.unref();
  }
  if (cleanupErrors.length) {
    const cleanup = new AggregateError(cleanupErrors, 'Fixture teardown failed');
    failure = failure ? new AggregateError([failure, cleanup], 'Fixture validation and teardown failed', { cause: failure }) : cleanup;
  }
}
if (failure) {
  const details = error => `${error.stack}${error.errors ? '\n' + error.errors.map(details).join('\n') : ''}`;
  await writeFile(join(directory, 'failure.log'), `${details(failure)}\nprovider paths: ${JSON.stringify(providerPaths)}\n${client?.stderr() ?? ''}`);
  throw failure;
}
await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));

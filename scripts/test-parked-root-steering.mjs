import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';

const { RecoveryState } = createRequire(import.meta.url)('./recovery-state.cjs');
assert(process.argv[2], 'usage: node scripts/test-parked-root-steering.mjs <engine> [new-output-directory]');
const engine = resolve(process.argv[2]);
const artifactRoot = resolve(import.meta.dirname, '../artifacts/verification');
const base = resolve(process.argv[3] ?? join(artifactRoot, `parked-root-steering-${Date.now()}`));
const inside = relative(artifactRoot, base);
assert(inside && !inside.startsWith('..') && !isAbsolute(inside), 'output must be a new verification descendant');
await mkdir(base, { recursive: false });
for (const name of ['state', 'home', 'appdata', 'localappdata', 'temp', 'work']) await mkdir(join(base, name));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sockets = new Set(), notifications = [], pending = new Map(), methods = [], diagnostics = [];
let child, stderr = '', sequence = 0, calls = 0;
const report = { engine, isolation: 'fresh synthetic state and allowlisted environment; loopback Responses only', status: 'failed' };
const server = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (req.method !== 'POST' || !req.url.endsWith('/responses')) { res.writeHead(404); res.end('{}'); return; }
  const body = JSON.parse(raw);
  calls += 1;
  const declaredTools = [...(body.tools ?? []), ...(body.input ?? []).filter(item => item.type === 'additional_tools').flatMap(item => item.tools ?? [])];
  if (calls === 1) {
    await writeFile(join(base, 'provider-tools.json'), JSON.stringify(declaredTools, null, 2));
    report.requestShape = { keys: Object.keys(body), model: body.model, toolChoice: body.tool_choice, toolCount: declaredTools.length };
  }
  const tools = declaredTools.flatMap(tool => tool.type === 'namespace'
    ? tool.tools.map(value => ({ ...value, namespace: tool.name })) : [tool]);
  const defer = tools.find(tool => tool.name === 'defer_root');
  const park = calls === 1 || calls === 4;
  if (park && !defer) { report.providerError = 'root deferral tool missing'; res.writeHead(500); res.end('{}'); return; }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const emit = value => res.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
  emit({ type: 'response.created', response: { id: `synthetic-${calls}` } });
  emit({ type: 'response.output_item.done', item: park
    ? { type: 'function_call', call_id: `park-${calls}`, name: 'defer_root', namespace: defer.namespace,
      arguments: JSON.stringify({ resume_after_ms: 600000, reason: 'synthetic steering regression' }) }
    : { type: 'message', id: `message-${calls}`, role: 'assistant', content: [{ type: 'output_text', text: 'SYNTHETIC_COMPLETION' }] } });
  emit({ type: 'response.completed', response: { id: `synthetic-${calls}`,
    usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } } });
  res.end();
});
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const state = join(base, 'state');
await writeFile(join(state, 'config.toml'), `model = "gpt-5.6-sol"\nmodel_provider = "fixture_openai"\ncli_auth_credentials_store = "file"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n[model_providers.fixture_openai]\nname = "OpenAI"\nbase_url = "http://127.0.0.1:${server.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\nrequest_max_retries = 0\n[features]\nplugins = false\nresponses_websockets = false\n`);
const env = {};
for (const key of ['SystemRoot', 'SystemDrive', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC', 'PROCESSOR_ARCHITECTURE']) if (process.env[key]) env[key] = process.env[key];
Object.assign(env, { CODEX_HOME: state, USERPROFILE: join(base, 'home'), HOME: join(base, 'home'), APPDATA: join(base, 'appdata'),
  LOCALAPPDATA: join(base, 'localappdata'), TEMP: join(base, 'temp'), TMP: join(base, 'temp'),
  RUST_LOG: 'warn,azrael_input_delivery=debug', AZRAEL_EX_PLAINTEXT_AGENTS: '1' });
function rpc(method, params, timeout = 10000) {
  const id = ++sequence;
  methods.push({ id, method });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout:${method}`)); }, timeout);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
async function event(method, turnId) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const found = notifications.find(value => value.method === method && (value.params?.turn?.id ?? value.params?.turnId) === turnId);
    if (found) return found;
    await sleep(20);
  }
  throw new Error(`event timeout:${method}`);
}
const input = (threadId, clientUserMessageId, text) => ({ threadId, clientUserMessageId,
  input: [{ type: 'text', text, text_elements: [] }] });
try {
  child = spawn(engine, ['-c', 'features.code_mode=false', '-c', 'features.code_mode_host=true', '-c',
    'features.multi_agent_v2.enabled=true', '-c', 'web_search="disabled"', 'app-server'],
  { cwd: join(base, 'work'), env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', chunk => { stderr += chunk; });
  createInterface({ input: child.stdout }).on('line', line => {
    let value;
    try { value = JSON.parse(line); } catch { return; }
    if (value.method) { notifications.push(value); return; }
    const request = pending.get(value.id);
    if (!request) return;
    pending.delete(value.id); clearTimeout(request.timer);
    if (value.error) { const error = new Error(value.error.message); error.rpcError = value.error; request.reject(error); }
    else request.resolve(value.result);
  });
  await rpc('initialize', { clientInfo: { name: 'parked_root_steering_regression', version: '1' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  const thread = await rpc('thread/start', { cwd: join(base, 'work'), model: 'gpt-5.6-sol', approvalPolicy: 'never', sandbox: 'danger-full-access' });
  const threadId = thread.thread.id;
  report.threadId = threadId;
  const parked = await rpc('turn/start', input(threadId, 'park-first', 'SYNTHETIC_PARK'));
  await event('turn/deferred', parked.turn.id);
  await assert.rejects(rpc('turn/steer', { ...input(threadId, 'wrong-steer', 'SYNTHETIC_WRONG'), expectedTurnId: 'wrong-turn' }), error => !!error.rpcError);
  const wake = await rpc('turn/steer', { ...input(threadId, 'wake-first', 'SYNTHETIC_WAKE'), expectedTurnId: parked.turn.id });
  assert(wake.turnId && wake.turnId !== parked.turn.id);
  await event('turn/completed', wake.turnId);
  const later = await rpc('turn/start', input(threadId, 'later-first', 'SYNTHETIC_LATER'));
  await event('turn/completed', later.turn.id);
  const parkedAgain = await rpc('turn/start', input(threadId, 'park-second', 'SYNTHETIC_PARK_AGAIN'));
  await event('turn/deferred', parkedAgain.turn.id);
  let droppedTurnId;
  const recovery = new RecoveryState({ store: { get() { return []; }, async update() {} }, log: record => diagnostics.push(record),
    rpc: async (method, params, timeout) => {
      const result = await rpc(method, params, timeout);
      if (method === 'turn/steer' && params.clientUserMessageId === 'wake-lost') {
        droppedTurnId = result.turnId;
        throw new Error('synthetic acknowledgement loss');
      }
      return result;
    } });
  const reconciled = await recovery.steer({ ...input(threadId, 'wake-lost', 'SYNTHETIC_LOST_ACK'), expectedTurnId: parkedAgain.turn.id });
  assert.deepEqual(reconciled, { turnId: droppedTurnId });
  assert.notEqual(reconciled.turnId, parkedAgain.turn.id);
  await event('turn/completed', reconciled.turnId);
  const final = await rpc('turn/start', input(threadId, 'later-second', 'SYNTHETIC_FINAL'));
  await event('turn/completed', final.turn.id);
  const history = await rpc('thread/turns/list', { threadId, limit: 20, itemsView: 'full' });
  const ids = history.data.flatMap(turn => turn.items).filter(item => item.type === 'userMessage').map(item => item.clientId);
  for (const id of ['park-first', 'wake-first', 'later-first', 'park-second', 'wake-lost', 'later-second']) assert.equal(ids.filter(value => value === id).length, 1);
  assert(!ids.includes('wrong-steer'));
  assert.equal(methods.filter(value => value.method === 'turn/steer').length, 3);
  assert(!stderr.includes('steer-only submission cannot start a turn'));
  report.status = 'passed';
  report.checks = { mismatchedExpectedIdRejected: true, wakeReturnedActualTurnId: true, followupAccepted: true,
    lostAcknowledgementReconciled: true, acceptedInputsExactlyOnce: true, steerMutations: 3 };
} catch (error) { report.error = error.stack; process.exitCode = 1; }
finally {
  if (child?.exitCode === null) await sleep(11000);
  if (child) { child.stdin.end(); await sleep(500); if (child.exitCode === null) child.kill(); await sleep(300); report.ownedPid = child.pid; report.engineExitCode = child.exitCode; }
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('fixture cleanup')); }
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
  await writeFile(join(base, 'stderr.log'), stderr);
  await writeFile(join(base, 'methods.json'), JSON.stringify(methods, null, 2));
  await writeFile(join(base, 'recovery.json'), JSON.stringify(diagnostics, null, 2));
  await writeFile(join(base, 'summary.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, output: base }));
}

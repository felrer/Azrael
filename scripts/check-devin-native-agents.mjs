import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const engine = resolve(process.argv[2]);
const run = resolve(process.argv[3] ?? join(root, 'artifacts/verification/devin-native-20260915', `agents-${randomUUID()}`));
const logRoot = join(root, 'artifacts/logs/devin-native-20260915');
const state = join(run, 'state');
const cwd = join(run, 'work');
const appdata = join(run, 'appdata');
const tracePath = join(run, 'fixture-trace.jsonl');
const timeoutMs = 120_000;
await mkdir(cwd, { recursive: true });
await mkdir(join(state, 'azrael/devin'), { recursive: true });
await mkdir(join(state, 'agents'), { recursive: true });
await mkdir(join(appdata, 'devin'), { recursive: true });
await mkdir(logRoot, { recursive: true });
await writeFile(join(appdata, 'devin/credentials.toml'), 'windsurf_api_key = "synthetic-native-agents-fixture"\napi_server_url = "https://server.codeium.com"\n');
await copyFile(join(root, 'upstream/codex/codex-rs/models-manager/models.json'), join(state, 'azrael/devin/catalog.json'));
const families = { families: [{ family_label: 'SWE-2', family_uid: 'swe-2', slug: 'swe-2', aliases: [], variants: [{ model_uid: 'swe-2-medium', label: 'SWE-2 Medium', max_context_tokens: 200000, max_output_tokens: 16000 }] }] };
await writeFile(join(state, 'azrael/devin/models.json'), JSON.stringify(families));
await writeFile(join(cwd, 'models'), `process.stdout.write(${JSON.stringify(JSON.stringify(families))});`);
await writeFile(join(cwd, 'auth'), 'process.stdout.write("Logged in (via Devin).\\nEmail: native-agents@fixture.invalid\\nPlan: test\\n");');
await writeFile(join(state, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'synthetic-fixture', tokens: null, last_refresh: null }));
await writeFile(join(state, 'agents/devin_swe2_medium.toml'), 'model = "devin/swe-2-medium"\nsandbox_mode = "danger-full-access"\n');
await writeFile(join(state, 'config.toml'), `model = "devin/swe-2-medium"\nmodel_catalog_json = ${JSON.stringify(join(state, 'azrael/devin/catalog.json'))}\ncli_auth_credentials_store = "file"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n[features]\nplugins = false\nresponses_websockets = false\n\n[agents.devin_swe2_medium]\ndescription = "Native deterministic Devin fixture role"\nconfig_file = ${JSON.stringify(join(state, 'agents/devin_swe2_medium.toml'))}\n`);

const report = {
  scope: 'deterministic native Devin multi-agent lifecycle; fixture emits calls and engine executes tools',
  status: 'failed',
  checks: [],
};
let child;
let peer;
class Peer {
  constructor(process) {
    this.process = process;
    this.nextId = 0;
    this.pending = new Map();
    this.events = [];
    this.waiters = [];
    this.stderr = '';
    createInterface({ input: process.stdout }).on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id !== undefined && !message.method) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
        return;
      }
      if (message.id !== undefined && message.method) {
        process.stdin.write(JSON.stringify({ id: message.id, result: { decision: 'decline' } }) + '\n');
        return;
      }
      this.events.push(message);
      for (const waiter of [...this.waiters]) {
        if (!waiter.predicate(message)) continue;
        clearTimeout(waiter.timer);
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(message.params);
      }
    });
    process.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-256_000); });
    process.once('exit', code => {
      for (const pending of this.pending.values()) pending.reject(new Error(`engine_exit_${code}`));
      this.pending.clear();
    });
  }
  request(method, params) {
    return new Promise((resolvePromise, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout_${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.process.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  wait(predicate) {
    const found = this.events.find(predicate);
    if (found) return Promise.resolve(found.params);
    return new Promise((resolvePromise, reject) => {
      const waiter = { predicate, resolve: resolvePromise, timer: setTimeout(() => reject(new Error('notification_timeout')), timeoutMs) };
      this.waiters.push(waiter);
    });
  }
  async close() {
    this.process.stdin.end();
    await new Promise(resolvePromise => {
      const timer = setTimeout(() => { this.process.kill(); resolvePromise(); }, 5000);
      this.process.once('exit', () => { clearTimeout(timer); resolvePromise(); });
      if (this.process.exitCode !== null) { clearTimeout(timer); resolvePromise(); }
    });
  }
}

try {
  const env = {
    ...process.env,
    CODEX_HOME: state,
    APPDATA: appdata,
    AZRAEL_EX_DEVIN_EXECUTABLE: process.execPath,
    AZRAEL_EX_PLAINTEXT_AGENTS: '1',
    AZRAEL_DEVIN_NATIVE_HELPER: join(root, 'scripts/devin-native-agents-fixture.mjs'),
    AZRAEL_DEVIN_NODE: process.execPath,
    AZRAEL_NATIVE_AGENTS_TRACE: tracePath,
    RUST_LOG: 'codex_core::devin=info',
  };
  for (const key of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'AZRAEL_EX_MANAGEMENT_SOCKET', 'AZRAEL_EX_INSTANCE_ID']) delete env[key];
  child = spawn(engine, [
    '-c', 'features.code_mode_host=true',
    '-c', 'features.code_mode=false',
    '-c', 'features.multi_agent_v2.enabled=true',
    '-c', 'web_search="disabled"',
    '-c', 'features.plugins=false',
    'app-server',
  ], { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  peer = new Peer(child);
  await peer.request('initialize', { clientInfo: { name: 'azrael_native_agents_checker', version: '1' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  await peer.request('model/list', { includeHidden: true });
  const started = await peer.request('thread/start', {
    model: 'devin/swe-2-medium', cwd, approvalPolicy: 'never', sandbox: 'danger-full-access', ephemeral: false, experimentalRawEvents: true,
  });
  const rootThreadId = started.thread.id;
  const turn = await peer.request('turn/start', {
    threadId: rootThreadId,
    input: [{ type: 'text', text: 'Run the native agents lifecycle. ROOT_PRIVATE_CONTEXT_MUST_NOT_FORK_7391', text_elements: [] }],
  });
  const completed = await peer.wait(event => event.method === 'turn/completed' && event.params?.threadId === rootThreadId && event.params?.turn?.id === turn.turn.id);
  assert.equal(completed.turn.status, 'completed');

  const rootItems = peer.events.filter(event => event.method === 'item/completed' && event.params?.threadId === rootThreadId).map(event => event.params.item);
  const spawnItem = rootItems.find(item => item.type === 'subAgentActivity' && item.id === 'root-spawn');
  assert(spawnItem, 'missing completed spawnAgent item');
  assert.equal(typeof spawnItem.agentThreadId, 'string');
  const childThreadId = spawnItem.agentThreadId;
  const rawCalls = peer.events.filter(event =>
    event.method === 'rawResponseItem/completed' &&
    event.params?.threadId === rootThreadId &&
    event.params?.item?.type === 'function_call').map(event => event.params.item);
  const spawnCall = rawCalls.find(item => item.call_id === 'root-spawn');
  assert.deepEqual(JSON.parse(spawnCall.arguments), {
    task_name: 'native_fixture_child',
    agent_type: 'devin_swe2_medium',
    fork_turns: 'none',
    message: 'NATIVE_AGENTS_CHILD_TASK_7391: create child-native-result.txt with CHILD_PATCH_7391, read it using the native shell tool, then return CHILD_NATIVE_DONE_7391.',
  });
  assert(rootItems.some(item => item.type === 'collabAgentToolCall' && item.tool === 'wait'));
  assert(rawCalls.some(item => item.call_id === 'root-list' && item.name === 'list_agents' && item.namespace === 'azrael_agents'));
  report.checks.push('spawn_fork_none_wait_list_lifecycle');

  assert.equal((await readFile(join(cwd, 'child-native-result.txt'), 'utf8')).trim(), 'CHILD_PATCH_7391');
  const childHistory = await peer.request('thread/read', { threadId: childThreadId, includeTurns: true });
  const childItems = (childHistory.thread.turns ?? []).flatMap(value => value.items ?? []);
  assert.equal(childHistory.thread.model, 'devin/swe-2-medium');
  assert(childItems.some(item => item.type === 'fileChange'));
  assert(childItems.some(item => item.type === 'commandExecution'));
  assert(childItems.some(item => item.type === 'agentMessage' && item.text.includes('CHILD_NATIVE_DONE_7391')));
  report.checks.push('child_native_helper_patch_shell_and_result');

  const rootHistory = await peer.request('thread/read', { threadId: rootThreadId, includeTurns: true });
  const rootMessages = (rootHistory.thread.turns ?? []).flatMap(value => value.items ?? []).filter(item => item.type === 'agentMessage').map(item => item.text);
  assert(rootMessages.some(text => text.includes('PARENT_NATIVE_AGENTS_DONE_7391')));
  await writeFile(join(run, 'root-history.json'), JSON.stringify(rootHistory, null, 2));
  await writeFile(join(run, 'child-history.json'), JSON.stringify(childHistory, null, 2));
  report.checks.push('parent_completion_message_and_saved_native_histories');

  const trace = (await readFile(tracePath, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const childTrace = trace.filter(entry => entry.stage.startsWith('child-'));
  assert(childTrace.length >= 3);
  assert(childTrace.every(entry => entry.model === 'swe-2-medium' || entry.model === 'devin/swe-2-medium'));
  assert(childTrace.every(entry => entry.saw_root_private_marker === false));
  assert(trace.some(entry => entry.stage === 'root-finish' && entry.saw_child_completion));
  report.checks.push('child_devin_request_isolated_and_parent_received_message');
  report.status = 'passed';
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  if (peer) {
    await writeFile(join(logRoot, `${run.split(/[\\/]/).at(-1)}.stderr.log`), peer.stderr);
    await writeFile(join(run, 'events-summary.json'), JSON.stringify(peer.events.map(event => ({
      method: event.method,
      threadId: event.params?.threadId,
      itemType: event.params?.item?.type,
      tool: event.params?.item?.tool,
      status: event.params?.turn?.status,
    })), null, 2));
    await peer.close();
  }
  await writeFile(join(run, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, run }));
}

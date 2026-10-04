import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

const engine = process.argv[2], run = process.argv[3];
assert(engine && isAbsolute(engine), 'absolute engine path required');
assert(run && isAbsolute(run), 'absolute fresh fixture path required');
const root = resolve(import.meta.dirname, '..');
assert(resolve(run).startsWith(join(root, 'artifacts', 'verification') + '\\'), 'fixture must be under artifacts/verification');
await access(engine);
await mkdir(run); // Refuse reuse of state from an earlier run.
const logs = join(root, 'artifacts', 'logs', 'auto-account-switch', run.split(/[\\/]/).at(-1));
await mkdir(logs, { recursive: true });
const helper = join(root, 'scripts', 'auto-account-switch-fixture.mjs');
const model = 'managed/anthropic/fixture-auto-switch';
const timeout = 30000;
const tools = [{ type: 'namespace', name: 'effect_probe', description: 'Synthetic effect counter', tools: [{ type: 'function', name: 'increment', description: 'Increment exactly once', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] }];
const report = { engine, run, logs, status: 'failed', checks: [] };

class Peer {
  constructor(child, home, name) {
    this.child = child; this.home = home; this.events = []; this.pending = new Map(); this.waiters = []; this.next = 0; this.effects = 0;
    createInterface({ input: child.stdout }).on('line', line => {
      appendFileSync(join(logs, `${name}-stdout.jsonl`), line + '\n');
      let value; try { value = JSON.parse(line); } catch { return; }
      if (value.id !== undefined && value.method) {
        if (value.method !== 'item/tool/call' || value.params.namespace !== 'effect_probe' || value.params.tool !== 'increment') {
          this.protocolError = `unexpected_server_request:${value.method}`;
          child.stdin.write(JSON.stringify({ id: value.id, error: { code: -32601, message: this.protocolError } }) + '\n');
          return;
        }
        this.effects++;
        appendFileSync(join(home, 'effects.jsonl'), JSON.stringify({ count: this.effects, params: value.params }) + '\n');
        child.stdin.write(JSON.stringify({ id: value.id, result: { success: true, contentItems: [{ type: 'inputText', text: `EFFECT_RESULT_EXACT_${this.effects}` }] } }) + '\n');
      } else if (value.id !== undefined) {
        const pending = this.pending.get(value.id); if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(value.id);
        value.error ? pending.reject(new Error(JSON.stringify(value.error))) : pending.resolve(value.result);
      } else {
        this.events.push(value);
        for (const waiter of [...this.waiters]) if (waiter.predicate(value)) {
          clearTimeout(waiter.timer); this.waiters.splice(this.waiters.indexOf(waiter), 1); waiter.resolve(value.params);
        }
      }
    });
    child.stderr.on('data', chunk => appendFileSync(join(logs, `${name}-stderr.log`), chunk));
    const fail = error => { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pending.clear(); };
    child.on('error', fail); child.on('exit', code => fail(new Error(`engine_exit:${code}`)));
  }
  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout:${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      appendFileSync(join(this.home, 'client.jsonl'), JSON.stringify({ id, method, params }) + '\n');
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  wait(predicate) {
    const event = this.events.find(predicate); if (event) return Promise.resolve(event.params);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: setTimeout(() => { this.waiters.splice(this.waiters.indexOf(waiter), 1); reject(new Error('notification_timeout')); }, timeout) };
      this.waiters.push(waiter);
    });
  }
  async close() {
    for (const waiter of this.waiters) clearTimeout(waiter.timer);
    this.child.stdin.end();
    await new Promise(resolve => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) return resolve();
      const timer = setTimeout(() => { this.child.kill(); resolve(); }, 5000);
      this.child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}
async function rows(home) {
  try { return (await readFile(join(home, 'helper.jsonl'), 'utf8')).split('\n').filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function gate(home) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await rows(home)).some(row => row.kind === 'recovery')) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('recovery_gate_timeout');
}
async function scenario(name) {
  const home = join(run, name), state = join(home, 'codex'), cwd = join(home, 'work');
  await Promise.all([state, cwd, join(home, 'appdata'), join(home, 'temp')].map(path => mkdir(path, { recursive: true })));
  await writeFile(join(home, 'control.json'), JSON.stringify({ scenario: name, account: 'account-a' }));
  // Isolate native Devin catalog discovery from any installed/logged-in CLI.
  await writeFile(join(cwd, 'models'), 'process.stdout.write(JSON.stringify({families:[]}));');
  await writeFile(join(cwd, 'auth'), 'process.stdout.write("Not logged in.\\n");');
  await writeFile(join(state, 'config.toml'), `model = "${model}"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\ncli_auth_credentials_store = "file"\n[features]\nplugins = false\nresponses_websockets = false\n`);
  const env = { ...process.env, CODEX_HOME: state, APPDATA: join(home, 'appdata'), TEMP: join(home, 'temp'), TMP: join(home, 'temp'), OPENCODEX_HOME: join(state, 'azrael', 'providers', 'opencodex'), AZRAEL_AUTO_SWITCH_FIXTURE: home, AZRAEL_PROVIDER_INFERENCE_HELPER: helper, AZRAEL_PROVIDER_ACCOUNTS_HELPER: helper, AZRAEL_PROVIDER_BUN: process.execPath, AZRAEL_EX_PLAINTEXT_AGENTS: '1' };
  for (const key of Object.keys(env)) if (/API_KEY|ACCESS_TOKEN|AUTH_TOKEN|^OPENAI_BASE_URL$|^AZRAEL_EX_MANAGEMENT_SOCKET$|^AZRAEL_EX_INSTANCE_ID$|^(HTTP|HTTPS|ALL)_PROXY$|^AZRAEL_DEVIN_/i.test(key)) delete env[key];
  env.AZRAEL_EX_DEVIN_EXECUTABLE = process.execPath;
  const child = spawn(engine, ['-c', 'features.code_mode=false', '-c', 'features.plugins=false', '-c', 'web_search="disabled"', 'app-server'], { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const peer = new Peer(child, home, name);
  try {
    await peer.request('initialize', { clientInfo: { name: 'auto_account_switch_acceptance', version: '1' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const catalog = await peer.request('model/list', { includeHidden: true });
    assert(catalog.data.some(row => row.model === model), 'synthetic managed model selected through real catalog');
    const thread = await peer.request('thread/start', { model, cwd, approvalPolicy: 'never', sandbox: 'danger-full-access', ephemeral: false, dynamicTools: tools });
    const threadId = thread.thread.id;
    const started = await peer.request('turn/start', { threadId, model, input: [{ type: 'text', text: `AUTO_SWITCH_${name}: Increment the effect once, then return its exact result.`, text_elements: [] }] });
    const turnId = started.turn.id;
    if (name === 'cancel') {
      await gate(home);
      await peer.request('turn/interrupt', { threadId, turnId });
    }
    const end = await peer.wait(event => event.method === 'turn/completed' && event.params.threadId === threadId && event.params.turn.id === turnId);
    const success = name === 'usage';
    assert.equal(end.turn.status, success ? 'completed' : name === 'cancel' ? 'interrupted' : 'failed', JSON.stringify(end.turn.error));
    assert.equal(peer.effects, 1, 'effect executed exactly once');
    assert(!peer.protocolError, peer.protocolError);
    const history = await peer.request('thread/read', { threadId, includeTurns: true });
    await writeFile(join(home, 'history.json'), JSON.stringify(history, null, 2));
    assert.equal(history.thread.turns.length, 1, 'same turn retained');
    assert.equal(history.thread.turns[0].id, turnId);
    assert.equal(history.thread.turns[0].items.filter(item => item.type === 'userMessage').length, 1, 'no additional user messages');
    if (name === 'cancel') await new Promise(resolve => setTimeout(resolve, 200));
    const trace = await rows(home), inference = trace.filter(row => row.kind === 'inference'), recovery = trace.filter(row => row.kind === 'recovery');
    assert(inference.every(row => row.request.thread_id === threadId && row.request.turn_id === turnId), 'all inference belongs to original thread and turn');
    if (name === 'http' || name === 'rate') assert.equal(recovery.length, 0, 'generic errors must not recover');
    else assert(recovery.length > 0, 'confirmed quota enters real recovery branch');
    for (const row of recovery) {
      assert.equal(row.request.threadId, threadId); assert.equal(row.request.turnId, turnId);
      assert.equal(new Set(row.request.excludedAccountIds).size, row.request.excludedAccountIds.length, 'exclusions unique');
    }
    if (success) {
      assert.deepEqual(inference.map(row => row.account), ['account-a', 'account-a', 'account-b']);
      assert.equal(recovery.length, 1);
      assert(JSON.stringify(peer.events).includes('RECOVERED:EFFECT_RESULT_EXACT_1'));
      const continuation = JSON.stringify(inference.at(-1).request.input);
      assert(continuation.includes('EFFECT_RESULT_EXACT_1'));
      assert(!continuation.includes('PRIVATE_REASONING_SENTINEL'));
      assert(!continuation.includes('encrypted_content'));
      const warnings = peer.events.filter(event => /warning/i.test(event.method));
      assert(warnings.some(event => event.params?.message?.includes('자동 전환')), 'automatic account switch warning visible');
    } else if (name === 'exhaust-all') {
      assert.deepEqual(inference.map(row => row.account), ['account-a', 'account-a', 'account-b', 'account-c']);
      assert.equal(recovery.length, 3);
      assert(recovery[1].request.excludedAccountIds.includes('account-a'), 'initial source excluded on next recovery');
      assert(recovery[2].request.excludedAccountIds.includes('account-a') && recovery[2].request.excludedAccountIds.includes('account-b'), 'exhausted candidates excluded without cycles');
    } else if (name === 'no-candidate' || name === 'cancel') {
      assert.equal(recovery.length, 1);
      assert.equal(inference.length, 2, 'no new inference after no candidate or cancellation');
      assert.equal(JSON.parse(await readFile(join(home, 'control.json'), 'utf8')).account, 'account-a');
    }
    report.checks.push({ name, status: end.turn.status, effects: peer.effects, inferenceRequests: inference.length, recoveryRequests: recovery.length, threadId, turnId });
  } finally { await peer.close(); }
}
try {
  for (const name of ['usage', 'no-candidate', 'exhaust-all', 'http', 'rate', 'cancel']) await scenario(name);
  report.status = 'passed';
  console.log(JSON.stringify(report));
} catch (error) {
  report.error = error.stack; process.exitCode = 1; console.error(error.stack);
} finally { await writeFile(join(logs, 'report.json'), JSON.stringify(report, null, 2)); }

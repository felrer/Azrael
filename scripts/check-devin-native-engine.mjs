import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const engine = resolve(process.argv[2]);
const run = resolve(process.argv[3] ?? join(root, 'artifacts/verification/devin-native-20260915', `engine-${Date.now()}`));
const live = process.argv.includes('--live');
const codeMode = process.argv.includes('--code-mode');
const launcher = process.argv.includes('--launcher');
const catalogRefresh = process.argv.includes('--catalog-refresh');
const contextPolicy = process.argv.includes('--context-policy');
if (contextPolicy && live) throw new Error('context_policy_check_requires_synthetic_peer');
if (catalogRefresh && live) throw new Error('catalog_refresh_check_requires_synthetic_peer');
if (launcher && !live) throw new Error('launcher_check_requires_live_cli');
const bundledLauncher = join(dirname(dirname(engine)), 'scripts/start-devin-native.ps1');
const launcherScript = await access(bundledLauncher).then(() => bundledLauncher).catch(() => join(root, 'scripts/start-devin-native.ps1'));
const state = join(run, 'state');
const cwd = join(run, 'work');
const appdata = join(run, 'appdata');
const timeout = live ? 300_000 : 90_000;
await mkdir(cwd, { recursive: true });
await mkdir(join(run, 'temp'), { recursive: true });
await mkdir(join(state, 'azrael/devin'), { recursive: true });
await mkdir(join(appdata, 'devin'), { recursive: true });
await writeFile(join(appdata, 'devin/credentials.toml'), 'windsurf_api_key = "synthetic-native-fixture"\napi_server_url = "https://server.codeium.com"\n');
await copyFile(join(root, 'upstream/codex/codex-rs/models-manager/models.json'), join(state, 'azrael/devin/catalog.json'));
const families = { families: [{ family_label: 'SWE-2', family_uid: 'swe-2', slug: 'swe-2', aliases: [], variants: [{ model_uid: 'swe-2-high', label: 'SWE-2 High', max_context_tokens: 200000, max_output_tokens: 16000 }] }] };
await writeFile(join(cwd, 'models'), `process.stdout.write(${JSON.stringify(JSON.stringify(families))});`);
await writeFile(join(cwd, 'auth'), 'process.stdout.write("Logged in (via Devin).\\nEmail: native@fixture.invalid\\nPlan: test\\n");');
await writeFile(join(state, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'synthetic-fixture', tokens: null, last_refresh: null }));
await writeFile(join(state, 'config.toml'), `model = "devin/swe-2-high"\nmodel_catalog_json = ${JSON.stringify(join(state, 'azrael/devin/catalog.json'))}\ncli_auth_credentials_store = "file"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n[features]\nplugins = false\nresponses_websockets = false\n`);
if (!live) {
  const configPath = join(state, 'config.toml');
  // Native Windows deliberately downgrades workspace-write to read-only when
  // its sandbox is disabled. Select its existing restricted-token backend.
  await writeFile(configPath, await readFile(configPath, 'utf8') + `\n[windows]\nsandbox = "unelevated"\n\n[mcp_servers.native_probe]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(join(root, 'scripts/devin-native-mcp-fixture.mjs'))}]\n`);
}
// The snapshot is owned by the native Devin catalog loader; source is synthetic.
await writeFile(join(state, 'azrael/devin/models.json'), JSON.stringify(families));
let peer;
let generation = 0;
const report = { scope: live ? 'real Devin through new native Codex runtime' : 'native Codex tools/session/permissions with deterministic model peer', codeMode, launcher, ...(launcher ? { launcherScript } : {}), checks: [], status: 'failed' };
class Peer {
  constructor(child) {
    this.child = child; this.next = 0; this.pending = new Map(); this.events = []; this.waiters = []; this.approvals = []; this.stderr = ''; this.approvalDecision = 'decline';
    createInterface({ input: child.stdout }).on('line', line => {
      let value; try { value = JSON.parse(line); } catch { return; }
      if (value.id !== undefined && value.method) {
        this.approvals.push(value.method);
        const result = value.method === 'item/tool/call' ? {
          success: value.params.namespace === 'namespace_b' && value.params.tool === 'echo',
          contentItems: [{ type: 'inputText', text: value.params.namespace === 'namespace_b' ? 'namespace_b_result' : 'WRONG_NAMESPACE' }],
        } : { decision: this.approvalDecision };
        child.stdin.write(JSON.stringify({ id: value.id, result }) + '\n');
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
    child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-128000); });
    child.on('exit', code => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(`engine_exit_${code}`)); } this.pending.clear(); });
  }
  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.next; const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout_${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  wait(predicate) {
    const value = this.events.find(predicate); if (value) return Promise.resolve(value.params);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: setTimeout(() => { this.waiters.splice(this.waiters.indexOf(waiter), 1); reject(new Error('notification_timeout')); }, timeout) };
      this.waiters.push(waiter);
    });
  }
  async close() {
    for (const waiter of this.waiters) clearTimeout(waiter.timer);
    this.child.stdin.end();
    await new Promise(resolve => { const timer = setTimeout(() => { this.child.kill(); resolve(); }, 5000); this.child.once('exit', () => { clearTimeout(timer); resolve(); }); if (this.child.exitCode !== null) { clearTimeout(timer); resolve(); } });
  }
}
async function start() {
  generation++;
  const env = { ...process.env, CODEX_HOME: state, AZRAEL_EX_DEVIN_EXECUTABLE: process.execPath,
    ...(catalogRefresh ? { AZRAEL_NATIVE_CATALOG_BARRIER: join(run, 'catalog-release') } : {}),
    AZRAEL_EX_PLAINTEXT_AGENTS: '1', AZRAEL_DEVIN_NATIVE_HELPER: join(root, live ? 'providers/devin/helper.mjs' : 'scripts/devin-native-fixture.mjs'),
    AZRAEL_DEVIN_NODE: process.execPath, AZRAEL_NATIVE_FIXTURE_TRACE: join(run, `trace-${generation}.json`),
    ...(live ? {} : { APPDATA: appdata, TMP: join(run, 'temp'), TEMP: join(run, 'temp') }), RUST_LOG: live ? 'error,devin_native_progress=info' : (process.env.AZRAEL_NATIVE_CHECK_LOG ?? 'codex_core::devin=info,devin_native_progress=info') };
  for (const key of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'AZRAEL_EX_MANAGEMENT_SOCKET', 'AZRAEL_EX_INSTANCE_ID']) delete env[key];
  const args = launcher ? ['-NoProfile', '-File', launcherScript, '-EngineDirectory', dirname(engine), '-StateRoot', state, '-WorkspacePath', cwd, '-NodePath', process.execPath, '-AppServer', ...(codeMode ? ['-CodeMode'] : [])] :
    ['-c', 'features.code_mode_host=true', '-c', `features.code_mode=${codeMode}`, '-c', 'features.multi_agent_v2.enabled=true', '-c', 'web_search="disabled"', '-c', 'features.plugins=false', 'app-server'];
  const child = spawn(launcher ? 'pwsh' : engine, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  peer = new Peer(child);
  await peer.request('initialize', { clientInfo: { name: 'azrael_native_checker', version: '1' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  await peer.request('model/list', { includeHidden: true });
}
async function thread(sandbox = 'danger-full-access', approvalPolicy = 'never') {
  const result = await peer.request('thread/start', { model: 'devin/swe-2-high', cwd, approvalPolicy, sandbox, ephemeral: false, experimentalRawEvents: true });
  return result.thread.id;
}
async function turn(threadId, text) {
  const started = await peer.request('turn/start', { threadId, input: [{ type: 'text', text, text_elements: [] }] });
  const end = await peer.wait(event => event.method === 'turn/completed' && event.params.threadId === threadId && event.params.turn.id === started.turn.id);
  if (end.turn.status !== 'completed') throw new Error(`turn_${end.turn.status}:${JSON.stringify(end.turn.error)}`);
  return end;
}
try {
  await start();
  const id = await thread();
  const completion = turn(id, live ? 'Use apply_patch to create native-result.txt containing exactly NATIVE_PATCH_7391. Then use exec_command to read the file. Finally say NATIVE_TOOLS_VERIFIED. You must use both tools, preserve their results, and do not delegate.' : 'WRITE');
  completion.catch(() => {});
  if (catalogRefresh) {
    const deadline = Date.now() + 30_000;
    while (!(await access(join(run, 'catalog-release.ready')).then(() => true).catch(() => false))) {
      if (Date.now() > deadline) throw new Error('catalog_helper_not_started');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await writeFile(join(cwd, 'models'), 'process.exit(1);');
    try {
      await peer.request('model/list', { includeHidden: true, refresh: true });
      await writeFile(join(cwd, 'models'), 'process.stdout.write("invalid catalog");');
      await peer.request('model/list', { includeHidden: true, refresh: true });
    } finally {
      await writeFile(join(run, 'catalog-release'), 'continue');
    }
  }
  await completion;
  if (catalogRefresh) {
    assert.deepEqual(JSON.parse(await readFile(join(state, 'azrael/devin/models.json'), 'utf8')), families);
    report.checks.push('catalog_refresh_failure_during_tool_turn');
  }
  assert.equal((await readFile(join(cwd, 'native-result.txt'), 'utf8')).trim(), 'NATIVE_PATCH_7391');
  const history = await peer.request('thread/read', { threadId: id, includeTurns: true });
  await writeFile(join(run, 'history.json'), JSON.stringify(history, null, 2));
  assert(peer.events.some(event => event.params?.item?.type === 'commandExecution'));
  assert(peer.events.some(event => event.params?.item?.type === 'fileChange'));
  report.checks.push('native_patch_and_shell_results');
  if (contextPolicy) {
    const usage = peer.events.filter(event => event.method === 'thread/tokenUsage/updated' && event.params.threadId === id).at(-1)?.params.tokenUsage;
    assert.equal(usage?.contextPolicy?.providerId, 'devin');
    assert.equal(usage.contextPolicy.autoCompactTokenLimit, 190000);
    assert.equal(usage.contextPolicy.pricing.status, 'unknown');
    const fork = await peer.request('thread/fork', { threadId: id, cwd });
    await peer.request('thread/compact/start', { threadId: fork.thread.id });
    await peer.wait(event => event.params?.threadId === fork.thread.id && event.method === 'item/completed' && event.params.item?.type === 'contextCompaction');
    await peer.wait(event => event.params?.threadId === fork.thread.id && event.method === 'turn/completed');
    report.checks.push('devin_95_percent_policy_and_native_summary_transport');
  }
  await peer.close();
  await start();
  await peer.request('thread/resume', { threadId: id, cwd });
  const resumeOffset = peer.events.length;
  await turn(id, live ? 'Without any new tool calls, state the exact file contents read by the previous command and confirm you retained its result.' : 'RESUME');
  const resumedEvents = peer.events.slice(resumeOffset);
  const resumedText = resumedEvents.filter(event => event.method === 'item/completed' && event.params?.item?.type === 'agentMessage').map(event => event.params.item.text).join('\n');
  assert(resumedText.includes(live ? 'NATIVE_PATCH_7391' : 'RESUME_PRESERVED_NATIVE_RESULTS'));
  assert(!resumedEvents.some(event => ['commandExecution', 'fileChange'].includes(event.params?.item?.type)));
  report.checks.push('process_restart_native_resume');
  if (catalogRefresh) {
    await writeFile(join(cwd, 'models'), 'process.stdout.write(JSON.stringify({families:[]}));');
    const empty = await peer.request('model/list', { includeHidden: true, refresh: true });
    assert.deepEqual(JSON.parse(await readFile(join(state, 'azrael/devin/models.json'), 'utf8')), { families: [] });
    assert(!empty.data.some(model => model.id.startsWith('devin/')));
    report.checks.push('successful_empty_catalog_remains_authoritative');
  }
  if (!live && !catalogRefresh) {
    const before = peer.events.length;
    await turn(await thread('read-only'), 'READONLY');
    await assert.rejects(access(join(cwd, 'denied-result.txt')));
    report.checks.push('read_only_patch_denied');
    await turn(await thread('workspace-write'), 'WORKSPACE_INSIDE');
    assert.equal((await readFile(join(cwd, 'workspace-inside.txt'), 'utf8')).trim(), 'WORKSPACE_CHECK');
    await turn(await thread('workspace-write'), 'WORKSPACE_OUTSIDE');
    await assert.rejects(access(join(run, 'workspace-outside.txt')));
    report.checks.push('workspace_write_boundary');
    const approvalsBefore = peer.approvals.length;
    await turn(await thread('read-only', 'on-request'), 'APPROVAL_DENY');
    await assert.rejects(access(join(cwd, 'approved-result.txt')));
    assert(peer.approvals.length > approvalsBefore);
    report.checks.push('approval_denial');
    peer.approvalDecision = 'accept';
    await turn(await thread('read-only', 'on-request'), 'APPROVAL_ALLOW');
    assert.equal((await readFile(join(cwd, 'approved-result.txt'), 'utf8')).trim(), 'APPROVED');
    peer.approvalDecision = 'decline';
    report.checks.push('approval_allow_once');
    const namespaces = ['namespace_a', 'namespace_b'].map(name => ({ type: 'namespace', name, description: 'Compatibility fixture', tools: [{ type: 'function', name: 'echo', description: 'Return namespace identity', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } }] }));
    if (!codeMode) {
      await turn(await thread(), 'MCP');
      report.checks.push('native_mcp_tool_result_roundtrip');
      const dynamic = await peer.request('thread/start', { model: 'devin/swe-2-high', cwd, approvalPolicy: 'never', sandbox: 'danger-full-access', dynamicTools: namespaces });
      await turn(dynamic.thread.id, 'DYNAMIC');
      assert(peer.approvals.includes('item/tool/call'));
      report.checks.push('dynamic_same_name_namespace_dispatch');
    }
    const bad = await thread();
    await assert.rejects(turn(bad, 'BAD_EOF'), /turn_failed/);
    await assert.rejects(access(join(cwd, 'bad-eof.txt')));
    report.checks.push('truncated_helper_does_not_execute');
    const cancel = await thread();
    const started = await peer.request('turn/start', { threadId: cancel, input: [{ type: 'text', text: 'CANCEL', text_elements: [] }] });
    const cancelDeadline = Date.now() + 30_000;
    while (true) {
      const trace = await readFile(join(run, `trace-${generation}.json`), 'utf8').then(JSON.parse).catch(() => ({}));
      if (trace.mode === 'cancel') break;
      if (Date.now() > cancelDeadline) throw new Error('cancel_helper_not_started');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await peer.request('turn/interrupt', { threadId: cancel, turnId: started.turn.id });
    const ended = await peer.wait(event => event.method === 'turn/completed' && event.params.threadId === cancel && event.params.turn.id === started.turn.id);
    assert.equal(ended.turn.status, 'interrupted');
    report.checks.push('native_cancel');
    report.policyEvents = peer.events.slice(before).filter(event => event.method === 'item/completed').map(event => event.params.item.type);
  }
  if (!live && !process.env.AZRAEL_NATIVE_CHECK_LOG) {
    assert(peer.stderr.includes('native_inference_progress'), 'progress telemetry must reach the engine log sink');
    report.checks.push('native_progress_log');
  }
  report.status = 'passed';
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  if (peer) {
    if (!live) await writeFile(join(run, 'engine-fixture.stderr.log'), peer.stderr);
    await writeFile(join(run, 'events-summary.json'), JSON.stringify(peer.events.map(event => ({ method: event.method, threadId: event.params?.threadId, itemType: event.params?.item?.type, status: event.params?.turn?.status })), null, 2));
    await peer.close();
  }
  await writeFile(join(run, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, run }));
}

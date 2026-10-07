import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const latest = JSON.parse(await readFile(join(root, 'artifacts/latest.json'), 'utf8'));
const engineDir = join(latest.releaseDirectory, 'engine');
const engine = join(engineDir, 'codex.exe');
const binaryOnly = process.argv.includes('--binary-only');
if (binaryOnly) assert.equal(resolve(engineDir), join(root, 'artifacts/releases/use_control_settings_20261007_r2/engine'), 'binary-only scope pins the originally selected release');
const fixture = join(root, 'artifacts/verification/auto-review-20261007-openai');
const logs = join(root, 'artifacts/logs/auto-review-20261007/openai');
await mkdir(logs, { recursive: true });
const summary = { status: 'failed', engine, engineReused: true, built: false, syntheticOnly: true, binaryOnly, scenarios: [], checks: [], unrun: [] };
const scenarios = ['allow', 'deny', 'malformed', 'routine', 'never', 'manual'];
const expectedSchema = { type: 'object', additionalProperties: false, properties: {
  risk_level: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
  user_authorization: { type: 'string', enum: ['unknown', 'low', 'medium', 'high'] },
  outcome: { type: 'string', enum: ['allow', 'deny'] }, rationale: { type: 'string' },
}, required: ['outcome'] };
const provenance = spawnSync('python', ['-B', join(root, 'scripts/engine-provenance.py'), 'verify', '--root', join(root, 'engine'), '--engine-dir', engineDir], { encoding: 'utf8', windowsHide: true });
await writeFile(join(logs, binaryOnly ? 'current-source-check.log' : 'provenance.log'), provenance.stdout + provenance.stderr);
summary.provenanceExitCode = provenance.status;
const receipt = JSON.parse(await readFile(join(engineDir, 'azrael-engine-build.json'), 'utf8'));
summary.receipt = { path: join(engineDir, 'azrael-engine-build.json'), comparedSourceRoot: join(root, 'engine'), source: receipt.source, binaries: receipt.binaries };
summary.currentSourceMatch = provenance.status === 0;
summary.scope = binaryOnly ? 'Existing receipt-verified binary public API only; current engine sources/package compatibility unaccepted' : 'Source and binary verified public API';
for (const name of ['codex.exe', 'azrael-bridge.exe', 'codex-code-mode-host.exe']) {
  const actual = createHash('sha256').update(await readFile(join(engineDir, name))).digest('hex');
  assert.equal(actual, receipt.binaries[name], `receipt binary hash ${name}`);
}
summary.binaryReceiptHashesMatch = true;
class Peer {
  constructor(child) {
    this.child = child; this.next = 0; this.pending = new Map(); this.events = []; this.approvals = []; this.stderr = ''; this.wire = [];
    createInterface({ input: child.stdout }).on('line', line => {
      this.wire.push(line); let value; try { value = JSON.parse(line); } catch { return; }
      if (value.id !== undefined && value.method) {
        this.approvals.push(value); child.stdin.write(JSON.stringify({ id: value.id, result: { decision: 'decline' } }) + '\n');
      } else if (value.id !== undefined) {
        const p = this.pending.get(value.id); if (!p) return; clearTimeout(p.timer); this.pending.delete(value.id);
        value.error ? p.reject(new Error(JSON.stringify(value.error))) : p.resolve(value.result);
      } else this.events.push(value);
    });
    child.stderr.on('data', chunk => { this.stderr += chunk; });
    child.on('exit', code => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(`engine_exit_${code}`)); } this.pending.clear(); });
  }
  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.next; const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout_${method}`)); }, 30000);
      this.pending.set(id, { resolve, reject, timer }); this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  async completed(threadId, turnId) {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const value = this.events.find(e => e.method === 'turn/completed' && e.params.threadId === threadId && e.params.turn.id === turnId);
      if (value) return value.params;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('turn_completion_timeout');
  }
  async close() {
    this.child.stdin.end();
    await new Promise(resolve => { const timer = setTimeout(() => { this.child.kill(); resolve(); }, 5000); this.child.once('exit', () => { clearTimeout(timer); resolve(); }); if (this.child.exitCode !== null) { clearTimeout(timer); resolve(); } });
  }
}
async function scenario(name) {
  const run = join(fixture, name), state = join(run, 'state'), cwd = join(run, 'work'), appdata = join(run, 'appdata');
  for (const path of [state, cwd, appdata, join(run, 'temp'), join(run, 'home'), join(run, 'localappdata')]) await mkdir(path, { recursive: true });
  await writeFile(join(state, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'synthetic-fixture', tokens: null, last_refresh: null }));
  const baseCatalog = JSON.parse(await readFile(join(root, 'engine/codex-rs/models-manager/models.json'), 'utf8'));
  const parent = { ...baseCatalog.models.find(m => m.slug === 'gpt-6.1-sol'), tool_mode: 'standard', use_responses_lite: false, prefer_websockets: false, node_repl_auto_review_required: false };
  const reviewer = { ...baseCatalog.models.find(m => m.slug === 'codex-auto-review'), use_responses_lite: false, prefer_websockets: false };
  assert(parent.slug && reviewer, 'pinned catalog must contain parent and native reviewer');
  await writeFile(join(state, 'catalog.json'), JSON.stringify({ models: [parent, reviewer] }));
  const trace = join(logs, `${name}-requests.jsonl`); await writeFile(trace, '');
  let releaseFirst, firstReceived;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const firstRequest = new Promise(resolve => { firstReceived = resolve; });
  const requests = [], serverErrors = [], unexpectedRoutes = [];
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/v1/responses') { unexpectedRoutes.push({ method: req.method, url: req.url }); res.writeHead(404); res.end(); return; }
      let raw = ''; for await (const chunk of req) { raw += chunk; assert(raw.length < 4_000_000, 'bounded request size'); }
      const body = JSON.parse(raw), format = body.text?.format;
      const isReviewer = format?.type === 'json_schema' && format.schema?.properties?.risk_level !== undefined;
      requests.push({ reviewer: isReviewer, body }); appendFileSync(trace, JSON.stringify({ reviewer: isReviewer, body }) + '\n');
      assert(requests.length <= 6, 'bounded inference request count, no recursive review');
      if (requests.length === 1) { firstReceived(); await firstGate; }
      const id = `${name}_${requests.length}`;
      let item;
      if (isReviewer) {
        assert.deepEqual(format.schema, expectedSchema, 'exact native Guardian schema');
        assert.deepEqual({ type: format.type, name: format.name, strict: format.strict }, { type: 'json_schema', name: 'codex_output_schema', strict: false });
        assert(['codex-auto-review', parent.slug].includes(body.model), 'native reviewer selection or parent fallback');
        const text = name === 'malformed' ? 'INVALID_GUARDIAN_JSON' : JSON.stringify({ risk_level: name === 'allow' ? 'low' : 'high', user_authorization: 'high', outcome: name === 'allow' ? 'allow' : 'deny', rationale: `fixture ${name}` });
        item = { type: 'message', id: `${id}_message`, role: 'assistant', content: [{ type: 'output_text', text }] };
      } else if (body.input.some(i => i.type === 'function_call_output')) {
        item = { type: 'message', id: `${id}_message`, role: 'assistant', content: [{ type: 'output_text', text: 'FIXTURE_TOOL_RESULT_RECORDED' }] };
      } else {
        const tools = body.tools.flatMap(t => t.type === 'namespace' ? t.tools.map(child => ({ ...child, namespace: t.name })) : [t]);
        const tool = tools.find(t => t.name === 'exec_command'); assert(tool, 'native exec_command declared');
        item = { type: 'function_call', call_id: 'fixture-marker', name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}), arguments: JSON.stringify({ cmd: "Set-Content -LiteralPath marker.txt -Value FIXTURE_MARKER", max_output_tokens: 100, ...(['routine', 'never'].includes(name) ? {} : { sandbox_permissions: 'require_escalated', justification: 'Harmless synthetic fixture marker' }) }) };
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      for (const frame of [{ type: 'response.created', response: { id } }, { type: 'response.output_item.done', item }, { type: 'response.completed', response: { id, usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 } } }]) res.write(`event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`);
      res.end();
    } catch (error) { serverErrors.push(String(error.stack ?? error)); if (!res.headersSent) res.writeHead(400); res.end('synthetic fixture failure'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await writeFile(join(state, 'config.toml'), `model = "gpt-6.1-sol"\nmodel_provider = "openai"\nopenai_base_url = "http://127.0.0.1:${server.address().port}/v1"\nmodel_catalog_json = ${JSON.stringify(join(state, 'catalog.json'))}\ncli_auth_credentials_store = "file"\napproval_policy = "on-request"\nsandbox_mode = "read-only"\n[features]\nplugins = false\nresponses_websockets = false\nshell_snapshot = false\n`);
  // Minimal environment excludes real provider credentials, proxies and host-mode guards.
  const env = { CODEX_HOME: state, APPDATA: appdata, LOCALAPPDATA: join(run, 'localappdata'), HOME: join(run, 'home'), USERPROFILE: join(run, 'home'), TMP: join(run, 'temp'), TEMP: join(run, 'temp'), RUST_LOG: 'error', NO_PROXY: '127.0.0.1,localhost', PATH: process.env.PATH, OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` };
  for (const key of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'SYSTEMDRIVE']) if (process.env[key]) env[key] = process.env[key];
  let peer;
  const start = async generation => {
    peer = new Peer(spawn(engine, ['-c', 'features.code_mode=false', '-c', 'features.plugins=false', '-c', 'web_search="disabled"', 'app-server'], { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }));
    peer.generation = generation;
    await peer.request('initialize', { clientInfo: { name: 'auto_review_fixture', version: '1' }, capabilities: { experimentalApi: true } }); peer.child.stdin.write('{"method":"initialized"}\n');
  };
  const stop = async () => { if (!peer) return; await peer.close(); await writeFile(join(logs, `${name}-${peer.generation}-rpc.jsonl`), peer.wire.join('\n') + '\n'); await writeFile(join(logs, `${name}-${peer.generation}-stderr.log`), peer.stderr); };
  const result = { name };
  try {
    await start(1);
    const catalog = await peer.request('model/list', { includeHidden: true });
    assert(catalog.data.some(model => model.id === 'codex-auto-review')); result.nativeReviewerCatalog = true;
    const policy = name === 'never' ? 'never' : 'on-request';
    const started = await peer.request('thread/start', { model: 'gpt-6.1-sol', modelProvider: 'openai', cwd, approvalPolicy: policy, approvalsReviewer: 'guardian_subagent', sandbox: ['routine', 'never'].includes(name) ? 'danger-full-access' : 'read-only', experimentalRawEvents: true });
    assert.equal(started.approvalsReviewer, 'auto_review'); assert.equal(started.approvalPolicy, policy);
    const threadId = started.thread.id;
    await peer.request('thread/settings/update', { threadId, approvalsReviewer: 'user' });
    await peer.request('thread/settings/update', { threadId, approvalPolicy: policy, approvalsReviewer: 'guardian_subagent' });
    result.legacyStartAndUpdate = true;
    const turn = await peer.request('turn/start', { threadId, ...(name === 'manual' ? { approvalsReviewer: 'user', model: parent.slug } : { approvalsReviewer: 'guardian_subagent' }), input: [{ type: 'text', text: 'Run the harmless fixture marker command.', text_elements: [] }] });
    result.explicitTurnReviewer = name === 'manual' ? 'user' : 'guardian_subagent';
    await Promise.race([firstRequest, new Promise((_, reject) => setTimeout(() => reject(new Error('first_loopback_request_timeout')), 30000).unref())]);
    if (name === 'allow') { const update = await peer.request('turn/settings/update', { threadId, turnId: turn.turn.id, approvalsReviewer: 'guardian_subagent' }); assert.equal(update.status, 'applied'); result.activeTurnLegacyUpdate = true; }
    releaseFirst();
    result.turn = (await peer.completed(threadId, turn.turn.id)).turn;
    result.finalThreadSettings = peer.events.filter(e => e.method === 'thread/settings/updated' && e.params.threadId === threadId).at(-1)?.params.threadSettings;
    if (name === 'manual') {
      assert.equal(result.finalThreadSettings?.approvalsReviewer, 'user');
      assert.equal(result.finalThreadSettings.approvalPolicy, policy);
      assert.deepEqual(result.finalThreadSettings.sandboxPolicy, started.sandbox);
      assert.equal(result.finalThreadSettings.model, parent.slug);
    }
    result.markerExists = await access(join(cwd, 'marker.txt')).then(() => true).catch(() => false);
    result.humanApprovalRpcCount = peer.approvals.length; assert.equal(peer.approvals.length, name === 'manual' ? 1 : 0);
    result.requests = requests.map(({ reviewer, body }) => ({ reviewer, model: body.model, format: body.text?.format }));
    result.guardianEvents = peer.events.filter(e => JSON.stringify(e).toLowerCase().includes('guardian') || e.method?.includes('autoApprovalReview'));
    assert.deepEqual(serverErrors, []);
    result.rejectedRoutes = unexpectedRoutes;
    assert(unexpectedRoutes.every(r => r.method === 'GET' && r.url === '/v1/responses'), 'only rejected native WebSocket capability probes permitted');
    assert(unexpectedRoutes.length <= 12, 'bounded capability probes');
    const reviewers = result.requests.filter(r => r.reviewer);
    if (['routine', 'never', 'manual'].includes(name)) assert.equal(reviewers.length, 0);
    else {
      assert.equal(reviewers.length, name === 'malformed' ? 3 : 1, 'bounded native assessment retry count');
      const starts = result.guardianEvents.filter(e => e.method === 'item/autoApprovalReview/started');
      const ends = result.guardianEvents.filter(e => e.method === 'item/autoApprovalReview/completed');
      assert.equal(starts.length, 1, 'one Guardian review, no recursive review'); assert.equal(ends.length, 1);
      assert.equal(starts[0].params.reviewId, ends[0].params.reviewId);
      result.reviewInferenceAttempts = reviewers.length;
    }
    assert.equal(result.markerExists, ['allow', 'routine', 'never'].includes(name));
    if (name === 'allow' || name === 'deny') assert(JSON.stringify(result.guardianEvents).includes(`fixture ${name}`));
    if (name === 'malformed') assert(/failed|not valid JSON/.test(JSON.stringify(result.guardianEvents)), 'malformed review fails closed');
    await stop(); await start(2);
    const resumed = await peer.request('thread/resume', { threadId, cwd, approvalPolicy: policy, sandbox: ['routine', 'never'].includes(name) ? 'danger-full-access' : 'read-only', approvalsReviewer: 'guardian_subagent' });
    result.resumedReviewer = resumed.approvalsReviewer;
    if (name !== 'manual') assert.equal(resumed.approvalsReviewer, 'auto_review');
    assert.equal(resumed.approvalPolicy, policy); assert.deepEqual(resumed.sandbox, started.sandbox); result.legacyResumeAfterRestart = true;
    result.status = 'passed';
  } catch (error) { result.status = 'failed'; result.error = String(error.stack ?? error); throw Object.assign(error, { scenarioResult: result }); }
  finally { releaseFirst(); await stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  return result;
}
try {
  if (!binaryOnly) assert.equal(provenance.status, 0, 'binary/source provenance must match');
  await assert.rejects(access(fixture), 'fixture must be fresh');
  for (const name of scenarios) summary.scenarios.push(await scenario(name));
  summary.status = 'passed';
} catch (error) {
  if (error.scenarioResult) summary.scenarios.push(error.scenarioResult);
  summary.error = String(error.stack ?? error); summary.unrun = scenarios.filter(name => !summary.scenarios.some(s => s.name === name)); process.exitCode = 1;
} finally { await writeFile(join(logs, 'summary.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify({ status: summary.status, summary: join(logs, 'summary.json'), error: summary.error })); }

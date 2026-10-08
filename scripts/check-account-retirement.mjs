import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonLinePeer, RpcError, stopChild, waitForExit } from './lib/azrael-rpc-check.mjs';
import { accountFixtureEnvironment } from './account-fixture-environment.mjs';
import { OpenAiAutoSwitchFixture } from './openai-auto-switch-fixture.mjs';

// Real app-server acceptance, using only disposable file-backed credentials.
// Usage: node scripts/check-account-retirement.mjs <absolute engine> <fresh absolute fixture>
const [engine, argument, scenarioOnly] = process.argv.slice(2);
assert(scenarioOnly === undefined || scenarioOnly === '--no-candidate-only', 'optional --no-candidate-only accepted');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert(engine && isAbsolute(engine) && argument && isAbsolute(argument), 'absolute engine and fresh fixture paths required');
const run = resolve(argument), retained = join(root, 'artifacts', 'verification');
const rel = relative(retained, run);
assert(rel && !rel.startsWith('..') && !isAbsolute(rel), 'fixture must be below artifacts/verification');
await access(engine);
await mkdir(run); // Refuse reuse, including state belonging to other work.
const logs = join(root, 'artifacts', 'logs', 'account-retirement', 'engine-probe', rel.replaceAll(/[\\/]/g, '-'));
await mkdir(logs, { recursive: true });
const report = { engine, run, status: 'failed', checks: [], gaps: ['unrelated managed-provider concurrent turn', 'queued work and parked reservations'], cleanup: null };
const peers = new Set(), backendRequests = [];
const model = 'azrael-retirement-fixture';
const accounts = ['a', 'b', 'c'].map(letter => ({ accountId: `retirement-${letter}`, userId: `retirement-user-${letter}`, email: `retirement-${letter}@example.invalid`, refreshToken: `retirement-refresh-${letter}` }));
const completionFixture = new OpenAiAutoSwitchFixture(accounts);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, description) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await delay(50); }
  throw new Error(`${description} timed out`);
}
function auth(account) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'none' })}.${encode({ email: account.email, exp: Math.floor(Date.now() / 1000) + 86400, 'https://api.openai.com/auth': { chatgpt_account_id: account.accountId, chatgpt_user_id: account.userId, user_id: account.userId, chatgpt_plan_type: 'team' } })}.fixture`;
  return { auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens: { id_token: token, access_token: token, refresh_token: account.refreshToken, account_id: account.accountId }, last_refresh: new Date().toISOString() };
}
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    const accountId = request.headers['chatgpt-account-id'];
    let bearerOwner;
    try { bearerOwner = JSON.parse(Buffer.from(request.headers.authorization?.replace(/^Bearer /, '').split('.')[1], 'base64url').toString())['https://api.openai.com/auth']?.chatgpt_account_id; } catch { /* Non-authenticated local discovery requests have no bearer. */ }
    backendRequests.push({ path, accountId, bearerOwner });
    const send = body => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (path === '/oauth/revoke') { request.resume(); send({}); return; }
    if (path === '/oauth/token') {
      let body = ''; for await (const chunk of request) body += chunk;
      const account = accounts.find(row => row.refreshToken === JSON.parse(body).refresh_token);
      assert(account, 'foreign refresh token'); send(auth(account).tokens); return;
    }
    if (path.endsWith('/wham/accounts/check')) {
      send({ accounts: accounts.map(row => ({ id: row.accountId, plan_type: 'team', workspace_backend_origin: 'https://retirement.invalid', account_routing_override: 'NO_CONSTRAINT' })), account_ordering: accounts.map(row => row.accountId), default_account_id: accountId }); return;
    }
    if (path.endsWith('/wham/usage')) {
      assert(accounts.some(row => row.accountId === accountId), 'foreign usage owner');
      if (!candidateAvailable && accountId === accounts[1].accountId) {
        response.writeHead(429, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { type: 'rate_limit_error', message: 'Synthetic candidate temporarily unavailable' } })); return;
      }
      send({ plan_type: 'team', account_id: accountId, user_id: accounts.find(row => row.accountId === accountId).userId, rate_limit: { allowed: true, limit_reached: false, primary_window: { used_percent: 10, limit_window_seconds: 300, reset_after_seconds: 60, reset_at: 2000000000 } }, rate_limit_reset_credits: { available_count: 0 } }); return;
    }
    if (path.endsWith('/responses')) {
      if (accountId !== accounts[0].accountId) { await completionFixture.respond(request, response); return; }
      let body = ''; for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      const owner = JSON.parse(Buffer.from(request.headers.authorization.replace(/^Bearer /, '').split('.')[1], 'base64url').toString())['https://api.openai.com/auth'].chatgpt_account_id;
      assert.equal(owner, accountId, 'source bearer owner mismatch');
      assert(!payload.input?.some(item => item.type === 'function_call_output'), 'retired pending tool must never replay');
      const id = `retirement-response-${backendRequests.length}`;
      const events = [
        { type: 'response.created', response: { id } },
        { type: 'response.output_item.done', item: { type: 'function_call', id: `${id}-item`, namespace: 'effect_probe', name: 'increment', call_id: `${id}-call`, arguments: '{}' } },
        { type: 'response.completed', response: { id, usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 } } },
      ];
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')); return;
    }
    if (path.endsWith('/config/bundle')) { send({}); return; }
    request.resume(); response.writeHead(404); response.end('{}');
  } catch (error) { report.backendError = error.stack; if (!response.headersSent) response.writeHead(500); response.end('{}'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
let state, cwd, catalog;
let candidateAvailable = true;
async function start(name) {
  const selection = join(state, 'windows', `${name}.json`);
  let env = accountFixtureEnvironment(process.env, { stateDirectory: state, socketPath: '', baseUrl, autoSwitchOnly: true });
  for (const key of Object.keys(env)) if (/API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|AUTH_TOKEN|SECRET|^AZRAEL_DEVIN_|^AZRAEL_PROVIDER_|^AZRAEL_EX_INSTANCE_ID$|^OPENAI_BASE_URL$/i.test(key)) delete env[key];
  env = { ...env, HTTP_PROXY: baseUrl, AZRAEL_EX_ACCOUNT_STATE_FILE: selection, AZRAEL_EX_ACCOUNT_DEFAULT_FILE: join(state, 'default.json'), APPDATA: join(state, 'appdata'), TEMP: join(state, 'temp'), TMP: join(state, 'temp'), AZRAEL_EX_DEVIN_EXECUTABLE: process.execPath, OPENCODEX_HOME: join(state, 'azrael', 'providers', 'opencodex') };
  const child = spawn(engine, ['-c', 'features.code_mode=false', '-c', 'features.plugins=false', '-c', 'features.apps=false', '-c', 'web_search="disabled"', '-c', 'cli_auth_credentials_store="file"', '-c', `chatgpt_base_url="${baseUrl}/backend-api"`, '-c', `model="${model}"`, '-c', 'model_provider="azrael_mock"', '-c', `model_providers.azrael_mock={name="Retirement fixture",base_url="${baseUrl}/v1",wire_api="responses",requires_openai_auth=true,supports_websockets=false,request_max_retries=0,stream_max_retries=0}`, '-c', `model_catalog_json="${catalog.replaceAll('\\', '/')}"`, ...(/^codex-app-server(?:-[a-z0-9-]+)?(?:\.exe)?$/i.test(basename(engine)) ? [] : ['app-server'])], { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const peer = new JsonLinePeer(child, name);
  const instance = { peer, child, selection, name, events: [], tools: [], stderr: '' };
  peers.add(instance);
  child.stderr.on('data', chunk => { instance.stderr = (instance.stderr + chunk).slice(-16000); });
  // Reuse the existing RPC peer; it deliberately ignores unsolicited request IDs.
  instance.observer = createInterface({ input: child.stdout });
  instance.observer.on('line', line => {
    try {
      const message = JSON.parse(line);
      if (message.method === 'item/tool/call' && message.id !== undefined) instance.tools.push(message);
      else if (message.method) instance.events.push(message);
    } catch { /* JsonLinePeer reports malformed protocol. */ }
  });
  await peer.request('initialize', { clientInfo: { name: 'retirement_acceptance', version: '1' }, capabilities: { experimentalApi: true } });
  peer.notify('initialized');
  return instance;
}
const account = (instance, action, profileId) => instance.peer.request('azrael/account', { action, ...(profileId === undefined ? {} : { profileId }) });
async function selected(instance, expected) {
  let observed;
  try { return await until(async () => { observed = (await account(instance, 'list')).state; return !observed.isSwitching && observed.activeProfileId === expected && observed; }, `${instance.name} selected ${expected}`); }
  catch (error) { report.lastSelectionFailure = { instance: instance.name, expected, observed }; throw error; }
}
async function close(instance) {
  await stopChild(instance.child, instance.name);
  assert(instance.child.exitCode !== null || instance.child.signalCode !== null, 'fixture engine still running');
  instance.peer.close(); instance.observer.close(); peers.delete(instance);
  if (instance.stderr) await writeFile(join(logs, `${instance.name}-stderr.log`), instance.stderr);
}
async function startTurn(instance) {
  const thread = await instance.peer.request('thread/start', { cwd, model, ephemeral: false, approvalPolicy: 'never', sandbox: 'danger-full-access', dynamicTools: [{ type: 'namespace', name: 'effect_probe', description: 'Retirement pending effect', tools: [{ type: 'function', name: 'increment', description: 'Increment', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] }] });
  const threadId = thread.thread.id;
  const result = await instance.peer.request('turn/start', { threadId, input: [{ type: 'text', text: 'RETIREMENT_PENDING_TOOL', text_elements: [] }] });
  const turnId = result.turn.id;
  await until(() => instance.tools.find(row => row.params.threadId === threadId), `${instance.name} pending tool`);
  return { threadId, turnId };
}
async function scenario(name, withCandidate) {
  state = join(run, name); cwd = join(state, 'work'); catalog = join(state, 'models.json');
  await Promise.all([cwd, join(state, 'windows'), join(state, 'temp'), join(state, 'appdata')].map(path => mkdir(path, { recursive: true })));
  await writeFile(join(cwd, 'models'), 'process.stdout.write(JSON.stringify({families:[]}));');
  await writeFile(join(cwd, 'auth'), 'process.stdout.write("Not logged in.\\n");');
  const bundled = JSON.parse(await readFile(join(root, 'upstream', 'codex', 'codex-rs', 'models-manager', 'models.json'), 'utf8'));
  const info = structuredClone(bundled.models.find(row => row.tool_mode === null));
  Object.assign(info, { slug: model, display_name: model, prefer_websockets: false, use_responses_lite: false });
  await writeFile(catalog, JSON.stringify({ models: [info] }));
  const profiles = [];
  for (const fixture of (withCandidate ? accounts : accounts.slice(0, 2))) {
    await writeFile(join(state, 'windows', `${name}-stage.json`), JSON.stringify({ selectedProfileId: null }));
    await writeFile(join(state, 'default.json'), JSON.stringify({ selectedProfileId: null }));
    await writeFile(join(state, 'auth.json'), JSON.stringify(auth(fixture)));
    const instance = await start(`${name}-stage`);
    await account(instance, 'captureCurrent');
    const snapshot = (await account(instance, 'list')).state;
    const id = snapshot.profiles.find(row => row.workspaceAccountId === fixture.accountId)?.id;
    assert(id, 'synthetic profile captured'); profiles.push(id);
    await close(instance);
  }
  const one = await start(`${name}-one`);
  await account(one, 'switch', profiles[0]); await selected(one, profiles[0]);
  await account(one, 'autoSwitchDisable', profiles[1]);
  if (withCandidate) await account(one, 'autoSwitchEnable', profiles[2]);
  candidateAvailable = withCandidate;
  // Initialize SQLite with one engine before the second engine connects.
  const two = await start(`${name}-two`);
  await account(two, 'switch', profiles[0]); await selected(two, profiles[0]);
  const turns = await Promise.all([startTurn(one), startTurn(two)]);
  const requestCount = backendRequests.filter(row => row.path.endsWith('/responses')).length;
  const result = await account(one, 'remove', profiles[0]);
  const expected = withCandidate ? profiles[2] : null;
  // Prove the peer watcher interrupts without a list/status request driving it.
  await Promise.all([one, two].map((instance, index) => until(() => instance.events.find(row => row.method === 'turn/completed' && row.params.turn?.id === turns[index].turnId), `${instance.name} independent retirement interrupt`)));
  await Promise.all([selected(one, expected), selected(two, expected)]);
  for (const [index, instance] of [one, two].entries()) {
    const turn = turns[index];
    const completed = await until(() => instance.events.find(row => row.method === 'turn/completed' && row.params.turn?.id === turn.turnId), `${instance.name} interrupted`);
    assert.equal(completed.params.turn.status, 'interrupted');
    const snapshot = (await account(instance, 'list')).state;
    assert(!snapshot.profiles.some(row => row.id === profiles[0]), 'retired profile not exposed');
    assert.equal(snapshot.hasActiveTurns, false, 'interrupted native work released its lease');
    if (!withCandidate) assert.equal(snapshot.currentAccount, null, 'no-candidate window has no current authentication');
    await assert.rejects(account(instance, 'switch', profiles[0]), 'retired selection denied');
    await assert.rejects(account(instance, 'usage', profiles[0]), 'cached retired credentials denied');
    const history = await instance.peer.request('thread/read', { threadId: turn.threadId, includeTurns: true });
    assert.equal(history.thread.turns.length, 1, 'historical turn retained without replay');
    assert.equal(history.thread.turns[0].id, turn.turnId);
    assert.equal(instance.tools.length, 1, 'pending tool invoked once');
    // An eventual client result must not resurrect an interrupted request.
    instance.child.stdin.write(JSON.stringify({ id: instance.tools[0].id, result: { success: true, contentItems: [{ type: 'inputText', text: 'LATE_TOOL_RESULT_MUST_NOT_REPLAY' }] } }) + '\n');
    const persisted = JSON.parse(await readFile(instance.selection, 'utf8'));
    assert.equal(persisted.selectedProfileId, expected, 'window selection durable');
    assert.equal(persisted.requiresRecovery ?? false, !withCandidate, 'window recovery gate durable');
  }
  const durableDefault = JSON.parse(await readFile(join(state, 'default.json'), 'utf8'));
  assert.equal(durableDefault.selectedProfileId, expected, 'default selection durable');
  assert.equal(durableDefault.requiresRecovery ?? false, !withCandidate, 'default recovery gate durable');
  await delay(1200);
  assert.equal(backendRequests.filter(row => row.path.endsWith('/responses')).length, requestCount, 'retirement must not automatically replay inference');
  assert(!report.backendError, report.backendError);
  await close(two); await close(one);
  let unmanagedBytes;
  if (!withCandidate) {
    unmanagedBytes = JSON.stringify(auth({ accountId: 'retirement-unmanaged', userId: 'retirement-unmanaged-user', email: 'retirement-unmanaged@example.invalid', refreshToken: 'retirement-unmanaged-refresh' }));
    await writeFile(join(state, 'auth.json'), unmanagedBytes);
  }
  const restarted = await start(`${name}-one`);
  const restartState = await selected(restarted, expected);
  const restartHistory = await restarted.peer.request('thread/read', { threadId: turns[0].threadId, includeTurns: true });
  assert.equal(restartHistory.thread.turns.length, 1, 'restart preserves original interrupted history without replay');
  assert.equal(restartHistory.thread.turns[0].id, turns[0].turnId);
  if (!withCandidate) {
    assert.equal(restartState.currentAccount, null, 'no-candidate restart does not expose untouched root authentication');
    assert.equal(restartState.pendingProfileId, null, 'no-candidate restart has no pending selection');
    let identity;
    try { identity = await restarted.peer.request('account/read', { refreshToken: false }); }
    catch (error) { assert(error instanceof RpcError, 'account/read must report a protocol-level unavailable error'); }
    if (identity) assert.equal(identity.account, null, 'account/read must not expose unmanaged root authentication');
    let thread, rejected = false;
    try {
      thread = await restarted.peer.request('thread/start', { cwd, model, ephemeral: false });
      await restarted.peer.request('turn/start', { threadId: thread.thread.id, input: [{ type: 'text', text: 'RECOVERY_GATE_MUST_REJECT', text_elements: [] }] });
    } catch (error) { assert(error instanceof RpcError, 'blocked work must return a protocol rejection'); rejected = true; }
    assert(rejected, 'durable recovery gate rejects native thread/turn admission');
    assert.equal(await readFile(join(state, 'auth.json'), 'utf8'), unmanagedBytes, 'unmanaged root credential bytes remain untouched');
    assert(!backendRequests.some(row => row.bearerOwner === 'retirement-unmanaged'), 'blocked restart must not send untouched root credentials to a backend');
    assert.equal(backendRequests.filter(row => row.path.endsWith('/responses')).length, requestCount, 'blocked startup must not infer with root credentials');
    candidateAvailable = true;
    await account(restarted, 'switch', profiles[1]);
    await selected(restarted, profiles[1]);
    for (const path of [restarted.selection, join(state, 'default.json')]) assert.equal(JSON.parse(await readFile(path, 'utf8')).requiresRecovery ?? false, false, 'explicit healthy selection clears durable recovery');
    const healthyThread = await restarted.peer.request('thread/start', { cwd, model, ephemeral: false });
    const healthyTurn = await restarted.peer.request('turn/start', { threadId: healthyThread.thread.id, input: [{ type: 'text', text: 'EXPLICIT_RECOVERY_SUCCEEDS', text_elements: [] }] });
    const complete = await until(() => restarted.events.find(row => row.method === 'turn/completed' && row.params.turn?.id === healthyTurn.turn.id), 'explicit healthy recovery completion');
    assert.equal(complete.params.turn.status, 'completed', 'explicit registered account recovery permits native work');
    assert.equal(completionFixture.requests.at(-1)?.accountId, accounts[1].accountId, 'recovery uses selected registered account');
    assert.equal(await readFile(join(state, 'auth.json'), 'utf8'), unmanagedBytes, 'explicit registered recovery preserves unrelated root credential bytes');
  }
  assert(!(await account(restarted, 'list')).state.profiles.some(row => row.id === profiles[0]));
  // Native removal owns credential/keyring cleanup; filesystem removal alone is insufficient.
  for (const profile of (await account(restarted, 'list')).state.profiles) await account(restarted, 'remove', profile.id);
  await close(restarted);
  report.checks.push({ name, retiredProfile: profiles[0], replacement: expected, turns, pendingTools: 2, automaticReplay: false, restartSelection: expected, restartHasAuthentication: restartState.currentAccount !== null, unmanagedRootPreservedAndBlocked: !withCandidate, explicitRecovery: !withCandidate ? profiles[1] : undefined, removalReturned: Boolean(result.state) });
}
try {
  if (!scenarioOnly) await scenario('preferred-candidate', true);
  await scenario('no-candidate', false);
  report.status = 'passed';
} catch (error) { report.error = error.stack; process.exitCode = 1; }
finally {
  const cleanupOwner = [...peers].find(instance => instance.child.exitCode === null && instance.child.signalCode === null);
  if (cleanupOwner) {
    try {
      for (const profile of (await account(cleanupOwner, 'list')).state.profiles) await account(cleanupOwner, 'remove', profile.id);
    } catch (error) { report.credentialCleanupError = error.stack; process.exitCode = 1; }
  }
  for (const instance of [...peers]) { try { await close(instance); } catch (error) { report.cleanupError = error.stack; process.exitCode = 1; } }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  report.requests = backendRequests;
  // Use native ordinary PowerShell deletion, within this fresh owned fixture.
  // Never retry a deletion failure through force options or another API.
  if (peers.size === 0 && !report.credentialCleanupError) {
    const quoted = run.replaceAll("'", "''"), owner = retained.replaceAll("'", "''");
    const cleanup = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; $target=(Resolve-Path -LiteralPath '${quoted}').Path; $owner=(Resolve-Path -LiteralPath '${owner}').Path; if (-not $target.StartsWith($owner + '\\', [StringComparison]::OrdinalIgnoreCase)) { throw 'cleanup containment failed' }; Remove-Item -LiteralPath $target -Recurse; if (Test-Path -LiteralPath $target) { throw 'fixture remains' }`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; cleanup.stdout.on('data', chunk => { output += chunk; }); cleanup.stderr.on('data', chunk => { output += chunk; });
    const exit = await waitForExit(cleanup, 'retirement fixture cleanup');
    report.cleanup = { exitCode: exit.code, output: output.trim(), removed: exit.code === 0 };
    if (exit.code !== 0) process.exitCode = 1;
  } else report.cleanup = { removed: false, retainedReason: report.credentialCleanupError ? 'native credential cleanup failed; retain home until cleanup succeeds' : 'owned engine may still be running' };
  report.exitCode = process.exitCode ?? 0;
  await writeFile(join(logs, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, exitCode: report.exitCode, checks: report.checks, error: report.error, cleanup: report.cleanup, logs }));
}

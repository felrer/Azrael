import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

// Fresh-state RPC contract check. No login, inference or ordinary user state.
const [engine, directory] = process.argv.slice(2);
assert(engine && isAbsolute(engine) && directory && isAbsolute(directory),
  'Usage: node scripts/test-provider-context-engine.mjs <absolute engine> <new absolute fixture>');
await mkdir(directory);
await writeFile(join(directory, 'config.toml'), 'model = "gpt-6.1-sol"\n');
const report = { checks: [], status: 'failed', inferenceRequests: 0 };

async function connect() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('AZRAEL_EX_') || ['CODEX_HOME', 'CODEX_SESSION_ID', 'CODEX_THREAD_ID', 'OPENAI_API_KEY'].includes(key)) delete env[key];
  }
  env.CODEX_HOME = directory;
  const child = spawn(resolve(engine), ['-c', 'features.code_mode_host=true', 'app-server'], {
    cwd: directory, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let sequence = 0, stderr = '';
  const pending = new Map();
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
  const rejectPending = error => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  };
  child.on('error', rejectPending);
  child.on('exit', code => rejectPending(new Error(`Engine exited ${code}: ${stderr}`)));
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    try {
      const message = JSON.parse(line), item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(new Error(JSON.stringify(message.error)));
      else item.resolve(message.result);
    } catch (error) { rejectPending(error); }
  });
  const request = (method, params) => new Promise((resolveResult, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout: ${stderr}`)); }, 30000);
    pending.set(id, { resolve: resolveResult, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  await request('initialize', { clientInfo: { name: 'azrael-context-check', version: '1.0.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  return { request, async close() {
    const exited = new Promise(done => child.once('exit', done));
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 5000);
    await exited; clearTimeout(timer); lines.close();
  } };
}

let client;
try {
  client = await connect();
  const read = () => client.request('config/read', { includeLayers: true, cwd: null });
  const write = edits => client.request('config/batchWrite', {
    edits: edits.map(([keyPath, value]) => ({ keyPath, value, mergeStrategy: 'replace' })),
    filePath: null, expectedVersion: null, reloadUserConfig: true,
  });
  let snapshot = await read();
  assert(Array.isArray(snapshot.contextPolicies), 'initial contextPolicies list');
  const openai = snapshot.contextPolicies.find(item => item.providerId === 'openai' && item.modelId === 'gpt-6.1-sol');
  assert(openai, 'selected OpenAI policy');
  assert.equal(openai.contextWindow, 1000000);
  assert.equal(openai.autoCompactTokenLimit, Math.min(950000, openai.safeContextWindow));
  assert.equal(openai.autoCompactSource, 'default');
  assert.equal(openai.pricing.inputTokenThreshold, 272000);
  assert.equal(openai.pricing.inclusive, false);
  report.checks.push('initial selected-model capacity, 95% policy and exact pricing boundary');
  await write([['provider_auto_compact.openai', { token_limit: 300000 }], ['provider_auto_compact.google', { token_limit: 180000 }]]);
  snapshot = await read();
  assert.equal(snapshot.config.provider_auto_compact.openai.token_limit, 300000);
  assert.equal(snapshot.config.provider_auto_compact.google.token_limit, 180000);
  const custom = snapshot.contextPolicies.find(item => item.providerId === 'openai' && item.modelId === 'gpt-6.1-sol');
  assert.equal(custom.autoCompactTokenLimit, 300000); assert.equal(custom.autoCompactSource, 'provider');
  report.checks.push('provider isolation and effective policy readback');
  await client.close(); client = await connect();
  snapshot = await read();
  assert.equal(snapshot.config.provider_auto_compact.openai.token_limit, 300000);
  assert.equal(snapshot.config.provider_auto_compact.google.token_limit, 180000);
  report.checks.push('restart persistence');
  await write([['model_auto_compact_token_limit', 120000], ['provider_auto_compact.openai', {}]]);
  snapshot = await read();
  const reset = snapshot.contextPolicies.find(item => item.providerId === 'openai' && item.modelId === 'gpt-6.1-sol');
  assert.equal(reset.autoCompactTokenLimit, Math.min(950000, reset.safeContextWindow));
  assert.equal(reset.autoCompactSource, 'default');
  report.checks.push('explicit provider default overrides legacy global limit');
  for (const invalid of [0, -1, 1.5]) {
    await assert.rejects(write([['provider_auto_compact.openai', { token_limit: invalid }]]));
    const persisted = await read();
    assert.equal(persisted.config.provider_auto_compact.openai.token_limit ?? null, null);
  }
  report.checks.push('invalid limits rejected without replacing valid saved config');
  const disk = await readFile(join(directory, 'config.toml'), 'utf8');
  assert(disk.includes('provider_auto_compact'));
  report.status = 'passed';
} catch (error) {
  report.error = String(error.stack ?? error); process.exitCode = 1;
} finally {
  if (client) await client.close();
  await writeFile(join(directory, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}

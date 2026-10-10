// Public custom-API configuration -> catalog -> native tool protocol, loopback only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const bun = resolve(process.argv[2] ?? join(root, 'artifacts/tools/bun-1.4.2/package/bin/bun.exe'));
const fixture = join(root, 'artifacts/verification', `custom-api-helper-${randomUUID()}`);
const state = join(fixture, 'state');
const logs = join(root, 'artifacts/logs/custom-api-models/root');
await mkdir(state, { recursive: true });
await mkdir(logs, { recursive: true });
const token = `fixture-${randomUUID()}`;
const tokenPath = join(fixture, 'token.txt');
await writeFile(tokenPath, token);
const env = { ...process.env, CODEX_HOME: state, OPENCODEX_HOME: join(state, 'azrael/providers/opencodex'), NO_PROXY: '127.0.0.1,localhost' };
for (const name of Object.keys(env)) {
  if (/^(AZRAEL_|OPENCODEX_TEST_HOME)/.test(name) || /(API[_-]?KEY|AUTH[_-]?TOKEN|ACCESS[_-]?TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)) delete env[name];
}
const requests = [];
const failures = [];
const grounding = randomUUID();
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    if (req.method === 'GET' && req.url === '/v1/models') {
      requests.push({ discovery: true });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'fixture/model-with-slash' }] }));
      return;
    }
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/chat/completions');
    let text = '';
    for await (const chunk of req) { text += chunk; assert(text.length < 4_000_000); }
    const body = JSON.parse(text);
    assert.equal(body.model, 'fixture/model-with-slash');
    assert.equal(body.stream, false);
    assert.equal(body.chat_template_kwargs?.enable_thinking, false);
    assert.equal(body.parallel_tool_calls, false);
    requests.push({ inference: true });
    const result = body.messages.find(m => m.role === 'tool');
    const message = result
      ? { role: 'assistant', content: `Used ${result.content}` }
      : { role: 'assistant', content: null, tool_calls: [{ id: 'fixture-call', type: 'function', function: { name: body.tools[0].function.name, arguments: JSON.stringify({ value: 'test' }) } }] };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'fixture-response', object: 'chat.completion', choices: [{ index: 0, message, finish_reason: result ? 'stop' : 'tool_calls' }], usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 } }));
  } catch (error) {
    failures.push(error.message);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'fixture_contract_failed' } }));
  }
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));

async function helper(args, input) {
  return await new Promise((ok, reject) => {
    const child = spawn(bun, [join(root, 'providers/opencodex/inference.ts'), ...args], { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = '';
    const timer = setTimeout(() => child.kill(), 30_000);
    child.on('error', reject);
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 2_000_000) child.kill(); });
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('close', code => { clearTimeout(timer); if (code === 0) ok(output); else reject(new Error(`helper_exit_${code}:${output.slice(-1000)}:${error.slice(-500)}`)); });
    child.stdin.end(input ?? '');
  });
}
const command = async request => JSON.parse(await helper(['--api-config'], JSON.stringify(request)));
let report;
try {
  assert.deepEqual((await command({ action: 'list' })).connections, []);
  const saved = await command({ action: 'upsert', connection: {
    name: 'Loopback fixture', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, protocol: 'chat', enabled: true,
    timeoutMs: 180000, maxConcurrent: 1, stream: false, auth: { kind: 'bearerFile', filePath: tokenPath },
    models: [{ id: 'fixture/model-with-slash', name: 'Tool model', contextWindow: 32768, maxOutputTokens: 512, supportsTools: true, sendThinkingParameter: true, enableThinking: false, parallelToolCalls: false }],
  } });
  const connection = saved.connections[0];
  assert.match(connection.id, /^[a-f0-9]{32}$/);
  const discovery = await command({ action: 'discover', id: connection.id });
  assert.deepEqual(discovery.modelIds, ['fixture/model-with-slash']);
  const catalog = JSON.parse(await helper(['--catalog']));
  const entry = catalog.models.find(m => m.provider_id === `api-${connection.id}`);
  assert.equal(entry.model_id, 'fixture/model-with-slash');
  assert.equal(entry.supports_tools, true);
  assert(!JSON.stringify(catalog).includes(token));
  const tools = [{ type: 'namespace', name: 'fixture', tools: [{ type: 'function', name: 'echo', description: 'Echo one value', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false }, strict: false }] }];
  const input = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Call the echo tool.' }] }];
  async function infer(items, turn) {
    const requestId = randomUUID();
    const request = { type: 'request', protocol_version: 1, request_id: requestId, thread_id: 'fixture-thread', turn_id: turn,
      provider_id: `api-${connection.id}`, model: entry.model_id, instructions: 'Use available tools.', input: items, tools, parallel_tool_calls: false };
    const raw = await helper([], JSON.stringify({ type: 'init', protocol_version: 1, request_id: requestId }) + '\n' + JSON.stringify(request) + '\n');
    const frames = raw.trim().split('\n').map(line => JSON.parse(line));
    frames.forEach((frame, seq) => { assert.equal(frame.request_id, requestId); assert.equal(frame.seq, seq); });
    assert.equal(frames.at(-1).type, 'completed');
    assert(!raw.includes(token));
    return frames;
  }
  const first = await infer(input, 'first');
  const toolFrame = first.find(frame => frame.type === 'item_done' && ['function_call', 'custom_tool_call'].includes(frame.item?.type));
  assert(toolFrame, 'native tool call frame');
  const call = toolFrame.item;
  assert(call && ['function_call', 'custom_tool_call'].includes(call.type), 'canonical native tool call');
  assert.equal(call.name, 'echo');
  const second = await infer([...input, call, { type: 'function_call_output', call_id: call.call_id, output: grounding }], 'second');
  assert(JSON.stringify(second).includes(grounding), 'client-only result consumed by production transport');
  assert.equal(requests.filter(r => r.inference).length, 2);
  assert.deepEqual(failures, []);
  report = { pass: true, fixtureRoot: fixture, checks: ['empty_initial_connections', 'private_config_cli', 'explicit_discovery', 'catalog', 'nonstream_tool_alias', 'tool_result_grounding', 'no_secret_output'], requests: requests.length };
} catch (error) {
  report = { pass: false, fixtureRoot: fixture, error: error.message, failures };
  process.exitCode = 1;
} finally {
  await new Promise(close => server.close(close));
  await writeFile(join(logs, 'helper-integration-result.json'), JSON.stringify(report, null, 2));
  await writeFile(join(fixture, 'check-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}

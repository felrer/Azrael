// Synthetic Responses + stdio MCP fixture. Never performs capture or input.
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const identity = 'AZRAEL_SYNTHETIC_COMPUTER_USE_APPROVAL';
const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
function controls() {
  const file = option('--control-file');
  const supplied = file ? JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) : {};
  const value = { appName: option('--app-name', 'AzraelComputerUseProbe.exe'), displayName: 'Azrael Computer Use Test Fixture',
    sessionOnly: args.includes('--session-only'), holdMs: Number(option('--hold-ms', '0')), ...supplied };
  assert(typeof value.appName === 'string' && value.appName.length && !/[\x00-\x1f]/.test(value.appName), 'invalid_fixture_app');
  assert(Number.isSafeInteger(value.holdMs) && value.holdMs >= 0 && value.holdMs <= 60000, 'invalid_fixture_hold');
  return value;
}
function log(event, fields = {}) {
  const file = option('--log');
  if (file) appendFileSync(file, `${JSON.stringify({ time: new Date().toISOString(), component: 'computer-use-ui-fixture', event, ...fields })}\n`);
}
function declarations(tools, namespace) {
  return (tools ?? []).flatMap(tool => tool.type === 'namespace' ? declarations(tool.tools, tool.name)
    : [{ type: tool.type, name: tool.name ?? tool.function?.name, namespace,
      description: tool.description ?? tool.function?.description }]);
}
function responseItem(body, id) {
  const input = Array.isArray(body.input) ? body.input : [];
  const lastUser = input.findLastIndex(item => item.role === 'user');
  const complete = input.slice(lastUser + 1).some(item => item.type === 'function_call_output');
  const declared = declarations(body.tools);
  log('api.request', { id, tools: declared.map(({ name, type, namespace }) => ({ name, type, namespace })), complete });
  if (complete) return { id: `${id}_message`, type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Synthetic Computer Use consent roundtrip finished. No capture or input was performed.' }] };
  const tool = declared.find(tool => tool.description?.includes(identity))
    ?? declared.find(tool => tool.name?.includes('node_repl') && tool.name?.endsWith('js'));
  assert(tool && tool.name, `fixture_tool_not_declared:${JSON.stringify(declared.map(({ name, type, namespace }) => ({ name, type, namespace })))}`);
  return { type: 'function_call', call_id: `${id}_call`, ...(tool.namespace ? { namespace: tool.namespace } : {}), name: tool.name,
    arguments: JSON.stringify({ code: '// synthetic consent probe; no capture or input' }) };
}
async function provider() {
  let sequence = 0;
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || !req.url.endsWith('/responses')) { res.writeHead(404); res.end(); return; }
      let raw = '';
      for await (const chunk of req) { raw += chunk; assert(raw.length <= 4000000, 'fixture_request_too_large'); }
      const id = `computer_use_fixture_${++sequence}`;
      const item = responseItem(JSON.parse(raw), id);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = value => res.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
      send({ type: 'response.created', response: { id } });
      send({ type: 'response.output_item.done', item });
      send({ type: 'response.completed', response: { id, usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 } } });
      res.end();
    } catch (error) {
      const message = error.message.startsWith('fixture_tool_not_declared:') ? error.message : 'invalid_fixture_request';
      log('api.error', { code: message });
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message } }));
    }
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const endpoint = { baseUrl: `http://127.0.0.1:${server.address().port}/openai`, pid: process.pid, synthetic: true };
  if (option('--endpoint-file')) writeFileSync(option('--endpoint-file'), JSON.stringify(endpoint, null, 2));
  process.stdout.write(`${JSON.stringify(endpoint)}\n`);
  process.once('SIGTERM', () => { server.close(); server.closeAllConnections(); });
  return server;
}
function mcp() {
  let sequence = 0;
  const pending = new Map();
  const send = value => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`);
  createInterface({ input: process.stdin }).on('line', async line => {
    let request;
    try {
      request = JSON.parse(line);
      if (pending.has(request.id) && !request.method) {
        const call = pending.get(request.id); pending.delete(request.id);
        const result = request.result;
        const action = ['accept', 'decline', 'cancel'].includes(result?.action) ? result.action : 'cancel';
        const persist = result?.content?.persist ?? result?._meta?.persist;
        log('mcp.approval.response', { id: request.id, callId: call.id, action, ...( ['session', 'always'].includes(persist) ? { persist } : {}) });
        if (call.holdMs) await new Promise(yes => setTimeout(yes, call.holdMs));
        send({ id: call.id, result: { content: [{ type: 'text', text: `Synthetic consent action: ${action}. No capture or input performed.` }], isError: action !== 'accept' } });
        log('mcp.tool.completed', { id: call.id, action }); return;
      }
      if (request.id === undefined) return;
      switch (request.method) {
        case 'initialize': send({ id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'computer-use-ui-fixture', version: '1' } } }); break;
        case 'ping': send({ id: request.id, result: {} }); break;
        case 'tools/list': send({ id: request.id, result: { tools: [{ name: 'js', description: `${identity}: Request synthetic app consent; never execute supplied code.`, inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'], additionalProperties: false } }] } }); break;
        case 'tools/call': {
          assert.equal(request.params.name, 'js', 'unknown_fixture_tool');
          const control = controls(), id = `fixture_consent_${++sequence}`;
          pending.set(id, { id: request.id, holdMs: control.holdMs });
          log('mcp.approval.request', { id, callId: request.id });
          send({ id, method: 'elicitation/create', params: { mode: 'form', message: 'Allow the synthetic Computer Use test fixture to perform a consent probe? This probe performs no capture or input.', requestedSchema: { type: 'object', properties: {} },
            _meta: { connector_id: 'computer-use', connector_name: 'Computer Use', codex_approval_kind: 'mcp_tool_call', persist: control.sessionOnly ? ['session'] : ['session', 'always'], tool_params: { app: control.appName }, tool_params_display: [{ name: 'app', display_name: 'App', value: control.displayName }] } } }); break;
        }
        default: send({ id: request.id, error: { code: -32601, message: 'Unsupported fixture method' } });
      }
    } catch {
      log('mcp.error', { id: request?.id, code: 'invalid_fixture_protocol' });
      if (request?.id !== undefined) send({ id: request.id, error: { code: -32602, message: 'Invalid fixture request' } });
    }
  });
}
async function selfTest() {
  const server = await provider();
  const endpoint = `http://127.0.0.1:${server.address().port}/openai/responses`;
  try {
    const tools = [{ type: 'namespace', name: 'node_repl', tools: [{ type: 'function', name: 'js', description: identity }] }];
    const request = async input => (await fetch(endpoint, { method: 'POST', body: JSON.stringify({ input, tools }) })).text();
    assert((await request([{ role: 'user', content: 'synthetic' }])).includes('"namespace":"node_repl","name":"js"'));
    assert((await request([{ role: 'user' }, { type: 'function_call_output' }])).includes('roundtrip finished'));
    assert((await request([{ role: 'user' }, { type: 'function_call_output' }, { role: 'user' }])).includes('"type":"function_call"'));
    const direct = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ input: [{ role: 'user' }], tools: [{ type: 'function', name: 'actual_declared_alias', description: identity }] }) });
    assert((await direct.text()).includes('"name":"actual_declared_alias"'));
    const absent = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ input: [], tools: [] }) }); assert.equal(absent.status, 500);
    for (const action of ['accept', 'decline', 'cancel']) {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'mcp', '--app-name', 'SyntheticSelfTest.exe', '--hold-ms', '1', ...(option('--log') ? ['--log', option('--log')] : []), ...(action === 'cancel' ? ['--session-only'] : [])], { stdio: ['pipe', 'pipe', 'pipe'] });
      const lines = createInterface({ input: child.stdout });
      const messages = []; const waiters = [];
      lines.on('line', line => { messages.push(JSON.parse(line)); waiters.shift()?.(); });
      const next = async () => { if (!messages.length) await new Promise((yes, no) => { const timer = setTimeout(() => no(new Error('mcp_self_test_timeout')), 5000); waiters.push(() => { clearTimeout(timer); yes(); }); }); return messages.shift(); };
      const send = value => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`);
      try {
        send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }); assert.equal((await next()).result.protocolVersion, '2025-06-18');
        send({ id: 2, method: 'tools/list' }); assert.equal((await next()).result.tools[0].name, 'js');
        send({ id: 3, method: 'tools/call', params: { name: 'js', arguments: { code: 'never executed' } } });
        const consent = await next(); assert.equal(consent.method, 'elicitation/create'); assert.deepEqual(consent.params.requestedSchema.properties, {});
        assert.equal(consent.params._meta.tool_params.app, 'SyntheticSelfTest.exe');
        assert.deepEqual(consent.params._meta.persist, action === 'cancel' ? ['session'] : ['session', 'always']);
        send({ id: consent.id, result: { action, content: { persist: 'session' } } });
        assert.equal((await next()).result.isError, action !== 'accept');
      } finally { child.kill(); lines.close(); }
    }
    process.stdout.write('PASS: Responses declared tool selection, completion, fresh-turn retrigger, missing-tool failure; MCP initialize/list/accept/decline/cancel/session-only.\n');
  } finally { await new Promise(yes => { server.close(yes); server.closeAllConnections(); }); }
}
const logPath = option('--log');
if (logPath) mkdirSync(dirname(resolve(logPath)), { recursive: true });
switch (args[0]) {
  case 'provider': await provider(); break;
  case 'mcp': mcp(); break;
  case 'self-test': await selfTest(); break;
  default: throw new Error('Usage: node computer-use-ui-fixture.mjs provider|mcp|self-test [--endpoint-file PATH] [--log PATH] [--control-file PATH] [--app-name NAME] [--session-only] [--hold-ms 0..60000]');
}

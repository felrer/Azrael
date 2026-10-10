import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { infer, catalog } from '../inference.ts';
import { apiConfigCommand, apiCatalog, readConnections, setApiSecretFactoryForTests, acquireApiLock } from '../custom-api-config.ts';

let root = '', id = ''; const saved = { ...process.env };
const secrets = new Map<string, string>();
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'azrael-api-fixture-'));
  process.env.CODEX_HOME = join(root, 'codex');
  process.env.OPENCODEX_HOME = join(process.env.CODEX_HOME, 'azrael', 'providers', 'opencodex');
  mkdirSync(process.env.OPENCODEX_HOME, { recursive: true });
  secrets.clear(); setApiSecretFactoryForTests((_service, account) => ({ getPassword: () => secrets.get(account) ?? null, setPassword: value => { secrets.set(account, value); }, deletePassword: () => secrets.delete(account) }));
});
afterEach(() => { setApiSecretFactoryForTests(); rmSync(root, { recursive: true }); for (const key of ['CODEX_HOME', 'OPENCODEX_HOME']) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
const model = { id: 'remote/model/opaque', name: 'Manual model', contextWindow: 65536, maxOutputTokens: 2048, supportsTools: true, enableThinking: false, parallelToolCalls: false };
const connection = (changes: any = {}) => ({ name: 'Fixture API', baseUrl: 'https://fixture.invalid/v1', protocol: 'chat', enabled: true, timeoutMs: 1000, maxConcurrent: 1, stream: false, auth: { kind: 'none' }, models: [model], ...changes });
async function setup(changes: any = {}) { const result = await apiConfigCommand({ action: 'upsert', connection: connection(changes) }); id = result.connections![0]!.id; return result.connections![0]!; }
function request(changes: any = {}) { return { type: 'request', protocol_version: 1, request_id: 'fixture', thread_id: 'thread', turn_id: 'turn', provider_id: 'api-' + id, model: model.id, instructions: 'Native instructions', tools: [], input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }], parallel_tool_calls: true, ...changes }; }
const completion = (changes: any = {}) => ({ choices: [{ message: { role: 'assistant', content: 'answer' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 }, ...changes });
const responseValue = (output: any[]) => ({ status: 'completed', output, usage: { input_tokens: 3, output_tokens: 2 } });
const textOutput = [{ type: 'message', content: [{ type: 'output_text', text: 'answer' }] }];
const fixtureFetch = (callback: (url: any, init: any) => Response | Promise<Response>) => callback as typeof fetch;

test('manual catalog and safe config preserve opaque IDs without discovery/defaults', async () => {
  expect(apiCatalog()).toEqual([]); const c = await setup(); expect(c.id).toMatch(/^[a-f0-9]{32}$/);
  expect(await apiConfigCommand({ action: 'list' })).toEqual({ connections: [c] });
  const roster = await catalog({ fetch: fixtureFetch(() => { throw new Error('LIVE_NETWORK_FORBIDDEN'); }) });
  expect(roster.models.find(m => m.provider_id === 'api-' + id)).toMatchObject({ model_id: model.id, display_name: 'Fixture API · Manual model', supports_tools: true, stream: false, input_modalities: ['text'] });
  await apiConfigCommand({ action: 'delete', id }); expect(readConnections()).toEqual([]);
});
test('secret input uses protected store and never enters safe config output', async () => {
  const result = await apiConfigCommand({ action: 'upsert', connection: connection({ auth: { kind: 'secret' } }), apiKey: 'fixture-secret' });
  id = result.connections![0]!.id;
  expect(secrets.size).toBe(1); expect(JSON.stringify(result)).not.toContain('fixture-secret');
  expect(readFileSync(join(process.env.CODEX_HOME!, 'azrael/providers/api/connections.json'), 'utf8')).not.toContain('fixture-secret');
  await infer(request(), () => {}, fixtureFetch((_url, init) => { expect(new Headers(init.headers).get('authorization')).toBe('Bearer fixture-secret'); return Response.json(completion()); }));
  await apiConfigCommand({ action: 'delete', id }); expect(secrets.size).toBe(0);
});
test('secret failure rolls back config and protects prior credential', async () => {
  await setup(); const prior = readConnections();
  setApiSecretFactoryForTests(() => ({ getPassword: () => null, setPassword: () => { throw new Error('unsafe secret details'); }, deletePassword: () => true }));
  await expect(apiConfigCommand({ action: 'upsert', connection: { ...prior[0], auth: { kind: 'secret' } }, apiKey: 'fixture-key' })).rejects.toThrow('api_secret_unavailable');
  expect(readConnections()).toEqual(prior);
});
test('token file resolves at request and changed auth/endpoint fails pinned identity', async () => {
  const file = join(root, 'token'); writeFileSync(file, 'fixture-token\n'); const c = await setup({ auth: { kind: 'bearerFile', filePath: file } });
  await infer(request({ api_options: c }), () => {}, fixtureFetch((_url, init) => { expect(new Headers(init.headers).get('authorization')).toBe('Bearer fixture-token'); return Response.json(completion()); }));
  writeFileSync(file, 'changed-token'); let fetched = false;
  await expect(infer(request(), () => {}, fixtureFetch(() => { fetched = true; return Response.json(completion()); }))).rejects.toThrow('api_connection_changed'); expect(fetched).toBeFalse();
});
test('chat nonstream forwards max output, thinking and single call explicitly', async () => {
  await setup({ models: [{ ...model, sendThinkingParameter: true }] }); const frames: any[] = [];
  await infer(request(), f => frames.push(f), fixtureFetch((url, init) => { const b = JSON.parse(init.body); expect(String(url)).toBe('https://fixture.invalid/v1/chat/completions'); expect(b).toMatchObject({ model: model.id, stream: false, max_tokens: 2048, parallel_tool_calls: false, chat_template_kwargs: { enable_thinking: false } }); expect(init.redirect).toBe('error'); return Response.json(completion()); }));
  expect(frames.at(-1)).toMatchObject({ type: 'completed', usage: { input_tokens: 3, output_tokens: 2 } });
});
for (const protocol of ['chat', 'responses']) test(`${protocol} default omits optional thinking parameters for strict servers`, async () => {
  const c = await setup({ protocol, models: [{ ...model, enableThinking: true }] });
  expect(c.models[0].sendThinkingParameter).toBeFalse();
  await infer(request({ api_options: c }), () => {}, fixtureFetch((_url, init) => {
    const body = JSON.parse(init.body);
    for (const field of ['chat_template_kwargs', 'reasoning', 'reasoning_effort']) expect(Object.hasOwn(body, field)).toBeFalse();
    return Response.json(protocol === 'chat' ? completion() : responseValue(textOutput));
  }));
});
for (const enableThinking of [false, true]) test(`responses explicit thinking parameter sends ${enableThinking ? 'medium' : 'none'} effort`, async () => {
  await setup({ protocol: 'responses', models: [{ ...model, sendThinkingParameter: true, enableThinking }] });
  await infer(request(), () => {}, fixtureFetch((_url, init) => {
    expect(JSON.parse(init.body).reasoning).toEqual({ effort: enableThinking ? 'medium' : 'none' });
    return Response.json(responseValue(textOutput));
  }));
});
test('chat SSE requires terminal finish before native tool execution', async () => {
  await setup({ stream: true }); const frames: any[] = [];
  const sse = (terminal: boolean) => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: 'answer' }, finish_reason: terminal ? 'stop' : null }] }) + '\n\ndata: [DONE]\n\n');
  await infer(request(), f => frames.push(f), fixtureFetch(() => sse(true))); expect(frames.at(-1).type).toBe('completed');
  await expect(infer(request({ turn_id: 'next' }), () => {}, fixtureFetch(() => sse(false)))).rejects.toThrow('provider_eof');
});
for (const stream of [false, true]) test(`responses ${stream ? 'SSE' : 'JSON'} preserves native namespace custom tools`, async () => {
  await setup({ protocol: 'responses', stream });
  const tools = [{ type: 'namespace', name: 'functions', tools: [{ type: 'custom', name: 'apply_patch', description: 'patch', format: { type: 'text' } }] }];
  const frames: any[] = [];
  await infer(request({ tools }), f => frames.push(f), fixtureFetch((url, init) => {
    const body = JSON.parse(init.body); expect(String(url)).toBe('https://fixture.invalid/v1/responses'); expect(body).toMatchObject({ model: model.id, max_output_tokens: 2048, parallel_tool_calls: false, store: false, stream });
    const name = body.tools[0].name;
    const value = responseValue([{ type: 'function_call', call_id: 'call', name, arguments: JSON.stringify({ input: '*** Begin Patch\n*** End Patch' }) }]);
    return stream ? new Response('data: ' + JSON.stringify({ type: 'response.completed', response: value }) + '\n\n') : Response.json(value);
  }));
  const call = frames.find(f => f.type === 'item_done' && f.item.type === 'custom_tool_call')?.item; expect(call).toMatchObject({ type: 'custom_tool_call', namespace: 'functions', name: 'apply_patch' }); expect(frames.at(-1).type).toBe('completed');
});
test('tools unsupported, snapshot edits, and malformed JSON fail closed', async () => {
  const c = await setup({ models: [{ ...model, supportsTools: false }] });
  await expect(infer(request({ tools: [{ type: 'function', name: 'x', parameters: {} }] }), () => {}, fixtureFetch(() => { throw Error('unexpected fetch'); }))).rejects.toThrow('api_tools_unsupported');
  await expect(infer(request({ api_options: { ...c, baseUrl: 'https://other.invalid/v1' } }), () => {}, fixtureFetch(() => { throw Error('unexpected fetch'); }))).rejects.toThrow('api_connection_changed');
  await expect(infer(request(), () => {}, fixtureFetch(() => new Response('bad JSON')))).rejects.toThrow('invalid_api_response');
});
test('HTTP errors discard response body and have no retries', async () => {
  await setup(); let calls = 0, reads = 0;
  const fetcher = fixtureFetch(() => { calls++; return new Response(new ReadableStream({ pull(c) { reads++; c.enqueue(new TextEncoder().encode('private server body')); c.close(); } }), { status: 502 }); });
  await expect(infer(request(), () => {}, fetcher)).rejects.toThrow('provider_http_502'); expect(calls).toBe(1); expect(reads).toBeLessThanOrEqual(1);
});
test('explicit discovery returns IDs only and enforces redirect rejection', async () => {
  await setup(); const result = await apiConfigCommand({ action: 'discover', id }, fixtureFetch((url, init) => { expect(String(url)).toBe('https://fixture.invalid/v1/models'); expect(init.redirect).toBe('error'); return Response.json({ data: [{ id: model.id, private: 'hidden' }] }); }));
  expect(result).toEqual({ modelIds: [model.id] });
});
test('cross-process slot lock releases dead owner and queue consumes deadline', async () => {
  await setup({ timeoutMs: 80 }); const path = join(process.env.CODEX_HOME!, 'azrael/providers/api', id + '.slot-0.lock');
  writeFileSync(path, JSON.stringify({ pid: 2147483647, owner: 'dead' }));
  const release = await acquireApiLock(path, AbortSignal.timeout(100)); expect(release).toBeFunction();
  await expect(infer(request(), () => {}, fixtureFetch(() => { throw Error('unexpected fetch'); }))).rejects.toThrow('provider_request_deadline');
  release!(); expect(existsSync(path)).toBeFalse();
});
test('fork retains API identity and a removed connection fails before fetch', async () => {
  await setup(); await infer(request(), () => {}, fixtureFetch(() => Response.json(completion())));
  await infer(request({ thread_id: 'fork', turn_id: 'forkturn', forked_from_thread_id: 'thread', fork_provider_ids: ['api-' + id] }), () => {}, fixtureFetch(() => Response.json(completion())));
  await apiConfigCommand({ action: 'delete', id });
  await expect(infer(request(), () => {}, fixtureFetch(() => { throw Error('unexpected fetch'); }))).rejects.toThrow('api_connection_missing');
});
test('next turn can switch model and settings while labels do not break identity', async () => {
  const c = await setup(); await infer(request(), () => {}, fixtureFetch(() => Response.json(completion())));
  const updated = { ...c, name: 'Renamed', models: [{ ...model, name: 'Renamed model' }, { ...model, id: 'other/model', maxOutputTokens: 1024 }] };
  await apiConfigCommand({ action: 'upsert', connection: updated });
  await infer(request(), () => {}, fixtureFetch(() => Response.json(completion())));
  await infer(request({ turn_id: 'next', model: 'other/model' }), () => {}, fixtureFetch((_url, init) => { expect(JSON.parse(init.body).max_tokens).toBe(1024); return Response.json(completion()); }));
  await apiConfigCommand({ action: 'upsert', connection: { ...updated, models: [{ ...model, maxOutputTokens: 500 }, updated.models[1]] } });
  await expect(infer(request(), () => {}, fixtureFetch(() => { throw Error('unexpected fetch'); }))).rejects.toThrow('api_connection_changed');
});
test('single-call default rejects parallel output before any tool becomes executable', async () => {
  await setup(); const frames: any[] = [];
  await expect(infer(request({ tools: [{ type: 'function', name: 'run', parameters: { type: 'object' } }] }), f => frames.push(f), fixtureFetch((_url, init) => {
    const name = JSON.parse(init.body).tools[0].function.name;
    return Response.json(completion({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: ['one', 'two'].map(id => ({ id, type: 'function', function: { name, arguments: '{}' } })) } }] }));
  }))).rejects.toThrow();
  expect(frames.some(f => f.type === 'item_done' && f.item.type === 'function_call')).toBeFalse();
});
test('removing connection during request aborts without terminal completion', async () => {
  await setup({ timeoutMs: 2000 }); const frames: any[] = [];
  const promise = infer(request(), f => frames.push(f), fixtureFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Error('aborted private details')), { once: true });
    void apiConfigCommand({ action: 'delete', id });
  })));
  await expect(promise).rejects.toThrow('api_connection_missing');
  expect(frames.some(f => f.type === 'completed')).toBeFalse();
});

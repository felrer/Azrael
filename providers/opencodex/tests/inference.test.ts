import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { infer, catalog, projectRequest } from '../inference.ts';
import { compileRequest } from '../inference-mapping.mjs';
import * as config from '../vendor/src/config.ts';
import * as keys from '../vendor/src/providers/api-keys.ts';

const catalogFixture = (async () => Response.json({ data: [{ id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet', context_length: 1000000, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['tools'] }] })) as typeof fetch;
let root = '';
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });
function setup() {
  root = mkdtempSync(join(tmpdir(), 'azrael-managed-fixture-'));
  process.env.CODEX_HOME = join(root, 'codex');
  process.env.OPENCODEX_HOME = join(process.env.CODEX_HOME, 'azrael', 'providers', 'opencodex');
  mkdirSync(process.env.OPENCODEX_HOME, { recursive: true });
  const cfg = config.loadConfig();
  for (const [id, baseUrl, adapter, model] of [
    ['google', 'https://generativelanguage.googleapis.com', 'google', 'gemini-3.1-pro-preview'],
    ['xai', 'https://api.x.ai/v1', 'openai-chat', 'grok-4'],
    ['openrouter', 'https://openrouter.ai/api/v1', 'openai-chat', 'anthropic/claude-sonnet-5'],
  ]) cfg.providers[id!] = { adapter: adapter as any, baseUrl: baseUrl!, authMode: 'key', apiKey: 'fixture-key-' + id, models: [model!] };
  config.saveConfig(cfg);
}
function request(provider_id = 'xai', turn_id = 'turn-1', input: any[] = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }], tools: any[] = []) {
  return { type: 'request', protocol_version: 1, request_id: 'fixture', thread_id: 'thread-1', turn_id, provider_id, model: provider_id === 'google' ? 'gemini-3.1-pro-preview' : provider_id === 'openrouter' ? 'anthropic/claude-sonnet-5' : 'grok-4', instructions: 'fixture instructions', input, tools, parallel_tool_calls: true };
}
const sse = (...frames: any[]) => new Response(frames.map(frame => 'data: ' + (typeof frame === 'string' ? frame : JSON.stringify(frame)) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
const textFetch = (req: any, captured?: any[]) => (async (url: any, init: any) => {
  const body = JSON.parse(init.body); captured?.push({ url: String(url), body, headers: init.headers });
  return req.provider_id === 'google' ? sse({ candidates: [{ content: { parts: [{ text: 'fixture response' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 } }) : sse({ choices: [{ delta: { content: 'fixture response' }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3 } }, '[DONE]');
}) as typeof fetch;

test('actual Google, xAI, OpenRouter adapters preserve text and complete usage', async () => {
  setup();
  for (const provider of ['google', 'xai', 'openrouter']) {
    const req = request(provider, 'turn-' + provider); const frames: any[] = [], captured: any[] = [];
    await infer(req, frame => frames.push(frame), textFetch(req, captured));
    expect(frames[0].type).toBe('created');
    expect(frames.some(frame => frame.type === 'text_delta' && frame.delta === 'fixture response')).toBeTrue();
    expect(frames.at(-1)).toEqual({ type: 'completed', usage: expect.objectContaining({ input_tokens: 2, output_tokens: 3 }) });
    expect(JSON.stringify(frames)).not.toContain('fixture-key');
    expect(captured[0].body).toBeDefined();
  }
});

test('registry-owned endpoints remain canonical with loopback config; native fixtures must inject fetch seam', async () => {
  setup();
  const cfg = config.loadConfig();
  for (const provider of ['google', 'xai', 'openrouter']) {
    cfg.providers[provider].baseUrl = 'http://127.0.0.1:9098/' + provider;
    cfg.providers[provider].allowPrivateNetwork = true;
  }
  cfg.providers.google.models = ['gemini-3-flash-preview'];
  cfg.providers.openrouter.models = ['fixture/model-with-slash'];
  config.saveConfig(cfg);
  for (const [provider, expected] of [
    ['google', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse'],
    ['xai', 'https://api.x.ai/v1/chat/completions'],
    ['openrouter', 'https://openrouter.ai/api/v1/chat/completions'],
  ]) {
    const req = request(provider, 'canonical-' + provider);
    if (provider === 'google') req.model = 'gemini-3-flash-preview';
    if (provider === 'openrouter') req.model = 'fixture/model-with-slash';
    const captured: any[] = [];
    await infer(req, () => {}, textFetch(req, captured));
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe(expected);
    if (provider === 'google') expect(Object.keys(captured[0].headers).sort()).toEqual(['Content-Type', 'x-goog-api-key']);
  }
});

test('all directed provider switches and A B A retain initial account despite active selection', async () => {
  setup(); let turn = 0;
  for (const from of ['google', 'xai', 'openrouter']) for (const to of ['google', 'xai', 'openrouter']) {
    if (from === to) continue;
    for (const provider of [from, to, from]) {
      const req = request(provider, 'turn-' + turn++); await infer(req, () => {}, textFetch(req));
    }
  }
  const cfg = config.loadConfig();
  keys.addProviderApiKey(cfg, 'xai', 'changed-global-active');
  const captured: any[] = [], req = request('xai', 'turn-final');
  await infer(req, () => {}, textFetch(req, captured));
  expect(captured[0].headers.Authorization ?? captured[0].headers.authorization).toBe('Bearer fixture-key-xai');
  expect(config.loadConfig().providers.xai.apiKey).toBe('changed-global-active');
});

test('same turn selection mismatch and deleted or replaced pinned credentials fail closed', async () => {
  setup(); const req = request(); await infer(req, () => {}, textFetch(req));
  await expect(infer(request('google'), () => {}, textFetch(request('google')))).rejects.toThrow('turn_selection_mismatch');
  const cfg = config.loadConfig(); cfg.providers.xai.apiKey = 'replacement'; cfg.providers.xai.apiKeyPool = undefined; config.saveConfig(cfg);
  await expect(infer(request('xai', 'turn-2'), () => {}, textFetch(req))).rejects.toThrow('pinned_account_missing');
});

test('disabled, OAuth, local and unsupported transports are excluded from catalog and inference', async () => {
  setup();
  for (const change of [{ disabled: true }, { authMode: 'oauth' }, { authMode: 'local' }, { adapter: 'openai-chat' }, { googleMode: 'vertex' }, { googleMode: 'cloud-code-assist' }]) {
    const cfg = config.loadConfig();
    cfg.providers.google = { adapter: 'google', baseUrl: 'https://generativelanguage.googleapis.com', authMode: 'key', apiKey: 'fixture-key-google', models: ['gemini-3.1-pro-preview'], ...change } as any;
    config.saveConfig(cfg);
    expect((await catalog({ fetch: catalogFixture })).models.some(model => model.provider_id === 'google')).toBeFalse();
    const req = request('google', 'invalid-transport'); let fetched = false;
    await expect(infer(req, () => {}, (async () => { fetched = true; return sse(); }) as typeof fetch)).rejects.toThrow('provider_unavailable');
    expect(fetched).toBeFalse();
  }
});

test('binding and ancestor reads reject oversized, malformed, unsafe-key or inconsistent state', async () => {
  setup();
  const req = request(); await infer(req, () => {}, textFetch(req));
  const directory = join(process.env.CODEX_HOME!, 'azrael/providers/sessions'); const path = join(directory, 'thread-1.json');
  const original = readFileSync(path, 'utf8');
  for (const contents of ['x'.repeat(1024 * 1024 + 1), '{broken', JSON.stringify({ version: 1, thread_id: 'thread-1', providers: [], turns: {} }), original.replace(/"fingerprint":"[a-f0-9]{64}"/, '"fingerprint":"invalid"'), original.replace('"turn-1":', '"__proto__":')]) {
    writeFileSync(path, contents);
    await expect(infer(request('xai', 'turn-2'), () => {}, textFetch(req))).rejects.toThrow();
    const fork = { ...request('xai', 'fork-turn'), thread_id: 'bad-ancestor-fork', forked_from_thread_id: 'thread-1', fork_provider_ids: ['xai'] };
    await expect(infer(fork, () => {}, textFetch(fork))).rejects.toThrow();
    expect(existsSync(join(directory, 'bad-ancestor-fork.json'))).toBeFalse();
  }
  writeFileSync(path, original);
  for (const id of ['__proto__', 'constructor', 'prototype']) await expect(infer({ ...req, turn_id: id }, () => {}, textFetch(req))).rejects.toThrow('invalid_selection');
  for (const model of ['', ['invalid'], 'invalid\nmodel']) await expect(infer({ ...req, turn_id: 'invalid-model', model }, () => {}, textFetch(req))).rejects.toThrow('invalid_selection');
  await infer(request('xai', 'turn-2'), () => {}, textFetch(req));
});

test('reference credential replacement and endpoint edits fail; empty fork lineage supports first managed turn', async () => {
  setup();
  const cfg = config.loadConfig(); cfg.providers.xai.apiKey = '${AZRAEL_FIXTURE_KEY}'; config.saveConfig(cfg);
  process.env.AZRAEL_FIXTURE_KEY = 'reference-original';
  const req = request(); await infer(req, () => {}, textFetch(req));
  process.env.AZRAEL_FIXTURE_KEY = 'reference-replacement';
  await expect(infer(request('xai', 'turn-2'), () => {}, textFetch(req))).rejects.toThrow('pinned_account_changed');
  process.env.AZRAEL_FIXTURE_KEY = 'reference-original';
  const changed = config.loadConfig(); changed.providers.xai.baseUrl = 'https://api.x.ai/v1/edited'; config.saveConfig(changed);
  await expect(infer(request('xai', 'turn-3'), () => {}, textFetch(req))).rejects.toThrow('pinned_account_changed');
  delete process.env.AZRAEL_FIXTURE_KEY;
  const fork = { ...request('google', 'first-managed'), thread_id: 'fork-openai', forked_from_thread_id: 'no-managed-ancestor', fork_provider_ids: [] };
  await infer(fork, () => {}, textFetch(fork));
});

test('namespaced function, custom and client tool-search calls restore exact native identities', async () => {
  setup();
  const tools = [{ type: 'namespace', name: 'functions', tools: [{ type: 'function', name: 'exec', description: 'run', parameters: { type: 'object' } }, { type: 'custom', name: 'patch', description: 'patch' }] }, { type: 'tool_search', execution: 'client', parameters: { type: 'object' } }];
  for (const provider of ['google', 'xai', 'openrouter']) for (let i = 0; i < 3; i++) {
    const req = request(provider, 'tool-' + provider + '-' + i, undefined, tools); const frames: any[] = [];
    const aliases = compileRequest(req).tools.map((tool: any) => tool.name);
    const args = i === 1 ? { input: 'exact\npatch' } : { value: 'fixture' };
    const fetcher = (async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      const name = provider === 'google' ? body.tools[0].functionDeclarations[i].name : aliases[i];
      return provider === 'google' ? sse({ candidates: [{ content: { parts: [{ functionCall: { name, args }, thoughtSignature: 'real-fixture-thought-signature-12345' }] }, finishReason: 'STOP' }] }) : sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-fixture', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }, '[DONE]');
    }) as typeof fetch;
    await infer(req, frame => frames.push(frame), fetcher);
    const item = frames.find(frame => frame.type === 'item_done' && ['function_call', 'custom_tool_call', 'tool_search_call'].includes(frame.item.type))!.item;
    expect(item.type).toBe(['function_call', 'custom_tool_call', 'tool_search_call'][i]);
    if (i < 2) expect(item.namespace).toBe('functions');
    if (i === 1) expect(item.input).toBe('exact\npatch');
    if (i === 2) expect(item.execution).toBe('client');
  }
});

test('opaque aliases preserve namespace absence separately from literal functions namespace', () => {
  const compiled = compileRequest(request('xai', 'turn-1', undefined, [{ type: 'function', name: 'exec', parameters: { type: 'object' } }, { type: 'namespace', name: 'functions', tools: [{ type: 'function', name: 'exec', parameters: { type: 'object' } }] }]));
  expect(compiled.tools[0].name).not.toBe(compiled.tools[1].name);
});

test('foreign private reasoning filtered while public reasoning persists; remote images explicitly fail', () => {
  const foreign = 'azrael-managed-v1:' + Buffer.from(JSON.stringify({ provider: 'google', model: 'g', thread: 'thread-1', turn: 'turn-1', account: 'foreign', signature: 'PRIVATE' })).toString('base64');
  const req = request('xai', 'turn-1', [{ type: 'reasoning', encrypted_content: foreign, summary: [{ type: 'summary_text', text: 'public reasoning' }] }, { type: 'message', role: 'user', content: 'next' }]);
  const projected = projectRequest(req, 'local');
  expect(JSON.stringify(projected.parsed)).toContain('public reasoning');
  expect(JSON.stringify(projected.parsed)).not.toContain('PRIVATE');
  expect(() => projectRequest(request('xai', 'turn-1', [{ type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'https://fixture.invalid' }] }]), 'local')).toThrow('remote_image_unsupported');
});

test('Google exact tool thought signature replays during same turn; foreign completed history projects across switches', async () => {
  setup();
  const tools = [{ type: 'function', name: 'exec', parameters: { type: 'object' } }];
  const req = request('google', 'google-tools', undefined, tools); const frames: any[] = [];
  await infer(req, frame => frames.push(frame), (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    return sse({ candidates: [{ content: { parts: [{ functionCall: { name: body.tools[0].functionDeclarations[0].name, args: { exact: 1 } }, thoughtSignature: 'real-google-private-signature-12345' }] }, finishReason: 'STOP' }] });
  }) as typeof fetch);
  const items = frames.filter(frame => frame.type === 'item_done').map(frame => frame.item);
  const call = items.find(item => item.type === 'function_call');
  const history = [...req.input, ...items, { type: 'function_call_output', call_id: call.call_id, output: 'done' }];
  const next = { ...req, input: history }; const captured: any[] = [];
  await infer(next, () => {}, textFetch(next, captured));
  const part = captured[0].body.contents.flatMap((content: any) => content.parts).find((part: any) => part.functionCall);
  expect(part.thoughtSignature).toBe('real-google-private-signature-12345');
  for (const provider of ['xai', 'openrouter', 'google']) {
    const switched = request(provider, 'switched-' + provider, [...history, { type: 'message', role: 'user', content: 'next turn' }], tools);
    const wire: any[] = []; await infer(switched, () => {}, textFetch(switched, wire));
    expect(JSON.stringify(wire[0].body)).not.toContain('real-google-private-signature-12345');
    expect(JSON.stringify(wire[0].body)).toContain('exact');
  }
});

test('OpenRouter complete reasoning details survive same-turn tool loop and are stripped on switch', async () => {
  setup(); const tools = [{ type: 'function', name: 'exec', parameters: { type: 'object' } }];
  const req = request('openrouter', 'turn-1', undefined, tools); const alias = compileRequest(req).tools[0].name;
  const details = [{ type: 'reasoning.encrypted', id: 'opaque-id', data: 'private-ciphertext', format: 'fixture', index: 0 }];
  const frames: any[] = [];
  await infer(req, frame => frames.push(frame), (async () => sse({ choices: [{ delta: { reasoning_details: details, tool_calls: [{ index: 0, id: 'call-r', function: { name: alias, arguments: '{}' } }] }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }, '[DONE]')) as typeof fetch);
  const items = frames.filter(frame => frame.type === 'item_done').map(frame => frame.item);
  const next = { ...req, input: [...req.input, ...items, { type: 'function_call_output', call_id: 'call-r', output: 'done' }] };
  const captured: any[] = [];
  await infer(next, () => {}, textFetch(next, captured));
  expect(captured[0].body.messages.find((message: any) => message.role === 'assistant').reasoning_details).toEqual(details);
  expect(JSON.stringify(projectRequest({ ...next, provider_id: 'xai', model: 'grok-4' }, 'other').parsed)).not.toContain('private-ciphertext');
});

test('OpenRouter identical delta chunks concatenate text/summary and preserve encrypted records in exact order', async () => {
  setup(); const tools = [{ type: 'function', name: 'exec', parameters: { type: 'object' } }];
  const req = request('openrouter', 'repeated-deltas', undefined, tools); const alias = compileRequest(req).tools[0].name;
  const text = { type: 'reasoning.text', id: 'text-id', text: 'ha', signature: null, format: 'anthropic-claude-v1', index: 0 };
  const summary = { type: 'reasoning.summary', id: 'summary-id', summary: 'a', format: 'openai-responses-v1', index: 0 };
  const encrypted = { type: 'reasoning.encrypted', id: 'encrypted-id', data: 'a', format: 'anthropic-claude-v1', index: 0, extra_metadata: { exact: true } };
  const sequence = [text, text, summary, summary, encrypted, encrypted]; const frames: any[] = [];
  await infer(req, frame => frames.push(frame), (async () => sse(...sequence.map(detail => ({ choices: [{ delta: { reasoning_details: [detail] }, finish_reason: null }] })), { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-repeated', function: { name: alias, arguments: '{}' } }] }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }, '[DONE]')) as typeof fetch);
  const items = frames.filter(frame => frame.type === 'item_done').map(frame => frame.item);
  const next = { ...req, input: [...req.input, ...items, { type: 'function_call_output', call_id: 'call-repeated', output: 'done' }] }; const captured: any[] = [];
  await infer(next, () => {}, textFetch(next, captured));
  expect(captured[0].body.messages.find((message: any) => message.role === 'assistant').reasoning_details).toEqual([{ ...text, text: 'haha' }, { ...summary, summary: 'aa' }, encrypted, encrypted]);
});

test('fork inherits only retained provider pins and clears turns', async () => {
  setup();
  for (const provider of ['google', 'xai']) { const req = request(provider, 'turn-' + provider); await infer(req, () => {}, textFetch(req)); }
  const req = { ...request('google', 'fork-turn'), thread_id: 'fork-1', forked_from_thread_id: 'thread-1', fork_provider_ids: ['google'] };
  await infer(req, () => {}, textFetch(req));
  const state = JSON.parse(readFileSync(join(process.env.CODEX_HOME!, 'azrael/providers/sessions/fork-1.json'), 'utf8'));
  expect(Object.keys(state.providers)).toEqual(['google']);
  expect(Object.keys(state.turns)).toEqual(['fork-turn']);
});

test('safe catalog preserves opaque slashes without changing config; truncated streams fail', async () => {
  setup(); const path = join(process.env.OPENCODEX_HOME!, 'config.json'); const before = readFileSync(path, 'utf8');
  const models = await catalog({ fetch: catalogFixture });
  expect(models.models.some(model => model.model_id === 'anthropic/claude-sonnet-5')).toBeTrue();
  expect(readFileSync(path, 'utf8')).toBe(before);
  expect(JSON.stringify(models)).not.toContain('fixture-key');
  const req = request(); const frames: any[] = [];
  await expect(infer(req, frame => frames.push(frame), (async () => sse({ choices: [{ delta: { content: 'partial' }, finish_reason: null }] })) as typeof fetch)).rejects.toThrow();
  expect(frames.some(frame => frame.type === 'completed')).toBeFalse();
});

test('forced image models and unexpected media fail before parser artifact side effects', async () => {
  setup();
  const cfg = config.loadConfig(); cfg.providers.google.models!.push('gemini-3.1-flash-image'); config.saveConfig(cfg);
  expect((await catalog({ fetch: catalogFixture })).models.some(model => model.model_id === 'gemini-3.1-flash-image')).toBeFalse();
  let fetched = false;
  await expect(infer({ ...request('google', 'image-turn'), model: 'gemini-3.1-flash-image' }, () => {}, (async () => { fetched = true; return sse(); }) as typeof fetch)).rejects.toThrow('unsupported_output_modality');
  expect(fetched).toBeFalse();
  await expect(infer(request('google', 'unexpected-media'), () => {}, (async () => sse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] }, finishReason: 'STOP' }] })) as typeof fetch)).rejects.toThrow('unsupported_provider_output');
});

test('real helper process rejects malformed and oversized frames with safe versioned terminal only', async () => {
  setup();
  for (const payload of [
    JSON.stringify({ type: 'init', protocol_version: 9, request_id: 'fixture', credential: { api_key: 'DO_NOT_ECHO_SECRET' } }) + '\n' + JSON.stringify(request()) + '\n',
    'x'.repeat(32 * 1024 * 1024 + 1),
  ]) {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', 'inference.ts')], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    child.stdin.write(payload); child.stdin.end();
    const output = await new Response(child.stdout).text(); const stderr = await new Response(child.stderr).text();
    expect(await child.exited).toBe(1);
    expect(stderr).toBe('');
    const frames = output.trim().split('\n').map(line => JSON.parse(line));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(expect.objectContaining({ type: 'error', protocol_version: 1, seq: 0 }));
    expect(output).not.toContain('DO_NOT_ECHO_SECRET');
  }
});

test('real catalog process with empty configuration returns only an empty model catalog', async () => {
  setup();
  const cfg = config.loadConfig(); cfg.providers = {}; config.saveConfig(cfg);
  const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', 'inference.ts'), '--catalog'], { env: { ...process.env, CODEX_HOME: join(root, 'codex'), OPENCODEX_HOME: join(root, 'codex', 'azrael', 'providers', 'opencodex') }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const output = await new Response(child.stdout).text(), stderr = await new Response(child.stderr).text();
  expect(await child.exited).toBe(0);
  expect(JSON.parse(output)).toEqual({ models: [], provider_statuses: [] });
  expect(stderr).toBe('');
});


test('GLM 5.3 variants send exact selected efforts and replace incompatible saved settings', async () => {
  setup();let index=0;
  for (const model of ['z-ai/glm-5.3', 'z-ai/glm-5.3:batch', 'z-ai/glm-5.3-flash', 'z-ai/glm-5.3-flash:batch']) {
    for (const effort of ['low', 'high', 'max', 'medium', 'none']) {
      const req = { ...request('openrouter', `reasoning-${index++}`), model, reasoning_effort: effort };
      const captured: any[] = [];
      await infer(req, () => {}, textFetch(req, captured));
      expect(captured[0].body.reasoning).toEqual({ effort: ['low', 'high', 'max'].includes(effort) ? effort : 'max' });
      expect(captured[0].body.reasoning_effort).toBeUndefined();
    }
  }
});

test('identity-scoped discovered API efforts override fallback without network discovery during inference', async () => {
  setup();
  const model = 'z-ai/glm-5.3';
  await catalog({ fetch: (async () => Response.json({ data: [{ id: model, name: 'GLM fixture', context_length: 64000, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['tools', 'reasoning'], reasoning: { supported_efforts: ['high', 'low'], default_effort: 'high', mandatory: true } }] })) as typeof fetch });
  const req = { ...request('openrouter'), model, reasoning_effort: 'max' }, captured: any[] = [];
  await infer(req, () => {}, textFetch(req, captured));
  expect(captured.length).toBe(1);expect(captured[0].body.reasoning).toEqual({ effort: 'high' });
});

test('automatic and undeclared OpenRouter efforts omit the wire configuration', async () => {
  setup();
  for (const effort of [undefined, 'medium']) {
    const req = { ...request('openrouter', `automatic-${effort}`), reasoning_effort: effort }, captured: any[] = [];
    await infer(req, () => {}, textFetch(req, captured));
    expect(captured[0].body.reasoning).toBeUndefined();expect(captured[0].body.reasoning_effort).toBeUndefined();
  }
  const req = { ...request('openrouter', 'invalid-type'), reasoning_effort: 3 };
  await expect(infer(req, () => {}, textFetch(req))).rejects.toThrow('invalid_reasoning_effort');
});


test('native automatic marker omits effort even when none is a supported explicit choice',async()=>{
 setup();const model='fixture/automatic';
 await catalog({fetch:(async()=>Response.json({data:[{id:model,name:'Automatic fixture',context_length:64000,architecture:{input_modalities:['text'],output_modalities:['text']},supported_parameters:['tools','reasoning'],reasoning:{supported_efforts:['none','high'],mandatory:false}}]})) as typeof fetch});
 for(const effort of ['automatic','high','none']){
  const req={...request('openrouter',`auto-marker-${effort}`),model,reasoning_effort:effort},captured:any[]=[];
  await infer(req,()=>{},textFetch(req,captured));
  expect(captured[0].body.reasoning).toEqual(effort==='automatic'?undefined:{effort});
  expect(captured[0].body.reasoning_effort).toBeUndefined();
 }
});

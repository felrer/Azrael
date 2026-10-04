import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { infer, catalog, projectRequest } from '../inference.ts';
import { compileRequest } from '../inference-mapping.mjs';
import * as config from '../vendor/src/config.ts';
import * as store from '../vendor/src/oauth/store.ts';

const catalogFixture = (async () => { throw new Error('LIVE_NETWORK_FORBIDDEN'); }) as typeof fetch;
let root = '';
const oldHome = process.env.CODEX_HOME, oldProviderHome = process.env.OPENCODEX_HOME;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
  if (oldHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = oldHome;
  if (oldProviderHome === undefined) delete process.env.OPENCODEX_HOME; else process.env.OPENCODEX_HOME = oldProviderHome;
});
async function setup() {
  root = mkdtempSync(join(tmpdir(), 'azrael-managed-fixture-'));
  process.env.CODEX_HOME = join(root, 'codex');
  process.env.OPENCODEX_HOME = join(process.env.CODEX_HOME, 'azrael', 'providers', 'opencodex');
  mkdirSync(process.env.OPENCODEX_HOME, { recursive: true });
  const cfg = config.loadConfig();
  cfg.providers = { anthropic: { adapter: 'anthropic', baseUrl: 'https://api.anthropic.com', authMode: 'oauth', models: ['claude-sonnet-4-6'] } };
  config.saveConfig(cfg);
  await store.saveCredential('anthropic', credential('a'));
  return store.listAccounts('anthropic')[0]!.id;
}
const credential = (principal: string, access = 'fixture-access-' + principal) => ({ access, refresh: 'fixture-refresh-' + principal, expires: Date.now() + 3600_000, accountId: principal });

function request(provider_id = 'anthropic', turn_id = 'turn-1', input: any[] = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }], tools: any[] = []) {
  return { type: 'request', protocol_version: 1, request_id: 'fixture', thread_id: 'thread-1', turn_id, provider_id, model: 'claude-sonnet-4-6', instructions: 'fixture instructions', input, tools, parallel_tool_calls: true };
}
const sse = (...frames: any[]) => new Response(frames.map(frame => 'event: ' + frame.type + '\ndata: ' + JSON.stringify(frame) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
const start = { type: 'message_start', message: { id: 'fixture-message', role: 'assistant', content: [], usage: { input_tokens: 2 } } };
const finish = (stop_reason = 'end_turn') => [{ type: 'message_delta', delta: { stop_reason }, usage: { output_tokens: 3 } }, { type: 'message_stop' }];
const textFetch = (_req: any, captured?: any[]) => (async (url: any, init: any) => {
  captured?.push({ url: String(url), body: JSON.parse(init.body), headers: new Headers(init.headers) });
  return sse(start, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'fixture response' } }, { type: 'content_block_stop', index: 0 }, ...finish());
}) as typeof fetch;

test('Anthropic OAuth preserves text, usage and canonical endpoint', async () => {
  await setup(); const req = request(), frames: any[] = [], captured: any[] = [];
  await infer(req, frame => frames.push(frame), textFetch(req, captured));
  expect(frames[0].type).toBe('created');
  expect(frames.some(frame => frame.type === 'text_delta' && frame.delta === 'fixture response')).toBeTrue();
  expect(frames.at(-1)).toEqual({ type: 'completed', usage: expect.objectContaining({ input_tokens: 2, output_tokens: 3 }) });
  expect(captured[0].url).toBe('https://api.anthropic.com/v1/messages');
  expect(captured[0].headers.get('authorization')).toBe('Bearer fixture-access-a');
  expect(JSON.stringify(frames)).not.toContain('fixture-access');
});

test('OAuth endpoint edits and unsupported transports fail before fetch and disappear from catalog', async () => {
  await setup();
  for (const change of [{ baseUrl: 'http://127.0.0.1:9098/anthropic', allowPrivateNetwork: true }, { disabled: true }, { authMode: 'key' }, { authMode: 'local' }, { adapter: 'openai-chat' }]) {
    const cfg = config.loadConfig();
    cfg.providers.anthropic = { adapter: 'anthropic', baseUrl: 'https://api.anthropic.com', authMode: 'oauth', models: ['claude-sonnet-4-6'], ...change } as any;
    config.saveConfig(cfg); let fetched = false;
    const fetcher = (async () => { fetched = true; throw new Error('LIVE_NETWORK_FORBIDDEN'); }) as typeof fetch;
    expect((await catalog({ fetch: fetcher })).models.some(model => model.provider_id === 'anthropic')).toBeFalse();
    await expect(infer(request(), () => {}, fetcher)).rejects.toThrow('provider_unavailable');
    expect(fetched).toBeFalse();
  }
});

test('original OAuth account stays pinned across selection and token rotation', async () => {
  const account = await setup(); const req = request(); await infer(req, () => {}, textFetch(req));
  await store.saveCredential('anthropic', credential('b'));
  const other = store.listAccounts('anthropic').find(entry => entry.id !== account)!.id;
  await store.setActiveAccount('anthropic', other);
  await store.saveAccountCredential('anthropic', account, credential('a', 'fixture-rotated-a'));
  const captured: any[] = [];
  await infer(request('anthropic', 'turn-2'), () => {}, textFetch(req, captured));
  expect(captured[0].headers.get('authorization')).toBe('Bearer fixture-rotated-a');
  expect(store.getAccountSet('anthropic')!.activeAccountId).toBe(other);
});

test('same-turn selection and replaced or removed OAuth identity fail closed', async () => {
  const account = await setup(); const req = request(); await infer(req, () => {}, textFetch(req));
  let fetched = false;
  const fetcher = (async () => { fetched = true; throw new Error('LIVE_NETWORK_FORBIDDEN'); }) as typeof fetch;
  await expect(infer({ ...req, model: 'claude-opus-4-6' }, () => {}, fetcher)).rejects.toThrow('turn_selection_mismatch');
  await expect(infer({ ...req, provider_id: 'google-antigravity' }, () => {}, fetcher)).rejects.toThrow('turn_selection_mismatch');
  await store.saveAccountCredential('anthropic', account, credential('replacement'));
  await expect(infer(request('anthropic', 'turn-2'), () => {}, fetcher)).rejects.toThrow('pinned_account_changed');
  await store.removeAccount('anthropic', account);
  await expect(infer(request('anthropic', 'turn-3'), () => {}, fetcher)).rejects.toThrow('pinned_account_missing');
  expect(fetched).toBeFalse();
});

test('configured retired Google, xAI and OpenRouter never fetch or enter catalog', async () => {
  await setup(); const cfg = config.loadConfig(); cfg.providers = {};
  for (const id of ['google', 'xai', 'openrouter']) cfg.providers[id] = { adapter: id === 'google' ? 'google' : 'openai-chat', baseUrl: 'https://fixture.invalid', authMode: 'key', apiKey: 'fixture-retired-key', models: ['fixture-model'] } as any;
  config.saveConfig(cfg); let fetched = false;
  const fetcher = (async () => { fetched = true; throw new Error('LIVE_NETWORK_FORBIDDEN'); }) as typeof fetch;
  expect((await catalog({ fetch: fetcher })).models).toEqual([]);
  for (const id of ['google', 'xai', 'openrouter']) await expect(infer(request(id), () => {}, fetcher)).rejects.toThrow('invalid_selection');
  expect(fetched).toBeFalse();
});

test('binding and ancestor reads reject oversized, malformed, unsafe-key or inconsistent state', async () => {
  await setup();
  const req = request(); await infer(req, () => {}, textFetch(req));
  const directory = join(process.env.CODEX_HOME!, 'azrael/providers/sessions'); const path = join(directory, 'thread-1.json');
  const original = readFileSync(path, 'utf8');
  for (const contents of ['x'.repeat(1024 * 1024 + 1), '{broken', JSON.stringify({ version: 1, thread_id: 'thread-1', providers: [], turns: {} }), original.replace(/"fingerprint":"[a-f0-9]{64}"/, '"fingerprint":"invalid"'), original.replace('"turn-1":', '"__proto__":')]) {
    writeFileSync(path, contents);
    await expect(infer(request('anthropic', 'turn-2'), () => {}, textFetch(req))).rejects.toThrow();
    const fork = { ...request('anthropic', 'fork-turn'), thread_id: 'bad-ancestor-fork', forked_from_thread_id: 'thread-1', fork_provider_ids: ['anthropic'] };
    await expect(infer(fork, () => {}, textFetch(fork))).rejects.toThrow();
    expect(existsSync(join(directory, 'bad-ancestor-fork.json'))).toBeFalse();
  }
  writeFileSync(path, original);
  for (const id of ['__proto__', 'constructor', 'prototype']) await expect(infer({ ...req, turn_id: id }, () => {}, textFetch(req))).rejects.toThrow('invalid_selection');
  for (const model of ['', ['invalid'], 'invalid\nmodel']) await expect(infer({ ...req, turn_id: 'invalid-model', model }, () => {}, textFetch(req))).rejects.toThrow('invalid_selection');
  await infer(request('anthropic', 'turn-2'), () => {}, textFetch(req));
});

test('empty fork lineage supports its first managed OAuth turn', async () => {
  await setup();
  const fork = { ...request('anthropic', 'first-managed'), thread_id: 'fork-openai', forked_from_thread_id: 'no-managed-ancestor', fork_provider_ids: [] };
  await infer(fork, () => {}, textFetch(fork));
});

test('namespaced function, custom and client tool-search calls restore exact native identities', async () => {
  await setup();
  const tools = [{ type: 'namespace', name: 'functions', tools: [{ type: 'function', name: 'exec', description: 'run', parameters: { type: 'object' } }, { type: 'custom', name: 'patch', description: 'patch' }] }, { type: 'tool_search', execution: 'client', parameters: { type: 'object' } }];
  for (let i = 0; i < 3; i++) {
    const req = request('anthropic', 'tool-' + i, undefined, tools), frames: any[] = [];
    const args = i === 1 ? { input: 'exact\npatch' } : { value: 'fixture' };
    await infer(req, frame => frames.push(frame), (async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      return sse(start, { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call-fixture', name: body.tools[i].name, input: {} } }, { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(args) } }, { type: 'content_block_stop', index: 0 }, ...finish('tool_use'));
    }) as typeof fetch);
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

test('fork inherits the original OAuth account despite changed selection and clears turns', async () => {
  const account = await setup(); const source = request(); await infer(source, () => {}, textFetch(source));
  await store.saveCredential('anthropic', credential('b'));
  await store.setActiveAccount('anthropic', store.listAccounts('anthropic').find(entry => entry.id !== account)!.id);
  await store.saveAccountCredential('anthropic', account, credential('a', 'fixture-rotated-a'));
  const req = { ...request('anthropic', 'fork-turn'), thread_id: 'fork-1', forked_from_thread_id: 'thread-1', fork_provider_ids: ['anthropic'] };
  const captured: any[] = []; await infer(req, () => {}, textFetch(req, captured));
  expect(captured[0].headers.get('authorization')).toBe('Bearer fixture-rotated-a');
  const state = JSON.parse(readFileSync(join(process.env.CODEX_HOME!, 'azrael/providers/sessions/fork-1.json'), 'utf8'));
  expect(Object.keys(state.providers)).toEqual(['anthropic']);
  expect(state.providers.anthropic.account_id).toBe(account);
  expect(Object.keys(state.turns)).toEqual(['fork-turn']);
});

test('safe OAuth catalog preserves config; truncated streams never complete', async () => {
  await setup(); const path = join(process.env.OPENCODEX_HOME!, 'config.json'); const before = readFileSync(path, 'utf8');
  const models = await catalog({ fetch: catalogFixture });
  expect(models.models.some(model => model.model_id === 'claude-sonnet-4-6')).toBeTrue();
  expect(readFileSync(path, 'utf8')).toBe(before);
  expect(JSON.stringify(models)).not.toContain('fixture-key');
  const req = request(); const frames: any[] = [];
  await expect(infer(req, frame => frames.push(frame), (async () => sse(start, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'partial' } })) as typeof fetch)).rejects.toThrow();
  expect(frames.some(frame => frame.type === 'completed')).toBeFalse();
});

test('unsupported input media fails before fetch', async () => {
  await setup(); let fetched = false;
  const fetcher = (async () => { fetched = true; throw new Error('LIVE_NETWORK_FORBIDDEN'); }) as typeof fetch;
  for (const part of [{ type: 'input_image', image_url: 'https://fixture.invalid/image.png' }, { type: 'input_audio', data: 'AAAA' }]) {
    await expect(infer(request('anthropic', 'media-' + part.type, [{ type: 'message', role: 'user', content: [part] }]), () => {}, fetcher)).rejects.toThrow();
  }
  expect(fetched).toBeFalse();
});

test('real helper process rejects malformed and oversized frames with safe versioned terminal only', async () => {
  await setup();
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
  await setup();
  const cfg = config.loadConfig(); cfg.providers = {}; config.saveConfig(cfg);
  const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', 'inference.ts'), '--catalog'], { env: { ...process.env, CODEX_HOME: join(root, 'codex'), OPENCODEX_HOME: join(root, 'codex', 'azrael', 'providers', 'opencodex') }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const output = await new Response(child.stdout).text(), stderr = await new Response(child.stderr).text();
  expect(await child.exited).toBe(0);
  expect(JSON.parse(output)).toEqual({ models: [], provider_statuses: [] });
  expect(stderr).toBe('');
});

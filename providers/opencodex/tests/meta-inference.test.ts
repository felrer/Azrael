import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { infer, catalog } from '../inference.ts';
import { compileRequest } from '../inference-mapping.mjs';
import * as config from '../vendor/src/config.ts';
import * as store from '../vendor/src/oauth/store.ts';

let root = '';
const prior = { CODEX_HOME: process.env.CODEX_HOME, OPENCODEX_HOME: process.env.OPENCODEX_HOME };
afterEach(() => {
  if (root) rmSync(root, { recursive: true });
  root = '';
  for (const [name, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}, 30000);
const key = (identity: string) => 'LLM|123|' + identity.repeat(20);
const credential = (identity: string) => ({ access: key(identity), refresh: key(identity), expires: Number.MAX_SAFE_INTEGER, email: identity + '@example.test', source: 'oauth' as const });
async function setup() {
  root = mkdtempSync(join(tmpdir(), 'azrael-meta-inference-'));
  process.env.CODEX_HOME = join(root, 'codex');
  process.env.OPENCODEX_HOME = join(process.env.CODEX_HOME, 'azrael/providers/opencodex');
  mkdirSync(process.env.OPENCODEX_HOME, { recursive: true });
  const cfg = config.loadConfig();
  cfg.providers = { 'meta-muse': { adapter: 'openai-responses', baseUrl: 'https://api.meta.ai/v1', authMode: 'oauth' } };
  config.saveConfig(cfg);
  await store.saveCredential('meta-muse', credential('a'));
  return store.getAccountSet('meta-muse')!.activeAccountId;
}
const user = { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] };
function request(turn_id = 'turn-1', tools: any[] = [], input: any[] = [user]) {
  return { type: 'request', protocol_version: 1, request_id: 'meta-fixture', thread_id: 'thread-1', turn_id,
    provider_id: 'meta-muse', model: 'muse-spark-1.3', instructions: 'Azrael instructions', tools, input,
    parallel_tool_calls: true, reasoning_effort: 'high' };
}
const sse = (...events: any[]) => new Response(events.map(e => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
const completed = (output: any[]) => ({ type: 'response.completed', response: { status: 'completed', output,
  usage: { input_tokens: 7, output_tokens: 5, input_tokens_details: { cached_tokens: 2 }, output_tokens_details: { reasoning_tokens: 1 } } } });
const text = { type: 'message', id: 'msg-meta', role: 'assistant', content: [{ type: 'output_text', text: 'Meta response' }] };
const fixture = (events: any[], captured: any[] = []) => (async (url: any, init: any) => {
  captured.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
  return sse(...events);
}) as typeof fetch;

test('Meta OAuth catalog and Responses preserve canonical auth, image input and token usage', async () => {
  await setup(); const frames: any[] = [], captured: any[] = [];
  const discovery = await catalog({ fetch: (async () => { throw Error('live network forbidden'); }) as unknown as typeof fetch });
  expect(discovery.models.map(m => m.model_id)).toEqual(['muse-spark-1.3', 'muse-spark-1.3-contributor']);
  expect(discovery.models[0]).toMatchObject({ provider_id: 'meta-muse', context_window: 1048576, input_modalities: ['text', 'image'] });
  expect(discovery.models[0].reasoning.supported_efforts).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh']);
  const req = request(); req.input = [{ ...user, content: [...user.content, { type: 'input_image', image_url: 'data:image/png;base64,YQ==' }] }] as any;
  await infer(req, f => frames.push(f), fixture([completed([text])], captured));
  expect(captured[0].url).toBe('https://api.meta.ai/v1/responses');
  expect(captured[0].headers.get('authorization')).toBe('Bearer ' + key('a'));
  expect(captured[0].headers.get('x-api-version')).toBe('1.0.0');
  expect(captured[0].body).toMatchObject({ model: 'muse-spark-1.3', instructions: 'Azrael instructions', store: false,
    reasoning: { effort: 'high' }, include: ['reasoning.encrypted_content'] });
  expect(captured[0].body.input[0].content[1]).toEqual({ type: 'input_image', image_url: 'data:image/png;base64,YQ==' });
  expect(frames.at(-1)).toMatchObject({ type: 'completed', usage: { input_tokens: 7, output_tokens: 5, cached_input_tokens: 2, reasoning_output_tokens: 1 } });
  expect(JSON.stringify(frames)).not.toContain(key('a'));
}, 30000);

test('Meta tools restore function/custom/search identity and private reasoning replays only matching scope', async () => {
  await setup(); const frames: any[] = [], captured: any[] = [];
  const tools = [
    { type: 'namespace', name: 'functions', tools: [{ type: 'function', name: 'execute', description: 'Execute', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } }] },
    { type: 'custom', name: 'apply_patch', description: 'Patch' },
    { type: 'tool_search', execution: 'client', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  ];
  const req = request('turn-1', tools), compiled = compileRequest(req);
  const args = ['{"command":"echo hello"}', '{"input":"*** Begin Patch\\n*** End Patch"}', '{"query":"Meta tools"}'];
  const output = [{ type: 'reasoning', id: 'rs-meta', status: 'completed', summary: [], encrypted_content: 'meta-native-ciphertext' },
    ...compiled.tools.map((t: any, i: number) => ({ type: 'function_call', id: 'fc-' + i, call_id: 'call-' + i, name: t.name, arguments: args[i] }))];
  await infer(req, f => frames.push(f), fixture([completed(output)], captured));
  expect(captured[0].body.tools.every((t: any) => t.name.length <= 64 && t.type === 'function')).toBeTrue();
  const items = frames.filter(f => f.type === 'item_done').map(f => f.item);
  expect(items.find(i => i.type === 'function_call')).toMatchObject({ name: 'execute', namespace: 'functions', call_id: 'call-0' });
  expect(items.find(i => i.type === 'custom_tool_call')).toMatchObject({ name: 'apply_patch', input: '*** Begin Patch\n*** End Patch' });
  expect(items.find(i => i.type === 'tool_search_call')).toMatchObject({ execution: 'client', call_id: 'call-2' });
  const outputs = [
    { type: 'function_call_output', call_id: 'call-0', output: 'hello' },
    { type: 'custom_tool_call_output', call_id: 'call-1', output: 'applied' },
    { type: 'tool_search_output', call_id: 'call-2', execution: 'client', status: 'completed', tools: [] },
  ];
  const history = [user, ...items, ...outputs];
  await infer(request('turn-1', tools, history), () => {}, fixture([completed([text])], captured));
  expect(captured[1].body.input.find((i: any) => i.type === 'reasoning')).toMatchObject({ encrypted_content: 'meta-native-ciphertext' });
  expect(JSON.stringify(captured[1].body)).not.toContain('azrael-managed-v1:');
  await infer(request('turn-2', tools, history), () => {}, fixture([completed([text])], captured));
  expect(captured[2].body.input.some((i: any) => i.type === 'reasoning')).toBeFalse();
}, 30000);

test('Meta pinned account survives default changes and rejects endpoint edits, replaced keys and incomplete tools', async () => {
  const a = await setup(); const frames: any[] = [], captured: any[] = [];
  await infer(request(), f => frames.push(f), fixture([completed([text])], captured));
  await store.saveCredential('meta-muse', credential('b'), { preserveSelection: true });
  const b = store.listAccounts('meta-muse').find(x => x.id !== a)!;
  await store.commitOAuthAccountSelection('meta-muse', b.id, { requireUsableAccount: true });
  await infer(request('turn-2'), () => {}, fixture([completed([text])], captured));
  expect(captured[1].headers.get('authorization')).toBe('Bearer ' + key('a'));
  const cfg = config.loadConfig(); cfg.providers['meta-muse'].baseUrl = 'http://127.0.0.1:9999/v1'; config.saveConfig(cfg);
  await expect(infer(request('turn-3'), () => {}, fixture([], captured))).rejects.toThrow('provider_unavailable');
  expect((await catalog()).models).toEqual([]);
  cfg.providers['meta-muse'].baseUrl = 'https://api.meta.ai/v1'; config.saveConfig(cfg);
  await store.saveCredential('meta-muse', { ...credential('a'), access: key('c'), refresh: key('c') }, { preserveSelection: true });
  await expect(infer(request('turn-4'), () => {}, fixture([], captured))).rejects.toThrow('pinned_account_changed');
  expect(captured).toHaveLength(2);
}, 30000);

test('Meta incomplete or undeclared calls never emit an executable native item', async () => {
  await setup(); const tools = [{ type: 'function', name: 'execute', parameters: { type: 'object', properties: {} } }];
  for (const event of [
    { type: 'response.incomplete', response: { status: 'incomplete' } },
    completed([{ type: 'function_call', call_id: 'bad', name: 'undeclared', arguments: '{}' }]),
  ]) {
    const frames: any[] = [];
    await expect(infer(request('turn-1', tools), f => frames.push(f), fixture([event]))).rejects.toThrow();
    expect(frames.some(f => f.type === 'completed' || f.item?.type === 'function_call')).toBeFalse();
  }
}, 30000);

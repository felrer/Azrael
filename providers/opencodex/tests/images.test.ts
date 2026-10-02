import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { catalog, infer, projectRequest } from '../inference.ts';
import { discoverAnthropicCatalog } from '../catalog.ts';
import { compileRequest, MAX_IMAGE_BYTES } from '../inference-mapping.mjs';
import * as config from '../vendor/src/config.ts';
import * as store from '../vendor/src/oauth/store.ts';

// A valid 2x2 RGB PNG so provider-side image normalization can decode it.
function png(): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const head = Buffer.alloc(4); head.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(body)); return Buffer.concat([head, body, tail]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 0]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
const PNG = png();
const dataUrl = `data:image/png;base64,${PNG}`;

let root = '';
let originalFetch: typeof fetch;
afterEach(() => { if (originalFetch) globalThis.fetch = originalFetch; if (root) rmSync(root, { recursive: true, force: true }); });
async function setup(providers: Record<string, any>) {
  root = mkdtempSync(join(tmpdir(), 'azrael-managed-images-'));
  process.env.CODEX_HOME = join(root, 'codex');
  process.env.OPENCODEX_HOME = join(process.env.CODEX_HOME, 'azrael/providers/opencodex');
  mkdirSync(process.env.OPENCODEX_HOME, { recursive: true });
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('LIVE_NETWORK_FORBIDDEN'); }) as typeof fetch;
  const cfg = config.loadConfig();
  cfg.providers = providers;
  config.saveConfig(cfg);
}
const input = [
  { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'describe' }, { type: 'input_image', image_url: dataUrl, detail: 'high' }] },
  { type: 'function_call', call_id: 'view-1', name: 'view_image', arguments: '{"path":"a.png"}' },
  { type: 'function_call_output', call_id: 'view-1', output: [{ type: 'input_text', text: 'loaded' }, { type: 'input_image', image_url: dataUrl }] },
];
const tools = [{ type: 'function', name: 'view_image', description: 'View an image', parameters: { type: 'object', properties: { path: { type: 'string' } } } }];
const request = (provider_id: string, model: string, extra: any = {}) => ({ type: 'request', protocol_version: 1, request_id: 'fixture', thread_id: 'thread', turn_id: 'turn', provider_id, model, instructions: 'fixture instructions', input, tools, parallel_tool_calls: false, ...extra });

test('user and tool-result images project to ordered vendored content parts', () => {
  const { parsed } = projectRequest(request('anthropic', 'claude-sonnet-5'), 'local');
  const [user, , tool] = parsed.context.messages as any[];
  expect(user).toEqual({ role: 'user', content: [{ type: 'text', text: 'describe' }, { type: 'image', imageUrl: dataUrl }], timestamp: 0 });
  expect(tool.role).toBe('toolResult');
  expect(tool.content).toEqual([{ type: 'text', text: 'loaded' }, { type: 'image', imageUrl: dataUrl }]);
});

test('Claude subscription wire carries user image blocks and tool_result images', async () => {
  await setup({ anthropic: { adapter: 'anthropic', baseUrl: 'https://api.anthropic.com', authMode: 'oauth', models: ['claude-sonnet-5'] } });
  await store.saveCredential('anthropic', { access: 'claude-access', refresh: 'claude-refresh', expires: Number.MAX_SAFE_INTEGER, accountId: 'claude-user', source: 'oauth' });
  const captured: any[] = [];
  const events = [
    { type: 'message_start', message: { id: 'msg', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], usage: { input_tokens: 5, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'green' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];
  const fetcher = (async (_url: any, init: any) => {
    captured.push(JSON.parse(init.body));
    return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  const frames: any[] = [];
  await infer(request('anthropic', 'claude-sonnet-5'), frame => frames.push(frame), fetcher);
  expect(frames.some(frame => frame.type === 'completed')).toBeTrue();
  const messages = captured[0].messages;
  const userImages = messages[0].content.filter((part: any) => part.type === 'image');
  expect(userImages).toHaveLength(1);
  expect(userImages[0].source.type).toBe('base64');
  const toolResult = messages.flatMap((message: any) => Array.isArray(message.content) ? message.content : []).find((part: any) => part.type === 'tool_result');
  expect(toolResult.content.some((part: any) => part.type === 'image' && part.source.type === 'base64')).toBeTrue();
});

test('Antigravity CCA wire carries inline image data and catalog declares configured modalities', async () => {
  const id = 'google-antigravity';
  await setup({ [id]: { adapter: 'google', baseUrl: 'https://daily-cloudcode-pa.googleapis.com', authMode: 'oauth', googleMode: 'cloud-code-assist' } });
  await store.saveCredential(id, { access: 'access-a', refresh: 'refresh-a', expires: Number.MAX_SAFE_INTEGER, accountId: 'a', projectId: 'project-a' });
  await store.setActiveAccount(id, store.listAccounts(id)[0]!.id);
  const listed = await catalog({ now: 1 });
  const modalities = Object.fromEntries(listed.models.filter(model => model.provider_id === id).map(model => [model.model_id, model.input_modalities]));
  expect(modalities['gemini-3.8-flash']).toEqual(['text', 'image']);
  expect(modalities['gpt-oss-120b-medium']).toEqual(['text']);
  const captured: any[] = [];
  const fetcher = (async (_url: any, init: any) => {
    captured.push(JSON.parse(init.body));
    return new Response('data: ' + JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: 'green' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 } } }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  await infer(request(id, 'gemini-3.8-flash', { instructions: '' }), () => {}, fetcher);
  const parts = captured[0].request.contents.flatMap((content: any) => content.parts);
  expect(parts.filter((part: any) => part.inline_data?.data === PNG || part.inlineData?.data === PNG).length).toBe(2);
});

test('Anthropic discovery maps image_input capability; missing capability stays text-only', async () => {
  await setup({});
  const fetcher = (async () => Response.json({ has_more: false, data: [
    { id: 'claude-vision', display_name: 'Vision', max_input_tokens: 1000, capabilities: { image_input: { supported: true } } },
    { id: 'claude-text', display_name: 'Text', max_input_tokens: 1000, capabilities: { image_input: { supported: false } } },
    { id: 'claude-unknown', display_name: 'Unknown', max_input_tokens: 1000 },
  ] })) as typeof fetch;
  const result = await discoverAnthropicCatalog({ adapter: 'anthropic', baseUrl: 'https://api.anthropic.com', authMode: 'oauth', models: [] }, {
    accountId: 'account', identity: ['accountId', 'user'], accessToken: 'access', refresh: true, fetch: fetcher, now: 10,
  });
  expect(Object.fromEntries(result.models.map(model => [model.model_id, model.input_modalities]))).toEqual({
    'claude-vision': ['text', 'image'], 'claude-text': ['text'], 'claude-unknown': ['text'],
  });
});

test('remote, unsupported, misplaced and oversized images fail with enumerated codes', () => {
  const base = { type: 'request', protocol_version: 1, request_id: 'r', model: 'm', tools: [] };
  const user = (image_url: string) => ({ ...base, input: [{ type: 'message', role: 'user', content: [{ type: 'input_image', image_url }] }] });
  expect(() => compileRequest(user('https://fixture.invalid/a.png'))).toThrow('remote_image_unsupported');
  expect(() => compileRequest(user('data:image/bmp;base64,AAAA'))).toThrow('unsupported_image_format');
  expect(() => compileRequest(user('data:image/png;base64,AA'))).toThrow('invalid_image_input');
  expect(() => compileRequest({ ...base, input: [{ type: 'message', role: 'developer', content: [{ type: 'input_image', image_url: dataUrl }] }] })).toThrow('unsupported_nontext_content');
  const half = 'A'.repeat(MAX_IMAGE_BYTES / 2);
  expect(() => compileRequest({ ...base, input: [{ type: 'message', role: 'user', content: [
    { type: 'input_image', image_url: `data:image/png;base64,${half}` }, { type: 'input_image', image_url: `data:image/png;base64,${half}AAAA` },
  ] }] })).toThrow('image_input_too_large');
});

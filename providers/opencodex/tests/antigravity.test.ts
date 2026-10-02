import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { infer, catalog } from '../inference.ts';
import { resolveAntigravityAccount } from '../antigravity.ts';
import * as config from '../vendor/src/config.ts';
import * as store from '../vendor/src/oauth/store.ts';
import { createProgressMonitor } from '../../devin/progress.mjs';

const id = 'google-antigravity';
let root = '';
let originalFetch: typeof fetch;
const credential = (principal: string, extra: any = {}) => ({ access: 'access-' + principal, refresh: 'refresh-' + principal, expires: Number.MAX_SAFE_INTEGER, accountId: principal, projectId: 'project-' + principal, ...extra });
async function setup() {
  root = mkdtempSync(join(tmpdir(), 'azrael-antigravity-'));
  process.env.CODEX_HOME = join(root, 'codex');
  process.env.OPENCODEX_HOME = join(process.env.CODEX_HOME, 'azrael/providers/opencodex');
  mkdirSync(process.env.OPENCODEX_HOME, { recursive: true });
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('LIVE_NETWORK_FORBIDDEN'); }) as typeof fetch;
  const cfg = config.loadConfig();
  cfg.providers = { [id]: { adapter: 'google', baseUrl: 'https://daily-cloudcode-pa.googleapis.com', authMode: 'oauth', googleMode: 'cloud-code-assist' } };
  config.saveConfig(cfg);
  await store.saveCredential(id, credential('a'));
  await store.saveCredential(id, credential('b'));
  const accounts = store.listAccounts(id);
  expect(accounts.every(a => /^[a-f0-9]{32}$/.test(a.id))).toBeTrue();
  await store.setActiveAccount(id, accounts[0]!.id);
  return accounts;
}
afterEach(() => { if (originalFetch) globalThis.fetch = originalFetch; if (root) rmSync(root, { recursive: true, force: true }); });
const request = (turn_id = 'turn', extra: any = {}) => ({ type: 'request', protocol_version: 1, request_id: 'fixture', thread_id: 'thread', turn_id, provider_id: id, model: 'gemini-3.8-flash', instructions: '', input: [{ type: 'message', role: 'user', content: 'hello' }], tools: [], ...extra });
const sse = (response: any) => new Response('data: ' + JSON.stringify({ response }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
const textResponse = () => sse({ candidates: [{ content: { parts: [{ text: 'hello back' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 } });
const textFetch = (captured: any[] = []) => (async (url: any, init: any) => { captured.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) }); return textResponse(); }) as typeof fetch;
const binding = (thread = 'thread') => JSON.parse(readFileSync(join(process.env.CODEX_HOME!, 'azrael/providers/sessions', thread + '.json'), 'utf8'));

test('CCA wrapped text, usage and canonical envelope use selected OAuth snapshot', async () => {
  await setup(); const frames: any[] = [], wire: any[] = [];
  await infer(request(), f => frames.push(f), textFetch(wire));
  expect(wire[0].headers.get('authorization')).toBe('Bearer access-a');
  expect(wire[0].body.project).toBe('project-a');
  expect(wire[0].url).toContain(':streamGenerateContent');
  expect(frames.some(f => f.type === 'text_delta' && f.delta === 'hello back')).toBeTrue();
  expect(frames.at(-1)).toEqual({ type: 'completed', usage: expect.objectContaining({ input_tokens: 2, output_tokens: 3 }) });
  expect(JSON.stringify(frames)).not.toContain('access-a');
});

test('selection changes affect new threads; retained pins and forks keep original slot across token rotation', async () => {
  const accounts = await setup();
  await infer(request(), () => {}, textFetch()); const pin = binding().providers[id];
  await store.setActiveAccount(id, accounts[1]!.id);
  const selected = await resolveAntigravityAccount(config.loadConfig().providers[id]);
  expect(selected.accountId).toBe(accounts[1]!.id);
  const wire: any[] = [];
  await infer(request('next'), () => {}, textFetch(wire));
  await infer(request('fresh', { thread_id: 'fresh' }), () => {}, textFetch(wire));
  await store.saveCredential(id, credential('a', { access: 'rotated-access', refresh: 'rotated-refresh' }), { preserveSelection: true });
  await infer(request('rotated'), () => {}, textFetch(wire));
  expect(binding().providers[id]).toEqual(pin);
  await infer(request('fork-turn', { thread_id: 'fork', forked_from_thread_id: 'thread', fork_provider_ids: [id] }), () => {}, textFetch(wire));
  expect(wire.map(w => w.body.project)).toEqual(['project-a', 'project-b', 'project-a', 'project-a']);
  expect(wire[2].headers.get('authorization')).toBe('Bearer rotated-access');
  expect(binding('fork').providers[id]).toEqual(pin);
  expect(Object.keys(binding('fork').turns)).toEqual(['fork-turn']);
  expect(store.getAccountSet(id)!.activeAccountId).toBe(accounts[1]!.id);
});

for (const change of ['project', 'principal', 'endpoint', 'remove', 'reauth']) test('pinned ' + change + ' change fails before any network', async () => {
  const accounts = await setup(); await infer(request(), () => {}, textFetch());
  if (change === 'project') await store.saveCredential(id, credential('a', { projectId: 'different-project' }));
  if (change === 'principal') await store.mutateStore(s => { s[id]!.accounts[0]!.credential.accountId = 'different-principal'; });
  if (change === 'endpoint') { const cfg = config.loadConfig(); cfg.providers[id]!.baseUrl = 'https://cloudcode-pa.googleapis.com'; config.saveConfig(cfg); }
  if (change === 'remove') await store.removeAccount(id, accounts[0]!.id);
  if (change === 'reauth') await store.markAccountNeedsReauth(id, accounts[0]!.id, true);
  let fetched = false;
  await expect(infer(request('next'), () => {}, (async () => { fetched = true; return textResponse(); }) as typeof fetch)).rejects.toThrow(change === 'remove' ? 'pinned_account_missing' : change === 'reauth' ? 'pinned_account_unavailable' : 'pinned_account_changed');
  expect(fetched).toBeFalse();
});

test('CCA tool call and native signature replay survive tool output loop', async () => {
  await setup(); const frames: any[] = [];
  const req = request('tools', { tools: [{ type: 'function', name: 'exec', parameters: { type: 'object' } }] });
  await infer(req, f => frames.push(f), (async (_url: any, init: any) => {
    const wire = JSON.parse(init.body).request;
    return sse({ candidates: [{ content: { parts: [{ functionCall: { name: wire.tools[0].functionDeclarations[0].name, args: { exact: 1 } }, thoughtSignature: 'private-signature-fixture-123456' }] }, finishReason: 'STOP' }] });
  }) as typeof fetch);
  const items = frames.filter(f => f.type === 'item_done').map(f => f.item);
  const call = items.find(i => i.type === 'function_call');
  expect(call.name).toBe('exec');
  const wire: any[] = [];
  await infer({ ...req, input: [...req.input, ...items, { type: 'function_call_output', call_id: call.call_id, output: 'done' }] }, () => {}, textFetch(wire));
  const parts = wire[0].body.request.contents.flatMap((c: any) => c.parts);
  expect(parts.find((p: any) => p.functionCall).thoughtSignature).toBe('private-signature-fixture-123456');
  expect(JSON.stringify(parts.find((p: any) => p.functionResponse))).toContain('done');
});

test('progress reports received bytes while a managed tool call waits for the terminal event', async () => {
  await setup();
  const req = request('progress-tools', { tools: [{ type: 'function', name: 'exec', parameters: { type: 'object' } }] });
  const frames: any[] = [];
  let release!: () => void;
  const monitor = createProgressMonitor(frame => frames.push(frame), { intervalMs: 10 });
  try {
    const pending = infer(req, frame => frames.push(frame), (async (_url: any, init: any) => {
      const name = JSON.parse(init.body).request.tools[0].functionDeclarations[0].name;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          const first = { response: { candidates: [{ content: { parts: [{ functionCall: { name, args: { value: 'PRIVATE_TOOL_ARGUMENT' } } }] } }] } };
          controller.enqueue(encoder.encode('data: ' + JSON.stringify(first) + '\n\n'));
          release = () => {
            const last = { response: { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] } };
            controller.enqueue(encoder.encode('data: ' + JSON.stringify(last) + '\n\n'));
            controller.close();
          };
        },
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch, monitor);
    for (let attempt = 0; attempt < 100 && monitor.snapshot().event_count === 0; attempt++) await Bun.sleep(5);
    expect(monitor.snapshot().bytes_received).toBeGreaterThan(0);
    await Bun.sleep(25);
    const progress = frames.find(frame => frame.type === 'progress' && frame.progress.bytes_received > 0);
    expect(progress?.progress.first_byte_ms).toBeGreaterThanOrEqual(0);
    expect(progress?.progress.event_count).toBeGreaterThan(0);
    expect(frames.some(frame => frame.type === 'item_done' && frame.item.type === 'function_call')).toBeFalse();
    expect(JSON.stringify(progress)).not.toContain('PRIVATE_TOOL_ARGUMENT');
    release();
    await pending;
    expect(frames.at(-1).type).toBe('completed');
  } finally {
    monitor.stop();
  }
});

test('catalog returns six text models without fetching or changing selection, with fail-closed status', async () => {
  const accounts = await setup(); let fetched = false;
  const options = { now: 1234, fetch: (async () => { fetched = true; throw new Error('LIVE_NETWORK_FORBIDDEN'); }) as typeof fetch };
  const result = await catalog(options);
  expect(result.models.filter(m => m.provider_id === id)).toHaveLength(6);
  expect(result.models.some(m => m.model_id === 'gemini-3.1-flash-image')).toBeFalse();
  const flash = result.models.find(m => m.provider_id === id && m.model_id === 'gemini-3.8-flash');
  expect(flash?.reasoning).toEqual({ supported_efforts: ['low', 'medium', 'high'], mandatory: false });
  const opus = result.models.find(m => m.provider_id === id && m.model_id === 'claude-opus-4-6-thinking');
  expect(opus?.reasoning?.supported_efforts).toEqual(['low', 'medium', 'high', 'max']);
  const unknown = result.models.find(m => m.provider_id === id && m.model_id === 'gpt-oss-120b-medium');
  expect(unknown?.reasoning?.supported_efforts).toEqual([]);
  expect(result.provider_statuses).toContainEqual({ provider_id: id, state: 'ready', model_count: 6, observed_at: 1234 });
  expect(store.getAccountSet(id)!.activeAccountId).toBe(accounts[0]!.id);
  await store.markAccountNeedsReauth(id, accounts[0]!.id, true);
  expect((await catalog(options)).provider_statuses).toContainEqual({ provider_id: id, state: 'error', model_count: 0, observed_at: 1234, error_code: 'unavailable' });
  expect(fetched).toBeFalse();
});

test('selected Google reasoning stage follows the adapter wire mapping', async () => {
  await setup();
  const wire: any[] = [];
  await infer(request('low', { reasoning_effort: 'low' }), () => {}, textFetch(wire));
  await infer(request('high', { reasoning_effort: 'high' }), () => {}, textFetch(wire));
  expect(wire.map(row => row.body.model)).toEqual(['gemini-3.8-flash-low', 'gemini-3.8-flash-high']);
});

test('CCA EOF, HTTP and unexpected media fail without completion; forced image fails before fetch', async () => {
  await setup();
  const responses = [sse({ candidates: [{ content: { parts: [{ text: 'partial' }] } }] }), new Response('denied', { status: 400 }), sse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] }, finishReason: 'STOP' }] })];
  for (const [i, response] of responses.entries()) {
    const frames: any[] = [];
    await expect(infer(request('failure-' + i), f => frames.push(f), (async () => response) as typeof fetch)).rejects.toThrow();
    expect(frames.some(f => f.type === 'completed')).toBeFalse();
  }
  let fetched = false;
  await expect(infer(request('image', { model: 'gemini-3.1-flash-image' }), () => {}, (async () => { fetched = true; return textResponse(); }) as typeof fetch)).rejects.toThrow('unsupported_output_modality');
  expect(fetched).toBeFalse();
});

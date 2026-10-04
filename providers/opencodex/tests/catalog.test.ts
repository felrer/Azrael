import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, unlinkSync, existsSync, writeFileSync, symlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverOpenRouterCatalog, clearOpenRouterCatalog, CATALOG_FRESH_MS, CATALOG_STALE_MS, readOpenRouterModelReasoning } from '../catalog.ts';

let root = '';
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });
const provider = { adapter: 'openai-chat', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'test-secret', authMode: 'key' };
const row = (id = 'vendor/model') => ({ id, name: 'Remote Model', context_length: 64000, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['tools'] });
const response = (data: any[]) => (async () => Response.json({ data })) as typeof fetch;
const failed = (async () => { throw new Error('unsafe secret url https://secret.invalid'); }) as typeof fetch;
function setup() {
  root = mkdtempSync(join(tmpdir(), 'azrael-catalog-fixture-'));
  process.env.CODEX_HOME = join(root, 'codex');
  process.env.OPENCODEX_HOME = join(process.env.CODEX_HOME, 'azrael', 'providers', 'opencodex');
  mkdirSync(process.env.OPENCODEX_HOME, { recursive: true });
}
test('authoritative metadata, opaque ids, and cache reuse without network', async () => {
  setup();
  const first = await discoverOpenRouterCatalog(provider, { now: 100000, fetch: response([row()]) });
  expect(first.models).toEqual([{ provider_id: 'openrouter', model_id: 'vendor/model', display_name: 'Remote Model', context_window: 64000, reasoning: { supported_efforts: [], mandatory: false } }]);
  const cached = await discoverOpenRouterCatalog(provider, { now: 100001, fetch: failed });
  expect(cached.status.state).toBe('ready');
  expect(cached.status.observed_at).toBe(100000);
  expect(readFileSync(join(process.env.OPENCODEX_HOME!, 'catalog/openrouter.json'), 'utf8')).not.toContain('test-secret');
});
test('refresh bypasses cache and live empty clears stale roster', async () => {
  setup(); await discoverOpenRouterCatalog(provider, { now: 100000, fetch: response([row()]) });
  const empty = await discoverOpenRouterCatalog(provider, { now: 100001, refresh: true, fetch: response([]) });
  expect(empty.status.state).toBe('empty'); expect(empty.models).toEqual([]);
  const after = await discoverOpenRouterCatalog(provider, { now: 100002, refresh: true, fetch: failed });
  expect(after.models).toEqual([]); expect(after.status.state).toBe('stale');
});
test('transient failure uses same identity only and bounds stale age', async () => {
  setup(); await discoverOpenRouterCatalog(provider, { now: 100000, fetch: response([row()]) });
  const stale = await discoverOpenRouterCatalog(provider, { now: 100000 + CATALOG_FRESH_MS, fetch: failed });
  expect(stale.status.state).toBe('stale'); expect(stale.status.error_code).toBe('network'); expect(stale.models).toHaveLength(1);
  const expired = await discoverOpenRouterCatalog(provider, { now: 100001 + CATALOG_STALE_MS, fetch: failed });
  expect(expired.status.state).toBe('error'); expect(expired.models).toEqual([]);
});
test('changed credentials, endpoint, and removed key cannot resurrect another cache', async () => {
  setup(); await discoverOpenRouterCatalog(provider, { now: 100000, fetch: response([row()]) });
  expect((await discoverOpenRouterCatalog({ ...provider, apiKey: 'different' }, { now: 100001, fetch: failed })).models).toEqual([]);
  expect((await discoverOpenRouterCatalog(provider, { now: 100002, fetch: failed })).models).toEqual([]);
  await discoverOpenRouterCatalog(provider, { now: 100003, fetch: response([row()]) });
  expect((await discoverOpenRouterCatalog({ ...provider, baseUrl: 'https://openrouter.ai/custom' }, { now: 100004, fetch: failed })).models).toEqual([]);
  await discoverOpenRouterCatalog(provider, { now: 100005, fetch: response([row()]) });
  clearOpenRouterCatalog(); expect((await discoverOpenRouterCatalog(provider, { now: 100006, fetch: failed })).models).toEqual([]);
});
test('filter text tools and safe ids, never synthesize seed models on failure', async () => {
  setup();
  const result = await discoverOpenRouterCatalog(provider, { now: 100000, fetch: response([row(), { ...row('no-tools'), supported_parameters: [] }, { ...row('image-only'), architecture: { input_modalities: ['image'], output_modalities: ['text'] } }, { ...row('image-output'), architecture: { input_modalities: ['text'], output_modalities: ['image'] } }, row('x'.repeat(257)), row()]) });
  expect(result.models).toHaveLength(1);
  clearOpenRouterCatalog();
  const error = await discoverOpenRouterCatalog({ ...provider, models: ['invented'] }, { now: 100001, fetch: failed });
  expect(error.models).toEqual([]); expect(error.status.state).toBe('error');
  expect(JSON.stringify(error)).not.toContain('secret');
});
test('malformed and oversized model envelopes are sanitized', async () => {
  setup();
  const malformed = await discoverOpenRouterCatalog(provider, { now: 100000, fetch: (async () => Response.json({ nope: true })) as typeof fetch });
  expect(malformed.status.error_code).toBe('invalid_response');
  const oversized = await discoverOpenRouterCatalog(provider, { now: 100001, fetch: response(Array.from({ length: 2001 }, (_, i) => row(String(i)))) });
  expect(oversized.status.error_code).toBe('catalog_limit');
});

test('authorization rejection retires cache while transient HTTP errors retain it', async () => {
  setup();
  for (const code of [401, 403]) {
    await discoverOpenRouterCatalog(provider, { now: 100000, refresh: true, fetch: response([row()]) });
    const denied = await discoverOpenRouterCatalog(provider, { now: 100001, refresh: true, fetch: (async () => new Response('', { status: code })) as typeof fetch });
    expect(denied.models).toEqual([]); expect(denied.status.error_code).toBe('unavailable');
    expect(existsSync(join(process.env.OPENCODEX_HOME!, 'catalog/openrouter.json'))).toBeFalse();
    expect((await discoverOpenRouterCatalog(provider, { now: 100002, fetch: failed })).models).toEqual([]);
  }
  await discoverOpenRouterCatalog(provider, { now: 100003, refresh: true, fetch: response([row()]) });
  const transient = await discoverOpenRouterCatalog(provider, { now: 100004, refresh: true, fetch: (async () => new Response('', { status: 503 })) as typeof fetch });
  expect(transient.status.state).toBe('stale'); expect(transient.models).toHaveLength(1);
});

test('known empty discovery never restores prior callable ids after cache write failure', async () => {
  setup(); await discoverOpenRouterCatalog(provider, { now: 100000, fetch: response([row()]) });
  const path = join(process.env.OPENCODEX_HOME!, 'catalog/openrouter.json');
  const empty = await discoverOpenRouterCatalog(provider, { now: 100001, refresh: true, fetch: (async () => {
    // Occupy the target after the prior cache was read, forcing persistence to fail.
    unlinkSync(path); mkdirSync(path);
    return Response.json({ data: [] });
  }) as typeof fetch });
  expect(empty.models).toEqual([]); expect(empty.status.state).toBe('error'); expect(empty.status.error_code).toBe('storage');
  expect((await discoverOpenRouterCatalog(provider, { now: 100002, fetch: failed })).models).toEqual([]);
});

test('cache invalidation rejects a catalog junction outside provider state', () => {
  setup();
  const outside = join(root, 'outside'); mkdirSync(outside);
  const victim = join(outside, 'openrouter.json'); writeFileSync(victim, 'keep');
  const link = join(process.env.OPENCODEX_HOME!, 'catalog');
  symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  try { expect(() => clearOpenRouterCatalog()).toThrow('storage'); expect(readFileSync(victim, 'utf8')).toBe('keep'); }
  finally { if (process.platform === 'win32') rmdirSync(link); else unlinkSync(link); }
});


test('reasoning cache roundtrip is versioned and lookup never crosses credentials', async () => {
  setup();const now=Date.now();
  const first=await discoverOpenRouterCatalog(provider,{now,fetch:response([{...row('z-ai/glm-5.3'),reasoning:{supported_efforts:['max','high','low'],default_effort:'max',mandatory:true}}])});
  expect(first.models[0]?.reasoning?.supported_efforts).toEqual(['low','high','max']);
  expect(readOpenRouterModelReasoning(provider,'z-ai/glm-5.3',now+1)).toEqual(first.models[0]?.reasoning);
  expect(readOpenRouterModelReasoning({...provider,apiKey:'different'},'z-ai/glm-5.3',now+1)).toBeUndefined();
  const path=join(process.env.OPENCODEX_HOME!,'catalog/openrouter.json');const snapshot=JSON.parse(readFileSync(path,'utf8'));expect(snapshot.version).toBe(2);
  snapshot.version=1;writeFileSync(path,JSON.stringify(snapshot));
  expect(readOpenRouterModelReasoning(provider,'z-ai/glm-5.3',now+1)).toBeUndefined();
  const fresh=await discoverOpenRouterCatalog(provider,{now:now+1,fetch:response([row('z-ai/glm-5.3-flash')])});
  expect(fresh.models[0]?.model_id).toBe('z-ai/glm-5.3-flash');
  expect(fresh.models[0]?.reasoning?.default_effort).toBe('max');
});

test('malformed cached reasoning is retired instead of restoring fabricated choices',async()=>{
 setup();const now=Date.now();await discoverOpenRouterCatalog(provider,{now,fetch:response([row('z-ai/glm-5.3')])});
 const path=join(process.env.OPENCODEX_HOME!,'catalog/openrouter.json'),snapshot=JSON.parse(readFileSync(path,'utf8'));
 snapshot.models[0].reasoning.supported_efforts=['none','max'];writeFileSync(path,JSON.stringify(snapshot));
 expect(readOpenRouterModelReasoning(provider,'z-ai/glm-5.3',now+1)).toBeUndefined();
 const result=await discoverOpenRouterCatalog(provider,{now:now+1,fetch:failed});expect(result.status.state).toBe('error');expect(result.models).toEqual([]);
});

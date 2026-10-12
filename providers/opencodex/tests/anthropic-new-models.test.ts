import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverAnthropicCatalog } from '../catalog.ts';
import { infer, catalog } from '../inference.ts';
import { loadConfig, saveConfig } from '../vendor/src/config.ts';
import { saveCredential } from '../vendor/src/oauth/store.ts';
import { getProviderRegistryEntry } from '../vendor/src/providers/registry.ts';
import { usesAdaptiveThinking } from '../vendor/src/adapters/anthropic.ts';

const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
const models = ['claude-sonnet-5-5', 'claude-haiku-5-5'];
const defaults = ['high', 'medium'];
const previousHome = process.env.CODEX_HOME;
const previousProviderHome = process.env.OPENCODEX_HOME;
let root = '';
afterEach(() => {
  if (root) rmSync(root, { recursive: true });
  root = '';
  if (previousHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousHome;
  if (previousProviderHome === undefined) delete process.env.OPENCODEX_HOME; else process.env.OPENCODEX_HOME = previousProviderHome;
});

function setup() {
  root = mkdtempSync(join(tmpdir(), 'azrael-anthropic-new-models-'));
  process.env.CODEX_HOME = join(root, 'codex');
  process.env.OPENCODEX_HOME = join(process.env.CODEX_HOME, 'azrael', 'providers', 'opencodex');
  mkdirSync(process.env.OPENCODEX_HOME, { recursive: true });
  const provider = { ...getProviderRegistryEntry('anthropic')!, authMode: 'oauth' as const };
  const config = loadConfig();
  config.providers = { anthropic: provider };
  saveConfig(config);
  return provider;
}

test('Sonnet and Haiku 5.5 seed selectable stages and official defaults without network', async () => {
  const provider = setup();
  const result = await discoverAnthropicCatalog(provider, { accountId: 'fixture', identity: ['fixture'] });
  for (const [index, id] of models.entries()) {
    expect(result.models.find(model => model.model_id === id)).toMatchObject({
      context_window: 1_000_000,
      reasoning: { supported_efforts: efforts, default_effort: defaults[index], mandatory: true },
    });
    expect(usesAdaptiveThinking(id)).toBeTrue();
    expect(usesAdaptiveThinking('anthropic/' + id)).toBeTrue();
  }
  expect(usesAdaptiveThinking('claude-haiku-4-5')).toBeFalse();
  expect(usesAdaptiveThinking('claude-haiku-5')).toBeFalse();
  expect(usesAdaptiveThinking('claude-unknown-5-5')).toBeFalse();
});

test('new-model discovery respects API stages, unsupported effort and cached metadata', async () => {
  const provider = setup();
  const options = { accountId: 'fixture', identity: ['fixture'], accessToken: 'fixture-token', now: 1000 };
  const result = await discoverAnthropicCatalog(provider, {
    ...options, refresh: true, fetch: (async () => Response.json({ data: [
      { id: models[0], capabilities: { effort: { supported: true, low: { supported: true }, high: { supported: true } } } },
      { id: models[1], capabilities: { effort: { supported: false } } },
    ], has_more: false })) as typeof fetch,
  });
  expect(result.status.state).toBe('ready');
  expect(result.models[0].reasoning).toEqual({ supported_efforts: ['low', 'high'], default_effort: 'high', mandatory: true });
  expect(result.models[1].reasoning).toEqual({ supported_efforts: [], mandatory: false });
  const cached = await discoverAnthropicCatalog(provider, { ...options, now: 1001,
    fetch: (async () => { throw new Error('LIVE_NETWORK_FORBIDDEN'); }) as typeof fetch });
  expect(cached.models).toEqual(result.models);
});

test('managed inference sends all five new-model stages through the adaptive wire', async () => {
  setup();
  await saveCredential('anthropic', { access: 'fixture-token', refresh: 'fixture-refresh', expires: Date.now() + 3600_000, accountId: 'fixture' });
  const roster = await catalog({ fetch: (async () => { throw new Error('LIVE_NETWORK_FORBIDDEN'); }) as typeof fetch });
  for (const [index, model] of models.entries()) {
    expect(roster.models.find(row => row.provider_id === 'anthropic' && row.model_id === model)?.reasoning?.supported_efforts).toEqual(efforts);
    for (const effort of [...efforts, undefined]) {
      const frames: any[] = [];
      const request = { type: 'request', protocol_version: 1, request_id: model + '-' + effort,
        thread_id: model + '-' + effort, turn_id: 'fixture-turn', provider_id: 'anthropic', model,
        reasoning_effort: effort, instructions: 'Fixture instructions',
        input: [{ type: 'message', role: 'user', content: 'Hello' }], tools: [] };
      await infer(request, frame => frames.push(frame), (async (_url: any, init: any) => {
        const body = JSON.parse(init.body);
        expect(body.model).toBe(model);
        expect(body.thinking).toEqual({ type: 'adaptive' });
        expect(body.output_config.effort).toBe(effort ?? defaults[index]);
        expect(body.thinking.budget_tokens).toBeUndefined();
        const events = [
          { type: 'message_start', message: { id: 'fixture', role: 'assistant', content: [], usage: { input_tokens: 1 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
          { type: 'message_stop' },
        ];
        return new Response(events.map(event => 'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n').join(''),
          { headers: { 'content-type': 'text/event-stream' } });
      }) as typeof fetch);
      expect(frames.at(-1).type).toBe('completed');
    }
  }
}, 180_000);

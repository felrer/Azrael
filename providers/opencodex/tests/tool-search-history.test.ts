import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { infer, projectRequest } from '../inference.ts';
import * as config from '../vendor/src/config.ts';
import * as store from '../vendor/src/oauth/store.ts';
import { createContextDiagnostics } from '../../devin/context-budget.mjs';
import { estimateTokens } from '../vendor/src/lib/token-estimate.ts';

let root = '';
const savedHome = process.env.CODEX_HOME, savedProviderHome = process.env.OPENCODEX_HOME;
afterEach(() => {
  if (root) rmSync(root, { recursive: true });
  root = '';
  for (const [key, value] of [['CODEX_HOME', savedHome], ['OPENCODEX_HOME', savedProviderHome]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
});
const schema = (name: string, description: string) => ({ type: 'function', name, description,
  parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } });
const selected = schema('lookup', 'CURRENT_SCHEMA_' + 'x'.repeat(10000));
const nested = { type: 'namespace', name: 'nested', tools: [schema('helper', 'NESTED_SCHEMA_' + 'y'.repeat(10000))] };
const search = { type: 'tool_search', execution: 'client', parameters: { type: 'object' } };
const discovered = { type: 'namespace', name: 'mcp__fixture', tools: [selected] };

test('Claude resolved profile prepares the same compact search wire used for generation', async () => {
  root = mkdtempSync(join(tmpdir(), 'azrael-claude-search-wire-'));
  process.env.CODEX_HOME = join(root, 'codex');
  process.env.OPENCODEX_HOME = join(root, 'codex', 'azrael', 'providers', 'opencodex');
  mkdirSync(process.env.OPENCODEX_HOME, { recursive: true });
  const cfg = config.loadConfig();
  cfg.providers = { anthropic: { adapter: 'anthropic', baseUrl: 'https://api.anthropic.com', authMode: 'oauth', models: ['claude-sonnet-4-6'] } };
  config.saveConfig(cfg);
  await store.saveCredential('anthropic', { access: 'fixture-access', refresh: 'fixture-refresh', expires: Number.MAX_SAFE_INTEGER, accountId: 'fixture' });
  const definitions = { type: 'namespace', name: 'mcp__fixture', tools: Array.from({ length: 11 }, (_, i) => schema('lookup' + i, 'CURRENT_SCHEMA_' + i + '_' + 'x'.repeat(1000))) };
  const native: any = { ...request('anthropic'), instructions: 'Azrael policy',
    harness_profile: { id: 'custom/team', fingerprint: 'resolved-fixture', tool_profile: 'builtin/claude-code-core', prompt_profile: 'builtin/claude-lean' },
    tools: [{ type: 'namespace', name: 'functions', tools: [schema('ToolSearch', 'Search live tools')] }, definitions],
    input: Array.from({ length: 10 }, (_, i) => [
      { type: 'function_call', namespace: 'functions', name: 'ToolSearch', call_id: 'search' + i, arguments: '{"query":"lookup"}' },
      { type: 'tool_search_output', execution: 'client', call_id: 'search' + i, status: 'completed', tools: [definitions, definitions, nested] },
    ]).flat(),
  };
  const ordinaryOutput = projectRequest(native, 'fixture', 'anthropic-xml', 'anthropic').compiled.messages.find((message: any) => message.role === 'tool').content;
  native.input.push(
    { type: 'function_call', namespace: 'mcp__fixture', name: 'lookup0', call_id: 'ordinary', arguments: '{}' },
    { type: 'function_call_output', call_id: 'ordinary', output: ordinaryOutput },
  );
  const original = JSON.stringify(native), prepared: any[] = [];
  await infer(native, frame => prepared.push(frame), (async () => { throw new Error('GENERATION_FORBIDDEN'); }) as typeof fetch, undefined, { prepareOnly: true });
  let captured = 0;
  await infer(native, () => {}, (async (_url: any, init: any) => {
    captured++;
    const body = JSON.parse(init.body), text = JSON.stringify(body);
    expect(body.tools).toHaveLength(12);
    expect(body.tools[0].name).toBe('ToolSearch');
    expect(text.split('CURRENT_SCHEMA_').length - 1).toBe(11);
    expect(text).not.toContain('NESTED_SCHEMA_');
    const calls = body.messages.flatMap((message: any) => message.content.filter((part: any) => part.type === 'tool_use'));
    const results = body.messages.flatMap((message: any) => message.content.filter((part: any) => part.type === 'tool_result'));
    expect(calls).toHaveLength(11); expect(results).toHaveLength(11);
    for (let i = 0; i < 10; i++) {
      expect(calls[i]).toMatchObject({ id: 'search' + i, name: 'ToolSearch', input: { query: 'lookup' } });
      expect(results[i].tool_use_id).toBe(calls[i].id);
      const result = JSON.parse(results[i].content);
      expect(result.tools.map((tool: any) => tool.name)).toEqual(body.tools.slice(1).map((tool: any) => tool.name));
    }
    expect(results[10].tool_use_id).toBe('ordinary');
    expect(results[10].content).toBe(ordinaryOutput);
    const context = createContextDiagnostics(native.model, estimateTokens, 'model_chars');
    context.wire(init.body);
    expect(prepared[0].input_budget.input_tokens).toBe(context.budget().input_tokens);
    expect(prepared[0].input_budget.diagnostics.components).toEqual(context.snapshot().components);
    const events = [
      { type: 'message_start', message: { id: 'fixture', role: 'assistant', content: [], usage: { input_tokens: 2 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'done' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }, { type: 'message_stop' },
    ];
    return new Response(events.map(event => 'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch);
  expect(captured).toBe(1);
  expect(JSON.stringify(native)).toBe(original);
});
function request(provider_id: string) {
  return { protocol_version: 1, type: 'request', request_id: 'fixture', thread_id: 'thread', turn_id: 'turn',
    provider_id, model: provider_id === 'anthropic' ? 'claude-sonnet-4-6' : 'gemini-3.8-flash', instructions: '', parallel_tool_calls: true,
    tools: [search, discovered], input: [...Array.from({ length: 10 }, (_, i) => [
      { type: 'tool_search_call', execution: 'client', call_id: 's' + i, arguments: { query: 'lookup' } },
      { type: 'tool_search_output', execution: 'client', call_id: 's' + i, status: 'completed', tools: [discovered, nested] },
    ]).flat(), { type: 'message', role: 'user', content: 'Use lookup.' }] };
}

test('all managed providers project retained search history without mutating input or granting tools', () => {
  for (const provider of ['anthropic', 'google', 'google-antigravity', 'xai', 'openrouter']) {
    const native = request(provider), original = JSON.stringify(native);
    const { compiled, parsed } = projectRequest(native, 'fixture');
    const text = JSON.stringify(parsed.context.messages);
    expect(text).not.toContain('CURRENT_SCHEMA_');
    expect(text.split('NESTED_SCHEMA_').length - 1).toBe(1);
    expect(Buffer.byteLength(text)).toBeLessThan(20000);
    expect(compiled.tools.length).toBe(2);
    expect(JSON.stringify(native)).toBe(original);
  }
});

test('all managed provider contexts bound distinct historical schemas and namespace metadata', () => {
  for (const provider of ['anthropic', 'google', 'google-antigravity', 'xai', 'openrouter']) {
    const native: any = request(provider);
    native.input = Array.from({ length: 20 }, (_, i) => [
      { type: 'tool_search_call', execution: 'client', call_id: 's' + i, arguments: { query: 'helper' } },
      { type: 'tool_search_output', execution: 'client', call_id: 's' + i, status: 'completed', tools: [
        { ...discovered, description: 'NAMESPACE_METADATA_' + 'n'.repeat(50000), owner: 'fixture' },
        schema('helper' + i, 'HELPER_SCHEMA_' + i + '_' + 'x'.repeat(1000)),
      ] },
    ]).flat();
    const original = JSON.stringify(native), { compiled, parsed } = projectRequest(native, 'fixture');
    const text = JSON.stringify(parsed.context.messages);
    expect(text.split('HELPER_SCHEMA_').length - 1).toBe(8);
    expect(text.split('NAMESPACE_METADATA_').length - 1).toBe(1);
    expect(Buffer.byteLength(text)).toBeLessThan(75000);
    expect(text).toContain('schema_unavailable_search_again');
    expect(text).toContain('s0'); expect(text).toContain('s19');
    expect(compiled.tools.length).toBe(2);
    expect(JSON.stringify(native)).toBe(original);
  }
});

for (const provider of ['anthropic', 'google-antigravity']) {
  test(`${provider} HTTP request deduplicates schemas and restores the discovered call`, async () => {
    root = mkdtempSync(join(tmpdir(), 'azrael-search-history-'));
    process.env.CODEX_HOME = join(root, 'codex');
    process.env.OPENCODEX_HOME = join(root, 'codex', 'azrael', 'providers', 'opencodex');
    mkdirSync(process.env.OPENCODEX_HOME, { recursive: true });
    const cfg = config.loadConfig();
    cfg.providers = { [provider]: provider === 'anthropic'
      ? { adapter: 'anthropic', baseUrl: 'https://api.anthropic.com', authMode: 'oauth', models: ['claude-sonnet-4-6'] }
      : { adapter: 'google', baseUrl: 'https://daily-cloudcode-pa.googleapis.com', authMode: 'oauth', googleMode: 'cloud-code-assist' } };
    config.saveConfig(cfg);
    await store.saveCredential(provider, { access: 'fixture-access', refresh: 'fixture-refresh', expires: Number.MAX_SAFE_INTEGER, accountId: 'fixture', projectId: 'fixture-project' });
    const native = request(provider), original = JSON.stringify(native), frames: any[] = [];
    let captured = 0;
    await infer(native, frame => frames.push(frame), (async (_url: any, init: any) => {
      captured++;
      const body = JSON.parse(init.body), text = JSON.stringify(body);
      expect(text.split('CURRENT_SCHEMA_').length - 1).toBe(1);
      expect(text.split('NESTED_SCHEMA_').length - 1).toBe(1);
      expect(Buffer.byteLength(text)).toBeLessThan(40000);
      expect(text).toContain('latest_search_result');
      expect(text).toContain('s0'); expect(text).toContain('s9');
      if (provider === 'anthropic') {
        const name = body.tools.find((tool: any) => tool.description.includes('CURRENT_SCHEMA_')).name;
        const events = [
          { type: 'message_start', message: { id: 'fixture-message', role: 'assistant', content: [], usage: { input_tokens: 2 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'lookup-call', name, input: {} } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"key":"42"}' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } }, { type: 'message_stop' },
        ];
        return new Response(events.map(e => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
      }
      const name = body.request.tools.flatMap((tool: any) => tool.functionDeclarations ?? []).find((tool: any) => tool.description.includes('CURRENT_SCHEMA_')).name;
      return new Response('data: ' + JSON.stringify({ response: { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args: { key: '42' } } }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 } } }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch);
    expect(captured).toBe(1);
    expect(frames.find(frame => frame.type === 'item_done' && frame.item.type === 'function_call').item)
      .toMatchObject({ namespace: 'mcp__fixture', name: 'lookup', arguments: '{"key":"42"}' });
    expect(frames.at(-1).type).toBe('completed');
    expect(JSON.stringify(native)).toBe(original);
  });
}

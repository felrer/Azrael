import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { infer, catalog } from '../providers/opencodex/inference.ts';
import { handleRequest } from '../providers/opencodex/helper.ts';
import { loadConfig, saveConfig } from '../providers/opencodex/vendor/src/config.ts';
import { getAccountSet, replaceProviderAccountSet, saveCredential } from '../providers/opencodex/vendor/src/oauth/store.ts';

test('managed Claude uses pinned OAuth, native prompt and tool frames', async () => {
  const root = mkdtempSync(join(tmpdir(), 'azrael-claude-fixture-'));
  try {
    process.env.CODEX_HOME = join(root, 'codex');
    process.env.OPENCODEX_HOME = join(process.env.CODEX_HOME, 'azrael', 'providers', 'opencodex');
    process.env.AZRAEL_PROVIDER_INFERENCE_HELPER = join(import.meta.dir, '../providers/opencodex/inference.ts');
    process.env.AZRAEL_PROVIDER_BUN = process.execPath;
    mkdirSync(process.env.OPENCODEX_HOME, { recursive: true });
    const config = loadConfig();
    config.providers.anthropic = { adapter: 'anthropic', baseUrl: 'https://api.anthropic.com', authMode: 'oauth', models: ['claude-sonnet-4-6'] };
    saveConfig(config);
    await saveCredential('anthropic', { access: 'fixture-oauth-access', refresh: 'fixture-oauth-refresh', expires: Date.now() + 3600_000, accountId: 'fixture-person' });
    const discovered = await catalog();
    expect(discovered.models.some((model: any) => model.provider_id === 'anthropic' && model.model_id === 'claude-sonnet-4-6')).toBeTrue();
    const accountState = async () => (await handleRequest({ protocol: 1, id: 'account-fixture', action: 'list' }, { send() {}, async answer() { return null; } }) as any).providers.find((provider: any) => provider.id === 'anthropic');
    expect((await accountState()).inferenceConnected).toBeTrue();
    const request = { type: 'request', protocol_version: 1, request_id: 'claude-fixture', thread_id: 'claude-thread', turn_id: 'claude-turn', provider_id: 'anthropic', model: 'claude-sonnet-4-6', instructions: 'Azrael base prompt fixture', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Use the fixture tool' }] }], tools: [{ type: 'function', name: 'fixture_tool', description: 'fixture', parameters: { type: 'object', properties: { value: { type: 'string' } } } }], parallel_tool_calls: true };
    const frames: any[] = [];
    const fetcher = (async (url: any, init: any) => {
      expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
      expect(init.headers.Authorization).toBe('Bearer fixture-oauth-access');
      expect(init.headers['x-api-key']).toBeUndefined();
      const body = JSON.parse(init.body);
      expect(body.system.some((part: any) => part.text.includes(request.instructions))).toBeTrue();
      expect(body.tools).toHaveLength(1);
      const tool = body.tools[0].name;
      const events = [
        { type: 'message_start', message: { usage: { input_tokens: 2 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Calling tool' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_fixture', name: tool, input: {} } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"value":"ok"}' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } },
        { type: 'message_stop' },
      ];
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;
    await infer(request, frame => frames.push(frame), fetcher);
    expect(frames.some(frame => frame.type === 'text_delta' && frame.delta === 'Calling tool')).toBeTrue();
    expect(frames.filter(frame => frame.type === 'item_done' && frame.item?.type === 'function_call')).toHaveLength(1);
    expect(frames.at(-1).type).toBe('completed');
    const pin = getAccountSet('anthropic')!;
    await replaceProviderAccountSet('anthropic', { ...pin, accounts: pin.accounts.map(account => ({ ...account, credential: { ...account.credential, access: 'rotated-access', refresh: 'rotated-refresh' } })) });
    const completedItems = frames.filter(frame => frame.type === 'item_done').map(frame => frame.item);
    const call = completedItems.find(item => item.type === 'function_call');
    const continuation = { ...request, input: [...request.input, ...completedItems, { type: 'function_call_output', call_id: call.call_id, output: 'fixture tool result' }] };
    const nextFrames: any[] = [];
    await infer(continuation, frame => nextFrames.push(frame), (async (_url: any, init: any) => {
      expect(init.headers.Authorization).toBe('Bearer rotated-access');
      const body = JSON.parse(init.body);
      const blocks = body.messages.flatMap((message: any) => typeof message.content === 'string' ? [] : message.content);
      expect(blocks.filter((block: any) => block.type === 'tool_use' && block.id === call.call_id)).toHaveLength(1);
      expect(blocks.filter((block: any) => block.type === 'tool_result' && block.tool_use_id === call.call_id)).toHaveLength(1);
      const events = [
        { type: 'message_start', message: { usage: { input_tokens: 4 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Tool result accepted' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
        { type: 'message_stop' },
      ];
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch);
    expect(nextFrames.filter(frame => frame.type === 'item_done' && frame.item?.type === 'function_call')).toHaveLength(0);
    expect(nextFrames.at(-1).type).toBe('completed');
    const changed = getAccountSet('anthropic')!;
    await replaceProviderAccountSet('anthropic', { ...changed, accounts: changed.accounts.map(account => ({ ...account, credential: { ...account.credential, accountId: 'different-person', access: 'other-access' } })) });
    await expect(infer({ ...request, turn_id: 'changed-identity-turn' }, () => {}, fetcher)).rejects.toThrow('pinned_account_changed');
    await replaceProviderAccountSet('anthropic', { ...changed, accounts: changed.accounts.map(account => ({ ...account, credential: { ...account.credential, accountId: undefined, email: undefined } })) });
    await expect(infer({ ...request, turn_id: 'missing-identity-turn' }, () => {}, fetcher)).rejects.toThrow('pinned_account_unavailable');
    expect((await catalog()).models.some((model: any) => model.provider_id === 'anthropic')).toBeFalse();
    expect((await accountState()).inferenceConnected).toBeFalse();
    await replaceProviderAccountSet('anthropic', changed);
    const rejectedFrames: any[] = [];
    await expect(infer({ ...request, turn_id: 'unauthorized-turn' }, frame => rejectedFrames.push(frame), (async () => new Response('unauthorized', { status: 401 })) as typeof fetch)).rejects.toThrow('provider_http_401');
    expect(rejectedFrames.some(frame => frame.type === 'completed' || frame.item?.type === 'function_call')).toBeFalse();
    await expect(infer({ ...request, turn_id: 'quota-turn' }, () => {}, (async () => new Response(JSON.stringify({ error: { code: 'insufficient_quota' } }), { status: 429 })) as typeof fetch)).rejects.toThrow('provider_usage_limit');
    await expect(infer({ ...request, turn_id: 'rate-turn' }, () => {}, (async () => new Response(JSON.stringify({ error: { code: 'RESOURCE_EXHAUSTED' } }), { status: 429 })) as typeof fetch)).rejects.toThrow('provider_rate_limit');
    const oversizedFrames: any[] = [];
    const oversizedData = Array.from({ length: 129 }, () => `data: ${'x'.repeat(65_536)}\n`).join('') + '\n';
    await expect(infer({ ...request, turn_id: 'oversized-stream-turn' }, frame => oversizedFrames.push(frame), (async () => new Response(oversizedData, { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch)).rejects.toThrow('output_limit');
    expect(oversizedFrames.some(frame => frame.type === 'completed' || frame.item?.type === 'function_call')).toBeFalse();
    const rejected = loadConfig();
    rejected.providers.xai = { adapter: 'openai-chat', baseUrl: 'https://api.x.ai', authMode: 'key', apiKey: 'fixture-only-key', models: ['grok-4'] };
    saveConfig(rejected);
    expect((await catalog()).models.some((model: any) => model.provider_id === 'xai')).toBeFalse();
    await expect(infer({ ...request, provider_id: 'xai', model: 'grok-4', turn_id: 'key-transport-turn' }, () => {}, fetcher)).rejects.toThrow('invalid_selection');
    rejected.providers.anthropic.authMode = 'key';
    saveConfig(rejected);
    await expect(infer({ ...request, turn_id: 'rejected-turn' }, () => {}, fetcher)).rejects.toThrow('provider_unavailable');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);

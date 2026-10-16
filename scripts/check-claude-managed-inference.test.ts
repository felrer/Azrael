import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { infer, catalog } from '../providers/opencodex/inference.ts';
import { handleRequest } from '../providers/opencodex/helper.ts';
import { loadConfig, saveConfig } from '../providers/opencodex/vendor/src/config.ts';
import { getAccountSet, replaceProviderAccountSet, saveCredential } from '../providers/opencodex/vendor/src/oauth/store.ts';
import { CLAUDE_CODE_SYSTEM_INSTRUCTION } from '../providers/opencodex/vendor/src/oauth/anthropic.ts';

const fixtureParentPath = () => resolve(process.env.AZRAEL_CLAUDE_TEST_ROOT || join(tmpdir(), 'azrael-claude-fixtures'));

test('managed Claude uses pinned OAuth, native prompt and tool frames', async () => {
  const fixtureParent = fixtureParentPath();
  mkdirSync(fixtureParent, { recursive: true });
  const root = mkdtempSync(join(fixtureParent, 'unprofiled-'));
  const envKeys = ['CODEX_HOME', 'OPENCODEX_HOME', 'AZRAEL_PROVIDER_INFERENCE_HELPER', 'AZRAEL_PROVIDER_BUN'] as const;
  const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('LIVE_NETWORK_FORBIDDEN'); }) as typeof fetch;
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
    const request = { type: 'request', protocol_version: 1, request_id: 'claude-fixture', thread_id: 'claude-thread', turn_id: 'claude-turn', provider_id: 'anthropic', model: 'claude-sonnet-4-6', instructions: 'Azrael base prompt fixture', input: [{ type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<multi_agent_role>Use V2 tools.</multi_agent_role>' }] }, { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Use the fixture tool' }] }], tools: [{ type: 'function', name: 'fixture_tool', description: 'fixture', parameters: { type: 'object', properties: { value: { type: 'string' } } } }], parallel_tool_calls: true };
    const frames: any[] = [];
    const fetcher = (async (url: any, init: any) => {
      expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
      expect(init.headers.Authorization).toBe('Bearer fixture-oauth-access');
      expect(init.headers['x-api-key']).toBeUndefined();
      const body = JSON.parse(init.body);
      expect(body.system[0].text).toBe(CLAUDE_CODE_SYSTEM_INSTRUCTION);
      expect(body.system.some((part: any) => part.text.includes(`<common_instructions>\n<![CDATA[${request.instructions}]]>\n</common_instructions>`))).toBeTrue();
      expect(body.system.some((part: any) => part.text.includes('<runtime_instructions>'))).toBeTrue();
      expect(body.system.some((part: any) => part.text.includes('<multi_agent_role>Use V2 tools.</multi_agent_role>'))).toBeTrue();
      expect(body.messages[0]).toEqual({ role: 'user', content: '<current_task>\n<![CDATA[Use the fixture tool]]>\n</current_task>' });
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
      expect(blocks.find((block: any) => block.type === 'tool_result').content).toBe('<tool_result>\n<![CDATA[fixture tool result]]>\n</tool_result>');
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
    await expect(infer({ ...request, turn_id: 'rate-turn' }, () => {}, (async () => new Response(JSON.stringify({ error: { code: 'RESOURCE_EXHAUSTED' } }), { status: 429 })) as typeof fetch)).rejects.toThrow('provider_error_undefined');
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
    globalThis.fetch = previousFetch;
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    const contained = relative(fixtureParent, resolve(root));
    if (!contained || contained.startsWith('..') || isAbsolute(contained)) throw new Error('fixture_cleanup_outside_owner');
    rmSync(root, { recursive: true });
  }
}, 15_000);

test('compatible Claude preserves OAuth system prefix, native policy and cached tool replay', async () => {
  const fixtureParent = fixtureParentPath();
  mkdirSync(fixtureParent, { recursive: true });
  const fixtureRoot = mkdtempSync(join(fixtureParent, 'profile-'));
  const envKeys = ['CODEX_HOME', 'OPENCODEX_HOME'] as const;
  const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('LIVE_NETWORK_FORBIDDEN'); }) as typeof fetch;
  try {
    process.env.CODEX_HOME = join(fixtureRoot, 'codex');
    process.env.OPENCODEX_HOME = join(process.env.CODEX_HOME, 'azrael', 'providers', 'opencodex');
    mkdirSync(process.env.OPENCODEX_HOME, { recursive: true });
    const config = loadConfig();
    config.providers = { anthropic: { adapter: 'anthropic', baseUrl: 'https://api.anthropic.com', authMode: 'oauth', models: ['claude-sonnet-4-6'] } };
    saveConfig(config);
    await saveCredential('anthropic', { access: 'profile-fixture-access', refresh: 'profile-fixture-refresh', expires: Date.now() + 3600_000, accountId: 'profile-fixture-person' });
    // Identity-looking native policy must survive the adapter's model-identity rewrite.
    const nativeBlocks = ['You are Azrael, a custom assistant.\nKeep this identity verbatim.', 'Native system policy.\nPreserve ordering.', '<multi_agent_role>Native developer policy.</multi_agent_role>'];
    const fn = (name: string) => ({ type: 'function', name, description: `Native ${name}`, parameters: { type: 'object', properties: { value: { type: 'string' } } } });
    const request = {
      type: 'request', protocol_version: 1, request_id: 'profile-wire', thread_id: 'profile-wire-thread', turn_id: 'profile-wire-turn',
      provider_id: 'anthropic', model: 'claude-sonnet-4-6', instructions: nativeBlocks[0],
      harness_profile: { id: 'anthropic', fingerprint: 'profile-wire-v1', tool_profile: 'builtin/claude-code-core', prompt_profile: 'builtin/anthropic-default' },
      input: [
        { type: 'message', role: 'system', content: [{ type: 'input_text', text: nativeBlocks[1] }] },
        { type: 'message', role: 'developer', content: [{ type: 'input_text', text: nativeBlocks[2] }] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Earlier request' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Earlier answer' }] },
        { type: 'function_call', namespace: 'functions', name: 'ToolSearch', call_id: 'profile-search', arguments: '{"query":"lookup"}' },
        { type: 'tool_search_output', execution: 'client', call_id: 'profile-search', status: 'completed', tools: [{ type: 'namespace', name: 'mcp__fixture', tools: [fn('lookup')] }] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Call Read' }] },
      ],
      tools: [{ type: 'namespace', name: 'functions', tools: ['Read', 'Bash', 'ToolSearch'].map(fn) }, { type: 'namespace', name: 'mcp__fixture', tools: [fn('lookup')] }],
      parallel_tool_calls: true,
    };
    const stream = (events: any[]) => new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
    const finish = (stop_reason: string) => [{ type: 'message_delta', delta: { stop_reason }, usage: { output_tokens: 3 } }, { type: 'message_stop' }];
    const captured: any[] = [];
    const assertWire = (init: any) => {
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer profile-fixture-access');
      const body = JSON.parse(init.body);
      captured.push(body);
      expect(body.system).toEqual([
        { type: 'text', text: CLAUDE_CODE_SYSTEM_INSTRUCTION },
        ...nativeBlocks.map((text, index) => ({ type: 'text', text, ...(index === nativeBlocks.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}) })),
      ]);
      // Exact system equality also rejects vendor catalog/escaping instructions.
      expect(body.tools.slice(0, 3).map((tool: any) => tool.name)).toEqual(['Read', 'Bash', 'ToolSearch']);
      expect(body.tools[3].name).toMatch(/^custom_az_[a-f0-9]{40}$/);
      expect(body.tools.at(-1).cache_control).toEqual({ type: 'ephemeral' });
      expect(body.cache_control).toEqual({ type: 'ephemeral' });
      const blocks = [...body.tools, ...body.system, ...body.messages.flatMap((message: any) => Array.isArray(message.content) ? message.content : [])];
      expect(blocks.filter((block: any) => block.cache_control)).toHaveLength(3);
      const userMessages = body.messages.filter((message: any) => message.role === 'user');
      const cachedMessage = userMessages.at(-2);
      expect(Array.isArray(cachedMessage.content)).toBeTrue();
      expect(cachedMessage.content.filter((block: any) => block.cache_control).map((block: any) => block.cache_control)).toEqual([{ type: 'ephemeral' }]);
      const searchResult = blocks.find((block: any) => block.type === 'tool_result' && block.tool_use_id === 'profile-search');
      expect(JSON.parse(searchResult.content)).toEqual({ status: 'completed', tools: [{ name: body.tools[3].name }], guidance: 'Call only names in the current tools catalog. Search again for other tools.' });
      return body;
    };
    const frames: any[] = [];
    await infer(request, frame => frames.push(frame), (async (_url: any, init: any) => {
      assertWire(init);
      return stream([
        { type: 'message_start', message: { usage: { input_tokens: 2 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_profile_read', name: 'Read', input: {} } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"value":"fixture"}' } },
        { type: 'content_block_stop', index: 0 }, ...finish('tool_use'),
      ]);
    }) as typeof fetch);
    const completed = frames.filter(frame => frame.type === 'item_done').map(frame => frame.item);
    const calls = completed.filter(item => item.type === 'function_call');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ namespace: 'functions', name: 'Read', call_id: 'toolu_profile_read', arguments: '{"value":"fixture"}' });
    expect(frames.at(-1).type).toBe('completed');
    const nextFrames: any[] = [];
    await infer({ ...request, input: [...request.input, ...completed, { type: 'function_call_output', call_id: calls[0].call_id, output: 'Native result verbatim' }] }, frame => nextFrames.push(frame), (async (_url: any, init: any) => {
      const body = assertWire(init);
      const blocks = body.messages.flatMap((message: any) => Array.isArray(message.content) ? message.content : []);
      expect(blocks.filter((block: any) => block.type === 'tool_use' && block.id === calls[0].call_id)).toEqual([{ type: 'tool_use', id: calls[0].call_id, name: 'Read', input: { value: 'fixture' } }]);
      expect(blocks.filter((block: any) => block.type === 'tool_result' && block.tool_use_id === calls[0].call_id)).toEqual([{ type: 'tool_result', tool_use_id: calls[0].call_id, content: 'Native result verbatim' }]);
      return stream([
        { type: 'message_start', message: { usage: { input_tokens: 4 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Read result accepted' } },
        { type: 'content_block_stop', index: 0 }, ...finish('end_turn'),
      ]);
    }) as typeof fetch);
    expect(captured).toHaveLength(2);
    expect(nextFrames.some(frame => frame.type === 'text_delta' && frame.delta === 'Read result accepted')).toBeTrue();
    expect(nextFrames.some(frame => frame.item?.type === 'function_call')).toBeFalse();
    expect(nextFrames.at(-1).type).toBe('completed');
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    const contained = relative(fixtureParent, resolve(fixtureRoot));
    if (!contained || contained.startsWith('..') || isAbsolute(contained)) throw new Error('fixture_cleanup_outside_owner');
    rmSync(fixtureRoot, { recursive: true });
  }
}, 15_000);

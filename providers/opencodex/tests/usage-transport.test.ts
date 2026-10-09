import { expect, test } from 'bun:test';
import { observeAnthropic, translate } from '../inference.ts';
import { compileRequest, mapStream } from '../inference-mapping.mjs';
import { createAnthropicAdapter } from '../vendor/src/adapters/anthropic.ts';
import { createTranslatorBudget } from '../vendor/src/lib/translator-budget.ts';

const request = { protocol_version: 1, type: 'request', request_id: 'usage-fixture',
  model: 'claude-sonnet-4-6', input: [], tools: [] };
const adapter = createAnthropicAdapter({ adapter: 'anthropic', authMode: 'oauth',
  baseUrl: 'https://api.anthropic.com', models: ['claude-sonnet-4-6'] });
const sse = (frames: any[]) => new Response(frames.map(frame =>
  `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join(''),
  { headers: { 'content-type': 'text/event-stream' } });
async function collect(events: AsyncIterable<any>) {
  const frames: any[] = [];
  await mapStream(events, compileRequest(request), (frame: any) => frames.push(frame), request.request_id);
  return frames.at(-1);
}
async function* events(...values: any[]) { yield* values; }
async function streamed(startUsage: any, deltaUsages: any[]) {
  const opaque = { terminal: false };
  const response = observeAnthropic(sse([
    { type: 'message_start', message: { id: 'fixture', role: 'assistant', content: [], usage: startUsage } },
    ...deltaUsages.map(usage => ({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage })),
    { type: 'message_stop' },
  ]), opaque);
  return collect(translate(adapter.parseStream(response, createTranslatorBudget()), opaque));
}

test('actual Anthropic SSE preserves cumulative mixed TTL writes and inclusive input', async () => {
  expect(await streamed({ input_tokens: 10, cache_read_input_tokens: 20,
    cache_creation_input_tokens: 30, cache_creation: { ephemeral_1h_input_tokens: 12, ephemeral_5m_input_tokens: 18 } },
    [{ output_tokens: 2 }, { output_tokens: 7, cache_creation_input_tokens: 40,
      cache_creation: { ephemeral_1h_input_tokens: 22 } }])).toEqual({ type: 'completed', usage: {
      input_tokens: 70, output_tokens: 7, cached_input_tokens: 20, cache_write_input_tokens: 40,
      cache_write_1h_input_tokens: 22, reasoning_output_tokens: 0, total_tokens: 77, estimated: false,
    } });
});

test('absent or partial Anthropic TTL split remains unknown and old no-cache stream works', async () => {
  for (const cache_creation of [undefined, { ephemeral_1h_input_tokens: 5 }, { ephemeral_5m_input_tokens: 5 }]) {
    const result = await streamed({ input_tokens: 10, cache_creation_input_tokens: 5, cache_creation }, [{ output_tokens: 2 }]);
    expect(result.usage.cache_write_input_tokens).toBe(5);
    expect(result.usage.cache_write_1h_input_tokens).toBeUndefined();
  }
  const old = await streamed({ input_tokens: 2 }, [{ output_tokens: 3 }]);
  expect(old.usage).toMatchObject({ input_tokens: 2, output_tokens: 3, cache_write_input_tokens: 0, estimated: false });
});

test('invalid Anthropic billing splits complete with unknown TTL and estimated usage', async () => {
  const mismatch = await streamed({ input_tokens: 10, cache_creation_input_tokens: 5,
    cache_creation: { ephemeral_1h_input_tokens: 3, ephemeral_5m_input_tokens: 3 } }, [{ output_tokens: 2 }]);
  expect(mismatch.usage.estimated).toBeTrue();
  expect(mismatch.usage.cache_write_1h_input_tokens).toBeUndefined();
  for (const count of [-1, 1.5, '2']) {
    const result = await streamed({ input_tokens: 10, cache_creation_input_tokens: 5,
      cache_creation: { ephemeral_1h_input_tokens: count, ephemeral_5m_input_tokens: 3 } }, [{ output_tokens: 2 }]);
    expect(result.usage.estimated).toBeTrue();
    expect(result.usage.cache_write_1h_input_tokens).toBeUndefined();
  }
});

test('translated usage keeps cache read/write, reasoning and estimate without arbitrary metadata', async () => {
  const result = await collect(translate(events({ type: 'done', usage: {
    inputTokens: 10, outputTokens: 4, cachedInputTokens: 99, cacheReadInputTokens: 3,
    cacheCreationInputTokens: 2, reasoningOutputTokens: 1, usageEstimated: true,
    secret: 'not forwarded',
  } }), { terminal: true }));
  expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 4, cached_input_tokens: 3,
    cache_write_input_tokens: 2, reasoning_output_tokens: 1, total_tokens: 14, estimated: true });
});

test('invalid billing dimensions complete as estimated, while malformed original counts still fail', async () => {
  for (const extra of [{ cacheCreationInputTokens: -1 }, { cachedInputTokens: 7, cacheCreationInputTokens: 4 },
    { cacheCreationInputTokens: 2, cacheWrite1hInputTokens: 3 }, { reasoningTokens: 5 },
    { usageEstimated: 'yes' }, { cacheCreationInputTokens: Number.MAX_SAFE_INTEGER + 1 }]) {
    const result = await collect(events({ kind: 'usage', promptTokens: 10, completionTokens: 4, ...extra },
      { kind: 'finish', reason: 'stop' }));
    expect(result.type).toBe('completed');
    expect(result.usage.estimated).toBeTrue();
    expect(Number.isSafeInteger(result.usage.cache_write_input_tokens)).toBeTrue();
    expect(result.usage.cache_write_input_tokens).toBeGreaterThanOrEqual(0);
  }
  for (const extra of [{ cachedInputTokens: -1 }, { reasoningTokens: -1 }, { promptTokens: -1 },
    { promptTokens: Number.MAX_SAFE_INTEGER, completionTokens: 1 }]) {
    await expect(collect(events({ kind: 'usage', promptTokens: 10, completionTokens: 4, ...extra },
      { kind: 'finish', reason: 'stop' }))).rejects.toThrow('invalid_usage');
  }
  expect(await collect(events({ kind: 'finish', reason: 'stop' }))).toEqual({ type: 'completed', usage: undefined });
});

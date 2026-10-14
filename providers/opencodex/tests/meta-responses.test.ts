import { expect, test } from 'bun:test';
import { metaResponsesBody, parseMetaResponses } from '../meta-responses.ts';
import { MAX_BYTES } from '../inference-mapping.mjs';
import { createTranslatorBudget } from '../vendor/src/lib/translator-budget.ts';
import type { AdapterEvent } from '../vendor/src/types.ts';

const call = (id = 'c1', name = 'az_' + 'a'.repeat(40), args = '{"input":"ok"}') => ({ type: 'function_call', id: 'item_' + id, call_id: id, name, arguments: args });
const message = (value = 'hello') => ({ type: 'message', id: 'msg', role: 'assistant', content: [{ type: 'output_text', text: value }] });
const completed = (output: any[], usage?: any) => ({ type: 'response.completed', response: { status: 'completed', output, ...(usage ? { usage } : {}) } });
const sse = (frames: any[]) => new Response(frames.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
async function collect(frames: any[], options?: any) {
  const opaque = { details: [] as any[], terminal: false }, events: AdapterEvent[] = [];
  const budget = createTranslatorBudget();
  try {
    for await (const e of parseMetaResponses(sse(frames), budget, opaque, options)) events.push(e);
    return { opaque, events };
  } finally { budget.dispose(); }
}
test('body preserves images, custom wrappers, tool search, history and bounded names', () => {
  const c = call(); const tools = [c.name, 'az_' + 'b'.repeat(40)].map(name => ({ name, description: 'tool', parameters: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] } }));
  const compiled = { model: 'meta-model', parallel: true, tools, messages: [{ role: 'system', content: 'rules' }, { role: 'developer', content: 'developer' }, { role: 'user', content: [{ type: 'input_text', text: 'hi' }, { type: 'input_image', image_url: 'data:image/png;base64,AA==' }] }, { role: 'assistant', content: 'checking', tool_calls: [{ id: c.call_id, name: c.name, arguments: c.arguments }] }, { role: 'tool', tool_call_id: c.call_id, content: 'result' }] };
  const detail = { type: 'reasoning', id: 'r', encrypted_content: 'ciphertext', summary: [], status: 'completed' };
  const body = metaResponsesBody(compiled, [{ details: [detail], callIds: [c.call_id], calls: [] }]);
  expect(body).toMatchObject({ model: 'meta-model', instructions: 'rules', stream: true, store: false, parallel_tool_calls: true, include: ['reasoning.encrypted_content'] });
  expect(body.reasoning).toBeUndefined(); expect(body.tools.map((t: any) => t.parameters)).toEqual(tools.map(t => t.parameters));
  expect(body.input.map(v => v.type)).toEqual(['message', 'message', 'reasoning', 'message', 'function_call', 'function_call_output']);
  expect(body.input[1].content[1].type).toBe('input_image'); expect(body.input[2].status).toBeUndefined();
  expect(metaResponsesBody(compiled, [], 'high').reasoning).toEqual({ effort: 'high' });
  compiled.messages[2].content = [{ type: 'text', text: 'hi' }, { type: 'image', imageUrl: 'data:image/png;base64,AA==' }] as any;
  expect(metaResponsesBody(compiled, []).input[1].content).toEqual([{ type: 'input_text', text: 'hi' }, { type: 'input_image', image_url: 'data:image/png;base64,AA==' }]);
});
test('no-call reasoning replay precedes final assistant and malformed envelopes fail', () => {
  const compiled = { model: 'm', tools: [], parallel: false, messages: [{ role: 'assistant', content: 'first' }, { role: 'assistant', content: 'last' }] };
  const replay = (detail: any) => [{ details: [detail], callIds: [], calls: [] }];
  expect(metaResponsesBody(compiled, replay({ type: 'reasoning', encrypted_content: 'cipher' })).input.map(v => v.type)).toEqual(['message', 'reasoning', 'message']);
  for (const detail of [{ type: 'signature', data: 'secret' }, { type: 'reasoning', encrypted_content: {} }, { type: 'reasoning', encrypted_content: 'cipher', raw: 'bad' }]) expect(() => metaResponsesBody(compiled, replay(detail))).toThrow();
});
test('text deltas arrive before terminal and usage stays canonical', async () => {
  const frames = [{ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg', delta: 'hello' }, completed([message()], { input_tokens: 8, output_tokens: 3, input_tokens_details: { cached_tokens: 2 }, output_tokens_details: { reasoning_tokens: 1 } })];
  const result = await collect(frames);
  expect(result.events).toEqual([{ type: 'text_delta', text: 'hello' }, { type: 'done', usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11, cacheReadInputTokens: 2, cachedInputTokens: 2, reasoningOutputTokens: 1 }, stopReason: 'stop' }]); expect(result.opaque.terminal).toBeTrue();
});
test('parallel tool arguments give progress but executable calls await terminal', async () => {
  const a = call(), b = call('c2', 'az_' + 'b'.repeat(40), '{"x":1}'); const progress: string[] = [];
  const frames = [a, b].map((item, output_index) => ({ type: 'response.output_item.added', output_index, item: { ...item, arguments: '' } }));
  frames.push({ type: 'response.function_call_arguments.delta', output_index: 1, item_id: b.id, delta: b.arguments } as any, { type: 'response.function_call_arguments.delta', output_index: 0, item_id: a.id, delta: a.arguments } as any, completed([a, b]) as any);
  const result = await collect(frames, { onEvent: (e: string) => progress.push(e) });
  expect(progress).toEqual(['tool_call_args', 'tool_call_args']); expect(result.events.filter(e => e.type === 'tool_call_start').map(e => e.id)).toEqual(['c1', 'c2']);
});
test('encrypted reasoning retained privately and native status stripped', async () => {
  const item = { type: 'reasoning', id: 'r', encrypted_content: 'cipher', summary: [{ type: 'summary_text', text: 'thinking' }], status: 'completed' };
  const result = await collect([{ type: 'response.reasoning_summary_text.delta', item_id: 'r', output_index: 0, summary_index: 0, delta: 'thinking' }, completed([item])]);
  expect(result.events[0]).toEqual({ type: 'thinking_delta', thinking: 'thinking' }); expect(JSON.stringify(result.events)).not.toContain('cipher'); expect(result.opaque.details[0].status).toBeUndefined();
});
test('raw reasoning delta is public thinking without becoming an Anthropic signature', async () => {
  const result = await collect([{ type: 'response.reasoning_text.delta', output_index: 0, item_id: 'r', content_index: 0, delta: 'private thought' }, completed([{ type: 'reasoning', id: 'r', summary: [], encrypted_content: 'cipher' }])]);
  expect(result.events[0]).toEqual({ type: 'thinking_delta', thinking: 'private thought' });
  expect(result.events.some(e => e.type === 'thinking_signature')).toBeFalse();
});
test('text is yielded before terminal and no executable tool event escapes incomplete stream', async () => {
  const opaque = { details: [], terminal: false };
  const iterator = parseMetaResponses(sse([{ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'now' }]), createTranslatorBudget(), opaque);
  expect((await iterator.next()).value).toEqual({ type: 'text_delta', text: 'now' });
  expect(opaque.terminal).toBeFalse(); await expect(iterator.next()).rejects.toThrow();
  const tools = parseMetaResponses(sse([{ type: 'response.function_call_arguments.delta', output_index: 0, delta: '{}' }]), createTranslatorBudget(), opaque);
  await expect(tools.next()).rejects.toThrow();
});
test('arguments done snapshots and failed item status agree with terminal', async () => {
  await expect(collect([{ type: 'response.function_call_arguments.done', output_index: 0, arguments: '{}' }, completed([call()])])).rejects.toThrow();
  await expect(collect([{ type: 'response.output_item.done', output_index: 0, item: call('c1', 'tool', '{}') }, completed([call('c1', 'tool')])])).rejects.toThrow();
  await expect(collect([completed([{ ...call(), status: 'incomplete' }])])).rejects.toThrow();
});
test('incomplete, failed, EOF, cancellation, duplicate and malformed outputs fail closed', async () => {
  for (const frames of [[], [{ type: 'response.incomplete' }], [{ type: 'response.failed' }], [{ type: 'response.completed', response: { status: 'incomplete', output: [] } }], [completed([call(), call()])], [completed([call('c', 'tool', '{bad')])], [completed([{ type: 'web_search_call' }])], [completed([{ ...message(), content: [{ type: 'refusal', refusal: 'no' }] }])], [completed([message()], { input_tokens: -1, output_tokens: 1 })]]) await expect(collect(frames)).rejects.toThrow();
  await expect(collect([completed([])], { signal: AbortSignal.abort() })).rejects.toThrow();
});
test('stream args, IDs, names and text must agree with terminal', async () => {
  const c = call();
  for (const frames of [[{ type: 'response.function_call_arguments.delta', output_index: 0, delta: '{}' }, completed([c])], [{ type: 'response.output_item.added', output_index: 0, item: { ...c, name: 'wrong' } }, completed([c])], [{ type: 'response.output_text.delta', output_index: 0, item_id: 'wrong', content_index: 0, delta: 'hello' }, completed([message()])], [{ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'wrong' }, completed([message()])]]) await expect(collect(frames)).rejects.toThrow();
});
test('invalid SSE JSON and retained output bounds fail', async () => {
  const opaque = { details: [], terminal: false };
  await expect((async () => { for await (const e of parseMetaResponses(new Response('data: {bad}\n\n'), createTranslatorBudget(), opaque)) {} })()).rejects.toThrow();
  expect(() => metaResponsesBody({ model: 'm', tools: [], messages: [{ role: 'assistant' }] }, [{ details: [{ type: 'reasoning', encrypted_content: 'x'.repeat(MAX_BYTES) }], callIds: [], calls: [] }])).toThrow();
  await expect(collect([{ type: 'response.function_call_arguments.delta', output_index: 0, delta: 'x'.repeat(MAX_BYTES / 2 + 1) }, { type: 'response.function_call_arguments.delta', output_index: 0, delta: 'x'.repeat(MAX_BYTES / 2 + 1) }])).rejects.toThrow();
});

test('empty deltas cannot allocate unbounded retained output state', async () => {
  const frames = Array.from({ length: Math.floor(MAX_BYTES / 256) + 1 }, (_, output_index) => ({
    type: 'response.function_call_arguments.delta', output_index, delta: '',
  }));
  await expect(collect(frames)).rejects.toThrow('output_limit');
});

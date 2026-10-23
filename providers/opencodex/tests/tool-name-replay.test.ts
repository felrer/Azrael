import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { compileRequest, mapStream, restoreToolCall, UNAVAILABLE_TOOL_NAMESPACE } from '../inference-mapping.mjs';
import { projectRequest } from '../inference.ts';

const fn = (name: string) => ({ type: 'function', name, parameters: { type: 'object' } });
const ns = (name: string, tool = fn('exec')) => ({ type: 'namespace', name, tools: [tool] });
const request = (tools: any[] = [ns('functions')], input: any[] = [], provider_id = 'anthropic') => ({
  protocol_version: 1, type: 'request', request_id: 'fixture', provider_id, model: 'fixture-model',
  thread_id: 'thread', turn_id: 'turn', credential_scope: 'account', tools, input, parallel_tool_calls: true,
});
const hash = (value: any) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const envelope = (native: any, calls: any[], details: any = [{ type: 'reasoning.text', text: 'private' }]) => ({
  type: 'reasoning', summary: [], encrypted_content: 'azrael-managed-v1:' + Buffer.from(JSON.stringify({
    provider: native.provider_id, model: native.model, thread: native.thread_id, turn: native.turn_id,
    account: native.credential_scope, calls, reasoning_details: details,
  })).toString('base64'),
});
const history = (argumentsText = '{}') => [
  { type: 'function_call', call_id: 'call', namespace: 'functions', name: 'exec', arguments: argumentsText },
  { type: 'function_call_output', call_id: 'call', output: 'done' },
];
const events = async function* (name: string, argumentsText = '{}') {
  yield { kind: 'tool_call_start', id: 'call', name };
  yield { kind: 'tool_call_args', argsDelta: argumentsText };
  yield { kind: 'finish', reason: 'tool_calls' };
};

test('exact wire, original and qualified names preserve public identity and canonical private replay', async () => {
  const native = request();
  const wire = compileRequest(native).tools[0].name;
  for (const name of [wire, 'exec', 'functions.exec']) {
    const frames: any[] = [];
    const compiled = compileRequest(native);
    await mapStream(events(name, '{"value":1}'), { ...compiled, provider: native.provider_id, turn: native.turn_id,
      opaque: { details: [{ type: 'reasoning.text', text: 'private' }] } }, (frame: any) => frames.push(frame), 'fixture');
    const items = frames.filter(frame => frame.type === 'item_done').map(frame => frame.item);
    const call = items.find(item => item.type === 'function_call');
    expect(call).toEqual({ type: 'function_call', call_id: 'call', namespace: 'functions', name: 'exec', arguments: '{"value":1}' });
    const reasoning = items.find(item => item.type === 'reasoning');
    const metadata = JSON.parse(Buffer.from(reasoning.encrypted_content.slice('azrael-managed-v1:'.length), 'base64').toString());
    expect(metadata.calls[0].name).toBe(wire);
    expect(metadata.calls[0].arguments_digest).toBe(hash({ value: 1 }));
    const replay = projectRequest({ ...native, input: [reasoning, call, { type: 'function_call_output', call_id: 'call', output: 'done' }] }, 'account');
    expect(replay.replayDetails).toHaveLength(1);
    expect(replay.compiled.messages.flatMap((message: any) => message.tool_calls ?? [])[0].name).toBe(wire);
  }
});

test('unavailable tool rejection preserves canonical private replay and paired result', async () => {
  const native = request();
  const frames: any[] = [];
  await mapStream(events('unknown_tool', '{"value":1}'), { ...compileRequest(native), provider: native.provider_id,
    turn: native.turn_id, opaque: { details: [{ type: 'reasoning.text', text: 'private' }] } },
    (frame: any) => frames.push(frame), 'fixture');
  const items = frames.filter(frame => frame.type === 'item_done').map(frame => frame.item);
  const rejected = items.find(item => item.type === 'function_call');
  expect(rejected.namespace).toBe(UNAVAILABLE_TOOL_NAMESPACE);
  const replay = projectRequest({ ...native, input: [...items,
    { type: 'function_call_output', call_id: 'call', output: 'Tool is not available.' }] }, 'account');
  expect(replay.replayDetails).toHaveLength(1);
  const wire = replay.compiled.messages.flatMap((message: any) => message.tool_calls ?? [])[0].name;
  expect(replay.compiled.acceptedNames.has(wire)).toBeFalse();
  expect(replay.parsed.context.messages.at(-1)).toMatchObject({ role: 'toolResult', toolCallId: 'call' });
});

test('all name collisions fail without publishing executable calls', async () => {
  const wire = compileRequest(request([ns('functions')])).tools[0].name;
  for (const [tools, name] of [
    [[ns('functions'), ns('other')], 'exec'],
    [[ns('functions'), fn('functions.exec')], 'functions.exec'],
    [[ns('functions'), fn(wire)], wire],
    [[fn('exec'), { type: 'custom', name: 'exec' }], 'exec'],
  ] as [any[], string][]) {
    const frames: any[] = [];
    await expect(mapStream(events(name), compileRequest(request(tools)), (frame: any) => frames.push(frame), 'fixture')).rejects.toThrow('ambiguous_tool_name');
    expect(frames.some(frame => frame.item?.type === 'function_call' || frame.item?.type === 'custom_tool_call' || frame.type === 'completed')).toBeFalse();
  }
  const compiled = compileRequest(request([ns('functions'), ns('other')]));
  expect(restoreToolCall({ id: 'call', name: 'functions.exec', arguments: '{}' }, compiled).namespace).toBe('functions');
});

test('provider catalogs and search history never expand callable names without current declarations', () => {
  const old = compileRequest(request()).tools[0].name;
  const retained = history();
  const search = { type: 'tool_search', execution: 'client', parameters: { type: 'object' } };
  const searchHistory = [
    { type: 'tool_search_call', execution: 'client', call_id: 'search', arguments: { query: 'exec' } },
    { type: 'tool_search_output', execution: 'client', call_id: 'search', status: 'completed', tools: [ns('functions')] },
  ];
  for (const provider of ['anthropic', 'google', 'google-antigravity', 'xai', 'openrouter', 'api-fixture']) {
    const native = request([search, ns('other', fn('lookup'))], [...retained, ...searchHistory], provider);
    const before = JSON.stringify(native);
    for (const name of [old, 'exec', 'functions.exec', 'Exec', ' exec', 'functions.exec ', 'custom_' + old]) {
      expect(() => restoreToolCall({ id: 'new', name, arguments: '{}' }, projectRequest(native, 'account').compiled)).toThrow('undeclared_tool');
    }
    const next = projectRequest({ ...native, tools: [...native.tools, ns('functions')] }, 'account').compiled;
    expect(restoreToolCall({ id: 'new', name: 'functions.exec', arguments: '{}' }, next).name).toBe('exec');
    expect(JSON.stringify(native)).toBe(before);
  }
});

test('empty replay details do not validate absent spawn_agent while real replay does', () => {
  const native = request();
  const calls = [{ id: 'missing', name: 'spawn_agent', arguments_digest: hash({}) }];
  for (const details of [[], undefined]) {
    const input = [envelope(native, calls, details === undefined ? [] : details)];
    if (details === undefined) {
      const data = JSON.parse(Buffer.from(input[0].encrypted_content.split(':')[1], 'base64').toString());
      delete data.reasoning_details;
      input[0].encrypted_content = 'azrael-managed-v1:' + Buffer.from(JSON.stringify(data)).toString('base64');
    }
    expect(projectRequest({ ...native, input }, 'account').replayDetails).toHaveLength(0);
  }
  expect(() => projectRequest({ ...native, input: [envelope(native, calls)] }, 'account')).toThrow('reasoning_scope_mismatch_call_missing');
});

test('nonempty replay resolves declared names and rejects altered names or arguments without rewriting history', () => {
  const native = request();
  const wire = compileRequest(native).tools[0].name;
  for (const name of [wire, 'exec', 'functions.exec']) {
    const input = [envelope(native, [{ id: 'call', name, arguments_digest: hash({}) }]), ...history()];
    const before = JSON.stringify(input);
    expect(projectRequest({ ...native, input }, 'account').replayDetails).toHaveLength(1);
    expect(JSON.stringify(input)).toBe(before);
  }
  for (const [name, args, code] of [
    ['unknown', {}, 'reasoning_scope_mismatch_tool_name'],
    [wire, { changed: true }, 'reasoning_scope_mismatch_arguments'],
  ] as [string, any, string][]) {
    expect(() => projectRequest({ ...native, input: [envelope(native, [{ id: 'call', name, arguments_digest: hash(args) }]), ...history()] }, 'account')).toThrow(code);
  }
  const ambiguous = request([ns('functions'), ns('other')]);
  expect(() => projectRequest({ ...ambiguous, input: [envelope(ambiguous, [{ id: 'call', name: 'exec', arguments_digest: hash({}) }]), ...history()] }, 'account')).toThrow('reasoning_scope_mismatch_tool_name');
});

test('replay validation uses each envelope instead of overwriting matching call IDs', () => {
  const native = request();
  const wire = compileRequest(native).tools[0].name;
  const input = [envelope(native, [{ id: 'call', name: 'unknown', arguments_digest: hash({}) }]),
    envelope(native, [{ id: 'call', name: wire, arguments_digest: hash({}) }]), ...history()];
  expect(() => projectRequest({ ...native, input }, 'account')).toThrow('reasoning_scope_mismatch_tool_name');
});

test('historical canonical identity can replay without granting it as a current tool', () => {
  const native = request();
  const wire = compileRequest(native).tools[0].name;
  const input = [envelope(native, [{ id: 'call', name: wire, arguments_digest: hash({}) }]), ...history()];
  const replay = projectRequest({ ...native, tools: [], input }, 'account');
  expect(replay.replayDetails).toHaveLength(1);
  expect(() => restoreToolCall({ id: 'new', name: wire, arguments: '{}' }, replay.compiled)).toThrow('undeclared_tool');
});

test('provider metadata survives equivalent names but never changed arguments', () => {
  const native = request();
  const wire = compileRequest(native).tools[0].name;
  const providerMetadata = { thoughtSignature: 'fixture-signature' };
  for (const name of [wire, 'exec', 'functions.exec']) for (const changed of [false, true]) {
    const item = envelope(native, [{ id: 'call', name, arguments_digest: hash({}), providerMetadata }], []);
    const replay = projectRequest({ ...native, input: [item, ...history(changed ? '{"changed":true}' : '{}')] }, 'account');
    const call = replay.parsed.context.messages.flatMap((message: any) => message.content ?? []).find((part: any) => part.type === 'toolCall');
    expect(call.providerMetadata).toEqual(changed ? undefined : providerMetadata);
  }
});

test('foreign private envelopes are filtered and direct origin violations have a specific code', () => {
  const native = request();
  const item = envelope(native, []);
  for (const change of [{ provider_id: 'google' }, { model: 'other' }, { thread_id: 'other' }, { turn_id: 'other' }, { credential_scope: 'other' }]) {
    const changed = { ...native, ...change, input: [item] };
    expect(projectRequest(changed, changed.credential_scope).replayDetails).toHaveLength(0);
    expect(() => compileRequest(changed)).toThrow('reasoning_scope_mismatch_origin');
  }
  expect(() => projectRequest({ ...native, input: [envelope(native, [], {})] }, 'account')).toThrow('invalid_reasoning_details');
});

test('alternate names retain required argument and custom wrapper rejection', () => {
  const required = { ...fn('exec'), parameters: { type: 'object', required: ['value'] } };
  expect(() => restoreToolCall({ id: 'new', name: 'functions.exec', arguments: '{}' }, compileRequest(request([ns('functions', required)])))).toThrow('tool_arguments_missing_required');
  expect(() => restoreToolCall({ id: 'new', name: 'patch', arguments: '{}' }, compileRequest(request([{ type: 'custom', name: 'patch' }])))).toThrow('invalid_custom_wrapper');
});

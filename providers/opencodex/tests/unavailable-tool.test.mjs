import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileRequest, mapStream, UNAVAILABLE_TOOL_NAMESPACE } from '../inference-mapping.mjs';

const request = (input = []) => ({ protocol_version: 1, type: 'request', request_id: 'fixture',
  provider_id: 'anthropic', model: 'fixture', thread_id: 'thread', turn_id: 'turn', credential_scope: 'account',
  tools: [{ type: 'function', name: 'available', parameters: { type: 'object' } }], input, parallel_tool_calls: true });
const call = function* (name, id = 'missing', args = '{}') {
  yield { kind: 'tool_call_start', id, name };
  yield { kind: 'tool_call_args', argsDelta: args };
};
async function mapped(events, native = request()) {
  const frames = [];
  await mapStream((async function* () { yield* events; })(), { ...compileRequest(native), provider: native.provider_id,
    turn: native.turn_id }, frame => frames.push(frame), native.request_id);
  return frames;
}

test('unknown and retired tool names produce only non-executing rejection calls after clean terminal', async () => {
  const old = compileRequest(request()).tools[0].name;
  const retired = { ...request(), tools: [] };
  for (const name of ['missing_tool', 'functions.hidden', 'Functions.available', ' available', old]) {
    const native = name === old ? retired : request();
    const frames = await mapped([...call(name, 'original-id', '{"value":1}'), { kind: 'finish', reason: 'tool_calls' }], native);
    assert.deepEqual(frames.find(frame => frame.item?.type === 'function_call').item,
      { type: 'function_call', call_id: 'original-id', namespace: UNAVAILABLE_TOOL_NAMESPACE, name, arguments: '{"value":1}' });
    assert.equal(frames.at(-1).type, 'completed');
    const compiled = compileRequest(native);
    assert.equal(compiled.tools.length, native.tools.length);
    assert.equal(compiled.acceptedNames.has(name), false);
  }
});

test('mixed valid and rejected calls retain order and IDs without granting the unknown name', async () => {
  const frames = await mapped([...call('missing_tool'), ...call('available', 'valid'), { kind: 'finish', reason: 'tool_calls' }]);
  const calls = frames.filter(frame => frame.item?.type === 'function_call').map(frame => frame.item);
  assert.deepEqual(calls.map(item => item.call_id), ['missing', 'valid']);
  assert.equal(calls[0].namespace, UNAVAILABLE_TOOL_NAMESPACE);
  assert.equal(calls[1].namespace, undefined);
  assert.equal(calls[1].name, 'available');
});

test('rejected calls require clean terminal, valid arguments and unique IDs', async () => {
  for (const [events, error] of [
    [[...call('missing_tool')], /provider_eof/],
    [[...call('missing_tool'), { kind: 'finish', reason: 'length' }], /provider_incomplete/],
    [[...call('missing_tool', 'id', '{'), { kind: 'finish', reason: 'tool_calls' }], /tool_arguments_invalid_json/],
    [[...call('missing_tool', 'id', '[]'), { kind: 'finish', reason: 'tool_calls' }], /tool_arguments_not_object/],
    [[...call('missing_tool'), ...call('available'), { kind: 'finish', reason: 'tool_calls' }], /duplicate_call_id/],
  ]) {
    const frames = [];
    await assert.rejects(mapStream((async function* () { yield* events; })(), compileRequest(request()),
      frame => frames.push(frame), 'fixture'), error);
    assert.equal(frames.some(frame => frame.item?.type === 'function_call' || frame.type === 'completed'), false);
  }
});

test('rejection namespace cannot be advertised as a callable catalog', () => {
  for (const tools of [[], [{ type: 'function', name: 'available', parameters: {} }]]) {
    assert.throws(() => compileRequest({ ...request(), tools: [{ type: 'namespace', name: UNAVAILABLE_TOOL_NAMESPACE,
      tools }] }), /reserved_tool_namespace/);
  }
});

test('paired rejection history can be projected for the next model request', async () => {
  const frames = await mapped([...call('missing_tool'), { kind: 'finish', reason: 'tool_calls' }]);
  const items = frames.filter(frame => frame.type === 'item_done').map(frame => frame.item);
  const compiled = compileRequest(request([...items,
    { type: 'function_call_output', call_id: 'missing', output: 'Tool missing_tool is not available. Use only tools in the current tool catalog.' }]));
  const historyCall = compiled.messages.find(message => message.tool_calls)?.tool_calls[0];
  assert.equal(historyCall.id, 'missing');
  assert.equal(compiled.messages.at(-1).tool_call_id, 'missing');
  assert.equal(compiled.acceptedNames.has(historyCall.name), false);
  const next = await mapped([{ kind: 'text', text: 'Continuing with the available tools.' }, { kind: 'finish', reason: 'stop' }],
    request([...items, { type: 'function_call_output', call_id: 'missing', output: 'Tool is not available.' }]));
  assert.equal(next.at(-1).type, 'completed');
});

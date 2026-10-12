import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileRequest as devin, restoreToolCall as restoreDevin } from '../mapping.mjs';
import { compileRequest as managed, restoreToolCall as restoreManaged } from '../../opencodex/inference-mapping.mjs';
import { buildGetChatMessageRequestForTests as wire } from '../vendor/src/adapters/devin/cloud-direct/chat.ts';

const schema = (name, description = 'SCHEMA_MARKER_' + 'x'.repeat(10000)) => ({
  type: 'function', name, description, parameters: { type: 'object', properties: { key: { type: 'string' } } },
});
const search = { type: 'tool_search', execution: 'client', parameters: { type: 'object' } };
const result = (id, tools, status = 'completed') => [
  { type: 'tool_search_call', execution: 'client', call_id: id, arguments: { query: 'lookup' } },
  { type: 'tool_search_output', execution: 'client', call_id: id, status, tools },
];
const request = (tools, input) => ({ protocol_version: 1, type: 'request', request_id: 'fixture',
  thread_id: 'fixture-thread', model: 'fixture-model', tools, input });
const outputs = compiled => compiled.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));

for (const [name, compile, restore] of [['managed', managed, restoreManaged], ['Devin', devin, restoreDevin]]) {
  test(`${name}: current catalog schemas occur once and aliases remain callable across replay`, () => {
    const selected = schema('lookup');
    const tools = [search, { type: 'namespace', name: 'mcp__fixture', tools: [selected] }];
    const input = Array.from({ length: 20 }, (_, i) => result('s' + i, [tools[1]])).flat();
    const native = request(tools, input), original = JSON.stringify(native);
    const compiled = compile(native), alias = compiled.tools[1].name;
    assert.equal(JSON.stringify(native), original);
    assert.equal(compiled.tools[1].parameters, selected.parameters);
    assert.ok(Buffer.byteLength(JSON.stringify(compiled.messages)) < 20000);
    assert.ok(!JSON.stringify(compiled.messages).includes('SCHEMA_MARKER_'));
    for (const [i, message] of compiled.messages.filter(m => m.role === 'tool').entries()) {
      assert.equal(message.tool_call_id, 's' + i);
      assert.deepEqual(JSON.parse(message.content).tools[0].tools, [{ name: alias }]);
    }
    assert.deepEqual(restore({ id: 'call', name: alias, arguments: '{"key":"42"}' }, compiled),
      { type: 'function_call', call_id: 'call', namespace: 'mcp__fixture', name: 'lookup', arguments: '{"key":"42"}' });
    // Fork/resume reprojects retained history, with no persistent helper state.
    const resumed = compile({ ...native, thread_id: 'forked-thread', model: 'other-model' });
    assert.deepEqual(resumed.messages, compiled.messages);
  });

  test(`${name}: uncovered Code Mode and removed tools retain latest definitions without gaining access`, () => {
    const old = schema('lookup', 'OLD_DEFINITION'), current = schema('lookup', 'LATEST_DEFINITION');
    const nested = spec => ({ type: 'namespace', name: 'nested', tools: [spec] });
    const native = request([search, { type: 'custom', name: 'exec', description: 'Code Mode executor' }],
      [...result('old', [nested(old)]), ...result('latest', [nested(current)])]);
    const original = JSON.stringify(native), compiled = compile(native), projected = outputs(compiled);
    assert.deepEqual(projected[0].tools[0].tools, [{ type: 'function', name: 'lookup', schema_reference: 'latest_search_result' }]);
    assert.deepEqual(projected[1].tools[0].tools, [current]);
    assert.equal(JSON.stringify(native), original);
    assert.equal(compiled.tools.length, 2);
    assert.throws(() => restore({ id: 'unknown', name: 'nested.lookup', arguments: '{}' }, compiled), /undeclared_tool/);
    const exec = restore({ id: 'exec', name: compiled.tools[1].name, arguments: JSON.stringify({ input: 'return await nested.lookup({key: "42"});' }) }, compiled);
    assert.equal(exec.type, 'custom_tool_call');
    assert.equal(exec.name, 'exec');
  });

  test(`${name}: namespace and kind identities, empty and failed outputs remain distinct`, () => {
    const a = { type: 'namespace', name: 'a', tools: [schema('run', 'A')] };
    const b = { type: 'namespace', name: 'b', tools: [schema('run', 'B')] };
    const custom = { type: 'custom', name: 'run', description: 'CUSTOM', format: { type: 'text' } };
    const input = [...result('first', [a, b, custom]), ...result('second', [a]),
      ...result('empty', []), ...result('failed', [schema('error', 'FAILED')], 'failed')];
    const compiled = compile(request([search, a], input)), projected = outputs(compiled);
    assert.deepEqual(projected[0].tools[0].tools, [{ name: compiled.tools[1].name }]);
    assert.deepEqual(projected[0].tools[1], b);
    assert.deepEqual(projected[0].tools[2], custom);
    assert.deepEqual(projected[2].tools, []);
    assert.deepEqual(projected[3], { status: 'failed', tools: [schema('error', 'FAILED')] });
    assert.throws(() => compile(request([search], [input[1]])), /invalid_tool_search_result/);
  });

  test(`${name}: repeated large historical schemas fit the existing request budget`, () => {
    const huge = schema('nested', 'BIG_SCHEMA_' + 'x'.repeat(400000));
    const input = Array.from({ length: 25 }, (_, i) => result('s' + i, [huge])).flat();
    const compiled = compile(request([search], input));
    const text = JSON.stringify(compiled.messages);
    assert.equal(text.split('BIG_SCHEMA_').length - 1, 1);
    assert.ok(Buffer.byteLength(text) < 450000);
    assert.equal(outputs(compiled).at(-1).tools[0].parameters.type, 'object');
  });
}

test('Devin protobuf contains only the current schema and preserves search/call replay', () => {
  const selected = schema('lookup', 'WIRE_SCHEMA_' + 'x'.repeat(5000));
  const input = [...result('s1', [selected]), ...result('s2', [selected])];
  const compiled = devin(request([search, selected], input));
  const encoded = wire({ apiKey: 'synthetic-fixture', modelUid: compiled.model, cascadeId: 'thread',
    sessionId: 'fixture-session', requestId: 1n, triggerId: 'fixture-trigger', tools: compiled.tools, messages: compiled.messages });
  assert.equal(encoded.toString().split('WIRE_SCHEMA_').length - 1, 1);
  assert.ok(encoded.includes(Buffer.from(compiled.tools[1].name)));
  assert.ok(encoded.includes(Buffer.from('s1')) && encoded.includes(Buffer.from('s2')));
});

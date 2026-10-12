import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileRequest as devin, restoreToolCall as restoreDevin } from '../mapping.mjs';
import { compileRequest as managed, restoreToolCall as restoreManaged } from '../../opencodex/inference-mapping.mjs';
import { buildGetChatMessageRequestForTests as wire } from '../vendor/src/adapters/devin/cloud-direct/chat.ts';
import { projectSearchHistory, SEARCH_HISTORY_MAX_BYTES } from '../tool-search-history.mjs';

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

  test(`${name}: oversized historical schemas are unavailable without losing paired results`, () => {
    const huge = schema('nested', 'BIG_SCHEMA_' + 'x'.repeat(400000));
    const input = Array.from({ length: 25 }, (_, i) => result('s' + i, [huge])).flat();
    const compiled = compile(request([search], input));
    const text = JSON.stringify(compiled.messages);
    assert.ok(!text.includes('BIG_SCHEMA_'));
    assert.ok(!text.includes('latest_search_result'));
    assert.ok(Buffer.byteLength(text) < 20000);
    assert.equal(outputs(compiled).length, 25);
    assert.equal(outputs(compiled).at(-1).tools[0].schema_reference, 'schema_unavailable_search_again');
  });

  test(`${name}: repeated 50KB namespace metadata occurs once with callable aliases`, () => {
    const namespace = { type: 'namespace', name: 'fixture', description: 'NAMESPACE_MARKER_' + 'x'.repeat(50000),
      auxiliary: { owner: 'fixture' }, tools: [schema('lookup', 'DECLARED_SCHEMA')] };
    const native = request([search, namespace], Array.from({ length: 20 }, (_, i) => result('s' + i, [namespace])).flat());
    const original = JSON.stringify(native), compiled = compile(native), projected = outputs(compiled);
    const text = JSON.stringify(compiled.messages);
    assert.equal(text.split('NAMESPACE_MARKER_').length - 1, 1);
    assert.ok(Buffer.byteLength(text) < 65000);
    assert.equal(projected[0].tools[0].namespace_reference, 'latest_search_result');
    assert.equal(projected[0].tools[0].auxiliary, undefined);
    assert.deepEqual(projected.at(-1).tools[0].auxiliary, namespace.auxiliary);
    assert.deepEqual(projected.at(-1).tools[0].tools, [{ name: compiled.tools[1].name }]);
    assert.equal(restore({ id: 'call', name: compiled.tools[1].name, arguments: '{}' }, compiled).name, 'lookup');
    assert.equal(JSON.stringify(native), original);
  });

  test(`${name}: 20 distinct 50KB schemas obey aggregate cap and retain newest helper`, () => {
    const input = Array.from({ length: 20 }, (_, i) => result('s' + i,
      [{ type: 'namespace', name: 'helpers', description: 'HELPERS_METADATA',
        tools: [schema('helper' + i, 'LARGE_' + i + '_' + 'x'.repeat(50000))] }])).flat();
    const compiled = compile(request([search, { type: 'custom', name: 'exec', description: 'Code Mode' }], input));
    const projected = outputs(compiled), text = JSON.stringify(compiled.messages);
    assert.equal(projected.length, 20);
    assert.ok(Buffer.byteLength(text) < 64000);
    assert.equal(text.split('LARGE_').length - 1, 1);
    assert.equal(projected.at(-1).tools[0].tools[0].name, 'helper19');
    assert.equal(projected.at(-1).tools[0].tools[0].parameters.type, 'object');
    for (const output of projected.slice(0, -1)) {
      assert.equal(output.tools[0].tools[0].schema_reference, 'schema_unavailable_search_again');
    }
    assert.throws(() => restore({ id: 'call', name: 'helpers.helper19', arguments: '{}' }, compiled), /undeclared_tool/);
    assert.equal(restore({ id: 'exec', name: compiled.tools[1].name,
      arguments: JSON.stringify({ input: 'return await helpers.helper19({key: "42"});' }) }, compiled).name, 'exec');
  });
}

test('historical retention counts distinct identities, repeated occurrences and namespace metadata together', () => {
  const specs = Array.from({ length: 20 }, (_, i) => schema('helper' + i, 'SMALL_' + i));
  const input = [...specs.flatMap((spec, i) => result('s' + i, [spec])), ...result('repeat', [specs[0]])];
  const compiled = devin(request([search], input)), projected = outputs(compiled);
  const full = projected.flatMap(output => output.tools).filter(spec => spec.parameters);
  assert.deepEqual(full.map(spec => spec.name), ['helper13', 'helper14', 'helper15', 'helper16', 'helper17', 'helper18', 'helper19', 'helper0']);
  assert.equal(projected[0].tools[0].schema_reference, 'latest_search_result');
  assert.equal(projected[1].tools[0].schema_reference, 'schema_unavailable_search_again');

  const namespace = { type: 'namespace', name: 'helpers', description: '메'.repeat(12000),
    tools: [schema('one', 'A'.repeat(18000)), schema('two', 'B'.repeat(18000))] };
  const nestedInput = [...result('old', [namespace]), ...result('new', [namespace])];
  const nestedOutputs = outputs(devin(request([search], nestedInput)));
  const latest = nestedOutputs[1].tools[0];
  const { tools, ...metadata } = latest;
  const fullTools = tools.filter(tool => tool.parameters);
  assert.equal(fullTools.length, 1);
  assert.equal(fullTools[0].name, 'two');
  assert.ok(Buffer.byteLength(JSON.stringify(metadata)) + fullTools.reduce((size, tool) => size + Buffer.byteLength(JSON.stringify(tool)), 0) <= SEARCH_HISTORY_MAX_BYTES);
  assert.equal(nestedOutputs[0].tools[0].description, undefined);
});

test('optional current eligibility excludes historical schemas without granting execution access', () => {
  const input = [...result('s', [schema('removed', 'REMOVED'), schema('helper', 'HELPER')])];
  const project = projectSearchHistory(input, new Set(), (_namespace, name) => name, new Set(['helper']));
  const output = project(input[1], 1);
  assert.equal(output.tools[0].schema_reference, 'schema_unavailable_search_again');
  assert.equal(output.tools[1].description, 'HELPER');
});

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

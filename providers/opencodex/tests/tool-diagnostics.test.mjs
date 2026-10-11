import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToolDiagnostics } from '../tool-diagnostics.mjs';
import { compileRequest, mapStream } from '../inference-mapping.mjs';
import { createProgressMonitor } from '../../devin/progress.mjs';

const base = (tools, input = []) => ({ protocol_version: 1, type: 'request', request_id: 'probe',
  model: 'claude-opus-5-5', thread_id: 'SECRET_THREAD', credential_scope: 'SECRET_ACCOUNT',
  tools, input, parallel_tool_calls: true });
const functionTool = (name = 'SECRET_TOOL') => ({ type: 'function', name, parameters: { type: 'object' } });
const events = async function* (name, args = '{}') {
  yield { kind: 'tool_call_start', id: 'SECRET_CALL_ID', name };
  yield { kind: 'tool_call_args', argsDelta: '' };
  yield { kind: 'tool_call_args', argsDelta: args };
  yield { kind: 'finish', reason: 'tool_calls' };
};

test('actual mapping records prefixed raw alias, successful restoration and counts without payload', async () => {
  let time = 0;
  const compiled = compileRequest(base([functionTool()]));
  const name = compiled.tools[0].name;
  const d = createToolDiagnostics({ now: () => time, wirePrefix: 'custom_' });
  d.catalog(compiled);
  d.raw({ type: 'content_block_start', index: 3, content_block: { type: 'tool_use', id: 'SECRET_CALL_ID', name: 'custom_' + name } });
  d.raw({ type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '' } });
  d.raw({ type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '{"SECRET_ARG":"SECRET_VALUE"}' } });
  d.raw({ type: 'content_block_stop', index: 3 });
  const frames = [];
  await mapStream(events(name, '{"SECRET_ARG":"SECRET_VALUE"}'), { ...compiled, toolDiagnostics: d }, frame => frames.push(frame), 'probe');
  time = 45;
  const s = d.snapshot();
  assert.equal(s.mapping_result, 'validated'); assert.equal(s.json_result, 'valid_object');
  assert.equal(s.call_open, false); assert.equal(s.call_count, 1);
  assert.equal(s.raw_parser_name_equal, true); assert.equal(s.name_match, 'declared');
  assert.equal(s.sse_args_delta_count, 2); assert.equal(s.sse_args_empty_delta_count, 1);
  assert.equal(s.args_delta_count, 2); assert.equal(s.args_empty_delta_count, 1);
  assert.equal(s.args_bytes, s.sse_args_bytes); assert.equal(s.args_idle_ms, 45);
  assert.equal(frames.filter(frame => frame.item?.type === 'function_call').length, 1);
  assert.equal(frames.at(-1).type, 'completed');
  assert(!JSON.stringify(s).includes('SECRET'));
  for (const key of ['catalog_sha256', 'parser_name_sha256', 'raw_name_sha256', 'declared_alias_sha256']) assert.match(s[key], /^[a-f0-9]{64}$/);
});

test('undeclared alias is distinguished from historical, original, qualified and unknown names', async () => {
  const tool = { type: 'namespace', name: 'SECRET_NAMESPACE', tools: [functionTool()] };
  const old = compileRequest(base([functionTool('OLD_TOOL')]));
  const history = [{ type: 'function_call', name: 'OLD_TOOL', call_id: 'old', arguments: '{}' }, { type: 'function_call_output', call_id: 'old', output: 'SECRET_RESULT' }];
  for (const [name, match, style] of [[old.tools[0].name, 'history_only', 'alias'], ['SECRET_TOOL', 'current_original', 'original'], ['SECRET_NAMESPACE.SECRET_TOOL', 'current_qualified', 'qualified'], ['unknown', 'unknown', 'other'], ['', 'missing', 'missing']]) {
    const compiled = compileRequest(base([tool], history));
    const d = createToolDiagnostics(); d.catalog(compiled);
    const frames = [];
    await assert.rejects(mapStream(events(name), { ...compiled, toolDiagnostics: d }, frame => frames.push(frame), 'probe'), /undeclared_tool/);
    assert.equal(d.snapshot().name_match, match); assert.equal(d.snapshot().name_style, style);
    assert.equal(d.snapshot().mapping_result, 'undeclared'); assert.equal(d.snapshot().call_state, 'rejected');
    assert.equal(d.snapshot().history_alias_count, 1);
    assert(!frames.some(frame => frame.item?.type === 'function_call'));
    assert(!JSON.stringify(d.snapshot()).includes('SECRET'));
  }
});

test('ping-only tool argument stall preserves empty delta and time evidence without resetting generation', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let time = 0;
  const compiled = compileRequest(base([functionTool()])); const name = compiled.tools[0].name;
  const d = createToolDiagnostics({ now: () => time, wirePrefix: 'custom_' }); d.catalog(compiled);
  const frames = [], monitor = createProgressMonitor(frame => frames.push(frame), { now: () => time, toolDiagnostics: d });
  d.raw({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name: 'custom_' + name, id: 'SECRET_ID' } });
  d.start({ name, id: 'SECRET_ID' }); monitor.observe({ kind: 'event', event: 'tool_call_start' });
  d.raw({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '' } }); d.args('');
  time = 97000; d.raw({ type: 'ping' }); monitor.observe({ kind: 'bytes', bytes: 36 });
  t.mock.timers.tick(10000);
  const s = frames.at(-1).progress;
  assert.equal(s.event_count, 1); assert.equal(s.event_idle_ms, 97000);
  assert.equal(s.tool_diagnostics.args_idle_ms, 97000); assert.equal(s.tool_diagnostics.call_open, true);
  assert.equal(s.tool_diagnostics.sse_args_empty_delta_count, 1); assert.equal(s.tool_diagnostics.args_bytes, 0);
  assert.equal(s.tool_diagnostics.mapping_result, 'none'); monitor.stop();
});

test('malformed JSON, nonobject arguments, custom wrapper and duplicate id retain existing rejection', async () => {
  for (const [tool, args, json, result, error] of [
    [functionTool(), '{', 'invalid_json', 'invalid_arguments', /JSON/],
    [functionTool(), '[]', 'not_object', 'invalid_arguments', /tool_arguments_not_object/],
    [{ type: 'custom', name: 'patch' }, '{}', 'valid_object', 'invalid_custom_wrapper', /invalid_custom_wrapper/],
  ]) {
    const compiled = compileRequest(base([tool])), d = createToolDiagnostics(); d.catalog(compiled);
    const frames = [];
    await assert.rejects(mapStream(events(compiled.tools[0].name, args), { ...compiled, toolDiagnostics: d }, frame => frames.push(frame), 'probe'), error);
    assert.equal(d.snapshot().json_result, json); assert.equal(d.snapshot().mapping_result, result);
    assert(!frames.some(frame => frame.item?.type === 'function_call' || frame.item?.type === 'custom_tool_call'));
  }
  const compiled = compileRequest(base([functionTool()])), d = createToolDiagnostics(); d.catalog(compiled);
  compiled.calls.add('SECRET_CALL_ID');
  await assert.rejects(mapStream(events(compiled.tools[0].name), { ...compiled, toolDiagnostics: d }, () => {}, 'probe'), /duplicate_call_id/);
  assert.equal(d.snapshot().mapping_result, 'duplicate_id');
});

test('same-name namespaces are distinct and raw observations in a buffered chunk follow call ids', async () => {
  const compiled = compileRequest(base(['one', 'two'].map(name => ({ type: 'namespace', name, tools: [functionTool()] }))));
  const d = createToolDiagnostics({ wirePrefix: 'custom_' }); d.catalog(compiled);
  for (const [i, tool] of compiled.tools.entries()) {
    d.raw({ type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: 'id-' + i, name: 'custom_' + tool.name } });
    d.raw({ type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: '{}'.repeat(i + 1) } });
    d.raw({ type: 'content_block_stop', index: i });
  }
  d.start({ id: 'id-0', name: compiled.tools[0].name }); assert.equal(d.snapshot().sse_args_bytes, 2); assert.equal(d.snapshot().raw_parser_name_equal, true);
  d.start({ id: 'id-1', name: compiled.tools[1].name }); assert.equal(d.snapshot().sse_args_bytes, 4); assert.equal(d.snapshot().raw_parser_name_equal, true);
  assert.notEqual(compiled.tools[0].name, compiled.tools[1].name);
  const reordered = createToolDiagnostics(); reordered.catalog({ ...compiled, names: new Map([...compiled.names].reverse()) });
  assert.equal(reordered.snapshot().catalog_sha256, d.snapshot().catalog_sha256);
});

test('oversized hostile names and broken clocks/observers cannot leak or alter tool execution', async () => {
  const compiled = compileRequest(base([functionTool()]));
  const d = createToolDiagnostics({ now: () => { throw Error('SECRET_CLOCK'); } }); d.catalog(compiled);
  d.start({ id: 'SECRET_ID', name: 'SECRET'.repeat(1000) }); d.args('SECRET_ARGS');
  const s = d.snapshot(); assert.equal(s.name_style, 'oversized'); assert(!('parser_name_sha256' in s));
  assert(!JSON.stringify(s).includes('SECRET')); assert.equal(s.args_idle_ms, 0);
  const bad = new Proxy({}, { get() { throw Error('SECRET_OBSERVER'); } });
  const frames = [];
  await mapStream(events(compiled.tools[0].name), { ...compiled, toolDiagnostics: bad }, frame => frames.push(frame), 'probe');
  assert.equal(frames.at(-1).type, 'completed');
  const m = createProgressMonitor(() => {}, { toolDiagnostics: bad }); assert.doesNotThrow(() => m.snapshot()); m.stop();
  const legacy = createProgressMonitor(() => {}); assert(!('tool_diagnostics' in legacy.snapshot())); legacy.stop();
});

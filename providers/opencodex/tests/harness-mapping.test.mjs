import test from 'node:test';
import assert from 'node:assert/strict';
import { compileRequest, restoreToolCall } from '../inference-mapping.mjs';

const names = ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash', 'Agent', 'Skill', 'ToolSearch', 'AskUserQuestion', 'TaskOutput', 'TaskStop'];
const fn = name => ({ type: 'function', name, parameters: { type: 'object' } });
const request = () => ({ protocol_version: 1, type: 'request', request_id: 'profile-check', provider_id: 'anthropic', model: 'claude-fixture', instructions: 'Azrael policy', input: [], tools: [{ type: 'namespace', name: 'functions', tools: names.map(fn) }], harness_profile: { id: 'anthropic', fingerprint: 'fixture-v1', tool_profile: 'builtin/claude-code-core', prompt_profile: 'builtin/anthropic-default' } });

test('compatible calls retain exact wire names and require current declarations', () => {
  const input = request();
  const before = JSON.stringify(input);
  const compiled = compileRequest(input, { actualAdapter: 'anthropic' });
  assert.deepEqual(compiled.tools.map(tool => tool.name), names);
  for (const name of names) assert.deepEqual(restoreToolCall({ id: name, name, arguments: '{}' }, compiled), { type: 'function_call', call_id: name, namespace: 'functions', name, arguments: '{}' });
  assert.equal(JSON.stringify(input), before);
  const empty = compileRequest({ ...input, tools: [] }, { actualAdapter: 'anthropic' });
  assert.throws(() => restoreToolCall({ id: 'new', name: 'Read', arguments: '{}' }, empty), /undeclared_tool/);
});

test('actual provider and adapter own compatibility; ordinary requests keep hashes', () => {
  for (const provider_id of ['openrouter', 'google', 'openai']) assert.throws(() => compileRequest({ ...request(), provider_id }, { actualAdapter: 'anthropic' }), /harness_provider_mismatch/);
  assert.throws(() => compileRequest(request(), { actualAdapter: 'google' }), /harness_provider_mismatch/);
  const native = request();
  delete native.harness_profile;
  assert.ok(compileRequest(native).tools.every(tool => /^az_[a-f0-9]{40}$/.test(tool.name)));
});

test('Anthropic accepts explicit Azrael tools and preserves native calls and results', () => {
  const native = { ...request(),
    harness_profile: { id: 'azrael', fingerprint: 'azrael-v1', tool_profile: 'builtin/azrael-default', prompt_profile: 'builtin/azrael-default' },
    tools: [{ type: 'namespace', name: 'functions', tools: [fn('exec_command'),
      { type: 'custom', name: 'apply_patch', format: { type: 'text' } }] }],
    input: [
      { type: 'function_call', namespace: 'functions', name: 'exec_command', call_id: 'read', arguments: '{"cmd":"read fixture"}' },
      { type: 'function_call_output', call_id: 'read', output: 'fixture contents' },
      { type: 'custom_tool_call', namespace: 'functions', name: 'apply_patch', call_id: 'edit', input: 'fixture patch' },
      { type: 'custom_tool_call_output', call_id: 'edit', output: 'patch applied' },
    ] };
  const compiled = compileRequest(native, { actualAdapter: 'anthropic', promptFormat: 'anthropic-xml' });
  for (const [name, id, args] of [['exec_command', 'read', '{"cmd":"read fixture"}'], ['apply_patch', 'edit', '{"input":"fixture patch"}']]) {
    const wire = compiled.messages.find(message => message.tool_calls?.some(call => call.id === id)).tool_calls.find(call => call.id === id);
    assert.match(wire.name, /^az_[a-f0-9]{40}$/);
    const restored = restoreToolCall({ id: `${id}-next`, name: wire.name, arguments: args }, compiled);
    assert.equal(restored.name, name);
    assert.equal(restored.call_id, `${id}-next`);
    assert.equal(restored.namespace, 'functions');
  }
  assert.deepEqual(compiled.messages.filter(message => message.role === 'tool').map(({ tool_call_id, content }) => ({ tool_call_id, content })), [
    { tool_call_id: 'read', content: '<tool_result>\n<![CDATA[fixture contents]]>\n</tool_result>' },
    { tool_call_id: 'edit', content: '<tool_result>\n<![CDATA[patch applied]]>\n</tool_result>' },
  ]);
});

for (const catalogSize of [587, 1000]) {
  test(`Claude search history references only current catalog aliases (${catalogSize} available tools)`, () => {
    const available = Array.from({ length: catalogSize }, (_, index) => ({ ...fn(`lookup_${index}`),
      description: `EXTERNAL_SCHEMA_${index}_` + 'x'.repeat(1000) }));
    const namespace = tools => ({ type: 'namespace', name: 'mcp__fixture', tools });
    const searched = namespace(available.slice(0, 11));
    const hidden = namespace(available.slice(11, 12));
    const native = request();
    native.input = Array.from({ length: 10 }, (_, index) => [
      { type: 'function_call', namespace: 'functions', name: 'ToolSearch', call_id: `search-${index}`, arguments: '{"query":"lookup"}' },
      { type: 'tool_search_output', execution: 'client', call_id: `search-${index}`, status: 'completed', tools: [searched, searched, hidden] },
    ]).flat();
    const before = JSON.stringify(native);
    const initial = compileRequest(native, { actualAdapter: 'anthropic' });
    assert.equal(initial.tools.length, names.length);
    for (const message of initial.messages.filter(message => message.role === 'tool'))
      assert.deepEqual(JSON.parse(message.content).tools, []);

    const expanded = { ...native, tools: [...native.tools, searched] };
    const expandedBefore = JSON.stringify(expanded);
    const compiled = compileRequest(expanded, { actualAdapter: 'anthropic' });
    const aliases = compiled.tools.slice(names.length).map(tool => ({ name: tool.name }));
    assert.equal(aliases.length, 11);
    const history = compiled.messages.filter(message => message.role !== 'system');
    assert.equal(history.length, 20);
    for (let index = 0; index < 10; index++) {
      const call = history[index * 2].tool_calls[0];
      const result = history[index * 2 + 1];
      assert.deepEqual(call, { id: `search-${index}`, name: 'ToolSearch', arguments: '{"query":"lookup"}' });
      assert.equal(result.tool_call_id, call.id);
      assert.deepEqual(JSON.parse(result.content), { status: 'completed', tools: aliases,
        guidance: 'Call only names in the current tools catalog. Search again for other tools.' });
    }
    const wire = JSON.stringify({ tools: compiled.tools, messages: compiled.messages });
    assert.equal(wire.split('EXTERNAL_SCHEMA_').length - 1, 11);
    const selectedAlias = aliases[0].name;
    assert.deepEqual(restoreToolCall({ id: 'lookup', name: selectedAlias, arguments: '{}' }, compiled),
      { type: 'function_call', call_id: 'lookup', namespace: 'mcp__fixture', name: 'lookup_0', arguments: '{}' });
    for (const rejected of ['mcp__fixture.lookup_11', 'unknown', selectedAlias]) {
      const catalog = rejected === selectedAlias ? initial : compiled;
      assert.throws(() => restoreToolCall({ id: 'new', name: rejected, arguments: '{}' }, catalog), /undeclared_tool/);
    }
    // A Claude-looking model with a native profile keeps the existing history projection.
    const ordinary = compileRequest({ ...expanded, harness_profile: { ...native.harness_profile, tool_profile: 'builtin/native' } });
    assert.match(JSON.stringify(ordinary.messages), /EXTERNAL_SCHEMA_11_/);
    assert.equal(JSON.stringify(native), before);
    assert.equal(JSON.stringify(expanded), expandedBefore);
  });
}

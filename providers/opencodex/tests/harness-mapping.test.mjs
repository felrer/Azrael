import test from 'node:test';
import assert from 'node:assert/strict';
import { compileRequest, restoreToolCall } from '../inference-mapping.mjs';

const fn = name => ({ type: 'function', name, parameters: { type: 'object' } });
const profile = instruction_format => ({ id: instruction_format === 'native' ? 'azrael' : 'anthropic', fingerprint: instruction_format + '-v1', tool_profile: 'builtin/azrael-default', prompt_profile: instruction_format === 'native' ? 'builtin/azrael-default' : 'builtin/anthropic', instruction_format });
const request = instruction_format => ({ protocol_version: 1, type: 'request', request_id: 'profile-check', provider_id: 'anthropic', model: 'claude-fixture', instructions: 'Azrael policy', input: [], tools: [{ type: 'namespace', name: 'functions', tools: [fn('exec_command'), fn('spawn_agent')] }], harness_profile: profile(instruction_format) });

test('both instruction profiles preserve native schemas and namespace-aware aliases', () => {
  const baseline = compileRequest(request('native'));
  for (const format of ['native', 'anthropic-xml']) for (const provider_id of ['anthropic', 'google', 'openrouter']) {
    const input = { ...request(format), provider_id }, before = JSON.stringify(input);
    const compiled = compileRequest(input);
    assert.deepEqual(compiled.tools, baseline.tools);
    for (const [index, name] of ['exec_command', 'spawn_agent'].entries()) {
      const alias = compiled.tools[index].name;
      assert.match(alias, /^az_[a-f0-9]{40}$/);
      assert.deepEqual(restoreToolCall({ id: name, name: alias, arguments: '{}' }, compiled), { type: 'function_call', call_id: name, namespace: 'functions', name, arguments: '{}' });
    }
    assert.equal(compiled.messages[0].content.includes('<common_instructions>'), format === 'anthropic-xml');
    assert.equal(JSON.stringify(input), before);
    assert.throws(() => restoreToolCall({ id: 'new', name: baseline.tools[0].name, arguments: '{}' }, compileRequest({ ...input, tools: [] })), /undeclared_tool/);
  }
});

test('profile validates instruction format and absent format stays native', () => {
  for (const instruction_format of ['', null, 'xml', 1]) assert.throws(() => compileRequest(request(instruction_format)), /invalid_harness_profile/);
  const input = request('native');
  delete input.harness_profile.instruction_format;
  assert.equal(compileRequest(input).messages[0].content, input.instructions);
  delete input.harness_profile;
  assert.equal(compileRequest(input).messages[0].content, input.instructions);
});

test('custom calls and historical aliases retain native authority for both formats', () => {
  for (const format of ['native', 'anthropic-xml']) {
    const input = { ...request(format), tools: [{ type: 'namespace', name: 'functions', tools: [{ type: 'custom', name: 'apply_patch', format: { type: 'text' } }] }], input: [
      { type: 'custom_tool_call', namespace: 'functions', name: 'apply_patch', call_id: 'edit', input: 'fixture patch' },
      { type: 'custom_tool_call_output', call_id: 'edit', output: 'patch applied' },
    ] };
    const compiled = compileRequest(input), call = compiled.messages.find(message => message.tool_calls)?.tool_calls[0];
    assert.deepEqual(restoreToolCall({ ...call, id: 'next' }, compiled), { type: 'custom_tool_call', call_id: 'next', namespace: 'functions', name: 'apply_patch', input: 'fixture patch' });
    const retired = compileRequest({ ...input, tools: [] });
    assert.equal(retired.messages.find(message => message.tool_calls).tool_calls[0].name, call.name);
    assert.throws(() => restoreToolCall({ ...call, id: 'next' }, retired), /undeclared_tool/);
  }
});

// Future mapping/profile edits must preserve image parts instead of applying text projection.
test('agent images survive both harness profiles without exposing opaque content', () => {
  const image = { type: 'input_image', image_url: 'data:image/png;base64,AAAA' };
  for (const format of ['native', 'anthropic-xml']) {
    const input = { ...request(format), instructions: '', input: [{ type: 'agent_message', author: '/root/a', recipient: '/root/b', content: [{ type: 'input_text', text: 'Image attachment ID: img_fixture' }, image] }] };
    const message = compileRequest(input).messages[0];
    assert.equal(message.role, 'user');
    assert.deepEqual(message.content.at(-1), { type: 'image', imageUrl: image.image_url });
    assert.ok(message.content.some(part => part.type === 'text' && part.text.includes('img_fixture')));
    assert.throws(() => compileRequest({ ...input, input: [{ ...input.input[0], content: [{ type: 'encrypted_content', encrypted_content: 'opaque' }, image] }] }), /unsupported_nontext_content/);
  }
});

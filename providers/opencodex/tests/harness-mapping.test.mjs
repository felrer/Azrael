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

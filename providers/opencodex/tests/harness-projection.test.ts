import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { compileRequest, mapStream, restoreToolCall } from '../inference-mapping.mjs';
import { projectRequest } from '../inference.ts';

const names = ['exec_command', 'spawn_agent'];
const fn = (name: string) => ({ type: 'function', name, parameters: { type: 'object' } });
const profile = { id: 'azrael', fingerprint: 'profile-v1', tool_profile: 'builtin/azrael-default', prompt_profile: 'builtin/azrael-default', instruction_format: 'native' };
const native = (changes: any = {}) => ({ protocol_version: 1, type: 'request', request_id: 'fixture',
  provider_id: 'anthropic', model: 'claude-fixture', thread_id: 'thread', turn_id: 'turn', credential_scope: 'account',
  harness_profile: profile, instructions: 'Azrael policy', tools: [{ type: 'namespace', name: 'functions', tools: names.map(fn) }], input: [], ...changes });
const compile = (request: any) => compileRequest(request);
const project = (request: any) => projectRequest(request, 'account');

test('native functions have stable wire aliases and return native durable identities', () => {
  const request = native();
  const before = JSON.stringify(request);
  const compiled = compile(request);
  expect(compiled.tools.every((tool: any) => /^az_[a-f0-9]{40}$/.test(tool.name))).toBeTrue();
  for (const [index, name] of names.entries()) expect(restoreToolCall({ id: name, name: compiled.tools[index].name, arguments: '{}' }, compiled))
    .toEqual({ type: 'function_call', call_id: name, namespace: 'functions', name, arguments: '{}' });
  expect(JSON.stringify(request)).toBe(before);
});

test('MCP and native tools keep deterministic hashes and collisions fail closed', () => {
  const request = native({ tools: [fn('exec_command'), { type: 'namespace', name: 'mcp_server', tools: [fn('exec_command')] }, fn('other')] });
  const compiled = compile(request);
  const hash = (namespace: string, name: string) => 'az_' + createHash('sha256').update(JSON.stringify([namespace, name, 'function'])).digest('hex').slice(0, 40);
  expect(compiled.tools.map((tool: any) => tool.name)).toEqual([hash('', 'exec_command'), hash('mcp_server', 'exec_command'), hash('', 'other')]);
  expect(() => restoreToolCall({ id: 'collision', name: 'exec_command', arguments: '{}' }, compiled)).toThrow('ambiguous_tool_name');
  expect(restoreToolCall({ id: 'mcp', name: hash('mcp_server', 'exec_command'), arguments: '{}' }, compiled).namespace).toBe('mcp_server');
  expect(compile(native({ tools: [fn('exec_command'), { type: 'namespace', name: 'functions', tools: [fn('exec_command')] }] })).tools).toHaveLength(2);
  expect(() => compile(native({ tools: [fn('exec_command'), fn('exec_command')] }))).toThrow('duplicate_tool_identity');
});

test('profile validates resolved metadata without restricting provider or adapter', () => {
  for (const changes of [{ provider_id: 'google' }, { provider_id: 'openrouter' }, { model: 'managed/google/fixture' }])
    expect(compile(native(changes)).tools).toHaveLength(names.length);
  for (const harness_profile of [null, {}, { ...profile, fingerprint: '' }, { ...profile, id: 1 }, { ...profile, instruction_format: 'bad' }])
    expect(() => compile(native({ harness_profile }))).toThrow('invalid_harness_profile');
});

test('context preserves roles, ordered images, instructions and result IDs without extra XML', () => {
  const request = native({ input: [
    { type: 'message', role: 'developer', content: 'project instructions and skill catalog' },
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'task' }, { type: 'input_image', image_url: 'data:image/png;base64,YQ==' }] },
    { type: 'function_call', namespace: 'functions', name: 'exec_command', call_id: 'read', arguments: '{}' },
    { type: 'function_call_output', call_id: 'read', output: '1\tcontent' },
  ] });
  const projected = project(request);
  expect(projected.parsed.context.systemPrompt).toEqual(['Azrael policy', 'project instructions and skill catalog']);
  const messages = projected.parsed.context.messages;
  expect(messages[0].role).toBe('user');
  expect(messages[0].content.map((part: any) => part.type)).toEqual(['text', 'image']);
  expect(messages[0].content[0].text).toBe('task');
  expect(messages[1].content[0].name).toBe(projected.compiled.tools[0].name);
  expect(messages[2]).toMatchObject({ role: 'toolResult', toolCallId: 'read', toolName: projected.compiled.tools[0].name, content: '1\tcontent' });
  const retired = project(native({ tools: [], input: request.input }));
  expect(() => restoreToolCall({ id: 'new', name: 'exec_command', arguments: '{}' }, retired.compiled)).toThrow('undeclared_tool');
});

test('profile fingerprints isolate private replay while preserving visible history', async () => {
  const request = native();
  const frames: any[] = [];
  await mapStream((async function* () {
    yield { kind: 'reasoning', text: 'visible reasoning' };
    yield { kind: 'reasoning_signature', signature: 'signed' };
    yield { kind: 'tool_call_start', id: 'read', name: compile(request).tools[0].name };
    yield { kind: 'tool_call_args', argsDelta: '{}' };
    yield { kind: 'finish', reason: 'tool_calls' };
  })(), { ...compile(request), provider: request.provider_id, turn: request.turn_id, opaque: { details: [{ type: 'thinking', signature: 'signed' }] } }, frame => frames.push(frame), 'fixture');
  const items = frames.filter(frame => frame.type === 'item_done').map(frame => frame.item);
  const reasoning = items.find(item => item.type === 'reasoning');
  const metadata = JSON.parse(Buffer.from(reasoning.encrypted_content.split(':')[1], 'base64').toString());
  expect(metadata.harness_fingerprint).toBe(profile.fingerprint);
  const input = [...items, { type: 'function_call_output', call_id: 'read', output: 'done' }];
  expect(project(native({ input })).replayDetails).toHaveLength(1);
  const changed = project(native({ input, harness_profile: { ...profile, fingerprint: 'profile-v2' } }));
  expect(changed.replayDetails).toHaveLength(0);
  expect(changed.parsed.context.messages[0].content.find((part: any) => part.type === 'thinking')).toEqual({ type: 'thinking', thinking: 'visible reasoning' });
  expect(() => compile(native({ input, harness_profile: { ...profile, fingerprint: 'profile-v2' } }))).toThrow('reasoning_scope_mismatch_harness');
  delete metadata.harness_fingerprint;
  const legacy = { ...reasoning, encrypted_content: 'azrael-managed-v1:' + Buffer.from(JSON.stringify(metadata)).toString('base64') };
  expect(project(native({ input: [legacy] })).replayDetails).toHaveLength(0);
});

test('resolved instruction format alone selects XML across providers with identical tools', () => {
  for (const provider_id of ['anthropic', 'google', 'openrouter', 'api-fixture']) {
    const baseline = compile(native({ provider_id }));
    for (const instruction_format of ['native', 'anthropic-xml']) {
      const compiled = compile(native({ provider_id, harness_profile: { ...profile, id: 'anthropic', prompt_profile: 'builtin/anthropic', instruction_format } }));
      expect(compiled.tools).toEqual(baseline.tools);
      expect(compiled.messages[0].content.includes('<common_instructions>')).toBe(instruction_format === 'anthropic-xml');
    }
    expect(compile(native({ provider_id, harness_profile: undefined })).messages[0].content).toBe('Azrael policy');
  }
});

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { compileRequest, mapStream, restoreToolCall } from '../mapping.mjs';
import { buildGetChatMessageRequestForTests as buildNativeWire } from '../vendor/src/adapters/devin/cloud-direct/chat.ts';
import { iterFields } from '../vendor/src/adapters/devin/cloud-direct/wire.ts';

const helperPath = fileURLToPath(new URL('../helper.mjs', import.meta.url));

function request(overrides = {}) {
  return {
    protocol_version: 1,
    type: 'request',
    request_id: 'req-1',
    thread_id: 'thread-1',
    model: 'swe-2-high',
    input: [],
    tools: [],
    ...overrides,
  };
}

function wireName(compiled, expected) {
  for (const [name, owner] of compiled.names) {
    if (owner.namespace === expected.namespace && owner.name === expected.name && owner.kind === expected.kind) return name;
  }
  assert.fail(`missing wire name for ${JSON.stringify(expected)}`);
}

async function* events(values) {
  for (const value of values) yield value;
}

async function captureStream(values, compiled = compileRequest(request())) {
  const emitted = [];
  await mapStream(events(values), compiled, event => emitted.push(event), 'req-1');
  return emitted;
}

function runHelper(stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helperPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

test('same local names and name/kind collisions receive distinct aliases and round-trip exactly', () => {
  const compiled = compileRequest(request({ tools: [
    { type: 'function', name: 'run', description: 'root function', parameters: { type: 'object' } },
    { type: 'custom', name: 'run', description: 'root custom' },
    { type: 'namespace', name: 'mcp_alpha', tools: [
      { type: 'function', name: 'run', description: 'first MCP', parameters: { type: 'object' } },
    ] },
    { type: 'namespace', name: 'mcp_beta', tools: [
      { type: 'function', name: 'run', description: 'second MCP', parameters: { type: 'object' } },
    ] },
  ] }));

  assert.equal(new Set(compiled.tools.map(tool => tool.name)).size, 4);
  const cases = [
    [{ namespace: '', name: 'run', kind: 'function' }, '{"cwd":"C:/a"}', 'function_call'],
    [{ namespace: '', name: 'run', kind: 'custom' }, '{"input":"line 1\\nline 2"}', 'custom_tool_call'],
    [{ namespace: 'mcp_alpha', name: 'run', kind: 'function' }, '{}', 'function_call'],
    [{ namespace: 'mcp_beta', name: 'run', kind: 'function' }, '{}', 'function_call'],
  ];
  cases.forEach(([owner, args, type], index) => {
    const restored = restoreToolCall({ id: `call-${index}`, name: wireName(compiled, owner), arguments: args }, compiled);
    assert.equal(restored.type, type);
    assert.equal(restored.name, 'run');
    assert.equal(restored.namespace, owner.namespace || undefined);
  });
});

test('custom functions.exec and patch inputs preserve exact JSON, code, and multiline text', () => {
  const compiled = compileRequest(request({ tools: [
    { type: 'custom', name: 'exec', description: 'orchestrator', format: { type: 'text' } },
    { type: 'custom', name: 'apply_patch', description: 'patches files' },
  ] }));
  const execInput = '// @exec: {"yield_time_ms": 10000}\nconst source = `a\\n${value}`;\ntext(source);\n';
  const patchInput = '*** Begin Patch\n*** Update File: note.txt\n@@\n-old\n+new  \\t\n*** End Patch\n';

  const restoredExec = restoreToolCall({
    id: 'exec-1', name: wireName(compiled, { namespace: '', name: 'exec', kind: 'custom' }),
    arguments: JSON.stringify({ input: execInput }),
  }, compiled);
  const restoredPatch = restoreToolCall({
    id: 'patch-1', name: wireName(compiled, { namespace: '', name: 'apply_patch', kind: 'custom' }),
    arguments: JSON.stringify({ input: patchInput }),
  }, compiled);

  assert.equal(restoredExec.input, execInput);
  assert.equal(restoredPatch.input, patchInput);
});

test('MCP function and plaintext azrael_agents custom calls retain namespace, kind, and payload', () => {
  const compiled = compileRequest(request({ tools: [
    { type: 'namespace', name: 'mcp_files', tools: [
      { type: 'function', name: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
    ] },
    { type: 'namespace', name: 'azrael_agents', tools: [
      { type: 'custom', name: 'send_message', description: 'plain text contract' },
    ] },
  ] }));
  const mcpArgs = '{"path":"C:\\\\work\\\\한글.txt"}';
  const agentText = 'target: /root/child\nmessage: preserve this: {"x":1}\n';

  const mcp = restoreToolCall({ id: 'mcp-1', name: wireName(compiled, { namespace: 'mcp_files', name: 'read', kind: 'function' }), arguments: mcpArgs }, compiled);
  const agent = restoreToolCall({ id: 'agent-1', name: wireName(compiled, { namespace: 'azrael_agents', name: 'send_message', kind: 'custom' }), arguments: JSON.stringify({ input: agentText }) }, compiled);
  assert.deepEqual(mcp, { type: 'function_call', call_id: 'mcp-1', name: 'read', namespace: 'mcp_files', arguments: mcpArgs });
  assert.deepEqual(agent, { type: 'custom_tool_call', call_id: 'agent-1', name: 'send_message', namespace: 'azrael_agents', input: agentText });
});

test('split arguments are joined before validation and emitted only at clean finish', async () => {
  const compiled = compileRequest(request({ tools: [
    { type: 'function', name: 'shell', parameters: { type: 'object' } },
  ] }));
  const name = wireName(compiled, { namespace: '', name: 'shell', kind: 'function' });
  const emitted = await captureStream([
    { kind: 'tool_call_start', id: 'call-1', name },
    { kind: 'tool_call_args', id: 'call-1', argsDelta: '{"command":' },
    { kind: 'tool_call_args', id: 'call-1', argsDelta: '"echo ok"}' },
    { kind: 'finish', reason: 'tool_calls' },
  ], compiled);
  const call = emitted.find(event => event.type === 'item_done' && event.item.type === 'function_call');
  assert.equal(call.item.arguments, '{"command":"echo ok"}');
  assert.equal(emitted.at(-1).type, 'completed');
});

test('undeclared, invalid JSON, and duplicate calls fail without emitting executable output', async t => {
  const makeCompiled = () => compileRequest(request({ parallel_tool_calls: true, tools: [
    { type: 'function', name: 'shell', parameters: { type: 'object' } },
  ] }));
  const cases = [
    ['undeclared', c => 'not-declared', '{"ok":true}', /undeclared_tool/],
    ['invalid JSON', c => wireName(c, { namespace: '', name: 'shell', kind: 'function' }), '{"unterminated":', /Unexpected end of JSON input|JSON/],
  ];
  for (const [label, getName, args, error] of cases) await t.test(label, async () => {
    const compiled = makeCompiled();
    const emitted = [];
    await assert.rejects(mapStream(events([
      { kind: 'tool_call_start', id: 'call-1', name: getName(compiled) },
      { kind: 'tool_call_args', id: 'call-1', argsDelta: args },
      { kind: 'finish', reason: 'tool_calls' },
    ]), compiled, event => emitted.push(event), 'req-1'), error);
    assert.equal(emitted.some(event => event.type === 'item_done' && /_call$/.test(event.item?.type)), false);
  });

  const compiled = makeCompiled();
  const name = wireName(compiled, { namespace: '', name: 'shell', kind: 'function' });
  await assert.rejects(captureStream([
    { kind: 'tool_call_start', id: 'same', name }, { kind: 'tool_call_args', argsDelta: '{}' },
    { kind: 'tool_call_start', id: 'same', name }, { kind: 'tool_call_args', argsDelta: '{}' },
    { kind: 'finish', reason: 'tool_calls' },
  ], compiled), /duplicate_call_id/);
});

test('EOF, provider truncation, and thrown provider errors never emit executable calls', async t => {
  const makeCompiled = () => compileRequest(request({ tools: [
    { type: 'function', name: 'shell', parameters: { type: 'object' } },
  ] }));
  async function verify(source, error) {
    const compiled = makeCompiled();
    const name = wireName(compiled, { namespace: '', name: 'shell', kind: 'function' });
    const emitted = [];
    await assert.rejects(mapStream(source(name), compiled, event => emitted.push(event), 'req-1'), error);
    assert.equal(emitted.some(event => event.type === 'item_done' && event.item?.type === 'function_call'), false);
    assert.equal(emitted.some(event => event.type === 'completed'), false);
  }
  await t.test('EOF after complete-looking call', () => verify(async function* (name) {
    yield { kind: 'tool_call_start', id: 'call-1', name };
    yield { kind: 'tool_call_args', argsDelta: '{}' };
  }, /provider_eof/));
  await t.test('explicit incomplete finish', () => verify(async function* (name) {
    yield { kind: 'tool_call_start', id: 'call-1', name };
    yield { kind: 'tool_call_args', argsDelta: '{}' };
    yield { kind: 'finish', reason: 'length' };
  }, /provider_incomplete/));
  await t.test('provider throws', () => verify(async function* (name) {
    yield { kind: 'tool_call_start', id: 'call-1', name };
    yield { kind: 'tool_call_args', argsDelta: '{}' };
    throw new Error('transport reset');
  }, /transport reset/));
});

test('parallel calls are rejected when disabled and retained in order when enabled', async () => {
  const tools = [{ type: 'function', name: 'shell', parameters: { type: 'object' } }];
  const disabled = compileRequest(request({ tools, parallel_tool_calls: false }));
  const disabledName = wireName(disabled, { namespace: '', name: 'shell', kind: 'function' });
  const pair = name => [
    { kind: 'tool_call_start', id: 'a', name }, { kind: 'tool_call_args', argsDelta: '{}' },
    { kind: 'tool_call_start', id: 'b', name }, { kind: 'tool_call_args', argsDelta: '{}' },
    { kind: 'finish', reason: 'tool_calls' },
  ];
  await assert.rejects(captureStream(pair(disabledName), disabled), /parallel_calls_disabled/);

  const enabled = compileRequest(request({ tools, parallel_tool_calls: true }));
  const emitted = await captureStream(pair(wireName(enabled, { namespace: '', name: 'shell', kind: 'function' })), enabled);
  assert.deepEqual(emitted.filter(event => event.item?.type === 'function_call').map(event => event.item.call_id), ['a', 'b']);
});

test('text streaming, reasoning, and monotonic usage map to canonical events', async () => {
  const emitted = await captureStream([
    { kind: 'reasoning', text: 'think ' },
    { kind: 'text', text: 'hello' },
    { kind: 'text', text: ' world' },
    { kind: 'usage', promptTokens: 10, completionTokens: 4, cachedInputTokens: 6, reasoningTokens: 2 },
    { kind: 'usage', promptTokens: 8, completionTokens: 5 },
    { kind: 'finish', reason: 'stop' },
  ]);
  assert.deepEqual(emitted.filter(event => event.type === 'text_delta').map(event => event.delta), ['hello', ' world']);
  const added = emitted.find(event => event.type === 'item_added');
  assert.deepEqual(added.item.content, [{ type: 'output_text', text: '' }]);
  assert.equal(added.item.id, emitted.find(event => event.type === 'item_done' && event.item?.type === 'message').item.id);
  assert.equal(emitted.find(event => event.type === 'item_done' && event.item?.type === 'message').item.content[0].text, 'hello world');
  assert.equal(emitted.find(event => event.item?.type === 'reasoning').item.summary[0].text, 'think ');
  assert.deepEqual(emitted.at(-1).usage, { input_tokens: 10, output_tokens: 5, cached_input_tokens: 6, reasoning_output_tokens: 2, total_tokens: 15 });
});

test('canonical call-result history replays with the same alias and call id on resume', () => {
  const tools = [
    { type: 'function', name: 'shell', parameters: { type: 'object' } },
    { type: 'custom', name: 'apply_patch' },
  ];
  const compiled = compileRequest(request({ tools, input: [
    { type: 'message', role: 'user', content: 'make the change' },
    { type: 'function_call', call_id: 'shell-1', name: 'shell', arguments: '{"command":"verify"}' },
    { type: 'function_call_output', call_id: 'shell-1', output: 'exit 0\nverified' },
    { type: 'custom_tool_call', call_id: 'patch-1', name: 'apply_patch', input: '*** patch ***\n' },
    { type: 'custom_tool_call_output', call_id: 'patch-1', output: [{ type: 'output_text', text: 'Done!' }] },
  ] }));
  const assistantCalls = compiled.messages.filter(message => message.role === 'assistant' && message.tool_calls);
  const results = compiled.messages.filter(message => message.role === 'tool');
  assert.equal(assistantCalls[0].tool_calls[0].name, wireName(compiled, { namespace: '', name: 'shell', kind: 'function' }));
  assert.equal(assistantCalls[1].tool_calls[0].name, wireName(compiled, { namespace: '', name: 'apply_patch', kind: 'custom' }));
  assert.deepEqual(results.map(result => [result.tool_call_id, result.content]), [['shell-1', 'exit 0\nverified'], ['patch-1', 'Done!']]);
  assert.throws(() => restoreToolCall({ id: 'shell-1', name: assistantCalls[0].tool_calls[0].name, arguments: '{}' }, compiled), /duplicate_call_id/);
});

test('encrypted arguments fail explicitly', () => {
  const base = { tools: [{ type: 'function', name: 'shell', parameters: { type: 'object' } }] };
  assert.throws(() => compileRequest(request({ ...base, input: [
    { type: 'function_call', call_id: 'a', name: 'shell', arguments: '{}', encrypted_function_args: 'secret' },
  ] })), /encrypted_tool_arguments_unsupported/);
});

test('user and tool-result images map to ordered transport parts and encode as ImageData', () => {
  const base = { tools: [{ type: 'function', name: 'view_image', parameters: { type: 'object' } }] };
  const compiled = compileRequest(request({ ...base, input: [
    { type: 'message', role: 'user', content: [
      { type: 'input_text', text: 'look' }, { type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'high' },
    ] },
    { type: 'function_call', call_id: 'v', name: 'view_image', arguments: '{}' },
    { type: 'function_call_output', call_id: 'v', output: [
      { type: 'input_text', text: 'loaded' }, { type: 'input_image', image_url: 'data:image/JPEG;base64,BBBB' },
    ] },
  ] }));
  assert.deepEqual(compiled.messages[0], { role: 'user', content: [
    { type: 'text', text: 'look' }, { type: 'image', mimeType: 'image/png', base64Data: 'AAAA' },
  ] });
  assert.deepEqual(compiled.messages[2], { role: 'tool', tool_call_id: 'v', content: [
    { type: 'text', text: 'loaded' }, { type: 'image', mimeType: 'image/jpeg', base64Data: 'BBBB' },
  ] });
  // Text-only content keeps the established string projection.
  const text = compileRequest(request({ input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'a' }, { type: 'input_text', text: 'b' }] }] }));
  assert.equal(text.messages[0].content, 'a\nb');

  const wire = buildNativeWire({ apiKey: 'synthetic-fixture', modelUid: compiled.model, cascadeId: 'thread-1',
    sessionId: 'fixture-session', requestId: 1n, triggerId: 'fixture-trigger', tools: compiled.tools, messages: compiled.messages });
  const prompts = [...iterFields(wire)].filter(field => field.num === 3);
  const images = prompts.map(prompt => [...iterFields(prompt.value)].filter(field => field.num === 10)
    .map(image => Object.fromEntries([...iterFields(image.value)].map(field => [field.num, field.value.toString()]))));
  assert.deepEqual(images, [[{ 1: 'AAAA', 2: 'image/png' }], [], [{ 1: 'BBBB', 2: 'image/jpeg' }]]);
});

test('remote, unsupported, malformed, misplaced and oversized images fail with enumerated codes', async () => {
  const { MAX_IMAGE_BYTES } = await import('../mapping.mjs');
  const user = image_url => request({ input: [{ type: 'message', role: 'user', content: [{ type: 'input_image', image_url }] }] });
  assert.throws(() => compileRequest(user('https://example.invalid/a.png')), /remote_image_unsupported/);
  assert.throws(() => compileRequest(user('data:image/svg+xml;base64,AAAA')), /unsupported_image_format/);
  assert.throws(() => compileRequest(user('data:image/png,AAAA')), /unsupported_image_format/);
  assert.throws(() => compileRequest(user('data:image/png;base64,A*A=')), /invalid_image_input/);
  assert.throws(() => compileRequest(request({ input: [
    { type: 'message', role: 'assistant', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AAAA' }] },
  ] })), /unsupported_nontext_content/);
  assert.throws(() => compileRequest(request({ input: [
    { type: 'message', role: 'user', content: [{ type: 'input_audio', audio_url: 'data:audio/wav;base64,AAAA' }, { type: 'input_image', image_url: 'data:image/png;base64,AAAA' }] },
  ] })), /unsupported_nontext_content/);
  const half = 'A'.repeat(MAX_IMAGE_BYTES / 2);
  assert.throws(() => compileRequest(request({ input: [{ type: 'message', role: 'user', content: [
    { type: 'input_image', image_url: `data:image/png;base64,${half}` }, { type: 'input_image', image_url: `data:image/png;base64,${half}AAAA` },
  ] }] })), /image_input_too_large/);
  // Image bytes do not count against the separate text context limit.
  const big = compileRequest(request({ input: [{ type: 'message', role: 'user', content: [{ type: 'input_image', image_url: `data:image/png;base64,${'A'.repeat(12 * 1024 * 1024)}` }] }] }));
  assert.equal(big.messages[0].content[0].base64Data.length, 12 * 1024 * 1024);
});

test('helper reports malformed JSON and frame-count errors as one structured terminal error', async t => {
  for (const [label, input, expected] of [
    ['malformed JSON', '{broken}\n{}\n', 'provider_failure'],
    ['one frame', JSON.stringify({ type: 'init', protocol_version: 1, request_id: 'r', credential: { api_key: 'placeholder' } }) + '\n', 'invalid_frame_count'],
  ]) await t.test(label, async () => {
    const result = await runHelper(input);
    assert.equal(result.code, 1);
    assert.equal(result.stderr, '');
    const frames = result.stdout.trimEnd().split('\n').map(JSON.parse);
    assert.equal(frames.length, 1);
    assert.deepEqual(frames[0], { protocol_version: 1, request_id: '', seq: 0, type: 'error', code: expected });
  });
});

test('helper rejects mismatched init/request ids before loading transport or using credentials', async () => {
  const init = { type: 'init', protocol_version: 1, request_id: 'wrong', credential: { api_key: 'placeholder' } };
  const req = request({ request_id: 'right' });
  const result = await runHelper(`${JSON.stringify(init)}\n${JSON.stringify(req)}\n`);
  assert.equal(result.code, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { protocol_version: 1, request_id: 'right', seq: 0, type: 'error', code: 'invalid_init' });
});

test('provider reasoning signature survives replay only for the same model and thread', async () => {
  const compiled = compileRequest(request());
  const emitted = await captureStream([
    { kind: 'reasoning', text: 'fixture reasoning' },
    { kind: 'reasoning_signature', signature: 'opaque-signature' },
    { kind: 'finish', reason: 'stop' },
  ], compiled);
  const item = emitted.find(event => event.item?.type === 'reasoning').item;
  const replay = compileRequest(request({ input: [item] }));
  assert.deepEqual(replay.messages, [{ role: 'assistant', content: '', thinking: 'fixture reasoning', signature: 'opaque-signature' }]);
  for (const selection of [{ thread_id: 'other-thread' }, { model: 'swe-2-medium' }, { credential_scope: 'different-account' }]) {
    assert.deepEqual(compileRequest(request({ ...selection, input: [item] })).messages,
      [{ role: 'assistant', content: '', thinking: 'fixture reasoning' }]);
  }
});

test('default functions namespace remains stable when native history makes it explicit', () => {
  const tools = [{ type: 'function', name: 'exec_command', parameters: { type: 'object' } }];
  const compiled = compileRequest(request({ tools, input: [
    { type: 'function_call', namespace: 'functions', name: 'exec_command', call_id: 'old', arguments: '{}' },
    { type: 'function_call_output', call_id: 'old', output: 'done' },
  ] }));
  assert.equal(compiled.messages[0].tool_calls[0].name, compiled.tools[0].name);
  assert.throws(() => compileRequest(request({ tools: [...tools, { type: 'namespace', name: 'functions', tools }] })), /duplicate_tool_identity/);
});

function reasoning(text, signature, scope = {}) {
  return {
    type: 'reasoning', summary: [{ type: 'summary_text', text }],
    ...(signature === undefined ? {} : { encrypted_content: 'azrael-devin-v1:' + Buffer.from(JSON.stringify({
      model: 'swe-2-high', thread: 'thread-1', signature, ...scope,
    })).toString('base64') }),
  };
}

const replayTools = [{ type: 'function', name: 'shell', parameters: { type: 'object' } }];
const replayCall = id => ({ type: 'function_call', name: 'shell', call_id: id, arguments: '{ "command": "verify\\nnext" }' });
const replayOutput = id => ({ type: 'function_call_output', call_id: id, output: `result ${id}` });
const replayText = text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });

test('native text then reasoning then parallel calls replay as one signed assistant prompt', () => {
  const compiled = compileRequest(request({ tools: replayTools, input: [
    replayText('checking'), reasoning('think', 'signature'), replayCall('a'), replayCall('b'), replayOutput('a'), replayOutput('b'),
  ] }));
  assert.deepEqual(compiled.messages, [
    { role: 'assistant', content: 'checking', thinking: 'think', signature: 'signature', tool_calls: [
      { id: 'a', name: compiled.tools[0].name, arguments: replayCall('a').arguments },
      { id: 'b', name: compiled.tools[0].name, arguments: replayCall('b').arguments },
    ] },
    { role: 'tool', tool_call_id: 'a', content: 'result a' },
    { role: 'tool', tool_call_id: 'b', content: 'result b' },
  ]);
});

test('reasoning-first and unsigned blocks preserve upstream newline and last provided signature semantics', () => {
  const compiled = compileRequest(request({ tools: replayTools, input: [
    reasoning('first', 'old'), replayText('one'), reasoning('second', 'last'),
    { type: 'additional_tools', tools: [] }, reasoning('third'), replayText(''), replayText('two\n'), replayCall('one'),
  ] }));
  assert.equal(compiled.messages.length, 1);
  assert.deepEqual(compiled.messages[0], { role: 'assistant', content: 'one\ntwo\n', thinking: 'first\nsecond\nthird', signature: 'last',
    tool_calls: [{ id: 'one', name: compiled.tools[0].name, arguments: replayCall('one').arguments }] });
  assert.deepEqual(compileRequest(request({ input: [reasoning('unsigned'), replayText('answer')] })).messages,
    [{ role: 'assistant', content: 'answer', thinking: 'unsigned' }]);
});

test('user, system, developer, agent, and tool results end assistant coalescing', () => {
  const boundaries = [
    ...['user', 'system', 'developer'].map(role => ({ type: 'message', role, content: 'boundary' })),
    { type: 'agent_message', author: 'child', recipient: 'root', content: 'boundary' },
  ];
  for (const boundary of boundaries) {
    const compiled = compileRequest(request({ input: [reasoning('before', 'sig'), replayText('first'), boundary, replayText('next'), reasoning('after')] }));
    assert.deepEqual(compiled.messages.map(message => message.role), ['assistant', boundary.role === 'system' || boundary.role === 'developer' ? 'system' : 'user', 'assistant']);
    assert.equal(compiled.messages[2].signature, undefined);
    assert.equal(compiled.messages[2].thinking, 'after');
  }
  const compiled = compileRequest(request({ tools: replayTools, input: [
    reasoning('before', 'sig'), replayCall('a'), replayOutput('a'), replayText('next'), replayCall('b'), replayOutput('b'),
  ] }));
  assert.deepEqual(compiled.messages.map(message => message.role), ['assistant', 'tool', 'assistant', 'tool']);
  assert.equal(compiled.messages[2].signature, undefined);
  assert.deepEqual(compiled.messages[2].tool_calls.map(call => call.id), ['b']);
});

test('tool search and custom replay share assistant fields and retain exact wrappers and result boundaries', () => {
  const input = 'line 1\n`code`\n';
  const compiled = compileRequest(request({ tools: [
    { type: 'custom', name: 'exec' }, { type: 'tool_search', execution: 'client', parameters: { type: 'object' } },
  ], input: [
    replayText('search'), reasoning('plan'),
    { type: 'tool_search_call', call_id: 's', execution: 'client', arguments: { query: 'tools' } },
    { type: 'additional_tools', tools: [] },
    { type: 'custom_tool_call', name: 'exec', call_id: 'c', input },
    { type: 'tool_search_output', execution: 'client', call_id: 's', status: 'completed', tools: [] },
    { type: 'custom_tool_call_output', call_id: 'c', output: 'done' }, replayText('after'),
  ] }));
  assert.deepEqual(compiled.messages.map(message => message.role), ['assistant', 'tool', 'tool', 'assistant']);
  assert.deepEqual(compiled.messages[0].tool_calls, [
    { id: 's', name: compiled.tools[1].name, arguments: '{"query":"tools"}' },
    { id: 'c', name: compiled.tools[0].name, arguments: JSON.stringify({ input }) },
  ]);
  assert.equal(compiled.messages[0].thinking, 'plan');
});

test('coalescing preserves call validation and projects signatures by scope', () => {
  assert.throws(() => compileRequest(request({ tools: replayTools, input: [replayCall('a'), replayCall('a')] })), /duplicate_history_call_id/);
  assert.throws(() => compileRequest(request({ tools: replayTools, input: [replayOutput('missing')] })), /orphan_or_duplicate_tool_result/);
  assert.throws(() => compileRequest(request({ tools: replayTools, input: [replayCall('a'), replayOutput('a'), replayOutput('a')] })), /orphan_or_duplicate_tool_result/);
  for (const scope of [{ model: 'swe-2-medium' }, { thread: 'other' }, { account: 'other' }]) {
    const input = [replayText('before'), reasoning('foreign', 'private', scope), reasoning('valid', 'valid')];
    const original = structuredClone(input);
    assert.deepEqual(compileRequest(request({ input })).messages,
      [{ role: 'assistant', content: 'before', thinking: 'foreign\nvalid', signature: 'valid' }]);
    assert.deepEqual(input, original);
  }
});

test('cross-provider history retains text and tool results without replaying private reasoning', () => {
  for (const opaque of ['openai-encrypted', 'azrael-managed-v1:foreign']) {
    const input = [
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'public summary' }], encrypted_content: opaque },
      replayCall('previous'), replayOutput('previous'),
    ];
    const before = structuredClone(input);
    const compiled = compileRequest(request({ tools: replayTools, input }));
    assert.equal(compiled.messages[0].thinking, 'public summary');
    assert.equal(compiled.messages[0].signature, undefined);
    assert.equal(compiled.messages[0].tool_calls[0].id, 'previous');
    assert.equal(compiled.messages[1].tool_call_id, 'previous');
    assert.deepEqual(input, before);
  }
});

test('native model validation accepts bounded UIDs independently of provider availability', () => {
  for (const model of ['swe-2-medium', 'swe-2-high', 'swe-2-max', 'gpt-5-6-sol-medium-priority']) {
    assert.equal(compileRequest(request({ model })).model, model);
  }
  for (const model of [undefined, null, 2, {}, '', '   ', 'x'.repeat(257), 'swe-2-high\n', 'model\x00', 'model\x7f', 'model\x85']) {
    assert.throws(() => compileRequest(request({ model })), /unsupported_native_model/);
  }
});

test('synthetic native replay bytes equal original grouped upstream history and keep thinking/signature/calls together', async t => {
  // The original checkout retains .js specifiers for TS source. Resolve only
  // its import closure in memory; never patch or build the frozen source.
  const originalRoot = new URL('../../opencodex/vendor/src/', import.meta.url).href;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.startsWith(originalRoot) && specifier.startsWith('.') && specifier.endsWith('.js')) {
        return nextResolve(specifier.slice(0, -3) + '.ts', context);
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      const errors = {
        'chat.ts': ['CloudChatError', 3], 'auth.ts': ['CloudAuthError', 1], 'catalog.ts': ['ModelNotAvailableError', 3],
      };
      const error = errors[url.slice(url.lastIndexOf('/') + 1)];
      if (url.startsWith(originalRoot + 'adapters/devin/cloud-direct/') && error) {
        // Node 26 strips TS but cannot load upstream's error-class parameter
        // properties. Lower only that class in memory; keep every encoder
        // byte unchanged and never write a transformed upstream file.
        const source = loaded.source.toString();
        const [className, propertyCount] = error;
        const start = source.indexOf(`export class ${className} extends Error {`);
        const end = source.indexOf('\n}', start) + 2;
        assert.ok(start >= 0 && end > start);
        const originalClass = source.slice(start, end);
        const properties = [...originalClass.matchAll(/public readonly (\w+)/g)].map(match => match[1]);
        assert.equal(properties.length, propertyCount);
        const nameStatement = `this.name = '${className}';`;
        assert.ok(originalClass.includes(nameStatement));
        const loweredClass = originalClass.replace(/public readonly /g, '')
          .replace(nameStatement, nameStatement + properties.map(name => ` this.${name} = ${name};`).join(''));
        assert.notEqual(loweredClass, originalClass);
        return { ...loaded, source: source.slice(0, start) + loweredClass + source.slice(end) };
      }
      return loaded;
    },
  });
  let buildOriginalWire;
  try {
    ({ buildGetChatMessageRequestForTests: buildOriginalWire } = await import('../../opencodex/vendor/src/adapters/devin/cloud-direct/chat.ts'));
  } finally { hooks.deregister(); }
  const uuid = t.mock.method(crypto, 'randomUUID', () => '00000000-0000-4000-8000-000000000001');
  const fingerprint = t.mock.method(crypto, 'randomBytes', size => Buffer.alloc(size, 1));
  t.mock.method(globalThis, 'fetch', () => { assert.fail('wire comparison must not access network'); });
  syncBuiltinESMExports();
  try {
    const compiled = compileRequest(request({ tools: replayTools, input: [
      { type: 'message', role: 'user', content: 'task' }, replayText('checking'), reasoning('think', 'signature'),
      replayCall('a'), replayCall('b'), replayOutput('a'), replayOutput('b'),
    ] }));
    const fixed = { apiKey: 'synthetic-fixture', modelUid: compiled.model, cascadeId: 'thread-1',
      sessionId: 'fixture-session', requestId: 1n, triggerId: 'fixture-trigger', tools: compiled.tools };
    const actual = buildNativeWire({ ...fixed, messages: compiled.messages });
    const expected = buildOriginalWire({ ...fixed, messages: [
      { role: 'user', content: 'task' },
      { role: 'assistant', content: 'checking', thinking: 'think', signature: 'signature', tool_calls: [
        { id: 'a', name: compiled.tools[0].name, arguments: replayCall('a').arguments },
        { id: 'b', name: compiled.tools[0].name, arguments: replayCall('b').arguments },
      ] },
      { role: 'tool', tool_call_id: 'a', content: 'result a' }, { role: 'tool', tool_call_id: 'b', content: 'result b' },
    ] });
    assert.deepEqual(actual, expected);
    const prompts = [...iterFields(actual)].filter(field => field.num === 3);
    assert.equal(prompts.length, 4);
    const assistantFields = [...iterFields(prompts[1].value)];
    assert.equal(assistantFields.filter(field => field.num === 6).length, 2);
    assert.equal(assistantFields.find(field => field.num === 11).value.toString(), 'think');
    assert.equal(assistantFields.find(field => field.num === 12).value.toString(), 'signature');
  } finally {
    uuid.mock.restore(); fingerprint.mock.restore(); syncBuiltinESMExports();
  }
});

test('provider_incomplete diagnostics preserve cause on both finish branches', async t => {
  const makeCompiled = () => compileRequest(request({ tools: [
    { type: 'function', name: 'shell', parameters: { type: 'object' } },
  ] }));
  await t.test('rejected finish mid tool call reports active call and stop reason', async () => {
    const compiled = makeCompiled();
    const name = wireName(compiled, { namespace: '', name: 'shell', kind: 'function' });
    await assert.rejects(mapStream(events([
      { kind: 'tool_call_start', id: 'call-1', name },
      { kind: 'tool_call_args', argsDelta: '{"command":' },
      { kind: 'finish', reason: 'length', providerStopReason: 3 },
    ]), compiled, () => {}, 'req-1'), error => {
      assert.equal(error.message, 'provider_incomplete');
      assert.deepEqual(error.diagnostics, {
        event_count: 3, last_event: 'finish', finish_reason: 'length',
        provider_stop_reason: 3, pending_tool_count: 0, active_tool_call: true,
      });
      return true;
    });
  });
  await t.test('tool_calls finish without a call reports zero pending', async () => {
    await assert.rejects(mapStream(events([
      { kind: 'text', text: 'hi' },
      { kind: 'finish', reason: 'tool_calls', providerStopReason: 10 },
    ]), makeCompiled(), () => {}, 'req-1'), error => {
      assert.equal(error.message, 'provider_incomplete');
      assert.deepEqual(error.diagnostics, {
        event_count: 2, last_event: 'finish', finish_reason: 'tool_calls',
        provider_stop_reason: 10, pending_tool_count: 0, active_tool_call: false,
      });
      return true;
    });
  });
  await t.test('rejected finish reports one buffered call and one still active', async () => {
    const compiled = compileRequest(request({ parallel_tool_calls: true, tools: [
      { type: 'function', name: 'shell', parameters: { type: 'object' } },
    ] }));
    const name = wireName(compiled, { namespace: '', name: 'shell', kind: 'function' });
    await assert.rejects(mapStream(events([
      { kind: 'tool_call_start', id: 'call-1', name },
      { kind: 'tool_call_args', argsDelta: '{}' },
      { kind: 'tool_call_start', id: 'call-2', name },
      { kind: 'tool_call_args', argsDelta: '{"command":' },
      { kind: 'finish', reason: 'content_filter', providerStopReason: 11 },
    ]), compiled, () => {}, 'req-1'), error => {
      assert.equal(error.message, 'provider_incomplete');
      assert.equal(error.diagnostics.pending_tool_count, 1);
      assert.equal(error.diagnostics.active_tool_call, true);
      assert.equal(error.diagnostics.finish_reason, 'content_filter');
      assert.equal(error.diagnostics.provider_stop_reason, 11);
      return true;
    });
  });
});

test('provider_incomplete diagnostics drop invalid or sensitive values', async () => {
  for (const finish of [
    { kind: 'finish', reason: 'length', providerStopReason: 99 },
    { kind: 'finish', reason: 'length', providerStopReason: -1 },
    { kind: 'finish', reason: 'length', providerStopReason: 'SECRET-text' },
    { kind: 'finish', reason: 'length', providerStopReason: 3.5 },
    { kind: 'finish', reason: 'SECRET provider message https://internal.example' },
  ]) {
    await assert.rejects(mapStream(events([finish]), compileRequest(request()), () => {}, 'req-1'), error => {
      assert.equal(error.message, 'provider_incomplete');
      const serialized = JSON.stringify(error.diagnostics);
      assert.equal(serialized.includes('SECRET'), false);
      assert.equal(serialized.includes('internal.example'), false);
      assert.equal(error.diagnostics.provider_stop_reason, undefined);
      if (finish.reason.startsWith('SECRET')) assert.equal(error.diagnostics.finish_reason, undefined);
      return true;
    });
  }
});

test('model catalog parser reads supports_images field #5 without changing other fields', async () => {
  const { parseCatalogBuffer } = await import('../vendor/src/adapters/devin/cloud-direct/catalog.ts');
  const { encodeMessage, encodeString, encodeVarintField } = await import('../vendor/src/adapters/devin/cloud-direct/wire.ts');
  const config = (uid, images) => encodeMessage(1, Buffer.concat([
    encodeString(1, uid.toUpperCase()), ...(images ? [encodeVarintField(5, 1)] : []), encodeVarintField(18, 1000), encodeString(22, uid),
  ]));
  const entry = parseCatalogBuffer(Buffer.concat([config('vision-model', true), config('text-model', false)]), 'key', 'host');
  assert.deepEqual([...entry.byUid.values()].map(({ modelUid, supportsImages, contextWindow, disabled }) => ({ modelUid, supportsImages, contextWindow, disabled })), [
    { modelUid: 'vision-model', supportsImages: true, contextWindow: 1000, disabled: false },
    { modelUid: 'text-model', supportsImages: false, contextWindow: 1000, disabled: false },
  ]);
});
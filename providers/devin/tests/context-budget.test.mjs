import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContextDiagnostics } from '../context-budget.mjs';
import { createProgressMonitor } from '../progress.mjs';
import { spawnSync } from 'node:child_process';
import { projectCloudInput } from '../vendor/src/adapters/devin/cloud-direct/chat.ts';

test('counts projected text once and never includes cache tokens again', () => {
  const context = createContextDiagnostics('private-model');
  context.compiled({ tools: [{ name: 'tool', parameters: { type: 'object' } }], messages: [
    { role: 'system', content: 'instructions' }, { role: 'user', content: '한글 text' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'private-id', name: 'tool', arguments: '{}' }] },
    { role: 'tool', content: 'private-result' },
  ] });
  const before = context.snapshot();
  assert.equal(before.components.instructions.count, 1);
  assert.equal(before.components.tool_definitions.count, 1);
  assert.equal(before.components.tool_results.count, 1);
  assert.equal(before.components.tool_calls.count, 1);
  assert.equal(before.text_estimate_tokens, Object.values(before.components).reduce((sum, c) => sum + c.tokens, 0));
  context.usage({ input_tokens: 100, cached_input_tokens: 70, cache_write_input_tokens: 10 });
  const evidence = context.snapshot();
  assert.equal(evidence.reported_input_tokens, 100);
  assert.equal(evidence.residual_tokens, 100 - before.text_estimate_tokens);
  assert.equal(context.budget().supported, true);
  const text = JSON.stringify(evidence);
  for (const secret of ['private-model', 'private-id', 'private-result']) assert.ok(!text.includes(secret));
});

test('wire projection counts Anthropic and Gemini final schemas, text and images separately', () => {
  const context = createContextDiagnostics('model', text => text.length, 'model_chars');
  for (const body of [
    { system: [{ type: 'text', text: 'sys' }], tools: [{ name: 'tool' }], messages: [{ role: 'user', content: [
      { type: 'text', text: 'hello' }, { type: 'image', source: { data: 'SECRET-image', type: 'base64' } },
    ] }] },
    { request: { systemInstruction: { parts: [{ text: 'sys' }] }, tools: [{ functionDeclarations: [{ name: 'tool' }] }],
      contents: [{ role: 'user', parts: [{ text: 'hello' }, { inlineData: { data: 'SECRET-image' } }] }] } },
  ]) {
    context.wire(body);
    const evidence = context.snapshot();
    assert.equal(evidence.components.instructions.tokens, 3);
    assert.equal(evidence.components.conversation.tokens, 5);
    assert.equal(evidence.image_count, 1);
    assert.equal(context.budget().supported, false);
    assert.ok(evidence.text_estimate_tokens < evidence.wire_bytes);
    assert.ok(!JSON.stringify(evidence).includes('SECRET'));
  }
});

test('unknown parts and estimated usage do not manufacture a complete estimate or residual', () => {
  const context = createContextDiagnostics('model');
  context.wire({ messages: [{ role: 'assistant', content: [{ type: 'redacted_thinking', data: 'private' }] }] });
  assert.equal(context.budget().supported, false);
  context.usage({ input_tokens: 3, estimated: true });
  assert.equal(context.snapshot().reported_input_estimated, true);
  assert.equal(context.snapshot().residual_tokens, undefined);
});

test('observer snapshots are isolated and existing progress channel carries only numeric evidence', () => {
  const context = createContextDiagnostics('model'); context.compiled({ messages: [{ role: 'user', content: 'secret' }] });
  const monitor = createProgressMonitor(() => {}, { contextDiagnostics: context });
  try {
    const first = monitor.snapshot(); first.context_diagnostics.components.conversation.bytes = 999;
    assert.equal(monitor.snapshot().context_diagnostics.components.conversation.bytes, 6);
    assert.ok(!JSON.stringify(monitor.snapshot()).includes('secret'));
  } finally { monitor.stop(); }
});

test('Devin estimate uses serializer system folding and description limits without generation', () => {
  const messages = [{ role: 'system', content: 'private-instructions' }, { role: 'user', content: 'hello' }];
  const tools = [{ name: 'lookup', description: 'x'.repeat(12000), parameters: { type: 'object' } }];
  const before = JSON.stringify({ messages, tools });
  const projected = projectCloudInput(messages, tools);
  assert.equal(projected.messages.length, 1);
  assert.ok(projected.messages[0].content[0].text.includes('<system>\nprivate-instructions'));
  assert.ok(projected.tools[0].description.length < 7000);
  assert.equal(JSON.stringify({ messages, tools }), before);
  const requestId = 'fixture';
  const init = { type: 'init', protocol_version: 1, request_id: requestId,
    credential: { api_key: 'SECRET-credential', api_server_url: 'https://unreachable.invalid' } };
  const request = { type: 'estimate', protocol_version: 1, request_id: requestId, model: 'model', thread_id: 'thread', turn_id: 'turn',
    instructions: 'private-instructions', input: [{ type: 'message', role: 'user', content: 'hello' }], tools: [], parallel_tool_calls: true };
  const result = spawnSync(process.execPath, ['providers/devin/helper.mjs'], { input: JSON.stringify(init) + '\n' + JSON.stringify(request) + '\n', encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const frames = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].type, 'input_budget');
  assert.equal(frames[0].input_budget.supported, true);
  assert.ok(frames[0].input_budget.input_tokens > 0);
  assert.ok(!result.stdout.includes('SECRET') && !result.stdout.includes('private-instructions'));
});

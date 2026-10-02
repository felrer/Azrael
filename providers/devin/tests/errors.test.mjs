import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyProviderDenial, extractErrorFields, providerDiagnostics } from '../vendor/src/adapters/devin/cloud-direct/errors.ts';
import { streamChatEvents } from '../vendor/src/adapters/devin/cloud-direct/chat.ts';

test('provider reasons match only complete safe templates independently of denial classification', () => {
  for (const [message, reason] of [
    ['an internal error occurred', 'internal_error'],
    ['prompt is too long: 123 tokens > 100 maximum.', 'context_limit'],
    ['maximum context length exceeded', 'context_limit'],
    ['invalid thinking signature', 'invalid_thinking_signature'],
    ['invalid reasoning signature.', 'invalid_thinking_signature'],
    ['missing tool result', 'missing_tool_result'], ['missing tool use.', 'missing_tool_use'],
    ['invalid request', 'invalid_request'], ['invalid argument.', 'invalid_request'],
    ['Quota exceeded', 'usage_limit'], ['Too many requests', 'rate_limit'],
    [undefined, 'message_missing'], ['', 'message_missing'],
    ['quoted "an internal error occurred"', 'unrecognized_message'],
    ['invalid request https://internal.example/raw-prompt', 'unrecognized_message'],
    ['prompt is too long: 1234567890123 tokens > 1 maximum', 'unrecognized_message'],
    ['invalid request\n', 'unrecognized_message'],
    ['an internal error occurred (trace ID: abc)', 'unrecognized_message'],
    [`an internal error occurred (trace ID: ${'a'.repeat(65)})`, 'unrecognized_message'],
    ['an internal error occurred (trace ID: 0123456789abcdef) decoration', 'unrecognized_message'],
  ]) {
    assert.deepEqual(providerDiagnostics('connect_trailer', { code: 'invalid_argument', message }), {
      provider_error_source: 'connect_trailer', provider_error_code: 'invalid_argument', provider_reason: reason,
    });
  }
  for (const prefix of ['trace', 'cloud trace']) {
    assert.deepEqual(providerDiagnostics('http_response', { code: 'permission_denied',
      message: `an internal error occurred (${prefix} ID: 0123456789abcdef)` }), {
      provider_error_source: 'http_response', provider_error_code: 'permission_denied',
      provider_reason: 'internal_error', provider_trace_id: '0123456789abcdef',
    });
  }
  for (const traceId of ['a'.repeat(65), 'ABCDEF0123456789', '0123456789abcdef\n', 'synthetic-test-key']) {
    assert.equal(providerDiagnostics('http_response', { traceId }).provider_trace_id, undefined);
  }
  assert.equal(providerDiagnostics('http_response', { trace_id: 'a'.repeat(64) }).provider_trace_id, 'a'.repeat(64));
  assert.equal(providerDiagnostics('http_response', { code: 'synthetic-test-key' }).provider_error_code, 'unknown');
  assert.deepEqual(providerDiagnostics('connect_trailer', { code: 'invalid_argument',
    message: `${' '.repeat(16 * 1024)}an internal error occurred (trace ID: 0123456789abcdef)` }), {
    provider_error_source: 'connect_trailer', provider_error_code: 'invalid_argument',
    provider_reason: 'unrecognized_message',
  });
});

test('usage classification requires exact codes or anchored denial templates', () => {
  for (const code of ['usage_limit_reached', 'quota_exceeded', 'insufficient_quota']) {
    assert.equal(classifyProviderDenial({ code }), 'usage_limit');
  }
  for (const message of ['Your limit will reset in 13 minutes',
    'Your limit will reset in 1 hour.', 'Quota exceeded', 'Out of credits',
    'You have run out of credits (trace ID: abc123)']) {
    assert.equal(classifyProviderDenial({ code: 'permission_denied', message }), 'usage_limit', message);
  }
  // Same templates outside a denial envelope are not evidence.
  assert.equal(classifyProviderDenial({ code: 'internal', message: 'Quota exceeded' }), undefined);
  // Quoted or negated mentions are not evidence.
  for (const message of ['docs say "Quota exceeded" but this is an ACL denial',
    'not out of credits', 'Your limit will reset soon']) {
    assert.equal(classifyProviderDenial({ code: 'permission_denied', message }), undefined, message);
  }
});

test('rate-limit classification requires exact codes, anchored templates, or a bare 429', () => {
  for (const code of ['rate_limit_exceeded', 'rate_limited', 'too_many_requests']) {
    assert.equal(classifyProviderDenial({ code }), 'rate_limit');
  }
  for (const message of ['Rate limit exceeded', 'Too many requests',
    'Reached overall message rate limit']) {
    assert.equal(classifyProviderDenial({ code: 'permission_denied', message }), 'rate_limit', message);
  }
  assert.equal(classifyProviderDenial({ status: 429 }), 'rate_limit', 'bare HTTP 429');
  // Negated/quoted phrases and coded non-denials stay unclassified.
  assert.equal(classifyProviderDenial({ code: 'permission_denied', message: 'This is not a rate limit' }), undefined);
  assert.equal(classifyProviderDenial({ code: 'permission_denied', message: 'see "rate limit exceeded" docs' }), undefined);
  // A 429 synthesized from a generic code is not rate-limit evidence.
  assert.equal(classifyProviderDenial({ status: 429, code: 'resource_exhausted' }), undefined);
  assert.equal(classifyProviderDenial({ code: 'resource_exhausted', message: 'generic exhaustion' }), undefined);
});

test('extractErrorFields consults a single envelope and never mixes root with .error', () => {
  assert.deepEqual(extractErrorFields({ error: { code: 'quota_exceeded', message: 'cap' } }),
    { code: 'quota_exceeded', message: 'cap' });
  assert.deepEqual(extractErrorFields({ code: 'internal', message: 'boom' }),
    { code: 'internal', message: 'boom' });
  assert.deepEqual(extractErrorFields({ error: { type: 'insufficient_quota' } }),
    { code: 'insufficient_quota', message: undefined });
  // .error present but malformed: root fields must not leak through.
  for (const bad of ['denied', 42, null, []]) {
    assert.deepEqual(extractErrorFields({ error: bad, code: 'usage_limit_reached', message: 'cap' }),
      { code: undefined, message: undefined });
  }
  // .error present but partial: root does not fill the gaps.
  assert.deepEqual(extractErrorFields({ error: { message: 'cap' }, code: 'usage_limit_reached' }),
    { code: undefined, message: 'cap' });
  for (const bad of [undefined, null, 'x', 42, []]) {
    assert.deepEqual(extractErrorFields(bad), {});
  }
});

test('pre-aborted caller signal does not stall the bounded error-body read', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream({ start() {} }), { status: 429 });
  try {
    const started = Date.now();
    await assert.rejects(async () => {
      for await (const event of streamChatEvents({
        apiKey: 'synthetic-key', apiServerUrl: 'https://server.codeium.com',
        modelUid: 'gpt-6-astra-low', messages: [{ role: 'user', content: 'x' }],
        tools: [], signal: AbortSignal.abort(), skipCatalogPreflight: true,
      })) void event;
    }, /HTTP 429/);
    assert(Date.now() - started < 5_000, 'pre-aborted signal must not hang the read');
  } finally {
    globalThis.fetch = original;
  }
});

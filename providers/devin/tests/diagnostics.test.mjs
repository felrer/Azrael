import assert from 'node:assert/strict';
import { test } from 'node:test';
import { httpStatus, providerClassificationCode, safeProviderDiagnostics, transportErrorCode } from '../diagnostics.mjs';
import { AdapterError } from '../mapping.mjs';

test('provider diagnostics independently revalidate all fields and discard arbitrary content', () => {
  const secret = 'synthetic-test-key';
  assert.deepEqual(safeProviderDiagnostics({ providerDiagnostics: {
    provider_error_code: secret, provider_reason: secret, provider_error_source: secret,
    provider_trace_id: secret, message: secret, stack: secret, url: secret,
  } }), { provider_error_code: 'unknown' });
  assert.deepEqual(safeProviderDiagnostics({ providerDiagnostics: {
    provider_error_code: 'invalid_argument', provider_reason: 'internal_error',
    provider_error_source: 'connect_trailer', provider_trace_id: '0123456789abcdef',
  } }), { provider_error_code: 'invalid_argument', provider_reason: 'internal_error',
    provider_error_source: 'connect_trailer', provider_trace_id: '0123456789abcdef' });
  for (const trace of ['a'.repeat(65), '0123456789abcdef\n', 'ABCDEF0123456789']) {
    assert.deepEqual(safeProviderDiagnostics({ providerDiagnostics: { provider_trace_id: trace } }), {});
  }
  assert.deepEqual(safeProviderDiagnostics(new Error(secret)), {});
  const hexCredential = '0123456789abcdef0123456789abcdef';
  for (const trace of [hexCredential, `aa${hexCredential}bb`]) {
    assert.deepEqual(safeProviderDiagnostics({ providerDiagnostics: {
      provider_trace_id: trace, provider_reason: 'internal_error',
    } }, hexCredential), { provider_reason: 'internal_error' });
    assert.equal(safeProviderDiagnostics({ providerDiagnostics: { provider_trace_id: trace } }).provider_trace_id, trace);
  }
});

test('known transport error codes map to the allowlist', () => {
  for (const code of ['headers_timeout', 'stream_idle_timeout', 'truncated_stream',
    'invalid_trailer', 'provider_error', 'cancelled', 'reader_failure']) {
    assert.equal(transportErrorCode({ code }), code);
  }
});

test('coded errors outside the known set classify as other, never reader_failure', () => {
  for (const code of ['invalid_frame', 'frame_too_large', 'invalid_finish',
    'permission_denied', 'unavailable', 'unrecognized_upstream_code']) {
    assert.equal(transportErrorCode({ code }), 'other');
  }
});

test('errors without a code leave transport_error unset', () => {
  assert.equal(transportErrorCode(new Error('boom')), undefined);
  assert.equal(transportErrorCode({}), undefined);
  assert.equal(transportErrorCode({ code: '' }), undefined);
  assert.equal(transportErrorCode({ code: 42 }), undefined);
  assert.equal(transportErrorCode(new AdapterError('provider_eof')), undefined);
});

test('classification never records messages, stacks, URLs or payloads', () => {
  const error = new Error('SECRET provider text https://internal.example/x?key=SECRET');
  error.code = 'weird_provider_code_SECRET';
  error.stack = 'SECRET stack trace';
  const result = transportErrorCode(error);
  assert.equal(result, 'other');
  assert(!JSON.stringify(result).includes('SECRET'));
});

test('http_status accepts only numeric 100..599 status', () => {
  assert.equal(httpStatus({ status: 504 }), 504);
  assert.equal(httpStatus({ status: 100 }), 100);
  assert.equal(httpStatus({ status: 599 }), 599);
  for (const bad of [99, 600, 0, -1, 200.5, '503', NaN, undefined]) {
    assert.equal(httpStatus({ status: bad }), undefined);
  }
});

test('provider classifications require explicit allowlisted cause evidence', () => {
  for (const [classification, codes] of [
    ['usage_limit', ['usage_limit_reached', 'quota_exceeded', 'insufficient_quota']],
    ['rate_limit', ['rate_limit_exceeded', 'rate_limited', 'too_many_requests']],
  ]) {
    const expected = `provider_${classification}`;
    assert.equal(providerClassificationCode({ classification,
      providerDiagnostics: { provider_reason: classification } }), expected);
    for (const code of codes) {
      assert.equal(providerClassificationCode({ classification,
        providerDiagnostics: { provider_error_code: code } }), expected);
    }
    for (const providerDiagnostics of [undefined, null, [], {},
      { provider_error_code: 'resource_exhausted' },
      { provider_reason: 'message_missing' },
      { provider_error_code: 'SECRET', provider_reason: 'SECRET' },
      { provider_error_code: `${codes[0]} SECRET` },
      { provider_error_code: codes[0].toUpperCase() },
      { provider_reason: `${classification} SECRET` },
      { provider_reason: 'unrecognized_message', message: classification },
      { provider_error_code: 429, provider_reason: [classification] },
    ]) {
      assert.equal(providerClassificationCode({ classification, status: 429, providerDiagnostics,
        message: `${classification}: too many requests quota exceeded`,
        stack: 'SECRET', body: { error: { code: codes[0] } } }), undefined);
    }
  }
  assert.equal(providerClassificationCode({ classification: 'rate_limit',
    providerDiagnostics: { provider_error_code: 'quota_exceeded', provider_reason: 'usage_limit' } }), undefined);
  assert.equal(providerClassificationCode({ classification: 'usage_limit',
    providerDiagnostics: { provider_error_code: 'too_many_requests', provider_reason: 'rate_limit' } }), undefined);
  for (const classification of [undefined, null, 429, 'SECRET', 'usage_limit!', 'rate_limit_error']) {
    assert.equal(providerClassificationCode({ classification,
      providerDiagnostics: { provider_reason: 'rate_limit', provider_error_code: 'quota_exceeded' } }), undefined);
  }
});

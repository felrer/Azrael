// Preloaded into the helper subprocess via `node --import` to replace network
// access with a synthetic Connect transport. HELPER_TEST_MODE selects the
// scenario; no real provider request is ever made.
import { encodeString, encodeVarintField, frameConnectStream } from '../../vendor/src/adapters/devin/cloud-direct/wire.ts';

const mode = process.env.HELPER_TEST_MODE ?? 'success';
// Matches API_KEY in helper.test.mjs. Embedded in error bodies to prove
// provider text (and anything resembling a credential) never crosses.
const SECRET = 'synthetic-test-key';

function successBody() {
  const text = frameConnectStream(encodeString(3, 'synthetic answer'));
  const eos = frameConnectStream(Buffer.from('{}'));
  eos[0] |= 2;
  return Buffer.concat([text, eos]);
}

function eosBody(error) {
  const eos = frameConnectStream(Buffer.from(JSON.stringify({ error })));
  eos[0] |= 2;
  return Buffer.concat([eos]);
}

// A real protobuf finish frame (field #5 = v) followed by a clean EOS trailer.
function finishBody(v) {
  const finish = frameConnectStream(encodeVarintField(5, v));
  const eos = frameConnectStream(Buffer.from('{}'));
  eos[0] |= 2;
  return Buffer.concat([finish, eos]);
}

globalThis.fetch = async url => {
  if (!String(url).endsWith('/GetChatMessage')) {
    return new Response('', { status: 503 });
  }
  if (mode === 'idle_timeout') {
    throw Object.assign(new Error('synthetic idle deadline'), { code: 'stream_idle_timeout' });
  }
  if (mode.startsWith('reason_')) {
    const fixtures = {
      reason_http_opaque: { code: 'invalid_argument', message: 'an internal error occurred (trace ID: 0123456789abcdef)' },
      reason_trailer_opaque: { code: 'invalid_argument', message: 'an internal error occurred (cloud trace ID: 0123456789abcdef)' },
      reason_trailer_hex_key_explicit: { code: 'invalid_argument', message: 'an internal error occurred', traceId: process.env.HELPER_TEST_API_KEY },
      reason_trailer_hex_key_suffix: { code: 'invalid_argument', message: `an internal error occurred (trace ID: ${process.env.HELPER_TEST_API_KEY})` },
      reason_http_explicit: { code: 'invalid_request_error', message: 'invalid request', trace_id: 'fedcba9876543210' },
      reason_http_missing: { code: 'internal' },
      reason_trailer_missing: { code: 'internal' },
      reason_http_secret: { code: SECRET, message: `raw prompt ${SECRET} https://internal.example/x`, traceId: SECRET },
      reason_trailer_secret: { code: SECRET, message: `raw prompt ${SECRET} https://internal.example/x`, trace_id: SECRET },
      reason_trailer_decorated: { code: 'invalid_argument', message: 'an internal error occurred (trace ID: 0123456789abcdef) raw prompt' },
      reason_trailer_oversized: { code: 'invalid_argument', message: `an internal error occurred (trace ID: ${'a'.repeat(65)})` },
      reason_http_quoted: { code: 'invalid_argument', message: 'quoted "invalid request" from raw prompt' },
      reason_http_context: { code: 'invalid_argument', message: 'prompt is too long: 101 tokens > 100 maximum' },
    };
    const error = fixtures[mode];
    if (!error) throw new Error('Unknown reason fixture');
    return mode.startsWith('reason_http_')
      ? new Response(JSON.stringify({ error }), { status: 400 })
      : new Response(eosBody(error), { headers: { 'content-type': 'application/connect+proto' } });
  }
  if (mode === 'http_error') {
    return new Response('', { status: 503 });
  }
  if (mode === 'http_429_usage') {
    return new Response(JSON.stringify({ error: {
      code: 'usage_limit_reached', message: 'Your limit will reset in 13 minutes' } }),
      { status: 429 });
  }
  if (mode === 'http_429_bare') {
    return new Response('slow down', { status: 429 });
  }
  if (mode === 'http_429_malformed') {
    return new Response('{"error":{"code":"usage_limit_re', { status: 429 });
  }
  if (mode === 'http_429_oversized') {
    return new Response('x'.repeat(32 * 1024), { status: 429 });
  }
  if (mode === 'http_429_stalled') {
    // Never enqueues and never closes: the bounded read must abandon it.
    return new Response(new ReadableStream({ start() {} }), { status: 429 });
  }
  if (mode === 'http_429_hung_cancel') {
    // Never enqueues AND cancel() never resolves: the bounded read must not
    // await the cancel.
    return new Response(new ReadableStream({
      start() {},
      cancel() { return new Promise(() => {}); },
    }), { status: 429 });
  }
  if (mode === 'http_429_secret') {
    return new Response(JSON.stringify({ error: {
      code: 'quota_exceeded', message: `denied for key ${SECRET}` } }),
      { status: 429 });
  }
  if (mode === 'http_503_secret') {
    return new Response(JSON.stringify({ error: {
      code: 'internal', message: `boom ${SECRET} https://internal.example/x` } }),
      { status: 503 });
  }
  if (mode === 'trailer_usage_reset') {
    return new Response(eosBody({ code: 'permission_denied',
      message: 'Your limit will reset in 13 minutes' }),
      { headers: { 'content-type': 'application/connect+proto' } });
  }
  if (mode === 'trailer_precondition_usage' || mode === 'http_precondition_usage') {
    const error = { code: 'failed_precondition',
      message: 'Your limit will reset in 13 minutes (cloud trace ID: 0123456789abcdef)' };
    return mode === 'http_precondition_usage'
      ? new Response(JSON.stringify({ error }), { status: 400 })
      : new Response(eosBody(error), { headers: { 'content-type': 'application/connect+proto' } });
  }
  if (mode === 'trailer_precondition_generic') {
    return new Response(eosBody({ code: 'failed_precondition',
      message: 'Unable to process request due to an MCP configuration issue.' }),
      { headers: { 'content-type': 'application/connect+proto' } });
  }
  if (mode === 'trailer_resource_exhausted') {
    return new Response(eosBody({ code: 'resource_exhausted',
      message: 'synthetic generic exhaustion' }),
      { headers: { 'content-type': 'application/connect+proto' } });
  }
  if (mode === 'trailer_quoted_quota') {
    return new Response(eosBody({ code: 'permission_denied',
      message: 'docs say "Quota exceeded" but this is an ACL denial' }),
      { headers: { 'content-type': 'application/connect+proto' } });
  }
  if (mode === 'trailer_rate_limit') {
    return new Response(eosBody({ code: 'permission_denied',
      message: 'Reached overall message rate limit' }),
      { headers: { 'content-type': 'application/connect+proto' } });
  }
  if (mode === 'trailer_rate_negated') {
    return new Response(eosBody({ code: 'permission_denied',
      message: 'This is not a rate limit' }),
      { headers: { 'content-type': 'application/connect+proto' } });
  }
  if (mode === 'finish_content_filter') {
    return new Response(finishBody(11), {
      headers: { 'content-type': 'application/connect+proto' } });
  }
  if (mode === 'finish_tool_calls_no_call') {
    return new Response(finishBody(10), {
      headers: { 'content-type': 'application/connect+proto' } });
  }
  return new Response(successBody(), {
    headers: { 'content-type': 'application/connect+proto' },
  });
};

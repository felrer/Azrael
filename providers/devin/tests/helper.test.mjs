import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const HELPER = path.join(DIR, '..', 'helper.mjs');
const STUB = pathToFileURL(path.join(DIR, 'fixtures', 'stub-fetch.mjs')).href;
const API_KEY = 'synthetic-test-key';

// Runs the real helper.mjs as a subprocess with fetch stubbed to a local
// synthetic Connect transport, so frame ordering and error diagnostics are
// exercised end to end rather than through unit-level mapping alone.
function runHelper(mode, apiKey = API_KEY) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', STUB, HELPER], {
      env: { ...process.env, HELPER_TEST_MODE: mode, HELPER_TEST_API_KEY: apiKey },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => resolve({
      code, stdout, stderr,
      frames: stdout.trim().split('\n').filter(Boolean).map(JSON.parse),
    }));
    const init = { protocol_version: 1, type: 'init', request_id: 'it-1',
      credential: { api_key: apiKey, api_server_url: 'https://server.codeium.com' } };
    const request = { protocol_version: 1, type: 'request', request_id: 'it-1',
      model: 'gpt-6-astra-low', input: [], tools: [] };
    child.stdin.write(JSON.stringify(init) + '\n' + JSON.stringify(request) + '\n');
    child.stdin.end();
  });
}

test('helper emits created, phase progress and completed in order', async () => {
  const { code, frames, stderr } = await runHelper('success');
  assert.equal(code, 0, stderr);

  assert.equal(frames[0].type, 'created', 'created must precede every other frame');
  assert.equal(frames.at(-1).type, 'completed');

  const progressIdx = frames.map((f, i) => f.type === 'progress' ? i : -1).filter(i => i >= 0);
  assert(progressIdx.length >= 2, 'immediate progress on headers and stream phase changes');
  assert(progressIdx.every(i => i > 0 && i < frames.length - 1),
    'progress frames sit strictly between created and completed');
  const phases = progressIdx.map(i => frames[i].progress.phase);
  assert(phases.includes('headers') && phases.includes('stream'));

  const done = frames.at(-1).progress;
  for (const field of ['elapsed_ms', 'phase_elapsed_ms', 'stdout_buffered_bytes',
    'stdout_backpressure_count', 'frames_emitted', 'output_bytes',
    'first_byte_ms', 'first_event_ms']) {
    assert(Number.isFinite(done[field]), `completed snapshot carries numeric ${field}`);
  }
  // Counters exclude the completed frame carrying this snapshot.
  assert.equal(done.frames_emitted, frames.length - 1);

  const text = frames.find(f => f.type === 'text_delta');
  assert.equal(text?.delta, 'synthetic answer');
  assert(!JSON.stringify(frames).includes(API_KEY), 'no credential in output');
});

test('helper classifies a coded transport failure without leaking detail', async () => {
  const { code, frames } = await runHelper('idle_timeout');
  assert.equal(code, 1);

  assert.equal(frames[0].type, 'created');
  const error = frames.at(-1);
  assert.equal(error.type, 'error');
  assert.equal(error.code, 'provider_stream_idle', 'existing error.code precedence preserved');
  assert.equal(error.diagnostics?.transport_error, 'stream_idle_timeout');
  assert.equal(error.diagnostics?.http_status, undefined);
  assert.equal(error.diagnostics?.provider_error_source, undefined);
  assert.equal(error.diagnostics?.provider_reason, undefined);
  assert(error.progress, 'terminal error frame still carries the final snapshot');
  assert(!JSON.stringify(frames).includes('synthetic idle deadline'),
    'provider error message text never crosses the boundary');
  assert(!JSON.stringify(frames).includes(API_KEY));
});

test('helper forwards original provider reason evidence with no raw details on stdout or stderr', async () => {
  for (const [mode, providerCode, reason, trace] of [
    ['reason_http_opaque', 'invalid_argument', 'internal_error', '0123456789abcdef'],
    ['reason_trailer_opaque', 'invalid_argument', 'internal_error', '0123456789abcdef'],
    ['reason_http_explicit', 'invalid_request_error', 'invalid_request', 'fedcba9876543210'],
    ['reason_http_missing', 'internal', 'message_missing'],
    ['reason_trailer_missing', 'internal', 'message_missing'],
    ['reason_http_secret', 'unknown', 'unrecognized_message'],
    ['reason_trailer_secret', 'unknown', 'unrecognized_message'],
    ['reason_trailer_decorated', 'invalid_argument', 'unrecognized_message'],
    ['reason_trailer_oversized', 'invalid_argument', 'unrecognized_message'],
    ['reason_http_quoted', 'invalid_argument', 'unrecognized_message'],
    ['reason_http_context', 'invalid_argument', 'context_limit'],
  ]) {
    const { code, frames, stderr } = await runHelper(mode);
    assert.equal(code, 1, mode);
    const error = frames.at(-1);
    const http = mode.startsWith('reason_http_');
    assert.equal(error.code, http || providerCode === 'invalid_argument' ? 'provider_http_400'
      : providerCode === 'internal' ? 'provider_http_502' : 'provider_failure', mode);
    assert.equal(error.diagnostics.provider_error_code, providerCode, mode);
    assert.equal(error.diagnostics.provider_error_source, http ? 'http_response' : 'connect_trailer', mode);
    assert.equal(error.diagnostics.provider_reason, reason, mode);
    assert.equal(error.diagnostics.provider_trace_id, trace, mode);
    assert.equal(error.diagnostics.provider_classification, undefined, mode);
    if (http) assert.equal(error.diagnostics.transport_error, undefined, mode);
    for (const forbidden of [API_KEY, 'raw prompt', 'internal.example', 'an internal error occurred']) {
      assert(!(JSON.stringify(frames) + stderr).includes(forbidden), mode);
    }
  }
});

test('hex-shaped active credentials never escape as otherwise valid provider trace IDs', async () => {
  const apiKey = '0123456789abcdef0123456789abcdef';
  for (const mode of ['reason_trailer_hex_key_explicit', 'reason_trailer_hex_key_suffix']) {
    const { code, stdout, stderr, frames } = await runHelper(mode, apiKey);
    assert.equal(code, 1, mode);
    const error = frames.at(-1);
    assert.equal(error.code, 'provider_http_400', mode);
    assert.equal(error.diagnostics.provider_error_code, 'invalid_argument', mode);
    assert.equal(error.diagnostics.provider_error_source, 'connect_trailer', mode);
    assert.equal(error.diagnostics.provider_reason, 'internal_error', mode);
    assert.equal(error.diagnostics.provider_trace_id, undefined, mode);
    assert(!stdout.includes(apiKey), mode);
    assert(!stderr.includes(apiKey), mode);
  }
});

test('helper records numeric http_status for non-ok responses', async () => {
  const { code, frames } = await runHelper('http_error');
  assert.equal(code, 1);

  const error = frames.at(-1);
  assert.equal(error.type, 'error');
  assert.equal(error.code, 'provider_http_503');
  assert.equal(error.diagnostics?.http_status, 503);
  assert.equal(error.diagnostics?.transport_error, undefined,
    'status-only failures carry no transport code');
});

test('HTTP 429 with a structured usage code becomes provider_usage_limit', async () => {
  const { code, frames } = await runHelper('http_429_usage');
  assert.equal(code, 1);
  const error = frames.at(-1);
  assert.equal(error.code, 'provider_usage_limit');
  assert.equal(error.diagnostics?.provider_classification, 'usage_limit');
  assert.equal(error.diagnostics?.http_status, 429);
  assert(!JSON.stringify(frames).includes('Your limit will reset'),
    'provider message text never crosses the boundary');
});

test('bare HTTP 429 becomes provider_rate_limit', async () => {
  for (const mode of ['http_429_bare', 'http_429_malformed', 'http_429_oversized']) {
    const { code, frames } = await runHelper(mode);
    assert.equal(code, 1, mode);
    const error = frames.at(-1);
    assert.equal(error.code, 'provider_rate_limit', mode);
    assert.equal(error.diagnostics?.provider_classification, 'rate_limit', mode);
  }
});

test('stalled body and hung cancel are abandoned within the bounded read budget', async () => {
  for (const mode of ['http_429_stalled', 'http_429_hung_cancel']) {
    const started = Date.now();
    const { code, frames } = await runHelper(mode);
    const elapsed = Date.now() - started;
    assert.equal(code, 1, mode);
    assert.equal(frames.at(-1).code, 'provider_rate_limit', mode);
    assert(elapsed < 5_000, `${mode} must not hang the helper (took ${elapsed}ms)`);
  }
});

test('credential-shaped body content never crosses the boundary', async () => {
  for (const [mode, expected] of [['http_429_secret', 'provider_usage_limit'],
    ['http_503_secret', 'provider_http_503']]) {
    const { code, frames } = await runHelper(mode);
    assert.equal(code, 1, mode);
    assert.equal(frames.at(-1).code, expected, mode);
    assert(!JSON.stringify(frames).includes(API_KEY), mode);
    assert(!JSON.stringify(frames).includes('internal.example'), mode);
  }
});

test('EOS trailer permission_denied with reset template becomes provider_usage_limit', async () => {
  const { code, frames } = await runHelper('trailer_usage_reset');
  assert.equal(code, 1);
  const error = frames.at(-1);
  assert.equal(error.code, 'provider_usage_limit');
  assert.equal(error.diagnostics?.provider_classification, 'usage_limit');
  assert(!JSON.stringify(frames).includes('Your limit will reset'));
});

test('EOS trailer permission_denied with rate-limit phrase becomes provider_rate_limit', async () => {
  const { code, frames } = await runHelper('trailer_rate_limit');
  assert.equal(code, 1);
  const error = frames.at(-1);
  assert.equal(error.code, 'provider_rate_limit');
  assert.equal(error.diagnostics?.provider_classification, 'rate_limit');
});

test('precondition exhaustion reaches the native usage-limit protocol without provider message text', async () => {
  for (const mode of ['trailer_precondition_usage', 'http_precondition_usage']) {
    const { code, frames } = await runHelper(mode);
    assert.equal(code, 1, mode);
    const error = frames.at(-1);
    assert.equal(error.code, 'provider_usage_limit', mode);
    assert.equal(error.diagnostics?.provider_classification, 'usage_limit');
    assert.equal(error.diagnostics?.provider_error_code, 'failed_precondition');
    assert.equal(error.diagnostics?.provider_error_source,
      mode === 'http_precondition_usage' ? 'http_response' : 'connect_trailer');
    assert.equal(error.diagnostics?.http_status, 400);
    assert.equal(error.diagnostics?.provider_reason, 'usage_limit');
    assert.equal(error.diagnostics?.provider_trace_id, '0123456789abcdef');
    assert(!JSON.stringify(frames).includes('Your limit will reset'));
    assert(!frames.some(frame => frame.type === 'completed' || frame.type === 'item_done'));
  }
  const { code, frames } = await runHelper('trailer_precondition_generic');
  assert.equal(code, 1);
  assert.equal(frames.at(-1).code, 'provider_http_400');
  assert.equal(frames.at(-1).diagnostics?.provider_classification, undefined);
});

test('negated rate-limit text inside a denial message stays unclassified', async () => {
  const { code, frames } = await runHelper('trailer_rate_negated');
  assert.equal(code, 1);
  const error = frames.at(-1);
  assert.equal(error.code, 'provider_http_403');
  assert.equal(error.diagnostics?.provider_classification, undefined,
    'negated rate-limit text is not rate-limit evidence');
});

test('generic resource_exhausted stays an unclassified generic HTTP error', async () => {
  const { code, frames } = await runHelper('trailer_resource_exhausted');
  assert.equal(code, 1);
  const error = frames.at(-1);
  assert.equal(error.code, 'provider_http_429',
    'synthesized 429 from resource_exhausted must not become provider_rate_limit');
  assert.equal(error.diagnostics?.provider_classification, undefined);
});

test('quoted quota text inside a denial message stays unclassified', async () => {
  const { code, frames } = await runHelper('trailer_quoted_quota');
  assert.equal(code, 1);
  const error = frames.at(-1);
  assert.equal(error.code, 'provider_http_403');
  assert.equal(error.diagnostics?.provider_classification, undefined,
    'negated/quoted quota text is not usage evidence');
});

test('wire finish diagnostics propagate through the helper as JSONL', async () => {
  const { code, frames, stderr } = await runHelper('finish_content_filter');
  assert.equal(code, 1, stderr);
  const error = frames.at(-1);
  assert.equal(error.type, 'error');
  assert.equal(error.code, 'provider_incomplete');
  assert.deepEqual(error.diagnostics, {
    event_count: 1, last_event: 'finish', finish_reason: 'content_filter',
    provider_stop_reason: 11, pending_tool_count: 0, active_tool_call: false,
  });
  assert(!JSON.stringify(frames).includes(API_KEY));
});

test('tool_calls finish with no call surfaces the second incomplete branch', async () => {
  const { code, frames, stderr } = await runHelper('finish_tool_calls_no_call');
  assert.equal(code, 1, stderr);
  const error = frames.at(-1);
  assert.equal(error.code, 'provider_incomplete');
  assert.equal(error.diagnostics?.finish_reason, 'tool_calls');
  assert.equal(error.diagnostics?.provider_stop_reason, 10);
  assert.equal(error.diagnostics?.pending_tool_count, 0);
  assert.equal(error.diagnostics?.active_tool_call, false);
});

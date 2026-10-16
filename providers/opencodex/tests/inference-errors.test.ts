import { expect, test } from 'bun:test';
import { anthropicStopEvidence, classifyManagedError, providerHttpError } from '../inference-errors.ts';
import { observeDetails, observeAnthropic } from '../inference.ts';

test('all managed providers reduce explicit exhaustion to the native usage code', () => {
  for (const provider of ['google', 'google-antigravity', 'xai', 'openrouter', 'anthropic']) {
    for (const code of ['insufficient_quota', 'quota_exceeded', 'usage_limit_reached']) {
      expect(classifyManagedError(provider, 429, { error: { code, message: 'PRIVATE' } })).toBe('provider_usage_limit');
    }
    expect(classifyManagedError(provider, undefined, { error: { type: 'usage_limit_reached' } })).toBe('provider_usage_limit');
    expect(classifyManagedError(provider, 403, { error: { message: 'Out of credits' } })).toBe('provider_usage_limit');
    expect(classifyManagedError(provider, 429, { error: { type: 'rate_limit_error' } })).toBe(provider === 'anthropic' ? undefined : 'provider_rate_limit');
    for (const message of ['docs say "Quota exceeded"', 'not out of credits', 'quota reached while validating configuration']) {
      expect(classifyManagedError(provider, 400, { error: { type: 'invalid_request_error', message } })).toBeUndefined();
    }
    expect(classifyManagedError(provider, 500, { error: { code: 'quota_exceeded' } })).toBeUndefined();
    expect(classifyManagedError(provider, 400, { error: null, code: 'quota_exceeded' })).toBeUndefined();
  }
});

test('provider-specific credit limits and Google transient-rate guards remain separate', async () => {
  for (const provider of ['google', 'google-antigravity']) {
    expect(classifyManagedError(provider, 429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Daily limit reached' } })).toBe('provider_usage_limit');
    expect(classifyManagedError(provider, undefined, { error: { status: 'RESOURCE_EXHAUSTED', message: 'Weekly limit reached' } })).toBe('provider_usage_limit');
    expect(classifyManagedError(provider, 429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'Per-minute quota exceeded; retry after 60 seconds' } })).toBe('provider_rate_limit');
    expect(classifyManagedError(provider, 429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for requests per second' } })).toBe('provider_rate_limit_requests');
  }
  expect(classifyManagedError('anthropic', 400, { error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } })).toBe('provider_usage_limit');
  expect(classifyManagedError('openrouter', undefined, { error: { code: 402 } })).toBeUndefined();
  expect(classifyManagedError('xai', undefined, { error: { code: 402 } })).toBeUndefined();
  expect(classifyManagedError('openrouter', undefined, { error: { code: 402, metadata: { limit_source: 'openrouter_in_flight_budget' } } })).toBe('provider_rate_limit_concurrency');
  expect(await providerHttpError(Response.json({ error: { code: 402 } }, { status: 402, headers: { 'retry-after': '60' } }), 'openrouter')).toBe('provider_http_402');
});

test('HTTP error inspection is bounded, hides bodies and preserves generic outcomes', async () => {
  expect(await providerHttpError(Response.json({ error: { type: 'usage_limit_reached', message: 'PRIVATE' } }, { status: 400 }), 'anthropic')).toBe('provider_usage_limit');
  expect(await providerHttpError(new Response('not JSON', { status: 402 }), 'openrouter')).toBe('provider_http_402');
  expect(await providerHttpError(new Response('not JSON', { status: 403 }), 'xai')).toBe('provider_http_403');
  expect(await providerHttpError(new Response('x'.repeat(17000), { status: 429 }), 'google')).toBe('provider_error_undefined');
  const stalled = new Response(new ReadableStream({ start() {}, cancel() { return new Promise(() => {}); } }), { status: 400 });
  expect(await providerHttpError(stalled, 'anthropic')).toBe('provider_http_400');
});

test('all managed HTTP and original SSE error envelopes are classified before adapter detail loss', async () => {
  for (const provider of ['google', 'google-antigravity', 'xai', 'openrouter', 'anthropic']) {
    const error = { code: 'insufficient_quota', message: 'PRIVATE_PROVIDER_MESSAGE' };
    expect(await providerHttpError(Response.json({ error }, { status: 429 }), provider)).toBe('provider_usage_limit');
    const payload = provider === 'google-antigravity' ? { response: { error } }
      : provider === 'anthropic' ? { type: 'error', error } : { error };
    const response = new Response('data: ' + JSON.stringify(payload) + '\n\n');
    const opaque = { terminal: false, details: [], upstreamSseError: false };
    const observed = provider === 'anthropic' ? observeAnthropic(response, opaque)
      : observeDetails(response, opaque, false, true, undefined, provider);
    await expect(observed.text()).rejects.toThrow('provider_usage_limit');
    expect(opaque.upstreamSseError).toBeTrue();
  }
  const response = new Response('data: ' + JSON.stringify({ choices: [{ finish_reason: 'error', error: { code: 'insufficient_quota' } }] }) + '\n\n');
  await expect(observeDetails(response, { terminal: false, details: [] }, false, false, undefined, 'openrouter').text()).rejects.toThrow('provider_usage_limit');
});

test('bare HTTP 429, ambiguous Anthropic types and misleading prose remain undefined', async () => {
  for (const payload of [{}, { error: {} }, { error: { type: 'rate_limit_error' } },
    { error: { type: 'unexpected_private_type', message: 'Quota exceeded' } },
    ...['not out of credits', 'docs say "Quota exceeded"', 'rate limit is not exceeded', 'billing setup failed', 'not Daily limit reached'].map(message => ({ error: { message } }))]) {
    const observed: any[] = [];
    expect(await providerHttpError(Response.json(payload, { status: 429, headers: { 'retry-after': '10' } }), 'anthropic', value => observed.push(value))).toBe('provider_error_undefined');
    expect(observed).toHaveLength(1);
    expect(observed[0].retry_after_ms).toBe(10000);
    expect(JSON.stringify(observed)).not.toContain('unexpected_private_type');
    expect(JSON.stringify(observed)).not.toContain('Quota exceeded');
  }
  expect(classifyManagedError('google', 429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'billing config is invalid, quota not exceeded' } })).toBeUndefined();
  for (const type of ['authentication_error', 'permission_error', 'overloaded_error', 'api_error']) {
    for (const message of ['Out of credits', 'Rate limit exceeded']) {
      expect(classifyManagedError('anthropic', 429, { error: { type, message } })).toBeUndefined();
    }
  }
  expect(classifyManagedError('anthropic', 429, { error: { type: 'invalid_request_error', message: 'Rate limit exceeded' } })).toBeUndefined();
});

test('specific rate statements preserve only the established dimension', async () => {
  for (const [unit, dimension] of [['requests', 'requests'], ['input tokens', 'input_tokens'], ['output tokens', 'output_tokens'], ['tokens', 'tokens']]) {
    const message = `This request would exceed your organization's rate limit of 50,000 ${unit} per minute.`;
    expect(classifyManagedError('anthropic', 429, { error: { type: 'rate_limit_error', message } })).toBe('provider_rate_limit_' + dimension);
    expect(classifyManagedError('anthropic', 429, { error: { type: 'rate_limit_error', message: 'Documentation: ' + message } })).toBeUndefined();
  }
  expect(classifyManagedError('anthropic', 429, { error: { type: 'rate_limit_error', message: 'Concurrent request limit exceeded.' } })).toBe('provider_rate_limit_concurrency');
  expect(classifyManagedError('anthropic', 429, { error: { type: 'rate_limit_error', message: 'This request would exceed your account\'s rate limit. Please try again later.' } })).toBe('provider_rate_limit');
});

test('subscription windows and documented spend cap override ambiguous rate type', async () => {
  for (const window of ['5h', '7d']) {
    let evidence: any;
    expect(await providerHttpError(Response.json({ error: { type: 'rate_limit_error', message: 'PRIVATE' } }, { status: 429, headers: {
      [`anthropic-ratelimit-unified-${window}-status`]: 'rejected', [`anthropic-ratelimit-unified-${window}-reset`]: '1800000000', 'retry-after': '60',
    } }), 'anthropic', value => evidence = value)).toBe('provider_usage_limit');
    expect(evidence.provider_error_reason).toBe(window === '5h' ? 'usage_five_hour' : 'usage_seven_day');
    expect(evidence[`usage_${window}_reset_ms`]).toBe(1800000000000);
    expect(JSON.stringify(evidence)).not.toContain('PRIVATE');
  }
  let evidence: any;
  expect(await providerHttpError(Response.json({ error: { type: 'rate_limit_error', details: { error_code: 'enforced_spend_limit_reached' } } }, { status: 429 }), 'anthropic', value => evidence = value)).toBe('provider_usage_limit');
  expect(evidence.provider_error_reason).toBe('usage_monthly');
});

test('error evidence accepts numeric rate headers without exposing payloads or arbitrary values', async () => {
  let evidence: any;
  await providerHttpError(Response.json({ error: { type: 'PRIVATE_TYPE', message: 'PRIVATE_MESSAGE' } }, { status: 429, headers: {
    'retry-after': 'PRIVATE_HEADER', 'anthropic-ratelimit-input-tokens-limit': '50000', 'anthropic-ratelimit-input-tokens-remaining': '0',
    'anthropic-ratelimit-input-tokens-reset': '2026-10-16T12:50:00Z', 'anthropic-ratelimit-output-tokens-limit': '-1',
    'anthropic-ratelimit-unified-5h-status': 'PRIVATE_STATUS', 'authorization': 'PRIVATE_TOKEN',
  } }), 'anthropic', value => evidence = value);
  expect(evidence.rate_limit_input_tokens_limit).toBe(50000);
  expect(evidence.rate_limit_input_tokens_remaining).toBe(0);
  expect(evidence.rate_limit_input_tokens_reset_ms).toBe(Date.parse('2026-10-16T12:50:00Z'));
  expect(evidence.rate_limit_output_tokens_limit).toBeUndefined();
  expect(evidence.retry_after_ms).toBeUndefined();
  expect(evidence.provider_error_type).toBe('unknown');
  expect(JSON.stringify(evidence)).not.toContain('PRIVATE');
});


test('Anthropic stop evidence trusts structured refusal only and never retains provider prose', () => {
  const event = (stop_reason: any, stop_details?: any) => ({ type: 'message_delta', delta: { stop_reason, stop_details } });
  for (const category of ['cyber', 'bio', 'frontier_llm', 'reasoning_extraction', 'general_harms']) {
    expect(anthropicStopEvidence(event('refusal', { type: 'refusal', category, explanation: 'SECRET_PROSE' })))
      .toEqual({ provider_stop_reason: 'refusal', provider_refusal_category: category });
  }
  for (const [details, expected] of [[null, 'unspecified'], [undefined, 'missing'],
    [{ type: 'refusal', category: null }, 'unspecified'], [{ type: 'refusal' }, 'missing'],
    [{ type: 'refusal', category: 'SECRET_NEW_CATEGORY' }, 'unknown'],
    [{ type: 'not_refusal', category: 'cyber' }, 'unknown'], ['SECRET', 'unknown']]) {
    const evidence = anthropicStopEvidence(event('refusal', details));
    expect(evidence?.provider_refusal_category).toBe(expected);
    expect(JSON.stringify(evidence)).not.toContain('SECRET');
  }
  for (const reason of ['end_turn', 'tool_use', 'max_tokens', 'content_filter', 'stop_sequence', 'pause_turn'])
    expect(anthropicStopEvidence(event(reason, { type: 'refusal', category: 'cyber' }))).toEqual({ provider_stop_reason: reason });
  expect(anthropicStopEvidence(event('SECRET'))).toEqual({ provider_stop_reason: 'unknown' });
  for (const value of [null, {}, event(null), event(42), { type: 'error', delta: { stop_reason: 'refusal' } },
    { type: 'message_delta', message: 'refusal cyber' }]) expect(anthropicStopEvidence(value)).toBeUndefined();
});

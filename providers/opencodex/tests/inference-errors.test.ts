import { expect, test } from 'bun:test';
import { classifyManagedError, providerHttpError } from '../inference-errors.ts';
import { observeDetails, observeAnthropic } from '../inference.ts';

test('all managed providers reduce explicit exhaustion to the native usage code', () => {
  for (const provider of ['google', 'google-antigravity', 'xai', 'openrouter', 'anthropic']) {
    for (const code of ['insufficient_quota', 'quota_exceeded', 'usage_limit_reached']) {
      expect(classifyManagedError(provider, 429, { error: { code, message: 'PRIVATE' } })).toBe('provider_usage_limit');
    }
    expect(classifyManagedError(provider, undefined, { error: { type: 'usage_limit_reached' } })).toBe('provider_usage_limit');
    expect(classifyManagedError(provider, 403, { error: { message: 'Out of credits' } })).toBe('provider_usage_limit');
    expect(classifyManagedError(provider, 429, { error: { type: 'rate_limit_error' } })).toBe('provider_rate_limit');
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
    expect(classifyManagedError(provider, 429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for requests per second' } })).toBe('provider_rate_limit');
  }
  expect(classifyManagedError('anthropic', 400, { error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } })).toBe('provider_usage_limit');
  expect(classifyManagedError('openrouter', undefined, { error: { code: 402 } })).toBe('provider_usage_limit');
  expect(classifyManagedError('xai', undefined, { error: { code: 402 } })).toBeUndefined();
  expect(classifyManagedError('openrouter', undefined, { error: { code: 402, metadata: { limit_source: 'openrouter_in_flight_budget' } } })).toBe('provider_rate_limit');
  expect(await providerHttpError(Response.json({ error: { code: 402 } }, { status: 402, headers: { 'retry-after': '60' } }), 'openrouter')).toBe('provider_rate_limit');
});

test('HTTP error inspection is bounded, hides bodies and preserves generic outcomes', async () => {
  expect(await providerHttpError(Response.json({ error: { type: 'usage_limit_reached', message: 'PRIVATE' } }, { status: 400 }), 'anthropic')).toBe('provider_usage_limit');
  expect(await providerHttpError(new Response('not JSON', { status: 402 }), 'openrouter')).toBe('provider_usage_limit');
  expect(await providerHttpError(new Response('not JSON', { status: 403 }), 'xai')).toBe('provider_http_403');
  expect(await providerHttpError(new Response('x'.repeat(17000), { status: 429 }), 'google')).toBe('provider_rate_limit');
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
  const response = new Response('data: ' + JSON.stringify({ choices: [{ finish_reason: 'error', error: { code: 402 } }] }) + '\n\n');
  await expect(observeDetails(response, { terminal: false, details: [] }, false, false, undefined, 'openrouter').text()).rejects.toThrow('provider_usage_limit');
});

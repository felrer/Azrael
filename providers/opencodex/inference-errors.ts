const object = (value: any) => value !== null && typeof value === 'object' && !Array.isArray(value);
const usageCodes = new Set(['usage_limit_reached', 'quota_exceeded', 'insufficient_quota', 'credit_balance_too_low']);
const rateCodes = new Set(['rate_limit_exceeded', 'rate_limit_error', 'rate_limited', 'too_many_requests']);
const knownTypes = new Set([...usageCodes, ...rateCodes, 'invalid_request_error', 'authentication_error', 'permission_error', 'billing_error', 'overloaded_error', 'api_error']);
const usageMessage = /^(?:quota exceeded|quota exhausted|usage limit reached|usage limit exceeded|out of credits|insufficient credits|you have run out of credits|your limit will reset in [0-9]+\s*(?:seconds?|minutes?|hours?|days?))\.?$/i;
const anthropicCredits = /^Your credit balance is too low to access the (?:Anthropic|Claude) API\.(?: Please go to Plans & Billing to upgrade or purchase credits\.)?$/i;
type Evidence = Record<string, string | number>;
type Classification = { code?: string; reason: string };
const unknown = (): Classification => ({ reason: 'unknown' });
const usage = (reason = 'usage_limit'): Classification => ({ code: 'provider_usage_limit', reason });
const rate = (reason = 'rate_limit'): Classification => ({ code: ({ request_rate: 'provider_rate_limit_requests', input_token_rate: 'provider_rate_limit_input_tokens', output_token_rate: 'provider_rate_limit_output_tokens', token_rate: 'provider_rate_limit_tokens', concurrency: 'provider_rate_limit_concurrency', acceleration: 'provider_rate_limit_acceleration' } as Record<string, string>)[reason] ?? 'provider_rate_limit', reason });
const envelope = (payload: any) => object(payload) ? Object.hasOwn(payload, 'error') ? payload.error : payload : undefined;

// Complete recognized statements only: never classify arbitrary prose by a keyword.
function rateStatement(message: string): Classification | undefined {
  if (/^(?:rate limit exceeded|too many requests|This request would exceed your account's rate limit\. Please try again later)\.?$/i.test(message)) return rate();
  if (/^Concurrent request limit exceeded\.?$/i.test(message)) return rate('concurrency');
  if (/^Acceleration limit exceeded\.?$/i.test(message)) return rate('acceleration');
  const match = /^(?:This request would exceed your organization's rate limit of|Rate limit exceeded for) [0-9,]+ (requests|input tokens|output tokens|tokens) per minute(?: \(org: [0-9a-f-]{36}, model: [a-z0-9._-]+\))?\.(?: Please try again later\.)?$/i.exec(message);
  return match ? rate(({ requests: 'request_rate', 'input tokens': 'input_token_rate', 'output tokens': 'output_token_rate', tokens: 'token_rate' } as Record<string, string>)[match[1].toLowerCase()]) : undefined;
}
function classify(provider: string, status: number | undefined, payload: any, evidence: Evidence = {}): Classification {
  if (status !== undefined && (status < 400 || status >= 500)) return unknown();
  const error = envelope(payload), valid = object(error);
  const code = valid ? error.code ?? error.type : undefined;
  const errorStatus = status ?? (Number.isInteger(code) ? code : undefined);
  if (errorStatus !== undefined && (errorStatus < 400 || errorStatus >= 500)) return unknown();
  const denied = errorStatus === 429;
  // Rejected subscription windows and the documented spend-cap detail are direct
  // usage evidence. A 429 or Anthropic rate_limit_error alone is ambiguous.
  if (provider === 'anthropic' && denied) {
    if (evidence.usage_7d_status === 'rejected') return usage('usage_seven_day');
    if (evidence.usage_5h_status === 'rejected') return usage('usage_five_hour');
  }
  if (!valid) return unknown();
  if (provider === 'anthropic' && error.details?.error_code === 'enforced_spend_limit_reached') return usage('usage_monthly');
  if (provider === 'openrouter' && error.metadata?.limit_source === 'openrouter_in_flight_budget') return rate('concurrency');
  if (usageCodes.has(code)) return usage();
  if (typeof code === 'string' && !knownTypes.has(code) && code !== 'RESOURCE_EXHAUSTED') return unknown();
  // A contradictory structured category must not be overridden by message text.
  if (['authentication_error', 'permission_error', 'overloaded_error', 'api_error'].includes(code)) return unknown();
  const message = typeof error.message === 'string' && error.message.length <= 16_384 ? error.message.trim() : '';
  if (message && usageMessage.test(message)) return usage();
  if (provider === 'anthropic' && message && anthropicCredits.test(message)) return usage();
  if ((provider === 'google' || provider === 'google-antigravity') && (denied || error.status === 'RESOURCE_EXHAUSTED')) {
    if (/^(?:Daily|Weekly) limit reached\.?$/i.test(message)) return usage();
    if (/^Per-minute quota exceeded; retry after [0-9]+ seconds\.?$/i.test(message)) return rate();
    if (/^Quota exceeded for requests per second\.?$/i.test(message)) return rate('request_rate');
  }
  const statement = rateStatement(message);
  if (statement && (rateCodes.has(code) || (denied && (code === undefined || typeof code === 'number' || code === 'RESOURCE_EXHAUSTED')))) return statement;
  if (rateCodes.has(code)) return provider === 'anthropic' && code === 'rate_limit_error' ? { reason: 'ambiguous' } : rate();
  return unknown();
}
export function classifyManagedError(provider: string, status: number | undefined, payload: any): string | undefined {
  return classify(provider, status, payload).code;
}
function integer(value: string | null): number | undefined {
  if (value === null || !/^\d{1,16}$/.test(value.trim())) return undefined;
  const result = Number(value.trim());
  return Number.isSafeInteger(result) && result >= 0 ? result : undefined;
}
function timestamp(value: string | null): number | undefined {
  if (!value || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) return undefined;
  const result = Date.parse(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : undefined;
}
function headersEvidence(response: Response, provider: string): Evidence {
  const evidence: Evidence = {}, after = response.headers.get('retry-after');
  if (after && /^\d{1,10}(?:\.\d{1,3})?$/.test(after.trim())) {
    const delay = Math.ceil(Number(after) * 1000);
    if (Number.isSafeInteger(delay)) evidence.retry_after_ms = delay;
  }
  if (provider !== 'anthropic') return evidence;
  for (const metric of ['requests', 'input-tokens', 'output-tokens', 'tokens']) {
    const key = metric.replaceAll('-', '_');
    for (const suffix of ['limit', 'remaining', 'reset']) {
      const value = response.headers.get(`anthropic-ratelimit-${metric}-${suffix}`);
      const parsed = suffix === 'reset' ? timestamp(value) : integer(value);
      if (parsed !== undefined) evidence[`rate_limit_${key}_${suffix === 'reset' ? 'reset_ms' : suffix}`] = parsed;
    }
  }
  for (const window of ['5h', '7d']) {
    const state = response.headers.get(`anthropic-ratelimit-unified-${window}-status`)?.trim();
    if (state && ['allowed', 'allowed_warning', 'rejected'].includes(state)) evidence[`usage_${window}_status`] = state;
    const reset = integer(response.headers.get(`anthropic-ratelimit-unified-${window}-reset`));
    if (reset !== undefined && Number.isSafeInteger(reset * 1000)) evidence[`usage_${window}_reset_ms`] = reset * 1000;
  }
  return evidence;
}
// Only closed labels and validated numeric headers leave this boundary; no body text.
export async function providerHttpError(response: Response, provider: string, observe?: (evidence: Evidence) => void): Promise<string> {
  const evidence = headersEvidence(response, provider);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = (state: string, payload?: any) => {
    const result = classify(provider, response.status, payload, evidence), error = envelope(payload);
    const type = object(error) ? error.code ?? error.type : undefined;
    evidence.provider_error_type = typeof type === 'string' && knownTypes.has(type) ? type : type === undefined ? 'missing' : 'unknown';
    evidence.provider_error_reason = result.reason; evidence.error_body_state = state;
    try { observe?.({ ...evidence }); } catch { /* Optional diagnostics cannot change outcomes. */ }
    return result.code ?? (response.status === 429 ? 'provider_error_undefined' : 'provider_http_' + response.status);
  };
  const reader = response.body?.getReader();
  if (!reader) return finish('missing');
  try {
    const body = async (): Promise<{ state: string; payload?: any }> => {
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 16_384) return { state: 'too_large' };
          chunks.push(value);
        }
        if (!bytes) return { state: 'missing' };
        try { return { state: 'parsed', payload: JSON.parse(Buffer.concat(chunks).toString('utf8')) }; }
        catch { return { state: 'invalid_json' }; }
      } catch { return { state: 'unreadable' }; }
    };
    const result = await Promise.race([body(), new Promise<{ state: string; payload?: any }>(resolve => { timer = setTimeout(() => resolve({ state: 'timeout' }), 1000); })]);
    return finish(result.state, result.payload);
  } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
}

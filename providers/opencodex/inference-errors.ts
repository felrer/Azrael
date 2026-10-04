import { isQuotaExhaustedBody } from './vendor/src/adapters/google-errors.ts';

const object = (value: any) => value !== null && typeof value === 'object' && !Array.isArray(value);
const usageCodes = new Set(['usage_limit_reached', 'quota_exceeded', 'insufficient_quota', 'credit_balance_too_low']);
const rateCodes = new Set(['rate_limit_exceeded', 'rate_limit_error', 'rate_limited', 'too_many_requests']);
const usageMessage = /^(?:quota exceeded|quota exhausted|usage limit reached|usage limit exceeded|out of credits|insufficient credits|you have run out of credits|your limit will reset in [0-9]+\s*(?:seconds?|minutes?|hours?|days?))\.?$/i;
const anthropicCredits = /^Your credit balance is too low to access the (?:Anthropic|Claude) API\.(?: Please go to Plans & Billing to upgrade or purchase credits\.)?$/i;

// Inspect the original structured envelope, before adapters reduce its detail.
// Only an enumerated code leaves this boundary, never the message/body.
export function classifyManagedError(provider: string, status: number | undefined, payload: any): string | undefined {
  if (!object(payload)) return undefined;
  const error = Object.hasOwn(payload, 'error') ? payload.error : payload;
  if (!object(error)) return undefined;
  const code = error.code ?? error.type;
  const errorStatus = status ?? (Number.isInteger(code) ? code : undefined);
  if (errorStatus !== undefined && (errorStatus < 400 || errorStatus >= 500)) return undefined;
  // OpenRouter's temporary in-flight budget also uses 402; it is not an
  // exhausted account balance. Honor this more specific structured evidence.
  if (provider === 'openrouter' && error.metadata?.limit_source === 'openrouter_in_flight_budget') return 'provider_rate_limit';
  if (usageCodes.has(code)) return 'provider_usage_limit';
  if (provider === 'openrouter' && errorStatus === 402) return 'provider_usage_limit';
  const message = typeof error.message === 'string' && error.message.length <= 16_384 ? error.message.trim() : '';
  if (message && usageMessage.test(message)) return 'provider_usage_limit';
  if (provider === 'anthropic' && message && anthropicCredits.test(message)) return 'provider_usage_limit';
  if ((provider === 'google' || provider === 'google-antigravity')
    && (errorStatus === 429 || error.status === 'RESOURCE_EXHAUSTED') && message
    && !/per[ -](?:second|sec)\b|\b(?:rps|tps|tpm)\b/i.test(message)
    && isQuotaExhaustedBody(JSON.stringify({ error }))) return 'provider_usage_limit';
  if (rateCodes.has(code) || errorStatus === 429) return 'provider_rate_limit';
  return undefined;
}

export async function providerHttpError(response: Response, provider: string): Promise<string> {
  const fallback = provider === 'openrouter' && response.status === 402
    ? response.headers.has('retry-after') ? 'provider_rate_limit' : 'provider_usage_limit'
    : response.status === 429 ? 'provider_rate_limit' : 'provider_http_' + response.status;
  if (provider === 'openrouter' && response.status === 402 && response.headers.has('retry-after')) return fallback;
  if (![400, 402, 403, 429].includes(response.status)) return fallback;
  const reader = response.body?.getReader();
  if (!reader) return fallback;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = async () => {
      const chunks: Uint8Array[] = []; let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 16_384) return fallback;
        chunks.push(value);
      }
      try { return classifyManagedError(provider, response.status, JSON.parse(Buffer.concat(chunks).toString('utf8'))) ?? fallback; }
      catch { return fallback; }
    };
    return await Promise.race([body(), new Promise<string>(resolve => { timer = setTimeout(() => resolve(fallback), 1000); })]);
  } catch { return fallback; }
  finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
}

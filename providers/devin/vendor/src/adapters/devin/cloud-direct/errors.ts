/*
 * Bounded provider-error classification.
 *
 * The transport sees two denial shapes: an HTTP status line (whose body this
 * adapter otherwise discards for credential safety) and a Connect EOS trailer
 * `{error:{code,message}}`. Both can mean "usage exhausted" (a cap the user
 * must wait out or upgrade), a transient rate limit, or an unrelated refusal.
 * The helper boundary needs that distinction as an enumerated protocol code,
 * but arbitrary provider text must never cross it — so this module reduces
 * denial classification to two labels: 'usage_limit' and 'rate_limit'. Separate
 * observational diagnostics reduce original codes/messages to safe enums.
 *
 * Evidence rules (deliberately narrow):
 *   - usage_limit requires POSITIVE usage evidence: an exact structured code
 *     (USAGE_LIMIT_CODES) or a full anchored denial message template
 *     (USAGE_MESSAGE_RES), inside a known denial envelope — Connect code
 *     permission_denied/resource_exhausted or HTTP 429. A quota phrase quoted
 *     inside a longer sentence does not match; "rate limit" alone is never
 *     usage evidence.
 *   - rate_limit requires an exact rate-limit code, a rate-limit phrase inside
 *     a denial envelope, or an actual HTTP 429 status line when no error code
 *     was delivered. A 429 SYNTHESIZED from a generic resource_exhausted
 *     trailer (connectTrailerHttpStatus) does not qualify — the code is
 *     present, so the bare-429 branch never applies to it.
 *   - Anything else returns undefined: the caller keeps the generic
 *     provider_http_N/provider_failure code and the root maps it to
 *     Unclassified.
 */

export type ProviderErrorClassification = 'usage_limit' | 'rate_limit';

const PROVIDER_ERROR_CODES = [
  'cancelled', 'unknown', 'invalid_argument', 'deadline_exceeded', 'not_found',
  'already_exists', 'permission_denied', 'resource_exhausted', 'failed_precondition',
  'aborted', 'out_of_range', 'unimplemented', 'internal', 'unavailable', 'data_loss',
  'unauthenticated', 'usage_limit_reached', 'quota_exceeded', 'insufficient_quota',
  'rate_limit_exceeded', 'rate_limited', 'too_many_requests', 'invalid_request_error',
] as const;
export type ProviderReason = 'internal_error' | 'context_limit' | 'invalid_thinking_signature'
  | 'missing_tool_result' | 'missing_tool_use' | 'usage_limit' | 'rate_limit'
  | 'invalid_request' | 'message_missing' | 'unrecognized_message';
export interface ProviderDiagnostics {
  provider_error_code?: typeof PROVIDER_ERROR_CODES[number];
  provider_error_source: 'http_response' | 'connect_trailer';
  provider_trace_id?: string;
  provider_reason: ProviderReason;
}

// Validate the entire identifier. Never truncate arbitrary text into an ID.
const SAFE_TRACE_RE = /^[0-9a-f]{16,64}$(?![\s\S])/;
const SAFE_TRACE_SUFFIX_RE = / +\((?:cloud )?trace ID: ([0-9a-f]{16,64})\)$(?![\s\S])/i;

/** Reduce original response evidence before any user-facing message enrichment. */
export function providerDiagnostics(
  source: ProviderDiagnostics['provider_error_source'],
  fields: { code?: string; message?: string; traceId?: string; trace_id?: string },
): ProviderDiagnostics {
  const message = typeof fields.message === 'string' ? fields.message : '';
  // EOS frames may be much larger than the bounded HTTP error body. Never
  // scan oversized text for reason templates or a suffix identifier.
  const boundedMessage = message.length <= 16 * 1024;
  const suffix = boundedMessage ? message.match(SAFE_TRACE_SUFFIX_RE) : null;
  // Case-insensitive template matching does not make uppercase trace IDs safe.
  const suffixTrace = suffix && SAFE_TRACE_RE.test(suffix[1]) ? suffix[1] : undefined;
  const text = suffixTrace ? message.slice(0, suffix!.index) : message;
  const traceId = [fields.traceId, fields.trace_id, suffixTrace]
    .find(value => typeof value === 'string' && SAFE_TRACE_RE.test(value));
  let reason: ProviderReason = message ? 'unrecognized_message' : 'message_missing';
  const templates: readonly [ProviderReason, RegExp][] = [
    ['internal_error', /^an internal error occurred\.?$/i],
    ['context_limit', /^prompt is too long(?:: [0-9]{1,12} tokens > [0-9]{1,12} maximum)?\.?$/i],
    ['context_limit', /^maximum context length exceeded\.?$/i],
    ['invalid_thinking_signature', /^invalid (?:thinking|reasoning) signature\.?$/i],
    ['missing_tool_result', /^missing tool result\.?$/i],
    ['missing_tool_use', /^missing tool use\.?$/i],
    ['invalid_request', /^invalid (?:request|argument)\.?$/i],
    ['usage_limit', /^your limit will reset in [0-9]{1,12}\s*(?:seconds?|minutes?|hours?|days?)\.?$/i],
    ['usage_limit', /^(?:quota exceeded|out of credits|you have run out of credits)\.?$/i],
    ['rate_limit', /^(?:rate limit exceeded|too many requests|reached overall message rate limit)\.?$/i],
  ];
  for (const [candidate, template] of templates) {
    if (boundedMessage && !/[\r\n]/.test(text) && template.test(text)) { reason = candidate; break; }
  }
  return {
    ...(fields.code ? { provider_error_code: PROVIDER_ERROR_CODES.find(code => code === fields.code) ?? 'unknown' } : {}),
    provider_error_source: source,
    ...(traceId ? { provider_trace_id: traceId } : {}),
    provider_reason: reason,
  };
}

/** Exact structured error codes that positively assert a usage/quota cap. */
const USAGE_LIMIT_CODES: ReadonlySet<string> = new Set([
  'usage_limit_reached',
  'quota_exceeded',
  'insufficient_quota',
]);

/** Exact structured error codes that positively assert a transient rate limit. */
const RATE_LIMIT_CODES: ReadonlySet<string> = new Set([
  'rate_limit_exceeded',
  'rate_limited',
  'too_many_requests',
]);

/**
 * Connect denial codes Cognition uses for quota/rate refusals. Message
 * templates only count as evidence inside one of these envelopes (or an
 * actual HTTP 429) — the same sentence in any other context is not a cap.
 */
const DENIAL_ENVELOPE_CODES: ReadonlySet<string> = new Set([
  'permission_denied',
  'resource_exhausted',
]);

/**
 * Optional trailing decoration providers append to denial sentences:
 * punctuation plus a "(trace ID: <hex>)" suffix, which the EOS trailer path
 * embeds in the message string.
 */
const TRAILER_SUFFIX = String.raw`\s*\.?\s*(?:\(trace ID: [0-9a-f]+\)\s*)?`;

/**
 * Anchored full-message templates. Anchoring is the point: a quoted or
 * negated mention ("docs say \"Quota exceeded\"", "this is not a rate
 * limit") must not classify.
 */
const USAGE_MESSAGE_RES: readonly RegExp[] = [
  new RegExp(`^your limit will reset in \\d+\\s*(?:seconds?|minutes?|hours?|days?)${TRAILER_SUFFIX}$`, 'i'),
  new RegExp(`^quota exceeded${TRAILER_SUFFIX}$`, 'i'),
  new RegExp(`^out of credits${TRAILER_SUFFIX}$`, 'i'),
  new RegExp(`^you have run out of credits${TRAILER_SUFFIX}$`, 'i'),
];

const RATE_LIMIT_MESSAGE_RES: readonly RegExp[] = [
  new RegExp(`^rate limit exceeded${TRAILER_SUFFIX}$`, 'i'),
  new RegExp(`^too many requests${TRAILER_SUFFIX}$`, 'i'),
  new RegExp(`^reached overall message rate limit${TRAILER_SUFFIX}$`, 'i'),
];

export interface ProviderDenialEvidence {
  /** Actual HTTP status line, when the failure was one. */
  status?: number;
  /** Structured error code (Connect trailer code or JSON body code/type). */
  code?: string;
  /** Provider denial message; matched only against anchored templates. */
  message?: string;
}

export function classifyProviderDenial(evidence: ProviderDenialEvidence): ProviderErrorClassification | undefined {
  const { status, code, message } = evidence;
  if (code && USAGE_LIMIT_CODES.has(code)) return 'usage_limit';
  const denialEnvelope = (code !== undefined && DENIAL_ENVELOPE_CODES.has(code)) || status === 429;
  const text = typeof message === 'string' ? message.trim() : '';
  if (denialEnvelope && text && USAGE_MESSAGE_RES.some(re => re.test(text))) return 'usage_limit';
  if (code && RATE_LIMIT_CODES.has(code)) return 'rate_limit';
  if (denialEnvelope && text && RATE_LIMIT_MESSAGE_RES.some(re => re.test(text))) return 'rate_limit';
  // Bare HTTP 429: the status line itself is the rate-limit evidence, but only
  // when no code was delivered — a present-but-generic code (e.g.
  // resource_exhausted) stays unclassified rather than inheriting the status.
  if (!code && status === 429) return 'rate_limit';
  return undefined;
}

/**
 * Pull {code, message} out of a parsed JSON error body. When an `error` key
 * exists it is the ONLY envelope consulted — a malformed `.error` must not
 * fall back to unrelated root fields. `type` counts as a code alias.
 */
export function extractErrorFields(body: unknown): { code?: string; message?: string; traceId?: string; trace_id?: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const root = body as Record<string, unknown>;
  const source: Record<string, unknown> = Object.hasOwn(root, 'error')
    ? (root.error && typeof root.error === 'object' && !Array.isArray(root.error)
      ? root.error as Record<string, unknown>
      : {})
    : root;
  const str = (key: string) => {
    const value = source[key];
    return typeof value === 'string' && value ? value : undefined;
  };
  return { code: str('code') ?? str('type'), message: str('message'),
    ...(str('traceId') ? { traceId: str('traceId') } : {}),
    ...(str('trace_id') ? { trace_id: str('trace_id') } : {}) };
}

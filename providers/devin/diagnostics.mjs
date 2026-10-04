// Safe structural diagnostics and enumerated provider reasons. Classification uses an
// explicit allowlist of known error codes; arbitrary provider messages,
// stacks, URLs and payload content never cross this boundary.
const TRANSPORT_ERROR_CODES = new Map([
  ['headers_timeout', 'headers_timeout'],
  ['stream_idle_timeout', 'stream_idle_timeout'],
  ['truncated_stream', 'truncated_stream'],
  ['invalid_trailer', 'invalid_trailer'],
  ['provider_error', 'provider_error'],
  ['cancelled', 'cancelled'],
  ['reader_failure', 'reader_failure'],
]);

// Returns an allowlisted transport_error value, 'other' for a coded error
// outside the known set, or undefined when the error carries no code at all.
// Unknown codes are never labelled reader_failure.
export function transportErrorCode(error) {
  const code = error?.code;
  if (typeof code !== 'string' || !code) return undefined;
  return TRANSPORT_ERROR_CODES.get(code) ?? 'other';
}

export function httpStatus(error) {
  const status = error?.status;
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

// Safe classification labels the transport may set on CloudChatError.
// Enumerated here rather than trusting the property: a foreign error carrying
// any other value is ignored, and no provider text crosses with it.
const PROVIDER_CLASSIFICATION_CODES = new Map([
  ['usage_limit', 'provider_usage_limit'],
  ['rate_limit', 'provider_rate_limit'],
]);

// Returns the protocol code for an allowlisted transport classification, or
// undefined when the error carries none. Callers keep deadline/local-code
// precedence and fall back to provider_http_N/provider_failure.
export function providerClassificationCode(error) {
  const classification = error?.classification;
  if (typeof classification !== 'string') return undefined;
  return PROVIDER_CLASSIFICATION_CODES.get(classification);
}

const PROVIDER_ERROR_CODES = new Set([
  'cancelled', 'unknown', 'invalid_argument', 'deadline_exceeded', 'not_found',
  'already_exists', 'permission_denied', 'resource_exhausted', 'failed_precondition',
  'aborted', 'out_of_range', 'unimplemented', 'internal', 'unavailable', 'data_loss',
  'unauthenticated', 'usage_limit_reached', 'quota_exceeded', 'insufficient_quota',
  'rate_limit_exceeded', 'rate_limited', 'too_many_requests', 'invalid_request_error',
]);
const PROVIDER_REASONS = new Set([
  'internal_error', 'context_limit', 'invalid_thinking_signature', 'missing_tool_result',
  'missing_tool_use', 'usage_limit', 'rate_limit', 'invalid_request',
  'message_missing', 'unrecognized_message',
]);

// Revalidate each field independently; a typed transport property is not trust.
export function safeProviderDiagnostics(error, activeCredential) {
  const fields = error?.providerDiagnostics;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return {};
  const result = {};
  if (typeof fields.provider_error_code === 'string' && fields.provider_error_code) {
    result.provider_error_code = PROVIDER_ERROR_CODES.has(fields.provider_error_code)
      ? fields.provider_error_code : 'unknown';
  }
  if (['http_response', 'connect_trailer'].includes(fields.provider_error_source)) {
    result.provider_error_source = fields.provider_error_source;
  }
  if (typeof fields.provider_trace_id === 'string' && /^[0-9a-f]{16,64}$(?![\s\S])/.test(fields.provider_trace_id)
      && !(typeof activeCredential === 'string' && activeCredential && fields.provider_trace_id.includes(activeCredential))) {
    result.provider_trace_id = fields.provider_trace_id;
  }
  if (PROVIDER_REASONS.has(fields.provider_reason)) result.provider_reason = fields.provider_reason;
  return result;
}

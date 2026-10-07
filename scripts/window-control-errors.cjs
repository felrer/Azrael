'use strict';

// Classify ordinary recovery paths; unexpected implementation/provider failures
// share one public fallback instead of exposing arbitrary exception text.
const CODES = new Set(['approval_timeout', 'approval_declined', 'cancelled', 'selection_required', 'state_changed', 'permission_denied', 'timeout', 'connection_error', 'unsupported_action', 'invalid_request', 'condition_failed', 'unclassified']);
const UNCLASSIFIED = '미분류된 오류';
function windowError(code, message, options = {}) {
  const error = new Error(CODES.has(code) && code !== 'unclassified' ? message : UNCLASSIFIED, options.cause ? { cause: options.cause } : undefined);
  error.code = CODES.has(code) ? code : 'unclassified';
  for (const key of ['stage', 'nativeCode', 'mutationOutcome']) if (typeof options[key] === 'string') error[key] = options[key];
  if (options.exitCode === null || Number.isSafeInteger(options.exitCode)) error.exitCode = options.exitCode;
  if (options.signal === null || (typeof options.signal === 'string' && /^SIG[A-Z0-9]+$/.test(options.signal))) error.signal = options.signal;
  return error;
}
function errorPayload(error) {
  const code = CODES.has(error?.code) ? error.code : 'unclassified';
  const result = { code, message: code === 'unclassified' ? UNCLASSIFIED : error.message };
  for (const key of ['stage', 'nativeCode', 'mutationOutcome']) if (typeof error?.[key] === 'string' && error[key].length <= 128 && !/[\x00-\x1f]/.test(error[key])) result[key] = error[key];
  if (error?.exitCode === null || Number.isSafeInteger(error?.exitCode)) result.exitCode = error.exitCode;
  if (error?.signal === null || (typeof error?.signal === 'string' && /^SIG[A-Z0-9]+$/.test(error.signal))) result.signal = error.signal;
  return result;
}
function fromPayload(value) {
  if (!value || typeof value !== 'object' || !CODES.has(value.code) || typeof value.message !== 'string') return windowError('unclassified', UNCLASSIFIED);
  return windowError(value.code, value.message, value);
}
function classifyExpected(message) {
  if (/cancelled|disposed/i.test(message)) return 'cancelled';
  if (/approval (declined|refused)/i.test(message)) return 'approval_declined';
  if (/No selected window|Create a selected-window conversation|No selected-window session/.test(message)) return 'selection_required';
  if (/authorization revoked|permission.*denied|Native Disabled permission|authentication|trusted.*(metadata|identifier)|native.*(metadata|context|proof)/i.test(message)) return 'permission_denied';
  if (/Fresh selected-window observation|Stale or forged|identity changed|[Ww]indow .*minimized|Selected window paused|user resume required/.test(message)) return 'state_changed';
  if (/Unsupported (key|action|selected-window tool)|requested UIA pattern/.test(message)) return 'unsupported_action';
  if (/^(Invalid (arguments|string|value|scroll amount|tool arguments|execution parameter|task)|Size must be|Provide definition or macroId|Unknown (task macro|macro)|Macros require|Tasks require|Wait limit|Exact name or automationId|Key requires|Unexpected (task|condition|key))/.test(message)) return 'invalid_request';
  if (/^(Ambiguous task selector|Task selector missing|Condition property unsupported|Task condition not met|Task postcondition not met|Task requires a complete accessibility observation|Password control excluded)$/.test(message)) return 'condition_failed';
  return 'unclassified';
}
function expectedError(message, options = {}) { return windowError(classifyExpected(message), message, options); }
module.exports = { CODES, UNCLASSIFIED, windowError, expectedError, errorPayload, fromPayload };

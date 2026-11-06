'use strict';

// Classify ordinary recovery paths; unexpected implementation/provider failures
// share one public fallback instead of exposing arbitrary exception text.
const CODES = new Set(['window_busy', 'permission_pending', 'security_app_blocked', 'approval_timeout', 'approval_denied', 'cancelled', 'selection_required', 'state_changed', 'window_minimized', 'isolated_viewer_minimized', 'permission_denied', 'timeout', 'connection_error', 'unsupported_action', 'invalid_request', 'condition_failed', 'unclassified']);
const UNCLASSIFIED = '미분류된 오류';
const APPROVAL_STATES = new Set(['waiting', 'pending', 'expired', 'declined', 'cancelled', 'accepted']);
const NATIVE_PERMISSION_REASONS = new Set(['missing', 'malformed', 'not_disabled']);
const PAUSE_REASONS = new Set(['minimized', 'user_stopped', 'error']);
const RECOVERIES = new Set(['observe_again', 'reselect', 'user_resume']);
function switchedMetadata(value) {
  const out={};if(!value||typeof value!=='object'||Array.isArray(value))return out;
  const project=(source,numbers,booleans,strings=[])=>{const result={};if(!source||typeof source!=='object'||Array.isArray(source))return result;for(const key of numbers)if(Number.isSafeInteger(source[key])&&source[key]>=0)result[key]=source[key];for(const key of booleans)if(typeof source[key]==='boolean')result[key]=source[key];for(const key of strings)if(typeof source[key]==='string'&&/^[A-Za-z0-9_-]{1,96}$/.test(source[key]))result[key]=source[key];return result;};
  Object.assign(out,project(value,['operationId','deliveredInputs','activationDeliveredInputs'],['actionExecuted','appEffectVerified','applicationEffectVerified','observeRequired','duplicateOperation','delivered','cleanupPending','syntheticReleased']));
  if(value.recovery)out.recovery=project(value.recovery,['operationId','rounds','maxRounds','activeRecoveryMs','maxActiveRecoveryMs','applicationInputs'],['observeRequired','uncertainDelivery','budgetExhausted','completed'],['lastBlocker']);
  if(value.operations)out.operations=project(value.operations,['admittedHighWatermark','retainedOutcomes','retentionLimit'],[]);
  if(value.collaboration){
    const c=value.collaboration;
    out.collaboration=project(c,['probeRemainingMs','rawPackets','suppressedMouseEvents','rawSuppressionPairs','queuedHumanOperations','queuedInputOperations','pendingLogicalMoves','failureCount','lastRawEventTime','lastSuppressedEventTime','completedHumanOperations','skippedHumanOperations','lastHumanApplicationInputs'],['requested','enabled','capability_pending','failed','suppression','modelActive','lastHumanObserveRequired','rawConsumerAppsVerified','pointerAccelerationEmulated'],['phase','lastFailure','lastHumanFailure','physicalKeyboard']);
    if(c.user&&Number.isSafeInteger(c.user.x)&&Number.isSafeInteger(c.user.y))out.collaboration.user={x:c.user.x,y:c.user.y};
    if(c.systemCursor)out.collaboration.systemCursor=project(c.systemCursor,['visibilityCommands'],['supported','hidden','restorePending','guardReady'],['lastError']);
    if(c.deviceDiagnostics){
      const d=c.deviceDiagnostics;
      const safe=project(d,['snapshotMouseCount','allowedInitialArrivals','rejectedDeviceChanges','ignoredOwnRawPackets'],['mouseSnapshotReady'],['snapshotReason','preparationWaitReason']);
      if(d.lastDeviceChange)safe.lastDeviceChange=project(d.lastDeviceChange,['observedAtTick64'],['knownAtEnable','infoVerified'],['change','deviceType','phase','reason']);
      if(d.lastRaw)safe.lastRaw=project(d.lastRaw,['mouseFlags','buttonFlags','eventTime'],['knownAtEnable','absolute','ownExtraInfoLow32','ownReceiptMatched'],['deviceType','reason']);
      out.collaboration.deviceDiagnostics=safe;
    }
  }
  return out;
}
function copyApprovalDetails(source, target) {
  if (APPROVAL_STATES.has(source?.approvalState)) target.approvalState = source.approvalState;
  if (typeof source?.approvalRequestId === 'string' && /^azrael-window-consent-[a-f0-9-]{36}$/i.test(source.approvalRequestId)) target.approvalRequestId = source.approvalRequestId;
  for (const key of ['userResponded', 'actionExecuted', 'restoreAllowed', 'observationRequired', 'inputReleaseConfirmed', 'connectionRecovered']) if (typeof source?.[key] === 'boolean') target[key] = source[key];
  if (['minimized','normal','absent'].includes(source?.viewerState)) target.viewerState = source.viewerState;
  if (source?.requiredUserAction === 'restore_isolated_viewer') target.requiredUserAction = source.requiredUserAction;
  if (RECOVERIES.has(source?.recovery)) target.recovery = source.recovery;
  if (PAUSE_REASONS.has(source?.pauseReason)) target.pauseReason = source.pauseReason;
  if (NATIVE_PERMISSION_REASONS.has(source?.nativePermissionReason)) target.nativePermissionReason = source.nativePermissionReason;
  if (source?.switchedInputDetails) target.switchedInputDetails=switchedMetadata(source.switchedInputDetails);
}
function windowError(code, message, options = {}) {
  const error = new Error(CODES.has(code) && code !== 'unclassified' ? message : UNCLASSIFIED, options.cause ? { cause: options.cause } : undefined);
  error.code = CODES.has(code) ? code : 'unclassified';
  for (const key of ['stage', 'nativeCode', 'mutationOutcome']) if (typeof options[key] === 'string') error[key] = options[key];
  if (options.exitCode === null || Number.isSafeInteger(options.exitCode)) error.exitCode = options.exitCode;
  if (options.signal === null || (typeof options.signal === 'string' && /^SIG[A-Z0-9]+$/.test(options.signal))) error.signal = options.signal;
  copyApprovalDetails(options, error);
  return error;
}
function errorPayload(error) {
  const code = CODES.has(error?.code) ? error.code : 'unclassified';
  const result = { code, message: code === 'unclassified' ? UNCLASSIFIED : error.message };
  for (const key of ['stage', 'nativeCode', 'mutationOutcome']) if (typeof error?.[key] === 'string' && error[key].length <= 128 && !/[\x00-\x1f]/.test(error[key])) result[key] = error[key];
  if (error?.exitCode === null || Number.isSafeInteger(error?.exitCode)) result.exitCode = error.exitCode;
  if (error?.signal === null || (typeof error?.signal === 'string' && /^SIG[A-Z0-9]+$/.test(error.signal))) result.signal = error.signal;
  copyApprovalDetails(error, result);
  return result;
}
function fromPayload(value) {
  if (!value || typeof value !== 'object' || !CODES.has(value.code) || typeof value.message !== 'string') return windowError('unclassified', UNCLASSIFIED);
  return windowError(value.code, value.message, value);
}
function classifyExpected(message) {
  if (/cancelled|disposed/i.test(message)) return 'cancelled';
  if (/approval (declined|refused)/i.test(message)) return 'approval_denied';
  if (/No selected window|Create a selected-window conversation|No selected-window session/.test(message)) return 'selection_required';
  if (/authorization revoked|permission.*denied|Native Disabled permission|authentication|trusted.*(metadata|identifier)|native.*(metadata|context|proof)/i.test(message)) return 'permission_denied';
  if (/Fresh selected-window observation|Stale or forged|identity changed|[Ww]indow .*minimized|Selected window paused|user resume required/.test(message)) return 'state_changed';
  if (/Unsupported (key|action|selected-window tool)|requested UIA pattern/.test(message)) return 'unsupported_action';
  if (/^(Invalid (arguments|string|value|scroll amount|tool arguments|execution parameter|task|inspection mode|inspection limit|read fields|text range)|Size must be|Provide definition or macroId|Unknown (task macro|macro)|Macros require|Tasks require|Wait limit|Exact name or automationId|Key requires|Unexpected (task|condition|key)|Specify one name condition|Find requires a query|Read requires observation and element IDs|Read fields require read mode|Changes requires a base observation)/.test(message)) return 'invalid_request';
  if (/^(Ambiguous task selector|Task selector missing|Condition property unsupported|Task condition not met|Task postcondition not met|Task requires a complete accessibility observation|Password control excluded)$/.test(message)) return 'condition_failed';
  return 'unclassified';
}
function expectedError(message, options = {}) {
  if (message === 'User stop requires explicit resume' || message === 'Selected window paused by the user; explicit resume required') {
    return windowError('state_changed', '사용자가 창 제어를 중지했습니다. 다시 시작한 뒤 권한을 요청해주세요.', {
      ...options, pauseReason: 'user_stopped', recovery: 'user_resume', restoreAllowed: false, actionExecuted: false,
    });
  }
  return windowError(classifyExpected(message), message, options);
}
module.exports = { CODES, UNCLASSIFIED, windowError, expectedError, errorPayload, fromPayload, switchedMetadata };

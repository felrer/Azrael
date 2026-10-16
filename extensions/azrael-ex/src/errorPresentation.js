"use strict";

// Self-contained for the standalone host and guarded native renderer transform.
function describeTurnError(value) {
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const str = value => typeof value === "string" ? value : undefined;
  const info = object(value) ? value.codexErrorInfo : undefined;
  const code = typeof info === "string" ? info : object(info) && Object.keys(info).length === 1 ? Object.keys(info)[0] : undefined;
  const detail = object(value) ? str(value.message) : undefined;
  if (code === "badRequest") {
    const requestGuards = [
      "The provider account was removed. Work was stopped. Select a healthy account before continuing.",
      "The provider account requires reauthentication. Work was stopped. Sign in again or select a healthy account before continuing.",
      "Attached images exceed the provider request limit. Remove images or start a new thread.",
      ...["unsupported_image_format", "remote_image_unsupported", "invalid_image_input"].map(code =>
        `This provider accepts PNG, JPEG, GIF or WebP image attachments only (${code})`),
    ];
    if (detail !== undefined && requestGuards.includes(detail)) return detail;
  }
  if (code === "other") {
    const watchdogGuards = [
      "Fatal error: response preparation exceeded its 90s deadline",
      "Fatal error: native inference helper became idle",
      "Fatal error: native inference produced no output frames for 120s",
      "Fatal error: native inference request exceeded its deadline",
      "Fatal error: native inference helper unresponsive (no protocol frames for 120s)",
      ...["provider_headers_timeout", "provider_stream_idle", "provider_request_deadline"].map(code =>
        `Fatal error: native inference helper failed (${code})`),
    ];
    if (detail !== undefined && watchdogGuards.includes(detail)) return detail;
    const causes = {
      provider_headers_failed: "모델 응답 헤더를 받기 전에 요청이 실패했습니다. 원인은 확인되지 않았습니다.",
      provider_connection_dns: "모델 서버 주소의 DNS 조회에 실패했습니다.",
      provider_connection_tls: "모델 서버와의 TLS 연결에 실패했습니다.",
      provider_connection_reset: "모델 서버와의 연결이 끊어졌습니다.",
      provider_connection_refused: "모델 서버 연결이 거부됐습니다.",
      provider_connection_timeout: "모델 서버 연결 대기 시간이 초과됐습니다.",
      provider_connection_unreachable: "모델 서버에 연결할 네트워크 경로를 사용할 수 없습니다.",
      provider_connection_proxy: "프록시 연결에 실패했습니다.",
    };
    for (const [connectionCode, cause] of Object.entries(causes)) {
      const safe = `${cause} 연결 상태와 기존 작업 결과를 확인한 뒤 이 세션에서 다시 요청하세요.`;
      if (detail === `Fatal error: ${safe} (${connectionCode})`) return safe;
    }
  }
  if ((code === "badRequest" || code === "other") && detail && !/[\r\n]/.test(detail) &&
      /^The '[A-Za-z0-9][A-Za-z0-9._/-]*' model is not supported when using Codex with a ChatGPT account\.$/.test(detail)) {
    return "The selected model is unavailable to this ChatGPT account. Choose an available model or sign in with the intended account.";
  }
  switch (code) {
    case "unauthorized": return "The selected provider rejected authentication. Check account authentication before resuming.";
    case "usageLimitExceeded": return "The provider usage limit was reached. Check account usage before resuming.";
    case "sessionBudgetExceeded": return "The session budget was reached. Check the session budget before resuming.";
    case "rateLimitExceeded": {
      // The historical helper assigned this message to ambiguous HTTP 429s too.
      if (detail === "rate limit exceeded: Provider request rate limit reached. Try again later.") return "정의되지 않은 오류";
      const details = ["모델 호출 제한에 도달했습니다.", "모델 요청 수 제한에 도달했습니다.",
        "모델 입력 토큰 처리량 제한에 도달했습니다.", "모델 출력 토큰 처리량 제한에 도달했습니다.",
        "모델 토큰 처리량 제한에 도달했습니다.", "모델 동시 요청 수 제한에 도달했습니다.", "모델 요청 증가율 제한에 도달했습니다."];
      return details.find(message => detail === `rate limit exceeded: ${message}`) ??
        "The provider rate limit was reached. Wait before resuming this thread.";
    }
    case "httpConnectionFailed":
    case "responseStreamConnectionFailed":
    case "responseStreamDisconnected": return "The provider connection or response stream was interrupted. Review the thread before resuming; a tool result may be uncertain.";
    case "responseTooManyFailedAttempts":
    case "serverOverloaded":
    case "internalServerError": return "The provider could not complete this turn. Wait and review the thread before resuming.";
    case "contextWindowExceeded": return "The context window is full. Compact the thread before continuing.";
    case "badRequest": return "The provider rejected this request. Check the selected model and input before retrying.";
    case "sandboxError": return "A local tool or sandbox action failed. Review the tool result before continuing.";
    default: return "정의되지 않은 오류";
  }
}

module.exports = { describeTurnError };

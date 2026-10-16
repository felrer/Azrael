"use strict";

// Match the host runtime's physical-path rendezvous: Windows can load one CJS
// file twice under C: and c:, including once from the native bundle and once
// from the integrated entry point.
const physicalPath = require("node:fs").realpathSync.native(__filename);
const runtimeKey = process.platform === "win32" ? physicalPath.toLowerCase() : physicalPath;
const registry = globalThis[Symbol.for("azrael-ex.recovery-runtimes.v1")] ??= new Map();
if (registry.has(runtimeKey)) {
  module.exports = registry.get(runtimeKey);
} else {
const { randomUUID, createHash } = require("node:crypto");
const { RecoveryState } = require("./recovery-state.cjs");
const { diagnosticsEnabled } = require("./optional-diagnostics.cjs");
const routineEvents = new Set(["recovery.rpc_dispatch", "recovery.rpc_result",
  "recovery.request_dispatch", "recovery.request_result", "host.user_message_received",
  "host.rpc_response_received"]);
const controllers = new Map();
const hostRequests = new WeakMap();
const MAX_HOST_REQUESTS = 128;
const HOST_REQUEST_TTL_MS = 5 * 60 * 1000;
const MAX_LATE_RESPONSES = 64;
let ui;
const labels = {
  recovering: "서버 연결 중 · 세션 확인", starting: "전송 대기 중", waiting: "응답 대기 중",
  responding: "응답 생성 중", tool: "도구 실행 중", approval: "승인 대기", input: "입력 대기",
  completed: "완료", interrupted: "중단됨", idle: "대기 중", error: "실행 오류",
  disconnected: "연결 끊김 · 상태 확인 필요", unknown: "재개 결과 확인 필요", interrupting: "중단 완료 확인 중",
};

// Diagnostic references are stable within a session but never expose caller IDs,
// which are supplied by providers and could themselves contain private text.
function reference(value) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}
function safeMethod(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*){0,3}$/i.test(value) && value.length <= 64
    ? value : "unknown";
}
function rpcCode(error) { return Number.isSafeInteger(error?.code) ? error.code : undefined; }
// Exact local guards and native fixed messages establish a cause. Arbitrary RPC
// codes are not HTTP statuses, and quoted server text is not evidence.
const recoveryErrors = new Map([
  ...[
    "재개 기록을 읽을 수 없습니다. 저장소를 확인해주세요.",
    "미완료 재개 기록이 가득 찼습니다. 먼저 기존 작업 상태를 확인해주세요.",
    "재개 기록 저장에 실패했습니다. 저장소를 확인한 뒤 다시 시도해주세요.",
    "중단 완료를 확인하지 못했습니다. 새 작업은 시작하지 않았습니다.",
    "실행 상태가 갱신 중입니다. 상태를 다시 확인해주세요.",
    "엔진 상태를 확인한 뒤 재개해주세요.",
    "이전 재개 요청의 결과가 불명확합니다. Ctrl+Shift+P → ‘azrael: 실행 상태 및 복구’에서 이 세션을 선택한 뒤 ‘대화 기록을 확인했으며 새 재개 실행’을 선택해주세요.",
    "스레드 복구가 완료되지 않았습니다.",
    "상태 확인 요청이 많습니다. 잠시 후 다시 시도해주세요.",
    "Fatal error: session task panicked",
    "The provider account was removed. Work was stopped. Select a healthy account before continuing.",
    "The provider account requires reauthentication. Work was stopped. Sign in again or select a healthy account before continuing.",
    "Attached images exceed the provider request limit. Remove images or start a new thread.",
    ...["unsupported_image_format", "remote_image_unsupported", "invalid_image_input"].map(code =>
      `This provider accepts PNG, JPEG, GIF or WebP image attachments only (${code})`),
    "Selected model is at capacity. Please try a different model.",
    "Flex capacity unavailable.",
  ].map(message => [message, "unknown"]),
  ...[
    "연결이 변경되었습니다. 상태를 다시 확인해주세요.",
    "엔진 연결에 실패했습니다. 상태를 다시 확인해주세요.",
    "엔진 연결이 끊겼습니다. 상태를 다시 확인해주세요.",
  ].map(message => [message, "connection"]),
  ...[
    "20초 안에 엔진 응답을 받지 못했습니다. 실행 여부를 확인한 뒤 재개해주세요.",
    "Fatal error: response preparation exceeded its 90s deadline",
    "Fatal error: native inference helper became idle",
    "Fatal error: native inference produced no output frames for 120s",
    "Fatal error: native inference request exceeded its deadline",
    "Fatal error: native inference helper unresponsive (no protocol frames for 120s)",
    ...["provider_headers_timeout", "provider_stream_idle", "provider_request_deadline"].map(code =>
      `Fatal error: native inference helper failed (${code})`),
  ].map(message => [message, "timeout"]),
  ...["모델 호출 제한에 도달했습니다.", "모델 요청 수 제한에 도달했습니다.",
    "모델 입력 토큰 처리량 제한에 도달했습니다.", "모델 출력 토큰 처리량 제한에 도달했습니다.",
    "모델 토큰 처리량 제한에 도달했습니다.", "모델 동시 요청 수 제한에 도달했습니다.", "모델 요청 증가율 제한에 도달했습니다."].map(message => [`rate limit exceeded: ${message}`, "usage_rate_limit"]),
  ...Object.entries({
    provider_headers_failed: "모델 응답 헤더를 받기 전에 요청이 실패했습니다. 원인은 확인되지 않았습니다.",
    provider_connection_dns: "모델 서버 주소의 DNS 조회에 실패했습니다.",
    provider_connection_tls: "모델 서버와의 TLS 연결에 실패했습니다.",
    provider_connection_reset: "모델 서버와의 연결이 끊어졌습니다.",
    provider_connection_refused: "모델 서버 연결이 거부됐습니다.",
    provider_connection_timeout: "모델 서버 연결 대기 시간이 초과됐습니다.",
    provider_connection_unreachable: "모델 서버에 연결할 네트워크 경로를 사용할 수 없습니다.",
    provider_connection_proxy: "프록시 연결에 실패했습니다.",
  }).map(([code, cause]) => [`Fatal error: ${cause} 연결 상태와 기존 작업 결과를 확인한 뒤 이 세션에서 다시 요청하세요. (${code})`, "connection"]),
]);
function structuredCategory(error) {
  const info = error?.codexErrorInfo;
  return typeof info === "string" ? info : info && typeof info === "object" && !Array.isArray(info) &&
    Object.keys(info).length === 1 ? Object.keys(info)[0] : info === undefined ? undefined : "unknownStructuredCategory";
}
function knownMessageCategory(message) {
  if (recoveryErrors.has(message)) return recoveryErrors.get(message);
  if (typeof message !== "string" || message.length > 512 || /[\r\n]/.test(message)) return undefined;
  // Same complete historical server-message guards as recovery-state.cjs.
  if (/^stream disconnected before completion: An error occurred while processing your request\. You can retry your request, or contact us through our help center at help\.openai\.com if the error persists\. Please include the request ID [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} in your message\.$/.test(message) ||
      /^The '[A-Za-z0-9][A-Za-z0-9._/-]*' model is not supported when using Codex with a ChatGPT account\.$/.test(message)) return "unknown";
  return undefined;
}
function errorCategory(error) {
  const category = structuredCategory(error);
  if (category === "rateLimitExceeded" && error?.message === "rate limit exceeded: Provider request rate limit reached. Try again later.") return "unknown";
  if (category !== undefined && category !== "other") {
    if (category === "unauthorized") return "auth";
    if (["rateLimitExceeded", "usageLimitExceeded", "sessionBudgetExceeded"].includes(category)) return "usage_rate_limit";
    if (["httpConnectionFailed", "responseStreamConnectionFailed", "responseStreamDisconnected"].includes(category)) return "connection";
    if (category === "sandboxError") return "tool";
    return "unknown";
  }
  if ([-32700, -32600, -32601, -32602].includes(rpcCode(error))) return "protocol";
  return knownMessageCategory(error?.message) ?? "unknown";
}
function recoveryErrorMessage(error) {
  const known = knownMessageCategory(error?.message);
  if (known === undefined) return "정의되지 않은 오류";
  const category = structuredCategory(error);
  if (category !== undefined && category !== "other") {
    if (known === "unknown") {
      const message = error.message;
      const requestGuard = category === "badRequest" &&
        (/^The '[A-Za-z0-9][A-Za-z0-9._/-]*' model is not supported when using Codex with a ChatGPT account\.$/.test(message) ||
          message.startsWith("The provider account ") || message.startsWith("Attached images exceed ") || message.startsWith("This provider accepts "));
      const capacityGuard = category === "serverOverloaded" && message === "Selected model is at capacity. Please try a different model." ||
        category === "flexUnavailable" && message === "Flex capacity unavailable.";
      if (!requestGuard && !capacityGuard) return "정의되지 않은 오류";
    } else if (errorCategory(error) !== known) return "정의되지 않은 오류";
  }
  return error.message;
}
function requestBook(host) {
  let book = hostRequests.get(host);
  if (!book) { book = new Map(); hostRequests.set(host, book); }
  const cutoff = Date.now() - HOST_REQUEST_TTL_MS;
  for (const [key, entry] of book) if (entry.started < cutoff) book.delete(key);
  return book;
}
function hostDiagnostic(event, entry, error, extra = {}) {
  ui?.log({ event, requestId: reference(entry.id), method: entry.method,
    threadRef: reference(entry.threadId), elapsedMs: Math.max(0, Date.now() - entry.started),
    rpcCode: rpcCode(error), errorCategory: errorCategory(error, entry.method), ...extra });
}

function initialize(context, vscode, options = {}) {
  if (ui) throw new Error("Azrael recovery is already initialized.");
  const output = vscode.window.createOutputChannel("Azrael Recovery", { log: true });
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 30);
  status.name = "Azrael 실행 상태";
  status.command = "azrael.recoveryStatus";
  let timer;
  let disposed = false;
  let droppedDiagnostics = 0;
  let lastRedraw = 0;
  const redraw = () => {
    if (disposed) return;
    if (Date.now() - lastRedraw < 250) return;
    lastRedraw = Date.now();
    const entries = [...controllers.values()].flatMap(c => c.state.list()).sort((a, b) => b.updatedAt - a.updatedAt);
    const latest = entries[0];
    if (!latest) { status.hide(); return; }
    const icon = latest.phase === "recovering" || latest.phase === "starting" ? "loading~spin" : "pulse";
    status.text = `$(${icon}) Azrael: ${latest.delayed ? "진행 지연 · " : ""}${labels[latest.phase]}`;
    status.tooltip = `세션 ${latest.threadId}\n${latest.delayed ? "90초 동안 새 진행 신호가 없습니다. 실행 중단을 뜻하지 않습니다.\n" : ""}클릭하여 상태 확인 또는 중단 후 재개`;
    status.show();
  };
  ui = { store: context.storageUri ? context.workspaceState : context.globalState, redraw, requiresManualResume: options.requiresManualResume,
    log: record => {
      if (disposed) return;
      if (routineEvents.has(record.event) && record.outcome !== "rpc_error" &&
          !diagnosticsEnabled("RECOVERY")) return;
      try { output.info(JSON.stringify({ ...record, hostPid: process.pid, droppedDiagnostics })); }
      catch { droppedDiagnostics++; }
    } };
  // Read only the installed host's own identity; never serialize the environment.
  const path = require("node:path");
  const fs = require("node:fs");
  try {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "azrael-runtime.json"), "utf8"));
    ui.log({ event: "recovery.runtime", diagnosticSchema: 1,
      hostVersion: context.extension?.packageJSON?.version ?? "unknown",
      hostModule: physicalPath, engine: config.engine, bridge: config.bridge,
      release: config.devinNative?.releaseDirectory ?? "none", nodeVersion: process.version,
      identitySource: "host_configuration" });
  } catch {
    ui.log({ event: "recovery.runtime", diagnosticSchema: 1, hostModule: physicalPath,
      identitySource: "unavailable", nodeVersion: process.version });
  }
  const command = vscode.commands.registerCommand("azrael.recoveryStatus", async () => {
    const entries = [...controllers.values()].flatMap(controller => controller.state.list().map(s => ({
      label: `${s.delayed ? "진행 지연 · " : ""}${labels[s.phase]}`,
      description: s.threadId, controller, state: s,
    })));
    if (!entries.length) {
      await vscode.window.showInformationMessage("대화를 열거나 작업을 시작하면 실행 상태가 표시됩니다.");
      return;
    }
    const selected = await vscode.window.showQuickPick(entries, { title: "Azrael 실행 상태", placeHolder: "상태를 확인할 세션" });
    if (!selected) return;
    const action = await vscode.window.showQuickPick([
      { label: "상태 다시 확인", action: "refresh" },
      { label: selected.state.uncertain ? "대화 기록을 확인했으며 새 재개 실행" : "중단 후 재개", action: "recover",
        detail: selected.state.uncertain ? "이전 요청의 실행 결과는 불명확합니다. 실행 중인 턴은 먼저 중단합니다." : "실행 중인 턴의 중단 완료를 확인한 뒤 이어서 진행합니다." },
    ], { title: selected.state.threadId });
    if (!action) return;
    try {
      if (action.action === "refresh") await selected.controller.state.refresh(selected.state.threadId);
      else await selected.controller.state.recover(selected.state.threadId, selected.state.uncertain);
    } catch (error) {
      // Preserve native actionable errors in the UI, without copying server
      // payloads or prompts into recovery diagnostics.
      await vscode.window.showErrorMessage(recoveryErrorMessage(error));
    }
  });
  timer = setInterval(redraw, 1000);
  timer.unref?.();
  const disposable = { dispose() {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    for (const controller of controllers.values()) controller.dispose();
    controllers.clear();
    status.dispose();
    command.dispose();
    output.dispose();
    ui = undefined;
  } };
  context.subscriptions.push(disposable);
  return disposable;
}

class BridgeController {
  constructor(host, raw) {
    this.host = host;
    this.raw = raw;
    this.pending = new Map();
    // Retain only bounded, content-free metadata after a deadline. A late
    // response is evidence about delivery, never permission to replay a send.
    this.expired = new Map();
    this.requests = new Map();
    this.provider = `azrael-recovery-${randomUUID()}`;
    this.state = new RecoveryState({ store: ui.store, rpc: (method, params, timeout) => this.rpc(method, params, timeout),
      changed: ui.redraw, log: ui.log, requiresManualResume: ui.requiresManualResume });
    this.registration = host.registerProvider(this.provider, {
      onResult: message => {
        const pending = this.pending.get(message.id);
        if (!pending) {
          this.pruneExpired();
          const expired = this.expired.get(message.id);
          if (expired) {
            this.expired.delete(message.id);
            ui?.log({ event: "recovery.rpc_late_result", ...expired,
              elapsedMs: Date.now() - expired.started,
              lateByMs: Date.now() - expired.timedOutAt,
              outcome: message.error ? "rpc_error" : "success",
              rpcCode: rpcCode(message.error), disposition: "ignored_after_timeout" });
          }
          return;
        }
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        ui?.log({ event: "recovery.rpc_result", requestId: message.id, method: pending.method,
          requestRef: pending.requestRef, threadRef: reference(pending.threadId),
          threadId: pending.threadId, elapsedMs: Date.now() - pending.started,
          outcome: message.error ? "rpc_error" : "success",
          rpcCode: Number.isSafeInteger(message.error?.code) ? message.error.code : undefined });
        if (message.error) {
          const error = new Error(message.error.message ?? "엔진 요청이 실패했습니다.");
          error.rpcError = message.error;
          pending.reject(error);
        }
        else pending.resolve(message.result);
      },
      onRequestDelivery: event => {
        this.forwardDelivery(event.delivery.requestId, event);
        this.disconnect();
      },
      onFatalError: () => this.disconnect(),
    });
  }

  pruneExpired() {
    const cutoff = Date.now() - HOST_REQUEST_TTL_MS;
    for (const [id, entry] of this.expired) if (entry.timedOutAt < cutoff) this.expired.delete(id);
  }

  rpc(method, params, timeout = 20000) {
    if (this.pending.size >= 64) return Promise.reject(new Error("상태 확인 요청이 많습니다. 잠시 후 다시 시도해주세요."));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const requestRef = reference(`${this.provider}:${id}`);
      ui?.log({ event: "recovery.rpc_dispatch", requestId: id, method, threadId: params.threadId,
        requestRef, threadRef: reference(params.threadId),
        originalRequestIds: [...this.requests.values()].filter(request =>
          request.method === method && request.threadId === params.threadId).map(request => request.id) });
      const timer = setTimeout(() => {
        ui?.log({ event: "recovery.rpc_timeout", requestId: id, method, threadId: params.threadId,
          requestRef, threadRef: reference(params.threadId),
          timeoutMs: timeout });
        this.pruneExpired();
        if (this.expired.size >= MAX_LATE_RESPONSES) this.expired.delete(this.expired.keys().next().value);
        const pending = this.pending.get(id);
        this.expired.set(id, { requestRef, threadRef: reference(params.threadId), method: safeMethod(method),
          started: pending?.started ?? Date.now(), timedOutAt: Date.now(), timeoutMs: timeout });
        this.forwardDelivery(id, { type: "outcome-unknown", delivery: { requestId: id, method, stage: "outcome-unknown" } });
        this.pending.delete(id);
        // Release native delivery tracking as well as our bounded promise.
        this.clearNativeRequest(id);
        reject(new Error("20초 안에 엔진 응답을 받지 못했습니다. 실행 여부를 확인한 뒤 재개해주세요."));
      }, timeout);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, method, threadId: params.threadId, requestRef, started: Date.now() });
      try { this.raw(this.provider, id, method, params, false, true); }
      catch {
        ui?.log({ event: "recovery.rpc_send_failed", requestId: id, method, threadId: params.threadId });
        clearTimeout(timer);
        this.pending.delete(id);
        this.clearNativeRequest(id);
        reject(new Error("엔진 연결에 실패했습니다. 상태를 다시 확인해주세요."));
      }
    });
  }

  forwardDelivery(id, event) {
    const pending = this.pending.get(id);
    if (!pending || pending.notified) return;
    pending.notified = true;
    for (const original of this.requests.values()) {
      if (original.reportDelivery && original.method === pending.method && original.threadId === pending.threadId) {
        this.host.providers.get(original.provider)?.onRequestDelivery?.({ ...event,
          delivery: { ...event.delivery, requestId: original.id, method: original.method } });
      }
    }
  }

  clearNativeRequest(id) {
    const key = `${this.provider}:${id}`;
    this.host.abandonRequest(this.provider, id);
    if (this.host.pendingTurnStartRequestIds.delete(key)) {
      this.host.turnCwds.observeResponse(key, "turn/start", { error: { code: -32001 } });
    }
  }

  disconnect() {
    ui?.log({ event: "recovery.bridge_disconnected", pendingRequests: this.pending.size });
    for (const [id, pending] of this.pending) {
      this.forwardDelivery(id, { type: "outcome-unknown", delivery: { requestId: id, method: pending.method, stage: "outcome-unknown" } });
      clearTimeout(pending.timer);
      this.clearNativeRequest(id);
      pending.reject(new Error("엔진 연결이 끊겼습니다. 상태를 다시 확인해주세요."));
    }
    this.pending.clear();
    this.expired.clear();
    this.state.disconnect();
  }

  dispatch([provider, id, method, params, _prewarm, reportDelivery]) {
    const key = `${provider}:${id}`;
    this.requests.set(key, { provider, id, method, threadId: params.threadId, reportDelivery });
    const clientMessageHash = typeof params.clientUserMessageId === "string" && params.clientUserMessageId.length > 0
      ? createHash("sha256").update(params.clientUserMessageId).digest("hex") : undefined;
    ui?.log({ event: "recovery.request_dispatch", requestId: id, threadId: params.threadId, method, clientMessageHash });
    const action = method === "thread/resume" ? this.state.resume(params) :
      method === "turn/steer" ? this.state.steer(params) : this.state.start(params);
    void action.then(result => {
      this.requests.delete(key);
      ui?.log({ event: "recovery.request_result", requestId: id, threadId: params.threadId, method,
        clientMessageHash, outcome: "accepted", turnId: result.turn?.id ?? result.turnId });
      this.host.providers.get(provider)?.onResult?.({ id, result });
    }, error => {
      this.requests.delete(key);
      this.host.providers.get(provider)?.onResult?.({ id, error: error.rpcError ?? { code: -32001, message: error.message } });
      ui?.log({ event: "recovery.request_failed", requestId: id, threadId: params.threadId, method,
        clientMessageHash, outcome: error.rpcError ? "rejected" : "unconfirmed" });
    });
  }

  dispose() {
    this.disconnect();
    this.registration.dispose();
  }
}

function dispatch(host, args, raw) {
  const [, , method, params] = args;
  if (!["thread/resume", "turn/start", "turn/steer"].includes(method) || typeof params?.threadId !== "string") {
    if (!ui) return raw(...args);
    const [provider, id] = args;
    const key = `${provider}:${id}`;
    const book = requestBook(host);
    const entry = { id: key, method: safeMethod(method), threadId: params?.threadId, started: Date.now() };
    // The bridge may deliver a synchronous response, so track before sending.
    if (book.size >= MAX_HOST_REQUESTS) book.delete(book.keys().next().value);
    book.set(key, entry);
    try { return raw(...args); }
    catch (error) {
      book.delete(key);
      hostDiagnostic("host.rpc_send_failed", entry, error);
      throw error;
    }
  }
  if (!ui) {
    host.providers.get(args[0])?.onResult?.({ id: args[1], error: { code: -32001, message: "Azrael 복구 모듈을 초기화하지 못했습니다." } });
    return;
  }
  try {
    let controller = controllers.get(host);
    if (!controller) {
      controller = new BridgeController(host, raw);
      controllers.set(host, controller);
    }
    controller.dispatch(args);
  } catch {
    host.providers.get(args[0])?.onResult?.({ id: args[1], error: { code: -32001, message: "재개 기록을 확인할 수 없습니다. Azrael 저장소를 확인해주세요." } });
  }
}

function observe(host, message) {
  try {
    if (ui && message && typeof message === "object") {
      if ((message.method === "item/started" || message.method === "item/completed") &&
          message.params?.item?.type === "userMessage" &&
          typeof message.params.threadId === "string" &&
          typeof message.params.item.clientId === "string") {
        ui.log({ event: "host.user_message_received", stage: message.method === "item/started" ? "started" : "completed",
          threadRef: reference(message.params.threadId), turnRef: reference(message.params.turnId),
          itemRef: reference(message.params.item.id),
          clientMessageHash: createHash("sha256").update(message.params.item.clientId).digest("hex") });
      }
      const book = requestBook(host);
      const controller = controllers.get(host);
      const prefix = controller && `${controller.provider}:`;
      if (typeof message.id === "string" && prefix && message.id.startsWith(prefix) &&
          (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
        controller.pruneExpired();
        const id = message.id.slice(prefix.length);
        const pending = controller.pending.get(id);
        // Observe receipt before the native router and private provider callback.
        // The full wire ID hash is shared with native app-server diagnostics.
        ui.log({ event: "host.rpc_response_received", requestRef: reference(message.id),
          threadRef: reference(pending?.threadId) ?? controller.expired.get(id)?.threadRef,
          method: pending ? safeMethod(pending.method) : controller.expired.get(id)?.method,
          tracking: pending ? "pending" : controller.expired.has(id) ? "expired" : "untracked",
          outcome: message.error ? "rpc_error" : "success", rpcCode: rpcCode(message.error) });
      }
      if (typeof message.id === "string" && book.has(message.id)) {
        const entry = book.get(message.id);
        book.delete(message.id);
        if (message.error) hostDiagnostic("host.rpc_error", entry, message.error);
      } else if (message.id === undefined && (message.error || message.params?.error)) {
        const method = safeMethod(message.method);
        const error = message.error ?? message.params.error;
        ui.log({ event: "host.notification_error", method, rpcCode: rpcCode(error),
          errorCategory: errorCategory(error, method) });
      }
    }
  } catch { /* Diagnostics never affect native message delivery. */ }
  try { controllers.get(host)?.state.observe(message); }
  catch (error) { ui?.log({ event: "recovery.notification_error", errorCategory: errorCategory(error, message?.method) }); }
}

function disconnect(host) {
  const book = hostRequests.get(host);
  if (book) {
    for (const entry of book.values()) hostDiagnostic("host.transport_disconnected", entry,
      { code: -32001 }, { outcome: "unknown", errorCategory: "connection" });
    book.clear();
    hostRequests.delete(host);
  }
  controllers.get(host)?.disconnect();
}

module.exports = { initialize, dispatch, observe, disconnect };
registry.set(runtimeKey, module.exports);
}

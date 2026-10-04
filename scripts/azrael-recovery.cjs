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
const controllers = new Map();
const hostRequests = new WeakMap();
const MAX_HOST_REQUESTS = 128;
const HOST_REQUEST_TTL_MS = 5 * 60 * 1000;
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
function errorCategory(error, method) {
  const code = rpcCode(error);
  const message = typeof error?.message === "string" ? error.message.slice(0, 512).toLowerCase() : "";
  if (code === 401 || code === 403 || /(?:auth|unauthori[sz]ed|forbidden|credential|login|sign.in)/.test(message)) return "auth";
  if (code === 429 || /(?:rate.limit|quota|usage.limit|billing|capacity|too many requests)/.test(message)) return "usage_rate_limit";
  if (code === 408 || code === 504 || /(?:timed? out|deadline)/.test(message)) return "timeout";
  if ([502, 503].includes(code) || /(?:disconnect|connection|network|socket|econn|unavailable)/.test(message)) return "connection";
  if (typeof method === "string" && /(?:^|\/)tool(?:\/|$)/i.test(method) || /(?:tool.call|tool execution|tool failed)/.test(message)) return "tool";
  if ([-32700, -32600, -32601, -32602].includes(code) || /(?:protocol|parse error|invalid request|invalid params)/.test(message)) return "protocol";
  return "unknown";
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

function initialize(context, vscode) {
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
  ui = { store: context.storageUri ? context.workspaceState : context.globalState, redraw,
    log: record => {
      if (disposed) return;
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
      await vscode.window.showErrorMessage(error.message);
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
    this.requests = new Map();
    this.provider = `azrael-recovery-${randomUUID()}`;
    this.state = new RecoveryState({ store: ui.store, rpc: (method, params, timeout) => this.rpc(method, params, timeout),
      changed: ui.redraw, log: ui.log });
    this.registration = host.registerProvider(this.provider, {
      onResult: message => {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        ui?.log({ event: "recovery.rpc_result", requestId: message.id, method: pending.method,
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

  rpc(method, params, timeout = 20000) {
    if (this.pending.size >= 64) return Promise.reject(new Error("상태 확인 요청이 많습니다. 잠시 후 다시 시도해주세요."));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      ui?.log({ event: "recovery.rpc_dispatch", requestId: id, method, threadId: params.threadId,
        originalRequestIds: [...this.requests.values()].filter(request =>
          request.method === method && request.threadId === params.threadId).map(request => request.id) });
      const timer = setTimeout(() => {
        ui?.log({ event: "recovery.rpc_timeout", requestId: id, method, threadId: params.threadId,
          timeoutMs: timeout });
        this.forwardDelivery(id, { type: "outcome-unknown", delivery: { requestId: id, method, stage: "outcome-unknown" } });
        this.pending.delete(id);
        // Release native delivery tracking as well as our bounded promise.
        this.clearNativeRequest(id);
        reject(new Error("20초 안에 엔진 응답을 받지 못했습니다. 실행 여부를 확인한 뒤 재개해주세요."));
      }, timeout);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, method, threadId: params.threadId, started: Date.now() });
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
      const book = requestBook(host);
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

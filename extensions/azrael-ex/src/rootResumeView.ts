import * as vscode from "vscode";
import { AccountService } from "./accountService";
import { RootResumeReservation, RootResumeState, isActiveRootResumeState, parseRootResumeMessage } from "./rootResumeProtocol";

const POLL_INTERVAL_MS = 30_000;
const MANAGEMENT_DISCONNECTED = "재개 관리 연결을 사용할 수 없습니다. 재접속해 예약 상태를 확인해 주세요. 자동 재개 실행 여부는 별도입니다.";
interface EmbeddedMount {
  clientId: string;
  pending: string | null;
  error: string | null;
  errorKind: "connection" | "request" | null;
  requestVersion: number;
  disposal?: vscode.Disposable;
}
const STATE_LABELS: Record<RootResumeState, string> = {
  preparing: "준비 중",
  waiting: "대기 중",
  claimed: "재개 처리 중",
  resumed: "재개됨",
  cancelled: "취소됨",
  blocked: "재개 차단됨"
};

export class RootResumeView implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private refreshing = false;
  private mutating = false;
  private error: string | undefined;
  private errorKind: "connection" | "request" | undefined;
  private connectionVersion = 0;
  private reconnecting: Promise<void> | undefined;
  private disposed = false;
  private readonly embedded = new Map<vscode.Webview, EmbeddedMount>();
  private readonly reservationListener = () => {
    if (this.service.rootResumeAvailable) this.clearConnectionErrors();
    this.render();
    void this.broadcastEmbedded();
  };
  private readonly connectionListener = (connected: boolean) => {
    this.connectionVersion++;
    if (!connected && this.errorKind !== "request") {
      this.error = MANAGEMENT_DISCONNECTED;
      this.errorKind = "connection";
    }
    this.render();
    void this.broadcastEmbedded();
    if (connected && !this.reconnecting && (this.panel?.visible || this.embedded.size)) void this.refreshReservations();
  };
  private readonly accountErrorListener = (error: string) => {
    if (this.errorKind !== "request") { this.error = rootResumeError(error); this.errorKind = "connection"; }
    this.render(); void this.broadcastEmbedded();
  };

  constructor(private readonly service: AccountService) {
    service.on("rootResume", this.reservationListener);
    service.on("rootResumeConnection", this.connectionListener);
    service.on("errorState", this.accountErrorListener);
  }

  show(): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel("azrael.rootResume", "루트 재개 예약", vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true
      });
      this.panel.webview.onDidReceiveMessage((message) => { void this.onMessage(message); });
      this.panel.onDidChangeViewState(() => this.onVisibility());
      this.panel.onDidDispose(() => { this.panel = undefined; this.stopPolling(); });
    }
    this.panel.reveal();
    this.onVisibility();
  }

  async handleEmbedded(webview: vscode.Webview, value: unknown, panel?: vscode.WebviewPanel): Promise<void> {
    if (!value || typeof value !== "object") return;
    const message = value as Record<string, unknown>;
    if (message.type !== "azrael-root-resume" || typeof message.clientId !== "string" || !message.clientId || message.clientId.length > 512) return;
    if (message.action === "subscribe") {
      this.embedded.get(webview)?.disposal?.dispose();
      const mount: EmbeddedMount = { clientId: message.clientId, pending: null, error: null, errorKind: null, requestVersion: 0 };
      this.embedded.set(webview, mount);
      mount.disposal = panel?.onDidDispose(() => { if (this.embedded.get(webview) === mount) this.embedded.delete(webview); });
    }
    const mount = this.embedded.get(webview);
    if (!mount || mount.clientId !== message.clientId) return;
    if (message.action === "unsubscribe") { mount.disposal?.dispose(); this.embedded.delete(webview); return; }
    if (message.action === "reconnect") { await this.reconnect(); return; }
    const request = message.action === "subscribe" ? { action: "list" as const } : parseRootResumeMessage(
      message.action === "list" ? { action: message.action } : { action: message.action, reservationId: message.reservationId, revision: message.revision });
    if (!request || request.action === "cancel") return;
    if (request.action === "resume" && (this.mutating || this.reconnecting)) { mount.error = "다른 재개 요청을 처리 중입니다. 잠시 후 다시 시도해 주세요."; mount.errorKind = "request"; await this.broadcastEmbedded(); return; }
    const version = ++mount.requestVersion;
    const connectionVersion = this.connectionVersion;
    const current = () => !this.disposed && this.embedded.get(webview) === mount && version === mount.requestVersion && connectionVersion === this.connectionVersion;
    if (request.action === "resume") { this.mutating = true; mount.pending = request.reservationId; mount.error = null; }
    await this.broadcastEmbedded();
    try {
      await this.service.rootResume(request);
      if (current()) { mount.error = null; mount.errorKind = null; }
    }
    catch (error) {
      // A superseded read must not overwrite a newer connection or request.
      // A sent mutation's uncertain outcome still belongs to this surface.
      if (current() || (request.action === "resume" && this.embedded.get(webview) === mount)) {
        mount.error = rootResumeError(error);
        mount.errorKind = request.action === "resume" || this.service.rootResumeAvailable ? "request" : "connection";
      }
      // Losing an optimistic revision race must update the displayed targets
      // before another click. Never retry a mutation with a newer revision.
      if (request.action === "resume") await this.service.rootResume({ action: "list" }).catch(() => {});
    } finally {
      if (request.action === "resume") { this.mutating = false; mount.pending = null; }
      await this.broadcastEmbedded();
    }
  }

  private async broadcastEmbedded(): Promise<void> {
    await Promise.all([...this.embedded].map(([webview, mount]) => webview.postMessage({ type: "azrael-root-resume-state", clientId: mount.clientId,
      reservations: this.service.rootResumeReservations ?? [], available: this.service.rootResumeAvailable, connectionError: this.errorKind === "connection" || mount.errorKind === "connection", reconnecting: Boolean(this.reconnecting), pending: mount.pending,
      error: mount.errorKind === "request" ? mount.error : this.service.rootResumeAvailable ? mount.error : this.error ?? MANAGEMENT_DISCONNECTED })));
  }

  private clearConnectionErrors(): void {
    if (this.errorKind === "connection") { this.error = undefined; this.errorKind = undefined; }
    for (const mount of this.embedded.values()) {
      if (mount.errorKind === "connection") { mount.error = null; mount.errorKind = null; }
    }
  }

  private async refreshReservations(): Promise<void> {
    const version = this.connectionVersion;
    try {
      await this.service.rootResume({ action: "list" });
      if (!this.disposed && version === this.connectionVersion) this.clearConnectionErrors();
    } catch (error) {
      if (!this.disposed && version === this.connectionVersion && this.errorKind !== "request") {
        this.error = rootResumeError(error); this.errorKind = "connection";
      }
    }
    if (!this.disposed) { this.render(); await this.broadcastEmbedded(); }
  }

  private reconnect(): Promise<void> {
    if (this.disposed || this.mutating) return Promise.resolve();
    if (!this.reconnecting) {
      // Assign before connect can emit notifications; never reset engine identity.
      this.reconnecting = Promise.resolve().then(async () => {
        await this.service.connect();
        await this.refreshReservations();
      }).catch(error => {
        if (!this.disposed) { this.error = rootResumeError(error); this.errorKind = "connection"; }
      }).finally(() => {
        this.reconnecting = undefined;
        if (!this.disposed) { this.render(); void this.broadcastEmbedded(); }
      });
      this.render(); void this.broadcastEmbedded();
    }
    return this.reconnecting;
  }

  dispose(): void {
    this.disposed = true;
    this.stopPolling();
    this.service.off("rootResume", this.reservationListener);
    this.service.off("rootResumeConnection", this.connectionListener);
    this.service.off("errorState", this.accountErrorListener);
    this.panel?.dispose();
    for (const mount of this.embedded.values()) mount.disposal?.dispose();
    this.embedded.clear();
  }

  private onVisibility(): void {
    this.stopPolling();
    if (!this.panel?.visible) return;
    this.render();
    void this.refresh();
    this.pollTimer = setInterval(() => { void this.refresh(); }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  private async refresh(): Promise<void> {
    if (this.refreshing || !this.panel?.visible) return;
    if (!this.service.rootResumeAvailable) {
      this.error = this.service.error ? rootResumeError(this.service.error) : MANAGEMENT_DISCONNECTED;
      this.errorKind = "connection";
      this.render();
      return;
    }
    this.refreshing = true;
    const version = this.connectionVersion;
    this.render();
    try {
      await this.service.rootResume({ action: "list" });
      if (version === this.connectionVersion) { this.error = undefined; this.errorKind = undefined; }
    } catch (error) {
      if (version === this.connectionVersion) { this.error = rootResumeError(error); this.errorKind = this.service.rootResumeAvailable ? "request" : "connection"; }
    } finally {
      this.refreshing = false;
      this.render();
    }
  }

  private async onMessage(message: unknown): Promise<void> {
    if (message && typeof message === "object" && (message as Record<string, unknown>).action === "reconnect") { await this.reconnect(); return; }
    const request = parseRootResumeMessage(message);
    if (!request || this.mutating || this.reconnecting) return;
    if (request.action === "list") { await this.refresh(); return; }
    if (request.action === "cancel") {
      const answer = await vscode.window.showWarningMessage(
        "재개 예약만 취소합니다. 실행 중인 하위 에이전트와 작업은 계속 실행됩니다.",
        { modal: true },
        "예약 취소"
      );
      if (answer !== "예약 취소") return;
    }
    this.mutating = true;
    this.error = undefined;
    this.render();
    try {
      await this.service.rootResume(request);
    } catch (error) {
      this.error = rootResumeError(error);
      this.errorKind = "request";
      void vscode.window.showErrorMessage(this.error);
    } finally {
      this.mutating = false;
      this.render();
    }
  }

  private render(): void {
    if (!this.panel) return;
    const nonce = randomNonce();
    const reservations = (this.service.rootResumeReservations ?? []).filter((item) => isActiveRootResumeState(item.state));
    const cards = reservations.map(reservation => reservationHtml(reservation, this.service.rootResumeAvailable && !this.reconnecting && !this.mutating)).join("");
    const reconnect = !this.service.rootResumeAvailable || this.reconnecting || this.errorKind === "connection"
      ? `<button class="secondary" data-action="reconnect" ${this.reconnecting ? "disabled" : ""}>${this.reconnecting ? "재접속 중…" : "관리 연결 재접속"}</button>` : "";
    const empty = this.service.rootResumeReservations
      ? '<section class="empty">활성 재개 예약이 없습니다.</section>'
      : '<section class="empty">예약을 불러오는 중입니다.</section>';
    this.panel.webview.html = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><style nonce="${nonce}">${styles}</style></head><body><main><header><div><h1>루트 재개 예약</h1><p>예약 시각과 하위 에이전트·작업 대기 상태</p></div>${reconnect}<button data-action="list" ${this.refreshing ? "disabled" : ""}>${this.refreshing ? "갱신 중…" : "새로고침"}</button></header>${this.error ? `<p class="error" role="alert">${escapeHtml(this.error)}</p>` : ""}${cards || empty}</main><script nonce="${nonce}">const vscode=acquireVsCodeApi();document.addEventListener('click',event=>{if(!(event.target instanceof Element))return;const button=event.target.closest('button[data-action]');if(!(button instanceof HTMLButtonElement))return;const revision=Number(button.dataset.revision);const message={action:button.dataset.action};if(button.dataset.id){message.reservationId=button.dataset.id;message.revision=revision;}vscode.postMessage(message);});const formatter=new Intl.RelativeTimeFormat('ko',{numeric:'auto'});function updateCountdowns(){const now=Date.now();document.querySelectorAll('[data-resume-at]').forEach(element=>{const remaining=Number(element.dataset.resumeAt)-now;let value,unit;if(Math.abs(remaining)>=3600000){value=Math.round(remaining/3600000);unit='hour';}else if(Math.abs(remaining)>=60000){value=Math.round(remaining/60000);unit='minute';}else{value=Math.round(remaining/1000);unit='second';}element.textContent=remaining<=0?'재개 시각 도달':formatter.format(value,unit);});}updateCountdowns();setInterval(updateCountdowns,1000);</script></body></html>`;
  }
}

function reservationHtml(reservation: RootResumeReservation, available: boolean): string {
  const completionTasks = reservation.completionTasks ?? [];
  const tasks = completionTasks.length
    ? `<p class="condition">다음 ${reservation.agentTasks.length ? "하위 에이전트와 작업" : "작업"}이 모두 종료되면 조기 재개 · 예약 시각에 재개</p><ul>${reservation.agentTasks.map((task) => `<li><strong>${escapeHtml(task.agentPath)}</strong><br><code>${escapeHtml(task.threadId)}</code><br><span>작업 ${escapeHtml(task.turnId)}</span></li>`).join("")}${completionTasks.map((task) => `<li>작업 <code>${escapeHtml(task)}</code></li>`).join("")}</ul>`
    : reservation.agentTasks.length
    ? `<p class="condition">다음 하위 에이전트가 모두 종료되면 조기 재개</p><ul>${reservation.agentTasks.map((task) => `<li><strong>${escapeHtml(task.agentPath)}</strong><br><code>${escapeHtml(task.threadId)}</code><br><span>작업 ${escapeHtml(task.turnId)}</span></li>`).join("")}</ul>`
    : '<p class="condition">예약 시각에 재개</p>';
  const disabled = !available || reservation.state === "claimed" ? "disabled" : "";
  return `<section class="card"><div class="title"><span class="badge state-${reservation.state}">${STATE_LABELS[reservation.state]}</span><time>${escapeHtml(new Date(reservation.resumeAtMs).toLocaleString())}</time></div><p class="countdown" data-resume-at="${reservation.resumeAtMs}"></p><h2>${escapeHtml(reservation.reason || "사유 없음")}</h2><p class="identity">루트 스레드 <code>${escapeHtml(reservation.rootThreadId)}</code></p>${tasks}${reservation.lastError ? `<p class="error">${escapeHtml(reservation.lastError)}</p>` : ""}<div class="actions"><button data-action="resume" data-id="${escapeHtml(reservation.id)}" data-revision="${reservation.revision}" ${disabled}>지금 재개</button><button class="secondary" data-action="cancel" data-id="${escapeHtml(reservation.id)}" data-revision="${reservation.revision}" ${disabled}>예약 취소</button></div></section>`;
}

function rootResumeError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (/outcome is uncertain/i.test(detail)) return "요청 결과를 확인할 수 없습니다. 관리 연결을 복구한 뒤 예약 상태를 확인해 주세요. 요청을 자동으로 다시 보내지 않습니다.";
  if (/method not found|unsupported|not supported/i.test(detail)) return "현재 엔진은 루트 재개 예약 관리를 지원하지 않습니다.";
  if (/disconnected|connection|disposed|bridge protocol/i.test(detail)) return MANAGEMENT_DISCONNECTED;
  return detail;
}

function escapeHtml(value: unknown): string { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]!)); }
function randomNonce(): string { const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"; return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join(""); }
const styles = `body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:18px}main{max-width:860px;margin:auto}header,.title,.actions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}h1{font-size:1.45rem;margin-bottom:4px}header p,.identity,.condition,time{color:var(--vscode-descriptionForeground)}.card,.empty{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:16px;margin:14px 0}.card h2{font-size:1.08rem;margin:16px 0 8px}.badge{border-radius:999px;padding:3px 8px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}.state-blocked{background:var(--vscode-inputValidation-errorBackground);color:var(--vscode-errorForeground)}.countdown{font-weight:600;color:var(--vscode-charts-blue)}code{font-family:var(--vscode-editor-font-family);font-size:.9em;overflow-wrap:anywhere}li{margin:7px 0}button{border:0;border-radius:2px;padding:6px 10px;color:var(--vscode-button-foreground);background:var(--vscode-button-background)}button:hover{background:var(--vscode-button-hoverBackground)}button:disabled{opacity:.55}.secondary{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}.secondary:hover{background:var(--vscode-button-secondaryHoverBackground)}.error{color:var(--vscode-errorForeground)}`;

import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { AccountService } from "./accountService";
import { AccountView } from "./accountView";
import { UsageRefreshCoordinator } from "./usageRefresh";
import { DevinStatus } from "./devinProtocol";
import { isRecord } from "./protocol";
import { escapeHtml, dynamicTextHtml, openAIUsageHtml, openAIQuotaHtml, providerAccountHtml, accountSummaryHtml, providerHeadingHtml, quotaHtml, usageStyles, usageExpansionKey, autoSwitchCheckboxHtml } from "./usagePresentation";
import { DevinUsageService } from "./devinUsage";
import { ProviderAccountQuota, ProviderAccountsBackend, ProviderAccountSnapshot } from "./providerAccountProtocol";
import { manageDevin } from "./devin";
import { ResetCreditService, resetCreditMessage } from "./resetCredit";
import { UsageWindowService } from "./usageWindowService";
import type { AccountProfile } from "./protocol";
import { projectUsageHtml, projectUsageStyles, ProjectUsageSnapshot } from "./projectUsagePresentation";

const EXPANSION_STATE = "azrael.usage.expandedAccounts";

const PROVIDER_ACTIONS = new Set(["providerAdd", "providerSelect", "providerRemove", "providerReauth", "providerLoginCancel"]);

interface EmbeddedTarget {
  clientId: string;
  panel?: vscode.WebviewPanel;
  disposal?: vscode.Disposable;
  visibility?: vscode.Disposable;
}

export class UsageView implements vscode.Disposable {
  private readonly resetCredits: ResetCreditService;
  private readonly autoSwitchPending = new Set<string>();
  private readonly automaticWindowPending = new Set<string>();
  private readonly ticketConfirmations = new Map<string, string>();
  private readonly ticketDetailsExpanded = new Set<string>();
  private readonly ticketConsuming = new Map<string, string>();
  private readonly expanded = new Set<string>();
  private panel: vscode.WebviewPanel | undefined;
  private readonly embedded = new Map<vscode.Webview, EmbeddedTarget>();
  private listening = false;
  private disposed = false;
  private timer: NodeJS.Timeout | undefined;
  private refreshing = false;
  private refreshQueued = false;
  private refreshQueuedForce = false;
  private devin: DevinStatus | undefined;
  private error: string | undefined;
  private devinError: string | undefined;
  private providerError: string | undefined;
  private devinQuotaEmail: string | null | undefined;
  private providerSnapshot: ProviderAccountSnapshot | undefined;
  private readonly providerQuotas = new Map<string, ProviderAccountQuota>();
  private readonly providerQuotaErrors = new Map<string, ProviderAccountQuota>();
  private providerGeneration = 0;
  private costMonth = new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" })
    .formatToParts(new Date()).filter(part => part.type === "year" || part.type === "month")
    .sort((a, b) => a.type === "year" ? -1 : b.type === "year" ? 1 : 0).map(part => part.value).join("-");
  private costSnapshot: ProjectUsageSnapshot | undefined;
  private readonly costSnapshots = new Map<number, ProjectUsageSnapshot>();
  private costYear: number | undefined;
  private costError = false;
  private costGeneration = 0;
  private readonly stateListener = () => { if (this.hasVisibleTarget()) { this.render(); if (!this.refreshing) void this.refresh(); } };
  private readonly windowListener = () => this.render();

  constructor(
    private readonly service: AccountService,
    private readonly usage: UsageRefreshCoordinator,
    private readonly devinUsage: DevinUsageService,
    private readonly providers?: ProviderAccountsBackend,
    private readonly accounts?: AccountView,
    private readonly globalState?: vscode.Memento,
    private readonly usageWindows?: UsageWindowService,
    private readonly fontRoot?: vscode.Uri,
  ) {
    this.resetCredits = new ResetCreditService(service, globalState);
    const saved: unknown = globalState?.get(EXPANSION_STATE);
    if (Array.isArray(saved)) for (const key of saved) {
      if (typeof key !== "string") continue;
      try {
        const parts: unknown = JSON.parse(key);
        if (Array.isArray(parts) && parts.every(part => typeof part === "string" && part.length > 0)
          && ((parts[0] === "devin-cli" && parts.length === 2) || (["openai", "provider"].includes(parts[0]) && parts.length === 3))) {
          this.expanded.add(JSON.stringify(parts));
        }
      } catch { /* Ignore malformed persisted state. */ }
    }
    this.providerSnapshot = providers?.snapshot;
    usageWindows?.on("change", this.windowListener);
  }

  show(): void {
    if (this.disposed) return;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel("azrael.accounts", "계정 및 사용량", vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, ...(this.fontRoot ? { localResourceRoots: [this.fontRoot] } : {}) });
      this.panel.webview.onDidReceiveMessage(message => { void this.onMessage(message); });
      this.panel.onDidChangeViewState(() => this.visibility());
      this.panel.onDidDispose(() => { this.panel = undefined; this.visibility(); });
    }
    this.panel.reveal();
    this.render();
    this.visibility();
  }

  async handleEmbedded(webview: vscode.Webview, request: unknown, panel?: vscode.WebviewPanel): Promise<void> {
    if (this.disposed || !webview || typeof webview.postMessage !== "function" || !isRecord(request)
      || request.type !== "azrael-accounts" || typeof request.clientId !== "string"
      || request.clientId.length === 0 || request.clientId.length > 128) return;
    const previous = this.embedded.get(webview);
    if (request.action === "mount") {
      previous?.disposal?.dispose();
      previous?.visibility?.dispose();
      const target: EmbeddedTarget = { clientId: request.clientId, panel };
      this.embedded.set(webview, target);
      if (panel) {
        target.disposal = panel.onDidDispose(() => this.removeEmbedded(webview, target));
        target.visibility = panel.onDidChangeViewState(() => this.visibility());
      }
      this.render();
      this.visibility();
    } else if (previous?.clientId === request.clientId) {
      if (request.action === "unmount") this.removeEmbedded(webview, previous);
      else if (request.action === "action") await this.onMessage(request.message);
    }
  }

  private removeEmbedded(webview: vscode.Webview, target: EmbeddedTarget): void {
    if (this.embedded.get(webview) !== target) return;
    this.embedded.delete(webview);
    target.disposal?.dispose();
    target.visibility?.dispose();
    this.visibility();
  }

  private hasVisibleTarget(): boolean {
    return !this.disposed && (!!this.panel?.visible || [...this.embedded.values()].some(target => target.panel?.visible !== false));
  }

  dispose(): void {
    this.disposed = true;
    this.service.off("state", this.stateListener);
    this.usageWindows?.off("change", this.windowListener);
    this.listening = false;
    this.stopTimer();
    for (const target of this.embedded.values()) {
      target.disposal?.dispose();
      target.visibility?.dispose();
    }
    this.embedded.clear();
    this.devinUsage.dispose();
    this.providers?.dispose();
    this.panel?.dispose();
  }

  private stopTimer(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  private visibility(): void {
    if (!this.hasVisibleTarget()) {
      ++this.costGeneration;
      this.stopTimer();
      if (this.listening) this.service.off("state", this.stateListener);
      this.listening = false;
      this.devinUsage.cancelRefresh();
      return;
    }
    if (!this.listening) {
      this.service.on("state", this.stateListener);
      this.listening = true;
    }
    void this.refresh();
    if (!this.timer) this.timer = setInterval(() => { void this.refresh(); }, 120_000);
  }

  private async refresh(force = false): Promise<void> {
    if (!this.hasVisibleTarget()) return;
    if (this.refreshing) {
      this.refreshQueued = true;
      this.refreshQueuedForce ||= force;
      return;
    }
    this.refreshing = true;
    this.render();
    try {
      await Promise.allSettled([this.refreshOpenAI(force), this.refreshDevin(), this.refreshProviders(force), this.refreshProjectUsage(), this.usageWindows?.refresh()]);
    } finally {
      this.refreshing = false;
      this.render();
      const queued = this.refreshQueued;
      const queuedForce = this.refreshQueuedForce;
      this.refreshQueued = false;
      this.refreshQueuedForce = false;
      if (queued && this.hasVisibleTarget()) void this.refresh(queuedForce);
    }
  }

  private async refreshOpenAI(force: boolean): Promise<void> {
    try {
      const state = await this.service.refresh();
      const identities = state.profiles.map(profile => ({ profileId: profile.id, workspaceAccountId: profile.workspaceAccountId }));
      const due = this.usage.dueResetProfiles(identities);
      await Promise.all(identities.map(identity => this.usage.refresh(
        identity.profileId,
        identity.workspaceAccountId,
        false,
        force || due.some(item => item.profileId === identity.profileId && item.workspaceAccountId === identity.workspaceAccountId),
      )));
      this.error = undefined;
    } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
    this.render();
  }

  private async refreshProjectUsage(): Promise<void> {
    if (!this.hasVisibleTarget()) return;
    const year = Number(this.costMonth.slice(0, 4));
    const generation = ++this.costGeneration;
    try {
      const snapshot = await this.service.projectUsage(year);
      if (generation !== this.costGeneration || !this.hasVisibleTarget() || year !== Number(this.costMonth.slice(0, 4))) return;
      this.costSnapshot = snapshot;
      this.costSnapshots.set(year, snapshot);
      this.costYear = year;
      this.costError = false;
    } catch {
      if (generation !== this.costGeneration || !this.hasVisibleTarget() || year !== Number(this.costMonth.slice(0, 4))) return;
      this.costError = true;
    }
    this.render();
  }

  private async refreshDevin(): Promise<void> {
    try {
      const before = await this.service.devin("status");
      this.devin = before;
      if (before.email !== this.devinQuotaEmail) this.devinUsage.snapshot = undefined;
      if (before.loggedIn) {
        await this.devinUsage.refresh();
        const after = await this.service.devin("status");
        if (!after.loggedIn || before.email !== after.email) {
          this.devinUsage.snapshot = undefined;
          throw new Error("Devin CLI 사용량 조회 중 로그인 계정이 변경됐습니다. 다시 갱신해주세요.");
        }
        this.devinQuotaEmail = after.email;
      } else if (!before.loggedIn) {
        this.devinUsage.snapshot = undefined;
        this.devinQuotaEmail = undefined;
      }
      this.devinError = this.devinUsage.error;
    } catch (error) {
      this.devin = undefined;
      this.devinError = error instanceof Error ? error.message : String(error);
    }
  }

  private async refreshProviders(force: boolean): Promise<void> {
    const backend = this.providers;
    if (!backend?.enabled) return;
    const generation = ++this.providerGeneration;
    try {
      const snapshot = await backend.refresh();
      if (generation !== this.providerGeneration) return;
      this.providerSnapshot = snapshot;
      this.providerError = undefined;
      this.render();
      const identities = snapshot.providers.filter(provider => provider.authKind === "oauth" && provider.id.toLowerCase() !== "openai")
        .flatMap(provider => provider.accounts.map(account => ({ providerId: provider.id, accountId: account.id })));
      await Promise.all(identities.map(async identity => {
        const key = providerKey(identity.providerId, identity.accountId);
        try {
          const quota = await backend.quota(identity.providerId, identity.accountId, force);
          if (generation === this.providerGeneration && quota.providerId === identity.providerId && quota.accountId === identity.accountId) {
            if (quota.status === "error") this.providerQuotaErrors.set(key, quota);
            else {
              this.providerQuotas.set(key, quota);
              this.providerQuotaErrors.delete(key);
            }
          }
        } catch (error) {
          if (generation === this.providerGeneration) {
            this.providerQuotaErrors.set(key, {
              ...identity,
              status: "error",
              source: "provider backend",
              observedAt: Date.now(),
              rows: [],
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        this.render();
      }));
      if (generation === this.providerGeneration) {
        const current = new Set(identities.map(identity => providerKey(identity.providerId, identity.accountId)));
        for (const key of this.providerQuotas.keys()) if (!current.has(key)) this.providerQuotas.delete(key);
        for (const key of this.providerQuotaErrors.keys()) if (!current.has(key)) this.providerQuotaErrors.delete(key);
      }
    } catch (error) {
      if (generation === this.providerGeneration) this.providerError = error instanceof Error ? error.message : String(error);
    }
  }

  private async onMessage(message: unknown): Promise<void> {
    if (!isRecord(message) || typeof message.action !== "string") return;
    try {
      if (message.action === "costMonth") {
        if (typeof message.month !== "string" || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(message.month) || !this.hasVisibleTarget()) return;
        const previousYear = Number(this.costMonth.slice(0, 4));
        this.costMonth = message.month;
        if (previousYear !== Number(this.costMonth.slice(0, 4))) {
          ++this.costGeneration;
          this.costYear = Number(this.costMonth.slice(0, 4));
          this.costSnapshot = this.costSnapshots.get(this.costYear);
          this.costError = false;
          void this.refresh();
        }
        this.render();
        return;
      }
      if (message.action === "setAutoSwitch") { await this.setAutoSwitch(message); return; }
      if (message.action === "toggleUsage") { await this.toggleUsage(message); return; }
      if (message.action === "consumeResetCredit") { await this.consumeResetCredit(message); return; }
      if (message.action === "ticketDetails") { await this.toggleTicketDetails(message); return; }
      if (message.action === "autoWindowEnable" || message.action === "autoWindowDisable") {
        const profile = this.service.state?.profiles.find(item => item.id === message.profileId && item.workspaceAccountId === message.workspaceAccountId);
        if (!profile || !this.usageWindows || !this.service.changesEnabled
          || !this.expanded.has(usageExpansionKey("openai", profile.id, profile.workspaceAccountId))) return;
        const key = JSON.stringify([profile.workspaceAccountId, profile.userId]);
        if (this.automaticWindowPending.has(key)) return;
        this.automaticWindowPending.add(key);
        this.render();
        try {
          await this.usageWindows.setEnabled(profile.id, profile.workspaceAccountId, message.action === "autoWindowEnable");
        } finally {
          this.automaticWindowPending.delete(key);
          this.render();
        }
        return;
      }
      if (await this.accounts?.handleMessage(message)) { await this.refresh(true); return; }
      if (message.action === "refresh") await this.refresh(true);
      else if (message.action === "devinBilling") await vscode.env.openExternal(vscode.Uri.parse("https://app.devin.ai/settings/usage"));
      else if (message.action === "manageDevin") { await manageDevin(this.service); await this.refresh(true); }
      else if (PROVIDER_ACTIONS.has(message.action)) {
        await this.handleProviderAction(message);
        await this.refresh(true);
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(this.error);
      this.render();
    }
  }

  private async setAutoSwitch(message: Record<string, unknown>): Promise<void> {
    if (typeof message.enabled !== "boolean") { this.render(); return; }
    const native = typeof message.profileId === "string" && typeof message.workspaceAccountId === "string";
    const managed = typeof message.providerId === "string" && typeof message.accountId === "string";
    if (native === managed) { this.render(); return; }
    const key = native ? usageExpansionKey("openai", message.profileId as string, message.workspaceAccountId as string)
      : usageExpansionKey("provider", message.providerId as string, message.accountId as string);
    if (this.autoSwitchPending.has(key)) return;
    this.autoSwitchPending.add(key);
    this.render();
    try {
      if (native) {
        const state = await this.service.refresh();
        const profile = state.profiles.find(item => item.id === message.profileId && item.workspaceAccountId === message.workspaceAccountId);
        if (!profile) return;
        await this.service.call({ action: message.enabled ? "autoSwitchEnable" : "autoSwitchDisable", profileId: profile.id });
      } else {
        const backend = this.providers;
        if (!backend?.enabled) return;
        this.providerSnapshot = await backend.refresh();
        const provider = this.providerSnapshot.providers.find(item => item.id === message.providerId && item.authKind === "oauth" && item.id.toLowerCase() !== "openai" && item.inferenceConnected);
        const account = provider?.accounts.find(item => item.id === message.accountId);
        if (!provider || !account || account.autoSwitchAvailable === false) return;
        await backend.setAutoSwitch(provider.id, account.id, message.enabled);
        this.providerSnapshot = backend.snapshot;
      }
      this.error = undefined;
    } finally {
      this.autoSwitchPending.delete(key);
      this.render();
    }
  }

  private async toggleUsage(message: Record<string, unknown>): Promise<void> {
    let key: string | undefined;
    if (typeof message.profileId === "string") {
      const profile = this.service.state?.profiles.find(item => item.id === message.profileId && item.workspaceAccountId === message.workspaceAccountId);
      if (profile) key = usageExpansionKey("openai", profile.id, profile.workspaceAccountId);
    } else if (typeof message.providerId === "string" && typeof message.accountId === "string") {
      const provider = this.providerSnapshot?.providers.find(item => item.id === message.providerId && item.authKind === "oauth" && item.id.toLowerCase() !== "openai");
      if (provider?.accounts.some(item => item.id === message.accountId)) key = usageExpansionKey("provider", provider.id, message.accountId);
    } else if (message.kind === "devin-cli" && this.devin?.loggedIn && this.devin.email && message.accountId === this.devin.email) {
      key = usageExpansionKey("devin-cli", this.devin.email);
    }
    if (!key) return;
    const opening = !this.expanded.has(key);
    if (opening) this.expanded.add(key);
    else {
      this.expanded.delete(key);
      this.ticketDetailsExpanded.delete(key);
      this.ticketConfirmations.delete(key);
    }
    this.render();
    await this.globalState?.update(EXPANSION_STATE, [...this.expanded]);
    if (opening) await this.refresh();
  }

  private async consumeResetCredit(message: Record<string, unknown>): Promise<void> {
    const profile = this.service.state?.profiles.find(item => item.id === message.profileId && item.workspaceAccountId === message.workspaceAccountId);
    if (!profile || typeof message.creditId !== "string" || !message.creditId.trim() || !this.service.changesEnabled) return;
    const key = usageExpansionKey("openai", profile.id, profile.workspaceAccountId);
    if (!this.expanded.has(key) || !this.ticketDetailsExpanded.has(key) || this.resetCredits.busy(profile) || this.ticketConsuming.has(key)) return;
    const creditId = message.creditId;
    const retryId = this.resetCredits.retryCreditId(profile);
    if (this.resetCredits.retrying(profile) && retryId === undefined) throw new Error("이전 티켓 요청의 대상 ID를 확인할 수 없습니다. 이전 요청 결과를 먼저 확인해 주세요.");
    if (this.resetCredits.retrying(profile) && retryId !== creditId) return;
    if (!retryId) {
      const tickets = this.usage.get(profile.id, profile.workspaceAccountId)?.data?.rateLimitResetCredits;
      const credit = tickets?.credits?.find(item => item.id === creditId);
      if (!tickets || tickets.availableCount <= 0 || !credit || credit.status !== "available" || credit.resetType !== "codexRateLimits"
        || (credit.expiresAt !== null && credit.expiresAt <= Date.now() / 1000)) return;
    }
    if (this.ticketConfirmations.get(key) !== creditId) {
      this.ticketConfirmations.set(key, creditId);
      this.render();
      return;
    }
    this.ticketConfirmations.delete(key);
    this.ticketConsuming.set(key, creditId);
    try {
      let outcome;
      try {
        const pending = this.resetCredits.consume(profile, creditId);
        this.render();
        outcome = await pending;
      }
      catch (error) {
        if (!this.resetCredits.retrying(profile)) throw error;
        throw new Error(`${error instanceof Error ? error.message : String(error)} · 사용 결과가 확인되지 않았습니다. 재확인 버튼은 같은 요청 ID를 사용합니다.`);
      }
      this.error = undefined;
      void vscode.window.showInformationMessage(resetCreditMessage(outcome));
      if (this.expanded.has(key)) await this.usage.refresh(profile.id, profile.workspaceAccountId, false, true);
    } finally {
      this.ticketConsuming.delete(key);
      this.render();
    }
  }

  private async toggleTicketDetails(message: Record<string, unknown>): Promise<void> {
    const profile = this.service.state?.profiles.find(item => item.id === message.profileId && item.workspaceAccountId === message.workspaceAccountId);
    if (!profile || typeof message.open !== "boolean") return;
    const key = usageExpansionKey("openai", profile.id, profile.workspaceAccountId);
    if (!this.expanded.has(key)) return;
    if (!message.open) {
      const changed = this.ticketDetailsExpanded.delete(key);
      const confirmed = this.ticketConfirmations.delete(key);
      if (changed || confirmed) this.render();
      return;
    }
    if (this.ticketDetailsExpanded.has(key)) return;
    this.ticketDetailsExpanded.add(key);
    if (this.usage.get(profile.id, profile.workspaceAccountId)?.data?.rateLimitResetCredits?.credits === null) {
      await this.usage.refresh(profile.id, profile.workspaceAccountId, true, true);
      this.render();
    }
  }

  private async handleProviderAction(message: Record<string, unknown>): Promise<void> {
    const backend = this.providers;
    if (!backend?.enabled) throw new Error("관리형 공급자 계정 기능을 현재 런타임에서 사용할 수 없습니다.");
    if (message.action === "providerAdd") return this.addProviderAccount(backend, typeof message.providerId === "string" ? message.providerId : undefined);
    if (message.action === "providerLoginCancel") { backend.cancelLogin(); return; }
    if (typeof message.providerId !== "string" || typeof message.accountId !== "string") return;
    const provider = this.providerSnapshot?.providers.find(item => item.id === message.providerId && item.authKind === "oauth" && item.id.toLowerCase() !== "openai");
    const account = provider?.accounts.find(item => item.id === message.accountId);
    if (!provider || !account) return;
    if (message.action === "providerSelect") await backend.select(provider.id, account.id);
    else if (message.action === "providerReauth" && provider.authKind === "oauth") await backend.login(provider.id, account.id);
    else if (message.action === "providerRemove") {
      const answer = await vscode.window.showWarningMessage(
        `${provider.label}의 ${account.label} 계정을 모든 Azrael 세션에서 제거할까요? 이 계정을 사용 중인 작업은 중지되고 사용 가능한 대체 계정이 있으면 전환됩니다. 대체 계정이 없으면 중지 상태로 남으며, 작업은 자동으로 재개되지 않습니다.`,
        { modal: true }, "제거",
      );
      if (answer === "제거") await backend.remove(provider.id, account.id);
    }
  }

  private async addProviderAccount(backend: ProviderAccountsBackend, requestedProviderId?: string): Promise<void> {
    const available = (this.providerSnapshot?.availableProviders ?? backend.snapshot?.availableProviders ?? [])
      .filter(provider => provider.authKind === "oauth" && provider.id.toLowerCase() !== "openai");
    const requested = requestedProviderId === undefined ? undefined : available.find(provider => provider.id === requestedProviderId);
    if (requestedProviderId !== undefined && !requested) return;
    const picked = requested ? { provider: requested } : await vscode.window.showQuickPick(available.map(provider => ({
      label: provider.label,
      description: "브라우저 로그인",
      provider,
    })), { title: "공급자 계정 추가", placeHolder: available.length ? "공급자 선택" : "추가할 수 있는 공급자가 없습니다." });
    if (!picked || picked.provider.authKind !== "oauth" || picked.provider.id.toLowerCase() === "openai") return;
    await backend.login(picked.provider.id);
  }

  private automaticWindowHtml(profile: AccountProfile): string {
    if (!this.usageWindows) return "";
    const schedule = this.usageWindows.forProfile(profile);
    const enabled = schedule?.enabled === true;
    const pending = this.automaticWindowPending.has(JSON.stringify([profile.workspaceAccountId, profile.userId]));
    const label = pending ? "변경 중…" : schedule ? `자동 실행: ${enabled ? "켜짐" : "꺼짐"}` : "상태 확인 필요";
    return `<button data-action="${enabled ? "autoWindowDisable" : "autoWindowEnable"}" data-profile="${escapeHtml(profile.id)}" data-workspace="${escapeHtml(profile.workspaceAccountId)}" ${this.service.changesEnabled && !pending ? "" : "disabled"}>${label}</button>`;
  }

  private automaticWindowErrorHtml(profile: AccountProfile): string {
    const error = this.usageWindows?.error ?? this.usageWindows?.forProfile(profile)?.error;
    return error ? `<p class="error">${dynamicTextHtml(error)}</p>` : "";
  }

  private render(): void {
    if (this.disposed || (!this.panel && this.embedded.size === 0)) return;
    const html = this.renderMarkup();
    if (this.panel) {
      const nonce = randomBytes(18).toString("base64");
      const webview = this.panel.webview;
      const fonts = this.fontRoot ? ["gyeonggi-title-light.woff"].map(file => {
        const uri = webview.asWebviewUri(vscode.Uri.joinPath(this.fontRoot!, file));
        return `@font-face{font-family:"Azrael Gyeonggi Title";src:url("${escapeHtml(uri.toString())}") format("woff");font-weight:400;font-style:normal;font-display:swap}`;
      }).join("") : "";
      this.panel.webview.html = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src ${this.fontRoot ? escapeHtml(webview.cspSource) : "'none'"}; script-src 'nonce-${nonce}';"><style>${fonts}</style></head><body>${html}<script nonce="${nonce}">const vscode=acquireVsCodeApi();document.addEventListener('click',e=>{if(!(e.target instanceof Element))return;const b=e.target.closest('button[data-action], [role="button"][data-action="toggleUsage"]');if(b instanceof HTMLElement&&!b.disabled)vscode.postMessage({action:b.dataset.action,profileId:b.dataset.profile,providerId:b.dataset.provider,accountId:b.dataset.account,workspaceAccountId:b.dataset.workspace,kind:b.dataset.kind,creditId:b.dataset.credit,month:b.dataset.month});});document.addEventListener('keydown',e=>{const s=e.target;if((e.key==='Enter'||e.key===' ')&&s instanceof HTMLElement&&s.dataset.action==='toggleUsage'&&s.getAttribute('role')==='button'){e.preventDefault();s.click();}});document.addEventListener('change',e=>{const b=e.target;if(!(b instanceof HTMLInputElement)||b.type!=='checkbox'||b.dataset.action!=='setAutoSwitch'||b.disabled)return;const enabled=b.checked;b.disabled=true;vscode.postMessage({action:b.dataset.action,profileId:b.dataset.profile,providerId:b.dataset.provider,accountId:b.dataset.account,workspaceAccountId:b.dataset.workspace,enabled});});document.addEventListener('toggle',e=>{const d=e.target;if(d instanceof HTMLDetailsElement&&d.classList.contains('ticket-details'))vscode.postMessage({action:'ticketDetails',profileId:d.dataset.profile,workspaceAccountId:d.dataset.workspace,open:d.open});},true);document.querySelector('button[data-ticket-confirming="true"]')?.focus();</script></body></html>`;
    }
    for (const [webview, target] of this.embedded) {
      try {
        void Promise.resolve(webview.postMessage({ type: "azrael-accounts-html", clientId: target.clientId, html }))
          .then(sent => { if (!sent) this.removeEmbedded(webview, target); }, () => this.removeEmbedded(webview, target));
      } catch { this.removeEmbedded(webview, target); }
    }
  }

  private costUnavailableHtml(): string {
    const [year, month] = this.costMonth.split("-").map(Number);
    const nav = (offset: number) => {
      const index = (year - 1) * 12 + month - 1 + offset;
      const allowed = index >= 0 && index < 9999 * 12;
      const next = allowed ? `${String(Math.floor(index / 12) + 1).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}` : this.costMonth;
      return `<button class="puc-nav" data-action="costMonth" data-month="${next}" aria-label="${offset < 0 ? "이전 달" : "다음 달"}"${allowed ? "" : " disabled"}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="${offset < 0 ? "m10 3-5 5 5 5" : "m6 3 5 5-5 5"}"/></svg></button>`;
    };
    return `<section class="project-usage" aria-label="프로젝트 사용량"><div class="puc-heading"><div class="puc-month">${nav(-1)}<span>${this.costMonth.replace("-", ".")}</span>${nav(1)}</div><span class="muted">${this.costError ? "조회 실패" : "불러오는 중…"}</span></div></section>`;
  }

  private renderMarkup(): string {
    const state = this.service.state;
    const openAICards = state?.profiles.map(profile => {
      const entry = this.usage.get(profile.id, profile.workspaceAccountId);
      const expanded = this.expanded.has(usageExpansionKey("openai", profile.id, profile.workspaceAccountId));
      const active = profile.id === state.activeProfileId;
      const ticketKey = usageExpansionKey("openai", profile.id, profile.workspaceAccountId);
      const ticketState = { workspaceAccountId: profile.workspaceAccountId, expanded: this.ticketDetailsExpanded.has(ticketKey),
        confirmingCreditId: this.ticketConfirmations.get(ticketKey), retryCreditId: this.resetCredits.retryCreditId(profile),
        busy: this.resetCredits.busy(profile) || this.ticketConsuming.has(ticketKey), busyCreditId: this.ticketConsuming.get(ticketKey), changesEnabled: this.service.changesEnabled };
      const attributes = `data-profile="${escapeHtml(profile.id)}" data-workspace="${escapeHtml(profile.workspaceAccountId)}"`;
      const switchAction = active ? "" : `<button data-action="openaiSwitch" data-profile="${escapeHtml(profile.id)}">이 계정으로 전환</button>`;
      const warning = entry?.error ? `<p class="error">${entry.data ? "이전 조회 값 · " : ""}사용량 조회 실패 · ${dynamicTextHtml(entry.error)}</p>` : "";
      const summary = accountSummaryHtml(profile.email ?? "OpenAI 계정", expanded, attributes, openAIQuotaHtml(entry?.data ?? null), active);
      return `<section class="account-card${expanded ? " expanded" : " collapsed"}">${summary}${warning}${expanded ? `<div class="usage-details"><h3>계정 상세정보</h3>${openAIUsageHtml(entry?.data ?? null, profile.id, ticketState, false)}${this.automaticWindowErrorHtml(profile)}<div class="settings-row">${autoSwitchCheckboxHtml(profile.autoSwitchAllowed, attributes, this.autoSwitchPending.has(ticketKey))}</div><div class="card-actions">${switchAction}${this.automaticWindowHtml(profile)}<button data-action="openaiReauth" data-profile="${escapeHtml(profile.id)}">재인증</button><button class="remove-account" data-action="openaiRemove" data-profile="${escapeHtml(profile.id)}">제거</button></div></div>` : ""}</section>`;
    }).join("") ?? "";
    const openAIState = `${state?.pendingProfileId ? `<p class="notice">현재 엔진의 계정 전환 대기 중 <button data-action="openaiCancelSwitch">전환 취소</button></p>` : ""}${state?.loginPending ? '<p class="notice">OpenAI 로그인 대기 중 <button data-action="openaiLoginCancel">로그인 취소</button></p>' : ""}`;
    const managedGroups = this.providerSnapshot?.providers.filter(provider => provider.authKind === "oauth" && provider.id.toLowerCase() !== "openai").map(provider => {
      const cards = provider.accounts.map(account => {
        const key = providerKey(provider.id, account.id);
        return providerAccountHtml(provider, account, this.providerQuotas.get(key) ?? this.providerQuotaErrors.get(key), this.providerQuotas.has(key) ? this.providerQuotaErrors.get(key) : undefined, this.expanded.has(usageExpansionKey("provider", provider.id, account.id)), this.autoSwitchPending.has(usageExpansionKey("provider", provider.id, account.id)));
      }).join("");
      const add = `<button data-action="providerAdd" data-provider="${escapeHtml(provider.id)}">계정 추가</button>`;
      return `${providerHeadingHtml(provider.id, provider.label, provider.accounts.length, add)}<div class="provider-group">${cards || '<p class="empty-state muted">등록된 계정이 없습니다.</p>'}</div>`;
    }).join("") ?? "";
    const managedSection = this.providers?.enabled ? `${this.providerError || this.providers.error ? `<p class="error">${dynamicTextHtml(this.providerError ?? this.providers.error)}</p>` : ""}${managedGroups}<div class="provider-management"><button data-action="providerAdd">공급자 계정 추가</button><button class="text-button" data-action="providerLoginCancel">로그인 취소</button></div>` : "";
    const devin = this.devin;
    const devinQuota = devin?.loggedIn ? this.devinUsage.snapshot : undefined;
    const devinExpanded = !!devin?.loggedIn && !!devin.email && this.expanded.has(usageExpansionKey("devin-cli", devin.email));
    const devinActions = `<div class="card-actions"><button data-action="manageDevin">Devin CLI 로그인 관리</button><button class="text-button" data-action="devinBilling">Devin 사용량 열기 ↗</button></div>`;
    const devinGauges = devinQuota ? `<div class="limit">${quotaHtml(devinQuota.daily, "일일 한도")}${quotaHtml(devinQuota.weekly, "주간 한도")}</div>` : `<p class="muted">${this.refreshing ? "CLI 사용량을 불러오는 중…" : devin?.enabled === false ? "Devin CLI 연결이 비활성화되어 있습니다." : "CLI 사용량을 가져오지 못했습니다."}</p>`;
    const devinSummary = devin?.loggedIn && devin.email ? accountSummaryHtml(devin.email, devinExpanded, `data-kind="devin-cli" data-account="${escapeHtml(devin.email)}"`, devinGauges, true) : '<div class="empty-state muted">로그인된 Devin CLI 계정이 없습니다.</div>';
    const devinCard = `<section class="account-card${devinExpanded ? " expanded" : " collapsed"}">${devinSummary}${this.devinError ? `<p class="error">${devinQuota ? "이전 조회 값 · " : ""}${dynamicTextHtml(this.devinError)}</p>` : ""}${devinExpanded || !devin?.loggedIn ? `<div class="usage-details"><p class="muted">Devin CLI 계정은 관리형 Devin 계정과 별도로 사용됩니다.</p>${devinActions}</div>` : ""}</section>`;
    const openAIHeading = providerHeadingHtml("openai", "OpenAI", state?.profiles.length ?? 0, '<button data-action="openaiCapture">현재 계정 저장</button><button data-action="openaiLogin">계정 추가</button>');
    const cost = this.costYear === Number(this.costMonth.slice(0, 4)) && this.costSnapshot ? `${this.costError ? '<p class="muted">이전 조회 값 · 갱신 실패</p>' : ""}${projectUsageHtml(this.costSnapshot, this.costMonth)}` : this.costUnavailableHtml();
    return `<style>${usageStyles}${projectUsageStyles}</style><main><header><div><h1>계정 및 사용량</h1><p class="muted subtitle">계정별 잔여 사용량을 한눈에 확인하세요.</p></div><div class="actions"><button data-action="refresh" ${this.refreshing ? "disabled" : ""}>${this.refreshing ? "갱신 중…" : "새로고침"}</button></div></header>${this.error ? `<p class="error">${dynamicTextHtml(this.error)}</p>` : ""}${openAIHeading}${openAIState}<div class="provider-group">${openAICards || '<p class="empty-state muted">저장된 OpenAI 계정이 없습니다. 현재 계정을 저장하거나 계정을 추가하세요.</p>'}</div>${managedSection}${providerHeadingHtml("devin-cli", "Devin CLI", devin?.loggedIn ? 1 : 0)}<div class="provider-group">${devinCard}</div><p class="usage-hint muted">게이지를 누르면 계정 상세정보가 펼쳐집니다. 표시된 비율은 남은 사용량입니다.</p>${cost}</main>`;
  }
}

function providerKey(providerId: string, accountId: string): string { return `${providerId}\u0000${accountId}`; }

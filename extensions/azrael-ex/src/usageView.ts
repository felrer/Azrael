import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { AccountService } from "./accountService";
import { AccountView } from "./accountView";
import { UsageRefreshCoordinator } from "./usageRefresh";
import { DevinStatus } from "./devinProtocol";
import { isRecord } from "./protocol";
import { escapeHtml, openAIPlanLabel, openAIUsageHtml, providerAccountHtml, quotaHtml, usageStyles, usageExpansionKey, usageToggleHtml } from "./usagePresentation";
import { DevinUsageService } from "./devinUsage";
import { ProviderAccountQuota, ProviderAccountsBackend, ProviderAccountSnapshot } from "./providerAccountProtocol";
import { manageDevin } from "./devin";
import { ResetCreditService, resetCreditMessage } from "./resetCredit";

const EXPANSION_STATE = "azrael.usage.expandedAccounts";

const PROVIDER_ACTIONS = new Set(["providerAdd", "providerSelect", "providerRemove", "providerReauth", "providerLoginCancel"]);

export class UsageView implements vscode.Disposable {
  private readonly resetCredits: ResetCreditService;
  private readonly ticketConfirming = new Set<string>();
  private readonly expanded = new Set<string>();
  private panel: vscode.WebviewPanel | undefined;
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
  private readonly stateListener = () => { if (this.panel?.visible) { this.render(); if (!this.refreshing) void this.refresh(); } };

  constructor(
    private readonly service: AccountService,
    private readonly usage: UsageRefreshCoordinator,
    private readonly devinUsage: DevinUsageService,
    private readonly providers?: ProviderAccountsBackend,
    private readonly accounts?: AccountView,
    private readonly globalState?: vscode.Memento,
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
    service.on("state", this.stateListener);
    this.providerSnapshot = providers?.snapshot;
  }

  show(): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel("azrael.accounts", "계정 및 사용량", vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
      this.panel.webview.onDidReceiveMessage(message => { void this.onMessage(message); });
      this.panel.onDidChangeViewState(() => this.visibility());
      this.panel.onDidDispose(() => { this.panel = undefined; this.stopTimer(); this.devinUsage.cancelRefresh(); });
    }
    this.panel.reveal();
    this.render();
    this.visibility();
  }

  dispose(): void {
    this.service.off("state", this.stateListener);
    this.stopTimer();
    this.devinUsage.dispose();
    this.providers?.dispose();
    this.panel?.dispose();
  }

  private stopTimer(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  private visibility(): void {
    this.stopTimer();
    if (!this.panel?.visible) { this.devinUsage.cancelRefresh(); return; }
    void this.refresh();
    this.timer = setInterval(() => { void this.refresh(); }, 60_000);
  }

  private async refresh(force = false): Promise<void> {
    if (this.refreshing) {
      this.refreshQueued = true;
      this.refreshQueuedForce ||= force;
      return;
    }
    this.refreshing = true;
    this.render();
    try {
      await Promise.allSettled([this.refreshOpenAI(force), this.refreshDevin(), this.refreshProviders(force)]);
    } finally {
      this.refreshing = false;
      this.render();
      const queued = this.refreshQueued;
      const queuedForce = this.refreshQueuedForce;
      this.refreshQueued = false;
      this.refreshQueuedForce = false;
      if (queued && this.panel?.visible) void this.refresh(queuedForce);
    }
  }

  private async refreshOpenAI(force: boolean): Promise<void> {
    try {
      const state = await this.service.refresh();
      const identities = state.profiles.filter(profile => this.expanded.has(usageExpansionKey("openai", profile.id, profile.workspaceAccountId))).map(profile => ({ profileId: profile.id, workspaceAccountId: profile.workspaceAccountId }));
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

  private async refreshDevin(): Promise<void> {
    try {
      const before = await this.service.devin("status");
      this.devin = before;
      if (before.email !== this.devinQuotaEmail) this.devinUsage.snapshot = undefined;
      if (before.loggedIn && this.expanded.has(usageExpansionKey("devin-cli", before.email ?? ""))) {
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
      await Promise.all(identities.filter(identity => this.expanded.has(usageExpansionKey("provider", identity.providerId, identity.accountId))).map(async identity => {
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
      if (message.action === "toggleUsage") { await this.toggleUsage(message); return; }
      if (message.action === "consumeResetCredit") { await this.consumeResetCredit(message); return; }
      if (await this.accounts?.handleMessage(message)) { await this.refresh(true); return; }
      if (message.action === "refresh") await this.refresh(true);
      else if (message.action === "devinBilling") await vscode.env.openExternal(vscode.Uri.parse("https://app.devin.ai/settings/usage"));
      else if (message.action === "manageDevin") { await manageDevin(this.service); await this.refresh(true); }
      else if (message.action === "details" && typeof message.profileId === "string") {
        const profile = this.service.state?.profiles.find(item => item.id === message.profileId);
        if (profile && this.expanded.has(usageExpansionKey("openai", profile.id, profile.workspaceAccountId))) { await this.usage.refresh(profile.id, profile.workspaceAccountId, true, true); this.render(); }
      } else if (PROVIDER_ACTIONS.has(message.action)) {
        await this.handleProviderAction(message);
        await this.refresh(true);
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(this.error);
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
      if (message.kind === "devin-cli") this.devinUsage.cancelRefresh();
    }
    this.render();
    await this.globalState?.update(EXPANSION_STATE, [...this.expanded]);
    if (opening) await this.refresh(true);
  }

  private async consumeResetCredit(message: Record<string, unknown>): Promise<void> {
    const profile = this.service.state?.profiles.find(item => item.id === message.profileId && item.workspaceAccountId === message.workspaceAccountId);
    if (!profile) return;
    const key = usageExpansionKey("openai", profile.id, profile.workspaceAccountId);
    if (!this.expanded.has(key) || this.ticketConfirming.has(key) || this.resetCredits.busy(profile)) return;
    const retry = this.resetCredits.retrying(profile);
    if (!retry && (this.usage.get(profile.id, profile.workspaceAccountId)?.data?.rateLimitResetCredits?.availableCount ?? 0) <= 0) return;
    this.ticketConfirming.add(key);
    this.render();
    try {
      const action = retry ? "사용 결과 재확인" : "티켓 사용";
      const answer = await vscode.window.showWarningMessage(
        `${profile.email ?? profile.id} (${profile.workspaceAccountId})${retry ? "의 이전 리셋 티켓 사용 요청을 같은 요청 ID로 재확인할까요?" : "의 리셋 티켓 1개를 사용해 한도를 초기화할까요?"}`,
        { modal: true }, action,
      );
      if (answer !== action) return;
      if (!this.service.state?.profiles.some(item => item.id === profile.id && item.workspaceAccountId === profile.workspaceAccountId)) return;
      let outcome;
      try { outcome = await this.resetCredits.consume(profile); }
      catch (error) {
        throw new Error(`${error instanceof Error ? error.message : String(error)} · 사용 결과가 확인되지 않았습니다. 재확인 버튼은 같은 요청 ID를 사용합니다.`);
      }
      this.error = undefined;
      void vscode.window.showInformationMessage(resetCreditMessage(outcome));
      if (this.expanded.has(key)) await this.usage.refresh(profile.id, profile.workspaceAccountId, false, true);
    } finally {
      this.ticketConfirming.delete(key);
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
        `${provider.label}의 ${account.label} 계정을 제거할까요?`,
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

  private render(): void {
    if (!this.panel) return;
    const nonce = randomBytes(18).toString("base64");
    const state = this.service.state;
    const openAICards = state?.profiles.map(profile => {
      const entry = this.usage.get(profile.id, profile.workspaceAccountId);
      const expanded = this.expanded.has(usageExpansionKey("openai", profile.id, profile.workspaceAccountId));
      const active = profile.id === state.activeProfileId;
      const retry = this.resetCredits.retrying(profile);
      const busy = this.ticketConfirming.has(usageExpansionKey("openai", profile.id, profile.workspaceAccountId)) || this.resetCredits.busy(profile);
      const ticketAction = retry || (entry?.data?.rateLimitResetCredits?.availableCount ?? 0) > 0
        ? `<button data-action="consumeResetCredit" data-profile="${escapeHtml(profile.id)}" data-workspace="${escapeHtml(profile.workspaceAccountId)}" ${busy ? "disabled" : ""}>${busy ? "처리 중…" : retry ? "티켓 사용 결과 재확인" : "리셋 티켓 사용"}</button>` : "";
      const switchAction = active ? "" : `<button class="account-switch" data-action="openaiSwitch" data-profile="${escapeHtml(profile.id)}">현재 엔진 계정으로 전환</button>`;
      return `<section class="card account-card${expanded ? " expanded" : " collapsed"}"><div class="identity"><div class="account-heading">${usageToggleHtml(expanded, `data-profile="${escapeHtml(profile.id)}" data-workspace="${escapeHtml(profile.workspaceAccountId)}"`)}<div class="account-name"><h2>${escapeHtml(profile.email ?? profile.id)}</h2>${expanded ? `<p class="muted">${escapeHtml(openAIPlanLabel(entry?.data))} · ${escapeHtml(profile.workspaceAccountId)}</p>` : `<span class="muted account-provider">${escapeHtml(openAIPlanLabel(entry?.data))}</span>`}</div></div><div class="identity-actions">${active ? '<span class="badge">현재 엔진 계정</span>' : ""}${switchAction}</div></div>${expanded ? `<div class="usage-details">${openAIUsageHtml(entry?.data ?? null, profile.id)}${ticketAction}${entry?.error ? `<p class="error">갱신 실패 · ${escapeHtml(entry.error)}</p>` : ""}${entry?.lastSuccessAt ? `<p class="muted updated">${entry.error || this.error ? "이전 조회 값 · " : ""}마지막 갱신 ${escapeHtml(new Date(entry.lastSuccessAt).toLocaleString())}</p>` : ""}</div><div class="card-actions"><button data-action="openaiReauth" data-profile="${escapeHtml(profile.id)}">재인증</button><button data-action="openaiRemove" data-profile="${escapeHtml(profile.id)}">제거</button></div>` : ""}</section>`;
    }).join("") ?? "";
    const openAIState = `${state?.pendingProfileId ? `<p class="notice">현재 엔진의 계정 전환 대기 중 · ${escapeHtml(state.pendingProfileId)} <button data-action="openaiCancelSwitch">전환 취소</button></p>` : ""}${state?.loginPending ? '<p class="notice">OpenAI 로그인 대기 중 <button data-action="openaiLoginCancel">로그인 취소</button></p>' : ""}`;
    const providerCards = this.providerSnapshot?.providers.filter(provider => provider.authKind === "oauth" && provider.id.toLowerCase() !== "openai").flatMap(provider => provider.accounts.map(account => {
      const key = providerKey(provider.id, account.id);
      return providerAccountHtml(provider, account, this.providerQuotas.get(key) ?? this.providerQuotaErrors.get(key), this.providerQuotas.has(key) ? this.providerQuotaErrors.get(key) : undefined, this.expanded.has(usageExpansionKey("provider", provider.id, account.id)));
    })).join("") ?? "";
    const managedSection = this.providers?.enabled ? `<div class="provider"><span>관리형 공급자 계정</span><span class="actions"><button data-action="providerLoginCancel">로그인 취소</button><button data-action="providerAdd">공급자 계정 추가</button></span></div>${this.providerError || this.providers.error ? `<p class="error">${escapeHtml(this.providerError ?? this.providers.error)}</p>` : ""}${providerCards || '<section class="card"><p class="muted">등록된 관리형 공급자 계정이 없습니다. 공급자 계정 추가에서 사용 가능한 공급자를 확인하세요.</p></section>'}` : "";
    const devin = this.devin;
    const devinQuota = devin?.loggedIn ? this.devinUsage.snapshot : undefined;
    const devinExpanded = !!devin?.loggedIn && !!devin.email && this.expanded.has(usageExpansionKey("devin-cli", devin.email));
    const devinToggle = devin?.loggedIn && devin.email ? usageToggleHtml(devinExpanded, `data-kind="devin-cli" data-account="${escapeHtml(devin.email)}"`) : "";
    const devinActions = `<div class="card-actions"><button data-action="manageDevin">Devin CLI 로그인 관리</button><button class="text-button" data-action="devinBilling">Devin 사용량 열기 ↗</button></div>`;
    const devinCard = `<section class="card account-card${devinExpanded ? " expanded" : " collapsed"}"><div class="identity"><div class="account-heading">${devinToggle}<div class="account-name"><h2>${escapeHtml(devin?.email ?? "Devin CLI")}</h2>${devinExpanded ? `<p class="muted">CLI identity${devin?.plan ? ` · ${escapeHtml(devin.plan)}` : ""} · 관리형 Devin 계정과 별도</p>` : ""}</div></div>${devin?.loggedIn ? '<span class="badge">CLI 로그인됨</span>' : ""}</div>${devinExpanded ? `<div class="usage-details">${devinQuota ? `${quotaHtml(devinQuota.daily, "일일 한도")}${quotaHtml(devinQuota.weekly, "주간 한도")}<p class="muted updated">${this.devinError ? "이전 조회 값 · " : ""}마지막 갱신 ${escapeHtml(new Date(devinQuota.updatedAt).toLocaleString())}</p>` : `<p class="muted">${this.refreshing ? "CLI 사용량을 불러오는 중…" : devin?.enabled === false ? "Devin CLI 연결이 비활성화되어 있습니다." : "CLI 사용량을 가져오지 못했습니다."}</p>`}${this.devinError ? `<p class="error">${escapeHtml(this.devinError)}</p>` : ""}</div>` : ""}${devinExpanded || !devinToggle ? devinActions : ""}</section>`;
    this.panel.webview.html = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>${usageStyles}</style></head><body><main><header><div><h1>계정 및 사용량</h1><p class="muted subtitle">계정을 관리하고 계정별 한도를 확인합니다.</p></div><div class="actions"><button data-action="refresh" ${this.refreshing ? "disabled" : ""}>${this.refreshing ? "갱신 중…" : "새로고침"}</button></div></header>${this.error ? `<p class="error">${escapeHtml(this.error)}</p>` : ""}<div class="provider"><span>OpenAI</span><span class="actions"><button data-action="openaiCapture">현재 계정 저장</button><button data-action="openaiLogin">계정 추가</button></span></div>${openAIState}${openAICards || '<section class="card"><p class="muted">저장된 OpenAI 계정이 없습니다. 현재 엔진 계정을 저장하거나 계정을 추가하세요.</p></section>'}${managedSection}<div class="provider"><span>Devin CLI</span></div>${devinCard}</main><script nonce="${nonce}">const vscode=acquireVsCodeApi();document.addEventListener('click',e=>{if(!(e.target instanceof Element))return;const b=e.target.closest('button[data-action]');if(b instanceof HTMLElement)vscode.postMessage({action:b.dataset.action,profileId:b.dataset.profile,providerId:b.dataset.provider,accountId:b.dataset.account,workspaceAccountId:b.dataset.workspace,kind:b.dataset.kind});});</script></body></html>`;
  }
}

function providerKey(providerId: string, accountId: string): string { return `${providerId}\u0000${accountId}`; }

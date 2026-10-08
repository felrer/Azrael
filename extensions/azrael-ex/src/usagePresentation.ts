import { AccountUsage, RateLimitSnapshot, RateLimitWindow } from "./protocol";
import { ManagedProvider, ProviderAccount, ProviderAccountQuota, ProviderQuotaRow } from "./providerAccountProtocol";

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

export function dynamicTextHtml(value: unknown): string {
  return `<span data-azrael-dynamic-text>${escapeHtml(value)}</span>`;
}

export function usageExpansionKey(kind: "openai" | "provider" | "devin-cli", account: string, workspace?: string): string {
  return JSON.stringify(workspace === undefined ? [kind, account] : [kind, account, workspace]);
}

export function accountSummaryHtml(label: string, expanded: boolean, attributes: string, gauges: string, active = false): string {
  return `<div class="account-summary" role="button" tabindex="0" data-action="toggleUsage" aria-expanded="${expanded}" ${attributes}><div class="account-line"><div class="account-identity"><h2>${dynamicTextHtml(label)}</h2>${active ? '<span class="badge current-login">현재 로그인</span>' : ""}</div><span class="account-chevron" aria-hidden="true">상세 <svg viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg></span></div><div class="usage-overview">${gauges}</div></div>`;
}

export function providerIconHtml(id: string): string {
  const icons: Record<string, string> = {
    openai: '<g fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3a5 5 0 0 1 8 5 5 5 0 0 1 0 8 5 5 0 0 1-8 5 5 5 0 0 1-8-5 5 5 0 0 1 0-8 5 5 0 0 1 8-5Z"/><path d="m12 6 5 3v6l-5 3-5-3V9Z M12 6v6l5 3 M7 9l5 3-5 3 M12 18v-6l5-3"/></g>',
    anthropic: '<g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2v20M2 12h20M5 5l14 14M5 19 19 5M8 3l8 18M3 8l18 8M3 16l18-8M8 21l8-18"/></g>',
    google: '<path fill="currentColor" d="M12 1c1.6 6.8 4.2 9.4 11 11-6.8 1.6-9.4 4.2-11 11C10.4 16.2 7.8 13.6 1 12c6.8-1.6 9.4-4.2 11-11Z"/>',
    devin: '<g fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="15" rx="5"/><path d="M12 2v3M7 14h10"/><path stroke-linecap="round" d="M8 10h.1M16 10h.1"/></g>',
  };
  const key = /^(google|gemini|google-gemini)/i.test(id) ? "google" : /^devin/i.test(id) ? "devin" : id;
  const drawing = icons[key] ?? '<g fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4" width="16" height="16" rx="5"/><path d="M8 12h8M12 8v8"/></g>';
  return `<span class="provider-icon provider-icon-${escapeHtml(key)}" aria-hidden="true"><svg viewBox="0 0 24 24">${drawing}</svg></span>`;
}

export function providerHeadingHtml(id: string, label: string, count: number, actions = ""): string {
  return `<div class="provider" data-provider="${escapeHtml(id)}"><div class="provider-title">${providerIconHtml(id)}<h2>${dynamicTextHtml(label)}</h2><span class="provider-count">${dynamicTextHtml(count)}개 계정</span></div><div class="provider-actions">${actions}</div></div>`;
}

export function visibleLimits(usage: AccountUsage): RateLimitSnapshot[] {
  const entries = Object.entries(usage.rateLimitsByLimitId ?? { default: usage.rateLimits });
  return entries.filter(([key, limit]) => ![key, limit.limitId, limit.limitName, limit.normalModelSlug]
    .some(value => typeof value === "string" && /spark/i.test(value))).map(([, limit]) => limit);
}

export function resetText(reset: number | null, now = Date.now()): string {
  if (reset === null || !Number.isFinite(reset)) return "리셋 시간 미제공";
  const minutes = Math.ceil((reset * 1000 - now) / 60_000);
  const relative = minutes <= 0 ? "리셋 시간 경과 · 갱신 대기" : minutes >= 1440
    ? `${Math.floor(minutes / 1440)}일 ${Math.floor(minutes % 1440 / 60)}시간 후 리셋`
    : minutes >= 60 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 후 리셋` : `${minutes}분 후 리셋`;
  return relative;
}

export function quotaHtml(window: RateLimitWindow | null, fallback: string): string {
  if (!window) return "";
  const duration = window.windowDurationMins;
  const label = duration === 10080 ? "주간 한도" : duration === 1440 ? "일일 한도" : duration === 300 ? "5시간 한도"
    : duration !== null ? `${duration % 60 === 0 ? `${duration / 60}시간` : `${duration}분`} 한도` : fallback;
  const dynamicDuration = duration !== null && ![10080, 1440, 300].includes(duration);
  const valid = Number.isFinite(window.usedPercent) && window.usedPercent >= 0 && window.usedPercent <= 100;
  const remaining = valid ? Math.round((100 - window.usedPercent) * 10) / 10 : null;
  return `<div class="quota"><div class="quota-heading"><span${dynamicDuration ? " data-azrael-dynamic-text" : ""}>${escapeHtml(label)}</span><strong${remaining === null ? "" : " data-azrael-dynamic-text"}>${remaining === null ? "조회 불가" : `${remaining}% 남음`}</strong></div>${remaining === null ? "" : `<div class="track" role="progressbar" aria-label="${escapeHtml(label)} 잔여량" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${remaining}"><div class="fill${remaining <= 10 ? " low" : ""}" style="width:${remaining}%"></div></div>`}<p class="muted reset">${window.resetsAt === null || !Number.isFinite(window.resetsAt) ? escapeHtml(resetText(window.resetsAt)) : dynamicTextHtml(resetText(window.resetsAt))}</p></div>`;
}

export interface ResetTicketPresentation {
  workspaceAccountId: string;
  expanded?: boolean;
  confirmingCreditId?: string;
  retryCreditId?: string;
  busy?: boolean;
  busyCreditId?: string;
  changesEnabled?: boolean;
}

export function openAIQuotaHtml(usage: AccountUsage | null): string {
  if (!usage) return '<p class="muted">사용량을 아직 가져오지 못했습니다.</p>';
  const limits = visibleLimits(usage);
  const quotas = limits.map(limit => `<div class="limit">${limits.length > 1 ? `<h3>${limit.limitName != null || limit.limitId != null ? dynamicTextHtml(limit.limitName ?? limit.limitId) : "Codex"}</h3>` : ""}${quotaHtml(limit.primary, "기본 한도")}${quotaHtml(limit.secondary, "추가 한도")}${!limit.primary && !limit.secondary ? '<p class="muted">한도 정보 미제공</p>' : ""}</div>`).join("");
  return quotas || '<p class="muted">표시할 Codex 사용량이 없습니다.</p>';
}

export function openAIUsageHtml(usage: AccountUsage | null, profileId: string, ticketState?: ResetTicketPresentation, includeQuotas = true): string {
  if (!usage) return includeQuotas ? openAIQuotaHtml(usage) : "";
  const tickets = usage.rateLimitResetCredits;
  const details = tickets?.credits;
  const available = details?.filter(credit => credit.status === "available") ?? [];
  const pendingId = ticketState?.retryCreditId;
  if (pendingId && !available.some(credit => credit.id === pendingId)) {
    const previous = details?.find(credit => credit.id === pendingId);
    available.push(previous ?? { id: pendingId, title: "사용 결과 재확인", description: null, status: "available", resetType: "codexRateLimits", grantedAt: 0, expiresAt: null });
  }
  const rows = available.map(credit => {
    const title = credit.title?.trim() || "사용량 초기화";
    const expiration = credit.expiresAt === null ? null : new Date(credit.expiresAt * 1000);
    const expiry = expiration ? expiration.toLocaleDateString(undefined, { day: "numeric", month: "long" }) : "";
    const tooltip = expiration ? expiration.toLocaleString(undefined, { day: "numeric", month: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "";
    const confirming = ticketState?.confirmingCreditId === credit.id;
    const eligible = credit.resetType === "codexRateLimits" && Number.isSafeInteger(credit.grantedAt)
      && (credit.expiresAt === null || (Number.isSafeInteger(credit.expiresAt) && credit.expiresAt > Date.now() / 1000));
    const disabled = ticketState?.busy || ticketState?.changesEnabled === false || (!pendingId && (!eligible || !tickets || tickets.availableCount <= 0)) || (pendingId !== undefined && pendingId !== credit.id);
    const action = ticketState ? `<div class="ticket-control"><button class="ticket-use${confirming ? " confirming" : ""}" data-action="consumeResetCredit" data-profile="${escapeHtml(profileId)}" data-workspace="${escapeHtml(ticketState.workspaceAccountId)}" data-credit="${escapeHtml(credit.id)}"${confirming ? ' data-ticket-confirming="true" autofocus' : ""} aria-label="${escapeHtml(`${confirming ? "확인" : pendingId === credit.id ? "사용 결과 재확인" : "사용"}: ${title}${tooltip ? ` · ${tooltip}` : ""}`)}" ${disabled ? "disabled" : ""}>${ticketState.busy && ticketState.busyCreditId === credit.id ? '<span class="ticket-spinner" aria-hidden="true"></span>사용' : confirming ? "확인" : pendingId === credit.id ? "재확인" : "사용"}</button></div>` : "";
    return `<div class="reset-ticket"><div class="ticket-content"><span class="ticket-title">${dynamicTextHtml(title)}</span>${expiry ? `<span class="ticket-expiry" title="${escapeHtml(tooltip)}">${dynamicTextHtml(expiry)}</span>` : ""}</div>${action}</div>`;
  }).join("");
  const ticketDetails = tickets || pendingId ? `<details class="ticket-details" data-profile="${escapeHtml(profileId)}" data-workspace="${escapeHtml(ticketState?.workspaceAccountId ?? "")}"${ticketState?.expanded ? " open" : ""}><summary>티켓 상세</summary><div class="reset-ticket-list">${rows || `<p class="ticket-empty">${details === null ? "티켓 상세를 불러오는 중…" : "사용 가능한 티켓이 없습니다."}</p>`}</div></details>` : "";
  return `${includeQuotas ? openAIQuotaHtml(usage) : ""}${ticketDetails}`;
}

function providerNumber(value: number | undefined, unit: string | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return `${new Intl.NumberFormat().format(value)}${unit ? ` ${unit}` : ""}`;
}

export function providerQuotaRowHtml(row: ProviderQuotaRow): string {
  const remaining = providerNumber(row.remaining, row.unit);
  const limit = providerNumber(row.limit, row.unit);
  const spend = providerNumber(row.used, row.unit);
  const used = row.usedPercent !== undefined && Number.isFinite(row.usedPercent)
    ? `${row.usedPercent.toLocaleString()}% 사용`
    : undefined;
  const value = row.limitUnset === true ? "지출 한도 미설정" : row.unlimited === true ? "무제한" : remaining && limit ? `${remaining} 남음 / ${limit}` : remaining ? `${remaining} 남음` : limit ? `한도 ${limit}` : spend ? `${spend} 사용` : used ?? "수치 미제공";
  const dynamicValue = row.limitUnset !== true && row.unlimited !== true && !!(remaining || limit || spend || used);
  const percent = row.usedPercent !== undefined && Number.isFinite(row.usedPercent) && row.usedPercent >= 0 && row.usedPercent <= 100
    ? row.usedPercent : row.usedPercent === undefined && row.remaining !== undefined && row.limit !== undefined
      && Number.isFinite(row.remaining) && Number.isFinite(row.limit) && row.limit > 0 && row.remaining >= 0 && row.remaining <= row.limit
      ? (1 - row.remaining / row.limit) * 100 : undefined;
  if (row.limitUnset !== true && row.unlimited !== true && percent !== undefined) {
    return quotaHtml({ usedPercent: percent, windowDurationMins: null, resetsAt: row.resetsAt ?? null }, row.label);
  }
  const reset = row.resetsAt === undefined ? "" : `<span class="muted reset">${dynamicTextHtml(resetText(row.resetsAt))}</span>`;
  return `<div class="provider-quota-row"><span>${dynamicTextHtml(row.label)}</span><span class="provider-quota-value"><strong${dynamicValue ? " data-azrael-dynamic-text" : ""}>${escapeHtml(value)}</strong>${reset}</span></div>`;
}

export function providerQuotaHtml(quota: ProviderAccountQuota | undefined, latestError?: ProviderAccountQuota): string {
  if (!quota) return '<p class="muted">계정별 한도를 불러오는 중…</p>';
  const stale = latestError ? '<p class="muted stale">이전 조회 값</p>' : "";
  const failure = latestError ? `<p class="error">최신 한도 조회 실패${latestError.error ? ` · ${dynamicTextHtml(latestError.error)}` : ""}</p>` : "";
  if (quota.status === "unsupported") return `<p class="muted">이 계정은 계정별 한도 조회를 지원하지 않습니다.</p>${stale}${failure}`;
  if (quota.status === "error") return `<p class="error">한도 조회 실패${quota.error ? ` · ${dynamicTextHtml(quota.error)}` : ""}</p>${failure}`;
  return `${quota.rows.length ? quota.rows.map(row => quota.providerId === "anthropic" && row.label === "Fable" && row.unlimited !== true && row.limitUnset !== true
    ? quotaHtml({ usedPercent: row.usedPercent ?? NaN, windowDurationMins: null, resetsAt: row.resetsAt ?? null }, "Fable 주간 한도")
    : providerQuotaRowHtml(row)).join("") : '<p class="muted">제공된 한도 항목이 없습니다.</p>'}${stale}${failure}`;
}

export function autoSwitchCheckboxHtml(enabled: boolean | undefined, attributes: string, pending = false): string {
  return `<label class="auto-switch"><input type="checkbox" data-action="setAutoSwitch" ${attributes} ${enabled === true ? "checked" : ""} ${pending ? "disabled" : ""}><span class="switch-track" aria-hidden="true"></span>자동 전환 허용</label>`;
}

export function providerAccountHtml(provider: ManagedProvider, account: ProviderAccount, quota: ProviderAccountQuota | undefined, latestError?: ProviderAccountQuota, expanded = false, autoSwitchPending = false): string {
  if (provider.authKind !== "oauth") return "";
  const chatConnected = provider.inferenceConnected && account.selected && !account.needsReauth;
  const chat = chatConnected ? "채팅 연결 설정됨" : "채팅 미연결";
  const defaultLabel = provider.inferenceConnected ? "새 채팅 기본 계정" : "기본 계정";
  const attributes = `data-provider="${escapeHtml(provider.id)}" data-account="${escapeHtml(account.id)}"`;
  const authAction = `<button data-action="providerReauth" ${attributes}>${account.needsReauth ? "다시 인증" : "재인증"}</button>`;
  const switchAction = account.selected ? `<span class="muted">${defaultLabel}</span>` : `<button class="account-switch" data-action="providerSelect" ${attributes}>${defaultLabel}으로 선택</button>`;
  return `<section class="card account-card provider-account${expanded ? " expanded" : " collapsed"}">${accountSummaryHtml(account.label, expanded, attributes, providerQuotaHtml(quota, latestError), chatConnected)}${expanded ? `<div class="usage-details"><div class="account-management"><p class="muted">${dynamicTextHtml(provider.label)} · ${chat}${account.needsReauth ? " · 인증 필요" : ""}</p>${switchAction}${provider.inferenceConnected && account.autoSwitchAvailable !== false ? autoSwitchCheckboxHtml(account.autoSwitchAllowed, attributes, autoSwitchPending) : ""}</div><div class="card-actions">${authAction}<button data-action="providerRemove" ${attributes}>제거</button></div></div>` : ""}</section>`;
}

// Pinned OpenAI nUn/HHn settings group and Kw toolbar button presentation.
// Native tokens inherit on the embedded surface; VS Code tokens cover the standalone page.
const resetTicketStyles = `
.ticket-details{margin-top:16px}.ticket-details summary{font-size:13px}.reset-ticket-list{container-type:inline-size;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--color-border,var(--vscode-panel-border));border-radius:var(--radius-2xl,16px);background:var(--color-background-panel,var(--color-background-primary-soft-alpha,var(--vscode-editor-background)));margin-top:12px}.reset-ticket{position:relative;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:12px 16px}.reset-ticket:not(:last-child)::after{content:"";position:absolute;bottom:0;left:16px;right:16px;height:1px;background:var(--color-border,var(--vscode-panel-border));pointer-events:none}.ticket-content{display:flex;flex:1;min-width:0;flex-direction:column;gap:2px}.ticket-title{font-size:var(--text-sm,13px);font-weight:500;color:var(--color-text,var(--vscode-foreground));overflow-wrap:anywhere}.ticket-expiry{font-size:var(--text-xs,12px);line-height:16px;color:var(--color-text-secondary,var(--vscode-descriptionForeground));overflow-wrap:anywhere}.ticket-control{display:flex;max-width:100%;min-width:min(160px,40cqw);flex-shrink:0;align-items:center;justify-content:flex-end;gap:8px}.ticket-use{display:flex;align-items:center;justify-content:center;gap:4px;user-select:none;white-space:nowrap;border:1px solid transparent;border-radius:var(--radius-button-toolbar,var(--radius-lg,10px));height:var(--spacing-token-button-composer,28px);padding:0 var(--spacing-button-toolbar-inline,8px);font-size:var(--text-sm,13px);line-height:18px;color:var(--color-text,var(--vscode-foreground));background:color-mix(in oklab,var(--color-text,var(--vscode-foreground)) 5%,transparent)}.ticket-use:hover:enabled{background:color-mix(in oklab,var(--color-text,var(--vscode-foreground)) 10%,transparent)}.ticket-use.confirming{border-color:var(--color-border,var(--vscode-panel-border));background:var(--color-background-primary-solid,var(--vscode-foreground));color:var(--color-text-primary-solid,var(--vscode-editor-background))}.ticket-use.confirming:hover:enabled{background:color-mix(in oklab,var(--color-text,var(--vscode-foreground)) 80%,transparent)}.ticket-use:disabled{opacity:.4;cursor:default}.ticket-use:focus-visible{outline:2px solid var(--color-ring,var(--vscode-focusBorder));outline-offset:0}.ticket-empty{font-size:13px;color:var(--color-text-secondary,var(--vscode-descriptionForeground));margin:0;padding:12px 16px}.ticket-spinner{width:12px;height:12px;border:1.5px solid currentColor;border-right-color:transparent;border-radius:50%;animation:ticket-spin .8s linear infinite}@keyframes ticket-spin{to{transform:rotate(360deg)}}`;

export const usageStyles = resetTicketStyles + `
:root,:host{color-scheme:light;--usage-ink:#202123;--usage-secondary:#77787b;--usage-border:#e6e6e8;--usage-soft:#f6f6f6;--usage-track:#ececee;--color-text:var(--usage-ink);--color-text-secondary:var(--usage-secondary);--color-border:var(--usage-border);--color-background-panel:#fff;--color-background-primary-solid:#202123;--color-text-primary-solid:#fff}
[data-azrael-dynamic-text]{font-family:Consolas,"Azrael Gyeonggi Title","Malgun Gothic","Segoe UI Emoji",monospace!important;font-weight:400!important;font-synthesis-weight:none;word-spacing:-0.5ch!important}*{box-sizing:border-box}
body,:host{margin:0;background:#fff;color:var(--usage-ink);font-family:var(--vscode-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);font-size:13px;line-height:1.5}main{background:#fff;color:var(--usage-ink);max-width:980px;margin:0 auto;padding:36px 28px 60px}header{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:28px}h1{font-size:26px;font-weight:600;letter-spacing:-.5px;margin:0}h2{font-size:14px;font-weight:600;margin:0}h3{font-size:12px;font-weight:500;margin:0}.subtitle{margin:6px 0 0}.muted{color:var(--usage-secondary)}
.provider{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:28px 2px 12px}.provider-title{display:flex;align-items:center;gap:10px;min-width:0}.provider h2{font-size:17px}.provider-count{font-size:12px;color:var(--usage-secondary);white-space:nowrap}.provider-actions,.actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.provider-actions button{font-size:12px;padding:5px 10px}.provider-icon{width:30px;height:30px;flex:0 0 30px;display:grid;place-items:center;border-radius:var(--radius-lg,9px);background:var(--usage-soft)}.provider-icon svg{width:24px;height:24px}.provider-icon-anthropic{color:#cf7953}.provider-icon-google{color:#8580dd}
.provider-group{border:1px solid var(--usage-border);border-radius:var(--radius-2xl,18px);overflow:hidden;background:#fff}.card{border:1px solid var(--usage-border);border-radius:var(--radius-2xl,18px);background:#fff;margin-bottom:14px;padding:20px}.account-card{padding:0;overflow:hidden}.provider-group>.account-card{border:0;border-radius:0;margin:0}.provider-group>.account-card+.account-card{border-top:1px solid var(--usage-border)}
.account-summary{padding:17px 21px 18px;cursor:pointer}.account-summary:hover{background:#fafafa}.account-summary:focus-visible{outline:2px solid var(--color-ring,var(--vscode-focusBorder,#3086e9));outline-offset:-3px}.account-line{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:11px}.account-identity{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}.account-identity h2{overflow-wrap:anywhere}.badge{display:inline-flex;align-items:center;font-size:10px;border-radius:20px;padding:2px 7px;white-space:nowrap}.badge.current-login{gap:5px;background:#eeeef0;color:#66676b}.badge.current-login:before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor}.account-chevron{display:flex;align-items:center;gap:7px;color:#929297;font-size:11px;white-space:nowrap}.account-chevron svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.7;transition:transform .15s}.account-summary[aria-expanded="true"] .account-chevron svg{transform:rotate(180deg)}
.usage-overview{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 26px}.usage-overview .limit{display:contents}.usage-overview .quota:only-child{grid-column:1/-1}.usage-overview .limit h3,.usage-overview>.error,.usage-overview>.stale{grid-column:1/-1}.quota{margin:0;min-width:0}.quota-heading,.provider-quota-row{display:flex;justify-content:space-between;gap:12px;font-size:11px}.quota-heading>span{color:#66676b}.quota-heading strong,.provider-quota-row strong{font-weight:500}.track{height:6px;border-radius:6px;overflow:hidden;background:var(--usage-track);margin-top:7px}.fill{height:100%;border-radius:6px;background:#252526}.fill.low{background:#b57728}.reset{font-size:10px;margin:6px 0 0}.provider-quota-row{align-items:flex-start}.provider-quota-value{display:flex;flex-direction:column;text-align:right}.error{color:#b23a3a;font-size:12px}.stale{font-size:11px;margin:0}.notice{border-left:2px solid #b57728;padding:8px 12px}
.usage-details{padding:17px 21px 19px;background:#fcfcfc;border-top:1px solid var(--usage-border)}.account-management{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.account-management p{margin:0;flex:1}.card-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:16px}button{font:inherit;color:var(--usage-ink);background:#fff;border:1px solid var(--usage-border);border-radius:var(--radius-lg,10px);padding:7px 12px;cursor:pointer}button:hover{background:var(--usage-soft)}button:focus-visible,summary:focus-visible{outline:2px solid var(--color-ring,var(--vscode-focusBorder,#3086e9));outline-offset:3px}button:disabled{opacity:.5;cursor:default}.text-button{border:0;padding:8px 0;color:var(--usage-ink)}details{font-size:12px;margin-top:12px}summary{cursor:pointer}.auto-switch{position:relative;display:inline-flex;align-items:center;gap:8px;font-size:12px;white-space:nowrap;cursor:pointer}.auto-switch input{position:absolute;left:0;top:0;width:32px;height:20px;margin:0;opacity:0;cursor:pointer}.switch-track{width:32px;height:20px;border-radius:20px;background:#d0d0d2;position:relative;pointer-events:none}.switch-track:after{content:"";position:absolute;width:16px;height:16px;left:2px;top:2px;border-radius:50%;background:#fff;transition:transform .15s}.auto-switch input:checked+.switch-track{background:#242424}.auto-switch input:checked+.switch-track:after{transform:translateX(12px)}.auto-switch input:focus-visible+.switch-track{outline:2px solid var(--color-ring,var(--vscode-focusBorder,#3086e9));outline-offset:3px}.auto-switch:has(input:disabled){opacity:.5;cursor:default}.auto-switch input:disabled{cursor:default}.account-switch{font-size:12px;padding:5px 10px}
.empty-state{padding:20px 21px;margin:0;color:var(--usage-secondary)}.provider-management{padding:17px 21px 19px;border-top:1px solid var(--usage-border);background:#fcfcfc}.settings-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 0;font-size:12px}.usage-hint{color:var(--usage-secondary);font-size:11px;margin:18px 0 0}.remove-account{border-color:transparent;color:#a24949;background:transparent}
@media(max-width:600px){.account-management>p{flex:1 1 100%}.account-management>.auto-switch{margin-left:auto}main{padding:24px 16px}header{align-items:flex-start;flex-wrap:wrap}.provider{align-items:flex-start}.provider-title{gap:7px;flex-wrap:wrap}.provider h2{font-size:15px}.provider-count{font-size:11px}.account-summary,.usage-details{padding:15px}.usage-overview{grid-template-columns:minmax(0,1fr);gap:12px}.account-line{align-items:flex-start}.account-chevron{font-size:0;gap:0}.actions,.card-actions{flex-wrap:wrap}.actions button,.card-actions button{flex:1 1 auto}.card-actions:has(>button[data-action^="autoWindow"]){display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:stretch}.card-actions:has(>button[data-action^="autoWindow"])>button{min-width:0;padding:7px 8px;white-space:normal}}
`;

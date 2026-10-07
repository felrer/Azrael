import { AccountUsage, RateLimitSnapshot, RateLimitWindow } from "./protocol";
import { ManagedProvider, ProviderAccount, ProviderAccountQuota, ProviderQuotaRow } from "./providerAccountProtocol";

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

export function dynamicTextHtml(value: unknown): string {
  return `<span data-azrael-dynamic-text>${escapeHtml(value)}</span>`;
}

export function planLabelHtml(usage: AccountUsage | null | undefined): string {
  const label = openAIPlanLabel(usage);
  return label === "요금제 확인 필요" ? escapeHtml(label) : dynamicTextHtml(label);
}

export function usageExpansionKey(kind: "openai" | "provider" | "devin-cli", account: string, workspace?: string): string {
  return JSON.stringify(workspace === undefined ? [kind, account] : [kind, account, workspace]);
}

export function usageToggleHtml(expanded: boolean, attributes: string): string {
  return `<button class="usage-toggle" data-action="toggleUsage" aria-expanded="${expanded}" aria-label="${expanded ? "사용량 접기" : "사용량 펼치기"}" ${attributes}><span aria-hidden="true">${expanded ? "▾" : "▸"}</span></button>`;
}

export function openAIPlanLabel(usage: AccountUsage | null | undefined): string {
  const plan = usage?.rateLimits?.planType?.trim();
  if (plan) return plan;
  const plans = new Set(Object.values(usage?.rateLimitsByLimitId ?? {})
    .map(limit => limit.planType?.trim()).filter((value): value is string => !!value));
  return plans.size === 1 ? [...plans][0] : "요금제 확인 필요";
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
  return `${relative} · ${new Date(reset * 1000).toLocaleString()}`;
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

export function openAIUsageHtml(usage: AccountUsage | null, profileId: string, ticketState?: ResetTicketPresentation): string {
  if (!usage) return '<p class="muted">사용량을 아직 가져오지 못했습니다.</p>';
  const limits = visibleLimits(usage);
  const quotas = limits.map(limit => `<div class="limit">${limits.length > 1 ? `<h3>${limit.limitName != null || limit.limitId != null ? dynamicTextHtml(limit.limitName ?? limit.limitId) : "Codex"}</h3>` : ""}${quotaHtml(limit.primary, "기본 한도")}${quotaHtml(limit.secondary, "추가 한도")}${!limit.primary && !limit.secondary ? '<p class="muted">한도 정보 미제공</p>' : ""}</div>`).join("");
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
  return `${quotas || '<p class="muted">표시할 Codex 사용량이 없습니다.</p>'}${ticketDetails}`;
}

function providerTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "관측 기록 없음";
  const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
  return new Date(milliseconds).toLocaleString();
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
  const reset = row.resetsAt === undefined ? "" : `<span class="muted">리셋 ${row.resetsAt > 0 && Number.isFinite(row.resetsAt) ? dynamicTextHtml(providerTime(row.resetsAt)) : escapeHtml(providerTime(row.resetsAt))}</span>`;
  return `<div class="provider-quota-row"><span>${dynamicTextHtml(row.label)}</span><span class="provider-quota-value"><strong${dynamicValue ? " data-azrael-dynamic-text" : ""}>${escapeHtml(value)}</strong>${reset}</span></div>`;
}

export function providerQuotaHtml(quota: ProviderAccountQuota | undefined, latestError?: ProviderAccountQuota): string {
  if (!quota) return '<p class="muted">계정별 한도를 불러오는 중…</p>';
  const observation = `<p class="muted updated">${latestError ? "이전 조회 값 · " : ""}출처 ${dynamicTextHtml(quota.source)} · 관측 ${quota.observedAt > 0 && Number.isFinite(quota.observedAt) ? dynamicTextHtml(providerTime(quota.observedAt)) : escapeHtml(providerTime(quota.observedAt))}</p>`;
  if (quota.status === "unsupported") return `<p class="muted">이 계정은 계정별 한도 조회를 지원하지 않습니다.</p>${observation}`;
  if (quota.status === "error") return `<p class="error">한도 조회 실패${quota.error ? ` · ${dynamicTextHtml(quota.error)}` : ""}</p>${observation}`;
  const failure = latestError ? `<p class="error">최신 한도 조회 실패${latestError.error ? ` · ${dynamicTextHtml(latestError.error)}` : ""}</p><p class="muted updated">실패 출처 ${dynamicTextHtml(latestError.source)} · 관측 ${latestError.observedAt > 0 && Number.isFinite(latestError.observedAt) ? dynamicTextHtml(providerTime(latestError.observedAt)) : escapeHtml(providerTime(latestError.observedAt))}</p>` : "";
  return `${quota.rows.length ? quota.rows.map(row => quota.providerId === "anthropic" && row.label === "Fable"
    ? quotaHtml({ usedPercent: row.usedPercent ?? NaN, windowDurationMins: null, resetsAt: row.resetsAt ?? null }, "Fable 주간 한도")
    : providerQuotaRowHtml(row)).join("") : '<p class="muted">제공된 한도 항목이 없습니다.</p>'}${observation}${failure}`;
}

export function autoSwitchCheckboxHtml(enabled: boolean | undefined, attributes: string, pending = false): string {
  return `<label class="auto-switch"><input type="checkbox" data-action="setAutoSwitch" ${attributes} ${enabled === true ? "checked" : ""} ${pending ? "disabled" : ""}>자동 전환 허용</label>`;
}

export function providerAccountHtml(provider: ManagedProvider, account: ProviderAccount, quota: ProviderAccountQuota | undefined, latestError?: ProviderAccountQuota, expanded = false, autoSwitchPending = false): string {
  if (provider.authKind !== "oauth") return "";
  const chatConnected = provider.inferenceConnected && account.selected;
  const chat = chatConnected ? "채팅 연결 설정됨" : "채팅 미연결";
  const defaultLabel = provider.inferenceConnected ? "새 채팅 기본 계정" : "기본 계정";
  const authAction = `<button data-action="providerReauth" data-provider="${escapeHtml(provider.id)}" data-account="${escapeHtml(account.id)}">${account.needsReauth ? "다시 인증" : "재인증"}</button>`;
  const switchAction = account.selected ? "" : `<button class="account-switch" data-action="providerSelect" data-provider="${escapeHtml(provider.id)}" data-account="${escapeHtml(account.id)}">${defaultLabel}으로 선택</button>`;
  return `<section class="card account-card provider-account${expanded ? " expanded" : " collapsed"}"><div class="identity"><div class="account-heading">${usageToggleHtml(expanded, `data-provider="${escapeHtml(provider.id)}" data-account="${escapeHtml(account.id)}"`)}<div class="account-name"><h2>${dynamicTextHtml(account.label)}</h2>${expanded ? `<p class="muted">${dynamicTextHtml(provider.label)} · ${dynamicTextHtml(account.id)}</p>` : `<span class="muted account-provider">${dynamicTextHtml(provider.label)}</span>`}</div></div><div class="identity-actions"><div class="badges">${account.selected ? `<span class="badge">${defaultLabel}</span>` : ""}<span class="badge${chatConnected ? "" : " disconnected"}">${chat}</span></div>${switchAction}${provider.inferenceConnected && account.autoSwitchAvailable !== false ? autoSwitchCheckboxHtml(account.autoSwitchAllowed, `data-provider="${escapeHtml(provider.id)}" data-account="${escapeHtml(account.id)}"`, autoSwitchPending) : ""}</div></div>${expanded ? `<div class="usage-details">${providerQuotaHtml(quota, latestError)}</div><div class="card-actions">${authAction}<button data-action="providerRemove" data-provider="${escapeHtml(provider.id)}" data-account="${escapeHtml(account.id)}">제거</button></div>` : ""}</section>`;
}

// Pinned OpenAI nUn/HHn settings group and Kw toolbar button presentation.
// Native tokens inherit on the embedded surface; VS Code tokens cover the standalone page.
const resetTicketStyles = `
.ticket-details{margin-top:16px}.ticket-details summary{font-size:13px}.reset-ticket-list{container-type:inline-size;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--color-border,var(--vscode-panel-border));border-radius:var(--radius-2xl,16px);background:var(--color-background-panel,var(--color-background-primary-soft-alpha,var(--vscode-editor-background)));margin-top:12px}.reset-ticket{position:relative;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:12px 16px}.reset-ticket:not(:last-child)::after{content:"";position:absolute;bottom:0;left:16px;right:16px;height:1px;background:var(--color-border,var(--vscode-panel-border));pointer-events:none}.ticket-content{display:flex;flex:1;min-width:0;flex-direction:column;gap:2px}.ticket-title{font-size:var(--text-sm,13px);font-weight:500;color:var(--color-text,var(--vscode-foreground));overflow-wrap:anywhere}.ticket-expiry{font-size:var(--text-xs,12px);line-height:16px;color:var(--color-text-secondary,var(--vscode-descriptionForeground));overflow-wrap:anywhere}.ticket-control{display:flex;max-width:100%;min-width:min(160px,40cqw);flex-shrink:0;align-items:center;justify-content:flex-end;gap:8px}.ticket-use{display:flex;align-items:center;justify-content:center;gap:4px;user-select:none;white-space:nowrap;border:1px solid transparent;border-radius:var(--radius-button-toolbar,var(--radius-lg,10px));height:var(--spacing-token-button-composer,28px);padding:0 var(--spacing-button-toolbar-inline,8px);font-size:var(--text-sm,13px);line-height:18px;color:var(--color-text,var(--vscode-foreground));background:color-mix(in oklab,var(--color-text,var(--vscode-foreground)) 5%,transparent)}.ticket-use:hover:enabled{background:color-mix(in oklab,var(--color-text,var(--vscode-foreground)) 10%,transparent)}.ticket-use.confirming{border-color:var(--color-border,var(--vscode-panel-border));background:var(--color-background-primary-solid,var(--vscode-foreground));color:var(--color-text-primary-solid,var(--vscode-editor-background))}.ticket-use.confirming:hover:enabled{background:color-mix(in oklab,var(--color-text,var(--vscode-foreground)) 80%,transparent)}.ticket-use:disabled{opacity:.4;cursor:default}.ticket-use:focus-visible{outline:2px solid var(--color-ring,var(--vscode-focusBorder));outline-offset:0}.ticket-empty{font-size:13px;color:var(--color-text-secondary,var(--vscode-descriptionForeground));margin:0;padding:12px 16px}.ticket-spinner{width:12px;height:12px;border:1.5px solid currentColor;border-right-color:transparent;border-radius:50%;animation:ticket-spin .8s linear infinite}@keyframes ticket-spin{to{transform:rotate(360deg)}}`;

export const usageStyles = resetTicketStyles + `
:root,:host{color-scheme:light dark}[data-azrael-dynamic-text]{font-family:Consolas,"Azrael Gyeonggi Title","Malgun Gothic","Segoe UI Emoji",monospace!important;font-weight:400!important;font-synthesis-weight:none;word-spacing:-0.5ch!important}*{box-sizing:border-box}body,:host{margin:0;background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);font-size:13px;line-height:1.5}main{max-width:880px;margin:0 auto;padding:36px 28px 60px}header{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:32px}h1{font-size:24px;font-weight:600;letter-spacing:-.5px;margin:0}h2{font-size:15px;font-weight:600;margin:0}h3{font-size:13px;font-weight:500;margin:0 0 12px}.subtitle{margin:6px 0 0}.muted{color:var(--vscode-descriptionForeground)}.provider{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:12px;font-weight:600;letter-spacing:.04em;margin:28px 0 12px}.card{border:1px solid var(--vscode-widget-border,var(--vscode-panel-border));border-radius:16px;padding:22px 24px;margin-bottom:14px;background:var(--vscode-editor-background)}.identity{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:24px}.identity p{margin:4px 0 0;font-size:12px}.badges{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}.badge{font-size:11px;border:1px solid var(--vscode-panel-border);border-radius:20px;padding:3px 9px;white-space:nowrap}.badge.disconnected{color:var(--vscode-editorWarning-foreground)}.quota{margin:18px 0}.quota-heading,.provider-quota-row{display:flex;justify-content:space-between;gap:16px}.quota-heading strong,.provider-quota-row strong{font-weight:500}.provider-quota-row{border-top:1px solid var(--vscode-panel-border);padding:12px 0}.provider-quota-value{display:flex;flex-direction:column;text-align:right}.track{height:7px;border-radius:8px;overflow:hidden;background:var(--vscode-button-secondaryBackground,rgba(128,128,128,.18));margin-top:10px}.fill{height:100%;border-radius:8px;background:var(--vscode-foreground)}.fill.low{background:var(--vscode-editorWarning-foreground)}.reset{font-size:11px;margin:8px 0 0}.updated{font-size:11px;margin:18px 0 0}.error{color:var(--vscode-errorForeground);font-size:12px}.notice{border-left:2px solid var(--vscode-editorWarning-foreground);padding:8px 12px}.card-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:18px}button{font:inherit;color:var(--vscode-foreground);background:transparent;border:1px solid var(--vscode-button-border,var(--vscode-panel-border));border-radius:8px;padding:7px 12px;cursor:pointer}button:hover{background:var(--vscode-toolbar-hoverBackground)}button:focus-visible,summary:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:3px}button:disabled{opacity:.5;cursor:default}.text-button{border:0;padding:8px 0;color:var(--vscode-textLink-foreground)}.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}details{font-size:12px;margin-top:12px}summary{cursor:pointer}.limit+.limit{border-top:1px solid var(--vscode-panel-border);margin-top:20px;padding-top:18px}.account-card{padding:12px 16px}.account-card.expanded{padding:18px 20px}.account-card .identity{margin-bottom:0}.account-card.expanded .identity{margin-bottom:18px}.account-heading{display:flex;align-items:center;gap:8px;min-width:0;flex:1}.account-name{min-width:0}.collapsed .account-name{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.account-provider{font-size:11px}.account-name h2{overflow-wrap:anywhere}.identity-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.usage-toggle{display:inline-flex;align-items:center;justify-content:center;flex:0 0 24px;width:24px;height:24px;border:0;padding:0;font-size:16px}.auto-switch{display:inline-flex;align-items:center;gap:5px;font-size:11px;white-space:nowrap}.auto-switch input:focus-visible{outline:1px solid var(--vscode-focusBorder)}.account-switch{padding:3px 8px;font-size:11px}.account-card.collapsed .card-actions{margin-top:8px}@media(max-width:520px){main{padding:24px 16px}.card{padding:18px}.account-card{padding:10px 12px}.account-card.expanded{padding:16px}header,.identity{align-items:flex-start;flex-wrap:wrap}.account-heading{flex:1 1 100%}.identity-actions{width:100%;justify-content:flex-start}.actions,.card-actions{width:100%}.actions button,.card-actions button{flex:1 1 auto}.card-actions:has(>button[data-action^="autoWindow"]){display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:stretch}.card-actions:has(>button[data-action^="autoWindow"])>button{min-width:0;padding:7px 8px;white-space:normal}.provider-quota-row{flex-direction:column;gap:4px}.provider-quota-value{text-align:left}}`;

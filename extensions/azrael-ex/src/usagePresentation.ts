import { AccountUsage, RateLimitSnapshot, RateLimitWindow } from "./protocol";
import { ManagedProvider, ProviderAccount, ProviderAccountQuota, ProviderQuotaRow } from "./providerAccountProtocol";

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
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
  const valid = Number.isFinite(window.usedPercent) && window.usedPercent >= 0 && window.usedPercent <= 100;
  const remaining = valid ? Math.round((100 - window.usedPercent) * 10) / 10 : null;
  return `<div class="quota"><div class="quota-heading"><span>${escapeHtml(label)}</span><strong>${remaining === null ? "조회 불가" : `${remaining}% 남음`}</strong></div>${remaining === null ? "" : `<div class="track" role="progressbar" aria-label="${escapeHtml(label)} 잔여량" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${remaining}"><div class="fill${remaining <= 10 ? " low" : ""}" style="width:${remaining}%"></div></div>`}<p class="muted reset">${escapeHtml(resetText(window.resetsAt))}</p></div>`;
}

export function openAIUsageHtml(usage: AccountUsage | null, profileId: string): string {
  if (!usage) return '<p class="muted">사용량을 아직 가져오지 못했습니다.</p>';
  const limits = visibleLimits(usage);
  const quotas = limits.map(limit => `<div class="limit">${limits.length > 1 ? `<h3>${escapeHtml(limit.limitName ?? limit.limitId ?? "Codex")}</h3>` : ""}${quotaHtml(limit.primary, "기본 한도")}${quotaHtml(limit.secondary, "추가 한도")}${!limit.primary && !limit.secondary ? '<p class="muted">한도 정보 미제공</p>' : ""}</div>`).join("");
  const tickets = usage.rateLimitResetCredits;
  const details = tickets?.credits;
  return `${quotas || '<p class="muted">표시할 Codex 사용량이 없습니다.</p>'}<div class="ticket-row"><span>리셋 티켓</span><strong>${tickets ? `${tickets.availableCount}개` : "정보 미제공"}</strong></div>${tickets && tickets.availableCount > 0 && details === null ? `<button class="text-button" data-action="details" data-profile="${escapeHtml(profileId)}">티켓 상세 보기</button>` : ""}${details?.length ? `<details><summary>티켓 상세</summary>${details.map(credit => `<p>${escapeHtml(credit.title ?? "리셋 티켓")} <span class="muted">${escapeHtml(credit.status)} · ${credit.expiresAt === null ? "만료일 없음" : escapeHtml(new Date(credit.expiresAt * 1000).toLocaleString())}</span></p>`).join("")}</details>` : ""}`;
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
  const reset = row.resetsAt === undefined ? "" : `<span class="muted">리셋 ${escapeHtml(providerTime(row.resetsAt))}</span>`;
  return `<div class="provider-quota-row"><span>${escapeHtml(row.label)}</span><span class="provider-quota-value"><strong>${escapeHtml(value)}</strong>${reset}</span></div>`;
}

export function providerQuotaHtml(quota: ProviderAccountQuota | undefined, latestError?: ProviderAccountQuota): string {
  if (!quota) return '<p class="muted">계정별 한도를 불러오는 중…</p>';
  const observation = `<p class="muted updated">${latestError ? "이전 조회 값 · " : ""}출처 ${escapeHtml(quota.source)} · 관측 ${escapeHtml(providerTime(quota.observedAt))}</p>`;
  if (quota.status === "unsupported") return `<p class="muted">이 계정은 계정별 한도 조회를 지원하지 않습니다.</p>${observation}`;
  if (quota.status === "error") return `<p class="error">한도 조회 실패${quota.error ? ` · ${escapeHtml(quota.error)}` : ""}</p>${observation}`;
  const failure = latestError ? `<p class="error">최신 한도 조회 실패${latestError.error ? ` · ${escapeHtml(latestError.error)}` : ""}</p><p class="muted updated">실패 출처 ${escapeHtml(latestError.source)} · 관측 ${escapeHtml(providerTime(latestError.observedAt))}</p>` : "";
  return `${quota.rows.length ? quota.rows.map(providerQuotaRowHtml).join("") : '<p class="muted">제공된 한도 항목이 없습니다.</p>'}${observation}${failure}`;
}

export function providerAccountHtml(provider: ManagedProvider, account: ProviderAccount, quota: ProviderAccountQuota | undefined, latestError?: ProviderAccountQuota, expanded = false): string {
  if (provider.authKind !== "oauth") return "";
  const chat = provider.inferenceConnected ? "채팅 연결 설정됨" : "채팅 미연결";
  const defaultLabel = provider.inferenceConnected ? "새 채팅 기본 계정" : "기본 계정";
  const authAction = `<button data-action="providerReauth" data-provider="${escapeHtml(provider.id)}" data-account="${escapeHtml(account.id)}">${account.needsReauth ? "다시 인증" : "재인증"}</button>`;
  const switchAction = account.selected ? "" : `<button class="account-switch" data-action="providerSelect" data-provider="${escapeHtml(provider.id)}" data-account="${escapeHtml(account.id)}">${defaultLabel}으로 선택</button>`;
  return `<section class="card account-card provider-account${expanded ? " expanded" : " collapsed"}"><div class="identity"><div class="account-heading">${usageToggleHtml(expanded, `data-provider="${escapeHtml(provider.id)}" data-account="${escapeHtml(account.id)}"`)}<div class="account-name"><h2>${escapeHtml(account.label)}</h2>${expanded ? `<p class="muted">${escapeHtml(provider.label)} · ${escapeHtml(account.id)}</p>` : `<span class="muted account-provider">${escapeHtml(provider.label)}</span>`}</div></div><div class="identity-actions"><div class="badges">${account.selected ? `<span class="badge">${defaultLabel}</span>` : ""}<span class="badge${provider.inferenceConnected ? "" : " disconnected"}">${chat}</span></div>${switchAction}</div></div>${expanded ? `<div class="usage-details">${providerQuotaHtml(quota, latestError)}</div><div class="card-actions">${authAction}<button data-action="providerRemove" data-provider="${escapeHtml(provider.id)}" data-account="${escapeHtml(account.id)}">제거</button></div>` : ""}</section>`;
}

export const usageStyles = `
:root,:host{color-scheme:light dark}*{box-sizing:border-box}body,:host{margin:0;background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);font-size:13px;line-height:1.5}main{max-width:880px;margin:0 auto;padding:36px 28px 60px}header{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:32px}h1{font-size:24px;font-weight:600;letter-spacing:-.5px;margin:0}h2{font-size:15px;font-weight:600;margin:0}h3{font-size:13px;font-weight:500;margin:0 0 12px}.subtitle{margin:6px 0 0}.muted{color:var(--vscode-descriptionForeground)}.provider{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:12px;font-weight:600;letter-spacing:.04em;margin:28px 0 12px}.card{border:1px solid var(--vscode-widget-border,var(--vscode-panel-border));border-radius:16px;padding:22px 24px;margin-bottom:14px;background:var(--vscode-editor-background)}.identity{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:24px}.identity p{margin:4px 0 0;font-size:12px}.badges{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}.badge{font-size:11px;border:1px solid var(--vscode-panel-border);border-radius:20px;padding:3px 9px;white-space:nowrap}.badge.disconnected{color:var(--vscode-editorWarning-foreground)}.quota{margin:18px 0}.quota-heading,.ticket-row,.provider-quota-row{display:flex;justify-content:space-between;gap:16px}.quota-heading strong,.ticket-row strong,.provider-quota-row strong{font-weight:500}.provider-quota-row{border-top:1px solid var(--vscode-panel-border);padding:12px 0}.provider-quota-value{display:flex;flex-direction:column;text-align:right}.track{height:7px;border-radius:8px;overflow:hidden;background:var(--vscode-button-secondaryBackground,rgba(128,128,128,.18));margin-top:10px}.fill{height:100%;border-radius:8px;background:var(--vscode-foreground)}.fill.low{background:var(--vscode-editorWarning-foreground)}.reset{font-size:11px;margin:8px 0 0}.ticket-row{border-top:1px solid var(--vscode-panel-border);padding-top:16px;margin-top:22px}.updated{font-size:11px;margin:18px 0 0}.error{color:var(--vscode-errorForeground);font-size:12px}.notice{border-left:2px solid var(--vscode-editorWarning-foreground);padding:8px 12px}.card-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:18px}button{font:inherit;color:var(--vscode-foreground);background:transparent;border:1px solid var(--vscode-button-border,var(--vscode-panel-border));border-radius:8px;padding:7px 12px;cursor:pointer}button:hover{background:var(--vscode-toolbar-hoverBackground)}button:focus-visible,summary:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:3px}button:disabled{opacity:.5;cursor:default}.text-button{border:0;padding:8px 0;color:var(--vscode-textLink-foreground)}.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}details{font-size:12px;margin-top:12px}summary{cursor:pointer}.limit+.limit{border-top:1px solid var(--vscode-panel-border);margin-top:20px;padding-top:18px}.account-card{padding:12px 16px}.account-card.expanded{padding:18px 20px}.account-card .identity{margin-bottom:0}.account-card.expanded .identity{margin-bottom:18px}.account-heading{display:flex;align-items:center;gap:8px;min-width:0;flex:1}.account-name{min-width:0}.collapsed .account-name{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.account-provider{font-size:11px}.account-name h2{overflow-wrap:anywhere}.identity-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.usage-toggle{display:inline-flex;align-items:center;justify-content:center;flex:0 0 24px;width:24px;height:24px;border:0;padding:0;font-size:16px}.account-switch{padding:3px 8px;font-size:11px}.account-card.collapsed .card-actions{margin-top:8px}@media(max-width:520px){main{padding:24px 16px}.card{padding:18px}.account-card{padding:10px 12px}.account-card.expanded{padding:16px}header,.identity{align-items:flex-start;flex-wrap:wrap}.actions,.card-actions{width:100%}.actions button,.card-actions button{flex:1 1 auto}.provider-quota-row{flex-direction:column;gap:4px}.provider-quota-value{text-align:left}}`;

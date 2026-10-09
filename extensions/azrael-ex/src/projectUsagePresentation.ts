import { dynamicTextHtml, escapeHtml } from "./usagePresentation";

export interface ProjectUsageSnapshot {
  currency: string;
  days: Array<{ date: string; projects: Array<{ id: string; name: string; amount: number; unpriced: number }> }>;
}

interface Cost { id: string; name: string; amount: number; unpriced: number }
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
function utcDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  return date;
}
function validDate(value: string): boolean {
  const match = datePattern.exec(value);
  if (!match || +match[1] < 1) return false;
  const date = utcDate(+match[1], +match[2] - 1, +match[3]);
  return date.toISOString().slice(0, 10) === value;
}
function merge(target: Map<string, Cost>, value: Cost): void {
  const existing = target.get(value.id);
  if (!existing) { target.set(value.id, { ...value }); return; }
  const sum = existing.amount + value.amount;
  existing.amount = Number.isFinite(sum) ? sum : existing.amount;
  existing.unpriced += value.unpriced + (Number.isFinite(sum) ? 0 : 1);
}
function ranked(values: Iterable<Cost>): Cost[] {
  return [...values].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Pure markup: the owning view handles costMonth buttons through its existing delegation. */
export function projectUsageHtml(snapshot: ProjectUsageSnapshot, month: string, now = new Date()): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || +month.slice(0, 4) < 1) throw new RangeError("Expected month YYYY-MM");
  const year = +month.slice(0, 4);
  const dateParts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const today = ["year", "month", "day"].map(part => dateParts.find(value => value.type === part)!.value).join("-");
  const days = new Map<string, Map<string, Cost>>();
  for (const day of snapshot.days) {
    if (!validDate(day.date) || day.date > today) continue;
    const projects = days.get(day.date) ?? new Map<string, Cost>();
    for (const project of day.projects) {
      const priced = Number.isFinite(project.amount) && project.amount >= 0;
      const unpriced = Number.isSafeInteger(project.unpriced) && project.unpriced >= 0 ? project.unpriced : 1;
      merge(projects, { id: project.id, name: project.name, amount: priced ? project.amount : 0, unpriced: unpriced + (priced ? 0 : 1) });
    }
    days.set(day.date, projects);
  }
  let formatter: Intl.NumberFormat | undefined;
  let smallFormatter: Intl.NumberFormat | undefined;
  try {
    formatter = new Intl.NumberFormat(undefined, { style: "currency", currency: snapshot.currency });
    smallFormatter = new Intl.NumberFormat(undefined, { style: "currency", currency: snapshot.currency, maximumSignificantDigits: 3 });
  } catch { /* Preserve currency identity when Intl does not support the supplied code. */ }
  const minorUnits = formatter?.resolvedOptions().maximumFractionDigits ?? 2;
  const money = (value: number): string => {
    const small = value > 0 && value < 10 ** -minorUnits;
    if (formatter) return (small ? smallFormatter! : formatter).format(value);
    return `${new Intl.NumberFormat(undefined, small ? { maximumSignificantDigits: 3 } : { maximumFractionDigits: 2 }).format(value)} ${snapshot.currency}`;
  };
  const amount = (cost: Cost): string => `${cost.amount === 0 && cost.unpriced > 0 ? "—" : money(cost.amount)}${cost.unpriced ? ` · ?×${cost.unpriced}` : ""}`;
  const total = (values: Iterable<Cost>): Cost => {
    const totals = new Map<string, Cost>();
    for (const value of values) merge(totals, { ...value, id: "total" });
    return totals.get("total") ?? { id: "total", name: "", amount: 0, unpriced: 0 };
  };
  const monthly = new Map<string, Cost>();
  for (const [date, projects] of days) if (date.startsWith(month + "-")) for (const project of projects.values()) merge(monthly, project);
  const projects = ranked(monthly.values());
  const peak = Math.max(0, ...[...days].filter(([date]) => date.startsWith(`${year.toString().padStart(4, "0")}-`)).map(([, values]) => total(values.values()).amount));
  const tooltip = (label: string, values: Cost[], known: boolean, compare = true): string => `<span class="puc-tooltip" role="tooltip"><strong>${dynamicTextHtml(label)}</strong><span class="puc-tip-total">${dynamicTextHtml(known ? amount(total(values)) : "—")}</span>${compare ? values.map(value => `<span class="puc-tip-row">${dynamicTextHtml(value.name)}${dynamicTextHtml(amount(value))}</span>`).join("") : ""}</span>`;
  const nav = (offset: number): string => {
    const date = utcDate(year, +month.slice(5) - 1 + offset, 1);
    const allowed = date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999;
    return `<button class="puc-nav" data-action="costMonth" data-month="${allowed ? date.toISOString().slice(0, 7) : month}" aria-label="${offset < 0 ? "이전 달" : "다음 달"}"${allowed ? "" : " disabled"}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="${offset < 0 ? "m10 3-5 5 5 5" : "m6 3 5 5-5 5"}"/></svg></button>`;
  };
  const cells: string[] = [];
  const start = utcDate(year, 0, 1);
  for (let index = 0; index < start.getUTCDay(); index++) cells.push('<span class="puc-gap" aria-hidden="true"></span>');
  for (let date = start; date.getUTCFullYear() === year; date = utcDate(year, date.getUTCMonth(), date.getUTCDate() + 1)) {
    const key = date.toISOString().slice(0, 10);
    if (key > today) { cells.push('<span class="puc-gap" aria-hidden="true"></span>'); continue; }
    const values = days.get(key);
    const costs = ranked(values?.values() ?? []);
    const cost = total(costs);
    const level = cost.amount > 0 && peak > 0 ? Math.max(1, Math.ceil(cost.amount / peak * 4)) : 0;
    cells.push(`<button class="puc-cell puc-level-${level}${values ? "" : " puc-missing"}${cost.unpriced ? " puc-incomplete" : ""}" data-date="${key}" data-action="costMonth" data-month="${key.slice(0, 7)}" aria-label="${escapeHtml(`${key} · ${values ? amount(cost) : "—"}`)}" aria-pressed="${key.startsWith(month + "-")}">${tooltip(key, costs, !!values)}</button>`);
  }
  const maximum = projects[0]?.amount ?? 0;
  const bars = projects.map(project => {
    const ratio = maximum > 0 ? project.amount / maximum * 100 : 0;
    return `<div class="puc-project" tabindex="0" aria-label="${escapeHtml(`${project.name} · ${amount(project)}`)}"><span class="puc-project-name">${dynamicTextHtml(project.name)}</span><span class="puc-bar-track"><span class="puc-bar${project.unpriced ? " puc-incomplete" : ""}" style="width:${ratio}%" data-ratio="${ratio}"></span></span>${tooltip(project.name, [project], true, false)}</div>`;
  }).join("");
  return `<section class="project-usage" aria-label="프로젝트 사용량"><div class="puc-heading"><div class="puc-month">${nav(-1)}<span>${dynamicTextHtml(month.replace("-", "."))}</span>${nav(1)}</div><span class="puc-total">${dynamicTextHtml(projects.length ? amount(total(projects)) : "—")}</span></div><div class="puc-calendar-scroll"><div class="puc-calendar" aria-label="${year}">${cells.join("")}</div></div><div class="puc-projects">${bars || '<p class="puc-empty" aria-label="사용량 데이터 없음">—</p>'}</div></section>`;
}

export const projectUsageStyles = `
.project-usage{position:relative;min-width:0;max-width:100%;margin-top:28px;color:var(--usage-ink);font-size:var(--text-sm,13px)}
.project-usage .puc-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}.project-usage .puc-month{display:flex;align-items:center;gap:10px;font-variant-numeric:tabular-nums}.project-usage .puc-total{color:var(--usage-secondary);font-size:12px}
.project-usage .puc-nav{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:var(--radius-button-toolbar,8px);background:transparent;color:var(--usage-secondary)}.project-usage .puc-nav:hover{background:var(--usage-soft);color:var(--usage-ink)}.project-usage .puc-nav svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.5}
.project-usage .puc-calendar-scroll{max-width:100%;overflow-x:auto;padding:3px 3px 8px;box-sizing:border-box}.project-usage .puc-calendar{display:grid;grid-template-rows:repeat(7,11px);grid-auto-flow:column;grid-auto-columns:11px;gap:3px;width:max-content}
.project-usage .puc-cell,.project-usage .puc-gap{width:11px;height:11px;padding:0;border:0;border-radius:2px;box-sizing:border-box}.project-usage .puc-cell{background:var(--usage-track)}.project-usage .puc-missing{background:var(--usage-soft);box-shadow:inset 0 0 0 1px var(--usage-border)}.project-usage .puc-level-1{background:color-mix(in oklab,var(--usage-primary) 25%,var(--usage-panel))}.project-usage .puc-level-2{background:color-mix(in oklab,var(--usage-primary) 45%,var(--usage-panel))}.project-usage .puc-level-3{background:color-mix(in oklab,var(--usage-primary) 70%,var(--usage-panel))}.project-usage .puc-level-4{background:var(--usage-primary)}.project-usage .puc-incomplete{box-shadow:inset 0 0 0 1px var(--usage-warning)}
.project-usage .puc-cell:hover,.project-usage .puc-cell:focus-visible,.project-usage .puc-project:focus-visible{outline:2px solid var(--color-ring,var(--vscode-focusBorder,#3086e9));outline-offset:1px}
.project-usage .puc-tooltip{display:none;position:absolute;z-index:5;left:0;top:154px;width:min(320px,100%);box-sizing:border-box;padding:12px;border:1px solid var(--usage-border);border-radius:var(--radius-lg,10px);background:var(--usage-panel);color:var(--usage-ink);font-size:12px;font-weight:400;text-align:left;line-height:1.5;box-shadow:0 4px 16px color-mix(in oklab,var(--usage-ink) 12%,transparent);overflow-wrap:anywhere;pointer-events:none}.project-usage .puc-tooltip strong{font-weight:500}.project-usage .puc-tip-total{display:block;color:var(--usage-secondary);margin-bottom:6px}.project-usage .puc-tip-row{display:flex;justify-content:space-between;gap:16px}.project-usage .puc-tip-row>span:first-child{min-width:0}.project-usage .puc-tip-row>span:last-child{flex-shrink:0}
.project-usage .puc-cell:hover>.puc-tooltip,.project-usage .puc-project:hover>.puc-tooltip,.project-usage:not(:has(.puc-cell:hover,.puc-project:hover)) .puc-cell:focus-visible>.puc-tooltip,.project-usage:not(:has(.puc-cell:hover,.puc-project:hover)) .puc-project:focus-visible>.puc-tooltip{display:block}
.project-usage .puc-projects{display:flex;flex-direction:column;gap:12px;margin-top:20px}.project-usage .puc-project{position:relative;display:grid;grid-template-columns:minmax(0,140px) minmax(0,1fr);align-items:center;gap:16px;border-radius:4px;min-width:0}.project-usage .puc-project-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.project-usage .puc-bar-track{display:block;height:8px;border-radius:4px;background:var(--usage-soft);min-width:0}.project-usage .puc-bar{display:block;height:100%;border-radius:4px;background:var(--usage-primary)}.project-usage .puc-project>.puc-tooltip{top:auto;bottom:calc(100% + 8px)}.project-usage .puc-empty{margin:0;color:var(--usage-secondary)}
@media(max-width:480px){.project-usage .puc-project{grid-template-columns:minmax(0,100px) minmax(0,1fr);gap:12px}}
`;

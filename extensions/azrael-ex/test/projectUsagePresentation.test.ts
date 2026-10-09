import assert from "node:assert/strict";
import test from "node:test";
import { ProjectUsageSnapshot, projectUsageHtml, projectUsageStyles } from "../src/projectUsagePresentation";

const snapshot = (days: ProjectUsageSnapshot["days"] = []): ProjectUsageSnapshot => ({ currency: "USD", days });
const project = (id: string, amount: number, unpriced = 0, name = id) => ({ id, name, amount, unpriced });
const usd = (amount: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(amount);

test("Sunday-first annual calendar aligns weekdays and includes leap day", () => {
  const html = projectUsageHtml(snapshot(), "2024-02");
  const calendar = html.split('class="puc-calendar"')[1].split('class="puc-projects"')[0];
  assert.equal((calendar.match(/class="puc-gap"/g) ?? []).length, 1); // Jan 1 2024 Monday.
  assert.equal((calendar.match(/data-date=/g) ?? []).length, 366);
  assert.match(calendar, /data-date="2024-02-29" data-action="costMonth" data-month="2024-02"/);
  assert.match(projectUsageStyles, /grid-template-rows:repeat\(7,11px\).*grid-auto-flow:column/);
  const sunday = projectUsageHtml(snapshot(), "2023-01").split('class="puc-calendar"')[1];
  assert.ok(sunday.indexOf('data-date="2023-01-01"') < sunday.indexOf('class="puc-gap"') || !sunday.includes('class="puc-gap"'));
});

test("duplicate daily records aggregate by project; monthly descending bars scale to largest", () => {
  const html = projectUsageHtml(snapshot([
    { date: "2024-02-01", projects: [project("a", 2), project("b", 5)] },
    { date: "2024-02-01", projects: [project("a", 3)] },
    { date: "2024-02-02", projects: [project("a", 5)] },
    { date: "2024-03-01", projects: [project("c", 100)] },
  ]), "2024-02");
  assert.ok(html.includes(`aria-label="2024-02-01 · ${usd(10)}"`));
  const bars = html.split('class="puc-projects"')[1];
  assert.ok(bars.indexOf(`aria-label="a · ${usd(10)}"`) < bars.indexOf(`aria-label="b · ${usd(5)}"`));
  assert.match(bars, /width:100%" data-ratio="100"/);
  assert.match(bars, /width:50%" data-ratio="50"/);
  assert.doesNotMatch(bars, /aria-label="c/);
});

test("malicious project names, identifiers and unsupported currency remain escaped text", () => {
  const data = snapshot([{ date: "2024-01-01", projects: [project('" onclick="evil', 1, 0, '<img src=x onerror="evil">&')] }]);
  data.currency = '<script>evil</script>';
  const html = projectUsageHtml(data, "2024-01");
  assert.doesNotMatch(html, /<img|<script|onclick=/);
  assert.match(html, /&lt;img src=x onerror=&quot;evil&quot;&gt;&amp;/);
  assert.match(html, /&lt;script&gt;evil&lt;\/script&gt;/);
});

test("unpriced and malformed costs stay incomplete without claiming a priced zero", () => {
  const html = projectUsageHtml(snapshot([
    { date: "2024-01-01", projects: [project("unknown", Number.NaN, 2), project("negative", -2)] },
    { date: "2024-01-02", projects: [project("partial", 4, 1)] },
    { date: "2024-01-03", projects: [project("infinite", Infinity), project("count", 0, -1)] },
  ]), "2024-01");
  assert.match(html, /aria-label="unknown · — · \?×3"/);
  assert.match(html, /aria-label="negative · — · \?×1"/);
  assert.ok(html.includes(`aria-label="partial · ${usd(4)} · ?×1"`));
  assert.match(html, /aria-label="infinite · — · \?×1"/);
  assert.match(html, /aria-label="count · — · \?×1"/);
  assert.doesNotMatch(html, /NaN|Infinity|width:-/);
  assert.match(html, /puc-incomplete/);
});

test("invalid and future dates are ignored; missing days and empty month show unknown", () => {
  const html = projectUsageHtml(snapshot([
    { date: "2024-02-30", projects: [project("bad", 20)] },
    { date: "2024-2-01", projects: [project("bad", 20)] },
    { date: "9999-01-01", projects: [project("future", 20)] },
  ]), "2024-02");
  assert.match(html, /puc-empty" aria-label="사용량 데이터 없음">—/);
  assert.match(html, /aria-label="2024-02-01 · —"/);
  assert.doesNotMatch(html, /\$0\.00|bad|future/);
  const complete = projectUsageHtml(snapshot([{ date: "2024-02-01", projects: [] }]), "2024-02");
  assert.ok(complete.includes(`aria-label="2024-02-01 · ${usd(0)}"`));
});

test("navigation follows costMonth contract across year boundaries with accessible icon labels", () => {
  const html = projectUsageHtml(snapshot(), "2024-01");
  assert.match(html, /data-action="costMonth" data-month="2023-12" aria-label="이전 달"/);
  assert.match(html, /data-action="costMonth" data-month="2024-02" aria-label="다음 달"/);
  assert.match(html, />2024\.01<\/span>/);
  assert.match(html, /data-date="2024-02-01" data-action="costMonth" data-month="2024-02"/);
  for (const value of ["2024-13", "2024-1", "0000-01", '<img src=x>']) assert.throws(() => projectUsageHtml(snapshot(), value), RangeError);
  assert.match(projectUsageHtml(snapshot(), "0001-01"), /aria-label="이전 달" disabled/);
});

test("tooltips respond to hover and keyboard focus with scoped theme styles and contained scrolling", () => {
  const html = projectUsageHtml(snapshot([{ date: "2024-01-01", projects: [project("one", 1)] }]), "2024-01");
  assert.match(html, /class="puc-project" tabindex="0"/);
  assert.match(html, /role="tooltip"/);
  assert.match(projectUsageStyles, /\.puc-cell:focus-visible>\.puc-tooltip/);
  assert.match(projectUsageStyles, /\.puc-project:focus-visible>\.puc-tooltip/);
  assert.match(projectUsageStyles, /overflow-x:auto/);
  assert.match(projectUsageStyles, /var\(--usage-panel\)/);
  assert.doesNotMatch(html, /<script|onmouseover=|onfocus=/);
});

test("Korean calendar day is available after local midnight with deterministic now", () => {
  const data = snapshot([{ date: "2026-10-09", projects: [project("today", 1)] }]);
  const before = projectUsageHtml(data, "2026-10", new Date("2026-10-08T14:59:59Z"));
  assert.ok(!before.includes('data-date="2026-10-09"'));
  const after = projectUsageHtml(data, "2026-10", new Date("2026-10-08T15:00:00Z"));
  assert.ok(after.includes(`aria-label="2026-10-09 · ${usd(1)}"`));
  assert.ok(!after.includes('data-date="2026-10-10"'));
});

test("small nonzero costs retain adaptive precision and currency minor units", () => {
  for (const [currency, value] of [["USD", 0.0001], ["JPY", 0.01], ["KWD", 0.001]] as const) {
    const data = snapshot([{ date: "2024-01-01", projects: [project("small", value)] }]);
    data.currency = currency;
    const normal = new Intl.NumberFormat(undefined, { style: "currency", currency });
    const expected = value < 10 ** -(normal.resolvedOptions().maximumFractionDigits ?? 2)
      ? new Intl.NumberFormat(undefined, { style: "currency", currency, maximumSignificantDigits: 3 }).format(value)
      : normal.format(value);
    const html = projectUsageHtml(data, "2024-01");
    assert.ok(html.includes(`aria-label="small · ${expected}"`), `${currency} preserves ${value}`);
    assert.ok(!html.includes(`aria-label="small · ${normal.format(0)}"`));
  }
});

test("bar tooltip shows project and amount once; mouse hover suppresses other focused tooltips", () => {
  const html = projectUsageHtml(snapshot([{ date: "2024-01-01", projects: [project("unique", 7)] }]), "2024-01");
  const bar = html.split('class="puc-projects"')[1];
  const tip = bar.split('role="tooltip">')[1];
  assert.equal((tip.match(/>unique<\/span>/g) ?? []).length, 1);
  assert.equal(tip.split(usd(7)).length - 1, 1);
  assert.ok(!tip.includes("puc-tip-row"));
  assert.ok(projectUsageStyles.includes(".project-usage:not(:has(.puc-cell:hover,.puc-project:hover)) .puc-cell:focus-visible>.puc-tooltip"));
  assert.ok(projectUsageStyles.includes(".project-usage:not(:has(.puc-cell:hover,.puc-project:hover)) .puc-project:focus-visible>.puc-tooltip"));
});

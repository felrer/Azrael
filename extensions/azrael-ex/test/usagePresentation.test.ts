import assert from "node:assert/strict";
import test from "node:test";
import { AccountUsage, RateLimitSnapshot, RateLimitWindow } from "../src/protocol";
import { escapeHtml, openAIUsageHtml, quotaHtml, resetText, visibleLimits, usageExpansionKey, usageToggleHtml } from "../src/usagePresentation";

function window(usedPercent: number, windowDurationMins: number | null = 300, resetsAt: number | null = null): RateLimitWindow {
  return { usedPercent, windowDurationMins, resetsAt };
}

function limit(overrides: Partial<RateLimitSnapshot> = {}): RateLimitSnapshot {
  return {
    limitId: "codex",
    limitName: "Codex",
    normalModelSlug: "gpt-6-astra",
    primary: window(25),
    secondary: null,
    credits: null,
    individualLimit: null,
    spendControlReached: null,
    planType: null,
    rateLimitReachedType: null,
    ...overrides,
  };
}

function usage(rateLimitsByLimitId: Record<string, RateLimitSnapshot> | null, fallback = limit()): AccountUsage {
  return {
    ordinaryUsageAllowed: null,
    rateLimits: fallback,
    rateLimitsByLimitId,
    rateLimitResetCredits: null,
    accountId: null,
    rateLimitUpsell: null,
  };
}

test("Spark limits are filtered by map key, limit ID, name, and model slug", () => {
  const ordinary = limit({ limitId: "ordinary", limitName: "Astra", normalModelSlug: "gpt-6-astra" });
  const limits = visibleLimits(usage({
    ordinary,
    "spark-map-key": limit({ limitId: "key-only", limitName: "Key only", normalModelSlug: "model" }),
    id: limit({ limitId: "SPARK-limit", limitName: "ID", normalModelSlug: "model" }),
    name: limit({ limitId: "name", limitName: "Codex Spark", normalModelSlug: "model" }),
    slug: limit({ limitId: "slug", limitName: "Slug", normalModelSlug: "gpt-5.3-codex-spark" }),
  }));
  assert.deepEqual(limits, [ordinary]);
});

test("remaining percentage distinguishes zero from unavailable", () => {
  const exhausted = quotaHtml(window(100), "기본 한도");
  assert.match(exhausted, />0% 남음</);
  assert.match(exhausted, /aria-valuenow="0"/);
  const unknown = quotaHtml(window(Number.NaN), "기본 한도");
  assert.match(unknown, /조회 불가/);
  assert.doesNotMatch(unknown, /role="progressbar"/);
  assert.match(quotaHtml(window(12.34), "기본 한도"), />87\.7% 남음</);
});

test("reset copy handles missing, passed, minute, hour, and day windows", () => {
  const now = Date.UTC(2026, 8, 13, 0, 0, 0);
  assert.equal(resetText(null, now), "리셋 시간 미제공");
  assert.match(resetText(now / 1000 - 1, now), /^리셋 시간 경과 · 갱신 대기 · /);
  assert.match(resetText(now / 1000 + 30 * 60, now), /^30분 후 리셋 · /);
  assert.match(resetText(now / 1000 + 90 * 60, now), /^1시간 30분 후 리셋 · /);
  assert.match(resetText(now / 1000 + 26 * 60 * 60, now), /^1일 2시간 후 리셋 · /);
});

test("usage HTML escapes backend content and preserves a real zero ticket count", () => {
  const malicious = limit({
    limitId: "codex",
    limitName: '<script data-x="limit">bad</script>',
    primary: window(0),
  });
  const data = usage({ codex: malicious, other: limit({ limitId: "other", limitName: "Other" }) }, malicious);
  data.rateLimitResetCredits = {
    availableCount: 0,
    credits: [{
      id: "ticket",
      resetType: "codex_rate_limits",
      status: '<img src=x onerror="bad">',
      grantedAt: 0,
      expiresAt: null,
      title: "A&B's <ticket>",
      description: null,
    }],
  };
  const html = openAIUsageHtml(data, 'profile"><script>bad</script>');
  assert.doesNotMatch(html, /<script|<img/);
  assert.match(html, /0개/);
  assert.match(html, /&lt;script data-x=&quot;limit&quot;&gt;bad&lt;\/script&gt;/);
  assert.match(html, /A&amp;B&#39;s &lt;ticket&gt;/);
  assert.equal(escapeHtml('&<>"\''), "&amp;&lt;&gt;&quot;&#39;");
});


test("usage identity keys separate provider namespaces, workspaces and delimiter characters", () => {
  assert.notEqual(usageExpansionKey("openai", "a", "w"), usageExpansionKey("provider", "a", "w"));
  assert.notEqual(usageExpansionKey("openai", "a", "w1"), usageExpansionKey("openai", "a", "w2"));
  assert.notEqual(usageExpansionKey("provider", "a\u0000b", "c"), usageExpansionKey("provider", "a", "b\u0000c"));
  assert.match(usageToggleHtml(false, 'data-profile="safe"'), /aria-expanded="false".*사용량 펼치기/);
  assert.match(usageToggleHtml(true, 'data-profile="safe"'), /aria-expanded="true".*사용량 접기/);
});

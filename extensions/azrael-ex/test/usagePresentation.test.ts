import assert from "node:assert/strict";
import test from "node:test";
import { AccountUsage, RateLimitSnapshot, RateLimitWindow } from "../src/protocol";
import { ProviderAccountQuota } from "../src/providerAccountProtocol";
import { escapeHtml, openAIPlanLabel, openAIUsageHtml, providerQuotaHtml, quotaHtml, resetText, visibleLimits, usageExpansionKey, usageToggleHtml, usageStyles } from "../src/usagePresentation";

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

function providerQuota(overrides: Partial<ProviderAccountQuota> = {}): ProviderAccountQuota {
  return {
    providerId: "anthropic",
    accountId: "account-a",
    status: "ok",
    source: "account probe",
    observedAt: 1_900_000_000_000,
    rows: [{ label: "Fable", usedPercent: 25, resetsAt: 1_900_100_000 }],
    ...overrides,
  };
}

test("ticket details and consumption share a wrapping row with 16px spacing", () => {
  const data = usage(null);
  data.rateLimitResetCredits = { availableCount: 2, credits: null };
  const action = '<button data-action="consumeResetCredit">리셋 티켓 사용</button>';
  const html = openAIUsageHtml(data, "profile", action);
  assert.match(html, /리셋 티켓<\/span><strong data-azrael-dynamic-text>2개<\/strong>/);
  assert.match(html, /<div class="ticket-actions"><button[^>]*data-action="details"[^>]*>티켓 상세 보기<\/button><button data-action="consumeResetCredit">리셋 티켓 사용<\/button><\/div>/);
  assert.match(usageStyles, /\.ticket-actions\{[^}]*display:flex;[^}]*flex-wrap:wrap;gap:16px/);
  assert.match(openAIUsageHtml(null, "profile", action), /<div class="ticket-actions"><button data-action="consumeResetCredit"/);
});

test("Anthropic Fable shows remaining usage, accessible bars and reset time", () => {
  for (const [usedPercent, remaining] of [[0, 100], [25, 75], [100, 0]]) {
    const html = providerQuotaHtml(providerQuota({ rows: [{ label: "Fable", usedPercent, resetsAt: 1_900_100_000 }] }));
    assert.match(html, />Fable 주간 한도</);
    assert.ok(html.includes(`>${remaining}% 남음<`));
    assert.ok(html.includes(`role="progressbar" aria-label="Fable 주간 한도 잔여량" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${remaining}"`));
    assert.ok(html.includes(`style="width:${remaining}%"`));
    assert.equal(html.includes('class="fill low"'), remaining === 0);
    assert.ok(html.includes(escapeHtml(resetText(1_900_100_000))));
    assert.doesNotMatch(html, /provider-quota-row|% 사용/);
  }
});

test("Fable missing or invalid percent stays unavailable without a bar", () => {
  for (const usedPercent of [undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, 101]) {
    const html = providerQuotaHtml(providerQuota({ rows: [{ label: "Fable", usedPercent }] }));
    assert.match(html, />Fable 주간 한도</);
    assert.match(html, /조회 불가/);
    assert.match(html, /리셋 시간 미제공/);
    assert.doesNotMatch(html, /role="progressbar"|class="fill|% 남음/);
  }
});

test("missing Fable does not fabricate a quota and other provider rows stay generic", () => {
  for (const rows of [[], [{ label: "Weekly", usedPercent: 25 }]]) {
    const html = providerQuotaHtml(providerQuota({ rows }));
    assert.doesNotMatch(html, /Fable|role="progressbar"/);
    if (rows.length) assert.match(html, /provider-quota-row.*Weekly.*25% 사용/);
    else assert.match(html, /제공된 한도 항목이 없습니다/);
  }
  const html = providerQuotaHtml(providerQuota({ providerId: "openrouter" }));
  assert.match(html, /provider-quota-row.*Fable.*25% 사용/);
  assert.doesNotMatch(html, /Fable 주간 한도|role="progressbar"/);
});

test("Fable preserves the prior quota with latest failure and error observations", () => {
  const previous = providerQuota();
  const failure = providerQuota({ status: "error", source: "latest <probe>", observedAt: 1_900_200_000_000, rows: [], error: "denied <access>" });
  const html = providerQuotaHtml(previous, failure);
  assert.match(html, /Fable 주간 한도/);
  assert.match(html, /aria-valuenow="75"/);
  assert.match(html, /이전 조회 값 · 출처 account probe · 관측/);
  assert.match(html, /최신 한도 조회 실패 · denied &lt;access&gt;/);
  assert.match(html, /실패 출처 latest &lt;probe&gt; · 관측/);
  assert.ok(html.includes(new Date(previous.observedAt).toLocaleString()));
  assert.ok(html.includes(new Date(failure.observedAt).toLocaleString()));
  const errorOnly = providerQuotaHtml(failure);
  assert.match(errorOnly, /한도 조회 실패 · denied &lt;access&gt;/);
  assert.match(errorOnly, /출처 latest &lt;probe&gt; · 관측/);
  assert.doesNotMatch(errorOnly, /Fable|role="progressbar"|이전 조회 값/);
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
  assert.match(usageToggleHtml(false, 'data-profile="safe"'), /aria-expanded="false" aria-label="사용량 펼치기"/);
  assert.match(usageToggleHtml(false, 'data-profile="safe"'), /<span aria-hidden="true">▸<\/span>/);
  assert.match(usageToggleHtml(true, 'data-profile="safe"'), /aria-expanded="true" aria-label="사용량 접기"/);
});


test("OpenAI plan label uses current usage and requires confirmation when absent or inconsistent", () => {
  assert.equal(openAIPlanLabel(usage(null, limit({ planType: "free" }))), "free");
  assert.equal(openAIPlanLabel(undefined), "요금제 확인 필요");
  assert.equal(openAIPlanLabel(usage(null)), "요금제 확인 필요");
  assert.equal(openAIPlanLabel(usage({ a: limit({ planType: "pro" }), b: limit({ planType: "pro" }) })), "pro");
  assert.equal(openAIPlanLabel(usage({ a: limit({ planType: "pro" }), b: limit({ planType: "free" }) })), "요금제 확인 필요");
});

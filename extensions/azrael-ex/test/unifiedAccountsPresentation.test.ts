import assert from "node:assert/strict";
import test from "node:test";
import { ManagedProvider, ProviderAccountQuota } from "../src/providerAccountProtocol";
import { providerAccountHtml, providerQuotaHtml } from "../src/usagePresentation";

const provider: ManagedProvider = {
  id: 'devin"><script>bad</script>',
  label: "Devin managed",
  authKind: "oauth",
  quotaMode: "unsupported",
  inferenceConnected: false,
  accounts: [{ id: 'acct"><img src=x>', label: "A&B", selected: true, needsReauth: true }],
};

test("OpenRouter spend distinguishes unset, zero, and positive caps without claiming unlimited balance", () => {
  const quota: ProviderAccountQuota = { providerId: "openrouter", accountId: "a", status: "ok", source: "key-info", observedAt: 1,
    rows: [{ label: "키별 지출 한도", limitUnset: true, unit: "USD" }, { label: "누적 지출", used: 42, unit: "USD" },
      { label: "일일 지출", used: 0, unit: "USD" }] };
  const html = providerQuotaHtml(quota);
  assert.match(html, /지출 한도 미설정/);
  assert.match(html, /42 USD 사용/);
  assert.match(html, /0 USD 사용/);
  assert.doesNotMatch(html, /무제한|조회 실패/);
  assert.match(providerQuotaHtml({ ...quota, rows: [{ label: "Cap", limit: 0, remaining: 0, unit: "USD" }] }), /0 USD 남음 \/ 0 USD/);
  assert.match(providerQuotaHtml({ ...quota, rows: [{ label: "Cap", limit: 10, remaining: 7, unit: "USD" }] }), /7 USD 남음 \/ 10 USD/);
  const connected = { ...provider, inferenceConnected: true };
  assert.match(providerAccountHtml(connected, connected.accounts[0], quota), /채팅 연결 설정됨/);
});

test("managed provider cards expose safe account actions and explicit chat/default scope", () => {
  const html = providerAccountHtml(provider, provider.accounts[0], undefined, undefined, true);
  assert.doesNotMatch(html, /<script|<img/);
  assert.match(html, /기본 계정/);
  assert.doesNotMatch(html, /새 채팅 기본 계정/);
  assert.match(html, /채팅 미연결/);
  assert.match(html, /data-action="providerReauth"/);
  assert.match(html, /data-action="providerRemove"/);
  assert.doesNotMatch(html, /data-action="providerSelect"/);
  assert.match(html, /devin&quot;&gt;&lt;script&gt;bad&lt;\/script&gt;/);
});

test("API-key account cards are not rendered", () => {
  const apiKeyProvider = {
    id: "gateway", label: "Gateway", authKind: "apiKey", quotaMode: "passive", inferenceConnected: false,
    accounts: [{ id: "key-account", label: "Work key", selected: false, needsReauth: true }],
  } as unknown as ManagedProvider;
  const html = providerAccountHtml(apiKeyProvider, apiKeyProvider.accounts[0], undefined);
  assert.equal(html, "");
});

test("provider quota keeps numeric units and never converts used tokens into remaining quota", () => {
  const quota: ProviderAccountQuota = {
    providerId: "devin",
    accountId: "account",
    status: "ok",
    source: "account probe",
    observedAt: Date.UTC(2026, 8, 16),
    rows: [
      { label: "Window", usedPercent: 37.5 },
      { label: "Credits", remaining: 12, limit: 50, unit: "requests" },
      { label: "Enterprise", unlimited: true, remaining: 0, limit: 0, unit: "requests" },
    ],
  };
  const html = providerQuotaHtml(quota);
  assert.match(html, /37\.5% 사용/);
  assert.doesNotMatch(html, /62\.5% 남음/);
  assert.match(html, /12 requests 남음 \/ 50 requests/);
  assert.match(html, /<span data-azrael-dynamic-text>Enterprise<\/span><\/span><span class="provider-quota-value"><strong>무제한<\/strong>/);
  assert.match(html, /출처 <span data-azrael-dynamic-text>account probe<\/span> · 관측/);
});

test("unsupported and error quota observations retain source and observed time", () => {
  const unsupported = providerQuotaHtml({
    providerId: "devin", accountId: "managed", status: "unsupported", source: "managed account", observedAt: 1_789_516_800_000, rows: [],
  });
  assert.match(unsupported, /계정별 한도 조회를 지원하지 않습니다/);
  assert.match(unsupported, /출처 <span data-azrael-dynamic-text>managed account<\/span>/);

  const failed = providerQuotaHtml({
    providerId: "other", accountId: "a", status: "error", source: "quota API", observedAt: 1_789_516_800_000, rows: [], error: "denied <unsafe>",
  });
  assert.match(failed, /한도 조회 실패/);
  assert.match(failed, /denied &lt;unsafe&gt;/);
  assert.match(failed, /출처 <span data-azrael-dynamic-text>quota API<\/span>/);
});

test("never-observed provider results do not display the Unix epoch", () => {
  const html = providerQuotaHtml({
    providerId: "devin", accountId: "managed", status: "unsupported", source: "managed account", observedAt: 0, rows: [],
  });
  assert.match(html, /관측 기록 없음/);
  assert.doesNotMatch(html, /1970/);
});

test("over-limit usage preserves the actual finite percentage", () => {
  const html = providerQuotaHtml({
    providerId: "gateway", accountId: "a", status: "ok", source: "quota API", observedAt: 1_789_516_800_000,
    rows: [{ label: "Burst", usedPercent: 125 }],
  });
  assert.match(html, /125% 사용/);
  assert.doesNotMatch(html, /100% 사용/);
});

test("a failed refresh labels and preserves the previous successful provider quota", () => {
  const prior: ProviderAccountQuota = {
    providerId: "devin", accountId: "a", status: "ok", source: "cached probe", observedAt: 1_789_516_700_000,
    rows: [{ label: "Requests", remaining: 8, unit: "requests" }],
  };
  const failure: ProviderAccountQuota = {
    providerId: "devin", accountId: "a", status: "error", source: "live probe", observedAt: 1_789_516_800_000,
    rows: [], error: "temporarily unavailable",
  };
  const html = providerQuotaHtml(prior, failure);
  assert.match(html, /8 requests 남음/);
  assert.match(html, /이전 조회 값 · 출처 <span data-azrael-dynamic-text>cached probe<\/span>/);
  assert.match(html, /최신 한도 조회 실패 · <span data-azrael-dynamic-text>temporarily unavailable<\/span>/);
  assert.match(html, /실패 출처 <span data-azrael-dynamic-text>live probe<\/span>/);
});


test("provider usage disclosure keeps collapsed identity compact and shows management when expanded", () => {
  const quota: ProviderAccountQuota = { providerId: provider.id, accountId: provider.accounts[0].id, status: "ok", source: "probe", observedAt: 1, rows: [{ label: "Private quota", remaining: 8 }] };
  const collapsed = providerAccountHtml(provider, provider.accounts[0], quota);
  assert.match(collapsed, /aria-expanded="false"/);
  assert.match(collapsed, /사용량 펼치기/);
  assert.doesNotMatch(collapsed, /Private quota|출처/);
  assert.match(collapsed, /account-heading.*usage-toggle.*<h2><span data-azrael-dynamic-text>A&amp;B<\/span><\/h2>/);
  assert.doesNotMatch(collapsed, /providerReauth|providerRemove|card-actions/);
  const unselected = providerAccountHtml(provider, { ...provider.accounts[0], selected: false }, quota);
  assert.match(unselected, /identity-actions.*data-action="providerSelect"/);
  const expanded = providerAccountHtml(provider, provider.accounts[0], quota, undefined, true);
  assert.match(expanded, /aria-expanded="true"/);
  assert.match(expanded, /aria-label="사용량 접기"/);
  assert.match(expanded, /Private quota/);
  assert.match(expanded, /8 남음/);
  assert.match(expanded, /providerReauth/);
  assert.match(expanded, /providerRemove/);
});

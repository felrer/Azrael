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
  assert.match(providerQuotaHtml({ ...quota, rows: [{ label: "Cap", limit: 10, remaining: 7, unit: "USD" }] }), /70% 남음/);
  const connected = { ...provider, inferenceConnected: true };
  assert.match(providerAccountHtml(connected, { ...connected.accounts[0], needsReauth: false }, quota, undefined, true), /채팅 연결 설정됨/);
});

test("chat connection badges follow the selected account without changing provider controls", () => {
  const accounts = [
    { id: "account-a", label: "A", selected: true, needsReauth: false },
    { id: "account-b", label: "B", selected: false, needsReauth: false },
  ];
  const connected: ManagedProvider = { ...provider, id: "google-antigravity", inferenceConnected: true, accounts };
  for (const selectedId of ["account-a", "account-b"]) {
    const snapshot = { ...connected, accounts: accounts.map(account => ({ ...account, selected: account.id === selectedId })) };
    for (const account of snapshot.accounts) {
      for (const expanded of [false, true]) {
        const html = providerAccountHtml(snapshot, account, undefined, undefined, expanded);
        assert.equal(html.includes("현재 로그인"), account.selected);
        assert.equal(html.includes("채팅 연결 설정됨"), expanded && account.selected);
        assert.equal(html.includes("채팅 미연결"), expanded && !account.selected);
        assert.doesNotMatch(html, /class="badge disconnected"/);
        assert.equal(html.includes('data-action="providerSelect"'), expanded && !account.selected);
        assert.equal(html.includes("자동 전환 허용"), expanded);
      }
    }
  }
  const disconnected = { ...connected, inferenceConnected: false };
  for (const account of disconnected.accounts) {
    const html = providerAccountHtml(disconnected, account, undefined, undefined, true);
    assert.doesNotMatch(html, /채팅 연결 설정됨/);
    assert.match(html, /채팅 미연결/);
  }
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

test("provider quota displays remaining gauges for bounded ratios and numeric values otherwise", () => {
  const quota: ProviderAccountQuota = {
    providerId: "devin",
    accountId: "account",
    status: "ok",
    source: "account probe",
    observedAt: Date.UTC(2026, 8, 16),
    rows: [
      { label: "Window", usedPercent: 37.5 },
      { label: "Credits", remaining: 12, limit: 50, unit: "requests" },
      { label: "Consumed", used: 123, unit: "tokens" },
      { label: "Enterprise", unlimited: true, remaining: 0, limit: 0, unit: "requests" },
    ],
  };
  const html = providerQuotaHtml(quota);
  assert.match(html, /62\.5% 남음/);
  assert.doesNotMatch(html, /37\.5% 사용/);
  assert.match(html, /24% 남음/);
  assert.match(html, /aria-valuenow="24"/);
  assert.match(html, /123 tokens 사용/);
  assert.doesNotMatch(html, /123 tokens 남음/);
  assert.match(html, /<span data-azrael-dynamic-text>Enterprise<\/span><\/span><span class="provider-quota-value"><strong>무제한<\/strong>/);
  assert.doesNotMatch(html, /출처|관측|account probe/);
});

test("unsupported and error observations preserve status and escaped errors without source metadata", () => {
  const unsupported = providerQuotaHtml({
    providerId: "devin", accountId: "managed", status: "unsupported", source: "managed account", observedAt: 1_789_516_800_000, rows: [],
  });
  assert.match(unsupported, /계정별 한도 조회를 지원하지 않습니다/);
  assert.doesNotMatch(unsupported, /출처|관측|managed account/);

  const failed = providerQuotaHtml({
    providerId: "other", accountId: "a", status: "error", source: "quota API", observedAt: 1_789_516_800_000, rows: [], error: "denied <unsafe>",
  });
  assert.match(failed, /한도 조회 실패/);
  assert.match(failed, /denied &lt;unsafe&gt;/);
  assert.doesNotMatch(failed, /출처|관측|quota API|<unsafe>/);
});

test("never-observed provider results do not display the Unix epoch", () => {
  const html = providerQuotaHtml({
    providerId: "devin", accountId: "managed", status: "unsupported", source: "managed account", observedAt: 0, rows: [],
  });
  assert.match(html, /계정별 한도 조회를 지원하지 않습니다/);
  assert.doesNotMatch(html, /관측|출처/);
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
  assert.match(html, /이전 조회 값/);
  assert.match(html, /최신 한도 조회 실패 · <span data-azrael-dynamic-text>temporarily unavailable<\/span>/);
  assert.doesNotMatch(html, /출처|관측|cached probe|live probe/);
});


test("provider usage disclosure keeps collapsed identity compact and shows management when expanded", () => {
  const quota: ProviderAccountQuota = { providerId: provider.id, accountId: provider.accounts[0].id, status: "ok", source: "probe", observedAt: 1, rows: [{ label: "Private quota", remaining: 8 }] };
  const collapsed = providerAccountHtml(provider, provider.accounts[0], quota);
  assert.match(collapsed, /aria-expanded="false"/);
  assert.match(collapsed, /role="button" tabindex="0" data-action="toggleUsage"/);
  assert.match(collapsed, /Private quota/);
  assert.match(collapsed, /8 남음/);
  assert.doesNotMatch(collapsed, /출처/);
  assert.match(collapsed, /account-summary.*account-identity.*<h2><span data-azrael-dynamic-text>A&amp;B<\/span><\/h2>/);
  assert.doesNotMatch(collapsed, /providerReauth|providerRemove|card-actions/);
  const unselected = providerAccountHtml(provider, { ...provider.accounts[0], selected: false }, quota);
  assert.doesNotMatch(unselected, /data-action="providerSelect"/);
  assert.match(providerAccountHtml(provider, { ...provider.accounts[0], selected: false }, quota, undefined, true), /data-action="providerSelect"/);
  const expanded = providerAccountHtml(provider, provider.accounts[0], quota, undefined, true);
  assert.match(expanded, /aria-expanded="true"/);
  assert.match(expanded, /role="button" tabindex="0" data-action="toggleUsage" aria-expanded="true"/);
  assert.match(expanded, /Private quota/);
  assert.match(expanded, /8 남음/);
  assert.match(expanded, /providerReauth/);
  assert.match(expanded, /providerRemove/);
});

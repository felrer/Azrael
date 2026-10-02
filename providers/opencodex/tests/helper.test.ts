import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { handleRequest, safeMessage, validateIsolatedHomeForTests } from "../helper.ts";
import * as oauth from "../vendor/src/oauth/index.ts";
import * as store from "../vendor/src/oauth/store.ts";
import * as config from "../vendor/src/config.ts";
import * as quota from "../vendor/src/providers/quota.ts";
import * as registry from "../vendor/src/providers/registry.ts";
import * as devinBase from "../vendor/src/oauth/devin/api-base.ts";

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

function home() {
  const root = mkdtempSync(join(tmpdir(), "azrael-ocx-helper-"));
  roots.push(root);
  const codex = join(root, "codex");
  const ocx = join(codex, "azrael", "providers", "opencodex");
  mkdirSync(ocx, { recursive: true });
  process.env.CODEX_HOME = codex;
  process.env.OPENCODEX_HOME = ocx;
}

function real(overrides: Record<string, unknown> = {}) {
  return { oauth, store, config, quota, registry, devinBase, ...overrides } as any;
}

const io = { send() {}, async answer() { return null; } };
const request = (id: string, action: string, rest: Record<string, unknown> = {}) => ({ protocol: 1 as const, id, action, ...rest });

describe("provider account helper", () => {
  test("OAuth failures preserve safe categories without response bodies", () => {
    expect(safeMessage(new Error("OAuth callback timed out"))).toBe("Provider OAuth callback timed out");
    expect(safeMessage(new Error("OAuth callback cancelled: private detail"))).toBe("Provider OAuth callback was cancelled");
    expect(safeMessage(new Error("State mismatch - possible CSRF attack"))).toBe("Provider OAuth callback state mismatch");
    const denied = Object.assign(new Error("Anthropic OAuth HTTP 403: secret response body"), { name: "AnthropicTokenError", httpStatus: 403 });
    expect(safeMessage(denied)).toBe("Claude OAuth token exchange failed (HTTP 403)");
    expect(safeMessage(new Error("private secret response body"))).toBe("Provider account operation failed");
  });
  test("Antigravity OAuth badge requires usable selected project, CCA transport and runtime", async () => {
    home();
    const originalHelper = process.env.AZRAEL_PROVIDER_INFERENCE_HELPER, originalBun = process.env.AZRAEL_PROVIDER_BUN;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('LIVE_NETWORK_FORBIDDEN'); }) as typeof fetch;
    try {
      const runtime = join(process.env.CODEX_HOME!, 'runtime-fixture'); writeFileSync(runtime, 'fixture');
      process.env.AZRAEL_PROVIDER_INFERENCE_HELPER = runtime; process.env.AZRAEL_PROVIDER_BUN = runtime;
      const cfg = config.loadConfig();
      cfg.providers['google-antigravity'] = { adapter: 'google', baseUrl: 'https://daily-cloudcode-pa.googleapis.com', authMode: 'oauth', googleMode: 'cloud-code-assist' };
      config.saveConfig(cfg);
      await store.saveCredential('google-antigravity', { access: 'synthetic-access', refresh: 'synthetic-refresh', expires: Number.MAX_SAFE_INTEGER, accountId: 'synthetic-principal', projectId: 'synthetic-project' });
      const account = store.listAccounts('google-antigravity')[0]!;
      const connected = async () => (await handleRequest(request('list-google', 'list'), io, real()) as any).providers.find((p: any) => p.id === 'google-antigravity')?.inferenceConnected;
      expect(await connected()).toBeTrue();
      delete process.env.AZRAEL_PROVIDER_BUN; expect(await connected()).toBeFalse();
      process.env.AZRAEL_PROVIDER_BUN = runtime;
      await store.markAccountNeedsReauth('google-antigravity', account.id, true); expect(await connected()).toBeFalse();
      await store.markAccountNeedsReauth('google-antigravity', account.id, false);
      for (const change of [{ disabled: true }, { googleMode: 'ai-studio' }, { adapter: 'openai-chat' }, { authMode: 'key' }]) {
        const changed = config.loadConfig(); changed.providers['google-antigravity'] = { ...cfg.providers['google-antigravity'], ...change } as any; config.saveConfig(changed);
        expect(await connected()).not.toBeTrue();
      }
      config.saveConfig(cfg);
      await store.saveCredential('google-antigravity', { access: 'synthetic-access', refresh: 'synthetic-refresh', expires: Number.MAX_SAFE_INTEGER, accountId: 'synthetic-principal' });
      expect(await connected()).toBeFalse();
    } finally {
      globalThis.fetch = originalFetch;
      if (originalHelper === undefined) delete process.env.AZRAEL_PROVIDER_INFERENCE_HELPER; else process.env.AZRAEL_PROVIDER_INFERENCE_HELPER = originalHelper;
      if (originalBun === undefined) delete process.env.AZRAEL_PROVIDER_BUN; else process.env.AZRAEL_PROVIDER_BUN = originalBun;
    }
  });
  test("lists only release OAuth transports and leaves saved API keys untouched", async () => {
    home();
    const cfg = config.loadConfig();
    cfg.providers.openrouter = { adapter: "openai-chat", baseUrl: "https://openrouter.ai/api/v1", authMode: "key", apiKey: "saved-openrouter" };
    cfg.providers.anthropic = { adapter: "anthropic", baseUrl: "https://api.anthropic.com", authMode: "key", apiKey: "saved-anthropic" };
    config.saveConfig(cfg);
    await store.saveCredential("xai", { access: "xai-token", refresh: "xai-refresh", expires: Number.MAX_SAFE_INTEGER, accountId: "xai-user", source: "oauth" });
    await store.saveCredential("anthropic", { access: "claude-token", refresh: "claude-refresh", expires: Number.MAX_SAFE_INTEGER, accountId: "claude-user", source: "oauth" });
    const listed: any = await handleRequest(request("list", "list"), io, real());
    expect(listed.availableProviders.map((provider: any) => provider.id).sort()).toEqual(["anthropic", "devin", "google-antigravity"]);
    expect(listed.availableProviders.every((provider: any) => provider.authKind === "oauth")).toBeTrue();
    expect(listed.providers).toEqual([]);
    expect(config.loadConfig().providers.openrouter?.apiKey).toBe("saved-openrouter");
    expect(config.loadConfig().providers.anthropic?.apiKey).toBe("saved-anthropic");
    expect(store.listAccounts("xai")).toHaveLength(1);
    expect(store.listAccounts("anthropic")).toHaveLength(1);
  });

  test("rejects direct key and unsupported OAuth operations without touching saved keys", async () => {
    home();
    const cfg = config.loadConfig();
    cfg.providers.openrouter = { adapter: "openai-chat", baseUrl: "https://openrouter.ai/api/v1", authMode: "key", apiKey: "saved-key" };
    cfg.providers.anthropic = { adapter: "anthropic", baseUrl: "https://api.anthropic.com", authMode: "key", apiKey: "saved-claude-key" };
    config.saveConfig(cfg);
    const rejected = [
      request("add", "addKey", { providerId: "openrouter", key: "new-key" }),
      request("select", "select", { providerId: "openrouter", accountId: "any" }),
      request("remove", "remove", { providerId: "openrouter", accountId: "any" }),
      request("quota", "quota", { providerId: "openrouter", accountId: "any" }),
      request("batch", "quotaBatch", { providerId: "openrouter" }),
      request("override", "select", { providerId: "anthropic", accountId: "any" }),
      request("login", "login", { providerId: "xai" }),
      request("native", "login", { providerId: "openai" }),
    ];
    for (const item of rejected) {
      await expect(handleRequest(item, io, real())).rejects.toThrow("Provider action is not supported");
    }
    expect(config.loadConfig().providers.openrouter?.apiKey).toBe("saved-key");
  });
  test("Claude OAuth readiness requires a stable account identity", async () => {
    home();
    const originalHelper = process.env.AZRAEL_PROVIDER_INFERENCE_HELPER, originalBun = process.env.AZRAEL_PROVIDER_BUN;
    try {
      const runtime = join(process.env.CODEX_HOME!, "runtime-fixture"); writeFileSync(runtime, "fixture");
      process.env.AZRAEL_PROVIDER_INFERENCE_HELPER = runtime; process.env.AZRAEL_PROVIDER_BUN = runtime;
      const cfg = config.loadConfig();
      cfg.providers.anthropic = { adapter: "anthropic", baseUrl: "https://api.anthropic.com", authMode: "oauth" };
      config.saveConfig(cfg);
      await store.saveCredential("anthropic", { access: "access", refresh: "refresh", expires: Number.MAX_SAFE_INTEGER, source: "oauth" });
      const listed: any = await handleRequest(request("list", "list"), io, real());
      expect(listed.providers.find((provider: any) => provider.id === "anthropic")?.inferenceConnected).toBeFalse();
    } finally {
      if (originalHelper === undefined) delete process.env.AZRAEL_PROVIDER_INFERENCE_HELPER; else process.env.AZRAEL_PROVIDER_INFERENCE_HELPER = originalHelper;
      if (originalBun === undefined) delete process.env.AZRAEL_PROVIDER_BUN; else process.env.AZRAEL_PROVIDER_BUN = originalBun;
    }
  });
  test("Claude OAuth badge requires stable identity, selected usable refresh, transport and runtime", async () => {
    home();
    const originalHelper = process.env.AZRAEL_PROVIDER_INFERENCE_HELPER, originalBun = process.env.AZRAEL_PROVIDER_BUN;
    try {
      const runtime = join(process.env.CODEX_HOME!, "runtime-fixture"); writeFileSync(runtime, "fixture");
      process.env.AZRAEL_PROVIDER_INFERENCE_HELPER = runtime; process.env.AZRAEL_PROVIDER_BUN = runtime;
      const cfg = config.loadConfig();
      cfg.providers.anthropic = { adapter: "anthropic", baseUrl: "https://api.anthropic.com", authMode: "oauth" };
      config.saveConfig(cfg);
      await store.saveCredential("anthropic", { access: "access", refresh: "refresh", expires: Number.MAX_SAFE_INTEGER, accountId: "claude-user", source: "oauth" });
      const account = store.listAccounts("anthropic")[0]!;
      const connected = async () => (await handleRequest(request("list", "list"), io, real()) as any).providers.find((provider: any) => provider.id === "anthropic")?.inferenceConnected;
      expect(await connected()).toBeTrue();
      await store.markAccountNeedsReauth("anthropic", account.id, true); expect(await connected()).toBeFalse();
      await store.markAccountNeedsReauth("anthropic", account.id, false);
      delete process.env.AZRAEL_PROVIDER_BUN; expect(await connected()).toBeFalse();
      process.env.AZRAEL_PROVIDER_BUN = runtime;
      const changed = config.loadConfig(); changed.providers.anthropic = { ...cfg.providers.anthropic, authMode: "key", apiKey: "saved" } as any; config.saveConfig(changed);
      expect(await connected()).toBeUndefined();
      expect(config.loadConfig().providers.anthropic?.apiKey).toBe("saved");
    } finally {
      if (originalHelper === undefined) delete process.env.AZRAEL_PROVIDER_INFERENCE_HELPER; else process.env.AZRAEL_PROVIDER_INFERENCE_HELPER = originalHelper;
      if (originalBun === undefined) delete process.env.AZRAEL_PROVIDER_BUN; else process.env.AZRAEL_PROVIDER_BUN = originalBun;
    }
  });
  test("uses the upstream OAuth store for multi-provider list, selection, and removal", async () => {
    home();
    await store.saveCredential("devin", { access: "devin-one", refresh: "devin-one", expires: Number.MAX_SAFE_INTEGER, accountId: "one", apiBaseUrl: "https://server.codeium.com", source: "oauth" });
    await store.saveCredential("devin", { access: "devin-two", refresh: "devin-two", expires: Number.MAX_SAFE_INTEGER, accountId: "two", apiBaseUrl: "https://eu.windsurf.com/_route/api_server", source: "oauth" }, { preserveIdentityless: true });
    await store.saveCredential("xai", { access: "xai-one", refresh: "xai-one", expires: Number.MAX_SAFE_INTEGER, accountId: "x-one", source: "oauth" });
    const devin = store.listAccounts("devin");
    expect(devin).toHaveLength(2);
    await handleRequest(request("s", "select", { providerId: "devin", accountId: devin[0]!.id }), io, real());
    const listed: any = await handleRequest(request("l", "list"), io, real());
    expect(listed.providers.find((p: any) => p.id === "devin").accounts.filter((a: any) => a.selected)).toEqual([expect.objectContaining({ id: devin[0]!.id })]);
    expect(listed.providers.some((p: any) => p.id === "xai")).toBeFalse();
    await store.markAccountNeedsReauth("devin", devin[1]!.id, true);
    expect(handleRequest(request("bad-select", "select", { providerId: "devin", accountId: devin[1]!.id }), io, real())).rejects.toThrow("Provider account was not found");
    await handleRequest(request("r", "remove", { providerId: "devin", accountId: devin[1]!.id }), io, real());
    expect(store.listAccounts("devin").map(a => a.id)).toEqual([devin[0]!.id]);
  });

  test("returns selected or explicit Devin credentials from one exact stored record", async () => {
    home();
    await store.saveCredential("devin", { access: "secret-a", refresh: "secret-a", expires: Number.MAX_SAFE_INTEGER, accountId: "a", apiBaseUrl: "https://server.codeium.com", source: "oauth" });
    await store.saveCredential("devin", { access: "secret-b", refresh: "secret-b", expires: Number.MAX_SAFE_INTEGER, accountId: "b", apiBaseUrl: "https://eu.windsurf.com/_route/api_server", source: "oauth" }, { preserveIdentityless: true });
    const accounts = store.listAccounts("devin");
    await store.setActiveAccount("devin", accounts[0]!.id);
    expect(await handleRequest(request("c1", "credential", { providerId: "devin" }), io, real())).toEqual({ api_key: "secret-a", api_server_url: "https://server.codeium.com", account_id: accounts[0]!.id });
    expect(await handleRequest(request("c2", "credential", { providerId: "devin", accountId: accounts[1]!.id }), io, real())).toEqual({ api_key: "secret-b", api_server_url: "https://eu.windsurf.com/_route/api_server", account_id: accounts[1]!.id });
  });

  test("maps one account-scoped quota roster without changing selection and reports unsupported", async () => {
    home();
    await store.saveCredential("anthropic", { access: "x-a", refresh: "x-a", expires: Number.MAX_SAFE_INTEGER, accountId: "a", source: "oauth" });
    await store.saveCredential("anthropic", { access: "x-b", refresh: "x-b", expires: Number.MAX_SAFE_INTEGER, accountId: "b", source: "oauth" }, { preserveIdentityless: true });
    const accounts = store.listAccounts("anthropic");
    await store.setActiveAccount("anthropic", accounts[0]!.id);
    let calls = 0;
    const quotaMock = { ...quota, providerOAuthAccountQuotaMode: () => "probe", fetchProviderAccountQuotas: async () => { calls++; return accounts.map((a, i) => ({ accountId: a.id, quota: { weeklyPercent: 10 + i, weeklyResetAt: 1_900_000_000_000, updatedAt: 1234 }, isCurrent: () => true })); } };
    const batch: any = await handleRequest(request("q", "quotaBatch", { providerId: "anthropic", force: true }), io, real({ quota: quotaMock }));
    expect(calls).toBe(1);
    expect(batch.quotas).toEqual(accounts.map((a, i) => expect.objectContaining({ accountId: a.id, status: "ok", observedAt: 1234, rows: [{ label: "Weekly", usedPercent: 10 + i, resetsAt: 1_900_000_000 }] })));
    expect(store.getAccountSet("anthropic")!.activeAccountId).toBe(accounts[0]!.id);
    const unsupportedQuota = { ...quota, providerOAuthAccountQuotaMode: () => "unsupported" };
    const unsupported: any = await handleRequest(request("u", "quotaBatch", { providerId: "anthropic" }), io, real({ quota: unsupportedQuota }));
    expect(unsupported.quotas.every((row: any) => row.status === "unsupported" && row.rows.length === 0)).toBeTrue();
  });

  test("reads passive quota without starting an account probe and emits unmeasured accounts", async () => {
    home();
    await store.saveCredential("google-antigravity", { access: "muse-a", refresh: "muse-a", expires: Number.MAX_SAFE_INTEGER, accountId: "m-a", source: "oauth" });
    let probes = 0;
    const passiveQuota = {
      ...quota,
      providerOAuthAccountQuotaMode: () => "passive",
      readPassiveProviderAccountQuotas: () => [],
      fetchProviderAccountQuotas: async () => { probes++; return []; },
    };
    const batch: any = await handleRequest(request("p", "quotaBatch", { providerId: "google-antigravity" }), io, real({ quota: passiveQuota }));
    expect(probes).toBe(0);
    expect(batch.quotas).toEqual([expect.objectContaining({ status: "error", observedAt: 0, rows: [], error: "Quota has not been observed" })]);
  });

  test("emits interactive login frames and restores the prior selection", async () => {
    home();
    await store.saveCredential("devin", { access: "old", refresh: "old", expires: Number.MAX_SAFE_INTEGER, accountId: "old", apiBaseUrl: "https://server.codeium.com", source: "oauth" });
    const original = store.getAccountSet("devin")!.activeAccountId;
    const frames: any[] = [];
    const answers = ["device acknowledged", "manual-code"];
    let manualCode: string | undefined;
    const oauthMock = { ...oauth, OAUTH_PROVIDERS: { devin: {} }, runLogin: async (_provider: string, ctrl: any, _options: any, deps: any) => {
      ctrl.onAuth({ url: "https://example.invalid/login", instructions: "Enter this code", deviceCode: "ABCD-EFGH" });
      manualCode = await ctrl.onManualCodeInput();
      const credential = { access: "new", refresh: "new", expires: Number.MAX_SAFE_INTEGER, accountId: "new", apiBaseUrl: "https://server.codeium.com", source: "oauth" as const };
      await deps.saveCredential("devin", credential, { preserveIdentityless: true });
      return credential;
    } };
    await handleRequest(request("login", "login", { providerId: "devin" }), { send: value => frames.push(value), answer: async (prompt, password) => { frames.push({ id: "login", type: "prompt", prompt, password }); return answers.shift() ?? null; }, readAnswer: async () => "opened" }, real({ oauth: oauthMock }));
    expect(frames).toEqual([
      { id: "login", type: "openUrl", url: "https://example.invalid/login" },
      { id: "login", type: "prompt", prompt: "Enter this code\nABCD-EFGH", password: false },
      { id: "login", type: "prompt", prompt: "Paste the authorization code or callback URL", password: true },
    ]);
    expect(manualCode).toBe("manual-code");
    expect(store.getAccountSet("devin")!.activeAccountId).toBe(original);
  });

  test("rejects ordinary Codex and OpenCodex homes before upstream access", () => {
    for (const ordinary of [join(homedir(), ".codex"), join(homedir(), ".opencodex")]) {
      process.env.CODEX_HOME = ordinary;
      process.env.OPENCODEX_HOME = join(ordinary, "azrael", "providers", "opencodex");
      expect(validateIsolatedHomeForTests).toThrow("ordinary account home");
    }
  });
});

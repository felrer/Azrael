import { createInterface, type Interface } from "node:readline";
import { resolve, join, relative, isAbsolute } from "node:path";
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { autoSwitchAvailable, autoSwitchAllowed, setAutoSwitch, recoverDevinAccount, withAutoSwitchPolicyMutation } from './auto-switch.ts';
import { isManagedOAuthTransport, managedClaudeIdentity } from './inference-config.ts';

type Request = { protocol: 1; id: string; action: string; [key: string]: unknown };
type Io = { send(value: unknown): void; answer(prompt: string, password?: boolean): Promise<string | null>; readAnswer?(): Promise<string | null> };

const SAFE_ERRORS: Record<string, string> = {
  invalid: "Invalid provider account request",
  missing: "Provider account was not found",
  unsupported: "Provider action is not supported",
  reauth: "Provider account must be reauthenticated",
  login: "Provider login failed",
  quota: "Provider quota query failed",
};

function containsPath(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function physicalPath(path: string): string {
  let current = resolve(path);
  const missing: string[] = [];
  while (!existsSync(current)) {
    const parent = resolve(current, "..");
    if (parent === current) break;
    missing.unshift(current.slice(parent.length).replace(/^[\\/]+/, ""));
    current = parent;
  }
  const physical = existsSync(current) ? realpathSync.native(current) : current;
  return resolve(physical, ...missing);
}

export function validateIsolatedHomeForTests(): string {
  const codex = process.env.CODEX_HOME?.trim();
  const configured = process.env.OPENCODEX_HOME?.trim();
  if (!codex || !configured || !isAbsolute(codex) || !isAbsolute(configured)) {
    throw new Error("Provider account storage is not configured");
  }
  const expected = resolve(codex, "azrael", "providers", "opencodex");
  const actual = resolve(configured);
  if (actual.toLowerCase() !== expected.toLowerCase() || !containsPath(resolve(codex), actual)) {
    throw new Error("Provider account storage is not isolated");
  }
  const ordinary = [resolve(homedir(), ".codex"), resolve(homedir(), ".opencodex")];
  const candidates = [resolve(codex), actual];
  if (ordinary.some(root => candidates.some(candidate => containsPath(root, candidate)))) {
    throw new Error("Provider account storage cannot use an ordinary account home");
  }
  const physicalOrdinary = ordinary.map(physicalPath);
  const physicalCandidates = candidates.map(physicalPath);
  if (physicalOrdinary.some(root => physicalCandidates.some(candidate => containsPath(root, candidate)))) {
    throw new Error("Provider account storage cannot route through an ordinary account home");
  }
  return actual;
}

const isolatedHome = validateIsolatedHomeForTests;

function configuredInferenceRuntime(): boolean {
  return [process.env.AZRAEL_PROVIDER_INFERENCE_HELPER, process.env.AZRAEL_PROVIDER_BUN].every(path => {
    if (!path || !isAbsolute(path)) return false;
    try { return statSync(path).isFile(); } catch { return false; }
  });
}

async function modules() {
  isolatedHome();
  const [oauth, store, config, quota, registry, devinBase] = await Promise.all([
    import("./vendor/src/oauth/index.ts"),
    import("./vendor/src/oauth/store.ts"),
    import("./vendor/src/config.ts"),
    import("./vendor/src/providers/quota.ts"),
    import("./vendor/src/providers/registry.ts"),
    import("./vendor/src/oauth/devin/api-base.ts"),
  ]);
  return { oauth, store, config, quota, registry, devinBase };
}

const ACCOUNT_PROVIDERS = ["anthropic", "google-antigravity", "devin"] as const;

function supportedOAuthProvider(m: Awaited<ReturnType<typeof modules>>, providerId: string): boolean {
  return ACCOUNT_PROVIDERS.includes(providerId as typeof ACCOUNT_PROVIDERS[number]) && !!m.oauth.OAUTH_PROVIDERS[providerId];
}

function activeOAuthProvider(m: Awaited<ReturnType<typeof modules>>, providerId: string): boolean {
  const configured = m.config.loadConfig().providers[providerId];
  return supportedOAuthProvider(m, providerId) && (!configured || configured.authMode === "oauth");
}

function labelForAccount(account: any): string {
  return account.alias?.trim() || account.credential?.email?.trim() || account.credential?.accountId?.trim() || account.id;
}

function quotaRows(value: any): any[] {
  const rows: any[] = [];
  const add = (label: string, usedPercent: unknown, resetsAt?: unknown) => {
    if (typeof usedPercent === "number" && Number.isFinite(usedPercent)) {
      rows.push({ label, usedPercent, ...(typeof resetsAt === "number" ? { resetsAt: Math.floor(resetsAt > 10_000_000_000 ? resetsAt / 1000 : resetsAt) } : {}) });
    }
  };
  add("5 hour", value?.fiveHourPercent, value?.fiveHourResetAt);
  add("Weekly", value?.weeklyPercent, value?.weeklyResetAt);
  add("Monthly", value?.monthlyPercent, value?.monthlyResetAt);
  for (const row of value?.customWindows ?? []) add(row.label, row.percent, row.resetAt);
  if (value?.creditsUsd) {
    const c = value.creditsUsd;
    rows.push({ label: "Credits", usedPercent: c.percent, remaining: c.remaining, limit: c.limit, unit: "USD", ...(c.unlimited !== undefined ? { unlimited: c.unlimited } : {}), ...(c.expiresAt ? { resetsAt: Math.floor(c.expiresAt > 10_000_000_000 ? c.expiresAt / 1000 : c.expiresAt) } : {}) });
  }
  return rows;
}

function providerLabel(registry: any, id: string): string {
  return registry.PROVIDER_REGISTRY.find((row: any) => row.id === id || row.oauthId === id)?.label ?? id;
}

async function snapshot(m: Awaited<ReturnType<typeof modules>>) {
  const config = m.config.loadConfig();
  const available = ACCOUNT_PROVIDERS.filter(id => supportedOAuthProvider(m, id)).map(id => ({ id, label: providerLabel(m.registry, id), authKind: "oauth" as const }));
  const providers: any[] = [];
  for (const id of ACCOUNT_PROVIDERS) {
    const configured = config.providers[id];
    if ((configured && configured.authMode !== "oauth") || !supportedOAuthProvider(m, id)) continue;
    const set = m.store.getAccountSet(id);
    if (configured?.authMode === "oauth" || set) {
      if (!set && !configured) continue;
      const activeAccountId = set?.activeAccountId;
      providers.push({
        id, label: providerLabel(m.registry, id), authKind: "oauth",
        quotaMode: m.quota.providerOAuthAccountQuotaMode(id),
        inferenceConnected: id === "devin" || (isManagedOAuthTransport(id, configured)
          && !!set?.accounts.some((account: any) => account.id === activeAccountId && !account.needsReauth && account.credential?.refresh && (id === 'anthropic' ? managedClaudeIdentity(account.credential) : account.credential?.projectId))
          && configuredInferenceRuntime()),
        accounts: (set?.accounts ?? []).map((account: any) => ({
          id: account.id, label: labelForAccount(account), selected: activeAccountId === account.id,
          needsReauth: account.needsReauth === true,
          autoSwitchAllowed: autoSwitchAllowed(id, account),
          autoSwitchAvailable: autoSwitchAvailable(id, account, m),
        })),
      });
    }
  }
  return { providers, availableProviders: available.sort((a, b) => a.label.localeCompare(b.label)) };
}

async function exactQuota(m: Awaited<ReturnType<typeof modules>>, providerId: string, accountId: string, force: boolean) {
  const batch = await quotaBatch(m, providerId, force);
  const result = batch.quotas.find((row: any) => row.accountId === accountId);
  if (!result) throw new Error(SAFE_ERRORS.missing);
  return result;
}

async function quotaBatch(m: Awaited<ReturnType<typeof modules>>, providerId: string, force: boolean) {
  if (!activeOAuthProvider(m, providerId)) throw new Error(SAFE_ERRORS.unsupported);
  const config = m.config.loadConfig();
    const set = m.store.getAccountSet(providerId);
    if (!set) return { providerId, quotas: [] };
    const mode = m.quota.providerOAuthAccountQuotaMode(providerId);
    if (mode === "unsupported") return { providerId, quotas: set.accounts.map((account: any) => ({ providerId, accountId: account.id, status: "unsupported", source: "unsupported", observedAt: 0, rows: [] })) };
    if (mode === "passive") {
      const observed = new Map(m.quota.readPassiveProviderAccountQuotas(providerId).map((row: any) => [row.accountId, row]));
      return { providerId, quotas: set.accounts.map((account: any) => {
        const row: any = observed.get(account.id);
        if (!row?.quota) return { providerId, accountId: account.id, status: "error", source: "opencodex-passive-quota", observedAt: 0, rows: [], error: "Quota has not been observed" };
        return { providerId, accountId: account.id, status: row.unavailable ? "error" : "ok", source: "opencodex-passive-quota", observedAt: row.quota.updatedAt, rows: quotaRows(row.quota), ...(row.unavailable ? { error: "Quota is currently unavailable" } : {}) };
      }) };
    }
    const rows = await m.quota.fetchProviderAccountQuotas(providerId, force, config.providers[providerId]);
    const liveIds = new Set((m.store.getAccountSet(providerId)?.accounts ?? []).map((account: any) => account.id));
    return { providerId, quotas: rows.filter((row: any) => liveIds.has(row.accountId) && row.isCurrent?.() !== false).map((row: any) => ({ providerId, accountId: row.accountId, status: row.unavailable ? "error" : "ok", source: "opencodex-provider-quota", observedAt: row.quota?.updatedAt ?? 0, rows: quotaRows(row.quota), ...(row.unavailable ? { error: "Quota is currently unavailable" } : {}) })) };
}

export async function handleRequest(request: Request, io: Io, injected?: Awaited<ReturnType<typeof modules>>): Promise<unknown> {
  if (request.protocol !== 1 || typeof request.id !== "string" || !request.id || typeof request.action !== "string") throw new Error(SAFE_ERRORS.invalid);
  const m = injected ?? await modules();
  const providerId = typeof request.providerId === "string" ? request.providerId : "";
  const accountId = typeof request.accountId === "string" ? request.accountId : undefined;
  switch (request.action) {
    case "retirementStatus": return (await import('./retirement.ts')).retirementStatus(request, m);
    case "retireAccount": {
      if (!activeOAuthProvider(m, providerId)) throw new Error(SAFE_ERRORS.unsupported);
      const antigravity = await import('./antigravity.ts');
      return (await import('./retirement.ts')).retireAccount(request, { ...m, antigravity });
    }
    case "list": return snapshot(m);
    case "setAutoSwitch": {
      if (!providerId || !accountId || typeof request.enabled !== 'boolean') throw new Error(SAFE_ERRORS.invalid);
      if (!activeOAuthProvider(m, providerId)) throw new Error(SAFE_ERRORS.unsupported);
      return setAutoSwitch(providerId, accountId, request.enabled, m);
    }
    case "recoverAccount": {
      if (!activeOAuthProvider(m, providerId)) throw new Error(SAFE_ERRORS.unsupported);
      if (providerId === 'devin') return recoverDevinAccount(request, m);
      const inference = await import('./inference.ts');
      const antigravity = await import('./antigravity.ts');
      return inference.recoverAccount(request, { ...m, antigravity });
    }
    case "quota": {
      if (!providerId || !accountId) throw new Error(SAFE_ERRORS.invalid);
      return exactQuota(m, providerId, accountId, request.force === true);
    }
    case "quotaBatch": {
      if (!providerId) throw new Error(SAFE_ERRORS.invalid);
      return quotaBatch(m, providerId, request.force === true);
    }
    case "select": {
      if (!providerId || !accountId) throw new Error(SAFE_ERRORS.invalid);
      if (!activeOAuthProvider(m, providerId)) throw new Error(SAFE_ERRORS.unsupported);
      const ok = (await m.store.commitOAuthAccountSelection(providerId, accountId, { requireUsableAccount: true })) !== null;
      if (!ok) throw new Error(SAFE_ERRORS.missing);
      return null;
    }
    case "remove": {
      if (!providerId || !accountId) throw new Error(SAFE_ERRORS.invalid);
      if (!activeOAuthProvider(m, providerId)) throw new Error(SAFE_ERRORS.unsupported);
      const ok = await m.store.removeAccount(providerId, accountId, { deferSelection: true });
      if (!ok) throw new Error(SAFE_ERRORS.missing);
      if (m.store.getAccountSet(providerId)?.activeAccountId === '') {
        const antigravity = await import('./antigravity.ts');
        await (await import('./retirement.ts')).selectAfterRemoval(providerId, accountId, { ...m, antigravity });
      }
      return null;
    }
    case "addKey": throw new Error(SAFE_ERRORS.unsupported);
    case "login": {
      if (!supportedOAuthProvider(m, providerId)) throw new Error(SAFE_ERRORS.unsupported);
      const abort = new AbortController();
      let interaction: Promise<string | null> = Promise.resolve("ready");
      const ctrl = {
        onAuth: (info: any) => {
          interaction = interaction.then(async () => {
            if (info.url) {
              io.send({ id: request.id, type: "openUrl", url: info.url });
              const opened = io.readAnswer ? await io.readAnswer() : "opened";
              if (opened === null) { abort.abort("cancelled"); return null; }
            }
            if (info.deviceCode || info.instructions) {
              const acknowledged = await io.answer([info.instructions, info.deviceCode].filter(Boolean).join("\n"), false);
              if (acknowledged === null) { abort.abort("cancelled"); return null; }
              return acknowledged;
            }
            return "opened";
          });
        },
        onProgress: () => {},
        onManualCodeInput: async () => {
          const prior = await interaction;
          if (prior === null) throw new Error("cancelled");
          const value = await io.answer("Paste the authorization code or callback URL", true);
          if (value === null) throw new Error("cancelled");
          return value;
        },
        signal: abort.signal,
      };
      await m.oauth.runLogin(providerId, ctrl, { forceLogin: true, ...(accountId ? { reauthAccountId: accountId } : {}) }, {
        saveCredential: (savedProvider: string, credential: any, options: any) => m.store.saveCredential(savedProvider, credential, { ...options, preserveSelection: true }),
      });
      if (await interaction === null) throw new Error(SAFE_ERRORS.login);
      return null;
    }
    case "credential": {
      if (providerId !== "devin" || !activeOAuthProvider(m, providerId)) throw new Error(SAFE_ERRORS.unsupported);
      if (request.requireAutoSwitch === true) {
        if (!accountId) throw new Error(SAFE_ERRORS.invalid);
        // This private snapshot is recovery admission. Consent changes after it
        // is returned apply to subsequent recoveries, not this admitted snapshot.
        return withAutoSwitchPolicyMutation(m, () => {
          const account = m.store.getAccountSet("devin")?.accounts.find((item: any) => item.id === accountId);
          if (!account) throw new Error(SAFE_ERRORS.missing);
          if (!autoSwitchAvailable("devin", account, m) || !autoSwitchAllowed("devin", account)) throw new Error(SAFE_ERRORS.reauth);
          const url = m.devinBase.validateDevinApiBaseUrl(account.credential.apiBaseUrl);
          if (!url) throw new Error(SAFE_ERRORS.reauth);
          return { api_key: account.credential.access, api_server_url: url, account_id: accountId };
        });
      }
      const set = m.store.getAccountSet("devin");
      const id = accountId ?? set?.activeAccountId;
      if (!id) return null;
      const account = set?.accounts.find((item: any) => item.id === id);
      if (!account) throw new Error(SAFE_ERRORS.missing);
      if (account.needsReauth) throw new Error(SAFE_ERRORS.reauth);
      const url = m.devinBase.validateDevinApiBaseUrl(account.credential.apiBaseUrl);
      if (!url) throw new Error(SAFE_ERRORS.reauth);
      return { api_key: account.credential.access, api_server_url: url, account_id: id };
    }
    default: throw new Error(SAFE_ERRORS.unsupported);
  }
}

export function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Provider account operation failed";
  if (error && typeof error === "object" && "name" in error && error.name === "AnthropicTokenError" &&
      "httpStatus" in error && Number.isInteger(error.httpStatus) &&
      Number(error.httpStatus) >= 400 && Number(error.httpStatus) <= 599) {
    return `Claude OAuth token exchange failed (HTTP ${error.httpStatus})`;
  }
  if (/OAuth callback.*(?:timed out|timeout)/i.test(message)) return "Provider OAuth callback timed out";
  if (/OAuth callback cancelled/i.test(message)) return "Provider OAuth callback was cancelled";
  if (/State mismatch/i.test(message)) return "Provider OAuth callback state mismatch";
  return Object.values(SAFE_ERRORS).includes(message) || message.startsWith("Provider account storage") ? message : "Provider account operation failed";
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const iterator = rl[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) return;
  let request: Request;
  try { request = JSON.parse(first.value); } catch { process.stdout.write(`${JSON.stringify({ id: "", type: "error", error: SAFE_ERRORS.invalid })}\n`); return; }
  const send = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
  const io: Io = {
    send,
    readAnswer: async () => {
      const next = await iterator.next();
      if (next.done) return null;
      try {
        const answer = JSON.parse(next.value);
        return answer?.id === request.id && answer?.type === "answer" && (typeof answer.value === "string" || answer.value === null) ? answer.value : null;
      } catch { return null; }
    },
    answer: async (prompt, password = false) => {
      send({ id: request.id, type: "prompt", prompt, password });
      return io.readAnswer!();
    },
  };
  console.log = console.info = console.warn = console.error = () => {};
  try {
    const value = await handleRequest(request, io);
    send({ id: request.id, type: "result", value });
  } catch (error) {
    send({ id: request.id, type: "error", error: safeMessage(error) });
  } finally { rl.close(); }
}

if (import.meta.main) await main();

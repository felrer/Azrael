import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { isRecord } from "./protocol";
import { ManagedProvider, ProviderAccountQuota, ProviderAccountSnapshot, ProviderAccountsBackend, ProviderQuotaRow } from "./providerAccountProtocol";

interface Interaction {
  openUrl(url: string): PromiseLike<boolean>;
  prompt(message: string, password: boolean): PromiseLike<string | undefined>;
  log?(event: { requestId: string; action: string; phase: "start" | "complete" | "failed"; elapsedMs: number }): void;
}

const text = (value: unknown): value is string => typeof value === "string" && value.length <= 4096;
const id = (value: unknown): value is string => text(value) && value.length > 0 && !/[\u0000-\u001f]/.test(value);

export function parseProviderSnapshot(value: unknown): ProviderAccountSnapshot {
  if (!isRecord(value) || !Array.isArray(value.providers) || !Array.isArray(value.availableProviders) ||
      value.providers.length > 512 || value.availableProviders.length > 512) throw new Error("Invalid provider account response.");
  const providerIds = new Set<string>();
  const supported = (item: unknown): boolean => !isRecord(item) || (item.authKind !== "apiKey" && String(item.id).toLowerCase() !== "openai");
  const providers: ManagedProvider[] = value.providers.filter(supported).map(item => {
    if (!isRecord(item) || !id(item.id) || !text(item.label) ||
        !["oauth", "apiKey"].includes(String(item.authKind)) ||
        !["probe", "passive", "unsupported"].includes(String(item.quotaMode)) ||
        typeof item.inferenceConnected !== "boolean" || !Array.isArray(item.accounts) || item.accounts.length > 1000 || providerIds.has(item.id)) {
      throw new Error("Invalid provider identity.");
    }
    providerIds.add(item.id);
    const accountIds = new Set<string>();
    const accounts = item.accounts.map(account => {
      if (!isRecord(account) || !id(account.id) || !text(account.label) || typeof account.selected !== "boolean" ||
          typeof account.needsReauth !== "boolean" ||
          (account.autoSwitchAllowed !== undefined && typeof account.autoSwitchAllowed !== "boolean") ||
          (account.autoSwitchAvailable !== undefined && typeof account.autoSwitchAvailable !== "boolean") || accountIds.has(account.id)) throw new Error("Invalid provider account identity.");
      accountIds.add(account.id);
      return { id: account.id, label: account.label, selected: account.selected, needsReauth: account.needsReauth,
        ...(account.autoSwitchAllowed === undefined ? {} : { autoSwitchAllowed: account.autoSwitchAllowed as boolean }),
        ...(account.autoSwitchAvailable === undefined ? {} : { autoSwitchAvailable: account.autoSwitchAvailable as boolean }) };
    });
    if (accounts.filter(account => account.selected).length > 1) throw new Error("Multiple selected provider accounts.");
    return { id: item.id, label: item.label, authKind: item.authKind as ManagedProvider["authKind"],
      quotaMode: item.quotaMode as ManagedProvider["quotaMode"], inferenceConnected: item.inferenceConnected, accounts };
  });
  const availableProviders = value.availableProviders.filter(supported).map(item => {
    if (!isRecord(item) || !id(item.id) || !text(item.label) || !["oauth", "apiKey"].includes(String(item.authKind))) throw new Error("Invalid available provider.");
    return { id: item.id, label: item.label, authKind: item.authKind as ManagedProvider["authKind"] };
  });
  // The helper may still know about stored key credentials. Keep them in its
  // storage, but do not expose them as manageable accounts in this release.
  return { providers, availableProviders };
}

export function parseProviderQuota(value: unknown, providerId: string, accountId: string): ProviderAccountQuota {
  if (!isRecord(value) || value.providerId !== providerId || value.accountId !== accountId ||
      !["ok", "unsupported", "error"].includes(String(value.status)) || !text(value.source) ||
      typeof value.observedAt !== "number" || !Number.isFinite(value.observedAt) || value.observedAt < 0 ||
      !Array.isArray(value.rows) || value.rows.length > 256 || (value.error !== undefined && !text(value.error))) {
    throw new Error("Provider usage did not match the requested account.");
  }
  const rows: ProviderQuotaRow[] = value.rows.map(row => {
    if (!isRecord(row) || !text(row.label) || (row.unit !== undefined && !text(row.unit)) ||
        (row.unlimited !== undefined && typeof row.unlimited !== "boolean") ||
        (row.limitUnset !== undefined && typeof row.limitUnset !== "boolean") ||
        (row.limitUnset === true && (row.limit !== undefined || row.remaining !== undefined || row.unlimited === true))) throw new Error("Invalid provider usage row.");
    const safe: ProviderQuotaRow = { label: row.label };
    for (const key of ["usedPercent", "used", "remaining", "limit", "resetsAt"] as const) {
      if (row[key] !== undefined) {
        if (typeof row[key] !== "number" || !Number.isFinite(row[key])) throw new Error("Invalid provider usage value.");
        if (key === "used" && row[key] < 0) throw new Error("Invalid provider usage value.");
        safe[key] = row[key];
      }
    }
    if (row.unit !== undefined) safe.unit = row.unit as string;
    if (row.unlimited !== undefined) safe.unlimited = row.unlimited as boolean;
    if (row.limitUnset !== undefined) safe.limitUnset = row.limitUnset as boolean;
    return safe;
  });
  return { providerId, accountId, status: value.status as ProviderAccountQuota["status"], source: value.source,
    observedAt: value.observedAt, rows, ...(value.error === undefined ? {} : { error: value.error as string }) };
}

export class ProviderAccountService implements ProviderAccountsBackend {
  readonly enabled: boolean;
  snapshot: ProviderAccountSnapshot | undefined;
  error: string | undefined;
  private disposed = false;
  private revision = 0;
  private readonly cancellations = new Set<() => void>();
  private readonly quotaBatches = new Map<string, Promise<ProviderAccountQuota[]>>();
  private readonly quotaBackoff = new Map<string, { failures: number; until: number }>();
  private readonly quotaQueue: Array<{ run: () => void; cancel: () => void }> = [];
  private runningQuota = 0;
  private loginCancel: (() => void) | undefined;
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly codexHome: string, runtimeEnv: NodeJS.ProcessEnv, private readonly interaction: Interaction) {
    this.env = { ...runtimeEnv, CODEX_HOME: codexHome, OPENCODEX_HOME: path.join(codexHome, "azrael", "providers", "opencodex") };
    this.enabled = !!runtimeEnv.AZRAEL_PROVIDER_ACCOUNTS_HELPER && !!runtimeEnv.AZRAEL_PROVIDER_BUN;
  }

  async refresh(): Promise<ProviderAccountSnapshot> {
    const revision = ++this.revision;
    this.quotaBatches.clear();
    try {
      const snapshot = parseProviderSnapshot(await this.request("list"));
      if (revision === this.revision && !this.disposed) { this.snapshot = snapshot; this.error = undefined; }
      return this.snapshot ?? snapshot;
    } catch (error) {
      if (revision === this.revision && !this.disposed) this.error = error instanceof Error ? error.message : "Provider accounts unavailable.";
      throw error;
    }
  }
  async quota(providerId: string, accountId: string, force = false): Promise<ProviderAccountQuota> {
    this.assertAccount(providerId, accountId);
    const revision = this.revision;
    const key = JSON.stringify([revision, providerId, force]);
    let batch = this.quotaBatches.get(key);
    if (!batch) {
      batch = this.requestQuotaBatch(providerId, force).then(value => {
        if (!isRecord(value) || value.providerId !== providerId || !Array.isArray(value.quotas) || value.quotas.length > 1000) throw new Error("Invalid provider quota batch.");
        const seen = new Set<string>();
        return value.quotas.map(row => {
          if (!isRecord(row) || !id(row.accountId) || seen.has(row.accountId)) throw new Error("Invalid provider quota account.");
          seen.add(row.accountId);
          return parseProviderQuota(row, providerId, row.accountId);
        });
      });
      this.quotaBatches.set(key, batch);
    }
    const result = (await batch).find(row => row.accountId === accountId);
    if (!result || revision !== this.revision) throw new Error("Provider account list changed during usage refresh. Refresh again.");
    this.assertAccount(providerId, accountId);
    return result;
  }
  async setAutoSwitch(providerId: string, accountId: string, enabled: boolean): Promise<void> {
    this.assertAccount(providerId, accountId);
    const provider = this.snapshot?.providers.find(provider => provider.id === providerId);
    if (typeof enabled !== "boolean" || !provider?.inferenceConnected || provider.accounts.find(account => account.id === accountId)?.autoSwitchAvailable === false) throw new Error("Automatic account switching unavailable.");
    await this.request("setAutoSwitch", { providerId, accountId, enabled });
    await this.refresh();
  }
  async select(providerId: string, accountId: string): Promise<void> {
    this.assertAccount(providerId, accountId);
    await this.request("select", { providerId, accountId });
    await this.refresh();
  }
  async remove(providerId: string, accountId: string): Promise<void> {
    this.assertAccount(providerId, accountId);
    await this.request("remove", { providerId, accountId });
    await this.refresh();
  }
  async login(providerId: string, accountId?: string): Promise<void> {
    this.assertProvider(providerId, "oauth");
    if (accountId !== undefined) this.assertAccount(providerId, accountId);
    if (this.loginCancel) throw new Error("A provider login is already in progress.");
    await this.request("login", { providerId, ...(accountId === undefined ? {} : { accountId }) });
    await this.refresh();
  }
  cancelLogin(): void { this.loginCancel?.(); }
  dispose(): void {
    this.disposed = true;
    ++this.revision;
    this.quotaBatches.clear();
    for (const item of this.quotaQueue.splice(0)) item.cancel();
    for (const cancel of [...this.cancellations]) cancel();
  }
  private assertProvider(providerId: string, kind: string): void {
    if (!this.snapshot?.availableProviders.some(provider => provider.id === providerId && provider.authKind === kind)) throw new Error("Unknown provider.");
  }
  private assertAccount(providerId: string, accountId: string): void {
    if (!this.snapshot?.providers.find(provider => provider.id === providerId && provider.authKind === "oauth")?.accounts.some(account => account.id === accountId)) throw new Error("Unknown provider account. Refresh the page.");
  }

  private requestQuotaBatch(providerId: string, force: boolean): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const run = () => {
        if (this.disposed) { reject(new Error("Provider account operation canceled.")); return; }
        this.runningQuota++;
        const request = !force && Date.now() < (this.quotaBackoff.get(providerId)?.until ?? 0)
          ? Promise.reject(new Error("Provider usage refresh is temporarily backed off."))
          : this.request("quotaBatch", { providerId, force });
        void request.then(value => { this.quotaBackoff.delete(providerId); resolve(value); }, error => {
          const failures = Math.min(6, (this.quotaBackoff.get(providerId)?.failures ?? 0) + 1);
          this.quotaBackoff.set(providerId, { failures, until: Date.now() + Math.min(60_000, 5000 * 2 ** (failures - 1)) });
          reject(error);
        }).finally(() => { this.runningQuota--; this.quotaQueue.shift()?.run(); });
      };
      if (this.runningQuota < 2) run();
      else this.quotaQueue.push({ run, cancel: () => reject(new Error("Provider account operation canceled.")) });
    });
  }

  private request(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (this.disposed || !this.enabled) return Promise.reject(new Error("Provider account runtime unavailable. Install the matching Azrael release."));
    const executable = this.env.AZRAEL_PROVIDER_BUN!;
    const helper = this.env.AZRAEL_PROVIDER_ACCOUNTS_HELPER!;
    if (![executable, helper, this.codexHome].every(path.isAbsolute)) return Promise.reject(new Error("Provider account paths must be absolute."));
    const requestId = randomUUID();
    const startedAt = Date.now();
    const log = (phase: "start" | "complete" | "failed") => {
      try { this.interaction.log?.({ requestId, action, phase, elapsedMs: Date.now() - startedAt }); } catch { /* Diagnostics cannot fail an account operation. */ }
    };
    log("start");
    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      let settled = false;
      let buffer = "";
      let bytes = 0;
      let interactionPending = false;
      let timer: NodeJS.Timeout | undefined;
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.cancellations.delete(cancel);
        if (this.loginCancel === cancel) this.loginCancel = undefined;
        child?.stdin.destroy();
        child?.kill();
        log(error ? "failed" : "complete");
        if (error) reject(error); else resolve(value);
      };
      const cancel = () => finish(new Error("Provider account operation canceled."));
      const answer = async (frame: Record<string, unknown>) => {
        if (action !== "login" || interactionPending) return finish(new Error("Unexpected provider interaction."));
        interactionPending = true;
        try {
          let value: string | null;
          if (frame.type === "openUrl") {
            if (!text(frame.url)) throw new Error("Invalid provider login URL.");
            const url = new URL(frame.url);
            if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("Invalid provider login URL.");
            value = await this.interaction.openUrl(frame.url) ? "opened" : null;
          } else {
            if (!text(frame.prompt) || typeof frame.password !== "boolean") throw new Error("Invalid provider login prompt.");
            value = await this.interaction.prompt(frame.prompt, frame.password) ?? null;
          }
          if (!settled) child.stdin.write(JSON.stringify({ id: requestId, type: "answer", value }) + "\n");
        } catch { finish(new Error("Provider login interaction failed.")); }
        finally { interactionPending = false; }
      };
      try {
        child = spawn(executable, [helper], { env: this.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        this.cancellations.add(cancel);
        if (action === "login") this.loginCancel = cancel;
        timer = setTimeout(() => finish(new Error("Provider account operation timed out.")), action === "login" ? 300_000 : action === "quotaBatch" ? 60_000 : 30_000);
        child.stdout.setEncoding("utf8");
        child.stderr.resume(); // Upstream diagnostics may contain secrets; never forward them to UI/logs.
        child.stdin.on("error", () => finish(new Error("Provider account helper input closed.")));
        child.on("error", () => finish(new Error("Could not start the provider account runtime.")));
        child.on("close", () => { if (!settled) finish(new Error("Provider account helper ended without a result.")); });
        child.stdout.on("data", (chunk: string) => {
          if (settled) return;
          bytes += Buffer.byteLength(chunk);
          if (bytes > 2 * 1024 * 1024) return finish(new Error("Provider account response exceeded its limit."));
          buffer += chunk;
          let newline: number;
          while (!settled && (newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
            let frame: unknown;
            try { frame = JSON.parse(line); } catch { return finish(new Error("Invalid provider account protocol.")); }
            if (!isRecord(frame) || frame.id !== requestId) return finish(new Error("Provider account response identity mismatch."));
            if (frame.type === "result") finish(undefined, frame.value);
            else if (frame.type === "error") finish(new Error(text(frame.error) ? frame.error : "Provider account operation failed."));
            else if (frame.type === "openUrl" || frame.type === "prompt") void answer(frame);
            else finish(new Error("Unexpected provider account response."));
          }
        });
        child.stdin.write(JSON.stringify({ protocol: 1, id: requestId, action, ...params }) + "\n");
      } catch { finish(new Error("Could not start the provider account runtime.")); }
    });
  }
}

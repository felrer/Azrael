import { AccountUsage, RateLimitSnapshot } from "./protocol";

export interface UsageEntry {
  data: AccountUsage | null;
  lastSuccessAt: number | null;
  error: string | null;
  generation: number;
}

export interface UsageIdentity { profileId: string; workspaceAccountId: string }
export type UsageFetcher = (profileId: string, workspaceAccountId: string, includeDetails: boolean) => Promise<AccountUsage>;

export class UsageRefreshCoordinator {
  private entries = new Map<string, UsageEntry>();
  private generations = new Map<string, number>();
  private failures = new Map<string, number>();
  private nextAllowed = new Map<string, number>();
  private resetQueries = new Set<string>();
  private detailProfiles = new Set<string>();
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(private readonly fetcher: UsageFetcher, private readonly now: () => number = Date.now) {}

  get(profileId: string, workspaceAccountId: string): UsageEntry | undefined { return this.entries.get(identityKey(profileId, workspaceAccountId)); }

  async refresh(profileId: string, workspaceAccountId: string, includeDetails = false, force = false): Promise<UsageEntry> {
    const key = identityKey(profileId, workspaceAccountId);
    if (!force && this.now() < (this.nextAllowed.get(key) ?? 0)) {
      return this.entries.get(key) ?? { data: null, lastSuccessAt: null, error: "Refresh is temporarily backed off.", generation: this.generations.get(key) ?? 0 };
    }
    if (includeDetails) this.detailProfiles.add(key);
    const effectiveIncludeDetails = includeDetails || this.detailProfiles.has(key);
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    await this.acquire();
    try {
      const data = await this.fetcher(profileId, workspaceAccountId, effectiveIncludeDetails);
      if (this.generations.get(key) !== generation) return this.entries.get(key) ?? { data: null, lastSuccessAt: null, error: null, generation };
      const entry = { data, lastSuccessAt: this.now(), error: null, generation };
      this.entries.set(key, entry);
      this.failures.delete(key);
      this.nextAllowed.delete(key);
      return entry;
    } catch (error) {
      if (this.generations.get(key) !== generation) return this.entries.get(key) ?? { data: null, lastSuccessAt: null, error: null, generation };
      const failures = (this.failures.get(key) ?? 0) + 1;
      this.failures.set(key, failures);
      this.nextAllowed.set(key, this.now() + Math.min(60_000, 5_000 * 2 ** (failures - 1)));
      const prior = this.entries.get(key);
      const entry = { data: prior?.data ?? null, lastSuccessAt: prior?.lastSuccessAt ?? null, error: error instanceof Error ? error.message : String(error), generation };
      this.entries.set(key, entry);
      return entry;
    } finally { this.release(); }
  }

  dueResetProfiles(identities: UsageIdentity[]): UsageIdentity[] {
    const due: UsageIdentity[] = [];
    const nowSeconds = Math.floor(this.now() / 1000);
    for (const identity of identities) {
      const keyPrefix = identityKey(identity.profileId, identity.workspaceAccountId);
      const data = this.entries.get(keyPrefix)?.data;
      for (const reset of resetTimes(data)) {
        const key = `${keyPrefix}\0${reset}`;
        if (reset <= nowSeconds && !this.resetQueries.has(key)) {
          this.resetQueries.add(key);
          due.push(identity);
          break;
        }
      }
    }
    return due;
  }

  private acquire(): Promise<void> {
    if (this.running < 2) { this.running++; return Promise.resolve(); }
    return new Promise((resolve) => this.queue.push(() => { this.running++; resolve(); }));
  }
  private release(): void { this.running--; this.queue.shift()?.(); }
}

export function validateUsageForWorkspace(data: AccountUsage, workspaceAccountId: string): void {
  if (data.accountId !== null && data.accountId !== workspaceAccountId) {
    throw new Error("Usage response belonged to a different workspace account.");
  }
  for (const [limitId, snapshot] of Object.entries(data.rateLimitsByLimitId ?? {})) {
    if (snapshot.limitId !== null && snapshot.limitId !== limitId) {
      throw new Error("Usage response contained a mismatched limit identity.");
    }
  }
}

function identityKey(profileId: string, workspaceAccountId: string): string { return `${profileId}\0${workspaceAccountId}`; }

function snapshotResetTimes(snapshot: RateLimitSnapshot | null | undefined): number[] {
  return [snapshot?.primary?.resetsAt, snapshot?.secondary?.resetsAt].filter((x): x is number => typeof x === "number");
}

function resetTimes(data: AccountUsage | null | undefined): number[] {
  if (!data) return [];
  const times = snapshotResetTimes(data.rateLimits);
  for (const snapshot of Object.values(data.rateLimitsByLimitId ?? {})) times.push(...snapshotResetTimes(snapshot));
  return [...new Set(times)];
}

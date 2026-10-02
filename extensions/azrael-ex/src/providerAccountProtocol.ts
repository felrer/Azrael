export type ProviderQuotaMode = "probe" | "passive" | "unsupported";
export interface ProviderAccount {
  id: string;
  label: string;
  selected: boolean;
  needsReauth: boolean;
}
export interface ManagedProvider {
  id: string;
  label: string;
  authKind: "oauth";
  quotaMode: ProviderQuotaMode;
  inferenceConnected: boolean;
  accounts: ProviderAccount[];
}
export interface ProviderAccountSnapshot {
  providers: ManagedProvider[];
  availableProviders: Array<{ id: string; label: string; authKind: "oauth" }>;
}
export interface ProviderQuotaRow {
  label: string;
  usedPercent?: number;
  used?: number;
  limitUnset?: boolean;
  remaining?: number;
  limit?: number;
  unit?: string;
  unlimited?: boolean;
  /** Unix seconds, matching the native usage presentation contract. */
  resetsAt?: number;
}
export interface ProviderAccountQuota {
  providerId: string;
  accountId: string;
  status: "ok" | "unsupported" | "error";
  source: string;
  observedAt: number;
  rows: ProviderQuotaRow[];
  error?: string;
}
export interface ProviderAccountsBackend {
  readonly enabled: boolean;
  readonly snapshot: ProviderAccountSnapshot | undefined;
  readonly error: string | undefined;
  refresh(): Promise<ProviderAccountSnapshot>;
  quota(providerId: string, accountId: string, force?: boolean): Promise<ProviderAccountQuota>;
  select(providerId: string, accountId: string): Promise<void>;
  remove(providerId: string, accountId: string): Promise<void>;
  login(providerId: string, accountId?: string): Promise<void>;
  cancelLogin(): void;
  dispose(): void;
}

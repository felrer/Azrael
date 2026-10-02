export const ACCOUNT_METHOD = "azrael/account";
export const ACCOUNT_UPDATED_METHOD = "azrael/account/updated";

export type AccountAction =
  | "list" | "captureCurrent" | "loginStart" | "loginCancel"
  | "remove" | "switch" | "cancelSwitch" | "usage" | "consumeResetCredit";

export interface AccountParams {
  action: AccountAction;
  profileId?: string;
  loginId?: string;
  includeDetails?: boolean;
  idempotencyKey?: string;
}

export interface AccountProfile {
  id: string;
  email: string | null;
  workspaceAccountId: string;
  userId: string;
  planType: string | null;
}

export interface AccountState {
  instanceId: string;
  revision: number;
  codexHome: string;
  profiles: AccountProfile[];
  currentAccount: unknown | null;
  activeProfileId: string | null;
  pendingProfileId: string | null;
  isSwitching: boolean;
  hasActiveTurns: boolean;
  loginPending: boolean;
  lastError: string | null;
}

export interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface RateLimitSnapshot {
  limitId: string | null;
  limitName: string | null;
  normalModelSlug: string | null;
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  credits: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null;
  individualLimit: unknown | null;
  spendControlReached: boolean | null;
  planType: string | null;
  rateLimitReachedType: string | null;
}

export interface AccountUsage {
  ordinaryUsageAllowed: boolean | null;
  rateLimits: RateLimitSnapshot;
  rateLimitsByLimitId: Record<string, RateLimitSnapshot> | null;
  rateLimitResetCredits: {
    availableCount: number;
    credits: Array<{
      id: string;
      resetType: string;
      status: string;
      grantedAt: number;
      expiresAt: number | null;
      title: string | null;
      description: string | null;
    }> | null;
  } | null;
  accountId: string | null;
  rateLimitUpsell: unknown | null;
}

export interface AccountResponse {
  state: AccountState;
  login: { loginId: string; authUrl: string } | null;
  usage: AccountUsage | null;
  usageProfileId: string | null;
  resetCreditOutcome?: ResetCreditOutcome;
}

export type ResetCreditOutcome = "reset" | "nothingToReset" | "noCredit" | "alreadyRedeemed";

export interface ConnectedNotice {
  codexHome: string;
  serverVersion: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isProfileId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
}

export function parseAccountResponse(value: unknown): AccountResponse {
  if (!isRecord(value) || !isRecord(value.state)) throw new Error("invalid account response");
  const state = value.state;
  if (typeof state.instanceId !== "string" || state.instanceId.length === 0 ||
      !Number.isInteger(state.revision) || (state.revision as number) < 0 ||
      typeof state.codexHome !== "string" || !Array.isArray(state.profiles)) {
    throw new Error("invalid account state identity");
  }
  for (const profile of state.profiles) {
    if (!isRecord(profile) || !isProfileId(profile.id) || typeof profile.workspaceAccountId !== "string" || typeof profile.userId !== "string") {
      throw new Error("invalid account profile");
    }
  }
  if ((state.activeProfileId !== null && !isProfileId(state.activeProfileId)) ||
      (state.pendingProfileId !== null && !isProfileId(state.pendingProfileId))) {
    throw new Error("invalid selected profile identity");
  }
  if (value.usageProfileId !== null && value.usageProfileId !== undefined && !isProfileId(value.usageProfileId)) {
    throw new Error("invalid usage profile identity");
  }
  if (value.resetCreditOutcome !== undefined && !["reset", "nothingToReset", "noCredit", "alreadyRedeemed"].includes(String(value.resetCreditOutcome))) {
    throw new Error("invalid reset credit outcome");
  }
  return value as unknown as AccountResponse;
}

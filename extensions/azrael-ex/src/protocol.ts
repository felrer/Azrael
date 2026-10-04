import { isDeepStrictEqual } from "node:util";

export const ACCOUNT_METHOD = "azrael/account";
export const ACCOUNT_UPDATED_METHOD = "azrael/account/updated";

export type AccountAction =
  | "list" | "captureCurrent" | "loginStart" | "loginCancel"
  | "remove" | "switch" | "cancelSwitch" | "usage" | "consumeResetCredit"
  | "autoSwitchEnable" | "autoSwitchDisable"
  | "autoWindowStatus" | "autoWindowEnable" | "autoWindowDisable" | "autoWindowTick";

export interface AccountParams {
  action: AccountAction;
  profileId?: string;
  loginId?: string;
  includeDetails?: boolean;
  idempotencyKey?: string;
  creditId?: string;
}

export interface AccountProfile {
  id: string;
  email: string | null;
  workspaceAccountId: string;
  userId: string;
  planType: string | null;
  autoSwitchAllowed?: boolean;
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

export function accountStateChanged(current: AccountState | undefined, candidate: AccountState): boolean {
  if (!current) return true;
  const { revision: _currentRevision, ...currentFields } = current;
  const { revision: _candidateRevision, ...candidateFields } = candidate;
  return !isDeepStrictEqual(currentFields, candidateFields);
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
  autoWindows?: UsageWindowSchedule[] | null;
}

export interface UsageWindowSchedule {
  profileId: string;
  workspaceAccountId: string;
  userId: string;
  enabled: boolean;
  nextRunAt: number | null;
  basisResetAt: number | null;
  lastAttemptAt: number | null;
  status: "disabled" | "scheduled" | "checking" | "confirming" | "started" | "unconfirmed" | "blocked" | "error";
  error: string | null;
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
    if (!isRecord(profile) || !isProfileId(profile.id) || typeof profile.workspaceAccountId !== "string" || typeof profile.userId !== "string" ||
        (profile.autoSwitchAllowed !== undefined && typeof profile.autoSwitchAllowed !== "boolean")) {
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
  if (value.autoWindows !== undefined && value.autoWindows !== null) {
    if (!Array.isArray(value.autoWindows)) throw new Error("invalid automatic window schedules");
    const identities = new Set<string>();
    for (const schedule of value.autoWindows) {
      if (!isRecord(schedule) || !isProfileId(schedule.profileId)
        || typeof schedule.workspaceAccountId !== "string" || !schedule.workspaceAccountId
        || typeof schedule.userId !== "string" || !schedule.userId
        || typeof schedule.enabled !== "boolean"
        || !["disabled", "scheduled", "checking", "confirming", "started", "unconfirmed", "blocked", "error"].includes(String(schedule.status))
        || (schedule.error !== null && typeof schedule.error !== "string")
        || [schedule.nextRunAt, schedule.basisResetAt, schedule.lastAttemptAt].some(time => time !== null && (typeof time !== "number" || !Number.isSafeInteger(time) || time < 0))) {
        throw new Error("invalid automatic window schedule");
      }
      const identity = JSON.stringify([schedule.workspaceAccountId, schedule.userId]);
      if (identities.has(identity)) throw new Error("duplicate automatic window account identity");
      identities.add(identity);
    }
  }
  return value as unknown as AccountResponse;
}

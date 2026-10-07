import { randomUUID } from "node:crypto";
import type { Memento } from "vscode";
import { AccountService } from "./accountService";
import { AccountProfile, isRecord, ResetCreditOutcome } from "./protocol";
import { validateUsageForWorkspace } from "./usageRefresh";

const STORAGE_KEY = "azrael.usage.resetCreditAttempts";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ResetCreditAttempt { id: string; creditId?: string }

/** Keeps one logical attempt's identity across uncertain transport results and restarts. */
export class ResetCreditService {
  private readonly attempts = new Map<string, ResetCreditAttempt>();
  private readonly pending = new Set<string>();

  constructor(private readonly service: AccountService, private readonly storage?: Memento) {
    const saved: unknown = storage?.get(STORAGE_KEY);
    if (Array.isArray(saved)) for (const entry of saved) {
      if (isRecord(entry) && typeof entry.identity === "string" && typeof entry.id === "string" && UUID.test(entry.id)) {
        if (entry.creditId !== undefined && (typeof entry.creditId !== "string" || entry.creditId.trim().length === 0)) {
          throw new Error("저장된 리셋 티켓 요청의 티켓 ID를 확인할 수 없습니다.");
        }
        this.attempts.set(entry.identity, { id: entry.id, ...(entry.creditId === undefined ? {} : { creditId: entry.creditId as string }) });
      }
    }
  }

  busy(profile: AccountProfile): boolean { return this.pending.has(this.identity(profile)); }
  retrying(profile: AccountProfile): boolean { return this.attempts.has(this.identity(profile)); }
  retryCreditId(profile: AccountProfile): string | undefined { return this.attempts.get(this.identity(profile))?.creditId; }

  async consume(profile: AccountProfile, creditId: string): Promise<ResetCreditOutcome> {
    const identity = this.identity(profile);
    if (this.pending.has(identity)) throw new Error("리셋 티켓 사용 요청이 이미 진행 중입니다.");
    this.pending.add(identity);
    try {
      this.validateProfile(profile);
      if (typeof creditId !== "string" || creditId.trim().length === 0) throw new Error("사용할 리셋 티켓 ID를 확인할 수 없습니다.");
      let attempt = this.attempts.get(identity);
      if (attempt && attempt.creditId === undefined) {
        throw new Error("이전 리셋 티켓 요청의 대상 ID를 확인할 수 없어 선택한 티켓을 사용할 수 없습니다. 이전 요청 결과를 먼저 확인해 주세요.");
      }
      if (attempt && attempt.creditId !== creditId) {
        throw new Error("처리 결과가 확인되지 않은 다른 리셋 티켓 요청이 있습니다. 해당 티켓을 먼저 다시 시도해 주세요.");
      }
      if (!attempt) {
        const response = await this.service.call({ action: "usage", profileId: profile.id, includeDetails: true });
        this.validateProfile(profile);
        if (response.usageProfileId !== profile.id || !response.usage) throw new Error("리셋 티켓 조회 계정을 확인할 수 없습니다.");
        validateUsageForWorkspace(response.usage, profile.workspaceAccountId);
        const tickets = response.usage.rateLimitResetCredits;
        if (!tickets || !Number.isSafeInteger(tickets.availableCount) || !Array.isArray(tickets.credits)) {
          throw new Error("리셋 티켓 상세 목록을 확인할 수 없습니다.");
        }
        const matches = tickets.credits.filter(credit => isRecord(credit) && credit.id === creditId);
        if (matches.length > 1) throw new Error("선택한 리셋 티켓의 상세 정보가 중복되어 확인할 수 없습니다.");
        const credit = matches[0];
        if (tickets.availableCount <= 0 || !credit || credit.status !== "available" || credit.resetType !== "codexRateLimits"
          || !Number.isSafeInteger(credit.grantedAt)
          || (credit.expiresAt !== null && (!Number.isSafeInteger(credit.expiresAt) || credit.expiresAt <= Date.now() / 1000))) return "noCredit";
        attempt = { id: randomUUID(), creditId: credit.id };
        this.attempts.set(identity, attempt);
      }
      // Persist before dispatch; a failed write must never send a spend request.
      await this.save();
      this.validateProfile(profile);
      const response = await this.service.call({ action: "consumeResetCredit", profileId: profile.id, idempotencyKey: attempt.id,
        creditId: attempt.creditId });
      if (!response.resetCreditOutcome) throw new Error("리셋 티켓 사용 결과를 확인할 수 없습니다.");
      this.attempts.delete(identity);
      try { await this.save(); }
      catch { this.attempts.set(identity, attempt); } // A subsequent click safely replays this attempt.
      return response.resetCreditOutcome;
    } finally { this.pending.delete(identity); }
  }

  private identity(profile: AccountProfile): string { return JSON.stringify([profile.id, profile.workspaceAccountId]); }
  private validateProfile(profile: AccountProfile): void {
    if (!this.service.state?.profiles.some(item => item.id === profile.id && item.workspaceAccountId === profile.workspaceAccountId && item.userId === profile.userId)) {
      throw new Error("리셋 티켓 사용 대상 계정이 변경되었거나 제거되었습니다.");
    }
  }
  private async save(): Promise<void> {
    await this.storage?.update(STORAGE_KEY, [...this.attempts].map(([identity, attempt]) => ({ identity, ...attempt })));
  }
}

export function resetCreditMessage(outcome: ResetCreditOutcome): string {
  switch (outcome) {
    case "reset": return "리셋 티켓을 사용해 한도를 초기화했습니다.";
    case "alreadyRedeemed": return "이 사용 요청은 이미 처리되었습니다.";
    case "nothingToReset": return "현재 초기화할 한도가 없습니다.";
    case "noCredit": return "사용할 수 있는 리셋 티켓이 없습니다.";
  }
}

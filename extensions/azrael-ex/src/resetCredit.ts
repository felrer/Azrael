import { randomUUID } from "node:crypto";
import type { Memento } from "vscode";
import { AccountService } from "./accountService";
import { AccountProfile, isRecord, ResetCreditOutcome } from "./protocol";

const STORAGE_KEY = "azrael.usage.resetCreditAttempts";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Keeps one logical attempt's identity across uncertain transport results and restarts. */
export class ResetCreditService {
  private readonly attempts = new Map<string, string>();
  private readonly pending = new Set<string>();

  constructor(private readonly service: AccountService, private readonly storage?: Memento) {
    const saved: unknown = storage?.get(STORAGE_KEY);
    if (Array.isArray(saved)) for (const entry of saved) {
      if (isRecord(entry) && typeof entry.identity === "string" && typeof entry.id === "string" && UUID.test(entry.id)) {
        this.attempts.set(entry.identity, entry.id);
      }
    }
  }

  busy(profile: AccountProfile): boolean { return this.pending.has(this.identity(profile)); }
  retrying(profile: AccountProfile): boolean { return this.attempts.has(this.identity(profile)); }

  async consume(profile: AccountProfile): Promise<ResetCreditOutcome> {
    const identity = this.identity(profile);
    if (this.pending.has(identity)) throw new Error("리셋 티켓 사용 요청이 이미 진행 중입니다.");
    this.pending.add(identity);
    try {
      const id = this.attempts.get(identity) ?? randomUUID();
      this.attempts.set(identity, id);
      // Persist before dispatch; a failed write must never send a spend request.
      await this.save();
      const response = await this.service.call({ action: "consumeResetCredit", profileId: profile.id, idempotencyKey: id });
      if (!response.resetCreditOutcome) throw new Error("리셋 티켓 사용 결과를 확인할 수 없습니다.");
      this.attempts.delete(identity);
      try { await this.save(); }
      catch { this.attempts.set(identity, id); } // A subsequent click safely replays this attempt.
      return response.resetCreditOutcome;
    } finally { this.pending.delete(identity); }
  }

  private identity(profile: AccountProfile): string { return JSON.stringify([profile.id, profile.workspaceAccountId]); }
  private async save(): Promise<void> {
    await this.storage?.update(STORAGE_KEY, [...this.attempts].map(([identity, id]) => ({ identity, id })));
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

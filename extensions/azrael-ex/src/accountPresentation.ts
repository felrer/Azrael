import { AccountState } from "./protocol";

export class SwitchCompletionTracker {
  private settledActiveProfileId: string | null | undefined;
  private observedPending = false;

  observe(state: AccountState): boolean {
    if (state.isSwitching || state.pendingProfileId !== null) {
      if (this.settledActiveProfileId === undefined) this.settledActiveProfileId = state.activeProfileId;
      this.observedPending = true;
      return false;
    }
    const activeChanged = this.settledActiveProfileId !== undefined && this.settledActiveProfileId !== state.activeProfileId;
    const completed = this.settledActiveProfileId !== undefined && (this.observedPending || activeChanged);
    this.settledActiveProfileId = state.activeProfileId;
    this.observedPending = false;
    return completed;
  }
}

export function accountWarning(transportError: string | undefined, state: AccountState | undefined): string | undefined {
  return transportError ?? state?.lastError ?? undefined;
}

import { EventEmitter } from "node:events";
import type { AccountParams, AccountProfile, AccountResponse, AccountState, UsageWindowSchedule } from "./protocol";

export interface UsageWindowBackend {
  state: AccountState | undefined;
  readonly changesEnabled: boolean;
  call(params: AccountParams): Promise<AccountResponse>;
  on(event: "state", listener: () => void): unknown;
  off(event: "state", listener: () => void): unknown;
}

/** The engine owns scheduling and inference; this service only drives its shared queue. */
export class UsageWindowService extends EventEmitter {
  schedules: UsageWindowSchedule[] = [];
  error: string | undefined;
  private readonly backend: UsageWindowBackend;
  private timer: NodeJS.Timeout | undefined;
  private disposed = false;
  private cycles = 0;
  private tail: Promise<void> = Promise.resolve();
  private readonly pending = new Map<string, Promise<void>>();
  private lastRequestKey: string | undefined;
  private readonly stateListener = () => this.start();

  constructor(backend: UsageWindowBackend) {
    super();
    this.backend = backend;
    backend.on("state", this.stateListener);
    this.start();
  }

  forProfile(profile: AccountProfile): UsageWindowSchedule | undefined {
    return this.schedules.find(item => item.workspaceAccountId === profile.workspaceAccountId && item.userId === profile.userId);
  }

  refresh(): Promise<void> { return this.request({ action: "autoWindowStatus" }); }

  setEnabled(profileId: string, workspaceAccountId: string, enabled: boolean): Promise<void> {
    return this.request({ action: enabled ? "autoWindowEnable" : "autoWindowDisable", profileId }, workspaceAccountId);
  }

  /** Four idle timer cycles also discover schedules enabled by another window. */
  async poll(): Promise<void> {
    if (this.disposed) return;
    ++this.cycles;
    if (!this.backend.changesEnabled || this.pending.size) return;
    if (this.cycles >= 4) {
      this.cycles = 0;
      await this.refresh();
    }
    if (!this.disposed && this.schedules.some(item => item.enabled)) await this.request({ action: "autoWindowTick" });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.timer);
    this.timer = undefined;
    this.backend.off("state", this.stateListener);
    this.removeAllListeners();
  }

  private start(): void {
    if (this.disposed || this.timer || !this.backend.state || !this.backend.changesEnabled) return;
    this.timer = setInterval(() => { void this.poll(); }, 15_000);
    void this.refresh();
  }

  private request(params: AccountParams, workspaceAccountId?: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const key = JSON.stringify([params.action, params.profileId, workspaceAccountId]);
    const existing = this.lastRequestKey === key ? this.pending.get(key) : undefined;
    if (existing) return existing;
    this.lastRequestKey = key;
    const operation = this.tail.then(async () => {
      if (this.disposed) return;
      try {
        if (!this.backend.changesEnabled) throw new Error("unverified");
        const profile = params.profileId === undefined ? undefined : this.backend.state?.profiles.find(item => item.id === params.profileId && item.workspaceAccountId === workspaceAccountId);
        if (params.profileId !== undefined && !profile) throw new Error("identity changed");
        const response = await this.backend.call(params);
        if (this.disposed) return;
        if (!Array.isArray(response.autoWindows)) throw new Error("missing schedules");
        if (profile) {
          const live = this.backend.state?.profiles.find(item => item.id === profile.id);
          if (!live || live.workspaceAccountId !== profile.workspaceAccountId || live.userId !== profile.userId) throw new Error("identity changed");
          const schedule = response.autoWindows.find(item => item.workspaceAccountId === profile.workspaceAccountId && item.userId === profile.userId);
          if (!schedule || schedule.enabled !== (params.action === "autoWindowEnable")) throw new Error("schedule identity mismatch");
        }
        this.schedules = response.autoWindows;
        this.error = undefined;
      } catch {
        if (this.disposed) return;
        // Transport diagnostics can contain credentials; display only this safe service error.
        this.error = "자동 타이머 상태를 확인하지 못했습니다. 연결과 계정 인증을 확인한 뒤 다시 갱신하세요.";
      }
      this.emit("change");
    }).finally(() => { if (this.pending.get(key) === operation) this.pending.delete(key); });
    this.pending.set(key, operation);
    this.tail = operation;
    return operation;
  }
}

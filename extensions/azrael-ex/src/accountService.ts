import * as path from "node:path";
import { EventEmitter } from "node:events";
import { BridgeTransport, BridgeError, BridgeDiagnostic, EngineReadinessHook } from "./bridgeTransport";
import { DevinAction, DevinStatus, parseDevinStatus } from "./devinProtocol";
import { PROJECT_USAGE_METHOD, parseProjectUsageSnapshot, validateProjectUsageYear } from "./projectUsageProtocol";
import type { ProjectUsageSnapshot } from "./projectUsagePresentation";
import {
  ACCOUNT_METHOD, ACCOUNT_UPDATED_METHOD, AccountAction, AccountParams,
  AccountResponse, AccountState, parseAccountResponse, isRecord, accountStateChanged
} from "./protocol";
import {
  ROOT_RESUME_METHOD, ROOT_RESUME_UPDATED_METHOD, RootResumeParams,
  RootResumeReservation, RootResumeResponse, parseRootResumeResponse
} from "./rootResumeProtocol";

const MUTATIONS = new Set<AccountAction>(["captureCurrent", "loginStart", "loginCancel", "remove", "switch", "cancelSwitch", "consumeResetCredit", "autoWindowEnable", "autoWindowDisable", "autoWindowTick", "autoSwitchEnable", "autoSwitchDisable"]);

export interface AccountServiceOptions {
  executable: string;
  socket: string;
  codexHome: string;
  expectedServerVersion: string;
  env: NodeJS.ProcessEnv;
  reconnectDelaysMs?: number[];
  startupTimeoutMs?: number;
  waitForEngineReady?: EngineReadinessHook;
  onDiagnostic?: (event: BridgeDiagnostic) => void;
}

export class AccountService extends EventEmitter {
  private transport: BridgeTransport | undefined;
  private transportVerified = false;
  private instanceId: string | undefined;
  private disposed = false;
  private connecting: Promise<AccountState> | undefined;
  private startupAbort: AbortController | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private retryReject: ((error: Error) => void) | undefined;
  state: AccountState | undefined;
  rootResumeReservations: RootResumeReservation[] | undefined;
  private rootResumeRequestRevision = 0;
  private rootResumeAppliedRevision = 0;
  error: string | undefined;

  constructor(private readonly options: AccountServiceOptions) { super(); }

  get changesEnabled(): boolean { return Boolean(this.transport && this.transportVerified && this.instanceId && this.state && !this.error); }
  get rootResumeAvailable(): boolean { return Boolean(this.transport && this.transportVerified && this.instanceId); }

  connect(): Promise<AccountState> {
    if (this.disposed) return Promise.reject(new Error("Account service is disposed."));
    if (!this.connecting) {
      let connecting: Promise<AccountState>;
      connecting = this.connectWithRetries().finally(() => {
        if (this.connecting === connecting) this.connecting = undefined;
      });
      this.connecting = connecting;
    }
    return this.connecting;
  }

  /** Called only after the owning app-server supervisor completed a fresh handshake. */
  async reconnectAfterEngineRestart(): Promise<AccountState> {
    await this.connecting?.catch(() => undefined);
    if (this.disposed) throw new Error("Account service is disposed.");
    const previous = this.transport;
    this.transport = undefined;
    this.transportVerified = false;
    previous?.dispose();
    this.instanceId = undefined;
    this.state = undefined;
    this.rootResumeReservations = undefined;
    this.error = undefined;
    this.emit("rootResumeConnection", false);
    return this.connect();
  }

  async call(params: AccountParams): Promise<AccountResponse> {
    if (!this.transport) throw new Error("Account bridge is disconnected.");
    if (MUTATIONS.has(params.action) && !this.changesEnabled) throw new Error("Account changes are disabled until the engine identity is verified.");
    const response = parseAccountResponse(await this.transport.request(ACCOUNT_METHOD, params));
    const automatic = params.action.startsWith("autoWindow");
    return { ...response, state: this.acceptState(response.state, !automatic || accountStateChanged(this.state, response.state)) };
  }

  async refresh(reconnect = false): Promise<AccountState> {
    if (reconnect && (!this.transport || !this.transportVerified)) return this.connect();
    return (await this.call({ action: "list" })).state;
  }

  async projectUsage(year: number): Promise<ProjectUsageSnapshot> {
    validateProjectUsageYear(year);
    if (!this.transport || !this.transportVerified || !this.instanceId) throw new Error("The engine connection has not been verified.");
    const transport = this.transport;
    const instanceId = this.instanceId;
    const response = await transport.request(PROJECT_USAGE_METHOD, { year });
    if (this.transport !== transport || !this.transportVerified || this.instanceId !== instanceId) throw new Error("The engine connection changed during project usage refresh.");
    return parseProjectUsageSnapshot(response, year);
  }

  async rootResume(params: RootResumeParams): Promise<RootResumeResponse> {
    if (!this.transport || !this.transportVerified || !this.instanceId) throw new Error("The engine connection has not been verified.");
    const transport = this.transport;
    const revision = ++this.rootResumeRequestRevision;
    const response = parseRootResumeResponse(await transport.request(ROOT_RESUME_METHOD, params));
    if (this.transport !== transport || !this.transportVerified) throw new Error("The management connection changed during reservation refresh.");
    if (revision > this.rootResumeAppliedRevision) {
      this.rootResumeAppliedRevision = revision;
      this.rootResumeReservations = response.reservations;
      this.emit("rootResume", response.reservations);
    }
    return response;
  }

  async canReleaseConversationWebview(): Promise<boolean> {
    const transport = this.transport;
    const instanceId = this.instanceId;
    if (!transport || !this.transportVerified || !instanceId) return false;
    try {
      const response = parseRootResumeResponse(await transport.request(ROOT_RESUME_METHOD, { action: "list" }));
      return this.transport === transport && this.transportVerified && this.instanceId === instanceId &&
        response.reservations.every(reservation => reservation.state === "resumed" || reservation.state === "cancelled");
    } catch { return false; }
  }

  async devin(action: DevinAction): Promise<DevinStatus> {
    if (!this.transport || !this.transportVerified || !this.instanceId) throw new Error("The engine connection has not been verified.");
    return parseDevinStatus(await this.transport.request("azrael/devin", { action }, action === "login" ? 210_000 : 65_000));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.startupAbort?.abort();
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    const rejectRetry = this.retryReject;
    this.retryReject = undefined;
    rejectRetry?.(new Error("Account service is disposed."));
    this.transport?.dispose();
    this.transport = undefined;
    this.transportVerified = false;
    this.emit("rootResumeConnection", false);
  }

  private async connectWithRetries(): Promise<AccountState> {
    const deadline = performance.now() + (this.options.startupTimeoutMs ?? 70_000);
    const remaining = () => Math.max(0, deadline - performance.now());
    const abort = new AbortController();
    this.startupAbort = abort;
    const timer = setTimeout(() => abort.abort(), remaining());
    let retries = 0;
    try {
      if (this.options.waitForEngineReady) {
        await new Promise<void>((resolve, reject) => {
          const cancel = () => reject(this.disposed ? new Error("Account service is disposed.") : new BridgeError("connect", "timeout", true));
          abort.signal.addEventListener("abort", cancel, { once: true });
          Promise.resolve().then(() => this.options.waitForEngineReady!(remaining(), abort.signal)).then(resolve, () => reject(new BridgeError("connect", "internal", false))).finally(() => abort.signal.removeEventListener("abort", cancel));
        });
      }
      while (true) {
        if (remaining() <= 0 || abort.signal.aborted) throw new BridgeError("connect", "timeout", true);
        try { return await this.connectOnce(remaining, retries + 1); }
        catch (error) {
          if (this.disposed) throw new Error("Account service is disposed.");
          const explicitDelays = this.options.reconnectDelaysMs;
          if (error instanceof IdentityMismatchError || (error instanceof BridgeError && (!error.retryable || error.code === "permission_denied" || error.code === "protocol_error")) ||
              remaining() <= 0 || (explicitDelays && retries >= explicitDelays.length)) throw error;
          const delay = explicitDelays ? explicitDelays[retries] : Math.min(4_000, 1_000 * 2 ** Math.min(retries, 2));
          retries++;
          await this.waitForRetry(Math.min(delay, remaining()));
        }
      }
    } catch (error) {
      if (this.disposed) throw new Error("Account service is disposed.");
      this.error = error instanceof Error ? error.message : "Bridge connection failed.";
      this.emit("errorState", this.error);
      throw error;
    } finally {
      clearTimeout(timer);
      if (this.startupAbort === abort) this.startupAbort = undefined;
    }
  }

  private waitForRetry(delayMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.disposed) { reject(new Error("Account service is disposed.")); return; }
      this.retryReject = reject;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        this.retryReject = undefined;
        resolve();
      }, delayMs);
    });
  }

  private async connectOnce(remaining: () => number, attempt: number): Promise<AccountState> {
    this.transport?.dispose();
    this.transportVerified = false;
    const transport = new BridgeTransport({
      executable: this.options.executable,
      socket: this.options.socket,
      env: this.options.env,
      startupTimeoutMs: Math.min(65_000, remaining()),
      attempt, onDiagnostic: this.options.onDiagnostic
    });
    this.transport = transport;
    transport.on("notification", (method: string, params: unknown) => {
      if (this.transport !== transport || !this.transportVerified) return;
      if (method === ACCOUNT_UPDATED_METHOD && isRecord(params)) {
        const candidate = isRecord(params.state) ? params.state : params;
        try { this.acceptState(parseAccountResponse({ state: candidate, login: null, usage: null, usageProfileId: null }).state); }
        catch { /* Invalid notifications never alter verified state. */ }
      } else if (method === ROOT_RESUME_UPDATED_METHOD) {
        try {
          const response = parseRootResumeResponse(params);
          this.rootResumeAppliedRevision = ++this.rootResumeRequestRevision;
          this.rootResumeReservations = response.reservations;
          this.emit("rootResume", response.reservations);
        } catch { /* Invalid notifications never alter verified state. */ }
      }
    });
    transport.on("disconnect", (error: Error) => this.onDisconnect(transport, error));
    try {
      const connected = await transport.start();
      if (!samePath(connected.codexHome, this.options.codexHome)) throw new IdentityMismatchError("Bridge CODEX_HOME does not match this azrael-ex instance.");
      if (connected.serverVersion !== this.options.expectedServerVersion) throw new IdentityMismatchError("Unsupported engine version for this release.");
      if (remaining() <= 0) throw new BridgeError("connect", "timeout", true);
      const raw = await transport.request(ACCOUNT_METHOD, { action: "list" }, remaining());
      let response: AccountResponse;
      try { response = parseAccountResponse(raw); } catch { throw new BridgeError("protocol", "protocol_error", false); }
      if (!samePath(response.state.codexHome, this.options.codexHome)) throw new IdentityMismatchError("Account state belongs to a different CODEX_HOME.");
      if (this.instanceId && response.state.instanceId !== this.instanceId) throw new IdentityMismatchError("Reconnected bridge belongs to a different engine instance.");
      if (this.transport !== transport) throw new Error("Bridge disconnected during identity verification.");
      this.instanceId ??= response.state.instanceId;
      this.state = selectStateByRevision(this.state, response.state);
      this.error = undefined;
      this.transportVerified = true;
      this.emit("rootResumeConnection", true);
      this.emit("state", this.state);
      return response.state;
    } catch (error) {
      if (this.transport === transport) this.transport = undefined;
      this.transportVerified = false;
      transport.dispose();
      throw error;
    }
  }

  private acceptState(state: AccountState, notify = true): AccountState {
    if (!samePath(state.codexHome, this.options.codexHome)) throw new Error("Account response CODEX_HOME changed.");
    if (!this.instanceId || state.instanceId !== this.instanceId) {
      this.error = "Account response came from a different engine instance.";
      this.emit("errorState", this.error);
      throw new Error(this.error);
    }
    const selected = selectStateByRevision(this.state, state);
    if (selected !== state) return selected;
    this.state = selected;
    this.error = undefined;
    if (notify) this.emit("state", state);
    return state;
  }

  private onDisconnect(source: BridgeTransport, error: Error): void {
    if (this.transport !== source || this.disposed) return;
    this.transport = undefined;
    this.transportVerified = false;
    this.emit("rootResumeConnection", false);
    if (this.state) this.emit("state", this.state);
    if (!this.connecting && error instanceof BridgeError && (!error.retryable || error.code === "permission_denied" || error.code === "protocol_error")) {
      this.error = error.message;
      this.emit("errorState", this.error);
    } else if (!this.connecting) void this.connect().catch(() => undefined);
  }
}

class IdentityMismatchError extends Error {}

export function selectStateByRevision(current: AccountState | undefined, candidate: AccountState): AccountState {
  return current && candidate.revision < current.revision ? current : candidate;
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left).replace(/[\\/]+$/, "");
  const b = path.resolve(right).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

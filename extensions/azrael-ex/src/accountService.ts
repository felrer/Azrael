import * as path from "node:path";
import { EventEmitter } from "node:events";
import { BridgeTransport } from "./bridgeTransport";
import { DevinAction, DevinStatus, parseDevinStatus } from "./devinProtocol";
import {
  ACCOUNT_METHOD, ACCOUNT_UPDATED_METHOD, AccountAction, AccountParams,
  AccountResponse, AccountState, parseAccountResponse, isRecord
} from "./protocol";
import {
  ROOT_RESUME_METHOD, ROOT_RESUME_UPDATED_METHOD, RootResumeParams,
  RootResumeReservation, RootResumeResponse, parseRootResumeResponse
} from "./rootResumeProtocol";

const MUTATIONS = new Set<AccountAction>(["captureCurrent", "loginStart", "loginCancel", "remove", "switch", "cancelSwitch", "consumeResetCredit"]);

export interface AccountServiceOptions {
  executable: string;
  socket: string;
  codexHome: string;
  expectedServerVersion: string;
  env: NodeJS.ProcessEnv;
  reconnectDelaysMs?: number[];
}

export class AccountService extends EventEmitter {
  private transport: BridgeTransport | undefined;
  private transportVerified = false;
  private instanceId: string | undefined;
  private disposed = false;
  private connecting: Promise<AccountState> | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private retryReject: ((error: Error) => void) | undefined;
  state: AccountState | undefined;
  rootResumeReservations: RootResumeReservation[] | undefined;
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

  async call(params: AccountParams): Promise<AccountResponse> {
    if (!this.transport) throw new Error("Account bridge is disconnected.");
    if (MUTATIONS.has(params.action) && !this.changesEnabled) throw new Error("Account changes are disabled until the engine identity is verified.");
    const response = parseAccountResponse(await this.transport.request(ACCOUNT_METHOD, params));
    return { ...response, state: this.acceptState(response.state) };
  }

  async refresh(): Promise<AccountState> { return (await this.call({ action: "list" })).state; }

  async rootResume(params: RootResumeParams): Promise<RootResumeResponse> {
    if (!this.transport || !this.transportVerified || !this.instanceId) throw new Error("The engine connection has not been verified.");
    const response = parseRootResumeResponse(await this.transport.request(ROOT_RESUME_METHOD, params));
    this.rootResumeReservations = response.reservations;
    this.emit("rootResume", response.reservations);
    return response;
  }

  async devin(action: DevinAction): Promise<DevinStatus> {
    if (!this.transport || !this.transportVerified || !this.instanceId) throw new Error("The engine connection has not been verified.");
    return parseDevinStatus(await this.transport.request("azrael/devin", { action }, action === "login" ? 210_000 : 65_000));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
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
    const delays = this.options.reconnectDelaysMs ?? [1_000, 2_000, 4_000];
    let retries = 0;
    while (true) {
      try {
        return await this.connectOnce();
      } catch (error) {
        if (this.disposed) throw new Error("Account service is disposed.");
        if (error instanceof IdentityMismatchError || retries >= delays.length) {
          this.error = error instanceof Error ? error.message : String(error);
          this.emit("errorState", this.error);
          throw error;
        }
        await this.waitForRetry(delays[retries++]);
      }
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

  private async connectOnce(): Promise<AccountState> {
    this.transport?.dispose();
    this.transportVerified = false;
    const transport = new BridgeTransport({
      executable: this.options.executable,
      socket: this.options.socket,
      env: this.options.env
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
          this.rootResumeReservations = response.reservations;
          this.emit("rootResume", response.reservations);
        } catch { /* Invalid notifications never alter verified state. */ }
      }
    });
    transport.on("disconnect", (error: Error) => this.onDisconnect(transport, error));
    try {
      const connected = await transport.start();
      if (!samePath(connected.codexHome, this.options.codexHome)) throw new IdentityMismatchError("Bridge CODEX_HOME does not match this azrael-ex instance.");
      if (connected.serverVersion !== this.options.expectedServerVersion) throw new IdentityMismatchError(`Unsupported engine version ${connected.serverVersion}; this release expects ${this.options.expectedServerVersion}.`);
      const raw = await transport.request(ACCOUNT_METHOD, { action: "list" });
      const response = parseAccountResponse(raw);
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

  private acceptState(state: AccountState): AccountState {
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
    this.emit("state", state);
    return state;
  }

  private onDisconnect(source: BridgeTransport, _error: Error): void {
    if (this.transport !== source || this.disposed) return;
    this.transport = undefined;
    this.transportVerified = false;
    this.emit("rootResumeConnection", false);
    if (this.state) this.emit("state", this.state);
    if (!this.connecting) void this.connect().catch(() => undefined);
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

import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface, Interface } from "node:readline";
import { ConnectedNotice, isRecord } from "./protocol";

export type BridgePhase = "connect" | "stream" | "protocol";
export type BridgeCode = "endpoint_unavailable" | "permission_denied" | "timeout" | "protocol_error" | "connection_lost" | "internal";
export type BridgeProtocolReason = "invalid_json" | "invalid_message" | "invalid_connected" | "invalid_native_error" | "native_bridge_error" | "request_encoding";
export interface BridgeFailure { schema: 1; phase: BridgePhase; code: BridgeCode; retryable: boolean }
export interface BridgeDiagnostic extends BridgeFailure { event: "failure"; attempt: number; childPid?: number; elapsedMs: number; protocolReason?: BridgeProtocolReason }
export type EngineReadinessHook = (remainingMs: number, signal: AbortSignal) => Promise<void>;
export class BridgeError extends Error {
  constructor(readonly phase: BridgePhase, readonly code: BridgeCode, readonly retryable: boolean, readonly protocolReason?: BridgeProtocolReason) {
    super(code === "timeout" ? (phase === "stream" ? "Bridge request timed out." : "Bridge connection timed out.") : code === "permission_denied" ? "Bridge access was denied." : code === "protocol_error" ? "Bridge protocol error (invalid JSON or message)." : code === "endpoint_unavailable" ? "Bridge endpoint is unavailable." : code === "connection_lost" ? "bridge disconnected." : "Bridge connection failed.");
  }
}
export class UncertainBridgeOutcomeError extends Error {
  constructor(readonly cause: Error) { super("Account change outcome is uncertain. Refresh state after reconnect."); }
}
interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
  mutation: boolean;
  sent: boolean;
}
export interface BridgeTransportOptions {
  executable: string; socket: string; env: NodeJS.ProcessEnv;
  requestTimeoutMs?: number; startupTimeoutMs?: number;
  attempt?: number; onDiagnostic?: (event: BridgeDiagnostic) => void;
}
function parseFailure(value: unknown): BridgeFailure | undefined {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "code,phase,retryable,schema" || value.schema !== 1 ||
      !["connect", "stream", "protocol"].includes(value.phase as string) ||
      !["endpoint_unavailable", "permission_denied", "timeout", "protocol_error", "connection_lost", "internal"].includes(value.code as string) || typeof value.retryable !== "boolean") return;
  return value as unknown as BridgeFailure;
}
export class BridgeTransport extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | undefined;
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private readyResolve: ((notice: ConnectedNotice) => void) | undefined;
  private readyReject: ((error: Error) => void) | undefined;
  private readyTimer: NodeJS.Timeout | undefined;
  private lines: Interface | undefined;
  private stopped = false;
  private startedAt = 0;
  constructor(private readonly options: BridgeTransportOptions) { super(); }
  async start(): Promise<ConnectedNotice> {
    if (this.child) throw new Error("bridge is already running");
    this.stopped = false;
    this.startedAt = performance.now();
    const ready = new Promise<ConnectedNotice>((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    const child = spawn(this.options.executable, [this.options.socket], { env: this.options.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    this.readyTimer = setTimeout(() => { if (this.child === child) this.fail(new BridgeError("connect", "timeout", true)); }, this.options.startupTimeoutMs ?? 65_000);
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", line => { if (this.child === child) this.onLine(line); });
    child.stderr.on("data", () => { /* Never collect native stderr. */ });
    const processError = (error: NodeJS.ErrnoException) => {
      if (this.child === child) this.fail(new BridgeError("connect", error.code === "EACCES" || error.code === "EPERM" ? "permission_denied" : "internal", false));
    };
    child.once("error", processError);
    child.stdin.on("error", () => { if (this.child === child) this.fail(new BridgeError("stream", "connection_lost", true)); });
    // close follows stdout draining, preserving a terminal native notice before exit.
    child.once("close", () => { if (this.child === child) this.fail(new BridgeError("stream", "connection_lost", true)); });
    return ready;
  }
  request(method: string, params: unknown, timeoutMs = this.options.requestTimeoutMs ?? 65_000): Promise<unknown> {
    const child = this.child;
    if (!child || !child.stdin.writable || this.stopped) return Promise.reject(new BridgeError("stream", "connection_lost", true));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const mutation = isRecord(params) && typeof params.action === "string" &&
        ((method === "azrael/account" && !["list", "usage"].includes(params.action)) ||
         (method === "azrael/devin" && ["login", "logout"].includes(params.action)) ||
         (method === "azrael/rootResume" && params.action !== "list"));
      const timer = setTimeout(() => { if (this.child === child) this.fail(new BridgeError("stream", "timeout", true)); }, timeoutMs);
      const pending: PendingRequest = { resolve, reject, timer, mutation, sent: false };
      this.pending.set(id, pending);
      let line: string;
      try {
        line = `${JSON.stringify({ id, method, params })}\n`;
      } catch { this.fail(new BridgeError("protocol", "protocol_error", false, "request_encoding")); return; }
      try {
        pending.sent = true;
        child.stdin.write(line, error => { if (error && this.child === child) this.fail(new BridgeError("stream", "connection_lost", true)); });
      } catch { this.fail(new BridgeError("protocol", "protocol_error", false)); }
    });
  }
  dispose(): void { this.stopped = true; this.fail(new Error("bridge disposed")); }
  private onLine(line: string): void {
    let message: unknown;
    try { message = JSON.parse(line); } catch { this.fail(new BridgeError("protocol", "protocol_error", false, "invalid_json")); return; }
    if (!isRecord(message)) { this.fail(new BridgeError("protocol", "protocol_error", false, "invalid_message")); return; }
    if (message.method === "azrael/bridgeError") {
      const failure = parseFailure(message.params);
      this.fail(failure ? new BridgeError(failure.phase, failure.code, failure.retryable, failure.code === "protocol_error" ? "native_bridge_error" : undefined) : new BridgeError("protocol", "protocol_error", false, "invalid_native_error"));
      return;
    }
    if (message.method === "azrael/connected") {
      if (!isRecord(message.params) || typeof message.params.codexHome !== "string" || typeof message.params.serverVersion !== "string") {
        this.fail(new BridgeError("protocol", "protocol_error", false, "invalid_connected")); return;
      }
      clearTimeout(this.readyTimer);
      this.readyResolve?.(message.params as unknown as ConnectedNotice);
      this.readyResolve = undefined; this.readyReject = undefined;
      return;
    }
    if (typeof message.method === "string") { this.emit("notification", message.method, message.params); return; }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id); clearTimeout(pending.timer);
    if (message.error !== undefined) {
      const detail = isRecord(message.error) && typeof message.error.message === "string" ? message.error.message : "bridge request failed";
      pending.reject(new Error(detail));
    }
    else pending.resolve(message.result);
  }
  private fail(error: Error): void {
    const child = this.child;
    this.child = undefined;
    clearTimeout(this.readyTimer); this.readyTimer = undefined;
    if (child && error instanceof BridgeError) {
      try { this.options.onDiagnostic?.({ schema: 1, event: "failure", phase: error.phase, code: error.code, retryable: error.retryable, attempt: this.options.attempt ?? 1, childPid: child.pid, elapsedMs: Math.round(performance.now() - this.startedAt), ...(error.code === "protocol_error" && error.protocolReason ? { protocolReason: error.protocolReason } : {}) }); } catch { /* Diagnostics must not interrupt cleanup. */ }
    }
    this.readyReject?.(error); this.readyResolve = undefined; this.readyReject = undefined;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(pending.mutation && pending.sent ? new UncertainBridgeOutcomeError(error) : error); }
    this.pending.clear(); this.lines?.close(); this.lines = undefined;
    if (child && !child.killed) child.kill();
    if (child && !this.stopped) this.emit("disconnect", error);
  }
}

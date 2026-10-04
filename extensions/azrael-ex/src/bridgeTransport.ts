import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface, Interface } from "node:readline";
import { ConnectedNotice, isRecord } from "./protocol";

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export interface BridgeTransportOptions {
  executable: string;
  socket: string;
  env: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
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

  constructor(private readonly options: BridgeTransportOptions) { super(); }

  async start(): Promise<ConnectedNotice> {
    if (this.child) throw new Error("bridge is already running");
    this.stopped = false;
    const ready = new Promise<ConnectedNotice>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.readyTimer = setTimeout(() => this.fail(new Error("bridge connection timed out")), 15_000);
    });
    const child = spawn(this.options.executable, [this.options.socket], {
      env: this.options.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", (line) => this.onLine(line));
    child.stderr.on("data", () => { /* Native diagnostics stay out of the UI and logs. */ });
    child.once("error", (error) => this.fail(error));
    child.once("exit", (code, signal) => this.fail(new Error(`bridge disconnected (${code ?? signal ?? "unknown"})`)));
    return ready;
  }

  request(method: string, params: unknown, timeoutMs = this.options.requestTimeoutMs ?? 65_000): Promise<unknown> {
    if (!this.child || !this.child.stdin.writable || this.stopped) return Promise.reject(new Error("bridge is disconnected"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const mutation = isRecord(params) && typeof params.action === "string" &&
        ((method === "azrael/account" && !["list", "usage"].includes(params.action)) ||
         (method === "azrael/devin" && ["login", "logout"].includes(params.action)));
      const timer = setTimeout(() => this.fail(new Error(mutation
        ? "Account change timed out; its outcome is uncertain. Refresh state after reconnect."
        : "Bridge request timed out.")), timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (error) this.fail(error);
      });
    });
  }

  dispose(): void {
    this.stopped = true;
    this.child?.kill();
    this.fail(new Error("bridge disposed"));
  }

  private onLine(line: string): void {
    let message: unknown;
    try { message = JSON.parse(line); } catch { this.fail(new Error("bridge emitted invalid JSON")); return; }
    if (!isRecord(message)) return;
    if (message.method === "azrael/connected" && isRecord(message.params) &&
        typeof message.params.codexHome === "string" && typeof message.params.serverVersion === "string") {
      clearTimeout(this.readyTimer);
      this.readyResolve?.(message.params as unknown as ConnectedNotice);
      this.readyResolve = undefined;
      this.readyReject = undefined;
      return;
    }
    if (typeof message.method === "string") {
      this.emit("notification", message.method, message.params);
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error !== undefined) {
      const detail = isRecord(message.error) && typeof message.error.message === "string" ? message.error.message : "bridge request failed";
      pending.reject(new Error(detail));
    } else {
      pending.resolve(message.result);
    }
  }

  private rejectPending(id: number, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  private fail(error: Error): void {
    clearTimeout(this.readyTimer);
    this.readyTimer = undefined;
    this.readyReject?.(error);
    this.readyResolve = undefined;
    this.readyReject = undefined;
    for (const [id] of this.pending) this.rejectPending(id, error);
    const child = this.child;
    const wasRunning = child !== undefined;
    this.child = undefined;
    this.lines?.close();
    this.lines = undefined;
    if (child && !child.killed) child.kill();
    if (wasRunning && !this.stopped) this.emit("disconnect", error);
  }
}

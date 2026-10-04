import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { isAbsolute } from "node:path";

type RequestId = number | string;
type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout };

export interface AppServerTransportOptions {
  executable: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  clientInfo: { name: string; version: string; title?: string };
  args?: string[];
  requestTimeoutMs?: number;
  maxLineBytes?: number;
}

/** One extension-host-owned app-server connection. Callers own all server requests and approvals. */
export class AppServerTransport extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | undefined;
  private pending = new Map<number, Pending>();
  private serverRequests = new Set<RequestId>();
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private started = false;
  private connected = false;
  private disposed = false;
  private stderrBytes = 0;
  private diagnostics: string[] = [];

  constructor(private readonly options: AppServerTransportOptions) {
    super();
    if (!isAbsolute(options.executable) || !isAbsolute(options.cwd)) throw new Error("app-server executable and cwd must be absolute");
    if (!options.clientInfo.name || !options.clientInfo.version) throw new Error("app-server clientInfo requires name and version");
    if (options.requestTimeoutMs !== undefined && (!Number.isFinite(options.requestTimeoutMs) || options.requestTimeoutMs <= 0)) throw new Error("invalid request timeout");
    if (options.maxLineBytes !== undefined && (!Number.isInteger(options.maxLineBytes) || options.maxLineBytes <= 0)) throw new Error("invalid line limit");
  }

  get pid(): number | undefined { return this.child?.pid; }
  get isConnected(): boolean { return this.connected; }
  get diagnosticSummary(): readonly string[] { return [...this.diagnostics]; }

  async start(): Promise<unknown> {
    if (this.started || this.disposed) throw new Error("app-server transport cannot be started again");
    this.started = true;
    const child = spawn(this.options.executable, this.options.args ?? ["app-server"], {
      cwd: this.options.cwd, env: this.options.env, windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    child.stderr.on("data", (chunk: Buffer) => { this.stderrBytes = Math.min(4096, this.stderrBytes + chunk.length); });
    child.once("error", (error) => this.fail(new Error(`app-server process error: ${(error as NodeJS.ErrnoException).code ?? "unknown"}`)));
    child.once("exit", (code, signal) => this.fail(new Error(`app-server disconnected (${code ?? signal ?? "unknown"})`)));
    try {
      const result = await this.sendRequest("initialize", {
        clientInfo: this.options.clientInfo,
        capabilities: { experimentalApi: true }
      }, this.options.requestTimeoutMs ?? 15_000);
      this.write({ method: "initialized" });
      this.connected = true;
      return result;
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error("app-server initialization failed"));
      throw error;
    }
  }

  request(method: string, params?: unknown, timeoutMs = this.options.requestTimeoutMs ?? 65_000): Promise<unknown> {
    if (!this.connected) return Promise.reject(new Error("app-server is disconnected"));
    return this.sendRequest(method, params, timeoutMs);
  }

  notify(method: string, params?: unknown): void {
    if (!this.connected) throw new Error("app-server is disconnected");
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  respond(id: RequestId, result: unknown): void { this.reply(id, { result }); }
  respondError(id: RequestId, code: number, message: string): void { this.reply(id, { error: { code, message } }); }

  dispose(): void {
    this.disposed = true;
    this.fail(new Error("app-server disposed"));
  }

  private reply(id: RequestId, content: object): void {
    if (!this.connected || !this.serverRequests.delete(id)) throw new Error("unknown or already answered app-server request");
    this.write({ id, ...content });
  }

  private sendRequest(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (!this.child || !this.child.stdin.writable) return Promise.reject(new Error("app-server is disconnected"));
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new Error("invalid request timeout"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`app-server request timed out; outcome is uncertain (${method})`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, ...(params === undefined ? {} : { params }) }); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private write(message: object): void {
    if (!this.child?.stdin.writable) throw new Error("app-server is disconnected");
    this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error) this.fail(new Error("app-server write failed"));
    });
  }

  private onData(chunk: Buffer): void {
    const max = this.options.maxLineBytes ?? 1024 * 1024;
    let offset = 0;
    while (offset < chunk.length && this.child) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      const segment = chunk.subarray(offset, end);
      if (this.buffer.length + segment.length > max) {
        this.fail(new Error("app-server line exceeded limit"));
        return;
      }
      this.buffer = Buffer.concat([this.buffer, segment]);
      if (newline < 0) return;
      const line = this.buffer.toString("utf8");
      this.buffer = Buffer.alloc(0);
      this.onLine(line);
      offset = newline + 1;
    }
  }

  private onLine(line: string): void {
    let message: unknown;
    try { message = JSON.parse(line); } catch { this.fail(new Error("app-server emitted invalid JSON")); return; }
    if (!isObject(message)) { this.fail(new Error("app-server emitted invalid message")); return; }
    const id = message.id;
    if (typeof message.method === "string") {
      if (typeof id === "number" || typeof id === "string") {
        if (this.serverRequests.size >= 128 || this.serverRequests.has(id)) { this.fail(new Error("app-server request limit or duplicate id")); return; }
        this.serverRequests.add(id);
        this.emit("serverRequest", id, message.method, message.params);
      } else if (id === undefined) this.emit("notification", message.method, message.params);
      else this.fail(new Error("app-server emitted invalid request id"));
      return;
    }
    if (typeof id !== "number" || !this.pending.has(id)) return;
    const pending = this.pending.get(id)!;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (message.error !== undefined) {
      const detail = isObject(message.error) && typeof message.error.message === "string" ? message.error.message : "app-server request failed";
      pending.reject(new Error(detail));
    } else pending.resolve(message.result);
  }

  private fail(error: Error): void {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    this.connected = false;
    this.buffer = Buffer.alloc(0);
    this.serverRequests.clear();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    if (!child.killed) child.kill();
    this.diagnostics.push("app-server connection closed", `stderr bytes observed (capped): ${this.stderrBytes}`);
    if (this.diagnostics.length > 8) this.diagnostics.splice(0, this.diagnostics.length - 8);
    if (!this.disposed) this.emit("disconnect", error);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

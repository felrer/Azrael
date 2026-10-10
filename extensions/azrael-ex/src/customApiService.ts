import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";

export interface CustomApiModel { id: string; name: string; contextWindow: number; maxOutputTokens: number; supportsTools: boolean; sendThinkingParameter: boolean; enableThinking: boolean; parallelToolCalls: boolean }
export interface CustomApiConnection {
  id: string; name: string; baseUrl: string; protocol: "chat" | "responses"; enabled: boolean;
  timeoutMs: number; maxConcurrent: number; stream: boolean;
  auth: { kind: "none" | "bearerFile" | "secret"; filePath?: string }; models: CustomApiModel[];
}
export type CustomApiRequest = { action: "list" | "upsert" | "delete" | "discover"; connection?: Partial<CustomApiConnection>; id?: string; apiKey?: string };
export interface CustomApiBackend { readonly enabled: boolean; request(request: CustomApiRequest): Promise<{ connections?: CustomApiConnection[]; modelIds?: string[] }>; dispose(): void }
const safeError = () => new Error("API 요청을 완료하지 못했습니다. 주소, 인증 및 연결 설정을 확인하고 다시 시도하세요.");
export function parseApiConnections(value: unknown): CustomApiConnection[] {
  if (!Array.isArray(value) || value.length > 1000) throw safeError();
  const seen = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== "object") throw safeError();
    const c = raw as CustomApiConnection;
    if (!/^[a-f0-9]{32}$/.test(c.id) || seen.has(c.id) || typeof c.name !== "string" || typeof c.baseUrl !== "string"
      || !["chat", "responses"].includes(c.protocol) || typeof c.enabled !== "boolean" || typeof c.stream !== "boolean"
      || !Number.isSafeInteger(c.timeoutMs) || c.timeoutMs < 1 || !Number.isSafeInteger(c.maxConcurrent) || c.maxConcurrent < 1
      || !c.auth || !["none", "bearerFile", "secret"].includes(c.auth.kind) || !Array.isArray(c.models)) throw safeError();
    seen.add(c.id);
    const modelIds = new Set<string>();
    const models = c.models.map(m => {
      if (!m || typeof m.id !== "string" || !m.id || typeof m.name !== "string" || modelIds.has(m.id)
        || !Number.isSafeInteger(m.contextWindow) || m.contextWindow < 1 || !Number.isSafeInteger(m.maxOutputTokens) || m.maxOutputTokens < 1
        || typeof m.supportsTools !== "boolean") throw safeError();
      modelIds.add(m.id);
      return { id: m.id, name: m.name, contextWindow: m.contextWindow, maxOutputTokens: m.maxOutputTokens, supportsTools: m.supportsTools,
        sendThinkingParameter: m.sendThinkingParameter === true, enableThinking: m.enableThinking === true, parallelToolCalls: m.parallelToolCalls === true };
    });
    return { id: c.id, name: c.name, baseUrl: c.baseUrl, protocol: c.protocol, enabled: c.enabled, timeoutMs: c.timeoutMs,
      maxConcurrent: c.maxConcurrent, stream: c.stream, auth: { kind: c.auth.kind, ...(c.auth.kind === "bearerFile" && typeof c.auth.filePath === "string" ? { filePath: c.auth.filePath } : {}) }, models };
  });
}

export class CustomApiService implements CustomApiBackend {
  readonly enabled: boolean;
  private disposed = false;
  private children = new Map<ChildProcessWithoutNullStreams, () => void>();
  constructor(private readonly env: NodeJS.ProcessEnv, private readonly deadlineMs = 30_000) {
    this.enabled = !!env.AZRAEL_PROVIDER_INFERENCE_HELPER && !!env.AZRAEL_PROVIDER_BUN;
  }
  dispose(): void { this.disposed = true; for (const cancel of this.children.values()) cancel(); }
  async request(request: CustomApiRequest): Promise<{ connections?: CustomApiConnection[]; modelIds?: string[] }> {
    if (!this.enabled || this.disposed) throw safeError();
    return new Promise((resolve, reject) => {
      const child = spawn(this.env.AZRAEL_PROVIDER_BUN!, [this.env.AZRAEL_PROVIDER_INFERENCE_HELPER!, "--api-config"], {
        env: this.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "", bytes = 0, done = false;
      const finish = (error?: Error) => {
        if (done) return; done = true; clearTimeout(timer); this.children.delete(child);
        if (error) { child.kill(); reject(error); return; }
        try {
          const data = JSON.parse(output);
          if (request.action === "discover") {
            if (!Array.isArray(data.modelIds) || data.modelIds.length > 10000 || data.modelIds.some((id: unknown) => typeof id !== "string" || !id || id.length > 1024)) throw safeError();
            resolve({ modelIds: [...new Set<string>(data.modelIds)] });
          } else resolve({ connections: parseApiConnections(data.connections) });
        } catch { reject(safeError()); }
      };
      const timer = setTimeout(() => finish(safeError()), this.deadlineMs);
      this.children.set(child, () => finish(safeError()));
      child.on("error", () => finish(safeError()));
      child.stdin.on("error", () => finish(safeError()));
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", chunk => { bytes += Buffer.byteLength(chunk, "utf8"); if (bytes > 2_000_000) finish(safeError()); else output += chunk; });
      // Consume but never retain or expose stderr (server errors can contain credentials).
      child.stderr.on("data", chunk => { bytes += chunk.length; if (bytes > 2_000_000) finish(safeError()); });
      child.on("close", code => finish(code === 0 ? undefined : safeError()));
      child.stdin.end(JSON.stringify(request) + "\n");
    });
  }
}

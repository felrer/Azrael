import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { AppServerTransport } from "./appServerTransport";

type Wire = Pick<AppServerTransport, "start" | "request" | "respond" | "respondError" | "dispose"> & {
  on(event: string, listener: (...args: any[]) => void): unknown;
};
type RecordValue = Record<string, unknown>;
const FULL_ACCESS = { approvalPolicy: "never", sandbox: "danger-full-access" } as const;
const FULL_ACCESS_SETTINGS = { approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } } as const;
export interface ChatModel { id: string; model: string; label: string; provider: string; efforts: string[]; defaultEffort?: string }
export interface ChatThread { id: string; title: string; model?: string }
export interface ChatItem { id: string; role: string; text: string }
export interface ChatApproval { id: number | string; kind: "command" | "file"; detail: string; threadId: string }
export interface ChatQueuedSubmission { id: string; kind: "userInput" | "contextCompaction"; text: string }
export interface ChatState {
  status: string; error?: string; models: ChatModel[]; threads: ChatThread[];
  selectedModel?: string; selectedEffort?: string; threadId?: string; turnId?: string;
  items: ChatItem[]; approvals: ChatApproval[]; queue: ChatQueuedSubmission[]; modelSelectionLocked?: boolean;
}

const object = (value: unknown): value is RecordValue => value !== null && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
function list(value: unknown, key: string): RecordValue[] {
  if (!object(value) || !Array.isArray(value[key]) || !(value[key] as unknown[]).every(object)) throw new Error(`Invalid ${key} response`);
  return value[key] as RecordValue[];
}
function thread(value: unknown): RecordValue {
  if (!object(value) || !object(value.thread) || !str(value.thread.id)) throw new Error("Invalid thread response");
  return value.thread;
}
function hasFullAccess(value: unknown, sandboxKey: "sandbox" | "sandboxPolicy"): boolean {
  return object(value) && value.approvalPolicy === "never" && object(value[sandboxKey]) && value[sandboxKey].type === "dangerFullAccess";
}
function item(value: unknown): ChatItem | undefined {
  if (!object(value) || !str(value.id)) return;
  if (value.type === "agentMessage" && typeof value.text === "string") return { id: value.id as string, role: "Azrael", text: value.text };
  if (value.type === "userMessage" && Array.isArray(value.content)) {
    return { id: value.id as string, role: "You", text: value.content.filter(object).filter(part => part.type === "text").map(part => str(part.text) ?? "").join("\n") };
  }
  if (value.type === "commandExecution" && typeof value.command === "string") {
    const output = str(value.aggregatedOutput);
    const boundedOutput = output && output.length > 32_000 ? `${output.slice(0, 32_000)}\n[Output truncated in chat]` : output;
    const result = [str(value.status), typeof value.exitCode === "number" ? `exit ${value.exitCode}` : undefined].filter(Boolean).join(", ");
    return { id: value.id as string, role: "Command", text: [value.command, result, boundedOutput].filter(Boolean).join("\n") };
  }
  if (value.type === "fileChange") {
    const paths = Array.isArray(value.changes) ? value.changes.filter(object).map(change => str(change.path)).filter((path): path is string => !!path).slice(0, 20) : [];
    const extra = Array.isArray(value.changes) && value.changes.length > paths.length ? "\n[Additional files omitted]" : "";
    return { id: value.id as string, role: "File change", text: `${str(value.status) ?? "proposed"}${paths.length ? `\n${paths.join("\n")}` : ""}${extra}` };
  }
  if (value.type === "collabAgentToolCall") {
    const tool = str(value.tool);
    const status = str(value.status);
    const labels: Record<string, string> = { spawnAgent: "Spawn agent", sendInput: "Send input", resumeAgent: "Resume agent", wait: "Wait for agents", closeAgent: "Close agent", sendMessage: "Send message", followupTask: "Follow-up task", interruptAgent: "Interrupt agent", listAgents: "List agents" };
    const allowed = new Set(["pendingInit", "running", "deferred", "interrupted", "completed", "errored", "shutdown", "notFound"]);
    const states = object(value.agentsStates) ? Object.values(value.agentsStates).filter(object).map(agent => str(agent.status)).filter((s): s is string => !!s && allowed.has(s)) : [];
    return { id: value.id as string, role: "Child agents", text: `${labels[tool ?? ""] ?? "Agent action"}: ${status ?? "unknown"}${states.length ? ` (${states.join(", ")})` : ""}` };
  }
  if (value.type === "subAgentActivity") {
    const kinds: Record<string, string> = { started: "started", interacted: "active", interrupted: "interrupted", completed: "completed" };
    return { id: value.id as string, role: "Child agent", text: `Agent ${kinds[str(value.kind) ?? ""] ?? "updated"}` };
  }
  return;
}

function queued(value: RecordValue): ChatQueuedSubmission {
  const id = str(value.id);
  const kind = value.kind;
  if (!id || (kind !== "userInput" && kind !== "contextCompaction") || !Array.isArray(value.input)) throw new Error("Invalid queue response");
  const text = kind === "contextCompaction" ? "Compact context" : value.input.filter(object).filter(part => part.type === "text").map(part => str(part.text) ?? "").join("\n");
  return { id, kind, text };
}

/** Owns one app-server process and only exposes validated, displayable chat data. */
export class ChatSession extends EventEmitter {
  readonly state: ChatState = { status: "Connecting…", models: [], threads: [], items: [], approvals: [], queue: [] };
  private readonly approvalMethods = new Map<number | string, "command" | "file">();
  private readonly verifiedFullAccessThreads = new Set<string>();
  private readonly fullAccessTurns = new Set<string>();
  private activeProvider?: string;
  private disposed = false;
  private queueVersion = 0;
  private queueStartPending = false;
  private queuePaused = false;
  private queueAdmissionPending = 0;
  private queueRefreshPending = 0;
  private readonly completedTurns = new Set<string>();
  constructor(private readonly wire: Wire, private readonly cwd: string) {
    super();
    wire.on("notification", (method: string, params: unknown) => this.notification(method, params));
    wire.on("serverRequest", (id: number | string, method: string, params: unknown) => this.serverRequest(id, method, params));
    wire.on("disconnect", () => { this.state.status = "Disconnected"; this.state.error = "Azrael connection closed. Reopen the chat to reconnect; check the last turn before resending it."; this.state.turnId = undefined; this.fullAccessTurns.clear(); this.queuePaused = true; this.queueVersion++; this.publish(); });
  }
  private publish(): void { if (!this.disposed) { this.state.modelSelectionLocked = this.queueLocked(); this.emit("change", this.state); } }
  private async call(method: string, params: unknown): Promise<unknown> {
    try { return await this.wire.request(method, params); }
    catch (error) {
      const detail = error instanceof Error ? error.message : "";
      this.state.error = detail.startsWith("app-server request timed out;")
        ? `${method} timed out. Its result is uncertain; refresh the thread before trying again.`
        : detail.startsWith("app-server is disconnected") || detail.startsWith("app-server disconnected")
          ? "Azrael connection closed. Reopen the chat to reconnect; check the last turn before resending it."
          : `${method} failed. Review the thread state before trying again.`;
      this.publish(); throw new Error(this.state.error);
    }
  }
  async start(): Promise<void> {
    try { await this.wire.start(); }
    catch { this.state.status = "Disconnected"; this.state.error = "Could not connect to Azrael app-server."; this.publish(); return; }
    this.state.status = "Connected"; this.publish();
    try { await Promise.all([this.refreshModels(), this.refreshThreads()]); }
    catch (error) { this.state.error ??= error instanceof Error ? error.message : "Could not load Azrael chat data."; this.publish(); }
  }
  async refreshModels(refresh = false): Promise<void> {
    const models: ChatModel[] = [];
    const modelIds = new Set<string>();
    let defaultId: string | undefined;
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      const response = await this.call("model/list", { cursor, includeHidden: false, ...(page === 0 && refresh ? { refresh: true } : {}) });
      for (const value of list(response, "data")) {
        const id = str(value.id);
        const model = str(value.model);
        const provider = str(value.modelProvider);
        if (!id || !model || !provider || !str(value.displayName)) throw new Error("Model catalog is missing model or provider identity");
        if (modelIds.has(id)) throw new Error("Model catalog returned duplicate model IDs");
        modelIds.add(id);
        const efforts = Array.isArray(value.supportedReasoningEfforts) ? value.supportedReasoningEfforts.filter(object).map(entry => str(entry.reasoningEffort)).filter((x): x is string => !!x) : [];
        models.push({ id, model, label: `${value.displayName} · ${provider}`, provider, efforts, defaultEffort: str(value.defaultReasoningEffort) });
        if (value.isDefault === true) defaultId = id;
      }
      cursor = object(response) ? str(response.nextCursor) ?? null : null;
      if (!cursor) break;
      if (page === 99) throw new Error("Model catalog exceeded page limit");
    }
    this.state.models = models;
    if (!models.some(model => model.id === this.state.selectedModel) && !this.queueLocked()) {
      const selected = models.find(model => model.id === defaultId) ?? models[0];
      this.state.selectedModel = selected?.id;
      this.state.selectedEffort = selected?.defaultEffort;
    }
    this.publish();
  }
  selectModel(id: string, effort?: string): void {
    const model = this.state.models.find(candidate => candidate.id === id);
    if (!model) throw new Error("Unknown model");
    if (effort && !model.efforts.includes(effort)) throw new Error("Unknown reasoning effort");
    if (this.queueLocked() && (id !== this.state.selectedModel || (effort ?? model.defaultEffort) !== this.state.selectedEffort)) {
      this.publish();
      throw new Error("Wait for or cancel pending queue items before changing the model or effort.");
    }
    this.state.selectedModel = id; this.state.selectedEffort = effort ?? model.defaultEffort; this.publish();
  }
  private queueLocked(): boolean { return this.state.queue.length > 0 || this.queueAdmissionPending > 0 || this.queueRefreshPending > 0; }
  async refreshThreads(): Promise<void> {
    const threads: ChatThread[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      const response = await this.call("thread/list", { cursor, cwd: this.cwd });
      for (const value of list(response, "data")) {
        const id = str(value.id);
        if (!id) throw new Error("Invalid thread response");
        threads.push({ id, title: str(value.name) || str(value.preview) || id, model: str(value.model) });
      }
      cursor = object(response) ? str(response.nextCursor) ?? null : null;
      if (!cursor) break;
      if (page === 99) throw new Error("Thread list exceeded page limit");
    }
    this.state.threads = threads; this.publish();
  }
  async newThread(): Promise<void> {
    const selected = this.selectedModel();
    const response = await this.call("thread/start", { cwd: this.cwd, model: selected.model, modelProvider: selected.provider, ...FULL_ACCESS });
    if (!hasFullAccess(response, "sandbox")) throw new Error("Azrael did not activate Full access for this thread.");
    this.state.threadId = str(thread(response).id); this.state.turnId = undefined; this.state.error = undefined; this.state.items = []; this.state.queue = []; this.queueVersion++; this.queuePaused = false; this.completedTurns.clear();
    this.fullAccessTurns.clear();
    this.verifiedFullAccessThreads.add(this.state.threadId!);
    this.activeProvider = str(thread(response).modelProvider) ?? selected.provider;
    await this.refreshThreads(); this.publish();
    await this.refreshQueue();
  }
  async openThread(id: string): Promise<void> {
    if (!this.state.threads.some(candidate => candidate.id === id)) throw new Error("Unknown thread");
    this.queueRefreshPending++;
    this.publish();
    try {
    await this.call("thread/read", { threadId: id });
    const response = await this.call("thread/resume", { threadId: id, excludeTurns: true, ...FULL_ACCESS });
    if (!hasFullAccess(response, "sandbox")) throw new Error("Azrael did not activate Full access for this thread.");
    const loaded = thread(response);
    this.state.threadId = id; this.state.turnId = undefined; this.state.error = undefined; this.state.queue = []; this.queueVersion++; this.queuePaused = false; this.completedTurns.clear();
    this.fullAccessTurns.clear();
    this.verifiedFullAccessThreads.add(id);
    this.activeProvider = str(loaded.modelProvider) ?? str(object(response) ? response.modelProvider : undefined);
    const loadedModel = str(loaded.model) ?? str(object(response) ? response.model : undefined);
    const selected = this.state.models.find(model => model.model === loadedModel && model.provider === this.activeProvider);
    this.state.selectedModel = selected?.id;
    this.state.selectedEffort = selected?.efforts.includes(str(object(response) ? response.reasoningEffort : undefined) ?? "")
      ? str(object(response) ? response.reasoningEffort : undefined) : selected?.defaultEffort;
    this.state.items = [];
    const latestTurns = await this.call("thread/turns/list", { threadId: id, limit: 1, sortDirection: "desc", itemsView: "notLoaded" });
    const latest = list(latestTurns, "data")[0];
    if (latest && str(latest.id) && latest.status === "inProgress") this.state.turnId = latest.id as string;
    if (latest?.status === "failed") { this.queuePaused = true; this.state.error = describeTurnError(latest.error); }
    if (latest?.status === "interrupted") this.queuePaused = true;
    let cursor: string | null = null;
    const pages: RecordValue[][] = [];
    for (let page = 0; page < 100; page++) {
      const result = await this.call("thread/items/list", { threadId: id, cursor, sortDirection: "desc" });
      pages.push(list(result, "data"));
      cursor = object(result) ? str(result.nextCursor) ?? null : null;
      if (!cursor) break;
      if (page === 99) throw new Error("Thread history exceeded page limit");
    }
    for (const page of pages.reverse()) for (const entry of page.reverse()) {
      const parsed = item(entry.item);
      if (parsed) this.state.items.push(parsed);
    }
    this.publish();
    await this.refreshQueue();
    } finally { this.queueRefreshPending--; this.publish(); }
  }
  async send(text: string): Promise<void> {
    if (!text.trim()) return;
    if (!this.state.threadId) await this.newThread();
    this.queueAdmissionPending++;
    this.publish();
    try {
    const threadId = this.state.threadId!;
    const selected = this.selectedModel();
    if (this.activeProvider !== selected.provider) {
      if (this.state.turnId) throw new Error("Stop the current turn before changing providers.");
      await this.call("thread/unsubscribe", { threadId });
      const resumed = await this.call("thread/resume", { threadId, model: selected.model, modelProvider: selected.provider, excludeTurns: true, ...FULL_ACCESS });
      if (!hasFullAccess(resumed, "sandbox")) throw new Error("Azrael did not preserve Full access while changing providers.");
      if (str(thread(resumed).id) !== threadId) throw new Error("Provider change returned a different thread");
      this.activeProvider = str(thread(resumed).modelProvider) ?? str(object(resumed) ? resumed.modelProvider : undefined);
      if (this.activeProvider !== selected.provider) throw new Error("Azrael did not activate the selected provider.");
    }
    await this.call("thread/settings/update", { threadId, model: selected.model, effort: this.state.selectedEffort, ...FULL_ACCESS_SETTINGS });
    await this.enqueue(threadId, "userInput", [{ type: "text", text, text_elements: [] }]);
    } finally { this.queueAdmissionPending--; this.publish(); }
  }
  async compact(): Promise<void> {
    if (!this.state.threadId) await this.newThread();
    this.queueAdmissionPending++;
    this.publish();
    try { await this.enqueue(this.state.threadId!, "contextCompaction", []); }
    finally { this.queueAdmissionPending--; this.publish(); }
  }
  private async enqueue(threadId: string, kind: ChatQueuedSubmission["kind"], input: RecordValue[]): Promise<void> {
    await this.call("thread/queue/add", { threadId, kind, input, clientUserMessageId: randomUUID() });
    this.queuePaused = false;
    await this.refreshQueue();
  }
  async refreshQueue(): Promise<void> {
    const threadId = this.state.threadId;
    if (!threadId) return;
    this.queueRefreshPending++;
    this.publish();
    try {
    const version = ++this.queueVersion;
    const entries: ChatQueuedSubmission[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      const response = await this.call("thread/queue/list", { threadId, cursor });
      entries.push(...list(response, "data").map(queued));
      cursor = object(response) ? str(response.nextCursor) ?? null : null;
      if (!cursor) break;
      if (page === 99) throw new Error("Queue exceeded page limit");
    }
    if (threadId !== this.state.threadId || version !== this.queueVersion) return;
    this.state.queue = entries; this.publish();
    void this.consumeQueue().catch(() => undefined);
    } finally { this.queueRefreshPending--; this.publish(); }
  }
  async cancelQueued(id: string): Promise<void> {
    if (!this.state.threadId || !this.state.queue.some(entry => entry.id === id)) return;
    await this.call("thread/queue/delete", { threadId: this.state.threadId, queuedSubmissionId: id });
    await this.refreshQueue();
  }
  async moveQueued(id: string, offset: -1 | 1): Promise<void> {
    if (!this.state.threadId) return;
    await this.refreshQueue();
    const index = this.state.queue.findIndex(entry => entry.id === id);
    if (index < 0 || index + offset < 0 || index + offset >= this.state.queue.length) return;
    const ids = this.state.queue.map(entry => entry.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    await this.call("thread/queue/reorder", { threadId: this.state.threadId, queuedSubmissionIds: ids });
    await this.refreshQueue();
  }
  private async consumeQueue(): Promise<void> {
    if (this.queueStartPending || this.queuePaused || this.state.turnId || !this.state.threadId || !this.state.queue.length || this.state.status !== "Connected") return;
    const threadId = this.state.threadId;
    this.queueStartPending = true;
    try {
      while (threadId === this.state.threadId && !this.queuePaused && !this.state.turnId && this.state.queue.length) {
        const id = this.state.queue[0].id;
        const response = await this.call("thread/queue/start", { threadId, queuedSubmissionId: id });
        if (threadId !== this.state.threadId) return;
        if (!object(response)) throw new Error("Invalid queue start response");
        if (response.skipped === true) {
          await this.refreshQueue();
          continue;
        }
        if (!object(response.turn) || !str(response.turn.id)) throw new Error("Invalid queue start response");
        if (this.completedTurns.has(response.turn.id as string)) {
          await this.refreshQueue();
          continue;
        }
        this.fullAccessTurns.add(`${threadId}:${response.turn.id}`);
        this.state.turnId = response.turn.id as string; this.publish();
        await this.refreshQueue();
        return;
      }
    } finally { this.queueStartPending = false; }
  }
  async stop(): Promise<void> {
    if (!this.state.threadId || !this.state.turnId) return;
    await this.call("turn/interrupt", { threadId: this.state.threadId, turnId: this.state.turnId });
  }
  private selectedModel(): ChatModel {
    const selected = this.state.models.find(model => model.id === this.state.selectedModel);
    if (!selected) throw new Error("Select a model from the Azrael catalog first.");
    return selected;
  }
  approve(id: number | string, decision: "accept" | "decline"): void {
    if (!this.approvalMethods.has(id)) throw new Error("Unknown approval");
    this.wire.respond(id, { decision }); this.approvalMethods.delete(id);
    this.state.approvals = this.state.approvals.filter(approval => approval.id !== id); this.publish();
  }
  private serverRequest(id: number | string, method: string, params: unknown): void {
    const kind = method === "item/commandExecution/requestApproval" ? "command" : method === "item/fileChange/requestApproval" ? "file" : undefined;
    if (object(params) && str(params.threadId) && str(params.turnId)
      && params.threadId === this.state.threadId && params.turnId === this.state.turnId
      && this.verifiedFullAccessThreads.has(params.threadId as string)
      && this.fullAccessTurns.has(`${params.threadId}:${params.turnId}`)) {
      if (kind && str(params.itemId)) { this.wire.respond(id, { decision: "accept" }); return; }
      if (method === "item/permissions/requestApproval" && str(params.itemId) && object(params.permissions)) {
        this.wire.respond(id, { permissions: params.permissions, scope: "turn" }); return;
      }
    }
    if (!kind || !object(params) || !str(params.threadId) || !str(params.turnId) || !str(params.itemId)) {
      this.wire.respondError(id, -32601, "Unsupported or invalid request"); return;
    }
    const detail = kind === "command" ? str(params.command) || "Command execution" : str(params.reason) || "File changes";
    this.approvalMethods.set(id, kind);
    this.state.approvals.push({ id, kind, detail, threadId: params.threadId as string }); this.publish();
  }
  private notification(method: string, params: unknown): void {
    if (!object(params)) { if (method.startsWith("item/") || method.startsWith("turn/")) this.state.error = `Invalid ${method} event`; this.publish(); return; }
    if (str(params.threadId) !== this.state.threadId) return;
    if (method === "item/agentMessage/delta") {
      if (!str(params.itemId) || typeof params.delta !== "string") { this.state.error = "Invalid message stream event"; this.publish(); return; }
      let current = this.state.items.find(entry => entry.id === params.itemId);
      if (!current) { current = { id: params.itemId as string, role: "Azrael", text: "" }; this.state.items.push(current); }
      current.text += params.delta as string;
    } else if ((method === "item/completed" || method === "item/started" || method === "item/updated") && object(params.item)) {
      const parsed = item(params.item);
      if (parsed) {
        let index = this.state.items.findIndex(entry => entry.id === parsed.id);
        if (index < 0 && parsed.role === "You") index = this.state.items.findIndex(entry => entry.id.startsWith("user-") && entry.text === parsed.text);
        if (index < 0) this.state.items.push(parsed); else this.state.items[index] = parsed;
      }
    } else if (method === "thread/queue/changed") void this.refreshQueue().catch(() => undefined);
    else if (method === "turn/started" && object(params.turn) && str(params.turn.id)) {
      this.state.turnId = params.turn.id as string;
      if (this.queueStartPending && this.verifiedFullAccessThreads.has(params.threadId as string)) this.fullAccessTurns.add(`${params.threadId}:${params.turn.id}`);
    }
    else if (method === "turn/completed" && object(params.turn) && str(params.turn.id)) {
      this.completedTurns.add(params.turn.id as string);
      this.fullAccessTurns.delete(`${params.threadId}:${params.turn.id}`);
      if (this.state.turnId === params.turn.id) this.state.turnId = undefined;
      if (params.turn.status === "interrupted" || params.turn.status === "failed") this.queuePaused = true;
      if (params.turn.status === "failed") this.state.error = describeTurnError(params.turn.error);
      void this.refreshThreads().catch(() => undefined);
      void this.refreshQueue().catch(() => undefined);
    }
    this.publish();
  }
  dispose(): void { this.disposed = true; this.wire.dispose(); this.removeAllListeners(); }
}

function describeTurnError(value: unknown): string {
  const info = object(value) ? value.codexErrorInfo : undefined;
  const code = typeof info === "string" ? info : object(info) ? Object.keys(info)[0] : undefined;
  const detail = object(value) ? str(value.message) : undefined;
  const connectionCode = code === "other" ? detail?.match(/\((provider_headers_failed|provider_connection_(?:dns|tls|reset|refused|timeout|unreachable|proxy))\)$/)?.[1] : undefined;
  if (connectionCode) {
    const causes: Record<string, string> = {
      provider_headers_failed: "모델 응답 헤더를 받기 전에 요청이 실패했습니다. 원인은 확인되지 않았습니다.",
      provider_connection_dns: "모델 서버 주소의 DNS 조회에 실패했습니다.",
      provider_connection_tls: "모델 서버와의 TLS 연결에 실패했습니다.",
      provider_connection_reset: "모델 서버와의 연결이 끊어졌습니다.",
      provider_connection_refused: "모델 서버 연결이 거부됐습니다.",
      provider_connection_timeout: "모델 서버 연결 대기 시간이 초과됐습니다.",
      provider_connection_unreachable: "모델 서버에 연결할 네트워크 경로를 사용할 수 없습니다.",
      provider_connection_proxy: "프록시 연결에 실패했습니다.",
    };
    return `${causes[connectionCode]} 연결 상태와 기존 작업 결과를 확인한 뒤 이 세션에서 다시 요청하세요.`;
  }
  if (detail && /model is not supported when using Codex with a ChatGPT account/i.test(detail)) {
    return "The selected model is unavailable to this ChatGPT account. Choose an available model or sign in with the intended account.";
  }
  switch (code) {
    case "unauthorized": return "Authentication expired. Sign in to the selected provider again, then resume this thread.";
    case "usageLimitExceeded":
    case "sessionBudgetExceeded": return "The provider usage limit was reached. Check account usage before resuming.";
    case "rateLimitExceeded": return "The provider rate limit was reached. Wait before resuming this thread.";
    case "httpConnectionFailed":
    case "responseStreamConnectionFailed":
    case "responseStreamDisconnected": return "The provider connection or response stream was interrupted. Review the thread before resuming; a tool result may be uncertain.";
    case "responseTooManyFailedAttempts":
    case "serverOverloaded":
    case "internalServerError": return "The provider could not complete this turn. Wait and review the thread before resuming.";
    case "contextWindowExceeded": return "The context window is full. Compact the thread before continuing.";
    case "badRequest": return "The provider rejected this request. Check the selected model and input before retrying.";
    case "sandboxError": return "A local tool or sandbox action failed. Review the tool result before continuing.";
    default: return "Turn failed. Review the thread and Azrael diagnostics before continuing.";
  }
}

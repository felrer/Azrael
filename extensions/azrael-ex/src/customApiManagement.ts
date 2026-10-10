import { CustomApiBackend, CustomApiConnection, CustomApiModel } from "./customApiService";
import { dynamicTextHtml, escapeHtml } from "./usagePresentation";

export interface ApiPrompts {
  text(prompt: string, value?: string, password?: boolean): Promise<string | undefined>;
  choose(title: string, choices: string[]): Promise<string | undefined>;
  checks(title: string, choices: { label: string; picked: boolean }[]): Promise<string[] | undefined>;
  confirm(message: string): Promise<boolean>;
}
const cancelled = Symbol("cancelled");
export class CustomApiManagement {
  connections: CustomApiConnection[] = [];
  pending = false;
  error = "";
  private loaded = false;
  constructor(readonly backend: CustomApiBackend, private readonly prompts: ApiPrompts, private readonly changed: () => void) {}
  async refresh(): Promise<void> {
    if (this.pending || !this.backend.enabled || this.loaded) return;
    await this.run(async () => { this.connections = (await this.backend.request({ action: "list" })).connections!; this.loaded = true; });
  }
  async handle(message: Record<string, unknown>): Promise<boolean> {
    if (typeof message.action !== "string" || !message.action.startsWith("api")) return false;
    if (this.pending || !this.backend.enabled) return true;
    const current = this.connections.find(c => c.id === message.accountId);
    await this.run(async () => {
      switch (message.action) {
        case "apiRefresh": this.connections = (await this.backend.request({ action: "list" })).connections!; this.loaded = true; break;
        case "apiAdd": await this.edit(); break;
        case "apiEdit": if (current) await this.edit(current); break;
        case "apiToggle": if (current) await this.save({ ...current, enabled: !current.enabled }); break;
        case "apiDelete": if (current && await this.prompts.confirm(`${current.name} API 연결을 삭제할까요?`)) this.connections = (await this.backend.request({ action: "delete", id: current.id })).connections!; break;
        case "apiModels": if (current) await this.models(current); break;
        case "apiDiscover": if (current) await this.discover(current); break;
      }
    });
    return true;
  }
  private async run(action: () => Promise<void>): Promise<void> {
    this.pending = true; this.error = ""; this.changed();
    try { await action(); } catch (error) {
      if (error !== cancelled) this.error = "API 요청을 완료하지 못했습니다. 저장된 설정은 유지됩니다. 입력과 연결을 확인하고 다시 시도하세요.";
    } finally { this.pending = false; this.changed(); }
  }
  private async text(prompt: string, value?: string, password = false): Promise<string> {
    const answer = await this.prompts.text(prompt, value, password);
    if (answer === undefined) throw cancelled;
    return answer;
  }
  private async choice(title: string, choices: string[]): Promise<string> {
    const answer = await this.prompts.choose(title, choices); if (answer === undefined) throw cancelled; return answer;
  }
  private async integer(prompt: string, value?: number): Promise<number> {
    for (;;) {
      const result = Number(await this.text(prompt, value?.toString()));
      if (Number.isSafeInteger(result) && result > 0) return result;
      prompt = "양의 정수를 입력하세요. " + prompt;
    }
  }
  private async flag(prompt: string, value = false): Promise<boolean> {
    const yes = "사용", no = "사용 안 함";
    return await this.choice(prompt, value ? [yes, no] : [no, yes]) === yes;
  }
  private async save(connection: Partial<CustomApiConnection>, apiKey?: string): Promise<void> {
    this.connections = (await this.backend.request({ action: "upsert", connection, ...(apiKey ? { apiKey } : {}) })).connections!;
    this.loaded = true;
  }
  private async edit(current?: CustomApiConnection): Promise<void> {
    const name = await this.text("API 연결 이름", current?.name);
    const baseUrl = await this.text("API 기본 주소 (서버의 /v1 등 API 경로까지 입력)", current?.baseUrl ?? "");
    const protocol = await this.choice("API 프로토콜", current?.protocol === "responses" ? ["responses", "chat"] : ["chat", "responses"]) as "chat" | "responses";
    const authKind = await this.choice("인증 방식", current ? [current.auth.kind, ...["none", "secret", "bearerFile"].filter(k => k !== current.auth.kind)] : ["none", "secret", "bearerFile"]) as CustomApiConnection["auth"]["kind"];
    let apiKey: string | undefined, filePath: string | undefined;
    if (authKind === "secret") {
      apiKey = await this.text(current?.auth.kind === "secret" ? "API 키 변경 (빈 값은 기존 키 유지)" : "API 키", undefined, true);
      if (!apiKey && current?.auth.kind !== "secret") throw new Error("missing_key");
    } else if (authKind === "bearerFile") filePath = await this.text("Bearer 토큰 파일의 절대 경로", current?.auth.filePath);
    const timeoutMs = await this.integer("요청 제한 시간 (밀리초)", current?.timeoutMs ?? 180000);
    const maxConcurrent = await this.integer("최대 동시 요청 수", current?.maxConcurrent ?? 1);
    const stream = await this.flag("스트리밍 응답", current?.stream);
    const enabled = await this.flag("연결 활성화", current?.enabled ?? true);
    await this.save({ ...(current ? { id: current.id } : {}), name, baseUrl, protocol, enabled, timeoutMs, maxConcurrent, stream,
      auth: { kind: authKind, ...(filePath ? { filePath } : {}) }, models: current?.models ?? [] }, apiKey);
  }
  private async model(current?: CustomApiModel, discoveredId?: string): Promise<CustomApiModel> {
    const id = discoveredId ?? await this.text("서버 모델 ID (슬래시 포함 원문 그대로 입력)", current?.id);
    const name = await this.text("모델 표시 이름", current?.name ?? id);
    const contextWindow = await this.integer("확인한 컨텍스트 한도 (토큰)", current?.contextWindow);
    const maxOutputTokens = await this.integer("확인한 최대 출력 한도 (토큰)", current?.maxOutputTokens);
    // Discovery only returns identities. Capabilities are explicitly declared by the user.
    const tools = "도구 호출 지원을 직접 확인함", sendThinking = "thinking 파라미터 전송 (지원 서버만)", thinking = "enable_thinking", parallel = "parallel_tool_calls";
    const capabilities = await this.prompts.checks("직접 확인한 기능만 선택하세요. 미선택 도구 지원은 미확인으로 표시됩니다.", [
      { label: tools, picked: current?.supportsTools ?? false },
      { label: sendThinking, picked: current?.sendThinkingParameter ?? false },
      { label: thinking, picked: current?.enableThinking ?? false },
      { label: parallel, picked: current?.parallelToolCalls ?? false },
    ]);
    if (capabilities === undefined) throw cancelled;
    const supportsTools = capabilities.includes(tools), sendThinkingParameter = capabilities.includes(sendThinking), enableThinking = capabilities.includes(thinking), parallelToolCalls = capabilities.includes(parallel);
    return { id, name, contextWindow, maxOutputTokens, supportsTools, sendThinkingParameter, enableThinking, parallelToolCalls };
  }
  private async models(current: CustomApiConnection): Promise<void> {
    const action = await this.choice("모델 관리", ["모델 추가", "모델 수정", "모델 삭제"]);
    if (action === "모델 추가") {
      const model = await this.model();
      if (current.models.some(m => m.id === model.id)) throw new Error("duplicate_model");
      await this.save({ ...current, models: [...current.models, model] });
    } else {
      if (!current.models.length) return;
      const id = await this.choice("모델 선택", current.models.map(m => m.id));
      if (action === "모델 삭제") {
        if (await this.prompts.confirm(`${id} 모델을 삭제할까요?`)) await this.save({ ...current, models: current.models.filter(m => m.id !== id) });
      } else {
        const model = await this.model(current.models.find(m => m.id === id));
        if (model.id !== id && current.models.some(m => m.id === model.id)) throw new Error("duplicate_model");
        await this.save({ ...current, models: current.models.map(m => m.id === id ? model : m) });
      }
    }
  }
  private async discover(current: CustomApiConnection): Promise<void> {
    const ids = (await this.backend.request({ action: "discover", id: current.id })).modelIds!;
    if (!ids.length) { this.error = "서버가 모델 ID를 반환하지 않았습니다. 모델 관리에서 직접 등록할 수 있습니다."; return; }
    const id = await this.choice("/models 조회 결과에서 등록할 모델 선택", ids);
    const model = await this.model(current.models.find(m => m.id === id), id);
    await this.save({ ...current, models: [...current.models.filter(m => m.id !== id), model] });
  }
}

export function customApiHtml(state: Pick<CustomApiManagement, "connections" | "pending" | "error" | "backend">): string {
  const button = (action: string, label: string, id = "") => `<button data-action="${action}" data-account="${escapeHtml(id)}"${state.pending || !state.backend.enabled ? " disabled" : ""}>${label}</button>`;
  const cards = state.connections.map(c => `<article class="card api-connection"><div class="card-heading"><h3>${dynamicTextHtml(c.name)}</h3><span class="muted">${c.enabled ? "활성" : "비활성"}</span></div><p class="muted">${dynamicTextHtml(c.baseUrl)} · ${c.protocol === "chat" ? "Chat Completions" : "Responses"}</p><p class="muted">${c.models.length}개 모델 · ${c.auth.kind === "none" ? "인증 없음" : c.auth.kind === "secret" ? "보호된 API 키" : "Bearer 토큰 파일"}</p><ul>${c.models.map(m => `<li>${dynamicTextHtml(m.name)} <span class="muted">${dynamicTextHtml(m.id)} · 컨텍스트 ${m.contextWindow} · 출력 ${m.maxOutputTokens} · ${m.supportsTools ? "도구 지원 사용자 확인" : "도구 지원 미확인"}</span></li>`).join("")}</ul><div class="actions">${button("apiEdit", "연결 수정", c.id)}${button("apiModels", "모델 관리", c.id)}${button("apiDiscover", "/models 조회", c.id)}${button("apiToggle", c.enabled ? "비활성화" : "활성화", c.id)}${button("apiDelete", "삭제", c.id)}</div></article>`).join("");
  return `<section aria-label="API 연결" data-custom-api><div class="provider"><div class="provider-title"><h2>API</h2><span class="provider-count">${state.connections.length}개 연결</span></div><div class="provider-actions">${button("apiAdd", "API 추가")}${button("apiRefresh", "새로고침")}</div></div><p class="muted">주소와 모델 ID를 직접 등록하세요. 모델 목록 조회는 /models 조회를 눌렀을 때만 실행됩니다.</p>${state.pending ? '<p class="muted" role="status">API 요청 처리 중…</p>' : ""}${state.error ? `<p class="error" role="alert">${state.error}</p>` : ""}<div class="provider-group">${cards || '<p class="empty-state muted">등록된 API 연결이 없습니다. API 추가로 시작하세요.</p>'}</div>${!state.backend.enabled ? '<p class="muted">API 연결 관리 도우미가 준비되지 않았습니다.</p>' : ""}</section>`;
}

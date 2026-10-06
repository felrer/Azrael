import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { InstructionAction, InstructionRequest, InstructionUiPort, InstructionUiState } from "./instructionProtocol";

const actions = new Set<InstructionAction>(["refresh", "selectVersion", "preview", "download", "apply", "pin", "unpin", "rollback"]);
const escape = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
interface Mount { clientId: string; requestId: string; disposal?: vscode.Disposable }

export const instructionStyles = `:host,body{color:var(--vscode-foreground,#262626);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}main{max-width:900px;margin:auto;padding:20px 28px}h1{font-size:22px;font-weight:600;margin:0 0 24px}h2{font-size:15px;font-weight:600;margin:24px 0 12px}p{margin:8px 0}.row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid var(--vscode-widget-border,#ddd)}.muted,small{color:var(--vscode-descriptionForeground,#777)}button,select,input{font:inherit;color:inherit}button,select{border:1px solid var(--vscode-widget-border,#ddd);border-radius:8px;background:var(--vscode-editor-background,#fff);padding:7px 12px}button{cursor:pointer}button:hover,button[aria-current=true]{background:var(--vscode-list-hoverBackground,#eee)}button:disabled{opacity:.5;cursor:default}:focus-visible{outline:2px solid var(--vscode-focusBorder,#777);outline-offset:2px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.documents{display:grid;grid-template-columns:minmax(160px,1fr) minmax(0,2fr);gap:16px}.list{max-height:360px;overflow:auto}.list button{display:block;border:0;text-align:left;width:100%;margin-bottom:3px;overflow-wrap:anywhere}.preview{white-space:pre-wrap;overflow-wrap:anywhere;max-height:440px;overflow:auto;margin:0;padding:16px;border-radius:10px;background:var(--vscode-textCodeBlock-background,#f5f5f5);font:12px/1.6 var(--vscode-editor-font-family,monospace)}.notice{border-radius:8px;padding:12px;background:var(--vscode-textBlockQuote-background,#eee)}.error{color:var(--vscode-errorForeground,#b22)}fieldset{border:0;padding:0;margin:0}label.component{display:flex;align-items:center;gap:10px;padding:8px 0}.diff{display:grid;grid-template-columns:1fr 1fr;gap:12px}svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.3}aside{width:190px;padding:24px 12px;flex-shrink:0}aside button{display:flex;align-items:center;gap:10px;width:100%;border:0;text-align:left;margin-bottom:4px}body{margin:0;background:var(--vscode-editor-background,#fff)}.shell{display:flex;min-height:100vh}.shell main{width:100%}@media(max-width:650px){main{padding:16px}.documents,.diff{grid-template-columns:1fr}aside{width:145px;padding:16px 6px}.row{align-items:flex-start;flex-direction:column}}`;

export function renderInstructionMarkup(state: InstructionUiState, selected: readonly string[] = state.selectedComponentIds ?? state.components.filter(c => c.default).map(c => c.id)): string {
  const version = state.selectedVersion ?? state.pinnedVersion ?? state.versions.find(v => v.compatible && !v.prerelease)?.version;
  const release = state.versions.find(v => v.version === version);
  const disabled = state.busy ? " disabled" : "";
  const unavailable = !release?.compatible;
  const button = (action: string, title: string, blocked = false) => `<button type="button" data-action="${action}"${disabled || (blocked ? " disabled" : "")}>${title}</button>`;
  return `<style>${instructionStyles}</style><main aria-label="지침 문서" aria-busy="${!!state.busy}"><h1>지침 문서 (미구현)</h1>
  <div class="row"><span>배포 소스</span><span>${escape(state.repository)}</span></div>
  <div class="row"><span>현재 적용 버전</span><span>${escape(state.currentVersion ?? "적용되지 않음")}</span></div>
  <div class="row"><span>최신 호환 버전</span><span>${escape(state.versions.find(v => v.compatible && !v.prerelease)?.version ?? "확인 필요")}</span></div>
  <div class="row"><span>고정 버전</span><span>${escape(state.pinnedVersion ?? "고정되지 않음")}</span></div>
  <div class="row"><label for="instruction-version">선택 버전</label><select id="instruction-version" data-action="selectVersion"${disabled}><option value="">버전 선택</option>${state.versions.map(v => `<option value="${escape(v.version)}"${v.version === version ? " selected" : ""}${!v.compatible ? " disabled" : ""}>${escape(v.version)}${v.compatible ? "" : " (호환되지 않음)"}${state.downloadedVersions.includes(v.version) ? " · 다운로드됨" : ""}</option>`).join("")}</select></div>
  <p class="muted">다운로드는 전체 패키지를 저장합니다. 적용은 선택한 구성 요소만 변경하며, 실행 중인 대화는 기존 지침을 유지합니다.</p>
  ${release ? `<h2>변경 내용</h2><pre class="preview">${escape(release.notes)}</pre>` : ""}
  ${state.busy ? `<p class="notice" role="status">${escape(state.busy)}…</p>` : ""}${state.message ? `<p role="status">${escape(state.message)}</p>` : ""}${state.error ? `<p class="notice error" role="alert">${escape(state.error)}</p>` : ""}
  <h2>적용할 구성 요소</h2><fieldset aria-label="적용할 구성 요소"${disabled}>${state.components.map(c => `<label class="component"><input type="checkbox" data-component="${escape(c.id)}"${selected.includes(c.id) ? " checked" : ""}>${escape(c.title)} <small>${escape(c.kind)} · ${escape(c.scope)}</small></label>`).join("")}</fieldset>
  <div class="actions">${button("refresh", "업데이트 확인")}${button("download", "전체 패키지 다운로드", unavailable)}${button("apply", state.currentVersion ? "선택 구성 적용 / 업데이트" : "선택 구성 적용", unavailable || !state.downloadedVersions.includes(version ?? "") || state.conflicts.length > 0)}${state.pinnedVersion ? button("unpin", "버전 고정 해제") : button("pin", "선택 버전 고정", unavailable)}${button("rollback", "선택 버전으로 롤백", unavailable || !state.currentVersion || version === state.currentVersion || !state.downloadedVersions.includes(version ?? ""))}</div>
  ${state.conflicts.length ? `<section aria-label="로컬 변경 충돌"><h2>로컬 변경 충돌</h2><p class="notice">기존 문서가 변경되었거나 관리되지 않습니다. 적용이 중단되었습니다. 내용을 검토하고 로컬 변경을 직접 해결한 뒤 다시 확인하세요.</p>${state.conflicts.map(c => `<h2>${escape(c.target)}</h2><p>${escape(c.reason)}</p><div class="diff"><div><p>현재 내용</p><pre class="preview">${escape(c.current)}</pre></div><div><p>제안 내용</p><pre class="preview">${escape(c.proposed)}</pre></div></div>`).join("")}</section>` : ""}
  <h2>문서 미리보기</h2><div class="documents"><nav class="list" aria-label="지침 문서 목록">${state.documents.map(d => `<button type="button" data-action="preview" data-path="${escape(d.path)}" aria-current="${d.path === state.preview?.path}"${disabled}><small>${escape(d.kind)}</small><br>${escape(d.title)}<br><small>${escape(d.path)}</small></button>`).join("") || '<p class="muted">버전을 선택해 문서를 확인하세요.</p>'}</nav><section aria-label="문서 내용"><p>${escape(state.preview?.path ?? "문서를 선택하세요")}</p><pre class="preview" tabindex="0">${escape(state.preview?.text)}</pre></section></div></main>`;
}

/** One listener per mount; the host service owns all network and file operations. */
export class InstructionView implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private mounts = new Map<vscode.Webview, Mount>();
  private disposed = false;
  private busy = false;
  private selected = new Set<string>();
  private selectionInitialized = false;
  private state?: InstructionUiState;
  constructor(private readonly port: InstructionUiPort) {}

  show(): void {
    if (this.disposed) return;
    if (!this.panel) {
      const panel = vscode.window.createWebviewPanel("azrael.settings", "Azrael 설정", vscode.ViewColumn.Active, { enableScripts: true });
      this.panel = panel;
      panel.webview.onDidReceiveMessage(message => {
        if (message?.type === "instruction-open-settings") void vscode.commands.executeCommand("workbench.action.openSettings", "azrael.instructions.repository");
        else void this.handleEmbedded(panel.webview, message, panel);
      });
      panel.onDidDispose(() => { if (this.panel === panel) this.panel = undefined; this.remove(panel.webview); });
      const nonce = randomBytes(18).toString("hex");
      panel.webview.html = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><style nonce="${nonce}">${instructionStyles}#content{width:100%}</style></head><body><div class="shell"><aside aria-label="설정"><button data-section="general"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6"/><circle cx="10" cy="10" r="2"/></svg>일반</button><button data-section="instructions" aria-current="true"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h7l3 3v12H5z M8 8h4 M8 11h4 M8 14h4"/></svg>지침 문서 (미구현)</button></aside><div id="content"></div></div><script nonce="${nonce}">(${standaloneClient.toString()})(${JSON.stringify(nonce)},${JSON.stringify(instructionStyles)});</script></body></html>`;
    }
    this.panel.reveal();
  }

  async handleEmbedded(webview: vscode.Webview, request: unknown, panel?: vscode.WebviewPanel): Promise<void> {
    if (this.disposed || !record(request) || request.type !== "azrael-instructions" || typeof request.clientId !== "string" || !request.clientId || request.clientId.length > 128 || typeof request.requestId !== "string" || !request.requestId || request.requestId.length > 128) return;
    if (request.action === "unmount") { if (this.mounts.get(webview)?.clientId === request.clientId) this.remove(webview); return; }
    if (request.action === "mount") {
      this.remove(webview);
      const mount: Mount = { clientId: request.clientId, requestId: request.requestId };
      this.mounts.set(webview, mount);
      mount.disposal = panel?.onDidDispose(() => { if (this.mounts.get(webview) === mount) this.remove(webview); });
      try { const state = await this.port.snapshot(); if (this.mounts.get(webview) === mount) { this.state = state; this.initializeSelection(state); await this.respond(webview, mount, this.busy ? { ...state, busy: "처리 중" } : state); } }
      catch (error) { if (this.mounts.get(webview) === mount) await this.respondError(webview, mount, error); }
      return;
    }
    const mount = this.mounts.get(webview);
    if (!mount || mount.clientId !== request.clientId || !actions.has(request.action as InstructionAction)) return;
    const payload = record(request.message) ? request.message : {};
    if ((payload.version !== undefined && typeof payload.version !== "string") || (payload.path !== undefined && typeof payload.path !== "string") || (payload.componentIds !== undefined && (!Array.isArray(payload.componentIds) || payload.componentIds.some(id => typeof id !== "string")))) return;
    if (this.busy) { mount.requestId = request.requestId; if (this.state) await this.respond(webview, mount, { ...this.state, busy: "처리 중" }); return; }
    const action = request.action as InstructionAction;
    mount.requestId = request.requestId;
    this.busy = true;
    if (payload.componentIds) this.selected = new Set(payload.componentIds as string[]);
    try {
      if (this.state) await this.respond(webview, mount, { ...this.state, busy: "처리 중" });
      const result = await this.port.request(action, payload as InstructionRequest);
      this.state = result;
      this.initializeSelection(result);
      if (this.mounts.get(webview) === mount) await this.respond(webview, mount);
    } catch (error) { if (this.mounts.get(webview) === mount) await this.respondError(webview, mount, error); }
    finally { this.busy = false; for (const [other, target] of this.mounts) if (target !== mount) await this.respond(other, target); }
  }

  private initializeSelection(state: InstructionUiState): void {
    if (!this.selectionInitialized && state.components.length) { this.selected = new Set(state.selectedComponentIds ?? state.components.filter(c => c.default).map(c => c.id)); this.selectionInitialized = true; }
  }
  private async respond(webview: vscode.Webview, mount: Mount, state = this.state): Promise<void> {
    if (!state || this.disposed || this.mounts.get(webview) !== mount) return;
    try {
      const delivered = await webview.postMessage({ type: "azrael-instructions-state", clientId: mount.clientId, requestId: mount.requestId, html: renderInstructionMarkup(state, [...this.selected]) });
      if (!delivered && this.mounts.get(webview) === mount) this.remove(webview);
    } catch { if (this.mounts.get(webview) === mount) this.remove(webview); }
  }
  private async respondError(webview: vscode.Webview, mount: Mount, error: unknown): Promise<void> {
    const base = this.state ?? { repository: "", currentVersion: null, pinnedVersion: null, selectedVersion: null, versions: [], downloadedVersions: [], components: [], documents: [], conflicts: [] };
    await this.respond(webview, mount, { ...base, busy: undefined, error: error instanceof Error ? error.message : String(error) });
  }
  private remove(webview: vscode.Webview): void { const mount = this.mounts.get(webview); this.mounts.delete(webview); mount?.disposal?.dispose(); }
  dispose(): void { this.disposed = true; for (const webview of this.mounts.keys()) this.remove(webview); this.panel?.dispose(); this.panel = undefined; }
}

// This function executes in the webview, without host access except the VS Code bridge.
function standaloneClient(nonce: string, styles: string): void {
  const vscode = (globalThis as any).acquireVsCodeApi();
  const content = (globalThis as any).document.getElementById("content");
  const root = content.attachShadow({ mode: "open" });
  let clientId = (globalThis as any).crypto.randomUUID(), counter = 0, active = true, busy = false, requestId = "", debounce = 0;
  let lastHtml = "";
  const send = (action: string, message?: unknown) => { requestId = String(++counter); vscode.postMessage({ type: "azrael-instructions", clientId, requestId, action, message }); };
  const payload = () => ({ version: root.querySelector("select")?.value, componentIds: [...root.querySelectorAll("input[data-component]:checked")].map((e: any) => e.dataset.component) });
  const render = (html: string) => { root.innerHTML = html.includes("<style>") ? html.replace("<style>", `<style nonce="${nonce}">`) : `<style nonce="${nonce}">${styles}</style>${html}`; };
  (globalThis as any).addEventListener("message", (event: any) => {
    const m = event.data;
    if (!active || m.type !== "azrael-instructions-state" || m.clientId !== clientId || m.requestId !== requestId || typeof m.html !== "string") return;
    lastHtml = m.html; render(lastHtml); busy = root.querySelector('main[aria-busy="true"]') !== null;
  });
  root.addEventListener("click", (event: any) => {
    const b = event.target.closest("button[data-action]");
    if (!b || b.disabled || busy) return;
    busy = true; send(b.dataset.action, { ...payload(), path: b.dataset.path });
  });
  root.addEventListener("change", (event: any) => {
    if (event.target.dataset.action !== "selectVersion") return;
    (globalThis as any).clearTimeout(debounce);
    debounce = (globalThis as any).setTimeout(() => { if (!busy && active) { busy = true; send("selectVersion", payload()); } }, 150);
  });
  (globalThis as any).document.querySelector("aside").addEventListener("click", (event: any) => {
    const b = event.target.closest("button[data-section]"); if (!b) return;
    for (const item of (globalThis as any).document.querySelectorAll("aside button")) item.setAttribute("aria-current", String(item === b));
    if (b.dataset.section === "general") { (globalThis as any).clearTimeout(debounce); if (active) send("unmount"); active = false; render('<main><h1>일반</h1><p>지침 배포 소스는 Azrael의 VS Code 설정에서 변경할 수 있습니다.</p><button data-open-settings>배포 소스 설정 열기</button></main>'); root.querySelector("button").onclick = () => vscode.postMessage({ type: "instruction-open-settings" }); }
    else if (!active) { active = true; clientId = (globalThis as any).crypto.randomUUID(); busy = false; render(lastHtml || '<main role="status">불러오는 중…</main>'); send("mount"); }
  });
  (globalThis as any).addEventListener("pagehide", () => { if (active) send("unmount"); active = false; });
  render('<main role="status">불러오는 중…</main>'); send("mount");
}

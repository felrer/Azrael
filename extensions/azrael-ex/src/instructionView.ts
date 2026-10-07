import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { InstructionAction, InstructionRequest, InstructionUiPort, InstructionUiState, InstructionUiText } from "./instructionProtocol";

const actions = new Set<InstructionAction>(["refresh", "selectVersion", "preview", "download", "apply", "pin", "unpin", "rollback"]);
const escape = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
interface Mount { clientId: string; requestId: string; locale: "en" | "ko"; disposal?: vscode.Disposable }

export const normalizeInstructionLocale = (locale: string = vscode.env?.language ?? "en"): "en" | "ko" => /^ko(?:[-_]|$)/i.test(locale) ? "ko" : "en";
export function resolveInstructionText(text: InstructionUiText | readonly InstructionUiText[] | undefined, locale: "en" | "ko"): string {
  if (Array.isArray(text)) return text.map(value => resolveInstructionText(value, locale)).join(" ");
  return typeof text === "string" ? text : text ? (text as { en: string; ko: string })[locale] : "";
}
const busyText: Record<string, { en: string; ko: string }> = {
  processing: { en: "Processing", ko: "처리 중" }, refresh: { en: "Checking for updates", ko: "업데이트 확인 중" },
  selectVersion: { en: "Selecting version", ko: "버전 선택 중" }, preview: { en: "Loading preview", ko: "미리보기 불러오는 중" },
  download: { en: "Downloading", ko: "다운로드 중" }, apply: { en: "Applying", ko: "적용 중" },
  pin: { en: "Pinning version", ko: "버전 고정 중" }, unpin: { en: "Unpinning version", ko: "버전 고정 해제 중" },
  rollback: { en: "Rolling back", ko: "롤백 중" }
};

export const instructionStyles = `:host,body{color:var(--vscode-foreground,#262626);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}main{max-width:900px;margin:auto;padding:20px 28px}h1{font-size:22px;font-weight:600;margin:0 0 24px}h2{font-size:15px;font-weight:600;margin:24px 0 12px}p{margin:8px 0}.row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid var(--vscode-widget-border,#ddd)}.muted,small{color:var(--vscode-descriptionForeground,#777)}button,select,input{font:inherit;color:inherit}button,select{border:1px solid var(--vscode-widget-border,#ddd);border-radius:8px;background:var(--vscode-editor-background,#fff);padding:7px 12px}button{cursor:pointer}button:hover,button[aria-current=true]{background:var(--vscode-list-hoverBackground,#eee)}button:disabled{opacity:.5;cursor:default}:focus-visible{outline:2px solid var(--vscode-focusBorder,#777);outline-offset:2px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.documents{display:grid;grid-template-columns:minmax(160px,1fr) minmax(0,2fr);gap:16px}.list{max-height:360px;overflow:auto}.list button{display:block;border:0;text-align:left;width:100%;margin-bottom:3px;overflow-wrap:anywhere}.preview{white-space:pre-wrap;overflow-wrap:anywhere;max-height:440px;overflow:auto;margin:0;padding:16px;border-radius:10px;background:var(--vscode-textCodeBlock-background,#f5f5f5);font:12px/1.6 var(--vscode-editor-font-family,monospace)}.notice{border-radius:8px;padding:12px;background:var(--vscode-textBlockQuote-background,#eee)}.error{color:var(--vscode-errorForeground,#b22)}fieldset{border:0;padding:0;margin:0}label.component{display:flex;align-items:center;gap:10px;padding:8px 0}.diff{display:grid;grid-template-columns:1fr 1fr;gap:12px}svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.3}aside{width:190px;padding:24px 12px;flex-shrink:0}aside button{display:flex;align-items:center;gap:10px;width:100%;border:0;text-align:left;margin-bottom:4px}body{margin:0;background:var(--vscode-editor-background,#fff)}.shell{display:flex;min-height:100vh}.shell main{width:100%}@media(max-width:650px){main{padding:16px}.documents,.diff{grid-template-columns:1fr}aside{width:145px;padding:16px 6px}.row{align-items:flex-start;flex-direction:column}}`;

export function renderInstructionMarkup(state: InstructionUiState, selected: readonly string[] = state.selectedComponentIds ?? state.components.filter(c => c.default).map(c => c.id), locale?: string): string {
  const language = normalizeInstructionLocale(locale);
  const t = (en: string, ko: string) => language === "ko" ? ko : en;
  const text = (value: InstructionUiText | readonly InstructionUiText[] | undefined) => escape(resolveInstructionText(value, language));
  const version = state.selectedVersion ?? state.pinnedVersion ?? state.versions.find(v => v.compatible && !v.prerelease)?.version;
  const release = state.versions.find(v => v.version === version);
  const disabled = state.busy ? " disabled" : "";
  const unavailable = !release?.compatible;
  const button = (action: string, title: string, blocked = false) => `<button type="button" data-action="${action}"${disabled || (blocked ? " disabled" : "")}>${title}</button>`;
  return `<style>${instructionStyles}</style><main lang="${language}" aria-label="${t("Instruction Documents", "지침 문서")}" aria-busy="${!!state.busy}"><h1>${t("Instruction Documents (Not implemented)", "지침 문서 (미구현)")}</h1>
  <div class="row"><span>${t("Distribution source", "배포 소스")}</span><span>${escape(state.repository)}</span></div>
  <div class="row"><span>${t("Current applied version", "현재 적용 버전")}</span><span>${escape(state.currentVersion ?? t("Not applied", "적용되지 않음"))}</span></div>
  <div class="row"><span>${t("Latest compatible version", "최신 호환 버전")}</span><span>${escape(state.versions.find(v => v.compatible && !v.prerelease)?.version ?? t("Check required", "확인 필요"))}</span></div>
  <div class="row"><span>${t("Pinned version", "고정 버전")}</span><span>${escape(state.pinnedVersion ?? t("Not pinned", "고정되지 않음"))}</span></div>
  <div class="row"><label for="instruction-version">${t("Selected version", "선택 버전")}</label><select id="instruction-version" data-action="selectVersion"${disabled}><option value="">${t("Select a version", "버전 선택")}</option>${state.versions.map(v => `<option value="${escape(v.version)}"${v.version === version ? " selected" : ""}${!v.compatible ? " disabled" : ""}>${escape(v.version)}${v.compatible ? "" : t(" (Incompatible)", " (호환되지 않음)")}${state.downloadedVersions.includes(v.version) ? t(" · Downloaded", " · 다운로드됨") : ""}</option>`).join("")}</select></div>
  <p class="muted">${t("Downloading saves the full package. Applying changes only the selected components. Active conversations retain their existing instructions.", "다운로드는 전체 패키지를 저장합니다. 적용은 선택한 구성 요소만 변경하며, 실행 중인 대화는 기존 지침을 유지합니다.")}</p>
  ${release ? `<h2>${t("Release notes", "변경 내용")}</h2><pre class="preview">${text(release.notes)}</pre>` : ""}
  ${state.busy ? `<p class="notice" role="status">${text(busyText[state.busy] ?? state.busy)}…</p>` : ""}${state.message ? `<p role="status">${text(state.message)}</p>` : ""}${state.error ? `<p class="notice error" role="alert">${text(state.error)}</p>` : ""}
  <h2>${t("Components to apply", "적용할 구성 요소")}</h2><fieldset aria-label="${t("Components to apply", "적용할 구성 요소")}"${disabled}>${state.components.map(c => `<label class="component"><input type="checkbox" data-component="${escape(c.id)}"${selected.includes(c.id) ? " checked" : ""}>${escape(c.title)} <small>${escape(c.kind)} · ${escape(c.scope)}</small></label>`).join("")}</fieldset>
  <div class="actions">${button("refresh", t("Check for updates", "업데이트 확인"))}${button("download", t("Download full package", "전체 패키지 다운로드"), unavailable)}${button("apply", state.currentVersion ? t("Apply / update selected components", "선택 구성 적용 / 업데이트") : t("Apply selected components", "선택 구성 적용"), unavailable || !state.downloadedVersions.includes(version ?? "") || state.conflicts.length > 0)}${state.pinnedVersion ? button("unpin", t("Unpin version", "버전 고정 해제")) : button("pin", t("Pin selected version", "선택 버전 고정"), unavailable)}${button("rollback", t("Roll back to selected version", "선택 버전으로 롤백"), unavailable || !state.currentVersion || version === state.currentVersion || !state.downloadedVersions.includes(version ?? ""))}</div>
  ${state.conflicts.length ? `<section aria-label="${t("Local change conflicts", "로컬 변경 충돌")}"><h2>${t("Local change conflicts", "로컬 변경 충돌")}</h2><p class="notice">${t("Existing documents have been modified or are unmanaged. Applying has stopped. Review the contents and resolve local changes before checking again.", "기존 문서가 변경되었거나 관리되지 않습니다. 적용이 중단되었습니다. 내용을 검토하고 로컬 변경을 직접 해결한 뒤 다시 확인하세요.")}</p>${state.conflicts.map(c => `<h2>${escape(c.target)}</h2><p>${escape(c.reason)}</p><div class="diff"><div><p>${t("Current content", "현재 내용")}</p><pre class="preview">${escape(c.current)}</pre></div><div><p>${t("Proposed content", "제안 내용")}</p><pre class="preview">${escape(c.proposed)}</pre></div></div>`).join("")}</section>` : ""}
  <h2>${t("Document preview", "문서 미리보기")}</h2><div class="documents"><nav class="list" aria-label="${t("Instruction document list", "지침 문서 목록")}">${state.documents.map(d => `<button type="button" data-action="preview" data-path="${escape(d.path)}" aria-current="${d.path === state.preview?.path}"${disabled}><small>${escape(d.kind)}</small><br>${escape(d.title)}<br><small>${escape(d.path)}</small></button>`).join("") || `<p class="muted">${t("Select a version to browse documents.", "버전을 선택해 문서를 확인하세요.")}</p>`}</nav><section aria-label="${t("Document content", "문서 내용")}"><p>${escape(state.preview?.path ?? t("Select a document", "문서를 선택하세요"))}</p><pre class="preview" tabindex="0">${escape(state.preview?.text)}</pre></section></div></main>`;
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
      const locale = normalizeInstructionLocale();
      const t = (en: string, ko: string) => locale === "ko" ? ko : en;
      const shellText = { general: t("General", "일반"), description: t("Change the instruction distribution source in Azrael’s VS Code settings.", "지침 배포 소스는 Azrael의 VS Code 설정에서 변경할 수 있습니다."), openSettings: t("Open distribution source settings", "배포 소스 설정 열기"), loading: t("Loading…", "불러오는 중…") };
      const panel = vscode.window.createWebviewPanel("azrael.settings", t("Azrael Settings", "Azrael 설정"), vscode.ViewColumn.Active, { enableScripts: true });
      this.panel = panel;
      panel.webview.onDidReceiveMessage(message => {
        if (message?.type === "instruction-open-settings") void vscode.commands.executeCommand("workbench.action.openSettings", "azrael.instructions.repository");
        else void this.handleEmbedded(panel.webview, message, panel);
      });
      panel.onDidDispose(() => { if (this.panel === panel) this.panel = undefined; this.remove(panel.webview); });
      const nonce = randomBytes(18).toString("hex");
      panel.webview.html = `<!doctype html><html lang="${locale}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><style nonce="${nonce}">${instructionStyles}#content{width:100%}</style></head><body><div class="shell"><aside aria-label="${t("Settings", "설정")}"><button data-section="general"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6"/><circle cx="10" cy="10" r="2"/></svg>${shellText.general}</button><button data-section="instructions" aria-current="true"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h7l3 3v12H5z M8 8h4 M8 11h4 M8 14h4"/></svg>${t("Instruction Documents", "지침 문서")}</button></aside><div id="content"></div></div><script nonce="${nonce}">(${standaloneClient.toString()})(${JSON.stringify(nonce)},${JSON.stringify(instructionStyles)},${JSON.stringify(locale)},${JSON.stringify(shellText)});</script></body></html>`;
    }
    this.panel.reveal();
  }

  async handleEmbedded(webview: vscode.Webview, request: unknown, panel?: vscode.WebviewPanel): Promise<void> {
    if (this.disposed || !record(request) || request.type !== "azrael-instructions" || typeof request.clientId !== "string" || !request.clientId || request.clientId.length > 128 || typeof request.requestId !== "string" || !request.requestId || request.requestId.length > 128) return;
    if (request.action === "unmount") { if (this.mounts.get(webview)?.clientId === request.clientId) this.remove(webview); return; }
    if (request.action === "mount") {
      if ("locale" in request && (typeof request.locale !== "string" || request.locale.length > 128)) return;
      this.remove(webview);
      const mount: Mount = { clientId: request.clientId, requestId: request.requestId, locale: normalizeInstructionLocale(request.locale as string | undefined) };
      this.mounts.set(webview, mount);
      mount.disposal = panel?.onDidDispose(() => { if (this.mounts.get(webview) === mount) this.remove(webview); });
      try { const state = await this.port.snapshot(); if (this.mounts.get(webview) === mount) { this.state = state; this.initializeSelection(state); await this.respond(webview, mount, this.busy ? { ...state, busy: "processing" } : state); } }
      catch (error) { if (this.mounts.get(webview) === mount) await this.respondError(webview, mount, error); }
      return;
    }
    const mount = this.mounts.get(webview);
    if (!mount || mount.clientId !== request.clientId || !actions.has(request.action as InstructionAction)) return;
    const payload = record(request.message) ? request.message : {};
    if ((payload.version !== undefined && typeof payload.version !== "string") || (payload.path !== undefined && typeof payload.path !== "string") || (payload.componentIds !== undefined && (!Array.isArray(payload.componentIds) || payload.componentIds.some(id => typeof id !== "string")))) return;
    if (this.busy) { mount.requestId = request.requestId; if (this.state) await this.respond(webview, mount, { ...this.state, busy: "processing" }); return; }
    const action = request.action as InstructionAction;
    mount.requestId = request.requestId;
    this.busy = true;
    if (payload.componentIds) this.selected = new Set(payload.componentIds as string[]);
    try {
      if (this.state) await this.respond(webview, mount, { ...this.state, busy: action });
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
      const delivered = await webview.postMessage({ type: "azrael-instructions-state", clientId: mount.clientId, requestId: mount.requestId, html: renderInstructionMarkup(state, [...this.selected], mount.locale) });
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
function standaloneClient(nonce: string, styles: string, locale: string, text: { general: string; description: string; openSettings: string; loading: string }): void {
  const vscode = (globalThis as any).acquireVsCodeApi();
  const content = (globalThis as any).document.getElementById("content");
  const root = content.attachShadow({ mode: "open" });
  let clientId = (globalThis as any).crypto.randomUUID(), counter = 0, active = true, busy = false, requestId = "", debounce = 0;
  let lastHtml = "";
  const send = (action: string, message?: unknown) => { requestId = String(++counter); vscode.postMessage({ type: "azrael-instructions", clientId, requestId, action, message, ...(action === "mount" ? { locale } : {}) }); };
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
    if (b.dataset.section === "general") { (globalThis as any).clearTimeout(debounce); if (active) send("unmount"); active = false; render(`<main lang="${locale}"><h1>${text.general}</h1><p>${text.description}</p><button data-open-settings>${text.openSettings}</button></main>`); root.querySelector("button").onclick = () => vscode.postMessage({ type: "instruction-open-settings" }); }
    else if (!active) { active = true; clientId = (globalThis as any).crypto.randomUUID(); busy = false; render(lastHtml || `<main lang="${locale}" role="status">${text.loading}</main>`); send("mount"); }
  });
  (globalThis as any).addEventListener("pagehide", () => { if (active) send("unmount"); active = false; });
  render(`<main lang="${locale}" role="status">${text.loading}</main>`); send("mount");
}

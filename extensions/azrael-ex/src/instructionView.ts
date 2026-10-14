import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { InstructionAction, InstructionRequest, InstructionUiPort, InstructionUiState, InstructionUiText } from "./instructionProtocol";

const actions = new Set<InstructionAction>(["refresh", "selectVersion", "preview", "download", "apply", "pin", "unpin", "rollback", "libraryRefresh", "libraryImport", "libraryCreate", "librarySelect", "librarySave", "libraryPlanApply", "libraryApply", "libraryPlanPublish", "libraryPublish", "libraryRecover", "libraryConnect", "libraryRemoteRefresh", "libraryRemoteImport", "libraryPrepareTask", "libraryStartTask"]);
const escape = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
interface Mount { clientId: string; requestId: string; locale: "en" | "ko"; disposal?: vscode.Disposable }

/** Structural limits here precede the service's semantic and filesystem validation. */
export function validInstructionRequest(value: Record<string, unknown>): boolean {
  const string = (v: unknown, max = 4096) => typeof v === "string" && v.length <= max;
  if (Object.keys(value).some(key => !["version", "path", "componentIds", "id", "ids", "name", "kind", "sharing", "files", "profile", "revision", "token", "repository", "branch", "model", "provider", "reasoningEffort"].includes(key))) return false;
  for (const key of ["version", "path", "id", "name", "token", "repository", "branch", "model", "provider", "reasoningEffort"]) if (value[key] !== undefined && !string(value[key])) return false;
  for (const key of ["ids", "componentIds"]) if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].length > 1000 || value[key].some(v => !string(v)))) return false;
  if (value.kind !== undefined && !["skill", "agent-role", "context", "task-profile"].includes(value.kind as string)) return false;
  if (value.sharing !== undefined && !["public", "collaborators", "local"].includes(value.sharing as string)) return false;
  if (value.revision !== undefined && (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0)) return false;
  if (value.files !== undefined) {
    if (!Array.isArray(value.files) || value.files.length > 10000) return false;
    let size = 0;
    for (const file of value.files) {
      // Base64 needs up to 4/3 of the backend's 16 MiB per-file byte limit.
      if (!record(file) || !string(file.path) || !["utf8", "base64"].includes(file.encoding as string) || !string(file.content, 24 * 1024 * 1024)) return false;
      size += (file.content as string).length;
    }
    if (size > 192 * 1024 * 1024) return false;
  }
  if (value.profile !== undefined) {
    const p = value.profile;
    if (!record(p) || !string(p.model) || !Array.isArray(p.dependencies) || p.dependencies.length > 1000) return false;
    for (const key of ["provider", "reasoningEffort"]) if (p[key] !== undefined && !string(p[key])) return false;
    if (p.instructions !== undefined && !string(p.instructions, 1024 * 1024)) return false;
    for (const d of p.dependencies) if (!record(d) || !string(d.id) || !string(d.digest) || (d.optional !== undefined && typeof d.optional !== "boolean")) return false;
    try { if (JSON.stringify(p).length > 8 * 1024 * 1024) return false; } catch { return false; }
  }
  return true;
}

function renderLibrary(state: InstructionUiState, locale: "en" | "ko"): string {
  const library = state.library;
  if (!library) return "";
  const t = (en: string, ko: string) => locale === "ko" ? ko : en;
  const selected = library.selected;
  const button = (action: string, title: string, data = "", blocked = false) => `<button type="button" data-action="${action}" ${data}${state.busy || blocked ? " disabled" : ""}>${title}</button>`;
  const kinds = [["skill", "Skill", "스킬"], ["agent-role", "Agent role", "에이전트 역할"], ["context", "Context", "컨텍스트"], ["task-profile", "Task profile", "작업 프로필"]];
  const classes = [["collaborators", "Collaborators", "협업자"], ["public", "Public", "공개"], ["local", "Local only", "로컬 전용"]];
  const options = (values: string[][], current?: string) => values.map(([id, en, ko]) => `<option value="${id}"${id === current ? " selected" : ""}>${t(en, ko)}</option>`).join("");
  const input = (name: string, title: string, value = "") => `<label>${title}<input data-field="${name}" value="${escape(value)}"></label>`;
  const data = selected ? `data-id="${escape(selected.id)}"` : "";
  const plan = library.plan;
  const conflicts = plan?.conflicts ?? [];
  return `<section aria-label="${t("Instruction library", "지침 라이브러리")}" data-library-revision="${library.revision}">
    <h2>${t("Library", "라이브러리")}</h2><p class="muted">${t("Save edits locally before planning. Plans use saved source; apply and publish each require a separate reviewed plan. Task profiles affect only the selected new conversation.", "계획을 준비하기 전에 편집을 로컬에 저장하세요. 계획은 저장된 소스를 사용하며, 적용과 게시에는 각각 검토한 계획이 필요합니다. 작업 프로필은 선택한 새 대화에만 적용됩니다.")}</p>
    <div class="library-fields"><label>${t("Search", "검색")}<input data-filter="search" type="search"></label><label>${t("Kind", "종류")}<select data-filter="kind"><option value="">${t("All kinds", "모든 종류")}</option>${options(kinds)}</select></label><label>${t("Sharing", "공유")}<select data-filter="sharing"><option value="">${t("All sharing", "모든 공유")}</option>${options(classes)}</select></label></div>
    <div class="actions">${button("libraryRefresh", t("Refresh library", "라이브러리 새로고침"))}${button("libraryImport", t("Import source folder…", "소스 폴더 가져오기…"))}</div>
    <details><summary>${t("Create resource", "리소스 만들기")}</summary><div class="library-fields">${input("create-name", t("Name", "이름"))}<label>${t("Kind", "종류")}<select data-field="create-kind">${options(kinds, "skill")}</select></label><label>${t("Sharing", "공유")}<select data-field="create-sharing">${options(classes, "collaborators")}</select></label></div>${button("libraryCreate", t("Create", "만들기"))}</details>
    <div class="documents"><nav class="list" aria-label="${t("Library entries", "라이브러리 항목")}">${library.entries.map(entry => `<button class="library-entry" data-action="librarySelect" data-id="${escape(entry.id)}" data-name="${escape(entry.name)}" data-kind="${escape(entry.kind)}" data-sharing="${escape(entry.sharing)}" aria-current="${entry.id === selected?.id}"${state.busy ? " disabled" : ""}>${escape(entry.name)}<br><small>${escape(entry.kind)} · ${escape(entry.sharing)} · ${entry.installedDigest ? (entry.installedDigest === entry.digest ? t("Applied", "적용됨") : t("Local changes", "로컬 변경")) : t("Not applied", "미적용")}${entry.publications.length ? t(" · Previously published", " · 이전 게시됨") : t(" · Not published", " · 미게시")}${entry.validationErrors.length ? t(" · Invalid draft", " · 유효하지 않은 초안") : ""}</small></button>`).join("") || `<p>${t("Import a folder or create a resource to begin.", "폴더를 가져오거나 리소스를 만드세요.")}</p>`}</nav>
    <section data-editor-id="${escape(selected?.id ?? "")}" aria-label="${t("Resource editor", "리소스 편집기")}">${selected ? `<h2>${escape(selected.name)}</h2><div class="library-fields">${input("name", t("Name", "이름"), selected.name)}<label>${t("Sharing", "공유")}<select data-field="sharing">${options(classes, selected.sharing)}</select></label></div>
      <p class="muted">${escape(selected.kind)} · ${escape(selected.digest)}</p>
      ${selected.profile ? `<label>${t("Profile JSON (dependencies pin IDs and digests)", "프로필 JSON (의존성 ID와 다이제스트 고정)")}<textarea data-field="profile">${escape(JSON.stringify(selected.profile, null, 2))}</textarea></label>` : `<label>${t("Support files", "지원 파일")}<select data-field="file-path">${(selected.files ?? []).map(file => `<option value="${escape(file.path)}">${escape(file.path)}${file.encoding === "base64" ? t(" (binary, preserved)", " (바이너리, 보존됨)") : ""}</option>`).join("")}</select></label>${(selected.files ?? []).map((file, index) => `<label data-file-panel="${escape(file.path)}"${index ? " hidden" : ""}>${escape(file.path)}<textarea data-file-path="${escape(file.path)}" data-encoding="${file.encoding}"${file.encoding === "base64" ? " readonly" : ""}>${escape(file.content)}</textarea></label>`).join("")}`}
      <p class="error" data-client-error role="alert"></p>${selected.validationErrors.map(error => `<p class="error" role="alert">${escape(error)}</p>`).join("")}
      ${selected.publications.map(pub => `<p>${t("Previously published", "이전 게시됨")}: ${escape(pub.repository)} · ${escape(pub.version)} · ${escape(pub.commit ?? pub.digest)}</p>`).join("")}
      <div class="library-fields">${input("publish-version", t("Publication version", "게시 버전"), "0.1.0")}</div><div class="actions">${button("librarySave", t("Save locally", "로컬 저장"), data)}${button("libraryPlanApply", t("Plan apply", "적용 계획"), data, !!selected.validationErrors.length)}${button("libraryPlanPublish", t("Plan publish", "게시 계획"), data, !!selected.validationErrors.length || selected.sharing === "local")}</div>
      ${selected.profile ? `<h2>${t("Selected new conversation", "선택한 새 대화")}</h2><p>${t("Recommended model", "권장 모델")}: ${escape(selected.profile.model)}</p><div class="library-fields">${input("model", t("Model override", "모델 변경"), selected.profile.model)}${input("provider", t("Provider", "제공자"), selected.profile.provider)}${input("reasoningEffort", t("Reasoning effort", "추론 수준"), selected.profile.reasoningEffort)}</div>${button("libraryPrepareTask", t("Prepare task", "작업 준비"), data, !!selected.validationErrors.length)}` : ""}` : `<p>${t("Select a resource to edit its complete source.", "전체 소스를 편집할 리소스를 선택하세요.")}</p>`}</section></div>
    ${plan ? `<section data-plan-token="${escape(plan.token)}"><h2>${t("Review frozen plan", "고정된 계획 검토")}: ${escape(plan.kind)}</h2><pre class="preview">${escape(resolveInstructionText(plan.summary, locale))}</pre>${plan.model ? `<p>${t("Effective model", "실제 모델")}: ${escape(plan.model)} · ${escape(plan.provider)}</p>` : ""}${[...(plan.diffs ?? []), ...conflicts].map(diff => `<p>${escape("reason" in diff ? diff.reason : "")} ${escape(diff.target ?? ("path" in diff ? diff.path : ""))}</p><div class="diff"><pre class="preview">${escape(diff.current)}</pre><pre class="preview">${escape(diff.proposed)}</pre></div>`).join("")}${button(plan.kind === "apply" ? "libraryApply" : plan.kind === "publish" ? "libraryPublish" : "libraryStartTask", plan.kind === "apply" ? t("Apply reviewed plan", "검토한 계획 적용") : plan.kind === "publish" ? t("Publish reviewed plan", "검토한 계획 게시") : t("Start selected new task", "선택한 새 작업 시작"), `data-token="${escape(plan.token)}"`, !!conflicts.length)}</section>` : ""}
    <details><summary>${t("Distribution and connections", "배포·연결")}</summary>${["public", "collaborators"].map(sharing => { const connection = library.connections.find(c => c.sharing === sharing); return `<section data-connection="${sharing}"><h2>${sharing === "public" ? t("Public repository", "공개 저장소") : t("Collaborator repository", "협업자 저장소")}</h2><div class="library-fields">${input("repository", t("Repository (owner/name)", "저장소 (소유자/이름)"), connection?.repository)}${input("branch", t("Branch", "브랜치"), connection?.branch ?? "main")}</div><p>${connection ? `${escape(connection.repository)} · ${t("Read", "읽기")}: ${connection.readable === undefined ? t("Unknown", "미확인") : connection.readable} · ${t("Write", "쓰기")}: ${connection.writable === undefined ? t("Unknown", "미확인") : connection.writable}` : t("Not connected", "연결되지 않음")}</p><div class="actions">${button("libraryConnect", t("Connect / check access", "연결 / 권한 확인"), `data-sharing="${sharing}"`)}${button("libraryRemoteRefresh", t("Check remote versions", "원격 버전 확인"), `data-sharing="${sharing}"`)}</div><label>${t("Remote version", "원격 버전")}<select data-field="remote-version">${(library.remoteVersions ?? []).filter(v => v.sharing === sharing).map(v => `<option value="${escape(v.version)}">${escape(v.version)} ${escape(v.notes)}</option>`).join("")}</select></label>${button("libraryRemoteImport", t("Import selected version", "선택 버전 가져오기"), `data-sharing="${sharing}"`, !library.remoteVersions?.some(v => v.sharing === sharing))}</section>`; }).join("")}</details>
    ${library.operation ? `<p class="notice" role="status">${escape(library.operation.phase)} · ${escape(library.operation.repository)} · ${escape(library.operation.version)}</p>${button("libraryRecover", t("Recover operation", "작업 복구"))}` : ""}
  </section>`;
}

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

export const instructionStyles = `:host,body{color:var(--vscode-foreground,#262626);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}main{max-width:900px;margin:auto;padding:20px 28px;overflow-wrap:anywhere}h1{font-size:22px;font-weight:600;margin:0 0 24px}h2{font-size:15px;font-weight:600;margin:24px 0 12px}p{margin:8px 0}.row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid var(--vscode-widget-border,#ddd)}.muted,small{color:var(--vscode-descriptionForeground,#777)}textarea{width:100%;min-height:260px;resize:vertical;background:var(--vscode-input-background,#fff);color:var(--vscode-input-foreground,#262626);border:1px solid var(--vscode-widget-border,#ddd);border-radius:8px;padding:12px;font:12px/1.6 var(--vscode-editor-font-family,monospace)}input:not([type=checkbox]){background:var(--vscode-input-background,#fff);border:1px solid var(--vscode-widget-border,#ddd);border-radius:8px;padding:7px;max-width:100%}.library-fields{display:flex;flex-wrap:wrap;gap:12px}.library-fields label{display:flex;flex-direction:column;gap:4px}.library-entry{padding:10px}details>summary{cursor:pointer;padding:14px 0;font-weight:600}button,select,input{font:inherit;color:inherit}button,select{border:1px solid var(--vscode-widget-border,#ddd);border-radius:8px;background:var(--vscode-editor-background,#fff);padding:7px 12px}button{cursor:pointer}button:hover,button[aria-current=true]{background:var(--vscode-list-hoverBackground,#eee)}button:disabled{opacity:.5;cursor:default}:focus-visible{outline:2px solid var(--vscode-focusBorder,#777);outline-offset:2px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.documents>*{min-width:0}.library-fields>label{min-width:0}select{max-width:100%}.documents{display:grid;grid-template-columns:minmax(160px,1fr) minmax(0,2fr);gap:16px}.list{max-height:360px;overflow:auto}.list button{display:block;border:0;text-align:left;width:100%;margin-bottom:3px;overflow-wrap:anywhere}.preview{white-space:pre-wrap;overflow-wrap:anywhere;max-height:440px;overflow:auto;margin:0;padding:16px;border-radius:10px;background:var(--vscode-textCodeBlock-background,#f5f5f5);font:12px/1.6 var(--vscode-editor-font-family,monospace)}.notice{border-radius:8px;padding:12px;background:var(--vscode-textBlockQuote-background,#eee)}.error{color:var(--vscode-errorForeground,#b22)}fieldset{border:0;padding:0;margin:0}label.component{display:flex;align-items:center;gap:10px;padding:8px 0}.diff{display:grid;grid-template-columns:1fr 1fr;gap:12px}svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.3}aside{width:190px;padding:24px 12px;flex-shrink:0}aside button{display:flex;align-items:center;gap:10px;width:100%;border:0;text-align:left;margin-bottom:4px}body{margin:0;background:var(--vscode-editor-background,#fff)}.shell{display:flex;min-height:100vh}.shell main{width:100%}@media(max-width:650px){main{padding:16px}.documents,.diff{grid-template-columns:minmax(0,1fr)}aside{width:145px;padding:16px 6px}.row{align-items:flex-start;flex-direction:column}}`;

export function renderInstructionMarkup(state: InstructionUiState, selected: readonly string[] = state.selectedComponentIds ?? state.components.filter(c => c.default).map(c => c.id), locale?: string): string {
  const language = normalizeInstructionLocale(locale);
  const t = (en: string, ko: string) => language === "ko" ? ko : en;
  const text = (value: InstructionUiText | readonly InstructionUiText[] | undefined) => escape(resolveInstructionText(value, language));
  const version = state.selectedVersion ?? state.pinnedVersion ?? state.versions.find(v => v.compatible && !v.prerelease)?.version;
  const release = state.versions.find(v => v.version === version);
  const disabled = state.busy ? " disabled" : "";
  const unavailable = !release?.compatible;
  const button = (action: string, title: string, blocked = false) => `<button type="button" data-action="${action}"${disabled || (blocked ? " disabled" : "")}>${title}</button>`;
  return `<style>${instructionStyles}</style><main lang="${language}" aria-label="${t("Instruction Documents", "지침 문서")}" aria-busy="${!!state.busy}"><h1>${t("Instruction Documents", "지침 문서")}</h1>${state.busy ? `<p class="notice" role="status">${text(busyText[state.busy] ?? state.busy)}…</p>` : ""}${state.message ? `<p role="status">${text(state.message)}</p>` : ""}${state.error ? `<p class="notice error" role="alert">${text(state.error)}</p>` : ""}${renderLibrary(state, language)}<details ${state.library ? "" : "open"}><summary>${t("Baseline distribution", "기본 지침 배포")}</summary>
  <div class="row"><span>${t("Distribution source", "배포 소스")}</span><span>${escape(state.repository)}</span></div>
  <div class="row"><span>${t("Current applied version", "현재 적용 버전")}</span><span>${escape(state.currentVersion ?? t("Not applied", "적용되지 않음"))}</span></div>
  <div class="row"><span>${t("Latest compatible version", "최신 호환 버전")}</span><span>${escape(state.versions.find(v => v.compatible && !v.prerelease)?.version ?? t("Check required", "확인 필요"))}</span></div>
  <div class="row"><span>${t("Pinned version", "고정 버전")}</span><span>${escape(state.pinnedVersion ?? t("Not pinned", "고정되지 않음"))}</span></div>
  <div class="row"><label for="instruction-version">${t("Selected version", "선택 버전")}</label><select id="instruction-version" data-action="selectVersion"${disabled}><option value="">${t("Select a version", "버전 선택")}</option>${state.versions.map(v => `<option value="${escape(v.version)}"${v.version === version ? " selected" : ""}${!v.compatible ? " disabled" : ""}>${escape(v.version)}${v.compatible ? "" : t(" (Incompatible)", " (호환되지 않음)")}${state.downloadedVersions.includes(v.version) ? t(" · Downloaded", " · 다운로드됨") : ""}</option>`).join("")}</select></div>
  <p class="muted">${t("Downloading saves the full package. Applying changes only the selected components. Active conversations retain their existing instructions.", "다운로드는 전체 패키지를 저장합니다. 적용은 선택한 구성 요소만 변경하며, 실행 중인 대화는 기존 지침을 유지합니다.")}</p>
  ${release ? `<h2>${t("Release notes", "변경 내용")}</h2><pre class="preview">${text(release.notes)}</pre>` : ""}

  <h2>${t("Components to apply", "적용할 구성 요소")}</h2><fieldset aria-label="${t("Components to apply", "적용할 구성 요소")}"${disabled}>${state.components.map(c => `<label class="component"><input type="checkbox" data-component="${escape(c.id)}"${selected.includes(c.id) ? " checked" : ""}>${escape(c.title)} <small>${escape(c.kind)} · ${escape(c.scope)}</small></label>`).join("")}</fieldset>
  <div class="actions">${button("refresh", t("Check for updates", "업데이트 확인"))}${button("download", t("Download full package", "전체 패키지 다운로드"), unavailable)}${button("apply", state.currentVersion ? t("Apply / update selected components", "선택 구성 적용 / 업데이트") : t("Apply selected components", "선택 구성 적용"), unavailable || !state.downloadedVersions.includes(version ?? "") || state.conflicts.length > 0)}${state.pinnedVersion ? button("unpin", t("Unpin version", "버전 고정 해제")) : button("pin", t("Pin selected version", "선택 버전 고정"), unavailable)}${button("rollback", t("Roll back to selected version", "선택 버전으로 롤백"), unavailable || !state.currentVersion || version === state.currentVersion || !state.downloadedVersions.includes(version ?? ""))}</div>
  ${state.conflicts.length ? `<section aria-label="${t("Local change conflicts", "로컬 변경 충돌")}"><h2>${t("Local change conflicts", "로컬 변경 충돌")}</h2><p class="notice">${t("Existing documents have been modified or are unmanaged. Applying has stopped. Review the contents and resolve local changes before checking again.", "기존 문서가 변경되었거나 관리되지 않습니다. 적용이 중단되었습니다. 내용을 검토하고 로컬 변경을 직접 해결한 뒤 다시 확인하세요.")}</p>${state.conflicts.map(c => `<h2>${escape(c.target)}</h2><p>${escape(c.reason)}</p><div class="diff"><div><p>${t("Current content", "현재 내용")}</p><pre class="preview">${escape(c.current)}</pre></div><div><p>${t("Proposed content", "제안 내용")}</p><pre class="preview">${escape(c.proposed)}</pre></div></div>`).join("")}</section>` : ""}
  <h2>${t("Document preview", "문서 미리보기")}</h2><div class="documents"><nav class="list" aria-label="${t("Instruction document list", "지침 문서 목록")}">${state.documents.map(d => `<button type="button" data-action="preview" data-path="${escape(d.path)}" aria-current="${d.path === state.preview?.path}"${disabled}><small>${escape(d.kind)}</small><br>${escape(d.title)}<br><small>${escape(d.path)}</small></button>`).join("") || `<p class="muted">${t("Select a version to browse documents.", "버전을 선택해 문서를 확인하세요.")}</p>`}</nav><section aria-label="${t("Document content", "문서 내용")}"><p>${escape(state.preview?.path ?? t("Select a document", "문서를 선택하세요"))}</p><pre class="preview" tabindex="0">${escape(state.preview?.text)}</pre></section></div></details></main>`;
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
      panel.webview.html = `<!doctype html><html lang="${locale}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><style nonce="${nonce}">${instructionStyles}#content{width:100%}</style></head><body><div class="shell"><aside aria-label="${t("Settings", "설정")}"><button data-section="general"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6"/><circle cx="10" cy="10" r="2"/></svg>${shellText.general}</button><button data-section="instructions" aria-current="true"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h7l3 3v12H5z M8 8h4 M8 11h4 M8 14h4"/></svg>${t("Instruction Documents", "지침 문서")}</button></aside><div id="content"></div></div><script nonce="${nonce}">(${standaloneClient.toString()})(${JSON.stringify(nonce)},${JSON.stringify(instructionStyles)},${JSON.stringify(locale)},${JSON.stringify(shellText)},${instructionClientTools.toString()});</script></body></html>`;
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
    if (!validInstructionRequest(payload)) return;
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

export function instructionClientTools(root: any) {
  const drafts = new Map<string, any>(), filters = new Map<string, string>(), disclosures = new Map<string, boolean>();
  const value = (name: string, scope = root) => scope.querySelector('[data-field="' + name + '"]')?.value;
  const capture = () => {
    const editor = root.querySelector('[data-editor-id]');
    if (editor?.dataset.editorId) drafts.set(editor.dataset.editorId, [...editor.querySelectorAll('[data-field],textarea[data-file-path]')].map(e => ({ field: e.dataset.field, path: e.dataset.filePath, value: e.value })));
    for (const e of root.querySelectorAll('[data-filter]')) filters.set(e.dataset.filter, e.value);
    for (const e of root.querySelectorAll('details')) disclosures.set(e.querySelector('summary')?.textContent, e.open);
  };
  const filter = () => {
    const search = root.querySelector('[data-filter="search"]')?.value.toLowerCase() ?? '';
    const kind = root.querySelector('[data-filter="kind"]')?.value;
    const sharing = root.querySelector('[data-filter="sharing"]')?.value;
    for (const e of root.querySelectorAll('button.library-entry')) e.hidden = !(e.dataset.name.toLowerCase().includes(search) && (!kind || e.dataset.kind === kind) && (!sharing || e.dataset.sharing === sharing));
  };
  const file = (target: any) => {
    if (target?.dataset.field !== 'file-path') return;
    for (const e of root.querySelectorAll('[data-file-panel]')) e.hidden = e.dataset.filePanel !== target.value;
  };
  const restore = () => {
    const editor = root.querySelector('[data-editor-id]');
    const draft = drafts.get(editor?.dataset.editorId);
    if (draft) for (const e of editor.querySelectorAll('[data-field],textarea[data-file-path]')) {
      const saved = draft.find((d: any) => d.field === e.dataset.field && d.path === e.dataset.filePath);
      if (saved) e.value = saved.value;
    }
    for (const e of root.querySelectorAll('[data-filter]')) if (filters.has(e.dataset.filter)) e.value = filters.get(e.dataset.filter);
    for (const e of root.querySelectorAll('details')) if (disclosures.has(e.querySelector('summary')?.textContent)) e.open = disclosures.get(e.querySelector('summary')?.textContent);
    file(root.querySelector('[data-field="file-path"]')); filter();
  };
  const error = (failure: unknown) => {
    let alert = root.querySelector('[data-client-error]');
    if (!alert) { alert = root.ownerDocument.createElement('p'); alert.setAttribute('role', 'alert'); root.append(alert); }
    alert.textContent = failure instanceof Error ? failure.message : String(failure);
  };
  const payload = (button: any) => {
    const action = button.dataset.action, id = button.dataset.id;
    const revision = Number(root.querySelector('[data-library-revision]')?.dataset.libraryRevision);
    if (action === 'librarySelect') return { id };
    if (['libraryApply', 'libraryPublish', 'libraryStartTask'].includes(action)) return { token: button.dataset.token };
    if (action === 'libraryCreate') {
      const name = value('create-name'), kind = value('create-kind'), sharing = value('create-sharing');
      if (!name?.trim()) throw new Error('Enter a resource name / 리소스 이름을 입력하세요.');
      return kind === 'task-profile' ? { name, kind, sharing, profile: { model: '', dependencies: [] } } : { name, kind, sharing, files: [{ path: kind === 'skill' ? 'SKILL.md' : kind === 'agent-role' ? 'ROLE.md' : 'CONTEXT.md', encoding: 'utf8', content: kind === 'skill' ? '---\nname: ' + name + '\ndescription: Describe this skill.\n---\n\n# ' + name + '\n' : '# ' + name + '\n' }] };
    }
    if (action === 'librarySave') {
      const editor = root.querySelector('[data-editor-id]');
      const json = value('profile', editor);
      const result: any = { id, name: value('name', editor), sharing: value('sharing', editor), revision };
      if (json !== undefined) result.profile = JSON.parse(json);
      else result.files = [...editor.querySelectorAll('textarea[data-file-path]')].map(e => ({ path: e.dataset.filePath, encoding: e.dataset.encoding, content: e.value }));
      return result;
    }
    if (action === 'libraryPlanApply') return { ids: [id] };
    if (action === 'libraryPlanPublish') return { ids: [id], version: value('publish-version') };
    if (action === 'libraryPrepareTask') return { id, model: value('model'), provider: value('provider') || undefined, reasoningEffort: value('reasoningEffort') || undefined };
    if (action === 'libraryConnect' || action === 'libraryRemoteRefresh' || action === 'libraryRemoteImport') {
      const scope = button.closest('[data-connection]');
      return action === 'libraryConnect' ? { sharing: button.dataset.sharing, repository: value('repository', scope), branch: value('branch', scope) } : action === 'libraryRemoteImport' ? { sharing: button.dataset.sharing, version: value('remote-version', scope) } : { sharing: button.dataset.sharing };
    }
    return {};
  };
  return { capture, restore, filter, file, payload, error };
}

// This function executes in the webview, without host access except the VS Code bridge.
function standaloneClient(nonce: string, styles: string, locale: string, text: { general: string; description: string; openSettings: string; loading: string }, toolsFactory: typeof instructionClientTools): void {
  const vscode = (globalThis as any).acquireVsCodeApi();
  const content = (globalThis as any).document.getElementById("content");
  const root = content.attachShadow({ mode: "open" });
  let clientId = (globalThis as any).crypto.randomUUID(), counter = 0, active = true, busy = false, requestId = "", debounce = 0;
  let lastHtml = "";
  const send = (action: string, message?: unknown) => { requestId = String(++counter); vscode.postMessage({ type: "azrael-instructions", clientId, requestId, action, message, ...(action === "mount" ? { locale } : {}) }); };
  const tools = toolsFactory(root);
  const payload = () => ({ version: root.querySelector("#instruction-version")?.value, componentIds: [...root.querySelectorAll("input[data-component]:checked")].map((e: any) => e.dataset.component) });
  const render = (html: string) => { tools.capture(); root.innerHTML = html.includes("<style>") ? html.replace("<style>", `<style nonce="${nonce}">`) : `<style nonce="${nonce}">${styles}</style>${html}`; tools.restore(); };
  (globalThis as any).addEventListener("message", (event: any) => {
    const m = event.data;
    if (!active || m.type !== "azrael-instructions-state" || m.clientId !== clientId || m.requestId !== requestId || typeof m.html !== "string") return;
    lastHtml = m.html; render(lastHtml); busy = root.querySelector('main[aria-busy="true"]') !== null;
  });
  root.addEventListener("click", (event: any) => {
    const b = event.target.closest("button[data-action]");
    if (!b || b.disabled || busy) return;
    try { const message = b.dataset.action.startsWith("library") ? tools.payload(b) : { ...payload(), path: b.dataset.path }; busy = true; send(b.dataset.action, message); } catch (error) { tools.error(error); }
  });
  root.addEventListener("input", () => tools.filter());
  root.addEventListener("change", (event: any) => {
    tools.filter(); tools.file(event.target);
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

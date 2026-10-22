import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { InstructionAction, InstructionRequest, InstructionUiPort, InstructionUiState, InstructionUiText } from "./instructionProtocol";

const actions = new Set<InstructionAction>(["refresh", "selectVersion", "preview", "download", "apply", "pin", "unpin", "rollback", "libraryRefresh", "libraryImport", "libraryCreate", "librarySelect", "librarySave", "libraryPlanApply", "libraryApply", "libraryPlanPublish", "libraryPublish", "libraryRecover", "libraryConnect", "libraryRemoteRefresh", "libraryRemoteImport", "libraryPrepareTask", "libraryStartTask", "libraryCompare", "libraryInspectVersion", "librarySetProject", "libraryPlanAcquire", "libraryAcquire", "libraryBack", "libraryOpenInstalled", "librarySetSkillEnabled", "libraryPlanDelete", "libraryDelete", "librarySetSource", "libraryPlanMigrate", "libraryMigrate"]);
const escape = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
interface Mount { clientId: string; requestId: string; locale: "en" | "ko"; disposal?: vscode.Disposable }

/** Structural limits here precede the service's semantic and filesystem validation. */
export function validInstructionRequest(value: Record<string, unknown>): boolean {
  const string = (v: unknown, max = 4096) => typeof v === "string" && v.length <= max;
  if (Object.keys(value).some(key => !["version", "path", "componentIds", "id", "ids", "name", "kind", "sharing", "files", "profile", "revision", "token", "repository", "branch", "model", "provider", "reasoningEffort", "digest", "fromDigest", "toDigest", "project", "enabled", "removeInstallation", "sourceMode", "sourceProject", "installationName"].includes(key))) return false;
  for (const key of ["version", "path", "id", "name", "token", "repository", "branch", "model", "provider", "reasoningEffort", "digest", "fromDigest", "toDigest", "project", "sourceProject", "installationName"]) if (value[key] !== undefined && !string(value[key])) return false;
  for (const key of ["ids", "componentIds"]) if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].length > 1000 || value[key].some(v => !string(v)))) return false;
  for (const key of ["enabled", "removeInstallation"]) if (value[key] !== undefined && typeof value[key] !== "boolean") return false;
  if (value.sourceMode !== undefined && !["release", "project"].includes(value.sourceMode as string)) return false;
  if (value.kind !== undefined && !["skill", "agent-role", "context", "task-profile", "playbook"].includes(value.kind as string)) return false;
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
  const kinds = [["playbook", "Playbook", "플레이북"], ["skill", "Skill", "스킬"], ["agent-role", "Agent role", "에이전트 역할"], ["context", "Reference document", "참고 문서"], ["task-profile", "Task profile", "작업 프로필"]];
  const knownLabel = (label: string | undefined) => {
    const labels: Record<string, string> = { "My library": "내 라이브러리", "Azrael baseline": "Azrael 기본 지침", "Installed skills": "설치된 스킬", "Installed global instructions": "설치된 전역 지침", "System skills": "시스템 스킬", "Installed agent roles": "설치된 에이전트 역할", "Local installation": "로컬 설치" };
    return label ? locale === "ko" ? labels[label] ?? label : label : "";
  };
  const sourceLabel = (entry: typeof library.entries[number]) => knownLabel(entry.sourceLabel) || ({ library: t("My library", "내 라이브러리"), builtin: t("Built in", "기본 제공"), installed: t("Installed", "설치됨"), remote: t("Remote", "원격") })[entry.sourceKind ?? "library"];
  const classes = [["collaborators", "Collaborators", "협업자"], ["public", "Public", "공개"], ["local", "Local only", "로컬 전용"]];
  const options = (values: string[][], current?: string) => values.map(([id, en, ko]) => `<option value="${id}"${id === current ? " selected" : ""}>${t(en, ko)}</option>`).join("");
  const input = (name: string, title: string, value = "") => `<label>${title}<input data-field="${name}" value="${escape(value)}"></label>`;
  const data = selected ? `data-id="${escape(selected.catalogId ?? selected.id)}"` : "";
  const skillControl = (entry: typeof library.entries[number]) => entry.canToggleSkill === true ? `<div class="row skill-inclusion"><span>${t("Include in available skills", "사용 가능한 스킬에 포함")}</span><button type="button" role="switch" aria-label="${escape(t("Include skill", "스킬 포함") + ': ' + entry.name)}" aria-checked="${entry.skillEnabled !== false}" data-action="librarySetSkillEnabled" data-id="${escape(entry.catalogId ?? entry.id)}" data-enabled="${entry.skillEnabled === false}"${state.busy ? " disabled" : ""}>${entry.skillEnabled === false ? t("Off", "꺼짐") : t("On", "켜짐")}</button></div>` : "";
  const inclusionHelp = t("Changes apply to new conversations. Excluded skills keep their catalog entries and files. This controls skill inclusion, not file access.", "변경은 새 대화부터 적용됩니다. 제외한 스킬도 관리 목록과 파일은 보존됩니다. 이 설정은 파일 접근 권한이 아닌 스킬 포함 여부를 제어합니다.");
  const installationChoice = selected?.kind === "skill" && !!selected.provenance ? `<label><input type="checkbox" data-field="install-enabled"${selected.skillEnabled === true ? " checked" : ""}${state.busy ? " disabled" : ""}> ${t("Use as a skill", "스킬로 사용")}</label>` : "";
  const plan = library.plan;
  const conflicts = plan?.conflicts ?? [];
  const primaryActions = () => {
    if (!selected) return "";
    let primary = "";
    if (selected.kind === "playbook") primary = button("libraryPlanAcquire", selected.projectStatus?.state === "different" ? t("Update project…", "프로젝트 업데이트…") : t("Download to project…", "프로젝트에 다운로드…"), data, !library.selectedProject || !!selected.validationErrors.length);
    else if (selected.kind === "skill" || selected.kind === "agent-role") primary = button("libraryPlanAcquire", t("Install in Azrael…", "Azrael에 설치…"), data, !!selected.validationErrors.length);
    else if (selected.kind === "task-profile" && !selected.readOnly) primary = button("libraryPrepareTask", t("Use for task…", "작업에 사용…"), data, !!selected.validationErrors.length);
    if (selected.readOnly) primary += button("libraryImport", t("Add to my library", "내 라이브러리에 추가"), data);
    if (selected.installedDigest || selected.projectStatus?.path) primary += button("libraryOpenInstalled", t("Open installed file", "설치된 파일 열기"), data);
    if (selected.canMigrate) primary += button("libraryPlanMigrate", t("Migrate linked installation…", "연결된 설치 전환…"), data);
    return primary;
  };
  const versionControls = (entry: typeof library.entries[number]) => {
    const id = entry.catalogId ?? entry.id, data = `data-id="${escape(id)}"`;
    const versions = entry.versions ?? [{ digest: entry.digest, label: entry.versionLabel ?? t("Current", "현재") }];
    const opts = versions.map(v => `<option value="${escape(v.digest)}"${v.digest === entry.digest ? " selected" : ""}>${escape(knownLabel(v.label))}</option>`).join("");
    const c = library.comparison?.id === id ? library.comparison : undefined;
    const versionLabel = (digest: string) => digest === "@installed" ? t("Actual installed / project files", "실제 설치 / 프로젝트 파일") : knownLabel(versions.find(v => v.digest === digest)?.label) || t("Version unavailable", "버전 정보 없음");
    return `<div data-version-controls="${escape(id)}"><div class="library-fields"><label>${t("Compare from", "비교 기준")}<select data-field="from-digest"><option value="@installed">${t("Actual installed / project files", "실제 설치 / 프로젝트 파일")}</option>${opts.replace(/ selected/g, "")}</select></label><label>${t("Available version", "사용 가능한 버전")}<select data-field="to-digest">${opts}</select></label></div><div class="actions">${button("libraryCompare", t("Compare", "비교"), data)}${button("libraryInspectVersion", t("Preview version", "버전 미리보기"), data)}</div>${c ? c.error ? `<p class="error" role="alert">${escape(resolveInstructionText(c.error, locale))}</p>` : `<p class="muted" data-comparison-label>${escape(versionLabel(c.from))} → ${escape(versionLabel(c.to))}</p>${c.files.map(f => `<h3>${escape(f.path)}</h3>${renderInstructionDifference(f.current, f.proposed, locale)}`).join("") || `<p>${t("No changed files.", "변경된 파일이 없습니다.")}</p>`}` : ""}</div>`;
  };
  return `<section aria-label="${t("Instruction library", "지침 라이브러리")}" data-library-revision="${library.revision}">
    <p class="error" data-client-error role="alert"></p>
    ${library.notices?.length ? `<details class="notice" data-disclosure="notices"><summary>${library.notices.length} ${t("source notices", "개 소스 알림")}</summary>${library.notices.map(n => `<p>${escape(resolveInstructionText(n, locale))}</p>`).join("")}</details>` : ""}
    <details data-disclosure="source-settings"><summary>${t("Official source", "공식 소스")}: ${library.sourceMode === "project" ? `${t("Developer project", "개발 프로젝트")} · ${escape(library.projects?.find(p => p.id === library.sourceProject)?.name ?? library.sourceProject)}` : t("Verified release", "검증된 릴리스")}</summary><div class="library-fields"><label>${t("Source mode", "소스 모드")}<select data-field="source-mode">${options([["release", "Verified release", "검증된 릴리스"], ["project", "Developer project", "개발 프로젝트"]], library.sourceMode ?? "release")}</select></label><label>${t("Source project", "소스 프로젝트")}<select data-field="source-project"><option value="">${t("Select a project", "프로젝트 선택")}</option>${(library.projects ?? []).map(p => `<option value="${escape(p.id)}"${p.id === library.sourceProject ? " selected" : ""}>${escape(p.name)}</option>`).join("")}</select></label></div>${button("librarySetSource", t("Use selected source", "선택한 소스 사용"))}</details>
    <div class="library-fields"><label>${t("Project", "프로젝트")}<select data-field="project"><option value="">${t("Select a project", "프로젝트 선택")}</option>${(library.projects ?? []).map(p => `<option value="${escape(p.id)}"${p.id === library.selectedProject ? " selected" : ""}>${escape(p.name)}</option>`).join("")}</select></label>${button("librarySetProject", t("Choose project", "프로젝트 선택"))}</div>
    ${selected ? `<div class="actions">${button("libraryBack", t("Back to library", "라이브러리로 돌아가기"))}</div><section class="library-reading"><h2>${escape(selected.name)}</h2><p>${escape(selected.description)}</p><p class="muted">${escape(sourceLabel(selected))} · ${escape(knownLabel(selected.versionLabel))}</p>${selected.validationErrors.map(error => `<p class="error" role="alert">${escape(error)}</p>`).join("")}${installationChoice}<div class="actions">${primaryActions()}</div>${skillControl(selected)}${selected.canToggleSkill ? `<p class="muted">${inclusionHelp}</p>` : ""}${selected.provenance ? `<p class="muted">${t("Derived from", "파생 원본")}: ${escape(selected.provenance.sourceKind)} · ${escape(selected.provenance.repository)} · ${escape(selected.provenance.resourceId)} · ${escape(selected.provenance.versionLabel ?? selected.provenance.digest)}</p>` : ""}${versionControls(selected)}${selected.profile ? `<pre class="preview" tabindex="0">${escape(selected.profile.instructions ?? JSON.stringify(selected.profile, null, 2))}</pre>` : (selected.files ?? []).map(f => `<h3>${escape(f.path)}</h3><pre class="preview" tabindex="0">${f.encoding === "base64" ? t("Binary support file", "바이너리 지원 파일") : escape(f.content)}</pre>`).join("")}</section>` : ""}
    <div data-library-browse${selected ? " hidden" : ""}><h2>${t("Library", "라이브러리")}</h2>
    <div class="library-fields"><label class="search">${t("Search", "검색")}<input data-filter="search" type="search"></label><label>${t("Kind", "종류")}<select data-filter="kind"><option value="">${t("All kinds", "모든 종류")}</option>${options(kinds)}</select></label><label>${t("View", "보기")}<select data-filter="layout"><option value="list">${t("List", "목록")}</option><option value="cards">${t("Cards", "카드")}</option></select></label></div>
    <details data-disclosure="filters"><summary>${t("Filters", "필터")}</summary><div class="library-fields"><label>${t("Source", "소스")}<select data-filter="source"><option value="">${t("All sources", "모든 소스")}</option>${options([["library", "My library", "내 라이브러리"], ["builtin", "Built in", "기본 제공"], ["installed", "Installed", "설치됨"], ["remote", "Remote", "원격"]])}</select></label><label>${t("Sharing", "공유")}<select data-filter="sharing"><option value="">${t("All sharing", "모든 공유")}</option>${options(classes)}</select></label><label>${t("Project state", "프로젝트 상태")}<select data-filter="state"><option value="">${t("All states", "모든 상태")}</option>${options([["missing", "Not downloaded", "다운로드 전"], ["downloaded", "Downloaded", "다운로드됨"], ["different", "Different version", "다른 버전"], ["unknown", "Unknown", "미확인"], ["conflict", "Conflict", "충돌"]])}</select></label></div></details>
    <div class="actions">${button("libraryRefresh", t("Refresh library", "라이브러리 새로고침"))}${button("libraryImport", t("Import source folder…", "소스 폴더 가져오기…"))}</div>
    <details data-disclosure="create"><summary>${t("Create resource", "리소스 만들기")}</summary><div class="library-fields">${input("create-name", t("Display title", "표시 제목"))}${input("create-installation-name", t("Installation name (ASCII; optional)", "설치 이름 (영문; 선택 사항)"))}<label>${t("Kind", "종류")}<select data-field="create-kind">${options(kinds, "skill")}</select></label><label>${t("Sharing", "공유")}<select data-field="create-sharing">${options(classes, "local")}</select></label></div>${button("libraryCreate", t("Create", "만들기"))}</details>
    <p class="muted">${inclusionHelp}</p><p role="status"><span data-result-count>${library.entries.length}</span> ${t("resources", "개 리소스")}</p><div class="library-catalog" data-catalog>${library.entries.map(entry => `<article class="library-entry" data-name="${escape(entry.name + " " + (entry.description ?? ""))}" data-kind="${escape(entry.kind)}" data-sharing="${escape(entry.sharing)}" data-source="${escape(entry.sourceKind ?? "library")}" data-state="${escape(entry.projectStatus?.state ?? "unknown")}"><button class="entry-open" data-action="librarySelect" data-id="${escape(entry.catalogId ?? entry.id)}"${state.busy ? " disabled" : ""}><strong>${escape(entry.name)}</strong><span>${escape(entry.description)}</span><small>${escape(kinds.find(k => k[0] === entry.kind)?.[locale === "ko" ? 2 : 1] ?? entry.kind)} · ${escape(sourceLabel(entry))} · ${escape(knownLabel(entry.versionLabel))} · ${escape(({ missing: t("Not downloaded", "다운로드 전"), downloaded: t("Downloaded", "다운로드됨"), different: t("Different version", "다른 버전"), unknown: t("Unknown", "미확인"), conflict: t("Conflict", "충돌") })[entry.projectStatus?.state ?? "unknown"])}</small></button>${skillControl(entry)}<details data-disclosure="compare-${escape(entry.catalogId ?? entry.id)}"><summary>${t("Versions and differences", "버전 및 차이")}</summary>${versionControls(entry)}</details></article>`).join("")}</div>${library.entries.length ? `<p data-no-results hidden>${t("No resources match your filters.", "필터와 일치하는 리소스가 없습니다.")}</p>` : `<p>${t("Import a folder or create a resource to begin.", "폴더를 가져오거나 리소스를 만드세요.")}</p>`}</div>
    <details data-disclosure="manage"${!selected || selected.readOnly ? " hidden" : ""}><summary>${t("Edit and manage", "편집 및 관리")}</summary>
    <section data-editor-id="${escape(selected?.id ?? "")}" aria-label="${t("Resource editor", "리소스 편집기")}">${selected ? `<h2>${escape(selected.name)}</h2><div class="library-fields">${input("name", t("Name", "이름"), selected.name)}<label>${t("Sharing", "공유")}<select data-field="sharing">${options(classes, selected.sharing)}</select></label></div>
      <p class="muted">${escape(selected.kind)} · ${escape(selected.digest)}</p>
      ${selected.profile ? `<label>${t("Profile JSON (dependencies pin IDs and digests)", "프로필 JSON (의존성 ID와 다이제스트 고정)")}<textarea data-field="profile">${escape(JSON.stringify(selected.profile, null, 2))}</textarea></label>` : `<label>${t("Support files", "지원 파일")}<select data-field="file-path">${(selected.files ?? []).map(file => `<option value="${escape(file.path)}">${escape(file.path)}${file.encoding === "base64" ? t(" (binary, preserved)", " (바이너리, 보존됨)") : ""}</option>`).join("")}</select></label>${(selected.files ?? []).map((file, index) => `<label data-file-panel="${escape(file.path)}"${index ? " hidden" : ""}>${escape(file.path)}<textarea data-file-path="${escape(file.path)}" data-encoding="${file.encoding}"${file.encoding === "base64" ? " readonly" : ""}>${escape(file.content)}</textarea></label>`).join("")}`}
      ${selected.publications.map(pub => `<p>${t("Previously published", "이전 게시됨")}: ${escape(pub.repository)} · ${escape(pub.version)} · ${escape(pub.commit ?? pub.digest)}</p>`).join("")}
      <div class="library-fields">${input("publish-version", t("Publication version", "게시 버전"), "0.1.0")}<label>${t("Publish destination", "게시 대상 저장소")}<select data-field="publish-repository"><option value="">${t("Select a repository", "저장소 선택")}</option>${library.connections.filter(c => c.sharing === selected.sharing).map(c => `<option value="${escape(c.repository)}">${escape(c.repository)}</option>`).join("")}</select></label></div><div class="actions">${button("librarySave", t("Save locally", "로컬 저장"), data)}${selected.kind === "skill" || selected.kind === "agent-role" ? button("libraryPlanApply", t("Plan apply", "적용 계획"), data, !!selected.validationErrors.length) : ""}${button("libraryPlanPublish", t("Plan publish", "게시 계획"), data, !!selected.validationErrors.length || selected.sharing === "local")}</div>
      ${selected.sourceKind === "library" && !selected.readOnly ? `<section data-delete-id="${escape(selected.catalogId ?? selected.id)}"><h3>${t("Delete personal source", "개인 작업본 삭제")}</h3><p class="muted">${t("Published GitHub versions are retained. The installation is kept unless selected below.", "GitHub 게시 버전은 보존됩니다. 아래에서 선택하지 않으면 설치본도 유지됩니다.")}</p><label><input type="checkbox" data-field="remove-installation"${state.busy ? " disabled" : ""}> ${t("Also remove installation", "설치본도 제거")}</label><div class="actions">${button("libraryPlanDelete", t("Review deletion…", "삭제 검토…"), data)}</div></section>` : ""}
      ${selected.profile ? `<h2>${t("Selected new conversation", "선택한 새 대화")}</h2><p>${t("Recommended model", "권장 모델")}: ${escape(selected.profile.model)}</p><div class="library-fields">${input("model", t("Model override", "모델 변경"), selected.profile.model)}${input("provider", t("Provider", "제공자"), selected.profile.provider)}${input("reasoningEffort", t("Reasoning effort", "추론 수준"), selected.profile.reasoningEffort)}</div>${button("libraryPrepareTask", t("Prepare task", "작업 준비"), data, !!selected.validationErrors.length)}` : ""}` : `<p>${t("Select a resource to edit its complete source.", "전체 소스를 편집할 리소스를 선택하세요.")}</p>`}</section></details>
    ${plan ? `<section data-plan-token="${escape(plan.token)}"><h2>${t("Review frozen plan", "고정된 계획 검토")}: ${escape(plan.kind)}</h2><pre class="preview">${escape(resolveInstructionText(plan.summary, locale))}</pre>${plan.model ? `<p>${t("Effective model", "실제 모델")}: ${escape(plan.model)} · ${escape(plan.provider)}</p>` : ""}${[...(plan.diffs ?? []), ...conflicts].map(diff => `<p${"reason" in diff ? ' class="error" role="alert"' : ""}>${escape("reason" in diff ? diff.reason : "")} ${escape(diff.target ?? ("path" in diff ? diff.path : ""))}</p><div class="diff"><pre class="preview">${escape(diff.current)}</pre><pre class="preview">${escape(diff.proposed)}</pre></div>`).join("")}${button(plan.kind === "apply" ? (plan.acquire ? "libraryAcquire" : "libraryApply") : plan.kind === "publish" ? "libraryPublish" : plan.kind === "delete" ? "libraryDelete" : plan.kind === "migrate" ? "libraryMigrate" : "libraryStartTask", plan.kind === "apply" ? t("Apply reviewed plan", "검토한 계획 적용") : plan.kind === "publish" ? t("Publish reviewed plan", "검토한 계획 게시") : plan.kind === "delete" ? t("Delete reviewed personal source", "검토한 개인 작업본 삭제") : plan.kind === "migrate" ? t("Migrate reviewed installation", "검토한 설치 전환") : t("Start selected new task", "선택한 새 작업 시작"), `data-token="${escape(plan.token)}"`, !!conflicts.length)}</section>` : ""}
    <details data-disclosure="connections"><summary>${t("Distribution and connections", "배포·연결")}</summary>${["public", "collaborators"].map(sharing => [...library.connections.filter(c => c.sharing === sharing), undefined].map((connection, index) => { const versions = (library.remoteVersions ?? []).filter(v => v.sharing === sharing && v.repository === connection?.repository); return `<section data-connection="${sharing}-${index}"><h2>${connection ? escape(connection.repository) : t("Add repository", "저장소 추가")} · ${sharing === "public" ? t("Public", "공개") : t("Collaborators", "협업자")}</h2><div class="library-fields">${input("repository", t("Repository (owner/name)", "저장소 (소유자/이름)"), connection?.repository)}${input("branch", t("Branch", "브랜치"), connection?.branch ?? "main")}</div><p>${connection ? `${t("Read", "읽기")}: ${connection.readable === undefined ? t("Unknown", "미확인") : connection.readable} · ${t("Write", "쓰기")}: ${connection.writable === undefined ? t("Unknown", "미확인") : connection.writable}` : t("Not connected", "연결되지 않음")}</p><div class="actions">${button("libraryConnect", t("Connect / check access", "연결 / 권한 확인"), `data-sharing="${sharing}"`)}${connection ? button("libraryRemoteRefresh", t("Check remote versions", "원격 버전 확인"), `data-sharing="${sharing}"`) : ""}</div>${connection ? `<label>${t("Browse source version", "조회할 소스 버전")}<select data-field="remote-version">${versions.map(v => `<option value="${escape(v.version)}">${escape(v.version)} ${escape(v.notes)}</option>`).join("")}</select></label>${button("libraryRemoteImport", t("Import selected version", "선택 버전 가져오기"), `data-sharing="${sharing}"`, !versions.length)}` : ""}</section>`; }).join("")).join("")}</details>
    ${library.operation ? `<p class="notice" role="status">${escape(library.operation.phase)} · ${escape(library.operation.repository)} · ${escape(library.operation.version)}</p>${button("libraryRecover", t("Recover operation", "작업 복구"))}` : ""}
  </section>`;
}

/** Show a changed range with context in linear time, including added/deleted files. */
export function renderInstructionDifference(current: string | undefined, proposed: string | undefined, locale: "en" | "ko" = "en"): string {
  if (current === proposed) return `<p>${locale === "ko" ? "변경 없음" : "No changes"}</p>`;
  const a = current === undefined ? [] : current.split("\n"), b = proposed === undefined ? [] : proposed.split("\n");
  let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const lines = [...a.slice(Math.max(0, start - 2), start).map(l => "  " + escape(l)), ...a.slice(start, a.length - end).map(l => `<span class="diff-deleted">− ${escape(l)}</span>`), ...b.slice(start, b.length - end).map(l => `<span class="diff-added">+ ${escape(l)}</span>`), ...a.slice(a.length - end, a.length - end + Math.min(end, 2)).map(l => "  " + escape(l))];
  return `<pre class="preview line-diff" tabindex="0">${lines.join("\n")}</pre>`;
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

export const instructionStyles = `.row.skill-inclusion{flex-direction:row;align-items:center}.skill-inclusion button[role=switch]{border-radius:999px;min-width:54px}.skill-inclusion button[aria-checked=true]{background:var(--vscode-button-background,#262626);color:var(--vscode-button-foreground,#fff)}.library-catalog{display:flex;flex-direction:column;gap:4px}.library-catalog[data-layout=cards]{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:12px}.library-entry{border-bottom:1px solid var(--vscode-widget-border,#ddd);min-width:0}.library-entry[hidden],[hidden]{display:none!important}.entry-open{display:flex;flex-direction:column;gap:6px;text-align:left;width:100%;border:0;padding:16px 12px;background:transparent}.library-entry details{padding:0 12px}.library-reading h2{font-size:22px}.library-reading>.preview{max-height:none}.search{flex:1}.line-diff span{display:block}.diff-added{background:var(--vscode-diffEditor-insertedTextBackground,#10801018)}.diff-deleted{background:var(--vscode-diffEditor-removedTextBackground,#d0101018)}:host,body{color:var(--vscode-foreground,#262626);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}main{max-width:900px;margin:auto;padding:20px 28px;overflow-wrap:anywhere}h1{font-size:22px;font-weight:600;margin:0 0 24px}h2{font-size:15px;font-weight:600;margin:24px 0 12px}p{margin:8px 0}.row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid var(--vscode-widget-border,#ddd)}.muted,small{color:var(--vscode-descriptionForeground,#777)}textarea{width:100%;min-height:260px;resize:vertical;background:var(--vscode-input-background,#fff);color:var(--vscode-input-foreground,#262626);border:1px solid var(--vscode-widget-border,#ddd);border-radius:8px;padding:12px;font:12px/1.6 var(--vscode-editor-font-family,monospace)}input:not([type=checkbox]){background:var(--vscode-input-background,#fff);border:1px solid var(--vscode-widget-border,#ddd);border-radius:8px;padding:7px;max-width:100%}.library-fields{display:flex;flex-wrap:wrap;gap:12px}.library-fields label{display:flex;flex-direction:column;gap:4px}.library-entry{padding:10px}details>summary{cursor:pointer;padding:14px 0;font-weight:600}button,select,input{font:inherit;color:inherit}button,select{border:1px solid var(--vscode-widget-border,#ddd);border-radius:8px;background:var(--vscode-editor-background,#fff);padding:7px 12px}button{cursor:pointer}button:hover,button[aria-current=true]{background:var(--vscode-list-hoverBackground,#eee)}button:disabled{opacity:.5;cursor:default}:focus-visible{outline:2px solid var(--vscode-focusBorder,#777);outline-offset:2px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.documents>*{min-width:0}.library-fields>label{min-width:0}select{max-width:100%}.documents{display:grid;grid-template-columns:minmax(160px,1fr) minmax(0,2fr);gap:16px}.list{max-height:360px;overflow:auto}.list button{display:block;border:0;text-align:left;width:100%;margin-bottom:3px;overflow-wrap:anywhere}.preview{white-space:pre-wrap;overflow-wrap:anywhere;max-height:440px;overflow:auto;margin:0;padding:16px;border-radius:10px;background:var(--vscode-textCodeBlock-background,#f5f5f5);font:12px/1.6 var(--vscode-editor-font-family,monospace)}.notice{border-radius:8px;padding:12px;background:var(--vscode-textBlockQuote-background,var(--vscode-editorWidget-background,var(--vscode-editor-background,transparent)))}.error{color:var(--vscode-errorForeground,#b22)}fieldset{border:0;padding:0;margin:0}label.component{display:flex;align-items:center;gap:10px;padding:8px 0}.diff{display:grid;grid-template-columns:1fr 1fr;gap:12px}svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.3}aside{width:190px;padding:24px 12px;flex-shrink:0}aside button{display:flex;align-items:center;gap:10px;width:100%;border:0;text-align:left;margin-bottom:4px}body{margin:0;background:var(--vscode-editor-background,#fff)}.shell{display:flex;min-height:100vh}.shell main{width:100%}@media(max-width:650px){main{padding:16px}.documents,.diff{grid-template-columns:minmax(0,1fr)}aside{width:145px;padding:16px 6px}.row{align-items:flex-start;flex-direction:column}}`;

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
  const versionChoices = new Map<string, any>();
  let listScroll = 0, previousDetail = false, selectedId = '';
  const scroller = () => {
    let node = root.host;
    while (node) { if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(root.ownerDocument.defaultView.getComputedStyle(node).overflowY)) return node; node = node.parentElement; }
    return root.ownerDocument?.scrollingElement;
  };
  const suggest = (name: string) => {
    const ascii = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48).replace(/-$/, '');
    return /[^\x00-\x7f]/.test(name) || !ascii ? (ascii || 'skill') + '-' + globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12) : ascii;
  };
  const value = (name: string, scope = root) => scope.querySelector('[data-field="' + name + '"]')?.value;
  const capture = () => {
    const editor = root.querySelector('[data-editor-id]');
    if (editor?.dataset.editorId) drafts.set(editor.dataset.editorId, [...editor.querySelectorAll('[data-field],textarea[data-file-path]')].map(e => ({ field: e.dataset.field, path: e.dataset.filePath, value: e.value })));
    for (const e of root.querySelectorAll('[data-filter]')) filters.set(e.dataset.filter, e.value);
    for (const e of root.querySelectorAll('details')) disclosures.set(e.dataset.disclosure ?? e.querySelector('summary')?.textContent, e.open);
    for (const e of root.querySelectorAll('[data-version-controls]')) if (!e.closest('[data-library-browse][hidden]')) versionChoices.set(e.dataset.versionControls, { from: value('from-digest', e), to: value('to-digest', e) });
    const browse = root.querySelector('[data-library-browse]');
    if (browse && !browse.hidden) listScroll = scroller()?.scrollTop ?? 0;
    previousDetail = !!browse?.hidden;
  };
  const filter = () => {
    const search = root.querySelector('[data-filter="search"]')?.value.toLowerCase() ?? '';
    const kind = root.querySelector('[data-filter="kind"]')?.value;
    const sharing = root.querySelector('[data-filter="sharing"]')?.value;
    const source = root.querySelector('[data-filter="source"]')?.value;
    const state = root.querySelector('[data-filter="state"]')?.value;
    let count = 0;
    for (const e of root.querySelectorAll('.library-entry')) {
      e.hidden = !(e.dataset.name.toLowerCase().includes(search) && (!kind || e.dataset.kind === kind) && (!sharing || e.dataset.sharing === sharing) && (!source || e.dataset.source === source) && (!state || e.dataset.state === state));
      if (!e.hidden) count++;
    }
    const counter = root.querySelector('[data-result-count]'), empty = root.querySelector('[data-no-results]');
    if (counter) counter.textContent = String(count);
    if (empty) empty.hidden = count > 0;
    const catalog = root.querySelector('[data-catalog]');
    if (catalog) catalog.dataset.layout = root.querySelector('[data-filter="layout"]')?.value ?? 'list';
  };
  const file = (target: any) => {
    if (target?.dataset.field === 'create-name') {
      const installation = root.querySelector('[data-field="create-installation-name"]');
      if (installation && (!installation.value || installation.dataset.suggested === installation.value)) {
        installation.value = target.value.trim() ? suggest(target.value) : '';
        installation.dataset.suggested = installation.value;
      }
    }
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
    for (const e of root.querySelectorAll('details')) {
      const key = e.dataset.disclosure ?? e.querySelector('summary')?.textContent;
      if (disclosures.has(key)) e.open = disclosures.get(key);
    }
    for (const e of root.querySelectorAll('[data-version-controls]')) {
      const saved = versionChoices.get(e.dataset.versionControls);
      if (saved) for (const [field, choice] of [['from-digest', saved.from], ['to-digest', saved.to]]) {
        const select = e.querySelector('[data-field="' + field + '"]');
        if (select && [...select.options].some(o => o.value === choice)) select.value = choice;
      }
    }
    file(root.querySelector('[data-field="file-path"]')); filter();
    const browse = root.querySelector('[data-library-browse]'), scroll = scroller();
    if (browse && previousDetail !== browse.hidden) {
      if (scroll) scroll.scrollTop = browse.hidden ? 0 : listScroll;
      if (!browse.hidden && selectedId) [...root.querySelectorAll('button[data-action="librarySelect"]')].find(e => e.dataset.id === selectedId)?.focus({ preventScroll: true });
    }
  };
  const error = (failure: unknown) => {
    let alert = root.querySelector('[data-client-error]');
    if (!alert) { alert = root.ownerDocument.createElement('p'); alert.setAttribute('role', 'alert'); root.append(alert); }
    alert.textContent = failure instanceof Error ? failure.message : String(failure);
  };
  const payload = (button: any) => {
    const action = button.dataset.action, id = button.dataset.id;
    const revision = Number(root.querySelector('[data-library-revision]')?.dataset.libraryRevision);
    if (action === 'librarySelect') { selectedId = id; return { id }; }
    if (action === 'libraryImport' || action === 'libraryOpenInstalled') return id ? { id } : {};
    if (action === 'librarySetSkillEnabled') return { id, enabled: button.dataset.enabled === 'true' };
    if (action === 'libraryPlanDelete') return { id, removeInstallation: !!button.closest('[data-delete-id]')?.querySelector('[data-field="remove-installation"]')?.checked };
    if (action === 'librarySetSource') {
      const sourceMode = value('source-mode'), sourceProject = value('source-project');
      if (sourceMode === 'project' && !sourceProject) throw new Error('Select a source project / 소스 프로젝트를 선택하세요.');
      return { sourceMode, ...(sourceMode === 'project' ? { sourceProject } : {}) };
    }
    if (action === 'librarySetProject') return { project: value('project') };
    if (action === 'libraryPlanMigrate') return { id };
    if (action === 'libraryPlanAcquire') {
      const scope = button.closest('[data-version-controls]') ?? [...root.querySelectorAll('.library-reading [data-version-controls]')].find(e => e.dataset.versionControls === id);
      if (!scope) throw new Error('Select an available version / 사용 가능한 버전을 선택하세요.');
      return { id, digest: value('to-digest', scope), ...(root.querySelector('[data-field=install-enabled]') ? { enabled: !!root.querySelector('[data-field=install-enabled]').checked } : {}) };
    }
    if (action === 'libraryCompare' || action === 'libraryInspectVersion') {
      const scope = button.closest('[data-version-controls]');
      return action === 'libraryCompare' ? { id, fromDigest: value('from-digest', scope), toDigest: value('to-digest', scope) } : { id, digest: value('to-digest', scope) };
    }
    if (['libraryApply', 'libraryAcquire', 'libraryPublish', 'libraryStartTask', 'libraryDelete', 'libraryMigrate'].includes(action)) return { token: button.dataset.token };
    if (action === 'libraryCreate') {
      const name = value('create-name'), kind = value('create-kind'), sharing = value('create-sharing');
      if (!name?.trim()) throw new Error('Enter a resource name / 리소스 이름을 입력하세요.');
      const explicit = value('create-installation-name')?.trim();
      const identifier = explicit || suggest(name);
      if (kind === 'skill' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(identifier)) throw new Error('Use lowercase ASCII letters, numbers and hyphens / 영문 소문자, 숫자, 하이픈을 사용하세요.');
      const path = kind === 'skill' ? 'SKILL.md' : kind === 'agent-role' ? 'role.toml' : kind === 'playbook' ? 'PLAYBOOK.md' : 'CONTEXT.md';
      const content = kind === 'skill' ? '---\nname: ' + identifier + '\ndescription: Describe this skill.\n---\n\n# ' + name + '\n' : kind === 'agent-role' ? 'description = ' + JSON.stringify(name) + '\ndeveloper_instructions = """\nDescribe this agent role.\n"""\n' : '# ' + name + '\n';
      return kind === 'task-profile' ? { name, kind, sharing, profile: { model: '', dependencies: [] } } : { name, kind, sharing, files: [{ path, encoding: 'utf8', content }] };
    }
    if (action === 'librarySave') {
      const editor = root.querySelector('[data-editor-id]');
      const json = value('profile', editor);
      const result: any = { id, name: value('name', editor), sharing: value('sharing', editor), revision };
      if (json !== undefined) result.profile = JSON.parse(json);
      else result.files = [...editor.querySelectorAll('textarea[data-file-path]')].map(e => ({ path: e.dataset.filePath, encoding: e.dataset.encoding, content: e.value }));
      return result;
    }
    if (action === 'libraryPlanApply') return { ids: [id], ...(root.querySelector('[data-field=install-enabled]') ? { enabled: !!root.querySelector('[data-field=install-enabled]').checked } : {}) };
    if (action === 'libraryPlanPublish') {
      const repository = value('publish-repository');
      if (!repository) throw new Error('Select a publish repository / 게시 대상 저장소를 선택하세요.');
      return { ids: [id], version: value('publish-version'), repository };
    }
    if (action === 'libraryPrepareTask') return { id, model: value('model'), provider: value('provider') || undefined, reasoningEffort: value('reasoningEffort') || undefined };
    if (action === 'libraryConnect' || action === 'libraryRemoteRefresh' || action === 'libraryRemoteImport') {
      const scope = button.closest('[data-connection]');
      return action === 'libraryConnect' ? { sharing: button.dataset.sharing, repository: value('repository', scope), branch: value('branch', scope) } : action === 'libraryRemoteImport' ? { sharing: button.dataset.sharing, repository: value('repository', scope), version: value('remote-version', scope) } : { sharing: button.dataset.sharing, repository: value('repository', scope) };
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

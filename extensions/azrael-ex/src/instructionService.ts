import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { InstructionAction, InstructionRequest, InstructionUiPort, InstructionUiState, InstructionUiText } from "./instructionProtocol";
class InstructionUiError extends Error {
  constructor(readonly text: { en: string; ko: string }) { super(text.en); }
}
const semver = require("semver") as { gte(a: string, b: string): boolean; prerelease(version: string): unknown };

interface Store {
  getState(): Promise<{ appliedVersion?: string | null; pinnedVersion?: string | null; downloadedVersions?: string[]; selectedComponentIds?: string[]; installedRepository?: string | null; pinnedRepository?: string | null;
    currentWorkspaceVersion?: string | null; retainedWorkspaceVersions?: Array<{ root: string; version: string; repository: string }> }>;
  listReleases(): Promise<InstructionUiState["versions"]>;
  getManifest(version: string): Promise<{ components: InstructionUiState["components"]; minimumAppVersion: string }>;
  getDocuments(version: string, options?: { cachedOnly?: boolean }): Promise<Array<{ path: string; title?: string; kind?: string; text: string }>>;
  download(version: string): Promise<unknown>;
  planApply(version: string, componentIds: string[]): Promise<{ conflicts: InstructionUiState["conflicts"] }>;
  apply(version: string, componentIds: string[]): Promise<unknown>;
  pin(version: string | null): Promise<unknown>;
  rollback(version: string): Promise<unknown>;
}

export class InstructionService implements InstructionUiPort {
  private backend?: Store;
  private backendKey = "";
  private selectedVersion: string | null = null;
  private versions: InstructionUiState["versions"] = [];
  private documents: Array<{ path: string; title?: string; kind?: string; text: string }> = [];
  private components: InstructionUiState["components"] = [];
  private preview?: InstructionUiState["preview"];
  private conflicts: InstructionUiState["conflicts"] = [];
  private operation = false;

  constructor(private readonly context: vscode.ExtensionContext,
    private readonly runtime: { engine: string; codexHome: string },
    private readonly log: vscode.LogOutputChannel) {}

  private repository(): string {
    const repository = vscode.workspace.getConfiguration("azrael").get<string>("instructions.repository", "felrer/Azrael").trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new InstructionUiError({ en: "Set the GitHub repository in owner/name format.", ko: "GitHub 저장소를 owner/name 형식으로 설정하세요." });
    return repository;
  }

  private store(): Store {
    const repository = this.repository();
    const workspaceRoot = vscode.workspace.workspaceFolders?.find(folder => folder.uri.scheme === "file")?.uri.fsPath;
    const key = JSON.stringify([repository, workspaceRoot]);
    if (this.backend && this.backendKey === key) return this.backend;
    const root = this.context.extensionUri.fsPath;
    const candidates = [path.join(root, "account-ui", "instruction-package.cjs"), path.join(root, "instruction-package.cjs"),
      path.resolve(root, "../../scripts/instruction-package.cjs")];
    const filename = candidates.find(candidate => fs.existsSync(candidate));
    if (!filename) throw new InstructionUiError({ en: "The instruction management module is missing. Install the latest Azrael package.", ko: "지침 관리 모듈이 없습니다. 최신 Azrael 패키지를 설치하세요." });
    const { InstructionStore } = require(filename) as { InstructionStore: new(options: Record<string, unknown>) => Store };
    this.backend = new InstructionStore({ stateRoot: this.runtime.codexHome, appVersion: this.context.extension?.packageJSON?.version ?? "0.4.0",
      repository, engine: this.runtime.engine, workspaceRoot });
    this.backendKey = key;
    this.selectedVersion = null; this.versions = []; this.documents = []; this.components = []; this.preview = undefined; this.conflicts = [];
    return this.backend;
  }

  async snapshot(): Promise<InstructionUiState> {
    let repository = "felrer/Azrael";
    try {
      repository = this.repository();
      const store = this.store();
      const state = await store.getState();
      const downloaded = state.downloadedVersions ?? [];
      for (const version of downloaded) {
        if (this.versions.some(entry => entry.version === version)) continue;
        const manifest = await store.getManifest(version);
        this.versions.push({ version, compatible: semver.gte(this.context.extension?.packageJSON?.version ?? "0.4.0", manifest.minimumAppVersion),
          prerelease: semver.prerelease(version) !== null, notes: { en: "This instruction package is downloaded locally.", ko: "로컬에 다운로드된 지침 패키지입니다." } });
      }
      if (!this.selectedVersion && downloaded.length) {
        const preferred = [state.pinnedRepository === repository ? state.pinnedVersion : null,
          state.installedRepository === repository ? state.appliedVersion : null, ...downloaded].find(version => !!version && downloaded.includes(version));
        if (preferred) {
          const manifest = await store.getManifest(preferred);
          const documents = await store.getDocuments(preferred, { cachedOnly: true });
          this.selectedVersion = preferred; this.components = manifest.components; this.documents = documents;
        }
      }
      const notices: InstructionUiText[] = [];
      if (state.installedRepository && state.installedRepository !== repository) notices.push({ en: `The applied instructions come from ${state.installedRepository}. Browsing ${repository}.`, ko: `현재 적용된 지침의 출처는 ${state.installedRepository}입니다. 조회 대상은 ${repository}입니다.` });
      if (state.currentWorkspaceVersion && state.currentWorkspaceVersion !== state.appliedVersion) notices.push({ en: `The current workspace uses instruction version ${state.currentWorkspaceVersion}.`, ko: `현재 작업공간의 지침 버전은 ${state.currentWorkspaceVersion}입니다.` });
      if (state.retainedWorkspaceVersions?.length) notices.push({ en: "Other workspaces retain their applied instructions.", ko: "다른 작업공간은 각각의 적용 지침을 유지합니다." });
      return { repository, currentVersion: state.appliedVersion ?? null, pinnedVersion: state.pinnedRepository && state.pinnedRepository !== repository ? null : state.pinnedVersion ?? null,
        selectedVersion: this.selectedVersion, versions: this.versions, downloadedVersions: state.downloadedVersions ?? [],
        documents: this.documents.map(({ path, title, kind }) => ({ path, title: title ?? path, kind: kind ?? "reference" })),
        components: this.components, preview: this.preview, conflicts: this.conflicts,
        selectedComponentIds: state.appliedVersion ? state.selectedComponentIds : undefined,
        message: notices.length ? notices : undefined };
    } catch (error) {
      return { repository, currentVersion: null, pinnedVersion: null, selectedVersion: null, versions: [],
        downloadedVersions: [], documents: [], components: [], conflicts: [], error: this.error(error) };
    }
  }

  async request(action: InstructionAction, payload: InstructionRequest): Promise<InstructionUiState> {
    if (this.operation) return { ...(await this.snapshot()), error: { en: "Another instruction operation is in progress.", ko: "다른 지침 작업이 진행 중입니다." } };
    this.operation = true;
    let resultMessage: InstructionUiText | undefined;
    try {
      const store = this.store();
      this.conflicts = [];
      if (action === "refresh") {
        this.versions = await store.listReleases();
        const state = await store.getState();
        const pinned = state.pinnedRepository && state.pinnedRepository !== this.repository() ? null : state.pinnedVersion;
        const preferred = pinned ?? this.selectedVersion ?? this.versions.find(version => version.compatible && !version.prerelease)?.version;
        if (preferred) await this.select(store, preferred);
        resultMessage = this.versions.length ? { en: "Available instruction versions have been checked.", ko: "사용 가능한 지침 버전을 확인했습니다." } : { en: "No instruction versions have been published.", ko: "게시된 지침 버전이 없습니다." };
      } else if (action === "selectVersion") {
        await this.select(store, this.version(payload));
      } else if (action === "preview") {
        const document = this.documents.find(document => document.path === payload.path);
        if (!document) throw new InstructionUiError({ en: "Select a document from the selected version’s document list.", ko: "선택한 버전의 문서 목록에서 문서를 선택하세요." });
        this.preview = { path: document.path, text: document.text };
      } else if (action === "download") {
        const version = this.version(payload);
        await store.download(version);
        await this.select(store, version);
        resultMessage = { en: "The full instruction package has been downloaded and verified. Select the components to apply.", ko: "전체 지침 패키지를 다운로드하고 검증했습니다. 적용할 항목을 선택하세요." };
      } else if (action === "apply") {
        const version = this.version(payload);
        const ids = payload.componentIds ?? this.components.filter(component => component.default).map(component => component.id);
        const plan = await store.planApply(version, ids);
        this.conflicts = plan.conflicts;
        if (this.conflicts.length) resultMessage = { en: "Some files have been modified. Review the differences and resolve local changes before applying again.", ko: "수정된 파일이 있습니다. 차이를 확인하고 로컬 변경을 정리한 뒤 다시 적용하세요." };
        else { await store.apply(version, ids); resultMessage = { en: "Instructions have been applied. They take effect in new conversations.", ko: "지침을 적용했습니다. 새 대화부터 반영됩니다." }; }
      } else if (action === "pin") {
        await store.pin(this.version(payload)); resultMessage = { en: "The selected instruction version has been pinned.", ko: "선택한 지침 버전을 고정했습니다." };
      } else if (action === "unpin") {
        await store.pin(null); resultMessage = { en: "The instruction version has been unpinned.", ko: "지침 버전 고정을 해제했습니다." };
      } else if (action === "rollback") {
        await store.rollback(this.version(payload)); resultMessage = { en: "Instructions have been rolled back to the previous version. They take effect in new conversations.", ko: "이전 지침 버전으로 되돌렸습니다. 새 대화부터 반영됩니다." };
      }
      const state = await this.snapshot();
      return { ...state, ...(resultMessage ? { message: [resultMessage, ...(Array.isArray(state.message) ? state.message : state.message ? [state.message] : [])] } : {}) };
    } catch (error) {
      const detail = this.error(error);
      this.log.warn(`instruction action ${action} failed: ${error instanceof Error ? error.message : String(error)}`);
      return { ...(await this.snapshot()), error: detail };
    } finally { this.operation = false; }
  }

  private async select(store: Store, version: string): Promise<void> {
    const manifest = await store.getManifest(version);
    const documents = await store.getDocuments(version);
    this.selectedVersion = version; this.components = manifest.components; this.documents = documents; this.preview = undefined;
  }
  private version(payload: InstructionRequest): string {
    const version = payload.version ?? this.selectedVersion;
    if (!version || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) throw new InstructionUiError({ en: "Select an instruction version.", ko: "지침 버전을 선택하세요." });
    return version;
  }
  private error(error: unknown): InstructionUiText { return error instanceof InstructionUiError ? error.text : error instanceof Error ? error.message : String(error); }
}

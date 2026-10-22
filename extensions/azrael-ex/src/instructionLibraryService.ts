import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import * as vscode from "vscode";
import { InstructionSkillSettings } from "./instructionSkillSettings";
import type { InstructionAction, InstructionLibraryUiState, InstructionRequest, InstructionResource, InstructionSharing } from "./instructionProtocol";

type Connection = { sharing: "public" | "collaborators"; repository: string; branch: string; readable?: boolean; writable?: boolean };
type CatalogEntry = InstructionResource & { sourcePath?: string; mainPath?: string; installedRelativePath?: string; sourceIdentity?: string; remote?: { repository: string; sharing: "public" | "collaborators"; releases: Record<string, string>; commit?: string } };
type SkillSettings = { list(): Promise<Array<{ path: string; enabled: boolean; name: string }>>; set(path: string, enabled: boolean): Promise<boolean>; setForInstallation?(path: string, enabled: boolean): Promise<void>; dispose(): void };
const libraryActions = new Set<InstructionAction>(["libraryRefresh", "libraryImport", "libraryCreate", "librarySelect", "librarySave", "libraryPlanApply", "libraryApply", "libraryPlanPublish", "libraryPublish", "libraryRecover", "libraryConnect", "libraryRemoteRefresh", "libraryRemoteImport", "libraryPrepareTask", "libraryStartTask", "libraryCompare", "libraryInspectVersion", "librarySetProject", "libraryPlanAcquire", "libraryAcquire", "libraryBack", "libraryOpenInstalled", "librarySetSource", "librarySetSkillEnabled", "libraryPlanDelete", "libraryDelete", "libraryPlanMigrate", "libraryMigrate"]);

/** Host-only adapter. Credentials and immutable operation plans never enter the webview. */
export class InstructionLibraryService {
  private library: any;
  private publisher: any;
  private migration: any;
  private root = "";
  private selectedId?: string;
  private versions: NonNullable<InstructionLibraryUiState["remoteVersions"]> = [];
  private checked = new Map<string, Connection>();
  private plan?: { token: string; kind: "apply" | "publish" | "task" | "delete" | "migrate"; value: any; summary: NonNullable<InstructionLibraryUiState["plan"]>["summary"]; preview?: NonNullable<InstructionLibraryUiState["plan"]>["diffs"]; sharing?: InstructionSharing; version?: string };
  private operation?: InstructionLibraryUiState["operation"];
  private catalog = new Map<string, CatalogEntry>();
  private remoteEntries = new Map<string, CatalogEntry>();
  private snapshots = new Map<string, any>();
  private installedEntries = new Map<string, CatalogEntry>();
  private selectedDigest?: string;
  private selectedProject?: string;
  private comparison?: InstructionLibraryUiState["comparison"];
  private notices: NonNullable<InstructionLibraryUiState["notices"]> = [];
  private remoteNotices: NonNullable<InstructionLibraryUiState["notices"]> = [];
  private discovery?: { entries: CatalogEntry[]; notices: any[] };
  private discoverySource = "";
  private skills?: SkillSettings;
  private nativeSkills = new Map<string, { path: string; enabled: boolean; name: string }>();
  private migrationOrigin?: { id: string; digest: string; source: string; preservedId?: string; preservedDigest?: string; name: string; enabled: boolean };
  private acquire?: { token: string; entry: any; origin: CatalogEntry; value: any; project?: string; libraryRevision: number; importOnly?: boolean; enabled?: boolean };
  private connectionKey(): string { return `azrael.instructionConnections.v1:${this.root}`; }

  constructor(private readonly context: vscode.ExtensionContext, private readonly runtime: { engine: string; codexHome: string; env?: NodeJS.ProcessEnv; skillSettings?: SkillSettings }) {}

  private sourceKey(): string { return `azrael.instructionSource.v1:${path.resolve(this.runtime.codexHome)}`; }
  private source(): { mode: "release" | "project"; project?: string } {
    const value = this.context.globalState?.get<{ mode: "release" | "project"; project?: string }>(this.sourceKey());
    if (!value) return { mode: "release" };
    if (!["release", "project"].includes(value.mode) || value.mode === "project" && (!value.project || !path.isAbsolute(value.project))) throw new Error("Invalid instruction authoring source selection.");
    return value;
  }
  private repository(): string {
    const repository = vscode.workspace.getConfiguration("azrael").get<string>("instructions.repository", "felrer/Azrael").trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Use GitHub owner/repository format.");
    return repository;
  }
  private pathKey(value: string): string { const resolved = path.resolve(value); return process.platform === "win32" ? resolved.toLowerCase() : resolved; }
  private skillAt(mainPath: string, states: Array<{ path: string; enabled: boolean; name: string }>): { path: string; enabled: boolean; name: string } | undefined {
    let realPath = mainPath;
    try { realPath = fs.realpathSync(mainPath); } catch { /* A new installation may not exist yet. */ }
    return states.find(skill => this.pathKey(skill.path) === this.pathKey(mainPath) || this.pathKey(skill.path) === this.pathKey(realPath));
  }
  private skillSettings(): SkillSettings | undefined {
    if (this.skills) return this.skills;
    if (this.runtime.skillSettings) return this.skills = this.runtime.skillSettings;
    if (!path.isAbsolute(this.runtime.engine) || !fs.existsSync(this.runtime.engine)) return undefined;
    this.skills = new InstructionSkillSettings(this.runtime, this.project() || this.runtime.codexHome);
    this.context.subscriptions?.push(this.skills);
    return this.skills;
  }

  handles(action: InstructionAction): boolean { return libraryActions.has(action); }

  private module(name: string): any {
    const extensionRoot = this.context.extensionUri.fsPath;
    const filename = [path.join(extensionRoot, "account-ui", name), path.join(extensionRoot, name), path.resolve(extensionRoot, "../../scripts", name)].find(file => fs.existsSync(file));
    if (!filename) throw new Error(`Instruction module missing: ${name}`);
    return require(filename);
  }

  private backend(): any {
    const configured = vscode.workspace.getConfiguration("azrael").get<string>("instructions.libraryRoot", "").trim();
    const root = configured ? path.resolve(configured) : `${path.resolve(this.runtime.codexHome)}-instruction-library`;
    if (!this.library || this.root !== root) {
      const { InstructionLibrary } = this.module("instruction-library.cjs");
      this.library = new InstructionLibrary({ root, installedRoot: this.runtime.codexHome, appVersion: this.context.extension?.packageJSON?.version ?? "0.4.0" });
      this.publisher = new (this.module("instruction-publisher.cjs").InstructionPublisher)({ stateRoot: path.join(root, "operations") });
      this.migration = undefined;
      this.root = root; this.selectedId = undefined; this.plan = undefined; this.versions = []; this.checked.clear();
      this.catalog.clear(); this.remoteEntries.clear(); this.snapshots.clear(); this.installedEntries.clear(); this.selectedDigest = undefined; this.acquire = undefined;
      this.discovery = undefined;
    }
    return this.library;
  }

  private connections(): Connection[] {
    const values = this.context.globalState?.get<Connection[]>(this.connectionKey(), []) ?? [];
    if (!Array.isArray(values) || values.some(value => !value || !["public", "collaborators"].includes(value.sharing) ||
      !/^[\w.-]+\/[\w.-]+$/.test(value.repository) || !/^[\w./-]+$/.test(value.branch) || value.branch.includes("..")) ||
      new Set(values.map(value => value.repository.toLowerCase())).size !== values.length) throw new Error("Invalid instruction repository connections.");
    return values;
  }

  async snapshot(): Promise<InstructionLibraryUiState> {
    this.backend();
    const recovery = await this.library.recoveryState();
    const migrationPending = fs.existsSync(path.join(this.runtime.codexHome, "azrael", "instructions", "migration-journal.json"));
    const interruptedApply = recovery.recoveryRequired || migrationPending;
    if (interruptedApply) this.operation = { phase: "apply-interrupted" };
    else if (this.operation?.phase === "apply-interrupted") this.operation = undefined;
    if (!interruptedApply && typeof this.publisher.listOperations === "function") {
      for (const operation of await this.publisher.listOperations()) {
        if (operation.phase === "prepared") continue;
        const receipt = await this.publisher.readOperationReceipt(operation.id);
        const frozen = await this.publisher.readOperationPlan(operation.id);
        await this.library.recordPublication(frozen, receipt);
      }
    }
    const state = await this.library.getState();
    await this.catalogSnapshot(state);
    const selectedEntry = this.selectedId ? this.catalog.get(this.selectedId) : undefined;
    let selected = selectedEntry;
    if (selectedEntry) {
      try { selected = { ...selectedEntry, ...await this.catalogVersion(selectedEntry, this.selectedDigest, false) }; }
      catch (error) { this.notices.push({ en: `Selected version is unavailable: ${String(error)}`, ko: `선택한 버전을 불러올 수 없습니다: ${String(error)}` }); }
    }
    if (!this.operation && typeof this.publisher.listOperations === "function") {
      const pending = (await this.publisher.listOperations()).find((value: any) => value.phase !== "published");
      if (pending) this.operation = pending;
    }
    const resource = (entry: any): InstructionResource => ({ ...entry, publications: entry.publications.map((receipt: any) => ({ ...receipt, repository: receipt.repository ?? receipt.destination })) });
    return { revision: state.revision, entries: [...this.catalog.values()].map(entry => resource(this.publicEntry(entry, false))), selected: selected ? resource(this.publicEntry(selected, true)) : undefined,
      projects: this.projects(), selectedProject: this.project(), comparison: this.comparison, notices: this.notices, sourceMode: this.source().mode, sourceProject: this.source().project,
      connections: this.connections().map(connection => this.checked.get(connection.repository.toLowerCase()) ?? connection), remoteVersions: this.versions,
      plan: this.plan ? { token: this.plan.token, kind: this.plan.kind, summary: this.plan.summary,
        conflicts: (this.plan.value.conflicts ?? []).map((reason: string) => ({ target: "", reason })), diffs: this.plan.preview,
        model: this.plan.value.model, provider: this.plan.value.provider, acquire: !!this.acquire && this.acquire.token === this.plan.token } : undefined, operation: this.operation };
  }

  private projects(): Array<{ id: string; name: string }> {
    return (vscode.workspace.workspaceFolders ?? []).filter(folder => folder.uri.scheme === "file").map(folder => ({ id: path.resolve(folder.uri.fsPath), name: folder.name || path.basename(folder.uri.fsPath) }));
  }

  private project(): string | undefined {
    const projects = this.projects();
    return projects.some(item => item.id === this.selectedProject) ? this.selectedProject : projects.length === 1 ? projects[0].id : undefined;
  }

  private publicEntry(entry: CatalogEntry, includeFiles: boolean): InstructionResource {
    const { sourcePath: _source, mainPath: _main, remote: _remote, files, ...value } = entry;
    return { ...value, validationErrors: value.validationErrors ?? [], publications: value.publications ?? [], ...(includeFiles ? { files } : {}) };
  }

  private label(entry: any): string { return entry.documentVersion || `r${entry.version ?? 1}`; }

  private async catalogSnapshot(state: any): Promise<void> {
    this.catalog.clear(); this.installedEntries.clear(); this.notices = [...this.remoteNotices];
    const { scanInstalled } = this.module("instruction-catalog.cjs");
    const source = this.source(), repository = this.repository();
    const sourceKey = JSON.stringify([source, repository]);
    if (this.discoverySource !== sourceKey) { this.discovery = undefined; this.snapshots.clear(); this.discoverySource = sourceKey; }
    let baselineRoot: string | undefined;
    if (source.mode === "project") {
      const candidate = path.join(source.project!, "instructions");
      if (this.projects().some(project => this.pathKey(project.id) === this.pathKey(source.project!)) && fs.existsSync(path.join(candidate, "azrael-environment.json"))) baselineRoot = candidate;
      else this.notices.push({ en: "The selected authoring project is unavailable. Select its owning workspace project.", ko: "선택한 원본 프로젝트를 사용할 수 없습니다. 해당 작업공간 프로젝트를 선택하세요." });
    }
    if (!this.discovery && source.mode === "release") {
      try {
        const { InstructionStore } = this.module("instruction-package.cjs");
        const store = new InstructionStore({ stateRoot: this.runtime.codexHome, repository, appVersion: this.context.extension?.packageJSON?.version ?? "0.4.0", engine: this.runtime.engine });
        const baseline = await store.getState();
        const semver = require("semver");
        const versions = (baseline.downloadedVersions ?? []).filter((version: string) => semver.valid(version) && !semver.prerelease(version)).sort(semver.rcompare);
        const version = [baseline.pinnedRepository === repository ? baseline.pinnedVersion : undefined, baseline.installedRepository === repository ? baseline.appliedVersion : undefined, ...versions].find(value => value && versions.includes(value));
        if (version) { const manifest = await store.getManifest(version); await store.verifyCache(version, manifest); baselineRoot = path.join(store.cache(version), "package"); }
      } catch (error) { this.notices.push({ en: `Baseline catalog unavailable: ${String(error)}`, ko: `기본 지침 목록을 불러올 수 없습니다: ${String(error)}` }); }
    }
    const discovered = this.discovery ?? await scanInstalled({ installedRoot: this.runtime.codexHome, baselineRoot, baselineIdentity: repository, pluginRoots: [path.join(this.runtime.codexHome, "plugins", "cache")] });
    this.discovery = discovered;
    this.notices.push(...discovered.notices.map((notice: any) => typeof notice === "string" ? notice : notice.reason === "migration-needed" ? { en: `${notice.count || 1} linked installation(s) need migration. Canonical documents remain available; original targets have not been read or changed.`, ko: `연결된 설치 ${notice.count || 1}개는 전환이 필요합니다. 원본 문서는 별도로 조회할 수 있으며 연결 대상은 읽거나 변경하지 않았습니다.` } : { en: `Source unavailable: ${notice.sourcePath}\n${notice.message}`, ko: `출처를 확인할 수 없습니다: ${notice.sourcePath}\n${notice.message}` }));
    for (const meta of state.entries) {
      const entry = await this.library.read(meta.id);
      const history = await this.library.listVersions(meta.id);
      this.snapshots.set(`${entry.id}:${entry.digest}`, entry);
      const versions = history.map((v: any) => ({ digest: v.digest, label: this.label(v) }));
      for (const version of history) this.snapshots.set(`${entry.id}:${version.digest}`, version);
      const catalogEntry: CatalogEntry = { ...entry, catalogId: entry.id, sourceKind: "library", sourceLabel: "My library", versionLabel: this.label(entry), versions };
      if (entry.kind === "playbook" && this.project()) {
        try { catalogEntry.projectStatus = await this.playbooks().status(entry, this.project()); }
        catch { catalogEntry.projectStatus = { state: "unknown", path: "docs/playbooks/" }; }
      }
      this.catalog.set(entry.id, catalogEntry);
    }
    for (const entry of discovered.entries as CatalogEntry[]) {
      const owner = Object.entries(state.managed ?? {}).find(([relative]) => entry.mainPath && path.resolve(this.runtime.codexHome, relative) === path.resolve(entry.mainPath))?.[1] as { id?: string } | undefined;
      if (owner?.id && this.catalog.has(owner.id)) { this.installedEntries.set(owner.id, entry); continue; }
      const detached = owner?.id && state.detachedEntries?.find((value: any) => value.id === owner.id);
      const id = entry.catalogId || entry.id;
      let resource = { ...entry, version: entry.version ?? 1, validationErrors: entry.validationErrors ?? [], publications: entry.publications ?? [] };
      if (detached) resource = { ...resource, provenance: detached.provenance, publications: detached.publications ?? [], readOnly: true };
      if (entry.kind === "playbook") {
        const files = (entry.files ?? []).map((file, index, all) => file === (all.find(f => f.path === "PLAYBOOK.md") || all.find(f => /\.md$/i.test(f.path))) ? { ...file, path: "PLAYBOOK.md" } : file);
        resource = { ...resource, ...this.module("instruction-library.cjs").preparePlaybook({ ...resource, files }), versionLabel: entry.documentVersion || "0.1.0" };
        if (this.project()) {
          try { resource.projectStatus = await this.playbooks().status(resource, this.project()); }
          catch { resource.projectStatus = { state: "unknown", path: "docs/playbooks/" }; }
        }
      }
      this.installedEntries.set(id, resource); this.catalog.set(id, { ...resource, versions: [{ digest: resource.digest, label: resource.versionLabel || this.label(resource) }] });
      this.snapshots.set(`${id}:${resource.digest}`, resource);
    }
    await this.restoreRemote();
    for (const [id, entry] of this.remoteEntries) {
      if (!this.connections().some(c => c.repository === entry.remote?.repository && c.sharing === entry.remote?.sharing)) continue;
      this.catalog.set(id, entry);
    }
    for (const [id, entry] of this.catalog) {
      if (entry.sourceKind === "builtin" && entry.installedRelativePath) {
        const mainPath = path.resolve(this.runtime.codexHome, entry.installedRelativePath);
        if (fs.existsSync(mainPath)) this.installedEntries.set(id, { ...entry, mainPath });
        const folder = path.dirname(mainPath);
        try { entry.canMigrate = entry.kind === "skill" && fs.lstatSync(folder).isSymbolicLink(); } catch { entry.canMigrate = false; }
      }
    }
    this.nativeSkills.clear();
    const settings = this.skillSettings();
    if (settings) {
      try {
        for (const skill of await settings.list()) this.nativeSkills.set(this.pathKey(skill.path), skill);
        for (const [id, entry] of this.catalog) {
          const installed = this.installedEntries.get(id);
          const skill = installed?.mainPath && this.skillAt(installed.mainPath, [...this.nativeSkills.values()]);
          if (entry.kind === "skill" && skill) { entry.canToggleSkill = true; entry.skillEnabled = skill.enabled; }
        }
      } catch (error) { this.notices.push({ en: `Skill inclusion state unavailable: ${String(error)}`, ko: `스킬 사용 설정을 확인할 수 없습니다: ${String(error)}` }); }
    }
  }

  private playbooks(): any { return new (this.module("instruction-library.cjs").PlaybookStore)({ stateRoot: path.join(this.runtime.codexHome, "azrael", "project-playbooks") }); }
  private migrations(): any { return this.migration ??= new (this.module("instruction-migration.cjs").InstructionMigration)({ installedRoot: this.runtime.codexHome, libraryRoot: this.root }); }

  private async restoreRemote(): Promise<void> {
    const cached = this.context.globalState?.get<any[]>(`azrael.instructionCatalog.v1:${this.root}`, []) ?? [];
    for (const entry of cached) {
      if (!entry || typeof entry.catalogId !== "string" || !entry.remote || !Array.isArray(entry.versions) || entry.versions.length > 100 || entry.files !== undefined) continue;
      if (!this.remoteEntries.has(entry.catalogId)) this.remoteEntries.set(entry.catalogId, entry);
    }
  }

  private async catalogVersion(entry: CatalogEntry, requested?: string, fetch = true): Promise<any> {
    const id = entry.catalogId || entry.id, digest = requested || entry.digest;
    if (!entry.versions?.some(version => version.digest === digest) && digest !== entry.digest) throw new Error("Select an available resource version.");
    const cached = this.snapshots.get(`${id}:${digest}`); if (cached) return cached;
    if (entry.sourceKind === "library") return this.library.readVersion(entry.id, digest);
    if (!entry.remote) return entry;
    const disk = await this.cachedSnapshot(id, digest);
    if (disk) {
      if (disk.id !== entry.id || disk.provenance?.repository !== entry.remote.repository || disk.provenance?.version !== entry.remote.releases[digest]) throw new Error("Cached resource source identity mismatch.");
      this.snapshots.set(`${id}:${digest}`, disk); return disk;
    }
    if (!fetch) return { ...entry, files: undefined };
    const connection = this.connections().find(c => c.repository === entry.remote!.repository && c.sharing === entry.remote!.sharing);
    if (!connection) throw new Error("Reconnect the resource source.");
    const release = entry.remote.releases[digest]; if (!release) throw new Error("Version content is unavailable.");
    const result = await this.publisher.download(await this.connection(connection.sharing, false, connection.repository), release);
    for (const resource of result.packages) {
      const key = `remote:${connection.sharing}:${connection.repository}:${resource.id}`;
      this.snapshots.set(`${key}:${resource.digest}`, { ...resource, publications: [], provenance: { repository: connection.repository, version: release, commit: result.manifest.sourceCommit } });
      await this.cachedSnapshot(key, resource.digest, this.snapshots.get(`${key}:${resource.digest}`));
    }
    const resource = this.snapshots.get(`${id}:${digest}`);
    if (!resource) throw new Error("The selected version is no longer available in this release.");
    return resource;
  }

  private catalogEntry(request: InstructionRequest): CatalogEntry {
    const entry = request.id && this.catalog.get(request.id); if (!entry) throw new Error("Select a catalog resource."); return entry;
  }

  private async refreshRemote(request: InstructionRequest): Promise<void> {
    this.remoteNotices = [];
    const connection = await this.connection(this.sharing(request), false, request.repository);
    const releases = await this.publisher.listReleases(connection);
    this.versions = [...this.versions.filter(v => v.repository !== connection.repository), ...releases.map((v: any) => ({ ...v, sharing: connection.sharing, repository: connection.repository }))];
    // Metadata is fetched without registration, installation, or full archive downloads.
    for (const release of releases.slice(0, 30).reverse()) {
      try {
        const result = await this.publisher.describeRelease(connection, release.version);
        for (const pkg of result.packages.filter((p: any) => p.current !== false)) {
          const id = `remote:${connection.sharing}:${connection.repository}:${pkg.id}`;
          const previous = this.remoteEntries.get(id), versions = previous?.versions?.filter(v => v.digest !== pkg.digest) || [];
          versions.unshift({ digest: pkg.digest, label: pkg.documentVersion || `${release.version} · r${pkg.version || 1}` });
          const { files: _metadataFiles, ...metadata } = pkg;
          this.remoteEntries.set(id, { ...metadata, catalogId: id, sourceKind: "remote", sourceLabel: connection.repository, readOnly: true, publications: [], versionLabel: pkg.documentVersion || release.version, versions,
            remote: { repository: connection.repository, sharing: connection.sharing, releases: { ...previous?.remote?.releases, [pkg.digest]: release.version }, commit: result.manifest.sourceCommit } });
        }
      } catch (error) { this.remoteNotices.push({ en: `${connection.repository} ${release.version}: ${String(error)}`, ko: `${connection.repository} ${release.version}: ${String(error)}` }); }
    }
    await this.context.globalState.update(`azrael.instructionCatalog.v1:${this.root}`, [...this.remoteEntries.values()].map(entry => this.publicRemote(entry)));
  }

  private publicRemote(entry: CatalogEntry): CatalogEntry { const { files: _files, sourcePath: _source, mainPath: _main, ...value } = entry; return value; }

  private async cachedSnapshot(id: string, digest: string, save?: any): Promise<any | undefined> {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Invalid catalog content identity.");
    const directory = path.join(this.root, "catalog-cache", createHash("sha256").update(id).digest("hex"));
    const filename = path.join(directory, `${digest}.json`);
    for (const item of [this.root, path.dirname(directory), directory, filename]) {
      try { if ((await fs.promises.lstat(item)).isSymbolicLink()) throw new Error("Linked catalog cache is unavailable."); }
      catch (error: any) { if (error.code !== "ENOENT") throw error; }
    }
    if (save) {
      if (this.module("instruction-library.cjs").packageDigest(save) !== digest) throw new Error("Catalog cache integrity mismatch.");
      await fs.promises.mkdir(directory, { recursive: true });
      await fs.promises.writeFile(filename, JSON.stringify(save), { flag: "wx" }).catch((error: any) => { if (error.code !== "EEXIST") throw error; });
      return save;
    }
    try {
      const stat = await fs.promises.stat(filename); if (stat.size > 192 * 1024 * 1024) throw new Error("Catalog cache exceeds the resource limit.");
      const resource = JSON.parse(await fs.promises.readFile(filename, "utf8"));
      if (resource.digest !== digest || this.module("instruction-library.cjs").packageDigest(resource) !== digest) throw new Error("Catalog cache integrity mismatch.");
      return resource;
    } catch (error: any) { if (error.code === "ENOENT") return undefined; throw error; }
  }

  private async compare(request: InstructionRequest): Promise<void> {
    this.discovery = undefined;
    await this.catalogSnapshot(await this.library.getState());
    const entry = this.catalogEntry(request), id = entry.catalogId || entry.id;
    try {
      const proposed = await this.catalogVersion(entry, request.toDigest);
      let current: any;
      if (request.fromDigest === "@installed") {
        if (entry.kind === "playbook") {
          const project = this.project(); if (!project) throw new Error("Select a local project first.");
          current = { files: await this.playbooks().readProject(proposed, project) };
        } else {
          const installed = this.installedEntries.get(id); if (!installed) throw new Error("Installed content is unavailable."); current = installed;
        }
      } else current = await this.catalogVersion(entry, request.fromDigest);
      const before = new Map<string, any>((current.files ?? []).map((f: any) => [f.path, f]));
      const after = new Map<string, any>((proposed.files ?? []).map((f: any) => [f.path, f]));
      const display = (file: any) => !file ? undefined : file.encoding === "base64" ? `Binary file (${Buffer.from(file.content, "base64").length} bytes)` : file.content;
      const files = [...new Set([...before.keys(), ...after.keys()])].sort().filter(key => JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key))).map(key => ({ path: key, current: display(before.get(key)), proposed: display(after.get(key)) }));
      this.comparison = { id, from: request.fromDigest || entry.digest, to: request.toDigest || entry.digest, files };
    } catch (error) { this.comparison = { id, from: request.fromDigest || "", to: request.toDigest || "", files: [], error: { en: `Version content unavailable: ${String(error)}`, ko: `버전 내용을 불러올 수 없습니다: ${String(error)}` } }; }
  }

  private async acquisitionResources(origin: CatalogEntry, entry: any): Promise<any[]> {
    const found = new Map<string, any>();
    const visit = async (resource: any): Promise<void> => {
      if (found.has(resource.id)) { if (found.get(resource.id).digest !== resource.digest) throw new Error("Dependency versions conflict."); return; }
      found.set(resource.id, resource);
      for (const dependency of resource.profile?.dependencies ?? []) {
        const cached = this.snapshots.get(`remote:${origin.remote?.sharing}:${origin.remote?.repository}:${dependency.id}:${dependency.digest}`);
        if (cached) await visit(cached);
        else { try { await visit(await this.library.readVersion(dependency.id, dependency.digest)); } catch { if (!dependency.optional) throw new Error(`Dependency content unavailable: ${dependency.id}`); } }
      }
    };
    await visit(entry); return [...found.values()];
  }

  private async importCatalog(origin: CatalogEntry, entry: any): Promise<any> {
    const resources = await this.acquisitionResources(origin, entry);
    if (origin.remote) {
      let selected: any;
      for (const resource of resources) {
        const imported = await this.library.importPackage(resource, { ...resource.provenance, current: resource.id === entry.id });
        if (resource.id === entry.id) selected = imported;
      }
      return selected;
    }
    return this.library.create({ name: entry.name, kind: entry.kind, sharing: "local", files: entry.files, profile: entry.profile,
      ...(entry.kind === "playbook" ? { preserveIdentity: entry.id, documentVersion: entry.documentVersion } : {}) });
  }

  private async copyCatalog(origin: CatalogEntry, entry: any, installationName?: string, upstreamDigest = entry.digest): Promise<any> {
    let files = entry.files;
    if (entry.kind === "skill") {
      const current = /^name:\s*(.+)$/m.exec(files.find((file: any) => file.path === "SKILL.md")?.content || "")?.[1]?.trim().replace(/^["']|["']$/g, "") || "skill";
      installationName = installationName || await vscode.window.showInputBox({ value: `${current.slice(0, 54)}-personal`, prompt: "Installation name for your separate personal skill / 개인 스킬의 별도 설치 이름", validateInput: value => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) && value !== current ? undefined : "Choose a distinct lowercase ASCII installation name / 다른 영문 소문자 설치 이름을 입력하세요." });
      if (!installationName) return undefined;
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(installationName) || installationName === current) throw new Error("Choose a distinct personal skill installation name.");
      const target = path.join(this.runtime.codexHome, "skills", installationName);
      if (fs.existsSync(target)) throw new Error("The personal skill installation name is already in use.");
      files = files.map((file: any) => file.path === "SKILL.md" && file.encoding === "utf8" ? { ...file, content: file.content.replace(/^(---\r?\n)([\s\S]*?)(\r?\n---)/, (_: string, start: string, body: string, end: string) => start + body.replace(/^name:.*$/m, `name: ${installationName}`) + end) } : file);
    }
    const imported = await this.library.create({ name: entry.kind === "skill" ? installationName : entry.name, kind: entry.kind, sharing: "local", files, profile: entry.profile,
      provenance: { sourceKind: origin.sourceKind || "library", repository: origin.remote?.repository || origin.sourceIdentity, resourceId: entry.id, digest: upstreamDigest, versionLabel: origin.versionLabel || this.label(entry) } });
    return imported;
  }

  private async prepareSkillInstallation(entry: any, enabled?: boolean): Promise<void> {
    const metadata = (await this.library.getState()).entries.find((value: any) => value.id === entry.id);
    if (entry.kind !== "skill" || !(entry.provenance || metadata?.provenance)) return;
    const main = entry.files?.find((file: any) => file.path === "SKILL.md");
    const name = /^name:\s*([a-z0-9][a-z0-9_-]{0,63})\s*$/m.exec(main?.content || "")?.[1];
    if (!name) throw new Error("Invalid personal skill installation name.");
    const target = path.join(this.runtime.codexHome, "skills", name, "SKILL.md");
    const settings = this.skillSettings();
    if (!settings?.setForInstallation) throw new Error("Native skill settings are required before installing a personal version.");
    const existing = (await settings.list()).find(skill => this.pathKey(skill.path) === this.pathKey(target));
    await settings.setForInstallation(target, existing?.enabled ?? enabled ?? false);
  }

  private async assertProfileSkillsEnabled(packages: any[]): Promise<void> {
    const settings = this.skillSettings();
    if (!settings) return;
    const states = await settings.list();
    for (const resource of packages.filter(value => value.kind === "skill")) {
      const matches = [...this.catalog.values()].filter(entry => entry.id === resource.id || entry.provenance?.resourceId === resource.id && entry.digest === resource.digest);
      for (const match of matches) {
        const installed = this.installedEntries.get(match.catalogId || match.id);
        if (installed?.mainPath && states.some(skill => this.pathKey(skill.path) === this.pathKey(installed.mainPath!) && !skill.enabled)) throw new Error(`The task profile requires an excluded skill: ${resource.name}. Review its skill inclusion setting first.`);
      }
    }
  }

  private ids(request: InstructionRequest): string[] {
    const ids = request.ids ?? (request.id ? [request.id] : []);
    if (!ids.length || ids.length > 100 || ids.some(id => typeof id !== "string" || id.length > 128)) throw new Error("Select instruction resources.");
    return ids;
  }

  private sharing(request: InstructionRequest): "public" | "collaborators" {
    if (request.sharing !== "public" && request.sharing !== "collaborators") throw new Error("Select a publication destination.");
    return request.sharing;
  }

  private selectedConnection(sharing: "public" | "collaborators", repository?: string): Connection {
    const connections = this.connections().filter(item => item.sharing === sharing && (!repository || item.repository.toLowerCase() === repository.toLowerCase()));
    if (connections.length !== 1) throw new Error("Select exactly one connected GitHub repository.");
    return connections[0];
  }

  private async connection(sharing: "public" | "collaborators", write = false, repository?: string): Promise<Connection & { token?: string }> {
    const connection = this.selectedConnection(sharing, repository);
    if (!connection) throw new Error("Connect the selected GitHub repository first.");
    let token: string | undefined;
    if (sharing === "collaborators" || write) {
      try {
        token = (await vscode.authentication.getSession("github", ["repo"], { createIfNone: true }))?.accessToken;
      } catch { /* A configured scoped token can be used when this host lacks GitHub sessions. */ }
      if (!token) token = await this.context.secrets?.get(`azrael.instructions.${connection.repository}`);
      if (!token) {
        const supplied = await vscode.window.showInputBox({ password: true, ignoreFocusOut: true,
          prompt: "GitHub access token for this instruction repository (stored in the host secret store)" });
        if (!supplied) throw new Error("GitHub authentication is required.");
        if (!this.context.secrets) throw new Error("Secure credential storage is unavailable.");
        await this.context.secrets.store(`azrael.instructions.${connection.repository}`, supplied); token = supplied;
      }
    }
    const result = await this.publisher.checkConnection({ ...connection, token });
    this.checked.set(connection.repository.toLowerCase(), { ...connection, readable: result.readable, writable: result.writable });
    if (write && !result.writable) throw new Error("The selected GitHub account cannot publish to this repository.");
    return { ...connection, token };
  }

  private requirePlan(request: InstructionRequest, kind: "apply" | "publish" | "task" | "delete" | "migrate"): any {
    if (!this.plan || this.plan.kind !== kind || request.token !== this.plan.token) throw new Error("Review a fresh operation plan first.");
    return this.plan.value;
  }

  private inventory(packages: any[]): string {
    return packages.map(entry => `${entry.name} (${entry.kind}, ${entry.sharing})\n${entry.id}@${entry.digest}\n${entry.files.map((file: any) => `  ${file.path} (${file.encoding})`).join("\n")}${entry.kind === "task-profile" ? `\n${JSON.stringify({ model: entry.profile.model, provider: entry.profile.provider, reasoningEffort: entry.profile.reasoningEffort, harness: entry.profile.harness }, null, 2)}` : ""}`).join("\n\n");
  }

  private displayBytes(bytes: Buffer | null): string {
    if (!bytes) return "File absent";
    const text = bytes.toString("utf8");
    return !bytes.includes(0) && Buffer.from(text, "utf8").equals(bytes) ? text : `Binary file (${bytes.length} bytes)`;
  }

  async request(action: InstructionAction, request: InstructionRequest): Promise<void> {
    const library = this.backend();
    if (action === "libraryRefresh") { this.discovery = undefined; return; }
    if (action === "librarySetSource") {
      if (!["release", "project"].includes(request.sourceMode || "")) throw new Error("Select a canonical instruction source.");
      if (request.sourceMode === "project" && (!request.sourceProject || !this.projects().some(project => this.pathKey(project.id) === this.pathKey(request.sourceProject!)) || !fs.existsSync(path.join(request.sourceProject, "instructions", "azrael-environment.json")))) throw new Error("Select an Azrael authoring project containing instructions/azrael-environment.json.");
      await this.context.globalState.update(this.sourceKey(), { mode: request.sourceMode, ...(request.sourceMode === "project" ? { project: path.resolve(request.sourceProject!) } : {}) });
      this.discovery = undefined; this.snapshots.clear(); this.selectedId = undefined; this.plan = undefined; this.acquire = undefined; return;
    }
    if (action === "librarySetSkillEnabled") {
      if (typeof request.enabled !== "boolean") throw new Error("Choose whether to include this skill.");
      await this.catalogSnapshot(await library.getState());
      const entry = this.catalogEntry(request), installed = this.installedEntries.get(entry.catalogId || entry.id);
      if (entry.kind !== "skill" || !entry.canToggleSkill || !installed?.mainPath) throw new Error("Select an installed skill with verified native settings.");
      const settings = this.skillSettings()!;
      const skill = this.skillAt(installed.mainPath, await settings.list());
      if (!skill || await settings.set(skill.path, request.enabled) !== request.enabled) throw new Error("The effective skill setting differs from the requested value.");
      this.plan = undefined; this.acquire = undefined; return;
    }
    if (action === "libraryPlanDelete") {
      const entry = this.catalogEntry(request);
      if (entry.sourceKind !== "library" || entry.readOnly) throw new Error("Only a personal authoring resource can be deleted.");
      const value = await library.planDelete(entry.id, { removeInstallation: request.removeInstallation === true });
      this.acquire = undefined;
      this.plan = { token: randomUUID(), kind: "delete", value, summary: { en: `Delete personal source: ${entry.name}\n${request.removeInstallation ? "Also remove the unchanged managed installation." : "Keep installed files and installation ownership."}\nUpstream sources and GitHub history are preserved.\nRetained versions: ${value.affected?.retainedVersions?.length || 0}`, ko: `개인 작업본 삭제: ${entry.name}\n${request.removeInstallation ? "변경되지 않은 관리 설치본도 제거합니다." : "설치 파일과 설치 소유권은 유지합니다."}\n원본과 GitHub 게시 이력은 보존합니다.\n보존 버전: ${value.affected?.retainedVersions?.length || 0}` },
        preview: [...(value.sourceDiffs || []), ...(value.diffs || [])].map((diff: any) => ({ path: diff.path, current: this.displayBytes(diff.beforeContent == null ? null : Buffer.from(diff.beforeContent, "base64")), proposed: this.displayBytes(diff.content == null ? null : Buffer.from(diff.content, "base64")) })) }; return;
    }
    if (action === "libraryDelete") {
      await library.delete(this.requirePlan(request, "delete"));
      this.plan = undefined; this.acquire = undefined; this.selectedId = undefined; this.selectedDigest = undefined; this.snapshots.clear(); this.discovery = undefined; return;
    }
    if (action === "libraryPlanMigrate") {
      const entry = this.catalogEntry(request);
      if (entry.sourceKind !== "builtin" || !entry.canMigrate) throw new Error("Select a canonical skill with a linked installation.");
      const value = await this.migrations().plan(await this.catalogVersion(entry));
      const installedName = path.posix.basename(path.posix.dirname(entry.installedRelativePath!));
      const name = `${installedName.slice(0, 43)}-legacy-${value.legacyDigest?.slice(0, 8) || "copy"}`;
      const settings = this.skillSettings();
      const skill = settings && this.skillAt(path.join(this.runtime.codexHome, entry.installedRelativePath!), await settings.list());
      if (!skill || !settings?.setForInstallation) throw new Error("Verify native skill inclusion before migrating this installation.");
      this.migrationOrigin = { id: entry.catalogId || entry.id, digest: entry.digest, source: JSON.stringify(this.source()), name, enabled: skill.enabled };
      this.acquire = undefined;
      this.plan = { token: randomUUID(), kind: "migrate", value, summary: { en: `Replace linked installation with ${entry.name} from the canonical source.\n${value.differences.length ? `Preserve differing files as personal resource ${name} before replacement.` : "Installed bytes match the canonical source."}\nThe external original is kept. Review skill inclusion after migration.`, ko: `연결된 설치를 원본의 ${entry.name}(으)로 전환합니다.\n${value.differences.length ? `다른 파일은 전환 전에 ${name} 개인 작업본으로 보존합니다.` : "설치 내용이 원본과 같습니다."}\n외부 원본은 보존합니다. 전환 후 스킬 사용 설정을 확인하세요.` }, preview: value.differences.map((diff: any) => ({ path: diff.path, current: diff.action === "add" ? undefined : "Existing linked file", proposed: diff.action === "remove" ? undefined : "Canonical source file" })) }; return;
    }
    if (action === "libraryMigrate") {
      const value = this.requirePlan(request, "migrate"), origin = this.migrationOrigin;
      if (!origin || origin.source !== JSON.stringify(this.source())) throw new Error("Canonical source changed; review migration again.");
      this.discovery = undefined; this.snapshots.clear(); await this.catalogSnapshot(await library.getState());
      const entry = this.catalog.get(origin.id);
      if (!entry || entry.digest !== origin.digest || !entry.canMigrate) throw new Error("Canonical content or linked installation changed; review migration again.");
      const target = path.join(this.runtime.codexHome, entry.installedRelativePath!);
      const settings = this.skillSettings();
      const skill = settings && this.skillAt(target, await settings.list());
      if (!skill || skill.enabled !== origin.enabled || !settings?.setForInstallation) throw new Error("Skill inclusion changed; review migration again.");
      let preservedDigest: string | undefined;
      if (value.differences.length) {
        if (!origin.preservedId) {
          const files = value.legacyFiles.map((file: any) => { const data = Buffer.from(file.content, file.encoding); const text = data.toString("utf8"); return { path: file.path, encoding: !data.includes(0) && Buffer.from(text).equals(data) ? "utf8" : "base64", content: !data.includes(0) && Buffer.from(text).equals(data) ? text : data.toString("base64") }; });
          // Preserve the exact original skill body as well as a separately named usable copy.
          const main = files.find((file: any) => file.path === "SKILL.md");
          if (main) files.push({ ...main, path: `migration-original-${value.legacyDigest.slice(0, 8)}.md` });
          const preserved = await this.copyCatalog(entry, { ...entry, files, digest: value.legacyDigest }, origin.name, origin.digest);
          if (!preserved) throw new Error("Legacy content must be preserved before migration.");
          origin.preservedId = preserved.id;
          origin.preservedDigest = preserved.digest;
        }
        const preserved = await library.read(origin.preservedId);
        if (preserved.digest !== origin.preservedDigest) throw new Error("Preserved legacy content changed; review migration again.");
        preservedDigest = value.legacyDigest;
      }
      await settings.setForInstallation(target, origin.enabled);
      await this.migrations().apply(value, { preservedDigest });
      const installed = this.skillAt(target, await settings.list());
      if (!installed || installed.enabled !== origin.enabled) throw new Error("Migration completed; native skill inclusion needs checking.");
      this.plan = undefined; this.migrationOrigin = undefined; this.discovery = undefined; this.snapshots.clear(); return;
    }
    if (action === "librarySetProject") {
      if (!this.projects().some(item => item.id === request.project)) throw new Error("Select an available local project.");
      this.selectedProject = request.project; this.comparison = undefined; this.plan = undefined; this.acquire = undefined; return;
    }
    if (action === "libraryBack") { this.selectedId = undefined; this.selectedDigest = undefined; this.plan = undefined; this.acquire = undefined; return; }
    if (action === "libraryCompare") { await this.compare(request); return; }
    if (action === "librarySelect" || action === "libraryInspectVersion") {
      // Existing local callers can select immediately after creation without a prior catalog render.
      if (!this.catalog.has(request.id || "")) await this.catalogSnapshot(await library.getState());
      const entry = this.catalogEntry(request);
      await this.catalogVersion(entry, request.digest);
      this.selectedId = entry.catalogId || entry.id; this.selectedDigest = request.digest; this.plan = undefined; this.acquire = undefined; return;
    }
    if (action === "libraryOpenInstalled") {
      const entry = this.catalogEntry(request);
      const installed = this.installedEntries.get(entry.catalogId || entry.id);
      const filename = entry.kind === "playbook" && this.project() ? (await this.playbooks().status(await this.catalogVersion(entry), this.project())).path : installed?.mainPath || entry.mainPath;
      if (!filename || !path.isAbsolute(filename) || !fs.existsSync(filename)) throw new Error("The installed file is unavailable.");
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(filename))); return;
    }
    if (action === "libraryPlanAcquire") {
      const origin = this.catalogEntry(request), entry = await this.catalogVersion(origin, request.digest || this.selectedDigest);
      if (!["playbook", "skill", "agent-role"].includes(entry.kind)) throw new Error("This resource is kept in the library or used through a task profile.");
      if (entry.validationErrors?.length) throw new Error("Fix this resource before installation.");
      const state = await library.getState(), project = entry.kind === "playbook" ? this.project() : undefined;
      if (entry.kind === "playbook" && !project) throw new Error("Select a local project before downloading a Playbook.");
      const resources = await this.acquisitionResources(origin, entry);
      const value = entry.kind === "playbook" ? await this.playbooks().plan(entry, project) : await library.planApply([entry.id], { digests: { [entry.id]: entry.digest }, resources: origin.sourceKind === "library" ? undefined : resources, provenance: entry.provenance });
      const token = randomUUID();
      this.acquire = { token, entry, origin, value, project, libraryRevision: state.revision, enabled: request.enabled };
      this.plan = { token, kind: "apply", value, summary: { en: `Review resource ${entry.name} (${this.label(entry)})\nDestination: ${project || this.runtime.codexHome}`, ko: `${entry.name} (${this.label(entry)}) 변경 검토\n대상: ${project || this.runtime.codexHome}` },
        preview: value.diffs.map((diff: any) => ({ path: diff.path, current: this.displayBytes(diff.beforeContent === null ? null : Buffer.from(diff.beforeContent, "base64")), proposed: this.displayBytes(diff.content === null ? null : Buffer.from(diff.content, "base64")) })) }; return;
    }
    if (action === "libraryAcquire") {
      const acquired = this.acquire;
      if (!acquired || acquired.token !== request.token || this.plan?.token !== request.token) throw new Error("Review a fresh installation plan.");
      if ((await library.getState()).revision !== acquired.libraryRevision || acquired.project && this.project() !== acquired.project) throw new Error("Resource or project selection changed; review a new plan.");
      if (acquired.project) {
        if (acquired.origin.sourceKind !== "library") await this.importCatalog(acquired.origin, acquired.entry);
        await this.playbooks().apply(acquired.value);
      } else { await this.prepareSkillInstallation(acquired.entry, acquired.enabled); await library.apply(acquired.value); }
      this.acquire = undefined; this.plan = undefined; this.selectedDigest = undefined; this.discovery = undefined; return;
    }
    if (action === "libraryImport") {
      if (request.id) {
        const origin = this.catalogEntry(request), entry = await this.catalogVersion(origin, request.digest);
        const imported = await this.copyCatalog(origin, entry, request.installationName); if (!imported) return; this.selectedId = imported.id; this.selectedDigest = undefined; this.plan = undefined; return;
      }
      const selection = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: true, canSelectMany: false, openLabel: "Import instruction resource" });
      if (!selection?.length) return;
      const imported = await library.importPath(selection[0].fsPath, { kind: request.kind, name: request.name, sharing: request.sharing });
      this.selectedId = imported.id; this.plan = undefined; return;
    }
    if (action === "libraryCreate") {
      if (!request.name || !request.kind || !request.files) throw new Error("Name, kind and files are required.");
      const created = await library.create({ name: request.name, kind: request.kind, sharing: request.sharing ?? (request.kind === "playbook" ? "local" : "collaborators"), files: request.files, profile: request.profile });
      this.selectedId = created.id; this.plan = undefined; return;
    }
    if (action === "librarySave") {
      await library.save(this.ids(request)[0], { name: request.name, sharing: request.sharing, files: request.files, profile: request.profile }, request.revision);
      this.plan = undefined; return;
    }
    if (action === "libraryPlanApply") {
      const selected = await library.read(this.ids(request)[0]);
      if (["playbook", "context", "task-profile"].includes(selected.kind)) throw new Error("Use the resource's destination-specific action.");
      const value = await library.planApply(this.ids(request));
      const preview = value.diffs.map((diff: any) => ({ path: diff.path,
        current: this.displayBytes(diff.beforeContent === null ? null : Buffer.from(diff.beforeContent, "base64")),
        proposed: this.displayBytes(diff.content === null ? null : Buffer.from(diff.content, "base64")) }));
      const inventory = this.inventory(value.entries);
      this.plan = { token: randomUUID(), kind: "apply", value: { ...value, skillEnabled: request.enabled }, preview, summary: { en: `Apply the reviewed resources. New conversations use the changes.\n\n${inventory}`, ko: `검토한 리소스를 설치본에 적용합니다. 변경은 새 대화부터 사용합니다.\n\n${inventory}` } }; return;
    }
    if (action === "libraryApply") {
      const value = this.requirePlan(request, "apply");
      for (const entry of value.entries ?? []) await this.prepareSkillInstallation(entry, value.skillEnabled);
      const { skillEnabled: _enabled, ...backendPlan } = value;
      await library.apply(backendPlan); this.plan = undefined; this.discovery = undefined; return;
    }
    if (action === "libraryConnect") {
      const sharing = this.sharing(request);
      if (!request.repository || !/^[\w.-]+\/[\w.-]+$/.test(request.repository)) throw new Error("Use GitHub owner/repository format.");
      const branch = request.branch || "main";
      if (!/^[\w./-]+$/.test(branch) || branch.includes("..")) throw new Error("Invalid repository branch.");
      const previous = this.connections();
      const connections = previous.filter(item => item.repository.toLowerCase() !== request.repository!.toLowerCase());
      if (connections.some(item => item.repository.toLowerCase() === request.repository!.toLowerCase())) throw new Error("Public and collaborator sources must use separate repositories.");
      const candidate = { sharing, repository: request.repository, branch };
      await this.context.globalState.update(this.connectionKey(), [...connections, candidate]);
      try { await this.connection(sharing, false, request.repository); } catch (error) { await this.context.globalState.update(this.connectionKey(), previous); this.checked.delete(request.repository.toLowerCase()); throw error; }
      this.versions = this.versions.filter(value => value.repository !== request.repository);
      this.plan = undefined; return;
    }
    if (action === "libraryRemoteRefresh") {
      await this.refreshRemote(request); return;
    }
    if (action === "libraryRemoteImport") {
      if (!request.version) throw new Error("Select a resource release.");
      const result = await this.publisher.download(await this.connection(this.sharing(request), false, request.repository), request.version);
      for (const entry of result.packages) {
        // Preserve identity and historical version when importing verified remote packages.
        if (typeof library.importPackage !== "function") throw new Error("Verified remote package import is unavailable.");
        const imported = await library.importPackage(entry, { repository: result.manifest.repository, version: request.version, commit: result.manifest.sourceCommit, current: entry.current !== false });
        this.selectedId = imported.id;
      }
      this.plan = undefined; return;
    }
    if (action === "libraryPlanPublish") {
      const ids = this.ids(request);
      const entry = await library.read(ids[0]);
      const sharing = this.sharing({ ...request, sharing: request.sharing ?? entry.sharing });
      const value = await library.planPublish(ids, sharing);
      const connection = this.selectedConnection(sharing, request.repository);
      if (!connection || !request.version) throw new Error("Connect a repository and enter a publication version.");
      this.plan = { token: randomUUID(), kind: "publish", value: { ...value, connection: { ...connection } }, sharing, version: request.version,
        summary: { en: `Publish selected changes to ${connection.repository} (${sharing}), version ${request.version}. Past releases remain available.\n\n${this.inventory(value.packages)}`, ko: `${connection.repository} (${sharing})에 ${request.version} 버전으로 선택한 변경을 게시합니다. 과거 배포본은 보존합니다.\n\n${this.inventory(value.packages)}` } }; return;
    }
    if (action === "libraryPublish") {
      const value = this.requirePlan(request, "publish"), plan = this.plan!;
      const fresh = await library.planPublish(value.rootIds, plan.sharing);
      if (fresh.digest !== value.digest) throw new Error("Instruction content or sharing changed. Review a new publication plan.");
      const target = this.connections().find(item => item.sharing === plan.sharing && item.repository === value.connection.repository);
      if (target?.repository !== value.connection.repository || target?.branch !== value.connection.branch) throw new Error("The publication destination changed. Review a new plan.");
      const connection = await this.connection(plan.sharing as "public" | "collaborators", true, value.connection.repository);
      if (connection.repository !== value.connection.repository || connection.branch !== value.connection.branch) throw new Error("The publication destination changed. Review a new plan.");
      if ((await library.planPublish(value.rootIds, plan.sharing)).digest !== value.digest) throw new Error("Instruction content or sharing changed during authentication. Review a new publication plan.");
      try {
        const { connection: _, ...frozen } = value;
        const receipt = await this.publisher.publish(frozen, connection, { version: plan.version });
        await library.recordPublication(frozen, { ...receipt, destination: receipt.repository });
        this.operation = { ...receipt, id: receipt.operationId }; this.plan = undefined;
      } catch (error: any) {
        this.operation = { id: error.operationId, phase: error.phase ?? "failed", repository: connection.repository, version: plan.version };
        if (error.commit && error.phase === "source-committed") {
          const { connection: _, ...frozen } = value;
          await library.recordPublication(frozen, { destination: connection.repository, version: plan.version, commit: error.commit });
        }
        throw new Error(`Publication ${this.operation.phase}. ${error.message}`);
      }
      return;
    }
    if (action === "libraryRecover") {
      if (fs.existsSync(path.join(this.runtime.codexHome, "azrael", "instructions", "migration-journal.json"))) {
        const migration = await this.migrations().recover();
        if (migration.recovered) { this.plan = undefined; this.migrationOrigin = undefined; this.discovery = undefined; return; }
      }
      if (this.operation?.id && this.operation.repository) {
        const connection = this.connections().find(item => item.repository === this.operation!.repository);
        if (!connection) throw new Error("Reconnect the interrupted publication repository.");
        const id = this.operation.id;
        const frozen = await this.publisher.readOperationPlan(id);
        if (!await this.publisher.readOperationReceipt(id)) {
          const current = await library.getState();
          if (frozen.packages.some((entry: any) => current.entries.find((head: any) => head.id === entry.id)?.sharing !== frozen.sharing)) throw new Error("Sharing changed before the source was committed. Review a new publication plan.");
        }
        const receipt = await this.publisher.recover(await this.connection(connection.sharing, true, connection.repository), id);
        await library.recordPublication(frozen, { ...receipt, destination: receipt.repository });
        this.operation = { ...receipt, id: receipt.operationId };
      } else { await library.recover(); this.operation = undefined; }
      return;
    }
    if (action === "libraryPrepareTask") {
      const overrides = Object.fromEntries(["model", "provider", "reasoningEffort"].filter(key => request[key as keyof InstructionRequest] !== undefined).map(key => [key, request[key as keyof InstructionRequest]]));
      const value = await library.resolveProfile(this.ids(request)[0], overrides);
      await this.assertProfileSkillsEnabled(value.packages);
      const content = `${this.inventory(value.packages)}\n\n${value.instructions.filter((entry: any) => entry.loading === "persistent").map((entry: any) => `${entry.id}:\n${entry.text}`).join("\n\n")}`;
      this.plan = { token: randomUUID(), kind: "task", value, summary: { en: `Start a new conversation with ${value.model}.\n\n${content}`, ko: `${value.model} 모델로 선택한 새 대화를 시작합니다.\n\n${content}` } }; return;
    }
    if (action === "libraryStartTask") {
      const value = this.requirePlan(request, "task");
      const overrides = Object.fromEntries(["model", "provider", "reasoningEffort"].filter(key => value[key] !== undefined).map(key => [key, value[key]]));
      const fresh = await library.resolveProfile(value.profileId, overrides);
      await this.assertProfileSkillsEnabled(fresh.packages);
      if (fresh.digest !== value.digest) throw new Error("Task profile changed. Review a new conversation plan.");
      await vscode.commands.executeCommand("azrael.startTaskProfile", value, this.runtime.codexHome);
      this.plan = undefined; return;
    }
    throw new Error("Unknown instruction-library action.");
  }
}

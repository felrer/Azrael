import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { InstructionAction, InstructionLibraryUiState, InstructionRequest, InstructionResource, InstructionSharing } from "./instructionProtocol";

type Connection = { sharing: "public" | "collaborators"; repository: string; branch: string; readable?: boolean; writable?: boolean };
const libraryActions = new Set<InstructionAction>(["libraryRefresh", "libraryImport", "libraryCreate", "librarySelect", "librarySave", "libraryPlanApply", "libraryApply", "libraryPlanPublish", "libraryPublish", "libraryRecover", "libraryConnect", "libraryRemoteRefresh", "libraryRemoteImport", "libraryPrepareTask", "libraryStartTask"]);

/** Host-only adapter. Credentials and immutable operation plans never enter the webview. */
export class InstructionLibraryService {
  private library: any;
  private publisher: any;
  private root = "";
  private selectedId?: string;
  private versions: NonNullable<InstructionLibraryUiState["remoteVersions"]> = [];
  private checked = new Map<string, Connection>();
  private plan?: { token: string; kind: "apply" | "publish" | "task"; value: any; summary: NonNullable<InstructionLibraryUiState["plan"]>["summary"]; preview?: NonNullable<InstructionLibraryUiState["plan"]>["diffs"]; sharing?: InstructionSharing; version?: string };
  private operation?: InstructionLibraryUiState["operation"];
  private connectionKey(): string { return `azrael.instructionConnections.v1:${this.root}`; }

  constructor(private readonly context: vscode.ExtensionContext, private readonly runtime: { engine: string; codexHome: string }) {}

  handles(action: InstructionAction): boolean { return libraryActions.has(action); }

  private module(name: string): any {
    const extensionRoot = this.context.extensionUri.fsPath;
    const filename = [path.join(extensionRoot, "account-ui", name), path.join(extensionRoot, name), path.resolve(extensionRoot, "../../scripts", name)].find(file => fs.existsSync(file));
    if (!filename) throw new Error(`Instruction module missing: ${name}`);
    return require(filename);
  }

  private backend(): any {
    const configured = vscode.workspace.getConfiguration("azrael").get<string>("instructions.libraryRoot", "").trim();
    const workspace = vscode.workspace.workspaceFolders?.find(folder => folder.uri.scheme === "file")?.uri.fsPath;
    // Only this application's authoring checkout gets a project-local default.
    const authoring = workspace && fs.existsSync(path.join(workspace, "instructions", "azrael-environment.json"));
    const root = configured ? path.resolve(configured) : authoring ? path.join(workspace!, "instruction-library") : `${path.resolve(this.runtime.codexHome)}-instruction-library`;
    if (!this.library || this.root !== root) {
      const { InstructionLibrary } = this.module("instruction-library.cjs");
      this.library = new InstructionLibrary({ root, installedRoot: this.runtime.codexHome, appVersion: this.context.extension?.packageJSON?.version ?? "0.4.0" });
      this.publisher = new (this.module("instruction-publisher.cjs").InstructionPublisher)({ stateRoot: path.join(root, "operations") });
      this.root = root; this.selectedId = undefined; this.plan = undefined; this.versions = []; this.checked.clear();
    }
    return this.library;
  }

  private connections(): Connection[] {
    const values = this.context.globalState?.get<Connection[]>(this.connectionKey(), []) ?? [];
    if (!Array.isArray(values) || values.some(value => !value || !["public", "collaborators"].includes(value.sharing) ||
      !/^[\w.-]+\/[\w.-]+$/.test(value.repository) || !/^[\w./-]+$/.test(value.branch) || value.branch.includes("..")) ||
      new Set(values.map(value => value.sharing)).size !== values.length ||
      new Set(values.map(value => value.repository.toLowerCase())).size !== values.length) throw new Error("Invalid instruction repository connections.");
    return values;
  }

  async snapshot(): Promise<InstructionLibraryUiState> {
    this.backend();
    const recovery = await this.library.recoveryState();
    const interruptedApply = recovery.recoveryRequired;
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
    const selected = this.selectedId && state.entries.some((entry: InstructionResource) => entry.id === this.selectedId) ? await this.library.read(this.selectedId) : undefined;
    if (!this.operation && typeof this.publisher.listOperations === "function") {
      const pending = (await this.publisher.listOperations()).find((value: any) => value.phase !== "published");
      if (pending) this.operation = pending;
    }
    const resource = (entry: any): InstructionResource => ({ ...entry, publications: entry.publications.map((receipt: any) => ({ ...receipt, repository: receipt.repository ?? receipt.destination })) });
    return { revision: state.revision, entries: state.entries.map(resource), selected: selected ? resource(selected) : undefined,
      connections: this.connections().map(connection => this.checked.get(connection.sharing) ?? connection), remoteVersions: this.versions,
      plan: this.plan ? { token: this.plan.token, kind: this.plan.kind, summary: this.plan.summary,
        conflicts: (this.plan.value.conflicts ?? []).map((reason: string) => ({ target: "", reason })), diffs: this.plan.preview,
        model: this.plan.value.model, provider: this.plan.value.provider } : undefined, operation: this.operation };
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

  private async connection(sharing: "public" | "collaborators", write = false): Promise<Connection & { token?: string }> {
    const connection = this.connections().find(item => item.sharing === sharing);
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
    this.checked.set(sharing, { ...connection, readable: result.readable, writable: result.writable });
    if (write && !result.writable) throw new Error("The selected GitHub account cannot publish to this repository.");
    return { ...connection, token };
  }

  private requirePlan(request: InstructionRequest, kind: "apply" | "publish" | "task"): any {
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
    if (action === "libraryRefresh") return;
    if (action === "librarySelect") { this.selectedId = this.ids(request)[0]; this.plan = undefined; return; }
    if (action === "libraryImport") {
      const selection = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: true, canSelectMany: false, openLabel: "Import instruction resource" });
      if (!selection?.length) return;
      const imported = await library.importPath(selection[0].fsPath, { kind: request.kind, name: request.name, sharing: request.sharing });
      this.selectedId = imported.id; this.plan = undefined; return;
    }
    if (action === "libraryCreate") {
      if (!request.name || !request.kind || !request.files) throw new Error("Name, kind and files are required.");
      const created = await library.create({ name: request.name, kind: request.kind, sharing: request.sharing ?? "collaborators", files: request.files, profile: request.profile });
      this.selectedId = created.id; this.plan = undefined; return;
    }
    if (action === "librarySave") {
      await library.save(this.ids(request)[0], { name: request.name, sharing: request.sharing, files: request.files, profile: request.profile }, request.revision);
      this.plan = undefined; return;
    }
    if (action === "libraryPlanApply") {
      const value = await library.planApply(this.ids(request));
      const preview = value.diffs.map((diff: any) => ({ path: diff.path,
        current: this.displayBytes(diff.beforeContent === null ? null : Buffer.from(diff.beforeContent, "base64")),
        proposed: this.displayBytes(diff.content === null ? null : Buffer.from(diff.content, "base64")) }));
      const inventory = this.inventory(value.entries);
      this.plan = { token: randomUUID(), kind: "apply", value, preview, summary: { en: `Apply the reviewed resources. New conversations use the changes.\n\n${inventory}`, ko: `검토한 리소스를 설치본에 적용합니다. 변경은 새 대화부터 사용합니다.\n\n${inventory}` } }; return;
    }
    if (action === "libraryApply") { await library.apply(this.requirePlan(request, "apply")); this.plan = undefined; return; }
    if (action === "libraryConnect") {
      const sharing = this.sharing(request);
      if (!request.repository || !/^[\w.-]+\/[\w.-]+$/.test(request.repository)) throw new Error("Use GitHub owner/repository format.");
      const branch = request.branch || "main";
      if (!/^[\w./-]+$/.test(branch) || branch.includes("..")) throw new Error("Invalid repository branch.");
      const previous = this.connections();
      const connections = previous.filter(item => item.sharing !== sharing);
      if (connections.some(item => item.repository.toLowerCase() === request.repository!.toLowerCase())) throw new Error("Public and collaborator sources must use separate repositories.");
      const candidate = { sharing, repository: request.repository, branch };
      await this.context.globalState.update(this.connectionKey(), [...connections, candidate]);
      try { await this.connection(sharing); } catch (error) { await this.context.globalState.update(this.connectionKey(), previous); this.checked.delete(sharing); throw error; }
      this.versions = this.versions.filter(value => value.sharing !== sharing);
      this.plan = undefined; return;
    }
    if (action === "libraryRemoteRefresh") {
      const connection = await this.connection(this.sharing(request));
      this.versions = [...this.versions.filter(value => value.sharing !== connection.sharing), ...(await this.publisher.listReleases(connection)).map((version: { version: string; notes?: string }) => ({ ...version, sharing: connection.sharing, repository: connection.repository }))]; return;
    }
    if (action === "libraryRemoteImport") {
      if (!request.version) throw new Error("Select a resource release.");
      const result = await this.publisher.download(await this.connection(this.sharing(request)), request.version);
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
      const connection = this.connections().find(item => item.sharing === sharing);
      if (!connection || !request.version) throw new Error("Connect a repository and enter a publication version.");
      this.plan = { token: randomUUID(), kind: "publish", value: { ...value, connection: { ...connection } }, sharing, version: request.version,
        summary: { en: `Publish selected changes to ${connection.repository} (${sharing}), version ${request.version}. Past releases remain available.\n\n${this.inventory(value.packages)}`, ko: `${connection.repository} (${sharing})에 ${request.version} 버전으로 선택한 변경을 게시합니다. 과거 배포본은 보존합니다.\n\n${this.inventory(value.packages)}` } }; return;
    }
    if (action === "libraryPublish") {
      const value = this.requirePlan(request, "publish"), plan = this.plan!;
      const fresh = await library.planPublish(value.rootIds, plan.sharing);
      if (fresh.digest !== value.digest) throw new Error("Instruction content or sharing changed. Review a new publication plan.");
      const target = this.connections().find(item => item.sharing === plan.sharing);
      if (target?.repository !== value.connection.repository || target?.branch !== value.connection.branch) throw new Error("The publication destination changed. Review a new plan.");
      const connection = await this.connection(plan.sharing as "public" | "collaborators", true);
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
      if (this.operation?.id && this.operation.repository) {
        const connection = this.connections().find(item => item.repository === this.operation!.repository);
        if (!connection) throw new Error("Reconnect the interrupted publication repository.");
        const id = this.operation.id;
        const frozen = await this.publisher.readOperationPlan(id);
        if (!await this.publisher.readOperationReceipt(id)) {
          const current = await library.getState();
          if (frozen.packages.some((entry: any) => current.entries.find((head: any) => head.id === entry.id)?.sharing !== frozen.sharing)) throw new Error("Sharing changed before the source was committed. Review a new publication plan.");
        }
        const receipt = await this.publisher.recover(await this.connection(connection.sharing, true), id);
        await library.recordPublication(frozen, { ...receipt, destination: receipt.repository });
        this.operation = { ...receipt, id: receipt.operationId };
      } else { await library.recover(); this.operation = undefined; }
      return;
    }
    if (action === "libraryPrepareTask") {
      const overrides = Object.fromEntries(["model", "provider", "reasoningEffort"].filter(key => request[key as keyof InstructionRequest] !== undefined).map(key => [key, request[key as keyof InstructionRequest]]));
      const value = await library.resolveProfile(this.ids(request)[0], overrides);
      const content = `${this.inventory(value.packages)}\n\n${value.instructions.filter((entry: any) => entry.loading === "persistent").map((entry: any) => `${entry.id}:\n${entry.text}`).join("\n\n")}`;
      this.plan = { token: randomUUID(), kind: "task", value, summary: { en: `Start a new conversation with ${value.model}.\n\n${content}`, ko: `${value.model} 모델로 선택한 새 대화를 시작합니다.\n\n${content}` } }; return;
    }
    if (action === "libraryStartTask") {
      const value = this.requirePlan(request, "task");
      const overrides = Object.fromEntries(["model", "provider", "reasoningEffort"].filter(key => value[key] !== undefined).map(key => [key, value[key]]));
      const fresh = await library.resolveProfile(value.profileId, overrides);
      if (fresh.digest !== value.digest) throw new Error("Task profile changed. Review a new conversation plan.");
      await vscode.commands.executeCommand("azrael.startTaskProfile", value, this.runtime.codexHome);
      this.plan = undefined; return;
    }
    throw new Error("Unknown instruction-library action.");
  }
}

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { InstructionLibraryService } from "./instructionLibraryService";
import { parseProviderSnapshot } from "./providerAccountService";

type Project = { id: string; name?: string; cwd?: string };
type LiveContext = { hostId: "local"; project: Project | null; models: any[] };
const actions = new Set(["createPackage", "derivePackage", "download", "createProfile", "saveProfile", "duplicateProfile", "deleteProfile", "equip", "unequip", "refresh", "importFiles"]);
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);

/** Native adapter for the shared domain. It owns no HTTP listener or account writes. */
export class InstructionWorkbenchService implements vscode.Disposable {
  private workbench: any;
  private roleProfileStore: any;
  private configuration = "";
  private initializing?: Promise<any>;
  private disposed = false;
  private readonly library: InstructionLibraryService;
  constructor(private readonly context: vscode.ExtensionContext,
    private readonly runtime: { engine: string; codexHome: string; env?: NodeJS.ProcessEnv },
    private readonly selectedAccount?: (account: { providerId: string; accountId: string }) => Promise<boolean>) {
    this.library = new InstructionLibraryService(context, runtime);
  }

  module(name: string): any {
    const root = this.context.extensionUri.fsPath;
    const filename = [path.join(root, "account-ui", name), path.join(root, name), path.resolve(root, "../../scripts", name)].find(file => fs.existsSync(file));
    if (!filename) throw new Error(`Instruction workbench module missing: ${name}`);
    return require(filename);
  }

  async liveContext(): Promise<LiveContext> {
    const value: unknown = await vscode.commands.executeCommand("azrael.workbenchContext");
    if (!record(value) || value.hostId !== "local" || !Array.isArray(value.models) || value.models.length > 10000 ||
      value.project !== null && (!record(value.project) || typeof value.project.id !== "string" || !value.project.id || value.project.id.length > 300)) throw new Error("Native project/model context is unavailable.");
    return value as LiveContext;
  }

  roleProfiles(): any {
    if (this.disposed) throw new Error("Instruction workbench is closed.");
    if (!this.roleProfileStore) {
      const { RoleProfileStore } = this.module("role-profile-store.cjs");
      this.roleProfileStore = new RoleProfileStore({ codexHome: this.runtime.codexHome, models: async () => (await this.liveContext()).models,
        materializeProfile: (capture: unknown, options: unknown) => vscode.commands.executeCommand("azrael.materializeAgentProfile", capture, options) });
    }
    return this.roleProfileStore;
  }

  private async backend(): Promise<any> {
    if (this.disposed) throw new Error("Instruction workbench is closed.");
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      const metadata = await this.library.workbenchMetadata();
      const key = JSON.stringify(metadata);
      if (!this.workbench || key !== this.configuration) {
        await this.workbench?.close();
        const { InstructionWorkbench } = this.module("instruction-workbench.cjs");
        this.workbench = new InstructionWorkbench({ root: path.join(this.runtime.codexHome, "azrael", "instruction-workbench"), installedRoot: this.runtime.codexHome,
          profileRepository: this.roleProfiles(),
          localRoots: [metadata.root], baselineRoot: metadata.baselineRoot, connections: metadata.connections,
          readProfileOptions: () => this.profileOptions(),
          readComposerResources: () => this.module("instruction-workbench-resources.cjs").readComposerResources({ codexHome: this.runtime.codexHome }),
          resolveComposerResource: (id: string) => this.module("instruction-workbench-resources.cjs").resolveComposerResource(id, { codexHome: this.runtime.codexHome }) });
        this.configuration = key;
      }
      return this.workbench;
    })();
    try { return await this.initializing; } finally { this.initializing = undefined; }
  }

  private async current(): Promise<{ workbench: any; live: LiveContext }> {
    const live = await this.liveContext(), workbench = await this.backend();
    if (live.project) {
      const projects = [...workbench.projects.filter((p: Project) => p.id !== live.project!.id), { id: live.project.id, name: live.project.name || live.project.id }];
      workbench.setProjects(projects);
    }
    return { live, workbench };
  }

  async profileOptions(): Promise<any> {
    const live = await this.liveContext();
    const metadata = await this.accountMetadata();
    const providers: any[] = metadata.providers;
    const models = live.models.filter(record).flatMap(row => {
      const model = row.model || row.id;
      if (typeof model !== "string" || !model || model.length > 1000) return [];
      const source = model.startsWith("managed/") ? model.split("/")[1] : undefined;
      const providerIds = providers.filter(p => source ? p.modelProvider === "azrael-managed" && p.account?.providerId === source : p.modelProvider === (row.modelProvider || "openai")).map(p => p.id);
      const efforts = Array.isArray(row.supportedReasoningEfforts) ? row.supportedReasoningEfforts.filter((e: any) => record(e) && typeof e.reasoningEffort === "string").map((e: any) => ({ reasoningEffort: e.reasoningEffort, description: typeof e.description === "string" ? e.description : "" })) : [];
      return [{ id: model, model, displayName: row.displayName || model, providerIds, supportedReasoningEfforts: efforts, defaultReasoningEffort: row.defaultReasoningEffort || null }];
    });
    return { providers, models, cached: false };
  }

  private accountMetadata(): Promise<any> {
    return this.module("instruction-workbench-options.cjs").readProfileOptions({ codexHome: this.runtime.codexHome, env: this.runtime.env, metadataOnly: true, parseProviderSnapshot });
  }

  async capture(input: unknown): Promise<any> {
    // Internal command callers resolve thread.projectId through native thread/read.
    // The webview adapter never forwards its own project field into this boundary.
    if (!record(input) || input.hostId !== "local" || input.project !== null && (!record(input.project) || typeof input.project.id !== "string" || !input.project.id || input.project.id.length > 300)) throw new Error("Invalid native profile capture context.");
    const workbench = await this.backend();
    const requestedId = input.project?.id ?? null;
    if (requestedId) workbench.setProjects([...workbench.projects.filter((p: Project) => p.id !== requestedId), { id: requestedId, name: input.project.name || requestedId }]);
    const captured = await workbench.action("captureRequest", { projectId: requestedId });
    const account = captured.profile?.providerAccount;
    if (account) {
      let allowed = false;
      try {
        const options = await this.accountMetadata();
        const selected = options.providers.some((p: any) => p.selected === true && p.account?.providerId === account.providerId && p.account?.accountId === account.accountId);
        allowed = selected && !!this.selectedAccount && await this.selectedAccount(account);
      } catch { /* Account scope must be verified before profile admission. */ }
      if (!allowed) throw new Error("The profile's selected account is unavailable. Select that account or edit the profile before sending the request.");
    }
    return captured;
  }

  async request(input: unknown): Promise<unknown> {
    if (!record(input) || input.type !== "azraelWorkbenchRequest" || typeof input.id !== "string" || input.id.length > 128 || typeof input.path !== "string" || input.path.length > 8192) throw new Error("Invalid workbench request.");
    const url = new URL(input.path, "https://azrael.invalid");
    if (url.origin !== "https://azrael.invalid" || !input.path.startsWith("/api/")) throw new Error("Invalid workbench route.");
    if (url.pathname === "/api/role-profiles") {
      const live = await this.liveContext(), store = this.roleProfiles();
      if (input.body === undefined) return { ...await store.snapshot(), models: live.models };
      if (!record(input.body) || !record(input.body.payload) || !["saveProfile", "deleteProfile", "saveTeamPreset", "deleteTeamPreset", "saveDirect", "saveTeamProfile"].includes(input.body.action)) throw new Error("Unsupported role-profile action.");
      return { ...await store.action(input.body.action, input.body.payload), models: live.models };
    }
    const { live, workbench } = await this.current();
    const projectId = live.project?.id ?? null;
    if (url.pathname === "/api/state") return workbench.snapshot(projectId);
    if (url.pathname === "/api/package") return workbench.detail(url.searchParams.get("key"));
    if (url.pathname === "/api/profile-options") return this.profileOptions();
    if (url.pathname === "/api/resources") return workbench.composerResources();
    if (url.pathname === "/api/request") return this.capture({ project: live.project, hostId: "local" });
    if (url.pathname !== "/api/action" || !record(input.body) || !record(input.body.payload)) throw new Error("Unsupported workbench request.");
    const { action, payload } = input.body;
    if (action === "legacyLibrary") { await vscode.commands.executeCommand("azrael.instructionsLegacy"); return {}; }
    if (action === "captureRequest") return this.capture({ project: live.project, hostId: "local" });
    if (!actions.has(action)) throw new Error("Unsupported workbench action.");
    if ((Object.prototype.hasOwnProperty.call(payload, "projectId") || ["createProfile", "saveProfile", "duplicateProfile", "deleteProfile", "equip", "unequip"].includes(action)) && (payload.projectId ?? null) !== projectId) throw new Error("Native project changed. Reload the profile before saving.");
    return workbench.action(action, { ...payload, projectId });
  }

  dispose(): void { this.disposed = true; void this.workbench?.close(); }
}

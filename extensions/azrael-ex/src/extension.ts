import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { AccountService } from "./accountService";
import { AccountView } from "./accountView";
import { UsageView } from "./usageView";
import { DevinUsageService } from "./devinUsage";
import { openAzraelSidebar, pickAzraelSetting } from "./nativeAzrael";
import { parseAccountResponse } from "./protocol";
import { UsageRefreshCoordinator, validateUsageForWorkspace } from "./usageRefresh";
import { RootResumeView } from "./rootResumeView";
import { ProviderAccountService } from "./providerAccountService";
import { fetchSharedPlaybook, syncSharedEnvironment } from "./sharedEnvironment";
import { buildHostRuntime } from "./hostRuntime";
import { AppServerTransport } from "./appServerTransport";
import { ChatSession } from "./chatSession";
import { ChatView } from "./chatView";

let service: AccountService | undefined;

let fallbackWindowSessionId: string | undefined;
export async function activate(context: vscode.ExtensionContext, runtime?: HostRuntime): Promise<void> {
  const standalone = runtime === undefined;
  const register = (command: string, action: () => unknown) => context.subscriptions.push(vscode.commands.registerCommand(command, action));
  register("azrael.openCodex", () => guarded(() => standalone ? vscode.commands.executeCommand("azrael.openSidebar") : openAzraelSidebar(vscode)));
  register("azrael.openCodexSettings", () => guarded(() => pickAzraelSetting(vscode)));

  if (!runtime && context.extensionPath) {
    try { runtime = buildHostRuntime(context.extensionPath); }
    catch (error) { registerUnavailable(register, message(error)); return; }
  }

  if (vscode.env.remoteName || context.extensionUri.scheme !== "file" || !isHostRuntime(runtime)) {
    registerUnavailable(register, "The integrated azrael account UI requires its local host runtime.");
    return;
  }

  const { bridge: bridgeExecutable, socket, codexHome, engine, engineVersion, env: runtimeEnv } = runtime;
  if (!path.isAbsolute(bridgeExecutable) || !fs.existsSync(bridgeExecutable) || !path.isAbsolute(socket) || !path.isAbsolute(codexHome) || !path.isAbsolute(engine)) {
    registerUnavailable(register, "The azrael host runtime must provide absolute bridge, engine, socket, and CODEX_HOME paths.");
    return;
  }

  if (!runtimeEnv.AZRAEL_EX_ACCOUNT_STATE_FILE || !runtimeEnv.AZRAEL_EX_ACCOUNT_DEFAULT_FILE) {
    const storage = context.storageUri ?? context.globalStorageUri;
    if (storage?.scheme === "file" && path.isAbsolute(storage.fsPath)) {
      const sessionId = vscode.env.sessionId || (fallbackWindowSessionId ??= randomUUID());
      const windowId = createHash("sha256").update(sessionId).digest("hex");
      runtimeEnv.AZRAEL_EX_ACCOUNT_STATE_FILE = context.storageUri
        ? path.join(storage.fsPath, "window", windowId, "azrael-account-state.json")
        : path.join(storage.fsPath, "empty-window", windowId, "azrael-account-state.json");
      runtimeEnv.AZRAEL_EX_ACCOUNT_DEFAULT_FILE = context.storageUri
        ? path.join(storage.fsPath, "default", "azrael-account-state.json")
        : path.join(storage.fsPath, "empty-window-default", "azrael-account-state.json");
    }
  }

  if (standalone) {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
    const chat = new ChatView(new ChatSession(new AppServerTransport({
      executable: engine, cwd, env: runtimeEnv,
      clientInfo: { name: "azrael-vscode", version: "0.4.0", title: "Azrael VS Code" },
    }), cwd));
    context.subscriptions.push(chat, vscode.window.registerWebviewViewProvider("azrael.chat", chat));
    register("azrael.openSidebar", () => vscode.commands.executeCommand("workbench.view.extension.azraelViewContainer"));
    chat.start();
  }

  const sharedEnvLog = vscode.window.createOutputChannel("Azrael shared environment", { log: true });
  context.subscriptions.push(sharedEnvLog);
  const sharedEnvRuntime = { engine, codexHome };
  register("azrael.syncSharedEnvironment", () => guarded(() => syncSharedEnvironment(context, sharedEnvRuntime, sharedEnvLog)));
  register("azrael.fetchSharedPlaybook", () => guarded(() => fetchSharedPlaybook(context, sharedEnvRuntime, sharedEnvLog)));

  service = new AccountService({ executable: bridgeExecutable, socket, codexHome, expectedServerVersion: engineVersion, env: { ...runtimeEnv, AZRAEL_EX_MANAGEMENT_SOCKET: socket, CODEX_HOME: codexHome } });
  const usage = new UsageRefreshCoordinator(async (profileId, workspaceAccountId, includeDetails) => {
    const response = parseAccountResponse(await service!.call({ action: "usage", profileId, includeDetails }));
    if (response.usageProfileId !== profileId || !response.usage) throw new Error("Usage response did not match the requested profile.");
    const profile = service!.state?.profiles.find((candidate) => candidate.id === profileId);
    if (!profile) throw new Error("Usage response referenced an unknown profile.");
    if (profile.workspaceAccountId !== workspaceAccountId) throw new Error("Usage profile identity changed during refresh.");
    validateUsageForWorkspace(response.usage, workspaceAccountId);
    return response.usage;
  });
  const view = new AccountView(service);
  const providerLog = vscode.window.createOutputChannel("Azrael provider accounts", { log: true });
  context.subscriptions.push(providerLog);
  const providerAccounts = new ProviderAccountService(codexHome, runtimeEnv, {
    openUrl: async url => vscode.env.openExternal(vscode.Uri.parse(url)),
    prompt: async (prompt, password) => vscode.window.showInputBox({ prompt, password, ignoreFocusOut: true }),
    log: event => providerLog.info(JSON.stringify(event)),
  });
  const usageView = new UsageView(service, usage, new DevinUsageService(runtimeEnv.AZRAEL_EX_DEVIN_EXECUTABLE, codexHome), providerAccounts, view);
  const rootResumeView = new RootResumeView(service);
  view.initialize();
  context.subscriptions.push(view, usageView, rootResumeView, { dispose: () => service?.dispose() });
  register("azrael.usage", () => usageView.show());
  register("azrael.devinAccount", () => usageView.show());
  register("azrael.rootResume", () => rootResumeView.show());
  register("azrael.manageAccounts", () => usageView.show());
  register("azrael.accountQuickPick", () => guarded(() => view.quickPick()));
  register("azrael.refreshAccounts", () => guarded(() => view.refreshAll()));
  void service.connect().catch((error) => vscode.window.showErrorMessage(`azrael account management disabled: ${message(error)}`));
}

export function deactivate(): void { service?.dispose(); service = undefined; }

async function guarded(action: () => unknown): Promise<void> {
  try { await action(); } catch (error) { void vscode.window.showErrorMessage(message(error)); }
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export interface HostRuntime {
  bridge: string;
  engine: string;
  socket: string;
  codexHome: string;
  engineVersion: string;
  env: NodeJS.ProcessEnv;
}

function isHostRuntime(value: unknown): value is HostRuntime {
  if (!value || typeof value !== "object") return false;
  const runtime = value as Partial<HostRuntime>;
  return typeof runtime.bridge === "string" && typeof runtime.socket === "string" &&
    typeof runtime.engineVersion === "string" && runtime.engineVersion.length > 0 &&
    typeof runtime.engine === "string" && typeof runtime.codexHome === "string" && !!runtime.env && typeof runtime.env === "object";
}

function registerUnavailable(register: (command: string, action: () => unknown) => void, reason: string): void {
  for (const command of ["azrael.manageAccounts", "azrael.usage", "azrael.devinAccount", "azrael.rootResume", "azrael.accountQuickPick", "azrael.refreshAccounts", "azrael.syncSharedEnvironment", "azrael.fetchSharedPlaybook"]) {
    register(command, () => vscode.window.showErrorMessage(reason));
  }
}

import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { InstructionWorkbenchService } from "./instructionWorkbenchService";

type Mount = { clientId: string; locale: "ko" | "en"; disposal?: vscode.Disposable };
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);

/** The renderer is shared with the standalone workbench; only transport differs. */
export class InstructionWorkbenchView implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private disposed = false;
  private contextRevision = 0;
  private readonly contextChanges: vscode.Disposable;
  private readonly mounts = new Map<vscode.Webview, Mount>();
  constructor(private readonly service: InstructionWorkbenchService) {
    // The native project owner invokes this internal command after selection.
    // Always resolve host context again rather than trusting command arguments.
    this.contextChanges = vscode.commands.registerCommand("azrael.workbenchContextChanged", () => this.contextChanged());
  }

  private async contextChanged(): Promise<void> {
    if (this.disposed || !this.panel && !this.mounts.size) return;
    const revision = ++this.contextRevision;
    const live = await this.service.liveContext();
    if (this.disposed || revision !== this.contextRevision) return;
    const message = { type: "azraelWorkbenchContextChanged", projectId: live.project?.id ?? "" };
    for (const [target, mount] of this.mounts) await target.postMessage({ type: "azrael-workbench-state", clientId: mount.clientId, message });
    if (this.panel) await this.panel.webview.postMessage(message);
  }

  async show(): Promise<void> {
    if (this.disposed) return;
    if (!this.panel) {
      const panel = vscode.window.createWebviewPanel("azrael.workbench", "Agent 프로필", vscode.ViewColumn.Active, { enableScripts: true });
      this.panel = panel;
      panel.onDidDispose(() => { this.remove(panel.webview); if (this.panel === panel) this.panel = undefined; });
      panel.webview.onDidReceiveMessage(async message => {
        if (!record(message) || message.type !== "azraelWorkbenchRequest") return;
        await this.respond(panel.webview, undefined, message);
      });
      const live = await this.service.liveContext();
      const nonce = randomBytes(18).toString("hex");
      panel.webview.html = this.service.module("instruction-workbench-view.cjs").renderWorkbenchPage({ native: true, projectId: live.project?.id ?? null, cspSource: panel.webview.cspSource, nonce, locale: vscode.env.language });
    }
    this.panel.reveal();
  }

  async handleEmbedded(webview: vscode.Webview, request: unknown, panel?: vscode.WebviewPanel): Promise<void> {
    if (this.disposed || !record(request) || request.type !== "azrael-workbench" || typeof request.clientId !== "string" || !request.clientId || request.clientId.length > 128 || typeof request.requestId !== "string" || request.requestId.length > 128) return;
    if (request.action === "unmount") { if (this.mounts.get(webview)?.clientId === request.clientId) this.remove(webview); return; }
    if (request.action === "mount") {
      this.remove(webview);
      const mount: Mount = { clientId: request.clientId, locale: /^ko(?:[-_]|$)/i.test(String(request.locale || vscode.env.language)) ? "ko" : "en" };
      this.mounts.set(webview, mount);
      mount.disposal = panel?.onDidDispose(() => { if (this.mounts.get(webview) === mount) this.remove(webview); });
      try {
        const live = await this.service.liveContext();
        const html = this.service.module("instruction-workbench-view.cjs").renderWorkbenchPage({ native: true, projectId: live.project?.id ?? null, locale: mount.locale });
        if (this.mounts.get(webview) === mount) await webview.postMessage({ type: "azrael-workbench-state", clientId: mount.clientId, requestId: request.requestId, html, projectId: live.project?.id ?? null, locale: mount.locale });
      } catch (error) {
        if (this.mounts.get(webview) === mount) await webview.postMessage({ type: "azrael-workbench-state", clientId: mount.clientId, requestId: request.requestId, error: error instanceof Error ? error.message : "Workbench unavailable." });
      }
      return;
    }
    const mount = this.mounts.get(webview);
    if (!mount || mount.clientId !== request.clientId || request.action !== "request") return;
    await this.respond(webview, mount, request.message);
  }

  private async respond(webview: vscode.Webview, mount: Mount | undefined, input: unknown): Promise<void> {
    if (!record(input) || input.type !== "azraelWorkbenchRequest" || typeof input.id !== "string" || !input.id || input.id.length > 128) return;
    let response: any;
    try { response = { type: "azraelWorkbenchResponse", id: input.id, ok: true, value: await this.service.request(input) }; }
    catch (error) { response = { type: "azraelWorkbenchResponse", id: input.id, ok: false, error: error instanceof Error ? error.message : "Workbench request failed." }; }
    if (this.disposed || mount && this.mounts.get(webview) !== mount) return;
    await webview.postMessage(mount ? { type: "azrael-workbench-state", clientId: mount.clientId, message: response } : response);
    if (response.ok && record(input.body) && input.path === "/api/action") {
      const changed = { type: "azraelWorkbenchChanged" };
      for (const [target, current] of this.mounts) await target.postMessage({ type: "azrael-workbench-state", clientId: current.clientId, message: changed });
      if (this.panel) await this.panel.webview.postMessage(changed);
    }
  }

  private remove(webview: vscode.Webview): void { this.mounts.get(webview)?.disposal?.dispose(); this.mounts.delete(webview); }
  dispose(): void { this.disposed = true; this.contextChanges.dispose(); this.panel?.dispose(); for (const webview of this.mounts.keys()) this.remove(webview); }
}

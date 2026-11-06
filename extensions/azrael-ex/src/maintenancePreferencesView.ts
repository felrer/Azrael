import type * as vscode from "vscode";

interface PreferencesHost { request(action: string, payload?: unknown): Promise<unknown> }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(value);

/** The native maintenance owner is the only preference and drain-state authority. */
export class MaintenancePreferencesView {
  private readonly host: PreferencesHost;
  constructor(runtime: {codexHome: string; env: NodeJS.ProcessEnv}) {
    this.host = require("../maintenance-preferences-host.cjs").createMaintenancePreferencesHost(runtime);
  }
  async handleEmbedded(webview: vscode.Webview, request: unknown): Promise<void> {
    if (!record(request) || request.type !== "azrael-maintenance-preferences" || !identifier(request.clientId) || !identifier(request.requestId)) return;
    if (request.action !== "read" && request.action !== "write") return;
    try {
      const snapshot = await this.host.request(request.action,request.payload);
      await webview.postMessage({type:"azrael-maintenance-preferences-state",clientId:request.clientId,requestId:request.requestId,snapshot});
    } catch (error) {
      await webview.postMessage({type:"azrael-maintenance-preferences-state",clientId:request.clientId,requestId:request.requestId,error:error instanceof Error ? error.message : "Maintenance preferences unavailable"});
    }
  }
}

import type * as vscode from "vscode";

export const AZRAEL_HOST_EXTENSION_ID = "azrael-ex-local.azrael";
export const AZRAEL_OPEN_SIDEBAR_COMMAND = "azrael.openSidebar";
export const AZRAEL_SETTING_PREFIX = "azrael.";

interface ManifestCommand { command?: unknown; title?: unknown }

export type NativeAzraelApi = Pick<typeof vscode, "extensions" | "commands" | "window">;

export function azraelHostExtension(api: NativeAzraelApi): vscode.Extension<unknown> | undefined {
  return api.extensions.getExtension(AZRAEL_HOST_EXTENSION_ID);
}

export function azraelCommands(api: NativeAzraelApi): Array<{ command: string; title: string }> {
  const commands = azraelHostExtension(api)?.packageJSON?.contributes?.commands;
  if (!Array.isArray(commands)) return [];
  return commands.flatMap((item: ManifestCommand) =>
    typeof item.command === "string" && typeof item.title === "string" ? [{ command: item.command, title: item.title }] : []);
}

export function azraelSettingKeys(api: NativeAzraelApi): string[] {
  const configuration = azraelHostExtension(api)?.packageJSON?.contributes?.configuration;
  const blocks = Array.isArray(configuration) ? configuration : [configuration];
  return blocks.flatMap((block: unknown) => {
    if (!block || typeof block !== "object") return [];
    const properties = (block as { properties?: unknown }).properties;
    return properties && typeof properties === "object" ? Object.keys(properties) : [];
  }).filter((key) => key.startsWith(AZRAEL_SETTING_PREFIX));
}

export async function openAzraelSidebar(api: NativeAzraelApi): Promise<void> {
  if (!azraelCommands(api).some((item) => item.command === AZRAEL_OPEN_SIDEBAR_COMMAND)) {
    throw new Error("The installed azrael host does not expose its sidebar command.");
  }
  await api.commands.executeCommand(AZRAEL_OPEN_SIDEBAR_COMMAND);
}

export async function pickAzraelSetting(api: NativeAzraelApi): Promise<void> {
  const keys = azraelSettingKeys(api);
  if (keys.length === 0) throw new Error("No azrael settings were found in the installed host.");
  const selected = await api.window.showQuickPick(keys.map((key) => ({ label: key, key })), { placeHolder: "Open an azrael host setting" });
  if (selected) await api.commands.executeCommand("workbench.action.openSettings", selected.key);
}

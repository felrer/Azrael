import * as vscode from "vscode";
import { AccountService } from "./accountService";

export async function manageDevin(service: AccountService): Promise<void> {
  const state = await service.devin("status");
  if (!state.enabled) throw new Error("Devin is not enabled. Start azrael-ex with -DevinExecutable set to your Devin CLI path.");
  const action = await vscode.window.showQuickPick([
    { label: state.loggedIn ? "Sign in again" : "Sign in to Devin", action: "login" as const },
    { label: "Refresh Devin models", action: "refresh" as const },
    { label: "Cancel pending Devin login", action: "loginCancel" as const },
    ...(state.loggedIn ? [{ label: "Sign out of Devin", action: "logout" as const }] : [])
  ], { title: "Devin account", placeHolder: state.loggedIn ? `${state.email ?? "Signed in"} · ${state.plan ?? "Devin"}` : "Not signed in" });
  if (!action) return;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Devin: ${action.label}`, cancellable: action.action === "login" }, async (_, token) => {
    const subscription = token.onCancellationRequested(() => { void service.devin("loginCancel").catch(() => undefined); });
    try {
      const updated = await service.devin(action.action);
      void vscode.window.showInformationMessage(updated.loggedIn
        ? `Devin connected: ${updated.email ?? "account"}. Models are available in the Azrael dropdown. Reload the window to refresh its cached list immediately.`
        : "Devin is signed out. Reload the window to refresh the cached model list.", "Reload Window").then(choice => {
          if (choice === "Reload Window") void vscode.commands.executeCommand("workbench.action.reloadWindow");
        });
    } finally { subscription.dispose(); }
  });
}

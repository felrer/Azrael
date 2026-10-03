import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import * as vscode from "vscode";

export interface SharedEnvironmentRuntime {
  engine: string;
  codexHome: string;
}

const SCRIPT = path.join("account-ui", "sync-shared-environment.cjs");

function sharedConfig() {
  const config = vscode.workspace.getConfiguration("azrael");
  const repository = config.get<string>("sharedEnvironment.repository", "").trim();
  const ref = config.get<string>("sharedEnvironment.ref", "main").trim() || "main";
  return { repository, ref };
}

function checkoutDirectory(codexHome: string): string {
  return path.join(path.dirname(codexHome), ".azrael-shared-environment", path.basename(codexHome));
}

function scriptPath(context: vscode.ExtensionContext): string {
  const target = path.join(context.extensionUri.fsPath, SCRIPT);
  if (!fs.existsSync(target)) throw new Error("The installed azrael host does not include the shared environment sync tool. Reinstall a current host package.");
  return target;
}

function runSync(context: vscode.ExtensionContext, runtime: SharedEnvironmentRuntime, mode: "apply" | "validate", log: vscode.LogOutputChannel): Promise<string> {
  const { repository, ref } = sharedConfig();
  if (!repository) throw new Error("Set azrael.sharedEnvironment.repository first.");
  if (!path.isAbsolute(runtime.engine) || !fs.existsSync(runtime.engine)) throw new Error("The azrael engine path is unavailable; reinstall the host release.");
  const args = [
    scriptPath(context),
    "--repo", repository,
    "--ref", ref,
    "--checkout", checkoutDirectory(runtime.codexHome),
    "--state-root", runtime.codexHome,
    "--engine", runtime.engine,
    "--mode", mode,
  ];
  log.info(`shared environment sync: ${mode} from ${repository}#${ref}`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { const text = String(chunk); stdout += text; log.info(text.trimEnd()); });
    child.stderr.on("data", (chunk) => { const text = String(chunk); stderr += text; log.error(text.trimEnd()); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        const detail = stderr.trim().split("\n").pop() || `exit ${code}`;
        reject(new Error(`Shared environment sync failed: ${detail}`));
        return;
      }
      const line = stdout.trim().split("\n").pop() ?? "";
      resolve(line);
    });
  });
}

export async function syncSharedEnvironment(context: vscode.ExtensionContext, runtime: SharedEnvironmentRuntime, log: vscode.LogOutputChannel): Promise<void> {
  const line = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Syncing azrael shared environment", cancellable: false },
    () => runSync(context, runtime, "apply", log),
  );
  const result = JSON.parse(line) as { status?: string; warnings?: string[] };
  for (const warning of result.warnings ?? []) void vscode.window.showWarningMessage(`azrael shared environment: ${warning}`);
  if (result.status === "unchanged") void vscode.window.showInformationMessage("azrael shared environment is already up to date.");
  else void vscode.window.showInformationMessage("azrael shared environment applied. New threads use the updated instructions, roles, and skills.");
}

export async function fetchSharedPlaybook(context: vscode.ExtensionContext, runtime: SharedEnvironmentRuntime, log: vscode.LogOutputChannel): Promise<void> {
  const checkout = checkoutDirectory(runtime.codexHome);
  let playbooksDir = path.join(checkout, "playbooks");
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(checkout, "azrael-environment.json"), "utf8"));
    if (typeof manifest.playbooksDir === "string" && /^[A-Za-z0-9_-]+$/.test(manifest.playbooksDir)) {
      playbooksDir = path.join(checkout, manifest.playbooksDir);
    }
  } catch { /* fall back to the default directory name */ }
  if (!fs.existsSync(playbooksDir) || !fs.statSync(playbooksDir).isDirectory()) {
    const sync = "Sync now";
    const choice = await vscode.window.showInformationMessage("The shared environment checkout is missing. Sync it first?", sync);
    if (choice !== sync) return;
    await syncSharedEnvironment(context, runtime, log);
    if (!fs.existsSync(playbooksDir)) throw new Error("The shared environment repository has no playbooks directory.");
  }
  const entries = fs.readdirSync(playbooksDir).filter((name) => name.toLowerCase().endsWith(".md")).sort();
  if (entries.length === 0) throw new Error("The shared environment repository has no playbooks.");
  const selected = await vscode.window.showQuickPick(
    entries.map((name) => ({ label: name })),
    { canPickMany: true, placeHolder: "Select playbooks to copy into this workspace" },
  );
  if (!selected?.length) return;
  const folder = vscode.workspace.workspaceFolders?.find((candidate) => candidate.uri.scheme === "file");
  if (!folder) throw new Error("Open a file-system workspace before fetching playbooks.");
  const targetDir = path.join(folder.uri.fsPath, "docs", "playbooks");
  const chosen = selected.map((item) => item.label);
  const existing = chosen.filter((name) => fs.existsSync(path.join(targetDir, name)));
  if (existing.length > 0) {
    const overwrite = await vscode.window.showWarningMessage(
      `Overwrite existing playbook(s): ${existing.join(", ")}?`, { modal: true }, "Overwrite",
    );
    if (overwrite !== "Overwrite") return;
  }
  fs.mkdirSync(targetDir, { recursive: true });
  for (const name of chosen) {
    fs.copyFileSync(path.join(playbooksDir, name), path.join(targetDir, name));
  }
  log.info(`shared environment playbooks copied to ${targetDir}: ${chosen.join(", ")}`);
  void vscode.window.showInformationMessage(`Copied ${chosen.length} playbook(s) to docs/playbooks. Register them in docs/playbooks/README.md.`);
}

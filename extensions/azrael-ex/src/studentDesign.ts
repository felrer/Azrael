import * as fs from "node:fs";
import { randomInt } from "node:crypto";
import * as vscode from "vscode";

const key = "azrael.studentDesign.v1";
interface Student { id: number; nameKo: string; nameEn: string; school: string; asset: string }
interface State { enabled: boolean; decisions: Record<string, number | null> }
interface Mount { clientId: string; disposal?: vscode.Disposable }
interface Options { manifest?: unknown; randomInt?: (max: number) => number }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const validId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 512;

/** Only authoritative creation events may allocate a student; subscribing never does. */
export class StudentDesignService implements vscode.Disposable {
  private state: State = { enabled: false, decisions: {} };
  private readonly students: Student[] = [];
  private readonly assetRoot: vscode.Uri;
  private readonly mounts = new Map<vscode.Webview, Mount>();
  private readonly pick: (max: number) => number;
  private queue: Promise<void> = Promise.resolve();
  private error?: string;
  private disposed = false;

  constructor(private readonly context: vscode.ExtensionContext, options: Options = {}) {
    this.pick = options.randomInt ?? randomInt;
    const integrated = vscode.Uri.joinPath(context.extensionUri, "webview", "assets", "azrael-students");
    this.assetRoot = fs.existsSync(vscode.Uri.joinPath(integrated, "manifest.json").fsPath)
      ? integrated : vscode.Uri.joinPath(context.extensionUri, "media", "student-avatars");
    try {
      const manifest: unknown = options.manifest ?? JSON.parse(fs.readFileSync(vscode.Uri.joinPath(this.assetRoot, "manifest.json").fsPath, "utf8"));
      if (!record(manifest) || manifest.schemaVersion !== 1 || !Array.isArray(manifest.students) || manifest.students.length !== 100) throw new Error("Invalid student roster.");
      const ids = new Set<number>();
      for (const student of manifest.students) {
        if (!record(student) || !Number.isSafeInteger(student.id) || (student.id as number) <= 0 || ids.has(student.id as number)
          || ![student.nameKo, student.nameEn, student.school].every(v => typeof v === "string" && v.length > 0)
          || student.asset !== `${student.id}.png`) throw new Error("Invalid student roster.");
        ids.add(student.id as number);
      }
      this.students = manifest.students as Student[];
      const stored: unknown = context.globalState.get(key);
      if (stored !== undefined) {
        if (!record(stored) || typeof stored.enabled !== "boolean" || !record(stored.decisions)
          || !Object.entries(stored.decisions).every(([id, student]) => validId(id) && (student === null || typeof student === "number" && ids.has(student)))) throw new Error("Invalid saved student design settings.");
        this.state = { enabled: stored.enabled, decisions: { ...stored.decisions } as State["decisions"] };
      }
    } catch (error) { this.error = error instanceof Error ? error.message : "Student design is unavailable."; }
  }

  async handleEmbedded(webview: vscode.Webview, request: unknown, panel?: vscode.WebviewPanel): Promise<void> {
    if (this.disposed || !record(request) || request.type !== "azrael-design" || !validId(request.clientId)) return;
    const clientId = request.clientId;
    if (request.action === "subscribe") {
      this.remove(webview);
      const roots = webview.options.localResourceRoots ?? [this.context.extensionUri];
      // Parent roots already authorize their descendants. Updating options unnecessarily
      // reloads the settings webview and resets its active route.
      if (!roots.some(uri => uri.scheme === this.assetRoot.scheme && uri.authority === this.assetRoot.authority
        && (uri.path === this.assetRoot.path || this.assetRoot.path.startsWith(uri.path.replace(/\/+$/, "") + "/")))) webview.options = { ...webview.options, localResourceRoots: [...roots, this.assetRoot] };
      const mount: Mount = { clientId };
      this.mounts.set(webview, mount);
      mount.disposal = panel?.onDidDispose(() => { if (this.mounts.get(webview) === mount) this.remove(webview); });
      await this.send(webview, mount);
      return;
    }
    if (this.mounts.get(webview)?.clientId !== clientId) return;
    if (request.action === "unsubscribe") { this.remove(webview); return; }
    if (request.action !== "setEnabled" || typeof request.enabled !== "boolean") return;
    const enabled = request.enabled;
    await this.serial(async () => {
      if (this.disposed || this.mounts.get(webview)?.clientId !== clientId) return;
      if (this.error || !this.students.length) { await this.broadcast(); return; }
      await this.save({ ...this.state, enabled });
    });
  }

  recordCreated(threadId: unknown): Promise<void> {
    if (!validId(threadId) || this.disposed) return Promise.resolve();
    return this.serial(async () => {
      if (this.disposed || this.error || !this.students.length || Object.hasOwn(this.state.decisions, threadId)) return;
      const index = this.state.enabled ? this.pick(this.students.length) : null;
      if (index !== null && (!Number.isInteger(index) || index < 0 || index >= this.students.length)) throw new Error("Invalid student selection.");
      await this.save({ enabled: this.state.enabled, decisions: { ...this.state.decisions, [threadId]: index === null ? null : this.students[index].id } });
    });
  }

  private serial(operation: () => Promise<void>): Promise<void> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async save(next: State): Promise<void> {
    try { await this.context.globalState.update(key, next); this.state = next; }
    catch (error) {
      await this.broadcast("Student design settings could not be saved.");
      throw error;
    }
    if (!this.disposed) await this.broadcast();
  }

  private async send(webview: vscode.Webview, mount: Mount, error = this.error): Promise<void> {
    if (this.disposed || this.mounts.get(webview) !== mount) return;
    const assignments = Object.fromEntries(Object.entries(this.state.decisions).filter((entry): entry is [string, number] => entry[1] !== null));
    try {
      const delivered = await webview.postMessage({ type: "azrael-design-state", clientId: mount.clientId,
        enabled: this.state.enabled, students: this.students.map(({ id, nameKo, nameEn, asset }) => ({ id, nameKo, nameEn, url: webview.asWebviewUri(vscode.Uri.joinPath(this.assetRoot, asset)).toString() })), assignments, ...(error ? { error } : {}) });
      if (!delivered && this.mounts.get(webview) === mount) this.remove(webview);
    } catch { if (this.mounts.get(webview) === mount) this.remove(webview); }
  }
  private async broadcast(error?: string): Promise<void> { await Promise.all([...this.mounts].map(([webview, mount]) => this.send(webview, mount, error))); }
  private remove(webview: vscode.Webview): void { const mount = this.mounts.get(webview); this.mounts.delete(webview); mount?.disposal?.dispose(); }
  dispose(): void { this.disposed = true; for (const webview of this.mounts.keys()) this.remove(webview); }
}

import * as fs from "node:fs";
import * as path from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import * as vscode from "vscode";

const key = "azrael.studentDesign.v1";
type PhotoId = number | string;
interface Student { id: PhotoId; nameKo: string; nameEn: string; school: string; asset: string; photoSetId: string }
interface PhotoSet { id: string; name: string; photos: Student[] }
type ChatFont = "gyeonggi-consolas" | "openai";
interface State { enabled: boolean; decisions: Record<string, PhotoId | null>; chatFont: ChatFont; selectedPhotoSetId: string; customPhotoSets: PhotoSet[] }
interface Mount { clientId: string; disposal?: vscode.Disposable }
interface Options { manifest?: unknown; randomInt?: (max: number) => number }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const validId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 512;

/** Only authoritative creation events may allocate a student; subscribing never does. */
export class StudentDesignService implements vscode.Disposable {
  private state: State = { enabled: false, decisions: {}, chatFont: "gyeonggi-consolas", selectedPhotoSetId: "blue-archive", customPhotoSets: [] };
  private readonly students: Student[] = [];
  private readonly assetRoot: vscode.Uri;
  private readonly customRoot: vscode.Uri;
  private readonly mounts = new Map<vscode.Webview, Mount>();
  private readonly pick: (max: number) => number;
  private queue: Promise<void> = Promise.resolve();
  private error?: string;
  private disposed = false;

  constructor(private readonly context: vscode.ExtensionContext, options: Options = {}) {
    this.pick = options.randomInt ?? randomInt;
    this.customRoot = vscode.Uri.joinPath(context.globalStorageUri, "subagent-photos");
    const integrated = vscode.Uri.joinPath(context.extensionUri, "webview", "assets", "azrael-students");
    this.assetRoot = fs.existsSync(vscode.Uri.joinPath(integrated, "manifest.json").fsPath)
      ? integrated : vscode.Uri.joinPath(context.extensionUri, "media", "student-avatars");
    try {
      const manifest: unknown = options.manifest ?? JSON.parse(fs.readFileSync(vscode.Uri.joinPath(this.assetRoot, "manifest.json").fsPath, "utf8"));
      if (!record(manifest) || manifest.schemaVersion !== 1 || !Array.isArray(manifest.students) || !manifest.students.length) throw new Error("Invalid student roster.");
      const ids = new Set<number>();
      for (const student of manifest.students) {
        if (!record(student) || !Number.isSafeInteger(student.id) || (student.id as number) <= 0 || ids.has(student.id as number)
          || ![student.nameKo, student.nameEn, student.school].every(v => typeof v === "string" && v.length > 0)
          || student.asset !== `${student.id}.png`) throw new Error("Invalid student roster.");
        ids.add(student.id as number);
      }
      this.students = manifest.students.map(student => ({ ...student, photoSetId: "blue-archive" })) as Student[];
      const stored: unknown = context.globalState.get(key);
      if (stored !== undefined) {
        if (!record(stored) || typeof stored.enabled !== "boolean" || !record(stored.decisions)) throw new Error("Invalid saved student design settings.");
        if (stored.chatFont !== undefined && stored.chatFont !== "gyeonggi-consolas" && stored.chatFont !== "openai") throw new Error("Invalid saved chat font.");
        const customPhotoSets = this.restoreSets(stored.customPhotoSets);
        const photoIds = new Set<PhotoId>([...ids, ...customPhotoSets.flatMap(set => set.photos.map(photo => photo.id))]);
        if (!Object.entries(stored.decisions).every(([id, photo]) => validId(id) && (photo === null || photoIds.has(photo as PhotoId)))) throw new Error("Invalid saved student design settings.");
        const selectedPhotoSetId = stored.selectedPhotoSetId ?? "blue-archive";
        if (selectedPhotoSetId !== "blue-archive" && !customPhotoSets.some(set => set.id === selectedPhotoSetId)) throw new Error("Invalid saved photo set.");
        this.state = { enabled: stored.enabled, decisions: { ...stored.decisions } as State["decisions"], chatFont: stored.chatFont === "openai" ? "openai" : "gyeonggi-consolas", selectedPhotoSetId: selectedPhotoSetId as string, customPhotoSets };
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
      const missing = [this.assetRoot, this.customRoot].filter(root => !roots.some(uri => uri.scheme === root.scheme && uri.authority === root.authority
        && (uri.path === root.path || root.path.startsWith(uri.path.replace(/\/+$/, "") + "/"))));
      if (missing.length) webview.options = { ...webview.options, localResourceRoots: [...roots, ...missing] };
      const mount: Mount = { clientId };
      this.mounts.set(webview, mount);
      mount.disposal = panel?.onDidDispose(() => { if (this.mounts.get(webview) === mount) this.remove(webview); });
      await this.send(webview, mount);
      return;
    }
    if (this.mounts.get(webview)?.clientId !== clientId) return;
    if (request.action === "unsubscribe") { this.remove(webview); return; }
    if (request.action === "importPhotoSet") {
      if (this.error) { await this.broadcast(); return; }
      // Native dialogs must not hold the mutation queue: new threads can arrive while open.
      try {
        const files = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: true,
          title: "Import subagent photos", filters: { Images: ["png", "jpg", "jpeg", "webp", "gif"] } });
        if (!files?.length) { await this.broadcast(); return; }
        const name = await vscode.window.showInputBox({ title: "Photo set name", prompt: "Name this subagent photo set", value: "My photos",
          validateInput: value => value.trim().length > 0 && value.trim().length <= 100 ? undefined : "Enter a name between 1 and 100 characters." });
        if (name === undefined) { await this.broadcast(); return; }
        await this.serial(async () => {
          if (this.disposed || this.mounts.get(webview)?.clientId !== clientId) return;
          await this.importSet(files, name);
        });
      } catch (error) { await this.broadcast(error instanceof Error ? error.message : "Photos could not be imported."); }
      return;
    }
    if (request.action === "setPhotoSet") {
      const photoSetId = request.photoSetId;
      await this.serial(async () => {
        if (this.disposed || this.mounts.get(webview)?.clientId !== clientId) return;
        if (this.error) { await this.broadcast(); return; }
        if (typeof photoSetId !== "string" || !this.photoSets().some(set => set.id === photoSetId)) { await this.broadcast("Unknown photo set."); return; }
        await this.save({ ...this.state, selectedPhotoSetId: photoSetId });
      });
      return;
    }
    if (request.action === "setChatFont") {
      if (request.chatFont !== "gyeonggi-consolas" && request.chatFont !== "openai") return;
      const chatFont = request.chatFont;
      await this.serial(async () => {
        if (this.disposed || this.mounts.get(webview)?.clientId !== clientId) return;
        if (this.error) { await this.broadcast(); return; }
        await this.save({ ...this.state, chatFont });
      });
      return;
    }
    if (request.action !== "setEnabled" || typeof request.enabled !== "boolean") return;
    const enabled = request.enabled;
    await this.serial(async () => {
      if (this.disposed || this.mounts.get(webview)?.clientId !== clientId) return;
      if (this.error || !this.activePhotos().length) { await this.broadcast(); return; }
      await this.save({ ...this.state, enabled });
    });
  }

  recordCreated(threadId: unknown): Promise<void> {
    if (!validId(threadId) || this.disposed) return Promise.resolve();
    return this.serial(async () => {
      if (this.disposed || this.error || !this.activePhotos().length || Object.hasOwn(this.state.decisions, threadId)) return;
      const photos = this.activePhotos();
      const index = this.state.enabled ? this.pick(photos.length) : null;
      if (index !== null && (!Number.isInteger(index) || index < 0 || index >= photos.length)) throw new Error("Invalid student selection.");
      await this.save({ ...this.state, decisions: { ...this.state.decisions, [threadId]: index === null ? null : photos[index].id } });
    });
  }

  private photoSets(): PhotoSet[] { return [{ id: "blue-archive", name: "Blue Archive", photos: this.students }, ...this.state.customPhotoSets]; }
  private activePhotos(): Student[] { return this.photoSets().find(set => set.id === this.state.selectedPhotoSetId)?.photos ?? []; }

  private restoreSets(value: unknown): PhotoSet[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error("Invalid saved photo sets.");
    const ids = new Set<string>();
    return value.map(set => {
      if (!record(set) || typeof set.id !== "string" || !/^custom-[0-9a-f-]{36}$/.test(set.id) || ids.has(set.id)
        || typeof set.name !== "string" || !set.name.trim() || set.name.length > 100 || !Array.isArray(set.photos) || !set.photos.length || set.photos.length > 200) throw new Error("Invalid saved photo sets.");
      ids.add(set.id);
      const photos = new Set<string>();
      for (const photo of set.photos) {
        if (!record(photo) || typeof photo.asset !== "string" || !new RegExp(`^${set.id}/[0-9]+\\.(png|jpg|webp|gif)$`).test(photo.asset)
          || photo.id !== `${set.id}:${photo.asset.split("/")[1]}` || photo.photoSetId !== set.id || photos.has(photo.id as string)
          || typeof photo.nameKo !== "string" || typeof photo.nameEn !== "string" || typeof photo.school !== "string") throw new Error("Invalid saved photo sets.");
        photos.add(photo.id as string);
      }
      return set as unknown as PhotoSet;
    });
  }

  private imageExtension(bytes: Buffer): string {
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpg";
    if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) return "gif";
    if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
    throw new Error("Choose PNG, JPEG, WebP or GIF images. SVG and other formats are not supported.");
  }

  private async importSet(files: vscode.Uri[], name: string): Promise<void> {
    if (!name.trim() || name.trim().length > 100) throw new Error("Enter a name between 1 and 100 characters.");
    if (files.length > 200) throw new Error("A photo set can contain at most 200 images.");
    let total = 0;
    const images: { bytes: Buffer; extension: string; name: string }[] = [];
    for (const file of files) {
      if (file.scheme !== "file") throw new Error("Choose local image files.");
      if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(path.extname(file.fsPath).toLowerCase())) throw new Error("Choose PNG, JPEG, WebP or GIF images.");
      const handle = await fs.promises.open(file.fsPath, "r");
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error("Each photo must be a regular file no larger than 1 MiB.");
        // Bound reads even if another process grows the file after stat.
        const bytes = Buffer.alloc(1024 * 1024 + 1);
        let length = 0;
        while (length < bytes.length) {
          const read = await handle.read(bytes, length, bytes.length - length, null);
          if (!read.bytesRead) break;
          length += read.bytesRead;
        }
        if (length > 1024 * 1024) throw new Error("Each photo must be no larger than 1 MiB.");
        total += length;
        if (total > 20 * 1024 * 1024) throw new Error("A photo set must be no larger than 20 MiB.");
        const content = bytes.subarray(0, length);
        images.push({ bytes: content, extension: this.imageExtension(content), name: path.basename(file.fsPath, path.extname(file.fsPath)) });
      } finally { await handle.close(); }
    }
    const id = `custom-${randomUUID()}`;
    const directory = vscode.Uri.joinPath(this.customRoot, id).fsPath;
    const written: string[] = [];
    let created = false;
    try {
      await fs.promises.mkdir(this.customRoot.fsPath, { recursive: true });
      await fs.promises.mkdir(directory); created = true;
      const photos: Student[] = [];
      for (const [index, image] of images.entries()) {
        const filename = `${index + 1}.${image.extension}`;
        const destination = path.join(directory, filename);
        written.push(destination);
        await fs.promises.writeFile(destination, image.bytes, { flag: "wx" });
        photos.push({ id: `${id}:${filename}`, nameKo: image.name, nameEn: image.name, school: "", asset: `${id}/${filename}`, photoSetId: id });
      }
      await this.save({ ...this.state, selectedPhotoSetId: id, customPhotoSets: [...this.state.customPhotoSets, { id, name: name.trim(), photos }] });
    } catch (error) {
      // Only remove paths generated by this import. Never follow a user-selected source.
      const failures = await Promise.allSettled(written.map(async file => {
        try { await fs.promises.unlink(file); }
        catch (failure) { if ((failure as NodeJS.ErrnoException).code !== "ENOENT") throw failure; }
      }));
      if (created) {
        try { await fs.promises.rmdir(directory); } catch { /* Report cleanup failure below. */ }
      }
      if (failures.some(result => result.status === "rejected") || (created && fs.existsSync(directory))) throw new Error("Photos could not be imported; incomplete copied assets could not be removed.");
      throw error;
    }
  }

  private serial(operation: () => Promise<void>): Promise<void> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async save(next: State): Promise<void> {
    try { await this.context.globalState.update(key, next); this.state = next; }
    catch (error) {
      await this.broadcast("Design settings could not be saved.");
      throw error;
    }
    if (!this.disposed) await this.broadcast();
  }

  private async send(webview: vscode.Webview, mount: Mount, error = this.error): Promise<void> {
    if (this.disposed || this.mounts.get(webview) !== mount) return;
    const assignments = Object.fromEntries(Object.entries(this.state.decisions).filter((entry): entry is [string, PhotoId] => entry[1] !== null));
    try {
      const delivered = await webview.postMessage({ type: "azrael-design-state", clientId: mount.clientId,
        enabled: this.state.enabled, chatFont: this.state.chatFont, selectedPhotoSetId: this.state.selectedPhotoSetId, photoSets: this.photoSets().map(({ id, name, photos }) => ({ id, name, count: photos.length })),
        students: this.photoSets().flatMap(set => set.photos.map(({ id, nameKo, nameEn, asset, photoSetId }) => ({ id, nameKo, nameEn, photoSetId,
          url: webview.asWebviewUri(vscode.Uri.joinPath(photoSetId === "blue-archive" ? this.assetRoot : this.customRoot, asset)).toString() }))), assignments, ...(error ? { error } : {}) });
      if (!delivered && this.mounts.get(webview) === mount) this.remove(webview);
    } catch { if (this.mounts.get(webview) === mount) this.remove(webview); }
  }
  private async broadcast(error?: string): Promise<void> { await Promise.all([...this.mounts].map(([webview, mount]) => this.send(webview, mount, error))); }
  private remove(webview: vscode.Webview): void { const mount = this.mounts.get(webview); this.mounts.delete(webview); mount?.disposal?.dispose(); }
  dispose(): void { this.disposed = true; for (const webview of this.mounts.keys()) this.remove(webview); }
}

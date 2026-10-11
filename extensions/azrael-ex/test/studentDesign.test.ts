import assert from "node:assert/strict";
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const api = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const original = api._load;
const dialogs = {
  showOpenDialog: async (_options: unknown): Promise<any[] | undefined> => undefined,
  showInputBox: async (_options: unknown): Promise<string | undefined> => undefined,
};
const uri = (fsPath: string) => ({ fsPath, scheme: "file", authority: "", path: fsPath.replace(/\\/g, "/"), toString: () => `file:${fsPath}` });
api._load = function (request, parent, isMain) {
  return request === "vscode" ? { window: dialogs, Uri: { joinPath: (root: { fsPath: string }, ...parts: string[]) => uri(path.join(root.fsPath, ...parts)) } } : original.call(this, request, parent, isMain);
};
const { StudentDesignService } = require("../src/studentDesign") as typeof import("../src/studentDesign");
api._load = original;
const manifest = { schemaVersion: 1, students: Array.from({ length: 200 }, (_, index) => ({ id: index + 1, nameKo: `학생 ${index + 1}`, nameEn: `Student ${index + 1}`, school: "School", asset: `${index + 1}.png` })) };

function fixture(stored?: unknown, storage = path.resolve("fixture-storage")) {
  let value = stored, calls = 0, fail = false, disposedListeners = 0;
  const writes: any[] = [], sent: any[] = [];
  const context: any = { extensionUri: uri(path.resolve("fixture-extension")), globalStorageUri: uri(storage), globalState: {
    get: () => value,
    update: async (_key: string, next: unknown) => { writes.push(next); if (fail) throw new Error("disk unavailable"); await new Promise(resolve => setImmediate(resolve)); value = next; },
  } };
  const service = new StudentDesignService(context, { manifest, randomInt: max => calls++ % max });
  let delivers = true, onDispose: (() => void) | undefined;
  const webview: any = { options: { localResourceRoots: [uri("existing-root")] }, asWebviewUri: (local: { fsPath: string }) => ({ toString: () => `local-resource:${local.fsPath}` }), postMessage: async (message: unknown) => { sent.push(message); return delivers; } };
  const panel: any = { onDidDispose: (listener: () => void) => { onDispose = listener; return { dispose: () => { disposedListeners++; } }; } };
  const send = (action: string, enabled?: unknown, clientId = "one") => service.handleEmbedded(webview, { type: "azrael-design", clientId, action, enabled }, panel);
  return { service, context, webview, sent, writes, send, panel, get value() { return value; }, get calls() { return calls; }, get disposedListeners() { return disposedListeners; }, set fail(v: boolean) { fail = v; }, set delivers(v: boolean) { delivers = v; }, close: () => onDispose?.() };
}

test("disabled default, future creation, durable off decisions, duplicates and stable reload", async () => {
  const f = fixture();
  await f.send("subscribe");
  assert.equal(f.sent.at(-1).enabled, false);
  assert.deepEqual(f.sent.at(-1).assignments, {});
  assert.equal(f.writes.length, 0, "subscription must not assign");
  await f.service.recordCreated("old");
  assert.equal(f.calls, 0);
  await f.send("setEnabled", true);
  await f.service.recordCreated("old");
  await f.service.recordCreated("new");
  await f.service.recordCreated("new");
  assert.equal(f.calls, 1);
  assert.deepEqual(f.sent.at(-1).assignments, { new: 1 });
  await f.send("setEnabled", false);
  await f.service.recordCreated("off");
  await f.send("setEnabled", true);
  await f.service.recordCreated("off");
  assert.equal(f.calls, 1);
  assert.deepEqual(f.sent.at(-1).assignments, { new: 1 });
  const reload = fixture(f.value);
  await reload.send("subscribe");
  assert.equal(reload.sent.at(-1).enabled, true);
  assert.deepEqual(reload.sent.at(-1).assignments, { new: 1 });
  await reload.service.recordCreated("old"); await reload.service.recordCreated("new"); await reload.service.recordCreated("off");
  assert.equal(reload.calls, 0);
  f.service.dispose(); reload.service.dispose();
});

test("nonempty bundled rosters retain costume labels and stable saved IDs", async () => {
  for (const count of [1, 99, 200]) {
    const f = fixture({ enabled: true, decisions: { existing: 1 } });
    const roster = { ...manifest, students: manifest.students.slice(0, count).map((student, index) => index === count - 1
      ? { ...student, nameEn: "Student (Swimsuit)", nameKo: "학생 (수영복)", variant: "Swimsuit", baseName: "Student" } : student) };
    const service = new StudentDesignService(f.context, { manifest: roster, randomInt: max => max - 1 });
    await service.handleEmbedded(f.webview, { type: "azrael-design", clientId: "one", action: "subscribe" });
    assert.equal(f.sent.at(-1).students.length, count);
    assert.equal(f.sent.at(-1).students.at(-1).nameEn, "Student (Swimsuit)");
    assert.equal(f.sent.at(-1).students.at(-1).nameKo, "학생 (수영복)");
    assert.deepEqual(f.sent.at(-1).assignments, { existing: 1 });
    await service.recordCreated("new");
    assert.deepEqual(f.sent.at(-1).assignments, { existing: 1, new: count });
    service.dispose(); f.service.dispose();
  }
});

test("serialized settings and concurrent creation preserve every decision", async () => {
  const f = fixture(); await f.send("subscribe");
  await Promise.all([f.send("setEnabled", true), f.service.recordCreated("a"), f.service.recordCreated("b"), f.service.recordCreated("a"), f.send("setEnabled", false), f.service.recordCreated("c")]);
  assert.deepEqual((f.value as any).decisions, { a: 1, b: 2, c: null });
  assert.equal(f.calls, 2); assert.equal(f.sent.at(-1).enabled, false);
  f.service.dispose();
});

test("chat font defaults, persists, broadcasts and survives student mutations and reload", async () => {
  const f = fixture({ enabled: false, decisions: { old: null } });
  await f.send("subscribe");
  assert.equal(f.sent.at(-1).chatFont, "gyeonggi-consolas");
  const secondMessages: any[] = [];
  const second = { ...f.webview, postMessage: async (m: unknown) => { secondMessages.push(m); return true; } };
  await f.service.handleEmbedded(second, { type: "azrael-design", clientId: "two", action: "subscribe" });
  const setFont = (chatFont: unknown, clientId = "one") => f.service.handleEmbedded(f.webview, { type: "azrael-design", clientId, action: "setChatFont", chatFont });
  await setFont("unknown"); await setFont("openai", "stale");
  assert.equal(f.writes.length, 0);
  await Promise.all([setFont("openai"), f.send("setEnabled", true), f.service.recordCreated("new")]);
  assert.equal(f.sent.at(-1).chatFont, "openai");
  assert.equal(secondMessages.at(-1).chatFont, "openai");
  assert.deepEqual((f.value as any).decisions, { old: null, new: 1 });
  const reload = fixture(f.value); await reload.send("subscribe");
  assert.equal(reload.sent.at(-1).chatFont, "openai");
  f.fail = true; await assert.rejects(setFont("gyeonggi-consolas"), /disk unavailable/);
  assert.equal(f.sent.at(-1).chatFont, "openai");
  assert.match(f.sent.at(-1).error, /could not be saved/);
  f.fail = false; await setFont("gyeonggi-consolas");
  assert.equal(f.sent.at(-1).chatFont, "gyeonggi-consolas");
  f.service.dispose(); reload.service.dispose();
});

test("persistence failures report unsaved state and do not poison the mutation queue", async () => {
  const f = fixture(); await f.send("subscribe"); f.fail = true;
  await assert.rejects(f.send("setEnabled", true), /disk unavailable/);
  assert.equal(f.sent.at(-1).enabled, false); assert.match(f.sent.at(-1).error, /could not be saved/);
  f.fail = false; await f.send("setEnabled", true); f.fail = true;
  await assert.rejects(f.service.recordCreated("a"), /disk unavailable/);
  assert.deepEqual(f.sent.at(-1).assignments, {});
  f.fail = false; await Promise.all([f.service.recordCreated("b"), f.service.recordCreated("c")]);
  assert.deepEqual(f.sent.at(-1).assignments, { b: 2, c: 3 });
  f.service.dispose();
});

test("subscription authorizes only its current client and exposes local URLs", async () => {
  const f = fixture();
  await f.send("setEnabled", true); assert.equal(f.writes.length, 0);
  await f.send("subscribe");
  assert.equal(f.sent.at(-1).students.length, manifest.students.length);
  assert.match(f.sent.at(-1).students[0].url, /^local-resource:.*student-avatars[\\/]1\.png$/);
  assert.equal(f.webview.options.localResourceRoots[0].fsPath, "existing-root");
  assert.equal(f.webview.options.localResourceRoots.length, 3);
  await f.send("setEnabled", true, "stale"); await f.send("setEnabled", "true");
  await f.service.handleEmbedded(f.webview, { type: "wrong", clientId: "one", action: "setEnabled", enabled: true });
  await f.service.handleEmbedded(f.webview, { type: "azrael-design", clientId: "", action: "subscribe" });
  await f.service.recordCreated(7); await f.service.recordCreated("");
  assert.equal(f.writes.length, 0);
  await f.send("subscribe", undefined, "two"); assert.equal(f.disposedListeners, 1);
  await f.send("unsubscribe", undefined, "one");
  await f.send("setEnabled", true, "two"); assert.equal(f.sent.at(-1).enabled, true);
  await f.send("unsubscribe", undefined, "two"); assert.equal(f.disposedListeners, 2);
  const count = f.sent.length; await f.service.recordCreated("a"); assert.equal(f.sent.length, count);
  f.service.dispose();
});

test("authorized parent roots keep settings webview options stable", async () => {
  const f = fixture();
  const options = { localResourceRoots: [f.context.extensionUri, f.context.globalStorageUri] };
  f.webview.options = options;
  await f.send("subscribe");
  assert.equal(f.webview.options, options, "subscription must not reload an authorized webview");
  assert.equal(f.sent.at(-1).students.length, manifest.students.length);
  await f.send("subscribe");
  assert.equal(f.webview.options, options);
  f.service.dispose();
});

test("failed posts, panel closure and service disposal release subscriptions", async () => {
  const f = fixture(); await f.send("subscribe"); f.delivers = false;
  await f.send("setEnabled", true); assert.equal(f.disposedListeners, 1);
  const writes = f.writes.length; await f.send("setEnabled", false); assert.equal(f.writes.length, writes);
  f.delivers = true; await f.send("subscribe"); f.close(); assert.equal(f.disposedListeners, 2);
  await f.send("subscribe"); f.service.dispose(); assert.equal(f.disposedListeners, 3);
  const count = f.sent.length; await f.service.recordCreated("a"); await f.send("subscribe"); assert.equal(f.sent.length, count);
});

test("changes broadcast to subscribed webviews and packaged integrated assets use local URIs", async () => {
  const f = fixture(), otherSent: any[] = [];
  const other: any = { ...f.webview, options: {}, postMessage: async (message: unknown) => { otherSent.push(message); return true; } };
  await f.send("subscribe");
  await f.service.handleEmbedded(other, { type: "azrael-design", clientId: "other", action: "subscribe" });
  await f.send("setEnabled", true); await f.service.recordCreated("a");
  assert.equal(otherSent.at(-1).clientId, "other"); assert.equal(otherSent.at(-1).enabled, true);
  assert.deepEqual(otherSent.at(-1).assignments, { a: 1 });
  f.service.dispose();
  const exists = fs.existsSync;
  let integrated: InstanceType<typeof StudentDesignService>;
  try {
    fs.existsSync = candidate => String(candidate).endsWith(path.join("webview", "assets", "azrael-students", "manifest.json"));
    integrated = new StudentDesignService(f.context, { manifest });
  } finally { fs.existsSync = exists; }
  await integrated.handleEmbedded(other, { type: "azrael-design", clientId: "integrated", action: "subscribe" });
  assert.match(otherSent.at(-1).students[0].url, /webview[\\/]assets[\\/]azrael-students[\\/]1\.png$/);
  assert.equal(other.options.localResourceRoots.length, 2, "default extension root permits integrated assets; storage must be added");
  integrated.dispose();
});

test("invalid saved settings and invalid roster fail safely without replacing durable data", async () => {
  const f = fixture({ enabled: true, decisions: { old: 999 } }); await f.send("subscribe");
  assert.equal(f.sent.at(-1).enabled, false); assert.match(f.sent.at(-1).error, /Invalid saved/);
  await f.send("setEnabled", true); await f.service.recordCreated("a"); assert.equal(f.writes.length, 0);
  await f.service.handleEmbedded(f.webview, { type: "azrael-design", clientId: "one", action: "setChatFont", chatFont: "openai" });
  assert.equal(f.writes.length, 0, "font changes must not replace invalid durable settings");
  f.service.dispose();
  for (const invalid of [{ ...manifest, schemaVersion: 2 }, { ...manifest, students: [] }, { ...manifest, students: manifest.students.map(s => ({ ...s, id: 1, asset: "1.png" })) }, { ...manifest, students: manifest.students.map(s => ({ ...s, asset: "../remote.png" })) }]) {
    const service = new StudentDesignService(f.context, { manifest: invalid });
    await service.handleEmbedded(f.webview, { type: "azrael-design", clientId: "one", action: "subscribe" });
    assert.equal(f.sent.at(-1).enabled, false); assert.deepEqual(f.sent.at(-1).students, []); assert.match(f.sent.at(-1).error, /Invalid student roster/);
    await service.recordCreated("a"); service.dispose();
  }
});

function importFixture(t: test.TestContext, stored?: unknown, storage?: string) {
  const root = path.resolve("artifacts", "verification");
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, "custom-photos-"));
  t.after(() => {
    dialogs.showOpenDialog = async () => undefined;
    dialogs.showInputBox = async () => undefined;
    assert.ok(directory.startsWith(root + path.sep));
    fs.rmSync(directory, { recursive: true });
  });
  const f = fixture(stored, storage ?? path.join(directory, "storage"));
  t.after(() => f.service.dispose());
  const file = (name: string, bytes: Buffer) => {
    const destination = path.join(directory, name);
    fs.writeFileSync(destination, bytes);
    return uri(destination);
  };
  const request = (action: string, extra: object = {}) => f.service.handleEmbedded(f.webview, { type: "azrael-design", clientId: "one", action, ...extra });
  return { ...f, f, file, request, directory };
}
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");

test("imports copy assets, select custom roster, preserve all old assignments and restore on restart", async t => {
  const { f, file, request } = importFixture(t);
  await f.send("subscribe"); await f.service.recordCreated("off");
  await f.send("setEnabled", true); await f.service.recordCreated("bundled");
  const otherMessages: any[] = [];
  const other = { ...f.webview, postMessage: async (message: unknown) => { otherMessages.push(message); return true; } };
  await f.service.handleEmbedded(other, { type: "azrael-design", clientId: "other", action: "subscribe" });
  const files = [file("one.png", png), file("two.PNG", png)];
  dialogs.showOpenDialog = async options => {
    assert.deepEqual((options as any).filters.Images, ["png", "jpg", "jpeg", "webp", "gif"]);
    assert.equal((options as any).canSelectMany, true);
    return files;
  };
  dialogs.showInputBox = async () => "  Friends  ";
  const options = f.webview.options;
  await request("importPhotoSet");
  assert.equal(f.webview.options, options, "import must not reload webview options");
  const state = f.sent.at(-1), customId = state.selectedPhotoSetId;
  assert.match(customId, /^custom-/);
  assert.equal(otherMessages.at(-1).selectedPhotoSetId, customId);
  assert.deepEqual(state.photoSets.map((s: any) => [s.name, s.count]), [["Blue Archive", manifest.students.length], ["Friends", 2]]);
  assert.equal(state.students.length, manifest.students.length + 2);
  assert.equal(state.students[manifest.students.length].photoSetId, customId);
  const saved: any = f.value;
  const asset = path.join(f.context.globalStorageUri.fsPath, "subagent-photos", saved.customPhotoSets[0].photos[0].asset);
  assert.deepEqual(fs.readFileSync(asset), png);
  fs.writeFileSync(files[0].fsPath, "source changed");
  assert.deepEqual(fs.readFileSync(asset), png, "copies must be independent of original files");
  await f.service.recordCreated("custom");
  const customAssignment = f.sent.at(-1).assignments.custom;
  assert.equal(typeof customAssignment, "string"); assert.match(customAssignment, new RegExp(`^${customId}:`));
  await request("setPhotoSet", { photoSetId: "blue-archive" });
  assert.equal(otherMessages.at(-1).selectedPhotoSetId, "blue-archive");
  await f.service.recordCreated("bundled-again");
  await f.service.recordCreated("off"); await f.service.recordCreated("custom");
  assert.deepEqual((f.value as any).decisions, { off: null, bundled: 1, custom: customAssignment, "bundled-again": 3 });
  const reload = fixture(f.value, f.context.globalStorageUri.fsPath); t.after(() => reload.service.dispose());
  await reload.send("subscribe");
  assert.deepEqual(reload.sent.at(-1).assignments, f.sent.at(-1).assignments);
  assert.equal(reload.sent.at(-1).students.length, manifest.students.length + 2);
  await reload.service.handleEmbedded(reload.webview, { type: "azrael-design", clientId: "one", action: "setPhotoSet", photoSetId: customId });
  await reload.service.recordCreated("after-restart");
  assert.equal(reload.sent.at(-1).assignments["after-restart"], `${customId}:1.png`);
  await request("setPhotoSet", { photoSetId: "missing" });
  assert.match(f.sent.at(-1).error, /Unknown/);
});

test("cancelled chooser and name dialog finish with unchanged snapshots; dialogs do not block creation", async t => {
  const { f, file, request } = importFixture(t);
  await f.send("subscribe");
  const writes = f.writes.length, messages = f.sent.length;
  await request("importPhotoSet");
  assert.equal(f.writes.length, writes); assert.equal(f.sent.length, messages + 1);
  dialogs.showOpenDialog = async () => [file("one.png", png)];
  await request("importPhotoSet"); assert.equal(f.writes.length, writes);
  let choose: ((files: any[]) => void) | undefined;
  dialogs.showOpenDialog = () => new Promise(resolve => { choose = resolve; });
  dialogs.showInputBox = async () => "Friends";
  const importing = request("importPhotoSet");
  await f.send("setEnabled", true);
  await f.service.recordCreated("during-dialog");
  assert.equal(f.sent.at(-1).assignments["during-dialog"], 1);
  choose!([file("ready.png", png)]);
  await importing;
  assert.equal(f.sent.at(-1).assignments["during-dialog"], 1, "import must merge the latest serialized decisions");
});

test("invalid formats, nonfiles and import limits return recoverable errors without saved changes", async t => {
  const { f, file, request, directory } = importFixture(t);
  await f.send("subscribe"); dialogs.showInputBox = async () => "Friends";
  const oversized = Buffer.alloc(1024 * 1024 + 1); png.copy(oversized);
  const invalid = [file("fake.png", Buffer.from("<svg/>")), file("unsafe.svg", png), file("large.png", oversized)];
  const dir = path.join(directory, "folder.png"); fs.mkdirSync(dir); invalid.push(uri(dir));
  for (const candidate of invalid) {
    dialogs.showOpenDialog = async () => [candidate];
    await request("importPhotoSet"); assert.ok(f.sent.at(-1).error); assert.equal(f.writes.length, 0);
    assert.equal(f.sent.at(-1).selectedPhotoSetId, "blue-archive");
  }
  const valid = file("good.png", png);
  dialogs.showOpenDialog = async () => Array.from({ length: 201 }, () => valid);
  await request("importPhotoSet"); assert.match(f.sent.at(-1).error, /200/);
  const large = Buffer.alloc(1024 * 1024); png.copy(large);
  const limit = file("limit.png", large);
  dialogs.showOpenDialog = async () => Array.from({ length: 21 }, () => limit);
  await request("importPhotoSet"); assert.match(f.sent.at(-1).error, /20 MiB/);
  assert.equal(f.writes.length, 0);
  dialogs.showOpenDialog = async () => [valid];
  await request("importPhotoSet"); assert.equal(f.sent.at(-1).error, undefined);
  assert.equal(f.sent.at(-1).photoSets.length, 2);
});

test("import save and copy failures preserve settings, clean incomplete assets and allow retry", async t => {
  const { f, file, request } = importFixture(t);
  await f.send("subscribe"); await f.send("setEnabled", true); await f.service.recordCreated("old");
  dialogs.showOpenDialog = async () => [file("one.png", png)]; dialogs.showInputBox = async () => "Friends";
  const before = f.value;
  f.fail = true; await request("importPhotoSet");
  assert.equal(f.value, before); assert.equal(f.sent.at(-1).photoSets.length, 1); assert.ok(f.sent.at(-1).error);
  const root = path.join(f.context.globalStorageUri.fsPath, "subagent-photos");
  assert.deepEqual(fs.readdirSync(root), []);
  f.fail = false;
  const write = fs.promises.writeFile;
  try {
    fs.promises.writeFile = async () => { throw new Error("copy unavailable"); };
    await request("importPhotoSet");
  } finally { fs.promises.writeFile = write; }
  assert.equal(f.value, before); assert.match(f.sent.at(-1).error, /copy unavailable/);
  assert.deepEqual(fs.readdirSync(root), []);
  await request("importPhotoSet");
  assert.equal(f.sent.at(-1).error, undefined); assert.deepEqual(f.sent.at(-1).assignments, { old: 1 });
  f.fail = true;
  await assert.rejects(request("setPhotoSet", { photoSetId: "blue-archive" }), /disk unavailable/);
  assert.match(f.sent.at(-1).selectedPhotoSetId, /^custom-/);
  f.fail = false; await request("setPhotoSet", { photoSetId: "blue-archive" });
  assert.equal(f.sent.at(-1).selectedPhotoSetId, "blue-archive");
});

test("all supported raster signatures import under generated safe names with stable unique IDs", async t => {
  const { f, file, request } = importFixture(t);
  await f.send("subscribe");
  const files = [file("a.png", png), file("b.jpeg", Buffer.from([255, 216, 255, 224])), file("c.gif", Buffer.from("GIF89a")), file("d.webp", Buffer.from("RIFFxxxxWEBP"))];
  dialogs.showOpenDialog = async () => files; dialogs.showInputBox = async () => "Same name";
  await request("importPhotoSet"); await request("importPhotoSet");
  const snapshot = f.sent.at(-1);
  assert.equal(snapshot.photoSets.length, 3); assert.notEqual(snapshot.photoSets[1].id, snapshot.photoSets[2].id);
  assert.equal(new Set(snapshot.students.map((s: any) => s.id)).size, manifest.students.length + 8);
  assert.deepEqual((f.value as any).customPhotoSets[0].photos.map((s: any) => s.asset.split("/")[1]), ["1.png", "2.jpg", "3.gif", "4.webp"]);
});

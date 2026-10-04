import assert from "node:assert/strict";
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const api = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const original = api._load;
const uri = (fsPath: string) => ({ fsPath, toString: () => `file:${fsPath}` });
api._load = function (request, parent, isMain) {
  return request === "vscode" ? { Uri: { joinPath: (root: { fsPath: string }, ...parts: string[]) => uri(path.join(root.fsPath, ...parts)) } } : original.call(this, request, parent, isMain);
};
const { StudentDesignService } = require("../src/studentDesign") as typeof import("../src/studentDesign");
api._load = original;
const manifest = { schemaVersion: 1, students: Array.from({ length: 100 }, (_, index) => ({ id: index + 1, nameKo: `학생 ${index + 1}`, nameEn: `Student ${index + 1}`, school: "School", asset: `${index + 1}.png` })) };

function fixture(stored?: unknown) {
  let value = stored, calls = 0, fail = false, disposedListeners = 0;
  const writes: any[] = [], sent: any[] = [];
  const context: any = { extensionUri: uri(path.resolve("fixture-extension")), globalState: {
    get: () => value,
    update: async (_key: string, next: unknown) => { writes.push(next); if (fail) throw new Error("disk unavailable"); await new Promise(resolve => setImmediate(resolve)); value = next; },
  } };
  const service = new StudentDesignService(context, { manifest, randomInt: max => { assert.equal(max, 100); return calls++ % max; } });
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

test("serialized settings and concurrent creation preserve every decision", async () => {
  const f = fixture(); await f.send("subscribe");
  await Promise.all([f.send("setEnabled", true), f.service.recordCreated("a"), f.service.recordCreated("b"), f.service.recordCreated("a"), f.send("setEnabled", false), f.service.recordCreated("c")]);
  assert.deepEqual((f.value as any).decisions, { a: 1, b: 2, c: null });
  assert.equal(f.calls, 2); assert.equal(f.sent.at(-1).enabled, false);
  f.service.dispose();
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
  assert.equal(f.sent.at(-1).students.length, 100);
  assert.match(f.sent.at(-1).students[0].url, /^local-resource:.*student-avatars[\\/]1\.png$/);
  assert.equal(f.webview.options.localResourceRoots[0].fsPath, "existing-root");
  assert.equal(f.webview.options.localResourceRoots.length, 2);
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
  assert(other.options.localResourceRoots.some((root: { fsPath: string }) => root.fsPath.endsWith(path.join("webview", "assets", "azrael-students"))));
  integrated.dispose();
});

test("invalid saved settings and invalid roster fail safely without replacing durable data", async () => {
  const f = fixture({ enabled: true, decisions: { old: 999 } }); await f.send("subscribe");
  assert.equal(f.sent.at(-1).enabled, false); assert.match(f.sent.at(-1).error, /Invalid saved/);
  await f.send("setEnabled", true); await f.service.recordCreated("a"); assert.equal(f.writes.length, 0);
  f.service.dispose();
  for (const invalid of [{ ...manifest, schemaVersion: 2 }, { ...manifest, students: manifest.students.slice(1) }, { ...manifest, students: manifest.students.map(s => ({ ...s, id: 1, asset: "1.png" })) }, { ...manifest, students: manifest.students.map(s => ({ ...s, asset: "../remote.png" })) }]) {
    const service = new StudentDesignService(f.context, { manifest: invalid });
    await service.handleEmbedded(f.webview, { type: "azrael-design", clientId: "one", action: "subscribe" });
    assert.equal(f.sent.at(-1).enabled, false); assert.deepEqual(f.sent.at(-1).students, []); assert.match(f.sent.at(-1).error, /Invalid student roster/);
    await service.recordCreated("a"); service.dispose();
  }
});

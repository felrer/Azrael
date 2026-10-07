import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import type { InstructionUiState } from "../src/instructionProtocol";

const base: InstructionUiState = { repository: "felrer/Azrael", currentVersion: "1.0.0", pinnedVersion: null, selectedVersion: "1.1.0", versions: [{ version: "1.1.0", compatible: true, prerelease: false, notes: "<script>notes</script>" }], downloadedVersions: ["1.1.0"], components: [{ id: "agents", title: "Agents", kind: "agents", scope: "home", default: true }], documents: [{ path: "AGENTS.md", title: "Instructions", kind: "agents" }], preview: { path: "AGENTS.md", text: "<img src=x onerror=alert(1)>" }, conflicts: [] };

test("instruction view escapes previews and conflicts, preserves download/apply distinction and real port actions", async () => {
  const api = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const original = api._load;
  api._load = function (request, parent, isMain) { return request === "vscode" ? {} : original.call(this, request, parent, isMain); };
  try {
    const { InstructionView, renderInstructionMarkup } = require("../src/instructionView") as typeof import("../src/instructionView");
    const html = renderInstructionMarkup({ ...base, conflicts: [{ target: "<target>", reason: "edited", current: "<current>", proposed: "<proposed>" }] }, ["agents"]);
    assert(!html.includes("<script>notes")); assert(html.includes("&lt;img")); assert(html.includes("&lt;current&gt;"));
    assert.match(html, /data-action="apply" disabled/);
    assert.match(html, /data-action="download"/);
    assert.match(renderInstructionMarkup({ ...base, downloadedVersions: [] }), /data-action="apply" disabled/);
    assert(!renderInstructionMarkup({ ...base, selectedComponentIds: [] }).includes('data-component="agents" checked'));
    const calls: unknown[] = [], sent: any[] = [];
    const view = new InstructionView({ snapshot: async () => base, request: async (action, message) => { calls.push({ action, message }); return base; } });
    const webview = { postMessage: async (m: unknown) => { sent.push(m); return true; } } as any;
    const send = (action: string, clientId = "one", message: unknown = {}) => view.handleEmbedded(webview, { type: "azrael-instructions", clientId, requestId: action, action, message });
    await send("mount"); assert.equal(sent[0].clientId, "one");
    await send("download", "stale"); assert.equal(calls.length, 0);
    await send("download", "one", { version: "1.1.0", componentIds: ["agents"] });
    assert.deepEqual(calls[0], { action: "download", message: { version: "1.1.0", componentIds: ["agents"] } });
    for (const action of ["refresh", "selectVersion", "preview", "apply", "pin", "unpin", "rollback"]) await send(action, "one", { version: "1.1.0", path: "AGENTS.md", componentIds: [] });
    assert.equal(calls.length, 8);
    await send("download", "one", { componentIds: [4] }); assert.equal(calls.length, 8);
    view.dispose();
  } finally { api._load = original; }
});

test("unmount, remount and disposal suppress late completion while busy gates duplicate mutations", async () => {
  const { InstructionView } = require("../src/instructionView") as typeof import("../src/instructionView");
  let finish!: (state: InstructionUiState) => void, calls = 0;
  const sent: any[] = [];
  const view = new InstructionView({ snapshot: async () => base, request: async () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const webview = { postMessage: async (m: unknown) => { sent.push(m); return true; } } as any;
  let sequence = 0;
  const send = (action: string, clientId = "one", locale = "en") => view.handleEmbedded(webview, { type: "azrael-instructions", clientId, requestId: String(++sequence), action, locale });
  await send("mount"); const operation = send("apply"); await new Promise(resolve => setImmediate(resolve));
  await send("apply"); assert.equal(calls, 1);
  await send("unmount"); await send("mount", "two", "ko-KR"); assert.match(sent.at(-1).html, /lang="ko"/); const before = sent.length;
  finish(base); await operation;
  assert(sent.slice(before).every(m => m.clientId === "two" && m.html.includes('lang="ko"')));
  assert.equal(sent.at(-1).requestId, String(sequence));
  assert(!sent[sent.length - 1].html.includes('aria-busy="true"'));
  const operation2 = send("rollback", "two"); await new Promise(resolve => setImmediate(resolve));
  view.dispose(); const after = sent.length; finish(base); await operation2; assert.equal(sent.length, after);
});

test("port errors become escaped retryable state and failed posts release the mount", async () => {
  const { InstructionView } = require("../src/instructionView") as typeof import("../src/instructionView");
  let failures = 1, calls = 0, delivered = true;
  const sent: any[] = [];
  const view = new InstructionView({ snapshot: async () => base, request: async () => { calls++; if (failures--) throw new Error("<offline>"); return base; } });
  const webview = { postMessage: async (m: unknown) => { sent.push(m); return delivered; } } as any;
  let requestId = 0;
  const send = (action: string) => view.handleEmbedded(webview, { type: "azrael-instructions", clientId: "one", requestId: String(++requestId), action });
  await send("mount"); await send("refresh");
  assert(sent[sent.length - 1].html.includes("&lt;offline&gt;"));
  await send("refresh"); assert.equal(calls, 2);
  delivered = false; await send("refresh"); const previous = calls;
  await send("refresh"); assert.equal(calls, previous);
  view.dispose();
});


test("per-mount locales normalize variants, preserve generated and source text, and reject malformed mounts", async () => {
  const { InstructionView, renderInstructionMarkup, normalizeInstructionLocale } = require("../src/instructionView") as typeof import("../src/instructionView");
  for (const locale of ["ko", "KO-kr", "Ko_KR", "ko-JP", "ko-Hang-KR", "ko_KP"]) assert.equal(normalizeInstructionLocale(locale), "ko");
  for (const locale of ["", "en", "en-US", "fr", "kor", "korean"]) assert.equal(normalizeInstructionLocale(locale), "en");
  assert.equal(normalizeInstructionLocale(), "en");
  const state = { ...base, busy: "download", message: [{ en: "<Generated English>", ko: "<생성된 한국어>" }, "<raw diagnostic>"], error: { en: "English error", ko: "한국어 오류" } };
  const en = renderInstructionMarkup(state, undefined, "en"), ko = renderInstructionMarkup(state, undefined, "ko_KR");
  assert.match(en, /lang="en" aria-label="Instruction documents"/);
  assert.match(ko, /lang="ko" aria-label="지침 문서"/);
  assert.match(en, /Instruction documents \(Not implemented\)/); assert.match(ko, /지침 문서 \(미구현\)/);
  assert.match(en, /Downloading…/); assert.match(ko, /다운로드 중…/);
  assert.match(en, /&lt;Generated English&gt;/); assert.match(ko, /&lt;생성된 한국어&gt;/);
  assert.match(en, /English error/); assert.match(ko, /한국어 오류/);
  for (const html of [en, ko]) { assert.match(html, /&lt;raw diagnostic&gt;/); assert.match(html, /&lt;script&gt;notes/); assert.match(html, /Agents/); assert.match(html, /AGENTS.md/); }
  const enMessages: any[] = [], koMessages: any[] = [];
  const enView = { postMessage: async (message: any) => { enMessages.push(message); return true; } } as any;
  const koView = { postMessage: async (message: any) => { koMessages.push(message); return true; } } as any;
  let calls = 0;
  const view = new InstructionView({ snapshot: async () => state, request: async () => { calls++; return state; } });
  const mount = (webview: any, locale?: unknown) => view.handleEmbedded(webview, { type: "azrael-instructions", action: "mount", clientId: "client", requestId: "mount", ...(locale !== undefined ? { locale } : {}) });
  await mount(enView, "en-US"); await mount(koView, "KO_kr");
  assert.match(enMessages.at(-1).html, /lang="en"/); assert.match(koMessages.at(-1).html, /lang="ko"/);
  for (const invalid of [null, 42, {}, "x".repeat(129)]) { const previous = koMessages.length; await mount(koView, invalid); assert.equal(koMessages.length, previous); }
  await view.handleEmbedded(koView, { type: "azrael-instructions", action: "refresh", clientId: "client", requestId: "refresh" });
  assert.equal(calls, 1); assert.match(enMessages.at(-1).html, /lang="en"/); assert.match(koMessages.at(-1).html, /lang="ko"/);
  await mount(enView); assert.match(enMessages.at(-1).html, /lang="en"/);
  view.dispose();
});


test("legacy mounts and standalone shell follow VS Code language with localized titles and loading text", async () => {
  const api = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const original = api._load, filename = require.resolve("../src/instructionView"), cached = require.cache[filename];
  const env = { language: "KO-kr" };
  const panels: any[] = [];
  api._load = function (request, parent, isMain) {
    if (request !== "vscode") return original.call(this, request, parent, isMain);
    return { env, ViewColumn: { Active: 1 }, window: { createWebviewPanel: (_kind: string, title: string) => {
      const panel = { title, webview: { html: "", onDidReceiveMessage: () => ({ dispose() {} }) }, onDidDispose: () => ({ dispose() {} }), reveal() {}, dispose() {} };
      panels.push(panel); return panel;
    } } };
  };
  delete require.cache[filename];
  try {
    const { InstructionView, renderInstructionMarkup } = require(filename) as typeof import("../src/instructionView");
    assert.match(renderInstructionMarkup(base), /lang="ko"/);
    const sent: any[] = [];
    const view = new InstructionView({ snapshot: async () => base, request: async () => base });
    const webview = { postMessage: async (message: any) => { sent.push(message); return true; } } as any;
    await view.handleEmbedded(webview, { type: "azrael-instructions", clientId: "legacy", requestId: "1", action: "mount" });
    assert.match(sent.at(-1).html, /lang="ko"/);
    view.show(); assert.equal(panels[0].title, "Azrael 설정"); assert.match(panels[0].webview.html, /<html lang="ko">/); assert.match(panels[0].webview.html, /불러오는 중…/);
    env.language = "en-US";
    const english = new InstructionView({ snapshot: async () => base, request: async () => base });
    english.show(); assert.equal(panels[1].title, "Azrael Settings"); assert.match(panels[1].webview.html, /<html lang="en">/); assert.match(panels[1].webview.html, /Open distribution source settings/); assert.match(panels[1].webview.html, /Loading…/);
    assert.match(sent.at(-1).html, /lang="ko"/);
    view.dispose(); english.dispose();
  } finally { api._load = original; if (cached) require.cache[filename] = cached; else delete require.cache[filename]; }
});

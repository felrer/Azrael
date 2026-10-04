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
  const send = (action: string, clientId = "one") => view.handleEmbedded(webview, { type: "azrael-instructions", clientId, requestId: String(++sequence), action });
  await send("mount"); const operation = send("apply"); await new Promise(resolve => setImmediate(resolve));
  await send("apply"); assert.equal(calls, 1);
  await send("unmount"); await send("mount", "two"); const before = sent.length;
  finish(base); await operation;
  assert(sent.slice(before).every(m => m.clientId === "two"));
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

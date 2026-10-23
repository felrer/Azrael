import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import Module from "node:module";
import test from "node:test";
import { usageExpansionKey } from "../src/usagePresentation";

test("identical markup preserves standalone and embedded targets, with fresh renders on remount", async () => {
  const moduleApi = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const original = moduleApi._load;
  moduleApi._load = function (request, parent, isMain) {
    if (request === "vscode") return { window: {} };
    return original.call(this, request, parent, isMain);
  };
  let view: import("../src/usageView").UsageView | undefined;
  try {
    delete require.cache[require.resolve("../src/usageView")];
    const { UsageView } = require("../src/usageView") as typeof import("../src/usageView");
    const service = Object.assign(new EventEmitter(), { changesEnabled: true, state: { profiles: [], activeProfileId: null } });
    const windows = new EventEmitter();
    view = new UsageView(service as never, {} as never, { dispose() {} } as never, undefined, undefined, undefined, windows as never);
    const internal = view as unknown as { panel: unknown; render(): void; renderMarkup(): string; visibility(): void };
    let markup = "<main>initial</main>";
    internal.renderMarkup = () => markup;
    internal.visibility = () => {};
    let assignments = 0;
    const createPanel = () => ({ webview: { set html(_value: string) { ++assignments; } }, dispose() {} });
    internal.panel = createPanel();
    const sent: { clientId: string; html: string }[] = [];
    const webview = { async postMessage(message: { clientId: string; html: string }) { sent.push(message); return true; } };
    await view.handleEmbedded(webview as never, { type: "azrael-accounts", action: "mount", clientId: "first" });
    assert.equal(assignments, 1);
    assert.equal(sent.length, 1);
    internal.render();
    windows.emit("change");
    assert.equal(assignments, 1, "same HTML does not replace standalone page");
    assert.equal(sent.length, 1, "same HTML is not resent to embedded page");
    markup = "<main>changed</main>";
    internal.render();
    internal.render();
    assert.equal(assignments, 2);
    assert.equal(sent.length, 2, "pending identical sends are suppressed");
    await Promise.resolve();
    internal.render();
    assert.equal(sent.length, 2, "successfully delivered identical sends are suppressed");
    internal.panel = createPanel();
    internal.render();
    assert.equal(assignments, 3, "new standalone target always receives markup");
    await view.handleEmbedded(webview as never, { type: "azrael-accounts", action: "mount", clientId: "second" });
    assert.equal(sent.length, 3);
    assert.equal(sent.at(-1)?.clientId, "second");
  } finally {
    view?.dispose();
    moduleApi._load = original;
  }
});

test("standalone account HTML resolves official local fonts and permits their webview source", () => {
  const moduleApi = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const original = moduleApi._load;
  moduleApi._load = function (request, parent, isMain) {
    if (request === "vscode") return { window: {}, Uri: { joinPath: (root: string, file: string) => `${root}/${file}` } };
    return original.call(this, request, parent, isMain);
  };
  let view: import("../src/usageView").UsageView | undefined;
  try {
    delete require.cache[require.resolve("../src/usageView")];
    const { UsageView } = require("../src/usageView") as typeof import("../src/usageView");
    const service = Object.assign(new EventEmitter(), { changesEnabled: true, state: { profiles: [], activeProfileId: null } });
    view = new UsageView(service as never, { get() {} } as never, { dispose() {} } as never, undefined, undefined, undefined, undefined, "extension/media/fonts" as never);
    const resolved: string[] = [];
    const panel = { webview: { html: "", cspSource: "vscode-webview-resource:", asWebviewUri(uri: string) { resolved.push(uri); return { toString() { return `https://local.example/${uri}`; } }; } }, dispose() {} };
    const internal = view as unknown as { panel: unknown; render(): void };
    internal.panel = panel;
    internal.render();
    assert.deepEqual(resolved, ["extension/media/fonts/gyeonggi-title-light.woff", "extension/media/fonts/cascadia-mono.woff2", "extension/media/fonts/cascadia-mono-italic.woff2"]);
    assert.match(panel.webview.html, /font-src vscode-webview-resource:;/);
    assert.match(panel.webview.html, /@font-face\{font-family:"Azrael Gyeonggi Title";src:url\("https:\/\/local.example\/extension\/media\/fonts\/gyeonggi-title-light.woff"\)/);
    assert.match(panel.webview.html, /font-weight:400/);
    assert.equal(panel.webview.html.split("@font-face").length, 5);
    assert.match(panel.webview.html, /cascadia-mono-italic\.woff2/);
    assert.match(panel.webview.html, /dataset\.azraelFontPlatform=/);
    assert.doesNotMatch(panel.webview.html, /gyeonggi-batang|font-weight:700/);
  } finally {
    view?.dispose();
    moduleApi._load = original;
  }
});

test("timer action shows confirmed state, guards pending clicks and keeps safe errors separate", async () => {
  const moduleApi = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const original = moduleApi._load;
  moduleApi._load = function (request, parent, isMain) {
    if (request === "vscode") return { window: {} };
    return original.call(this, request, parent, isMain);
  };
  let view: import("../src/usageView").UsageView | undefined;
  try {
    delete require.cache[require.resolve("../src/usageView")];
    const { UsageView } = require("../src/usageView") as typeof import("../src/usageView");
    const profile = { id: "a".repeat(32), workspaceAccountId: "workspace", userId: "user", email: "account@example.com", autoSwitchAllowed: true };
    const service = Object.assign(new EventEmitter(), { changesEnabled: true, state: { profiles: [profile], activeProfileId: null } });
    let enabled: boolean | undefined;
    let release!: () => void;
    let toggles = 0;
    const windows = Object.assign(new EventEmitter(), {
      error: "자동 타이머 상태를 확인하지 못했습니다.",
      forProfile() { return enabled === undefined ? undefined : { enabled, error: null }; },
      async setEnabled() { ++toggles; await new Promise<void>(resolve => { release = resolve; }); },
    });
    const usage = { get() { return undefined; } };
    view = new UsageView(service as never, usage as never, { dispose() {} } as never, undefined, undefined, undefined, windows as never);
    const internal = view as unknown as { panel: unknown; expanded: Set<string>; render(): void; onMessage(message: unknown): Promise<void> };
    const panel = { webview: { html: "" }, dispose() {} };
    internal.panel = panel;
    internal.expanded.add(usageExpansionKey("openai", profile.id, profile.workspaceAccountId));
    internal.render();
    assert.match(panel.webview.html, /class="card-actions">.*<button[^>]*>상태 확인 필요<\/button><button data-action="openaiReauth"/);
    assert.doesNotMatch(panel.webview.html, /Timer Unfreeze: 꺼짐|리셋 후 짧은|다음 확인|automatic-window/);
    assert.match(panel.webview.html, /<p class="error"><span data-azrael-dynamic-text>자동 타이머 상태를 확인하지 못했습니다\.<\/span><\/p>/);
    assert.match(panel.webview.html, /data-action="openaiSwitch"/);
    assert.match(panel.webview.html, /data-action="setAutoSwitch"[^>]*checked/);
    enabled = true;
    internal.render();
    assert.match(panel.webview.html, /data-action="autoWindowDisable"[^>]*>Timer Unfreeze: 켜짐<\/button>/);
    const message = { action: "autoWindowDisable", profileId: profile.id, workspaceAccountId: profile.workspaceAccountId };
    const pending = internal.onMessage(message);
    assert.match(panel.webview.html, /data-action="autoWindowDisable"[^>]*disabled>변경 중…<\/button>/);
    await internal.onMessage(message);
    assert.equal(toggles, 1);
    release();
    await pending;
    assert.match(panel.webview.html, /data-action="autoWindowDisable"[^>]*>Timer Unfreeze: 켜짐<\/button>/);
    assert.doesNotMatch(panel.webview.html, />변경 중…</);
    enabled = false;
    windows.error = "";
    windows.emit("change");
    assert.match(panel.webview.html, /data-action="autoWindowEnable"[^>]*>Timer Unfreeze: 꺼짐<\/button>/);
    await internal.onMessage({ ...message, workspaceAccountId: "other" });
    assert.equal(toggles, 1);
    internal.expanded.clear();
    internal.render();
    assert.doesNotMatch(panel.webview.html, /data-action="autoWindowEnable"/);
    await internal.onMessage(message);
    assert.equal(toggles, 1);
  } finally {
    view?.dispose();
    moduleApi._load = original;
  }
});

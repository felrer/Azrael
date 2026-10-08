import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import Module from "node:module";
import test from "node:test";

test("visible accounts refresh every two minutes without queuing an endless refresh", async (t) => {
  const intervals: number[] = [];
  const originalSetInterval = global.setInterval;
  t.mock.method(global, "setInterval", (callback: () => void, delay: number) => {
    intervals.push(delay);
    return originalSetInterval(callback, delay);
  });
  const moduleApi = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const originalLoad = moduleApi._load;
  moduleApi._load = function (request, parent, isMain) {
    if (request === "vscode") return {
      window: { showErrorMessage() {}, showWarningMessage() {}, showQuickPick() {}, showInputBox() {} },
      env: { openExternal() {} },
      Uri: { parse(value: string) { return value; } },
      commands: { executeCommand() {} },
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const { UsageView } = require("../src/usageView") as typeof import("../src/usageView");
    class Service extends EventEmitter {
      refreshCalls = 0;
      state = { profiles: [], activeProfileId: null, pendingProfileId: null, isSwitching: false, loginPending: false };
      error = undefined;
      async refresh() { ++this.refreshCalls; this.emit("state", this.state); return this.state; }
      async devin() { return { enabled: false, loggedIn: false, email: null, plan: null, loginPending: false, lastError: null }; }
    }
    const service = new Service();
    const usage = { dueResetProfiles: () => [], refresh: async () => undefined, get: () => undefined };
    const devinUsage = { snapshot: undefined, error: undefined, refresh: async () => undefined, cancelRefresh() {}, dispose() {} };
    const view = new UsageView(service as never, usage as never, devinUsage as never);
    const panel = { visible: true, webview: { html: "" }, dispose() {} };
    (view as unknown as { panel: unknown }).panel = panel;
    (view as unknown as { visibility(): void }).visibility();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(intervals, [120_000]);
    assert.equal(service.refreshCalls, 1);
    view.dispose();
  } finally {
    moduleApi._load = originalLoad;
  }
});

test("provider view ignores key-mode helper data and only offers browser OAuth", async () => {
  const moduleApi = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const originalLoad = moduleApi._load;
  const quickPickOptions: Array<{ provider: { id: string } }> = [];
  let inputCalls = 0;
  moduleApi._load = function (request, parent, isMain) {
    if (request === "vscode") return {
      window: {
        showErrorMessage() {}, showWarningMessage() {},
        showQuickPick(options: Array<{ provider: { id: string } }>) { quickPickOptions.push(...options); return options[0]; },
        showInputBox() { ++inputCalls; return "secret"; },
      },
      env: { openExternal() {} }, Uri: { parse(value: string) { return value; } }, commands: { executeCommand() {} },
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve("../src/usageView")];
    const { UsageView } = require("../src/usageView") as typeof import("../src/usageView");
    const service = new EventEmitter() as EventEmitter & { state: unknown };
    service.state = { profiles: [], activeProfileId: null, pendingProfileId: null, isSwitching: false, loginPending: false };
    const usage = { get() { return undefined; } };
    const devinUsage = { snapshot: undefined, error: undefined, dispose() {} };
    const account = { id: "account", label: "Account", selected: false, needsReauth: false };
    const snapshot = {
      providers: [
        { id: "key-provider", label: "Hidden Key Provider", authKind: "apiKey", quotaMode: "passive", inferenceConnected: false, accounts: [account] },
        { id: "oauth-provider", label: "OAuth Provider", authKind: "oauth", quotaMode: "probe", inferenceConnected: true, accounts: [account] },
        { id: "openai", label: "Duplicate OpenAI", authKind: "oauth", quotaMode: "probe", inferenceConnected: true, accounts: [account] },
      ],
      availableProviders: [
        { id: "key-provider", label: "Hidden Key Provider", authKind: "apiKey" },
        { id: "oauth-provider", label: "OAuth Provider", authKind: "oauth" },
        { id: "openai", label: "Duplicate OpenAI", authKind: "oauth" },
      ],
    };
    const calls: string[] = [];
    const providers = {
      enabled: true, snapshot, error: undefined,
      async refresh() { return snapshot; },
      async quota(providerId: string) { calls.push(`quota:${providerId}`); return undefined; },
      async select(providerId: string) { calls.push(`select:${providerId}`); },
      async remove(providerId: string) { calls.push(`remove:${providerId}`); },
      async login(providerId: string) { calls.push(`login:${providerId}`); },
      async addKey() { calls.push("addKey"); },
      cancelLogin() {}, dispose() {},
    };
    const view = new UsageView(service as never, usage as never, devinUsage as never, providers as never);
    const panel = { visible: true, webview: { html: "" }, dispose() {} };
    (view as unknown as { panel: unknown }).panel = panel;
    const privateView = view as unknown as {
      render(): void;
      refreshProviders(force: boolean): Promise<void>;
      handleProviderAction(message: Record<string, unknown>): Promise<void>;
    };
    privateView.render();
    assert.doesNotMatch(panel.webview.html, /Hidden Key Provider|Duplicate OpenAI|API 키/);
    assert.match(panel.webview.html, /OAuth Provider/);
    await privateView.handleProviderAction({ action: "providerAdd", providerId: "key-provider" });
    await privateView.handleProviderAction({ action: "providerSelect", providerId: "key-provider", accountId: "account" });
    await privateView.handleProviderAction({ action: "providerRemove", providerId: "openai", accountId: "account" });
    assert.deepEqual(calls, []);
    await privateView.handleProviderAction({ action: "providerAdd" });
    assert.deepEqual(quickPickOptions.map(item => item.provider.id), ["oauth-provider"]);
    assert.deepEqual(calls, ["login:oauth-provider"]);
    assert.equal(inputCalls, 0);
    await privateView.refreshProviders(false);
    assert.equal(calls.join(","), "login:oauth-provider,quota:oauth-provider");
    (view as unknown as { expanded: Set<string> }).expanded.add(JSON.stringify(["provider", "oauth-provider", "account"]));
    await privateView.refreshProviders(false);
    assert.equal(calls.join(","), "login:oauth-provider,quota:oauth-provider,quota:oauth-provider");
    view.dispose();
  } finally {
    moduleApi._load = originalLoad;
  }
});


test("usage summaries refresh every visible identity while details remain collapsed and expansion is sanitized", async () => {
  const moduleApi = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const originalLoad = moduleApi._load;
  moduleApi._load = function (request, parent, isMain) {
    if (request === "vscode") return { window: { showErrorMessage() {} } };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve("../src/usageView")];
    const { UsageView } = require("../src/usageView") as typeof import("../src/usageView");
    class Service extends EventEmitter {
      state = { profiles: [{ id: "a", email: "openai-a", workspaceAccountId: "w" }, { id: "b", email: "openai-b", workspaceAccountId: "w" }], activeProfileId: "a" };
      async refresh() { this.emit("state"); return this.state; }
      async devin() { return { enabled: true, loggedIn: true, email: "cli", plan: "pro" }; }
    }
    const service = new Service();
    const calls: string[] = [];
    const usage = { get() { return { data: { rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: null }, secondary: null }, rateLimitResetCredits: null } }; }, dueResetProfiles() { return []; }, async refresh(id: string) { calls.push(`openai:${id}`); } };
    let cancels = 0;
    const devin = { snapshot: undefined, error: undefined, async refresh() { calls.push("cli"); }, cancelRefresh() { ++cancels; }, dispose() {} };
    let accounts = [{ id: "a", label: "managed-a" }, { id: "b", label: "managed-b" }];
    const snapshot = () => ({ providers: [{ id: "devin", label: "Managed", authKind: "oauth", inferenceConnected: false, accounts }], availableProviders: [] });
    const providers = { enabled: true, snapshot: snapshot(), async refresh() { return snapshot(); }, async quota(providerId: string, accountId: string) {
      calls.push(`managed:${accountId}`);
      return { providerId, accountId, status: "ok", source: "test", observedAt: 1, rows: [{ label: "Quota", remaining: 7 }] };
    }, dispose() {} };
    let saved: unknown = [42, {}, "bad", '["openai"]', '["unknown","a"]'];
    const memento = { get() { return saved; }, async update(_key: string, value: unknown) { saved = value; } };
    const make = () => {
      const view = new UsageView(service as never, usage as never, devin as never, providers as never, undefined, memento as never);
      const panel = { visible: true, webview: { html: "" }, dispose() {} };
      const internal = view as unknown as { panel: unknown; refresh(force?: boolean): Promise<void>; onMessage(message: unknown): Promise<void>; providerQuotas: Map<string, unknown> };
      internal.panel = panel;
      return { view, internal, panel };
    };
    let current = make();
    const all = ["cli", "managed:a", "managed:b", "openai:a", "openai:b"];
    await current.internal.refresh();
    assert.deepEqual([...calls].sort(), all);
    assert.match(current.panel.webview.html, /aria-expanded="false"/);
    assert.match(current.panel.webview.html, /75% 남음/);
    assert.match(current.panel.webview.html, /badge current-login/);
    assert.doesNotMatch(current.panel.webview.html, /요금제 확인 필요|마지막 갱신|data-action="(?:openaiReauth|openaiRemove|providerReauth|providerRemove|manageDevin)"/);
    assert.doesNotMatch(current.panel.webview.html, /data-action="openaiSwitch"/);
    assert.match(current.panel.webview.html, /role="button"[^>]*data-action="toggleUsage"/);
    calls.length = 0;
    await current.internal.onMessage({ action: "toggleUsage", profileId: "a", workspaceAccountId: "wrong" });
    await current.internal.onMessage({ action: "toggleUsage", providerId: "missing", accountId: "a" });
    assert.deepEqual(calls, []);
    await current.internal.onMessage({ action: "toggleUsage", profileId: "a", workspaceAccountId: "w" });
    assert.deepEqual([...calls].sort(), all);
    assert.match(current.panel.webview.html, /aria-expanded="true"/);
    assert.match(current.panel.webview.html, /data-action="openaiReauth"/);
    assert.match(current.panel.webview.html, /data-action="openaiRemove"/);
    await current.internal.onMessage({ action: "toggleUsage", providerId: "devin", accountId: "a" });
    assert.match(current.panel.webview.html, /data-action="providerReauth"/);
    assert.match(current.panel.webview.html, /data-action="providerRemove"/);
    assert.equal(current.internal.providerQuotas.size, 2);
    await current.internal.onMessage({ action: "toggleUsage", providerId: "devin", accountId: "a" });
    calls.length = 0;
    await current.internal.onMessage({ action: "refresh" });
    assert.deepEqual([...calls].sort(), all);
    assert.equal(current.internal.providerQuotas.size, 2, "collapsed rows retain current quotas");
    accounts = [{ id: "b", label: "managed-b" }];
    await current.internal.refresh();
    assert.equal(current.internal.providerQuotas.size, 1, "removed identity is evicted while remaining summary refreshes");
    accounts = [{ id: "a", label: "managed-a" }, { id: "b", label: "managed-b" }];
    await current.internal.onMessage({ action: "toggleUsage", kind: "devin-cli", accountId: "cli" });
    assert.match(current.panel.webview.html, /data-action="manageDevin"/);
    await current.internal.onMessage({ action: "toggleUsage", kind: "devin-cli", accountId: "cli" });
    assert.equal(cancels, 0, "closing details keeps visible CLI summary refreshes available");
    assert.deepEqual(saved, [JSON.stringify(["openai", "a", "w"])]);
    current.internal.panel = { visible: true, webview: { html: "" }, dispose() {} };
    calls.length = 0;
    await current.internal.refresh();
    assert.deepEqual([...calls].sort(), all);
    current.view.dispose();
    saved = [...saved as string[], 12, "not json"];
    current = make();
    calls.length = 0;
    await current.internal.refresh();
    assert.deepEqual([...calls].sort(), all);
    assert.match(current.panel.webview.html, /aria-expanded="true"/);
    await current.internal.onMessage({ action: "toggleUsage", profileId: "a", workspaceAccountId: "w" });
    assert.deepEqual(saved, []);
    current.view.dispose();
  } finally { moduleApi._load = originalLoad; }
});

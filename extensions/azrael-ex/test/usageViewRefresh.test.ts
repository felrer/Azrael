import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import Module from "node:module";
import test from "node:test";

test("account state emitted by the view's own refresh does not queue an endless refresh", async () => {
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
    await (view as unknown as { refresh(force?: boolean): Promise<void> }).refresh();
    await new Promise(resolve => setImmediate(resolve));
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
    assert.equal(calls.join(","), "login:oauth-provider");
    (view as unknown as { expanded: Set<string> }).expanded.add(JSON.stringify(["provider", "oauth-provider", "account"]));
    await privateView.refreshProviders(false);
    assert.equal(calls.join(","), "login:oauth-provider,quota:oauth-provider");
    view.dispose();
  } finally {
    moduleApi._load = originalLoad;
  }
});


test("usage defaults collapsed, validates toggles, selectively refreshes and restores sanitized expansion", async () => {
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
    const usage = { get() {}, dueResetProfiles() { return []; }, async refresh(id: string) { calls.push(`openai:${id}`); } };
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
    await current.internal.refresh();
    assert.deepEqual(calls, []);
    assert.match(current.panel.webview.html, /account-provider">요금제 확인 필요<\/span>/);
    assert.match(current.panel.webview.html, /aria-expanded="false"/);
    assert.doesNotMatch(current.panel.webview.html, /usage-details|마지막 갱신|계정별 한도를 불러오는 중/);
    assert.doesNotMatch(current.panel.webview.html, /data-action="(?:openaiReauth|openaiRemove|providerReauth|providerRemove|manageDevin)"/);
    assert.match(current.panel.webview.html, /identity-actions.*data-action="openaiSwitch"/);
    assert.match(current.panel.webview.html, /account-heading.*usage-toggle.*<h2><span data-azrael-dynamic-text>cli<\/span><\/h2>/);
    await current.internal.onMessage({ action: "toggleUsage", profileId: "a", workspaceAccountId: "wrong" });
    await current.internal.onMessage({ action: "toggleUsage", providerId: "missing", accountId: "a" });
    assert.deepEqual(calls, []);
    await current.internal.onMessage({ action: "toggleUsage", profileId: "a", workspaceAccountId: "w" });
    assert.deepEqual(calls, ["openai:a"]);
    assert.match(current.panel.webview.html, /aria-expanded="true" aria-label="사용량 접기"/);
    assert.match(current.panel.webview.html, /data-action="openaiReauth"/);
    assert.match(current.panel.webview.html, /data-action="openaiRemove"/);
    await current.internal.onMessage({ action: "toggleUsage", providerId: "devin", accountId: "a" });
    assert.match(current.panel.webview.html, /data-action="providerReauth"/);
    assert.match(current.panel.webview.html, /data-action="providerRemove"/);
    assert.deepEqual(calls.slice(-2), ["openai:a", "managed:a"]);
    assert.equal(current.internal.providerQuotas.size, 1);
    await current.internal.onMessage({ action: "toggleUsage", providerId: "devin", accountId: "a" });
    calls.length = 0;
    await current.internal.onMessage({ action: "refresh" });
    assert.deepEqual(calls, ["openai:a"]);
    assert.equal(current.internal.providerQuotas.size, 1, "collapsed current account keeps cached quota");
    accounts = [{ id: "b", label: "managed-b" }];
    await current.internal.refresh();
    assert.equal(current.internal.providerQuotas.size, 0, "removed identity clears cached quota even when collapsed");
    accounts = [{ id: "a", label: "managed-a" }, { id: "b", label: "managed-b" }];
    await current.internal.onMessage({ action: "toggleUsage", kind: "devin-cli", accountId: "cli" });
    assert.match(calls.join(","), /cli/);
    assert.match(current.panel.webview.html, /data-action="manageDevin"/);
    await current.internal.onMessage({ action: "toggleUsage", kind: "devin-cli", accountId: "cli" });
    assert.equal(cancels, 1);
    calls.length = 0;
    await current.internal.refresh();
    assert.deepEqual(calls, ["openai:a"]);
    assert.deepEqual(saved, [JSON.stringify(["openai", "a", "w"])]);
    // Replacing the panel models close/reopen; a new view models extension restart.
    current.internal.panel = { visible: true, webview: { html: "" }, dispose() {} };
    calls.length = 0;
    await current.internal.refresh();
    assert.deepEqual(calls, ["openai:a"]);
    current.view.dispose();
    saved = [...saved as string[], 12, "not json"];
    current = make();
    calls.length = 0;
    await current.internal.refresh();
    assert.deepEqual(calls, ["openai:a"]);
    await current.internal.onMessage({ action: "toggleUsage", profileId: "a", workspaceAccountId: "w" });
    assert.deepEqual(saved, []);
    accounts = [{ id: "b", label: "managed-b" }];
    await current.internal.refresh();
    assert.equal(current.internal.providerQuotas.size, 0);
    current.view.dispose();
  } finally { moduleApi._load = originalLoad; }
});

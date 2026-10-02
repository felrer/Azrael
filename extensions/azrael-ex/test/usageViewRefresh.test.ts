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
    assert.equal(calls.join(","), "login:oauth-provider,quota:oauth-provider");
    view.dispose();
  } finally {
    moduleApi._load = originalLoad;
  }
});

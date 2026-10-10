import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import Module from "node:module";
import vm from "node:vm";
import test from "node:test";
import { ProviderAccountService, parseProviderSnapshot } from "../src/providerAccountService";
import { parseAccountResponse } from "../src/protocol";
import { providerAccountHtml } from "../src/usagePresentation";

const account = { id: "saved", label: "Saved", selected: false, needsReauth: false };
const provider = { id: "provider", label: "Provider", authKind: "oauth" as const, quotaMode: "probe" as const, inferenceConnected: true, accounts: [account] };
const snapshot = { providers: [provider], availableProviders: [{ id: provider.id, label: provider.label, authKind: provider.authKind }] };

test("native profile permissions default off and reject non-boolean values", () => {
  const profile = { id: "a".repeat(32), workspaceAccountId: "workspace", userId: "user" };
  const response = { state: { instanceId: "instance", revision: 1, codexHome: "home", profiles: [profile], activeProfileId: null, pendingProfileId: null } };
  assert.equal(parseAccountResponse(response).state.profiles[0].autoSwitchAllowed, undefined);
  assert.equal(parseAccountResponse({ state: { ...response.state, profiles: [{ ...profile, autoSwitchAllowed: true }] } }).state.profiles[0].autoSwitchAllowed, true);
  assert.throws(() => parseAccountResponse({ state: { ...response.state, profiles: [{ ...profile, autoSwitchAllowed: "true" }] } }), /profile/);
});

test("connected saved accounts expose an accessible opt-in in expanded management details", () => {
  assert.doesNotMatch(providerAccountHtml(provider, account, undefined), /data-action="setAutoSwitch"/);
  const html = providerAccountHtml(provider, account, undefined, undefined, true);
  assert.match(html, /<label[^>]*><input type="checkbox"[^>]*><span class="switch-track" aria-hidden="true"><\/span>자동 전환 허용<\/label>/);
  assert.doesNotMatch(html, /checked/);
  assert.match(providerAccountHtml(provider, { ...account, autoSwitchAllowed: true }, undefined, undefined, true, true), /checked.*disabled/);
  assert.match(providerAccountHtml(provider, { ...account, autoSwitchAvailable: true }, undefined, undefined, true), /자동 전환 허용/);
  assert.doesNotMatch(providerAccountHtml(provider, { ...account, autoSwitchAvailable: false, autoSwitchAllowed: true }, undefined, undefined, true), /자동 전환 허용/);
  assert.doesNotMatch(providerAccountHtml({ ...provider, inferenceConnected: false }, account, undefined, undefined, true), /자동 전환 허용/);
});

test("permission parsing and helper submission retain only a boolean for a saved identity", async () => {
  const make = (value: unknown) => ({ ...snapshot, providers: [{ ...provider, accounts: [{ ...account, autoSwitchAllowed: value }] }] });
  assert.equal(parseProviderSnapshot(make(true)).providers[0].accounts[0].autoSwitchAllowed, true);
  assert.throws(() => parseProviderSnapshot(make("true")), /account identity/);
  const availability = (value: unknown) => ({ ...snapshot, providers: [{ ...provider, accounts: [{ ...account, autoSwitchAvailable: value }] }] });
  for (const value of [true, false]) assert.equal(parseProviderSnapshot(availability(value)).providers[0].accounts[0].autoSwitchAvailable, value);
  assert.throws(() => parseProviderSnapshot(availability("false")), /account identity/);
  const service = new ProviderAccountService("C:/home", {}, { openUrl: async () => true, prompt: async () => undefined });
  service.snapshot = snapshot;
  const calls: unknown[] = [];
  (service as unknown as { request(action: string, params?: unknown): Promise<unknown> }).request = async (action, params) => {
    calls.push({ action, params });
    return make(true);
  };
  await service.setAutoSwitch("provider", "saved", true);
  assert.deepEqual(calls, [{ action: "setAutoSwitch", params: { providerId: "provider", accountId: "saved", enabled: true } }, { action: "list", params: undefined }]);
  assert.equal(service.snapshot.providers[0].accounts[0].autoSwitchAllowed, true);
  await assert.rejects(service.setAutoSwitch("provider", "missing", false), /Unknown/);
  service.snapshot = { ...snapshot, providers: [{ ...provider, inferenceConnected: false }] };
  await assert.rejects(service.setAutoSwitch("provider", "saved", true), /unavailable/);
  service.snapshot = parseProviderSnapshot(availability(false));
  await assert.rejects(service.setAutoSwitch("provider", "saved", true), /unavailable/);
  await assert.rejects(service.setAutoSwitch("provider", "saved", false), /unavailable/);
  assert.equal(calls.length, 2);
  service.snapshot = snapshot;
  const failedCalls: string[] = [];
  (service as unknown as { request(action: string): Promise<unknown> }).request = async action => { failedCalls.push(action); throw new Error("transport failure"); };
  await assert.rejects(service.setAutoSwitch("provider", "saved", false), /transport failure/);
  assert.deepEqual(failedCalls, ["setAutoSwitch"]);
});

test("view validates fresh identities, suppresses duplicates and rolls failed permission changes back", async () => {
  const moduleApi = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const original = moduleApi._load;
  moduleApi._load = function (request, parent, isMain) {
    if (request === "vscode") return { window: { showErrorMessage() {} } };
    return original.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve("../src/usageView")];
    const { UsageView } = require("../src/usageView") as typeof import("../src/usageView");
    const profile = { id: "a".repeat(32), workspaceAccountId: "workspace", userId: "user", email: "saved", planType: null };
    const service = Object.assign(new EventEmitter(), { state: { profiles: [profile] }, refresh: async () => service.state, call: async (_params: unknown) => {} });
    let release!: () => void;
    const calls: unknown[] = [];
    service.call = async params => { calls.push(params); await new Promise<void>(resolve => { release = resolve; }); throw new Error("failed"); };
    const backend = { enabled: true, snapshot, refresh: async () => snapshot, setAutoSwitch: async (...args: unknown[]) => { calls.push(args); }, dispose() {} };
    const view = new UsageView(service as never, { get() {} } as never, { dispose() {} } as never, backend as never);
    const internal = view as unknown as { onMessage(message: unknown): Promise<void>; renderMarkup(): string; panel: unknown };
    const panel = { visible: false, webview: { html: "" }, dispose() {} };
    internal.panel = panel;
    const message = { action: "setAutoSwitch", profileId: profile.id, workspaceAccountId: "workspace", enabled: true };
    await internal.onMessage({ ...message, enabled: "true" });
    await internal.onMessage({ ...message, workspaceAccountId: "wrong" });
    assert.equal(calls.length, 0);
    await internal.onMessage({ action: "toggleUsage", profileId: profile.id, workspaceAccountId: "workspace" });
    assert.match(internal.renderMarkup(), /aria-expanded="true"/);
    const pending = internal.onMessage(message);
    await new Promise(resolve => setImmediate(resolve));
    assert.match(internal.renderMarkup(), /data-profile="a+"[^>]*disabled/);
    await internal.onMessage(message);
    assert.equal(calls.length, 1);
    release(); await pending;
    assert.deepEqual(calls[0], { action: "autoSwitchEnable", profileId: profile.id });
    assert.match(internal.renderMarkup(), /failed/);
    assert.doesNotMatch(internal.renderMarkup().match(/<input[^>]*data-profile="a+"[^>]*>/)![0], /checked|disabled/);
    await internal.onMessage({ action: "setAutoSwitch", providerId: "provider", accountId: "saved", enabled: false });
    assert.deepEqual(calls[1], ["provider", "saved", false]);
    backend.refresh = async () => ({ ...snapshot, providers: [{ ...provider, accounts: [{ ...account, autoSwitchAvailable: false }] }] });
    await internal.onMessage({ action: "setAutoSwitch", providerId: "provider", accountId: "saved", enabled: true });
    assert.equal(calls.length, 2);
    assert.doesNotMatch(internal.renderMarkup(), /data-action="setAutoSwitch" data-provider=/);
    backend.refresh = async () => ({ ...snapshot, providers: [] });
    await internal.onMessage({ action: "setAutoSwitch", providerId: "provider", accountId: "saved", enabled: true });
    assert.equal(calls.length, 2);

    class HTMLInputElement { type = "checkbox"; disabled = false; checked = true; dataset = { action: "setAutoSwitch", profile: profile.id, workspace: "workspace" }; }
    const listeners = new Map<string, (event: unknown) => void>();
    const sent: unknown[] = [];
    const script = panel.webview.html.match(/<script[^>]*>([\s\S]*)<\/script>/)![1];
    vm.runInNewContext(script, { HTMLInputElement, acquireVsCodeApi: () => ({ postMessage: (message: unknown) => sent.push(message) }), document: { addEventListener: (name: string, fn: (event: unknown) => void) => listeners.set(name, fn), querySelector: () => null } });
    const input = new HTMLInputElement();
    listeners.get("change")!({ target: input });
    assert.equal(input.disabled, true);
    assert.deepEqual(JSON.parse(JSON.stringify(sent[0])), message);
    listeners.get("change")!({ target: input });
    assert.equal(sent.length, 1);
    view.dispose();
  } finally { moduleApi._load = original; }
});

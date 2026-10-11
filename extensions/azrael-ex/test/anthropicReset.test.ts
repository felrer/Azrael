import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { EventEmitter } from "node:events";
import { providerAccountHtml, usageExpansionKey } from "../src/usagePresentation";
import { ProviderAccountService } from "../src/providerAccountService";
import { ManagedProvider } from "../src/providerAccountProtocol";

const account = { id: "saved", label: "claude@example.com", selected: true, needsReauth: false };
const provider: ManagedProvider = { id: "anthropic", label: "Anthropic", authKind: "oauth", quotaMode: "probe", inferenceConnected: true, accounts: [account] };
test("reset button is Anthropic-only, expanded-only and disabled while busy or requiring login", () => {
  assert.doesNotMatch(providerAccountHtml(provider, account, undefined), /providerResetUsage/);
  assert.match(providerAccountHtml(provider, account, undefined, undefined, true), /providerResetUsage/);
  assert.match(providerAccountHtml(provider, account, undefined, undefined, true, false, true), /disabled.*aria-busy="true"/);
  assert.match(providerAccountHtml(provider, { ...account, needsReauth: true }, undefined, undefined, true), /providerResetUsage[^>]*disabled/);
  assert.doesNotMatch(providerAccountHtml({ ...provider, id: "google-antigravity" }, account, undefined, undefined, true), /providerResetUsage/);
});
test("service validates response account and outcome", async () => {
  const service = new ProviderAccountService("C:/fixture", {}, { openUrl: async () => true, prompt: async () => undefined });
  service.snapshot = { providers: [provider], availableProviders: [] };
  const internal = service as any; const calls: any[] = [];
  internal.request = async (...args: any[]) => { calls.push(args); return { providerId: "anthropic", accountId: "saved", outcome: "reset" }; };
  assert.equal(await service.resetUsage("anthropic", "saved"), "reset");
  assert.deepEqual(calls, [["resetUsage", { providerId: "anthropic", accountId: "saved" }]]);
  internal.request = async () => ({ providerId: "anthropic", accountId: "other", outcome: "reset" });
  await assert.rejects(service.resetUsage("anthropic", "saved"), /결과를 확인/);
  internal.request = async () => ({ providerId: "anthropic", accountId: "saved", outcome: "unknown" });
  await assert.rejects(service.resetUsage("anthropic", "saved"), /결과를 확인/);
  await assert.rejects(service.resetUsage("anthropic", "missing"), /Unknown/);
});
test("view suppresses duplicate requests, restores button after errors and refreshes success", async () => {
  const api = Module as any, original = api._load, notices: string[] = [];
  api._load = function(request: string, ...args: any[]) { return request === "vscode" ? { window: { showInformationMessage: (message: string) => notices.push(message) } } : original.call(this, request, ...args); };
  try {
    const { UsageView } = require("../src/usageView");
    let finish!: (value: string) => void, calls = 0, refreshes = 0;
    const backend = { enabled: true, async resetUsage() { calls++; return new Promise<string>(resolve => { finish = resolve; }); } };
    const view = new UsageView(Object.assign(new EventEmitter(), { changesEnabled: true }), {}, { dispose() {} }, backend) as any;
    view.providerSnapshot = { providers: [provider], availableProviders: [] };
    view.expanded.add(usageExpansionKey("provider", "anthropic", "saved"));
    view.render = () => {}; view.refresh = async () => { refreshes++; };
    const message = { providerId: "anthropic", accountId: "saved" };
    const pending = view.resetProviderUsage(message);
    assert.equal(view.providerResetPending.size, 1);
    await view.resetProviderUsage(message); assert.equal(calls, 1);
    finish("reset"); await pending; assert.equal(refreshes, 1); assert.equal(view.providerResetPending.size, 0);
    for (const outcome of ["noCredit", "nothingToReset", "cooldown"]) {
      const pending = view.resetProviderUsage(message); finish(outcome); await pending;
    }
    assert.equal(refreshes, 1); assert.ok(notices.some(message => message.includes("리셋이 없습니다"))); assert.ok(notices.some(message => message.includes("사용량이 없어")));
    backend.resetUsage = async () => { throw Error("transport failure"); };
    await assert.rejects(view.resetProviderUsage(message), /transport failure/); assert.equal(view.providerResetPending.size, 0);
    await view.resetProviderUsage({ ...message, accountId: "other" });
  } finally { api._load = original; }
});

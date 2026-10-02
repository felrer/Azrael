import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import Module from "node:module";
import test from "node:test";
import { usageExpansionKey } from "../src/usagePresentation";

test("ticket UI validates expanded identity, confirms account and refreshes only that profile", async () => {
  const moduleApi = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const original = moduleApi._load;
  let confirmation = "cancel";
  const messages: string[] = [];
  moduleApi._load = function (request, parent, isMain) {
    if (request === "vscode") return { window: {
      async showWarningMessage(text: string, _options: unknown, action: string) { messages.push(text); return confirmation === "accept" ? action : undefined; },
      showInformationMessage(text: string) { messages.push(text); }, showErrorMessage(text: string) { messages.push(text); },
    } };
    return original.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve("../src/usageView")];
    const { UsageView } = require("../src/usageView") as typeof import("../src/usageView");
    const profile = { id: "a".repeat(32), workspaceAccountId: "workspace", userId: "user", email: "account@example.com", planType: "pro" };
    const service = Object.assign(new EventEmitter(), {
      state: { profiles: [profile], activeProfileId: null },
      async call(params: unknown) { calls.push(params); return { resetCreditOutcome: "reset" }; },
    });
    const calls: unknown[] = [];
    const refreshes: unknown[][] = [];
    const usage = { get() { return { data: { rateLimits: { planType: "free" }, rateLimitsByLimitId: {}, rateLimitResetCredits: { availableCount: 1, credits: null } } }; }, async refresh(...args: unknown[]) { refreshes.push(args); } };
    const view = new UsageView(service as never, usage as never, { dispose() {} } as never);
    const panel = { visible: true, webview: { html: "" }, dispose() {} };
    const internal = view as unknown as { panel: unknown; expanded: Set<string>; render(): void; onMessage(message: unknown): Promise<void> };
    internal.panel = panel;
    internal.render();
    assert.doesNotMatch(panel.webview.html, /data-action="consumeResetCredit"/);
    assert.match(panel.webview.html, /account-provider">free<\/span>/);
    assert.doesNotMatch(panel.webview.html, /account-provider">pro<\/span>/);
    const request = { action: "consumeResetCredit", profileId: profile.id, workspaceAccountId: profile.workspaceAccountId };
    await internal.onMessage(request);
    assert.equal(messages.length, 0);
    internal.expanded.add(usageExpansionKey("openai", profile.id, profile.workspaceAccountId));
    internal.render();
    assert.match(panel.webview.html, /리셋 티켓 사용/);
    assert.match(panel.webview.html, /free · workspace/);
    assert.doesNotMatch(panel.webview.html, /pro · workspace/);
    await internal.onMessage({ ...request, workspaceAccountId: "other" });
    assert.equal(messages.length, 0);
    await internal.onMessage(request);
    assert.equal(calls.length, 0);
    confirmation = "accept";
    await internal.onMessage(request);
    assert.equal(calls.length, 1);
    assert.match(messages[0], /account@example.com.*workspace/);
    assert.deepEqual(refreshes, [[profile.id, profile.workspaceAccountId, false, true]]);
    view.dispose();
  } finally { moduleApi._load = original; }
});

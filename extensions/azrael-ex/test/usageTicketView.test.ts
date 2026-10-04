import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import Module from "node:module";
import test from "node:test";
import { usageExpansionKey } from "../src/usagePresentation";

test("ticket UI validates expanded identity, confirms account and refreshes only that profile", async () => {
  const moduleApi = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const original = moduleApi._load;
  let confirmation = "cancel";
  let detailsFail = false;
  let spendFail = false;
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
      async call(params: { action: string }) {
        calls.push(params);
        if (params.action === "usage" && detailsFail) throw new Error("details timeout");
        if (params.action === "consumeResetCredit" && spendFail) throw new Error("spend timeout");
        if (params.action === "usage") return { usageProfileId: profile.id, usage: {
          accountId: profile.workspaceAccountId, rateLimitsByLimitId: {}, rateLimitResetCredits: { availableCount: 1, credits: [
            { id: "earliest", resetType: "codexRateLimits", status: "available", grantedAt: 1, expiresAt: null },
          ] },
        } };
        return { resetCreditOutcome: "reset" };
      },
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
    assert.match(panel.webview.html, /account-provider"><span data-azrael-dynamic-text>free<\/span><\/span>/);
    assert.doesNotMatch(panel.webview.html, /account-provider">pro<\/span>/);
    const request = { action: "consumeResetCredit", profileId: profile.id, workspaceAccountId: profile.workspaceAccountId };
    await internal.onMessage(request);
    assert.equal(messages.length, 0);
    internal.expanded.add(usageExpansionKey("openai", profile.id, profile.workspaceAccountId));
    internal.render();
    assert.match(panel.webview.html, /리셋 티켓 사용/);
    assert.match(panel.webview.html, /free<\/span> · <span data-azrael-dynamic-text>workspace<\/span>/);
    assert.doesNotMatch(panel.webview.html, /pro · workspace/);
    await internal.onMessage({ ...request, workspaceAccountId: "other" });
    assert.equal(messages.length, 0);
    await internal.onMessage(request);
    assert.equal(calls.length, 0);
    confirmation = "accept";
    await internal.onMessage(request);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], { action: "usage", profileId: profile.id, includeDetails: true });
    assert.equal((calls[1] as { creditId: string }).creditId, "earliest");
    assert.match(messages[0], /account@example.com.*workspace/);
    assert.match(messages[0], /만료일이 가장 가까운/);
    assert.deepEqual(refreshes, [[profile.id, profile.workspaceAccountId, false, true]]);

    detailsFail = true;
    await internal.onMessage(request);
    assert.match(messages.at(-1)!, /details timeout/);
    assert.doesNotMatch(messages.at(-1)!, /사용 결과가 확인되지/);
    assert.doesNotMatch(panel.webview.html, /티켓 사용 결과 재확인/);
    assert.equal(calls.length, 3);

    detailsFail = false;
    spendFail = true;
    await internal.onMessage(request);
    assert.match(messages.at(-1)!, /사용 결과가 확인되지/);
    assert.match(panel.webview.html, /티켓 사용 결과 재확인/);
    assert.equal(calls.length, 5);
    detailsFail = true;
    spendFail = false;
    await internal.onMessage(request);
    assert.equal(calls.length, 6);
    assert.deepEqual(calls[4], calls[5]);
    assert.doesNotMatch(panel.webview.html, /티켓 사용 결과 재확인/);
    assert.equal(refreshes.length, 2);
    view.dispose();
  } finally { moduleApi._load = original; }
});

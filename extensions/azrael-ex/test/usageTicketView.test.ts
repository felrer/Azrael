import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import Module from "node:module";
import test from "node:test";
import { usageExpansionKey } from "../src/usagePresentation";

test("ticket rows confirm twice and consume exactly the selected ticket, preserving retry identity", async () => {
  const moduleApi = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const original = moduleApi._load;
  let detailsFail = false;
  let spendFail = false;
  const messages: string[] = [];
  moduleApi._load = function (request, parent, isMain) {
    if (request === "vscode") return { window: {
      showWarningMessage() { throw new Error("Ticket confirmation belongs to the row, not a modal"); },
      showInformationMessage(text: string) { messages.push(text); }, showErrorMessage(text: string) { messages.push(text); },
    } };
    return original.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve("../src/usageView")];
    const { UsageView } = require("../src/usageView") as typeof import("../src/usageView");
    const profile = { id: "a".repeat(32), workspaceAccountId: "workspace", userId: "user", email: "account@example.com", planType: "pro" };
    const credits = ["earliest", "chosen"].map((id, index) => ({ id, title: `Full reset ${id}`, description: null, resetType: "codexRateLimits", status: "available", grantedAt: 1, expiresAt: Math.floor(Date.now() / 1000) + 3600 * (index + 1) }));
    const data = { accountId: profile.workspaceAccountId, rateLimits: { planType: "free" }, rateLimitsByLimitId: {}, rateLimitResetCredits: { availableCount: 2, credits: credits as typeof credits | null } };
    const calls: Array<{ action: string; creditId?: string }> = [];
    const refreshes: unknown[][] = [];
    const service = Object.assign(new EventEmitter(), {
      changesEnabled: true, state: { profiles: [profile], activeProfileId: null },
      async call(params: { action: string; creditId?: string }) {
        calls.push(params);
        if (params.action === "usage" && detailsFail) throw new Error("details timeout");
        if (params.action === "consumeResetCredit" && spendFail) throw new Error("spend timeout");
        if (params.action === "usage") return { usageProfileId: profile.id, usage: data };
        return { resetCreditOutcome: "reset" };
      },
    });
    const usage = { get() { return { data }; }, async refresh(...args: unknown[]) { refreshes.push(args); data.rateLimitResetCredits.credits = credits; } };
    const view = new UsageView(service as never, usage as never, { dispose() {} } as never);
    const panel = { visible: true, webview: { html: "" }, dispose() {} };
    const internal = view as unknown as { panel: unknown; expanded: Set<string>; render(): void; onMessage(message: unknown): Promise<void> };
    internal.panel = panel;
    internal.render();
    const identity = { profileId: profile.id, workspaceAccountId: profile.workspaceAccountId };
    const request = { action: "consumeResetCredit", ...identity, creditId: "chosen" };
    await internal.onMessage(request);
    assert.equal(calls.length, 0);
    internal.expanded.add(usageExpansionKey("openai", profile.id, profile.workspaceAccountId));
    data.rateLimitResetCredits.credits = null;
    internal.render();
    assert.doesNotMatch(panel.webview.html, /리셋 티켓 사용|<span>리셋 티켓<\/span>/);
    assert.match(panel.webview.html, /free<\/span> · <span data-azrael-dynamic-text>workspace<\/span>/);
    await internal.onMessage({ action: "ticketDetails", ...identity, open: true });
    assert.deepEqual(refreshes, [[profile.id, profile.workspaceAccountId, true, true]]);
    assert.match(panel.webview.html, /<details class="ticket-details"[^>]* open>/);
    await internal.onMessage({ ...request, workspaceAccountId: "other" });
    await internal.onMessage({ ...request, creditId: "missing" });
    await internal.onMessage(request);
    assert.equal(calls.length, 0, "first click must not query or consume");
    assert.match(panel.webview.html, /data-credit="chosen"[^>]*>확인<\/button>/);
    await internal.onMessage({ ...request, creditId: "earliest" });
    assert.equal(calls.length, 0, "changing rows only moves confirmation");
    assert.match(panel.webview.html, /data-credit="earliest"[^>]*>확인<\/button>/);
    assert.doesNotMatch(panel.webview.html, /data-credit="chosen"[^>]*>확인<\/button>/);
    await internal.onMessage(request);
    await internal.onMessage(request);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], { action: "usage", profileId: profile.id, includeDetails: true });
    assert.equal(calls[1].creditId, "chosen", "must not use the earliest-expiring ticket");
    assert.deepEqual(refreshes[1], [profile.id, profile.workspaceAccountId, false, true]);

    detailsFail = true;
    await internal.onMessage(request);
    await internal.onMessage(request);
    assert.match(messages.at(-1)!, /details timeout/);
    assert.doesNotMatch(messages.at(-1)!, /사용 결과가 확인되지/);
    assert.doesNotMatch(panel.webview.html, />재확인<\/button>/);
    assert.equal(calls.length, 3);

    detailsFail = false;
    spendFail = true;
    await internal.onMessage(request);
    await internal.onMessage(request);
    assert.match(messages.at(-1)!, /사용 결과가 확인되지/);
    assert.match(panel.webview.html, /data-credit="chosen"[^>]*>재확인<\/button>/);
    assert.match(panel.webview.html, /data-credit="earliest"[^>]*disabled/);
    const uncertainRequest = calls[4];
    detailsFail = true;
    spendFail = false;
    await internal.onMessage({ ...request, creditId: "earliest" });
    assert.equal(calls.length, 5);
    await internal.onMessage(request);
    assert.equal(calls.length, 5);
    await internal.onMessage(request);
    assert.equal(calls.length, 6);
    assert.deepEqual(calls[5], uncertainRequest);
    assert.doesNotMatch(panel.webview.html, />재확인<\/button>/);
    assert.equal(refreshes.length, 3);

    await internal.onMessage(request);
    await internal.onMessage({ action: "ticketDetails", ...identity, open: false });
    await internal.onMessage({ action: "ticketDetails", ...identity, open: true });
    await internal.onMessage(request);
    assert.equal(calls.length, 6, "closing details cancels confirmation");
    view.dispose();
  } finally { moduleApi._load = original; }
});

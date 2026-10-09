import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import Module from "node:module";
import test from "node:test";
import { AccountService } from "../src/accountService";
import { parseProjectUsageSnapshot } from "../src/projectUsageProtocol";

const snapshot = (year: number) => ({ currency: "USD", days: [{ date: `${year}-01-01`, projects: [{ id: "a", name: "Alpha", amount: 1.5, unpriced: 2 }] }] });

test("project usage validates USD, dates, unique identities and finite nonnegative aggregates", () => {
  assert.deepEqual(parseProjectUsageSnapshot(snapshot(2026), 2026), snapshot(2026));
  for (const value of [
    { ...snapshot(2026), currency: "EUR" }, snapshot(2025),
    { currency: "USD", days: [{ date: "2026-02-30", projects: [] }] },
    { currency: "USD", days: [...snapshot(2026).days, ...snapshot(2026).days] },
    ...[NaN, Infinity, -1].map(amount => ({ currency: "USD", days: [{ date: "2026-01-01", projects: [{ id: "a", name: "A", amount, unpriced: 0 }] }] })),
    ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1].map(unpriced => ({ currency: "USD", days: [{ date: "2026-01-01", projects: [{ id: "a", name: "A", amount: 0, unpriced }] }] })),
  ]) assert.throws(() => parseProjectUsageSnapshot(value, 2026));
  for (const year of [0, 10000, 1.5]) assert.throws(() => parseProjectUsageSnapshot({ currency: "USD", days: [] }, year));
  assert.deepEqual(parseProjectUsageSnapshot({ currency: "USD", days: [{ date: "0001-01-01", projects: [] }] }, 1).days.length, 1);
});

test("account service requires identity and uses the project usage read contract", async () => {
  const service = new AccountService({} as never);
  const internals = service as unknown as { transport: unknown; transportVerified: boolean; instanceId: string };
  await assert.rejects(service.projectUsage(2026), /not been verified/);
  const calls: unknown[] = [];
  internals.transport = { request: async (...args: unknown[]) => { calls.push(args); return snapshot(2026); } };
  internals.transportVerified = true;
  internals.instanceId = "verified";
  assert.deepEqual(await service.projectUsage(2026), snapshot(2026));
  assert.deepEqual(calls, [["azrael/projectUsage", { year: 2026 }]]);
  await assert.rejects(service.projectUsage(0), /Invalid/);
  internals.transport = { request: async () => ({ currency: "EUR", days: [] }) };
  await assert.rejects(service.projectUsage(2026), /Invalid/);
  internals.transport = { request: async () => { internals.instanceId = "other"; return snapshot(2026); } };
  await assert.rejects(service.projectUsage(2026), /changed/);
});

test("usage view fetches the selected year, rejects stale results and retains same-year data on failure", async () => {
  const moduleApi = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const originalLoad = moduleApi._load;
  moduleApi._load = function (request, parent, isMain) {
    if (request === "vscode") return { window: {}, env: {}, Uri: {}, commands: {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const { UsageView } = require("../src/usageView") as typeof import("../src/usageView");
    class Service extends EventEmitter {
      state = { profiles: [] };
      calls: number[] = [];
      requests: Array<{ resolve(value: unknown): void; reject(error: Error): void }> = [];
      async refresh() { return this.state; }
      async devin() { return { enabled: false, loggedIn: false }; }
      projectUsage(year: number) { this.calls.push(year); return new Promise((resolve, reject) => this.requests.push({ resolve, reject })); }
    }
    const service = new Service();
    const originalDate = global.Date;
    let view: InstanceType<typeof UsageView>;
    try {
      global.Date = class extends originalDate {
        constructor() { super("2026-12-31T15:30:00Z"); }
      } as DateConstructor;
      view = new UsageView(service as never, { dueResetProfiles: () => [], get: () => undefined } as never,
        { dispose() {}, cancelRefresh() {} } as never);
    } finally { global.Date = originalDate; }
    const panel = { visible: true, webview: { html: "" }, dispose() {} };
    const internal = view as unknown as { panel: unknown; costMonth: string; costSnapshot: unknown; costError: boolean; refresh(): Promise<void>; refreshProjectUsage(): Promise<void>; onMessage(value: unknown): Promise<void>; visibility(): void; render(): void };
    assert.equal(internal.costMonth, "2027-01", "initial month follows the Seoul year boundary");
    internal.panel = panel;
    internal.costMonth = "2026-01";
    const first = internal.refresh();
    await internal.onMessage({ action: "costMonth", month: "2027-02" });
    service.requests[0].resolve(snapshot(2026));
    await first;
    assert.equal(internal.costSnapshot, undefined);
    assert.deepEqual(service.calls, [2026, 2027]);
    service.requests[1].resolve(snapshot(2027));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(internal.costSnapshot, snapshot(2027));
    const sameYear = internal.refreshProjectUsage();
    service.requests[2].reject(new Error("transient"));
    await sameYear;
    assert.deepEqual(internal.costSnapshot, snapshot(2027));
    assert.equal(internal.costError, true);
    assert.match(panel.webview.html, /이전 조회 값/);
    await internal.onMessage({ action: "costMonth", month: "2027-03" });
    assert.equal(service.calls.length, 3);
    assert.equal(internal.costMonth, "2027-03");
    assert.match(panel.webview.html, /month:b.dataset.month/);
    await internal.onMessage({ action: "costMonth", month: "2027-13" });
    assert.equal(internal.costMonth, "2027-03");
    const pending = internal.refreshProjectUsage();
    panel.visible = false;
    internal.visibility();
    service.requests[3].resolve(snapshot(2027));
    await pending;
    assert.equal(internal.costError, true);
    await internal.refresh();
    await internal.onMessage({ action: "costMonth", month: "2028-01" });
    assert.equal(service.calls.length, 4);
    assert.equal(internal.costMonth, "2027-03");
    panel.visible = true;
    await internal.onMessage({ action: "costMonth", month: "2026-12" });
    assert.deepEqual(service.calls, [2026, 2027, 2027, 2027, 2026]);
    assert.match(panel.webview.html, /data-month="2027-01"/);
    assert.doesNotMatch(panel.webview.html, /<div class="puc-calendar-scroll"/);
    service.requests[4].reject(new Error("unavailable"));
    await new Promise(resolve => setImmediate(resolve));
    assert.match(panel.webview.html, /조회 실패/);
    await internal.onMessage({ action: "costMonth", month: "2027-01" });
    assert.deepEqual(internal.costSnapshot, snapshot(2027));
    service.requests[5].reject(new Error("transient"));
    await new Promise(resolve => setImmediate(resolve));
    assert.match(panel.webview.html, /이전 조회 값/);
    view.dispose();
  } finally { moduleApi._load = originalLoad; }
});

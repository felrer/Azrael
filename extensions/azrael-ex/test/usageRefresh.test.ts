import assert from "node:assert/strict";
import test from "node:test";
import { AccountUsage } from "../src/protocol";
import { UsageRefreshCoordinator, validateUsageForWorkspace } from "../src/usageRefresh";

function usage(reset: number | null = null, tickets: number | null = null): AccountUsage {
  return {
    ordinaryUsageAllowed: null,
    rateLimits: {
      limitId: "codex", limitName: "Codex", normalModelSlug: null,
      primary: { usedPercent: 0, windowDurationMins: null, resetsAt: reset },
      secondary: null, credits: null, individualLimit: null,
      spendControlReached: null, planType: null, rateLimitReachedType: null
    },
    rateLimitsByLimitId: null,
    rateLimitResetCredits: tickets === null ? null : { availableCount: tickets, credits: null },
    accountId: null,
    rateLimitUpsell: null
  };
}

test("a stale generation cannot overwrite a newer usage result", async () => {
  const resolvers: Array<(value: AccountUsage) => void> = [];
  const coordinator = new UsageRefreshCoordinator(() => new Promise((resolve) => resolvers.push(resolve)));
  const oldRefresh = coordinator.refresh("p1", "w1", false, true);
  const newRefresh = coordinator.refresh("p1", "w1", false, true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  resolvers[1](usage(null, 0));
  await newRefresh;
  resolvers[0](usage(null, 5));
  await oldRefresh;
  assert.equal(coordinator.get("p1", "w1")?.data?.rateLimitResetCredits?.availableCount, 0);
});

test("failure preserves last success and records stale error", async () => {
  let fail = false;
  let now = 1000;
  const coordinator = new UsageRefreshCoordinator(async () => {
    if (fail) throw new Error("offline");
    return usage(null, 0);
  }, () => now);
  await coordinator.refresh("p1", "w1", false, true);
  fail = true;
  now = 2000;
  await coordinator.refresh("p1", "w1", false, true);
  assert.equal(coordinator.get("p1", "w1")?.lastSuccessAt, 1000);
  assert.equal(coordinator.get("p1", "w1")?.data?.rateLimitResetCredits?.availableCount, 0);
  assert.equal(coordinator.get("p1", "w1")?.error, "offline");
});

test("null and zero tickets remain distinct", async () => {
  const coordinator = new UsageRefreshCoordinator(async (id) => usage(null, id === "zero" ? 0 : null));
  await Promise.all([coordinator.refresh("zero", "w1"), coordinator.refresh("null", "w2")]);
  assert.equal(coordinator.get("zero", "w1")?.data?.rateLimitResetCredits?.availableCount, 0);
  assert.equal(coordinator.get("null", "w2")?.data?.rateLimitResetCredits, null);
});

test("a passed server reset schedules one requery without inferring refill", async () => {
  let now = 10_000;
  const coordinator = new UsageRefreshCoordinator(async () => usage(9, 0), () => now);
  await coordinator.refresh("p1", "w1");
  const identity = { profileId: "p1", workspaceAccountId: "w1" };
  assert.deepEqual(coordinator.dueResetProfiles([identity]), [identity]);
  assert.deepEqual(coordinator.dueResetProfiles([identity]), []);
  assert.equal(coordinator.get("p1", "w1")?.data?.rateLimitResetCredits?.availableCount, 0);
});

test("usage identity rejects a different workspace and mismatched limit key", () => {
  const wrongWorkspace = usage();
  wrongWorkspace.accountId = "other";
  assert.throws(() => validateUsageForWorkspace(wrongWorkspace, "workspace"), /different workspace/);
  const wrongLimit = usage();
  wrongLimit.rateLimitsByLimitId = { alternate: wrongLimit.rateLimits };
  assert.throws(() => validateUsageForWorkspace(wrongLimit, "workspace"), /limit identity/);
});

test("a backed-off periodic refresh does not invalidate an in-flight forced result", async () => {
  let now = 1_000;
  let calls = 0;
  let resolveForced: ((value: AccountUsage) => void) | undefined;
  const coordinator = new UsageRefreshCoordinator(async () => {
    calls++;
    if (calls === 1) throw new Error("offline");
    return new Promise<AccountUsage>((resolve) => { resolveForced = resolve; });
  }, () => now);
  await coordinator.refresh("p1", "w1", false, true);
  const forced = coordinator.refresh("p1", "w1", false, true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const backedOff = await coordinator.refresh("p1", "w1");
  assert.equal(backedOff.error, "offline");
  assert.equal(calls, 2);
  resolveForced!(usage(null, 7));
  await forced;
  assert.equal(coordinator.get("p1", "w1")?.data?.rateLimitResetCredits?.availableCount, 7);
});

test("background refresh retains the requested ticket-detail level", async () => {
  const requested: boolean[] = [];
  const coordinator = new UsageRefreshCoordinator(async (_profile, _workspace, includeDetails) => {
    requested.push(includeDetails);
    const result = usage(null, 1);
    result.rateLimitResetCredits!.credits = includeDetails ? [{
      id: "ticket", resetType: "codex_rate_limits", status: "available",
      grantedAt: 1, expiresAt: null, title: "Ticket", description: null
    }] : null;
    return result;
  });
  await coordinator.refresh("p1", "w1", true, true);
  await coordinator.refresh("p1", "w1");
  assert.deepEqual(requested, [true, true]);
  assert.equal(coordinator.get("p1", "w1")?.data?.rateLimitResetCredits?.credits?.[0]?.title, "Ticket");
});

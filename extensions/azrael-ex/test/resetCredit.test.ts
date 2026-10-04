import assert from "node:assert/strict";
import test from "node:test";
import { AccountParams, AccountProfile, AccountUsage, parseAccountResponse } from "../src/protocol";
import { earliestExpiringResetCredit, ResetCreditService } from "../src/resetCredit";

const profile: AccountProfile = { id: "a".repeat(32), workspaceAccountId: "workspace", userId: "user", email: "account@example.com", planType: "plus" };
const expiresAt = Math.floor(Date.now() / 1000) + 3600;
function credit(id = "soon", expires: number | null = expiresAt, grantedAt = 1) {
  return { id, expiresAt: expires, grantedAt, resetType: "codexRateLimits", status: "available", title: null, description: null };
}
function usageResponse(credits = [credit()], account = profile) {
  return { usageProfileId: account.id, usage: { accountId: account.workspaceAccountId, rateLimitsByLimitId: null,
    rateLimitResetCredits: { availableCount: credits.length, credits } } as AccountUsage };
}
function withUsage(call: (params: AccountParams) => Promise<unknown>, account = profile) {
  return { state: { profiles: [account] }, async call(params: AccountParams) {
    return params.action === "usage" ? usageResponse([credit()], account) : call(params);
  } };
}
function storage() {
  const values = new Map<string, unknown>();
  return { get: (key: string) => values.get(key), async update(key: string, value: unknown) { values.set(key, structuredClone(value)); } };
}

test("uncertain consumption retains its request identity across restart, terminal outcome clears it", async () => {
  const saved = storage();
  const calls: AccountParams[] = [];
  let fail = true;
  let selectedCredits = [credit("later", expiresAt + 3600), credit(), credit("no-expiry", null)];
  let queries = 0;
  const service = { state: { profiles: [profile] }, async call(params: AccountParams) {
    if (params.action === "usage") {
      ++queries;
      assert.deepEqual(params, { action: "usage", profileId: profile.id, includeDetails: true });
      return usageResponse(selectedCredits);
    }
    calls.push(params);
    if (fail) throw new Error("timeout");
    return { resetCreditOutcome: "alreadyRedeemed" };
  } };
  let tickets = new ResetCreditService(service as never, saved as never);
  await assert.rejects(tickets.consume(profile), /timeout/);
  assert.equal(tickets.busy(profile), false);
  tickets = new ResetCreditService(service as never, saved as never);
  assert.equal(tickets.retrying(profile), true);
  selectedCredits = [credit("new-earliest", expiresAt - 60)];
  fail = false;
  assert.equal(await tickets.consume(profile), "alreadyRedeemed");
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[1].creditId, "soon");
  assert.equal(queries, 1);
  assert.equal(calls[1].profileId, profile.id);
  assert.equal(tickets.retrying(profile), false);
  await tickets.consume(profile);
  assert.notEqual(calls[1].idempotencyKey, calls[2].idempotencyKey);
  assert.equal(calls[2].creditId, "new-earliest");
  assert.equal(queries, 2);
});

test("concurrent duplicate clicks send only one request", async () => {
  let resolve!: (value: unknown) => void;
  let calls = 0;
  const service = withUsage(async () => { ++calls; return new Promise(done => { resolve = done; }); });
  const tickets = new ResetCreditService(service as never, storage() as never);
  const first = tickets.consume(profile);
  await new Promise(done => setImmediate(done));
  await assert.rejects(tickets.consume(profile), /이미 진행/);
  resolve({ resetCreditOutcome: "reset" });
  await first;
  assert.equal(calls, 1);
});

test("storage failure prevents dispatch; profiles and workspaces have separate attempt identities", async () => {
  let calls = 0;
  const service = withUsage(async () => { ++calls; throw new Error("uncertain"); });
  const brokenStorage = { get() {}, async update() { throw new Error("disk failure"); } };
  await assert.rejects(new ResetCreditService(service as never, brokenStorage as never).consume(profile), /disk failure/);
  assert.equal(calls, 0);
  const saved = storage();
  const ids: string[] = [];
  const identities = withUsage(async params => { ids.push(params.idempotencyKey!); throw new Error("uncertain"); });
  const tickets = new ResetCreditService(identities as never, saved as never);
  await assert.rejects(tickets.consume(profile));
  identities.state.profiles[0] = { ...profile, workspaceAccountId: "other" };
  const other = identities.state.profiles[0];
  identities.call = async params => {
    if (params.action === "usage") return usageResponse([credit()], other);
    ids.push(params.idempotencyKey!); throw new Error("uncertain");
  };
  await assert.rejects(tickets.consume(other));
  assert.notEqual(ids[0], ids[1]);
});

test("account protocol rejects unrecognized reset results", () => {
  const envelope = {
    state: { instanceId: "instance", revision: 0, codexHome: "home", profiles: [profile], activeProfileId: null, pendingProfileId: null },
    usageProfileId: null, resetCreditOutcome: "reset",
  };
  assert.equal(parseAccountResponse(envelope).resetCreditOutcome, "reset");
  assert.throws(() => parseAccountResponse({ ...envelope, resetCreditOutcome: "unknown" }), /reset credit outcome/);
});

test("failed terminal cleanup retains a safe replay identity without hiding confirmed success", async () => {
  const saved = storage();
  const originalUpdate = saved.update;
  let writes = 0;
  saved.update = async (key, value) => {
    if (++writes === 2) throw new Error("cleanup failed");
    await originalUpdate(key, value);
  };
  const calls: AccountParams[] = [];
  const service = withUsage(async params => { calls.push(params); return { resetCreditOutcome: "reset" }; });
  const tickets = new ResetCreditService(service as never, saved as never);
  assert.equal(await tickets.consume(profile), "reset");
  assert.equal(tickets.retrying(profile), true);
  await tickets.consume(profile);
  assert.deepEqual(calls[0], calls[1]);
});

test("selection orders expiration, grant time and ID without mutating details", () => {
  const credits = [credit("no-expiry", null, 0), credit("later", 300), credit("b", 200, 2), credit("a", 200, 2), credit("oldest", 200, 1)];
  const original = structuredClone(credits);
  assert.equal(earliestExpiringResetCredit(credits, 100)?.id, "oldest");
  assert.equal(earliestExpiringResetCredit(credits.slice(0, 4), 100)?.id, "a");
  assert.equal(earliestExpiringResetCredit([...credits].reverse(), 100)?.id, "oldest");
  assert.deepEqual(credits, original);
  assert.equal(earliestExpiringResetCredit([credit("permanent", null)], 100)?.id, "permanent");
});

test("selection excludes expired, ineligible and malformed tickets", () => {
  const invalid = [credit("expired", 99), credit("expires-now", 100), credit("invalid-expiry", NaN),
    credit("fractional-expiry", 200.5), credit("invalid-grant", 200, NaN), credit(" ", 200),
    { ...credit(), status: "redeeming" }, { ...credit(), status: "redeemed" }, { ...credit(), status: "unknown" },
    { ...credit(), resetType: "unknown" }];
  assert.equal(earliestExpiringResetCredit(invalid, 100), undefined);
  assert.equal(earliestExpiringResetCredit([...invalid, credit("eligible", 200)], 100)?.id, "eligible");
});

test("failed or missing details never spend or create an uncertain attempt", async () => {
  for (const response of [new Error("details timeout"), { usageProfileId: profile.id, usage: null },
    { ...usageResponse(), usage: { ...usageResponse().usage, rateLimitResetCredits: { availableCount: 1, credits: null } } }]) {
    const calls: AccountParams[] = [];
    const service = { state: { profiles: [profile] }, async call(params: AccountParams) {
      calls.push(params);
      if (response instanceof Error) throw response;
      return response;
    } };
    const tickets = new ResetCreditService(service as never, storage() as never);
    await assert.rejects(tickets.consume(profile));
    assert.deepEqual(calls.map(call => call.action), ["usage"]);
    assert.equal(tickets.retrying(profile), false);
  }
});

test("no eligible ticket or zero available count returns noCredit without a spend", async () => {
  for (const details of [{ availableCount: 1, credits: [credit("expired", 1)] }, { availableCount: 0, credits: [credit()] }]) {
    const calls: AccountParams[] = [];
    const service = { state: { profiles: [profile] }, async call(params: AccountParams) {
      calls.push(params);
      return { ...usageResponse(), usage: { ...usageResponse().usage, rateLimitResetCredits: details } };
    } };
    const tickets = new ResetCreditService(service as never, storage() as never);
    assert.equal(await tickets.consume(profile), "noCredit");
    assert.deepEqual(calls.map(call => call.action), ["usage"]);
    assert.equal(tickets.retrying(profile), false);
  }
});

test("changed profile and mismatched usage identities cannot spend", async () => {
  for (const mismatch of ["profile", "workspace", "user", "removed"]) {
    const calls: AccountParams[] = [];
    const service = { state: { profiles: [profile] }, async call(params: AccountParams) {
      calls.push(params);
      if (mismatch === "user") service.state.profiles = [{ ...profile, userId: "other" }];
      if (mismatch === "removed") service.state.profiles = [];
      const response = usageResponse();
      if (mismatch === "profile") response.usageProfileId = "b".repeat(32);
      if (mismatch === "workspace") response.usage.accountId = "other";
      return response;
    } };
    await assert.rejects(new ResetCreditService(service as never, storage() as never).consume(profile));
    assert.deepEqual(calls.map(call => call.action), ["usage"]);
  }
});

test("legacy uncertain attempts replay the exact original request without selecting a ticket", async () => {
  const saved = storage();
  const id = "a5b0b1b5-9bf1-4b01-8f02-781cf6d40539";
  await saved.update("azrael.usage.resetCreditAttempts", [{ identity: JSON.stringify([profile.id, profile.workspaceAccountId]), id }]);
  const calls: AccountParams[] = [];
  const service = withUsage(async params => { calls.push(params); return { resetCreditOutcome: "alreadyRedeemed" }; });
  const tickets = new ResetCreditService(service as never, saved as never);
  assert.equal(await tickets.consume(profile), "alreadyRedeemed");
  assert.deepEqual(calls, [{ action: "consumeResetCredit", profileId: profile.id, idempotencyKey: id }]);
  await tickets.consume(profile);
  assert.equal(calls[1].creditId, "soon");
  assert.notEqual(calls[1].idempotencyKey, id);
});

test("missing outcome retains both IDs and a confirmed noCredit settles that attempt", async () => {
  const saved = storage();
  const calls: AccountParams[] = [];
  let confirmed = false;
  const service = withUsage(async params => {
    calls.push(params);
    return confirmed ? { resetCreditOutcome: "noCredit" } : {};
  });
  const first = new ResetCreditService(service as never, saved as never);
  await assert.rejects(first.consume(profile), /결과/);
  const restarted = new ResetCreditService(service as never, saved as never);
  confirmed = true;
  assert.equal(await restarted.consume(profile), "noCredit");
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(restarted.retrying(profile), false);
});

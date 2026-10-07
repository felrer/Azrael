import assert from "node:assert/strict";
import test from "node:test";
import { AccountParams, AccountProfile, AccountUsage, parseAccountResponse } from "../src/protocol";
import { ResetCreditService } from "../src/resetCredit";

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
  await assert.rejects(tickets.consume(profile, "soon"), /timeout/);
  assert.equal(tickets.busy(profile), false);
  tickets = new ResetCreditService(service as never, saved as never);
  assert.equal(tickets.retrying(profile), true);
  assert.equal(tickets.retryCreditId(profile), "soon");
  await assert.rejects(tickets.consume(profile, "later"), /다른 리셋 티켓/);
  assert.equal(calls.length, 1);
  assert.equal(queries, 1);
  selectedCredits = [credit("new-earliest", expiresAt - 60)];
  fail = false;
  assert.equal(await tickets.consume(profile, "soon"), "alreadyRedeemed");
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[1].creditId, "soon");
  assert.equal(queries, 1);
  assert.equal(calls[1].profileId, profile.id);
  assert.equal(tickets.retrying(profile), false);
  assert.equal(tickets.retryCreditId(profile), undefined);
  await tickets.consume(profile, "new-earliest");
  assert.notEqual(calls[1].idempotencyKey, calls[2].idempotencyKey);
  assert.equal(calls[2].creditId, "new-earliest");
  assert.equal(queries, 2);
});

test("concurrent duplicate clicks send only one request", async () => {
  let resolve!: (value: unknown) => void;
  let calls = 0;
  const service = withUsage(async () => { ++calls; return new Promise(done => { resolve = done; }); });
  const tickets = new ResetCreditService(service as never, storage() as never);
  const first = tickets.consume(profile, "soon");
  await new Promise(done => setImmediate(done));
  await assert.rejects(tickets.consume(profile, "soon"), /이미 진행/);
  resolve({ resetCreditOutcome: "reset" });
  await first;
  assert.equal(calls, 1);
});

test("storage failure prevents dispatch; profiles and workspaces have separate attempt identities", async () => {
  let calls = 0;
  const service = withUsage(async () => { ++calls; throw new Error("uncertain"); });
  const brokenStorage = { get() {}, async update() { throw new Error("disk failure"); } };
  await assert.rejects(new ResetCreditService(service as never, brokenStorage as never).consume(profile, "soon"), /disk failure/);
  assert.equal(calls, 0);
  const saved = storage();
  const ids: string[] = [];
  const identities = withUsage(async params => { ids.push(params.idempotencyKey!); throw new Error("uncertain"); });
  const tickets = new ResetCreditService(identities as never, saved as never);
  await assert.rejects(tickets.consume(profile, "soon"));
  identities.state.profiles[0] = { ...profile, workspaceAccountId: "other" };
  const other = identities.state.profiles[0];
  identities.call = async params => {
    if (params.action === "usage") return usageResponse([credit()], other);
    ids.push(params.idempotencyKey!); throw new Error("uncertain");
  };
  await assert.rejects(tickets.consume(other, "soon"));
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
  assert.equal(await tickets.consume(profile, "soon"), "reset");
  assert.equal(tickets.retrying(profile), true);
  await tickets.consume(profile, "soon");
  assert.deepEqual(calls[0], calls[1]);
});

test("explicit selection consumes the chosen later or nonexpiring ticket without mutating details", async () => {
  const credits = [credit(), credit("later", expiresAt + 3600), credit("no-expiry", null)];
  const original = structuredClone(credits);
  const calls: AccountParams[] = [];
  const service = { state: { profiles: [profile] }, async call(params: AccountParams) {
    calls.push(params);
    return params.action === "usage" ? usageResponse(credits) : { resetCreditOutcome: "reset" };
  } };
  const tickets = new ResetCreditService(service as never, storage() as never);
  for (const id of ["later", "no-expiry"]) {
    assert.equal(await tickets.consume(profile, id), "reset");
    assert.equal(calls.at(-1)?.creditId, id);
    assert.deepEqual(calls.at(-2), { action: "usage", profileId: profile.id, includeDetails: true });
  }
  assert.deepEqual(credits, original);
});

test("selected expired, ineligible or malformed tickets never fall back to another eligible ticket", async () => {
  const invalid = [credit("expired", 99), credit("expires-now", Math.floor(Date.now() / 1000)), credit("invalid-expiry", NaN),
    credit("fractional-expiry", expiresAt + 0.5), credit("invalid-grant", expiresAt, NaN),
    { ...credit(), status: "redeeming" }, { ...credit(), status: "redeemed" }, { ...credit(), status: "unknown" },
    { ...credit(), resetType: "unknown" }];
  for (const selected of [...invalid, credit("missing")]) {
    const calls: AccountParams[] = [];
    const service = { state: { profiles: [profile] }, async call(params: AccountParams) {
      calls.push(params);
      return usageResponse([...(selected.id === "missing" ? [] : [selected]), credit("eligible")]);
    } };
    const tickets = new ResetCreditService(service as never, storage() as never);
    assert.equal(await tickets.consume(profile, selected.id), "noCredit");
    assert.deepEqual(calls.map(call => call.action), ["usage"]);
    assert.equal(tickets.retrying(profile), false);
  }
});

test("failed or missing details never spend or create an uncertain attempt", async () => {
  for (const response of [new Error("details timeout"), { usageProfileId: profile.id, usage: null },
    ...[null, undefined, "invalid"].map(credits => ({ ...usageResponse(), usage: {
      ...usageResponse().usage, rateLimitResetCredits: { availableCount: 1, credits } } })),
    { ...usageResponse(), usage: { ...usageResponse().usage, rateLimitResetCredits: { availableCount: NaN, credits: [credit()] } } }]) {
    const calls: AccountParams[] = [];
    const service = { state: { profiles: [profile] }, async call(params: AccountParams) {
      calls.push(params);
      if (response instanceof Error) throw response;
      return response;
    } };
    const tickets = new ResetCreditService(service as never, storage() as never);
    await assert.rejects(tickets.consume(profile, "soon"));
    assert.deepEqual(calls.map(call => call.action), ["usage"]);
    assert.equal(tickets.retrying(profile), false);
  }
});

test("empty ticket IDs and duplicate selected details fail without spending", async () => {
  const calls: AccountParams[] = [];
  const service = { state: { profiles: [profile] }, async call(params: AccountParams) {
    calls.push(params);
    return usageResponse([credit(), credit(), credit("other")]);
  } };
  const tickets = new ResetCreditService(service as never, storage() as never);
  for (const id of ["", " ", undefined, null]) {
    await assert.rejects(tickets.consume(profile, id as string), /티켓 ID/);
  }
  assert.equal(calls.length, 0);
  await assert.rejects(tickets.consume(profile, "soon"), /중복/);
  assert.deepEqual(calls.map(call => call.action), ["usage"]);
  assert.equal(tickets.retrying(profile), false);
});

test("no eligible ticket or zero available count returns noCredit without a spend", async () => {
  for (const details of [{ availableCount: 1, credits: [credit("expired", 1)] }, { availableCount: 0, credits: [credit()] }]) {
    const calls: AccountParams[] = [];
    const service = { state: { profiles: [profile] }, async call(params: AccountParams) {
      calls.push(params);
      return { ...usageResponse(), usage: { ...usageResponse().usage, rateLimitResetCredits: details } };
    } };
    const tickets = new ResetCreditService(service as never, storage() as never);
    assert.equal(await tickets.consume(profile, "soon"), "noCredit");
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
    await assert.rejects(new ResetCreditService(service as never, storage() as never).consume(profile, "soon"));
    assert.deepEqual(calls.map(call => call.action), ["usage"]);
  }
});

test("legacy uncertain attempts with unknown ticket identity reject new selection without dispatch", async () => {
  const saved = storage();
  const id = "a5b0b1b5-9bf1-4b01-8f02-781cf6d40539";
  await saved.update("azrael.usage.resetCreditAttempts", [{ identity: JSON.stringify([profile.id, profile.workspaceAccountId]), id }]);
  const calls: AccountParams[] = [];
  const service = { state: { profiles: [profile] }, async call(params: AccountParams) { calls.push(params); return {}; } };
  const tickets = new ResetCreditService(service as never, saved as never);
  await assert.rejects(tickets.consume(profile, "soon"), /대상 ID/);
  assert.equal(calls.length, 0);
  assert.equal(tickets.retrying(profile), true);
  assert.equal(tickets.retryCreditId(profile), undefined);
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
  await assert.rejects(first.consume(profile, "soon"), /결과/);
  const restarted = new ResetCreditService(service as never, saved as never);
  confirmed = true;
  assert.equal(await restarted.consume(profile, "soon"), "noCredit");
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(restarted.retrying(profile), false);
});

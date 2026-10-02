import assert from "node:assert/strict";
import test from "node:test";
import { AccountParams, AccountProfile, parseAccountResponse } from "../src/protocol";
import { ResetCreditService } from "../src/resetCredit";

const profile: AccountProfile = { id: "a".repeat(32), workspaceAccountId: "workspace", userId: "user", email: "account@example.com", planType: "plus" };
function storage() {
  const values = new Map<string, unknown>();
  return { get: (key: string) => values.get(key), async update(key: string, value: unknown) { values.set(key, structuredClone(value)); } };
}

test("uncertain consumption retains its request identity across restart, terminal outcome clears it", async () => {
  const saved = storage();
  const calls: AccountParams[] = [];
  let fail = true;
  const service = { async call(params: AccountParams) {
    calls.push(params);
    if (fail) throw new Error("timeout");
    return { resetCreditOutcome: "alreadyRedeemed" };
  } };
  let tickets = new ResetCreditService(service as never, saved as never);
  await assert.rejects(tickets.consume(profile), /timeout/);
  assert.equal(tickets.busy(profile), false);
  tickets = new ResetCreditService(service as never, saved as never);
  assert.equal(tickets.retrying(profile), true);
  fail = false;
  assert.equal(await tickets.consume(profile), "alreadyRedeemed");
  assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey);
  assert.equal(calls[1].profileId, profile.id);
  assert.equal(tickets.retrying(profile), false);
  await tickets.consume(profile);
  assert.notEqual(calls[1].idempotencyKey, calls[2].idempotencyKey);
});

test("concurrent duplicate clicks send only one request", async () => {
  let resolve!: (value: unknown) => void;
  let calls = 0;
  const service = { call() { ++calls; return new Promise(done => { resolve = done; }); } };
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
  const service = { async call() { ++calls; throw new Error("uncertain"); } };
  const brokenStorage = { get() {}, async update() { throw new Error("disk failure"); } };
  await assert.rejects(new ResetCreditService(service as never, brokenStorage as never).consume(profile), /disk failure/);
  assert.equal(calls, 0);
  const saved = storage();
  const ids: string[] = [];
  const identities = { async call(params: AccountParams) { ids.push(params.idempotencyKey!); throw new Error("uncertain"); } };
  const tickets = new ResetCreditService(identities as never, saved as never);
  await assert.rejects(tickets.consume(profile));
  await assert.rejects(tickets.consume({ ...profile, workspaceAccountId: "other" }));
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
  const service = { async call(params: AccountParams) { calls.push(params); return { resetCreditOutcome: "reset" }; } };
  const tickets = new ResetCreditService(service as never, saved as never);
  assert.equal(await tickets.consume(profile), "reset");
  assert.equal(tickets.retrying(profile), true);
  await tickets.consume(profile);
  assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey);
});

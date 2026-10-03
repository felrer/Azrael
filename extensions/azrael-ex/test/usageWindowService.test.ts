import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { UsageWindowService } from "../src/usageWindowService";
import { parseAccountResponse, accountStateChanged } from "../src/protocol";
import type { AccountParams, AccountResponse, AccountState, UsageWindowSchedule } from "../src/protocol";

const profile = { id: "a".repeat(32), workspaceAccountId: "workspace", userId: "user", email: null, planType: null };
const alias = { ...profile, id: "b".repeat(32) };
const state: AccountState = { instanceId: "engine", revision: 0, codexHome: "home", profiles: [profile, alias], currentAccount: null, activeProfileId: null, pendingProfileId: null, isSwitching: false, hasActiveTurns: false, loginPending: false, lastError: null };
function schedule(enabled = false): UsageWindowSchedule {
  return { profileId: profile.id, workspaceAccountId: profile.workspaceAccountId, userId: profile.userId, enabled, nextRunAt: 100, basisResetAt: 99, lastAttemptAt: null, status: enabled ? "scheduled" : "disabled", error: null };
}
class Backend extends EventEmitter {
  state = state;
  changesEnabled = true;
  calls: AccountParams[] = [];
  result = [schedule()];
  handler?: (params: AccountParams) => Promise<AccountResponse>;
  async call(params: AccountParams): Promise<AccountResponse> {
    this.calls.push(params);
    return this.handler ? this.handler(params) : this.response();
  }
  response(): AccountResponse { return { state: this.state, usage: null, login: null, usageProfileId: null, autoWindows: this.result }; }
}

test("coalesces local status calls and serializes toggles without overlapping a tick", async () => {
  const backend = new Backend();
  let release!: () => void;
  let active = 0;
  let peak = 0;
  backend.handler = async params => {
    ++active;
    peak = Math.max(peak, active);
    if (params.action === "autoWindowStatus") await new Promise<void>(resolve => { release = resolve; });
    if (params.action === "autoWindowEnable") backend.result = [schedule(true)];
    --active;
    return backend.response();
  };
  const service = new UsageWindowService(backend);
  try {
    const first = service.refresh();
    assert.equal(first, service.refresh());
    const toggle = service.setEnabled(alias.id, alias.workspaceAccountId, true);
    await new Promise<void>(resolve => setImmediate(resolve));
    await service.poll();
    assert.equal(backend.calls.length, 1);
    release();
    await Promise.all([first, toggle]);
    await service.poll();
    assert.equal(backend.calls.at(-1)?.action, "autoWindowTick");
    assert.equal(peak, 1);
    assert.equal(service.forProfile(alias)?.enabled, true);
  } finally { service.dispose(); }
});

test("discovers a shared enabled schedule after four cycles while locally disabled", async () => {
  const backend = new Backend();
  const service = new UsageWindowService(backend);
  try {
    await service.refresh();
    backend.calls = [];
    backend.result = [schedule(true)];
    for (let cycle = 0; cycle < 4; ++cycle) await service.poll();
    assert.deepEqual(backend.calls.map(item => item.action), ["autoWindowStatus", "autoWindowTick"]);
  } finally { service.dispose(); }
});

test("opposite queued toggles preserve the final user choice", async () => {
  const backend = new Backend();
  const service = new UsageWindowService(backend);
  try {
    await service.refresh();
    backend.handler = async params => {
      backend.result = [schedule(params.action === "autoWindowEnable")];
      return backend.response();
    };
    await Promise.all([
      service.setEnabled(profile.id, profile.workspaceAccountId, true),
      service.setEnabled(profile.id, profile.workspaceAccountId, false),
      service.setEnabled(profile.id, profile.workspaceAccountId, true),
    ]);
    assert.deepEqual(backend.calls.slice(1).map(item => item.action), ["autoWindowEnable", "autoWindowDisable", "autoWindowEnable"]);
    assert.equal(service.forProfile(profile)?.enabled, true);
  } finally { service.dispose(); }
});

test("retains last schedules and safe error on failure or mismatched toggle identity", async () => {
  const backend = new Backend();
  const service = new UsageWindowService(backend);
  try {
    await service.refresh();
    const last = service.schedules;
    backend.handler = async () => { throw new Error("Bearer secret-token"); };
    await service.refresh();
    assert.equal(service.schedules, last);
    assert.ok(service.error);
    assert.ok(!service.error.includes("secret-token"));
    backend.handler = undefined;
    backend.result = [{ ...schedule(true), userId: "different-user" }];
    await service.setEnabled(profile.id, profile.workspaceAccountId, true);
    assert.equal(service.schedules, last);
    assert.ok(service.error);
    const count = backend.calls.length;
    await service.setEnabled(profile.id, "different-workspace", true);
    assert.equal(backend.calls.length, count);
  } finally { service.dispose(); }
});

test("disposal removes subscription, suppresses in-flight response and prevents new calls", async () => {
  const backend = new Backend();
  let release!: () => void;
  backend.handler = async () => { await new Promise<void>(resolve => { release = resolve; }); return backend.response(); };
  const service = new UsageWindowService(backend);
  const pending = service.refresh();
  await new Promise<void>(resolve => setImmediate(resolve));
  service.dispose();
  release();
  await pending;
  await service.poll();
  await service.refresh();
  assert.equal(backend.listenerCount("state"), 0);
  assert.equal(backend.calls.length, 1);
  assert.deepEqual(service.schedules, []);
});

test("starts only with a verified live account state", async () => {
  const backend = new Backend();
  backend.changesEnabled = false;
  const service = new UsageWindowService(backend);
  try {
    await service.poll();
    assert.equal(backend.calls.length, 0);
    backend.changesEnabled = true;
    backend.emit("state");
    await service.refresh();
    assert.equal(backend.calls.length, 1);
  } finally { service.dispose(); }
});

test("protocol validates schedule timestamps and rejects duplicate account identities", () => {
  const backend = new Backend();
  assert.equal(parseAccountResponse(backend.response()).autoWindows?.[0].nextRunAt, 100);
  backend.result = [{ ...schedule(), nextRunAt: Number.NaN }];
  assert.throws(() => parseAccountResponse(backend.response()), /invalid automatic/);
  for (const invalid of [1.5, Number.MAX_SAFE_INTEGER + 1, -1]) {
    backend.result = [{ ...schedule(), nextRunAt: invalid }];
    assert.throws(() => parseAccountResponse(backend.response()), /invalid automatic/);
  }
  backend.result = [schedule(), { ...schedule(), profileId: alias.id }];
  assert.throws(() => parseAccountResponse(backend.response()), /duplicate automatic/);
});

test("ordinary responses preserve null and absent automatic schedules", () => {
  const backend = new Backend();
  const response = backend.response();
  response.autoWindows = null;
  assert.equal(parseAccountResponse(response).autoWindows, null);
  delete response.autoWindows;
  assert.equal(parseAccountResponse(response).autoWindows, undefined);
});

test("automatic operations reject null schedules and retain the last successful result", async () => {
  const backend = new Backend();
  const service = new UsageWindowService(backend);
  try {
    await service.refresh();
    const last = service.schedules;
    backend.handler = async () => ({ ...backend.response(), autoWindows: null });
    await service.refresh();
    assert.equal(service.schedules, last);
    assert.ok(service.error);
  } finally { service.dispose(); }
});

test("automatic response revision increments alone do not change account state", () => {
  assert.equal(accountStateChanged(state, { ...state, revision: 100 }), false);
  for (const changed of [
    { activeProfileId: profile.id }, { pendingProfileId: profile.id },
    { profiles: [profile] }, { currentAccount: { user: "new-user" } },
    { isSwitching: true }, { hasActiveTurns: true }, { loginPending: true },
    { lastError: "authentication failed" },
  ]) {
    assert.equal(accountStateChanged(state, { ...state, revision: 100, ...changed }), true);
  }
});

test("automatic responses advance revision without emitting state until account fields change", async context => {
  let AccountService;
  try { ({ AccountService } = await import("../src/accountService")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX") {
      context.skip("Native TS stripping cannot load existing AccountService parameter properties.");
      return;
    }
    throw error;
  }
  const service = Object.create(AccountService.prototype) as InstanceType<typeof AccountService>;
  EventEmitter.call(service);
  let incoming = { ...state, revision: 1 };
  Object.assign(service, {
    state, instanceId: state.instanceId, options: { codexHome: state.codexHome },
    transport: { request: async () => ({ state: incoming, usage: null, login: null, usageProfileId: null, autoWindows: [] }) },
    transportVerified: true,
  });
  let events = 0;
  service.on("state", () => ++events);
  await service.call({ action: "autoWindowStatus" });
  assert.equal(events, 0);
  assert.equal(service.state?.revision, 1);
  incoming = { ...incoming, revision: 2, hasActiveTurns: true };
  await service.call({ action: "autoWindowTick" });
  assert.equal(events, 1);
  incoming = { ...incoming, revision: 1, hasActiveTurns: false };
  await service.call({ action: "autoWindowStatus" });
  assert.equal(events, 1);
  assert.equal(service.state?.revision, 2);
});

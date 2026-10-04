import assert from "node:assert/strict";
import test from "node:test";
import { accountWarning, SwitchCompletionTracker } from "../src/accountPresentation";
import { AccountState } from "../src/protocol";

const OLD = "a".repeat(32);
const NEXT = "b".repeat(32);
function state(active: string, pending: string | null, switching: boolean, lastError: string | null = null): AccountState {
  return {
    instanceId: "instance", revision: 1, codexHome: "C:/home", profiles: [], currentAccount: null,
    activeProfileId: active, pendingProfileId: pending, isSwitching: switching,
    hasActiveTurns: false, loginPending: false, lastError
  };
}

test("completed switch refreshes even when active ID changed during the switching event", () => {
  const tracker = new SwitchCompletionTracker();
  assert.equal(tracker.observe(state(OLD, null, false)), false);
  assert.equal(tracker.observe(state(NEXT, NEXT, true)), false);
  assert.equal(tracker.observe(state(NEXT, null, false)), true);
  assert.equal(tracker.observe(state(NEXT, null, false)), false);
});

test("a view opened during switching refreshes when that pending transition settles", () => {
  const tracker = new SwitchCompletionTracker();
  assert.equal(tracker.observe(state(NEXT, NEXT, true)), false);
  assert.equal(tracker.observe(state(NEXT, null, false)), true);
});

test("backend account errors remain prominent without a transport failure", () => {
  assert.equal(accountWarning(undefined, state(OLD, null, false, "switch recovery failed")), "switch recovery failed");
  assert.equal(accountWarning("bridge disconnected", state(OLD, null, false, "switch recovery failed")), "bridge disconnected");
});

import assert from "node:assert/strict";
import test from "node:test";
import { selectStateByRevision } from "../src/accountService";
import { AccountState, parseAccountResponse } from "../src/protocol";

const PROFILE_ID = "a".repeat(32);
function state(revision: number, activeProfileId: string | null = PROFILE_ID): AccountState {
  return {
    instanceId: "instance", revision, codexHome: "C:/home",
    profiles: [{ id: PROFILE_ID, email: null, workspaceAccountId: "workspace", userId: "user", planType: null }],
    currentAccount: null, activeProfileId, pendingProfileId: null, isSwitching: false,
    hasActiveTurns: false, loginPending: false, lastError: null
  };
}

test("a response arriving after a newer event cannot revert account state", () => {
  const eventState = state(4);
  const delayedResponseState = state(3, null);
  assert.equal(selectStateByRevision(eventState, delayedResponseState), eventState);
});

test("account state requires a non-negative integer revision and lowercase 32-hex profile IDs", () => {
  const envelope = (candidate: AccountState) => ({ state: candidate, login: null, usage: null, usageProfileId: null });
  assert.equal(parseAccountResponse(envelope(state(0))).state.revision, 0);
  assert.throws(() => parseAccountResponse(envelope(state(-1))), /identity/);
  const invalid = state(1);
  invalid.profiles[0].id = "A".repeat(32);
  assert.throws(() => parseAccountResponse(envelope(invalid)), /profile/);
});

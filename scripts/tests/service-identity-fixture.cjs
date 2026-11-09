"use strict";

// Service and chat identities intentionally differ. All values are synthetic.
const CHAT_IDENTITY = Object.freeze({ accountId: "chat-account", userId: "chat-user", profileId: "chat" });
function serviceIdentityFixture(profileId = "service", revision = 9, instanceId = "native") {
  return { instanceId, serviceAccount: { profileId, revision, state: "ready" }, activeProfileId: CHAT_IDENTITY.profileId,
    profiles: [
      { id: profileId, workspaceAccountId: `workspace-${profileId}`, userId: `user-${profileId}`, authToken: "must-never-be-retained" },
      { id: CHAT_IDENTITY.profileId, workspaceAccountId: CHAT_IDENTITY.accountId, userId: CHAT_IDENTITY.userId }
    ] };
}
module.exports = { CHAT_IDENTITY, serviceIdentityFixture };

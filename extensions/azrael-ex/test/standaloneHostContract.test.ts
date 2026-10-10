import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ACCOUNT_COMMANDS = [
  "azrael.openSidebar",
  "azrael.rootResume",
  "azrael.usage",
  "azrael.devinAccount",
  "azrael.manageAccounts",
  "azrael.apiConnections",
  "azrael.accountQuickPick",
  "azrael.refreshAccounts",
  "azrael.openCodex",
  "azrael.openCodexSettings",
  "azrael.syncSharedEnvironment",
  "azrael.fetchSharedPlaybook",
  "azrael.instructions",
];

test("standalone Azrael host contributes its own chat view and account commands", () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"));
  assert.equal(manifest.version, "0.4.0");
  assert.equal(manifest.extensionDependencies, undefined);
  assert.equal(manifest.extensionPack, undefined);
  assert.equal(manifest.contributes.views.azraelViewContainer[0].id, "azrael.chat");
  assert.equal(manifest.contributes.views.azraelViewContainer[0].type, "webview");
  assert.ok(manifest.activationEvents.includes("onView:azrael.chat"));
  assert.deepEqual(Object.keys(manifest.contributes.configuration?.properties ?? {}).sort(), [
    "azrael.instructions.repository",
    "azrael.sharedEnvironment.ref",
    "azrael.sharedEnvironment.repository",
  ]);
  assert.deepEqual(manifest.contributes.commands.map((entry: { command: string }) => entry.command), ACCOUNT_COMMANDS);
});


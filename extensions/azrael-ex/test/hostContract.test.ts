import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";

const ACCOUNT_COMMANDS = [
  "azrael.openSidebar",
  "azrael.rootResume",
  "azrael.usage",
  "azrael.devinAccount",
  "azrael.manageAccounts",
  "azrael.accountQuickPick",
  "azrael.refreshAccounts",
  "azrael.openCodex",
  "azrael.openCodexSettings",
  "azrael.syncSharedEnvironment",
  "azrael.fetchSharedPlaybook",
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
    "azrael.sharedEnvironment.ref",
    "azrael.sharedEnvironment.repository",
  ]);
  assert.deepEqual(manifest.contributes.commands.map((entry: { command: string }) => entry.command), ACCOUNT_COMMANDS);
});

test("activation uses the injected runtime and exposes invalid runtime failures", async () => {
  const registered = new Map<string, () => unknown>();
  const errors: string[] = [];
  const vscode = {
    commands: {
      registerCommand(command: string, action: () => unknown) {
        registered.set(command, action);
        return { dispose() {} };
      },
    },
    env: { remoteName: undefined },
    window: { showErrorMessage(message: string) { errors.push(message); } },
    get extensions(): never { throw new Error("activation must not discover or activate another extension"); },
  };
  const moduleApi = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const originalLoad = moduleApi._load;
  moduleApi._load = function (request, parent, isMain) {
    return request === "vscode" ? vscode : originalLoad.call(this, request, parent, isMain);
  };
  try {
    const extension = require("../src/extension") as typeof import("../src/extension");
    const subscriptions: Array<{ dispose(): unknown }> = [];
    await extension.activate(
      { extensionUri: { scheme: "file" }, subscriptions } as never,
      { bridge: "relative-bridge", engine: "relative-engine", socket: "relative-socket", codexHome: "relative-home", engineVersion: "0.157.1", env: {} },
    );
    assert.deepEqual([...registered.keys()].sort(), ACCOUNT_COMMANDS.filter(command => command !== "azrael.openSidebar").sort());
    await registered.get("azrael.manageAccounts")?.();
    assert.match(errors.at(-1) ?? "", /absolute bridge, engine, socket, and CODEX_HOME paths/);
    assert.equal(subscriptions.length, ACCOUNT_COMMANDS.length - 1);
    extension.deactivate();
  } finally {
    moduleApi._load = originalLoad;
  }
});

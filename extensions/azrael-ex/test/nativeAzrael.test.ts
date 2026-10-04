import assert from "node:assert/strict";
import test from "node:test";
import {
  AZRAEL_HOST_EXTENSION_ID,
  AZRAEL_OPEN_SIDEBAR_COMMAND,
  NativeAzraelApi,
  azraelHostExtension,
  azraelSettingKeys,
  openAzraelSidebar,
  pickAzraelSetting
} from "../src/nativeAzrael";

function apiFixture(): { api: NativeAzraelApi; requestedIds: string[]; executed: Array<[string, ...unknown[]]> } {
  const requestedIds: string[] = [];
  const executed: Array<[string, ...unknown[]]> = [];
  const extension = {
    packageJSON: {
      contributes: {
        commands: [
          { command: AZRAEL_OPEN_SIDEBAR_COMMAND, title: "Open azrael" },
          { command: "chatgpt.openSidebar", title: "Open Codex" }
        ],
        configuration: [
          { properties: { "azrael.model": {}, "chatgpt.model": {} } },
          { properties: { "azrael.language": {} } }
        ]
      }
    }
  };
  const api = {
    extensions: {
      getExtension(extensionId: string) {
        requestedIds.push(extensionId);
        return extension;
      }
    },
    commands: {
      async executeCommand(command: string, ...rest: unknown[]) {
        executed.push([command, ...rest]);
        return undefined;
      }
    },
    window: {
      async showQuickPick<T>(items: readonly T[]) { return items[0]; }
    }
  } as unknown as NativeAzraelApi;
  return { api, requestedIds, executed };
}

test("companion resolves only the independent azrael host", () => {
  const { api, requestedIds } = apiFixture();
  assert.ok(azraelHostExtension(api));
  assert.deepEqual(requestedIds, [AZRAEL_HOST_EXTENSION_ID]);
  assert.equal(AZRAEL_HOST_EXTENSION_ID, "azrael-ex-local.azrael");
});

test("sidebar and settings use only the azrael host namespace", async () => {
  const { api, requestedIds, executed } = apiFixture();
  assert.deepEqual(azraelSettingKeys(api), ["azrael.model", "azrael.language"]);
  await openAzraelSidebar(api);
  await pickAzraelSetting(api);
  assert.ok(requestedIds.every((id) => id === AZRAEL_HOST_EXTENSION_ID));
  assert.deepEqual(executed, [
    ["azrael.openSidebar"],
    ["workbench.action.openSettings", "azrael.model"]
  ]);
});

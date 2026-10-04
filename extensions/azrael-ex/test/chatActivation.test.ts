import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Module from "node:module";
import test from "node:test";

test("integrated activation leaves the chat view and sidebar command to the official UI host", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-integrated-activation-"));
  const registered: string[] = [];
  const joinedPaths: string[] = [];
  const disposable = () => ({ dispose() {} });
  const vscode = {
    Uri: { joinPath(base: { scheme: string; fsPath: string }, ...parts: string[]) {
      const fsPath = path.join(base.fsPath, ...parts);
      joinedPaths.push(fsPath);
      return { ...base, fsPath };
    } },
    env: { remoteName: undefined, sessionId: "fixture-session" },
    workspace: { workspaceFolders: undefined },
    StatusBarAlignment: { Left: 1 },
    commands: { registerCommand(command: string) { registered.push(command); return disposable(); }, executeCommand: async () => undefined },
    window: {
      registerWebviewViewProvider() { throw new Error("integrated account UI must not register a chat view"); },
      createOutputChannel: () => ({ info() {}, dispose() {} }),
      createStatusBarItem: () => ({ show() {}, dispose() {} }),
      showErrorMessage() {},
    },
  };
  const moduleApi = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
  const originalLoad = moduleApi._load;
  moduleApi._load = function (request, parent, isMain) {
    return request === "vscode" ? vscode : originalLoad.call(this, request, parent, isMain);
  };
  try {
    const { ChatSession } = require("../src/chatSession") as typeof import("../src/chatSession");
    const { AccountService } = require("../src/accountService") as typeof import("../src/accountService");
    const originalStart = ChatSession.prototype.start;
    const originalConnect = AccountService.prototype.connect;
    ChatSession.prototype.start = async function () { throw new Error("integrated account UI must not start a chat session"); };
    AccountService.prototype.connect = async function () { return {} as any; };
    try {
      delete require.cache[require.resolve("../src/extension")];
      const extension = require("../src/extension") as typeof import("../src/extension");
      await extension.activate({
        extensionPath: directory, extensionUri: { scheme: "file", fsPath: directory },
        storageUri: { scheme: "file", fsPath: path.join(directory, "workspace") },
        subscriptions: []
      } as never, {
        bridge: process.execPath, engine: process.execPath,
        socket: path.join(directory, "management.sock"), codexHome: path.join(directory, "state"),
        engineVersion: "0.157.1", env: {}
      });
      assert.ok(!registered.includes("azrael.openSidebar"));
      assert.ok(registered.includes("azrael.usage"));
      assert.ok(joinedPaths.includes(path.join(directory, "webview", "assets", "azrael-fonts")));
      extension.deactivate();
    } finally {
      ChatSession.prototype.start = originalStart;
      AccountService.prototype.connect = originalConnect;
    }
  } finally {
    moduleApi._load = originalLoad;
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

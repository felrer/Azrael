import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Module from "node:module";
import test from "node:test";

test("standalone activation starts one chat session before account bridge and view resolution", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-chat-activation-"));
  fs.writeFileSync(path.join(directory, "azrael-runtime.json"), JSON.stringify({
    schema: 2, engine: process.execPath, bridge: process.execPath,
    codexHome: path.join(directory, "state"), engineVersion: "0.157.1"
  }));
  const events: string[] = [];
  const joinedPaths: string[] = [];
  let provider: any;
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
    commands: { registerCommand: () => disposable(), executeCommand: async () => undefined },
    window: {
      registerWebviewViewProvider(_id: string, value: unknown) { provider = value; return disposable(); },
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
    ChatSession.prototype.start = async function () { events.push("chat"); };
    AccountService.prototype.connect = async function () { events.push("account"); return {} as any; };
    try {
      const extension = require("../src/extension") as typeof import("../src/extension");
      await extension.activate({
        extensionPath: directory, extensionUri: { scheme: "file", fsPath: directory },
        storageUri: { scheme: "file", fsPath: path.join(directory, "workspace") },
        subscriptions: []
      } as never);
      assert.deepEqual(events, ["chat", "account"]);
      assert.ok(joinedPaths.includes(path.join(directory, "media", "fonts")));
      assert.ok(provider);
      provider.resolveWebviewView({
        webview: { cspSource: "fixture", options: {}, postMessage: () => Promise.resolve(true), onDidReceiveMessage: disposable },
        onDidDispose: disposable,
      });
      assert.deepEqual(events, ["chat", "account"]);
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


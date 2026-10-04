"use strict";

const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error("Native Azrael host did not finish its startup requests.");
}

exports.run = async function run() {
  const root = process.env.AZRAEL_NATIVE_CHECK_ROOT;
  const expectedState = process.env.AZRAEL_NATIVE_EXPECTED_STATE;
  if (!root || !expectedState) throw new Error("Native host check fixture environment is missing.");
  const resultPath = path.join(root, "host-result.json");
  const result = { passed: false, hostId: "azrael-ex-local.azrael", engineStarts: 0, modelLists: 0, threadLists: 0 };
  try {
    if (vscode.extensions.getExtension("openai.chatgpt")) throw new Error("Official Codex was present in the fresh profile.");
    const host = vscode.extensions.getExtension("azrael-ex-local.azrael");
    if (!host) throw new Error("Native Azrael extension was not installed.");
    result.hostWasActive = host.isActive;
    const manifest = host.packageJSON;
    if (manifest.main !== "./dist/src/extension.js" ||
        !manifest.contributes?.views?.azraelViewContainer?.some(view => view.id === "azrael.chat")) {
      throw new Error("Azrael-owned chat view was not contributed.");
    }
    const config = JSON.parse(fs.readFileSync(path.join(host.extensionPath, "azrael-runtime.json"), "utf8"));
    if (path.resolve(config.codexHome).toLowerCase() !== path.resolve(expectedState).toLowerCase()) {
      throw new Error("Native runtime used an unexpected state home.");
    }
    if (!host.isActive) {
      const transportPath = path.join(host.extensionPath, "dist", "src", "appServerTransport.js")
        .replace(/^([A-Z]):/, (_, drive) => `${drive.toLowerCase()}:`);
      const { AppServerTransport } = require(transportPath);
      const start = AppServerTransport.prototype.start;
      const request = AppServerTransport.prototype.request;
      AppServerTransport.prototype.start = async function () {
        result.engineStarts += 1;
        return start.apply(this, arguments);
      };
      AppServerTransport.prototype.request = async function (method) {
        const value = await request.apply(this, arguments);
        if (method === "model/list") result.modelLists += 1;
        if (method === "thread/list") result.threadLists += 1;
        return value;
      };
    }
    await host.activate();
    result.transportModuleCount = Object.keys(require.cache).filter(key => key.toLowerCase().endsWith("appservertransport.js")).length;
    await vscode.commands.executeCommand("azrael.openSidebar");
    const commands = await vscode.commands.getCommands(true);
    for (const command of ["azrael.openCodex", "azrael.manageAccounts", "azrael.usage", "azrael.rootResume"]) {
      if (!commands.includes(command)) throw new Error(`Native Azrael command missing: ${command}`);
    }
    await waitFor(() => result.modelLists > 0 && result.threadLists > 0, 35_000);
    result.passed = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message : "Native host check failed";
  }
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  if (!result.passed) throw new Error(result.error);
};

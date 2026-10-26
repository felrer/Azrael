"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), vm = require("node:vm");
const { createRequire } = require("node:module");
const ts = require(require.resolve("typescript", { paths: [path.join(__dirname, "../extensions/azrael-ex")] }));
const { prepareLinuxSupervision } = require("./prepare-platform-host.cjs");

// The synthetic app-server retains the pinned lifecycle boundaries used by the transform.
const hostSource = `const {EventEmitter}=require('node:events');
class Host {
  sendProviderRequest() {}
  dispose() {this.teardownProcess()}
  teardownProcess() {this.proc=undefined;this.initialized=false}
  finishProcessExitIfReady() {this.teardownProcess()}
  startCodexProcess() {let child={pid:1,stdout:new EventEmitter()};this.proc=child,this.initialized=!1;return {success:true}}
}
class Provider {constructor(){this.fatalError='old';this.mostRecentErrorLog='old';this.callbacks={onInitialized:()=>{this.broadcastToAllViews()}}}broadcastToAllViews(){}}
module.exports={Host,Provider};`;

test("prepared Linux host ships its supervisor and restarts through the injected lifecycle", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "azrael-linux-host-"));
  const script = path.join(root, "out/extension.js");
  fs.mkdirSync(path.dirname(script)); fs.writeFileSync(script, hostSource);
  let host, subscription;
  try {
    const receipt = prepareLinuxSupervision(root, ts, { os: "linux" });
    assert.notEqual(receipt.sourceSha256, receipt.outputSha256);
    for (const name of ["linux-native-supervision.cjs", "local-history-host.cjs", "sync-local-history.py"]) {
      assert.equal(fs.readFileSync(path.join(root, "out", name), "utf8"), fs.readFileSync(path.join(__dirname, name), "utf8"));
      assert.match(receipt.modules[name], /^[a-f0-9]{64}$/);
    }
    const { Host, Provider } = require(script);
    const supervisor = require(path.join(root, "out/linux-native-supervision.cjs"));
    let restarts = 0;
    subscription = supervisor.onRestart(() => restarts++);
    host = new Host(); host.startCodexProcess();
    const first = host.proc; host.initialized = true; first.stdout.emit("data");
    await new Promise(setImmediate);
    assert.equal(restarts, 0);
    host.finishProcessExitIfReady(); t.mock.timers.tick(1000);
    assert.ok(host.proc && host.proc !== first);
    host.initialized = true; host.proc.stdout.emit("data");
    await new Promise(setImmediate);
    assert.equal(restarts, 1);
    const provider = new Provider(); provider.callbacks.onInitialized();
    assert.equal(provider.fatalError, null);
    assert.equal(provider.mostRecentErrorLog, null);
    host.dispose();
    assert.equal(supervisor.snapshot().length, 0);

    // Activation resolves the generated payload module, rather than a stubbed supervisor.
    const entry = fs.readFileSync(path.join(__dirname, "integrated-azrael-entry.cjs"), "utf8");
    const module = { exports: {} }, events = [], load = createRequire(path.join(root, "integrated-azrael-entry.cjs"));
    vm.runInNewContext(entry, { module, exports: module.exports, process: { platform: "linux" }, AggregateError, require(name) {
      if (name === "vscode") return { env: { sessionId: "prepared-linux" } };
      if (name === "node:fs/promises") return { access: async () => {} };
      if (name === "./out/extension.js") return { async activate() { events.push("native"); }, async deactivate() {} };
      if (name === "./account-ui/dist/src/extension.js") return { async activate() { events.push("account"); }, async deactivate() {} };
      if (name === "./out/azrael-runtime.cjs") return { async initialize() { return { env: {} }; } };
      if (name === "./out/azrael-recovery.cjs") return { initialize: () => ({ dispose() {} }) };
      if (name === "./out/platform-runtime.cjs") return { validateRuntimePlatform: () => ({ desktopControl: false }) };
      return load(name);
    } });
    await module.exports.activate({ globalStorageUri: { scheme: "file", fsPath: path.join(root, "storage") } });
    assert.deepEqual(events, ["native", "account"]);
    await module.exports.deactivate();
  } finally {
    host?.dispose(); subscription?.dispose();
    fs.rmSync(root, { recursive: true });
  }
});

test("Windows and macOS preparation do not read or alter Linux host inputs", () => {
  for (const os of ["win32", "darwin"]) assert.equal(prepareLinuxSupervision("missing-host", ts, { os }), null);
});

test("supervision transform accepts the pinned native host before and after namespacing", { skip: !fs.existsSync(path.join(__dirname, "../artifacts/upstream-ui/26.1007.21434/out/extension.js")) }, () => {
  const source = fs.readFileSync(path.join(__dirname, "../artifacts/upstream-ui/26.1007.21434/out/extension.js"), "utf8");
  const prepared = require("./inject-linux-supervision.cjs").inject(source, ts);
  const result = require("./namespace-azrael-host.cjs").transformAsset(prepared, "out/extension.js", "extension.js", ts);
  assert.equal(ts.createSourceFile("extension.js", result.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length, 0);
});
